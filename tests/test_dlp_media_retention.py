"""DLP media retention worker behavior + ingest media byte cap (sqlite app store)."""
from __future__ import annotations

import base64
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
    db_path = tmp_path / "app_dlp_retention.sqlite"
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


def _seed_media(app_db_url: str, model, rows) -> None:
    from backend.appdb.db import app_session, ensure_app_schema_initialized

    ensure_app_schema_initialized(app_db_url)
    with app_session(database_url=app_db_url) as session:
        for row in rows:
            session.add(model(**row))


def _count_media(app_db_url: str, model) -> int:
    from backend.appdb.db import app_session

    with app_session(database_url=app_db_url) as session:
        return int(session.execute(select(func.count(model.id))).scalar() or 0)


def _old_and_new(days_old: int = 20):
    now = datetime.now(timezone.utc)
    old = now - timedelta(days=days_old)
    return now, old


def _media_row(row_id: str, created_at: datetime, size: int = 128) -> dict:
    return {
        "id": row_id,
        "computer_name": "PC-DLP",
        "file_name": f"{row_id}.png",
        "content": b"\x89" * size,
        "content_type": "image/png",
        "created_at": created_at,
    }


def _service(app_db_url: str):
    from backend.services.dlp_media_retention_service import DlpMediaRetentionService

    return DlpMediaRetentionService(database_url=app_db_url)


def _config(**overrides):
    from backend.services.dlp_media_retention_service import RetentionConfig

    cfg = RetentionConfig(
        enabled=True,
        dry_run=False,
        retention_days=14,
        batch_size=25,
        max_batches=200,
        max_runtime_seconds=60,
        batch_pause_ms=0,
    )
    for key, value in overrides.items():
        setattr(cfg, key, value)
    return cfg


def test_dry_run_reports_eligible_without_deleting(app_db_url: str):
    from backend.appdb.models import AppBrowserProbeMedia, AppMaxProbeMedia, AppTelegramProbeMedia

    now, old = _old_and_new()
    _seed_media(
        app_db_url,
        AppBrowserProbeMedia,
        [_media_row("b-old-1", old, 300), _media_row("b-old-2", old, 200), _media_row("b-new", now)],
    )
    _seed_media(app_db_url, AppTelegramProbeMedia, [_media_row("t-old", old), _media_row("t-new", now)])
    _seed_media(app_db_url, AppMaxProbeMedia, [_media_row("m-new", now)])

    svc = _service(app_db_url)
    report = svc.run_once(config=_config(dry_run=True))

    assert report["stop_reason"] == "dry_run"
    assert report["eligible_rows_exact"] == 3
    assert report["eligible_bytes"] == 128 + 300 + 200
    by_table = {item["table"]: item["eligible_exact"] for item in report["by_table"]}
    assert by_table == {"browser_probe_media": 2, "telegram_probe_media": 1, "max_probe_media": 0}
    # Nothing was deleted.
    assert _count_media(app_db_url, AppBrowserProbeMedia) == 3
    assert _count_media(app_db_url, AppTelegramProbeMedia) == 2
    assert _count_media(app_db_url, AppMaxProbeMedia) == 1


def test_execute_is_blocked_when_disabled(app_db_url: str):
    from backend.appdb.models import AppBrowserProbeMedia

    _, old = _old_and_new()
    _seed_media(app_db_url, AppBrowserProbeMedia, [_media_row("b-old", old)])

    svc = _service(app_db_url)
    result = svc.run_once(config=_config(enabled=False))

    assert result["stop_reason"] == "disabled"
    assert result["rows_deleted"] == 0
    assert _count_media(app_db_url, AppBrowserProbeMedia) == 1


def test_execute_deletes_only_old_rows_in_bounded_batches(app_db_url: str):
    from backend.appdb.models import AppBrowserProbeMedia, AppTelegramProbeMedia

    now, old = _old_and_new()
    _seed_media(
        app_db_url,
        AppBrowserProbeMedia,
        [_media_row(f"b-old-{i}", old, 100) for i in range(5)]
        + [_media_row("b-new-1", now), _media_row("b-new-2", now)],
    )
    _seed_media(app_db_url, AppTelegramProbeMedia, [_media_row("t-old", old)])

    svc = _service(app_db_url)
    result = svc.run_once(config=_config(batch_size=2))

    assert result["stop_reason"] in {"no_rows", "max_batches"}
    assert result["rows_deleted"] == 6
    assert result["bytes_deleted"] == 5 * 100 + 128
    assert result["batches"] >= 3  # 6 rows / batch_size 2, round-robin over tables
    assert max(result["batch_latencies_ms"]) >= 0
    # Every batch stayed within the bound.
    for stage in result["batch_stages"]:
        assert stage["rows_deleted"] <= 2
    # Old rows gone, fresh rows kept — across all media tables.
    assert _count_media(app_db_url, AppBrowserProbeMedia) == 2
    assert _count_media(app_db_url, AppTelegramProbeMedia) == 0

    # Safe re-run: nothing left eligible.
    again = svc.run_once(config=_config(batch_size=2))
    assert again["stop_reason"] == "no_rows"
    assert again["rows_deleted"] == 0


