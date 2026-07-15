from __future__ import annotations

import importlib
import sys
import copy
from pathlib import Path
from types import SimpleNamespace

import pytest


ROOT = Path(__file__).resolve().parents[1]
WEB_ROOT = ROOT / "WEB-itinvent"
if str(WEB_ROOT) not in sys.path:
    sys.path.insert(0, str(WEB_ROOT))

from bot.universal_database import DatabaseConfig, UniversalInventoryDB
from backend.database import queries as hub_queries


class _Cursor:
    def __init__(self, connection, rows, update_rowcount=1):
        self.connection = connection
        self.rows = list(rows)
        self.update_rowcount = update_rowcount
        self.rowcount = -1
        self._one = None

    def execute(self, query, *params):
        normalized = " ".join(str(query).lower().split())
        self.connection.queries.append((normalized, params))
        if "select top 2 id" in normalized and "from items" in normalized:
            self._one = None
        elif "select top 1 id" in normalized and "from items" in normalized:
            self._one = self.rows[0] if self.rows else None
        elif "from ci_history" in normalized and "charindex" in normalized:
            self._one = self.connection.replay_row
        elif "select isnull(max(hist_id)" in normalized:
            self._one = (41,)
        elif normalized.startswith("update items"):
            self.rowcount = self.update_rowcount
            self._one = None
        else:
            self._one = None
        return self

    def fetchall(self):
        return list(self.rows)

    def fetchone(self):
        return self._one

    def close(self):
        self.connection.cursor_closed = True


class _Connection:
    def __init__(self, rows, update_rowcount=1, replay_row=None):
        self.autocommit = True
        self.closed = False
        self.queries = []
        self.cursor_closed = False
        self.commits = 0
        self.rollbacks = 0
        self.replay_row = replay_row
        self.cursor_obj = _Cursor(self, rows, update_rowcount=update_rowcount)

    def cursor(self):
        return self.cursor_obj

    def commit(self):
        self.commits += 1

    def rollback(self):
        self.rollbacks += 1

    def close(self):
        self.closed = True


def _db_with_connection(monkeypatch, connection):
    db = UniversalInventoryDB(
        DatabaseConfig(server="server", database="database", username="user", password="password")
    )
    monkeypatch.setattr(db, "_get_connection", lambda: connection)
    return db


def _item_row(item_id=7, serial="SN-1", employee=10, branch=1, location=2):
    return (item_id, employee, branch, location, 3, serial, 1001, 4, 5, 1, 1)


def test_bot_transfer_rejects_ambiguous_serial_without_writes(monkeypatch):
    connection = _Connection([_item_row(7), _item_row(8)])
    db = _db_with_connection(monkeypatch, connection)

    result = db.transfer_equipment_with_history(
        serial_number="SN-1",
        new_employee_id=99,
        new_employee_name="New Owner",
    )

    assert result["success"] is False
    assert "нескольким" in result["message"]
    assert connection.commits == 0
    # A serial ambiguity is rejected during the read-only id resolution phase,
    # before a write transaction is opened.
    assert connection.rollbacks == 0
    assert connection.autocommit is True
    assert not any("insert into ci_history" in query for query, _ in connection.queries)


def test_bot_transfer_updates_exact_item_in_one_transaction(monkeypatch):
    connection = _Connection([_item_row()])
    db = _db_with_connection(monkeypatch, connection)

    result = db.transfer_equipment_with_history(
        serial_number="SN-1",
        new_employee_id=99,
        new_employee_name="New Owner",
        new_branch_no=8,
        new_loc_no=9,
    )

    assert result["success"] is True
    assert result["hist_id"] == 41
    assert connection.commits == 1
    assert connection.rollbacks == 0
    assert connection.autocommit is True
    update_query = next(query for query, _ in connection.queries if query.startswith("update items"))
    assert "where id = ? and ci_type = 1" in update_query


def test_bot_transfer_by_id_never_uses_display_serial_for_the_mutation(monkeypatch):
    connection = _Connection([_item_row(item_id=77, serial="CURRENT-SERIAL")])
    db = _db_with_connection(monkeypatch, connection)

    result = db.transfer_equipment_by_id_with_history(
        item_id=77,
        display_serial="REUSED-OLD-SERIAL",
        new_employee_id=99,
        new_employee_name="New Owner",
    )

    assert result["success"] is True
    item_read_query = next(
        query
        for query, _ in connection.queries
        if "select top 1 id" in query and "from items" in query
    )
    assert "and id = ?" in item_read_query
    assert "serial_no = ?" not in item_read_query


