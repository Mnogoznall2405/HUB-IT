from __future__ import annotations

import sys
from pathlib import Path

import pytest

PROJECT_ROOT = Path(__file__).resolve().parents[1]
WEB_ROOT = PROJECT_ROOT / "WEB-itinvent"

if str(WEB_ROOT) not in sys.path:
    sys.path.insert(0, str(WEB_ROOT))


def _get_routing_fns():
    from backend.ai_chat.service import (
        _build_jev_state,
        _jev_fallback_groups,
        _keyword_routed_groups,
        _route_tool_groups_jev,
    )
    return _keyword_routed_groups, _jev_fallback_groups, _route_tool_groups_jev, _build_jev_state


def _enable_jev(monkeypatch):
    import importlib

    service_module = importlib.import_module("backend.ai_chat.service")
    monkeypatch.setenv("AI_JEV_ROUTING", "1")
    monkeypatch.setenv("AI_JEV_ROUTING_MODE", "group")
    monkeypatch.setenv("AI_JEV_ROUTING_THRESHOLD", "0.5")
    service_module._jev_routing_cache.clear()
    monkeypatch.setattr(service_module.jev_client, "is_configured", lambda: True)
    return service_module


def _jev_decision(probs):
    from types import SimpleNamespace

    return SimpleNamespace(
        model="jev-test",
        answers={key: SimpleNamespace(probability=p) for key, p in probs.items()},
    )


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
    """Deterministic routing on top of the JEV contour (AG-4).

    The old ``_route_tool_groups`` (openrouter ``complete_json`` router) was
    replaced by ``_route_tool_groups_jev`` + ``_keyword_routed_groups`` +
    ``_jev_fallback_groups``. JEV-mocked scenarios live in
    ``test_ai_jev_routing.py``; here we keep the deterministic contract:
    keyword shortcuts, forced file/ad groups and the permission-safe fallback
    (never "all groups").
    """

    def test_single_group_skips_jev_call(self, monkeypatch):
        _, _, _route_tool_groups_jev, _ = _get_routing_fns()
        service_module = _enable_jev(monkeypatch)
        calls = []
        monkeypatch.setattr(service_module.jev_client, "decide", lambda **kw: calls.append(kw))
        result = _route_tool_groups_jev(
            trigger_text="покажи оборудование",
            available_groups={"itinvent"},
        )
        # None means "keep every available group" — with a single group no
        # routing decision is needed.
        assert result is None
        assert calls == []

    def test_successful_routing_returns_subset(self, monkeypatch):
        """JEV is called when the trigger matches no hardcoded keyword."""
        _, _, _route_tool_groups_jev, _ = _get_routing_fns()
        service_module = _enable_jev(monkeypatch)
        calls = []
        monkeypatch.setattr(
            service_module.jev_client,
            "decide",
            lambda **kw: calls.append(kw) or _jev_decision({"g_itinvent": 0.9, "g_office": 0.01}),
        )
        result = _route_tool_groups_jev(
            trigger_text=NEUTRAL_TRIGGER,
            available_groups={"itinvent", "office"},
        )
        assert result == {"itinvent"}
        assert len(calls) == 1

    def test_fallback_on_jev_exception_never_returns_all(self, monkeypatch):
        """When JEV routing fails, the fallback is narrow — never the full set."""
        _, _, _route_tool_groups_jev, _ = _get_routing_fns()
        service_module = _enable_jev(monkeypatch)

        def _boom(**kw):
            raise RuntimeError("JEV timeout")

        monkeypatch.setattr(service_module.jev_client, "decide", _boom)
        result = _route_tool_groups_jev(
            trigger_text=NEUTRAL_TRIGGER,
            available_groups={"itinvent", "office"},
        )
        # No keyword hit and no baseline groups (files/kb) available -> empty set
        # ("no tools needed"); crucially not the full universe.
        assert result == set()

    def test_fallback_on_all_below_threshold_is_empty(self, monkeypatch):
        """JEV refusing every group yields no tools (plus 'other' if available)."""
        _, _, _route_tool_groups_jev, _ = _get_routing_fns()
        service_module = _enable_jev(monkeypatch)
        monkeypatch.setattr(
            service_module.jev_client,
            "decide",
            lambda **kw: _jev_decision({"g_itinvent": 0.01, "g_office": 0.02}),
        )
        result = _route_tool_groups_jev(
            trigger_text=NEUTRAL_TRIGGER,
            available_groups={"itinvent", "office"},
        )
        assert result == set()

    def test_answers_for_unknown_groups_are_ignored(self, monkeypatch):
        _, _, _route_tool_groups_jev, _ = _get_routing_fns()
        service_module = _enable_jev(monkeypatch)
        monkeypatch.setattr(
            service_module.jev_client,
            "decide",
            lambda **kw: _jev_decision({"g_nonexistent_group": 0.99, "g_itinvent": 0.9}),
        )
        result = _route_tool_groups_jev(
            trigger_text=NEUTRAL_TRIGGER,
            available_groups={"itinvent", "office"},
        )
        assert result == {"itinvent"}

    def test_fallback_without_baseline_groups_picks_nothing(self):
        """If files/kb are not in available_groups, a neutral fallback is empty."""
        _, _jev_fallback_groups, _, _ = _get_routing_fns()
        result = _jev_fallback_groups(
            trigger_text=NEUTRAL_TRIGGER,
            available_groups={"office", "itinvent"},
        )
        assert result == set()

    def test_fallback_picks_baseline_files_group(self):
        """Baseline deterministic pick: files/kb when nothing else matched."""
        _, _jev_fallback_groups, _, _ = _get_routing_fns()
        result = _jev_fallback_groups(
            trigger_text=NEUTRAL_TRIGGER,
            available_groups={"office", "files"},
        )
        assert result == {"files"}

    def test_fallback_includes_sticky_and_other(self):
        _, _jev_fallback_groups, _, _ = _get_routing_fns()
        result = _jev_fallback_groups(
            trigger_text=NEUTRAL_TRIGGER,
            available_groups={"office", "itinvent", "other"},
            sticky_groups={"itinvent"},
        )
        assert result == {"itinvent", "other"}

    def test_multiple_groups_returned(self, monkeypatch):
        _, _, _route_tool_groups_jev, _ = _get_routing_fns()
        service_module = _enable_jev(monkeypatch)
        monkeypatch.setattr(
            service_module.jev_client,
            "decide",
            lambda **kw: _jev_decision({"g_itinvent": 0.9, "g_files": 0.8, "g_office": 0.1}),
        )
        result = _route_tool_groups_jev(
            trigger_text=NEUTRAL_TRIGGER,
            available_groups={"itinvent", "office", "files"},
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
        """File intent always adds files even without a domain keyword hit."""
        _keyword_routed_groups, _, _, _ = _get_routing_fns()
        result = _keyword_routed_groups(
            trigger_text,
            available_groups={"itinvent", "files", "office"},
        )
        assert result == {"files"}

    def test_trigger_text_truncated_in_jev_state(self):
        _, _, _, _build_jev_state = _get_routing_fns()
        long_text = NEUTRAL_TRIGGER + " " + ("x" * 3000)
        state = _build_jev_state(
            trigger_text=long_text,
            available_groups={"itinvent", "office"},
        )
        assert len(state["user_message"]) == 1500
        assert "x" * 1501 not in state["user_message"]

    @pytest.mark.parametrize(
        "trigger_text",
        [
            "через сколько Козловскому Максиму нужно менять пароль",
            "когда истекает пароль kozlovskii.me",
            "show pwdLastSet for kozlovskii.me",
        ],
    )
    def test_ad_password_intent_forces_ad_group(self, trigger_text):
        _keyword_routed_groups, _, _, _ = _get_routing_fns()
        result = _keyword_routed_groups(
            trigger_text,
            available_groups={"itinvent", "ad", "office"},
        )
        assert result == {"ad"}

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
    def test_itinvent_keyword_shortcut_skips_jev(self, trigger_text):
        """Hardcoded itinvent keywords route directly to itinvent."""
        _keyword_routed_groups, _, _, _ = _get_routing_fns()
        result = _keyword_routed_groups(
            trigger_text,
            available_groups={"itinvent", "office", "ad"},
        )
        assert result == {"itinvent"}

    @pytest.mark.parametrize(
        "trigger_text",
        [
            "напиши письмо начальнику",
            "создай задачу на завтра",
            "покажи проекты",
            "ответь на письмо",
        ],
    )
    def test_office_keyword_shortcut_skips_jev(self, trigger_text):
        """Hardcoded office keywords route directly to office."""
        _keyword_routed_groups, _, _, _ = _get_routing_fns()
        result = _keyword_routed_groups(
            trigger_text,
            available_groups={"itinvent", "office"},
        )
        assert result == {"office"}

    def test_office_keyword_with_file_intent_adds_files(self):
        """Hardcoded office keyword + file intent adds files to the routed set."""
        _keyword_routed_groups, _, _, _ = _get_routing_fns()
        result = _keyword_routed_groups(
            "напиши письмо и приложи отчет xlsx",
            available_groups={"itinvent", "office", "files"},
        )
        assert result == {"office", "files"}
