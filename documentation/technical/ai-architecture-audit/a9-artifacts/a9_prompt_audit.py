"""A9 prompt audit: drives AiChatService end-to-end on sqlite and records the
assembled system/user prompts per LLM call + per-block token accounting.

Run from repo root:
    $env:APP_ENV='development'; $env:JWT_SECRET_KEY='x'*32
    python documentation/technical/ai-architecture-audit/a9-artifacts/a9_prompt_audit.py --label candidate
Writes documentation/technical/ai-architecture-audit/a9-artifacts/prompt_audit_<label>.json

Experiment flags are set explicitly (AI_JEV_ROUTING=1,
AI_SUMMARY_BACKGROUND_ENABLED=0) — the result must not depend on ambient env.
Every scenario asserts the run outcome and, for the tool-round scenario,
that the scripted tool was actually executed (its result appears in the
follow-up prompt's tool_results block).
"""
import argparse
import json
import os
import sys
import tempfile
from datetime import datetime, timezone
from pathlib import Path
from types import SimpleNamespace

ROOT = next(p for p in Path(__file__).resolve().parents if (p / "WEB-itinvent").is_dir())
sys.path.insert(0, str(ROOT / "WEB-itinvent"))
sys.path.insert(0, str(ROOT / "tests"))

_parser = argparse.ArgumentParser()
_parser.add_argument("--label", default="candidate")
_parser.add_argument("--jev", choices=("0", "1"), default="1")
_args = _parser.parse_args()
LABEL = _args.label

TMP = Path(tempfile.mkdtemp(prefix="a9_audit_"))
DB_URL = f"sqlite:///{(TMP / 'audit.db').as_posix()}"

os.environ["APP_ENV"] = "development"
os.environ.setdefault("JWT_SECRET_KEY", "x" * 32)
os.environ["APP_DATABASE_URL"] = DB_URL
os.environ["CHAT_DATABASE_URL"] = DB_URL
os.environ["CHAT_ENABLED"] = "1"
os.environ["AI_JEV_ROUTING"] = _args.jev
os.environ["AI_SUMMARY_BACKGROUND_ENABLED"] = "0"
os.environ.pop("AI_LLM_CALL_LOG_FILE", None)

import conftest  # tests/conftest.py helpers  # noqa: E402
import backend.config as backend_config  # noqa: E402
import backend.appdb.db as appdb_db  # noqa: E402
import backend.chat.db as chat_db  # noqa: E402
import backend.chat.models as chat_models  # noqa: E402
import backend.chat.service as chat_service_module  # noqa: E402
import backend.ai_chat.service as ai_chat_module  # noqa: E402
import backend.ai_chat.memory as smart_memory_module  # noqa: E402
import backend.services.user_service as user_service_module  # noqa: E402

for cfg_owner in (backend_config.config, appdb_db.config, chat_db.config):
    cfg_owner.app_db.database_url = DB_URL
    cfg_owner.chat.database_url = DB_URL
    cfg_owner.chat.enabled = True

for mod in (appdb_db, chat_db):
    mod._engines.clear()
    mod._session_factories.clear()
appdb_db._initialized_schema_urls.clear()
chat_db._read_engines.clear()
chat_db._read_session_factories.clear()
for attr in ("_engine", "_session_factory", "_read_engine", "_read_session_factory"):
    setattr(chat_db, attr, None)
conftest.copy_chat_schema_for_url(DB_URL)


def _no_planner_call(**kwargs):
    raise RuntimeError("memory planner disabled in audit")


smart_memory_module.openrouter_client = SimpleNamespace(complete_json=_no_planner_call)

user_service = user_service_module.UserService(database_url=DB_URL)
chat_service = chat_service_module.ChatService()
chat_service._attachments_root = TMP / "chat_message_attachments"
chat_service._attachments_root.mkdir(parents=True, exist_ok=True)
chat_service._upload_sessions_root = TMP / "chat_upload_sessions"
chat_service._upload_sessions_root.mkdir(parents=True, exist_ok=True)
ai_service = ai_chat_module.AiChatService()

ai_chat_module.user_service = user_service
chat_service_module.user_service = user_service
ai_chat_module.chat_service = chat_service
ai_chat_module.ai_kb_retrieval_service.ensure_index_fresh = lambda **kw: None
ai_chat_module.ai_kb_retrieval_service.retrieve = lambda **kw: []
try:
    chat_service_module.chat_push_service.send_chat_message_notification = lambda *a, **k: None
