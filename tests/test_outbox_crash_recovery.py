"""Crash recovery must honor the delivery budget without touching active jobs."""
from contextlib import contextmanager
from datetime import datetime, timedelta, timezone
import importlib

import pytest
from sqlalchemy import create_engine, select
from sqlalchemy.orm import Session
from concurrent.futures import ThreadPoolExecutor
from threading import Barrier, Event, Lock
from types import SimpleNamespace
import asyncio


@pytest.fixture(params=["app_push", "chat_push", "chat_event"])
def recovery_env(request, tmp_path, monkeypatch):
    from backend.appdb.models import AppPushOutbox
    from backend.chat.models import ChatEventOutbox, ChatPushOutbox

    module_name, class_name, model, session_name, env_prefix = {
        "app_push": ("backend.services.app_push_outbox_service", "AppPushOutboxService", AppPushOutbox, "app_session", "APP_PUSH_OUTBOX"),
        "chat_push": ("backend.chat.push_outbox_service", "ChatPushOutboxService", ChatPushOutbox, "chat_session", "CHAT_PUSH_OUTBOX"),
        "chat_event": ("backend.chat.event_outbox_service", "ChatEventOutboxService", ChatEventOutbox, "_aux_write_session", "CHAT_EVENT_OUTBOX"),
    }[request.param]
    module = importlib.import_module(module_name)
    engine = create_engine(
        f"sqlite:///{(tmp_path / 'recovery.db').as_posix()}",
        execution_options={"schema_translate_map": {"app": None, "chat": None}},
    )
    model.__table__.create(engine)

    @contextmanager
    def session_scope():
        with Session(engine) as session, session.begin():
            yield session

    monkeypatch.setattr(module, session_name, session_scope)
    monkeypatch.setenv(f"{env_prefix}_ENABLED", "1")
    monkeypatch.setenv(f"{env_prefix}_MAX_ATTEMPTS", "2")
    monkeypatch.setenv(f"{env_prefix}_PROCESSING_TIMEOUT_SEC", "60")
    now = datetime.now(timezone.utc)

    def seed(*, attempts, status="processing", stale=True, **overrides):
        values = dict(status=status, attempt_count=attempts, next_attempt_at=now,
                      updated_at=now - timedelta(seconds=61) if stale else now)
        if request.param == "chat_event":
            values.update(event_type="chat.message.created", target_user_id=1)
        else:
            values.update(recipient_user_id=1, title="Notification", body="Preview")
            if request.param == "app_push":
                values.update(dedupe_key=f"job-{attempts}-{status}-{stale}", expires_at=now + timedelta(hours=1))
            else:
                values.update(message_id=f"message-{attempts}-{status}-{stale}", conversation_id="conversation-1")
        values.update(overrides)
        with session_scope() as session:
            row = model(**values)
            session.add(row)
            session.flush()
            return row.id

    yield getattr(module, class_name)(), model, session_scope, seed
    engine.dispose()


def test_crash_recovery_stops_at_attempt_limit_and_preserves_active_jobs(recovery_env):
    worker, model, session_scope, seed = recovery_env
    retry_id = seed(attempts=1)
    exhausted_id = seed(attempts=2)
    over_limit_id = seed(attempts=3)
    active_id = seed(attempts=1, stale=False)
    terminal_id = seed(attempts=2, status="failed")

    assert worker.recover_stale_jobs() == 3
    with session_scope() as session:
        rows = {row.id: row for row in session.scalars(select(model))}
        assert rows[retry_id].status == "queued"
        assert rows[exhausted_id].status == "failed"
        assert rows[over_limit_id].status == "failed"
        assert rows[active_id].status == "processing"
        assert rows[terminal_id].status == "failed"
        assert rows[exhausted_id].attempt_count == 2
        assert "attempt" in rows[exhausted_id].last_error.lower()
    assert worker.recover_stale_jobs() == 0
    assert [job.id for job in worker.claim_jobs()] == [retry_id]


