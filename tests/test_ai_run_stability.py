"""A1: worker resilience — driver timeouts, bounded tool calls, liveness/watchdog.

Every scenario uses fakes/events — no real hangs, no external systems.
Unit-level tests are justified here: the failures they cover (thread hangs,
driver timeouts, watchdog false reaps) cannot be reproduced through the HTTP
boundary without real infrastructure stalls.
"""
from __future__ import annotations

import asyncio
import threading
import time
from contextlib import contextmanager
from datetime import datetime, timedelta, timezone

import pydantic
import pytest
from sqlalchemy import create_engine
from sqlalchemy.orm import Session

import conftest
from backend.ai_chat import service as service_module
from backend.ai_chat.tools import registry as registry_module
from backend.ai_chat.tools.base import AiTool, AiToolResult
from backend.ai_chat.tools.context import AiToolExecutionContext
from backend.ai_chat.tools.registry import (
    AiToolRegistry,
    ai_tool_executor_stats,
    ai_tool_leaked_count,
)
from backend.appdb.models import AppAiBot, AppAiBotConversation, AppAiBotRun, AppUser


@pytest.fixture(autouse=True)
def _fresh_tool_executor():
    """P0-1: executor is module-global — isolate capacity accounting per test."""
    registry_module._reset_tool_executor_state_for_tests()
    yield
    registry_module._reset_tool_executor_state_for_tests()


# --------------------------------------------------------------------------
# SQL Server scoped statement timeout (connection.py)
# --------------------------------------------------------------------------


class _FakePooledConn:
    def __init__(self) -> None:
        self.timeout = 0
        self.commits = 0
        self.rollbacks = 0

    def commit(self) -> None:
        self.commits += 1

    def rollback(self) -> None:
        self.rollbacks += 1


class _StubPool:
    def __init__(self, conn: _FakePooledConn) -> None:
        self.conn = conn
        self.released: list[_FakePooledConn] = []
        self.discarded: list[_FakePooledConn] = []

    def acquire(self) -> _FakePooledConn:
        return self.conn

    def release(self, conn) -> None:
        self.released.append(conn)

    def discard(self, conn) -> None:
        self.discarded.append(conn)


def _manager_with_pool(pool: _StubPool, **overrides):
    from backend.database.connection import DatabaseConnectionManager

    mgr = DatabaseConnectionManager.__new__(DatabaseConnectionManager)
    mgr._pool = pool
    mgr._query_timeout = overrides.get("query_timeout")
    return mgr


def test_scoped_query_timeout_applied_and_restored_before_release():
    conn = _FakePooledConn()
    conn.timeout = 0
    mgr = _manager_with_pool(_StubPool(conn), query_timeout=45)
    with mgr.get_connection() as c:
        assert c.timeout == 45
    assert conn.timeout == 0  # restored — pooled conn must not leak the AI timeout
    assert mgr._pool.released == [conn]
    assert mgr._pool.discarded == []


def test_contextvar_timeout_applies_only_inside_scope():
    from backend.database.connection import ai_sql_query_timeout, sql_query_timeout_scope

    conn = _FakePooledConn()
    mgr = _manager_with_pool(_StubPool(conn))
    with mgr.get_connection() as c:
        assert c.timeout == 0  # no scope -> driver default untouched
    token = ai_sql_query_timeout.set(33)
    try:
        with mgr.get_connection() as c:
            assert c.timeout == 33
    finally:
        ai_sql_query_timeout.reset(token)
    assert conn.timeout == 0
    with sql_query_timeout_scope(21):
        with mgr.get_connection() as c:
            assert c.timeout == 21
    assert conn.timeout == 0


def test_timeout_restore_failure_discards_connection():
    class _BadRestore(_FakePooledConn):
        _calls = 0

        def __init__(self) -> None:
            self._stored = 0
            self.commits = 0
            self.rollbacks = 0

        @property
        def timeout(self):
            return self._stored

        @timeout.setter
        def timeout(self, value):
            _BadRestore._calls += 1
            if _BadRestore._calls > 1:  # first set is the AI timeout; second is restore
                raise RuntimeError("driver gone")
            self._stored = value

    conn = _BadRestore()
    mgr = _manager_with_pool(_StubPool(conn), query_timeout=45)
    with mgr.get_connection():
        pass
    assert mgr._pool.discarded == [conn]
    assert mgr._pool.released == []


