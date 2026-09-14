from concurrent.futures import ThreadPoolExecutor
from contextlib import contextmanager
from datetime import date, timedelta
from pathlib import Path
import runpy
from threading import Barrier
from uuid import uuid4

import pytest
import sqlalchemy as sa
from alembic.migration import MigrationContext
from alembic.operations import Operations
from fastapi import FastAPI
from fastapi.testclient import TestClient
from pydantic import ValidationError

from backend.appdb.db import app_session
from backend.appdb.models import AppConstructionWorkAudit, AppConstructionWorkItem
from backend.models.construction_work import WorkDayBatch, WorkPlanBatch, WorkPlan
from backend.services.construction_management_service import ConstructionManagementService
from backend.services.construction_work_service import ConstructionWorkService, WorkConflict, WorkNotFound

GROUP = '11111111-1111-1111-1111-111111111111'
OTHER = '22222222-2222-2222-2222-222222222222'
TODAY = date.today()


@pytest.fixture
def setup(tmp_path):
    url = f"sqlite+pysqlite:///{(tmp_path / 'work.db').as_posix()}"
    management = ConstructionManagementService(url)
    obj = management.save_object(object_id=None, name='Объект', groups=[{'group_ref': GROUP, 'group_name': 'ЭОМ'}], role_candidates={}, actor_user_id=1)
    return ConstructionWorkService(url), obj['id'], url


def plan_batch(work_id=None, version=0, **kwargs):
    return WorkPlanBatch(items=[{'id': work_id or uuid4(), 'expected_version': version, 'plan': {
        'section': 'Электрика', 'name': 'Кабель', 'unit': 'м', 'planned_quantity': '1000', 'weight': '2', **kwargs,
    }}])


def save_plan(service, obj, batch):
    service.save(obj, GROUP, batch, actor_id=1, actor_name='ПТО')
    return str(batch.items[0].id)


def daily(work_id, quantity, version, day=TODAY):
    return WorkDayBatch(work_date=day, items=[{'id': work_id, 'expected_version': version, 'quantity': quantity}])


def save_day(service, obj, batch):
    return service.save(obj, GROUP, batch, actor_id=2, actor_name='Участок', daily=True)


def test_daily_fact_is_absolute_repeat_safe_and_audited(setup):
    service, obj, _ = setup
    work_id = save_plan(service, obj, plan_batch())
    batch = daily(work_id, '120.5', 1)
    save_day(service, obj, batch)
    save_day(service, obj, batch)
    row = service.read(obj, GROUP)['items'][0]
    assert row['total_quantity'] == 120.5
    assert row['remaining_quantity'] == 879.5
    assert row['percent'] == 12.05
    assert row['version'] == 2
    assert len(service.history(obj, GROUP, work_id)['items']) == 2
    save_day(service, obj, daily(work_id, '100', 2))
    history = service.history(obj, GROUP, work_id)['items']
    assert history[0]['before']['values']['quantity'] == '120.5'
    assert history[0]['actor_user_id'] == 2
    assert service.read(obj, GROUP)['items'][0]['total_quantity'] == 100


def test_as_of_baseline_and_zero_correction(setup):
    service, obj, _ = setup
    work_id = save_plan(service, obj, plan_batch(initial_quantity='300', initial_date=TODAY - timedelta(days=3)))
    save_day(service, obj, daily(work_id, '50', 1, TODAY - timedelta(days=1)))
    save_day(service, obj, daily(work_id, '100', 2))
    assert service.read(obj, GROUP, as_of=TODAY - timedelta(days=1))['items'][0]['total_quantity'] == 350
    assert service.read(obj, GROUP)['items'][0]['total_quantity'] == 450
    save_day(service, obj, daily(work_id, '0', 3))
    assert service.read(obj, GROUP)['items'][0]['total_quantity'] == 350
    with pytest.raises(ValueError, match='начального'):
        save_day(service, obj, daily(work_id, '5', 4, TODAY - timedelta(days=3)))


def test_mixed_units_use_explicit_weights_and_cap_overfulfilment(setup):
    service, obj, _ = setup
    cable = save_plan(service, obj, plan_batch())
    panels = save_plan(service, obj, plan_batch(name='Щиты', unit='шт', planned_quantity='10', weight='1'))
    save_day(service, obj, daily(cable, '500', 1))
    save_day(service, obj, daily(panels, '15', 1))
    data = service.read(obj, GROUP)
    assert data['summary']['percent'] == pytest.approx(200 / 3)
    assert data['summary']['over_plan'] == 1
    assert data['summary']['completed'] == 1
    assert data['trend'][-1]['percent'] == data['summary']['percent']
    save_plan(service, obj, plan_batch(name='Без веса', weight=None))
    assert service.read(obj, GROUP)['summary']['percent'] is None


