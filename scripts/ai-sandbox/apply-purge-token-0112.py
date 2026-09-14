"""Apply 0112 purge_token repair. Default read-only; --execute applies DDL."""
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
EXPECTED = "20260909_0111"
TARGET = "20260909_0112"
LOCK_KEY = "hubit:ai-sandbox-purge:20260909_0112"


def sql(connection, statement, values=None):
    return connection.execute(sa.text(statement), values or {})


def inspect_state(engine):
    with engine.connect() as connection, connection.begin():
        sql(connection, "SET TRANSACTION READ ONLY")
        inspector = sa.inspect(connection)
        cols = []
        if inspector.has_table("ai_sandbox_sessions", schema="app"):
            cols = [c["name"] for c in inspector.get_columns("ai_sandbox_sessions", schema="app")]
        return {
            "revisions": sql(
                connection, "SELECT version_num FROM system.alembic_version ORDER BY version_num"
            ).scalars().all(),
            "has_purge_token": "purge_token" in cols,
            "waiting_locks": sql(
                connection,
                """
                SELECT count(*) FROM pg_locks WHERE NOT granted AND database =
                  (SELECT oid FROM pg_database WHERE datname=current_database())
                """,
            ).scalar_one(),
        }


def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("--execute", action="store_true")
    args = parser.parse_args()
    url = str(dotenv_values(ROOT / ".env").get("APP_DATABASE_URL") or "").strip()
    sys.path.insert(0, str(ROOT / "WEB-itinvent"))
    from backend.config import config as backend_config

    if str(backend_config.app_db.database_url or "").strip() != url:
        raise RuntimeError("config_url_matches=false")
    cfg = Config(str(ROOT / "WEB-itinvent/backend/alembic.ini"))
    cfg.set_main_option("script_location", str(ROOT / "WEB-itinvent/backend/alembic"))
    if ScriptDirectory.from_config(cfg).get_heads() != [TARGET]:
        raise RuntimeError("unexpected heads")
    engine = sa.create_engine(url, poolclass=sa.pool.NullPool, hide_parameters=True,
                              connect_args={"connect_timeout": 5, "application_name": "ai-sandbox-0112"})
    try:
        before = inspect_state(engine)
        if before["revisions"] == [TARGET] and before["has_purge_token"]:
            print(json.dumps({"status": "already_current", "writes_performed": False}))
            return 0
        if before["revisions"] != [EXPECTED]:
            raise RuntimeError(f"expected {EXPECTED}, got {before['revisions']}")
        if before["waiting_locks"]:
            raise RuntimeError("waiting locks")
        if not args.execute:
            print(json.dumps({"status": "ready", "target": TARGET, "before": before}, default=str))
            return 0
        with engine.connect() as guard:
            locked = sql(guard, "SELECT pg_try_advisory_lock(hashtext(:key))", {"key": LOCK_KEY}).scalar_one()
            guard.commit()
            if not locked:
                raise RuntimeError("lock busy")
            try:
                os.environ["SKIP_PG_SCHEMA_DOCS"] = "1"
                from backend.db_migrations import upgrade_internal_database
                upgrade_internal_database(url, TARGET, scope="app")
                after = inspect_state(engine)
                if after["revisions"] != [TARGET] or not after["has_purge_token"]:
                    raise RuntimeError("postcheck failed")
                print(json.dumps({"status": "applied", "after": after}, default=str))
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
        print(json.dumps({"status": "failed", "error_type": type(exc).__name__,
                          "detail": str(exc) if type(exc) is RuntimeError else "see logs"}), file=sys.stderr)
        raise SystemExit(1)
