from __future__ import annotations

from pathlib import Path

import pytest
from fastapi import FastAPI
from fastapi.testclient import TestClient

from backend.api.deps import get_current_active_user
from backend.api.v1 import my_files as my_files_api
from backend.config import MyFilesPublicRateLimitConfig, config
from backend.models.auth import User
from backend.services.auth_runtime_store_service import auth_runtime_store_service
from backend.services.my_files_service import DownloadPayload, MyFilesNotFoundError


def _user() -> User:
    return User(id=42, username="files-user", role="viewer", is_active=True)


def _clear_rate_limit_store() -> None:
    lock = getattr(auth_runtime_store_service, "_lock", None)
    memory = getattr(auth_runtime_store_service, "_memory", None)
    if lock is not None and memory is not None:
        with lock:
            memory.clear()


@pytest.fixture(autouse=True)
def _reset_rate_limit_store(monkeypatch):
    monkeypatch.setattr(auth_runtime_store_service, "_redis_client", None)
    monkeypatch.setattr(auth_runtime_store_service, "_backend", "memory")
    _clear_rate_limit_store()
    yield
    _clear_rate_limit_store()


@pytest.fixture
def strict_public_download_limits(monkeypatch):
    monkeypatch.setattr(
        config,
        "my_files_public_rate_limit",
        MyFilesPublicRateLimitConfig(
            meta_limit_per_token=100,
            meta_window_token_sec=600,
            meta_limit_per_ip=100,
            meta_window_ip_sec=60,
            download_limit_per_token=1,
            download_window_token_sec=600,
            download_limit_per_ip=100,
            download_window_ip_sec=3600,
            miss_limit_per_ip=100,
            miss_window_ip_sec=60,
        ),
    )


