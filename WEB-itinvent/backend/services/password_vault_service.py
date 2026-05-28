"""Secure password vault storage and audit service."""
from __future__ import annotations

import json
import uuid
from dataclasses import dataclass
from datetime import datetime, timedelta, timezone
from typing import Any, Optional

from sqlalchemy import func, select

from backend.appdb.db import AppDatabaseConfigurationError, app_session, ensure_app_schema_initialized
from backend.appdb.models import AppPasswordVaultAudit, AppPasswordVaultEntry, AppPasswordVaultGroup
from backend.services.auth_runtime_store_service import auth_runtime_store_service
from backend.services.auth_security_service import auth_security_service
from backend.services.secret_crypto_service import (
    SecretCryptoError,
    decrypt_password_vault_secret,
    encrypt_password_vault_secret,
)
from backend.services.twofa_service import twofa_service
from backend.services.user_service import user_service


PASSWORD_VAULT_UNLOCK_TTL_SECONDS = 300
PASSWORD_VAULT_UNLOCK_NAMESPACE = "password_vault_unlock"
PASSWORD_VAULT_UNLOCK_RATE_NAMESPACE = "password_vault_unlock_rate"


class PasswordVaultError(RuntimeError):
    """Base password vault domain error."""


class PasswordVaultConfigurationError(PasswordVaultError):
    """Raised when storage or encryption config is unavailable."""


class PasswordVaultNotFoundError(PasswordVaultError):
    """Raised when a vault entry does not exist."""


class PasswordVaultAccessError(PasswordVaultError):
    """Raised when second-factor unlock or reveal is not allowed."""


class PasswordVaultValidationError(PasswordVaultError):
    """Raised when write payload is invalid."""


def _utc_now() -> datetime:
    return datetime.now(timezone.utc)


def _utc_iso(value: datetime | None = None) -> str:
    return (value or _utc_now()).isoformat()


def _normalize_text(value: Any) -> str:
    return str(value or "").strip()


def _normalize_user_id(value: Any) -> int:
    try:
        return int(value)
    except (TypeError, ValueError):
        return 0


def _normalize_tags(value: Any) -> list[str]:
    raw_items = value if isinstance(value, list) else str(value or "").split(",")
    result: list[str] = []
    seen: set[str] = set()
    for item in raw_items:
        text = _normalize_text(item)
        while text.startswith("#"):
            text = text[1:].strip()
        text = text[:64]
        key = text.lower()
        if not text or key in seen:
            continue
        seen.add(key)
        result.append(text)
    return result[:20]


def _load_tags(raw: str | None) -> list[str]:
    try:
        parsed = json.loads(str(raw or "[]"))
    except Exception:
        parsed = []
    return _normalize_tags(parsed if isinstance(parsed, list) else [])


def _dump_tags(tags: Any) -> str:
    return json.dumps(_normalize_tags(tags), ensure_ascii=False)


def _actor_id(actor: Any) -> int:
    return _normalize_user_id(getattr(actor, "id", None) if actor is not None else 0)


def _actor_username(actor: Any) -> str:
    return _normalize_text(getattr(actor, "username", "") if actor is not None else "")


def _session_key(*, user_id: int, session_id: str | None) -> str:
    normalized_session_id = _normalize_text(session_id) or "sessionless"
    return f"{int(user_id)}:{normalized_session_id}"


@dataclass(frozen=True)
class PasswordVaultRequestMeta:
    ip_address: str = ""
    user_agent: str = ""


