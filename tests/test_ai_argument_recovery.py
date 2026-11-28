"""A11 §9/§11: tool-argument formation quality and error recovery.

Dev-loop defect being pinned here: the model called directory.people.search /
itinvent.user.by_name with empty args twice in a row and never corrected the
call — the validation error it received was not actionable. The recovery
contract these tests enforce:

1. A schema-validation failure must surface the failing field name, the
   expected type, the compact args signature (``name*: type``) and one minimal
   valid example — inside the exact tool-result payload the model reads.
2. The follow-up prompt's validation-errors block must carry the same hint so
   the next round has enough context to fix the call.
3. A corrected re-call in the next round must succeed end-to-end.

Level 1 tests exercise ``_execute_tool_calls`` directly (fast, no runtime DB);
the level 2 test runs the full orchestration loop with a scripted LLM provider,
modelled on test_ai_chat_runtime.py.
"""
from __future__ import annotations

import conftest

import importlib
import json
import os
import re
import sys
from datetime import datetime, timezone
from pathlib import Path
from types import SimpleNamespace

import pytest
from sqlalchemy import select


PROJECT_ROOT = Path(__file__).resolve().parents[1]
WEB_ROOT = PROJECT_ROOT / "WEB-itinvent"

os.environ.setdefault("APP_ENV", "development")
os.environ.setdefault("ENVIRONMENT", "development")

if str(WEB_ROOT) not in sys.path:
    sys.path.insert(0, str(WEB_ROOT))


# ---------------------------------------------------------------------------
# Level 1: validation diagnostic content (no runtime DB required)
# ---------------------------------------------------------------------------


def _make_context(*, enabled_tools: list[str]):
    from backend.ai_chat.tools.context import AiToolExecutionContext

    return AiToolExecutionContext(
        bot_id="bot-test",
        bot_title="AI Assistant",
        conversation_id="conv-test",
        run_id="run-test",
        user_id=42,
        # Admin bypasses the AG-2 permission gate so the test reaches the
        # argument-validation path it exercises.
        user_payload={"id": 42, "role": "admin"},
        effective_database_id="ITINVENT",
        enabled_tools=enabled_tools,
        tool_settings={"multi_db_mode": "single", "allowed_databases": []},
    )


def _invalid_call(tool_id: str, args: dict):
    from backend.ai_chat.service import AiChatService

    results, traces = AiChatService()._execute_tool_calls(
        tool_calls=[{"tool_id": tool_id, "args": args}],
        tool_context=_make_context(enabled_tools=[tool_id]),
        report_stage=None,
    )
    assert len(results) == 1
    assert results[0]["ok"] is False
    diagnostic = (results[0].get("data") or {}).get("diagnostic") or {}
    assert diagnostic.get("error_code") == "invalid_arguments"
    return results[0], traces[0], diagnostic


def test_empty_args_diagnostic_names_missing_required_field():
    """args={} for a tool with a required field: the error the model reads must
    name the exact missing parameter — not a bare 'validation error'."""
    result, _, diagnostic = _invalid_call("itinvent.user.by_name", {})

    assert diagnostic.get("field_path") == "name"
    assert "name" in str(result.get("error"))
    # The fix instruction must be specific to the failing field, not generic.
    fix = str(diagnostic.get("suggested_fix") or "")
    assert "'name'" in fix
    assert "expected: string" in fix


def test_empty_args_diagnostic_carries_compact_args_hint():
    """args_hint lists required params ('*') with types in the compact notation
    the prompt's tool spec uses — never the full JSON schema."""
    _, _, diagnostic = _invalid_call("itinvent.user.by_name", {})

    hint = str(diagnostic.get("args_hint") or "")
    assert "name*" in hint
    assert "string" in hint
    # Compactness: no JSON-schema boilerplate leaks into the hint.
    for schema_noise in ("$defs", "properties", "minLength", "maxLength", "title"):
        assert schema_noise not in hint
    assert len(hint) <= 400


def test_empty_args_diagnostic_carries_minimal_example():
    """One example of a minimal valid call shape with the required key."""
    _, _, diagnostic = _invalid_call("itinvent.user.by_name", {})

    example = diagnostic.get("example")
    assert isinstance(example, dict)
    assert "name" in example
    # The example must show a plausible value shape, never an empty object.
    assert example["name"] not in ("", None)
    assert len(json.dumps(example, ensure_ascii=False)) <= 200


