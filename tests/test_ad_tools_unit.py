"""Unit tests for new AD tools (Task 2.4).

Tests cover:
- Tool registration for all new AD tool IDs
- admin_only attribute correctness (unlock_draft=True, others=False)
- LDAP filter construction for known inputs
- Confirmation card structure for unlock draft

Requirements: 1.5, 2.1, 8.2, 8.3, 8.5, 9.1
"""
from __future__ import annotations

import sys
from datetime import datetime, timezone, timedelta
from pathlib import Path
from unittest.mock import patch, MagicMock

import pytest

PROJECT_ROOT = Path(__file__).resolve().parents[1]
WEB_ROOT = PROJECT_ROOT / "WEB-itinvent"

if str(WEB_ROOT) not in sys.path:
    sys.path.insert(0, str(WEB_ROOT))


from backend.ai_chat.tools.registry import ai_tool_registry
from backend.ai_chat.tools.context import (
    AD_TOOL_MAILBOX_PASSWORD_STATUS,
    AD_TOOL_MAILBOXES_EXPIRING_SOON,
    AD_TOOL_USER_LOCKOUT_STATUS,
    AD_TOOL_ACTION_UNLOCK_DRAFT,
    AD_TOOL_USER_GROUPS,
    AD_TOOL_USER_LOGON_HISTORY,
    AiToolExecutionContext,
)
from backend.ai_chat.tools.ad import (
    AdMailboxPasswordStatusTool,
    AdMailboxesExpiringSoonTool,
    AdUserLockoutStatusTool,
    AdUnlockDraftTool,
    AdUserGroupsTool,
    AdUserLogonHistoryTool,
)


# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------

def _make_context(*, enabled_tools: list[str] | None = None, is_admin: bool = False) -> AiToolExecutionContext:
    """Create a minimal AiToolExecutionContext for testing."""
    all_tool_ids = [
        AD_TOOL_MAILBOX_PASSWORD_STATUS,
        AD_TOOL_MAILBOXES_EXPIRING_SOON,
        AD_TOOL_USER_LOCKOUT_STATUS,
        AD_TOOL_ACTION_UNLOCK_DRAFT,
        AD_TOOL_USER_GROUPS,
        AD_TOOL_USER_LOGON_HISTORY,
    ]
    return AiToolExecutionContext(
        bot_id="test-bot",
        bot_title="Test Bot",
        conversation_id="conv-123",
        run_id="run-456",
        user_id=1,
        user_payload={"id": 1, "role": "admin" if is_admin else "viewer"},
        effective_database_id="test-db",
        enabled_tools=enabled_tools or all_tool_ids,
        tool_settings={},
    )


# ---------------------------------------------------------------------------
# 1. Tool Registration Tests
# ---------------------------------------------------------------------------

class TestToolRegistration:
    """Verify all new AD tool IDs are registered in ai_tool_registry."""

    @pytest.mark.parametrize("tool_id", [
        AD_TOOL_MAILBOX_PASSWORD_STATUS,
        AD_TOOL_MAILBOXES_EXPIRING_SOON,
        AD_TOOL_USER_LOCKOUT_STATUS,
        AD_TOOL_ACTION_UNLOCK_DRAFT,
        AD_TOOL_USER_GROUPS,
        AD_TOOL_USER_LOGON_HISTORY,
    ])
    def test_tool_is_registered(self, tool_id: str):
        """Each new AD tool ID should be resolvable from the global registry."""
        tool = ai_tool_registry.get(tool_id)
        assert tool is not None, f"Tool '{tool_id}' not found in registry"
        assert tool.tool_id == tool_id

    @pytest.mark.parametrize("tool_id,expected_class", [
        (AD_TOOL_MAILBOX_PASSWORD_STATUS, AdMailboxPasswordStatusTool),
        (AD_TOOL_MAILBOXES_EXPIRING_SOON, AdMailboxesExpiringSoonTool),
        (AD_TOOL_USER_LOCKOUT_STATUS, AdUserLockoutStatusTool),
        (AD_TOOL_ACTION_UNLOCK_DRAFT, AdUnlockDraftTool),
        (AD_TOOL_USER_GROUPS, AdUserGroupsTool),
        (AD_TOOL_USER_LOGON_HISTORY, AdUserLogonHistoryTool),
    ])
    def test_tool_class_type(self, tool_id: str, expected_class: type):
        """Each tool ID should map to the correct tool class."""
        tool = ai_tool_registry.get(tool_id)
        assert isinstance(tool, expected_class)


