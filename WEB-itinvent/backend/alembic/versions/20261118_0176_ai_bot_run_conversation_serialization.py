"""A4: serialize AI runs per conversation.

Adds ai_bot_runs.queue_seq (per-conversation FIFO key assigned under the
ai_bot_conversations row lock at enqueue), ai_bot_conversations.last_run_seq,
and a partial unique index enforcing at most one `running` run per
conversation across all worker processes.

The upgrade refuses to install the unique index while duplicate `running`
rows exist for one conversation: those rows are evidence of the P0-3 defect
and must be resolved by an operator (finish or cancel them) before re-running
the migration. Nothing is auto-deleted.

Revision ID: 20261118_0176
Revises: 20261117_0175
"""
from __future__ import annotations

import os

from alembic import op
import sqlalchemy as sa


revision = "20261118_0176"
down_revision = "20261117_0175"
branch_labels = None
depends_on = None

RUNS_TABLE = "ai_bot_runs"
CONVERSATIONS_TABLE = "ai_bot_conversations"
RUNNING_UNIQUE_INDEX = "uq_app_ai_bot_runs_running_conversation"
QUEUE_SEQ_INDEX = "ix_app_ai_bot_runs_conversation_status_queue_seq"


def _scope() -> str:
    cfg = getattr(op.get_context(), "config", None)
    attrs = getattr(cfg, "attributes", None) or {}
    return str(attrs.get("itinvent_scope", "all") or "all").strip().lower()


def _schema() -> str | None:
    if op.get_bind().dialect.name != "postgresql":
        return None
    # ITINVENT_MIGRATION_APP_SCHEMA lets a scratch schema rehearse this
    # migration (the PG test suite runs it against a dedicated "a4*test"
    # schema). Production runs leave it unset -> "app".
    return str(os.environ.get("ITINVENT_MIGRATION_APP_SCHEMA", "") or "").strip() or "app"


def _columns(table: str) -> set[str]:
    return {column["name"] for column in sa.inspect(op.get_bind()).get_columns(table, schema=_schema())}


def _indexes(table: str) -> set[str]:
    return {index["name"] for index in sa.inspect(op.get_bind()).get_indexes(table, schema=_schema())}


def _create_index(*, name: str, table: str, columns: list[str], unique: bool, running_only: bool) -> None:
    postgres = op.get_bind().dialect.name == "postgresql"

    def execute() -> None:
        options: dict[str, object] = {}
        if postgres:
            options["postgresql_concurrently"] = True
            if running_only:
                options["postgresql_where"] = sa.text("status = 'running'")
        elif running_only:
            options["sqlite_where"] = sa.text("status = 'running'")
        op.create_index(name, table, columns, unique=unique, schema=_schema(), **options)

    if not postgres:
        execute()
        return
    with op.get_context().autocommit_block():
        bind = op.get_bind()
        previous = bind.execute(sa.text("SELECT current_setting('lock_timeout')")).scalar_one()
        bind.execute(sa.text("SELECT set_config('lock_timeout', '5s', false)"))
        try:
            execute()
        finally:
            bind.execute(sa.text("SELECT set_config('lock_timeout', :value, false)"), {"value": previous})


def _drop_index(*, name: str, table: str) -> None:
    postgres = op.get_bind().dialect.name == "postgresql"

    def execute() -> None:
        options = {"postgresql_concurrently": True} if postgres else {}
        op.drop_index(name, table_name=table, schema=_schema(), **options)

    if not postgres:
        execute()
        return
    with op.get_context().autocommit_block():
        bind = op.get_bind()
        previous = bind.execute(sa.text("SELECT current_setting('lock_timeout')")).scalar_one()
        bind.execute(sa.text("SELECT set_config('lock_timeout', '5s', false)"))
        try:
            execute()
        finally:
            bind.execute(sa.text("SELECT set_config('lock_timeout', :value, false)"), {"value": previous})


def _index_state(name: str) -> tuple[bool, bool] | None:
    """(indisvalid, indisready) for PG, None elsewhere/absent."""
    if op.get_bind().dialect.name != "postgresql":
        return None
    row = op.get_bind().execute(
        sa.text(
            "SELECT indisvalid, indisready FROM pg_index "
            "WHERE indexrelid = to_regclass(:name)"
        ),
        {"name": f"{_schema()}.{name}" if _schema() else name},
    ).first()
    return (bool(row[0]), bool(row[1])) if row else None


def _set_local_lock_timeout(value: str) -> None:
    """Bound DDL/backfill lock waits inside the migration transaction."""
    if op.get_bind().dialect.name == "postgresql":
        op.get_bind().execute(sa.text("SELECT set_config('lock_timeout', :v, true)"), {"v": value})


