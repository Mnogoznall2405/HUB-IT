"""
Web users service backed by JSON storage.
"""
from __future__ import annotations

import base64
import hashlib
import hmac
import json
import os
import secrets
from datetime import datetime, timezone
from pathlib import Path
from typing import Optional
import logging

import ldap3

from sqlalchemy import delete, func, select

from backend.appdb.db import (
    apply_postgres_local_timeouts,
    app_session,
    initialize_app_schema,
    is_app_database_configured,
    run_with_transient_lock_retry,
)
from backend.appdb.models import AppTaskDelegateUserLink, AppUser
from local_store import get_local_store
from backend.config import config
from backend.services.authorization_service import authorization_service
from backend.services.secret_crypto_service import SecretCryptoError, encrypt_secret
from backend.services.session_auth_context_service import normalize_exchange_login

_UNSET = object()
SYSTEM_BOT_USERNAME_PREFIX = "__ai_bot__"


def _utc_now_iso() -> str:
    return datetime.now(timezone.utc).isoformat()


def build_default_ldap_mailbox_email(username: str | None) -> str:
    normalized = str(username or "").strip().lower()
    if not normalized:
        return ""
    if "\\" in normalized:
        normalized = normalized.split("\\")[-1].strip()
    if "/" in normalized and "@" not in normalized:
        normalized = normalized.split("/")[-1].strip()
    if "@" in normalized:
        return normalized
    mailbox_local_part = normalized.replace("_", ".")
    support_email = str(os.getenv("EMAIL_ADDRESS", "") or "").strip().lower()
    domain = support_email.split("@", 1)[1] if "@" in support_email else "zsgp.ru"
    return f"{mailbox_local_part}@{domain}"


