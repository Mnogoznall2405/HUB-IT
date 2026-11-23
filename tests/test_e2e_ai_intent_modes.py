"""A5 e2e: JEV intent modes through the real orchestrator and worker.

Reuses the ``agent`` fixture from test_e2e_ai_draft_reliability — the real
AiChatService, queue, tool loop and SQLite storage run; only JEV decide(),
the LLM transport and external services are faked.
"""
from __future__ import annotations

import contextlib
import io
import json
import logging
import sys
from types import SimpleNamespace

from test_e2e_ai_draft_reliability import agent, actions  # noqa: F401 - fixture reuse
from backend.ai_chat import service as ai_module
from backend.scripts import ai_run_profile_export as _export_mod


def _export_caplog(caplog) -> dict:
    """Feed captured worker-log lines through the real exporter code path."""
    lines = "\n".join(r.getMessage() for r in caplog.records)
    old_argv, old_stdin = sys.argv, sys.stdin
    try:
        sys.argv = ["export", "--log", "-"]
        sys.stdin = io.StringIO(lines)
        buf = io.StringIO()
        with contextlib.redirect_stdout(buf):
            _export_mod.main()
        return json.loads(buf.getvalue())
    finally:
        sys.argv, sys.stdin = old_argv, old_stdin


def _final_profile(caplog) -> dict:
    for record in reversed(caplog.records):
        message = record.getMessage()
        if "ai_run_profile_final" in message:
            return _export_mod._parse_profile_fields(message.split("ai_run_profile_final", 1)[1])
    return {}


def _decision(**probs):
    return SimpleNamespace(
        answers={k: SimpleNamespace(probability=p) for k, p in probs.items()},
        model="fake-jev",
    )


def _enable_jev(monkeypatch, decide):
    monkeypatch.setenv("AI_JEV_ROUTING", "1")
    monkeypatch.setattr(ai_module.jev_client, "is_configured", lambda: True)
    monkeypatch.setattr(ai_module.jev_client, "decide", decide)


def _reply(text="Ответ.", **over):
    payload = {
        "answer_markdown": text,
        "quick_replies": [],
        "tool_calls": [],
        "artifacts": [],
        "kb_attachment_send": None,
    }
    payload.update(over)
    return payload


def _call(tool_id, **args):
    return {"tool_id": tool_id, "args": args}


def _tool_traces(result):
    return result.get("tool_traces") or []


def test_chat_mode_runs_with_zero_tools_and_zero_files(agent, monkeypatch):
    _enable_jev(monkeypatch, lambda **kw: _decision(m_mode_chat=0.95, m_mode_act=0.01))
    agent.steps.append(_reply("Просто отвечаю без инструментов."))
    result = agent.request("Объясни принципы деловой переписки")
    assert result["intent_mode"] == "chat"
    assert _tool_traces(result) == []
    assert (result.get("used_tools") or []) == []
    assert result.get("mode_denied_calls", 0) == 0
    assert result.get("artifacts_count", 0) == 0
    assert "деловой переписки" in result["answer_markdown"] or result["answer_markdown"]


def test_chat_mode_blocks_hallucinated_tool_call(agent, monkeypatch):
    _enable_jev(monkeypatch, lambda **kw: _decision(m_mode_chat=0.95, m_mode_act=0.01))
    agent.steps.append(_reply("", tool_calls=[_call("directory.people.search", query="Иванов")]))
    result = agent.request("Что умеет этот бот")
    assert result["intent_mode"] == "chat"
    # CHAT ships zero specs -> the tool loop never runs; the hallucinated call
    # is dropped before execution and the empty answer gets a text fallback.
    assert (result.get("used_tools") or []) == []
    assert result.get("artifacts_count", 0) == 0
    assert result["answer_markdown"].strip()


def test_chat_mode_strips_model_artifacts(agent, monkeypatch):
    _enable_jev(monkeypatch, lambda **kw: _decision(m_mode_chat=0.95, m_mode_act=0.01))
    agent.steps.append(_reply("Вот отчёт", artifacts=[{"name": "x.md", "mime": "text/markdown", "content_b64": "dGVzdA=="}]))
    result = agent.request("Подготовь список советов")
    assert result["intent_mode"] == "chat"
    assert result.get("artifacts_count", 0) == 0


