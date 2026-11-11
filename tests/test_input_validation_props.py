"""
Property-based tests for Pydantic input model validation ranges.

Feature: ai-agent-universal-tools
Property 3: Pydantic input model validation respects declared ranges

**Validates: Requirements 2.2, 4.1, 4.3, 5.5, 6.2**

For any integer value, the tool input models SHALL accept values within their declared
range and reject values outside it. Specifically:
- days_threshold accepts 1–30
- limit accepts 1–200
- max_tool_rounds accepts 1–12
- max_tool_calls_per_round accepts 1–5
- count (ping) accepts 1–10
- record_type accepts only the enum set {A, AAAA, MX, CNAME, PTR, TXT, NS}
"""

import sys
from pathlib import Path
from unittest.mock import patch

# Ensure WEB-itinvent is on the path (backend lives there)
PROJECT_ROOT = Path(__file__).resolve().parents[1]
WEB_ROOT = PROJECT_ROOT / "WEB-itinvent"
if str(WEB_ROOT) not in sys.path:
    sys.path.insert(0, str(WEB_ROOT))

import pytest
from hypothesis import given, settings, assume
from hypothesis.strategies import integers, sampled_from, text, one_of, just
from pydantic import ValidationError

from backend.ai_chat.tools.ad import AdMailboxesExpiringSoonArgs
from backend.ai_chat.tools.network import NetworkHostPingArgs, NetworkDnsLookupArgs
from backend.ai_chat.tools.context import normalize_tool_settings


# --- Strategies ---

# Valid ranges
valid_days_threshold = integers(min_value=1, max_value=30)
invalid_days_threshold_low = integers(max_value=0)
invalid_days_threshold_high = integers(min_value=31)

valid_limit = integers(min_value=1, max_value=200)
invalid_limit_low = integers(max_value=0)
invalid_limit_high = integers(min_value=201)

valid_count = integers(min_value=1, max_value=10)
invalid_count_low = integers(max_value=0)
invalid_count_high = integers(min_value=11)

valid_max_tool_rounds = integers(min_value=1, max_value=12)
invalid_max_tool_rounds_low = integers(max_value=0)
invalid_max_tool_rounds_high = integers(min_value=13)

valid_max_tool_calls_per_round = integers(min_value=1, max_value=5)
invalid_max_tool_calls_per_round_low = integers(max_value=0)
invalid_max_tool_calls_per_round_high = integers(min_value=6)

valid_record_types = sampled_from(["A", "AAAA", "MX", "CNAME", "PTR", "TXT", "NS"])

# Invalid record types: strings that are NOT in the valid set
_invalid_record_type_examples = ["B", "SRV", "SOA", "CAA", "DNSKEY", "a", "aaaa", "mx", "", "X", "INVALID"]
invalid_record_types = sampled_from(_invalid_record_type_examples)


# --- Property Tests: AdMailboxesExpiringSoonArgs ---


@settings(max_examples=100)
@given(days=valid_days_threshold, limit=valid_limit)
def test_mailboxes_expiring_accepts_valid_days_and_limit(days: int, limit: int):
    """Property 3a: AdMailboxesExpiringSoonArgs accepts days_threshold in [1,30] and limit in [1,200].

    **Validates: Requirements 2.2**
    """
    args = AdMailboxesExpiringSoonArgs(days_threshold=days, limit=limit)
    assert args.days_threshold == days
    assert args.limit == limit


@settings(max_examples=100)
@given(days=invalid_days_threshold_low)
def test_mailboxes_expiring_rejects_days_below_range(days: int):
    """Property 3b: AdMailboxesExpiringSoonArgs rejects days_threshold < 1.

    **Validates: Requirements 2.2**
    """
    with pytest.raises(ValidationError):
        AdMailboxesExpiringSoonArgs(days_threshold=days, limit=50)


@settings(max_examples=100)
@given(days=invalid_days_threshold_high)
def test_mailboxes_expiring_rejects_days_above_range(days: int):
    """Property 3c: AdMailboxesExpiringSoonArgs rejects days_threshold > 30.

    **Validates: Requirements 2.2**
    """
    with pytest.raises(ValidationError):
        AdMailboxesExpiringSoonArgs(days_threshold=days, limit=50)


@settings(max_examples=100)
@given(limit=invalid_limit_low)
def test_mailboxes_expiring_rejects_limit_below_range(limit: int):
    """Property 3d: AdMailboxesExpiringSoonArgs rejects limit < 1.

    **Validates: Requirements 2.2**
    """
    with pytest.raises(ValidationError):
        AdMailboxesExpiringSoonArgs(days_threshold=3, limit=limit)


@settings(max_examples=100)
@given(limit=invalid_limit_high)
def test_mailboxes_expiring_rejects_limit_above_range(limit: int):
    """Property 3e: AdMailboxesExpiringSoonArgs rejects limit > 200.

    **Validates: Requirements 2.2**
    """
    with pytest.raises(ValidationError):
        AdMailboxesExpiringSoonArgs(days_threshold=3, limit=limit)


# --- Property Tests: NetworkHostPingArgs ---


@settings(max_examples=100)
@given(count=valid_count)
def test_ping_accepts_valid_count(count: int):
    """Property 3f: NetworkHostPingArgs accepts count in [1,10].

    **Validates: Requirements 5.5**
    """
    args = NetworkHostPingArgs(host="example.com", count=count)
    assert args.count == count


