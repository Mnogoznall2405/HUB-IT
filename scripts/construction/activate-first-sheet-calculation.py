"""Default read-only preflight; --execute activates only the reviewed first-sheet scope.

Creates one missing source work (unknown unit retained explicitly) and one scoped
calculation setting. Existing plans, entries and settings are never overwritten.
"""
import argparse
from contextlib import contextmanager
from datetime import date, datetime, timezone
import hashlib
import json
from pathlib import Path
import runpy
import shutil
import sys

from dotenv import dotenv_values
import sqlalchemy as sa
from sqlalchemy.orm import Session

ROOT = Path(__file__).resolve().parents[2]
sys.path.insert(0, str(ROOT / 'WEB-itinvent'))
from backend.appdb.models import AppGlobalSetting, AppConstructionWorkItem as Item
from backend.models.construction_work import WorkPlanBatch, WorkResponse
from backend.services import construction_work_service as work
from backend.services.construction_work_calculation import CalculationProfile, calculate, calculation_key

OBJECT = 'construction-679031a448704ff783fb'


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('profile', type=Path)
    parser.add_argument('missing_work', type=Path)
    parser.add_argument('--execute', action='store_true')
    args = parser.parse_args()
    profile = CalculationProfile.model_validate_json(args.profile.read_text(encoding='utf-8'))
    source = ROOT / 'Сводный ГПР_22.11.2024.xlsx'
    if hashlib.sha256(source.read_bytes()).hexdigest() != profile.source_sha256: raise ValueError('Source changed')
    candidate = json.loads(args.missing_work.read_text(encoding='utf-8'))
    if candidate['id'] != '0fa78898-d750-536e-83b6-3249e092e586' or candidate['source_row'] != 849:
        raise ValueError('Unexpected additional work')
    payload = WorkPlanBatch.model_validate({'items': [{'id': candidate['id'], 'expected_version': 0, 'plan': candidate['plan']}]})
    key = calculation_key(OBJECT)
    url = dotenv_values(ROOT / '.env')['APP_DATABASE_URL']
    parsed = sa.engine.make_url(url)
    if parsed.get_backend_name() != 'postgresql': raise ValueError('Expected PostgreSQL')
    engine = sa.create_engine(url, poolclass=sa.pool.NullPool, hide_parameters=True, connect_args={'connect_timeout': 5, 'application_name': 'hubit-first-sheet-calculation'})
    original = work.app_session
    try:
        with engine.connect().execution_options(isolation_level='REPEATABLE READ') as connection, connection.begin():
            if not args.execute: connection.execute(sa.text('SET TRANSACTION READ ONLY'))
            connection.execute(sa.text("SET LOCAL lock_timeout='5000ms'"))
            connection.execute(sa.text("SET LOCAL statement_timeout='60000ms'"))

            @contextmanager
            def scoped_session(database_url=None):
                with Session(bind=connection, autoflush=False, expire_on_commit=False) as session:
                    yield session
                    session.flush()

            work.app_session = scoped_session
            service = work.ConstructionWorkService(url)
            native = service.read(OBJECT, profile.group_ref)
            before_setting = connection.execute(sa.select(AppGlobalSetting.value_json).where(AppGlobalSetting.key == key)).scalar_one_or_none()
            if before_setting and CalculationProfile.model_validate_json(before_setting) != profile: raise ValueError('Existing calculation differs; no overwrite')
            existing = connection.execute(sa.select(Item.id, Item.object_id, Item.group_ref, Item.plan_json).where(Item.id == candidate['id'])).one_or_none()
            if existing and (existing.object_id != OBJECT or existing.group_ref != profile.group_ref): raise ValueError('Source work belongs to another scope')
            proposed = list(native['items'])
            if not existing:
                proposed.append({'id': candidate['id'], 'group_ref': profile.group_ref, 'plan': candidate['plan'], 'total_quantity': candidate['plan']['initial_quantity']})
            result = calculate(profile, proposed, date.today())
            if result['percent'] is None: raise ValueError('Required source works are missing, archived or invalid')
            print(json.dumps({'mode': 'execute' if args.execute else 'preflight', 'percent': result['percent'], 'scope': result['calculation'], 'new_works': int(not existing), 'new_settings': int(not before_setting)}, ensure_ascii=False), flush=True)
            if not args.execute or (existing and before_setting): return
            if shutil.disk_usage(ROOT).free < 100 * 1024 * 1024: raise ValueError('Insufficient backup space')
            if not connection.execute(sa.text("SELECT pg_try_advisory_xact_lock(hashtext('hubit-construction-excel-import'))")).scalar_one(): raise ValueError('Another import is running')
            if connection.execute(sa.text("SELECT count(*) FROM pg_locks l JOIN pg_class c ON c.oid=l.relation WHERE c.relname IN ('app_settings','construction_work_items','construction_work_entries') AND NOT l.granted")).scalar_one(): raise ValueError('Pending locks')
            directory = ROOT / 'deploy_backups' / ('construction-first-sheet-data-' + datetime.now(timezone.utc).strftime('%Y%m%dT%H%M%SZ'))
            backup = runpy.run_path(str(Path(__file__).with_name('apply-work-progress-migration.py')))
            snapshot = connection.execute(sa.text('SELECT pg_export_snapshot()')).scalar_one()
            archives = backup['backup'](Path(r'C:\Program Files\PostgreSQL\16\bin'), directory, backup['backup_environment'](parsed), snapshot)
            record = {'key': key, 'previous_value_json': before_setting, 'new_profile': profile.model_dump(mode='json'), 'new_work_id': None if existing else candidate['id'], 'archives': archives,
                      'rollback': 'Restore the saved setting only after comparing the installed profile. Preserve or archive the new work after checking for subsequent edits and entries. Never restore the entire DB over later changes.'}
            (directory / 'calculation-before.json').write_text(json.dumps(record, ensure_ascii=False, indent=2), encoding='utf-8')
            print(json.dumps({'backup_verified': True, 'directory': str(directory)}), flush=True)
            if not existing: service.save(OBJECT, profile.group_ref, payload, actor_id=0, actor_name='Перенос расчёта первого листа по запросу администратора')
            if not before_setting:
                with scoped_session() as session: session.add(AppGlobalSetting(key=key, value_json=profile.model_dump_json()))
            after = WorkResponse.model_validate(service.read(OBJECT, profile.group_ref))
            if after.summary.percent != result['percent'] or len(after.calculation_sections) != 24: raise ValueError('Native calculation postcheck failed')
            print(json.dumps({'transaction_verified': True, 'percent': after.summary.percent, 'works': after.summary.total}), flush=True)
    finally:
        work.app_session = original
        engine.dispose()
    print('Committed', flush=True)


if __name__ == '__main__':
    try: main()
    except Exception as exc:
        print(f'Activation failed: {type(exc).__name__}', file=sys.stderr)
        raise SystemExit(1)
