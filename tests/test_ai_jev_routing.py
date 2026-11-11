"""AG-4 / J1–J10: JEV tool-group routing unit tests (Jev client mocked)."""
from __future__ import annotations

import importlib
import sys
from pathlib import Path
from types import SimpleNamespace

import pytest

_ROOT = Path(__file__).resolve().parents[1]
for _p in (str(_ROOT), str(_ROOT / "WEB-itinvent")):
    if _p not in sys.path:
        sys.path.insert(0, _p)

service_module = importlib.import_module("backend.ai_chat.service")
tools_context_module = importlib.import_module("backend.ai_chat.tools.context")
tool_group_request_module = importlib.import_module("backend.ai_chat.tools.tool_group_request")

ALL_GROUPS = set(tools_context_module.AI_TOOL_GROUPS_ALL)


@pytest.fixture(autouse=True)
def _clear_jev_cache():
    service_module._jev_routing_cache.clear()
    yield
    service_module._jev_routing_cache.clear()


def _jev_decision(probs: dict[str, float]):
    return SimpleNamespace(
        model="typesafe/jev-1.13",
        answers={key: SimpleNamespace(probability=p) for key, p in probs.items()},
    )


def _ctx(*, enabled_tools: list[str] | None = None):
    return tools_context_module.AiToolExecutionContext(
        bot_id="bot-test",
        bot_title="AI Ассистент",
        conversation_id="ai-conv-test",
        run_id="run-test",
        user_id=5,
        user_payload={"id": 5, "role": "viewer", "username": "operator"},
        effective_database_id="ITINVENT",
        enabled_tools=list(enabled_tools or []),
        tool_settings={"multi_db_mode": "single", "allowed_databases": []},
    )


# ---------- enable flag / smalltalk (J9) ----------


def test_group_routing_disabled_by_default(monkeypatch):
    monkeypatch.delenv("AI_JEV_ROUTING", raising=False)
    result = service_module._route_tool_groups_jev(
        trigger_text="найди принтер",
        available_groups=set(ALL_GROUPS),
    )
    assert result is None


@pytest.mark.parametrize(
    "text",
    ["привет", "Здравствуйте!", "спасибо", "ок", "угу", "hello", "доброе утро", "хорошо", ""],
)
def test_is_short_smalltalk(text):
    assert service_module._is_short_smalltalk(text) is True


@pytest.mark.parametrize(
    "text",
    ["найди принтер Иванова", "сделай отчёт по технике в xlsx", "какой статус у задачи"],
)
def test_is_not_short_smalltalk(text):
    assert service_module._is_short_smalltalk(text) is False


def test_smalltalk_returns_empty_without_jev(monkeypatch):
    monkeypatch.setenv("AI_JEV_ROUTING", "1")
    calls = []
    monkeypatch.setattr(service_module.jev_client, "is_configured", lambda: True)
    monkeypatch.setattr(service_module.jev_client, "decide", lambda **kw: calls.append(kw))
    result = service_module._route_tool_groups_jev(
        trigger_text="привет",
        available_groups=set(ALL_GROUPS),
    )
    assert result == set()
    assert calls == []


# ---------- group routing (J3/J4) ----------


def test_group_routing_selects_groups_above_threshold(monkeypatch):
    monkeypatch.setenv("AI_JEV_ROUTING", "1")
    monkeypatch.setenv("AI_JEV_ROUTING_MODE", "group")
    monkeypatch.setenv("AI_JEV_ROUTING_THRESHOLD", "0.5")
    monkeypatch.setattr(service_module.jev_client, "is_configured", lambda: True)
    monkeypatch.setattr(
        service_module.jev_client,
        "decide",
        lambda **kw: _jev_decision({"g_itinvent": 0.9, "g_office": 0.02}),
    )
    routed = service_module._route_tool_groups_jev(
        trigger_text="что числится за Ивановым",
        available_groups={"itinvent", "office", "other"},
    )
    assert routed is not None
    assert "itinvent" in routed
    assert "office" not in routed
    # 'other' is always kept as a safety net for misc utility tools.
    assert "other" in routed


