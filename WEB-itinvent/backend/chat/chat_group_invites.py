"""Invite links of group conversations.

Rules: owners and moderators create a link; there is one active link per group (a new one revokes
the previous). The link works for any active portal employee, expires after seven days and only the
SHA-256 of the token is stored, so a database reader cannot join with it. A person who was ever a
member and left (or was removed) cannot come back through the link - a manager adds them again.
Until the table exists, creating or using a link answers 400 and ordinary chat work is unaffected.
"""
from __future__ import annotations

import hashlib
import secrets
import threading
import time
from datetime import timedelta
from typing import TYPE_CHECKING, Any, Optional
from uuid import uuid4

from sqlalchemy import select

from backend.chat.chat_formatting import _display_user_name, _utc_now
from backend.chat.chat_group_admin import ACTION_INVITE_CREATED, ACTION_INVITE_REVOKED, record_group_action
from backend.chat.chat_group_join_requests import approval_required, find_request, submit_request
from backend.chat.db import chat_session
from backend.chat.models import ChatConversation, ChatGroupInvite, ChatMember
from backend.chat.utils import normalize_text as _normalize_text

if TYPE_CHECKING:
    from backend.chat.service import ChatService

INVITE_TTL = timedelta(days=7)
_TABLE_RECHECK_SEC = 30.0
_lock = threading.Lock()
_table_state: dict[str, Any] = {"available": None, "checked_at": 0.0}

_TABLE_MISSING_MESSAGE = "Ссылки-приглашения станут доступны после обновления базы данных"


def reset_runtime_state() -> None:
    with _lock:
        _table_state["available"] = None
        _table_state["checked_at"] = 0.0


def _table_available(session) -> bool:
    now = time.monotonic()
    with _lock:
        available = _table_state["available"]
        checked_at = float(_table_state["checked_at"] or 0.0)
        if available is True or (available is False and now - checked_at < _TABLE_RECHECK_SEC):
            return bool(available)
    try:
        with session.begin_nested():
            session.execute(select(ChatGroupInvite.id).limit(1)).first()
        result = True
    except Exception:
        result = False
    with _lock:
        _table_state["available"] = result
        _table_state["checked_at"] = now
    return result


def hash_invite_token(token: str) -> str:
    return hashlib.sha256(_normalize_text(token).encode("utf-8")).hexdigest()


def _aware(value):
    if value is not None and value.tzinfo is None:
        from datetime import timezone

        return value.replace(tzinfo=timezone.utc)
    return value


