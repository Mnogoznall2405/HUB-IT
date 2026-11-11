from __future__ import annotations

from types import SimpleNamespace
from unittest.mock import MagicMock, patch

from sqlalchemy import true

import pytest

from backend.chat.chat_thread_read_store import ChatThreadReadStore


@pytest.fixture
def service() -> MagicMock:
    return MagicMock()


@pytest.fixture
def store(service: MagicMock) -> ChatThreadReadStore:
    return ChatThreadReadStore(service)


def test_search_messages_returns_empty_for_blank_query(store: ChatThreadReadStore) -> None:
    result = store.search_messages(
        current_user_id=1,
        conversation_id="conv-1",
        q="   ",
    )
    assert result == {"items": [], "has_more": False}


def test_get_messages_rejects_conflicting_cursors(store: ChatThreadReadStore) -> None:
    with pytest.raises(ValueError, match="cannot be used together"):
        store.get_messages(
            current_user_id=1,
            conversation_id="conv-1",
            before_message_id="m-before",
            after_message_id="m-after",
        )


def test_get_messages_returns_cached_latest_payload(store: ChatThreadReadStore, service: MagicMock) -> None:
    cached = {"items": [{"id": "m-1"}], "cursor_invalid": False}
    service._cache_get.return_value = cached

    result = store.get_messages(
        current_user_id=7,
        conversation_id="conv-1",
        limit=50,
    )

    assert result is cached
    service._cache_get.assert_called_once_with(
        user_id=7,
        bucket="thread_latest",
        extra="conv-1|50",
    )
    service._set_request_meta.assert_called_once()
    assert service._set_request_meta.call_args.kwargs["cache_hit"] is True


@patch("backend.chat.chat_thread_read_store.chat_session")
def test_serialize_thread_messages_payload_lightweight(
    chat_session_mock: MagicMock,
    store: ChatThreadReadStore,
    service: MagicMock,
) -> None:
    session = MagicMock()
    chat_session_mock.return_value.__enter__.return_value = session

    conversation = SimpleNamespace(id="conv-1", kind="group")
    message = SimpleNamespace(
        id="m-1",
        sender_user_id=2,
        reply_to_message_id=None,
        forward_from_message_id=None,
    )
    viewer_state = SimpleNamespace(last_read_message_id="m-0", last_read_at=None)

    session.execute.return_value.scalar_one_or_none.return_value = viewer_state
    service._batch_action_cards_for_messages.return_value = {}
    service._list_attachments_by_message.return_value = {}
    service._get_users_map.return_value = {2: {"id": 2, "username": "alice"}}
    service._build_reply_previews.return_value = {}
    service._build_forward_previews.return_value = {}
    service._serialize_message.return_value = {"id": "m-1", "body": "hello"}

    payload = store._serialize_thread_messages_payload(
        session=session,
        conversation=conversation,
        current_user_id=1,
        messages=[message],
        has_older=False,
        has_newer=True,
        lightweight=True,
    )

    assert payload["items"] == [{"id": "m-1", "body": "hello"}]
    assert payload["has_newer"] is True
    assert payload["has_older"] is False
    assert payload["cursor_invalid"] is False
    service._serialize_message.assert_called_once()
    service._list_attachments_by_message.assert_called_once_with(
        session=session,
        message_ids=["m-1"],
    )


@patch("backend.chat.chat_thread_read_store.chat_session")
def test_get_thread_bootstrap_uses_lightweight_mode_by_default(
    chat_session_mock: MagicMock,
    store: ChatThreadReadStore,
    service: MagicMock,
) -> None:
    session = MagicMock()
    chat_session_mock.return_value.__enter__.return_value = session
    conversation = SimpleNamespace(id="conv-1", kind="group")
    message = SimpleNamespace(id="m-1", sender_user_id=2)
    service._cache_get.return_value = None
    service._require_membership.return_value = conversation
    session.execute.return_value.scalar_one_or_none.return_value = SimpleNamespace(
        last_read_message_id=None,
        last_read_seq=0,
        unread_count=0,
    )
    session.execute.return_value.scalars.return_value = iter([message])
    service._serialize_thread_messages_payload.return_value = {
        "items": [{"id": "m-1"}],
        "has_older": False,
        "has_newer": False,
    }

    result = store.get_thread_bootstrap(
        current_user_id=1,
        conversation_id="conv-1",
        limit=40,
    )

    assert result["initial_anchor_mode"] == "bottom"
    service._serialize_thread_messages_payload.assert_called_once()
    assert service._serialize_thread_messages_payload.call_args.kwargs["lightweight"] is True
    service._cache_get.assert_called_once()
    assert "lw:1" in service._cache_get.call_args.kwargs["extra"]


