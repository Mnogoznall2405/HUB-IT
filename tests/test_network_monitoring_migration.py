"""DDL invariants (upgrade/downgrade and uniqueness) cannot be tested via HTTP."""
import runpy
from pathlib import Path

import pytest
import sqlalchemy as sa
from alembic.migration import MigrationContext
from alembic.operations import Operations
from alembic.config import Config
from alembic.runtime.environment import EnvironmentContext

REVISION = Path(__file__).resolve().parents[1] / "WEB-itinvent/backend/alembic/versions/20261015_0135_network_monitoring.py"


def migration(connection, scope="app"):
    config = Config()
    config.attributes["itinvent_scope"] = scope
    context = MigrationContext.configure(connection, environment_context=EnvironmentContext(config, None))
    namespace = runpy.run_path(str(REVISION))
    namespace["upgrade"].__globals__["op"] = Operations(context)
    return namespace


def test_upgrade_repeat_unique_registry_and_downgrade_preserves_other_tables():
    engine = sa.create_engine("sqlite:///:memory:")
    with engine.begin() as connection:
        connection.execute(sa.text("CREATE TABLE unrelated (id INTEGER PRIMARY KEY)"))
        revision = migration(connection)
        revision["upgrade"]()
        revision["upgrade"]()
        tables = set(sa.inspect(connection).get_table_names())
        assert len(tables - {"unrelated"}) == 7
        connection.execute(sa.text("INSERT INTO monitoring_profiles VALUES ('p','Profile','encrypted',CURRENT_TIMESTAMP)"))
        statement = sa.text("INSERT INTO monitoring_targets VALUES (:id,1,'Router','10.0.0.1',161,'p',1,'{}','{}',CURRENT_TIMESTAMP)")
        connection.execute(statement, {"id": "a"})
        with pytest.raises(sa.exc.IntegrityError):
            connection.execute(statement, {"id": "b"})
        assert "ix_monitoring_samples_retention" in {index["name"] for index in sa.inspect(connection).get_indexes("monitoring_samples")}
        revision["downgrade"]()
        revision["downgrade"]()
        assert sa.inspect(connection).get_table_names() == ["unrelated"]


def test_chat_scope_does_not_install_monitoring():
    engine = sa.create_engine("sqlite:///:memory:")
    with engine.begin() as connection:
        revision = migration(connection, "chat")
        revision["upgrade"]()
        assert sa.inspect(connection).get_table_names() == []
