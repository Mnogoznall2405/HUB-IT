# -*- coding: utf-8 -*-
"""A9 real-LLM benchmark: drive AiChatService end-to-end on sqlite with the
REAL provider (RouterAI) and REAL Jev over the quality corpus.

Run from the candidate worktree:
    $env:APP_ENV='development'; $env:JWT_SECRET_KEY='x'*32
    python documentation/technical/ai-architecture-audit/a9-artifacts/a9_real_run.py `
        --label a9real_jev1 --jev 1 --env C:\Project\HUB-IT-main\.env [--limit N]

Baseline: copy this file into the baseline worktree's a9-artifacts and run it
there with the same arguments (ROOT is resolved from the script location).

Never prints secrets. Provider keys are loaded from --env into os.environ only
for names not already set (test DB URLs etc. win).
"""
import argparse
import json
import os
import sys
import tempfile
import time
from datetime import datetime, timezone
from pathlib import Path

ROOT = next(p for p in Path(__file__).resolve().parents if (p / "WEB-itinvent").is_dir())
sys.path.insert(0, str(ROOT / "WEB-itinvent"))
sys.path.insert(0, str(ROOT / "tests"))

_parser = argparse.ArgumentParser()
_parser.add_argument("--label", default="real")
_parser.add_argument("--jev", choices=("0", "1"), default="1")
_parser.add_argument("--a9", choices=("on", "off"), default="on",
                    help="pin A9 optimization flags (ignored on baseline trees)")
_parser.add_argument("--env", default=str(ROOT.parent / "HUB-IT-main" / ".env"))
_parser.add_argument("--limit", type=int, default=0)
_parser.add_argument("--ids", default="")
_parser.add_argument("--provider", choices=("routerai", "openrouter"), default="routerai")
_parser.add_argument("--out", default="")
_args = _parser.parse_args()
LABEL = _args.label

TMP = Path(tempfile.mkdtemp(prefix="a9_real_"))
DB_URL = f"sqlite:///{(TMP / 'real.db').as_posix()}"

os.environ["APP_ENV"] = "development"
os.environ.setdefault("JWT_SECRET_KEY", "x" * 32)
os.environ["APP_DATABASE_URL"] = DB_URL
os.environ["CHAT_DATABASE_URL"] = DB_URL
os.environ["CHAT_ENABLED"] = "1"
os.environ["AI_JEV_ROUTING"] = _args.jev
os.environ["AI_SUMMARY_BACKGROUND_ENABLED"] = "0"
if _args.a9 == "on":
    os.environ["AI_PROMPT_OPTIMIZATION_ENABLED"] = "1"
else:
    os.environ["AI_PROMPT_OPTIMIZATION_ENABLED"] = "0"
os.environ.pop("AI_LLM_CALL_LOG_FILE", None)
# Sandbox + external endpoints must not be reachable from the bench.
os.environ["AI_SANDBOX_ENABLED"] = "0"

# Load provider config from the real .env (never printed). Keys already set
# for the test environment (DB URLs, flags) are not overridden.
_env_file = Path(_args.env)
_env_loaded = []
if _env_file.exists():
    from dotenv import dotenv_values
    for _k, _v in dotenv_values(str(_env_file)).items():
        if _v is None:
            continue
        if _k not in os.environ or not os.environ.get(_k):
            os.environ[_k] = str(_v)
            _env_loaded.append(_k)

if _args.provider == "openrouter":
    # RouterAI balance exhausted mid-run — fall back to the OpenRouter key
    # (same gateway code path: key/base_url resolve dynamically per call).
    for _k in ("ROUTERAI_API_KEY", "ROUTERAI_BASE_URL", "ROUTERAI_MODEL"):
        os.environ.pop(_k, None)

import conftest  # tests/conftest.py helpers  # noqa: E402
import backend.config as backend_config  # noqa: E402
import backend.appdb.db as appdb_db  # noqa: E402
import backend.chat.db as chat_db  # noqa: E402
import backend.chat.models as chat_models  # noqa: E402
import backend.chat.service as chat_service_module  # noqa: E402
import backend.ai_chat.service as ai_chat_module  # noqa: E402
import backend.services.user_service as user_service_module  # noqa: E402

try:
    import backend.ai_chat.memory as smart_memory_module  # noqa: E402
except Exception:
    smart_memory_module = None

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
_kb = getattr(ai_chat_module, "ai_kb_retrieval_service", None)
if _kb is not None:
    _kb.ensure_index_fresh = lambda **kw: None
    _kb.retrieve = lambda **kw: []
try:
    chat_service_module.chat_push_service.send_chat_message_notification = lambda *a, **k: None
