"""«Предложить идею»: HTTP-сценарии на изолированной sqlite app-БД и проверка миграции 20261027_0148.

Границы проверяются через реальный TestClient приложения: отправка, лимиты, защита от двойной отправки,
видимость своих предложений, разбор администратором, отсутствие таблицы (503). Миграция проверяется
отдельно на sqlite: создание, идемпотентность, сохранение данных при downgrade и пропуск scope=chat.
"""
from __future__ import annotations

import runpy
import sys
from datetime import datetime, timedelta, timezone
from pathlib import Path

import pytest
import sqlalchemy as sa
from alembic.migration import MigrationContext
from alembic.operations import Operations
from fastapi.testclient import TestClient

from backend.api import deps
from backend.api.v1 import feedback
from backend.appdb.db import get_app_engine
from backend.appdb.models import AppBase, AppFeedbackSuggestion, AppUser
from backend.main import app
from backend.models.auth import User
from backend.services.feedback_service import FeedbackService
from backend.services.feedback_store import FeedbackStore

ROOT = Path(__file__).resolve().parents[1]
WEB_ROOT = ROOT / "WEB-itinvent"
if str(WEB_ROOT) not in sys.path:
    sys.path.insert(0, str(WEB_ROOT))

REVISION = WEB_ROOT / "backend" / "alembic" / "versions" / "20261027_0148_feedback_suggestions.py"
TABLE = "feedback_suggestions"

AUTHOR = 10
OTHER = 11
OPERATOR = 12
ADMIN = 20
START = datetime(2026, 10, 27, 9, 0, tzinfo=timezone.utc)


def _suggestion(**overrides):
    body = {
        "category": "idea",
        "title": "Поиск по разделу задач",
        "message": "Хочется искать задачи по номеру и по ФИО исполнителя.",
        "section": "Задачи",
    }
    body.update(overrides)
    return body


@pytest.fixture
def env(prebuilt_app_db, monkeypatch):
    url = f"sqlite:///{prebuilt_app_db.as_posix()}"
    store = FeedbackStore(url)
    now = [START]
    svc = FeedbackService(store, clock=lambda: now[0])
    with store.session() as session:
        session.add_all([
            AppUser(id=AUTHOR, username="ivanov", full_name="Иванов Иван", role="viewer"),
            AppUser(id=OTHER, username="petrov", full_name="Петров Пётр", role="viewer"),
            AppUser(id=OPERATOR, username="operator1", full_name="Оператор", role="operator"),
            AppUser(id=ADMIN, username="admin1", full_name="Администратор", role="admin"),
        ])
    current = {"user": User(id=AUTHOR, username="ivanov", role="viewer", is_active=True)}
    app.dependency_overrides[deps.get_current_active_user] = lambda: current["user"]
    app.dependency_overrides[feedback.get_feedback_service] = lambda: svc
    client = TestClient(app, base_url="https://testserver", raise_server_exceptions=False)
    yield {"client": client, "store": store, "url": url, "now": now, "current": current}
    app.dependency_overrides.pop(deps.get_current_active_user, None)
    app.dependency_overrides.pop(feedback.get_feedback_service, None)


def _as(env, user_id: int, role: str, username: str):
    env["current"]["user"] = User(id=user_id, username=username, role=role, is_active=True)


def _send(env, **overrides):
    response = env["client"].post("/api/v1/feedback", json=_suggestion(**overrides))
    return response


def test_author_sends_a_suggestion_and_sees_its_status_only_in_own_list(env):
    client = env["client"]
    response = _send(env, title="   Поиск по разделу задач   ")

    assert response.status_code == 201, response.text
    created = response.json()
    assert created["title"] == "Поиск по разделу задач"
    assert created["status"] == "new"
    assert created["admin_note"] is None

    mine = client.get("/api/v1/feedback/mine").json()
    assert mine["total"] == 1
    assert [item["id"] for item in mine["items"]] == [created["id"]]

    _as(env, OTHER, "viewer", "petrov")
    assert client.get("/api/v1/feedback/mine").json()["total"] == 0


