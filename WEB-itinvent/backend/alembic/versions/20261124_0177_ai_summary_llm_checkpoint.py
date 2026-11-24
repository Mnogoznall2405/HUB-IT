"""A8 cycle 2: LLM-summary checkpoint columns on ai_bot_conversations.

Adds rolling_summary_llm / summary_llm_until_seq so the background summary
upgrade can fold messages incrementally on top of the last LLM-quality
summary instead of recomputing the whole covered range (and losing messages
past a single batch).

Existing rows keep their current (fallback or LLM) rolling_summary as the
prompt-facing text and start with summary_llm_until_seq = 0: the upgrade
worker lazily re-summarizes touched conversations — the columns claim no
LLM coverage they do not have.

Revision ID: 20261124_0177
Revises: 20261118_0176
"""
from __future__ import annotations

import os

from alembic import op
import sqlalchemy as sa


revision = "20261124_0177"
down_revision = "20261118_0176"
branch_labels = None
depends_on = None

CONVERSATIONS_TABLE = "ai_bot_conversations"


def _scope() -> str:
    cfg = getattr(op.get_context(), "config", None)
    attrs = getattr(cfg, "attributes", None) or {}
    return str(attrs.get("itinvent_scope", "all") or "all").strip().lower()


def _schema() -> str | None:
    if op.get_bind().dialect.name != "postgresql":
        return None
    return str(os.environ.get("ITINVENT_MIGRATION_APP_SCHEMA", "") or "").strip() or "app"


def _columns(table: str) -> set[str]:
    return {column["name"] for column in sa.inspect(op.get_bind()).get_columns(table, schema=_schema())}


def upgrade() -> None:
    if _scope() == "chat":
        return
    if op.get_bind().dialect.name == "postgresql":
        op.get_bind().execute(sa.text("SELECT set_config('lock_timeout', '10s', true)"))
    existing = _columns(CONVERSATIONS_TABLE)
    if "rolling_summary_llm" not in existing:
        op.add_column(
            CONVERSATIONS_TABLE,
            sa.Column("rolling_summary_llm", sa.Text(), nullable=False, server_default=""),
            schema=_schema(),
        )
    if "summary_llm_until_seq" not in existing:
        op.add_column(
            CONVERSATIONS_TABLE,
            sa.Column("summary_llm_until_seq", sa.BigInteger(), nullable=False, server_default="0"),
            schema=_schema(),
        )


def downgrade() -> None:
    if _scope() == "chat":
        return
    existing = _columns(CONVERSATIONS_TABLE)
    if "summary_llm_until_seq" in existing:
        op.drop_column(CONVERSATIONS_TABLE, "summary_llm_until_seq", schema=_schema())
    if "rolling_summary_llm" in existing:
        op.drop_column(CONVERSATIONS_TABLE, "rolling_summary_llm", schema=_schema())
