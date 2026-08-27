"""Read-only preflight for the HUB-IT mobile production migrations."""

from __future__ import annotations

import argparse
import json
import os
import sys
from dataclasses import asdict, dataclass
from datetime import UTC, datetime
from pathlib import Path
from typing import Any

import sqlalchemy as sa
from alembic.config import Config
from alembic.script import ScriptDirectory


REPO_ROOT = Path(__file__).resolve().parents[2]
ALEMBIC_INI = REPO_ROOT / "WEB-itinvent" / "backend" / "alembic.ini"
ALEMBIC_ROOT = REPO_ROOT / "WEB-itinvent" / "backend" / "alembic"
BASE_REVISION = "20260818_0100"
PUSH_REVISION = "20260822_0101"
BIOMETRIC_REVISION = "20260823_0102"


@dataclass(frozen=True)
class MigrationAssessment:
    status: str
    safe_to_upgrade: bool
    push_revision_applied: bool
    biometric_revision_applied: bool
    reasons: tuple[str, ...]


def assess_migration_state(
    *,
    repository_head: str,
    current_revisions: tuple[str, ...],
    applied_revisions: frozenset[str],
    push_table_exists: bool,
    biometric_table_exists: bool,
    long_transactions: int = 0,
    waiting_locks: int = 0,
) -> MigrationAssessment:
    reasons: list[str] = []
    push_applied = PUSH_REVISION in applied_revisions
    biometric_applied = BIOMETRIC_REVISION in applied_revisions

    if repository_head != BIOMETRIC_REVISION:
        reasons.append("repository_head_changed")
    if len(current_revisions) != 1:
        reasons.append("database_revision_count_invalid")
    if push_applied != push_table_exists:
        reasons.append("push_outbox_revision_table_mismatch")
    if biometric_applied != biometric_table_exists:
        reasons.append("biometric_revision_table_mismatch")
    if biometric_applied and not push_applied:
        reasons.append("mobile_revision_chain_invalid")
    if long_transactions > 0:
        reasons.append("long_transactions_present")
    if waiting_locks > 0:
        reasons.append("waiting_locks_present")

    current = current_revisions[0] if len(current_revisions) == 1 else ""
    if reasons:
        status = "needs_review"
    elif current == repository_head and push_table_exists and biometric_table_exists:
        status = "already_current"
    elif current in {BASE_REVISION, PUSH_REVISION}:
        status = "ready"
    else:
        status = "needs_review"
        reasons.append("unexpected_start_revision")

    return MigrationAssessment(
        status=status,
        safe_to_upgrade=status == "ready",
        push_revision_applied=push_applied,
        biometric_revision_applied=biometric_applied,
        reasons=tuple(reasons),
    )


def load_migration_graph() -> tuple[ScriptDirectory, str]:
    config = Config(str(ALEMBIC_INI))
    config.set_main_option("script_location", str(ALEMBIC_ROOT))
    scripts = ScriptDirectory.from_config(config)
    heads = tuple(scripts.get_heads())
    if len(heads) != 1:
        raise RuntimeError("The repository must have exactly one Alembic head.")
    for revision in (BASE_REVISION, PUSH_REVISION, BIOMETRIC_REVISION):
        if scripts.get_revision(revision) is None:
            raise RuntimeError(f"Required migration is missing: {revision}")
    return scripts, heads[0]


def collect_ancestry(scripts: ScriptDirectory, revisions: tuple[str, ...]) -> frozenset[str]:
    applied: set[str] = set()
    for revision in revisions:
        if scripts.get_revision(revision) is None:
            raise RuntimeError("The database revision is unknown to this source tree.")
        applied.update(item.revision for item in scripts.iterate_revisions(revision, "base"))
    return frozenset(applied)


def _scalar_bool(connection: sa.Connection, sql: str) -> bool:
    return bool(connection.execute(sa.text(sql)).scalar_one())