def test_bot_transfer_rolls_back_history_when_item_update_fails(monkeypatch):
    connection = _Connection([_item_row()], update_rowcount=0)
    db = _db_with_connection(monkeypatch, connection)

    result = db.transfer_equipment_with_history(
        serial_number="SN-1",
        new_employee_id=99,
        new_employee_name="New Owner",
    )

    assert result["success"] is False
    assert connection.commits == 0
    assert connection.rollbacks == 1
    assert any("insert into ci_history" in query for query, _ in connection.queries)


def test_bot_transfer_replays_same_operation_without_second_history_or_item_update(monkeypatch):
    connection = _Connection(
        [_item_row(employee=99, branch=8, location=9)],
        replay_row=(40, 10, 99, 8, 9),
    )
    db = _db_with_connection(monkeypatch, connection)

    result = db.transfer_equipment_with_history(
        serial_number="SN-1",
        new_employee_id=99,
        new_employee_name="New Owner",
        new_branch_no=8,
        new_loc_no=9,
        operation_id="bot-op-replay-001",
    )

    assert result["success"] is True
    assert result["replayed"] is True
    assert result["hist_id"] == 40
    assert result["old_employee_id"] == 10
    assert connection.commits == 1
    assert not any("insert into ci_history" in query for query, _ in connection.queries)
    assert not any(query.startswith("update items") for query, _ in connection.queries)


def test_bot_transfer_rejects_operation_id_reused_for_another_target(monkeypatch):
    connection = _Connection(
        [_item_row(employee=99, branch=8, location=9)],
        replay_row=(40, 10, 98, 8, 9),
    )
    db = _db_with_connection(monkeypatch, connection)

    result = db.transfer_equipment_with_history(
        serial_number="SN-1",
        new_employee_id=99,
        new_employee_name="New Owner",
        new_branch_no=8,
        new_loc_no=9,
        operation_id="bot-op-replay-001",
    )

    assert result["success"] is False
    assert "operation_id" in result["message"]
    assert connection.commits == 0
    assert connection.rollbacks == 1
    assert not any("insert into ci_history" in query for query, _ in connection.queries)


class _HandlerBot:
    def __init__(self):
        self.messages = []

    async def send_message(self, **kwargs):
        self.messages.append(kwargs)


class _MemoryOperationStore:
    """Small durable-store double for bot handler tests."""

    def __init__(self):
        self.records = {}

    def get(self, operation_id):
        value = self.records.get(operation_id)
        return copy.deepcopy(value) if value is not None else None

    def create_or_get(self, operation_id, payload):
        if operation_id not in self.records:
            self.records[operation_id] = {
                "operation_id": operation_id,
                "status": "resolved",
                "payload": copy.deepcopy(payload),
                "acts": [],
                "ledger_written": False,
            }
        return self.get(operation_id)

    def checkpoint(self, operation_id, *, status=None, **values):
        record = self.records[operation_id]
        if status is not None:
            record["status"] = status
        record.update(copy.deepcopy(values))
        return self.get(operation_id)


class _HandlerQuery:
    def __init__(self):
        self.data = "confirm_transfer"
        self.message = SimpleNamespace(chat_id=77)
        self.edits = []

    async def answer(self):
        return None

    async def edit_message_text(self, text, **kwargs):
        self.edits.append((text, kwargs))


class _HandlerTransferDb:
    def __init__(self):
        self.calls = []
        self.closed = False

    def get_owner_no_by_name(self, name, strict=True):
        return 99

    def get_branch_no_by_name(self, name):
        return 8

    def get_loc_no_by_descr(self, name):
        return 9

    def resolve_transfer_item_by_serial(self, serial_number):
        return {
            "success": True,
            "item_id": {"SN-OK": 101, "SN-FAIL": 102}.get(serial_number, 999),
            "serial_number": serial_number,
        }

    def resolve_transfer_item_by_id(self, item_id):
        return {"success": True, "item_id": int(item_id), "serial_number": f"SN-{item_id}"}

    def transfer_equipment_by_id_with_history(self, *, item_id, **kwargs):
        serial_number = kwargs.get("display_serial")
        self.calls.append((item_id, kwargs))
        if serial_number == "SN-FAIL":
            return {"success": False, "message": "blocked"}
        return {"success": True, "message": "Transferred"}

    def close_connection(self):
        self.closed = True


