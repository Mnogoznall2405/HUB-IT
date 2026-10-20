"""Real app HTTP boundary -> real history SQL on an isolated SQLite harness.

The SQL uses shared CTE/window/parameter syntax, so SQLite executes the actual
selection rather than echoing mocked rows. SQL Server driver acceptance remains
a separate staging check.
"""
import sqlite3

import pytest
from fastapi.testclient import TestClient

from backend.api import deps
from backend.api.v1 import database
from backend.database import employee_history_reads
from backend.main import app
from backend.models.auth import User


SCHEMA = """
CREATE TABLE OWNERS (OWNER_NO INTEGER PRIMARY KEY, OWNER_DISPLAY_NAME TEXT);
CREATE TABLE ITEMS (ID INTEGER PRIMARY KEY, INV_NO TEXT, SERIAL_NO TEXT, CI_TYPE INTEGER, MODEL_NO INTEGER, TYPE_NO INTEGER);
CREATE TABLE CI_MODELS (CI_TYPE INTEGER, MODEL_NO INTEGER, MODEL_NAME TEXT);
CREATE TABLE CI_TYPES (CI_TYPE INTEGER, TYPE_NO INTEGER, TYPE_NAME TEXT);
CREATE TABLE BRANCHES (BRANCH_NO INTEGER PRIMARY KEY, BRANCH_NAME TEXT);
CREATE TABLE LOCATIONS (LOC_NO INTEGER PRIMARY KEY, DESCR TEXT);
CREATE TABLE CI_HISTORY (
 HIST_ID INTEGER PRIMARY KEY, ITEM_ID INTEGER, CH_DATE TEXT, CH_USER TEXT, CH_COMMENT TEXT,
 EMPL_NO_OLD INTEGER, EMPL_NO_NEW INTEGER, INV_NO_OLD TEXT, INV_NO_NEW TEXT,
 SERIAL_NO_OLD TEXT, SERIAL_NO_NEW TEXT, MODEL_NO_OLD INTEGER, MODEL_NO_NEW INTEGER,
 TYPE_NO_OLD INTEGER, TYPE_NO_NEW INTEGER, BRANCH_NO_OLD INTEGER, BRANCH_NO_NEW INTEGER,
 LOC_NO_OLD INTEGER, LOC_NO_NEW INTEGER
);
"""


class HistoryDB:
    def __init__(self, path):
        self.path = path

    def execute_query(self, query, params=()):
        with sqlite3.connect(self.path) as conn:
            conn.row_factory = sqlite3.Row
            return [dict(row) for row in conn.execute(query, params)]


@pytest.fixture
def history_env(tmp_path, monkeypatch):
    paths = {key: tmp_path / f"{key}.sqlite" for key in ("main", "other")}
    for path in paths.values():
        with sqlite3.connect(path) as conn:
            conn.executescript(SCHEMA)
    with sqlite3.connect(paths["main"]) as conn:
        conn.executescript("""
        INSERT INTO OWNERS VALUES (42, 'Иванов И.И.'), (43, 'Иванов И.И.');
        INSERT INTO ITEMS VALUES (10, 'LIVE-10', 'LIVE-SERIAL', 1, 2, 1);
        INSERT INTO CI_MODELS VALUES (1, 1, 'Old ThinkPad'), (1, 2, 'Current Model');
        INSERT INTO CI_TYPES VALUES (1, 1, 'Ноутбук');
        INSERT INTO BRANCHES VALUES (1, 'HQ');
        INSERT INTO LOCATIONS VALUES (1, 'Office');
        """)
        events = [
            (1, 10, '2026-01-01 23:59:59', None, 42),
            (2, 10, '2026-01-02 10:00:00', 42, 7),
            (3, 10, '2026-01-03 10:00:00', 42, 42),  # same owner
            (4, 10, '2026-01-04 10:00:00', 43, 8),   # namesake
            (5, 20, '2026-01-02 10:00:00', 42, None), # missing card
            (6, 30, None, 7, 42),                    # undated
            (7, 40, '2026-01-02 10:00:00', 42, 0),   # unassigned legacy 0
        ]
        for hist_id, item_id, date, old, new in events:
            conn.execute("""INSERT INTO CI_HISTORY VALUES (
                ?, ?, ?, 'operator', 'transfer', ?, ?, 'HIST-OLD', 'HIST-NEW',
                'OLD-SERIAL', 'NEW-SERIAL', 1, 1, 1, 1, 1, 1, 1, 1
            )""", (hist_id, item_id, date, old, new))
    monkeypatch.setattr(employee_history_reads, "get_db", lambda db_id: HistoryDB(paths[db_id]))
    monkeypatch.setattr(database, "get_all_db_configs", lambda: [{"id": key} for key in paths])
    monkeypatch.setattr(database, "_get_persisted_user_database", lambda user: "main")
    monkeypatch.setattr(database.user_db_selection_service, "get_assigned_database", lambda tid: None)
    user = User(id=1, username="test-admin", role="admin")
    previous = dict(app.dependency_overrides)
    app.dependency_overrides[deps.get_current_active_user] = lambda: user
    # Do not enter lifespan: it can start unrelated background services.
    client = TestClient(app, raise_server_exceptions=False)
    yield client, user, paths
    client.close()
    app.dependency_overrides.clear()
    app.dependency_overrides.update(previous)


