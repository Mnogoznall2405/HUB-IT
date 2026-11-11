"""The chat read engine must keep its read-only + statement_timeout guard, now as connection
defaults instead of two extra round trips (SET TRANSACTION / SET LOCAL) per transaction.

Why a unit test: a regression here is silent — reads would simply lose their timeout guard and
nothing in an E2E flow on sqlite exercises the PostgreSQL connection options."""
from __future__ import annotations

from backend.chat import db as chat_db

import pytest

# Never connects: the URL is a placeholder and the schema probe is stubbed out.
PG_URL = "postgresql+psycopg://user:secret@127.0.0.1:5432/hubit_chat"


@pytest.fixture(autouse=True)
def _no_database_probe(monkeypatch):
    monkeypatch.setattr(chat_db, "_should_use_legacy_public_chat_schema", lambda engine: False)


_captured: list[dict] = []


@pytest.fixture(autouse=True)
def _capture_engine_kwargs(monkeypatch):
    _captured.clear()
    real = chat_db.create_engine

    def spy(url, **kwargs):
        _captured.append(kwargs)
        return real(url, **kwargs)

    monkeypatch.setattr(chat_db, "create_engine", spy)


def _connect_options(_engine) -> str:
    return str((_captured[-1].get("connect_args") or {}).get("options") or "")


def test_read_engine_connects_read_only_with_statement_timeout():
    engine = chat_db._build_engine(PG_URL, pool_class="read")
    options = _connect_options(engine)
    assert "default_transaction_read_only=on" in options
    assert "statement_timeout=" in options
    assert engine in chat_db._READ_ENGINES_WITH_SESSION_DEFAULTS


def test_write_engine_is_never_read_only():
    engine = chat_db._build_engine(PG_URL, pool_class="write")
    assert "read_only" not in _connect_options(engine)
    assert engine not in chat_db._READ_ENGINES_WITH_SESSION_DEFAULTS


def test_read_session_skips_per_transaction_set_statements_only_when_defaults_exist(monkeypatch):
    executed: list[str] = []

    class _Dialect:
        name = "postgresql"

    class _Session:
        def __init__(self, bind):
            self._bind = bind

        def get_bind(self):
            return self._bind

        def execute(self, statement):
            executed.append(str(statement))

        def commit(self):
            pass

        def rollback(self):
            pass

        def close(self):
            pass

    class _Bind:
        dialect = _Dialect()

    guarded, plain = _Bind(), _Bind()
    chat_db._READ_ENGINES_WITH_SESSION_DEFAULTS.add(guarded)
    monkeypatch.setattr(chat_db, "ensure_chat_configured", lambda url=None: PG_URL, raising=False)

    for bind in (guarded, plain):
        monkeypatch.setattr(chat_db, "get_chat_read_session_factory", lambda url=None, bind=bind: (lambda: _Session(bind)))
        with chat_db.chat_read_session():
            pass

    # The guarded engine issued nothing; the plain engine still sets READ ONLY + timeout.
    assert [s for s in executed if "READ ONLY" in s] == ["SET TRANSACTION READ ONLY"]
    assert sum("statement_timeout" in s for s in executed) == 1
