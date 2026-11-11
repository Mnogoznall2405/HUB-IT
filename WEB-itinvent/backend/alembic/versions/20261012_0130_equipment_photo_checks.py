"""Add equipment_photo_checks (who uploaded a photo and who verified it).

Revision ID: 20261012_0130
Revises: 20261012_0129

Photos themselves stay in the legacy SQL Server FILES table; this table only carries
provenance (uploader) and the "проверено" mark. The code tolerates a missing table
(no mark, verify answers 503), so it can be deployed before this migration is run
explicitly at release time.
"""
from __future__ import annotations

from alembic import op
import sqlalchemy as sa


revision = "20261012_0130"
down_revision = "20261012_0129"
branch_labels = None
depends_on = None

TABLE = "equipment_photo_checks"
INDEX = "ix_app_equipment_photo_checks_db_item"
UNIQUE = "uq_app_equipment_photo_checks_db_item_file"


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
    if not _has_table(app_schema, TABLE):
        op.create_table(
            TABLE,
            sa.Column("id", sa.Integer(), autoincrement=True, nullable=False),
            sa.Column("db_id", sa.String(length=128), nullable=False),
            sa.Column("item_id", sa.Integer(), nullable=False),
            sa.Column("file_no", sa.Integer(), nullable=False),
            sa.Column("file_created_at", sa.String(length=64), nullable=False),
            sa.Column("uploaded_by_user_id", sa.Integer(), nullable=True),
            sa.Column("uploaded_by_name", sa.String(length=255), nullable=True),
            sa.Column("verified_by_user_id", sa.Integer(), nullable=True),
            sa.Column("verified_by_name", sa.String(length=255), nullable=True),
            sa.Column("verified_at", sa.DateTime(timezone=True), nullable=True),
            sa.Column("created_at", sa.DateTime(timezone=True), nullable=False),
            sa.PrimaryKeyConstraint("id"),
            sa.UniqueConstraint("db_id", "item_id", "file_no", name=UNIQUE),
            schema=app_schema,
        )
    if INDEX not in _index_names(app_schema, TABLE):
        op.create_index(INDEX, TABLE, ["db_id", "item_id"], schema=app_schema)


def downgrade() -> None:
    if _scope() == "chat":
        return

    app_schema = _schema("app")
    if not _has_table(app_schema, TABLE):
        return
    if INDEX in _index_names(app_schema, TABLE):
        op.drop_index(INDEX, table_name=TABLE, schema=app_schema)
    op.drop_table(TABLE, schema=app_schema)
