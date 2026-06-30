"""Shared Redis read cache for chat runtime buckets (multi-worker PM2)."""
from __future__ import annotations

import json
import logging
from typing import Any

from backend.config import config

try:
    import redis
except ImportError:  # pragma: no cover - optional dependency
    redis = None

logger = logging.getLogger(__name__)

_SHARED_BUCKETS = frozenset({"conversations", "thread_bootstrap", "unread_summary"})
_KEY_PREFIX = "chat:readcache:v1:"


class ChatReadCacheRedis:
    def __init__(self) -> None:
        self._client: Any | None = None
        self._hits = 0
        self._misses = 0
        self._errors = 0

    def supports_bucket(self, bucket: str) -> bool:
        return _normalize_bucket(bucket) in _SHARED_BUCKETS and self._get_client() is not None

    def get(self, internal_key: str) -> Any | None:
        client = self._get_client()
        if client is None:
            return None
        redis_key = _KEY_PREFIX + str(internal_key)
        try:
            raw = client.get(redis_key)
            if raw is None:
                self._misses += 1
                return None
            self._hits += 1
            return json.loads(raw)
        except Exception:
            self._errors += 1
            logger.debug("chat.read_cache.redis get failed for %s", redis_key, exc_info=True)
            return None

    def set(self, internal_key: str, value: Any, ttl_sec: int) -> None:
        client = self._get_client()
        if client is None:
            return
        redis_key = _KEY_PREFIX + str(internal_key)
        try:
            payload = json.dumps(value, default=str, separators=(",", ":"))
            client.setex(redis_key, max(1, int(ttl_sec)), payload)
        except Exception:
            self._errors += 1
            logger.debug("chat.read_cache.redis set failed for %s", redis_key, exc_info=True)

    def invalidate_prefix(self, prefix: str) -> None:
        client = self._get_client()
        normalized_prefix = str(prefix or "").strip()
        if client is None or not normalized_prefix:
            return
        scan_prefix = _KEY_PREFIX + normalized_prefix
        try:
            for key in client.scan_iter(match=f"{scan_prefix}*", count=128):
                client.delete(key)
        except Exception:
            self._errors += 1
            logger.debug("chat.read_cache.redis invalidate failed for %s", scan_prefix, exc_info=True)

    def invalidate_all(self) -> None:
        client = self._get_client()
        if client is None:
            return
        try:
            for key in client.scan_iter(match=f"{_KEY_PREFIX}*", count=256):
                client.delete(key)
        except Exception:
            self._errors += 1
            logger.debug("chat.read_cache.redis invalidate_all failed", exc_info=True)

    def invalidate_bucket(self, bucket: str) -> None:
        normalized_bucket = _normalize_bucket(bucket)
        if not normalized_bucket:
            return
        client = self._get_client()
        if client is None:
            return
        needle = f"::{normalized_bucket}::"
        pattern = f"{_KEY_PREFIX}*{needle}*"
        try:
            for key in client.scan_iter(match=pattern, count=256):
                client.delete(key)
        except Exception:
            self._errors += 1
            logger.debug("chat.read_cache.redis invalidate_bucket failed for %s", normalized_bucket, exc_info=True)

    def get_metrics(self) -> dict[str, Any]:
        client = self._get_client()
        return {
            "available": client is not None,
            "configured": bool(str(config.redis.url or "").strip()),
            "hits": int(self._hits),
            "misses": int(self._misses),
            "errors": int(self._errors),
        }

    def _get_client(self) -> Any | None:
        if self._client is not None:
            return self._client
        redis_url = str(config.redis.url or "").strip()
        if not redis_url or redis is None:
            return None
        try:
            self._client = redis.Redis.from_url(
                redis_url,
                password=(str(config.redis.password or "").strip() or None),
                decode_responses=True,
                socket_timeout=2,
                socket_connect_timeout=2,
            )
            self._client.ping()
            return self._client
        except Exception:
            self._client = None
            return None


def _normalize_bucket(bucket: str) -> str:
    return str(bucket or "").strip()


chat_read_cache_redis = ChatReadCacheRedis()
