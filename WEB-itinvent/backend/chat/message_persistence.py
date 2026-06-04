"""Transactional persistence seams for chat messages."""
from __future__ import annotations

from dataclasses import dataclass
from datetime import datetime
import json
import time
from typing import Any, Callable
from uuid import uuid4

from sqlalchemy import select
from sqlalchemy.exc import IntegrityError

from backend.chat.models import ChatConversationUserState, ChatMessage, ChatMessageAttachment
from backend.chat.utils import normalize_text as _normalize_text


def _attachment_kind_from_payload(item: dict[str, Any]) -> str:
    media_kind = _normalize_text(item.get("media_kind")).lower()
    if media_kind in {"image", "video", "audio", "file"}:
        return media_kind
    mime_type = _normalize_text(item.get("mime_type")).lower()
    if mime_type.startswith("image/"):
        return "image"
    if mime_type.startswith("video/"):
        return "video"
    if mime_type.startswith("audio/"):
        return "audio"
    return "file"


def _attachment_file_url(*, message_id: str, attachment_id: str, inline: bool = False) -> str:
    url = f"/api/v1/chat/messages/{message_id}/attachments/{attachment_id}/file"
    return f"{url}?inline=1" if inline else url


def _get_or_create_conversation_state(
    *,
    session,
    conversation_id: str,
    current_user_id: int,
) -> ChatConversationUserState:
    state = session.execute(
        select(ChatConversationUserState).where(
            ChatConversationUserState.conversation_id == conversation_id,
            ChatConversationUserState.user_id == int(current_user_id),
        )
    ).scalar_one_or_none()
    if state is None:
        state = ChatConversationUserState(
            conversation_id=conversation_id,
            user_id=int(current_user_id),
        )
        session.add(state)
    return state


def _mark_sender_message_seen(
    *,
    session,
    conversation_id: str,
    current_user_id: int,
    message_id: str,
    conversation_seq: int,
    seen_at: datetime,
) -> None:
    state = _get_or_create_conversation_state(
        session=session,
        conversation_id=conversation_id,
        current_user_id=int(current_user_id),
    )
    state.last_read_message_id = _normalize_text(message_id)
    state.last_read_seq = max(0, int(conversation_seq or 0))
    state.last_read_at = seen_at
    state.unread_count = 0
    state.opened_at = seen_at
    state.updated_at = seen_at


def _increment_unread_counters_for_recipients(
    *,
    session,
    conversation_id: str,
    sender_user_id: int,
    member_user_ids: list[int],
    seen_at: datetime,
) -> None:
    for member_user_id in list(member_user_ids or []):
        normalized_member_user_id = int(member_user_id)
        if normalized_member_user_id <= 0 or normalized_member_user_id == int(sender_user_id):
            continue
        state = _get_or_create_conversation_state(
            session=session,
            conversation_id=conversation_id,
            current_user_id=normalized_member_user_id,
        )
        state.updated_at = seen_at
        state.unread_count = max(0, int(state.unread_count or 0) + 1)


def _apply_new_message_delivery_state(
    *,
    session,
    conversation,
    message: ChatMessage,
    sender_user_id: int,
    member_user_ids: list[int],
    seen_at: datetime,
) -> None:
    conversation.last_message_id = message.id
    conversation.last_message_seq = int(message.conversation_seq or 0)
    conversation.last_message_at = seen_at
    conversation.updated_at = seen_at
    _mark_sender_message_seen(
        session=session,
        conversation_id=conversation.id,
        current_user_id=int(sender_user_id),
        message_id=message.id,
        conversation_seq=int(message.conversation_seq or 0),
        seen_at=seen_at,
    )
    _increment_unread_counters_for_recipients(
        session=session,
        conversation_id=conversation.id,
        sender_user_id=int(sender_user_id),
        member_user_ids=member_user_ids,
        seen_at=seen_at,
    )


