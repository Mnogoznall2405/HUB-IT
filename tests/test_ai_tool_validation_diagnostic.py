"""Tests covering structured tool-validation diagnostics for self-correction.

These tests verify that when an LLM invokes an AI tool with invalid args,
the orchestrator surfaces a structured diagnostic that can be fed back into
the model on the next round.
"""
from __future__ import annotations

import asyncio
import sys
import threading
from pathlib import Path
from types import SimpleNamespace

import pytest

PROJECT_ROOT = Path(__file__).resolve().parents[1]
WEB_ROOT = PROJECT_ROOT / "WEB-itinvent"

if str(WEB_ROOT) not in sys.path:
    sys.path.insert(0, str(WEB_ROOT))


def _make_context():
    from backend.ai_chat.tools.context import AiToolExecutionContext

    return AiToolExecutionContext(
        bot_id="bot-test",
        bot_title="AI Assistant",
        conversation_id="conv-test",
        run_id="run-test",
        user_id=42,
        # Admin bypasses the AG-2 tool permission gate, so the test reaches
        # the argument-validation path it exercises.
        user_payload={"id": 42, "role": "admin"},
        effective_database_id="ITINVENT",
        enabled_tools=["itinvent.equipment.search"],
        tool_settings={"multi_db_mode": "single", "allowed_databases": []},
        allow_generated_artifacts=True,
    )


def test_tool_registry_raises_validation_error_with_structured_attrs():
    """Registry attaches tool_id, field_path and detail attrs to AiToolValidationError."""
    from backend.ai_chat.tools.base import AiToolValidationError
    from backend.ai_chat.tools.registry import ai_tool_registry

    # itinvent.equipment.search requires non-empty 'query'; pass empty dict to fail validation.
    context = _make_context()
    with pytest.raises(AiToolValidationError) as exc_info:
        ai_tool_registry.execute(
            tool_id="itinvent.equipment.search",
            raw_args={},
            context=context,
        )
    err = exc_info.value
    assert getattr(err, "tool_id", None) == "itinvent.equipment.search"
    assert getattr(err, "field_path", None) is not None
    assert getattr(err, "detail", None)
    assert "query" in str(err)


def test_execute_tool_calls_returns_diagnostic_for_invalid_args():
    """_execute_tool_calls produces an invalid_arguments diagnostic for failed validation."""
    from backend.ai_chat.service import AiChatService

    service = AiChatService()
    context = _make_context()
    tool_calls = [
        {"tool_id": "itinvent.equipment.search", "args": {}},
    ]
    results, traces = service._execute_tool_calls(
        tool_calls=tool_calls,
        tool_context=context,
        report_stage=None,
    )
    assert len(results) == 1
    assert len(traces) == 1
    # Result is marked failed and carries a structured diagnostic.
    assert results[0]["ok"] is False
    assert results[0]["tool_id"] == "itinvent.equipment.search"
    diag = (results[0].get("data") or {}).get("diagnostic")
    assert isinstance(diag, dict)
    assert diag.get("error_code") == "invalid_arguments"
    assert "suggested_fix" in diag
    # Trace also carries the diagnostic for the followup prompt builder.
    assert traces[0].get("diagnostic", {}).get("error_code") == "invalid_arguments"


def test_tool_validation_logs_do_not_include_confidential_argument_values(caplog):
    from backend.ai_chat.service import AiChatService

    marker = "PRIVATE_DOCUMENT_CONTENT_FOR_LOG_REGRESSION"
    results, _ = AiChatService()._execute_tool_calls(
        tool_calls=[{"tool_id": "itinvent.equipment.search", "args": {"document": marker}}],
        tool_context=_make_context(),
        report_stage=None,
    )
    assert results[0]["data"]["diagnostic"]["error_code"] == "invalid_arguments"
    assert "AI tool validation failed" in caplog.text
    assert marker not in caplog.text


def test_execute_tool_calls_does_not_raise_on_unknown_tool():
    """Unknown tools surface a generic error result, not a hard exception."""
    from backend.ai_chat.service import AiChatService

    service = AiChatService()
    context = _make_context()
    results, traces = service._execute_tool_calls(
        tool_calls=[{"tool_id": "non.existent.tool", "args": {}}],
        tool_context=context,
        report_stage=None,
    )
    assert len(results) == 1
    assert results[0]["ok"] is False
    assert traces[0]["status"] == "error"


