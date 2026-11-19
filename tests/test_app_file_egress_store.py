from __future__ import annotations

import os
import sys
from concurrent.futures import ThreadPoolExecutor
from datetime import datetime, timedelta
from pathlib import Path
from threading import Barrier

import pytest

ROOT = Path(__file__).resolve().parents[1]
WEB = ROOT / "WEB-itinvent"
sys.path.insert(0, str(ROOT))
sys.path.insert(0, str(WEB))


@pytest.fixture()
def app_db_url(tmp_path: Path, monkeypatch: pytest.MonkeyPatch):
    db_path = tmp_path / "app_egress.sqlite"
    url = f"sqlite:///{db_path.as_posix()}"
    monkeypatch.setenv("APP_DATABASE_URL", url)
    monkeypatch.delenv("DLP_MEDIA_STORAGE_DIR", raising=False)
    from backend.appdb import db as appdb_db
    from backend.config import config
    from backend.services import fs_egress_store_service as svc

    monkeypatch.setattr(config.app_db, "database_url", url)
    appdb_db._engines.clear()
    appdb_db._session_factories.clear()
    appdb_db._initialized_schema_urls.clear()
    clear_store_cache = svc.get_egress_store.cache_clear
    clear_store_cache()
    yield url
    clear_store_cache()
    appdb_db._engines.clear()
    appdb_db._session_factories.clear()
    appdb_db._initialized_schema_urls.clear()


def test_app_file_egress_roundtrip(app_db_url: str):
    from backend.appdb.file_egress_store import AppFileEgressStore

    store = AppFileEgressStore(database_url=app_db_url)
    n = store.ingest_file_left(
        [
            {
                "event_id": "pg1",
                "ts": 123,
                "channel": "usb",
                "file_name": "a.xlsx",
                "dest_path": r"E:\a.xlsx",
                "computer_name": "PC-PG",
                "windows_user": "ivan",
            }
        ]
    )
    assert n == 1
    rows = store.list_file_left(computer_name="PC-PG", channel="usb")
    assert len(rows) == 1
    assert rows[0]["file_name"] == "a.xlsx"

    store.upsert_telegram_chats(
        computer_name="PC-PG",
        windows_user="ivan",
        chats=[
            {
                "chat_id": "c1",
                "chat_name": "Коллега",
                "messages": [{"direction": "outgoing", "media": "Файл, x.docx", "text": ""}],
            }
        ],
    )
    chats = store.list_telegram_chats(computer_name="PC-PG")
    assert len(chats) == 1
    assert chats[0]["chat_name"] == "Коллега"

    store.save_report(computer_name="PC-PG", windows_user="ivan", html="<html>ok</html>")
    report = store.get_report("PC-PG")
    assert report and "ok" in report["html"]


def test_merge_messages_reorders_same_capture_by_bbox():
    from backend.appdb.file_egress_store import _merge_messages

    stamp = "2026-08-02T14:32:57+05:00"
    incoming = [
        {"msg_key": "new", "recorded_at": stamp, "bbox": [0, 1500, 10, 1600], "text": "later"},
        {"msg_key": "old", "recorded_at": stamp, "bbox": [0, -100, 10, 0], "text": "earlier"},
    ]
    merged = _merge_messages([], incoming)
    assert [m["text"] for m in merged] == ["earlier", "later"]
    # Re-ingest reversed order must still normalize.
    merged2 = _merge_messages(merged, list(reversed(incoming)))
    assert [m["text"] for m in merged2] == ["earlier", "later"]


