"""Critical schema checks: HTTP tests cannot verify downgrade or unique keys."""
import runpy
from pathlib import Path

import pytest
import sqlalchemy as sa
from alembic.migration import MigrationContext
from alembic.operations import Operations

REVISION = Path(__file__).resolve().parents[1] / "WEB-itinvent/backend/alembic/versions/20261008_0127_ai_smart_memory.py"


def test_upgrade_repeat_downgrade_preserve_existing_memories():
    namespace = runpy.run_path(str(REVISION))
    engine = sa.create_engine("sqlite:///:memory:")
    with engine.begin() as connection:
        connection.exec_driver_sql("CREATE TABLE ai_user_memories (id TEXT PRIMARY KEY, content TEXT NOT NULL)")
        connection.exec_driver_sql("INSERT INTO ai_user_memories VALUES ('legacy', 'Предпочитаю XLSX')")
        operations = Operations(MigrationContext.configure(connection))
        namespace["upgrade"].__globals__["op"] = operations
        namespace["upgrade"].__globals__["_scope"] = lambda: "app"
        namespace["upgrade"]()
        namespace["upgrade"]()
        connection.exec_driver_sql("INSERT INTO ai_memory_facts VALUES ('one', 99, 'report_format', 1)")
        connection.exec_driver_sql("INSERT INTO ai_memory_facts VALUES ('other-user', 100, 'report_format', 1)")
        with pytest.raises(sa.exc.IntegrityError):
            connection.exec_driver_sql("INSERT INTO ai_memory_facts VALUES ('duplicate', 99, 'report_format', 1)")
        connection.exec_driver_sql("INSERT INTO ai_memory_events VALUES ('e1',99,'c1','m1',1,'applied','[]',CURRENT_TIMESTAMP)")
        with pytest.raises(sa.exc.IntegrityError):
            connection.exec_driver_sql("INSERT INTO ai_memory_events VALUES ('e2',99,'c1','m1',1,'applied','[]',CURRENT_TIMESTAMP)")
        namespace["downgrade"]()
        inspector = sa.inspect(connection)
        assert not inspector.has_table("ai_memory_state")
        assert not inspector.has_table("ai_memory_facts")
        assert not inspector.has_table("ai_memory_events")
        assert connection.exec_driver_sql("SELECT content FROM ai_user_memories WHERE id='legacy'").scalar() == "Предпочитаю XLSX"


def test_chat_only_migration_does_not_create_app_tables():
    namespace = runpy.run_path(str(REVISION))
    engine = sa.create_engine("sqlite:///:memory:")
    with engine.begin() as connection:
        namespace["upgrade"].__globals__["op"] = Operations(MigrationContext.configure(connection))
        namespace["upgrade"].__globals__["_scope"] = lambda: "chat"
        namespace["upgrade"]()
        assert sa.inspect(connection).get_table_names() == []
