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


def test_gateway_accepts_sdk_usage_options_without_forwarding_extra_fields():
    payload = {'messages': [{'role': 'user', 'content': 'check'}],
               'stream': True, 'stream_options': {'include_usage': True}}
    result = normalize_gateway_request(payload, forced_model='approved/model')
    assert result['model'] == 'approved/model'
    assert 'stream_options' not in result
    payload['stream_options']['unexpected'] = 'private-input'
    with pytest.raises(OpenAiGatewayValidationError):
        normalize_gateway_request(payload, forced_model='approved/model')


def test_gateway_validation_logs_no_input_or_unknown_field_names(caplog):
    with pytest.raises(OpenAiGatewayValidationError):
        normalize_gateway_request({'messages': [{'role': 'user', 'content': 'secret-prompt'}],
                                   'secret-key-name': 'secret-value'}, forced_model='approved/model')
    assert 'extra_forbidden' in caplog.text
    assert 'secret' not in caplog.text


def test_gateway_preserves_reasoning_for_deepseek_tool_roundtrip():
    assistant = {'role': 'assistant', 'content': None, 'reasoning_content': 'Inspect the test file',
                 'tool_calls': [{'id': 'call-1', 'type': 'function', 'function': {'name': 'read', 'arguments': '{}'}}]}
    normalized = normalize_gateway_request({'messages': [assistant, {'role': 'tool', 'tool_call_id': 'call-1', 'content': '42'}]},
                                           forced_model='deepseek-v4.1-flash')
    assert normalized['messages'][0]['reasoning_content'] == assistant['reasoning_content']
    assert normalized['messages'][1]['tool_call_id'] == 'call-1'
    with pytest.raises(OpenAiGatewayValidationError):
        normalize_gateway_request({'messages': [{'role': 'user', 'reasoning_content': 'invalid'}]}, forced_model='model')
