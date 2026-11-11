"""DDL upgrade/downgrade/defaults cannot be verified through the HTTP boundary."""
import runpy
from pathlib import Path

import pytest
import sqlalchemy as sa
from alembic.config import Config
from alembic.migration import MigrationContext
from alembic.operations import Operations
from alembic.runtime.environment import EnvironmentContext

REVISION = Path(__file__).resolve().parents[1] / "WEB-itinvent/backend/alembic/versions/20261016_0137_network_monitoring_visibility.py"


@pytest.mark.parametrize("scope", ["app", "all"])
def test_visibility_upgrade_defaults_and_downgrade_keep_registry(scope):
    engine = sa.create_engine("sqlite:///:memory:")
    with engine.begin() as connection:
        connection.exec_driver_sql("CREATE TABLE network_devices(id INTEGER PRIMARY KEY, device_code TEXT NOT NULL)")
        connection.exec_driver_sql("INSERT INTO network_devices VALUES(1,'Existing MikroTik')")
        connection.exec_driver_sql("CREATE TABLE monitoring_history(id INTEGER PRIMARY KEY)")
        connection.exec_driver_sql("INSERT INTO monitoring_history VALUES(7)")
        config = Config()
        config.attributes["itinvent_scope"] = scope
        context = MigrationContext.configure(connection, environment_context=EnvironmentContext(config, None))
        migration = runpy.run_path(str(REVISION))
        migration["upgrade"].__globals__["op"] = Operations(context)
        migration["upgrade"]()
        migration["upgrade"]()
        assert connection.exec_driver_sql("SELECT monitoring_only FROM network_devices WHERE id=1").scalar_one() == 0
        connection.exec_driver_sql("INSERT INTO network_devices(id,device_code) VALUES(2,'New switch')")
        assert connection.exec_driver_sql("SELECT monitoring_only FROM network_devices WHERE id=2").scalar_one() == 0
        connection.exec_driver_sql("UPDATE network_devices SET monitoring_only=1 WHERE id=1")
        migration["downgrade"]()
        migration["downgrade"]()
        assert "monitoring_only" not in {row["name"] for row in sa.inspect(connection).get_columns("network_devices")}
        assert connection.exec_driver_sql("SELECT device_code FROM network_devices ORDER BY id").scalars().all() == ["Existing MikroTik", "New switch"]
        assert connection.exec_driver_sql("SELECT id FROM monitoring_history").scalar_one() == 7


def test_chat_scope_does_not_touch_network_registry():
    engine = sa.create_engine("sqlite:///:memory:")
    with engine.begin() as connection:
        config = Config()
        config.attributes["itinvent_scope"] = "chat"
        context = MigrationContext.configure(connection, environment_context=EnvironmentContext(config, None))
        migration = runpy.run_path(str(REVISION))
        migration["upgrade"].__globals__["op"] = Operations(context)
        migration["upgrade"]()
        migration["downgrade"]()
        assert sa.inspect(connection).get_table_names() == []
