"""Chat message sequence counters and unread state."""
from __future__ import annotations

from alembic import op
import sqlalchemy as sa


revision = "20260418_0021"
down_revision = "20260418_0020"
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
    bind = op.get_bind()
    chat_schema = _schema("chat")
    dialect = bind.dialect.name

    op.add_column(
        "chat_conversations",
        sa.Column("last_message_seq", sa.BigInteger(), nullable=False, server_default="0"),
        schema=chat_schema,
    )
    op.create_index(
        "idx_chat_conversations_last_message_seq",
        "chat_conversations",
        ["last_message_seq"],
        unique=False,
        schema=chat_schema,
    )

    op.add_column(
        "chat_messages",
        sa.Column("conversation_seq", sa.BigInteger(), nullable=False, server_default="0"),
        schema=chat_schema,
    )
    op.create_index(
        "idx_chat_messages_conversation_id_conversation_seq",
        "chat_messages",
        ["conversation_id", "conversation_seq"],
        unique=False,
        schema=chat_schema,
    )
    op.create_unique_constraint(
        "uq_chat_messages_conversation_seq",
        "chat_messages",
        ["conversation_id", "conversation_seq"],
        schema=chat_schema,
    )

    op.add_column(
        "chat_conversation_user_state",
        sa.Column("last_read_seq", sa.BigInteger(), nullable=False, server_default="0"),
        schema=chat_schema,
    )
    op.add_column(
        "chat_conversation_user_state",
        sa.Column("unread_count", sa.Integer(), nullable=False, server_default="0"),
        schema=chat_schema,
    )
    op.create_index(
        "idx_chat_conversation_user_state_last_read_seq",
        "chat_conversation_user_state",
        ["last_read_seq"],
        unique=False,
        schema=chat_schema,
    )
    op.create_index(
        "idx_chat_conversation_user_state_unread_count",
        "chat_conversation_user_state",
        ["unread_count"],
        unique=False,
        schema=chat_schema,
    )

    if dialect == "postgresql":
        prefix = f"{chat_schema}." if chat_schema else ""
        op.execute(
            sa.text(
                f"""
                UPDATE {prefix}chat_messages current_messages
                SET conversation_seq = seq_table.row_num
                FROM (
                    SELECT id, ROW_NUMBER() OVER (
                        PARTITION BY conversation_id
                        ORDER BY created_at ASC, id ASC
                    ) AS row_num
                    FROM {prefix}chat_messages
                ) AS seq_table
                WHERE current_messages.id = seq_table.id
                """
            )
        )
        op.execute(
            sa.text(
                f"""
                UPDATE {prefix}chat_conversations conv
                SET last_message_seq = COALESCE(msg.max_seq, 0)
                FROM (
                    SELECT conversation_id, MAX(conversation_seq) AS max_seq
                    FROM {prefix}chat_messages
                    GROUP BY conversation_id
                ) AS msg
                WHERE conv.id = msg.conversation_id
                """
            )
        )
        op.execute(
            sa.text(
                f"""
                UPDATE {prefix}chat_conversation_user_state state
                SET last_read_seq = COALESCE(msg.conversation_seq, 0)
                FROM {prefix}chat_messages msg
                WHERE state.last_read_message_id IS NOT NULL
                  AND msg.id = state.last_read_message_id
                """
            )
        )
        op.execute(
            sa.text(
                f"""
                UPDATE {prefix}chat_conversation_user_state state
                SET unread_count = GREATEST(
                    COALESCE(conv.last_message_seq, 0) - COALESCE(state.last_read_seq, 0),
                    0
                )
                FROM {prefix}chat_conversations conv
                WHERE conv.id = state.conversation_id
                """
            )
        )

    op.alter_column("chat_conversations", "last_message_seq", server_default=None, schema=chat_schema)
    op.alter_column("chat_messages", "conversation_seq", server_default=None, schema=chat_schema)
    op.alter_column("chat_conversation_user_state", "last_read_seq", server_default=None, schema=chat_schema)
    op.alter_column("chat_conversation_user_state", "unread_count", server_default=None, schema=chat_schema)


def downgrade() -> None:
    if _scope() == "app":
        return
    chat_schema = _schema("chat")

    op.drop_index(
        "idx_chat_conversation_user_state_unread_count",
        table_name="chat_conversation_user_state",
        schema=chat_schema,
    )
    op.drop_index(
        "idx_chat_conversation_user_state_last_read_seq",
        table_name="chat_conversation_user_state",
        schema=chat_schema,
    )
    op.drop_column("chat_conversation_user_state", "unread_count", schema=chat_schema)
    op.drop_column("chat_conversation_user_state", "last_read_seq", schema=chat_schema)

    op.drop_constraint(
        "uq_chat_messages_conversation_seq",
        "chat_messages",
        schema=chat_schema,
        type_="unique",
    )
    op.drop_index(
        "idx_chat_messages_conversation_id_conversation_seq",
        table_name="chat_messages",
        schema=chat_schema,
    )
    op.drop_column("chat_messages", "conversation_seq", schema=chat_schema)

    op.drop_index(
        "idx_chat_conversations_last_message_seq",
        table_name="chat_conversations",
        schema=chat_schema,
    )
    op.drop_column("chat_conversations", "last_message_seq", schema=chat_schema)
