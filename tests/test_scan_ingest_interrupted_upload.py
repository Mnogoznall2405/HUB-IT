from __future__ import annotations

import asyncio
from dataclasses import replace
import json

import httpx
import pytest
from starlette.requests import ClientDisconnect

import scan_server.app as scan_app
from scan_server.database import ScanStore

pytestmark = pytest.mark.asyncio


@pytest.fixture
def local_scan(tmp_path, monkeypatch):
    store = ScanStore(
        db_path=tmp_path / "scan.db", archive_dir=tmp_path / "archive", task_ack_timeout_sec=60
    )
    monkeypatch.setattr(scan_app, "store", store)
    monkeypatch.setattr(scan_app, "config", replace(
        scan_app.config, api_keys=("isolated-ring",), agent_api_keys={}, ingest_max_concurrency=1
    ))
    monkeypatch.setattr(scan_app, "_ingest_body_idle_timeout_sec", lambda: 0.05, raising=False)
    monkeypatch.setenv("SCAN_INGEST_JSON_MAX_BYTES", "2048")
    return store


def _payload():
    return {
        "agent_id": "isolated-pc", "hostname": "ISOLATED-PC",
        "file_path": "report.txt", "source_kind": "text", "event_id": "one-event",
    }


def _job_count(store):
    with store._connect() as conn:
        return conn.execute("SELECT count(*) FROM scan_jobs").fetchone()[0]


@pytest.mark.parametrize("failure", [ClientDisconnect, ConnectionResetError])
async def test_interrupted_scan_body_returns_408_and_retry_is_deduplicated(local_scan, failure):
    class Interrupted(httpx.AsyncByteStream):
        async def __aiter__(self):
            yield b'{"agent_id":"isolated-pc",'
            raise failure()

    async with httpx.AsyncClient(
        transport=httpx.ASGITransport(scan_app.app, raise_app_exceptions=False),
        base_url="http://test",
        headers={"X-API-Key": "isolated-ring"},
    ) as client:
        interrupted = await client.post("/api/v1/scan/ingest", content=Interrupted())
        assert interrupted.status_code == 408
        assert _job_count(local_scan) == 0
        accepted = await client.post("/api/v1/scan/ingest", json=_payload())
        repeated = await client.post("/api/v1/scan/ingest", json=_payload())
    assert accepted.status_code == repeated.status_code == 200
    assert accepted.json()["success"] is True
    assert repeated.json()["deduped"] is True
    assert _job_count(local_scan) == 1


async def test_stalled_scan_body_releases_admission_without_storing(local_scan):
    class Stalled(httpx.AsyncByteStream):
        async def __aiter__(self):
            yield b"{"
            await asyncio.sleep(10)
            yield b"}"

    async with httpx.AsyncClient(
        transport=httpx.ASGITransport(scan_app.app, raise_app_exceptions=False),
        base_url="http://test", headers={"X-API-Key": "isolated-ring"},
    ) as client:
        response = await asyncio.wait_for(
            client.post("/api/v1/scan/ingest", content=Stalled()), timeout=1
        )
        assert response.status_code == 408
        assert _job_count(local_scan) == 0
        accepted = await client.post("/api/v1/scan/ingest", json=_payload())
        assert accepted.status_code == 200
        assert _job_count(local_scan) == 1


async def test_progressing_scan_body_is_not_limited_by_total_duration(local_scan, monkeypatch):
    monkeypatch.setattr(scan_app, "_ingest_body_idle_timeout_sec", lambda: 0.2, raising=False)
    raw = json.dumps(_payload()).encode()

    class Progressing(httpx.AsyncByteStream):
        async def __aiter__(self):
            for start in range(0, len(raw), 35):
                await asyncio.sleep(0.06)
                yield raw[start:start + 35]

    async with httpx.AsyncClient(
        transport=httpx.ASGITransport(scan_app.app, raise_app_exceptions=False),
        base_url="http://test", headers={"X-API-Key": "isolated-ring"},
    ) as client:
        response = await client.post("/api/v1/scan/ingest", content=Progressing())
    assert response.status_code == 200
    assert _job_count(local_scan) == 1


async def test_cancelling_upload_does_not_store_or_keep_the_admission_slot(local_scan):
    reading = asyncio.Event()

    class CancelledUpload(httpx.AsyncByteStream):
        async def __aiter__(self):
            yield b"{"
            reading.set()
            await asyncio.Event().wait()

    async with httpx.AsyncClient(
        transport=httpx.ASGITransport(scan_app.app, raise_app_exceptions=False),
        base_url="http://test", headers={"X-API-Key": "isolated-ring"},
    ) as client:
        task = asyncio.create_task(client.post("/api/v1/scan/ingest", content=CancelledUpload()))
        await asyncio.wait_for(reading.wait(), 1)
        task.cancel()
        with pytest.raises(asyncio.CancelledError):
            await task
        assert _job_count(local_scan) == 0
        response = await client.post("/api/v1/scan/ingest", json=_payload())
    assert response.status_code == 200
    assert _job_count(local_scan) == 1


@pytest.mark.parametrize("body,expected", [(b"{", 422), (b"x" * 2049, 413)])
async def test_existing_scan_validation_and_size_limits_are_preserved(local_scan, body, expected):
    async with httpx.AsyncClient(
        transport=httpx.ASGITransport(scan_app.app, raise_app_exceptions=False),
        base_url="http://test",
    ) as client:
        denied = await client.post(
            "/api/v1/scan/ingest", content=body, headers={"X-API-Key": "wrong-key"}
        )
        response = await client.post(
            "/api/v1/scan/ingest", content=body, headers={"X-API-Key": "isolated-ring"}
        )
    assert denied.status_code == 401
    assert response.status_code == expected
    assert _job_count(local_scan) == 0
