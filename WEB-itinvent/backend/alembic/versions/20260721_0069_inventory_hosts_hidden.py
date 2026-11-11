"""inventory hosts soft-hide columns

Revision ID: 20260721_0069
Revises: 20260716_0068
Create Date: 2026-07-21 14:10:00.000000
"""
from __future__ import annotations

from alembic import op
import sqlalchemy as sa


revision = "20260721_0069"
down_revision = "20260716_0068"
branch_labels = None
depends_on = None


def _scope() -> str:
    return str(op.get_context().config.attributes.get("itinvent_scope", "all") or "all").strip().lower()


def _schema(name: str) -> str | None:
    return name if op.get_bind().dialect.name == "postgresql" else None


def _has_table(schema: str | None, table_name: str) -> bool:
    return sa.inspect(op.get_bind()).has_table(table_name, schema=schema)


def _column_names(schema: str | None, table_name: str) -> set[str]:
    inspector = sa.inspect(op.get_bind())
    if not inspector.has_table(table_name, schema=schema):
        return set()
    return {str(item.get("name") or "").strip() for item in inspector.get_columns(table_name, schema=schema)}


def _index_names(schema: str | None, table_name: str) -> set[str]:
    inspector = sa.inspect(op.get_bind())
    if not inspector.has_table(table_name, schema=schema):
        return set()
    return {str(item.get("name") or "").strip() for item in inspector.get_indexes(table_name, schema=schema)}


def upgrade() -> None:
    if _scope() == "chat":
        return

    app_schema = _schema("app")
    if not _has_table(app_schema, "inventory_hosts"):
        return

    columns = _column_names(app_schema, "inventory_hosts")
    if "hidden_at" not in columns:
        op.add_column(
            "inventory_hosts",
            sa.Column("hidden_at", sa.Integer(), nullable=True),
            schema=app_schema,
        )
    if "hidden_by" not in columns:
        op.add_column(
            "inventory_hosts",
            sa.Column("hidden_by", sa.String(length=255), nullable=True),
            schema=app_schema,
        )
    if "hidden_reason" not in columns:
        op.add_column(
            "inventory_hosts",
            sa.Column("hidden_reason", sa.String(length=255), nullable=True),
            schema=app_schema,
        )

    indexes = _index_names(app_schema, "inventory_hosts")
    if "ix_app_inventory_hosts_hidden_at" not in indexes:
        op.create_index(
            "ix_app_inventory_hosts_hidden_at",
            "inventory_hosts",
            ["hidden_at"],
            unique=False,
            schema=app_schema,
        )


def downgrade() -> None:
    if _scope() == "chat":
        return

    app_schema = _schema("app")
    if not _has_table(app_schema, "inventory_hosts"):
        return

    indexes = _index_names(app_schema, "inventory_hosts")
    if "ix_app_inventory_hosts_hidden_at" in indexes:
        op.drop_index("ix_app_inventory_hosts_hidden_at", table_name="inventory_hosts", schema=app_schema)

    columns = _column_names(app_schema, "inventory_hosts")
    if "hidden_reason" in columns:
        op.drop_column("inventory_hosts", "hidden_reason", schema=app_schema)
    if "hidden_by" in columns:
        op.drop_column("inventory_hosts", "hidden_by", schema=app_schema)
    if "hidden_at" in columns:
        op.drop_column("inventory_hosts", "hidden_at", schema=app_schema)
