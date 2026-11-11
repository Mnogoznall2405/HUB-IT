"""
Property-based tests for tool loop failure resilience.

Feature: ai-agent-universal-tools
Property 9: Tool loop continues after individual tool failures

**Validates: Requirements 10.4**

For any sequence of tool execution results where some return `ok=False`, the orchestration
loop SHALL process all tool calls in the sequence and not terminate early due to a single
failure. The accumulated results SHALL contain entries for every tool call attempted.
"""

from __future__ import annotations

import sys
from pathlib import Path
from typing import Any
from unittest.mock import patch, MagicMock

# Ensure WEB-itinvent is on the path (backend lives there)
PROJECT_ROOT = Path(__file__).resolve().parents[1]
WEB_ROOT = PROJECT_ROOT / "WEB-itinvent"
if str(WEB_ROOT) not in sys.path:
    sys.path.insert(0, str(WEB_ROOT))

from hypothesis import given, settings, assume
from hypothesis.strategies import (
    booleans,
    composite,
    integers,
    lists,
    sampled_from,
    text,
)

from backend.ai_chat.service import AiChatService
from backend.ai_chat.tools.base import AiToolResult, AiToolValidationError
from backend.ai_chat.tools.context import AiToolExecutionContext


# --- Helpers ---


def _make_context(max_calls: int = 5) -> AiToolExecutionContext:
    """Create a minimal AiToolExecutionContext for testing."""
    return AiToolExecutionContext(
        bot_id="bot-test",
        bot_title="Test Bot",
        conversation_id="conv-test",
        run_id="run-test",
        user_id=1,
        user_payload={"id": 1, "role": "admin"},
        effective_database_id="TEST_DB",
        enabled_tools=[
            "tool.alpha", "tool.beta", "tool.gamma",
            "tool.delta", "tool.epsilon", "tool.zeta",
        ],
        tool_settings={
            "multi_db_mode": "single",
            "allowed_databases": [],
            "max_tool_rounds": 6,
            "max_tool_calls_per_round": max_calls,
        },
        allow_generated_artifacts=False,
    )


# --- Strategies ---

# Available tool IDs for generating tool call sequences
TOOL_IDS = ["tool.alpha", "tool.beta", "tool.gamma", "tool.delta", "tool.epsilon"]

tool_id_st = sampled_from(TOOL_IDS)


@composite
def tool_call_sequence(draw):
    """Generate a list of tool calls (1-5 calls) with varying tool IDs."""
    n = draw(integers(min_value=1, max_value=5))
    calls = []
    for _ in range(n):
        tid = draw(tool_id_st)
        calls.append({"tool_id": tid, "args": {"query": "test"}})
    return calls


@composite
def failure_pattern(draw, n: int):
    """Generate a list of booleans indicating which tool calls should fail.

    At least one must fail (to test failure resilience) and at least one must succeed
    (to verify mixed scenarios).
    """
    if n <= 1:
        return [True]  # Single call fails
    pattern = [draw(booleans()) for _ in range(n)]
    # Ensure at least one failure
    if not any(pattern):
        pattern[0] = True
    return pattern


# --- Property Tests ---


@settings(max_examples=100)
@given(calls=tool_call_sequence())
def test_all_tool_calls_produce_results(calls: list[dict[str, Any]]):
    """Property 9a: Every tool call in the sequence produces a result entry.

    Regardless of whether individual tools succeed or fail, the accumulated
    results SHALL contain exactly one entry for every tool call attempted.

    **Validates: Requirements 10.4**
    """
    service = AiChatService()
    context = _make_context(max_calls=len(calls))

    # Mock the tool registry to simulate a mix of successes and failures.
    # We make all tools raise exceptions to simulate failures — the method
    # should still produce a result for each call.
    def mock_execute(*, tool_id, raw_args, context):
        raise RuntimeError(f"Simulated failure for {tool_id}")

    mock_tool = MagicMock()
    mock_tool.stage = "checking_itinvent"

    with patch("backend.ai_chat.service.ai_tool_registry") as mock_registry:
        mock_registry.get.return_value = mock_tool
        mock_registry.execute.side_effect = mock_execute

        results, traces = service._execute_tool_calls(
            tool_calls=calls,
            tool_context=context,
            report_stage=None,
        )

    # Core property: number of results equals number of calls
    assert len(results) == len(calls), (
        f"Expected {len(calls)} results but got {len(results)}. "
        f"Tool loop terminated early on failure."
    )
    assert len(traces) == len(calls), (
        f"Expected {len(calls)} traces but got {len(traces)}. "
        f"Tool loop terminated early on failure."
    )


