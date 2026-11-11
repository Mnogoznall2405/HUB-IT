from __future__ import annotations


def test_build_connection_snapshot_keeps_reserve_and_state_counts():
    from backend.chat.postgres_runtime_metrics import build_connection_snapshot

    snapshot = build_connection_snapshot(
        max_connections=100,
        state_counts={"active": 4, "idle": 61, "idle in transaction": 2},
        reserve_target=20,
    )

    assert snapshot["available"] is True
    assert snapshot["max_connections"] == 100
    assert snapshot["total_connections"] == 67
    assert snapshot["active_connections"] == 4
    assert snapshot["idle_connections"] == 61
    assert snapshot["available_connections"] == 33
    assert snapshot["reserve_target"] == 20
    assert snapshot["reserve_available"] is True


def test_build_connection_snapshot_reports_missing_reserve():
    from backend.chat.postgres_runtime_metrics import build_connection_snapshot

    snapshot = build_connection_snapshot(
        max_connections=100,
        state_counts={"active": 5, "idle": 80},
        reserve_target=20,
    )

    assert snapshot["available_connections"] == 15
    assert snapshot["reserve_available"] is False
    assert snapshot["reserve_shortfall"] == 5
