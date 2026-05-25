"""
Property-based tests for UserFullContextArgs input validation boundaries.

Feature: user-full-context
Property 1: Input Validation Boundaries

**Validates: Requirement 1.4**

For any string of length 1 to 160 characters, UserFullContextArgs validation SHALL
accept it as a valid query; for any empty string or string exceeding 160 characters,
validation SHALL reject it.
"""

import sys
from pathlib import Path

# Ensure WEB-itinvent is on the path (backend lives there)
PROJECT_ROOT = Path(__file__).resolve().parents[1]
WEB_ROOT = PROJECT_ROOT / "WEB-itinvent"
if str(WEB_ROOT) not in sys.path:
    sys.path.insert(0, str(WEB_ROOT))

import pytest
from hypothesis import given, settings, assume
from hypothesis.strategies import text, integers, sampled_from
from pydantic import ValidationError

from backend.ai_chat.tools.itinvent import UserFullContextArgs


# --- Strategies ---

# Valid query strings: length 1 to 160, non-whitespace-only
# We use printable characters that won't be stripped to empty
_VALID_CHARS = "abcdefghijklmnopqrstuvwxyzАБВГДЕЖЗИКЛМНОПРСТУФХЦЧШЩЭЮЯ0123456789_.-@"
valid_query = text(alphabet=_VALID_CHARS, min_size=1, max_size=160)

# Invalid: strings exceeding 160 characters (non-whitespace content)
too_long_query = text(alphabet=_VALID_CHARS, min_size=161, max_size=300)

# Invalid: empty string
empty_query = sampled_from([""])

# Invalid: whitespace-only strings (normalizer strips them to empty → None → rejected)
whitespace_only = sampled_from(["   ", "\t", "\n", "  \t\n  ", " "])


# --- Property Tests: Valid queries accepted ---


@settings(max_examples=100)
@given(query=valid_query)
def test_accepts_valid_query_length_1_to_160(query: str):
    """Property 1a: UserFullContextArgs accepts any non-empty string of length 1-160.

    **Validates: Requirement 1.4**
    """
    # Ensure the generated string is non-empty after strip (our alphabet guarantees this)
    assume(query.strip())
    assume(len(query.strip()) <= 160)
    args = UserFullContextArgs(query=query)
    assert args.query == query.strip()
    assert 1 <= len(args.query) <= 160


# --- Property Tests: Too-long queries rejected ---


@settings(max_examples=100)
@given(query=too_long_query)
def test_rejects_query_exceeding_160_characters(query: str):
    """Property 1b: UserFullContextArgs rejects strings longer than 160 characters.

    **Validates: Requirement 1.4**
    """
    assume(len(query.strip()) > 160)
    with pytest.raises(ValidationError):
        UserFullContextArgs(query=query)


# --- Property Tests: Empty string rejected ---


@settings(max_examples=100)
@given(query=empty_query)
def test_rejects_empty_string(query: str):
    """Property 1c: UserFullContextArgs rejects empty strings.

    **Validates: Requirement 1.4**
    """
    with pytest.raises(ValidationError):
        UserFullContextArgs(query=query)


# --- Property Tests: Whitespace-only strings rejected ---


@settings(max_examples=100)
@given(query=whitespace_only)
def test_rejects_whitespace_only_strings(query: str):
    """Property 1d: UserFullContextArgs rejects whitespace-only strings (normalizer strips to empty).

    **Validates: Requirement 1.4**
    """
    with pytest.raises(ValidationError):
        UserFullContextArgs(query=query)
