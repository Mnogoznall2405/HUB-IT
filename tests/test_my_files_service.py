from __future__ import annotations

from datetime import datetime, timedelta, timezone
from pathlib import Path

import pytest

from backend.appdb.db import app_session
from backend.appdb.models import AppMyFile, AppMyFileAudit, AppMyFileBlob, AppMyFilePreview
from backend.models.auth import User
from backend.services.my_files_service import (
    STORAGE_ZSTD,
    MyFilesCapacityError,
    MyFilesNotFoundError,
    MyFilesService,
    MyFilesValidationError,
)
from backend.services.my_files_antivirus_service import SecurityScanResult
from backend.services.secret_crypto_service import _build_fernet


@pytest.fixture(autouse=True)
def _configure_share_token_key(monkeypatch):
    monkeypatch.setenv("MY_FILES_SHARE_TOKEN_KEY", "test-my-files-share-token-key")
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
        storage_root=tmp_path / "my-files",
        antivirus_scanner=lambda _path: SecurityScanResult(status="clean", engine="test"),
    )


def _stage_upload(service: MyFilesService, file_name: str, payload: bytes) -> Path:
    spool_path = service.new_spool_path(file_name)
    spool_path.write_bytes(payload)
    return spool_path


def _read_download(service: MyFilesService, payload) -> bytes:
    if payload.mode == STORAGE_ZSTD:
        return b"".join(service.iter_zstd_download(payload.path))
    return payload.path.read_bytes()


def test_create_pending_upload_accepts_thirty_days(tmp_path):
    service = _new_service(tmp_path)
    spool_path = _stage_upload(service, "monthly-report.txt", b"hello")

    created = service.create_pending_upload(
        actor=_user(),
        original_file_name="monthly-report.txt",
        mime_type="text/plain",
        spool_path=spool_path,
        original_size_bytes=spool_path.stat().st_size,
        retention_days=30,
    )

    assert created["retention_days"] == 30
    assert created["expires_at"] > datetime.now(timezone.utc) + timedelta(days=29)


def test_upload_reservation_counts_toward_quota_before_body_is_written(tmp_path):
    service = _new_service(tmp_path)
    spool_path = service.new_spool_path("reserved.bin")

    reserved = service.reserve_upload(
        actor=_user(),
        original_file_name="reserved.bin",
        mime_type="application/octet-stream",
        spool_path=spool_path,
        expected_size_bytes=4096,
        retention_days=1,
    )

    assert reserved["status"] == "uploading"
    assert service.quota(user_id=7)["used_bytes"] == 4096

    service.abort_upload(file_id=reserved["id"], user_id=7)
    assert service.quota(user_id=7)["used_bytes"] == 0


def test_upload_reservation_limits_concurrent_uploads_per_user(tmp_path, monkeypatch):
    service = _new_service(tmp_path)
    monkeypatch.setattr("backend.services.my_files_service.config.my_files_security.max_uploading_per_user", 1)
    first_path = service.new_spool_path("first.bin")
    service.reserve_upload(
        actor=_user(),
        original_file_name="first.bin",
        mime_type="application/octet-stream",
        spool_path=first_path,
        expected_size_bytes=10,
        retention_days=1,
    )

    with pytest.raises(MyFilesCapacityError, match="concurrent uploads"):
        service.reserve_upload(
            actor=_user(),
            original_file_name="second.bin",
            mime_type="application/octet-stream",
            spool_path=service.new_spool_path("second.bin"),
            expected_size_bytes=10,
            retention_days=1,
        )


def test_create_pending_upload_rejects_unknown_retention(tmp_path):
    service = _new_service(tmp_path)
    spool_path = _stage_upload(service, "report.txt", b"hello")

    with pytest.raises(MyFilesValidationError, match="1, 3, 7, 10 or 30"):
        service.create_pending_upload(
            actor=_user(),
            original_file_name="report.txt",
            mime_type="text/plain",
            spool_path=spool_path,
            original_size_bytes=spool_path.stat().st_size,
            retention_days=31,
        )


