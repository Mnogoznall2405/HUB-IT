from __future__ import annotations

from pathlib import Path

from scan_server.database import ScanStore
from scripts.backfill_scan_task_links import backfill_scan_task_links, backup_database
from scripts.repair_scan_task_observations import repair_false_finding_observations


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
        return dict(conn.execute("SELECT * FROM scan_jobs WHERE id=?", (job_id,)).fetchone())


def _seed_unlinked_late_job(store: ScanStore) -> tuple[dict, str, str]:
    task = store.create_task(agent_id="agent-1", command="scan_now", dedupe_key="scan:agent-1")
    queued = store.queue_job(
        {
            "agent_id": "agent-1",
            "hostname": "HOST-01",
            "branch": "Тюмень",
            "file_path": r"C:\Docs\late.pdf",
            "file_name": "late.pdf",
            "file_hash": "hash-late",
            "file_size": 2048,
            "source_kind": "pdf_slice",
            "event_id": "late-event",
            "scan_task_id": task["id"],
        }
    )
    incident = store.create_finding_and_incident(
        job=_get_job(store, queued["job_id"]),
        severity="high",
        category="secrets",
        matched_patterns=[{"pattern_name": "password", "value": "secret"}],
        short_reason="pattern match",
    )
    store.finalize_job(job_id=queued["job_id"], status="done_with_incident", summary="incident")
    store.report_task_result(
        agent_id="agent-1",
        task_id=task["id"],
        status="completed",
        result={"phase": "completed"},
        error_text="",
    )
    with store._lock, store._connect() as conn:
        conn.execute("UPDATE scan_jobs SET scan_task_id='' WHERE id=?", (queued["job_id"],))
        conn.execute("DELETE FROM scan_task_file_observations WHERE linked_job_id=?", (queued["job_id"],))
        conn.commit()
    return task, queued["job_id"], incident["incident_id"]


def test_backfill_scan_task_links_dry_run_does_not_modify_database(temp_dir):
    store = _make_store(temp_dir)
    task, job_id, _ = _seed_unlinked_late_job(store)

    result = backfill_scan_task_links(store.db_path, apply=False)

    assert result["mode"] == "dry-run"
    assert result["jobs_matched"] == 1
    assert result["jobs_updated"] == 0
    assert _get_job(store, job_id)["scan_task_id"] == ""
    assert store.list_task_observations(task_id=task["id"])["total"] == 0


def test_backfill_scan_task_links_apply_creates_backup_link_and_observation(temp_dir):
    store = _make_store(temp_dir)
    task, job_id, incident_id = _seed_unlinked_late_job(store)

    result = backfill_scan_task_links(store.db_path, apply=True)
    observations = store.list_task_observations(task_id=task["id"])

    assert result["jobs_updated"] == 1
    assert result["observations_created"] == 1
    assert Path(result["backup_path"]).exists()
    assert _get_job(store, job_id)["scan_task_id"] == task["id"]
    assert observations["total"] == 1
    assert observations["items"][0]["linked_job_id"] == job_id
    assert observations["items"][0]["linked_incident_id"] == incident_id
    assert observations["items"][0]["severity"] == "high"

    second_result = backfill_scan_task_links(store.db_path, apply=True, create_backup=False)
    assert second_result["jobs_matched"] == 0
    assert second_result["jobs_updated"] == 0
    assert store.list_task_observations(task_id=task["id"])["total"] == 1


def test_backfill_prefers_task_active_at_job_time_over_newer_finished_task(temp_dir):
    store = _make_store(temp_dir)
    with store._lock, store._connect() as conn:
        task_values = (
            "scan_now",
            "{}",
            "completed",
            999999,
            999999,
            0,
            None,
            None,
            "{}",
        )
        conn.execute(
            """
            INSERT INTO scan_tasks(
                id, agent_id, command, payload_json, status, created_at, updated_at,
                due_at, ttl_at, delivered_at, acked_at, completed_at, attempt_count,
                next_attempt_at, dedupe_key, error_text, result_json
            ) VALUES ('task-long', 'agent-1', ?, ?, ?, 100, 500, ?, ?, NULL, NULL, 500, 0, ?, ?, ?, ?)
            """,
            task_values,
        )
        conn.execute(
            """
            INSERT INTO scan_tasks(
                id, agent_id, command, payload_json, status, created_at, updated_at,
                due_at, ttl_at, delivered_at, acked_at, completed_at, attempt_count,
                next_attempt_at, dedupe_key, error_text, result_json
            ) VALUES ('task-short', 'agent-1', ?, ?, ?, 200, 300, ?, ?, NULL, NULL, 300, 0, ?, ?, ?, ?)
            """,
            task_values,
        )
        conn.execute(
            """
            INSERT INTO scan_jobs(
                id, agent_id, hostname, file_path, file_name, file_hash, source_kind,
                scan_task_id, status, created_at, payload_json
            ) VALUES ('job-1', 'agent-1', 'HOST-01', 'C:\\Docs\\one.txt', 'one.txt',
                      'hash-one', 'text', '', 'done_clean', 400, '{}')
            """
        )
        conn.commit()

    result = backfill_scan_task_links(store.db_path, apply=True, create_backup=False)

    assert result["jobs_updated"] == 1
    assert _get_job(store, "job-1")["scan_task_id"] == "task-long"


