"""In-memory chat runtime cache helpers."""
from __future__ import annotations

from contextvars import ContextVar
from datetime import datetime, timedelta, timezone
from typing import TYPE_CHECKING, Any

from backend.chat.chat_read_cache_redis import chat_read_cache_redis
from backend.chat.utils import normalize_text as _normalize_text

if TYPE_CHECKING:
    from backend.chat.service import ChatService


class ChatCache:
    def __init__(self, service: "ChatService") -> None:
        self._service = service

    def _cache_key(self, *, user_id: int, bucket: str, extra: str = "") -> str:
        return f"{int(user_id)}::{_normalize_text(bucket)}::{_normalize_text(extra)}"

    def _cache_get(self, *, user_id: int, bucket: str, extra: str = "") -> Any:
        key = self._service._cache_key(user_id=int(user_id), bucket=bucket, extra=extra)
        if chat_read_cache_redis.supports_bucket(bucket):
            redis_value = chat_read_cache_redis.get(key)
            if redis_value is not None:
                return redis_value
        with self._service._cache_lock:
            payload = self._service._runtime_cache.get(key)
            if not payload:
                return None
            expires_at, value = payload
            if expires_at <= datetime.now(timezone.utc):
                self._service._runtime_cache.pop(key, None)
                return None
            return value

    def _cache_set(self, *, user_id: int, bucket: str, value: Any, extra: str = "", ttl_sec: int | None = None) -> Any:
        ttl = max(1, int(ttl_sec or self._service.chat_cache_ttl_sec))
        expires_at = datetime.now(timezone.utc) + timedelta(seconds=ttl)
        key = self._service._cache_key(user_id=int(user_id), bucket=bucket, extra=extra)
        with self._service._cache_lock:
            self._service._runtime_cache[key] = (expires_at, value)
        if chat_read_cache_redis.supports_bucket(bucket):
            chat_read_cache_redis.set(key, value, ttl)
        return value

    def _invalidate_user_cache(self, *, user_id: int, bucket: str | None = None, extra_prefix: str = "") -> None:
        user_prefix = f"{int(user_id)}::"
        bucket_prefix = f"{user_prefix}{_normalize_text(bucket)}::" if bucket else user_prefix
        normalized_extra_prefix = _normalize_text(extra_prefix)
        chat_read_cache_redis.invalidate_prefix(bucket_prefix + normalized_extra_prefix)
        with self._service._cache_lock:
            for key in list(self._service._runtime_cache.keys()):
                if not key.startswith(bucket_prefix):
                    continue
                if normalized_extra_prefix:
                    extra = key[len(bucket_prefix):]
                    if not extra.startswith(normalized_extra_prefix):
                        continue
                self._service._runtime_cache.pop(key, None)

    def _invalidate_conversation_views_for_users(self, *, conversation_id: str, user_ids: list[int] | set[int] | tuple[int, ...]) -> None:
        normalized_conversation_id = _normalize_text(conversation_id)
        if not normalized_conversation_id:
            return
        for user_id in {int(item) for item in list(user_ids or []) if int(item) > 0}:
            self._service._invalidate_user_cache(user_id=user_id, bucket="conversations")
            self._service._invalidate_user_cache(user_id=user_id, bucket="unread_summary")
            self._service._invalidate_user_cache(
                user_id=user_id,
                bucket="conversation_detail",
                extra_prefix=normalized_conversation_id,
            )
            self._service._invalidate_user_cache(
                user_id=user_id,
                bucket="thread_latest",
                extra_prefix=f"{normalized_conversation_id}|",
            )
            self._service._invalidate_user_cache(
                user_id=user_id,
                bucket="thread_bootstrap",
                extra_prefix=f"{normalized_conversation_id}|",
            )
            self.invalidate_presence_cache(user_id=user_id)

    def invalidate_presence_cache(self, *, user_id: int) -> None:
        self._service.invalidate_presence_cache(user_id=user_id)
