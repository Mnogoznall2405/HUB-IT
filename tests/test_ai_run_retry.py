"""R30 retry semantics: the retry targets the LAST run of the conversation, is blocked while a fresh
run is active (409), replaces a hung run, and parallel calls create exactly one new run.
sqlite only; BEGIN IMMEDIATE emulates the row lock (SELECT ... FOR UPDATE) of PostgreSQL."""
import threading
from contextlib import contextmanager
from datetime import datetime, timedelta, timezone

import pytest
from sqlalchemy import create_engine, event, select
from sqlalchemy.orm import Session

from backend.appdb.models import AppBase, AppUser, AppAiBot, AppAiBotConversation, AppAiBotRun
from backend.ai_chat import access as access_module
from backend.ai_chat import service as service_module


@pytest.fixture
def database(tmp_path, monkeypatch):
    engine = create_engine(
        f"sqlite:///{tmp_path / 'retry.db'}",
        execution_options={'schema_translate_map': {'app': None, 'system': None}},
        connect_args={'check_same_thread': False, 'timeout': 30},
    )

    @event.listens_for(engine, 'connect')
    def _no_implicit_begin(dbapi_connection, _record):
        dbapi_connection.isolation_level = None

    @event.listens_for(engine, 'begin')
    def _begin_immediate(connection):
        # Every transaction takes the write lock up front: a second retry waits for the
        # first one and then sees its queued run, like FOR UPDATE on the mapping row.
        connection.exec_driver_sql('BEGIN IMMEDIATE')

    AppBase.metadata.create_all(engine, tables=[table for table in AppBase.metadata.sorted_tables
        if table.name.startswith(('ai_',)) or table.name == 'users'])

    @contextmanager
    def session():
        with Session(engine, expire_on_commit=False) as db:
            with db.begin():
                yield db

    monkeypatch.setattr(service_module, 'app_session', session)
    monkeypatch.setattr(access_module, 'require_bot_access', lambda *args, **kwargs: None)
    monkeypatch.setattr(service_module.user_service, 'get_by_id', lambda user_id: {'id': user_id})
    monkeypatch.setenv('AI_RUN_WATCHDOG_STALE_SEC', '900')
    svc = service_module.AiChatService()
    events = []
    monkeypatch.setattr(svc, '_publish_status_event', lambda **kwargs: events.append(kwargs))

    now = datetime.now(timezone.utc)
    with session() as db:
        db.add_all([
            AppUser(id=2, username='owner', role='viewer'),
            AppAiBot(id='agent', slug='corp-assistant', title='Assistant'),
            AppAiBotConversation(bot_id='agent', user_id=2, conversation_id='conv'),
            AppAiBotRun(id='failed-1', bot_id='agent', conversation_id='conv', user_id=2,
                        trigger_message_id='m-old', status='failed',
                        created_at=now - timedelta(hours=2), updated_at=now - timedelta(hours=2)),
        ])
    svc.session = session
    svc.events = events
    yield svc
    engine.dispose()


def _add_run(svc, run_id, trigger, status, *, created_ago, updated_ago=None):
    now = datetime.now(timezone.utc)
    with svc.session() as db:
        db.add(AppAiBotRun(
            id=run_id, bot_id='agent', conversation_id='conv', user_id=2,
            trigger_message_id=trigger, status=status,
            created_at=now - created_ago, updated_at=now - (updated_ago if updated_ago is not None else created_ago),
        ))


def _runs(svc):
    with svc.session() as db:
        rows = list(db.execute(select(AppAiBotRun).order_by(AppAiBotRun.created_at.asc())).scalars())
        return [(row.id, row.trigger_message_id, row.status) for row in rows]


def test_retry_after_newer_completed_run_regenerates_that_run(database):
    svc = database
    _add_run(svc, 'done', 'm-done', 'completed', created_ago=timedelta(minutes=1))

    status = svc.retry_conversation_run(conversation_id='conv', current_user_id=2)

    runs = _runs(svc)
    assert [(trigger, state) for _, trigger, state in runs] == [
        ('m-old', 'failed'), ('m-done', 'completed'), ('m-done', 'queued'),
    ]
    assert status['status'] == 'queued'
    assert status['run_id'] == runs[-1][0]
    assert status['server_now']


