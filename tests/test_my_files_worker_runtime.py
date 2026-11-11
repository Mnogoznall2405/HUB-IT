from __future__ import annotations

from types import SimpleNamespace


def test_advisory_lock_uses_a_dedicated_engine(monkeypatch):
    import start_my_files_worker as worker_module

    class _Result:
        @staticmethod
        def scalar():
            return True

    class _Connection:
        def __init__(self) -> None:
            self.closed = False
            self.committed = False

        def execute(self, *_args, **_kwargs):
            return _Result()

        def commit(self) -> None:
            self.committed = True

        def close(self) -> None:
            self.closed = True

    class _DedicatedEngine:
        def __init__(self) -> None:
            self.connection = _Connection()
            self.disposed = False

        def connect(self):
            return self.connection

        def dispose(self) -> None:
            self.disposed = True

    shared_engine = SimpleNamespace(
        dialect=SimpleNamespace(name="postgresql"),
        connect=lambda: (_ for _ in ()).throw(
            AssertionError("the worker pool must not provide the lifetime advisory lock")
        ),
    )
    dedicated_engine = _DedicatedEngine()
    monkeypatch.setattr(worker_module, "get_app_engine", lambda: shared_engine)
    monkeypatch.setattr(
        worker_module,
        "_create_worker_lock_engine",
        lambda: dedicated_engine,
        raising=False,
    )

    lock = worker_module._acquire_worker_lock()

    assert lock is not None
    assert dedicated_engine.connection.committed is True
    lock.close()
    assert dedicated_engine.connection.closed is True
    assert dedicated_engine.disposed is True


def test_my_files_worker_pool_has_processing_headroom():
    from pathlib import Path

    source = (
        Path(__file__).resolve().parents[1]
        / "scripts"
        / "pm2"
        / "ecosystem.backend.config.js"
    ).read_text(encoding="utf-8")
    worker_block = source.split("name: 'itinvent-my-files-worker'", 1)[1].split("},\n    },", 1)[0]

    assert "APP_DB_POOL_SIZE: '4'" in worker_block
    assert "APP_DB_MAX_OVERFLOW: '2'" in worker_block
    assert "APP_DB_DEDICATED_CONNECTIONS: '1'" in worker_block
