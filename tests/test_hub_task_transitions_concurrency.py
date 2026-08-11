"""TASK-P0-1: parallel status-transition races (approve∥reject, submit∥submit, …)."""
from __future__ import annotations

import os
import sys
import threading
from concurrent.futures import ThreadPoolExecutor
from pathlib import Path
from types import SimpleNamespace
from uuid import uuid4

import pytest
from fastapi import FastAPI
from fastapi.testclient import TestClient
import importlib

PROJECT_ROOT = Path(__file__).resolve().parents[1]
WEB_ROOT = PROJECT_ROOT / "WEB-itinvent"

if str(WEB_ROOT) not in sys.path:
    sys.path.insert(0, str(WEB_ROOT))

from backend.api import deps
from backend.api.v1 import hub
from backend.models.auth import User
from backend.services.hub_task_transitions import (
    TaskTransitionConflict,
    reset_transition_metrics,
)

hub_service_module = importlib.import_module("backend.services.hub_service")

TASKS_READ = "tasks.read"
TASKS_WRITE = "tasks.write"
TASKS_REVIEW = "tasks.review"
DASHBOARD_READ = "dashboard.read"

REPEATS = max(1, int(os.environ.get("HUB_TRANSITION_CONCURRENCY_REPEATS", "100")))


class _NullLock:
    """Disable HubService RLock so SQLite connections can race conditional UPDATEs."""

    def acquire(self, *args, **kwargs):
        return True

    def release(self, *args, **kwargs):
        return None

    def __enter__(self):
        return self

    def __exit__(self, *args):
        return False


def _raw_user(user_id: int, username: str, full_name: str, role: str, permissions: list[str]) -> dict:
    return {
        "id": user_id,
        "username": username,
        "email": None,
        "full_name": full_name,
        "is_active": True,
        "role": role,
        "permissions": permissions,
        "use_custom_permissions": True,
        "custom_permissions": permissions,
        "auth_source": "local",
        "telegram_id": None,
        "assigned_database": None,
        "mailbox_email": None,
        "mailbox_login": None,
        "mail_profile_mode": "manual",
        "mail_signature_html": None,
        "mail_is_configured": False,
        "created_at": None,
        "updated_at": None,
        "mail_updated_at": None,
    }


def _public_user(raw: dict) -> User:
    permissions = list(raw.get("custom_permissions") or raw.get("permissions") or [])
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


@pytest.fixture
def transition_env(temp_dir, monkeypatch):
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
        db_path=str(Path(temp_dir) / "hub_tasks_transitions.db"),
        data_dir=str(Path(temp_dir) / "data"),
    )
    Path(store.data_dir).mkdir(parents=True, exist_ok=True)

    monkeypatch.setattr(hub_service_module, "get_local_store", lambda: store)
    monkeypatch.setattr(hub_service_module, "is_app_database_configured", lambda: False)
    monkeypatch.setattr(hub_service_module.user_service, "list_users", lambda: list(users_by_id.values()))
    monkeypatch.setattr(hub_service_module.user_service, "get_by_id", lambda user_id: users_by_id.get(int(user_id)))

    service = hub_service_module.HubService()
    service._lock = _NullLock()
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

    reset_transition_metrics()
    yield {
        "client": client,
        "set_user": set_user,
        "service": service,
        "raw_users": raw_users,
    }
    client.close()


def _create_task(client: TestClient, *, title: str = "Race Task") -> dict:
    project_code = f"{title.lower().replace(' ', '-')}-{uuid4().hex[:8]}"
    project_response = client.post(
        "/hub/task-projects",
        json={"name": f"Project for {title} {project_code[-4:]}", "code": project_code},
    )
    assert project_response.status_code == 200, project_response.text
    project = project_response.json()
    response = client.post(
        "/hub/tasks",
        json={
            "title": title,
            "description": "Concurrency probe",
            "assignee_user_ids": [2],
            "controller_user_id": 3,
            "project_id": project["id"],
            "protocol_date": "2026-03-01",
            "priority": "normal",
        },
    )
    assert response.status_code == 200, response.text
    return response.json()["items"][0]


def _submit(client: TestClient, task_id: str, *, comment: str = "report") -> dict:
    response = client.post(
        f"/hub/tasks/{task_id}/submit",
        data={"comment": comment},
        files={"file": ("report.txt", b"report-bytes", "text/plain")},
    )
    assert response.status_code == 200, response.text
    return response.json()


