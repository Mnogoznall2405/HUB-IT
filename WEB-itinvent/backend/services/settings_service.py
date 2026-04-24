"""
Per-user UI/database settings storage.
"""
from __future__ import annotations

import json
from datetime import datetime, timezone
from pathlib import Path
from typing import Optional

from sqlalchemy import select

from backend.appdb.db import app_session, initialize_app_schema, is_app_database_configured
from backend.appdb.models import AppUserSetting
from local_store import get_local_store


class SettingsService:
    """Persist user settings in JSON."""

    FILE_NAME = "web_user_settings.json"
    DASHBOARD_MOBILE_SECTION_KEYS = ("urgent", "announcements", "tasks")
    DEFAULTS = {
        "pinned_database": None,
        "theme_mode": "light",
        "font_family": "Inter",
        "font_scale": 1.0,
        "dashboard_mobile_sections": ["urgent", "announcements", "tasks"],
    }

    def __init__(self, file_path: Optional[Path] = None, database_url: Optional[str] = None):
        if file_path is None:
            project_root = Path(__file__).resolve().parents[3]
            file_path = project_root / "data" / self.FILE_NAME
        self.file_path = file_path
        self.file_path.parent.mkdir(parents=True, exist_ok=True)
        self._database_url = str(database_url or "").strip() or None
        self._use_app_database = bool(self._database_url) or is_app_database_configured()
        self.store = None if self._use_app_database else get_local_store(data_dir=self.file_path.parent)
        if self._use_app_database:
            initialize_app_schema(self._database_url)
        self._ensure_file()

    def _ensure_file(self) -> None:
        if self._use_app_database:
            return
        data = self.store.load_json(self.FILE_NAME, default_content={})
        if not isinstance(data, dict):
            self._save_all({})

    def _normalize_dashboard_mobile_sections(self, value) -> list[str]:
        raw_value = value
        if isinstance(raw_value, str):
            try:
                raw_value = json.loads(raw_value)
            except Exception:
                raw_value = []
        if not isinstance(raw_value, (list, tuple)):
            raw_value = []

        result: list[str] = []
        for item in raw_value:
            token = str(item or "").strip().lower()
            if token in self.DASHBOARD_MOBILE_SECTION_KEYS and token not in result:
                result.append(token)

        return result or list(self.DEFAULTS["dashboard_mobile_sections"])

    def _load_all(self) -> dict[str, dict]:
        if self._use_app_database:
            with app_session(self._database_url) as session:
                rows = session.scalars(select(AppUserSetting).order_by(AppUserSetting.user_id.asc())).all()
                return {
                    str(int(row.user_id)): {
                        "pinned_database": row.pinned_database,
                        "theme_mode": str(row.theme_mode or "light"),
                        "font_family": str(row.font_family or "Inter"),
                        "font_scale": float(row.font_scale or 1.0),
                        "dashboard_mobile_sections": self._normalize_dashboard_mobile_sections(row.dashboard_mobile_sections_json),
                    }
                    for row in rows
                }
        data = self.store.load_json(self.FILE_NAME, default_content={})
        return data if isinstance(data, dict) else {}

    def _save_all(self, data: dict[str, dict]) -> None:
        if self._use_app_database:
            with app_session(self._database_url) as session:
                existing_rows = session.scalars(select(AppUserSetting)).all()
                existing_by_user_id = {int(row.user_id): row for row in existing_rows}
                incoming_ids: set[int] = set()
                for key, payload in data.items():
                    try:
                        user_id = int(key)
                    except (TypeError, ValueError):
                        continue
                    incoming_ids.add(user_id)
                    row = existing_by_user_id.get(user_id)
                    if row is None:
                        row = AppUserSetting(user_id=user_id)
                        session.add(row)
                    row.pinned_database = (str(payload.get("pinned_database") or "").strip() or None)
                    row.theme_mode = str(payload.get("theme_mode") or "light")
                    row.font_family = str(payload.get("font_family") or "Inter")
                    row.font_scale = float(payload.get("font_scale") or 1.0)
                    row.dashboard_mobile_sections_json = json.dumps(
                        self._normalize_dashboard_mobile_sections(payload.get("dashboard_mobile_sections"))
                    )
                    row.updated_at = datetime.now(timezone.utc)
                for user_id, row in existing_by_user_id.items():
                    if user_id not in incoming_ids:
                        session.delete(row)
            return
        self.store.save_json(self.FILE_NAME, data)

    def get_user_settings(self, user_id: int) -> dict:
        data = self._load_all()
        raw = data.get(str(int(user_id))) or {}
        settings = {**self.DEFAULTS, **raw}
        if settings["theme_mode"] not in {"light", "dark"}:
            settings["theme_mode"] = "light"
        if settings["font_family"] not in {"Inter", "Roboto", "Segoe UI"}:
            settings["font_family"] = "Inter"
        try:
            scale = float(settings.get("font_scale", 1.0))
        except (TypeError, ValueError):
            scale = 1.0
        settings["font_scale"] = max(0.9, min(1.2, scale))
        settings["dashboard_mobile_sections"] = self._normalize_dashboard_mobile_sections(
            settings.get("dashboard_mobile_sections")
        )
        return settings

    def update_user_settings(self, user_id: int, patch: dict) -> dict:
        data = self._load_all()
        key = str(int(user_id))
        current = self.get_user_settings(user_id)

        if "pinned_database" in patch:
            value = patch.get("pinned_database")
            current["pinned_database"] = str(value).strip() if value not in (None, "") else None
        if "theme_mode" in patch and str(patch.get("theme_mode")) in {"light", "dark"}:
            current["theme_mode"] = str(patch.get("theme_mode"))
        if "font_family" in patch and str(patch.get("font_family")) in {"Inter", "Roboto", "Segoe UI"}:
            current["font_family"] = str(patch.get("font_family"))
        if "font_scale" in patch:
            try:
                scale = float(patch.get("font_scale"))
                current["font_scale"] = max(0.9, min(1.2, scale))
            except (TypeError, ValueError):
                pass
        if "dashboard_mobile_sections" in patch:
            current["dashboard_mobile_sections"] = self._normalize_dashboard_mobile_sections(
                patch.get("dashboard_mobile_sections")
            )

        data[key] = current
        self._save_all(data)
        return current


settings_service = SettingsService()
