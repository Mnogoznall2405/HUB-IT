from __future__ import annotations

import sys
from pathlib import Path
from unittest.mock import MagicMock, patch

import pytest

PROJECT_ROOT = Path(__file__).resolve().parents[1]
WEB_ROOT = PROJECT_ROOT / "WEB-itinvent"

if str(WEB_ROOT) not in sys.path:
    sys.path.insert(0, str(WEB_ROOT))


def _get_route_fn():
    from backend.ai_chat.service import _route_tool_groups
    return _route_tool_groups


def _get_group_fns():
    from backend.ai_chat.tools.context import (
        get_tool_group,
        get_enabled_tool_groups,
        AI_TOOL_GROUP_ITINVENT,
        AI_TOOL_GROUP_OFFICE,
        AI_TOOL_GROUP_FILES,
        AI_TOOL_GROUP_AD,
        AI_TOOL_GROUP_OTHER,
    )
    return get_tool_group, get_enabled_tool_groups, AI_TOOL_GROUP_ITINVENT, AI_TOOL_GROUP_OFFICE, AI_TOOL_GROUP_FILES, AI_TOOL_GROUP_AD, AI_TOOL_GROUP_OTHER


# A neutral phrase that does NOT match any hardcoded keyword (itinvent/office/mfu/network/ad/file).
# Used for tests that need to exercise the LLM router path.
NEUTRAL_TRIGGER = "abracadabra xyz lorem ipsum dolor"


class TestGetToolGroup:
    def test_itinvent_prefix(self):
        get_tool_group, _, ITINVENT, OFFICE, FILES, AD, OTHER = _get_group_fns()
        assert get_tool_group("itinvent.equipment.search") == ITINVENT
        assert get_tool_group("itinvent.database.current") == ITINVENT
        assert get_tool_group("itinvent.action.transfer_draft") == ITINVENT

    def test_office_prefix(self):
        get_tool_group, _, ITINVENT, OFFICE, FILES, AD, OTHER = _get_group_fns()
        assert get_tool_group("office.mail.search") == OFFICE
        assert get_tool_group("office.action.mail_send_draft") == OFFICE
        assert get_tool_group("office.tasks.get") == OFFICE

    def test_files_tools(self):
        get_tool_group, _, ITINVENT, OFFICE, FILES, AD, OTHER = _get_group_fns()
        assert get_tool_group("ai.files.create") == FILES
        assert get_tool_group("ai.files.report") == FILES

    def test_ad_prefix(self):
        get_tool_group, _, ITINVENT, OFFICE, FILES, AD, OTHER = _get_group_fns()
        assert get_tool_group("ad.user.password_status") == AD

    def test_unknown_falls_to_other(self):
        get_tool_group, _, ITINVENT, OFFICE, FILES, AD, OTHER = _get_group_fns()
        assert get_tool_group("custom.something") == OTHER
        assert get_tool_group("") == OTHER
        assert get_tool_group(None) == OTHER


class TestGetEnabledToolGroups:
    def test_mixed_tools(self):
        get_tool_group, get_enabled_tool_groups, ITINVENT, OFFICE, FILES, AD, OTHER = _get_group_fns()
        groups = get_enabled_tool_groups([
            "itinvent.equipment.search",
            "office.mail.search",
            "ai.files.create",
            "ad.user.password_status",
        ])
        assert groups == {ITINVENT, OFFICE, FILES, AD}

    def test_only_itinvent(self):
        get_tool_group, get_enabled_tool_groups, ITINVENT, OFFICE, FILES, AD, OTHER = _get_group_fns()
        groups = get_enabled_tool_groups(["itinvent.database.current", "itinvent.analytics.summary"])
        assert groups == {ITINVENT}

    def test_empty_list(self):
        get_tool_group, get_enabled_tool_groups, ITINVENT, OFFICE, FILES, AD, OTHER = _get_group_fns()
        assert get_enabled_tool_groups([]) == set()