def _count_status_log(service, task_id: str) -> int:
    with service._connect() as conn:
        row = conn.execute(
            f"SELECT COUNT(*) AS c FROM {service._TASK_STATUS_LOG_TABLE} WHERE task_id = ?",
            (task_id,),
        ).fetchone()
    return int(row["c"] if hasattr(row, "keys") else row[0])


def _count_notifications(service, task_id: str, *, event_type: str | None = None) -> int:
    sql = f"SELECT COUNT(*) AS c FROM {service._NOTIF_TABLE} WHERE entity_id = ?"
    params: list = [task_id]
    if event_type:
        sql += " AND event_type = ?"
        params.append(event_type)
    with service._connect() as conn:
        row = conn.execute(sql, tuple(params)).fetchone()
    return int(row["c"] if hasattr(row, "keys") else row[0])


def _task_status(service, task_id: str) -> str:
    with service._connect() as conn:
        row = conn.execute(
            f"SELECT status FROM {service._TASKS_TABLE} WHERE id = ?",
            (task_id,),
        ).fetchone()
    return str(row["status"] if hasattr(row, "keys") else row[0]).lower()


def _race_two(fn_a, fn_b) -> tuple[list[str], list[BaseException | None]]:
    barrier = threading.Barrier(2)
    kinds: list[str] = []
    errors: list[BaseException | None] = []
    lock = threading.Lock()

    def _wrap(fn):
        err: BaseException | None = None
        try:
            barrier.wait(timeout=15)
            fn()
            kind = "success"
        except TaskTransitionConflict:
            kind = "conflict"
        except Exception as exc:  # noqa: BLE001 — collect for assertions
            kind = "error"
            err = exc
        with lock:
            kinds.append(kind)
            errors.append(err)

    with ThreadPoolExecutor(max_workers=2) as pool:
        f1 = pool.submit(_wrap, fn_a)
        f2 = pool.submit(_wrap, fn_b)
        f1.result()
        f2.result()
    return kinds, errors


def test_transition_matrix_is_single_source():
    from backend.services.hub_task_transitions import TRANSITION_MATRIX

    assert set(TRANSITION_MATRIX) >= {"start", "submit", "approve", "reject", "reopen", "complete_direct"}
    assert TRANSITION_MATRIX["approve"]["from"] == frozenset({"review"})
    assert TRANSITION_MATRIX["approve"]["to"] == "done"
    assert TRANSITION_MATRIX["reject"]["to"] == "in_progress"


def test_http_maps_transition_conflict_to_409(transition_env):
    env = transition_env
    client = env["client"]
    set_user = env["set_user"]

    set_user(1)
    task = _create_task(client, title="http-409")
    task_id = task["id"]
    set_user(2)
    _submit(client, task_id)
    set_user(3)
    first = client.post(f"/hub/tasks/{task_id}/review", json={"decision": "approve", "comment": "ok"})
    second = client.post(f"/hub/tasks/{task_id}/review", json={"decision": "reject", "comment": "late"})
    assert first.status_code == 200
    assert second.status_code == 409
    detail = second.json()["detail"]
    assert detail["code"] == "task_transition_conflict"
    assert detail["operation"] == "reject"
    assert detail["current_status"] == "done"
    assert detail["requested_status"] == "in_progress"
    assert detail["current_version"] is None


