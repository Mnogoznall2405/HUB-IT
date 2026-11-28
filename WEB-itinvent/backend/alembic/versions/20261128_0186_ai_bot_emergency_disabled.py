"""Emergency kill-switch timestamp on ai_bots.

Separate from regular disable (``is_enabled``): when set, the agent rejects new
requests, blocks confirmation of previously created actions and stops new
execution stages — re-checked right before mutating operations. Already
committed external actions are not rolled back; history and audit are kept.
Nullable timestamp doubles as the audit record of when the mode was engaged.
"""

from alembic import op
import sqlalchemy as sa

revision = "20261128_0186"
down_revision = "20261127_0185"
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
    if _has_column(schema, "ai_bots", "emergency_disabled_at"):
        return
    with op.batch_alter_table("ai_bots", schema=schema) as batch:
        batch.add_column(sa.Column("emergency_disabled_at", sa.DateTime(timezone=True), nullable=True))


def downgrade() -> None:
    if _scope() == "chat":
        return
    schema = _schema()
    if not _has_column(schema, "ai_bots", "emergency_disabled_at"):
        return
    with op.batch_alter_table("ai_bots", schema=schema) as batch:
        batch.drop_column("emergency_disabled_at")
