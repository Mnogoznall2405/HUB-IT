from __future__ import annotations

import hashlib
import json
import os
import time
import uuid
from concurrent.futures import ThreadPoolExecutor
from datetime import datetime, timedelta, timezone
from pathlib import Path

import pytest
from sqlalchemy import select

from backend.appdb.db import app_session, ensure_app_schema_initialized
from backend.appdb.models import AppMyFile, AppMyFileAudit, AppMyFileBlob, AppMyFileDownloadGrant, AppMyFilePreview, AppUser
from backend.models.auth import User
from backend.services import my_files_service as mfs
from backend.services.my_files_service import (
    STORAGE_ZSTD,
    MyFilesCapacityError,
    MyFilesNotFoundError,
    MyFilesService,
    MyFilesValidationError,
    _load_spool_ranges,
    _sha256_file,
    _sha256_file_parallel,
    _store_spool_ranges,
)
from backend.services.my_files_antivirus_service import MyFilesAntivirusError, SecurityScanResult
from backend.services.secret_crypto_service import _build_fernet


@pytest.fixture(autouse=True)
def _configure_share_token_key(monkeypatch):
    monkeypatch.setenv("MY_FILES_SHARE_TOKEN_KEY", "test-my-files-share-token-key")
    _build_fernet.cache_clear()
    yield
    _build_fernet.cache_clear()


@pytest.fixture(autouse=True)
def _prebuilt_app_schema(prebuilt_app_db):
    return prebuilt_app_db


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


def test_upload_reservation_accepts_file_larger_than_former_one_gib_limit(tmp_path):
    service = _new_service(tmp_path)
    size = (1024**3) + 1

    reserved = service.reserve_upload(
        actor=_user(),
        original_file_name="large.bin",
        mime_type="application/octet-stream",
        spool_path=service.new_spool_path("large.bin"),
        expected_size_bytes=size,
        retention_days=1,
    )

    assert reserved["status"] == "uploading"
    assert service.quota(user_id=7)["used_bytes"] == size
    service.abort_upload(file_id=reserved["id"], user_id=7)


def test_chunked_upload_appends_retries_idempotently_and_completes(tmp_path):
    service = _new_service(tmp_path)
    spool_path = service.new_spool_path("chunked.bin")
    reserved = service.reserve_upload(
        actor=_user(),
        original_file_name="chunked.bin",
        mime_type="application/octet-stream",
        spool_path=spool_path,
        expected_size_bytes=11,
        retention_days=1,
    )

    initial = service.get_upload_session(file_id=reserved["id"], user_id=7)
    first = service.append_upload_chunk(
        file_id=reserved["id"],
        user_id=7,
        offset=0,
        payload=b"hello ",
    )
    retried = service.append_upload_chunk(
        file_id=reserved["id"],
        user_id=7,
        offset=0,
        payload=b"hello ",
    )
    final = service.append_upload_chunk(
        file_id=reserved["id"],
        user_id=7,
        offset=6,
        payload=b"world",
    )
    completed = service.complete_upload(
        file_id=reserved["id"],
        user_id=7,
        actual_size_bytes=final["uploaded_bytes"],
    )

    assert initial["uploaded_bytes"] == 0
    assert first["uploaded_bytes"] == 6
    assert retried["uploaded_bytes"] == 6
    assert final["uploaded_bytes"] == 11
    assert final["complete"] is True
    assert spool_path.read_bytes() == b"hello world"
    assert completed["status"] == "queued"