def test_type_error_reports_expected_type_and_offending_field():
    """A wrong-type value: the diagnostic must point at the offending field
    even when it is not a required one, and state the expected type."""
    _, _, diagnostic = _invalid_call("itinvent.employee.list_equipment", {"owner_no": "abc"})

    assert diagnostic.get("field_path") == "owner_no"
    assert "(expected: integer)" in str(diagnostic.get("suggested_fix") or "")
    example = diagnostic.get("example") or {}
    # The offending non-required field is still included in the example so the
    # model sees the correct shape for exactly the argument it got wrong.
    assert "owner_no" in example
    assert isinstance(example["owner_no"], int)


def test_optional_only_tool_type_error_includes_focus_field():
    """For all-optional tools the required-fields example would be empty; the
    offending field must still appear in it."""
    _, _, diagnostic = _invalid_call("kb.articles.search", {"limit": 9999})

    assert diagnostic.get("field_path") == "limit"
    example = diagnostic.get("example") or {}
    assert "limit" in example
    assert isinstance(example["limit"], int)


def test_extra_forbidden_field_says_drop_and_lists_real_params():
    """The dev-loop shape: the model sends {"name": ...} to directory.people.search
    whose schema (extra="forbid") only knows 'query'. The diagnostic must say the
    field is unknown and list the real parameters — 'fix the type' would send the
    model hunting for a problem that is not there."""
    _, _, diagnostic = _invalid_call("directory.people.search", {"name": "Иванов"})

    assert diagnostic.get("field_path") == "name"
    fix = str(diagnostic.get("suggested_fix") or "")
    assert "Remove unknown argument 'name'" in fix
    hint = str(diagnostic.get("args_hint") or "")
    # The real parameters the model should map its value onto.
    assert "query" in hint
    assert "name" not in hint.split("query")[0]  # no fabricated 'name' param in the hint


def test_unknown_tool_keeps_generic_fix_without_schema_hint():
    """Unknown/disabled tools are not schema errors: no fabricated args_hint,
    and the previous generic guidance is preserved."""
    from backend.ai_chat.service import AiChatService

    results, _ = AiChatService()._execute_tool_calls(
        tool_calls=[{"tool_id": "non.existent.tool", "args": {}}],
        tool_context=_make_context(enabled_tools=["itinvent.user.by_name"]),
        report_stage=None,
    )
    diagnostic = (results[0].get("data") or {}).get("diagnostic") or {}
    assert diagnostic.get("error_code") == "invalid_arguments"
    assert "args_hint" not in diagnostic
    assert "example" not in diagnostic
    assert "input_schema" in str(diagnostic.get("suggested_fix") or "")


def test_schema_examples_are_preferred_in_recovery_example():
    """When the schema declares examples/enum/default, the recovery hint uses
    them instead of a synthetic placeholder."""
    from backend.ai_chat.service import _validation_args_recovery_hint

    schema = {
        "type": "object",
        "properties": {
            "status": {"type": "string", "enum": ["open", "done"]},
            "note": {"type": "string", "examples": ["перевести в каб. 204"]},
        },
        "required": ["status", "note"],
    }
    _, example = _validation_args_recovery_hint(schema)
    assert example["status"] == "open"
    assert example["note"] == "перевести в каб. 204"


def test_recovery_hint_signature_matches_prompt_spec_notation():
    """The hint reuses the exact ``name*: type`` notation the model saw in the
    tool listing, so it can map the error onto the spec it already knows."""
    from backend.ai_chat.service import _tool_spec_args_signature, _validation_args_recovery_hint
    from backend.ai_chat.tools.registry import ai_tool_registry

    tool = ai_tool_registry.get("itinvent.user.by_name")
    schema = tool.input_model.model_json_schema()
    hint, _ = _validation_args_recovery_hint(schema)
    assert hint == _tool_spec_args_signature(schema, with_descriptions=False)


# ---------------------------------------------------------------------------
# Level 2: full-run recovery with a scripted LLM provider
# ---------------------------------------------------------------------------


def _sqlite_url(tmp_path: Path, name: str) -> str:
    return f"sqlite:///{(tmp_path / name).as_posix()}"


