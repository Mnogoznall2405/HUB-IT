from __future__ import annotations

import asyncio
import importlib
import json
import sqlite3
import time
from dataclasses import replace
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


def test_health_exposes_ocr_capacity_and_large_page_limits():
    payload = asyncio.run(scan_app.health())

    assert payload["analysis"]["ocr_page_limit"] == 3
    assert payload["analysis"]["text_page_limit"] == 10
    assert payload["analysis"]["focused_ocr_dpi"] >= 400
    assert payload["analysis"]["full_page_max_pixels"] >= 20_000_000
    assert payload["analysis"]["focused_region_max_pixels"] >= 12_000_000
    assert payload["analysis"]["pdf_max_bytes"] >= 25 * 1024 * 1024


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


def test_ingest_pdf_slice_bounds_upload_and_records_incomplete_job(temp_dir, monkeypatch):
    store = _make_store(temp_dir)
    monkeypatch.setattr(scan_app, "store", store)
    monkeypatch.setattr(scan_app, "config", replace(scan_app.config, pdf_max_bytes=4))
    metadata = {
        "agent_id": "agent-1",
        "hostname": "HOST-01",
        "file_path": r"C:\Scan\oversize.pdf",
        "file_name": "oversize.pdf",
        "file_hash": "hash-oversize",
        "source_kind": "pdf_slice",
        "event_id": "oversize-event",
    }
    upload = UploadFile(filename="oversize.pdf", file=BytesIO(b"12345-more-bytes"))

    result = asyncio.run(
        scan_app.ingest_pdf_slice(
            _fake_request("10.105.0.18"),
            metadata_json=json.dumps(metadata),
            pdf_slice=upload,
            x_api_key=scan_app.config.api_keys[0],
        )
    )

    assert result["success"] is True
    assert store.read_job_pdf_spool(job_id=result["job_id"]) == b""
    item = store.list_incomplete_jobs(limit=10, offset=0)
    assert item["total"] == 0
    with store._lock, store._connect() as conn:
        row = conn.execute("SELECT source_kind, payload_json FROM scan_jobs WHERE id=?", (result["job_id"],)).fetchone()
    assert row["source_kind"] == "analysis_incomplete"
    assert json.loads(row["payload_json"])["metadata"]["analysis_incomplete_reason"] == "pdf_slice_payload_too_large"


def test_ingest_document_accepts_supported_image_and_spools_payload(temp_dir, monkeypatch):
    store = _make_store(temp_dir)
    monkeypatch.setattr(scan_app, "store", store)
    metadata = {
        "agent_id": "agent-1",
        "hostname": "HOST-01",
        "file_path": r"C:\Scan\stamp.jpg",
        "file_name": "stamp.jpg",
        "file_hash": "hash-image",
        "file_size": 11,
        "source_kind": "image",
        "event_id": "image-event",
        "metadata": {"analysis_version": "scan-ocr3-text10-v2"},
    }
    upload = UploadFile(filename="stamp.jpg", file=BytesIO(b"image-bytes"))

    result = asyncio.run(
        scan_app.ingest_document(
            _fake_request("10.105.0.18"),
            metadata_json=json.dumps(metadata),
            document=upload,
            x_api_key=scan_app.config.api_keys[0],
        )
    )

    assert result["success"] is True
    assert store.read_job_pdf_spool(job_id=result["job_id"]) == b"image-bytes"


def test_incident_ack_uses_authenticated_actor_not_client_value(monkeypatch):
    calls = {}
    monkeypatch.setattr(
        scan_app,
        "store",
        SimpleNamespace(ack_incident=lambda **kwargs: calls.setdefault("ack", kwargs) or {"id": "inc-1"}),
    )

    result = scan_app.ack_incident(
        "inc-1",
        scan_app.IncidentAckPayload(ack_by="spoofed-user"),
        {"id": "user-1", "username": "real-user"},
    )

    assert result["success"] is True
    assert calls["ack"]["ack_by"] == "real-user"


