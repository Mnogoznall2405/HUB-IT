"""Chat folder CRUD."""
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
from uuid import uuid4

from backend.chat.chat_formatting import _utc_now
from backend.chat.folder_mutations import (
    normalize_folder_conversation_ids,
    require_owned_chat_folder,
    serialize_chat_folder,
    sum_unread_for_conversations,
)
from backend.chat.models import ChatFolder, ChatFolderConversation
from backend.chat.utils import normalize_text as _normalize_text

if TYPE_CHECKING:
    from backend.chat.service import ChatService


class ChatFolderService:
    def __init__(self, service: "ChatService") -> None:
        self._service = service

    def list_chat_folders(self, *, current_user_id: int) -> dict[str, Any]:
        
        user_id = int(current_user_id)
        with chat_session() as session:
            folders = list(
                session.execute(
                    select(ChatFolder)
                    .where(ChatFolder.user_id == user_id)
                    .order_by(ChatFolder.sort_order.asc(), ChatFolder.name.asc(), ChatFolder.created_at.asc())
                ).scalars()
            )
            memberships = list(
                session.execute(
                    select(ChatFolderConversation).where(ChatFolderConversation.user_id == user_id)
                ).scalars()
            )
            conversation_ids = sorted({row.conversation_id for row in memberships})
            unread_by_conversation: dict[str, int] = {}
            if conversation_ids:
                states = list(
                    session.execute(
                        select(ChatConversationUserState).where(
                            ChatConversationUserState.user_id == user_id,
                            ChatConversationUserState.conversation_id.in_(conversation_ids),
                        )
                    ).scalars()
                )
                unread_by_conversation = {
                    row.conversation_id: max(0, int(row.unread_count or 0))
                    for row in states
                }
            by_folder: dict[str, list[str]] = {}
            for row in memberships:
                by_folder.setdefault(row.folder_id, []).append(row.conversation_id)
            items = []
            conversation_ids_by_folder: dict[str, list[str]] = {}
            for folder in folders:
                folder_conversation_ids = sorted(by_folder.get(folder.id, []))
                conversation_ids_by_folder[folder.id] = folder_conversation_ids
                items.append(
                    serialize_chat_folder(
                        folder,
                        conversation_ids=folder_conversation_ids,
                        conversation_count=len(folder_conversation_ids),
                        unread_count=sum(unread_by_conversation.get(conv_id, 0) for conv_id in folder_conversation_ids),
                    )
                )
            payload = {"items": items, "conversation_ids_by_folder": conversation_ids_by_folder}
        self._service._cache_set(user_id=user_id, bucket="folders", extra="", value=payload)
        return payload

    def create_chat_folder(self, *, current_user_id: int, name: str) -> dict[str, Any]:
        
        user_id = int(current_user_id)
        normalized_name = _normalize_text(name)
        if len(normalized_name) < 1:
            raise ValueError("Folder name is required")
        if len(normalized_name) > 64:
            raise ValueError("Folder name is too long")
        now = _utc_now()
        with chat_session() as session:
            existing_count = int(
                session.execute(
                    select(func.count()).select_from(ChatFolder).where(ChatFolder.user_id == user_id)
                ).scalar_one()
                or 0
            )
            if existing_count >= 50:
                raise ValueError("Folder limit reached")
            folder = ChatFolder(
                id=str(uuid4()),
                user_id=user_id,
                name=normalized_name,
                sort_order=existing_count,
                created_at=now,
                updated_at=now,
            )
            session.add(folder)
            session.flush()
            payload = serialize_chat_folder(folder)
        self._service._invalidate_user_cache(user_id=user_id, bucket="folders")
        return payload

    def update_chat_folder(
        self,
        *,
        current_user_id: int,
        folder_id: str,
        name: Optional[str] = None,
        sort_order: Optional[int] = None,
    ) -> dict[str, Any]:
        
        user_id = int(current_user_id)
        with chat_session() as session:
            folder = require_owned_chat_folder(session, user_id=user_id, folder_id=folder_id)
            if name is not None:
                normalized_name = _normalize_text(name)
                if len(normalized_name) < 1:
                    raise ValueError("Folder name is required")
                if len(normalized_name) > 64:
                    raise ValueError("Folder name is too long")
                folder.name = normalized_name
            if sort_order is not None:
                folder.sort_order = int(sort_order)
            folder.updated_at = _utc_now()
            session.flush()
            memberships = list(
                session.execute(
                    select(ChatFolderConversation.conversation_id).where(
                        ChatFolderConversation.folder_id == folder.id,
                        ChatFolderConversation.user_id == user_id,
                    )
                ).scalars()
            )
            conversation_ids = sorted(memberships)
            unread_count = sum_unread_for_conversations(
                session,
                user_id=user_id,
                conversation_ids=conversation_ids,
            )
            payload = serialize_chat_folder(
                folder,
                conversation_ids=conversation_ids,
                conversation_count=len(conversation_ids),
                unread_count=unread_count,
            )
        self._service._invalidate_user_cache(user_id=user_id, bucket="folders")
        return payload

    def delete_chat_folder(self, *, current_user_id: int, folder_id: str) -> dict[str, Any]:
        
        user_id = int(current_user_id)
        with chat_session() as session:
            folder = require_owned_chat_folder(session, user_id=user_id, folder_id=folder_id)
            session.delete(folder)
            session.flush()
        self._service._invalidate_user_cache(user_id=user_id, bucket="folders")
        return {"ok": True, "id": _normalize_text(folder_id)}

    def get_chat_folder(self, *, current_user_id: int, folder_id: str) -> dict[str, Any]:
        
        user_id = int(current_user_id)
        with chat_session() as session:
            folder = require_owned_chat_folder(session, user_id=user_id, folder_id=folder_id)
            conversation_ids = sorted(
                session.execute(
                    select(ChatFolderConversation.conversation_id).where(
                        ChatFolderConversation.folder_id == folder.id,
                        ChatFolderConversation.user_id == user_id,
                    )
                ).scalars()
            )
            unread_count = sum_unread_for_conversations(
                session,
                user_id=user_id,
                conversation_ids=conversation_ids,
            )
            return serialize_chat_folder(
                folder,
                conversation_ids=conversation_ids,
                conversation_count=len(conversation_ids),
                unread_count=unread_count,
            )

    def set_chat_folder_conversations(
        self,
        *,
        current_user_id: int,
        folder_id: str,
        conversation_ids: list[str],
    ) -> dict[str, Any]:
        
        user_id = int(current_user_id)
        normalized_ids = normalize_folder_conversation_ids(conversation_ids)
        with chat_session() as session:
            folder = require_owned_chat_folder(session, user_id=user_id, folder_id=folder_id)
            for conversation_id in normalized_ids:
                self._service._require_membership(session=session, conversation_id=conversation_id, current_user_id=user_id)
            existing_rows = list(
                session.execute(
                    select(ChatFolderConversation).where(
                        ChatFolderConversation.folder_id == folder.id,
                        ChatFolderConversation.user_id == user_id,
                    )
                ).scalars()
            )
            existing_ids = {row.conversation_id for row in existing_rows}
            target_ids = set(normalized_ids)
            for row in existing_rows:
                if row.conversation_id not in target_ids:
                    session.delete(row)
            now = _utc_now()
            for conversation_id in normalized_ids:
                if conversation_id in existing_ids:
                    continue
                session.add(
                    ChatFolderConversation(
                        folder_id=folder.id,
                        conversation_id=conversation_id,
                        user_id=user_id,
                        added_at=now,
                    )
                )
            folder.updated_at = now
            session.flush()
            unread_count = sum_unread_for_conversations(
                session,
                user_id=user_id,
                conversation_ids=normalized_ids,
            )
            payload = serialize_chat_folder(
                folder,
                conversation_ids=normalized_ids,
                conversation_count=len(normalized_ids),
                unread_count=unread_count,
            )
        self._service._invalidate_user_cache(user_id=user_id, bucket="folders")
        return payload

    def add_chat_folder_conversation(
        self,
        *,
        current_user_id: int,
        folder_id: str,
        conversation_id: str,
    ) -> dict[str, Any]:
        
        user_id = int(current_user_id)
        normalized_conversation_id = _normalize_text(conversation_id)
        if not normalized_conversation_id:
            raise ValueError("conversation_id is required")
        with chat_session() as session:
            folder = require_owned_chat_folder(session, user_id=user_id, folder_id=folder_id)
            self._service._require_membership(session=session, conversation_id=normalized_conversation_id, current_user_id=user_id)
            existing = session.execute(
                select(ChatFolderConversation).where(
                    ChatFolderConversation.folder_id == folder.id,
                    ChatFolderConversation.conversation_id == normalized_conversation_id,
                )
            ).scalar_one_or_none()
            if existing is None:
                session.add(
                    ChatFolderConversation(
                        folder_id=folder.id,
                        conversation_id=normalized_conversation_id,
                        user_id=user_id,
                        added_at=_utc_now(),
                    )
                )
            folder.updated_at = _utc_now()
            session.flush()
            conversation_ids = sorted(
                session.execute(
                    select(ChatFolderConversation.conversation_id).where(
                        ChatFolderConversation.folder_id == folder.id,
                        ChatFolderConversation.user_id == user_id,
                    )
                ).scalars()
            )
            payload = serialize_chat_folder(
                folder,
                conversation_ids=conversation_ids,
                conversation_count=len(conversation_ids),
                unread_count=sum_unread_for_conversations(
                    session,
                    user_id=user_id,
                    conversation_ids=conversation_ids,
                ),
            )
        self._service._invalidate_user_cache(user_id=user_id, bucket="folders")
        return payload

    def remove_chat_folder_conversation(
        self,
        *,
        current_user_id: int,
        folder_id: str,
        conversation_id: str,
    ) -> dict[str, Any]:
        
        user_id = int(current_user_id)
        normalized_conversation_id = _normalize_text(conversation_id)
        if not normalized_conversation_id:
            raise ValueError("conversation_id is required")
        with chat_session() as session:
            folder = require_owned_chat_folder(session, user_id=user_id, folder_id=folder_id)
            row = session.execute(
                select(ChatFolderConversation).where(
                    ChatFolderConversation.folder_id == folder.id,
                    ChatFolderConversation.conversation_id == normalized_conversation_id,
                    ChatFolderConversation.user_id == user_id,
                )
            ).scalar_one_or_none()
            if row is not None:
                session.delete(row)
            folder.updated_at = _utc_now()
            session.flush()
            conversation_ids = sorted(
                session.execute(
                    select(ChatFolderConversation.conversation_id).where(
                        ChatFolderConversation.folder_id == folder.id,
                        ChatFolderConversation.user_id == user_id,
                    )
                ).scalars()
            )
            payload = serialize_chat_folder(
                folder,
                conversation_ids=conversation_ids,
                conversation_count=len(conversation_ids),
                unread_count=sum_unread_for_conversations(
                    session,
                    user_id=user_id,
                    conversation_ids=conversation_ids,
                ),
            )
        self._service._invalidate_user_cache(user_id=user_id, bucket="folders")
        return payload
