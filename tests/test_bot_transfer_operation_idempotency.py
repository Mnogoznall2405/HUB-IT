from __future__ import annotations

import importlib
import copy
from types import SimpleNamespace

import pytest

from bot.equipment_data_manager import EquipmentDataManager


class _Query:
    def __init__(self) -> None:
        self.data = "confirm_transfer"
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


class _TransferDb:
    def __init__(self) -> None:
        self.calls: list[tuple[str, dict]] = []
        self.closed = False

    def get_owner_no_by_name(self, name, strict=True):
        return 99

    def get_branch_no_by_name(self, name):
        return 8

    def get_loc_no_by_descr(self, name):
        return 9

    def resolve_transfer_item_by_serial(self, serial_number):
        return {"success": True, "item_id": 101, "serial_number": serial_number}

    def resolve_transfer_item_by_id(self, item_id):
        return {"success": True, "item_id": int(item_id), "serial_number": "SN-OK"}

    def transfer_equipment_by_id_with_history(self, *, item_id, **kwargs):
        self.calls.append((item_id, kwargs))
        return {"success": True, "message": "Transferred"}

    def close_connection(self) -> None:
        self.closed = True


class _MemoryOperationStore:
    def __init__(self) -> None:
        self.records: dict[str, dict] = {}

    def get(self, operation_id):
        record = self.records.get(operation_id)
        return copy.deepcopy(record) if record is not None else None

    def create_or_get(self, operation_id, payload):
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

    def checkpoint(self, operation_id, *, status=None, **values):
        record = self.records[operation_id]
        if status is not None:
            record["status"] = status
        record.update(copy.deepcopy(values))
        return self.get(operation_id)


def test_bot_operation_id_is_stable_before_confirmation():
    handler = importlib.import_module("bot.handlers.transfer")
    context = SimpleNamespace(user_data={})

    first = handler._ensure_transfer_operation_id(context)
    second = handler._ensure_transfer_operation_id(context)

    assert first == second
    assert first.startswith("bot-")
    assert len(first) >= 8


@pytest.mark.asyncio
async def test_duplicate_processing_callback_does_not_open_second_database_connection(monkeypatch):
    handler = importlib.import_module("bot.handlers.transfer")
    opened = []
    monkeypatch.setattr(
        handler.database_manager,
        "create_database_connection",
        lambda user_id: opened.append(user_id),
    )

    query = _Query()
    context = SimpleNamespace(
        bot=_Bot(),
        user_data={
            handler.TRANSFER_OPERATION_ID_KEY: "bot-duplicate-0001",
            handler.TRANSFER_OPERATION_STATE_KEY: "processing",
            "grouped_equipment": {"Old Owner": [{"serial": "SN-OK"}]},
        },
    )
    update = SimpleNamespace(callback_query=query, effective_user=SimpleNamespace(id=1), message=None)

    result = await handler.handle_transfer_confirmation.__wrapped__(update, context)

    assert result == handler.ConversationHandler.END
    assert opened == []


@pytest.mark.asyncio
async def test_bot_ledger_gets_operation_id_only_after_successful_sql_transfer(monkeypatch, tmp_path):
    handler = importlib.import_module("bot.handlers.transfer")
    pdf_generator = importlib.import_module("bot.services.pdf_generator")
    transfer_db = _TransferDb()
    ledger: list[dict] = []
    pdf_path = tmp_path / "act.pdf"
    pdf_path.write_bytes(b"%PDF-1.4")

    async def fake_generate(**kwargs):
        return [
            {
                "success": True,
                "pdf_path": str(pdf_path),
                "filename": "act.pdf",
                "old_employee": "Old Owner",
                "equipment_count": 1,
            }
        ]

    async def fake_send_document(**kwargs):
        return True

    monkeypatch.setattr(pdf_generator, "generate_multiple_transfer_acts", fake_generate)
    monkeypatch.setattr(handler.database_manager, "get_user_database", lambda user_id: "main")
    monkeypatch.setattr(handler.database_manager, "create_database_connection", lambda user_id: transfer_db)
    monkeypatch.setattr(handler, "send_document_with_retry", fake_send_document)
    monkeypatch.setattr(handler, "_has_recorded_transfer_operation", lambda operation_id: False)
    monkeypatch.setattr(
        handler.equipment_manager,
        "add_transfer_operation_entries_once",
        lambda entries: ledger.extend(entries) or True,
    )
    monkeypatch.setattr(handler, "transfer_operation_store", _MemoryOperationStore())

    query = _Query()
    operation_id = "bot-transfer-ledger-0001"
    context = SimpleNamespace(
        bot=_Bot(),
        user_data={
            handler.TRANSFER_OPERATION_ID_KEY: operation_id,
            handler.TRANSFER_OPERATION_STATE_KEY: "draft",
            "grouped_equipment": {"Old Owner": [{"serial": "SN-OK", "equipment": {}}]},
            "new_employee": "New Owner",
            "new_employee_dept": "IT",
            "new_branch": "Branch",
            "new_location": "Office",
        },
    )
    update = SimpleNamespace(callback_query=query, effective_user=SimpleNamespace(id=1), message=None)

    await handler.handle_transfer_confirmation.__wrapped__(update, context)

    assert len(transfer_db.calls) == 1
    assert transfer_db.calls[0][1]["comment"].endswith(f"[operation_id={operation_id}]")
    assert transfer_db.calls[0][1]["operation_id"] == operation_id
    assert transfer_db.calls[0][0] == 101
    assert ledger[0]["additional_data"]["operation_id"] == operation_id
    assert ledger[0]["additional_data"]["one_c_sync_state"] == "not_requested"


def test_equipment_ledger_promotes_operation_metadata_and_finds_duplicate():
    manager = object.__new__(EquipmentDataManager)
    manager.transfers_file = "equipment_transfers.json"
    records: list[dict] = []
    manager._load_data = lambda file_path: records
    manager._save_data = lambda file_path, data: None

    assert manager.add_equipment_transfer(
        serial_number="SN-12345",
        new_employee="New Owner",
        old_employee="Old Owner",
        additional_data={
            "operation_id": "bot-transfer-ledger-0002",
            "one_c_sync_state": "not_requested",
        },
    )

    assert records[0]["operation_id"] == "bot-transfer-ledger-0002"
    assert records[0]["one_c_sync_state"] == "not_requested"
    assert manager.has_transfer_operation("bot-transfer-ledger-0002") is True
