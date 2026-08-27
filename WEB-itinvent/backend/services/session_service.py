"""
Session persistence and lifecycle management for web authentication.
"""
from __future__ import annotations

import hashlib
import os
import re
from datetime import datetime, timedelta, timezone
from pathlib import Path
from threading import Lock
from time import monotonic
from typing import Optional

from sqlalchemy import select

from backend.appdb.db import app_session, initialize_app_schema, is_app_database_configured
from backend.appdb.models import AppSessionRecord, AppUser
from backend.config import config
from backend.services.auth_session_metrics import note_session_expired
from backend.services.trusted_device_service import trusted_device_service
from backend.utils.request_network import classify_network_zone
from local_store import SQLiteLocalStore, get_local_store


def _utc_now() -> datetime:
    return datetime.now(timezone.utc)


def _utc_now_iso() -> str:
    return _utc_now().isoformat()


_CLIENT_DEVICE_ID_RE = re.compile(r"^[A-Za-z0-9._~-]{16,128}$")


def normalize_client_device_id(value: object) -> str:
    normalized = str(value or "").strip()
    if not _CLIENT_DEVICE_ID_RE.fullmatch(normalized):
        return ""
    return normalized


def hash_client_device_id(value: object) -> str | None:
    normalized = normalize_client_device_id(value)
    if not normalized:
        return None
    return hashlib.sha256(normalized.encode("utf-8")).hexdigest()


def new_client_device_id() -> str:
    # The value is an opaque browser/app identifier, never an authentication token.
    import secrets

    return secrets.token_urlsafe(32)


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


