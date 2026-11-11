"""DOPS-02/03: a connection that cannot roll back must leave the SQL Server pool, and
concurrent first access must build exactly one App engine per URL."""
from __future__ import annotations

import sys
import threading
from pathlib import Path

import pytest

PROJECT_ROOT = Path(__file__).resolve().parents[1]
WEB_ROOT = PROJECT_ROOT / "WEB-itinvent"
if str(WEB_ROOT) not in sys.path:
    sys.path.insert(0, str(WEB_ROOT))

from backend.appdb import db as appdb  # noqa: E402
from backend.database import connection as sql_connection  # noqa: E402


class _FakeConn:
    def __init__(self, rollback_fails=False):
        self.rollback_fails = rollback_fails
        self.closed = False

    def cursor(self):
        return self

    def execute(self, *_args):
        return self

    def close(self):
        self.closed = True

    def commit(self):
        pass

    def rollback(self):
        if self.rollback_fails:
            raise RuntimeError("connection is dead")


def _manager(monkeypatch, connections):
    pool = sql_connection._PyodbcConnectionPool("cs", pool_size=2, idle_ping_sec=0.0)
    queue_of = list(connections)
    monkeypatch.setattr(pool, "_create_connection", lambda: queue_of.pop(0))
    manager = sql_connection.DatabaseConnectionManager.__new__(sql_connection.DatabaseConnectionManager)
    manager._pool = pool
    return manager, pool


def test_connection_whose_rollback_fails_is_discarded_not_pooled(monkeypatch):
    broken, healthy = _FakeConn(rollback_fails=True), _FakeConn()
    manager, pool = _manager(monkeypatch, [broken, healthy])

    with pytest.raises(ValueError, match="original"):
        with manager.get_connection():
            raise ValueError("original query error")

    assert broken.closed is True
    assert pool._created == 0 and pool._pool.qsize() == 0
    with manager.get_connection() as conn:
        assert conn is healthy


def test_healthy_connection_is_still_returned_to_the_pool(monkeypatch):
    conn = _FakeConn()
    manager, pool = _manager(monkeypatch, [conn])

    with manager.get_connection():
        pass

    assert pool._pool.qsize() == 1 and pool._created == 1 and conn.closed is False


def test_concurrent_first_access_builds_one_engine_per_url(monkeypatch):
    url = "sqlite:///dops03-test.db"
    monkeypatch.setattr(appdb, "_engines", {})
    monkeypatch.setattr(appdb, "_session_factories", {})
    monkeypatch.setattr(appdb, "ensure_app_database_configured", lambda value=None: value or url)
    built = []
    gate = threading.Barrier(20)

    def slow_builder(resolved_url):
        built.append(resolved_url)
        threading.Event().wait(0.05)  # let the other threads reach the cache check
        return object()

    monkeypatch.setattr(appdb, "_build_engine", slow_builder)
    results = []

    def worker():
        gate.wait()
        results.append(appdb.get_app_engine(url))

    threads = [threading.Thread(target=worker) for _ in range(20)]
    for thread in threads:
        thread.start()
    for thread in threads:
        thread.join()

    assert len(built) == 1
    assert len({id(engine) for engine in results}) == 1


def test_failed_engine_build_leaves_no_cache_entry(monkeypatch):
    url = "sqlite:///dops03-fail.db"
    monkeypatch.setattr(appdb, "_engines", {})
    monkeypatch.setattr(appdb, "ensure_app_database_configured", lambda value=None: value or url)
    monkeypatch.setattr(appdb, "_build_engine", lambda _url: (_ for _ in ()).throw(RuntimeError("boom")))

    with pytest.raises(RuntimeError):
        appdb.get_app_engine(url)

    assert appdb._engines == {}
