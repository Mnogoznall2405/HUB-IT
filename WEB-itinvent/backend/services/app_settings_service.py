"""
Global web application settings storage and helpers.
"""
from __future__ import annotations

import ipaddress
import json
import logging
from datetime import datetime, timezone
from pathlib import Path
from typing import Any, Optional

from sqlalchemy import select

from backend.appdb.db import app_session, initialize_app_schema, is_app_database_configured
from backend.appdb.models import AppGlobalSetting
from backend.utils.request_network import normalize_ip_value
from local_store import SQLiteLocalStore

from backend.services.authorization_service import authorization_service
from backend.services.user_service import user_service

logger = logging.getLogger(__name__)


class AppSettingsService:
    """Persist global web settings in JSON."""

    FILE_NAME = "web_app_settings.json"
    DEFAULTS = {
        "transfer_act_reminder_controller_username": "kozlovskii.me",
        "admin_login_allowed_ips": ["10.105.0.42"],
    }

    def __init__(self, file_path: Optional[Path] = None, database_url: Optional[str] = None):
        if file_path is None:
            project_root = Path(__file__).resolve().parents[3]
            file_path = project_root / "data" / self.FILE_NAME
        self.file_path = file_path
        self.file_path.parent.mkdir(parents=True, exist_ok=True)
        self._database_url = str(database_url or "").strip() or None
        self._use_app_database = bool(self._database_url) or is_app_database_configured()
        self.store = None if self._use_app_database else SQLiteLocalStore(data_dir=self.file_path.parent)
        if self._use_app_database:
            initialize_app_schema(self._database_url)
        self._ensure_file()

    @staticmethod
    def _normalize_username(value: Any) -> Optional[str]:
        normalized = str(value or "").strip().lower()
        return normalized or None

    @staticmethod
    def _normalize_admin_login_allowed_ips(
        value: Any,
        *,
        require_non_empty: bool = False,
    ) -> list[str]:
        if isinstance(value, str):
            raw_items = [item.strip() for item in value.replace("\r", "\n").split("\n")]
        elif isinstance(value, (list, tuple, set)):
            raw_items = [str(item or "").strip() for item in value]
        else:
            raw_items = []

        normalized_items: list[str] = []
        seen: set[str] = set()
        invalid_items: list[str] = []

        for raw_item in raw_items:
            if not raw_item:
                continue
            try:
                normalized = str(ipaddress.ip_address(raw_item))
            except ValueError:
                invalid_items.append(raw_item)
                continue
            if normalized in seen:
                continue
            seen.add(normalized)
            normalized_items.append(normalized)

        if invalid_items:
            invalid_preview = ", ".join(invalid_items[:5])
            raise ValueError(f"Invalid admin_login_allowed_ips entries: {invalid_preview}")
        if require_non_empty and not normalized_items:
            raise ValueError("admin_login_allowed_ips must contain at least one valid IP")
        return normalized_items

    @staticmethod
    def _is_admin_user(row: dict[str, Any]) -> bool:
        return str(row.get("role") or "").strip().lower() == "admin"

    def _ensure_file(self) -> None:
        if self._use_app_database:
            return
        data = self.store.load_json(self.FILE_NAME, default_content={})
        if not isinstance(data, dict):
            self._save_all({})

    def _load_all(self) -> dict[str, Any]:
        if self._use_app_database:
            with app_session(self._database_url) as session:
                rows = session.scalars(select(AppGlobalSetting).order_by(AppGlobalSetting.key.asc())).all()
                out: dict[str, Any] = {}
                for row in rows:
                    try:
                        out[str(row.key)] = json.loads(str(row.value_json or "null"))
                    except Exception:
                        out[str(row.key)] = None
                return out
        data = self.store.load_json(self.FILE_NAME, default_content={})
        return data if isinstance(data, dict) else {}

    def _save_all(self, data: dict[str, Any]) -> None:
        if self._use_app_database:
            with app_session(self._database_url) as session:
                existing_rows = session.scalars(select(AppGlobalSetting)).all()
                existing_by_key = {str(row.key): row for row in existing_rows}
                incoming_keys = {str(key) for key in data}
                for key, value in data.items():
                    normalized_key = str(key).strip()
                    if not normalized_key:
                        continue
                    row = existing_by_key.get(normalized_key)
                    if row is None:
                        row = AppGlobalSetting(key=normalized_key)
                        session.add(row)
                    row.value_json = json.dumps(value, ensure_ascii=False)
                    row.updated_at = datetime.now(timezone.utc)
                for key, row in existing_by_key.items():
                    if key not in incoming_keys:
                        session.delete(row)
            return
        self.store.save_json(self.FILE_NAME, data)

    def get_settings(self) -> dict[str, Any]:
        raw = self._load_all()
        configured_username = self._normalize_username(raw.get("transfer_act_reminder_controller_username"))
        if configured_username is None:
            configured_username = self.DEFAULTS["transfer_act_reminder_controller_username"]
        try:
            admin_login_allowed_ips = self._normalize_admin_login_allowed_ips(
                raw.get("admin_login_allowed_ips"),
            )
        except ValueError:
            admin_login_allowed_ips = []
        if not admin_login_allowed_ips:
            admin_login_allowed_ips = list(self.DEFAULTS["admin_login_allowed_ips"])
        return {
            "transfer_act_reminder_controller_username": configured_username,
            "admin_login_allowed_ips": admin_login_allowed_ips,
        }

    def update_settings(self, patch: dict[str, Any]) -> dict[str, Any]:
        current = self.get_settings()
        data = self._load_all()
        if "transfer_act_reminder_controller_username" in patch:
            current["transfer_act_reminder_controller_username"] = self._normalize_username(
                patch.get("transfer_act_reminder_controller_username")
            )
        if "admin_login_allowed_ips" in patch:
            current["admin_login_allowed_ips"] = self._normalize_admin_login_allowed_ips(
                patch.get("admin_login_allowed_ips"),
                require_non_empty=True,
            )
        data.update(current)
        self._save_all(data)
        return current

    def get_admin_login_allowed_ips(self) -> list[str]:
        settings = self.get_settings()
        return list(settings.get("admin_login_allowed_ips") or [])

    def is_admin_login_ip_allowed(self, ip_value: Any) -> bool:
        normalized_ip = normalize_ip_value(ip_value)
        if not normalized_ip:
            return False
        return normalized_ip in set(self.get_admin_login_allowed_ips())

    def _active_review_users(self) -> list[dict[str, Any]]:
        users = []
        for row in user_service.list_users():
            if not bool(row.get("is_active", True)):
                continue
            is_admin = self._is_admin_user(row)
            permissions = authorization_service.get_effective_permissions(
                row.get("role"),
                use_custom_permissions=bool(row.get("use_custom_permissions", False)),
                custom_permissions=row.get("custom_permissions"),
            )
            if not is_admin and "tasks.review" not in permissions:
                continue
            users.append(
                {
                    "id": int(row.get("id", 0) or 0),
                    "username": self._normalize_username(row.get("username")) or "",
                    "full_name": str(row.get("full_name") or "").strip() or str(row.get("username") or "").strip(),
                    "role": str(row.get("role") or "viewer").strip().lower() or "viewer",
                }
            )
        users.sort(key=lambda item: (item.get("full_name") or "", item.get("username") or ""))
        return users

    def resolve_transfer_act_reminder_controller(self) -> dict[str, Any]:
        settings = self.get_settings()
        configured_username = self._normalize_username(settings.get("transfer_act_reminder_controller_username"))
        controllers = self._active_review_users()
        by_username = {
            self._normalize_username(item.get("username")) or "": item
            for item in controllers
        }

        resolved = None
        source = "none"
        warning = ""
        fallback_used = False

        if configured_username:
            configured = by_username.get(configured_username)
            if configured:
                resolved = configured
                source = "configured"
            else:
                warning = (
                    "Выбранный контролер по умолчанию недоступен или не имеет права tasks.review. "
                    "Использован fallback."
                )
                logger.warning(
                    "Transfer-act reminder controller fallback used: configured username '%s' is unavailable or is not admin/lacks tasks.review",
                    configured_username,
                )

        if resolved is None and controllers:
            resolved = controllers[0]
            fallback_used = True
            source = "fallback"

        if resolved is None and not warning:
            warning = "Не найден ни один активный пользователь с правом tasks.review."
            logger.warning("Transfer-act reminder controller resolution failed: no active admins or users with tasks.review were found")

        return {
            "transfer_act_reminder_controller_username": configured_username,
            "admin_login_allowed_ips": list(settings.get("admin_login_allowed_ips") or []),
            "available_controllers": controllers,
            "resolved_controller": resolved,
            "resolved_controller_source": source,
            "fallback_used": fallback_used,
            "warning": warning or None,
        }


app_settings_service = AppSettingsService()
