"""A4: real-PostgreSQL proof of per-conversation AI run serialization.

These tests run only when AI_RUN_TEST_DATABASE_URL points at a PostgreSQL
database and AI_RUN_TEST_SCHEMA names a dedicated schema whose name contains
"test" (fail-closed, same convention as SCAN_TEST_DATABASE_URL). All app tables
are created inside that schema via schema_translate_map — no production or
shared schema is touched.

Covered: concurrent claims from independent transactions/connections, strict
FIFO by queue_seq, cross-conversation parallelism, terminal-state release,
mid-claim rollback recovery, the watchdog/cancel CAS freeing the slot, the
unique-index backstop, and the enqueue-side monotone sequence minted under the
mapping row lock.
"""
import os
import threading
import time
import conftest  # noqa: F401  (import order: sys.path bootstrap)
from contextlib import contextmanager
from datetime import datetime, timedelta, timezone

import pytest
from sqlalchemy import create_engine, select, text, update
from sqlalchemy.orm import Session

from backend.appdb.models import AppUser, AppAiBot, AppAiBotConversation, AppAiBotRun
from backend.ai_chat import access as access_module
from backend.ai_chat import service as service_module


def _test_database_url() -> str:
    url = str(os.getenv("AI_RUN_TEST_DATABASE_URL") or "").strip()
    return url if url.startswith(("postgresql://", "postgresql+")) else ""


def _test_schema() -> str:
    schema = str(os.getenv("AI_RUN_TEST_SCHEMA") or "a4test").strip()
    return schema if "test" in schema.lower() else ""


pytestmark = pytest.mark.skipif(
    not (_test_database_url() and _test_schema()),
    reason="AI_RUN_TEST_DATABASE_URL/AI_RUN_TEST_SCHEMA not configured for a dedicated test schema",
)

PG_URL = _test_database_url()
PG_SCHEMA = _test_schema()
A4_TABLES = ["ai_bot_runs", "ai_bot_conversations", "ai_bots", "users"]


@pytest.fixture(scope="module")
def pg_engine():
    """Translated engine: app.<table> compiles to <test_schema>.<table>."""
    admin = create_engine(PG_URL, pool_pre_ping=True)
    with admin.connect() as conn:
        conn.execute(text(f'CREATE SCHEMA IF NOT EXISTS "{PG_SCHEMA}"'))
        conn.commit()
    admin.dispose()
    engine = create_engine(PG_URL, pool_pre_ping=True).execution_options(
        schema_translate_map={"app": PG_SCHEMA, "system": PG_SCHEMA, "chat": PG_SCHEMA}
    )
    from backend.appdb.models import AppBase

    AppBase.metadata.create_all(
        engine,
        tables=[
            AppAiBotRun.__table__,
            AppAiBotConversation.__table__,
            AppAiBot.__table__,
            AppUser.__table__,
        ],
    )
    yield engine
    engine.dispose()


@pytest.fixture
def svc(pg_engine, monkeypatch):
    with pg_engine.connect() as conn:
        for table in A4_TABLES:
            conn.execute(text(f'TRUNCATE "{PG_SCHEMA}"."{table}" CASCADE'))
        conn.commit()

    @contextmanager
    def session(*_args, **_kwargs):
        # Same contract as backend.appdb.db.app_session: commit on clean exit,
        # rollback on error; inner rollbacks are legal mid-transaction.
        db = Session(pg_engine, expire_on_commit=False)
        try:
            yield db
            db.commit()
        except Exception:
            db.rollback()
            raise
        finally:
            db.close()

    monkeypatch.setattr(service_module, "app_session", session)
    monkeypatch.setattr(access_module, "require_bot_access", lambda *args, **kwargs: None)
    monkeypatch.setattr(service_module.user_service, "get_by_id", lambda user_id: {"id": user_id})
    svc = service_module.AiChatService()
    svc.session = session
    svc.engine = pg_engine
    monkeypatch.setattr(svc, "_publish_status_event", lambda **kwargs: None)
    monkeypatch.setattr(svc, "_record_conversation_activity", lambda **kwargs: None)
    yield svc


def _seed(svc, conversations=("conv",), bots=("agent",)):
    with svc.session() as db:
        db.add(AppUser(id=2, username="owner", role="viewer"))
        for bot_id in bots:
            db.add(AppAiBot(id=bot_id, slug=f"slug-{bot_id}", title=bot_id, is_enabled=True))
        for conv in conversations:
            db.add(AppAiBotConversation(bot_id="agent", user_id=2, conversation_id=conv))


