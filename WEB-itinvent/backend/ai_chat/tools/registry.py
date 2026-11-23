from __future__ import annotations

import contextvars
import functools
import logging
import threading
import time
from concurrent.futures import ThreadPoolExecutor, TimeoutError as FutureTimeoutError
from typing import Any

from pydantic import ValidationError

from backend.ai_chat.tools.base import AiTool, AiToolResult, AiToolValidationError
from backend.ai_chat.tools.context import AiToolExecutionContext
from backend.ai_chat.timeouts import (
    ai_sql_query_timeout_sec,
    ai_tool_executor_max_pending,
    ai_tool_executor_workers,
    ai_tool_wall_timeout_sec,
)


logger = logging.getLogger(__name__)

_tool_executor_lock = threading.Lock()
_tool_executor_pool: ThreadPoolExecutor | None = None

# A1 capacity accounting. ``in_flight`` = calls submitted and not yet finished
# (running OR still waiting in the executor queue). It is released ONLY by the
# future's done callback — i.e. when the task actually ends, never when the
# caller merely stops waiting. ``leaked_now`` = timed-out calls whose threads
# are still alive; the gauge goes back down when the abandoned thread finally
# finishes (driver timeouts are what usually free it).
_capacity_lock = threading.Lock()
_in_flight = 0
_leaked_now = 0
_leaked_total = 0
_rejected_total = 0
_queue_timeout_total = 0
_submitted_total = 0
# Generation guards the test-only reset: a done callback from a task that was
# abandoned BEFORE the reset must not decrement the fresh counters below zero.
_generation = 0


def _tool_executor() -> ThreadPoolExecutor:
    """Dedicated executor for tool calls (A1). Kept separate from the asyncio
    default executor so abandoned calls never starve the worker's own
    to_thread slots. Threads are standard non-daemon TPE threads: a thread
    leaked in a driver call that never returns keeps the process resident —
    there is no safe in-process recovery for that (see A1 report §9)."""
    global _tool_executor_pool
    with _tool_executor_lock:
        if _tool_executor_pool is None:
            _tool_executor_pool = ThreadPoolExecutor(
                max_workers=ai_tool_executor_workers(),
                thread_name_prefix="ai-tool",
            )
    return _tool_executor_pool


def ai_tool_leaked_count() -> int:
    """Leaked tool calls whose worker threads are still alive right now."""
    with _capacity_lock:
        return _leaked_now


def ai_tool_executor_stats() -> dict[str, Any]:
    """Diagnostic snapshot of the tool executor (A1, degraded-state signal)."""
    workers = ai_tool_executor_workers()
    max_pending = ai_tool_executor_max_pending()
    with _capacity_lock:
        return {
            "workers": workers,
            "max_pending": max_pending,
            "capacity": workers + max_pending,
            "in_flight": _in_flight,
            "leaked_now": _leaked_now,
            "leaked_total": _leaked_total,
            "rejected_total": _rejected_total,
            "queue_timeout_total": _queue_timeout_total,
            "submitted_total": _submitted_total,
            "degraded": bool(_leaked_now) or _in_flight >= workers + max_pending,
        }


def _reset_tool_executor_state_for_tests() -> None:
    """Test-only reset of pool + counters (leaked threads, if any, still die
    with the process — this only rebuilds accounting)."""
    global _tool_executor_pool, _generation
    global _in_flight, _leaked_now, _leaked_total, _rejected_total, _queue_timeout_total, _submitted_total
    with _tool_executor_lock:
        if _tool_executor_pool is not None:
            _tool_executor_pool.shutdown(wait=False, cancel_futures=True)
            _tool_executor_pool = None
    with _capacity_lock:
        _generation += 1
        _in_flight = 0
        _leaked_now = 0
        _leaked_total = 0
        _rejected_total = 0
        _queue_timeout_total = 0
        _submitted_total = 0


def _normalize_text(value: object) -> str:
    return str(value or "").strip()


