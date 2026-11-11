"""Bounded reading of multipart uploads.

Starlette already spools a multipart body to disk, so the request itself does not fill memory; a bare
``await file.read()`` does: it copies the whole file into one ``bytes`` object before any size check.
``read_upload_limited`` reads in chunks and stops as soon as the limit is crossed.
"""
from __future__ import annotations

import asyncio
import json
import os
from typing import Any, Callable, Optional

import anyio
from fastapi import HTTPException, status

_CHUNK_BYTES = 1024 * 1024


def upload_too_large_error(detail: str = "File is too large") -> HTTPException:
    return HTTPException(status_code=status.HTTP_413_REQUEST_ENTITY_TOO_LARGE, detail=detail)


async def read_upload_limited(
    upload: Any,
    max_bytes: int,
    *,
    too_large: Optional[Callable[[], Exception]] = None,
) -> bytes:
    """Read ``upload`` fully, but raise ``too_large()`` (default HTTP 413) once it exceeds ``max_bytes``."""
    limit = max(0, int(max_bytes))
    chunks: list[bytes] = []
    total = 0
    while True:
        chunk = await upload.read(_CHUNK_BYTES)
        if not chunk:
            break
        total += len(chunk)
        if total > limit:
            raise (too_large() if too_large is not None else upload_too_large_error())
        chunks.append(chunk)
    return b"".join(chunks)


# The Telegram/MAX probe agents upload up to a 200 MiB media spool per request (base64 adds ~33%) and
# retry a refused batch forever, so the ceiling must sit above that, not at a typical request size.
_DEFAULT_INGEST_MAX_BYTES = 384 * 1024 * 1024

# Bodies above this get parsed in a worker thread: json.loads of tens/hundreds of MiB blocks the
# event loop for seconds and stalls every concurrent request.
_THREADPOOL_JSON_PARSE_BYTES = 256 * 1024
# anyio primitives are single-loop: keep one limiter per running loop.
_json_parse_limiters: "dict[int, anyio.CapacityLimiter]" = {}


def _get_json_parse_limiter() -> "anyio.CapacityLimiter":
    key = id(asyncio.get_running_loop())
    limiter = _json_parse_limiters.get(key)
    if limiter is None:
        try:
            tokens = int(str(os.getenv("ITINV_JSON_PARSE_MAX_CONCURRENCY", "4") or "4"))
        except ValueError:
            tokens = 4
        limiter = _json_parse_limiters[key] = anyio.CapacityLimiter(max(1, tokens))
    return limiter


def ingest_max_bytes() -> int:
    """Body ceiling for agent ingest endpoints (``ITINV_AGENT_INGEST_MAX_BYTES``, default 384 MiB)."""
    try:
        value = int(str(os.getenv("ITINV_AGENT_INGEST_MAX_BYTES", "") or "").strip())
    except ValueError:
        return _DEFAULT_INGEST_MAX_BYTES
    return value if value > 0 else _DEFAULT_INGEST_MAX_BYTES


async def read_json_body_limited(request: Any, max_bytes: Optional[int] = None) -> Any:
    """Parse a JSON request body, refusing with 413 before buffering more than ``max_bytes``.

    Checks ``Content-Length`` first, then counts the streamed chunks (chunked uploads have no length).
    Invalid JSON is a 400, not a 500.
    """
    limit = ingest_max_bytes() if max_bytes is None else max(0, int(max_bytes))
    declared = str(request.headers.get("content-length") or "").strip()
    if declared.isdigit() and int(declared) > limit:
        raise upload_too_large_error("Request body is too large")
    chunks: list[bytes] = []
    total = 0
    async for chunk in request.stream():
        total += len(chunk)
        if total > limit:
            raise upload_too_large_error("Request body is too large")
        chunks.append(chunk)
    raw = b"".join(chunks) or b"null"
    try:
        if total > _THREADPOOL_JSON_PARSE_BYTES:
            return await anyio.to_thread.run_sync(json.loads, raw, limiter=_get_json_parse_limiter())
        return json.loads(raw)
    except (ValueError, UnicodeDecodeError):
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="Invalid JSON body")
