"""Index range access and rollback are not observable through an HTTP-only test."""
import runpy
from pathlib import Path

import sqlalchemy as sa
from alembic.config import Config
from alembic.migration import MigrationContext
from alembic.operations import Operations
from alembic.runtime.environment import EnvironmentContext


REVISION = Path(__file__).resolve().parents[1] / 'WEB-itinvent/backend/alembic/versions/20261117_0175_browser_probe_day_lookup.py'


def test_day_index_upgrade_range_plan_and_downgrade_preserve_visits():
    engine = sa.create_engine('sqlite:///:memory:')
    with engine.begin() as conn:
        conn.exec_driver_sql('CREATE TABLE browser_probe_visits (id INTEGER PRIMARY KEY, computer_name TEXT NOT NULL, visited_at TEXT)')
        conn.exec_driver_sql('CREATE INDEX host_day ON browser_probe_visits(computer_name, visited_at)')
        conn.execute(sa.text('INSERT INTO browser_probe_visits VALUES (:id, :host, :visited)'), [
            {'id': i, 'host': f'PC-{i % 10}', 'visited': '2026-11-17' if i < 10 else '2026-10-01'}
            for i in range(1000)
        ] + [{'id': 1000, 'host': 'undated', 'visited': None}])
        before = conn.exec_driver_sql('SELECT * FROM browser_probe_visits ORDER BY id').all()
        config = Config()
        config.attributes['itinvent_scope'] = 'app'
        context = MigrationContext.configure(conn, environment_context=EnvironmentContext(config, None))
        migration = runpy.run_path(str(REVISION))
        migration['upgrade'].__globals__['op'] = Operations(context)
        migration['upgrade']()
        migration['upgrade']()
        plan = conn.exec_driver_sql("EXPLAIN QUERY PLAN SELECT computer_name FROM browser_probe_visits WHERE visited_at >= '2026-11-17'").all()
        assert any('SEARCH' in row[3] and 'ix_app_browser_probe_visits_visited_computer' in row[3] for row in plan)
        assert len(conn.exec_driver_sql("SELECT DISTINCT computer_name FROM browser_probe_visits WHERE visited_at >= '2026-11-17'").all()) == 10
        migration['downgrade']()
        assert conn.exec_driver_sql('SELECT * FROM browser_probe_visits ORDER BY id').all() == before
        assert {idx['name'] for idx in sa.inspect(conn).get_indexes('browser_probe_visits')} == {'host_day'}
    engine.dispose()