@pytest.mark.parametrize("scenario", ["approve_reject", "approve_approve", "reject_reject"])
def test_review_decision_races(transition_env, scenario):
    env = transition_env
    client = env["client"]
    set_user = env["set_user"]
    service = env["service"]
    users = env["raw_users"]

    totals = {"success": 0, "conflict": 0, "error": 0}

    for i in range(REPEATS):
        set_user(1)
        task = _create_task(client, title=f"{scenario}-{i}-{uuid4().hex[:6]}")
        task_id = task["id"]
        set_user(2)
        _submit(client, task_id, comment=f"c-{i}")
        before_log = _count_status_log(service, task_id)
        before_notif = _count_notifications(service, task_id, event_type="task.reviewed")

        controller = users[3]
        admin = users[5]
        if scenario == "approve_reject":
            fn_a = lambda: service.review_task(
                task_id=task_id, reviewer=controller, decision="approve", comment="ok", is_admin=False
            )
            fn_b = lambda: service.review_task(
                task_id=task_id, reviewer=controller, decision="reject", comment="no", is_admin=False
            )
            allowed_status = {"done", "in_progress"}
        elif scenario == "approve_approve":
            fn_a = lambda: service.review_task(
                task_id=task_id, reviewer=controller, decision="approve", comment="a1", is_admin=False
            )
            fn_b = lambda: service.review_task(
                task_id=task_id, reviewer=admin, decision="approve", comment="a2", is_admin=True
            )
            allowed_status = {"done"}
        else:
            fn_a = lambda: service.review_task(
                task_id=task_id, reviewer=controller, decision="reject", comment="r1", is_admin=False
            )
            fn_b = lambda: service.review_task(
                task_id=task_id, reviewer=admin, decision="reject", comment="r2", is_admin=True
            )
            allowed_status = {"in_progress"}

        kinds, errors = _race_two(fn_a, fn_b)
        assert kinds.count("success") == 1, (kinds, errors, scenario)
        assert kinds.count("conflict") == 1, (kinds, errors, scenario)
        assert kinds.count("error") == 0, (kinds, errors)
        totals["success"] += 1
        totals["conflict"] += 1

        final_status = _task_status(service, task_id)
        assert final_status in allowed_status
        assert _count_status_log(service, task_id) - before_log == 1
        assert _count_notifications(service, task_id, event_type="task.reviewed") - before_notif >= 1

    assert totals["success"] == REPEATS
    assert totals["conflict"] == REPEATS
    assert totals["error"] == 0


def test_submit_submit_race(transition_env):
    env = transition_env
    client = env["client"]
    set_user = env["set_user"]
    service = env["service"]
    assignee = env["raw_users"][2]

    for i in range(REPEATS):
        set_user(1)
        task = _create_task(client, title=f"submit-submit-{i}")
        task_id = task["id"]
        service.start_task(task_id=task_id, user=assignee)
        before_log = _count_status_log(service, task_id)

        fn_a = lambda: service.submit_task(
            task_id=task_id,
            user=assignee,
            comment="a",
            file_name="a.txt",
            file_bytes=b"aaa",
            file_mime="text/plain",
        )
        fn_b = lambda: service.submit_task(
            task_id=task_id,
            user=assignee,
            comment="b",
            file_name="b.txt",
            file_bytes=b"bbb",
            file_mime="text/plain",
        )
        kinds, errors = _race_two(fn_a, fn_b)
        assert kinds.count("success") == 1, (kinds, errors)
        assert kinds.count("conflict") == 1, (kinds, errors)
        assert kinds.count("error") == 0, errors
        assert _task_status(service, task_id) == "review"
        assert _count_status_log(service, task_id) - before_log == 1


def test_submit_approve_race(transition_env):
    """Conflicting pair at status=review: approve wins, late submit gets conflict."""
    env = transition_env
    client = env["client"]
    set_user = env["set_user"]
    service = env["service"]
    assignee = env["raw_users"][2]
    controller = env["raw_users"][3]

    for i in range(REPEATS):
        set_user(1)
        task = _create_task(client, title=f"submit-approve-{i}")
        task_id = task["id"]
        set_user(2)
        _submit(client, task_id, comment=f"ready-{i}")
        assert _task_status(service, task_id) == "review"
        before_log = _count_status_log(service, task_id)

        fn_a = lambda: service.submit_task(
            task_id=task_id,
            user=assignee,
            comment="late",
            file_name="r.txt",
            file_bytes=b"x",
            file_mime="text/plain",
        )
        fn_b = lambda: service.review_task(
            task_id=task_id,
            reviewer=controller,
            decision="approve",
            comment="ok",
            is_admin=False,
        )
        kinds, errors = _race_two(fn_a, fn_b)
        assert kinds.count("success") == 1, (kinds, errors)
        assert kinds.count("conflict") == 1, (kinds, errors)
        assert kinds.count("error") == 0, errors
        assert _task_status(service, task_id) == "done"
        assert _count_status_log(service, task_id) - before_log == 1


