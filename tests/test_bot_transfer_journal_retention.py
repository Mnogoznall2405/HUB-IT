"""Retention of the bot transfer journal: opt-in, dry-run first, only old terminal operations."""
from __future__ import annotations

from datetime import datetime, timedelta, timezone

import pytest

from bot import local_json_store
from bot.services import transfer_operation_store as store_module
from local_store import SQLiteLocalStore

NOW = datetime(2026, 11, 4, tzinfo=timezone.utc)


@pytest.fixture
def journal(tmp_path, monkeypatch):
    local = SQLiteLocalStore(data_dir=tmp_path, db_path=tmp_path / "local.db")
    # The journal helpers use the module-level store: point it at a temp DB, never the live one.
    monkeypatch.setattr(local_json_store, "_store", local)
    store = store_module.BotTransferOperationStore()

    def put(operation_id, *, status, age_days):
        record = {
            "operation_id": operation_id,
            "status": status,
            "updated_at": (NOW - timedelta(days=age_days)).isoformat(),
        }
        assert local_json_store.save_json_entry(store.journal_file, operation_id, record)

    return store, put


def _ids(store):
    return {key for key in (local_json_store.load_json_data(store.journal_file, {}) or {})}


def test_retention_is_off_by_default_and_starts_as_dry_run(monkeypatch):
    for name in ("ENABLED", "DRY_RUN", "DAYS", "BATCH"):
        monkeypatch.delenv(f"TRANSFER_OPERATIONS_RETENTION_{name}", raising=False)
    settings = store_module.retention_settings()
    assert settings["enabled"] is False and settings["dry_run"] is True


def test_purge_removes_only_old_completed_operations_in_bounded_batches(journal):
    store, put = journal
    put("old-done-1", status="completed", age_days=400)
    put("old-done-2", status="completed", age_days=500)
    put("old-done-3", status="completed", age_days=450)
    put("recent-done", status="completed", age_days=10)
    put("old-stuck", status="delivery_pending", age_days=900)  # a restart may still recover it

    preview = store.purge_completed_operations(retention_days=365, dry_run=True, now=NOW)
    assert preview["candidates"] == 3 and preview["deleted"] == 0
    assert _ids(store) == {"old-done-1", "old-done-2", "old-done-3", "recent-done", "old-stuck"}

    result = store.purge_completed_operations(retention_days=365, dry_run=False, batch_size=2, now=NOW)
    assert result["deleted"] == 3 and result["batches"] == 2
    assert _ids(store) == {"recent-done", "old-stuck"}
    # Re-running is safe.
    assert store.purge_completed_operations(retention_days=365, dry_run=False, now=NOW)["deleted"] == 0


def test_second_purge_run_is_refused_while_one_is_in_progress(journal):
    store, _ = journal
    assert store._purge_lock.acquire(blocking=False)
    try:
        assert store.purge_completed_operations(retention_days=365, dry_run=False, now=NOW)["status"] == "busy"
    finally:
        store._purge_lock.release()
