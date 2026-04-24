"""Create hub tables in app schema."""
from __future__ import annotations

from alembic import op
import sqlalchemy as sa


revision = "20260327_0002"
down_revision = "20260327_0001"
branch_labels = None
depends_on = None


def _scope() -> str:
    return str(op.get_context().config.attributes.get("itinvent_scope", "all") or "all").strip().lower()


def _schema() -> str | None:
    bind = op.get_bind()
    if bind.dialect.name == "postgresql":
        return "app"
    return None


def upgrade() -> None:
    if _scope() == "chat":
        return
    schema = _schema()

    op.create_table(
        "hub_announcements",
        sa.Column("id", sa.Text(), nullable=False),
        sa.Column("title", sa.Text(), nullable=False),
        sa.Column("preview", sa.Text(), nullable=False),
        sa.Column("body", sa.Text(), nullable=False),
        sa.Column("priority", sa.Text(), nullable=False),
        sa.Column("is_active", sa.Integer(), nullable=False),
        sa.Column("author_user_id", sa.Integer(), nullable=False),
        sa.Column("author_username", sa.Text(), nullable=False),
        sa.Column("author_full_name", sa.Text(), nullable=False),
        sa.Column("published_at", sa.Text(), nullable=False),
        sa.Column("updated_at", sa.Text(), nullable=False),
        sa.Column("version", sa.Integer(), nullable=False),
        sa.Column("audience_scope", sa.Text(), nullable=False),
        sa.Column("audience_roles", sa.Text(), nullable=False),
        sa.Column("audience_user_ids", sa.Text(), nullable=False),
        sa.Column("requires_ack", sa.Integer(), nullable=False),
        sa.Column("is_pinned", sa.Integer(), nullable=False),
        sa.Column("pinned_until", sa.Text(), nullable=True),
        sa.Column("published_from", sa.Text(), nullable=True),
        sa.Column("expires_at", sa.Text(), nullable=True),
        sa.PrimaryKeyConstraint("id"),
        schema=schema,
    )
    op.create_index("idx_hub_announcements_published", "hub_announcements", ["is_active", "published_at"], unique=False, schema=schema)

    op.create_table(
        "hub_announcement_reads",
        sa.Column("announcement_id", sa.Text(), nullable=False),
        sa.Column("user_id", sa.Integer(), nullable=False),
        sa.Column("username", sa.Text(), nullable=False),
        sa.Column("full_name", sa.Text(), nullable=False),
        sa.Column("read_at", sa.Text(), nullable=False),
        sa.Column("seen_version", sa.Integer(), nullable=False),
        sa.Column("acknowledged_version", sa.Integer(), nullable=False),
        sa.Column("acknowledged_at", sa.Text(), nullable=True),
        sa.PrimaryKeyConstraint("announcement_id", "user_id"),
        schema=schema,
    )

    op.create_table(
        "hub_announcement_attachments",
        sa.Column("id", sa.Text(), nullable=False),
        sa.Column("announcement_id", sa.Text(), nullable=False),
        sa.Column("file_name", sa.Text(), nullable=False),
        sa.Column("file_path", sa.Text(), nullable=False),
        sa.Column("file_mime", sa.Text(), nullable=True),
        sa.Column("file_size", sa.Integer(), nullable=False),
        sa.Column("uploaded_by_user_id", sa.Integer(), nullable=False),
        sa.Column("uploaded_by_username", sa.Text(), nullable=False),
        sa.Column("uploaded_at", sa.Text(), nullable=False),
        sa.PrimaryKeyConstraint("id"),
        schema=schema,
    )
    op.create_index("idx_hub_announcement_attachments_announcement", "hub_announcement_attachments", ["announcement_id", "uploaded_at"], unique=False, schema=schema)

    op.create_table(
        "hub_tasks",
        sa.Column("id", sa.Text(), nullable=False),
        sa.Column("title", sa.Text(), nullable=False),
        sa.Column("description", sa.Text(), nullable=False),
        sa.Column("status", sa.Text(), nullable=False),
        sa.Column("due_at", sa.Text(), nullable=True),
        sa.Column("assignee_user_id", sa.Integer(), nullable=False),
        sa.Column("assignee_username", sa.Text(), nullable=False),
        sa.Column("assignee_full_name", sa.Text(), nullable=False),
        sa.Column("controller_user_id", sa.Integer(), nullable=False),
        sa.Column("controller_username", sa.Text(), nullable=False),
        sa.Column("controller_full_name", sa.Text(), nullable=False),
        sa.Column("created_by_user_id", sa.Integer(), nullable=False),
        sa.Column("created_by_username", sa.Text(), nullable=False),
        sa.Column("created_by_full_name", sa.Text(), nullable=False),
        sa.Column("created_at", sa.Text(), nullable=False),
        sa.Column("updated_at", sa.Text(), nullable=False),
        sa.Column("submitted_at", sa.Text(), nullable=True),
        sa.Column("reviewed_at", sa.Text(), nullable=True),
        sa.Column("reviewer_user_id", sa.Integer(), nullable=True),
        sa.Column("reviewer_username", sa.Text(), nullable=True),
        sa.Column("review_comment", sa.Text(), nullable=True),
        sa.Column("priority", sa.Text(), nullable=False),
        sa.Column("reviewer_full_name", sa.Text(), nullable=False),
        sa.PrimaryKeyConstraint("id"),
        schema=schema,
    )
    op.create_index("idx_hub_tasks_assignee", "hub_tasks", ["assignee_user_id", "status", "updated_at"], unique=False, schema=schema)
    op.create_index("idx_hub_tasks_controller", "hub_tasks", ["controller_user_id", "status", "updated_at"], unique=False, schema=schema)

    op.create_table(
        "hub_task_reports",
        sa.Column("id", sa.Text(), nullable=False),
        sa.Column("task_id", sa.Text(), nullable=False),
        sa.Column("comment", sa.Text(), nullable=False),
        sa.Column("file_name", sa.Text(), nullable=True),
        sa.Column("file_path", sa.Text(), nullable=True),
        sa.Column("file_mime", sa.Text(), nullable=True),
        sa.Column("file_size", sa.Integer(), nullable=True),
        sa.Column("uploaded_by_user_id", sa.Integer(), nullable=False),
        sa.Column("uploaded_by_username", sa.Text(), nullable=False),
        sa.Column("uploaded_at", sa.Text(), nullable=False),
        sa.PrimaryKeyConstraint("id"),
        schema=schema,
    )

    op.create_table(
        "hub_task_attachments",
        sa.Column("id", sa.Text(), nullable=False),
        sa.Column("task_id", sa.Text(), nullable=False),
        sa.Column("scope", sa.Text(), nullable=False),
        sa.Column("file_name", sa.Text(), nullable=False),
        sa.Column("file_path", sa.Text(), nullable=False),
        sa.Column("file_mime", sa.Text(), nullable=True),
        sa.Column("file_size", sa.Integer(), nullable=False),
        sa.Column("uploaded_by_user_id", sa.Integer(), nullable=False),
        sa.Column("uploaded_by_username", sa.Text(), nullable=False),
        sa.Column("uploaded_at", sa.Text(), nullable=False),
        sa.PrimaryKeyConstraint("id"),
        schema=schema,
    )
    op.create_index("idx_hub_task_attachments_task", "hub_task_attachments", ["task_id", "uploaded_at"], unique=False, schema=schema)

    op.create_table(
        "hub_task_comment_reads",
        sa.Column("task_id", sa.Text(), nullable=False),
        sa.Column("user_id", sa.Integer(), nullable=False),
        sa.Column("last_seen_comment_id", sa.Text(), nullable=True),
        sa.Column("last_seen_at", sa.Text(), nullable=False),
        sa.PrimaryKeyConstraint("task_id", "user_id"),
        schema=schema,
    )
    op.create_index("idx_hub_task_comment_reads_task", "hub_task_comment_reads", ["task_id", "user_id"], unique=False, schema=schema)

    op.create_table(
        "hub_task_comments",
        sa.Column("id", sa.Text(), nullable=False),
        sa.Column("task_id", sa.Text(), nullable=False),
        sa.Column("user_id", sa.Integer(), nullable=False),
        sa.Column("username", sa.Text(), nullable=False),
        sa.Column("full_name", sa.Text(), nullable=False),
        sa.Column("body", sa.Text(), nullable=False),
        sa.Column("created_at", sa.Text(), nullable=False),
        sa.PrimaryKeyConstraint("id"),
        schema=schema,
    )
    op.create_index("idx_hub_task_comments_task", "hub_task_comments", ["task_id", "created_at"], unique=False, schema=schema)

    op.create_table(
        "hub_task_status_log",
        sa.Column("id", sa.Text(), nullable=False),
        sa.Column("task_id", sa.Text(), nullable=False),
        sa.Column("old_status", sa.Text(), nullable=False),
        sa.Column("new_status", sa.Text(), nullable=False),
        sa.Column("changed_by_user_id", sa.Integer(), nullable=False),
        sa.Column("changed_by_username", sa.Text(), nullable=False),
        sa.Column("changed_at", sa.Text(), nullable=False),
        sa.PrimaryKeyConstraint("id"),
        schema=schema,
    )
    op.create_index("idx_hub_task_status_log_task", "hub_task_status_log", ["task_id", "changed_at"], unique=False, schema=schema)

    op.create_table(
        "hub_notifications",
        sa.Column("id", sa.Text(), nullable=False),
        sa.Column("recipient_user_id", sa.Integer(), nullable=True),
        sa.Column("event_type", sa.Text(), nullable=False),
        sa.Column("title", sa.Text(), nullable=False),
        sa.Column("body", sa.Text(), nullable=False),
        sa.Column("entity_type", sa.Text(), nullable=False),
        sa.Column("entity_id", sa.Text(), nullable=False),
        sa.Column("created_at", sa.Text(), nullable=False),
        sa.PrimaryKeyConstraint("id"),
        schema=schema,
    )
    op.create_index("idx_hub_notifications_recipient", "hub_notifications", ["recipient_user_id", "created_at"], unique=False, schema=schema)

    op.create_table(
        "hub_notification_reads",
        sa.Column("notification_id", sa.Text(), nullable=False),
        sa.Column("user_id", sa.Integer(), nullable=False),
        sa.Column("read_at", sa.Text(), nullable=False),
        sa.PrimaryKeyConstraint("notification_id", "user_id"),
        schema=schema,
    )


