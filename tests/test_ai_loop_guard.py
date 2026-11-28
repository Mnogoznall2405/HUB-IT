"""A11 pipeline tests for the tool-loop dedup guard and the loop guard.

Runs the real ``AiChatService.process_next_run`` pipeline (queued run row ->
``_execute_run`` -> tool rounds) against SQLite storage. Only the LLM
transport (scripted per call, like test_ai_chat_runtime/test_e2e_ai_draft_reliability)
and the outermost tool execution boundary (``ai_tool_registry.execute``) are
replaced; dedup, mutation invalidation, loop-guard progress tracking, round
ceilings and result persistence all run through production code.

Tool ids are real registry ids chosen by their server-side effect class
(``backend.ai_chat.tools.context.tool_effect``):

- ``office.tasks.search`` — effect ``read`` (member of ``_TOOL_READ_TOOLS``);
- ``me.equipment`` — effect ``read``, different tool group (dependency-free decoy);
- ``office.action.task_create_draft`` — effect ``action`` (``.action.`` segment);
- ``ai.files.create`` — effect ``artifact`` (explicit override in context.py).

A bare repeated call list never reaches the dedup filter: the older
identical-calls early stop (service.py, ``next_tool_calls == tool_calls``)
ends the loop first. Scripts therefore repeat the target call together with
one fresh call (or repeat only one of several earlier calls) — the same shape
a real model produces when it retries one tool while doing something else.
"""
from __future__ import annotations

import json
from types import SimpleNamespace

import pytest
from sqlalchemy import select

from test_ai_chat_runtime import _configure_local_backend_runtime, _patch_ai_tool_database_catalog

from backend.ai_chat import service as ai_module
from backend.ai_chat.tools.base import AiToolResult
from backend.ai_chat.tools.context import tool_effect
from backend.appdb.db import app_session
from backend.appdb.models import AppAiBot, AppAiBotAccess, AppAiBotConversation, AppAiBotRun, AppUser
from backend.chat import service as chat_module
from backend.chat.db import chat_session
from backend.chat.models import ChatConversation, ChatMember
from backend.services import user_service as user_module
from backend.services.user_service import UserService


READ_TOOL = "office.tasks.search"
READ_DECOY = "me.equipment"
ACTION_TOOL = "office.action.task_create_draft"
ARTIFACT_TOOL = "ai.files.create"

TOOLS = [READ_TOOL, READ_DECOY, ACTION_TOOL, ARTIFACT_TOOL]
PERMISSIONS = [
    "chat.read", "chat.write", "chat.ai.use",
    "tasks.read", "tasks.create", "tasks.write",
]

# The tests pin the effect classes they rely on: a registry reclassification
# must fail loudly here instead of silently testing the wrong thing.
assert tool_effect(READ_TOOL) == "read"
assert tool_effect(READ_DECOY) == "read"
assert tool_effect(ACTION_TOOL) == "action"
assert tool_effect(ARTIFACT_TOOL) == "artifact"


def call(tool_id, **args):
    return {"tool_id": tool_id, "args": args}


def answer(text="Готово."):
    return {"answer_markdown": text}


