from __future__ import annotations

import pytest
from pydantic import BaseModel

from shared.llm.openai_gateway import (
    OpenAiGatewayValidationError,
    iter_openai_sse,
    normalize_gateway_request,
)


def test_gateway_forces_hub_model_and_caps_output_tokens():
    normalized = normalize_gateway_request(
        {
            "model": "attacker/override",
            "messages": [{"role": "user", "content": "Проверь файл"}],
            "temperature": 0.1,
            "max_completion_tokens": 8_000,
            "stream": True,
            "tools": [
                {
                    "type": "function",
                    "function": {
                        "name": "read",
                        "description": "Read a workspace file",
                        "parameters": {"type": "object", "properties": {"path": {"type": "string"}}},
                    },
                }
            ],
            "tool_choice": {"type": "function", "function": {"name": "read"}},
        },
        forced_model="openai/gpt-approved",
        maximum_output_tokens=2_000,
    )

    assert normalized["model"] == "openai/gpt-approved"
    assert normalized["max_tokens"] == 2_000
    assert normalized["messages"] == [{"role": "user", "content": "Проверь файл", "tool_calls": []}]
    assert normalized["tools"][0]["function"]["name"] == "read"
    assert normalized["tool_choice"] == {"type": "function", "function": {"name": "read"}}


@pytest.mark.parametrize(
    "payload",
    [
        {"messages": [{"role": "user", "content": "ok"}], "stream": False},
        {"messages": [{"role": "user", "content": "ok", "unexpected": True}], "stream": True},
        {
            "messages": [
                {
                    "role": "user",
                    "content": [{"type": "image_url", "image_url": {"url": "https://example.test/a.png"}}],
                }
            ],
            "stream": True,
        },
    ],
)
def test_gateway_rejects_non_streaming_extra_fields_and_remote_content(payload):
    with pytest.raises(OpenAiGatewayValidationError, match="Invalid OpenAI-compatible request"):
        normalize_gateway_request(payload, forced_model="openai/gpt-approved")


def test_gateway_rejects_oversized_input():
    with pytest.raises(OpenAiGatewayValidationError, match="32k-token input budget"):
        normalize_gateway_request(
            {"messages": [{"role": "user", "content": "x" * 159_900}], "stream": True},
            forced_model="openai/gpt-approved",
        )


class _Chunk(BaseModel):
    id: str
    choices: list[dict]


def test_gateway_serializes_openai_sse_without_buffering():
    chunks = [_Chunk(id="one", choices=[{"delta": {"content": "a"}}]), {"id": "two", "choices": []}]

    events = list(iter_openai_sse(iter(chunks)))

    assert events[0].startswith(b'data: {"id":"one"')
    assert events[1] == b'data: {"id":"two","choices":[]}\n\n'
    assert events[2] == b"data: [DONE]\n\n"
