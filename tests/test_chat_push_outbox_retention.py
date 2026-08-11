"""Stage 1: chat_push_outbox retention worker semantics."""
from __future__ import annotations

import importlib
import logging
import sys
import threading
import time
from datetime import datetime, timedelta, timezone
from pathlib import Path
from types import SimpleNamespace

import pytest
from sqlalchemy import func, select, text


PROJECT_ROOT = Path(__file__).resolve().parents[1]
WEB_ROOT = PROJECT_ROOT / "WEB-itinvent"
if str(WEB_ROOT) not in sys.path:
    sys.path.insert(0, str(WEB_ROOT))

chat_db_module = importlib.import_module("backend.chat.db")
chat_models_module = importlib.import_module("backend.chat.models")
retention_module = importlib.import_module("backend.chat.push_outbox_retention_service")
hub_service_module = importlib.import_module("backend.services.hub_service")
chat_service_module = importlib.import_module("backend.chat.service")


def _raw_user(user_id: int, username: str, full_name: str, role: str = "operator") -> dict:
    return {
        "id": user_id,
        "username": username,
        "full_name": full_name,
        "role": role,
        "is_active": True,
        "use_custom_permissions": False,
        "custom_permissions": [],
        "permissions": [],
    }


@pytest.fixture()
def retention_env(temp_dir, monkeypatch):
    raw_users = {
        1: _raw_user(1, "author", "Task Author"),
        2: _raw_user(2, "assignee", "Task Assignee"),
    }
    users = list(raw_users.values())
    users_by_id = dict(raw_users)
    store = SimpleNamespace(
        db_path=str(Path(temp_dir) / "hub.sqlite3"),
        data_dir=str(Path(temp_dir) / "hub-data"),
    )
    Path(store.data_dir).mkdir(parents=True, exist_ok=True)

    monkeypatch.setattr(hub_service_module, "get_local_store", lambda: store)
    monkeypatch.setattr(hub_service_module, "is_app_database_configured", lambda: False)
    monkeypatch.setattr(hub_service_module.user_service, "list_users", lambda: list(users))
    monkeypatch.setattr(hub_service_module.user_service, "get_by_id", lambda user_id: users_by_id.get(int(user_id)))
    monkeypatch.setattr(chat_service_module.user_service, "list_users", lambda: list(users))
    monkeypatch.setattr(chat_service_module.user_service, "get_by_id", lambda user_id: users_by_id.get(int(user_id)))
    monkeypatch.setattr(
        chat_service_module.user_service,
        "get_users_map_by_ids",
        lambda user_ids: {int(user_id): users_by_id.get(int(user_id)) for user_id in list(user_ids or [])},
    )
    monkeypatch.setattr(chat_service_module.user_service, "to_public_user", lambda raw: dict(raw))
    monkeypatch.setattr(chat_service_module, "hub_service", hub_service_module.HubService())

    chat_db_module._engine = None
    chat_db_module._session_factory = None
    if hasattr(chat_db_module, "_engines"):
        chat_db_module._engines.clear()
    if hasattr(chat_db_module, "_session_factories"):
        chat_db_module._session_factories.clear()
    monkeypatch.setattr(chat_db_module.config.chat, "enabled", True, raising=False)
    monkeypatch.setattr(
        chat_db_module.config.chat,
        "database_url",
        f"sqlite:///{Path(temp_dir) / 'chat.sqlite3'}",
        raising=False,
    )
    monkeypatch.setattr(chat_db_module.config.chat, "pool_size", 5, raising=False)
    monkeypatch.setattr(chat_db_module.config.chat, "max_overflow", 10, raising=False)

    monkeypatch.setenv("CHAT_PUSH_OUTBOX_CLEANUP_ENABLED", "true")
    monkeypatch.setenv("CHAT_PUSH_OUTBOX_CLEANUP_DRY_RUN", "false")
    monkeypatch.setenv("CHAT_PUSH_OUTBOX_NO_SUBSCRIPTIONS_DAYS", "7")
    monkeypatch.setenv("CHAT_PUSH_OUTBOX_SUPPRESSED_DAYS", "14")
    monkeypatch.setenv("CHAT_PUSH_OUTBOX_SENT_DAYS", "30")
    monkeypatch.setenv("CHAT_PUSH_OUTBOX_FAILED_DAYS", "30")
    monkeypatch.setenv("CHAT_PUSH_OUTBOX_MAX_ATTEMPTS", "8")
    # Prefer unset FAILED_MIN so retention inherits MAX_ATTEMPTS; keep equal if set.
    monkeypatch.delenv("CHAT_PUSH_OUTBOX_FAILED_MIN_ATTEMPTS", raising=False)
    monkeypatch.setenv("CHAT_PUSH_OUTBOX_CLEANUP_BATCH_SIZE", "50")
    monkeypatch.setenv("CHAT_PUSH_OUTBOX_CLEANUP_MAX_BATCHES", "20")
    monkeypatch.setenv("CHAT_PUSH_OUTBOX_CLEANUP_MAX_RUNTIME_SECONDS", "30")
    monkeypatch.setenv("CHAT_PUSH_OUTBOX_CLEANUP_BATCH_PAUSE_MS", "0")
    monkeypatch.setenv("CHAT_PUSH_OUTBOX_CLEANUP_ERROR_BUDGET", "3")

    service = chat_service_module.ChatService()
    conversation = service.create_direct_conversation(current_user_id=1, peer_user_id=2)
    retention = retention_module.ChatPushOutboxRetentionService()
    yield {
        "service": service,
        "conversation": conversation,
        "retention": retention,
        "module": retention_module,
    }
    chat_db_module._engine = None
    chat_db_module._session_factory = None
    if hasattr(chat_db_module, "_engines"):
        chat_db_module._engines.clear()
    if hasattr(chat_db_module, "_session_factories"):
        chat_db_module._session_factories.clear()