def test_scope_is_enforced_and_partial_batch_rolls_back(setup):
    service, obj, _ = setup
    work_id = save_plan(service, obj, plan_batch())
    with pytest.raises(WorkNotFound):
        service.read(obj, OTHER)
    with pytest.raises(WorkNotFound):
        service.history('other-object', GROUP, work_id)
    batch = WorkDayBatch(work_date=TODAY, items=[
        {'id': work_id, 'expected_version': 1, 'quantity': '5'},
        {'id': str(uuid4()), 'expected_version': 1, 'quantity': '5'},
    ])
    with pytest.raises(WorkNotFound):
        save_day(service, obj, batch)
    assert service.read(obj, GROUP)['items'][0]['total_quantity'] == 0
    assert service.read(obj, GROUP)['items'][0]['version'] == 1


def test_parallel_edit_has_one_winner_and_keeps_history(setup):
    service, obj, _ = setup
    work_id = save_plan(service, obj, plan_batch())
    gate = Barrier(2)
    def write(qty):
        gate.wait()
        try:
            save_day(service, obj, daily(work_id, qty, 1))
            return 'saved'
        except WorkConflict:
            return 'conflict'
    with ThreadPoolExecutor(max_workers=2) as pool:
        results = list(pool.map(write, ['10', '20']))
    assert sorted(results) == ['conflict', 'saved']
    row = service.read(obj, GROUP)['items'][0]
    assert row['total_quantity'] in (10, 20)
    assert row['version'] == 2
    assert len(service.history(obj, GROUP, work_id)['items']) == 2


def test_plan_edit_conflicts_with_daily_edit_and_baseline_overlap(setup):
    service, obj, _ = setup
    batch = plan_batch()
    work_id = save_plan(service, obj, batch)
    save_day(service, obj, daily(work_id, '5', 1))
    with pytest.raises(WorkConflict):
        save_plan(service, obj, plan_batch(work_id, 1, planned_quantity='2000'))
    with pytest.raises(ValueError, match='пересекается'):
        save_plan(service, obj, plan_batch(work_id, 2, initial_date=TODAY, initial_quantity='10'))
    assert service.read(obj, GROUP)['items'][0]['version'] == 2


@pytest.mark.parametrize('field,value', [('planned_quantity', '-1'), ('planned_quantity', 'NaN'), ('planned_quantity', '1.00001'), ('weight', '-1')])
def test_plan_validation(field, value):
    with pytest.raises(ValidationError):
        plan_batch(**{field: value})


def test_empty_work_direction_does_not_claim_full_object_readiness(setup):
    service, obj, url = setup
    management = ConstructionManagementService(url)
    management.save_object(object_id=obj, name='Объект', groups=[{'group_ref': GROUP}, {'group_ref': OTHER}], role_candidates=None, actor_user_id=1)
    work_id = save_plan(service, obj, plan_batch())
    save_day(service, obj, daily(work_id, '1000', 1))
    assert service.read(obj)['summary']['percent'] is None


def test_read_keeps_total_and_trend_consistent_during_concurrent_save(setup, monkeypatch):
    from backend.services import construction_work_service as work_module

    service, obj, _ = setup
    work_id = save_plan(service, obj, plan_batch())
    original_session = work_module.app_session
    saved_during_read = False

    @contextmanager
    def interleaved_session(database_url):
        nonlocal saved_during_read
        with original_session(database_url) as session:
            original_execute = session.execute

            def execute(statement, *args, **kwargs):
                nonlocal saved_during_read
                result = original_execute(statement, *args, **kwargs)
                descriptions = getattr(statement, 'column_descriptions', [])
                if not saved_during_read and descriptions and descriptions[0].get('entity') is AppConstructionWorkItem:
                    rows = result.all()
                    saved_during_read = True
                    save_day(service, obj, daily(work_id, '100', 1))

                    class MaterializedResult:
                        def all(self):
                            return rows

                    return MaterializedResult()
                return result

            session.execute = execute
            yield session

    monkeypatch.setattr(work_module, 'app_session', interleaved_session)
    snapshot = service.read(obj, GROUP)
    assert saved_during_read
    assert snapshot['items'][0]['total_quantity'] == 0
    assert snapshot['summary']['percent'] == 0
    assert {point['percent'] for point in snapshot['trend']} == {0}
    assert service.read(obj, GROUP)['items'][0]['total_quantity'] == 100