@pytest.mark.asyncio
async def test_bot_withholds_act_and_json_ledger_when_group_transfer_fails(monkeypatch, tmp_path):
    handler = importlib.import_module("bot.handlers.transfer")
    pdf_generator = importlib.import_module("bot.services.pdf_generator")
    pdf_path = tmp_path / "act.pdf"
    pdf_path.write_bytes(b"%PDF-1.4")
    transfer_db = _HandlerTransferDb()
    ledger = []
    sent_documents = []

    async def fake_generate(**kwargs):
        return [
            {
                "success": True,
                "pdf_path": str(pdf_path),
                "filename": "act.pdf",
                "old_employee": "Old Owner",
                "equipment_count": 2,
            }
        ]

    async def fake_send_document(**kwargs):
        sent_documents.append(kwargs)
        return True

    monkeypatch.setattr(pdf_generator, "generate_multiple_transfer_acts", fake_generate)
    monkeypatch.setattr(handler.database_manager, "get_user_database", lambda user_id: "main")
    monkeypatch.setattr(handler.database_manager, "create_database_connection", lambda user_id: transfer_db)
    monkeypatch.setattr(handler, "send_document_with_retry", fake_send_document)
    monkeypatch.setattr(handler.equipment_manager, "add_equipment_transfer", lambda **kwargs: ledger.append(kwargs))
    monkeypatch.setattr(handler, "transfer_operation_store", _MemoryOperationStore())

    query = _HandlerQuery()
    bot = _HandlerBot()
    update = SimpleNamespace(callback_query=query, effective_user=SimpleNamespace(id=1), message=None)
    context = SimpleNamespace(
        bot=bot,
        user_data={
            "grouped_equipment": {
                "Old Owner": [
                    {"serial": "SN-OK", "equipment": {}},
                    {"serial": "SN-FAIL", "equipment": {}},
                ]
            },
            "new_employee": "New Owner",
            "new_employee_dept": "IT",
            "new_branch": "Branch",
            "new_location": "Office",
        },
    )

    await handler.handle_transfer_confirmation.__wrapped__(update, context)

    assert [kwargs["display_serial"] for _, kwargs in transfer_db.calls] == ["SN-OK", "SN-FAIL"]
    assert transfer_db.closed is True
    assert sent_documents == []
    assert ledger == []


@pytest.mark.asyncio
async def test_bot_global_partial_result_withholds_docs_for_other_confirmed_groups(monkeypatch, tmp_path):
    """A failed serial suppresses acts and the ledger for the whole bot command."""

    handler = importlib.import_module("bot.handlers.transfer")
    pdf_generator = importlib.import_module("bot.services.pdf_generator")
    transfer_db = _HandlerTransferDb()
    ledger = []
    generated = []
    sent_documents = []

    async def fake_generate(**kwargs):
        generated.append(kwargs)
        return []

    async def fake_send_document(**kwargs):
        sent_documents.append(kwargs)
        return True

    monkeypatch.setattr(pdf_generator, "generate_multiple_transfer_acts", fake_generate)
    monkeypatch.setattr(handler.database_manager, "get_user_database", lambda user_id: "main")
    monkeypatch.setattr(handler.database_manager, "create_database_connection", lambda user_id: transfer_db)
    monkeypatch.setattr(handler, "send_document_with_retry", fake_send_document)
    monkeypatch.setattr(handler, "_has_recorded_transfer_operation", lambda operation_id: False)
    monkeypatch.setattr(handler.equipment_manager, "add_equipment_transfer", lambda **kwargs: ledger.append(kwargs))
    monkeypatch.setattr(handler, "transfer_operation_store", _MemoryOperationStore())

    query = _HandlerQuery()
    bot = _HandlerBot()
    update = SimpleNamespace(callback_query=query, effective_user=SimpleNamespace(id=1), message=None)
    context = SimpleNamespace(
        bot=bot,
        user_data={
            handler.TRANSFER_OPERATION_ID_KEY: "bot-global-partial-0001",
            handler.TRANSFER_OPERATION_STATE_KEY: "draft",
            "grouped_equipment": {
                "Old Owner A": [{"serial": "SN-OK", "equipment": {}}],
                "Old Owner B": [{"serial": "SN-FAIL", "equipment": {}}],
            },
            "new_employee": "New Owner",
            "new_employee_dept": "IT",
            "new_branch": "Branch",
            "new_location": "Office",
            # A stale previous value must not survive a partial command.
            "act_files_info": {"acts": [{"act_id": "previous"}]},
        },
    )

    await handler.handle_transfer_confirmation.__wrapped__(update, context)

    assert [kwargs["display_serial"] for _, kwargs in transfer_db.calls] == ["SN-OK", "SN-FAIL"]
    assert generated == []
    assert sent_documents == []
    assert ledger == []
    assert context.user_data[handler.TRANSFER_RETRY_SERIALS_KEY] == ["SN-FAIL"]
    assert "act_files_info" not in context.user_data
    result_text = bot.messages[-1]["text"]
    assert "SN-FAIL" in result_text
    assert "SN-OK" not in result_text


