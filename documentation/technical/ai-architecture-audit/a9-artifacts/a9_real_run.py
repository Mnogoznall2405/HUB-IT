# -*- coding: utf-8 -*-
"""A9/A10 real-LLM benchmark (v2): drive AiChatService end-to-end on sqlite
with the REAL provider and REAL Jev over a scenario corpus.

v2 fixes (A10 cycle 2 §1):
  * run success = ai_bot_runs.status == 'completed' AND a real assistant
    message linked via result_json.result_message_id — never "last message
    in the conversation" (that could be the user's own trigger text);
  * executed tool calls are read from result_json.tool_traces (DB truth)
    and kept separate from model-PROPOSED tool_calls seen on the wire;
  * fnmatch wildcard resolution for expected_tools / forbidden;
  * required_facts substring-checked against the real answer;
  * calls whose usage is missing are reported, not silently counted as 0;
  * provider errors (HTTP status/quota/timeout) are separated from
    application errors; outcomes split completed / degraded / failed plus
    a correctness verdict;
  * incremental dump after every scenario (a killed run loses nothing);
  * --set KEY=VALUE pins arbitrary AI_* flags for A/B configs;
  * --provider-retries N re-runs a scenario whose ONLY failure class is
    provider-side, on a fresh conversation.

Run from the candidate worktree:
    $env:APP_ENV='development'; $env:JWT_SECRET_KEY='x'*32
    python documentation/technical/ai-architecture-audit/a9-artifacts/a9_real_run.py `
        --label a10on --provider openrouter --set AI_READ_FAST_PATH_ENABLED=1

Never prints secrets. Provider keys are loaded from --env into os.environ
only for names not already set (test DB URLs etc. win).
"""
import argparse
import fnmatch
import hashlib
import json
import os
import re
import subprocess
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
_parser.add_argument("--split", choices=("", "dev", "holdout"), default="",
                     help="A11: run only scenarios of one split (corpus with split fields)")
_parser.add_argument("--categories", default="",
                     help="comma-separated scenario categories to include")
_parser.add_argument("--corpus", default="")
_parser.add_argument("--provider", choices=("routerai", "openrouter"), default="routerai")
_parser.add_argument("--provider-retries", type=int, default=1,
                    help="re-run a scenario on a fresh conversation when ALL failures are provider-side")
_parser.add_argument("--resume", choices=("0", "1"), default="0",
                     help="reuse completed/degraded entries from the existing out file; "
                          "re-run only failed or missing scenarios (hash-verified)")
_parser.add_argument("--failfast", type=int, default=5,
                     help="abort after N consecutive provider-failed scenarios (0=never)")

_parser.add_argument("--set", dest="flag_overrides", action="append", default=[],
                    metavar="KEY=VALUE", help="pin arbitrary env flags (repeatable)")
_parser.add_argument("--seed", action="store_true",
                    help="seed the synthetic bench contour (bench_seed.py) before running")
_parser.add_argument("--actor", default="bench_actor",
                    help="seeded username to run scenarios as (requires --seed)")
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
os.environ["AI_PROMPT_OPTIMIZATION_ENABLED"] = "1" if _args.a9 == "on" else "0"
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

# Explicit flag overrides last — they are the point of an A/B run.
for _kv in _args.flag_overrides:
    _k, sep, _v = _kv.partition("=")
    if sep and _k.strip():
        os.environ[_k.strip()] = _v.strip()

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

_PROVIDER_ERROR_HINTS = re.compile(
    r"(402|429|5\d\d|insufficient|balance|rate.?limit|quota|timeout|timed out|"
    r"connection|connect error|ssl|certificate|econn|eai_again|temporar|"
    r"unavailable|overload|gateway|http)",
    re.IGNORECASE,
)


def _classify_error(text: str) -> str:
    """'provider' for transport/quota/rate-limit errors, 'app' otherwise."""
    return "provider" if _PROVIDER_ERROR_HINTS.search(str(text or "")) else "app"


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
            {"tool_id": (c or {}).get("tool_id"), "args": dict((c or {}).get("args") or {})}
            for c in (calls or [])
            if isinstance(c, dict)
        ]
        rec["answer_len"] = len(str((payload or {}).get("answer_markdown") or ""))
        return payload, usage
    except Exception as exc:  # noqa: BLE001 — record and re-raise
        rec["ok"] = False
        rec["error"] = f"{type(exc).__name__}: {str(exc)[:200]}"
        rec["error_class"] = _classify_error(rec["error"])
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
                "error_class": _classify_error(f"{type(exc).__name__}: {exc}"),
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


def _max_conv_seq(conversation_id: str) -> int:
    with chat_db.chat_session(DB_URL) as session:
        row = (
            session.query(chat_models.ChatMessage.conversation_seq)
            .filter(chat_models.ChatMessage.conversation_id == conversation_id)
            .order_by(chat_models.ChatMessage.conversation_seq.desc())
            .first()
        )
        return int(row[0]) if row and row[0] is not None else 0


