from __future__ import annotations

import os
import sys
import threading
import time
from pathlib import Path

import pytest


ROOT = Path(__file__).resolve().parents[1]
WEB_ROOT = ROOT / "WEB-itinvent"
if str(WEB_ROOT) not in sys.path:
    sys.path.insert(0, str(WEB_ROOT))

from backend.services.warehouse_1c_process_bridge import (  # noqa: E402
    Warehouse1CProcessBridge,
    Warehouse1CProcessBridgeBusy,
    Warehouse1CProcessBridgeConfigurationError,
    Warehouse1CProcessBridgeRemoteError,
    Warehouse1CProcessBridgeTimeout,
    Warehouse1CProcessBridgeUnavailable,
)
from backend.services import warehouse_1c_process_dispatcher  # noqa: E402
from backend.services import warehouse_1c_process_bridge as bridge_module  # noqa: E402


def bridge_test_dispatcher(operation: str, payload: dict):
    """Imported by the spawned child through an explicit dispatcher path."""

    if payload.get("started_marker"):
        Path(payload["started_marker"]).write_text("started", encoding="utf-8")
    if payload.get("validation") or payload.get("text") == "invalid-filter":
        error_type = getattr(bridge_module, "Warehouse1CProcessBridgeValidationError", ValueError)
        raise error_type("Choose a warehouse")
    delay = 0.8 if payload.get("text") == "slow-read" else float(payload.get("sleep", 0) or 0)
    if delay:
        time.sleep(delay)
    if payload.get("fail"):
        raise RuntimeError("read dispatcher failed")
    if payload.get("die"):
        os._exit(3)
    marker = payload.get("die_once_marker")
    if marker and not Path(marker).exists():
        Path(marker).write_text("died", encoding="utf-8")
        os._exit(3)
    if operation == "balances":
        return {"status": "ok", "source": "live_1c", "items": []}
    return {"operation": operation, "payload": payload}


DISPATCHER_PATH = "tests.test_warehouse_1c_process_bridge:bridge_test_dispatcher"


def _bridge(**kwargs) -> Warehouse1CProcessBridge:
    return Warehouse1CProcessBridge(
        DISPATCHER_PATH,
        allowed_operations={"health"},
        queue_limit=kwargs.pop("queue_limit", 2),
        cooldown_seconds=kwargs.pop("cooldown_seconds", 1),
        **kwargs,
    )


def _wait_until(predicate, *, timeout: float = 3) -> bool:
    deadline = time.monotonic() + timeout
    while time.monotonic() < deadline:
        if predicate():
            return True
        time.sleep(0.02)
    return bool(predicate())


def test_process_bridge_runs_json_read_dispatcher_and_exposes_metrics():
    bridge = _bridge()
    try:
        result = bridge.call("health", {"reference": "nom-1"}, timeout=10)

        assert result == {"operation": "health", "payload": {"reference": "nom-1"}}
        status = bridge.get_status()
        assert status["mode"] == "read_only_process_bridge"
        assert status["workers"] == 1
        assert status["completed"] == 1
        assert status["circuit_breaker"] == "closed"
        assert status["pid"]

        with pytest.raises(Warehouse1CProcessBridgeConfigurationError):
            bridge.call("write_document", {}, timeout=1)
    finally:
        bridge.shutdown()


def test_process_bridge_uses_pythonw_for_hidden_windows_worker(monkeypatch):
    if os.name != "nt":
        return
    observed = []
    original = bridge_module.multiprocessing_module.set_executable

    def record(executable):
        observed.append(os.fsdecode(executable))
        return original(executable)

    monkeypatch.setattr(bridge_module.multiprocessing_module, "set_executable", record)
    bridge = _bridge()
    try:
        bridge.start()
        assert any(Path(value).name.casefold() == "pythonw.exe" for value in observed)
    finally:
        bridge.shutdown()


def test_process_bridge_timeout_terminates_worker_and_manual_restart_recovers():
    bridge = _bridge(failure_threshold=1, cooldown_seconds=30)
    try:
        with pytest.raises(Warehouse1CProcessBridgeTimeout) as timed_out:
            bridge.call("health", {"sleep": 1}, timeout=0.08)
        assert timed_out.value.reason_code == "timeout"

        status = bridge.get_status()
        assert status["timed_out"] == 1
        assert status["restarts"] >= 1
        assert status["circuit_breaker"] == "open"

        with pytest.raises(Warehouse1CProcessBridgeUnavailable) as unavailable:
            bridge.call("health", {}, timeout=1)
        assert unavailable.value.reason_code == "circuit_open"

        restarted = bridge.restart()
        assert restarted["circuit_breaker"] == "closed"
        assert bridge.call("health", {"after_restart": True}, timeout=10)["payload"] == {
            "after_restart": True
        }
    finally:
        bridge.shutdown()


