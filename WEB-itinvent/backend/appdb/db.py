"""Runtime helpers for unified internal application database."""
from __future__ import annotations

import logging
import threading
import time
from collections.abc import Callable
from contextlib import contextmanager
from typing import TypeVar

from sqlalchemy import create_engine, text
from sqlalchemy.exc import OperationalError
from sqlalchemy.orm import Session, sessionmaker

from backend.appdb.models import APP_SCHEMA, AppBase, SYSTEM_SCHEMA
from backend.config import config


class AppDatabaseConfigurationError(RuntimeError):
    """Raised when unified internal database is unavailable or misconfigured."""


_engines: dict[str, object] = {}
_session_factories: dict[str, object] = {}
_initialized_schema_urls: set[str] = set()
_schema_init_lock = threading.Lock()
logger = logging.getLogger("backend.appdb.db")
_TRANSIENT_LOCK_SQLSTATES = {"55P03"}
_APP_SCHEMA_INIT_LOCK_KEY = 48151623
_T = TypeVar("_T")


def is_app_database_configured() -> bool:
    return bool(str(config.app_db.database_url or "").strip())


def get_app_database_url(database_url: str | None = None) -> str:
    return str(database_url or config.app_db.database_url or "").strip()


def ensure_app_database_configured(database_url: str | None = None) -> str:
    database_url = get_app_database_url(database_url)
    if not database_url:
        raise AppDatabaseConfigurationError("APP_DATABASE_URL is not configured")
    return database_url


def _build_engine(database_url: str):
    engine_kwargs = {
        "pool_pre_ping": True,
        "future": True,
        "echo": bool(config.app_db.echo),
    }
    if database_url.startswith("sqlite"):
        engine_kwargs["connect_args"] = {"check_same_thread": False}
        return create_engine(database_url, **engine_kwargs).execution_options(
            schema_translate_map={
                APP_SCHEMA: None,
                SYSTEM_SCHEMA: None,
                "chat": None,
            }
        )

    engine_kwargs["pool_size"] = max(1, int(config.app_db.pool_size))
    engine_kwargs["max_overflow"] = max(0, int(config.app_db.max_overflow))
    return create_engine(database_url, **engine_kwargs)


def get_app_engine(database_url: str | None = None):
    resolved_url = ensure_app_database_configured(database_url)
    engine = _engines.get(resolved_url)
    if engine is None:
        engine = _build_engine(resolved_url)
        _engines[resolved_url] = engine
    return engine


def get_app_session_factory(database_url: str | None = None):
    resolved_url = ensure_app_database_configured(database_url)
    session_factory = _session_factories.get(resolved_url)
    if session_factory is None:
        session_factory = sessionmaker(
            bind=get_app_engine(resolved_url),
            autoflush=False,
            autocommit=False,
            expire_on_commit=False,
        )
        _session_factories[resolved_url] = session_factory
    return session_factory


@contextmanager
def app_session(database_url: str | None = None) -> Session:
    session = get_app_session_factory(database_url)()
    try:
        yield session
        session.commit()
    except Exception:
        session.rollback()
        raise
    finally:
        session.close()


