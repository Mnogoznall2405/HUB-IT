"""Unit tests for new ai_chat tools: kb.*, chat.*, itinvent works drafts, Jev per-tool routing."""
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

tools_context_module = importlib.import_module("backend.ai_chat.tools.context")
kb_module = importlib.import_module("backend.ai_chat.tools.kb")
chat_module = importlib.import_module("backend.ai_chat.tools.chat")
works_module = importlib.import_module("backend.ai_chat.tools.itinvent_works")
action_cards = importlib.import_module("backend.ai_chat.action_cards")
service_module = importlib.import_module("backend.ai_chat.service")


def _ctx(*, database_id: str | None = "ITINVENT", user_id: int = 5):
    return tools_context_module.AiToolExecutionContext(
        bot_id="bot-test",
        bot_title="AI Ассистент",
        conversation_id="ai-conv-test",
        run_id="run-test",
        user_id=user_id,
        user_payload={"id": user_id, "role": "viewer", "username": "operator"},
        effective_database_id=database_id,
        enabled_tools=[],
        tool_settings={"multi_db_mode": "single", "allowed_databases": []},
    )


# ---------- group mapping ----------


def test_kb_and_chat_tool_groups():
    get_group = tools_context_module.get_tool_group
    assert get_group("kb.articles.search") == tools_context_module.AI_TOOL_GROUP_KB
    assert get_group("chat.users.search") == tools_context_module.AI_TOOL_GROUP_CHAT
    assert get_group("chat.action.message_send_draft") == tools_context_module.AI_TOOL_GROUP_CHAT
    assert get_group("itinvent.action.pc_cleaning_draft") == tools_context_module.AI_TOOL_GROUP_ITINVENT
    assert tools_context_module.AI_TOOL_GROUP_KB in tools_context_module.AI_TOOL_GROUPS_ALL
    assert tools_context_module.AI_TOOL_GROUP_CHAT in tools_context_module.AI_TOOL_GROUPS_ALL


def test_new_tools_registered():
    registry = importlib.import_module("backend.ai_chat.tools").ai_tool_registry
    for tool_id in [
        "kb.articles.search",
        "kb.articles.get",
        "kb.categories.list",
        "chat.users.search",
        "chat.conversations.search",
        "chat.action.message_send_draft",
        "itinvent.action.cartridge_replacement_draft",
        "itinvent.action.battery_replacement_draft",
        "itinvent.action.component_replacement_draft",
        "itinvent.action.pc_cleaning_draft",
    ]:
        assert registry.get(tool_id) is not None, tool_id


# ---------- kb tools ----------


def test_kb_search_returns_cards(monkeypatch):
    monkeypatch.setattr(kb_module.user_service, "get_by_id", lambda uid: {"id": uid, "role": "viewer"})
    monkeypatch.setattr(
        kb_module.kb_service,
        "list_articles",
        lambda **kwargs: {
            "total": 1,
            "items": [
                {
                    "id": "art-1",
                    "title": "Сброс пароля",
                    "category": "Учётные записи",
                    "summary": "Как сбросить пароль",
                    "tags": ["пароль"],
                    "status": "published",
                    "updated_at": "2026-01-01",
                    "attachments": [],
                }
            ],
        },
    )
    tool = kb_module.KbArticlesSearchTool()
    result = tool.execute(context=_ctx(), args=kb_module.KbArticlesSearchArgs(query="пароль"))
    assert result.ok is True
    assert result.data["total"] == 1
    assert result.data["items"][0]["id"] == "art-1"