@dataclass(frozen=True)
class TextMessagePersistenceResult:
    payload: dict[str, Any]
    message_id: str
    member_user_ids: list[int]
    dedup_hit: bool
    stage_metrics: dict[str, float]


@dataclass(frozen=True)
class FileMessagePersistenceResult:
    payload: dict[str, Any]
    message_id: str
    member_user_ids: list[int]


@dataclass(frozen=True)
class ForwardMessageSnapshot:
    source_message_id: str
    kind: str
    body: str
    body_format: str
    forward_from_message_id: str
    task_id: str | None = None
    task_preview_json: str | None = None


@dataclass(frozen=True)
class ForwardMessagePersistenceResult:
    payload: dict[str, Any]
    message_id: str
    member_user_ids: list[int]


class ChatSystemMessagePersistence:
    """Owns system message row persistence inside the caller's transaction."""

    def append_system_message(
        self,
        *,
        session,
        conversation,
        actor_user_id: int,
        body: str,
        member_user_ids: list[int],
        now: datetime,
    ) -> ChatMessage:
        next_conversation_seq = int(getattr(conversation, "last_message_seq", 0) or 0) + 1
        message = ChatMessage(
            id=str(uuid4()),
            conversation_id=conversation.id,
            sender_user_id=int(actor_user_id),
            kind="system",
            body_format="plain",
            body=_normalize_text(body) or "Системное событие",
            conversation_seq=next_conversation_seq,
            created_at=now,
        )
        session.add(message)
        _apply_new_message_delivery_state(
            session=session,
            conversation=conversation,
            message=message,
            sender_user_id=int(actor_user_id),
            member_user_ids=member_user_ids,
            seen_at=now,
        )
        return message


@dataclass(frozen=True)
class TaskShareSnapshot:
    task_id: str
    preview: dict[str, Any]


@dataclass(frozen=True)
class TaskSharePersistenceResult:
    payload: dict[str, Any]
    message_id: str
    member_user_ids: list[int]
    task_preview: dict[str, Any]