# ---------------------------------------------------------------------------
# 2. admin_only Attribute Tests
# ---------------------------------------------------------------------------

class TestAdminOnlyAttribute:
    """Verify admin_only is True only for unlock_draft, False for all others."""

    @pytest.mark.parametrize("tool_id", [
        AD_TOOL_MAILBOX_PASSWORD_STATUS,
        AD_TOOL_MAILBOXES_EXPIRING_SOON,
        AD_TOOL_USER_LOCKOUT_STATUS,
        AD_TOOL_USER_GROUPS,
        AD_TOOL_USER_LOGON_HISTORY,
    ])
    def test_non_admin_tools(self, tool_id: str):
        """Read-only AD tools should not require admin access."""
        tool = ai_tool_registry.get(tool_id)
        assert tool is not None
        assert tool.admin_only is False, f"Tool '{tool_id}' should have admin_only=False"

    def test_unlock_draft_requires_admin(self):
        """The unlock draft tool requires admin access."""
        tool = ai_tool_registry.get(AD_TOOL_ACTION_UNLOCK_DRAFT)
        assert tool is not None
        assert tool.admin_only is True


# ---------------------------------------------------------------------------
# 3. LDAP Filter Construction Tests
# ---------------------------------------------------------------------------

class TestLdapFilterConstruction:
    """Test LDAP filter construction for known inputs."""

    def test_mailbox_filter_contains_dot_requirement(self):
        """Mailbox filter must require dot in sAMAccountName."""
        from backend.services.ad_users_service import _build_mailbox_lookup_filter

        result = _build_mailbox_lookup_filter("kozlovskii")
        assert "(sAMAccountName=*.*)" in result

    def test_mailbox_filter_includes_object_class(self):
        """Mailbox filter must target person/user objects."""
        from backend.services.ad_users_service import _build_mailbox_lookup_filter

        result = _build_mailbox_lookup_filter("test")
        assert "(objectCategory=person)" in result
        assert "(objectClass=user)" in result

    def test_mailbox_filter_excludes_disabled_accounts(self):
        """Mailbox filter must exclude disabled accounts via userAccountControl."""
        from backend.services.ad_users_service import _build_mailbox_lookup_filter

        result = _build_mailbox_lookup_filter("test")
        assert "(!(userAccountControl:1.2.840.113556.1.4.803:=2))" in result

    def test_mailbox_filter_uses_anr_for_query(self):
        """Mailbox filter should use ANR (Ambiguous Name Resolution) for the query."""
        from backend.services.ad_users_service import _build_mailbox_lookup_filter

        result = _build_mailbox_lookup_filter("kozlovskii.me")
        assert "(anr=kozlovskii.me)" in result

    def test_mailbox_filter_searches_multiple_attributes(self):
        """Mailbox filter should search sAMAccountName, displayName, and mail."""
        from backend.services.ad_users_service import _build_mailbox_lookup_filter

        result = _build_mailbox_lookup_filter("test.user")
        assert "(sAMAccountName=*test.user*)" in result
        assert "(displayName=*test.user*)" in result
        assert "(mail=*test.user*)" in result

    def test_mailbox_filter_escapes_special_chars(self):
        """LDAP special characters in query should be escaped."""
        from backend.services.ad_users_service import _build_mailbox_lookup_filter

        result = _build_mailbox_lookup_filter("test(user)")
        # Parentheses should be escaped in LDAP filters
        assert "test\\28user\\29" in result

    def test_mailbox_filter_strips_whitespace(self):
        """Leading/trailing whitespace in query should be stripped."""
        from backend.services.ad_users_service import _build_mailbox_lookup_filter

        result = _build_mailbox_lookup_filter("  kozlovskii  ")
        assert "(anr=kozlovskii)" in result


# ---------------------------------------------------------------------------
# 4. Confirmation Card Structure for Unlock Draft
# ---------------------------------------------------------------------------

