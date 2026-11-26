"""Add missing ``avatar_url`` column to ``users``.

Migration drift fix: ``AppUser.avatar_url`` has been part of the ORM model for a
long time but no migration ever added it to the ``users`` table — production
databases carry the column from the legacy non-alembic initialization, while a
fresh alembic-built database cannot even insert a user row. Exposed by the A11
isolated-PostgreSQL gate (``test_postgres_concurrent_logins_do_not_exceed_limit``).
Idempotent: databases that already have the column are left untouched.
"""

from alembic import op
import sqlalchemy as sa

revision = "20261126_0184"
down_revision = "20261126_0183"
branch_labels = None
depends_on = None


def _scope() -> str:
    return str(op.get_context().config.attributes.get("itinvent_scope", "all") or "all").strip().lower()


def _schema() -> str | None:
    return "app" if op.get_bind().dialect.name == "postgresql" else None


def _has_column(schema: str | None, table: str, column: str) -> bool:
    bind = op.get_bind()
    inspector = sa.inspect(bind)
    try:
        columns = inspector.get_columns(table, schema=schema)
    except Exception:
        return False
    return any(col.get("name") == column for col in columns)


def upgrade() -> None:
    if _scope() == "chat":
        return
    schema = _schema()
    if _has_column(schema, "users", "avatar_url"):
        return
    with op.batch_alter_table("users", schema=schema) as batch:
        batch.add_column(sa.Column("avatar_url", sa.String(512), nullable=True))


def downgrade() -> None:
    if _scope() == "chat":
        return
    schema = _schema()
    if not _has_column(schema, "users", "avatar_url"):
        return
    with op.batch_alter_table("users", schema=schema) as batch:
        batch.drop_column("avatar_url")
