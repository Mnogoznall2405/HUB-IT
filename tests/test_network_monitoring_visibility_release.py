"""Release-only marking has no HTTP endpoint: verify its critical DB transaction."""
import runpy
from pathlib import Path

import pytest
import sqlalchemy as sa
from alembic.config import Config
from alembic.migration import MigrationContext
from alembic.operations import Operations
from alembic.runtime.environment import EnvironmentContext
from scripts.network_monitoring_visibility import set_visibility

ROOT = Path(__file__).resolve().parents[1]


@pytest.fixture
def marking_db():
    engine = sa.create_engine("sqlite:///:memory:")
    with engine.begin() as connection:
        config = Config()
        config.attributes["itinvent_scope"] = "app"
        context = MigrationContext.configure(connection, environment_context=EnvironmentContext(config, None))
        for name in ("20260327_0003_network_init.py", "20261016_0137_network_monitoring_visibility.py"):
            migration = runpy.run_path(str(ROOT / "WEB-itinvent/backend/alembic/versions" / name))
            migration["upgrade"].__globals__["op"] = Operations(context)
            migration["upgrade"]()
        connection.exec_driver_sql("INSERT INTO network_branches(id,city_code,branch_code,name,created_at,updated_at) VALUES(1,'test','test','Test','before','before')")
        for device_id in (1, 2, 3):
            connection.execute(sa.text("INSERT INTO network_devices(id,branch_id,device_code,vendor,mgmt_ip,created_at,updated_at) VALUES(:id,1,:name,'MikroTik',:ip,'before','before')"),
                               {"id": device_id, "name": f"Router {device_id}", "ip": f"192.0.2.{device_id}"})
        connection.exec_driver_sql("CREATE TABLE monitoring_samples(id INTEGER PRIMARY KEY, value INTEGER)")
        connection.exec_driver_sql("INSERT INTO monitoring_samples VALUES(10,9000)")
    yield engine, set_visibility, {1: "192.0.2.1", 2: "192.0.2.2"}
    engine.dispose()


def test_marking_repeated_apply_and_rollback_preserve_other_equipment_and_history(marking_db):
    engine, change, selected = marking_db
    with engine.begin() as connection:
        assert change(connection, selected, hidden=True)["changed_ids"] == [1, 2]
        assert change(connection, selected, hidden=True)["changed_ids"] == []
        assert connection.exec_driver_sql("SELECT id FROM network_devices WHERE monitoring_only=0").scalars().all() == [3]
        assert connection.exec_driver_sql("SELECT count(*) FROM network_audit_log").scalar_one() == 2
    with engine.begin() as connection:
        change(connection, selected, hidden=False)
        assert connection.exec_driver_sql("SELECT id FROM network_devices WHERE monitoring_only=0 ORDER BY id").scalars().all() == [1, 2, 3]
        assert connection.exec_driver_sql("SELECT id,value FROM monitoring_samples").all() == [(10, 9000)]


def test_marking_rejects_changed_identity_and_wire_dependencies(marking_db):
    engine, change, selected = marking_db
    with pytest.raises(ValueError, match="identity"):
        with engine.begin() as connection:
            change(connection, {1: "192.0.2.99", 2: selected[2]}, hidden=True)
    with engine.begin() as connection:
        connection.exec_driver_sql("INSERT INTO network_ports(id,device_id,port_name,created_at,updated_at) VALUES(1,2,'ether1','before','before')")
    with pytest.raises(ValueError, match="dependencies"):
        with engine.begin() as connection:
            change(connection, selected, hidden=True)
    with engine.connect() as connection:
        assert connection.exec_driver_sql("SELECT count(*) FROM network_devices WHERE monitoring_only=1").scalar_one() == 0
        assert connection.exec_driver_sql("SELECT count(*) FROM network_audit_log").scalar_one() == 0
        assert connection.exec_driver_sql("SELECT device_id FROM network_ports").scalar_one() == 2


def test_audit_failure_rolls_back_all_visibility_updates(marking_db):
    engine, change, selected = marking_db
    with engine.begin() as connection:
        connection.exec_driver_sql("CREATE TRIGGER block_second_audit BEFORE INSERT ON network_audit_log WHEN NEW.entity_id='2' BEGIN SELECT RAISE(ABORT,'test failure'); END")
    with pytest.raises(sa.exc.DatabaseError):
        with engine.begin() as connection:
            change(connection, selected, hidden=True)
    with engine.connect() as connection:
        assert connection.exec_driver_sql("SELECT count(*) FROM network_devices WHERE monitoring_only=1").scalar_one() == 0
        assert connection.exec_driver_sql("SELECT count(*) FROM network_audit_log").scalar_one() == 0
        assert connection.exec_driver_sql("SELECT count(*) FROM monitoring_samples").scalar_one() == 1