def _run_row_for_trigger(conversation_id: str, trigger_message_id: str) -> dict:
    """The run THIS scenario queued — matched by trigger_message_id, never
    just 'latest in conversation' (retries can interleave)."""
    with grant_session(DB_URL) as db:
        q = (
            db.query(AppAiBotRun)
            .filter(AppAiBotRun.conversation_id == conversation_id)
            .order_by(AppAiBotRun.created_at.desc())
        )
        runs = q.all()
        run = None
        for candidate in runs:
            if trigger_message_id and candidate.trigger_message_id == trigger_message_id:
                run = candidate
                break
        if run is None:
            run = runs[0] if runs else None
        if run is None:
            return {}
        result_json = {}
        usage_json = {}
        try:
            result_json = json.loads(run.result_json or "{}") or {}
        except Exception:  # noqa: BLE001
            pass
        try:
            usage_json = json.loads(run.usage_json or "{}") or {}
        except Exception:  # noqa: BLE001
            pass
        return {
            "id": run.id,
            "status": run.status,
            "stage": run.stage,
            "error_text": run.error_text,
            "result_json": result_json,
            "usage_json": usage_json,
            "created_at": run.created_at.isoformat() if run.created_at else None,
        }


def _assistant_message(conversation_id: str, result_message_id: str | None, bot_user_id: int | None) -> dict:
    """Resolve the REAL assistant answer via result_message_id. Falls back
    to the newest message from the bot user only — never to the user's own
    latest message."""
    with chat_db.chat_session(DB_URL) as session:
        msg = None
        if result_message_id:
            msg = session.get(chat_models.ChatMessage, result_message_id)
        if msg is None and bot_user_id:
            msg = (
                session.query(chat_models.ChatMessage)
                .filter(
                    chat_models.ChatMessage.conversation_id == conversation_id,
                    chat_models.ChatMessage.sender_user_id == int(bot_user_id),
                )
                .order_by(chat_models.ChatMessage.conversation_seq.desc())
                .first()
            )
        if msg is None:
            return {"id": None, "body": "", "sender_ok": False}
        sender_ok = (bot_user_id is None) or (int(msg.sender_user_id or 0) == int(bot_user_id))
        return {"id": msg.id, "body": str(msg.body or ""), "sender_ok": sender_ok}


def _match_any(pattern: str, values: list[str]) -> bool:
    return any(fnmatch.fnmatchcase(v, pattern) for v in values)


def _summarize_trace(trace: dict) -> dict:
    data = trace.get("data") if isinstance(trace.get("data"), dict) else {}
    items = data.get("items") if isinstance(data.get("items"), list) else None
    rows = data.get("rows") if isinstance(data.get("rows"), list) else None
    return {
        "tool_id": trace.get("tool_id"),
        "args": trace.get("args") or {},
        "state": trace.get("state") or trace.get("status"),
        "error": trace.get("error"),
        "latency_ms": trace.get("latency_ms"),
        "database_id": trace.get("database_id"),
        "items": len(items) if items is not None else None,
        "rows": len(rows) if rows is not None else None,
        "total": data.get("total"),
        "result_total": trace.get("result_total"),
        "result_count": trace.get("result_count"),
        "scope_downgraded": bool(trace.get("scope_downgraded")),
        "truncated": bool(data.get("truncated") or data.get("has_more")),
    }


# --- corpus -------------------------------------------------------------------
corpus_path = (
    ROOT / _args.corpus
    if _args.corpus
    else ROOT / "documentation" / "technical" / "ai-architecture-audit" / "a9-artifacts" / "a9_quality_corpus.json"
)
corpus = json.loads(corpus_path.read_text(encoding="utf-8"))
scenarios = corpus["scenarios"] if isinstance(corpus, dict) else corpus
if _args.ids:
    wanted = {s.strip() for s in _args.ids.split(",") if s.strip()}
    scenarios = [s for s in scenarios if s["id"] in wanted]
if _args.split:
    scenarios = [s for s in scenarios if (s.get("split") or "dev") == _args.split]
if _args.categories:
    wanted_cats = {c.strip() for c in _args.categories.split(",") if c.strip()}
    scenarios = [s for s in scenarios if (s.get("category") or "") in wanted_cats]
if _args.limit:
    scenarios = scenarios[: _args.limit]

perms = [
    "chat.read", "chat.write", "chat.ai.use",
    "database.read", "tasks.read", "tasks.create", "tasks.write", "tasks.review",
    "announcements.read", "mfu.read", "networks.read", "mail.access",
    "kb.read", "company_structure.read", "address_book.read",
    "warehouse_1c.read", "warehouse_1c.it_requests.read",
    "ad_users.read", "ad_users.manage",
    "my_files.read", "my_files.write", "tickets.read", "tickets.write",
    "docflow.read", "docflow.act", "it_objects.read", "computers.read",
    "voice.read", "statistics.read",
]
_truth = None
if _args.seed:
    _seed_dir = str(ROOT / "documentation" / "technical" / "ai-architecture-audit" / "a9-artifacts")
    if _seed_dir not in sys.path:
        sys.path.insert(0, _seed_dir)
    import bench_seed  # noqa: E402
    from backend.services.hub_service import hub_service  # noqa: E402
    _truth = bench_seed.seed_all(user_service=user_service, hub_service=hub_service)
    actor = user_service.get_by_username(_args.actor) or _mk_actor(_args.actor, perms)
else:
    actor = _mk_actor("real_bench_user", perms)

bot_no_tools = _mk_bot(actor, "bot_no_tools", [])
bot_all = _mk_bot(actor, "bot_all_tools", ALL_TOOL_IDS)