@pytest.mark.parametrize("use_app_store", [True, False])
def test_browser_focus_upload_retries_do_not_count_time_twice(app_db_url, tmp_path, monkeypatch, use_app_store):
    from fastapi import FastAPI
    from fastapi.testclient import TestClient

    from backend.api.v1 import fs_egress
    from backend.appdb.file_egress_store import AppFileEgressStore
    from inventory_server.egress_store import EgressEventStore

    store = (
        AppFileEgressStore(database_url=app_db_url)
        if use_app_store
        else EgressEventStore(db_path=tmp_path / "fallback_egress.sqlite")
    )
    monkeypatch.setattr(fs_egress.store, "get_egress_store", lambda: store)
    monkeypatch.setenv("ITINV_AGENT_API_KEYS", "browser-fixture")
    app = FastAPI()
    app.include_router(fs_egress.router)
    focus = {
        "event_id": "capture-1",
        "browser": "chrome",
        "url": "https://example.com/work",
        "title": "Work",
        "ended_at": 1_700_000_000.25,
        "dwell_sec": 10,
    }
    legacy = {**focus, "ended_at": 1_700_000_001.25, "dwell_sec": 4}
    legacy.pop("event_id")

    def send(events):
        with TestClient(app, raise_server_exceptions=False) as client:
            return client.post(
                "/browser-probe",
                headers={"X-API-Key": "browser-fixture"},
                json={"computer_name": "PC-FOCUS", "windows_user": "alice", "focus_events": events},
            )

    # Force the batch to fail after claiming its first event. Both the claim
    # and the accumulated time must roll back.
    broken = send([focus, {**focus, "event_id": "broken", "ended_at": "NaN"}])
    assert broken.status_code == 500
    assert store.list_browser_visits(computer_name="PC-FOCUS") == []

    barrier = Barrier(2)

    def concurrent_upload(event):
        barrier.wait(timeout=5)
        return send([event])

    with ThreadPoolExecutor(max_workers=2) as executor:
        futures = [executor.submit(concurrent_upload, focus) for _ in range(2)]
        replies = [future.result(timeout=15) for future in futures]
    assert [reply.status_code for reply in replies] == [200, 200]
    assert sorted(reply.json()["visits"] for reply in replies) == [0, 1]

    later = send([focus, {**focus, "event_id": "capture-2"}, legacy, legacy])
    assert later.status_code == 200
    assert later.json()["visits"] == 2
    assert send([legacy]).json()["visits"] == 0

    with ThreadPoolExecutor(max_workers=2) as executor:
        futures = [
            executor.submit(concurrent_upload, {**focus, "event_id": event_id})
            for event_id in ("capture-3", "capture-4")
        ]
        replies = [future.result(timeout=15) for future in futures]
    assert [reply.status_code for reply in replies] == [200, 200]
    assert [reply.json()["visits"] for reply in replies] == [1, 1]
    rows = store.list_browser_visits(computer_name="PC-FOCUS")
    assert len(rows) == 1
    assert rows[0]["dwell_sec"] == 44


def _focus_event(**overrides):
    event = {
        "event_id": "seg-1",
        "browser": "edge",
        "url": "https://mail.example.com/owa",
        "title": "Почта",
        "ended_at": 1_700_000_000.0,
        "dwell_sec": 45.0,
        "idle_sec": 15.0,
        "session_dwell_sec": 45.0,
        "schema": 2,
    }
    event.update(overrides)
    return event


def test_browser_focus_schema2_splits_dwell_and_idle_once(app_db_url: str):
    from backend.appdb.file_egress_store import AppFileEgressStore

    store = AppFileEgressStore(database_url=app_db_url)
    event = _focus_event()
    assert store.ingest_browser_visits(
        computer_name="PC-IDLE", windows_user="alice", visits=[], focus_events=[event]
    ) == 1
    # Replay of the same event_id (upload retry) must not accumulate twice.
    assert store.ingest_browser_visits(
        computer_name="PC-IDLE", windows_user="alice", visits=[], focus_events=[event]
    ) == 0
    rows = store.list_browser_visits(computer_name="PC-IDLE")
    assert len(rows) == 1
    assert rows[0]["dwell_sec"] == pytest.approx(45.0)
    assert rows[0]["idle_sec"] == pytest.approx(15.0)


def test_browser_focus_legacy_event_is_capped_and_surplus_moves_to_idle(app_db_url: str):
    from backend.appdb.file_egress_store import AppFileEgressStore

    store = AppFileEgressStore(database_url=app_db_url)
    # Agent <1.4.19: no schema key, no idle split — a weekend-left tab.
    event = _focus_event(dwell_sec=340000.0)
    del event["idle_sec"], event["session_dwell_sec"], event["schema"]
    assert store.ingest_browser_visits(
        computer_name="PC-LEGACY", windows_user="alice", visits=[], focus_events=[event]
    ) == 1
    rows = store.list_browser_visits(computer_name="PC-LEGACY")
    assert len(rows) == 1
    assert rows[0]["dwell_sec"] == pytest.approx(1800.0)
    assert rows[0]["idle_sec"] == pytest.approx(340000.0 - 1800.0)