def _add_run(svc, run_id, conv="conv", *, status="queued", seq=None, created_at=None):
    with svc.session() as db:
        db.add(AppAiBotRun(
            id=run_id, bot_id="agent", conversation_id=conv, user_id=2,
            trigger_message_id=f"m-{run_id}", status=status, queue_seq=seq,
            created_at=created_at or datetime.now(timezone.utc),
            updated_at=datetime.now(timezone.utc),
        ))


def _claim(svc):
    with svc.session() as db:
        run = svc._claim_next_queued_run(db)
        return run.id if run is not None else None


def _finish(svc, run_id, status="completed"):
    with svc.session() as db:
        db.execute(
            update(AppAiBotRun)
            .where(AppAiBotRun.id == run_id, AppAiBotRun.status.in_(["queued", "running"]))
            .values(status=status, completed_at=datetime.now(timezone.utc), updated_at=datetime.now(timezone.utc))
        )


def test_pg_unique_index_exists_and_enforces(svc):
    """Declarative backstop: a second committed running row for one
    conversation violates the partial unique index even via raw SQL."""
    _seed(svc)
    _add_run(svc, "r1", status="running", seq=1)
    import sqlalchemy.exc as sa_exc

    with pytest.raises(sa_exc.IntegrityError) as err:
        with svc.session() as db:
            db.execute(text(
                f'INSERT INTO "{PG_SCHEMA}"."ai_bot_runs" (id, bot_id, conversation_id, user_id, trigger_message_id, status, request_json, result_json, usage_json, created_at, updated_at) '
                "VALUES ('r2x', 'agent', 'conv', 2, 'm2', 'running', '{}', '{}', '{}', now(), now())"
            ))
    orig = getattr(err.value, "orig", None)
    assert getattr(orig, "sqlstate", "") == "23505", err.value
    # A running row for a DIFFERENT conversation is unaffected.
    with svc.session() as db:
        db.add(AppAiBotConversation(bot_id="agent", user_id=2, conversation_id="conv2"))
        db.add(AppAiBotRun(
            id="r2y", bot_id="agent", conversation_id="conv2", user_id=2,
            trigger_message_id="m2", status="running",
            created_at=datetime.now(timezone.utc), updated_at=datetime.now(timezone.utc),
        ))


def test_pg_two_workers_one_conversation_single_running(svc):
    """Two independent transactions racing the claim: exactly one wins, and it
    wins the FIFO head."""
    _seed(svc)
    _add_run(svc, "r1", seq=1)
    _add_run(svc, "r2", seq=2)
    barrier = threading.Barrier(2)
    results, errors = {}, []

    def worker(name):
        try:
            barrier.wait(timeout=15)
            with svc.session() as db:
                run = svc._claim_next_queued_run(db)
                results[name] = run.id if run is not None else None
        except Exception as exc:  # noqa: BLE001
            errors.append(exc)

    threads = [threading.Thread(target=worker, args=(name,)) for name in ("w1", "w2")]
    for thread in threads:
        thread.start()
    for thread in threads:
        thread.join(timeout=60)
    assert not errors
    winners = [run_id for run_id in results.values() if run_id is not None]
    assert winners == ["r1"]
    with svc.session() as db:
        running = list(db.execute(
            select(AppAiBotRun).where(AppAiBotRun.conversation_id == "conv", AppAiBotRun.status == "running")
        ).scalars())
    assert len(running) == 1


def test_pg_four_workers_four_queued_one_running(svc):
    _seed(svc)
    for idx in range(1, 5):
        _add_run(svc, f"r{idx}", seq=idx)
    barrier = threading.Barrier(4)
    claimed, errors = [], []

    def worker():
        try:
            barrier.wait(timeout=15)
            with svc.session() as db:
                run = svc._claim_next_queued_run(db)
                if run is not None:
                    claimed.append(run.id)
        except Exception as exc:  # noqa: BLE001
            errors.append(exc)

    threads = [threading.Thread(target=worker) for _ in range(4)]
    for thread in threads:
        thread.start()
    for thread in threads:
        thread.join(timeout=60)
    assert not errors
    assert claimed == ["r1"]
    with svc.session() as db:
        running = list(db.execute(
            select(AppAiBotRun).where(AppAiBotRun.conversation_id == "conv", AppAiBotRun.status == "running")
        ).scalars())
    assert len(running) == 1 and running[0].id == "r1"


def test_pg_fifo_order_strict(svc):
    _seed(svc)
    for idx in range(1, 4):
        _add_run(svc, f"r{idx}", seq=idx)
    order = []
    for _ in range(3):
        run_id = _claim(svc)
        assert run_id is not None
        order.append(run_id)
        _finish(svc, run_id)
    assert order == ["r1", "r2", "r3"]


