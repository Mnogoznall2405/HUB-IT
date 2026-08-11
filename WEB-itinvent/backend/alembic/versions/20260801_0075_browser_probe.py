"""browser probe visits + media tables

Revision ID: 20260801_0075
Revises: 20260731_0074
Create Date: 2026-08-01 00:00:00.000000
"""
from __future__ import annotations

from alembic import op
import sqlalchemy as sa


revision = "20260801_0075"
down_revision = "20260731_0074"
branch_labels = None
depends_on = None


def _scope() -> str:
    return str(op.get_context().config.attributes.get("itinvent_scope", "all") or "all").strip().lower()


def _schema() -> str | None:
    return "app" if op.get_bind().dialect.name == "postgresql" else None


def _has_table(schema: str | None, table_name: str) -> bool:
    return sa.inspect(op.get_bind()).has_table(table_name, schema=schema)


def upgrade() -> None:
    if _scope() == "chat":
        return
    schema = _schema()

    if not _has_table(schema, "browser_probe_visits"):
        op.create_table(
            "browser_probe_visits",
            sa.Column("id", sa.String(length=512), nullable=False),
            sa.Column("computer_name", sa.String(length=255), nullable=False),
            sa.Column("windows_user", sa.String(length=255), nullable=False, server_default=""),
            sa.Column("browser", sa.String(length=32), nullable=False, server_default=""),
            sa.Column("profile", sa.String(length=128), nullable=False, server_default=""),
            sa.Column("visit_id", sa.String(length=64), nullable=False, server_default=""),
            sa.Column("url", sa.Text(), nullable=False, server_default=""),
            sa.Column("title", sa.String(length=512), nullable=False, server_default=""),
            sa.Column("domain", sa.String(length=255), nullable=False, server_default=""),
            sa.Column("category", sa.String(length=32), nullable=False, server_default="other"),
            sa.Column("visited_at", sa.DateTime(timezone=True), nullable=True),
            sa.Column("dwell_sec", sa.Float(), nullable=True),
            sa.Column("screenshot_file", sa.String(length=512), nullable=False, server_default=""),
            sa.Column("created_at", sa.DateTime(timezone=True), nullable=False),
            sa.PrimaryKeyConstraint("id", name="pk_app_browser_probe_visits"),
            sa.UniqueConstraint(
                "computer_name",
                "browser",
                "profile",
                "visit_id",
                name="uq_app_browser_probe_visits_host_visit",
            ),
            schema=schema,
        )
        op.create_index(
            "ix_app_browser_probe_visits_computer_visited",
            "browser_probe_visits",
            ["computer_name", "visited_at"],
            schema=schema,
        )
        op.create_index(
            "ix_app_browser_probe_visits_category",
            "browser_probe_visits",
            ["category"],
            schema=schema,
        )

    if not _has_table(schema, "browser_probe_media"):
        op.create_table(
            "browser_probe_media",
            sa.Column("id", sa.String(length=512), nullable=False),
            sa.Column("computer_name", sa.String(length=255), nullable=False),
            sa.Column("file_name", sa.String(length=512), nullable=False),
            sa.Column("content", sa.LargeBinary(), nullable=True),
            sa.Column(
                "content_type",
                sa.String(length=128),
                nullable=False,
                server_default="application/octet-stream",
            ),
            sa.Column("created_at", sa.DateTime(timezone=True), nullable=False),
            sa.PrimaryKeyConstraint("id", name="pk_app_browser_probe_media"),
            sa.UniqueConstraint(
                "computer_name",
                "file_name",
                name="uq_app_browser_probe_media_host_file",
            ),
            schema=schema,
        )
        op.create_index(
            "ix_app_browser_probe_media_computer",
            "browser_probe_media",
            ["computer_name"],
            schema=schema,
        )


def downgrade() -> None:
    if _scope() == "chat":
        return
    schema = _schema()
    for table in ("browser_probe_media", "browser_probe_visits"):
        if _has_table(schema, table):
            op.drop_table(table, schema=schema)