def get(client, **params):
    return client.get('/api/v1/equipment/employee/42/history', params=params, headers={'X-Database-ID': 'main'})


def test_history_includes_returned_and_missing_equipment_without_namesakes(history_env):
    client, _, _ = history_env
    response = get(client)
    assert response.status_code == 200, response.text
    data = response.json()
    assert data['total'] == 5
    assert [row['hist_id'] for row in data['history']] == [7, 5, 2, 1, 6]
    returned = next(row for row in data['history'] if row['hist_id'] == 2)
    assert returned['direction'] == 'outgoing'
    assert returned['inv_no'] == 'HIST-OLD'
    assert returned['serial_no'] == 'OLD-SERIAL'
    assert returned['model_name'] == 'Old ThinkPad'
    assert returned['current_inv_no'] == 'LIVE-10'
    missing = next(row for row in data['history'] if row['hist_id'] == 5)
    assert missing['current_inv_no'] is None
    assert missing['inv_no'] == 'HIST-OLD'
    receipt = next(row for row in data['history'] if row['hist_id'] == 1)
    assert receipt['direction'] == 'incoming'
    assert receipt['inv_no'] == 'HIST-NEW'


def test_filters_pagination_and_inclusive_dates(history_env):
    client, _, _ = history_env
    assert [row['hist_id'] for row in get(client, direction='incoming').json()['history']] == [1, 6]
    first = get(client, date_from='2026-01-02', date_to='2026-01-02', limit=2).json()
    second = get(client, date_from='2026-01-02', date_to='2026-01-02', limit=2, page=2).json()
    assert first['total'] == second['total'] == 3
    assert [row['hist_id'] for row in first['history'] + second['history']] == [7, 5, 2]
    assert get(client, date_to='2026-01-01').json()['total'] == 1
    assert get(client, q='OLD-SERIAL').json()['total'] == 3
    assert get(client, q='ThinkPad').json()['total'] == 5
    assert get(client, q="%' OR 1=1 --").json()['total'] == 0
    assert get(client, q='%').json()['total'] == 0
    assert get(client, limit=2, page=20).json()['history'] == []


def test_fallback_requisites_and_missing_dictionary_rows(history_env):
    client, _, paths = history_env
    with sqlite3.connect(paths['main']) as conn:
        conn.execute("UPDATE CI_HISTORY SET INV_NO_OLD = '', SERIAL_NO_OLD = NULL, MODEL_NO_OLD = 999 WHERE HIST_ID = 2")
    row = next(row for row in get(client).json()['history'] if row['hist_id'] == 2)
    assert (row['inv_no'], row['serial_no'], row['model_name']) == ('LIVE-10', 'LIVE-SERIAL', 'Current Model')
    assert row['new_employee_no'] == 7 and row['new_employee_name'] is None


def test_database_scope_and_fixed_assignment(history_env):
    client, user, _ = history_env
    path = '/api/v1/equipment/employee/42/history'
    assert client.get(path, headers={'X-Database-ID': 'other'}).json()['total'] == 0
    user.role = 'operator'
    user.assigned_database = 'main'
    assert client.get(path, headers={'X-Database-ID': 'other'}).json()['total'] == 5
    assert client.get('/api/v1/equipment/employee/99/history').json()['total'] == 0


@pytest.mark.parametrize('params', [
    {'direction': 'invalid'}, {'page': 0}, {'limit': 201}, {'date_from': 'bad'},
    {'date_from': '2026-02-01', 'date_to': '2026-01-01'}, {'date_to': '9999-12-31'},
])
def test_invalid_filters_rejected(history_env, params):
    client, _, _ = history_env
    assert get(client, **params).status_code == 422


def test_history_permission_and_anonymous_access(history_env):
    client, user, _ = history_env
    user.role = 'viewer'
    user.use_custom_permissions = True
    user.custom_permissions = []
    assert get(client).status_code == 403
    app.dependency_overrides.pop(deps.get_current_active_user)
    assert get(client).status_code == 401