@pytest.mark.parametrize('archived', [False, True])
def test_unlink_direction_with_work_preserves_plan_fact_and_history(setup, archived):
    service, obj, url = setup
    work_id = save_plan(service, obj, plan_batch())
    save_day(service, obj, daily(work_id, '100', 1))
    if archived:
        save_plan(service, obj, plan_batch(work_id, 2, archived=True))
    history_before = service.history(obj, GROUP, work_id)
    management = ConstructionManagementService(url)
    with pytest.raises(ValueError, match='отвязать'):
        management.save_object(object_id=obj, name='Переименован', groups=[{'group_ref': OTHER}],
                               role_candidates=None, actor_user_id=1)
    saved_object = management.get_object(obj)
    assert saved_object['name'] == 'Объект'
    assert [group['group_ref'] for group in saved_object['groups']] == [GROUP]
    assert service.history(obj, GROUP, work_id) == history_before
    if not archived:
        assert service.read(obj, GROUP)['items'][0]['total_quantity'] == 100


def test_empty_direction_can_still_be_unlinked(setup):
    service, obj, url = setup
    management = ConstructionManagementService(url)
    management.save_object(object_id=obj, name='Объект', groups=[{'group_ref': GROUP}, {'group_ref': OTHER}],
                           role_candidates=None, actor_user_id=1)
    save_plan(service, obj, plan_batch())
    management.save_object(object_id=obj, name='Объект', groups=[{'group_ref': GROUP}],
                           role_candidates=None, actor_user_id=1)
    assert len(service.read(obj, GROUP)['items']) == 1
    with pytest.raises(WorkNotFound):
        service.read(obj, OTHER)


def test_archived_work_can_be_read_restored_and_keeps_fact_and_history(setup):
    service, obj, _ = setup
    active_id = save_plan(service, obj, plan_batch())
    archived_id = save_plan(service, obj, plan_batch(name='Архивируемая'))
    save_day(service, obj, daily(active_id, '200', 1))
    save_day(service, obj, daily(archived_id, '900', 1))
    save_plan(service, obj, plan_batch(archived_id, 2, name='Архивируемая', archived=True))

    normal = service.read(obj, GROUP)
    with_archive = service.read(obj, GROUP, include_archived=True)
    assert len(normal['items']) == 1
    assert len(with_archive['items']) == 2
    for key in ('summary', 'sections', 'directions', 'trend'):
        assert normal[key] == with_archive[key]
    assert with_archive['summary']['percent'] == 20
    archived_row = next(item for item in with_archive['items'] if item['id'] == archived_id)
    assert archived_row['version'] == 3
    assert archived_row['total_quantity'] == 900
    assert len(service.history(obj, GROUP, archived_id)['items']) == 3
    with pytest.raises(ValueError, match='архивной'):
        save_day(service, obj, daily(archived_id, '950', archived_row['version']))

    restore = WorkPlanBatch(items=[{'id': archived_id, 'expected_version': archived_row['version'],
                                  'plan': {**archived_row['plan'], 'archived': False}}])
    save_plan(service, obj, restore)
    restored = service.read(obj, GROUP)
    assert len(restored['items']) == 2
    assert restored['summary']['percent'] == 55
    assert len(service.history(obj, GROUP, archived_id)['items']) == 4


@pytest.mark.parametrize('source', ['initial', 'daily'])
def test_unit_cannot_relabel_existing_completed_quantity(setup, source):
    service, obj, _ = setup
    values = {'initial_quantity': '100', 'initial_date': TODAY} if source == 'initial' else {}
    work_id = save_plan(service, obj, plan_batch(**values))
    version = 1
    if source == 'daily':
        save_day(service, obj, daily(work_id, '100', version))
        version += 1
    with pytest.raises(ValueError, match='единицу измерения'):
        save_plan(service, obj, plan_batch(work_id, version, unit='шт', **values))
    if source == 'initial':
        with pytest.raises(ValueError, match='единицу измерения'):
            save_plan(service, obj, plan_batch(work_id, version, unit='шт', initial_quantity='0', initial_date=TODAY))
    row = service.read(obj, GROUP)['items'][0]
    assert row['plan']['unit'] == 'м'
    assert row['total_quantity'] == 100
    assert row['version'] == version
    assert len(service.history(obj, GROUP, work_id)['items']) == version


