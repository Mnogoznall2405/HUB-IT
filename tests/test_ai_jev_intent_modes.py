"""A5: JEV intent modes (CHAT/READ/ACT), per-run tool ceiling, suppression
of keyword/other safety-nets and request_tool_group under a confident CHAT.
"""
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
registry_module = importlib.import_module("backend.ai_chat.tools.registry")

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


def _enable_jev(monkeypatch, decide):
    monkeypatch.setenv("AI_JEV_ROUTING", "1")
    monkeypatch.setenv("AI_JEV_ROUTING_MODE", "group")
    monkeypatch.setattr(service_module.jev_client, "is_configured", lambda: True)
    monkeypatch.setattr(service_module.jev_client, "decide", decide)


def _ctx(*, enabled_tools, run_allowed_tools=None):
    ctx = tools_context_module.AiToolExecutionContext(
        bot_id="bot-test",
        bot_title="AI",
        conversation_id="conv",
        run_id="run",
        user_id=5,
        user_payload={"id": 5, "role": "viewer", "username": "operator"},
        effective_database_id="ITINVENT",
        enabled_tools=list(enabled_tools),
        tool_settings={"multi_db_mode": "single", "allowed_databases": []},
    )
    ctx.run_allowed_tools = run_allowed_tools
    return ctx


# ---------- mode derivation in _route_tool_groups_jev ----------


def test_mode_chat_drops_routed_and_other(monkeypatch):
    """Confident CHAT: every routed group incl. 'other' safety-net is dropped."""
    _enable_jev(monkeypatch, lambda **kw: _jev_decision(
        {"g_itinvent": 0.9, "g_office": 0.7, "m_mode_chat": 0.95, "m_mode_act": 0.05}))
    result = service_module._route_tool_groups_jev(
        trigger_text="расскажи, какие бывают принтеры",
        available_groups={"itinvent", "office", "other"},
    )
    assert result == set()
    assert result.intent_mode == "chat"


def test_mode_act_has_precedence_over_chat(monkeypatch):
    _enable_jev(monkeypatch, lambda **kw: _jev_decision(
        {"g_office": 0.9, "m_mode_chat": 0.9, "m_mode_act": 0.9}))
    result = service_module._route_tool_groups_jev(
        trigger_text="напиши Ивану в чат",
        available_groups={"office", "chat", "other"},
    )
    assert result.intent_mode == "act"
    assert "office" in result  # act keeps routed groups
    assert "other" in result


def test_mode_read_when_tools_routed_without_act_or_chat(monkeypatch):
    _enable_jev(monkeypatch, lambda **kw: _jev_decision(
        {"g_itinvent": 0.9, "m_mode_chat": 0.1, "m_mode_act": 0.1}))
    result = service_module._route_tool_groups_jev(
        trigger_text="найди компьютер Иванова",
        available_groups={"itinvent", "files", "other"},
    )
    assert result.intent_mode == "read"
    assert "itinvent" in result


def test_mode_none_when_undecided_and_nothing_routed(monkeypatch):
    """No confident label + nothing routed -> undecided keeps the legacy
    request_tool_group recovery path (fail-safe, not silently stranded)."""
    _enable_jev(monkeypatch, lambda **kw: _jev_decision(
        {"m_mode_chat": 0.3, "m_mode_act": 0.3}))
    result = service_module._route_tool_groups_jev(
        trigger_text="хм, не знаю",
        available_groups={"itinvent", "other"},
    )
    assert result.intent_mode is None
    assert "other" in result  # safety net survives indecision


def test_mode_questions_ride_the_same_decide_call(monkeypatch):
    captured = {}
    _enable_jev(monkeypatch, lambda **kw: captured.update(kw) or _jev_decision({}))
    service_module._route_tool_groups_jev(
        trigger_text="что-то", available_groups={"itinvent", "other"})
    assert {"m_mode_chat", "m_mode_act"} <= set(captured["questions"])
    assert len(captured) > 0  # single decide() call, no extra round trip


