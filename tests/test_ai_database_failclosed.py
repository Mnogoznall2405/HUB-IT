"""A11 P0 fail-closed regression tests: an explicitly requested database_id that
is invalid or forbidden for the user must produce a controlled tool error with
ZERO actual SQL calls — never a silent substitution by the current/pinned/default
database, and never a query against a database the user may not use.

Covered tools span three different files:
- ``itinvent.equipment.search`` / ``itinvent.action.transfer_draft`` (tools/itinvent.py)
- ``mfu.devices.list``                               (tools/mfu.py)
- ``itinvent.action.cartridge_replacement_draft``    (tools/itinvent_works.py)

Plus unit coverage of ``resolve_effective_database_id`` explicit-junk handling.
"""
from __future__ import annotations

import importlib
import json

import pytest

from datetime import datetime, timezone
from types import SimpleNamespace

from test_ai_chat_runtime import _configure_local_backend_runtime, _patch_ai_tool_database_catalog


JUNK_DB = "JUNK-NOPE-DB"
FOREIGN_VALID_DB = "OBJ-ITINVENT"  # valid in the patched catalog, but not the user's effective DB
HOME_DB = "ITINVENT"


def _make_context(
    *,
    role: str = "viewer",
    effective_database_id: str | None = HOME_DB,
    tool_settings: dict | None = None,
    permissions: list[str] | None = None,
):
    tools_context_module = importlib.import_module("backend.ai_chat.tools.context")

    user_payload = {"id": 5, "role": role, "username": "operator"}
    if permissions is not None:
        user_payload["use_custom_permissions"] = True
        user_payload["custom_permissions"] = permissions
    return tools_context_module.AiToolExecutionContext(
        bot_id="bot-test",
        bot_title="AI Assistant",
        conversation_id="conv-1",
        run_id="run-1",
        user_id=5,
        user_payload=user_payload,
        effective_database_id=effective_database_id,
        enabled_tools=[],
        tool_settings=tool_settings or {"multi_db_mode": "single", "allowed_databases": []},
    )


@pytest.fixture
def equipment_search_counter(monkeypatch):
    """Counting replacement for queries.search_equipment_by_serial.

    Any single call means SQL would have run — the fail-closed tests must
    keep this at zero, the positive controls assert exactly one call.
    """
    calls: list[dict[str, str]] = []

    def fake_search(search_term, db_id=None, **kwargs):
        calls.append({"search_term": str(search_term), "db_id": str(db_id or "")})
        return [{"inv_no": "101", "MODEL_NAME": "Dell Latitude", "OWNER_DISPLAY_NAME": "Owner"}]

    monkeypatch.setattr("backend.database.queries.search_equipment_by_serial", fake_search)
    return calls


@pytest.fixture
def mfu_flat_counter(monkeypatch):
    calls: list[dict[str, str]] = []

    def fake_flat(*, db_id=None, limit=None, **kwargs):
        calls.append({"db_id": str(db_id or "")})
        return []

    monkeypatch.setattr("backend.ai_chat.tools.mfu.get_all_equipment_flat", fake_flat)
    return calls


# ---------------------------------------------------------------------------
# 1. non-admin + nonexistent database_id -> controlled error, no SQL
# ---------------------------------------------------------------------------


def test_non_admin_nonexistent_database_id_denies_before_sql(monkeypatch, equipment_search_counter):
    _patch_ai_tool_database_catalog(monkeypatch)
    tools_module = importlib.import_module("backend.ai_chat.tools.itinvent")

    context = _make_context(role="viewer", effective_database_id=HOME_DB)
    result = tools_module.EquipmentSearchTool().execute(
        context=context,
        args=tools_module.EquipmentSearchArgs(query="101", database_id=JUNK_DB),
    ).to_payload()

    assert result["ok"] is False
    assert "not available" in result["error"]
    assert result["database_id"] in (None, "")
    assert equipment_search_counter == [], "SQL must not run when the explicit database id is invalid"


def test_non_admin_nonexistent_database_id_denies_before_sql_mfu(monkeypatch, mfu_flat_counter):
    # Same fail-closed proof for a tool from another file (tools/mfu.py).
    _patch_ai_tool_database_catalog(monkeypatch)
    mfu_module = importlib.import_module("backend.ai_chat.tools.mfu")

    context = _make_context(
        role="viewer",
        effective_database_id=HOME_DB,
        permissions=["mfu.read"],
    )
    result = mfu_module.MfuDevicesListTool().execute(
        context=context,
        args=mfu_module.MfuDevicesListArgs(database_id=JUNK_DB),
    ).to_payload()

    assert result["ok"] is False
    assert mfu_flat_counter == [], "SQL must not run when the explicit database id is invalid"