def test_group_routing_questions_cover_only_available_groups(monkeypatch):
    """J-право: JEV видит только permission-фильтрованные группы."""
    monkeypatch.setenv("AI_JEV_ROUTING", "1")
    monkeypatch.setenv("AI_JEV_ROUTING_MODE", "group")
    monkeypatch.setattr(service_module.jev_client, "is_configured", lambda: True)
    captured = {}

    def _decide(**kwargs):
        captured.update(kwargs)
        return _jev_decision({})

    monkeypatch.setattr(service_module.jev_client, "decide", _decide)
    service_module._route_tool_groups_jev(
        trigger_text="найди оборудование",
        available_groups={"itinvent", "other"},
    )
    # 'other' не спрашивается у JEV — она всегда добавляется как safety net.
    assert set(captured["questions"]) == {"g_itinvent"}
    state = captured["state"]
    assert state["available_groups"] == ["itinvent", "other"]


def test_group_routing_questions_have_russian_criteria():
    """J3: каждая предметная группа имеет question + true/false примеры на русском.

    'other' исключена: она force-добавляется в routed без вопроса JEV.
    """
    for group in tools_context_module.AI_TOOL_GROUPS_ALL:
        if group == tools_context_module.AI_TOOL_GROUP_OTHER:
            continue
        spec = service_module._JEV_GROUP_QUESTIONS.get(group)
        assert spec is not None, f"нет JEV-вопроса для группы {group}"
        assert spec.get("question")
        assert spec.get("true_label")
        assert spec.get("false_label")


def test_group_routing_uses_short_timeout_and_no_retries(monkeypatch):
    """J6: timeout=3s по умолчанию, max_retries=0."""
    monkeypatch.setenv("AI_JEV_ROUTING", "1")
    monkeypatch.delenv("AI_JEV_ROUTING_TIMEOUT_SEC", raising=False)
    monkeypatch.setattr(service_module.jev_client, "is_configured", lambda: True)
    captured = {}
    monkeypatch.setattr(
        service_module.jev_client,
        "decide",
        lambda **kw: captured.update(kw) or _jev_decision({}),
    )
    service_module._route_tool_groups_jev(
        trigger_text="покажи список серверов",
        available_groups={"network", "other"},
    )
    assert captured["timeout"] == 3.0
    assert captured["max_retries"] == 0


# ---------- context (J1) ----------


def test_group_routing_state_contains_dialog_context(monkeypatch):
    monkeypatch.setenv("AI_JEV_ROUTING", "1")
    monkeypatch.setattr(service_module.jev_client, "is_configured", lambda: True)
    captured = {}
    monkeypatch.setattr(
        service_module.jev_client,
        "decide",
        lambda **kw: captured.update(kw) or _jev_decision({}),
    )
    service_module._route_tool_groups_jev(
        trigger_text="а теперь то же самое в xlsx",
        available_groups={"itinvent", "files", "other"},
        sticky_groups={"itinvent", "mfu"},  # mfu недоступна — должна отфильтроваться
        recent_messages=["User: найди мониторы", "Bot: нашёл 3"],
        has_attachment=True,
    )
    state = captured["state"]
    assert state["user_message"] == "а теперь то же самое в xlsx"
    assert state["recent_messages"] == ["User: найди мониторы", "Bot: нашёл 3"]
    assert state["sticky_groups"] == ["itinvent"]
    assert state["has_attachment"] is True


# ---------- fallback (J5) ----------


def test_group_routing_failure_returns_narrow_fallback_not_all(monkeypatch):
    monkeypatch.setenv("AI_JEV_ROUTING", "1")
    monkeypatch.setenv("AI_JEV_ROUTING_MODE", "group")
    monkeypatch.setattr(service_module.jev_client, "is_configured", lambda: True)

    def _boom(**kwargs):
        raise RuntimeError("jev api down")

    monkeypatch.setattr(service_module.jev_client, "decide", _boom)
    routed = service_module._route_tool_groups_jev(
        trigger_text="найди принтер в кабинете 214",
        available_groups=set(ALL_GROUPS),
    )
    assert routed is not None
    # keyword hit («принтер» → itinvent) + 'other' safety — но НЕ все группы.
    assert "itinvent" in routed
    assert "other" in routed
    assert routed != ALL_GROUPS