def test_sql_timeout_unreadable_fails_closed_before_execute():
    """P0-2: driver cannot even READ conn.timeout → abort before any SQL,
    connection discarded (never returned to the pool in an unknown state)."""
    from backend.database.connection import SqlStatementTimeoutUnsupportedError

    class _NoTimeout(_FakePooledConn):
        def __init__(self) -> None:
            self.commits = 0
            self.rollbacks = 0

        @property
        def timeout(self):
            raise RuntimeError("driver has no timeout")

        @timeout.setter
        def timeout(self, value):
            raise RuntimeError("driver has no timeout")

    conn = _NoTimeout()
    mgr = _manager_with_pool(_StubPool(conn), query_timeout=45)
    with pytest.raises(SqlStatementTimeoutUnsupportedError):
        with mgr.get_connection():
            pytest.fail("SQL must never execute without a verified timeout")
    assert mgr._pool.discarded == [conn]
    assert mgr._pool.released == []


def test_sql_timeout_unsettable_fails_closed():
    from backend.database.connection import SqlStatementTimeoutUnsupportedError

    class _ReadOnlyTimeout(_FakePooledConn):
        def __init__(self) -> None:
            self._stored = 0
            self.commits = 0
            self.rollbacks = 0

        @property
        def timeout(self):
            return self._stored

        @timeout.setter
        def timeout(self, value):
            raise RuntimeError("timeout read-only")

    conn = _ReadOnlyTimeout()
    mgr = _manager_with_pool(_StubPool(conn), query_timeout=45)
    with pytest.raises(SqlStatementTimeoutUnsupportedError):
        with mgr.get_connection():
            pytest.fail("SQL must never execute without a verified timeout")
    assert mgr._pool.discarded == [conn]


def test_sql_timeout_silently_ignored_fails_closed():
    """Driver accepts the set but reports a different value → fail closed."""
    from backend.database.connection import SqlStatementTimeoutUnsupportedError

    class _LyingTimeout(_FakePooledConn):
        @property
        def timeout(self):
            return 999  # driver claims a different value than what was set

        @timeout.setter
        def timeout(self, value):
            pass

    conn = _LyingTimeout()
    mgr = _manager_with_pool(_StubPool(conn), query_timeout=45)
    with pytest.raises(SqlStatementTimeoutUnsupportedError):
        with mgr.get_connection():
            pytest.fail("SQL must never execute without a verified timeout")
    assert mgr._pool.discarded == [conn]


def test_sql_timeout_restore_verify_mismatch_discards_connection():
    """Restore set succeeds but read-back differs → unknown state → discard."""
    class _RestoreMismatch(_FakePooledConn):
        _sets = 0

        def __init__(self) -> None:
            self.commits = 0
            self.rollbacks = 0

        @property
        def timeout(self):
            return 45 if _RestoreMismatch._sets < 2 else 777

        @timeout.setter
        def timeout(self, value):
            _RestoreMismatch._sets += 1

    conn = _RestoreMismatch()
    mgr = _manager_with_pool(_StubPool(conn), query_timeout=45)
    with mgr.get_connection():
        pass
    assert mgr._pool.discarded == [conn]
    assert mgr._pool.released == []


def test_next_request_gets_healthy_connection_after_discard():
    """A broken conn is discarded; the following request gets a fresh one."""
    from backend.database.connection import SqlStatementTimeoutUnsupportedError

    class _QueuePool(_StubPool):
        def __init__(self, conns) -> None:
            self.conns = list(conns)
            self.released = []
            self.discarded = []

        def acquire(self):
            return self.conns.pop(0)

    class _NoTimeout(_FakePooledConn):
        def __init__(self) -> None:
            self.commits = 0
            self.rollbacks = 0

        @property
        def timeout(self):
            raise RuntimeError("dead")

        @timeout.setter
        def timeout(self, value):
            raise RuntimeError("dead")

    bad, good = _NoTimeout(), _FakePooledConn()
    mgr = _manager_with_pool(_QueuePool([bad, good]), query_timeout=30)
    with pytest.raises(SqlStatementTimeoutUnsupportedError):
        with mgr.get_connection():
            pass
    with mgr.get_connection() as conn:
        assert conn is good
        assert conn.timeout == 30
    assert mgr._pool.released == [good]
    assert good.timeout == 0


