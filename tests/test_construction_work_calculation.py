from datetime import date, timedelta
import json
from pathlib import Path
import runpy
from uuid import uuid4

import pytest

from backend.appdb.db import app_session
from backend.appdb.models import AppGlobalSetting
from backend.models.construction_work import WorkDayBatch, WorkPlanBatch, WorkResponse
from backend.services.construction_management_service import ConstructionManagementService
from backend.services.construction_work_service import ConstructionWorkService
from backend.services.construction_work_calculation import CalculationProfile, calculate, calculation_key

GROUP = '11111111-1111-1111-1111-111111111111'
TODAY = date.today()


def profile(ids):
    return CalculationProfile.model_validate({
        'source_sheet': 'Первый лист', 'source_sha256': 'a' * 64, 'group_ref': GROUP,
        'baseline_date': TODAY.isoformat(), 'work_ids': ids,
        'sections': [{'name': str(index), 'numerator': {'terms': [{'work_id': work_id, 'field': 'total_quantity', 'coefficient': 1}]},
                      'denominator': {'terms': [{'work_id': work_id, 'field': 'planned_quantity', 'coefficient': 1}]}} for index, work_id in enumerate(ids)],
    })


def item(work_id, plan, total):
    return {'id': work_id, 'group_ref': GROUP, 'plan': {'planned_quantity': plan, 'archived': False}, 'total_quantity': total}


def test_mean_is_by_source_sections_and_preserves_overfulfilment():
    ids = [str(uuid4()), str(uuid4())]
    data = [item(ids[0], 1000, 1500), item(ids[1], 10, 5), item(str(uuid4()), 1, 0)]
    result = calculate(profile(ids), data, TODAY)
    assert result['percent'] == 100  # mean(150%, 50%), not a weighted/capped total
    assert result['calculation']['excluded_works'] == 1
    data[1]['total_quantity'] = 10
    assert calculate(profile(ids), data, TODAY)['percent'] == 125
    data[0]['plan']['planned_quantity'] = 1500
    assert calculate(profile(ids), data, TODAY)['percent'] == 100


def test_missing_archived_wrong_scope_zero_plan_and_prebaseline_are_not_false_totals():
    work_id = str(uuid4()); policy = profile([work_id]); data = [item(work_id, 10, 5)]
    assert calculate(policy, data, TODAY - timedelta(days=1))['percent'] is None
    assert calculate(policy, [], TODAY)['calculation']['missing_works'] == 1
    data[0]['plan']['archived'] = True
    assert calculate(policy, data, TODAY)['percent'] is None
    data[0]['plan']['archived'] = False; data[0]['group_ref'] = 'other'
    assert calculate(policy, data, TODAY)['percent'] is None
    data[0]['group_ref'] = GROUP; data[0]['plan']['planned_quantity'] = 0
    assert calculate(policy, data, TODAY)['percent'] is None


def test_profile_survives_plan_edits_and_uses_live_journal_in_native_response(tmp_path):
    url = f"sqlite+pysqlite:///{(tmp_path / 'rollup.db').as_posix()}"
    management = ConstructionManagementService(url)
    obj = management.save_object(object_id=None, name='Объект', groups=[{'group_ref': GROUP, 'group_name': 'Первый лист'}], role_candidates={}, actor_user_id=1)['id']
    service = ConstructionWorkService(url)
    ids = [str(uuid4()), str(uuid4())]
    payload = WorkPlanBatch(items=[{'id': work_id, 'expected_version': 0, 'plan': {'section': 'Раздел', 'name': work_id, 'unit': 'м', 'planned_quantity': 100}} for work_id in ids])
    service.save(obj, GROUP, payload, actor_id=1, actor_name='ПТО')
    with app_session(url) as session:
        session.add(AppGlobalSetting(key=calculation_key(obj), value_json=profile(ids[:1]).model_dump_json()))
    service.save(obj, GROUP, WorkDayBatch(work_date=TODAY, items=[{'id': ids[0], 'expected_version': 1, 'quantity': 150}]), actor_id=1, actor_name='ПТО', daily=True)
    for group in (None, GROUP):
        result = WorkResponse.model_validate(service.read(obj, group))
        assert result.summary.percent == 150
        assert result.summary.calculation.excluded_works == 1
        assert result.trend[-1].percent == 150
        assert len(result.trend) == 1
        assert result.calculation_sections[0].percent == 150
    changed = payload.items[0].model_copy(update={'expected_version': 2})
    changed.plan.planned_quantity = 200
    service.save(obj, GROUP, WorkPlanBatch(items=[changed]), actor_id=1, actor_name='ПТО')
    assert service.read(obj, GROUP)['summary']['percent'] == 75


def test_reviewed_workbook_reconciles_all_24_sections():
    root = Path(__file__).resolve().parents[1]
    workbook = root / 'Сводный ГПР_22.11.2024.xlsx'
    manifest = root / 'tmp/construction-deploy-20260908/excel-preflight.json'
    if not workbook.exists() or not manifest.exists(): pytest.skip('Local reviewed source artifacts are not in CI')
    compile_profile = runpy.run_path(str(root / 'scripts/construction/prepare-first-sheet-calculation.py'))['compile_profile']
    policy, report = compile_profile(workbook, json.loads(manifest.read_text(encoding='utf-8')))
    assert report['percent'] == pytest.approx(91.59707083663025)
    assert report['sections'] == 24
    assert report['required_works'] == 920
    assert len(policy['notes']) == 1  # The manually entered H664 is explicit.
