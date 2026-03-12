from __future__ import annotations

from argparse import Namespace
from pathlib import Path

import scan_agent.agent as scan_agent


class _DummyResponse:
    def __init__(self, *, status_code: int = 200, data=None):
        self.status_code = status_code
        self._data = data or {}
        self.content = b"{}"
        self.text = ""

    def json(self):
        return self._data


def _make_config() -> dict:
    return {
        "server_base": "https://hubit.zsgp.ru/api/v1/scan",
        "api_key": "test-key",
        "poll_interval": 60,
        "timeout": 20,
        "max_file_bytes": 1024 * 1024,
        "run_scan_on_start": False,
        "watchdog_enabled": False,
        "watchdog_batch_size": 200,
        "roots_refresh_sec": 300,
        "branch": "",
        "patterns_file": "",
        "outbox_max_items": 5000,
        "outbox_max_age_days": 14,
        "outbox_max_total_mb": 512,
    }


def test_read_env_defaults_to_on_demand(monkeypatch):
    monkeypatch.delenv("SCAN_AGENT_SCAN_ON_START", raising=False)
    monkeypatch.delenv("SCAN_AGENT_WATCHDOG_ENABLED", raising=False)
    monkeypatch.setenv("SCAN_AGENT_API_KEY", "configured-key")

    config = scan_agent._read_env()

    assert config["run_scan_on_start"] is False
    assert config["watchdog_enabled"] is False


def test_poll_tasks_scan_now_runs_scan_once(monkeypatch):
    agent = scan_agent.ScanAgent(_make_config())
    sent_payloads = []
    run_stats = {"scanned": 1, "queued": 0, "skipped": 0}

    def fake_send(method, url, **kwargs):
        if url.endswith("/tasks/poll"):
            return _DummyResponse(
                data={"tasks": [{"task_id": "task-1", "command": "scan_now"}]}
            )
        sent_payloads.append((method, url, kwargs.get("json")))
        return _DummyResponse()

    monkeypatch.setattr(agent, "_send", fake_send)
    monkeypatch.setattr(agent, "run_scan_once", lambda: run_stats)

    agent.poll_tasks()

    assert any(payload and payload.get("status") == "acknowledged" for _, _, payload in sent_payloads)
    assert any(payload and payload.get("status") == "completed" and payload.get("result") == run_stats for _, _, payload in sent_payloads)


def test_run_forever_does_not_scan_on_start_by_default(monkeypatch):
    agent = scan_agent.ScanAgent(_make_config())
    started = []

    class _StopLoop(RuntimeError):
        pass

    monkeypatch.setattr(agent, "refresh_roots", lambda force=False: None)
    monkeypatch.setattr(agent, "_start_watchdog", lambda: None)
    monkeypatch.setattr(agent, "run_scan_once", lambda: started.append("scan"))
    monkeypatch.setattr(agent, "heartbeat", lambda: None)
    monkeypatch.setattr(agent, "poll_tasks", lambda: (_ for _ in ()).throw(_StopLoop()))
    monkeypatch.setattr(agent, "_outbox_prune_limits", lambda: None)
    monkeypatch.setattr(agent, "_drain_outbox", lambda max_items=200: 0)
    monkeypatch.setattr(agent, "process_watchdog_queue", lambda max_items=200: {"scanned": 0, "queued": 0, "skipped": 0})
    monkeypatch.setattr(agent, "_persist_state", lambda: None)
    monkeypatch.setattr(agent, "_write_status", lambda force=False: None)
    monkeypatch.setattr(agent, "_stop_watchdog", lambda: None)

    try:
        agent.run_forever()
    except _StopLoop:
        pass

    assert started == []


def test_main_heartbeat_mode(monkeypatch):
    calls = []

    class DummyAgent:
        def __init__(self, config):
            self.pattern_defs = ["ok"]

        def heartbeat(self):
            calls.append("heartbeat")

        def run_scan_once(self):
            calls.append("once")
            return {}

        def run_forever(self):
            calls.append("forever")

    monkeypatch.setattr(scan_agent, "bootstrap_env_from_files", lambda: [])
    monkeypatch.setattr(scan_agent, "setup_logging", lambda: None)
    monkeypatch.setattr(scan_agent, "parse_args", lambda: Namespace(heartbeat=True, once=False, no_watchdog=False))
    monkeypatch.setattr(scan_agent, "_read_env", _make_config)
    monkeypatch.setattr(scan_agent, "ScanAgent", DummyAgent)

    assert scan_agent.main() == 0
    assert calls == ["heartbeat"]


def test_main_once_mode(monkeypatch):
    calls = []

    class DummyAgent:
        def __init__(self, config):
            self.pattern_defs = ["ok"]

        def heartbeat(self):
            calls.append("heartbeat")

        def run_scan_once(self):
            calls.append("once")
            return {"scanned": 1}

        def run_forever(self):
            calls.append("forever")

    monkeypatch.setattr(scan_agent, "bootstrap_env_from_files", lambda: [])
    monkeypatch.setattr(scan_agent, "setup_logging", lambda: None)
    monkeypatch.setattr(scan_agent, "parse_args", lambda: Namespace(heartbeat=False, once=True, no_watchdog=False))
    monkeypatch.setattr(scan_agent, "_read_env", _make_config)
    monkeypatch.setattr(scan_agent, "ScanAgent", DummyAgent)

    assert scan_agent.main() == 0
    assert calls == ["once"]


def test_setup_py_includes_watchdog_packages():
    setup_text = (Path(__file__).resolve().parents[1] / "agent" / "setup.py").read_text(encoding="utf-8")

    assert '"watchdog"' in setup_text
    assert '"watchdog.events"' in setup_text
    assert '"watchdog.observers"' in setup_text
