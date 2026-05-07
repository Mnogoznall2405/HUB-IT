"""
Session persistence and lifecycle management for web authentication.
"""
from __future__ import annotations

import hashlib
from datetime import datetime, timedelta, timezone
from pathlib import Path
from time import monotonic
from typing import Optional

from sqlalchemy import select

from backend.appdb.db import app_session, initialize_app_schema, is_app_database_configured
from backend.appdb.models import AppSessionRecord
from backend.config import config
from local_store import SQLiteLocalStore, get_local_store


def _utc_now() -> datetime:
    return datetime.now(timezone.utc)


def _utc_now_iso() -> str:
    return _utc_now().isoformat()


def _parse_datetime(value: Optional[str]) -> Optional[datetime]:
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


def _detect_platform(user_agent: str) -> str:
    ua = str(user_agent or "").lower()
    if "windows" in ua:
        return "Windows"
    if "mac os" in ua or "macintosh" in ua:
        return "macOS"
    if "android" in ua:
        return "Android"
    if "iphone" in ua or "ipad" in ua or "ios" in ua:
        return "iOS"
    if "linux" in ua:
        return "Linux"
    return "Unknown OS"


def _detect_browser(user_agent: str) -> str:
    ua = str(user_agent or "").lower()
    if "yabrowser" in ua:
        return "Yandex Browser"
    if "edg/" in ua:
        return "Microsoft Edge"
    if "opr/" in ua or "opera" in ua:
        return "Opera"
    if "firefox/" in ua:
        return "Firefox"
    if "chrome/" in ua:
        return "Chrome"
    if "safari/" in ua:
        return "Safari"
    return "Browser"


def _build_device_label(user_agent: str) -> str:
    browser = _detect_browser(user_agent)
    platform = _detect_platform(user_agent)
    if browser == "Browser" and platform == "Unknown OS":
        return "Неизвестное устройство"
    if platform == "Unknown OS":
        return browser
    return f"{browser} on {platform}"


def _normalize_family_label(value: str) -> str:
    normalized = str(value or "").strip().lower()
    if not normalized:
        return "unknown"
    return "".join(ch if ch.isalnum() else "_" for ch in normalized).strip("_") or "unknown"


def build_client_context(user_agent: str) -> dict[str, str]:
    browser_family = _normalize_family_label(_detect_browser(user_agent))
    os_family = _normalize_family_label(_detect_platform(user_agent))
    fingerprint_source = f"{browser_family}|{os_family}"
    return {
        "client_browser_family": browser_family,
        "client_os_family": os_family,
        "client_fingerprint_hash": hashlib.sha256(fingerprint_source.encode("utf-8")).hexdigest(),
    }


