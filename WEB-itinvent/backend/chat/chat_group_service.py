"""Group and direct conversation mutations."""
from __future__ import annotations

from datetime import datetime, timedelta
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
from pathlib import Path
from uuid import uuid4

from backend.chat.chat_constants import NOTES_CONVERSATION_TITLE
from backend.chat.chat_formatting import (
    _direct_key,
    _display_user_name,
    _normalize_member_role,
    _notes_key,
    _utc_now,
)
from backend.chat.chat_group_admin import (
    ACTION_MEMBER_REMOVED,
    ACTION_MEMBER_RESTRICTED,
    ACTION_MEMBERS_ADDED,
    ACTION_OWNER_LEFT,
    ACTION_OWNERSHIP_TRANSFERRED,
    ACTION_PROFILE_UPDATED,
    ACTION_RESTRICTION_LIFTED,
    ACTION_ROLE_CHANGED,
    record_group_action,
)
from backend.chat.utils import normalize_text as _normalize_text

if TYPE_CHECKING:
    from backend.chat.service import ChatService


def _format_restriction(duration_seconds: Optional[int]) -> str:
    if not duration_seconds:
        return "бессрочно"
    seconds = int(duration_seconds)
    if seconds >= 86400 and seconds % 86400 == 0:
        days = seconds // 86400
        return "на 1 день" if days == 1 else f"на {days} дн."
    if seconds >= 3600 and seconds % 3600 == 0:
        return f"на {seconds // 3600} ч"
    return f"на {seconds} с"


def _format_slow_mode(seconds: int) -> str:
    seconds = int(seconds)
    if seconds >= 3600 and seconds % 3600 == 0:
        return f"{seconds // 3600} ч"
    if seconds >= 60 and seconds % 60 == 0:
        return f"{seconds // 60} мин"
    return f"{seconds} с"


class ChatGroupRateLimitedError(ValueError):
    """Too many groups created in a short time; the API answers 429 with Retry-After."""

    retry_after_sec = 60


def _advance_state_to_conversation_tip(
    state: ChatConversationUserState,
    conversation: ChatConversation,
    *,
    updated_at: datetime,
) -> None:
    state.last_read_message_id = conversation.last_message_id
    state.last_read_seq = max(0, int(conversation.last_message_seq or 0))
    state.last_read_at = conversation.last_message_at
    state.unread_count = 0
    state.unread_mention_count = 0
    state.updated_at = updated_at


