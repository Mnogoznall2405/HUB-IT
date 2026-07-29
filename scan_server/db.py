"""PostgreSQL engine helpers for scan_server (schema ``scan``)."""

from __future__ import annotations

import logging
from typing import Optional

from sqlalchemy import create_engine, text
from sqlalchemy.engine import Engine

logger = logging.getLogger("scan-server")

SCAN_SCHEMA = "scan"
_engines: dict[str, Engine] = {}


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
