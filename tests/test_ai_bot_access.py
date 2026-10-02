"""Agent grants are isolated from portal permissions; all DB work is local SQLite."""
import importlib
import json
from contextlib import contextmanager
from datetime import datetime, timedelta, timezone

import pytest
from sqlalchemy import create_engine, select
from sqlalchemy.orm import Session

from backend.appdb.models import AppUser, AppAiBot, AppAiBotAccess, AppAiBotConversation, AppAiBotRun
from backend.ai_chat import access
from backend.ai_sandbox.models import AppAiSandboxSession, AppAiSandboxJob, AppAiSandboxPermission

pytestmark = pytest.mark.integration


@pytest.fixture
def database(prebuilt_app_db, monkeypatch):
    engine = create_engine(f"sqlite:///{prebuilt_app_db.as_posix()}", execution_options={'schema_translate_map': {'app': None, 'system': None}})
    @contextmanager
    def session():
        with Session(engine) as db:
            with db.begin():
                yield db
    monkeypatch.setattr(access, 'app_session', session)
    with session() as db:
        db.add_all([
            AppUser(id=1, username='admin', role='admin', use_custom_permissions=True),
            AppUser(id=2, username='viewer', role='viewer'),
            AppUser(id=3, username='manager', role='viewer', use_custom_permissions=True,
                    custom_permissions_json=json.dumps(['settings.ai.manage', 'chat.ai.sandbox'])),
            AppUser(id=4, username='inactive', role='admin', is_active=False),
            AppUser(id=5, username='legacy', role='viewer', use_custom_permissions=True,
                    custom_permissions_json=json.dumps(['chat.ai.sandbox'])),
            AppAiBot(id='general', slug='general-ai', title='General', surface='general'),
            AppAiBot(id='agent', slug='corp-assistant', title='Assistant', bot_user_id=90),
            AppAiBot(id='code', slug='opencode', title='OpenCode', surface='sandbox',
                     required_permission='chat.ai.sandbox'),
            AppAiBot(id='restricted', slug='it-helper', title='IT Helper'),
            AppAiBotConversation(bot_id='agent', user_id=2, conversation_id='conversation'),
            AppAiBotConversation(bot_id='restricted', user_id=2, conversation_id='restricted-conversation'),
        ])
    yield session
    engine.dispose()


def test_default_policy_and_explicit_grants(database):
    with database() as db:
        for uid in (1, 2, 3, 5):
            assert access.can_use_bot(db, db.get(AppAiBot, 'general'), uid)
        # Unified assistant: every active user with chat.ai.use, no grant needed.
        for uid in (1, 2, 3, 5):
            assert access.can_use_bot(db, db.get(AppAiBot, 'agent'), uid)
        for uid in (2, 3, 4, 5):
            assert not access.can_use_bot(db, db.get(AppAiBot, 'code'), uid)
    # OpenCode needs both the sandbox permission and a personal grant.
    access.set_access(bot_id='code', user_id=2, allowed=True, actor_id=1)
    access.set_access(bot_id='code', user_id=3, allowed=True, actor_id=1)
    access.set_access(bot_id='code', user_id=5, allowed=True, actor_id=1)
    with database() as db:
        assert access.can_use_bot(db, db.get(AppAiBot, 'code'), 3)
        assert access.can_use_bot(db, db.get(AppAiBot, 'code'), 5)
        assert not access.can_use_bot(db, db.get(AppAiBot, 'code'), 2)  # grant without chat.ai.sandbox
        assert not access.can_use_bot(db, db.get(AppAiBot, 'restricted'), 2)


def test_only_managers_can_grant_and_admin_access_is_automatic(database):
    with pytest.raises(PermissionError):
        access.set_access(bot_id='code', user_id=2, allowed=True, actor_id=2)
    with pytest.raises(ValueError):
        access.set_access(bot_id='code', user_id=1, allowed=False, actor_id=3)
    with pytest.raises(ValueError):
        access.set_access(bot_id='general', user_id=2, allowed=False, actor_id=3)
    # The unified assistant cannot be granted or revoked manually.
    with pytest.raises(ValueError):
        access.set_access(bot_id='agent', user_id=2, allowed=True, actor_id=3)
    with pytest.raises(ValueError):
        access.set_access(bot_id='agent', user_id=2, allowed=False, actor_id=3)
    with pytest.raises(PermissionError):
        access.set_access(bot_id='code', user_id=2, allowed=True, actor_id=4)


