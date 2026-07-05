"""Read-side conversation list/summary queries extracted from ChatService."""
from __future__ import annotations

import base64
import json
from datetime import datetime
from typing import TYPE_CHECKING, Any, Optional

from sqlalchemy import and_, case, exists, func, or_, select
from sqlalchemy.orm import aliased

from backend.chat.chat_formatting import _iso
from backend.chat.db import chat_session
from backend.chat.models import (
    ChatConversation,
    ChatConversationUserState,
    ChatMember,
    ChatMessage,
    ChatMessageAttachment,
    ChatMessageRead,
)
from backend.chat.utils import normalize_text as _normalize_text

if TYPE_CHECKING:
    from backend.chat.service import ChatService


def _parse_iso_datetime(value: str) -> datetime | None:
    raw = _normalize_text(value)
    if not raw:
        return None
    try:
        return datetime.fromisoformat(raw.replace("Z", "+00:00"))
    except ValueError:
        return None


def _encode_conversation_list_cursor(
    *,
    pinned_rank: int,
    is_archived: bool,
    last_message_at,
    conversation_id: str,
) -> str:
    payload = {
        "p": int(pinned_rank),
        "a": bool(is_archived),
        "t": _iso(last_message_at) or "",
        "id": _normalize_text(conversation_id),
    }
    encoded = base64.urlsafe_b64encode(
        json.dumps(payload, separators=(",", ":"), ensure_ascii=False).encode("utf-8")
    ).decode("ascii")
    return encoded.rstrip("=")


def _decode_conversation_list_cursor(cursor: str) -> dict[str, Any] | None:
    raw = _normalize_text(cursor)
    if not raw:
        return None
    padding = "=" * (-len(raw) % 4)
    try:
        decoded = base64.urlsafe_b64decode(f"{raw}{padding}".encode("ascii")).decode("utf-8")
        payload = json.loads(decoded)
    except (ValueError, json.JSONDecodeError, UnicodeError):
        return None
    if not isinstance(payload, dict):
        return None
    return payload


