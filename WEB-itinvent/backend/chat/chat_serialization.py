"""Conversation and message payload serialization."""
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

from backend.chat.chat_constants import CHAT_DELETED_MESSAGE_BODY, NOTES_CONVERSATION_TITLE
from backend.chat.chat_formatting import (
    _display_user_name,
    _iso,
    _normalize_body_format,
    _normalize_member_role,
    _strip_markdown_preview,
    _truncate_text,
)
from backend.chat.utils import normalize_text as _normalize_text

if TYPE_CHECKING:
    from backend.chat.service import ChatService


class ChatSerialization:
    def __init__(self, service: "ChatService") -> None:
        self._service = service

    def _serialize_upload_session_file(self, file_payload: dict[str, Any]) -> dict[str, Any]:
        return self._service._upload_sessions.serialize_file(file_payload)

    def _serialize_upload_session(self, manifest: dict[str, Any]) -> dict[str, Any]:
        return self._service._upload_sessions.serialize_manifest(manifest)

    def _build_conversation_payload(
        self,
        session,
        conversation: ChatConversation,
        current_user_id: int,
        *,
        users_override: Optional[dict[int, dict]] = None,
    ) -> dict:
        return self._service._build_conversation_summary_payload(
            session=session,
            conversation=conversation,
            current_user_id=current_user_id,
            users_override=users_override,
        )

    def _build_conversation_summary_payload(
        self,
        session,
        conversation: ChatConversation,
        current_user_id: int,
        *,
        users_override: Optional[dict[int, dict]] = None,
    ) -> dict:
        members = list(
            session.execute(
                select(ChatMember).where(
                    ChatMember.conversation_id == conversation.id,
                    ChatMember.left_at.is_(None),
                )
            ).scalars()
        )
        state = session.execute(
            select(ChatConversationUserState).where(
                ChatConversationUserState.conversation_id == conversation.id,
                ChatConversationUserState.user_id == int(current_user_id),
            )
        ).scalar_one_or_none()
        last_message = None
        if _normalize_text(conversation.last_message_id):
            last_message = session.get(ChatMessage, conversation.last_message_id)
        member_ids = [
            int(item.user_id)
            for item in members
            if int(item.user_id) > 0
        ]
        presence_map = self._service._get_presence_map(user_ids=member_ids)
        users_by_id = users_override or self._service._get_users_map(
            presence_map=presence_map,
            user_ids=member_ids,
        )
        last_message_attachments = self._service._list_attachments_by_message(
            session=session,
            message_ids=[last_message.id],
        ).get(last_message.id, []) if last_message is not None else []
        reads_by_message_id: dict[str, list[ChatMessageRead]] = {}
        if last_message is not None:
            reads = list(
                session.execute(
                    select(ChatMessageRead).where(ChatMessageRead.message_id == last_message.id)
                ).scalars()
            )
            if reads:
                reads_by_message_id[last_message.id] = reads
        states_by_user_id = {
            int(item.user_id): item
            for item in session.execute(
                select(ChatConversationUserState).where(
                    ChatConversationUserState.conversation_id == conversation.id,
                )
            ).scalars()
            if int(getattr(item, "user_id", 0) or 0) > 0
        }
        unread_count = max(0, int(getattr(state, "unread_count", 0) or 0))
        return self._service._serialize_conversation(
            session=session,
            conversation=conversation,
            current_user_id=int(current_user_id),
            users_by_id=users_by_id,
            members=members,
            state=state,
            last_message=last_message,
            unread_count=unread_count,
            last_message_attachments=last_message_attachments,
            reads_by_message_id=reads_by_message_id,
            states_by_user_id=states_by_user_id,
        )

    def _build_conversation_detail_payload(
        self,
        session,
        conversation: ChatConversation,
        current_user_id: int,
        *,
        users_override: Optional[dict[int, dict]] = None,
    ) -> dict:
        summary_payload = self._service._build_conversation_summary_payload(
            session=session,
            conversation=conversation,
            current_user_id=current_user_id,
            users_override=users_override,
        )
        members = list(
            session.execute(
                select(ChatMember).where(
                    ChatMember.conversation_id == conversation.id,
                    ChatMember.left_at.is_(None),
                )
            ).scalars()
        )
        member_ids = [int(item.user_id) for item in members if int(item.user_id) > 0]
        presence_map = self._service._get_presence_map(user_ids=member_ids)
        users_by_id = users_override or self._service._get_users_map(
            presence_map=presence_map,
            user_ids=member_ids,
        )
        summary_payload["members"] = self._service._serialize_conversation_members(
            members=members,
            users_by_id=users_by_id,
        )
        return summary_payload

    def _serialize_conversation_members(
        self,
        *,
        members: list[ChatMember],
        users_by_id: dict[int, dict],
    ) -> list[dict]:
        items: list[dict] = []
        for member in members:
            user_payload = users_by_id.get(int(member.user_id))
            if user_payload is None:
                continue
            items.append(
                {
                    "user": user_payload,
                    "member_role": _normalize_text(member.member_role) or "member",
                    "joined_at": _iso(member.joined_at) or "",
                }
            )
        return items

    def _serialize_conversation(
        self,
        *,
        session,
        conversation: ChatConversation,
        current_user_id: int,
        users_by_id: dict[int, dict],
        members: list[ChatMember],
        state: Optional[ChatConversationUserState],
        last_message: Optional[ChatMessage],
        unread_count: Optional[int] = None,
        last_message_attachments: Optional[list[ChatMessageAttachment]] = None,
        task_exists_map: Optional[dict[str, bool]] = None,
        task_payloads_by_id: Optional[dict[str, dict]] = None,
        reads_by_message_id: Optional[dict[str, list[ChatMessageRead]]] = None,
        states_by_user_id: Optional[dict[int, ChatConversationUserState]] = None,
    ) -> dict:
        direct_peer = None
        member_count = 0
        online_member_count = 0
        member_preview: list[dict[str, Any]] = []
        viewer_member_role = None
        for member in members:
            if int(member.user_id) == int(current_user_id):
                viewer_member_role = _normalize_member_role(member.member_role)
            user_payload = users_by_id.get(int(member.user_id))
            if user_payload is None:
                continue
            member_count += 1
            if bool((user_payload.get("presence") or {}).get("is_online")):
                online_member_count += 1
            if len(member_preview) < 5:
                member_preview.append(
                    {
                        "user": user_payload,
                        "member_role": _normalize_text(member.member_role) or "member",
                        "joined_at": _iso(member.joined_at) or "",
                    }
                )
            if conversation.kind == "direct" and int(member.user_id) != int(current_user_id):
                direct_peer = user_payload

        title = _normalize_text(conversation.title)
        task_id_value = _normalize_text(getattr(conversation, "task_id", None)) or None
        task_status = None
        task_title = None
        task_assignee_full_name = None
        task_due_at = None
        task_completed_at = None
        task_missing = False
        if task_id_value:
            if task_exists_map is not None:
                task_missing = not bool(task_exists_map.get(task_id_value))
            else:
                from backend.chat.service import hub_service

                task_missing = not hub_service.task_exists(task_id_value)
        if conversation.kind == "direct":
            peer_name = _normalize_text((direct_peer or {}).get("full_name")) or _normalize_text((direct_peer or {}).get("username"))
            title = peer_name or "Личный диалог"
        elif conversation.kind == "notes":
            title = NOTES_CONVERSATION_TITLE
        elif conversation.kind == "ai":
            title = title or "AI чат"
        elif conversation.kind == "task" or task_id_value:
            if task_id_value:
                task_payload = None
                if task_payloads_by_id is not None:
                    task_payload = task_payloads_by_id.get(task_id_value)
                else:
                    task_payload = self._service._get_hub_task_for_user(task_id=task_id_value, user_id=int(current_user_id))
                if task_payload:
                    task_status = _normalize_text(task_payload.get("status")) or None
                    task_title = _normalize_text(task_payload.get("title")) or None
                    task_assignee_full_name = _normalize_text(task_payload.get("assignee_full_name")) or None
                    task_due_at = _normalize_text(task_payload.get("due_at")) or None
                    task_completed_at = _normalize_text(task_payload.get("completed_at")) or None
                    if task_title and not title:
                        title = f"Задача: {task_title}"
            if not title:
                title = "Чат по задаче"
        if not title:
            title = "Групповой чат"

        last_message_preview = self._service._build_conversation_message_preview(
            session=session,
            last_message=last_message,
            current_user_id=int(current_user_id),
            users_by_id=users_by_id,
            conversation_kind=conversation.kind,
            attachments=last_message_attachments,
        )

        last_message_is_own = False
        last_message_delivery_status = None
        if last_message is not None:
            last_message_is_own = int(last_message.sender_user_id) == int(current_user_id)
            if (
                last_message_is_own
                and conversation.kind == "direct"
                and not bool(getattr(last_message, "is_deleted", False))
            ):
                member_ids_list = [
                    int(member.user_id)
                    for member in members
                    if int(member.user_id) > 0
                ]
                read_receipts = self._service._build_message_read_receipts(
                    message=last_message,
                    reader_user_ids=[
                        user_id
                        for user_id in member_ids_list
                        if user_id != int(current_user_id)
                    ],
                    states_by_user_id=states_by_user_id or {},
                    reads_by_user_id={
                        int(item.user_id): item
                        for item in list((reads_by_message_id or {}).get(last_message.id, []))
                        if int(item.user_id) != int(current_user_id)
                    },
                )
                last_message_delivery_status = "read" if len(read_receipts) > 0 else "sent"

        resolved_unread_count = int(
            unread_count
            if unread_count is not None
            else self._service._count_unread_messages(
                session=session,
                conversation_id=conversation.id,
                current_user_id=int(current_user_id),
                last_read_at=getattr(state, "last_read_at", None),
            )
        )
        return {
            "id": conversation.id,
            "kind": conversation.kind if conversation.kind in {"direct", "group", "ai", "notes", "task"} else "group",
            "title": title,
            "avatar_url": _normalize_text(getattr(conversation, "avatar_url", None)) or None,
            "task_id": task_id_value,
            "task_missing": task_missing,
            "task_title": task_title,
            "task_status": task_status,
            "task_assignee_full_name": task_assignee_full_name,
            "task_due_at": task_due_at,
            "task_completed_at": task_completed_at,
            "created_at": _iso(conversation.created_at) or "",
            "updated_at": _iso(conversation.updated_at) or "",
            "last_message_at": _iso(conversation.last_message_at),
            "last_message_preview": last_message_preview,
            "last_message_is_own": last_message_is_own,
            "last_message_delivery_status": last_message_delivery_status,
            "unread_count": resolved_unread_count,
            "member_count": member_count,
            "online_member_count": online_member_count,
            "is_pinned": bool(getattr(state, "is_pinned", False)),
            "is_muted": bool(getattr(state, "is_muted", False)),
            "is_archived": bool(getattr(state, "is_archived", False)),
            "viewer_member_role": viewer_member_role,
            "member_preview": member_preview,
            "direct_peer": direct_peer,
        }

    def _collect_message_payload_user_ids(
        self,
        *,
        session,
        message: ChatMessage,
        current_user_id: int,
    ) -> list[int]:
        required_user_ids = {
            int(current_user_id or 0),
            int(getattr(message, "sender_user_id", 0) or 0),
        }
        referenced_message_ids = [
            _normalize_text(getattr(message, "reply_to_message_id", None)),
            _normalize_text(getattr(message, "forward_from_message_id", None)),
        ]
        normalized_referenced_ids = [
            item
            for item in referenced_message_ids
            if item
        ]
        if normalized_referenced_ids:
            referenced_rows = session.execute(
                select(ChatMessage.sender_user_id).where(ChatMessage.id.in_(normalized_referenced_ids))
            ).all()
            for sender_user_id, in referenced_rows:
                normalized_sender_user_id = int(sender_user_id or 0)
                if normalized_sender_user_id > 0:
                    required_user_ids.add(normalized_sender_user_id)
        return sorted({
            int(user_id)
            for user_id in required_user_ids
            if int(user_id) > 0
        })

    def _serialize_message(
        self,
        *,
        conversation_kind: str = "direct",
        message: ChatMessage,
        current_user_id: int,
        users_by_id: dict[int, dict],
        member_ids: Optional[list[int]] = None,
        states_by_user_id: Optional[dict[int, ChatConversationUserState]] = None,
        reads_by_message_id: Optional[dict[str, list[ChatMessageRead]]] = None,
        reply_previews: Optional[dict[str, dict]] = None,
        forward_previews: Optional[dict[str, dict]] = None,
        attachments: Optional[list[dict] | list[ChatMessageAttachment]] = None,
        reactions_by_message_id: Optional[dict[str, list[dict]]] = None,
        action_cards_by_message_id: Optional[dict[str, dict]] = None,
    ) -> dict:
        sender = users_by_id.get(int(message.sender_user_id)) or {
            "id": int(message.sender_user_id),
            "username": f"user-{message.sender_user_id}",
            "full_name": None,
            "role": "viewer",
            "is_active": True,
            "presence": None,
        }
        is_deleted = bool(getattr(message, "is_deleted", False))
        message_kind = self._service._normalize_message_kind(getattr(message, "kind", "text"))
        attachment_payload = [
            item if isinstance(item, dict) else self._service._attachment_to_payload(item)
            for item in ([] if is_deleted else list(attachments or []))
        ]
        is_own = int(message.sender_user_id) == int(current_user_id)
        read_receipts = []
        if is_own:
            read_receipts = self._service._build_message_read_receipts(
                message=message,
                reader_user_ids=[
                    int(user_id)
                    for user_id in list(member_ids or [])
                    if int(user_id) > 0 and int(user_id) != int(current_user_id)
                ],
                states_by_user_id=states_by_user_id or {},
                reads_by_user_id={
                    int(item.user_id): item
                    for item in list((reads_by_message_id or {}).get(message.id, []))
                    if int(item.user_id) != int(current_user_id)
                },
            )
        read_by_count = len(read_receipts)
        return {
            "id": message.id,
            "conversation_id": message.conversation_id,
            "kind": message_kind,
            "body_format": _normalize_text(getattr(message, "body_format", None), "plain") or "plain",
            "client_message_id": _normalize_text(getattr(message, "client_message_id", None)) or None,
            "sender": sender,
            "body": CHAT_DELETED_MESSAGE_BODY if is_deleted else message.body,
            "created_at": _iso(message.created_at) or "",
            "edited_at": _iso(message.edited_at),
            "is_deleted": is_deleted,
            "deleted_at": _iso(getattr(message, "deleted_at", None)),
            "deleted_by_user_id": int(getattr(message, "deleted_by_user_id", 0) or 0) or None,
            "deleted_reason": _normalize_text(getattr(message, "deleted_reason", None)) or None,
            "is_own": is_own,
            "delivery_status": ("read" if read_by_count > 0 else "sent") if is_own else None,
            "read_by_count": read_by_count if is_own else 0,
            "reply_preview": dict((reply_previews or {}).get(_normalize_text(getattr(message, "reply_to_message_id", None))) or {}) or None,
            "forward_preview": dict((forward_previews or {}).get(_normalize_text(getattr(message, "forward_from_message_id", None))) or {}) or None,
            "task_preview": None if is_deleted else self._service._deserialize_task_preview(getattr(message, "task_preview_json", None)),
            "attachments": attachment_payload,
            "action_card": None if is_deleted else self._resolve_message_action_card(
                message_id=message.id,
                action_cards_by_message_id=action_cards_by_message_id,
            ),
            "reactions": list((reactions_by_message_id or {}).get(message.id, [])),
        }

    def _resolve_message_action_card(
        self,
        *,
        message_id: str,
        action_cards_by_message_id: Optional[dict[str, dict]] = None,
    ) -> dict | None:
        if action_cards_by_message_id is not None:
            return dict(action_cards_by_message_id.get(message_id) or {}) or None
        return self._get_message_action_card(message_id=message_id)

    def _get_message_action_card(self, *, message_id: str) -> dict | None:
        try:
            from backend.ai_chat.action_cards import get_action_card_for_message

            return get_action_card_for_message(message_id)
        except Exception:
            return None

    def _build_conversation_message_preview(
        self,
        *,
        session,
        last_message: Optional[ChatMessage],
        current_user_id: int,
        users_by_id: dict[int, dict],
        conversation_kind: str,
        attachments: Optional[list[ChatMessageAttachment]] = None,
    ) -> str:
        if last_message is None:
            return ""

        preview = CHAT_DELETED_MESSAGE_BODY if bool(getattr(last_message, "is_deleted", False)) else _normalize_text(getattr(last_message, "body", ""))[:180]
        message_kind = self._service._normalize_message_kind(getattr(last_message, "kind", "text"))
        if bool(getattr(last_message, "is_deleted", False)):
            preview = CHAT_DELETED_MESSAGE_BODY
        elif message_kind == "task_share":
            task_preview = self._service._deserialize_task_preview(getattr(last_message, "task_preview_json", None))
            task_title = _normalize_text((task_preview or {}).get("title"))
            preview = f"Задача: {task_title}" if task_title else "Поделились задачей"
        elif message_kind == "file" and not preview:
            resolved_attachments = list(attachments or self._service._list_attachments_by_message(
                session=session,
                message_ids=[getattr(last_message, "id", "")],
            ).get(getattr(last_message, "id", ""), []))
            if len(resolved_attachments) == 1:
                preview = f"Файл: {_normalize_text(resolved_attachments[0].file_name)}"
            elif len(resolved_attachments) > 1:
                preview = f"Файлы: {len(resolved_attachments)}"
            else:
                preview = "Файлы"
        if _normalize_text(getattr(last_message, "forward_from_message_id", None)):
            preview = f"Переслано: {preview}" if preview else "Пересланное сообщение"

        sender = users_by_id.get(int(getattr(last_message, "sender_user_id", 0) or 0)) or {}
        if conversation_kind == "group":
            sender_name = "Вы" if int(getattr(last_message, "sender_user_id", 0) or 0) == int(current_user_id) else self._service._get_short_user_name(sender)
            return f"{sender_name}: {preview}" if sender_name and preview else preview
        if int(getattr(last_message, "sender_user_id", 0) or 0) == int(current_user_id):
            return f"Вы: {preview}" if preview else "Вы"
        return preview

    def _build_reply_previews(
        self,
        *,
        session,
        reply_to_message_ids: list[object],
        users_by_id: dict[int, dict],
    ) -> dict[str, dict]:
        normalized_ids = [
            _normalize_text(item)
            for item in list(reply_to_message_ids or [])
            if _normalize_text(item)
        ]
        if not normalized_ids:
            return {}

        reply_messages = list(
            session.execute(select(ChatMessage).where(ChatMessage.id.in_(normalized_ids))).scalars()
        )
        attachments_by_message = self._service._list_attachments_by_message(
            session=session,
            message_ids=[item.id for item in reply_messages],
        )
        return {
            item.id: self._service._reply_preview_payload(
                message=item,
                attachments=attachments_by_message.get(item.id, []),
                users_by_id=users_by_id,
            )
            for item in reply_messages
        }

    def _build_forward_previews(
        self,
        *,
        session,
        forward_from_message_ids: list[object],
        users_by_id: Optional[dict[int, dict]] = None,
    ) -> dict[str, dict]:
        normalized_ids = [
            _normalize_text(item)
            for item in list(forward_from_message_ids or [])
            if _normalize_text(item)
        ]
        if not normalized_ids:
            return {}

        source_messages = list(
            session.execute(select(ChatMessage).where(ChatMessage.id.in_(normalized_ids))).scalars()
        )
        attachments_by_message = self._service._list_attachments_by_message(
            session=session,
            message_ids=[item.id for item in source_messages],
        )
        if users_by_id is not None:
            resolved_users = users_by_id
        else:
            source_sender_ids = {
                int(getattr(item, "sender_user_id", 0) or 0)
                for item in source_messages
                if int(getattr(item, "sender_user_id", 0) or 0) > 0
            }
            presence_map = self._service._get_presence_map(user_ids=source_sender_ids)
            resolved_users = self._service._get_users_map(presence_map=presence_map, user_ids=source_sender_ids)
        return {
            item.id: self._service._forward_preview_payload(
                message=item,
                attachments=attachments_by_message.get(item.id, []),
                users_by_id=resolved_users,
            )
            for item in source_messages
        }

    def _build_message_search_haystack(
        self,
        *,
        message: ChatMessage,
        attachments: list[ChatMessageAttachment],
        users_by_id: dict[int, dict],
    ) -> str:
        sender = users_by_id.get(int(message.sender_user_id)) or {}
        task_preview = self._service._deserialize_task_preview(getattr(message, "task_preview_json", None)) or {}
        parts = [
            _normalize_text(getattr(message, "body", "")),
            _normalize_text(task_preview.get("title")),
            _normalize_text(sender.get("full_name")),
            _normalize_text(sender.get("username")),
        ]
        parts.extend(_normalize_text(item.file_name) for item in list(attachments or []))
        return " ".join(part.lower() for part in parts if part)

    def _build_message_payload_for_members(
        self,
        *,
        session,
        conversation: ChatConversation,
        message: ChatMessage,
        current_user_id: int,
        member_user_ids: list[int],
        attachments: Optional[list[dict] | list[ChatMessageAttachment]] = None,
    ) -> dict[str, Any]:
        payload_user_ids = self._service._collect_message_payload_user_ids(
            session=session,
            message=message,
            current_user_id=int(current_user_id),
        )
        presence_map = self._service._get_presence_map(user_ids=payload_user_ids)
        users_by_id = self._service._get_users_map(presence_map=presence_map, user_ids=payload_user_ids)
        action_cards_by_message_id = self._service._batch_action_cards_for_messages(
            session=session,
            message_ids=[message.id],
        )
        return self._service._serialize_message(
            conversation_kind=conversation.kind,
            message=message,
            current_user_id=int(current_user_id),
            users_by_id=users_by_id,
            member_ids=member_user_ids,
            reply_previews=self._service._build_reply_previews(
                session=session,
                reply_to_message_ids=[getattr(message, "reply_to_message_id", None)],
                users_by_id=users_by_id,
            ),
            forward_previews=self._service._build_forward_previews(
                session=session,
                forward_from_message_ids=[getattr(message, "forward_from_message_id", None)],
                users_by_id=users_by_id,
            ),
            attachments=attachments,
            action_cards_by_message_id=action_cards_by_message_id,
        )