def test_browser_focus_day_bucket_uses_local_date(app_db_url: str):
    from backend.appdb.file_egress_store import AppFileEgressStore

    store = AppFileEgressStore(database_url=app_db_url)
    # Two events 2h apart across the server's local midnight. Under the old
    # UTC-date bucket both merged into one row on non-UTC servers; now each
    # local day keeps its own focus row.
    local_midnight = datetime.now().astimezone().replace(
        hour=0, minute=0, second=0, microsecond=0
    )
    events = [
        _focus_event(
            event_id="day-a",
            ended_at=(local_midnight - timedelta(hours=1)).timestamp(),
        ),
        _focus_event(
            event_id="day-b",
            ended_at=(local_midnight + timedelta(hours=1)).timestamp(),
        ),
    ]
    assert store.ingest_browser_visits(
        computer_name="PC-DAY", windows_user="alice", visits=[], focus_events=events
    ) == 2
    rows = store.list_browser_visits(computer_name="PC-DAY")
    assert len(rows) == 2
    # Each row carries only its own segment, not the other day's time.
    assert sorted(row["dwell_sec"] for row in rows) == [45.0, 45.0]


def test_browser_focus_segments_attach_session_dwell_to_history_row(app_db_url: str):
    from backend.appdb.file_egress_store import AppFileEgressStore

    store = AppFileEgressStore(database_url=app_db_url)
    url = "https://docs.example.com/readme"
    assert store.ingest_browser_visits(
        computer_name="PC-SESS",
        windows_user="alice",
        visits=[
            {
                "browser": "edge",
                "profile": "Default",
                "visit_id": "h1",
                "url": url,
                "title": "Readme",
                "visited_at": "2026-11-10T10:00:00+00:00",
            }
        ],
        focus_events=[],
    ) == 1
    # Agent 1.4.19: one focus session flushed as 60 s segments.
    events = [
        _focus_event(
            event_id=f"seg-{idx}", url=url, dwell_sec=60.0, idle_sec=0.0,
            session_dwell_sec=60.0 * idx, schema=2,
            ended_at=1_700_000_000.0 + 60 * idx,
        )
        for idx in (1, 2, 3)
    ]
    assert store.ingest_browser_visits(
        computer_name="PC-SESS", windows_user="alice", visits=[], focus_events=events
    ) == 3
    rows = store.list_browser_visits(computer_name="PC-SESS")
    history_rows = [row for row in rows if row["profile"] != "focus"]
    assert len(history_rows) == 1
    # The History row gets the whole session dwell (180 s), not the last 60 s segment.
    assert history_rows[0]["dwell_sec"] == pytest.approx(180.0)


def test_browser_focus_upload_updates_latest_matching_history(app_db_url: str, monkeypatch: pytest.MonkeyPatch):
    from fastapi import FastAPI
    from fastapi.testclient import TestClient
    from backend.api.v1 import fs_egress
    from backend.appdb.file_egress_store import AppFileEgressStore

    store = AppFileEgressStore(database_url=app_db_url)
    monkeypatch.setattr(fs_egress.store, "get_egress_store", lambda: store)
    monkeypatch.setenv("ITINV_AGENT_API_KEYS", "browser-fixture")
    app = FastAPI()
    app.include_router(fs_egress.router)
    url = "https://docs.example.invalid/work"
    other_url = "https://docs.example.invalid/other"
    histories = [
        ("old", "edge", url, "2026-11-10T10:00:00+00:00", 5.0),
        ("new", "edge", url, "2026-11-11T10:00:00+00:00", 10.0),
        ("no-time", "edge", url, None, 3.0),
        ("chrome", "chrome", url, "2026-11-12T10:00:00+00:00", 4.0),
        ("other-url", "edge", other_url, "2026-11-12T11:00:00+00:00", 7.0),
    ]
    visits = [
        {
            "browser": browser, "profile": "Default", "visit_id": visit_id,
            "url": visit_url, "title": "Work", "dwell_sec": dwell,
            **({"visited_at": visited_at} if visited_at else {}),
        }
        for visit_id, browser, visit_url, visited_at, dwell in histories
    ]
    with TestClient(app, raise_server_exceptions=False) as client:
        response = client.post(
            "/browser-probe", headers={"X-API-Key": "browser-fixture"},
            json={"computer_name": "PC-LATEST", "windows_user": "alice", "visits": visits},
        )
        assert response.status_code == 200
        focus = _focus_event(
            event_id="latest-only", browser="edge", url=url, title="Work",
            ended_at=datetime.fromisoformat("2026-11-13T10:00:00+00:00").timestamp(),
            dwell_sec=30.0, session_dwell_sec=80.0,
        )
        response = client.post(
            "/browser-probe", headers={"X-API-Key": "browser-fixture"},
            json={"computer_name": "PC-LATEST", "windows_user": "alice", "focus_events": [focus]},
        )
        assert response.status_code == 200
    actual = {
        row["visit_id"]: row["dwell_sec"]
        for row in store.list_browser_visits(computer_name="PC-LATEST")
        if row["profile"] != "focus"
    }
    assert actual == {"old": 5.0, "new": 80.0, "no-time": 3.0, "chrome": 4.0, "other-url": 7.0}