def test_web_transfer_withholds_acts_for_partial_sql_result(monkeypatch):
    service = importlib.import_module("backend.services.equipment_transfer_execution_service")
    generated = []
    reminders = []
    invalidated = []

    monkeypatch.setattr(
        service.queries,
        "get_owner_by_no",
        lambda owner_no, db_id=None: {"OWNER_NO": owner_no, "OWNER_DISPLAY_NAME": "New Owner", "OWNER_DEPT": "IT"},
    )
    monkeypatch.setattr(service.queries, "get_owner_email_by_no", lambda owner_no, db_id=None: None)

    calls = []

    def fake_transfer(**kwargs):
        calls.append(kwargs)
        if kwargs["inv_no"] == "1002":
            return {"success": False, "message": "blocked"}
        return {
            "success": True,
            "inv_no": kwargs["inv_no"],
            "old_employee_no": 1,
            "old_employee_name": "Old Owner",
        }

    monkeypatch.setattr(service.queries, "transfer_equipment_by_inv_with_history", fake_transfer)
    monkeypatch.setattr(service, "generate_transfer_acts", lambda **kwargs: generated.append(kwargs) or [{"act_id": "act-1"}])
    monkeypatch.setattr(
        service.transfer_act_reminder_service,
        "create_transfer_reminder",
        lambda **kwargs: reminders.append(kwargs) or {"created": True},
    )
    monkeypatch.setattr(service, "invalidate_equipment_cache", lambda db_id=None: invalidated.append(db_id))

    result = service.execute_equipment_transfer(
        payload={
            "inv_nos": ["1001", "1002"],
            "new_employee": "New Owner",
            "new_employee_no": 99,
            "operation_id": "web-partial-op-001",
        },
        db_id="main",
        current_user=SimpleNamespace(username="operator"),
    )

    assert result["success_count"] == 1
    assert result["failed_count"] == 1
    assert result["retry_inv_nos"] == ["1002"]
    assert result["acts"] == []
    assert generated == []
    assert reminders == []
    assert invalidated == ["main"]
    assert {call["operation_id"] for call in calls} == {"web-partial-op-001"}


