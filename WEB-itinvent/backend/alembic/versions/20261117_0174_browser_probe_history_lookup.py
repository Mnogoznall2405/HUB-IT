"""Index the latest browser History visit lookup without blocking writes.

Revision ID: 20261117_0174
Revises: 20261114_0173
"""
from __future__ import annotations

from alembic import op
import sqlalchemy as sa


revision = "20261117_0174"
down_revision = "20261114_0173"
branch_labels = None
depends_on = None


def _scope() -> str:
    return str(op.get_context().config.attributes.get("itinvent_scope", "all") or "all").strip().lower()


INDEX = "ix_app_browser_probe_hist_latest"


def _index_state() -> str:
    """``missing`` | ``valid`` | ``invalid`` — invalid concurrent builds must be
    dropped before retrying, otherwise CREATE INDEX CONCURRENTLY fails on the
    leftover relation."""
    row = op.get_bind().execute(
        sa.text(
            "SELECT indisvalid FROM pg_index WHERE indexrelid = to_regclass(:name)"
        ),
        {"name": f"app.{INDEX}"},
    ).first()
    if row is None:
        return "missing"
    return "valid" if row[0] else "invalid"


def upgrade() -> None:
    if _scope() == "chat" or op.get_bind().dialect.name != "postgresql":
        return
    state = _index_state()
    if state == "valid":
        return
    with op.get_context().autocommit_block():
        op.execute(sa.text("SET lock_timeout = '5s'"))
        try:
            if state == "invalid":
                op.execute(sa.text(f"DROP INDEX CONCURRENTLY app.{INDEX}"))
            op.execute(
                sa.text(
                    f"CREATE INDEX CONCURRENTLY {INDEX} "
                    "ON app.browser_probe_visits "
                    "(computer_name, browser, md5(url), visited_at DESC NULLS LAST) "
                    "WHERE profile <> 'focus'"
                )
            )
        finally:
            op.execute(sa.text("RESET lock_timeout"))


def downgrade() -> None:
    if _scope() == "chat" or op.get_bind().dialect.name != "postgresql":
        return
    if _index_state() == "missing":
        return
    with op.get_context().autocommit_block():
        op.execute(sa.text("SET lock_timeout = '5s'"))
        try:
            op.execute(sa.text(f"DROP INDEX CONCURRENTLY IF EXISTS app.{INDEX}"))
        finally:
            op.execute(sa.text("RESET lock_timeout"))
