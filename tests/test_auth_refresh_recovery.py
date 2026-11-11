from concurrent.futures import ThreadPoolExecutor
from threading import Event
import importlib

import pytest
from fastapi import FastAPI
from fastapi.testclient import TestClient

from backend.api.v1 import auth
from backend.services.auth_runtime_store_service import AuthRuntimeStoreService
from backend.utils.security import decode_access_token


@pytest.fixture
def refresh_client(tmp_path, monkeypatch):
    store = AuthRuntimeStoreService(database_url=f"sqlite:///{(tmp_path / 'refresh.db').as_posix()}")
    security_module = importlib.import_module('backend.services.auth_security_service')
    monkeypatch.setattr(auth, 'auth_runtime_store_service', store)
    monkeypatch.setattr(security_module, 'auth_runtime_store_service', store)
    user = {'id': 7, 'username': 'refresh-test', 'role': 'viewer', 'is_active': True}
    monkeypatch.setattr(auth.user_service, 'get_by_id', lambda _id: user)
    monkeypatch.setattr(auth, '_enforce_rate_limit', lambda **kwargs: None)
    monkeypatch.setattr(security_module.session_service, 'is_session_active', lambda _id: True)
    monkeypatch.setattr(security_module.session_service, 'touch_session', lambda _id: True)
    monkeypatch.setattr(auth.auth_security_service, '_build_public_user', lambda value, **kwargs: value)
    issued = auth.auth_security_service.issue_tokens(user=user, session_id='session-1', device_id='session:session-1')
    app = FastAPI()
    app.include_router(auth.router, prefix='/auth')
    client = TestClient(app, raise_server_exceptions=False)
    return client, store, issued['refresh_token']


def refresh(client, token):
    return client.post('/auth/refresh', headers={'X-Auth-Client': 'mobile'}, json={'refresh_token': token})


def test_temporary_lookup_failure_does_not_consume_refresh(refresh_client, monkeypatch):
    client, store, token = refresh_client
    original_lookup = auth.user_service.get_by_id
    with monkeypatch.context() as patch:
        def unavailable(_id):
            raise RuntimeError('simulated database outage')
        patch.setattr(auth.user_service, 'get_by_id', unavailable)
        assert refresh(client, token).status_code == 500
    assert auth.user_service.get_by_id == original_lookup
    response = refresh(client, token)
    assert response.status_code == 200
    assert response.json()['refresh_token'] != token


def test_parallel_slow_refresh_returns_one_pair(refresh_client, monkeypatch):
    client, store, token = refresh_client
    original = auth.auth_security_service.refresh_session_tokens
    started = Event()
    release = Event()
    metrics = []
    monkeypatch.setattr(auth, 'note_auth_session_metric', lambda name, **kwargs: metrics.append(name))

    def slow_first(**kwargs):
        if not started.is_set():
            started.set()
            assert release.wait(5)
        return original(**kwargs)

    monkeypatch.setattr(auth.auth_security_service, 'refresh_session_tokens', slow_first)
    with ThreadPoolExecutor(max_workers=2) as pool:
        first = pool.submit(refresh, client, token)
        assert started.wait(5)
        try:
            second = pool.submit(refresh, client, token).result(timeout=5)
        finally:
            release.set()
        first = first.result(timeout=5)
    assert first.status_code == second.status_code == 200
    assert first.json()['refresh_token'] == second.json()['refresh_token']
    assert first.json()['access_token'] == second.json()['access_token']
    assert sorted(metrics) == ['refresh_grace_hit', 'refresh_success']
    replacement = decode_access_token(first.json()['refresh_token'], expected_token_type='refresh')
    assert store.get_json('refresh', replacement.jti)['session_id'] == 'session-1'
    from sqlalchemy import func, select
    from backend.appdb.db import app_session
    from backend.appdb.models import AppAuthRuntimeItem
    with app_session(store._database_url) as session:
        assert session.scalar(select(func.count()).select_from(AppAuthRuntimeItem).where(
            AppAuthRuntimeItem.namespace == 'refresh',
        )) == 1


def test_rotation_commit_failure_can_be_retried(refresh_client, monkeypatch):
    client, store, token = refresh_client
    with monkeypatch.context() as patch:
        def unavailable(*args, **kwargs):
            raise RuntimeError('simulated commit failure')
        patch.setattr(store, 'complete_refresh_rotation', unavailable)
        assert refresh(client, token).status_code == 500
    assert refresh(client, token).status_code == 200


def test_rotation_replay_after_grace_is_rejected(refresh_client):
    client, store, token = refresh_client
    first = refresh(client, token)
    assert first.status_code == 200
    assert refresh(client, token).json() == first.json()
    old = decode_access_token(token, expected_token_type='refresh')
    store.delete('refresh_grace', old.jti)
    assert refresh(client, token).status_code == 401


def test_prepared_tokens_are_not_registered_before_rotation(refresh_client):
    client, store, token = refresh_client
    prepared = auth.auth_security_service.refresh_session_tokens(
        user={'id': 7, 'username': 'refresh-test', 'role': 'viewer', 'is_active': True},
        session_id='session-1', device_id='session:session-1', persist_refresh=False,
    )
    assert store.get_json('refresh', prepared['_refresh_jti']) is None
    assert refresh(client, token).status_code == 200


def test_web_rotation_keeps_httponly_cookie_delivery(refresh_client):
    client, store, token = refresh_client
    response = client.post('/auth/refresh', cookies={auth.config.app.auth_refresh_cookie_name: token})
    assert response.status_code == 200
    assert response.json()['access_token'] is None
    assert response.json()['refresh_token'] is None
    assert not any(key.startswith('_refresh') for key in response.json())
    cookies = response.headers.get_list('set-cookie')
    assert len(cookies) == 2
    assert all('HttpOnly' in cookie for cookie in cookies)
