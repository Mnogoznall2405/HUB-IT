"""Transactional persistence seams for chat messages."""
from __future__ import annotations

from dataclasses import dataclass
from datetime import datetime
import json
import time
from typing import Any, Callable
from uuid import uuid4

from sqlalchemy import insert, select
from sqlalchemy.exc import IntegrityError

from backend.chat.chat_delivery_state import (
    _apply_new_message_delivery_state,
    _get_or_create_conversation_state,
    _increment_unread_counters_for_recipients,
    _mark_sender_message_seen,
    build_delivery_state_outbox_job,
)
from backend.chat.chat_message_seq import (
    claim_next_conversation_seq,
    claim_next_conversation_seq_and_touch,
    touch_conversation_last_message,
)
from backend.chat.chat_attachment_preview_service import chat_attachment_preview_service
from backend.chat.lean_ack import (
    build_lean_message_payload_from_orm,
    empty_ack_prepare_stage_metrics,
)
from backend.chat.models import ChatConversation, ChatConversationUserState, ChatEventOutbox, ChatMessage, ChatMessageAttachment
from backend.chat.utils import normalize_text as _normalize_text

CLIENT_MESSAGE_DEDUP_CONSTRAINTS = {
    "uq_chat_messages_conversation_sender_client_message",
    "idx_chat_messages_conversation_sender_client_message",
}


def is_expected_client_message_dedup_violation(exc: BaseException) -> bool:
    """True only for the client_message_id unique constraint (not seq uniqueness)."""
    chunks: list[str] = []
    constraint_names: set[str] = set()
    current: BaseException | None = exc
    seen: set[int] = set()
    while current is not None and id(current) not in seen:
        seen.add(id(current))
        chunks.append(str(current))
        diag = getattr(current, "diag", None)
        constraint_name = getattr(diag, "constraint_name", None) or getattr(current, "constraint_name", None)
        if constraint_name:
            constraint_names.add(str(constraint_name).lower())
        orig = getattr(current, "orig", None)
        if isinstance(orig, BaseException):
            chunks.append(str(orig))
            current = orig
            continue
        current = current.__cause__ if isinstance(current.__cause__, BaseException) else None
    text = " ".join(chunks).lower()
    if CLIENT_MESSAGE_DEDUP_CONSTRAINTS.intersection(constraint_names):
        return True
    if any(constraint_name in text for constraint_name in CLIENT_MESSAGE_DEDUP_CONSTRAINTS):
        return True
    error_text = text.split("[sql:", 1)[0]
    if "unique" in error_text and "client_message_id" in error_text and "conversation_seq" not in error_text:
        return True
    return False


def _attachment_kind_from_payload(item: dict[str, Any]) -> str:
    media_kind = _normalize_text(item.get("media_kind")).lower()
    if media_kind in {"image", "video", "audio", "file", "sticker"}:
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


@dataclass(frozen=True)
class TextMessagePersistenceResult:
    payload: dict[str, Any]
    message_id: str
    member_user_ids: list[int]
    dedup_hit: bool
    conversation_kind: str
    stage_metrics: dict[str, float]