def test_mode_cached_with_groups(monkeypatch):
    calls = []
    _enable_jev(monkeypatch, lambda **kw: calls.append(kw) or _jev_decision(
        {"g_itinvent": 0.9, "m_mode_act": 0.9}))
    kwargs = dict(trigger_text="подготовь перемещение", available_groups={"itinvent", "other"})
    first = service_module._route_tool_groups_jev(**kwargs)
    second = service_module._route_tool_groups_jev(**kwargs)
    assert len(calls) == 1
    assert second.intent_mode == "act" == first.intent_mode


def test_jev_failure_returns_fallback_with_none_mode(monkeypatch):
    def _boom(**kw):
        raise TimeoutError("jev down")
    _enable_jev(monkeypatch, _boom)
    result = service_module._route_tool_groups_jev(
        trigger_text="найди принтер", available_groups={"itinvent", "files", "other"})
    assert "itinvent" in result  # keyword fallback still works
    assert result.intent_mode is None  # undecided -> legacy ceiling


def test_smalltalk_mode_is_chat_without_jev(monkeypatch):
    calls = []
    _enable_jev(monkeypatch, lambda **kw: calls.append(kw) or _jev_decision({}))
    result = service_module._route_tool_groups_jev(
        trigger_text="привет", available_groups=set(ALL_GROUPS))
    assert result == set()
    assert result.intent_mode == "chat"
    assert calls == []


# ---------- _route_for_run: keyword suppression + ceilings ----------


def _route_env(monkeypatch, probs):
    _enable_jev(monkeypatch, lambda **kw: _jev_decision(probs))
    monkeypatch.setattr(service_module.AiChatService, "_sticky_tool_groups", lambda self, **kw: set())
    return service_module.AiChatService.__new__(service_module.AiChatService)


def test_route_for_run_chat_suppresses_keyword_groups(monkeypatch):
    """§4.1: 'расскажи, какие бывают принтеры' — keyword 'принтер' must not
    turn a confident CHAT into a corporate ITinvent search."""
    svc = _route_env(monkeypatch, {"g_itinvent": 0.8, "m_mode_chat": 0.95, "m_mode_act": 0.05})
    routing = svc._route_for_run(
        trigger_text="расскажи, какие бывают принтеры",
        all_tool_specs=[],
        available_groups={"itinvent", "files", "other"},
        conversation_id="conv",
        recent_messages=[],
        has_attachment=False,
        run_id="run",
    )
    assert routing["intent_mode"] == "chat"
    assert routing["routed_groups"] == set()
    assert routing["keyword_groups"] == set()


def test_route_for_run_read_keeps_keyword_groups(monkeypatch):
    """A real data request keeps the keyword safety-net."""
    svc = _route_env(monkeypatch, {"m_mode_chat": 0.05, "m_mode_act": 0.05})
    routing = svc._route_for_run(
        trigger_text="проверь наш принтер",
        all_tool_specs=[],
        available_groups={"itinvent", "mfu", "other"},
        conversation_id="conv",
        recent_messages=[],
        has_attachment=False,
        run_id="run",
    )
    assert routing["routed_groups"] - {"other"}  # keyword/fallback routed a domain group
    assert routing["intent_mode"] in ("read", None)


def test_route_for_run_undecided_keeps_legacy_groups(monkeypatch):
    svc = _route_env(monkeypatch, {"m_mode_chat": 0.2, "m_mode_act": 0.2})
    routing = svc._route_for_run(
        trigger_text="проверь наш принтер",
        all_tool_specs=[],
        available_groups={"itinvent", "other"},
        conversation_id="conv", recent_messages=[], has_attachment=False, run_id="run",
    )
    assert routing["intent_mode"] in ("read", None)
    assert routing["routed_groups"]  # not empty


# ---------- execute_bounded per-run ceiling ----------


