from datetime import datetime, timedelta
from types import SimpleNamespace

import pytest
from fastapi import FastAPI
from fastapi.testclient import TestClient
from sqlalchemy import event


@pytest.mark.parametrize('with_data', [False, True])
def test_dlp_summary_preserves_day_counts_without_repeated_scans(prebuilt_app_db, monkeypatch, with_data):
    from backend.api import deps
    from backend.api.v1 import fs_egress
    from backend.appdb import db
    from backend.appdb.file_egress_store import AppFileEgressStore
    from backend.appdb.models import AppBrowserProbeVisit, AppFileLeftEvent
    from backend.services import fs_egress_store_service as service

    url = f'sqlite:///{prebuilt_app_db.as_posix()}'
    store = AppFileEgressStore(database_url=url)
    db.ensure_app_schema_initialized(url)
    engine = db.get_app_engine(url)
    start = datetime.now().astimezone().replace(hour=0, minute=0, second=0, microsecond=0)
    if with_data:
        with engine.begin() as conn:
            conn.execute(AppBrowserProbeVisit.__table__.insert(), [
                dict(id=str(i), computer_name=host, browser='chrome', profile=profile,
                     visit_id=str(i), visited_at=visited, url='https://example.invalid/',
                     domain='example.invalid', title='Example', category='other')
                for i, (host, profile, visited) in enumerate([
                    ('old', 'Default', start - timedelta(seconds=1)),
                    ('shared', 'Default', start),
                    ('shared', 'Default', start + timedelta(hours=1)),
                    ('visit-only', 'focus', start + timedelta(hours=2)),
                    ('undated', 'Default', None),
                    # The existing summary has a lower bound only; retain that contract.
                    ('future', 'Default', start + timedelta(days=1)),
                ])
            ])
            conn.execute(AppFileLeftEvent.__table__.insert(), [
                dict(id=str(i), computer_name=host, ts=int(when.timestamp()))
                for i, (host, when) in enumerate([
                    ('old', start - timedelta(seconds=1)),
                    ('shared', start),
                    ('shared', start + timedelta(hours=1)),
                    ('file-only', start + timedelta(hours=1)),
                ])
            ])
    monkeypatch.setattr(service, 'get_egress_store', lambda: store)
    monkeypatch.setattr(service, '_dlp_cache', {})
    app = FastAPI()
    app.include_router(fs_egress.router)
    app.dependency_overrides[deps.get_current_admin_user] = lambda: SimpleNamespace(id=1)
    selects = []

    def count_selects(conn, cursor, statement, parameters, context, executemany):
        if statement.lstrip().upper().startswith('SELECT'):
            selects.append(statement)

    event.listen(engine, 'before_cursor_execute', count_selects)
    try:
        with TestClient(app) as client:
            response = client.get('/dlp/summary')
            assert response.status_code == 200, response.text
            summary = response.json()['summary']
            assert summary['hosts_total'] == (6 if with_data else 0)
            assert summary['hosts_active_today'] == (4 if with_data else 0)
            assert summary['file_events_today'] == (3 if with_data else 0)
            assert summary['visits_today'] == (4 if with_data else 0)
            assert summary['categories_today'] == ({'other': 4} if with_data else {})
            assert len(selects) <= 3, 'The summary must not rescan both histories for each counter'
            selects.clear()
            assert client.get('/dlp/summary').json() == response.json()
            assert not selects, 'A warm summary should reuse the existing cache'
    finally:
        event.remove(engine, 'before_cursor_execute', count_selects)