def test_browser_days_report_idle_dwell(app_db_url: str):
    from backend.appdb.file_egress_store import AppFileEgressStore

    store = AppFileEgressStore(database_url=app_db_url)
    events = [
        _focus_event(event_id="i1", dwell_sec=100.0, idle_sec=20.0),
        _focus_event(event_id="i2", dwell_sec=50.0, idle_sec=30.0),
    ]
    assert store.ingest_browser_visits(
        computer_name="PC-IDLESTAT", windows_user="alice", visits=[], focus_events=events
    ) == 2
    days = store.list_browser_days(computer_name="PC-IDLESTAT")
    assert len(days) == 1
    assert days[0]["idle_dwell"] == pytest.approx(50.0)
    # Idle stays out of the category dwell buckets.
    assert (
        days[0]["work_dwell"] + days[0]["entertainment_dwell"] + days[0]["other_dwell"]
        == pytest.approx(150.0)
    )


def test_browser_days_report_per_category(app_db_url: str):
    from backend.appdb.file_egress_store import AppFileEgressStore

    store = AppFileEgressStore(database_url=app_db_url)
    visits = [
        {
            "browser": "edge",
            "profile": "Default",
            "visit_id": "h-mail",
            "url": "https://mail.google.com/inbox",
            "title": "Inbox",
            "visited_at": "2026-11-10T10:00:00+00:00",
        },
        {
            "browser": "edge",
            "profile": "Default",
            "visit_id": "h-work",
            "url": "https://github.com/org/repo",
            "title": "Repo",
            "visited_at": "2026-11-10T11:00:00+00:00",
        },
    ]
    # Noon local keeps the same bucket date in any test-machine timezone.
    focus_ts = datetime(2026, 11, 10, 12, 0, 0).astimezone().timestamp()
    events = [
        _focus_event(
            event_id="cat-1",
            url="https://github.com/org/repo",
            title="Repo",
            dwell_sec=60.0,
            idle_sec=0.0,
            ended_at=focus_ts,
        ),
    ]
    assert store.ingest_browser_visits(
        computer_name="PC-CATS", windows_user="alice", visits=visits, focus_events=events
    ) == 3
    days = store.list_browser_days(computer_name="PC-CATS")
    assert len(days) == 1
    day = days[0]
    assert day["day"] == "2026-11-10"
    assert day["visits"] == 3
    cats = day["categories"]
    assert cats["mail"]["visits"] == 1
    assert cats["work"]["visits"] == 2
    assert cats["work"]["dwell"] == pytest.approx(60.0)
    # Classic buckets still roll up from the same rows.
    assert day["work"] == 2
    assert day["work_dwell"] == pytest.approx(60.0)
    assert day["other"] == 1
    assert day["other_dwell"] == pytest.approx(0.0)


def test_ingest_file_left_batches_and_dedupes(app_db_url: str):
    from backend.appdb.file_egress_store import AppFileEgressStore

    store = AppFileEgressStore(database_url=app_db_url)
    events = [
        {
            "event_id": "dup1",
            "ts": 1,
            "channel": "usb",
            "file_name": "a.docx",
            "computer_name": "PC-B",
        },
        {"event_id": "dup1", "ts": 2, "channel": "usb", "file_name": "b.docx", "computer_name": "PC-B"},
        {"event_id": "u2", "ts": 3, "channel": "network", "file_name": "c.pdf", "computer_name": "PC-B"},
    ]
    assert store.ingest_file_left(events) == 2
    assert store.ingest_file_left(events) == 0
    rows = store.list_file_left(computer_name="PC-B")
    assert len(rows) == 2