@pytest.fixture
def agent(tmp_path, monkeypatch):
    url = _configure_local_backend_runtime(tmp_path, monkeypatch, "ai_loop_guard.db")
    _patch_ai_tool_database_catalog(monkeypatch)
    users = UserService(database_url=url)
    chat = chat_module.ChatService()
    svc = ai_module.AiChatService()
    monkeypatch.setenv("AI_JEV_ROUTING", "0")
    # Loop guard is on by default at runtime; pin it so ambient env never
    # decides which branch a test exercises. Tests 6/7/8 re-pin it themselves.
    monkeypatch.setenv("AI_LOOP_GUARD_ENABLED", "1")
    # Adjacent A10 optimizations are off by default; pin them so the dedup
    # logic under test is the only reuse/blocking layer in the loop.
    monkeypatch.setattr(ai_module, "AI_READ_FAST_PATH_ENABLED", False)
    monkeypatch.setattr(ai_module, "AI_DIRECT_READ_ENABLED", False)
    monkeypatch.setattr(ai_module, "AI_RUN_RESULT_REUSE_ENABLED", False)
    monkeypatch.setattr(ai_module, "user_service", users)
    monkeypatch.setattr(ai_module, "chat_service", chat)
    monkeypatch.setattr(ai_module, "ai_chat_service", svc)
    monkeypatch.setattr(chat_module, "user_service", users)
    monkeypatch.setattr(user_module, "user_service", users)
    monkeypatch.setattr(svc, "_enqueue_message_side_effects_after_send", lambda **kwargs: None)
    monkeypatch.setattr(svc, "_publish_status_event", lambda **kwargs: None)
    monkeypatch.setattr(svc, "_publish_response_preview", lambda **kwargs: None)
    monkeypatch.setattr(svc, "_enqueue_typing_event", lambda **kwargs: None)
    monkeypatch.setattr(ai_module.openrouter_client, "get_status", lambda: {"configured": True})
    monkeypatch.setattr(ai_module.ai_kb_retrieval_service, "ensure_index_fresh", lambda **kwargs: None)
    monkeypatch.setattr(ai_module.ai_kb_retrieval_service, "retrieve", lambda **kwargs: [])
    with app_session(url) as db:
        db.add_all([
            AppUser(id=99, username="actor", full_name="Actor", role="viewer", is_active=True,
                    use_custom_permissions=True, custom_permissions_json=json.dumps(PERMISSIONS)),
            AppUser(id=39, username="ai_test", full_name="Assistant", role="viewer", is_active=True),
            AppAiBot(id="agent", slug="corp-assistant", title="Assistant", bot_user_id=39,
                     enabled_tools_json=json.dumps(TOOLS), use_personal_memory=False,
                     tool_settings_json='{"max_tool_rounds":6,"max_tool_calls_per_round":3}'),
            AppAiBotAccess(bot_id="agent", user_id=99, allowed=True, updated_by=99),
            AppAiBotConversation(bot_id="agent", user_id=99, conversation_id="agent-conv", use_personal_memory=False),
        ])
    with chat_session() as db:
        db.add(ChatConversation(id="agent-conv", kind="ai", title="Assistant", created_by_user_id=99))
        db.flush()
        db.add_all([ChatMember(conversation_id="agent-conv", user_id=99), ChatMember(conversation_id="agent-conv", user_id=39)])

    steps: list = []
    prompts: list = []

    def complete(**kwargs):
        prompts.append(kwargs)
        assert steps, "unexpected extra LLM request"
        response = steps.pop(0)
        if isinstance(response, Exception):
            raise response
        return response, {"output_tokens": 10}

    monkeypatch.setattr(ai_module.openrouter_client, "complete_json", complete)

    executions: list = []
    state = {"handler": None}

    def fake_execute(*, tool_id, raw_args, context):
        """Execution boundary replacement: records the call, then applies the
        per-test outcome hook. ``handler(tool_id, args)`` returns None for
        success or a string — the error text of a failed execution."""
        args = dict(raw_args or {}) if isinstance(raw_args, dict) else {}
        executions.append({"tool_id": tool_id, "args": args})
        handler = state["handler"]
        error_text = handler(tool_id, args) if handler is not None else None
        if error_text:
            result = AiToolResult(tool_id=tool_id, ok=False, error=str(error_text), database_id="ITINVENT")
        else:
            result = AiToolResult(
                tool_id=tool_id,
                ok=True,
                data={"items": [{"id": 1, "title": "запись"}], "total": 1, "count": 1},
                database_id="ITINVENT",
            )
        audit_row = {
            "tool_id": tool_id,
            "database_id": "ITINVENT",
            "status": "ok" if result.ok else "error",
            "latency_ms": 1,
            "conversation_id": context.conversation_id,
            "bot_id": context.bot_id,
            "user_id": int(context.user_id or 0),
        }
        return result, audit_row

    monkeypatch.setattr(ai_module.ai_tool_registry, "execute", fake_execute)

    def request(text):
        message = chat.send_message(current_user_id=99, conversation_id="agent-conv", body=text)
        queued = svc.queue_run_for_message(
            current_user_id=99, conversation_id="agent-conv",
            trigger_message_id=message["id"], effective_database_id="ITINVENT",
        )
        assert queued is not None
        assert svc.process_next_run() is True
        with app_session(url) as db:
            runs = list(db.execute(select(AppAiBotRun).order_by(AppAiBotRun.created_at.desc())).scalars())
        assert runs, "run row must exist after processing"
        result = json.loads(runs[0].result_json or "{}")
        assert result, "run result_json must be written"
        return result

    yield SimpleNamespace(
        steps=steps, prompts=prompts, executions=executions, state=state,
        request=request, url=url, svc=svc, chat=chat,
    )


def executions_of(agent, tool_id):
    return [item for item in agent.executions if item["tool_id"] == tool_id]