class FakeMyFilesService:
    def __init__(self, tmp_path: Path) -> None:
        self.tmp_path = tmp_path
        self.seen_user_id = None
        self.upload = None

    def list_files(self, *, user_id: int):
        self.seen_user_id = user_id
        return {"items": []}

    def quota(self, *, user_id: int):
        self.seen_user_id = user_id
        return {"used_bytes": 0, "limit_bytes": 1024, "remaining_bytes": 1024}

    def list_audit(self, *, limit: int):
        return []

    def new_spool_path(self, file_name: str) -> Path:
        return self.tmp_path / f"upload-{file_name}"

    def create_pending_upload(
        self,
        *,
        actor: User,
        original_file_name: str,
        mime_type: str,
        spool_path: Path,
        original_size_bytes: int,
        retention_days: int,
    ):
        self.upload = {
            "actor_id": actor.id,
            "file_name": original_file_name,
            "mime_type": mime_type,
            "payload": spool_path.read_bytes(),
            "size": original_size_bytes,
            "retention_days": retention_days,
        }
        return {
            "id": "queued-file",
            "original_file_name": original_file_name,
            "download_file_name": original_file_name,
            "mime_type": mime_type,
            "download_mime_type": mime_type,
            "original_size_bytes": original_size_bytes,
            "stored_size_bytes": 0,
            "saved_size_bytes": 0,
            "retention_days": retention_days,
            "status": "queued",
            "storage_mode": "",
            "error_text": "",
            "is_shared": False,
        }

    def reserve_upload(
        self,
        *,
        actor: User,
        original_file_name: str,
        mime_type: str,
        spool_path: Path,
        expected_size_bytes: int,
        retention_days: int,
        meta=None,
    ):
        self.upload = {
            "actor_id": actor.id,
            "file_name": original_file_name,
            "mime_type": mime_type,
            "spool_path": spool_path,
            "expected_size": expected_size_bytes,
            "retention_days": retention_days,
        }
        return {"id": "reserved-file"}

    def complete_upload(self, *, file_id: str, user_id: int, actual_size_bytes: int, actor=None, meta=None):
        spool_path = self.upload["spool_path"]
        self.upload.update(
            {
                "file_id": file_id,
                "user_id": user_id,
                "payload": spool_path.read_bytes(),
                "size": actual_size_bytes,
            }
        )
        return {
            "id": "queued-file",
            "original_file_name": self.upload["file_name"],
            "download_file_name": self.upload["file_name"],
            "mime_type": self.upload["mime_type"],
            "download_mime_type": self.upload["mime_type"],
            "original_size_bytes": actual_size_bytes,
            "stored_size_bytes": 0,
            "saved_size_bytes": 0,
            "retention_days": self.upload["retention_days"],
            "status": "queued",
            "storage_mode": "",
            "error_text": "",
            "security_scan_status": "pending",
            "is_shared": False,
        }

    def get_upload_session(self, *, file_id: str, user_id: int):
        if not self.upload or file_id != "reserved-file" or user_id != 42:
            raise MyFilesNotFoundError("File not found")
        spool_path = self.upload["spool_path"]
        uploaded_bytes = spool_path.stat().st_size if spool_path.is_file() else 0
        expected_size = int(self.upload["expected_size"])
        return {
            "file_id": file_id,
            "chunk_size_bytes": 16 * 1024 * 1024,
            "uploaded_bytes": uploaded_bytes,
            "file_size_bytes": expected_size,
            "complete": uploaded_bytes == expected_size,
        }

    def append_upload_chunk(self, *, file_id: str, user_id: int, offset: int, payload: bytes):
        session = self.get_upload_session(file_id=file_id, user_id=user_id)
        if offset != session["uploaded_bytes"]:
            raise ValueError("offset mismatch")
        with self.upload["spool_path"].open("ab") as target:
            target.write(payload)
        return self.get_upload_session(file_id=file_id, user_id=user_id)

    def abort_upload(self, *, file_id: str, user_id: int, error_text: str, actor=None, meta=None):
        self.upload = {**(self.upload or {}), "aborted": True, "file_id": file_id, "user_id": user_id}

    def get_public_file(self, *, token: str):
        if token not in {"share-token", "share-token-b"}:
            raise MyFilesNotFoundError("File not found")
        return {
            "file_name": f"{token}.txt",
            "size_bytes": 11,
            "mime_type": "text/plain",
            "expires_at": "2026-06-13T10:00:00+00:00",
        }

    def get_public_download(self, *, token: str, meta=None):
        if token not in {"share-token", "share-token-b"}:
            raise MyFilesNotFoundError("File not found")
        path = self.tmp_path / f"{token}.txt"
        path.write_bytes(b"hello world")
        return DownloadPayload(
            path=path,
            mode="stored",
            file_name=f"{token}.txt",
            media_type="text/plain",
            download_size_bytes=11,
        )

    def get_public_preview_meta(self, *, token: str):
        if token not in {"share-token", "share-token-b"}:
            raise MyFilesNotFoundError("File not found")
        return {
            "preview_kind": "text",
            "source_kind": "text",
            "source_filename": f"{token}.txt",
            "pdf_filename": "",
            "page_count": 1,
            "sheets": [],
            "preview_url": f"/api/v1/my-files/public/{token}/preview/content",
        }

    def get_public_preview_content(self, *, token: str):
        if token not in {"share-token", "share-token-b"}:
            raise MyFilesNotFoundError("File not found")
        return b"hello world", "text/plain", f"{token}.txt"


def _client(fake_service: FakeMyFilesService) -> TestClient:
    app = FastAPI()
    app.include_router(my_files_api.router, prefix="/my-files")
    app.dependency_overrides[get_current_active_user] = _user
    return TestClient(app)


def _public_client(fake_service: FakeMyFilesService) -> TestClient:
    app = FastAPI()
    app.include_router(my_files_api.router, prefix="/my-files")
    return TestClient(app)


def _custom_permission_client(fake_service: FakeMyFilesService, permissions: list[str]) -> TestClient:
    app = FastAPI()
    app.include_router(my_files_api.router, prefix="/my-files")
    user = User(
        id=42,
        username="files-user",
        role="viewer",
        is_active=True,
        permissions=permissions,
        use_custom_permissions=True,
        custom_permissions=permissions,
    )
    app.dependency_overrides[get_current_active_user] = lambda: user
    return TestClient(app)