def inspect_database(database_url: str, scripts: ScriptDirectory, repository_head: str) -> dict[str, Any]:
    if not database_url.lower().startswith(("postgresql://", "postgresql+")):
        raise RuntimeError("APP_DATABASE_URL must point to PostgreSQL for production preflight.")

    engine = sa.create_engine(database_url, poolclass=sa.pool.NullPool, future=True)
    try:
        with engine.connect() as connection, connection.begin():
            connection.exec_driver_sql("SET TRANSACTION READ ONLY")
            read_only = connection.execute(sa.text("SELECT current_setting('transaction_read_only')" )).scalar_one()
            if str(read_only).lower() != "on":
                raise RuntimeError("PostgreSQL did not confirm a read-only transaction.")

            version_locations = connection.execute(
                sa.text(
                    "SELECT to_regclass('system.alembic_version')::text AS system_table, "
                    "to_regclass('public.alembic_version')::text AS public_table"
                )
            ).mappings().one()
            available = [
                name
                for name, value in (
                    ("system.alembic_version", version_locations["system_table"]),
                    ("public.alembic_version", version_locations["public_table"]),
                )
                if value
            ]
            if len(available) != 1:
                raise RuntimeError("Exactly one Alembic version table must exist.")
            version_table = available[0]
            current_revisions = tuple(
                str(row[0])
                for row in connection.exec_driver_sql(
                    f"SELECT version_num FROM {version_table} ORDER BY version_num"
                )
            )
            applied = collect_ancestry(scripts, current_revisions)
            push_exists = _scalar_bool(
                connection,
                "SELECT to_regclass('app.push_outbox') IS NOT NULL",
            )
            biometric_exists = _scalar_bool(
                connection,
                "SELECT to_regclass('app.mobile_biometric_credentials') IS NOT NULL",
            )
            activity = connection.execute(
                sa.text(
                    "SELECT "
                    "count(*) FILTER (WHERE xact_start < now() - interval '5 minutes') AS long_transactions, "
                    "(SELECT count(*) FROM pg_locks "
                    " WHERE database = (SELECT oid FROM pg_database WHERE datname = current_database()) "
                    " AND NOT granted) AS waiting_locks "
                    "FROM pg_stat_activity "
                    "WHERE datname = current_database() AND pid <> pg_backend_pid()"
                )
            ).mappings().one()
            database_size = int(
                connection.execute(sa.text("SELECT pg_database_size(current_database())")).scalar_one()
            )

            assessment = assess_migration_state(
                repository_head=repository_head,
                current_revisions=current_revisions,
                applied_revisions=applied,
                push_table_exists=push_exists,
                biometric_table_exists=biometric_exists,
                long_transactions=int(activity["long_transactions"] or 0),
                waiting_locks=int(activity["waiting_locks"] or 0),
            )
            return {
                "schema_version": 1,
                "checked_at": datetime.now(UTC).isoformat(),
                "mode": "database_read_only",
                "repository_head": repository_head,
                "current_revisions": current_revisions,
                "version_table": version_table,
                "tables": {
                    "app.push_outbox": push_exists,
                    "app.mobile_biometric_credentials": biometric_exists,
                },
                "activity": {
                    "long_transactions_over_5m": int(activity["long_transactions"] or 0),
                    "waiting_locks": int(activity["waiting_locks"] or 0),
                },
                "database_size_bytes": database_size,
                "assessment": asdict(assessment),
                "privacy": "No URL, host, database/user name, SQL text, rows or credentials are reported.",
            }
    finally:
        engine.dispose()


def offline_report(scripts: ScriptDirectory, repository_head: str) -> dict[str, Any]:
    target_chain = collect_ancestry(scripts, (repository_head,))
    ready = {
        BASE_REVISION,
        PUSH_REVISION,
        BIOMETRIC_REVISION,
    }.issubset(target_chain) and repository_head == BIOMETRIC_REVISION
    return {
        "schema_version": 1,
        "checked_at": datetime.now(UTC).isoformat(),
        "mode": "offline_graph",
        "repository_head": repository_head,
        "required_chain": [BASE_REVISION, PUSH_REVISION, BIOMETRIC_REVISION],
        "ready": ready,
        "production_connected": False,
    }


def parse_args(argv: list[str]) -> argparse.Namespace:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument(
        "--offline",
        action="store_true",
        help="Validate only the local Alembic graph; do not read APP_DATABASE_URL.",
    )
    return parser.parse_args(argv)


def main(argv: list[str] | None = None) -> int:
    args = parse_args(sys.argv[1:] if argv is None else argv)
    try:
        scripts, repository_head = load_migration_graph()
        if args.offline:
            report = offline_report(scripts, repository_head)
            exit_code = 0 if report["ready"] else 2
        else:
            database_url = str(os.environ.get("APP_DATABASE_URL") or "").strip()
            if not database_url:
                raise RuntimeError("APP_DATABASE_URL is required unless --offline is used.")
            report = inspect_database(database_url, scripts, repository_head)
            exit_code = 0 if report["assessment"]["status"] in {"ready", "already_current"} else 2
        print(json.dumps(report, ensure_ascii=False, indent=2))
        return exit_code
    except Exception:
        print(
            "Migration preflight failed without exposing connection details. "
            "Check the local graph, APP_DATABASE_URL and database permissions.",
            file=sys.stderr,
        )
        return 2


if __name__ == "__main__":
    raise SystemExit(main())
