"""Branch work schedules: store CRUD, API permissions and DLP reclassification.

Lunch idle -> ``break_sec``, idle outside the workday -> ``offshift_sec`` so the
frontend shows «перерыв»/«вне смены» instead of inflating «отошёл».
"""
from __future__ import annotations

import sys
from datetime import datetime, timedelta, timezone
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
    # Keep the attention cache isolated between tests (it has a 60 s TTL).
    with svc._dlp_cache_lock:
        svc._dlp_cache["attention_expires"] = 0.0
        svc._dlp_cache.pop("attention", None)
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


def test_bucket_zone_converts_aware_bucket_to_server_local_before_offset():
    """The same instant must classify identically in UTC and local tz.

    The agent sends aware ``bucket_start`` (+05:00); adding tz_offset to the
    aware value directly misclassifies whenever the offset notation differs.
    """
    from backend.services import dlp_work_schedule_service as svc

    moscow = {**SCHEDULE, "tz_offset_minutes": -120}
    server_15 = datetime(2026, 11, 11, 15, 0).astimezone()
    utc_same = server_15.astimezone(timezone.utc)
    assert svc.bucket_zone(moscow, server_15) == "lunch"
    assert svc.bucket_zone(moscow, utc_same) == "lunch"
    assert svc.bucket_zone(moscow, datetime(2026, 11, 11, 10, 0).astimezone()) == "off"


TZ5 = timezone(timedelta(hours=5))


def test_bucket_zone_anchor_is_fixed_server_tz():
    """The +05 anchor is fixed, not "whatever OS zone the server runs in":
    the same instant classifies identically in any aware notation."""
    from backend.services import dlp_work_schedule_service as svc

    vilyuchinsk = {**SCHEDULE, "tz_offset_minutes": 420, "workdays_mask": 0x3F}
    # 2026-11-10 17:30 +05 == 12:30 UTC == 2026-11-11 00:30 branch — off-shift.
    ts = datetime(2026, 11, 10, 17, 30, tzinfo=TZ5)
    assert svc.bucket_zone(vilyuchinsk, ts) == "off"
    assert svc.bucket_zone(vilyuchinsk, ts.astimezone(timezone.utc)) == "off"
    # 2026-11-11 03:00 +05 == 10:00 branch — inside the 09:00-18:00 shift.
    work = datetime(2026, 11, 11, 3, 0, tzinfo=TZ5)
    assert svc.bucket_zone(vilyuchinsk, work) == "work"
    assert svc.bucket_zone(vilyuchinsk, work.astimezone(timezone.utc)) == "work"


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


@pytest.mark.parametrize(
    "overrides",
    [
        {"work_start_min": None},
        {"lunch_start_min": 780, "lunch_end_min": None},
        {"tz_offset_minutes": 841},
        {"workdays_mask": 128},
        {"work_start_min": 540.5},
        {"tz_offset_minutes": 1.5},
        {"workdays_mask": True},
    ],
)
def test_api_rejects_invalid_schedule_payload(client, overrides):
    assert _put_schedule(client).status_code == 200
    assert _put_schedule(client, branch="Плохой", **overrides).status_code == 400
    items = client.get("/dlp/work-schedules").json()["items"]
    names = {r["branch_name"] for r in items}
    assert "Плохой" not in names and BRANCH in names


def test_api_rejects_overlong_branch_name(client):
    assert _put_schedule(client).status_code == 200
    assert _put_schedule(client, branch="Ф" * 256).status_code == 400
    items = client.get("/dlp/work-schedules").json()["items"]
    assert [r["branch_name"] for r in items] == [BRANCH]


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


def test_attention_refresh_after_schedule_update(client, monkeypatch):
    """Saving a schedule must invalidate the cached attention rows immediately."""
    day, day_start = _past_day()
    _probe(client, activity=[_bucket(day_start, 13 * 60 + 15, away_sec=200)])
    _patch_hosts(
        monkeypatch,
        {"computer_name": "PC-SCHED", "branch_name": BRANCH, "windows_user": "alice"},
    )
    assert _put_schedule(client).status_code == 200
    hosts = {h["computer_name"]: h for h in client.get("/dlp/attention", params={"day": day}).json()["hosts"]}
    assert hosts["PC-SCHED"]["break_sec"] == pytest.approx(200.0)

    # Removing lunch must be visible on the next request, not ~60 s later.
    assert _put_schedule(client, lunch_start_min=None, lunch_end_min=None).status_code == 200
    hosts = {h["computer_name"]: h for h in client.get("/dlp/attention", params={"day": day}).json()["hosts"]}
    assert hosts["PC-SCHED"]["break_sec"] == pytest.approx(0.0)
    assert hosts["PC-SCHED"]["away_sec"] == pytest.approx(200.0)


