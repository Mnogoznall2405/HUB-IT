from __future__ import annotations

import base64
import json
import time
from pathlib import Path

import scan_server.database as scan_database
from scan_server.database import ScanStore
from scan_server.maintenance import scrub_scan_job_pdf_payloads


def _make_store(temp_dir: str) -> ScanStore:
    root = Path(temp_dir)
    return ScanStore(
        db_path=root / "scan-server.db",
        archive_dir=root / "archive",
        task_ack_timeout_sec=300,
        agent_online_timeout_sec=1800,
    )


def _get_job(store: ScanStore, job_id: str) -> dict:
    with store._lock, store._connect() as conn:
        row = conn.execute("SELECT * FROM scan_jobs WHERE id=?", (job_id,)).fetchone()
    return dict(row)


def _get_task(store: ScanStore, task_id: str) -> dict:
    with store._lock, store._connect() as conn:
        row = conn.execute("SELECT * FROM scan_tasks WHERE id=?", (task_id,)).fetchone()
    return dict(row)


def _pdf_b64(value: bytes = b"%PDF-1.4 test\n") -> str:
    return base64.b64encode(value).decode("ascii")


def _set_incident_created_at(store: ScanStore, incident_id: str, created_at: int) -> None:
    with store._lock, store._connect() as conn:
        conn.execute("UPDATE scan_incidents SET created_at=? WHERE id=?", (int(created_at), incident_id))
        conn.commit()


def _seed_incident(
    store: ScanStore,
    *,
    agent_id: str,
    hostname: str,
    branch: str,
    user_login: str,
    user_full_name: str,
    file_path: str,
    file_name: str,
    source_kind: str,
    severity: str,
    status: str = "new",
    created_at: int | None = None,
) -> dict:
    queued = store.queue_job(
        {
            "agent_id": agent_id,
            "hostname": hostname,
            "branch": branch,
            "user_login": user_login,
            "user_full_name": user_full_name,
            "file_path": file_path,
            "file_name": file_name,
            "file_hash": f"hash-{agent_id}-{hostname}-{file_name}",
            "file_size": 2048,
            "source_kind": source_kind,
            "event_id": f"{agent_id}:{hostname}:{file_name}:{severity}",
        }
    )
    job = _get_job(store, queued["job_id"])
    result = store.create_finding_and_incident(
        job=job,
        severity=severity,
        category="secrets",
        matched_patterns=[{"pattern_name": "password", "value": "secret"}],
        short_reason="pattern match",
    )
    if created_at is not None:
        _set_incident_created_at(store, result["incident_id"], created_at)
    if status == "ack":
        store.ack_incident(incident_id=result["incident_id"], ack_by="tester")
    return result


def test_list_agents_table_and_tasks_include_active_and_last_task(temp_dir):
    store = _make_store(temp_dir)
    now_ts = int(time.time())

    store.upsert_agent_heartbeat(
        {
            "agent_id": "agent-1",
            "hostname": "HOST-01",
            "branch": "Тюмень",
            "ip_address": "10.10.1.1",
            "version": "1.2.3",
            "status": "online",
            "last_seen_at": now_ts,
        }
    )
    store.upsert_agent_heartbeat(
        {
            "agent_id": "agent-2",
            "hostname": "HOST-02",
            "branch": "Москва",
            "ip_address": "10.10.1.2",
            "version": "1.2.3",
            "status": "online",
            "last_seen_at": now_ts - 3600,
        }
    )

    active_task = store.create_task(agent_id="agent-1", command="scan_now", dedupe_key="scan_now:agent-1")
    finished_task = store.create_task(agent_id="agent-2", command="ping", dedupe_key="ping:agent-2")
    store.report_task_result(
        agent_id="agent-2",
        task_id=finished_task["id"],
        status="completed",
        result={"pong": True},
        error_text="",
    )

    response = store.list_agents_table(
        q="host-01",
        branch="тюм",
        online="online",
        task_status="active",
        limit=10,
        offset=0,
        sort_by="online",
        sort_dir="desc",
    )

    assert response["total"] == 1
    item = response["items"][0]
    assert item["agent_id"] == "agent-1"
    assert item["hostname"] == "HOST-01"
    assert item["branch"] == "Тюмень"
    assert item["ip_address"] == "10.10.1.1"
    assert item["queue_size"] == 1
    assert item["active_task"]["id"] == active_task["id"]
    assert item["active_task"]["status"] == "queued"
    assert item["last_task"]["id"] == active_task["id"]

    tasks = store.list_tasks(
        agent_id="agent-1",
        status="active",
        command="scan_now",
        limit=10,
        offset=0,
    )
    assert tasks["total"] == 1
    assert tasks["items"][0]["id"] == active_task["id"]
    assert tasks["items"][0]["status"] == "queued"


