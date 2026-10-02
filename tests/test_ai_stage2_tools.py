"""Stage 2 ai_chat tools: directory, own mailbox/files, IT reports, compact tool specs."""
from __future__ import annotations

import importlib
import sys
import time
from datetime import date, timedelta
from pathlib import Path
from types import SimpleNamespace


_ROOT = Path(__file__).resolve().parents[1]
for _p in (str(_ROOT), str(_ROOT / "WEB-itinvent")):
    if _p not in sys.path:
        sys.path.insert(0, _p)

service_module = importlib.import_module("backend.ai_chat.service")
context_module = importlib.import_module("backend.ai_chat.tools.context")
directory = importlib.import_module("backend.ai_chat.tools.directory")
self_service = importlib.import_module("backend.ai_chat.tools.self_service")
it_reports = importlib.import_module("backend.ai_chat.tools.it_reports")
inventory_api = importlib.import_module("backend.api.v1.inventory")
queries = importlib.import_module("backend.database.queries")
user_service_module = importlib.import_module("backend.services.user_service")
address_book_module = importlib.import_module("backend.services.address_book_service")
company_structure_module = importlib.import_module("backend.services.company_structure_service")
mailbox_quota_module = importlib.import_module("backend.services.mailbox_quota_service")
my_files_module = importlib.import_module("backend.services.my_files_service")
permissions_module = importlib.import_module("backend.ai_chat.tool_permissions")
registry = importlib.import_module("backend.ai_chat.tools").ai_tool_registry


def _ctx(user_id: int = 7):
    return context_module.AiToolExecutionContext(
        bot_id="bot",
        bot_title="Ассистент",
        conversation_id="conv-1",
        run_id="run-1",
        user_id=user_id,
        user_payload={"id": user_id, "role": "viewer", "username": "ivanov_ii"},
        effective_database_id="ITINVENT",
        enabled_tools=[],
        tool_settings={"multi_db_mode": "single", "allowed_databases": []},
    )


# ---------- directory ----------


def _person(**overrides):
    base = {
        "full_name": "Петров Пётр Петрович",
        "position": "Бухгалтер",
        "department": "Бухгалтерия",
        "department_location": "Москва",
        "office_room": "214",
        "work_phones": [{"value": "+7 495 000-00-01"}],
        "work_emails": [{"value": "petrov@corp.local"}],
        "personal_phones": [{"value": "+7 999 111-22-33"}],
        "personal_emails": [{"value": "petrov@gmail.com"}],
        "inn": "770000000000",
        "age": 41,
        "hire_date": "2015-01-01",
        "employee_code": "000123",
    }
    base.update(overrides)
    return base


def test_people_search_returns_work_contacts_only(monkeypatch):
    monkeypatch.setattr(
        address_book_module.address_book_service,
        "search",
        lambda query, limit, **kw: {"items": [_person()], "total": 1, "updated_at": "2026-10-01"},
    )
    result = directory.PeopleSearchTool().execute(context=_ctx(), args=directory.PeopleSearchArgs(query="Петров"))
    assert result.ok is True
    person = result.data["items"][0]
    assert person["work_phones"] == ["+7 495 000-00-01"]
    assert person["office_room"] == "214"
    for forbidden in ("personal_phones", "personal_emails", "inn", "age", "hire_date", "employee_code"):
        assert forbidden not in person
    assert "+7 999" not in str(result.data)


def test_people_search_absence_and_absent_only(monkeypatch):
    future = (date.today() + timedelta(days=5)).isoformat()
    past = (date.today() - timedelta(days=1)).isoformat()
    rows = [
        _person(full_name="В отпуске", absence={"kind": "vacation", "label": "Отпуск", "starts_on": "2026-09-20", "returns_on": future}),
        _person(full_name="Уже вернулся", absence={"kind": "vacation", "label": "Отпуск", "returns_on": past}),
        _person(full_name="На месте"),
    ]
    captured = {}

    def fake_search(query, limit, **kw):
        captured.update(limit=limit, **kw)
        return {"items": rows, "total": 3}

    monkeypatch.setattr(address_book_module.address_book_service, "search", fake_search)
    result = directory.PeopleSearchTool().execute(
        context=_ctx(), args=directory.PeopleSearchArgs(department="Продажи", absent_only=True)
    )
    assert captured["department"] == "Продажи"
    assert captured["limit"] == 200
    assert [item["full_name"] for item in result.data["items"]] == ["В отпуске"]
    assert result.data["items"][0]["absence"]["returns_on"] == future


