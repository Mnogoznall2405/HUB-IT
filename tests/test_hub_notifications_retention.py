"""PR3b: hub_notifications retention worker semantics (SQLite/dev)."""
from __future__ import annotations

import importlib
import sys
import threading
import time
from datetime import datetime, timedelta, timezone
from pathlib import Path
from types import SimpleNamespace
from uuid import uuid4

import pytest

PROJECT_ROOT = Path(__file__).resolve().parents[1]
WEB_ROOT = PROJECT_ROOT / "WEB-itinvent"
if str(WEB_ROOT) not in sys.path:
    sys.path.insert(0, str(WEB_ROOT))

hub_service_module = importlib.import_module("backend.services.hub_service")
retention_module = importlib.import_module("backend.services.hub_notifications_retention_service")


@pytest.fixture()
def retention_env(tmp_path, monkeypatch):
    monkeypatch.setenv("TASK_DISCUSSION_CHAT_ENABLED", "0")
    monkeypatch.setenv("CHAT_MODULE_ENABLED", "0")
    monkeypatch.setenv("HUB_NOTIFICATIONS_CLEANUP_ENABLED", "true")
    monkeypatch.setenv("HUB_NOTIFICATIONS_CLEANUP_DRY_RUN", "false")
    monkeypatch.setenv("HUB_NOTIFICATIONS_CLEANUP_ALLOW_UNREAD", "false")
    monkeypatch.setenv("HUB_NOTIFICATIONS_RETENTION_CHAT_READ_DAYS", "30")
    monkeypatch.setenv("HUB_NOTIFICATIONS_RETENTION_TASK_READ_DAYS", "60")
    monkeypatch.setenv("HUB_NOTIFICATIONS_RETENTION_ANNOUNCEMENT_READ_DAYS", "90")
    monkeypatch.setenv("HUB_NOTIFICATIONS_CLEANUP_BATCH_SIZE", "2")
    monkeypatch.setenv("HUB_NOTIFICATIONS_CLEANUP_MAX_BATCHES", "10")
    monkeypatch.setenv("HUB_NOTIFICATIONS_CLEANUP_MAX_RUNTIME_SECONDS", "30")
    monkeypatch.setenv("HUB_NOTIFICATIONS_CLEANUP_BATCH_PAUSE_MS", "0")
    monkeypatch.setattr(retention_module, "is_app_database_configured", lambda: False)

    store = SimpleNamespace(
        db_path=str(tmp_path / "hub_retention.db"),
        data_dir=str(tmp_path / "data"),
    )
    Path(store.data_dir).mkdir(parents=True, exist_ok=True)
    monkeypatch.setattr(hub_service_module, "get_local_store", lambda: store)
    monkeypatch.setattr(hub_service_module, "is_app_database_configured", lambda: False)
    monkeypatch.setattr(hub_service_module.user_service, "list_users", lambda: [])
    monkeypatch.setattr(hub_service_module.user_service, "get_by_id", lambda _uid: None)

    service = hub_service_module.HubService()
    retention = retention_module.HubNotificationsRetentionService(hub=service)
    yield {"hub": service, "retention": retention, "module": retention_module}


def _iso_days_ago(days: int) -> str:
    return (datetime.now(timezone.utc) - timedelta(days=days)).strftime("%Y-%m-%dT%H:%M:%S")


def _insert(hub, *, recipient: int, entity_type: str, entity_id: str, created_at: str, read: bool) -> str:
    notif_id = str(uuid4())
    with hub._connect() as conn:
        conn.execute(
            f"""
            INSERT INTO {hub._NOTIF_TABLE}
            (id, recipient_user_id, event_type, title, body, entity_type, entity_id, created_at)
            VALUES (?, ?, ?, ?, ?, ?, ?, ?)
            """,
            (notif_id, recipient, f"{entity_type}.event", "t", "b", entity_type, entity_id, created_at),
        )
        if read:
            conn.execute(
                f"""
                INSERT INTO {hub._NOTIF_READS_TABLE}(notification_id, user_id, read_at)
                VALUES (?, ?, ?)
                """,
                (notif_id, recipient, created_at),
            )
        conn.commit()
    return notif_id


