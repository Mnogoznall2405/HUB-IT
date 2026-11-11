"""Upload session chunk streaming through ChatUploadOrchestrator."""
from __future__ import annotations

import importlib
import sys
from pathlib import Path
from threading import RLock
from types import SimpleNamespace
from unittest.mock import MagicMock

import pytest

PROJECT_ROOT = Path(__file__).resolve().parents[1]
WEB_ROOT = PROJECT_ROOT / "WEB-itinvent"

if str(WEB_ROOT) not in sys.path:
    sys.path.insert(0, str(WEB_ROOT))

chat_upload_orchestrator_module = importlib.import_module("backend.chat.chat_upload_orchestrator")


@pytest.fixture
def upload_orchestrator(tmp_path: Path) -> tuple[SimpleNamespace, object]:
    service = SimpleNamespace(
        upload_session_chunk_size_bytes=8,
        upload_session_ttl_sec=3600,
    )
    lock = RLock()
    service._get_upload_session_lock = MagicMock(return_value=lock)
    service._maybe_cleanup_upload_sessions = MagicMock()
    service._load_upload_session_manifest = MagicMock()
    service._require_upload_session_access = MagicMock()
    service._ensure_upload_session_active = MagicMock()
    service._find_upload_session_file = MagicMock(side_effect=lambda manifest, file_id: next(
        item for item in manifest["files"] if item["file_id"] == file_id
    ))
    service._write_upload_session_manifest = MagicMock()
    service._upload_sessions = SimpleNamespace(
        part_path=lambda session_id, file_id: tmp_path / session_id / f"{file_id}.part"
    )
    orchestrator = chat_upload_orchestrator_module.ChatUploadOrchestrator(service)
    return service, orchestrator


def test_upload_session_chunk_writes_part_file(upload_orchestrator: tuple[SimpleNamespace, object], tmp_path: Path) -> None:
    service, orchestrator = upload_orchestrator
    payload = b"12345"
    manifest = {
        "session_id": "sess-1",
        "status": "pending",
        "files": [
            {
                "file_id": "file-1",
                "size": 5,
                "chunk_count": 1,
                "received_bytes": 0,
                "received_chunks": [],
            }
        ],
    }
    service._load_upload_session_manifest.return_value = manifest

    result = orchestrator.upload_session_chunk(
        current_user_id=1,
        session_id="sess-1",
        file_id="file-1",
        chunk_index=0,
        offset=0,
        payload=payload,
    )

    part_path = tmp_path / "sess-1" / "file-1.part"
    assert part_path.exists()
    assert part_path.read_bytes() == payload
    assert result["already_present"] is False
    assert result["file_complete"] is True
    service._write_upload_session_manifest.assert_called_once()


def test_upload_session_chunk_is_idempotent_for_duplicate_chunk(
    upload_orchestrator: tuple[SimpleNamespace, object],
    tmp_path: Path,
) -> None:
    service, orchestrator = upload_orchestrator
    payload = b"12345"
    manifest = {
        "session_id": "sess-1",
        "status": "pending",
        "files": [
            {
                "file_id": "file-1",
                "size": 5,
                "chunk_count": 1,
                "received_bytes": 5,
                "received_chunks": [0],
            }
        ],
    }
    service._load_upload_session_manifest.return_value = manifest

    result = orchestrator.upload_session_chunk(
        current_user_id=1,
        session_id="sess-1",
        file_id="file-1",
        chunk_index=0,
        offset=0,
        payload=payload,
    )

    assert result["already_present"] is True
    assert result["file_complete"] is True
    service._write_upload_session_manifest.assert_not_called()
