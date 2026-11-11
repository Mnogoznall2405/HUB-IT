"""F-POLL: kind='poll' persistence and vote_poll aggregation (sqlite fixture)."""
from __future__ import annotations

import json
import sys
from pathlib import Path
from types import SimpleNamespace

import pytest

PROJECT_ROOT = Path(__file__).resolve().parents[1]
WEB_ROOT = PROJECT_ROOT / "WEB-itinvent"
if str(WEB_ROOT) not in sys.path:
    sys.path.insert(0, str(WEB_ROOT))

from backend.chat import db as chat_db_module  # noqa: E402
from backend.chat import service as chat_service_module  # noqa: E402
from backend.services import hub_service as hub_service_module  # noqa: E402


def _raw_user(user_id, username, full_name):
    return {
        "id": int(user_id),
        "username": username,
        "full_name": full_name,
        "role": "operator",
        "is_active": True,
        "presence": None,
    }


@pytest.fixture
def chat_env(temp_dir, monkeypatch):
    raw_users = {1: _raw_user(1, "author", "Author"), 2: _raw_user(2, "voter", "Voter")}
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
    monkeypatch.setattr(
        hub_service_module.user_service, "get_by_id",
        lambda user_id: users_by_id.get(int(user_id)),
    )
    monkeypatch.setattr(chat_service_module.user_service, "list_users", lambda: list(users))
    monkeypatch.setattr(
        chat_service_module.user_service, "get_by_id",
        lambda user_id: users_by_id.get(int(user_id)),
    )
    monkeypatch.setattr(chat_service_module.user_service, "to_public_user", lambda raw: dict(raw))
    hub_service = hub_service_module.HubService()
    monkeypatch.setattr(chat_service_module, "hub_service", hub_service)

    chat_db_module._engine = None
    chat_db_module._session_factory = None
    monkeypatch.setattr(chat_db_module.config.chat, "enabled", True, raising=False)
    monkeypatch.setattr(
        chat_db_module.config.chat, "database_url",
        f"sqlite:///{Path(temp_dir) / 'chat.sqlite3'}", raising=False,
    )
    monkeypatch.setattr(chat_db_module.config.chat, "pool_size", 5, raising=False)
    monkeypatch.setattr(chat_db_module.config.chat, "max_overflow", 10, raising=False)

    service = chat_service_module.ChatService()
    direct = service.create_direct_conversation(current_user_id=1, peer_user_id=2)
    yield {"service": service, "direct": direct}

    chat_db_module._engine = None
    chat_db_module._session_factory = None


def _send_poll(service, conversation_id):
    return service.send_message(
        current_user_id=1,
        conversation_id=conversation_id,
        body=json.dumps({"question": "Обед?", "options": ["Да", "Нет", "Воздержусь"]}),
        kind="poll",
    )


def test_send_poll_persists_kind_and_serializes_payload(chat_env):
    service = chat_env["service"]
    conversation_id = chat_env["direct"]["id"]
    created = _send_poll(service, conversation_id)
    assert created["kind"] == "poll"
    body = json.loads(created["body"])
    assert body["question"] == "Обед?"
    assert body["options"] == ["Да", "Нет", "Воздержусь"]
    assert created["poll"]["options"][0]["votes"] == 0
    assert created["poll"]["total_voters"] == 0
    assert created["poll"]["my_option_index"] is None


def test_poll_body_requires_two_options(chat_env):
    service = chat_env["service"]
    conversation_id = chat_env["direct"]["id"]
    with pytest.raises(ValueError):
        service.send_message(
            current_user_id=1,
            conversation_id=conversation_id,
            body=json.dumps({"question": "Q", "options": ["только один"]}),
            kind="poll",
        )


def test_vote_change_and_retract(chat_env):
    service = chat_env["service"]
    conversation_id = chat_env["direct"]["id"]
    created = _send_poll(service, conversation_id)
    message_id = created["id"]

    result = service.vote_poll(
        current_user_id=2, conversation_id=conversation_id,
        message_id=message_id, option_index=1,
    )
    assert result["action"] == "voted"
    assert result["poll"]["options"][1]["votes"] == 1
    assert result["poll"]["total_voters"] == 1
    assert result["poll"]["my_option_index"] == 1

    changed = service.vote_poll(
        current_user_id=2, conversation_id=conversation_id,
        message_id=message_id, option_index=0,
    )
    assert changed["action"] == "changed"
    assert changed["poll"]["options"][0]["votes"] == 1
    assert changed["poll"]["options"][1]["votes"] == 0

    retracted = service.vote_poll(
        current_user_id=2, conversation_id=conversation_id,
        message_id=message_id, option_index=0,
    )
    assert retracted["action"] == "retracted"
    assert retracted["poll"]["total_voters"] == 0
    assert retracted["poll"]["my_option_index"] is None


def test_vote_rejects_out_of_range_and_non_poll(chat_env):
    service = chat_env["service"]
    conversation_id = chat_env["direct"]["id"]
    created = _send_poll(service, conversation_id)
    with pytest.raises(ValueError):
        service.vote_poll(
            current_user_id=2, conversation_id=conversation_id,
            message_id=created["id"], option_index=9,
        )
    text_msg = service.send_message(
        current_user_id=1, conversation_id=conversation_id, body="обычный текст",
    )
    with pytest.raises(ValueError):
        service.vote_poll(
            current_user_id=2, conversation_id=conversation_id,
            message_id=text_msg["id"], option_index=0,
        )


def test_close_poll_author_only_and_blocks_votes(chat_env):
    """R-POLL-2: only the author closes; closed polls reject new votes and
    stay closed on a repeated close (idempotent)."""
    service = chat_env["service"]
    conversation_id = chat_env["direct"]["id"]
    created = _send_poll(service, conversation_id)
    message_id = created["id"]

    service.vote_poll(
        current_user_id=2, conversation_id=conversation_id,
        message_id=message_id, option_index=1,
    )
    with pytest.raises(PermissionError):
        service.close_poll(
            current_user_id=2, conversation_id=conversation_id, message_id=message_id,
        )

    closed = service.close_poll(
        current_user_id=1, conversation_id=conversation_id, message_id=message_id,
    )
    assert closed["action"] == "closed"
    assert closed["poll"]["closed"] is True
    assert closed["poll"]["options"][1]["votes"] == 1

    again = service.close_poll(
        current_user_id=1, conversation_id=conversation_id, message_id=message_id,
    )
    assert again["action"] == "already_closed"

    with pytest.raises(ValueError):
        service.vote_poll(
            current_user_id=2, conversation_id=conversation_id,
            message_id=message_id, option_index=0,
        )

    serialized = service.get_message(current_user_id=1, message_id=message_id)
    assert serialized["poll"]["closed"] is True


def test_ws_poll_option_index_requires_valid_int():
    """Nit 20.6: WS chat.poll_vote must not silently vote option 0 on a
    missing/malformed index — same contract as REST PollVoteRequest."""
    from backend.chat import ws_commands

    assert ws_commands._poll_option_index({"option_index": 0}) == 0
    assert ws_commands._poll_option_index({"option_index": 9}) == 9
    for bad in ({}, {"option_index": None}, {"option_index": "0"},
                {"option_index": True}, {"option_index": 1.5},
                {"option_index": -1}, {"option_index": 10}):
        with pytest.raises(ValueError):
            ws_commands._poll_option_index(bad)
