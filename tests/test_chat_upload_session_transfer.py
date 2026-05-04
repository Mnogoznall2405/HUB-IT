import sys
from pathlib import Path

import pytest

PROJECT_ROOT = Path(__file__).resolve().parents[1]
WEB_ROOT = PROJECT_ROOT / "WEB-itinvent"

if str(WEB_ROOT) not in sys.path:
    sys.path.insert(0, str(WEB_ROOT))

from backend.chat.upload_session_transfer import (
    plan_upload_session_chunk,
    validate_upload_session_file_complete,
)


def test_upload_chunk_plan_accepts_sequential_chunk_and_reports_completion():
    file_payload = {
        "file_id": "file-1",
        "size": 12,
        "chunk_count": 2,
        "received_bytes": 8,
        "received_chunks": [0],
    }

    plan = plan_upload_session_chunk(
        file_payload=file_payload,
        chunk_index=1,
        offset=8,
        payload_size=4,
        chunk_size_bytes=8,
    )

    assert plan.already_present is False
    assert plan.next_received_bytes == 12
    assert plan.next_received_chunks == [0, 1]
    assert plan.file_complete is True


def test_upload_chunk_plan_rejects_duplicate_with_wrong_offset():
    file_payload = {
        "file_id": "file-1",
        "size": 12,
        "chunk_count": 2,
        "received_bytes": 8,
        "received_chunks": [0],
    }

    with pytest.raises(ValueError, match="Unexpected chunk offset"):
        plan_upload_session_chunk(
            file_payload=file_payload,
            chunk_index=0,
            offset=3,
            payload_size=8,
            chunk_size_bytes=8,
        )


def test_upload_chunk_plan_rejects_out_of_order_chunk():
    file_payload = {
        "file_id": "file-1",
        "size": 20,
        "chunk_count": 3,
        "received_bytes": 0,
        "received_chunks": [],
    }

    with pytest.raises(ValueError, match="Unexpected chunk_index"):
        plan_upload_session_chunk(
            file_payload=file_payload,
            chunk_index=2,
            offset=16,
            payload_size=4,
            chunk_size_bytes=8,
        )


def test_complete_validation_requires_exact_chunk_range():
    file_payload = {
        "size": 12,
        "chunk_count": 2,
        "received_bytes": 12,
        "received_chunks": [1, 1],
    }

    with pytest.raises(ValueError, match="Upload session is incomplete"):
        validate_upload_session_file_complete(file_payload)

    file_payload["received_chunks"] = [0, 1]
    validate_upload_session_file_complete(file_payload)
