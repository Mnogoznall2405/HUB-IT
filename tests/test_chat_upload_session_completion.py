import gzip
import shutil
import sys
from contextlib import contextmanager
from pathlib import Path
from uuid import uuid4

import pytest

PROJECT_ROOT = Path(__file__).resolve().parents[1]
WEB_ROOT = PROJECT_ROOT / "WEB-itinvent"

if str(WEB_ROOT) not in sys.path:
    sys.path.insert(0, str(WEB_ROOT))

from backend.chat.upload_session_completion import UploadSessionCompletionMaterializer


@contextmanager
def _workspace_tempdir():
    base_dir = Path.cwd() / ".tmp_test_chat_upload_session_completion"
    base_dir.mkdir(parents=True, exist_ok=True)
    path = base_dir / f"case-{uuid4().hex}"
    path.mkdir(parents=True, exist_ok=False)
    try:
        yield path
    finally:
        shutil.rmtree(path, ignore_errors=True)


def _decode_payload(
    *,
    source_stream,
    target_path: Path,
    transfer_encoding: str,
    expected_original_size: int | None,
    total_size: int,
):
    raw_payload = source_stream.read()
    payload = gzip.decompress(raw_payload) if transfer_encoding == "gzip" else raw_payload
    if expected_original_size is not None and len(payload) != expected_original_size:
        raise ValueError("decoded size mismatch")
    target_path.write_bytes(payload)
    return len(payload), payload[:32], total_size + len(payload)


def _materializer(root: Path, *, decode_payload=_decode_payload) -> UploadSessionCompletionMaterializer:
    return UploadSessionCompletionMaterializer(
        attachments_root=lambda: root / "attachments",
        part_path=lambda session_id, file_id: root / "sessions" / session_id / f"{file_id}.part",
        normalize_transfer_encoding=lambda value: str(value or "identity").strip().lower() or "identity",
        write_decoded_transfer_payload=decode_payload,
        probe_image_dimensions=lambda probe_bytes, mime_type: (7, 9) if mime_type == "image/png" else (None, None),
    )


def _manifest(*, payload_size: int, original_size: int, transfer_encoding: str = "identity") -> dict:
    return {
        "session_id": "session-1",
        "conversation_id": "conversation-1",
        "files": [
            {
                "file_id": "file-1",
                "attachment_id": "attachment-1",
                "file_name": "photo.png",
                "mime_type": "image/png",
                "size": payload_size,
                "original_size": original_size,
                "transfer_encoding": transfer_encoding,
                "storage_name": "attachment-1_photo.png",
                "chunk_count": 1,
                "received_bytes": payload_size,
                "received_chunks": [0],
            }
        ],
    }


def test_completion_materializer_decodes_parts_and_keeps_files_on_success():
    with _workspace_tempdir() as root:
        payload = b"\x89PNG decoded"
        compressed = gzip.compress(payload)
        part_path = root / "sessions" / "session-1" / "file-1.part"
        part_path.parent.mkdir(parents=True)
        part_path.write_bytes(compressed)

        materializer = _materializer(root)
        with materializer.materialize(
            _manifest(
                payload_size=len(compressed),
                original_size=len(payload),
                transfer_encoding="gzip",
            )
        ) as prepared:
            assert len(prepared) == 1
            prepared_file = prepared[0]
            assert prepared_file["attachment_id"] == "attachment-1"
            assert prepared_file["file_name"] == "photo.png"
            assert prepared_file["file_size"] == len(payload)
            assert prepared_file["width"] == 7
            assert prepared_file["height"] == 9
            assert prepared_file["path"].read_bytes() == payload

        assert prepared_file["path"].exists()
        assert not part_path.exists()


def test_completion_materializer_preserves_voice_metadata():
    with _workspace_tempdir() as root:
        payload = b"webm voice"
        part_path = root / "sessions" / "session-1" / "file-1.part"
        part_path.parent.mkdir(parents=True)
        part_path.write_bytes(payload)

        manifest = _manifest(payload_size=len(payload), original_size=len(payload))
        manifest["files"][0].update({
            "file_name": "voice_1.webm",
            "mime_type": "audio/webm",
            "media_kind": "audio",
            "duration_seconds": 5,
            "storage_name": "attachment-1_voice_1.webm",
        })

        materializer = _materializer(root)
        with materializer.materialize(manifest) as prepared:
            prepared_file = prepared[0]
            assert prepared_file["file_name"] == "voice_1.webm"
            assert prepared_file["mime_type"] == "audio/webm"
            assert prepared_file["media_kind"] == "audio"
            assert prepared_file["duration_seconds"] == 5
            assert prepared_file["width"] is None
            assert prepared_file["height"] is None
            assert prepared_file["path"].read_bytes() == payload


def test_completion_materializer_removes_materialized_files_when_caller_fails():
    with _workspace_tempdir() as root:
        payload = b"plain payload"
        part_path = root / "sessions" / "session-1" / "file-1.part"
        part_path.parent.mkdir(parents=True)
        part_path.write_bytes(payload)

        materializer = _materializer(root)
        with pytest.raises(RuntimeError, match="message creation failed"):
            with materializer.materialize(_manifest(payload_size=len(payload), original_size=len(payload))) as prepared:
                final_path = prepared[0]["path"]
                assert final_path.exists()
                raise RuntimeError("message creation failed")

        assert not final_path.exists()


def test_completion_materializer_removes_partial_final_file_when_decode_fails():
    with _workspace_tempdir() as root:
        payload = b"plain payload"
        part_path = root / "sessions" / "session-1" / "file-1.part"
        part_path.parent.mkdir(parents=True)
        part_path.write_bytes(payload)

        def failing_decode(*, source_stream, target_path, **_kwargs):
            target_path.write_bytes(source_stream.read()[:5])
            raise ValueError("decode failed")

        materializer = _materializer(root, decode_payload=failing_decode)
        final_path = root / "attachments" / "conversation-1" / "attachment-1_photo.png"

        with pytest.raises(ValueError, match="decode failed"):
            with materializer.materialize(_manifest(payload_size=len(payload), original_size=len(payload))):
                pass

        assert not final_path.exists()
        assert part_path.exists()