def _run_postgres_app_schema_maintenance(connection) -> None:
    statements = [
        'ALTER TABLE IF EXISTS "app"."users" ALTER COLUMN "telegram_id" TYPE BIGINT',
        'ALTER TABLE IF EXISTS "app"."user_db_selection" ALTER COLUMN "telegram_id" TYPE BIGINT',
        'ALTER TABLE IF EXISTS "app"."users" ADD COLUMN IF NOT EXISTS "department" VARCHAR(255)',
        'ALTER TABLE IF EXISTS "app"."users" ADD COLUMN IF NOT EXISTS "job_title" VARCHAR(255)',
        'ALTER TABLE IF EXISTS "app"."users" ADD COLUMN IF NOT EXISTS "totp_secret_enc" TEXT NOT NULL DEFAULT \'\'',
        'ALTER TABLE IF EXISTS "app"."users" ADD COLUMN IF NOT EXISTS "is_2fa_enabled" BOOLEAN NOT NULL DEFAULT FALSE',
        'ALTER TABLE IF EXISTS "app"."users" ADD COLUMN IF NOT EXISTS "twofa_enabled_at" TIMESTAMPTZ NULL',
        'ALTER TABLE IF EXISTS "app"."trusted_devices" ADD COLUMN IF NOT EXISTS "is_discoverable" BOOLEAN NOT NULL DEFAULT FALSE',
        'ALTER TABLE IF EXISTS "app"."trusted_devices" ADD COLUMN IF NOT EXISTS "expires_at" TIMESTAMPTZ NULL',
        'CREATE INDEX IF NOT EXISTS "ix_app_trusted_devices_expires_at" ON "app"."trusted_devices" ("expires_at")',
        'CREATE INDEX IF NOT EXISTS "ix_system_auth_runtime_items_namespace" ON "system"."auth_runtime_items" ("namespace")',
        'CREATE INDEX IF NOT EXISTS "ix_system_auth_runtime_items_expires_at" ON "system"."auth_runtime_items" ("expires_at")',
        'ALTER TABLE IF EXISTS "app"."ai_bots" ADD COLUMN IF NOT EXISTS "allow_kb_document_delivery" BOOLEAN NOT NULL DEFAULT FALSE',
        'ALTER TABLE IF EXISTS "app"."ai_bots" ADD COLUMN IF NOT EXISTS "enabled_tools_json" TEXT NOT NULL DEFAULT \'[]\'',
        'ALTER TABLE IF EXISTS "app"."ai_bots" ADD COLUMN IF NOT EXISTS "tool_settings_json" TEXT NOT NULL DEFAULT \'{}\'',
        'ALTER TABLE IF EXISTS "app"."ai_bot_runs" ADD COLUMN IF NOT EXISTS "stage" VARCHAR(64)',
        'ALTER TABLE IF EXISTS "app"."ai_bot_runs" ADD COLUMN IF NOT EXISTS "status_text" TEXT',
        'UPDATE "app"."ai_bot_runs" SET "stage" = "status" WHERE "stage" IS NULL',
        'UPDATE "app"."ai_bot_runs" SET "status_text" = \'\' WHERE "status_text" IS NULL',
        'CREATE INDEX IF NOT EXISTS "ix_app_ai_pending_actions_message_id" ON "app"."ai_pending_actions" ("message_id")',
        'CREATE INDEX IF NOT EXISTS "ix_app_ai_pending_actions_run_status" ON "app"."ai_pending_actions" ("run_id", "status")',
        'CREATE INDEX IF NOT EXISTS "ix_app_ai_pending_actions_status_expires_at" ON "app"."ai_pending_actions" ("status", "expires_at")',
    ]
    for statement in statements:
        try:
            connection.execute(text(statement))
        except Exception as exc:
            logger.warning("Skipped app schema maintenance statement: %s", exc)


def _initialize_app_schema_uncached(database_url: str | None = None) -> None:
    engine = get_app_engine(database_url)
    if engine.dialect.name == "postgresql":
        with engine.begin() as connection:
            connection.execute(
                text("SELECT pg_advisory_xact_lock(:lock_key)"),
                {"lock_key": _APP_SCHEMA_INIT_LOCK_KEY},
            )
            connection.execute(text("SET LOCAL lock_timeout = '500ms'"))
            connection.execute(text("SET LOCAL statement_timeout = '3000ms'"))
            connection.execute(text('CREATE SCHEMA IF NOT EXISTS "app"'))
            connection.execute(text('CREATE SCHEMA IF NOT EXISTS "system"'))
            AppBase.metadata.create_all(bind=connection)
            _run_postgres_app_schema_maintenance(connection)
        return

    AppBase.metadata.create_all(bind=engine)

    if engine.dialect.name == "sqlite":
        with engine.begin() as connection:
            trusted_device_columns = {
                str(row[1] or "").strip().lower()
                for row in connection.execute(text("PRAGMA table_info('trusted_devices')"))
            }
            if trusted_device_columns and "is_discoverable" not in trusted_device_columns:
                connection.execute(text('ALTER TABLE trusted_devices ADD COLUMN is_discoverable BOOLEAN NOT NULL DEFAULT 0'))
            if trusted_device_columns and "expires_at" not in trusted_device_columns:
                connection.execute(text("ALTER TABLE trusted_devices ADD COLUMN expires_at DATETIME NULL"))
            if trusted_device_columns:
                connection.execute(text("CREATE INDEX IF NOT EXISTS ix_app_trusted_devices_expires_at ON trusted_devices(expires_at)"))
            auth_runtime_columns = {
                str(row[1] or "").strip().lower()
                for row in connection.execute(text("PRAGMA table_info('auth_runtime_items')"))
            }
            if auth_runtime_columns:
                connection.execute(text("CREATE INDEX IF NOT EXISTS ix_system_auth_runtime_items_namespace ON auth_runtime_items(namespace)"))
                connection.execute(text("CREATE INDEX IF NOT EXISTS ix_system_auth_runtime_items_expires_at ON auth_runtime_items(expires_at)"))
            ai_bot_columns = {
                str(row[1] or "").strip().lower()
                for row in connection.execute(text("PRAGMA table_info('ai_bots')"))
            }
            if ai_bot_columns and "allow_kb_document_delivery" not in ai_bot_columns:
                connection.execute(text("ALTER TABLE ai_bots ADD COLUMN allow_kb_document_delivery BOOLEAN NOT NULL DEFAULT 0"))
            if ai_bot_columns and "enabled_tools_json" not in ai_bot_columns:
                connection.execute(text("ALTER TABLE ai_bots ADD COLUMN enabled_tools_json TEXT NOT NULL DEFAULT '[]'"))
            if ai_bot_columns and "tool_settings_json" not in ai_bot_columns:
                connection.execute(text("ALTER TABLE ai_bots ADD COLUMN tool_settings_json TEXT NOT NULL DEFAULT '{}'"))
            ai_bot_run_columns = {
                str(row[1] or "").strip().lower()
                for row in connection.execute(text("PRAGMA table_info('ai_bot_runs')"))
            }
            if ai_bot_run_columns:
                if "stage" not in ai_bot_run_columns:
                    connection.execute(text("ALTER TABLE ai_bot_runs ADD COLUMN stage VARCHAR(64)"))
                if "status_text" not in ai_bot_run_columns:
                    connection.execute(text("ALTER TABLE ai_bot_runs ADD COLUMN status_text TEXT"))
                connection.execute(text("UPDATE ai_bot_runs SET stage = status WHERE stage IS NULL"))
                connection.execute(text("UPDATE ai_bot_runs SET status_text = '' WHERE status_text IS NULL"))
            pending_action_columns = {
                str(row[1] or "").strip().lower()
                for row in connection.execute(text("PRAGMA table_info('ai_pending_actions')"))
            }
            if pending_action_columns:
                connection.execute(text("CREATE INDEX IF NOT EXISTS ix_app_ai_pending_actions_message_id ON ai_pending_actions(message_id)"))
                connection.execute(text("CREATE INDEX IF NOT EXISTS ix_app_ai_pending_actions_run_status ON ai_pending_actions(run_id, status)"))
                connection.execute(text("CREATE INDEX IF NOT EXISTS ix_app_ai_pending_actions_status_expires_at ON ai_pending_actions(status, expires_at)"))


