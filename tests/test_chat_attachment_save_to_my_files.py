from __future__ import annotations

from pathlib import Path

from fastapi import FastAPI
from fastapi.testclient import TestClient

from backend.api import deps
from backend.api.v1 import chat as chat_api
from backend.api.v1.chat import attachments as attachments_api
from backend.models.auth import User
from backend.services.authorization_service import PERM_CHAT_READ, PERM_MY_FILES_WRITE


class _FakeChatService:
    def __init__(self, source_path: Path) -> None:
        self.source_path = source_path
        self.requested: tuple[int, str, str] | None = None

    def get_attachment_for_download(
        self,
        *,
        current_user_id: int,
        message_id: str,
        attachment_id: str,
        variant=None,
    ) -> dict:
        self.requested = (current_user_id, message_id, attachment_id)
        return {
            "path": str(self.source_path),
            "file_name": "report.xlsx",
            "mime_type": "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
        }


class _FakeMyFilesService:
    def __init__(self, tmp_path: Path) -> None:
        self.spool_path = tmp_path / "spool" / "report.xlsx"
        self.completed: dict | None = None
        self.aborted = False

    def new_spool_path(self, _file_name: str) -> Path:
        return self.spool_path

    def reserve_upload(self, **kwargs) -> dict:
        self.reserved = kwargs
        return {"id": "reserved-file"}

    def complete_upload(self, **kwargs) -> dict:
        self.completed = kwargs
        return {
            "id": "saved-file",
            "original_file_name": "report.xlsx",
            "download_file_name": "report.xlsx",
            "mime_type": self.reserved["mime_type"],
            "download_mime_type": self.reserved["mime_type"],
            "original_size_bytes": kwargs["actual_size_bytes"],
            "stored_size_bytes": 0,
            "saved_size_bytes": 0,
            "retention_days": self.reserved["retention_days"],
            "status": "queued",
            "storage_mode": "",
            "security_scan_status": "pending",
            "is_shared": False,
        }

    def abort_upload(self, **_kwargs) -> None:
        self.aborted = True


def _user(*, permissions: list[str] | None = None) -> User:
    if permissions is None:
        return User(id=42, username="files-user", role="viewer", is_active=True)
    return User(
        id=42,
        username="files-user",
        role="viewer",
        is_active=True,
        permissions=permissions,
        custom_permissions=permissions,
        use_custom_permissions=True,
    )


def _client(user: User) -> TestClient:
    app = FastAPI()
    app.include_router(attachments_api.router, prefix="/chat")
    app.dependency_overrides[deps.get_current_active_user] = lambda: user
    return TestClient(app)


def test_chat_attachment_is_queued_through_my_files_pipeline(monkeypatch, tmp_path):
    source_path = tmp_path / "source.xlsx"
    source_path.write_bytes(b"xlsx payload")
    fake_chat = _FakeChatService(source_path)
    fake_my_files = _FakeMyFilesService(tmp_path)
    monkeypatch.setattr(chat_api, "chat_service", fake_chat)
    monkeypatch.setattr(attachments_api, "my_files_service", fake_my_files)

    response = _client(_user()).post(
        "/chat/messages/message-1/attachments/attachment-1/save-to-my-files"
    )

    assert response.status_code == 201
    assert response.json()["id"] == "saved-file"
    assert response.json()["status"] == "queued"
    assert fake_chat.requested == (42, "message-1", "attachment-1")
    assert fake_my_files.spool_path.read_bytes() == b"xlsx payload"
    assert fake_my_files.completed["file_id"] == "reserved-file"
    assert fake_my_files.completed["user_id"] == 42
    assert fake_my_files.completed["actual_size_bytes"] == len(b"xlsx payload")
    assert fake_my_files.completed["actor"].id == 42
    # Starlette's TestClient does not guarantee a real peer IP in the ASGI
    # scope; the production request metadata path is covered elsewhere.
    assert fake_my_files.completed["meta"].user_agent == "testclient"
    assert fake_my_files.aborted is False


def test_save_chat_attachment_requires_my_files_write_permission(monkeypatch, tmp_path):
    source_path = tmp_path / "source.xlsx"
    source_path.write_bytes(b"xlsx payload")
    fake_chat = _FakeChatService(source_path)
    monkeypatch.setattr(chat_api, "chat_service", fake_chat)
    monkeypatch.setattr(attachments_api, "my_files_service", _FakeMyFilesService(tmp_path))

    response = _client(_user(permissions=[PERM_CHAT_READ])).post(
        "/chat/messages/message-1/attachments/attachment-1/save-to-my-files"
    )

    assert response.status_code == 403
    assert fake_chat.requested is None


def test_save_chat_attachment_accepts_explicit_permissions(monkeypatch, tmp_path):
    source_path = tmp_path / "source.xlsx"
    source_path.write_bytes(b"xlsx payload")
    fake_chat = _FakeChatService(source_path)
    fake_my_files = _FakeMyFilesService(tmp_path)
    monkeypatch.setattr(chat_api, "chat_service", fake_chat)
    monkeypatch.setattr(attachments_api, "my_files_service", fake_my_files)

    response = _client(_user(permissions=[PERM_CHAT_READ, PERM_MY_FILES_WRITE])).post(
        "/chat/messages/message-1/attachments/attachment-1/save-to-my-files?retention_days=30"
    )

    assert response.status_code == 201
    assert fake_my_files.reserved["retention_days"] == 30
