from __future__ import annotations

import importlib
import runpy
import sys
from datetime import datetime, timedelta, timezone
from pathlib import Path
from types import SimpleNamespace

import pytest
from alembic.migration import MigrationContext
from alembic.operations import Operations
from sqlalchemy import create_engine, inspect, select


PROJECT_ROOT = Path(__file__).resolve().parents[1]
WEB_ROOT = PROJECT_ROOT / "WEB-itinvent"
if str(WEB_ROOT) not in sys.path:
    sys.path.insert(0, str(WEB_ROOT))

from backend.appdb.db import app_session, initialize_app_schema
from backend.appdb.models import AppPushOutbox


outbox_module = importlib.import_module("backend.services.app_push_outbox_service")
settings_module = importlib.import_module("backend.api.v1.settings")
REVISION = WEB_ROOT / "backend" / "alembic" / "versions" / "20260822_0101_app_push_outbox.py"


@pytest.fixture
def outbox_env(tmp_path, monkeypatch):
    database_url = f"sqlite+pysqlite:///{(tmp_path / 'app-push-outbox.db').as_posix()}"
    initialize_app_schema(database_url)
    monkeypatch.setenv("APP_PUSH_OUTBOX_ENABLED", "1")
    monkeypatch.setattr(outbox_module, "is_app_database_configured", lambda: True)
    monkeypatch.setattr(outbox_module, "app_session", lambda: app_session(database_url))
    return outbox_module.AppPushOutboxService(), database_url


def _enqueue(service, *, tag="mail:message-1"):
    return service.enqueue_notification(
        recipient_user_id=17,
        title="New mail",
        body="Sender: preview",
        channel="mail",
        route="/mail?message=message-1",
        tag=tag,
        data={"message_id": "message-1"},
        ttl=3600,
    )


def test_enqueue_is_idempotent_by_recipient_channel_and_tag(outbox_env):
    service, database_url = outbox_env

    first = _enqueue(service)
    second = _enqueue(service)

    assert first.accepted is True
    assert first.created is True
    assert second.accepted is True
    assert second.created is False
    assert second.job_id == first.job_id
    with app_session(database_url) as session:
        assert len(list(session.execute(select(AppPushOutbox)).scalars())) == 1


def test_successful_delivery_marks_job_sent(outbox_env, monkeypatch):
    service, database_url = outbox_env
    created = _enqueue(service)
    calls = []
    monkeypatch.setattr(
        outbox_module.chat_push_service,
        "send_notification",
        lambda **payload: calls.append(payload) or SimpleNamespace(sent=2, failed=0, disabled=0),
    )

    job = service.claim_jobs()[0]
    assert service.process_job(job) == outbox_module.STATUS_SENT

    assert calls[0]["recipient_user_id"] == 17
    assert calls[0]["data"] == {"message_id": "message-1"}
    with app_session(database_url) as session:
        row = session.get(AppPushOutbox, created.job_id)
        assert row.status == outbox_module.STATUS_SENT
        assert row.delivered_at is not None
        assert row.attempt_count == 1


def test_transient_failure_requeues_with_backoff(outbox_env, monkeypatch):
    service, database_url = outbox_env
    created = _enqueue(service)
    monkeypatch.setenv("APP_PUSH_OUTBOX_RETRY_BASE_SEC", "9")
    monkeypatch.setattr(
        outbox_module.chat_push_service,
        "send_notification",
        lambda **_payload: SimpleNamespace(sent=0, failed=1, disabled=0),
    )

    job = service.claim_jobs()[0]
    assert service.process_job(job) == outbox_module.STATUS_QUEUED

    with app_session(database_url) as session:
        row = session.get(AppPushOutbox, created.job_id)
        assert row.status == outbox_module.STATUS_QUEUED
        assert row.attempt_count == 1
        assert row.next_attempt_at > row.updated_at
        assert "delivery_failed" in row.last_error


def test_expired_job_is_not_delivered(outbox_env, monkeypatch):
    service, database_url = outbox_env
    created = _enqueue(service)
    with app_session(database_url) as session:
        row = session.get(AppPushOutbox, created.job_id)
        row.expires_at = datetime.now(timezone.utc) - timedelta(seconds=1)
    calls = []
    monkeypatch.setattr(
        outbox_module.chat_push_service,
        "send_notification",
        lambda **payload: calls.append(payload),
    )

    job = service.claim_jobs()[0]
    assert service.process_job(job) == outbox_module.STATUS_EXPIRED
    assert calls == []
    with app_session(database_url) as session:
        assert session.get(AppPushOutbox, created.job_id).status == outbox_module.STATUS_EXPIRED


@pytest.mark.asyncio
async def test_poll_once_reports_delivery_counters(outbox_env, monkeypatch):
    service, _database_url = outbox_env
    _enqueue(service, tag="tasks:one")
    _enqueue(service, tag="tasks:two")
    results = iter(
        [
            SimpleNamespace(sent=1, failed=0, disabled=0),
            SimpleNamespace(sent=0, failed=0, disabled=0),
        ]
    )
    monkeypatch.setattr(
        outbox_module.chat_push_service,
        "send_notification",
        lambda **_payload: next(results),
    )

    result = await service.poll_once()

    assert result["claimed"] == 2
    assert result["sent"] == 1
    assert result["no_subscriptions"] == 1
    snapshot = service.get_backlog_snapshot()
    assert snapshot["queued"] == 0
    assert snapshot["processing"] == 0


def test_revision_creates_and_drops_push_outbox_on_sqlite():
    namespace = runpy.run_path(str(REVISION))
    upgrade = namespace["upgrade"]
    downgrade = namespace["downgrade"]
    engine = create_engine("sqlite+pysqlite:///:memory:", future=True)
    with engine.begin() as connection:
        operations = Operations(MigrationContext.configure(connection))
        upgrade.__globals__["op"] = operations
        upgrade.__globals__["_scope"] = lambda: "app"
        downgrade.__globals__["op"] = operations
        downgrade.__globals__["_scope"] = lambda: "app"

        upgrade()

        inspector = inspect(connection)
        assert inspector.has_table("push_outbox")
        columns = {item["name"] for item in inspector.get_columns("push_outbox")}
        assert {
            "dedupe_key",
            "recipient_user_id",
            "data_json",
            "status",
            "attempt_count",
            "next_attempt_at",
            "expires_at",
        } <= columns
        unique = {
            tuple(item["column_names"])
            for item in inspector.get_unique_constraints("push_outbox")
        }
        assert ("dedupe_key",) in unique

        downgrade()
        assert not inspect(connection).has_table("push_outbox")


@pytest.mark.asyncio
async def test_native_push_status_exposes_outbox_backlog(monkeypatch):
    monkeypatch.setattr(
        settings_module.native_push_service,
        "get_runtime_status",
        lambda: {
            "enabled": True,
            "configured": True,
            "storage_available": True,
            "project_id_present": True,
            "service_account_present": True,
        },
    )
    monkeypatch.setattr(
        settings_module.app_push_outbox_service,
        "get_backlog_snapshot",
        lambda: {
            "enabled": True,
            "queued": 4,
            "ready": 3,
            "processing": 1,
            "failed": 2,
            "oldest_queued_age_sec": 12.5,
        },
    )

    response = await settings_module.get_native_push_status(
        current_user=SimpleNamespace(id=17),
    )

    assert response.outbox_enabled is True
    assert response.outbox_queued == 4
    assert response.outbox_ready == 3
    assert response.outbox_processing == 1
    assert response.outbox_failed == 2
    assert response.outbox_oldest_queued_age_sec == 12.5