# --- branch-local day ---------------------------------------------------------

VILYUCHINSK = {
    "work_start_min": 9 * 60,
    "work_end_min": 18 * 60,
    "lunch_start_min": 13 * 60,
    "lunch_end_min": 13 * 60 + 45,
    "tz_offset_minutes": 420,
    "workdays_mask": 0x3F,
}


def _aware_bucket(moment: datetime, **values) -> dict:
    row = {
        "bucket_start": moment.replace(second=0, microsecond=0).isoformat(),
        "active_sec": 0.0,
        "passive_sec": 0.0,
        "away_sec": 0.0,
        "locked_sec": 0.0,
    }
    row.update(values)
    return row


def _at(day, hh, mm):
    return datetime(day.year, day.month, day.day, hh, mm, tzinfo=TZ5)


def test_activity_day_follows_branch_timezone(client, monkeypatch):
    """A UTC+12 branch day spans 17:00->17:00 of the server's +05 wall clock."""
    selected = datetime.now(TZ5).date() - timedelta(days=2)
    prev = selected - timedelta(days=1)

    _probe(client, activity=[
        _aware_bucket(_at(prev, 17, 30), active_sec=100.0),      # branch 00:30
        _aware_bucket(_at(selected, 16, 55), active_sec=50.0),   # branch 23:55
        _aware_bucket(_at(selected, 17, 0), active_sec=25.0),    # next branch day
    ])
    assert _put_schedule(client, **VILYUCHINSK).status_code == 200
    _patch_hosts(
        monkeypatch,
        {"computer_name": "PC-SCHED", "branch_name": BRANCH, "windows_user": "alice"},
    )

    day_key = selected.isoformat()
    data = client.get("/dlp/activity", params={"computer_name": "PC-SCHED", "day": day_key}).json()
    assert len(data["buckets"]) == 2  # branch-local midnight bounds both sides
    local = data["local_time"]
    assert local["day"] == day_key
    assert local["utc_offset_minutes"] == 720
    assert local["branch_name"] == BRANCH
    assert local["work_start_min"] == 540
    # Both buckets sit outside the 09:00-18:00 branch shift but carry input:
    # active seconds stay active and are also reported as off-shift input.
    assert {b["zone"] for b in data["buckets"]} == {"off"}
    assert data["summary"]["active_sec"] == pytest.approx(150.0)
    assert data["summary"]["active_offshift_sec"] == pytest.approx(150.0)


def test_activity_default_day_is_branch_local(client, monkeypatch):
    """With no ?day= the server resolves the branch-local day, not Tyumen's."""
    from backend.services import fs_egress_store_service as svc

    frozen = (datetime.now(TZ5) - timedelta(days=2)).replace(hour=20, minute=0, second=0, microsecond=0)

    class _FrozenDateTime(datetime):
        @classmethod
        def now(cls, tz=None):
            if tz is not None:
                return frozen.astimezone(tz)
            return frozen.replace(tzinfo=None)

    monkeypatch.setattr(svc, "datetime", _FrozenDateTime, raising=False)

    # 20:00 +05 is already 03:00 of the next day at UTC+12 — the day the
    # branch considers "today" is one ahead of the server's.
    branch_day = (frozen + timedelta(hours=7)).date()
    bucket_at = datetime(branch_day.year, branch_day.month, branch_day.day, 1, 0,
                         tzinfo=timezone(timedelta(hours=12)))
    _probe(client, activity=[_aware_bucket(bucket_at, active_sec=60.0)])
    assert _put_schedule(client, **VILYUCHINSK).status_code == 200
    _patch_hosts(
        monkeypatch,
        {"computer_name": "PC-SCHED", "branch_name": BRANCH, "windows_user": "alice"},
    )

    data = client.get("/dlp/activity", params={"computer_name": "PC-SCHED"}).json()
    assert data["local_time"]["day"] == branch_day.isoformat()
    assert len(data["buckets"]) == 1