def test_unit_can_be_corrected_before_any_completed_quantity(setup):
    service, obj, _ = setup
    work_id = save_plan(service, obj, plan_batch())
    save_day(service, obj, daily(work_id, '0', 1))
    save_plan(service, obj, plan_batch(work_id, 2, unit='шт'))
    row = service.read(obj, GROUP)['items'][0]
    assert row['plan']['unit'] == 'шт'
    assert row['total_quantity'] == 0


@pytest.mark.parametrize('field', ['initial_date', 'actual_start', 'actual_end'])
def test_future_completed_dates_are_rejected_but_future_plans_are_allowed(field):
    future = TODAY + timedelta(days=1)
    with pytest.raises(ValidationError, match='будущем'):
        plan_batch(**{field: future})
    plan_batch(planned_start=future, planned_end=future, revised_start=future, revised_end=future)


def test_api_permissions_validation_and_conflict(setup, monkeypatch):
    from backend.api import deps
    from backend.api.v1 import construction_work as api
    from backend.models.auth import User
    service, obj, _ = setup
    monkeypatch.setattr(api, 'ConstructionWorkService', lambda: service)
    app = FastAPI(); app.include_router(api.router, prefix='/construction')
    permissions = ['construction.read']
    def user():
        return User(id=1, username='tester', role='operator', is_active=True, use_custom_permissions=True, permissions=permissions, custom_permissions=permissions)
    app.dependency_overrides[deps.get_current_active_user] = user
    with TestClient(app) as client:
        path = f'/construction/objects/{obj}/directions/{GROUP}'
        payload = plan_batch().model_dump(mode='json')
        assert client.get(path + '/work-progress').status_code == 200
        assert client.get(path + '/work-progress?as_of=0001-01-01').status_code == 422
        assert client.get(f'/construction/objects/{obj}/work-progress?as_of=9999-12-31').status_code == 422
        assert client.put(path + '/work-plan', json=payload).status_code == 403
        permissions.append('construction.write')
        assert client.put(path + '/work-plan', json=payload).status_code == 200
        assert client.put(path + '/work-plan', json=payload).status_code == 200
        archived_payload = {"items": [{**payload['items'][0], 'expected_version': 1,
                                      'plan': {**payload['items'][0]['plan'], 'archived': True}}]}
        assert client.put(path + '/work-plan', json=archived_payload).status_code == 200
        assert client.get(path + '/work-progress').json()['items'] == []
        assert len(client.get(path + '/work-progress?include_archived=true').json()['items']) == 1
        assert len(client.get(f'/construction/objects/{obj}/work-progress?include_archived=true').json()['items']) == 1
        payload['items'][0]['plan']['name'] = 'Другой план'
        assert client.put(path + '/work-plan', json=payload).status_code == 409
        assert client.get(path.replace(GROUP, OTHER) + '/work-progress').status_code == 404
        payload['items'][0]['plan']['planned_quantity'] = '-1'
        assert client.put(path + '/work-plan', json=payload).status_code == 422
        permissions.clear()
        assert client.get(path + '/work-progress').status_code == 403
        assert client.get(f'/construction/objects/{obj}/work-progress').status_code == 403


def test_migration_roundtrip_and_orm_contract():
    path = Path(__file__).resolve().parents[1] / 'WEB-itinvent/backend/alembic/versions/20260908_0108_construction_work_progress.py'
    namespace = runpy.run_path(str(path))
    engine = sa.create_engine('sqlite:///:memory:')
    with engine.begin() as connection:
        namespace['upgrade'].__globals__['op'] = Operations(MigrationContext.configure(connection))
        namespace['upgrade'].__globals__['_scope'] = lambda: 'app'
        namespace['upgrade']()
        inspector = sa.inspect(connection)
        assert set(inspector.get_table_names()) == {'construction_work_items', 'construction_work_entries', 'construction_work_audit'}
        assert inspector.get_foreign_keys('construction_work_entries')[0]['referred_table'] == 'construction_work_items'
        assert {c['name'] for c in inspector.get_columns('construction_work_items')} == set(AppConstructionWorkItem.__table__.columns.keys())
        assert {c['name'] for c in inspector.get_columns('construction_work_audit')} == set(AppConstructionWorkAudit.__table__.columns.keys())
        namespace['downgrade']()
        assert not sa.inspect(connection).get_table_names()