def _configure_local_backend_runtime(tmp_path: Path, monkeypatch, name: str) -> str:
    """Same local-runtime wiring as test_ai_chat_runtime: sqlite app/chat DBs
    plus the memory planner disabled so it cannot consume scripted replies."""
    database_url = _sqlite_url(tmp_path, name)
    monkeypatch.setenv("APP_DATABASE_URL", database_url)
    monkeypatch.setenv("CHAT_DATABASE_URL", database_url)
    monkeypatch.setenv("CHAT_ENABLED", "1")

    backend_config = importlib.import_module("backend.config")
    appdb_db = importlib.import_module("backend.appdb.db")
    chat_db = importlib.import_module("backend.chat.db")

    monkeypatch.setattr(backend_config.config.app_db, "database_url", database_url, raising=False)
    monkeypatch.setattr(backend_config.config.chat, "database_url", database_url, raising=False)
    monkeypatch.setattr(backend_config.config.chat, "enabled", True, raising=False)
    monkeypatch.setattr(appdb_db.config.app_db, "database_url", database_url, raising=False)
    monkeypatch.setattr(chat_db.config.app_db, "database_url", database_url, raising=False)
    monkeypatch.setattr(chat_db.config.chat, "database_url", database_url, raising=False)
    monkeypatch.setattr(chat_db.config.chat, "enabled", True, raising=False)

    appdb_db._engines.clear()
    appdb_db._session_factories.clear()
    appdb_db._initialized_schema_urls.clear()
    chat_db._engines.clear()
    chat_db._session_factories.clear()
    chat_db._read_engines.clear()
    chat_db._read_session_factories.clear()
    chat_db._engine = None
    chat_db._session_factory = None
    chat_db._read_engine = None
    chat_db._read_session_factory = None
    conftest.copy_chat_schema_for_url(database_url)

    smart_memory_module = importlib.import_module("backend.ai_chat.memory")

    def _no_planner_call(**kwargs):
        raise RuntimeError("memory planner disabled in this test module")

    monkeypatch.setattr(smart_memory_module, "openrouter_client", SimpleNamespace(complete_json=_no_planner_call))
    return database_url


def _patch_ai_tool_database_catalog(monkeypatch) -> None:
    tools_context_module = importlib.import_module("backend.ai_chat.tools.context")
    monkeypatch.setattr(
        tools_context_module,
        "get_all_db_configs",
        lambda: [
            {"id": "ITINVENT", "name": "ITINVENT"},
            {"id": "OBJ-ITINVENT", "name": "OBJ-ITINVENT"},
        ],
    )


def _untrusted_section(prompt: str, heading: str, kind: str) -> str:
    heading_index = prompt.find(heading)
    assert heading_index >= 0, f"expected heading {heading!r} in prompt"
    tail = prompt[heading_index + len(heading):]
    match = re.match(
        r"\n<<UNTRUSTED_" + re.escape(kind) + r" nonce=(?P<nonce>[^\s>]+)(?: source=[^\n>]*)?>>\n"
        r"(?P<body>.*?)\n"
        r"<<END_UNTRUSTED_" + re.escape(kind) + r" nonce=(?P=nonce)>>",
        tail,
        re.DOTALL,
    )
    assert match is not None, (
        f"expected a well-formed <<UNTRUSTED_{kind}>> block with paired nonce right after {heading!r}"
    )
    return match.group("body")