def test_invalid_input_is_rejected_and_nothing_is_stored(env):
    client = env["client"]
    rejected = [
        _suggestion(title="  ab  "),
        _suggestion(message="коротко"),
        _suggestion(category="rant"),
        _suggestion(section="x" * 65),
        {**_suggestion(), "unexpected": True},
    ]
    for body in rejected:
        assert client.post("/api/v1/feedback", json=body).status_code == 422, body
    assert client.get("/api/v1/feedback/mine").json()["total"] == 0


def test_double_submit_within_a_minute_returns_the_same_suggestion(env):
    first = _send(env).json()
    env["now"][0] = START + timedelta(seconds=30)
    second = _send(env).json()
    assert second["id"] == first["id"]
    assert env["client"].get("/api/v1/feedback/mine").json()["total"] == 1

    env["now"][0] = START + timedelta(seconds=61)
    third = _send(env).json()
    assert third["id"] != first["id"]
    assert env["client"].get("/api/v1/feedback/mine").json()["total"] == 2


def test_daily_limit_is_five_per_rolling_24_hours(env):
    for index in range(5):
        assert _send(env, title=f"Предложение номер {index}", message=f"Текст предложения номер {index}").status_code == 201

    blocked = _send(env, title="Шестое предложение", message="Текст шестого предложения")
    assert blocked.status_code == 429
    assert "не более 5" in blocked.json()["detail"]

    env["now"][0] = START + timedelta(hours=24, seconds=1)
    assert _send(env, title="Шестое предложение", message="Текст шестого предложения").status_code == 201


def test_admin_sees_all_suggestions_with_authors_and_counts(env):
    client = env["client"]
    _send(env)
    _as(env, OTHER, "viewer", "petrov")
    _send(env, title="Ошибка в отчёте", message="Отчёт не открывается на втором экране", category="bug")

    _as(env, ADMIN, "admin", "admin1")
    listing = client.get("/api/v1/feedback").json()
    assert listing["total"] == 2
    assert listing["counts"] == {"new": 2, "in_progress": 0, "accepted": 0, "declined": 0, "done": 0}
    authors = {item["author"]["username"]: item["author"]["full_name"] for item in listing["items"]}
    assert authors == {"ivanov": "Иванов Иван", "petrov": "Петров Пётр"}

    env["now"][0] = START + timedelta(minutes=5)
    target = next(item for item in listing["items"] if item["author"]["username"] == "petrov")
    client.patch(f"/api/v1/feedback/{target['id']}", json={"status": "in_progress"})
    filtered = client.get("/api/v1/feedback", params={"status": "in_progress"}).json()
    assert filtered["total"] == 1
    assert filtered["items"][0]["id"] == target["id"]
    assert filtered["counts"]["new"] == 1 and filtered["counts"]["in_progress"] == 1


def test_only_feedback_managers_can_list_or_change_suggestions(env):
    client = env["client"]
    item = _send(env).json()

    _as(env, OPERATOR, "operator", "operator1")
    assert client.get("/api/v1/feedback").status_code == 403
    assert client.patch(f"/api/v1/feedback/{item['id']}", json={"status": "done"}).status_code == 403

    _as(env, AUTHOR, "viewer", "ivanov")
    assert client.get("/api/v1/feedback").status_code == 403
    assert client.patch(f"/api/v1/feedback/{item['id']}", json={"status": "done"}).status_code == 403


def test_status_change_is_visible_to_author_and_records_the_handler(env):
    client = env["client"]
    item = _send(env).json()

    _as(env, ADMIN, "admin", "admin1")
    env["now"][0] = START + timedelta(hours=1)
    updated = client.patch(
        f"/api/v1/feedback/{item['id']}",
        json={"status": "accepted", "admin_note": "  Берём в работу, сроки позже  "},
    )
    assert updated.status_code == 200, updated.text
    assert updated.json()["status"] == "accepted"
    assert updated.json()["admin_note"] == "Берём в работу, сроки позже"
    assert updated.json()["author"] == {"id": AUTHOR, "username": "ivanov", "full_name": "Иванов Иван"}

    with env["store"].session() as session:
        row = session.get(AppFeedbackSuggestion, item["id"])
        assert row.handled_by_user_id == ADMIN

    _as(env, AUTHOR, "viewer", "ivanov")
    mine = client.get("/api/v1/feedback/mine").json()["items"][0]
    assert mine["status"] == "accepted"
    assert mine["admin_note"] == "Берём в работу, сроки позже"


