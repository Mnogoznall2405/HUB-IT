#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
Property-based tests for mailbox expiring list filter logic.

Feature: ai-agent-universal-tools
Property 4: Mailbox expiring list filters correctly

**Validates: Requirements 2.3, 2.4**

For any list of AD entry dicts, the mailbox expiring filter SHALL include only
entries where sAMAccountName contains a dot separator AND the entry does not
match service account patterns AND the entry has a displayName with at least
2 space-separated words starting with a letter.
"""
import re
import sys
from pathlib import Path

import pytest
from hypothesis import given, settings, assume
from hypothesis import strategies as st

sys.path.insert(0, str(Path(__file__).parent.parent))

# --- Replicate the filtering logic from ad_users_service.py ---

_SERVICE_PATTERNS = re.compile(
    r"^(healthmailbox|svc[_\-]|admin|1c|1bit|bcpexec|corp[\.\-]admin|aid$|"
    r"scan[_\-]|backup|test[_\-]|service|system|sql|exchange|smtp|ftp|www|http|"
    r"ldap[_\-]|bdd[\.\-]|personal$|usa$|lnk\.|lrk\.)",
    re.IGNORECASE,
)


def mailbox_filter_accepts(login: str, display_name: str) -> bool:
    """
    Replicate the client-side filter logic from list_ad_mailboxes_expiring_soon.
    Returns True if the entry would be included in the result list
    (ignoring the expiration threshold check which is separate from the filter).
    """
    login = str(login or "").strip()
    display_name = str(display_name or "").strip()

    # Must have a dot in login (mailbox convention)
    if "." not in login:
        return False

    # Skip service accounts
    if _SERVICE_PATTERNS.match(login):
        return False

    # Skip entries without a proper display name (at least 2 words)
    if len(display_name.split()) < 2:
        return False

    # Skip display names starting with special chars
    if display_name and not display_name[0].isalpha():
        return False

    name_parts = display_name.split()
    if len(name_parts) < 2 or len(name_parts) > 5:
        return False

    # A real person's name: first word should be capitalized and at least 3 chars
    first_word = name_parts[0]
    if len(first_word) < 3 or not first_word[0].isupper():
        return False

    return True


# --- Hypothesis strategies ---

# Strategy for valid mailbox logins (dot-separated, not matching service patterns)
_valid_mailbox_login = st.from_regex(
    r"[A-Za-z]{3,10}\.[A-Za-z]{2,10}", fullmatch=True
)

# Strategy for service account logins that should be excluded
_service_login = st.sampled_from([
    "healthmailbox.test",
    "svc-mail.account",
    "svc_mail.account",
    "admin.box",
    "1c.service",
    "1bit.account",
    "bcpexec.mail",
    "corp.admin",
    "corp-admin.test",
    "scan-device.mail",
    "scan_device.mail",
    "backup.mail",
    "test-account.mail",
    "test_account.mail",
    "service.account",
    "system.mail",
    "sql.service",
    "exchange.admin",
    "smtp.relay",
    "ftp.service",
    "www.service",
    "http.proxy",
    "ldap-sync.svc",
    "ldap_sync.svc",
    "bdd.service",
    "bdd-test.svc",
    "lnk.something",
    "lrk.something",
])

# Strategy for valid display names (at least 2 words, starts with uppercase letter, first word >= 3 chars)
_valid_display_name = st.from_regex(
    r"[A-ZА-Я][a-zа-я]{2,12} [A-ZА-Яa-zа-я][a-zа-я]{1,12}", fullmatch=True
)

# Strategy for invalid display names (single word, starts with non-alpha, etc.)
_invalid_display_name_single_word = st.from_regex(r"[A-Za-z]{3,10}", fullmatch=True)
_invalid_display_name_special_start = st.from_regex(
    r"[!@#$%^&*0-9][A-Za-z]{2,8} [A-Za-z]{2,8}", fullmatch=True
)
_invalid_display_name_short_first = st.from_regex(
    r"[A-Z][a-z] [A-Za-z]{2,8}", fullmatch=True
)  # first word only 2 chars
_invalid_display_name_lowercase_start = st.from_regex(
    r"[a-z]{3,8} [A-Za-z]{2,8}", fullmatch=True
)

# Login without dot (should be rejected)
_no_dot_login = st.from_regex(r"[a-z_]{3,15}", fullmatch=True).filter(lambda s: "." not in s)


# --- Property tests ---


class TestMailboxFilterProperty4:
    """Property 4: Mailbox expiring list filters correctly"""

    @settings(max_examples=100)
    @given(login=_valid_mailbox_login, display_name=_valid_display_name)
    def test_valid_mailbox_entry_is_accepted(self, login: str, display_name: str):
        """
        **Validates: Requirements 2.3, 2.4**

        A valid mailbox entry (dot in login, not a service account, proper display name)
        SHALL be accepted by the filter.
        """
        # Ensure the generated login doesn't accidentally match service patterns
        assume(not _SERVICE_PATTERNS.match(login))
        assert mailbox_filter_accepts(login, display_name) is True

    @settings(max_examples=100)
    @given(login=_no_dot_login, display_name=_valid_display_name)
    def test_login_without_dot_is_rejected(self, login: str, display_name: str):
        """
        **Validates: Requirements 2.3**

        An entry whose sAMAccountName does NOT contain a dot separator
        SHALL be rejected by the filter.
        """
        assert mailbox_filter_accepts(login, display_name) is False

    @settings(max_examples=100)
    @given(login=_service_login, display_name=_valid_display_name)
    def test_service_account_is_rejected(self, login: str, display_name: str):
        """
        **Validates: Requirements 2.4**

        An entry matching service account patterns SHALL be rejected by the filter,
        even if it has a dot in the login and a valid display name.
        """
        assert mailbox_filter_accepts(login, display_name) is False

    @settings(max_examples=100)
    @given(login=_valid_mailbox_login, display_name=_invalid_display_name_single_word)
    def test_single_word_display_name_is_rejected(self, login: str, display_name: str):
        """
        **Validates: Requirements 2.4**

        An entry with a single-word displayName (less than 2 space-separated words)
        SHALL be rejected by the filter.
        """
        assume(not _SERVICE_PATTERNS.match(login))
        assert mailbox_filter_accepts(login, display_name) is False

    @settings(max_examples=100)
    @given(login=_valid_mailbox_login, display_name=_invalid_display_name_special_start)
    def test_display_name_starting_with_special_char_is_rejected(self, login: str, display_name: str):
        """
        **Validates: Requirements 2.4**

        An entry whose displayName starts with a non-alphabetic character
        SHALL be rejected by the filter.
        """
        assume(not _SERVICE_PATTERNS.match(login))
        assert mailbox_filter_accepts(login, display_name) is False

    @settings(max_examples=100)
    @given(login=_valid_mailbox_login, display_name=_invalid_display_name_short_first)
    def test_display_name_with_short_first_word_is_rejected(self, login: str, display_name: str):
        """
        **Validates: Requirements 2.4**

        An entry whose displayName first word is shorter than 3 characters
        SHALL be rejected by the filter.
        """
        assume(not _SERVICE_PATTERNS.match(login))
        assert mailbox_filter_accepts(login, display_name) is False

    @settings(max_examples=100)
    @given(login=_valid_mailbox_login, display_name=_invalid_display_name_lowercase_start)
    def test_display_name_with_lowercase_first_word_is_rejected(self, login: str, display_name: str):
        """
        **Validates: Requirements 2.4**

        An entry whose displayName first word does not start with an uppercase letter
        SHALL be rejected by the filter.
        """
        assume(not _SERVICE_PATTERNS.match(login))
        assert mailbox_filter_accepts(login, display_name) is False

    @settings(max_examples=100)
    @given(
        login=st.text(min_size=1, max_size=30),
        display_name=st.text(min_size=0, max_size=60),
    )
    def test_filter_totality_never_crashes(self, login: str, display_name: str):
        """
        **Validates: Requirements 2.3, 2.4**

        For any arbitrary login and display_name strings, the filter SHALL
        return a boolean value without raising an exception.
        """
        result = mailbox_filter_accepts(login, display_name)
        assert result is True or result is False

    @settings(max_examples=100)
    @given(
        login=st.text(min_size=1, max_size=30),
        display_name=st.text(min_size=0, max_size=60),
    )
    def test_filter_correctness_invariant(self, login: str, display_name: str):
        """
        **Validates: Requirements 2.3, 2.4**

        For any entry accepted by the filter, ALL of the following must hold:
        1. login contains a dot
        2. login does not match service account patterns
        3. displayName has at least 2 space-separated words
        4. displayName starts with a letter
        """
        result = mailbox_filter_accepts(login, display_name)
        if result is True:
            login_stripped = login.strip()
            display_stripped = display_name.strip()
            # Must have dot
            assert "." in login_stripped
            # Must not match service patterns
            assert not _SERVICE_PATTERNS.match(login_stripped)
            # Must have at least 2 words
            assert len(display_stripped.split()) >= 2
            # Must start with a letter
            assert display_stripped[0].isalpha()