def test_execute_bounded_denies_tool_in_chat_mode(monkeypatch):
    registry = registry_module.AiToolRegistry.__new__(registry_module.AiToolRegistry)
    registry._tools = {}
    ctx = _ctx(enabled_tools=["itinvent.equipment.search"], run_allowed_tools=frozenset())
    result, _audit = registry.execute_bounded(
        tool_id="itinvent.equipment.search", raw_args={}, context=ctx)
    assert result.ok is False
    assert "режим" in (result.error or "") or "mode" in (result.error or "").lower() or result.error
    assert ctx.mode_denied_calls == 1


def test_execute_bounded_denies_action_tool_in_read_mode(monkeypatch):
    registry = registry_module.AiToolRegistry.__new__(registry_module.AiToolRegistry)
    registry._tools = {}
    read_ceiling = frozenset(
        t for t in ["itinvent.equipment.search", "office.action.mail_send_draft"]
        if ".action." not in t
    )
    ctx = _ctx(enabled_tools=list(read_ceiling) + ["office.action.mail_send_draft"],
               run_allowed_tools=read_ceiling)
    result, _audit = registry.execute_bounded(
        tool_id="office.action.mail_send_draft", raw_args={}, context=ctx)
    assert result.ok is False
    assert ctx.mode_denied_calls == 1


def test_execute_bounded_none_ceiling_keeps_legacy_path(monkeypatch):
    """run_allowed_tools=None -> denial check is skipped entirely (legacy)."""
    registry = registry_module.AiToolRegistry.__new__(registry_module.AiToolRegistry)
    registry._tools = {}
    ctx = _ctx(enabled_tools=["itinvent.equipment.search"], run_allowed_tools=None)
    # Not a mode denial — falls through to the normal unknown-tool path.
    with pytest.raises(Exception):
        registry.execute_bounded(
            tool_id="itinvent.equipment.search", raw_args={}, context=ctx)
    assert ctx.mode_denied_calls == 0


# ---------- group expansion under run ceiling ----------


def _expansion_env(run_allowed_tools):
    ctx = _ctx(enabled_tools=[], run_allowed_tools=run_allowed_tools)
    return dict(
        tool_context=ctx,
        all_tool_specs=[
            {"tool_id": "itinvent.equipment.search", "description": "поиск техники"},
            {"tool_id": "office.action.mail_send_draft", "description": "черновик письма"},
        ],
        tool_specs=[{"tool_id": "itinvent.equipment.search", "description": "поиск техники"}],
        routed_groups={"itinvent"},
        available_groups={"itinvent", "office"},
        expanded_groups=set(),
        run_id="run-test",
    )


def test_expansion_denied_in_chat_mode():
    env = _expansion_env(frozenset())
    payload, _ = service_module._handle_tool_group_expansion(
        call={"tool_id": "ai.request_tool_group", "args": {"group": "office"}},
        **env,
    )
    assert payload["data"]["accepted"] is False
    assert payload["data"]["code"] == "mode_denied"
    assert env["routed_groups"] == {"itinvent"}


def test_expansion_filters_action_specs_in_read_mode():
    read_ceiling = frozenset({"itinvent.equipment.search"})
    env = _expansion_env(read_ceiling)
    payload, _ = service_module._handle_tool_group_expansion(
        call={"tool_id": "ai.request_tool_group", "args": {"group": "office"}},
        **env,
    )
    # The only office spec is an action tool -> honest "nothing usable".
    assert payload["data"]["accepted"] is False
    assert payload["data"]["code"] == "no_allowed_specs"
    assert "office.action.mail_send_draft" not in {
        s["tool_id"] for s in env["tool_specs"]}


# ---------- scenario matrix (plumbing, fake JEV) ----------