def test_non_ai_path_never_touches_timeout_attribute():
    """P0-2: without a requested timeout the driver attribute is untouched —
    proves UI/API behavior is unchanged even for drivers lacking it."""

    class _BareConn:
        def __init__(self) -> None:
            self.commits = 0

        def commit(self):
            self.commits += 1

        def rollback(self):
            pass

    conn = _BareConn()  # no .timeout attribute at all
    mgr = _manager_with_pool(_StubPool(conn))
    with mgr.get_connection() as c:
        assert c is conn
    assert conn.commits == 1
    assert mgr._pool.released == [conn]


def test_get_db_accepts_optional_query_timeout(monkeypatch):
    from backend.database import connection as conn_module

    captured = {}
    monkeypatch.setattr(conn_module, "_get_connection_pool", lambda cs: _StubPool(_FakePooledConn()))
    mgr = conn_module.get_db("TEST-DB", query_timeout=15)
    assert mgr._query_timeout == 15
    mgr_default = conn_module.get_db("TEST-DB")
    assert mgr_default._query_timeout is None


# --------------------------------------------------------------------------
# LDAP driver timeouts (ldap_security.py)
# --------------------------------------------------------------------------


def test_ldap_factory_passes_connect_and_receive_timeouts(monkeypatch):
    from backend.services import ldap_security

    servers, connections = [], []

    class _FakeServer:
        def __init__(self, *args, **kwargs):
            self.kwargs = kwargs
            servers.append(self)

    class _FakeConnection:
        def __init__(self, server, *args, **kwargs):
            self.server = server
            self.kwargs = kwargs
            connections.append(self)

    monkeypatch.setattr(ldap_security, "Server", _FakeServer)
    monkeypatch.setattr(ldap_security, "Connection", _FakeConnection)
    monkeypatch.setenv("LDAP_SECURITY", "none")
    monkeypatch.setenv("LDAP_CONNECT_TIMEOUT", "7")
    monkeypatch.setenv("LDAP_RECEIVE_TIMEOUT", "44")

    conn = ldap_security.open_ldap_connection("dc.example", user="u", password="p")
    assert servers[0].kwargs["connect_timeout"] == 7.0
    assert connections[0].kwargs["receive_timeout"] == 44.0
    assert conn.kwargs["auto_bind"] is True

    monkeypatch.delenv("LDAP_CONNECT_TIMEOUT", raising=False)
    monkeypatch.delenv("LDAP_RECEIVE_TIMEOUT", raising=False)
    ldap_security.open_ldap_connection("dc.example")
    assert servers[-1].kwargs["connect_timeout"] == 10.0  # defaults
    assert connections[-1].kwargs["receive_timeout"] == 30.0


# --------------------------------------------------------------------------
# Bounded tool execution (registry.execute_bounded)
# --------------------------------------------------------------------------


def _tool_context(tool_ids) -> AiToolExecutionContext:
    return AiToolExecutionContext(
        bot_id="bot",
        bot_title="Bot",
        conversation_id="conv",
        run_id="run-1",
        user_id=2,
        user_payload={"role": "admin"},
        effective_database_id="ITINVENT",
        enabled_tools=list(tool_ids),
        tool_settings={"max_tool_calls_per_round": 5, "max_tool_rounds": 6},
    )


class _NoArgs(pydantic.BaseModel):
    pass


class _HangingTool(AiTool):
    tool_id = "a1.test.hang"
    description = "hangs"
    input_model = _NoArgs
    timeout_sec = 0.05

    def __init__(self, delay: float = 2.0, gate: threading.Event | None = None) -> None:
        self._delay = delay
        self._gate = gate
        self.started = threading.Event()

    def execute(self, *, context, args) -> AiToolResult:
        self.started.set()
        if self._gate is not None:
            self._gate.wait(timeout=self._delay)
        else:
            time.sleep(self._delay)
        return AiToolResult(tool_id=self.tool_id, ok=True, data={"done": True})


class _QuickTool(AiTool):
    tool_id = "a1.test.quick"
    input_model = _NoArgs

    def execute(self, *, context, args) -> AiToolResult:
        return AiToolResult(tool_id=self.tool_id, ok=True, data={"answer": 42})


def _make_registry(*tools: AiTool) -> AiToolRegistry:
    registry = AiToolRegistry()
    for tool in tools:
        registry.register(tool)
    return registry