def test_pg_queue_seq_beats_created_at(svc):
    _seed(svc)
    t0 = datetime.now(timezone.utc)
    _add_run(svc, "r_seq1", seq=1, created_at=t0 + timedelta(minutes=5))
    _add_run(svc, "r_seq2", seq=2, created_at=t0)
    assert _claim(svc) == "r_seq1"


def test_pg_same_created_at_deterministic(svc):
    _seed(svc)
    t0 = datetime.now(timezone.utc)
    _add_run(svc, "run-b", seq=None, created_at=t0)
    _add_run(svc, "run-a", seq=None, created_at=t0)
    first = _claim(svc)
    assert first is not None
    _finish(svc, first)
    second = _claim(svc)
    assert {first, second} == {"run-a", "run-b"}
    # NULL seq falls back to (created_at, id): run-a sorts first.
    assert first == "run-a"


def test_pg_different_conversations_claim_in_parallel(svc):
    _seed(svc, conversations=("convA", "convB"))
    _add_run(svc, "a1", conv="convA", seq=1)
    _add_run(svc, "b1", conv="convB", seq=1)
    barrier = threading.Barrier(2)
    results, errors = {}, []

    def worker(name):
        try:
            barrier.wait(timeout=15)
            with svc.session() as db:
                run = svc._claim_next_queued_run(db)
                results[name] = run.id if run is not None else None
        except Exception as exc:  # noqa: BLE001
            errors.append(exc)

    threads = [threading.Thread(target=worker, args=(name,)) for name in ("wA", "wB")]
    for thread in threads:
        thread.start()
    for thread in threads:
        thread.join(timeout=60)
    assert not errors
    assert sorted(results.values()) == ["a1", "b1"]
    with svc.session() as db:
        for conv in ("convA", "convB"):
            running = list(db.execute(
                select(AppAiBotRun).where(AppAiBotRun.conversation_id == conv, AppAiBotRun.status == "running")
            ).scalars())
            assert len(running) == 1


def test_pg_busy_conversation_skipped_not_blocked(svc):
    _seed(svc, conversations=("convA", "convB"))
    _add_run(svc, "a1", conv="convA", status="running", seq=1)
    _add_run(svc, "a2", conv="convA", seq=2)
    _add_run(svc, "b1", conv="convB", seq=1)
    assert _claim(svc) == "b1"


def test_pg_cancel_frees_the_slot(svc):
    _seed(svc)
    _add_run(svc, "r1", seq=1)
    _add_run(svc, "r2", seq=2)
    assert _claim(svc) == "r1"
    _finish(svc, "r1", status="cancelled")
    assert _claim(svc) == "r2"


def test_pg_error_frees_the_slot(svc):
    _seed(svc)
    _add_run(svc, "r1", seq=1)
    _add_run(svc, "r2", seq=2)
    assert _claim(svc) == "r1"
    _finish(svc, "r1", status="failed")
    assert _claim(svc) == "r2"


def test_pg_crash_before_claim_commit_leaves_run_queued(svc):
    """A worker that dies after its UPDATE but before COMMIT loses nothing:
    the row stays queued and another worker claims it."""
    _seed(svc)
    _add_run(svc, "r1", seq=1)
    crashed = Session(svc.engine, expire_on_commit=False)
    crashed.begin()
    run = svc._claim_next_queued_run(crashed)
    assert run is not None and run.id == "r1"
    crashed.rollback()  # crash before commit: no running row, no held locks
    crashed.close()
    with svc.session() as db:
        status = db.execute(select(AppAiBotRun.status).where(AppAiBotRun.id == "r1")).scalar_one()
    assert status == "queued"
    assert _claim(svc) == "r1"


def test_pg_orphaned_running_recovered_by_watchdog_cas(svc):
    """A dead worker leaves status='running'. The A1 watchdog CAS (same
    conditional UPDATE shape) moves it to failed; the next head then claims."""
    _seed(svc)
    stale = datetime.now(timezone.utc) - timedelta(hours=2)
    _add_run(svc, "r1", status="running", seq=1, created_at=stale)
    _add_run(svc, "r2", seq=2)
    with svc.session() as db:
        row = db.execute(select(AppAiBotRun).where(AppAiBotRun.id == "r1")).scalar_one()
        changed = db.execute(
            update(AppAiBotRun)
            .where(
                AppAiBotRun.id == "r1",
                AppAiBotRun.status.in_(["queued", "running"]),
                AppAiBotRun.updated_at == row.updated_at,
            )
            .values(status="failed", completed_at=datetime.now(timezone.utc), updated_at=datetime.now(timezone.utc))
            .execution_options(synchronize_session=False)
        )
        assert int(changed.rowcount or 0) == 1
    assert _claim(svc) == "r2"


