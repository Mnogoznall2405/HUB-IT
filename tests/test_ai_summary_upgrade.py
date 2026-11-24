"""A8c2/P1: async summary upgrade — incremental LLM checkpoint, durability, CAS."""
import importlib
import sys
import time
import uuid
from datetime import datetime, timezone
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
    yield
    svc._pending_summary_upgrades.clear()
    svc._summary_upgrade_attempts.clear()
    svc._summary_suppressed_until.clear()


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
    return e


def _seed(env, *, conversation_id: str, user_id: int, count: int,
          reset_seq: int = 0, summary_until_seq: int | None = None,
          llm_until_seq: int = 0, rolling_summary: str = "FALLBACK",
          rolling_summary_llm: str = "", use_personal_memory: bool = True,
          deleted_seqs: set[int] | None = None) -> None:
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
        db.add(env.app_models.AppAiBotConversation(
            bot_id="bot-test", user_id=user_id, conversation_id=conversation_id,
            rolling_summary=rolling_summary,
            summary_until_seq=int(summary_until_seq if summary_until_seq is not None else count),
            context_reset_seq=int(reset_seq),
            rolling_summary_llm=rolling_summary_llm,
            summary_llm_until_seq=int(llm_until_seq),
            use_personal_memory=use_personal_memory,
            title_source="assistant", created_at=NOW, updated_at=NOW,
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
    assert svc._summary_suppressed_until[("conv", 7)] > time.monotonic()


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
    assert svc._summary_suppressed_until[(conv, 7)] > time.monotonic()


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
    svc._summary_suppressed_until[(conv_sup, 8)] = time.monotonic() + 3600
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