def test_non_admin_nonexistent_database_id_denies_before_sql_works_draft(monkeypatch):
    # tools/itinvent_works.py: draft creation must stop before touching
    # action_cards/SQL when the model passes a nonexistent database id.
    _patch_ai_tool_database_catalog(monkeypatch)
    works_module = importlib.import_module("backend.ai_chat.tools.itinvent_works")

    inv_calls: list[str] = []

    def fake_get_by_inv(inv_no, db_id=None):
        inv_calls.append(str(db_id or ""))
        return {"INV_NO": inv_no, "MODEL_NAME": "HP LaserJet"}

    monkeypatch.setattr("backend.database.queries.get_equipment_by_inv", fake_get_by_inv)

    context = _make_context(role="viewer", effective_database_id=HOME_DB)
    result = works_module.CartridgeReplacementDraftTool().execute(
        context=context,
        args=works_module.CartridgeReplacementDraftArgs(inv_no="101", database_id=JUNK_DB),
    ).to_payload()

    assert result["ok"] is False
    assert inv_calls == [], "draft creation must not query ITinvent when the database id is invalid"


# ---------------------------------------------------------------------------
# 2. non-admin + valid but foreign database_id -> controlled error, no SQL
# ---------------------------------------------------------------------------


def test_non_admin_valid_foreign_database_id_denies_before_sql(monkeypatch, equipment_search_counter):
    # OBJ-ITINVENT IS in the catalog: the refusal must come from the permission
    # check (non-admin may only use the effective database), not from the id
    # being unknown.
    _patch_ai_tool_database_catalog(monkeypatch)
    tools_module = importlib.import_module("backend.ai_chat.tools.itinvent")

    context = _make_context(role="viewer", effective_database_id=HOME_DB)
    result = tools_module.EquipmentSearchTool().execute(
        context=context,
        args=tools_module.EquipmentSearchArgs(query="101", database_id=FOREIGN_VALID_DB),
    ).to_payload()

    assert result["ok"] is False
    assert "not available" in result["error"]
    assert equipment_search_counter == [], "SQL must not run against a database the user may not use"


def test_non_admin_valid_foreign_database_id_denies_before_sql_mfu(monkeypatch, mfu_flat_counter):
    _patch_ai_tool_database_catalog(monkeypatch)
    mfu_module = importlib.import_module("backend.ai_chat.tools.mfu")

    context = _make_context(
        role="viewer",
        effective_database_id=HOME_DB,
        permissions=["mfu.read"],
    )
    result = mfu_module.MfuDevicesListTool().execute(
        context=context,
        args=mfu_module.MfuDevicesListArgs(database_id=FOREIGN_VALID_DB),
    ).to_payload()

    assert result["ok"] is False
    assert mfu_flat_counter == [], "SQL must not run against a database the user may not use"


# ---------------------------------------------------------------------------
# 3. admin + nonexistent database_id -> controlled error, no SQL
# ---------------------------------------------------------------------------


def test_admin_nonexistent_database_id_denies_before_sql(monkeypatch, equipment_search_counter):
    # Even an admin cannot target a database that does not exist in the catalog:
    # a typo must never degrade to the current/default database.
    _patch_ai_tool_database_catalog(monkeypatch)
    tools_module = importlib.import_module("backend.ai_chat.tools.itinvent")

    context = _make_context(role="admin", effective_database_id=HOME_DB)
    result = tools_module.EquipmentSearchTool().execute(
        context=context,
        args=tools_module.EquipmentSearchArgs(query="101", database_id=JUNK_DB),
    ).to_payload()

    assert result["ok"] is False
    assert "not available" in result["error"]
    assert equipment_search_counter == [], "SQL must not run when even an admin targets a nonexistent database"


# ---------------------------------------------------------------------------
# 4. admin multi-db mode + database_id outside the bot targets -> error, no SQL
# ---------------------------------------------------------------------------


def test_admin_multi_db_database_id_outside_targets_denies_before_sql(monkeypatch, equipment_search_counter):
    # ITINVENT is valid in the catalog AND is the run's effective database, but the
    # bot's multi-db targets are limited to OBJ-ITINVENT: in admin_multi_db mode
    # anything outside the target list is refused, with zero SQL.
    _patch_ai_tool_database_catalog(monkeypatch)
    tools_module = importlib.import_module("backend.ai_chat.tools.itinvent")

    context = _make_context(
        role="admin",
        effective_database_id=HOME_DB,
        tool_settings={"multi_db_mode": "admin_multi_db", "allowed_databases": [FOREIGN_VALID_DB]},
    )
    result = tools_module.EquipmentSearchTool().execute(
        context=context,
        args=tools_module.EquipmentSearchArgs(query="101", database_id=HOME_DB),
    ).to_payload()

    assert result["ok"] is False
    assert "not available" in result["error"]
    assert equipment_search_counter == [], "SQL must not run against a database outside the bot multi-db targets"


# ---------------------------------------------------------------------------
# 5. resolve_effective_database_id unit: explicit junk -> None (no substitution)
# ---------------------------------------------------------------------------