def test_upload_processing_deduplicates_by_sha256_and_public_downloads_one_file(tmp_path):
    service = _new_service(tmp_path)
    payload = (b"same payload\n" * 128)
    file_ids = []

    for name in ["first.txt", "second.txt"]:
        spool_path = _stage_upload(service, name, payload)
        created = service.create_pending_upload(
            actor=_user(),
            original_file_name=name,
            mime_type="text/plain",
            spool_path=spool_path,
            original_size_bytes=spool_path.stat().st_size,
            retention_days=10,
        )
        processed = service.process_file(created["id"])
        assert processed is not None
        assert processed["status"] == "ready"
        file_ids.append(created["id"])

    database_url = _sqlite_url(tmp_path / "app.db")
    with app_session(database_url) as session:
        blobs = session.query(AppMyFileBlob).all()
        assert len(blobs) == 1
        assert blobs[0].ref_count == 2

    share = service.create_share(file_id=file_ids[0], user_id=7)
    public_info = service.get_public_file(token=share["token"])
    assert public_info["file_name"] == "first.txt"

    download = service.get_public_download(token=share["token"])
    assert download.file_name == "first.txt"
    assert _read_download(service, download) == payload

    service.delete_file(file_id=file_ids[0], user_id=7)
    with app_session(database_url) as session:
        blob = session.query(AppMyFileBlob).one()
        assert blob.ref_count == 1

    with pytest.raises(MyFilesNotFoundError):
        service.get_public_file(token=share["token"])


def test_download_grant_is_one_time_and_short_lived(tmp_path):
    service = _new_service(tmp_path)
    spool_path = _stage_upload(service, "native.bin", b"native-download")
    created = service.create_pending_upload(
        actor=_user(),
        original_file_name="native.bin",
        mime_type="application/octet-stream",
        spool_path=spool_path,
        original_size_bytes=spool_path.stat().st_size,
        retention_days=3,
    )
    service.process_file(created["id"])

    grant = service.create_download_grant(file_id=created["id"], user_id=7)
    token = grant["token"]
    payload = service.consume_download_grant(token=token)
    assert _read_download(service, payload) == b"native-download"

    with pytest.raises(MyFilesNotFoundError):
        service.consume_download_grant(token=token)

    grant2 = service.create_download_grant(file_id=created["id"], user_id=7)
    assert grant2["token"] != token


def test_create_share_reuses_token_until_rotate(tmp_path):
    service = _new_service(tmp_path)
    spool_path = _stage_upload(service, "stable.txt", b"stable-link")
    created = service.create_pending_upload(
        actor=_user(),
        original_file_name="stable.txt",
        mime_type="text/plain",
        spool_path=spool_path,
        original_size_bytes=spool_path.stat().st_size,
        retention_days=3,
    )
    service.process_file(created["id"])

    first = service.create_share(file_id=created["id"], user_id=7)
    with app_session(_sqlite_url(tmp_path / "app.db")) as session:
        row = session.get(AppMyFile, created["id"])
        assert row.share_token is None
        assert row.share_token_enc
        assert first["token"] not in row.share_token_enc
    second = service.create_share(file_id=created["id"], user_id=7)
    assert second["token"] == first["token"]

    rotated = service.create_share(file_id=created["id"], user_id=7, rotate=True)
    assert rotated["token"] != first["token"]
    service.get_public_file(token=rotated["token"])
    with pytest.raises(MyFilesNotFoundError):
        service.get_public_file(token=first["token"])


def test_legacy_plaintext_share_token_is_encrypted_without_changing_link(tmp_path):
    service = _new_service(tmp_path)
    spool_path = _stage_upload(service, "legacy-share.txt", b"stable legacy link")
    created = service.create_pending_upload(
        actor=_user(),
        original_file_name="legacy-share.txt",
        mime_type="text/plain",
        spool_path=spool_path,
        original_size_bytes=spool_path.stat().st_size,
        retention_days=3,
    )
    service.process_file(created["id"])
    share = service.create_share(file_id=created["id"], user_id=7)

    with app_session(_sqlite_url(tmp_path / "app.db")) as session:
        row = session.get(AppMyFile, created["id"])
        row.share_token = share["token"]
        row.share_token_enc = None

    reused = service.create_share(file_id=created["id"], user_id=7)
    assert reused["token"] == share["token"]
    with app_session(_sqlite_url(tmp_path / "app.db")) as session:
        row = session.get(AppMyFile, created["id"])
        assert row.share_token is None
        assert row.share_token_enc