def test_list_agents_table_prefers_active_scan_jobs_over_ping_task(temp_dir):
    store = _make_store(temp_dir)
    now_ts = int(time.time())

    store.upsert_agent_heartbeat(
        {
            "agent_id": "agent-scan",
            "hostname": "HOST-SCAN",
            "branch": "РўСЋРјРµРЅСЊ",
            "ip_address": "10.10.1.15",
            "version": "1.2.3",
            "status": "online",
            "last_seen_at": now_ts,
        }
    )
    store.create_task(agent_id="agent-scan", command="ping", dedupe_key="ping:agent-scan")
    store.queue_job(
        {
            "agent_id": "agent-scan",
            "hostname": "HOST-SCAN",
            "branch": "РўСЋРјРµРЅСЊ",
            "file_path": r"C:\Docs\scan.pdf",
            "file_name": "scan.pdf",
            "file_hash": "hash-scan",
            "file_size": 2048,
            "source_kind": "pdf",
            "event_id": "agent-scan:event-1",
        }
    )

    response = store.list_agents_table(online="online", limit=10, offset=0)

    assert response["total"] == 1
    item = response["items"][0]
    assert item["active_task"]["command"] == "scan_now"
    assert item["active_task"]["status"] == "queued"


def test_list_hosts_table_filters_and_aggregates_host_context(temp_dir):
    store = _make_store(temp_dir)
    now_ts = int(time.time())

    store.upsert_agent_heartbeat(
        {
            "agent_id": "agent-1",
            "hostname": "HOST-01",
            "branch": "Тюмень",
            "ip_address": "10.10.15.25",
            "version": "1.2.3",
            "status": "online",
            "last_seen_at": now_ts,
        }
    )

    _seed_incident(
        store,
        agent_id="agent-1",
        hostname="HOST-01",
        branch="Тюмень",
        user_login="corp\\petrov",
        user_full_name="Петров П.П.",
        file_path=r"C:\Docs\secret.pdf",
        file_name="secret.pdf",
        source_kind="pdf",
        severity="high",
        status="new",
        created_at=now_ts - 30,
    )
    _seed_incident(
        store,
        agent_id="agent-1",
        hostname="HOST-01",
        branch="Тюмень",
        user_login="corp\\petrov",
        user_full_name="Петров П.П.",
        file_path=r"C:\Docs\notes.txt",
        file_name="notes.txt",
        source_kind="text",
        severity="low",
        status="ack",
        created_at=now_ts - 60,
    )
    _seed_incident(
        store,
        agent_id="agent-2",
        hostname="HOST-02",
        branch="Москва",
        user_login="corp\\ivanov",
        user_full_name="Иванов И.И.",
        file_path=r"C:\Docs\other.pdf",
        file_name="other.pdf",
        source_kind="pdf",
        severity="medium",
        status="new",
        created_at=now_ts - 90,
    )

    filtered = store.list_hosts_table(
        q="host-01",
        branch="тюм",
        status="new",
        severity="high",
        limit=10,
        offset=0,
        sort_by="incidents_new",
        sort_dir="desc",
    )

    assert filtered["total"] == 1
    item = filtered["items"][0]
    assert item["hostname"] == "HOST-01"
    assert item["branch"] == "Тюмень"
    assert item["user"] == "Петров П.П."
    assert item["ip_address"] == "10.10.15.25"
    assert item["incidents_new"] == 1
    assert item["incidents_total"] == 1
    assert item["top_severity"] == "high"
    assert "pdf" in item["top_exts"]
    assert "text" in item["top_source_kinds"]

    ack_hosts = store.list_hosts_table(status="ack", limit=10, offset=0)
    assert ack_hosts["total"] == 1
    assert ack_hosts["items"][0]["hostname"] == "HOST-01"