def test_pg_late_update_cannot_resurrect_finished_run(svc):
    """A second attempt to finalize a finished run is a no-op under the same
    CAS guard the worker uses — no duplicate completion."""
    _seed(svc)
    _add_run(svc, "r1", seq=1)
    assert _claim(svc) == "r1"
    _finish(svc, "r1")
    with svc.session() as db:
        changed = db.execute(
            update(AppAiBotRun)
            .where(AppAiBotRun.id == "r1", AppAiBotRun.status.in_(["queued", "running"]))
            .values(status="completed")
        )
        assert int(changed.rowcount or 0) == 0


def test_pg_enqueue_mints_monotone_seq_under_mapping_lock(svc):
    """Concurrent enqueues serialize on the mapping row: queue_seq is strictly
    increasing with no duplicates and no gaps."""
    _seed(svc)
    barrier = threading.Barrier(4)
    errors = []

    def enqueue(trigger):
        try:
            barrier.wait(timeout=15)
            payload = svc.queue_run_for_message(
                conversation_id="conv", trigger_message_id=trigger, current_user_id=2,
            )
            assert payload is not None
        except Exception as exc:  # noqa: BLE001
            errors.append(exc)

    threads = [threading.Thread(target=enqueue, args=(f"m{i}",)) for i in range(4)]
    for thread in threads:
        thread.start()
    for thread in threads:
        thread.join(timeout=60)
    assert not errors
    with svc.session() as db:
        seqs = sorted(
            row.queue_seq
            for row in db.execute(
                select(AppAiBotRun).where(AppAiBotRun.conversation_id == "conv")
            ).scalars()
        )
        mapping = db.execute(
            select(AppAiBotConversation).where(AppAiBotConversation.conversation_id == "conv")
        ).scalar_one()
    assert seqs == [1, 2, 3, 4]
    assert mapping.last_run_seq == 4


def test_pg_enqueue_cannot_overtake_during_claim(svc):
    """While a claim transaction holds the mapping lock, a concurrent enqueue
    blocks on the same lock — no earlier run can appear inside the claim
    window."""
    _seed(svc)
    _add_run(svc, "r1", seq=1)
    lock_held = threading.Event()
    enqueue_done = threading.Event()
    errors = []

    def hold_mapping_lock():
        try:
            db = Session(svc.engine, expire_on_commit=False)
            db.begin()
            locked = db.execute(
                select(AppAiBotConversation.id)
                .where(AppAiBotConversation.conversation_id == "conv")
                .with_for_update(nowait=True)
            ).scalar_one_or_none()
            assert locked is not None
            lock_held.set()
            time.sleep(0.8)
            # The enqueue must still be blocked on the same row lock.
            assert not enqueue_done.is_set(), "enqueue committed while the mapping lock was held"
            db.commit()
            db.close()
        except Exception as exc:  # noqa: BLE001
            errors.append(exc)

    def enqueue():
        try:
            lock_held.wait(timeout=15)
            payload = svc.queue_run_for_message(
                conversation_id="conv", trigger_message_id="m2", current_user_id=2,
            )
            assert payload is not None
            enqueue_done.set()
        except Exception as exc:  # noqa: BLE001
            errors.append(exc)

    holder = threading.Thread(target=hold_mapping_lock)
    writer = threading.Thread(target=enqueue)
    holder.start()
    writer.start()
    holder.join(timeout=60)
    writer.join(timeout=60)
    assert not errors
    assert enqueue_done.is_set()


MIGRATION_SCHEMA = "a4migtest"
MIGRATION_DUP_SCHEMA = "a4migduptest"


def _migration_module():
    import importlib.util
    from pathlib import Path

    path = (
        Path(__file__).resolve().parent.parent
        / "WEB-itinvent" / "backend" / "alembic" / "versions"
        / "20261118_0176_ai_bot_run_conversation_serialization.py"
    )
    spec = importlib.util.spec_from_file_location("a4_migration_0176", path)
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module


