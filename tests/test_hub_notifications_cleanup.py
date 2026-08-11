"""PR3: hub_notifications entity index + batch cleanup semantics (SQLite/dev)."""
from __future__ import annotations

import importlib
import sys
import threading
from datetime import datetime, timezone
from pathlib import Path
from types import SimpleNamespace
from uuid import uuid4

import pytest
from fastapi import FastAPI
from fastapi.testclient import TestClient

PROJECT_ROOT = Path(__file__).resolve().parents[1]
WEB_ROOT = PROJECT_ROOT / "WEB-itinvent"

if str(WEB_ROOT) not in sys.path:
    sys.path.insert(0, str(WEB_ROOT))

from backend.api import deps
from backend.api.v1 import hub
from backend.models.auth import User

hub_service_module = importlib.import_module("backend.services.hub_service")

TASKS_READ = "tasks.read"
TASKS_WRITE = "tasks.write"
TASKS_REVIEW = "tasks.review"
DASHBOARD_READ = "dashboard.read"


def _raw_user(user_id: int, username: str, full_name: str, role: str, permissions: list[str]) -> dict:
    return {
        "id": user_id,
        "username": username,
        "email": None,
        "full_name": full_name,
        "is_active": True,
        "role": role,
        "permissions": permissions,
        "department": None,
        "ad_groups": [],
    }


