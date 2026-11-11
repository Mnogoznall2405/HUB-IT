"""Tests for unified HUB-IT outgoing email transport."""

from __future__ import annotations

import importlib
import sys
from pathlib import Path
from types import SimpleNamespace

import pytest

PROJECT_ROOT = Path(__file__).resolve().parents[1]
WEB_ROOT = PROJECT_ROOT / "WEB-itinvent"
if str(WEB_ROOT) not in sys.path:
    sys.path.insert(0, str(WEB_ROOT))

task_email_module = importlib.import_module("backend.services.task_email_service")
transfer_module = importlib.import_module("backend.services.transfer_service")


@pytest.fixture
def email_service(monkeypatch):
    monkeypatch.setenv("TASK_EMAIL_TRANSPORT", "exchange")
    monkeypatch.setenv("TASK_EMAIL_FROM_EMAIL", "hub-it@test.local")
    monkeypatch.setenv("TASK_EMAIL_EWS_LOGIN", "hub-it@test.local")
    monkeypatch.setenv("TASK_EMAIL_EWS_PASSWORD", "secret")
    return task_email_module.TaskEmailService()


def test_send_outgoing_email_uses_exchange_with_attachments(email_service, monkeypatch):
    captured: dict = {}

    def fake_send_via_exchange(**kwargs):
        captured.update(kwargs)
        return True

    monkeypatch.setattr(email_service, "_send_via_exchange", fake_send_via_exchange)

    ok = email_service.send_outgoing_email(
        recipient_email="user@test.local",
        subject="Акт №1",
        body_text="Тело письма",
        attachments=[("act.pdf", b"%PDF-1.4")],
    )

    assert ok is True
    assert captured["recipient_email"] == "user@test.local"
    assert captured["attachments"][0] == ("act.pdf", b"%PDF-1.4")


def test_send_outgoing_files_delegates_to_task_email_service(monkeypatch, tmp_path):
    pdf_path = tmp_path / "act.pdf"
    pdf_path.write_bytes(b"%PDF")

    calls: list[dict] = []

    def fake_send(**kwargs):
        calls.append(kwargs)
        return True

    monkeypatch.setattr(transfer_module.task_email_service, "send_outgoing_email", fake_send)

    ok = transfer_module._send_outgoing_files(
        recipient_email="user@test.local",
        files={"uploaded_act": str(pdf_path)},
        subject="Акт",
        body="Текст",
    )

    assert ok is True
    assert calls[0]["recipient_email"] == "user@test.local"
    assert calls[0]["attachments"][0][0] == "act.pdf"