def test_bounded_tool_call_returns_controlled_timeout_error():
    registry = _make_registry(_HangingTool(delay=2.0))
    context = _tool_context(["a1.test.hang"])
    before = ai_tool_leaked_count()
    started = time.perf_counter()
    result, audit_row = registry.execute_bounded(
        tool_id="a1.test.hang", raw_args={}, context=context
    )
    elapsed = time.perf_counter() - started
    assert elapsed < 1.5  # run was freed quickly; the abandoned thread finishes later
    assert result.ok is False
    assert "таймаут" in (result.error or "").lower() or "timeout" in (result.error or "").lower()
    assert result.data["diagnostic"]["error_code"] == "tool_timeout"
    assert audit_row["status"] == "error"
    assert audit_row["tool_id"] == "a1.test.hang"
    assert ai_tool_leaked_count() == before + 1


def test_executor_still_serves_calls_after_a_timeout():
    """The scenario from the task: hung calls must not starve new work."""
    registry = _make_registry(_HangingTool(delay=2.0), _QuickTool())
    context = _tool_context(["a1.test.hang", "a1.test.quick"])
    started = time.perf_counter()
    result, _ = registry.execute_bounded(tool_id="a1.test.hang", raw_args={}, context=context)
    assert result.ok is False
    quick, quick_audit = registry.execute_bounded(tool_id="a1.test.quick", raw_args={}, context=context)
    assert time.perf_counter() - started < 1.5
    assert quick.ok is True and quick.data == {"answer": 42}
    assert quick_audit["status"] == "ok"


def test_concurrent_hung_tools_do_not_block_independent_call():
    """4 hung tools (the PM2 concurrency scenario) + a 5th plain request."""
    hanging = [_HangingTool(delay=3.0) for _ in range(4)]
    hanging_ids = [f"a1.test.hang{i}" for i in range(4)]
    for tool, tool_id in zip(hanging, hanging_ids):
        tool.tool_id = tool_id  # AiTool attr is an instance-override ok
    quick = _QuickTool()
    registry = _make_registry(*hanging, quick)
    context = _tool_context(hanging_ids + ["a1.test.quick"])

    started = time.perf_counter()
    errors: list[BaseException] = []
    results: list[tuple] = []

    def call(tool_id: str) -> None:
        try:
            results.append(
                registry.execute_bounded(tool_id=tool_id, raw_args={}, context=context)
            )
        except BaseException as exc:  # noqa: BLE001
            errors.append(exc)

    threads = [threading.Thread(target=call, args=(tid,), daemon=True) for tid in hanging_ids]
    for thread in threads:
        thread.start()
    quick_thread = threading.Thread(target=call, args=("a1.test.quick",), daemon=True)
    quick_thread.start()
    for thread in [*threads, quick_thread]:
        thread.join(timeout=10)

    assert not errors
    assert time.perf_counter() - started < 2.0
    ok_map = {tool_id: ok for (tool_id, ok) in [(r.tool_id, r.ok) for r, _a in results]}
    assert ok_map["a1.test.quick"] is True
    for tid in hanging_ids:
        assert ok_map[tid] is False  # controlled timeout, not a hang


def _saturating_tool(tool_id: str, gate: threading.Event, timeout_sec: float = 30.0):
    tool = _HangingTool(delay=60.0, gate=gate)
    tool.tool_id = tool_id
    tool.timeout_sec = timeout_sec
    return tool


def _wait_for(predicate, timeout: float = 5.0, step: float = 0.01) -> bool:
    deadline = time.time() + timeout
    while time.time() < deadline:
        if predicate():
            return True
        time.sleep(step)
    return predicate()


