import shutil
import uuid
from pathlib import Path

from scan_server.database import ScanStore
from scan_server.scan_agent_read_store import BRANCH_SOURCE_JOB, BRANCH_SOURCE_UNKNOWN


def test_list_agents_table_skips_external_context_lookup_by_default(monkeypatch):
    tmp_root = Path(__file__).resolve().parent.parent / "test_tmp_scan" / uuid.uuid4().hex
    tmp_root.mkdir(parents=True, exist_ok=True)
    db_path = tmp_root / "scan_server.db"
    archive_dir = tmp_root / "archive"
    store = ScanStore(
        db_path=db_path,
        archive_dir=archive_dir,
        task_ack_timeout_sec=300,
        agent_online_timeout_sec=1800,
    )

    def fail_lookup(*_args, **_kwargs):
        raise AssertionError("external SQL context lookup must stay disabled by default")

    monkeypatch.setattr("scan_server.database._resolve_agent_sql_context", fail_lookup)

    store.upsert_agent_heartbeat(
        {
            "agent_id": "tmn-it-0099",
            "hostname": "TMN-IT-0099",
            "ip_address": "10.0.0.99",
            "status": "online",
        }
    )

    try:
        result = store.list_agents_table(limit=10, offset=0)

        assert result["total"] == 1
        assert result["items"][0]["agent_id"] == "tmn-it-0099"
        # Hostname/prefix invent forbidden — unknown stays empty.
        assert result["items"][0]["branch"] == ""
        assert result["items"][0]["branch_source"] == BRANCH_SOURCE_UNKNOWN
    finally:
        shutil.rmtree(tmp_root, ignore_errors=True)


def test_list_agents_table_branch_prefers_bulk_jobs_over_hostname_prefix(monkeypatch):
    tmp_root = Path(__file__).resolve().parent.parent / "test_tmp_scan" / uuid.uuid4().hex
    tmp_root.mkdir(parents=True, exist_ok=True)
    db_path = tmp_root / "scan_server.db"
    archive_dir = tmp_root / "archive"
    store = ScanStore(
        db_path=db_path,
        archive_dir=archive_dir,
        task_ack_timeout_sec=300,
        agent_online_timeout_sec=1800,
    )
    monkeypatch.setattr(
        "scan_server.database._resolve_agent_sql_context",
        lambda *_args, **_kwargs: (_ for _ in ()).throw(AssertionError("sql context disabled")),
    )

    store.upsert_agent_heartbeat(
        {
            "agent_id": "tmn-it-0100",
            "hostname": "TMN-IT-0100",
            "ip_address": "10.0.0.100",
            "status": "online",
            "branch": "",
        }
    )
    # Job branch is truth; hostname prefix must not invent "Тюмень".
    store.queue_job(
        {
            "agent_id": "tmn-it-0100",
            "hostname": "TMN-IT-0100",
            "branch": "Москва",
            "file_path": r"C:\Docs\a.pdf",
            "file_name": "a.pdf",
            "file_hash": "hash-a",
            "source_kind": "pdf",
        }
    )

    try:
        result = store.list_agents_table(limit=10, offset=0)
        assert result["total"] == 1
        assert result["items"][0]["branch"] == "Москва"
        assert result["items"][0]["branch_source"] == BRANCH_SOURCE_JOB
    finally:
        shutil.rmtree(tmp_root, ignore_errors=True)


def test_list_agents_table_no_prefix_invent_when_job_absent(monkeypatch):
    tmp_root = Path(__file__).resolve().parent.parent / "test_tmp_scan" / uuid.uuid4().hex
    tmp_root.mkdir(parents=True, exist_ok=True)
    store = ScanStore(
        db_path=tmp_root / "scan_server.db",
        archive_dir=tmp_root / "archive",
        task_ack_timeout_sec=300,
        agent_online_timeout_sec=1800,
    )
    monkeypatch.setattr(
        "scan_server.database._resolve_agent_sql_context",
        lambda *_a, **_k: (_ for _ in ()).throw(AssertionError("sql context disabled")),
    )
    store.upsert_agent_heartbeat(
        {
            "agent_id": "msk-pc-0001",
            "hostname": "MSK-PC-0001",
            "ip_address": "10.0.0.1",
            "status": "online",
            "branch": "",
        }
    )
    try:
        item = store.list_agents_table(limit=5, offset=0)["items"][0]
        assert item["branch"] == ""
        assert item["branch_source"] == BRANCH_SOURCE_UNKNOWN
    finally:
        shutil.rmtree(tmp_root, ignore_errors=True)