@patch("backend.chat.chat_thread_read_store.chat_session")
def test_get_thread_bootstrap_anchors_on_first_unread(
    chat_session_mock: MagicMock,
    store: ChatThreadReadStore,
    service: MagicMock,
) -> None:
    session = MagicMock()
    chat_session_mock.return_value.__enter__.return_value = session
    conversation = SimpleNamespace(id="conv-1", kind="group")
    viewer_state = SimpleNamespace(last_read_message_id="m-3", last_read_seq=3, unread_count=4)
    first_unread = SimpleNamespace(id="m-4", conversation_id="conv-1")
    older = SimpleNamespace(id="m-3", conversation_id="conv-1")

    service._cache_get.return_value = None
    service._require_membership.return_value = conversation
    service._find_first_unread_message.return_value = first_unread
    service._has_message_before.return_value = False
    service._has_message_after.return_value = True
    service._message_before_anchor_condition.return_value = true()
    service._message_after_anchor_condition.return_value = true()
    session.execute.return_value.scalar_one_or_none.return_value = viewer_state
    session.execute.return_value.scalars.side_effect = [
        iter([older]),
        iter([first_unread]),
    ]
    service._serialize_thread_messages_payload.return_value = {
        "items": [{"id": "m-3"}, {"id": "m-4"}],
        "has_older": False,
        "has_newer": True,
    }

    result = store.get_thread_bootstrap(
        current_user_id=1,
        conversation_id="conv-1",
        limit=40,
    )

    assert result["initial_anchor_mode"] == "first_unread"
    assert result["initial_anchor_message_id"] == "m-4"
    service._find_first_unread_message.assert_called_once()
    assert service._find_first_unread_message.call_args.kwargs["viewer_last_read_message_id"] == "m-3"
    assert service._find_first_unread_message.call_args.kwargs["viewer_last_read_seq"] == 3


@patch("backend.chat.chat_thread_read_store.chat_session")
def test_get_thread_bootstrap_first_unread_allows_message_id_boundary_only(
    chat_session_mock: MagicMock,
    store: ChatThreadReadStore,
    service: MagicMock,
) -> None:
    session = MagicMock()
    chat_session_mock.return_value.__enter__.return_value = session
    conversation = SimpleNamespace(id="conv-1", kind="group")
    viewer_state = SimpleNamespace(last_read_message_id="m-3", last_read_seq=0, unread_count=2)
    first_unread = SimpleNamespace(id="m-4", conversation_id="conv-1")

    service._cache_get.return_value = None
    service._require_membership.return_value = conversation
    service._find_first_unread_message.return_value = first_unread
    service._has_message_before.return_value = False
    service._has_message_after.return_value = True
    service._message_before_anchor_condition.return_value = true()
    service._message_after_anchor_condition.return_value = true()
    session.execute.return_value.scalar_one_or_none.return_value = viewer_state
    session.execute.return_value.scalars.side_effect = [
        iter([]),
        iter([first_unread]),
    ]
    service._serialize_thread_messages_payload.return_value = {
        "items": [{"id": "m-4"}],
        "has_older": False,
        "has_newer": True,
    }

    result = store.get_thread_bootstrap(
        current_user_id=1,
        conversation_id="conv-1",
        limit=40,
    )

    assert result["initial_anchor_mode"] == "first_unread"
    assert result["initial_anchor_message_id"] == "m-4"
    service._find_first_unread_message.assert_called_once()


@patch("backend.chat.chat_thread_read_store.chat_session")
def test_get_thread_bootstrap_without_unread_opens_at_bottom(
    chat_session_mock: MagicMock,
    store: ChatThreadReadStore,
    service: MagicMock,
) -> None:
    session = MagicMock()
    chat_session_mock.return_value.__enter__.return_value = session
    conversation = SimpleNamespace(id="conv-1", kind="group")
    message = SimpleNamespace(id="m-9", sender_user_id=1, conversation_id="conv-1")

    service._cache_get.return_value = None
    service._require_membership.return_value = conversation
    session.execute.return_value.scalar_one_or_none.return_value = SimpleNamespace(
        last_read_message_id=None,
        last_read_seq=0,
        unread_count=0,
    )
    session.execute.return_value.scalars.return_value = iter([message])
    service._serialize_thread_messages_payload.return_value = {
        "items": [{"id": "m-9"}],
        "has_older": False,
        "has_newer": False,
    }

    result = store.get_thread_bootstrap(
        current_user_id=1,
        conversation_id="conv-1",
        limit=40,
    )

    assert result["initial_anchor_mode"] == "bottom"
    assert result["initial_anchor_message_id"] is None
    service._find_first_unread_message.assert_not_called()


