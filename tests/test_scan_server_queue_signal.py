from __future__ import annotations

from types import SimpleNamespace

import scan_server.app as scan_app


def test_backpressure_exception_includes_server_queue_pending():
    exc = scan_app._backpressure_exception(
        {
            "total_pending": 2500,
            "retry_after_sec": 90,
            "active": True,
            "reasons": ["total_pending_limit"],
        },
        is_pdf=False,
    )
    assert exc.status_code == 429
    assert exc.detail["server_queue_pending"] == 2500
    assert exc.detail["total_pending"] == 2500
    assert exc.headers["Retry-After"] == "90"


def test_queue_ingest_blocking_returns_server_queue_pending(monkeypatch):
    class _Store:
        def ingest_backpressure_status(self, **_kwargs):
            return {
                "active": False,
                "total_active": False,
                "total_pending": 12,
                "reasons": [],
                "total_reasons": [],
            }

        def touch_agent_presence(self, **_kwargs):
            return None

        def queue_job(self, data, pdf_bytes=None):
            return {"job_id": "job-1", "deduped": False}

    monkeypatch.setattr(scan_app, "store", _Store())
    monkeypatch.setattr(
        scan_app,
        "config",
        SimpleNamespace(
            ingest_max_pending_pdf_jobs=4000,
            ingest_max_pending_jobs=4000,
            transient_max_gb=80,
            ingest_retry_after_sec=60,
            ingest_retry_after_max_sec=600,
        ),
    )

    result = scan_app._queue_ingest_blocking(
        {
            "agent_id": "tmn-it-0009",
            "hostname": "TMN-IT-0009",
            "file_path": r"C:\tmp\a.txt",
            "file_name": "a.txt",
            "file_hash": "abc",
            "source_kind": "text",
        },
        request_ip="10.0.0.1",
    )
    assert result["success"] is True
    assert result["server_queue_pending"] == 13
    assert result["job_id"] == "job-1"
