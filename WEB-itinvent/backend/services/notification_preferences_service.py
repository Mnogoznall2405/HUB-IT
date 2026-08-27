from __future__ import annotations

from datetime import datetime, timezone
from pathlib import Path
from typing import Optional
from zoneinfo import ZoneInfo, ZoneInfoNotFoundError

from local_store import get_local_store


CHAT_NOTIFICATION_CHANNELS = {
    "direct": "chat_direct",
    "ai": "chat_direct",
    "group": "chat_group",
    "task": "chat_task",
}


def chat_notification_channel(conversation_kind: object) -> str:
    normalized_kind = str(conversation_kind or "").strip().lower()
    return CHAT_NOTIFICATION_CHANNELS.get(normalized_kind, "chat")


class NotificationPreferencesService:
    FILE_NAME = "notification_preferences.json"
    DEFAULTS = {
        "mail": True,
        "tasks": True,
        "task_email": True,
        "announcements": True,
        "chat": True,
        "chat_direct": True,
        "chat_group": True,
        "chat_task": True,
    }
    CHAT_CATEGORY_CHANNELS = frozenset(CHAT_NOTIFICATION_CHANNELS.values())
    QUIET_HOURS_CHANNELS = frozenset({"chat", "mail", "tasks", "hub", "announcements"})
    QUIET_HOURS_DEFAULTS = {
        "enabled": False,
        "start": "22:00",
        "end": "07:00",
        "timezone": "Asia/Yekaterinburg",
    }
    QUIET_HOURS_STORAGE_KEYS = {
        "enabled": "quiet_hours_enabled",
        "start": "quiet_hours_start",
        "end": "quiet_hours_end",
        "timezone": "quiet_hours_timezone",
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

    def _channel_value(self, raw: object, channel: str) -> bool:
        payload = raw if isinstance(raw, dict) else {}
        if channel in payload:
            return bool(payload.get(channel))
        if channel in self.CHAT_CATEGORY_CHANNELS and "chat" in payload:
            return bool(payload.get("chat"))
        return bool(self.DEFAULTS[channel])

    @staticmethod
    def _normalize_clock(value: object, fallback: str) -> str:
        text = str(value or "").strip()
        parts = text.split(":")
        if len(parts) != 2 or not all(part.isdigit() for part in parts):
            return fallback
        hour, minute = (int(part) for part in parts)
        if not 0 <= hour <= 23 or not 0 <= minute <= 59:
            return fallback
        return f"{hour:02d}:{minute:02d}"

    @staticmethod
    def _normalize_timezone(value: object, fallback: str) -> str:
        text = str(value or "").strip() or fallback
        try:
            ZoneInfo(text)
        except (ZoneInfoNotFoundError, ValueError):
            return fallback
        return text

    def _quiet_hours_value(self, raw: object) -> dict[str, object]:
        payload = raw if isinstance(raw, dict) else {}
        defaults = self.QUIET_HOURS_DEFAULTS
        return {
            "enabled": bool(payload.get(self.QUIET_HOURS_STORAGE_KEYS["enabled"], defaults["enabled"])),
            "start": self._normalize_clock(
                payload.get(self.QUIET_HOURS_STORAGE_KEYS["start"]),
                str(defaults["start"]),
            ),
            "end": self._normalize_clock(
                payload.get(self.QUIET_HOURS_STORAGE_KEYS["end"]),
                str(defaults["end"]),
            ),
            "timezone": self._normalize_timezone(
                payload.get(self.QUIET_HOURS_STORAGE_KEYS["timezone"]),
                str(defaults["timezone"]),
            ),
        }

    def get_preferences(self, *, user_id: int) -> dict:
        data = self._load_all()
        raw = data.get(str(int(user_id))) or {}
        result = {
            key: self._channel_value(raw, key)
            for key in self.DEFAULTS
        }
        return {
            "user_id": int(user_id),
            "channels": result,
            "quiet_hours": self._quiet_hours_value(raw),
        }

    def update_preferences(self, *, user_id: int, patch: dict | None = None) -> dict:
        current_preferences = self.get_preferences(user_id=int(user_id))
        current = current_preferences["channels"]
        quiet_hours = dict(current_preferences["quiet_hours"])
        next_value = dict(current)
        payload = patch if isinstance(patch, dict) else {}
        for key in self.DEFAULTS.keys():
            if key in payload:
                next_value[key] = bool(payload.get(key))
        if "chat" in payload:
            for channel in self.CHAT_CATEGORY_CHANNELS:
                if channel not in payload:
                    next_value[channel] = bool(payload.get("chat"))
        elif any(channel in payload for channel in self.CHAT_CATEGORY_CHANNELS):
            next_value["chat"] = any(
                bool(next_value[channel])
                for channel in self.CHAT_CATEGORY_CHANNELS
            )
        for key, storage_key in self.QUIET_HOURS_STORAGE_KEYS.items():
            if storage_key not in payload:
                continue
            if key == "enabled":
                quiet_hours[key] = bool(payload.get(storage_key))
            elif key in {"start", "end"}:
                normalized = self._normalize_clock(payload.get(storage_key), "")
                if not normalized:
                    raise ValueError(f"Invalid quiet hours {key}")
                quiet_hours[key] = normalized
            else:
                raw_timezone = str(payload.get(storage_key) or "").strip()
                normalized = self._normalize_timezone(raw_timezone, "")
                if not normalized:
                    raise ValueError("Invalid quiet hours timezone")
                quiet_hours[key] = normalized
        if bool(quiet_hours["enabled"]) and quiet_hours["start"] == quiet_hours["end"]:
            raise ValueError("Quiet hours start and end must be different")
        data = self._load_all()
        data[str(int(user_id))] = {
            **next_value,
            **{
                self.QUIET_HOURS_STORAGE_KEYS[key]: value
                for key, value in quiet_hours.items()
            },
        }
        self._save_all(data)
        return {
            "user_id": int(user_id),
            "channels": next_value,
            "quiet_hours": quiet_hours,
        }

    def is_quiet_hours_active(
        self,
        *,
        user_id: int,
        channel: str,
        now_utc: datetime | None = None,
    ) -> bool:
        normalized_channel = str(channel or "").strip().lower()
        if normalized_channel not in self.QUIET_HOURS_CHANNELS:
            return False
        quiet_hours = self.get_preferences(user_id=int(user_id))["quiet_hours"]
        if not bool(quiet_hours.get("enabled")):
            return False
        start = self._normalize_clock(quiet_hours.get("start"), "")
        end = self._normalize_clock(quiet_hours.get("end"), "")
        if not start or not end or start == end:
            return False
        timezone_name = self._normalize_timezone(quiet_hours.get("timezone"), "UTC")
        current_utc = now_utc or datetime.now(timezone.utc)
        if current_utc.tzinfo is None:
            current_utc = current_utc.replace(tzinfo=timezone.utc)
        local_time = current_utc.astimezone(ZoneInfo(timezone_name))
        current_minutes = local_time.hour * 60 + local_time.minute
        start_hour, start_minute = (int(part) for part in start.split(":"))
        end_hour, end_minute = (int(part) for part in end.split(":"))
        start_minutes = start_hour * 60 + start_minute
        end_minutes = end_hour * 60 + end_minute
        if start_minutes < end_minutes:
            return start_minutes <= current_minutes < end_minutes
        return current_minutes >= start_minutes or current_minutes < end_minutes

    def is_enabled(self, *, user_id: int, channel: str) -> bool:
        normalized = str(channel or "").strip().lower()
        if normalized not in self.DEFAULTS:
            return True
        return bool(self.get_preferences(user_id=int(user_id))["channels"].get(normalized, True))

    def enabled_user_ids(
        self,
        *,
        user_ids: list[int] | set[int] | tuple[int, ...],
        channel: str,
    ) -> set[int]:
        """Resolve one notification channel for many users with one store read."""
        normalized_channel = str(channel or "").strip().lower()
        normalized_user_ids = {int(user_id) for user_id in user_ids if int(user_id) > 0}
        if normalized_channel not in self.DEFAULTS:
            return normalized_user_ids
        data = self._load_all()
        enabled: set[int] = set()
        for user_id in normalized_user_ids:
            raw = data.get(str(user_id)) or {}
            value = self._channel_value(raw, normalized_channel)
            if bool(value):
                enabled.add(user_id)
        return enabled


notification_preferences_service = NotificationPreferencesService()