def test_resolve_effective_database_id_explicit_junk_returns_none(monkeypatch):
    _patch_ai_tool_database_catalog(monkeypatch)
    tools_context_module = importlib.import_module("backend.ai_chat.tools.context")

    # non-admin without an assigned database
    assert (
        tools_context_module.resolve_effective_database_id(
            user_payload={"id": 5, "role": "viewer", "username": "operator", "assigned_database": None},
            explicit_database_id=JUNK_DB,
        )
        is None
    )
    # admin: junk must not fall through to pinned/default either
    assert (
        tools_context_module.resolve_effective_database_id(
            user_payload={"id": 1, "role": "admin", "username": "admin", "assigned_database": None},
            explicit_database_id=JUNK_DB,
        )
        is None
    )
    # non-admin with a dangling assignment (renamed/removed database): fail closed
    # even with NO explicit id — never fall through to pinned/default.
    assert (
        tools_context_module.resolve_effective_database_id(
            user_payload={"id": 5, "role": "viewer", "username": "operator", "assigned_database": "GONE-DB"},
            explicit_database_id=None,
        )
        is None
    )
    # positive control: a valid explicit id still resolves for a user without assignment
    assert (
        tools_context_module.resolve_effective_database_id(
            user_payload={"id": 5, "role": "viewer", "username": "operator", "assigned_database": None},
            explicit_database_id=FOREIGN_VALID_DB,
        )
        == FOREIGN_VALID_DB
    )


# ---------------------------------------------------------------------------
# 6. absent database_id -> the current effective database is used (positive)
# ---------------------------------------------------------------------------


def test_absent_database_id_uses_current_database(monkeypatch, equipment_search_counter):
    _patch_ai_tool_database_catalog(monkeypatch)
    tools_module = importlib.import_module("backend.ai_chat.tools.itinvent")

    context = _make_context(role="viewer", effective_database_id=HOME_DB)
    result = tools_module.EquipmentSearchTool().execute(
        context=context,
        args=tools_module.EquipmentSearchArgs(query="101"),
    ).to_payload()

    assert result["ok"] is True
    assert result["database_id"] == HOME_DB
    assert equipment_search_counter == [{"search_term": "101", "db_id": HOME_DB}]


def test_absent_database_id_uses_current_database_mfu(monkeypatch, mfu_flat_counter):
    _patch_ai_tool_database_catalog(monkeypatch)
    mfu_module = importlib.import_module("backend.ai_chat.tools.mfu")

    context = _make_context(
        role="viewer",
        effective_database_id=HOME_DB,
        permissions=["mfu.read"],
    )
    result = mfu_module.MfuDevicesListTool().execute(
        context=context,
        args=mfu_module.MfuDevicesListArgs(),
    ).to_payload()

    assert result["ok"] is True
    assert result["database_id"] == HOME_DB
    assert mfu_flat_counter == [{"db_id": HOME_DB}]


# ---------------------------------------------------------------------------
# 7. regression positive: valid database_id equal to the effective one works
# ---------------------------------------------------------------------------


def test_valid_database_id_matching_effective_works(monkeypatch, equipment_search_counter):
    _patch_ai_tool_database_catalog(monkeypatch)
    tools_module = importlib.import_module("backend.ai_chat.tools.itinvent")

    context = _make_context(role="viewer", effective_database_id=HOME_DB)
    result = tools_module.EquipmentSearchTool().execute(
        context=context,
        args=tools_module.EquipmentSearchArgs(query="101", database_id=HOME_DB),
    ).to_payload()

    assert result["ok"] is True
    assert result["database_id"] == HOME_DB
    assert equipment_search_counter == [{"search_term": "101", "db_id": HOME_DB}]


def test_admin_multi_db_database_id_inside_targets_works(monkeypatch, equipment_search_counter):
    # positive counterpart of test 4: inside the target list the same call succeeds
    _patch_ai_tool_database_catalog(monkeypatch)
    tools_module = importlib.import_module("backend.ai_chat.tools.itinvent")

    context = _make_context(
        role="admin",
        effective_database_id=HOME_DB,
        tool_settings={"multi_db_mode": "admin_multi_db", "allowed_databases": [FOREIGN_VALID_DB]},
    )
    result = tools_module.EquipmentSearchTool().execute(
        context=context,
        args=tools_module.EquipmentSearchArgs(query="101", database_id=FOREIGN_VALID_DB),
    ).to_payload()

    assert result["ok"] is True
    assert result["database_id"] == FOREIGN_VALID_DB
    assert equipment_search_counter == [{"search_term": "101", "db_id": FOREIGN_VALID_DB}]


# ---------------------------------------------------------------------------
# Empty catalog edge: normalize passes any id, but the equality/target gate
# must still refuse model-injected junk before SQL.
# ---------------------------------------------------------------------------


def test_empty_catalog_still_denies_explicit_junk_before_sql(monkeypatch, equipment_search_counter):
    # With an empty database catalog (nothing configured) normalize_database_id
    # accepts any non-empty string — document that this alone cannot smuggle a
    # query into another database, because the requested id must still equal the
    # effective one (non-admin / admin single mode) or be in the multi-db targets.
    tools_context_module = importlib.import_module("backend.ai_chat.tools.context")
    monkeypatch.setattr(tools_context_module, "get_all_db_configs", lambda: [])
    monkeypatch.setattr(tools_context_module.config.database, "database", "", raising=False)
    tools_module = importlib.import_module("backend.ai_chat.tools.itinvent")

    context = _make_context(role="viewer", effective_database_id=HOME_DB)
    result = tools_module.EquipmentSearchTool().execute(
        context=context,
        args=tools_module.EquipmentSearchArgs(query="101", database_id=JUNK_DB),
    ).to_payload()

    assert result["ok"] is False
    assert equipment_search_counter == [], (
        "even with an empty catalog the requested id must match the effective database before any SQL"
    )


