from __future__ import annotations

from argparse import Namespace
from pathlib import Path
import re

import scan_agent.agent as scan_agent
from agent_version import AGENT_VERSION as SHARED_AGENT_VERSION


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


def _make_pattern_defs(pattern: str) -> list[dict]:
    return [{"id": "p1", "name": "pattern", "weight": 1.0, "regex": re.compile(pattern)}]


def test_read_env_defaults_to_on_demand(monkeypatch):
    monkeypatch.delenv("SCAN_AGENT_SCAN_ON_START", raising=False)
    monkeypatch.delenv("SCAN_AGENT_WATCHDOG_ENABLED", raising=False)
    monkeypatch.setenv("SCAN_AGENT_API_KEY", "configured-key")

    config = scan_agent._read_env()

    assert config["run_scan_on_start"] is False
    assert config["watchdog_enabled"] is False


def test_poll_tasks_scan_now_keeps_task_acknowledged_until_server_processing_finishes(monkeypatch):
    agent = scan_agent.ScanAgent(_make_config())
    sent_payloads = []
    run_stats = {
        "phase": "server_processing",
        "scanned": 2,
        "queued": 2,
        "skipped": 1,
        "deferred": 0,
        "jobs_total": 2,
        "jobs_pending": 2,
        "jobs_done_clean": 0,
        "jobs_done_with_incident": 0,
        "jobs_failed": 0,
    }

    def fake_send(method, url, **kwargs):
        if url.endswith("/tasks/poll"):
            return _DummyResponse(
                data={"tasks": [{"task_id": "task-1", "command": "scan_now"}]}
            )
        sent_payloads.append((method, url, kwargs.get("json")))
        return _DummyResponse()

    monkeypatch.setattr(agent, "_send", fake_send)
    monkeypatch.setattr(agent, "run_scan_once", lambda scan_task_id=None: run_stats)

    agent.poll_tasks()

    acknowledged_payloads = [payload for _, _, payload in sent_payloads if payload and payload.get("status") == "acknowledged"]
    assert len(acknowledged_payloads) == 2
    assert acknowledged_payloads[0]["result"]["phase"] == "local_scan"
    assert acknowledged_payloads[1]["result"] == run_stats
    assert not any(payload and payload.get("status") == "completed" for _, _, payload in sent_payloads)


def test_poll_tasks_scan_now_completes_immediately_when_server_has_no_jobs(monkeypatch):
    agent = scan_agent.ScanAgent(_make_config())
    sent_payloads = []
    run_stats = {
        "phase": "completed",
        "scanned": 1,
        "queued": 0,
        "skipped": 3,
        "deferred": 0,
        "jobs_total": 0,
        "jobs_pending": 0,
        "jobs_done_clean": 0,
        "jobs_done_with_incident": 0,
        "jobs_failed": 0,
    }

    def fake_send(method, url, **kwargs):
        if url.endswith("/tasks/poll"):
            return _DummyResponse(
                data={"tasks": [{"task_id": "task-1", "command": "scan_now"}]}
            )
        sent_payloads.append((method, url, kwargs.get("json")))
        return _DummyResponse()

    monkeypatch.setattr(agent, "_send", fake_send)
    monkeypatch.setattr(agent, "run_scan_once", lambda scan_task_id=None: run_stats)

    agent.poll_tasks()

    assert any(payload and payload.get("status") == "completed" and payload.get("result") == run_stats for _, _, payload in sent_payloads)


def test_poll_tasks_scan_now_fails_when_files_are_deferred_to_outbox(monkeypatch):
    agent = scan_agent.ScanAgent(_make_config())
    sent_payloads = []
    run_stats = {
        "phase": "failed",
        "scanned": 2,
        "queued": 1,
        "skipped": 0,
        "deferred": 1,
        "jobs_total": 1,
        "jobs_pending": 1,
        "jobs_done_clean": 0,
        "jobs_done_with_incident": 0,
        "jobs_failed": 0,
    }

    def fake_send(method, url, **kwargs):
        if url.endswith("/tasks/poll"):
            return _DummyResponse(
                data={"tasks": [{"task_id": "task-1", "command": "scan_now"}]}
            )
        sent_payloads.append((method, url, kwargs.get("json")))
        return _DummyResponse()

    monkeypatch.setattr(agent, "_send", fake_send)
    monkeypatch.setattr(agent, "run_scan_once", lambda scan_task_id=None: run_stats)

    agent.poll_tasks()

    assert any(
        payload
        and payload.get("status") == "failed"
        and payload.get("result") == run_stats
        and payload.get("error_text") == "Deferred to outbox: 1"
        for _, _, payload in sent_payloads
    )


def test_run_forever_does_not_scan_on_start_by_default(monkeypatch):
    agent = scan_agent.ScanAgent(_make_config())
    started = []

    class _StopLoop(RuntimeError):
        pass

    monkeypatch.setattr(agent, "refresh_roots", lambda force=False: None)
    monkeypatch.setattr(agent, "_start_watchdog", lambda: None)
    monkeypatch.setattr(agent, "run_scan_once", lambda scan_task_id=None: started.append("scan"))
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