# (trigger, jev_answers, expected_mode, routed_must_contain, routed_must_lack)
_SCENARIOS = [
    # CHAT — conversation, explanations, text generation
    ("привет, как дела?", {"m_mode_chat": 0.9}, "chat", [], ["itinvent", "other"]),
    ("объясни, как работает PostgreSQL", {"m_mode_chat": 0.9}, "chat", [], ["itinvent", "office", "other"]),
    ("расскажи, какие бывают принтеры", {"m_mode_chat": 0.9}, "chat", [], ["itinvent", "mfu", "other"]),
    ("расскажи, как устроена корпоративная почта", {"m_mode_chat": 0.9}, "chat", [], ["office", "other"]),
    ("придумай поздравление коллеге", {"m_mode_chat": 0.9}, "chat", [], ["other"]),
    ("напиши пример письма с извинениями", {"m_mode_chat": 0.9}, "chat", [], ["office", "other"]),
    ("переведи текст на английский", {"m_mode_chat": 0.9}, "chat", [], ["other"]),
    ("что ты думаешь о React Native?", {"m_mode_chat": 0.9}, "chat", [], ["other"]),
    # READ — real corporate data, no actions
    ("найди компьютер Иванова", {"g_itinvent": 0.9, "m_mode_chat": 0.05, "m_mode_act": 0.05},
     "read", ["itinvent"], []),
    ("посмотри мои последние письма", {"g_office": 0.9, "m_mode_chat": 0.05, "m_mode_act": 0.05},
     "read", ["office"], []),
    ("какие задачи у меня сегодня?", {"g_office": 0.8, "m_mode_chat": 0.1, "m_mode_act": 0.1},
     "read", ["office"], []),
    ("проверь статус принтера", {"g_mfu": 0.9, "m_mode_chat": 0.05, "m_mode_act": 0.05},
     "read", ["mfu"], []),
    ("найди инструкцию по VPN в базе знаний", {"g_kb": 0.9, "m_mode_chat": 0.05, "m_mode_act": 0.05},
     "read", ["kb"], []),
    # ACT — drafts/sends/changes
    ("напиши Ивану сообщение в чат", {"g_chat": 0.9, "m_mode_act": 0.9, "m_mode_chat": 0.05},
     "act", ["chat"], []),
    ("ответь клиенту на письмо", {"g_office": 0.9, "m_mode_act": 0.9},
     "act", ["office"], []),
    ("создай задачу на завтра", {"g_office": 0.9, "m_mode_act": 0.85},
     "act", ["office"], []),
    ("подготовь перемещение оборудования", {"g_itinvent": 0.9, "m_mode_act": 0.9},
     "act", ["itinvent"], []),
    # ambiguous -> undecided keeps recovery path
    ("составь сводку по письмам", {"g_office": 0.4, "m_mode_chat": 0.4, "m_mode_act": 0.4},
     None, ["other"], []),
]


@pytest.mark.parametrize(
    "text,answers,expected_mode,must_contain,must_lack", _SCENARIOS,
    ids=[s[0][:40] for s in _SCENARIOS])
def test_intent_mode_scenarios(monkeypatch, text, answers, expected_mode, must_contain, must_lack):
    _enable_jev(monkeypatch, lambda **kw: _jev_decision(answers))
    result = service_module._route_tool_groups_jev(
        trigger_text=text, available_groups=set(ALL_GROUPS))
    assert result.intent_mode == expected_mode
    for group in must_contain:
        assert group in result
    for group in must_lack:
        assert group not in result


# ---------- P1-1: centralized tool-effect classification ----------


def test_tool_effect_audited_registry_has_no_unknowns():
    """Every one of the 100 registered tools resolves to a real effect —
    unknown is reserved for NEW tools only."""
    registry = importlib.import_module("backend.ai_chat.tools").ai_tool_registry
    ids = sorted(getattr(registry, "_tools", {}).keys())
    assert len(ids) >= 90
    unknown = [t for t in ids if tools_context_module.tool_effect(t) == "unknown"]
    assert unknown == []


@pytest.mark.parametrize("tool_id,effect", [
    ("helpdesk.request_draft", "action"),
    ("office.action.mail_send_draft", "action"),
    ("chat.action.message_send_draft", "action"),
    ("ai.files.create", "artifact"),
    ("ai.files.report", "artifact"),
    ("ai.files.convert_document", "artifact"),
    ("itinvent.equipment.export", "artifact"),
    ("kb.attachments.send", "delivery"),
    ("me.files.attach", "delivery"),
    ("ai.request_tool_group", "meta"),
    ("itinvent.equipment.search", "read"),
    ("office.mail.search", "read"),
    ("network.host.ping", "read"),
    ("kb.articles.search", "read"),
    ("me.equipment", "read"),
    ("totally.new.tool", "unknown"),
])
def test_tool_effect_classification(tool_id, effect):
    assert tools_context_module.tool_effect(tool_id) == effect


