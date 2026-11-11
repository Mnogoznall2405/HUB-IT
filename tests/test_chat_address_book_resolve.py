from __future__ import annotations

import pytest

from backend.chat.service import ChatService


@pytest.fixture()
def chat_service(monkeypatch):
    monkeypatch.setattr(
        "backend.chat.service.chat_service._ensure_available",
        lambda self: None,
    )
    monkeypatch.setattr(
        "backend.chat.service.chat_service._get_presence_map",
        lambda self, user_ids=None: {},
    )
    return ChatService()


def test_resolve_user_for_address_book_by_email(chat_service, monkeypatch):
    monkeypatch.setattr(
        "backend.chat.service.user_service.list_users",
        lambda: [
            {"id": 1, "username": "me", "full_name": "Me", "email": "me@zsgp.ru", "is_active": True},
            {
                "id": 2,
                "username": "ivanov",
                "full_name": "Иванов Иван",
                "email": "ivanov@zsgp.ru",
                "mailbox_email": "ivanov@zsgp.ru",
                "is_active": True,
            },
        ],
    )

    resolved = chat_service.resolve_user_for_address_book(
        current_user_id=1,
        email="ivanov@zsgp.ru",
        full_name="",
    )
    assert resolved["id"] == 2
    assert resolved["username"] == "ivanov"


def test_resolve_user_for_address_book_by_full_name(chat_service, monkeypatch):
    monkeypatch.setattr(
        "backend.chat.service.user_service.list_users",
        lambda: [
            {"id": 1, "username": "me", "full_name": "Me", "is_active": True},
            {"id": 3, "username": "petrov", "full_name": "Петров Пётр", "is_active": True},
        ],
    )

    resolved = chat_service.resolve_user_for_address_book(
        current_user_id=1,
        email="",
        full_name="Петров Пётр",
    )
    assert resolved["id"] == 3


def test_resolve_user_for_address_book_not_found(chat_service, monkeypatch):
    monkeypatch.setattr(
        "backend.chat.service.user_service.list_users",
        lambda: [
            {"id": 1, "username": "me", "full_name": "Me", "is_active": True},
        ],
    )

    with pytest.raises(LookupError, match="не найден в HUB-чате"):
        chat_service.resolve_user_for_address_book(
            current_user_id=1,
            email="missing@zsgp.ru",
            full_name="Несуществующий",
        )
