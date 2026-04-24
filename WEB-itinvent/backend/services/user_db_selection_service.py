"""
User database assignment service.

Reads Telegram user -> database mapping from shared bot file:
data/user_db_selection.json
"""
from __future__ import annotations

from datetime import datetime, timezone
from pathlib import Path
from typing import Optional

from sqlalchemy import select

from backend.appdb.db import app_session, initialize_app_schema, is_app_database_configured
from backend.appdb.models import AppUserDatabaseSelection
from local_store import get_local_store


class UserDBSelectionService:
    """Service to resolve assigned SQL database by Telegram ID."""

    def __init__(self, file_path: Optional[Path] = None, database_url: Optional[str] = None):
        if file_path is None:
            project_root = Path(__file__).resolve().parents[3]
            file_path = project_root / "data" / "user_db_selection.json"
        self.file_path = file_path
        self._database_url = str(database_url or "").strip() or None
        self._use_app_database = bool(self._database_url) or is_app_database_configured()
        self.store = None if self._use_app_database else get_local_store(data_dir=self.file_path.parent)
        if self._use_app_database:
            initialize_app_schema(self._database_url)

    def _read_mapping(self) -> dict[str, str]:
        if self._use_app_database:
            with app_session(self._database_url) as session:
                rows = session.scalars(select(AppUserDatabaseSelection).order_by(AppUserDatabaseSelection.telegram_id.asc())).all()
                return {str(int(row.telegram_id)): str(row.database_id).strip() for row in rows if str(row.database_id).strip()}
        data = self.store.load_json("user_db_selection.json", default_content={})
        if not isinstance(data, dict):
            return {}
        return {str(k): str(v).strip() for k, v in data.items() if str(v).strip()}

    def _write_mapping(self, mapping: dict[str, str]) -> None:
        if self._use_app_database:
            with app_session(self._database_url) as session:
                existing_rows = session.scalars(select(AppUserDatabaseSelection)).all()
                existing_by_telegram = {int(row.telegram_id): row for row in existing_rows}
                incoming_ids: set[int] = set()
                for key, value in mapping.items():
                    try:
                        telegram_id = int(key)
                    except (TypeError, ValueError):
                        continue
                    normalized_db = str(value or "").strip()
                    if not normalized_db:
                        continue
                    incoming_ids.add(telegram_id)
                    row = existing_by_telegram.get(telegram_id)
                    if row is None:
                        row = AppUserDatabaseSelection(telegram_id=telegram_id)
                        session.add(row)
                    row.database_id = normalized_db
                    row.updated_at = datetime.now(timezone.utc)
                for telegram_id, row in existing_by_telegram.items():
                    if telegram_id not in incoming_ids:
                        session.delete(row)
            return
        self.store.save_json("user_db_selection.json", mapping)

    def get_assigned_database(self, telegram_id: Optional[int]) -> Optional[str]:
        """Return assigned DB ID for Telegram user or None."""
        if telegram_id in (None, 0):
            return None
        mapping = self._read_mapping()
        return mapping.get(str(int(telegram_id)))

    def set_assigned_database(self, telegram_id: Optional[int], database_id: Optional[str]) -> None:
        """Upsert or remove assigned DB for Telegram user."""
        if telegram_id in (None, 0):
            return
        key = str(int(telegram_id))
        mapping = self._read_mapping()
        normalized_db = str(database_id or "").strip()
        if normalized_db:
            mapping[key] = normalized_db
        else:
            mapping.pop(key, None)
        self._write_mapping(mapping)


user_db_selection_service = UserDBSelectionService()