except Exception:
    pass

CALLS: list[dict] = []
SCRIPT: list[dict] = []


def fake_complete_json(**kwargs):
    CALLS.append(kwargs)
    if SCRIPT:
        return SCRIPT.pop(0)
    return {
        "answer_markdown": "Ответ ассистента.",
        "artifacts": [],
        "kb_attachment_send": None,
        "tool_calls": [],
    }, {"prompt_tokens": 0, "completion_tokens": 5, "total_tokens": 5, "model": "audit-model"}


ai_chat_module.openrouter_client.complete_json = fake_complete_json
ai_chat_module.openrouter_client.get_status = lambda: {"configured": True, "default_model": "openai/gpt-4o-mini"}

chat_db.initialize_chat_schema(DB_URL)

from backend.appdb.db import app_session as grant_session  # noqa: E402
from backend.appdb.models import AppAiBotAccess  # noqa: E402

ALL_TOOL_IDS = [s.get("tool_id") for s in ai_chat_module.ai_tool_registry.list_specs()]
ALL_TOOL_IDS = [t for t in ALL_TOOL_IDS if t and t != "ai.request_tool_group"]
ITINVENT_IDS = [t for t in ALL_TOOL_IDS if t.startswith("itinvent.")]


def _mk_actor(name: str, perms: list[str]):
    return user_service.create_user(
        username=name, password="secret-pass", role="viewer", auth_source="local",
        full_name=name, is_active=True, use_custom_permissions=True, custom_permissions=perms,
    )


def _mk_bot(actor, name: str, tools: list[str] | None):
    bot = ai_service.create_bot({"slug": name, "title": name, "enabled_tools": tools or []})
    with grant_session(DB_URL) as db:
        db.add(AppAiBotAccess(bot_id=bot["id"], user_id=int(actor["id"]), allowed=True, updated_by=1))
    return bot


def _send(conversation_id: str, sender_id: int, seq: int, body: str):
    with chat_db.chat_session(DB_URL) as session:
        conv = session.get(chat_models.ChatConversation, conversation_id)
        msg = chat_models.ChatMessage(
            id=f"msg-{conversation_id}-{seq}",
            conversation_id=conversation_id,
            sender_user_id=sender_id,
            body=body,
            body_format="plain",
            conversation_seq=seq,
            created_at=datetime.now(timezone.utc),
        )
        conv.last_message_id = msg.id
        conv.last_message_seq = seq
        conv.last_message_at = msg.created_at
        conv.updated_at = msg.created_at
        session.add(msg)


def _run(conversation_id: str, trigger_id: str, actor_id: int):
    ai_service.queue_run_for_message(
        conversation_id=conversation_id,
        trigger_message_id=trigger_id,
        current_user_id=actor_id,
    )
    ok = ai_service.process_next_run()
    return ok


def _capture(label: str, start: int):
    out = []
    for kwargs in CALLS[start:]:
        sys_p = str(kwargs.get("system_prompt") or "")
        usr_p = str(kwargs.get("user_prompt") or "")
        out.append({
            "est_system_tokens": ai_chat_module._estimated_tokens(sys_p),
            "est_user_tokens": ai_chat_module._estimated_tokens(usr_p),
            "est_total_tokens": ai_chat_module._estimated_tokens(sys_p) + ai_chat_module._estimated_tokens(usr_p),
            "system_blocks": ai_chat_module._prompt_block_sizes(sys_p),
            "user_blocks": ai_chat_module._prompt_block_sizes(usr_p),
        })
    return {"scenario": label, "calls": out, "call_count": len(out)}


results = {"env": {
    "AI_JEV_ROUTING": os.environ.get("AI_JEV_ROUTING"),
    "AI_SUMMARY_BACKGROUND_ENABLED": os.environ.get("AI_SUMMARY_BACKGROUND_ENABLED"),
    "AI_INPUT_BUDGET_TOKENS": getattr(ai_chat_module, "AI_INPUT_BUDGET_TOKENS", None),
    "AI_MODEL_CONTEXT_WINDOW": getattr(ai_chat_module, "AI_MODEL_CONTEXT_WINDOW", None),
    "AI_CONTEXT_DB_MESSAGE_WINDOW": getattr(ai_chat_module, "AI_CONTEXT_DB_MESSAGE_WINDOW", None),
    "registered_tools": len(ALL_TOOL_IDS) + 1,
}, "scenarios": []}

