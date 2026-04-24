"""SQLAlchemy models for the chat domain."""
from __future__ import annotations

from datetime import datetime, timezone

from sqlalchemy import (
    BigInteger,
    Boolean,
    DateTime,
    ForeignKey,
    Index,
    Integer,
    String,
    Text,
    UniqueConstraint,
)
from sqlalchemy.orm import DeclarativeBase, Mapped, mapped_column


def utcnow() -> datetime:
    return datetime.now(timezone.utc)


class Base(DeclarativeBase):
    """Declarative base for chat tables."""


CHAT_SCHEMA = "chat"


def _table_args(*constraints, schema: str | None = None):
    if schema:
        if constraints:
            return (*constraints, {"schema": schema})
        return {"schema": schema}
    if constraints:
        return constraints
    return ()


def _chat_fk(table_name: str, column_name: str = "id") -> str:
    if CHAT_SCHEMA:
        return f"{CHAT_SCHEMA}.{table_name}.{column_name}"
    return f"{table_name}.{column_name}"


class ChatConversation(Base):
    __tablename__ = "chat_conversations"
    __table_args__ = _table_args(schema=CHAT_SCHEMA)

    id: Mapped[str] = mapped_column(String(36), primary_key=True)
    kind: Mapped[str] = mapped_column(String(20), nullable=False, index=True)
    direct_key: Mapped[str | None] = mapped_column(String(64), nullable=True, unique=True, index=True)
    title: Mapped[str | None] = mapped_column(String(255), nullable=True)
    created_by_user_id: Mapped[int] = mapped_column(Integer, nullable=False, index=True)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), nullable=False, default=utcnow)
    updated_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), nullable=False, default=utcnow)
    last_message_id: Mapped[str | None] = mapped_column(String(36), nullable=True, index=True)
    last_message_seq: Mapped[int] = mapped_column(BigInteger, nullable=False, default=0)
    last_message_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True, index=True)
    is_archived: Mapped[bool] = mapped_column(Boolean, nullable=False, default=False)


class ChatMember(Base):
    __tablename__ = "chat_members"
    __table_args__ = _table_args(
        UniqueConstraint("conversation_id", "user_id", name="uq_chat_members_conversation_user"),
        Index("ix_chat_members_user_id_left_at_conversation_id", "user_id", "left_at", "conversation_id"),
        Index("ix_chat_members_conversation_id_left_at_user_id", "conversation_id", "left_at", "user_id"),
        schema=CHAT_SCHEMA,
    )

    id: Mapped[int] = mapped_column(Integer, primary_key=True, autoincrement=True)
    conversation_id: Mapped[str] = mapped_column(
        String(36),
        ForeignKey(_chat_fk("chat_conversations"), ondelete="CASCADE"),
        nullable=False,
        index=True,
    )
    user_id: Mapped[int] = mapped_column(Integer, nullable=False, index=True)
    member_role: Mapped[str] = mapped_column(String(20), nullable=False, default="member")
    joined_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), nullable=False, default=utcnow)
    left_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)


class ChatMessage(Base):
    __tablename__ = "chat_messages"
    __table_args__ = _table_args(
        Index("ix_chat_messages_conversation_id_created_at_id", "conversation_id", "created_at", "id"),
        Index("ix_chat_messages_conversation_id_conversation_seq", "conversation_id", "conversation_seq"),
        UniqueConstraint(
            "conversation_id",
            "sender_user_id",
            "client_message_id",
            name="uq_chat_messages_conversation_sender_client_message",
        ),
        UniqueConstraint(
            "conversation_id",
            "conversation_seq",
            name="uq_chat_messages_conversation_seq",
        ),
        schema=CHAT_SCHEMA,
    )

    id: Mapped[str] = mapped_column(String(36), primary_key=True)
    conversation_id: Mapped[str] = mapped_column(
        String(36),
        ForeignKey(_chat_fk("chat_conversations"), ondelete="CASCADE"),
        nullable=False,
        index=True,
    )
    sender_user_id: Mapped[int] = mapped_column(Integer, nullable=False, index=True)
    kind: Mapped[str] = mapped_column(String(20), nullable=False, default="text", index=True)
    body_format: Mapped[str] = mapped_column(String(16), nullable=False, default="plain", index=True)
    body: Mapped[str] = mapped_column(Text, nullable=False)
    conversation_seq: Mapped[int] = mapped_column(BigInteger, nullable=False, default=0)
    client_message_id: Mapped[str | None] = mapped_column(String(128), nullable=True, index=True)
    reply_to_message_id: Mapped[str | None] = mapped_column(String(36), nullable=True, index=True)
    forward_from_message_id: Mapped[str | None] = mapped_column(String(36), nullable=True, index=True)
    task_id: Mapped[str | None] = mapped_column(String(64), nullable=True, index=True)
    task_preview_json: Mapped[str | None] = mapped_column(Text, nullable=True)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), nullable=False, default=utcnow, index=True)
    edited_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)


