from __future__ import annotations

import sys
import zipfile
from pathlib import Path
from types import SimpleNamespace

import pytest


PROJECT_ROOT = Path(__file__).resolve().parents[1]
WEB_ROOT = PROJECT_ROOT / "WEB-itinvent"
if str(WEB_ROOT) not in sys.path:
    sys.path.insert(0, str(WEB_ROOT))

from backend.ai_sandbox import app_service as sandbox_app_service  # noqa: E402
from backend.ai_sandbox.app_service import ChatSandboxAttachmentVerifier  # noqa: E402
from backend.ai_sandbox.contracts import SandboxAttachmentReference  # noqa: E402
from backend.ai_sandbox.paths import UnsafeArchiveError  # noqa: E402


def _configure_chat_attachment(monkeypatch, *, source: Path, file_name: str) -> None:
    monkeypatch.setattr(
        sandbox_app_service.chat_service,
        "get_message",
        lambda **kwargs: {
            "id": "message-input-1",
            "conversation_id": "conversation-input-1",
            "attachments": [{"id": "attachment-input-1", "file_name": file_name}],
        },
    )
    monkeypatch.setattr(
        sandbox_app_service.chat_service,
        "get_attachment_for_download",
        lambda **kwargs: {
            "path": str(source),
            "file_name": file_name,
            "mime_type": "application/octet-stream",
        },
    )


def test_chat_attachment_verifier_rejects_malicious_archive_before_queueing(
    tmp_path: Path,
    monkeypatch,
) -> None:
    malicious = tmp_path / "input.zip"
    with zipfile.ZipFile(malicious, "w") as archive:
        archive.writestr("../escape.txt", "blocked")
    _configure_chat_attachment(monkeypatch, source=malicious, file_name="input.zip")
    monkeypatch.setattr(
        sandbox_app_service,
        "scan_my_file",
        lambda path: SimpleNamespace(status="clean"),
    )

    with pytest.raises(UnsafeArchiveError, match="path"):
        ChatSandboxAttachmentVerifier().verify_for_sandbox(
            reference=SandboxAttachmentReference(
                message_id="message-input-1",
                attachment_id="attachment-input-1",
            ),
            user_id=42,
            conversation_id="conversation-input-1",
        )


@pytest.mark.parametrize("scan_status", ["infected", "error", "unknown"])
def test_chat_attachment_verifier_fails_closed_on_non_clean_antivirus_result(
    tmp_path: Path,
    monkeypatch,
    scan_status: str,
) -> None:
    source = tmp_path / "input.txt"
    source.write_text("content", encoding="utf-8")
    _configure_chat_attachment(monkeypatch, source=source, file_name="input.txt")
    monkeypatch.setattr(
        sandbox_app_service,
        "scan_my_file",
        lambda path: SimpleNamespace(status=scan_status),
    )

    with pytest.raises(PermissionError, match="antivirus"):
        ChatSandboxAttachmentVerifier().verify_for_sandbox(
            reference=SandboxAttachmentReference(
                message_id="message-input-1",
                attachment_id="attachment-input-1",
            ),
            user_id=42,
            conversation_id="conversation-input-1",
        )