def initialize_app_schema(database_url: str | None = None, *, force: bool = False) -> None:
    resolved_url = ensure_app_database_configured(database_url)
    if not force and resolved_url in _initialized_schema_urls:
        return
    with _schema_init_lock:
        if not force and resolved_url in _initialized_schema_urls:
            return
        _initialize_app_schema_uncached(resolved_url)
        _initialized_schema_urls.add(resolved_url)


def ensure_app_schema_initialized(database_url: str | None = None) -> str:
    resolved_url = ensure_app_database_configured(database_url)
    initialize_app_schema(resolved_url)
    return resolved_url


def ping_app_database(database_url: str | None = None) -> None:
    with get_app_engine(database_url).connect() as connection:
        connection.execute(text("SELECT 1"))


def apply_postgres_local_timeouts(
    session_or_connection,
    *,
    lock_timeout_ms: int,
    statement_timeout_ms: int,
) -> None:
    bind = getattr(session_or_connection, "bind", None)
    if bind is None and hasattr(session_or_connection, "get_bind"):
        try:
            bind = session_or_connection.get_bind()
        except Exception:
            bind = None
    dialect_name = str(getattr(getattr(bind, "dialect", None), "name", "") or "").strip().lower()
    if dialect_name != "postgresql":
        return
    session_or_connection.execute(text(f"SET LOCAL lock_timeout = '{max(1, int(lock_timeout_ms))}ms'"))
    session_or_connection.execute(text(f"SET LOCAL statement_timeout = '{max(1, int(statement_timeout_ms))}ms'"))


def is_transient_lock_error(exc: BaseException) -> bool:
    if not isinstance(exc, OperationalError):
        return False
    candidate = getattr(exc, "orig", exc)
    sqlstate = str(
        getattr(candidate, "sqlstate", None)
        or getattr(candidate, "pgcode", None)
        or ""
    ).strip()
    if sqlstate in _TRANSIENT_LOCK_SQLSTATES:
        return True
    return candidate.__class__.__name__ == "LockNotAvailable"


def run_with_transient_lock_retry(
    operation: Callable[[], _T],
    *,
    attempts: int = 4,
    initial_delay_sec: float = 0.25,
    max_delay_sec: float = 1.0,
) -> _T:
    normalized_attempts = max(1, int(attempts or 1))
    for attempt in range(normalized_attempts):
        try:
            return operation()
        except Exception as exc:
            if not is_transient_lock_error(exc) or attempt >= (normalized_attempts - 1):
                raise
            delay_sec = min(
                max(0.0, float(max_delay_sec or 0.0)),
                max(0.0, float(initial_delay_sec or 0.0)) * (2 ** attempt),
            )
            if delay_sec > 0:
                time.sleep(delay_sec)
