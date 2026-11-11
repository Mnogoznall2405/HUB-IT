"""alembic/env.py must never fall back to the database URL from the root .env."""
from __future__ import annotations

import pytest
from alembic import command

from backend.db_migrations import build_alembic_config


def _config_without_url():
    config = build_alembic_config("sqlite://")
    config.set_main_option("sqlalchemy.url", "")
    return config


def test_env_py_refuses_to_run_without_explicit_url(monkeypatch):
    monkeypatch.delenv("ALEMBIC_DATABASE_URL", raising=False)
    monkeypatch.setenv("APP_DATABASE_URL", "postgresql://unused:unused@127.0.0.1:1/unused")
    monkeypatch.setenv("CHAT_DATABASE_URL", "postgresql://unused:unused@127.0.0.1:1/unused")

    with pytest.raises(RuntimeError, match="Alembic database URL is not set"):
        command.current(_config_without_url())


def test_env_py_accepts_url_from_environment(monkeypatch, tmp_path):
    monkeypatch.setenv("ALEMBIC_DATABASE_URL", f"sqlite:///{(tmp_path / 'alembic.sqlite3').as_posix()}")

    command.current(_config_without_url())


def test_env_py_accepts_x_argument(monkeypatch, tmp_path):
    monkeypatch.delenv("ALEMBIC_DATABASE_URL", raising=False)
    config = _config_without_url()
    config.cmd_opts = type("Opts", (), {"x": [f"url=sqlite:///{(tmp_path / 'x.sqlite3').as_posix()}"]})()

    command.current(config)
