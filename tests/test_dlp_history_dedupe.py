"""DLP history dedupe worker: dry-run counting + batched execute (sqlite app store)."""
from __future__ import annotations

import sys
from datetime import datetime, timedelta, timezone
from pathlib import Path

import pytest
from sqlalchemy import func, select

ROOT = Path(__file__).resolve().parents[1]
WEB = ROOT / "WEB-itinvent"
sys.path.insert(0, str(ROOT))
sys.path.insert(0, str(WEB))


@pytest.fixture()
def app_db_url(tmp_path: Path, monkeypatch: pytest.MonkeyPatch):
    db_path = tmp_path / "app_dlp_dedupe.sqlite"
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


def _visit_row(row_id: str, visited_at: datetime, *, url: str, computer: str = "PC-1") -> dict:
    return {
        "id": row_id,
        "computer_name": computer,
        "windows_user": "user",
        "browser": "chrome",
        "profile": "Default",
        "visit_id": row_id,
        "url": url,
        "title": "",
        "domain": "ya.ru",
        "category": "other",
        "visited_at": visited_at,
        "dwell_sec": None,
        "screenshot_file": "",
        "created_at": visited_at,
    }


def _file_row(
    row_id: str,
    channel: str,
    file_name: str,
    *,
    ts: int = 1,
    computer: str = "PC-1",
    created_at: datetime | None = None,
) -> dict:
    return {
        "id": row_id,
        "ts": ts,
        "channel": channel,
        "file_name": file_name,
        "dest_path": "",
        "src_path": "",
        "size": None,
        "sha256": "",
        "windows_user": "user",
        "computer_name": computer,
        "details_json": "{}",
        "created_at": created_at or datetime.now(timezone.utc),
    }


def _seed(app_db_url: str) -> None:
    from backend.appdb.db import app_session, ensure_app_schema_initialized
    from backend.appdb.models import AppBrowserProbeVisit, AppFileLeftEvent

    ensure_app_schema_initialized(app_db_url)
    base = datetime(2026, 1, 10, 10, 0, 5, tzinfo=timezone.utc)
    with app_session(database_url=app_db_url) as session:
        session.add_all(
            [
                # Same host+url inside one minute — v2 is the duplicate.
                AppBrowserProbeVisit(
                    **_visit_row("v1", base, url="https://ya.ru/search")
                ),
                AppBrowserProbeVisit(
                    **_visit_row("v2", base + timedelta(seconds=30), url="https://ya.ru/search")
                ),
                # Same url, different minute — keep.
                AppBrowserProbeVisit(
                    **_visit_row("v3", base + timedelta(minutes=2), url="https://ya.ru/search")
                ),
                # Different url — keep.
                AppBrowserProbeVisit(
                    **_visit_row("v4", base + timedelta(seconds=10), url="https://vk.com/im")
                ),
            ]
        )
        session.add_all(
            [
                # Deleted duplicate pair — keep earliest (f1).
                AppFileLeftEvent(
                    **_file_row("f1", "deleted", "report.docx", created_at=base)
                ),
                AppFileLeftEvent(
                    **_file_row("f2", "deleted", "report.docx", created_at=base + timedelta(hours=1))
                ),
                # Deleted noise — removed regardless of duplicates.
                AppFileLeftEvent(**_file_row("f3", "deleted", "outlook.pst.tmp")),
                # Same name but non-deleted channel — must stay.
                AppFileLeftEvent(**_file_row("f4", "usb", "report.docx")),
                # Real deleted file — stays.
                AppFileLeftEvent(**_file_row("f5", "deleted", "contract.pdf")),
            ]
        )


def _service(app_db_url: str):
    from backend.services.dlp_history_dedupe_service import DlpHistoryDedupeService

    return DlpHistoryDedupeService(database_url=app_db_url)


def _config(**overrides):
    from backend.services.dlp_history_dedupe_service import DedupeConfig

    cfg = DedupeConfig(
        enabled=True,
        dry_run=False,
        batch_size=50,
        max_batches=50,
        max_runtime_seconds=60,
        batch_pause_ms=0,
    )
    for key, value in overrides.items():
        setattr(cfg, key, value)
    return cfg


def _counts(app_db_url: str) -> tuple[int, int]:
    from backend.appdb.db import app_session
    from backend.appdb.models import AppBrowserProbeVisit, AppFileLeftEvent

    with app_session(database_url=app_db_url) as session:
        visits = int(session.execute(select(func.count(AppBrowserProbeVisit.id))).scalar() or 0)
        files = int(session.execute(select(func.count(AppFileLeftEvent.id))).scalar() or 0)
    return visits, files


def test_dry_run_reports_counts_and_deletes_nothing(app_db_url: str):
    _seed(app_db_url)
    svc = _service(app_db_url)

    report = svc.run_once(config=_config(dry_run=True))

    assert report["stop_reason"] == "dry_run"
    by_target = {row["target"]: row["eligible_exact"] for row in report["by_target"]}
    assert by_target == {"visit_dupes": 1, "file_dupes": 1, "noise_deleted": 1}
    assert report["eligible_rows_exact"] == 3
    assert _counts(app_db_url) == (4, 5)


def test_execute_deletes_only_dupes_and_noise(app_db_url: str):
    from backend.appdb.db import app_session
    from backend.appdb.models import AppBrowserProbeVisit, AppFileLeftEvent

    _seed(app_db_url)
    svc = _service(app_db_url)

    result = svc.run_once(config=_config(dry_run=False), acquire_lock=False)

    assert result["stop_reason"] == "no_rows"
    assert result["rows_deleted"] == 3
    assert result["deleted_by_target"] == {
        "visit_dupes": 1,
        "file_dupes": 1,
        "noise_deleted": 1,
    }
    assert _counts(app_db_url) == (3, 3)

    with app_session(database_url=app_db_url) as session:
        visit_ids = set(session.execute(select(AppBrowserProbeVisit.id)).scalars())
        file_rows = {
            row.id: (row.channel, row.file_name)
            for row in session.execute(select(AppFileLeftEvent)).scalars()
        }
    # Earliest row kept; minute-boundary and different-url rows untouched.
    assert visit_ids == {"v1", "v3", "v4"}
    # Earliest deleted row kept; usb channel and real deleted file untouched.
    assert file_rows == {
        "f1": ("deleted", "report.docx"),
        "f4": ("usb", "report.docx"),
        "f5": ("deleted", "contract.pdf"),
    }


def test_execute_is_idempotent_on_second_run(app_db_url: str):
    _seed(app_db_url)
    svc = _service(app_db_url)

    first = svc.run_once(config=_config(dry_run=False), acquire_lock=False)
    second = svc.run_once(config=_config(dry_run=False), acquire_lock=False)

    assert first["rows_deleted"] == 3
    assert second["rows_deleted"] == 0
    assert second["stop_reason"] == "no_rows"
    assert _counts(app_db_url) == (3, 3)
