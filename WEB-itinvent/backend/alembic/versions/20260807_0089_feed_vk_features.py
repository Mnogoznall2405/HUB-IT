"""Add lifecycle, discussions, reactions and navigation to the company feed.

Revision ID: 20260807_0089
Revises: 20260806_0088
Create Date: 2026-08-07 10:00:00.000000
"""
from __future__ import annotations

from datetime import datetime, timezone

from alembic import op
import sqlalchemy as sa


revision = "20260807_0089"
down_revision = "20260806_0088"
branch_labels = None
depends_on = None


def _scope() -> str:
    return str(op.get_context().config.attributes.get("itinvent_scope", "all") or "all").strip().lower()


def _schema() -> str | None:
    return "app" if op.get_bind().dialect.name == "postgresql" else None


def _table(name: str) -> str:
    schema = _schema()
    return f'"{schema}"."{name}"' if schema else f'"{name}"'


def _columns(table: str) -> set[str]:
    return {column["name"] for column in sa.inspect(op.get_bind()).get_columns(table, schema=_schema())}


def _add_column(table: str, column: sa.Column) -> None:
    if column.name not in _columns(table):
        op.add_column(table, column, schema=_schema())


def _create_table(name: str, *columns: sa.SchemaItem) -> None:
    if not sa.inspect(op.get_bind()).has_table(name, schema=_schema()):
        op.create_table(name, *columns, schema=_schema())