def test_ingest_file_left_keeps_repeat_delete_events(app_db_url: str):
    """Same-name deletions are distinct events: event_id is the only retry key.
    A repeat delete of the recreated file at the same path must stay."""
    from backend.appdb.file_egress_store import AppFileEgressStore

    store = AppFileEgressStore(database_url=app_db_url)
    events = [
        {
            "event_id": "del1",
            "ts": 100,
            "channel": "deleted",
            "file_name": "report.docx",
            "dest_path": r"C:\Users\a\Documents\report.docx",
            "computer_name": "PC-B",
        },
        {
            "event_id": "del2",
            "ts": 101,
            "channel": "deleted",
            "file_name": "report.docx",
            "dest_path": r"C:\Users\a\Desktop\report.docx",
            "computer_name": "PC-B",
        },
        {
            "event_id": "del3",
            "ts": 102,
            "channel": "deleted",
            "file_name": "report.docx",
            "dest_path": r"C:\Users\a\Documents\report.docx",
            "computer_name": "PC-B",
        },
    ]
    assert store.ingest_file_left(events) == 3
    rows = store.list_file_left(computer_name="PC-B", channel="deleted")
    assert len(rows) == 3
    assert store.ingest_file_left(events) == 0
    assert len(store.list_file_left(computer_name="PC-B", channel="deleted")) == 3


async def test_ingest_timeout_does_not_start_queued_store_later(monkeypatch):
    import asyncio
    import threading

    from fastapi import HTTPException

    from backend.api.v1 import fs_egress

    monkeypatch.setenv("ITINV_INGEST_MAX_CONCURRENCY", "1")
    monkeypatch.setattr(fs_egress, "_ingest_admission", None)
    monkeypatch.setattr(fs_egress, "_ingest_queue_admission", None, raising=False)
    monkeypatch.setattr(fs_egress, "_ingest_limiters", {})
    monkeypatch.setattr(fs_egress, "_ingest_timeout_sec", lambda: 0.1)
    gate = threading.Event()
    finished = threading.Event()
    calls = []

    def stalled():
        calls.append("first")
        try:
            gate.wait(5)
        finally:
            finished.set()

    try:
        with pytest.raises(HTTPException) as first:
            await fs_egress._run_ingest(stalled)
        assert first.value.status_code == 503
        with pytest.raises(HTTPException):
            await fs_egress._run_ingest(lambda: calls.append("expired"))
    finally:
        gate.set()
        assert await asyncio.to_thread(finished.wait, 2)
    await asyncio.sleep(0.05)
    await fs_egress._run_ingest(lambda: calls.append("new"))
    assert calls == ["first", "new"]


async def test_ingest_rejects_overflow_without_starting_more_workers(monkeypatch):
    import asyncio
    import threading

    from fastapi import HTTPException

    from backend.api.v1 import fs_egress

    monkeypatch.setenv("ITINV_INGEST_MAX_CONCURRENCY", "1")
    monkeypatch.setattr(fs_egress, "_ingest_admission", None)
    monkeypatch.setattr(fs_egress, "_ingest_queue_admission", None, raising=False)
    monkeypatch.setattr(fs_egress, "_ingest_limiters", {})
    gate = threading.Event()
    entered = threading.Event()
    calls = []

    def stalled():
        entered.set()
        gate.wait(5)
        calls.append("running")

    first = asyncio.create_task(fs_egress._run_ingest(stalled))
    queued = []
    try:
        assert await asyncio.to_thread(entered.wait, 2)
        queued = [
            asyncio.create_task(fs_egress._run_ingest(lambda: calls.append("queued")))
            for _ in range(2)
        ]
        await asyncio.sleep(0.05)
        with pytest.raises(HTTPException) as overflow:
            await asyncio.wait_for(fs_egress._run_ingest(lambda: calls.append("overflow")), 0.5)
        assert overflow.value.status_code == 503
        assert overflow.value.headers["Retry-After"] == "30"
    finally:
        gate.set()
        await asyncio.gather(first, *queued)
    assert calls == ["running", "queued", "queued"]


async def test_cancel_before_worker_start_releases_reserved_slot(monkeypatch):
    import asyncio

    from backend.api.v1 import fs_egress

    monkeypatch.setenv("ITINV_INGEST_MAX_CONCURRENCY", "1")
    monkeypatch.setattr(fs_egress, "_ingest_admission", None)
    monkeypatch.setattr(fs_egress, "_ingest_queue_admission", None)
    limiter = fs_egress.anyio.CapacityLimiter(1)
    monkeypatch.setattr(fs_egress, "_get_ingest_limiter", lambda: limiter)
    calls = []
    await limiter.acquire()
    task = asyncio.create_task(fs_egress._run_ingest(lambda: calls.append("cancelled")))
    try:
        async with asyncio.timeout(2):
            while not limiter.statistics().tasks_waiting:
                await asyncio.sleep(0)
        task.cancel()
        with pytest.raises(asyncio.CancelledError):
            await task
    finally:
        limiter.release()
        if not task.done():
            task.cancel()
            await asyncio.gather(task, return_exceptions=True)
    await asyncio.wait_for(fs_egress._run_ingest(lambda: calls.append("new")), 1)
    assert calls == ["new"]