def test_start_start_race(transition_env):
    env = transition_env
    client = env["client"]
    set_user = env["set_user"]
    service = env["service"]
    assignee = env["raw_users"][2]

    for i in range(REPEATS):
        set_user(1)
        task = _create_task(client, title=f"start-start-{i}")
        task_id = task["id"]
        before_log = _count_status_log(service, task_id)
        kinds, errors = _race_two(
            lambda: service.start_task(task_id=task_id, user=assignee),
            lambda: service.start_task(task_id=task_id, user=assignee),
        )
        assert kinds.count("success") == 1, (kinds, errors)
        assert kinds.count("conflict") == 1, (kinds, errors)
        assert kinds.count("error") == 0, errors
        assert _task_status(service, task_id) == "in_progress"
        assert _count_status_log(service, task_id) - before_log == 1


def test_reopen_reopen_race(transition_env):
    env = transition_env
    client = env["client"]
    set_user = env["set_user"]
    service = env["service"]
    users = env["raw_users"]

    for i in range(REPEATS):
        set_user(1)
        task = _create_task(client, title=f"reopen-reopen-{i}")
        task_id = task["id"]
        set_user(2)
        _submit(client, task_id)
        service.review_task(
            task_id=task_id,
            reviewer=users[3],
            decision="approve",
            comment="done",
            is_admin=False,
        )
        assert _task_status(service, task_id) == "done"
        before_log = _count_status_log(service, task_id)
        kinds, errors = _race_two(
            lambda: service.reopen_task(task_id=task_id, user=users[2], is_admin=False),
            lambda: service.reopen_task(task_id=task_id, user=users[1], is_admin=False),
        )
        assert kinds.count("success") == 1, (kinds, errors)
        assert kinds.count("conflict") == 1, (kinds, errors)
        assert kinds.count("error") == 0, errors
        assert _task_status(service, task_id) == "in_progress"
        assert _count_status_log(service, task_id) - before_log == 1


def test_reopen_update_race(transition_env):
    """reopen ∥ update_task: status transition has one winner; field update must not revive done."""
    env = transition_env
    client = env["client"]
    set_user = env["set_user"]
    service = env["service"]
    users = env["raw_users"]

    for i in range(REPEATS):
        set_user(1)
        task = _create_task(client, title=f"reopen-update-{i}")
        task_id = task["id"]
        set_user(2)
        _submit(client, task_id)
        service.review_task(
            task_id=task_id,
            reviewer=users[3],
            decision="approve",
            comment="done",
            is_admin=False,
        )
        before_log = _count_status_log(service, task_id)
        barrier = threading.Barrier(2)
        kinds: list[str] = []
        lock = threading.Lock()

        def _reopen():
            try:
                barrier.wait(timeout=15)
                service.reopen_task(task_id=task_id, user=users[2], is_admin=False)
                kind = "reopen_success"
            except TaskTransitionConflict:
                kind = "reopen_conflict"
            except Exception as exc:  # noqa: BLE001
                kind = f"reopen_error:{exc}"
            with lock:
                kinds.append(kind)

        def _update():
            try:
                barrier.wait(timeout=15)
                service.update_task(
                    task_id,
                    {"title": f"Updated reopen-update-{i}"},
                    actor_user_id=1,
                    is_admin=False,
                )
                kind = "update_success"
            except Exception as exc:  # noqa: BLE001
                kind = f"update_error:{exc}"
            with lock:
                kinds.append(kind)

        with ThreadPoolExecutor(max_workers=2) as pool:
            f1 = pool.submit(_reopen)
            f2 = pool.submit(_update)
            f1.result()
            f2.result()

        assert any(item.startswith("reopen_") for item in kinds)
        assert "reopen_error" not in " ".join(kinds)
        assert not any(item.startswith("update_error") for item in kinds)
        assert _task_status(service, task_id) == "in_progress"
        assert _count_status_log(service, task_id) - before_log == 1


def test_post_commit_discussion_failure_does_not_500(transition_env, monkeypatch):
    env = transition_env
    client = env["client"]
    set_user = env["set_user"]

    async def _boom(**kwargs):
        raise RuntimeError("discussion down")

    monkeypatch.setattr(hub, "publish_task_discussion_updated", _boom)

    set_user(1)
    task = _create_task(client, title="side-effect-safe")
    task_id = task["id"]
    set_user(2)
    response = client.post(f"/hub/tasks/{task_id}/start")
    assert response.status_code == 200, response.text
    assert response.json()["status"] == "in_progress"
