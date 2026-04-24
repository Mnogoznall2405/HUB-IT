from __future__ import annotations

import sys
from logging.config import fileConfig
from pathlib import Path

from alembic import context
import sqlalchemy as sa
from sqlalchemy import engine_from_config, pool


PROJECT_ROOT = Path(__file__).resolve().parents[2]
if str(PROJECT_ROOT) not in sys.path:
    sys.path.insert(0, str(PROJECT_ROOT))

from backend.appdb.models import AppBase
from backend.chat.models import Base as ChatBase
from backend.config import config as app_config
from backend.db_schema import uses_named_schemas


config = context.config

if config.config_file_name is not None and config.attributes.get("configure_logger", True):
    fileConfig(config.config_file_name)


def _migration_scope() -> str:
    scope = str(config.attributes.get("itinvent_scope", "") or "").strip().lower()
    if scope in {"app", "chat"}:
        return scope
    return "all"


def _target_metadata():
    scope = _migration_scope()
    if scope == "app":
        return [AppBase.metadata]
    if scope == "chat":
        return [ChatBase.metadata]
    return [AppBase.metadata, ChatBase.metadata]


def _database_url() -> str:
    explicit = str(config.get_main_option("sqlalchemy.url") or "").strip()
    if explicit:
        return explicit
    return str(app_config.app_db.database_url or app_config.chat.database_url or "").strip()


def _configure_kwargs() -> dict:
    database_url = _database_url()
    use_named_schemas = uses_named_schemas(database_url)
    kwargs = {
        "target_metadata": _target_metadata(),
        "compare_type": True,
        "render_as_batch": database_url.startswith("sqlite"),
    }
    if use_named_schemas:
        kwargs["include_schemas"] = True
        kwargs["version_table_schema"] = "system"
    return kwargs


def run_migrations_offline() -> None:
    url = _database_url()
    context.configure(
        url=url,
        literal_binds=True,
        dialect_opts={"paramstyle": "named"},
        **_configure_kwargs(),
    )

    with context.begin_transaction():
        context.run_migrations()


def run_migrations_online() -> None:
    configuration = config.get_section(config.config_ini_section) or {}
    database_url = _database_url()
    configuration["sqlalchemy.url"] = database_url

    connectable = engine_from_config(
        configuration,
        prefix="sqlalchemy.",
        poolclass=pool.NullPool,
        future=True,
    )

    with connectable.connect() as connection:
        if uses_named_schemas(database_url):
            with connection.begin():
                connection.execute(sa.text('CREATE SCHEMA IF NOT EXISTS "app"'))
                connection.execute(sa.text('CREATE SCHEMA IF NOT EXISTS "chat"'))
                connection.execute(sa.text('CREATE SCHEMA IF NOT EXISTS "system"'))
        context.configure(connection=connection, **_configure_kwargs())

        with context.begin_transaction():
            context.run_migrations()


if context.is_offline_mode():
    run_migrations_offline()
else:
    run_migrations_online()
