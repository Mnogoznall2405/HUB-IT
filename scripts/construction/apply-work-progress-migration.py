"""Read-only preflight, or explicitly requested targeted backup and app migration 0108.

Credentials are read from the repository .env and passed to pg_dump only through
its child-process environment. The default mode never changes production data.
"""
from __future__ import annotations

import argparse
from contextlib import contextmanager
from datetime import datetime, timezone
import hashlib
import json
import os
from pathlib import Path
import subprocess
import sys

from alembic.config import Config
from alembic.script import ScriptDirectory
from dotenv import dotenv_values
import sqlalchemy as sa
from sqlalchemy.engine import make_url


ROOT = Path(__file__).resolve().parents[2]
EXPECTED = "20260907_0107"
TARGET = "20260908_0108"
BASE_TABLES = (
    "construction_objects", "construction_object_1c_groups",
    "construction_object_role_assignments", "construction_direction_role_assignments",
)
NEW_COLUMNS = {
    "construction_work_items": {"id", "object_id", "group_ref", "plan_json", "version"},
    "construction_work_entries": {"id", "work_id", "work_date", "quantity", "details_json"},
    "construction_work_audit": {"id", "work_id", "actor_user_id", "actor_name", "changed_at", "action", "before_json", "after_json"},
}
LOCK_KEY = "hubit:construction-work:20260908_0108"
PG_OPTIONS = "-c lock_timeout=5000 -c statement_timeout=120000 -c application_name=hubit-construction-0108"
LIBPQ_QUERY_ENV = {
    "sslmode": "PGSSLMODE", "sslcert": "PGSSLCERT", "sslkey": "PGSSLKEY",
    "sslrootcert": "PGSSLROOTCERT", "sslcrl": "PGSSLCRL", "sslcrldir": "PGSSLCRLDIR",
    "ssl_min_protocol_version": "PGSSLMINPROTOCOLVERSION",
    "ssl_max_protocol_version": "PGSSLMAXPROTOCOLVERSION",
    "channel_binding": "PGCHANNELBINDING", "gssencmode": "PGGSSENCMODE",
    "krbsrvname": "PGKRBSRVNAME", "gsslib": "PGGSSLIB",
    "target_session_attrs": "PGTARGETSESSIONATTRS", "requirepeer": "PGREQUIREPEER",
}


def backup_environment(parsed):
    if not all((parsed.host, parsed.username, parsed.database)):
        raise RuntimeError("Explicit PostgreSQL host, user and database are required for a targeted backup")
    if set(parsed.query) - set(LIBPQ_QUERY_ENV) or any(not isinstance(v, str) for v in parsed.query.values()):
        raise RuntimeError("Unsupported database URL query options need review before backup/migration")
    # PGDATABASE is a database name here, not a URI. Explicit libpq environment
    # settings select the same server without putting credentials on the CLI.
    environment = dict(os.environ)
    for key in ("PGSERVICE", "PGSERVICEFILE", "PGHOSTADDR"):
        environment.pop(key, None)
    environment.update({
        "PGHOST": parsed.host, "PGPORT": str(parsed.port or 5432),
        "PGUSER": parsed.username, "PGDATABASE": parsed.database,
        "PGOPTIONS": PG_OPTIONS, "PGCONNECT_TIMEOUT": "5",
    })
    if parsed.password is not None:
        environment["PGPASSWORD"] = parsed.password
    for key, value in parsed.query.items():
        environment[LIBPQ_QUERY_ENV[key]] = value
    return environment


def sql(connection, statement, values=None):
    return connection.execute(sa.text(statement), values or {})