def _scratch_schema_engine(schema):
    admin = create_engine(PG_URL, pool_pre_ping=True)
    with admin.connect() as conn:
        conn.execute(text(f'DROP SCHEMA IF EXISTS "{schema}" CASCADE'))
        conn.execute(text(f'CREATE SCHEMA "{schema}"'))
        conn.commit()
    admin.dispose()
    engine = create_engine(PG_URL, pool_pre_ping=True).execution_options(
        schema_translate_map={"app": schema, "system": schema, "chat": schema}
    )
    from backend.appdb.models import AppBase

    AppBase.metadata.create_all(
        engine,
        tables=[
            AppAiBotRun.__table__,
            AppAiBotConversation.__table__,
            AppAiBot.__table__,
            AppUser.__table__,
        ],
    )
    # Recreate the PRE-migration schema: drop the new columns and indexes so
    # the upgrade has to add them, not just find them already present.
    with engine.begin() as conn:
        conn.execute(text(f'ALTER TABLE "{schema}"."ai_bot_runs" DROP COLUMN IF EXISTS queue_seq'))
        conn.execute(text(f'ALTER TABLE "{schema}"."ai_bot_conversations" DROP COLUMN IF EXISTS last_run_seq'))
        conn.execute(text(f'DROP INDEX IF EXISTS "{schema}"."uq_app_ai_bot_runs_running_conversation"'))
        conn.execute(text(f'DROP INDEX IF EXISTS "{schema}"."ix_app_ai_bot_runs_conversation_status_queue_seq"'))
    return engine


def _run_upgrade_0176(engine, schema, monkeypatch):
    from alembic.migration import MigrationContext
    from alembic.operations import Operations

    module = _migration_module()
    monkeypatch.setenv("ITINVENT_MIGRATION_APP_SCHEMA", schema)
    try:
        with engine.connect() as conn:
            ctx = MigrationContext.configure(conn)
            with ctx.begin_transaction():
                with Operations.context(ctx):
                    module.upgrade()
            conn.commit()
    finally:
        monkeypatch.delenv("ITINVENT_MIGRATION_APP_SCHEMA", raising=False)


def test_pg_migration_0176_backfill_and_indexes(svc, monkeypatch):
    """Rehearse the real alembic upgrade on a scratch schema: columns, per-
    conversation queue_seq backfill in (created_at, id) order, last_run_seq
    continuation, and both new indexes present."""
    engine = _scratch_schema_engine(MIGRATION_SCHEMA)
    try:
        t0 = datetime.now(timezone.utc)
        with engine.begin() as conn:
            conn.execute(text(
                f'INSERT INTO "{MIGRATION_SCHEMA}"."ai_bot_conversations" (bot_id, user_id, conversation_id, rolling_summary, summary_until_seq, context_reset_seq, use_personal_memory, title_source, created_at, updated_at) '
                "VALUES ('agent', 2, 'convM', '', 0, 0, true, 'assistant', now(), now())"
            ))
            for run_id, created in (("old", t0), ("new", t0 + timedelta(seconds=5))):
                conn.execute(text(
                    f'INSERT INTO "{MIGRATION_SCHEMA}"."ai_bot_runs" (id, bot_id, conversation_id, user_id, trigger_message_id, status, request_json, result_json, usage_json, created_at, updated_at) '
                    f"VALUES ('{run_id}', 'agent', 'convM', 2, 'm-{run_id}', 'queued', '{{}}', '{{}}', '{{}}', :created, :created)"
                ), {"created": created})
        _run_upgrade_0176(engine, MIGRATION_SCHEMA, monkeypatch)
        with engine.connect() as conn:
            seqs = dict(conn.execute(text(f'SELECT id, queue_seq FROM "{MIGRATION_SCHEMA}"."ai_bot_runs" ORDER BY queue_seq')).all())
            last_seq = conn.execute(text(f'SELECT last_run_seq FROM "{MIGRATION_SCHEMA}"."ai_bot_conversations" WHERE conversation_id = \'convM\'')).scalar_one()
            index_names = {
                row[0] for row in conn.execute(text(
                    "SELECT indexname FROM pg_indexes WHERE schemaname = :schema AND tablename = 'ai_bot_runs'"
                ), {"schema": MIGRATION_SCHEMA})
            }
        assert seqs == {"old": 1, "new": 2}
        assert last_seq == 2
        assert "uq_app_ai_bot_runs_running_conversation" in index_names
        assert "ix_app_ai_bot_runs_conversation_status_queue_seq" in index_names
    finally:
        engine.dispose()


def test_pg_migration_0176_refuses_duplicate_running(svc, monkeypatch):
    """The upgrade must fail loudly (not auto-fix) when a conversation already
    has two committed running rows."""
    engine = _scratch_schema_engine(MIGRATION_DUP_SCHEMA)
    try:
        with engine.begin() as conn:
            for run_id in ("run1", "run2"):
                conn.execute(text(
                    f'INSERT INTO "{MIGRATION_DUP_SCHEMA}"."ai_bot_runs" (id, bot_id, conversation_id, user_id, trigger_message_id, status, request_json, result_json, usage_json, created_at, updated_at) '
                    f"VALUES ('{run_id}', 'agent', 'convDup', 2, 'm-{run_id}', 'running', '{{}}', '{{}}', '{{}}', now(), now())"
                ))
        with pytest.raises(RuntimeError, match="duplicate running"):
            _run_upgrade_0176(engine, MIGRATION_DUP_SCHEMA, monkeypatch)
    finally:
        engine.dispose()