def test_read_ceiling_excludes_non_read_effects():
    """helpdesk draft, ai.files.*, deliveries and action tools are all out
    of a READ ceiling — not just '.action.' ids."""
    enabled = [
        "itinvent.equipment.search", "helpdesk.request_draft", "ai.files.create",
        "ai.files.report", "kb.attachments.send", "me.files.attach",
        "office.action.mail_send_draft", "ai.request_tool_group",
        "office.mail.search",
    ]
    ceiling = frozenset(
        t for t in enabled if tools_context_module.tool_effect(t) == "read")
    assert ceiling == {"itinvent.equipment.search", "office.mail.search"}


def test_read_denies_helpdesk_draft_and_files_create():
    registry = registry_module.AiToolRegistry.__new__(registry_module.AiToolRegistry)
    registry._tools = {}
    ceiling = frozenset({"itinvent.equipment.search", "office.mail.search"})
    ctx = _ctx(enabled_tools=["helpdesk.request_draft", "ai.files.create",
                              "itinvent.equipment.search"],
               run_allowed_tools=ceiling)
    for denied in ("helpdesk.request_draft", "ai.files.create"):
        result, _ = registry.execute_bounded(tool_id=denied, raw_args={}, context=ctx)
        assert result.ok is False, denied
    assert ctx.mode_denied_calls == 2


# ---------- P1-2: single/zero-group bots still get an intent mode ----------


def test_single_group_chat_question_gets_chat_mode(monkeypatch):
    """Bot with only the office group: «объясни деловую переписку» → CHAT,
    empty routed set — the ceiling is still enforced."""
    _enable_jev(monkeypatch, lambda **kw: _jev_decision(
        {"m_mode_chat": 0.95, "m_mode_act": 0.05}))
    result = service_module._route_tool_groups_jev(
        trigger_text="объясни, как правильно организовать деловую переписку",
        available_groups={"office"},
    )
    assert result is not None
    assert result.intent_mode == "chat"
    assert result == set()


def test_single_group_data_request_stays_routed(monkeypatch):
    _enable_jev(monkeypatch, lambda **kw: _jev_decision(
        {"g_office": 0.9, "m_mode_chat": 0.05, "m_mode_act": 0.05}))
    result = service_module._route_tool_groups_jev(
        trigger_text="покажи мои последние письма",
        available_groups={"office"},
    )
    assert result.intent_mode == "read"
    assert "office" in result


def test_zero_groups_chat_mode(monkeypatch):
    _enable_jev(monkeypatch, lambda **kw: _jev_decision({"m_mode_chat": 0.9}))
    result = service_module._route_tool_groups_jev(
        trigger_text="привет, как дела", available_groups=set())
    # Zero groups + no questions -> smalltalk/greeting path or chat decision
    assert result is not None


# ---------- P2-1: honest expansion codes ----------


def test_expansion_reports_no_allowed_specs_instead_of_already_enabled():
    env = _expansion_env(frozenset({"itinvent.equipment.search"}))
    payload, _ = service_module._handle_tool_group_expansion(
        call={"tool_id": "ai.request_tool_group", "args": {"group": "office"}},
        **env,
    )
    # office specs exist but the ceiling filtered all of them -> honest code
    assert payload["data"]["code"] == "no_allowed_specs"
    assert payload["data"]["accepted"] is False


# ---------- P1-1 cycle 3: fail-closed unknowns ----------


@pytest.mark.parametrize("tool_id", [
    "office.mail.delete",           # known prefix, unknown tool -> NOT read
    "itinvent.equipment.update",
    "directory.people.modify",
    "kb.articles.delete",
    "me.files.delete",
    "mfu.device.reset",
    "warehouse.balances.adjust",
    "office.tasks.delete",
])
def test_unknown_tool_under_known_prefix_is_not_read(tool_id):
    effect = tools_context_module.tool_effect(tool_id)
    assert effect == "unknown", f"{tool_id} -> {effect}"
    assert effect != "read"