def test_bulk_ack_rejects_accidental_unfiltered_request(monkeypatch):
    monkeypatch.setattr(scan_app, "store", SimpleNamespace(bulk_ack_incidents=lambda **kwargs: kwargs))

    try:
        scan_app.bulk_ack_incidents(
            scan_app.IncidentBulkAckPayload(),
            {"id": "user-1", "username": "real-user"},
        )
    except HTTPException as exc:
        assert exc.status_code == 400
    else:
        raise AssertionError("Expected HTTPException")


def test_bulk_ack_all_requires_explicit_confirmation_and_uses_authenticated_actor(monkeypatch):
    calls = {}
    monkeypatch.setattr(
        scan_app,
        "store",
        SimpleNamespace(bulk_ack_incidents=lambda **kwargs: calls.setdefault("bulk", kwargs) or {"success": True}),
    )

    scan_app.bulk_ack_incidents(
        scan_app.IncidentBulkAckPayload(confirm_all=True, ack_by="spoofed-user"),
        {"id": "user-1", "username": "real-user"},
    )

    assert calls["bulk"]["ack_by"] == "real-user"


def test_review_items_returns_incomplete_file_reason(temp_dir):
    store = _make_store(temp_dir)
    queued = store.queue_job(
        {
            "agent_id": "agent-1",
            "hostname": "HOST-01",
            "file_path": r"C:\Scan\broken.pdf",
            "file_name": "broken.pdf",
            "file_hash": "hash-broken",
            "source_kind": "analysis_incomplete",
            "metadata": {
                "analysis_version": "scan-ocr3-text10-v2",
                "extraction_outcomes": [{"page": 1, "outcome": "timeout"}],
            },
        }
    )
    store.finalize_job(
        job_id=queued["job_id"],
        status="analysis_incomplete",
        error_text="pdf_slice_creation_failed",
    )

    result = store.list_incomplete_jobs(limit=10, offset=0)

    assert result["total"] == 1
    assert result["items"][0]["hostname"] == "HOST-01"
    assert result["items"][0]["reason"] == "pdf_slice_creation_failed"
    # Summary must never fake empty/zero when payload details are omitted for speed.
    assert result.get("view") == "summary"
    assert result.get("details_omitted") is True
    assert result["items"][0].get("details_omitted") is True
    assert result["items"][0].get("analysis_version") is None
    assert result["items"][0].get("extraction_outcomes") is None
    assert result["items"][0].get("extraction_outcomes_count") is None

    detail = store.list_incomplete_jobs(limit=10, offset=0, view="detail")
    assert detail.get("view") == "detail"
    assert detail["items"][0].get("analysis_version") == "scan-ocr3-text10-v2"
    assert detail["items"][0].get("extraction_outcomes_count") == 1
    assert detail["items"][0]["extraction_outcomes"][0]["outcome"] == "timeout"


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
        SimpleNamespace(
            dashboard_cache_ttl_sec=60,
            ingest_max_pending_pdf_jobs=1000,
            ingest_max_pending_jobs=2000,
            ingest_max_concurrency=4,
            transient_max_gb=5,
        ),
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
        SimpleNamespace(
            dashboard_cache_ttl_sec=1,
            ingest_max_pending_pdf_jobs=1000,
            ingest_max_pending_jobs=2000,
            ingest_max_concurrency=4,
            transient_max_gb=5,
        ),
    )
    monkeypatch.setattr(scan_app, "dashboard_cache_ts", 0.0)
    stale = scan_app.dashboard(_={})
    assert stale["cached"] is True
    assert stale["refreshing"] is True

    deadline = time.monotonic() + 2.0
    while scan_app.dashboard_inflight_event is not None and time.monotonic() < deadline:
        time.sleep(0.01)
    monkeypatch.setattr(scan_app, "dashboard_cache_ts", 0.0)
    degraded = scan_app.dashboard(_={})
    assert degraded["cached"] is True
    assert degraded["degraded"] is True


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


