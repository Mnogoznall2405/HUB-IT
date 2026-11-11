"""V83.COMConnector.Connect crashes the process when entered concurrently.

The pool lazily creates one connection per worker thread, so a cold pool
(or mass reconnect) pushes several threads into Connect() at once — this
is exactly what the APPCRASH dumps in logs/warehouse1c_worker_fault.log
showed.  The shared ONE_C_CONNECT_LOCK must keep that section serial.
"""
from __future__ import annotations

import sys
import threading
import time
import types

from backend.services.one_c_connect_lock import ONE_C_CONNECT_LOCK
from backend.services.warehouse_1c_service import (
    Warehouse1CService,
    _Warehouse1CConnectionPool,
)


def test_concurrent_1c_connect_calls_are_serialized(monkeypatch):
    active = 0
    max_active = 0
    counter_lock = threading.Lock()

    class _Connector:
        def Connect(self, connection_string):  # noqa: ARG002
            nonlocal active, max_active
            with counter_lock:
                active += 1
                max_active = max(max_active, active)
            # Real login to a 1C cluster takes well over 100 ms; keep the
            # window wide enough that an unlocked pool would overlap.
            time.sleep(0.15)
            with counter_lock:
                active -= 1
            return object()

    fake_client = types.SimpleNamespace(Dispatch=lambda _prog_id: _Connector())
    monkeypatch.setitem(sys.modules, "win32com", types.SimpleNamespace(client=fake_client))
    monkeypatch.setitem(sys.modules, "win32com.client", fake_client)
    monkeypatch.setitem(
        sys.modules,
        "pythoncom",
        types.SimpleNamespace(CoInitialize=lambda: None, CoUninitialize=lambda: None),
    )
    monkeypatch.setenv("BUH20_1C_USER", "test-user")
    monkeypatch.setenv("BUH20_1C_PASSWORD", "test-password")

    service = object.__new__(Warehouse1CService)  # _connect does not use self
    pool = _Warehouse1CConnectionPool(service._connect, 3)
    try:
        futures = [pool.submit(lambda connection: connection is not None) for _ in range(3)]
        assert all(future.result(timeout=15) for future in futures)
    finally:
        pool._executor.shutdown(wait=True)

    assert max_active == 1


def test_all_1c_connect_sites_share_one_lock():
    """The race lives in comcntr.dll process state, so per-module locks would not help."""
    from backend.services import address_book_service, docflow_1c_client, warehouse_1c_service

    assert warehouse_1c_service.ONE_C_CONNECT_LOCK is ONE_C_CONNECT_LOCK
    assert address_book_service.ONE_C_CONNECT_LOCK is ONE_C_CONNECT_LOCK
    assert docflow_1c_client.ONE_C_CONNECT_LOCK is ONE_C_CONNECT_LOCK
