from __future__ import annotations

import logging
import time
from typing import Any

from pydantic import ValidationError

from backend.ai_chat.tools.base import AiTool, AiToolResult, AiToolValidationError
from backend.ai_chat.tools.context import AiToolExecutionContext


logger = logging.getLogger(__name__)


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
        if allowed_ids:
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
        try:
            args = tool.validate_args(raw_args)
        except ValidationError as exc:
            detail_parts: list[str] = []
            for error in exc.errors()[:3]:
                loc = ".".join(str(item) for item in error.get("loc", ())) or "args"
                msg = _normalize_text(error.get("msg"))
                detail_parts.append(f"{loc}: {msg}" if msg else loc)
            detail = "; ".join(detail_parts) or "schema validation failed"
            logger.warning(
                "ai_tool_validation_failed tool_id=%s errors=%s",
                normalized_tool_id,
                detail,
            )
            raise AiToolValidationError(f"Invalid tool arguments for {normalized_tool_id}: {detail}") from exc
        result = tool.execute(context=context, args=args)
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


ai_tool_registry = AiToolRegistry()
