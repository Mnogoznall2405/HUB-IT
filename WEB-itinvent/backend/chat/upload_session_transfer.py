"""Pure rules for chat upload-session chunk and completion state."""
from __future__ import annotations

from dataclasses import dataclass
from typing import Any

from backend.chat.utils import normalize_text as _normalize_text


def normalize_received_chunks(value: object) -> list[int]:
    return sorted({
        int(item)
        for item in list(value or [])
        if isinstance(item, int) or str(item).strip().isdigit()
    })


@dataclass(frozen=True)
class UploadChunkPlan:
    file_id: str
    chunk_index: int
    already_present: bool
    received_bytes: int
    received_chunks: list[int]
    next_received_bytes: int
    next_received_chunks: list[int]
    file_complete: bool


def plan_upload_session_chunk(
    *,
    file_payload: dict[str, Any],
    chunk_index: int,
    offset: int,
    payload_size: int,
    chunk_size_bytes: int,
) -> UploadChunkPlan:
    if payload_size <= 0:
        raise ValueError("Chunk payload is required")
    if payload_size > int(chunk_size_bytes):
        raise ValueError("Chunk payload exceeds session chunk size")
    normalized_chunk_index = int(chunk_index)
    normalized_offset = int(offset)
    if normalized_chunk_index < 0:
        raise ValueError("chunk_index must be non-negative")
    if normalized_offset < 0:
        raise ValueError("offset must be non-negative")

    expected_size = int(file_payload.get("size", 0) or 0)
    received_chunks = normalize_received_chunks(file_payload.get("received_chunks"))
    received_bytes = int(file_payload.get("received_bytes", 0) or 0)
    chunk_count = int(file_payload.get("chunk_count", 0) or 0)
    if normalized_chunk_index >= chunk_count:
        raise ValueError("chunk_index is out of range")

    expected_chunk_size = min(
        int(chunk_size_bytes),
        max(0, expected_size - (normalized_chunk_index * int(chunk_size_bytes))),
    )
    if expected_chunk_size <= 0:
        raise ValueError("Chunk does not match file size")
    if payload_size != expected_chunk_size:
        raise ValueError("Chunk payload size does not match the expected size")

    expected_offset = normalized_chunk_index * int(chunk_size_bytes)
    if normalized_chunk_index in received_chunks:
        if normalized_offset != expected_offset:
            raise ValueError("Unexpected chunk offset for upload session file")
        return UploadChunkPlan(
            file_id=_normalize_text(file_payload.get("file_id")),
            chunk_index=normalized_chunk_index,
            already_present=True,
            received_bytes=received_bytes,
            received_chunks=received_chunks,
            next_received_bytes=received_bytes,
            next_received_chunks=received_chunks,
            file_complete=received_bytes >= expected_size,
        )

    if normalized_chunk_index != len(received_chunks):
        raise ValueError("Unexpected chunk_index for upload session file")
    if normalized_offset != received_bytes:
        raise ValueError("Unexpected chunk offset for upload session file")

    next_received_bytes = received_bytes + payload_size
    next_received_chunks = received_chunks + [normalized_chunk_index]
    return UploadChunkPlan(
        file_id=_normalize_text(file_payload.get("file_id")),
        chunk_index=normalized_chunk_index,
        already_present=False,
        received_bytes=received_bytes,
        received_chunks=received_chunks,
        next_received_bytes=next_received_bytes,
        next_received_chunks=next_received_chunks,
        file_complete=next_received_bytes >= expected_size,
    )


def validate_upload_session_file_complete(file_payload: dict[str, Any]) -> None:
    expected_size = int(file_payload.get("size", 0) or 0)
    received_bytes = int(file_payload.get("received_bytes", 0) or 0)
    chunk_count = int(file_payload.get("chunk_count", 0) or 0)
    received_chunks = normalize_received_chunks(file_payload.get("received_chunks"))
    if received_bytes != expected_size:
        raise ValueError("Upload session is incomplete")
    if received_chunks != list(range(chunk_count)):
        raise ValueError("Upload session is incomplete")