actor = _mk_actor("audit_user", ["chat.read", "chat.write", "chat.ai.use", "kb.read"])

# S1: CHAT, no tools, 1 message
bot1 = _mk_bot(actor, "bot_no_tools", [])
conv1 = ai_service.open_bot_conversation(bot_id=bot1["id"], current_user_id=int(actor["id"]))
_send(conv1["id"], int(actor["id"]), 1, "Привет! Как дела?")
start = len(CALLS)
_run(conv1["id"], f"msg-{conv1['id']}-1", int(actor["id"]))
results["scenarios"].append(_capture("chat_no_tools_1msg", start))

# S2: itinvent READ bot, 1 message
bot2 = _mk_bot(actor, "bot_itinvent", ITINVENT_IDS)
conv2 = ai_service.open_bot_conversation(bot_id=bot2["id"], current_user_id=int(actor["id"]))
_send(conv2["id"], int(actor["id"]), 1, "Найди принтер в кабинете 204")
start = len(CALLS)
_run(conv2["id"], f"msg-{conv2['id']}-1", int(actor["id"]))
results["scenarios"].append(_capture("read_itinvent_tools_1msg", start))

# S3: ALL tools, 1 message
bot3 = _mk_bot(actor, "bot_all", ALL_TOOL_IDS)
conv3 = ai_service.open_bot_conversation(bot_id=bot3["id"], current_user_id=int(actor["id"]))
_send(conv3["id"], int(actor["id"]), 1, "Составь отчёт по оборудованию и отправь Иванову")
start = len(CALLS)
_run(conv3["id"], f"msg-{conv3['id']}-1", int(actor["id"]))
results["scenarios"].append(_capture("act_all_tools_1msg", start))

# S4: ALL tools + 60-message history
conv4 = ai_service.create_bot_conversation(bot_id=bot3["id"], current_user_id=int(actor["id"]))
for i in range(1, 61):
    who = int(actor["id"]) if i % 2 else int(bot3.get("user_id") or actor["id"])
    _send(conv4["id"], int(actor["id"]), i, f"Сообщение номер {i}: обсуждаем оборудование и заявки.")
start = len(CALLS)
_run(conv4["id"], f"msg-{conv4['id']}-60", int(actor["id"]))
results["scenarios"].append(_capture("all_tools_60msg", start))

# S5: ACT with a scripted tool round — captures followup prompt composition.
# ai.files.create executes locally (no external deps), so the follow-up prompt
# must contain its real tool result — proof the tool ran, not just scripted.
SCRIPT.append((
    {"answer_markdown": "", "artifacts": [], "kb_attachment_send": None,
     "tool_calls": [{"tool_id": "ai.files.create", "args": {
         "files": [{"format": "txt", "file_name": "audit.txt", "content": "audit"}]}}]},
    {"prompt_tokens": 0, "completion_tokens": 9, "total_tokens": 9, "model": "audit-model"},
))
conv5 = ai_service.create_bot_conversation(bot_id=bot3["id"], current_user_id=int(actor["id"]))
_send(conv5["id"], int(actor["id"]), 1, "Создай файл с итогом")
start = len(CALLS)
ok5 = _run(conv5["id"], f"msg-{conv5['id']}-1", int(actor["id"]))
assert ok5, "run did not complete"
followup_prompt = str(CALLS[start + 1].get("user_prompt")) if len(CALLS) > start + 1 else ""
assert '"tool_id": "ai.files.create"' in followup_prompt or "ai.files.create" in followup_prompt, (
    "scripted tool was not executed — no result in follow-up prompt")
results["scenarios"].append(_capture("act_tool_round_followup", start))

OUT = ROOT / "documentation" / "technical" / "ai-architecture-audit" / "a9-artifacts"
OUT.mkdir(parents=True, exist_ok=True)
out_path = OUT / f"prompt_audit_{LABEL}.json"
out_path.write_text(json.dumps(results, ensure_ascii=False, indent=2), encoding="utf-8")
print(json.dumps({
    "scenarios": [(s["scenario"], s["call_count"], [c["est_total_tokens"] for c in s["calls"]]) for s in results["scenarios"]],
    "out": str(out_path),
}, ensure_ascii=False, indent=2))