def test_shared_views_and_history_scope(database):
    # corp-assistant is available to the owner via chat.ai.use without a grant.
    assert access.conversation_access('conversation', 2) == {'can_use': True}
    access.require_conversation_access('conversation', 2)
    # A grant-managed bot still denies the owner without a grant.
    assert access.conversation_access('restricted-conversation', 2) == {'can_use': False}
    with pytest.raises(PermissionError):
        access.require_conversation_access('restricted-conversation', 2)
    with pytest.raises(LookupError):
        access.conversation_access('conversation', 3)
    access.require_conversation_access('conversation', 90)  # Existing bot output delivery
    agent_row = next(row for row in access.list_user_access(2) if row['bot_id'] == 'agent')
    assert agent_row == {'bot_id': 'agent', 'title': 'Assistant', 'allowed': True, 'automatic': True}
    bot_items = {item['user_id']: item for item in access.list_bot_access('agent')['items']}
    assert bot_items[2] == {'user_id': 2, 'title': 'viewer', 'username': 'viewer', 'allowed': True, 'automatic': True}
    access.set_access(bot_id='restricted', user_id=2, allowed=True, actor_id=1)
    assert access.conversation_access('restricted-conversation', 2)['can_use']
    assert next(row for row in access.list_user_access(2) if row['bot_id'] == 'restricted')['allowed']
    assert access.list_bot_access('restricted', query='viewer')['items'][0]['allowed']
    assert not access.list_bot_access('restricted', query='%')['items']
    assert access.list_bot_access('restricted', limit=1)['has_more']


def test_ai8_owner_keeps_access_when_bot_disabled_or_removed(database):
    with database() as db:
        db.get(AppAiBot, 'agent').is_enabled = False
    access.require_conversation_access('conversation', 2)
    with pytest.raises(PermissionError):
        access.require_conversation_access('conversation', 3)
    with database() as db:
        mapping = db.scalar(select(AppAiBotConversation).where(
            AppAiBotConversation.conversation_id == 'conversation'))
        mapping.bot_id = 'removed-bot'
    access.require_conversation_access('conversation', 2)
    with pytest.raises(PermissionError):
        access.require_conversation_access('conversation', 3)


def test_revoke_cancels_work_preserves_history_and_does_not_resume(database):
    now = datetime.now(timezone.utc)
    with database() as db:
        db.add(AppAiBotRun(id='run', bot_id='restricted', user_id=2, conversation_id='restricted-conversation',
                          trigger_message_id='message', status='running'))
        db.add(AppAiBotRun(id='done', bot_id='restricted', user_id=2, conversation_id='restricted-conversation',
                          trigger_message_id='old-message', status='completed'))
    access.set_access(bot_id='restricted', user_id=2, allowed=False, actor_id=3)
    access.set_access(bot_id='restricted', user_id=2, allowed=True, actor_id=3)
    with database() as db:
        assert db.get(AppAiBotRun, 'run').status == 'cancelled'
        assert db.get(AppAiBotRun, 'done').status == 'completed'
        assert db.scalar(select(AppAiBotConversation).where(AppAiBotConversation.conversation_id == 'restricted-conversation'))
        assert db.get(AppAiBotAccess, ('restricted', 2)).updated_by == 3


def test_access_migration_upgrade_downgrade(tmp_path):
    from alembic.migration import MigrationContext
    from alembic.operations import Operations
    from sqlalchemy import inspect
    from types import SimpleNamespace
    from pathlib import Path
    spec = importlib.util.spec_from_file_location('access_migration', Path(__file__).resolve().parents[1] /
        'WEB-itinvent/backend/alembic/versions/20260914_0117_ai_bot_access.py')
    migration = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(migration)
    engine = create_engine(f"sqlite:///{tmp_path / 'migration.db'}")
    with engine.begin() as connection:
        context = MigrationContext.configure(connection)
        context.environment_context = SimpleNamespace(config=SimpleNamespace(attributes={}))
        with Operations.context(context):
            migration.upgrade()
            assert 'ai_bot_access' in inspect(connection).get_table_names()
            assert connection.exec_driver_sql('SELECT count(*) FROM ai_bot_access').scalar() == 0
            migration.downgrade()
            assert 'ai_bot_access' not in inspect(connection).get_table_names()
    engine.dispose()


