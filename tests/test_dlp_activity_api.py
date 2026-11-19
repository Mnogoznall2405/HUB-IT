"""Boundary tests: /dlp/activity + /dlp/attention + sargable browser day filter."""
from __future__ import annotations

import sys
from datetime import datetime, timedelta
from pathlib import Path
from types import SimpleNamespace

import pytest

ROOT = Path(__file__).resolve().parents[1]
WEB = ROOT / "WEB-itinvent"
sys.path.insert(0, str(ROOT))
sys.path.insert(0, str(WEB))


@pytest.fixture()
def app_db_url(tmp_path: Path, monkeypatch: pytest.MonkeyPatch):
    db_path = tmp_path / "app_dlp_activity.sqlite"
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


@pytest.fixture()
def client(app_db_url: str, monkeypatch: pytest.MonkeyPatch):
    from fastapi import FastAPI
    from fastapi.testclient import TestClient

    from backend.api import deps
    from backend.api.v1 import fs_egress
    from backend.appdb.file_egress_store import AppFileEgressStore

    store = AppFileEgressStore(database_url=app_db_url)
    monkeypatch.setattr(fs_egress.store, "get_egress_store", lambda: store)
    monkeypatch.setenv("ITINV_AGENT_API_KEYS", "activity-key")
    app = FastAPI()
    app.dependency_overrides[deps.get_current_admin_user] = lambda: SimpleNamespace(id=1)
    app.include_router(fs_egress.router)
    with TestClient(app) as test_client:
        yield test_client


def _local_day() -> tuple[str, datetime]:
    day_start = datetime.now().astimezone().replace(hour=0, minute=0, second=0, microsecond=0)
    return day_start.strftime("%Y-%m-%d"), day_start


def _anchor(hours_back: float = 2) -> datetime:
    """Timestamp guaranteed in the past, so ingest never trips the
    >10-minutes-future drop whatever wall-clock time the test runs at."""
    return (datetime.now().astimezone() - timedelta(hours=hours_back)).replace(second=0, microsecond=0)


