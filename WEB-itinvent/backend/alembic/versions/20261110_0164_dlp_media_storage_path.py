"""Add storage_path to DLP probe media tables (external file payloads).

Revision ID: 20261110_0164
Revises: 20261110_0163
"""

from alembic import op
import sqlalchemy as sa

revision = "20261110_0164"
down_revision = "20261110_0163"
branch_labels = None
depends_on = None

_TABLES = ("browser_probe_media", "telegram_probe_media", "max_probe_media")


def _scope() -> str:
    return str(op.get_context().config.attributes.get("itinvent_scope", "all") or "all").strip().lower()


def _schema() -> str | None:
    return "app" if op.get_bind().dialect.name == "postgresql" else None


def _columns(schema: str | None, table_name: str) -> set[str]:
    return {
        str(item.get("name") or "").strip()
        for item in sa.inspect(op.get_bind()).get_columns(table_name, schema=schema)
    }


def upgrade() -> None:
    if _scope() == "chat":
        return
    schema = _schema()
    inspector = sa.inspect(op.get_bind())
    for table_name in _TABLES:
        if not inspector.has_table(table_name, schema=schema):
            continue
        if "storage_path" in _columns(schema, table_name):
            continue
        op.add_column(table_name, sa.Column("storage_path", sa.String(1024), nullable=True), schema=schema)


def downgrade() -> None:
    if _scope() == "chat":
        return
    schema = _schema()
    inspector = sa.inspect(op.get_bind())
    for table_name in _TABLES:
        if not inspector.has_table(table_name, schema=schema):
            continue
        if "storage_path" in _columns(schema, table_name):
            op.drop_column(table_name, "storage_path", schema=schema)