def inspect_state(engine):
    with engine.connect() as connection, connection.begin():
        sql(connection, "SET TRANSACTION READ ONLY")
        sql(connection, "SET LOCAL statement_timeout = '10000ms'")
        sql(connection, "SET LOCAL lock_timeout = '1500ms'")
        result = {
            "read_only": sql(connection, "SELECT current_setting('transaction_read_only')").scalar_one(),
            "revisions": sql(connection, "SELECT version_num FROM system.alembic_version ORDER BY version_num").scalars().all(),
            "tables": {},
        }
        inspector = sa.inspect(connection)
        for table in (*BASE_TABLES, *NEW_COLUMNS):
            if not inspector.has_table(table, schema="app"):
                continue
            result["tables"][table] = {
                "rows": sql(connection, f'SELECT count(*) FROM app."{table}"').scalar_one(),
                "columns": [c["name"] for c in inspector.get_columns(table, schema="app")],
                "checks": [c["name"] for c in inspector.get_check_constraints(table, schema="app")],
                "indexes": {i["name"]: i["column_names"] for i in inspector.get_indexes(table, schema="app")},
                "unique": {i["name"]: i["column_names"] for i in inspector.get_unique_constraints(table, schema="app")},
                "foreign_keys": inspector.get_foreign_keys(table, schema="app"),
            }
        result["invalid_indexes"] = sql(connection, """
            SELECT i.relname FROM pg_index x JOIN pg_class i ON i.oid=x.indexrelid
            JOIN pg_class t ON t.oid=x.indrelid JOIN pg_namespace n ON n.oid=t.relnamespace
            WHERE n.nspname='app' AND t.relname LIKE 'construction_%'
              AND (NOT x.indisvalid OR NOT x.indisready)
        """).scalars().all()
        result["unvalidated_constraints"] = sql(connection, """
            SELECT c.conname FROM pg_constraint c JOIN pg_class t ON t.oid=c.conrelid
            JOIN pg_namespace n ON n.oid=t.relnamespace
            WHERE n.nspname='app' AND t.relname LIKE 'construction_%' AND NOT c.convalidated
        """).scalars().all()
        result["activity"] = dict(sql(connection, """
            WITH activity AS (
              SELECT a.*,
                COALESCE((a.application_name='pg_dump' AND a.backend_xid IS NULL AND a.backend_xmin IS NOT NULL
                 AND a.query ~* '^COPY[[:space:]].*TO[[:space:]]+stdout[[:space:]]*;?[[:space:]]*$'
                 AND NOT EXISTS (SELECT 1 FROM pg_locks l WHERE l.pid=a.pid
                   AND l.locktype='relation' AND l.mode<>'AccessShareLock')), false) AS readonly_dump
              FROM pg_stat_activity a WHERE datname=current_database() AND pid<>pg_backend_pid()
            )
            SELECT count(*) FILTER (WHERE xact_start < now()-interval '5 minutes') AS long_transactions,
              count(*) FILTER (WHERE xact_start < now()-interval '5 minutes' AND NOT readonly_dump) AS blocking_long_transactions,
              count(*) FILTER (WHERE xact_start < now()-interval '5 minutes' AND readonly_dump) AS readonly_pg_dump_snapshots,
              (SELECT count(*) FROM pg_locks WHERE NOT granted AND database=
                (SELECT oid FROM pg_database WHERE datname=current_database())) AS waiting_locks
            FROM activity
        """).mappings().one())
        return result


def check_start(state, scripts):
    if state["read_only"] != "on" or state["revisions"] != [EXPECTED]:
        raise RuntimeError(f"Expected one live app revision {EXPECTED}; no upgrade performed")
    pending = [r.revision for r in scripts.iterate_revisions(TARGET, EXPECTED)]
    if pending != [TARGET]:
        raise RuntimeError("Unexpected pending migration chain; no upgrade performed")
    if set(BASE_TABLES) - set(state["tables"]) or set(NEW_COLUMNS) & set(state["tables"]):
        raise RuntimeError("Construction revision/table mismatch; no upgrade performed")
    if state["invalid_indexes"] or state["unvalidated_constraints"] or state["activity"]["blocking_long_transactions"] or state["activity"]["waiting_locks"]:
        raise RuntimeError("Invalid indexes, unvalidated constraints, long transactions or waiting locks need review")