def test_cleanup_expired_disables_share_and_removes_unreferenced_blob(tmp_path):
    service = _new_service(tmp_path)
    payload = b"expires soon"
    spool_path = _stage_upload(service, "old.txt", payload)
    created = service.create_pending_upload(
        actor=_user(),
        original_file_name="old.txt",
        mime_type="text/plain",
        spool_path=spool_path,
        original_size_bytes=spool_path.stat().st_size,
        retention_days=1,
    )
    processed = service.process_file(created["id"])
    assert processed is not None
    share = service.create_share(file_id=created["id"], user_id=7)

    database_url = _sqlite_url(tmp_path / "app.db")
    with app_session(database_url) as session:
        row = session.get(AppMyFile, created["id"])
        assert row is not None
        blob_path = Path(session.get(AppMyFileBlob, row.blob_id).storage_path)
        row.expires_at = datetime.now(timezone.utc) - timedelta(seconds=1)

    assert blob_path.exists()
    assert service.cleanup_expired() == 1

    with pytest.raises(MyFilesNotFoundError):
        service.get_public_file(token=share["token"])

    with app_session(database_url) as session:
        row = session.get(AppMyFile, created["id"])
        assert row.status == "deleted"
        assert row.share_token is None
        assert row.share_token_enc is None
        assert row.share_token_hash is None
        assert session.query(AppMyFileBlob).count() == 0
    assert not blob_path.exists()


def test_security_scan_blocks_file_before_dedup_or_compression(tmp_path):
    service = MyFilesService(
        database_url=_sqlite_url(tmp_path / "app.db"),
        storage_root=tmp_path / "my-files",
        antivirus_scanner=lambda _path: SecurityScanResult(
            status="blocked",
            engine="test-antivirus",
            detail="test threat",
        ),
    )
    spool_path = _stage_upload(service, "blocked.bin", b"blocked payload")
    created = service.create_pending_upload(
        actor=_user(),
        original_file_name="blocked.bin",
        mime_type="application/octet-stream",
        spool_path=spool_path,
        original_size_bytes=spool_path.stat().st_size,
        retention_days=1,
    )

    assert service.process_file(created["id"]) is None
    with app_session(_sqlite_url(tmp_path / "app.db")) as session:
        row = session.get(AppMyFile, created["id"])
        assert row.status == "failed"
        assert row.security_scan_status == "blocked"
        assert session.query(AppMyFileBlob).count() == 0
    assert not spool_path.exists()


def test_existing_ready_file_is_inaccessible_until_security_backfill_completes(tmp_path, monkeypatch):
    monkeypatch.setattr("backend.services.my_files_service.config.my_files_security.antivirus_fail_closed", True)
    service = _new_service(tmp_path)
    spool_path = _stage_upload(service, "legacy.txt", b"legacy payload")
    created = service.create_pending_upload(
        actor=_user(),
        original_file_name="legacy.txt",
        mime_type="text/plain",
        spool_path=spool_path,
        original_size_bytes=spool_path.stat().st_size,
        retention_days=1,
    )
    service.process_file(created["id"])
    share = service.create_share(file_id=created["id"], user_id=7)

    with app_session(_sqlite_url(tmp_path / "app.db")) as session:
        row = session.get(AppMyFile, created["id"])
        row.security_scan_status = "pending"
        row.security_scanned_at = None

    with pytest.raises(MyFilesNotFoundError):
        service.get_public_file(token=share["token"])

    assert service.process_next_security_backfill() is True
    assert service.get_public_file(token=share["token"])["file_name"] == "legacy.txt"


def test_my_files_audit_records_share_download_and_delete_without_token(tmp_path):
    service = _new_service(tmp_path)
    spool_path = _stage_upload(service, "audit.txt", b"audit payload")
    created = service.create_pending_upload(
        actor=_user(),
        original_file_name="audit.txt",
        mime_type="text/plain",
        spool_path=spool_path,
        original_size_bytes=spool_path.stat().st_size,
        retention_days=1,
    )
    service.process_file(created["id"])
    share = service.create_share(file_id=created["id"], user_id=7)
    service.get_public_download(token=share["token"])
    service.delete_file(file_id=created["id"], user_id=7)

    with app_session(_sqlite_url(tmp_path / "app.db")) as session:
        actions = [row.action for row in session.query(AppMyFileAudit).order_by(AppMyFileAudit.id).all()]
        assert "upload_reserved" in actions
        assert "upload_completed" in actions
        assert "share_created" in actions
        assert "public_download_started" in actions
        assert "deleted" in actions
        serialized = "\n".join(
            f"{row.action} {row.actor_username} {row.ip_address} {row.user_agent}"
            for row in session.query(AppMyFileAudit).all()
        )
        assert share["token"] not in serialized


