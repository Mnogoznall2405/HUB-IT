from contextlib import contextmanager
from datetime import date, timedelta
import json
from uuid import uuid4
import runpy
from pathlib import Path
import pytest
import sqlalchemy as sa
from sqlalchemy.orm import Session
from alembic.migration import MigrationContext
from alembic.operations import Operations
from alembic.config import Config
from alembic.runtime.environment import EnvironmentContext
from pydantic import ValidationError

from backend.appdb.models import AppBase, AppConstructionObject, AppConstructionObject1CGroup, AppConstructionWorkItem, AppGlobalSetting
from backend.models.construction_planning import WeeklyPlanChange, DailySummary
from backend.services import construction_planning_service as planning
from backend.services.construction_work_service import WorkConflict, WorkNotFound

GROUP = '11111111-1111-1111-1111-111111111111'
OTHER = '22222222-2222-2222-2222-222222222222'
TODAY = date.today()
MONDAY = planning.monday(TODAY)


@pytest.fixture
def setup(tmp_path, monkeypatch):
    engine = sa.create_engine(f'sqlite:///{tmp_path / "plan.db"}', execution_options={'schema_translate_map': {'app': None, 'system': None}})
    names = {'construction_objects', 'construction_object_1c_groups', 'construction_work_items', 'construction_work_entries', 'construction_work_audit', 'app_settings', 'construction_week_plans', 'construction_day_crews', 'construction_planning_audit'}
    tables = [t for t in AppBase.metadata.sorted_tables if t.name in names]
    AppBase.metadata.create_all(engine, tables=tables)
    @contextmanager
    def session_factory(database_url=None):
        with Session(engine) as session, session.begin(): yield session
    monkeypatch.setattr(planning, 'app_session', session_factory)
    ids = [str(uuid4()), str(uuid4())]
    with session_factory() as s:
        s.add(AppConstructionObject(id='object', name='Объект', is_active=True, created_by_user_id=1, updated_by_user_id=1))
        s.add_all([AppConstructionObject1CGroup(object_id='object', group_ref=g, group_name=g, created_by_user_id=1) for g in (GROUP, OTHER)])
        from backend.models.construction_work import WorkPlan
        for i, work_id in enumerate(ids):
            plan = WorkPlan(section='Раздел', name='Кабель', unit='м', planned_quantity=100)
            s.add(AppConstructionWorkItem(id=work_id, object_id='object', group_ref=(GROUP, OTHER)[i], version=1, plan_json=plan.model_dump_json()))
    yield planning.ConstructionPlanningService(), ids, session_factory
    engine.dispose()


def week(ids, version=0, assigned=4):
    return WeeklyPlanChange(week_start=MONDAY, expected_version=version, plan={
        'targets': [{'work_id': ids[0], 'quantity': 50}],
        'crews': [{'id': '33333333-3333-3333-3333-333333333333', 'name': 'Бригада', 'specialty': 'Электрики', 'available': 5,
                   'assignments': [{'id': '44444444-4444-4444-4444-444444444444', 'name': 'Раздел', 'group_ref': GROUP, 'work_ids': [ids[0]], 'required': 6, 'assigned': assigned}]}]})


def save_week(service, payload):
    return service.save_week('object', GROUP, payload, actor_id=1, actor_name='ПТО')


def report(ids, version=1, crew_version=0):
    return DailySummary(work_date=TODAY, expected_week_version=1, expected_crew_version=crew_version,
                        items=[{'id': ids[0], 'expected_version': version, 'quantity': 20}],
                        crews=[{'assignment_id': '44444444-4444-4444-4444-444444444444', 'actual': 3}])


def test_plan_fact_shared_ids_baseline_and_duplicate_saves(setup):
    service, ids, _ = setup
    save_week(service, week(ids))
    assert save_week(service, week(ids))['version'] == 1
    service.save_day('object', GROUP, report(ids), actor_id=2, actor_name='Мастер')
    service.save_day('object', GROUP, report(ids), actor_id=2, actor_name='Мастер')
    result = service.read('object', GROUP, TODAY)
    assert result['weekly_actual'][ids[0]] == 20
    assert result['month_actual'][str(MONDAY)][ids[0]] == 20
    assert result['month_totals'][ids[0]] == 20
    assert result['items'][0]['total_quantity'] == 20
    assert len(result['crew_day']) == 1
    assert result['recorded_ids'] == [ids[0]]
    changed = week(ids, version=1); changed.plan.targets[0].quantity = 70
    save_week(service, changed)
    result = service.read('object', GROUP, TODAY)
    assert float(result['baseline']['targets'][0]['quantity']) == 50
    assert float(result['plan']['targets'][0]['quantity']) == 70
    assert result['week_version'] == 2
    with pytest.raises(WorkConflict): save_week(service, week(ids, version=1, assigned=3))


def test_atomic_report_rolls_back_people_on_work_conflict(setup):
    service, ids, _ = setup
    save_week(service, week(ids))
    with pytest.raises(WorkConflict): service.save_day('object', GROUP, report(ids, version=99), actor_id=1, actor_name='Мастер')
    result = service.read('object', GROUP, TODAY)
    assert result['crew_day'] == {}
    assert result['weekly_actual'] == {}
    assert not service.history('object', GROUP, TODAY)['items'] or TODAY == MONDAY


