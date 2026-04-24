"""App-database-backed compatibility store for JSONDataManager."""
from __future__ import annotations

import json
from datetime import datetime, timezone
from pathlib import Path
from typing import Any, Callable

from sqlalchemy import delete, select

from backend.appdb.db import app_session, initialize_app_schema
from backend.appdb.models import AppJsonDocument, AppJsonRecord


FILE_KIND_MAP: dict[str, str] = {
    "unfound_equipment.json": "list",
    "equipment_transfers.json": "list",
    "cartridge_replacements.json": "list",
    "battery_replacements.json": "list",
    "component_replacements.json": "list",
    "pc_cleanings.json": "list",
    "cartridge_database.json": "dict",
    "kb_articles.json": "list",
    "kb_cards.json": "list",
}


def _normalize_filename(filename: str) -> str:
    return Path(str(filename or "")).name or str(filename or "")


def _utcnow() -> datetime:
    return datetime.now(timezone.utc)


class AppJsonDataStore:
    """Compatibility JSON store backed by app-db tables."""

    def __init__(self, *, database_url: str | None = None) -> None:
        self._database_url = str(database_url or "").strip() or None
        initialize_app_schema(self._database_url)

    @staticmethod
    def _infer_kind(file_name: str, default_content: Any) -> str:
        normalized = _normalize_filename(file_name)
        if normalized in FILE_KIND_MAP:
            return FILE_KIND_MAP[normalized]
        if isinstance(default_content, dict):
            return "dict"
        if isinstance(default_content, list):
            return "list"
        return "value"

    @staticmethod
    def _decode_json(payload_json: str, default: Any) -> Any:
        try:
            return json.loads(str(payload_json or "null"))
        except Exception:
            return default

    def load_json(self, file_name: str, default_content: Any = None) -> Any:
        normalized_name = _normalize_filename(file_name)
        kind = self._infer_kind(normalized_name, default_content)

        with app_session(self._database_url) as session:
            if kind == "dict":
                row = session.get(AppJsonDocument, normalized_name)
                if row is None:
                    return default_content
                return self._decode_json(row.payload_json, default_content)

            if kind == "list":
                rows = session.scalars(
                    select(AppJsonRecord)
                    .where(AppJsonRecord.file_name == normalized_name)
                    .order_by(AppJsonRecord.sort_order.asc(), AppJsonRecord.id.asc())
                ).all()
                if not rows:
                    return default_content
                return [self._decode_json(item.payload_json, None) for item in rows]

            row = session.get(AppJsonDocument, normalized_name)
            if row is None:
                return default_content
            return self._decode_json(row.payload_json, default_content)

    def save_json(self, file_name: str, data: Any) -> bool:
        normalized_name = _normalize_filename(file_name)
        kind = self._infer_kind(normalized_name, data)
        now = _utcnow()

        try:
            with app_session(self._database_url) as session:
                session.execute(delete(AppJsonRecord).where(AppJsonRecord.file_name == normalized_name))
                row = session.get(AppJsonDocument, normalized_name)
                if row is not None:
                    session.delete(row)

                if kind == "dict":
                    row = AppJsonDocument(
                        file_name=normalized_name,
                        kind="dict",
                        payload_json=json.dumps(data if isinstance(data, dict) else {}, ensure_ascii=False),
                        updated_at=now,
                    )
                    session.add(row)
                    return True

                if kind == "list":
                    source = data if isinstance(data, list) else []
                    for index, item in enumerate(source):
                        session.add(
                            AppJsonRecord(
                                file_name=normalized_name,
                                sort_order=index,
                                payload_json=json.dumps(item, ensure_ascii=False),
                                created_at=now,
                                updated_at=now,
                            )
                        )
                    return True

                row = AppJsonDocument(
                    file_name=normalized_name,
                    kind="value",
                    payload_json=json.dumps(data, ensure_ascii=False),
                    updated_at=now,
                )
                session.add(row)
            return True
        except Exception:
            return False

    def append_to_json(self, file_name: str, record: Any) -> bool:
        normalized_name = _normalize_filename(file_name)
        kind = self._infer_kind(normalized_name, [])
        if kind != "list":
            current = self.load_json(normalized_name, default_content=[])
            if not isinstance(current, list):
                current = []
            current.append(record)
            return self.save_json(normalized_name, current)

        now = _utcnow()
        try:
            with app_session(self._database_url) as session:
                current_order = session.scalar(
                    select(AppJsonRecord.sort_order)
                    .where(AppJsonRecord.file_name == normalized_name)
                    .order_by(AppJsonRecord.sort_order.desc(), AppJsonRecord.id.desc())
                    .limit(1)
                )
                next_order = int(current_order) + 1 if current_order is not None else 0
                session.add(
                    AppJsonRecord(
                        file_name=normalized_name,
                        sort_order=next_order,
                        payload_json=json.dumps(record, ensure_ascii=False),
                        created_at=now,
                        updated_at=now,
                    )
                )
            return True
        except Exception:
            return False

    def update_json_array(
        self,
        file_name: str,
        predicate: Callable[[dict[str, Any]], bool],
        updater: Callable[[dict[str, Any]], dict[str, Any]],
    ) -> int:
        rows = self.load_json(file_name, default_content=[])
        if not isinstance(rows, list):
            return 0

        changed = 0
        updated_rows: list[Any] = []
        for row in rows:
            if isinstance(row, dict) and predicate(row):
                updated_rows.append(updater(row))
                changed += 1
            else:
                updated_rows.append(row)
        if changed:
            self.save_json(file_name, updated_rows)
        return changed

    def get_json_files(self) -> list[str]:
        with app_session(self._database_url) as session:
            document_rows = session.scalars(select(AppJsonDocument.file_name)).all()
            record_rows = session.scalars(select(AppJsonRecord.file_name).distinct()).all()
        files = {str(item or "").strip() for item in document_rows}
        files.update(str(item or "").strip() for item in record_rows)
        return sorted(item for item in files if item)
