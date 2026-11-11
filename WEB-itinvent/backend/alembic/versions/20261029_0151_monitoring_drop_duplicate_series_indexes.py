"""Drop the monitoring "series" indexes that duplicate the unique constraints.

Revision ID: 20261029_0151
Revises: 20261027_0150

``ix_monitoring_samples_series`` / ``ix_monitoring_aggregates_series`` index exactly the columns of
``uq_monitoring_sample`` / ``uq_monitoring_aggregate``; the unique indexes serve the same lookups, so the
copies only cost ~1.3 GB and an extra index write on every insert and update.

A duplicate is dropped only while a unique constraint on the same columns exists. On PostgreSQL the drop
is CONCURRENTLY (no table lock against the monitoring writers) and gives up after ``lock_timeout``.
"""
from __future__ import annotations

from alembic import op
import sqlalchemy as sa


revision = "20261029_0151"
down_revision = "20261027_0150"
branch_labels = None
depends_on = None

# (table, duplicate index, columns)
DUPLICATES = (
    ("monitoring_samples", "ix_monitoring_samples_series", ["target_id", "interface_id", "observed_at"]),
    ("monitoring_aggregates", "ix_monitoring_aggregates_series", ["target_id", "interface_id", "resolution", "bucket_at"]),
)


def _scope() -> str:
    return str(op.get_context().config.attributes.get("itinvent_scope", "all") or "all").strip().lower()


def _schema() -> str | None:
    return "app" if op.get_bind().dialect.name == "postgresql" else None


def _index_names(schema: str | None, table: str) -> set[str]:
    return {item["name"] for item in sa.inspect(op.get_bind()).get_indexes(table, schema=schema)}


def _has_unique_on(schema: str | None, table: str, columns: list[str]) -> bool:
    inspector = sa.inspect(op.get_bind())
    constraints = inspector.get_unique_constraints(table, schema=schema)
    uniques = [list(item["column_names"]) for item in constraints]
    uniques += [list(item["column_names"]) for item in inspector.get_indexes(table, schema=schema) if item.get("unique")]
    return columns in uniques


def _drop(schema: str | None, table: str, index: str) -> None:
    if op.get_bind().dialect.name == "postgresql":
        with op.get_context().autocommit_block():
            op.execute("SET lock_timeout = '5s'")
            try:
                op.execute(f'DROP INDEX CONCURRENTLY IF EXISTS "{schema}"."{index}"')
            finally:
                op.execute("RESET lock_timeout")
    else:
        op.drop_index(index, table_name=table, schema=schema)


def _create(schema: str | None, table: str, index: str, columns: list[str]) -> None:
    if op.get_bind().dialect.name == "postgresql":
        quoted = ", ".join(f'"{column}"' for column in columns)
        with op.get_context().autocommit_block():
            op.execute("SET lock_timeout = '5s'")
            try:
                op.execute(f'CREATE INDEX CONCURRENTLY IF NOT EXISTS "{index}" ON "{schema}"."{table}" ({quoted})')
            finally:
                op.execute("RESET lock_timeout")
    else:
        op.create_index(index, table, columns, schema=schema)


def upgrade() -> None:
    if _scope() == "chat":
        return
    schema = _schema()
    inspector = sa.inspect(op.get_bind())
    for table, index, columns in DUPLICATES:
        if not inspector.has_table(table, schema=schema):
            continue
        if index in _index_names(schema, table) and _has_unique_on(schema, table, columns):
            _drop(schema, table, index)


def downgrade() -> None:
    if _scope() == "chat":
        return
    schema = _schema()
    inspector = sa.inspect(op.get_bind())
    for table, index, columns in DUPLICATES:
        if not inspector.has_table(table, schema=schema):
            continue
        if index not in _index_names(schema, table):
            _create(schema, table, index, columns)
