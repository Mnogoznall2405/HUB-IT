"""
Property-based tests for token budget exhaustion monotonicity.

Feature: ai-agent-universal-tools
Property 5: Token budget exhaustion is monotonic

**Validates: Requirements 4.4**

For any sequence of `(prompt_tokens, completion_tokens)` pairs added to a `TokenBudget`
with a fixed `model_context_window`, the `remaining` property SHALL be non-negative and
monotonically non-increasing, and `exhausted` SHALL become True if and only if
`accumulated_prompt_tokens + accumulated_completion_tokens >= model_context_window - safety_margin`.
"""

import sys
from pathlib import Path

# Ensure WEB-itinvent is on the path (backend lives there)
PROJECT_ROOT = Path(__file__).resolve().parents[1]
WEB_ROOT = PROJECT_ROOT / "WEB-itinvent"
if str(WEB_ROOT) not in sys.path:
    sys.path.insert(0, str(WEB_ROOT))

from hypothesis import given, settings, assume
from hypothesis.strategies import integers, lists, tuples

from backend.ai_chat.service import TokenBudget


# --- Strategies ---

# Token counts are non-negative integers (realistic range for LLM usage)
token_count = integers(min_value=0, max_value=50000)

# A usage pair: (prompt_tokens, completion_tokens)
usage_pair = tuples(token_count, token_count)

# A sequence of usage pairs (simulating multiple tool rounds)
usage_sequence = lists(usage_pair, min_size=1, max_size=20)

# Context window sizes (realistic range for LLM models)
context_window = integers(min_value=1000, max_value=200000)

# Safety margin (realistic range)
safety_margin_st = integers(min_value=0, max_value=10000)


# --- Property Tests ---


@settings(max_examples=100)
@given(
    window=context_window,
    margin=safety_margin_st,
    usages=usage_sequence,
)
def test_remaining_is_always_non_negative(window: int, margin: int, usages: list):
    """Property 5a: The `remaining` property is always non-negative after any sequence of usage additions.

    **Validates: Requirements 4.4**
    """
    assume(margin < window)  # safety margin must be less than context window

    budget = TokenBudget(
        model_context_window=window,
        safety_margin=margin,
    )

    for prompt_tokens, completion_tokens in usages:
        budget.add_usage({"prompt_tokens": prompt_tokens, "completion_tokens": completion_tokens})
        assert budget.remaining >= 0, (
            f"remaining={budget.remaining} is negative after adding "
            f"prompt={prompt_tokens}, completion={completion_tokens}"
        )


@settings(max_examples=100)
@given(
    window=context_window,
    margin=safety_margin_st,
    usages=usage_sequence,
)
def test_remaining_is_monotonically_non_increasing(window: int, margin: int, usages: list):
    """Property 5b: The `remaining` property is monotonically non-increasing across usage additions.

    **Validates: Requirements 4.4**
    """
    assume(margin < window)

    budget = TokenBudget(
        model_context_window=window,
        safety_margin=margin,
    )

    previous_remaining = budget.remaining

    for prompt_tokens, completion_tokens in usages:
        budget.add_usage({"prompt_tokens": prompt_tokens, "completion_tokens": completion_tokens})
        current_remaining = budget.remaining
        assert current_remaining <= previous_remaining, (
            f"remaining increased from {previous_remaining} to {current_remaining} "
            f"after adding prompt={prompt_tokens}, completion={completion_tokens}"
        )
        previous_remaining = current_remaining


@settings(max_examples=100)
@given(
    window=context_window,
    margin=safety_margin_st,
    usages=usage_sequence,
)
def test_exhausted_iff_accumulated_exceeds_budget(window: int, margin: int, usages: list):
    """Property 5c: `exhausted` is True if and only if accumulated tokens >= window - margin.

    **Validates: Requirements 4.4**
    """
    assume(margin < window)

    budget = TokenBudget(
        model_context_window=window,
        safety_margin=margin,
    )

    for prompt_tokens, completion_tokens in usages:
        budget.add_usage({"prompt_tokens": prompt_tokens, "completion_tokens": completion_tokens})

    total_used = budget.accumulated_prompt_tokens + budget.accumulated_completion_tokens
    effective_budget = window - margin

    if total_used >= effective_budget:
        assert budget.exhausted is True, (
            f"Expected exhausted=True when total_used={total_used} >= "
            f"effective_budget={effective_budget} (window={window}, margin={margin})"
        )
    else:
        assert budget.exhausted is False, (
            f"Expected exhausted=False when total_used={total_used} < "
            f"effective_budget={effective_budget} (window={window}, margin={margin})"
        )


@settings(max_examples=100)
@given(
    window=context_window,
    margin=safety_margin_st,
    usages=usage_sequence,
)
def test_exhausted_once_true_stays_true(window: int, margin: int, usages: list):
    """Property 5d: Once `exhausted` becomes True, it remains True for all subsequent additions.

    This follows from monotonicity of `remaining` — once it hits 0, it stays at 0.

    **Validates: Requirements 4.4**
    """
    assume(margin < window)

    budget = TokenBudget(
        model_context_window=window,
        safety_margin=margin,
    )

    became_exhausted = False

    for prompt_tokens, completion_tokens in usages:
        budget.add_usage({"prompt_tokens": prompt_tokens, "completion_tokens": completion_tokens})

        if budget.exhausted:
            became_exhausted = True

        if became_exhausted:
            assert budget.exhausted is True, (
                f"exhausted flipped back to False after being True. "
                f"accumulated_prompt={budget.accumulated_prompt_tokens}, "
                f"accumulated_completion={budget.accumulated_completion_tokens}, "
                f"window={window}, margin={margin}"
            )


@settings(max_examples=100)
@given(
    window=context_window,
    margin=safety_margin_st,
    usages=usage_sequence,
)
def test_remaining_equals_expected_formula(window: int, margin: int, usages: list):
    """Property 5e: `remaining` equals max(0, window - margin - accumulated_total) at all times.

    **Validates: Requirements 4.4**
    """
    assume(margin < window)

    budget = TokenBudget(
        model_context_window=window,
        safety_margin=margin,
    )

    for prompt_tokens, completion_tokens in usages:
        budget.add_usage({"prompt_tokens": prompt_tokens, "completion_tokens": completion_tokens})

        total_used = budget.accumulated_prompt_tokens + budget.accumulated_completion_tokens
        expected_remaining = max(0, window - margin - total_used)

        assert budget.remaining == expected_remaining, (
            f"remaining={budget.remaining} != expected={expected_remaining}. "
            f"total_used={total_used}, window={window}, margin={margin}"
        )
