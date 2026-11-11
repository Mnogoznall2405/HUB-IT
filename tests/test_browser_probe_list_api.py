from __future__ import annotations

import sys
from pathlib import Path
from types import SimpleNamespace

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


def test_browser_probe_list_filters_hosts_days_and_total(app_db_url: str, monkeypatch):
    from fastapi import FastAPI
    from fastapi.testclient import TestClient

    from backend.api import deps
    from backend.api.v1 import fs_egress
    from backend.appdb.file_egress_store import AppFileEgressStore

    store = AppFileEgressStore(database_url=app_db_url)
    monkeypatch.setattr(fs_egress.store, "get_egress_store", lambda: store)
    monkeypatch.setenv("ITINV_AGENT_API_KEYS", "list-key")
    app = FastAPI()
    app.dependency_overrides[deps.get_current_admin_user] = lambda: SimpleNamespace(id=1)
    app.include_router(fs_egress.router)

    with TestClient(app) as client:
        post = client.post(
            "/browser-probe",
            headers={"X-API-Key": "list-key"},
            json={
                "computer_name": "PC-LIST",
                "windows_user": "alice",
                "visits": [
                    {
                        "browser": "chrome", "profile": "Default", "visit_id": "v1",
                        "url": "https://jira.example.com/board", "title": "Jira board",
                        "category": "work", "visited_at": "2026-11-09T10:00:00+00:00",
                    },
                    {
                        "browser": "chrome", "profile": "Default", "visit_id": "v2",
                        "url": "https://youtube.com/x", "title": "Video x",
                        "category": "entertainment",
                        "visited_at": "2026-11-10T09:00:00+00:00",
                        "screenshot_file": "gone.png",
                    },
                    {
                        "browser": "edge", "profile": "Default", "visit_id": "v3",
                        "url": "https://youtube.com/y", "title": "Video y",
                        "category": "entertainment",
                        "visited_at": "2026-11-10T11:00:00+00:00",
                        "screenshot_file": "live.png",
                    },
                ],
                "focus_events": [
                    {
                        "event_id": "f1", "browser": "chrome",
                        "url": "https://jira.example.com/board", "title": "Jira board",
                        "ended_at": 1794312000.0, "dwell_sec": 30,
                    },
                ],
                "media": [
                    {
                        "name": "live.png",
                        "content_base64": "cG5n",
                        "content_type": "image/png",
                    },
                ],
            },
        )
        assert post.status_code == 200, post.text

        all_rows = client.get("/browser-probe", params={"computer_name": "PC-LIST"})
        assert all_rows.status_code == 200
        assert all_rows.json()["total"] == 4  # 3 history + 1 focus

        day = client.get(
            "/browser-probe",
            params={"computer_name": "PC-LIST", "source": "history", "day": "2026-11-10"},
        ).json()
        assert day["total"] == 2
        assert {row["visit_id"] for row in day["items"]} == {"v2", "v3"}

        focus = client.get(
            "/browser-probe",
            params={"computer_name": "PC-LIST", "source": "focus"},
        ).json()
        assert focus["total"] == 1
        assert focus["items"][0]["dwell_sec"] == 30

        search = client.get(
            "/browser-probe",
            params={"computer_name": "PC-LIST", "q": "youtube"},
        ).json()
        assert search["total"] == 2

        # Dead media ref is masked; existing media stays linked.
        shots = {row["visit_id"]: row["screenshot_file"] for row in day["items"]}
        assert shots["v2"] == ""
        assert shots["v3"] == "live.png"

        hosts = client.get("/browser-probe/hosts").json()["hosts"]
        entry = next(h for h in hosts if h["computer_name"] == "PC-LIST")
        assert entry["visits"] == 4
        assert entry["focus_visits"] == 1
        assert entry["last_ts"] > 0

        days = client.get(
            "/browser-probe/days",
            params={"computer_name": "PC-LIST", "source": "history"},
        ).json()["days"]
        assert [d["day"] for d in days] == ["2026-11-10", "2026-11-09"]
        assert days[0]["visits"] == 2
        assert days[0]["entertainment"] == 2
        assert days[1]["work"] == 1