# ---------------------------------------------------------------------------
# UNSAFE-1 regression: enqueue -> execute handoff must not resurrect a denied
# explicit database id as the pinned/default database. Harness = the same
# scripted-LLM run pipeline as test_ai_chat_tools_use_effective_database_context.
# ---------------------------------------------------------------------------


def _run_scripted_ai_run(tmp_path, monkeypatch, *, explicit_database_id, db_file):
    """Queue one AI run with a scripted tool call and process it synchronously.

    Returns (query_calls, completion_calls, processed). query_calls records every
    actual invocation of queries.search_equipment_by_serial: the security property
    is that a denied database selection NEVER reaches it.
    """
    database_url = _configure_local_backend_runtime(tmp_path, monkeypatch, db_file)
    _patch_ai_tool_database_catalog(monkeypatch)
    # backend.config is frozen at first import; in a shared pytest process the
    # ambient default may be the production database instead of test_db, which
    # would make the absent-database fall-through assertion order-dependent.
    _pin_default_test_database(monkeypatch)

    ai_chat_module = importlib.import_module("backend.ai_chat.service")
    chat_service_module = importlib.import_module("backend.chat.service")
    chat_db = importlib.import_module("backend.chat.db")
    chat_models = importlib.import_module("backend.chat.models")
    user_service_module = importlib.import_module("backend.services.user_service")

    monkeypatch.setattr(chat_service_module.hub_service, "data_dir", tmp_path, raising=False)

    temp_user_service = user_service_module.UserService(database_url=database_url)
    temp_chat_service = chat_service_module.ChatService()
    temp_chat_service._attachments_root = tmp_path / "chat_message_attachments"
    temp_chat_service._attachments_root.mkdir(parents=True, exist_ok=True)
    temp_chat_service._upload_sessions_root = tmp_path / "chat_upload_sessions"
    temp_chat_service._upload_sessions_root.mkdir(parents=True, exist_ok=True)
    temp_ai_service = ai_chat_module.AiChatService()

    monkeypatch.setattr(ai_chat_module, "user_service", temp_user_service)
    monkeypatch.setattr(chat_service_module, "user_service", temp_user_service)
    monkeypatch.setattr(ai_chat_module, "chat_service", temp_chat_service)
    monkeypatch.setattr(ai_chat_module.ai_kb_retrieval_service, "ensure_index_fresh", lambda **kwargs: None)
    monkeypatch.setattr(ai_chat_module.ai_kb_retrieval_service, "retrieve", lambda **kwargs: [])

    completion_calls: list[dict[str, str]] = []

    def fake_complete_json(**kwargs):
        completion_calls.append({"user_prompt": str(kwargs.get("user_prompt") or "")})
        if len(completion_calls) == 1:
            return {
                "answer_markdown": "",
                "tool_calls": [{"tool_id": "itinvent.equipment.search", "args": {"query": "WS-42"}}],
            }, {"model": "m", "prompt_tokens": 1, "completion_tokens": 1, "total_tokens": 2}
        return {
            "answer_markdown": "Готово.",
            "artifacts": [],
        }, {"model": "m", "prompt_tokens": 1, "completion_tokens": 1, "total_tokens": 2}

    query_calls: list[dict[str, str]] = []

    def fake_search_equipment(search_term, db_id=None, **kwargs):
        query_calls.append({"search_term": str(search_term), "db_id": str(db_id or "")})
        return [{"inv_no": "WS-42", "MODEL_NAME": "Dell Latitude"}]

    monkeypatch.setattr(ai_chat_module.openrouter_client, "complete_json", fake_complete_json)
    monkeypatch.setattr(ai_chat_module.openrouter_client, "get_status", lambda: {"configured": True, "default_model": "m"})
    monkeypatch.setattr("backend.database.queries.search_equipment_by_serial", fake_search_equipment)

    chat_db.initialize_chat_schema(database_url)

    actor = temp_user_service.create_user(
        username="operator_handoff",
        password="secret-pass",
        role="viewer",
        auth_source="local",
        full_name="Operator Handoff",
        is_active=True,
        use_custom_permissions=True,
        custom_permissions=["chat.read", "chat.write", "chat.ai.use", "database.read"],
    )

    bot = temp_ai_service.ensure_default_bot()
    from backend.appdb.db import app_session as grant_session
    from backend.appdb.models import AppAiBotAccess

    with grant_session(database_url) as db:
        db.add(AppAiBotAccess(bot_id=bot["id"], user_id=int(actor["id"]), allowed=True, updated_by=1))
    temp_ai_service.update_bot(bot["id"], {
        "enabled_tools": ["itinvent.equipment.search"],
        "tool_settings": {"multi_db_mode": "single", "allowed_databases": []},
    })

    opened = temp_ai_service.open_bot_conversation(bot_id=bot["id"], current_user_id=int(actor["id"]))

    with chat_db.chat_session(database_url) as session:
        conversation = session.get(chat_models.ChatConversation, opened["id"])
        user_message = chat_models.ChatMessage(
            id="msg-human-handoff-1",
            conversation_id=opened["id"],
            sender_user_id=int(actor["id"]),
            body="Найди устройство WS-42",
            body_format="plain",
            conversation_seq=1,
            created_at=datetime.now(timezone.utc),
        )
        conversation.last_message_id = user_message.id
        conversation.last_message_seq = 1
        conversation.last_message_at = user_message.created_at
        conversation.updated_at = user_message.created_at
        session.add(user_message)

    kwargs = dict(
        conversation_id=opened["id"],
        trigger_message_id="msg-human-handoff-1",
        current_user_id=int(actor["id"]),
    )
    if explicit_database_id is not None:
        kwargs["effective_database_id"] = explicit_database_id
    queued = temp_ai_service.queue_run_for_message(**kwargs)
    assert queued is not None
    processed = temp_ai_service.process_next_run()
    return query_calls, completion_calls, processed, queued