def test_web_transfer_recovery_reuses_checkpointed_acts_and_reminder(monkeypatch):
    service = importlib.import_module("backend.services.equipment_transfer_execution_service")
    generator_calls = []
    reminder_calls = []
    checkpoints = []

    monkeypatch.setattr(
        service.queries,
        "get_owner_by_no",
        lambda owner_no, db_id=None: {
            "OWNER_NO": owner_no,
            "OWNER_DISPLAY_NAME": "New Owner",
            "OWNER_DEPT": "IT",
        },
    )
    monkeypatch.setattr(service.queries, "get_owner_email_by_no", lambda owner_no, db_id=None: None)
    monkeypatch.setattr(
        service.queries,
        "transfer_equipment_by_inv_with_history",
        lambda **kwargs: {
            "success": True,
            "inv_no": kwargs["inv_no"],
            "old_employee_no": 1,
            "old_employee_name": "Old Owner",
            "replayed": True,
        },
    )
    monkeypatch.setattr(
        service,
        "generate_transfer_acts",
        lambda **kwargs: generator_calls.append(kwargs) or [{"act_id": "new-act"}],
    )
    monkeypatch.setattr(
        service.transfer_act_reminder_service,
        "create_transfer_reminder",
        lambda **kwargs: reminder_calls.append(kwargs) or {"created": True},
    )
    monkeypatch.setattr(service, "get_act_records", lambda act_ids: [{"act_id": act_id} for act_id in act_ids])
    monkeypatch.setattr(service, "invalidate_equipment_cache", lambda db_id=None: None)

    result = service.execute_equipment_transfer(
        payload={
            "inv_nos": ["1001"],
            "new_employee": "New Owner",
            "new_employee_no": 99,
            "operation_id": "web-recovery-acts-001",
        },
        db_id="main",
        current_user=SimpleNamespace(username="operator"),
        recovered_result={
            "acts": [{"act_id": "stable-act", "old_employee": "Old Owner"}],
            "_act_records": [{"act_id": "stable-act", "file_path": "C:/acts/stable.docx"}],
            "upload_reminder_created": True,
            "upload_reminder_task_id": "task-1",
            "upload_reminder_id": "reminder-1",
        },
        checkpoint=lambda stage: checkpoints.append(stage),
    )

    assert result["acts"] == [{"act_id": "stable-act", "old_employee": "Old Owner"}]
    assert result["upload_reminder_created"] is True
    assert result["upload_reminder_task_id"] == "task-1"
    assert generator_calls == []
    assert reminder_calls == []
    assert checkpoints[-1]["_act_records"] == [{"act_id": "stable-act"}]


def test_operation_scoped_act_identity_is_stable_for_recovery():
    transfer_service = importlib.import_module("backend.services.transfer_service")
    items = [{"inv_no": "1001"}, {"inv_no": "1002"}]

    first = transfer_service._operation_act_id(
        operation_id="web-recovery-acts-001",
        mode="inventory_transfer",
        db_id="main",
        old_employee="Old Owner",
        new_employee="New Owner",
        items=items,
    )
    recovered = transfer_service._operation_act_id(
        operation_id="web-recovery-acts-001",
        mode="inventory_transfer",
        db_id="main",
        old_employee="Old Owner",
        new_employee="New Owner",
        items=list(reversed(items)),
    )

    assert first == recovered


def test_transfer_job_marks_partial_transfer_done_with_no_acts(monkeypatch):
    equipment_api = importlib.import_module("backend.api.v1.equipment")
    marked = {}
    captured = {}

    def fake_execute(**kwargs):
        captured.update(kwargs)
        return {
            "success_count": 1,
            "failed_count": 1,
            "transferred": [{"inv_no": "1001"}],
            "failed": [{"inv_no": "1002", "error": "blocked"}],
            "acts": [],
        }

    monkeypatch.setattr(equipment_api, "execute_equipment_transfer", fake_execute)
    monkeypatch.setattr(equipment_api.transfer_act_job_service, "claim_for_execution", lambda *args, **kwargs: True)
    monkeypatch.setattr(
        equipment_api.transfer_act_job_service,
        "mark_done",
        lambda job_id, result, status_text=None: marked.update(
            {"job_id": job_id, "result": result, "status_text": status_text}
        ),
    )
    monkeypatch.setattr(equipment_api.transfer_act_job_service, "mark_failed", lambda *args, **kwargs: pytest.fail("partial job must stay refreshable"))
    monkeypatch.setattr(equipment_api, "_touch_recent_card_safely", lambda **kwargs: None)

    equipment_api._run_transfer_job(
        job_id="job-1",
        payload=SimpleNamespace(inv_nos=["1001", "1002"]),
        db_id="main",
        current_user=SimpleNamespace(username="operator"),
    )

    assert marked["job_id"] == "job-1"
    assert marked["result"]["acts"] == []
    assert marked["status_text"] == "Перемещение выполнено частично; акты не созданы"
    captured_payload = captured["payload"]
    captured_operation_id = (
        captured_payload.get("operation_id")
        if isinstance(captured_payload, dict)
        else getattr(captured_payload, "operation_id", None)
    )
    assert captured_operation_id == "job-1"


