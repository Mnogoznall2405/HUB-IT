"""Presence and user map helpers."""
from __future__ import annotations

from typing import TYPE_CHECKING, Any, Optional

from sqlalchemy import and_, func, or_, select

from backend.chat.db import chat_session
from backend.chat.models import (
    ChatConversation,
    ChatConversationUserState,
    ChatMember,
    ChatMessage,
    ChatMessageAttachment,
    ChatMessageRead,
    ChatMessageReaction,
)
from datetime import timedelta

from backend.chat.chat_constants import CHAT_PRESENCE_ONLINE_WINDOW
from backend.chat.chat_formatting import _iso, _parse_dt, _utc_now
from backend.chat.utils import normalize_text as _normalize_text
from backend.services.session_service import session_service
from backend.services.user_service import user_service

if TYPE_CHECKING:
    from backend.chat.service import ChatService


class ChatPresenceService:
    def __init__(self, service: "ChatService") -> None:
        self._service = service

    def get_presence(self, *, user_id: int) -> dict:
        normalized_user_id = int(user_id or 0)
        if normalized_user_id <= 0:
            return self._service._build_presence_payload(is_online=False, last_seen_at=None)
        return self._service._get_presence_map(user_ids=[normalized_user_id]).get(
            normalized_user_id,
            self._service._build_presence_payload(is_online=False, last_seen_at=None),
        )

    def _get_presence_map(self, *, user_ids: Optional[list[int] | set[int] | tuple[int, ...]] = None) -> dict[int, dict]:
        normalized_ids = sorted({int(item) for item in list(user_ids or []) if int(item) > 0})
        cache_key = ",".join(str(i) for i in normalized_ids) if normalized_ids else "__all__"
        now = _utc_now()
        with self._service._cache_lock:
            cached_entry = self._service._presence_cache.get(cache_key)
            if cached_entry is not None:
                expires_at, cached_value = cached_entry
                if expires_at > now:
                    return cached_value
                self._service._presence_cache.pop(cache_key, None)
        result: dict[int, dict] = {}
        normalized_user_ids = {
            int(item)
            for item in list(user_ids or [])
            if int(item) > 0
        }
        try:
            sessions = (
                session_service.list_sessions_by_user_ids(normalized_user_ids, active_only=False)
                if normalized_user_ids
                else session_service.list_sessions(active_only=False)
            )
        except Exception:
            sessions = []
        try:
            from backend.chat.realtime import get_chat_presence_snapshot, get_chat_socket_last_seen

            presence_snapshot = dict(get_chat_presence_snapshot(normalized_user_ids or None) or {})
        except Exception:
            presence_snapshot = {}
            get_chat_socket_last_seen = lambda _user_id: None  # type: ignore[assignment]
        connected_user_ids = {int(user_id) for user_id in presence_snapshot.keys() if int(user_id) > 0}

        for item in list(sessions or []):
            user_id = int(item.get("user_id", 0) or 0)
            if user_id <= 0:
                continue
            if normalized_user_ids and user_id not in normalized_user_ids:
                continue
            last_seen_at = _parse_dt(item.get("last_seen_at"))
            is_session_online = str(item.get("status") or "").strip().lower() == "active"
            current = result.get(user_id)
            if current is None:
                result[user_id] = {
                    "is_online": bool(
                        user_id in connected_user_ids
                        or (is_session_online and last_seen_at and (now - last_seen_at) <= CHAT_PRESENCE_ONLINE_WINDOW)
                    ),
                    "last_seen_at": max(filter(None, [last_seen_at, presence_snapshot.get(user_id)]), default=None),
                }
                continue

            current_last_seen = current.get("last_seen_at")
            if last_seen_at and (current_last_seen is None or last_seen_at > current_last_seen):
                current["last_seen_at"] = last_seen_at
            snapshot_last_seen = presence_snapshot.get(user_id)
            if snapshot_last_seen and (current.get("last_seen_at") is None or snapshot_last_seen > current.get("last_seen_at")):
                current["last_seen_at"] = snapshot_last_seen
            if user_id in connected_user_ids or (is_session_online and last_seen_at and (now - last_seen_at) <= CHAT_PRESENCE_ONLINE_WINDOW):
                current["is_online"] = True

        if normalized_user_ids:
            connected_user_ids = {int(item) for item in connected_user_ids if int(item) in normalized_user_ids}

        for user_id in connected_user_ids:
            result.setdefault(
                int(user_id),
                {
                    "is_online": True,
                    "last_seen_at": presence_snapshot.get(int(user_id)) or get_chat_socket_last_seen(int(user_id)),
                },
            )

        for user_id, payload in list(result.items()):
            socket_last_seen = get_chat_socket_last_seen(int(user_id))
            current_last_seen = payload.get("last_seen_at")
            if socket_last_seen and (current_last_seen is None or socket_last_seen > current_last_seen):
                payload["last_seen_at"] = socket_last_seen
            if int(user_id) in connected_user_ids:
                payload["is_online"] = True

        presence_result = {
            user_id: self._service._build_presence_payload(
                is_online=bool(payload.get("is_online")),
                last_seen_at=payload.get("last_seen_at"),
                now=now,
            )
            for user_id, payload in result.items()
        }
        expires_at = now + timedelta(seconds=self._service._PRESENCE_CACHE_TTL_SEC)
        with self._service._cache_lock:
            self._service._presence_cache[cache_key] = (expires_at, presence_result)
        return presence_result

    def _build_presence_payload(
        self,
        *,
        is_online: bool,
        last_seen_at: Optional[datetime],
        now: Optional[datetime] = None,
    ) -> dict:
        now = now or _utc_now()
        if is_online:
            return {
                "is_online": True,
                "last_seen_at": _iso(last_seen_at),
                "status_text": "В сети",
            }

        if last_seen_at is None:
            return {
                "is_online": False,
                "last_seen_at": None,
                "status_text": "Не в сети",
            }

        delta_seconds = max(0, int((now - last_seen_at).total_seconds()))
        if delta_seconds < 60:
            status_text = "Был(а) только что"
        elif delta_seconds < 60 * 60:
            minutes = max(1, delta_seconds // 60)
            status_text = f"Был(а) {minutes} мин назад"
        else:
            local_dt = last_seen_at.astimezone()
            local_now = now.astimezone()
            if local_dt.date() == local_now.date():
                status_text = f"Сегодня в {local_dt.strftime('%H:%M')}"
            elif local_dt.date() == (local_now.date() - timedelta(days=1)):
                status_text = f"Вчера в {local_dt.strftime('%H:%M')}"
            else:
                status_text = local_dt.strftime("%d.%m.%Y %H:%M")
        return {
            "is_online": False,
            "last_seen_at": _iso(last_seen_at),
            "status_text": status_text,
        }

    def _build_message_read_receipts(
        self,
        *,
        message: ChatMessage,
        reader_user_ids: list[int],
        states_by_user_id: dict[int, ChatConversationUserState],
        reads_by_user_id: dict[int, ChatMessageRead],
    ) -> list[dict]:
        items = []
        for user_id in list(reader_user_ids or []):
            read_at = None
            exact_read = reads_by_user_id.get(int(user_id))
            if exact_read is not None and exact_read.read_at is not None:
                read_at = exact_read.read_at
            else:
                state = states_by_user_id.get(int(user_id))
                last_read_seq = int(getattr(state, "last_read_seq", 0) or 0)
                message_seq = int(getattr(message, "conversation_seq", 0) or 0)
                if last_read_seq > 0 and message_seq > 0 and last_read_seq >= message_seq:
                    read_at = getattr(state, "last_read_at", None)
                if read_at is not None:
                    items.append({"user_id": int(user_id), "read_at": read_at})
                    continue
                last_read_at = getattr(state, "last_read_at", None)
                if last_read_at is not None and last_read_at >= message.created_at:
                    read_at = last_read_at
            if read_at is None:
                continue
            items.append({"user_id": int(user_id), "read_at": read_at})
        items.sort(key=lambda item: item["read_at"])
        return items

    def _get_users_map(
        self,
        *,
        presence_map: Optional[dict[int, dict]] = None,
        user_ids: Optional[list[int] | set[int] | tuple[int, ...]] = None,
    ) -> dict[int, dict]:
        normalized_user_ids = {
            int(item)
            for item in list(user_ids or [])
            if int(item) > 0
        }
        cache_key_extra = ",".join(str(i) for i in sorted(normalized_user_ids)) if normalized_user_ids else "__all__"
        cached_users = self._service._cache_get(user_id=0, bucket="users_map", extra=cache_key_extra)
        if cached_users is not None:
            return {
                user_id: self._service._serialize_user(item, presence_map=presence_map)
                for user_id, item in cached_users.items()
            }
        raw_users: dict[int, dict] = {}
        source_users = (
            user_service.get_users_map_by_ids(normalized_user_ids).values()
            if normalized_user_ids
            else user_service.list_users()
        )
        for item in source_users:
            user_id = int(item.get("id", 0) or 0)
            if user_id <= 0:
                continue
            if normalized_user_ids and user_id not in normalized_user_ids:
                continue
            raw_users[user_id] = dict(item)
        self._service._cache_set(user_id=0, bucket="users_map", extra=cache_key_extra, value=raw_users, ttl_sec=self._service._USERS_CACHE_TTL_SEC)
        return {
            user_id: self._service._serialize_user(item, presence_map=presence_map)
            for user_id, item in raw_users.items()
        }

    def _serialize_user(self, item: dict, *, presence_map: Optional[dict[int, dict]] = None) -> dict:
        user_id = int(item.get("id", 0) or 0)
        return {
            "id": user_id,
            "username": _normalize_text(item.get("username")),
            "full_name": _normalize_text(item.get("full_name")) or None,
            "role": _normalize_text(item.get("role")) or "viewer",
            "is_active": bool(item.get("is_active", True)),
            "avatar_url": (_normalize_text(item.get("avatar_url")) or None),
            "presence": dict((presence_map or {}).get(user_id) or self._service._build_presence_payload(is_online=False, last_seen_at=None)),
        }

    def _mask_database_url(self, value: str) -> str:
        text = _normalize_text(value)
        if not text:
            return ""
        if "@" not in text:
            return text
        prefix, suffix = text.rsplit("@", 1)
        if "://" in prefix:
            scheme, remainder = prefix.split("://", 1)
            if ":" in remainder:
                user_part, _password = remainder.split(":", 1)
                return f"{scheme}://{user_part}:***@{suffix}"
        return f"***@{suffix}"
