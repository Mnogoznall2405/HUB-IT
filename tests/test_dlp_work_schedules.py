"""Branch work schedules: store CRUD, API permissions and DLP reclassification.

Lunch idle -> ``break_sec``, idle outside the workday -> ``offshift_sec`` so the
frontend shows «перерыв»/«вне смены» instead of inflating «отошёл».
"""
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

BRANCH = "Тестовый филиал"


@pytest.fixture()
def app_db_url(tmp_path: Path, monkeypatch: pytest.MonkeyPatch):
    db_path = tmp_path / "app_dlp_schedules.sqlite"
    url = f"sqlite:///{db_path.as_posix()}"
    monkeypatch.setenv("APP_DATABASE_URL", url)
    monkeypatch.delenv("DLP_MEDIA_STORAGE_DIR", raising=False)
    from backend.appdb import db as appdb_db
    from backend.config import config
    from backend.services import dlp_work_schedule_service as schedules_service
    from backend.services import fs_egress_store_service as svc

    monkeypatch.setattr(config.app_db, "database_url", url)
    appdb_db._engines.clear()
    appdb_db._session_factories.clear()
    appdb_db._initialized_schema_urls.clear()
    schedules_service.invalidate_schedules_cache()
    clear = getattr(svc.get_egress_store, "cache_clear", None)
    if callable(clear):
        clear()
    yield url
    schedules_service.invalidate_schedules_cache()
    if callable(clear):
        clear()
    appdb_db._engines.clear()
    appdb_db._session_factories.clear()
    appdb_db._initialized_schema_urls.clear()


@pytest.fixture()
def store(app_db_url: str):
    from backend.appdb.file_egress_store import AppFileEgressStore

    return AppFileEgressStore(database_url=app_db_url)


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
    app.dependency_overrides[deps.get_current_user] = lambda: SimpleNamespace(
        id=1, username="admin", role="admin", permissions=[], use_custom_permissions=False
    )
    app.include_router(fs_egress.router)
    with TestClient(app) as test_client:
        yield test_client


def _local_day() -> tuple[str, datetime]:
    day_start = datetime.now().astimezone().replace(hour=0, minute=0, second=0, microsecond=0)
    return day_start.strftime("%Y-%m-%d"), day_start


def _past_day() -> tuple[str, datetime]:
    """Yesterday: every bucket is safely in the past (ingest drops >10min future)."""
    day_start = datetime.now().astimezone().replace(hour=0, minute=0, second=0, microsecond=0) - timedelta(days=1)
    return day_start.strftime("%Y-%m-%d"), day_start


def _probe(client, *, computer_name: str = "PC-SCHED", activity: list) -> None:
    resp = client.post(
        "/browser-probe",
        headers={"X-API-Key": "activity-key"},
        json={"computer_name": computer_name, "windows_user": "alice", "activity": activity},
    )
    assert resp.status_code == 200, resp.text


def _bucket(day_start: datetime, minutes: int, **values) -> dict:
    start = (day_start + timedelta(minutes=minutes)).replace(second=0, microsecond=0)
    row = {"bucket_start": start.isoformat(), "active_sec": 0.0, "passive_sec": 0.0, "away_sec": 0.0, "locked_sec": 0.0}
    row.update(values)
    return row


def _put_schedule(client, branch: str = BRANCH, **overrides):
    body = {
        "work_start_min": 9 * 60,
        "work_end_min": 18 * 60,
        "lunch_start_min": 13 * 60,
        "lunch_end_min": 13 * 60 + 45,
        "tz_offset_minutes": 0,
        "workdays_mask": 0x7F,
    }
    body.update(overrides)
    return client.put(f"/dlp/work-schedules/{branch}", json=body)


# --- pure classification ---------------------------------------------------

SCHEDULE = {
    "branch_name": BRANCH,
    "work_start_min": 9 * 60,
    "work_end_min": 18 * 60,
    "lunch_start_min": 13 * 60,
    "lunch_end_min": 13 * 60 + 45,
    "tz_offset_minutes": 0,
    "workdays_mask": 0x7F,
}