async def test_ingest_limiter_serializes_store_calls(app_db_url: str, monkeypatch):
    import asyncio
    import threading

    import httpx
    from fastapi import FastAPI

    from backend.api.v1 import fs_egress
    from backend.appdb.file_egress_store import AppFileEgressStore

    store = AppFileEgressStore(database_url=app_db_url)
    # Schema creation is fixture setup, not part of the concurrent ingest deadline.
    await asyncio.to_thread(store.list_file_left)
    monkeypatch.setattr(fs_egress.store, "get_egress_store", lambda: store)
    monkeypatch.setenv("ITINV_AGENT_API_KEYS", "lim-key")
    monkeypatch.setenv("ITINV_INGEST_MAX_CONCURRENCY", "1")
    monkeypatch.setenv("ITINV_INGEST_TIMEOUT_SEC", "30")
    fs_egress._ingest_limiters.clear()
    fs_egress._ingest_admission = None
    fs_egress._ingest_queue_admission = None

    gate = threading.Event()
    entered = threading.Event()
    active = 0
    max_active = 0
    active_lock = threading.Lock()
    real_ingest = fs_egress.store.ingest_events

    def blocking_ingest(events):
        nonlocal active, max_active
        with active_lock:
            active += 1
            max_active = max(max_active, active)
        entered.set()
        gate.wait(timeout=20)
        with active_lock:
            active -= 1
        return real_ingest(events)

    monkeypatch.setattr(fs_egress.store, "ingest_events", blocking_ingest)
    app = FastAPI()
    app.include_router(fs_egress.router)

    async with httpx.AsyncClient(
        transport=httpx.ASGITransport(app=app), base_url="http://t"
    ) as client:

        async def post(idx):
            return await client.post(
                "/fs-egress",
                headers={"X-API-Key": "lim-key"},
                json={
                    "events": [
                        {
                            "event_id": f"e{idx}",
                            "ts": 1,
                            "channel": "usb",
                            "file_name": "a.bin",
                            "computer_name": "PC-L",
                        }
                    ]
                },
            )

        tasks = [asyncio.create_task(post(idx)) for idx in range(3)]
        assert await asyncio.to_thread(entered.wait, 15)
        await asyncio.sleep(0.5)  # let the remaining requests reach the limiter
        assert max_active == 1
        gate.set()
        replies = [await task for task in tasks]
    fs_egress._ingest_limiters.clear()
    fs_egress._ingest_admission = None
    assert [reply.status_code for reply in replies] == [200, 200, 200]
    assert max_active == 1
    assert {row["id"] for row in store.list_file_left()} == {"e0", "e1", "e2"}


async def test_ingest_timeout_returns_503(app_db_url: str, monkeypatch):
    import threading

    import httpx
    from fastapi import FastAPI

    from backend.api.v1 import fs_egress
    from backend.appdb.file_egress_store import AppFileEgressStore

    store = AppFileEgressStore(database_url=app_db_url)
    monkeypatch.setattr(fs_egress.store, "get_egress_store", lambda: store)
    monkeypatch.setenv("ITINV_AGENT_API_KEYS", "lim-key2")
    monkeypatch.setenv("ITINV_INGEST_TIMEOUT_SEC", "1")
    fs_egress._ingest_limiters.clear()
    fs_egress._ingest_admission = None

    never = threading.Event()

    def hanging_ingest(events):
        never.wait(timeout=30)
        return 0

    monkeypatch.setattr(fs_egress.store, "ingest_events", hanging_ingest)
    app = FastAPI()
    app.include_router(fs_egress.router)
    async with httpx.AsyncClient(
        transport=httpx.ASGITransport(app=app, raise_app_exceptions=False),
        base_url="http://t",
    ) as client:
        reply = await client.post(
            "/fs-egress",
            headers={"X-API-Key": "lim-key2"},
            json={"events": [{"event_id": "x", "ts": 1}]},
        )
    never.set()
    fs_egress._ingest_limiters.clear()
    fs_egress._ingest_admission = None
    assert reply.status_code == 503
    assert reply.headers.get("retry-after")


