from __future__ import annotations

import os
import sys
from concurrent.futures import ThreadPoolExecutor
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