@pytest.mark.parametrize("tool_id", [
    "network.action.reboot",        # .action. family is fail-closed as action
    "office.action.mail_delete",
])
def test_unknown_action_family_tool_is_never_read(tool_id):
    assert tools_context_module.tool_effect(tool_id) != "read"


def test_every_registered_tool_effect_is_explicit():
    """Audit per id: every registered tool is classified by an explicit rule —
    overrides, '.action.'/'_draft' suffixes, or the audited read allowlist."""
    registry = importlib.import_module("backend.ai_chat.tools").ai_tool_registry
    ids = sorted(getattr(registry, "_tools", {}).keys())
    for tid in ids:
        effect = tools_context_module.tool_effect(tid)
        assert effect != "unknown", f"unclassified registered tool: {tid}"
        if tid in tools_context_module._TOOL_READ_TOOLS:
            assert effect == "read", tid


# ---------- P2-1: tool-mode chat vs resolver tools ----------


def _tool_mode(monkeypatch, decide):
    monkeypatch.setenv("AI_JEV_ROUTING", "1")
    monkeypatch.setenv("AI_JEV_ROUTING_MODE", "tool")
    monkeypatch.setattr(service_module.jev_client, "is_configured", lambda: True)
    monkeypatch.setattr(service_module.jev_client, "decide", decide)


def test_tool_mode_empty_core_is_chat_without_resolvers(monkeypatch):
    """JEV selects nothing -> CHAT; ALWAYS_KEEP resolver tools do NOT mask it."""
    _tool_mode(monkeypatch, lambda **kw: _jev_decision({}))
    specs = [
        {"tool_id": "itinvent.equipment.search", "description": "поиск"},
        {"tool_id": "itinvent.entity.resolve", "description": "resolver"},
    ]
    result = service_module._route_tools_jev(
        trigger_text="расскажи анекдот", tool_specs=specs)
    assert result == set()
    assert getattr(result, "intent_mode", None) == "chat"


def test_tool_mode_nonempty_selection_keeps_resolvers(monkeypatch):
    _tool_mode(monkeypatch, lambda **kw: _jev_decision({"t00": 0.9}))
    specs = [
        {"tool_id": "itinvent.equipment.search", "description": "поиск"},
        {"tool_id": "itinvent.entity.resolve", "description": "resolver"},
    ]
    result = service_module._route_tools_jev(
        trigger_text="найди ноутбук Иванова", tool_specs=specs)
    assert "itinvent.equipment.search" in result
    assert "itinvent.entity.resolve" in result  # resolver kept for real work
    assert getattr(result, "intent_mode", None) is None


def test_tool_mode_jev_failure_is_not_chat(monkeypatch):
    def _boom(**kw):
        raise TimeoutError("down")
    _tool_mode(monkeypatch, _boom)
    specs = [{"tool_id": "itinvent.equipment.search", "description": "поиск"}]
    result = service_module._route_tools_jev(
        trigger_text="найди технику", tool_specs=specs)
    assert getattr(result, "intent_mode", None) != "chat"


def test_chat_mode_blocks_every_tool_call_even_without_specs():
    """§5: even if the model hallucinates a tool_id in CHAT, execution is
    refused at the registry — specs are not the only barrier."""
    registry = registry_module.AiToolRegistry.__new__(registry_module.AiToolRegistry)
    registry._tools = {}
    ctx = _ctx(
        enabled_tools=["itinvent.equipment.search", "office.action.mail_send_draft",
                       "chat.action.message_send_draft"],
        run_allowed_tools=frozenset(),
    )
    for tool_id in ctx.enabled_tools:
        result, _ = registry.execute_bounded(tool_id=tool_id, raw_args={}, context=ctx)
        assert result.ok is False, tool_id
    assert ctx.mode_denied_calls == 3
