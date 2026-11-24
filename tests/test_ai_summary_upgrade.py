"""A8/P1: async summary upgrade — dedup, CAS, reset/advanced-seq safety."""
import sys
from pathlib import Path
from types import SimpleNamespace

import pytest

PROJECT_ROOT = Path(__file__).resolve().parents[1]
WEB_ROOT = PROJECT_ROOT / "WEB-itinvent"
if str(WEB_ROOT) not in sys.path:
    sys.path.insert(0, str(WEB_ROOT))

import backend.ai_chat.service as svc


class _FakeResult:
    def __init__(self, value):
        self._value = value

    def scalar_one_or_none(self):
        return self._value

    def scalars(self):
        return self

    def __iter__(self):
        return iter(self._value if isinstance(self._value, list) else [self._value])


class _FakeSession:
    def __init__(self, mapping=None, rows=None, updates=None, bot=None):
        self._mapping = mapping
        self._rows = rows or []
        self._updates = updates if updates is not None else []
        self._bot = bot

    def __enter__(self):
        return self

    def __exit__(self, *a):
        return False

    def execute(self, stmt, *a, **k):
        from sqlalchemy.sql import Update
        if isinstance(stmt, Update):
            self._updates.append(stmt)
            return _FakeResult(None)
        if self._rows:
            rows, self._rows = self._rows, []
            return _FakeResult(rows)
        return _FakeResult(self._mapping)

    def get(self, model, key):
        return self._bot


def _session_ctx(session):
    return lambda *a, **k: session


def _msg(seq, sender, body):
    return SimpleNamespace(conversation_seq=seq, sender_user_id=sender, body=body, is_deleted=False)


@pytest.fixture(autouse=True)
def _clear_pending():
    svc._pending_summary_upgrades.clear()
    yield
    svc._pending_summary_upgrades.clear()


def test_register_dedups_per_conversation_and_is_bounded():
    svc.ai_chat_service._register_pending_summary(conversation_id="c1", user_id=7, reset_seq=3)
    svc.ai_chat_service._register_pending_summary(conversation_id="c1", user_id=7, reset_seq=5)
    assert svc._pending_summary_upgrades == {("c1", 7): 5}
    for i in range(svc._PENDING_SUMMARY_MAX + 5):
        svc.ai_chat_service._register_pending_summary(conversation_id=f"cx{i}", user_id=1, reset_seq=0)
    assert len(svc._pending_summary_upgrades) <= svc._PENDING_SUMMARY_MAX


def test_upgrade_writes_llm_summary_under_cas(monkeypatch):
    mapping = SimpleNamespace(
        conversation_id="conv", user_id=7, context_reset_seq=2,
        summary_until_seq=20, bot_id="b1",
    )
    bot = SimpleNamespace(bot_user_id=99, title="AI", model="m")
    updates = []
    app_sess = _FakeSession(mapping=mapping, updates=updates, bot=bot)
    chat_sess = _FakeSession(rows=[_msg(10, 7, "первое"), _msg(15, 99, "ответ")])
    monkeypatch.setattr(svc, "app_session", _session_ctx(app_sess))
    monkeypatch.setattr(svc, "chat_session", _session_ctx(chat_sess))
    monkeypatch.setattr(
        svc.smart_memory, "summarize",
        lambda base, lines, model=None: ("LLM-SUMMARY", {"total_tokens": 10}),
    )

    svc.ai_chat_service._upgrade_conversation_summary(
        conversation_id="conv", user_id=7, reset_seq=2,
    )

    assert len(updates) == 1
    stmt = str(updates[0])
    assert "rolling_summary" in stmt
    # CAS guards: same reset_seq and the checkpoint captured at read time.
    assert "context_reset_seq" in stmt
    assert "summary_until_seq" in stmt


def test_upgrade_aborts_when_context_was_reset(monkeypatch):
    mapping = SimpleNamespace(
        conversation_id="conv", user_id=7, context_reset_seq=50,
        summary_until_seq=20, bot_id="b1",
    )
    updates = []
    monkeypatch.setattr(svc, "app_session", _session_ctx(_FakeSession(mapping=mapping, updates=updates)))
    svc.ai_chat_service._upgrade_conversation_summary(
        conversation_id="conv", user_id=7, reset_seq=2,
    )
    assert updates == []


def test_upgrade_aborts_when_checkpoint_regressed(monkeypatch):
    mapping = SimpleNamespace(
        conversation_id="conv", user_id=7, context_reset_seq=2,
        summary_until_seq=2, bot_id="b1",
    )
    updates = []
    monkeypatch.setattr(svc, "app_session", _session_ctx(_FakeSession(mapping=mapping, updates=updates)))
    svc.ai_chat_service._upgrade_conversation_summary(
        conversation_id="conv", user_id=7, reset_seq=2,
    )
    assert updates == []


def test_pending_processed_once_and_survives_failure(monkeypatch):
    svc._pending_summary_upgrades[("conv", 7)] = 2
    called = []
    monkeypatch.setattr(
        svc.ai_chat_service, "_upgrade_conversation_summary",
        lambda **kw: called.append(kw),
    )
    assert svc.ai_chat_service.process_pending_summary_upgrade() == 1
    assert called == [{"conversation_id": "conv", "user_id": 7, "reset_seq": 2}]
    assert svc._pending_summary_upgrades == {}

    svc._pending_summary_upgrades[("conv", 7)] = 2

    def _boom(**kw):
        raise RuntimeError("llm down")

    monkeypatch.setattr(svc.ai_chat_service, "_upgrade_conversation_summary", _boom)
    assert svc.ai_chat_service.process_pending_summary_upgrade() == 1
