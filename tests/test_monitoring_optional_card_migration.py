"""DDL upgrade/downgrade and its data guard cannot be verified through the HTTP boundary."""
import runpy
from pathlib import Path

import pytest
import sqlalchemy as sa
from alembic.config import Config
from alembic.migration import MigrationContext
from alembic.operations import Operations
from alembic.runtime.environment import EnvironmentContext

REVISION = Path(__file__).resolve().parents[1] / "WEB-itinvent/backend/alembic/versions/20261022_0143_monitoring_target_optional_card.py"


def _migration(connection, scope="all"):
    config = Config()
    config.attributes["itinvent_scope"] = scope
    context = MigrationContext.configure(connection, environment_context=EnvironmentContext(config, None))
    migration = runpy.run_path(str(REVISION))
    migration["upgrade"].__globals__["op"] = Operations(context)
    return migration


def _create(connection):
    connection.exec_driver_sql("CREATE TABLE monitoring_targets(id TEXT PRIMARY KEY, network_device_id INTEGER NOT NULL UNIQUE, name TEXT NOT NULL)")
    connection.exec_driver_sql("INSERT INTO monitoring_targets VALUES('a',5,'Existing')")


def test_upgrade_allows_unlinked_targets_and_downgrade_is_blocked_until_they_are_gone():
    engine = sa.create_engine("sqlite:///:memory:")
    with engine.begin() as connection:
        _create(connection)
        migration = _migration(connection)
        migration["upgrade"](); migration["upgrade"]()
        connection.exec_driver_sql("INSERT INTO monitoring_targets VALUES('b',NULL,'One')")
        connection.exec_driver_sql("INSERT INTO monitoring_targets VALUES('c',NULL,'Two')")
        with pytest.raises(sa.exc.IntegrityError):
            connection.exec_driver_sql("INSERT INTO monitoring_targets VALUES('d',5,'Duplicate card')")
        with pytest.raises(RuntimeError, match="Downgrade blocked"):
            migration["downgrade"]()
        connection.exec_driver_sql("DELETE FROM monitoring_targets WHERE network_device_id IS NULL")
        migration["downgrade"](); migration["downgrade"]()
        assert connection.exec_driver_sql("SELECT id, network_device_id FROM monitoring_targets").all() == [("a", 5)]
        with pytest.raises(sa.exc.IntegrityError):
            connection.exec_driver_sql("INSERT INTO monitoring_targets VALUES('e',NULL,'Again')")


def test_chat_scope_does_not_touch_monitoring_tables():
    engine = sa.create_engine("sqlite:///:memory:")
    with engine.begin() as connection:
        _create(connection)
        migration = _migration(connection, "chat")
        migration["upgrade"]()
        with pytest.raises(sa.exc.IntegrityError):
            connection.exec_driver_sql("INSERT INTO monitoring_targets VALUES('b',NULL,'One')")
