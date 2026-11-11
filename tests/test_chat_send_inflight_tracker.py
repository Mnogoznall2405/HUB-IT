from __future__ import annotations

from backend.chat.send_inflight_tracker import (
    lock_convoy_snapshot,
    note_send_finished,
    note_send_queued,
    note_send_stage,
    note_send_started,
)


def test_lock_convoy_ratio_detects_shared_conversation():
    for i in range(6):
        tid = f"t{i}"
        note_send_queued(trace_id=tid, conversation_id="conv-a" if i < 4 else f"conv-{i}")
        note_send_started(trace_id=tid, conversation_id="conv-a" if i < 4 else f"conv-{i}")
        note_send_stage(trace_id=tid, stage="seq_update_started", seq_update_elapsed_ms=12.0)
    snap = lock_convoy_snapshot(top_n=5)
    assert snap["active_sends"] == 6
    assert snap["unique_active_conversations"] == 3
    assert snap["active_send_per_conversation"] >= 2.0
    assert snap["top_conversations_by_active"][0]["conversation_id"] == "conv-a"
    for i in range(6):
        note_send_finished(trace_id=f"t{i}")
    assert lock_convoy_snapshot()["active_sends"] == 0
