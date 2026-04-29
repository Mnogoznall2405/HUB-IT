"""Chat push outbox and client message idempotency."""
from __future__ import annotations

from alembic import op
import sqlalchemy as sa


revision = "20260418_0020"
down_revision = "20260417_0019"
branch_labels = None
depends_on = None


def _schema(name: str) -> str | None:
    bind = op.get_bind()
    if bind.dialect.name == "postgresql":
        return name
    return None


def _scope() -> str:
    return str(op.get_context().config.attributes.get("itinvent_scope", "all") or "all").strip().lower()


def upgrade() -> None:
    if _scope() == "app":
        return
    chat_schema = _schema("chat")

    op.add_column(
        "chat_messages",
        sa.Column("client_message_id", sa.String(length=128), nullable=True),
        schema=chat_schema,
    )
    op.create_index(
        "idx_chat_messages_client_message_id",
        "chat_messages",
        ["client_message_id"],
        unique=False,
        schema=chat_schema,
    )
    op.create_unique_constraint(
        "uq_chat_messages_conversation_sender_client_message",
        "chat_messages",
        ["conversation_id", "sender_user_id", "client_message_id"],
        schema=chat_schema,
    )

    op.create_table(
        "chat_push_outbox",
        sa.Column("id", sa.Integer(), autoincrement=True, nullable=False),
        sa.Column("message_id", sa.String(length=36), nullable=False),
        sa.Column("conversation_id", sa.String(length=36), nullable=False),
        sa.Column("recipient_user_id", sa.Integer(), nullable=False),
        sa.Column("channel", sa.String(length=32), nullable=False),
        sa.Column("title", sa.String(length=255), nullable=False),
        sa.Column("body", sa.Text(), nullable=False),
        sa.Column("status", sa.String(length=32), nullable=False),
        sa.Column("attempt_count", sa.Integer(), nullable=False),
        sa.Column("next_attempt_at", sa.DateTime(timezone=True), nullable=False),
        sa.Column("last_error", sa.Text(), nullable=True),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False),
        sa.Column("updated_at", sa.DateTime(timezone=True), nullable=False),
        sa.PrimaryKeyConstraint("id"),
        sa.UniqueConstraint(
            "message_id",
            "recipient_user_id",
            "channel",
            name="uq_chat_push_outbox_message_recipient_channel",
        ),
        schema=chat_schema,
    )
    op.create_index(
        "ix_chat_push_outbox_message_id",
        "chat_push_outbox",
        ["message_id"],
        unique=False,
        schema=chat_schema,
    )
    op.create_index(
        "ix_chat_push_outbox_conversation_id",
        "chat_push_outbox",
        ["conversation_id"],
        unique=False,
        schema=chat_schema,
    )
    op.create_index(
        "ix_chat_push_outbox_recipient_user_id",
        "chat_push_outbox",
        ["recipient_user_id"],
        unique=False,
        schema=chat_schema,
    )
    op.create_index(
        "ix_chat_push_outbox_status",
        "chat_push_outbox",
        ["status"],
        unique=False,
        schema=chat_schema,
    )
    op.create_index(
        "ix_chat_push_outbox_status_next_attempt_at",
        "chat_push_outbox",
        ["status", "next_attempt_at"],
        unique=False,
        schema=chat_schema,
    )
    op.create_index(
        "ix_chat_push_outbox_recipient_user_id_status",
        "chat_push_outbox",
        ["recipient_user_id", "status"],
        unique=False,
        schema=chat_schema,
    )
    op.create_index(
        "ix_chat_push_outbox_updated_at",
        "chat_push_outbox",
        ["updated_at"],
        unique=False,
        schema=chat_schema,
    )


def downgrade() -> None:
    if _scope() == "app":
        return
    chat_schema = _schema("chat")

    op.drop_index("ix_chat_push_outbox_updated_at", table_name="chat_push_outbox", schema=chat_schema)
    op.drop_index("ix_chat_push_outbox_recipient_user_id_status", table_name="chat_push_outbox", schema=chat_schema)
    op.drop_index("ix_chat_push_outbox_status_next_attempt_at", table_name="chat_push_outbox", schema=chat_schema)
    op.drop_index("ix_chat_push_outbox_status", table_name="chat_push_outbox", schema=chat_schema)
    op.drop_index("ix_chat_push_outbox_recipient_user_id", table_name="chat_push_outbox", schema=chat_schema)
    op.drop_index("ix_chat_push_outbox_conversation_id", table_name="chat_push_outbox", schema=chat_schema)
    op.drop_index("ix_chat_push_outbox_message_id", table_name="chat_push_outbox", schema=chat_schema)
    op.drop_table("chat_push_outbox", schema=chat_schema)

    op.drop_constraint(
        "uq_chat_messages_conversation_sender_client_message",
        "chat_messages",
        schema=chat_schema,
        type_="unique",
    )
    op.drop_index("idx_chat_messages_client_message_id", table_name="chat_messages", schema=chat_schema)
    op.drop_column("chat_messages", "client_message_id", schema=chat_schema)