@patch("backend.chat.chat_thread_read_store.chat_session")
def test_get_thread_bootstrap_zero_unread_with_boundary_opens_at_bottom(
    chat_session_mock: MagicMock,
    store: ChatThreadReadStore,
    service: MagicMock,
) -> None:
    """R24: a known read boundary alone is not enough — unread_count must be > 0."""
    session = MagicMock()
    chat_session_mock.return_value.__enter__.return_value = session
    conversation = SimpleNamespace(id="conv-1", kind="group")
    message = SimpleNamespace(id="m-9", sender_user_id=1, conversation_id="conv-1")

    service._cache_get.return_value = None
    service._require_membership.return_value = conversation
    session.execute.return_value.scalar_one_or_none.return_value = SimpleNamespace(
        last_read_message_id="m-8",
        last_read_seq=8,
        unread_count=0,
    )
    session.execute.return_value.scalars.return_value = iter([message])
    service._serialize_thread_messages_payload.return_value = {
        "items": [{"id": "m-9"}],
        "has_older": False,
        "has_newer": False,
    }

    result = store.get_thread_bootstrap(
        current_user_id=1,
        conversation_id="conv-1",
        limit=40,
    )

    assert result["initial_anchor_mode"] == "bottom"
    assert result["initial_anchor_message_id"] is None
    service._find_first_unread_message.assert_not_called()


@patch("backend.chat.chat_thread_read_store.chat_session")
def test_get_thread_bootstrap_unread_without_boundary_opens_at_bottom(
    chat_session_mock: MagicMock,
    store: ChatThreadReadStore,
    service: MagicMock,
) -> None:
    """R24: unread_count > 0 without a stored boundary must not anchor to the
    first foreign message of the whole history (member added to an old group)."""
    session = MagicMock()
    chat_session_mock.return_value.__enter__.return_value = session
    conversation = SimpleNamespace(id="conv-1", kind="group")
    message = SimpleNamespace(id="m-9", sender_user_id=1, conversation_id="conv-1")

    service._cache_get.return_value = None
    service._require_membership.return_value = conversation
    session.execute.return_value.scalar_one_or_none.return_value = SimpleNamespace(
        last_read_message_id=None,
        last_read_seq=0,
        unread_count=6,
    )
    session.execute.return_value.scalars.return_value = iter([message])
    service._serialize_thread_messages_payload.return_value = {
        "items": [{"id": "m-9"}],
        "has_older": False,
        "has_newer": False,
    }

    result = store.get_thread_bootstrap(
        current_user_id=1,
        conversation_id="conv-1",
        limit=40,
    )

    assert result["initial_anchor_mode"] == "bottom"
    assert result["initial_anchor_message_id"] is None
    service._find_first_unread_message.assert_not_called()


@patch("backend.chat.chat_thread_read_store.chat_session")
def test_get_thread_bootstrap_without_viewer_state_opens_at_bottom(
    chat_session_mock: MagicMock,
    store: ChatThreadReadStore,
    service: MagicMock,
) -> None:
    """R24: no ChatConversationUserState row at all means no boundary."""
    session = MagicMock()
    chat_session_mock.return_value.__enter__.return_value = session
    conversation = SimpleNamespace(id="conv-1", kind="group")
    message = SimpleNamespace(id="m-9", sender_user_id=1, conversation_id="conv-1")

    service._cache_get.return_value = None
    service._require_membership.return_value = conversation
    session.execute.return_value.scalar_one_or_none.return_value = None
    session.execute.return_value.scalars.return_value = iter([message])
    service._serialize_thread_messages_payload.return_value = {
        "items": [{"id": "m-9"}],
        "has_older": False,
        "has_newer": False,
    }

    result = store.get_thread_bootstrap(
        current_user_id=1,
        conversation_id="conv-1",
        limit=40,
    )

    assert result["initial_anchor_mode"] == "bottom"
    assert result["initial_anchor_message_id"] is None
    service._find_first_unread_message.assert_not_called()


@patch("backend.chat.chat_thread_read_store.chat_session")
def test_get_thread_bootstrap_focus_message_wins_over_first_unread(
    chat_session_mock: MagicMock,
    store: ChatThreadReadStore,
    service: MagicMock,
) -> None:
    session = MagicMock()
    chat_session_mock.return_value.__enter__.return_value = session
    conversation = SimpleNamespace(id="conv-1", kind="group")
    focus = SimpleNamespace(id="m-focus", conversation_id="conv-1")
    neighbour = SimpleNamespace(id="m-5", conversation_id="conv-1")

    service._cache_get.return_value = None
    service._require_membership.return_value = conversation
    service._has_message_before.return_value = False
    service._has_message_after.return_value = False
    service._message_before_anchor_condition.return_value = true()
    service._message_after_anchor_condition.return_value = true()
    session.get.return_value = focus
    session.execute.return_value.scalars.side_effect = [
        iter([neighbour]),
        iter([focus]),
    ]
    service._serialize_thread_messages_payload.return_value = {
        "items": [{"id": "m-5"}, {"id": "m-focus"}],
        "has_older": False,
        "has_newer": False,
    }

    result = store.get_thread_bootstrap(
        current_user_id=1,
        conversation_id="conv-1",
        focus_message_id="m-focus",
        limit=40,
    )

    assert result["initial_anchor_mode"] == "message"
    assert result["initial_anchor_message_id"] == "m-focus"
    service._find_first_unread_message.assert_not_called()