class ChatTextMessagePersistence:
    """Owns plain text message DB persistence and client-id deduplication."""

    def __init__(
        self,
        *,
        session_factory: Callable[[], Any],
        require_membership: Callable[..., Any],
        lock_conversation_for_write: Callable[..., Any],
        conversation_member_ids: Callable[..., list[int]],
        resolve_reply_message: Callable[..., Any],
        find_existing_client_message: Callable[..., Any],
        build_message_payload_for_members: Callable[..., dict[str, Any]],
        now: Callable[[], datetime],
    ) -> None:
        self._session_factory = session_factory
        self._require_membership = require_membership
        self._lock_conversation_for_write = lock_conversation_for_write
        self._conversation_member_ids = conversation_member_ids
        self._resolve_reply_message = resolve_reply_message
        self._find_existing_client_message = find_existing_client_message
        self._build_message_payload_for_members = build_message_payload_for_members
        self._now = now

    def persist_text_message(
        self,
        *,
        current_user_id: int,
        conversation_id: str,
        body: str,
        body_format: str,
        client_message_id: str | None,
        reply_to_message_id: str | None,
    ) -> TextMessagePersistenceResult:
        stage_metrics: dict[str, float] = {}
        member_user_ids: list[int] = []
        message_id = ""
        payload: dict[str, Any] = {}
        dedup_hit = False
        normalized_client_message_id = _normalize_text(client_message_id) or None

        with self._session_factory() as session:
            stage_started_at = time.perf_counter()
            conversation = self._require_membership(
                session=session,
                conversation_id=conversation_id,
                current_user_id=int(current_user_id),
            )
            conversation = self._lock_conversation_for_write(session=session, conversation_id=conversation.id)
            member_user_ids = self._conversation_member_ids(session, conversation.id)
            reply_to_message = self._resolve_reply_message(
                session=session,
                conversation_id=conversation.id,
                reply_to_message_id=reply_to_message_id,
            )
            stage_metrics["membership_ms"] = (time.perf_counter() - stage_started_at) * 1000.0

            existing_message = self._find_existing_client_message(
                session=session,
                conversation_id=conversation.id,
                current_user_id=int(current_user_id),
                client_message_id=normalized_client_message_id or "",
            )
            if existing_message is not None:
                dedup_hit = True
                message_id = existing_message.id
                stage_started_at = time.perf_counter()
                payload = self._build_message_payload_for_members(
                    session=session,
                    conversation=conversation,
                    message=existing_message,
                    current_user_id=int(current_user_id),
                    member_user_ids=member_user_ids,
                )
                stage_metrics["serialize_ms"] = (time.perf_counter() - stage_started_at) * 1000.0
            else:
                stage_started_at = time.perf_counter()
                now = self._now()
                next_conversation_seq = int(getattr(conversation, "last_message_seq", 0) or 0) + 1
                message = ChatMessage(
                    id=str(uuid4()),
                    conversation_id=conversation.id,
                    sender_user_id=int(current_user_id),
                    body_format=body_format,
                    body=body,
                    conversation_seq=next_conversation_seq,
                    client_message_id=normalized_client_message_id,
                    reply_to_message_id=getattr(reply_to_message, "id", None),
                    created_at=now,
                )
                session.add(message)
                _apply_new_message_delivery_state(
                    session=session,
                    conversation=conversation,
                    message=message,
                    sender_user_id=int(current_user_id),
                    member_user_ids=member_user_ids,
                    seen_at=now,
                )
                stage_metrics["prepare_write_ms"] = (time.perf_counter() - stage_started_at) * 1000.0

                stage_started_at = time.perf_counter()
                try:
                    session.flush()
                except IntegrityError:
                    session.rollback()
                    dedup_hit = True
                    with self._session_factory() as dedup_session:
                        dedup_conversation = self._require_membership(
                            session=dedup_session,
                            conversation_id=conversation_id,
                            current_user_id=int(current_user_id),
                        )
                        member_user_ids = self._conversation_member_ids(dedup_session, dedup_conversation.id)
                        existing_message = self._find_existing_client_message(
                            session=dedup_session,
                            conversation_id=dedup_conversation.id,
                            current_user_id=int(current_user_id),
                            client_message_id=normalized_client_message_id or "",
                        )
                        if existing_message is None:
                            raise
                        message_id = existing_message.id
                        payload = self._build_message_payload_for_members(
                            session=dedup_session,
                            conversation=dedup_conversation,
                            message=existing_message,
                            current_user_id=int(current_user_id),
                            member_user_ids=member_user_ids,
                        )
                    stage_metrics["flush_ms"] = (time.perf_counter() - stage_started_at) * 1000.0
                    stage_metrics["serialize_ms"] = stage_metrics.get("serialize_ms", 0.0)
                else:
                    stage_metrics["flush_ms"] = (time.perf_counter() - stage_started_at) * 1000.0
                    message_id = message.id

                    stage_started_at = time.perf_counter()
                    payload = self._build_message_payload_for_members(
                        session=session,
                        conversation=conversation,
                        message=message,
                        current_user_id=int(current_user_id),
                        member_user_ids=member_user_ids,
                    )
                    stage_metrics["serialize_ms"] = (time.perf_counter() - stage_started_at) * 1000.0

        return TextMessagePersistenceResult(
            payload=payload,
            message_id=message_id,
            member_user_ids=member_user_ids,
            dedup_hit=dedup_hit,
            stage_metrics=stage_metrics,
        )


