"""Keep ONLYOFFICE editing data on the existing document version transition.

Revision ID: 20261105_0161
Revises: 20261103_0160
"""
from __future__ import annotations

from alembic import op
import sqlalchemy as sa

revision = "20261105_0161"
down_revision = "20261103_0160"
branch_labels = None
depends_on = None


def _scope():
    return str(op.get_context().config.attributes.get("itinvent_scope", "all") or "all").lower()


def _schema():
    return "app" if op.get_bind().dialect.name == "postgresql" else None


def _columns(schema):
    inspector = sa.inspect(op.get_bind())
    return {column["name"] for column in inspector.get_columns("my_file_versions", schema=schema)} if inspector.has_table("my_file_versions", schema=schema) else set()


def upgrade():
    if _scope() == "chat":
        return
    schema = _schema()
    existing = _columns(schema)
    if not existing:
        return
    for name, kind, default in (
        ("office_history_json", sa.Text(), ""),
        ("office_changes_blob_id", sa.String(64), ""),
        ("office_changes_size_bytes", sa.BigInteger(), "0"),
        ("office_result_blob_id", sa.String(64), ""),
    ):
        if name not in existing:
            op.add_column("my_file_versions", sa.Column(name, kind, nullable=False, server_default=default), schema=schema)


def downgrade():
    if _scope() == "chat":
        return
    schema = _schema()
    existing = _columns(schema)
    for name in ("office_result_blob_id", "office_changes_size_bytes", "office_changes_blob_id", "office_history_json"):
        if name in existing:
            op.drop_column("my_file_versions", name, schema=schema)