def test_repair_removes_only_final_jobs_without_incidents(temp_dir):
    store = _make_store(temp_dir)
    task = store.create_task(agent_id="agent-1", command="scan_now", dedupe_key="repair:agent-1")
    queued = store.queue_job(
        {
            "agent_id": "agent-1",
            "hostname": "HOST-01",
            "file_path": r"C:\Docs\clean.txt",
            "file_name": "clean.txt",
            "file_hash": "clean-hash",
            "source_kind": "text",
            "event_id": "clean-event",
            "scan_task_id": task["id"],
        }
    )
    clean_job_id = queued["job_id"]
    store.finalize_job(job_id=clean_job_id, status="done_clean", summary="clean")
    with store._lock, store._connect() as conn:
        conn.execute(
            """
            INSERT INTO scan_task_file_observations(
                id, scan_task_id, agent_id, hostname, file_path, file_hash, event_id,
                observation_type, linked_job_id, linked_incident_id, source_kind, severity, created_at
            ) VALUES ('false-observation', ?, 'agent-1', 'HOST-01', 'C:\\Docs\\clean.txt',
                      'clean-hash', 'clean-event', 'found_new', ?, '', 'text', '', 100)
            """,
            (task["id"], clean_job_id),
        )
        conn.commit()

    dry_run = repair_false_finding_observations(store.db_path)
    assert dry_run["matched"] == 1
    assert store.list_task_observations(task_id=task["id"])["total"] == 1

    applied = repair_false_finding_observations(store.db_path, apply=True, create_backup=False)
    assert applied["removed"] == 1
    assert store.list_task_observations(task_id=task["id"])["total"] == 0


def test_repair_replaces_dangling_observation_and_restores_incident_link(temp_dir):
    store = _make_store(temp_dir)
    task, job_id, incident_id = _seed_unlinked_late_job(store)
    backfill_scan_task_links(store.db_path, apply=True, create_backup=False)
    with store._lock, store._connect() as conn:
        conn.execute("DELETE FROM scan_task_file_observations WHERE linked_job_id=?", (job_id,))
        conn.execute(
            """
            INSERT INTO scan_task_file_observations(
                id, scan_task_id, agent_id, hostname, file_path, file_hash, event_id,
                observation_type, linked_job_id, linked_incident_id, source_kind, severity, created_at
            ) VALUES ('dangling-observation', ?, 'agent-1', 'HOST-01', 'C:\\Docs\\late.pdf',
                      'hash-late', 'late-event', 'found_duplicate', ?, 'missing-incident',
                      'pdf_slice', 'high', 100)
            """,
            (task["id"], job_id),
        )
        conn.commit()

    dry_run = repair_false_finding_observations(store.db_path)
    assert dry_run["dangling_observations"] == 1
    assert dry_run["missing_observations"] == 1

    applied = repair_false_finding_observations(store.db_path, apply=True, create_backup=False)
    observations = store.list_task_observations(task_id=task["id"])
    assert applied["removed"] == 1
    assert applied["observations_created"] == 1
    assert observations["total"] == 1
    assert observations["items"][0]["linked_incident_id"] == incident_id


def test_repair_restores_incident_job_from_backup(temp_dir):
    store = _make_store(temp_dir)
    _, job_id, _ = _seed_unlinked_late_job(store)
    source_backup = backup_database(store.db_path)
    with store._lock, store._connect() as conn:
        conn.execute("DELETE FROM scan_jobs WHERE id=?", (job_id,))
        conn.commit()

    applied = repair_false_finding_observations(
        store.db_path,
        apply=True,
        create_backup=False,
        source_backup=source_backup,
    )

    assert applied["restored_jobs"] == 1
    assert applied["reconstructed_jobs"] == 0
    assert _get_job(store, job_id)["id"] == job_id


def test_repair_reconstructs_orphan_incident_job_without_backup(temp_dir):
    store = _make_store(temp_dir)
    _, job_id, _ = _seed_unlinked_late_job(store)
    with store._lock, store._connect() as conn:
        conn.execute("DELETE FROM scan_jobs WHERE id=?", (job_id,))
        conn.commit()

    applied = repair_false_finding_observations(
        store.db_path,
        apply=True,
        create_backup=False,
    )
    restored = _get_job(store, job_id)

    assert applied["reconstructed_jobs"] == 1
    assert restored["status"] == "done_with_incident"
    assert restored["summary"] == "Восстановлено из записи инцидента"