def upgrade() -> None:
    if _scope() == "chat":
        return
    schema = _schema()

    _add_column("hub_announcements", sa.Column("status", sa.Text(), nullable=False, server_default="published"))
    _add_column("hub_announcements", sa.Column("comments_enabled", sa.Integer(), nullable=False, server_default="1"))
    _add_column("hub_announcements", sa.Column("reactions_enabled", sa.Integer(), nullable=False, server_default="1"))
    _add_column("hub_announcements", sa.Column("publication_notified_at", sa.Text(), nullable=True))
    _add_column("hub_announcements", sa.Column("category_id", sa.Text(), nullable=True))

    _add_column("hub_announcement_attachments", sa.Column("sort_order", sa.Integer(), nullable=False, server_default="0"))
    _add_column("hub_announcement_attachments", sa.Column("is_cover", sa.Integer(), nullable=False, server_default="0"))

    _add_column("hub_announcement_comments", sa.Column("parent_comment_id", sa.Text(), nullable=True))
    _add_column("hub_announcement_comments", sa.Column("root_comment_id", sa.Text(), nullable=True))
    _add_column("hub_announcement_comments", sa.Column("reply_to_user_id", sa.Integer(), nullable=True))
    _add_column("hub_announcement_comments", sa.Column("reply_to_username", sa.Text(), nullable=False, server_default=""))
    _add_column("hub_announcement_comments", sa.Column("deleted_at", sa.Text(), nullable=True))
    _add_column("hub_announcement_comments", sa.Column("deleted_by_user_id", sa.Integer(), nullable=True))
    _add_column("hub_announcement_comments", sa.Column("change_version", sa.Integer(), nullable=False, server_default="1"))

    _create_table(
        "hub_announcement_reactions",
        sa.Column("announcement_id", sa.Text(), nullable=False),
        sa.Column("user_id", sa.Integer(), nullable=False),
        sa.Column("reaction_type", sa.Text(), nullable=False),
        sa.Column("username", sa.Text(), nullable=False, server_default=""),
        sa.Column("full_name", sa.Text(), nullable=False, server_default=""),
        sa.Column("created_at", sa.Text(), nullable=False),
        sa.Column("updated_at", sa.Text(), nullable=False),
        sa.PrimaryKeyConstraint("announcement_id", "user_id"),
    )
    _create_table(
        "hub_announcement_comment_reactions",
        sa.Column("comment_id", sa.Text(), nullable=False),
        sa.Column("user_id", sa.Integer(), nullable=False),
        sa.Column("reaction_type", sa.Text(), nullable=False),
        sa.Column("username", sa.Text(), nullable=False, server_default=""),
        sa.Column("full_name", sa.Text(), nullable=False, server_default=""),
        sa.Column("created_at", sa.Text(), nullable=False),
        sa.Column("updated_at", sa.Text(), nullable=False),
        sa.PrimaryKeyConstraint("comment_id", "user_id"),
    )
    _create_table(
        "hub_announcement_comment_attachments",
        sa.Column("id", sa.Text(), nullable=False),
        sa.Column("comment_id", sa.Text(), nullable=False),
        sa.Column("announcement_id", sa.Text(), nullable=False),
        sa.Column("file_name", sa.Text(), nullable=False),
        sa.Column("file_path", sa.Text(), nullable=False),
        sa.Column("file_mime", sa.Text(), nullable=True),
        sa.Column("file_size", sa.Integer(), nullable=False),
        sa.Column("uploaded_by_user_id", sa.Integer(), nullable=False),
        sa.Column("uploaded_at", sa.Text(), nullable=False),
        sa.PrimaryKeyConstraint("id"),
    )
    _create_table(
        "hub_announcement_comment_mentions",
        sa.Column("comment_id", sa.Text(), nullable=False),
        sa.Column("user_id", sa.Integer(), nullable=False),
        sa.Column("username", sa.Text(), nullable=False, server_default=""),
        sa.Column("full_name", sa.Text(), nullable=False, server_default=""),
        sa.PrimaryKeyConstraint("comment_id", "user_id"),
    )
    _create_table(
        "hub_announcement_categories",
        sa.Column("id", sa.Text(), nullable=False),
        sa.Column("name", sa.Text(), nullable=False),
        sa.Column("slug", sa.Text(), nullable=False),
        sa.Column("is_active", sa.Integer(), nullable=False, server_default="1"),
        sa.Column("created_by_user_id", sa.Integer(), nullable=False),
        sa.Column("created_at", sa.Text(), nullable=False),
        sa.Column("updated_at", sa.Text(), nullable=False),
        sa.PrimaryKeyConstraint("id"),
        sa.UniqueConstraint("slug"),
    )
    _create_table(
        "hub_announcement_tags",
        sa.Column("id", sa.Text(), nullable=False),
        sa.Column("name", sa.Text(), nullable=False),
        sa.Column("slug", sa.Text(), nullable=False),
        sa.Column("created_at", sa.Text(), nullable=False),
        sa.PrimaryKeyConstraint("id"),
        sa.UniqueConstraint("slug"),
    )
    _create_table(
        "hub_announcement_tag_links",
        sa.Column("announcement_id", sa.Text(), nullable=False),
        sa.Column("tag_id", sa.Text(), nullable=False),
        sa.PrimaryKeyConstraint("announcement_id", "tag_id"),
    )
    _create_table(
        "hub_announcement_bookmarks",
        sa.Column("announcement_id", sa.Text(), nullable=False),
        sa.Column("user_id", sa.Integer(), nullable=False),
        sa.Column("created_at", sa.Text(), nullable=False),
        sa.PrimaryKeyConstraint("announcement_id", "user_id"),
    )

    indexes = {
        "idx_hub_announcements_status_due": ("hub_announcements", ["status", "published_from"]),
        "idx_hub_announcement_reactions_announcement": ("hub_announcement_reactions", ["announcement_id", "reaction_type"]),
        "idx_hub_comment_reactions_comment": ("hub_announcement_comment_reactions", ["comment_id", "reaction_type"]),
        "idx_hub_comments_root": ("hub_announcement_comments", ["announcement_id", "root_comment_id", "created_at"]),
        "idx_hub_comment_attachments_comment": ("hub_announcement_comment_attachments", ["comment_id", "uploaded_at"]),
        "idx_hub_bookmarks_user": ("hub_announcement_bookmarks", ["user_id", "created_at"]),
        "idx_hub_tag_links_tag": ("hub_announcement_tag_links", ["tag_id", "announcement_id"]),
    }
    existing_indexes: set[str] = set()
    inspector = sa.inspect(op.get_bind())
    for table, _ in indexes.values():
        existing_indexes.update(index["name"] for index in inspector.get_indexes(table, schema=schema))
    for name, (table, columns) in indexes.items():
        if name not in existing_indexes:
            op.create_index(name, table, columns, unique=False, schema=schema)

    announcements = _table("hub_announcements")
    attachments = _table("hub_announcement_attachments")
    reactions = _table("hub_announcement_reactions")
    likes = _table("hub_announcement_likes")
    now_iso = datetime.now(timezone.utc).isoformat()
    op.get_bind().execute(sa.text(
        f"UPDATE {announcements} SET status = CASE "
        "WHEN is_active = 0 THEN 'archived' "
        "WHEN published_from IS NOT NULL AND published_from > :now_iso THEN 'scheduled' "
        "ELSE 'published' END"
    ), {"now_iso": now_iso})
    op.execute(sa.text(
        f"UPDATE {announcements} SET publication_notified_at = COALESCE(publication_notified_at, published_at, updated_at)"
    ))
    op.execute(sa.text(
        f"INSERT INTO {reactions} (announcement_id, user_id, reaction_type, username, full_name, created_at, updated_at) "
        f"SELECT announcement_id, user_id, 'like', username, full_name, created_at, created_at FROM {likes} "
        "WHERE 1 = 1 "
        "ON CONFLICT (announcement_id, user_id) DO NOTHING"
    ))
    op.execute(sa.text(
        f"UPDATE {attachments} SET sort_order = COALESCE((SELECT COUNT(*) - 1 FROM {attachments} prior "
        f"WHERE prior.announcement_id = {attachments}.announcement_id AND prior.uploaded_at <= {attachments}.uploaded_at), 0)"
    ))
    op.execute(sa.text(
        f"UPDATE {attachments} SET is_cover = 1 WHERE id IN (SELECT MIN(id) FROM {attachments} "
        "WHERE lower(COALESCE(file_mime, '')) LIKE 'image/%' GROUP BY announcement_id)"
    ))


def downgrade() -> None:
    if _scope() == "chat":
        return
    schema = _schema()
    for table in (
        "hub_announcement_bookmarks",
        "hub_announcement_tag_links",
        "hub_announcement_tags",
        "hub_announcement_categories",
        "hub_announcement_comment_mentions",
        "hub_announcement_comment_attachments",
        "hub_announcement_comment_reactions",
        "hub_announcement_reactions",
    ):
        if sa.inspect(op.get_bind()).has_table(table, schema=schema):
            op.drop_table(table, schema=schema)
    for table, columns in (
        ("hub_announcement_comments", ["change_version", "deleted_by_user_id", "deleted_at", "reply_to_username", "reply_to_user_id", "root_comment_id", "parent_comment_id"]),
        ("hub_announcement_attachments", ["is_cover", "sort_order"]),
        ("hub_announcements", ["category_id", "publication_notified_at", "reactions_enabled", "comments_enabled", "status"]),
    ):
        current = _columns(table)
        for column in columns:
            if column in current:
                op.drop_column(table, column, schema=schema)