def test_run_recovers_from_empty_args_validation_error(tmp_path, monkeypatch):
    """Scripted defect replay: round 1 calls itinvent.user.by_name with empty
    args (the dev-loop failure), round 2 re-calls it with the corrected args.

    Asserts the exact model-facing context of the follow-up round: the tool
    result payload must name the missing parameter and carry the compact
    args hint/example, and the validation-errors prompt block must repeat them
    next to the retry instruction.
    """
    database_url = _configure_local_backend_runtime(tmp_path, monkeypatch, "ai_argument_recovery.db")
    _patch_ai_tool_database_catalog(monkeypatch)

    ai_chat_module = importlib.import_module("backend.ai_chat.service")
    chat_service_module = importlib.import_module("backend.chat.service")
    chat_db = importlib.import_module("backend.chat.db")
    chat_models = importlib.import_module("backend.chat.models")
    app_models = importlib.import_module("backend.appdb.models")
    user_service_module = importlib.import_module("backend.services.user_service")

    monkeypatch.setattr(chat_service_module.hub_service, "data_dir", tmp_path, raising=False)

    temp_user_service = user_service_module.UserService(database_url=database_url)
    temp_chat_service = chat_service_module.ChatService()
    temp_chat_service._attachments_root = tmp_path / "chat_message_attachments"
    temp_chat_service._attachments_root.mkdir(parents=True, exist_ok=True)
    temp_chat_service._upload_sessions_root = tmp_path / "chat_upload_sessions"
    temp_chat_service._upload_sessions_root.mkdir(parents=True, exist_ok=True)
    temp_ai_service = ai_chat_module.AiChatService()

    monkeypatch.setattr(ai_chat_module, "user_service", temp_user_service)
    monkeypatch.setattr(chat_service_module, "user_service", temp_user_service)
    monkeypatch.setattr(ai_chat_module, "chat_service", temp_chat_service)
    monkeypatch.setattr(ai_chat_module.ai_kb_retrieval_service, "ensure_index_fresh", lambda **kwargs: None)
    monkeypatch.setattr(ai_chat_module.ai_kb_retrieval_service, "retrieve", lambda **kwargs: [])
    monkeypatch.setattr(
        chat_service_module.chat_push_service,
        "send_chat_message_notification",
        lambda *args, **kwargs: None,
        raising=False,
    )

    completion_calls: list[dict[str, object]] = []

    def fake_complete_json(**kwargs):
        completion_calls.append({
            "system_prompt": str(kwargs.get("system_prompt") or ""),
            "user_prompt": str(kwargs.get("user_prompt") or ""),
        })
        if len(completion_calls) == 1:
            # The dev-loop defect: empty args although 'name' is required.
            return {
                "answer_markdown": "",
                "artifacts": [],
                "kb_attachment_send": None,
                "tool_calls": [{"tool_id": "itinvent.user.by_name", "args": {}}],
            }, {"output_tokens": 5}
        if len(completion_calls) == 2:
            # Recovery: the model corrected the call using the diagnostic.
            return {
                "answer_markdown": "",
                "artifacts": [],
                "kb_attachment_send": None,
                "tool_calls": [{"tool_id": "itinvent.user.by_name", "args": {"name": "Козловский"}}],
            }, {"output_tokens": 7}
        return {
            "answer_markdown": "Найден сотрудник: Козловский Максим (ИТ отдел).",
            "artifacts": [],
            "kb_attachment_send": None,
            "tool_calls": [],
        }, {"output_tokens": 12}

    employee_lookup_calls: list[dict[str, object]] = []

    def fake_search_employees(search_term, page=1, limit=50, db_id=None):
        employee_lookup_calls.append({"search_term": str(search_term), "db_id": str(db_id or "")})
        return {
            "employees": [
                {
                    "OWNER_NO": 501,
                    "FIO": "Козловский Максим",
                    "DEPARTMENT": "ИТ отдел",
                    "POSITION": "Системный администратор",
                }
            ],
            "total": 1,
            "page": int(page),
            "limit": int(limit),
            "pages": 1,
        }

    monkeypatch.setattr(ai_chat_module.openrouter_client, "complete_json", fake_complete_json)
    monkeypatch.setattr(
        ai_chat_module.openrouter_client,
        "get_status",
        lambda: {"configured": True, "default_model": "openai/gpt-4o-mini"},
    )
    monkeypatch.setattr("backend.ai_chat.tools.itinvent.queries.search_employees", fake_search_employees)
    monkeypatch.setattr("backend.ai_chat.tools.itinvent.queries.get_owner_no_by_name", lambda *a, **kw: 501)
    monkeypatch.setattr(
        "backend.ai_chat.tools.itinvent.queries.get_owner_by_no",
        lambda *a, **kw: {"OWNER_NO": 501, "FIO": "Козловский Максим", "DEPARTMENT": "ИТ отдел"},
    )

    chat_db.initialize_chat_schema(database_url)

    actor = temp_user_service.create_user(
        username="operator_recovery",
        password="secret-pass",
        role="viewer",
        auth_source="local",
        full_name="Operator Recovery",
        is_active=True,
        use_custom_permissions=True,
        custom_permissions=["chat.read", "chat.write", "chat.ai.use", "database.read"],
    )

    bot = temp_ai_service.ensure_default_bot()
    from backend.appdb.db import app_session as grant_session
    from backend.appdb.models import AppAiBotAccess
    with grant_session(database_url) as db:
        db.add(AppAiBotAccess(bot_id=bot["id"], user_id=int(actor["id"]), allowed=True, updated_by=1))
    temp_ai_service.update_bot(bot["id"], {
        "enabled_tools": ["itinvent.user.by_name"],
        "tool_settings": {"multi_db_mode": "single", "allowed_databases": []},
    })
    opened = temp_ai_service.open_bot_conversation(bot_id=bot["id"], current_user_id=int(actor["id"]))

    with chat_db.chat_session(database_url) as session:
        conversation = session.get(chat_models.ChatConversation, opened["id"])
        user_message = chat_models.ChatMessage(
            id="msg-human-recovery-1",
            conversation_id=opened["id"],
            sender_user_id=int(actor["id"]),
            body="Найди владельца оборудования Козловского в ITinvent",
            body_format="plain",
            conversation_seq=1,
            created_at=datetime.now(timezone.utc),
        )
        conversation.last_message_id = user_message.id
        conversation.last_message_seq = 1
        conversation.last_message_at = user_message.created_at
        conversation.updated_at = user_message.created_at
        session.add(user_message)

    queued = temp_ai_service.queue_run_for_message(
        conversation_id=opened["id"],
        trigger_message_id="msg-human-recovery-1",
        current_user_id=int(actor["id"]),
        effective_database_id="ITINVENT",
    )
    assert queued is not None
    assert temp_ai_service.process_next_run() is True

    # Three LLM steps: broken call -> corrected call -> final answer.
    assert len(completion_calls) == 3
    followup_prompt = str(completion_calls[1]["user_prompt"])

    # 1) The tool result payload the model reads must name the missing
    #    parameter and carry the structured recovery diagnostic.
    tool_results_section = _untrusted_section(
        followup_prompt,
        "Accumulated tool results (untrusted data):",
        "tool_result",
    )
    assert "invalid_arguments" in tool_results_section
    assert '"field_path": "name"' in tool_results_section
    assert '"args_hint"' in tool_results_section
    assert "name*" in tool_results_section
    assert '"example"' in tool_results_section

    # 2) The validation-errors block must repeat the compact hint next to the
    #    retry instruction, so the correction context is impossible to miss.
    validation_section = _untrusted_section(
        followup_prompt,
        "Tool validation errors to fix (untrusted data):",
        "tool_result",
    )
    validation_errors = json.loads(validation_section)
    assert len(validation_errors) == 1
    entry = validation_errors[0]
    assert entry["tool_id"] == "itinvent.user.by_name"
    assert entry["args"] == {}
    assert entry["field_path"] == "name"
    assert "name" in str(entry["message"])
    assert "name*" in str(entry.get("args_hint") or "")
    assert "string" in str(entry.get("args_hint") or "")
    assert isinstance(entry.get("example"), dict) and "name" in entry["example"]
    # The instruction after the block explains the hint notation.
    assert "args_hint" in followup_prompt
    assert "'*' = required" in followup_prompt

    # 3) The corrected re-call executed successfully end-to-end.
    assert employee_lookup_calls == [{"search_term": "Козловский", "db_id": "ITINVENT"}]

    with chat_db.chat_session(database_url) as session:
        runs = list(session.execute(select(app_models.AppAiBotRun)).scalars())
        messages = list(
            session.execute(
                select(chat_models.ChatMessage)
                .where(chat_models.ChatMessage.conversation_id == opened["id"])
                .order_by(chat_models.ChatMessage.conversation_seq.asc())
            ).scalars()
        )

    assert len(runs) == 1
    result_payload = json.loads(str(runs[0].result_json or "{}"))
    assert str(runs[0].status) == "completed"
    # The run records both the failed and the corrected call in its traces.
    trace_ids = [trace.get("tool_id") for trace in result_payload.get("tool_traces") or []]
    assert trace_ids == ["itinvent.user.by_name", "itinvent.user.by_name"]
    assert "Козловский" in messages[-1].body
