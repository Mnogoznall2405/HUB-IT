"""Chat membership and conversation access helpers."""
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
from datetime import datetime

from backend.chat.chat_constants import CHAT_GROUP_MANAGER_ROLES
from backend.chat.chat_formatting import _normalize_member_role
from backend.chat.utils import normalize_text as _normalize_text

if TYPE_CHECKING:
    from backend.chat.service import ChatService


class ChatMembership:
    def __init__(self, service: "ChatService") -> None:
        self._service = service

    def _require_membership(self, *, session, conversation_id: str, current_user_id: int) -> ChatConversation:
        conversation = session.get(ChatConversation, _normalize_text(conversation_id))
        if conversation is None or bool(conversation.is_archived):
            raise LookupError("Conversation not found")
        membership = session.execute(
            select(ChatMember).where(
                ChatMember.conversation_id == conversation.id,
                ChatMember.user_id == int(current_user_id),
                ChatMember.left_at.is_(None),
            )
        ).scalar_one_or_none()
        if membership is None:
            raise PermissionError("Conversation access denied")
        return conversation

    def _get_active_membership(self, *, session, conversation_id: str, user_id: int) -> ChatMember | None:
        return session.execute(
            select(ChatMember).where(
                ChatMember.conversation_id == _normalize_text(conversation_id),
                ChatMember.user_id == int(user_id),
                ChatMember.left_at.is_(None),
            )
        ).scalar_one_or_none()

    def _require_group_membership(self, *, session, conversation_id: str, current_user_id: int) -> tuple[ChatConversation, ChatMember]:
        conversation = self._service._require_membership(
            session=session,
            conversation_id=conversation_id,
            current_user_id=int(current_user_id),
        )
        if _normalize_text(conversation.kind) != "group":
            raise ValueError("Group conversation required")
        membership = self._service._get_active_membership(
            session=session,
            conversation_id=conversation.id,
            user_id=int(current_user_id),
        )
        if membership is None:
            raise PermissionError("Conversation access denied")
        return conversation, membership

    def _require_group_manager(self, *, session, conversation_id: str, current_user_id: int) -> tuple[ChatConversation, ChatMember]:
        conversation, membership = self._service._require_group_membership(
            session=session,
            conversation_id=conversation_id,
            current_user_id=int(current_user_id),
        )
        if _normalize_member_role(membership.member_role) not in CHAT_GROUP_MANAGER_ROLES:
            raise PermissionError("Group manager access denied")
        return conversation, membership

    def _require_group_owner(self, *, session, conversation_id: str, current_user_id: int) -> tuple[ChatConversation, ChatMember]:
        conversation, membership = self._service._require_group_membership(
            session=session,
            conversation_id=conversation_id,
            current_user_id=int(current_user_id),
        )
        if _normalize_member_role(membership.member_role) != "owner":
            raise PermissionError("Group owner access denied")
        return conversation, membership

    def _lock_conversation_for_write(self, *, session, conversation_id: str) -> ChatConversation:
        normalized_conversation_id = _normalize_text(conversation_id)
        bind = session.get_bind()
        dialect_name = str(getattr(getattr(bind, "dialect", None), "name", "") or "").lower()
        query = select(ChatConversation).where(ChatConversation.id == normalized_conversation_id)
        if dialect_name == "postgresql":
            query = query.with_for_update()
        conversation = session.execute(query).scalar_one_or_none()
        if conversation is None or bool(conversation.is_archived):
            raise LookupError("Conversation not found")
        return conversation

    def _conversation_member_ids(self, session, conversation_id: str) -> list[int]:
        rows = session.execute(
            select(ChatMember.user_id).where(
                ChatMember.conversation_id == _normalize_text(conversation_id),
                ChatMember.left_at.is_(None),
            )
        ).scalars()
        return sorted({int(item) for item in rows if int(item) > 0})

    def _append_system_message(
        self,
        *,
        session,
        conversation: ChatConversation,
        actor_user_id: int,
        body: str,
        member_user_ids: list[int],
        now: datetime,
    ) -> ChatMessage:
        return self._service._system_message_persistence.append_system_message(
            session=session,
            conversation=conversation,
            actor_user_id=int(actor_user_id),
            body=body,
            member_user_ids=member_user_ids,
            now=now,
        )

    def _resolve_reply_message(
        self,
        *,
        session,
        conversation_id: str,
        reply_to_message_id: Optional[str],
    ) -> Optional[ChatMessage]:
        normalized_reply_id = _normalize_text(reply_to_message_id)
        if not normalized_reply_id:
            return None
        reply_to_message = session.get(ChatMessage, normalized_reply_id)
        if reply_to_message is None or reply_to_message.conversation_id != conversation_id:
            raise LookupError("Quoted message not found")
        return reply_to_message
