"""Alembic helpers for unified internal PostgreSQL migrations."""
from __future__ import annotations

from pathlib import Path

from alembic import command
from alembic.config import Config as AlembicConfig


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


def stamp_internal_database(database_url: str, revision, *, scope: str | None = None) -> None:
    command.stamp(build_alembic_config(database_url, scope=scope), revision)