def _days_ago(days: float) -> datetime:
    return datetime.now(timezone.utc) - timedelta(days=days)


def _insert_job(
    *,
    conversation_id: str,
    status: str,
    created_at: datetime,
    attempt_count: int = 0,
    message_id: str | None = None,
    recipient_user_id: int = 2,
    updated_at: datetime | None = None,
) -> int:
    ChatPushOutbox = chat_models_module.ChatPushOutbox
    mid = message_id or f"msg-{status}-{created_at.timestamp()}-{recipient_user_id}"
    done_at = updated_at or created_at
    with chat_db_module.chat_session() as session:
        job = ChatPushOutbox(
            message_id=mid[:36],
            conversation_id=conversation_id,
            recipient_user_id=recipient_user_id,
            channel="chat",
            is_mention=False,
            title="t",
            body="b",
            status=status,
            attempt_count=attempt_count,
            next_attempt_at=done_at,
            created_at=created_at,
            updated_at=done_at,
        )
        session.add(job)
        session.flush()
        job_id = int(job.id)
    return job_id


def _count(**filters) -> int:
    ChatPushOutbox = chat_models_module.ChatPushOutbox
    with chat_db_module.chat_session() as session:
        stmt = select(func.count()).select_from(ChatPushOutbox)
        for key, value in filters.items():
            stmt = stmt.where(getattr(ChatPushOutbox, key) == value)
        return int(session.execute(stmt).scalar_one())


def _exists(job_id: int) -> bool:
    ChatPushOutbox = chat_models_module.ChatPushOutbox
    with chat_db_module.chat_session() as session:
        return session.get(ChatPushOutbox, job_id) is not None


def test_old_no_subscriptions_eligible(retention_env):
    conv = retention_env["conversation"]["id"]
    old_id = _insert_job(conversation_id=conv, status="no_subscriptions", created_at=_days_ago(8))
    retention_env["retention"].run_once(dry_run=False, acquire_lock=False, force_enabled=True)
    assert not _exists(old_id)


def test_fresh_no_subscriptions_kept(retention_env):
    conv = retention_env["conversation"]["id"]
    fresh_id = _insert_job(conversation_id=conv, status="no_subscriptions", created_at=_days_ago(2))
    retention_env["retention"].run_once(dry_run=False, acquire_lock=False, force_enabled=True)
    assert _exists(fresh_id)


def test_old_suppressed_eligible(retention_env):
    conv = retention_env["conversation"]["id"]
    old_id = _insert_job(conversation_id=conv, status="suppressed", created_at=_days_ago(15))
    retention_env["retention"].run_once(dry_run=False, acquire_lock=False, force_enabled=True)
    assert not _exists(old_id)


