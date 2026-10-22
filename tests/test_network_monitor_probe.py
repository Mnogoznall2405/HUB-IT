"""Process failures must never become fabricated network packet loss."""
import subprocess

import pytest

from backend.services import network_monitor_probe as probe


@pytest.mark.parametrize("replies", [0, 2, 3])
def test_process_timeout_preserves_evidence_but_never_invents_loss(monkeypatch, replies):
    output = b"\n".join([b"Reply from 192.0.2.1: bytes=32 time=7ms TTL=61"] * replies)

    def timeout(*args, **kwargs):
        raise subprocess.TimeoutExpired(args[0], 5, output=output)

    monkeypatch.setattr(probe.subprocess, "run", timeout)
    result = probe._ping("192.0.2.1")
    assert result["status"] == ("online" if replies else "unknown")
    assert result["loss_pct"] is None
    assert result["error"] == "collector_timeout"
    assert result["received"] == replies


def test_completed_probe_can_confirm_real_network_loss(monkeypatch):
    monkeypatch.setattr(probe.subprocess, "run", lambda *args, **kwargs: subprocess.CompletedProcess(args[0], 1, stdout=b"Request timed out.\n" * 3))
    result = probe._ping("192.0.2.1")
    assert result["status"] == "offline" and result["loss_pct"] == 100
    assert result["sent"] == 3 and result["received"] == 0