def test_scan_agent_task_installer_forces_on_demand_and_hardened_scheduler():
    script_text = (Path(__file__).resolve().parents[1] / "scripts" / "install_scan_agent_task.ps1").read_text(
        encoding="utf-8"
    )

    assert "SCAN_AGENT_SCAN_ON_START" in script_text
    assert "SCAN_AGENT_WATCHDOG_ENABLED" in script_text
    assert "ExecutionTimeLimit" in script_text
    assert "MultipleInstances IgnoreNew" in script_text
    assert "MSFT_TaskRepetitionPattern" in script_text


def test_scan_agent_service_installer_forces_on_demand_defaults():
    script_text = (Path(__file__).resolve().parents[1] / "scripts" / "install_scan_agent_service.ps1").read_text(
        encoding="utf-8"
    )

    assert "SCAN_AGENT_SCAN_ON_START" in script_text
    assert "SCAN_AGENT_WATCHDOG_ENABLED" in script_text
    assert "SetEnvironmentVariable" in script_text


def test_unsupported_file_skips_hashing(monkeypatch, temp_dir):
    agent = scan_agent.ScanAgent(_make_config())
    image_path = Path(temp_dir) / "photo.jpg"
    image_path.write_bytes(b"image-bytes")

    monkeypatch.setattr(scan_agent, "_sha256_file", lambda path: (_ for _ in ()).throw(AssertionError("hash should not be called")))

    result = agent._scan_path(image_path)

    assert result == {"scanned": 0, "queued": 0, "skipped": 1, "deferred": 0}


def test_cp1251_text_file_detects_patterns(monkeypatch, temp_dir):
    agent = scan_agent.ScanAgent(_make_config())
    agent.pattern_defs = _make_pattern_defs("пароль")
    text_path = Path(temp_dir) / "note.txt"
    text_path.write_bytes("пароль для почты".encode("cp1251"))
    sent_payloads = []

    monkeypatch.setattr(agent, "_send_ingest", lambda payload: sent_payloads.append(payload) or True)

    result = agent._scan_path(text_path)

    assert result["queued"] == 1
    assert len(sent_payloads) == 1
    assert sent_payloads[0]["local_pattern_hits"][0]["value"] == "пароль"


def test_identical_content_in_different_paths_creates_two_events(monkeypatch, temp_dir):
    agent = scan_agent.ScanAgent(_make_config())
    agent.pattern_defs = _make_pattern_defs("secret-token")
    first_path = Path(temp_dir) / "user1" / "Desktop" / "match.txt"
    second_path = Path(temp_dir) / "user2" / "Desktop" / "match.txt"
    first_path.parent.mkdir(parents=True, exist_ok=True)
    second_path.parent.mkdir(parents=True, exist_ok=True)
    first_path.write_text("secret-token", encoding="utf-8")
    second_path.write_text("secret-token", encoding="utf-8")
    sent_payloads = []

    monkeypatch.setattr(agent, "_send_ingest", lambda payload: sent_payloads.append(payload) or True)

    first_result = agent._scan_path(first_path)
    second_result = agent._scan_path(second_path)

    assert first_result["queued"] == 1
    assert second_result["queued"] == 1
    assert len(sent_payloads) == 2
    assert sent_payloads[0]["file_path"] != sent_payloads[1]["file_path"]
    assert sent_payloads[0]["event_id"] != sent_payloads[1]["event_id"]


def test_run_scan_once_drains_outbox_once_after_failed_ingest(monkeypatch, temp_dir):
    agent = scan_agent.ScanAgent(_make_config())
    agent.pattern_defs = _make_pattern_defs("classified")
    root = Path(temp_dir) / "Users" / "tester" / "Documents"
    root.mkdir(parents=True, exist_ok=True)
    (root / "one.txt").write_text("classified one", encoding="utf-8")
    (root / "two.txt").write_text("classified two", encoding="utf-8")
    outbox_payloads = []
    prune_calls = []
    drain_calls = []

    agent._roots = [root]
    monkeypatch.setattr(agent, "refresh_roots", lambda force=False: None)
    monkeypatch.setattr(agent, "_send_ingest", lambda payload: False)
    monkeypatch.setattr(agent, "_outbox_enqueue", lambda payload: outbox_payloads.append(payload) or None)
    monkeypatch.setattr(agent, "_outbox_prune_limits", lambda: prune_calls.append("prune"))
    monkeypatch.setattr(agent, "_drain_outbox", lambda max_items=200: drain_calls.append(max_items) or 0)
    monkeypatch.setattr(agent, "_persist_state", lambda: None)
    monkeypatch.setattr(agent, "_write_status", lambda force=False: None)

    summary = agent.run_scan_once()

    assert summary["scanned"] == 2
    assert summary["deferred"] == 2
    assert summary["phase"] == "failed"
    assert summary["jobs_total"] == 0
    assert len(outbox_payloads) == 2
    assert prune_calls == ["prune"]
    assert drain_calls == [200]


def test_heartbeat_reports_shared_agent_version(monkeypatch):
    agent = scan_agent.ScanAgent(_make_config())
    sent_payloads = []

    def fake_send(method, url, **kwargs):
        sent_payloads.append(kwargs.get("json"))
        return _DummyResponse()

    monkeypatch.setattr(agent, "_send", fake_send)

    agent.heartbeat()

    assert sent_payloads[0]["version"] == SHARED_AGENT_VERSION
