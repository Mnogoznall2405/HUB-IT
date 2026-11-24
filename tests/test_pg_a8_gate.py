"""A8 production gate on a real isolated PostgreSQL (reproducible from HEAD).

Gated on env `AI_RUN_TEST_DATABASE_URL` (must be postgresql://...) — same
convention as tests/test_ai_run_serialization_pg.py. All work happens on
scratch databases named ``a8t_*`` created on the fly; nothing touches the
database named in the URL itself beyond admin CREATE/DROP DATABASE.

Coverage (Cycle-4 gate):
  * fresh schema from scratch, scope=all / app / chat
  * migration 0176 -> 0177 on existing data
  * repeat-run idempotency
  * rollback compatibility (old-code INSERT shape)
  * two real OS processes Chat A / Chat B via LISTEN/NOTIFY:
      - cross-node delivery < 1s
      - post-commit cross-node DB read on the receiver node
      - LISTEN reconnect mid-stream
      - restart contract (in-memory cursor, no history replay)
"""
from __future__ import annotations

import json
import os
import subprocess
import sys
import tempfile
import time
import uuid
from pathlib import Path
from urllib.parse import urlsplit, urlunsplit

import pytest
import sqlalchemy as sa
from sqlalchemy.engine import make_url

psycopg = pytest.importorskip("psycopg")

TEST_URL = os.environ.get("AI_RUN_TEST_DATABASE_URL", "").strip()
if not (TEST_URL.startswith("postgresql://") or TEST_URL.startswith("postgresql+")):
    pytest.skip("AI_RUN_TEST_DATABASE_URL not set to a postgresql:// URL", allow_module_level=True)

PROJECT_ROOT = Path(__file__).resolve().parents[1]
WEB_ROOT = PROJECT_ROOT / "WEB-itinvent"
if str(WEB_ROOT) not in sys.path:
    sys.path.insert(0, str(WEB_ROOT))

os.environ.setdefault("APP_ENV", "development")
os.environ.setdefault("JWT_SECRET_KEY", "pg-gate-test")
os.environ.setdefault("SKIP_PG_SCHEMA_DOCS", "1")

NODE_HELPER = PROJECT_ROOT / "tests" / "pg_relay_node_helper.py"


def _admin_conninfo() -> str:
    """libpq conninfo for the maintenance 'postgres' database."""
    url = make_url(TEST_URL)
    return url.set(drivername="postgresql", database="postgres").render_as_string(hide_password=False)


def _db_url(name: str) -> str:
    url = make_url(TEST_URL)
    return url.set(database=name).render_as_string(hide_password=False)


def _create_db(name: str) -> None:
    with psycopg.connect(_admin_conninfo(), autocommit=True) as conn:
        conn.execute(f'DROP DATABASE IF EXISTS "{name}"')
        conn.execute(f'CREATE DATABASE "{name}"')


def _drop_db(name: str) -> None:
    try:
        with psycopg.connect(_admin_conninfo(), autocommit=True) as conn:
            conn.execute(f'DROP DATABASE IF EXISTS "{name}"')
    except Exception:
        pass


def _cols(db_url: str, table: str, schema: str) -> set[str]:
    eng = sa.create_engine(db_url)
    with eng.connect() as c:
        return {r[0] for r in c.execute(sa.text(
            "select column_name from information_schema.columns "
            "where table_schema=:s and table_name=:t"),
            {"s": schema, "t": table})}


def _tables(db_url: str, schema: str) -> set[str]:
    eng = sa.create_engine(db_url)
    with eng.connect() as c:
        return {r[0] for r in c.execute(sa.text(
            "select table_name from information_schema.tables where table_schema=:s"),
            {"s": schema})}


@pytest.fixture(scope="module")
def scratch_prefix():
    return f"a8t_{uuid.uuid4().hex[:6]}"

# ------------------------- migration gate -------------------------


