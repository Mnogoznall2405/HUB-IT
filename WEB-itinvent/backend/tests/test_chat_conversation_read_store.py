from __future__ import annotations

from unittest.mock import MagicMock, patch

import pytest

from backend.chat.chat_conversation_read_store import ChatConversationReadStore


@pytest.fixture
def service() -> MagicMock:
    return MagicMock()


@pytest.fixture
def store(service: MagicMock) -> ChatConversationReadStore:
    return ChatConversationReadStore(service)


def test_get_unread_summaries_returns_empty_for_no_users(store: ChatConversationReadStore) -> None:
    assert store.get_unread_summaries(user_ids=[]) == {}


def test_get_conversation_summary_requires_conversation_id(store: ChatConversationReadStore) -> None:
    with pytest.raises(ValueError, match="conversation_id is required"):
        store.get_conversation_summary(current_user_id=1, conversation_id="  ")


def test_get_unread_summary_uses_cache(store: ChatConversationReadStore, service: MagicMock) -> None:
    cached = {"messages_unread_total": 3, "conversations_unread": 1}
    service._cache_get.return_value = cached

    result = store.get_unread_summary(current_user_id=5)

    assert result == cached
    service._cache_get.assert_called_once_with(user_id=5, bucket="unread_summary")
    service._cache_set.assert_not_called()


@patch("backend.chat.chat_conversation_read_store.chat_session")
def test_get_unread_summaries_aggregates_rows(
    chat_session_mock: MagicMock,
    store: ChatConversationReadStore,
) -> None:
    session = MagicMock()
    chat_session_mock.return_value.__enter__.return_value = session
    session.execute.return_value.all.return_value = [(7, 4, 2, 1)]

    result = store.get_unread_summaries(user_ids=[7, 9])

    assert result[7] == {"messages_unread_total": 4, "conversations_unread": 2, "mentions_unread_total": 1}
    assert result[9] == {"messages_unread_total": 0, "conversations_unread": 0, "mentions_unread_total": 0}


@patch("backend.chat.chat_conversation_read_store.chat_session")
def test_list_conversations_returns_cached_payload(
    chat_session_mock: MagicMock,
    store: ChatConversationReadStore,
    service: MagicMock,
) -> None:
    cached = {"items": [{"id": "conv-1", "title": "Team"}], "has_more": False, "next_cursor": None}
    service._cache_get.return_value = cached
    # Cached rows go through the presence refresh (stale status_text) before being returned.
    service._presence_service.refresh_presence_on_conversation_items.return_value = cached["items"]

    result = store.list_conversations(current_user_id=3, limit=25)

    assert result == cached
    chat_session_mock.assert_not_called()
    service._set_request_meta.assert_called_once_with(
        route="conversations",
        cache_hit=True,
        limit=25,
        query=None,
        items_count=1,
    )