class _HubReplayCursor:
    _columns = [
        "ID", "INV_NO", "SERIAL_NO", "HW_SERIAL_NO", "PART_NO",
        "EMPL_NO", "BRANCH_NO", "LOC_NO", "STATUS_NO", "TYPE_NO",
        "MODEL_NO", "CI_TYPE", "QTY", "OLD_EMPLOYEE_NAME", "BRANCH_NAME",
        "LOCATION_NAME", "TYPE_NAME", "MODEL_NAME",
    ]

    def __init__(self, connection, replay_row):
        self.connection = connection
        self.replay_row = replay_row
        self.description = [(name,) for name in self._columns]
        self._one = None
        self.rowcount = -1

    def execute(self, query, params=()):
        normalized = " ".join(str(query).lower().split())
        self.connection.queries.append((normalized, params))
        if "select top 2" in normalized and "from items i" in normalized:
            self._one = None
        elif "from ci_history h" in normalized and "charindex" in normalized:
            self._one = self.replay_row
        else:
            raise AssertionError(f"unexpected SQL in replay test: {normalized}")
        return self

    def fetchall(self):
        return [
            (
                7, 1001, "SN-1", "HW-1", "PN-1", 99, 8, 9, 3, 4, 5, 1, 1,
                "Current Owner", "Branch 8", "Location 9", "Notebook", "Model X",
            )
        ]

    def fetchone(self):
        return self._one


class _HubReplayConnection:
    def __init__(self, replay_row):
        self.queries = []
        self.cursor_obj = _HubReplayCursor(self, replay_row)

    def __enter__(self):
        return self

    def __exit__(self, exc_type, exc, tb):
        return False

    def cursor(self):
        return self.cursor_obj


class _HubReplayDb:
    def __init__(self, connection):
        self.connection = connection

    def get_connection(self):
        return self.connection


def test_web_sql_transfer_replays_committed_operation_without_second_history(monkeypatch):
    connection = _HubReplayConnection((41, 10, 99, 8, 9, "Old Owner"))
    monkeypatch.setattr(hub_queries, "get_db", lambda db_id=None: _HubReplayDb(connection))

    result = hub_queries.transfer_equipment_by_inv_with_history(
        inv_no="1001",
        new_employee_no=99,
        new_employee_name="New Owner",
        new_branch_no=8,
        new_loc_no=9,
        operation_id="web-replay-op-001",
        db_id="main",
    )

    assert result["success"] is True
    assert result["replayed"] is True
    assert result["hist_id"] == 41
    assert result["old_employee_no"] == 10
    assert result["old_employee_name"] == "Old Owner"
    assert not any("insert into ci_history" in query for query, _ in connection.queries)
    assert not any(query.startswith("update items") for query, _ in connection.queries)


def test_web_sql_transfer_rejects_reused_operation_for_another_target(monkeypatch):
    connection = _HubReplayConnection((41, 10, 98, 8, 9, "Old Owner"))
    monkeypatch.setattr(hub_queries, "get_db", lambda db_id=None: _HubReplayDb(connection))

    result = hub_queries.transfer_equipment_by_inv_with_history(
        inv_no="1001",
        new_employee_no=99,
        new_employee_name="New Owner",
        new_branch_no=8,
        new_loc_no=9,
        operation_id="web-replay-op-001",
        db_id="main",
    )

    assert result["success"] is False
    assert "operation_id" in result["message"]
    assert not any("insert into ci_history" in query for query, _ in connection.queries)


def test_transfer_job_response_retries_only_explicit_failed_items(monkeypatch):
    service = importlib.import_module("backend.services.transfer_act_job_service")
    monkeypatch.setattr(service, "_app_db_available", lambda: False)
    service._memory_jobs.clear()
    user = SimpleNamespace(id=15, username="operator")
    job = service.create_job(
        operation="transfer",
        payload={"inv_nos": ["1001", "1002"]},
        db_id="main",
        user=user,
        request_count=2,
        operation_id="web-retry-failed-0001",
    )
    service.mark_done(
        job["id"],
        {
            "success_count": 1,
            "failed_count": 1,
            "transferred": [{"inv_no": "1001"}],
            "failed": [{"inv_no": "1002", "error": "blocked"}],
            # This field is intentionally ignored in favor of failed rows.
            "retry_inv_nos": ["1001", "1002"],
            "acts": [],
        },
    )

    assert service.response_payload(job["id"])["retry_inv_nos"] == ["1002"]
