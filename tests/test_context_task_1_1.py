"""Unit tests for task 1.1: new tool ID constants and AiToolExecutionContext extensions."""
from __future__ import annotations

import os
import sys
from pathlib import Path

import pytest

PROJECT_ROOT = Path(__file__).resolve().parents[1]
WEB_ROOT = PROJECT_ROOT / "WEB-itinvent"

if str(WEB_ROOT) not in sys.path:
    sys.path.insert(0, str(WEB_ROOT))


class TestNewToolIdConstants:
    """Verify all new tool ID constants exist and have correct values."""

    def test_ad_tool_mailbox_password_status(self):
        from backend.ai_chat.tools.context import AD_TOOL_MAILBOX_PASSWORD_STATUS
        assert AD_TOOL_MAILBOX_PASSWORD_STATUS == "ad.mailbox.password_status"

    def test_ad_tool_mailboxes_expiring_soon(self):
        from backend.ai_chat.tools.context import AD_TOOL_MAILBOXES_EXPIRING_SOON
        assert AD_TOOL_MAILBOXES_EXPIRING_SOON == "ad.mailboxes.expiring_soon"

    def test_ad_tool_user_lockout_status(self):
        from backend.ai_chat.tools.context import AD_TOOL_USER_LOCKOUT_STATUS
        assert AD_TOOL_USER_LOCKOUT_STATUS == "ad.user.lockout_status"

    def test_ad_tool_action_unlock_draft(self):
        from backend.ai_chat.tools.context import AD_TOOL_ACTION_UNLOCK_DRAFT
        assert AD_TOOL_ACTION_UNLOCK_DRAFT == "ad.action.unlock_draft"

    def test_ad_tool_user_groups(self):
        from backend.ai_chat.tools.context import AD_TOOL_USER_GROUPS
        assert AD_TOOL_USER_GROUPS == "ad.user.groups"

    def test_ad_tool_user_logon_history(self):
        from backend.ai_chat.tools.context import AD_TOOL_USER_LOGON_HISTORY
        assert AD_TOOL_USER_LOGON_HISTORY == "ad.user.logon_history"

    def test_network_tool_host_ping(self):
        from backend.ai_chat.tools.context import NETWORK_TOOL_HOST_PING
        assert NETWORK_TOOL_HOST_PING == "network.host.ping"

    def test_network_tool_dns_lookup(self):
        from backend.ai_chat.tools.context import NETWORK_TOOL_DNS_LOOKUP
        assert NETWORK_TOOL_DNS_LOOKUP == "network.dns.lookup"

    def test_network_tool_ssl_check(self):
        from backend.ai_chat.tools.context import NETWORK_TOOL_SSL_CHECK
        assert NETWORK_TOOL_SSL_CHECK == "network.ssl.check"

    def test_network_tool_action_wol_draft(self):
        from backend.ai_chat.tools.context import NETWORK_TOOL_ACTION_WOL_DRAFT
        assert NETWORK_TOOL_ACTION_WOL_DRAFT == "network.action.wol_draft"

    def test_network_tool_host_info(self):
        from backend.ai_chat.tools.context import NETWORK_TOOL_HOST_INFO
        assert NETWORK_TOOL_HOST_INFO == "network.host.info"


