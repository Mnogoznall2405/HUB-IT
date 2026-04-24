from __future__ import annotations

from datetime import datetime, timezone
from pathlib import Path
from typing import Optional

from sqlalchemy import select

from backend.appdb.db import app_session, initialize_app_schema, is_app_database_configured
from backend.appdb.models import AppSessionAuthContext
from backend.config import config
from local_store import SQLiteLocalStore, get_local_store
from backend.services.secret_crypto_service import SecretCryptoError, decrypt_secret, encrypt_secret


def _utc_now() -> datetime:
    return datetime.now(timezone.utc)


def _utc_now_iso() -> str:
    return _utc_now().isoformat()


def _parse_datetime(value: object) -> datetime | None:
    text = str(value or "").strip()
    if not text:
        return None
    try:
        parsed = datetime.fromisoformat(text)
    except ValueError:
        return None
    if parsed.tzinfo is None:
        parsed = parsed.replace(tzinfo=timezone.utc)
    return parsed.astimezone(timezone.utc)


def normalize_exchange_login(raw_login: str | None, domain: str | None = None) -> str:
    login = str(raw_login or "").strip().lower()
    if not login:
        return ""
    if "\\" in login:
        login = login.split("\\")[-1].strip()
    if "/" in login and "@" not in login:
        login = login.split("/")[-1].strip()
    if "@" in login:
        return login
    suffix = str(domain or config.app.ldap_domain or "zsgp.corp").strip().lower() or "zsgp.corp"
    return f"{login}@{suffix}"