def test_executor_saturation_rejects_and_recovers(monkeypatch):
    """P0-1: workers+pending slots filled with blocked tools → the next call is
    rejected (distinct error, NEVER started), then capacity fully recovers."""
    monkeypatch.setenv("AI_TOOL_EXECUTOR_WORKERS", "4")
    monkeypatch.setenv("AI_TOOL_EXECUTOR_MAX_PENDING", "2")
    gate = threading.Event()
    tools = [_saturating_tool(f"a1.test.sat{i}", gate) for i in range(6)]
    quick = _QuickTool()
    registry = _make_registry(*tools, quick)
    context = _tool_context([t.tool_id for t in tools] + ["a1.test.quick"])

    errors: list[BaseException] = []

    def call(tool_id: str) -> None:
        try:
            registry.execute_bounded(tool_id=tool_id, raw_args={}, context=context)
        except BaseException as exc:  # noqa: BLE001
            errors.append(exc)

    threads = [threading.Thread(target=call, args=(t.tool_id,), daemon=True) for t in tools]
    for thread in threads:
        thread.start()
    assert _wait_for(lambda: ai_tool_executor_stats()["in_flight"] == 6)
    stats = ai_tool_executor_stats()
    assert stats["capacity"] == 6 and stats["submitted_total"] == 6

    # 7th call — rejected synchronously, never queued, never ran.
    rejected = _saturating_tool("a1.test.sat6", gate)
    registry.register(rejected)
    context.enabled_tools.append("a1.test.sat6")
    result, audit = registry.execute_bounded(tool_id="a1.test.sat6", raw_args={}, context=context)
    assert result.ok is False
    assert result.data["diagnostic"]["error_code"] == "tool_capacity_exceeded"
    assert "не выполнялся" in result.data["diagnostic"]["message"]
    assert not rejected.started.is_set()  # guaranteed: task never started
    assert ai_tool_executor_stats()["rejected_total"] == 1
    # repeats still rejected — counter grows, queue does not
    registry.execute_bounded(tool_id="a1.test.sat6", raw_args={}, context=context)
    stats = ai_tool_executor_stats()
    assert stats["rejected_total"] == 2 and stats["in_flight"] == 6
    assert stats["degraded"] is True

    # Release — everything drains, capacity returns to zero, new calls work.
    gate.set()
    for thread in threads:
        thread.join(timeout=15)
    assert _wait_for(lambda: ai_tool_executor_stats()["in_flight"] == 0)
    ok, _ = registry.execute_bounded(tool_id="a1.test.quick", raw_args={}, context=context)
    assert ok.ok is True and ok.data == {"answer": 42}


def test_leaked_gauge_returns_to_zero_when_abandoned_thread_finishes(monkeypatch):
    """P1-1: leaked_now is a GAUGE — it drops when the leaked thread really ends."""
    monkeypatch.setenv("AI_TOOL_EXECUTOR_WORKERS", "2")
    gate = threading.Event()
    tool = _saturating_tool("a1.test.leak", gate, timeout_sec=0.05)
    registry = _make_registry(tool)
    context = _tool_context(["a1.test.leak"])
    result, _ = registry.execute_bounded(tool_id="a1.test.leak", raw_args={}, context=context)
    assert result.data["diagnostic"]["error_code"] == "tool_timeout"
    stats = ai_tool_executor_stats()
    assert stats["leaked_now"] == 1 and stats["leaked_total"] == 1
    assert stats["in_flight"] == 1  # accounting capacity still held by the live thread
    gate.set()
    assert _wait_for(lambda: ai_tool_executor_stats()["in_flight"] == 0)
    stats = ai_tool_executor_stats()
    assert stats["leaked_now"] == 0  # released on ACTUAL completion, not on timeout
    assert stats["leaked_total"] == 1  # cumulative evidence is kept


def test_queued_timeout_is_reported_as_never_started_not_unknown(monkeypatch):
    """P0-1: a call that timed out while still QUEUED was cancelled before it
    ran — the result must say it never executed, not 'outcome unknown'."""
    monkeypatch.setenv("AI_TOOL_EXECUTOR_WORKERS", "1")
    monkeypatch.setenv("AI_TOOL_EXECUTOR_MAX_PENDING", "8")
    gate = threading.Event()
    blocker = _saturating_tool("a1.test.blocker", gate)
    queued = _saturating_tool("a1.test.queued", gate, timeout_sec=0.05)
    registry = _make_registry(blocker, queued)
    context = _tool_context(["a1.test.blocker", "a1.test.queued"])
    errors: list[BaseException] = []
    holder = threading.Thread(
        target=lambda: registry.execute_bounded(
            tool_id="a1.test.blocker", raw_args={}, context=context
        ),
        daemon=True,
    )
    holder.start()
    assert blocker.started.wait(2.0)
    result, _ = registry.execute_bounded(tool_id="a1.test.queued", raw_args={}, context=context)
    assert result.ok is False
    assert result.data["diagnostic"]["error_code"] == "tool_queue_timeout"
    assert "не выполнялась" in result.data["diagnostic"]["message"]
    assert not queued.started.is_set()  # it really never ran
    stats = ai_tool_executor_stats()
    assert stats["leaked_now"] == 0 and stats["queue_timeout_total"] == 1
    gate.set()
    holder.join(timeout=15)
    assert _wait_for(lambda: ai_tool_executor_stats()["in_flight"] == 0)