def test_kb_search_merges_index_file_hits(monkeypatch):
    monkeypatch.setattr(kb_module.user_service, "get_by_id", lambda uid: {"id": uid})
    monkeypatch.setattr(
        kb_module.kb_service,
        "list_articles",
        lambda **kwargs: {"total": 0, "items": []},
    )

    class _FakeRetrieval:
        def ensure_index_fresh(self):
            return None

        def retrieve(self, **kwargs):
            return [
                {
                    "article_id": "art-file",
                    "title": "Шаблон акта",
                    "category": "Шаблоны",
                    "score": 0.9,
                    "primary_attachment_id": "att-1",
                    "primary_attachment_name": "akt.docx",
                }
            ]

    import backend.ai_chat.retrieval_interface as ri_mod

    monkeypatch.setattr(ri_mod, "ai_kb_retrieval", _FakeRetrieval())
    result = kb_module.KbArticlesSearchTool().execute(
        context=_ctx(), args=kb_module.KbArticlesSearchArgs(query="акт")
    )
    assert result.ok is True
    assert result.data["count"] == 1
    item = result.data["items"][0]
    assert item["id"] == "art-file"
    assert item["match_source"] == "full_text_index"
    assert item["primary_attachment_name"] == "akt.docx"


def test_kb_attachment_get_text(monkeypatch):
    monkeypatch.setattr(kb_module.user_service, "get_by_id", lambda uid: {"id": uid})
    monkeypatch.setattr(
        kb_module.kb_service,
        "get_article",
        lambda article_id, current_user=None: {"id": article_id, "title": "Статья"},
    )
    monkeypatch.setattr(
        kb_module.kb_service,
        "get_attachment",
        lambda article_id, attachment_id: {
            "id": attachment_id,
            "file_name": "manual.docx",
            "content_type": "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
            "path": "C:/fake/manual.docx",
        },
    )
    import backend.ai_chat.document_extractors as de_mod

    monkeypatch.setattr(de_mod, "extract_text_from_path", lambda *a, **k: "Текст из файла")
    result = kb_module.KbAttachmentGetTextTool().execute(
        context=_ctx(),
        args=kb_module.KbAttachmentGetTextArgs(article_id="art-1", attachment_id="att-1"),
    )
    assert result.ok is True
    assert result.data["text"] == "Текст из файла"
    assert result.data["file_name"] == "manual.docx"


def test_kb_get_article_returns_content(monkeypatch):
    monkeypatch.setattr(kb_module.user_service, "get_by_id", lambda uid: {"id": uid})
    monkeypatch.setattr(
        kb_module.kb_service,
        "get_article",
        lambda article_id, current_user=None: {
            "id": article_id,
            "title": "Инструкция",
            "content": {"overview": "Текст", "checks": ["a", "b"], "faq": []},
            "attachments": [{"id": "att-1", "file_name": "doc.pdf", "size": 10}],
        },
    )
    tool = kb_module.KbArticlesGetTool()
    result = tool.execute(context=_ctx(), args=kb_module.KbArticlesGetArgs(article_id="art-1"))
    assert result.ok is True
    assert result.data["content"]["overview"] == "Текст"
    assert result.data["attachments"][0]["id"] == "att-1"


def test_kb_get_article_not_found(monkeypatch):
    monkeypatch.setattr(kb_module.user_service, "get_by_id", lambda uid: {"id": uid})
    monkeypatch.setattr(kb_module.kb_service, "get_article", lambda article_id, current_user=None: None)
    result = kb_module.KbArticlesGetTool().execute(
        context=_ctx(), args=kb_module.KbArticlesGetArgs(article_id="missing")
    )
    assert result.ok is False
    assert "not found" in (result.error or "").lower()


# ---------- chat tools ----------


def test_chat_users_search(monkeypatch):
    monkeypatch.setattr(
        chat_module.user_service,
        "search_users",
        lambda **kwargs: {
            "items": [{"id": 7, "username": "ivanov", "display_name": "Иванов И.", "department": "ИТ"}]
        },
    )
    result = chat_module.ChatUsersSearchTool().execute(
        context=_ctx(), args=chat_module.ChatUsersSearchArgs(query="иванов")
    )
    assert result.ok is True
    assert result.data["items"][0]["id"] == 7
    assert result.data["items"][0]["display_name"] == "Иванов И."


