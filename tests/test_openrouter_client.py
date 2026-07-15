from __future__ import annotations

import sys
from pathlib import Path
from types import SimpleNamespace


PROJECT_ROOT = Path(__file__).resolve().parents[1]
WEB_ROOT = PROJECT_ROOT / "WEB-itinvent"

if str(PROJECT_ROOT) not in sys.path:
    sys.path.insert(0, str(PROJECT_ROOT))
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


def _patch_build_client(monkeypatch, client, fake_client):
    monkeypatch.setattr(client, "_build_client", lambda **kwargs: fake_client)


def test_complete_json_uses_strict_json_schema_and_response_healing(monkeypatch):
    from backend.ai_chat.openrouter_client import OpenRouterClient

    fake_client = _FakeClient([
        _completion('{"answer_markdown":"ok","artifacts":[],"kb_attachment_send":null,"tool_calls":[]}')
    ])
    client = OpenRouterClient()
    _patch_build_client(monkeypatch, client, fake_client)
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
    _patch_build_client(monkeypatch, client, fake_client)
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


def test_complete_text_and_multimodal_user_content(monkeypatch):
    from backend.ai_chat.openrouter_client import OpenRouterClient

    fake_client = _FakeClient([_completion("# Hello")])
    client = OpenRouterClient()
    _patch_build_client(monkeypatch, client, fake_client)

    text, usage = client.complete_text(
        system_prompt="Convert to markdown.",
        user_prompt="Hello",
        model="openai/gpt-4o-mini",
        purpose="markdown",
    )
    assert text == "# Hello"
    assert usage["model"] == "openai/gpt-4o-mini"
    assert fake_client.chat.completions.calls[0]["messages"][1]["content"] == "Hello"

    fake_client2 = _FakeClient([_completion('{"from_employee":"A"}')])
    client2 = OpenRouterClient()
    _patch_build_client(monkeypatch, client2, fake_client2)
    payload, _ = client2.complete_json(
        system_prompt="Extract JSON.",
        user_content=[{"type": "text", "text": "doc"}, {"type": "image_url", "image_url": {"url": "data:image/png;base64,xx"}}],
        model="ocr-model",
        purpose="act",
        response_healing=False,
    )
    assert payload["from_employee"] == "A"
    assert isinstance(fake_client2.chat.completions.calls[0]["messages"][1]["content"], list)


def test_resolve_model_purpose_chains(monkeypatch):
    from shared.llm import env as env_mod
    from shared.llm.models import resolve_model, resolve_model_candidates

    monkeypatch.setattr(env_mod, "ROOT_ENV", {})
    monkeypatch.delenv("OPENROUTER_MODEL_MAIL", raising=False)
    monkeypatch.delenv("OPENROUTER_MODEL_CHAT", raising=False)
    monkeypatch.delenv("OPENROUTER_MODEL_MARKDOWN", raising=False)
    monkeypatch.delenv("ACT_PARSE_MODEL", raising=False)
    monkeypatch.delenv("OCR_MODEL", raising=False)
    monkeypatch.setenv("OPENROUTER_MODEL_CHAT", "chat-model")
    monkeypatch.setenv("OCR_MODEL", "ocr-model")

    assert resolve_model("mail") == "chat-model"
    assert resolve_model("ocr") == "ocr-model"
    assert resolve_model_candidates("act") == ["ocr-model"]


def test_per_call_timeout_does_not_mutate_singleton(monkeypatch):
    from backend.ai_chat.openrouter_client import OpenRouterClient, openrouter_client

    seen = {}

    def _fake_build(*, timeout=None):
        seen["timeout"] = timeout
        return _FakeClient([_completion("ok")])

    client = OpenRouterClient(request_timeout_sec=45.0)
    monkeypatch.setattr(client, "_build_client", _fake_build)
    previous = openrouter_client.request_timeout_sec

    text, _ = client.complete_text(
        user_prompt="hi",
        model="m",
        timeout=20.0,
    )
    assert text == "ok"
    assert seen["timeout"] == 20.0
    assert client.request_timeout_sec == 45.0
    assert openrouter_client.request_timeout_sec == previous


def test_error_message_includes_provider_text(monkeypatch):
    from backend.ai_chat.openrouter_client import OpenRouterClient, OpenRouterClientError

    # Non-transient error so gateway does not consume multiple fake responses via retry.
    fake_client = _FakeClient([RuntimeError("401 Unauthorized invalid api key")])
    client = OpenRouterClient()
    _patch_build_client(monkeypatch, client, fake_client)

    try:
        client.complete_text(user_prompt="hi", model="m")
        assert False, "expected OpenRouterClientError"
    except OpenRouterClientError as exc:
        assert "401 Unauthorized invalid api key" in str(exc)
        assert isinstance(exc.__cause__, RuntimeError)


def test_complete_vision_system_prompt_none_vs_empty(monkeypatch):
    from backend.ai_chat.openrouter_client import OpenRouterClient

    fake_client = _FakeClient([_completion("Серийный номер: ABC12345")])
    client = OpenRouterClient()
    _patch_build_client(monkeypatch, client, fake_client)

    text, _ = client.complete_vision(
        image_bytes=b"fake",
        mime_type="image/jpeg",
        prompt="Find serial",
        system_prompt="",
        model="ocr-model",
    )
    assert "ABC12345" in text
    messages = fake_client.chat.completions.calls[0]["messages"]
    assert messages[0]["role"] == "user"
    assert all(m["role"] != "system" for m in messages)

    fake_client2 = _FakeClient([_completion("text")])
    client2 = OpenRouterClient()
    _patch_build_client(monkeypatch, client2, fake_client2)
    client2.complete_vision(
        image_bytes=b"fake",
        prompt="OCR",
        system_prompt=None,
        model="ocr-model",
    )
    messages2 = fake_client2.chat.completions.calls[0]["messages"]
    assert messages2[0]["role"] == "system"
    assert "OCR" in messages2[0]["content"]


def test_is_image_unsupported_error_walks_cause_chain():
    from shared.llm.client import is_image_unsupported_error
    from shared.llm.errors import OpenRouterClientError

    root = RuntimeError("model does not support vision inputs")
    wrapped = OpenRouterClientError("Failed to call OpenRouter: model does not support vision inputs")
    wrapped.__cause__ = root
    assert is_image_unsupported_error(wrapped) is True
    assert is_image_unsupported_error(RuntimeError("plain timeout")) is False


def test_act_parser_empty_json_continues_to_next_model(monkeypatch):
    from backend.services import act_upload_service

    calls = {"n": 0}

    def _fake_complete_json(**kwargs):
        calls["n"] += 1
        model = kwargs.get("model")
        if model == "model-a":
            return {}, {"model": model}
        return {"from_employee": "A", "to_employee": "B", "doc_date": "", "equipment_inv_nos": ["100887"]}, {
            "model": model
        }

    monkeypatch.setattr(act_upload_service, "resolve_model_candidates", lambda purpose="act": ["model-a", "model-b"])
    monkeypatch.setattr(act_upload_service.openrouter_client, "is_configured", lambda: True)
    monkeypatch.setattr(act_upload_service.openrouter_client, "complete_json", _fake_complete_json)

    payload, warnings = act_upload_service._call_openrouter_act_parser(
        file_name="act.pdf",
        pdf_text="Инвентарный номер 100887",
    )
    assert payload["equipment_inv_nos"] == ["100887"]
    assert calls["n"] == 2
    assert any("пустой JSON" in w for w in warnings)