def _multi_call_context():
    context = _make_context()
    context.tool_settings["max_tool_calls_per_round"] = 3
    return context


class _StubToolResult:
    def __init__(self, tool_id):
        self.tool_id = tool_id

    def to_payload(self):
        return {"tool_id": self.tool_id, "ok": True, "data": {}, "error": None}


def _stub_two_independent_tools(monkeypatch, executed):
    """Two independent fake tools so calls land in one parallel group."""
    from backend.ai_chat.tools.registry import ai_tool_registry

    stages = {"alpha.ping": "stage_ok", "beta.pong": "stage_cancel"}

    monkeypatch.setattr(
        ai_tool_registry, "get", lambda tool_id: SimpleNamespace(stage=stages.get(tool_id, "stage_ok"))
    )

    def _execute(*, tool_id, raw_args, context):
        executed.append(tool_id)
        return _StubToolResult(tool_id), {"tool_id": tool_id, "status": "ok"}

    monkeypatch.setattr(ai_tool_registry, "execute", _execute)
    return stages


def test_execute_tool_calls_stage_callback_failure_isolated(monkeypatch):
    """A report_stage exception becomes a failed result for that call only."""
    from backend.ai_chat.service import AiChatService

    executed = []
    _stub_two_independent_tools(monkeypatch, executed)

    def report_stage(stage):
        if stage == "stage_ok":
            raise RuntimeError("status push failed")

    service = AiChatService()
    results, traces = service._execute_tool_calls(
        tool_calls=[{"tool_id": "alpha.ping", "args": {}}, {"tool_id": "beta.pong", "args": {}}],
        tool_context=_multi_call_context(),
        report_stage=report_stage,
    )

    assert [item["tool_id"] for item in results] == ["alpha.ping", "beta.pong"]
    assert results[0]["ok"] is False
    assert results[1]["ok"] is True
    assert len(traces) == 2
    assert executed == ["beta.pong"]


@pytest.mark.parametrize("inside_running_loop", [False, True])
def test_execute_tool_calls_cancel_propagates_without_replay(monkeypatch, inside_running_loop):
    """AiRunCancelled must propagate and completed calls must not be re-executed."""
    from backend.ai_chat.service import AiChatService, AiRunCancelled

    executed = []
    stage_calls = []
    first_done = threading.Event()
    _stub_two_independent_tools(monkeypatch, executed)

    def report_stage(stage):
        stage_calls.append(stage)
        if stage == "stage_cancel":
            assert first_done.wait(timeout=15)
            raise AiRunCancelled()

    def _execute(*, tool_id, raw_args, context):
        executed.append(tool_id)
        first_done.set()
        return _StubToolResult(tool_id), {"tool_id": tool_id, "status": "ok"}

    from backend.ai_chat.tools.registry import ai_tool_registry

    monkeypatch.setattr(ai_tool_registry, "execute", _execute)

    service = AiChatService()
    tool_calls = [{"tool_id": "alpha.ping", "args": {}}, {"tool_id": "beta.pong", "args": {}}]
    context = _multi_call_context()

    if inside_running_loop:
        async def _run():
            return service._execute_tool_calls(
                tool_calls=tool_calls, tool_context=context, report_stage=report_stage
            )

        with pytest.raises(AiRunCancelled):
            asyncio.run(_run())
    else:
        with pytest.raises(AiRunCancelled):
            service._execute_tool_calls(
                tool_calls=tool_calls, tool_context=context, report_stage=report_stage
            )

    assert executed == ["alpha.ping"]
    assert stage_calls.count("stage_ok") == 1
    assert stage_calls.count("stage_cancel") == 1


def test_has_report_file_intent_does_not_match_task_creation():
    """Verb 'создай' alone (without a file noun) must not trigger file intent."""
    from backend.ai_chat.service import _has_report_file_intent

    # These should NOT trigger file intent.
    assert not _has_report_file_intent("создай задачу на завтра")
    assert not _has_report_file_intent("сделай комментарий к задаче")
    assert not _has_report_file_intent("напиши письмо начальнику")

    # These should trigger file intent.
    assert _has_report_file_intent("создай отчет по оборудованию")
    assert _has_report_file_intent("сделай xlsx со списком")
    assert _has_report_file_intent("сформируй отчёт")
    assert _has_report_file_intent("export equipment to excel")