def test_browser_probe_media_batch_roundtrip(app_db_url: str, monkeypatch):
    import base64

    from fastapi import FastAPI
    from fastapi.testclient import TestClient

    from backend.api.v1 import fs_egress
    from backend.appdb.file_egress_store import AppFileEgressStore

    store = AppFileEgressStore(database_url=app_db_url)
    monkeypatch.setattr(fs_egress.store, "get_egress_store", lambda: store)
    monkeypatch.setenv("ITINV_AGENT_API_KEYS", "media-key")
    app = FastAPI()
    app.include_router(fs_egress.router)
    with TestClient(app) as client:
        reply = client.post(
            "/browser-probe",
            headers={"X-API-Key": "media-key"},
            json={
                "computer_name": "PC-M",
                "windows_user": "alice",
                "media": [
                    {
                        "name": "shot1.png",
                        "content_base64": base64.b64encode(b"png-one").decode(),
                        "content_type": "image/png",
                    },
                    {
                        "name": "shot2.png",
                        "content_base64": base64.b64encode(b"png-two").decode(),
                        "content_type": "image/png",
                    },
                ],
            },
        )
    assert reply.status_code == 200
    assert reply.json()["media"] == 2
    row = store.get_browser_media(computer_name="PC-M", file_name="shot2.png")
    assert row and row["content"] == b"png-two"


def test_web_service_prefers_postgres_when_configured(app_db_url: str):
    from backend.appdb.file_egress_store import AppFileEgressStore
    from backend.services.fs_egress_store_service import get_egress_store, ingest_events

    store = get_egress_store()
    assert isinstance(store, AppFileEgressStore)
    assert ingest_events(
        [
            {
                "event_id": "svc1",
                "ts": 1,
                "channel": "network",
                "file_name": "n.pdf",
                "dest_path": r"\\srv\share\n.pdf",
                "computer_name": "PC2",
            }
        ]
    ) == 1


def test_egress_store_does_not_silently_fall_back_to_sqlite(monkeypatch, tmp_path):
    """DINT-04: a PostgreSQL outage fails closed (and is retried), SQLite needs an explicit flag."""
    from backend.appdb import db as appdb_db
    from backend.services import fs_egress_store_service as svc

    svc.get_egress_store.cache_clear()
    monkeypatch.setattr(appdb_db, "is_app_database_configured", lambda: False)
    monkeypatch.delenv("FS_EGRESS_ALLOW_SQLITE_FALLBACK", raising=False)
    monkeypatch.setenv("FS_EGRESS_DB_PATH", str(tmp_path / "fallback.db"))

    with pytest.raises(svc.EgressStoreUnavailableError):
        svc.get_egress_store()
    assert not (tmp_path / "fallback.db").exists()

    monkeypatch.setenv("FS_EGRESS_ALLOW_SQLITE_FALLBACK", "1")
    assert svc.get_egress_store() is not None  # explicit dev/test policy; earlier failure not cached
    svc.get_egress_store.cache_clear()


def test_media_storage_ready_local_path(tmp_path):
    from backend.appdb import file_egress_store as store

    assert store.media_storage_ready(tmp_path) is True
    assert store.media_storage_ready(None) is False


def test_media_storage_write_unc_needs_share(monkeypatch):
    from backend.appdb import file_egress_store as store
    import backend.services.hubit_storage as hs

    unc = Path(r"\\hubit-test\share\dlp-media")

    calls = []
    monkeypatch.setattr(hs, "ensure_connected", lambda p: calls.append(str(p)) or str(p))
    assert store.media_storage_ready(unc) is True
    assert calls == [str(unc)]

    def _down(_path):
        raise OSError("share unreachable")

    monkeypatch.setattr(hs, "ensure_connected", _down)
    assert store.media_storage_ready(unc) is False
    # Share down -> no write attempted, caller falls back to bytea
    assert store._media_storage_write(unc, "browser_probe_media", "a.png", b"x", "image/png") is None

def test_file_left_same_event_id_reingest_is_idempotent(app_db_url: str):
    """Watcher drop + sync drop + server re-extract share one event_id → one row."""
    from backend.appdb.file_egress_store import AppFileEgressStore

    store = AppFileEgressStore(database_url=app_db_url)
    event = {
        "event_id": "tg-ivan_ab12-k1",
        "ts": 100,
        "channel": "telegram",
        "file_name": "dogovor.docx",
        "dest_path": "telegram:Иван",
        "src_path": r"C:\Users\u\Desktop\dogovor.docx",
        "computer_name": "PC-TG",
        "windows_user": "u",
        "details": {"send_state": "sent", "source": "uia_outgoing", "chat_name": "Иван"},
    }
    assert store.ingest_file_left([event]) == 1
    assert store.ingest_file_left([dict(event)]) == 0
    rows = store.list_file_left(computer_name="PC-TG", channel="telegram")
    assert len(rows) == 1