def test_fresh_suppressed_kept(retention_env):
    conv = retention_env["conversation"]["id"]
    fresh_id = _insert_job(conversation_id=conv, status="suppressed", created_at=_days_ago(3))
    retention_env["retention"].run_once(dry_run=False, acquire_lock=False, force_enabled=True)
    assert _exists(fresh_id)


def test_old_sent_eligible(retention_env):
    conv = retention_env["conversation"]["id"]
    old_id = _insert_job(conversation_id=conv, status="sent", created_at=_days_ago(31))
    retention_env["retention"].run_once(dry_run=False, acquire_lock=False, force_enabled=True)
    assert not _exists(old_id)


def test_fresh_sent_kept(retention_env):
    conv = retention_env["conversation"]["id"]
    fresh_id = _insert_job(conversation_id=conv, status="sent", created_at=_days_ago(10))
    retention_env["retention"].run_once(dry_run=False, acquire_lock=False, force_enabled=True)
    assert _exists(fresh_id)


def test_failed_requires_age_and_attempts(retention_env):
    conv = retention_env["conversation"]["id"]
    old_low = _insert_job(
        conversation_id=conv, status="failed", created_at=_days_ago(40), attempt_count=3, message_id="fail-low"
    )
    old_ok = _insert_job(
        conversation_id=conv, status="failed", created_at=_days_ago(40), attempt_count=8, message_id="fail-ok"
    )
    fresh_ok = _insert_job(
        conversation_id=conv, status="failed", created_at=_days_ago(5), attempt_count=8, message_id="fail-fresh"
    )
    retention_env["retention"].run_once(dry_run=False, acquire_lock=False, force_enabled=True)
    assert _exists(old_low)
    assert not _exists(old_ok)
    assert _exists(fresh_ok)


@pytest.mark.parametrize("status", ["pending", "queued", "processing"])
def test_active_statuses_never_deleted(retention_env, status):
    conv = retention_env["conversation"]["id"]
    job_id = _insert_job(conversation_id=conv, status=status, created_at=_days_ago(400), attempt_count=99)
    retention_env["retention"].run_once(dry_run=False, acquire_lock=False, force_enabled=True)
    assert _exists(job_id)


def test_unknown_status_never_deleted(retention_env):
    conv = retention_env["conversation"]["id"]
    job_id = _insert_job(conversation_id=conv, status="weird_status", created_at=_days_ago(400))
    retention_env["retention"].run_once(dry_run=False, acquire_lock=False, force_enabled=True)
    assert _exists(job_id)


def test_boundary_retention_time(retention_env):
    conv = retention_env["conversation"]["id"]
    # Strict older-than: created_at < (now - 7d). Equal/newer cutoff stays.
    now = datetime.now(timezone.utc)
    keep_id = _insert_job(
        conversation_id=conv,
        status="no_subscriptions",
        created_at=now - timedelta(days=7) + timedelta(seconds=30),
        message_id="boundary-keep",
    )
    older_id = _insert_job(
        conversation_id=conv,
        status="no_subscriptions",
        created_at=now - timedelta(days=7) - timedelta(seconds=30),
        message_id="boundary-old",
    )
    retention_env["retention"].run_once(dry_run=False, acquire_lock=False, force_enabled=True)
    assert _exists(keep_id)
    assert not _exists(older_id)


def test_timezone_aware_timestamps(retention_env):
    conv = retention_env["conversation"]["id"]
    # Naive UTC-equivalent older stamp should still be handled via ORM aware columns.
    aware = datetime.now(timezone.utc) - timedelta(days=10)
    job_id = _insert_job(conversation_id=conv, status="no_subscriptions", created_at=aware)
    retention_env["retention"].run_once(dry_run=False, acquire_lock=False, force_enabled=True)
    assert not _exists(job_id)


def test_batch_limit(retention_env, monkeypatch):
    conv = retention_env["conversation"]["id"]
    monkeypatch.setenv("CHAT_PUSH_OUTBOX_CLEANUP_BATCH_SIZE", "2")
    monkeypatch.setenv("CHAT_PUSH_OUTBOX_CLEANUP_MAX_BATCHES", "1")
    for i in range(5):
        _insert_job(
            conversation_id=conv,
            status="no_subscriptions",
            created_at=_days_ago(20),
            message_id=f"batch-{i}",
            recipient_user_id=2,
        )
    cfg = retention_env["retention"].get_config()
    result = retention_env["retention"].run_once(
        config=cfg, dry_run=False, acquire_lock=False, force_enabled=True
    )
    assert result["batches"] == 1
    assert result["rows_deleted"] == 2
    assert result["stop_reason"] == "max_batches"
    assert _count(status="no_subscriptions") == 3