def test_ingest_media_cap_drops_oversized_items(app_db_url: str, monkeypatch: pytest.MonkeyPatch):
    from backend.services import fs_egress_store_service as svc
    from backend.appdb.models import AppBrowserProbeMedia

    monkeypatch.setenv("ITINV_INGEST_MEDIA_MAX_BYTES", "2500")
    big = base64.b64encode(b"x" * 1000).decode()
    result = svc.ingest_browser_payload(
        {
            "computer_name": "PC-CAP",
            "windows_user": "alice",
            "visits": [],
            "media": [
                {"name": "a.png", "content_base64": big, "content_type": "image/png"},
                {"name": "b.png", "content_base64": big, "content_type": "image/png"},
                {"name": "c.png", "content_base64": big, "content_type": "image/png"},
            ],
        }
    )
    # 2×1000 fits the 2500 cap, the third is dropped — the request itself succeeds.
    # media counts *accepted* items (agent ack contract: media == sent), saved/dropped split out.
    assert result["media"] == 3
    assert result["media_saved"] == 2
    assert result["media_dropped"] == 1
    assert _count_media(app_db_url, AppBrowserProbeMedia) == 2


def test_media_disk_storage_roundtrip_and_retention_unlinks_files(
    app_db_url: str, tmp_path: Path, monkeypatch: pytest.MonkeyPatch
):
    from backend.appdb.db import app_session
    from backend.appdb.file_egress_store import AppFileEgressStore
    from backend.appdb.models import AppBrowserProbeMedia
    from backend.services import fs_egress_store_service as svc

    storage_dir = tmp_path / "dlp_media"
    monkeypatch.setenv("DLP_MEDIA_STORAGE_DIR", str(storage_dir))
    payload = {
        "computer_name": "PC-DISK",
        "windows_user": "alice",
        "visits": [],
        "media": [
            {
                "name": "shot.jpg",
                "content_base64": base64.b64encode(b"jpeg-bytes").decode(),
                "content_type": "image/jpeg",
            }
        ],
    }
    result = svc.ingest_browser_payload(payload)
    assert result["media_saved"] == 1

    with app_session(database_url=app_db_url) as session:
        row = session.get(AppBrowserProbeMedia, "PC-DISK:shot.jpg")
    assert row is not None and row.content is None
    assert row.storage_path and row.storage_path.startswith("browser_probe_media/")
    file_on_disk = storage_dir / row.storage_path
    assert file_on_disk.read_bytes() == b"jpeg-bytes"

    store = AppFileEgressStore(database_url=app_db_url)
    got = store.get_browser_media(computer_name="PC-DISK", file_name="shot.jpg")
    assert got["content"] == b"jpeg-bytes"

    # Back-date the row so retention sees it, then run execute: file must go too.
    with app_session(database_url=app_db_url) as session:
        session.get(AppBrowserProbeMedia, "PC-DISK:shot.jpg").created_at = (
            datetime.now(timezone.utc) - timedelta(days=20)
        )
    svc_rt = _service(app_db_url)
    out = svc_rt.run_once(config=_config())
    assert out["rows_deleted"] == 1
    assert not file_on_disk.exists()
    assert _count_media(app_db_url, AppBrowserProbeMedia) == 0