def test_grouped_file_left_keeps_send_state_details(app_db_url: str):
    from backend.appdb.file_egress_store import AppFileEgressStore

    store = AppFileEgressStore(database_url=app_db_url)
    store.ingest_file_left(
        [
            {
                "event_id": "tg-a",
                "ts": 100,
                "channel": "telegram",
                "file_name": "doc.docx",
                "dest_path": "telegram:Иван",
                "computer_name": "PC-TG",
                "details": {"send_state": "sent", "chat_name": "Иван", "source": "uia_outgoing"},
            },
            {
                "event_id": "tg-b",
                "ts": 200,
                "channel": "telegram",
                "file_name": "doc.docx",
                "dest_path": "telegram:Иван",
                "computer_name": "PC-TG",
                "details": {"send_state": "sent", "chat_name": "Иван", "source": "uia_outgoing"},
            },
        ]
    )
    rows = store.list_file_left(computer_name="PC-TG", channel="telegram", group=True)
    assert len(rows) == 1
    assert rows[0]["count"] == 2
    assert rows[0]["details"]["send_state"] == "sent"
    assert rows[0]["details"]["chat_name"] == "Иван"


def test_ingest_max_payload_extracts_real_file_and_is_idempotent(app_db_url: str):
    from backend.services import fs_egress_store_service as svc

    payload = {
        "computer_name": "PC-MAX",
        "windows_user": "u",
        "chats": [
            {
                "chat_id": "c1",
                "chat_name": "Иван",
                "messages": [
                    {
                        "direction": "outgoing",
                        "sender": "Я",
                        "time": "в 10:00",
                        "text": "Файл: report.docx",
                    }
                ],
            }
        ],
    }
    first = svc.ingest_max_payload(payload)
    assert first["egress"] == 1
    svc.ingest_max_payload(payload)
    store = svc.get_egress_store()
    rows = store.list_file_left(computer_name="PC-MAX", channel="max")
    assert len(rows) == 1
    assert rows[0]["file_name"] == "report.docx"
    assert rows[0]["details"]["send_state"] == "sent"
    assert rows[0]["details"]["source"] == "uia_outgoing"

def test_list_file_left_filters_by_send_state(app_db_url: str):
    from backend.appdb.file_egress_store import AppFileEgressStore

    store = AppFileEgressStore(database_url=app_db_url)
    base = {
        "ts": 100,
        "channel": "telegram",
        "dest_path": "telegram:Иван",
        "computer_name": "PC-SS",
        "windows_user": "u",
    }
    store.ingest_file_left(
        [
            dict(base, event_id="ss-1", file_name="a.docx",
                 details={"send_state": "sent"}),
            dict(base, event_id="ss-2", file_name="b.docx",
                 details={"send_state": "selected"}),
            dict(base, event_id="ss-3", file_name="c.docx", details={}),
        ]
    )
    rows = store.list_file_left(computer_name="PC-SS", send_state="sent")
    assert [r["file_name"] for r in rows] == ["a.docx"]
    assert len(store.list_file_left(computer_name="PC-SS")) == 3
    # Unknown/empty state values never crash the filter and match everything.
    assert len(store.list_file_left(computer_name="PC-SS", send_state="bogus")) == 3


def test_dlp_host_stats_splits_send_state(app_db_url: str):
    from backend.appdb.file_egress_store import AppFileEgressStore

    store = AppFileEgressStore(database_url=app_db_url)
    base = {"ts": 100, "computer_name": "PC-STAT", "windows_user": "u"}
    store.ingest_file_left(
        [
            dict(base, event_id="st-1", channel="telegram", file_name="a.docx",
                 details={"send_state": "sent"}),
            dict(base, event_id="st-2", channel="telegram", file_name="b.docx",
                 details={"send_state": "selected"}),
            dict(base, event_id="st-3", channel="browser", file_name="c.pdf",
                 details={"send_state": "observed"}),
        ]
    )
    hosts = {h["computer_name"]: h for h in store.list_dlp_host_stats()}
    row = hosts["PC-STAT"]
    assert row["telegram_events"] == 2
    assert row["telegram_sent"] == 1
    assert row["browser_events"] == 1
    assert row["max_sent"] == 0
