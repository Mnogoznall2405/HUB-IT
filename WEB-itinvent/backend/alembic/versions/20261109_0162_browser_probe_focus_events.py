"""Record applied Browser Probe focus events for retry deduplication.

Revision ID: 20261109_0162
Revises: 20261105_0161
"""

from alembic import op
import sqlalchemy as sa

revision = "20261109_0162"
down_revision = "20261105_0161"
branch_labels = None
depends_on = None

TABLE = "browser_probe_focus_events"


def _scope() -> str:
    return str(op.get_context().config.attributes.get("itinvent_scope", "all") or "all").strip().lower()


def _schema() -> str | None:
    return "app" if op.get_bind().dialect.name == "postgresql" else None


def upgrade() -> None:
    if _scope() == "chat":
        return
    schema = _schema()
    if not sa.inspect(op.get_bind()).has_table(TABLE, schema=schema):
        op.create_table(
            TABLE,
            sa.Column("event_key", sa.String(64), nullable=False),
            sa.Column("received_at", sa.DateTime(timezone=True), nullable=False),
            sa.PrimaryKeyConstraint("event_key", name="pk_app_browser_probe_focus_events"),
            schema=schema,
        )


def downgrade() -> None:
    if _scope() == "chat":
        return
    schema = _schema()
    if sa.inspect(op.get_bind()).has_table(TABLE, schema=schema):
        op.drop_table(TABLE, schema=schema)