def upgrade() -> None:
    if _scope() == "chat":
        return
    bind = op.get_bind()
    postgres = bind.dialect.name == "postgresql"
    if postgres:
        # ADD COLUMN takes a brief ACCESS EXCLUSIVE; the backfill UPDATE takes
        # row locks. A stuck wait must abort fast and leave the table usable —
        # retry after the blocker finishes instead of piling up behind it.
        _set_local_lock_timeout("10s")

    run_columns = _columns(RUNS_TABLE)
    if "queue_seq" not in run_columns:
        op.add_column(RUNS_TABLE, sa.Column("queue_seq", sa.BigInteger(), nullable=True), schema=_schema())
    conversation_columns = _columns(CONVERSATIONS_TABLE)
    if "last_run_seq" not in conversation_columns:
        op.add_column(
            CONVERSATIONS_TABLE,
            sa.Column("last_run_seq", sa.BigInteger(), nullable=False, server_default="0"),
            schema=_schema(),
        )

    runs = f"{_schema()}.{RUNS_TABLE}" if _schema() else RUNS_TABLE
    conversations = f"{_schema()}.{CONVERSATIONS_TABLE}" if _schema() else CONVERSATIONS_TABLE

    # Backfill: single O(n) pass with ROW_NUMBER on PostgreSQL; the correlated
    # COUNT(*) fallback only runs on sqlite dev/test databases (small data,
    # no window-UPDATE support assumptions needed elsewhere).
    if postgres:
        bind.execute(
            sa.text(
                f"""
                UPDATE {runs} SET queue_seq = ranked.rn
                FROM (
                    SELECT id, ROW_NUMBER() OVER (
                        PARTITION BY conversation_id ORDER BY created_at, id
                    ) AS rn
                    FROM {runs}
                ) ranked
                WHERE {runs}.id = ranked.id AND {runs}.queue_seq IS NULL
                """
            )
        )
    else:
        bind.execute(
            sa.text(
                f"""
                UPDATE {runs} SET queue_seq = (
                    SELECT COUNT(*) FROM {runs} earlier
                    WHERE earlier.conversation_id = {runs}.conversation_id
                      AND (earlier.created_at < {runs}.created_at
                           OR (earlier.created_at = {runs}.created_at AND earlier.id <= {runs}.id))
                ) WHERE queue_seq IS NULL
                """
            )
        )
    bind.execute(
        sa.text(
            f"""
            UPDATE {conversations} SET last_run_seq = (
                SELECT COALESCE(MAX(queue_seq), 0) FROM {runs}
                WHERE {runs}.conversation_id = {conversations}.conversation_id
            )
            """
        )
    )

    if postgres:
        # Concurrent builds can leave an INVALID index behind (a duplicate
        # running row committed by an OLD worker during the build aborts it).
        # Drop INVALID leftovers so a retried upgrade rebuilds cleanly; a
        # VALID index is left alone.
        for index_name in (QUEUE_SEQ_INDEX, RUNNING_UNIQUE_INDEX):
            state = _index_state(index_name)
            if state is not None and (not state[0] or not state[1]):
                _drop_index(name=index_name, table=RUNS_TABLE)
        duplicates = list(
            bind.execute(
                sa.text(
                    f"SELECT conversation_id, COUNT(*) AS running_count FROM {runs} "
                    "WHERE status = 'running' GROUP BY conversation_id HAVING COUNT(*) > 1"
                )
            )
        )
        if duplicates:
            detail = ", ".join(f"{row.conversation_id} ({row.running_count} running)" for row in duplicates)
            raise RuntimeError(
                "Cannot install uq_app_ai_bot_runs_running_conversation: "
                f"duplicate running runs per conversation: {detail}. "
                "Resolve them (cancel/finish) and re-run the migration."
            )

    existing = _indexes(RUNS_TABLE)
    if QUEUE_SEQ_INDEX not in existing:
        _create_index(
            name=QUEUE_SEQ_INDEX,
            table=RUNS_TABLE,
            columns=["conversation_id", "status", "queue_seq"],
            unique=False,
            running_only=False,
        )
    if RUNNING_UNIQUE_INDEX not in existing:
        _create_index(
            name=RUNNING_UNIQUE_INDEX,
            table=RUNS_TABLE,
            columns=["conversation_id"],
            unique=True,
            running_only=True,
        )


def downgrade() -> None:
    if _scope() == "chat":
        return
    existing = _indexes(RUNS_TABLE)
    if RUNNING_UNIQUE_INDEX in existing:
        _drop_index(name=RUNNING_UNIQUE_INDEX, table=RUNS_TABLE)
    if QUEUE_SEQ_INDEX in existing:
        _drop_index(name=QUEUE_SEQ_INDEX, table=RUNS_TABLE)
    run_columns = _columns(RUNS_TABLE)
    if "queue_seq" in run_columns:
        op.drop_column(RUNS_TABLE, "queue_seq", schema=_schema())
    conversation_columns = _columns(CONVERSATIONS_TABLE)
    if "last_run_seq" in conversation_columns:
        op.drop_column(CONVERSATIONS_TABLE, "last_run_seq", schema=_schema())