def test_chat_empty_answer_still_delivers_text(agent, monkeypatch):
    _enable_jev(monkeypatch, lambda **kw: _decision(m_mode_chat=0.95, m_mode_act=0.01))
    agent.steps.append(_reply(""))
    result = agent.request("Сложный вопрос без очевидного ответа")
    assert result["intent_mode"] == "chat"
    assert (result["answer_markdown"] or "").strip()


def test_tool_mode_read_executes_search_but_strips_artifacts(agent, monkeypatch):
    def decide(**kw):
        # Select every candidate tool (tNN keys) but no mode label -> READ.
        probs = {
            key: 0.9 if key.startswith("t") else 0.02
            for key in (kw.get("questions") or {})
        }
        return _decision(**probs)

    monkeypatch.setenv("AI_JEV_ROUTING_MODE", "tool")
    _enable_jev(monkeypatch, decide)
    searched = []
    monkeypatch.setattr(
        "backend.services.address_book_service.address_book_service.search",
        lambda *a, **k: searched.append(a) or {"items": [{"full_name": "Смирнова А.А."}], "total": 1},
        raising=False,
    )
    agent.steps.extend([
        _reply("", tool_calls=[_call("directory.people.search", query="Смирнова")]),
        _reply("Телефон Смирновой найден", artifacts=[{"name": "r.md", "mime": "text/markdown", "content_b64": "dGVzdA=="}]),
    ])
    result = agent.request("Найди рабочий телефон Смирновой")
    assert result["intent_mode"] == "read"
    assert searched, "read mode must allow a real read tool"
    assert result.get("artifacts_count", 0) == 0


def _read_tool_mode(monkeypatch):
    def decide(**kw):
        probs = {
            key: 0.9 if key.startswith("t") else 0.02
            for key in (kw.get("questions") or {})
        }
        return _decision(**probs)

    monkeypatch.setenv("AI_JEV_ROUTING_MODE", "tool")
    _enable_jev(monkeypatch, decide)
    monkeypatch.setattr(
        "backend.services.address_book_service.address_book_service.search",
        lambda *a, **k: {"items": [{"full_name": "Смирнова А.А."}], "total": 1},
        raising=False,
    )


def test_read_run_profile_final_records_executed_tool(agent, monkeypatch, caplog):
    _read_tool_mode(monkeypatch)
    agent.steps.extend([
        _reply("", tool_calls=[_call("directory.people.search", query="Смирнова")]),
        _reply("Телефон найден"),
    ])
    with caplog.at_level(logging.INFO):
        result = agent.request("Найди рабочий телефон Смирновой")
    assert result["intent_mode"] == "read"
    final = _final_profile(caplog)
    assert _export_mod._parse_list(final.get("used_tools")) == ["directory.people.search"]
    assert float(final.get("server_total_ms") or 0) >= float(final.get("processing_ms") or 0) >= 0


def test_read_run_profile_final_two_tools_exported(agent, monkeypatch, caplog):
    """Full path AiChatService -> log -> exporter: both executed tools must
    survive into the exported JSON (P1 regression guard)."""
    _read_tool_mode(monkeypatch)
    agent.steps.extend([
        _reply("", tool_calls=[
            _call("directory.people.search", query="Смирнова"),
            _call("office.mail.contacts.resolve", q="Антонова"),
        ]),
        _reply("Контакты найдены"),
    ])
    with caplog.at_level(logging.INFO):
        result = agent.request("Найди телефон Смирновой и почту Антоновой")
    assert result["intent_mode"] == "read"
    used = _export_mod._parse_list(_final_profile(caplog).get("used_tools"))
    assert {"directory.people.search", "office.mail.contacts.resolve"} <= set(used)
    exported = _export_caplog(caplog)
    assert exported["tools"]["executed_calls"] >= 2


def test_read_run_profile_ok_and_error_tools(agent, monkeypatch, caplog):
    """One executed + one validation-error call -> both buckets populated."""
    _read_tool_mode(monkeypatch)
    agent.steps.extend([
        _reply("", tool_calls=[
            _call("directory.people.search", query="Смирнова"),
            _call("office.mail.contacts.resolve"),  # missing q -> validation error
        ]),
        _reply("Частично выполнено"),
    ])
    with caplog.at_level(logging.INFO):
        result = agent.request("Найди телефон Смирновой и контакты")
    assert result["intent_mode"] == "read"
    final = _final_profile(caplog)
    assert "directory.people.search" in _export_mod._parse_list(final.get("used_tools"))
    assert "office.mail.contacts.resolve" in _export_mod._parse_list(final.get("error_tools"))
    exported = _export_caplog(caplog)
    assert exported["tools"]["executed_calls"] >= 1
    assert exported["tools"]["error_calls"] >= 1


