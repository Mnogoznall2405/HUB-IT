"""Tests for JSON-only gzip middleware (SSE/stream bypass)."""
import sys
from pathlib import Path

import pytest
from fastapi import FastAPI
from fastapi.responses import StreamingResponse
from fastapi.testclient import TestClient

sys.path.insert(0, str(Path(__file__).resolve().parent.parent / "WEB-itinvent"))

from backend.services.json_gzip_middleware import JsonGzipMiddleware  # noqa: E402


def _app() -> FastAPI:
    app = FastAPI()
    app.add_middleware(JsonGzipMiddleware, minimum_size=1024)

    @app.get("/json-big")
    def json_big():
        return {"items": [{"inv_no": str(i), "name": "x" * 40} for i in range(60)]}

    @app.get("/json-small")
    def json_small():
        return {"ok": True}

    @app.get("/sse")
    def sse():
        async def stream():
            for i in range(3):
                yield f"data: chunk-{i}\n\n"

        return StreamingResponse(stream(), media_type="text/event-stream")

    @app.get("/file")
    def file_stream():
        async def stream():
            yield b"x" * 2048

        return StreamingResponse(stream(), media_type="application/octet-stream")

    return app


def test_json_big_is_gzipped():
    client = TestClient(_app())
    response = client.get("/json-big", headers={"Accept-Encoding": "gzip"})

    assert response.status_code == 200
    assert response.headers["Content-Encoding"] == "gzip"
    assert "Accept-Encoding" in response.headers.get("Vary", "")
    payload = response.json()
    assert len(payload["items"]) == 60


def test_json_small_not_compressed():
    client = TestClient(_app())
    response = client.get("/json-small", headers={"Accept-Encoding": "gzip"})

    assert response.status_code == 200
    assert "Content-Encoding" not in response.headers
    assert "Accept-Encoding" in response.headers.get("Vary", "")
    assert response.json() == {"ok": True}


def test_json_big_passthrough_without_gzip_accept():
    client = TestClient(_app())
    response = client.get("/json-big", headers={"Accept-Encoding": "identity"})

    assert response.status_code == 200
    assert "Content-Encoding" not in response.headers
    assert len(response.json()["items"]) == 60


def test_sse_stream_passthrough():
    client = TestClient(_app())
    with client.stream("GET", "/sse", headers={"Accept-Encoding": "gzip"}) as response:
        body = b"".join(response.iter_bytes())

    assert response.status_code == 200
    assert "Content-Encoding" not in response.headers
    assert response.headers["content-type"].startswith("text/event-stream")
    assert body == b"data: chunk-0\n\ndata: chunk-1\n\ndata: chunk-2\n\n"


def test_binary_stream_passthrough():
    client = TestClient(_app())
    response = client.get("/file", headers={"Accept-Encoding": "gzip"})

    assert response.status_code == 200
    assert "Content-Encoding" not in response.headers
    assert response.content == b"x" * 2048
