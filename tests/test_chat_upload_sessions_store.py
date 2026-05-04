import sys
import shutil
from contextlib import contextmanager
from datetime import datetime, timedelta, timezone
from pathlib import Path
from uuid import uuid4

import pytest

PROJECT_ROOT = Path(__file__).resolve().parents[1]
WEB_ROOT = PROJECT_ROOT / "WEB-itinvent"

if str(WEB_ROOT) not in sys.path:
    sys.path.insert(0, str(WEB_ROOT))

from backend.chat.upload_sessions import ChatUploadSessionStore


@contextmanager
def _workspace_tempdir():
    base_dir = Path.cwd() / ".tmp_test_chat_upload_sessions"
    base_dir.mkdir(parents=True, exist_ok=True)
    path = base_dir / f"case-{uuid4().hex}"
    path.mkdir(parents=True, exist_ok=False)
    try:
        yield path
    finally:
        shutil.rmtree(path, ignore_errors=True)


def _store(root: Path, *, now: datetime | None = None) -> ChatUploadSessionStore:
    current_now = now or datetime(2026, 5, 4, tzinfo=timezone.utc)
    return ChatUploadSessionStore(
        upload_sessions_root=lambda: root,
        chunk_size_bytes=lambda: 1024,
        ttl_sec=lambda: 3600,
        cleanup_interval_sec=lambda: 600,
        normalize_transfer_encoding=lambda value: str(value or "identity").strip().lower() or "identity",
        now=lambda: current_now,
    )


def test_upload_session_store_keeps_session_paths_inside_root():
    with _workspace_tempdir() as tmp_path:
        store = _store(tmp_path)

        with pytest.raises(ValueError, match="Invalid upload session path"):
            store.session_dir("../escape")

        with pytest.raises(ValueError, match="session_id is required"):
            store.session_dir("")


def test_upload_session_store_keeps_part_paths_inside_session_dir():
    with _workspace_tempdir() as tmp_path:
        store = _store(tmp_path)

        part_path = store.part_path("session-1", "../file")

        assert part_path.parent == store.session_dir("session-1")
        assert part_path.name == "file.part"


def test_upload_session_store_manifest_roundtrip_and_serialization_hides_internal_fields():
    with _workspace_tempdir() as tmp_path:
        store = _store(tmp_path)
        manifest = {
            "session_id": "session-1",
            "conversation_id": "conv-1",
            "current_user_id": 42,
            "body": "hidden",
            "status": "pending",
            "expires_at": "2099-01-01T00:00:00+00:00",
            "files": [{
                "file_id": "file-1",
                "file_name": "report.pdf",
                "mime_type": "application/pdf",
                "size": 12,
                "original_size": 12,
                "transfer_encoding": "identity",
                "storage_name": "file-1_report.pdf",
                "received_bytes": 0,
                "received_chunks": [],
                "chunk_count": 1,
            }],
        }

        store.write_manifest(manifest)
        loaded = store.load_manifest("session-1")
        serialized = store.serialize_manifest(loaded)

        assert loaded["conversation_id"] == "conv-1"
        assert serialized["session_id"] == "session-1"
        assert "conversation_id" not in serialized
        assert "current_user_id" not in serialized
        assert "body" not in serialized
        assert "storage_name" not in serialized["files"][0]


def test_upload_session_store_cleanup_deletes_expired_pending_and_keeps_completed():
    with _workspace_tempdir() as tmp_path:
        now = datetime(2026, 5, 4, tzinfo=timezone.utc)
        store = _store(tmp_path, now=now)
        expired_manifest = {
            "session_id": "expired",
            "status": "pending",
            "expires_at": (now - timedelta(seconds=1)).isoformat(),
            "files": [],
        }
        completed_manifest = {
            "session_id": "completed",
            "status": "completed",
            "expires_at": (now - timedelta(days=1)).isoformat(),
            "files": [],
        }

        store.write_manifest(expired_manifest)
        store.part_path("expired", "file-1").write_bytes(b"payload")
        store.write_manifest(completed_manifest)

        result = store.cleanup_expired(force=True)

        assert result == {"deleted": 1}
        assert not store.session_dir("expired").exists()
        assert store.session_dir("completed").exists()


def test_upload_session_store_loads_malformed_manifest_as_not_found():
    with _workspace_tempdir() as tmp_path:
        store = _store(tmp_path)
        session_dir = store.session_dir("bad")
        session_dir.mkdir(parents=True)
        store.manifest_path("bad").write_text("[1,2,3]", encoding="utf-8")

        with pytest.raises(LookupError, match="Upload session not found"):
            store.load_manifest("bad")