class TestRouteToolGroups:
    def test_single_group_skips_llm_call(self):
        _route_tool_groups = _get_route_fn()
        with patch("backend.ai_chat.service.openrouter_client") as mock_client:
            result = _route_tool_groups(
                trigger_text="покажи оборудование",
                available_groups={"itinvent"},
                model="openai/gpt-4o-mini",
            )
        assert result == {"itinvent"}
        mock_client.complete_json.assert_not_called()

    def test_successful_routing_returns_subset(self):
        """LLM router is called when the trigger matches no hardcoded keyword."""
        _route_tool_groups = _get_route_fn()
        mock_payload = {"groups": ["itinvent"]}
        with patch("backend.ai_chat.service.openrouter_client") as mock_client:
            mock_client.complete_json.return_value = (mock_payload, {})
            result = _route_tool_groups(
                trigger_text=NEUTRAL_TRIGGER,
                available_groups={"itinvent", "office"},
                model="openai/gpt-4o-mini",
            )
        assert result == {"itinvent"}
        mock_client.complete_json.assert_called_once()

    def test_fallback_on_llm_exception_uses_narrow_fallback(self):
        """When LLM routing fails, the fallback is narrow (itinvent), not the full universe."""
        _route_tool_groups = _get_route_fn()
        with patch("backend.ai_chat.service.openrouter_client") as mock_client:
            mock_client.complete_json.side_effect = RuntimeError("LLM timeout")
            result = _route_tool_groups(
                trigger_text=NEUTRAL_TRIGGER,
                available_groups={"itinvent", "office"},
                model="openai/gpt-4o-mini",
            )
        # Narrow fallback prefers itinvent when available.
        assert result == {"itinvent"}

    def test_fallback_on_empty_groups_response_uses_narrow_fallback(self):
        _route_tool_groups = _get_route_fn()
        mock_payload = {"groups": []}
        with patch("backend.ai_chat.service.openrouter_client") as mock_client:
            mock_client.complete_json.return_value = (mock_payload, {})
            result = _route_tool_groups(
                trigger_text=NEUTRAL_TRIGGER,
                available_groups={"itinvent", "office"},
                model="openai/gpt-4o-mini",
            )
        assert result == {"itinvent"}

    def test_fallback_on_invalid_group_names_uses_narrow_fallback(self):
        _route_tool_groups = _get_route_fn()
        mock_payload = {"groups": ["nonexistent_group"]}
        with patch("backend.ai_chat.service.openrouter_client") as mock_client:
            mock_client.complete_json.return_value = (mock_payload, {})
            result = _route_tool_groups(
                trigger_text=NEUTRAL_TRIGGER,
                available_groups={"itinvent", "office"},
                model="openai/gpt-4o-mini",
            )
        assert result == {"itinvent"}

    def test_narrow_fallback_without_itinvent_picks_first_group(self):
        """If itinvent is not in available_groups, fallback picks a single deterministic group."""
        _route_tool_groups = _get_route_fn()
        with patch("backend.ai_chat.service.openrouter_client") as mock_client:
            mock_client.complete_json.side_effect = RuntimeError("LLM down")
            result = _route_tool_groups(
                trigger_text=NEUTRAL_TRIGGER,
                available_groups={"office", "files"},
                model="openai/gpt-4o-mini",
            )
        # Deterministic choice: sorted()[0] -> "files".
        assert result == {"files"}

    def test_multiple_groups_returned(self):
        _route_tool_groups = _get_route_fn()
        mock_payload = {"groups": ["itinvent", "files"]}
        with patch("backend.ai_chat.service.openrouter_client") as mock_client:
            mock_client.complete_json.return_value = (mock_payload, {})
            result = _route_tool_groups(
                trigger_text=NEUTRAL_TRIGGER,
                available_groups={"itinvent", "office", "files"},
                model="openai/gpt-4o-mini",
            )
        assert result == {"itinvent", "files"}

    @pytest.mark.parametrize(
        "trigger_text",
        [
            "export monitors to Excel",
            "make an inventory report",
            "create PDF for the equipment list",
        ],
    )
    def test_file_intent_forces_files_group(self, trigger_text):
        """File intent always adds files even if hardcoded itinvent keyword shortcut fires."""
        _route_tool_groups = _get_route_fn()
        mock_payload = {"groups": ["itinvent"]}
        with patch("backend.ai_chat.service.openrouter_client") as mock_client:
            mock_client.complete_json.return_value = (mock_payload, {})
            result = _route_tool_groups(
                trigger_text=trigger_text,
                available_groups={"itinvent", "files", "office"},
                model="openai/gpt-4o-mini",
            )
        assert result == {"itinvent", "files"}

    def test_trigger_text_truncated_to_500_chars(self):
        _route_tool_groups = _get_route_fn()
        long_text = NEUTRAL_TRIGGER + " " + ("x" * 1000)
        mock_payload = {"groups": ["office"]}
        with patch("backend.ai_chat.service.openrouter_client") as mock_client:
            mock_client.complete_json.return_value = (mock_payload, {})
            _route_tool_groups(
                trigger_text=long_text,
                available_groups={"itinvent", "office"},
                model="openai/gpt-4o-mini",
            )
        call_kwargs = mock_client.complete_json.call_args
        user_prompt = call_kwargs.kwargs.get("user_prompt") or call_kwargs[1].get("user_prompt") or call_kwargs[0][1]
        assert "x" * 501 not in user_prompt

    @pytest.mark.parametrize(
        "trigger_text",
        [
            "через сколько Козловскому Максиму нужно менять пароль",
            "когда истекает пароль kozlovskii.me",
            "show pwdLastSet for kozlovskii.me",
        ],
    )
    def test_ad_password_intent_forces_ad_group(self, trigger_text):
        _route_tool_groups = _get_route_fn()
        with patch("backend.ai_chat.service.openrouter_client") as mock_client:
            result = _route_tool_groups(
                trigger_text=trigger_text,
                available_groups={"itinvent", "ad", "office"},
                model="openai/gpt-4o-mini",
            )
        assert result == {"ad"}
        mock_client.complete_json.assert_not_called()

    @pytest.mark.parametrize(
        "trigger_text",
        [
            "найди монитор HP",
            "покажи серийный номер AB123",
            "за каким пк сидит Иванов",
            "где архив kozlovskii.me",
            "карточка устройства INV-5",
        ],
    )
    def test_itinvent_keyword_shortcut_skips_llm(self, trigger_text):
        """Hardcoded itinvent keywords route directly to itinvent without invoking the LLM router."""
        _route_tool_groups = _get_route_fn()
        with patch("backend.ai_chat.service.openrouter_client") as mock_client:
            result = _route_tool_groups(
                trigger_text=trigger_text,
                available_groups={"itinvent", "office", "ad"},
                model="openai/gpt-4o-mini",
            )
        assert result == {"itinvent"}
        mock_client.complete_json.assert_not_called()

    @pytest.mark.parametrize(
        "trigger_text",
        [
            "напиши письмо начальнику",
            "создай задачу на завтра",
            "покажи проекты",
            "ответь на письмо",
        ],
    )
    def test_office_keyword_shortcut_skips_llm(self, trigger_text):
        """Hardcoded office keywords route directly to office without invoking the LLM router."""
        _route_tool_groups = _get_route_fn()
        with patch("backend.ai_chat.service.openrouter_client") as mock_client:
            result = _route_tool_groups(
                trigger_text=trigger_text,
                available_groups={"itinvent", "office"},
                model="openai/gpt-4o-mini",
            )
        assert result == {"office"}
        mock_client.complete_json.assert_not_called()

    def test_office_keyword_with_file_intent_adds_files(self):
        """Hardcoded office keyword + file intent adds files to the routed set."""
        _route_tool_groups = _get_route_fn()
        with patch("backend.ai_chat.service.openrouter_client") as mock_client:
            result = _route_tool_groups(
                trigger_text="напиши письмо и приложи отчет xlsx",
                available_groups={"itinvent", "office", "files"},
                model="openai/gpt-4o-mini",
            )
        assert result == {"office", "files"}
        mock_client.complete_json.assert_not_called()
