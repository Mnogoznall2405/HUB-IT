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
    DASHBOARD_SECTION_KEYS = ("attention", "tasks", "communication", "news")
    DEFAULT_DASHBOARD_SECTIONS = ["attention", "tasks", "communication", "news"]
    DASHBOARD_MOBILE_SECTION_KEYS = ("urgent", "announcements", "tasks")
    MOBILE_BOTTOM_NAV_ITEM_PATHS = (
        "/dashboard",
        "/tasks",
        "/tickets",
        "/chat",
        "/mail",
        "/address-book",
        "/passwords",
        "/my-files",
        "/database",
        "/networks",
        "/vcs",
        "/mfu",
        "/computers",
        "/scan-center",
        "/statistics",
        "/kb",
    )
    DEFAULT_MOBILE_BOTTOM_NAV_ITEMS = ["/dashboard", "/tasks", "/chat", "/mail"]
    DEFAULTS = {
        "pinned_database": None,
        "theme_mode": "light",
        "font_family": "Aptos",
        "font_scale": 1.0,
        "dashboard_sections": DEFAULT_DASHBOARD_SECTIONS,
        "dashboard_mobile_sections": ["urgent", "announcements", "tasks"],
        "mobile_bottom_nav_items": DEFAULT_MOBILE_BOTTOM_NAV_ITEMS,
        "database_branch_filters": {},
    }
    ALLOWED_FONT_FAMILIES = {"Aptos", "Inter", "Roboto", "Segoe UI"}

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

    def _normalize_dashboard_sections(self, value, legacy_value=None) -> list[str]:
        if value is None and legacy_value is None:
            return list(self.DEFAULT_DASHBOARD_SECTIONS)
        using_legacy_value = value is None and legacy_value is not None
        raw_value = value
        if raw_value is None:
            raw_value = legacy_value
        if isinstance(raw_value, str):
            try:
                raw_value = json.loads(raw_value)
            except Exception:
                raw_value = []
        if not isinstance(raw_value, (list, tuple)):
            raw_value = []

        tokens = [str(item or "").strip().lower() for item in raw_value]
        if tokens and (
            using_legacy_value
            or any(token in {"urgent", "announcements"} for token in tokens)
            or not any(token in self.DASHBOARD_SECTION_KEYS for token in tokens)
        ):
            legacy_map = {
                "urgent": "attention",
                "tasks": "tasks",
                "announcements": "news",
            }
            tokens = [legacy_map[token] for token in tokens if token in legacy_map]
            if "communication" not in tokens:
                insert_at = tokens.index("news") if "news" in tokens else len(tokens)
                tokens.insert(insert_at, "communication")

        result: list[str] = ["attention"]
        for token in tokens:
            if token in self.DASHBOARD_SECTION_KEYS and token not in result:
                result.append(token)
        return result

    def _dashboard_sections_to_legacy(self, value) -> list[str]:
        normalized = self._normalize_dashboard_sections(value)
        reverse_map = {
            "attention": "urgent",
            "tasks": "tasks",
            "news": "announcements",
        }
        result = [
            reverse_map[item]
            for item in normalized
            if item in reverse_map
        ]
        return result or list(self.DEFAULTS["dashboard_mobile_sections"])

    def _normalize_mobile_bottom_nav_items(self, value) -> list[str]:
        if value is None:
            return list(self.DEFAULT_MOBILE_BOTTOM_NAV_ITEMS)

        raw_value = value
        if isinstance(raw_value, str):
            try:
                raw_value = json.loads(raw_value)
            except Exception:
                return list(self.DEFAULT_MOBILE_BOTTOM_NAV_ITEMS)
        if not isinstance(raw_value, (list, tuple)):
            return list(self.DEFAULT_MOBILE_BOTTOM_NAV_ITEMS)

        result: list[str] = []
        for item in raw_value:
            path = str(item or "").strip()
            if path in self.MOBILE_BOTTOM_NAV_ITEM_PATHS and path not in result:
                result.append(path)
            if len(result) >= 4:
                break
        return result

    def _normalize_database_branch_filters(self, value) -> dict[str, str]:
        raw_value = value
        if isinstance(raw_value, str):
            try:
                raw_value = json.loads(raw_value)
            except Exception:
                return {}
        if not isinstance(raw_value, dict):
            return {}

        result: dict[str, str] = {}
        for db_id, branch_name in raw_value.items():
            key = str(db_id or "").strip()
            if not key:
                continue
            result[key] = str(branch_name or "").strip()
        return result

    def _merge_database_branch_filters(self, current: dict[str, str], patch: dict) -> dict[str, str]:
        merged = dict(self._normalize_database_branch_filters(current))
        if not isinstance(patch, dict):
            return merged
        for db_id, branch_name in patch.items():
            key = str(db_id or "").strip()
            if not key:
                continue
            merged[key] = str(branch_name or "").strip()
        return merged

    def _load_all(self) -> dict[str, dict]:
        if self._use_app_database:
            with app_session(self._database_url) as session:
                rows = session.scalars(select(AppUserSetting).order_by(AppUserSetting.user_id.asc())).all()
                return {
                    str(int(row.user_id)): {
                        "pinned_database": row.pinned_database,
                        "theme_mode": str(row.theme_mode or "light"),
                        "font_family": str(row.font_family or "Aptos"),
                        "font_scale": float(row.font_scale or 1.0),
                        "dashboard_sections": self._normalize_dashboard_sections(
                            row.dashboard_mobile_sections_json,
                            row.dashboard_mobile_sections_json,
                        ),
                        "dashboard_mobile_sections": self._dashboard_sections_to_legacy(
                            row.dashboard_mobile_sections_json
                        ),
                        "mobile_bottom_nav_items": self._normalize_mobile_bottom_nav_items(row.mobile_bottom_nav_items_json),
                        "database_branch_filters": self._normalize_database_branch_filters(
                            row.database_branch_filters_json
                        ),
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
                    row.font_family = str(payload.get("font_family") or "Aptos")
                    row.font_scale = float(payload.get("font_scale") or 1.0)
                    dashboard_sections = self._normalize_dashboard_sections(
                        payload.get("dashboard_sections"),
                        payload.get("dashboard_mobile_sections"),
                    )
                    row.dashboard_mobile_sections_json = json.dumps(dashboard_sections)
                    row.mobile_bottom_nav_items_json = json.dumps(
                        self._normalize_mobile_bottom_nav_items(payload.get("mobile_bottom_nav_items"))
                    )
                    row.database_branch_filters_json = json.dumps(
                        self._normalize_database_branch_filters(payload.get("database_branch_filters"))
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
        if settings["font_family"] not in self.ALLOWED_FONT_FAMILIES:
            settings["font_family"] = "Aptos"
        try:
            scale = float(settings.get("font_scale", 1.0))
        except (TypeError, ValueError):
            scale = 1.0
        settings["font_scale"] = max(0.9, min(1.2, scale))
        settings["dashboard_sections"] = self._normalize_dashboard_sections(
            raw.get("dashboard_sections"),
            raw.get("dashboard_mobile_sections"),
        )
        settings["dashboard_mobile_sections"] = self._dashboard_sections_to_legacy(
            settings["dashboard_sections"]
        )
        settings["mobile_bottom_nav_items"] = self._normalize_mobile_bottom_nav_items(
            settings.get("mobile_bottom_nav_items")
        )
        settings["database_branch_filters"] = self._normalize_database_branch_filters(
            raw.get("database_branch_filters")
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
        if "font_family" in patch and str(patch.get("font_family")) in self.ALLOWED_FONT_FAMILIES:
            current["font_family"] = str(patch.get("font_family"))
        if "font_scale" in patch:
            try:
                scale = float(patch.get("font_scale"))
                current["font_scale"] = max(0.9, min(1.2, scale))
            except (TypeError, ValueError):
                pass
        if "dashboard_sections" in patch or "dashboard_mobile_sections" in patch:
            current["dashboard_sections"] = self._normalize_dashboard_sections(
                patch.get("dashboard_sections"),
                patch.get("dashboard_mobile_sections"),
            )
            current["dashboard_mobile_sections"] = self._dashboard_sections_to_legacy(
                current["dashboard_sections"]
            )
        if "mobile_bottom_nav_items" in patch:
            current["mobile_bottom_nav_items"] = self._normalize_mobile_bottom_nav_items(
                patch.get("mobile_bottom_nav_items")
            )
        if "database_branch_filters" in patch:
            current["database_branch_filters"] = self._merge_database_branch_filters(
                current.get("database_branch_filters"),
                patch.get("database_branch_filters"),
            )

        data[key] = current
        self._save_all(data)
        return current


settings_service = SettingsService()
