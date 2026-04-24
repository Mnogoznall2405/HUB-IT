from __future__ import annotations

import asyncio
from pathlib import Path
from types import SimpleNamespace

import scan_server.app as scan_app
from scan_server.app import IngestPayload
from scan_server.database import ScanStore


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

    result = asyncio.run(scan_app.agents_activity(agent_id=["agent-1"], _={}))

    assert result["items"][0]["agent_id"] == "agent-1"
    assert result["items"][0]["queue_size"] >= 1
    assert result["items"][0]["active_task"]["command"] == "scan_now"