class ChatFileMessagePersistence:
    """Owns file message DB persistence after file payloads are prepared."""

    def __init__(
        self,
        *,
        session_factory: Callable[[], Any],
        require_membership: Callable[..., Any],
        lock_conversation_for_write: Callable[..., Any],
        conversation_member_ids: Callable[..., list[int]],
        resolve_reply_message: Callable[..., Any],
        build_message_payload_for_members: Callable[..., dict[str, Any]],
        now: Callable[[], datetime],
    ) -> None:
        self._session_factory = session_factory
        self._require_membership = require_membership
        self._lock_conversation_for_write = lock_conversation_for_write
        self._conversation_member_ids = conversation_member_ids
        self._resolve_reply_message = resolve_reply_message
        self._build_message_payload_for_members = build_message_payload_for_members
        self._now = now

    def persist_file_message(
        self,
        *,
        current_user_id: int,
        conversation_id: str,
        body: str,
        prepared: list[dict[str, Any]],
        reply_to_message_id: str | None = None,
        forward_from_message_id: str | None = None,
    ) -> FileMessagePersistenceResult:
        normalized_body = _normalize_text(body)
        with self._session_factory() as session:
            conversation = self._require_membership(
                session=session,
                conversation_id=conversation_id,
                current_user_id=int(current_user_id),
            )
            conversation = self._lock_conversation_for_write(session=session, conversation_id=conversation.id)
            member_user_ids = self._conversation_member_ids(session, conversation.id)
            reply_to_message = self._resolve_reply_message(
                session=session,
                conversation_id=conversation.id,
                reply_to_message_id=reply_to_message_id,
            )
            now = self._now()
            next_conversation_seq = int(getattr(conversation, "last_message_seq", 0) or 0) + 1
            message = ChatMessage(
                id=str(uuid4()),
                conversation_id=conversation.id,
                sender_user_id=int(current_user_id),
                kind="file",
                body=normalized_body,
                conversation_seq=next_conversation_seq,
                reply_to_message_id=getattr(reply_to_message, "id", None),
                forward_from_message_id=_normalize_text(forward_from_message_id) or None,
                created_at=now,
            )
            session.add(message)

            attachment_payload: list[dict[str, Any]] = []
            for item in prepared:
                session.add(
                    ChatMessageAttachment(
                        id=item["attachment_id"],
                        message_id=message.id,
                        conversation_id=conversation.id,
                        storage_name=item["storage_name"],
                        file_name=item["file_name"],
                        mime_type=item["mime_type"],
                        media_kind=item.get("media_kind"),
                        file_size=int(item["file_size"]),
                        width=int(item["width"]) if item.get("width") is not None else None,
                        height=int(item["height"]) if item.get("height") is not None else None,
                        duration_seconds=int(item["duration_seconds"]) if item.get("duration_seconds") is not None else None,
                        uploaded_by_user_id=int(current_user_id),
                        created_at=now,
                    )
                )
                attachment_payload.append(
                    {
                        "id": item["attachment_id"],
                        "kind": _attachment_kind_from_payload(item),
                        "file_name": item["file_name"],
                        "mime_type": item["mime_type"],
                        "media_kind": item.get("media_kind"),
                        "file_size": int(item["file_size"]),
                        "width": int(item["width"]) if item.get("width") is not None else None,
                        "height": int(item["height"]) if item.get("height") is not None else None,
                        "duration_seconds": int(item["duration_seconds"]) if item.get("duration_seconds") is not None else None,
                        "original_url": _attachment_file_url(message_id=message.id, attachment_id=item["attachment_id"], inline=True),
                        "download_url": _attachment_file_url(message_id=message.id, attachment_id=item["attachment_id"]),
                        "created_at": _normalize_text(now.isoformat()),
                    }
                )

            _apply_new_message_delivery_state(
                session=session,
                conversation=conversation,
                message=message,
                sender_user_id=int(current_user_id),
                member_user_ids=member_user_ids,
                seen_at=now,
            )
            session.flush()
            payload = self._build_message_payload_for_members(
                session=session,
                conversation=conversation,
                message=message,
                current_user_id=int(current_user_id),
                member_user_ids=member_user_ids,
                attachments=attachment_payload,
            )
        return FileMessagePersistenceResult(
            payload=payload,
            message_id=message.id,
            member_user_ids=member_user_ids,
        )