def _count(hub, **filters) -> int:
    where = ["1=1"]
    params = []
    for key, value in filters.items():
        where.append(f"{key} = ?")
        params.append(value)
    with hub._connect() as conn:
        row = conn.execute(
            f"SELECT COUNT(*) AS c FROM {hub._NOTIF_TABLE} WHERE {' AND '.join(where)}",
            tuple(params),
        ).fetchone()
    return int(row["c"] if hasattr(row, "keys") else row[0])


def test_dry_run_does_not_delete(retention_env):
    hub = retention_env["hub"]
    retention = retention_env["retention"]
    _insert(hub, recipient=1, entity_type="chat", entity_id="c1", created_at=_iso_days_ago(120), read=True)
    before = _count(hub)
    report = retention.dry_run_report()
    assert report["count_mode"] == "exact"
    assert report["eligible_rows_exact"] >= 1
    assert _count(hub) == before


def test_unread_are_protected(retention_env):
    hub = retention_env["hub"]
    retention = retention_env["retention"]
    unread_id = _insert(
        hub, recipient=1, entity_type="chat", entity_id="u1", created_at=_iso_days_ago(120), read=False
    )
    _insert(hub, recipient=1, entity_type="chat", entity_id="r1", created_at=_iso_days_ago(120), read=True)
    result = retention.run_once(dry_run=False, acquire_lock=False, force_enabled=True)
    assert result["rows_deleted"] == 1
    assert _count(hub, id=unread_id) == 1


def test_only_older_than_threshold_deleted(retention_env):
    hub = retention_env["hub"]
    retention = retention_env["retention"]
    old_id = _insert(hub, recipient=1, entity_type="chat", entity_id="old", created_at=_iso_days_ago(120), read=True)
    recent_id = _insert(hub, recipient=1, entity_type="chat", entity_id="new", created_at=_iso_days_ago(5), read=True)
    retention.run_once(dry_run=False, acquire_lock=False, force_enabled=True)
    assert _count(hub, id=old_id) == 0
    assert _count(hub, id=recent_id) == 1


def test_different_retention_per_entity_type(retention_env):
    hub = retention_env["hub"]
    retention = retention_env["retention"]
    # chat retention 30d, task 60d
    chat_mid = _insert(hub, recipient=1, entity_type="chat", entity_id="c", created_at=_iso_days_ago(45), read=True)
    task_mid = _insert(hub, recipient=1, entity_type="task", entity_id="t", created_at=_iso_days_ago(45), read=True)
    retention.run_once(dry_run=False, acquire_lock=False, force_enabled=True)
    assert _count(hub, id=chat_mid) == 0
    assert _count(hub, id=task_mid) == 1


def test_max_batches_and_multiple_batches(retention_env, monkeypatch):
    hub = retention_env["hub"]
    retention = retention_env["retention"]
    monkeypatch.setenv("HUB_NOTIFICATIONS_CLEANUP_BATCH_SIZE", "2")
    monkeypatch.setenv("HUB_NOTIFICATIONS_CLEANUP_MAX_BATCHES", "2")
    for idx in range(6):
        _insert(
            hub,
            recipient=1,
            entity_type="chat",
            entity_id=f"b{idx}",
            created_at=_iso_days_ago(100),
            read=True,
        )
    cfg = retention.get_config()
    first = retention.run_once(config=cfg, dry_run=False, acquire_lock=False, force_enabled=True)
    assert first["batches"] == 2
    assert first["rows_deleted"] == 4
    assert first["stop_reason"] == "max_batches"
    assert _count(hub) == 2
    second = retention.run_once(config=cfg, dry_run=False, acquire_lock=False, force_enabled=True)
    assert second["rows_deleted"] == 2
    third = retention.run_once(config=cfg, dry_run=False, acquire_lock=False, force_enabled=True)
    assert third["rows_deleted"] == 0
    assert third["stop_reason"] == "no_rows"