class UserService:
    """CRUD/authentication operations for web users."""

    FILE_NAME = "web_users.json"
    TASK_DELEGATES_FILE_NAME = "web_task_delegate_links.json"
    PBKDF2_ITERATIONS = 120_000

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
        self._ensure_defaults()

    @staticmethod
    def _normalize_username(username: str) -> str:
        return str(username or "").strip().lower()

    @staticmethod
    def is_system_hidden_username(username: object) -> bool:
        normalized = str(username or "").strip().lower()
        return bool(normalized) and normalized.startswith(SYSTEM_BOT_USERNAME_PREFIX)

    @classmethod
    def is_system_hidden_user(cls, user: dict | None) -> bool:
        if not isinstance(user, dict):
            return False
        return cls.is_system_hidden_username(user.get("username"))

    def _load_users(self) -> list[dict]:
        if self._use_app_database:
            def _load_from_app_db() -> list[dict]:
                with app_session(self._database_url) as session:
                    apply_postgres_local_timeouts(session, lock_timeout_ms=1500, statement_timeout_ms=5000)
                    rows = session.scalars(select(AppUser).order_by(AppUser.id.asc())).all()
                    return [self._row_to_user_dict(row) for row in rows]

            return run_with_transient_lock_retry(_load_from_app_db)
        data = self.store.load_json(self.FILE_NAME, default_content=[])
        return data if isinstance(data, list) else []

    def _save_users(self, users: list[dict]) -> None:
        if self._use_app_database:
            with app_session(self._database_url) as session:
                existing_rows = session.scalars(select(AppUser)).all()
                existing_by_id = {int(row.id): row for row in existing_rows}
                incoming_ids: set[int] = set()
                for payload in users:
                    user_id = int(payload.get("id", 0))
                    if user_id <= 0:
                        continue
                    incoming_ids.add(user_id)
                    row = existing_by_id.get(user_id)
                    if row is None:
                        row = AppUser(id=user_id)
                        session.add(row)
                    self._apply_user_payload(row, payload)
                for user_id, row in existing_by_id.items():
                    if user_id not in incoming_ids:
                        session.delete(row)
            return
        self.store.save_json(self.FILE_NAME, users)

    @staticmethod
    def _normalize_delegate_role_type(value: object) -> str:
        normalized = str(value or "").strip().lower()
        if normalized not in {"assistant", "deputy"}:
            return "assistant"
        return normalized

    def _load_task_delegate_links(self) -> list[dict]:
        if self._use_app_database:
            def _load_links_from_app_db() -> list[dict]:
                with app_session(self._database_url) as session:
                    apply_postgres_local_timeouts(session, lock_timeout_ms=1500, statement_timeout_ms=5000)
                    rows = session.scalars(
                        select(AppTaskDelegateUserLink).order_by(
                            AppTaskDelegateUserLink.owner_user_id.asc(),
                            AppTaskDelegateUserLink.delegate_user_id.asc(),
                        )
                    ).all()
                    return [
                        {
                            "id": int(row.id),
                            "owner_user_id": int(row.owner_user_id),
                            "delegate_user_id": int(row.delegate_user_id),
                            "role_type": self._normalize_delegate_role_type(row.role_type),
                            "is_active": bool(row.is_active),
                            "created_at": row.created_at.isoformat() if row.created_at else None,
                            "updated_at": row.updated_at.isoformat() if row.updated_at else None,
                        }
                        for row in rows
                    ]

            return run_with_transient_lock_retry(_load_links_from_app_db)
        data = self.store.load_json(self.TASK_DELEGATES_FILE_NAME, default_content=[])
        return data if isinstance(data, list) else []

    def _save_task_delegate_links(self, links: list[dict]) -> None:
        if self._use_app_database:
            with app_session(self._database_url) as session:
                existing_rows = session.scalars(select(AppTaskDelegateUserLink)).all()
                for row in existing_rows:
                    session.delete(row)
                for payload in links:
                    owner_user_id = int(payload.get("owner_user_id", 0))
                    delegate_user_id = int(payload.get("delegate_user_id", 0))
                    if owner_user_id <= 0 or delegate_user_id <= 0:
                        continue
                    row = AppTaskDelegateUserLink(
                        owner_user_id=owner_user_id,
                        delegate_user_id=delegate_user_id,
                    )
                    row.role_type = self._normalize_delegate_role_type(payload.get("role_type"))
                    row.is_active = bool(payload.get("is_active", True))
                    created_at = str(payload.get("created_at") or "").strip()
                    updated_at = str(payload.get("updated_at") or "").strip()
                    row.created_at = datetime.fromisoformat(created_at) if created_at else datetime.now(timezone.utc)
                    row.updated_at = datetime.fromisoformat(updated_at) if updated_at else datetime.now(timezone.utc)
                    session.add(row)
            return
        self.store.save_json(self.TASK_DELEGATES_FILE_NAME, links)

    def _replace_task_delegate_links_for_owner_in_app_db(self, owner_user_id: int, links: list[dict]) -> None:
        owner_id = int(owner_user_id or 0)
        if owner_id <= 0:
            return
        now = datetime.now(timezone.utc)
        with app_session(self._database_url) as session:
            existing_rows = session.scalars(
                select(AppTaskDelegateUserLink).where(AppTaskDelegateUserLink.owner_user_id == owner_id)
            ).all()
            existing_by_delegate_id = {int(row.delegate_user_id): row for row in existing_rows}
            incoming_delegate_ids: set[int] = set()
            for payload in links:
                delegate_user_id = int(payload.get("delegate_user_id", 0))
                if delegate_user_id <= 0:
                    continue
                incoming_delegate_ids.add(delegate_user_id)
                row = existing_by_delegate_id.get(delegate_user_id)
                if row is None:
                    row = AppTaskDelegateUserLink(
                        owner_user_id=owner_id,
                        delegate_user_id=delegate_user_id,
                    )
                    created_at = str(payload.get("created_at") or "").strip()
                    row.created_at = datetime.fromisoformat(created_at) if created_at else now
                    session.add(row)
                row.role_type = self._normalize_delegate_role_type(payload.get("role_type"))
                row.is_active = bool(payload.get("is_active", True))
                updated_at = str(payload.get("updated_at") or "").strip()
                row.updated_at = datetime.fromisoformat(updated_at) if updated_at else now
            for delegate_user_id, row in existing_by_delegate_id.items():
                if delegate_user_id not in incoming_delegate_ids:
                    session.delete(row)

    def _delete_task_delegate_links_for_user_in_app_db(self, user_id: int) -> None:
        normalized_user_id = int(user_id or 0)
        if normalized_user_id <= 0:
            return
        with app_session(self._database_url) as session:
            session.execute(
                delete(AppTaskDelegateUserLink).where(
                    (AppTaskDelegateUserLink.owner_user_id == normalized_user_id)
                    | (AppTaskDelegateUserLink.delegate_user_id == normalized_user_id)
                )
            )

    @staticmethod
    def _row_to_user_dict(row: AppUser) -> dict:
        try:
            custom_permissions = json.loads(str(row.custom_permissions_json or "[]"))
        except Exception:
            custom_permissions = []
        if not isinstance(custom_permissions, list):
            custom_permissions = []
        return {
            "id": int(row.id),
            "username": str(row.username),
            "email": row.email,
            "full_name": row.full_name,
            "department": row.department,
            "job_title": row.job_title,
            "is_active": bool(row.is_active),
            "role": str(row.role or "viewer"),
            "use_custom_permissions": bool(row.use_custom_permissions),
            "custom_permissions": authorization_service.normalize_permissions(custom_permissions),
            "auth_source": str(row.auth_source or "local"),
            "telegram_id": row.telegram_id,
            "assigned_database": row.assigned_database,
            "mailbox_email": row.mailbox_email,
            "mailbox_login": row.mailbox_login,
            "mailbox_password_enc": str(row.mailbox_password_enc or ""),
            "mail_signature_html": row.mail_signature_html,
            "mail_updated_at": row.mail_updated_at.isoformat() if row.mail_updated_at else None,
            "totp_secret_enc": str(row.totp_secret_enc or ""),
            "is_2fa_enabled": bool(row.is_2fa_enabled),
            "twofa_enabled_at": row.twofa_enabled_at.isoformat() if row.twofa_enabled_at else None,
            "password_hash": str(row.password_hash or ""),
            "password_salt": str(row.password_salt or ""),
            "created_at": row.created_at.isoformat() if row.created_at else None,
            "updated_at": row.updated_at.isoformat() if row.updated_at else None,
        }

    @staticmethod
    def _apply_user_payload(row: AppUser, payload: dict) -> None:
        custom_permissions = authorization_service.normalize_permissions(payload.get("custom_permissions"))
        row.username = str(payload.get("username") or "")
        row.email = payload.get("email")
        row.full_name = payload.get("full_name")
        row.department = (str(payload.get("department") or "").strip() or None)
        row.job_title = (str(payload.get("job_title") or "").strip() or None)
        row.is_active = bool(payload.get("is_active", True))
        row.role = str(payload.get("role") or "viewer")
        row.use_custom_permissions = bool(payload.get("use_custom_permissions", False))
        row.custom_permissions_json = json.dumps(custom_permissions, ensure_ascii=False)
        row.auth_source = str(payload.get("auth_source") or "local")
        row.telegram_id = int(payload.get("telegram_id")) if payload.get("telegram_id") not in (None, "") else None
        row.assigned_database = (str(payload.get("assigned_database") or "").strip() or None)
        row.mailbox_email = (str(payload.get("mailbox_email") or "").strip() or None)
        row.mailbox_login = (str(payload.get("mailbox_login") or "").strip() or None)
        row.mailbox_password_enc = str(payload.get("mailbox_password_enc") or "")
        row.mail_signature_html = (str(payload.get("mail_signature_html") or "").strip() or None)
        row.totp_secret_enc = str(payload.get("totp_secret_enc") or "")
        row.is_2fa_enabled = bool(payload.get("is_2fa_enabled", False))
        twofa_enabled_at = str(payload.get("twofa_enabled_at") or "").strip()
        row.twofa_enabled_at = datetime.fromisoformat(twofa_enabled_at) if twofa_enabled_at else None
        row.password_hash = str(payload.get("password_hash") or "")
        row.password_salt = str(payload.get("password_salt") or "")
        mail_updated_at = str(payload.get("mail_updated_at") or "").strip()
        row.mail_updated_at = datetime.fromisoformat(mail_updated_at) if mail_updated_at else None
        created_at = str(payload.get("created_at") or "").strip()
        updated_at = str(payload.get("updated_at") or "").strip()
        row.created_at = datetime.fromisoformat(created_at) if created_at else datetime.now(timezone.utc)
        row.updated_at = datetime.fromisoformat(updated_at) if updated_at else datetime.now(timezone.utc)

    @classmethod
    def _hash_password(cls, password: str, salt_b64: Optional[str] = None) -> tuple[str, str]:
        salt = base64.b64decode(salt_b64) if salt_b64 else secrets.token_bytes(16)
        digest = hashlib.pbkdf2_hmac("sha256", password.encode("utf-8"), salt, cls.PBKDF2_ITERATIONS)
        return base64.b64encode(digest).decode("ascii"), base64.b64encode(salt).decode("ascii")

    @classmethod
    def _verify_password(cls, password: str, password_hash_b64: str, salt_b64: str) -> bool:
        digest_b64, _ = cls._hash_password(password, salt_b64=salt_b64)
        return hmac.compare_digest(digest_b64, password_hash_b64)

    @staticmethod
    def _sanitize_user(user: dict) -> dict:
        custom_permissions = authorization_service.normalize_permissions(user.get("custom_permissions"))
        use_custom_permissions = bool(user.get("use_custom_permissions", False))
        mailbox_email = (str(user.get("mailbox_email") or "").strip() or None)
        mailbox_login = (str(user.get("mailbox_login") or "").strip() or None)
        mail_signature_html = (str(user.get("mail_signature_html") or "").strip() or None)
        mailbox_password_enc = str(user.get("mailbox_password_enc") or "").strip()
        auth_source = str(user.get("auth_source") or "local")
        effective_mailbox_email = mailbox_email or (str(user.get("email") or "").strip() or None)
        if auth_source == "ldap" and not effective_mailbox_email:
            effective_mailbox_email = build_default_ldap_mailbox_email(user.get("username")) or None
        if auth_source == "ldap":
            mail_is_configured = bool(effective_mailbox_email)
        else:
            effective_mailbox_login = mailbox_login or effective_mailbox_email
            mail_is_configured = bool(effective_mailbox_email and effective_mailbox_login and mailbox_password_enc)
        return {
            "id": int(user["id"]),
            "username": str(user["username"]),
            "email": user.get("email"),
            "full_name": user.get("full_name"),
            "department": (str(user.get("department") or "").strip() or None),
            "job_title": (str(user.get("job_title") or "").strip() or None),
            "is_active": bool(user.get("is_active", True)),
            "role": str(user.get("role") or "viewer"),
            "use_custom_permissions": use_custom_permissions,
            "custom_permissions": custom_permissions,
            "auth_source": auth_source,
            "telegram_id": user.get("telegram_id"),
            "assigned_database": (str(user.get("assigned_database") or "").strip() or None),
            "mailbox_email": effective_mailbox_email,
            "mailbox_login": mailbox_login,
            "mail_signature_html": mail_signature_html,
            "mail_is_configured": mail_is_configured,
            "is_2fa_enabled": bool(user.get("is_2fa_enabled", False)),
            "trusted_devices_count": int(user.get("trusted_devices_count", 0) or 0),
            "discoverable_trusted_devices_count": int(user.get("discoverable_trusted_devices_count", 0) or 0),
            "twofa_enforced": bool(config.security.twofa_enforced),
        }

    def to_public_user(self, user: dict) -> dict:
        """Return safe user representation without password fields."""
        return self._sanitize_user(user)

    def list_task_delegates(self, owner_user_id: int) -> list[dict]:
        owner_id = int(owner_user_id or 0)
        if owner_id <= 0:
            return []
        users_by_id = {int(item.get("id", 0)): item for item in self._load_users()}
        out: list[dict] = []
        for item in self._load_task_delegate_links():
            if int(item.get("owner_user_id", 0)) != owner_id:
                continue
            delegate_user = users_by_id.get(int(item.get("delegate_user_id", 0)))
            if not delegate_user:
                continue
            out.append(
                {
                    "owner_user_id": owner_id,
                    "delegate_user_id": int(delegate_user.get("id", 0)),
                    "role_type": self._normalize_delegate_role_type(item.get("role_type")),
                    "is_active": bool(item.get("is_active", True)),
                    "delegate_username": str(delegate_user.get("username") or ""),
                    "delegate_full_name": delegate_user.get("full_name"),
                    "delegate_department": delegate_user.get("department"),
                    "delegate_job_title": delegate_user.get("job_title"),
                    "delegate_is_active": bool(delegate_user.get("is_active", True)),
                }
            )
        out.sort(
            key=lambda row: (
                not bool(row.get("is_active", True)),
                str(row.get("delegate_full_name") or row.get("delegate_username") or "").lower(),
            )
        )
        return out

    def replace_task_delegates(self, owner_user_id: int, items: list[dict] | None) -> list[dict]:
        owner_id = int(owner_user_id or 0)
        owner_user = self.get_by_id(owner_id)
        if owner_id <= 0 or not owner_user:
            raise ValueError("Owner user not found")

        users_by_id = {int(item.get("id", 0)): item for item in self._load_users()}
        now_iso = _utc_now_iso()
        normalized_items: list[dict] = []
        seen_delegate_ids: set[int] = set()
        for raw in items if isinstance(items, list) else []:
            delegate_user_id = int(raw.get("delegate_user_id") or 0)
            if delegate_user_id <= 0 or delegate_user_id == owner_id or delegate_user_id in seen_delegate_ids:
                continue
            delegate_user = users_by_id.get(delegate_user_id)
            if not delegate_user or not bool(delegate_user.get("is_active", True)):
                continue
            seen_delegate_ids.add(delegate_user_id)
            normalized_items.append(
                {
                    "owner_user_id": owner_id,
                    "delegate_user_id": delegate_user_id,
                    "role_type": self._normalize_delegate_role_type(raw.get("role_type")),
                    "is_active": bool(raw.get("is_active", True)),
                    "created_at": now_iso,
                    "updated_at": now_iso,
                }
            )

        if self._use_app_database:
            self._replace_task_delegate_links_for_owner_in_app_db(owner_id, normalized_items)
            return self.list_task_delegates(owner_id)

        existing = self._load_task_delegate_links()
        filtered = [item for item in existing if int(item.get("owner_user_id", 0)) != owner_id]
        filtered.extend(normalized_items)
        self._save_task_delegate_links(filtered)
        return self.list_task_delegates(owner_id)

    def get_delegate_user_ids(self, owner_user_id: int, *, active_only: bool = True) -> list[int]:
        owner_id = int(owner_user_id or 0)
        if owner_id <= 0:
            return []
        out: list[int] = []
        users_by_id = {int(item.get("id", 0)): item for item in self._load_users()}
        for item in self._load_task_delegate_links():
            if int(item.get("owner_user_id", 0)) != owner_id:
                continue
            if active_only and not bool(item.get("is_active", True)):
                continue
            delegate_user_id = int(item.get("delegate_user_id", 0))
            delegate_user = users_by_id.get(delegate_user_id)
            if active_only and (not delegate_user or not bool(delegate_user.get("is_active", True))):
                continue
            if delegate_user_id > 0 and delegate_user_id not in out:
                out.append(delegate_user_id)
        return out

    def get_delegate_owner_ids(self, delegate_user_id: int, *, active_only: bool = True) -> list[int]:
        normalized_delegate_id = int(delegate_user_id or 0)
        if normalized_delegate_id <= 0:
            return []
        users_by_id = {int(item.get("id", 0)): item for item in self._load_users()}
        out: list[int] = []
        for item in self._load_task_delegate_links():
            if int(item.get("delegate_user_id", 0)) != normalized_delegate_id:
                continue
            if active_only and not bool(item.get("is_active", True)):
                continue
            owner_user_id = int(item.get("owner_user_id", 0))
            owner_user = users_by_id.get(owner_user_id)
            if active_only and (not owner_user or not bool(owner_user.get("is_active", True))):
                continue
            if owner_user_id > 0 and owner_user_id not in out:
                out.append(owner_user_id)
        return out

    def _ensure_defaults(self) -> None:
        try:
            users = self._load_users()
        except Exception as exc:
            logging.getLogger(__name__).warning("Skipping user defaults bootstrap: %s", exc)
            return
        if users:
            return

        now = _utc_now_iso()
        defaults = [
            {
                "id": 1,
                "username": "admin",
                "email": "admin@itinvent.ru",
                "full_name": "Administrator",
                "department": None,
                "job_title": None,
                "is_active": True,
                "role": "admin",
                "use_custom_permissions": False,
                "custom_permissions": [],
                "telegram_id": None,
                "assigned_database": None,
                "mailbox_email": None,
                "mailbox_login": None,
                "mailbox_password_enc": "",
                "mail_signature_html": None,
                "mail_updated_at": None,
                "created_at": now,
                "updated_at": now,
            },
            {
                "id": 2,
                "username": "user",
                "email": "user@itinvent.ru",
                "full_name": "Regular User",
                "department": None,
                "job_title": None,
                "is_active": True,
                "role": "operator",
                "use_custom_permissions": False,
                "custom_permissions": [],
                "auth_source": "local",
                "telegram_id": None,
                "assigned_database": None,
                "mailbox_email": None,
                "mailbox_login": None,
                "mailbox_password_enc": "",
                "mail_signature_html": None,
                "mail_updated_at": None,
                "created_at": now,
                "updated_at": now,
            },
        ]
        # Для дефолтных админа и юзера прописываем local явно
        defaults[0]["auth_source"] = "local"
        for item, password in ((defaults[0], "admin"), (defaults[1], "user123")):
            password_hash, salt = self._hash_password(password)
            item["password_hash"] = password_hash
            item["password_salt"] = salt
        self._save_users(defaults)

    def get_by_username(self, username: str) -> Optional[dict]:
        normalized = self._normalize_username(username)
        if not normalized:
            return None
        if self._use_app_database:
            def _load_user_from_app_db() -> Optional[dict]:
                with app_session(self._database_url) as session:
                    apply_postgres_local_timeouts(session, lock_timeout_ms=1500, statement_timeout_ms=3000)
                    row = session.scalars(
                        select(AppUser).where(func.lower(AppUser.username) == normalized).limit(1)
                    ).first()
                    return self._row_to_user_dict(row) if row is not None else None

            return run_with_transient_lock_retry(_load_user_from_app_db)
        for user in self._load_users():
            if self._normalize_username(user.get("username")) == normalized:
                return user
        return None

    def get_by_id(self, user_id: int) -> Optional[dict]:
        normalized_user_id = int(user_id or 0)
        if normalized_user_id <= 0:
            return None
        if self._use_app_database:
            def _load_user_from_app_db() -> Optional[dict]:
                with app_session(self._database_url) as session:
                    apply_postgres_local_timeouts(session, lock_timeout_ms=1500, statement_timeout_ms=3000)
                    row = session.get(AppUser, normalized_user_id)
                    return self._row_to_user_dict(row) if row is not None else None

            return run_with_transient_lock_retry(_load_user_from_app_db)
        for user in self._load_users():
            if int(user.get("id", 0)) == normalized_user_id:
                return user
        return None

    def authenticate(self, username: str, password: str) -> Optional[dict]:
        user = self.get_by_username(username)
        if not user:
            return None
        if not bool(user.get("is_active", True)):
            return None
            
        auth_source = user.get("auth_source", "local")
        
        if auth_source == "ldap":
            if not config.app.ldap_server:
                logging.getLogger(__name__).error("LDAP authentication failed: LDAP_SERVER not configured")
                return None
            try:
                domain = config.app.ldap_domain or "zsgp.corp"
                user_principal = f"{username}@{domain}"
                server = ldap3.Server(config.app.ldap_server, get_info=ldap3.ALL)
                # Попытка bind (авторизации) с логином-паролем пользователя
                conn = ldap3.Connection(server, user=user_principal, password=password, auto_bind=True)
                conn.unbind()
                return self._sanitize_user(user)
            except ldap3.core.exceptions.LDAPInvalidCredentialsResult:
                return None
            except Exception as e:
                logging.getLogger(__name__).error(f"LDAP authentication error for {username}: {str(e)}")
                return None
                
        # Если auth_source == local (или отсутствует)
        if not self._verify_password(
            password=password,
            password_hash_b64=str(user.get("password_hash") or ""),
            salt_b64=str(user.get("password_salt") or ""),
        ):
            return None
            
        return self._sanitize_user(user)

    def list_users(self) -> list[dict]:
        users = self._load_users()
        return [
            self._sanitize_user(user)
            for user in users
            if not self.is_system_hidden_user(user)
        ]

    def get_users_map_by_ids(self, user_ids: list[int] | set[int] | tuple[int, ...]) -> dict[int, dict]:
        normalized_user_ids = {
            int(item)
            for item in list(user_ids or [])
            if int(item) > 0
        }
        if not normalized_user_ids:
            return {}
        if self._use_app_database:
            def _load_map_users_from_app_db() -> list[dict]:
                with app_session(self._database_url) as session:
                    apply_postgres_local_timeouts(session, lock_timeout_ms=1500, statement_timeout_ms=5000)
                    rows = session.scalars(
                        select(AppUser).where(AppUser.id.in_(normalized_user_ids)).order_by(AppUser.id.asc())
                    ).all()
                    return [self._row_to_user_dict(row) for row in rows]

            users = run_with_transient_lock_retry(_load_map_users_from_app_db)
        else:
            users = self._load_users()
        result: dict[int, dict] = {}
        for user in users:
            user_id = int(user.get("id", 0) or 0)
            if user_id <= 0 or user_id not in normalized_user_ids:
                continue
            result[user_id] = self._sanitize_user(user)
        return result

    def create_user(
        self,
        username: str,
        password: Optional[str] = None,
        role: str = "viewer",
        auth_source: str = "local",
        email: Optional[str] = None,
        full_name: Optional[str] = None,
        department: Optional[str] = None,
        job_title: Optional[str] = None,
        telegram_id: Optional[int] = None,
        assigned_database: Optional[str] = None,
        is_active: bool = True,
        use_custom_permissions: bool = False,
        custom_permissions: Optional[list[str]] = None,
        mailbox_email: Optional[str] = None,
        mailbox_login: Optional[str] = None,
        mailbox_password: Optional[str] = None,
        mail_signature_html: Optional[str] = None,
    ) -> dict:
        normalized = self._normalize_username(username)
        if not normalized:
            raise ValueError("Username is required")
        if self.get_by_username(normalized):
            raise ValueError("User already exists")

        users = self._load_users()
        next_id = max([int(u.get("id", 0)) for u in users], default=0) + 1
        if password:
            password_hash, salt = self._hash_password(password)
        else:
            password_hash, salt = "", ""

        mailbox_password_enc = ""
        if str(mailbox_password or "").strip():
            try:
                mailbox_password_enc = encrypt_secret(str(mailbox_password or "").strip())
            except SecretCryptoError as exc:
                raise ValueError(str(exc)) from exc

        now = _utc_now_iso()
        created = {
            "id": next_id,
            "username": normalized,
            "email": email,
            "full_name": full_name,
            "department": (str(department or "").strip() or None),
            "job_title": (str(job_title or "").strip() or None),
            "is_active": bool(is_active),
            "role": role if role in {"admin", "operator", "viewer"} else "viewer",
            "use_custom_permissions": bool(use_custom_permissions),
            "custom_permissions": authorization_service.normalize_permissions(custom_permissions),
            "auth_source": auth_source if auth_source in {"local", "ldap"} else "local",
            "telegram_id": int(telegram_id) if telegram_id not in (None, "") else None,
            "assigned_database": (str(assigned_database or "").strip() or None),
            "mailbox_email": (str(mailbox_email or "").strip() or None),
            "mailbox_login": (str(mailbox_login or "").strip() or None),
            "mailbox_password_enc": mailbox_password_enc,
            "mail_signature_html": (str(mail_signature_html or "").strip() or None),
            "mail_updated_at": now if (mailbox_email or mailbox_login or mailbox_password_enc or mail_signature_html) else None,
            "password_hash": password_hash,
            "password_salt": salt,
            "created_at": now,
            "updated_at": now,
        }
        
        users.append(created)
        self._save_users(users)
        if created.get("telegram_id"):
            from .user_db_selection_service import user_db_selection_service
            user_db_selection_service.set_assigned_database(created.get("telegram_id"), created.get("assigned_database"))
        return self._sanitize_user(created)

    def update_user(
        self,
        user_id: int,
        *,
        email: Optional[str] | object = _UNSET,
        full_name: Optional[str] | object = _UNSET,
        department: Optional[str] | object = _UNSET,
        job_title: Optional[str] | object = _UNSET,
        role: Optional[str] | object = _UNSET,
        auth_source: Optional[str] | object = _UNSET,
        telegram_id: Optional[int] | object = _UNSET,
        assigned_database: Optional[str] | object = _UNSET,
        is_active: Optional[bool] | object = _UNSET,
        password: Optional[str] | object = _UNSET,
        use_custom_permissions: Optional[bool] | object = _UNSET,
        custom_permissions: Optional[list[str]] | object = _UNSET,
        mailbox_email: Optional[str] | object = _UNSET,
        mailbox_login: Optional[str] | object = _UNSET,
        mailbox_password: Optional[str] | object = _UNSET,
        mail_signature_html: Optional[str] | object = _UNSET,
        totp_secret_enc: Optional[str] | object = _UNSET,
        is_2fa_enabled: Optional[bool] | object = _UNSET,
        twofa_enabled_at: Optional[str] | object = _UNSET,
    ) -> Optional[dict]:
        users = self._load_users()
        updated_user: Optional[dict] = None
        previous_telegram_id: Optional[int] = None
        for user in users:
            if int(user.get("id", 0)) != int(user_id):
                continue
            previous_telegram_id = user.get("telegram_id")
            if email is not _UNSET:
                user["email"] = email
            if full_name is not _UNSET:
                user["full_name"] = full_name
            if department is not _UNSET:
                user["department"] = (str(department or "").strip() or None)
            if job_title is not _UNSET:
                user["job_title"] = (str(job_title or "").strip() or None)
            if role is not _UNSET and role in {"admin", "operator", "viewer"}:
                user["role"] = role
            if auth_source is not _UNSET and auth_source in {"local", "ldap"}:
                user["auth_source"] = auth_source
            if telegram_id is not _UNSET:
                user["telegram_id"] = int(telegram_id) if telegram_id not in (None, "") else None
            if assigned_database is not _UNSET:
                user["assigned_database"] = (str(assigned_database or "").strip() or None)
            if is_active is not _UNSET:
                user["is_active"] = bool(is_active)
            if use_custom_permissions is not _UNSET:
                user["use_custom_permissions"] = bool(use_custom_permissions)
            if custom_permissions is not _UNSET:
                user["custom_permissions"] = authorization_service.normalize_permissions(custom_permissions)
            mail_fields_changed = False
            if mailbox_email is not _UNSET:
                user["mailbox_email"] = (str(mailbox_email or "").strip() or None)
                mail_fields_changed = True
            if mailbox_login is not _UNSET:
                user["mailbox_login"] = (str(mailbox_login or "").strip() or None)
                mail_fields_changed = True
            if mail_signature_html is not _UNSET:
                user["mail_signature_html"] = (str(mail_signature_html or "").strip() or None)
                mail_fields_changed = True
            if mailbox_password is not _UNSET:
                clear_password = not str(mailbox_password or "").strip()
                if clear_password:
                    user["mailbox_password_enc"] = ""
                else:
                    try:
                        user["mailbox_password_enc"] = encrypt_secret(str(mailbox_password or "").strip())
                    except SecretCryptoError as exc:
                        raise ValueError(str(exc)) from exc
                mail_fields_changed = True
            if mail_fields_changed:
                user["mail_updated_at"] = _utc_now_iso()
            if password is not _UNSET and password:
                password_hash, salt = self._hash_password(password)
                user["password_hash"] = password_hash
                user["password_salt"] = salt
            elif auth_source == "ldap":
                user["password_hash"] = ""
                user["password_salt"] = ""
            if totp_secret_enc is not _UNSET:
                user["totp_secret_enc"] = str(totp_secret_enc or "")
            if is_2fa_enabled is not _UNSET:
                user["is_2fa_enabled"] = bool(is_2fa_enabled)
            if twofa_enabled_at is not _UNSET:
                user["twofa_enabled_at"] = (str(twofa_enabled_at or "").strip() or None)
            user["updated_at"] = _utc_now_iso()
            updated_user = user
            break
        if not updated_user:
            return None
        self._save_users(users)
        from .user_db_selection_service import user_db_selection_service
        if previous_telegram_id not in (None, 0):
            if int(previous_telegram_id) != int(updated_user.get("telegram_id") or 0):
                user_db_selection_service.set_assigned_database(previous_telegram_id, None)
        if updated_user.get("telegram_id") is not None:
            user_db_selection_service.set_assigned_database(
                updated_user.get("telegram_id"),
                updated_user.get("assigned_database"),
            )
        return self._sanitize_user(updated_user)

    def change_password(self, user_id: int, old_password: str, new_password: str) -> bool:
        users = self._load_users()
        changed = False
        for user in users:
            if int(user.get("id", 0)) != int(user_id):
                continue
            if not self._verify_password(
                password=old_password,
                password_hash_b64=str(user.get("password_hash") or ""),
                salt_b64=str(user.get("password_salt") or ""),
            ):
                return False
            password_hash, salt = self._hash_password(new_password)
            user["password_hash"] = password_hash
            user["password_salt"] = salt
            user["updated_at"] = _utc_now_iso()
            changed = True
            break
        if changed:
            self._save_users(users)
        return changed

    def delete_user(self, user_id: int) -> bool:
        if user_id == 1:
            return False
            
        users = self._load_users()
        initial_count = len(users)
        users = [u for u in users if int(u.get("id", 0)) != user_id]
        
        if len(users) < initial_count:
            self._save_users(users)
            if self._use_app_database:
                self._delete_task_delegate_links_for_user_in_app_db(user_id)
                return True
            links = [
                item
                for item in self._load_task_delegate_links()
                if int(item.get("owner_user_id", 0)) != int(user_id)
                and int(item.get("delegate_user_id", 0)) != int(user_id)
            ]
            self._save_task_delegate_links(links)
            return True
        return False


user_service = UserService()
