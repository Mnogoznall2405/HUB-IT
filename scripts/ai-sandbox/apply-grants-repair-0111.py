"""Apply app-scope Alembic 0111: missing AI sandbox grant tables.

Default mode is read-only preflight. Pass --execute to apply DDL.
"""
from __future__ import annotations

import argparse
import json
import os
import sys
from pathlib import Path

import sqlalchemy as sa
from alembic.config import Config
from alembic.script import ScriptDirectory
from dotenv import dotenv_values

ROOT = Path(__file__).resolve().parents[2]
EXPECTED = "20260909_0110"
TARGET = "20260909_0111"
TABLES = ("ai_sandbox_transfer_grants", "ai_sandbox_gateway_grants")
LOCK_KEY = "hubit:ai-sandbox-grants:20260909_0111"


def sql(connection, statement, values=None):
    return connection.execute(sa.text(statement), values or {})


def inspect_state(engine):
    with engine.connect() as connection, connection.begin():
        sql(connection, "SET TRANSACTION READ ONLY")
        sql(connection, "SET LOCAL statement_timeout = '10000ms'")
        sql(connection, "SET LOCAL lock_timeout = '1500ms'")
        inspector = sa.inspect(connection)
        tables = {}
        for name in (
            "ai_sandbox_sessions",
            "ai_sandbox_jobs",
            "ai_sandbox_files",
            "ai_sandbox_permissions",
            *TABLES,
        ):
            if not inspector.has_table(name, schema="app"):
                continue
            tables[name] = {
                "rows": sql(connection, f'SELECT count(*) FROM app."{name}"').scalar_one(),
                "columns": [c["name"] for c in inspector.get_columns(name, schema="app")],
                "indexes": sorted(
                    i["name"] for i in inspector.get_indexes(name, schema="app") if i.get("name")
                ),
            }
        activity = dict(
            sql(
                connection,
                """
                SELECT
                  count(*) FILTER (WHERE xact_start < now() - interval '5 minutes') AS long_transactions,
                  (SELECT count(*) FROM pg_locks WHERE NOT granted AND database =
                    (SELECT oid FROM pg_database WHERE datname = current_database())) AS waiting_locks
                FROM pg_stat_activity
                WHERE datname = current_database() AND pid <> pg_backend_pid()
                """
            ).mappings().one()
        )
        return {
            "revisions": sql(
                connection, "SELECT version_num FROM system.alembic_version ORDER BY version_num"
            ).scalars().all(),
            "tables": tables,
            "activity": activity,
        }


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--execute", action="store_true")
    args = parser.parse_args()

    url = str(dotenv_values(ROOT / ".env").get("APP_DATABASE_URL") or "").strip()
    if not url:
        raise RuntimeError("APP_DATABASE_URL missing")

    sys.path.insert(0, str(ROOT / "WEB-itinvent"))
    from backend.config import config as backend_config

    if str(backend_config.app_db.database_url or "").strip() != url:
        raise RuntimeError("config_url_matches=false")

    cfg = Config(str(ROOT / "WEB-itinvent/backend/alembic.ini"))
    cfg.set_main_option("script_location", str(ROOT / "WEB-itinvent/backend/alembic"))
    scripts = ScriptDirectory.from_config(cfg)
    heads = scripts.get_heads()
    if heads != [TARGET]:
        raise RuntimeError(f"Unexpected alembic heads={heads}; expected [{TARGET}]")

    engine = sa.create_engine(
        url,
        poolclass=sa.pool.NullPool,
        hide_parameters=True,
        connect_args={"connect_timeout": 5, "application_name": "ai-sandbox-0111"},
    )
    try:
        before = inspect_state(engine)
        if before["revisions"] == [TARGET] and all(t in before["tables"] for t in TABLES):
            print(json.dumps({"status": "already_current", "writes_performed": False, "state": before}, default=str))
            return 0
        if before["revisions"] != [EXPECTED]:
            raise RuntimeError(f"Expected revision {EXPECTED}, got {before['revisions']}")
        for parent in ("ai_sandbox_sessions", "ai_sandbox_jobs", "ai_sandbox_files", "ai_sandbox_permissions"):
            if parent not in before["tables"]:
                raise RuntimeError(f"Missing parent table {parent}")
        if before["activity"]["long_transactions"] or before["activity"]["waiting_locks"]:
            raise RuntimeError("long transactions or waiting locks present")
        missing = [t for t in TABLES if t not in before["tables"]]
        if not missing:
            raise RuntimeError("Grant tables already present but revision still at 0110; needs review")
        if not args.execute:
            print(
                json.dumps(
                    {
                        "status": "ready",
                        "writes_performed": False,
                        "target": TARGET,
                        "will_create": missing,
                        "effect": "CREATE two empty grant tables + indexes; stamp 0111",
                        "rollback": "alembic downgrade 20260909_0110 (drops only the two grant tables)",
                        "state": before,
                    },
                    default=str,
                )
            )
            return 0

        with engine.connect() as guard:
            locked = sql(guard, "SELECT pg_try_advisory_lock(hashtext(:key))", {"key": LOCK_KEY}).scalar_one()
            guard.commit()
            if not locked:
                raise RuntimeError("advisory lock busy")
            try:
                before2 = inspect_state(engine)
                if before2["revisions"] != [EXPECTED]:
                    raise RuntimeError("revision changed under lock")
                os.environ["SKIP_PG_SCHEMA_DOCS"] = "1"
                os.environ["PGOPTIONS"] = "-c lock_timeout=5000 -c statement_timeout=120000"
                from backend.db_migrations import upgrade_internal_database

                upgrade_internal_database(url, TARGET, scope="app")
                after = inspect_state(engine)
                if after["revisions"] != [TARGET]:
                    raise RuntimeError(f"postcheck revision={after['revisions']}")
                for name in TABLES:
                    if name not in after["tables"]:
                        raise RuntimeError(f"postcheck missing {name}")
                print(
                    json.dumps(
                        {
                            "status": "applied",
                            "writes_performed": True,
                            "target": TARGET,
                            "created": TABLES,
                            "before": before2,
                            "after": after,
                        },
                        default=str,
                    )
                )
            finally:
                if guard.in_transaction():
                    guard.rollback()
                sql(guard, "SELECT pg_advisory_unlock(hashtext(:key))", {"key": LOCK_KEY})
                guard.commit()
    finally:
        engine.dispose()
    return 0


if __name__ == "__main__":
    try:
        raise SystemExit(main())
    except Exception as exc:
        print(
            json.dumps(
                {
                    "status": "failed",
                    "error_type": type(exc).__name__,
                    "detail": str(exc) if type(exc) is RuntimeError else "see logs",
                }
            ),
            file=sys.stderr,
        )
        raise SystemExit(1)