def test_rejected_calls_do_not_accumulate_under_repeated_saturation(monkeypatch):
    """P0-1: repeated submits at full capacity must not grow queue/memory —
    every excess call is rejected immediately."""
    monkeypatch.setenv("AI_TOOL_EXECUTOR_WORKERS", "1")
    monkeypatch.setenv("AI_TOOL_EXECUTOR_MAX_PENDING", "0")
    gate = threading.Event()
    blocker = _saturating_tool("a1.test.blocker", gate)
    registry = _make_registry(blocker, _QuickTool())
    context = _tool_context(["a1.test.blocker", "a1.test.quick"])
    holder = threading.Thread(
        target=lambda: registry.execute_bounded(
            tool_id="a1.test.blocker", raw_args={}, context=context
        ),
        daemon=True,
    )
    holder.start()
    assert blocker.started.wait(2.0)
    assert _wait_for(lambda: ai_tool_executor_stats()["in_flight"] == 1)
    for _ in range(10):
        result, _ = registry.execute_bounded(
            tool_id="a1.test.quick", raw_args={}, context=context
        )
        assert result.data["diagnostic"]["error_code"] == "tool_capacity_exceeded"
    stats = ai_tool_executor_stats()
    assert stats["rejected_total"] == 10
    assert stats["in_flight"] == 1  # nothing queued — no unbounded growth
    gate.set()
    holder.join(timeout=15)


def test_unknown_tool_still_raises_validation_not_timeout():
    registry = _make_registry(_QuickTool())
    context = _tool_context(["a1.test.quick"])
    with pytest.raises(Exception):
        registry.execute_bounded(tool_id="a1.test.missing", raw_args={}, context=context)


def test_tool_call_timeout_integration_in_execute_tool_calls(monkeypatch):
    """Through the service path: a timed-out tool becomes an error payload,
    the run continues — and AiRunDeadlineExceeded would propagate instead."""
    svc = service_module.AiChatService()
    hanging = _HangingTool(delay=2.0)
    registry = _make_registry(hanging, _QuickTool())
    monkeypatch.setattr(service_module, "ai_tool_registry", registry)
    context = _tool_context(["a1.test.hang", "a1.test.quick"])
    started = time.perf_counter()
    results, traces = svc._execute_tool_calls(
        tool_calls=[{"tool_id": "a1.test.hang", "args": {}}],
        tool_context=context,
    )
    assert time.perf_counter() - started < 1.5
    assert len(results) == 1
    assert results[0]["ok"] is False
    assert results[0]["error"]
    assert traces[0]["status"] == "error"
    # run kept working — a second call answers immediately
    results2, _ = svc._execute_tool_calls(
        tool_calls=[{"tool_id": "a1.test.quick", "args": {}}],
        tool_context=context,
    )
    assert results2[0]["ok"] is True


# --------------------------------------------------------------------------
# Run heartbeat, deadline, cancel CAS, watchdog (service.py)
# --------------------------------------------------------------------------


@pytest.fixture
def database(tmp_path, monkeypatch):
    conftest.copy_app_metadata_schema(tmp_path / "stability.db")
    engine = create_engine(
        f"sqlite:///{tmp_path / 'stability.db'}",
        execution_options={"schema_translate_map": {"app": None, "system": None}},
    )

    @contextmanager
    def session():
        with Session(engine, expire_on_commit=False) as db:
            with db.begin():
                yield db

    monkeypatch.setattr(service_module, "app_session", session)
    svc = service_module.AiChatService()
    published = []
    monkeypatch.setattr(svc, "_publish_status_event", lambda **kwargs: published.append(kwargs))

    now = datetime.now(timezone.utc)
    with session() as db:
        db.add_all([
            AppUser(id=2, username="owner", role="admin"),
            AppAiBot(id="agent", slug="corp-assistant", title="Assistant"),
            AppAiBotConversation(bot_id="agent", user_id=2, conversation_id="conv"),
        ])
    yield session, svc, published, now
    engine.dispose()