def test_split_bucket_work_lunch_offshift():
    from backend.services import dlp_work_schedule_service as svc

    base = datetime(2026, 11, 11, 0, 0).astimezone()  # Wednesday
    work = svc.split_bucket(SCHEDULE, base.replace(hour=10), passive=10, away=50, locked=0)
    assert work["zone"] == "work" and work["away"] == 50 and work["break"] == 0

    lunch = svc.split_bucket(SCHEDULE, base.replace(hour=13, minute=15), away=60)
    assert lunch["zone"] == "lunch" and lunch["break"] == 60 and lunch["away"] == 0

    edge = svc.split_bucket(SCHEDULE, base.replace(hour=13, minute=45), away=60)
    assert edge["zone"] == "work"  # midpoint 13:47 is past the 13:45 lunch end

    off = svc.split_bucket(SCHEDULE, base.replace(hour=20), passive=30, away=30, locked=10)
    assert off["zone"] == "off" and off["offshift"] == 70 and off["away"] == 0


def test_split_bucket_weekend_and_tz_offset():
    from backend.services import dlp_work_schedule_service as svc

    saturday = datetime(2026, 11, 14, 10, 0).astimezone()
    weekday_only = {**SCHEDULE, "workdays_mask": 0x1F}  # Mon–Fri
    assert svc.split_bucket(weekday_only, saturday, away=60)["zone"] == "off"
    assert svc.split_bucket(SCHEDULE, saturday, away=60)["zone"] == "work"

    # Moscow is server-time minus 120 minutes: 15:00 server == 13:00 branch-local.
    moscow = {**SCHEDULE, "tz_offset_minutes": -120}
    server_15 = datetime(2026, 11, 11, 15, 0).astimezone()
    assert svc.bucket_zone(moscow, server_15) == "lunch"
    server_10 = datetime(2026, 11, 11, 10, 0).astimezone()  # 08:00 branch-local
    assert svc.bucket_zone(moscow, server_10) == "off"


# --- store CRUD -------------------------------------------------------------

def test_store_upsert_list_delete_roundtrip(store):
    from backend.services import dlp_work_schedule_service as svc

    saved = store.upsert_branch_work_schedule(
        branch_name=BRANCH, work_start_min=540, work_end_min=1080,
        lunch_start_min=780, lunch_end_min=825, tz_offset_minutes=-120,
        workdays_mask=0x1F, updated_by="admin",
    )
    assert saved["tz_offset_minutes"] == -120
    rows = store.list_branch_work_schedules()
    assert [r["branch_name"] for r in rows] == [BRANCH]
    assert svc.serialize_schedule(rows[0])["workdays_mask"] == 0x1F

    saved2 = store.upsert_branch_work_schedule(
        branch_name=BRANCH, work_start_min=600, work_end_min=1140,
        lunch_start_min=None, lunch_end_min=None, tz_offset_minutes=0,
        workdays_mask=0x7F,
    )
    assert saved2["work_start_min"] == 600 and saved2["lunch_start_min"] is None
    assert len(store.list_branch_work_schedules()) == 1  # upsert, not duplicate

    assert store.delete_branch_work_schedule(branch_name=BRANCH) is True
    assert store.delete_branch_work_schedule(branch_name=BRANCH) is False


def test_store_rejects_invalid_intervals(store):
    with pytest.raises(ValueError):
        store.upsert_branch_work_schedule(
            branch_name=BRANCH, work_start_min=1000, work_end_min=500,
            lunch_start_min=None, lunch_end_min=None, tz_offset_minutes=0, workdays_mask=31,
        )
    with pytest.raises(ValueError):  # lunch outside the workday
        store.upsert_branch_work_schedule(
            branch_name=BRANCH, work_start_min=540, work_end_min=1080,
            lunch_start_min=1200, lunch_end_min=1230, tz_offset_minutes=0, workdays_mask=31,
        )


# --- API boundary -----------------------------------------------------------