def test_max_runtime_stops_loop(retention_env, monkeypatch):
    hub = retention_env["hub"]
    retention = retention_env["retention"]
    monkeypatch.setenv("HUB_NOTIFICATIONS_CLEANUP_BATCH_SIZE", "1")
    monkeypatch.setenv("HUB_NOTIFICATIONS_CLEANUP_MAX_BATCHES", "100")
    monkeypatch.setenv("HUB_NOTIFICATIONS_CLEANUP_MAX_RUNTIME_SECONDS", "1")
    monkeypatch.setenv("HUB_NOTIFICATIONS_CLEANUP_BATCH_PAUSE_MS", "600")
    for idx in range(5):
        _insert(
            hub,
            recipient=1,
            entity_type="chat",
            entity_id=f"rt{idx}",
            created_at=_iso_days_ago(100),
            read=True,
        )
    cfg = retention.get_config()
    started = time.perf_counter()
    result = retention.run_once(config=cfg, dry_run=False, acquire_lock=False, force_enabled=True)
    elapsed = time.perf_counter() - started
    assert result["stop_reason"] in {"max_runtime", "max_batches"}
    assert result["rows_deleted"] < 5 or result["stop_reason"] == "max_runtime"
    assert elapsed < 5


def test_crash_after_committed_batch_keeps_progress(retention_env, monkeypatch):
    hub = retention_env["hub"]
    retention = retention_env["retention"]
    monkeypatch.setenv("HUB_NOTIFICATIONS_CLEANUP_BATCH_SIZE", "2")
    monkeypatch.setenv("HUB_NOTIFICATIONS_CLEANUP_MAX_BATCHES", "5")
    for idx in range(4):
        _insert(
            hub,
            recipient=1,
            entity_type="chat",
            entity_id=f"cr{idx}",
            created_at=_iso_days_ago(100),
            read=True,
        )
    original = retention._delete_one_batch
    calls = {"n": 0}

    def flaky(**kwargs):
        calls["n"] += 1
        if calls["n"] == 2:
            raise RuntimeError("boom")
        return original(**kwargs)  # returns (ids, stages)

    monkeypatch.setattr(retention, "_delete_one_batch", flaky)
    result = retention.run_once(dry_run=False, acquire_lock=False, force_enabled=True)
    assert result["rows_deleted"] == 2
    assert result["stop_reason"] == "error"
    assert _count(hub) == 2


def test_new_rows_during_cleanup_are_kept(retention_env):
    hub = retention_env["hub"]
    retention = retention_env["retention"]
    _insert(hub, recipient=1, entity_type="chat", entity_id="old", created_at=_iso_days_ago(100), read=True)
    fresh_id = _insert(
        hub, recipient=1, entity_type="chat", entity_id="fresh", created_at=_iso_days_ago(1), read=True
    )
    retention.run_once(dry_run=False, acquire_lock=False, force_enabled=True)
    assert _count(hub, id=fresh_id) == 1


def test_idempotent_rerun(retention_env):
    hub = retention_env["hub"]
    retention = retention_env["retention"]
    _insert(hub, recipient=1, entity_type="chat", entity_id="x", created_at=_iso_days_ago(100), read=True)
    first = retention.run_once(dry_run=False, acquire_lock=False, force_enabled=True)
    second = retention.run_once(dry_run=False, acquire_lock=False, force_enabled=True)
    assert first["rows_deleted"] == 1
    assert second["rows_deleted"] == 0
    assert second["stop_reason"] == "no_rows"