def test_enqueue_execute_handoff_junk_database_id_no_sql(tmp_path, monkeypatch):
    # A11 P0 UNSAFE-1 regression: the client explicitly requests a database that
    # does not exist. Enqueue resolves it to None (fail-closed) and stores the raw
    # requested id; at execution time the handoff must re-validate THAT junk id and
    # deny — before the fix the stored None was re-resolved as "absent" and the
    # run silently queried the default database.
    query_calls, completion_calls, processed, queued = _run_scripted_ai_run(
        tmp_path, monkeypatch, explicit_database_id=JUNK_DB, db_file="ai_handoff_junk.db",
    )

    assert processed is True
    assert query_calls == [], (
        f"junk explicit database must never reach SQL; got calls: {query_calls}"
    )
    # The controlled denial (not silent data) is what the model receives.
    assert len(completion_calls) >= 2
    tool_results_prompt = completion_calls[1]["user_prompt"]
    assert "not available" in tool_results_prompt, (
        "the model must see the controlled database error instead of equipment rows"
    )
    assert "Dell Latitude" not in tool_results_prompt


def test_enqueue_execute_handoff_valid_database_id_positive_control(tmp_path, monkeypatch):
    # Positive control proving the harness end-to-end conductivity: a VALID
    # explicit database reaches the query layer with exactly that db_id. If the
    # negative test above ever turns mock-echo, this one catches it.
    query_calls, completion_calls, processed, queued = _run_scripted_ai_run(
        tmp_path, monkeypatch, explicit_database_id=FOREIGN_VALID_DB, db_file="ai_handoff_valid.db",
    )

    assert processed is True
    assert query_calls == [{"search_term": "WS-42", "db_id": FOREIGN_VALID_DB}]


def test_enqueue_execute_handoff_absent_database_id_positive_control(tmp_path, monkeypatch):
    # Second positive control: no explicit id at all -> normal fall-through chain
    # still resolves and queries exactly one database. The fresh user has neither
    # assigned nor pinned database, so the resolution lands on the configured
    # default (test env: test_db — get_available_database_options always includes
    # config.database.database, see tools/context.py get_available_database_options).
    query_calls, completion_calls, processed, queued = _run_scripted_ai_run(
        tmp_path, monkeypatch, explicit_database_id=None, db_file="ai_handoff_absent.db",
    )

    assert processed is True
    assert len(query_calls) == 1
    assert query_calls[0]["db_id"] == "test_db"


# ---------------------------------------------------------------------------
# UNSAFE-2 regression: WOL MAC enrichment must not hit the DEFAULT database when
# the effective database is unresolved (dangling assignment / denied explicit id).
# ---------------------------------------------------------------------------


def test_wol_draft_identifier_no_sql_when_effective_database_unresolved(monkeypatch):
    _patch_ai_tool_database_catalog(monkeypatch)
    network_module = importlib.import_module("backend.ai_chat.tools.network")

    sql_calls: list[str] = []

    def fake_resolve(**kwargs):
        sql_calls.append("resolve_pc_context")
        return None

    def fake_get_by_inv(inv_no, db_id=None):
        sql_calls.append("get_equipment_by_inv")
        return None

    monkeypatch.setattr("backend.database.queries.resolve_pc_context_by_mac_or_hostname", fake_resolve)
    monkeypatch.setattr("backend.database.queries.get_equipment_by_inv", fake_get_by_inv)

    context = _make_context(role="viewer", effective_database_id=None)
    result = network_module.NetworkWolDraftTool().execute(
        context=context,
        args=network_module.NetworkWolDraftArgs(identifier="WS-42"),
    ).to_payload()

    assert result["ok"] is False
    assert "MAC" in str(result["error"])
    assert sql_calls == [], (
        "with no resolved effective database the WOL enrichment must not query even the default database"
    )