def test_agent_online_timeout_is_used_for_agents_and_dashboard(temp_dir):
    store = _make_store(temp_dir)
    now_ts = int(time.time())

    store.upsert_agent_heartbeat(
        {
            "agent_id": "agent-recent",
            "hostname": "HOST-RECENT",
            "branch": "Тюмень",
            "ip_address": "10.10.1.10",
            "version": "1.2.3",
            "status": "online",
            "last_seen_at": now_ts - 900,
        }
    )
    store.upsert_agent_heartbeat(
        {
            "agent_id": "agent-old",
            "hostname": "HOST-OLD",
            "branch": "Тюмень",
            "ip_address": "10.10.1.11",
            "version": "1.2.3",
            "status": "online",
            "last_seen_at": now_ts - 2400,
        }
    )

    agents = {item["agent_id"]: item for item in store.list_agents()}
    assert agents["agent-recent"]["is_online"] is True
    assert agents["agent-old"]["is_online"] is False

    dashboard = store.dashboard()
    assert dashboard["totals"]["agents_total"] == 2
    assert dashboard["totals"]["agents_online"] == 1
    assert dashboard["totals"]["agents_offline"] == 1


def test_scan_task_progress_tracks_linked_jobs_until_all_ocr_finishes(temp_dir):
    store = _make_store(temp_dir)
    task = store.create_task(agent_id="agent-1", command="scan_now", dedupe_key="scan_now:agent-1")
    store.report_task_result(
        agent_id="agent-1",
        task_id=task["id"],
        status="acknowledged",
        result={
            "phase": "server_processing",
            "scanned": 2,
            "queued": 2,
            "skipped": 0,
            "deferred": 0,
            "jobs_total": 2,
            "jobs_pending": 2,
            "jobs_done_clean": 0,
            "jobs_done_with_incident": 0,
            "jobs_failed": 0,
        },
        error_text="",
    )

    first_job = store.queue_job(
        {
            "agent_id": "agent-1",
            "hostname": "HOST-01",
            "branch": "Тюмень",
            "user_login": "corp\\petrov",
            "user_full_name": "Петров П.П.",
            "file_path": r"C:\Docs\secret-1.pdf",
            "file_name": "secret-1.pdf",
            "file_hash": "hash-1",
            "file_size": 2048,
            "source_kind": "pdf_slice",
            "pdf_slice_b64": _pdf_b64(),
            "event_id": "scan-task-1",
            "scan_task_id": task["id"],
        }
    )
    second_job = store.queue_job(
        {
            "agent_id": "agent-1",
            "hostname": "HOST-01",
            "branch": "Тюмень",
            "user_login": "corp\\petrov",
            "user_full_name": "Петров П.П.",
            "file_path": r"C:\Docs\secret-2.pdf",
            "file_name": "secret-2.pdf",
            "file_hash": "hash-2",
            "file_size": 2048,
            "source_kind": "pdf_slice",
            "pdf_slice_b64": _pdf_b64(),
            "event_id": "scan-task-2",
            "scan_task_id": task["id"],
        }
    )

    assert _get_job(store, first_job["job_id"])["scan_task_id"] == task["id"]
    task_row = _get_task(store, task["id"])
    assert task_row["status"] == "acknowledged"
    assert json.loads(task_row["result_json"])["jobs_pending"] == 2

    store.finalize_job(job_id=first_job["job_id"], status="done_clean", summary="clean")

    task_row = _get_task(store, task["id"])
    task_result = json.loads(task_row["result_json"])
    assert task_row["status"] == "acknowledged"
    assert task_result["phase"] == "server_processing"
    assert task_result["jobs_pending"] == 1
    assert task_result["jobs_done_clean"] == 1

    store.finalize_job(job_id=second_job["job_id"], status="done_with_incident", summary="incident")

    task_row = _get_task(store, task["id"])
    task_result = json.loads(task_row["result_json"])
    assert task_row["status"] == "completed"
    assert task_result["phase"] == "completed"
    assert task_result["jobs_pending"] == 0
    assert task_result["jobs_done_with_incident"] == 1


