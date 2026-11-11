"""Revision 20261020_0139 creates the app tables that only the dev-time create_all ever created.

Unit-level on purpose: a migration cannot be exercised through an HTTP boundary. The tests pin
(1) that the frozen spec still matches the ORM models, (2) that it is safe on a database where the
tables already exist (production), (3) that downgrade never drops data.
"""
from __future__ import annotations

import runpy
import sys
from pathlib import Path

import sqlalchemy as sa
from alembic.migration import MigrationContext
from alembic.operations import Operations

ROOT = Path(__file__).resolve().parents[1]
WEB_ROOT = ROOT / "WEB-itinvent"
if str(WEB_ROOT) not in sys.path:
    sys.path.insert(0, str(WEB_ROOT))

from backend.appdb.models import AppBase  # noqa: E402

REVISION = WEB_ROOT / "backend" / "alembic" / "versions" / "20261020_0139_app_tables_missing_from_migrations.py"
TABLES = (
    "employee_absences",
    "ai_bots",
    "ai_bot_conversations",
    "ai_bot_runs",
    "transfer_act_jobs",
    "ai_pending_actions",
    "ai_kb_documents",
    "ai_kb_chunks",
)


def _run(connection, step: str, scope: str = "app") -> None:
    namespace = runpy.run_path(str(REVISION))
    function = namespace[step]
    function.__globals__["op"] = Operations(MigrationContext.configure(connection))
    function.__globals__["_scope"] = lambda: scope
    function()


def _shape(connection, table: str) -> dict:
    inspector = sa.inspect(connection)
    return {
        "columns": {
            column["name"]: (type(column["type"]).__name__, bool(column["nullable"]))
            for column in inspector.get_columns(table)
        },
        "primary_key": inspector.get_pk_constraint(table)["constrained_columns"],
        "indexes": {item["name"]: tuple(item["column_names"]) for item in inspector.get_indexes(table)},
        "uniques": {
            item["name"]: tuple(item["column_names"]) for item in inspector.get_unique_constraints(table)
        },
    }


def test_frozen_spec_matches_the_orm_models():
    models_engine = sa.create_engine("sqlite+pysqlite:///:memory:", future=True).execution_options(
        schema_translate_map={"app": None}
    )
    tables = [AppBase.metadata.tables[f"app.{name}"] for name in TABLES]
    migrated_engine = sa.create_engine("sqlite+pysqlite:///:memory:", future=True)
    with models_engine.begin() as models_connection, migrated_engine.begin() as migrated_connection:
        AppBase.metadata.create_all(models_connection, tables=tables)
        _run(migrated_connection, "upgrade")
        for name in TABLES:
            assert _shape(migrated_connection, name) == _shape(models_connection, name), name


def test_upgrade_is_safe_on_a_database_where_the_tables_already_exist():
    engine = sa.create_engine("sqlite+pysqlite:///:memory:", future=True)
    with engine.begin() as connection:
        connection.exec_driver_sql(
            "CREATE TABLE ai_bot_runs (id VARCHAR(64) PRIMARY KEY, bot_id VARCHAR(64) NOT NULL, "
            "conversation_id VARCHAR(36) NOT NULL, user_id INTEGER NOT NULL, trigger_message_id VARCHAR(36) NOT NULL, "
            "status VARCHAR(24) NOT NULL, stage VARCHAR(64), status_text TEXT, error_text TEXT, request_json TEXT NOT NULL, "
            "result_json TEXT NOT NULL, usage_json TEXT NOT NULL, started_at DATETIME, completed_at DATETIME, "
            "created_at DATETIME NOT NULL, updated_at DATETIME NOT NULL)"
        )
        connection.exec_driver_sql(
            "INSERT INTO ai_bot_runs VALUES ('run-1','bot','conv',1,'msg','done',NULL,NULL,NULL,'{}','{}','{}',NULL,NULL,"
            "'2026-10-20','2026-10-20')"
        )

        _run(connection, "upgrade")
        _run(connection, "upgrade")  # idempotent

        assert connection.exec_driver_sql("SELECT id, status FROM ai_bot_runs").fetchall() == [("run-1", "done")]
        assert "ix_app_ai_bot_runs_status_created_at" in _shape(connection, "ai_bot_runs")["indexes"]
        assert all(sa.inspect(connection).has_table(name) for name in TABLES)


def test_downgrade_keeps_the_tables_and_their_data():
    engine = sa.create_engine("sqlite+pysqlite:///:memory:", future=True)
    with engine.begin() as connection:
        _run(connection, "upgrade")
        connection.exec_driver_sql(
            "INSERT INTO employee_absences (display_name, kind, starts_on, ends_on, source, created_at, updated_at) "
            "VALUES ('Иванов', 'vacation', '2026-10-20', '2026-10-27', 'manual', '2026-10-20', '2026-10-20')"
        )

        _run(connection, "downgrade")

        assert connection.exec_driver_sql("SELECT display_name FROM employee_absences").fetchall() == [("Иванов",)]


def test_chat_scope_does_not_touch_the_app_tables():
    engine = sa.create_engine("sqlite+pysqlite:///:memory:", future=True)
    with engine.begin() as connection:
        _run(connection, "upgrade", scope="chat")

        assert not any(sa.inspect(connection).has_table(name) for name in TABLES)