def test_pg_load_100_runs_20_conversations_4_workers(svc):
    """Load: 20 conversations x 5 runs, 4 worker threads that claim (commit),
    emulate work, then complete and re-claim — like real worker processes.
    Verified: every run completes exactly once, per-conversation completion
    order equals queue_seq order, the queue fully drains, no claim errors."""
    conversations = [f"conv{i:02d}" for i in range(20)]
    _seed(svc, conversations=conversations)
    for conv in conversations:
        for seq in range(1, 6):
            _add_run(svc, f"{conv}-r{seq}", conv=conv, seq=seq)
    completion_order: dict[str, list[str]] = {conv: [] for conv in conversations}
    order_lock = threading.Lock()
    errors = []
    started_at = time.monotonic()

    def worker():
        while True:
            try:
                with svc.session() as db:
                    run = svc._claim_next_queued_run(db)
                    run_id = run.id if run is not None else None
                    conv_id = run.conversation_id if run is not None else None
                if run_id is None:
                    return
                time.sleep(0.002)  # stand-in for the LLM/tool window
                with svc.session() as db:
                    changed = db.execute(
                        update(AppAiBotRun)
                        .where(AppAiBotRun.id == run_id, AppAiBotRun.status.in_(["queued", "running"]))
                        .values(status="completed", completed_at=datetime.now(timezone.utc),
                                updated_at=datetime.now(timezone.utc))
                    )
                    if int(changed.rowcount or 0) == 1:
                        with order_lock:
                            completion_order[conv_id].append(run_id)
            except Exception as exc:  # noqa: BLE001
                errors.append(exc)
                return

    threads = [threading.Thread(target=worker) for _ in range(4)]
    for thread in threads:
        thread.start()
    deadline = time.monotonic() + 120
    for thread in threads:
        thread.join(timeout=max(1, deadline - time.monotonic()))
    assert not any(thread.is_alive() for thread in threads), "load test timed out — queue did not drain"
    assert not errors
    elapsed = time.monotonic() - started_at

    for conv in conversations:
        expected = [f"{conv}-r{i}" for i in range(1, 6)]
        assert completion_order[conv] == expected, f"FIFO violated in {conv}: {completion_order[conv]}"
    with svc.session() as db:
        remaining = list(db.execute(
            select(AppAiBotRun).where(AppAiBotRun.status.in_(["queued", "running"]))
        ).scalars())
    assert not remaining, f"lost or stuck runs: {[row.id for row in remaining]}"
    print(f"\nA4 load: 100 runs / 20 conversations / 4 workers in {elapsed:.2f}s")


def test_pg_claim_skips_eight_locked_heads_to_reach_free_conversation(svc):
    """Starvation guard: the 8 oldest heads sit on conversations whose mapping
    rows are locked by other transactions; a free 9th head must still be
    claimed in the SAME call via keyset pagination — not returned as
    'no work' after the first page."""
    locked_convs = [f"locked{i:02d}" for i in range(8)]
    free_conv = "free99"
    _seed(svc, conversations=locked_convs + [free_conv])
    t0 = datetime.now(timezone.utc)
    for idx, conv in enumerate(locked_convs):
        _add_run(svc, f"{conv}-r1", conv=conv, seq=1, created_at=t0 + timedelta(seconds=idx))
    _add_run(svc, f"{free_conv}-r1", conv=free_conv, seq=1,
             created_at=t0 + timedelta(seconds=60))
    lockers = []
    try:
        for conv in locked_convs:
            locker = Session(svc.engine, expire_on_commit=False)
            locker.begin()
            locked = locker.execute(
                select(AppAiBotConversation.id)
                .where(AppAiBotConversation.conversation_id == conv)
                .with_for_update()
            ).scalar_one_or_none()
            assert locked is not None
            lockers.append(locker)
        assert _claim(svc) == f"{free_conv}-r1"
    finally:
        for locker in lockers:
            locker.rollback()
            locker.close()
    # After the locks release, the previously contended conversations claim
    # normally and in order.
    assert _claim(svc) == "locked00-r1"