@pytest.mark.parametrize("old_outcome", ["success", "error"])
@pytest.mark.parametrize("new_finished", [False, True])
def test_stale_worker_cannot_finalize_a_new_attempt(recovery_env, monkeypatch, old_outcome, new_finished):
    worker, model, session_scope, seed = recovery_env
    job_id = seed(attempts=0, status="queued")
    old_job = worker.claim_jobs()[0]
    delivery_started = Event()
    release_old_delivery = Event()
    calls_lock = Lock()
    calls = 0

    def deliver(**kwargs):
        nonlocal calls
        with calls_lock:
            calls += 1
            is_old = calls == 1
        if is_old:
            delivery_started.set()
            assert release_old_delivery.wait(10), "old delivery was not released"
            if old_outcome == "error":
                raise RuntimeError("old attempt failed after recovery")
        return SimpleNamespace(sent=1, failed=0, disabled=0)

    module = importlib.import_module(type(worker).__module__)
    original_claim_jobs = worker.claim_jobs
    if model.__name__ == "ChatEventOutbox":
        async def publish(payload):
            await asyncio.to_thread(deliver)
        monkeypatch.setattr(module, "publish_event_job", publish)
        profile = importlib.import_module("backend.chat.latency_profile")
        monkeypatch.setattr(profile, "event_outbox_poll_enabled", lambda: True)
        monkeypatch.setattr(worker, "repair_missing_delivery_state_outbox", lambda: 0)
        process = lambda job: asyncio.run(worker.process_job(job))
        terminal_status = "delivered"
    else:
        method = "send_notification" if model.__name__ == "AppPushOutbox" else "send_chat_message_notification"
        monkeypatch.setattr(module.chat_push_service, method, deliver)
        monkeypatch.setattr(type(module.chat_push_service), "enabled", property(lambda self: True))
        if model.__name__ == "ChatPushOutbox":
            monkeypatch.setattr(worker, "_push_suppression_reason", lambda job: None)
        process = worker.process_job
        terminal_status = "sent"

    with ThreadPoolExecutor(max_workers=1, thread_name_prefix="stale-worker") as pool:
        if new_finished:
            # The snapshot was already claimed above; pause it inside a real poll
            # to verify that superseded work is not reported as sent/requeued.
            monkeypatch.setattr(worker, "claim_jobs", lambda limit=None: [old_job])
            old_result = pool.submit(lambda: asyncio.run(worker.poll_once()))
        else:
            old_result = pool.submit(process, old_job)
        try:
            assert delivery_started.wait(10), "old worker did not enter delivery"
            with session_scope() as session:
                session.get(model, job_id).updated_at = datetime.now(timezone.utc) - timedelta(seconds=61)
            assert worker.recover_stale_jobs() == 1
            new_job = original_claim_jobs()[0]
            assert new_job.attempt_count == old_job.attempt_count + 1
            if new_finished:
                assert process(new_job) == terminal_status
            with session_scope() as session:
                row = session.get(model, job_id)
                before = {column.name: getattr(row, column.name) for column in model.__table__.columns}
        finally:
            release_old_delivery.set()
        outcome = old_result.result(timeout=10)

    with session_scope() as session:
        row = session.get(model, job_id)
        after = {column.name: getattr(row, column.name) for column in model.__table__.columns}
    assert after == before
    if new_finished:
        assert outcome["superseded"] == 1
        for counter in ("sent", "delivered", "failed", "queued", "requeued"):
            assert outcome.get(counter, 0) == 0
    else:
        assert outcome == "superseded"
    if not new_finished:
        assert process(new_job) == terminal_status
        with session_scope() as session:
            assert session.get(model, job_id).status == terminal_status
    assert calls == 2  # At-least-once delivery; the DB state belongs to the new attempt.


def _interleave_after_read(monkeypatch, worker, session_scope, callback):
    """Finish the SELECT before pausing; all writes still use the real SQLite DB."""
    module = importlib.import_module(type(worker).__module__)
    session_name = "app_session" if "app_push" in module.__name__ else (
        "chat_session" if "push_outbox" in module.__name__ else "_aux_write_session"
    )

    @contextmanager
    def interleaved_session():
        with session_scope() as session:
            original_execute = session.execute
            read_interleaved = False

            def execute(statement, *args, **kwargs):
                nonlocal read_interleaved
                result = original_execute(statement, *args, **kwargs)
                if not read_interleaved and getattr(statement, "is_select", False):
                    read_interleaved = True
                    rows = list(result.scalars())
                    callback()
                    return SimpleNamespace(scalars=lambda: iter(rows), scalar_one_or_none=lambda: rows[0] if rows else None)
                return result

            monkeypatch.setattr(session, "execute", execute)
            yield session

    monkeypatch.setattr(module, session_name, interleaved_session)


def test_parallel_claims_only_deliver_one_owner(recovery_env, monkeypatch):
    worker, model, session_scope, seed = recovery_env
    job_id = seed(attempts=0, status="queued")
    both_read = Barrier(2)
    _interleave_after_read(monkeypatch, worker, session_scope, lambda: both_read.wait(timeout=10))
    with ThreadPoolExecutor(max_workers=2) as pool:
        results = list(pool.map(lambda _: worker.claim_jobs(), range(2)))
    jobs = [job for result in results for job in result]
    assert [job.id for job in jobs] == [job_id]
    assert jobs[0].attempt_count == 1
    with session_scope() as session:
        row = session.get(model, job_id)
        assert row.status == "processing"
        assert row.attempt_count == 1


def test_recovery_cannot_overwrite_owner_finishing_after_stale_read(recovery_env, monkeypatch):
    worker, model, session_scope, seed = recovery_env
    job_id = seed(attempts=1)
    finished = False

    def finish_owner():
        nonlocal finished
        if finished:
            return
        finished = True
        if model.__name__ == "ChatEventOutbox":
            assert worker.mark_delivered(job_id=job_id, attempt_count=1)
        elif model.__name__ == "ChatPushOutbox":
            assert worker.mark_sent(job_id=job_id, attempt_count=1)
        else:
            assert worker._update_job(job_id, attempt_count=1, status="sent")

    _interleave_after_read(monkeypatch, worker, session_scope, finish_owner)
    assert worker.recover_stale_jobs() == 0
    with session_scope() as session:
        row = session.get(model, job_id)
        assert row.status == ("delivered" if model.__name__ == "ChatEventOutbox" else "sent")
        assert row.last_error is None


@pytest.mark.parametrize("recovery_env", ["chat_event"], indirect=True)
def test_immediate_delivery_claim_competes_safely_with_background_worker(recovery_env, monkeypatch):
    from backend.chat.chat_delivery_state import CHAT_MESSAGE_DELIVERY_STATE_EVENT

    worker, model, session_scope, seed = recovery_env
    job_id = seed(attempts=0, status="queued", event_type=CHAT_MESSAGE_DELIVERY_STATE_EVENT, message_id="audit-message")
    both_read = Barrier(2)
    _interleave_after_read(monkeypatch, worker, session_scope, lambda: both_read.wait(timeout=10))

    def claim_background():
        jobs = worker.claim_jobs()
        return jobs[0] if jobs else None

    with ThreadPoolExecutor(max_workers=2) as pool:
        immediate = pool.submit(worker.claim_delivery_state_job_for_message, message_id="audit-message")
        background = pool.submit(claim_background)
        jobs = [job for job in [immediate.result(timeout=10), background.result(timeout=10)] if job is not None]
    assert [job.id for job in jobs] == [job_id]
    assert jobs[0].attempt_count == 1
