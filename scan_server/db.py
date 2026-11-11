"""PostgreSQL engine helpers for scan_server (schema ``scan``)."""

from __future__ import annotations

import logging
import os
from pathlib import Path
from typing import Any, Dict, Optional

from sqlalchemy import create_engine, text
from sqlalchemy.engine import Engine

logger = logging.getLogger("scan-server")

SCAN_SCHEMA = "scan"
_engines: dict[str, Engine] = {}
_ALEMBIC_DIR = Path(__file__).resolve().parent / "alembic"


def dev_auto_create_enabled() -> bool:
    """Runtime DDL is a dev/test fallback only: production applies ``scan_server/alembic`` explicitly."""
    return str(os.getenv("SCAN_SCHEMA_DEV_AUTO_CREATE", "0") or "").strip().lower() in {"1", "true", "yes", "on"}


def normalize_database_url(database_url: str) -> str:
    url = str(database_url or "").strip()
    if url.startswith("postgresql://"):
        return "postgresql+psycopg://" + url[len("postgresql://") :]
    if url.startswith("postgres://"):
        return "postgresql+psycopg://" + url[len("postgres://") :]
    return url


def get_scan_engine(database_url: str, *, application_name: str = "itinvent-scan") -> Engine:
    resolved = normalize_database_url(database_url)
    if not resolved:
        raise ValueError("SCAN_DATABASE_URL is empty")
    cached = _engines.get(resolved)
    if cached is not None:
        return cached

    connect_args = {
        "application_name": str(application_name or "itinvent-scan"),
        "options": f"-csearch_path={SCAN_SCHEMA},public",
    }
    engine = create_engine(
        resolved,
        pool_pre_ping=True,
        pool_size=5,
        max_overflow=10,
        future=True,
        connect_args=connect_args,
    )
    if dev_auto_create_enabled():
        with engine.connect() as conn:
            conn.execute(text(f"CREATE SCHEMA IF NOT EXISTS {SCAN_SCHEMA}"))
            conn.commit()
    _engines[resolved] = engine
    logger.info("Scan PostgreSQL engine ready (schema=%s)", SCAN_SCHEMA)
    return engine


def dispose_scan_engines() -> None:
    for engine in list(_engines.values()):
        try:
            engine.dispose()
        except Exception:
            pass
    _engines.clear()


def ensure_scan_schema(engine: Optional[Engine] = None, *, database_url: str = "") -> None:
    from .models import Base

    target = engine or get_scan_engine(database_url)
    with target.connect() as conn:
        conn.execute(text(f"CREATE SCHEMA IF NOT EXISTS {SCAN_SCHEMA}"))
        conn.commit()
    Base.metadata.create_all(bind=target)
    # Expression index for hostname equality/prefix search (LOWER(hostname)).
    # create_all does not reliably add functional indexes on existing tables.
    with target.connect() as conn:
        conn.execute(
            text(
                f"CREATE INDEX IF NOT EXISTS idx_scan_incidents_hostname_lower_created "
                f"ON {SCAN_SCHEMA}.scan_incidents (LOWER(hostname), created_at DESC)"
            )
        )
        conn.commit()


def check_scan_schema_version(engine: Engine) -> Dict[str, Any]:
    """Read-only comparison of ``scan.alembic_version`` with the head known to the code. Never raises.

    Returns {"status": "current" | "behind" | "unknown_revision" | "unreadable", "current", "expected"}.
    """
    expected = ""
    current: Optional[str] = None
    status = "unreadable"
    try:
        from alembic.script import ScriptDirectory
        from alembic.util.exc import CommandError

        script = ScriptDirectory(str(_ALEMBIC_DIR))
        heads = sorted(script.get_heads())
        expected = ",".join(heads)
        with engine.connect() as conn:
            row = conn.execute(text(f"SELECT version_num FROM {SCAN_SCHEMA}.alembic_version LIMIT 1")).first()
        current = (str(row[0] or "").strip() or None) if row else None
        if current is None:
            status = "unreadable"
        elif current in heads:
            status = "current"
        else:
            try:
                known = script.get_revision(current) is not None
            except CommandError:
                known = False
            status = "behind" if known else "unknown_revision"
    except Exception as exc:
        logger.warning(
            "schema_migration_check stage=schema_migration_check scope=scan status=unreadable error=%s",
            type(exc).__name__,
        )
        return {"status": "unreadable", "current": current, "expected": expected}
    if status != "current":
        logger.warning(
            "schema_migration_check stage=schema_migration_check scope=scan status=%s current=%s expected=%s "
            "action=apply_scan_migrations_manually_at_release",
            status,
            current,
            expected,
        )
    return {"status": status, "current": current, "expected": expected}


def prepare_scan_schema(engine: Engine) -> Optional[Dict[str, Any]]:
    """Startup hook: create objects only with SCAN_SCHEMA_DEV_AUTO_CREATE=1, otherwise just verify the version."""
    if dev_auto_create_enabled():
        ensure_scan_schema(engine)
        return None
    return check_scan_schema_version(engine)
