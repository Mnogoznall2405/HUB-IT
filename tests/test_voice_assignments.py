"""Assignment statuses keyed by stable item key (sqlite stand-in for schema ``voice``)."""
from __future__ import annotations

import importlib.util
import json
import os
from pathlib import Path
from types import SimpleNamespace

import pytest
from sqlalchemy import create_engine, event, inspect, text

os.environ.setdefault(
    "VOICE_DATABASE_URL", "postgresql+psycopg://test:test@127.0.0.1:5432/test_voice"
)

from voice_server import pipeline, store  # noqa: E402
from voice_server.models import Base  # noqa: E402

ROOT = Path(__file__).resolve().parents[1]
HEAD = "| № | Время | Поручение | Ответственный | Срок |\n|---|---|---|---|---|\n"


def _sqlite(tmp_path):
    engine = create_engine(f"sqlite:///{tmp_path / 'main.db'}")
    voice_file = tmp_path / "voice.db"

    @event.listens_for(engine, "connect")
    def _attach(dbapi_conn, _record):
        dbapi_conn.execute(f"ATTACH DATABASE '{voice_file}' AS voice")

    return engine


@pytest.fixture()
def env(tmp_path, monkeypatch):
    engine = _sqlite(tmp_path)
    Base.metadata.create_all(engine)
    monkeypatch.setattr(store, "_engine", lambda: engine)
    root = tmp_path / "voice_video"
    (root / "output").mkdir(parents=True)
    monkeypatch.setattr(pipeline, "config", SimpleNamespace(voicevideo_root=root))
    yield SimpleNamespace(engine=engine, root=root)
    engine.dispose()


def _meeting(root, base, rows):
    mdir = root / "output" / base
    mdir.mkdir(exist_ok=True)
    (mdir / f"{base}_transcript.json").write_text("{}", encoding="utf-8")
    (mdir / f"{base}_report.json").write_text(
        json.dumps({"action_registry": HEAD + rows}, ensure_ascii=False), encoding="utf-8"
    )


def _legacy_row(engine, base, num, status="done"):
    with engine.begin() as conn:
        conn.execute(
            text(
                "INSERT INTO voice.voice_assignment_statuses "
                "(id, base_filename, num, status, comment, created_at, updated_at) "
                "VALUES (:id, :b, :n, :s, '', '2026-09-28', '2026-09-28')"
            ),
            {"id": f"legacy{num}", "b": base, "n": num, "s": status},
        )


def test_status_follows_assignment_after_registry_regeneration(env):
    _meeting(env.root, "m1", "| 1 | 01:00 | Подписать ДС | Иванов | — |\n| 2 | 02:00 | Направить отчёт | Петров | — |\n")
    items = pipeline.meeting_assignments("m1")
    store.upsert_assignment_status("m1", key=items[1]["key"], num="2", status="done", marked_by="u")

    # Regeneration swaps the order: "Направить отчёт" is now row 1.
    _meeting(env.root, "m1", "| 1 | 01:30 | Направить отчёт | Петров | — |\n| 2 | 02:30 | Подписать ДС | Иванов | — |\n")
    regenerated = {i["key"]: i for i in pipeline.meeting_assignments("m1")}
    rows = store.get_assignment_statuses("m1")
    assert len(rows) == 1
    assert regenerated[rows[0]["item_key"]]["task"] == "Направить отчёт"


def test_task_id_is_kept_by_later_status_updates(env):
    store.upsert_assignment_status("m2", key="a" * 16, num="1", status="pending", task_id="T-7")
    res = store.upsert_assignment_status("m2", key="a" * 16, num="3", status="done", comment="ok")
    assert res["task_id"] == "T-7"
    row = store.get_assignment_statuses("m2")[0]
    assert (row["status"], row["num"], row["task_id"]) == ("done", "3", "T-7")


def test_backfill_pins_legacy_rows_once_and_never_steals_keys(env):
    _meeting(env.root, "m3", "| 1 | 01:00 | A | x | — |\n| 2 | 02:00 | B | y | — |\n| 3 | 03:00 | C | z | — |\n")
    items = pipeline.meeting_assignments("m3")
    _legacy_row(env.engine, "m3", "1")
    _legacy_row(env.engine, "m3", "2")
    # Row 2 already has a keyed status -> the legacy one must not take its key.
    store.upsert_assignment_status("m3", key=items[1]["key"], num="2", status="in_progress")
    assert store.backfill_assignment_keys("m3", items) == 1
    assert store.backfill_assignment_keys("m3", items) == 0  # idempotent
    by_key = {r["item_key"]: r for r in store.get_assignment_statuses("m3") if r["item_key"]}
    assert by_key[items[0]["key"]]["status"] == "done"
    assert by_key[items[1]["key"]]["status"] == "in_progress"


