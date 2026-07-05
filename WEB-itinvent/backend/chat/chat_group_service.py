"""Group and direct conversation mutations."""
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
from backend.chat.utils import normalize_text as _normalize_text

if TYPE_CHECKING:
    from backend.chat.service import ChatService


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
        self._service._invalidate_user_cache(user_id=int(current_user_id), bucket="conversations")
        self._service._invalidate_user_cache(user_id=int(peer["id"]), bucket="conversations")
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
        self._service._invalidate_user_cache(user_id=int(current_user_id), bucket="conversations")
        return payload

    def create_group_conversation(self, *, current_user_id: int, title: str, member_user_ids: list[int]) -> dict:
        
        normalized_title = _normalize_text(title)
        if not normalized_title:
            raise ValueError("Group title is required")

        unique_member_ids = {int(item) for item in list(member_user_ids or []) if int(item) > 0}
        unique_member_ids.add(int(current_user_id))
        if len(unique_member_ids) > self._service.group_max_members:
            raise ValueError(f"Group member limit exceeded ({self._service.group_max_members})")
        members = [self._service._require_active_user(item) for item in sorted(unique_member_ids)]
        now = _utc_now()

        with chat_session() as session:
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
            conversation, actor_member = self._service._require_group_manager(
                session=session,
                conversation_id=conversation_id,
                current_user_id=int(current_user_id),
            )
            if _normalize_text(conversation.kind) == "task":
                raise ValueError("Task discussion members are managed by Hub tasks")
            conversation = self._service._lock_conversation_for_write(session=session, conversation_id=conversation.id)
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
                state.updated_at = now
                added_users.append(user)
                affected_user_ids.add(int(user_id))

            if added_users:
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
            conversation, actor_member = self._service._require_group_manager(
                session=session,
                conversation_id=conversation_id,
                current_user_id=int(current_user_id),
            )
            conversation = self._service._lock_conversation_for_write(session=session, conversation_id=conversation.id)
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
            target = self._service._require_active_user(normalized_target_user_id)
            now = _utc_now()
            target_member.left_at = now
            member_ids_after = self._service._conversation_member_ids(session, conversation.id)
            self._service._append_system_message(
                session=session,
                conversation=conversation,
                actor_user_id=int(current_user_id),
                body=f"{_display_user_name(actor)} исключил(а) {_display_user_name(target)}",
                member_user_ids=member_ids_after,
                now=now,
            )
            affected_user_ids.update(member_ids_after)
            session.flush()
            payload = self._service._build_conversation_detail_payload(session, conversation, int(current_user_id))

        self._service._invalidate_conversation_views_for_users(
            conversation_id=_normalize_text(conversation_id),
            user_ids=sorted(affected_user_ids),
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
            conversation, _ = self._service._require_group_owner(
                session=session,
                conversation_id=conversation_id,
                current_user_id=int(current_user_id),
            )
            conversation = self._service._lock_conversation_for_write(session=session, conversation_id=conversation.id)
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
            affected_user_ids.update(member_ids_after)
            session.flush()
            payload = self._service._build_conversation_detail_payload(session, conversation, int(current_user_id))

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
            conversation, actor_member = self._service._require_group_owner(
                session=session,
                conversation_id=conversation_id,
                current_user_id=int(current_user_id),
            )
            conversation = self._service._lock_conversation_for_write(session=session, conversation_id=conversation.id)
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
            affected_user_ids.update(member_ids_after)
            session.flush()
            payload = self._service._build_conversation_detail_payload(session, conversation, int(current_user_id))

        self._service._invalidate_conversation_views_for_users(
            conversation_id=_normalize_text(conversation_id),
            user_ids=sorted(affected_user_ids),
        )
        return payload

    def leave_group(self, *, current_user_id: int, conversation_id: str) -> dict:
        
        affected_user_ids: set[int] = {int(current_user_id)}
        with chat_session() as session:
            conversation, actor_member = self._service._require_group_membership(
                session=session,
                conversation_id=conversation_id,
                current_user_id=int(current_user_id),
            )
            conversation = self._service._lock_conversation_for_write(session=session, conversation_id=conversation.id)
            if _normalize_member_role(actor_member.member_role) == "owner":
                raise PermissionError("Transfer ownership before leaving the group")

            actor = self._service._require_active_user(int(current_user_id))
            now = _utc_now()
            actor_member.left_at = now
            member_ids_after = self._service._conversation_member_ids(session, conversation.id)
            self._service._append_system_message(
                session=session,
                conversation=conversation,
                actor_user_id=int(current_user_id),
                body=f"{_display_user_name(actor)} вышел(а) из группы",
                member_user_ids=member_ids_after,
                now=now,
            )
            affected_user_ids.update(member_ids_after)
            session.flush()

        self._service._invalidate_conversation_views_for_users(
            conversation_id=_normalize_text(conversation_id),
            user_ids=sorted(affected_user_ids),
        )
        return {"conversation_id": _normalize_text(conversation_id), "left": True}

    def update_group_profile(self, *, current_user_id: int, conversation_id: str, title: Optional[str] = None) -> dict:
        
        normalized_title = _normalize_text(title)
        if not normalized_title:
            raise ValueError("Group title is required")

        affected_user_ids: set[int] = {int(current_user_id)}
        with chat_session() as session:
            conversation, _ = self._service._require_group_owner(
                session=session,
                conversation_id=conversation_id,
                current_user_id=int(current_user_id),
            )
            conversation = self._service._lock_conversation_for_write(session=session, conversation_id=conversation.id)
            if _normalize_text(conversation.title) == normalized_title:
                return self._service._build_conversation_detail_payload(session, conversation, int(current_user_id))

            actor = self._service._require_active_user(int(current_user_id))
            now = _utc_now()
            conversation.title = normalized_title
            member_ids_after = self._service._conversation_member_ids(session, conversation.id)
            self._service._append_system_message(
                session=session,
                conversation=conversation,
                actor_user_id=int(current_user_id),
                body=f"{_display_user_name(actor)} переименовал(а) группу: {normalized_title}",
                member_user_ids=member_ids_after,
                now=now,
            )
            affected_user_ids.update(member_ids_after)
            session.flush()
            payload = self._service._build_conversation_detail_payload(session, conversation, int(current_user_id))

        self._service._invalidate_conversation_views_for_users(
            conversation_id=_normalize_text(conversation_id),
            user_ids=sorted(affected_user_ids),
        )
        return payload

    def update_group_avatar(self, *, current_user_id: int, conversation_id: str, avatar_url: Optional[str]) -> dict:
        
        normalized_avatar_url = _normalize_text(avatar_url) or None
        affected_user_ids: set[int] = {int(current_user_id)}
        with chat_session() as session:
            conversation, _ = self._service._require_group_owner(
                session=session,
                conversation_id=conversation_id,
                current_user_id=int(current_user_id),
            )
            conversation = self._service._lock_conversation_for_write(session=session, conversation_id=conversation.id)
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
