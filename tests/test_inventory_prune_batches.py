"""Audit 10/06 P1-5: pruning old inventory change events works in bounded batches."""
from __future__ import annotations

import sys
from pathlib import Path

WEB_ROOT = Path(__file__).resolve().parents[1] / "WEB-itinvent"
if str(WEB_ROOT) not in sys.path:
    sys.path.insert(0, str(WEB_ROOT))

from backend.appdb.inventory_store import AppInventoryStore  # noqa: E402


def _event(i: int, detected_at: int) -> dict:
    return {
        "event_id": f"evt-{i}",
        "mac_address": "AA:BB:CC:DD:EE:FF",
        "hostname": "pc",
        "detected_at": detected_at,
        "change_types": [],
        "diff": {},
    }


def test_prune_removes_old_events_one_batch_at_a_time_and_keeps_fresh_ones(temp_dir):
    store = AppInventoryStore(database_url=f"sqlite:///{(Path(temp_dir) / 'inv.db').as_posix()}")
    for i in range(7):
        store.append_change_event(_event(i, 100 + i))  # old
    for i in range(7, 10):
        store.append_change_event(_event(i, 10_000 + i))  # fresh

    assert store.prune_change_events(1_000, batch_size=3) == 3  # one bounded batch, not the whole backlog
    assert store.prune_change_events(1_000, batch_size=3) == 3
    assert store.prune_change_events(1_000, batch_size=3) == 1
    assert store.prune_change_events(1_000, batch_size=3) == 0
    assert {e["event_id"] for e in store.list_change_events()} == {"evt-7", "evt-8", "evt-9"}