def test_public_file_metadata_includes_preview_fields(tmp_path):
    service = _new_service(tmp_path)
    spool_path = _stage_upload(service, "report.pdf", b"%PDF-1.4 preview")
    created = service.create_pending_upload(
        actor=_user(),
        original_file_name="report.pdf",
        mime_type="application/pdf",
        spool_path=spool_path,
        original_size_bytes=spool_path.stat().st_size,
        retention_days=3,
    )
    service.process_file(created["id"])
    assert service.process_next_preview_job() is True
    share = service.create_share(file_id=created["id"], user_id=7)

    public_info = service.get_public_file(token=share["token"])
    assert public_info["preview_kind"] == "pdf"
    assert public_info["preview_available"] is True
    assert public_info["preview_max_bytes"] > 0


def test_public_preview_content_returns_pdf_bytes(tmp_path):
    service = _new_service(tmp_path)
    payload = b"%PDF-1.4\n%%EOF"
    spool_path = _stage_upload(service, "report.pdf", payload)
    created = service.create_pending_upload(
        actor=_user(),
        original_file_name="report.pdf",
        mime_type="application/pdf",
        spool_path=spool_path,
        original_size_bytes=spool_path.stat().st_size,
        retention_days=3,
    )
    service.process_file(created["id"])
    assert service.process_next_preview_job() is True
    share = service.create_share(file_id=created["id"], user_id=7)

    content, media_type, filename = service.get_public_preview_content(token=share["token"])
    assert media_type == "application/pdf"
    assert filename == "report.pdf"
    assert content == payload


def test_private_preview_content_is_owner_scoped(tmp_path):
    service = _new_service(tmp_path)
    payload = b"%PDF-1.4\n%%EOF"
    spool_path = _stage_upload(service, "private-report.pdf", payload)
    created = service.create_pending_upload(
        actor=_user(),
        original_file_name="private-report.pdf",
        mime_type="application/pdf",
        spool_path=spool_path,
        original_size_bytes=spool_path.stat().st_size,
        retention_days=3,
    )
    service.process_file(created["id"])
    assert service.process_next_preview_job() is True

    listed = service.list_files(user_id=7)["items"][0]
    assert listed["preview_kind"] == "pdf"
    assert listed["preview_available"] is True
    assert listed["preview_status"] == "ready"

    meta = service.get_file_preview_meta(file_id=created["id"], user_id=7)
    assert meta["preview_kind"] == "pdf"
    assert meta["page_count"] >= 0

    content, media_type, filename = service.get_file_preview_content(file_id=created["id"], user_id=7)
    assert media_type == "application/pdf"
    assert filename == "private-report.pdf"
    assert content == payload

    with pytest.raises(MyFilesNotFoundError):
        service.get_file_preview_meta(file_id=created["id"], user_id=8)


def test_private_excel_preview_source_returns_original_workbook(monkeypatch, tmp_path):
    service = _new_service(tmp_path)
    payload = b"xlsx-bytes"
    spool_path = _stage_upload(service, "table.xlsx", payload)
    created = service.create_pending_upload(
        actor=_user(),
        original_file_name="table.xlsx",
        mime_type="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
        spool_path=spool_path,
        original_size_bytes=spool_path.stat().st_size,
        retention_days=3,
    )
    from backend.services import mail_attachment_preview_service as preview_service

    monkeypatch.setattr(
        preview_service,
        "build_office_preview_artifact",
        lambda **_kwargs: preview_service.PreviewArtifact(
            pdf_bytes=b"%PDF-1.4 excel",
            pdf_filename="table.pdf",
            source_kind="excel",
            page_count=1,
            sheets=[{"index": 0, "name": "Sheet1", "page": 1, "page_end": 1, "page_count": 1, "hidden": False}],
        ),
    )

    service.process_file(created["id"])
    assert service.process_next_preview_job() is True

    meta = service.get_file_preview_meta(file_id=created["id"], user_id=7)
    assert meta["preview_kind"] == "office_pdf"
    assert meta["source_kind"] == "excel"
    assert meta["sheets"][0]["name"] == "Sheet1"

    content, media_type, filename = service.get_file_preview_source(file_id=created["id"], user_id=7)
    assert content == payload
    assert media_type == "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"
    assert filename == "table.xlsx"