def test_max_batches(retention_env, monkeypatch):
    conv = retention_env["conversation"]["id"]
    monkeypatch.setenv("CHAT_PUSH_OUTBOX_CLEANUP_BATCH_SIZE", "2")
    monkeypatch.setenv("CHAT_PUSH_OUTBOX_CLEANUP_MAX_BATCHES", "2")
    for i in range(6):
        _insert_job(
            conversation_id=conv,
            status="sent",
            created_at=_days_ago(40),
            message_id=f"mb-{i}",
        )
    cfg = retention_env["retention"].get_config()
    result = retention_env["retention"].run_once(
        config=cfg, dry_run=False, acquire_lock=False, force_enabled=True
    )
    assert result["batches"] == 2
    assert result["rows_deleted"] == 4
    assert result["stop_reason"] == "max_batches"


def test_max_runtime(retention_env, monkeypatch):
    conv = retention_env["conversation"]["id"]
    monkeypatch.setenv("CHAT_PUSH_OUTBOX_CLEANUP_BATCH_SIZE", "1")
    monkeypatch.setenv("CHAT_PUSH_OUTBOX_CLEANUP_MAX_BATCHES", "100")
    monkeypatch.setenv("CHAT_PUSH_OUTBOX_CLEANUP_MAX_RUNTIME_SECONDS", "1")
    monkeypatch.setenv("CHAT_PUSH_OUTBOX_CLEANUP_BATCH_PAUSE_MS", "600")
    for i in range(5):
        _insert_job(
            conversation_id=conv,
            status="sent",
            created_at=_days_ago(40),
            message_id=f"rt-{i}",
        )
    cfg = retention_env["retention"].get_config()
    started = time.perf_counter()
    result = retention_env["retention"].run_once(
        config=cfg, dry_run=False, acquire_lock=False, force_enabled=True
    )
    assert result["stop_reason"] in {"max_runtime", "max_batches"}
    assert time.perf_counter() - started < 5


def test_error_budget_stops(retention_env, monkeypatch):
    retention = retention_env["retention"]
    monkeypatch.setenv("CHAT_PUSH_OUTBOX_CLEANUP_ERROR_BUDGET", "2")
    cfg = retention.get_config()
    calls = {"n": 0}

    def boom(*_a, **_k):
        calls["n"] += 1
        raise RuntimeError("synthetic_batch_error")

    monkeypatch.setattr(retention, "_delete_one_fair_batch", boom)
    monkeypatch.setattr(retention, "_use_postgres", lambda: False)
    result = retention.run_once(config=cfg, dry_run=False, acquire_lock=False, force_enabled=True)
    assert result["stop_reason"] == "error_budget"
    assert calls["n"] >= 2


def test_dry_run_does_not_mutate(retention_env):
    conv = retention_env["conversation"]["id"]
    _insert_job(conversation_id=conv, status="no_subscriptions", created_at=_days_ago(20))
    before = _count()
    report = retention_env["retention"].dry_run_report()
    assert report["eligible_rows_exact"] >= 1
    assert _count() == before
    result = retention_env["retention"].run_once(dry_run=True, acquire_lock=False)
    assert result["stop_reason"] == "dry_run_complete"
    assert _count() == before


def test_second_instance_skips_lock(retention_env, monkeypatch):
    retention = retention_env["retention"]
    cfg = retention.get_config()

    class FakeConn:
        def __init__(self, acquired: bool):
            self.acquired = acquired
            self.unlocked = False

        def execute(self, stmt, params=None):
            sql = str(stmt)
            if "pg_try_advisory_lock" in sql:
                return SimpleNamespace(scalar=lambda: self.acquired)
            if "pg_advisory_unlock" in sql:
                self.unlocked = True
                return SimpleNamespace(scalar=lambda: True)
            return SimpleNamespace(scalar=lambda: None)

        def commit(self):
            return None

        def close(self):
            return None

    queue = [FakeConn(False)]

    class FakeEngine:
        dialect = SimpleNamespace(name="postgresql")

        def connect(self):
            return queue.pop(0)

    monkeypatch.setattr(retention, "_engine", lambda: FakeEngine())
    monkeypatch.setattr(retention, "_use_postgres", lambda: True)
    second = retention.run_once(config=cfg, dry_run=False, acquire_lock=True, force_enabled=True)
    assert second["stop_reason"] == "lock_skipped"