def test_chat_conversations_search(monkeypatch):
    monkeypatch.setattr(
        chat_module.chat_service,
        "list_conversations",
        lambda **kwargs: {"items": [{"id": "conv-1", "title": "ИТ-отдел", "kind": "group"}]},
    )
    result = chat_module.ChatConversationsSearchTool().execute(
        context=_ctx(), args=chat_module.ChatConversationsSearchArgs(query="ит")
    )
    assert result.ok is True
    assert result.data["items"][0]["id"] == "conv-1"


def test_chat_message_draft_tool(monkeypatch):
    captured = {}

    def _fake_build(**kwargs):
        captured.update(kwargs)
        return {"id": "action-1", "action_type": "chat.message.send", "status": "pending"}

    monkeypatch.setattr(action_cards, "build_chat_message_draft", _fake_build)
    result = chat_module.ChatMessageSendDraftTool().execute(
        context=_ctx(),
        args=chat_module.ChatMessageSendDraftArgs(text="Привет!", peer_user_id=7),
    )
    assert result.ok is True
    assert result.data["requires_confirmation"] is True
    assert captured["payload"]["text"] == "Привет!"


def test_build_chat_message_draft_resolves_peer(monkeypatch):
    monkeypatch.setattr(
        action_cards.user_service if hasattr(action_cards, "user_service") else chat_module.user_service,
        "search_users",
        lambda **kwargs: {"items": [{"id": 9, "username": "petrov", "display_name": "Петров П."}]},
    )
    monkeypatch.setattr(
        action_cards,
        "create_pending_action",
        lambda **kwargs: {"id": "a1", "action_type": kwargs["action_type"], "payload": kwargs["payload"]},
    )
    import backend.services.user_service as us_mod

    monkeypatch.setattr(us_mod.user_service, "search_users", lambda **kwargs: {"items": [{"id": 9, "username": "petrov"}]})
    monkeypatch.setattr(us_mod.user_service, "get_by_id", lambda uid: {"id": uid, "display_name": "Петров П."})
    card = action_cards.build_chat_message_draft(
        conversation_id="c1",
        run_id="r1",
        requester_user_id=5,
        payload={"text": "hi", "peer_name": "петров"},
    )
    assert card["action_type"] == action_cards.ACTION_CHAT_MESSAGE_SEND
    assert card["payload"]["peer_user_id"] == 9


# ---------- works draft tools ----------


def test_works_draft_requires_identifier():
    with pytest.raises(Exception):
        works_module.WorksDraftArgs()


def test_works_draft_missing_database():
    tool = works_module.PcCleaningDraftTool()
    result = tool.execute(
        context=_ctx(database_id=None),
        args=works_module.PcCleaningDraftArgs(inv_no="INV-1"),
    )
    assert result.ok is False
    assert "database" in (result.error or "").lower()


def test_works_draft_tool_calls_builder(monkeypatch):
    captured = {}

    def _fake_build(**kwargs):
        captured.update(kwargs)
        return {"id": "action-2", "action_type": kwargs["action_type"]}

    monkeypatch.setattr(action_cards, "build_works_draft", _fake_build)
    tool = works_module.CartridgeReplacementDraftTool()
    result = tool.execute(
        context=_ctx(),
        args=works_module.CartridgeReplacementDraftArgs(
            inv_no="INV-9",
            cartridge_color="Черный",
        ),
    )
    assert result.ok is True
    assert captured["action_type"] == action_cards.ACTION_WORKS_CARTRIDGE
    assert captured["database_id"] == "ITINVENT"
    assert captured["payload"]["cartridge_color"] == "Черный"