@pytest.mark.parametrize(
    "path",
    [
        "/my-files/public/share-token",
        "/my-files/public/share-token/preview",
        "/my-files/public/share-token/preview/content",
        "/my-files/public/share-token/download",
    ],
)
def test_shared_file_endpoints_are_public(monkeypatch, tmp_path, path):
    fake_service = FakeMyFilesService(tmp_path)
    monkeypatch.setattr(my_files_api, "my_files_service", fake_service)
    client = _public_client(fake_service)

    response = client.get(path)

    assert response.status_code == 200


def test_authenticated_user_can_read_shared_file_metadata(monkeypatch, tmp_path):
    fake_service = FakeMyFilesService(tmp_path)
    monkeypatch.setattr(my_files_api, "my_files_service", fake_service)
    client = _client(fake_service)

    response = client.get("/my-files/public/share-token")

    assert response.status_code == 200
    assert response.json()["file_name"] == "share-token.txt"
    assert response.headers["cache-control"] == "no-store, max-age=0"
    assert response.headers["referrer-policy"] == "no-referrer"


def test_public_download_returns_404_for_invalid_token(monkeypatch, tmp_path):
    fake_service = FakeMyFilesService(tmp_path)
    monkeypatch.setattr(my_files_api, "my_files_service", fake_service)
    client = _client(fake_service)

    response = client.get("/my-files/public/missing/download")

    assert response.status_code == 404
    assert response.headers["cache-control"] == "no-store, max-age=0"
    assert response.headers["referrer-policy"] == "no-referrer"


def test_authenticated_user_can_download_shared_file(monkeypatch, tmp_path):
    fake_service = FakeMyFilesService(tmp_path)
    monkeypatch.setattr(my_files_api, "my_files_service", fake_service)
    client = _client(fake_service)

    response = client.get("/my-files/public/share-token/download")

    assert response.status_code == 200
    assert response.content == b"hello world"
    assert response.headers["content-type"].startswith("text/plain")
    assert response.headers["content-disposition"].startswith("attachment;")
    assert response.headers["cache-control"] == "no-store, max-age=0"
    assert response.headers["referrer-policy"] == "no-referrer"
    assert response.headers["x-content-type-options"] == "nosniff"


def test_personal_file_list_requires_auth(monkeypatch, tmp_path):
    fake_service = FakeMyFilesService(tmp_path)
    monkeypatch.setattr(my_files_api, "my_files_service", fake_service)
    client = _public_client(fake_service)

    response = client.get("/my-files")

    assert response.status_code in {401, 403}
    assert fake_service.seen_user_id is None


def test_authenticated_list_uses_current_user(monkeypatch, tmp_path):
    fake_service = FakeMyFilesService(tmp_path)
    monkeypatch.setattr(my_files_api, "my_files_service", fake_service)
    client = _client(fake_service)

    response = client.get("/my-files")

    assert response.status_code == 200
    assert response.json() == {"items": []}
    assert fake_service.seen_user_id == 42


def test_authenticated_upload_streams_raw_body_directly_to_spool(monkeypatch, tmp_path):
    fake_service = FakeMyFilesService(tmp_path)
    monkeypatch.setattr(my_files_api, "my_files_service", fake_service)
    client = _client(fake_service)
    payload = b"column_a,column_b\n1,2\n"

    response = client.post(
        "/my-files",
        params={"file_name": "report.csv", "file_size": len(payload), "retention_days": 30},
        content=payload,
        headers={"content-type": "text/csv"},
    )

    assert response.status_code == 201
    assert fake_service.upload == {
        "actor_id": 42,
        "file_name": "report.csv",
        "mime_type": "text/csv",
        "payload": payload,
        "spool_path": tmp_path / "upload-report.csv",
        "expected_size": len(payload),
        "size": len(payload),
        "file_id": "reserved-file",
        "user_id": 42,
        "retention_days": 30,
    }


