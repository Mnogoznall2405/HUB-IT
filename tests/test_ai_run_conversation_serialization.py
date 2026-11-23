"""A4 conversation-level serialization of AI runs — logic tests on sqlite.

The real cross-process guarantee is proven by tests/test_ai_run_serialization_pg.py
against PostgreSQL (mapping-row lock + partial unique index). These tests pin the
claim semantics that sqlite can express: head-of-conversation selection, FIFO key
(queue_seq, created_at, id), busy-conversation skip, and terminal-state release.
"""
import threading
import conftest
from contextlib import contextmanager
from datetime import datetime, timedelta, timezone

import pytest
from sqlalchemy import create_engine, event, select, update
from sqlalchemy.orm import Session

from backend.appdb.models import AppUser, AppAiBot, AppAiBotConversation, AppAiBotRun
from backend.ai_chat import service as service_module


@pytest.fixture
def svc(tmp_path, monkeypatch):
    conftest.copy_app_metadata_schema(tmp_path / "a4.db")
    engine = create_engine(
        f"sqlite:///{tmp_path / 'a4.db'}",
        execution_options={"schema_translate_map": {"app": None, "system": None}},
        connect_args={"check_same_thread": False, "timeout": 30},
    )

    @contextmanager
    def session():
        # Same contract as backend.appdb.db.app_session: commit on clean exit,
        # rollback on error; inner rollbacks are legal mid-transaction.
        db = Session(engine, expire_on_commit=False)
        try:
            yield db
            db.commit()
        except Exception:
            db.rollback()
            raise
        finally:
            db.close()

    monkeypatch.setattr(service_module, "app_session", session)
    svc = service_module.AiChatService()
    svc.session = session
    yield svc
    engine.dispose()


def _seed(svc, *, bots=("agent",), conversations=()):
    now = datetime.now(timezone.utc)
    with svc.session() as db:
        db.add(AppUser(id=2, username="owner", role="viewer"))
        for bot_id in bots:
            db.add(AppAiBot(id=bot_id, slug=f"slug-{bot_id}", title=bot_id))
        for conv in conversations:
            db.add(AppAiBotConversation(bot_id="agent", user_id=2, conversation_id=conv))


def _add_run(svc, run_id, conv="conv", *, status="queued", seq=None, created_at=None, trigger="m"):
    with svc.session() as db:
        db.add(AppAiBotRun(
            id=run_id, bot_id="agent", conversation_id=conv, user_id=2,
            trigger_message_id=trigger, status=status, queue_seq=seq,
            created_at=created_at or datetime.now(timezone.utc),
            updated_at=datetime.now(timezone.utc),
        ))


def _statuses(svc):
    with svc.session() as db:
        return {
            row.id: row.status
            for row in db.execute(select(AppAiBotRun)).scalars()
        }


def _claim(svc):
    with svc.session() as db:
        run = svc._claim_next_queued_run(db)
        return run.id if run is not None else None


def _finish(svc, run_id, status="completed"):
    with svc.session() as db:
        db.execute(
            update(AppAiBotRun)
            .where(AppAiBotRun.id == run_id, AppAiBotRun.status.in_(["queued", "running"]))
            .values(status=status, completed_at=datetime.now(timezone.utc))
        )


def test_claim_picks_oldest_head_of_idle_conversation(svc):
    _seed(svc, conversations=("conv",))
    t0 = datetime.now(timezone.utc)
    _add_run(svc, "r1", seq=1, created_at=t0)
    _add_run(svc, "r2", seq=2, created_at=t0 + timedelta(seconds=1))
    assert _claim(svc) == "r1"
    assert _statuses(svc)["r1"] == "running"


def test_busy_conversation_is_skipped_for_other_conversations(svc):
    _seed(svc, conversations=("convA", "convB"))
    t0 = datetime.now(timezone.utc)
    _add_run(svc, "a1", conv="convA", status="running", seq=1, created_at=t0)
    _add_run(svc, "a2", conv="convA", seq=2, created_at=t0 + timedelta(seconds=1))
    _add_run(svc, "b1", conv="convB", seq=1, created_at=t0 + timedelta(seconds=2))
    assert _claim(svc) == "b1"
    statuses = _statuses(svc)
    assert statuses["a2"] == "queued" and statuses["b1"] == "running"


def test_fifo_release_after_terminal_state(svc):
    _seed(svc, conversations=("conv",))
    t0 = datetime.now(timezone.utc)
    for idx, run_id in enumerate(("r1", "r2", "r3"), start=1):
        _add_run(svc, run_id, seq=idx, created_at=t0 + timedelta(seconds=idx))
    assert _claim(svc) == "r1"
    # While r1 runs, the same conversation yields nothing.
    assert _claim(svc) is None
    _finish(svc, "r1")
    assert _claim(svc) == "r2"
    _finish(svc, "r2", status="cancelled")
    assert _claim(svc) == "r3"


def test_queue_seq_is_the_fifo_key_not_created_at(svc):
    _seed(svc, conversations=("conv",))
    t0 = datetime.now(timezone.utc)
    # r_new has an earlier created_at but a LATER queue_seq — the enqueue order wins.
    _add_run(svc, "r_early_seq", seq=1, created_at=t0 + timedelta(seconds=5))
    _add_run(svc, "r_late_seq", seq=2, created_at=t0)
    assert _claim(svc) == "r_early_seq"
    _finish(svc, "r_early_seq")
    assert _claim(svc) == "r_late_seq"


def test_null_queue_seq_falls_back_to_created_at_id(svc):
    _seed(svc, conversations=("conv",))
    t0 = datetime.now(timezone.utc)
    _add_run(svc, "r2", seq=None, created_at=t0 + timedelta(seconds=1))
    _add_run(svc, "r1", seq=None, created_at=t0)
    assert _claim(svc) == "r1"