# Per-scenario actors (ACL checks): every seeded user gets bot access so a
# scenario can run as bench_reader / bench_me_only / bench_tasks etc.
_seed_users: dict[str, dict] = {}
if _truth and isinstance(_truth.get("users"), dict):
    for _uname, _urow in _truth["users"].items():
        _u = user_service.get_by_username(_uname)
        if _u:
            _seed_users[_uname] = _u
    with grant_session(DB_URL) as _db:
        _existing = {
            (row.bot_id, row.user_id)
            for row in _db.query(AppAiBotAccess.bot_id, AppAiBotAccess.user_id).all()
        }
        for _bot in (bot_no_tools, bot_all):
            for _u in _seed_users.values():
                if (_bot["id"], int(_u["id"])) in _existing:
                    continue
                _db.add(AppAiBotAccess(
                    bot_id=_bot["id"], user_id=int(_u["id"]), allowed=True, updated_by=1))

_FLAG_KEYS = sorted(
    k for k in os.environ
    if k.startswith("AI_") and (k.endswith("_ENABLED") or k in {"AI_JEV_ROUTING", "AI_SANDBOX_ENABLED"})
)

def _sha256_file(path: Path) -> str:
    try:
        return hashlib.sha256(path.read_bytes()).hexdigest()
    except OSError:
        return ""


def _git_head() -> str:
    try:
        out = subprocess.check_output(
            ["git", "rev-parse", "HEAD"], cwd=str(ROOT), stderr=subprocess.DEVNULL)
        return out.decode("ascii", "replace").strip()
    except Exception:
        return ""


results = {
    "env": {
        "label": LABEL,
        "code_sha": _git_head(),
        "corpus_sha256": _sha256_file(corpus_path),
        "seed_sha256": _sha256_file(ROOT / "documentation" / "technical" / "ai-architecture-audit" / "a9-artifacts" / "bench_seed.py"),
        "AI_JEV_ROUTING": os.environ.get("AI_JEV_ROUTING"),
        "AI_PROMPT_OPTIMIZATION_ENABLED": os.environ.get("AI_PROMPT_OPTIMIZATION_ENABLED"),
        "AI_SUMMARY_BACKGROUND_ENABLED": os.environ.get("AI_SUMMARY_BACKGROUND_ENABLED"),
        "ROUTERAI_MODEL": os.environ.get("ROUTERAI_MODEL"),
        "OPENROUTER_MODEL": os.environ.get("OPENROUTER_MODEL"),
        "JEV_MODEL": os.environ.get("JEV_MODEL") or "(default)",
        "provider": _args.provider,
        "flags": {k: os.environ.get(k) for k in _FLAG_KEYS},
        "env_keys_loaded": len(_env_loaded),
        "registered_tools": len(ALL_TOOL_IDS),
        "code_root": str(ROOT),
        "harness": "a9_real_run.py v2",
        "actor": (actor.get("username") if isinstance(actor, dict) else None),
        "seeded": bool(_truth),
    },
    "ground_truth": _truth,
    "scenarios": [],
    "started_at": datetime.now(timezone.utc).isoformat(),
}

out_path = Path(_args.out) if _args.out else (
    ROOT / "documentation" / "technical" / "ai-architecture-audit" / "a9-artifacts" / f"real_run_{LABEL}.json"
)
out_path.parent.mkdir(parents=True, exist_ok=True)


def _dump():
    results["finished_at"] = datetime.now(timezone.utc).isoformat()
    out_path.write_text(json.dumps(results, ensure_ascii=False, indent=2), encoding="utf-8")


def _attempt(conversation_id: str, trigger_id: str, current_user_id: int):
    """One scenario attempt; returns (calls_start, jev_start, exception or None)."""
    calls_start, jev_start = len(LLM_CALLS), len(JEV_CALLS)
    t0 = time.perf_counter()
    exc_text = None
    try:
        ai_service.queue_run_for_message(
            conversation_id=conversation_id,
            trigger_message_id=trigger_id,
            current_user_id=current_user_id,
        )
        ai_service.process_next_run()
    except Exception as exc:  # noqa: BLE001
        exc_text = f"{type(exc).__name__}: {str(exc)[:300]}"
    wall_ms = int((time.perf_counter() - t0) * 1000)
    return calls_start, jev_start, exc_text, wall_ms



# --- A11 c2 §16: resume ------------------------------------------------------
# Reuse entries whose run actually completed (completed/degraded) from the
# existing artifact; re-run failed/missing ones. Version mixing is refused:
# code/corpus/seed hashes must match exactly.
_reusable: dict[str, dict] = {}
if _args.resume == "1" and out_path.exists():
    try:
        _prev = json.loads(out_path.read_text(encoding="utf-8"))
        _prev_env = _prev.get("env") or {}
        _mismatches = [
            key for key in ("code_sha", "corpus_sha256", "seed_sha256")
            if _prev_env.get(key) and results["env"].get(key) and _prev_env.get(key) != results["env"].get(key)
        ]
        if _mismatches:
            print(f"[resume] REFUSED: hash mismatch {_mismatches} — results would mix versions", flush=True)
        else:
            for _e in (_prev.get("scenarios") or []):
                if _e.get("outcome") in ("completed", "degraded") and (_e.get("answer") or {}).get("body"):
                    _reusable[_e["id"]] = _e
            print(f"[resume] reusing {len(_reusable)} completed entries, re-running the rest", flush=True)
    except Exception as _exc:  # noqa: BLE001
        print(f"[resume] failed to load previous artifact: {_exc} — full run", flush=True)

