from __future__ import annotations

from datetime import datetime, timezone

from fastapi import FastAPI
from fastapi.testclient import TestClient

from backend.api.v1 import mailbox_quota as mailbox_quota_api
from backend.models.auth import User
from backend.models.mailbox_quota import (
    MailboxQuotaImportResponse,
    MailboxQuotaRowResponse,
    MailboxQuotaRowsPage,
    MailboxQuotaSnapshotStats,
    MailboxQuotaSnapshotSummary,
)


def _make_user(*, permissions: list[str] | None = None) -> User:
    return User(
        id=5,
        username="quota-reader",
        email="quota-reader@example.com",
        full_name="Quota Reader",
        role="viewer",
        permissions=permissions or ["mail.quotas.read"],
        use_custom_permissions=True,
        custom_permissions=permissions or ["mail.quotas.read"],
        is_active=True,
    )


class FakeMailboxQuotaService:
    def import_snapshot(self, payload):
        return MailboxQuotaImportResponse(snapshot_id=42, row_count=len(payload.rows), duplicate=False)

    def list_snapshots(self, *, limit: int = 20):
        return [
            MailboxQuotaSnapshotSummary(
                id=42,
                imported_at=datetime(2026, 6, 10, 7, 0, tzinfo=timezone.utc),
                collected_at=datetime(2026, 6, 10, 6, 0, tzinfo=timezone.utc),
                source_host="COLLECTOR-01",
                exchange_server="exch01.corp.local",
                row_count=2,
            )
        ]

    def get_latest_snapshot(self):
        return self.list_snapshots(limit=1)[0]

    def list_rows(self, snapshot_id: int, **kwargs):
        return MailboxQuotaRowsPage(
            items=[
                MailboxQuotaRowResponse(
                    id=1,
                    email="user@example.test",
                    display_name="User",
                    used_bytes=10,
                    quota_bytes=100,
                    free_bytes=90,
                    used_percent=10.0,
                )
            ],
            total=1,
            snapshot=self.get_latest_snapshot(),
        )

    def get_snapshot_summary(self, snapshot_id: int):
        return MailboxQuotaSnapshotStats(
            snapshot_id=snapshot_id,
            total=2,
            with_quota=1,
            no_quota=1,
            over_quota=0,
            warning_90=1,
            by_database=[],
        )


def _client(monkeypatch) -> TestClient:
    app = FastAPI()
    app.include_router(mailbox_quota_api.router, prefix="/mail")
    app.dependency_overrides[mailbox_quota_api.get_current_active_user] = lambda: _make_user()
    monkeypatch.setattr(mailbox_quota_api, "mailbox_quota_service", FakeMailboxQuotaService())
    return TestClient(app)


def test_post_import_requires_api_key(monkeypatch):
    monkeypatch.delenv("MAIL_QUOTA_IMPORT_API_KEY", raising=False)
    monkeypatch.delenv("MAIL_QUOTA_IMPORT_API_KEYS", raising=False)
    client = _client(monkeypatch)
    response = client.post(
        "/mail/mailbox-quota-snapshots",
        json={
            "exchange_server": "exch",
            "rows": [{"email": "a@example.test", "used_bytes": 1}],
        },
        headers={"X-API-Key": "wrong"},
    )
    assert response.status_code == 401


def test_post_import_accepts_valid_api_key(monkeypatch):
    monkeypatch.setenv("MAIL_QUOTA_IMPORT_API_KEY", "test-import-key")
    client = _client(monkeypatch)
    response = client.post(
        "/mail/mailbox-quota-snapshots",
        headers={"X-API-Key": "test-import-key"},
        json={
            "exchange_server": "exch",
            "source_host": "PC01",
            "rows": [{"email": "a@example.test", "used_bytes": 1, "quota_bytes": 10}],
        },
    )
    assert response.status_code == 200
    assert response.json()["snapshot_id"] == 42


def test_mail_quotas_read_permission_matrix():
    from backend.services.authorization_service import authorization_service

    assert authorization_service.has_permission("admin", mailbox_quota_api.PERM_MAIL_QUOTAS_READ)
    assert not authorization_service.has_permission("viewer", mailbox_quota_api.PERM_MAIL_QUOTAS_READ)
    assert not authorization_service.has_permission(
        "viewer",
        mailbox_quota_api.PERM_MAIL_QUOTAS_READ,
        use_custom_permissions=True,
        custom_permissions=[],
    )


def test_get_latest_returns_snapshot(monkeypatch):
    monkeypatch.setenv("MAIL_QUOTA_IMPORT_API_KEY", "test-import-key")
    client = _client(monkeypatch)
    response = client.get("/mail/mailbox-quota-snapshots/latest")
    assert response.status_code == 200
    assert response.json()["id"] == 42


def test_get_rows_returns_page(monkeypatch):
    monkeypatch.setenv("MAIL_QUOTA_IMPORT_API_KEY", "test-import-key")
    client = _client(monkeypatch)
    response = client.get("/mail/mailbox-quota-snapshots/42/rows")
    assert response.status_code == 200
    body = response.json()
    assert body["total"] == 1
    assert body["items"][0]["email"] == "user@example.test"


def test_get_summary_returns_stats(monkeypatch):
    monkeypatch.setenv("MAIL_QUOTA_IMPORT_API_KEY", "test-import-key")
    client = _client(monkeypatch)
    response = client.get("/mail/mailbox-quota-snapshots/42/summary")
    assert response.status_code == 200
    body = response.json()
    assert body["snapshot_id"] == 42
    assert body["total"] == 2
    assert body["warning_90"] == 1
