from __future__ import annotations

from backend.services import auth_session_metrics as metrics


def test_auth_session_metrics_note_and_snapshot():
    metrics.reset()
    metrics.note("refresh_success", network_zone="internal")
    metrics.note_session_expired("expired_idle", network_zone="internal")
    metrics.note("client_auth_required", detail="api_401", path="/chat/conversations")

    snap = metrics.snapshot()
    assert snap["counters"]["refresh_success"] == 1
    assert snap["counters"]["session_expired_idle"] == 1
    assert snap["counters"]["client_auth_required"] == 1
    assert snap["recent"]
    assert snap["recent"][0]["name"] == "client_auth_required"


def test_auth_session_metrics_reset_clears_counters():
    metrics.reset()
    metrics.note("refresh_revoked_jti")
    metrics.reset()
    snap = metrics.snapshot()
    assert snap["counters"]["refresh_revoked_jti"] == 0
    assert snap["recent"] == []
