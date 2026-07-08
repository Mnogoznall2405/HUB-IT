from __future__ import annotations

import asyncio
import importlib
import json
import sqlite3
from io import BytesIO
from pathlib import Path
from types import SimpleNamespace

import scan_server.app as scan_app
from scan_server.app import IngestPayload
from scan_server.database import ScanStore
from starlette.datastructures import UploadFile
from fastapi import HTTPException


def _make_store(temp_dir: str) -> ScanStore:
    root = Path(temp_dir)
    return ScanStore(
        db_path=root / "scan-server.db",
        archive_dir=root / "archive",
        task_ack_timeout_sec=300,
        agent_online_timeout_sec=1800,
    )


def _fake_request(ip_address: str):
    return SimpleNamespace(client=SimpleNamespace(host=ip_address))


def test_ingest_touches_agent_presence_and_exposes_active_work(temp_dir, monkeypatch):
    store = _make_store(temp_dir)
    monkeypatch.setattr(scan_app, "store", store)

    payload = IngestPayload(
        agent_id="tmn-sup-0122",
        hostname="TMN-SUP-0122",
        branch="Тюмень",
        file_path=r"C:\Scan\sample.pdf",
        file_name="sample.pdf",
        file_hash="hash-1",
        file_size=1024,
        source_kind="pdf",
        event_id="evt-1",
    )

    result = asyncio.run(
        scan_app.ingest(
            payload,
            _fake_request("10.105.0.18"),
            x_api_key=scan_app.config.api_keys[0],
        )
    )

    assert result["success"] is True
    response = store.list_agents_table(online="online", task_status="active", limit=10, offset=0)
    assert response["total"] == 1
    item = response["items"][0]
    assert item["agent_id"] == "tmn-sup-0122"
    assert item["is_online"] is True
    assert item["ip_address"] == "10.105.0.18"
    assert item["queue_size"] >= 1
    assert item["active_task"]["command"] == "scan_now"
    assert item["active_task"]["status"] == "queued"


def test_ingest_returns_429_when_pdf_backpressure_is_active(temp_dir, monkeypatch):
    store = _make_store(temp_dir)
    monkeypatch.setattr(scan_app, "store", store)
    monkeypatch.setattr(
        store,
        "ingest_backpressure_status",
        lambda **kwargs: {"active": True, "reasons": ["pdf_pending_limit"], "pdf_pending": 25000},
    )

    payload = IngestPayload(
        agent_id="agent-1",
        hostname="HOST-01",
        file_path=r"C:\Scan\sample.pdf",
        file_name="sample.pdf",
        file_hash="hash-1",
        source_kind="pdf_slice",
        pdf_slice_b64="JVBERi0xLjQK",
    )

    try:
        asyncio.run(
            scan_app.ingest(
                payload,
                _fake_request("10.105.0.18"),
                x_api_key=scan_app.config.api_keys[0],
            )
        )
    except HTTPException as exc:
        assert exc.status_code == 429
        assert exc.headers["Retry-After"] == str(scan_app.config.ingest_retry_after_sec)
    else:
        raise AssertionError("Expected HTTPException")


def test_ingest_returns_429_when_total_backpressure_is_active_for_non_pdf(temp_dir, monkeypatch):
    store = _make_store(temp_dir)
    monkeypatch.setattr(scan_app, "store", store)
    monkeypatch.setattr(
        store,
        "ingest_backpressure_status",
        lambda **kwargs: {
            "active": False,
            "reasons": [],
            "total_active": True,
            "total_reasons": ["total_pending_limit"],
            "total_pending": 5000,
            "retry_after_sec": 180,
        },
    )

    payload = IngestPayload(
        agent_id="agent-1",
        hostname="HOST-01",
        file_path=r"C:\Scan\sample.txt",
        file_name="sample.txt",
        file_hash="hash-text-1",
        source_kind="text",
    )

    try:
        asyncio.run(
            scan_app.ingest(
                payload,
                _fake_request("10.105.0.18"),
                x_api_key=scan_app.config.api_keys[0],
            )
        )
    except HTTPException as exc:
        assert exc.status_code == 429
        assert exc.headers["Retry-After"] == "180"
        assert exc.detail["error"] == "scan_ingest_backpressure"
    else:
        raise AssertionError("Expected HTTPException")


def test_ingest_pdf_slice_accepts_multipart_metadata_and_spools_payload(temp_dir, monkeypatch):
    store = _make_store(temp_dir)
    monkeypatch.setattr(scan_app, "store", store)
    metadata = {
        "agent_id": "agent-1",
        "hostname": "HOST-01",
        "branch": "branch",
        "file_path": r"C:\Scan\multipart.pdf",
        "file_name": "multipart.pdf",
        "file_hash": "hash-multipart",
        "file_size": 2048,
        "source_kind": "pdf_slice",
        "event_id": "multipart-event",
    }
    upload = UploadFile(filename="multipart.pdf", file=BytesIO(b"%PDF-1.4 multipart"))

    result = asyncio.run(
        scan_app.ingest_pdf_slice(
            _fake_request("10.105.0.18"),
            metadata_json=json.dumps(metadata),
            pdf_slice=upload,
            x_api_key=scan_app.config.api_keys[0],
        )
    )

    assert result["success"] is True
    job_id = result["job_id"]
    assert store.read_job_pdf_spool(job_id=job_id) == b"%PDF-1.4 multipart"