def test_scan_auth_uses_web_backend_http_boundary(monkeypatch):
    seen = []

    def _fake_fetch(token, **kwargs):
        seen.append({"token": token, **kwargs})
        return {"id": 1, "is_active": True, "role": "operator", "permissions": [scan_app.PERM_SCAN_READ]}

    monkeypatch.setattr(scan_app, "_fetch_web_user", _fake_fetch)
    dependency = scan_app.require_web_permission(scan_app.PERM_SCAN_READ)
    request = scan_app.Request(
        {
            "type": "http",
            "asgi": {"version": "3.0"},
            "http_version": "1.1",
            "method": "GET",
            "scheme": "http",
            "path": "/api/v1/scan/incidents",
            "raw_path": b"/api/v1/scan/incidents",
            "query_string": b"",
            "headers": [
                (b"x-forwarded-for", b"10.105.0.42"),
                (b"x-forwarded-proto", b"https"),
                (b"host", b"hubit.zsgp.ru"),
            ],
            "client": ("127.0.0.1", 12345),
            "server": ("127.0.0.1", 8011),
        }
    )

    user = dependency(
        request=request,
        credentials=scan_app.HTTPAuthorizationCredentials(scheme="Bearer", credentials="web-token"),
        access_token_cookie=None,
    )

    assert user["id"] == 1
    assert seen == [
        {
            "token": "web-token",
            "client_ip": "10.105.0.42",
            "forwarded_proto": "https",
            "forwarded_host": "hubit.zsgp.ru",
        }
    ]


def test_authorization_module_keeps_has_permission_compatibility_facade():
    authorization_module = importlib.import_module("backend.services.authorization_service")

    assert authorization_module.has_permission("operator", scan_app.PERM_SCAN_READ) is True
    assert authorization_module.has_permission("viewer", scan_app.PERM_SCAN_READ) is False


def test_tasks_and_scan_runs_view_defaults_and_metrics_legacy(temp_dir, monkeypatch):
    store = _make_store(temp_dir)
    monkeypatch.setattr(scan_app, "store", store)
    store.upsert_agent_heartbeat(
        {"agent_id": "agent-compat", "hostname": "HOST-COMPAT", "last_seen_at": int(__import__("time").time())}
    )
    task = store.create_task(
        agent_id="agent-compat",
        command="scan_now",
        payload={"force_rescan": True, "noise": "n" * 1000},
    )
    # Recent timestamps so view=chart default from_ts=now-6h still includes samples.
    metrics_base_ts = int(__import__("time").time()) - 60
    for idx in range(25):
        store.record_system_metric_samples(
            task_ids=[task["id"]],
            sample={
                "captured_at": metrics_base_ts + idx,
                "cpu_percent": float(idx),
                "memory_percent": 10.0,
                "memory_used_bytes": 1,
                "memory_available_bytes": 1,
                "disk_read_bytes": 1,
                "disk_write_bytes": 1,
                "disk_read_bps": 1.0,
                "disk_write_bps": 1.0,
                "network_sent_bytes": 1,
                "network_received_bytes": 1,
                "network_sent_bps": 1.0,
                "network_received_bps": 1.0,
                "process_rss_bytes": 1,
            },
        )

    # Call handlers with concrete kwargs (bypass FastAPI Query defaults).
    tasks_default = scan_app.tasks(
        agent_id=None, status_value=None, command=None, limit=50, offset=0, view="detail", _={}
    )
    assert tasks_default["view"] == "detail"
    assert "noise" in tasks_default["items"][0]["payload"]

    tasks_summary = scan_app.tasks(
        agent_id=None, status_value=None, command=None, limit=50, offset=0, view="summary", _={}
    )
    assert tasks_summary["view"] == "summary"
    assert "noise" not in tasks_summary["items"][0]["payload"]

    runs_default = scan_app.host_scan_runs(
        hostname="HOST-COMPAT", limit=30, offset=0, view="detail", _={}
    )
    assert runs_default["view"] == "detail"
    assert "noise" in runs_default["items"][0]["payload"]

    runs_summary = scan_app.host_scan_runs(
        hostname="HOST-COMPAT", limit=30, offset=0, view="summary", _={}
    )
    assert runs_summary["view"] == "summary"
    assert "noise" not in runs_summary["items"][0]["payload"]

    metrics_legacy = scan_app.task_system_metrics(
        task_id=task["id"], limit=5000, offset=0, from_ts=None, to_ts=None, max_points=None, view=None, _={}
    )
    assert metrics_legacy["downsampled"] is False
    assert len(metrics_legacy["items"]) == 25

    metrics_chart = scan_app.task_system_metrics(
        task_id=task["id"], limit=5000, offset=0, from_ts=None, to_ts=None, max_points=8, view=None, _={}
    )
    assert metrics_chart["downsampled"] is True
    assert len(metrics_chart["items"]) <= 8

    metrics_view_chart = scan_app.task_system_metrics(
        task_id=task["id"], limit=5000, offset=0, from_ts=None, to_ts=None, max_points=None, view="chart", _={}
    )
    # view=chart applies max_points=500 and from_ts≈now-6h; with only 25 rows downsample is a no-op.
    assert metrics_view_chart["max_points"] == 500
    assert metrics_view_chart.get("from_ts") is not None
    assert len(metrics_view_chart["items"]) == 25
    assert metrics_view_chart["downsampled"] is False