def test_capacity_and_scope_and_reported_assignment_preservation(setup):
    service, ids, _ = setup
    with pytest.raises(ValidationError): week(ids, assigned=6)
    invalid = week(ids); invalid.plan.crews[0].assignments[0].work_ids = [ids[1]]
    with pytest.raises(ValueError): save_week(service, invalid)
    save_week(service, week(ids))
    with pytest.raises(WorkNotFound): service.save_day('object', OTHER, report(ids), actor_id=1, actor_name='Мастер')
    service.save_day('object', GROUP, report(ids), actor_id=1, actor_name='Мастер')
    invalid = week(ids, version=1); invalid.plan.crews = []
    with pytest.raises(ValueError, match='сводка'): save_week(service, invalid)
    assert service.read('object', OTHER, TODAY)['plan']['crews'][0]['assignments'][0]['assigned'] == 4


def test_explicit_zero_distinct_from_no_report_and_future_rejected(setup):
    service, ids, _ = setup
    assert service.read('object', GROUP, TODAY)['recorded_ids'] == []
    save_week(service, week(ids)); day = report(ids); day.items[0].quantity = 0
    service.save_day('object', GROUP, day, actor_id=1, actor_name='Мастер')
    assert service.read('object', GROUP, TODAY)['recorded_ids'] == [ids[0]]
    with pytest.raises(ValidationError): DailySummary(**{**day.model_dump(), 'work_date': TODAY + timedelta(days=1)})


def test_concurrent_week_edits_have_one_winner(setup):
    from concurrent.futures import ThreadPoolExecutor
    from threading import Barrier
    service, ids, _ = setup
    save_week(service, week(ids))
    barrier = Barrier(2)
    def edit(quantity):
        payload = week(ids, version=1)
        payload.plan.targets[0].quantity = quantity
        barrier.wait(timeout=5)
        try:
            save_week(service, payload)
            return 'saved'
        except WorkConflict:
            return 'conflict'
    with ThreadPoolExecutor(max_workers=2) as pool:
        outcomes = list(pool.map(edit, [60, 70]))
    assert sorted(outcomes) == ['conflict', 'saved']
    assert service.read('object', GROUP, TODAY)['week_version'] == 2


def test_month_total_excludes_neighboring_month_days(setup):
    service, ids, _ = setup
    first = TODAY.replace(day=1)
    for version, day, quantity in [(1, first - timedelta(days=1), 7), (2, first, 5)]:
        payload = DailySummary(work_date=day, expected_week_version=0, expected_crew_version=0,
                               items=[{'id': ids[0], 'expected_version': version, 'quantity': quantity}])
        service.save_day('object', GROUP, payload, actor_id=1, actor_name='Test')
    result = service.read('object', GROUP, first)
    assert result['month_totals'][ids[0]] == 5
    assert result['items'][0]['total_quantity'] == 12


def test_planning_api_permissions_and_validation(setup, monkeypatch):
    from fastapi import FastAPI
    from fastapi.testclient import TestClient
    from backend.api import deps
    from backend.api.v1 import construction_work as api
    from backend.models.auth import User
    service, ids, _ = setup
    monkeypatch.setattr(api, 'ConstructionPlanningService', lambda: service)
    permissions = ['construction.read']
    app = FastAPI(); app.include_router(api.router)
    app.dependency_overrides[deps.get_current_active_user] = lambda: User(id=1, username='tester', role='operator', is_active=True, use_custom_permissions=True, permissions=permissions, custom_permissions=permissions)
    path = f'/objects/object/directions/{GROUP}'
    with TestClient(app) as client:
        assert client.get(path + '/planning').status_code == 200
        assert client.get(path + '/planning?day=9999-12-31').status_code == 422
        assert client.put(path + '/planning', json=week(ids).model_dump(mode='json')).status_code == 403
        permissions.append('construction.write')
        assert client.put(path + '/planning', json=week(ids).model_dump(mode='json')).status_code == 200
        assert client.put(path + '/daily-summary', json=report(ids).model_dump(mode='json')).status_code == 200
        assert client.get(path + '/planning').json()['weekly_actual'][ids[0]] == 20
        assert client.get(path + '/planning-history', params={'period': str(MONDAY)}).status_code == 200
        assert client.put(path + '/daily-summary', json=report(ids, version=99).model_dump(mode='json') | {'items': [{'id': ids[0], 'quantity': 40, 'expected_version': 99}]}).status_code == 409


def test_planning_migration_roundtrip(tmp_path):
    migration = runpy.run_path(str(Path(__file__).resolve().parents[1] / 'WEB-itinvent/backend/alembic/versions/20260908_0109_construction_week_planning.py'))
    engine = sa.create_engine(f'sqlite:///{tmp_path / "migration.db"}')
    with engine.begin() as connection:
        context = MigrationContext.configure(connection, environment_context=EnvironmentContext(Config(), None))
        with Operations.context(context):
            migration['upgrade']()
            assert set(sa.inspect(connection).get_table_names()) == {'construction_week_plans','construction_day_crews','construction_planning_audit'}
            migration['downgrade']()
            assert sa.inspect(connection).get_table_names() == []


def test_planning_migration_postgresql_sql():
    from io import StringIO
    migration = runpy.run_path(str(Path(__file__).resolve().parents[1] / 'WEB-itinvent/backend/alembic/versions/20260908_0109_construction_week_planning.py'))
    output = StringIO()
    context = MigrationContext.configure(dialect_name='postgresql', opts={'as_sql': True, 'output_buffer': output}, environment_context=EnvironmentContext(Config(), None))
    with Operations.context(context):
        migration['upgrade']()
        migration['downgrade']()
    sql = output.getvalue()
    assert 'CREATE TABLE app.construction_week_plans' in sql
    assert 'PRIMARY KEY (object_id, week_start)' in sql
    assert 'PRIMARY KEY (object_id, work_date)' in sql
    assert 'DROP TABLE app.construction_week_plans' in sql
