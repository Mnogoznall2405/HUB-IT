from __future__ import annotations

from abc import ABC, abstractmethod
from dataclasses import dataclass, field
from typing import Any

from pydantic import BaseModel

from backend.ai_chat.tools.context import AiToolExecutionContext


class AiToolValidationError(ValueError):
    """Raised when the model requested an invalid tool call."""


@dataclass(slots=True)
class AiToolResult:
    tool_id: str
    ok: bool
    data: Any = None
    error: str | None = None
    database_id: str | None = None
    sources: list[dict[str, Any]] = field(default_factory=list)

    def to_payload(self) -> dict[str, Any]:
        return {
            "tool_id": self.tool_id,
            "ok": bool(self.ok),
            "database_id": self.database_id,
            "data": self.data,
            "error": self.error,
            "sources": list(self.sources or []),
        }


class AiTool(ABC):
    tool_id: str = ""
    description: str = ""
    input_model: type[BaseModel] = BaseModel
    admin_only: bool = False
    stage: str = "checking_itinvent"

    def validate_args(self, raw_args: Any) -> BaseModel:
        payload = raw_args if isinstance(raw_args, dict) else {}
        return self.input_model.model_validate(payload)

    def to_prompt_spec(self) -> dict[str, Any]:
        return {
            "tool_id": self.tool_id,
            "description": self.description,
            "input_schema": self.input_model.model_json_schema(),
            "admin_only": bool(self.admin_only),
        }

    @abstractmethod
    def execute(self, *, context: AiToolExecutionContext, args: BaseModel) -> AiToolResult:
        raise NotImplementedError