def test_sandbox_revoke_cancels_queue_and_session_approvals(database):
    from backend.ai_sandbox.models import AppAiSandboxGatewayGrant
    now = datetime.now(timezone.utc)
    with database() as db:
        db.add(AppAiBotConversation(bot_id='code', user_id=2, conversation_id='sandbox-conversation'))
        db.add(AppAiSandboxSession(id='session', conversation_id='sandbox-conversation', user_id=2,
                                  workspace_key='workspace', status='busy', expires_at=now + timedelta(days=1)))
        db.flush()
        db.add(AppAiSandboxJob(id='job', session_id='session', conversation_id='sandbox-conversation', user_id=2,
                              prompt_message_id='message', status='waiting_permission', deadline_at=now + timedelta(hours=1)))
        db.flush()
        db.add(AppAiSandboxGatewayGrant(id='gateway', session_id='session', job_id='job', user_id=2,
                                       token_hash='0' * 64, expires_at=now + timedelta(hours=1)))
        db.add_all([
            AppAiSandboxPermission(id='pending', session_id='session', job_id='job', user_id=2,
                                   opencode_permission_id='pending', tool='bash', status='pending'),
            AppAiSandboxPermission(id='approved', session_id='session', job_id='job', user_id=2,
                                   opencode_permission_id='approved', tool='bash', status='approved', grant_scope='session'),
        ])
    access.set_access(bot_id='code', user_id=2, allowed=False, actor_id=1)
    access.set_access(bot_id='code', user_id=2, allowed=True, actor_id=1)
    with database() as db:
        job = db.get(AppAiSandboxJob, 'job')
        assert job.status == 'cleanup_pending'
        assert job.cleanup_terminal_status == 'cancelled'
        assert db.get(AppAiSandboxPermission, 'pending').status == 'rejected'
        assert db.get(AppAiSandboxPermission, 'approved').grant_scope is None
        assert db.get(AppAiSandboxGatewayGrant, 'gateway').status == 'revoked'
        assert db.get(AppAiSandboxSession, 'session') is not None


def test_api_manager_scope_and_bounded_directory(database):
    from fastapi import FastAPI
    from fastapi.testclient import TestClient
    from backend.api.v1.ai_bots import router
    from backend.api.deps import get_current_active_user
    from backend.models.auth import User
    app = FastAPI()
    app.include_router(router, prefix='/bots')
    app.dependency_overrides[get_current_active_user] = lambda: User(id=2, username='viewer')
    with TestClient(app) as client:
        assert client.get('/bots/code/access').status_code == 403
        app.dependency_overrides[get_current_active_user] = lambda: User(id=3, username='manager',
            use_custom_permissions=True, custom_permissions=['settings.ai.manage'], permissions=['settings.ai.manage'])
        response = client.get('/bots/code/access', params={'limit': 1})
        assert response.status_code == 200
        assert len(response.json()['items']) == 1
        assert set(response.json()['items'][0]) == {'user_id', 'title', 'username', 'allowed', 'automatic'}
        assert client.get('/bots/code/access', params={'limit': 1000}).status_code == 422
        assert client.put('/bots/code/access/3', json={'allowed': True}).status_code == 200
        assert client.put('/bots/code/access/3', json={'allowed': 'false'}).status_code == 422