def test_two_threads_cannot_claim_two_runs_of_one_conversation(svc):
    _seed(svc, conversations=("conv",))
    t0 = datetime.now(timezone.utc)
    _add_run(svc, "r1", seq=1, created_at=t0)
    _add_run(svc, "r2", seq=2, created_at=t0 + timedelta(seconds=1))
    barrier = threading.Barrier(2)
    claimed, errors = [], []

    def worker():
        try:
            barrier.wait(timeout=10)
            run_id = _claim(svc)
            if run_id is not None:
                claimed.append(run_id)
        except Exception as exc:  # noqa: BLE001 - test records thread failures
            errors.append(exc)

    threads = [threading.Thread(target=worker) for _ in range(2)]
    for thread in threads:
        thread.start()
    for thread in threads:
        thread.join(timeout=30)
    assert not errors
    # One winner at most; the loser either got nothing or — impossible here —
    # a different conversation's run. Under sqlite the file lock serializes
    # the whole claim, so exactly one claim succeeds.
    assert len(claimed) == 1
    statuses = _statuses(svc)
    assert sum(1 for status in statuses.values() if status == "running") == 1
    assert statuses["r2"] == "queued"


def test_earlier_sibling_cancelled_mid_claim_does_not_block(svc):
    _seed(svc, conversations=("conv",))
    t0 = datetime.now(timezone.utc)
    _add_run(svc, "r1", seq=1, created_at=t0)
    _add_run(svc, "r2", seq=2, created_at=t0 + timedelta(seconds=1))
    _finish(svc, "r1", status="cancelled")
    assert _claim(svc) == "r2"


def test_enqueue_assigns_monotone_queue_seq_under_mapping_lock(svc, monkeypatch):
    from backend.ai_chat import access as access_module

    _seed(svc, conversations=("conv",))
    monkeypatch.setattr(access_module, "require_bot_access", lambda *args, **kwargs: None)
    monkeypatch.setattr(service_module.user_service, "get_by_id", lambda user_id: {"id": user_id})
    monkeypatch.setattr(svc, "_publish_status_event", lambda **kwargs: None)
    monkeypatch.setattr(svc, "_record_conversation_activity", lambda **kwargs: None)
    for trigger in ("m1", "m2", "m3"):
        payload = svc.queue_run_for_message(
            conversation_id="conv", trigger_message_id=trigger, current_user_id=2,
        )
        assert payload is not None
    with svc.session() as db:
        seqs = [
            row.queue_seq
            for row in db.execute(
                select(AppAiBotRun).where(AppAiBotRun.conversation_id == "conv")
                .order_by(AppAiBotRun.created_at.asc())
            ).scalars()
        ]
        mapping = db.execute(
            select(AppAiBotConversation).where(AppAiBotConversation.conversation_id == "conv")
        ).scalar_one()
    assert seqs == [1, 2, 3]
    assert mapping.last_run_seq == 3


class _FakeDbapiError(Exception):
    def __init__(self, message="db error", *, sqlstate=None, constraint_name=None):
        super().__init__(message)
        self.sqlstate = sqlstate
        self.diag = type("Diag", (), {"constraint_name": constraint_name})()


def _operational_error(sqlstate):
    from sqlalchemy.exc import OperationalError

    return OperationalError("SELECT 1", {}, _FakeDbapiError(sqlstate=sqlstate))


def _integrity_error(sqlstate=None, constraint_name=None, message="unique failed"):
    from sqlalchemy.exc import IntegrityError

    return IntegrityError("UPDATE t", {}, _FakeDbapiError(message, sqlstate=sqlstate, constraint_name=constraint_name))


def test_claim_contention_classifier_accepts_expected_sqlstates(svc):
    for sqlstate in ("55P03", "40P01", "40001"):
        assert svc._is_claim_contention(_operational_error(sqlstate)), sqlstate


def test_claim_contention_classifier_rejects_unexpected_errors(svc):
    # Connection loss (08xxx), missing table (42P01), auth failure (28xxx):
    # real failures must propagate, never look like "queue is empty".
    for sqlstate in ("08006", "42P01", "28000", "57P01"):
        assert not svc._is_claim_contention(_operational_error(sqlstate)), sqlstate


def test_claim_contention_classifier_backstop_unique_index_only(svc):
    backstop = _integrity_error(
        sqlstate="23505",
        constraint_name="uq_app_ai_bot_runs_running_conversation",
        message='duplicate key value violates unique constraint "uq_app_ai_bot_runs_running_conversation"',
    )
    assert svc._is_claim_contention(backstop)
    other = _integrity_error(
        sqlstate="23505",
        constraint_name="uq_ai_bot_runs_trigger",
        message='duplicate key value violates unique constraint "uq_ai_bot_runs_trigger"',
    )
    assert not svc._is_claim_contention(other)
    # NOT NULL / FK violations are never contention.
    not_null = _integrity_error(sqlstate="23502", constraint_name=None, message="null value violates not-null constraint")
    assert not svc._is_claim_contention(not_null)


def test_claim_contention_classifier_sqlite_backstop_message(svc):
    sqlite_dup = _integrity_error(message="UNIQUE constraint failed: ai_bot_runs.conversation_id")
    assert svc._is_claim_contention(sqlite_dup)
    sqlite_index = _integrity_error(
        message="UNIQUE constraint failed: index 'uq_app_ai_bot_runs_running_conversation'"
    )
    assert svc._is_claim_contention(sqlite_index)
    not_null = _integrity_error(message="NOT NULL constraint failed: ai_bot_runs.status")
    assert not svc._is_claim_contention(not_null)
