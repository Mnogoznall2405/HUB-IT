"""Add indexed app-owned 1C catalogue snapshots.

The tables hold only read copies of 1C directories.  They never represent a
command queue and cannot cause a write back to 1C.
"""
from __future__ import annotations

from alembic import op
import sqlalchemy as sa


revision = "20260713_0064"
down_revision = "20260713_0063"
branch_labels = None
depends_on = None


def _scope() -> str:
    return str(op.get_context().config.attributes.get("itinvent_scope", "all") or "all").strip().lower()


def _schema() -> str | None:
    return "app" if op.get_bind().dialect.name == "postgresql" else None


def _table_exists(table_name: str, schema: str | None) -> bool:
    return bool(sa.inspect(op.get_bind()).has_table(table_name, schema=schema))


def _create_table_if_missing(table_name: str, *columns, **kwargs) -> None:
    schema = kwargs.get("schema")
    if _table_exists(table_name, schema):
        return
    op.create_table(table_name, *columns, **kwargs)


def _create_index_if_missing(index_name: str, table_name: str, columns, **kwargs) -> None:
    schema = kwargs.get("schema")
    existing = {
        str(index.get("name") or "")
        for index in sa.inspect(op.get_bind()).get_indexes(table_name, schema=schema)
    }
    if index_name in existing:
        return
    op.create_index(index_name, table_name, columns, **kwargs)


def upgrade() -> None:
    if _scope() == "chat":
        return

    schema = _schema()
    _create_table_if_missing(
        "one_c_catalog_snapshots",
        sa.Column("source_base", sa.String(length=64), primary_key=True),
        sa.Column("active_generation", sa.Integer(), nullable=False, server_default="0"),
        sa.Column("nomenclature_count", sa.Integer(), nullable=False, server_default="0"),
        sa.Column("warehouses_count", sa.Integer(), nullable=False, server_default="0"),
        sa.Column("nomenclature_truncated", sa.Boolean(), nullable=False, server_default=sa.false()),
        sa.Column("warehouses_truncated", sa.Boolean(), nullable=False, server_default=sa.false()),
        sa.Column("updated_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("last_attempt_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("last_error", sa.Text(), nullable=False, server_default=""),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False, server_default=sa.text("CURRENT_TIMESTAMP")),
        schema=schema,
    )
    _create_table_if_missing(
        "one_c_catalog_entries",
        sa.Column("id", sa.Integer(), primary_key=True, autoincrement=True),
        sa.Column("source_base", sa.String(length=64), nullable=False),
        sa.Column("generation", sa.Integer(), nullable=False),
        sa.Column("catalog_type", sa.String(length=16), nullable=False),
        sa.Column("ref", sa.String(length=64), nullable=False),
        sa.Column("code", sa.String(length=200), nullable=False, server_default=""),
        sa.Column("name", sa.Text(), nullable=False, server_default=""),
        sa.Column("code_normalized", sa.String(length=200), nullable=False, server_default=""),
        sa.Column("name_normalized", sa.Text(), nullable=False, server_default=""),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False, server_default=sa.text("CURRENT_TIMESTAMP")),
        sa.UniqueConstraint(
            "source_base",
            "generation",
            "catalog_type",
            "ref",
            name="uq_app_one_c_catalog_entries_generation_ref",
        ),
        schema=schema,
    )
    _create_index_if_missing(
        "ix_app_one_c_catalog_entries_ref",
        "one_c_catalog_entries",
        ["source_base", "generation", "catalog_type", "ref"],
        schema=schema,
    )
    _create_index_if_missing(
        "ix_app_one_c_catalog_entries_name",
        "one_c_catalog_entries",
        ["source_base", "generation", "catalog_type", "name_normalized"],
        schema=schema,
    )
    _create_index_if_missing(
        "ix_app_one_c_catalog_entries_code",
        "one_c_catalog_entries",
        ["source_base", "generation", "catalog_type", "code_normalized"],
        schema=schema,
    )
    _create_table_if_missing(
        "one_c_catalog_tokens",
        sa.Column("id", sa.Integer(), primary_key=True, autoincrement=True),
        sa.Column("source_base", sa.String(length=64), nullable=False),
        sa.Column("generation", sa.Integer(), nullable=False),
        sa.Column("catalog_type", sa.String(length=16), nullable=False),
        sa.Column("entry_ref", sa.String(length=64), nullable=False),
        sa.Column("token", sa.String(length=200), nullable=False),
        sa.UniqueConstraint(
            "source_base",
            "generation",
            "catalog_type",
            "entry_ref",
            "token",
            name="uq_app_one_c_catalog_tokens_entry_token",
        ),
        schema=schema,
    )
    _create_index_if_missing(
        "ix_app_one_c_catalog_tokens_lookup",
        "one_c_catalog_tokens",
        ["source_base", "generation", "catalog_type", "token", "entry_ref"],
        schema=schema,
    )


def downgrade() -> None:
    if _scope() == "chat":
        return

    schema = _schema()
    op.drop_index("ix_app_one_c_catalog_tokens_lookup", table_name="one_c_catalog_tokens", schema=schema)
    op.drop_table("one_c_catalog_tokens", schema=schema)
    op.drop_index("ix_app_one_c_catalog_entries_name", table_name="one_c_catalog_entries", schema=schema)
    op.drop_index("ix_app_one_c_catalog_entries_code", table_name="one_c_catalog_entries", schema=schema)
    op.drop_index("ix_app_one_c_catalog_entries_ref", table_name="one_c_catalog_entries", schema=schema)
    op.drop_table("one_c_catalog_entries", schema=schema)
    op.drop_table("one_c_catalog_snapshots", schema=schema)
