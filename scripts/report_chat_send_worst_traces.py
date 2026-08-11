"""Print worst per-send ACK traces from debug-20cb37.log with derived stage waits."""
from __future__ import annotations

import argparse
import json
from collections import defaultdict
from pathlib import Path

PROJECT_ROOT = Path(__file__).resolve().parents[1]
DEBUG_LOG = PROJECT_ROOT / "debug-20cb37.log"

DERIVED = (
    ("executor_queue_wait", "write_job_submitted", "write_job_started"),
    ("db_pool_wait", "db_checkout_started", "db_checkout_finished"),
    ("seq_update_total", "seq_update_started", "seq_update_finished"),
    ("insert_total", "message_insert_started", "message_insert_finished"),
    ("pre_commit_gap", "message_insert_finished", "commit_started"),
    ("commit_total", "commit_started", "commit_finished"),
    ("commit_to_ack_enqueue", "commit_finished", "sender_ack_enqueued"),
    ("ack_queue_and_socket", "sender_ack_enqueued", "sender_ack_socket_write_finished"),
)


def _load_traces(path: Path) -> dict[str, list[dict]]:
    by_trace: dict[str, list[dict]] = defaultdict(list)
    if not path.exists():
        return {}
    for line in path.read_text(encoding="utf-8", errors="replace").splitlines():
        try:
            row = json.loads(line)
        except Exception:
            continue
        data = row.get("data") or {}
        trace_id = str(data.get("trace_id") or "").strip()
        stage = str(data.get("stage") or "").strip()
        if not trace_id or not stage or trace_id in {"pool", "stage", "legacy_session"}:
            continue
        by_trace[trace_id].append(
            {
                "stage": stage,
                "elapsed_ms": float(data.get("elapsed_ms") or 0.0),
                "wall_ts_ms": data.get("wall_ts_ms") or row.get("timestamp"),
                "chat_id": data.get("chat_id") or data.get("conversation_id"),
                "message_id": data.get("message_id"),
                "raw": data,
            }
        )
    return by_trace


def _stage_map(events: list[dict]) -> dict[str, dict]:
    out: dict[str, dict] = {}
    for event in events:
        out[str(event["stage"])] = event
    return out


def _ack_total(events: list[dict]) -> float | None:
    stages = _stage_map(events)
    if "total_until_ack" in stages:
        return float(stages["total_until_ack"]["elapsed_ms"])
    return None


def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("--log", default=str(DEBUG_LOG))
    parser.add_argument("--top", type=int, default=10)
    args = parser.parse_args()
    traces = _load_traces(Path(args.log))
    ranked = []
    for trace_id, events in traces.items():
        total = _ack_total(events)
        if total is None:
            continue
        ranked.append((total, trace_id, events))
    ranked.sort(key=lambda item: item[0], reverse=True)

    for total, trace_id, events in ranked[: max(1, int(args.top))]:
        stages = _stage_map(events)
        print("=" * 72)
        print(f"trace_id={trace_id} total_until_ack_ms={total:.1f}")
        print(f"chat_id={stages.get('ws_frame_received', stages.get('websocket_received', {})).get('chat_id')}")
        print(f"message_id={stages.get('commit_finished', stages.get('commit', {})).get('message_id')}")
        present = sorted(stages.keys())
        print(f"stages_present={len(present)}")
        missing = [
            name
            for name in (
                "ws_frame_received",
                "write_job_submitted",
                "write_job_started",
                "seq_update_started",
                "seq_update_finished",
                "message_insert_started",
                "message_insert_finished",
                "commit_started",
                "commit_finished",
                "sender_ack_enqueued",
                "sender_ack_socket_write_finished",
            )
            if name not in stages
        ]
        if missing:
            print(f"missing_timestamps={missing}")
        print("timeline:")
        for event in sorted(events, key=lambda e: (float(e.get("wall_ts_ms") or 0), e["stage"])):
            print(f"  {event['stage']}: elapsed_ms={event['elapsed_ms']:.1f} wall={event.get('wall_ts_ms')}")
        print("derived:")
        for name, start, end in DERIVED:
            if start in stages and end in stages and stages[start].get("wall_ts_ms") and stages[end].get("wall_ts_ms"):
                gap = float(stages[end]["wall_ts_ms"]) - float(stages[start]["wall_ts_ms"])
                print(f"  {name}: ~{gap:.1f} ms (wall)")
            elif name.replace("_", "") and name in stages:
                print(f"  {name}: {stages[name]['elapsed_ms']:.1f} ms (direct)")
            elif end in stages:
                print(f"  {name}: {stages[end]['elapsed_ms']:.1f} ms (via {end})")
            else:
                print(f"  {name}: n/a")
        # Prefer direct duration stages when present.
        for direct in (
            "executor_queue_wait",
            "seq_update_total",
            "insert_total",
            "pre_commit_gap",
            "commit_total",
            "write_pool_wait",
        ):
            if direct in stages:
                print(f"  direct {direct}: {stages[direct]['elapsed_ms']:.1f} ms")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
