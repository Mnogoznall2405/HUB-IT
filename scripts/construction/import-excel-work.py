"""Reviewed Excel work import: default read-only, --execute backs up then creates new rows atomically.

No existing work is overwritten. UUIDs are stable by source sheet/row; repeats are
no-ops only when the stored plan and scope exactly match the reviewed manifest.
"""
from contextlib import contextmanager
from datetime import datetime, timezone
import argparse
import hashlib
import importlib.util
import json
from pathlib import Path
import sys
import shutil
from collections import Counter
from dotenv import dotenv_values
import sqlalchemy as sa
from sqlalchemy.orm import Session

ROOT = Path(__file__).resolve().parents[2]
sys.path.insert(0, str(ROOT / 'WEB-itinvent'))
from backend.appdb.models import AppConstructionWorkItem as Item, AppConstructionWorkAudit as Audit
from backend.models.construction_work import WorkPlanBatch
from backend.services import construction_work_service as work

OBJECT = 'construction-679031a448704ff783fb'
GROUPS = {'720/7':'71a8cc38-f313-11ed-bb4c-9cdc71d673ac', '583/3':'16fd15bf-34f1-11ee-8829-5cba2c6341b0', '583/2':'045cbb21-34f1-11ee-8829-5cba2c6341b0'}

def import_rows(connection, candidates):
    """Use the native service and one caller-owned transaction, including its audit."""
    original = work.app_session
    @contextmanager
    def scoped_session(database_url=None):
        with Session(bind=connection, autoflush=False, expire_on_commit=False) as session:
            yield session
            session.flush()
    work.app_session = scoped_session
    try:
        service = work.ConstructionWorkService()
        for block, group in GROUPS.items():
            rows = [row for row in candidates if row['source_block'] == block]
            for offset in range(0, len(rows), 200):
                payload = WorkPlanBatch.model_validate({'items': [{'id':row['id'],'expected_version':0,'plan':row['plan']} for row in rows[offset:offset+200]]})
                service.save(OBJECT, group, payload, actor_id=0, actor_name='Импорт Сводного Excel (по запросу администратора)')
    finally:
        work.app_session = original