def test_process_bridge_repeats_read_once_after_worker_dies_on_its_own(tmp_path):
    bridge = _bridge()
    try:
        marker = tmp_path / "died-once"
        result = bridge.call("health", {"die_once_marker": str(marker)}, timeout=30)

        assert result["payload"] == {"die_once_marker": str(marker)}
        assert marker.exists()
        assert bridge.get_status()["restarts"] >= 1
    finally:
        bridge.shutdown()


def test_process_bridge_reports_exit_code_when_worker_keeps_dying():
    bridge = _bridge()
    try:
        with pytest.raises(Warehouse1CProcessBridgeUnavailable, match="код выхода 0x00000003") as unavailable:
            bridge.call("health", {"die": True}, timeout=30)
        assert unavailable.value.reason_code == "worker_lost"

        assert bridge.get_status()["restarts"] >= 2
    finally:
        bridge.shutdown()


def test_process_bridge_rejects_overflow_without_sending_an_extra_com_call():
    bridge = _bridge(queue_limit=0)
    finished: list[object] = []

    def run_slow_read() -> None:
        try:
            finished.append(bridge.call("health", {"sleep": 0.4}, timeout=10))
        finally:
            pass

    thread = threading.Thread(target=run_slow_read)
    thread.start()
    try:
        assert _wait_until(lambda: bridge.get_status()["pending"] == 1)
        with pytest.raises(Warehouse1CProcessBridgeBusy) as busy:
            bridge.call("health", {}, timeout=1)
        assert busy.value.reason_code == "queue_full"
        thread.join(timeout=10)
        assert not thread.is_alive()
        assert len(finished) == 1
        assert bridge.get_status()["rejected"] == 1
    finally:
        bridge.shutdown()


def test_process_bridge_counts_remote_failure_and_opens_circuit():
    bridge = _bridge(failure_threshold=1, cooldown_seconds=30)
    try:
        with pytest.raises(Warehouse1CProcessBridgeRemoteError, match="read dispatcher failed") as failed:
            bridge.call("health", {"fail": True}, timeout=10)
        assert failed.value.reason_code == "remote_error"

        status = bridge.get_status()
        assert status["failed"] == 1
        assert status["circuit_breaker"] == "open"
        assert "read dispatcher failed" in (status["last_error"] or "")
    finally:
        bridge.shutdown()


def test_queued_read_expiry_does_not_interrupt_active_read_or_execute_later(tmp_path):
    bridge = _bridge()
    started = tmp_path / "active-started"
    expired = tmp_path / "expired-started"
    errors = []

    def active_read():
        try:
            bridge.call("health", {"sleep": 0.8, "started_marker": str(started)}, timeout=10)
        except Exception as exc:
            errors.append(exc)

    thread = threading.Thread(target=active_read)
    try:
        bridge.call("health", {}, timeout=10)
        worker_pid = bridge.get_status()["pid"]
        thread.start()
        assert _wait_until(started.exists)
        with pytest.raises(Warehouse1CProcessBridgeBusy) as busy:
            bridge.call("health", {"started_marker": str(expired)}, timeout=0.05)
        assert busy.value.reason_code == "queue_timeout"
        thread.join(timeout=10)
        assert not thread.is_alive()
        assert not errors
        assert not expired.exists()
        assert bridge.get_status()["pid"] == worker_pid
        assert bridge.get_status()["restarts"] == 0
        assert bridge.get_status()["failed"] == 0
        bridge.call("health", {}, timeout=10)
    finally:
        if thread.ident:
            thread.join(timeout=10)
        bridge.shutdown()


def test_validation_errors_do_not_open_circuit_or_prevent_next_read():
    bridge = _bridge(failure_threshold=2)
    try:
        for _ in range(4):
            with pytest.raises(ValueError, match="Choose a warehouse"):
                bridge.call("health", {"validation": True}, timeout=10)
        bridge.call("health", {}, timeout=10)
        assert bridge.get_status()["failed"] == 0
        assert bridge.get_status()["circuit_breaker"] == "closed"
    finally:
        bridge.shutdown()


def test_shutdown_rejects_next_read_without_recreating_worker():
    bridge = _bridge()
    try:
        bridge.call("health", {}, timeout=10)
        bridge.shutdown()
        with pytest.raises(Warehouse1CProcessBridgeUnavailable) as stopped:
            bridge.call("health", {}, timeout=10)
        assert stopped.value.reason_code == "bridge_stopped"
        assert bridge.get_status()["pid"] is None
        assert bridge.get_status()["state"] == "stopped"
    finally:
        bridge.shutdown()


