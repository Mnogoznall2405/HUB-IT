"""Buttons instead of a typed answer when several AD namesakes match.

The button reply is sent as the employee's own message, so only a choice that was really offered may be sent.
"""
from __future__ import annotations

import importlib
import sys
from pathlib import Path
from types import SimpleNamespace

import pytest

_ROOT = Path(__file__).resolve().parents[1]
for _p in (str(_ROOT), str(_ROOT / "WEB-itinvent")):
    if _p not in sys.path:
        sys.path.insert(0, _p)

action_cards = importlib.import_module("backend.ai_chat.action_cards")
ad_tools = importlib.import_module("backend.ai_chat.tools.ad")
context_module = importlib.import_module("backend.ai_chat.tools.context")

CANDIDATES = [
    {"login": "sandu.ao", "display_name": "Санду А.О.", "department": "Отдел поддержки"},
    {"login": "sandu_ao", "display_name": "Санду Андрей Олегович", "department": ""},
]


def _ctx():
    return context_module.AiToolExecutionContext(
        bot_id="b", bot_title="t", conversation_id="conv-1", run_id="run-1", user_id=5,
        user_payload={"id": 5, "role": "viewer"}, effective_database_id=None, enabled_tools=[], tool_settings={},
    )


def test_ambiguous_ad_lookup_returns_a_card_with_one_button_per_candidate(monkeypatch):
    captured = {}
    monkeypatch.setattr(action_cards, "create_pending_action", lambda **kw: captured.update(kw) or {"id": "card-1", **kw})
    monkeypatch.setattr(
        ad_tools, "lookup_ad_user_password_status",
        lambda query, limit=5: {"status": "ambiguous", "query": query, "candidates": CANDIDATES},
    )
    result = ad_tools.AdUserPasswordStatusTool().execute(context=_ctx(), args=ad_tools.AdUserPasswordStatusArgs(query="Санду"))
    assert result.ok and result.data["action_card"]["id"] == "card-1"
    assert captured["action_type"] == "ai.choice.reply"
    assert [c["label"] for c in captured["preview"]["choices"]] == [
        "Санду А.О. · sandu.ao · Отдел поддержки",
        "Санду Андрей Олегович · sandu_ao",
    ]
    assert [c["reply"] for c in captured["payload"]["choices"]] == ["Санду А.О. (sandu.ao)", "Санду Андрей Олегович (sandu_ao)"]


def test_single_match_has_no_card(monkeypatch):
    monkeypatch.setattr(
        ad_tools, "lookup_ad_user_password_status",
        lambda query, limit=5: {"status": "matched", "query": query, "user": CANDIDATES[0]},
    )
    result = ad_tools.AdUserPasswordStatusTool().execute(context=_ctx(), args=ad_tools.AdUserPasswordStatusArgs(query="sandu.ao"))
    assert "action_card" not in result.data


def _run_choice(monkeypatch, choice):
    sent = {}
    chat_service_module = importlib.import_module("backend.chat.service")
    monkeypatch.setattr(
        chat_service_module.chat_service, "send_message",
        lambda **kw: sent.update(kw) or {"id": "m-1"},
    )
    monkeypatch.setattr(action_cards, "_require_permission", lambda *a, **k: None)
    payload = {"choices": [{"id": "1", "label": "A", "reply": "Санду А.О. (sandu.ao)"}, {"id": "2", "label": "B", "reply": "Санду Андрей Олегович (sandu_ao)"}]}
    row = SimpleNamespace(conversation_id="conv-1")
    result = action_cards._execute_ai_choice(
        row=row, payload=payload, current_user=SimpleNamespace(id=5), payload_overrides={"choice": choice},
    )
    return result, sent


def test_picked_button_is_sent_as_the_employees_message(monkeypatch):
    result, sent = _run_choice(monkeypatch, "2")
    assert result["success"] is True
    assert sent == {"current_user_id": 5, "conversation_id": "conv-1", "body": "Санду Андрей Олегович (sandu_ao)"}


def test_a_choice_that_was_not_offered_is_rejected(monkeypatch):
    with pytest.raises(ValueError):
        _run_choice(monkeypatch, "9")


def test_confirmed_choice_publishes_the_reply_and_starts_the_assistant_run(monkeypatch):
    ai_api = importlib.import_module("backend.api.v1.chat.ai")
    calls = []

    class _Api:
        def _schedule_chat_background_task(self, task, label):
            calls.append(("background", task, label))

        def _publish_message_created_after_send(self, **kw):
            return ("publish", kw)

        def _schedule_ai_run_for_message(self, **kw):
            calls.append(("ai_run", kw))

    monkeypatch.setattr(ai_api, "chat_api", lambda: _Api())
    card = {
        "action_type": "ai.choice.reply", "status": "confirmed", "conversation_id": "conv-1",
        "result": {"message_id": "m-1", "conversation_id": "conv-1"},
    }
    ai_api._after_choice_reply(card, SimpleNamespace(id=5))
    assert calls[0] == ("background", ("publish", {"conversation_id": "conv-1", "message_id": "m-1"}), "publish_choice_reply")
    assert calls[1] == ("ai_run", {"current_user_id": 5, "conversation_id": "conv-1", "message_id": "m-1", "conversation_kind": "ai"})


def test_pending_or_other_cards_trigger_nothing(monkeypatch):
    ai_api = importlib.import_module("backend.api.v1.chat.ai")
    monkeypatch.setattr(ai_api, "chat_api", lambda: pytest.fail("must not be called"))
    ai_api._after_choice_reply({"action_type": "ai.choice.reply", "status": "pending", "result": {}}, SimpleNamespace(id=5))
    ai_api._after_choice_reply({"action_type": "office.mail.send", "status": "confirmed", "result": {"message_id": "m"}}, SimpleNamespace(id=5))
