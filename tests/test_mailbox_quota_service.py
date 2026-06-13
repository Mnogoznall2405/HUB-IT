from __future__ import annotations

from datetime import datetime, timezone
from pathlib import Path

import pytest

from backend.appdb.db import get_app_engine, initialize_app_schema
from backend.appdb import db as db_module
from backend.models.mailbox_quota import MailboxQuotaRowImport, MailboxQuotaSnapshotImport
from backend.services.mailbox_quota_service import MailboxQuotaService


def _sqlite_url(path: Path) -> str:
    return f"sqlite:///{path.as_posix()}"


@pytest.fixture
def quota_service(tmp_path, monkeypatch):
    database_url = _sqlite_url(tmp_path / "mailbox_quota.db")
    monkeypatch.setenv("APP_DATABASE_URL", database_url)
    monkeypatch.setattr("backend.config.config.app_db.database_url", database_url, raising=False)
    db_module._engines.clear()
    db_module._session_factories.clear()
    db_module._initialized_schema_urls.clear()
    initialize_app_schema(database_url)
    return MailboxQuotaService()


def _sample_payload(*, email: str = "user@example.test") -> MailboxQuotaSnapshotImport:
    return MailboxQuotaSnapshotImport(
        exchange_server="exch01.corp.local",
        source_host="COLLECTOR-01",
        collected_at=datetime(2026, 6, 10, 6, 0, tzinfo=timezone.utc),
        rows=[
            MailboxQuotaRowImport(
                display_name="Test User",
                email=email,
                user_principal_name=email,
                mailbox_type="UserMailbox",
                used_bytes=10,
                quota_bytes=100,
                free_bytes=90,
                used_percent=10.0,
                database_name="DB01",
            )
        ],
    )


def test_import_snapshot_persists_rows(quota_service):
    result = quota_service.import_snapshot(_sample_payload())
    assert result.duplicate is False
    assert result.row_count == 1
    assert result.snapshot_id > 0

    latest = quota_service.get_latest_snapshot()
    assert latest is not None
    assert latest.exchange_server == "exch01.corp.local"
    assert latest.source_host == "COLLECTOR-01"

    page = quota_service.list_rows(result.snapshot_id)
    assert page.total == 1
    assert page.items[0].email == "user@example.test"
    assert page.items[0].used_bytes == 10


def test_import_snapshot_dedupes_identical_payload(quota_service):
    payload = _sample_payload()
    first = quota_service.import_snapshot(payload)
    second = quota_service.import_snapshot(payload)
    assert first.duplicate is False
    assert second.duplicate is True
    assert second.snapshot_id == first.snapshot_id
    assert len(quota_service.list_snapshots(limit=10)) == 1


def test_compute_payload_sha256_is_stable_for_row_order(quota_service):
    rows = [
        MailboxQuotaRowImport(email="b@example.test", used_bytes=1, quota_bytes=2),
        MailboxQuotaRowImport(email="a@example.test", used_bytes=3, quota_bytes=4),
    ]
    payload_a = MailboxQuotaSnapshotImport(exchange_server="exch", rows=list(rows))
    payload_b = MailboxQuotaSnapshotImport(exchange_server="exch", rows=list(reversed(rows)))
    assert quota_service.compute_payload_sha256(payload_a) == quota_service.compute_payload_sha256(payload_b)


def test_list_rows_puts_unknown_percent_last(quota_service):
    payload = MailboxQuotaSnapshotImport(
        exchange_server="exch",
        rows=[
            MailboxQuotaRowImport(email="empty@example.test"),
            MailboxQuotaRowImport(
                email="warn@example.test",
                used_bytes=90,
                quota_bytes=100,
                used_percent=90.0,
            ),
            MailboxQuotaRowImport(
                email="top@example.test",
                used_bytes=99,
                quota_bytes=100,
                used_percent=99.0,
            ),
        ],
    )
    result = quota_service.import_snapshot(payload)
    page = quota_service.list_rows(result.snapshot_id, limit=10)
    assert [row.email for row in page.items] == [
        "top@example.test",
        "warn@example.test",
        "empty@example.test",
    ]


