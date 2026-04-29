from __future__ import annotations

import sys
from pathlib import Path
from types import SimpleNamespace


PROJECT_ROOT = Path(__file__).resolve().parents[1]
WEB_ROOT = PROJECT_ROOT / "WEB-itinvent"

if str(WEB_ROOT) not in sys.path:
    sys.path.insert(0, str(WEB_ROOT))


def _completion(content: str):
    return SimpleNamespace(
        choices=[SimpleNamespace(message=SimpleNamespace(content=content))],
        usage=SimpleNamespace(prompt_tokens=3, completion_tokens=4, total_tokens=7),
    )


class _FakeCompletions:
    def __init__(self, responses):
        self.responses = list(responses)
        self.calls = []

    def create(self, **kwargs):
        self.calls.append(kwargs)
        response = self.responses.pop(0)
        if isinstance(response, Exception):
            raise response
        return response


class _FakeClient:
    def __init__(self, responses):
        self.chat = SimpleNamespace(completions=_FakeCompletions(responses))


def test_complete_json_uses_strict_json_schema_and_response_healing(monkeypatch):
    from backend.ai_chat.openrouter_client import OpenRouterClient

    fake_client = _FakeClient([
        _completion('{"answer_markdown":"ok","artifacts":[],"kb_attachment_send":null,"tool_calls":[]}')
    ])
    client = OpenRouterClient()
    monkeypatch.setattr(client, "_build_client", lambda: fake_client)
    monkeypatch.setattr(client, "_resolve_default_model", lambda: "openai/gpt-4o-mini")

    schema = {
        "type": "object",
        "properties": {"answer_markdown": {"type": "string"}},
        "required": ["answer_markdown"],
        "additionalProperties": False,
    }

    payload, usage = client.complete_json(
        system_prompt="Return JSON.",
        user_prompt="Hello",
        response_schema=schema,
        schema_name="ai_chat_response_test",
    )

    call = fake_client.chat.completions.calls[0]
    assert payload["answer_markdown"] == "ok"
    assert usage["total_tokens"] == 7
    assert call["response_format"] == {
        "type": "json_schema",
        "json_schema": {
            "name": "ai_chat_response_test",
            "strict": True,
            "schema": schema,
        },
    }
    assert call["extra_body"] == {"plugins": [{"id": "response-healing"}]}


def test_complete_json_falls_back_to_json_object_when_schema_mode_is_unsupported(monkeypatch):
    from backend.ai_chat.openrouter_client import OpenRouterClient

    fake_client = _FakeClient([
        RuntimeError("response_format json_schema unsupported by provider"),
        _completion('{"answer_markdown":"fallback","artifacts":[],"kb_attachment_send":null}'),
    ])
    client = OpenRouterClient()
    monkeypatch.setattr(client, "_build_client", lambda: fake_client)
    monkeypatch.setattr(client, "_resolve_default_model", lambda: "legacy/model")

    schema = {
        "type": "object",
        "properties": {"answer_markdown": {"type": "string"}},
        "required": ["answer_markdown"],
        "additionalProperties": False,
    }

    payload, _usage = client.complete_json(
        system_prompt="Return JSON.",
        user_prompt="Hello",
        response_schema=schema,
    )

    first_call, second_call = fake_client.chat.completions.calls
    assert payload["answer_markdown"] == "fallback"
    assert first_call["response_format"]["type"] == "json_schema"
    assert first_call["extra_body"] == {"plugins": [{"id": "response-healing"}]}
    assert second_call["response_format"] == {"type": "json_object"}
    assert "extra_body" not in second_call


def test_extract_json_payload_accepts_fenced_and_mixed_json():
    from backend.ai_chat.openrouter_client import _extract_json_payload

    assert _extract_json_payload('```json\n{"answer_markdown":"ok"}\n```') == {"answer_markdown": "ok"}
    assert _extract_json_payload('prefix {"answer_markdown":"ok"} suffix') == {"answer_markdown": "ok"}
