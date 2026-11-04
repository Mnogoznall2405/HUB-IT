"""Tests for inventory ops_health and rare software inventory scheduling."""

from __future__ import annotations

import json
from pathlib import Path
from types import SimpleNamespace

import agent as inventory_agent


def test_build_ops_health_low_disk_and_system_drive(monkeypatch, tmp_path: Path):
    monkeypatch.setenv("SystemDrive", "C:")
    monkeypatch.setattr(inventory_agent, "PROGRAM_DATA_AGENT_ROOT", tmp_path / "Agent")
    monkeypatch.setattr(inventory_agent, "LEGACY_PROGRAM_DATA_ROOT", tmp_path / "IT-Invent")
    monkeypatch.setattr(inventory_agent, "_load_reboot_reminder_state", lambda: {"last_sent_at": 123})
    monkeypatch.setattr(
        inventory_agent,
        "get_pending_reboot_info",
        lambda: {"pending_reboot": True, "pending_reboot_reasons": ["cbs_reboot_pending"]},
    )

    health = inventory_agent.build_ops_health(
        [
            {
                "device": "C:",
                "mountpoint": "C:\\",
                "free_gb": 2.5,
                "percent": 90.0,
            }
        ]
    )
    assert health["low_disk"] is True
    assert health["system_drive_free_gb"] == 2.5
    assert health["pending_reboot"] is True
    assert health["pending_reboot_reasons"] == ["cbs_reboot_pending"]
    assert health["last_reboot_reminder_at"] == 123
    assert health["agent_task_name"] == "HUB-IT Agent"
    assert health["legacy_itinvent_present"] is False


def test_software_inventory_due_respects_interval(monkeypatch, tmp_path: Path):
    state_path = tmp_path / "software_inventory_state.json"
    monkeypatch.setattr(inventory_agent, "_software_inventory_state_path", lambda: state_path)
    monkeypatch.setenv("ITINV_SOFTWARE_INVENTORY_INTERVAL_HOURS", "24")

    assert inventory_agent._software_inventory_due(1_000_000) is True
    state_path.write_text(json.dumps({"collected_at": 1_000_000 - 100}), encoding="utf-8")
    assert inventory_agent._software_inventory_due(1_000_000) is False
    assert inventory_agent._software_inventory_due(1_000_000 + 24 * 3600) is True

    monkeypatch.setenv("ITINV_SOFTWARE_INVENTORY_INTERVAL_HOURS", "0")
    assert inventory_agent._software_inventory_due(1_000_000 + 10**9) is False


def test_failed_dead_letter_write_keeps_the_pending_inventory_report(monkeypatch, tmp_path: Path):
    """DINV-01: the only unacknowledged report must survive a failing dead-letter write."""
    pending_dir = tmp_path / "queue" / "pending"
    dead_dir = tmp_path / "queue" / "dead"
    pending_dir.mkdir(parents=True)
    dead_dir.mkdir(parents=True)
    monkeypatch.setattr(inventory_agent, "get_inventory_queue_dead_dir", lambda: dead_dir)
    report = pending_dir / "0000000001_report.json"
    report.write_text(json.dumps({"id": "r1", "payload": {"mac": "AA"}}), encoding="utf-8")
    original = report.read_bytes()

    real_write = inventory_agent._inventory_queue_write

    def disk_full(path, payload):
        raise OSError(28, "No space left on device")

    monkeypatch.setattr(inventory_agent, "_inventory_queue_write", disk_full)
    assert inventory_agent._inventory_queue_move_to_dead(report, {"id": "r1"}, "QUEUE_MAX_AGE") is False
    assert report.read_bytes() == original

    monkeypatch.setattr(inventory_agent, "_inventory_queue_write", real_write)
    assert inventory_agent._inventory_queue_move_to_dead(report, {"id": "r1"}, "QUEUE_MAX_AGE") is True
    assert not report.exists()
    assert len(list(dead_dir.glob("*.json"))) == 1


def test_inventory_post_requires_the_server_ack_before_the_report_is_dropped(monkeypatch):
    """DINV-02: HTTP 200 from a proxy page or an error JSON is not an acknowledgement."""
    class Reply:
        status_code = 200

        def __init__(self, body):
            self._body = body

        def raise_for_status(self):
            return None

        def json(self):
            if isinstance(self._body, Exception):
                raise self._body
            return self._body

    config = SimpleNamespace(server_url="https://hub.test/api/v1/inventory", api_key="k", timeout=1, ca_bundle=None)
    monkeypatch.setattr(inventory_agent.time, "sleep", lambda _seconds: None)
    monkeypatch.setattr(inventory_agent, "_requests_verify_arg", lambda _config: True)

    for body in (ValueError("<html>proxy</html>"), {"success": False}, ["not", "an", "object"]):
        monkeypatch.setattr(inventory_agent.requests, "post", lambda *a, _body=body, **k: Reply(_body))
        assert inventory_agent._post_payload({"mac": "AA"}, config) is False
    monkeypatch.setattr(inventory_agent.requests, "post", lambda *a, **k: Reply({"success": True, "inserted": 1}))
    assert inventory_agent._post_payload({"mac": "AA"}, config) is True
