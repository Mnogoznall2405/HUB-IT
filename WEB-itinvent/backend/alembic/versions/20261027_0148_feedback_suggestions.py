"""Add feedback_suggestions (user improvement suggestions for the portal).

Revision ID: 20261027_0148
Revises: 20261027_0147

Created "if missing". The API answers 503 until this migration is applied explicitly at release time;
nothing else in the application depends on the table.
"""
from __future__ import annotations

from alembic import op
import sqlalchemy as sa


revision = "20261027_0148"
down_revision = "20261027_0147"
branch_labels = None
depends_on = None

TABLE_NAME = "feedback_suggestions"
INDEX_USER_CREATED = "ix_app_feedback_suggestions_user_created"
INDEX_STATUS_CREATED = "ix_app_feedback_suggestions_status_created"


def _scope() -> str:
    return str(op.get_context().config.attributes.get("itinvent_scope", "all") or "all").strip().lower()


def _schema() -> str | None:
    return "app" if op.get_bind().dialect.name == "postgresql" else None


def _has_table(schema: str | None, table_name: str) -> bool:
    return sa.inspect(op.get_bind()).has_table(table_name, schema=schema)


def _has_index(schema: str | None, table_name: str, index_name: str) -> bool:
    if not _has_table(schema, table_name):
        return False
    return any(
        str(item.get("name") or "").strip().lower() == index_name.lower()
        for item in sa.inspect(op.get_bind()).get_indexes(table_name, schema=schema)
    )


def upgrade() -> None:
    if _scope() == "chat":
        return
    schema = _schema()
    if not _has_table(schema, TABLE_NAME):
        op.create_table(
            TABLE_NAME,
            sa.Column("id", sa.String(36), nullable=False),
            sa.Column("user_id", sa.Integer(), nullable=False),
            sa.Column("category", sa.String(32), nullable=False),
            sa.Column("title", sa.String(120), nullable=False),
            sa.Column("message", sa.Text(), nullable=False),
            sa.Column("section", sa.String(64), nullable=True),
            sa.Column("status", sa.String(32), server_default="new", nullable=False),
            sa.Column("admin_note", sa.String(1000), nullable=True),
            sa.Column("handled_by_user_id", sa.Integer(), nullable=True),
            sa.Column("created_at", sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False),
            sa.Column("updated_at", sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False),
            sa.PrimaryKeyConstraint("id"),
            schema=schema,
        )
    if not _has_index(schema, TABLE_NAME, INDEX_USER_CREATED):
        op.create_index(INDEX_USER_CREATED, TABLE_NAME, ["user_id", "created_at"], schema=schema)
    if not _has_index(schema, TABLE_NAME, INDEX_STATUS_CREATED):
        op.create_index(INDEX_STATUS_CREATED, TABLE_NAME, ["status", "created_at"], schema=schema)


def downgrade() -> None:
    # Drops the suggestions and their history. Run only as an explicit rollback decision.
    if _scope() == "chat":
        return
    schema = _schema()
    if _has_table(schema, TABLE_NAME):
        op.drop_table(TABLE_NAME, schema=schema)