def test_migration_gate(scratch_prefix):
    from backend.db_migrations import upgrade_internal_database

    d_all = f"{scratch_prefix}_all"
    d_app = f"{scratch_prefix}_app"
    d_chat = f"{scratch_prefix}_chat"
    d_mig = f"{scratch_prefix}_mig"
    for d in (d_all, d_app, d_chat, d_mig):
        _create_db(d)
    try:
        # fresh schema from scratch, scope=all
        upgrade_internal_database(_db_url(d_all), "head")
        conv_cols = _cols(_db_url(d_all), "ai_bot_conversations", "app")
        run_cols = _cols(_db_url(d_all), "ai_bot_runs", "app")
        assert {"rolling_summary_llm", "summary_llm_until_seq", "last_run_seq"} <= conv_cols
        assert "queue_seq" in run_cols

        # scope=app / scope=chat
        upgrade_internal_database(_db_url(d_app), "head", scope="app")
        assert "ai_bot_conversations" in _tables(_db_url(d_app), "app")
        upgrade_internal_database(_db_url(d_chat), "head", scope="chat")
        assert "ai_bot_conversations" not in _tables(_db_url(d_chat), "app")
        assert _tables(_db_url(d_chat), "chat")

        # 0176 -> 0177 on existing data
        upgrade_internal_database(_db_url(d_mig), "20261118_0176")
        eng = sa.create_engine(_db_url(d_mig))
        with eng.begin() as c:
            c.execute(sa.text(
                "insert into app.ai_bot_conversations (conversation_id, user_id, bot_id, "
                "rolling_summary, summary_until_seq, context_reset_seq, use_personal_memory, "
                "title_source, created_at, updated_at) values "
                "('legacy-1', 42, 'b1', 'OLD', 15, 0, true, 'assistant', now(), now())"))
        upgrade_internal_database(_db_url(d_mig), "head")
        with eng.connect() as c:
            row = c.execute(sa.text(
                "select rolling_summary, summary_until_seq, summary_llm_until_seq "
                "from app.ai_bot_conversations where conversation_id='legacy-1'")).first()
        assert row == ("OLD", 15, 0)

        # repeat-run idempotent
        upgrade_internal_database(_db_url(d_all), "head")

        # rollback compatibility: old-code INSERT shape works on the new schema
        with eng.begin() as c:
            c.execute(sa.text(
                "insert into app.ai_bot_conversations (conversation_id, user_id, bot_id, "
                "rolling_summary, summary_until_seq, context_reset_seq, use_personal_memory, "
                "title_source, created_at, updated_at) values "
                "('rollback-1', 7, 'b1', 'X', 0, 0, true, 'assistant', now(), now())"))
    finally:
        for d in (d_all, d_app, d_chat, d_mig):
            _drop_db(d)


# ------------------------- two-process relay -------------------------


def _spawn(role: str, db_url: str, out: Path, *args):
    err = open(out.with_suffix(".err"), "ab")
    proc = subprocess.Popen(
        [sys.executable, str(NODE_HELPER), role, db_url, str(out), *map(str, args)],
        stdout=subprocess.DEVNULL, stderr=err,
    )
    proc._a8_err = err
    return proc


def _rows(path: Path):
    if not path.exists():
        return []
    out = []
    for line in path.read_text(encoding="utf-8").splitlines():
        line = line.strip()
        if line:
            try:
                out.append(json.loads(line))
            except Exception:
                pass
    return out


def _wait(path: Path, predicate, timeout: float) -> bool:
    t0 = time.monotonic()
    while time.monotonic() - t0 < timeout:
        if any(predicate(r) for r in _rows(path)):
            return True
        time.sleep(0.1)
    return False


def test_two_process_relay(scratch_prefix, tmp_path):
    d = f"{scratch_prefix}_rt"
    _create_db(d)
    db_url = _db_url(d)
    try:
        from backend.db_migrations import upgrade_internal_database
        upgrade_internal_database(db_url, "head", scope="chat")
        # scratch probe table (committed before each event — REST-read analogue)
        with psycopg.connect(
                make_url(db_url).set(drivername="postgresql").render_as_string(hide_password=False),
                autocommit=True) as conn:
            conn.execute("CREATE TABLE chat.a8_probe_events (seq int primary key, payload text)")

        b_out, a_out = tmp_path / "b.jsonl", tmp_path / "a.jsonl"

        # scenario 1: normal delivery + post-commit read on node B
        b = _spawn("b", db_url, b_out, "listen", 12)
        assert _wait(b_out, lambda r: r.get("ready"), 15)
        a = _spawn("a", db_url, a_out, 10, "normal")
        a.wait(timeout=30)
        assert _wait(b_out, lambda r: r.get("payload", {}).get("seq") == 9, 8)
        rows = [r for r in _rows(b_out) if r.get("payload", {}).get("tag") == "normal"]
        lat = [r["recv"] - r["payload"]["sent"] for r in rows]
        b.wait(timeout=25)
        assert len(lat) == 10 and max(lat) < 1.0, f"delivery latencies {lat}"
        # post-commit cross-node read: every delivered event saw the probe row
        reads = [r["db_rows"] for r in rows if "db_rows" in r]
        assert reads and min(reads) >= 1, f"post-commit reads {reads}"

        # scenario 2: restart contract — no history replay on fresh start
        a = _spawn("a", db_url, a_out, 3, "offline", 0, 1000)
        a.wait(timeout=30)
        time.sleep(0.5)
        b = _spawn("b", db_url, b_out, "listen", 8)
        assert _wait(b_out, lambda r: r.get("ready"), 15)
        time.sleep(2.0)
        leaked = [r for r in _rows(b_out) if r.get("payload", {}).get("tag") == "offline"]
        b.wait(timeout=20)
        assert not leaked, f"replayed {len(leaked)} pre-restart rows"

        # scenario 3: LISTEN reconnect mid-stream
        b = _spawn("b", db_url, b_out, "kill_listener", 14)
        assert _wait(b_out, lambda r: r.get("ready"), 15)
        a = _spawn("a", db_url, a_out, 6, "reconnect", 400, 2000)
        a.wait(timeout=40)
        assert _wait(b_out, lambda r: r.get("listener_killed"), 10)
        assert _wait(b_out, lambda r: r.get("payload", {}).get("seq", -1) >= 4
                     and r["payload"].get("tag") == "reconnect", 15)
        b.wait(timeout=25)
    finally:
        _drop_db(d)
