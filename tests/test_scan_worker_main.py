from __future__ import annotations

import threading
import time

import scan_server.worker_main as worker_main


def test_wait_for_singleton_lock_times_out_when_lock_is_busy(monkeypatch, tmp_path):
    attempts = 0

    def busy_lock(_lock_path):
        nonlocal attempts
        attempts += 1
        return None

    monkeypatch.setattr(worker_main, "_acquire_singleton_lock", busy_lock)

    started_at = time.monotonic()
    result = worker_main._wait_for_singleton_lock(
        tmp_path / "scan_worker.lock",
        threading.Event(),
        timeout_sec=0.02,
        poll_interval_sec=0.005,
    )

    assert result is None
    assert attempts >= 1
    assert time.monotonic() - started_at < 0.5