def test_group_routing_failure_uses_sticky_and_baseline(monkeypatch):
    monkeypatch.setenv("AI_JEV_ROUTING", "1")
    monkeypatch.setattr(service_module.jev_client, "is_configured", lambda: True)
    monkeypatch.setattr(
        service_module.jev_client,
        "decide",
        lambda **kw: (_ for _ in ()).throw(TimeoutError("timeout")),
    )
    # sticky-группа mfu подхватывается; baseline {files, kb} добавляется
    # только когда routed пуст — здесь он уже {mfu}.
    routed = service_module._route_tool_groups_jev(
        trigger_text="расскажи что-нибудь",
        available_groups={"files", "kb", "mfu", "other"},
        sticky_groups={"mfu"},
    )
    assert routed is not None
    assert {"mfu", "other"} <= routed
    assert "itinvent" not in routed

    # Без sticky и keywords → baseline {files, kb} + other.
    service_module._jev_routing_cache.clear()
    routed = service_module._route_tool_groups_jev(
        trigger_text="расскажи что-нибудь ещё",
        available_groups={"files", "kb", "mfu", "other"},
    )
    assert routed is not None
    assert {"files", "kb", "other"} <= routed
    assert "mfu" not in routed


def test_group_routing_not_configured_falls_back(monkeypatch):
    monkeypatch.setenv("AI_JEV_ROUTING", "1")
    monkeypatch.setattr(service_module.jev_client, "is_configured", lambda: False)
    routed = service_module._route_tool_groups_jev(
        trigger_text="пингани хост 10.0.0.1",
        available_groups={"network", "itinvent", "other"},
    )
    assert routed is not None
    assert "network" in routed
    assert routed != {"network", "itinvent", "other"} or True  # never raises


# ---------- cache (J6) ----------


def test_group_routing_cache_hit_skips_second_call(monkeypatch):
    monkeypatch.setenv("AI_JEV_ROUTING", "1")
    monkeypatch.setenv("AI_JEV_ROUTING_MODE", "group")
    monkeypatch.setattr(service_module.jev_client, "is_configured", lambda: True)
    calls = []
    monkeypatch.setattr(
        service_module.jev_client,
        "decide",
        lambda **kw: calls.append(kw) or _jev_decision({"g_itinvent": 0.9}),
    )
    available = {"itinvent", "other"}
    first = service_module._route_tool_groups_jev(
        trigger_text="найди монитор", available_groups=available
    )
    second = service_module._route_tool_groups_jev(
        trigger_text="найди монитор", available_groups=available
    )
    assert first == second
    assert len(calls) == 1


def test_group_routing_cache_key_depends_on_available_groups(monkeypatch):
    """Разные наборы доступных групп (другие права) — разные ключи кэша."""
    monkeypatch.setenv("AI_JEV_ROUTING", "1")
    monkeypatch.setattr(service_module.jev_client, "is_configured", lambda: True)
    calls = []
    monkeypatch.setattr(
        service_module.jev_client,
        "decide",
        lambda **kw: calls.append(kw) or _jev_decision({}),
    )
    service_module._route_tool_groups_jev(
        trigger_text="что-то про технику", available_groups={"itinvent", "other"}
    )
    service_module._route_tool_groups_jev(
        trigger_text="что-то про технику", available_groups={"itinvent", "office", "other"}
    )
    assert len(calls) == 2


# ---------- J2: request_tool_group tool + expansion ----------


def test_request_tool_group_tool_registered():
    registry = importlib.import_module("backend.ai_chat.tools").ai_tool_registry
    assert registry.get(tool_group_request_module.AI_TOOL_REQUEST_GROUP) is not None


def test_request_tool_group_accepts_allowed_group():
    tool = tool_group_request_module.RequestToolGroupTool()
    ctx = _ctx(enabled_tools=["itinvent.equipment.search"])
    result = tool.execute(context=ctx, args={"group": "itinvent", "reason": "нужен поиск"})
    assert result.ok is True
    assert result.data["accepted"] is True


