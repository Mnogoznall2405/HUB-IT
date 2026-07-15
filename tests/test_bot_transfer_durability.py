from __future__ import annotations

import copy
import importlib
from types import SimpleNamespace

import pytest


class _Query:
    def __init__(self, data: str) -> None:
        self.data = data
        self.message = SimpleNamespace(chat_id=77)
        self.edits: list[tuple[str, dict]] = []

    async def answer(self) -> None:
        return None

    async def edit_message_text(self, text: str, **kwargs) -> None:
        self.edits.append((text, kwargs))


class _Bot:
    def __init__(self) -> None:
        self.messages: list[dict] = []

    async def send_message(self, **kwargs) -> None:
        self.messages.append(kwargs)


class _MemoryOperationStore:
    def __init__(self) -> None:
        self.records: dict[str, dict] = {}

    def get(self, operation_id: str):
        record = self.records.get(operation_id)
        return copy.deepcopy(record) if record is not None else None

    def create_or_get(self, operation_id: str, payload: dict):
        self.records.setdefault(
            operation_id,
            {
                "operation_id": operation_id,
                "status": "resolved",
                "payload": copy.deepcopy(payload),
                "acts": [],
                "ledger_written": False,
            },
        )
        return self.get(operation_id)

    def checkpoint(self, operation_id: str, *, status: str | None = None, **values):
        record = self.records[operation_id]
        if status is not None:
            record["status"] = status
        record.update(copy.deepcopy(values))
        return self.get(operation_id)


class _ResolveBeforeWriteDb:
    def __init__(self) -> None:
        self.events: list[tuple[str, str]] = []
        self.closed = False

    def get_owner_no_by_name(self, name, strict=True):
        return 99

    def get_branch_no_by_name(self, name):
        return 8

    def get_loc_no_by_descr(self, name):
        return 9

    def resolve_transfer_item_by_serial(self, serial):
        self.events.append(("resolve", serial))
        if serial == "SN-MISSING":
            return {"success": False, "message": "not found"}
        return {"success": True, "item_id": 101, "serial_number": serial}

    def resolve_transfer_item_by_id(self, item_id):
        self.events.append(("resolve-id", str(item_id)))
        return {"success": True, "item_id": int(item_id), "serial_number": "SN-OK"}

    def transfer_equipment_by_id_with_history(self, **kwargs):
        self.events.append(("transfer", str(kwargs["item_id"])))
        pytest.fail("a preflight resolution failure must prevent every mutation")

    def close_connection(self):
        self.closed = True


def test_bot_operation_journal_rejects_reused_id_and_persists_checkpoints(monkeypatch):
    module = importlib.import_module("bot.services.transfer_operation_store")
    persisted: dict[str, dict] = {}
    monkeypatch.setattr(module, "load_json_data", lambda filename, default_content: copy.deepcopy(persisted or default_content))
    monkeypatch.setattr(
        module,
        "save_json_data",
        lambda filename, data: persisted.clear() or persisted.update(copy.deepcopy(data)) or True,
    )
    store = module.BotTransferOperationStore("test_bot_transfer_operations.json")
    payload = _operation_payload()

    first = store.create_or_get("bot-journal-001", payload)
    second = store.create_or_get("bot-journal-001", payload)
    assert first["operation_id"] == second["operation_id"]

    changed = copy.deepcopy(payload)
    changed["items"] = [{"item_id": 8, "serial": "SN-2", "old_employee": "Old Owner"}]
    with pytest.raises(module.TransferOperationConflict):
        store.create_or_get("bot-journal-001", changed)

    checkpoint = store.checkpoint("bot-journal-001", status="acts_ready", acts=[{"delivery_status": "pending"}])
    assert checkpoint["status"] == "acts_ready"
    assert store.get("bot-journal-001")["acts"] == [{"delivery_status": "pending"}]


def _operation_payload() -> dict:
    group = {
        "Old Owner": [
            {
                "serial": "SN-1",
                "item_id": 7,
                "equipment": {"ID": 7, "SERIAL_NO": "SN-1"},
            }
        ]
    }
    return {
        "chat_id": 77,
        "db_name": "main",
        "new_employee": "New Owner",
        "new_employee_dept": "IT",
        "new_employee_id": 99,
        "new_branch": "Branch",
        "new_branch_no": 8,
        "new_location": "Office",
        "new_loc_no": 9,
        "grouped_equipment": group,
        "items": [{"item_id": 7, "serial": "SN-1", "old_employee": "Old Owner"}],
    }