def test_patch_keeps_untouched_fields_and_rejects_bad_input(env):
    client = env["client"]
    item = _send(env).json()
    _as(env, ADMIN, "admin", "admin1")
    url = f"/api/v1/feedback/{item['id']}"

    assert client.patch(url, json={"status": "declined", "admin_note": "Не подходит"}).status_code == 200
    cleared = client.patch(url, json={"admin_note": None}).json()
    assert cleared["admin_note"] is None
    assert cleared["status"] == "declined"

    assert client.patch(url, json={"status": "wontfix"}).status_code == 422
    assert client.patch(url, json={"status": "done", "title": "other"}).status_code == 422
    assert client.patch(url, json={"admin_note": "x" * 1001}).status_code == 422
    assert client.patch("/api/v1/feedback/no-such-id", json={"status": "done"}).status_code == 404


def test_missing_table_answers_503_without_breaking_the_app(env):
    client = env["client"]
    engine = get_app_engine(env["url"])
    with engine.begin() as connection:
        connection.exec_driver_sql(f"DROP TABLE {TABLE}")

    response = _send(env)
    assert response.status_code == 503
    assert response.json()["detail"] == "Раздел предложений ещё не подключён на сервере"
    assert client.get("/api/v1/feedback/mine").status_code == 503
    assert client.get("/health").status_code == 200

    AppFeedbackSuggestion.__table__.create(bind=engine)
    assert _send(env).status_code == 201


def _run_migration(connection, step: str, scope: str = "app") -> None:
    namespace = runpy.run_path(str(REVISION))
    function = namespace[step]
    function.__globals__["op"] = Operations(MigrationContext.configure(connection))
    function.__globals__["_scope"] = lambda: scope
    function()


def _shape(connection) -> dict:
    inspector = sa.inspect(connection)
    return {
        "columns": {
            column["name"]: (type(column["type"]).__name__, bool(column["nullable"]))
            for column in inspector.get_columns(TABLE)
        },
        "primary_key": inspector.get_pk_constraint(TABLE)["constrained_columns"],
        "indexes": {item["name"]: tuple(item["column_names"]) for item in inspector.get_indexes(TABLE)},
    }


def test_migration_creates_the_table_exactly_as_the_orm_model_describes_it():
    models_engine = sa.create_engine("sqlite+pysqlite:///:memory:", future=True).execution_options(
        schema_translate_map={"app": None}
    )
    migrated_engine = sa.create_engine("sqlite+pysqlite:///:memory:", future=True)
    with models_engine.begin() as models_connection, migrated_engine.begin() as migrated_connection:
        AppBase.metadata.create_all(models_connection, tables=[AppFeedbackSuggestion.__table__])
        _run_migration(migrated_connection, "upgrade")
        assert _shape(migrated_connection) == _shape(models_connection)


def test_migration_upgrade_is_idempotent_and_keeps_existing_rows():
    engine = sa.create_engine("sqlite+pysqlite:///:memory:", future=True)
    with engine.begin() as connection:
        _run_migration(connection, "upgrade")
        connection.exec_driver_sql(
            "INSERT INTO feedback_suggestions (id, user_id, category, title, message, status, created_at, updated_at) "
            "VALUES ('s-1', 10, 'bug', 'Заголовок', 'Текст предложения', 'new', '2026-10-27', '2026-10-27')"
        )
        _run_migration(connection, "upgrade")

        assert connection.exec_driver_sql("SELECT id FROM feedback_suggestions").fetchall() == [("s-1",)]


def test_migration_downgrade_drops_the_table_and_is_safe_to_repeat():
    engine = sa.create_engine("sqlite+pysqlite:///:memory:", future=True)
    with engine.begin() as connection:
        _run_migration(connection, "upgrade")
        _run_migration(connection, "downgrade")
        assert not sa.inspect(connection).has_table(TABLE)
        _run_migration(connection, "downgrade")


def test_chat_scope_does_not_create_the_app_table():
    engine = sa.create_engine("sqlite+pysqlite:///:memory:", future=True)
    with engine.begin() as connection:
        _run_migration(connection, "upgrade", scope="chat")
        assert not sa.inspect(connection).has_table(TABLE)
