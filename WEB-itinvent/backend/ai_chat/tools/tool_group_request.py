"""Service tool `request_tool_group` for JEV tool-group routing (plan AG-4 / J2).

When JEV routing picks a narrow set of tool groups for a run, the model may
still discover mid-run that another domain is needed (found the device — now
needs a file or an email). This always-available helper lets the model ask the
orchestrator for one more group. The tool itself only reports whether the
requested group is permitted for the current user/bot; the actual expansion of
`tool_specs` for the next round happens in `AiChatService._execute_run`, which
logs each expansion as `ai_tool_group_expansion`.
"""
from __future__ import annotations

from typing import Optional

from pydantic import BaseModel, Field

from backend.ai_chat.tools.base import AiTool, AiToolResult
from backend.ai_chat.tools.context import (
    AI_TOOL_GROUPS_ALL,
    AiToolExecutionContext,
    get_enabled_tool_groups,
)
from backend.ai_chat.tools.registry import ai_tool_registry


AI_TOOL_REQUEST_GROUP = "ai.request_tool_group"

_GROUP_CHOICES = ", ".join(AI_TOOL_GROUPS_ALL)


def _normalize_text(value: object) -> str:
    return str(value or "").strip()


class RequestToolGroupArgs(BaseModel):
    group: str = Field(
        ...,
        min_length=1,
        max_length=64,
        description=f"Tool group to enable for the next step (one of: {_GROUP_CHOICES}).",
    )
    reason: Optional[str] = Field(
        default=None,
        max_length=300,
        description="Short reason why this group is needed now.",
    )


class RequestToolGroupTool(AiTool):
    tool_id = AI_TOOL_REQUEST_GROUP
    description = (
        "Request one more tool group for the next step when the initially routed "
        "tools are not enough (for example: equipment found -> need 'files' to "
        "export it or 'office' to email it). Available groups: "
        f"{_GROUP_CHOICES}. The group is enabled only if it is allowed for the "
        "current user; use at most once or twice per request."
    )
    input_model = RequestToolGroupArgs
    stage = "generating_answer"

    def execute(self, *, context: AiToolExecutionContext, args: BaseModel) -> AiToolResult:
        if isinstance(args, RequestToolGroupArgs):
            payload = args
        elif isinstance(args, dict):
            payload = RequestToolGroupArgs.model_validate(args)
        else:
            payload = RequestToolGroupArgs.model_validate({})
        group = _normalize_text(payload.group).lower()
        reason = _normalize_text(payload.reason)[:300] or None
        # The group is honored only when at least one of its tools is actually
        # enabled for this bot AND allowed for the employee (context.enabled_tools
        # is already permission-filtered upstream). The orchestrator re-checks
        # the same condition before widening the routed set.
        available_groups = get_enabled_tool_groups(list(context.enabled_tools or []))
        known = group in set(AI_TOOL_GROUPS_ALL)
        accepted = known and group in available_groups
        return AiToolResult(
            tool_id=self.tool_id,
            ok=True,
            data={
                "requested_group": group,
                "accepted": bool(accepted),
                "reason": reason,
                "available_groups": sorted(available_groups),
                "message": (
                    f"Группа '{group}' подключена к следующему шагу — вызови нужный инструмент."
                    if accepted
                    else (
                        f"Группа '{group}' недоступна этому сотруднику или не существует. "
                        "Ответь на основе уже доступных инструментов или данных."
                    )
                ),
            },
        )


ai_tool_registry.register(RequestToolGroupTool())