@pytest.fixture()
def api(env, monkeypatch):
    from fastapi.testclient import TestClient

    from voice_server import app as app_module, auth

    monkeypatch.setattr(auth, "_fetch_web_user", lambda *a, **k: {"id": 1, "role": "admin", "username": "boss"})
    client = TestClient(app_module.app)
    client.headers["Authorization"] = "Bearer t"
    return client


def test_api_statuses_by_key_and_legacy_clients(api, env):
    _meeting(env.root, "m4", "| 1 | 01:00 | A | x | — |\n| 2 | 02:00 | B | y | — |\n")
    _legacy_row(env.engine, "m4", "2")
    items = api.get("/api/v1/voice/meetings/m4/assignments").json()["items"]

    statuses = api.get("/api/v1/voice/meetings/m4/assignments/status").json()["items"]
    assert [(s["key"], s["status"]) for s in statuses] == [(items[1]["key"], "done")]

    # New client: key + task link.
    resp = api.put(
        "/api/v1/voice/meetings/m4/assignments/status",
        json={"num": "1", "key": items[0]["key"], "status": "pending", "task_id": "42"},
    )
    assert resp.status_code == 200 and resp.json()["task_id"] == "42"
    # Old client (cached bundle): number only -> resolved against the current registry.
    resp = api.put("/api/v1/voice/meetings/m4/assignments/status", json={"num": "1", "status": "done"})
    assert resp.status_code == 200
    assert resp.json()["key"] == items[0]["key"] and resp.json()["task_id"] == "42"
    assert api.put(
        "/api/v1/voice/meetings/m4/assignments/status", json={"num": "9", "status": "done"}
    ).status_code == 422
    assert api.put(
        "/api/v1/voice/meetings/m4/assignments/status", json={"num": "1", "key": "bad", "status": "done"}
    ).status_code == 422


def _migration(name):
    path = next((ROOT / "voice_server" / "alembic" / "versions").glob(f"*_{name}.py"))
    spec = importlib.util.spec_from_file_location(path.stem, path)
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module


def test_migration_0006_upgrade_and_downgrade(tmp_path):
    from alembic.migration import MigrationContext
    from alembic.operations import Operations

    engine = _sqlite(tmp_path)

    def run(fn):
        with engine.begin() as conn:
            with Operations.context(MigrationContext.configure(conn)):
                fn()

    # Table as left by 0004 (its ALTER-based unique constraint is PostgreSQL-only).
    with engine.begin() as conn:
        conn.execute(text(
            "CREATE TABLE voice.voice_assignment_statuses ("
            " id VARCHAR(36) PRIMARY KEY, base_filename VARCHAR(512) NOT NULL,"
            " num VARCHAR(16) NOT NULL, status VARCHAR(16) NOT NULL DEFAULT 'pending',"
            " comment TEXT, marked_by VARCHAR(256), created_at TIMESTAMP, updated_at TIMESTAMP,"
            " CONSTRAINT uq_voice_assignment_statuses_base_num UNIQUE (base_filename, num))"
        ))
    _legacy_row(engine, "m", "1")
    mig = _migration("voice_assignment_keys")
    run(mig.upgrade)
    run(mig.upgrade)  # idempotent
    insp = inspect(engine)
    cols = {c["name"] for c in insp.get_columns("voice_assignment_statuses", schema="voice")}
    assert {"item_key", "task_id"} <= cols
    assert not any(u["name"] == "uq_voice_assignment_statuses_base_num"
                   for u in insp.get_unique_constraints("voice_assignment_statuses", schema="voice"))
    # Same number twice is now allowed (legacy + keyed row).
    with engine.begin() as conn:
        conn.execute(text(
            "INSERT INTO voice.voice_assignment_statuses "
            "(id, base_filename, num, item_key, status, created_at, updated_at) "
            "VALUES ('k1', 'm', '1', 'abcdabcdabcdabcd', 'pending', '2026-10-02', '2026-10-02')"
        ))
    run(mig.downgrade)
    with engine.connect() as conn:
        assert conn.execute(text("SELECT COUNT(*) FROM voice.voice_assignment_statuses")).scalar() == 1
    cols = {c["name"] for c in inspect(engine).get_columns("voice_assignment_statuses", schema="voice")}
    assert "item_key" not in cols