def test_sqlite_store_uses_timed_rlock(temp_dir):
    store = _make_store(temp_dir)
    assert store._lock_kind == "rlock"
    assert store._lock.__class__.__name__ == "TimedLock"


def test_timing_headers_fail_closed_by_default(monkeypatch):
    monkeypatch.delenv("SCAN_PERF_TIMING_HEADERS_ENABLED", raising=False)
    assert scan_app._timing_headers_enabled() is False
    payload = asyncio.run(scan_app.health())
    assert payload["timing_headers_enabled"] is False


def test_timing_headers_enabled_when_flag_true(monkeypatch):
    from starlette.requests import Request
    from starlette.responses import JSONResponse

    monkeypatch.setenv("SCAN_PERF_TIMING_HEADERS_ENABLED", "true")
    assert scan_app._timing_headers_enabled() is True
    payload = asyncio.run(scan_app.health())
    assert payload["timing_headers_enabled"] is True

    middleware = scan_app._ScanTimingMiddleware(app=scan_app.app)

    async def _call_next(_request):
        return JSONResponse({"ok": True})

    request = Request({"type": "http", "asgi": {"version": "3.0"}, "http_version": "1.1",
                       "method": "GET", "scheme": "http", "path": "/health",
                       "raw_path": b"/health", "query_string": b"", "headers": [],
                       "client": ("127.0.0.1", 123), "server": ("127.0.0.1", 80)})
    response = asyncio.run(middleware.dispatch(request, _call_next))
    assert "X-Scan-Request-Total-Ms" in response.headers
    assert "X-Scan-Store-Lock-Wait-Ms" in response.headers
    assert "X-Scan-Db-Query-Ms" in response.headers


def test_timing_headers_invalid_bool_stays_disabled(monkeypatch):
    from starlette.requests import Request
    from starlette.responses import JSONResponse

    monkeypatch.setenv("SCAN_PERF_TIMING_HEADERS_ENABLED", "maybe")
    assert scan_app._timing_headers_enabled() is False
    payload = asyncio.run(scan_app.health())
    assert payload["timing_headers_enabled"] is False

    middleware = scan_app._ScanTimingMiddleware(app=scan_app.app)

    async def _call_next(_request):
        return JSONResponse({"ok": True})

    request = Request({"type": "http", "asgi": {"version": "3.0"}, "http_version": "1.1",
                       "method": "GET", "scheme": "http", "path": "/health",
                       "raw_path": b"/health", "query_string": b"", "headers": [],
                       "client": ("127.0.0.1", 123), "server": ("127.0.0.1", 80)})
    response = asyncio.run(middleware.dispatch(request, _call_next))
    assert "X-Scan-Request-Total-Ms" not in response.headers