def test_people_search_requires_query_or_department():
    result = directory.PeopleSearchTool().execute(context=_ctx(), args=directory.PeopleSearchArgs())
    assert result.ok is False


def test_department_get_returns_head_and_path(monkeypatch):
    fake_service = SimpleNamespace(
        search_directory=lambda query, limit=30: {
            "items": [
                {"kind": "person", "title": "Кто-то"},
                {"kind": "node", "node_id": "n1", "title": "Логистика", "path": [{"title": "Компания"}, {"title": "Логистика"}]},
            ]
        },
        get_node=lambda node_id: {"person_name": "Сидоров С.С.", "person_position": "Начальник отдела"},
    )
    monkeypatch.setattr(company_structure_module, "get_company_structure_service", lambda: fake_service)
    result = directory.DepartmentGetTool().execute(context=_ctx(), args=directory.DepartmentGetArgs(query="логистик"))
    assert result.data["items"] == [
        {"title": "Логистика", "head_name": "Сидоров С.С.", "head_position": "Начальник отдела", "path": ["Компания", "Логистика"]}
    ]


# ---------- own mailbox and files ----------


def test_me_mailbox_quota_matches_own_email_exactly(monkeypatch):
    monkeypatch.setattr(
        user_service_module.user_service,
        "get_by_id",
        lambda uid: {"id": uid, "email": "Ivanov@corp.local", "full_name": "Иванов", "auth_source": "ldap", "username": "ivanov"},
    )
    monkeypatch.setattr(queries, "find_owner_nos_by_identity", lambda **kw: {"email": [], "name": []})
    snapshot = SimpleNamespace(id=5, model_dump=lambda mode=None: {"collected_at": "2026-10-01T06:00:00Z"})
    rows = [
        SimpleNamespace(email="vivanov@corp.local", used_bytes=1, quota_bytes=2, free_bytes=1, used_percent=50.0),
        SimpleNamespace(email="ivanov@corp.local", used_bytes=49 * 1024 ** 3, quota_bytes=50 * 1024 ** 3, free_bytes=1024 ** 3, used_percent=98.0),
    ]
    monkeypatch.setattr(mailbox_quota_module.mailbox_quota_service, "get_latest_snapshot", lambda: snapshot)
    monkeypatch.setattr(
        mailbox_quota_module.mailbox_quota_service,
        "list_rows",
        lambda snapshot_id, **kw: SimpleNamespace(items=rows, total=2),
    )
    result = self_service.MyMailboxQuotaTool().execute(context=_ctx(), args=self_service._NoArgs())
    assert result.ok is True
    assert [item["email"] for item in result.data["items"]] == ["ivanov@corp.local"]
    assert result.data["items"][0]["warning"] is True
    assert result.data["snapshot_at"] == "2026-10-01T06:00:00Z"


def test_me_files_search_uses_own_user_id(monkeypatch):
    captured = {}
    monkeypatch.setattr(
        my_files_module.my_files_service,
        "list_files",
        lambda **kw: captured.update(kw) or {"items": [{"id": "f1", "original_file_name": "Отчёт сентябрь.xlsx", "folder_name": "Отчёты", "original_size_bytes": 2048, "status": "ready"}]},
    )
    result = self_service.MyFilesSearchTool().execute(context=_ctx(), args=self_service.MyFilesSearchArgs(query="отчёт"))
    assert captured == {"user_id": 7, "query": "отчёт"}
    assert result.data["items"][0]["file_id"] == "f1"


def test_me_files_attach_checks_owner_and_size(monkeypatch):
    def fake_download(*, file_id, user_id):
        if file_id != "f1" or user_id != 7:
            raise my_files_module.MyFilesNotFoundError("File not found")
        return SimpleNamespace(file_name="Отчёт.xlsx", download_size_bytes=2048, media_type="application/x", path=None, mode="stored")

    monkeypatch.setattr(my_files_module.my_files_service, "get_download", fake_download)
    ok = self_service.MyFilesAttachTool().execute(context=_ctx(), args=self_service.MyFilesAttachArgs(file_id="f1"))
    assert ok.ok is True and ok.data["delivery"] == "attached_after_answer"
    foreign = self_service.MyFilesAttachTool().execute(context=_ctx(user_id=8), args=self_service.MyFilesAttachArgs(file_id="f1"))
    assert foreign.ok is False
    monkeypatch.setattr(self_service, "MY_FILES_ATTACH_MAX_BYTES", 1024)
    too_big = self_service.MyFilesAttachTool().execute(context=_ctx(), args=self_service.MyFilesAttachArgs(file_id="f1"))
    assert too_big.ok is False and "слишком большой" in too_big.error