def downgrade() -> None:
    if _scope() == "chat":
        return
    schema = _schema()
    op.drop_table("hub_notification_reads", schema=schema)
    op.drop_index("idx_hub_notifications_recipient", table_name="hub_notifications", schema=schema)
    op.drop_table("hub_notifications", schema=schema)
    op.drop_index("idx_hub_task_status_log_task", table_name="hub_task_status_log", schema=schema)
    op.drop_table("hub_task_status_log", schema=schema)
    op.drop_index("idx_hub_task_comments_task", table_name="hub_task_comments", schema=schema)
    op.drop_table("hub_task_comments", schema=schema)
    op.drop_index("idx_hub_task_comment_reads_task", table_name="hub_task_comment_reads", schema=schema)
    op.drop_table("hub_task_comment_reads", schema=schema)
    op.drop_index("idx_hub_task_attachments_task", table_name="hub_task_attachments", schema=schema)
    op.drop_table("hub_task_attachments", schema=schema)
    op.drop_table("hub_task_reports", schema=schema)
    op.drop_index("idx_hub_tasks_controller", table_name="hub_tasks", schema=schema)
    op.drop_index("idx_hub_tasks_assignee", table_name="hub_tasks", schema=schema)
    op.drop_table("hub_tasks", schema=schema)
    op.drop_index("idx_hub_announcement_attachments_announcement", table_name="hub_announcement_attachments", schema=schema)
    op.drop_table("hub_announcement_attachments", schema=schema)
    op.drop_table("hub_announcement_reads", schema=schema)
    op.drop_index("idx_hub_announcements_published", table_name="hub_announcements", schema=schema)
    op.drop_table("hub_announcements", schema=schema)
