"""Add one durable Excalidraw scene per HUB task.

Revision ID: 20260827_0104
Revises: 20260823_0103
"""
from __future__ import annotations

from alembic import op
import sqlalchemy as sa


revision = "20260827_0104"
down_revision = "20260823_0103"
branch_labels = None
depends_on = None


def _scope() -> str:
    return str(op.get_context().config.attributes.get("itinvent_scope", "all") or "all").strip().lower()


def _schema() -> str | None:
    return "app" if op.get_bind().dialect.name == "postgresql" else None


def upgrade() -> None:
    if _scope() == "chat":
        return
    schema = _schema()
    if not op.get_context().as_sql and sa.inspect(op.get_bind()).has_table("hub_task_canvases", schema=schema):
        return
    op.create_table(
        "hub_task_canvases",
        sa.Column("task_id", sa.Text(), nullable=False),
        sa.Column(
            "scene_json",
            sa.Text(),
            nullable=False,
            server_default=sa.text("'{\"elements\":[],\"appState\":{},\"files\":{}}'"),
        ),
        sa.Column("revision", sa.Integer(), nullable=False, server_default="0"),
        sa.Column("updated_by_user_id", sa.Integer(), nullable=True),
        sa.Column("updated_by_username", sa.Text(), nullable=False, server_default=""),
        sa.Column("created_at", sa.Text(), nullable=False),
        sa.Column("updated_at", sa.Text(), nullable=False),
        sa.PrimaryKeyConstraint("task_id"),
        schema=schema,
    )


def downgrade() -> None:
    if _scope() == "chat":
        return
    schema = _schema()
    if not op.get_context().as_sql and not sa.inspect(op.get_bind()).has_table("hub_task_canvases", schema=schema):
        return
    op.drop_table("hub_task_canvases", schema=schema)