def test_pg_load_with_continuous_enqueue(svc):
    """4 workers drain while a producer keeps enqueueing across 10
    conversations: nothing is lost, per-conversation completion order equals
    enqueue order even though enqueue and claim interleave."""
    conversations = [f"enq{i:02d}" for i in range(10)]
    _seed(svc, conversations=conversations)
    rounds = 3
    errors = []
    producer_done = threading.Event()
    stop_workers = threading.Event()
    completion_order: dict[str, list[str]] = {conv: [] for conv in conversations}
    order_lock = threading.Lock()

    def producer():
        try:
            for step in range(rounds):
                for conv in conversations:
                    payload = svc.queue_run_for_message(
                        conversation_id=conv,
                        trigger_message_id=f"{conv}-m{step}",
                        current_user_id=2,
                    )
                    assert payload is not None
                time.sleep(0.01)
        except Exception as exc:  # noqa: BLE001
            errors.append(exc)
        finally:
            producer_done.set()

    def queue_idle() -> bool:
        with svc.session() as db:
            pending = db.execute(
                select(AppAiBotRun.id).where(AppAiBotRun.status.in_(["queued", "running"])).limit(1)
            ).first()
        return pending is None

    def worker():
        while not stop_workers.is_set():
            try:
                with svc.session() as db:
                    run = svc._claim_next_queued_run(db)
                    run_id = run.id if run is not None else None
                    conv_id = run.conversation_id if run is not None else None
                if run_id is None:
                    time.sleep(0.005)
                    continue
                time.sleep(0.002)
                with svc.session() as db:
                    changed = db.execute(
                        update(AppAiBotRun)
                        .where(AppAiBotRun.id == run_id, AppAiBotRun.status.in_(["queued", "running"]))
                        .values(status="completed", completed_at=datetime.now(timezone.utc),
                                updated_at=datetime.now(timezone.utc))
                    )
                    if int(changed.rowcount or 0) == 1:
                        with order_lock:
                            completion_order[conv_id].append(run_id)
            except Exception as exc:  # noqa: BLE001
                errors.append(exc)
                return

    threads = [threading.Thread(target=worker) for _ in range(4)]
    for thread in threads:
        thread.start()
    prod = threading.Thread(target=producer)
    prod.start()
    prod.join(timeout=60)
    deadline = time.monotonic() + 120
    while not queue_idle() and time.monotonic() < deadline:
        time.sleep(0.02)
    stop_workers.set()
    for thread in threads:
        thread.join(timeout=60)
    assert not any(thread.is_alive() for thread in threads), "queue did not drain under continuous enqueue"
    assert not errors
    assert queue_idle()
    for conv in conversations:
        completed = completion_order[conv]
        assert len(completed) == rounds, f"{conv}: {completed}"
        with svc.session() as db:
            seq_by_id = {
                row.id: row.queue_seq
                for row in db.execute(
                    select(AppAiBotRun).where(AppAiBotRun.conversation_id == conv)
                ).scalars()
            }
        assert [seq_by_id[run_id] for run_id in completed] == sorted(seq_by_id[run_id] for run_id in completed), \
            f"FIFO violated in {conv}: {completed}"
    print(f"\nA4 enqueue-during-claim load: {rounds * len(conversations)} runs / "
          f"{len(conversations)} conversations / 4 workers drained")


MIGRATION_BULK_SCHEMA = "a4migbulktest"
MIGRATION_INVALID_SCHEMA = "a4miginvtest"


