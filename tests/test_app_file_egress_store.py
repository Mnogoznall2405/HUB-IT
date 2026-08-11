from __future__ import annotations

import os
import sys
from pathlib import Path

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
    svc.get_egress_store.cache_clear()
    yield url
    svc.get_egress_store.cache_clear()
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