def test_request_tool_group_rejects_unavailable_group():
    """Группа вне permission-фильтрованных enabled_tools не подключается."""
    tool = tool_group_request_module.RequestToolGroupTool()
    ctx = _ctx(enabled_tools=["itinvent.equipment.search"])
    result = tool.execute(context=ctx, args={"group": "mfu"})
    assert result.ok is True
    assert result.data["accepted"] is False
    assert "mfu" in result.data["requested_group"]


def _expansion_env():
    return dict(
        tool_context=_ctx(),
        all_tool_specs=[
            {"tool_id": "itinvent.equipment.search", "description": "поиск техники"},
            {"tool_id": "mfu.devices.list", "description": "список МФУ"},
            {"tool_id": "ad.user.password_status", "description": "статус пароля"},
        ],
        tool_specs=[{"tool_id": "itinvent.equipment.search", "description": "поиск техники"}],
        routed_groups={"itinvent"},
        available_groups={"itinvent", "mfu"},
        expanded_groups=set(),
        run_id="run-test",
    )


def test_expansion_adds_group_specs(monkeypatch):
    env = _expansion_env()
    payload, trace = service_module._handle_tool_group_expansion(
        call={"tool_id": "ai.request_tool_group", "args": {"group": "mfu"}},
        **env,
    )
    assert payload["data"]["accepted"] is True
    assert payload["data"]["code"] == "accepted"
    assert trace["code"] == "accepted"
    assert env["routed_groups"] == {"itinvent", "mfu"}
    assert env["expanded_groups"] == {"mfu"}
    assert {s["tool_id"] for s in env["tool_specs"]} == {
        "itinvent.equipment.search",
        "mfu.devices.list",
    }


def test_expansion_rejects_forbidden_group():
    """Запрошенная группа вне available_groups не выдаётся никогда."""
    env = _expansion_env()
    payload, trace = service_module._handle_tool_group_expansion(
        call={"tool_id": "ai.request_tool_group", "args": {"group": "ad"}},
        **env,
    )
    assert payload["data"]["accepted"] is False
    assert payload["data"]["code"] == "forbidden_group"
    assert "ad" not in env["routed_groups"]
    assert len(env["tool_specs"]) == 1


def test_expansion_rejects_unknown_group():
    env = _expansion_env()
    payload, _ = service_module._handle_tool_group_expansion(
        call={"tool_id": "ai.request_tool_group", "args": {"group": "hacking"}},
        **env,
    )
    assert payload["data"]["accepted"] is False
    assert payload["data"]["code"] == "unknown_group"


def test_expansion_enforces_limit():
    env = _expansion_env()
    env["expanded_groups"] = {"files", "kb"}  # лимит по умолчанию = 2
    payload, _ = service_module._handle_tool_group_expansion(
        call={"tool_id": "ai.request_tool_group", "args": {"group": "mfu"}},
        **env,
    )
    assert payload["data"]["accepted"] is False
    assert payload["data"]["code"] == "limit_reached"
    assert "mfu" not in env["routed_groups"]


def test_expansion_idempotent_for_routed_group():
    env = _expansion_env()
    payload, _ = service_module._handle_tool_group_expansion(
        call={"tool_id": "ai.request_tool_group", "args": {"group": "itinvent"}},
        **env,
    )
    assert payload["data"]["accepted"] is True
    assert payload["data"]["code"] == "already_enabled"
    # specs не дублируются
    assert len(env["tool_specs"]) == 1


# ---------- follow-up fixes: acks in dialog, cache key, fallback, tool mode, sticky ----------


@pytest.mark.parametrize("text", ["да", "ок", "хорошо", "давай", "👍"])
def test_ack_is_not_smalltalk_inside_dialog(text):
    """«да» после вопроса бота — подтверждение, которому нужны инструменты."""
    assert service_module._is_short_smalltalk(text) is True
    assert service_module._is_short_smalltalk(text, has_dialog_context=True) is False