class TestUnlockDraftConfirmationCard:
    """Test the confirmation card structure produced by AdUnlockDraftTool."""

    def test_unlock_draft_returns_not_locked_message_when_account_unlocked(self, monkeypatch):
        """When account is not locked, tool returns informational message."""
        monkeypatch.setattr(
            "backend.ai_chat.tools.ad.get_ad_user_lockout_status",
            lambda query: {
                "status": "ok",
                "login": "kozlovskii_me",
                "display_name": "Козловский Максим",
                "is_locked": False,
                "lockout_time": None,
                "bad_password_count": 0,
            },
        )
        context = _make_context(is_admin=True)
        tool = AdUnlockDraftTool()
        result = tool.execute(context=context, args={"login": "kozlovskii_me"})

        assert result.ok is True
        assert result.data["is_locked"] is False
        assert "not locked" in result.data["message"].lower() or "No action needed" in result.data["message"]

    def test_unlock_draft_returns_error_for_not_found_account(self, monkeypatch):
        """When account is not found, tool returns error."""
        monkeypatch.setattr(
            "backend.ai_chat.tools.ad.get_ad_user_lockout_status",
            lambda query: {
                "status": "not_found",
                "login": None,
                "display_name": None,
                "is_locked": False,
            },
        )
        context = _make_context(is_admin=True)
        tool = AdUnlockDraftTool()
        result = tool.execute(context=context, args={"login": "nonexistent_user"})

        assert result.ok is False
        assert "not found" in (result.error or "").lower()

    def test_unlock_draft_creates_action_card_for_locked_account(self, monkeypatch):
        """When account is locked, tool creates a pending action card with correct structure."""
        lockout_time_str = "2026-05-15T10:00:00+00:00"

        monkeypatch.setattr(
            "backend.ai_chat.tools.ad.get_ad_user_lockout_status",
            lambda query: {
                "status": "ok",
                "login": "kozlovskii_me",
                "display_name": "Козловский Максим",
                "is_locked": True,
                "lockout_time": lockout_time_str,
                "bad_password_count": 5,
            },
        )

        fake_card = {
            "id": "card-001",
            "action_type": "ad.unlock",
            "status": "pending",
            "preview": {
                "title": "Разблокировка учётной записи AD",
                "description": "Разблокировать учётную запись Козловский Максим (kozlovskii_me)",
                "login": "kozlovskii_me",
                "display_name": "Козловский Максим",
                "lockout_time": lockout_time_str,
            },
        }
        monkeypatch.setattr(
            "backend.ai_chat.action_cards.create_pending_action",
            lambda **kwargs: fake_card,
        )

        context = _make_context(is_admin=True)
        tool = AdUnlockDraftTool()
        result = tool.execute(context=context, args={"login": "kozlovskii_me"})

        assert result.ok is True
        assert result.data["requires_confirmation"] is True
        assert result.data["action_card"] == fake_card

    def test_unlock_draft_card_preview_contains_required_fields(self, monkeypatch):
        """The confirmation card preview must contain login, display_name, and lockout_time."""
        lockout_time_str = "2026-05-15T10:00:00+00:00"

        monkeypatch.setattr(
            "backend.ai_chat.tools.ad.get_ad_user_lockout_status",
            lambda query: {
                "status": "ok",
                "login": "ivanov_aa",
                "display_name": "Иванов Алексей",
                "is_locked": True,
                "lockout_time": lockout_time_str,
                "bad_password_count": 3,
            },
        )

        captured_kwargs = {}

        def mock_create_pending_action(**kwargs):
            captured_kwargs.update(kwargs)
            return {"id": "card-002", "status": "pending"}

        monkeypatch.setattr(
            "backend.ai_chat.action_cards.create_pending_action",
            mock_create_pending_action,
        )

        context = _make_context(is_admin=True)
        tool = AdUnlockDraftTool()
        tool.execute(context=context, args={"login": "ivanov_aa"})

        # Verify the preview structure passed to create_pending_action
        assert captured_kwargs["action_type"] == "ad.unlock"
        assert captured_kwargs["conversation_id"] == "conv-123"
        assert captured_kwargs["run_id"] == "run-456"
        assert captured_kwargs["requester_user_id"] == 1

        preview = captured_kwargs["preview"]
        assert preview["login"] == "ivanov_aa"
        assert preview["display_name"] == "Иванов Алексей"
        assert preview["lockout_time"] == lockout_time_str
        assert "Разблокировка" in preview["title"]
        assert "ivanov_aa" in preview["description"]

        payload = captured_kwargs["payload"]
        assert payload["login"] == "ivanov_aa"
        assert payload["display_name"] == "Иванов Алексей"
        assert payload["lockout_time"] == lockout_time_str

    def test_unlock_draft_handles_create_action_failure(self, monkeypatch):
        """When create_pending_action raises, tool returns error gracefully."""
        monkeypatch.setattr(
            "backend.ai_chat.tools.ad.get_ad_user_lockout_status",
            lambda query: {
                "status": "ok",
                "login": "kozlovskii_me",
                "display_name": "Козловский Максим",
                "is_locked": True,
                "lockout_time": "2026-05-15T10:00:00+00:00",
                "bad_password_count": 5,
            },
        )
        monkeypatch.setattr(
            "backend.ai_chat.action_cards.create_pending_action",
            MagicMock(side_effect=RuntimeError("DB connection failed")),
        )

        context = _make_context(is_admin=True)
        tool = AdUnlockDraftTool()
        result = tool.execute(context=context, args={"login": "kozlovskii_me"})

        assert result.ok is False
        assert "Failed to create unlock action card" in (result.error or "")

    def test_unlock_draft_returns_error_on_ldap_failure(self, monkeypatch):
        """When lockout status check returns error, tool propagates it."""
        monkeypatch.setattr(
            "backend.ai_chat.tools.ad.get_ad_user_lockout_status",
            lambda query: {
                "status": "error",
                "error": "LDAP connection is not configured or bind failed.",
            },
        )

        context = _make_context(is_admin=True)
        tool = AdUnlockDraftTool()
        result = tool.execute(context=context, args={"login": "kozlovskii_me"})

        assert result.ok is False
        assert "LDAP" in (result.error or "") or "failed" in (result.error or "").lower()