def _add_run(session, *, run_id, status, updated_at, started_at=None, created_at=None):
    now = datetime.now(timezone.utc)
    with session() as db:
        db.add(AppAiBotRun(
            id=run_id,
            bot_id="agent",
            conversation_id="conv",
            user_id=2,
            trigger_message_id=f"m-{run_id}",
            status=status,
            started_at=started_at,
            created_at=created_at or now,
            updated_at=updated_at,
        ))


def test_checkpoint_heartbeat_refreshes_updated_at(database, monkeypatch):
    session, svc, _published, now = database
    old = now - timedelta(minutes=20)
    _add_run(session, run_id="r-live", status="running", updated_at=old,
             started_at=now - timedelta(seconds=30), created_at=old)
    monkeypatch.setenv("AI_RUN_TIMEOUT_SEC", "900")
    svc._raise_if_run_cancelled("r-live")
    with session() as db:
        run = db.get(AppAiBotRun, "r-live")
        assert service_module._as_utc(run.updated_at) > old + timedelta(minutes=19)


def test_run_deadline_raises_at_checkpoint(database, monkeypatch):
    session, svc, _published, now = database
    _add_run(session, run_id="r-old", status="running",
             updated_at=now - timedelta(seconds=5),
             started_at=now - timedelta(hours=2), created_at=now - timedelta(hours=2))
    monkeypatch.setenv("AI_RUN_TIMEOUT_SEC", "60")
    with pytest.raises(service_module.AiRunDeadlineExceeded):
        svc._raise_if_run_cancelled("r-old")


def test_cancelled_run_still_raises_cancelled_not_deadline(database, monkeypatch):
    session, svc, _published, now = database
    _add_run(session, run_id="r-cancelled", status="cancelled",
             updated_at=now, started_at=now - timedelta(hours=2))
    monkeypatch.setenv("AI_RUN_TIMEOUT_SEC", "60")
    with pytest.raises(service_module.AiRunCancelled):
        svc._raise_if_run_cancelled("r-cancelled")


def test_watchdog_queued_uses_longer_threshold(database, monkeypatch):
    session, svc, _published, now = database
    mid = now - timedelta(minutes=20)  # >stale_after(60s), <queued_stale(1800s)
    ancient = now - timedelta(hours=2)
    _add_run(session, run_id="q-backlog", status="queued", updated_at=mid, created_at=mid)
    _add_run(session, run_id="q-dead", status="queued", updated_at=ancient, created_at=ancient)
    _add_run(session, run_id="r-stale", status="running", updated_at=mid,
             started_at=mid, created_at=mid)
    monkeypatch.setenv("AI_RUN_WATCHDOG_QUEUED_STALE_SEC", "1800")
    result = svc.reap_stale_runs(stale_after_sec=60)
    assert sorted(result["reaped_run_ids"]) == ["q-dead", "r-stale"]
    with session() as db:
        assert db.get(AppAiBotRun, "q-backlog").status == "queued"  # backlog is not a hang
        assert db.get(AppAiBotRun, "q-dead").status == "failed"
        assert db.get(AppAiBotRun, "r-stale").status == "failed"


def test_watchdog_second_run_is_idempotent(database, monkeypatch):
    session, svc, published, now = database
    ancient = now - timedelta(hours=3)
    _add_run(session, run_id="r-old", status="running", updated_at=ancient,
             started_at=ancient, created_at=ancient)
    monkeypatch.setenv("AI_RUN_WATCHDOG_QUEUED_STALE_SEC", "1800")
    first = svc.reap_stale_runs(stale_after_sec=60)
    second = svc.reap_stale_runs(stale_after_sec=60)
    assert first["reaped_run_ids"] == ["r-old"]
    assert second["reaped_run_ids"] == []
    assert len(published) == 1


def test_cancel_active_run_does_not_overwrite_completed(database):
    session, svc, _published, now = database
    _add_run(session, run_id="r-done", status="completed", updated_at=now,
             started_at=now - timedelta(seconds=5), created_at=now - timedelta(seconds=10))
    result = svc.cancel_active_run(conversation_id="conv", current_user_id=2)
    assert result.get("status") != "cancelled" or result.get("run_id") is None
    with session() as db:
        assert db.get(AppAiBotRun, "r-done").status == "completed"