def test_wol_draft_identifier_queries_resolved_database_positive_control(monkeypatch):
    # Positive control: with a resolved effective database the enrichment path IS
    # exercised (conductivity proof for the negative test above). The fakes return
    # nothing, so no card is created and no appdb access is needed.
    _patch_ai_tool_database_catalog(monkeypatch)
    network_module = importlib.import_module("backend.ai_chat.tools.network")

    sql_calls: list[str] = []

    def fake_resolve(**kwargs):
        sql_calls.append("resolve_pc_context:" + str(kwargs.get("db_id") or ""))
        return None

    def fake_get_by_inv(inv_no, db_id=None):
        sql_calls.append("get_equipment_by_inv:" + str(db_id or ""))
        return None

    monkeypatch.setattr("backend.database.queries.resolve_pc_context_by_mac_or_hostname", fake_resolve)
    monkeypatch.setattr("backend.database.queries.get_equipment_by_inv", fake_get_by_inv)

    context = _make_context(role="viewer", effective_database_id=HOME_DB)
    result = network_module.NetworkWolDraftTool().execute(
        context=context,
        args=network_module.NetworkWolDraftArgs(identifier="WS-42"),
    ).to_payload()

    assert result["ok"] is False  # nothing found -> controlled error before card creation
    assert sql_calls == [
        "resolve_pc_context:" + HOME_DB,
        "get_equipment_by_inv:" + HOME_DB,
    ]


# ---------------------------------------------------------------------------
# it_reports ActsPending regression: unresolved effective database -> controlled
# error instead of widening the reminder query to ALL databases.
# ---------------------------------------------------------------------------


def test_acts_pending_no_query_when_effective_database_unresolved(monkeypatch):
    _patch_ai_tool_database_catalog(monkeypatch)
    it_reports_module = importlib.import_module("backend.ai_chat.tools.it_reports")

    reminder_calls: list[str] = []

    def fake_list_open_reminders(*, db_id=None, **kwargs):
        reminder_calls.append(str(db_id or ""))
        return []

    monkeypatch.setattr(
        "backend.services.transfer_act_reminder_service.transfer_act_reminder_service.list_open_reminders",
        fake_list_open_reminders,
    )

    context = _make_context(role="viewer", effective_database_id=None)
    result = it_reports_module.ActsPendingTool().execute(
        context=context,
        args=it_reports_module.ActsPendingArgs(),
    ).to_payload()

    assert result["ok"] is False
    assert reminder_calls == [], (
        "db_id=None widens list_open_reminders to every database — it must not be called at all"
    )


# ---------------------------------------------------------------------------
# A11 §3 confirm-time database revalidation: the draft scope must be re-checked
# against the CURRENT catalog / user assignment / bot multi-db targets before
# any SQL or JSON mutation. A scope that was valid at draft time but is no
# longer valid at confirm time must produce a controlled ``failed`` card with
# ZERO mutation calls.
# ---------------------------------------------------------------------------


def _patch_dynamic_ai_catalog(monkeypatch, catalog_rows):
    """Patch the AI tool catalog to re-read ``catalog_rows`` on every call.

    Mutating the list in place between draft creation and confirm simulates a
    database being removed from the catalog mid-flight.
    """
    tools_context_module = importlib.import_module("backend.ai_chat.tools.context")
    monkeypatch.setattr(
        tools_context_module,
        "get_all_db_configs",
        lambda: list(catalog_rows),
    )


def _pin_default_test_database(monkeypatch):
    """Pin ``config.database.database`` so the catalog composition is deterministic.

    ``backend.config`` is a frozen import-time singleton and the configured
    default database is always part of the AI catalog options. Depending on
    which test module imported it first in a shared pytest process, the ambient
    value may be the production one instead of ``test_db`` — the confirm-time
    tests must not depend on import order.
    """
    tools_context_module = importlib.import_module("backend.ai_chat.tools.context")
    monkeypatch.setattr(tools_context_module.config.database, "database", "test_db", raising=False)


def _make_confirm_user(*, role="viewer", assigned_database=None, permissions=None):
    effective_permissions = permissions if permissions is not None else ["database.write"]
    return SimpleNamespace(
        id=99,
        username="operator_user",
        full_name="Operator User",
        role=role,
        is_active=True,
        permissions=effective_permissions,
        use_custom_permissions=True,
        custom_permissions=effective_permissions,
        assigned_database=assigned_database,
        telegram_id=None,
    )


def _create_transfer_card(action_cards, *, database_id, run_id="run-confirm"):
    return action_cards.create_pending_action(
        action_type=action_cards.ACTION_TRANSFER,
        conversation_id="conv-confirm-scope",
        run_id=run_id,
        requester_user_id=99,
        database_id=database_id,
        payload={"inv_nos": ["101"], "new_employee": "New Owner", "new_employee_no": 55},
        preview={"title": "Передача оборудования", "summary": "Передать 1 поз."},
    )


def _patch_transfer_recorder(monkeypatch, action_cards):
    calls: list[dict[str, object]] = []

    def fake_execute(**kwargs):
        calls.append(kwargs)
        return {
            "success_count": 1,
            "failed_count": 0,
            "transferred": [{"inv_no": "101", "hist_id": 77}],
            "failed": [],
            "acts": [],
            "upload_reminder_created": False,
            "upload_reminder_task_id": None,
            "upload_reminder_id": None,
            "upload_reminder_warning": None,
            "upload_reminder_controller_username": None,
            "upload_reminder_controller_fallback_used": False,
        }

    monkeypatch.setattr(action_cards, "execute_equipment_transfer", fake_execute)
    return calls