def test_dlp_media_created_at_index_migration_upgrade_downgrade():
    """Migration cannot be exercised through an HTTP boundary — unit-level on purpose."""
    import runpy

    import sqlalchemy as sa
    from alembic.migration import MigrationContext
    from alembic.operations import Operations

    revision = (
        WEB / "backend" / "alembic" / "versions" / "20261110_0163_dlp_media_created_at_indexes.py"
    )

    def run(connection, step: str, scope: str = "app") -> None:
        namespace = runpy.run_path(str(revision))
        function = namespace[step]
        function.__globals__["op"] = Operations(MigrationContext.configure(connection))
        function.__globals__["_scope"] = lambda: scope
        function()

    engine = sa.create_engine("sqlite+pysqlite:///:memory:", future=True)
    with engine.begin() as connection:
        for table in ("browser_probe_media", "telegram_probe_media", "max_probe_media"):
            connection.exec_driver_sql(
                f"CREATE TABLE {table} (id VARCHAR(512) PRIMARY KEY, created_at DATETIME NOT NULL)"
            )
        run(connection, "upgrade")
        indexes = {
            item["name"]
            for item in sa.inspect(connection).get_indexes("browser_probe_media")
        }
        assert "ix_app_browser_probe_media_created_at" in indexes
        # Idempotent: second run must not error or duplicate.
        run(connection, "upgrade")
        indexes_after = sa.inspect(connection).get_indexes("browser_probe_media")
        assert sum(1 for i in indexes_after if i["name"] == "ix_app_browser_probe_media_created_at") == 1
        run(connection, "downgrade")
        remaining = {
            item["name"]
            for item in sa.inspect(connection).get_indexes("browser_probe_media")
        }
        assert "ix_app_browser_probe_media_created_at" not in remaining
        # Downgrade never drops the table itself.
        assert sa.inspect(connection).has_table("browser_probe_media")


def test_dlp_media_storage_path_migration_upgrade_downgrade():
    """Migration cannot be exercised through an HTTP boundary — unit-level on purpose."""
    import runpy

    import sqlalchemy as sa
    from alembic.migration import MigrationContext
    from alembic.operations import Operations

    revision = (
        WEB / "backend" / "alembic" / "versions" / "20261110_0164_dlp_media_storage_path.py"
    )

    def run(connection, step: str, scope: str = "app") -> None:
        namespace = runpy.run_path(str(revision))
        function = namespace[step]
        function.__globals__["op"] = Operations(MigrationContext.configure(connection))
        function.__globals__["_scope"] = lambda: scope
        function()

    engine = sa.create_engine("sqlite+pysqlite:///:memory:", future=True)
    with engine.begin() as connection:
        for table in ("browser_probe_media", "telegram_probe_media", "max_probe_media"):
            connection.exec_driver_sql(
                f"CREATE TABLE {table} (id VARCHAR(512) PRIMARY KEY, created_at DATETIME NOT NULL)"
            )
        run(connection, "upgrade")
        columns = {c["name"] for c in sa.inspect(connection).get_columns("browser_probe_media")}
        assert "storage_path" in columns
        # Idempotent re-run.
        run(connection, "upgrade")
        run(connection, "downgrade")
        columns = {c["name"] for c in sa.inspect(connection).get_columns("browser_probe_media")}
        assert "storage_path" not in columns
        assert sa.inspect(connection).has_table("browser_probe_media")


def test_browser_probe_idle_sec_migration_upgrade_downgrade():
    """Migration cannot be exercised through an HTTP boundary — unit-level on purpose."""
    import runpy

    import sqlalchemy as sa
    from alembic.migration import MigrationContext
    from alembic.operations import Operations

    revision = (
        WEB / "backend" / "alembic" / "versions" / "20261111_0167_browser_probe_idle_sec.py"
    )

    def run(connection, step: str, scope: str = "app") -> None:
        namespace = runpy.run_path(str(revision))
        function = namespace[step]
        function.__globals__["op"] = Operations(MigrationContext.configure(connection))
        function.__globals__["_scope"] = lambda: scope
        function()

    engine = sa.create_engine("sqlite+pysqlite:///:memory:", future=True)
    with engine.begin() as connection:
        connection.exec_driver_sql(
            "CREATE TABLE browser_probe_visits (id VARCHAR(512) PRIMARY KEY, dwell_sec FLOAT)"
        )
        run(connection, "upgrade")
        columns = {c["name"] for c in sa.inspect(connection).get_columns("browser_probe_visits")}
        assert "idle_sec" in columns
        # Idempotent re-run.
        run(connection, "upgrade")
        run(connection, "downgrade")
        columns = {c["name"] for c in sa.inspect(connection).get_columns("browser_probe_visits")}
        assert "idle_sec" not in columns
        assert sa.inspect(connection).has_table("browser_probe_visits")