def test_api_balance_routes_are_for_ai_managers_only(database, monkeypatch):
    from fastapi import FastAPI
    from fastapi.testclient import TestClient
    from backend.ai_chat.balance import ai_balance_service
    from backend.api.v1.ai_bots import router
    from backend.api.deps import get_current_active_user
    from backend.models.auth import User
    monkeypatch.setattr(ai_balance_service, '_credits_provider', lambda: {'data': {'total_credits': 5, 'total_usage': 4}})
    monkeypatch.setattr(ai_balance_service, '_notify_managers', lambda **kwargs: True)
    app = FastAPI()
    app.include_router(router, prefix='/bots')
    app.dependency_overrides[get_current_active_user] = lambda: User(id=2, username='viewer')
    with TestClient(app) as client:
        assert client.get('/bots/balance').status_code == 403
        assert client.put('/bots/balance/settings', json={'threshold': 5}).status_code == 403
        assert client.post('/bots/balance/check').status_code == 403
        app.dependency_overrides[get_current_active_user] = lambda: User(id=3, username='manager',
            use_custom_permissions=True, custom_permissions=['settings.ai.manage'], permissions=['settings.ai.manage'])
        assert client.put('/bots/balance/settings', json={'threshold': 5}).json()['threshold'] == 5
        assert client.put('/bots/balance/settings', json={'threshold': -1}).status_code == 422
        checked = client.post('/bots/balance/check').json()
        assert checked['balance'] == 1.0 and checked['low'] is True
        assert client.get('/bots/balance').json()['status'] == 'low'


@pytest.mark.parametrize('message_type', ['text', 'file'])
def test_revoked_messages_are_rejected_before_persistence(database, message_type):
    from contextlib import nullcontext
    from types import SimpleNamespace
    from unittest.mock import Mock
    from backend.chat.message_persistence import ChatTextMessagePersistence, ChatFileMessagePersistence
    db = Mock()
    conversation = SimpleNamespace(id='restricted-conversation', kind='ai')
    dependencies = dict(session_factory=lambda: nullcontext(db), require_membership=lambda **kwargs: conversation,
                        lock_conversation_for_write=Mock(), conversation_member_ids=Mock(),
                        resolve_reply_message=Mock(), build_message_payload_for_members=Mock(),
                        now=lambda: datetime.now(timezone.utc))
    if message_type == 'text':
        persistence = ChatTextMessagePersistence(**dependencies, find_existing_client_message=Mock())
        send = lambda: persistence.persist_text_message(current_user_id=2, conversation_id='restricted-conversation',
                    body='hello', body_format='plain', client_message_id=None, reply_to_message_id=None)
    else:
        persistence = ChatFileMessagePersistence(**dependencies)
        send = lambda: persistence.persist_file_message(current_user_id=2, conversation_id='restricted-conversation',
                    body='hello', prepared=[])
    with pytest.raises(PermissionError):
        send()
    db.add.assert_not_called()
    db.flush.assert_not_called()


def test_revoke_blocks_pending_business_action_before_execution(database, monkeypatch):
    from types import SimpleNamespace
    from unittest.mock import Mock
    from backend.ai_chat import action_cards
    from backend.appdb.models import AppAiPendingAction
    monkeypatch.setattr(action_cards, 'app_session', database)
    execute = Mock()
    monkeypatch.setattr(action_cards, '_execute_transfer', execute)
    access.set_access(bot_id='restricted', user_id=2, allowed=True, actor_id=1)
    card = action_cards.create_pending_action(action_type=action_cards.ACTION_TRANSFER,
        conversation_id='restricted-conversation', run_id='run', requester_user_id=2,
        database_id='test', payload={}, preview={})
    access.set_access(bot_id='restricted', user_id=2, allowed=False, actor_id=1)
    with pytest.raises(PermissionError):
        action_cards.confirm_action(action_id=card['id'], current_user=SimpleNamespace(id=2))
    execute.assert_not_called()
    with database() as db:
        assert db.get(AppAiPendingAction, card['id']).status == 'cancelled'


def test_open_agent_returns_forbidden_when_access_is_denied(database, monkeypatch):
    from fastapi import FastAPI
    from fastapi.testclient import TestClient
    from backend.api.v1.chat.ai import router
    from backend.api.deps import get_current_active_user
    from backend.models.auth import User
    from backend.ai_chat.service import ai_chat_service
    def deny(**kwargs):
        raise PermissionError('Agent access denied')
    monkeypatch.setattr(ai_chat_service, 'open_bot_conversation', deny)
    app = FastAPI()
    app.include_router(router, prefix='/chat')
    app.dependency_overrides[get_current_active_user] = lambda: User(id=2, username='viewer')
    with TestClient(app) as client:
        assert client.post('/chat/ai/bots/code/open').status_code == 403