class SessionService:
    """Manages web auth sessions in JSON storage."""

    FILE_NAME = "web_sessions.json"
    TOUCH_THROTTLE_SECONDS = 60
    TERMINAL_STATUSES = {
        "terminated",
        "expired_idle",
        "expired_absolute",
        "refresh_reused",
        "trusted_device_revoked",
        "client_mismatch",
    }

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
        self._ensure_file()
        self._last_cleanup_monotonic: Optional[float] = None

    def _ensure_file(self) -> None:
        if self._use_app_database:
            return
        data = self.store.load_json(self.FILE_NAME, default_content=[])
        if not isinstance(data, list):
            self._save_sessions([])

    def _load_sessions(self) -> list[dict]:
        if self._use_app_database:
            with app_session(self._database_url) as session:
                rows = session.scalars(select(AppSessionRecord).order_by(AppSessionRecord.created_at.asc())).all()
                return [self._row_to_session_dict(row) for row in rows]
        data = self.store.load_json(self.FILE_NAME, default_content=[])
        return data if isinstance(data, list) else []

    def _save_sessions(self, sessions: list[dict]) -> None:
        if self._use_app_database:
            with app_session(self._database_url) as session:
                existing_rows = session.scalars(select(AppSessionRecord)).all()
                existing_by_id = {str(row.session_id): row for row in existing_rows}
                incoming_ids: set[str] = set()
                for payload in sessions:
                    session_id = str(payload.get("session_id") or "").strip()
                    if not session_id:
                        continue
                    incoming_ids.add(session_id)
                    row = existing_by_id.get(session_id)
                    if row is None:
                        row = AppSessionRecord(session_id=session_id)
                        session.add(row)
                    self._apply_session_payload(row, payload)
                for session_id, row in existing_by_id.items():
                    if session_id not in incoming_ids:
                        session.delete(row)
            return
        self.store.save_json(self.FILE_NAME, sessions)

    @staticmethod
    def _row_to_session_dict(row: AppSessionRecord) -> dict:
        return {
            "session_id": str(row.session_id),
            "user_id": int(row.user_id),
            "username": str(row.username or ""),
            "role": str(row.role or "viewer"),
            "ip_address": str(row.ip_address or ""),
            "user_agent": str(row.user_agent or ""),
            "created_at": row.created_at.isoformat() if row.created_at else None,
            "last_seen_at": row.last_seen_at.isoformat() if row.last_seen_at else None,
            "expires_at": row.expires_at.isoformat() if row.expires_at else None,
            "idle_expires_at": row.idle_expires_at.isoformat() if row.idle_expires_at else None,
            "is_active": bool(row.is_active),
            "status": str(row.status or "active"),
            "closed_at": row.closed_at.isoformat() if row.closed_at else None,
            "closed_reason": row.closed_reason,
            "device_label": row.device_label,
            "auth_method": str(row.auth_method or "legacy"),
            "trusted_device_id": str(row.trusted_device_id or ""),
            "client_browser_family": str(row.client_browser_family or "unknown"),
            "client_os_family": str(row.client_os_family or "unknown"),
            "client_fingerprint_hash": str(row.client_fingerprint_hash or ""),
        }

    @staticmethod
    def _apply_session_payload(row: AppSessionRecord, payload: dict) -> None:
        row.user_id = int(payload.get("user_id", 0) or 0)
        row.username = str(payload.get("username") or "")
        row.role = str(payload.get("role") or "viewer")
        row.ip_address = str(payload.get("ip_address") or "")
        row.user_agent = str(payload.get("user_agent") or "")
        row.created_at = _parse_datetime(payload.get("created_at")) or _utc_now()
        row.last_seen_at = _parse_datetime(payload.get("last_seen_at")) or row.created_at
        row.expires_at = _parse_datetime(payload.get("expires_at")) or row.last_seen_at
        row.idle_expires_at = _parse_datetime(payload.get("idle_expires_at"))
        row.is_active = bool(payload.get("is_active", True))
        row.status = str(payload.get("status") or "active")
        row.closed_at = _parse_datetime(payload.get("closed_at"))
        row.closed_reason = str(payload.get("closed_reason") or "").strip() or None
        row.device_label = str(payload.get("device_label") or "").strip() or None
        row.auth_method = str(payload.get("auth_method") or "legacy").strip() or "legacy"
        row.trusted_device_id = str(payload.get("trusted_device_id") or "").strip() or None
        row.client_browser_family = str(payload.get("client_browser_family") or "unknown").strip() or "unknown"
        row.client_os_family = str(payload.get("client_os_family") or "unknown").strip() or "unknown"
        row.client_fingerprint_hash = str(payload.get("client_fingerprint_hash") or "").strip()

    def _normalize_db_row(self, row: AppSessionRecord, now: Optional[datetime] = None) -> dict:
        item = self._row_to_session_dict(row)
        if self._normalize_session(item, now=now):
            self._apply_session_payload(row, item)
        return item

    def _idle_timeout_delta(self) -> timedelta:
        return timedelta(minutes=max(1, int(config.session.idle_timeout_minutes)))

    def _history_retention_delta(self) -> timedelta:
        return timedelta(days=max(1, int(config.session.history_retention_days)))

    def _compute_idle_expires_at(self, session: dict) -> Optional[datetime]:
        anchor = (
            _parse_datetime(session.get("last_seen_at"))
            or _parse_datetime(session.get("created_at"))
        )
        if anchor is None:
            return None
        return anchor + self._idle_timeout_delta()

    def _resolve_status(self, session: dict, now: Optional[datetime] = None) -> str:
        now = now or _utc_now()
        expires_at = _parse_datetime(session.get("expires_at"))
        idle_expires_at = self._compute_idle_expires_at(session)
        is_active = bool(session.get("is_active", True))

        if is_active:
            if expires_at and expires_at <= now:
                return "expired_absolute"
            if idle_expires_at and idle_expires_at <= now:
                return "expired_idle"
            return "active"

        explicit_status = str(session.get("status") or "").strip()
        if explicit_status in self.TERMINAL_STATUSES:
            return explicit_status

        closed_reason = str(session.get("closed_reason") or "").strip()
        if closed_reason in self.TERMINAL_STATUSES:
            return closed_reason

        if expires_at and expires_at <= now:
            return "expired_absolute"
        if idle_expires_at and idle_expires_at <= now:
            return "expired_idle"
        return "terminated"

    def _normalize_session(self, session: dict, now: Optional[datetime] = None) -> bool:
        now = now or _utc_now()
        now_iso = now.isoformat()
        changed = False

        device_label = str(session.get("device_label") or "").strip()
        resolved_device = _build_device_label(session.get("user_agent", ""))
        if device_label != resolved_device:
            session["device_label"] = resolved_device
            changed = True

        client_context = build_client_context(session.get("user_agent", ""))
        for key, value in client_context.items():
            if not str(session.get(key) or "").strip():
                session[key] = value
                changed = True
        if not str(session.get("auth_method") or "").strip():
            session["auth_method"] = "legacy"
            changed = True
        if "trusted_device_id" not in session:
            session["trusted_device_id"] = ""
            changed = True

        idle_expires_at = self._compute_idle_expires_at(session)
        idle_expires_at_iso = idle_expires_at.isoformat() if idle_expires_at else None
        if session.get("idle_expires_at") != idle_expires_at_iso:
            session["idle_expires_at"] = idle_expires_at_iso
            changed = True

        status = self._resolve_status(session, now=now)
        if session.get("status") != status:
            session["status"] = status
            changed = True

        if status == "active":
            if not bool(session.get("is_active", True)):
                session["is_active"] = True
                changed = True
            return changed

        if bool(session.get("is_active", True)):
            session["is_active"] = False
            changed = True

        closed_reason = "terminated" if status == "terminated" else status
        if session.get("closed_reason") != closed_reason:
            session["closed_reason"] = closed_reason
            changed = True

        if not session.get("closed_at"):
            session["closed_at"] = now_iso
            changed = True

        return changed

    def _touch_maintenance_marker(self) -> None:
        self._last_cleanup_monotonic = monotonic()

    def _should_run_cleanup(self, *, force: bool = False) -> bool:
        if force:
            return True
        interval = max(0, int(config.session.cleanup_min_interval_seconds))
        if interval == 0:
            return True
        if self._last_cleanup_monotonic is None:
            return True
        return (monotonic() - self._last_cleanup_monotonic) >= interval

    def _run_maintenance(self, *, force: bool = False) -> None:
        if not self._should_run_cleanup(force=force):
            return
        self.cleanup_sessions(force=True)

    def _should_write_touch(self, session: dict, *, now: datetime) -> bool:
        last_seen_at = _parse_datetime(session.get("last_seen_at"))
        if last_seen_at is None:
            return True
        return (now - last_seen_at).total_seconds() >= self.TOUCH_THROTTLE_SECONDS

    def create_session(
        self,
        *,
        session_id: str,
        user_id: int,
        username: str,
        role: str,
        ip_address: str,
        user_agent: str,
        expires_at: str,
        auth_method: str = "legacy",
        trusted_device_id: str | None = None,
    ) -> dict:
        self._run_maintenance()
        now_iso = _utc_now_iso()
        client_context = build_client_context(user_agent)
        item = {
            "session_id": session_id,
            "user_id": int(user_id),
            "username": username,
            "role": role,
            "ip_address": ip_address or "",
            "user_agent": user_agent or "",
            "created_at": now_iso,
            "last_seen_at": now_iso,
            "expires_at": expires_at,
            "idle_expires_at": None,
            "is_active": True,
            "status": "active",
            "closed_at": None,
            "closed_reason": None,
            "device_label": "",
            "auth_method": str(auth_method or "legacy").strip() or "legacy",
            "trusted_device_id": str(trusted_device_id or "").strip(),
            **client_context,
        }
        self._normalize_session(item)
        if self._use_app_database:
            with app_session(self._database_url) as session:
                row = AppSessionRecord(session_id=str(session_id))
                self._apply_session_payload(row, item)
                session.add(row)
            return dict(item)
        sessions = self._load_sessions()
        sessions.append(item)
        self._save_sessions(sessions)
        return dict(item)

    def touch_session(self, session_id: str) -> bool:
        if self._use_app_database:
            with app_session(self._database_url) as session:
                row = session.get(AppSessionRecord, str(session_id or "").strip())
                if row is None:
                    return False
                now = _utc_now()
                item = self._normalize_db_row(row, now=now)
                if item.get("status") != "active" or not bool(item.get("is_active", True)):
                    return False
                if not self._should_write_touch(item, now=now):
                    return True
                now_iso = now.isoformat()
                item["last_seen_at"] = now_iso
                item["idle_expires_at"] = (now + self._idle_timeout_delta()).isoformat()
                item["status"] = "active"
                self._apply_session_payload(row, item)
                return True
        sessions = self._load_sessions()
        changed = False
        now = _utc_now()
        now_iso = now.isoformat()
        touched = False

        for session in sessions:
            if session.get("session_id") != session_id:
                continue
            changed = self._normalize_session(session, now=now) or changed
            if session.get("status") != "active" or not bool(session.get("is_active", True)):
                if changed:
                    self._save_sessions(sessions)
                return False
            if not self._should_write_touch(session, now=now):
                touched = True
                break
            session["last_seen_at"] = now_iso
            session["idle_expires_at"] = (now + self._idle_timeout_delta()).isoformat()
            session["status"] = "active"
            touched = True
            changed = True
            break

        if changed:
            self._save_sessions(sessions)
        return touched

    def is_session_active(self, session_id: Optional[str]) -> bool:
        if not session_id:
            return True
        self._run_maintenance()
        if self._use_app_database:
            with app_session(self._database_url) as session:
                row = session.get(AppSessionRecord, str(session_id or "").strip())
                if row is None:
                    return False
                item = self._normalize_db_row(row, now=_utc_now())
                return item.get("status") == "active" and bool(item.get("is_active", True))
        sessions = self._load_sessions()
        changed = False
        now = _utc_now()

        for session in sessions:
            if session.get("session_id") != session_id:
                continue
            changed = self._normalize_session(session, now=now) or changed
            if changed:
                self._save_sessions(sessions)
            return session.get("status") == "active" and bool(session.get("is_active", True))

        return False

    def _close_session_record(self, session: dict, *, reason: str) -> bool:
        now_iso = _utc_now_iso()
        changed = False
        if bool(session.get("is_active", True)):
            session["is_active"] = False
            changed = True
        if session.get("status") != reason:
            session["status"] = reason
            changed = True
        if session.get("closed_reason") != reason:
            session["closed_reason"] = reason
            changed = True
        if session.get("closed_at") != now_iso:
            session["closed_at"] = now_iso
            changed = True
        if session.get("last_seen_at") != now_iso:
            session["last_seen_at"] = now_iso
            changed = True
        device_label = _build_device_label(session.get("user_agent", ""))
        if session.get("device_label") != device_label:
            session["device_label"] = device_label
            changed = True
        idle_expires_at = self._compute_idle_expires_at(session)
        idle_expires_at_iso = idle_expires_at.isoformat() if idle_expires_at else None
        if session.get("idle_expires_at") != idle_expires_at_iso:
            session["idle_expires_at"] = idle_expires_at_iso
            changed = True
        return changed

    def get_session(self, session_id: Optional[str]) -> dict | None:
        normalized_session_id = str(session_id or "").strip()
        if not normalized_session_id:
            return None
        self._run_maintenance()
        if self._use_app_database:
            with app_session(self._database_url) as session:
                row = session.get(AppSessionRecord, normalized_session_id)
                if row is None:
                    return None
                item = self._normalize_db_row(row, now=_utc_now())
                return dict(item)
        sessions = self._load_sessions()
        changed = False
        now = _utc_now()
        for item in sessions:
            if str(item.get("session_id") or "").strip() != normalized_session_id:
                continue
            changed = self._normalize_session(item, now=now) or changed
            if changed:
                self._save_sessions(sessions)
            return dict(item)
        return None

    def close_session(self, session_id: Optional[str], *, reason: str = "terminated") -> None:
        if not session_id:
            return
        close_reason = str(reason or "terminated").strip() or "terminated"
        if self._use_app_database:
            with app_session(self._database_url) as session:
                row = session.get(AppSessionRecord, str(session_id or "").strip())
                if row is None:
                    return
                item = self._row_to_session_dict(row)
                if self._close_session_record(item, reason=close_reason):
                    self._apply_session_payload(row, item)
            return
        sessions = self._load_sessions()
        changed = False
        for session in sessions:
            if session.get("session_id") == session_id:
                changed = self._close_session_record(session, reason=close_reason) or changed
                break
        if changed:
            self._save_sessions(sessions)

    def close_session_by_id(self, session_id: str, *, reason: str = "terminated") -> bool:
        close_reason = str(reason or "terminated").strip() or "terminated"
        if self._use_app_database:
            with app_session(self._database_url) as session:
                row = session.get(AppSessionRecord, str(session_id or "").strip())
                if row is None:
                    return False
                item = self._row_to_session_dict(row)
                if self._close_session_record(item, reason=close_reason):
                    self._apply_session_payload(row, item)
                return True
        sessions = self._load_sessions()
        changed = False
        closed = False
        for session in sessions:
            if session.get("session_id") != session_id:
                continue
            closed = True
            changed = self._close_session_record(session, reason=close_reason) or changed
            break
        if changed:
            self._save_sessions(sessions)
        return closed

    def close_user_sessions(self, user_id: int) -> int:
        if self._use_app_database:
            closed = 0
            with app_session(self._database_url) as session:
                rows = session.scalars(
                    select(AppSessionRecord).where(AppSessionRecord.user_id == int(user_id))
                ).all()
                for row in rows:
                    item = self._row_to_session_dict(row)
                    if self._close_session_record(item, reason="terminated"):
                        self._apply_session_payload(row, item)
                    closed += 1
            return closed
        sessions = self._load_sessions()
        changed = False
        closed = 0
        for session in sessions:
            if int(session.get("user_id", 0) or 0) != int(user_id):
                continue
            if self._close_session_record(session, reason="terminated"):
                changed = True
            closed += 1
        if changed:
            self._save_sessions(sessions)
        return closed

    def close_trusted_device_sessions(self, *, user_id: int, trusted_device_id: str, reason: str = "trusted_device_revoked") -> int:
        normalized_device_id = str(trusted_device_id or "").strip()
        if int(user_id or 0) <= 0 or not normalized_device_id:
            return 0
        close_reason = str(reason or "trusted_device_revoked").strip() or "trusted_device_revoked"
        if self._use_app_database:
            closed = 0
            with app_session(self._database_url) as session:
                rows = session.scalars(
                    select(AppSessionRecord).where(
                        AppSessionRecord.user_id == int(user_id),
                        AppSessionRecord.trusted_device_id == normalized_device_id,
                        AppSessionRecord.is_active.is_(True),
                    )
                ).all()
                for row in rows:
                    item = self._row_to_session_dict(row)
                    if self._close_session_record(item, reason=close_reason):
                        self._apply_session_payload(row, item)
                    closed += 1
            return closed
        sessions = self._load_sessions()
        changed = False
        closed = 0
        for item in sessions:
            if int(item.get("user_id", 0) or 0) != int(user_id):
                continue
            if str(item.get("trusted_device_id") or "").strip() != normalized_device_id:
                continue
            if item.get("status") != "active" or not bool(item.get("is_active", True)):
                continue
            if self._close_session_record(item, reason=close_reason):
                changed = True
            closed += 1
        if changed:
            self._save_sessions(sessions)
        return closed

    def bind_trusted_device_session(self, *, session_id: str, user_id: int, trusted_device_id: str, auth_method: str = "trusted_device") -> bool:
        normalized_session_id = str(session_id or "").strip()
        normalized_device_id = str(trusted_device_id or "").strip()
        if not normalized_session_id or int(user_id or 0) <= 0 or not normalized_device_id:
            return False
        normalized_auth_method = str(auth_method or "trusted_device").strip() or "trusted_device"
        if self._use_app_database:
            with app_session(self._database_url) as session:
                row = session.get(AppSessionRecord, normalized_session_id)
                if row is None or int(row.user_id) != int(user_id):
                    return False
                item = self._normalize_db_row(row, now=_utc_now())
                item["trusted_device_id"] = normalized_device_id
                item["auth_method"] = normalized_auth_method
                self._apply_session_payload(row, item)
                return True
        sessions = self._load_sessions()
        changed = False
        for item in sessions:
            if str(item.get("session_id") or "").strip() != normalized_session_id:
                continue
            if int(item.get("user_id", 0) or 0) != int(user_id):
                return False
            self._normalize_session(item, now=_utc_now())
            item["trusted_device_id"] = normalized_device_id
            item["auth_method"] = normalized_auth_method
            changed = True
            break
        if changed:
            self._save_sessions(sessions)
        return changed

    def validate_session_client_context(self, *, session_id: str, user_id: int, user_agent: str, close_on_mismatch: bool = True) -> dict:
        session = self.get_session(session_id)
        if not session or int(session.get("user_id", 0) or 0) != int(user_id or 0):
            return {"valid": False, "code": "SESSION_EXPIRED"}
        if session.get("status") != "active" or not bool(session.get("is_active", True)):
            return {"valid": False, "code": "SESSION_EXPIRED"}

        current_context = build_client_context(user_agent)
        stored_browser = str(session.get("client_browser_family") or "").strip()
        stored_os = str(session.get("client_os_family") or "").strip()
        if not stored_browser or stored_browser == "unknown" or not stored_os or stored_os == "unknown":
            if self._use_app_database:
                with app_session(self._database_url) as db_session:
                    row = db_session.get(AppSessionRecord, str(session_id or "").strip())
                    if row is not None and int(row.user_id) == int(user_id):
                        item = self._normalize_db_row(row, now=_utc_now())
                        item.update(current_context)
                        self._apply_session_payload(row, item)
            else:
                sessions = self._load_sessions()
                for item in sessions:
                    if str(item.get("session_id") or "").strip() == str(session_id or "").strip():
                        item.update(current_context)
                        self._save_sessions(sessions)
                        break
            return {"valid": True, "code": None}

        if (
            stored_browser != current_context["client_browser_family"]
            or stored_os != current_context["client_os_family"]
        ):
            if close_on_mismatch:
                self.close_session(session_id, reason="client_mismatch")
            return {"valid": False, "code": "STEP_UP_REQUIRED"}
        return {"valid": True, "code": None}

    def cleanup_sessions(self, *, force: bool = False) -> dict:
        if not self._should_run_cleanup(force=force):
            return {"deactivated": 0, "deleted": 0}

        sessions = self._load_sessions()
        now = _utc_now()
        retention_cutoff = now - self._history_retention_delta()
        deactivated = 0
        deleted = 0
        changed = False
        kept_sessions: list[dict] = []

        for session in sessions:
            was_active = bool(session.get("is_active", True))
            changed = self._normalize_session(session, now=now) or changed
            status = str(session.get("status") or "").strip()
            if was_active and status in {"expired_idle", "expired_absolute"} and not bool(session.get("is_active", True)):
                deactivated += 1

            reference_dt = (
                _parse_datetime(session.get("closed_at"))
                or _parse_datetime(session.get("last_seen_at"))
                or _parse_datetime(session.get("expires_at"))
                or _parse_datetime(session.get("created_at"))
            )
            should_delete = (
                not bool(session.get("is_active", True))
                and reference_dt is not None
                and reference_dt < retention_cutoff
            )
            if should_delete:
                deleted += 1
                changed = True
                continue
            kept_sessions.append(session)

        if changed:
            self._save_sessions(kept_sessions)
        self._touch_maintenance_marker()
        return {"deactivated": deactivated, "deleted": deleted}

    def purge_inactive_sessions(self) -> dict:
        cleanup_result = self.cleanup_sessions(force=True)
        sessions = self._load_sessions()
        now = _utc_now()
        deleted = 0
        changed = False
        kept_sessions: list[dict] = []

        for session in sessions:
            changed = self._normalize_session(session, now=now) or changed
            is_active = bool(session.get("is_active", True))
            status = str(session.get("status") or "").strip()
            if not is_active or status != "active":
                deleted += 1
                changed = True
                continue
            kept_sessions.append(session)

        if changed:
            self._save_sessions(kept_sessions)

        return {
            "deactivated": cleanup_result["deactivated"],
            "deleted": cleanup_result["deleted"] + deleted,
        }

    def list_sessions(self, *, active_only: bool = False) -> list[dict]:
        self._run_maintenance()
        sessions = self._load_sessions()
        now = _utc_now()
        changed = False
        normalized_sessions: list[dict] = []

        for session in sessions:
            changed = self._normalize_session(session, now=now) or changed
            normalized_sessions.append(dict(session))

        if changed:
            self._save_sessions(sessions)

        if active_only:
            normalized_sessions = [item for item in normalized_sessions if item.get("status") == "active"]

        return sorted(
            normalized_sessions,
            key=lambda item: item.get("last_seen_at", ""),
            reverse=True,
        )

    def list_sessions_by_user_ids(
        self,
        user_ids: list[int] | set[int] | tuple[int, ...],
        *,
        active_only: bool = False,
    ) -> list[dict]:
        normalized_user_ids = {
            int(item)
            for item in list(user_ids or [])
            if int(item) > 0
        }
        if not normalized_user_ids:
            return []
        if self._use_app_database:
            self._run_maintenance()
            with app_session(self._database_url) as session:
                rows = session.scalars(
                    select(AppSessionRecord)
                    .where(AppSessionRecord.user_id.in_(normalized_user_ids))
                    .order_by(AppSessionRecord.last_seen_at.desc(), AppSessionRecord.created_at.desc())
                ).all()
                normalized_sessions = [self._row_to_session_dict(row) for row in rows]
                normalized_sessions = [
                    item
                    for item in normalized_sessions
                    if not active_only or item.get("status") == "active"
                ]
                return normalized_sessions
        self._run_maintenance()
        sessions = self._load_sessions()
        now = _utc_now()
        changed = False
        normalized_sessions: list[dict] = []

        for item in sessions:
            changed = self._normalize_session(item, now=now) or changed
            if int(item.get("user_id", 0) or 0) not in normalized_user_ids:
                continue
            if active_only and item.get("status") != "active":
                continue
            normalized_sessions.append(dict(item))

        if changed:
            self._save_sessions(sessions)

        return sorted(
            normalized_sessions,
            key=lambda item: item.get("last_seen_at", ""),
            reverse=True,
        )


session_service = SessionService()