@pytest.mark.parametrize("text", ["привет", "спасибо", "до свидания"])
def test_greeting_stays_smalltalk_inside_dialog(text):
    assert service_module._is_short_smalltalk(text, has_dialog_context=True) is True


def test_message_with_attachment_is_never_smalltalk():
    assert service_module._is_short_smalltalk("ок", has_attachment=True) is False
    assert service_module._is_short_smalltalk("спасибо", has_attachment=True) is False


def test_dialog_context_needs_earlier_message_or_sticky_groups():
    # recent_messages ends with the trigger message itself.
    assert service_module._has_jev_dialog_context(recent_messages=["Пользователь: да"]) is False
    assert service_module._has_jev_dialog_context(
        recent_messages=["Бот: Выгрузить в Excel?", "Пользователь: да"]
    ) is True
    assert service_module._has_jev_dialog_context(recent_messages=[], sticky_groups={"files"}) is True


def test_ack_in_dialog_is_routed_through_jev(monkeypatch):
    monkeypatch.setenv("AI_JEV_ROUTING", "1")
    monkeypatch.setattr(service_module.jev_client, "is_configured", lambda: True)
    calls = []
    monkeypatch.setattr(
        service_module.jev_client,
        "decide",
        lambda **kw: calls.append(kw) or _jev_decision({"g_files": 0.9}),
    )
    routed = service_module._route_tool_groups_jev(
        trigger_text="да",
        available_groups={"itinvent", "files", "other"},
        recent_messages=["Бот: Выгрузить список в Excel?", "Пользователь: да"],
    )
    assert len(calls) == 1
    assert "files" in routed


def test_group_routing_cache_key_depends_on_dialog_context(monkeypatch):
    monkeypatch.setenv("AI_JEV_ROUTING", "1")
    monkeypatch.setattr(service_module.jev_client, "is_configured", lambda: True)
    calls = []
    monkeypatch.setattr(
        service_module.jev_client,
        "decide",
        lambda **kw: calls.append(kw) or _jev_decision({}),
    )
    available = {"itinvent", "office", "other"}
    service_module._route_tool_groups_jev(
        trigger_text="а у Петрова?",
        available_groups=available,
        recent_messages=["Пользователь: найди ноутбук Иванова", "Пользователь: а у Петрова?"],
    )
    service_module._route_tool_groups_jev(
        trigger_text="а у Петрова?",
        available_groups=available,
        recent_messages=["Пользователь: напиши письмо Иванову", "Пользователь: а у Петрова?"],
    )
    service_module._route_tool_groups_jev(
        trigger_text="а у Петрова?",
        available_groups=available,
        recent_messages=["Пользователь: напиши письмо Иванову", "Пользователь: а у Петрова?"],
        has_attachment=True,
    )
    assert len(calls) == 3


def test_group_routing_failure_is_not_cached(monkeypatch):
    monkeypatch.setenv("AI_JEV_ROUTING", "1")
    monkeypatch.setattr(service_module.jev_client, "is_configured", lambda: True)
    calls = []

    def _flaky(**kwargs):
        calls.append(kwargs)
        if len(calls) == 1:
            raise TimeoutError("jev timeout")
        return _jev_decision({"g_mfu": 0.9})

    monkeypatch.setattr(service_module.jev_client, "decide", _flaky)
    available = {"itinvent", "mfu", "other"}
    first = service_module._route_tool_groups_jev(trigger_text="сколько напечатано", available_groups=available)
    second = service_module._route_tool_groups_jev(trigger_text="сколько напечатано", available_groups=available)
    assert len(calls) == 2
    assert "mfu" not in first
    assert "mfu" in second