class ChatGroupInviteService:
    def __init__(self, service: "ChatService") -> None:
        self._service = service

    def _active_invite(self, session, token: str) -> ChatGroupInvite:
        normalized = _normalize_text(token)
        invite = None
        if normalized:
            invite = session.execute(
                select(ChatGroupInvite).where(ChatGroupInvite.token_hash == hash_invite_token(normalized))
            ).scalar_one_or_none()
        now = _utc_now()
        if (
            invite is None
            or invite.revoked_at is not None
            or _aware(invite.expires_at) <= now
        ):
            # One generic answer: an unknown, revoked or expired link must not be told apart.
            raise LookupError("Invite link not found or expired")
        return invite

    def add_member_from_link(
        self,
        *,
        session,
        conversation: ChatConversation,
        user_id: int,
        user: Any,
        body: str,
        now,
        affected_user_ids: set[int],
    ) -> None:
        """Make the person a plain member who starts at the end of the history, and tell the group.

        Shared by the open link and by the approval of a join request; the caller holds the
        conversation write lock and has checked the member limit.
        """
        session.add(
            ChatMember(
                conversation_id=conversation.id,
                user_id=int(user_id),
                member_role="member",
                joined_at=now,
            )
        )
        state = self._service._get_or_create_conversation_state(
            session=session,
            conversation_id=conversation.id,
            current_user_id=int(user_id),
        )
        state.is_archived = False
        state.last_read_message_id = conversation.last_message_id
        state.last_read_seq = max(0, int(conversation.last_message_seq or 0))
        state.last_read_at = conversation.last_message_at
        state.unread_count = 0
        state.unread_mention_count = 0
        state.updated_at = now
        session.flush()
        member_ids_after = self._service._conversation_member_ids(session, conversation.id)
        self._service._append_system_message(
            session=session,
            conversation=conversation,
            actor_user_id=int(user_id),
            body=body,
            member_user_ids=member_ids_after,
            now=now,
        )
        affected_user_ids.update(member_ids_after)
        session.flush()

    def create_invite(self, *, current_user_id: int, conversation_id: str) -> dict:
        with chat_session() as session:
            # Outsiders are refused before they can queue for the conversation write lock.
            self._service._require_membership(
                session=session, conversation_id=conversation_id, current_user_id=int(current_user_id)
            )
            self._service._lock_conversation_for_write(session=session, conversation_id=conversation_id)
            conversation, _actor = self._service._require_group_manager(
                session=session,
                conversation_id=conversation_id,
                current_user_id=int(current_user_id),
            )
            if not _table_available(session):
                raise ValueError(_TABLE_MISSING_MESSAGE)
            now = _utc_now()
            for previous in session.execute(
                select(ChatGroupInvite).where(
                    ChatGroupInvite.conversation_id == conversation.id,
                    ChatGroupInvite.revoked_at.is_(None),
                )
            ).scalars():
                previous.revoked_at = now
            token = secrets.token_urlsafe(24)
            expires_at = now + INVITE_TTL
            session.add(
                ChatGroupInvite(
                    id=str(uuid4()),
                    conversation_id=conversation.id,
                    token_hash=hash_invite_token(token),
                    created_by_user_id=int(current_user_id),
                    created_at=now,
                    expires_at=expires_at,
                )
            )
            record_group_action(
                session,
                conversation_id=conversation.id,
                actor_user_id=int(current_user_id),
                action=ACTION_INVITE_CREATED,
            )
            session.flush()
            return {"token": token, "expires_at": expires_at.isoformat(), "conversation_id": conversation.id}

    def revoke_invites(self, *, current_user_id: int, conversation_id: str) -> dict:
        with chat_session() as session:
            conversation, _actor = self._service._require_group_manager(
                session=session,
                conversation_id=conversation_id,
                current_user_id=int(current_user_id),
            )
            if not _table_available(session):
                return {"revoked": 0}
            now = _utc_now()
            revoked = 0
            for invite in session.execute(
                select(ChatGroupInvite).where(
                    ChatGroupInvite.conversation_id == conversation.id,
                    ChatGroupInvite.revoked_at.is_(None),
                )
            ).scalars():
                invite.revoked_at = now
                revoked += 1
            if revoked:
                record_group_action(
                    session,
                    conversation_id=conversation.id,
                    actor_user_id=int(current_user_id),
                    action=ACTION_INVITE_REVOKED,
                )
            session.flush()
            return {"revoked": revoked}

    def preview_invite(self, *, current_user_id: int, token: str) -> dict:
        self._service._require_active_user(int(current_user_id))
        with chat_session() as session:
            if not _table_available(session):
                raise ValueError(_TABLE_MISSING_MESSAGE)
            invite = self._active_invite(session, token)
            conversation = session.get(ChatConversation, invite.conversation_id)
            if conversation is None or _normalize_text(conversation.kind) != "group":
                raise LookupError("Invite link not found or expired")
            members = self._service._conversation_member_ids(session, conversation.id)
            is_member = int(current_user_id) in {int(item) for item in members}
            pending = None if is_member else find_request(session, conversation.id, int(current_user_id))
            return {
                "requires_approval": (not is_member) and approval_required(session, conversation.id),
                "request_status": pending.status if pending is not None else None,
                "title": _normalize_text(conversation.title),
                "avatar_url": _normalize_text(conversation.avatar_url) or None,
                "member_count": len(members),
                "already_member": int(current_user_id) in {int(item) for item in members},
                # Only a member learns the id (they can open the conversation anyway).
                "conversation_id": conversation.id if int(current_user_id) in {int(item) for item in members} else None,
                "expires_at": _aware(invite.expires_at).isoformat(),
            }

    def join_by_invite(self, *, current_user_id: int, token: str) -> dict:
        user = self._service._require_active_user(int(current_user_id))
        affected_user_ids: set[int] = {int(current_user_id)}
        joined = False
        with chat_session() as session:
            if not _table_available(session):
                raise ValueError(_TABLE_MISSING_MESSAGE)
            invite = self._active_invite(session, token)
            conversation = self._service._lock_conversation_for_write(
                session=session, conversation_id=invite.conversation_id
            )
            if _normalize_text(conversation.kind) != "group":
                raise LookupError("Invite link not found or expired")
            existing = session.execute(
                select(ChatMember).where(
                    ChatMember.conversation_id == conversation.id,
                    ChatMember.user_id == int(current_user_id),
                )
            ).scalar_one_or_none()
            if existing is not None and existing.left_at is None:
                payload = self._service._build_conversation_detail_payload(
                    session, conversation, int(current_user_id)
                )
                return {"joined": False, "conversation": payload}
            if existing is not None:
                raise PermissionError(
                    "Вы уже выходили из этой группы: попросите владельца или модератора добавить вас"
                )
            if approval_required(session, conversation.id):
                # The group lets people in by approval: the link only leaves a request.
                request = submit_request(session, conversation.id, int(current_user_id))
                session.flush()
                return {"joined": False, "requested": True, "request_status": request.status, "conversation": None}
            member_ids = self._service._conversation_member_ids(session, conversation.id)
            if len(member_ids) + 1 > self._service.group_max_members:
                raise ValueError(f"Group member limit exceeded ({self._service.group_max_members})")

            invite.use_count = int(invite.use_count or 0) + 1
            self.add_member_from_link(
                session=session,
                conversation=conversation,
                user_id=int(current_user_id),
                user=user,
                body=f"{_display_user_name(user)} присоединился(ась) по ссылке",
                now=_utc_now(),
                affected_user_ids=affected_user_ids,
            )
            joined = True
            payload = self._service._build_conversation_detail_payload(
                session, conversation, int(current_user_id)
            )
            conversation_id = conversation.id

        if joined:
            self._service._invalidate_conversation_views_for_users(
                conversation_id=_normalize_text(conversation_id),
                user_ids=sorted(affected_user_ids),
            )
        return {"joined": joined, "conversation": payload}