def test_backfill_dry_run_and_requires_storage_dir(app_db_url: str):
    from backend.appdb.models import AppBrowserProbeMedia, AppTelegramProbeMedia
    from backend.services.dlp_media_backfill_service import (
        BackfillConfig,
        DlpMediaBackfillService,
    )

    now, _ = _old_and_new()
    _seed_media(
        app_db_url,
        AppBrowserProbeMedia,
        [_media_row("b-1", now, 100), _media_row("b-2", now, 200)],
    )
    _seed_media(app_db_url, AppTelegramProbeMedia, [_media_row("t-1", now, 50)])

    svc = DlpMediaBackfillService(database_url=app_db_url, storage_root=None)
    report = svc.dry_run_report(config=BackfillConfig())
    assert report["pending_rows_exact"] == 3
    assert report["pending_bytes"] == 350
    by_table = {i["table"]: i["pending_rows"] for i in report["by_table"]}
    assert by_table == {"browser_probe_media": 2, "telegram_probe_media": 1, "max_probe_media": 0}

    # Execute without a storage dir refuses instead of touching rows.
    out = svc.run_once(config=BackfillConfig(dry_run=False, batch_pause_ms=0))
    assert out["stop_reason"] == "storage_dir_not_configured"
    assert out["rows_migrated"] == 0


def test_backfill_migrates_bytea_to_disk_and_stays_readable(
    app_db_url: str, tmp_path: Path, monkeypatch: pytest.MonkeyPatch
):
    from backend.appdb.db import app_session
    from backend.appdb.file_egress_store import AppFileEgressStore
    from backend.appdb.models import AppBrowserProbeMedia, AppTelegramProbeMedia
    from backend.services.dlp_media_backfill_service import (
        BackfillConfig,
        DlpMediaBackfillService,
    )

    # Rows seeded directly = legacy bytea (storage_path NULL), like pre-0164 data.
    monkeypatch.delenv("DLP_MEDIA_STORAGE_DIR", raising=False)
    now, _ = _old_and_new()
    _seed_media(
        app_db_url,
        AppBrowserProbeMedia,
        [_media_row(f"b-{i}", now, 64) for i in range(3)],
    )
    _seed_media(app_db_url, AppTelegramProbeMedia, [_media_row("t-1", now, 96)])

    storage_dir = tmp_path / "dlp_media"
    svc = DlpMediaBackfillService(database_url=app_db_url, storage_root=storage_dir)
    out = svc.run_once(
        config=BackfillConfig(dry_run=False, batch_size=2, batch_pause_ms=0),
        acquire_lock=False,
    )
    assert out["rows_migrated"] == 4
    assert out["rows_failed"] == 0
    assert out["bytes_migrated"] == 3 * 64 + 96
    assert out["batches"] >= 2

    with app_session(database_url=app_db_url) as session:
        rows = session.execute(
            select(AppBrowserProbeMedia.id, AppBrowserProbeMedia.content, AppBrowserProbeMedia.storage_path)
        ).all()
        assert all(content is None for _, content, _ in rows)
        assert all(sp and sp.startswith("browser_probe_media/") for _, _, sp in rows)
        for _, _, sp in rows:
            assert (storage_dir / sp).is_file()
            assert (storage_dir / sp).read_bytes() == b"\x89" * 64

    # Read path still serves the same bytes for migrated rows.
    monkeypatch.setenv("DLP_MEDIA_STORAGE_DIR", str(storage_dir))
    store = AppFileEgressStore(database_url=app_db_url)
    got = store.get_browser_media(computer_name="PC-DLP", file_name="b-0.png")
    assert got["content"] == b"\x89" * 64

    # Idempotent re-run: nothing left to migrate.
    again = svc.run_once(
        config=BackfillConfig(dry_run=False, batch_size=2, batch_pause_ms=0),
        acquire_lock=False,
    )
    assert again["stop_reason"] == "no_rows"
    assert again["rows_migrated"] == 0

def test_dlp_activity_buckets_migration_upgrade_downgrade():
    """Migration cannot be exercised through an HTTP boundary — unit-level on purpose."""
    import runpy

    import sqlalchemy as sa
    from alembic.migration import MigrationContext
    from alembic.operations import Operations

    revision = (
        WEB / "backend" / "alembic" / "versions" / "20261111_0169_dlp_activity_buckets.py"
    )

    def run(connection, step: str, scope: str = "app") -> None:
        namespace = runpy.run_path(str(revision))
        function = namespace[step]
        function.__globals__["op"] = Operations(MigrationContext.configure(connection))
        function.__globals__["_scope"] = lambda: scope
        function()

    engine = sa.create_engine("sqlite+pysqlite:///:memory:", future=True)
    with engine.begin() as connection:
        run(connection, "upgrade")
        inspector = sa.inspect(connection)
        assert inspector.has_table("dlp_activity_buckets")
        columns = {c["name"] for c in inspector.get_columns("dlp_activity_buckets")}
        assert {"computer_name", "windows_user", "bucket_start", "active_sec",
                "passive_sec", "away_sec", "locked_sec", "apps", "updated_at"} <= columns
        pk = {c for c in inspector.get_pk_constraint("dlp_activity_buckets")["constrained_columns"]}
        assert pk == {"computer_name", "windows_user", "bucket_start"}
        # Idempotent re-run.
        run(connection, "upgrade")
        run(connection, "downgrade")
        assert not sa.inspect(connection).has_table("dlp_activity_buckets")
        # Downgrade is idempotent too.
        run(connection, "downgrade")


