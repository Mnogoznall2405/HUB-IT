from __future__ import annotations

import sys
from pathlib import Path
from types import SimpleNamespace
from unittest.mock import MagicMock

PROJECT_ROOT = Path(__file__).resolve().parents[1]
WEB_ROOT = PROJECT_ROOT / "WEB-itinvent"
if str(WEB_ROOT) not in sys.path:
    sys.path.insert(0, str(WEB_ROOT))

from backend.chat.chat_formatting import (  # noqa: E402
    CHAT_UNKNOWN_SENDER_NAME,
    is_synthetic_chat_username,
    usable_chat_username,
)
from backend.chat.chat_serialization import ChatSerialization  # noqa: E402
from backend.chat.service import ChatService  # noqa: E402


def test_synthetic_chat_username_helpers() -> None:
    assert is_synthetic_chat_username("user-64") is True
    assert is_synthetic_chat_username("USER-64") is True
    assert is_synthetic_chat_username("kme") is False
    assert usable_chat_username("user-64") == ""
    assert usable_chat_username("kozlovsky") == "kozlovsky"


def test_short_user_name_prefers_last_name_and_ignores_user_id_stub() -> None:
    assert ChatService._get_short_user_name({
        "full_name": "Козловский Максим Евгеньевич",
        "username": "user-64",
    }) == "Козловский"
    assert ChatService._get_short_user_name({
        "full_name": None,
        "username": "user-64",
    }) == ""
    assert ChatService._get_short_user_name({
        "full_name": None,
        "username": "kme",
    }) == "kme"


def test_reply_preview_payload_does_not_expose_user_id_stub() -> None:
    service = ChatService.__new__(ChatService)
    payload = ChatService._message_reference_preview_payload(
        service,
        message=SimpleNamespace(
            id="quoted-1",
            sender_user_id=64,
            kind="text",
            body="а это нихуа",
            is_deleted=False,
        ),
        attachments=[],
        users_by_id={},
        sender_fallback={},
    )
    assert payload["sender_name"] == CHAT_UNKNOWN_SENDER_NAME
    assert "user-64" not in payload["sender_name"]


def test_build_reply_previews_loads_quoted_sender_missing_from_page_users() -> None:
    service = MagicMock()
    serialization = ChatSerialization(service)
    quoted = SimpleNamespace(id="quoted-1", sender_user_id=64)
    session = MagicMock()
    session.execute.return_value.scalars.return_value = [quoted]
    service._list_attachments_by_message.return_value = {"quoted-1": []}
    service._get_users_map.return_value = {
        64: {"id": 64, "username": "kme", "full_name": "Козловский Максим Евгеньевич"},
    }
    captured: dict[str, dict] = {}

    def capture_payload(*, message, attachments, users_by_id):
        captured["users_by_id"] = users_by_id
        return {"id": message.id, "sender_name": "Козловский"}

    service._reply_preview_payload.side_effect = capture_payload

    result = serialization._build_reply_previews(
        session=session,
        reply_to_message_ids=["quoted-1"],
        users_by_id={2: {"id": 2, "full_name": "Иванов Иван"}},
    )

    service._get_users_map.assert_called_once()
    requested_ids = set(service._get_users_map.call_args.kwargs["user_ids"])
    assert requested_ids == {64}
    assert captured["users_by_id"][64]["full_name"] == "Козловский Максим Евгеньевич"
    assert captured["users_by_id"][2]["full_name"] == "Иванов Иван"
    assert result["quoted-1"]["sender_name"] == "Козловский"