class ChatGroupService:
    def __init__(self, service: "ChatService") -> None:
        self._service = service

    def create_direct_conversation(self, *, current_user_id: int, peer_user_id: int) -> dict:
        
        creator = self._service._require_active_user(int(current_user_id))
        peer = self._service._require_active_user(int(peer_user_id))
        if int(current_user_id) == int(peer_user_id):
            raise ValueError("Cannot create a direct conversation with yourself")

        direct_key = _direct_key(int(current_user_id), int(peer_user_id))
        with chat_session() as session:
            existing = session.execute(
                select(ChatConversation).where(
                    ChatConversation.kind == "direct",
                    ChatConversation.direct_key == direct_key,
                )
            ).scalar_one_or_none()
            if existing:
                return self._service._build_conversation_payload(session, existing, int(current_user_id))

            now = _utc_now()
            conversation = ChatConversation(
                id=str(uuid4()),
                kind="direct",
                direct_key=direct_key,
                title=None,
                created_by_user_id=int(current_user_id),
                created_at=now,
                updated_at=now,
            )
            session.add(conversation)
            session.flush()
            session.add_all(
                [
                    ChatMember(
                        conversation_id=conversation.id,
                        user_id=int(current_user_id),
                        member_role="owner",
                        joined_at=now,
                    ),
                    ChatMember(
                        conversation_id=conversation.id,
                        user_id=int(peer["id"]),
                        member_role="member",
                        joined_at=now,
                    ),
                ]
            )
            session.add_all(
                [
                    ChatConversationUserState(
                        conversation_id=conversation.id,
                        user_id=int(current_user_id),
                        opened_at=now,
                        updated_at=now,
                    ),
                    ChatConversationUserState(
                        conversation_id=conversation.id,
                        user_id=int(peer["id"]),
                        updated_at=now,
                    ),
                ]
            )
            session.flush()
            participant_ids = {int(current_user_id), int(peer["id"])}
            presence_map = self._service._get_presence_map(user_ids=participant_ids)
            payload = self._service._build_conversation_payload(
                session,
                conversation,
                int(current_user_id),
                users_override={
                    int(current_user_id): self._service._serialize_user(creator, presence_map=presence_map),
                    int(peer["id"]): self._service._serialize_user(peer, presence_map=presence_map),
                },
            )
        self._service._invalidate_user_cache(user_id=int(current_user_id), bucket="conversations", hard=True)
        self._service._invalidate_user_cache(user_id=int(peer["id"]), bucket="conversations", hard=True)
        return payload

    def get_or_create_notes_conversation(self, *, current_user_id: int) -> dict:
        
        owner = self._service._require_active_user(int(current_user_id))
        notes_key = _notes_key(int(current_user_id))
        with chat_session() as session:
            existing = session.execute(
                select(ChatConversation).where(
                    ChatConversation.kind == "notes",
                    ChatConversation.direct_key == notes_key,
                )
            ).scalar_one_or_none()
            if existing:
                return self._service._build_conversation_payload(session, existing, int(current_user_id))

            now = _utc_now()
            conversation = ChatConversation(
                id=str(uuid4()),
                kind="notes",
                direct_key=notes_key,
                title=NOTES_CONVERSATION_TITLE,
                created_by_user_id=int(current_user_id),
                created_at=now,
                updated_at=now,
            )
            session.add(conversation)
            session.flush()
            session.add(
                ChatMember(
                    conversation_id=conversation.id,
                    user_id=int(current_user_id),
                    member_role="owner",
                    joined_at=now,
                )
            )
            session.add(
                ChatConversationUserState(
                    conversation_id=conversation.id,
                    user_id=int(current_user_id),
                    is_pinned=True,
                    opened_at=now,
                    updated_at=now,
                )
            )
            session.flush()
            presence_map = self._service._get_presence_map(user_ids={int(current_user_id)})
            payload = self._service._build_conversation_payload(
                session,
                conversation,
                int(current_user_id),
                users_override={
                    int(current_user_id): self._service._serialize_user(owner, presence_map=presence_map),
                },
            )
        self._service._invalidate_user_cache(user_id=int(current_user_id), bucket="conversations", hard=True)
        return payload

    @staticmethod
    def _find_recent_identical_group(
        session, user_id: int, title: str, member_ids: set[int], now: datetime
    ) -> Optional[ChatConversation]:
        """Idempotency without a schema change: same creator, same title, same members, last minute."""
        candidates = session.execute(
            select(ChatConversation).where(
                ChatConversation.kind == "group",
                ChatConversation.created_by_user_id == int(user_id),
                ChatConversation.title == title,
                ChatConversation.created_at >= now - timedelta(seconds=60),
            ).order_by(ChatConversation.created_at.desc()).limit(3)
        ).scalars().all()
        for candidate in candidates:
            current = {
                int(item)
                for item in session.execute(
                    select(ChatMember.user_id).where(
                        ChatMember.conversation_id == candidate.id,
                        ChatMember.left_at.is_(None),
                    )
                ).scalars()
            }
            if current == {int(item) for item in member_ids}:
                return candidate
        return None

    def _enforce_group_creation_limits(self, session, user_id: int, now: datetime) -> None:
        """Soft limits (a parallel pair of requests may exceed them by one): a burst guard and a cap on
        owned groups. Membership in other people's groups is never capped here."""
        per_minute = int(self._service.group_create_per_minute)
        recent = session.execute(
            select(func.count(ChatConversation.id)).where(
                ChatConversation.kind == "group",
                ChatConversation.created_by_user_id == int(user_id),
                ChatConversation.created_at >= now - timedelta(seconds=60),
            )
        ).scalar_one()
        if int(recent or 0) >= per_minute:
            raise ChatGroupRateLimitedError(
                f"Слишком много новых бесед за минуту (не больше {per_minute}): подождите немного"
            )
        max_owned = int(self._service.group_max_owned)
        owned = session.execute(
            select(func.count(ChatMember.conversation_id))
            .join(ChatConversation, ChatConversation.id == ChatMember.conversation_id)
            .where(
                ChatConversation.kind == "group",
                ChatMember.user_id == int(user_id),
                ChatMember.member_role == "owner",
                ChatMember.left_at.is_(None),
            )
        ).scalar_one()
        if int(owned or 0) >= max_owned:
            raise ValueError(
                f"Достигнут предел: у вас уже {max_owned} бесед, где вы владелец. "
                "Передайте владение или выйдите из ненужных бесед"
            )

    def create_group_conversation(self, *, current_user_id: int, title: str, member_user_ids: list[int]) -> dict:
        
        normalized_title = _normalize_text(title)
        if not normalized_title:
            raise ValueError("Group title is required")

        unique_member_ids = {int(item) for item in list(member_user_ids or []) if int(item) > 0}
        unique_member_ids.discard(int(current_user_id))
        if not unique_member_ids:
            raise ValueError("Group needs at least one other member")
        unique_member_ids.add(int(current_user_id))
        if len(unique_member_ids) > self._service.group_max_members:
            raise ValueError(f"Group member limit exceeded ({self._service.group_max_members})")
        members = [self._service._require_active_user(item) for item in sorted(unique_member_ids)]
        now = _utc_now()

        with chat_session() as session:
            existing = self._find_recent_identical_group(
                session, int(current_user_id), normalized_title, unique_member_ids, now
            )
            if existing is not None:
                # A double tap or a client retry: hand back the group that was just created.
                return self._service._build_conversation_payload(session, existing, int(current_user_id))
            self._enforce_group_creation_limits(session, int(current_user_id), now)
            conversation = ChatConversation(
                id=str(uuid4()),
                kind="group",
                title=normalized_title,
                direct_key=None,
                created_by_user_id=int(current_user_id),
                created_at=now,
                updated_at=now,
            )
            session.add(conversation)
            session.flush()
            for member in members:
                user_id = int(member["id"])
                session.add(
                    ChatMember(
                        conversation_id=conversation.id,
                        user_id=user_id,
                        member_role="owner" if user_id == int(current_user_id) else "member",
                        joined_at=now,
                    )
                )
                session.add(
                    ChatConversationUserState(
                        conversation_id=conversation.id,
                        user_id=user_id,
                        opened_at=now if user_id == int(current_user_id) else None,
                        updated_at=now,
                    )
                )
            session.flush()
            participant_ids = {int(item["id"]) for item in members if int(item["id"]) > 0}
            presence_map = self._service._get_presence_map(user_ids=participant_ids)
            users_override = {int(item["id"]): self._service._serialize_user(item, presence_map=presence_map) for item in members}
            payload = self._service._build_conversation_payload(session, conversation, int(current_user_id), users_override=users_override)
        self._service._invalidate_conversation_views_for_users(
            conversation_id=_normalize_text(payload.get("id")),
            user_ids=[int(item["id"]) for item in members],
            hard=True,
        )
        return payload

    def add_group_members(self, *, current_user_id: int, conversation_id: str, member_user_ids: list[int]) -> dict:
        
        requested_user_ids = sorted({
            int(item)
            for item in list(member_user_ids or [])
            if int(item) > 0 and int(item) != int(current_user_id)
        })
        if not requested_user_ids:
            raise ValueError("member_user_ids is required")

        affected_user_ids: set[int] = {int(current_user_id)}
        with chat_session() as session:
            # Outsiders are refused before they can queue for the conversation write lock.
            self._service._require_membership(
                session=session, conversation_id=conversation_id, current_user_id=int(current_user_id)
            )
            self._service._lock_conversation_for_write(session=session, conversation_id=conversation_id)
            conversation, actor_member = self._service._require_group_manager(
                session=session,
                conversation_id=conversation_id,
                current_user_id=int(current_user_id),
            )
            if _normalize_text(conversation.kind) == "task":
                raise ValueError("Task discussion members are managed by Hub tasks")
            actor = self._service._require_active_user(int(current_user_id))
            active_member_ids = set(self._service._conversation_member_ids(session, conversation.id))
            candidate_user_ids = [user_id for user_id in requested_user_ids if user_id not in active_member_ids]
            if len(active_member_ids) + len(candidate_user_ids) > self._service.group_max_members:
                raise ValueError(f"Group member limit exceeded ({self._service.group_max_members})")

            existing_rows = list(
                session.execute(
                    select(ChatMember).where(
                        ChatMember.conversation_id == conversation.id,
                        ChatMember.user_id.in_(requested_user_ids),
                    )
                ).scalars()
            )
            existing_by_user_id = {int(item.user_id): item for item in existing_rows}
            added_users: list[dict] = []
            now = _utc_now()
            for user_id in candidate_user_ids:
                user = self._service._require_active_user(int(user_id))
                existing_member = existing_by_user_id.get(int(user_id))
                if existing_member is not None:
                    existing_member.left_at = None
                    existing_member.member_role = "member"
                    existing_member.joined_at = now
                else:
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
                _advance_state_to_conversation_tip(state, conversation, updated_at=now)
                added_users.append(user)
                affected_user_ids.add(int(user_id))

            if added_users:
                session.flush()
                member_ids_after = self._service._conversation_member_ids(session, conversation.id)
                added_names = ", ".join(_display_user_name(user) for user in added_users)
                self._service._append_system_message(
                    session=session,
                    conversation=conversation,
                    actor_user_id=int(current_user_id),
                    body=f"{_display_user_name(actor)} добавил(а): {added_names}",
                    member_user_ids=member_ids_after,
                    now=now,
                )
                record_group_action(
                    session,
                    conversation_id=conversation.id,
                    actor_user_id=int(current_user_id),
                    action=ACTION_MEMBERS_ADDED,
                    details={"user_ids": [int(user["id"]) for user in added_users]},
                )
                affected_user_ids.update(member_ids_after)
            else:
                conversation.updated_at = now
            session.flush()
            payload = self._service._build_conversation_detail_payload(session, conversation, int(current_user_id))

        self._service._invalidate_conversation_views_for_users(
            conversation_id=_normalize_text(conversation_id),
            user_ids=sorted(affected_user_ids),
        )
        return payload

    def remove_group_member(self, *, current_user_id: int, conversation_id: str, target_user_id: int) -> dict:
        
        normalized_target_user_id = int(target_user_id)
        if normalized_target_user_id <= 0:
            raise ValueError("target_user_id is required")
        if normalized_target_user_id == int(current_user_id):
            raise ValueError("Use leave endpoint to leave group")

        affected_user_ids: set[int] = {int(current_user_id), normalized_target_user_id}
        with chat_session() as session:
            # Outsiders are refused before they can queue for the conversation write lock.
            self._service._require_membership(
                session=session, conversation_id=conversation_id, current_user_id=int(current_user_id)
            )
            self._service._lock_conversation_for_write(session=session, conversation_id=conversation_id)
            conversation, actor_member = self._service._require_group_manager(
                session=session,
                conversation_id=conversation_id,
                current_user_id=int(current_user_id),
            )
            actor_role = _normalize_member_role(actor_member.member_role)
            target_member = self._service._get_active_membership(
                session=session,
                conversation_id=conversation.id,
                user_id=normalized_target_user_id,
            )
            if target_member is None:
                raise LookupError("Group member not found")
            target_role = _normalize_member_role(target_member.member_role)
            if target_role == "owner":
                raise PermissionError("Owner cannot be removed")
            if target_role == "moderator" and actor_role != "owner":
                raise PermissionError("Only owner can remove moderators")

            actor = self._service._require_active_user(int(current_user_id))
            try:
                target = self._service._require_active_user(normalized_target_user_id)
            except (ValueError, LookupError):
                # A deactivated account must still be removable from the group.
                from backend.chat.service import user_service

                target = user_service.get_by_id(normalized_target_user_id) or {}
            now = _utc_now()
            target_member.left_at = now
            session.flush()
            member_ids_after = self._service._conversation_member_ids(session, conversation.id)
            self._service._append_system_message(
                session=session,
                conversation=conversation,
                actor_user_id=int(current_user_id),
                body=f"{_display_user_name(actor)} исключил(а) {_display_user_name(target)}",
                member_user_ids=member_ids_after,
                now=now,
            )
            record_group_action(
                session,
                conversation_id=conversation.id,
                actor_user_id=int(current_user_id),
                action=ACTION_MEMBER_REMOVED,
                target_user_id=normalized_target_user_id,
            )
            target_state = self._service._get_or_create_conversation_state(
                session=session,
                conversation_id=conversation.id,
                current_user_id=normalized_target_user_id,
            )
            _advance_state_to_conversation_tip(target_state, conversation, updated_at=now)
            affected_user_ids.update(member_ids_after)
            session.flush()
            payload = self._service._build_conversation_detail_payload(session, conversation, int(current_user_id))

        self._service._invalidate_conversation_views_for_users(
            conversation_id=_normalize_text(conversation_id),
            user_ids=sorted(affected_user_ids),
            hard_drop_unread=True,
        )
        return payload

    def update_group_member_role(
        self,
        *,
        current_user_id: int,
        conversation_id: str,
        target_user_id: int,
        member_role: str,
    ) -> dict:
        
        normalized_target_user_id = int(target_user_id)
        next_role = _normalize_member_role(member_role)
        if next_role not in {"moderator", "member"}:
            raise ValueError("member_role must be moderator or member")
        if normalized_target_user_id <= 0:
            raise ValueError("target_user_id is required")
        if normalized_target_user_id == int(current_user_id):
            raise PermissionError("Owner role must be transferred through ownership endpoint")

        affected_user_ids: set[int] = {int(current_user_id), normalized_target_user_id}
        with chat_session() as session:
            # Outsiders are refused before they can queue for the conversation write lock.
            self._service._require_membership(
                session=session, conversation_id=conversation_id, current_user_id=int(current_user_id)
            )
            self._service._lock_conversation_for_write(session=session, conversation_id=conversation_id)
            conversation, _ = self._service._require_group_owner(
                session=session,
                conversation_id=conversation_id,
                current_user_id=int(current_user_id),
            )
            target_member = self._service._get_active_membership(
                session=session,
                conversation_id=conversation.id,
                user_id=normalized_target_user_id,
            )
            if target_member is None:
                raise LookupError("Group member not found")
            if _normalize_member_role(target_member.member_role) == "owner":
                raise PermissionError("Owner role cannot be changed here")
            if _normalize_member_role(target_member.member_role) == next_role:
                return self._service._build_conversation_detail_payload(session, conversation, int(current_user_id))

            actor = self._service._require_active_user(int(current_user_id))
            target = self._service._require_active_user(normalized_target_user_id)
            now = _utc_now()
            target_member.member_role = next_role
            member_ids_after = self._service._conversation_member_ids(session, conversation.id)
            action = "назначил(а) модератором" if next_role == "moderator" else "снял(а) модератора"
            self._service._append_system_message(
                session=session,
                conversation=conversation,
                actor_user_id=int(current_user_id),
                body=f"{_display_user_name(actor)} {action}: {_display_user_name(target)}",
                member_user_ids=member_ids_after,
                now=now,
            )
            record_group_action(
                session,
                conversation_id=conversation.id,
                actor_user_id=int(current_user_id),
                action=ACTION_ROLE_CHANGED,
                target_user_id=normalized_target_user_id,
                details={"role": next_role},
            )
            affected_user_ids.update(member_ids_after)
            session.flush()
            payload = self._service._build_conversation_detail_payload(session, conversation, int(current_user_id))

        self._service._invalidate_conversation_views_for_users(
            conversation_id=_normalize_text(conversation_id),
            user_ids=sorted(affected_user_ids),
        )
        return payload

    def restrict_group_member(
        self,
        *,
        current_user_id: int,
        conversation_id: str,
        target_user_id: int,
        duration_seconds: Optional[int] = None,
    ) -> dict:
        """Take a member's right to write (for a while or until lifted); the member still reads."""
        from backend.chat.chat_group_restrictions import set_restriction

        normalized_target_user_id = int(target_user_id)
        if normalized_target_user_id <= 0:
            raise ValueError("target_user_id is required")
        if normalized_target_user_id == int(current_user_id):
            raise PermissionError("Нельзя ограничить самого себя")

        affected_user_ids: set[int] = {int(current_user_id), normalized_target_user_id}
        with chat_session() as session:
            # Outsiders are refused before they can queue for the conversation write lock.
            self._service._require_membership(
                session=session, conversation_id=conversation_id, current_user_id=int(current_user_id)
            )
            self._service._lock_conversation_for_write(session=session, conversation_id=conversation_id)
            conversation, actor_member = self._service._require_group_manager(
                session=session,
                conversation_id=conversation_id,
                current_user_id=int(current_user_id),
            )
            target_member = self._service._get_active_membership(
                session=session,
                conversation_id=conversation.id,
                user_id=normalized_target_user_id,
            )
            if target_member is None:
                raise LookupError("Group member not found")
            target_role = _normalize_member_role(target_member.member_role)
            if target_role == "owner":
                raise PermissionError("Владельца группы ограничить нельзя")
            if target_role == "moderator" and _normalize_member_role(actor_member.member_role) != "owner":
                raise PermissionError("Модератора может ограничить только владелец")

            actor = self._service._require_active_user(int(current_user_id))
            target = self._service._require_active_user(normalized_target_user_id)
            set_restriction(
                session,
                conversation.id,
                normalized_target_user_id,
                duration_seconds=duration_seconds,
                restricted_by_user_id=int(current_user_id),
            )
            member_ids_after = self._service._conversation_member_ids(session, conversation.id)
            self._service._append_system_message(
                session=session,
                conversation=conversation,
                actor_user_id=int(current_user_id),
                body=(
                    f"{_display_user_name(actor)} ограничил(а) отправку сообщений: "
                    f"{_display_user_name(target)} ({_format_restriction(duration_seconds)})"
                ),
                member_user_ids=member_ids_after,
                now=_utc_now(),
            )
            record_group_action(
                session,
                conversation_id=conversation.id,
                actor_user_id=int(current_user_id),
                action=ACTION_MEMBER_RESTRICTED,
                target_user_id=normalized_target_user_id,
                details={"duration_seconds": int(duration_seconds)} if duration_seconds else None,
            )
            affected_user_ids.update(member_ids_after)
            session.flush()
            payload = self._service._build_conversation_detail_payload(session, conversation, int(current_user_id))

        from backend.chat.chat_group_restrictions import forget as _forget_restrictions

        _forget_restrictions(conversation_id)
        self._service._invalidate_conversation_views_for_users(
            conversation_id=_normalize_text(conversation_id),
            user_ids=sorted(affected_user_ids),
        )
        return payload

    def lift_group_member_restriction(
        self,
        *,
        current_user_id: int,
        conversation_id: str,
        target_user_id: int,
    ) -> dict:
        from backend.chat.chat_group_restrictions import clear_restriction

        normalized_target_user_id = int(target_user_id)
        if normalized_target_user_id <= 0:
            raise ValueError("target_user_id is required")

        affected_user_ids: set[int] = {int(current_user_id), normalized_target_user_id}
        with chat_session() as session:
            # Outsiders are refused before they can queue for the conversation write lock.
            self._service._require_membership(
                session=session, conversation_id=conversation_id, current_user_id=int(current_user_id)
            )
            self._service._lock_conversation_for_write(session=session, conversation_id=conversation_id)
            conversation, _actor_member = self._service._require_group_manager(
                session=session,
                conversation_id=conversation_id,
                current_user_id=int(current_user_id),
            )
            if not clear_restriction(session, conversation.id, normalized_target_user_id):
                return self._service._build_conversation_detail_payload(session, conversation, int(current_user_id))

            actor = self._service._require_active_user(int(current_user_id))
            target = self._service._require_active_user(normalized_target_user_id)
            member_ids_after = self._service._conversation_member_ids(session, conversation.id)
            self._service._append_system_message(
                session=session,
                conversation=conversation,
                actor_user_id=int(current_user_id),
                body=f"{_display_user_name(actor)} снял(а) ограничение: {_display_user_name(target)}",
                member_user_ids=member_ids_after,
                now=_utc_now(),
            )
            record_group_action(
                session,
                conversation_id=conversation.id,
                actor_user_id=int(current_user_id),
                action=ACTION_RESTRICTION_LIFTED,
                target_user_id=normalized_target_user_id,
            )
            affected_user_ids.update(member_ids_after)
            session.flush()
            payload = self._service._build_conversation_detail_payload(session, conversation, int(current_user_id))

        from backend.chat.chat_group_restrictions import forget as _forget_restrictions

        _forget_restrictions(conversation_id)
        self._service._invalidate_conversation_views_for_users(
            conversation_id=_normalize_text(conversation_id),
            user_ids=sorted(affected_user_ids),
        )
        return payload

    def transfer_group_ownership(self, *, current_user_id: int, conversation_id: str, owner_user_id: int) -> dict:
        
        next_owner_user_id = int(owner_user_id)
        if next_owner_user_id <= 0:
            raise ValueError("owner_user_id is required")
        if next_owner_user_id == int(current_user_id):
            raise ValueError("User is already owner")

        affected_user_ids: set[int] = {int(current_user_id), next_owner_user_id}
        with chat_session() as session:
            # Outsiders are refused before they can queue for the conversation write lock.
            self._service._require_membership(
                session=session, conversation_id=conversation_id, current_user_id=int(current_user_id)
            )
            self._service._lock_conversation_for_write(session=session, conversation_id=conversation_id)
            conversation, actor_member = self._service._require_group_owner(
                session=session,
                conversation_id=conversation_id,
                current_user_id=int(current_user_id),
            )
            next_owner_member = self._service._get_active_membership(
                session=session,
                conversation_id=conversation.id,
                user_id=next_owner_user_id,
            )
            if next_owner_member is None:
                raise LookupError("New owner must be an active group member")

            actor = self._service._require_active_user(int(current_user_id))
            next_owner = self._service._require_active_user(next_owner_user_id)
            now = _utc_now()
            actor_member.member_role = "moderator"
            next_owner_member.member_role = "owner"
            member_ids_after = self._service._conversation_member_ids(session, conversation.id)
            self._service._append_system_message(
                session=session,
                conversation=conversation,
                actor_user_id=int(current_user_id),
                body=f"{_display_user_name(actor)} передал(а) права владельца: {_display_user_name(next_owner)}",
                member_user_ids=member_ids_after,
                now=now,
            )
            record_group_action(
                session,
                conversation_id=conversation.id,
                actor_user_id=int(current_user_id),
                action=ACTION_OWNERSHIP_TRANSFERRED,
                target_user_id=next_owner_user_id,
            )
            affected_user_ids.update(member_ids_after)
            session.flush()
            payload = self._service._build_conversation_detail_payload(session, conversation, int(current_user_id))

        self._service._invalidate_conversation_views_for_users(
            conversation_id=_normalize_text(conversation_id),
            user_ids=sorted(affected_user_ids),
        )
        return payload

    def leave_group(
        self,
        *,
        current_user_id: int,
        conversation_id: str,
        successor_user_id: Optional[int] = None,
    ) -> dict:

        affected_user_ids: set[int] = {int(current_user_id)}
        with chat_session() as session:
            # Outsiders are refused before they can queue for the conversation write lock.
            self._service._require_membership(
                session=session, conversation_id=conversation_id, current_user_id=int(current_user_id)
            )
            self._service._lock_conversation_for_write(session=session, conversation_id=conversation_id)
            conversation, actor_member = self._service._require_group_membership(
                session=session,
                conversation_id=conversation_id,
                current_user_id=int(current_user_id),
            )
            actor = self._service._require_active_user(int(current_user_id))
            now = _utc_now()
            if _normalize_member_role(actor_member.member_role) == "owner":
                # The owner leaves only together with an explicit hand-over, in one transaction.
                next_owner_user_id = int(successor_user_id or 0)
                if next_owner_user_id <= 0:
                    raise PermissionError("Transfer ownership before leaving the group")
                if next_owner_user_id == int(current_user_id):
                    raise ValueError("User is already owner")
                successor_member = self._service._get_active_membership(
                    session=session,
                    conversation_id=conversation.id,
                    user_id=next_owner_user_id,
                )
                if successor_member is None:
                    raise LookupError("New owner must be an active group member")
                successor = self._service._require_active_user(next_owner_user_id)
                successor_member.member_role = "owner"
                affected_user_ids.add(next_owner_user_id)
                self._service._append_system_message(
                    session=session,
                    conversation=conversation,
                    actor_user_id=int(current_user_id),
                    body=f"{_display_user_name(actor)} передал(а) права владельца: {_display_user_name(successor)}",
                    member_user_ids=self._service._conversation_member_ids(session, conversation.id),
                    now=now,
                )
                record_group_action(
                    session,
                    conversation_id=conversation.id,
                    actor_user_id=int(current_user_id),
                    action=ACTION_OWNER_LEFT,
                    target_user_id=next_owner_user_id,
                )
            actor_member.left_at = now
            session.flush()
            member_ids_after = self._service._conversation_member_ids(session, conversation.id)
            self._service._append_system_message(
                session=session,
                conversation=conversation,
                actor_user_id=int(current_user_id),
                body=f"{_display_user_name(actor)} вышел(а) из группы",
                member_user_ids=member_ids_after,
                now=now,
            )
            actor_state = self._service._get_or_create_conversation_state(
                session=session,
                conversation_id=conversation.id,
                current_user_id=int(current_user_id),
            )
            _advance_state_to_conversation_tip(actor_state, conversation, updated_at=now)
            affected_user_ids.update(member_ids_after)
            session.flush()

        self._service._invalidate_conversation_views_for_users(
            conversation_id=_normalize_text(conversation_id),
            user_ids=sorted(affected_user_ids),
            hard_drop_unread=True,
        )
        return {"conversation_id": _normalize_text(conversation_id), "left": True}

    def update_group_profile(
        self,
        *,
        current_user_id: int,
        conversation_id: str,
        title: Optional[str] = None,
        description: Optional[str] = None,
        posting_policy: Optional[str] = None,
        slow_mode_seconds: Optional[int] = None,
        members_send_files: Optional[bool] = None,
    ) -> dict:
        from backend.chat.chat_group_limits import load_slow_mode_seconds, save_slow_mode
        from backend.chat.chat_group_permissions import load_members_send_files, save_members_send_files
        from backend.chat.chat_group_settings import load_group_settings, save_group_settings

        normalized_title = _normalize_text(title)
        if title is not None and not normalized_title:
            raise ValueError("Group title is required")
        if (
            title is None
            and description is None
            and posting_policy is None
            and slow_mode_seconds is None
            and members_send_files is None
        ):
            raise ValueError("Nothing to update")

        affected_user_ids: set[int] = {int(current_user_id)}
        with chat_session() as session:
            # Outsiders are refused before they can queue for the conversation write lock.
            self._service._require_membership(
                session=session, conversation_id=conversation_id, current_user_id=int(current_user_id)
            )
            self._service._lock_conversation_for_write(session=session, conversation_id=conversation_id)
            conversation, actor_member = self._service._require_group_manager(
                session=session,
                conversation_id=conversation_id,
                current_user_id=int(current_user_id),
            )
            actor_role = _normalize_member_role(actor_member.member_role)
            # Title and posting rules stay with the owner; moderators may edit the description.
            if (
                title is not None
                or posting_policy is not None
                or slow_mode_seconds is not None
                or members_send_files is not None
            ) and (actor_role != "owner"):
                raise PermissionError("Group owner access denied")

            actor = self._service._require_active_user(int(current_user_id))
            now = _utc_now()
            current_settings = load_group_settings(session, conversation.id)
            system_lines: list[str] = []
            changed_fields: list[str] = []

            if title is not None and _normalize_text(conversation.title) != normalized_title:
                conversation.title = normalized_title
                changed_fields.append("title")
                system_lines.append(f"{_display_user_name(actor)} переименовал(а) группу: {normalized_title}")

            description_changed = (
                description is not None
                and (_normalize_text(description) or None) != current_settings["description"]
            )
            policy_changed = (
                posting_policy is not None
                and _normalize_text(posting_policy).lower() != current_settings["posting_policy"]
            )
            if description_changed or policy_changed:
                save_group_settings(
                    session,
                    conversation.id,
                    description=description if description_changed else None,
                    posting_policy=posting_policy if policy_changed else None,
                    updated_by_user_id=int(current_user_id),
                )
                if description_changed:
                    changed_fields.append("description")
                    system_lines.append(f"{_display_user_name(actor)} обновил(а) описание группы")
                if policy_changed:
                    changed_fields.append("posting_policy")
                    next_policy = _normalize_text(posting_policy).lower()
                    if next_policy == "closed":
                        system_lines.append(f"{_display_user_name(actor)} закрыл(а) группу для сообщений")
                    elif next_policy == "managers":
                        system_lines.append(
                            f"{_display_user_name(actor)} разрешил(а) писать только владельцу и модераторам"
                        )
                    elif current_settings["posting_policy"] == "closed":
                        system_lines.append(f"{_display_user_name(actor)} снова открыл(а) группу")
                    else:
                        system_lines.append(f"{_display_user_name(actor)} разрешил(а) писать всем участникам")

            if slow_mode_seconds is not None and int(slow_mode_seconds) != load_slow_mode_seconds(
                session, conversation.id
            ):
                next_seconds = save_slow_mode(
                    session, conversation.id, int(slow_mode_seconds), updated_by_user_id=int(current_user_id)
                )
                changed_fields.append("slow_mode_seconds")
                if next_seconds > 0:
                    system_lines.append(
                        f"{_display_user_name(actor)} включил(а) медленный режим: {_format_slow_mode(next_seconds)}"
                    )
                else:
                    system_lines.append(f"{_display_user_name(actor)} выключил(а) медленный режим")

            if members_send_files is not None and bool(members_send_files) != load_members_send_files(
                session, conversation.id
            ):
                allowed = save_members_send_files(
                    session, conversation.id, bool(members_send_files), updated_by_user_id=int(current_user_id)
                )
                changed_fields.append("members_send_files")
                if allowed:
                    system_lines.append(f"{_display_user_name(actor)} разрешил(а) участникам отправлять файлы")
                else:
                    system_lines.append(
                        f"{_display_user_name(actor)} запретил(а) участникам отправлять файлы: "
                        "файлы могут отправлять только владелец и модераторы"
                    )

            if not system_lines:
                return self._service._build_conversation_detail_payload(session, conversation, int(current_user_id))

            record_group_action(
                session,
                conversation_id=conversation.id,
                actor_user_id=int(current_user_id),
                action=ACTION_PROFILE_UPDATED,
                details={
                    "fields": changed_fields,
                    **({"posting_policy": _normalize_text(posting_policy).lower()} if policy_changed else {}),
                    **(
                        {"slow_mode_seconds": int(slow_mode_seconds)}
                        if "slow_mode_seconds" in changed_fields
                        else {}
                    ),
                    **(
                        {"members_send_files": bool(members_send_files)}
                        if "members_send_files" in changed_fields
                        else {}
                    ),
                },
            )
            member_ids_after = self._service._conversation_member_ids(session, conversation.id)
            for line in system_lines:
                self._service._append_system_message(
                    session=session,
                    conversation=conversation,
                    actor_user_id=int(current_user_id),
                    body=line,
                    member_user_ids=member_ids_after,
                    now=now,
                )
            affected_user_ids.update(member_ids_after)
            session.flush()
            payload = self._service._build_conversation_detail_payload(session, conversation, int(current_user_id))

        from backend.chat.chat_group_limits import forget as _forget_slow_mode
        from backend.chat.chat_group_permissions import forget as _forget_files

        _forget_slow_mode(conversation_id)
        _forget_files(conversation_id)
        self._service._invalidate_conversation_views_for_users(
            conversation_id=_normalize_text(conversation_id),
            user_ids=sorted(affected_user_ids),
        )
        return payload

    def update_group_avatar(self, *, current_user_id: int, conversation_id: str, avatar_url: Optional[str]) -> dict:
        
        normalized_avatar_url = _normalize_text(avatar_url) or None
        affected_user_ids: set[int] = {int(current_user_id)}
        with chat_session() as session:
            # Outsiders are refused before they can queue for the conversation write lock.
            self._service._require_membership(
                session=session, conversation_id=conversation_id, current_user_id=int(current_user_id)
            )
            self._service._lock_conversation_for_write(session=session, conversation_id=conversation_id)
            conversation, _ = self._service._require_group_owner(
                session=session,
                conversation_id=conversation_id,
                current_user_id=int(current_user_id),
            )
            conversation.avatar_url = normalized_avatar_url
            member_ids_after = self._service._conversation_member_ids(session, conversation.id)
            affected_user_ids.update(member_ids_after)
            session.flush()
            payload = self._service._build_conversation_detail_payload(session, conversation, int(current_user_id))
        self._service._invalidate_conversation_views_for_users(
            conversation_id=_normalize_text(conversation_id),
            user_ids=sorted(affected_user_ids),
        )
        return payload

    def get_group_avatar_file_path(self, *, current_user_id: int, filename: str) -> str:
        from backend.chat.service import hub_service

        safe_name = "".join(
            c if c.isalnum() or c in "-_." else "_" for c in str(filename or "").strip()
        )
        if not safe_name.lower().endswith(".jpg"):
            raise LookupError("Avatar not found")

        path = Path(hub_service.data_dir) / "group_avatars" / safe_name
        if not path.is_file():
            raise LookupError("Avatar not found")

        avatar_fragment = f"/group-avatars/{safe_name}"
        candidate_id = safe_name[:-4] if safe_name.lower().endswith(".jpg") else safe_name
        with chat_session() as session:
            conversation = session.get(ChatConversation, candidate_id)
            if conversation is None or _normalize_text(conversation.kind) != "group":
                conversation = session.execute(
                    select(ChatConversation).where(
                        ChatConversation.kind == "group",
                        ChatConversation.avatar_url.contains(avatar_fragment),
                    )
                ).scalar_one_or_none()
            if conversation is None:
                raise LookupError("Avatar not found")
            stored_avatar_url = _normalize_text(conversation.avatar_url) or ""
            if avatar_fragment not in stored_avatar_url:
                raise LookupError("Avatar not found")
            self._service._require_membership(
                session=session,
                conversation_id=conversation.id,
                current_user_id=int(current_user_id),
            )
        return str(path)
