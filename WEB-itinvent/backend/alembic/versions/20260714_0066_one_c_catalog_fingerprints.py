"""Store committed 1C catalogue fingerprints for cheap unchanged refreshes.

Revision ID: 20260714_0066
Revises: 20260713_0065
"""
from __future__ import annotations

from alembic import op
import sqlalchemy as sa


revision = "20260714_0066"
down_revision = "20260713_0065"
branch_labels = None
depends_on = None


def _scope() -> str:
    return str(op.get_context().config.attributes.get("itinvent_scope", "all") or "all").strip().lower()


def _schema() -> str | None:
    return "app" if op.get_bind().dialect.name == "postgresql" else None


def _columns(schema: str | None) -> set[str]:
    inspector = sa.inspect(op.get_bind())
    if not inspector.has_table("one_c_catalog_snapshots", schema=schema):
        return set()
    return {str(column.get("name") or "") for column in inspector.get_columns("one_c_catalog_snapshots", schema=schema)}


def upgrade() -> None:
    if _scope() == "chat":
        return
    schema = _schema()
    columns = _columns(schema)
    if not columns:
        return
    if "nomenclature_fingerprint" not in columns:
        op.add_column(
            "one_c_catalog_snapshots",
            sa.Column("nomenclature_fingerprint", sa.String(length=64), nullable=False, server_default=""),
            schema=schema,
        )
    if "warehouses_fingerprint" not in columns:
        op.add_column(
            "one_c_catalog_snapshots",
            sa.Column("warehouses_fingerprint", sa.String(length=64), nullable=False, server_default=""),
            schema=schema,
        )


def downgrade() -> None:
    if _scope() == "chat":
        return
    schema = _schema()
    columns = _columns(schema)
    if "warehouses_fingerprint" in columns:
        op.drop_column("one_c_catalog_snapshots", "warehouses_fingerprint", schema=schema)
    if "nomenclature_fingerprint" in columns:
        op.drop_column("one_c_catalog_snapshots", "nomenclature_fingerprint", schema=schema)