def test_authenticated_upload_accepts_declared_size_above_former_one_gib_limit(monkeypatch, tmp_path):
    fake_service = FakeMyFilesService(tmp_path)
    monkeypatch.setattr(my_files_api, "my_files_service", fake_service)

    async def fake_stream(_request, spool_path, *, expected_size):
        spool_path.write_bytes(b"test-placeholder")
        return expected_size

    monkeypatch.setattr(my_files_api, "_stream_request_to_spool", fake_stream)
    client = _client(fake_service)
    size = (1024**3) + 1

    response = client.post(
        "/my-files",
        params={"file_name": "large.bin", "file_size": size, "retention_days": 1},
        content=b"test-placeholder",
        headers={"content-type": "application/octet-stream"},
    )

    assert response.status_code == 201
    assert fake_service.upload["expected_size"] == size
    assert fake_service.upload["size"] == size


def test_authenticated_upload_requires_exact_declared_size(monkeypatch, tmp_path):
    fake_service = FakeMyFilesService(tmp_path)
    monkeypatch.setattr(my_files_api, "my_files_service", fake_service)
    client = _client(fake_service)

    response = client.post(
        "/my-files",
        params={"file_name": "report.csv", "file_size": 999, "retention_days": 1},
        content=b"short",
        headers={"content-type": "text/csv"},
    )

    assert response.status_code == 400
    assert fake_service.upload["aborted"] is True


def test_authenticated_chunked_upload_reserves_appends_and_completes(monkeypatch, tmp_path):
    fake_service = FakeMyFilesService(tmp_path)
    monkeypatch.setattr(my_files_api, "my_files_service", fake_service)
    client = _client(fake_service)
    payload = b"chunked-payload"

    created = client.post(
        "/my-files/upload-sessions",
        json={
            "file_name": "large.bin",
            "file_size": len(payload),
            "retention_days": 30,
            "mime_type": "application/octet-stream",
        },
    )
    first = client.put(
        "/my-files/upload-sessions/reserved-file/chunks",
        params={"offset": 0},
        content=payload[:7],
        headers={"content-type": "application/octet-stream"},
    )
    second = client.put(
        "/my-files/upload-sessions/reserved-file/chunks",
        params={"offset": 7},
        content=payload[7:],
        headers={"content-type": "application/octet-stream"},
    )
    completed = client.post("/my-files/upload-sessions/reserved-file/complete")

    assert created.status_code == 201
    assert created.json()["uploaded_bytes"] == 0
    assert first.status_code == 200
    assert first.json()["uploaded_bytes"] == 7
    assert second.json()["complete"] is True
    assert completed.status_code == 200
    assert completed.json()["status"] == "queued"
    assert fake_service.upload["payload"] == payload
    assert fake_service.upload["retention_days"] == 30


def test_chunked_upload_rejects_oversized_chunk_before_service_write(monkeypatch, tmp_path):
    fake_service = FakeMyFilesService(tmp_path)
    monkeypatch.setattr(my_files_api, "my_files_service", fake_service)
    monkeypatch.setattr(my_files_api, "UPLOAD_CHUNK_SIZE_BYTES", 4)
    client = _client(fake_service)
    client.post(
        "/my-files/upload-sessions",
        json={"file_name": "large.bin", "file_size": 5, "retention_days": 1},
    )

    response = client.put(
        "/my-files/upload-sessions/reserved-file/chunks",
        params={"offset": 0},
        content=b"12345",
        headers={"content-type": "application/octet-stream"},
    )

    assert response.status_code == 400
    assert not fake_service.upload["spool_path"].exists()


