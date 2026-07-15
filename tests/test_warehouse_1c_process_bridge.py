from __future__ import annotations

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


def bridge_test_dispatcher(operation: str, payload: dict):
    """Imported by the spawned child through an explicit dispatcher path."""

    delay = float(payload.get("sleep", 0) or 0)
    if delay:
        time.sleep(delay)
    if payload.get("fail"):
        raise RuntimeError("read dispatcher failed")
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


def test_process_bridge_timeout_terminates_worker_and_manual_restart_recovers():
    bridge = _bridge(failure_threshold=1, cooldown_seconds=30)
    try:
        with pytest.raises(Warehouse1CProcessBridgeTimeout):
            bridge.call("health", {"sleep": 1}, timeout=0.08)

        status = bridge.get_status()
        assert status["timed_out"] == 1
        assert status["restarts"] >= 1
        assert status["circuit_breaker"] == "open"

        with pytest.raises(Warehouse1CProcessBridgeUnavailable):
            bridge.call("health", {}, timeout=1)

        restarted = bridge.restart()
        assert restarted["circuit_breaker"] == "closed"
        assert bridge.call("health", {"after_restart": True}, timeout=10)["payload"] == {
            "after_restart": True
        }
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
        with pytest.raises(Warehouse1CProcessBridgeBusy):
            bridge.call("health", {}, timeout=1)
        thread.join(timeout=10)
        assert not thread.is_alive()
        assert len(finished) == 1
        assert bridge.get_status()["rejected"] == 1
    finally:
        bridge.shutdown()


def test_process_bridge_counts_remote_failure_and_opens_circuit():
    bridge = _bridge(failure_threshold=1, cooldown_seconds=30)
    try:
        with pytest.raises(Warehouse1CProcessBridgeRemoteError, match="read dispatcher failed"):
            bridge.call("health", {"fail": True}, timeout=10)

        status = bridge.get_status()
        assert status["failed"] == 1
        assert status["circuit_breaker"] == "open"
        assert "read dispatcher failed" in (status["last_error"] or "")
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
