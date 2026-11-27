"""Add missing ``avatar_url`` column to ``app.users``.

``AppUser.avatar_url`` is used by the profile avatar upload/delete API, user
serialization, chat sender payloads and employee-photo resolution, but no
migration ever added the column to ``users``. Databases initialized through
the legacy non-Alembic ``create_all`` path already carry it; a fresh
Alembic-built database does not. The migration is intentionally create-if-missing
so both shapes converge without rewriting existing data.
"""
from __future__ import annotations

from alembic import op
import sqlalchemy as sa


revision = "20261126_0184"
down_revision = "20261126_0183"
branch_labels = None
depends_on = None


def _scope() -> str:
    cfg = getattr(op.get_context(), "config", None)
    attrs = getattr(cfg, "attributes", None) or {}
    return str(attrs.get("itinvent_scope", "all") or "all").strip().lower()


def _schema() -> str | None:
    return "app" if op.get_bind().dialect.name == "postgresql" else None


def _has_column(schema: str | None, table: str, column: str) -> bool:
    inspector = sa.inspect(op.get_bind())
    if not inspector.has_table(table, schema=schema):
        return False
    return any(item.get("name") == column for item in inspector.get_columns(table, schema=schema))


def upgrade() -> None:
    # ``users`` belongs to the app scope; chat-only databases intentionally
    # treat interleaved app revisions as revision-only no-ops.
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
