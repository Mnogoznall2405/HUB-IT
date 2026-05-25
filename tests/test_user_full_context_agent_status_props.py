"""
Property-based tests for Agent Status Calculation.

Feature: user-full-context
Property 5: Agent Status Calculation

**Validates: Requirement 3.4**

For any last_seen_at timestamp, the calculated agent_status SHALL be "online" if
age <= ONLINE_MAX_AGE_SECONDS, "stale" if ONLINE_MAX_AGE_SECONDS < age <=
STALE_MAX_AGE_SECONDS, "offline" if age > STALE_MAX_AGE_SECONDS, and "unknown"
if last_seen_at is null/zero.
"""

import sys
from pathlib import Path
from unittest.mock import patch

# Ensure WEB-itinvent is on the path (backend lives there)
PROJECT_ROOT = Path(__file__).resolve().parents[1]
WEB_ROOT = PROJECT_ROOT / "WEB-itinvent"
if str(WEB_ROOT) not in sys.path:
    sys.path.insert(0, str(WEB_ROOT))

from hypothesis import given, settings
from hypothesis.strategies import integers, just, one_of

# Known threshold values for mocking
MOCK_ONLINE_MAX_AGE = 300   # 5 minutes
MOCK_STALE_MAX_AGE = 900    # 15 minutes

# Fixed "now" timestamp to avoid timing issues between test setup and function call
FIXED_NOW = 1_700_000_000


# --- Property Tests ---


@settings(max_examples=100)
@given(age=integers(min_value=0, max_value=MOCK_ONLINE_MAX_AGE))
def test_agent_status_online_when_age_within_threshold(age: int):
    """Property 5a: For any last_seen_at timestamp where age <= ONLINE_MAX_AGE_SECONDS,
    the calculated agent_status SHALL be "online".

    **Validates: Requirement 3.4**
    """
    last_seen_at = FIXED_NOW - age

    with (
        patch(
            "backend.api.v1.inventory.ONLINE_MAX_AGE_SECONDS",
            MOCK_ONLINE_MAX_AGE,
        ),
        patch(
            "backend.api.v1.inventory.STALE_MAX_AGE_SECONDS",
            MOCK_STALE_MAX_AGE,
        ),
        patch("time.time", return_value=float(FIXED_NOW)),
    ):
        from backend.ai_chat.tools.itinvent import _calculate_agent_status

        result = _calculate_agent_status(last_seen_at)

    assert result == "online", (
        f"Expected 'online' for age={age} (<= {MOCK_ONLINE_MAX_AGE}), got {result!r}"
    )


@settings(max_examples=100)
@given(age=integers(min_value=MOCK_ONLINE_MAX_AGE + 1, max_value=MOCK_STALE_MAX_AGE))
def test_agent_status_stale_when_age_between_thresholds(age: int):
    """Property 5b: For any last_seen_at timestamp where ONLINE_MAX_AGE_SECONDS < age
    <= STALE_MAX_AGE_SECONDS, the calculated agent_status SHALL be "stale".

    **Validates: Requirement 3.4**
    """
    last_seen_at = FIXED_NOW - age

    with (
        patch(
            "backend.api.v1.inventory.ONLINE_MAX_AGE_SECONDS",
            MOCK_ONLINE_MAX_AGE,
        ),
        patch(
            "backend.api.v1.inventory.STALE_MAX_AGE_SECONDS",
            MOCK_STALE_MAX_AGE,
        ),
        patch("time.time", return_value=float(FIXED_NOW)),
    ):
        from backend.ai_chat.tools.itinvent import _calculate_agent_status

        result = _calculate_agent_status(last_seen_at)

    assert result == "stale", (
        f"Expected 'stale' for age={age} (> {MOCK_ONLINE_MAX_AGE} and "
        f"<= {MOCK_STALE_MAX_AGE}), got {result!r}"
    )


@settings(max_examples=100)
@given(age=integers(min_value=MOCK_STALE_MAX_AGE + 1, max_value=86400 * 365))
def test_agent_status_offline_when_age_exceeds_stale_threshold(age: int):
    """Property 5c: For any last_seen_at timestamp where age > STALE_MAX_AGE_SECONDS,
    the calculated agent_status SHALL be "offline".

    **Validates: Requirement 3.4**
    """
    last_seen_at = FIXED_NOW - age

    with (
        patch(
            "backend.api.v1.inventory.ONLINE_MAX_AGE_SECONDS",
            MOCK_ONLINE_MAX_AGE,
        ),
        patch(
            "backend.api.v1.inventory.STALE_MAX_AGE_SECONDS",
            MOCK_STALE_MAX_AGE,
        ),
        patch("time.time", return_value=float(FIXED_NOW)),
    ):
        from backend.ai_chat.tools.itinvent import _calculate_agent_status

        result = _calculate_agent_status(last_seen_at)

    assert result == "offline", (
        f"Expected 'offline' for age={age} (> {MOCK_STALE_MAX_AGE}), got {result!r}"
    )


@settings(max_examples=100)
@given(value=one_of(just(0), just(None)))
def test_agent_status_unknown_when_last_seen_is_null_or_zero(value):
    """Property 5d: For any last_seen_at that is null or zero, the calculated
    agent_status SHALL be "unknown".

    **Validates: Requirement 3.4**
    """
    with (
        patch(
            "backend.api.v1.inventory.ONLINE_MAX_AGE_SECONDS",
            MOCK_ONLINE_MAX_AGE,
        ),
        patch(
            "backend.api.v1.inventory.STALE_MAX_AGE_SECONDS",
            MOCK_STALE_MAX_AGE,
        ),
        patch("time.time", return_value=float(FIXED_NOW)),
    ):
        from backend.ai_chat.tools.itinvent import _calculate_agent_status

        result = _calculate_agent_status(value)

    assert result == "unknown", (
        f"Expected 'unknown' for last_seen_at={value!r}, got {result!r}"
    )