class AiToolRegistry:
    def __init__(self) -> None:
        self._tools: dict[str, AiTool] = {}

    def register(self, tool: AiTool) -> None:
        tool_id = _normalize_text(getattr(tool, "tool_id", None))
        if not tool_id:
            raise ValueError("tool_id is required")
        self._tools[tool_id] = tool

    def get(self, tool_id: str) -> AiTool | None:
        return self._tools.get(_normalize_text(tool_id))

    def list_specs(self, *, tool_ids: list[str] | None = None) -> list[dict[str, Any]]:
        allowed_ids = {
            _normalize_text(item)
            for item in list(tool_ids or [])
            if _normalize_text(item)
        }
        tools = list(self._tools.values())
        if tool_ids is not None:
            tools = [tool for tool in tools if tool.tool_id in allowed_ids]
        return [tool.to_prompt_spec() for tool in tools]

    def execute(
        self,
        *,
        tool_id: str,
        raw_args: Any,
        context: AiToolExecutionContext,
    ) -> tuple[AiToolResult, dict[str, Any]]:
        normalized_tool_id = _normalize_text(tool_id)
        started_at = time.perf_counter()
        tool = self.get(normalized_tool_id)
        if tool is None:
            raise AiToolValidationError(f"Unknown tool: {normalized_tool_id or 'unknown'}")
        if normalized_tool_id not in set(context.enabled_tools or []):
            raise AiToolValidationError(f"Tool is disabled for this bot: {normalized_tool_id}")
        if tool.admin_only and not context.is_admin:
            raise PermissionError(f"Tool requires admin access: {normalized_tool_id}")
        # AG-2: re-check the employee's portal permission so a tool call cannot
        # be forged past the spec filter (lazy import: tools -> tool_permissions
        # -> tools.context would otherwise form an import cycle).
        from backend.ai_chat.tool_permissions import tool_required_permissions, user_can_use_tool

        if not user_can_use_tool(normalized_tool_id, context.user_payload):
            required = ", ".join(tool_required_permissions(normalized_tool_id))
            raise PermissionError(
                f"Нет доступа к данным ({normalized_tool_id}): "
                f"требуется право {required or 'admin'} у сотрудника"
            )
        try:
            args = tool.validate_args(raw_args)
        except ValidationError as exc:
            detail_parts: list[str] = []
            field_path: str | None = None
            for index, error in enumerate(exc.errors()[:5]):
                loc = ".".join(str(item) for item in error.get("loc", ())) or "args"
                msg = _normalize_text(error.get("msg"))
                detail_parts.append(f"{loc}: {msg}" if msg else loc)
                if index == 0 and loc:
                    field_path = loc
            detail = "; ".join(detail_parts) or "schema validation failed"
            logger.warning(
                "ai_tool_validation_failed tool_id=%s errors=%s",
                normalized_tool_id,
                detail,
            )
            error_text = f"Invalid tool arguments for {normalized_tool_id}: {detail}"
            err = AiToolValidationError(error_text)
            # Attach structured diagnostic so the orchestrator can surface it to the LLM.
            err.tool_id = normalized_tool_id  # type: ignore[attr-defined]
            err.field_path = field_path  # type: ignore[attr-defined]
            err.detail = detail  # type: ignore[attr-defined]
            raise err from exc
        # A1: scope the SQL Server statement timeout to this tool call so a
        # hung ITINVENT query dies at the driver instead of blocking the run.
        from backend.database.connection import ai_sql_query_timeout

        sql_timeout_token = ai_sql_query_timeout.set(ai_sql_query_timeout_sec())
        try:
            result = tool.execute(context=context, args=args)
        finally:
            ai_sql_query_timeout.reset(sql_timeout_token)
        latency_ms = max(0, int((time.perf_counter() - started_at) * 1000))
        audit_row = {
            "tool_id": normalized_tool_id,
            "database_id": _normalize_text(result.database_id or context.effective_database_id) or None,
            "status": "ok" if bool(result.ok) else "error",
            "latency_ms": latency_ms,
            "conversation_id": context.conversation_id,
            "bot_id": context.bot_id,
            "user_id": int(context.user_id or 0),
        }
        logger.info(
            "ai_tool_call user_id=%s bot_id=%s conversation_id=%s tool_id=%s database_id=%s status=%s latency_ms=%s",
            audit_row["user_id"],
            audit_row["bot_id"],
            audit_row["conversation_id"],
            audit_row["tool_id"],
            audit_row["database_id"] or "-",
            audit_row["status"],
            audit_row["latency_ms"],
        )
        return result, audit_row

    def execute_bounded(
        self,
        *,
        tool_id: str,
        raw_args: Any,
        context: AiToolExecutionContext,
    ) -> tuple[AiToolResult, dict[str, Any]]:
        """Execute a tool call under the wall-clock bound (A1, Layer 2).

        Returns a controlled error result on timeout — the run continues with
        a tool error the model can report. The abandoned call keeps running
        inside the dedicated executor until driver timeouts free it; that
        leaked call is counted so operators can see unreclaimed capacity.

        Admission control (P0-1): a call is accepted only while
        ``in_flight < workers + max_pending``. A rejected call NEVER starts —
        it gets a distinct ``tool_capacity_exceeded`` error, never the
        "outcome unknown" one. Capacity is released by the future's done
        callback, i.e. when the task actually finishes.
        """
        global _in_flight, _leaked_now, _leaked_total, _rejected_total, _queue_timeout_total, _submitted_total
        normalized_tool_id = _normalize_text(tool_id)
        tool = self.get(normalized_tool_id)
        timeout_sec = ai_tool_wall_timeout_sec()
        tool_timeout = getattr(tool, "timeout_sec", None) if tool is not None else None
        if tool_timeout:
            timeout_sec = max(1.0, min(1800.0, float(tool_timeout)))

        capacity = ai_tool_executor_workers() + ai_tool_executor_max_pending()
        with _capacity_lock:
            if _in_flight >= capacity:
                _rejected_total += 1
                rejected_total = _rejected_total
            else:
                rejected_total = -1
                _in_flight += 1
                _submitted_total += 1
        if rejected_total >= 0:
            logger.warning(
                "ai_tool_rejected run_id=%s conversation_id=%s tool_id=%s capacity=%s rejected_total=%s",
                getattr(context, "run_id", None) or "-",
                getattr(context, "conversation_id", None) or "-",
                normalized_tool_id or "-",
                capacity,
                rejected_total,
            )
            return self._error_result(
                tool_id=normalized_tool_id,
                context=context,
                error_code="tool_capacity_exceeded",
                error_text="ИИ-ассистент перегружен: вызов инструмента отклонён — попробуйте позже.",
                message=(
                    "Сервис ИИ перегружен: все слоты выполнения инструментов заняты. "
                    "Вызов НЕ был поставлен в очередь и гарантированно не выполнялся — "
                    "повтор безопасен, но лучше подождать."
                ),
                latency_ms=0,
            )

        # copy_context: preserve contextvars (SQL timeout scope is set inside
        # execute() anyway; this keeps any other request-scoped vars intact).
        ctx = contextvars.copy_context()
        call = functools.partial(
            self.execute,
            tool_id=tool_id,
            raw_args=raw_args,
            context=context,
        )
        # Done callback: the ONLY place capacity is released — on actual task
        # completion (or successful pre-start cancellation), never on caller
        # timeout. ``state`` is shared with the timeout path under the lock.
        state = {"leaked": False, "gen": _generation}

        def _on_done(_fut, _state=state) -> None:
            global _in_flight, _leaked_now
            with _capacity_lock:
                if _state["gen"] != _generation:
                    return  # pre-reset task: do not corrupt fresh counters
                _in_flight -= 1
                if _state["leaked"]:
                    _leaked_now -= 1

        # P1 (cycle 3/4): submit()/callback registration may raise. Three
        # distinct failure shapes, handled differently:
        #  - submit() raised: nothing was queued — release the reservation,
        #    "never ran" is safe to claim;
        #  - callback raised AND future.cancel() succeeded: the task was still
        #    queued — same "never ran" handling;
        #  - callback raised AND cancel() failed: the task is RUNNING (or
        #    done). It must keep its reserved capacity until actual completion
        #    and the caller must NOT hear "never ran". A daemon monitor thread
        #    then performs the capacity release the missing callback would
        #    have done; if the monitor itself cannot start, the capacity is
        #    held as leaked and the outcome is reported as unknown.
        future = None
        submit_failed = False
        callback_failed = False
        try:
            future = _tool_executor().submit(ctx.run, call)
        except Exception:
            submit_failed = True
        else:
            try:
                future.add_done_callback(_on_done)
            except Exception:
                callback_failed = True
        if submit_failed or (callback_failed and future.cancel()):
            with _capacity_lock:
                _in_flight -= 1
                _rejected_total += 1
            logger.exception(
                "ai_tool_submit_failed run_id=%s tool_id=%s — capacity released",
                getattr(context, "run_id", None) or "-",
                normalized_tool_id or "-",
            )
            return self._error_result(
                tool_id=normalized_tool_id,
                context=context,
                error_code="tool_submit_failed",
                error_text="Не удалось поставить вызов инструмента в обработку — операция не выполнялась.",
                message=(
                    "Внутренняя ошибка планировщика инструментов: вызов не был "
                    "запущен и гарантированно не выполнялся. Повтор безопасен."
                ),
                latency_ms=0,
            )
        if callback_failed:
            # The task is already running/finished without our callback.
            def _release_when_done(fut, _state=state) -> None:
                try:
                    fut.result()
                except BaseException:
                    pass
                _on_done(fut, _state=_state)

            try:
                monitor = threading.Thread(
                    target=_release_when_done,
                    args=(future,),
                    daemon=True,
                    name="ai-tool-done-monitor",
                )
                monitor.start()
            except Exception:
                # Cannot even observe completion — hold the capacity as
                # leaked so stats stay honest; do NOT claim it never ran.
                with _capacity_lock:
                    state["leaked"] = True
                    _leaked_now += 1
                    _leaked_total += 1
                logger.exception(
                    "ai_tool_submit_monitor_failed run_id=%s tool_id=%s — "
                    "task running unobserved, capacity held as leaked",
                    getattr(context, "run_id", None) or "-",
                    normalized_tool_id or "-",
                )
                return self._error_result(
                    tool_id=normalized_tool_id,
                    context=context,
                    error_code="tool_submit_incomplete",
                    error_text="Не удалось зарегистрировать завершение вызова инструмента — результат неизвестен.",
                    message=(
                        "Внутренняя ошибка планировщика: операция МОГЛА быть "
                        "выполнена — результат неизвестен, повтор допустим "
                        "только после проверки."
                    ),
                    latency_ms=0,
                )
            logger.warning(
                "ai_tool_callback_failed run_id=%s tool_id=%s — done-monitor attached",
                getattr(context, "run_id", None) or "-",
                normalized_tool_id or "-",
            )
        try:
            return future.result(timeout=timeout_sec)
        except FutureTimeoutError:
            # P0-1 ordering: future.cancel() runs done callbacks SYNCHRONOUSLY
            # in this thread, and _on_done takes _capacity_lock — cancel()
            # must never be called while holding it (self-deadlock).
            # Step 1 (under lock): mark the call leaked unless it already
            # finished; the done callback pairs with state["leaked"] under
            # the same lock, so this cannot race.
            with _capacity_lock:
                if future.done():
                    outcome = "finished"
                else:
                    state["leaked"] = True
                    _leaked_now += 1
                    _leaked_total += 1
                    leaked_now = _leaked_now
                    outcome = "pending"
            if outcome == "finished":
                return future.result()
            # Step 2 (lock-free): cancel() — if the task was still queued it
            # never ran (queue timeout, not a leak); if it is running the
            # leak marking stands. A task that finished in between returns
            # its real result — the callback already netted the accounting.
            if future.cancel():
                with _capacity_lock:
                    state["leaked"] = False  # callback already undid the gauge
                    _leaked_total -= 1
                    _queue_timeout_total += 1
                outcome = "queue_timeout"
            elif future.done():
                return future.result()
            else:
                outcome = "leaked"
            latency_ms = int(timeout_sec * 1000)
            if outcome == "queue_timeout":
                logger.warning(
                    "ai_tool_queue_timeout run_id=%s conversation_id=%s tool_id=%s timeout_sec=%s",
                    getattr(context, "run_id", None) or "-",
                    getattr(context, "conversation_id", None) or "-",
                    normalized_tool_id or "-",
                    timeout_sec,
                )
                return self._error_result(
                    tool_id=normalized_tool_id,
                    context=context,
                    error_code="tool_queue_timeout",
                    error_text=f"Вызов инструмента не начал выполняться за {int(timeout_sec)} с (очередь).",
                    message=(
                        f"Инструмент не успел запуститься за {int(timeout_sec)} с — "
                        "все рабочие потоки были заняты. Операция гарантированно "
                        "не выполнялась, повтор безопасен."
                    ),
                    latency_ms=latency_ms,
                )
            logger.error(
                "ai_tool_timeout run_id=%s conversation_id=%s tool_id=%s timeout_sec=%s leaked_now=%s",
                getattr(context, "run_id", None) or "-",
                getattr(context, "conversation_id", None) or "-",
                normalized_tool_id or "-",
                timeout_sec,
                leaked_now,
            )
            return self._error_result(
                tool_id=normalized_tool_id,
                context=context,
                error_code="tool_timeout",
                error_text=f"Инструмент не ответил за {int(timeout_sec)} с (таймаут).",
                message=(
                    f"Инструмент не ответил за {int(timeout_sec)} с. "
                    "Операция могла завершиться на стороне внешней системы — "
                    "результат неизвестен, повторный запрос допустим только после проверки."
                ),
                latency_ms=latency_ms,
            )

    @staticmethod
    def _error_result(
        *,
        tool_id: str,
        context: AiToolExecutionContext,
        error_code: str,
        error_text: str,
        message: str,
        latency_ms: int,
    ) -> tuple[AiToolResult, dict[str, Any]]:
        result = AiToolResult(
            tool_id=tool_id or "unknown",
            ok=False,
            data={"diagnostic": {"error_code": error_code, "message": message}},
            error=error_text,
        )
        audit_row = {
            "tool_id": tool_id or "unknown",
            "database_id": _normalize_text(getattr(context, "effective_database_id", None)) or None,
            "status": "error",
            "latency_ms": latency_ms,
            "conversation_id": getattr(context, "conversation_id", None),
            "bot_id": getattr(context, "bot_id", None),
            "user_id": int(getattr(context, "user_id", 0) or 0),
        }
        return result, audit_row


ai_tool_registry = AiToolRegistry()