def test_dashboard_uses_ttl_cache_and_stale_on_sqlite_lock(monkeypatch):
    calls = {"dashboard": 0}

    class _FakeStore:
        def dashboard(self):
            calls["dashboard"] += 1
            if calls["dashboard"] > 1:
                raise sqlite3.OperationalError("database is locked")
            return {"totals": {"agents_total": 1}, "job_queue": {}}

        def ingest_backpressure_status(self, **kwargs):
            return {"active": False, "limits": kwargs}

    monkeypatch.setattr(scan_app, "store", _FakeStore())
    monkeypatch.setattr(
        scan_app,
        "config",
        SimpleNamespace(dashboard_cache_ttl_sec=60, ingest_max_pending_pdf_jobs=1000, transient_max_gb=5),
    )
    monkeypatch.setattr(scan_app, "dashboard_cache_payload", None)
    monkeypatch.setattr(scan_app, "dashboard_cache_ts", 0.0)

    first = scan_app.dashboard(_={})
    second = scan_app.dashboard(_={})
    assert first["cached"] is False
    assert second["cached"] is True
    assert calls["dashboard"] == 1

    monkeypatch.setattr(
        scan_app,
        "config",
        SimpleNamespace(dashboard_cache_ttl_sec=1, ingest_max_pending_pdf_jobs=1000, transient_max_gb=5),
    )
    monkeypatch.setattr(scan_app, "dashboard_cache_ts", 0.0)
    stale = scan_app.dashboard(_={})
    assert stale["cached"] is True
    assert stale["degraded"] is True


def test_lifespan_purges_legacy_artifacts_before_worker_start(monkeypatch):
    events: list[str] = []

    class _FakeStore:
        def purge_all_artifacts(self):
            events.append("purge")
            return {"artifact_rows": 2, "artifact_files": 3, "artifact_dirs": 1}

        def reconcile_job_pdf_spool(self):
            events.append("reconcile-spool")
            return {"removed_orphan_files": 1, "removed_final_files": 1, "failed_jobs": 0}

    class _FakeWorker:
        def is_alive(self):
            return False

        def start(self):
            events.append("start")

        def join(self, timeout=0):
            events.append(f"join:{timeout}")

    monkeypatch.setattr(scan_app, "store", _FakeStore())
    monkeypatch.setattr(scan_app, "worker", _FakeWorker())
    scan_app.stop_event.clear()

    async def _run():
        async with scan_app.lifespan(scan_app.app):
            events.append("inside")

    asyncio.run(_run())

    assert events[:4] == ["purge", "reconcile-spool", "start", "inside"]


def test_agents_activity_returns_batched_runtime_state(temp_dir, monkeypatch):
    store = _make_store(temp_dir)
    monkeypatch.setattr(scan_app, "store", store)

    store.upsert_agent_heartbeat(
        {
            "agent_id": "agent-1",
            "hostname": "HOST-01",
            "branch": "РўСЋРјРµРЅСЊ",
            "ip_address": "10.10.1.1",
            "version": "1.2.3",
            "status": "online",
            "last_seen_at": 1710000000,
        }
    )
    store.create_task(agent_id="agent-1", command="scan_now", dedupe_key="scan_now:agent-1")

    result = scan_app.agents_activity(agent_id=["agent-1"], _={})

    assert result["items"][0]["agent_id"] == "agent-1"
    assert result["items"][0]["queue_size"] >= 1
    assert result["items"][0]["active_task"]["command"] == "scan_now"


def test_patterns_endpoint_returns_yaml_patterns():
    result = scan_app.patterns(_={})

    assert result["total"] >= 1
    assert any(item["id"] == "loan_keyword" for item in result["items"])


def test_scan_auth_runtime_loads_service_singletons_after_submodule_imports():
    importlib.import_module("backend.services.authorization_service")
    importlib.import_module("backend.services.session_service")
    importlib.import_module("backend.services.user_service")
    scan_app._load_web_auth_runtime.cache_clear()

    runtime = scan_app._load_web_auth_runtime()

    assert hasattr(runtime["authorization_service"], "has_permission")
    assert hasattr(runtime["session_service"], "is_session_active")
    assert hasattr(runtime["user_service"], "get_by_id")


def test_authorization_module_keeps_has_permission_compatibility_facade():
    authorization_module = importlib.import_module("backend.services.authorization_service")

    assert authorization_module.has_permission("operator", scan_app.PERM_SCAN_READ) is True
    assert authorization_module.has_permission("viewer", scan_app.PERM_SCAN_READ) is False
