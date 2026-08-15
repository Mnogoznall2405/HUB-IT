"""Strict OpenAI-compatible request/SSE helpers for internal HUB consumers."""
from __future__ import annotations

import json
import re
from collections.abc import Iterable, Iterator
from typing import Any, Literal

from pydantic import BaseModel, ConfigDict, Field, model_validator


MAX_GATEWAY_INPUT_BYTES = 160_000
MAX_GATEWAY_OUTPUT_TOKENS = 16_000
_SAFE_NAME_RE = re.compile(r"^[A-Za-z0-9_.:-]{1,128}$")


class OpenAiGatewayValidationError(ValueError):
    pass


class GatewayTextPart(BaseModel):
    model_config = ConfigDict(extra="forbid")

    type: Literal["text"]
    text: str = Field(max_length=128_000)


class GatewayToolCallFunction(BaseModel):
    model_config = ConfigDict(extra="forbid")

    name: str = Field(min_length=1, max_length=128)
    arguments: str = Field(default="{}", max_length=128_000)

    @model_validator(mode="after")
    def _validate_name(self):
        if not _SAFE_NAME_RE.fullmatch(self.name):
            raise ValueError("Invalid tool function name")
        return self


class GatewayToolCall(BaseModel):
    model_config = ConfigDict(extra="forbid")

    id: str = Field(min_length=1, max_length=128)
    type: Literal["function"] = "function"
    function: GatewayToolCallFunction


class GatewayChatMessage(BaseModel):
    model_config = ConfigDict(extra="forbid")

    role: Literal["system", "user", "assistant", "tool"]
    content: str | list[GatewayTextPart] | None = None
    name: str | None = Field(default=None, max_length=128)
    tool_call_id: str | None = Field(default=None, max_length=128)
    tool_calls: list[GatewayToolCall] = Field(default_factory=list, max_length=64)

    @model_validator(mode="after")
    def _validate_role_fields(self):
        if self.role == "tool" and not self.tool_call_id:
            raise ValueError("Tool messages require tool_call_id")
        if self.name and not _SAFE_NAME_RE.fullmatch(self.name):
            raise ValueError("Invalid message name")
        return self


class GatewayFunctionDefinition(BaseModel):
    model_config = ConfigDict(extra="forbid")

    name: str = Field(min_length=1, max_length=128)
    description: str = Field(default="", max_length=8_000)
    parameters: dict[str, Any] = Field(default_factory=dict)
    strict: bool | None = None

    @model_validator(mode="after")
    def _validate_name(self):
        if not _SAFE_NAME_RE.fullmatch(self.name):
            raise ValueError("Invalid tool definition name")
        return self


class GatewayToolDefinition(BaseModel):
    model_config = ConfigDict(extra="forbid")

    type: Literal["function"] = "function"
    function: GatewayFunctionDefinition


class GatewayNamedToolChoiceFunction(BaseModel):
    model_config = ConfigDict(extra="forbid")

    name: str = Field(min_length=1, max_length=128)

    @model_validator(mode="after")
    def _validate_name(self):
        if not _SAFE_NAME_RE.fullmatch(self.name):
            raise ValueError("Invalid named tool choice")
        return self


class GatewayNamedToolChoice(BaseModel):
    model_config = ConfigDict(extra="forbid")

    type: Literal["function"] = "function"
    function: GatewayNamedToolChoiceFunction


class OpenAiChatCompletionRequest(BaseModel):
    """Subset accepted from an untrusted sandbox container."""

    model_config = ConfigDict(extra="forbid")

    model: str = Field(default="hub/opencode", max_length=200)
    messages: list[GatewayChatMessage] = Field(min_length=1, max_length=256)
    temperature: float = Field(default=0.2, ge=0.0, le=2.0)
    max_tokens: int | None = Field(default=None, ge=1, le=MAX_GATEWAY_OUTPUT_TOKENS)
    max_completion_tokens: int | None = Field(default=None, ge=1, le=MAX_GATEWAY_OUTPUT_TOKENS)
    stream: Literal[True] = True
    tools: list[GatewayToolDefinition] = Field(default_factory=list, max_length=128)
    tool_choice: Literal["none", "auto", "required"] | GatewayNamedToolChoice | None = None
    top_p: float | None = Field(default=None, gt=0.0, le=1.0)
    frequency_penalty: float | None = Field(default=None, ge=-2.0, le=2.0)
    presence_penalty: float | None = Field(default=None, ge=-2.0, le=2.0)
    stop: str | list[str] | None = None


def normalize_gateway_request(
    payload: dict[str, Any],
    *,
    forced_model: str,
    maximum_output_tokens: int = MAX_GATEWAY_OUTPUT_TOKENS,
) -> dict[str, Any]:
    """Validate a sandbox request and map it to ``OpenRouterClient`` arguments."""
    try:
        request = OpenAiChatCompletionRequest.model_validate(payload)
    except Exception as exc:
        raise OpenAiGatewayValidationError("Invalid OpenAI-compatible request") from exc

    encoded = json.dumps(request.model_dump(mode="json"), ensure_ascii=False, separators=(",", ":")).encode("utf-8")
    if len(encoded) > MAX_GATEWAY_INPUT_BYTES:
        raise OpenAiGatewayValidationError("Gateway request exceeds the 32k-token input budget")
    resolved_model = str(forced_model or "").strip()
    if not resolved_model:
        raise OpenAiGatewayValidationError("Gateway model is not configured")

    requested_output = request.max_completion_tokens or request.max_tokens or 4_000
    output_cap = max(1, min(int(maximum_output_tokens), MAX_GATEWAY_OUTPUT_TOKENS))
    normalized: dict[str, Any] = {
        "messages": [item.model_dump(mode="json", exclude_none=True) for item in request.messages],
        "model": resolved_model,
        "temperature": float(request.temperature),
        "max_tokens": min(int(requested_output), output_cap),
    }
    if request.tools:
        normalized["tools"] = [item.model_dump(mode="json", exclude_none=True) for item in request.tools]
    if request.tool_choice is not None:
        normalized["tool_choice"] = (
            request.tool_choice.model_dump(mode="json", exclude_none=True)
            if isinstance(request.tool_choice, GatewayNamedToolChoice)
            else request.tool_choice
        )
    return normalized


def _chunk_payload(chunk: Any) -> dict[str, Any]:
    if isinstance(chunk, dict):
        return chunk
    model_dump = getattr(chunk, "model_dump", None)
    if callable(model_dump):
        payload = model_dump(mode="json", exclude_none=True)
        if isinstance(payload, dict):
            return payload
    raise OpenAiGatewayValidationError("Provider returned an unsupported streaming chunk")


def iter_openai_sse(chunks: Iterable[Any]) -> Iterator[bytes]:
    """Serialize provider chunks without buffering model output in HUB memory."""
    for chunk in chunks:
        payload = json.dumps(_chunk_payload(chunk), ensure_ascii=False, separators=(",", ":"))
        yield f"data: {payload}\n\n".encode("utf-8")
    yield b"data: [DONE]\n\n"