@settings(max_examples=100)
@given(count=invalid_count_low)
def test_ping_rejects_count_below_range(count: int):
    """Property 3g: NetworkHostPingArgs rejects count < 1.

    **Validates: Requirements 5.5**
    """
    with pytest.raises(ValidationError):
        NetworkHostPingArgs(host="example.com", count=count)


@settings(max_examples=100)
@given(count=invalid_count_high)
def test_ping_rejects_count_above_range(count: int):
    """Property 3h: NetworkHostPingArgs rejects count > 10.

    **Validates: Requirements 5.5**
    """
    with pytest.raises(ValidationError):
        NetworkHostPingArgs(host="example.com", count=count)


# --- Property Tests: NetworkDnsLookupArgs ---


@settings(max_examples=100)
@given(record_type=valid_record_types)
def test_dns_accepts_valid_record_types(record_type: str):
    """Property 3i: NetworkDnsLookupArgs accepts record_type in {A, AAAA, MX, CNAME, PTR, TXT, NS}.

    **Validates: Requirements 6.2**
    """
    args = NetworkDnsLookupArgs(query="example.com", record_type=record_type)
    assert args.record_type == record_type


@settings(max_examples=100)
@given(record_type=invalid_record_types)
def test_dns_rejects_invalid_record_types(record_type: str):
    """Property 3j: NetworkDnsLookupArgs rejects record_type not in the valid enum set.

    **Validates: Requirements 6.2**
    """
    with pytest.raises(ValidationError):
        NetworkDnsLookupArgs(query="example.com", record_type=record_type)


# --- Property Tests: normalize_tool_settings (max_tool_rounds, max_tool_calls_per_round) ---


@settings(max_examples=100)
@given(rounds=valid_max_tool_rounds, calls=valid_max_tool_calls_per_round)
def test_normalize_tool_settings_accepts_valid_ranges(rounds: int, calls: int):
    """Property 3k: normalize_tool_settings preserves values within valid ranges.

    **Validates: Requirements 4.1, 4.3**
    """
    with patch("backend.ai_chat.tools.context.get_available_database_ids", return_value=set()):
        result = normalize_tool_settings({
            "max_tool_rounds": rounds,
            "max_tool_calls_per_round": calls,
        })
    assert result["max_tool_rounds"] == rounds
    assert result["max_tool_calls_per_round"] == calls


@settings(max_examples=100)
@given(rounds=invalid_max_tool_rounds_low)
def test_normalize_tool_settings_clamps_rounds_below_range(rounds: int):
    """Property 3l: normalize_tool_settings clamps max_tool_rounds < 1 to 1.

    **Validates: Requirements 4.1**
    """
    with patch("backend.ai_chat.tools.context.get_available_database_ids", return_value=set()):
        result = normalize_tool_settings({"max_tool_rounds": rounds})
    assert result["max_tool_rounds"] == 1


@settings(max_examples=100)
@given(rounds=invalid_max_tool_rounds_high)
def test_normalize_tool_settings_clamps_rounds_above_range(rounds: int):
    """Property 3m: normalize_tool_settings clamps max_tool_rounds > 12 to 12.

    **Validates: Requirements 4.1**
    """
    with patch("backend.ai_chat.tools.context.get_available_database_ids", return_value=set()):
        result = normalize_tool_settings({"max_tool_rounds": rounds})
    assert result["max_tool_rounds"] == 12


@settings(max_examples=100)
@given(calls=invalid_max_tool_calls_per_round_low)
def test_normalize_tool_settings_clamps_calls_below_range(calls: int):
    """Property 3n: normalize_tool_settings clamps max_tool_calls_per_round < 1 to 1.

    **Validates: Requirements 4.3**
    """
    with patch("backend.ai_chat.tools.context.get_available_database_ids", return_value=set()):
        result = normalize_tool_settings({"max_tool_calls_per_round": calls})
    assert result["max_tool_calls_per_round"] == 1


@settings(max_examples=100)
@given(calls=invalid_max_tool_calls_per_round_high)
def test_normalize_tool_settings_clamps_calls_above_range(calls: int):
    """Property 3o: normalize_tool_settings clamps max_tool_calls_per_round > 5 to 5.

    **Validates: Requirements 4.3**
    """
    with patch("backend.ai_chat.tools.context.get_available_database_ids", return_value=set()):
        result = normalize_tool_settings({"max_tool_calls_per_round": calls})
    assert result["max_tool_calls_per_round"] == 5


@settings(max_examples=100)
@given(rounds=integers(min_value=-1000, max_value=1000), calls=integers(min_value=-1000, max_value=1000))
def test_normalize_tool_settings_always_returns_within_bounds(rounds: int, calls: int):
    """Property 3p: normalize_tool_settings always returns values within declared bounds.

    For any integer input, max_tool_rounds is always in [1,12] and
    max_tool_calls_per_round is always in [1,5].

    **Validates: Requirements 4.1, 4.3**
    """
    with patch("backend.ai_chat.tools.context.get_available_database_ids", return_value=set()):
        result = normalize_tool_settings({
            "max_tool_rounds": rounds,
            "max_tool_calls_per_round": calls,
        })
    assert 1 <= result["max_tool_rounds"] <= 12
    assert 1 <= result["max_tool_calls_per_round"] <= 5