def test_list_rows_supports_warning_filter(quota_service):
    payload = MailboxQuotaSnapshotImport(
        exchange_server="exch",
        rows=[
            MailboxQuotaRowImport(email="ok@example.test", used_percent=50.0),
            MailboxQuotaRowImport(email="warn@example.test", used_percent=92.0),
            MailboxQuotaRowImport(email="full@example.test", used_percent=100.0),
        ],
    )
    result = quota_service.import_snapshot(payload)
    warning_page = quota_service.list_rows(result.snapshot_id, warning_90=True)
    assert warning_page.total == 1
    assert warning_page.items[0].email == "warn@example.test"
    over_page = quota_service.list_rows(result.snapshot_id, over_quota=True)
    assert over_page.total == 1
    assert over_page.items[0].email == "full@example.test"


def test_list_rows_supports_database_and_no_quota_filters(quota_service):
    payload = MailboxQuotaSnapshotImport(
        exchange_server="exch",
        rows=[
            MailboxQuotaRowImport(email="a@example.test", database_name="DB01", quota_bytes=100, used_percent=50.0),
            MailboxQuotaRowImport(email="b@example.test", database_name="DB02"),
            MailboxQuotaRowImport(email="c@example.test", database_name="DB01", quota_bytes=100, used_percent=95.0),
        ],
    )
    result = quota_service.import_snapshot(payload)
    db_page = quota_service.list_rows(result.snapshot_id, database_name="DB01")
    assert db_page.total == 2
    no_quota_page = quota_service.list_rows(result.snapshot_id, no_quota=True)
    assert no_quota_page.total == 1
    assert no_quota_page.items[0].email == "b@example.test"


def test_default_quota_uses_five_gb_for_unlimited_mailboxes(quota_service):
    five_gb = 5 * 1024 * 1024 * 1024
    used_bytes = int(five_gb * 0.96)
    payload = MailboxQuotaSnapshotImport(
        exchange_server="exch",
        rows=[
            MailboxQuotaRowImport(
                email="default@example.test",
                used_bytes=used_bytes,
                database_name="DB01",
            ),
        ],
    )
    result = quota_service.import_snapshot(payload)
    page = quota_service.list_rows(result.snapshot_id)
    row = page.items[0]
    assert row.uses_default_quota is True
    assert row.quota_bytes == five_gb
    assert row.used_percent == 96.0
    assert row.free_bytes == five_gb - used_bytes

    warning_page = quota_service.list_rows(result.snapshot_id, warning_90=True)
    assert warning_page.total == 1
    assert warning_page.items[0].email == "default@example.test"

    summary = quota_service.get_snapshot_summary(result.snapshot_id)
    assert summary.no_quota == 1
    assert summary.warning_90 == 1


def test_get_snapshot_summary_aggregates_counts(quota_service):
    payload = MailboxQuotaSnapshotImport(
        exchange_server="exch",
        rows=[
            MailboxQuotaRowImport(email="ok@example.test", database_name="DB01", quota_bytes=100, used_percent=50.0),
            MailboxQuotaRowImport(email="warn@example.test", database_name="DB01", quota_bytes=100, used_percent=92.0),
            MailboxQuotaRowImport(email="full@example.test", database_name="DB02", quota_bytes=100, used_percent=100.0),
            MailboxQuotaRowImport(email="free@example.test", database_name="DB02"),
        ],
    )
    result = quota_service.import_snapshot(payload)
    summary = quota_service.get_snapshot_summary(result.snapshot_id)
    assert summary.total == 4
    assert summary.with_quota == 3
    assert summary.no_quota == 1
    assert summary.warning_90 == 1
    assert summary.over_quota == 1
    assert {item.name: item.total for item in summary.by_database} == {"DB01": 2, "DB02": 2}