class PasswordVaultService:
    """App DB-backed password vault with encrypted values and append-only audit."""

    def __init__(self, *, database_url: Optional[str] = None) -> None:
        self._database_url = _normalize_text(database_url) or None

    def _database_url_or_raise(self) -> str:
        try:
            return ensure_app_schema_initialized(self._database_url)
        except AppDatabaseConfigurationError as exc:
            raise PasswordVaultConfigurationError(str(exc)) from exc

    @staticmethod
    def _entry_to_response(row: AppPasswordVaultEntry) -> dict[str, Any]:
        tags = _load_tags(row.tags_json)
        return {
            "id": _normalize_text(row.id),
            "group": _normalize_text(row.group_name),
            "tags": tags,
            "login": _normalize_text(row.login),
            "description": _normalize_text(row.description),
            "is_archived": bool(row.is_archived),
            "created_at": row.created_at.isoformat() if row.created_at else None,
            "updated_at": row.updated_at.isoformat() if row.updated_at else None,
            "created_by": _normalize_text(row.created_by_username) or None,
            "updated_by": _normalize_text(row.updated_by_username) or None,
            "password_configured": bool(_normalize_text(row.password_enc)),
        }

    @staticmethod
    def _audit_to_response(row: AppPasswordVaultAudit) -> dict[str, Any]:
        return {
            "id": int(row.id or 0),
            "entry_id": _normalize_text(row.entry_id) or None,
            "action": _normalize_text(row.action),
            "actor_user_id": int(row.actor_user_id or 0),
            "actor_username": _normalize_text(row.actor_username),
            "entry_group": _normalize_text(row.entry_group),
            "entry_login": _normalize_text(row.entry_login),
            "ip_address": _normalize_text(row.ip_address),
            "user_agent": _normalize_text(row.user_agent),
            "created_at": row.created_at.isoformat() if row.created_at else None,
        }

    @staticmethod
    def _group_to_response(row: AppPasswordVaultGroup) -> dict[str, Any]:
        return {
            "id": _normalize_text(row.id),
            "name": _normalize_text(row.name),
            "is_active": bool(row.is_active),
            "sort_order": int(row.sort_order or 0),
            "created_at": row.created_at.isoformat() if row.created_at else None,
            "updated_at": row.updated_at.isoformat() if row.updated_at else None,
            "created_by": _normalize_text(row.created_by_username) or None,
            "updated_by": _normalize_text(row.updated_by_username) or None,
        }

    def _write_audit(
        self,
        session,
        *,
        action: str,
        actor: Any,
        entry: AppPasswordVaultEntry | None = None,
        meta: PasswordVaultRequestMeta | None = None,
    ) -> None:
        safe_meta = meta or PasswordVaultRequestMeta()
        session.add(
            AppPasswordVaultAudit(
                entry_id=_normalize_text(entry.id) if entry is not None else None,
                action=_normalize_text(action)[:40],
                actor_user_id=_actor_id(actor),
                actor_username=_actor_username(actor)[:50],
                entry_group=_normalize_text(entry.group_name)[:120] if entry is not None else "",
                entry_login=_normalize_text(entry.login)[:255] if entry is not None else "",
                ip_address=_normalize_text(safe_meta.ip_address)[:128],
                user_agent=_normalize_text(safe_meta.user_agent),
                created_at=_utc_now(),
            )
        )

    def list_entries(
        self,
        *,
        q: str = "",
        group: str = "",
        tag: str = "",
        include_archived: bool = False,
        session_id: str | None = None,
        user_id: int = 0,
    ) -> dict[str, Any]:
        database_url = self._database_url_or_raise()
        query_text = _normalize_text(q)
        group_name = _normalize_text(group)
        tag_name = _normalize_text(tag)
        with app_session(database_url) as session:
            stmt = select(AppPasswordVaultEntry)
            if not include_archived:
                stmt = stmt.where(AppPasswordVaultEntry.is_archived.is_(False))
            if query_text:
                stmt = stmt.where(func.lower(AppPasswordVaultEntry.login).like(f"%{query_text.lower()}%"))
            if group_name:
                stmt = stmt.where(AppPasswordVaultEntry.group_name == group_name)
            rows = session.scalars(
                stmt.order_by(
                    AppPasswordVaultEntry.group_name.asc(),
                    AppPasswordVaultEntry.login.asc(),
                    AppPasswordVaultEntry.updated_at.desc(),
                )
            ).all()
            items = [self._entry_to_response(row) for row in rows]
            if tag_name:
                tag_key = tag_name.lower()
                items = [
                    item
                    for item in items
                    if any(str(item_tag).lower() == tag_key for item_tag in item.get("tags") or [])
                ]

            group_rows = session.scalars(
                select(AppPasswordVaultGroup)
                .where(AppPasswordVaultGroup.is_active.is_(True))
                .order_by(AppPasswordVaultGroup.sort_order.asc(), AppPasswordVaultGroup.name.asc())
            ).all()
            groups = [_normalize_text(item.name) for item in group_rows if _normalize_text(item.name)]
            tag_values: set[str] = set()
            for row in session.scalars(
                select(AppPasswordVaultEntry.tags_json).where(AppPasswordVaultEntry.is_archived.is_(False))
            ).all():
                tag_values.update(_load_tags(row))

        return {
            "items": items,
            "groups": groups,
            "tags": sorted(tag_values, key=lambda value: value.lower()),
            "unlocked_until": self.get_unlocked_until(user_id=user_id, session_id=session_id),
        }

    def list_groups(self, *, include_inactive: bool = False) -> list[dict[str, Any]]:
        database_url = self._database_url_or_raise()
        with app_session(database_url) as session:
            stmt = select(AppPasswordVaultGroup)
            if not include_inactive:
                stmt = stmt.where(AppPasswordVaultGroup.is_active.is_(True))
            rows = session.scalars(
                stmt.order_by(AppPasswordVaultGroup.sort_order.asc(), AppPasswordVaultGroup.name.asc())
            ).all()
            return [self._group_to_response(row) for row in rows]

    @staticmethod
    def _require_active_group(session, group_name: str) -> AppPasswordVaultGroup:
        normalized_name = _normalize_text(group_name)
        if not normalized_name:
            raise PasswordVaultValidationError("group is required")
        row = session.scalars(
            select(AppPasswordVaultGroup)
            .where(AppPasswordVaultGroup.name == normalized_name, AppPasswordVaultGroup.is_active.is_(True))
            .limit(1)
        ).first()
        if row is None:
            raise PasswordVaultValidationError("group must exist in configured password groups")
        return row

    def create_group(self, payload: dict[str, Any], *, actor: Any) -> dict[str, Any]:
        database_url = self._database_url_or_raise()
        name = _normalize_text(payload.get("name"))[:120]
        if not name:
            raise PasswordVaultValidationError("group name is required")
        sort_order = int(payload.get("sort_order") or 0)
        now = _utc_now()
        with app_session(database_url) as session:
            existing = session.scalars(
                select(AppPasswordVaultGroup).where(AppPasswordVaultGroup.name == name).limit(1)
            ).first()
            if existing is not None:
                raise PasswordVaultValidationError("group with this name already exists")
            row = AppPasswordVaultGroup(
                id=uuid.uuid4().hex,
                name=name,
                is_active=True,
                sort_order=max(0, sort_order),
                created_by_user_id=_actor_id(actor),
                created_by_username=_actor_username(actor)[:50],
                updated_by_user_id=_actor_id(actor),
                updated_by_username=_actor_username(actor)[:50],
                created_at=now,
                updated_at=now,
            )
            session.add(row)
            session.flush()
            return self._group_to_response(row)

    def update_group(self, group_id: str, payload: dict[str, Any], *, actor: Any) -> dict[str, Any]:
        database_url = self._database_url_or_raise()
        normalized_id = _normalize_text(group_id)
        if not normalized_id:
            raise PasswordVaultNotFoundError("Group not found")
        with app_session(database_url) as session:
            row = session.get(AppPasswordVaultGroup, normalized_id)
            if row is None:
                raise PasswordVaultNotFoundError("Group not found")
            if "name" in payload and payload.get("name") is not None:
                next_name = _normalize_text(payload.get("name"))[:120]
                if not next_name:
                    raise PasswordVaultValidationError("group name is required")
                existing = session.scalars(
                    select(AppPasswordVaultGroup)
                    .where(AppPasswordVaultGroup.name == next_name, AppPasswordVaultGroup.id != row.id)
                    .limit(1)
                ).first()
                if existing is not None:
                    raise PasswordVaultValidationError("group with this name already exists")
                row.name = next_name
            if "sort_order" in payload and payload.get("sort_order") is not None:
                row.sort_order = max(0, int(payload.get("sort_order") or 0))
            if "is_active" in payload and payload.get("is_active") is not None:
                row.is_active = bool(payload.get("is_active"))
            row.updated_by_user_id = _actor_id(actor)
            row.updated_by_username = _actor_username(actor)[:50]
            row.updated_at = _utc_now()
            session.flush()
            return self._group_to_response(row)

    def archive_group(self, group_id: str, *, actor: Any) -> dict[str, Any]:
        return self.update_group(group_id, {"is_active": False}, actor=actor)

    def create_entry(self, payload: dict[str, Any], *, actor: Any, meta: PasswordVaultRequestMeta) -> dict[str, Any]:
        database_url = self._database_url_or_raise()
        group_name = _normalize_text(payload.get("group"))
        login = _normalize_text(payload.get("login"))
        password = str(payload.get("password") or "")
        if not group_name:
            raise PasswordVaultValidationError("group is required")
        if not login:
            raise PasswordVaultValidationError("login is required")
        if not password:
            raise PasswordVaultValidationError("password is required")
        try:
            password_enc = encrypt_password_vault_secret(password)
        except SecretCryptoError as exc:
            raise PasswordVaultConfigurationError(str(exc)) from exc

        now = _utc_now()
        actor_id = _actor_id(actor)
        actor_username = _actor_username(actor)
        with app_session(database_url) as session:
            self._require_active_group(session, group_name)
            row = AppPasswordVaultEntry(
                id=uuid.uuid4().hex,
                group_name=group_name[:120],
                tags_json=_dump_tags(payload.get("tags")),
                login=login[:255],
                description=_normalize_text(payload.get("description")),
                password_enc=password_enc,
                is_archived=False,
                created_by_user_id=actor_id,
                created_by_username=actor_username[:50],
                updated_by_user_id=actor_id,
                updated_by_username=actor_username[:50],
                created_at=now,
                updated_at=now,
            )
            session.add(row)
            session.flush()
            self._write_audit(session, action="create", actor=actor, entry=row, meta=meta)
            return self._entry_to_response(row)

    def update_entry(self, entry_id: str, payload: dict[str, Any], *, actor: Any, meta: PasswordVaultRequestMeta) -> dict[str, Any]:
        database_url = self._database_url_or_raise()
        normalized_id = _normalize_text(entry_id)
        if not normalized_id:
            raise PasswordVaultNotFoundError("Entry not found")
        with app_session(database_url) as session:
            row = session.get(AppPasswordVaultEntry, normalized_id)
            if row is None:
                raise PasswordVaultNotFoundError("Entry not found")
            if "group" in payload and payload.get("group") is not None:
                group_name = _normalize_text(payload.get("group"))
                self._require_active_group(session, group_name)
                row.group_name = group_name[:120]
            if "tags" in payload and payload.get("tags") is not None:
                row.tags_json = _dump_tags(payload.get("tags"))
            if "login" in payload and payload.get("login") is not None:
                login = _normalize_text(payload.get("login"))
                if not login:
                    raise PasswordVaultValidationError("login is required")
                row.login = login[:255]
            if "description" in payload and payload.get("description") is not None:
                row.description = _normalize_text(payload.get("description"))
            if "password" in payload and payload.get("password") is not None:
                password = str(payload.get("password") or "")
                if not password:
                    raise PasswordVaultValidationError("password is required")
                try:
                    row.password_enc = encrypt_password_vault_secret(password)
                except SecretCryptoError as exc:
                    raise PasswordVaultConfigurationError(str(exc)) from exc
            row.updated_by_user_id = _actor_id(actor)
            row.updated_by_username = _actor_username(actor)[:50]
            row.updated_at = _utc_now()
            session.flush()
            self._write_audit(session, action="update", actor=actor, entry=row, meta=meta)
            return self._entry_to_response(row)

    def archive_entry(self, entry_id: str, *, actor: Any, meta: PasswordVaultRequestMeta) -> dict[str, Any]:
        database_url = self._database_url_or_raise()
        normalized_id = _normalize_text(entry_id)
        with app_session(database_url) as session:
            row = session.get(AppPasswordVaultEntry, normalized_id)
            if row is None:
                raise PasswordVaultNotFoundError("Entry not found")
            row.is_archived = True
            row.updated_by_user_id = _actor_id(actor)
            row.updated_by_username = _actor_username(actor)[:50]
            row.updated_at = _utc_now()
            session.flush()
            self._write_audit(session, action="archive", actor=actor, entry=row, meta=meta)
            return self._entry_to_response(row)

    def _unlock_rate_key(self, *, user_id: int, ip_address: str) -> str:
        return f"{int(user_id)}:{_normalize_text(ip_address) or 'unknown'}"

    def _check_unlock_rate_limit(self, *, user_id: int, ip_address: str) -> None:
        counter = auth_runtime_store_service.get_json(
            PASSWORD_VAULT_UNLOCK_RATE_NAMESPACE,
            self._unlock_rate_key(user_id=user_id, ip_address=ip_address),
        )
        if isinstance(counter, dict) and int(counter.get("count", 0) or 0) >= 5:
            raise PasswordVaultAccessError("Too many password vault unlock attempts")

    def _record_unlock_failure(self, *, user_id: int, ip_address: str) -> None:
        auth_runtime_store_service.increment_counter(
            PASSWORD_VAULT_UNLOCK_RATE_NAMESPACE,
            self._unlock_rate_key(user_id=user_id, ip_address=ip_address),
            window_seconds=300,
        )

    def unlock(
        self,
        *,
        actor: Any,
        session_id: str | None,
        totp_code: str | None = None,
        backup_code: str | None = None,
        meta: PasswordVaultRequestMeta,
    ) -> dict[str, str]:
        database_url = self._database_url_or_raise()
        user_id = _actor_id(actor)
        if user_id <= 0:
            raise PasswordVaultAccessError("Authenticated user is required")
        self._check_unlock_rate_limit(user_id=user_id, ip_address=meta.ip_address)

        try:
            raw_user = user_service.get_by_id(user_id)
            if not raw_user or not bool(raw_user.get("is_2fa_enabled", False)):
                raise PasswordVaultAccessError("2FA is required for password vault unlock")

            if _normalize_text(totp_code):
                secret_enc = _normalize_text(raw_user.get("totp_secret_enc"))
                if not secret_enc:
                    raise PasswordVaultAccessError("TOTP is not configured")
                try:
                    secret = twofa_service.decrypt_secret(secret_enc)
                except Exception as exc:
                    raise PasswordVaultAccessError(f"Failed to read TOTP secret: {exc}") from exc
                if not twofa_service.verify_totp(secret=secret, code=_normalize_text(totp_code)):
                    raise PasswordVaultAccessError("Invalid 2FA code")
            elif _normalize_text(backup_code):
                if not auth_security_service._consume_backup_code(user_id, _normalize_text(backup_code)):
                    raise PasswordVaultAccessError("Invalid backup code")
            else:
                raise PasswordVaultValidationError("2FA code or backup code is required")
        except (PasswordVaultAccessError, PasswordVaultValidationError):
            self._record_unlock_failure(user_id=user_id, ip_address=meta.ip_address)
            raise

        unlocked_until_dt = _utc_now() + timedelta(seconds=PASSWORD_VAULT_UNLOCK_TTL_SECONDS)
        unlocked_until = _utc_iso(unlocked_until_dt)
        auth_runtime_store_service.set_json(
            PASSWORD_VAULT_UNLOCK_NAMESPACE,
            _session_key(user_id=user_id, session_id=session_id),
            {"user_id": user_id, "session_id": _normalize_text(session_id), "unlocked_until": unlocked_until},
            ttl_seconds=PASSWORD_VAULT_UNLOCK_TTL_SECONDS,
        )
        with app_session(database_url) as session:
            self._write_audit(session, action="unlock", actor=actor, entry=None, meta=meta)
        return {"unlocked_until": unlocked_until}

    def get_unlocked_until(self, *, user_id: int, session_id: str | None) -> str | None:
        if int(user_id or 0) <= 0:
            return None
        payload = auth_runtime_store_service.get_json(
            PASSWORD_VAULT_UNLOCK_NAMESPACE,
            _session_key(user_id=int(user_id), session_id=session_id),
        )
        if not isinstance(payload, dict):
            return None
        unlocked_until = _normalize_text(payload.get("unlocked_until"))
        if not unlocked_until:
            return None
        try:
            parsed = datetime.fromisoformat(unlocked_until)
        except ValueError:
            return None
        if parsed.tzinfo is None:
            parsed = parsed.replace(tzinfo=timezone.utc)
        if parsed <= _utc_now():
            auth_runtime_store_service.delete(
                PASSWORD_VAULT_UNLOCK_NAMESPACE,
                _session_key(user_id=int(user_id), session_id=session_id),
            )
            return None
        return parsed.isoformat()

    def require_unlocked(self, *, user_id: int, session_id: str | None) -> str:
        unlocked_until = self.get_unlocked_until(user_id=user_id, session_id=session_id)
        if not unlocked_until:
            raise PasswordVaultAccessError("Password vault unlock is required")
        return unlocked_until

    def reveal_entry(
        self,
        entry_id: str,
        *,
        purpose: str,
        actor: Any,
        session_id: str | None,
        meta: PasswordVaultRequestMeta,
    ) -> dict[str, str]:
        database_url = self._database_url_or_raise()
        unlocked_until = self.require_unlocked(user_id=_actor_id(actor), session_id=session_id)
        action = "reveal.copy" if _normalize_text(purpose) == "copy" else "reveal.show"
        with app_session(database_url) as session:
            row = session.get(AppPasswordVaultEntry, _normalize_text(entry_id))
            if row is None or bool(row.is_archived):
                raise PasswordVaultNotFoundError("Entry not found")
            try:
                password = decrypt_password_vault_secret(row.password_enc)
            except SecretCryptoError as exc:
                raise PasswordVaultConfigurationError(str(exc)) from exc
            self._write_audit(session, action=action, actor=actor, entry=row, meta=meta)
            return {"password": password, "unlocked_until": unlocked_until}

    def list_audit(self, *, limit: int = 100) -> list[dict[str, Any]]:
        database_url = self._database_url_or_raise()
        safe_limit = max(1, min(500, int(limit or 100)))
        with app_session(database_url) as session:
            rows = session.scalars(
                select(AppPasswordVaultAudit)
                .order_by(AppPasswordVaultAudit.created_at.desc(), AppPasswordVaultAudit.id.desc())
                .limit(safe_limit)
            ).all()
            return [self._audit_to_response(row) for row in rows]


password_vault_service = PasswordVaultService()
