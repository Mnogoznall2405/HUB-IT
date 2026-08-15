from __future__ import annotations

import runpy
from pathlib import Path

import sqlalchemy as sa
from alembic.migration import MigrationContext
from alembic.operations import Operations


ROOT = Path(__file__).resolve().parents[1]
REVISION = (
    ROOT
    / "WEB-itinvent"
    / "backend"
    / "alembic"
    / "versions"
    / "20260815_0099_ai_sandbox.py"
)

SANDBOX_TABLES = {
    "ai_sandbox_sessions",
    "ai_sandbox_jobs",
    "ai_sandbox_files",
    "ai_sandbox_permissions",
    "ai_sandbox_transfer_grants",
    "ai_sandbox_gateway_grants",
}


def _migration(connection, *, scope: str):
    namespace = runpy.run_path(str(REVISION))
    operations = Operations(MigrationContext.configure(connection))
    for name in ("upgrade", "downgrade"):
        namespace[name].__globals__["op"] = operations
        namespace[name].__globals__["_scope"] = lambda: scope
    return namespace


def test_ai_sandbox_migration_upgrades_and_downgrades_all_runtime_tables() -> None:
    engine = sa.create_engine("sqlite+pysqlite:///:memory:", future=True)

    with engine.begin() as connection:
        migration = _migration(connection, scope="app")
        migration["upgrade"]()

        inspector = sa.inspect(connection)
        assert SANDBOX_TABLES.issubset(set(inspector.get_table_names()))
        assert "purge_token" in {
            column["name"] for column in inspector.get_columns("ai_sandbox_sessions")
        }
        assert {
            "job_id",
            "session_id",
            "user_id",
            "token_hash",
            "status",
            "request_count",
            "max_requests",
            "expires_at",
            "last_used_at",
            "revoked_at",
        }.issubset(
            {column["name"] for column in inspector.get_columns("ai_sandbox_gateway_grants")}
        )
        assert {
            "uq_app_ai_sandbox_gateway_grants_token_hash",
        } == {
            item["name"]
            for item in inspector.get_unique_constraints("ai_sandbox_gateway_grants")
        }
        assert {
            "ix_app_ai_sandbox_gateway_grants_job_status",
            "ix_app_ai_sandbox_gateway_grants_expiry",
        }.issubset(
            {item["name"] for item in inspector.get_indexes("ai_sandbox_gateway_grants")}
        )
        assert {
            "ix_app_ai_sandbox_transfer_grants_expiry",
            "ix_app_ai_sandbox_transfer_grants_job",
        }.issubset(
            {item["name"] for item in inspector.get_indexes("ai_sandbox_transfer_grants")}
        )
        gateway_checks = " ".join(
            str(item.get("sqltext") or "")
            for item in inspector.get_check_constraints("ai_sandbox_gateway_grants")
        )
        assert "request_count <= max_requests" in gateway_checks
        assert "'active','revoked','expired','exhausted'" in gateway_checks.replace(" ", "")

        migration["downgrade"]()
        assert SANDBOX_TABLES.isdisjoint(set(sa.inspect(connection).get_table_names()))


def test_ai_sandbox_migration_is_app_scope_only() -> None:
    engine = sa.create_engine("sqlite+pysqlite:///:memory:", future=True)

    with engine.begin() as connection:
        migration = _migration(connection, scope="chat")
        migration["upgrade"]()
        assert SANDBOX_TABLES.isdisjoint(set(sa.inspect(connection).get_table_names()))