def test_lock_released_after_exception(retention_env, monkeypatch):
    retention = retention_env["retention"]
    cfg = retention.get_config()
    state = {"unlocked": False}

    class FakeConn:
        def execute(self, stmt, params=None):
            sql = str(stmt)
            if "pg_try_advisory_lock" in sql:
                return SimpleNamespace(scalar=lambda: True)
            if "pg_advisory_unlock" in sql:
                state["unlocked"] = True
                return SimpleNamespace(scalar=lambda: True)
            return SimpleNamespace(scalar=lambda: None)

        def commit(self):
            return None

        def close(self):
            return None

        def begin(self):
            raise RuntimeError("boom-in-batch")

    class FakeEngine:
        dialect = SimpleNamespace(name="postgresql")

        def connect(self):
            return FakeConn()

    monkeypatch.setattr(retention, "_engine", lambda: FakeEngine())
    monkeypatch.setattr(retention, "_use_postgres", lambda: True)

    def exploding(**_k):
        raise RuntimeError("boom-in-batch")

    monkeypatch.setattr(retention, "_delete_one_fair_batch", exploding)
    monkeypatch.setenv("CHAT_PUSH_OUTBOX_CLEANUP_ERROR_BUDGET", "1")
    cfg = retention.get_config()
    result = retention.run_once(config=cfg, dry_run=False, acquire_lock=True, force_enabled=True)
    assert result["stop_reason"] == "error_budget"
    assert state["unlocked"] is True


def test_idempotent_rerun(retention_env):
    conv = retention_env["conversation"]["id"]
    _insert_job(conversation_id=conv, status="no_subscriptions", created_at=_days_ago(20))
    first = retention_env["retention"].run_once(dry_run=False, acquire_lock=False, force_enabled=True)
    second = retention_env["retention"].run_once(dry_run=False, acquire_lock=False, force_enabled=True)
    assert first["rows_deleted"] >= 1
    assert second["rows_deleted"] == 0
    assert second["stop_reason"] == "no_rows"


def test_graceful_shutdown(retention_env, monkeypatch):
    conv = retention_env["conversation"]["id"]
    monkeypatch.setenv("CHAT_PUSH_OUTBOX_CLEANUP_BATCH_SIZE", "1")
    monkeypatch.setenv("CHAT_PUSH_OUTBOX_CLEANUP_MAX_BATCHES", "10")
    monkeypatch.setenv("CHAT_PUSH_OUTBOX_CLEANUP_BATCH_PAUSE_MS", "200")
    for i in range(4):
        _insert_job(
            conversation_id=conv,
            status="sent",
            created_at=_days_ago(40),
            message_id=f"sh-{i}",
        )
    stop = {"flag": False}

    def should_stop():
        return stop["flag"]

    original = retention_env["retention"]._delete_one_fair_batch

    def wrapped(**kwargs):
        result = original(**kwargs)
        stop["flag"] = True
        return result

    monkeypatch.setattr(retention_env["retention"], "_delete_one_fair_batch", wrapped)
    cfg = retention_env["retention"].get_config()
    result = retention_env["retention"].run_once(
        config=cfg,
        dry_run=False,
        acquire_lock=False,
        force_enabled=True,
        should_stop=should_stop,
    )
    assert result["stop_reason"] == "shutdown"
    assert result["rows_deleted"] >= 1


def test_invalid_config_fail_closed(retention_env, monkeypatch):
    monkeypatch.setenv("CHAT_PUSH_OUTBOX_CLEANUP_BATCH_SIZE", "0")
    with pytest.raises(retention_module.PushOutboxRetentionConfigError):
        retention_env["retention"].get_config()
    result = retention_env["retention"].run_once(dry_run=False, acquire_lock=False, force_enabled=True)
    assert result["stop_reason"] == "error"
    assert result["rows_deleted"] == 0


