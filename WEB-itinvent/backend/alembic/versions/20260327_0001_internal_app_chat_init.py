"""Initial unified internal app/chat/system schemas."""
from __future__ import annotations

from alembic import op
import sqlalchemy as sa


revision = "20260327_0001"
down_revision = None
branch_labels = None
depends_on = None


def _schema(name: str) -> str | None:
    bind = op.get_bind()
    if bind.dialect.name == "postgresql":
        return name
    return None


def _remote(schema: str | None, table_name: str, column_name: str = "id") -> str:
    if schema:
        return f"{schema}.{table_name}.{column_name}"
    return f"{table_name}.{column_name}"


def upgrade() -> None:
    app_schema = _schema("app")
    chat_schema = _schema("chat")
    system_schema = _schema("system")

    if app_schema:
        op.execute(sa.text('CREATE SCHEMA IF NOT EXISTS "app"'))
    if chat_schema:
        op.execute(sa.text('CREATE SCHEMA IF NOT EXISTS "chat"'))
    if system_schema:
        op.execute(sa.text('CREATE SCHEMA IF NOT EXISTS "system"'))

    op.create_table(
        "users",
        sa.Column("id", sa.Integer(), nullable=False),
        sa.Column("username", sa.String(length=50), nullable=False),
        sa.Column("email", sa.String(length=255), nullable=True),
        sa.Column("full_name", sa.String(length=255), nullable=True),
        sa.Column("is_active", sa.Boolean(), nullable=False),
        sa.Column("role", sa.String(length=20), nullable=False),
        sa.Column("use_custom_permissions", sa.Boolean(), nullable=False),
        sa.Column("custom_permissions_json", sa.Text(), nullable=False),
        sa.Column("auth_source", sa.String(length=20), nullable=False),
        sa.Column("telegram_id", sa.Integer(), nullable=True),
        sa.Column("assigned_database", sa.String(length=128), nullable=True),
        sa.Column("mailbox_email", sa.String(length=255), nullable=True),
        sa.Column("mailbox_login", sa.String(length=255), nullable=True),
        sa.Column("mailbox_password_enc", sa.Text(), nullable=False),
        sa.Column("mail_signature_html", sa.Text(), nullable=True),
        sa.Column("mail_updated_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("password_hash", sa.Text(), nullable=False),
        sa.Column("password_salt", sa.Text(), nullable=False),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False),
        sa.Column("updated_at", sa.DateTime(timezone=True), nullable=False),
        sa.PrimaryKeyConstraint("id"),
        sa.UniqueConstraint("username", name="uq_app_users_username"),
        schema=app_schema,
    )
    op.create_index("ix_app_users_username", "users", ["username"], unique=False, schema=app_schema)
    op.create_index("ix_app_users_is_active", "users", ["is_active"], unique=False, schema=app_schema)
    op.create_index("ix_app_users_telegram_id", "users", ["telegram_id"], unique=False, schema=app_schema)

    op.create_table(
        "sessions",
        sa.Column("session_id", sa.String(length=64), nullable=False),
        sa.Column("user_id", sa.Integer(), nullable=False),
        sa.Column("username", sa.String(length=50), nullable=False),
        sa.Column("role", sa.String(length=20), nullable=False),
        sa.Column("ip_address", sa.String(length=128), nullable=False),
        sa.Column("user_agent", sa.Text(), nullable=False),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False),
        sa.Column("last_seen_at", sa.DateTime(timezone=True), nullable=False),
        sa.Column("expires_at", sa.DateTime(timezone=True), nullable=False),
        sa.Column("idle_expires_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("is_active", sa.Boolean(), nullable=False),
        sa.Column("status", sa.String(length=32), nullable=False),
        sa.Column("closed_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("closed_reason", sa.String(length=32), nullable=True),
        sa.Column("device_label", sa.String(length=255), nullable=True),
        sa.PrimaryKeyConstraint("session_id"),
        schema=app_schema,
    )
    op.create_index("ix_app_sessions_user_id", "sessions", ["user_id"], unique=False, schema=app_schema)
    op.create_index("ix_app_sessions_username", "sessions", ["username"], unique=False, schema=app_schema)
    op.create_index("ix_app_sessions_is_active", "sessions", ["is_active"], unique=False, schema=app_schema)
    op.create_index("ix_app_sessions_status", "sessions", ["status"], unique=False, schema=app_schema)

    op.create_table(
        "user_settings",
        sa.Column("user_id", sa.Integer(), nullable=False),
        sa.Column("pinned_database", sa.String(length=128), nullable=True),
        sa.Column("theme_mode", sa.String(length=16), nullable=False),
        sa.Column("font_family", sa.String(length=32), nullable=False),
        sa.Column("font_scale", sa.Float(), nullable=False),
        sa.Column("updated_at", sa.DateTime(timezone=True), nullable=False),
        sa.PrimaryKeyConstraint("user_id"),
        schema=app_schema,
    )

    op.create_table(
        "app_settings",
        sa.Column("key", sa.String(length=128), nullable=False),
        sa.Column("value_json", sa.Text(), nullable=False),
        sa.Column("updated_at", sa.DateTime(timezone=True), nullable=False),
        sa.PrimaryKeyConstraint("key"),
        schema=app_schema,
    )

    op.create_table(
        "user_db_selection",
        sa.Column("telegram_id", sa.Integer(), nullable=False),
        sa.Column("database_id", sa.String(length=128), nullable=False),
        sa.Column("updated_at", sa.DateTime(timezone=True), nullable=False),
        sa.PrimaryKeyConstraint("telegram_id"),
        schema=app_schema,
    )

    op.create_table(
        "migration_checkpoints",
        sa.Column("key", sa.String(length=128), nullable=False),
        sa.Column("value_json", sa.Text(), nullable=False),
        sa.Column("updated_at", sa.DateTime(timezone=True), nullable=False),
        sa.PrimaryKeyConstraint("key"),
        schema=system_schema,
    )

    op.create_table(
        "chat_conversations",
        sa.Column("id", sa.String(length=36), nullable=False),
        sa.Column("kind", sa.String(length=20), nullable=False),
        sa.Column("direct_key", sa.String(length=64), nullable=True),
        sa.Column("title", sa.String(length=255), nullable=True),
        sa.Column("created_by_user_id", sa.Integer(), nullable=False),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False),
        sa.Column("updated_at", sa.DateTime(timezone=True), nullable=False),
        sa.Column("last_message_id", sa.String(length=36), nullable=True),
        sa.Column("last_message_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("is_archived", sa.Boolean(), nullable=False),
        sa.PrimaryKeyConstraint("id"),
        schema=chat_schema,
    )
    op.create_index("ix_chat_conversations_kind", "chat_conversations", ["kind"], unique=False, schema=chat_schema)
    op.create_index(
        "ix_chat_conversations_direct_key",
        "chat_conversations",
        ["direct_key"],
        unique=True,
        schema=chat_schema,
    )
    op.create_index(
        "ix_chat_conversations_last_message_id",
        "chat_conversations",
        ["last_message_id"],
        unique=False,
        schema=chat_schema,
    )
    op.create_index(
        "ix_chat_conversations_last_message_at",
        "chat_conversations",
        ["last_message_at"],
        unique=False,
        schema=chat_schema,
    )

    op.create_table(
        "chat_members",
        sa.Column("id", sa.Integer(), autoincrement=True, nullable=False),
        sa.Column("conversation_id", sa.String(length=36), nullable=False),
        sa.Column("user_id", sa.Integer(), nullable=False),
        sa.Column("member_role", sa.String(length=20), nullable=False),
        sa.Column("joined_at", sa.DateTime(timezone=True), nullable=False),
        sa.Column("left_at", sa.DateTime(timezone=True), nullable=True),
        sa.ForeignKeyConstraint(["conversation_id"], [_remote(chat_schema, "chat_conversations")], ondelete="CASCADE"),
        sa.PrimaryKeyConstraint("id"),
        sa.UniqueConstraint("conversation_id", "user_id", name="uq_chat_members_conversation_user"),
        schema=chat_schema,
    )
    op.create_index("ix_chat_members_conversation_id", "chat_members", ["conversation_id"], unique=False, schema=chat_schema)
    op.create_index("ix_chat_members_user_id", "chat_members", ["user_id"], unique=False, schema=chat_schema)

    op.create_table(
        "chat_messages",
        sa.Column("id", sa.String(length=36), nullable=False),
        sa.Column("conversation_id", sa.String(length=36), nullable=False),
        sa.Column("sender_user_id", sa.Integer(), nullable=False),
        sa.Column("kind", sa.String(length=20), nullable=False),
        sa.Column("body", sa.Text(), nullable=False),
        sa.Column("reply_to_message_id", sa.String(length=36), nullable=True),
        sa.Column("task_id", sa.String(length=64), nullable=True),
        sa.Column("task_preview_json", sa.Text(), nullable=True),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False),
        sa.Column("edited_at", sa.DateTime(timezone=True), nullable=True),
        sa.ForeignKeyConstraint(["conversation_id"], [_remote(chat_schema, "chat_conversations")], ondelete="CASCADE"),
        sa.PrimaryKeyConstraint("id"),
        schema=chat_schema,
    )
    op.create_index("ix_chat_messages_conversation_id", "chat_messages", ["conversation_id"], unique=False, schema=chat_schema)
    op.create_index("ix_chat_messages_sender_user_id", "chat_messages", ["sender_user_id"], unique=False, schema=chat_schema)
    op.create_index("ix_chat_messages_kind", "chat_messages", ["kind"], unique=False, schema=chat_schema)
    op.create_index("ix_chat_messages_reply_to_message_id", "chat_messages", ["reply_to_message_id"], unique=False, schema=chat_schema)
    op.create_index("ix_chat_messages_task_id", "chat_messages", ["task_id"], unique=False, schema=chat_schema)
    op.create_index("ix_chat_messages_created_at", "chat_messages", ["created_at"], unique=False, schema=chat_schema)

    op.create_table(
        "chat_message_attachments",
        sa.Column("id", sa.String(length=36), nullable=False),
        sa.Column("message_id", sa.String(length=36), nullable=False),
        sa.Column("conversation_id", sa.String(length=36), nullable=False),
        sa.Column("storage_name", sa.String(length=255), nullable=False),
        sa.Column("file_name", sa.String(length=255), nullable=False),
        sa.Column("mime_type", sa.String(length=255), nullable=True),
        sa.Column("file_size", sa.Integer(), nullable=False),
        sa.Column("uploaded_by_user_id", sa.Integer(), nullable=False),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False),
        sa.ForeignKeyConstraint(["conversation_id"], [_remote(chat_schema, "chat_conversations")], ondelete="CASCADE"),
        sa.ForeignKeyConstraint(["message_id"], [_remote(chat_schema, "chat_messages")], ondelete="CASCADE"),
        sa.PrimaryKeyConstraint("id"),
        schema=chat_schema,
    )
    op.create_index(
        "ix_chat_message_attachments_message_id",
        "chat_message_attachments",
        ["message_id"],
        unique=False,
        schema=chat_schema,
    )
    op.create_index(
        "ix_chat_message_attachments_conversation_id",
        "chat_message_attachments",
        ["conversation_id"],
        unique=False,
        schema=chat_schema,
    )
    op.create_index(
        "ix_chat_message_attachments_uploaded_by_user_id",
        "chat_message_attachments",
        ["uploaded_by_user_id"],
        unique=False,
        schema=chat_schema,
    )
    op.create_index(
        "ix_chat_message_attachments_created_at",
        "chat_message_attachments",
        ["created_at"],
        unique=False,
        schema=chat_schema,
    )

    op.create_table(
        "chat_message_reads",
        sa.Column("id", sa.Integer(), autoincrement=True, nullable=False),
        sa.Column("conversation_id", sa.String(length=36), nullable=False),
        sa.Column("user_id", sa.Integer(), nullable=False),
        sa.Column("message_id", sa.String(length=36), nullable=False),
        sa.Column("read_at", sa.DateTime(timezone=True), nullable=False),
        sa.ForeignKeyConstraint(["conversation_id"], [_remote(chat_schema, "chat_conversations")], ondelete="CASCADE"),
        sa.ForeignKeyConstraint(["message_id"], [_remote(chat_schema, "chat_messages")], ondelete="CASCADE"),
        sa.PrimaryKeyConstraint("id"),
        sa.UniqueConstraint(
            "conversation_id",
            "user_id",
            "message_id",
            name="uq_chat_message_reads_conversation_user_message",
        ),
        schema=chat_schema,
    )
    op.create_index(
        "ix_chat_message_reads_conversation_id",
        "chat_message_reads",
        ["conversation_id"],
        unique=False,
        schema=chat_schema,
    )
    op.create_index("ix_chat_message_reads_user_id", "chat_message_reads", ["user_id"], unique=False, schema=chat_schema)
    op.create_index("ix_chat_message_reads_message_id", "chat_message_reads", ["message_id"], unique=False, schema=chat_schema)

    op.create_table(
        "chat_conversation_user_state",
        sa.Column("id", sa.Integer(), autoincrement=True, nullable=False),
        sa.Column("conversation_id", sa.String(length=36), nullable=False),
        sa.Column("user_id", sa.Integer(), nullable=False),
        sa.Column("last_read_message_id", sa.String(length=36), nullable=True),
        sa.Column("last_read_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("is_pinned", sa.Boolean(), nullable=False),
        sa.Column("is_muted", sa.Boolean(), nullable=False),
        sa.Column("is_archived", sa.Boolean(), nullable=False),
        sa.Column("opened_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("updated_at", sa.DateTime(timezone=True), nullable=False),
        sa.ForeignKeyConstraint(["conversation_id"], [_remote(chat_schema, "chat_conversations")], ondelete="CASCADE"),
        sa.PrimaryKeyConstraint("id"),
        sa.UniqueConstraint("conversation_id", "user_id", name="uq_chat_conversation_user_state_conversation_user"),
        schema=chat_schema,
    )
    op.create_index(
        "ix_chat_conversation_user_state_conversation_id",
        "chat_conversation_user_state",
        ["conversation_id"],
        unique=False,
        schema=chat_schema,
    )
    op.create_index(
        "ix_chat_conversation_user_state_user_id",
        "chat_conversation_user_state",
        ["user_id"],
        unique=False,
        schema=chat_schema,
    )
    op.create_index(
        "idx_chat_conversation_user_state_is_archived",
        "chat_conversation_user_state",
        ["is_archived"],
        unique=False,
        schema=chat_schema,
    )

    op.create_table(
        "chat_push_subscriptions",
        sa.Column("id", sa.Integer(), autoincrement=True, nullable=False),
        sa.Column("user_id", sa.Integer(), nullable=False),
        sa.Column("endpoint", sa.String(length=2048), nullable=False),
        sa.Column("p256dh_key", sa.String(length=512), nullable=False),
        sa.Column("auth_key", sa.String(length=512), nullable=False),
        sa.Column("expiration_time", sa.Integer(), nullable=True),
        sa.Column("user_agent", sa.String(length=512), nullable=True),
        sa.Column("platform", sa.String(length=128), nullable=True),
        sa.Column("browser_family", sa.String(length=64), nullable=True),
        sa.Column("install_mode", sa.String(length=64), nullable=True),
        sa.Column("is_active", sa.Boolean(), nullable=False),
        sa.Column("failure_count", sa.Integer(), nullable=False),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False),
        sa.Column("updated_at", sa.DateTime(timezone=True), nullable=False),
        sa.Column("last_seen_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("last_push_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("last_error_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("last_error_text", sa.Text(), nullable=True),
        sa.PrimaryKeyConstraint("id"),
        sa.UniqueConstraint("endpoint", name="uq_chat_push_subscriptions_endpoint"),
        schema=chat_schema,
    )
    op.create_index(
        "ix_chat_push_subscriptions_user_id",
        "chat_push_subscriptions",
        ["user_id"],
        unique=False,
        schema=chat_schema,
    )
    op.create_index(
        "ix_chat_push_subscriptions_is_active",
        "chat_push_subscriptions",
        ["is_active"],
        unique=False,
        schema=chat_schema,
    )


def downgrade() -> None:
    app_schema = _schema("app")
    chat_schema = _schema("chat")
    system_schema = _schema("system")

    op.drop_index("ix_chat_push_subscriptions_is_active", table_name="chat_push_subscriptions", schema=chat_schema)
    op.drop_index("ix_chat_push_subscriptions_user_id", table_name="chat_push_subscriptions", schema=chat_schema)
    op.drop_table("chat_push_subscriptions", schema=chat_schema)

    op.drop_index(
        "idx_chat_conversation_user_state_is_archived",
        table_name="chat_conversation_user_state",
        schema=chat_schema,
    )
    op.drop_index(
        "ix_chat_conversation_user_state_user_id",
        table_name="chat_conversation_user_state",
        schema=chat_schema,
    )
    op.drop_index(
        "ix_chat_conversation_user_state_conversation_id",
        table_name="chat_conversation_user_state",
        schema=chat_schema,
    )
    op.drop_table("chat_conversation_user_state", schema=chat_schema)

    op.drop_index("ix_chat_message_reads_message_id", table_name="chat_message_reads", schema=chat_schema)
    op.drop_index("ix_chat_message_reads_user_id", table_name="chat_message_reads", schema=chat_schema)
    op.drop_index("ix_chat_message_reads_conversation_id", table_name="chat_message_reads", schema=chat_schema)
    op.drop_table("chat_message_reads", schema=chat_schema)

    op.drop_index(
        "ix_chat_message_attachments_created_at",
        table_name="chat_message_attachments",
        schema=chat_schema,
    )
    op.drop_index(
        "ix_chat_message_attachments_uploaded_by_user_id",
        table_name="chat_message_attachments",
        schema=chat_schema,
    )
    op.drop_index(
        "ix_chat_message_attachments_conversation_id",
        table_name="chat_message_attachments",
        schema=chat_schema,
    )
    op.drop_index(
        "ix_chat_message_attachments_message_id",
        table_name="chat_message_attachments",
        schema=chat_schema,
    )
    op.drop_table("chat_message_attachments", schema=chat_schema)

    op.drop_index("ix_chat_messages_created_at", table_name="chat_messages", schema=chat_schema)
    op.drop_index("ix_chat_messages_task_id", table_name="chat_messages", schema=chat_schema)
    op.drop_index("ix_chat_messages_reply_to_message_id", table_name="chat_messages", schema=chat_schema)
    op.drop_index("ix_chat_messages_kind", table_name="chat_messages", schema=chat_schema)
    op.drop_index("ix_chat_messages_sender_user_id", table_name="chat_messages", schema=chat_schema)
    op.drop_index("ix_chat_messages_conversation_id", table_name="chat_messages", schema=chat_schema)
    op.drop_table("chat_messages", schema=chat_schema)

    op.drop_index("ix_chat_members_user_id", table_name="chat_members", schema=chat_schema)
    op.drop_index("ix_chat_members_conversation_id", table_name="chat_members", schema=chat_schema)
    op.drop_table("chat_members", schema=chat_schema)

    op.drop_index("ix_chat_conversations_last_message_at", table_name="chat_conversations", schema=chat_schema)
    op.drop_index("ix_chat_conversations_last_message_id", table_name="chat_conversations", schema=chat_schema)
    op.drop_index("ix_chat_conversations_direct_key", table_name="chat_conversations", schema=chat_schema)
    op.drop_index("ix_chat_conversations_kind", table_name="chat_conversations", schema=chat_schema)
    op.drop_table("chat_conversations", schema=chat_schema)

    op.drop_table("migration_checkpoints", schema=system_schema)
    op.drop_table("user_db_selection", schema=app_schema)
    op.drop_table("app_settings", schema=app_schema)
    op.drop_table("user_settings", schema=app_schema)

    op.drop_index("ix_app_sessions_status", table_name="sessions", schema=app_schema)
    op.drop_index("ix_app_sessions_is_active", table_name="sessions", schema=app_schema)
    op.drop_index("ix_app_sessions_username", table_name="sessions", schema=app_schema)
    op.drop_index("ix_app_sessions_user_id", table_name="sessions", schema=app_schema)
    op.drop_table("sessions", schema=app_schema)

    op.drop_index("ix_app_users_telegram_id", table_name="users", schema=app_schema)
    op.drop_index("ix_app_users_is_active", table_name="users", schema=app_schema)
    op.drop_index("ix_app_users_username", table_name="users", schema=app_schema)
    op.drop_table("users", schema=app_schema)