def test_build_works_draft_normalizes_equipment(monkeypatch):
    monkeypatch.setattr(
        action_cards.queries,
        "get_equipment_by_inv",
        lambda inv_no, db_id=None: {
            "INV_NO": "INV-9",
            "SERIAL_NO": "SN-77",
            "MODEL_NAME": "HP 402",
            "BRANCH_NAME": "Центральный",
            "LOCATION_NAME": "Каб. 12",
            "OWNER_DISPLAY_NAME": "Иванов",
            "ID": 55,
        },
    )
    monkeypatch.setattr(
        action_cards,
        "create_pending_action",
        lambda **kwargs: {"id": "a9", "payload": kwargs["payload"], "preview": kwargs["preview"]},
    )
    card = action_cards.build_works_draft(
        action_type=action_cards.ACTION_WORKS_BATTERY,
        conversation_id="c1",
        run_id="r1",
        requester_user_id=5,
        database_id="ITINVENT",
        payload={"inv_no": "INV-9"},
    )
    assert card["payload"]["serial_number"] == "SN-77"
    assert card["payload"]["db_name"] == "ITINVENT"
    assert card["payload"]["equipment_id"] == 55
    assert card["preview"]["title"] == "Замена батареи"


def test_build_works_draft_unknown_equipment(monkeypatch):
    monkeypatch.setattr(action_cards.queries, "get_equipment_by_inv", lambda *a, **k: None)
    with pytest.raises(ValueError, match="not found"):
        action_cards.build_works_draft(
            action_type=action_cards.ACTION_WORKS_PC_CLEANING,
            conversation_id="c1",
            run_id="r1",
            requester_user_id=5,
            database_id="ITINVENT",
            payload={"inv_no": "NOPE"},
        )


# ---------- Jev per-tool routing ----------


def _jev_decision(probs: dict[str, float]):
    return SimpleNamespace(
        model="typesafe/jev-1.13",
        answers={key: SimpleNamespace(probability=p) for key, p in probs.items()},
    )


def test_route_tools_jev_disabled_by_default(monkeypatch):
    monkeypatch.delenv("AI_JEV_ROUTING", raising=False)
    result = service_module._route_tools_jev(
        trigger_text="найди принтер",
        tool_specs=[{"tool_id": "mfu.devices.list"}],
    )
    assert result is None


def test_route_tools_jev_group_mode_returns_none(monkeypatch):
    monkeypatch.setenv("AI_JEV_ROUTING", "1")
    monkeypatch.setenv("AI_JEV_ROUTING_MODE", "group")
    result = service_module._route_tools_jev(
        trigger_text="найди принтер",
        tool_specs=[{"tool_id": "mfu.devices.list"}],
    )
    assert result is None


def test_route_tools_jev_selects_and_keeps_resolvers(monkeypatch):
    monkeypatch.setenv("AI_JEV_ROUTING", "1")
    monkeypatch.setenv("AI_JEV_ROUTING_MODE", "tool")
    monkeypatch.setenv("AI_JEV_ROUTING_THRESHOLD", "0.5")
    specs = [
        {"tool_id": "itinvent.entity.resolve", "description": "resolve entities"},
        {"tool_id": "itinvent.equipment.search", "description": "search equipment"},
        {"tool_id": "office.mail.search", "description": "search mail"},
    ]
    monkeypatch.setattr(
        service_module.jev_client,
        "is_configured",
        lambda: True,
    )
    monkeypatch.setattr(
        service_module.jev_client,
        "decide",
        lambda **kwargs: _jev_decision({"t00": 0.01, "t01": 0.9, "t02": 0.02}),
    )
    selected = service_module._route_tools_jev(trigger_text="найди оборудование", tool_specs=specs)
    assert selected is not None
    # equipment.search selected by threshold; entity.resolve always kept.
    assert "itinvent.equipment.search" in selected
    assert "itinvent.entity.resolve" in selected
    assert "office.mail.search" not in selected


def test_route_tools_jev_failure_returns_none(monkeypatch):
    monkeypatch.setenv("AI_JEV_ROUTING", "1")
    monkeypatch.setenv("AI_JEV_ROUTING_MODE", "tool")
    monkeypatch.setattr(service_module.jev_client, "is_configured", lambda: True)

    def _boom(**kwargs):
        raise RuntimeError("api down")

    monkeypatch.setattr(service_module.jev_client, "decide", _boom)
    result = service_module._route_tools_jev(
        trigger_text="x",
        tool_specs=[{"tool_id": "mfu.devices.list"}],
    )
    assert result is None
