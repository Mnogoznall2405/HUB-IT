from __future__ import annotations

import importlib
from types import SimpleNamespace


def test_existing_bot_user_is_loaded_through_current_app_session(monkeypatch):
    ai_chat = importlib.import_module("backend.ai_chat.service")
    service = ai_chat.AiChatService()
    bot = SimpleNamespace(bot_user_id=77, slug="corp-assistant")
    requested_ids: list[int] = []

    class FakeSession:
        def get(self, _model, user_id):
            requested_ids.append(int(user_id))
            return SimpleNamespace(id=int(user_id))

    monkeypatch.setattr(ai_chat.user_service, "_use_app_database", True, raising=False)
    monkeypatch.setattr(
        ai_chat.user_service,
        "get_by_id",
        lambda _user_id: (_ for _ in ()).throw(
            AssertionError("must not open a nested APP DB session")
        ),
    )

    assert service._ensure_bot_user(session=FakeSession(), bot=bot) == 77
    assert requested_ids == [77]