def test_pg_migration_0176_backfill_large_table_timed(svc, monkeypatch):
    """Backfill scale check: 3000 pre-existing runs over 30 conversations are
    assigned queue_seq by a single ROW_NUMBER pass. Verified: contiguous
    1..N per conversation in (created_at, id) order, last_run_seq continued,
    and the actual wall time is reported."""
    engine = _scratch_schema_engine(MIGRATION_BULK_SCHEMA)
    try:
        with engine.begin() as conn:
            for idx in range(30):
                conn.execute(text(
                    f'INSERT INTO "{MIGRATION_BULK_SCHEMA}"."ai_bot_conversations" (bot_id, user_id, conversation_id, rolling_summary, summary_until_seq, context_reset_seq, use_personal_memory, title_source, created_at, updated_at) '
                    f"VALUES ('agent', 2, 'convb{idx}', '', 0, 0, true, 'assistant', now(), now())"
                ))
            conn.execute(text(
                f'INSERT INTO "{MIGRATION_BULK_SCHEMA}"."ai_bot_runs" (id, bot_id, conversation_id, user_id, trigger_message_id, status, request_json, result_json, usage_json, created_at, updated_at) '
                "SELECT 'bulk-' || g, 'agent', 'convb' || (g % 30), 2, 'm-' || g, 'queued', '{}', '{}', '{}', "
                "now() + (g::text || ' milliseconds')::interval, now() FROM generate_series(1, 3000) g"
            ))
        started = time.monotonic()
        _run_upgrade_0176(engine, MIGRATION_BULK_SCHEMA, monkeypatch)
        elapsed = time.monotonic() - started
        with engine.connect() as conn:
            wrong_order = conn.execute(text(
                f'SELECT COUNT(*) FROM ('
                f'SELECT id, queue_seq, ROW_NUMBER() OVER (PARTITION BY conversation_id ORDER BY created_at, id) AS rn '
                f'FROM "{MIGRATION_BULK_SCHEMA}"."ai_bot_runs") t WHERE queue_seq <> rn'
            )).scalar_one()
            last_seqs = conn.execute(text(
                f'SELECT c.conversation_id, c.last_run_seq, '
                f'(SELECT COUNT(*) FROM "{MIGRATION_BULK_SCHEMA}"."ai_bot_runs" r WHERE r.conversation_id = c.conversation_id) AS n '
                f'FROM "{MIGRATION_BULK_SCHEMA}"."ai_bot_conversations" c'
            )).all()
        assert wrong_order == 0
        for conv_id, last_seq, count in last_seqs:
            assert last_seq == count == 100, (conv_id, last_seq, count)
        assert elapsed < 120, f"backfill of 3000 rows took {elapsed:.1f}s"
        print(f"\nA4 migration backfill: 3000 rows / 30 conversations in {elapsed:.2f}s")
    finally:
        engine.dispose()


def test_pg_migration_0176_rebuilds_invalid_index(svc, monkeypatch):
    """Old-worker-window rehearsal: a CREATE UNIQUE INDEX CONCURRENTLY that
    loses to a duplicate running row leaves an INVALID index behind (what an
    upgrade attempted while old workers still claim would produce). Verified:
    a retried upgrade drops the INVALID index and rebuilds a VALID one after
    the operator resolved the duplicate."""
    engine = _scratch_schema_engine(MIGRATION_INVALID_SCHEMA)
    try:
        with engine.begin() as conn:
            conn.execute(text(
                f'INSERT INTO "{MIGRATION_INVALID_SCHEMA}"."ai_bot_conversations" (bot_id, user_id, conversation_id, rolling_summary, summary_until_seq, context_reset_seq, use_personal_memory, title_source, created_at, updated_at) '
                "VALUES ('agent', 2, 'convInv', '', 0, 0, true, 'assistant', now(), now())"
            ))
            for run_id in ("runA", "runB"):
                conn.execute(text(
                    f'INSERT INTO "{MIGRATION_INVALID_SCHEMA}"."ai_bot_runs" (id, bot_id, conversation_id, user_id, trigger_message_id, status, request_json, result_json, usage_json, created_at, updated_at) '
                    f"VALUES ('{run_id}', 'agent', 'convInv', 2, 'm-{run_id}', 'running', '{{}}', '{{}}', '{{}}', now(), now())"
                ))
        # Simulate the failed concurrent build a mid-deploy old worker would cause.
        with engine.connect().execution_options(isolation_level="AUTOCOMMIT") as conn:
            with pytest.raises(Exception):
                conn.execute(text(
                    f'CREATE UNIQUE INDEX CONCURRENTLY "uq_app_ai_bot_runs_running_conversation" '
                    f'ON "{MIGRATION_INVALID_SCHEMA}"."ai_bot_runs" (conversation_id) WHERE status = \'running\''
                ))
        with engine.connect() as conn:
            valid = conn.execute(text(
                "SELECT indisvalid FROM pg_index WHERE indexrelid = CAST(:name AS regclass)"
            ), {"name": f"{MIGRATION_INVALID_SCHEMA}.uq_app_ai_bot_runs_running_conversation"}).scalar_one()
        assert valid is False, "expected the failed CONCURRENTLY build to leave an INVALID index"
        # Operator resolves the duplicate (cancel one run), then re-runs upgrade.
        with engine.begin() as conn:
            conn.execute(text(
                f'UPDATE "{MIGRATION_INVALID_SCHEMA}"."ai_bot_runs" SET status = \'cancelled\' WHERE id = \'runB\''
            ))
        _run_upgrade_0176(engine, MIGRATION_INVALID_SCHEMA, monkeypatch)
        with engine.connect() as conn:
            valid = conn.execute(text(
                "SELECT indisvalid FROM pg_index WHERE indexrelid = CAST(:name AS regclass)"
            ), {"name": f"{MIGRATION_INVALID_SCHEMA}.uq_app_ai_bot_runs_running_conversation"}).scalar_one()
        assert valid is True
    finally:
        engine.dispose()