class ChatMessageAttachment(Base):
    __tablename__ = "chat_message_attachments"
    __table_args__ = _table_args(schema=CHAT_SCHEMA)

    id: Mapped[str] = mapped_column(String(36), primary_key=True)
    message_id: Mapped[str] = mapped_column(
        String(36),
        ForeignKey(_chat_fk("chat_messages"), ondelete="CASCADE"),
        nullable=False,
        index=True,
    )
    conversation_id: Mapped[str] = mapped_column(
        String(36),
        ForeignKey(_chat_fk("chat_conversations"), ondelete="CASCADE"),
        nullable=False,
        index=True,
    )
    storage_name: Mapped[str] = mapped_column(String(255), nullable=False)
    file_name: Mapped[str] = mapped_column(String(255), nullable=False)
    mime_type: Mapped[str | None] = mapped_column(String(255), nullable=True)
    file_size: Mapped[int] = mapped_column(Integer, nullable=False, default=0)
    width: Mapped[int | None] = mapped_column(Integer, nullable=True)
    height: Mapped[int | None] = mapped_column(Integer, nullable=True)
    uploaded_by_user_id: Mapped[int] = mapped_column(Integer, nullable=False, index=True)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), nullable=False, default=utcnow, index=True)


class ChatMessageRead(Base):
    __tablename__ = "chat_message_reads"
    __table_args__ = _table_args(
        UniqueConstraint(
            "conversation_id",
            "user_id",
            "message_id",
            name="uq_chat_message_reads_conversation_user_message",
        ),
        schema=CHAT_SCHEMA,
    )

    id: Mapped[int] = mapped_column(Integer, primary_key=True, autoincrement=True)
    conversation_id: Mapped[str] = mapped_column(
        String(36),
        ForeignKey(_chat_fk("chat_conversations"), ondelete="CASCADE"),
        nullable=False,
        index=True,
    )
    user_id: Mapped[int] = mapped_column(Integer, nullable=False, index=True)
    message_id: Mapped[str] = mapped_column(
        String(36),
        ForeignKey(_chat_fk("chat_messages"), ondelete="CASCADE"),
        nullable=False,
        index=True,
    )
    read_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), nullable=False, default=utcnow)


class ChatConversationUserState(Base):
    __tablename__ = "chat_conversation_user_state"
    __table_args__ = _table_args(
        UniqueConstraint(
            "conversation_id",
            "user_id",
            name="uq_chat_conversation_user_state_conversation_user",
        ),
        schema=CHAT_SCHEMA,
    )

    id: Mapped[int] = mapped_column(Integer, primary_key=True, autoincrement=True)
    conversation_id: Mapped[str] = mapped_column(
        String(36),
        ForeignKey(_chat_fk("chat_conversations"), ondelete="CASCADE"),
        nullable=False,
        index=True,
    )
    user_id: Mapped[int] = mapped_column(Integer, nullable=False, index=True)
    last_read_message_id: Mapped[str | None] = mapped_column(String(36), nullable=True)
    last_read_seq: Mapped[int] = mapped_column(BigInteger, nullable=False, default=0)
    last_read_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)
    unread_count: Mapped[int] = mapped_column(Integer, nullable=False, default=0)
    is_pinned: Mapped[bool] = mapped_column(Boolean, nullable=False, default=False)
    is_muted: Mapped[bool] = mapped_column(Boolean, nullable=False, default=False)
    is_archived: Mapped[bool] = mapped_column(Boolean, nullable=False, default=False)
    opened_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)
    updated_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), nullable=False, default=utcnow)