def test_api_crud_and_validation(client):
    assert _put_schedule(client).status_code == 200
    data = client.get("/dlp/work-schedules").json()
    row = next(r for r in data["items"] if r["branch_name"] == BRANCH)
    assert row["work_end_min"] == 1080
    assert BRANCH in data["branches"]

    assert _put_schedule(client, work_start_min=700, work_end_min=100).status_code == 400
    assert client.delete(f"/dlp/work-schedules/{BRANCH}").status_code == 200
    assert client.delete(f"/dlp/work-schedules/{BRANCH}").status_code == 404


def test_api_requires_schedule_permission(client):
    from backend.api import deps

    del client.app.dependency_overrides[deps.get_current_user]
    client.app.dependency_overrides[deps.get_current_user] = lambda: SimpleNamespace(
        id=2, username="viewer", role="viewer", permissions=[], use_custom_permissions=True
    )
    assert client.get("/dlp/work-schedules").status_code == 403
    assert _put_schedule(client).status_code == 403
    assert client.delete(f"/dlp/work-schedules/{BRANCH}").status_code == 403


# --- reclassification -------------------------------------------------------

def _patch_hosts(monkeypatch, *host_rows):
    from backend.services import fs_egress_store_service as svc

    monkeypatch.setattr(svc, "list_dlp_hosts", lambda *a, **kw: list(host_rows))


def test_activity_reclassifies_lunch_and_offshift(client, monkeypatch):
    day, day_start = _past_day()
    _probe(
        client,
        activity=[
            _bucket(day_start, 10 * 60, away_sec=240),          # 10:00 work
            _bucket(day_start, 13 * 60 + 15, away_sec=200),     # 13:15 lunch
            _bucket(day_start, 20 * 60, passive_sec=150),       # 20:00 off-shift
        ],
    )
    assert _put_schedule(client).status_code == 200
    _patch_hosts(
        monkeypatch,
        {"computer_name": "PC-SCHED", "branch_name": BRANCH, "windows_user": "alice"},
    )

    data = client.get("/dlp/activity", params={"computer_name": "PC-SCHED", "day": day}).json()
    by_zone = {b["zone"]: b for b in data["buckets"]}
    assert by_zone["work"]["away_sec"] == pytest.approx(240.0)
    assert by_zone["lunch"]["break_sec"] == pytest.approx(200.0)
    assert by_zone["lunch"]["away_sec"] == 0
    assert by_zone["off"]["offshift_sec"] == pytest.approx(150.0)
    summary = data["summary"]
    assert summary["away_sec"] == pytest.approx(240.0)
    assert summary["break_sec"] == pytest.approx(200.0)
    assert summary["offshift_sec"] == pytest.approx(150.0)


def test_activity_without_schedule_keeps_raw_states(client, monkeypatch):
    day, day_start = _past_day()
    _probe(client, activity=[_bucket(day_start, 20 * 60, away_sec=120)])
    _patch_hosts(
        monkeypatch,
        {"computer_name": "PC-SCHED", "branch_name": "Другой филиал", "windows_user": "alice"},
    )
    data = client.get("/dlp/activity", params={"computer_name": "PC-SCHED", "day": day}).json()
    assert data["buckets"][0]["zone"] == "work"
    assert data["buckets"][0]["away_sec"] == pytest.approx(120.0)
    assert data["summary"].get("offshift_sec", 0) == 0


def test_attention_rows_carry_break_and_offshift(client, monkeypatch):
    day, day_start = _past_day()
    _probe(client, activity=[_bucket(day_start, 13 * 60 + 15, away_sec=200)])
    assert _put_schedule(client).status_code == 200
    _patch_hosts(
        monkeypatch,
        {"computer_name": "PC-SCHED", "branch_name": BRANCH, "windows_user": "alice"},
    )
    hosts = {h["computer_name"]: h for h in client.get("/dlp/attention", params={"day": day}).json()["hosts"]}
    row = hosts["PC-SCHED"]
    assert row["away_sec"] == pytest.approx(0.0)
    assert row["break_sec"] == pytest.approx(200.0)
    assert row["offshift_sec"] == pytest.approx(0.0)