class TestNewToolIdsInDefaultList:
    """Verify new tool IDs are included in DEFAULT_ITINVENT_TOOL_IDS."""

    def test_all_new_ad_tools_in_default_list(self):
        from backend.ai_chat.tools.context import (
            DEFAULT_ITINVENT_TOOL_IDS,
            AD_TOOL_MAILBOX_PASSWORD_STATUS,
            AD_TOOL_MAILBOXES_EXPIRING_SOON,
            AD_TOOL_USER_LOCKOUT_STATUS,
            AD_TOOL_ACTION_UNLOCK_DRAFT,
            AD_TOOL_USER_GROUPS,
            AD_TOOL_USER_LOGON_HISTORY,
        )
        assert AD_TOOL_MAILBOX_PASSWORD_STATUS in DEFAULT_ITINVENT_TOOL_IDS
        assert AD_TOOL_MAILBOXES_EXPIRING_SOON in DEFAULT_ITINVENT_TOOL_IDS
        assert AD_TOOL_USER_LOCKOUT_STATUS in DEFAULT_ITINVENT_TOOL_IDS
        assert AD_TOOL_ACTION_UNLOCK_DRAFT in DEFAULT_ITINVENT_TOOL_IDS
        assert AD_TOOL_USER_GROUPS in DEFAULT_ITINVENT_TOOL_IDS
        assert AD_TOOL_USER_LOGON_HISTORY in DEFAULT_ITINVENT_TOOL_IDS

    def test_all_new_network_tools_in_default_list(self):
        from backend.ai_chat.tools.context import (
            DEFAULT_ITINVENT_TOOL_IDS,
            NETWORK_TOOL_HOST_PING,
            NETWORK_TOOL_DNS_LOOKUP,
            NETWORK_TOOL_SSL_CHECK,
            NETWORK_TOOL_ACTION_WOL_DRAFT,
            NETWORK_TOOL_HOST_INFO,
        )
        assert NETWORK_TOOL_HOST_PING in DEFAULT_ITINVENT_TOOL_IDS
        assert NETWORK_TOOL_DNS_LOOKUP in DEFAULT_ITINVENT_TOOL_IDS
        assert NETWORK_TOOL_SSL_CHECK in DEFAULT_ITINVENT_TOOL_IDS
        assert NETWORK_TOOL_ACTION_WOL_DRAFT in DEFAULT_ITINVENT_TOOL_IDS
        assert NETWORK_TOOL_HOST_INFO in DEFAULT_ITINVENT_TOOL_IDS


class TestNewToolIdsGroupRouting:
    """Verify new tool IDs route to correct groups."""

    def test_new_ad_tools_route_to_ad_group(self):
        from backend.ai_chat.tools.context import (
            get_tool_group,
            AI_TOOL_GROUP_AD,
            AD_TOOL_MAILBOX_PASSWORD_STATUS,
            AD_TOOL_MAILBOXES_EXPIRING_SOON,
            AD_TOOL_USER_LOCKOUT_STATUS,
            AD_TOOL_ACTION_UNLOCK_DRAFT,
            AD_TOOL_USER_GROUPS,
            AD_TOOL_USER_LOGON_HISTORY,
        )
        for tool_id in [
            AD_TOOL_MAILBOX_PASSWORD_STATUS,
            AD_TOOL_MAILBOXES_EXPIRING_SOON,
            AD_TOOL_USER_LOCKOUT_STATUS,
            AD_TOOL_ACTION_UNLOCK_DRAFT,
            AD_TOOL_USER_GROUPS,
            AD_TOOL_USER_LOGON_HISTORY,
        ]:
            assert get_tool_group(tool_id) == AI_TOOL_GROUP_AD, f"{tool_id} should route to 'ad'"

    def test_new_network_tools_route_to_network_group(self):
        from backend.ai_chat.tools.context import (
            get_tool_group,
            AI_TOOL_GROUP_NETWORK,
            NETWORK_TOOL_HOST_PING,
            NETWORK_TOOL_DNS_LOOKUP,
            NETWORK_TOOL_SSL_CHECK,
            NETWORK_TOOL_ACTION_WOL_DRAFT,
            NETWORK_TOOL_HOST_INFO,
        )
        for tool_id in [
            NETWORK_TOOL_HOST_PING,
            NETWORK_TOOL_DNS_LOOKUP,
            NETWORK_TOOL_SSL_CHECK,
            NETWORK_TOOL_ACTION_WOL_DRAFT,
            NETWORK_TOOL_HOST_INFO,
        ]:
            assert get_tool_group(tool_id) == AI_TOOL_GROUP_NETWORK, f"{tool_id} should route to 'network'"