def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('manifest',type=Path)
    parser.add_argument('--blocks',nargs='+',choices=list(GROUPS),required=True)
    parser.add_argument('--execute',action='store_true')
    args=parser.parse_args()
    manifest=json.loads(args.manifest.read_text(encoding='utf-8'))
    source=ROOT/manifest['source']
    if source.parent != ROOT or hashlib.sha256(source.read_bytes()).hexdigest()!=manifest['sha256']:
        raise ValueError('Source workbook has changed since review')
    candidates=[row for sheet in manifest['sheets'] for row in sheet['items'] if row['source_block'] in args.blocks]
    if len({row['id'] for row in candidates}) != len(candidates): raise ValueError('Duplicate source IDs')
    for row in candidates:
        WorkPlanBatch.model_validate({'items':[{'id':row['id'],'expected_version':0,'plan':row['plan']}]})
    url=dotenv_values(ROOT/'.env')['APP_DATABASE_URL']
    parsed=sa.engine.make_url(url)
    if parsed.get_backend_name()!='postgresql': raise ValueError('Expected PostgreSQL target')
    engine=sa.create_engine(url,poolclass=sa.pool.NullPool,hide_parameters=True,connect_args={'connect_timeout':5,'application_name':'hubit-construction-excel-import'})
    with engine.connect().execution_options(isolation_level='REPEATABLE READ') as connection, connection.begin():
        if not args.execute: connection.execute(sa.text('SET TRANSACTION READ ONLY'))
        connection.execute(sa.text("SET LOCAL lock_timeout='5000ms'"))
        connection.execute(sa.text("SET LOCAL statement_timeout='60000ms'"))
        memberships=dict(connection.execute(sa.text('SELECT group_ref,group_name FROM app.construction_object_1c_groups WHERE object_id=:object'),{'object':OBJECT}).all())
        if any(GROUPS[block] not in memberships for block in args.blocks): raise ValueError('Object membership changed')
        existing={row.id:row for row in connection.execute(sa.select(Item.id,Item.object_id,Item.group_ref,Item.plan_json))}
        pending=[]
        for row in candidates:
            before=existing.get(row['id'])
            if before:
                if before.object_id!=OBJECT or before.group_ref!=GROUPS[row['source_block']] or json.loads(before.plan_json)!=row['plan']:
                    raise ValueError('Existing work differs from import; no overwrites allowed')
            else: pending.append(row)
        if sum(row.object_id==OBJECT for row in existing.values())+len(pending)>5000: raise ValueError('Object work limit exceeded')
        print(json.dumps({'mode':'execute' if args.execute else 'preflight','object':OBJECT,'blocks':dict(Counter(row['source_block'] for row in candidates)), 'existing_work_items':len(existing),'new_items':len(pending),'already_imported':len(candidates)-len(pending)},ensure_ascii=False),flush=True)
        if not args.execute or not pending: return
        if shutil.disk_usage(ROOT).free < 100 * 1024 * 1024:
            raise ValueError('Not enough free space for verified rollback backups')
        waiting=connection.execute(sa.text("SELECT count(*) FROM pg_locks l JOIN pg_class c ON c.oid=l.relation JOIN pg_namespace n ON n.oid=c.relnamespace WHERE n.nspname='app' AND c.relname LIKE 'construction_%' AND NOT l.granted")).scalar_one()
        if waiting: raise ValueError('Construction tables have pending locks; postpone import')
        if not connection.execute(sa.text("SELECT pg_try_advisory_xact_lock(hashtext('hubit-construction-excel-import'))")).scalar_one():
            raise ValueError('Another import is running')
        spec=importlib.util.spec_from_file_location('migration_backup',Path(__file__).with_name('apply-work-progress-migration.py'))
        backup_module=importlib.util.module_from_spec(spec); spec.loader.exec_module(backup_module)
        snapshot=connection.execute(sa.text('SELECT pg_export_snapshot()')).scalar_one()
        backup_dir=ROOT/'deploy_backups'/('construction-excel-'+datetime.now(timezone.utc).strftime('%Y%m%dT%H%M%SZ'))
        archives=backup_module.backup(Path(r'C:\Program Files\PostgreSQL\16\bin'),backup_dir,backup_module.backup_environment(parsed),snapshot)
        record={'source_sha256':manifest['sha256'],'manifest_sha256':hashlib.sha256(args.manifest.read_bytes()).hexdigest(),'new_ids':[row['id'] for row in pending],'archives':archives,'rollback':'Before commit: transaction rollback. After commit: archive only these IDs after checking for new daily entries or edits; never restore the whole database over user changes.'}
        (backup_dir/'import-manifest.json').write_text(json.dumps(record,ensure_ascii=False,indent=2),encoding='utf-8')
        print(json.dumps({'backup_verified':True,'directory':str(backup_dir),'new_items':len(pending)}),flush=True)
        import_rows(connection,pending)
        saved={row.id:row for row in connection.execute(sa.select(Item.id,Item.group_ref,Item.plan_json).where(Item.id.in_([row['id'] for row in candidates])))}
        if any(row['id'] not in saved or json.loads(saved[row['id']].plan_json)!=row['plan'] or saved[row['id']].group_ref!=GROUPS[row['source_block']] for row in candidates):
            raise ValueError('Plan postcheck failed; transaction will roll back')
        audits=connection.execute(sa.select(sa.func.count()).select_from(Audit).where(Audit.work_id.in_([row['id'] for row in pending]),Audit.action=='plan')).scalar_one()
        if audits!=len(pending): raise ValueError('Audit postcheck failed')
    engine.dispose()
    print(json.dumps({'status':'committed','new_items':len(pending),'plans_verified':len(candidates),'audits_verified':audits}),flush=True)

if __name__=='__main__':
    try: main()
    except Exception as exc:
        # SQL/driver diagnostics may contain credentials or parameters.
        print(json.dumps({'status':'failed','error_type':type(exc).__name__}),flush=True)
        sys.exit(1)