def test_confirm_fails_closed_when_database_removed_from_catalog_after_draft(tmp_path, monkeypatch):
    # The draft was created for ITINVENT while it was a valid catalog entry;
    # by confirm time ITINVENT is gone. The mutation must never run — even
    # though the user's assignment still names ITINVENT verbatim.
    database_url = _configure_local_backend_runtime(tmp_path, monkeypatch, "ai_confirm_catalog_removed.db")
    catalog_rows = [
        {"id": "ITINVENT", "name": "ITINVENT"},
        {"id": "OBJ-ITINVENT", "name": "OBJ-ITINVENT"},
    ]
    _patch_dynamic_ai_catalog(monkeypatch, catalog_rows)
    _pin_default_test_database(monkeypatch)
    appdb_db = importlib.import_module("backend.appdb.db")
    action_cards = importlib.import_module("backend.ai_chat.action_cards")

    appdb_db.initialize_app_schema(database_url)
    card = _create_transfer_card(action_cards, database_id="ITINVENT")
    transfer_calls = _patch_transfer_recorder(monkeypatch, action_cards)

    # The database disappears from the catalog between draft and confirm.
    catalog_rows[:] = [{"id": "OBJ-ITINVENT", "name": "OBJ-ITINVENT"}]

    confirmed = action_cards.confirm_action(
        action_id=card["id"],
        current_user=_make_confirm_user(assigned_database="ITINVENT"),
    )

    assert confirmed["status"] == "failed"
    error_text = str(confirmed["error_text"]).lower()
    assert "недоступна" in error_text or "удалена" in error_text
    assert transfer_calls == [], "SQL mutation must not run when the draft database left the catalog"


def test_confirm_denies_non_admin_when_assignment_changed_after_draft(tmp_path, monkeypatch):
    # Card drafted for ITINVENT; at confirm time the user's effective database
    # is OBJ-ITINVENT. Strict equality fails -> controlled denial, no mutation.
    database_url = _configure_local_backend_runtime(tmp_path, monkeypatch, "ai_confirm_assignment_changed.db")
    _patch_ai_tool_database_catalog(monkeypatch)
    _pin_default_test_database(monkeypatch)
    appdb_db = importlib.import_module("backend.appdb.db")
    action_cards = importlib.import_module("backend.ai_chat.action_cards")

    appdb_db.initialize_app_schema(database_url)
    card = _create_transfer_card(action_cards, database_id="ITINVENT")
    transfer_calls = _patch_transfer_recorder(monkeypatch, action_cards)

    confirmed = action_cards.confirm_action(
        action_id=card["id"],
        current_user=_make_confirm_user(assigned_database="OBJ-ITINVENT"),
    )

    assert confirmed["status"] == "failed"
    assert "изменилось" in str(confirmed["error_text"]).lower() or "не совпадает" in str(confirmed["error_text"]).lower()
    assert transfer_calls == [], "SQL mutation must not run when the user assignment no longer matches the draft"


def test_confirm_non_admin_unchanged_assignment_positive_control(tmp_path, monkeypatch):
    # Positive control: same user, same assignment as at draft time -> the
    # confirm executes exactly once, scoped to the draft database. If the
    # negative tests above ever turn mock-echo, this one catches it.
    database_url = _configure_local_backend_runtime(tmp_path, monkeypatch, "ai_confirm_assignment_positive.db")
    _patch_ai_tool_database_catalog(monkeypatch)
    _pin_default_test_database(monkeypatch)
    appdb_db = importlib.import_module("backend.appdb.db")
    action_cards = importlib.import_module("backend.ai_chat.action_cards")

    appdb_db.initialize_app_schema(database_url)
    card = _create_transfer_card(action_cards, database_id="ITINVENT")
    transfer_calls = _patch_transfer_recorder(monkeypatch, action_cards)

    confirmed = action_cards.confirm_action(
        action_id=card["id"],
        current_user=_make_confirm_user(assigned_database="ITINVENT"),
    )

    assert confirmed["status"] == "confirmed"
    assert len(transfer_calls) == 1
    assert transfer_calls[0]["db_id"] == "ITINVENT"


def _seed_admin_multi_db_bot(appdb_db, app_models, database_url, *, allowed_databases):
    with appdb_db.app_session(database_url) as session:
        session.add(
            app_models.AppAiBot(
                id="bot-confirm-scope",
                slug="bot-confirm-scope",
                title="Confirm Scope Bot",
                tool_settings_json=json.dumps({
                    "multi_db_mode": "admin_multi_db",
                    "allowed_databases": list(allowed_databases),
                }),
            )
        )
        session.add(
            app_models.AppAiBotRun(
                id="run-confirm-scope",
                bot_id="bot-confirm-scope",
                conversation_id="conv-confirm-scope",
                user_id=99,
                trigger_message_id="msg-1",
                status="completed",
            )
        )


