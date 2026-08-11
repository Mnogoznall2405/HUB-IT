from __future__ import annotations

import pytest

from backend.services.mail_ai_service import MailAiService, MailAiServiceError


class _FakeOpenRouterClient:
    def __init__(self, payload):
        self.payload = payload
        self.configured = True
        self.calls = []

    def is_configured(self) -> bool:
        return self.configured

    def complete_json(self, **kwargs):
        self.calls.append(kwargs)
        return self.payload, {}


def test_summarize_message_returns_summary(monkeypatch):
    service = MailAiService()
    fake_client = _FakeOpenRouterClient({"summary": "Краткий пересказ письма."})
    monkeypatch.setattr("backend.services.mail_ai_service.openrouter_client", fake_client)

    result = service.summarize_message(
        {
            "subject": "Status",
            "body_text": "Please review the attached report.",
            "sender_display": "Boss",
        }
    )

    assert result == {"summary": "Краткий пересказ письма."}


def test_smart_replies_returns_suggestions(monkeypatch):
    service = MailAiService()
    fake_client = _FakeOpenRouterClient({"suggestions": ["Спасибо, посмотрю.", "Принято."]})
    monkeypatch.setattr("backend.services.mail_ai_service.openrouter_client", fake_client)

    result = service.smart_replies(
        {
            "subject": "Status",
            "body_text": "Please review the attached report.",
            "sender_display": "Boss",
        }
    )

    assert result == {"suggestions": ["Спасибо, посмотрю.", "Принято."]}
    assert fake_client.calls[0]["model"] == "deepseek/deepseek-v4-flash-0731"
    assert fake_client.calls[0]["thinking"] is False
    assert fake_client.calls[0]["max_tokens"] == 512


def test_summarize_message_requires_ai_configuration(monkeypatch):
    service = MailAiService()
    fake_client = _FakeOpenRouterClient({})
    fake_client.configured = False
    monkeypatch.setattr("backend.services.mail_ai_service.openrouter_client", fake_client)

    with pytest.raises(MailAiServiceError, match="не настроен"):
        service.summarize_message({"subject": "Status", "body_text": "Body"})