class ChatForwardMessagePersistence:
    """Owns forward-message DB persistence after source/file checks are prepared."""

    def __init__(
        self,
        *,
        session_factory: Callable[[], Any],
        require_membership: Callable[..., Any],
        lock_conversation_for_write: Callable[..., Any],
        conversation_member_ids: Callable[..., list[int]],
        resolve_reply_message: Callable[..., Any],
        build_message_payload_for_members: Callable[..., dict[str, Any]],
        now: Callable[[], datetime],
    ) -> None:
        self._session_factory = session_factory
        self._require_membership = require_membership
        self._lock_conversation_for_write = lock_conversation_for_write
        self._conversation_member_ids = conversation_member_ids
        self._resolve_reply_message = resolve_reply_message
        self._build_message_payload_for_members = build_message_payload_for_members
        self._now = now

    def persist_forward_message(
        self,
        *,
        current_user_id: int,
        conversation_id: str,
        source: ForwardMessageSnapshot,
        prepared_attachments: list[dict[str, Any]],
        reply_to_message_id: str | None = None,
        validate_member_user_ids: Callable[[list[int]], None] | None = None,
    ) -> ForwardMessagePersistenceResult:
        normalized_kind = _normalize_text(source.kind, "text")
        normalized_body_format = _normalize_text(source.body_format, "plain")
        normalized_forward_from_message_id = (
            _normalize_text(source.forward_from_message_id)
            or _normalize_text(source.source_message_id)
        )
        with self._session_factory() as session:
            conversation = self._require_membership(
                session=session,
                conversation_id=conversation_id,
                current_user_id=int(current_user_id),
            )
            conversation = self._lock_conversation_for_write(session=session, conversation_id=conversation.id)
            member_user_ids = self._conversation_member_ids(session, conversation.id)
            if validate_member_user_ids is not None:
                validate_member_user_ids(member_user_ids)
            reply_to_message = self._resolve_reply_message(
                session=session,
                conversation_id=conversation.id,
                reply_to_message_id=reply_to_message_id,
            )
            now = self._now()
            next_conversation_seq = int(getattr(conversation, "last_message_seq", 0) or 0) + 1
            message = ChatMessage(
                id=str(uuid4()),
                conversation_id=conversation.id,
                sender_user_id=int(current_user_id),
                kind=normalized_kind,
                body_format=normalized_body_format,
                body=_normalize_text(source.body),
                conversation_seq=next_conversation_seq,
                reply_to_message_id=getattr(reply_to_message, "id", None),
                forward_from_message_id=normalized_forward_from_message_id,
                task_id=_normalize_text(source.task_id) if normalized_kind == "task_share" else None,
                task_preview_json=source.task_preview_json if normalized_kind == "task_share" else None,
                created_at=now,
            )
            session.add(message)

            attachment_payload: list[dict[str, Any]] = []
            for item in list(prepared_attachments or []):
                session.add(
                    ChatMessageAttachment(
                        id=item["attachment_id"],
                        message_id=message.id,
                        conversation_id=conversation.id,
                        storage_name=item["storage_name"],
                        file_name=item["file_name"],
                        mime_type=item["mime_type"],
                        media_kind=item.get("media_kind"),
                        file_size=int(item["file_size"]),
                        width=int(item["width"]) if item.get("width") is not None else None,
                        height=int(item["height"]) if item.get("height") is not None else None,
                        duration_seconds=int(item["duration_seconds"]) if item.get("duration_seconds") is not None else None,
                        uploaded_by_user_id=int(current_user_id),
                        created_at=now,
                    )
                )
                attachment_payload.append(
                    {
                        "id": item["attachment_id"],
                        "kind": _attachment_kind_from_payload(item),
                        "file_name": item["file_name"],
                        "mime_type": item["mime_type"],
                        "media_kind": item.get("media_kind"),
                        "file_size": int(item["file_size"]),
                        "width": int(item["width"]) if item.get("width") is not None else None,
                        "height": int(item["height"]) if item.get("height") is not None else None,
                        "duration_seconds": int(item["duration_seconds"]) if item.get("duration_seconds") is not None else None,
                        "original_url": _attachment_file_url(message_id=message.id, attachment_id=item["attachment_id"], inline=True),
                        "download_url": _attachment_file_url(message_id=message.id, attachment_id=item["attachment_id"]),
                        "created_at": _normalize_text(now.isoformat()),
                    }
                )

            _apply_new_message_delivery_state(
                session=session,
                conversation=conversation,
                message=message,
                sender_user_id=int(current_user_id),
                member_user_ids=member_user_ids,
                seen_at=now,
            )
            session.flush()
            payload = self._build_message_payload_for_members(
                session=session,
                conversation=conversation,
                message=message,
                current_user_id=int(current_user_id),
                member_user_ids=member_user_ids,
                attachments=attachment_payload,
            )
        return ForwardMessagePersistenceResult(
            payload=payload,
            message_id=message.id,
            member_user_ids=member_user_ids,
        )