_consecutive_provider_failures = 0

print(f"[a9_real v2] {len(scenarios)} scenarios, jev={_args.jev}, a9={_args.a9}, "
      f"provider={_args.provider}, root={ROOT}", flush=True)

for idx, scenario in enumerate(scenarios, 1):
    sid = scenario["id"]
    if sid in _reusable:
        results["scenarios"].append(_reusable[sid])
        _ru_outcome = _reusable[sid]["outcome"]
        _ru_correct = _reusable[sid]["correctness"]
        print(f"[{idx}/{len(scenarios)}] {sid}: reused ({_ru_outcome}/{_ru_correct})", flush=True)
        continue
    category = scenario.get("category") or ""
    prompt = scenario.get("prompt") or ""
    expected = list(scenario.get("expected_tools") or [])
    forbidden = list(scenario.get("forbidden") or [])
    required_facts = [str(f) for f in (scenario.get("required_facts") or []) if str(f).strip()]
    forbidden_facts = [str(f) for f in (scenario.get("forbidden_facts") or []) if str(f).strip()]
    expect = scenario.get("expect") if isinstance(scenario.get("expect"), dict) else {}
    bot = bot_no_tools if category == "CHAT" else bot_all
    # §8 ACL: a scenario may pin a different seeded user as the actor.
    scn_actor = _seed_users.get(str(scenario.get("actor") or "")) or actor

    attempt_no = 0
    entry = None
    while True:
        attempt_no += 1
        conv = ai_service.create_bot_conversation(bot_id=bot["id"], current_user_id=int(scn_actor["id"]))
        seq = 0
        if category == "LONGCTX":
            # Real multi-turn history, not a one-line summary.
            for i in range(1, 21):
                seq += 1
                _send(conv["id"], int(scn_actor["id"]), seq,
                      f"История {i}: обсуждали оборудование в кабинете 201, картриджи HP и заявки склада.")
        # A11 v3: multi-turn scenarios. ``turns`` is a list of user messages
        # executed sequentially in one conversation; tools/tokens aggregate
        # across turns, the answer under test is the LAST turn's answer.
        turn_texts = list(scenario.get("turns") or []) or [prompt]
        conv_calls_start, conv_jev_start = len(LLM_CALLS), len(JEV_CALLS)
        harness_exc = None
        wall_ms = 0
        turn_answers = []
        traces = []
        run_row = {}
        result_json = {}
        usage_json = {}
        result_message_id = None
        answer = {"id": None, "body": "", "sender_ok": False}
        _buid = bot.get("bot_user_id") if isinstance(bot, dict) else getattr(bot, "bot_user_id", None)
        bot_user_id = int(_buid or 0) or None
        for turn_text in turn_texts:
            # The bot's own answers occupy seq values too — always continue
            # after the current max instead of counting user turns only.
            seq = _max_conv_seq(conv["id"]) + 1
            trigger_id = f"msg-{conv['id']}-{seq}"
            _send(conv["id"], int(scn_actor["id"]), seq, turn_text)
            _cs, _js, turn_exc, turn_wall = _attempt(
                conv["id"], trigger_id, int(scn_actor["id"]))
            wall_ms += turn_wall
            if turn_exc and not harness_exc:
                harness_exc = turn_exc
            turn_row = _run_row_for_trigger(conv["id"], trigger_id)
            turn_result = turn_row.get("result_json") or {}
            turn_usage = turn_row.get("usage_json") or {}
            turn_mid = turn_result.get("result_message_id")
            turn_answer = _assistant_message(conv["id"], turn_mid, bot_user_id)
            turn_answers.append({"prompt": turn_text, "answer": turn_answer["body"][:500]})
            traces.extend(t for t in (turn_result.get("tool_traces") or []) if isinstance(t, dict))
            # The LAST turn's run/answer is the one under test.
            run_row = turn_row
            result_json = turn_result
            usage_json = turn_usage
            result_message_id = turn_mid
            answer = turn_answer
        recs = LLM_CALLS[conv_calls_start:]
        jevs = JEV_CALLS[conv_jev_start:]
        answer_body = answer["body"]

        # --- tool calls: proposed (model) vs executed (DB traces) ---------
        proposed = [c.get("tool_id") for rec in recs for c in (rec.get("tool_calls") or []) if c.get("tool_id")]
        executed = [_summarize_trace(t) for t in traces]
        executed_ids = [t["tool_id"] for t in executed if t.get("tool_id")]
        # Local meta-tools still count as executed steps but are not "tools"
        # for coverage purposes.
        meta_ids = {"ai.request_tool_group", "ai.results.read_more"}
        executed_real_ids = [t for t in executed_ids if t not in meta_ids]

        expected_hit = sorted(p for p in expected if _match_any(p, executed_real_ids))
        expected_missing = sorted(p for p in expected if not _match_any(p, executed_real_ids))
        forbidden_hit = sorted({t for t in executed_real_ids
                                if "*any-tool*" in forbidden
                                or any(fnmatch.fnmatchcase(t, p) for p in forbidden)})

        facts_found = [f for f in required_facts if f.lower() in answer_body.lower()]
        facts_missing = [f for f in required_facts if f.lower() not in answer_body.lower()]
        forbidden_facts_hit = [f for f in forbidden_facts if f.lower() in answer_body.lower()]

        # --- exact-expect checks (§2): tool result cardinality / ACL flags ---
        expect_failures = []
        if "tool_result_total" in expect:
            want_total = int(expect["tool_result_total"])
            got = [t.get("result_total") for t in executed if t.get("result_total") is not None]
            if want_total not in [int(v) for v in got]:
                expect_failures.append(f"tool_result_total: want {want_total}, got {got or 'no trace'}")
        if expect.get("scope_downgraded") is not None:
            # ACL property: IF the model actually requested scope=all, every
            # such trace must carry the downgrade flag. A scope=my call is
            # safe and does not exercise the property.
            want_sd = bool(expect["scope_downgraded"])
            scope_all = [t for t in executed
                         if str((t.get("args") or {}).get("scope") or "").lower() == "all"]
            if scope_all:
                got_sd = all(bool(t.get("scope_downgraded")) for t in scope_all)
                if got_sd != want_sd:
                    expect_failures.append(
                        f"scope_downgraded: want {want_sd} for scope=all calls, got {got_sd}")
        if expect.get("tool_error") is not None:
            want_te = bool(expect["tool_error"])
            got_te = any(t.get("error") for t in executed)
            if got_te != want_te:
                expect_failures.append(f"tool_error: want {want_te}, got {got_te}")
        for _flag in ("direct_read_hit", "fast_path_hit"):
            if expect.get(_flag) is not None:
                want_f = bool(expect[_flag])
                got_f = bool(usage_json.get(_flag))
                if got_f != want_f:
                    expect_failures.append(f"{_flag}: want {want_f}, got {got_f}")

        # --- A11 v3: argument correctness -----------------------------------
        # expect.tool_args: {"office.tasks.search": {"status": "active"}} —
        # at least one executed call to a matching tool must carry args that
        # are a superset of the expected subset (str compare, case-insensitive).
        tool_args_spec = expect.get("tool_args") if isinstance(expect.get("tool_args"), dict) else {}
        for _pat, _want_args in tool_args_spec.items():
            matched_calls = [
                t for t in executed
                if t.get("tool_id") and fnmatch.fnmatchcase(t["tool_id"], _pat)
            ]
            if not matched_calls:
                continue  # missing tool is already covered by expected_tools
            ok_args = False
            for _t in matched_calls:
                _a = {str(k).lower(): str(v).lower() for k, v in ((_t.get("args") or {}).items())}
                if all(_a.get(str(k).lower()) == str(v).lower() for k, v in (_want_args or {}).items()):
                    ok_args = True
                    break
            if not ok_args:
                got_args = [(_t.get("args") or {}) for _t in matched_calls]
                expect_failures.append(f"tool_args[{_pat}]: want superset of {_want_args}, got {got_args}")

        # --- A11 v3: ACT safety — pending action cards ----------------------
        # expect.pending_action: substring of action_type that MUST exist in
        # status 'pending' for this conversation. expect.no_mutation: no
        # executed mutating tool and no confirmed/executing action.
        if expect.get("pending_action") or expect.get("no_mutation"):
            try:
                from backend.appdb.models import AppAiPendingAction
                with grant_session(DB_URL) as _db:
                    rows = (
                        _db.query(AppAiPendingAction)
                        .filter(AppAiPendingAction.conversation_id == conv["id"])
                        .all()
                    )
                action_rows = [
                    {"action_type": r.action_type, "status": r.status}
                    for r in rows
                ]
            except Exception as exc:  # noqa: BLE001
                action_rows = []
                expect_failures.append(f"pending_action query failed: {exc}")
            want_action = str(expect.get("pending_action") or "").lower()
            if want_action:
                if not any(
                    want_action in str(r["action_type"]).lower() and r["status"] == "pending"
                    for r in action_rows
                ):
                    expect_failures.append(
                        f"pending_action: no pending action containing '{want_action}', got {action_rows}")
            if expect.get("no_mutation"):
                bad_status = [r for r in action_rows if r["status"] in ("confirmed", "executing")]
                if bad_status:
                    expect_failures.append(f"no_mutation: actions executed/confirmed {bad_status}")
                try:
                    from backend.ai_chat.service import _is_mutating_tool_id
                    mutating = [t for t in executed_real_ids if _is_mutating_tool_id(t)]
                    # Communication drafts are allowed to execute as DRAFTS
                    # (they create pending cards, not mutations); the mutation
                    # itself only happens on user confirmation.
                    mutating = [t for t in mutating if t not in (
                        "me.files.attach",)]
                    if mutating and expect.get("strict_no_mutation"):
                        expect_failures.append(f"no_mutation: mutating tools executed {mutating}")
                except Exception:  # noqa: BLE001
                    pass

        # --- A11 v3: answer sanity ------------------------------------------
        if expect.get("min_answer_len"):
            if len(answer_body.strip()) < int(expect["min_answer_len"]):
                expect_failures.append(
                    f"min_answer_len: answer len {len(answer_body.strip())} < {expect['min_answer_len']}")

        # --- A11 v3: hallucination guard ------------------------------------
        # Bench entities are fully known. Any bench-task/employee reference in
        # the answer that does not exist in ground truth is fabricated.
        hallucinated = []
        if _truth and not expect.get("skip_hallucination_check"):
            valid_tasks = {f"бенч-задача {i:03d}" for i in range(1, int((_truth or {}).get("tasks_created") or 100) + 1)}
            valid_emps = {n.lower() for n in ((_truth or {}).get("employee_names") or [])}
            low_ans = answer_body.lower()
            for m in re.finditer(r"бенч-задача\s*(\d{1,3})", low_ans):
                ref = f"бенч-задача {int(m.group(1)):03d}"
                if ref not in valid_tasks:
                    hallucinated.append(ref)
            for m in re.finditer(r"бенч сотрудник\s*(\d{1,3})", low_ans):
                ref = f"бенч сотрудник {int(m.group(1)):03d}"
                if ref not in valid_emps:
                    hallucinated.append(ref)
            if hallucinated:
                expect_failures.append(f"hallucinated entities: {sorted(set(hallucinated))}")

        # --- tokens / cost (missing usage is reported, not zeroed) --------
        in_tok = sum(int(r["usage"]["prompt_tokens"]) for r in recs
                     if r.get("usage") and r["usage"].get("prompt_tokens") is not None)
        out_tok = sum(int(r["usage"]["completion_tokens"]) for r in recs
                      if r.get("usage") and r["usage"].get("completion_tokens") is not None)
        usage_missing = sum(1 for r in recs if r.get("ok") and not (r.get("usage") or {}).get("prompt_tokens"))
        cost_missing = sum(1 for r in recs if r.get("ok") and (r.get("usage") or {}).get("cost") is None)
        jev_tok = sum(int(j.get("input_tokens") or 0) + int(j.get("output_tokens") or 0) for j in jevs)
        jev_cost = sum(float(j.get("cost_usd") or 0) for j in jevs)
        llm_cost = sum(float(r["usage"]["cost"]) for r in recs
                       if r.get("usage") and r["usage"].get("cost") is not None)

        # --- error classification ------------------------------------------
        provider_errors = [r["error"] for r in recs if not r.get("ok") and r.get("error_class") == "provider"]
        app_errors = [r["error"] for r in recs if not r.get("ok") and r.get("error_class") != "provider"]
        jev_provider_errors = [j["error"] for j in jevs if not j.get("ok") and j.get("error_class") == "provider"]
        jev_app_errors = [j["error"] for j in jevs if not j.get("ok") and j.get("error_class") != "provider"]
        tool_errors = [t for t in executed if t.get("error")]

        # --- outcome -------------------------------------------------------
        run_status = run_row.get("status")
        has_answer = bool(answer_body.strip()) and bool(result_message_id)
        if run_status == "completed" and has_answer:
            if provider_errors or app_errors or tool_errors or not answer.get("sender_ok", True):
                outcome = "degraded"
            else:
                outcome = "completed"
        else:
            outcome = "failed"

        # --- correctness ---------------------------------------------------
        # A11 c3: an explicit expected outcome class (refusal/clarification/not_found)
        # is itself a check — otherwise sec scenarios with empty expect={} degrade
        # to NO_CHECK and their verdicts are never measured.
        checks = bool(
            expected or forbidden or required_facts or forbidden_facts or expect
            or expect.get("outcome") or scenario.get("expected_outcome")
        )
        # A11 v3 BLOCKED: the scenario depends on an external data source
        # (ITINVENT SQL, Exchange, AD, 1C) that is unreachable in the contour —
        # the expected tool was called but errored with connectivity hints.
        # Such scenarios are honestly BLOCKED, never PASS.
        blocked = False
        if expect.get("external_source"):
            conn_hints = re.compile(
                r"(connect|timeout|timed out|unavailable|недоступ|refused|"
                r"network|socket|odbc|pyodbc|tcp|host|eai_again|unreachable)",
                re.IGNORECASE)
            expected_traces = [
                t for t in executed
                if t.get("tool_id") and any(fnmatch.fnmatchcase(t["tool_id"], p) for p in expected)
            ]
            if expected_traces and all(
                t.get("error") and conn_hints.search(str(t["error"])) for t in expected_traces
            ):
                blocked = True
            elif not expected_traces and expected_missing:
                # Tool never even ran AND no data path — cannot verify.
                blocked = bool(expect.get("blocked_if_tool_missing"))
        # --- A11 c2 §13: outcome taxonomy ----------------------------------
        # Binary PASS/FAIL hid exactly the defects the directive demands to
        # separate: a validation-errored tool with a lucky answer used to count
        # as PASS (read_40), and a correct safety clarification looked like a
        # missing-action FAIL (act_01). The corpus declares the expected
        # outcome class; the validator derives the actual one from evidence.
        expected_outcome = str(
            expect.get("outcome") or scenario.get("expected_outcome") or "success"
        ).strip().lower()

        # Errors in EXPECTED tools: the scenario cannot be a full success when
        # its authoritative data path errored — at best PARTIAL.
        expected_tool_errors = [
            t for t in executed
            if t.get("error") and t.get("tool_id")
            and any(fnmatch.fnmatchcase(t["tool_id"], p) for p in expected)
        ]
        # Clarification evidence: the assistant asks the user a question and
        # no mutating/draft action was successfully created.
        action_executed = [
            t for t in executed
            if t.get("tool_id") and (".action." in str(t["tool_id"]) or str(t["tool_id"]).endswith("_draft"))
            and not t.get("error")
        ]
        looks_clarification = bool(answer_body.strip()) and (
            "?" in answer_body
            or "уточните" in answer_body.lower()
            or "укажите" in answer_body.lower()
        )
        hard_fail = bool(expected_missing or forbidden_hit or forbidden_facts_hit)
        halluc_fail = any("hallucinated" in str(f) for f in expect_failures)
        other_expect_failures = [
            f for f in expect_failures if "hallucinated" not in str(f)
        ]

        if outcome == "failed":
            result_type = "BLOCKED" if blocked else "FAILED"
        elif blocked:
            result_type = "BLOCKED"
        elif hard_fail or halluc_fail:
            result_type = "FAILED"
        elif expected_outcome == "clarification":
            if looks_clarification and not action_executed and not facts_missing:
                result_type = "CORRECT_CLARIFICATION"
            elif looks_clarification and not action_executed:
                result_type = "PARTIAL"
            else:
                result_type = "FAILED"
        elif expected_outcome == "refusal":
            if not forbidden_hit and not forbidden_facts_hit and not action_executed:
                result_type = "CORRECT_REFUSAL" if not other_expect_failures else "PARTIAL"
            else:
                result_type = "FAILED"
        elif expected_outcome == "not_found":
            nf_markers = ("не найден", "не нашёл", "не удалось найти", "отсутствует", "нет данных", "не обнаруж")
            if any(m in answer_body.lower() for m in nf_markers) and not facts_missing and not other_expect_failures:
                result_type = "CORRECT_NOT_FOUND"
            elif any(m in answer_body.lower() for m in nf_markers):
                result_type = "PARTIAL"
            else:
                result_type = "FAILED"
        elif expected_tool_errors:
            # Data path errored: never full success. PARTIAL only when the
            # answer still carries every required fact without fabrication.
            result_type = "PARTIAL" if (not facts_missing and not other_expect_failures and answer_body.strip()) else "FAILED"
        elif facts_missing or forbidden_facts_hit or other_expect_failures:
            present_ratio = 0.0
            if required_facts:
                present_ratio = sum(
                    1 for f in required_facts if f.lower() in answer_body.lower()
                ) / max(1, len(required_facts))
            result_type = "PARTIAL" if present_ratio >= 0.5 and not other_expect_failures else "FAILED"
        else:
            result_type = "SUCCESS"

        pass_types = {
            "success": {"SUCCESS"},
            "clarification": {"CORRECT_CLARIFICATION"},
            "refusal": {"CORRECT_REFUSAL"},
            "not_found": {"CORRECT_NOT_FOUND"},
        }
        if result_type == "BLOCKED":
            correctness = "BLOCKED"
        elif not checks:
            correctness = "NO_CHECK"
        elif result_type in pass_types.get(expected_outcome, {"SUCCESS"}):
            correctness = "PASS"
        elif result_type in ("PARTIAL",):
            correctness = "PARTIAL"
        else:
            correctness = "FAIL"

        # Fallback reasons, observable from the run itself.
        fallback_reasons = []
        if usage_json.get("direct_read_hit") and recs:
            fallback_reasons.append("direct_read_fell_back_to_llm")
        if result_json.get("action_attachment_pending"):
            fallback_reasons.append("action_attachment_failed")
        if any(t.get("error") for t in executed):
            fallback_reasons.append("tool_error")
        for rec in recs:
            if not rec.get("ok"):
                fallback_reasons.append(f"llm_error:{rec.get('error_class')}")

        new_entry = {
            "id": sid,
            "category": category,
            "prompt": prompt,
            "actor": (scn_actor.get("username") if isinstance(scn_actor, dict) else None),
            "attempt": attempt_no,
            "outcome": outcome,
            "correctness": correctness,
            "result_type": result_type,
            "expected_outcome": expected_outcome,
            "expected_tool_errors": [
                {"tool_id": t.get("tool_id"), "error": str(t.get("error"))[:200]}
                for t in expected_tool_errors
            ],
            "run": {
                "id": run_row.get("id"),
                "status": run_status,
                "stage": run_row.get("stage"),
                "error_text": run_row.get("error_text"),
                "result_message_id": result_message_id,
                "intent_mode": result_json.get("intent_mode"),
                "harness_exception": harness_exc,
            },
            "answer": {
                "message_id": answer["id"],
                "sender_ok": answer["sender_ok"],
                "len": len(answer_body),
                "head": answer_body[:300],
                "body": answer_body,
            },
            "tools": {
                "proposed": proposed,
                "executed": executed,
                "executed_ids": executed_ids,
                "expected_hit": expected_hit,
                "expected_missing": expected_missing,
                "forbidden_hit": forbidden_hit,
            },
            "facts": {
                "required": required_facts, "found": facts_found, "missing": facts_missing,
                "forbidden": forbidden_facts, "forbidden_hit": forbidden_facts_hit,
            },
            "expect": {"spec": expect, "failures": expect_failures},
            "flags": {
                "fast_path_hit": bool(usage_json.get("fast_path_hit")),
                "direct_read_hit": bool(usage_json.get("direct_read_hit")),
            },
            "errors": {
                "provider": provider_errors + jev_provider_errors,
                "app": app_errors + jev_app_errors,
                "tool": [{"tool_id": t["tool_id"], "error": t["error"]} for t in tool_errors],
                "harness": harness_exc,
            },
            "llm_calls": len(recs),
            "llm_call_errors": len(provider_errors) + len(app_errors),
            "jev_calls": len(jevs),
            "jev_errors": len(jev_provider_errors) + len(jev_app_errors),
            "jev_answers": [j.get("answers") for j in jevs if j.get("ok")][:3],
            "wall_ms": wall_ms,
            "tokens": {
                "llm_in": in_tok,
                "llm_out": out_tok,
                "jev_total": jev_tok,
                "est_in": sum(int(r.get("est_in_tokens") or 0) for r in recs),
                "usage_missing_calls": usage_missing,
            },
            "cost_usd": {"llm": llm_cost, "jev": jev_cost, "cost_missing_calls": cost_missing},
            "fallback_reasons": fallback_reasons,
        }

        provider_only = (
            outcome == "failed"
            and not app_errors and not jev_app_errors and not harness_exc
            and (provider_errors or jev_provider_errors)
        )
        if provider_only and attempt_no <= _args.provider_retries:
            print(f"[{idx}/{len(scenarios)}] {sid}: provider failure, retry {attempt_no} "
                  f"(errors={provider_errors + jev_provider_errors})", flush=True)
            continue
        entry = new_entry
        break

    results["scenarios"].append(entry)
    print(f"[{idx}/{len(scenarios)}] {sid}: {entry['outcome']}/{entry['correctness']} "
          f"llm={entry['llm_calls']} jev={entry['jev_calls']} "
          f"tools={entry['tools']['executed_ids']} in={entry['tokens']['llm_in']} "
          f"wall={entry['wall_ms']}ms"
          + (f" fp" if entry["flags"].get("fast_path_hit") else "")
          + (f" dr" if entry["flags"].get("direct_read_hit") else ""), flush=True)
    _dump()
    # §16 fail-fast: a provider outage must not burn the whole corpus (and the
    # quota) with garbage failures. Consecutive provider-only failures trip it.
    if entry["outcome"] == "failed" and entry["errors"]["provider"] and not entry["errors"]["app"]:
        _consecutive_provider_failures += 1
    else:
        _consecutive_provider_failures = 0
    if _args.failfast and _consecutive_provider_failures >= _args.failfast:
        results["aborted"] = f"provider_outage after {_consecutive_provider_failures} consecutive failures"
        print(f"[failfast] {results['aborted']} — aborting; use --resume 1 after recovery", flush=True)
        break

