"""Read-only preflight; --execute backs up and applies only planning revision 0109.

Uses the existing construction migration runner: bounded lock/statement timeouts,
verified pg_dump archives, exact revision checks and independent schema postcheck.
"""
import importlib.util
import json
from pathlib import Path
import sys

spec = importlib.util.spec_from_file_location('construction_migration_runner', Path(__file__).with_name('apply-work-progress-migration.py'))
runner = importlib.util.module_from_spec(spec)
spec.loader.exec_module(runner)
runner.__doc__ = __doc__
runner.EXPECTED = '20260908_0108'
runner.TARGET = '20260908_0109'
runner.BASE_TABLES = (*runner.BASE_TABLES, *runner.NEW_COLUMNS)
runner.NEW_COLUMNS = {
    'construction_week_plans': {'object_id', 'week_start', 'version', 'payload_json', 'baseline_json'},
    'construction_day_crews': {'object_id', 'work_date', 'version', 'payload_json'},
    'construction_planning_audit': {'id', 'object_id', 'period', 'kind', 'actor_user_id', 'actor_name', 'changed_at', 'before_json', 'after_json'},
}
runner.LOCK_KEY = 'hubit:construction-work:20260908_0109'
runner.PG_OPTIONS = '-c lock_timeout=5000 -c statement_timeout=120000 -c application_name=hubit-construction-0109'


def check_final(state):
    if state['revisions'] != [runner.TARGET] or state['invalid_indexes'] or state['unvalidated_constraints']:
        raise RuntimeError('Planning migration revision/index/constraint postcheck failed')
    for table, columns in runner.NEW_COLUMNS.items():
        if set(state['tables'].get(table, {}).get('columns', ())) != columns:
            raise RuntimeError(f'Planning migration columns mismatch: {table}')
    if state['tables']['construction_planning_audit']['indexes'].get('ix_construction_planning_audit_scope') != ['object_id', 'period', 'id']:
        raise RuntimeError('Planning history index mismatch')


runner.check_final = check_final
if __name__ == '__main__':
    try:
        runner.main()
    except Exception as exc:
        print(json.dumps({'status': 'failed', 'error_type': type(exc).__name__, 'detail': str(exc) if type(exc) is RuntimeError else 'Planning migration failed; inspect preflight. No automatic rollback was attempted.'}), file=sys.stderr)
        raise SystemExit(1)