def test_extract_my_file_deliveries():
    traces = [
        {"tool_id": "me.files.attach", "status": "ok", "args": {"file_id": "a"}},
        {"tool_id": "me.files.attach", "status": "ok", "args": {"file_id": "a"}},
        {"tool_id": "me.files.attach", "status": "error", "args": {"file_id": "b"}},
        {"tool_id": "me.files.search", "status": "ok", "args": {"query": "x"}},
    ]
    assert service_module._extract_my_file_deliveries(traces) == ["a"]


# ---------- IT reports ----------


def _visible(monkeypatch, macs):
    monkeypatch.setattr(it_reports, "_visible_computer_records", lambda context: [{"mac_address": mac} for mac in macs])


def test_computers_changes_filters_visible_and_summarizes(monkeypatch):
    now = int(time.time())
    events = [
        {
            "detected_at": now - 3600,
            "mac_address": "AA:00:00:00:00:01",
            "hostname": "WS-01",
            "change_types": ["monitors", "system"],
            "diff": {
                "system": {"before": {"cpu_model": "i5", "ram_gb": 8.0}, "after": {"cpu_model": "i5", "ram_gb": 16.0}},
                "monitors": {"before": ["sn1|dell|p2419"], "after": ["sn2|lg|24mk"]},
            },
        },
        {"detected_at": now, "mac_address": "BB:00:00:00:00:02", "hostname": "HIDDEN", "change_types": ["storage"], "diff": {}},
    ]
    _visible(monkeypatch, ["AA0000000001"])
    monkeypatch.setattr(inventory_api, "_load_changes", lambda since_ts=None: events)
    result = it_reports.ComputersChangesTool().execute(context=_ctx(), args=it_reports.ComputersChangesArgs(days=7))
    assert result.data["total"] == 1
    item = result.data["items"][0]
    assert item["hostname"] == "WS-01"
    assert item["changes"]["system"] == {"ram_gb": {"before": 8.0, "after": 16.0}}
    assert item["changes"]["monitors"] == {"removed": ["p2419 dell sn1"], "added": ["24mk lg sn2"]}


def test_software_search_respects_visibility_and_version(monkeypatch):
    _visible(monkeypatch, ["AA0000000001"])
    hosts = [
        {
            "hostname": "WS-01",
            "user_login": "ivanov",
            "software_inventory": {
                "collected_at": int(time.time()),
                "items": [
                    {"display_name": "7-Zip 19.00", "display_version": "19.00"},
                    {"display_name": "7-Zip 23.01", "display_version": "23.01"},
                    {"display_name": "AnyDesk", "display_version": "8.0"},
                ],
            },
        }
    ]
    requested = {}
    store = SimpleNamespace(list_hosts=lambda keys: requested.setdefault("keys", set(keys)) and hosts)
    monkeypatch.setattr(inventory_api, "_get_inventory_app_store", lambda: store)
    result = it_reports.SoftwareSearchTool().execute(
        context=_ctx(), args=it_reports.SoftwareSearchArgs(query="7-zip", version_below="22")
    )
    assert requested["keys"] == {"AA0000000001"}
    assert [item["version"] for item in result.data["items"]] == ["19.00"]
    assert result.data["items"][0]["hostname"] == "WS-01"


