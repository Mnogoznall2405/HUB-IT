"""Real HTTP employee search over isolated SQL data, including zero equipment.

Only SQL Server pagination syntax is adapted for SQLite; filtering, joins,
counts and the API normalizer run unchanged. No external stores or lifespan.
"""
import sqlite3

import pytest
from fastapi.testclient import TestClient

from backend.api import deps
from backend.api.v1 import database
from backend.database import queries
from backend.main import app
from backend.models.auth import User


class EmployeeDB:
    def __init__(self, path):
        self.path = path

    def execute_query(self, query, params):
        if 'OFFSET ? ROWS FETCH NEXT ? ROWS ONLY' in query:
            query = query.replace('OFFSET ? ROWS FETCH NEXT ? ROWS ONLY', 'LIMIT ? OFFSET ?')
            params = (*params[:-2], params[-1], params[-2])
        with sqlite3.connect(self.path) as conn:
            conn.row_factory = sqlite3.Row
            return [dict(row) for row in conn.execute(query, params)]


@pytest.fixture
def employee_client(tmp_path, monkeypatch):
    paths = {key: tmp_path / f'{key}.sqlite' for key in ('main', 'other')}
    for path in paths.values():
        with sqlite3.connect(path) as conn:
            conn.executescript('''
                CREATE TABLE OWNERS (OWNER_NO INTEGER PRIMARY KEY, OWNER_DISPLAY_NAME TEXT, OWNER_DEPT TEXT);
                CREATE TABLE ITEMS (INV_NO TEXT, EMPL_NO INTEGER, CI_TYPE INTEGER);
            ''')
    with sqlite3.connect(paths['main']) as conn:
        conn.executescript('''
            INSERT INTO OWNERS VALUES (1, 'Иванов Иван', 'ИТ'), (2, 'Иванов Иван', 'АСУ'), (3, 'Петров', 'ИТ');
            INSERT INTO ITEMS VALUES ('OTHER', 3, 1), ('CURRENT', 2, 1), ('CONSUMABLE', 1, 2);
        ''')
    monkeypatch.setattr(queries, 'get_db', lambda db_id: EmployeeDB(paths[db_id]))
    monkeypatch.setattr(database, 'get_all_db_configs', lambda: [{'id': key} for key in paths])
    monkeypatch.setattr(database, '_get_persisted_user_database', lambda user: 'main')
    monkeypatch.setattr(database.user_db_selection_service, 'get_assigned_database', lambda tid: None)
    user = User(id=1, username='employee-reader', role='operator', permissions=['database.read'],
                use_custom_permissions=True, custom_permissions=['database.read'])
    previous = dict(app.dependency_overrides)
    app.dependency_overrides[deps.get_current_active_user] = lambda: user
    client = TestClient(app, raise_server_exceptions=False)
    yield client, user
    client.close()
    app.dependency_overrides.clear()
    app.dependency_overrides.update(previous)


def test_search_finds_zero_equipment_and_distinguishes_namesakes_without_1c(employee_client):
    client, _ = employee_client
    response = client.get('/api/v1/equipment/search/employee', params={'q': 'Иванов'})
    assert response.status_code == 200, response.text
    payload = response.json()
    assert payload['total'] == 2
    assert {(row['owner_no'], row['department'], row['equipment_count']) for row in payload['employees']} == {
        (1, 'ИТ', 0), (2, 'АСУ', 1),
    }
    assert client.get('/api/v1/equipment/search/employee', params={'q': 'ИТ'}).json()['total'] == 2


def test_employee_search_respects_database_and_pagination(employee_client):
    client, _ = employee_client
    path = '/api/v1/equipment/search/employee'
    first = client.get(path, params={'q': 'Иванов', 'limit': 1, 'page': 1}).json()
    second = client.get(path, params={'q': 'Иванов', 'limit': 1, 'page': 2}).json()
    assert first['total'] == second['total'] == 2
    assert {first['employees'][0]['owner_no'], second['employees'][0]['owner_no']} == {1, 2}
    other = client.get(path, params={'q': 'Иванов'}, headers={'X-Database-ID': 'other'})
    assert other.status_code == 200 and other.json()['employees'] == [] and other.json()['total'] == 0