class ChatConversationReadStore:
    def __init__(self, service: ChatService) -> None:
        self._service = service

    def list_conversations(
        self,
        *,
        current_user_id: int,
        q: str = "",
        limit: int = 50,
        cursor: str = "",
    ) -> dict[str, Any]:
        search = _normalize_text(q).lower()
        page_size = max(1, min(int(limit), 200))
        normalized_cursor = _normalize_text(cursor)
        use_cache = not search and not normalized_cursor
        cache_extra = str(page_size)
        if use_cache:
            cached = self._service._cache_get(
                user_id=int(current_user_id),
                bucket="conversations",
                extra=cache_extra,
            )
            if cached is not None:
                cached_items = list((cached or {}).get("items") or [])
                self._service._set_request_meta(
                    route="conversations",
                    cache_hit=True,
                    limit=page_size,
                    query=None,
                    items_count=len(cached_items),
                )
                return cached
        with chat_session() as session:
            my_member = aliased(ChatMember)
            conv_state = aliased(ChatConversationUserState)
            last_message = aliased(ChatMessage)
            pinned_rank_expr = case((conv_state.is_pinned.is_(True), 0), else_=1)
            conversation_query = (
                select(ChatConversation, conv_state)
                .join(my_member, and_(
                    my_member.conversation_id == ChatConversation.id,
                    my_member.user_id == int(current_user_id),
                    my_member.left_at.is_(None),
                ))
                .outerjoin(conv_state, and_(
                    conv_state.conversation_id == ChatConversation.id,
                    conv_state.user_id == int(current_user_id),
                ))
                .where(ChatConversation.is_archived.is_(False))
                .order_by(
                    pinned_rank_expr,
                    ChatConversation.is_archived.asc(),
                    ChatConversation.last_message_at.desc().nullslast(),
                    ChatConversation.id.desc(),
                )
            )
            if search:
                peer_member = aliased(ChatMember)
                matching_peer_ids = [
                    int(item.get("id", 0) or 0)
                    for item in self._service.list_available_users(
                        current_user_id=int(current_user_id),
                        q=search,
                        limit=200,
                    )
                ]
                matching_peer_ids = [item for item in matching_peer_ids if item > 0]
                conversation_query = conversation_query.outerjoin(
                    last_message,
                    last_message.id == ChatConversation.last_message_id,
                )
                search_filters = [
                    func.lower(ChatConversation.title).contains(search),
                    func.lower(last_message.body).contains(search),
                ]
                if matching_peer_ids:
                    search_filters.append(
                        and_(
                            ChatConversation.kind == "direct",
                            exists(
                                select(1).where(
                                    peer_member.conversation_id == ChatConversation.id,
                                    peer_member.user_id.in_(matching_peer_ids),
                                    peer_member.user_id != int(current_user_id),
                                    peer_member.left_at.is_(None),
                                )
                            ),
                        )
                    )
                conversation_query = conversation_query.where(or_(*search_filters))
            decoded_cursor = _decode_conversation_list_cursor(normalized_cursor) if normalized_cursor else None
            if decoded_cursor is not None:
                cursor_pinned = int(decoded_cursor.get("p", 1))
                cursor_archived = bool(decoded_cursor.get("a", False))
                cursor_ts = _parse_iso_datetime(str(decoded_cursor.get("t") or ""))
                cursor_id = _normalize_text(decoded_cursor.get("id"))
                archived_rank_expr = case((ChatConversation.is_archived.is_(True), 1), else_=0)
                cursor_archived_rank = 1 if cursor_archived else 0
                cursor_filters = [
                    pinned_rank_expr > cursor_pinned,
                    and_(
                        pinned_rank_expr == cursor_pinned,
                        archived_rank_expr > cursor_archived_rank,
                    ),
                ]
                if cursor_ts is not None:
                    cursor_filters.append(and_(
                        pinned_rank_expr == cursor_pinned,
                        archived_rank_expr == cursor_archived_rank,
                        ChatConversation.last_message_at < cursor_ts,
                    ))
                    if cursor_id:
                        cursor_filters.append(and_(
                            pinned_rank_expr == cursor_pinned,
                            archived_rank_expr == cursor_archived_rank,
                            ChatConversation.last_message_at == cursor_ts,
                            ChatConversation.id < cursor_id,
                        ))
                elif cursor_id:
                    cursor_filters.append(and_(
                        pinned_rank_expr == cursor_pinned,
                        archived_rank_expr == cursor_archived_rank,
                        ChatConversation.last_message_at.is_(None),
                        ChatConversation.id < cursor_id,
                    ))
                conversation_query = conversation_query.where(or_(*cursor_filters))

            fetch_limit = page_size + 1
            conversation_query = conversation_query.limit(fetch_limit)
            q1_rows = session.execute(conversation_query).all()

            if not q1_rows:
                empty_payload = {"items": [], "has_more": False, "next_cursor": None}
                if use_cache:
                    self._service._cache_set(
                        user_id=int(current_user_id),
                        bucket="conversations",
                        extra=cache_extra,
                        value=empty_payload,
                    )
                self._service._set_request_meta(
                    route="conversations",
                    cache_hit=False,
                    limit=page_size,
                    query=search or None,
                    items_count=0,
                )
                return empty_payload

            has_more = len(q1_rows) > page_size
            if has_more:
                q1_rows = q1_rows[:page_size]

            conversations = [row[0] for row in q1_rows]
            states_by_conversation = {row[0].id: row[1] for row in q1_rows if row[1] is not None}
            conversation_ids = [c.id for c in conversations]

            members = list(
                session.execute(
                    select(ChatMember).where(
                        ChatMember.conversation_id.in_(conversation_ids),
                        ChatMember.left_at.is_(None),
                    )
                ).scalars()
            )

            last_message_ids = [c.last_message_id for c in conversations if _normalize_text(c.last_message_id)]
            messages = []
            if last_message_ids:
                messages = list(session.execute(select(ChatMessage).where(ChatMessage.id.in_(last_message_ids))).scalars())
            attachments_by_last_message = self._service._list_attachments_by_message(
                session=session,
                message_ids=last_message_ids,
            ) if last_message_ids else {}

            reads_by_message_id: dict[str, list[ChatMessageRead]] = {}
            if last_message_ids:
                for read in session.execute(
                    select(ChatMessageRead).where(ChatMessageRead.message_id.in_(last_message_ids))
                ).scalars():
                    reads_by_message_id.setdefault(read.message_id, []).append(read)

            states_by_conversation_user: dict[str, dict[int, ChatConversationUserState]] = {}
            for state in session.execute(
                select(ChatConversationUserState).where(
                    ChatConversationUserState.conversation_id.in_(conversation_ids),
                )
            ).scalars():
                user_id = int(getattr(state, "user_id", 0) or 0)
                if user_id > 0:
                    states_by_conversation_user.setdefault(state.conversation_id, {})[user_id] = state

            unread_by_conversation = {
                conv_id: max(0, int(getattr(state, "unread_count", 0) or 0))
                for conv_id, state in states_by_conversation.items()
            }

            participant_ids = {
                int(member.user_id)
                for member in members
                if int(member.user_id) > 0
            }
            presence_map = self._service._get_presence_map(user_ids=participant_ids)
            users_by_id = self._service._get_users_map(presence_map=presence_map, user_ids=participant_ids)
            members_by_conversation: dict[str, list[ChatMember]] = {}
            for member in members:
                members_by_conversation.setdefault(member.conversation_id, []).append(member)
            messages_by_id = {item.id: item for item in messages}

            task_ids = sorted({
                _normalize_text(getattr(conversation, "task_id", None))
                for conversation in conversations
                if _normalize_text(getattr(conversation, "task_id", None))
            })
            task_exists_map: dict[str, bool] = {}
            task_payloads_by_id: dict[str, dict] = {}
            if task_ids:
                task_exists_map, task_payloads_by_id = self._service._batch_hub_task_metadata_for_user(
                    task_ids=task_ids,
                    user_id=int(current_user_id),
                )

            items = []
            for conversation in conversations:
                summary = self._service._serialize_conversation(
                    session=session,
                    conversation=conversation,
                    current_user_id=int(current_user_id),
                    users_by_id=users_by_id,
                    members=members_by_conversation.get(conversation.id, []),
                    state=states_by_conversation.get(conversation.id),
                    last_message=messages_by_id.get(conversation.last_message_id),
                    unread_count=unread_by_conversation.get(conversation.id, 0),
                    last_message_attachments=attachments_by_last_message.get(
                        _normalize_text(conversation.last_message_id),
                        [],
                    ),
                    task_exists_map=task_exists_map,
                    task_payloads_by_id=task_payloads_by_id,
                    reads_by_message_id=reads_by_message_id,
                    states_by_user_id=states_by_conversation_user.get(conversation.id, {}),
                )
                items.append(summary)

            next_cursor = None
            if has_more and conversations:
                last_conversation = conversations[-1]
                last_state = states_by_conversation.get(last_conversation.id)
                next_cursor = _encode_conversation_list_cursor(
                    pinned_rank=0 if last_state and last_state.is_pinned else 1,
                    is_archived=bool(last_conversation.is_archived),
                    last_message_at=last_conversation.last_message_at,
                    conversation_id=last_conversation.id,
                )

            result_payload = {
                "items": items,
                "has_more": bool(has_more),
                "next_cursor": next_cursor,
            }
            if use_cache:
                self._service._cache_set(
                    user_id=int(current_user_id),
                    bucket="conversations",
                    extra=cache_extra,
                    value=result_payload,
                )
            self._service._set_request_meta(
                route="conversations",
                cache_hit=False,
                limit=page_size,
                query=search or None,
                items_count=len(items),
            )
            return result_payload

    def get_conversation_summary(
        self,
        *,
        current_user_id: int,
        conversation_id: str,
    ) -> dict:
        normalized_conversation_id = _normalize_text(conversation_id)
        if not normalized_conversation_id:
            raise ValueError("conversation_id is required")
        with chat_session() as session:
            conversation = self._service._require_membership(
                session=session,
                conversation_id=normalized_conversation_id,
                current_user_id=int(current_user_id),
            )
            return self._service._build_conversation_summary_payload(
                session=session,
                conversation=conversation,
                current_user_id=int(current_user_id),
            )

    def get_unread_summary(self, *, current_user_id: int) -> dict:
        cached = self._service._cache_get(user_id=int(current_user_id), bucket="unread_summary")
        if cached is not None:
            return cached
        payload = self._service.get_unread_summaries(user_ids=[int(current_user_id)]).get(int(current_user_id))
        result = payload if isinstance(payload, dict) else {
            "messages_unread_total": 0,
            "conversations_unread": 0,
        }
        self._service._cache_set(user_id=int(current_user_id), bucket="unread_summary", value=result, ttl_sec=5)
        return result

    def get_unread_summaries(
        self,
        *,
        user_ids: list[int] | set[int] | tuple[int, ...],
    ) -> dict[int, dict]:
        normalized_user_ids = sorted({
            int(item)
            for item in list(user_ids or [])
            if int(item) > 0
        })
        if not normalized_user_ids:
            return {}

        result = {
            int(user_id): {
                "messages_unread_total": 0,
                "conversations_unread": 0,
            }
            for user_id in normalized_user_ids
        }
        with chat_session() as session:
            unread_rows = session.execute(
                select(
                    ChatConversationUserState.user_id,
                    func.coalesce(func.sum(ChatConversationUserState.unread_count), 0),
                    func.count(ChatConversationUserState.conversation_id),
                ).where(
                    ChatConversationUserState.user_id.in_(normalized_user_ids),
                    ChatConversationUserState.unread_count > 0,
                    ChatConversationUserState.is_archived.is_(False),
                ).group_by(ChatConversationUserState.user_id)
            ).all()
        for user_id, messages_unread_total, conversations_unread in unread_rows:
            normalized_user_id = int(user_id or 0)
            if normalized_user_id <= 0:
                continue
            result[normalized_user_id] = {
                "messages_unread_total": max(0, int(messages_unread_total or 0)),
                "conversations_unread": max(0, int(conversations_unread or 0)),
            }
        return result

    def get_conversation(
        self,
        *,
        current_user_id: int,
        conversation_id: str,
    ) -> dict:
        
        normalized_conversation_id = _normalize_text(conversation_id)
        if not normalized_conversation_id:
            raise ValueError("conversation_id is required")
        cached = self._service._cache_get(
            user_id=int(current_user_id),
            bucket="conversation_detail",
            extra=normalized_conversation_id,
        )
        if cached is not None:
            return cached
        with chat_session() as session:
            conversation = self._service._require_membership(
                session=session,
                conversation_id=normalized_conversation_id,
                current_user_id=int(current_user_id),
            )
            result = self._service._build_conversation_detail_payload(
                session=session,
                conversation=conversation,
                current_user_id=int(current_user_id),
            )
        self._service._cache_set(
            user_id=int(current_user_id),
            bucket="conversation_detail",
            extra=normalized_conversation_id,
            value=result,
        )
        return result


    def get_conversation_summaries_for_users(
        self,
        *,
        conversation_id: str,
        user_ids: list[int] | set[int] | tuple[int, ...],
    ) -> dict[int, dict]:
        
        normalized_conversation_id = _normalize_text(conversation_id)
        normalized_user_ids = sorted({
            int(item)
            for item in list(user_ids or [])
            if int(item) > 0
        })
        if not normalized_conversation_id or not normalized_user_ids:
            return {}

        with chat_session() as session:
            conversation = session.get(ChatConversation, normalized_conversation_id)
            if conversation is None:
                raise LookupError("Conversation not found")
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
                if int(item.user_id) > 0
            ]
            allowed_user_ids = [item for item in normalized_user_ids if item in member_ids]
            if not allowed_user_ids:
                return {}
            states = list(
                session.execute(
                    select(ChatConversationUserState).where(
                        ChatConversationUserState.conversation_id == conversation.id,
                        ChatConversationUserState.user_id.in_(allowed_user_ids),
                    )
                ).scalars()
            )
            states_by_user_id = {int(item.user_id): item for item in states}
            last_message = None
            if _normalize_text(conversation.last_message_id):
                last_message = session.get(ChatMessage, conversation.last_message_id)
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
            presence_map = self._service._get_presence_map(user_ids=member_ids)
            users_by_id = self._service._get_users_map(
                presence_map=presence_map,
                user_ids=member_ids,
            )
            return {
                int(user_id): self._service._serialize_conversation(
                    session=session,
                    conversation=conversation,
                    current_user_id=int(user_id),
                    users_by_id=users_by_id,
                    members=members,
                    state=states_by_user_id.get(int(user_id)),
                    last_message=last_message,
                    unread_count=max(0, int(getattr(states_by_user_id.get(int(user_id)), "unread_count", 0) or 0)),
                    last_message_attachments=last_message_attachments,
                    reads_by_message_id=reads_by_message_id,
                    states_by_user_id=states_by_user_id,
                )
                for user_id in allowed_user_ids
            }


    def get_conversation_assets_summary(
        self,
        *,
        current_user_id: int,
        conversation_id: str,
        recent_limit: int = 8,
    ) -> dict:
        
        normalized_conversation_id = _normalize_text(conversation_id)
        if not normalized_conversation_id:
            raise ValueError("conversation_id is required")
        max_recent = max(1, min(int(recent_limit), 12))

        with chat_session() as session:
            conversation = self._service._require_membership(
                session=session,
                conversation_id=normalized_conversation_id,
                current_user_id=int(current_user_id),
            )
            shared_tasks_count = int(
                session.execute(
                    select(func.count(ChatMessage.id)).where(
                        ChatMessage.conversation_id == conversation.id,
                        ChatMessage.kind == "task_share",
                    )
                ).scalar_one()
                or 0
            )

            def _count_attachments(kind: str) -> int:
                query = select(func.count()).select_from(ChatMessageAttachment).where(
                    ChatMessageAttachment.conversation_id == conversation.id
                )
                query = self._service._apply_attachment_kind_filter(query=query, kind=kind)
                return int(session.execute(query).scalar_one() or 0)

            def _recent_attachments(kind: str) -> list[dict]:
                query = (
                    select(ChatMessageAttachment)
                    .where(ChatMessageAttachment.conversation_id == conversation.id)
                    .order_by(ChatMessageAttachment.created_at.desc(), ChatMessageAttachment.id.desc())
                    .limit(max_recent)
                )
                query = self._service._apply_attachment_kind_filter(query=query, kind=kind)
                rows = list(session.execute(query).scalars())
                return [
                    self._service._conversation_attachment_to_payload(
                        attachment,
                        kind=kind,
                    )
                    for attachment in rows
                ]

            summary = {
                "photos_count": _count_attachments("image"),
                "videos_count": _count_attachments("video"),
                "files_count": _count_attachments("file"),
                "audio_count": _count_attachments("audio"),
                "shared_tasks_count": shared_tasks_count,
                "recent_photos": _recent_attachments("image"),
                "recent_videos": _recent_attachments("video"),
                "recent_files": _recent_attachments("file"),
                "recent_audio": _recent_attachments("audio"),
            }

            return summary


    def list_conversation_attachments(
        self,
        *,
        current_user_id: int,
        conversation_id: str,
        kind: str,
        limit: int = 20,
        before_attachment_id: Optional[str] = None,
    ) -> dict:
        
        normalized_conversation_id = _normalize_text(conversation_id)
        normalized_kind = self._service._normalize_attachment_kind_filter(kind)
        normalized_before_attachment_id = _normalize_text(before_attachment_id)
        page_size = max(1, min(int(limit), 100))

        with chat_session() as session:
            conversation = self._service._require_membership(
                session=session,
                conversation_id=normalized_conversation_id,
                current_user_id=int(current_user_id),
            )

            query = select(ChatMessageAttachment).where(
                ChatMessageAttachment.conversation_id == conversation.id,
            )
            query = self._service._apply_attachment_kind_filter(query=query, kind=normalized_kind)

            if normalized_before_attachment_id:
                anchor = session.get(ChatMessageAttachment, normalized_before_attachment_id)
                if anchor is None or anchor.conversation_id != conversation.id:
                    raise LookupError("Attachment cursor not found")
                query = query.where(
                    or_(
                        ChatMessageAttachment.created_at < anchor.created_at,
                        and_(
                            ChatMessageAttachment.created_at == anchor.created_at,
                            ChatMessageAttachment.id < anchor.id,
                        ),
                    )
                )

            rows = list(
                session.execute(
                    query.order_by(ChatMessageAttachment.created_at.desc(), ChatMessageAttachment.id.desc()).limit(page_size + 1)
                ).scalars()
            )
            has_more = len(rows) > page_size
            visible_rows = rows[:page_size]

            return {
                "items": [
                    self._service._conversation_attachment_to_payload(item, kind=normalized_kind)
                    for item in visible_rows
                ],
                "has_more": has_more,
                "next_before_attachment_id": visible_rows[-1].id if has_more and visible_rows else None,
            }


