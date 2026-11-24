"""A8c2/P1: async summary upgrade — incremental LLM checkpoint, durability, CAS."""
import importlib
import sys
import time
import uuid
from datetime import datetime, timedelta, timezone
from pathlib import Path
from types import SimpleNamespace

import pytest
from sqlalchemy import select

PROJECT_ROOT = Path(__file__).resolve().parents[1]
WEB_ROOT = PROJECT_ROOT / "WEB-itinvent"
if str(WEB_ROOT) not in sys.path:
    sys.path.insert(0, str(WEB_ROOT))

import backend.ai_chat.service as svc

NOW = datetime.now(timezone.utc)


def _configure(db_path, monkeypatch):
    url = f"sqlite:///{db_path.as_posix()}"
    monkeypatch.setenv("APP_DATABASE_URL", url)
    monkeypatch.setenv("CHAT_DATABASE_URL", url)
    monkeypatch.setenv("CHAT_ENABLED", "1")
    cfg = importlib.import_module("backend.config")
    appdb = importlib.import_module("backend.appdb.db")
    chatdb = importlib.import_module("backend.chat.db")
    for obj, attr, val in [
        (cfg.config.app_db, "database_url", url),
        (cfg.config.chat, "database_url", url),
        (cfg.config.chat, "enabled", True),
        (appdb.config.app_db, "database_url", url),
        (chatdb.config.app_db, "database_url", url),
        (chatdb.config.chat, "database_url", url),
        (chatdb.config.chat, "enabled", True),
    ]:
        monkeypatch.setattr(obj, attr, val, raising=False)
    appdb._engines.clear()
    appdb._session_factories.clear()
    chatdb._engines.clear()
    chatdb._session_factories.clear()
    chatdb._read_engines.clear()
    chatdb._read_session_factories.clear()
    chatdb._engine = None
    chatdb._session_factory = None
    chatdb._read_engine = None
    chatdb._read_session_factory = None
    return url


@pytest.fixture(autouse=True)
def _clear_pending():
    svc._pending_summary_upgrades.clear()
    svc._summary_upgrade_attempts.clear()
    svc._summary_suppressed_until.clear()
    svc._summary_inflight.clear()
    svc._summary_rate_window.clear()
    for _k in svc._summary_metrics:
        svc._summary_metrics[_k] = 0
    yield
    svc._pending_summary_upgrades.clear()
    svc._summary_upgrade_attempts.clear()
    svc._summary_suppressed_until.clear()
    svc._summary_inflight.clear()
    svc._summary_rate_window.clear()


@pytest.fixture
def env(tmp_path, monkeypatch, prebuilt_chat_db):
    url = _configure(prebuilt_chat_db, monkeypatch)
    e = SimpleNamespace()
    e.url = url
    e.appdb = importlib.import_module("backend.appdb.db")
    e.chatdb = importlib.import_module("backend.chat.db")
    e.app_models = importlib.import_module("backend.appdb.models")
    e.chat_models = importlib.import_module("backend.chat.models")
    e.svc = svc.ai_chat_service
    monkeypatch.setattr(svc, "AI_PERSONAL_MEMORY_ENABLED", True)
    # Lease=0: seeded rows carry updated_at=NOW and must be claimable.
    monkeypatch.setattr(svc, "AI_SUMMARY_UPGRADE_LEASE_SEC", 0)
    return e