def _count_rows(app_db_url: str, model) -> int:
    from backend.appdb.db import app_session

    with app_session(database_url=app_db_url) as session:
        return int(session.execute(select(func.count()).select_from(model)).scalar() or 0)


def _aux_config(**overrides):
    from backend.services.dlp_aux_cleanup_service import AuxCleanupConfig

    cfg = AuxCleanupConfig(
        enabled=True,
        dry_run=False,
        focus_retention_days=30,
        activity_retention_days=180,
        batch_size=5000,
        max_batches=10,
        max_runtime_seconds=60,
        batch_pause_ms=0,
    )
    for key, value in overrides.items():
        setattr(cfg, key, value)
    return cfg


def _seed_aux(app_db_url: str) -> None:
    from backend.appdb.db import app_session, ensure_app_schema_initialized
    from backend.appdb.models import AppBrowserProbeFocusEvent, AppDlpActivityBucket

    ensure_app_schema_initialized(app_db_url)
    now = datetime.now(timezone.utc)
    with app_session(database_url=app_db_url) as session:
        for key, days in (("old-focus", 40), ("new-focus", 5)):
            session.add(
                AppBrowserProbeFocusEvent(
                    event_key=key,
                    received_at=now - timedelta(days=days),
                )
            )
        for suffix, days in (("old", 200), ("new", 5)):
            session.add(
                AppDlpActivityBucket(
                    computer_name="PC-DLP",
                    windows_user="alice",
                    bucket_start=now - timedelta(days=days),
                    active_sec=100.0,
                    updated_at=now,
                )
            )
        session.commit()


def test_aux_cleanup_dry_run_counts_but_deletes_nothing(app_db_url: str):
    from backend.appdb.models import AppBrowserProbeFocusEvent, AppDlpActivityBucket
    from backend.services.dlp_aux_cleanup_service import DlpAuxCleanupService

    _seed_aux(app_db_url)
    service = DlpAuxCleanupService(database_url=app_db_url)
    report = service.run_once(config=_aux_config(), dry_run=True)
    assert report["stop_reason"] == "dry_run"
    by_table = {row["target"]: row["eligible_exact"] for row in report["by_table"]}
    assert by_table["focus_events"] == 1
    assert by_table["activity_buckets"] == 1
    assert _count_rows(app_db_url, AppBrowserProbeFocusEvent) == 2
    assert _count_rows(app_db_url, AppDlpActivityBucket) == 2


def test_aux_cleanup_apply_deletes_only_old_rows(app_db_url: str):
    from backend.appdb.models import AppBrowserProbeFocusEvent, AppDlpActivityBucket
    from backend.appdb.db import app_session
    from backend.services.dlp_aux_cleanup_service import DlpAuxCleanupService

    _seed_aux(app_db_url)
    service = DlpAuxCleanupService(database_url=app_db_url)
    out = service.run_once(config=_aux_config(), dry_run=False, acquire_lock=False)
    assert out["stop_reason"] == "no_rows"
    assert out["rows_deleted"] == 2
    with app_session(database_url=app_db_url) as session:
        remaining_focus = {
            row[0]
            for row in session.execute(
                select(AppBrowserProbeFocusEvent.event_key)
            ).all()
        }
        remaining_buckets = session.execute(
            select(func.count()).select_from(AppDlpActivityBucket)
        ).scalar()
    assert remaining_focus == {"new-focus"}
    assert remaining_buckets == 1


def test_aux_cleanup_disabled_blocks_apply(app_db_url: str):
    from backend.appdb.models import AppDlpActivityBucket
    from backend.services.dlp_aux_cleanup_service import DlpAuxCleanupService

    _seed_aux(app_db_url)
    service = DlpAuxCleanupService(database_url=app_db_url)
    out = service.run_once(config=_aux_config(enabled=False), dry_run=False)
    assert out["stop_reason"] == "disabled"
    assert _count_rows(app_db_url, AppDlpActivityBucket) == 2
