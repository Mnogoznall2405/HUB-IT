from __future__ import annotations

import sys
from pathlib import Path

import pytest


PROJECT_ROOT = Path(__file__).resolve().parents[1]
WEB_ROOT = PROJECT_ROOT / "WEB-itinvent"
if str(WEB_ROOT) not in sys.path:
    sys.path.insert(0, str(WEB_ROOT))

from backend.services.mail_service import MailService, MailServiceError


class _TransientInboxAccount:
    def __init__(self) -> None:
        self.attempts = 0
        self.folder = object()

    @property
    def inbox(self):
        self.attempts += 1
        if self.attempts == 1:
            raise TimeoutError("temporary EWS timeout")
        return self.folder


class _BrokenInboxAccount:
    @property
    def inbox(self):
        raise TimeoutError("EWS is still unavailable")


class _InvalidCredentialsInboxAccount:
    @property
    def inbox(self):
        raise RuntimeError("Invalid credentials for https://10.103.0.50/EWS/Exchange.asmx")


def _service_without_runtime_initialization() -> MailService:
    return object.__new__(MailService)


def test_standard_inbox_resolution_retries_a_transient_exchange_failure():
    service = _service_without_runtime_initialization()
    account = _TransientInboxAccount()

    folder, folder_key = service._resolve_folder(account, "inbox")

    assert folder is account.folder
    assert folder_key == "inbox"
    assert account.attempts == 2


def test_standard_inbox_resolution_keeps_exchange_failure_transient():
    service = _service_without_runtime_initialization()

    with pytest.raises(MailServiceError) as error_info:
        service._resolve_folder(_BrokenInboxAccount(), "inbox")

    assert error_info.value.status_code == 503
    assert error_info.value.code == "MAIL_FOLDER_TEMPORARILY_UNAVAILABLE"
    assert "Folder is not available" not in str(error_info.value)


def test_standard_inbox_resolution_maps_invalid_credentials_to_auth_error():
    service = _service_without_runtime_initialization()

    with pytest.raises(MailServiceError) as error_info:
        service._resolve_folder(_InvalidCredentialsInboxAccount(), "inbox")

    assert error_info.value.status_code == 409
    assert error_info.value.code == "MAIL_AUTH_INVALID"
    assert "Invalid credentials" in str(error_info.value)
    assert error_info.value.code != "MAIL_FOLDER_TEMPORARILY_UNAVAILABLE"


def test_mail_http_exception_recovers_auth_code_from_wrapped_exchange_cause(monkeypatch):
    from backend.api.v1 import mail as mail_api

    invalidated: list[tuple[int, str | None]] = []
    cleared_sessions: list[str] = []

    class _DummyMailService:
        def classify_mail_error_code(self, value):
            return MailService.classify_mail_error_code(value)

        def invalidate_saved_password(self, *, user_id: int, mailbox_id: str | None = None) -> None:
            invalidated.append((user_id, mailbox_id))

    class _DummySessionAuth:
        def delete_session_context(self, session_id):
            cleared_sessions.append(str(session_id))

    monkeypatch.setattr(mail_api, "mail_service", _DummyMailService())
    monkeypatch.setattr(mail_api, "session_auth_context_service", _DummySessionAuth())
    monkeypatch.setattr(mail_api, "get_request_session_id", lambda: "sess-auth-invalid")

    cause = RuntimeError("Invalid credentials for https://10.103.0.50/EWS/Exchange.asmx")
    wrapped = MailServiceError(
        "Почтовая папка inbox временно недоступна из-за ошибки Exchange. Повторите попытку.",
        code="MAIL_FOLDER_TEMPORARILY_UNAVAILABLE",
        status_code=503,
    )
    wrapped.__cause__ = cause

    http_exc = mail_api._mail_http_exception(wrapped, user_id=42)

    assert http_exc.status_code == 409
    assert http_exc.headers["X-Mail-Error-Code"] == "MAIL_AUTH_INVALID"
    assert "парол" in str(http_exc.detail).lower()
    assert "странице" in str(http_exc.detail).lower()
    assert invalidated == [(42, None)]
    assert cleared_sessions == ["sess-auth-invalid"]
