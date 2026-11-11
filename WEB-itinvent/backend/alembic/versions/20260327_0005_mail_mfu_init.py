"""Create mail and MFU runtime tables."""
from __future__ import annotations

from alembic import op
import sqlalchemy as sa


revision = "20260327_0005"
down_revision = "20260327_0004"
branch_labels = None
depends_on = None


def _scope() -> str:
    return str(op.get_context().config.attributes.get("itinvent_scope", "all") or "all").strip().lower()


def _schema(name: str) -> str | None:
    bind = op.get_bind()
    if bind.dialect.name == "postgresql":
        return name
    return None


def upgrade() -> None:
    if _scope() == "chat":
        return
    app_schema = _schema("app")
    system_schema = _schema("system")

    op.create_table(
        "mail_it_templates",
        sa.Column("id", sa.Text(), nullable=False),
        sa.Column("code", sa.Text(), nullable=False),
        sa.Column("title", sa.Text(), nullable=False),
        sa.Column("category", sa.Text(), nullable=False, server_default=""),
        sa.Column("subject_template", sa.Text(), nullable=False),
        sa.Column("body_template_md", sa.Text(), nullable=False, server_default=""),
        sa.Column("required_fields_json", sa.Text(), nullable=False, server_default="[]"),
        sa.Column("is_active", sa.Integer(), nullable=False, server_default="1"),
        sa.Column("created_by_user_id", sa.Integer(), nullable=False, server_default="0"),
        sa.Column("created_by_username", sa.Text(), nullable=False, server_default=""),
        sa.Column("updated_by_user_id", sa.Integer(), nullable=False, server_default="0"),
        sa.Column("updated_by_username", sa.Text(), nullable=False, server_default=""),
        sa.Column("created_at", sa.Text(), nullable=False),
        sa.Column("updated_at", sa.Text(), nullable=False),
        sa.PrimaryKeyConstraint("id"),
        sa.UniqueConstraint("code", name="uq_mail_it_templates_code"),
        schema=app_schema,
    )
    op.create_index(
        "idx_mail_it_templates_active",
        "mail_it_templates",
        ["is_active", "updated_at"],
        unique=False,
        schema=app_schema,
    )

    op.create_table(
        "mail_messages_log",
        sa.Column("id", sa.Text(), nullable=False),
        sa.Column("user_id", sa.Integer(), nullable=False, server_default="0"),
        sa.Column("username", sa.Text(), nullable=False, server_default=""),
        sa.Column("direction", sa.Text(), nullable=False, server_default="outgoing"),
        sa.Column("folder_hint", sa.Text(), nullable=False, server_default=""),
        sa.Column("subject", sa.Text(), nullable=False, server_default=""),
        sa.Column("recipients_json", sa.Text(), nullable=False, server_default="[]"),
        sa.Column("sent_at", sa.Text(), nullable=False),
        sa.Column("status", sa.Text(), nullable=False, server_default="sent"),
        sa.Column("exchange_item_id", sa.Text(), nullable=True),
        sa.Column("error_text", sa.Text(), nullable=True),
        sa.PrimaryKeyConstraint("id"),
        schema=app_schema,
    )
    op.create_index(
        "idx_mail_messages_log_user_time",
        "mail_messages_log",
        ["user_id", "sent_at"],
        unique=False,
        schema=app_schema,
    )

    op.create_table(
        "mail_restore_hints",
        sa.Column("user_id", sa.Integer(), nullable=False),
        sa.Column("trash_exchange_id", sa.Text(), nullable=False),
        sa.Column("restore_folder", sa.Text(), nullable=False, server_default="inbox"),
        sa.Column("source_exchange_id", sa.Text(), nullable=True),
        sa.Column("created_at", sa.Text(), nullable=False),
        sa.PrimaryKeyConstraint("user_id", "trash_exchange_id"),
        schema=app_schema,
    )
    op.create_index(
        "idx_mail_restore_hints_created",
        "mail_restore_hints",
        ["created_at"],
        unique=False,
        schema=app_schema,
    )

    op.create_table(
        "mail_draft_context",
        sa.Column("draft_exchange_id", sa.Text(), nullable=False),
        sa.Column("user_id", sa.Integer(), nullable=False, server_default="0"),
        sa.Column("compose_mode", sa.Text(), nullable=False, server_default="draft"),
        sa.Column("reply_to_message_id", sa.Text(), nullable=True),
        sa.Column("forward_message_id", sa.Text(), nullable=True),
        sa.Column("updated_at", sa.Text(), nullable=False),
        sa.PrimaryKeyConstraint("draft_exchange_id"),
        schema=app_schema,
    )
    op.create_index(
        "idx_mail_draft_context_user_updated",
        "mail_draft_context",
        ["user_id", "updated_at"],
        unique=False,
        schema=app_schema,
    )

    op.create_table(
        "mail_folder_favorites",
        sa.Column("user_id", sa.Integer(), nullable=False),
        sa.Column("folder_id", sa.Text(), nullable=False),
        sa.Column("created_at", sa.Text(), nullable=False),
        sa.PrimaryKeyConstraint("user_id", "folder_id"),
        schema=app_schema,
    )
    op.create_index(
        "idx_mail_folder_favorites_user_created",
        "mail_folder_favorites",
        ["user_id", "created_at"],
        unique=False,
        schema=app_schema,
    )

    op.create_table(
        "mail_visible_custom_folders",
        sa.Column("user_id", sa.Integer(), nullable=False),
        sa.Column("folder_id", sa.Text(), nullable=False),
        sa.Column("created_at", sa.Text(), nullable=False),
        sa.PrimaryKeyConstraint("user_id", "folder_id"),
        schema=app_schema,
    )
    op.create_index(
        "idx_mail_visible_custom_folders_user_created",
        "mail_visible_custom_folders",
        ["user_id", "created_at"],
        unique=False,
        schema=app_schema,
    )

    op.create_table(
        "mail_user_preferences",
        sa.Column("user_id", sa.Integer(), nullable=False),
        sa.Column("prefs_json", sa.Text(), nullable=False, server_default="{}"),
        sa.Column("updated_at", sa.Text(), nullable=False),
        sa.PrimaryKeyConstraint("user_id"),
        schema=app_schema,
    )

    op.create_table(
        "mfu_runtime_state",
        sa.Column("device_key", sa.Text(), nullable=False),
        sa.Column("ip_address", sa.Text(), nullable=True),
        sa.Column("timeout_total", sa.Integer(), nullable=False, server_default="0"),
        sa.Column("timeout_streak", sa.Integer(), nullable=False, server_default="0"),
        sa.Column("next_retry_at", sa.Text(), nullable=True),
        sa.Column("runtime_json", sa.Text(), nullable=True),
        sa.Column("updated_at", sa.Text(), nullable=False),
        sa.PrimaryKeyConstraint("device_key"),
        schema=system_schema,
    )
    op.create_index(
        "idx_mfu_runtime_state_updated_at",
        "mfu_runtime_state",
        ["updated_at"],
        unique=False,
        schema=system_schema,
    )

    op.create_table(
        "mfu_page_snapshots",
        sa.Column("device_key", sa.Text(), nullable=False),
        sa.Column("snapshot_date", sa.Text(), nullable=False),
        sa.Column("page_total", sa.Integer(), nullable=False),
        sa.Column("page_oid", sa.Text(), nullable=True),
        sa.Column("snmp_checked_at", sa.Text(), nullable=True),
        sa.Column("created_at", sa.Text(), nullable=False),
        sa.Column("updated_at", sa.Text(), nullable=False),
        sa.PrimaryKeyConstraint("device_key", "snapshot_date"),
        schema=system_schema,
    )
    op.create_index(
        "idx_mfu_page_snapshots_snapshot_date",
        "mfu_page_snapshots",
        ["snapshot_date"],
        unique=False,
        schema=system_schema,
    )
    op.create_index(
        "idx_mfu_page_snapshots_device_date",
        "mfu_page_snapshots",
        ["device_key", "snapshot_date"],
        unique=False,
        schema=system_schema,
    )

    op.create_table(
        "mfu_page_baseline",
        sa.Column("device_key", sa.Text(), nullable=False),
        sa.Column("baseline_date", sa.Text(), nullable=False),
        sa.Column("created_at", sa.Text(), nullable=False),
        sa.Column("updated_at", sa.Text(), nullable=False),
        sa.PrimaryKeyConstraint("device_key"),
        schema=system_schema,
    )
    op.create_index(
        "idx_mfu_page_baseline_baseline_date",
        "mfu_page_baseline",
        ["baseline_date"],
        unique=False,
        schema=system_schema,
    )


