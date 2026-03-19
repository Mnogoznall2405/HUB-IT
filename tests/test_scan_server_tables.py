from __future__ import annotations

import time
from pathlib import Path

import scan_server.database as scan_database
from scan_server.database import ScanStore


def _make_store(temp_dir: str) -> ScanStore:
    root = Path(temp_dir)
    return ScanStore(
        db_path=root / "scan-server.db",
        archive_dir=root / "archive",
        task_ack_timeout_sec=300,
    )


def _get_job(store: ScanStore, job_id: str) -> dict:
    with store._lock, store._connect() as conn:
        row = conn.execute("SELECT * FROM scan_jobs WHERE id=?", (job_id,)).fetchone()
    return dict(row)


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
