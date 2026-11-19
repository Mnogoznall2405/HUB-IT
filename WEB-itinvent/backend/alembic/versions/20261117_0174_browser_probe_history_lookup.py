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


def upgrade() -> None:
    if _scope() == "chat" or op.get_bind().dialect.name != "postgresql":
        return
    with op.get_context().autocommit_block():
        op.execute(sa.text("SET lock_timeout = '5s'"))
        try:
            op.execute(
                sa.text(
                    "CREATE INDEX CONCURRENTLY ix_app_browser_probe_hist_latest "
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
    with op.get_context().autocommit_block():
        op.execute(sa.text("SET lock_timeout = '5s'"))
        try:
            op.execute(sa.text("DROP INDEX CONCURRENTLY app.ix_app_browser_probe_hist_latest"))
        finally:
            op.execute(sa.text("RESET lock_timeout"))