except Exception:
    pass

# --- real-LLM instrumentation ------------------------------------------------
LLM_CALLS: list[dict] = []
JEV_CALLS: list[dict] = []

_orc = getattr(ai_chat_module, "openrouter_client", None)
if _orc is None:
    from shared.llm import openrouter_client as _orc  # noqa: E402
_est_tokens = getattr(ai_chat_module, "_estimated_tokens", lambda s: len(str(s)) // 3)

_real_complete_json = _orc.complete_json


def _recording_complete_json(**kwargs):
    t0 = time.perf_counter()
    rec = {
        "t0": t0,
        "model": kwargs.get("model") or "",
        "purpose": kwargs.get("purpose") or "",
        "schema_name": kwargs.get("schema_name") or "",
        "est_in_tokens": _est_tokens(
            str(kwargs.get("system_prompt") or "") + str(kwargs.get("user_prompt") or "")
        ),
    }
    try:
        payload, usage = _real_complete_json(**kwargs)
        rec["ok"] = True
        usage = usage or {}
        rec["usage"] = {
            "prompt_tokens": usage.get("prompt_tokens"),
            "completion_tokens": usage.get("completion_tokens"),
            "total_tokens": usage.get("total_tokens"),
            "model": usage.get("model"),
            "finish_reason": usage.get("finish_reason"),
            "cost": usage.get("cost") or usage.get("cost_usd"),
        }
        calls = payload.get("tool_calls") if isinstance(payload, dict) else None
        rec["tool_calls"] = [
            {"tool_id": (c or {}).get("tool_id"), "args_keys": sorted((c or {}).get("args") or {})}
            for c in (calls or [])
            if isinstance(c, dict)
        ]
        rec["answer_len"] = len(str((payload or {}).get("answer_markdown") or ""))
        return payload, usage
    except Exception as exc:  # noqa: BLE001 — record and re-raise
        rec["ok"] = False
        rec["error"] = f"{type(exc).__name__}: {str(exc)[:200]}"
        raise
    finally:
        rec["duration_ms"] = int((time.perf_counter() - t0) * 1000)
        LLM_CALLS.append(rec)


_orc.complete_json = _recording_complete_json
if smart_memory_module is not None:
    # Planner uses the same shared client — the wrapper records it too.
    if getattr(smart_memory_module, "openrouter_client", None) is not None:
        smart_memory_module.openrouter_client = _orc

_jev_client = getattr(ai_chat_module, "jev_client", None)
if _jev_client is None:
    try:
        from shared.llm import jev_client as _jev_client  # noqa: E402
    except Exception:
        _jev_client = None
if _jev_client is not None:
    _real_decide = _jev_client.decide

    def _recording_decide(*a, **kw):
        t0 = time.perf_counter()
        try:
            d = _real_decide(*a, **kw)
            JEV_CALLS.append({
                "ok": True,
                "duration_ms": int((time.perf_counter() - t0) * 1000),
                "model": getattr(d, "model", ""),
                "input_tokens": getattr(d, "input_tokens", 0),
                "output_tokens": getattr(d, "output_tokens", 0),
                "cost_usd": getattr(d, "cost_usd", 0.0),
                "answers": {
                    name: {
                        "type": type(ans).__name__,
                        "choice": getattr(ans, "choice", None),
                        "probability": getattr(ans, "probability", None),
                    }
                    for name, ans in (getattr(d, "answers", {}) or {}).items()
                },
            })
            return d
        except Exception as exc:  # noqa: BLE001
            JEV_CALLS.append({
                "ok": False,
                "duration_ms": int((time.perf_counter() - t0) * 1000),
                "error": f"{type(exc).__name__}: {str(exc)[:200]}",
            })
            raise

    _jev_client.decide = _recording_decide

chat_db.initialize_chat_schema(DB_URL)

from backend.appdb.db import app_session as grant_session  # noqa: E402
from backend.appdb.models import AppAiBotAccess, AppAiBotRun  # noqa: E402

ALL_TOOL_IDS = [s.get("tool_id") for s in ai_chat_module.ai_tool_registry.list_specs()]
ALL_TOOL_IDS = [t for t in ALL_TOOL_IDS if t]


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


def _last_run(conversation_id: str) -> dict:
    with grant_session(DB_URL) as db:
        run = (
            db.query(AppAiBotRun)
            .filter(AppAiBotRun.conversation_id == conversation_id)
            .order_by(AppAiBotRun.created_at.desc())
            .first()
        )
        if run is None:
            return {}
        return {
            "id": run.id,
            "status": run.status,
            "stage": run.stage,
            "error_text": run.error_text,
            "result_json": run.result_json,
            "usage_json": run.usage_json,
        }


def _last_assistant_body(conversation_id: str) -> str:
    with chat_db.chat_session(DB_URL) as session:
        msg = (
            session.query(chat_models.ChatMessage)
            .filter(chat_models.ChatMessage.conversation_id == conversation_id)
            .order_by(chat_models.ChatMessage.conversation_seq.desc())
            .first()
        )
        return str(msg.body or "") if msg is not None else ""


# --- corpus -------------------------------------------------------------------
corpus_path = ROOT / "documentation" / "technical" / "ai-architecture-audit" / "a9-artifacts" / "a9_quality_corpus.json"
corpus = json.loads(corpus_path.read_text(encoding="utf-8"))
scenarios = corpus["scenarios"] if isinstance(corpus, dict) else corpus
if _args.ids:
    wanted = {s.strip() for s in _args.ids.split(",") if s.strip()}
    scenarios = [s for s in scenarios if s["id"] in wanted]
if _args.limit:
    scenarios = scenarios[: _args.limit]

perms = [
    "chat.read", "chat.write", "chat.ai.use", "kb.read",
    "itinvent.read", "itinvent.act", "office.read", "office.act",
    "directory.read", "me.read", "me.act", "warehouse.read",
    "network.read", "ad.read", "ad.act", "mfu.read",
    "helpdesk.act", "files.create", "chat.act",
]
actor = _mk_actor("real_bench_user", perms)

bot_no_tools = _mk_bot(actor, "bot_no_tools", [])
bot_all = _mk_bot(actor, "bot_all_tools", ALL_TOOL_IDS)

results = {
    "env": {
        "AI_JEV_ROUTING": os.environ.get("AI_JEV_ROUTING"),
        "AI_PROMPT_OPTIMIZATION_ENABLED": os.environ.get("AI_PROMPT_OPTIMIZATION_ENABLED"),
        "AI_SUMMARY_BACKGROUND_ENABLED": os.environ.get("AI_SUMMARY_BACKGROUND_ENABLED"),
        "ROUTERAI_MODEL": os.environ.get("ROUTERAI_MODEL"),
        "JEV_MODEL": os.environ.get("JEV_MODEL") or "(default)",
        "env_keys_loaded": len(_env_loaded),
        "registered_tools": len(ALL_TOOL_IDS),
        "code_root": str(ROOT),
    },
    "scenarios": [],
    "started_at": datetime.now(timezone.utc).isoformat(),
}

print(f"[a9_real] {len(scenarios)} scenarios, jev={_args.jev}, a9={_args.a9}, root={ROOT}", flush=True)

for idx, scenario in enumerate(scenarios, 1):
    sid = scenario["id"]
    category = scenario.get("category") or ""
    prompt = scenario.get("prompt") or ""
    expected = set(scenario.get("expected_tools") or [])
    forbidden = set(scenario.get("forbidden") or [])
    bot = bot_no_tools if category == "CHAT" else bot_all

    conv = ai_service.create_bot_conversation(bot_id=bot["id"], current_user_id=int(actor["id"]))
    seq = 0
    if category == "LONGCTX":
        # Real multi-turn history, not a one-line summary.
        for i in range(1, 21):
            seq += 1
            _send(conv["id"], int(actor["id"]), seq,
                  f"История {i}: обсуждали оборудование в кабинете 201, картриджи HP и заявки склада.")
    seq += 1
    trigger_id = f"msg-{conv['id']}-{seq}"
    _send(conv["id"], int(actor["id"]), seq, prompt)

    calls_start = len(LLM_CALLS)
    jev_start = len(JEV_CALLS)
    t0 = time.perf_counter()
    run_ok = False
    run_error = None
    try:
        ai_service.queue_run_for_message(
            conversation_id=conv["id"],
            trigger_message_id=trigger_id,
            current_user_id=int(actor["id"]),
        )
        run_ok = bool(ai_service.process_next_run())
    except Exception as exc:  # noqa: BLE001
        run_error = f"{type(exc).__name__}: {str(exc)[:300]}"
    wall_ms = int((time.perf_counter() - t0) * 1000)

    recs = LLM_CALLS[calls_start:]
    jevs = JEV_CALLS[jev_start:]
    tools_called = [c["tool_id"] for rec in recs for c in rec.get("tool_calls") or []]
    tool_ids = [t for t in tools_called if t]
    run_row = _last_run(conv["id"])
    answer = _last_assistant_body(conv["id"])

    expected_hit = sorted(t for t in expected if t in set(tool_ids))
    forbidden_hit = [t for t in tool_ids if "*any-tool*" in forbidden or t in forbidden]
    in_tok = sum(int((r.get("usage") or {}).get("prompt_tokens") or 0) for r in recs)
    out_tok = sum(int((r.get("usage") or {}).get("completion_tokens") or 0) for r in recs)
    jev_tok = sum(int(j.get("input_tokens") or 0) + int(j.get("output_tokens") or 0) for j in jevs)
    jev_cost = sum(float(j.get("cost_usd") or 0) for j in jevs)
    llm_cost = sum(float((r.get("usage") or {}).get("cost") or 0) for r in recs)

    entry = {
        "id": sid,
        "category": category,
        "run_ok": run_ok,
        "run_error": run_error,
        "run_status": run_row.get("status"),
        "run_stage": run_row.get("stage"),
        "wall_ms": wall_ms,
        "llm_calls": len(recs),
        "llm_call_errors": sum(1 for r in recs if not r.get("ok")),
        "jev_calls": len(jevs),
        "jev_errors": sum(1 for j in jevs if not j.get("ok")),
        "jev_answers": [j.get("answers") for j in jevs if j.get("ok")][:3],
        "tool_calls": tools_called,
        "expected_hit": expected_hit,
        "expected_missing": sorted(expected - set(expected_hit)),
        "forbidden_hit": forbidden_hit,
        "tokens": {
            "llm_in": in_tok, "llm_out": out_tok, "jev_total": jev_tok,
            "est_in": sum(int(r.get("est_in_tokens") or 0) for r in recs),
        },
        "cost_usd": {"llm": llm_cost, "jev": jev_cost},
        "answer_len": len(answer),
        "answer_head": answer[:240],
        "result_message": bool(answer.strip()),
    }
    results["scenarios"].append(entry)
    status = "OK" if run_ok else f"FAIL({run_error or run_row.get('status')})"
    print(f"[{idx}/{len(scenarios)}] {sid}: {status} llm={len(recs)} jev={len(jevs)} "
          f"tools={tool_ids} in={in_tok} out={out_tok} wall={wall_ms}ms", flush=True)
    # Incremental dump: a crashed run must not lose completed scenarios.
    try:
        _partial = Path(_args.out) if _args.out else (
            ROOT / "documentation" / "technical" / "ai-architecture-audit" / "a9-artifacts" / f"real_run_{LABEL}.json"
        )
        _partial.parent.mkdir(parents=True, exist_ok=True)
        _partial.write_text(json.dumps(results, ensure_ascii=False, indent=2), encoding="utf-8")
    except Exception:  # noqa: BLE001
        pass

# aggregate
agg = {
    "scenarios": len(results["scenarios"]),
    "run_ok": sum(1 for s in results["scenarios"] if s["run_ok"]),
    "llm_calls_total": sum(s["llm_calls"] for s in results["scenarios"]),
    "jev_calls_total": sum(s["jev_calls"] for s in results["scenarios"]),
    "tool_calls_total": sum(len(s["tool_calls"]) for s in results["scenarios"]),
    "tokens_in_total": sum(s["tokens"]["llm_in"] for s in results["scenarios"]),
    "tokens_out_total": sum(s["tokens"]["llm_out"] for s in results["scenarios"]),
    "jev_tokens_total": sum(s["tokens"]["jev_total"] for s in results["scenarios"]),
    "est_in_total": sum(s["tokens"]["est_in"] for s in results["scenarios"]),
    "cost_usd_total": sum(s["cost_usd"]["llm"] + s["cost_usd"]["jev"] for s in results["scenarios"]),
    "wall_ms_total": sum(s["wall_ms"] for s in results["scenarios"]),
    "expected_coverage": (
        sum(len(s["expected_hit"]) for s in results["scenarios"]),
        sum(len(s["expected_hit"]) + len(s["expected_missing"]) for s in results["scenarios"]),
    ),
    "forbidden_violations": sum(1 for s in results["scenarios"] if s["forbidden_hit"]),
}
results["aggregate"] = agg
results["finished_at"] = datetime.now(timezone.utc).isoformat()

out_path = Path(_args.out) if _args.out else (
    ROOT / "documentation" / "technical" / "ai-architecture-audit" / "a9-artifacts" / f"real_run_{LABEL}.json"
)
out_path.parent.mkdir(parents=True, exist_ok=True)
out_path.write_text(json.dumps(results, ensure_ascii=False, indent=2), encoding="utf-8")
print(json.dumps({"aggregate": agg, "out": str(out_path)}, ensure_ascii=False, indent=2))
