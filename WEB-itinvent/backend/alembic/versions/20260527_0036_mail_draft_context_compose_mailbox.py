"""mail_draft_context compose_mailbox_id

Revision ID: 20260527_0036
Revises: 20260527_0035
Create Date: 2026-05-27 14:00:00.000000
"""
from __future__ import annotations

from alembic import op
import sqlalchemy as sa


revision = "20260527_0036"
down_revision = "20260527_0035"
branch_labels = None
depends_on = None


def _scope() -> str:
    return str(op.get_context().config.attributes.get("itinvent_scope", "all") or "all").strip().lower()


def _schema(name: str) -> str | None:
    return name if op.get_bind().dialect.name == "postgresql" else None


def _has_column(schema: str | None, table_name: str, column_name: str) -> bool:
    bind = op.get_bind()
    inspector = sa.inspect(bind)
    if not inspector.has_table(table_name, schema=schema):
        return False
    return any(str(col.get("name") or "") == column_name for col in inspector.get_columns(table_name, schema=schema))


def upgrade() -> None:
    if _scope() == "chat":
        return
    app_schema = _schema("app")
    if not _has_column(app_schema, "mail_draft_context", "compose_mailbox_id"):
        op.add_column(
            "mail_draft_context",
            sa.Column("compose_mailbox_id", sa.Text(), nullable=True),
            schema=app_schema,
        )


def downgrade() -> None:
    if _scope() == "chat":
        return
    app_schema = _schema("app")
    if _has_column(app_schema, "mail_draft_context", "compose_mailbox_id"):
        op.drop_column("mail_draft_context", "compose_mailbox_id", schema=app_schema)