class SessionAuthContextService:
    FILE_NAME = "web_session_auth_context.json"

    def __init__(self, file_path: Optional[Path] = None, database_url: Optional[str] = None):
        use_singleton_store = file_path is None
        if file_path is None:
            project_root = Path(__file__).resolve().parents[3]
            file_path = project_root / "data" / self.FILE_NAME
        self.file_path = Path(file_path)
        self.file_path.parent.mkdir(parents=True, exist_ok=True)
        self._database_url = str(database_url or "").strip() or None
        self._use_app_database = bool(self._database_url) or is_app_database_configured()
        self.store = None if self._use_app_database else (
            get_local_store(data_dir=self.file_path.parent)
            if use_singleton_store
            else SQLiteLocalStore(data_dir=self.file_path.parent)
        )
        if self._use_app_database:
            initialize_app_schema(self._database_url)
        else:
            self._ensure_file()

    def _ensure_file(self) -> None:
        if self._use_app_database:
            return
        data = self.store.load_json(self.FILE_NAME, default_content=[])
        if not isinstance(data, list):
            self.store.save_json(self.FILE_NAME, [])

    def _load_items(self) -> list[dict]:
        if self._use_app_database:
            with app_session(self._database_url) as session:
                rows = session.scalars(select(AppSessionAuthContext).order_by(AppSessionAuthContext.created_at.asc())).all()
                return [self._row_to_dict(row) for row in rows]
        data = self.store.load_json(self.FILE_NAME, default_content=[])
        return data if isinstance(data, list) else []

    def _save_items(self, items: list[dict]) -> None:
        if self._use_app_database:
            with app_session(self._database_url) as session:
                existing_rows = session.scalars(select(AppSessionAuthContext)).all()
                existing_by_id = {str(row.session_id): row for row in existing_rows}
                incoming_ids: set[str] = set()
                for payload in items:
                    session_id = str(payload.get("session_id") or "").strip()
                    if not session_id:
                        continue
                    incoming_ids.add(session_id)
                    row = existing_by_id.get(session_id)
                    if row is None:
                        row = AppSessionAuthContext(session_id=session_id)
                        session.add(row)
                    self._apply_payload(row, payload)
                for session_id, row in existing_by_id.items():
                    if session_id not in incoming_ids:
                        session.delete(row)
            return
        self.store.save_json(self.FILE_NAME, items)

    @staticmethod
    def _row_to_dict(row: AppSessionAuthContext) -> dict:
        return {
            "session_id": str(row.session_id),
            "user_id": int(row.user_id),
            "auth_source": str(row.auth_source or "local"),
            "exchange_login": str(row.exchange_login or ""),
            "password_enc": str(row.password_enc or ""),
            "expires_at": row.expires_at.isoformat() if row.expires_at else None,
            "created_at": row.created_at.isoformat() if row.created_at else None,
            "updated_at": row.updated_at.isoformat() if row.updated_at else None,
        }

    @staticmethod
    def _apply_payload(row: AppSessionAuthContext, payload: dict) -> None:
        row.user_id = int(payload.get("user_id", 0) or 0)
        row.auth_source = str(payload.get("auth_source") or "local")
        row.exchange_login = str(payload.get("exchange_login") or "")
        row.password_enc = str(payload.get("password_enc") or "")
        row.expires_at = _parse_datetime(payload.get("expires_at")) or _utc_now()
        row.created_at = _parse_datetime(payload.get("created_at")) or _utc_now()
        row.updated_at = _parse_datetime(payload.get("updated_at")) or _utc_now()

    def store_session_context(
        self,
        *,
        session_id: str,
        user_id: int,
        auth_source: str,
        exchange_login: str,
        password: str,
        expires_at: str | datetime,
    ) -> dict:
        normalized_session_id = str(session_id or "").strip()
        normalized_password = str(password or "")
        if not normalized_session_id:
            raise ValueError("session_id is required")
        if not normalized_password:
            raise ValueError("password is required")
        payload = {
            "session_id": normalized_session_id,
            "user_id": int(user_id),
            "auth_source": str(auth_source or "local"),
            "exchange_login": normalize_exchange_login(exchange_login),
            "password_enc": encrypt_secret(normalized_password),
            "expires_at": expires_at.isoformat() if isinstance(expires_at, datetime) else str(expires_at or "").strip(),
            "created_at": _utc_now_iso(),
            "updated_at": _utc_now_iso(),
        }
        items = [item for item in self._load_items() if str(item.get("session_id") or "").strip() != normalized_session_id]
        items.append(payload)
        self._save_items(items)
        return dict(payload)

    def get_session_context(self, session_id: str | None, *, user_id: int | None = None) -> dict | None:
        normalized_session_id = str(session_id or "").strip()
        if not normalized_session_id:
            return None
        items = self._load_items()
        now = _utc_now()
        changed = False
        found: dict | None = None
        kept: list[dict] = []
        for item in items:
            expires_at = _parse_datetime(item.get("expires_at"))
            item_session_id = str(item.get("session_id") or "").strip()
            expired = expires_at is not None and expires_at <= now
            if expired:
                changed = True
                continue
            kept.append(item)
            if item_session_id != normalized_session_id:
                continue
            if user_id is not None and int(item.get("user_id", 0) or 0) != int(user_id):
                continue
            found = dict(item)
        if changed:
            self._save_items(kept)
        return found

    def resolve_session_password(self, session_id: str | None, *, user_id: int | None = None) -> str:
        payload = self.get_session_context(session_id, user_id=user_id)
        if not payload:
            return ""
        try:
            return decrypt_secret(payload.get("password_enc"))
        except SecretCryptoError:
            return ""

    def delete_session_context(self, session_id: str | None) -> None:
        normalized_session_id = str(session_id or "").strip()
        if not normalized_session_id:
            return
        items = self._load_items()
        kept = [item for item in items if str(item.get("session_id") or "").strip() != normalized_session_id]
        if len(kept) != len(items):
            self._save_items(kept)

    def prune_active_sessions(self, active_session_ids: list[str] | set[str] | tuple[str, ...]) -> None:
        active_ids = {str(item or "").strip() for item in (active_session_ids or []) if str(item or "").strip()}
        items = self._load_items()
        now = _utc_now()
        kept: list[dict] = []
        for item in items:
            session_id = str(item.get("session_id") or "").strip()
            expires_at = _parse_datetime(item.get("expires_at"))
            if not session_id:
                continue
            if expires_at is not None and expires_at <= now:
                continue
            if session_id not in active_ids:
                continue
            kept.append(item)
        if len(kept) != len(items):
            self._save_items(kept)

    def get_latest_active_context_for_user(
        self,
        user_id: int,
        *,
        active_session_ids: list[str] | set[str] | tuple[str, ...] | None = None,
    ) -> dict | None:
        normalized_active_ids = {
            str(item or "").strip()
            for item in (active_session_ids or [])
            if str(item or "").strip()
        }
        now = _utc_now()
        candidates: list[dict] = []
        changed = False
        kept: list[dict] = []
        for item in self._load_items():
            session_id = str(item.get("session_id") or "").strip()
            expires_at = _parse_datetime(item.get("expires_at"))
            if not session_id:
                changed = True
                continue
            if expires_at is not None and expires_at <= now:
                changed = True
                continue
            kept.append(item)
            if int(item.get("user_id", 0) or 0) != int(user_id):
                continue
            if normalized_active_ids and session_id not in normalized_active_ids:
                continue
            candidates.append(dict(item))
        if changed:
            self._save_items(kept)
        if not candidates:
            return None
        candidates.sort(
            key=lambda item: (
                str(item.get("updated_at") or ""),
                str(item.get("created_at") or ""),
            ),
            reverse=True,
        )
        return candidates[0]


session_auth_context_service = SessionAuthContextService()