def downgrade() -> None:
    if _scope() == "chat":
        return
    app_schema = _schema("app")
    system_schema = _schema("system")

    op.drop_index("idx_mfu_page_baseline_baseline_date", table_name="mfu_page_baseline", schema=system_schema)
    op.drop_table("mfu_page_baseline", schema=system_schema)
    op.drop_index("idx_mfu_page_snapshots_device_date", table_name="mfu_page_snapshots", schema=system_schema)
    op.drop_index("idx_mfu_page_snapshots_snapshot_date", table_name="mfu_page_snapshots", schema=system_schema)
    op.drop_table("mfu_page_snapshots", schema=system_schema)
    op.drop_index("idx_mfu_runtime_state_updated_at", table_name="mfu_runtime_state", schema=system_schema)
    op.drop_table("mfu_runtime_state", schema=system_schema)

    op.drop_table("mail_user_preferences", schema=app_schema)
    op.drop_index(
        "idx_mail_visible_custom_folders_user_created",
        table_name="mail_visible_custom_folders",
        schema=app_schema,
    )
    op.drop_table("mail_visible_custom_folders", schema=app_schema)
    op.drop_index(
        "idx_mail_folder_favorites_user_created",
        table_name="mail_folder_favorites",
        schema=app_schema,
    )
    op.drop_table("mail_folder_favorites", schema=app_schema)
    op.drop_index(
        "idx_mail_draft_context_user_updated",
        table_name="mail_draft_context",
        schema=app_schema,
    )
    op.drop_table("mail_draft_context", schema=app_schema)
    op.drop_index("idx_mail_restore_hints_created", table_name="mail_restore_hints", schema=app_schema)
    op.drop_table("mail_restore_hints", schema=app_schema)
    op.drop_index("idx_mail_messages_log_user_time", table_name="mail_messages_log", schema=app_schema)
    op.drop_table("mail_messages_log", schema=app_schema)
    op.drop_index("idx_mail_it_templates_active", table_name="mail_it_templates", schema=app_schema)
    op.drop_table("mail_it_templates", schema=app_schema)