def check_final(state):
    if state["revisions"] != [TARGET] or state["invalid_indexes"] or state["unvalidated_constraints"]:
        raise RuntimeError("Migration postcheck did not confirm revision/index/constraint validity")
    for table, columns in NEW_COLUMNS.items():
        if set(state["tables"].get(table, {}).get("columns", ())) != columns:
            raise RuntimeError(f"Migration postcheck failed for {table} columns")
    items = state["tables"]["construction_work_items"]
    entries = state["tables"]["construction_work_entries"]
    audit = state["tables"]["construction_work_audit"]
    if "ck_app_construction_work_version" not in items["checks"] or "ck_app_construction_work_quantity" not in entries["checks"]:
        raise RuntimeError("Migration postcheck did not confirm quantity/version constraints")
    if items["indexes"].get("ix_app_construction_work_scope") != ["object_id", "group_ref"]:
        raise RuntimeError("Migration postcheck did not confirm work scope index")
    if audit["indexes"].get("ix_app_construction_work_audit") != ["work_id", "id"]:
        raise RuntimeError("Migration postcheck did not confirm work history index")
    if entries["unique"].get("uq_app_construction_work_day") != ["work_id", "work_date"]:
        raise RuntimeError("Migration postcheck did not confirm daily uniqueness")
    for table in (entries, audit):
        if not any(f["constrained_columns"] == ["work_id"] and f["referred_schema"] == "app"
                   and f["referred_table"] == "construction_work_items" and f["referred_columns"] == ["id"]
                   for f in table["foreign_keys"]):
            raise RuntimeError("Migration postcheck did not confirm work foreign keys")


def run_tool(tool, arguments, environment):
    completed = subprocess.run([str(tool), *arguments], env=environment, stdout=subprocess.PIPE,
                               stderr=subprocess.PIPE, timeout=180, check=False)
    if completed.returncode:
        # libpq diagnostics can contain connection settings; never print them.
        raise RuntimeError(f"{tool.name} failed with exit code {completed.returncode}")
    return completed.stdout


def backup(pg_bin, directory, environment, snapshot):
    directory.mkdir(parents=True, exist_ok=False)
    result = []
    selections = (
        ("schema_before.dump", ["--schema-only", "--schema=app", "--schema=system"]),
        ("construction_before.dump", ["--data-only", "--table=system.alembic_version", "--table=app.construction_*"]),
    )
    for filename, selected in selections:
        path = directory / filename
        run_tool(pg_bin / "pg_dump.exe", ["--no-password", "--format=custom", "--no-owner", "--no-privileges",
                 f"--snapshot={snapshot}", f"--file={path}", *selected], environment)
        if not path.is_file() or not path.stat().st_size:
            raise RuntimeError("Targeted database backup is missing or empty")
        toc = run_tool(pg_bin / "pg_restore.exe", ["--list", str(path)], environment)
        # Read/decompress every selected archive block as SQL, without executing it.
        decoded = run_tool(pg_bin / "pg_restore.exe", ["--file=-", str(path)], environment)
        result.append({"path": str(path), "bytes": path.stat().st_size,
                       "sha256": hashlib.sha256(path.read_bytes()).hexdigest(),
                       "toc_bytes": len(toc), "decoded_bytes": len(decoded)})
    return result