def test_chunked_upload_accepts_out_of_order_and_rejects_mismatched_retry(tmp_path):
    service = _new_service(tmp_path)
    spool_path = service.new_spool_path("chunked.bin")
    reserved = service.reserve_upload(
        actor=_user(),
        original_file_name="chunked.bin",
        mime_type="application/octet-stream",
        spool_path=spool_path,
        expected_size_bytes=10,
        retention_days=1,
    )
    service.append_upload_chunk(file_id=reserved["id"], user_id=7, offset=0, payload=b"hello")

    gapped = service.append_upload_chunk(file_id=reserved["id"], user_id=7, offset=6, payload=b"xyzw")
    assert gapped["uploaded_bytes"] == 5
    assert gapped["complete"] is False

    with pytest.raises(MyFilesValidationError, match="does not match"):
        service.append_upload_chunk(file_id=reserved["id"], user_id=7, offset=0, payload=b"HELLO")
    with pytest.raises(MyFilesValidationError, match="overlaps"):
        service.append_upload_chunk(file_id=reserved["id"], user_id=7, offset=4, payload=b"!!")

    filled = service.append_upload_chunk(file_id=reserved["id"], user_id=7, offset=5, payload=b"!")
    assert filled["uploaded_bytes"] == 10
    assert filled["complete"] is True
    assert spool_path.read_bytes() == b"hello!xyzw"

    completed = service.complete_upload(
        file_id=reserved["id"],
        user_id=7,
        actual_size_bytes=filled["uploaded_bytes"],
    )
    assert completed["status"] == "queued"


def test_chunked_upload_incomplete_ranges_cannot_complete(tmp_path):
    service = _new_service(tmp_path)
    spool_path = service.new_spool_path("chunked.bin")
    reserved = service.reserve_upload(
        actor=_user(),
        original_file_name="chunked.bin",
        mime_type="application/octet-stream",
        spool_path=spool_path,
        expected_size_bytes=10,
        retention_days=1,
    )
    service.append_upload_chunk(file_id=reserved["id"], user_id=7, offset=0, payload=b"hello")
    service.append_upload_chunk(file_id=reserved["id"], user_id=7, offset=6, payload=b"xyzw")

    with pytest.raises(MyFilesValidationError, match="incomplete"):
        service.complete_upload(file_id=reserved["id"], user_id=7, actual_size_bytes=10)


