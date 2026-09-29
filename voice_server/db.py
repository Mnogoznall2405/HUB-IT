"""PostgreSQL engine helpers for voice_server (schema ``voice``)."""

from __future__ import annotations

import logging
from typing import Optional

from sqlalchemy import create_engine, text
from sqlalchemy.engine import Engine

logger = logging.getLogger("voice-server")

VOICE_SCHEMA = "voice"
_engines: dict[str, Engine] = {}


def normalize_database_url(database_url: str) -> str:
    url = str(database_url or "").strip()
    if url.startswith("postgresql://"):
        return "postgresql+psycopg://" + url[len("postgresql://"):]
    if url.startswith("postgres://"):
        return "postgresql+psycopg://" + url[len("postgres://"):]
    return url


def get_voice_engine(
    database_url: str,
    *,
    application_name: str = "itinvent-voice",
    create_schema: bool = True,
) -> Engine:
    resolved = normalize_database_url(database_url)
    if not resolved:
        raise ValueError("VOICE_DATABASE_URL is empty")
    cached = _engines.get(resolved)
    if cached is not None:
        return cached

    connect_args = {"application_name": str(application_name or "itinvent-voice")}
    if resolved.startswith("postgresql"):
        connect_args["options"] = f"-csearch_path={VOICE_SCHEMA},public"
    engine = create_engine(
        resolved,
        pool_pre_ping=True,
        pool_size=5,
        max_overflow=10,
        future=True,
        connect_args=connect_args,
    )
    with engine.connect() as conn:
        if create_schema and resolved.startswith("postgresql"):
            conn.execute(text(f"CREATE SCHEMA IF NOT EXISTS {VOICE_SCHEMA}"))
            conn.commit()
        # Bootstrap the job registry if migrations were not applied yet.
        # Alembic remains the source of truth for schema evolution.
        from .models import Base

        Base.metadata.create_all(bind=conn)
        conn.commit()
    _engines[resolved] = engine
    logger.info("Voice PostgreSQL engine ready (schema=%s)", VOICE_SCHEMA)
    return engine


def dispose_voice_engines() -> None:
    for engine in list(_engines.values()):
        try:
            engine.dispose()
        except Exception:
            pass
    _engines.clear()
