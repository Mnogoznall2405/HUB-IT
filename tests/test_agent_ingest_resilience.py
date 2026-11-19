"""Agent ingest boundaries: dependency outages and incomplete HTTP bodies."""

from __future__ import annotations

import asyncio

import httpx
import pytest
import sqlalchemy as sa
from fastapi import FastAPI
from fastapi.testclient import TestClient
from sqlalchemy.pool import StaticPool
from starlette.requests import ClientDisconnect

from backend import inventory_runtime
from backend.api.v1 import fs_egress
from backend.appdb import agent_api_keys, db as app_db
from backend.utils import upload_limits


@pytest.fixture
def ingest_app(monkeypatch):
    monkeypatch.setenv("ITINV_AGENT_API_KEYS", "test-ring")
    monkeypatch.setenv("ITINV_AGENT_API_KEY", "")
    monkeypatch.setenv("INVENTORY_AGENT_API_KEYS", "")
    monkeypatch.setattr(inventory_runtime, "is_app_database_configured", lambda: False)
    stored = []
    monkeypatch.setattr(
        fs_egress.store, "ingest_events", lambda events: stored.extend(events) or len(events)
    )
    monkeypatch.setattr(fs_egress, "_ingest_limiters", {})
    monkeypatch.setattr(fs_egress, "_ingest_admission", None)
    monkeypatch.setattr(fs_egress, "_ingest_queue_admission", None)
    monkeypatch.setattr(fs_egress, "_key_check_limiters", {})
    app = FastAPI()
    app.include_router(fs_egress.router)
    return app, stored


def test_key_store_outage_is_retryable_not_invalid_credentials(ingest_app, monkeypatch):
    app, stored = ingest_app
    monkeypatch.setattr(inventory_runtime, "is_app_database_configured", lambda: True)
    engine = sa.create_engine(
        "sqlite://", poolclass=StaticPool, connect_args={"check_same_thread": False}
    )
    monkeypatch.setattr(app_db, "get_app_engine", lambda: engine)
    with engine.begin() as conn:
        conn.execute(sa.text(
            "CREATE TABLE agent_api_keys "
            "(agent_id TEXT, scan_key_sha256 TEXT, inv_key_sha256 TEXT)"
        ))
        conn.execute(
            sa.text("INSERT INTO agent_api_keys (agent_id, inv_key_sha256) VALUES (:name, :sha)"),
            {"name": "PC-ONE", "sha": agent_api_keys.key_sha256("test-bound")},
        )
    unavailable = [True]

    @sa.event.listens_for(engine, "before_cursor_execute")
    def fail_lookup(conn, cursor, statement, parameters, context, executemany):
        if unavailable[0]:
            raise sa.exc.OperationalError(statement, parameters, RuntimeError("private-db-error"))

    agent_api_keys.clear_lookup_cache()
    try:
        with TestClient(app, raise_server_exceptions=False) as client:
            body = {"events": [{"computer_name": "PC-ONE", "event_id": "one"}]}
            failed = client.post("/fs-egress", headers={"X-API-Key": "test-bound"}, json=body)
            assert failed.status_code == 503
            assert failed.headers["Retry-After"] == "30"
            assert "private-db-error" not in failed.text
            assert not stored

            unavailable[0] = False
            accepted = client.post("/fs-egress", headers={"X-API-Key": "test-bound"}, json=body)
            assert accepted.status_code == 200
            assert stored == body["events"]
            unknown = client.post("/fs-egress", headers={"X-API-Key": "unknown"}, json=body)
            assert unknown.status_code == 401
            foreign = client.post(
                "/fs-egress",
                headers={"X-API-Key": "test-bound"},
                json={"events": [{"computer_name": "PC-TWO"}]},
            )
            assert foreign.status_code == 403
            assert stored == body["events"]
    finally:
        agent_api_keys.clear_lookup_cache()
        engine.dispose()


async def test_idle_upload_is_408_and_does_not_reach_store(ingest_app, monkeypatch):
    app, stored = ingest_app
    monkeypatch.setattr(upload_limits, "ingest_body_idle_timeout_sec", lambda: 0.05, raising=False)

    class StalledBody(httpx.AsyncByteStream):
        async def __aiter__(self):
            yield b'{"events":['
            await asyncio.sleep(10)

    async with httpx.AsyncClient(
        transport=httpx.ASGITransport(app, raise_app_exceptions=False), base_url="http://test"
    ) as client:
        response = await asyncio.wait_for(
            client.post("/fs-egress", headers={"X-API-Key": "test-ring"}, content=StalledBody()),
            1,
        )
    assert response.status_code == 408
    assert not stored


async def test_disconnect_during_body_is_not_a_server_error(ingest_app):
    app, stored = ingest_app

    class InterruptedBody(httpx.AsyncByteStream):
        async def __aiter__(self):
            yield b'{"events":['
            raise ClientDisconnect()

    async with httpx.AsyncClient(
        transport=httpx.ASGITransport(app, raise_app_exceptions=False), base_url="http://test"
    ) as client:
        response = await client.post(
            "/fs-egress", headers={"X-API-Key": "test-ring"}, content=InterruptedBody()
        )
    assert response.status_code == 408
    assert not stored


async def test_progressing_upload_can_outlive_idle_timeout(ingest_app, monkeypatch):
    app, stored = ingest_app
    monkeypatch.setattr(upload_limits, "ingest_body_idle_timeout_sec", lambda: 0.2, raising=False)

    class SlowBody(httpx.AsyncByteStream):
        async def __aiter__(self):
            for part in [b'{"events":', b'[{"event_id":', b'"one"}]', b"}"]:
                await asyncio.sleep(0.08)
                yield part

    async with httpx.AsyncClient(
        transport=httpx.ASGITransport(app, raise_app_exceptions=False), base_url="http://test"
    ) as client:
        response = await client.post(
            "/fs-egress", headers={"X-API-Key": "test-ring"}, content=SlowBody()
        )
    assert response.status_code == 200
    assert stored == [{"event_id": "one"}]