# ---------------------------------------------------------------------------
# 5. Tool Input Model Validation
# ---------------------------------------------------------------------------

class TestToolInputValidation:
    """Verify Pydantic input models validate correctly."""

    def test_mailbox_password_status_requires_query(self):
        """AdMailboxPasswordStatusArgs requires a non-empty query."""
        from backend.ai_chat.tools.ad import AdMailboxPasswordStatusArgs
        from pydantic import ValidationError

        with pytest.raises(ValidationError):
            AdMailboxPasswordStatusArgs(query="")

    def test_mailbox_password_status_limit_range(self):
        """AdMailboxPasswordStatusArgs limit must be 1-10."""
        from backend.ai_chat.tools.ad import AdMailboxPasswordStatusArgs
        from pydantic import ValidationError

        # Valid
        args = AdMailboxPasswordStatusArgs(query="test", limit=5)
        assert args.limit == 5

        # Out of range
        with pytest.raises(ValidationError):
            AdMailboxPasswordStatusArgs(query="test", limit=0)
        with pytest.raises(ValidationError):
            AdMailboxPasswordStatusArgs(query="test", limit=11)

    def test_mailboxes_expiring_soon_days_threshold_range(self):
        """AdMailboxesExpiringSoonArgs days_threshold must be 1-30."""
        from backend.ai_chat.tools.ad import AdMailboxesExpiringSoonArgs
        from pydantic import ValidationError

        # Valid
        args = AdMailboxesExpiringSoonArgs(days_threshold=15)
        assert args.days_threshold == 15

        # Out of range
        with pytest.raises(ValidationError):
            AdMailboxesExpiringSoonArgs(days_threshold=0)
        with pytest.raises(ValidationError):
            AdMailboxesExpiringSoonArgs(days_threshold=31)

    def test_unlock_draft_requires_login(self):
        """AdUnlockDraftArgs requires a non-empty login."""
        from backend.ai_chat.tools.ad import AdUnlockDraftArgs
        from pydantic import ValidationError

        with pytest.raises(ValidationError):
            AdUnlockDraftArgs(login="")

    def test_user_groups_include_builtin_default(self):
        """AdUserGroupsArgs include_builtin defaults to False."""
        from backend.ai_chat.tools.ad import AdUserGroupsArgs

        args = AdUserGroupsArgs(query="test")
        assert args.include_builtin is False


# ---------------------------------------------------------------------------
# 6. Tool Prompt Spec Generation
# ---------------------------------------------------------------------------

class TestToolPromptSpec:
    """Verify tools generate correct prompt specs for LLM consumption."""

    @pytest.mark.parametrize("tool_id", [
        AD_TOOL_MAILBOX_PASSWORD_STATUS,
        AD_TOOL_MAILBOXES_EXPIRING_SOON,
        AD_TOOL_USER_LOCKOUT_STATUS,
        AD_TOOL_ACTION_UNLOCK_DRAFT,
        AD_TOOL_USER_GROUPS,
        AD_TOOL_USER_LOGON_HISTORY,
    ])
    def test_prompt_spec_has_required_fields(self, tool_id: str):
        """Each tool's prompt spec must include tool_id, description, input_schema, admin_only."""
        tool = ai_tool_registry.get(tool_id)
        assert tool is not None
        spec = tool.to_prompt_spec()

        assert spec["tool_id"] == tool_id
        assert isinstance(spec["description"], str)
        assert len(spec["description"]) > 0
        assert isinstance(spec["input_schema"], dict)
        assert isinstance(spec["admin_only"], bool)
