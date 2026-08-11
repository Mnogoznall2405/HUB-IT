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
        # Soft-invalidate list/summary once: demote a fresh entry to a short serve window.
        # Do NOT extend that window on every message — otherwise under chat storms the
        # sidebar stays permanently stale until the user opens a thread.
        soft_buckets = {"conversations", "unread_summary"}
        soft_ttl = timedelta(seconds=2.5)
        now = datetime.now(timezone.utc)
        with self._service._cache_lock:
            for key in list(self._service._runtime_cache.keys()):
                if not key.startswith(bucket_prefix):
                    continue
                if normalized_extra_prefix:
                    extra = key[len(bucket_prefix):]
                    if not extra.startswith(normalized_extra_prefix):
                        continue
                key_bucket = key.split("::", 2)[1] if "::" in key else ""
                if key_bucket in soft_buckets:
                    payload = self._service._runtime_cache.get(key)
                    if payload is not None:
                        old_expires, value = payload
                        if old_expires <= now:
                            self._service._runtime_cache.pop(key, None)
                        elif (old_expires - now) > soft_ttl:
                            self._service._runtime_cache[key] = (now + soft_ttl, value)
                        # else already in soft window — leave deadline unchanged
                        continue
                self._service._runtime_cache.pop(key, None)

    def _invalidate_reader_views_after_mark_read(
        self,
        *,
        conversation_id: str,
        user_id: int,
    ) -> None:
        """O(1)-ish invalidate for mark_read: no full runtime-cache scan under lock."""
        normalized_conversation_id = _normalize_text(conversation_id)
        reader_id = int(user_id or 0)
        if not normalized_conversation_id or reader_id <= 0:
            return

        conversations_key = self._service._cache_key(user_id=reader_id, bucket="conversations")
        unread_key = self._service._cache_key(user_id=reader_id, bucket="unread_summary")
        detail_key = self._service._cache_key(
            user_id=reader_id,
            bucket="conversation_detail",
            extra=normalized_conversation_id,
        )
        chat_read_cache_redis.delete_keys([conversations_key, unread_key, detail_key])
        soft_ttl = timedelta(seconds=2.5)
        now = datetime.now(timezone.utc)
        with self._service._cache_lock:
            self._service._runtime_cache.pop(unread_key, None)
            self._service._runtime_cache.pop(detail_key, None)
            payload = self._service._runtime_cache.get(conversations_key)
            if payload is not None:
                old_expires, value = payload
                if old_expires <= now:
                    self._service._runtime_cache.pop(conversations_key, None)
                elif (old_expires - now) > soft_ttl:
                    self._service._runtime_cache[conversations_key] = (now + soft_ttl, value)
            # Drop thread caches for this conversation only (prefix match, single user).
            prefix_latest = f"{reader_id}::thread_latest::{normalized_conversation_id}|"
            prefix_bootstrap = f"{reader_id}::thread_bootstrap::{normalized_conversation_id}|"
            for key in list(self._service._runtime_cache.keys()):
                if key.startswith(prefix_latest) or key.startswith(prefix_bootstrap):
                    self._service._runtime_cache.pop(key, None)

    def _invalidate_conversation_views_for_users(
        self,
        *,
        conversation_id: str,
        user_ids: list[int] | set[int] | tuple[int, ...],
        hard_drop_unread: bool = False,
    ) -> None:
        normalized_conversation_id = _normalize_text(conversation_id)
        target_user_ids = {int(item) for item in list(user_ids or []) if int(item) > 0}
        if not normalized_conversation_id or not target_user_ids:
            return

        # mark_read fast path: single reader, no full-cache scan.
        if hard_drop_unread and len(target_user_ids) == 1:
            self._invalidate_reader_views_after_mark_read(
                conversation_id=normalized_conversation_id,
                user_id=next(iter(target_user_ids)),
            )
            return

        # Exact Redis deletes for shared list buckets — avoid SCAN-per-user on every send.
        chat_read_cache_redis.delete_keys(
            [
                self._service._cache_key(user_id=user_id, bucket="conversations")
                for user_id in target_user_ids
            ]
            + [
                self._service._cache_key(user_id=user_id, bucket="unread_summary")
                for user_id in target_user_ids
            ]
        )

        soft_buckets = {"conversations", "unread_summary"}
        if hard_drop_unread:
            soft_buckets = {"conversations"}
        soft_ttl = timedelta(seconds=2.5)
        now = datetime.now(timezone.utc)
        with self._service._cache_lock:
            for key in list(self._service._runtime_cache.keys()):
                parts = key.split("::", 2)
                if len(parts) < 2:
                    continue
                try:
                    key_user_id = int(parts[0])
                except (TypeError, ValueError):
                    continue
                if key_user_id not in target_user_ids:
                    continue
                key_bucket = parts[1]
                key_extra = parts[2] if len(parts) > 2 else ""
                if hard_drop_unread and key_bucket == "unread_summary":
                    self._service._runtime_cache.pop(key, None)
                    continue
                if key_bucket in soft_buckets:
                    payload = self._service._runtime_cache.get(key)
                    if payload is None:
                        continue
                    old_expires, value = payload
                    if old_expires <= now:
                        self._service._runtime_cache.pop(key, None)
                    elif (old_expires - now) > soft_ttl:
                        self._service._runtime_cache[key] = (now + soft_ttl, value)
                    continue
                if key_bucket == "conversation_detail" and (
                    key_extra == normalized_conversation_id
                    or key_extra.startswith(normalized_conversation_id)
                ):
                    self._service._runtime_cache.pop(key, None)
                    continue
                if key_bucket in {"thread_latest", "thread_bootstrap"} and key_extra.startswith(
                    f"{normalized_conversation_id}|"
                ):
                    self._service._runtime_cache.pop(key, None)
                    continue
                # Keep unrelated buckets; presence is updated only for the sender on send.

    def invalidate_presence_cache(self, *, user_id: int) -> None:
        self._service.invalidate_presence_cache(user_id=user_id)