def test_queue_job_strips_pdf_from_payload_json_and_writes_transient_spool(temp_dir):
    store = _make_store(temp_dir)

    queued = store.queue_job(
        {
            "agent_id": "agent-1",
            "hostname": "HOST-01",
            "branch": "РўСЋРјРµРЅСЊ",
            "file_path": r"C:\Docs\secret.pdf",
            "file_name": "secret.pdf",
            "file_hash": "hash-secret",
            "file_size": 2048,
            "source_kind": "pdf_slice",
            "event_id": "pdf-spool-1",
            "pdf_slice_b64": _pdf_b64(b"%PDF-1.4 spool"),
        }
    )

    job_row = _get_job(store, queued["job_id"])
    payload = json.loads(job_row["payload_json"])
    assert "pdf_slice_b64" not in payload
    assert store.read_job_pdf_spool(job_id=queued["job_id"]) == b"%PDF-1.4 spool"


def test_acknowledged_local_scan_task_switches_to_server_processing_when_jobs_exist(temp_dir):
    store = _make_store(temp_dir)
    task = store.create_task(agent_id="agent-1", command="scan_now", dedupe_key="scan_now:agent-1")
    store.report_task_result(
        agent_id="agent-1",
        task_id=task["id"],
        status="acknowledged",
        result={
            "phase": "local_scan",
            "scanned": 2,
            "queued": 2,
            "skipped": 0,
            "deferred": 0,
            "jobs_total": 0,
            "jobs_pending": 0,
            "jobs_done_clean": 0,
            "jobs_done_with_incident": 0,
            "jobs_failed": 0,
        },
        error_text="",
    )
    stale_updated_at = int(time.time()) - (store.task_ack_timeout_sec + 30)
    with store._lock, store._connect() as conn:
        conn.execute(
            """
            UPDATE scan_tasks
            SET updated_at=?, acked_at=?, delivered_at=?
            WHERE id=?
            """,
            (stale_updated_at, stale_updated_at, stale_updated_at, task["id"]),
        )
        conn.commit()

    store.queue_job(
        {
            "agent_id": "agent-1",
            "hostname": "HOST-01",
            "branch": "РўСЋРјРµРЅСЊ",
            "file_path": r"C:\Docs\later.pdf",
            "file_name": "later.pdf",
            "file_hash": "hash-later",
            "file_size": 2048,
            "source_kind": "pdf_slice",
            "event_id": "scan-task-local-scan",
            "scan_task_id": task["id"],
            "pdf_slice_b64": _pdf_b64(),
        }
    )

    task_row = _get_task(store, task["id"])
    task_result = json.loads(task_row["result_json"])
    assert task_row["status"] == "acknowledged"
    assert task_result["phase"] == "server_processing"
    assert task_result["jobs_total"] == 1
    assert task_result["jobs_pending"] == 1


def test_queue_job_does_not_link_new_job_to_final_scan_task(temp_dir):
    store = _make_store(temp_dir)
    task = store.create_task(agent_id="agent-1", command="scan_now", dedupe_key="scan_now:agent-1")
    store.report_task_result(
        agent_id="agent-1",
        task_id=task["id"],
        status="failed",
        result={"phase": "failed", "jobs_total": 0, "jobs_pending": 0, "jobs_done_clean": 0, "jobs_done_with_incident": 0, "jobs_failed": 0},
        error_text="Deferred to outbox: 1",
    )

    queued = store.queue_job(
        {
            "agent_id": "agent-1",
            "hostname": "HOST-01",
            "branch": "РўСЋРјРµРЅСЊ",
            "file_path": r"C:\Docs\replay.pdf",
            "file_name": "replay.pdf",
            "file_hash": "hash-replay",
            "file_size": 2048,
            "source_kind": "pdf_slice",
            "event_id": "late-replay",
            "scan_task_id": task["id"],
            "pdf_slice_b64": _pdf_b64(),
        }
    )

    job_row = _get_job(store, queued["job_id"])
    task_row = _get_task(store, task["id"])
    assert job_row["scan_task_id"] in (None, "")
    assert task_row["status"] == "failed"
    assert task_row["error_text"] == "Deferred to outbox: 1"


