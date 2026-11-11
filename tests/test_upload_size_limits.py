"""Audit 01-B7: uploads are read in bounded chunks and refused once they cross the limit.

The property that matters is that an oversized file is rejected *before* it is copied into memory, so
the tests count how much of the stream was consumed, and drive real routes for the 413 contract.
"""
from __future__ import annotations

import asyncio
import sys
from pathlib import Path
from types import SimpleNamespace

import pytest
from fastapi import FastAPI, HTTPException
from fastapi.testclient import TestClient

WEB_ROOT = Path(__file__).resolve().parents[1] / "WEB-itinvent"
if str(WEB_ROOT) not in sys.path:
    sys.path.insert(0, str(WEB_ROOT))

from backend.api.v1 import networks as networks_api  # noqa: E402
from backend.api.v1 import tickets as tickets_api  # noqa: E402
from backend.utils.upload_limits import read_upload_limited  # noqa: E402

MB = 1024 * 1024


class _Stream:
    """Stand-in for UploadFile: serves `total` bytes and records how much was actually consumed."""

    def __init__(self, total: int):
        self.total = total
        self.consumed = 0

    async def read(self, size: int = -1) -> bytes:
        size = self.total - self.consumed if size is None or size < 0 else size
        size = min(size, self.total - self.consumed)
        self.consumed += size
        return b"x" * size


def test_oversized_stream_is_refused_without_reading_it_all():
    stream = _Stream(200 * MB)
    with pytest.raises(HTTPException) as caught:
        asyncio.run(read_upload_limited(stream, 2 * MB))
    assert caught.value.status_code == 413
    assert stream.consumed <= 3 * MB  # stopped right after crossing the limit, not after 200 MB


def test_file_within_the_limit_is_returned_intact_and_custom_error_is_used():
    assert asyncio.run(read_upload_limited(_Stream(MB + 17), 2 * MB)) == b"x" * (MB + 17)
    assert asyncio.run(read_upload_limited(_Stream(0), MB)) == b""
    with pytest.raises(ValueError, match="custom"):
        asyncio.run(read_upload_limited(_Stream(3 * MB), MB, too_large=lambda: ValueError("custom")))


def _override_deps(app: FastAPI, path: str, user) -> None:
    route = next(r for r in app.routes if getattr(r, "path", "") == path)
    for dep in route.dependant.dependencies:
        app.dependency_overrides[dep.call] = lambda: user


def test_network_map_upload_over_the_limit_gets_413_and_never_reaches_the_service(monkeypatch):
    calls: list = []
    monkeypatch.setattr(networks_api, "_NETWORK_UPLOAD_MAX_BYTES", 1024)
    monkeypatch.setattr(networks_api, "_ensure_write_role", lambda user: None)
    monkeypatch.setattr(
        networks_api.network_service, "upload_map", lambda **kwargs: calls.append(kwargs) or {"ok": True}
    )
    app = FastAPI()
    app.include_router(networks_api.router, prefix="/net")
    _override_deps(app, "/net/maps/upload", SimpleNamespace(id=1, role="admin"))
    client = TestClient(app)

    refused = client.post(
        "/net/maps/upload", data={"branch_id": "1"}, files={"file": ("m.png", b"z" * 4096, "image/png")}
    )
    assert refused.status_code == 413
    assert calls == []

    accepted = client.post(
        "/net/maps/upload", data={"branch_id": "1"}, files={"file": ("m.png", b"z" * 512, "image/png")}
    )
    assert accepted.status_code == 200
    assert len(calls) == 1 and len(calls[0]["file_bytes"]) == 512


def test_ticket_import_over_the_limit_keeps_its_413_contract(monkeypatch):
    uploaded: list = []
    monkeypatch.setattr(tickets_api, "MAX_IMPORT_UPLOAD_SIZE", 1024)
    monkeypatch.setattr(
        tickets_api.tickets_import_service, "upload_file", lambda *a, **k: uploaded.append(a) or {"job": 1}
    )
    app = FastAPI()
    app.include_router(tickets_api.router, prefix="/t")
    path = "/t/import/upload"
    _override_deps(app, path, SimpleNamespace(id=1, role="admin", username="u"))
    client = TestClient(app, raise_server_exceptions=False)

    refused = client.post(path, files={"file": ("a.xlsx", b"z" * 4096, "application/vnd.ms-excel")})
    assert refused.status_code == 413
    assert uploaded == []