class TestNormalizeToolSettingsLimits:
    """Verify normalize_tool_settings handles max_tool_rounds and max_tool_calls_per_round."""

    def test_defaults_when_empty(self):
        from backend.ai_chat.tools.context import normalize_tool_settings
        result = normalize_tool_settings({})
        assert result["max_tool_rounds"] == 6
        assert result["max_tool_calls_per_round"] == 3

    def test_custom_values_within_range(self):
        from backend.ai_chat.tools.context import normalize_tool_settings
        result = normalize_tool_settings({"max_tool_rounds": 10, "max_tool_calls_per_round": 4})
        assert result["max_tool_rounds"] == 10
        assert result["max_tool_calls_per_round"] == 4

    def test_clamps_above_max(self):
        from backend.ai_chat.tools.context import normalize_tool_settings
        result = normalize_tool_settings({"max_tool_rounds": 99, "max_tool_calls_per_round": 20})
        assert result["max_tool_rounds"] == 12
        assert result["max_tool_calls_per_round"] == 5

    def test_clamps_below_min(self):
        from backend.ai_chat.tools.context import normalize_tool_settings
        result = normalize_tool_settings({"max_tool_rounds": 0, "max_tool_calls_per_round": 0})
        assert result["max_tool_rounds"] == 1
        assert result["max_tool_calls_per_round"] == 1

    def test_invalid_string_falls_to_default(self):
        from backend.ai_chat.tools.context import normalize_tool_settings
        result = normalize_tool_settings({"max_tool_rounds": "invalid", "max_tool_calls_per_round": "bad"})
        assert result["max_tool_rounds"] == 6
        assert result["max_tool_calls_per_round"] == 3

    def test_none_input_returns_defaults(self):
        from backend.ai_chat.tools.context import normalize_tool_settings
        result = normalize_tool_settings(None)
        assert result["max_tool_rounds"] == 6
        assert result["max_tool_calls_per_round"] == 3


class TestAiToolExecutionContextLimitProperties:
    """Verify max_tool_rounds and max_tool_calls_per_round properties on AiToolExecutionContext."""

    def _make_context(self, tool_settings=None):
        from backend.ai_chat.tools.context import AiToolExecutionContext
        return AiToolExecutionContext(
            bot_id="bot-test",
            bot_title="Test Bot",
            conversation_id="conv-1",
            run_id="run-1",
            user_id=1,
            user_payload={"role": "admin"},
            effective_database_id=None,
            enabled_tools=[],
            tool_settings=tool_settings or {},
        )

    def test_reads_from_tool_settings(self):
        ctx = self._make_context({"max_tool_rounds": 8, "max_tool_calls_per_round": 5})
        assert ctx.max_tool_rounds == 8
        assert ctx.max_tool_calls_per_round == 5

    def test_env_fallback_when_not_in_settings(self, monkeypatch):
        monkeypatch.setenv("AI_TOOL_ROUND_LIMIT", "10")
        monkeypatch.setenv("AI_TOOL_CALLS_PER_ROUND_LIMIT", "4")
        ctx = self._make_context({})
        assert ctx.max_tool_rounds == 10
        assert ctx.max_tool_calls_per_round == 4

    def test_default_fallback_when_no_env(self, monkeypatch):
        monkeypatch.delenv("AI_TOOL_ROUND_LIMIT", raising=False)
        monkeypatch.delenv("AI_TOOL_CALLS_PER_ROUND_LIMIT", raising=False)
        ctx = self._make_context({})
        assert ctx.max_tool_rounds == 6
        assert ctx.max_tool_calls_per_round == 3

    def test_clamps_tool_settings_values(self):
        ctx = self._make_context({"max_tool_rounds": 100, "max_tool_calls_per_round": 0})
        assert ctx.max_tool_rounds == 12
        assert ctx.max_tool_calls_per_round == 1

    def test_handles_invalid_tool_settings_values(self):
        ctx = self._make_context({"max_tool_rounds": "garbage", "max_tool_calls_per_round": None})
        # Falls back to env or default
        assert 1 <= ctx.max_tool_rounds <= 12
        assert 1 <= ctx.max_tool_calls_per_round <= 5
