from __future__ import annotations

import time
from pathlib import Path

import agent
import agent_installer


def test_bound_keys_survive_msi_override():
    existing = {
        "ITINV_AGENT_API_KEY": "bound-inv-key",
        "SCAN_AGENT_API_KEY": "bound-scan-key",
        "ITINV_BROWSER_PROBE_ENABLED": "1",
    }
    overrides = {
        "ITINV_AGENT_API_KEY": "ring-key",
        "SCAN_AGENT_API_KEY": "ring-key",
        "ITINV_BROWSER_PROBE_ENABLED": "0",
    }
    merged = agent_installer.build_runtime_env_values(existing, overrides)
    assert merged["ITINV_AGENT_API_KEY"] == "bound-inv-key"
    assert merged["SCAN_AGENT_API_KEY"] == "bound-scan-key"
    assert merged["ITINV_BROWSER_PROBE_ENABLED"] == "0"


def test_msi_key_applies_when_no_existing_key():
    merged = agent_installer.build_runtime_env_values(
        {}, {"SCAN_AGENT_API_KEY": "ring-key"}
    )
    assert merged["SCAN_AGENT_API_KEY"] == "ring-key"


def test_liveness_missing_and_fresh_not_stale(monkeypatch, tmp_path: Path):
    monkeypatch.setattr(
        agent_installer, "DEFAULT_BROWSER_PROBE_RUNTIME_ROOT", tmp_path
    )
    assert agent._browser_probe_liveness_stale() is False
    (tmp_path / "liveness.ts").write_text("1.0\n")
    assert agent._browser_probe_liveness_stale() is False


def test_liveness_old_mtime_is_stale(monkeypatch, tmp_path: Path):
    monkeypatch.setattr(
        agent_installer, "DEFAULT_BROWSER_PROBE_RUNTIME_ROOT", tmp_path
    )
    marker = tmp_path / "liveness.ts"
    marker.write_text("1.0\n")
    old = time.time() - agent._BROWSER_PROBE_LIVENESS_MAX_AGE_SEC - 60
    marker.touch()
    import os

    os.utime(marker, (old, old))
    assert agent._browser_probe_liveness_stale() is True


def test_watchdog_disabled_probe_is_noop(monkeypatch):
    calls = []
    monkeypatch.setenv("ITINV_BROWSER_PROBE_ENABLED", "0")
    monkeypatch.setattr(
        agent, "_run_probe_task", lambda *a: calls.append(a) or 0
    )
    assert agent._ensure_browser_probe_task(1000, last_check_ts=7) == 7
    assert calls == []


def test_watchdog_throttles_recent_check(monkeypatch):
    calls = []
    monkeypatch.setenv("ITINV_BROWSER_PROBE_ENABLED", "1")
    monkeypatch.setattr(agent, "_browser_probe_process_running", lambda: False)
    monkeypatch.setattr(
        agent, "_run_probe_task", lambda *a: calls.append(a) or 0
    )
    now = int(time.time())
    assert agent._ensure_browser_probe_task(now, last_check_ts=now - 60) == now - 60
    assert calls == []


def test_watchdog_runs_dead_probe(monkeypatch):
    calls = []
    monkeypatch.setenv("ITINV_BROWSER_PROBE_ENABLED", "1")
    monkeypatch.setattr(agent, "_browser_probe_process_running", lambda: False)
    monkeypatch.setattr(agent, "_browser_probe_liveness_stale", lambda: False)
    monkeypatch.setattr(
        agent, "_run_probe_task", lambda *a: calls.append(a) or 0
    )
    now = int(time.time())
    assert agent._ensure_browser_probe_task(now, last_check_ts=0) == now
    assert calls and calls[-1][1] == "/Run"
    assert not any(c[1] == "/End" for c in calls)


def test_watchdog_restarts_hung_probe(monkeypatch):
    calls = []
    monkeypatch.setenv("ITINV_BROWSER_PROBE_ENABLED", "1")
    monkeypatch.setattr(agent, "_browser_probe_process_running", lambda: True)
    monkeypatch.setattr(agent, "_browser_probe_liveness_stale", lambda: True)
    monkeypatch.setattr(
        agent, "_run_probe_task", lambda *a: calls.append(a) or 0
    )
    monkeypatch.setattr(agent.time, "sleep", lambda *_: None)
    now = int(time.time())
    assert agent._ensure_browser_probe_task(now, last_check_ts=0) == now
    verbs = [c[1] for c in calls]
    assert verbs == ["/End", "/Run"]


def test_watchdog_healthy_probe_not_touched(monkeypatch):
    calls = []
    monkeypatch.setenv("ITINV_BROWSER_PROBE_ENABLED", "1")
    monkeypatch.setattr(agent, "_browser_probe_process_running", lambda: True)
    monkeypatch.setattr(agent, "_browser_probe_liveness_stale", lambda: False)
    monkeypatch.setattr(
        agent, "_run_probe_task", lambda *a: calls.append(a) or 0
    )
    now = int(time.time())
    assert agent._ensure_browser_probe_task(now, last_check_ts=0) == now
    assert calls == []