def _public_user(raw: dict) -> User:
    permissions = list(raw.get("permissions") or [])
    return User(
        id=int(raw["id"]),
        username=str(raw["username"]),
        email=None,
        full_name=str(raw["full_name"]),
        role=str(raw["role"]),
        is_active=True,
        permissions=permissions,
        use_custom_permissions=True,
        custom_permissions=permissions,
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


@pytest.fixture()
def notif_env(tmp_path, monkeypatch):
    temp_dir = str(tmp_path)
    monkeypatch.setenv("TASK_DISCUSSION_CHAT_ENABLED", "0")
    monkeypatch.setenv("CHAT_MODULE_ENABLED", "0")
    monkeypatch.setenv("TASK_EMAIL_AUTODISPATCH_ENABLED", "0")
    task_discussion_module = importlib.import_module("backend.chat.task_discussion")
    monkeypatch.setattr(task_discussion_module, "is_task_discussion_chat_enabled", lambda: False)
    monkeypatch.setattr(task_discussion_module.config.chat, "task_discussion_enabled", False, raising=False)

    async def _run_in_threadpool_inline(func, *args, **kwargs):
        return func(*args, **kwargs)

    monkeypatch.setattr(hub, "run_in_threadpool", _run_in_threadpool_inline)

    raw_users = {
        1: _raw_user(1, "author", "Task Author", "operator", [DASHBOARD_READ, TASKS_READ, TASKS_WRITE]),
        2: _raw_user(2, "assignee", "Task Assignee", "viewer", [DASHBOARD_READ, TASKS_READ]),
        3: _raw_user(3, "controller", "Task Controller", "viewer", [DASHBOARD_READ, TASKS_READ, TASKS_REVIEW]),
        5: _raw_user(5, "admin", "Task Admin", "admin", [DASHBOARD_READ, TASKS_READ, TASKS_WRITE, TASKS_REVIEW]),
    }
    users_by_id = dict(raw_users)
    store = SimpleNamespace(
        db_path=str(Path(temp_dir) / "hub_notifications.db"),
        data_dir=str(Path(temp_dir) / "data"),
    )
    Path(store.data_dir).mkdir(parents=True, exist_ok=True)

    monkeypatch.setattr(hub_service_module, "get_local_store", lambda: store)
    monkeypatch.setattr(hub_service_module, "is_app_database_configured", lambda: False)
    monkeypatch.setattr(hub_service_module.user_service, "list_users", lambda: list(users_by_id.values()))
    monkeypatch.setattr(hub_service_module.user_service, "get_by_id", lambda user_id: users_by_id.get(int(user_id)))

    service = hub_service_module.HubService()
    monkeypatch.setattr(hub, "hub_service", service)
    monkeypatch.setattr(hub_service_module, "hub_service", service)
    monkeypatch.setattr(service, "_schedule_task_email_outbox_dispatch", lambda: None)

    app = FastAPI()
    app.include_router(hub.router, prefix="/hub")
    current = {"user": _public_user(raw_users[1])}

    def _override_current_user() -> User:
        return current["user"]

    app.dependency_overrides[deps.get_current_active_user] = _override_current_user
    client = TestClient(app)

    def set_user(user_id: int) -> None:
        current["user"] = _public_user(raw_users[user_id])

    yield {"client": client, "set_user": set_user, "service": service}
    client.close()


def _insert_notification(service, *, recipient_user_id: int, entity_type: str, entity_id: str, created_at: str, event_type: str = "task.assigned") -> str:
    notif_id = str(uuid4())
    with service._connect() as conn:
        conn.execute(
            f"""
            INSERT INTO {service._NOTIF_TABLE}
            (id, recipient_user_id, event_type, title, body, entity_type, entity_id, created_at)
            VALUES (?, ?, ?, ?, ?, ?, ?, ?)
            """,
            (
                notif_id,
                int(recipient_user_id),
                event_type,
                "title",
                "body",
                entity_type,
                entity_id,
                created_at,
            ),
        )
        conn.commit()
    return notif_id


def _count_notifications(service, **filters) -> int:
    where = ["1=1"]
    params: list = []
    for key, value in filters.items():
        where.append(f"{key} = ?")
        params.append(value)
    with service._connect() as conn:
        row = conn.execute(
            f"SELECT COUNT(*) AS c FROM {service._NOTIF_TABLE} WHERE {' AND '.join(where)}",
            tuple(params),
        ).fetchone()
    return int(row["c"] if hasattr(row, "keys") else row[0])


def test_sqlite_schema_has_entity_index(notif_env):
    service = notif_env["service"]
    with service._connect() as conn:
        rows = conn.execute("PRAGMA index_list('hub_notifications')").fetchall()
    names = {str(row["name"] if hasattr(row, "keys") else row[1]) for row in rows}
    assert "idx_hub_notifications_entity" in names
    assert "idx_hub_notifications_recipient" in names


def test_delete_notifications_for_entity_is_scoped(notif_env):
    service = notif_env["service"]
    keep_id = "task-keep"
    drop_id = "task-drop"
    _insert_notification(service, recipient_user_id=2, entity_type="task", entity_id=drop_id, created_at="2026-01-01T00:00:00")
    _insert_notification(service, recipient_user_id=2, entity_type="task", entity_id=keep_id, created_at="2026-01-01T00:00:00")
    _insert_notification(service, recipient_user_id=2, entity_type="chat", entity_id=drop_id, created_at="2026-01-01T00:00:00")

    deleted = service.delete_notifications_for_entity(entity_type="task", entity_id=drop_id)
    assert deleted == 1
    assert _count_notifications(service, entity_type="task", entity_id=drop_id) == 0
    assert _count_notifications(service, entity_type="task", entity_id=keep_id) == 1
    assert _count_notifications(service, entity_type="chat", entity_id=drop_id) == 1


def test_cleanup_old_notifications_multiple_batches_and_idempotent(notif_env):
    service = notif_env["service"]
    old = "2020-01-01T00:00:00"
    recent = "2026-08-01T00:00:00"
    for idx in range(5):
        _insert_notification(
            service,
            recipient_user_id=2,
            entity_type="chat",
            entity_id=f"c-{idx}",
            created_at=old,
            event_type="chat.message_received",
        )
    _insert_notification(
        service,
        recipient_user_id=2,
        entity_type="chat",
        entity_id="recent",
        created_at=recent,
        event_type="chat.message_received",
    )

    first = service.cleanup_old_notifications(
        older_than_iso="2025-01-01T00:00:00",
        batch_size=2,
        max_batches=2,
    )
    assert first["deleted"] == 4
    assert first["batches"] == 2
    assert first["has_more"] is True
    assert first["errors"] == []
    assert _count_notifications(service, entity_type="chat") == 2  # 1 old + 1 recent

    second = service.cleanup_old_notifications(
        older_than_iso="2025-01-01T00:00:00",
        batch_size=2,
        max_batches=2,
    )
    assert second["deleted"] == 1
    assert second["has_more"] is False
    assert _count_notifications(service) == 1
    assert _count_notifications(service, entity_id="recent") == 1

    third = service.cleanup_old_notifications(
        older_than_iso="2025-01-01T00:00:00",
        batch_size=2,
        max_batches=2,
    )
    assert third["deleted"] == 0
    assert third["batches"] == 0
    assert third["has_more"] is False


def test_cleanup_batch_failure_keeps_prior_progress(notif_env, monkeypatch):
    service = notif_env["service"]
    old = "2020-01-01T00:00:00"
    for idx in range(4):
        _insert_notification(
            service,
            recipient_user_id=2,
            entity_type="chat",
            entity_id=f"fail-{idx}",
            created_at=old,
            event_type="chat.message_received",
        )

    original_connect = service._db_conn
    calls = {"n": 0}

    from contextlib import contextmanager

    @contextmanager
    def flaky_db_conn(*, write: bool = False):
        calls["n"] += 1
        with original_connect(write=write) as conn:
            if calls["n"] == 2:
                raise RuntimeError("simulated batch failure")
            yield conn

    monkeypatch.setattr(service, "_db_conn", flaky_db_conn)
    result = service.cleanup_old_notifications(
        older_than_iso="2025-01-01T00:00:00",
        batch_size=2,
        max_batches=3,
    )
    assert result["deleted"] == 2
    assert result["batches"] == 1
    assert result["errors"]
    assert _count_notifications(service) == 2


def test_parallel_cleanup_workers_do_not_double_delete_rows(notif_env):
    service = notif_env["service"]
    old = "2020-01-01T00:00:00"
    for idx in range(20):
        _insert_notification(
            service,
            recipient_user_id=2,
            entity_type="chat",
            entity_id=f"par-{idx}",
            created_at=old,
            event_type="chat.message_received",
        )

    results: list[dict] = []
    errors: list[BaseException] = []

    def worker() -> None:
        try:
            results.append(
                service.cleanup_old_notifications(
                    older_than_iso="2025-01-01T00:00:00",
                    batch_size=5,
                    max_batches=10,
                )
            )
        except BaseException as exc:  # noqa: BLE001
            errors.append(exc)

    threads = [threading.Thread(target=worker) for _ in range(3)]
    for thread in threads:
        thread.start()
    for thread in threads:
        thread.join(timeout=30)

    assert not errors
    assert _count_notifications(service) == 0
    # Metrics may over-count under SQLite races; durable state must be empty once.
    assert sum(item.get("deleted", 0) for item in results) >= 20


def test_task_delete_removes_only_task_notifications(notif_env):
    client = notif_env["client"]
    set_user = notif_env["set_user"]
    service = notif_env["service"]

    set_user(1)
    project_code = f"pr3-{uuid4().hex[:8]}"
    project_response = client.post(
        "/hub/task-projects",
        json={"name": f"PR3 {project_code}", "code": project_code},
    )
    assert project_response.status_code == 200, project_response.text
    project = project_response.json()
    created = client.post(
        "/hub/tasks",
        json={
            "title": "PR3 delete semantics",
            "description": "x",
            "assignee_user_ids": [2],
            "controller_user_id": 5,
            "project_id": project["id"],
            "protocol_date": "2026-03-01",
            "priority": "normal",
        },
    )
    assert created.status_code == 200, created.text
    payload = created.json()
    assert payload["created"] == 1
    task_id = payload["items"][0]["id"]
    other_task = "other-task-id"
    _insert_notification(
        service,
        recipient_user_id=2,
        entity_type="task",
        entity_id=other_task,
        created_at=datetime.now(timezone.utc).isoformat(),
    )
    assert _count_notifications(service, entity_type="task", entity_id=task_id) >= 1

    deleted = client.delete(f"/hub/tasks/{task_id}")
    assert deleted.status_code == 200, deleted.text
    assert _count_notifications(service, entity_type="task", entity_id=task_id) == 0
    assert _count_notifications(service, entity_type="task", entity_id=other_task) == 1


def test_migration_module_declares_entity_index():
    module = importlib.import_module(
        "backend.alembic.versions.20260804_0078_hub_notifications_entity_index"
    )
    assert module.INDEX_NAME == "idx_hub_notifications_entity"
    assert module.INDEX_COLUMNS == ("entity_type", "entity_id")
    assert module.down_revision == "20260804_0077"
