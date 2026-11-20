"""Race regression: two parallel POST /conversations/direct must not 500 on the direct_key unique index."""
from __future__ import annotations

import importlib
import sys
import threading
from pathlib import Path
from types import SimpleNamespace

import pytest
from sqlalchemy import select
from sqlalchemy.orm import Session

PROJECT_ROOT = Path(__file__).resolve().parents[1]
WEB_ROOT = PROJECT_ROOT / "WEB-itinvent"
if str(WEB_ROOT) not in sys.path:
    sys.path.insert(0, str(WEB_ROOT))

chat_db_module = importlib.import_module("backend.chat.db")
chat_models_module = importlib.import_module("backend.chat.models")
chat_service_module = importlib.import_module("backend.chat.service")
hub_service_module = importlib.import_module("backend.services.hub_service")


def _raw_user(user_id: int, username: str) -> dict:
    return {
        "id": user_id,
        "username": username,
        "full_name": f"User {user_id}",
        "role": "operator",
        "is_active": True,
        "use_custom_permissions": False,
        "custom_permissions": [],
        "permissions": [],
    }


@pytest.fixture
def chat_env(temp_dir, monkeypatch):
    raw_users = {1: _raw_user(1, "alice"), 2: _raw_user(2, "bob")}
    users = list(raw_users.values())
    users_by_id = dict(raw_users)
    store = SimpleNamespace(
        db_path=str(Path(temp_dir) / "hub.sqlite3"),
        data_dir=str(Path(temp_dir) / "hub-data"),
    )
    Path(store.data_dir).mkdir(parents=True, exist_ok=True)

    monkeypatch.setattr(hub_service_module, "get_local_store", lambda: store)
    monkeypatch.setattr(hub_service_module, "is_app_database_configured", lambda: False)
    monkeypatch.setattr(hub_service_module.user_service, "list_users", lambda: list(users))
    monkeypatch.setattr(hub_service_module.user_service, "get_by_id", lambda user_id: users_by_id.get(int(user_id)))
    monkeypatch.setattr(chat_service_module.user_service, "list_users", lambda: list(users))
    monkeypatch.setattr(chat_service_module.user_service, "get_by_id", lambda user_id: users_by_id.get(int(user_id)))
    monkeypatch.setattr(chat_service_module.user_service, "to_public_user", lambda raw: dict(raw))

    hub_service = hub_service_module.HubService()
    monkeypatch.setattr(hub_service_module, "hub_service", hub_service)
    monkeypatch.setattr(chat_service_module, "hub_service", hub_service)

    chat_db_module._engine = None
    chat_db_module._session_factory = None
    monkeypatch.setattr(chat_db_module.config.chat, "enabled", True, raising=False)
    monkeypatch.setattr(
        chat_db_module.config.chat,
        "database_url",
        f"sqlite:///{Path(temp_dir) / 'chat.sqlite3'}",
        raising=False,
    )
    monkeypatch.setattr(chat_db_module.config.chat, "pool_size", 5, raising=False)
    monkeypatch.setattr(chat_db_module.config.chat, "max_overflow", 10, raising=False)

    service = chat_service_module.ChatService()
    service._ensure_available()
    yield {"service": service}
    chat_db_module._engine = None
    chat_db_module._session_factory = None


def test_concurrent_direct_create_returns_one_conversation(chat_env, monkeypatch):
    # Production failure seen in logs: two parallel POSTs both read "no direct",
    # both INSERT, loser hits UniqueViolation on ix_chat_conversations_direct_key → 500.
    # The barrier keeps both lookups racing so the regression is deterministic.
    service = chat_env["service"]
    gate = threading.Barrier(2)
    original_execute = Session.execute
    barrier_budget = [2]

    def racing_execute(self, statement, *args, **kwargs):
        compiled = str(statement)
        if barrier_budget[0] > 0 and "chat_conversations" in compiled and "direct_key" in compiled:
            barrier_budget[0] -= 1
            gate.wait(timeout=5)
        return original_execute(self, statement, *args, **kwargs)

    monkeypatch.setattr(Session, "execute", racing_execute)
    results: list[dict] = []
    errors: list[BaseException] = []

    def create():
        try:
            results.append(service.create_direct_conversation(current_user_id=1, peer_user_id=2))
        except BaseException as exc:  # pragma: no cover - asserted below
            errors.append(exc)

    threads = [threading.Thread(target=create) for _ in range(2)]
    for thread in threads:
        thread.start()
    for thread in threads:
        thread.join(timeout=15)

    assert all(not thread.is_alive() for thread in threads)
    assert errors == []
    assert len(results) == 2
    assert results[0]["id"] == results[1]["id"]
    with chat_db_module.chat_session() as session:
        rows = session.execute(
            select(chat_models_module.ChatConversation).where(
                chat_models_module.ChatConversation.kind == "direct",
            )
        ).scalars().all()
        assert len(rows) == 1


def test_direct_create_recovers_when_check_missed_committed_row(chat_env, monkeypatch):
    # Recovery branch without threads: the pre-check SELECT is forced stale (returns
    # None once) while a committed row already holds the direct_key — the INSERT
    # must surface as "return existing", not as an IntegrityError to the caller.
    service = chat_env["service"]
    existing = service.create_direct_conversation(current_user_id=1, peer_user_id=2)

    original_execute = Session.execute
    stale_budget = [1]

    class _EmptyScalarResult:
        def scalar_one_or_none(self):
            return None

    def stale_execute(self, statement, *args, **kwargs):
        compiled = str(statement)
        if stale_budget[0] > 0 and "chat_conversations" in compiled and "direct_key" in compiled:
            stale_budget[0] -= 1
            return _EmptyScalarResult()
        return original_execute(self, statement, *args, **kwargs)

    monkeypatch.setattr(Session, "execute", stale_execute)

    result = service.create_direct_conversation(current_user_id=1, peer_user_id=2)
    assert result["id"] == existing["id"]


def test_notes_conversation_create_is_idempotent_under_race(chat_env, monkeypatch):
    # Same unique-key find-then-insert on notes_key — shared fix path.
    service = chat_env["service"]
    gate = threading.Barrier(2)
    original_execute = Session.execute
    barrier_budget = [2]

    def racing_execute(self, statement, *args, **kwargs):
        compiled = str(statement)
        if barrier_budget[0] > 0 and "chat_conversations" in compiled and "direct_key" in compiled:
            barrier_budget[0] -= 1
            gate.wait(timeout=5)
        return original_execute(self, statement, *args, **kwargs)

    monkeypatch.setattr(Session, "execute", racing_execute)
    results: list[dict] = []
    errors: list[BaseException] = []

    def create():
        try:
            results.append(service.get_or_create_notes_conversation(current_user_id=1))
        except BaseException as exc:  # pragma: no cover - asserted below
            errors.append(exc)

    threads = [threading.Thread(target=create) for _ in range(2)]
    for thread in threads:
        thread.start()
    for thread in threads:
        thread.join(timeout=15)

    assert all(not thread.is_alive() for thread in threads)
    assert errors == []
    assert len(results) == 2
    assert results[0]["id"] == results[1]["id"]