def test_mixed_batch_keeps_active(retention_env, monkeypatch):
    conv = retention_env["conversation"]["id"]
    monkeypatch.setenv("CHAT_PUSH_OUTBOX_CLEANUP_BATCH_SIZE", "50")
    active_id = _insert_job(conversation_id=conv, status="queued", created_at=_days_ago(400), message_id="mix-q")
    old_id = _insert_job(
        conversation_id=conv, status="no_subscriptions", created_at=_days_ago(20), message_id="mix-old"
    )
    retention_env["retention"].run_once(dry_run=False, acquire_lock=False, force_enabled=True)
    assert _exists(active_id)
    assert not _exists(old_id)


def test_logs_do_not_contain_user_content(retention_env, caplog):
    conv = retention_env["conversation"]["id"]
    secret_title = "SECRET_TITLE_SHOULD_NOT_LOG"
    secret_body = "SECRET_BODY_SHOULD_NOT_LOG"
    ChatPushOutbox = chat_models_module.ChatPushOutbox
    with chat_db_module.chat_session() as session:
        session.add(
            ChatPushOutbox(
                message_id="log-check-1",
                conversation_id=conv,
                recipient_user_id=2,
                channel="chat",
                is_mention=False,
                title=secret_title,
                body=secret_body,
                status="no_subscriptions",
                attempt_count=0,
                next_attempt_at=_days_ago(20),
                created_at=_days_ago(20),
                updated_at=_days_ago(20),
            )
        )
    with caplog.at_level(logging.INFO, logger="backend.chat.push_outbox.retention"):
        retention_env["retention"].run_once(dry_run=False, acquire_lock=False, force_enabled=True)
    joined = "\n".join(r.message for r in caplog.records)
    assert secret_title not in joined
    assert secret_body not in joined
    assert "recipient_user_id=2" not in joined


def test_disabled_without_force(retention_env, monkeypatch):
    monkeypatch.setenv("CHAT_PUSH_OUTBOX_CLEANUP_ENABLED", "false")
    monkeypatch.setenv("CHAT_PUSH_OUTBOX_CLEANUP_DRY_RUN", "false")
    cfg = retention_env["retention"].get_config()
    result = retention_env["retention"].run_once(config=cfg, dry_run=False, acquire_lock=False, force_enabled=False)
    assert result["stop_reason"] == "disabled"


def test_uses_updated_at_not_created_at(retention_env):
    """Old created_at but fresh updated_at (late completion) must be kept."""
    conv = retention_env["conversation"]["id"]
    keep_id = _insert_job(
        conversation_id=conv,
        status="no_subscriptions",
        created_at=_days_ago(40),
        updated_at=_days_ago(2),
        message_id="ua-keep",
    )
    del_id = _insert_job(
        conversation_id=conv,
        status="no_subscriptions",
        created_at=_days_ago(40),
        updated_at=_days_ago(10),
        message_id="ua-del",
    )
    retention_env["retention"].run_once(dry_run=False, acquire_lock=False, force_enabled=True)
    assert _exists(keep_id)
    assert not _exists(del_id)


def test_failed_min_attempts_mismatch_fail_closed(retention_env, monkeypatch):
    monkeypatch.setenv("CHAT_PUSH_OUTBOX_MAX_ATTEMPTS", "8")
    monkeypatch.setenv("CHAT_PUSH_OUTBOX_FAILED_MIN_ATTEMPTS", "3")
    with pytest.raises(retention_module.PushOutboxRetentionConfigError):
        retention_env["retention"].get_config()
    result = retention_env["retention"].run_once(dry_run=False, acquire_lock=False, force_enabled=True)
    assert result["stop_reason"] == "error"
    assert result["rows_deleted"] == 0