def test_public_preview_office_docx_uses_soffice(monkeypatch, tmp_path):
    service = _new_service(tmp_path)
    spool_path = _stage_upload(service, "memo.docx", b"docx-bytes")
    created = service.create_pending_upload(
        actor=_user(),
        original_file_name="memo.docx",
        mime_type="application/vnd.openxmlformats-officedocument.wordprocessingml.document",
        spool_path=spool_path,
        original_size_bytes=spool_path.stat().st_size,
        retention_days=3,
    )
    from backend.services import mail_attachment_preview_service as preview_service

    def fake_build_office_preview_artifact(*, filename, content_type, content):
        assert filename == "memo.docx"
        assert content == b"docx-bytes"
        return preview_service.PreviewArtifact(
            pdf_bytes=b"%PDF-1.4 office",
            pdf_filename="memo.pdf",
            source_kind="word",
            page_count=2,
            sheets=[],
        )

    monkeypatch.setattr(
        preview_service,
        "build_office_preview_artifact",
        fake_build_office_preview_artifact,
    )

    service.process_file(created["id"])
    assert service.process_next_preview_job() is True
    share = service.create_share(file_id=created["id"], user_id=7)

    meta = service.get_public_preview_meta(token=share["token"])
    assert meta["preview_kind"] == "office_pdf"
    assert meta["source_kind"] == "word"
    assert meta["page_count"] == 2

    content, media_type, filename = service.get_public_preview_content(token=share["token"])
    assert media_type == "application/pdf"
    assert filename == "memo.pdf"
    assert content == b"%PDF-1.4 office"


def test_public_file_metadata_disables_office_preview_when_runtime_missing(monkeypatch, tmp_path):
    service = _new_service(tmp_path)
    spool_path = _stage_upload(service, "memo.docx", b"docx-bytes")
    created = service.create_pending_upload(
        actor=_user(),
        original_file_name="memo.docx",
        mime_type="application/vnd.openxmlformats-officedocument.wordprocessingml.document",
        spool_path=spool_path,
        original_size_bytes=spool_path.stat().st_size,
        retention_days=3,
    )
    service.process_file(created["id"])
    share = service.create_share(file_id=created["id"], user_id=7)

    monkeypatch.setenv("MAIL_OFFICE_PREVIEW_ENABLED", "1")
    monkeypatch.setenv("LIBREOFFICE_SOFFICE_PATH", str(tmp_path / "missing-soffice.exe"))

    public_info = service.get_public_file(token=share["token"])

    assert public_info["preview_kind"] == "office_pdf"
    assert public_info["preview_available"] is False


def test_public_preview_wraps_unexpected_office_render_errors(monkeypatch, tmp_path):
    service = _new_service(tmp_path)
    spool_path = _stage_upload(service, "memo.docx", b"docx-bytes")
    created = service.create_pending_upload(
        actor=_user(),
        original_file_name="memo.docx",
        mime_type="application/vnd.openxmlformats-officedocument.wordprocessingml.document",
        spool_path=spool_path,
        original_size_bytes=spool_path.stat().st_size,
        retention_days=3,
    )
    from backend.services import mail_attachment_preview_service as preview_service

    monkeypatch.setattr(
        preview_service,
        "build_office_preview_artifact",
        lambda **_kwargs: (_ for _ in ()).throw(RuntimeError("renderer crashed")),
    )

    service.process_file(created["id"])
    assert service.process_next_preview_job() is True
    share = service.create_share(file_id=created["id"], user_id=7)
    with app_session(_sqlite_url(tmp_path / "app.db")) as session:
        preview = session.query(AppMyFilePreview).one()
        assert preview.status == "error"

    with pytest.raises(MyFilesValidationError, match="Preview is temporarily unavailable"):
        service.get_public_preview_meta(token=share["token"])
