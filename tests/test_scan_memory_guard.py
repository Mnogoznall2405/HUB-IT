from __future__ import annotations

from scan_server.memory_guard import memory_pressure_active


def test_memory_pressure_disabled_when_limit_zero(monkeypatch):
    monkeypatch.setattr(
        "scan_server.memory_guard.get_process_rss_bytes",
        lambda pid=None: 10 * 1024 * 1024 * 1024,
    )
    assert memory_pressure_active(limit_mb=0) is False


def test_memory_pressure_active_when_over_limit(monkeypatch):
    monkeypatch.setattr(
        "scan_server.memory_guard.get_process_rss_bytes",
        lambda pid=None: 7 * 1024 * 1024 * 1024,
    )
    assert memory_pressure_active(limit_mb=6144) is True
