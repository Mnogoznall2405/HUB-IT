from __future__ import annotations

import threading
import time

import pytest

import scan_server.__main__ as scan_main
from scan_server.config import ScanServerConfig


def test_scan_server_requires_explicit_api_key_in_production(monkeypatch):
    monkeypatch.setenv("APP_ENV", "production")
    monkeypatch.setenv("SCAN_SERVER_API_KEYS", "")
    monkeypatch.setenv("SCAN_SERVER_API_KEY", "")

    with pytest.raises(RuntimeError, match="SCAN_SERVER_API_KEYS"):
        ScanServerConfig.from_env()


def test_wait_for_singleton_lock_times_out_when_api_lock_is_busy(monkeypatch, tmp_path):
    attempts = 0

    def busy_lock(_lock_path):
        nonlocal attempts
        attempts += 1
        return None

    monkeypatch.setattr(scan_main, "_acquire_singleton_lock", busy_lock)

    started_at = time.monotonic()
    result = scan_main._wait_for_singleton_lock(
        tmp_path / "scan_server.lock",
        threading.Event(),
        timeout_sec=0.02,
        poll_interval_sec=0.005,
    )

    assert result is None
    assert attempts >= 1
    assert time.monotonic() - started_at < 0.5