def duplicate_traces(result, tool_id):
    return [
        trace for trace in result.get("tool_traces") or []
        if trace.get("tool_id") == tool_id and trace.get("error") == "duplicate_call"
    ]


def all_duplicate_traces(result):
    return [trace for trace in result.get("tool_traces") or [] if trace.get("error") == "duplicate_call"]


def test_duplicate_read_blocked(agent):
    """A successful read repeated with identical args inside one run is blocked:
    the second execution never reaches the tool, the result carries
    code='duplicate_call' and the run telemetry counts it."""
    agent.steps.extend([
        {"tool_calls": [call(READ_TOOL, status="active")]},
        # The repeat rides together with one fresh call: a bare identical call
        # list is cut by the older identical-calls stop before dedup sees it.
        {"tool_calls": [call(READ_TOOL, status="active"), call(READ_DECOY)]},
        answer(),
    ])

    result = agent.request("Проверь мои активные задачи по проектам")

    assert agent.steps == [], "every scripted LLM step must be consumed exactly"
    assert len(executions_of(agent, READ_TOOL)) == 1, (
        "the repeated read must not reach real execution a second time"
    )
    assert len(executions_of(agent, READ_DECOY)) == 1
    assert len(duplicate_traces(result, READ_TOOL)) == 1
    assert result["loop_guard"]["duplicate_calls"] == 1
    assert result["loop_guard"]["stopped"] is False
    assert result.get("answer_markdown")


@pytest.mark.parametrize("mutation_tool,mutation_args", [
    (ACTION_TOOL, {"title": "Проверить контракт", "due_at": "2026-02-01"}),
    (ARTIFACT_TOOL, {"filename": "itog.txt", "content": "сводка"}),
], ids=["action", "artifact"])
def test_read_after_mutation_allowed(agent, mutation_tool, mutation_args):
    """Mutation invalidation: after a successful action/artifact execution the
    read signatures are dropped, so the same read with the same args AFTER the
    mutation re-executes for real instead of being deduped."""
    agent.steps.extend([
        {"tool_calls": [call(READ_TOOL, status="active")]},
        {"tool_calls": [call(mutation_tool, **mutation_args)]},
        {"tool_calls": [call(READ_TOOL, status="active")]},
        answer(),
    ])

    result = agent.request("Проверь задачи, затем обнови данные и перепроверь")

    assert agent.steps == []
    assert len(executions_of(agent, mutation_tool)) == 1
    assert len(executions_of(agent, READ_TOOL)) == 2, (
        "the read before and after the mutation must both really execute"
    )
    assert all_duplicate_traces(result) == []
    assert result["loop_guard"]["duplicate_calls"] == 0


def test_double_action_blocked(agent):
    """Double-create protection: an action tool repeated with identical args is
    blocked — the draft is created at most once per run."""
    agent.steps.extend([
        {"tool_calls": [call(ACTION_TOOL, title="Позвонить заказчику")]},
        {"tool_calls": [call(ACTION_TOOL, title="Позвонить заказчику"), call(READ_DECOY)]},
        answer(),
    ])

    result = agent.request("Создай черновик задачи позвонить заказчику")

    assert agent.steps == []
    assert len(executions_of(agent, ACTION_TOOL)) == 1, (
        "the repeated action must not produce a second draft creation"
    )
    assert len(executions_of(agent, READ_DECOY)) == 1
    assert len(duplicate_traces(result, ACTION_TOOL)) == 1
    assert result["loop_guard"]["duplicate_calls"] == 1


def test_error_retry_allowed(agent):
    """Failed executions are not recorded in the dedup set: retrying the same
    read with identical args after an error reaches real execution again."""
    attempts = {"count": 0}

    def fail_first_time(tool_id, args):
        if tool_id != READ_TOOL:
            return None
        attempts["count"] += 1
        return "Временный сбой сервиса задач" if attempts["count"] == 1 else None

    agent.state["handler"] = fail_first_time
    agent.steps.extend([
        # Round 1: the read fails while an independent decoy succeeds.
        {"tool_calls": [call(READ_TOOL, status="active"), call(READ_DECOY)]},
        # Round 2: the bare retry is not identical to round 1's call list, so
        # only dedup (not the identical-calls stop) decides its fate.
        {"tool_calls": [call(READ_TOOL, status="active")]},
        answer(),
    ])

    result = agent.request("Проверь мои активные задачи по проектам")

    assert agent.steps == []
    assert len(executions_of(agent, READ_TOOL)) == 2, (
        "the retry after an error must really execute again"
    )
    assert duplicate_traces(result, READ_TOOL) == []
    assert result["loop_guard"]["duplicate_calls"] == 0


