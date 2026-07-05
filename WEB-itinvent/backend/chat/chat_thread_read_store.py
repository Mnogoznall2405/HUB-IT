"""Read-side thread/message queries extracted from ChatService."""
from __future__ import annotations

from typing import TYPE_CHECKING, Any, Optional

from sqlalchemy import and_, func, or_, select

from backend.chat.chat_formatting import _iso
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
from backend.chat.utils import normalize_text as _normalize_text

if TYPE_CHECKING:
    from backend.chat.service import ChatService


class ChatThreadReadStore:
    def __init__(self, service: "ChatService") -> None:
        self._service = service


    def get_message(
        self,
        *,
        current_user_id: int,
        message_id: str,
    ) -> dict:
        normalized_message_id = _normalize_text(message_id)
        if not normalized_message_id:
            raise ValueError("message_id is required")

        with chat_session() as session:
            message = session.get(ChatMessage, normalized_message_id)
            if message is None:
                raise LookupError("Message not found")
            conversation = self._service._require_membership(
                session=session,
                conversation_id=message.conversation_id,
                current_user_id=int(current_user_id),
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
            states = list(
                session.execute(
                    select(ChatConversationUserState).where(
                        ChatConversationUserState.conversation_id == conversation.id,
                        ChatConversationUserState.user_id.in_(member_ids),
                    )
                ).scalars()
            ) if member_ids else []
            read_rows = list(
                session.execute(
                    select(ChatMessageRead).where(
                        ChatMessageRead.conversation_id == conversation.id,
                        ChatMessageRead.message_id == message.id,
                        ChatMessageRead.user_id.in_(member_ids),
                    )
                ).scalars()
            ) if member_ids else []
            attachments_by_message = self._service._list_attachments_by_message(
                session=session,
                message_ids=[message.id],
            )
            reads_by_message_id: dict[str, list[ChatMessageRead]] = {}
            for item in read_rows:
                reads_by_message_id.setdefault(item.message_id, []).append(item)
            participant_ids = {int(item) for item in member_ids if int(item) > 0}
            presence_map = self._service._get_presence_map(user_ids=participant_ids)
            users_by_id = self._service._get_users_map(presence_map=presence_map, user_ids=participant_ids)
            reply_previews = self._service._build_reply_previews(
                session=session,
                reply_to_message_ids=[getattr(message, "reply_to_message_id", None)],
                users_by_id=users_by_id,
            )
            forward_previews = self._service._build_forward_previews(
                session=session,
                forward_from_message_ids=[getattr(message, "forward_from_message_id", None)],
                users_by_id=users_by_id,
            )
            return self._service._serialize_message(
                conversation_kind=conversation.kind,
                message=message,
                current_user_id=int(current_user_id),
                users_by_id=users_by_id,
                member_ids=member_ids,
                states_by_user_id={int(item.user_id): item for item in states},
                reads_by_message_id=reads_by_message_id,
                reply_previews=reply_previews,
                forward_previews=forward_previews,
                attachments=attachments_by_message.get(message.id, []),
            )

    def get_messages_for_users(
        self,
        *,
        message_id: str,
        user_ids: list[int],
    ) -> dict[int, dict]:
        """Get the same message serialized for multiple users (batch optimization)."""
        normalized_message_id = _normalize_text(message_id)
        if not normalized_message_id:
            raise ValueError("message_id is required")
        if not user_ids:
            return {}

        results: dict[int, dict] = {}

        with chat_session() as session:
            message = session.get(ChatMessage, normalized_message_id)
            if message is None:
                raise LookupError("Message not found")

            # Get conversation and verify all users are members
            conversation = session.execute(
                select(ChatConversation).where(ChatConversation.id == message.conversation_id)
            ).scalar_one_or_none()
            if conversation is None:
                raise LookupError("Conversation not found")

            members = list(
                session.execute(
                    select(ChatMember).where(
                        ChatMember.conversation_id == conversation.id,
                        ChatMember.user_id.in_([int(uid) for uid in user_ids]),
                        ChatMember.left_at.is_(None),
                    )
                ).scalars()
            )
            valid_member_ids = sorted({
                int(item.user_id)
                for item in members
                if int(item.user_id) > 0
            })
            if not valid_member_ids:
                return {}

            attachments_by_message = self._service._list_attachments_by_message(
                session=session,
                message_ids=[message.id],
            )
            payload_user_ids = self._service._collect_message_payload_user_ids(
                session=session,
                message=message,
                current_user_id=int(getattr(message, "sender_user_id", 0) or 0),
            )
            presence_map = self._service._get_presence_map(user_ids=payload_user_ids)
            users_by_id = self._service._get_users_map(presence_map=presence_map, user_ids=payload_user_ids)

            reply_previews = self._service._build_reply_previews(
                session=session,
                reply_to_message_ids=[getattr(message, "reply_to_message_id", None)],
                users_by_id=users_by_id,
            )
            forward_previews = self._service._build_forward_previews(
                session=session,
                forward_from_message_ids=[getattr(message, "forward_from_message_id", None)],
                users_by_id=users_by_id,
            )
            attachments = attachments_by_message.get(message.id, [])

            sender_user_id = int(getattr(message, "sender_user_id", 0) or 0)
            has_sender_view = sender_user_id in valid_member_ids
            recipient_view_user_ids = [
                int(user_id)
                for user_id in valid_member_ids
                if int(user_id) != sender_user_id
            ]

            if has_sender_view:
                states = list(
                    session.execute(
                        select(ChatConversationUserState).where(
                            ChatConversationUserState.conversation_id == conversation.id,
                            ChatConversationUserState.user_id.in_(valid_member_ids),
                        )
                    ).scalars()
                )
                read_rows = list(
                    session.execute(
                        select(ChatMessageRead).where(
                            ChatMessageRead.conversation_id == conversation.id,
                            ChatMessageRead.message_id == message.id,
                            ChatMessageRead.user_id.in_(valid_member_ids),
                        )
                    ).scalars()
                )
                reads_by_message_id: dict[str, list[ChatMessageRead]] = {}
                for item in read_rows:
                    reads_by_message_id.setdefault(item.message_id, []).append(item)
                sender_payload = self._service._serialize_message(
                    conversation_kind=conversation.kind,
                    message=message,
                    current_user_id=sender_user_id,
                    users_by_id=users_by_id,
                    member_ids=valid_member_ids,
                    states_by_user_id={int(item.user_id): item for item in states},
                    reads_by_message_id=reads_by_message_id,
                    reply_previews=reply_previews,
                    forward_previews=forward_previews,
                    attachments=attachments,
                )
                results[sender_user_id] = sender_payload

            if recipient_view_user_ids:
                recipient_payload = self._service._serialize_message(
                    conversation_kind=conversation.kind,
                    message=message,
                    current_user_id=int(recipient_view_user_ids[0]),
                    users_by_id=users_by_id,
                    member_ids=valid_member_ids,
                    states_by_user_id={},
                    reads_by_message_id={},
                    reply_previews=reply_previews,
                    forward_previews=forward_previews,
                    attachments=attachments,
                )
                for user_id in recipient_view_user_ids:
                    results[int(user_id)] = recipient_payload

        return results

    def get_messages(
        self,
        *,
        current_user_id: int,
        conversation_id: str,
        before_message_id: Optional[str] = None,
        after_message_id: Optional[str] = None,
        limit: int = 100,
    ) -> dict:
        normalized_conversation_id = _normalize_text(conversation_id)
        normalized_before = _normalize_text(before_message_id)
        normalized_after = _normalize_text(after_message_id)
        if normalized_before and normalized_after:
            raise ValueError("before_message_id and after_message_id cannot be used together")
        page_size = max(1, min(int(limit), 200))
        latest_cache_extra = f"{normalized_conversation_id}|{page_size}"

        if normalized_conversation_id and not normalized_before and not normalized_after:
            cached = self._service._cache_get(
                user_id=int(current_user_id),
                bucket="thread_latest",
                extra=latest_cache_extra,
            )
            if cached is not None:
                self._service._set_request_meta(
                    route="messages",
                    cache_hit=True,
                    conversation_id=normalized_conversation_id,
                    limit=page_size,
                    direction="latest",
                    before_message_id=None,
                    after_message_id=None,
                    cursor_invalid=bool((cached or {}).get("cursor_invalid")),
                    items_count=len(list((cached or {}).get("items") or [])),
                )
                return cached

        with chat_session() as session:
            conversation = self._service._require_membership(
                session=session,
                conversation_id=normalized_conversation_id,
                current_user_id=int(current_user_id),
            )
            anchor = None
            direction = "latest"
            query = None
            if normalized_before:
                direction = "before"
                anchor = session.get(ChatMessage, normalized_before)
                if anchor is None or anchor.conversation_id != conversation.id:
                    payload = self._service._serialize_thread_messages_payload(
                        session=session,
                        conversation=conversation,
                        current_user_id=int(current_user_id),
                        messages=[],
                        has_older=False,
                        has_newer=False,
                    )
                    payload["cursor_invalid"] = True
                    self._service._set_request_meta(
                        route="messages",
                        cache_hit=False,
                        conversation_id=conversation.id,
                        limit=page_size,
                        direction=direction,
                        before_message_id=normalized_before or None,
                        after_message_id=None,
                        cursor_invalid=True,
                        items_count=0,
                    )
                    return payload
                query = (
                    select(ChatMessage)
                    .where(ChatMessage.conversation_id == conversation.id)
                    .order_by(*self._service._message_order_desc())
                    .limit(page_size + 1)
                )
                query = query.where(self._service._message_before_anchor_condition(anchor=anchor))
            elif normalized_after:
                direction = "after"
                anchor = session.get(ChatMessage, normalized_after)
                if anchor is None or anchor.conversation_id != conversation.id:
                    payload = self._service._serialize_thread_messages_payload(
                        session=session,
                        conversation=conversation,
                        current_user_id=int(current_user_id),
                        messages=[],
                        has_older=False,
                        has_newer=False,
                    )
                    payload["cursor_invalid"] = True
                    self._service._set_request_meta(
                        route="messages",
                        cache_hit=False,
                        conversation_id=conversation.id,
                        limit=page_size,
                        direction=direction,
                        before_message_id=None,
                        after_message_id=normalized_after or None,
                        cursor_invalid=True,
                        items_count=0,
                    )
                    return payload
                query = (
                    select(ChatMessage)
                    .where(ChatMessage.conversation_id == conversation.id)
                    .order_by(*self._service._message_order_asc())
                    .limit(page_size + 1)
                )
                query = query.where(self._service._message_after_anchor_condition(anchor=anchor))
            else:
                query = (
                    select(ChatMessage)
                    .where(ChatMessage.conversation_id == conversation.id)
                    .order_by(*self._service._message_order_desc())
                    .limit(page_size + 1)
                )

            raw_messages = list(session.execute(query).scalars())
            if direction == "after":
                messages = raw_messages[:page_size]
            else:
                messages = list(reversed(raw_messages[:page_size]))

            has_older = False
            has_newer = False
            if direction == "latest":
                has_older = len(raw_messages) > page_size
            elif direction == "before":
                has_older = len(raw_messages) > page_size
                has_newer = bool(anchor) or self._service._has_message_after(
                    session=session,
                    conversation_id=conversation.id,
                    anchor=messages[-1] if messages else None,
                )
            else:
                has_newer = len(raw_messages) > page_size
                has_older = bool(anchor) or self._service._has_message_before(
                    session=session,
                    conversation_id=conversation.id,
                    anchor=messages[0] if messages else None,
                )

            if messages:
                if not has_older:
                    has_older = self._service._has_message_before(
                        session=session,
                        conversation_id=conversation.id,
                        anchor=messages[0],
                    )
                if not has_newer:
                    has_newer = self._service._has_message_after(
                        session=session,
                        conversation_id=conversation.id,
                        anchor=messages[-1],
                    )

            payload = self._service._serialize_thread_messages_payload(
                session=session,
                conversation=conversation,
                current_user_id=int(current_user_id),
                messages=messages,
                has_older=has_older,
                has_newer=has_newer,
            )
            if direction == "latest":
                self._service._cache_set(
                    user_id=int(current_user_id),
                    bucket="thread_latest",
                    extra=latest_cache_extra,
                    value=payload,
                )
            self._service._set_request_meta(
                route="messages",
                cache_hit=False,
                conversation_id=conversation.id,
                limit=page_size,
                direction=direction,
                before_message_id=normalized_before or None,
                after_message_id=normalized_after or None,
                cursor_invalid=bool(payload.get("cursor_invalid")),
                items_count=len(payload["items"]),
            )
            return payload

    def get_thread_bootstrap(
        self,
        *,
        current_user_id: int,
        conversation_id: str,
        focus_message_id: Optional[str] = None,
        limit: int = 40,
        lightweight: bool = True,
    ) -> dict[str, Any]:
        normalized_conversation_id = _normalize_text(conversation_id)
        normalized_focus_message_id = _normalize_text(focus_message_id)
        page_size = max(1, min(int(limit), 100))
        lightweight_flag = "1" if bool(lightweight) else "0"
        bootstrap_cache_extra = (
            f"{normalized_conversation_id}|{page_size}|lw:{lightweight_flag}|focus:{normalized_focus_message_id}"
            if normalized_focus_message_id
            else f"{normalized_conversation_id}|{page_size}|lw:{lightweight_flag}"
        )
        cached = self._service._cache_get(
            user_id=int(current_user_id),
            bucket="thread_bootstrap",
            extra=bootstrap_cache_extra,
        )
        if cached is not None:
            self._service._set_request_meta(
                route="thread_bootstrap",
                cache_hit=True,
                conversation_id=normalized_conversation_id,
                limit=page_size,
                items_count=len(list((cached or {}).get("items") or [])),
                initial_anchor_mode=_normalize_text((cached or {}).get("initial_anchor_mode")) or "bottom",
            )
            return cached

        with chat_session() as session:
            conversation = self._service._require_membership(
                session=session,
                conversation_id=normalized_conversation_id,
                current_user_id=int(current_user_id),
            )
            initial_anchor_mode = "bottom"
            initial_anchor_message_id = None
            messages: list[ChatMessage] = []
            has_older = False
            has_newer = False

            focus_anchor = (
                session.get(ChatMessage, normalized_focus_message_id)
                if normalized_focus_message_id
                else None
            )
            if focus_anchor is not None and focus_anchor.conversation_id == conversation.id:
                initial_anchor_mode = "message"
                initial_anchor_message_id = focus_anchor.id
                older_limit = min(max(0, page_size - 1), max(0, (page_size - 1) // 2))
                newer_limit = max(1, page_size - older_limit)
                older_raw = list(
                    session.execute(
                        select(ChatMessage)
                        .where(
                            ChatMessage.conversation_id == conversation.id,
                            self._service._message_before_anchor_condition(anchor=focus_anchor),
                        )
                        .order_by(*self._service._message_order_desc())
                        .limit(older_limit + 1)
                    ).scalars()
                )
                newer_raw = list(
                    session.execute(
                        select(ChatMessage)
                        .where(
                            ChatMessage.conversation_id == conversation.id,
                            or_(
                                ChatMessage.id == focus_anchor.id,
                                self._service._message_after_anchor_condition(anchor=focus_anchor),
                            ),
                        )
                        .order_by(*self._service._message_order_asc())
                        .limit(newer_limit + 1)
                    ).scalars()
                )
                older_messages = list(reversed(older_raw[:older_limit]))
                newer_messages = newer_raw[:newer_limit]
                messages = [*older_messages, *newer_messages]
                has_older = bool(len(older_raw) > older_limit or (
                    messages and self._service._has_message_before(
                        session=session,
                        conversation_id=conversation.id,
                        anchor=messages[0],
                    )
                ))
                has_newer = bool(len(newer_raw) > newer_limit or (
                    messages and self._service._has_message_after(
                        session=session,
                        conversation_id=conversation.id,
                        anchor=messages[-1],
                    )
                ))
            else:
                latest_raw = list(
                    session.execute(
                        select(ChatMessage)
                        .where(ChatMessage.conversation_id == conversation.id)
                        .order_by(*self._service._message_order_desc())
                        .limit(page_size + 1)
                    ).scalars()
                )
                messages = list(reversed(latest_raw[:page_size]))
                has_older = len(latest_raw) > page_size
                has_newer = False

            payload = self._service._serialize_thread_messages_payload(
                session=session,
                conversation=conversation,
                current_user_id=int(current_user_id),
                messages=messages,
                has_older=has_older,
                has_newer=has_newer,
                lightweight=bool(lightweight),
            )
            payload["initial_anchor_mode"] = initial_anchor_mode
            payload["initial_anchor_message_id"] = initial_anchor_message_id
            self._service._cache_set(
                user_id=int(current_user_id),
                bucket="thread_bootstrap",
                extra=bootstrap_cache_extra,
                value=payload,
            )
            self._service._set_request_meta(
                route="thread_bootstrap",
                cache_hit=False,
                conversation_id=conversation.id,
                limit=page_size,
                items_count=len(payload["items"]),
                initial_anchor_mode=initial_anchor_mode,
            )
            return payload

    def hydrate_thread_messages(
        self,
        *,
        current_user_id: int,
        conversation_id: str,
        message_ids: list[str],
    ) -> dict[str, Any]:
        normalized_conversation_id = _normalize_text(conversation_id)
        normalized_ids = [
            _normalize_text(item)
            for item in list(message_ids or [])
            if _normalize_text(item)
        ]
        normalized_ids = list(dict.fromkeys(normalized_ids))[:50]
        if not normalized_conversation_id or not normalized_ids:
            return {"items": []}

        with chat_session() as session:
            conversation = self._service._require_membership(
                session=session,
                conversation_id=normalized_conversation_id,
                current_user_id=int(current_user_id),
            )
            messages = list(
                session.execute(
                    select(ChatMessage).where(
                        ChatMessage.conversation_id == conversation.id,
                        ChatMessage.id.in_(normalized_ids),
                    )
                ).scalars()
            )
            if not messages:
                self._service._set_request_meta(
                    route="thread_hydrate",
                    cache_hit=False,
                    conversation_id=conversation.id,
                    items_count=0,
                )
                return {"items": []}

            members = list(
                session.execute(
                    select(ChatMember).where(
                        ChatMember.conversation_id == conversation.id,
                        ChatMember.left_at.is_(None),
                    )
                ).scalars()
            )
            member_ids = [int(item.user_id) for item in members if int(item.user_id) > 0]
            states = list(
                session.execute(
                    select(ChatConversationUserState).where(
                        ChatConversationUserState.conversation_id == conversation.id,
                        ChatConversationUserState.user_id.in_(member_ids),
                    )
                ).scalars()
            ) if member_ids else []
            states_by_user_id = {int(item.user_id): item for item in states}
            read_rows = list(
                session.execute(
                    select(ChatMessageRead).where(
                        ChatMessageRead.conversation_id == conversation.id,
                        ChatMessageRead.message_id.in_([item.id for item in messages]),
                        ChatMessageRead.user_id.in_(member_ids),
                    )
                ).scalars()
            ) if member_ids else []
            reads_by_message_id: dict[str, list[ChatMessageRead]] = {}
            for item in read_rows:
                reads_by_message_id.setdefault(item.message_id, []).append(item)

            reaction_rows = list(
                session.execute(
                    select(ChatMessageReaction).where(
                        ChatMessageReaction.message_id.in_([item.id for item in messages])
                    )
                ).scalars()
            )
            raw_reactions: dict[str, dict[str, list[int]]] = {}
            for row in reaction_rows:
                raw_reactions.setdefault(row.message_id, {}).setdefault(row.emoji, []).append(int(row.user_id))
            reactions_by_message_id: dict[str, list[dict]] = {}
            for mid, emoji_map in raw_reactions.items():
                reactions_by_message_id[mid] = [
                    {"emoji": emoji, "user_ids": user_ids, "count": len(user_ids)}
                    for emoji, user_ids in emoji_map.items()
                ]

            items: list[dict[str, Any]] = []
            for message in messages:
                reader_user_ids = [
                    int(user_id)
                    for user_id in member_ids
                    if int(user_id) > 0 and int(user_id) != int(message.sender_user_id)
                ]
                read_receipts = self._service._build_message_read_receipts(
                    message=message,
                    reader_user_ids=reader_user_ids,
                    states_by_user_id=states_by_user_id,
                    reads_by_user_id={
                        int(item.user_id): item
                        for item in reads_by_message_id.get(message.id, [])
                        if int(item.user_id) != int(message.sender_user_id)
                    },
                )
                read_by_count = len(read_receipts)
                is_own = int(message.sender_user_id) == int(current_user_id)
                items.append(
                    {
                        "message_id": message.id,
                        "read_by_count": read_by_count if is_own else 0,
                        "delivery_status": (
                            ("read" if read_by_count > 0 else "sent") if is_own else None
                        ),
                        "reactions": list(reactions_by_message_id.get(message.id, [])),
                    }
                )

            self._service._set_request_meta(
                route="thread_hydrate",
                cache_hit=False,
                conversation_id=conversation.id,
                items_count=len(items),
            )
            return {"items": items}

    def search_messages(
        self,
        *,
        current_user_id: int,
        conversation_id: str,
        q: str,
        limit: int = 20,
        before_message_id: Optional[str] = None,
    ) -> dict:
        normalized_conversation_id = _normalize_text(conversation_id)
        normalized_query = _normalize_text(q).lower()
        normalized_before = _normalize_text(before_message_id)
        page_size = max(1, min(int(limit), 100))
        if not normalized_query:
            return {"items": [], "has_more": False}

        with chat_session() as session:
            conversation = self._service._require_membership(
                session=session,
                conversation_id=normalized_conversation_id,
                current_user_id=int(current_user_id),
            )
            anchor_message = None
            if normalized_before:
                anchor = session.get(ChatMessage, normalized_before)
                if anchor and anchor.conversation_id == conversation.id:
                    anchor_message = anchor

            members = list(
                session.execute(
                    select(ChatMember).where(
                        ChatMember.conversation_id == conversation.id,
                        ChatMember.left_at.is_(None),
                    )
                ).scalars()
            )
            member_ids = [int(item.user_id) for item in members if int(item.user_id) > 0]
            participant_ids = {int(item) for item in member_ids if int(item) > 0}
            presence_map = self._service._get_presence_map(user_ids=participant_ids)
            users_by_id = self._service._get_users_map(presence_map=presence_map, user_ids=participant_ids)
            states = list(
                session.execute(
                    select(ChatConversationUserState).where(
                        ChatConversationUserState.conversation_id == conversation.id,
                        ChatConversationUserState.user_id.in_(member_ids),
                    )
                ).scalars()
            ) if member_ids else []
            states_by_user_id = {int(item.user_id): item for item in states}

            search_query = (
                select(ChatMessage)
                .outerjoin(
                    ChatMessageAttachment,
                    ChatMessageAttachment.message_id == ChatMessage.id,
                )
                .where(
                    ChatMessage.conversation_id == conversation.id,
                    or_(
                        func.lower(ChatMessage.body).contains(normalized_query),
                        func.lower(ChatMessageAttachment.file_name).contains(normalized_query),
                    ),
                )
                .distinct()
                .order_by(*self._service._message_order_desc())
                .limit(page_size + 1)
            )
            if anchor_message is not None:
                search_query = search_query.where(
                    self._service._message_before_anchor_condition(anchor=anchor_message)
                )
            matched_messages = list(session.execute(search_query).scalars())
            has_more = len(matched_messages) > page_size
            matched_messages = matched_messages[:page_size]

            matched_message_ids = [item.id for item in matched_messages]
            all_attachments_by_message = self._service._list_attachments_by_message(
                session=session,
                message_ids=matched_message_ids,
            ) if matched_message_ids else {}

            all_reads_by_message_id: dict[str, list[ChatMessageRead]] = {}
            if matched_message_ids and member_ids:
                read_rows = list(
                    session.execute(
                        select(ChatMessageRead).where(
                            ChatMessageRead.conversation_id == conversation.id,
                            ChatMessageRead.message_id.in_(matched_message_ids),
                            ChatMessageRead.user_id.in_(member_ids),
                        )
                    ).scalars()
                )
                for item in read_rows:
                    all_reads_by_message_id.setdefault(item.message_id, []).append(item)

            all_reply_previews = self._service._build_reply_previews(
                session=session,
                reply_to_message_ids=[
                    _normalize_text(getattr(item, "reply_to_message_id", None))
                    for item in matched_messages
                ],
                users_by_id=users_by_id,
            )
            all_forward_previews = self._service._build_forward_previews(
                session=session,
                forward_from_message_ids=[
                    _normalize_text(getattr(item, "forward_from_message_id", None))
                    for item in matched_messages
                ],
                users_by_id=users_by_id,
            )
            action_cards_by_message_id = self._service._batch_action_cards_for_messages(
                session=session,
                message_ids=matched_message_ids,
            )
            payload = {
                "items": [
                    self._service._serialize_message(
                        conversation_kind=conversation.kind,
                        message=item,
                        current_user_id=int(current_user_id),
                        users_by_id=users_by_id,
                        member_ids=member_ids,
                        states_by_user_id=states_by_user_id,
                        reads_by_message_id=all_reads_by_message_id,
                        reply_previews=all_reply_previews,
                        forward_previews=all_forward_previews,
                        attachments=all_attachments_by_message.get(item.id, []),
                        action_cards_by_message_id=action_cards_by_message_id,
                    )
                    for item in matched_messages
                ],
                "has_more": has_more,
            }
            self._service._set_request_meta(
                route="search",
                cache_hit=False,
                conversation_id=conversation.id,
                limit=page_size,
                before_message_id=normalized_before or None,
                items_count=len(payload["items"]),
                query=normalized_query or None,
            )
            return payload

    def get_message_reads(self, *, current_user_id: int, message_id: str) -> dict:
        normalized_message_id = _normalize_text(message_id)
        if not normalized_message_id:
            raise ValueError("message_id is required")

        with chat_session() as session:
            message = session.get(ChatMessage, normalized_message_id)
            if message is None:
                raise LookupError("Message not found")

            conversation = self._service._require_membership(
                session=session,
                conversation_id=message.conversation_id,
                current_user_id=int(current_user_id),
            )
            if int(message.sender_user_id) != int(current_user_id):
                raise PermissionError("Read receipts are available only for your own messages")

            members = list(
                session.execute(
                    select(ChatMember).where(
                        ChatMember.conversation_id == conversation.id,
                        ChatMember.left_at.is_(None),
                    )
                ).scalars()
            )
            member_ids = [
                int(item.user_id)
                for item in members
                if int(item.user_id) > 0 and int(item.user_id) != int(current_user_id)
            ]
            states = list(
                session.execute(
                    select(ChatConversationUserState).where(
                        ChatConversationUserState.conversation_id == conversation.id,
                        ChatConversationUserState.user_id.in_(member_ids),
                    )
                ).scalars()
            ) if member_ids else []
            read_rows = list(
                session.execute(
                    select(ChatMessageRead).where(
                        ChatMessageRead.conversation_id == conversation.id,
                        ChatMessageRead.message_id == message.id,
                        ChatMessageRead.user_id.in_(member_ids),
                    )
                ).scalars()
            ) if member_ids else []

            states_by_user_id = {int(item.user_id): item for item in states}
            reads_by_user_id = {int(item.user_id): item for item in read_rows}
            presence_map = self._service._get_presence_map(user_ids=member_ids)
            users_by_id = self._service._get_users_map(presence_map=presence_map, user_ids=member_ids)

            receipts = self._service._build_message_read_receipts(
                message=message,
                reader_user_ids=member_ids,
                states_by_user_id=states_by_user_id,
                reads_by_user_id=reads_by_user_id,
            )
            items = []
            for receipt in receipts:
                user_payload = users_by_id.get(int(receipt["user_id"]))
                if user_payload is None:
                    continue
                items.append(
                    {
                        "user": user_payload,
                        "read_at": _iso(receipt["read_at"]) or "",
                    }
                )
            items.sort(key=lambda item: item.get("read_at") or "", reverse=True)
            return {"items": items}

    def get_message_read_delta(self, *, conversation_id: str, message_id: str) -> dict:
        normalized_conversation_id = _normalize_text(conversation_id)
        normalized_message_id = _normalize_text(message_id)
        if not normalized_conversation_id:
            raise ValueError("conversation_id is required")
        if not normalized_message_id:
            raise ValueError("message_id is required")

        with chat_session() as session:
            conversation = session.get(ChatConversation, normalized_conversation_id)
            if conversation is None:
                raise LookupError("Conversation not found")
            message = session.get(ChatMessage, normalized_message_id)
            if message is None or message.conversation_id != conversation.id:
                raise LookupError("Message not found")
            member_user_ids = self._service._conversation_member_ids(session, conversation.id)
            states = list(
                session.execute(
                    select(ChatConversationUserState).where(
                        ChatConversationUserState.conversation_id == conversation.id,
                        ChatConversationUserState.user_id.in_(member_user_ids),
                    )
                ).scalars()
            ) if member_user_ids else []
            read_rows = list(
                session.execute(
                    select(ChatMessageRead).where(
                        ChatMessageRead.conversation_id == conversation.id,
                        ChatMessageRead.message_id == message.id,
                        ChatMessageRead.user_id.in_(member_user_ids),
                    )
                ).scalars()
            ) if member_user_ids else []
            read_receipts = self._service._build_message_read_receipts(
                message=message,
                reader_user_ids=[
                    int(user_id)
                    for user_id in member_user_ids
                    if int(user_id) > 0 and int(user_id) != int(message.sender_user_id)
                ],
                states_by_user_id={int(item.user_id): item for item in states},
                reads_by_user_id={
                    int(item.user_id): item
                    for item in read_rows
                    if int(item.user_id) != int(message.sender_user_id)
                },
            )
        read_by_count = len(read_receipts)
        return {
            "conversation_id": message.conversation_id,
            "message_id": message.id,
            "read_by_count": read_by_count,
            "delivery_status": "read" if read_by_count > 0 else "sent",
        }

    def _serialize_thread_messages_payload(
        self,
        *,
        session,
        conversation: ChatConversation,
        current_user_id: int,
        messages: list[ChatMessage],
        has_older: bool,
        has_newer: bool,
        lightweight: bool = False,
    ) -> dict[str, Any]:
        if lightweight:
            svc = self._service
            viewer_state = session.execute(
                select(ChatConversationUserState).where(
                    ChatConversationUserState.conversation_id == conversation.id,
                    ChatConversationUserState.user_id == int(current_user_id),
                )
            ).scalar_one_or_none()
            message_ids = [item.id for item in messages]
            action_cards_by_message_id = svc._batch_action_cards_for_messages(
                session=session,
                message_ids=message_ids,
            )
            attachments_by_message = svc._list_attachments_by_message(
                session=session,
                message_ids=message_ids,
            ) if message_ids else {}
            users_by_id = svc._get_users_map(
                presence_map=svc._get_presence_map(user_ids={int(item.sender_user_id) for item in messages}),
                user_ids={int(item.sender_user_id) for item in messages},
            )
            reply_previews = svc._build_reply_previews(
                session=session,
                reply_to_message_ids=[
                    _normalize_text(getattr(item, "reply_to_message_id", None))
                    for item in messages
                ],
                users_by_id=users_by_id,
            )
            forward_previews = svc._build_forward_previews(
                session=session,
                forward_from_message_ids=[
                    _normalize_text(getattr(item, "forward_from_message_id", None))
                    for item in messages
                ],
                users_by_id=users_by_id,
            )
            return {
                "items": [
                    svc._serialize_message(
                        conversation_kind=conversation.kind,
                        message=item,
                        current_user_id=int(current_user_id),
                        users_by_id=users_by_id,
                        member_ids=[],
                        states_by_user_id={},
                        reads_by_message_id={},
                        reply_previews=reply_previews,
                        forward_previews=forward_previews,
                        attachments=attachments_by_message.get(item.id, []),
                        action_cards_by_message_id=action_cards_by_message_id,
                    )
                    for item in messages
                ],
                "has_more": bool(has_older),
                "has_older": bool(has_older),
                "has_newer": bool(has_newer),
                "cursor_invalid": False,
                "older_cursor_message_id": messages[0].id if messages and has_older else None,
                "newer_cursor_message_id": messages[-1].id if messages and has_newer else None,
                "viewer_last_read_message_id": _normalize_text(getattr(viewer_state, "last_read_message_id", None)) or None,
                "viewer_last_read_at": _iso(getattr(viewer_state, "last_read_at", None)),
            }

        members = list(
            session.execute(
                select(ChatMember).where(
                    ChatMember.conversation_id == conversation.id,
                    ChatMember.left_at.is_(None),
                )
            ).scalars()
        )
        member_ids = [int(item.user_id) for item in members if int(item.user_id) > 0]
        states = list(
            session.execute(
                select(ChatConversationUserState).where(
                    ChatConversationUserState.conversation_id == conversation.id,
                    ChatConversationUserState.user_id.in_(member_ids),
                )
            ).scalars()
        ) if member_ids else []
        attachments_by_message = self._service._list_attachments_by_message(
            session=session,
            message_ids=[item.id for item in messages],
        )
        read_rows = list(
            session.execute(
                select(ChatMessageRead).where(
                    ChatMessageRead.conversation_id == conversation.id,
                    ChatMessageRead.message_id.in_([item.id for item in messages]),
                    ChatMessageRead.user_id.in_(member_ids),
                )
            ).scalars()
        ) if messages and member_ids else []
        states_by_user_id = {int(item.user_id): item for item in states}
        viewer_state = states_by_user_id.get(int(current_user_id))
        reads_by_message_id: dict[str, list[ChatMessageRead]] = {}
        for item in read_rows:
            reads_by_message_id.setdefault(item.message_id, []).append(item)
        participant_ids = {int(item) for item in member_ids if int(item) > 0}
        presence_map = self._service._get_presence_map(user_ids=participant_ids)
        users_by_id = self._service._get_users_map(presence_map=presence_map, user_ids=participant_ids)
        reply_previews = self._service._build_reply_previews(
            session=session,
            reply_to_message_ids=[
                _normalize_text(getattr(item, "reply_to_message_id", None))
                for item in messages
            ],
            users_by_id=users_by_id,
        )
        forward_previews = self._service._build_forward_previews(
            session=session,
            forward_from_message_ids=[
                _normalize_text(getattr(item, "forward_from_message_id", None))
                for item in messages
            ],
            users_by_id=users_by_id,
        )

        message_ids = [item.id for item in messages]
        reactions_by_message_id: dict[str, list[dict]] = {}
        if message_ids:
            reaction_rows = list(
                session.execute(
                    select(ChatMessageReaction).where(
                        ChatMessageReaction.message_id.in_(message_ids)
                    )
                ).scalars()
            )
            raw_map: dict[str, dict[str, list[int]]] = {}
            for rr in reaction_rows:
                raw_map.setdefault(rr.message_id, {}).setdefault(rr.emoji, []).append(rr.user_id)
            for mid, emoji_map in raw_map.items():
                reactions_by_message_id[mid] = [
                    {"emoji": e, "user_ids": uids, "count": len(uids)}
                    for e, uids in emoji_map.items()
                ]
        action_cards_by_message_id = self._service._batch_action_cards_for_messages(
            session=session,
            message_ids=message_ids,
        )
        return {
            "items": [
                self._service._serialize_message(
                    conversation_kind=conversation.kind,
                    message=item,
                    current_user_id=int(current_user_id),
                    users_by_id=users_by_id,
                    member_ids=member_ids,
                    states_by_user_id=states_by_user_id,
                    reads_by_message_id=reads_by_message_id,
                    reply_previews=reply_previews,
                    forward_previews=forward_previews,
                    attachments=attachments_by_message.get(item.id, []),
                    reactions_by_message_id=reactions_by_message_id,
                    action_cards_by_message_id=action_cards_by_message_id,
                )
                for item in messages
            ],
            "has_more": bool(has_older),
            "has_older": bool(has_older),
            "has_newer": bool(has_newer),
            "cursor_invalid": False,
            "older_cursor_message_id": messages[0].id if messages and has_older else None,
            "newer_cursor_message_id": messages[-1].id if messages and has_newer else None,
            "viewer_last_read_message_id": _normalize_text(getattr(viewer_state, "last_read_message_id", None)) or None,
            "viewer_last_read_at": _iso(getattr(viewer_state, "last_read_at", None)),
        }