def test_report_task_result_ignores_late_updates_for_final_task(temp_dir):
    store = _make_store(temp_dir)
    task = store.create_task(agent_id="agent-1", command="scan_now", dedupe_key="scan_now:agent-1")
    store.report_task_result(
        agent_id="agent-1",
        task_id=task["id"],
        status="completed",
        result={"phase": "completed", "jobs_total": 0, "jobs_pending": 0, "jobs_done_clean": 0, "jobs_done_with_incident": 0, "jobs_failed": 0},
        error_text="",
    )

    result = store.report_task_result(
        agent_id="agent-1",
        task_id=task["id"],
        status="acknowledged",
        result={"phase": "local_scan"},
        error_text="",
    )

    task_row = _get_task(store, task["id"])
    assert result == {"task_id": task["id"], "status": "completed"}
    assert task_row["status"] == "completed"


def test_scan_task_fails_when_any_linked_job_fails(temp_dir):
    store = _make_store(temp_dir)
    task = store.create_task(agent_id="agent-1", command="scan_now", dedupe_key="scan_now:agent-1")
    store.report_task_result(
        agent_id="agent-1",
        task_id=task["id"],
        status="acknowledged",
        result={
            "phase": "server_processing",
            "scanned": 1,
            "queued": 1,
            "skipped": 0,
            "deferred": 0,
            "jobs_total": 1,
            "jobs_pending": 1,
            "jobs_done_clean": 0,
            "jobs_done_with_incident": 0,
            "jobs_failed": 0,
        },
        error_text="",
    )
    job = store.queue_job(
        {
            "agent_id": "agent-1",
            "hostname": "HOST-01",
            "branch": "Тюмень",
            "user_login": "corp\\petrov",
            "user_full_name": "Петров П.П.",
            "file_path": r"C:\Docs\secret-1.pdf",
            "file_name": "secret-1.pdf",
            "file_hash": "hash-1",
            "file_size": 2048,
            "source_kind": "pdf_slice",
            "pdf_slice_b64": _pdf_b64(),
            "event_id": "scan-task-failed",
            "scan_task_id": task["id"],
        }
    )

    store.finalize_job(job_id=job["job_id"], status="failed", error_text="OCR exploded")

    task_row = _get_task(store, task["id"])
    task_result = json.loads(task_row["result_json"])
    assert task_row["status"] == "failed"
    assert task_row["error_text"] == "Linked OCR jobs failed"
    assert task_result["phase"] == "failed"
    assert task_result["jobs_failed"] == 1


