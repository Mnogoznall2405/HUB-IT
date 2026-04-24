from __future__ import annotations

from pathlib import Path
from typing import Optional

from local_store import get_local_store


class NotificationPreferencesService:
    FILE_NAME = "notification_preferences.json"
    DEFAULTS = {
        "mail": True,
        "tasks": True,
        "announcements": True,
        "chat": True,
    }

    def __init__(self, file_path: Optional[Path] = None) -> None:
        if file_path is None:
            project_root = Path(__file__).resolve().parents[3]
            file_path = project_root / "data" / self.FILE_NAME
        self.file_path = Path(file_path)
        self.file_path.parent.mkdir(parents=True, exist_ok=True)
        self.store = get_local_store(data_dir=self.file_path.parent)
        self._ensure_file()

    def _ensure_file(self) -> None:
        data = self.store.load_json(self.FILE_NAME, default_content={})
        if not isinstance(data, dict):
            self.store.save_json(self.FILE_NAME, {})

    def _load_all(self) -> dict[str, dict]:
        data = self.store.load_json(self.FILE_NAME, default_content={})
        return data if isinstance(data, dict) else {}

    def _save_all(self, data: dict[str, dict]) -> None:
        self.store.save_json(self.FILE_NAME, data)

    def get_preferences(self, *, user_id: int) -> dict:
        data = self._load_all()
        raw = data.get(str(int(user_id))) or {}
        result = dict(self.DEFAULTS)
        if isinstance(raw, dict):
            for key in self.DEFAULTS.keys():
                if key in raw:
                    result[key] = bool(raw.get(key))
        return {"user_id": int(user_id), "channels": result}

    def update_preferences(self, *, user_id: int, patch: dict | None = None) -> dict:
        current = self.get_preferences(user_id=int(user_id))["channels"]
        next_value = dict(current)
        payload = patch if isinstance(patch, dict) else {}
        for key in self.DEFAULTS.keys():
            if key in payload:
                next_value[key] = bool(payload.get(key))
        data = self._load_all()
        data[str(int(user_id))] = next_value
        self._save_all(data)
        return {"user_id": int(user_id), "channels": next_value}

    def is_enabled(self, *, user_id: int, channel: str) -> bool:
        normalized = str(channel or "").strip().lower()
        if normalized not in self.DEFAULTS:
            return True
        return bool(self.get_preferences(user_id=int(user_id))["channels"].get(normalized, True))


notification_preferences_service = NotificationPreferencesService()