def test_chunked_upload_accepts_parallel_chunks_without_lost_ranges(tmp_path):
    service = _new_service(tmp_path)
    spool_path = service.new_spool_path("parallel.bin")
    chunk_size = 4 * 1024 * 1024
    chunks = [
        hashlib.sha256(f"chunk-{index}".encode("utf-8")).digest() * (chunk_size // 32)
        for index in range(8)
    ]
    expected_payload = b"".join(chunks)
    reserved = service.reserve_upload(
        actor=_user(),
        original_file_name="parallel.bin",
        mime_type="application/octet-stream",
        spool_path=spool_path,
        expected_size_bytes=len(expected_payload),
        retention_days=1,
    )

    def send_chunk(index: int):
        return service.append_upload_chunk(
            file_id=reserved["id"],
            user_id=7,
            offset=index * chunk_size,
            payload=chunks[index],
        )

    with ThreadPoolExecutor(max_workers=4) as executor:
        list(executor.map(send_chunk, range(len(chunks))))

    session_state = service.get_upload_session(file_id=reserved["id"], user_id=7)
    assert session_state["complete"] is True
    assert session_state["uploaded_bytes"] == len(expected_payload)
    assert session_state["ranges"] == [[0, len(expected_payload)]]
    stored = spool_path.read_bytes()
    assert stored == expected_payload
    assert hashlib.sha256(stored).hexdigest() == hashlib.sha256(expected_payload).hexdigest()

    completed = service.complete_upload(
        file_id=reserved["id"],
        user_id=7,
        actual_size_bytes=len(expected_payload),
    )
    assert completed["status"] == "queued"


def test_store_spool_ranges_retries_transient_replace_failures(tmp_path, monkeypatch):
    parts_path = tmp_path / "spool" / "payload.bin.parts.json"
    parts_path.parent.mkdir(parents=True)
    real_replace = Path.replace
    attempts = {"count": 0}

    def flaky_replace(self, target):
        attempts["count"] += 1
        if attempts["count"] < 3:
            raise PermissionError(13, "being used by another process")
        return real_replace(self, target)

    monkeypatch.setattr(Path, "replace", flaky_replace)
    _store_spool_ranges(parts_path, [[0, 8]])

    assert attempts["count"] == 3
    assert json.loads(parts_path.read_text(encoding="utf-8")) == [[0, 8]]
    assert not list(parts_path.parent.glob("*.tmp"))


def test_store_spool_ranges_failure_cleans_tmp_and_keeps_journal(tmp_path, monkeypatch):
    parts_path = tmp_path / "spool" / "payload.bin.parts.json"
    parts_path.parent.mkdir(parents=True)
    _store_spool_ranges(parts_path, [[0, 8]])

    def always_fail(_self, _target):
        raise PermissionError(13, "being used by another process")

    monkeypatch.setattr(Path, "replace", always_fail)
    with pytest.raises(MyFilesCapacityError):
        _store_spool_ranges(parts_path, [[0, 16]])

    assert json.loads(parts_path.read_text(encoding="utf-8")) == [[0, 8]]
    assert not list(parts_path.parent.glob("*.tmp"))


def test_load_spool_ranges_read_failure_is_not_treated_as_empty(tmp_path, monkeypatch):
    parts_path = tmp_path / "spool" / "payload.bin.parts.json"
    parts_path.parent.mkdir(parents=True)
    _store_spool_ranges(parts_path, [[0, 8]])

    def always_fail_read(_self, *_args, **_kwargs):
        raise PermissionError(13, "being used by another process")

    monkeypatch.setattr(Path, "read_text", always_fail_read)
    with pytest.raises(MyFilesCapacityError):
        _load_spool_ranges(parts_path)

    monkeypatch.undo()
    assert _load_spool_ranges(parts_path) == [[0, 8]]


def test_load_spool_ranges_missing_file_reads_as_empty(tmp_path):
    assert _load_spool_ranges(tmp_path / "absent.parts.json") == []


def test_load_spool_ranges_corrupt_journal_does_not_wipe_progress(tmp_path):
    parts_path = tmp_path / "spool" / "payload.bin.parts.json"
    parts_path.parent.mkdir(parents=True)
    parts_path.write_text("{corrupt", encoding="utf-8")
    with pytest.raises(MyFilesCapacityError):
        _load_spool_ranges(parts_path)


def test_chunked_upload_survives_parallel_status_reads_without_lost_ranges(tmp_path):
    service = _new_service(tmp_path)
    spool_path = service.new_spool_path("polling.bin")
    chunk_size = 4 * 1024 * 1024
    chunks = [
        hashlib.sha256(f"poll-{index}".encode("utf-8")).digest() * (chunk_size // 32)
        for index in range(8)
    ]
    expected_payload = b"".join(chunks)
    reserved = service.reserve_upload(
        actor=_user(),
        original_file_name="polling.bin",
        mime_type="application/octet-stream",
        spool_path=spool_path,
        expected_size_bytes=len(expected_payload),
        retention_days=1,
    )

    def send_chunk(index: int):
        result = service.append_upload_chunk(
            file_id=reserved["id"],
            user_id=7,
            offset=index * chunk_size,
            payload=chunks[index],
        )
        # Status reads interleave with writes in production; the upload journal
        # must never lose a recorded range because of them.
        service.get_upload_session(file_id=reserved["id"], user_id=7)
        return result

    with ThreadPoolExecutor(max_workers=4) as executor:
        list(executor.map(send_chunk, range(len(chunks))))

    session_state = service.get_upload_session(file_id=reserved["id"], user_id=7)
    assert session_state["complete"] is True
    assert session_state["uploaded_bytes"] == len(expected_payload)
    assert session_state["ranges"] == [[0, len(expected_payload)]]
    assert not list(spool_path.parent.glob(f"{spool_path.name}.*.tmp"))
    assert spool_path.read_bytes() == expected_payload


def test_chunked_upload_is_owner_scoped(tmp_path):
    service = _new_service(tmp_path)
    reserved = service.reserve_upload(
        actor=_user(),
        original_file_name="private.bin",
        mime_type="application/octet-stream",
        spool_path=service.new_spool_path("private.bin"),
        expected_size_bytes=5,
        retention_days=1,
    )

    with pytest.raises(MyFilesNotFoundError):
        service.append_upload_chunk(file_id=reserved["id"], user_id=8, offset=0, payload=b"hello")


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
        # корзина удерживает блоб до окончательной очистки
        assert blob.ref_count == 2

    service.purge_file(file_id=file_ids[0], user_id=7)
    with app_session(database_url) as session:
        blob = session.query(AppMyFileBlob).one()
        assert blob.ref_count == 1

    with pytest.raises(MyFilesNotFoundError):
        service.get_public_file(token=share["token"])


def test_zstd_compression_skips_already_compressed_extensions(tmp_path):
    service = _new_service(tmp_path)
    payload = b"compressible text " * 4096
    source = tmp_path / "archive.zip"
    source.write_bytes(payload)

    assert service._try_zstd_compression(source, len(payload), "application/zip", "archive.zip") is None
    stored = service._build_stored_payload(source, "archive.zip", "application/zip", "sha", len(payload))
    assert stored.mode == "stored"


def test_zstd_compression_skips_source_above_configured_max(monkeypatch, tmp_path):
    service = _new_service(tmp_path)
    monkeypatch.setattr(
        "backend.services.my_files_service.config.my_files_security.zstd_max_source_bytes",
        16,
    )
    payload = b"compressible text " * 4096
    source = tmp_path / "big.txt"
    source.write_bytes(payload)

    assert service._try_zstd_compression(source, len(payload), "text/plain", "big.txt") is None
    stored = service._build_stored_payload(source, "big.txt", "text/plain", "sha", len(payload))
    assert stored.mode == "stored"


def test_zstd_compression_rejects_candidate_below_min_savings(monkeypatch, tmp_path):
    service = _new_service(tmp_path)
    monkeypatch.setattr(
        "backend.services.my_files_service.config.my_files_security.zstd_min_savings_percent",
        100,
    )
    payload = b"compressible text " * 4096
    source = tmp_path / "data.txt"
    source.write_bytes(payload)

    assert service._try_zstd_compression(source, len(payload), "text/plain", "data.txt") is None
    stored = service._build_stored_payload(source, "data.txt", "text/plain", "sha", len(payload))
    assert stored.mode == "stored"


def test_download_grant_is_retryable_until_expiry(tmp_path):
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

    retry = service.consume_download_grant(token=token)
    assert _read_download(service, retry) == b"native-download"

    database_url = _sqlite_url(tmp_path / "app.db")
    with app_session(database_url) as session:
        grant_row = session.query(AppMyFileDownloadGrant).one()
        grant_row.expires_at = datetime.now(timezone.utc) - timedelta(seconds=1)

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
        blob_path = service._resolve_stored_path(session.get(AppMyFileBlob, row.blob_id).storage_path)
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


def test_cleanup_expired_survives_preview_with_empty_path(tmp_path):
    service = _new_service(tmp_path)
    spool_path = _stage_upload(service, "old-preview.txt", b"payload")
    created = service.create_pending_upload(
        actor=_user(),
        original_file_name="old-preview.txt",
        mime_type="text/plain",
        spool_path=spool_path,
        original_size_bytes=spool_path.stat().st_size,
        retention_days=1,
    )
    processed = service.process_file(created["id"])
    assert processed is not None

    database_url = _sqlite_url(tmp_path / "app.db")
    with app_session(database_url) as session:
        row = session.get(AppMyFile, created["id"])
        session.add(AppMyFilePreview(
            blob_id=row.blob_id,
            status="error",
            preview_kind="unsupported",
            preview_path="",
        ))
        row.expires_at = datetime.now(timezone.utc) - timedelta(seconds=1)

    assert service.cleanup_expired() == 1
    with app_session(database_url) as session:
        row = session.get(AppMyFile, created["id"])
        assert row.status == "deleted"
        assert session.query(AppMyFilePreview).count() == 0
        assert session.query(AppMyFileBlob).count() == 0


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


def test_security_scan_error_records_failing_engine(tmp_path):
    def timed_out_kaspersky(_path):
        raise MyFilesAntivirusError(
            "Kaspersky scan timed out",
            engine="kaspersky-endpoint-security",
        )

    service = MyFilesService(
        database_url=_sqlite_url(tmp_path / "app.db"),
        storage_root=tmp_path / "my-files",
        antivirus_scanner=timed_out_kaspersky,
    )
    spool_path = _stage_upload(service, "large.7z", b"large payload")
    created = service.create_pending_upload(
        actor=_user(),
        original_file_name="large.7z",
        mime_type="application/x-7z-compressed",
        spool_path=spool_path,
        original_size_bytes=spool_path.stat().st_size,
        retention_days=1,
    )

    assert service.process_file(created["id"]) is None
    with app_session(_sqlite_url(tmp_path / "app.db")) as session:
        row = session.get(AppMyFile, created["id"])
        assert row.status == "failed"
        assert row.security_scan_status == "error"
        assert row.security_scan_engine == "kaspersky-endpoint-security"


def test_size_limit_skip_passes_fail_closed_pipeline(tmp_path, monkeypatch):
    monkeypatch.setattr(
        "backend.services.my_files_service.config.my_files_security.antivirus_fail_closed", True
    )
    service = MyFilesService(
        database_url=_sqlite_url(tmp_path / "app.db"),
        storage_root=tmp_path / "my-files",
        antivirus_scanner=lambda _path: SecurityScanResult(status="skipped", engine="size-limit"),
    )
    spool_path = _stage_upload(service, "huge.img", b"huge payload")
    created = service.create_pending_upload(
        actor=_user(),
        original_file_name="huge.img",
        mime_type="application/octet-stream",
        spool_path=spool_path,
        original_size_bytes=spool_path.stat().st_size,
        retention_days=1,
    )

    result = service.process_file(created["id"])
    assert result is not None and result["status"] == "ready"
    with app_session(_sqlite_url(tmp_path / "app.db")) as session:
        row = session.get(AppMyFile, created["id"])
        assert row.security_scan_status == "skipped"
        assert row.security_scan_engine == "size-limit"
    share = service.create_share(file_id=created["id"], user_id=7)
    assert share["token"]


def test_disabled_scan_skip_still_blocked_when_fail_closed(tmp_path, monkeypatch):
    monkeypatch.setattr(
        "backend.services.my_files_service.config.my_files_security.antivirus_fail_closed", True
    )
    service = MyFilesService(
        database_url=_sqlite_url(tmp_path / "app.db"),
        storage_root=tmp_path / "my-files",
        antivirus_scanner=lambda _path: SecurityScanResult(status="skipped", engine="disabled"),
    )
    spool_path = _stage_upload(service, "plain.bin", b"plain payload")
    created = service.create_pending_upload(
        actor=_user(),
        original_file_name="plain.bin",
        mime_type="application/octet-stream",
        spool_path=spool_path,
        original_size_bytes=spool_path.stat().st_size,
        retention_days=1,
    )

    assert service.process_file(created["id"]) is None
    with app_session(_sqlite_url(tmp_path / "app.db")) as session:
        row = session.get(AppMyFile, created["id"])
        assert row.status == "failed"
        assert row.security_scan_status == "skipped"


def test_list_file_audit_tracks_public_downloads_with_ip(tmp_path):
    service = _new_service(tmp_path)
    spool_path = _stage_upload(service, "audit.bin", b"audit payload")
    created = service.create_pending_upload(
        actor=_user(),
        original_file_name="audit.bin",
        mime_type="application/octet-stream",
        spool_path=spool_path,
        original_size_bytes=spool_path.stat().st_size,
        retention_days=1,
    )
    service.process_file(created["id"])
    share = service.create_share(file_id=created["id"], user_id=7)

    service.get_public_download(
        token=share["token"],
        meta=mfs.MyFilesRequestMeta(ip_address="203.0.113.10", user_agent="pytest-agent"),
    )
    service.get_public_download(
        token=share["token"],
        meta=mfs.MyFilesRequestMeta(ip_address="203.0.113.11", user_agent=""),
    )

    audit = service.list_file_audit(file_id=created["id"], user_id=7)
    assert audit["download_count"] == 2
    assert audit["unique_download_ips"] == 2
    actions = [item["action"] for item in audit["items"]]
    assert actions.count("public_download_started") == 2
    download_items = [i for i in audit["items"] if i["action"] == "public_download_started"]
    assert {i["ip_address"] for i in download_items} == {"203.0.113.10", "203.0.113.11"}
    assert any(i["user_agent"] == "pytest-agent" for i in download_items)

    with pytest.raises(MyFilesNotFoundError):
        service.list_file_audit(file_id=created["id"], user_id=8)


def test_sha256_parallel_matches_sequential_digest(tmp_path):
    payload = tmp_path / "big.bin"
    data = os.urandom(200 * 1024)
    payload.write_bytes(data)
    digest, size = _sha256_file_parallel(payload, block_size=16 * 1024, readers=4)
    assert digest == hashlib.sha256(data).hexdigest()
    assert size == len(data)


def test_sha256_file_uses_parallel_readers_for_large_unc(tmp_path, monkeypatch):
    monkeypatch.setattr(mfs, "_is_unc", lambda _p: True)
    monkeypatch.setattr(mfs, "_SHA256_PARALLEL_MIN_BYTES", 0)
    calls = []
    original = mfs._sha256_file_parallel

    def spy(path, **kwargs):
        calls.append(1)
        return original(path, **kwargs)

    monkeypatch.setattr(mfs, "_sha256_file_parallel", spy)
    payload = tmp_path / "p.bin"
    payload.write_bytes(b"abc")
    digest, size = _sha256_file(payload)
    assert calls == [1]
    assert digest == hashlib.sha256(b"abc").hexdigest()
    assert size == 3


def test_sha256_file_stays_sequential_below_threshold(tmp_path, monkeypatch):
    monkeypatch.setattr(mfs, "_is_unc", lambda _p: True)
    monkeypatch.setattr(mfs, "_SHA256_PARALLEL_MIN_BYTES", 10)
    monkeypatch.setattr(
        mfs,
        "_sha256_file_parallel",
        lambda *a, **kw: pytest.fail("parallel path must not run below threshold"),
    )
    payload = tmp_path / "small.bin"
    payload.write_bytes(b"tiny")
    digest, size = _sha256_file(payload)
    assert digest == hashlib.sha256(b"tiny").hexdigest()
    assert size == 4


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
        assert "trashed" in actions
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


def test_quota_uses_per_user_override_and_caps_at_400_gib(tmp_path):
    service = _new_service(tmp_path)
    ensure_app_schema_initialized(_sqlite_url(tmp_path / "app.db"))
    with app_session(_sqlite_url(tmp_path / "app.db")) as session:
        session.add(AppUser(id=7, username="user-7", my_files_quota_bytes=100 * (1024**3)))
        session.add(AppUser(id=8, username="user-8", my_files_quota_bytes=900 * (1024**3)))
        session.flush()

    assert service.quota(user_id=7)["limit_bytes"] == 100 * (1024**3)
    assert service.quota(user_id=8)["limit_bytes"] == 400 * (1024**3)
    assert service.quota(user_id=9)["limit_bytes"] == 50 * (1024**3)


def test_reserve_upload_respects_per_user_quota_override(tmp_path):
    service = _new_service(tmp_path)
    ensure_app_schema_initialized(_sqlite_url(tmp_path / "app.db"))
    with app_session(_sqlite_url(tmp_path / "app.db")) as session:
        session.add(AppUser(id=7, username="user-7", my_files_quota_bytes=4096))
        session.flush()

    reserved = service.reserve_upload(
        actor=_user(),
        original_file_name="a.bin",
        mime_type="application/octet-stream",
        spool_path=service.new_spool_path("a.bin"),
        expected_size_bytes=4096,
        retention_days=1,
    )
    assert reserved["status"] == "uploading"

    with pytest.raises(MyFilesValidationError, match="quota"):
        service.reserve_upload(
            actor=_user(),
            original_file_name="b.bin",
            mime_type="application/octet-stream",
            spool_path=service.new_spool_path("b.bin"),
            expected_size_bytes=1,
            retention_days=1,
        )


def test_reserve_upload_allows_large_file_within_custom_quota(tmp_path):
    service = _new_service(tmp_path)
    ensure_app_schema_initialized(_sqlite_url(tmp_path / "app.db"))
    with app_session(_sqlite_url(tmp_path / "app.db")) as session:
        session.add(AppUser(id=7, username="user-7", my_files_quota_bytes=100 * (1024**3)))
        session.flush()

    # 20 GiB used to hit the former fixed 10 GiB per-file cap; now the user
    # quota is the only bound.
    size = 20 * (1024**3)
    reserved = service.reserve_upload(
        actor=_user(),
        original_file_name="disk-image.img.gz",
        mime_type="application/gzip",
        spool_path=service.new_spool_path("disk-image.img.gz"),
        expected_size_bytes=size,
        retention_days=1,
    )
    assert reserved["status"] == "uploading"
    assert service.quota(user_id=7)["used_bytes"] == size
    service.abort_upload(file_id=reserved["id"], user_id=7)


def test_reserve_upload_rejects_file_beyond_default_quota(tmp_path):
    service = _new_service(tmp_path)
    with pytest.raises(MyFilesValidationError, match="quota"):
        service.reserve_upload(
            actor=_user(),
            original_file_name="huge.bin",
            mime_type="application/octet-stream",
            spool_path=service.new_spool_path("huge.bin"),
            expected_size_bytes=(50 * (1024**3)) + 1,
            retention_days=1,
        )


def test_reserve_upload_reuses_live_reservation_atomically(tmp_path):
    service = _new_service(tmp_path)
    ensure_app_schema_initialized(_sqlite_url(tmp_path / "app.db"))
    with app_session(_sqlite_url(tmp_path / "app.db")) as session:
        session.add(AppUser(id=7, username="user-7", my_files_quota_bytes=100 * (1024**3)))
        session.flush()

    size = 1024

    def reserve() -> str:
        result = service.reserve_upload(
            actor=_user(),
            original_file_name="retried.bin",
            mime_type="application/octet-stream",
            spool_path=service.new_spool_path("retried.bin"),
            expected_size_bytes=size,
            retention_days=1,
            reuse_existing=True,
        )
        return str(result["id"])

    with ThreadPoolExecutor(max_workers=4) as executor:
        ids = list(executor.map(lambda _index: reserve(), range(8)))

    assert len(set(ids)) == 1
    with app_session(_sqlite_url(tmp_path / "app.db")) as session:
        live = session.scalars(
            select(AppMyFile).where(AppMyFile.original_file_name == "retried.bin")
        ).all()
    assert len(live) == 1
    assert live[0].id == ids[0]


def test_abort_upload_removes_spool_and_rejects_late_chunks(tmp_path):
    service = _new_service(tmp_path)
    spool_path = service.new_spool_path("aborted.bin")
    reserved = service.reserve_upload(
        actor=_user(),
        original_file_name="aborted.bin",
        mime_type="application/octet-stream",
        spool_path=spool_path,
        expected_size_bytes=16,
        retention_days=1,
    )
    service.append_upload_chunk(file_id=reserved["id"], user_id=7, offset=0, payload=b"0123456789abcdef")
    parts_path = spool_path.with_name(f"{spool_path.name}.parts.json")

    service.abort_upload(file_id=reserved["id"], user_id=7)

    assert not spool_path.exists()
    assert not parts_path.exists()
    with pytest.raises(MyFilesValidationError, match="not active"):
        service.append_upload_chunk(file_id=reserved["id"], user_id=7, offset=0, payload=b"0123456789abcdef")


def test_cleanup_stale_uploads_keeps_refreshed_reservation(tmp_path):
    service = _new_service(tmp_path)
    spool_path = service.new_spool_path("stale.bin")
    reserved = service.reserve_upload(
        actor=_user(),
        original_file_name="stale.bin",
        mime_type="application/octet-stream",
        spool_path=spool_path,
        expected_size_bytes=8,
        retention_days=1,
    )
    service.append_upload_chunk(file_id=reserved["id"], user_id=7, offset=0, payload=b"12345678")
    stale_time = datetime.now(timezone.utc) - timedelta(hours=3)
    database_url = _sqlite_url(tmp_path / "app.db")
    with app_session(database_url) as session:
        row = session.get(AppMyFile, reserved["id"])
        row.updated_at = stale_time
        session.flush()
        # Simulate a chunk arriving right before the cleanup scan.
        row.updated_at = datetime.now(timezone.utc)
        session.flush()

    assert service.cleanup_stale_uploads(limit=10) == 0
    assert spool_path.exists()
    with app_session(database_url) as session:
        row = session.get(AppMyFile, reserved["id"])
        assert row.status == "uploading"

    with app_session(database_url) as session:
        row = session.get(AppMyFile, reserved["id"])
        row.updated_at = stale_time
        session.flush()

    assert service.cleanup_stale_uploads(limit=10) == 1
    assert not spool_path.exists()
    with app_session(database_url) as session:
        row = session.get(AppMyFile, reserved["id"])
        assert row.status == "failed"
        assert row.error_text == "Upload reservation expired"


def test_cleanup_orphan_tmp_files_removes_stale_tmp_only(tmp_path):
    service = _new_service(tmp_path)
    spool_path = service.new_spool_path("tmp-orphan.bin")
    parts_path = spool_path.with_name(f"{spool_path.name}.parts.json")
    stale_tmp = parts_path.with_name(f"{parts_path.name}.{uuid.uuid4().hex}.tmp")
    stale_tmp.write_text("[]", encoding="utf-8")
    old = time.time() - 7200
    os.utime(stale_tmp, (old, old))
    fresh_tmp = parts_path.with_name(f"{parts_path.name}.{uuid.uuid4().hex}.tmp")
    fresh_tmp.write_text("[]", encoding="utf-8")

    stats = service.cleanup_orphan_tmp_files()

    assert stats["removed"] >= 1
    assert not stale_tmp.exists()
    assert fresh_tmp.exists()


def test_cleanup_orphan_tmp_files_is_throttled(tmp_path):
    service = _new_service(tmp_path)
    assert service.cleanup_orphan_tmp_files()["scanned"] >= 0
    assert service.cleanup_orphan_tmp_files() == {"scanned": 0, "removed": 0, "errors": 0}


def test_reserve_upload_throttles_stale_cleanup(tmp_path, monkeypatch):
    service = _new_service(tmp_path)
    calls: list[int] = []
    original = service.cleanup_stale_uploads

    def counted(*, limit: int = 100) -> int:
        calls.append(limit)
        return original(limit=limit)

    monkeypatch.setattr(service, "cleanup_stale_uploads", counted)
    for index in range(3):
        reserved = service.reserve_upload(
            actor=_user(),
            original_file_name=f"burst-{index}.bin",
            mime_type="application/octet-stream",
            spool_path=service.new_spool_path(f"burst-{index}.bin"),
            expected_size_bytes=1,
            retention_days=1,
        )
        service.abort_upload(file_id=reserved["id"], user_id=7)
    assert len(calls) == 1


def test_spool_ranges_without_journal_are_not_inferred_from_file_size(tmp_path):
    service = _new_service(tmp_path)
    spool_path = service.new_spool_path("no-journal.bin")
    spool_path.write_bytes(b"0123456789abcdef")
    assert service._spool_ranges(spool_path) == []
    spool_path.with_name(f"{spool_path.name}.parts.json").unlink(missing_ok=True)
    reserved = service.reserve_upload(
        actor=_user(),
        original_file_name="no-journal.bin",
        mime_type="application/octet-stream",
        spool_path=spool_path,
        expected_size_bytes=16,
        retention_days=1,
    )
    state = service.get_upload_session(file_id=reserved["id"], user_id=7)
    assert state["uploaded_bytes"] == 0
    assert state["complete"] is False
    assert state["ranges"] == []


def test_delete_spool_payload_survives_permission_error(tmp_path, monkeypatch):
    service = _new_service(tmp_path)
    spool_path = service.new_spool_path("locked.bin")
    reserved = service.reserve_upload(
        actor=_user(),
        original_file_name="locked.bin",
        mime_type="application/octet-stream",
        spool_path=spool_path,
        expected_size_bytes=4,
        retention_days=1,
    )
    service.append_upload_chunk(file_id=reserved["id"], user_id=7, offset=0, payload=b"abcd")

    def deny_unlink(self, missing_ok: bool = False):
        raise PermissionError("file is locked by antivirus")

    monkeypatch.setattr(type(spool_path), "unlink", deny_unlink)
    service.abort_upload(file_id=reserved["id"], user_id=7)
    with app_session(_sqlite_url(tmp_path / "app.db")) as session:
        row = session.get(AppMyFile, reserved["id"])
        assert row.status == "failed"
    from backend.services.user_service import UserService

    assert UserService._validate_my_files_quota_bytes(None) is None
    assert UserService._validate_my_files_quota_bytes("") is None
    assert UserService._validate_my_files_quota_bytes(1024) == 1024
    with pytest.raises(ValueError):
        UserService._validate_my_files_quota_bytes(0)
    with pytest.raises(ValueError):
        UserService._validate_my_files_quota_bytes(500 * (1024**3))
    with pytest.raises(ValueError):
        UserService._validate_my_files_quota_bytes("not-a-number")