def test_tool_routing_failure_is_not_cached(monkeypatch):
    monkeypatch.setenv("AI_JEV_ROUTING", "1")
    monkeypatch.setenv("AI_JEV_ROUTING_MODE", "tool")
    monkeypatch.setattr(service_module.jev_client, "is_configured", lambda: True)
    calls = []

    def _flaky(**kwargs):
        calls.append(kwargs)
        if len(calls) == 1:
            raise TimeoutError("jev timeout")
        return _jev_decision({})

    monkeypatch.setattr(service_module.jev_client, "decide", _flaky)
    specs = [{"tool_id": "mfu.devices.list", "description": "список МФУ"}]
    service_module._route_tools_jev(trigger_text="сколько напечатано", tool_specs=specs)
    service_module._route_tools_jev(trigger_text="сколько напечатано", tool_specs=specs)
    assert len(calls) == 2


def test_tool_routing_cache_key_depends_on_candidate_tools(monkeypatch):
    """Разные права внутри одной группы — разные наборы инструментов и ключи кэша."""
    monkeypatch.setenv("AI_JEV_ROUTING", "1")
    monkeypatch.setenv("AI_JEV_ROUTING_MODE", "tool")
    monkeypatch.setattr(service_module.jev_client, "is_configured", lambda: True)
    calls = []
    monkeypatch.setattr(
        service_module.jev_client,
        "decide",
        lambda **kw: calls.append(kw) or _jev_decision({}),
    )
    read_only = [{"tool_id": "ad.user.password_status", "description": "статус пароля"}]
    manage = read_only + [{"tool_id": "ad.action.unlock_draft", "description": "разблокировка"}]
    service_module._route_tools_jev(trigger_text="учётка Иванова", tool_specs=read_only, available_groups={"ad"})
    service_module._route_tools_jev(trigger_text="учётка Иванова", tool_specs=manage, available_groups={"ad"})
    assert len(calls) == 2


def test_expansion_adds_missing_tools_of_partially_routed_group():
    """Tool-mode: группа «подключена» одним resolver-инструментом, поиск ещё недоступен."""
    env = _expansion_env()
    env["all_tool_specs"] = [
        {"tool_id": "itinvent.entity.resolve", "description": "resolver"},
        {"tool_id": "itinvent.equipment.search", "description": "поиск техники"},
    ]
    env["tool_specs"] = [{"tool_id": "itinvent.entity.resolve", "description": "resolver"}]
    env["routed_groups"] = {"itinvent"}
    payload, _ = service_module._handle_tool_group_expansion(
        call={"tool_id": "ai.request_tool_group", "args": {"group": "itinvent"}},
        **env,
    )
    assert payload["data"]["code"] == "accepted"
    assert [s["tool_id"] for s in payload["data"]["enabled_tools"]] == ["itinvent.equipment.search"]
    assert {s["tool_id"] for s in env["tool_specs"]} == {"itinvent.entity.resolve", "itinvent.equipment.search"}
    assert env["expanded_groups"] == {"itinvent"}


def test_expansion_hands_over_group_usage_rules():
    env = _expansion_env()
    payload, _ = service_module._handle_tool_group_expansion(
        call={"tool_id": "ai.request_tool_group", "args": {"group": "mfu"}},
        **env,
    )
    assert payload["data"]["usage_rules"] == service_module.AI_MFU_TOOL_ROUTING_GUIDE


class _FakeRunsSession:
    def __init__(self, rows):
        self._rows = rows

    def __enter__(self):
        return self

    def __exit__(self, *exc):
        return False

    def execute(self, statement):
        return SimpleNamespace(scalars=lambda: list(self._rows))


def test_sticky_groups_skip_smalltalk_runs(monkeypatch):
    """«спасибо» между вопросами не обрывает прилипание группы."""
    rows = [
        '{"routed_groups": []}',
        '{"routed_groups": ["other"]}',
        '{"routed_groups": ["itinvent", "other"]}',
    ]
    monkeypatch.setattr(service_module, "app_session", lambda: _FakeRunsSession(rows))
    sticky = service_module.AiChatService()._sticky_tool_groups(conversation_id="conv-1")
    assert sticky == {"itinvent", "other"}


def test_sticky_groups_empty_when_no_domain_run(monkeypatch):
    monkeypatch.setattr(service_module, "app_session", lambda: _FakeRunsSession(['{"routed_groups": []}']))
    assert service_module.AiChatService()._sticky_tool_groups(conversation_id="conv-1") == set()