def test_retry_requeues_trigger_of_latest_failed_run_not_an_older_one(database):
    svc = database
    _add_run(svc, 'failed-2', 'm-new', 'failed', created_ago=timedelta(minutes=5))

    svc.retry_conversation_run(conversation_id='conv', current_user_id=2)

    assert [(trigger, state) for _, trigger, state in _runs(svc)] == [
        ('m-old', 'failed'), ('m-new', 'failed'), ('m-new', 'queued'),
    ]


def test_retry_cancelled_run_is_allowed(database):
    svc = database
    _add_run(svc, 'cancelled-1', 'm-c', 'cancelled', created_ago=timedelta(minutes=2))

    svc.retry_conversation_run(conversation_id='conv', current_user_id=2)

    assert _runs(svc)[-1][1:] == ('m-c', 'queued')


def test_retry_rejected_with_conflict_while_fresh_run_is_active(database):
    svc = database
    _add_run(svc, 'running-1', 'm-live', 'running', created_ago=timedelta(minutes=1))

    with pytest.raises(service_module.AiRunConflictError) as exc_info:
        svc.retry_conversation_run(conversation_id='conv', current_user_id=2)

    assert 'готовится' in str(exc_info.value)
    assert [state for _, _, state in _runs(svc)] == ['failed', 'running']
    assert svc.events == []


def test_retry_cancels_hung_run_and_starts_a_new_one(database):
    svc = database
    _add_run(svc, 'hung', 'm-hung', 'running', created_ago=timedelta(hours=1))

    svc.retry_conversation_run(conversation_id='conv', current_user_id=2)

    runs = _runs(svc)
    assert runs[-2:] == [('hung', 'm-hung', 'cancelled'), (runs[-1][0], 'm-hung', 'queued')]
    assert [(item['status'], item['run_id']) for item in svc.events] == [
        ('cancelled', 'hung'), ('queued', runs[-1][0]),
    ]


def test_two_parallel_retries_create_exactly_one_new_run(database):
    svc = database
    _add_run(svc, 'done', 'm-done', 'completed', created_ago=timedelta(minutes=1))
    barrier = threading.Barrier(2)
    outcomes = []

    def worker():
        barrier.wait()
        try:
            svc.retry_conversation_run(conversation_id='conv', current_user_id=2)
            outcomes.append('ok')
        except service_module.AiRunConflictError:
            outcomes.append('conflict')

    threads = [threading.Thread(target=worker) for _ in range(2)]
    for thread in threads:
        thread.start()
    for thread in threads:
        thread.join(timeout=60)

    assert sorted(outcomes) == ['conflict', 'ok']
    assert [state for _, trigger, state in _runs(svc) if trigger == 'm-done'] == ['completed', 'queued']


def test_retry_rejects_non_owner(database):
    svc = database
    with pytest.raises(LookupError):
        svc.retry_conversation_run(conversation_id='conv', current_user_id=99)
    assert [state for _, _, state in _runs(svc)] == ['failed']


def test_retry_without_any_run(database):
    svc = database
    with svc.session() as db:
        db.query(AppAiBotRun).delete()
    with pytest.raises(LookupError):
        svc.retry_conversation_run(conversation_id='conv', current_user_id=2)
    assert _runs(svc) == []


def test_queue_run_for_message_survives_duplicate_runs_of_one_trigger(database, monkeypatch):
    svc = database
    monkeypatch.setattr(svc, '_record_conversation_activity', lambda **kwargs: None)
    _add_run(svc, 'again', 'm-old', 'failed', created_ago=timedelta(minutes=10))
    assert [trigger for _, trigger, _ in _runs(svc)].count('m-old') == 2

    # A repeated message.created delivery must return the existing run, not raise MultipleResultsFound.
    payload = svc.queue_run_for_message(conversation_id='conv', trigger_message_id='m-old', current_user_id=2)

    assert payload is not None and payload['id'] == 'again'
    assert len(_runs(svc)) == 2


def test_friendly_run_error_text_maps_provider_failures():
    friendly = service_module._friendly_run_error_text
    assert 'администраторы уведомлены' in friendly(Exception('OpenRouter HTTP 402: insufficient credits'))
    assert 'не ответил вовремя' in friendly(Exception('request timed out after 60s'))
    assert 'перегружен' in friendly(Exception('HTTP 429 rate limit exceeded'))
    assert 'временно недоступен' in friendly(Exception('HTTP 503 service unavailable'))
    assert friendly(Exception('some raw failure')) == 'some raw failure'