class ChatTaskShareMessagePersistence:
    """Owns task-share DB persistence after chat membership is locked."""

    def __init__(
        self,
        *,
        session_factory: Callable[[], Any],
        require_membership: Callable[..., Any],
        lock_conversation_for_write: Callable[..., Any],
        conversation_member_ids: Callable[..., list[int]],
        resolve_reply_message: Callable[..., Any],
        authorize_task_share: Callable[..., TaskShareSnapshot],
        build_message_payload_for_members: Callable[..., dict[str, Any]],
        now: Callable[[], datetime],
    ) -> None:
        self._session_factory = session_factory
        self._require_membership = require_membership
        self._lock_conversation_for_write = lock_conversation_for_write
        self._conversation_member_ids = conversation_member_ids
        self._resolve_reply_message = resolve_reply_message
        self._authorize_task_share = authorize_task_share
        self._build_message_payload_for_members = build_message_payload_for_members
        self._now = now

    def persist_task_share_message(
        self,
        *,
        current_user_id: int,
        conversation_id: str,
        task_id: str,
        reply_to_message_id: str | None = None,
    ) -> TaskSharePersistenceResult:
        with self._session_factory() as session:
            conversation = self._require_membership(
                session=session,
                conversation_id=conversation_id,
                current_user_id=int(current_user_id),
            )
            conversation = self._lock_conversation_for_write(session=session, conversation_id=conversation.id)
            member_user_ids = [
                int(item)
                for item in self._conversation_member_ids(session, conversation.id)
                if int(item) > 0
            ]
            task_snapshot = self._authorize_task_share(
                task_id=task_id,
                current_user_id=int(current_user_id),
                member_user_ids=member_user_ids,
            )
            reply_to_message = self._resolve_reply_message(
                session=session,
                conversation_id=conversation.id,
                reply_to_message_id=reply_to_message_id,
            )

            task_preview = dict(task_snapshot.preview)
            now = self._now()
            next_conversation_seq = int(getattr(conversation, "last_message_seq", 0) or 0) + 1
            message = ChatMessage(
                id=str(uuid4()),
                conversation_id=conversation.id,
                sender_user_id=int(current_user_id),
                kind="task_share",
                body=_normalize_text(task_preview.get("title")),
                conversation_seq=next_conversation_seq,
                reply_to_message_id=getattr(reply_to_message, "id", None),
                task_id=_normalize_text(task_snapshot.task_id),
                task_preview_json=json.dumps(task_preview, ensure_ascii=False),
                created_at=now,
            )
            session.add(message)
            _apply_new_message_delivery_state(
                session=session,
                conversation=conversation,
                message=message,
                sender_user_id=int(current_user_id),
                member_user_ids=member_user_ids,
                seen_at=now,
            )
            session.flush()
            payload = self._build_message_payload_for_members(
                session=session,
                conversation=conversation,
                message=message,
                current_user_id=int(current_user_id),
                member_user_ids=member_user_ids,
            )
        return TaskSharePersistenceResult(
            payload=payload,
            message_id=message.id,
            member_user_ids=member_user_ids,
            task_preview=task_preview,
        )
