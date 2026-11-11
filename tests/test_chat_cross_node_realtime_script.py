from __future__ import annotations

import asyncio
import importlib.util
import json
import sys
from pathlib import Path
from types import SimpleNamespace

import pytest


ROOT = Path(__file__).resolve().parents[1]
SCRIPT = ROOT / "scripts" / "check_chat_cross_node_realtime.py"


def _load_module():
    spec = importlib.util.spec_from_file_location("check_chat_cross_node_realtime", SCRIPT)
    assert spec and spec.loader
    module = importlib.util.module_from_spec(spec)
    sys.modules[spec.name] = module
    spec.loader.exec_module(module)
    return module


def test_url_helpers_target_each_chat_node_and_root_readiness():
    module = _load_module()

    assert module.api_to_ws_url("http://127.0.0.1:8002/api/v1/") == "ws://127.0.0.1:8002/api/v1/chat/ws"
    assert module.api_to_ws_url("https://hub.example/api/v1") == "wss://hub.example/api/v1/chat/ws"
    assert module.api_to_readiness_url("http://127.0.0.1:8004/api/v1") == "http://127.0.0.1:8004/health/ready"
    insecure = module.build_ssl_context(True)
    assert insecure is not None
    assert insecure.check_hostname is False


def test_load_credentials_supports_list_and_requires_two_users(tmp_path):
    module = _load_module()
    path = tmp_path / "users.json"
    path.write_text(
        json.dumps(
            [
                {"username": "sender", "password": "secret-a"},
                {"username": "recipient", "password": "secret-b"},
            ]
        ),
        encoding="utf-8",
    )

    credentials = module.load_credentials(path)

    assert [item.username for item in credentials] == ["sender", "recipient"]


def test_validate_distinct_nodes_rejects_same_node_and_local_transport():
    module = _load_module()

    with pytest.raises(module.ProbeFailure, match="same realtime node"):
        module.validate_distinct_ready_nodes(
            {"realtime_node_id": "chat-a", "realtime_mode": "postgres_notify"},
            {"realtime_node_id": "chat-a", "realtime_mode": "postgres_notify"},
        )

    with pytest.raises(module.ProbeFailure, match="not ready"):
        module.validate_distinct_ready_nodes(
            {"realtime_node_id": "chat-a", "realtime_mode": "local"},
            {"realtime_node_id": "chat-b", "realtime_mode": "postgres_notify"},
        )


def test_require_exactly_once_accepts_one_event_and_rejects_room_inbox_duplicate():
    module = _load_module()
    client_message_id = "cross-node-123"
    event = {
        "type": "chat.message.created",
        "payload": {"id": "message-1", "client_message_id": client_message_id},
    }
    predicate = module.message_created_predicate(client_message_id)

    async def scenario():
        single = SimpleNamespace(events=[event])

        async def wait_single(_predicate, *, timeout_sec, start_index=0):
            return event

        single.wait_for_event = wait_single
        matched, _elapsed = await module.require_exactly_once(
            single,
            predicate,
            start_index=0,
            timeout_sec=0.1,
            settle_sec=0.01,
            label="single",
        )
        assert matched is event

        duplicate = SimpleNamespace(events=[event, dict(event)])
        duplicate.wait_for_event = wait_single
        with pytest.raises(module.ProbeFailure, match="observed 2"):
            await module.require_exactly_once(
                duplicate,
                predicate,
                start_index=0,
                timeout_sec=0.1,
                settle_sec=0.01,
                label="room_and_inbox",
            )

    asyncio.run(scenario())


def test_message_read_predicate_correlates_message_and_reader():
    module = _load_module()
    predicate = module.message_read_predicate("message-2", 42)

    assert predicate(
        {
            "type": "chat.message.read",
            "payload": {"message_id": "message-2", "reader_user_id": 42},
        }
    )
    assert not predicate(
        {
            "type": "chat.message.read",
            "payload": {"message_id": "message-2", "reader_user_id": 43},
        }
    )


def test_auth_session_forwards_internal_test_ip_to_http_and_websocket():
    module = _load_module()
    session = module.AuthSession(
        credential=module.Credential(username="sender", password="secret"),
        user_id=42,
        access_token="token",
        cookie_header="access_token=cookie",
        client_ip="127.0.0.101",
    )

    headers = session.http_headers()

    assert headers["X-Forwarded-For"] == "127.0.0.101"
    assert headers["X-Real-IP"] == "127.0.0.101"
    assert ("X-Forwarded-For", "127.0.0.101") in session.ws_headers()


def test_login_requests_mobile_bearer_delivery_for_loopback_probe():
    source = SCRIPT.read_text(encoding="utf-8")

    assert 'network_headers = {"X-Auth-Client": "mobile"}' in source
