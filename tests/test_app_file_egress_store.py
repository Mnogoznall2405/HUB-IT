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


async def test_ingest_limiter_serializes_store_calls(app_db_url: str, monkeypatch):
    import asyncio
    import threading

    import httpx
    from fastapi import FastAPI

    from backend.api.v1 import fs_egress
    from backend.appdb.file_egress_store import AppFileEgressStore

    store = AppFileEgressStore(database_url=app_db_url)
    monkeypatch.setattr(fs_egress.store, "get_egress_store", lambda: store)
    monkeypatch.setenv("ITINV_AGENT_API_KEYS", "lim-key")
    monkeypatch.setenv("ITINV_INGEST_MAX_CONCURRENCY", "1")
    monkeypatch.setenv("ITINV_INGEST_TIMEOUT_SEC", "30")
    fs_egress._ingest_limiters.clear()
    fs_egress._ingest_admission = None

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