@settings(max_examples=100)
@given(calls=tool_call_sequence())
def test_failed_calls_marked_ok_false(calls: list[dict[str, Any]]):
    """Property 9b: Tool calls that raise exceptions produce results with ok=False.

    When a tool execution raises an exception, the result SHALL be marked
    with ok=False and include an error description.

    **Validates: Requirements 10.4**
    """
    service = AiChatService()
    context = _make_context(max_calls=len(calls))

    def mock_execute(*, tool_id, raw_args, context):
        raise RuntimeError(f"Simulated failure for {tool_id}")

    mock_tool = MagicMock()
    mock_tool.stage = "checking_itinvent"

    with patch("backend.ai_chat.service.ai_tool_registry") as mock_registry:
        mock_registry.get.return_value = mock_tool
        mock_registry.execute.side_effect = mock_execute

        results, traces = service._execute_tool_calls(
            tool_calls=calls,
            tool_context=context,
            report_stage=None,
        )

    for i, result in enumerate(results):
        assert result["ok"] is False, (
            f"Result at index {i} should be ok=False for a failed tool call"
        )
        assert result.get("error"), (
            f"Result at index {i} should have an error message"
        )


@settings(max_examples=100)
@given(calls=tool_call_sequence())
def test_mixed_success_and_failure_all_processed(calls: list[dict[str, Any]]):
    """Property 9c: In a mixed sequence of successes and failures, all calls are processed.

    For any sequence where some tools succeed (return AiToolResult with ok=True)
    and some fail (raise exceptions), the loop SHALL process every call and
    the results SHALL contain entries for all of them.

    **Validates: Requirements 10.4**
    """
    assume(len(calls) >= 2)

    service = AiChatService()
    context = _make_context(max_calls=len(calls))

    # Alternate success/failure: even indices succeed, odd indices fail
    call_index = [0]

    def mock_execute(*, tool_id, raw_args, context):
        idx = call_index[0]
        call_index[0] += 1
        if idx % 2 == 0:
            # Success
            return (
                AiToolResult(
                    tool_id=tool_id,
                    ok=True,
                    data={"result": "success"},
                    database_id="TEST_DB",
                ),
                {
                    "tool_id": tool_id,
                    "database_id": "TEST_DB",
                    "status": "ok",
                    "latency_ms": 10,
                    "conversation_id": context.conversation_id,
                    "bot_id": context.bot_id,
                    "user_id": int(context.user_id or 0),
                },
            )
        else:
            # Failure
            raise RuntimeError(f"Simulated failure for {tool_id}")

    mock_tool = MagicMock()
    mock_tool.stage = "checking_itinvent"

    with patch("backend.ai_chat.service.ai_tool_registry") as mock_registry:
        mock_registry.get.return_value = mock_tool
        mock_registry.execute.side_effect = mock_execute

        results, traces = service._execute_tool_calls(
            tool_calls=calls,
            tool_context=context,
            report_stage=None,
        )

    # Core property: ALL calls are processed regardless of individual failures
    assert len(results) == len(calls), (
        f"Expected {len(calls)} results but got {len(results)}. "
        f"Tool loop terminated early due to a failure."
    )
    assert len(traces) == len(calls), (
        f"Expected {len(calls)} traces but got {len(traces)}. "
        f"Tool loop terminated early due to a failure."
    )

    # Verify that we have a mix of successes and failures in results
    ok_count = sum(1 for r in results if r.get("ok") is True)
    fail_count = sum(1 for r in results if r.get("ok") is False)
    assert ok_count + fail_count == len(calls), (
        f"All results should have a definite ok status. "
        f"ok={ok_count}, fail={fail_count}, total={len(calls)}"
    )


@settings(max_examples=100)
@given(calls=tool_call_sequence())
def test_validation_errors_do_not_terminate_loop(calls: list[dict[str, Any]]):
    """Property 9d: AiToolValidationError on individual calls does not terminate the loop.

    When a tool raises AiToolValidationError (invalid arguments), the loop SHALL
    continue processing remaining calls and produce results for all of them.

    **Validates: Requirements 10.4**
    """
    service = AiChatService()
    context = _make_context(max_calls=len(calls))

    def mock_execute(*, tool_id, raw_args, context):
        raise AiToolValidationError(f"Invalid args for {tool_id}: missing required field")

    mock_tool = MagicMock()
    mock_tool.stage = "checking_itinvent"

    with patch("backend.ai_chat.service.ai_tool_registry") as mock_registry:
        mock_registry.get.return_value = mock_tool
        mock_registry.execute.side_effect = mock_execute

        results, traces = service._execute_tool_calls(
            tool_calls=calls,
            tool_context=context,
            report_stage=None,
        )

    # Core property: all calls produce results even with validation errors
    assert len(results) == len(calls), (
        f"Expected {len(calls)} results but got {len(results)}. "
        f"Validation error terminated the loop early."
    )
    assert len(traces) == len(calls), (
        f"Expected {len(calls)} traces but got {len(traces)}. "
        f"Validation error terminated the loop early."
    )

    # All results should be failures with diagnostic info
    for i, result in enumerate(results):
        assert result["ok"] is False, (
            f"Result at index {i} should be ok=False for validation error"
        )