def test_store_reconcile_completes_acknowledged_scan_task_after_restart(temp_dir):
    store = _make_store(temp_dir)
    task = store.create_task(agent_id="agent-1", command="scan_now", dedupe_key="scan_now:agent-1")
    store.report_task_result(
        agent_id="agent-1",
        task_id=task["id"],
        status="acknowledged",
        result={
            "phase": "server_processing",
            "scanned": 1,
            "queued": 1,
            "skipped": 0,
            "deferred": 0,
            "jobs_total": 1,
            "jobs_pending": 1,
            "jobs_done_clean": 0,
            "jobs_done_with_incident": 0,
            "jobs_failed": 0,
        },
        error_text="",
    )
    job = store.queue_job(
        {
            "agent_id": "agent-1",
            "hostname": "HOST-01",
            "branch": "Тюмень",
            "user_login": "corp\\petrov",
            "user_full_name": "Петров П.П.",
            "file_path": r"C:\Docs\secret-1.pdf",
            "file_name": "secret-1.pdf",
            "file_hash": "hash-1",
            "file_size": 2048,
            "source_kind": "pdf_slice",
            "pdf_slice_b64": _pdf_b64(),
            "event_id": "scan-task-restart",
            "scan_task_id": task["id"],
        }
    )

    with store._lock, store._connect() as conn:
        conn.execute(
            """
            UPDATE scan_jobs
            SET status='done_clean', finished_at=?, summary='clean'
            WHERE id=?
            """,
            (int(time.time()), job["job_id"]),
        )
        conn.execute(
            """
            UPDATE scan_tasks
            SET status='acknowledged', completed_at=NULL, error_text=NULL
            WHERE id=?
            """,
            (task["id"],),
        )
        conn.commit()

    reopened = _make_store(temp_dir)
    task_row = _get_task(reopened, task["id"])
    task_result = json.loads(task_row["result_json"])
    assert task_row["status"] == "completed"
    assert task_result["phase"] == "completed"
    assert task_result["jobs_done_clean"] == 1


def test_store_reconcile_fails_stale_local_scan_acknowledged_task(temp_dir):
    store = _make_store(temp_dir)
    task = store.create_task(agent_id="agent-1", command="scan_now", dedupe_key="scan_now:agent-1")
    store.report_task_result(
        agent_id="agent-1",
        task_id=task["id"],
        status="acknowledged",
        result={
            "phase": "local_scan",
            "scanned": 10,
            "queued": 0,
            "skipped": 10,
            "deferred": 0,
            "jobs_total": 0,
            "jobs_pending": 0,
            "jobs_done_clean": 0,
            "jobs_done_with_incident": 0,
            "jobs_failed": 0,
        },
        error_text="",
    )

    stale_updated_at = int(time.time()) - (store.task_ack_timeout_sec + 30)
    with store._lock, store._connect() as conn:
        conn.execute(
            """
            UPDATE scan_tasks
            SET updated_at=?, acked_at=?, delivered_at=?
            WHERE id=?
            """,
            (stale_updated_at, stale_updated_at, stale_updated_at, task["id"]),
        )
        conn.commit()

    reopened = _make_store(temp_dir)
    task_row = _get_task(reopened, task["id"])
    task_result = json.loads(task_row["result_json"])

    assert task_row["status"] == "failed"
    assert task_row["error_text"] == "Local scan acknowledgement timed out"
    assert task_result["phase"] == "failed"


def test_purge_all_artifacts_removes_archive_files_and_rows(temp_dir):
    store = _make_store(temp_dir)
    archive_day = store.archive_dir / "2026" / "04" / "07"
    archive_day.mkdir(parents=True, exist_ok=True)
    tracked_path = archive_day / "tracked.pdf"
    orphan_path = archive_day / "orphan.pdf"
    tracked_path.write_bytes(b"%PDF-1.4 tracked")
    orphan_path.write_bytes(b"%PDF-1.4 orphan")

    store.add_artifact(
        job_id="job-1",
        artifact_type="pdf_slice",
        storage_path=str(tracked_path),
        size_bytes=tracked_path.stat().st_size,
    )

    result = store.purge_all_artifacts()

    assert result["artifact_rows"] == 1
    assert result["artifact_files"] == 2
    assert store.archive_dir.exists()
    assert not any(store.archive_dir.rglob("*"))
    with store._lock, store._connect() as conn:
        remaining = conn.execute("SELECT COUNT(*) AS cnt FROM scan_artifacts").fetchone()["cnt"]
    assert remaining == 0


