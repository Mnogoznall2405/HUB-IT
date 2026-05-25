"""Tests covering structured tool-validation diagnostics for self-correction.

These tests verify that when an LLM invokes an AI tool with invalid args,
the orchestrator surfaces a structured diagnostic that can be fed back into
the model on the next round.
"""
from __future__ import annotations

import sys
from pathlib import Path

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
        user_payload={"id": 42, "role": "user"},
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
