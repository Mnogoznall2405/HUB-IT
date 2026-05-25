"""
Property-based tests for AD account type detection.

Feature: ai-agent-universal-tools
Property 1: Account type detection is total and correct

**Validates: Requirements 1.1, 1.2, 3.1, 3.2**

For any string `s` representing a sAMAccountName, `_detect_account_type(s)` SHALL return
"mailbox" if `s` contains a dot and no underscore, and "user" otherwise.
The function always returns exactly one of the two valid values.
"""

import sys
from pathlib import Path

# Ensure WEB-itinvent is on the path (backend lives there)
PROJECT_ROOT = Path(__file__).resolve().parents[1]
WEB_ROOT = PROJECT_ROOT / "WEB-itinvent"
if str(WEB_ROOT) not in sys.path:
    sys.path.insert(0, str(WEB_ROOT))

from hypothesis import given, settings
from hypothesis.strategies import text

from backend.services.ad_users_service import _detect_account_type


# --- Strategies ---

# sAMAccountName characters: alphanumeric, dot, underscore, hyphen (typical AD chars)
_sam_alphabet = "abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789._-"

# Strategy for arbitrary strings (including empty, unicode, special chars)
any_string = text(min_size=0, max_size=200)

# Strategy for strings that contain a dot and NO underscore -> expected "mailbox"
mailbox_names = text(
    alphabet="abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789.-",
    min_size=3,
    max_size=50,
).filter(lambda s: "." in s and "_" not in s)

# Strategy for strings that contain an underscore -> expected "user"
underscore_names = text(
    alphabet=_sam_alphabet,
    min_size=3,
    max_size=50,
).filter(lambda s: "_" in s)

# Strategy for strings with no dot and no underscore -> expected "user"
plain_names = text(
    alphabet="abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789-",
    min_size=1,
    max_size=50,
).filter(lambda s: "." not in s and "_" not in s)


# --- Property Tests ---


@settings(max_examples=100)
@given(s=any_string)
def test_account_type_always_returns_valid_value(s: str):
    """Property 1a: _detect_account_type always returns exactly one of 'mailbox' or 'user'.

    **Validates: Requirements 1.1, 1.2, 3.1, 3.2**
    """
    result = _detect_account_type(s)
    assert result in {"mailbox", "user"}, (
        f"Expected 'mailbox' or 'user', got {result!r} for input {s!r}"
    )


@settings(max_examples=100)
@given(s=mailbox_names)
def test_account_type_mailbox_when_dot_and_no_underscore(s: str):
    """Property 1b: Returns 'mailbox' when input contains a dot and no underscore.

    **Validates: Requirements 1.1, 1.2, 3.1, 3.2**
    """
    result = _detect_account_type(s)
    assert result == "mailbox", (
        f"Expected 'mailbox' for {s!r} (has dot, no underscore), got {result!r}"
    )


@settings(max_examples=100)
@given(s=underscore_names)
def test_account_type_user_when_underscore_present(s: str):
    """Property 1c: Returns 'user' when input contains an underscore (regardless of dot).

    **Validates: Requirements 1.1, 1.2, 3.1, 3.2**
    """
    result = _detect_account_type(s)
    assert result == "user", (
        f"Expected 'user' for {s!r} (has underscore), got {result!r}"
    )


@settings(max_examples=100)
@given(s=plain_names)
def test_account_type_user_when_no_dot_no_underscore(s: str):
    """Property 1d: Returns 'user' when input has neither dot nor underscore.

    **Validates: Requirements 1.1, 1.2, 3.1, 3.2**
    """
    result = _detect_account_type(s)
    assert result == "user", (
        f"Expected 'user' for {s!r} (no dot, no underscore), got {result!r}"
    )


@settings(max_examples=100)
@given(s=any_string)
def test_account_type_detection_is_deterministic(s: str):
    """Property 1e: Calling _detect_account_type twice with the same input yields the same result.

    **Validates: Requirements 1.1, 1.2, 3.1, 3.2**
    """
    result1 = _detect_account_type(s)
    result2 = _detect_account_type(s)
    assert result1 == result2, (
        f"Non-deterministic result for {s!r}: first={result1!r}, second={result2!r}"
    )


@settings(max_examples=100)
@given(s=any_string)
def test_account_type_correctness_complete(s: str):
    """Property 1f: The classification logic is correct for ALL inputs.

    If the (stripped) string contains '.' AND does NOT contain '_' -> 'mailbox'.
    Otherwise -> 'user'.

    **Validates: Requirements 1.1, 1.2, 3.1, 3.2**
    """
    result = _detect_account_type(s)
    # Replicate the expected logic based on the design spec
    name = str(s or "").strip()
    if "." in name and "_" not in name:
        expected = "mailbox"
    else:
        expected = "user"
    assert result == expected, (
        f"For input {s!r} (stripped={name!r}): expected {expected!r}, got {result!r}"
    )