def test_tool_mode_jev_timeout_is_not_confident_chat(agent, monkeypatch):
    def decide(**kw):
        raise TimeoutError("fake jev timeout")

    monkeypatch.setenv("AI_JEV_ROUTING_MODE", "tool")
    _enable_jev(monkeypatch, decide)
    searched = []
    monkeypatch.setattr(
        "backend.services.address_book_service.address_book_service.search",
        lambda *a, **k: searched.append(a) or {"items": [{"full_name": "Смирнова А.А."}], "total": 1},
        raising=False,
    )
    agent.steps.extend([
        _reply("", tool_calls=[_call("directory.people.search", query="Смирнова")]),
        _reply("Телефон: +7 000"),
    ])
    result = agent.request("Найди рабочий телефон Смирновой")
    # Fallback routing must never be reported as confident CHAT.
    assert result.get("intent_mode") != "chat"
    assert result["answer_markdown"].strip()


def test_mode_transitions_chat_read_act_chat_in_one_conversation(agent, monkeypatch):
    def decide(**kw):
        message = ((kw.get("state") or {}).get("user_message") or "")
        questions = kw.get("questions") or {}
        probs = {key: 0.02 for key in questions}
        if "переписку" in message or "понятно" in message:
            probs["m_mode_chat"] = 0.95
        elif "телефон" in message:
            for key in questions:
                if "direct" in key:
                    probs[key] = 0.95
        elif "письмо" in message:
            probs["m_mode_act"] = 0.95
            for key in questions:
                if "office" in key:
                    probs[key] = 0.95
        else:
            probs["m_mode_chat"] = 0.9
        return _decision(**probs)

    _enable_jev(monkeypatch, decide)
    monkeypatch.setattr(
        "backend.services.address_book_service.address_book_service.search",
        lambda *a, **k: {"items": [{"full_name": "Смирнова А.А.", "phone": "+7 000"}], "total": 1},
        raising=False,
    )
    agent.steps.extend([
        _reply("Объяснение по переписке"),                                # CHAT
        _reply("", tool_calls=[_call("directory.people.search", query="Смирнова")]),
        _reply("Телефон Смирновой: +7 000"),                              # READ
        # ACT: A3 requires contacts.resolve before the draft tool may run.
        _reply("", tool_calls=[_call("office.mail.contacts.resolve", q="Антонова")]),
        _reply("", tool_calls=[_call("office.action.mail_send_draft",
                                     to=["antonova.op@example.test"],
                                     subject="Привет", body="Текст письма")]),
        _reply("Письмо подготовлено"),                                    # ACT
        _reply("Чем ещё помочь?"),                                        # CHAT
    ])
    r1 = agent.request("Расскажи про деловую переписку")
    r2 = agent.request("Найди рабочий телефон Смирновой")
    r3 = agent.request("Подготовь письмо Антоновой Ольге")
    r4 = agent.request("Всё ясно, больше ничего не нужно")
    assert r1["intent_mode"] == "chat" and _tool_traces(r1) == []
    assert r2["intent_mode"] == "read"
    assert r3["intent_mode"] == "act"
    assert r4["intent_mode"] == "chat"
    pending = [a for a in actions(agent) if "mail" in a["action_type"]]
    assert pending, "ACT run must produce a mail draft action card"
    assert pending[0]["status"] in ("pending", "awaiting_confirmation")
    # Only the ACT run may have produced action cards.
    assert len(actions(agent)) == 1


def test_single_group_bot_still_classifies_chat(agent, monkeypatch):
    # Bot already has a mixed tool set; emulate the single-group corner at
    # routing level by answering all group questions "no".
    _enable_jev(monkeypatch, lambda **kw: _decision(m_mode_chat=0.9, m_mode_act=0.01))
    agent.steps.append(_reply("Держите объяснение."))
    result = agent.request("Объясни, как организовать деловую переписку")
    assert result["intent_mode"] == "chat"
    assert _tool_traces(result) == []
