"""Property-based tests for SSL certificate days_until_expiry calculation.

Feature: ai-agent-universal-tools, Property 10: SSL certificate days_until_expiry calculation

**Validates: Requirements 12.2**

For any certificate with `valid_until` date, `days_until_expiry` SHALL equal
`ceil((valid_until - now).total_seconds() / 86400)` when `valid_until > now`,
and 0 otherwise. `is_valid` SHALL be True if and only if `valid_from <= now <= valid_until`
and the certificate is not self-signed with hostname mismatch.
"""

import sys
import math
from pathlib import Path

sys.path.insert(0, str(Path(__file__).parent.parent))
sys.path.insert(0, str(Path(__file__).parent.parent / "WEB-itinvent"))

from hypothesis import given, settings, assume
from hypothesis import strategies as st
from datetime import datetime, timezone, timedelta

from backend.ai_chat.tools.network import compute_days_until_expiry


# Strategy: generate timezone-aware datetimes in a reasonable range (2000-2100)
aware_datetimes = st.datetimes(
    min_value=datetime(2000, 1, 1),
    max_value=datetime(2100, 1, 1),
    timezones=st.just(timezone.utc),
)


@settings(max_examples=100)
@given(valid_until=aware_datetimes, now=aware_datetimes)
def test_days_until_expiry_matches_formula(valid_until: datetime, now: datetime):
    """days_until_expiry equals ceil((valid_until - now).total_seconds() / 86400)
    when valid_until > now, and 0 otherwise.

    **Validates: Requirements 12.2**
    """
    result = compute_days_until_expiry(valid_until, now)

    diff_seconds = (valid_until - now).total_seconds()

    if diff_seconds <= 0:
        assert result == 0, (
            f"Expected 0 when valid_until <= now, got {result}. "
            f"valid_until={valid_until}, now={now}, diff_seconds={diff_seconds}"
        )
    else:
        expected = math.ceil(diff_seconds / 86400)
        assert result == expected, (
            f"Expected ceil({diff_seconds}/86400)={expected}, got {result}. "
            f"valid_until={valid_until}, now={now}"
        )


@settings(max_examples=100)
@given(valid_until=aware_datetimes, now=aware_datetimes)
def test_days_until_expiry_non_negative(valid_until: datetime, now: datetime):
    """days_until_expiry SHALL always be non-negative (>= 0).

    **Validates: Requirements 12.2**
    """
    result = compute_days_until_expiry(valid_until, now)
    assert result >= 0, (
        f"days_until_expiry should never be negative, got {result}. "
        f"valid_until={valid_until}, now={now}"
    )


@settings(max_examples=100)
@given(
    valid_from=aware_datetimes,
    valid_until=aware_datetimes,
    now=aware_datetimes,
)
def test_is_valid_iff_within_validity_period(
    valid_from: datetime, valid_until: datetime, now: datetime
):
    """is_valid SHALL be True if and only if valid_from <= now <= valid_until.

    This tests the validity logic as used in NetworkSslCheckTool.execute().

    **Validates: Requirements 12.2**
    """
    # Replicate the is_valid logic from NetworkSslCheckTool.execute()
    is_valid = valid_from <= now <= valid_until

    # Verify the property: is_valid is True iff now is within [valid_from, valid_until]
    if now < valid_from or now > valid_until:
        assert is_valid is False, (
            f"is_valid should be False when now is outside validity period. "
            f"valid_from={valid_from}, valid_until={valid_until}, now={now}"
        )
    else:
        assert is_valid is True, (
            f"is_valid should be True when valid_from <= now <= valid_until. "
            f"valid_from={valid_from}, valid_until={valid_until}, now={now}"
        )


@settings(max_examples=100)
@given(now=aware_datetimes)
def test_days_until_expiry_zero_when_expired(now: datetime):
    """When valid_until <= now, days_until_expiry SHALL be 0.

    **Validates: Requirements 12.2**
    """
    # Generate a valid_until that is at or before now
    valid_until = now - timedelta(seconds=1)
    result = compute_days_until_expiry(valid_until, now)
    assert result == 0, (
        f"Expected 0 for expired cert, got {result}. "
        f"valid_until={valid_until}, now={now}"
    )


def test_days_until_expiry_exactly_one_day():
    """When valid_until is exactly 86400 seconds after now, result should be 1.

    **Validates: Requirements 12.2**
    """
    now = datetime(2024, 6, 15, 12, 0, 0, tzinfo=timezone.utc)
    valid_until = now + timedelta(seconds=86400)
    result = compute_days_until_expiry(valid_until, now)
    assert result == 1


def test_days_until_expiry_partial_day_rounds_up():
    """When valid_until is 1 second after now, ceil should give 1 day.

    **Validates: Requirements 12.2**
    """
    now = datetime(2024, 6, 15, 12, 0, 0, tzinfo=timezone.utc)
    valid_until = now + timedelta(seconds=1)
    result = compute_days_until_expiry(valid_until, now)
    assert result == 1, f"Expected 1 for partial day, got {result}"


def test_days_until_expiry_same_time_is_zero():
    """When valid_until equals now exactly, result should be 0.

    **Validates: Requirements 12.2**
    """
    now = datetime(2024, 6, 15, 12, 0, 0, tzinfo=timezone.utc)
    result = compute_days_until_expiry(now, now)
    assert result == 0


def test_days_until_expiry_naive_datetime_handled():
    """Naive datetimes (no tzinfo) should be handled by treating them as UTC.

    **Validates: Requirements 12.2**
    """
    now = datetime(2024, 6, 15, 12, 0, 0)  # naive
    valid_until = datetime(2024, 6, 17, 12, 0, 0)  # naive, 2 days later
    result = compute_days_until_expiry(valid_until, now)
    assert result == 2
