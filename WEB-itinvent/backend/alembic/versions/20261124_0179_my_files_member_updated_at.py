"""updated_at on My Files member/collaborator rows (Performance V3.1).

Role changes on ``my_file_library_members``, ``my_file_collaborators`` and
``my_file_folder_collaborators`` are applied in place — the rows have no
``updated_at``, so an in-place role edit is invisible to any data-version
signal (count + max(created_at) misses it). The listing ETag fingerprint
needs a reliable mutation timestamp per grant table, so each table gets a
``updated_at`` column backfilled from ``created_at``; writers stamp it on
every mutation from now on.
"""

from alembic import op
import sqlalchemy as sa

revision = "20261124_0179"
down_revision = "20261124_0178"
branch_labels = None
depends_on = None

_TABLES = (
    "my_file_library_members",
    "my_file_collaborators",
    "my_file_folder_collaborators",
)


def _scope() -> str:
    return str(op.get_context().config.attributes.get("itinvent_scope", "all") or "all").strip().lower()


def _schema() -> str | None:
    return "app" if op.get_bind().dialect.name == "postgresql" else None


def _has_column(schema: str | None, table_name: str, column: str) -> bool:
    if not sa.inspect(op.get_bind()).has_table(table_name, schema=schema):
        return False
    return any(item.get("name") == column for item in sa.inspect(op.get_bind()).get_columns(table_name, schema=schema))


def upgrade() -> None:
    if _scope() == "chat":
        return
    schema = _schema()
    for table_name in _TABLES:
        if _has_column(schema, table_name, "updated_at"):
            continue
        with op.batch_alter_table(table_name, schema=schema) as batch:
            batch.add_column(sa.Column("updated_at", sa.DateTime(timezone=True), nullable=True))
        op.execute(
            sa.text(f"UPDATE {('"' + schema + '".') if schema else ''}{table_name} SET updated_at = created_at WHERE updated_at IS NULL")
        )
        with op.batch_alter_table(table_name, schema=schema) as batch:
            batch.alter_column("updated_at", existing_type=sa.DateTime(timezone=True), nullable=False)


def downgrade() -> None:
    if _scope() == "chat":
        return
    schema = _schema()
    for table_name in _TABLES:
        if not _has_column(schema, table_name, "updated_at"):
            continue
        with op.batch_alter_table(table_name, schema=schema) as batch:
            batch.drop_column("updated_at")