class SessionService:
    """Manages web auth sessions in JSON storage."""

    FILE_NAME = "web_sessions.json"
    TOUCH_THROTTLE_SECONDS = 60
    # In-process TTL cache: avoids APP DB hit on every authenticated request under load.
    # No Redis required on single-node Windows. Invalidate on logout/close.
    ACTIVE_CACHE_TTL_SEC = 8.0
    INACTIVE_CACHE_TTL_SEC = 2.0

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
        # A full cleanup scans every persisted session.  It must never fan out
        # into several concurrent scans when multiple WebSocket/API requests
        # arrive on a cold auth cache at the same time.
        self._maintenance_lock = Lock()
        self._active_cache_lock = Lock()
        # session_id -> (expires_mono, is_active, last_touch_mono)
        self._active_cache: dict[str, tuple[float, bool, float]] = {}
        self._active_cache_hits = 0

    def _agent_log_cache_hit(self, *, location: str, message: str, data: dict) -> None:
        if str(os.getenv("DEBUG_CLIENT_LOG_ENABLED", "0")).strip().lower() not in {"1", "true", "yes", "on"}:
            return
        # Sample under load: log every 100th hit to avoid IO stampede.
        with self._active_cache_lock:
            self._active_cache_hits += 1
            hit_n = self._active_cache_hits
        if hit_n % 100 != 1:
            return
        # #region agent log
        try:
            import json as _json
            import time as _time
            from pathlib import Path as _Path

            _log = _Path(__file__).resolve().parents[3] / "debug-20cb37.log"
            payload = {
                "sessionId": "20cb37",
                "runId": "post-fix",
                "hypothesisId": "S",
                "location": location,
                "message": message,
                "data": {**data, "cache_hit_n": hit_n},
                "timestamp": int(_time.time() * 1000),
            }
            with _log.open("a", encoding="utf-8") as _f:
                _f.write(_json.dumps(payload, ensure_ascii=False) + "\n")
        except Exception:
            pass
        # #endregion

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
                for payload in sessions:
                    session_id = str(payload.get("session_id") or "").strip()
                    if not session_id:
                        continue
                    row = existing_by_id.get(session_id)
                    if row is None:
                        row = AppSessionRecord(session_id=session_id)
                        session.add(row)
                    self._apply_session_payload(row, payload)
                # A caller may be writing a snapshot loaded before another
                # process committed a login.  Missing rows are therefore not
                # evidence that they should be deleted.  App-DB cleanup and
                # purge paths delete only the concrete rows they inspected.
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
            "trusted_device_id": row.trusted_device_id,
            "client_device_key_hash": row.client_device_key_hash,
            "login_network_zone": row.login_network_zone,
            "device_label": row.device_label,
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
        row.trusted_device_id = str(payload.get("trusted_device_id") or "").strip() or None
        row.client_device_key_hash = str(payload.get("client_device_key_hash") or "").strip() or None
        row.login_network_zone = str(payload.get("login_network_zone") or "").strip().lower() or None
        row.device_label = str(payload.get("device_label") or "").strip() or None

    def _normalize_db_row(
        self,
        row: AppSessionRecord,
        now: Optional[datetime] = None,
        *,
        db_session=None,
    ) -> dict:
        item = self._row_to_session_dict(row)
        if self._normalize_session(item, now=now, db_session=db_session):
            self._apply_session_payload(row, item)
        return item

    def _effective_trusted_device_id(self, session: dict, *, db_session=None) -> str | None:
        raw = str(session.get("trusted_device_id") or "").strip()
        if not raw:
            return None
        device = (
            trusted_device_service.get_device(raw, db_session=db_session)
            if db_session is not None
            else trusted_device_service.get_device(raw)
        )
        if not device:
            return None
        if not bool(device.get("is_active", True)):
            return None
        if bool(device.get("is_expired", False)):
            return None
        return raw

    def _is_internal_login_session(self, session: dict | None) -> bool:
        """Office / LAN sessions always get the long idle window.

        Important: do not trust a mistaken ``external`` label when the login IP
        is inside AUTH_2FA_INTERNAL_CIDRS — mis-zoned rows were getting the
        30-minute password idle and being swept while users were still in HUB.
        """
        if not session:
            return False
        zone = str(session.get("login_network_zone") or "").strip().lower()
        if zone == "internal":
            return True
        # IP wins over a wrong/missing zone label (IIS/proxy quirks, stale workers).
        if classify_network_zone(session.get("ip_address")) == "internal":
            return True
        return False

    def _has_active_mobile_biometric_trust(self, session: dict, *, db_session=None) -> bool:
        """APK installations with an enrolled fingerprint get the trusted idle window."""
        try:
            user_id = int(session.get("user_id") or 0)
        except (TypeError, ValueError):
            return False
        device_hash = str(session.get("client_device_key_hash") or "").strip().lower()
        if not user_id or not device_hash:
            return False
        # Lazy import: mobile_biometric_session_service imports hash helpers from this module.
        from backend.services.mobile_biometric_session_service import mobile_biometric_session_service

        return bool(
            mobile_biometric_session_service.has_active_credential_for_device(
                user_id=user_id,
                client_device_key_hash=device_hash,
                db_session=db_session,
            )
        )

    def _idle_timeout_delta(self, session: dict | None = None, *, db_session=None) -> timedelta:
        # Internal must never fall through to the 30-minute external password idle.
        if session is not None and self._is_internal_login_session(session):
            days = max(7, int(getattr(config.session, "idle_timeout_internal_days", 7) or 7))
            return timedelta(days=days)
        if session is not None and self._effective_trusted_device_id(session, db_session=db_session):
            days = max(7, int(getattr(config.session, "idle_timeout_trusted_days", 7) or 7))
            return timedelta(days=days)
        if session is not None and self._has_active_mobile_biometric_trust(session, db_session=db_session):
            days = max(7, int(getattr(config.session, "idle_timeout_trusted_days", 7) or 7))
            return timedelta(days=days)
        return timedelta(minutes=max(1, int(config.session.idle_timeout_minutes)))

    def _history_retention_delta(self) -> timedelta:
        return timedelta(days=max(1, int(config.session.history_retention_days)))

    def _compute_idle_expires_at(self, session: dict, *, db_session=None) -> Optional[datetime]:
        anchor = (
            _parse_datetime(session.get("last_seen_at"))
            or _parse_datetime(session.get("created_at"))
        )
        if anchor is None:
            return None
        return anchor + self._idle_timeout_delta(session, db_session=db_session)

    def _resolve_status(self, session: dict, now: Optional[datetime] = None, *, db_session=None) -> str:
        now = now or _utc_now()
        expires_at = _parse_datetime(session.get("expires_at"))
        idle_expires_at = self._compute_idle_expires_at(session, db_session=db_session)
        is_active = bool(session.get("is_active", True))

        if is_active:
            if expires_at and expires_at <= now:
                return "expired_absolute"
            if idle_expires_at and idle_expires_at <= now:
                return "expired_idle"
            return "active"

        explicit_status = str(session.get("status") or "").strip()
        if explicit_status in {"terminated", "expired_idle", "expired_absolute"}:
            return explicit_status

        closed_reason = str(session.get("closed_reason") or "").strip()
        if closed_reason in {"terminated", "expired_idle", "expired_absolute"}:
            return closed_reason

        if expires_at and expires_at <= now:
            return "expired_absolute"
        if idle_expires_at and idle_expires_at <= now:
            return "expired_idle"
        return "terminated"

    def _normalize_session(self, session: dict, now: Optional[datetime] = None, *, db_session=None) -> bool:
        now = now or _utc_now()
        now_iso = now.isoformat()
        changed = False

        device_label = str(session.get("device_label") or "").strip()
        resolved_device = _build_device_label(session.get("user_agent", ""))
        if device_label != resolved_device:
            session["device_label"] = resolved_device
            changed = True

        raw_trusted = str(session.get("trusted_device_id") or "").strip() or None
        if raw_trusted and not self._effective_trusted_device_id(session, db_session=db_session):
            session["trusted_device_id"] = None
            changed = True

        idle_expires_at = self._compute_idle_expires_at(session, db_session=db_session)
        idle_expires_at_iso = idle_expires_at.isoformat() if idle_expires_at else None
        if session.get("idle_expires_at") != idle_expires_at_iso:
            session["idle_expires_at"] = idle_expires_at_iso
            changed = True

        status = self._resolve_status(session, now=now, db_session=db_session)
        if session.get("status") != status:
            session["status"] = status
            changed = True

        if status == "active":
            if not bool(session.get("is_active", True)):
                session["is_active"] = True
                changed = True
            return changed

        was_active = bool(session.get("is_active", True))
        if was_active:
            session["is_active"] = False
            changed = True
            if status in {"expired_idle", "expired_absolute"}:
                note_session_expired(
                    status,
                    network_zone=str(session.get("login_network_zone") or "").strip() or None,
                )

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
        with self._maintenance_lock:
            # Another request may have finished the cleanup while this caller
            # waited for the lock.
            if not self._should_run_cleanup(force=force):
                return
            self.cleanup_sessions(force=True)

    def _should_write_touch(self, session: dict, *, now: datetime) -> bool:
        last_seen_at = _parse_datetime(session.get("last_seen_at"))
        if last_seen_at is None:
            return True
        return (now - last_seen_at).total_seconds() >= self.TOUCH_THROTTLE_SECONDS

    def _cache_get_active(self, session_id: str) -> Optional[bool]:
        key = str(session_id or "").strip()
        if not key:
            return None
        now_mono = monotonic()
        with self._active_cache_lock:
            cached = self._active_cache.get(key)
            if cached is None:
                return None
            expires_mono, is_active, _last_touch_mono = cached
            if now_mono >= expires_mono:
                self._active_cache.pop(key, None)
                return None
            return bool(is_active)

    def _cache_put_active(self, session_id: str, *, is_active: bool, touched: bool = False) -> None:
        key = str(session_id or "").strip()
        if not key:
            return
        now_mono = monotonic()
        ttl = self.ACTIVE_CACHE_TTL_SEC if is_active else self.INACTIVE_CACHE_TTL_SEC
        with self._active_cache_lock:
            prev = self._active_cache.get(key)
            last_touch_mono = now_mono if touched else (prev[2] if prev else 0.0)
            self._active_cache[key] = (now_mono + ttl, bool(is_active), float(last_touch_mono))

    def _cache_invalidate(self, session_id: Optional[str] = None) -> None:
        with self._active_cache_lock:
            if session_id is None:
                self._active_cache.clear()
                return
            self._active_cache.pop(str(session_id or "").strip(), None)

    def _cache_touch_fresh(self, session_id: str) -> bool:
        """True when session is cached active and touch write is still within throttle."""
        key = str(session_id or "").strip()
        if not key:
            return False
        now_mono = monotonic()
        with self._active_cache_lock:
            cached = self._active_cache.get(key)
            if cached is None:
                return False
            expires_mono, is_active, last_touch_mono = cached
            if now_mono >= expires_mono or not is_active:
                return False
            if last_touch_mono <= 0:
                return False
            return (now_mono - last_touch_mono) < float(self.TOUCH_THROTTLE_SECONDS)

    @staticmethod
    def _session_lru_key(session: dict) -> tuple[datetime, datetime, str]:
        oldest = datetime.min.replace(tzinfo=timezone.utc)
        return (
            _parse_datetime(session.get("last_seen_at")) or oldest,
            _parse_datetime(session.get("created_at")) or oldest,
            str(session.get("session_id") or ""),
        )

    def _max_active_sessions_per_user(self) -> int:
        return max(1, int(getattr(config.session, "max_active_per_user", 3) or 3))

    def _enforce_active_session_limit(
        self,
        *,
        user_id: int,
        keep_session_id: str | None = None,
        db_session=None,
        sessions: list[dict] | None = None,
    ) -> list[str]:
        """Close least-recently-used sessions, preserving the current login.

        The APP DB path is called inside the same transaction as session
        creation/reuse. The user row is locked by the caller, so concurrent
        logins cannot both observe free slots and exceed the limit.
        """
        limit = self._max_active_sessions_per_user()
        normalized_user_id = int(user_id)
        normalized_keep_id = str(keep_session_id or "").strip()
        closed_ids: list[str] = []

        if db_session is not None:
            rows = db_session.scalars(
                select(AppSessionRecord)
                .where(
                    AppSessionRecord.user_id == normalized_user_id,
                    AppSessionRecord.is_active.is_(True),
                    AppSessionRecord.status == "active",
                )
                .with_for_update()
            ).all()
            active_rows: list[tuple[dict, AppSessionRecord]] = []
            now = _utc_now()
            for row in rows:
                item = self._normalize_db_row(row, now=now, db_session=db_session)
                if item.get("status") == "active" and bool(item.get("is_active", True)):
                    active_rows.append((item, row))
            active_rows.sort(key=lambda pair: self._session_lru_key(pair[0]))
            while len(active_rows) > limit:
                victim_index = next(
                    (
                        index
                        for index, (item, _row) in enumerate(active_rows)
                        if str(item.get("session_id") or "") != normalized_keep_id
                    ),
                    None,
                )
                if victim_index is None:
                    break
                item, row = active_rows.pop(victim_index)
                if self._close_session_record(item, reason="terminated", db_session=db_session):
                    self._apply_session_payload(row, item)
                closed_ids.append(str(item.get("session_id") or row.session_id or ""))
                self._cache_invalidate(str(item.get("session_id") or row.session_id or ""))
            return [item for item in closed_ids if item]

        if sessions is None:
            return []
        active = [
            item
            for item in sessions
            if int(item.get("user_id", 0) or 0) == normalized_user_id
            and bool(item.get("is_active", True))
            and str(item.get("status") or "active") == "active"
        ]
        active.sort(key=self._session_lru_key)
        while len(active) > limit:
            victim_index = next(
                (
                    index
                    for index, item in enumerate(active)
                    if str(item.get("session_id") or "") != normalized_keep_id
                ),
                None,
            )
            if victim_index is None:
                break
            victim = active.pop(victim_index)
            self._close_session_record(victim, reason="terminated")
            session_id = str(victim.get("session_id") or "")
            if session_id:
                closed_ids.append(session_id)
                self._cache_invalidate(session_id)
        return closed_ids

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
        trusted_device_id: str | None = None,
        login_network_zone: str | None = None,
        client_device_id: str | None = None,
    ) -> dict:
        self._run_maintenance()
        now_iso = _utc_now_iso()
        client_device_key_hash = hash_client_device_id(client_device_id)
        zone = str(login_network_zone or "").strip().lower()
        if zone not in {"internal", "external"}:
            zone = classify_network_zone(ip_address)
        # Never persist external idle for an office IP — label follows the IP.
        if zone != "internal" and classify_network_zone(ip_address) == "internal":
            zone = "internal"
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
            "trusted_device_id": str(trusted_device_id or "").strip() or None,
            "client_device_key_hash": client_device_key_hash,
            "login_network_zone": zone,
            "device_label": "",
        }
        session_reused = False
        if self._use_app_database:
            with app_session(self._database_url) as session:
                # Lock the stable user row before counting sessions. This
                # serializes concurrent logins for one user across workers.
                session.get(AppUser, int(user_id), with_for_update=True)
                row = None
                if client_device_key_hash:
                    row = session.scalars(
                        select(AppSessionRecord)
                        .where(
                            AppSessionRecord.user_id == int(user_id),
                            AppSessionRecord.client_device_key_hash == client_device_key_hash,
                            AppSessionRecord.is_active.is_(True),
                        )
                        .order_by(AppSessionRecord.last_seen_at.desc(), AppSessionRecord.created_at.desc())
                        .with_for_update()
                    ).first()
                if row is None:
                    row = AppSessionRecord(session_id=str(session_id))
                    session.add(row)
                else:
                    existing = self._normalize_db_row(row, now=_utc_now(), db_session=session)
                    if existing.get("status") != "active" or not bool(existing.get("is_active", True)):
                        row = AppSessionRecord(session_id=str(session_id))
                        session.add(row)
                    else:
                        session_reused = True
                        item["session_id"] = str(row.session_id)
                        item["created_at"] = existing.get("created_at") or item["created_at"]
                self._normalize_session(item, db_session=session)
                self._apply_session_payload(row, item)
                # The app session factory disables autoflush. Flush the new
                # row before counting, otherwise the just-created login would
                # be absent from the limit query until after enforcement.
                session.flush()
                closed_ids = self._enforce_active_session_limit(
                    user_id=int(user_id),
                    keep_session_id=str(item.get("session_id") or ""),
                    db_session=session,
                )
            actual_session_id = str(item.get("session_id") or session_id)
            self._cache_put_active(actual_session_id, is_active=True, touched=True)
            result = dict(item)
            result["_session_reused"] = session_reused
            if closed_ids:
                result["_closed_session_ids"] = closed_ids
            return result
        sessions = self._load_sessions()
        existing = next(
            (
                candidate
                for candidate in sessions
                if int(candidate.get("user_id", 0) or 0) == int(user_id)
                and bool(candidate.get("is_active", True))
                and str(candidate.get("status") or "active") == "active"
                and client_device_key_hash
                and str(candidate.get("client_device_key_hash") or "").strip() == client_device_key_hash
            ),
            None,
        )
        if existing is not None:
            session_reused = True
            item["session_id"] = str(existing.get("session_id") or session_id)
            item["created_at"] = existing.get("created_at") or item["created_at"]
            existing.update(item)
            item = existing
        else:
            sessions.append(item)
        self._normalize_session(item)
        closed_ids = self._enforce_active_session_limit(
            user_id=int(user_id),
            keep_session_id=str(item.get("session_id") or session_id),
            sessions=sessions,
        )
        self._save_sessions(sessions)
        actual_session_id = str(item.get("session_id") or session_id)
        self._cache_put_active(actual_session_id, is_active=True, touched=True)
        result = dict(item)
        result["_session_reused"] = session_reused
        if closed_ids:
            result["_closed_session_ids"] = closed_ids
        return result

    def touch_session(self, session_id: str) -> bool:
        normalized_id = str(session_id or "").strip()
        if normalized_id and self._cache_touch_fresh(normalized_id):
            self._agent_log_cache_hit(
                location="session_service.py:touch_session",
                message="session touch cache hit",
                data={"session_id_prefix": normalized_id[:8]},
            )
            return True
        if self._use_app_database:
            with app_session(self._database_url) as session:
                row = session.get(AppSessionRecord, normalized_id)
                if row is None:
                    self._cache_put_active(normalized_id, is_active=False)
                    return False
                now = _utc_now()
                item = self._normalize_db_row(row, now=now, db_session=session)
                if item.get("status") != "active" or not bool(item.get("is_active", True)):
                    self._cache_put_active(normalized_id, is_active=False)
                    return False
                if not self._should_write_touch(item, now=now):
                    self._cache_put_active(normalized_id, is_active=True, touched=True)
                    return True
                now_iso = now.isoformat()
                item["last_seen_at"] = now_iso
                item["idle_expires_at"] = (
                    now + self._idle_timeout_delta(item, db_session=session)
                ).isoformat()
                item["status"] = "active"
                self._apply_session_payload(row, item)
                self._cache_put_active(normalized_id, is_active=True, touched=True)
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
                self._cache_put_active(normalized_id, is_active=False)
                return False
            if not self._should_write_touch(session, now=now):
                touched = True
                break
            session["last_seen_at"] = now_iso
            session["idle_expires_at"] = (now + self._idle_timeout_delta(session)).isoformat()
            session["status"] = "active"
            touched = True
            changed = True
            break

        if changed:
            self._save_sessions(sessions)
        if touched:
            self._cache_put_active(normalized_id, is_active=True, touched=True)
        return touched

    def is_session_active(self, session_id: Optional[str]) -> bool:
        if not session_id:
            return True
        cached = self._cache_get_active(str(session_id))
        if cached is not None:
            self._agent_log_cache_hit(
                location="session_service.py:is_session_active",
                message="session active cache hit",
                data={
                    "session_id_prefix": str(session_id)[:8],
                    "is_active": bool(cached),
                },
            )
            return bool(cached)
        # This is the hot authentication path used by every REST request and
        # WebSocket revalidation. Validating one session below is sufficient
        # to enforce its expiry; a global cleanup here scanned all sessions
        # and held APP DB transactions during message delivery.
        if self._use_app_database:
            with app_session(self._database_url) as session:
                row = session.get(AppSessionRecord, str(session_id or "").strip())
                if row is None:
                    self._cache_put_active(str(session_id), is_active=False)
                    return False
                item = self._normalize_db_row(row, now=_utc_now(), db_session=session)
                active = item.get("status") == "active" and bool(item.get("is_active", True))
                self._cache_put_active(str(session_id), is_active=active, touched=active)
                return active
        sessions = self._load_sessions()
        changed = False
        now = _utc_now()

        for session in sessions:
            if session.get("session_id") != session_id:
                continue
            changed = self._normalize_session(session, now=now) or changed
            if changed:
                self._save_sessions(sessions)
            active = session.get("status") == "active" and bool(session.get("is_active", True))
            self._cache_put_active(str(session_id), is_active=active, touched=active)
            return active

        self._cache_put_active(str(session_id), is_active=False)
        return False

    def _close_session_record(self, session: dict, *, reason: str, db_session=None) -> bool:
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
        idle_expires_at = self._compute_idle_expires_at(session, db_session=db_session)
        idle_expires_at_iso = idle_expires_at.isoformat() if idle_expires_at else None
        if session.get("idle_expires_at") != idle_expires_at_iso:
            session["idle_expires_at"] = idle_expires_at_iso
            changed = True
        return changed

    def close_session(self, session_id: Optional[str]) -> None:
        if not session_id:
            return
        try:
            if self._use_app_database:
                with app_session(self._database_url) as session:
                    row = session.get(AppSessionRecord, str(session_id or "").strip())
                    if row is None:
                        return
                    item = self._row_to_session_dict(row)
                    if self._close_session_record(item, reason="terminated", db_session=session):
                        self._apply_session_payload(row, item)
                return
            sessions = self._load_sessions()
            changed = False
            for session in sessions:
                if session.get("session_id") == session_id:
                    changed = self._close_session_record(session, reason="terminated") or changed
                    break
            if changed:
                self._save_sessions(sessions)
        finally:
            self._cache_invalidate(session_id)

    def close_session_by_id(self, session_id: str) -> bool:
        try:
            if self._use_app_database:
                with app_session(self._database_url) as session:
                    row = session.get(AppSessionRecord, str(session_id or "").strip())
                    if row is None:
                        return False
                    item = self._row_to_session_dict(row)
                    if self._close_session_record(item, reason="terminated", db_session=session):
                        self._apply_session_payload(row, item)
                    return True
            sessions = self._load_sessions()
            changed = False
            closed = False
            for session in sessions:
                if session.get("session_id") != session_id:
                    continue
                closed = True
                changed = self._close_session_record(session, reason="terminated") or changed
                break
            if changed:
                self._save_sessions(sessions)
            return closed
        finally:
            self._cache_invalidate(session_id)

    def close_user_sessions(self, user_id: int) -> int:
        if self._use_app_database:
            closed = 0
            closed_ids: list[str] = []
            with app_session(self._database_url) as session:
                rows = session.scalars(
                    select(AppSessionRecord).where(AppSessionRecord.user_id == int(user_id))
                ).all()
                for row in rows:
                    item = self._row_to_session_dict(row)
                    closed_ids.append(str(item.get("session_id") or row.session_id or ""))
                    if self._close_session_record(item, reason="terminated", db_session=session):
                        self._apply_session_payload(row, item)
                    closed += 1
            for sid in closed_ids:
                self._cache_invalidate(sid)
            return closed
        sessions = self._load_sessions()
        changed = False
        closed = 0
        closed_ids: list[str] = []
        for session in sessions:
            if int(session.get("user_id", 0) or 0) != int(user_id):
                continue
            closed_ids.append(str(session.get("session_id") or ""))
            if self._close_session_record(session, reason="terminated"):
                changed = True
            closed += 1
        if changed:
            self._save_sessions(sessions)
        for sid in closed_ids:
            self._cache_invalidate(sid)
        return closed

    def cleanup_sessions(self, *, force: bool = False) -> dict:
        if not self._should_run_cleanup(force=force):
            return {"deactivated": 0, "deleted": 0}

        if self._use_app_database:
            now = _utc_now()
            retention_cutoff = now - self._history_retention_delta()
            deactivated = 0
            deleted = 0
            invalidated_ids: list[str] = []
            with app_session(self._database_url) as session:
                rows = session.scalars(select(AppSessionRecord)).all()
                for row in rows:
                    item = self._row_to_session_dict(row)
                    was_active = bool(item.get("is_active", True))
                    changed = self._normalize_session(item, now=now, db_session=session)
                    status = str(item.get("status") or "").strip()
                    if was_active and status in {"expired_idle", "expired_absolute"} and not bool(item.get("is_active", True)):
                        deactivated += 1

                    reference_dt = (
                        _parse_datetime(item.get("closed_at"))
                        or _parse_datetime(item.get("last_seen_at"))
                        or _parse_datetime(item.get("expires_at"))
                        or _parse_datetime(item.get("created_at"))
                    )
                    should_delete = (
                        not bool(item.get("is_active", True))
                        and reference_dt is not None
                        and reference_dt < retention_cutoff
                    )
                    if should_delete:
                        session.delete(row)
                        deleted += 1
                        invalidated_ids.append(str(row.session_id))
                    elif changed:
                        self._apply_session_payload(row, item)
                        invalidated_ids.append(str(row.session_id))
            for session_id in invalidated_ids:
                self._cache_invalidate(session_id)
            self._touch_maintenance_marker()
            return {"deactivated": deactivated, "deleted": deleted}

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
        if self._use_app_database:
            now = _utc_now()
            deleted = 0
            deleted_ids: list[str] = []
            with app_session(self._database_url) as session:
                rows = session.scalars(select(AppSessionRecord)).all()
                for row in rows:
                    item = self._row_to_session_dict(row)
                    changed = self._normalize_session(item, now=now, db_session=session)
                    is_active = bool(item.get("is_active", True))
                    status = str(item.get("status") or "").strip()
                    if not is_active or status != "active":
                        deleted_ids.append(str(row.session_id))
                        session.delete(row)
                        deleted += 1
                    elif changed:
                        self._apply_session_payload(row, item)
            for session_id in deleted_ids:
                self._cache_invalidate(session_id)
            return {
                "deactivated": cleanup_result["deactivated"],
                "deleted": cleanup_result["deleted"] + deleted,
            }
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

    def normalize_active_session_limits(self, *, apply: bool = False) -> dict:
        """Preview or apply the per-user active-session limit.

        This is intentionally separate from automatic maintenance so an
        operator can preview the impact before closing existing sessions.
        """
        limit = self._max_active_sessions_per_user()
        if self._use_app_database:
            with app_session(self._database_url) as session:
                statement = select(AppSessionRecord).where(
                    AppSessionRecord.is_active.is_(True),
                    AppSessionRecord.status == "active",
                )
                rows = session.scalars(statement).all()
                if apply:
                    # Keep lock ordering identical to create_session:
                    # user row first, then session rows. This avoids a
                    # deadlock between normalization and a concurrent login.
                    user_ids = sorted({int(row.user_id) for row in rows})
                    for user_id in user_ids:
                        session.get(AppUser, user_id, with_for_update=True)
                    rows = session.scalars(statement.with_for_update()).all()

                grouped: dict[int, list[tuple[dict, AppSessionRecord]]] = {}
                for row in rows:
                    item = self._row_to_session_dict(row)
                    grouped.setdefault(int(row.user_id), []).append((item, row))

                closed_ids: list[str] = []
                users_affected = 0
                sessions_to_close = 0
                for user_id, candidates in grouped.items():
                    candidates.sort(key=lambda pair: self._session_lru_key(pair[0]))
                    victims = candidates[: max(0, len(candidates) - limit)]
                    if not victims:
                        continue
                    users_affected += 1
                    sessions_to_close += len(victims)
                    if not apply:
                        continue
                    for item, row in victims:
                        if self._close_session_record(item, reason="terminated", db_session=session):
                            self._apply_session_payload(row, item)
                        session_id = str(row.session_id or item.get("session_id") or "")
                        if session_id:
                            closed_ids.append(session_id)
                            self._cache_invalidate(session_id)
                result = {
                    "limit": limit,
                    "users_affected": users_affected,
                    "sessions_to_close": sessions_to_close,
                    "sessions_closed": len(closed_ids) if apply else 0,
                }
                if closed_ids:
                    result["_closed_session_ids"] = closed_ids
                return result

        sessions = self._load_sessions()
        grouped: dict[int, list[dict]] = {}
        for item in sessions:
            if not bool(item.get("is_active", True)) or str(item.get("status") or "active") != "active":
                continue
            grouped.setdefault(int(item.get("user_id", 0) or 0), []).append(item)

        closed_ids: list[str] = []
        users_affected = 0
        sessions_to_close = 0
        changed = False
        for candidates in grouped.values():
            candidates.sort(key=self._session_lru_key)
            victims = candidates[: max(0, len(candidates) - limit)]
            if not victims:
                continue
            users_affected += 1
            sessions_to_close += len(victims)
            if not apply:
                continue
            for item in victims:
                self._close_session_record(item, reason="terminated")
                session_id = str(item.get("session_id") or "")
                if session_id:
                    closed_ids.append(session_id)
                    self._cache_invalidate(session_id)
                changed = True
        if changed:
            self._save_sessions(sessions)
        result = {
            "limit": limit,
            "users_affected": users_affected,
            "sessions_to_close": sessions_to_close,
            "sessions_closed": len(closed_ids) if apply else 0,
        }
        if closed_ids:
            result["_closed_session_ids"] = closed_ids
        return result

    def get_session(self, session_id: str | None) -> dict | None:
        normalized_id = str(session_id or "").strip()
        if not normalized_id:
            return None
        self._run_maintenance()
        now = _utc_now()
        if self._use_app_database:
            with app_session(self._database_url) as session:
                row = session.get(AppSessionRecord, normalized_id)
                if row is None:
                    return None
                return self._normalize_db_row(row, now=now, db_session=session)
        sessions = self._load_sessions()
        changed = False
        found: dict | None = None
        for item in sessions:
            if str(item.get("session_id") or "") != normalized_id:
                continue
            changed = self._normalize_session(item, now=now) or changed
            found = dict(item)
            break
        if changed:
            self._save_sessions(sessions)
        return found

    def reapply_idle_policy_for_active_sessions(self) -> dict:
        """Recompute idle_expires_at for active sessions after policy deploy."""
        self._run_maintenance()
        now = _utc_now()
        updated = 0
        inspected = 0
        if self._use_app_database:
            with app_session(self._database_url) as session:
                rows = session.scalars(
                    select(AppSessionRecord).where(AppSessionRecord.is_active.is_(True))
                ).all()
                for row in rows:
                    inspected += 1
                    item = self._row_to_session_dict(row)
                    before = item.get("idle_expires_at")
                    zone_backfilled = False
                    # Prefer stored zone; legacy rows fall back to IP classification.
                    if not str(item.get("login_network_zone") or "").strip():
                        derived = classify_network_zone(item.get("ip_address"))
                        if derived == "internal":
                            item["login_network_zone"] = "internal"
                            zone_backfilled = True
                    changed = self._normalize_session(item, now=now, db_session=session)
                    if item.get("status") != "active" or not bool(item.get("is_active", True)):
                        if changed or zone_backfilled:
                            self._apply_session_payload(row, item)
                        continue
                    after = item.get("idle_expires_at")
                    if changed or before != after or zone_backfilled:
                        self._apply_session_payload(row, item)
                        updated += 1
                        self._cache_invalidate(str(item.get("session_id") or ""))
            return {"inspected": inspected, "updated": updated}

        sessions = self._load_sessions()
        changed_any = False
        for item in sessions:
            if not bool(item.get("is_active", True)):
                continue
            inspected += 1
            before = item.get("idle_expires_at")
            zone_backfilled = False
            if not str(item.get("login_network_zone") or "").strip():
                derived = classify_network_zone(item.get("ip_address"))
                if derived == "internal":
                    item["login_network_zone"] = "internal"
                    zone_backfilled = True
            changed = self._normalize_session(item, now=now)
            after = item.get("idle_expires_at")
            if changed or before != after or zone_backfilled:
                updated += 1
                changed_any = True
                self._cache_invalidate(str(item.get("session_id") or ""))
        if changed_any:
            self._save_sessions(sessions)
        return {"inspected": inspected, "updated": updated}

    def build_session_diagnostics(self, session_id: str | None) -> dict | None:
        item = self.get_session(session_id)
        if not item:
            return None
        absolute_expires_at = item.get("expires_at")
        return {
            "session_id": item.get("session_id"),
            "user_id": item.get("user_id"),
            "username": item.get("username"),
            "login_network_zone": item.get("login_network_zone"),
            "last_seen_at": item.get("last_seen_at"),
            "idle_expires_at": item.get("idle_expires_at"),
            "absolute_expires_at": absolute_expires_at,
            "refresh_expires_at": absolute_expires_at,
            "expires_at": absolute_expires_at,
            "closed_reason": item.get("closed_reason"),
            "closed_at": item.get("closed_at"),
            "status": item.get("status"),
            "is_active": bool(item.get("is_active", False)),
            "trusted_device_id": item.get("trusted_device_id"),
            "idle_timeout_days": (
                int(self._idle_timeout_delta(item).total_seconds() // 86400)
                if (
                    self._is_internal_login_session(item)
                    or self._effective_trusted_device_id(item)
                    or self._has_active_mobile_biometric_trust(item)
                )
                else None
            ),
            "idle_timeout_minutes": (
                None
                if (
                    self._is_internal_login_session(item)
                    or self._effective_trusted_device_id(item)
                    or self._has_active_mobile_biometric_trust(item)
                )
                else int(self._idle_timeout_delta(item).total_seconds() // 60)
            ),
            "policy": {
                "idle_timeout_internal_days": int(config.session.idle_timeout_internal_days),
                "idle_timeout_trusted_days": int(config.session.idle_timeout_trusted_days),
                "idle_timeout_minutes": int(config.session.idle_timeout_minutes),
                "refresh_token_expire_days": int(config.jwt.refresh_token_expire_days),
            },
        }

    def list_sessions(self, *, active_only: bool = False) -> list[dict]:
        self._run_maintenance()
        if self._use_app_database:
            now = _utc_now()
            normalized_sessions: list[dict] = []
            with app_session(self._database_url) as session:
                rows = session.scalars(
                    select(AppSessionRecord).order_by(AppSessionRecord.last_seen_at.desc())
                ).all()
                for row in rows:
                    item = self._row_to_session_dict(row)
                    if self._normalize_session(item, now=now, db_session=session):
                        self._apply_session_payload(row, item)
                    if active_only and item.get("status") != "active":
                        continue
                    normalized_sessions.append(dict(item))
            return sorted(
                normalized_sessions,
                key=lambda item: item.get("last_seen_at", ""),
                reverse=True,
            )
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
            now = _utc_now()
            normalized_sessions: list[dict] = []
            with app_session(self._database_url) as session:
                rows = session.scalars(
                    select(AppSessionRecord)
                    .where(AppSessionRecord.user_id.in_(normalized_user_ids))
                    .order_by(AppSessionRecord.last_seen_at.desc(), AppSessionRecord.created_at.desc())
                ).all()
                for row in rows:
                    item = self._normalize_db_row(row, now=now, db_session=session)
                    if active_only and item.get("status") != "active":
                        continue
                    normalized_sessions.append(item)
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