def test_disabled_without_force_does_not_delete(retention_env, monkeypatch):
    hub = retention_env["hub"]
    retention = retention_env["retention"]
    monkeypatch.setenv("HUB_NOTIFICATIONS_CLEANUP_ENABLED", "false")
    monkeypatch.setenv("HUB_NOTIFICATIONS_CLEANUP_DRY_RUN", "false")
    _insert(hub, recipient=1, entity_type="chat", entity_id="d", created_at=_iso_days_ago(100), read=True)
    result = retention.run_once(dry_run=False, acquire_lock=False, force_enabled=False)
    assert result["stop_reason"] == "disabled"
    assert _count(hub) == 1


def test_advisory_lock_skips_second_worker(retention_env, monkeypatch):
    retention = retention_env["retention"]
    monkeypatch.setattr(retention, "_use_postgres", lambda: True)

    class _FakeConn:
        def __init__(self):
            self.calls = 0

        def execute(self, *_args, **_kwargs):
            self.calls += 1

            class _Result:
                @staticmethod
                def scalar():
                    return False

            return _Result()

        def commit(self):
            return None

        def close(self):
            return None

    class _FakeEngine:
        def connect(self):
            return _FakeConn()

    monkeypatch.setattr(retention_module, "get_app_engine", lambda *_a, **_k: _FakeEngine())
    monkeypatch.setattr(retention_module, "get_app_database_url", lambda: "postgresql://x")
    result = retention.run_once(dry_run=False, acquire_lock=True, force_enabled=True)
    assert result["stop_reason"] == "lock_unavailable"


def test_migration_module_declares_retention_index():
    module = importlib.import_module(
        "backend.alembic.versions.20260804_0079_hub_notifications_retention_index"
    )
    assert module.INDEX_NAME == "idx_hub_notifications_retention"
    assert module.INDEX_COLUMNS == ("entity_type", "created_at", "id")
    assert module.down_revision == "20260804_0078"


def test_sqlite_schema_has_retention_index(retention_env):
    hub = retention_env["hub"]
    with hub._connect() as conn:
        rows = conn.execute("PRAGMA index_list('hub_notifications')").fetchall()
    names = {str(row["name"] if hasattr(row, "keys") else row[1]) for row in rows}
    assert "idx_hub_notifications_retention" in names


def test_http_execute_blocked_when_disabled(retention_env, monkeypatch):
    from fastapi import FastAPI
    from fastapi.testclient import TestClient

    from backend.api import deps
    from backend.api.v1 import hub
    from backend.models.auth import User

    monkeypatch.setenv("HUB_NOTIFICATIONS_CLEANUP_ENABLED", "false")
    monkeypatch.setenv("HUB_NOTIFICATIONS_CLEANUP_DRY_RUN", "true")
    service = retention_env["hub"]
    monkeypatch.setattr(hub, "hub_service", service)

    async def _inline(func, *args, **kwargs):
        return func(*args, **kwargs)

    monkeypatch.setattr(hub, "run_in_threadpool", _inline)

    app = FastAPI()
    app.include_router(hub.router, prefix="/hub")
    admin = User(
        id=5,
        username="admin",
        email=None,
        full_name="Admin",
        role="admin",
        is_active=True,
        permissions=[],
        use_custom_permissions=True,
        custom_permissions=[],
        auth_source="local",
        telegram_id=None,
        assigned_database=None,
        mailbox_email=None,
        mailbox_login=None,
        mail_profile_mode="manual",
        mail_signature_html=None,
        mail_is_configured=False,
        created_at=None,
        updated_at=None,
        mail_updated_at=None,
    )
    app.dependency_overrides[deps.get_current_active_user] = lambda: admin
    client = TestClient(app)
    denied = client.post("/hub/notifications/retention/run-once", json={"dry_run": False})
    assert denied.status_code == 403
    dry = client.post("/hub/notifications/retention/run-once", json={"dry_run": True})
    assert dry.status_code == 200
    assert dry.json().get("stop_reason") == "dry_run"
    client.close()
