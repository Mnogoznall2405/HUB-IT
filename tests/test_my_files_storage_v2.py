"""Focused regression tests for My Files per-user blob storage v2."""
from __future__ import annotations

from pathlib import Path

import pytest

from backend.appdb.db import app_session
from backend.appdb.models import AppMyFile, AppMyFileBlob
from backend.models.auth import User
from backend.services.my_files_antivirus_service import SecurityScanResult
from backend.services.my_files_service import MyFilesService
from backend.services.my_files_storage_layout import publish_local_to_blob
from backend.services.secret_crypto_service import _build_fernet


@pytest.fixture(autouse=True)
def _configure_share_token_key(monkeypatch):
    monkeypatch.setenv("MY_FILES_SHARE_TOKEN_KEY", "test-my-files-share-token-key")
    monkeypatch.setenv("MY_FILES_STORAGE_V2_ENABLED", "0")
    _build_fernet.cache_clear()
    yield
    _build_fernet.cache_clear()


def _sqlite_url(path: Path) -> str:
    return f"sqlite:///{path.as_posix()}"


def _user(user_id: int = 7) -> User:
    return User(id=user_id, username=f"user-{user_id}", role="viewer", is_active=True)


def _new_service(tmp_path: Path) -> MyFilesService:
    return MyFilesService(
        database_url=_sqlite_url(tmp_path / "app.db"),
        storage_root=tmp_path / "users",
        antivirus_scanner=lambda _path: SecurityScanResult(status="clean", engine="test"),
    )


def _upload(service: MyFilesService, user: User, name: str, payload: bytes) -> dict:
    spool = service.new_spool_path(name)
    spool.write_bytes(payload)
    created = service.create_pending_upload(
        actor=user,
        original_file_name=name,
        mime_type="application/octet-stream",
        spool_path=spool,
        original_size_bytes=len(payload),
        retention_days=1,
    )
    result = service.process_file(created["id"])
    assert result is not None
    assert result["status"] == "ready"
    return result


def test_same_user_same_sha_reuses_blob(tmp_path: Path):
    service = _new_service(tmp_path)
    first = _upload(service, _user(7), "a.bin", b"same-bytes")
    second = _upload(service, _user(7), "b.bin", b"same-bytes")
    with app_session(_sqlite_url(tmp_path / "app.db")) as session:
        row1 = session.get(AppMyFile, first["id"])
        row2 = session.get(AppMyFile, second["id"])
        assert row1.blob_id == row2.blob_id
        blob = session.get(AppMyFileBlob, row1.blob_id)
        assert blob is not None
        assert blob.owner_user_id == 7
        assert blob.ref_count == 2
        assert blob.storage_path.startswith("7/my_files/blobs/")


def test_different_users_same_sha_get_separate_blobs(tmp_path: Path):
    service = _new_service(tmp_path)
    first = _upload(service, _user(7), "a.bin", b"shared-content")
    second = _upload(service, _user(9), "b.bin", b"shared-content")
    with app_session(_sqlite_url(tmp_path / "app.db")) as session:
        row1 = session.get(AppMyFile, first["id"])
        row2 = session.get(AppMyFile, second["id"])
        assert row1.blob_id != row2.blob_id
        blob1 = session.get(AppMyFileBlob, row1.blob_id)
        blob2 = session.get(AppMyFileBlob, row2.blob_id)
        assert blob1.owner_user_id == 7
        assert blob2.owner_user_id == 9
        assert blob1.storage_path != blob2.storage_path
        assert service._resolve_stored_path(blob1.storage_path).exists()
        assert service._resolve_stored_path(blob2.storage_path).exists()


def test_spool_stays_under_local_spool_root(tmp_path: Path):
    service = _new_service(tmp_path)
    spool = service.new_spool_path("x.bin")
    assert spool.is_relative_to(service.spool_root)
    assert "users" not in spool.as_posix().split("/")[-2:] or spool.parent.name == "spool"


def test_delete_user_a_does_not_remove_user_b_blob(tmp_path: Path):
    service = _new_service(tmp_path)
    first = _upload(service, _user(7), "a.bin", b"twin")
    second = _upload(service, _user(9), "b.bin", b"twin")
    with app_session(_sqlite_url(tmp_path / "app.db")) as session:
        row_b = session.get(AppMyFile, second["id"])
        blob_b_id = row_b.blob_id
        path_b = service._resolve_stored_path(session.get(AppMyFileBlob, blob_b_id).storage_path)
    service.delete_file(file_id=first["id"], user_id=7, actor=_user(7))
    assert path_b.exists()
    with app_session(_sqlite_url(tmp_path / "app.db")) as session:
        blob_b = session.get(AppMyFileBlob, blob_b_id)
        assert blob_b is not None
        assert blob_b.ref_count == 1


def test_publish_sha_mismatch_does_not_leave_final(tmp_path: Path):
    source = tmp_path / "src.bin"
    source.write_bytes(b"abc")
    destination = tmp_path / "users" / "1" / "my_files" / "blobs" / "ab" / "cd" / "deadbeef.bin"
    with pytest.raises(ValueError, match="SHA-256"):
        publish_local_to_blob(
            source=source,
            destination=destination,
            expected_sha256="0" * 64,
            expected_size=3,
        )
    assert not destination.exists()
    assert list(destination.parent.glob("*.tmp-*")) == [] if destination.parent.exists() else True