def test_cleanup_retention_keeps_artifacts_but_removes_old_history(temp_dir):
    store = _make_store(temp_dir)
    archive_day = store.archive_dir / "2026" / "04" / "07"
    archive_day.mkdir(parents=True, exist_ok=True)
    artifact_path = archive_day / "legacy.pdf"
    artifact_path.write_bytes(b"%PDF-1.4 legacy")

    old_ts = int(time.time()) - (3 * 24 * 60 * 60)
    task = store.create_task(agent_id="agent-1", command="ping", dedupe_key="ping:agent-1")
    job = store.queue_job(
        {
            "agent_id": "agent-1",
            "hostname": "HOST-01",
            "branch": "РўСЋРјРµРЅСЊ",
            "file_path": r"C:\Docs\old.pdf",
            "file_name": "old.pdf",
            "file_hash": "hash-old",
            "file_size": 2048,
            "source_kind": "pdf_slice",
            "pdf_slice_b64": _pdf_b64(),
            "event_id": "old-job",
        }
    )
    store.add_artifact(
        job_id=job["job_id"],
        artifact_type="pdf_slice",
        storage_path=str(artifact_path),
        size_bytes=artifact_path.stat().st_size,
    )

    with store._lock, store._connect() as conn:
        conn.execute(
            """
            UPDATE scan_tasks
            SET status='completed', updated_at=?, completed_at=?
            WHERE id=?
            """,
            (old_ts, old_ts, task["id"]),
        )
        conn.execute(
            """
            UPDATE scan_jobs
            SET status='done_clean', created_at=?, finished_at=?, summary='clean'
            WHERE id=?
            """,
            (old_ts, old_ts, job["job_id"]),
        )
        conn.execute(
            "UPDATE scan_artifacts SET created_at=? WHERE job_id=?",
            (old_ts, job["job_id"]),
        )
        conn.commit()

    result = store.cleanup_retention(retention_days=1)

    assert result == {"artifact_rows": 0, "artifact_files": 0}
    assert artifact_path.exists()
    with store._lock, store._connect() as conn:
        remaining_artifacts = conn.execute("SELECT COUNT(*) AS cnt FROM scan_artifacts").fetchone()["cnt"]
        remaining_tasks = conn.execute("SELECT COUNT(*) AS cnt FROM scan_tasks").fetchone()["cnt"]
        remaining_jobs = conn.execute("SELECT COUNT(*) AS cnt FROM scan_jobs").fetchone()["cnt"]
    assert remaining_artifacts == 1
    assert remaining_tasks == 0
    assert remaining_jobs == 0


def test_reconcile_job_pdf_spool_fails_pending_pdf_jobs_without_payload(temp_dir):
    store = _make_store(temp_dir)
    task = store.create_task(agent_id="agent-1", command="scan_now", dedupe_key="scan_now:agent-1")
    store.report_task_result(
        agent_id="agent-1",
        task_id=task["id"],
        status="acknowledged",
        result={
            "phase": "server_processing",
            "jobs_total": 1,
            "jobs_pending": 1,
            "jobs_done_clean": 0,
            "jobs_done_with_incident": 0,
            "jobs_failed": 0,
        },
        error_text="",
    )
    queued = store.queue_job(
        {
            "agent_id": "agent-1",
            "hostname": "HOST-01",
            "branch": "РўСЋРјРµРЅСЊ",
            "file_path": r"C:\Docs\missing.pdf",
            "file_name": "missing.pdf",
            "file_hash": "hash-missing",
            "file_size": 2048,
            "source_kind": "pdf_slice",
            "event_id": "missing-spool",
            "scan_task_id": task["id"],
            "pdf_slice_b64": _pdf_b64(),
        }
    )
    store.delete_job_pdf_spool(job_id=queued["job_id"])

    result = store.reconcile_job_pdf_spool()

    job_row = _get_job(store, queued["job_id"])
    task_row = _get_task(store, task["id"])
    task_result = json.loads(task_row["result_json"])
    assert result["failed_jobs"] == 1
    assert job_row["status"] == "failed"
    assert job_row["error_text"] == "Missing transient PDF payload"
    assert task_row["status"] == "failed"
    assert task_result["jobs_failed"] == 1


