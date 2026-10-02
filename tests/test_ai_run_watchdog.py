"""AI3 watchdog: stale queued/running runs are failed and published; sqlite only."""
from contextlib import contextmanager
from datetime import datetime, timedelta, timezone

import pytest
from sqlalchemy import create_engine
from sqlalchemy.orm import Session

from backend.appdb.models import AppBase, AppUser, AppAiBot, AppAiBotConversation, AppAiBotRun
from backend.ai_chat import service as service_module


@pytest.fixture
def database(tmp_path, monkeypatch):
    engine = create_engine(
        f"sqlite:///{tmp_path / 'watchdog.db'}",
        execution_options={'schema_translate_map': {'app': None, 'system': None}},
    )
    AppBase.metadata.create_all(engine, tables=[table for table in AppBase.metadata.sorted_tables
        if table.name.startswith(('ai_',)) or table.name == 'users'])

    @contextmanager
    def session():
        with Session(engine) as db:
            with db.begin():
                yield db

    monkeypatch.setattr(service_module, 'app_session', session)
    svc = service_module.AiChatService()
    published = []
    monkeypatch.setattr(svc, '_publish_status_event', lambda **kwargs: published.append(kwargs))

    now = datetime.now(timezone.utc)
    stale = now - timedelta(hours=2)
    fresh = now - timedelta(seconds=10)
    with session() as db:
        db.add_all([
            AppUser(id=2, username='owner', role='viewer'),
            AppAiBot(id='agent', slug='corp-assistant', title='Assistant'),
            AppAiBotConversation(bot_id='agent', user_id=2, conversation_id='conv'),
            AppAiBotRun(id='stale-queued', bot_id='agent', conversation_id='conv', user_id=2,
                        trigger_message_id='m1', status='queued', created_at=stale, updated_at=stale),
            AppAiBotRun(id='stale-running', bot_id='agent', conversation_id='conv', user_id=2,
                        trigger_message_id='m2', status='running', created_at=stale, updated_at=stale),
            AppAiBotRun(id='fresh-queued', bot_id='agent', conversation_id='conv', user_id=2,
                        trigger_message_id='m3', status='queued', created_at=fresh, updated_at=fresh),
            AppAiBotRun(id='old-done', bot_id='agent', conversation_id='conv', user_id=2,
                        trigger_message_id='m4', status='completed', created_at=stale, updated_at=stale),
            AppAiBotRun(id='old-failed', bot_id='agent', conversation_id='conv', user_id=2,
                        trigger_message_id='m5', status='failed', created_at=stale, updated_at=stale),
        ])
    yield session, svc, published
    engine.dispose()


def test_reap_stale_runs_marks_failed_and_publishes(database):
    session, svc, published = database
    result = svc.reap_stale_runs(stale_after_sec=900)
    assert result['dry_run'] is False
    assert sorted(result['reaped_run_ids']) == ['stale-queued', 'stale-running']
    with session() as db:
        for run_id in ('stale-queued', 'stale-running'):
            run = db.get(AppAiBotRun, run_id)
            assert run.status == 'failed'
            assert run.completed_at is not None
            assert 'прерван' in (run.error_text or '')
        assert db.get(AppAiBotRun, 'fresh-queued').status == 'queued'
        assert db.get(AppAiBotRun, 'old-done').status == 'completed'
        assert db.get(AppAiBotRun, 'old-failed').status == 'failed'
    assert sorted(event['run_id'] for event in published) == ['stale-queued', 'stale-running']
    assert all(event['status'] == 'failed' for event in published)
    assert all(event['conversation_id'] == 'conv' for event in published)


def test_reap_stale_runs_dry_run_changes_nothing(database):
    session, svc, published = database
    result = svc.reap_stale_runs(dry_run=True, stale_after_sec=900)
    assert result['dry_run'] is True
    assert result['reaped_count'] == 2
    with session() as db:
        assert db.get(AppAiBotRun, 'stale-queued').status == 'queued'
        assert db.get(AppAiBotRun, 'stale-running').status == 'running'
        assert db.get(AppAiBotRun, 'stale-queued').completed_at is None
    assert published == []


def test_reap_stale_runs_respects_batch_size(database):
    session, svc, _published = database
    result = svc.reap_stale_runs(stale_after_sec=900, batch_size=1)
    assert result['reaped_count'] == 1
    with session() as db:
        remaining = [
            run_id for run_id in ('stale-queued', 'stale-running')
            if db.get(AppAiBotRun, run_id).status in ('queued', 'running')
        ]
    assert len(remaining) == 1


def test_reap_stale_runs_keeps_existing_error_text(database):
    session, svc, _published = database
    with session() as db:
        db.get(AppAiBotRun, 'stale-queued').error_text = 'boom'
    svc.reap_stale_runs(stale_after_sec=900)
    with session() as db:
        assert db.get(AppAiBotRun, 'stale-queued').error_text == 'boom'


def test_watchdog_flag_defaults_off(monkeypatch):
    import start_ai_chat_worker as worker

    monkeypatch.delenv('AI_RUN_WATCHDOG_ENABLED', raising=False)
    assert worker._env_flag('AI_RUN_WATCHDOG_ENABLED', False) is False
    monkeypatch.setenv('AI_RUN_WATCHDOG_ENABLED', '1')
    assert worker._env_flag('AI_RUN_WATCHDOG_ENABLED', False) is True