def test_pagination_args_pass(agent):
    """Dedup keys on tool+serialized args: the same tool paged with a different
    offset is a different call and is never blocked."""
    agent.steps.extend([
        {"tool_calls": [call(READ_TOOL, status="active", offset=0)]},
        {"tool_calls": [call(READ_TOOL, status="active", offset=50)]},
        answer(),
    ])

    result = agent.request("Проверь мои активные задачи по проектам постранично")

    assert agent.steps == []
    page_executions = executions_of(agent, READ_TOOL)
    assert len(page_executions) == 2
    assert {item["args"].get("offset") for item in page_executions} == {0, 50}
    assert all_duplicate_traces(result) == []
    assert result["loop_guard"]["duplicate_calls"] == 0


def test_loop_guard_stops_no_progress(agent):
    """Two consecutive rounds without progress (no successful non-meta result,
    no new error shape) stop the loop before the round ceiling: a synthetic
    ai.loop_guard result is appended and the telemetry marks the stop."""
    def always_same_failure(tool_id, args):
        return "Сервис задач недоступен: таймаут соединения" if tool_id == READ_TOOL else None

    agent.state["handler"] = always_same_failure
    agent.steps.extend([
        # Same error shape every round; args differ only to keep the older
        # identical-calls early stop out of the experiment.
        {"tool_calls": [call(READ_TOOL, offset=0)]},
        {"tool_calls": [call(READ_TOOL, offset=50)]},
        {"tool_calls": [call(READ_TOOL, offset=100)]},
        # Consumed by the forced final answer pass after the guard stop.
        answer("Не удалось получить данные."),
    ])

    result = agent.request("Проверь мои активные задачи по проектам")

    assert agent.steps == []
    guard = result["loop_guard"]
    assert guard["stopped"] is True
    # Round 1 still counts as progress (the error shape is new); rounds 2 and 3
    # repeat it — the stop lands after the second consecutive barren round.
    assert guard["rounds_used"] == 3
    assert guard["rounds_used"] < 6
    assert len(executions_of(agent, READ_TOOL)) == 3, (
        "no further tool rounds may execute after the guard stop"
    )
    final_prompts = [p for p in agent.prompts if p.get("schema_name") == "ai_chat_response_final"]
    assert final_prompts, "a loop-guarded run must end with the forced final answer pass"
    assert "ai.loop_guard" in final_prompts[-1]["user_prompt"]
    assert "loop_guard_stop" in final_prompts[-1]["user_prompt"]


def test_loop_guard_continues_on_new_errors(agent):
    """A genuinely new error shape each round IS progress: the guard never
    fires and the loop runs up to the configured round ceiling."""
    counter = {"count": 0}

    def shifting_failure(tool_id, args):
        if tool_id != READ_TOOL:
            return None
        counter["count"] += 1
        return f"Сбой сервиса задач: вариант отказа номер {counter['count']}"

    agent.state["handler"] = shifting_failure
    agent.steps.extend([
        {"tool_calls": [call(READ_TOOL, offset=index * 50)]}
        for index in range(6)
    ] + [answer("Не удалось получить данные.")])

    result = agent.request("Проверь мои активные задачи по проектам")

    assert agent.steps == []
    guard = result["loop_guard"]
    assert guard["stopped"] is False
    assert guard["rounds_used"] == 6, (
        "with fresh error shapes every round the loop must reach the round ceiling"
    )
    assert len(executions_of(agent, READ_TOOL)) == 6


def test_loop_guard_disabled_flag(agent, monkeypatch):
    """AI_LOOP_GUARD_ENABLED=0 removes the early stop entirely: the same
    no-progress script as in the enabled test burns rounds up to the ceiling."""
    monkeypatch.setenv("AI_LOOP_GUARD_ENABLED", "0")

    def always_same_failure(tool_id, args):
        return "Сервис задач недоступен: таймаут соединения" if tool_id == READ_TOOL else None

    agent.state["handler"] = always_same_failure
    agent.steps.extend([
        {"tool_calls": [call(READ_TOOL, offset=index * 50)]}
        for index in range(6)
    ] + [answer("Не удалось получить данные.")])

    result = agent.request("Проверь мои активные задачи по проектам")

    assert agent.steps == []
    guard = result["loop_guard"]
    assert guard["stopped"] is False
    assert guard["rounds_used"] == 6, (
        "with the flag off the guard must not stop the loop even without progress"
    )
    assert len(executions_of(agent, READ_TOOL)) == 6
