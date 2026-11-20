from __future__ import annotations

import importlib
from pathlib import Path
from types import SimpleNamespace

import pytest

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


@pytest.mark.parametrize("module_name", ["agent", "itinvent_agent.agent"])
def test_inventory_cycles_keep_scan_without_starting_legacy_dlp(monkeypatch, module_name):
    # Windows process/task scheduling needs an isolated harness, not live endpoint E2E.
    monkeypatch.syspath_prepend(str(Path(__file__).resolve().parents[1] / "agent" / "src"))
    module = importlib.import_module(module_name)
    for flag in (
        "ITINV_FS_EGRESS_ENABLED", "ITINV_TELEGRAM_PROBE_ENABLED",
        "ITINV_MAX_PROBE_ENABLED", "ITINV_BROWSER_PROBE_ENABLED", "ITINV_BROWSER_HISTORY_ENABLED",
    ):
        monkeypatch.setenv(flag, "1")
    monkeypatch.setenv("ITINV_SCAN_ENABLED", "1")
    monkeypatch.setenv("ITINV_AGENT_API_KEY", "test-inventory")
    started = []
    scan_calls = []
    sent = []
    commands = []
    now = [1000]

    class EndLoop(Exception):
        pass

    def scan(run_once=False):
        scan_calls.append(run_once)

    class Thread:
        def __init__(self, *, target, name, **kwargs):
            self.target, self.name = target, name
            self.kwargs = kwargs.get("kwargs", {})

        def start(self):
            started.append(self.name)
            if self.target is scan:
                self.target(**self.kwargs)

        def is_alive(self):
            return True

    def sleep(seconds):
        now[0] += seconds
        if len(sent) == 2:
            raise EndLoop

    def collect_inventory(**kwargs):
        return {**kwargs, "sidecars": module.collect_sidecar_health()}

    def send(payload, config):
        sent.append(payload)
        return True

    monkeypatch.setattr(module, "threading", SimpleNamespace(Thread=Thread))
    monkeypatch.setattr(module, "time", SimpleNamespace(time=lambda: now[0], sleep=sleep))
    monkeypatch.setattr(module, "subprocess", SimpleNamespace(
        run=lambda *args, **kwargs: commands.append(args) or SimpleNamespace(returncode=1, stdout="", stderr=""),
    ))
    monkeypatch.setattr(module, "_SIDECAR_THREADS", {})
    monkeypatch.setattr(module, "_run_scan_sidecar", scan)
    monkeypatch.setattr(module, "collect_inventory", collect_inventory)
    monkeypatch.setattr(module, "send_data", send)
    monkeypatch.setattr(module, "maybe_notify_reboot_required", lambda *_: None)
    monkeypatch.setattr(module, "_write_agent_status", lambda *_: None)
    monkeypatch.setattr(module, "_inventory_queue_depth", lambda: 0)
    monkeypatch.setattr(module, "_scan_outbox_depth", lambda: 0)
    monkeypatch.setattr(module, "_read_scan_last_ingest_ok_at", lambda: None)

    with pytest.raises(EndLoop):
        module.run_loop(module.load_config())

    assert started == ["scan-sidecar"]
    assert scan_calls == [False]
    assert commands == []
    assert [payload["report_type"] for payload in sent] == ["full_snapshot", "heartbeat"]
    for payload in sent:
        assert payload["sidecars"]["scan"]["alive"] is True
        assert payload["sidecars"]["fs_egress"] == {"enabled": False, "alive": False}
        assert payload["sidecars"]["telegram_probe"] == {"enabled": False, "running": False}
        assert payload["sidecars"]["browser_probe"]["enabled"] is False


def test_failed_task_removal_is_not_reported_as_a_successful_upgrade(monkeypatch):
    def denied(*args):
        raise PermissionError("Task Scheduler denied access")

    monkeypatch.setattr(agent_installer, "resolve_script_path", lambda name: Path(name))
    monkeypatch.setattr(agent_installer, "_run_powershell_script", denied)
    with pytest.raises(PermissionError, match="Task Scheduler"):
        agent_installer._remove_probe_task(agent_installer.BROWSER_PROBE_TASK_NAME, SimpleNamespace(info=lambda *_: None))