def test_catalog_sync_cannot_block_interactive_service_read(monkeypatch, tmp_path):
    from types import SimpleNamespace
    from backend.services.warehouse_1c_service import Warehouse1CService

    monkeypatch.setenv("WAREHOUSE_1C_BRIDGE_DISPATCHER", DISPATCHER_PATH)
    service = Warehouse1CService(
        data_manager=SimpleNamespace(load_json=lambda _name, default_content=None: default_content),
        enable_process_bridge=True,
    )
    started = tmp_path / "catalog-started"
    errors = []

    def sync_catalog():
        try:
            service._run_process_bridge_sync(
                "catalog_sync", {"sleep": 1.5, "started_marker": str(started)}, timeout=10
            )
        except Exception as exc:
            errors.append(exc)

    thread = threading.Thread(target=sync_catalog)
    try:
        service._run_process_bridge_sync("warmup", {}, timeout=10)
        thread.start()
        assert _wait_until(started.exists, timeout=10)
        service._run_process_bridge_sync("balances", {"warehouse_ref": "wh-1"}, timeout=0.4)
        assert thread.is_alive(), "interactive read must finish while catalog sync is still running"
        thread.join(timeout=10)
        assert not thread.is_alive()
        assert not errors
        assert service._process_bridge.get_status()["pid"] != service._catalog_process_bridge.get_status()["pid"]
    finally:
        if thread.ident:
            thread.join(timeout=10)
        service.shutdown()


def test_slow_employee_compare_read_cannot_starve_it_requests(monkeypatch, tmp_path):
    from types import SimpleNamespace
    from backend.services.warehouse_1c_service import Warehouse1CService

    monkeypatch.setenv("WAREHOUSE_1C_BRIDGE_DISPATCHER", DISPATCHER_PATH)
    service = Warehouse1CService(
        data_manager=SimpleNamespace(load_json=lambda _name, default_content=None: default_content),
        enable_process_bridge=True,
    )
    started = tmp_path / "heavy-started"
    errors = []

    def heavy_read():
        try:
            service._run_process_bridge_sync(
                "balances_by_warehouses", {"sleep": 1.5, "started_marker": str(started)}, timeout=10
            )
        except Exception as exc:
            errors.append(exc)

    thread = threading.Thread(target=heavy_read)
    try:
        service._run_process_bridge_sync("warmup", {}, timeout=10)
        thread.start()
        assert _wait_until(started.exists, timeout=10)
        service._run_process_bridge_sync("balances", {"warehouse_ref": "wh-1"}, timeout=0.4)
        assert thread.is_alive(), "an ordinary read must finish while the heavy read is still running"
        thread.join(timeout=10)
        assert not errors
        assert service._process_bridge.get_status()["pid"] != service._heavy_process_bridge.get_status()["pid"]
    finally:
        if thread.ident:
            thread.join(timeout=10)
        service.shutdown()


def test_startup_failure_is_distinct_from_worker_crash_and_can_be_retried():
    bridge = Warehouse1CProcessBridge(
        "tests.test_warehouse_1c_process_bridge:missing_startup_dispatcher", allowed_operations={"health"},
    )
    try:
        for _ in range(2):
            with pytest.raises(Warehouse1CProcessBridgeUnavailable) as unavailable:
                bridge.call("health", {}, timeout=30)
            assert unavailable.value.reason_code == "worker_startup_failed"
        assert bridge.get_status()["pending"] == 0
        assert bridge.get_status()["restarts"] >= 2
    finally:
        bridge.shutdown()


def test_process_bridge_stop_does_not_join_stuck_queue_feeder():
    """A feeder blocked in _send_bytes to a dead child must not wedge the lock."""

    class StuckFeederQueue:
        def __init__(self):
            self.cancelled = False

        def close(self):
            pass

        def join_thread(self):
            threading.Event().wait(30)

        def cancel_join_thread(self):
            self.cancelled = True

    bridge = _bridge()
    request_queue = StuckFeederQueue()
    response_queue = StuckFeederQueue()
    try:
        with bridge._lock:
            bridge._request_queue = request_queue
            bridge._response_queue = response_queue
            started = time.monotonic()
            bridge._stop_process_locked(grace_seconds=0)
        assert time.monotonic() - started < 5
        assert request_queue.cancelled
        assert response_queue.cancelled
    finally:
        bridge.shutdown()


def test_warehouse_dispatcher_warmup_opens_the_read_connection(monkeypatch):
    calls = []

    class FakeService:
        def warmup_connection(self):
            calls.append("warmup")
            return {"ready": True}

    monkeypatch.setattr(warehouse_1c_process_dispatcher, "_service", FakeService())

    assert warehouse_1c_process_dispatcher.dispatch("warmup", {}) == {"ready": True}
    assert calls == ["warmup"]


def test_warehouse_dispatcher_routes_balances_by_warehouses(monkeypatch):
    calls = []

    class FakeService:
        async def get_balances_for_warehouses(self, **kwargs):
            calls.append(kwargs)
            return {"status": "ok", "items": []}

    monkeypatch.setattr(warehouse_1c_process_dispatcher, "_service", FakeService())

    payload = warehouse_1c_process_dispatcher.dispatch(
        "balances_by_warehouses",
        {"warehouse_refs": ["wh-1", "wh-2"], "limit": 750},
    )

    assert payload == {"status": "ok", "items": []}
    assert calls == [{"warehouse_refs": ["wh-1", "wh-2"], "limit": 750}]