def test_cancel_active_run_marks_queued_cancelled(database):
    session, svc, published, now = database
    _add_run(session, run_id="r-queued", status="queued", updated_at=now, created_at=now)
    result = svc.cancel_active_run(conversation_id="conv", current_user_id=2)
    assert result["status"] == "cancelled"
    with session() as db:
        run = db.get(AppAiBotRun, "r-queued")
        assert run.status == "cancelled"
        assert run.completed_at is not None
    assert any(event.get("status") == "cancelled" for event in published)


# --------------------------------------------------------------------------
# Secondary bounds: singleflight, warehouse coroutine, voice/docs, env knobs
# --------------------------------------------------------------------------


def test_singleflight_waiter_falls_back_when_leader_hangs(monkeypatch):
    from backend.services.mail_runtime_cache import SingleflightGroup
    from backend.ai_chat import timeouts as timeouts_module

    monkeypatch.setattr(timeouts_module, "mail_singleflight_wait_sec", lambda: 0.1)
    gate = threading.Event()
    group = SingleflightGroup()

    leader_done: list[str] = []
    def slow_producer():
        gate.wait(timeout=5)
        leader_done.append("leader")
        return "leader-result"

    leader_thread = threading.Thread(
        target=lambda: group.run(key="k", producer=slow_producer), daemon=True
    )
    leader_thread.start()
    time.sleep(0.05)  # let the leader register its call
    result = group.run(key="k", producer=lambda: "own-result")
    assert result == "own-result"  # bounded wait -> own producer, not a hang
    gate.set()
    leader_thread.join(timeout=5)


def test_warehouse_coroutine_has_bounded_wait(monkeypatch):
    from backend.ai_chat.tools import warehouse
    from backend.ai_chat import timeouts as timeouts_module

    monkeypatch.setattr(timeouts_module, "ai_warehouse_call_timeout_sec", lambda: 0.2)

    async def _sleep():
        await asyncio.sleep(3)
        return "done"

    started = time.perf_counter()
    with pytest.raises(TimeoutError):
        warehouse.run_coroutine(_sleep())
    assert time.perf_counter() - started < 2.0


def test_voice_scan_caps_files_and_bytes(tmp_path, monkeypatch):
    from backend.ai_chat.tools import voice

    output = tmp_path / "output"
    output.mkdir()
    for index in range(15):
        (output / f"r{index:02d}_report.json").write_text(
            '{"summary": "meeting %d notes"}' % index, encoding="utf-8"
        )
    big = output / "big_report.json"
    big.write_text('{"summary": "' + "x" * 70000 + '"}', encoding="utf-8")
    monkeypatch.setenv("VOICEVIDEO_ROOT", str(tmp_path))
    monkeypatch.setenv("AI_VOICE_REPORT_MAX_FILES", "10")
    monkeypatch.setenv("AI_VOICE_REPORT_MAX_BYTES", "65536")
    files = list(voice._iter_report_files(tmp_path))
    assert len(files) == 10  # capped scan
    assert voice._load_report(big) is None  # oversized report skipped
    small = output / "r00_report.json"
    assert voice._load_report(small) is not None


def test_document_extract_bytes_cap(tmp_path, monkeypatch):
    from backend.ai_chat import document_extractors

    monkeypatch.setenv("AI_DOC_EXTRACT_MAX_BYTES", "1048576")  # 1MB minimum clamp
    big = tmp_path / "huge.bin"
    big.write_bytes(b"x" * (1048576 + 1))
    with pytest.raises(ValueError, match="слишком большой"):
        document_extractors._read_bytes(big)
    small = tmp_path / "ok.txt"
    small.write_bytes(b"hello")
    assert document_extractors._read_bytes(small) == b"hello"


def test_timeout_env_knobs(monkeypatch):
    from backend.ai_chat import timeouts

    monkeypatch.delenv("AI_TOOL_WALL_TIMEOUT_SEC", raising=False)
    assert timeouts.ai_tool_wall_timeout_sec() == 120.0
    monkeypatch.setenv("AI_TOOL_WALL_TIMEOUT_SEC", "999999")
    assert timeouts.ai_tool_wall_timeout_sec() == 1800.0  # clamped
    monkeypatch.setenv("AI_TOOL_WALL_TIMEOUT_SEC", "abc")
    assert timeouts.ai_tool_wall_timeout_sec() == 120.0  # invalid -> default
    monkeypatch.setenv("AI_RUN_WATCHDOG_QUEUED_STALE_SEC", "100")
    assert timeouts.watchdog_queued_stale_sec() >= timeouts.watchdog_stale_sec()