@pytest.mark.asyncio
async def test_bot_resolves_every_item_id_before_any_mutation(monkeypatch):
    handler = importlib.import_module("bot.handlers.transfer")
    db = _ResolveBeforeWriteDb()
    store = _MemoryOperationStore()
    ledger: list[dict] = []
    monkeypatch.setattr(handler, "transfer_operation_store", store)
    monkeypatch.setattr(handler.database_manager, "get_user_database", lambda user_id: "main")
    monkeypatch.setattr(handler.database_manager, "create_database_connection", lambda user_id: db)
    monkeypatch.setattr(
        handler.equipment_manager,
        "add_transfer_operation_entries_once",
        lambda entries: ledger.extend(entries) or True,
    )

    query = _Query("confirm_transfer:bot-preflight-id-001")
    context = SimpleNamespace(
        bot=_Bot(),
        user_data={
            "grouped_equipment": {
                "Old Owner": [{"serial": "SN-OK", "equipment": {}}],
                "Other Owner": [{"serial": "SN-MISSING", "equipment": {}}],
            },
            "new_employee": "New Owner",
            "new_employee_dept": "IT",
            "new_branch": "Branch",
            "new_location": "Office",
        },
    )
    update = SimpleNamespace(callback_query=query, effective_user=SimpleNamespace(id=1), message=None)

    await handler.handle_transfer_confirmation.__wrapped__(update, context)

    assert db.events == [("resolve", "SN-OK"), ("resolve", "SN-MISSING")]
    assert db.closed is True
    assert ledger == []


@pytest.mark.asyncio
async def test_bot_recovers_sent_acts_by_writing_ledger_once_without_resend(monkeypatch):
    handler = importlib.import_module("bot.handlers.transfer")
    operation_id = "bot-recovery-after-send-001"
    store = _MemoryOperationStore()
    payload = _operation_payload()
    ledger_entries = [
        {
            "serial_number": "SN-1",
            "new_employee": "New Owner",
            "old_employee": "Old Owner",
            "item_id": 7,
            "operation_id": operation_id,
            "additional_data": {"operation_id": operation_id, "item_id": 7},
            "act_pdf_path": "transfer_acts/reused.pdf",
        }
    ]
    store.records[operation_id] = {
        "operation_id": operation_id,
        "status": "acts_ready",
        "payload": payload,
        "acts": [
            {
                "success": True,
                "old_employee": "Old Owner",
                "pdf_path": "transfer_acts/reused.pdf",
                "filename": "reused.pdf",
                "equipment_count": 1,
                "delivery_status": "sent",
            }
        ],
        "ledger_entries": ledger_entries,
        "ledger_written": False,
    }
    recorded_ledgers: list[list[dict]] = []
    sent_documents: list[dict] = []
    monkeypatch.setattr(handler, "transfer_operation_store", store)
    monkeypatch.setattr(
        handler.equipment_manager,
        "add_transfer_operation_entries_once",
        lambda entries: recorded_ledgers.append(copy.deepcopy(entries)) or True,
    )

    async def fake_send_document(**kwargs):
        sent_documents.append(kwargs)
        return True

    monkeypatch.setattr(handler, "send_document_with_retry", fake_send_document)
    query = _Query(f"confirm_transfer:{operation_id}")
    update = SimpleNamespace(callback_query=query, effective_user=SimpleNamespace(id=1), message=None)

    await handler.handle_transfer_confirmation.__wrapped__(update, SimpleNamespace(bot=_Bot(), user_data={}))

    assert sent_documents == []
    assert recorded_ledgers == [ledger_entries]
    assert store.records[operation_id]["status"] == "completed"

    # A duplicate callback after the durable completion cannot re-send or
    # append a second ledger record.
    await handler.handle_transfer_confirmation.__wrapped__(update, SimpleNamespace(bot=_Bot(), user_data={}))
    assert sent_documents == []
    assert recorded_ledgers == [ledger_entries]


@pytest.mark.asyncio
async def test_bot_does_not_resend_ambiguous_sending_checkpoint_or_write_ledger(monkeypatch):
    handler = importlib.import_module("bot.handlers.transfer")
    operation_id = "bot-recovery-sending-unknown-001"
    store = _MemoryOperationStore()
    store.records[operation_id] = {
        "operation_id": operation_id,
        "status": "delivery_pending",
        "payload": _operation_payload(),
        "acts": [
            {
                "success": True,
                "old_employee": "Old Owner",
                "pdf_path": "transfer_acts/reused.pdf",
                "filename": "reused.pdf",
                "equipment_count": 1,
                "delivery_status": "sending",
            }
        ],
        "ledger_entries": [{"operation_id": operation_id, "item_id": 7}],
        "ledger_written": False,
    }
    sent_documents: list[dict] = []
    ledger: list[dict] = []
    monkeypatch.setattr(handler, "transfer_operation_store", store)
    monkeypatch.setattr(
        handler.equipment_manager,
        "add_transfer_operation_entries_once",
        lambda entries: ledger.extend(entries) or True,
    )

    async def fake_send_document(**kwargs):
        sent_documents.append(kwargs)
        return True

    monkeypatch.setattr(handler, "send_document_with_retry", fake_send_document)
    query = _Query(f"confirm_transfer:{operation_id}")
    update = SimpleNamespace(callback_query=query, effective_user=SimpleNamespace(id=1), message=None)

    await handler.handle_transfer_confirmation.__wrapped__(update, SimpleNamespace(bot=_Bot(), user_data={}))

    assert sent_documents == []
    assert ledger == []
