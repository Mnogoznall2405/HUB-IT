"""Two-process node helper for tests/test_pg_a8_gate.py (not collected).

Usage:
    python tests/pg_relay_node_helper.py <role> <db_url> <out_jsonl> [args]

Roles:
    a <count> <tag> <sleep_ms>      publisher  — writes a probe row + publishes
    b [listen|kill_listener] <sec>  subscriber — logs each delivered event and
                                    re-reads the probe table post-commit
Both are real OS processes holding real psycopg connections (LISTEN/NOTIFY).
"""
import asyncio
import json
import sys
import time
from pathlib import Path

PROJECT_ROOT = Path(__file__).resolve().parents[1]
WEB_ROOT = PROJECT_ROOT / "WEB-itinvent"
if str(WEB_ROOT) not in sys.path:
    sys.path.insert(0, str(WEB_ROOT))

from sqlalchemy.engine import make_url  # noqa: E402
import psycopg  # noqa: E402
from backend.chat.postgres_realtime import ChatRealtimePostgresBus  # noqa: E402

PROBE_TABLE = "chat.a8_probe_events"  # scratch-only, created by the test


def _write_probe_row(db_url: str, seq: int) -> None:
    conninfo = make_url(db_url).set(drivername="postgresql").render_as_string(hide_password=False)
    with psycopg.connect(conninfo, autocommit=True) as conn:
        conn.execute(
            f"INSERT INTO {PROBE_TABLE} (seq, payload) VALUES (%s, %s)",
            (int(seq), f"probe-{seq}"),
        )


def _count_probe_rows(db_url: str) -> int:
    conninfo = make_url(db_url).set(drivername="postgresql").render_as_string(hide_password=False)
    with psycopg.connect(conninfo, autocommit=True) as conn:
        row = conn.execute(f"SELECT count(*) FROM {PROBE_TABLE}").fetchone()
    return int(row[0] or 0)


class _Manager:
    def __init__(self, out, db_url):
        self.out = out
        self.db_url = db_url

    async def handle_distributed_event(self, payload):
        """Delivery path + post-commit cross-node read check."""
        recv = time.perf_counter()
        t0 = time.perf_counter()
        try:
            row_count = _count_probe_rows(self.db_url)
            db_err = ""
        except Exception as exc:  # pragma: no cover - diagnostic only
            row_count = -1
            db_err = type(exc).__name__
        self.out.write(json.dumps({
            "recv": recv,
            "db_read_ms": round((time.perf_counter() - t0) * 1000, 1),
            "db_rows": row_count,
            "db_err": db_err,
            "payload": payload,
        }) + "\n")
        self.out.flush()


async def _node_b(db_url, out_path, mode, run_sec):
    out = open(out_path, "a", encoding="utf-8")
    bus = ChatRealtimePostgresBus(_Manager(out, db_url), database_url=db_url, node_id="node-b")
    await bus.start()
    deadline = time.monotonic() + 10
    while not bus.subscriber_ready and time.monotonic() < deadline:
        await asyncio.sleep(0.05)
    if not bus.subscriber_ready:
        out.write(json.dumps({"fatal": "subscriber_not_ready"}) + "\n")
        out.flush()
        return
    out.write(json.dumps({"ready": True}) + "\n")
    out.flush()
    killed = False
    stop_after = time.monotonic() + float(run_sec)
    while time.monotonic() < stop_after:
        await asyncio.sleep(0.05)
        if mode == "kill_listener" and not killed:
            seen = sum(1 for r in open(out_path, encoding="utf-8") if '"payload"' in r)
            if seen >= 1:
                try:
                    if bus._listener_conn is not None:
                        bus._listener_conn.close()
                except Exception:
                    pass
                killed = True
                out.write(json.dumps({"listener_killed": True, "at": time.perf_counter()}) + "\n")
                out.flush()
    await bus.stop()
    await asyncio.sleep(0.3)


async def _node_a(db_url, out_path, count, tag, sleep_ms, seq_base="0"):
    out = open(out_path, "a", encoding="utf-8")
    bus = ChatRealtimePostgresBus(
        _Manager(out, db_url), database_url=db_url, node_id="node-a", subscriber_enabled=False
    )
    await bus.start()
    base = int(seq_base)
    for i in range(int(count)):
        sent = time.perf_counter()
        _write_probe_row(db_url, base + i)  # real commit BEFORE the event — REST-read analogue
        ok = await bus.publish(
            {"type": "chat.message.created", "tag": tag, "seq": i, "sent": sent,
             "conversation_id": "conv-probe-1", "origin": "node-a"},
            durable=True,
        )
        out.write(json.dumps({"published": i, "sent": sent, "ok": ok, "tag": tag}) + "\n")
        out.flush()
        if float(sleep_ms):
            await asyncio.sleep(float(sleep_ms) / 1000.0)
    await bus.stop()
    await asyncio.sleep(0.2)


if __name__ == "__main__":
    role, db_url, out_path = sys.argv[1], sys.argv[2], sys.argv[3]
    if role == "a":
        asyncio.run(_node_a(db_url, out_path, sys.argv[4], sys.argv[5],
                            sys.argv[6] if len(sys.argv) > 6 else "0",
                            sys.argv[7] if len(sys.argv) > 7 else "0"))
    elif role == "b":
        asyncio.run(_node_b(db_url, out_path, sys.argv[4] if len(sys.argv) > 4 else "listen",
                            sys.argv[5] if len(sys.argv) > 5 else "15"))
