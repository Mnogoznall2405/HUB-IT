import importlib.util
from pathlib import Path
from types import SimpleNamespace
import pytest
import sqlalchemy as sa
from alembic.migration import MigrationContext
from alembic.operations import Operations


def test_legacy_upgrade_delivery_and_downgrade():
    path=Path(__file__).resolve().parents[1]/'WEB-itinvent/backend/alembic/versions/20260914_0116_ai_sandbox_finalization_repair.py'
    spec=importlib.util.spec_from_file_location('repair',path)
    module=importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    engine=sa.create_engine('sqlite://')
    with engine.begin() as db:
        db.exec_driver_sql("CREATE TABLE ai_sandbox_jobs(id INTEGER PRIMARY KEY,user_id INTEGER,status VARCHAR(24),updated_at TEXT)")
        db.exec_driver_sql("CREATE TABLE ai_sandbox_files(id INTEGER PRIMARY KEY)")
        db.exec_driver_sql("INSERT INTO ai_sandbox_jobs VALUES(1,7,'succeeded','now')")
        context=MigrationContext.configure(db,environment_context=SimpleNamespace(config=SimpleNamespace(attributes={'itinvent_scope':'app'})))
        module.op=Operations(context)
        module.upgrade()
        module.upgrade()
        assert db.exec_driver_sql('SELECT finalization_state FROM ai_sandbox_jobs').scalar()=='not_required'
        db.exec_driver_sql("INSERT INTO ai_sandbox_jobs(id,user_id,status,updated_at) VALUES(2,7,'finalizing','now')")
        with pytest.raises(sa.exc.IntegrityError):
            db.exec_driver_sql("INSERT INTO ai_sandbox_jobs(id,user_id,status,updated_at) VALUES(3,7,'queued','now')")
        with pytest.raises(RuntimeError,match='Drain'):
            module.downgrade()
        db.exec_driver_sql("UPDATE ai_sandbox_jobs SET status='succeeded' WHERE id=2")
        module.downgrade()
        assert 'finalization_state' not in {x['name'] for x in sa.inspect(db).get_columns('ai_sandbox_jobs')}
        assert db.exec_driver_sql('SELECT count(*) FROM ai_sandbox_jobs').scalar()==2
