"""Durable bot-side checkpoints for a transfer operation.

The SQL Server mutation and Telegram delivery cannot share one transaction.
This small journal keeps the operation's immutable item ids, generated artifact
paths and ledger/delivery checkpoints in the existing local SQLite-backed
store.  It is deliberately bot-local: it never writes to 1C.
"""
from __future__ import annotations

import copy
import hashlib
import json
import threading
from datetime import datetime, timezone
from typing import Any, Mapping

from bot.local_json_store import load_json_data, save_json_data


TRANSFER_OPERATION_JOURNAL_FILE = "bot_transfer_operations.json"


class TransferOperationConflict(ValueError):
    """An idempotency key was reused with a different immutable command."""


def _utc_now() -> str:
    return datetime.now(timezone.utc).isoformat()


def _normalized_operation_id(operation_id: str) -> str:
    value = str(operation_id or "").strip()
    if not value:
        raise ValueError("operation_id is required")
    return value


def _request_fingerprint(payload: Mapping[str, Any]) -> str:
    """Hash only identity/target fields which must not change on replay."""
    source = dict(payload or {})
    stable = {
        "db_name": str(source.get("db_name") or "").strip(),
        "chat_id": int(source.get("chat_id") or 0),
        "new_employee_id": source.get("new_employee_id"),
        "new_branch_no": source.get("new_branch_no"),
        "new_loc_no": source.get("new_loc_no"),
        "items": sorted(
            [
                {
                    "item_id": int(item.get("item_id")),
                    "old_employee": str(item.get("old_employee") or "").strip(),
                }
                for item in source.get("items", [])
                if isinstance(item, Mapping) and item.get("item_id") is not None
            ],
            key=lambda row: (row["item_id"], row["old_employee"]),
        ),
    }
    raw = json.dumps(stable, ensure_ascii=False, sort_keys=True, separators=(",", ":"))
    return hashlib.sha256(raw.encode("utf-8")).hexdigest()


class BotTransferOperationStore:
    """Persist/reload one bot transfer operation by its idempotency key.

    Bot callbacks are handled in one process, therefore a process-level lock
    is sufficient around the local read-modify-write operation.  Every
    checkpoint itself is committed by ``local_store`` before this method
    returns, which is what protects restarts between SQL, ledger and Telegram
    calls.
    """

    def __init__(self, journal_file: str = TRANSFER_OPERATION_JOURNAL_FILE) -> None:
        self.journal_file = str(journal_file)
        self._lock = threading.RLock()

    def _load(self) -> dict[str, dict[str, Any]]:
        payload = load_json_data(self.journal_file, default_content={})
        if not isinstance(payload, dict):
            return {}
        return {
            str(key): dict(value)
            for key, value in payload.items()
            if isinstance(value, Mapping)
        }

    def _save(self, records: Mapping[str, Mapping[str, Any]]) -> None:
        if not save_json_data(self.journal_file, dict(records)):
            raise RuntimeError("Не удалось сохранить checkpoint операции перемещения")

    def get(self, operation_id: str) -> dict[str, Any] | None:
        normalized_id = _normalized_operation_id(operation_id)
        with self._lock:
            record = self._load().get(normalized_id)
            return copy.deepcopy(record) if record is not None else None

    def create_or_get(self, operation_id: str, payload: Mapping[str, Any]) -> dict[str, Any]:
        """Create a resolved command or return its exact durable predecessor."""
        normalized_id = _normalized_operation_id(operation_id)
        safe_payload = copy.deepcopy(dict(payload or {}))
        fingerprint = _request_fingerprint(safe_payload)
        with self._lock:
            records = self._load()
            existing = records.get(normalized_id)
            if existing is not None:
                if str(existing.get("request_fingerprint") or "") != fingerprint:
                    raise TransferOperationConflict(
                        f"operation_id {normalized_id} уже относится к другому перемещению"
                    )
                return copy.deepcopy(existing)

            now = _utc_now()
            record: dict[str, Any] = {
                "schema_version": 1,
                "operation_id": normalized_id,
                "request_fingerprint": fingerprint,
                "status": "resolved",
                "version": 1,
                "created_at": now,
                "updated_at": now,
                "payload": safe_payload,
                "acts": [],
                "ledger_written": False,
                "events": [{"at": now, "status": "resolved", "note": "immutable items resolved"}],
            }
            records[normalized_id] = record
            self._save(records)
            return copy.deepcopy(record)

    def checkpoint(
        self,
        operation_id: str,
        *,
        status: str | None = None,
        note: str = "",
        **values: Any,
    ) -> dict[str, Any]:
        """Atomically persist the next locally observable operation state."""
        normalized_id = _normalized_operation_id(operation_id)
        with self._lock:
            records = self._load()
            record = records.get(normalized_id)
            if record is None:
                raise KeyError(f"Операция {normalized_id} не найдена в checkpoint store")

            for key, value in values.items():
                record[key] = copy.deepcopy(value)
            if status is not None:
                record["status"] = str(status)

            now = _utc_now()
            record["version"] = int(record.get("version") or 0) + 1
            record["updated_at"] = now
            events = record.get("events")
            if not isinstance(events, list):
                events = []
            events.append(
                {
                    "at": now,
                    "status": str(record.get("status") or ""),
                    "note": str(note or ""),
                }
            )
            record["events"] = events
            records[normalized_id] = record
            self._save(records)
            return copy.deepcopy(record)
