"""Property-based tests for Windows FILETIME to datetime conversion round-trip.

Feature: ai-agent-universal-tools, Property 7: Windows FILETIME to datetime conversion round-trip

**Validates: Requirements 8.1, 14.2, 14.3**

For any valid Windows FILETIME integer (representing a date between 1970-01-01 and 2100-01-01),
converting to a Python datetime and back to FILETIME SHALL produce the original value
(within 1-second precision). When the FILETIME is 0, the result SHALL be None.
"""

import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).parent.parent))

from hypothesis import given, settings, assume
from hypothesis import strategies as st
from datetime import datetime, timezone

from backend.services.ad_users_service import (
    filetime_to_datetime,
    datetime_to_filetime,
    epoch_diff,
)

# FILETIME range for dates between 1970-01-01 and 2100-01-01
# 1970-01-01 in FILETIME = epoch_diff = 116444736000000000
# 2100-01-01 in FILETIME: (2100-01-01 - 1601-01-01) in 100ns intervals
# seconds from 1601-01-01 to 2100-01-01 = (datetime(2100,1,1) - datetime(1601,1,1)).total_seconds()
# = 15747024000 seconds * 10_000_000 = 157470240000000000
_FILETIME_1970 = epoch_diff  # 116444736000000000
_FILETIME_2100 = 157470240000000000  # approx 2100-01-01 in FILETIME

# Strategy: generate FILETIME values aligned to 1-second boundaries (multiples of 10_000_000)
# This ensures the round-trip is exact within 1-second precision.
filetime_strategy = st.integers(
    min_value=_FILETIME_1970,
    max_value=_FILETIME_2100,
).map(lambda x: (x // 10_000_000) * 10_000_000)


@settings(max_examples=100)
@given(filetime=filetime_strategy)
def test_filetime_round_trip(filetime: int):
    """Converting FILETIME to datetime and back produces the original value within 1-second precision.

    **Validates: Requirements 8.1, 14.2, 14.3**
    """
    dt = filetime_to_datetime(filetime)
    assert dt is not None, f"filetime_to_datetime({filetime}) should not return None for valid FILETIME"
    assert dt.tzinfo is not None, "Returned datetime should be timezone-aware (UTC)"

    # Round-trip back to FILETIME
    reconstructed = datetime_to_filetime(dt)

    # Within 1-second precision means difference <= 10_000_000 (one second in 100ns intervals)
    diff = abs(reconstructed - filetime)
    assert diff <= 10_000_000, (
        f"Round-trip failed: original={filetime}, reconstructed={reconstructed}, "
        f"diff={diff} (max allowed=10000000)"
    )


@settings(max_examples=100)
@given(filetime=filetime_strategy)
def test_filetime_to_datetime_produces_utc(filetime: int):
    """filetime_to_datetime always returns a UTC-aware datetime for valid FILETIME values.

    **Validates: Requirements 14.2, 14.3**
    """
    dt = filetime_to_datetime(filetime)
    assert dt is not None
    assert dt.tzinfo == timezone.utc


def test_filetime_zero_returns_none():
    """When the FILETIME is 0, the result SHALL be None.

    **Validates: Requirements 8.1, 14.2, 14.3**
    """
    result = filetime_to_datetime(0)
    assert result is None, "filetime_to_datetime(0) should return None"


def test_filetime_none_returns_none():
    """When the FILETIME is None, the result SHALL be None.

    **Validates: Requirements 8.1**
    """
    result = filetime_to_datetime(None)
    assert result is None, "filetime_to_datetime(None) should return None"


def test_filetime_negative_returns_none():
    """When the FILETIME is negative, the result SHALL be None.

    **Validates: Requirements 8.1**
    """
    result = filetime_to_datetime(-1)
    assert result is None, "filetime_to_datetime(-1) should return None"
