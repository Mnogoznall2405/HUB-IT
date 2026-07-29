from __future__ import annotations

import pytest

from scan_server.pg_compat import NullLock, qmark_to_named


def test_qmark_to_named_binds_in_order():
    sql, params = qmark_to_named("SELECT * FROM t WHERE a=? AND b=?", (1, "x"))
    assert ":p0" in sql and ":p1" in sql
    assert "?" not in sql
    assert params == {"p0": 1, "p1": "x"}


def test_qmark_to_named_rejects_mismatch():
    with pytest.raises(ValueError):
        qmark_to_named("SELECT ?", (1, 2))


def test_null_lock_context():
    lock = NullLock()
    with lock:
        assert lock.acquire() is True
        lock.release()


@pytest.mark.skipif(
    not __import__("os").getenv("SCAN_DATABASE_URL"),
    reason="SCAN_DATABASE_URL not configured",
)
def test_postgres_atomic_finding_finalize(tmp_path):
    import os
    import time
    import uuid

    from scan_server.database import ScanStore

    store = ScanStore(
        db_path=tmp_path / "unused.db",
        archive_dir=tmp_path / "archive",
        task_ack_timeout_sec=300,
        database_url=os.environ["SCAN_DATABASE_URL"],
    )
    job_id = uuid.uuid4().hex
    now = int(time.time())
    with store._connect() as conn:
        conn.execute(
            """
            INSERT INTO scan_jobs(
                id, agent_id, hostname, status, created_at, payload_json, metrics_json, file_path
            ) VALUES (?, ?, ?, 'processing', ?, '{}', '{}', ?)
            """,
            (job_id, "pg-atomic-agent", "PG-ATOMIC", now, f"/tmp/{job_id}.pdf"),
        )
        conn.commit()
    try:
        result = store.create_finding_and_incident(
            job={
                "id": job_id,
                "agent_id": "pg-atomic-agent",
                "hostname": "PG-ATOMIC",
                "branch": "",
                "user_login": "",
                "user_full_name": "",
                "file_path": f"/tmp/{job_id}.pdf",
                "file_hash": "",
                "event_id": "",
                "scan_task_id": "",
                "source_kind": "pdf",
            },
            severity="high",
            category="policy_match",
            matched_patterns=[{"pattern": "dsp_exact", "snippet": "ДСП"}],
            short_reason="dsp_exact",
            finalize_status="done_with_incident",
            finalize_summary="atomic finalize test",
        )
        assert result["finding_id"]
        assert result["incident_id"]
        with store._connect() as conn:
            job = conn.execute("SELECT status, summary FROM scan_jobs WHERE id=?", (job_id,)).fetchone()
            finding = conn.execute("SELECT id FROM scan_findings WHERE job_id=?", (job_id,)).fetchone()
            incident = conn.execute("SELECT id, status FROM scan_incidents WHERE job_id=?", (job_id,)).fetchone()
        assert job["status"] == "done_with_incident"
        assert finding is not None
        assert incident is not None
        assert incident["status"] == "new"
    finally:
        with store._connect() as conn:
            conn.execute("DELETE FROM scan_incidents WHERE job_id=?", (job_id,))
            conn.execute("DELETE FROM scan_findings WHERE job_id=?", (job_id,))
            conn.execute("DELETE FROM scan_jobs WHERE id=?", (job_id,))
            conn.commit()


@pytest.mark.skipif(
    not __import__("os").getenv("SCAN_DATABASE_URL"),
    reason="SCAN_DATABASE_URL not configured",
)
def test_postgres_claim_skip_locked_roundtrip(tmp_path):
    import os
    import time
    import uuid

    from scan_server.database import ScanStore

    store = ScanStore(
        db_path=tmp_path / "unused.db",
        archive_dir=tmp_path / "archive",
        task_ack_timeout_sec=300,
        database_url=os.environ["SCAN_DATABASE_URL"],
    )
    assert store.is_postgres
    job_id = uuid.uuid4().hex
    now = int(time.time())
    with store._connect() as conn:
        conn.execute(
            """
            INSERT INTO scan_jobs(
                id, agent_id, hostname, status, created_at, payload_json, metrics_json
            ) VALUES (?, ?, ?, 'queued', ?, '{}', '{}')
            """,
            (job_id, "pg-test-agent", "PG-TEST", now),
        )
        conn.commit()
    try:
        claimed = store.claim_next_jobs(10)
        ids = {item["id"] for item in claimed}
        assert job_id in ids
        again = store.claim_next_jobs(10)
        assert job_id not in {item["id"] for item in again}
    finally:
        with store._connect() as conn:
            conn.execute("DELETE FROM scan_jobs WHERE id=?", (job_id,))
            conn.commit()
