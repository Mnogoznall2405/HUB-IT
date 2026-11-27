"""Rate-limit helpers for Telegram sticker-pack imports.

An uncached import fans out into a ``getStickerSet`` call plus up to 200 sticker
and 200 thumbnail ``getFile``+download round trips (bounded by size caps, but
still up to 100 MB) — the most expensive per-request operation in the chat API.
Even a *failed* import of a nonexistent pack costs a Telegram API call, so every
attempt reaching the endpoint consumes quota, cached or not.

The limit is per authenticated user, not per IP: corporate users sit behind
shared NAT addresses, and the abuse vector is an authenticated account, not an
anonymous crowd. Two fixed-window tiers: a minute burst tier keeps click-per-pack
installs fluent, an hourly tier bounds sustained scripting.

Per user means per user regardless of network origin: the counter key must not
carry the network-zone segment, otherwise the same account connecting through
the office LAN and through VPN/Internet would hold one independent budget per
zone. Hence ``share_counter_across_zones=True`` on both tiers.
"""
from __future__ import annotations

from fastapi import Request

from backend.config import config
from backend.utils.rate_limit_guard import enforce_rate_limit


def enforce_sticker_import_limits(request: Request, *, user_id: int) -> None:
    limits = config.chat
    user_key = str(int(user_id or 0))
    enforce_rate_limit(
        namespace="chat_sticker_import:user",
        key=user_key,
        limit=limits.sticker_import_limit_per_user,
        window_seconds=limits.sticker_import_window_user_sec,
        request=request,
        include_retry_after=True,
        allow_internal_bypass=False,
        share_counter_across_zones=True,
    )
    enforce_rate_limit(
        namespace="chat_sticker_import_hourly:user",
        key=user_key,
        limit=limits.sticker_import_hourly_limit_per_user,
        window_seconds=limits.sticker_import_hourly_window_user_sec,
        request=request,
        include_retry_after=True,
        allow_internal_bypass=False,
        share_counter_across_zones=True,
    )
