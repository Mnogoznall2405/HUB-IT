from __future__ import annotations

import runpy
from pathlib import Path

from alembic.migration import MigrationContext
from alembic.operations import Operations
from sqlalchemy import create_engine, inspect


ROOT = Path(__file__).resolve().parents[1]
REVISION = (
    ROOT
    / "WEB-itinvent"
    / "backend"
    / "alembic"
    / "versions"
    / "20260728_0072_docflow_credentials.py"
)
COMMAND_REVISION = (
    ROOT
    / "WEB-itinvent"
    / "backend"
    / "alembic"
    / "versions"
    / "20260729_0073_docflow_commands.py"
)


def test_docflow_revision_upgrades_and_downgrades_on_sqlite():
    namespace = runpy.run_path(str(REVISION))
    upgrade = namespace["upgrade"]
    downgrade = namespace["downgrade"]

    engine = create_engine("sqlite+pysqlite:///:memory:", future=True)
    with engine.begin() as connection:
        operations = Operations(MigrationContext.configure(connection))
        upgrade.__globals__["op"] = operations
        upgrade.__globals__["_scope"] = lambda: "app"
        downgrade.__globals__["op"] = operations
        downgrade.__globals__["_scope"] = lambda: "app"

        upgrade()
        inspector = inspect(connection)
        assert inspector.has_table("docflow_credentials")
        assert inspector.has_table("docflow_audit_events")
        assert {column["name"] for column in inspector.get_columns("docflow_credentials")} >= {
            "user_id",
            "login",
            "password_enc",
            "credential_version",
            "status",
        }
        assert {index["name"] for index in inspector.get_indexes("docflow_audit_events")} >= {
            "ix_app_docflow_audit_events_correlation_id",
            "ix_app_docflow_audit_user_created",
        }

        downgrade()
        inspector = inspect(connection)
        assert not inspector.has_table("docflow_credentials")
        assert not inspector.has_table("docflow_audit_events")


def test_docflow_command_revision_has_idempotency_constraint_on_sqlite():
    namespace = runpy.run_path(str(COMMAND_REVISION))
    upgrade = namespace["upgrade"]
    downgrade = namespace["downgrade"]

    engine = create_engine("sqlite+pysqlite:///:memory:", future=True)
    with engine.begin() as connection:
        operations = Operations(MigrationContext.configure(connection))
        upgrade.__globals__["op"] = operations
        upgrade.__globals__["_scope"] = lambda: "app"
        downgrade.__globals__["op"] = operations
        downgrade.__globals__["_scope"] = lambda: "app"

        upgrade()
        inspector = inspect(connection)
        assert inspector.has_table("docflow_commands")
        assert {column["name"] for column in inspector.get_columns("docflow_commands")} >= {
            "user_id",
            "idempotency_key",
            "request_hash",
            "state_token_hash",
            "remote_before_json",
        }
        assert {
            item["name"] for item in inspector.get_unique_constraints("docflow_commands")
        } >= {"uq_app_docflow_command_user_key"}

        downgrade()
        assert not inspect(connection).has_table("docflow_commands")
