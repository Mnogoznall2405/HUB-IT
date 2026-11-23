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
    ai_tool_executor_workers,
    ai_tool_wall_timeout_sec,
)


logger = logging.getLogger(__name__)

_tool_executor_lock = threading.Lock()
_tool_executor_pool: ThreadPoolExecutor | None = None

_leaked_lock = threading.Lock()
_leaked_tool_calls = 0


def _tool_executor() -> ThreadPoolExecutor:
    """Dedicated executor for tool calls (A1). Kept separate from the asyncio
    default executor so abandoned calls never starve the worker's own
    to_thread slots; daemon threads let the process exit on shutdown."""
    global _tool_executor_pool
    with _tool_executor_lock:
        if _tool_executor_pool is None:
            _tool_executor_pool = ThreadPoolExecutor(
                max_workers=ai_tool_executor_workers(),
                thread_name_prefix="ai-tool",
            )
    return _tool_executor_pool


def ai_tool_leaked_count() -> int:
    """Tool calls that timed out and were abandoned while still running."""
    with _leaked_lock:
        return _leaked_tool_calls


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
        """
        global _leaked_tool_calls
        normalized_tool_id = _normalize_text(tool_id)
        tool = self.get(normalized_tool_id)
        timeout_sec = ai_tool_wall_timeout_sec()
        tool_timeout = getattr(tool, "timeout_sec", None) if tool is not None else None
        if tool_timeout:
            timeout_sec = max(1.0, min(1800.0, float(tool_timeout)))
        # copy_context: preserve contextvars (SQL timeout scope is set inside
        # execute() anyway; this keeps any other request-scoped vars intact).
        ctx = contextvars.copy_context()
        call = functools.partial(
            self.execute,
            tool_id=tool_id,
            raw_args=raw_args,
            context=context,
        )
        future = _tool_executor().submit(ctx.run, call)
        try:
            return future.result(timeout=timeout_sec)
        except FutureTimeoutError:
            future.cancel()  # no-op if already running — threads cannot be killed
            with _leaked_lock:
                _leaked_tool_calls += 1
            latency_ms = int(timeout_sec * 1000)
            logger.error(
                "ai_tool_timeout run_id=%s conversation_id=%s tool_id=%s timeout_sec=%s leaked=%s",
                getattr(context, "run_id", None) or "-",
                getattr(context, "conversation_id", None) or "-",
                normalized_tool_id or "-",
                timeout_sec,
                _leaked_tool_calls,
            )
            result = AiToolResult(
                tool_id=normalized_tool_id or "unknown",
                ok=False,
                data={
                    "diagnostic": {
                        "error_code": "tool_timeout",
                        "message": (
                            f"Инструмент не ответил за {int(timeout_sec)} с. "
                            "Операция могла завершиться на стороне внешней системы — "
                            "результат неизвестен, повторный запрос допустим только после проверки."
                        ),
                    }
                },
                error=f"Инструмент не ответил за {int(timeout_sec)} с (таймаут).",
            )
            audit_row = {
                "tool_id": normalized_tool_id or "unknown",
                "database_id": _normalize_text(getattr(context, "effective_database_id", None)) or None,
                "status": "error",
                "latency_ms": latency_ms,
                "conversation_id": getattr(context, "conversation_id", None),
                "bot_id": getattr(context, "bot_id", None),
                "user_id": int(getattr(context, "user_id", 0) or 0),
            }
            return result, audit_row


ai_tool_registry = AiToolRegistry()
