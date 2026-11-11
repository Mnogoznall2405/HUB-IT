"""Index created_at on DLP probe media tables for bounded retention deletes.

Revision ID: 20261110_0163
Revises: 20261109_0162
"""

from alembic import op
import sqlalchemy as sa

revision = "20261110_0163"
down_revision = "20261109_0162"
branch_labels = None
depends_on = None

_TARGETS = (
    ("browser_probe_media", "ix_app_browser_probe_media_created_at"),
    ("telegram_probe_media", "ix_app_telegram_probe_media_created_at"),
    ("max_probe_media", "ix_app_max_probe_media_created_at"),
)


def _scope() -> str:
    return str(op.get_context().config.attributes.get("itinvent_scope", "all") or "all").strip().lower()


def _schema() -> str | None:
    return "app" if op.get_bind().dialect.name == "postgresql" else None


def _has_index(schema: str | None, table_name: str, index_name: str) -> bool:
    inspector = sa.inspect(op.get_bind())
    return any(
        str(item.get("name") or "").strip() == index_name
        for item in inspector.get_indexes(table_name, schema=schema)
    )


def upgrade() -> None:
    if _scope() == "chat":
        return
    schema = _schema()
    inspector = sa.inspect(op.get_bind())
    for table_name, index_name in _TARGETS:
        if not inspector.has_table(table_name, schema=schema):
            continue
        if _has_index(schema, table_name, index_name):
            continue
        op.create_index(index_name, table_name, ["created_at"], unique=False, schema=schema)


def downgrade() -> None:
    if _scope() == "chat":
        return
    schema = _schema()
    inspector = sa.inspect(op.get_bind())
    for table_name, index_name in _TARGETS:
        if not inspector.has_table(table_name, schema=schema):
            continue
        if _has_index(schema, table_name, index_name):
            op.drop_index(index_name, table_name=table_name, schema=schema)