@contextmanager
def migration_environment():
    changes = {"PGOPTIONS": PG_OPTIONS, "SKIP_PG_SCHEMA_DOCS": "1"}
    previous = {key: os.environ.get(key) for key in changes}
    os.environ.update(changes)
    try:
        yield
    finally:
        for key, value in previous.items():
            if value is None:
                os.environ.pop(key, None)
            else:
                os.environ[key] = value


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--execute", action="store_true", help=f"Back up then apply only {TARGET}; requires explicit operational authorization")
    parser.add_argument("--backup-dir", type=Path)
    parser.add_argument("--pg-bin", type=Path, default=Path(r"C:\Program Files\PostgreSQL\16\bin"))
    args = parser.parse_args()
    url = str(dotenv_values(ROOT / ".env").get("APP_DATABASE_URL") or "")
    sys.path.insert(0, str(ROOT / "WEB-itinvent"))
    from backend.config import config as backend_config
    if str(backend_config.app_db.database_url or "").strip() != url:
        raise RuntimeError("config_url_matches=false: process configuration differs from root .env")
    parsed = make_url(url)
    if parsed.get_backend_name() != "postgresql":
        raise RuntimeError("Root .env APP_DATABASE_URL must point to PostgreSQL")
    environment = backup_environment(parsed)
    cfg = Config(str(ROOT / "WEB-itinvent/backend/alembic.ini"))
    cfg.set_main_option("script_location", str(ROOT / "WEB-itinvent/backend/alembic"))
    scripts = ScriptDirectory.from_config(cfg)
    if scripts.get_heads() != [TARGET]:
        raise RuntimeError("Repository migration head changed; review the exact target first")
    engine = sa.create_engine(url, poolclass=sa.pool.NullPool, hide_parameters=True,
                              connect_args={"connect_timeout": 5, "application_name": "construction-0108-preflight"})
    try:
        before = inspect_state(engine)
        if before["revisions"] == [TARGET]:
            check_final(before)
            print(json.dumps({"status": "already_current", "writes_performed": False, "config_url_matches": True, "state": before}, default=str))
            return
        check_start(before, scripts)
        if not args.execute:
            print(json.dumps({"status": "ready", "writes_performed": False, "config_url_matches": True, "target": TARGET, "state": before}, default=str))
            return
        if args.backup_dir is None:
            raise RuntimeError("--backup-dir is required for execution")
        directory = args.backup_dir.resolve()
        backup_root = (ROOT / "deploy_backups").resolve()
        if directory.parent != backup_root or not directory.name.startswith("construction-20260908-") or directory.exists():
            raise RuntimeError("Use a new direct deploy_backups/construction-20260908-* directory")
        for name in ("pg_dump.exe", "pg_restore.exe"):
            if not (args.pg_bin / name).is_file():
                raise RuntimeError(f"PostgreSQL client tool is missing: {name}")
        with engine.connect() as guard:
            locked = sql(guard, "SELECT pg_try_advisory_lock(hashtext(:key))", {"key": LOCK_KEY}).scalar_one()
            guard.commit()
            if not locked:
                raise RuntimeError("Another construction migration runner owns the advisory lock")
            try:
                check_start(inspect_state(engine), scripts)
                with guard.begin():
                    sql(guard, "SET TRANSACTION ISOLATION LEVEL REPEATABLE READ READ ONLY")
                    snapshot = sql(guard, "SELECT pg_export_snapshot()").scalar_one()
                    archives = backup(args.pg_bin, directory, environment, snapshot)
                manifest = {"created_at": datetime.now(timezone.utc).isoformat(), "from": EXPECTED, "to": TARGET,
                            "backups": archives, "before": before, "automatic_downgrade": False}
                (directory / "manifest.json").write_text(json.dumps(manifest, indent=2, default=str), encoding="utf-8")
                print(json.dumps({"status": "backup_verified", "backups": archives}), flush=True)
                check_start(inspect_state(engine), scripts)
                sys.path.insert(0, str(ROOT / "WEB-itinvent"))
                with migration_environment():
                    from backend.db_migrations import upgrade_internal_database
                    upgrade_internal_database(url, TARGET, scope="app")
                after = inspect_state(engine)
                check_final(after)
                manifest["after"] = after
                manifest["status"] = "applied"
                (directory / "manifest.json").write_text(json.dumps(manifest, indent=2, default=str), encoding="utf-8")
                print(json.dumps({"status": "applied", "target": TARGET, "backup_directory": str(directory), "state": after}, default=str))
            finally:
                if guard.in_transaction():
                    guard.rollback()
                sql(guard, "SELECT pg_advisory_unlock(hashtext(:key))", {"key": LOCK_KEY})
                guard.commit()
    finally:
        engine.dispose()


if __name__ == "__main__":
    try:
        main()
    except Exception as exc:
        # Keep SQL/driver parameters and credentials out of console output.
        print(json.dumps({"status": "failed", "error_type": type(exc).__name__,
                          "detail": str(exc) if type(exc) is RuntimeError else "Check the operation and preflight; no automatic rollback was attempted"}), file=sys.stderr)
        raise SystemExit(1)
