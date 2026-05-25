"""Property-based tests for password expiration status completeness.

Feature: ai-agent-universal-tools
Property 2: Password expiration status completeness

**Validates: Requirements 1.3**
"""
from __future__ import annotations

import sys
from datetime import datetime, timezone, timedelta
from pathlib import Path

from hypothesis import given, settings, assume
from hypothesis import strategies as st

PROJECT_ROOT = Path(__file__).resolve().parents[1]
WEB_ROOT = PROJECT_ROOT / "WEB-itinvent"

if str(WEB_ROOT) not in sys.path:
    sys.path.insert(0, str(WEB_ROOT))

from backend.services.ad_users_service import (
    calculate_password_expiration_status,
    epoch_diff,
)

# Required keys that must always be present in the result
REQUIRED_KEYS = frozenset({
    "pwd_last_set_date",
    "expiration_date",
    "password_age_days",
    "days_to_expire",
    "expired",
    "must_change_now",
    "policy_days",
})

# Strategy for valid Windows FILETIME values:
# - 0 means "must change at next logon"
# - Positive values represent 100ns intervals since 1601-01-01
# We generate values covering: 0, small positives, realistic FILETIME range (year 2000-2030)
_FILETIME_2000 = int(datetime(2000, 1, 1, tzinfo=timezone.utc).timestamp() * 10_000_000) + epoch_diff
_FILETIME_2030 = int(datetime(2030, 1, 1, tzinfo=timezone.utc).timestamp() * 10_000_000) + epoch_diff

pwd_last_set_strategy = st.one_of(
    st.just(0),
    st.integers(min_value=1, max_value=100),  # small positive (edge cases)
    st.integers(min_value=_FILETIME_2000, max_value=_FILETIME_2030),  # realistic FILETIME range
)


@settings(max_examples=100)
@given(pwd_last_set=pwd_last_set_strategy)
def test_password_status_contains_all_required_keys(pwd_last_set: int) -> None:
    """Property 2a: For any pwdLastSet value, the result contains all required keys.

    **Validates: Requirements 1.3**
    """
    result = calculate_password_expiration_status(pwd_last_set, max_age_days=40)

    assert isinstance(result, dict), f"Expected dict, got {type(result)}"
    missing_keys = REQUIRED_KEYS - set(result.keys())
    assert not missing_keys, f"Missing required keys: {missing_keys}"


@settings(max_examples=100)
@given(
    pwd_last_set=st.integers(min_value=_FILETIME_2000, max_value=_FILETIME_2030),
    policy_days=st.integers(min_value=1, max_value=365),
)
def test_password_status_expired_consistency(pwd_last_set: int, policy_days: int) -> None:
    """Property 2b: When pwdLastSet > 0 (valid FILETIME), expired == (days_to_expire == 0 and expiration_date < now).

    **Validates: Requirements 1.3**
    """
    # Use a fixed now to avoid flakiness from time passing during test
    now = datetime.now(timezone.utc)

    result = calculate_password_expiration_status(
        pwd_last_set, now_utc=now, max_age_days=policy_days
    )

    assert pwd_last_set > 0  # precondition

    # For valid FILETIME values in the realistic range, expiration_date must be present
    expiration_date_str = result["expiration_date"]
    assert expiration_date_str is not None, "expiration_date should not be None for valid FILETIME"
    expiration_date = datetime.fromisoformat(expiration_date_str)

    days_to_expire = result["days_to_expire"]
    expired = result["expired"]

    # Property: expired == (days_to_expire == 0 and expiration_date < now)
    expected_expired = (days_to_expire == 0 and expiration_date < now)
    assert expired == expected_expired, (
        f"expired={expired} but expected {expected_expired} "
        f"(days_to_expire={days_to_expire}, expiration_date={expiration_date}, now={now})"
    )