def _bucket(day_start: datetime, minutes: int, **values) -> dict:
    start = day_start + timedelta(minutes=minutes)
    start = start.replace(minute=(start.minute // 5) * 5, second=0, microsecond=0)
    row = {
        "bucket_start": start.isoformat(),
        "active_sec": 180.0,
        "passive_sec": 60.0,
        "away_sec": 30.0,
        "locked_sec": 0.0,
        "apps": {"1cv8.exe": 150.0, "msedge.exe": 90.0},
    }
    row.update(values)
    return row


def _post_probe(client, **payload) -> dict:
    body = {"computer_name": "PC-ACT", "windows_user": "alice"}
    body.update(payload)
    resp = client.post("/browser-probe", headers={"X-API-Key": "activity-key"}, json=body)
    assert resp.status_code == 200, resp.text
    return resp.json()


def test_activity_ingest_and_activity_endpoint_roundtrip(client):
    day, day_start = _local_day()
    result = _post_probe(
        client,
        activity=[
            _bucket(
                day_start, 60,
                active_sec=200, passive_sec=60, away_sec=0, locked_sec=0,
                apps={"1cv8.exe": 150.0, "msedge.exe": 90.0},
            ),
            _bucket(
                day_start, 65,
                active_sec=0, passive_sec=0, away_sec=240, locked_sec=30,
                apps={"msedge.exe": 40.0},
            ),
        ],
    )
    assert result["activity"] == 2

    resp = client.get("/dlp/activity", params={"computer_name": "PC-ACT", "day": day})
    assert resp.status_code == 200, resp.text
    data = resp.json()
    assert data["success"] is True
    assert len(data["buckets"]) == 2
    summary = data["summary"]
    assert summary["active_sec"] == pytest.approx(200.0)
    assert summary["away_sec"] == pytest.approx(240.0)
    assert summary["locked_sec"] == pytest.approx(30.0)
    assert summary["first_ts"] is not None
    assert summary["last_ts"] is not None
    assert summary["activity_pct"] == pytest.approx(200.0 / 500.0 * 100.0, abs=0.2)
    apps = {row["app"]: row["sec"] for row in data["apps_top"]}
    assert apps.get("1cv8.exe") == pytest.approx(150.0)


def test_activity_reingest_overwrites_not_sums(client):
    day, day_start = _local_day()
    bucket = _bucket(day_start, 120, active_sec=100, passive_sec=0, away_sec=0)
    _post_probe(client, activity=[bucket])
    _post_probe(client, activity=[{**bucket, "active_sec": 250.0}])

    data = client.get(
        "/dlp/activity", params={"computer_name": "PC-ACT", "day": day}
    ).json()
    assert len(data["buckets"]) == 1
    assert data["buckets"][0]["active_sec"] == pytest.approx(250.0)


def test_activity_ingest_clamps_and_drops_garbage(client):
    anchor = _anchor()
    day = anchor.strftime("%Y-%m-%d")
    day_start = anchor.replace(hour=0, minute=0)
    minutes = anchor.hour * 60 + anchor.minute
    # "good" may slide a bucket into the previous day near midnight — only
    # "oversized" is read back below, so the drop count is unaffected.
    good = _bucket(day_start, minutes - 5)
    oversized = _bucket(day_start, minutes, active_sec=900, passive_sec=300, away_sec=0)
    future = _bucket(day_start + timedelta(days=1), 60)
    stale = {
        **_bucket(day_start, 60),
        "bucket_start": (day_start - timedelta(days=30)).isoformat(),
    }
    result = _post_probe(
        client,
        activity=[good, oversized, future, stale, {"active_sec": 10}, "junk"],
    )
    assert result["activity"] == 2  # good + clamped oversized

    data = client.get(
        "/dlp/activity", params={"computer_name": "PC-ACT", "day": day}
    ).json()
    by_start = {b["bucket_start"]: b for b in data["buckets"]}
    big = by_start[oversized["bucket_start"]]
    total = big["active_sec"] + big["passive_sec"] + big["away_sec"] + big["locked_sec"]
    assert total <= 330.0
    assert big["active_sec"] > big["passive_sec"]  # scaled proportionally


def test_dlp_attention_aggregates_two_hosts_and_skips_empty(client):
    # All timestamps share one anchor instant so the whole scenario stays on
    # the same day and past the ingest future-guard at any wall-clock time.
    anchor = _anchor(hours_back=3)
    day = anchor.strftime("%Y-%m-%d")
    day_start = anchor.replace(hour=0, minute=0)
    ts_now = int(anchor.timestamp())

    # PC-A: activity + focus work/entertainment + usb (+service-file noise) + telegram.
    _post_probe(
        client,
        computer_name="PC-A",
        activity=[
            _bucket(day_start, anchor.hour * 60 + anchor.minute, active_sec=240, passive_sec=0, away_sec=60)
        ],
        focus_events=[
            {
                "event_id": "fa1", "browser": "chrome", "schema": 2,
                "url": "https://youtube.com/x", "title": "Video",
                "ended_at": ts_now, "dwell_sec": 90, "idle_sec": 30,
            },
        ],
        visits=[
            {
                "browser": "chrome", "profile": "focus", "visit_id": "va1",
                "url": "https://jira.example.com/a", "title": "Jira",
                "category": "work",
                "visited_at": anchor.isoformat(),
                "dwell_sec": 120,
            },
        ],
    )
    client.post(
        "/fs-egress",
        headers={"X-API-Key": "activity-key"},
        json={
            "events": [
                {
                    "event_id": "e1", "ts": ts_now, "channel": "usb",
                    "file_name": "report.docx", "size": 2048,
                    "computer_name": "PC-A",
                },
                {
                    "event_id": "e2", "ts": ts_now, "channel": "usb",
                    "file_name": "~$report.docx", "size": 512,
                    "computer_name": "PC-A",
                },
                {
                    "event_id": "e3", "ts": ts_now, "channel": "telegram",
                    "file_name": "photo.jpg", "size": 99,
                    "computer_name": "PC-A",
                },
            ]
        },
    ).raise_for_status()
    # PC-B: usb only. PC-C: ingests nothing → must not appear.
    client.post(
        "/fs-egress",
        headers={"X-API-Key": "activity-key"},
        json={
            "events": [
                {
                    "event_id": "e4", "ts": ts_now, "channel": "usb",
                    "file_name": "x.zip", "computer_name": "PC-B",
                },
            ]
        },
    ).raise_for_status()

    resp = client.get("/dlp/attention", params={"day": day})
    assert resp.status_code == 200, resp.text
    hosts = {row["computer_name"]: row for row in resp.json()["hosts"]}
    assert set(hosts) == {"PC-A", "PC-B"}
    a = hosts["PC-A"]
    assert a["active_sec"] == pytest.approx(240.0)
    assert a["away_sec"] == pytest.approx(60.0)
    assert a["work_sec"] == pytest.approx(120.0)
    assert a["entertainment_sec"] == pytest.approx(90.0)
    assert a["browser_idle_sec"] == pytest.approx(30.0)
    assert a["usb_files"] == 1  # ~$ temp name excluded
    assert a["usb_bytes"] == 2048
    assert a["messenger_files"] == 1
    assert a["first_ts"] is not None
    assert hosts["PC-B"]["usb_files"] == 1


def test_browser_day_filter_matches_local_day_range(client):
    day, day_start = _local_day()
    inside = (day_start + timedelta(minutes=30)).isoformat()
    before = (day_start - timedelta(minutes=1)).isoformat()
    _post_probe(
        client,
        visits=[
            {
                "browser": "edge", "profile": "Default", "visit_id": "in",
                "url": "https://a.example/", "title": "A", "visited_at": inside,
            },
            {
                "browser": "edge", "profile": "Default", "visit_id": "out",
                "url": "https://b.example/", "title": "B", "visited_at": before,
            },
        ],
    )
    rows = client.get(
        "/browser-probe", params={"computer_name": "PC-ACT", "day": day}
    ).json()
    assert rows["total"] == 1
    assert rows["items"][0]["visit_id"] == "in"