def _seed(env, *, conversation_id: str, user_id: int, count: int,
          reset_seq: int = 0, summary_until_seq: int | None = None,
          llm_until_seq: int = 0, rolling_summary: str = "FALLBACK",
          rolling_summary_llm: str = "", use_personal_memory: bool = True,
          deleted_seqs: set[int] | None = None,
          updated_at_offset_sec: int = 0) -> None:
    deleted_seqs = deleted_seqs or set()
    with env.chatdb.chat_session(env.url) as db:
        db.add(env.chat_models.ChatConversation(
            id=conversation_id, kind="direct", title="t",
            created_by_user_id=user_id, last_message_seq=count,
            created_at=NOW, updated_at=NOW,
        ))
        db.add(env.chat_models.ChatMember(
            conversation_id=conversation_id, user_id=user_id,
            member_role="member", joined_at=NOW,
        ))
        for seq in range(1, count + 1):
            body = f"msg-{seq:04d}"
            if seq == 1:
                body += " FACT-START-alpha"
            if seq == max(1, count // 2):
                body += " FACT-MID-beta"
            if seq == count:
                body += " FACT-END-gamma"
            db.add(env.chat_models.ChatMessage(
                id=f"m-{conversation_id}-{seq}", conversation_id=conversation_id,
                sender_user_id=user_id, kind="text", body_format="plain",
                body=body, conversation_seq=seq,
                is_deleted=seq in deleted_seqs,
                created_at=NOW,
            ))
    with env.appdb.app_session(env.url) as db:
        if db.get(env.app_models.AppAiBot, "bot-test") is None:
            db.add(env.app_models.AppAiBot(
                id="bot-test", slug="bot-test", title="Bot", system_prompt="",
                model="test-model", temperature=0.0, max_tokens=1024,
                allowed_kb_scope_json="[]", enabled_tools_json="[]",
                tool_settings_json="{}", allow_file_input=False,
                allow_generated_artifacts=False,
                allow_kb_document_delivery=False, surface="chat",
                placement="sidebar", sort_order=0, required_permission="",
                use_personal_memory=True, is_enabled=True,
                bot_user_id=99999, created_at=NOW, updated_at=NOW,
            ))
        db.add(env.app_models.AppAiBotConversation(
            bot_id="bot-test", user_id=user_id, conversation_id=conversation_id,
            rolling_summary=rolling_summary,
            summary_until_seq=int(summary_until_seq if summary_until_seq is not None else count),
            context_reset_seq=int(reset_seq),
            rolling_summary_llm=rolling_summary_llm,
            summary_llm_until_seq=int(llm_until_seq),
            use_personal_memory=use_personal_memory,
            title_source="assistant", created_at=NOW,
            updated_at=NOW - timedelta(seconds=int(updated_at_offset_sec)),
        ))


def _mapping(env, conversation_id: str, user_id: int):
    with env.appdb.app_session(env.url) as db:
        row = db.execute(
            select(env.app_models.AppAiBotConversation).where(
                env.app_models.AppAiBotConversation.conversation_id == conversation_id,
                env.app_models.AppAiBotConversation.user_id == int(user_id),
            )
        ).scalar_one()
        db.expunge(row)
        return row


def _fake_summarize(calls, fail_times=0):
    state = {"remaining": int(fail_times)}

    def _summarize(base, lines, model=None):
        calls.append(list(lines))
        if state["remaining"] > 0:
            state["remaining"] -= 1
            raise RuntimeError("llm down")
        text = "\n".join(str(item) for item in lines)
        return ((str(base) + " || " + text) if base else text), {"total_tokens": 1}

    return _summarize


# ---------- unit: registration / claim / retry ----------

def test_register_dedups_per_conversation_and_is_bounded():
    svc.ai_chat_service._register_pending_summary(conversation_id="c1", user_id=7, reset_seq=3)
    svc.ai_chat_service._register_pending_summary(conversation_id="c1", user_id=7, reset_seq=5)
    key, value = next(iter(svc._pending_summary_upgrades.items()))
    assert key == ("c1", 7) and value[0] == 5
    for i in range(svc._PENDING_SUMMARY_MAX + 5):
        svc.ai_chat_service._register_pending_summary(conversation_id=f"cx{i}", user_id=1, reset_seq=0)
    assert len(svc._pending_summary_upgrades) <= svc._PENDING_SUMMARY_MAX


def test_claim_respects_retry_deadline():
    svc.ai_chat_service._register_pending_summary(
        conversation_id="c1", user_id=7, reset_seq=3,
        not_before_mono=time.monotonic() + 3600,
    )
    assert svc.ai_chat_service.claim_pending_summary_upgrade() is None
    assert ("c1", 7) in svc._pending_summary_upgrades
    svc._pending_summary_upgrades[("c1", 7)] = (3, 0.0)
    claimed = svc.ai_chat_service.claim_pending_summary_upgrade()
    assert claimed == (("c1", 7), 3)
    assert svc._pending_summary_upgrades == {}


def test_process_retries_with_backoff_then_suppresses(monkeypatch):
    monkeypatch.setattr(svc, "AI_SUMMARY_UPGRADE_MAX_ATTEMPTS", 2)
    svc._pending_summary_upgrades[("conv", 7)] = (2, 0.0)

    def _boom(**kw):
        raise RuntimeError("llm down")

    monkeypatch.setattr(svc.ai_chat_service, "_upgrade_conversation_summary", _boom)
    assert svc.ai_chat_service.process_pending_summary_upgrade() == 1
    # Re-registered with a future retry deadline — not claimable yet.
    assert ("conv", 7) in svc._pending_summary_upgrades
    assert svc.ai_chat_service.claim_pending_summary_upgrade() is None
    assert svc._summary_upgrade_attempts[("conv", 7)] == 1
    # Simulate the deadline passing and fail again -> suppressed for 1h.
    svc._pending_summary_upgrades[("conv", 7)] = (2, 0.0)
    assert svc.ai_chat_service.process_pending_summary_upgrade() == 1
    assert ("conv", 7) not in svc._pending_summary_upgrades
    assert ("conv", 7) not in svc._summary_upgrade_attempts
    deadline, sup_reset = svc._summary_suppressed_until[("conv", 7)]
    assert deadline > time.monotonic() and sup_reset == 2


def test_process_runs_claimed_upgrade(monkeypatch):
    svc._pending_summary_upgrades[("conv", 7)] = (2, 0.0)
    called = []
    monkeypatch.setattr(
        svc.ai_chat_service, "_upgrade_conversation_summary",
        lambda **kw: called.append(kw),
    )
    assert svc.ai_chat_service.process_pending_summary_upgrade() == 1
    assert called == [{"conversation_id": "conv", "user_id": 7, "reset_seq": 2}]
    assert svc._pending_summary_upgrades == {}


# ---------- real DB: incremental upgrade ----------

@pytest.mark.parametrize("count", [20, 100, 200, 201, 500, 1000])
def test_upgrade_folds_full_history_in_batches(env, monkeypatch, count):
    conv = f"conv-{count}-{uuid.uuid4().hex[:6]}"
    _seed(env, conversation_id=conv, user_id=7, count=count)
    calls = []
    monkeypatch.setattr(svc.smart_memory, "summarize", _fake_summarize(calls))
    monkeypatch.setattr(svc, "AI_SUMMARY_UPGRADE_BATCH", 150)

    svc.ai_chat_service._upgrade_conversation_summary(
        conversation_id=conv, user_id=7, reset_seq=0,
    )

    row = _mapping(env, conv, 7)
    assert int(row.summary_llm_until_seq) == count
    # The prompt checkpoint was NOT advanced by the upgrade — it only claims
    # data that actually reached a summary (the fallback wrote it earlier).
    assert int(row.summary_until_seq) == count
    # Full coverage -> LLM text promoted to the prompt-facing summary.
    assert row.rolling_summary == row.rolling_summary_llm
    assert "FALLBACK" not in row.rolling_summary
    assert row.rolling_summary_llm
    # Control facts at the start, middle and end of history all reached a
    # fold call (the stored text itself may be token-truncated on huge
    # histories — coverage is what the checkpoint guarantees).
    folded_lines = "\n".join(line for batch in calls for line in batch)
    for marker in ("FACT-START-alpha", "FACT-MID-beta", "FACT-END-gamma"):
        assert marker in folded_lines, (count, marker)
    expected_batches = -(-count // 150)
    assert len(calls) == expected_batches


def test_upgrade_resumes_from_llm_checkpoint(env, monkeypatch):
    conv = f"conv-{uuid.uuid4().hex[:6]}"
    _seed(env, conversation_id=conv, user_id=7, count=200)
    calls = []
    monkeypatch.setattr(svc.smart_memory, "summarize", _fake_summarize(calls))
    monkeypatch.setattr(svc, "AI_SUMMARY_UPGRADE_BATCH", 150)
    svc.ai_chat_service._upgrade_conversation_summary(conversation_id=conv, user_id=7, reset_seq=0)
    first_calls = len(calls)
    assert first_calls == 2

    # Another run checkpointed 50 more messages with the fallback.
    with env.chatdb.chat_session(env.url) as db:
        for seq in range(201, 251):
            db.add(env.chat_models.ChatMessage(
                id=f"m-{conv}-{seq}", conversation_id=conv, sender_user_id=7,
                kind="text", body_format="plain", body=f"msg-{seq:04d} FACT-NEW",
                conversation_seq=seq, is_deleted=False, created_at=NOW,
            ))
    with env.appdb.app_session(env.url) as db:
        row = db.execute(
            select(env.app_models.AppAiBotConversation).where(
                env.app_models.AppAiBotConversation.conversation_id == conv,
            )
        ).scalar_one()
        row.summary_until_seq = 250
        row.rolling_summary = "FALLBACK2"

    svc.ai_chat_service._upgrade_conversation_summary(conversation_id=conv, user_id=7, reset_seq=0)
    row = _mapping(env, conv, 7)
    assert int(row.summary_llm_until_seq) == 250
    assert row.rolling_summary == row.rolling_summary_llm
    # Only the new 50-message tail was folded in the second pass — resumed
    # from the LLM checkpoint, not rebuilt from scratch.
    assert len(calls) == first_calls + 1
    tail_lines = "\n".join(calls[-1])
    assert "FACT-NEW" in tail_lines and "msg-0250" in tail_lines
    assert "FACT-START-alpha" not in tail_lines


def test_upgrade_checkpoint_never_covers_unfolded_range(env, monkeypatch):
    """A stop mid-way must leave llm_until < until and must NOT promote."""
    conv = f"conv-{uuid.uuid4().hex[:6]}"
    _seed(env, conversation_id=conv, user_id=7, count=500)
    calls = []
    monkeypatch.setattr(svc.smart_memory, "summarize", _fake_summarize(calls))
    monkeypatch.setattr(svc, "AI_SUMMARY_UPGRADE_BATCH", 150)
    monkeypatch.setattr(svc, "AI_SUMMARY_UPGRADE_MAX_MESSAGES", 150)

    svc.ai_chat_service._upgrade_conversation_summary(conversation_id=conv, user_id=7, reset_seq=0)
    row = _mapping(env, conv, 7)
    assert int(row.summary_llm_until_seq) == 150
    assert int(row.summary_until_seq) == 500
    # Prompt-facing summary stays the fallback until full LLM coverage.
    assert row.rolling_summary == "FALLBACK"

    # Next claim resumes at 150 and finishes the job.
    monkeypatch.setattr(svc, "AI_SUMMARY_UPGRADE_MAX_MESSAGES", 1500)
    svc.ai_chat_service._upgrade_conversation_summary(conversation_id=conv, user_id=7, reset_seq=0)
    row = _mapping(env, conv, 7)
    assert int(row.summary_llm_until_seq) == 500
    assert row.rolling_summary == row.rolling_summary_llm
    folded_lines = "\n".join(line for batch in calls for line in batch)
    assert "FACT-START-alpha" in folded_lines
    assert "FACT-END-gamma" in folded_lines


def test_upgrade_advances_over_deleted_tail(env, monkeypatch):
    conv = f"conv-{uuid.uuid4().hex[:6]}"
    _seed(env, conversation_id=conv, user_id=7, count=200,
          deleted_seqs=set(range(151, 201)))
    calls = []
    monkeypatch.setattr(svc.smart_memory, "summarize", _fake_summarize(calls))
    monkeypatch.setattr(svc, "AI_SUMMARY_UPGRADE_BATCH", 150)
    svc.ai_chat_service._upgrade_conversation_summary(conversation_id=conv, user_id=7, reset_seq=0)
    row = _mapping(env, conv, 7)
    assert int(row.summary_llm_until_seq) == 200
    assert row.rolling_summary == row.rolling_summary_llm


def test_upgrade_aborts_when_llm_checkpoint_moved(env, monkeypatch):
    """A concurrent writer bumping summary_llm_until_seq wins; we abort."""
    conv = f"conv-{uuid.uuid4().hex[:6]}"
    _seed(env, conversation_id=conv, user_id=7, count=500)
    monkeypatch.setattr(svc, "AI_SUMMARY_UPGRADE_BATCH", 150)

    def _mutating_summarize(base, lines, model=None):
        with env.appdb.app_session(env.url) as db:
            row = db.execute(
                select(env.app_models.AppAiBotConversation).where(
                    env.app_models.AppAiBotConversation.conversation_id == conv,
                )
            ).scalar_one()
            row.summary_llm_until_seq = 300
            row.rolling_summary_llm = "OTHER-WRITER"
        return ("X", {})

    monkeypatch.setattr(svc.smart_memory, "summarize", _mutating_summarize)
    svc.ai_chat_service._upgrade_conversation_summary(conversation_id=conv, user_id=7, reset_seq=0)
    row = _mapping(env, conv, 7)
    assert int(row.summary_llm_until_seq) == 300
    assert row.rolling_summary_llm == "OTHER-WRITER"
    assert row.rolling_summary == "FALLBACK"  # not promoted over foreign coverage


def test_upgrade_aborts_when_context_reset_mid_run(env, monkeypatch):
    conv = f"conv-{uuid.uuid4().hex[:6]}"
    _seed(env, conversation_id=conv, user_id=7, count=300)
    monkeypatch.setattr(svc, "AI_SUMMARY_UPGRADE_BATCH", 150)
    state = {"calls": 0}

    def _resetting_summarize(base, lines, model=None):
        state["calls"] += 1
        if state["calls"] == 1:
            with env.appdb.app_session(env.url) as db:
                row = db.execute(
                    select(env.app_models.AppAiBotConversation).where(
                        env.app_models.AppAiBotConversation.conversation_id == conv,
                    )
                ).scalar_one()
                row.context_reset_seq = 250
                row.summary_until_seq = 250
                row.rolling_summary = ""
                row.rolling_summary_llm = ""
                row.summary_llm_until_seq = 0
        return ("S", {})

    monkeypatch.setattr(svc.smart_memory, "summarize", _resetting_summarize)
    svc.ai_chat_service._upgrade_conversation_summary(conversation_id=conv, user_id=7, reset_seq=0)
    row = _mapping(env, conv, 7)
    # First batch CAS passed (reset happened inside the LLM call), the second
    # was rejected by the context_reset_seq guard: no post-reset overwrite.
    assert row.rolling_summary != "S" or int(row.summary_llm_until_seq) == 0


def test_upgrade_heals_prompt_text_when_llm_already_covers(env, monkeypatch):
    """llm_until >= until but prompt text was overwritten by a later fallback
    -> heal rolling_summary without any LLM call."""
    conv = f"conv-{uuid.uuid4().hex[:6]}"
    _seed(env, conversation_id=conv, user_id=7, count=100,
          summary_until_seq=100, llm_until_seq=100,
          rolling_summary="FALLBACK-NEWER", rolling_summary_llm="LLM-TEXT")
    calls = []
    monkeypatch.setattr(svc.smart_memory, "summarize", _fake_summarize(calls))
    svc.ai_chat_service._upgrade_conversation_summary(conversation_id=conv, user_id=7, reset_seq=0)
    assert calls == []
    row = _mapping(env, conv, 7)
    assert row.rolling_summary == "LLM-TEXT"


def test_upgrade_suppressed_when_memory_disabled(env, monkeypatch):
    conv = f"conv-{uuid.uuid4().hex[:6]}"
    _seed(env, conversation_id=conv, user_id=7, count=100, use_personal_memory=False)
    calls = []
    monkeypatch.setattr(svc.smart_memory, "summarize", _fake_summarize(calls))
    svc.ai_chat_service._upgrade_conversation_summary(conversation_id=conv, user_id=7, reset_seq=0)
    assert calls == []
    row = _mapping(env, conv, 7)
    assert int(row.summary_llm_until_seq) == 0
    deadline, sup_reset = svc._summary_suppressed_until[(conv, 7)]
    assert deadline > time.monotonic() and sup_reset == 0


# ---------- durability: scan is the source of truth ----------

def test_scan_rediscovers_pending_after_queue_loss(env, monkeypatch):
    """Worker restart dropped the in-memory queue; the DB invariant
    llm_until < until re-registers the work."""
    conv = f"conv-{uuid.uuid4().hex[:6]}"
    _seed(env, conversation_id=conv, user_id=7, count=60)
    assert svc._pending_summary_upgrades == {}
    registered = svc.ai_chat_service.scan_pending_summary_upgrades()
    assert registered == 1
    assert (conv, 7) in svc._pending_summary_upgrades
    calls = []
    monkeypatch.setattr(svc.smart_memory, "summarize", _fake_summarize(calls))
    svc.ai_chat_service.process_pending_summary_upgrade()
    row = _mapping(env, conv, 7)
    assert int(row.summary_llm_until_seq) == 60


def test_scan_skips_suppressed_and_fully_covered(env, monkeypatch):
    conv_done = f"conv-{uuid.uuid4().hex[:6]}"
    conv_sup = f"conv-{uuid.uuid4().hex[:6]}"
    _seed(env, conversation_id=conv_done, user_id=7, count=60,
          llm_until_seq=60, rolling_summary_llm="done")
    _seed(env, conversation_id=conv_sup, user_id=8, count=60)
    svc._summary_suppressed_until[(conv_sup, 8)] = (time.monotonic() + 3600, 0)
    registered = svc.ai_chat_service.scan_pending_summary_upgrades()
    assert registered == 0
    assert svc._pending_summary_upgrades == {}


def test_dropped_by_queue_cap_still_recovered_by_scan(env, monkeypatch):
    conv = f"conv-{uuid.uuid4().hex[:6]}"
    _seed(env, conversation_id=conv, user_id=7, count=60)
    for i in range(svc._PENDING_SUMMARY_MAX):
        svc.ai_chat_service._register_pending_summary(
            conversation_id=f"fill{i}", user_id=1, reset_seq=0,
        )
    svc.ai_chat_service._register_pending_summary(conversation_id=conv, user_id=7, reset_seq=0)
    assert (conv, 7) not in svc._pending_summary_upgrades  # dropped by cap
    svc._pending_summary_upgrades.clear()  # simulate restart / drain
    assert svc.ai_chat_service.scan_pending_summary_upgrades() == 1
    assert (conv, 7) in svc._pending_summary_upgrades


def test_llm_error_then_eventual_success(env, monkeypatch):
    conv = f"conv-{uuid.uuid4().hex[:6]}"
    _seed(env, conversation_id=conv, user_id=7, count=40)
    calls = []
    monkeypatch.setattr(
        svc.smart_memory, "summarize", _fake_summarize(calls, fail_times=1),
    )
    svc._pending_summary_upgrades[(conv, 7)] = (0, 0.0)
    svc.ai_chat_service.process_pending_summary_upgrade()
    assert (conv, 7) in svc._pending_summary_upgrades  # re-registered
    svc._pending_summary_upgrades[(conv, 7)] = (0, 0.0)  # deadline reached
    svc.ai_chat_service.process_pending_summary_upgrade()
    row = _mapping(env, conv, 7)
    assert int(row.summary_llm_until_seq) == 40
    assert (conv, 7) not in svc._pending_summary_upgrades


def test_multi_user_independent(env, monkeypatch):
    conv_a = f"conv-{uuid.uuid4().hex[:6]}"
    conv_b = f"conv-{uuid.uuid4().hex[:6]}"
    _seed(env, conversation_id=conv_a, user_id=7, count=50)
    _seed(env, conversation_id=conv_b, user_id=8, count=50)
    calls = []
    monkeypatch.setattr(svc.smart_memory, "summarize", _fake_summarize(calls))
    svc.ai_chat_service._upgrade_conversation_summary(conversation_id=conv_a, user_id=7, reset_seq=0)
    assert int(_mapping(env, conv_a, 7).summary_llm_until_seq) == 50
    assert int(_mapping(env, conv_b, 8).summary_llm_until_seq) == 0
    assert _mapping(env, conv_b, 8).rolling_summary == "FALLBACK"


# ---------- A8c3: CAS after context reset (P1a) ----------

def test_upgrade_persists_after_context_reset(env, monkeypatch):
    """Repro for the confirmed defect: reset_seq=100, until=120, but the
    stored llm checkpoint is 0. The CAS anchor must be the ACTUAL stored
    value (0), while history reading starts at max(reset_seq, checkpoint).
    The old code compared CAS against reset_seq and could never persist."""
    conv = f"conv-{uuid.uuid4().hex[:6]}"
    _seed(env, conversation_id=conv, user_id=7, count=120,
          reset_seq=100, summary_until_seq=120, llm_until_seq=0,
          rolling_summary="POST-RESET-FALLBACK", rolling_summary_llm="")
    calls = []
    monkeypatch.setattr(svc.smart_memory, "summarize", _fake_summarize(calls))
    outcome = svc.ai_chat_service._upgrade_conversation_summary(
        conversation_id=conv, user_id=7, reset_seq=100,
    )
    row = _mapping(env, conv, 7)
    # Real DB state: checkpoint advanced past the reset boundary.
    assert int(row.summary_llm_until_seq) == 120, outcome
    assert row.rolling_summary == row.rolling_summary_llm
    assert row.rolling_summary_llm
    # Only post-reset messages were folded (seq 101-120).
    folded = "\n".join(line for batch in calls for line in batch)
    assert "msg-0120" in folded and "FACT-END-gamma" in folded
    assert "msg-0001" not in folded and "FACT-START-alpha" not in folded
    # Re-running is idempotent — covered state, no infinite recompute.
    outcome2 = svc.ai_chat_service._upgrade_conversation_summary(
        conversation_id=conv, user_id=7, reset_seq=100,
    )
    assert outcome2["outcome"] == "covered"
    assert len(calls) == 1


def test_upgrade_legacy_row_with_reset_and_stale_llm_text(env, monkeypatch):
    """Historical row: reset_seq=50, llm_until=30 (< reset — coverage is
    pre-reset and unusable) — rebuild from the reset boundary, CAS anchored
    on the stored 30."""
    conv = f"conv-{uuid.uuid4().hex[:6]}"
    _seed(env, conversation_id=conv, user_id=7, count=120,
          reset_seq=50, summary_until_seq=120, llm_until_seq=30,
          rolling_summary="FALLBACK", rolling_summary_llm="STALE-PRE-RESET")
    calls = []
    monkeypatch.setattr(svc.smart_memory, "summarize", _fake_summarize(calls))
    svc.ai_chat_service._upgrade_conversation_summary(
        conversation_id=conv, user_id=7, reset_seq=50,
    )
    row = _mapping(env, conv, 7)
    assert int(row.summary_llm_until_seq) == 120
    assert "STALE-PRE-RESET" not in row.rolling_summary
    folded = "\n".join(line for batch in calls for line in batch)
    assert "msg-0051" in folded and "msg-0050" not in folded


# ---------- A8c3: backoff / suppression / inflight (P1b) ----------

def test_scan_does_not_cancel_backoff():
    key = ("conv-bo", 7)
    deadline = time.monotonic() + 600
    svc._pending_summary_upgrades[key] = (0, deadline, time.monotonic())
    # A scan-equivalent registration with deadline 0 must keep the backoff.
    svc.ai_chat_service._register_pending_summary(
        conversation_id="conv-bo", user_id=7, reset_seq=0,
    )
    assert svc._pending_summary_upgrades[key][1] == deadline
    assert svc.ai_chat_service.claim_pending_summary_upgrade() is None


def test_new_run_registration_does_not_cancel_backoff():
    key = ("conv-bo2", 7)
    deadline = time.monotonic() + 600
    svc._pending_summary_upgrades[key] = (0, deadline, time.monotonic())
    # Run-path registration also cannot zero out the retry deadline.
    svc.ai_chat_service._register_pending_summary(
        conversation_id="conv-bo2", user_id=7, reset_seq=0,
        not_before_mono=0.0,
    )
    assert svc._pending_summary_upgrades[key][1] == deadline


def test_suppressed_key_not_registered_before_expiry():
    key = ("conv-sup", 7)
    svc._summary_suppressed_until[key] = (time.monotonic() + 3600, 0)
    assert svc.ai_chat_service._register_pending_summary(
        conversation_id="conv-sup", user_id=7, reset_seq=0,
    ) is False
    assert key not in svc._pending_summary_upgrades
    # Expired suppression lifts on the next registration.
    svc._summary_suppressed_until[key] = (time.monotonic() - 1, 0)
    assert svc.ai_chat_service._register_pending_summary(
        conversation_id="conv-sup", user_id=7, reset_seq=0,
    ) is True


def test_new_reset_does_not_inherit_suppression_or_attempts():
    key = ("conv-rst", 7)
    svc._summary_suppressed_until[key] = (time.monotonic() + 3600, 5)
    svc._summary_upgrade_attempts[key] = 4
    assert svc.ai_chat_service._register_pending_summary(
        conversation_id="conv-rst", user_id=7, reset_seq=9,
    ) is True
    assert svc._pending_summary_upgrades[key][0] == 9
    assert key not in svc._summary_suppressed_until
    assert key not in svc._summary_upgrade_attempts


def test_inflight_dedup_and_single_claim():
    key = ("conv-inf", 7)
    svc._summary_inflight[key] = 3
    # Same checkpoint basis: the running job covers it.
    assert svc.ai_chat_service._register_pending_summary(
        conversation_id="conv-inf", user_id=7, reset_seq=3,
    ) is False
    assert key not in svc._pending_summary_upgrades
    # A newer reset still queues while the old job runs.
    assert svc.ai_chat_service._register_pending_summary(
        conversation_id="conv-inf", user_id=7, reset_seq=9,
    ) is True
    svc._summary_inflight.pop(key)
    svc._pending_summary_upgrades[("conv-b", 8)] = (0, 0.0, time.monotonic())
    first = svc.ai_chat_service.claim_pending_summary_upgrade()
    second = svc.ai_chat_service.claim_pending_summary_upgrade()
    assert first is not None
    # The claimed key moved to inflight — a second claim cannot re-grab it.
    assert second is None or second[0] != first[0]
    assert first[0] in svc._summary_inflight


def test_process_pops_inflight_after_completion(monkeypatch):
    svc._pending_summary_upgrades[("conv", 7)] = (2, 0.0, time.monotonic())
    monkeypatch.setattr(
        svc.ai_chat_service, "_upgrade_conversation_summary", lambda **kw: {"outcome": "done"},
    )
    assert svc.ai_chat_service.process_pending_summary_upgrade() == 1
    assert svc._summary_inflight == {}


# ---------- A8c3: scan fairness (P2) ----------

def test_scan_fetches_past_suppressed_head(env, monkeypatch):
    """50 suppressed rows at the head of the oldest-first ordering must not
    starve a new pending row behind them (fetch window extends past them)."""
    for i in range(50):
        conv = f"conv-sup{i}-{uuid.uuid4().hex[:4]}"
        _seed(env, conversation_id=conv, user_id=700 + i, count=60,
              updated_at_offset_sec=3600 + i)
        svc._summary_suppressed_until[(conv, 700 + i)] = (time.monotonic() + 3600, 0)
    fresh = f"conv-fresh-{uuid.uuid4().hex[:4]}"
    _seed(env, conversation_id=fresh, user_id=7, count=60)
    registered = svc.ai_chat_service.scan_pending_summary_upgrades(limit=10)
    assert registered >= 1
    assert (fresh, 7) in svc._pending_summary_upgrades


# ---------- A8c3: cost control / lease / metrics ----------

def test_claim_rate_limited():
    svc._pending_summary_upgrades[("a", 1)] = (0, 0.0, time.monotonic())
    svc._pending_summary_upgrades[("b", 2)] = (0, 0.0, time.monotonic())
    for _ in range(svc.AI_SUMMARY_UPGRADE_JOBS_PER_MIN):
        svc._summary_rate_window.append(time.monotonic())
    assert svc.ai_chat_service.claim_pending_summary_upgrade() is None
    assert ("a", 1) in svc._pending_summary_upgrades
    assert svc._summary_metrics["rate_limited"] >= 1


def test_lease_denies_recently_touched_mapping(env, monkeypatch):
    """Cross-worker lease: a mapping updated < LEASE_SEC ago is owned by
    another worker (or was just written by an interactive run — interactive
    traffic wins)."""
    monkeypatch.setattr(svc, "AI_SUMMARY_UPGRADE_LEASE_SEC", 45)
    conv = f"conv-{uuid.uuid4().hex[:6]}"
    _seed(env, conversation_id=conv, user_id=7, count=60)
    # NOW is fixed at module import — under a long suite it ages past the
    # lease window; refresh updated_at to "just written".
    with env.appdb.app_session(env.url) as db:
        row = db.execute(
            select(env.app_models.AppAiBotConversation).where(
                env.app_models.AppAiBotConversation.conversation_id == conv,
            )
        ).scalar_one()
        row.updated_at = datetime.now(timezone.utc)
    calls = []
    monkeypatch.setattr(svc.smart_memory, "summarize", _fake_summarize(calls))
    outcome = svc.ai_chat_service._upgrade_conversation_summary(
        conversation_id=conv, user_id=7, reset_seq=0,
    )
    assert outcome["outcome"] == "lease_busy"
    assert calls == []
    assert int(_mapping(env, conv, 7).summary_llm_until_seq) == 0


def test_token_budget_splits_fold_chunks(env, monkeypatch):
    """A batch whose est-token sum exceeds the fold budget is split into
    multiple summarize() calls; every call stays inside the budget and the
    checkpoint advances chunk by chunk (never past unfolded messages)."""
    conv = f"conv-{uuid.uuid4().hex[:6]}"
    _seed(env, conversation_id=conv, user_id=7, count=60)
    calls = []
    monkeypatch.setattr(svc.smart_memory, "summarize", _fake_summarize(calls))
    monkeypatch.setattr(svc, "AI_SUMMARY_UPGRADE_BATCH", 150)
    monkeypatch.setattr(svc, "AI_SUMMARY_UPGRADE_BATCH_TOKENS", 100)
    svc.ai_chat_service._upgrade_conversation_summary(conversation_id=conv, user_id=7, reset_seq=0)
    row = _mapping(env, conv, 7)
    assert int(row.summary_llm_until_seq) == 60
    assert len(calls) > 1  # split actually happened
    for batch in calls:
        assert sum(svc._estimated_tokens(line) for line in batch) <= 100
    folded = "\n".join(line for batch in calls for line in batch)
    assert "msg-0060" in folded and "FACT-END-gamma" in folded


def test_metrics_reported_after_process(env, monkeypatch):
    conv = f"conv-{uuid.uuid4().hex[:6]}"
    _seed(env, conversation_id=conv, user_id=7, count=40)
    monkeypatch.setattr(svc.smart_memory, "summarize", _fake_summarize([]))
    svc._pending_summary_upgrades[(conv, 7)] = (0, 0.0, time.monotonic())
    svc.ai_chat_service.process_pending_summary_upgrade()
    m = svc.ai_chat_service.get_summary_upgrade_metrics()
    assert m["completed"] == 1
    assert m["llm_calls"] >= 1
    assert m["messages_folded"] == 40
    assert m["total_tokens"] >= 1
    assert m["duration_ms_total"] >= 0
    assert m["pending"] == 0 and m["in_flight"] == 0


def test_background_flag_default_off():
    # Flag consistency gate: service default must be OFF until the
    # production gate passes (worker reads the same env with default False).
    import os
    if "AI_SUMMARY_BACKGROUND_ENABLED" not in os.environ:
        assert svc.AI_SUMMARY_BACKGROUND_ENABLED is False
