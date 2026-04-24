import shutil
import uuid
from pathlib import Path

from scan_server.database import ScanStore


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
        assert result["items"][0]["branch"] == "Тюмень"
    finally:
        shutil.rmtree(tmp_root, ignore_errors=True)