def test_confirm_admin_multi_db_denies_target_excluded_after_draft(tmp_path, monkeypatch):
    # The bot admin multi-db targets covered OBJ-ITINVENT at draft time; before
    # confirm the target list is narrowed to ITINVENT only. The confirm must be
    # denied even though the user is an admin and the database still exists.
    database_url = _configure_local_backend_runtime(tmp_path, monkeypatch, "ai_confirm_admin_target_excluded.db")
    _patch_ai_tool_database_catalog(monkeypatch)
    _pin_default_test_database(monkeypatch)
    appdb_db = importlib.import_module("backend.appdb.db")
    app_models = importlib.import_module("backend.appdb.models")
    action_cards = importlib.import_module("backend.ai_chat.action_cards")

    appdb_db.initialize_app_schema(database_url)
    _seed_admin_multi_db_bot(appdb_db, app_models, database_url, allowed_databases=["ITINVENT", "OBJ-ITINVENT"])
    card = _create_transfer_card(action_cards, database_id="OBJ-ITINVENT", run_id="run-confirm-scope")
    transfer_calls = _patch_transfer_recorder(monkeypatch, action_cards)

    # The target is excluded from the bot configuration between draft and confirm.
    with appdb_db.app_session(database_url) as session:
        bot = session.get(app_models.AppAiBot, "bot-confirm-scope")
        bot.tool_settings_json = json.dumps({
            "multi_db_mode": "admin_multi_db",
            "allowed_databases": ["ITINVENT"],
        })

    confirmed = action_cards.confirm_action(
        action_id=card["id"],
        current_user=_make_confirm_user(role="admin"),
    )

    assert confirmed["status"] == "failed"
    assert "targets" in str(confirmed["error_text"]).lower() or "разрешённые" in str(confirmed["error_text"]).lower()
    assert transfer_calls == [], "SQL mutation must not run when the database left the bot multi-db targets"


def test_confirm_admin_multi_db_target_retained_positive_control(tmp_path, monkeypatch):
    # Positive counterpart: OBJ-ITINVENT stays in the target list -> the same
    # confirm succeeds and the mutation is scoped exactly to the draft database.
    database_url = _configure_local_backend_runtime(tmp_path, monkeypatch, "ai_confirm_admin_target_retained.db")
    _patch_ai_tool_database_catalog(monkeypatch)
    _pin_default_test_database(monkeypatch)
    appdb_db = importlib.import_module("backend.appdb.db")
    app_models = importlib.import_module("backend.appdb.models")
    action_cards = importlib.import_module("backend.ai_chat.action_cards")

    appdb_db.initialize_app_schema(database_url)
    _seed_admin_multi_db_bot(appdb_db, app_models, database_url, allowed_databases=["ITINVENT", "OBJ-ITINVENT"])
    card = _create_transfer_card(action_cards, database_id="OBJ-ITINVENT", run_id="run-confirm-scope")
    transfer_calls = _patch_transfer_recorder(monkeypatch, action_cards)

    confirmed = action_cards.confirm_action(
        action_id=card["id"],
        current_user=_make_confirm_user(role="admin"),
    )

    assert confirmed["status"] == "confirmed"
    assert len(transfer_calls) == 1
    assert transfer_calls[0]["db_id"] == "OBJ-ITINVENT"


def test_confirm_works_uses_row_database_id_not_payload_db_name(tmp_path, monkeypatch):
    # Canonical scope is ``row.database_id``; ``payload["db_name"]`` is only a
    # legacy fallback. A card whose payload carries a divergent db_name must
    # execute against the row scope — the value confirm revalidation checked.
    database_url = _configure_local_backend_runtime(tmp_path, monkeypatch, "ai_confirm_works_canonical.db")
    _patch_ai_tool_database_catalog(monkeypatch)
    _pin_default_test_database(monkeypatch)
    appdb_db = importlib.import_module("backend.appdb.db")
    action_cards = importlib.import_module("backend.ai_chat.action_cards")

    appdb_db.initialize_app_schema(database_url)
    card = action_cards.create_pending_action(
        action_type=action_cards.ACTION_WORKS_CARTRIDGE,
        conversation_id="conv-works",
        run_id="run-works",
        requester_user_id=99,
        database_id="ITINVENT",
        payload={
            "db_name": "OBJ-ITINVENT",
            "inv_no": "P-100",
            "serial_number": "SN-100",
            "equipment_id": 100,
            "model_name": "Printer",
            "cartridge_color": "Черный",
        },
        preview={"title": "Замена картриджа", "summary": "P-100"},
    )

    captured: list[dict[str, object]] = []

    class FakeWorksManager:
        def __init__(self, *args, **kwargs):
            pass

        def add_cartridge_replacement(self, **kwargs):
            captured.append(kwargs)
            return {"id": "rec-1", "db_name": kwargs.get("db_name")}

    monkeypatch.setattr("backend.json_db.works.WorksManager", FakeWorksManager)

    confirmed = action_cards.confirm_action(
        action_id=card["id"],
        current_user=_make_confirm_user(assigned_database="ITINVENT"),
    )

    assert confirmed["status"] == "confirmed"
    assert len(captured) == 1
    assert captured[0]["db_name"] == "ITINVENT", (
        "works execution must use the confirm-validated row.database_id, not payload db_name"
    )