@dataclass(frozen=True)
class FileMessagePersistenceResult:
    payload: dict[str, Any]
    message_id: str
    member_user_ids: list[int]
    conversation_kind: str
    dedup_hit: bool = False


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

    dedup_hit: bool = False


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

    @staticmethod
    def _enqueue_delivery_state_outbox(*, session, job: dict[str, Any]) -> None:
        """Legacy in-TX outbox insert (file/forward paths). Prefer deferred enqueue."""
        dedupe_key = _normalize_text(job.get("dedupe_key"))
        if dedupe_key:
            existing = session.execute(
                select(ChatEventOutbox.id).where(ChatEventOutbox.dedupe_key == dedupe_key)
            ).scalar_one_or_none()
            if existing is not None:
                return
        now = job.get("_now")
        session.add(
            ChatEventOutbox(
                event_type=_normalize_text(job.get("event_type")),
                target_scope=_normalize_text(job.get("target_scope"), "system") or "system",
                target_user_id=int(job.get("target_user_id") or 0),
                conversation_id=_normalize_text(job.get("conversation_id")) or None,
                message_id=_normalize_text(job.get("message_id")) or None,
                payload_json=json.dumps(job.get("payload") or {}, ensure_ascii=False),
                dedupe_key=dedupe_key or None,
                status="queued",
                attempt_count=0,
                next_attempt_at=now,
                last_error=None,
                created_at=now,
                updated_at=now,
            )
        )

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
        conversation_kind = ""
        conversation_task_id = ""
        payload: dict[str, Any] = {}
        dedup_hit = False
        normalized_client_message_id = _normalize_text(client_message_id) or None
        second_db_session_used = 0
        claimed_conversation_seq = 0
        written_conversation_id = _normalize_text(conversation_id)
        post_commit_serialize: dict[str, Any] | None = None
        deferred_outbox_job: dict[str, Any] | None = None
        conversation_kind = "direct"

        write_session_started_at = time.perf_counter()
        send_received_at = write_session_started_at
        with self._session_factory() as session:
            stage_started_at = time.perf_counter()
            try:
                from backend.chat.write_path_metrics import mark_send_stage

                mark_send_stage("db_checkout_started")
            except Exception:
                pass
            # Pool wait: timestamp set in chat_write_session(); connection() completes checkout.
            _ = session.connection()
            checkout_finished_at = time.perf_counter()
            stage_metrics["db_pool_acquired_ms"] = (checkout_finished_at - stage_started_at) * 1000.0
            stage_metrics["db_checkout_wait_ms"] = stage_metrics["db_pool_acquired_ms"]
            try:
                from backend.chat.write_path_metrics import mark_send_stage

                mark_send_stage(
                    "db_checkout_finished",
                    started_at=stage_started_at,
                    finished_at=checkout_finished_at,
                )
                mark_send_stage(
                    "db_pool_wait",
                    started_at=stage_started_at,
                    finished_at=checkout_finished_at,
                )
            except Exception:
                pass

            stage_started_at = time.perf_counter()
            conversation = self._require_membership(
                session=session,
                conversation_id=conversation_id,
                current_user_id=int(current_user_id),
            )
            member_user_ids = self._conversation_member_ids(session, conversation.id)
            conversation_kind = (
                _normalize_text(getattr(conversation, "kind", None), "direct") or "direct"
            )
            conversation_task_id = _normalize_text(getattr(conversation, "task_id", None))
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
                stage_metrics.update(empty_ack_prepare_stage_metrics())
                payload = build_lean_message_payload_from_orm(
                    message=existing_message,
                    current_user_id=int(current_user_id),
                    conversation_kind=conversation_kind,
                    task_id=conversation_task_id,
                )
                stage_metrics["ack_payload_prepare_ms"] = (time.perf_counter() - stage_started_at) * 1000.0
                stage_metrics["serialize_ms"] = stage_metrics["ack_payload_prepare_ms"]
                stage_metrics["prepare_write_ms"] = 0.0
                stage_metrics["flush_ms"] = 0.0
                stage_metrics["commit_ms"] = 0.0
                stage_metrics["sequence_ms"] = 0.0
            else:
                # Prep everything that does not need seq BEFORE claiming the row lock.
                now = self._now()
                prepared_message_id = str(uuid4())
                reply_message_id = getattr(reply_to_message, "id", None)
                written_conversation_id = conversation.id
                claim_finished_at: float | None = None

                # Drop ORM instances before claim so flush cannot emit stale conversation UPDATEs.
                try:
                    session.expunge(conversation)
                except Exception:
                    pass
                if reply_to_message is not None:
                    try:
                        session.expunge(reply_to_message)
                    except Exception:
                        pass

                try:
                    from backend.chat.write_path_metrics import mark_send_stage

                    mark_send_stage("tx_started", chat_id=str(written_conversation_id)[:64])
                except Exception:
                    pass
                stage_started_at = time.perf_counter()
                try:
                    from backend.chat.write_path_metrics import mark_send_stage

                    mark_send_stage("seq_update_started", chat_id=str(written_conversation_id)[:64])
                except Exception:
                    pass
                next_conversation_seq = claim_next_conversation_seq_and_touch(
                    session=session,
                    conversation_id=written_conversation_id,
                    message_id=prepared_message_id,
                    seen_at=now,
                    touch_tip=True,
                )
                claim_finished_at = time.perf_counter()
                claimed_conversation_seq = int(next_conversation_seq)
                stage_metrics["sequence_ms"] = (claim_finished_at - stage_started_at) * 1000.0
                stage_metrics["seq_claim_ms"] = stage_metrics["sequence_ms"]
                stage_metrics["seq_update_total_ms"] = stage_metrics["sequence_ms"]
                stage_metrics["conversation_touch_ms"] = 0.0
                try:
                    from backend.chat.write_path_metrics import mark_send_stage

                    mark_send_stage(
                        "seq_update_finished",
                        started_at=stage_started_at,
                        finished_at=claim_finished_at,
                        chat_id=str(written_conversation_id)[:64],
                    )
                except Exception:
                    pass

                # Under row lock: Core INSERT + commit only. No SELECT/outbox/payload/ORM sync.
                stage_started_at = time.perf_counter()
                try:
                    from backend.chat.write_path_metrics import mark_send_stage

                    mark_send_stage("message_insert_started", chat_id=str(written_conversation_id)[:64])
                except Exception:
                    pass
                session.execute(
                    insert(ChatMessage.__table__).values(
                        id=prepared_message_id,
                        conversation_id=written_conversation_id,
                        sender_user_id=int(current_user_id),
                        kind="text",
                        body_format=body_format,
                        body=body,
                        conversation_seq=int(next_conversation_seq),
                        client_message_id=normalized_client_message_id,
                        reply_to_message_id=reply_message_id,
                        created_at=now,
                    )
                )
                insert_finished_at = time.perf_counter()
                stage_metrics["message_insert_ms"] = (insert_finished_at - stage_started_at) * 1000.0
                stage_metrics["insert_total_ms"] = stage_metrics["message_insert_ms"]
                stage_metrics["outbox_insert_ms"] = 0.0
                stage_metrics["prepare_write_ms"] = float(stage_metrics.get("message_insert_ms") or 0.0)
                stage_metrics["flush_ms"] = 0.0
                try:
                    from backend.chat.write_path_metrics import mark_send_stage

                    mark_send_stage(
                        "message_insert_finished",
                        started_at=stage_started_at,
                        finished_at=insert_finished_at,
                        chat_id=str(written_conversation_id)[:64],
                    )
                except Exception:
                    pass

                commit_started_at = time.perf_counter()
                stage_metrics["pre_commit_gap_ms"] = (commit_started_at - insert_finished_at) * 1000.0
                try:
                    from backend.chat.write_path_metrics import mark_send_stage

                    mark_send_stage(
                        "commit_started",
                        started_at=insert_finished_at,
                        finished_at=commit_started_at,
                        chat_id=str(written_conversation_id)[:64],
                    )
                except Exception:
                    pass
                try:
                    session.commit()
                except IntegrityError as exc:
                    session.rollback()
                    if not is_expected_client_message_dedup_violation(exc):
                        raise
                    dedup_hit = True
                    claimed_conversation_seq = 0
                    post_commit_serialize = None
                    deferred_outbox_job = None
                    claim_finished_at = None
                    stage_metrics["commit_ms"] = (time.perf_counter() - commit_started_at) * 1000.0
                    stage_metrics["commit_total_ms"] = stage_metrics["commit_ms"]
                    stage_metrics["conversation_lock_hold_ms"] = float(stage_metrics["commit_ms"])
                else:
                    commit_finished_at = time.perf_counter()
                    stage_metrics["commit_ms"] = (commit_finished_at - commit_started_at) * 1000.0
                    stage_metrics["commit_total_ms"] = stage_metrics["commit_ms"]
                    if claim_finished_at is not None:
                        stage_metrics["conversation_lock_hold_ms"] = (
                            commit_finished_at - claim_finished_at
                        ) * 1000.0
                    try:
                        from backend.chat.write_path_metrics import mark_send_stage

                        mark_send_stage(
                            "commit_finished",
                            started_at=commit_started_at,
                            finished_at=commit_finished_at,
                            chat_id=str(written_conversation_id)[:64],
                        )
                    except Exception:
                        pass
                    message_id = prepared_message_id
                    # Payload/outbox prep AFTER lock release.
                    post_commit_serialize = {
                        "conversation_kind": conversation_kind,
                        "message": ChatMessage(
                            id=prepared_message_id,
                            conversation_id=written_conversation_id,
                            sender_user_id=int(current_user_id),
                            kind="text",
                            body_format=body_format,
                            body=body,
                            conversation_seq=int(next_conversation_seq),
                            client_message_id=normalized_client_message_id,
                            reply_to_message_id=reply_message_id,
                            created_at=now,
                        ),
                        "reply_to_message": reply_to_message,
                        "member_user_ids": list(member_user_ids),
                        "current_user_id": int(current_user_id),
                        "conversation_id": written_conversation_id,
                    }
                    deferred_outbox_job = build_delivery_state_outbox_job(
                        conversation_id=written_conversation_id,
                        message_id=prepared_message_id,
                        sender_user_id=int(current_user_id),
                        member_user_ids=member_user_ids,
                        conversation_seq=int(next_conversation_seq),
                        seen_at=now,
                    )
                    deferred_outbox_job["_now"] = now

        if dedup_hit and not payload:
            second_db_session_used = 1
            with self._session_factory() as dedup_session:
                dedup_conversation = self._require_membership(
                    session=dedup_session,
                    conversation_id=conversation_id,
                    current_user_id=int(current_user_id),
                )
                member_user_ids = self._conversation_member_ids(dedup_session, dedup_conversation.id)
                conversation_kind = (
                    _normalize_text(getattr(dedup_conversation, "kind", None), "direct") or "direct"
                )
                conversation_task_id = _normalize_text(getattr(dedup_conversation, "task_id", None))
                existing_message = self._find_existing_client_message(
                    session=dedup_session,
                    conversation_id=dedup_conversation.id,
                    current_user_id=int(current_user_id),
                    client_message_id=normalized_client_message_id or "",
                )
                if existing_message is None:
                    raise LookupError("Duplicate client_message_id conflict but existing message was not found")
                message_id = existing_message.id
                stage_metrics.update(empty_ack_prepare_stage_metrics())
                payload = build_lean_message_payload_from_orm(
                    message=existing_message,
                    current_user_id=int(current_user_id),
                    conversation_kind=conversation_kind,
                    task_id=conversation_task_id,
                )
                stage_metrics["serialize_ms"] = 0.0

        stage_metrics["write_session_ms"] = (time.perf_counter() - write_session_started_at) * 1000.0
        stage_metrics["send_received_to_db_commit_ms"] = (time.perf_counter() - send_received_at) * 1000.0
        stage_metrics["second_db_session"] = float(second_db_session_used)
        stage_metrics["member_count"] = float(len(member_user_ids))

        if not dedup_hit and post_commit_serialize:
            stage_started_at = time.perf_counter()
            stage_metrics.update(empty_ack_prepare_stage_metrics())
            # Lean ACK: no user map / presence / reply preview / second DB session.
            payload = build_lean_message_payload_from_orm(
                message=post_commit_serialize["message"],
                current_user_id=int(post_commit_serialize["current_user_id"]),
                conversation_kind=conversation_kind,
                task_id=conversation_task_id,
            )
            stage_metrics["ack_payload_prepare_ms"] = (time.perf_counter() - stage_started_at) * 1000.0
            stage_metrics["second_db_session"] = float(second_db_session_used)

        # Detach payload from any ORM identity (plain JSON-compatible dict).
        encode_started_at = time.perf_counter()
        payload = json.loads(json.dumps(payload, ensure_ascii=False, default=str))
        encode_ms = (time.perf_counter() - encode_started_at) * 1000.0
        stage_metrics["json_encode_ms"] = encode_ms
        if not dedup_hit and post_commit_serialize:
            stage_metrics["serialize_ms"] = (
                float(stage_metrics.get("ack_payload_prepare_ms") or 0.0) + encode_ms
            )
        elif "serialize_ms" not in stage_metrics:
            stage_metrics["serialize_ms"] = encode_ms
        if not dedup_hit and claimed_conversation_seq > 0 and deferred_outbox_job:
            # Deferred (not atomically durable): enqueue after ACK via aux TX + reconciliation.
            payload["_deferred_delivery_outbox"] = {
                key: value
                for key, value in dict(deferred_outbox_job).items()
                if key != "_now"
            }

        return TextMessagePersistenceResult(
            payload=payload,
            message_id=message_id,
            member_user_ids=member_user_ids,
            dedup_hit=dedup_hit,
            conversation_kind=conversation_kind,
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
        client_message_id: str | None = None,
        reply_to_message_id: str | None = None,
        forward_from_message_id: str | None = None,
    ) -> FileMessagePersistenceResult:
        normalized_body = _normalize_text(body)
        normalized_client_message_id = _normalize_text(client_message_id) or None
        member_user_ids: list[int] = []
        message_id = ""
        attachment_payload: list[dict[str, Any]] = []
        serialize_context: tuple[str, str, list[int], int, list[dict[str, Any]]] | None = None

        with self._session_factory() as session:
            conversation = self._require_membership(
                session=session,
                conversation_id=conversation_id,
                current_user_id=int(current_user_id),
            )
            conversation = self._lock_conversation_for_write(session=session, conversation_id=conversation.id)
            conversation_kind = _normalize_text(getattr(conversation, "kind", ""))
            member_user_ids = self._conversation_member_ids(session, conversation.id)
            if normalized_client_message_id:
                existing_message = session.execute(
                    select(ChatMessage).where(
                        ChatMessage.conversation_id == conversation.id,
                        ChatMessage.sender_user_id == int(current_user_id),
                        ChatMessage.client_message_id == normalized_client_message_id,
                    )
                ).scalar_one_or_none()
                if existing_message is not None:
                    existing_attachments = list(
                        session.execute(
                            select(ChatMessageAttachment).where(
                                ChatMessageAttachment.message_id == existing_message.id
                            )
                        ).scalars()
                    )
                    payload = self._build_message_payload_for_members(
                        session=session,
                        conversation=conversation,
                        message=existing_message,
                        current_user_id=int(current_user_id),
                        member_user_ids=member_user_ids,
                        attachments=existing_attachments,
                    )
                    return FileMessagePersistenceResult(
                        payload=payload,
                        message_id=existing_message.id,
                        member_user_ids=member_user_ids,
                        conversation_kind=conversation_kind,
                        dedup_hit=True,
                    )
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
                client_message_id=normalized_client_message_id,
                reply_to_message_id=getattr(reply_to_message, "id", None),
                forward_from_message_id=_normalize_text(forward_from_message_id) or None,
                created_at=now,
            )
            session.add(message)

            attachment_payload = []
            preview_attachments: list[ChatMessageAttachment] = []
            for item in prepared:
                attachment = ChatMessageAttachment(
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
                session.add(attachment)
                preview_attachments.append(attachment)
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

            # The preview row has a real FK to the attachment.  Flush the
            # message and all attachments first so PostgreSQL cannot choose
            # the preview INSERT before its parent when both ORM objects are
            # pending in the same unit of work.
            session.flush()
            for attachment in preview_attachments:
                chat_attachment_preview_service.enqueue_in_session(
                    session=session,
                    attachment=attachment,
                    now=now,
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
            message_id = message.id
            serialize_context = (
                conversation.id,
                message.id,
                member_user_ids,
                int(current_user_id),
                attachment_payload,
            )

        payload: dict[str, Any] = {}
        if serialize_context is not None:
            conv_id, serialized_message_id, serialized_member_user_ids, serialized_user_id, serialized_attachments = serialize_context
            with self._session_factory() as read_session:
                conversation = read_session.get(ChatConversation, conv_id)
                if conversation is None:
                    raise LookupError("Conversation not found")
                message = read_session.get(ChatMessage, serialized_message_id)
                if message is None:
                    raise LookupError("Message not found")
                payload = self._build_message_payload_for_members(
                    session=read_session,
                    conversation=conversation,
                    message=message,
                    current_user_id=serialized_user_id,
                    member_user_ids=serialized_member_user_ids,
                    attachments=serialized_attachments,
                )
        return FileMessagePersistenceResult(
            payload=payload,
            message_id=message_id,
            member_user_ids=member_user_ids,
            conversation_kind=conversation_kind,
            dedup_hit=False,
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
        client_message_id: str | None = None,
        reply_to_message_id: str | None = None,
        validate_member_user_ids: Callable[[list[int]], None] | None = None,
    ) -> ForwardMessagePersistenceResult:
        normalized_client_message_id = _normalize_text(client_message_id) or None
        normalized_kind = _normalize_text(source.kind, "text")
        normalized_body_format = _normalize_text(source.body_format, "plain")
        normalized_forward_from_message_id = (
            _normalize_text(source.forward_from_message_id)
            or _normalize_text(source.source_message_id)
        )
        member_user_ids: list[int] = []
        message_id = ""
        payload: dict[str, Any] = {}
        serialize_context: tuple[str, str, list[int], int, list[dict[str, Any]]] | None = None
        with self._session_factory() as session:
            self._lock_conversation_for_write(session=session, conversation_id=conversation_id)
            conversation = self._require_membership(
                session=session,
                conversation_id=conversation_id,
                current_user_id=int(current_user_id),
            )
            member_user_ids = self._conversation_member_ids(session, conversation.id)
            if normalized_client_message_id:
                existing = session.execute(select(ChatMessage).where(
                    ChatMessage.conversation_id == conversation.id,
                    ChatMessage.sender_user_id == int(current_user_id),
                    ChatMessage.client_message_id == normalized_client_message_id,
                )).scalar_one_or_none()
                if existing is not None:
                    if existing.forward_from_message_id != normalized_forward_from_message_id:
                        raise ValueError("client_message_id belongs to another message")
                    attachments = list(session.execute(select(ChatMessageAttachment).where(
                        ChatMessageAttachment.message_id == existing.id,
                    )).scalars())
                    payload = self._build_message_payload_for_members(
                        session=session, conversation=conversation, message=existing,
                        current_user_id=int(current_user_id), member_user_ids=member_user_ids,
                        attachments=attachments,
                    )
                    return ForwardMessagePersistenceResult(payload=payload, message_id=existing.id,
                        member_user_ids=member_user_ids, dedup_hit=True)

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
                client_message_id=normalized_client_message_id,
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
            preview_attachments: list[ChatMessageAttachment] = []
            for item in list(prepared_attachments or []):
                attachment = ChatMessageAttachment(
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
                session.add(attachment)
                preview_attachments.append(attachment)
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

            session.flush()
            for attachment in preview_attachments:
                chat_attachment_preview_service.enqueue_in_session(
                    session=session,
                    attachment=attachment,
                    now=now,
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
            message_id = message.id
            serialize_context = (
                conversation.id,
                message.id,
                member_user_ids,
                int(current_user_id),
                attachment_payload,
            )

        if serialize_context is not None:
            conv_id, serialized_message_id, serialized_member_user_ids, serialized_user_id, serialized_attachments = serialize_context
            with self._session_factory() as read_session:
                conversation = read_session.get(ChatConversation, conv_id)
                if conversation is None:
                    raise LookupError("Conversation not found")
                message = read_session.get(ChatMessage, serialized_message_id)
                if message is None:
                    raise LookupError("Message not found")
                payload = self._build_message_payload_for_members(
                    session=read_session,
                    conversation=conversation,
                    message=message,
                    current_user_id=serialized_user_id,
                    member_user_ids=serialized_member_user_ids,
                    attachments=serialized_attachments,
                )
        return ForwardMessagePersistenceResult(
            payload=payload,
            message_id=message_id,
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
        member_user_ids: list[int] = []
        message_id = ""
        task_preview: dict[str, Any] = {}
        payload: dict[str, Any] = {}
        serialize_context: tuple[str, str, list[int], int] | None = None
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
            message_id = message.id
            serialize_context = (
                conversation.id,
                message.id,
                member_user_ids,
                int(current_user_id),
            )

        if serialize_context is not None:
            conv_id, serialized_message_id, serialized_member_user_ids, serialized_user_id = serialize_context
            with self._session_factory() as read_session:
                conversation = read_session.get(ChatConversation, conv_id)
                if conversation is None:
                    raise LookupError("Conversation not found")
                message = read_session.get(ChatMessage, serialized_message_id)
                if message is None:
                    raise LookupError("Message not found")
                payload = self._build_message_payload_for_members(
                    session=read_session,
                    conversation=conversation,
                    message=message,
                    current_user_id=serialized_user_id,
                    member_user_ids=serialized_member_user_ids,
                )
        return TaskSharePersistenceResult(
            payload=payload,
            message_id=message_id,
            member_user_ids=member_user_ids,
            task_preview=task_preview,
        )
