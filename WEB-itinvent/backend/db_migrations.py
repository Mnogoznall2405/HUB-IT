"""Alembic helpers for unified internal PostgreSQL migrations."""
from __future__ import annotations

import logging
from pathlib import Path

from alembic import command
from alembic.config import Config as AlembicConfig
from alembic.util.exc import CommandError
from alembic.script import ScriptDirectory
from sqlalchemy import text

from backend.db_schema import uses_named_schemas

logger = logging.getLogger(__name__)


def _backend_root() -> Path:
    return Path(__file__).resolve().parent


def _alembic_ini_path() -> Path:
    return _backend_root() / "alembic.ini"


def _alembic_script_location() -> Path:
    return _backend_root() / "alembic"


def build_alembic_config(database_url: str, *, scope: str | None = None) -> AlembicConfig:
    config = AlembicConfig(str(_alembic_ini_path()))
    config.set_main_option("script_location", str(_alembic_script_location()))
    config.set_main_option("sqlalchemy.url", str(database_url).strip().replace("%", "%%"))
    config.attributes["configure_logger"] = False
    if scope:
        config.attributes["itinvent_scope"] = str(scope).strip().lower()
    return config


def upgrade_internal_database(database_url: str, revision: str = "head", *, scope: str | None = None) -> None:
    command.upgrade(build_alembic_config(database_url, scope=scope), revision)


def _read_database_revision(engine, database_url: str) -> str | None:
    table = '"system"."alembic_version"' if uses_named_schemas(database_url) else '"alembic_version"'
    with engine.connect() as connection:
        row = connection.execute(text(f"SELECT version_num FROM {table} LIMIT 1")).first()
    value = str(row[0] or "").strip() if row else ""
    return value or None


def check_internal_database_revision(engine, database_url: str, *, scope: str) -> dict:
    """Read-only comparison of the database revision with the head known to the code.

    Production processes must not apply migrations on startup (the working tree is the
    production directory, so a new file in alembic/versions would be applied by whichever
    process starts first). Migrations are applied only by an explicit command at release:
    `alembic -x url=<url> upgrade head`. Here we only report a mismatch.

    Returns {"status": "current" | "behind" | "unknown_revision" | "unreadable",
    "current": <db revision>, "expected": <head(s) of the code>}. Never raises.
    """
    expected = ""
    current: str | None = None
    status = "unreadable"
    try:
        script = ScriptDirectory.from_config(build_alembic_config(database_url, scope=scope))
        heads = sorted(script.get_heads())
        expected = ",".join(heads)
        current = _read_database_revision(engine, database_url)
        if current is None:
            status = "unreadable"
        elif current in heads:
            status = "current"
        else:
            try:
                known = script.get_revision(current) is not None
            except CommandError:  # the database is newer than the code
                known = False
            status = "behind" if known else "unknown_revision"
    except Exception as exc:  # pragma: no cover - defensive: a check must never stop startup
        logger.warning(
            "schema_migration_check stage=schema_migration_check scope=%s status=unreadable error=%s",
            scope,
            type(exc).__name__,
        )
        return {"status": "unreadable", "current": current, "expected": expected}
    if status != "current":
        logger.warning(
            "schema_migration_check stage=schema_migration_check scope=%s status=%s current=%s expected=%s "
            "action=apply_migrations_manually_at_release",
            scope,
            status,
            current,
            expected,
            extra={
                "stage": "schema_migration_check",
                "scope": scope,
                "status": status,
                "current_revision": current,
                "expected_revision": expected,
            },
        )
    return {"status": status, "current": current, "expected": expected}


def stamp_internal_database(database_url: str, revision, *, scope: str | None = None) -> None:
    command.stamp(build_alembic_config(database_url, scope=scope), revision)