class ChatPushSubscription(Base):
    __tablename__ = "chat_push_subscriptions"
    __table_args__ = _table_args(
        UniqueConstraint("endpoint", name="uq_chat_push_subscriptions_endpoint"),
        schema=CHAT_SCHEMA,
    )

    id: Mapped[int] = mapped_column(Integer, primary_key=True, autoincrement=True)
    user_id: Mapped[int] = mapped_column(Integer, nullable=False, index=True)
    endpoint: Mapped[str] = mapped_column(String(2048), nullable=False)
    p256dh_key: Mapped[str] = mapped_column(String(512), nullable=False)
    auth_key: Mapped[str] = mapped_column(String(512), nullable=False)
    expiration_time: Mapped[int | None] = mapped_column(Integer, nullable=True)
    user_agent: Mapped[str | None] = mapped_column(String(512), nullable=True)
    platform: Mapped[str | None] = mapped_column(String(128), nullable=True)
    browser_family: Mapped[str | None] = mapped_column(String(64), nullable=True)
    install_mode: Mapped[str | None] = mapped_column(String(64), nullable=True)
    is_active: Mapped[bool] = mapped_column(Boolean, nullable=False, default=True, index=True)
    failure_count: Mapped[int] = mapped_column(Integer, nullable=False, default=0)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), nullable=False, default=utcnow)
    updated_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), nullable=False, default=utcnow)
    last_seen_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)
    last_push_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)
    last_error_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)
    last_error_text: Mapped[str | None] = mapped_column(Text, nullable=True)


class ChatPushOutbox(Base):
    __tablename__ = "chat_push_outbox"
    __table_args__ = _table_args(
        UniqueConstraint(
            "message_id",
            "recipient_user_id",
            "channel",
            name="uq_chat_push_outbox_message_recipient_channel",
        ),
        Index("ix_chat_push_outbox_status_next_attempt_at", "status", "next_attempt_at"),
        Index("ix_chat_push_outbox_recipient_user_id_status", "recipient_user_id", "status"),
        Index("ix_chat_push_outbox_updated_at", "updated_at"),
        schema=CHAT_SCHEMA,
    )

    id: Mapped[int] = mapped_column(Integer, primary_key=True, autoincrement=True)
    message_id: Mapped[str] = mapped_column(String(36), nullable=False, index=True)
    conversation_id: Mapped[str] = mapped_column(String(36), nullable=False, index=True)
    recipient_user_id: Mapped[int] = mapped_column(Integer, nullable=False, index=True)
    channel: Mapped[str] = mapped_column(String(32), nullable=False, default="chat")
    title: Mapped[str] = mapped_column(String(255), nullable=False)
    body: Mapped[str] = mapped_column(Text, nullable=False)
    status: Mapped[str] = mapped_column(String(32), nullable=False, default="queued", index=True)
    attempt_count: Mapped[int] = mapped_column(Integer, nullable=False, default=0)
    next_attempt_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), nullable=False, default=utcnow)
    last_error: Mapped[str | None] = mapped_column(Text, nullable=True)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), nullable=False, default=utcnow)
    updated_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), nullable=False, default=utcnow)


class ChatEventOutbox(Base):
    __tablename__ = "chat_event_outbox"
    __table_args__ = _table_args(
        UniqueConstraint("dedupe_key", name="uq_chat_event_outbox_dedupe_key"),
        Index("ix_chat_event_outbox_status_next_attempt_at", "status", "next_attempt_at"),
        Index("ix_chat_event_outbox_target_user_id_status", "target_user_id", "status"),
        Index("ix_chat_event_outbox_updated_at", "updated_at"),
        schema=CHAT_SCHEMA,
    )

    id: Mapped[int] = mapped_column(Integer, primary_key=True, autoincrement=True)
    event_type: Mapped[str] = mapped_column(String(64), nullable=False, index=True)
    target_scope: Mapped[str] = mapped_column(String(16), nullable=False, default="inbox")
    target_user_id: Mapped[int] = mapped_column(Integer, nullable=False, index=True)
    conversation_id: Mapped[str | None] = mapped_column(String(36), nullable=True, index=True)
    message_id: Mapped[str | None] = mapped_column(String(36), nullable=True, index=True)
    payload_json: Mapped[str] = mapped_column(Text, nullable=False, default="{}")
    dedupe_key: Mapped[str | None] = mapped_column(String(255), nullable=True)
    status: Mapped[str] = mapped_column(String(32), nullable=False, default="queued", index=True)
    attempt_count: Mapped[int] = mapped_column(Integer, nullable=False, default=0)
    next_attempt_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), nullable=False, default=utcnow)
    last_error: Mapped[str | None] = mapped_column(Text, nullable=True)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), nullable=False, default=utcnow)
    updated_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), nullable=False, default=utcnow)
