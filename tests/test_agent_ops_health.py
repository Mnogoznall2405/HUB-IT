"""Tests for inventory ops_health and rare software inventory scheduling."""

from __future__ import annotations

import json
from pathlib import Path

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
