"""add equipment recent acts

Revision ID: 20260716_0068
Revises: 20260714_0067
Create Date: 2026-07-16 10:30:00.000000
"""
from __future__ import annotations

from alembic import op
import sqlalchemy as sa


revision = "20260716_0068"
down_revision = "20260714_0067"
branch_labels = None
depends_on = None


def _scope() -> str:
    return str(op.get_context().config.attributes.get("itinvent_scope", "all") or "all").strip().lower()


def _schema(name: str) -> str | None:
    return name if op.get_bind().dialect.name == "postgresql" else None


def _has_table(schema: str | None, table_name: str) -> bool:
    return sa.inspect(op.get_bind()).has_table(table_name, schema=schema)


def _index_names(schema: str | None, table_name: str) -> set[str]:
    inspector = sa.inspect(op.get_bind())
    if not inspector.has_table(table_name, schema=schema):
        return set()
    return {str(item.get("name") or "").strip() for item in inspector.get_indexes(table_name, schema=schema)}


def upgrade() -> None:
    if _scope() == "chat":
        return

    app_schema = _schema("app")
    if not _has_table(app_schema, "equipment_recent_acts"):
        op.create_table(
            "equipment_recent_acts",
            sa.Column("id", sa.Integer(), autoincrement=True, nullable=False),
            sa.Column("user_id", sa.Integer(), nullable=False),
            sa.Column("db_id", sa.String(length=128), nullable=False),
            sa.Column("doc_no", sa.Integer(), nullable=False),
            sa.Column("doc_number", sa.String(length=128), nullable=False),
            sa.Column("last_action", sa.String(length=64), nullable=False),
            sa.Column("last_action_label", sa.String(length=120), nullable=False),
            sa.Column("snapshot_json", sa.Text(), nullable=False),
            sa.Column("activity_count", sa.Integer(), nullable=False),
            sa.Column("created_at", sa.DateTime(timezone=True), nullable=False),
            sa.Column("last_activity_at", sa.DateTime(timezone=True), nullable=False),
            sa.PrimaryKeyConstraint("id"),
            sa.UniqueConstraint("user_id", "db_id", "doc_no", name="uq_app_equipment_recent_acts_user_db_doc"),
            schema=app_schema,
        )

    indexes = _index_names(app_schema, "equipment_recent_acts")
    if "ix_equipment_recent_acts_user_id" not in indexes:
        op.create_index("ix_equipment_recent_acts_user_id", "equipment_recent_acts", ["user_id"], schema=app_schema)
    if "ix_app_equipment_recent_acts_user_db_activity" not in indexes:
        op.create_index(
            "ix_app_equipment_recent_acts_user_db_activity",
            "equipment_recent_acts",
            ["user_id", "db_id", "last_activity_at"],
            schema=app_schema,
        )
    if "ix_app_equipment_recent_acts_user_activity" not in indexes:
        op.create_index(
            "ix_app_equipment_recent_acts_user_activity",
            "equipment_recent_acts",
            ["user_id", "last_activity_at"],
            schema=app_schema,
        )


def downgrade() -> None:
    if _scope() == "chat":
        return

    app_schema = _schema("app")
    if not _has_table(app_schema, "equipment_recent_acts"):
        return

    indexes = _index_names(app_schema, "equipment_recent_acts")
    for index_name in (
        "ix_app_equipment_recent_acts_user_activity",
        "ix_app_equipment_recent_acts_user_db_activity",
        "ix_equipment_recent_acts_user_id",
    ):
        if index_name in indexes:
            op.drop_index(index_name, table_name="equipment_recent_acts", schema=app_schema)
    op.drop_table("equipment_recent_acts", schema=app_schema)