def test_dismissed_with_equipment(monkeypatch):
    recent = (date.today() - timedelta(days=10)).isoformat()
    old = (date.today() - timedelta(days=400)).isoformat()
    cache = {
        "items": [{"full_name": "Сидоров Сидор Сидорович"}],
        "dismissed_items": [
            {"full_name": "Козлов Кирилл", "dismissal_date": recent, "work_emails": [{"value": "kozlov@corp.local"}]},
            {"full_name": "Сидоров Сидор Сидорович", "dismissal_date": recent, "work_emails": []},
            {"full_name": "Давний Уволенный", "dismissal_date": old, "work_emails": []},
            {"full_name": "Без Техники", "dismissal_date": recent, "work_emails": []},
        ],
    }
    monkeypatch.setattr(address_book_module.address_book_service, "load_cache", lambda: cache)

    def fake_find(*, email=None, display_name=None, db_id=None, limit=3):
        mapping_email = {"kozlov@corp.local": [11]}
        mapping_name = {"Сидоров Сидор Сидорович": [22], "Давний Уволенный": [33]}
        return {"email": mapping_email.get(email, []) if email else [], "name": mapping_name.get(display_name, []) if display_name else []}

    monkeypatch.setattr(queries, "find_owner_nos_by_identity", fake_find)
    monkeypatch.setattr(
        queries,
        "get_equipment_by_owner",
        lambda owner_no, db_id: [{"inv_no": f"{owner_no}01", "model_name": "ThinkPad"}] if owner_no in {11, 22, 33} else [],
    )
    result = it_reports.DismissedWithEquipmentTool().execute(context=_ctx(), args=it_reports.DismissedWithEquipmentArgs(days=90))
    by_name = {row["full_name"]: row for row in result.data["items"]}
    assert set(by_name) == {"Козлов Кирилл", "Сидоров Сидор Сидорович"}
    assert by_name["Козлов Кирилл"]["matched_by"] == "email" and by_name["Козлов Кирилл"]["needs_check"] is False
    # Namesake of a working employee: equipment may belong to the working one.
    assert by_name["Сидоров Сидор Сидорович"]["needs_check"] is True
    assert by_name["Козлов Кирилл"]["equipment"][0]["inv_no"] == "1101"


def test_mailbox_quota_report_maps_filter(monkeypatch):
    captured = {}
    monkeypatch.setattr(
        mailbox_quota_module.mailbox_quota_service,
        "get_latest_snapshot",
        lambda: SimpleNamespace(id=3, model_dump=lambda mode=None: {"imported_at": "2026-10-01"}),
    )
    monkeypatch.setattr(
        mailbox_quota_module.mailbox_quota_service,
        "list_rows",
        lambda snapshot_id, **kw: captured.update(kw) or SimpleNamespace(
            items=[SimpleNamespace(email="a@corp.local", display_name="A", used_bytes=10, quota_bytes=10, free_bytes=0, used_percent=100.0)],
            total=7,
        ),
    )
    result = it_reports.MailboxQuotaReportTool().execute(context=_ctx(), args=it_reports.MailboxQuotaReportArgs(filter="over_quota"))
    assert captured["over_quota"] is True and captured["warning_90"] is False
    assert result.data["total"] == 7 and result.data["truncated"] is True


# ---------- compact tool specs and permissions ----------


def test_compact_specs_keep_every_tool_within_budget():
    specs = registry.list_specs()
    for group, budget in {"itinvent": 3500, "office": 1500, "ad": 700, "network": 700, "self": 1000}.items():
        group_specs = [spec for spec in specs if context_module.get_tool_group(spec["tool_id"]) == group]
        text = service_module._format_tool_specs_for_prompt(group_specs, budget)
        assert len(text) <= budget * 4, group
        for spec in group_specs:
            assert spec["tool_id"] in text, (group, spec["tool_id"])


def test_compact_specs_shorten_descriptions_before_dropping_anything():
    spec = {
        "tool_id": "demo.tool",
        "description": "word " * 200,
        "input_schema": {"type": "object", "properties": {"q": {"type": "string"}}, "required": ["q"]},
    }
    text = service_module._format_tool_specs_for_prompt([spec] * 3, 60)
    assert text.count("demo.tool") == 3
    assert "q*: string" in text


def test_stage2_permissions():
    def can(tool_id, perms):
        return permissions_module.user_can_use_tool(
            tool_id, {"role": "viewer", "use_custom_permissions": True, "custom_permissions": perms}
        )

    assert permissions_module.tool_required_permissions("itinvent.audit.dismissed_with_equipment") == [
        "database.read",
        "address_book.dismissed.read",
    ]
    assert permissions_module.tool_required_permissions("me.files.attach") == ["my_files.read"]
    assert permissions_module.tool_required_permissions("me.mailbox.quota") == ["chat.ai.use"]
    assert permissions_module.tool_required_permissions("office.mailbox.quota_report") == ["mail.quotas.read"]
    assert can("itinvent.audit.dismissed_with_equipment", ["database.read"]) is False


def test_directory_group_wired():
    assert context_module.get_tool_group("directory.people.search") == "directory"
    assert "directory" in service_module._JEV_GROUP_QUESTIONS
    assert service_module._AI_TOOL_GROUP_ROUTING_GUIDES["directory"] == service_module.AI_DIRECTORY_TOOL_ROUTING_GUIDE