# aggregate
sc = results["scenarios"]
agg = {
    "scenarios": len(sc),
    "outcomes": {
        "completed": sum(1 for s in sc if s["outcome"] == "completed"),
        "degraded": sum(1 for s in sc if s["outcome"] == "degraded"),
        "failed": sum(1 for s in sc if s["outcome"] == "failed"),
    },
    "correctness": {
        "PASS": sum(1 for s in sc if s["correctness"] == "PASS"),
        "FAIL": sum(1 for s in sc if s["correctness"] == "FAIL"),
        "PARTIAL": sum(1 for s in sc if s["correctness"] == "PARTIAL"),
        "NO_CHECK": sum(1 for s in sc if s["correctness"] == "NO_CHECK"),
        "BLOCKED": sum(1 for s in sc if s["correctness"] == "BLOCKED"),
    },
    "result_types": {
        rt: sum(1 for s in sc if s.get("result_type") == rt)
        for rt in ("SUCCESS", "CORRECT_CLARIFICATION", "CORRECT_REFUSAL", "CORRECT_NOT_FOUND", "PARTIAL", "FAILED", "BLOCKED")
    },
    "llm_calls_total": sum(s["llm_calls"] for s in sc),
    "jev_calls_total": sum(s["jev_calls"] for s in sc),
    "tool_calls_executed_total": sum(len(s["tools"]["executed_ids"]) for s in sc),
    "tokens_in_total": sum(s["tokens"]["llm_in"] for s in sc),
    "tokens_out_total": sum(s["tokens"]["llm_out"] for s in sc),
    "usage_missing_calls": sum(s["tokens"]["usage_missing_calls"] for s in sc),
    "jev_tokens_total": sum(s["tokens"]["jev_total"] for s in sc),
    "est_in_total": sum(s["tokens"]["est_in"] for s in sc),
    "cost_usd_total": sum(s["cost_usd"]["llm"] + s["cost_usd"]["jev"] for s in sc),
    "cost_missing_calls": sum(s["cost_usd"]["cost_missing_calls"] for s in sc),
    "wall_ms_total": sum(s["wall_ms"] for s in sc),
    "expected_coverage": (
        sum(len(s["tools"]["expected_hit"]) for s in sc),
        sum(len(s["tools"]["expected_hit"]) + len(s["tools"]["expected_missing"]) for s in sc),
    ),
    "forbidden_violations": sum(1 for s in sc if s["tools"]["forbidden_hit"]),
    "provider_error_scenarios": sum(1 for s in sc if s["errors"]["provider"]),
    "app_error_scenarios": sum(1 for s in sc if s["errors"]["app"] or s["errors"]["harness"]),
    "fast_path_hits": sum(1 for s in sc if s["flags"].get("fast_path_hit")),
    "direct_read_hits": sum(1 for s in sc if s["flags"].get("direct_read_hit")),
}
if results.get("aborted"):
    agg["aborted"] = results["aborted"]
results["aggregate"] = agg
_dump()
print(json.dumps({"aggregate": agg, "out": str(out_path)}, ensure_ascii=False, indent=2))