def test_scrub_scan_job_pdf_payloads_removes_legacy_pdf_from_sqlite_payloads(temp_dir):
    store = _make_store(temp_dir)
    queued = store.queue_job(
        {
            "agent_id": "agent-1",
            "hostname": "HOST-01",
            "branch": "РўСЋРјРµРЅСЊ",
            "file_path": r"C:\Docs\legacy.pdf",
            "file_name": "legacy.pdf",
            "file_hash": "hash-legacy",
            "file_size": 2048,
            "source_kind": "pdf_slice",
            "event_id": "legacy-payload",
            "pdf_slice_b64": _pdf_b64(),
        }
    )

    with store._lock, store._connect() as conn:
        conn.execute(
            "UPDATE scan_jobs SET payload_json=? WHERE id=?",
            (json.dumps({"pdf_slice_b64": "legacy-data", "file_name": "legacy.pdf"}, ensure_ascii=False), queued["job_id"]),
        )
        conn.commit()

    result = scrub_scan_job_pdf_payloads(db_path=store.db_path, batch_size=10)

    job_row = _get_job(store, queued["job_id"])
    payload = json.loads(job_row["payload_json"])
    assert result["updated_rows"] == 1
    assert "pdf_slice_b64" not in payload


def test_list_agents_table_uses_sql_branch_fallback_when_heartbeat_branch_is_empty(monkeypatch, temp_dir):
    store = _make_store(temp_dir)
    now_ts = int(time.time())

    monkeypatch.setattr(
        scan_database,
        "_resolve_agent_sql_context",
        lambda mac_address, hostname: {"branch_name": "Тюмень"} if str(hostname) == "TMN-IT-0004" else None,
    )

    store.upsert_agent_heartbeat(
        {
            "agent_id": "tmn-it-0004",
            "hostname": "TMN-IT-0004",
            "branch": "",
            "ip_address": "10.105.0.233",
            "version": "1.2.3",
            "status": "online",
            "last_seen_at": now_ts,
            "metadata": {"mac_address": "9C:2F:9D:B2:6A:E0"},
        }
    )

    response = store.list_agents_table(branch="тюм", limit=10, offset=0)

    assert response["total"] == 1
    assert response["items"][0]["agent_id"] == "tmn-it-0004"
    assert response["items"][0]["branch"] == "Тюмень"


def test_list_agents_table_infers_branch_from_agent_prefix_before_sql_lookup(monkeypatch, temp_dir):
    store = _make_store(temp_dir)
    now_ts = int(time.time())

    monkeypatch.setattr(
        scan_database,
        "_resolve_agent_sql_context",
        lambda mac_address, hostname: (_ for _ in ()).throw(AssertionError("SQL fallback should not run for known prefixes")),
    )

    store.upsert_agent_heartbeat(
        {
            "agent_id": "tmn-it-0004",
            "hostname": "TMN-IT-0004",
            "branch": "",
            "ip_address": "10.105.0.233",
            "version": "1.2.3",
            "status": "online",
            "last_seen_at": now_ts,
        }
    )

    response = store.list_agents_table(limit=10, offset=0)

    assert response["total"] == 1
    assert response["items"][0]["branch"] == "Тюмень"


def test_list_branches_returns_unique_sorted_values(temp_dir):
    store = _make_store(temp_dir)
    now_ts = int(time.time())

    store.upsert_agent_heartbeat(
        {
            "agent_id": "tmn-it-0004",
            "hostname": "TMN-IT-0004",
            "branch": "",
            "ip_address": "10.105.0.233",
            "version": "1.2.3",
            "status": "online",
            "last_seen_at": now_ts,
        }
    )
    store.upsert_agent_heartbeat(
        {
            "agent_id": "spb-it-0001",
            "hostname": "SPB-IT-0001",
            "branch": "Санкт-Петербург",
            "ip_address": "10.105.0.234",
            "version": "1.2.3",
            "status": "online",
            "last_seen_at": now_ts,
        }
    )
    _seed_incident(
        store,
        agent_id="agent-2",
        hostname="HOST-02",
        branch="Москва",
        user_login="corp\\ivanov",
        user_full_name="Иванов И.И.",
        file_path=r"C:\Docs\other.pdf",
        file_name="other.pdf",
        source_kind="pdf",
        severity="medium",
        status="new",
        created_at=now_ts - 90,
    )

    assert store.list_branches() == ["Москва", "Санкт-Петербург", "Тюмень"]
