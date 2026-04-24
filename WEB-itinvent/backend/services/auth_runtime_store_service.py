from __future__ import annotations

import hashlib
import json
import logging
import threading
import time
from datetime import datetime, timedelta, timezone
from typing import Any, Optional

from sqlalchemy import delete, select
from sqlalchemy.exc import IntegrityError

from backend.appdb.db import app_session, initialize_app_schema, is_app_database_configured
from backend.appdb.models import AppAuthRuntimeItem
from backend.config import config

logger = logging.getLogger(__name__)


def _utc_ts() -> float:
    return time.time()


def _utc_now() -> datetime:
    return datetime.now(timezone.utc)


def _coerce_datetime(value: datetime | None) -> datetime | None:
    if value is None:
        return None
    if value.tzinfo is None:
        return value.replace(tzinfo=timezone.utc)
    return value.astimezone(timezone.utc)


def _json_dict(raw: str | None) -> dict[str, Any]:
    try:
        parsed = json.loads(str(raw or "{}"))
    except Exception:
        return {}
    return parsed if isinstance(parsed, dict) else {}


class AuthRuntimeStoreService:
    """Short-lived auth/runtime state in app DB with memory fallback for dev/test."""

    _PREFIX = "itinvent:auth"

    def __init__(self, *, database_url: str | None = None) -> None:
        self._lock = threading.RLock()
        self._memory: dict[str, tuple[float | None, str]] = {}
        self._redis_client = None  # Kept for old tests/monkeypatches; Redis is no longer used.
        self._database_url = str(database_url or "").strip() or None
        self._use_app_db = bool(self._database_url) or is_app_database_configured()
        self._backend = "memory"
        self._initialize_backend()

    def _initialize_backend(self) -> None:
        if self._use_app_db:
            try:
                initialize_app_schema(self._database_url)
                self._backend = "app_db"
                return
            except Exception as exc:  # pragma: no cover - depends on deployment DB
                logger.warning(
                    "Auth runtime store: APP_DATABASE_URL unavailable, using in-memory fallback for dev/test only: %s",
                    exc,
                )
                self._backend = "memory"
                return
        logger.warning(
            "Auth runtime store: APP_DATABASE_URL is not configured, using in-memory fallback for dev/test only"
        )
        self._backend = "memory"

    @property
    def backend_name(self) -> str:
        return self._backend

    def _use_database_backend(self) -> bool:
        return bool(self._use_app_db and self._backend == "app_db")

    @staticmethod
    def _normalize_namespace(namespace: str) -> str:
        normalized = str(namespace or "").strip().lower() or "default"
        if len(normalized) <= 64:
            return normalized
        return "h:" + hashlib.sha256(normalized.encode("utf-8")).hexdigest()[:62]

    @staticmethod
    def _normalize_key(key: str) -> str:
        normalized = str(key or "").strip()
        if len(normalized) <= 512:
            return normalized
        return "h:" + hashlib.sha256(normalized.encode("utf-8")).hexdigest()

    def _full_key(self, namespace: str, key: str) -> str:
        return f"{self._PREFIX}:{self._normalize_namespace(namespace)}:{self._normalize_key(key)}"

    @staticmethod
    def _expires_at(ttl_seconds: Optional[int]) -> datetime | None:
        ttl = int(ttl_seconds or 0)
        if ttl <= 0:
            return None
        return _utc_now() + timedelta(seconds=ttl)

    @staticmethod
    def _is_expired(expires_at: datetime | None, *, now: datetime | None = None) -> bool:
        normalized = _coerce_datetime(expires_at)
        return normalized is not None and normalized <= (now or _utc_now())

    def _prune_memory_locked(self) -> None:
        now = _utc_ts()
        expired = [
            key
            for key, (expires_at, _value) in self._memory.items()
            if expires_at is not None and expires_at <= now
        ]
        for key in expired:
            self._memory.pop(key, None)

    def _set_text_memory(self, full_key: str, value: str, ttl_seconds: Optional[int]) -> None:
        expires_at = None
        ttl = int(ttl_seconds or 0)
        if ttl > 0:
            expires_at = _utc_ts() + ttl
        with self._lock:
            self._prune_memory_locked()
            self._memory[full_key] = (expires_at, str(value or ""))

    def _get_text_memory(self, full_key: str) -> Optional[str]:
        with self._lock:
            self._prune_memory_locked()
            payload = self._memory.get(full_key)
            if not payload:
                return None
            return str(payload[1] or "")

    def _delete_text_memory(self, full_key: str) -> None:
        with self._lock:
            self._memory.pop(full_key, None)

    def _set_text_db(self, namespace: str, key: str, value: str, ttl_seconds: Optional[int]) -> None:
        normalized_namespace = self._normalize_namespace(namespace)
        normalized_key = self._normalize_key(key)
        expires_at = self._expires_at(ttl_seconds)
        now = _utc_now()
        try:
            with app_session(self._database_url) as session:
                row = session.get(
                    AppAuthRuntimeItem,
                    {"namespace": normalized_namespace, "item_key": normalized_key},
                )
                if row is None:
                    row = AppAuthRuntimeItem(
                        namespace=normalized_namespace,
                        item_key=normalized_key,
                        value_text=str(value or ""),
                        expires_at=expires_at,
                        created_at=now,
                        updated_at=now,
                    )
                    session.add(row)
                    return
                row.value_text = str(value or "")
                row.expires_at = expires_at
                row.updated_at = now
        except IntegrityError:
            with app_session(self._database_url) as session:
                row = session.get(
                    AppAuthRuntimeItem,
                    {"namespace": normalized_namespace, "item_key": normalized_key},
                )
                if row is None:
                    raise
                row.value_text = str(value or "")
                row.expires_at = expires_at
                row.updated_at = now

    def _get_text_db(self, namespace: str, key: str) -> Optional[str]:
        normalized_namespace = self._normalize_namespace(namespace)
        normalized_key = self._normalize_key(key)
        with app_session(self._database_url) as session:
            row = session.get(
                AppAuthRuntimeItem,
                {"namespace": normalized_namespace, "item_key": normalized_key},
            )
            if row is None:
                return None
            if self._is_expired(row.expires_at):
                session.delete(row)
                return None
            return str(row.value_text or "")

    def _delete_text_db(self, namespace: str, key: str) -> None:
        normalized_namespace = self._normalize_namespace(namespace)
        normalized_key = self._normalize_key(key)
        with app_session(self._database_url) as session:
            session.execute(
                delete(AppAuthRuntimeItem).where(
                    AppAuthRuntimeItem.namespace == normalized_namespace,
                    AppAuthRuntimeItem.item_key == normalized_key,
                )
            )

    def _pop_text_db(self, namespace: str, key: str) -> Optional[str]:
        normalized_namespace = self._normalize_namespace(namespace)
        normalized_key = self._normalize_key(key)
        with app_session(self._database_url) as session:
            row = session.scalars(
                select(AppAuthRuntimeItem)
                .where(
                    AppAuthRuntimeItem.namespace == normalized_namespace,
                    AppAuthRuntimeItem.item_key == normalized_key,
                )
                .with_for_update()
            ).first()
            if row is None:
                return None
            if self._is_expired(row.expires_at):
                session.delete(row)
                return None
            value = str(row.value_text or "")
            session.delete(row)
            return value

    def set_text(self, namespace: str, key: str, value: str, ttl_seconds: Optional[int] = None) -> None:
        if self._use_database_backend():
            self._set_text_db(namespace, key, value, ttl_seconds)
            return
        self._set_text_memory(self._full_key(namespace, key), value, ttl_seconds)

    def get_text(self, namespace: str, key: str) -> Optional[str]:
        if self._use_database_backend():
            return self._get_text_db(namespace, key)
        return self._get_text_memory(self._full_key(namespace, key))

    def delete(self, namespace: str, key: str) -> None:
        if self._use_database_backend():
            self._delete_text_db(namespace, key)
            return
        self._delete_text_memory(self._full_key(namespace, key))

    def pop_text(self, namespace: str, key: str) -> Optional[str]:
        if self._use_database_backend():
            return self._pop_text_db(namespace, key)
        full_key = self._full_key(namespace, key)
        with self._lock:
            self._prune_memory_locked()
            payload = self._memory.pop(full_key, None)
            if not payload:
                return None
            return str(payload[1] or "")

    def consume_once(self, namespace: str, key: str) -> Optional[str]:
        return self.pop_text(namespace, key)

    def set_json(self, namespace: str, key: str, payload: Any, ttl_seconds: Optional[int] = None) -> None:
        self.set_text(namespace, key, json.dumps(payload, ensure_ascii=False), ttl_seconds=ttl_seconds)

    def get_json(self, namespace: str, key: str) -> Any:
        raw = self.get_text(namespace, key)
        if raw is None:
            return None
        try:
            return json.loads(raw)
        except Exception:
            return None

    def pop_json(self, namespace: str, key: str) -> Any:
        raw = self.consume_once(namespace, key)
        if raw is None:
            return None
        try:
            return json.loads(raw)
        except Exception:
            return None

    def increment_counter(
        self,
        namespace: str,
        key: str,
        *,
        window_seconds: int,
        amount: int = 1,
    ) -> dict[str, Any]:
        window = max(1, int(window_seconds or 1))
        increment = max(1, int(amount or 1))
        if self._use_database_backend():
            return self._increment_counter_db(namespace, key, window_seconds=window, amount=increment)
        return self._increment_counter_memory(namespace, key, window_seconds=window, amount=increment)

    def _increment_counter_memory(
        self,
        namespace: str,
        key: str,
        *,
        window_seconds: int,
        amount: int,
    ) -> dict[str, Any]:
        full_key = self._full_key(namespace, key)
        now_ts = int(_utc_ts())
        expires_ts = now_ts + int(window_seconds)
        with self._lock:
            self._prune_memory_locked()
            stored = self._memory.get(full_key)
            payload = _json_dict(stored[1] if stored else None)
            window_started_at = int(payload.get("window_started_at", 0) or 0)
            if not stored or window_started_at + int(window_seconds) <= now_ts:
                window_started_at = now_ts
                count = amount
            else:
                count = int(payload.get("count", 0) or 0) + amount
            updated = {"count": count, "window_started_at": window_started_at}
            self._memory[full_key] = (
                float(window_started_at + int(window_seconds)),
                json.dumps(updated, ensure_ascii=False),
            )
        return {"count": count, "window_started_at": window_started_at, "expires_at": expires_ts}

    def _increment_counter_db(
        self,
        namespace: str,
        key: str,
        *,
        window_seconds: int,
        amount: int,
    ) -> dict[str, Any]:
        normalized_namespace = self._normalize_namespace(namespace)
        normalized_key = self._normalize_key(key)
        for attempt in range(2):
            now = _utc_now()
            now_ts = int(now.timestamp())
            expires_at = now + timedelta(seconds=window_seconds)
            try:
                with app_session(self._database_url) as session:
                    row = session.scalars(
                        select(AppAuthRuntimeItem)
                        .where(
                            AppAuthRuntimeItem.namespace == normalized_namespace,
                            AppAuthRuntimeItem.item_key == normalized_key,
                        )
                        .with_for_update()
                    ).first()
                    expired_existing = bool(row is not None and self._is_expired(row.expires_at, now=now))
                    payload = {} if expired_existing else _json_dict(row.value_text if row is not None else None)
                    window_started_at = int(payload.get("window_started_at", 0) or 0)
                    if row is None or expired_existing or window_started_at + window_seconds <= now_ts:
                        window_started_at = now_ts
                        count = amount
                    else:
                        count = int(payload.get("count", 0) or 0) + amount
                    updated = {"count": count, "window_started_at": window_started_at}
                    if row is None:
                        session.add(
                            AppAuthRuntimeItem(
                                namespace=normalized_namespace,
                                item_key=normalized_key,
                                value_text=json.dumps(updated, ensure_ascii=False),
                                expires_at=expires_at,
                                created_at=now,
                                updated_at=now,
                            )
                        )
                    else:
                        row.value_text = json.dumps(updated, ensure_ascii=False)
                        row.expires_at = expires_at
                        row.updated_at = now
                    return {
                        "count": count,
                        "window_started_at": window_started_at,
                        "expires_at": int(expires_at.timestamp()),
                    }
            except IntegrityError:
                if attempt == 1:
                    raise
        raise RuntimeError("Failed to increment auth runtime counter")

    def cleanup_expired(self) -> int:
        if self._use_database_backend():
            now = _utc_now()
            with app_session(self._database_url) as session:
                result = session.execute(
                    delete(AppAuthRuntimeItem).where(
                        AppAuthRuntimeItem.expires_at.is_not(None),
                        AppAuthRuntimeItem.expires_at <= now,
                    )
                )
                return int(result.rowcount or 0)
        with self._lock:
            before = len(self._memory)
            self._prune_memory_locked()
            return before - len(self._memory)

    def revoke_jti(self, jti: str, ttl_seconds: int) -> None:
        normalized = str(jti or "").strip()
        if not normalized:
            return
        self.set_text("revoked_jti", normalized, "1", ttl_seconds=max(1, int(ttl_seconds or 1)))

    def is_jti_revoked(self, jti: str | None) -> bool:
        normalized = str(jti or "").strip()
        if not normalized:
            return False
        return self.get_text("revoked_jti", normalized) is not None

    def save_refresh_token(self, jti: str, payload: dict[str, Any], ttl_seconds: int) -> None:
        self.set_json("refresh", jti, payload, ttl_seconds=max(1, int(ttl_seconds or 1)))

    def consume_refresh_token(self, jti: str) -> dict[str, Any] | None:
        payload = self.pop_json("refresh", jti)
        if isinstance(payload, dict):
            return payload
        return None

    def save_login_challenge(self, challenge_id: str, payload: dict[str, Any], ttl_seconds: int) -> None:
        self.set_json("login_challenge", challenge_id, payload, ttl_seconds=max(1, int(ttl_seconds or 1)))

    def get_login_challenge(self, challenge_id: str) -> dict[str, Any] | None:
        payload = self.get_json("login_challenge", challenge_id)
        return payload if isinstance(payload, dict) else None

    def consume_login_challenge(self, challenge_id: str) -> dict[str, Any] | None:
        payload = self.pop_json("login_challenge", challenge_id)
        return payload if isinstance(payload, dict) else None

    def delete_login_challenge(self, challenge_id: str) -> None:
        self.delete("login_challenge", challenge_id)

    def save_webauthn_challenge(self, challenge_id: str, payload: dict[str, Any], ttl_seconds: int) -> None:
        self.set_json("webauthn_challenge", challenge_id, payload, ttl_seconds=max(1, int(ttl_seconds or 1)))

    def pop_webauthn_challenge(self, challenge_id: str) -> dict[str, Any] | None:
        payload = self.pop_json("webauthn_challenge", challenge_id)
        return payload if isinstance(payload, dict) else None

    def get_webauthn_challenge(self, challenge_id: str) -> dict[str, Any] | None:
        payload = self.get_json("webauthn_challenge", challenge_id)
        return payload if isinstance(payload, dict) else None


auth_runtime_store_service = AuthRuntimeStoreService()
