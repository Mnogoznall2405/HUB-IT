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