def test_failed_uses_delivery_max_attempts(retention_env, monkeypatch):
    conv = retention_env["conversation"]["id"]
    monkeypatch.setenv("CHAT_PUSH_OUTBOX_MAX_ATTEMPTS", "5")
    if "CHAT_PUSH_OUTBOX_FAILED_MIN_ATTEMPTS" in __import__("os").environ:
        monkeypatch.delenv("CHAT_PUSH_OUTBOX_FAILED_MIN_ATTEMPTS", raising=False)
    cfg = retention_env["retention"].get_config()
    assert cfg.failed_min_attempts == 5
    assert cfg.delivery_max_attempts == 5
    low = _insert_job(
        conversation_id=conv,
        status="failed",
        created_at=_days_ago(40),
        updated_at=_days_ago(40),
        attempt_count=4,
        message_id="fail-4",
    )
    ok = _insert_job(
        conversation_id=conv,
        status="failed",
        created_at=_days_ago(40),
        updated_at=_days_ago(40),
        attempt_count=5,
        message_id="fail-5",
    )
    retention_env["retention"].run_once(config=cfg, dry_run=False, acquire_lock=False, force_enabled=True)
    assert _exists(low)
    assert not _exists(ok)


def test_status_rotation_not_starvation(retention_env, monkeypatch):
    conv = retention_env["conversation"]["id"]
    monkeypatch.setenv("CHAT_PUSH_OUTBOX_CLEANUP_BATCH_SIZE", "1")
    monkeypatch.setenv("CHAT_PUSH_OUTBOX_CLEANUP_MAX_BATCHES", "4")
    for i in range(3):
        _insert_job(
            conversation_id=conv,
            status="no_subscriptions",
            created_at=_days_ago(20),
            updated_at=_days_ago(20),
            message_id=f"rot-ns-{i}",
        )
    _insert_job(
        conversation_id=conv,
        status="sent",
        created_at=_days_ago(40),
        updated_at=_days_ago(40),
        message_id="rot-sent",
    )
    cfg = retention_env["retention"].get_config()
    result = retention_env["retention"].run_once(
        config=cfg, dry_run=False, acquire_lock=False, force_enabled=True
    )
    assert result["rows_deleted"] == 4
    # Both statuses should appear when rotating fairly across batches.
    assert "no_subscriptions" in result["deleted_by_status"]
    assert "sent" in result["deleted_by_status"]


def test_advisory_lock_same_connection_for_batches(retention_env, monkeypatch):
    retention = retention_env["retention"]
    cfg = retention.get_config()
    calls = {"conn": None, "batch_conns": []}

    class FakeConn:
        def __init__(self):
            self.unlocked = False

        def execute(self, stmt, params=None):
            sql = str(stmt)
            if "pg_try_advisory_lock" in sql:
                return SimpleNamespace(scalar=lambda: True)
            if "pg_advisory_unlock" in sql:
                self.unlocked = True
                return SimpleNamespace(scalar=lambda: True)
            if "pg_locks" in sql and "NOT granted" in sql:
                return SimpleNamespace(scalar=lambda: 0)
            if "information_schema.tables" in sql:
                return SimpleNamespace(scalar=lambda: "public")
            if "min(updated_at)" in sql:
                return SimpleNamespace(scalar=lambda: None)
            return SimpleNamespace(mappings=lambda: SimpleNamespace(all=lambda: []), scalar=lambda: None)

        def commit(self):
            return None

        def close(self):
            return None

        def begin(self):
            class _Tx:
                def __enter__(self_inner):
                    return lock_conn

                def __exit__(self_inner, *args):
                    return False

            return _Tx()

    lock_conn = FakeConn()
    calls["conn"] = lock_conn

    class FakeEngine:
        dialect = SimpleNamespace(name="postgresql")

        def connect(self):
            return lock_conn

    monkeypatch.setattr(retention, "_engine", lambda: FakeEngine())
    monkeypatch.setattr(retention, "_use_postgres", lambda: True)

    def fake_batch(*, cfg, status, lock_conn):  # noqa: ARG001
        calls["batch_conns"].append(id(lock_conn))
        # One non-empty then empty
        if len(calls["batch_conns"]) == 1:
            return {"sent": 1}, 1.0
        return {}, 0.1

    monkeypatch.setattr(retention, "_delete_one_batch_postgres_for_status", fake_batch)
    monkeypatch.setenv("CHAT_PUSH_OUTBOX_CLEANUP_MAX_BATCHES", "5")
    cfg = retention.get_config()
    result = retention.run_once(config=cfg, dry_run=False, acquire_lock=True, force_enabled=True)
    assert result["lock_connection_id"] == id(lock_conn)
    assert calls["batch_conns"]
    assert all(cid == id(lock_conn) for cid in calls["batch_conns"])
    assert lock_conn.unlocked is True
