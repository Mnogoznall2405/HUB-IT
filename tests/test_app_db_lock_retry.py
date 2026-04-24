from __future__ import annotations

import importlib
import shutil
import sys
from contextlib import contextmanager
from pathlib import Path
from uuid import uuid4

from sqlalchemy.exc import OperationalError


PROJECT_ROOT = Path(__file__).resolve().parents[1]
WEB_ROOT = PROJECT_ROOT / "WEB-itinvent"

if str(WEB_ROOT) not in sys.path:
    sys.path.insert(0, str(WEB_ROOT))


class _DummyLockNotAvailable(Exception):
    sqlstate = "55P03"


def _make_lock_error(statement: str) -> OperationalError:
    return OperationalError(statement, {}, _DummyLockNotAvailable())


def _sqlite_url(tmp_path: Path, name: str) -> str:
    return f"sqlite:///{(tmp_path / name).as_posix()}"


def _make_workspace_temp_dir(name: str) -> Path:
    path = PROJECT_ROOT / "_codex_test_tmp" / f"{name}_{uuid4().hex}"
    path.mkdir(parents=True, exist_ok=True)
    return path


def _configure_app_db_runtime(tmp_path: Path, monkeypatch, name: str) -> str:
    database_url = _sqlite_url(tmp_path, name)
    backend_config = importlib.import_module("backend.config")
    appdb_db = importlib.import_module("backend.appdb.db")

    monkeypatch.setenv("APP_DATABASE_URL", database_url)
    monkeypatch.setattr(backend_config.config.app_db, "database_url", database_url, raising=False)
    monkeypatch.setattr(appdb_db.config.app_db, "database_url", database_url, raising=False)
    appdb_db._engines.clear()
    appdb_db._session_factories.clear()
    appdb_db._initialized_schema_urls.clear()
    return database_url


def test_run_with_transient_lock_retry_retries_lock_not_available(monkeypatch):
    appdb_db = importlib.import_module("backend.appdb.db")
    sleep_calls: list[float] = []
    call_count = {"value": 0}

    monkeypatch.setattr(appdb_db.time, "sleep", lambda delay: sleep_calls.append(delay))

    def _operation() -> str:
        call_count["value"] += 1
        if call_count["value"] < 3:
            raise _make_lock_error("SELECT 1")
        return "ok"

    result = appdb_db.run_with_transient_lock_retry(
        _operation,
        attempts=4,
        initial_delay_sec=0.1,
        max_delay_sec=0.5,
    )

    assert result == "ok"
    assert call_count["value"] == 3
    assert sleep_calls == [0.1, 0.2]


def test_user_service_retries_transient_lock_on_app_users(monkeypatch):
    temp_dir = _make_workspace_temp_dir("users_lock_retry")
    try:
        database_url = _configure_app_db_runtime(temp_dir, monkeypatch, "users_lock_retry.db")
        appdb_db = importlib.import_module("backend.appdb.db")
        user_service_module = importlib.import_module("backend.services.user_service")

        monkeypatch.setattr(appdb_db.time, "sleep", lambda _delay: None)
        service = user_service_module.UserService(
            file_path=temp_dir / "web_users.json",
            database_url=database_url,
        )
        real_app_session = user_service_module.app_session
        call_count = {"value": 0}

        @contextmanager
        def _flaky_app_session(database_url: str | None = None):
            if call_count["value"] == 0:
                call_count["value"] += 1
                raise _make_lock_error("SELECT app.users")
            call_count["value"] += 1
            with real_app_session(database_url) as session:
                yield session

        monkeypatch.setattr(user_service_module, "app_session", _flaky_app_session)

        users = service.list_users()

        assert any(item["username"] == "admin" for item in users)
        assert call_count["value"] == 2
    finally:
        shutil.rmtree(temp_dir, ignore_errors=True)


def test_ai_chat_service_retries_transient_lock_on_default_bot(monkeypatch):
    temp_dir = _make_workspace_temp_dir("ai_bot_lock_retry")
    try:
        database_url = _configure_app_db_runtime(temp_dir, monkeypatch, "ai_bot_lock_retry.db")
        appdb_db = importlib.import_module("backend.appdb.db")
        ai_chat_module = importlib.import_module("backend.ai_chat.service")
        user_service_module = importlib.import_module("backend.services.user_service")

        monkeypatch.setattr(appdb_db.time, "sleep", lambda _delay: None)
        temp_user_service = user_service_module.UserService(
            file_path=temp_dir / "ai_users.json",
            database_url=database_url,
        )
        service = ai_chat_module.AiChatService()
        real_app_session = ai_chat_module.app_session
        call_count = {"value": 0}

        @contextmanager
        def _flaky_app_session(database_url: str | None = None):
            if call_count["value"] == 0:
                call_count["value"] += 1
                raise _make_lock_error("SELECT app.ai_bots")
            call_count["value"] += 1
            with real_app_session(database_url) as session:
                yield session

        monkeypatch.setattr(ai_chat_module, "app_session", _flaky_app_session)
        monkeypatch.setattr(ai_chat_module, "user_service", temp_user_service)

        bot = service.ensure_default_bot()

        assert bot["slug"] == "corp-assistant"
        assert call_count["value"] == 2
    finally:
        shutil.rmtree(temp_dir, ignore_errors=True)