def test_custom_permissions_retain_viewer_upload_baseline(monkeypatch, tmp_path):
    fake_service = FakeMyFilesService(tmp_path)
    monkeypatch.setattr(my_files_api, "my_files_service", fake_service)
    client = _custom_permission_client(fake_service, ["my_files.read"])

    response = client.post(
        "/my-files",
        params={"file_name": "report.csv", "file_size": 5, "retention_days": 1},
        content=b"hello",
        headers={"content-type": "text/csv"},
    )

    assert response.status_code == 201
    assert fake_service.upload["user_id"] == 42


def test_cross_site_browser_upload_is_rejected(monkeypatch, tmp_path):
    fake_service = FakeMyFilesService(tmp_path)
    monkeypatch.setattr(my_files_api, "my_files_service", fake_service)
    client = _client(fake_service)

    response = client.post(
        "/my-files",
        params={"file_name": "report.csv", "file_size": 5, "retention_days": 1},
        content=b"hello",
        headers={
            "content-type": "text/csv",
            "origin": "https://attacker.example",
            "sec-fetch-site": "cross-site",
        },
    )

    assert response.status_code == 403
    assert fake_service.upload is None


def test_my_files_audit_requires_admin_permission(monkeypatch, tmp_path):
    fake_service = FakeMyFilesService(tmp_path)
    monkeypatch.setattr(my_files_api, "my_files_service", fake_service)
    client = _custom_permission_client(fake_service, ["my_files.read"])

    response = client.get("/my-files/audit")

    assert response.status_code == 403


def test_authenticated_upload_rate_limit_does_not_bypass_internal_requests(monkeypatch, tmp_path):
    fake_service = FakeMyFilesService(tmp_path)
    monkeypatch.setattr(my_files_api, "my_files_service", fake_service)
    monkeypatch.setattr("backend.utils.rate_limit_guard.request_is_internal", lambda _request: True)
    monkeypatch.setattr(config.my_files_security, "upload_limit_per_user", 1)
    monkeypatch.setattr(config.my_files_security, "upload_limit_per_ip", 100)
    client = _client(fake_service)

    first = client.post(
        "/my-files",
        params={"file_name": "first.txt", "file_size": 5, "retention_days": 1},
        content=b"first",
        headers={"content-type": "text/plain"},
    )
    second = client.post(
        "/my-files",
        params={"file_name": "second.txt", "file_size": 6, "retention_days": 1},
        content=b"second",
        headers={"content-type": "text/plain"},
    )

    assert first.status_code == 201
    assert second.status_code == 429


def test_public_download_rate_limits_repeated_requests_for_same_token(
    monkeypatch,
    tmp_path,
    strict_public_download_limits,
):
    fake_service = FakeMyFilesService(tmp_path)
    monkeypatch.setattr(my_files_api, "my_files_service", fake_service)
    client = _client(fake_service)

    first = client.get("/my-files/public/share-token/download")
    second = client.get("/my-files/public/share-token/download")

    assert first.status_code == 200
    assert second.status_code == 429
    assert second.headers.get("retry-after")


def test_public_download_rate_limit_is_per_token_not_per_ip(
    monkeypatch,
    tmp_path,
    strict_public_download_limits,
):
    fake_service = FakeMyFilesService(tmp_path)
    monkeypatch.setattr(my_files_api, "my_files_service", fake_service)
    client = _client(fake_service)

    first_token = client.get("/my-files/public/share-token/download")
    second_token = client.get("/my-files/public/share-token-b/download")

    assert first_token.status_code == 200
    assert second_token.status_code == 200


def test_public_download_rate_limit_does_not_bypass_internal_requests(
    monkeypatch,
    tmp_path,
    strict_public_download_limits,
):
    fake_service = FakeMyFilesService(tmp_path)
    monkeypatch.setattr(my_files_api, "my_files_service", fake_service)
    monkeypatch.setattr(
        "backend.utils.rate_limit_guard.request_is_internal",
        lambda _request: True,
    )
    client = _client(fake_service)

    first = client.get("/my-files/public/share-token/download")
    second = client.get("/my-files/public/share-token/download")

    assert first.status_code == 200
    assert second.status_code == 429
