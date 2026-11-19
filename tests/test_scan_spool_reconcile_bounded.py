from __future__ import annotations

import multiprocessing
from pathlib import Path

from scan_server.database import ScanStore


def _store(root: Path) -> ScanStore:
    return ScanStore(
        db_path=root / "scan.db", archive_dir=root / "archive", task_ack_timeout_sec=60
    )


def _hold_reconcile(root, entered, release):
    store = _store(Path(root))
    original = store._pdf_spool.list_pdf_paths

    def hold():
        entered.set()
        if not release.wait(20):
            raise TimeoutError("Reconcile test did not release its child")
        return original()

    store._pdf_spool.list_pdf_paths = hold
    store.reconcile_job_pdf_spool()


def test_completed_history_does_not_increase_reconcile_database_work(tmp_path, monkeypatch):
    store = _store(tmp_path)
    with store._connect() as conn:
        conn.execute(
            "INSERT INTO scan_jobs(id,status,source_kind,created_at) VALUES (?,?,?,?)",
            ("live", "queued", "pdf_slice", 1),
        )
        conn.commit()
    store.write_job_pdf_spool(job_id="live", pdf_bytes=b"%PDF-live")
    original = store._connect
    steps = 0

    def tick():
        nonlocal steps
        steps += 100
        return 0

    def measured_connect():
        conn = original()
        conn.set_progress_handler(tick, 100)
        return conn

    monkeypatch.setattr(store, "_connect", measured_connect)
    store.reconcile_job_pdf_spool()
    baseline = steps
    with original() as conn:
        conn.executemany(
            "INSERT INTO scan_jobs(id,status,source_kind,created_at) VALUES (?,?,?,?)",
            [(f"history-{i:06}", "done_clean", "pdf_slice", 1) for i in range(6000)],
        )
        conn.commit()
    steps = 0
    store.reconcile_job_pdf_spool()
    assert steps <= baseline + 1000
    assert store._pdf_spool.path_for_job("live").read_bytes() == b"%PDF-live"
    with original() as conn:
        assert conn.execute("SELECT count(*) FROM scan_jobs").fetchone()[0] == 6001


def test_only_one_process_reconciles_a_shared_spool(tmp_path, monkeypatch):
    store = _store(tmp_path)
    path = store.write_job_pdf_spool(job_id="in-flight", pdf_bytes=b"%PDF-in-flight")
    ctx = multiprocessing.get_context("spawn")
    entered, release = ctx.Event(), ctx.Event()
    child = ctx.Process(target=_hold_reconcile, args=(str(tmp_path), entered, release))
    child.start()
    try:
        assert entered.wait(15)

        def unexpected_scan():
            raise AssertionError("Second process entered an already running reconcile")

        monkeypatch.setattr(store._pdf_spool, "list_pdf_paths", unexpected_scan)
        result = store.reconcile_job_pdf_spool()
        assert result["failed_jobs"] == 0
        assert path.read_bytes() == b"%PDF-in-flight"
    finally:
        release.set()
        child.join(20)
        if child.is_alive():
            child.terminate()
            child.join(5)
    assert child.exitcode == 0
    # The lock must be released after a successful run.
    monkeypatch.undo()
    assert store.reconcile_job_pdf_spool()["removed_orphan_files"] == 0


def test_reconcile_does_not_overwrite_a_concurrently_completed_job(tmp_path, monkeypatch):
    store = _store(tmp_path)
    with store._connect() as conn:
        conn.execute(
            "INSERT INTO scan_jobs(id,status,source_kind,created_at) VALUES (?,?,?,?)",
            ("finished-during-reconcile", "queued", "pdf_slice", 1),
        )
        conn.commit()

    class CompletingPath:
        def exists(self):
            with store._connect() as conn:
                conn.execute("UPDATE scan_jobs SET status='done_clean'")
                conn.commit()
            return False

    monkeypatch.setattr(store._pdf_spool, "path_for_job", lambda _: CompletingPath())
    assert store.reconcile_job_pdf_spool()["failed_jobs"] == 0
    with store._connect() as conn:
        assert conn.execute("SELECT status FROM scan_jobs").fetchone()[0] == "done_clean"


def test_reconcile_handles_multiple_pages_without_removing_live_payloads(tmp_path):
    store = _store(tmp_path)
    with store._connect() as conn:
        conn.executemany(
            "INSERT INTO scan_jobs(id,status,source_kind,created_at) VALUES (?,?,?,?)",
            [(f"missing-{i:04}", "queued", "pdf_slice", 1) for i in range(405)]
            + [(f"finished-{i:04}", "done_clean", "pdf_slice", 1) for i in range(405)]
            + [("keep-processing", "processing", "pdf_slice", 1)],
        )
        conn.commit()
    for i in range(405):
        store.write_job_pdf_spool(job_id=f"finished-{i:04}", pdf_bytes=b"%PDF-finished")
    kept = store.write_job_pdf_spool(job_id="keep-processing", pdf_bytes=b"%PDF-live")
    fresh = store.write_job_pdf_spool(job_id="not-committed-yet", pdf_bytes=b"%PDF-fresh")
    result = store.reconcile_job_pdf_spool()
    assert result["removed_final_files"] == 405
    assert result["failed_jobs"] == 405
    assert kept.read_bytes() == b"%PDF-live"
    assert fresh.read_bytes() == b"%PDF-fresh"
    with store._connect() as conn:
        assert conn.execute("SELECT count(*) FROM scan_jobs").fetchone()[0] == 811
        assert conn.execute(
            "SELECT count(*) FROM scan_jobs WHERE status='analysis_incomplete'"
        ).fetchone()[0] == 405
    again = store.reconcile_job_pdf_spool()
    assert again["failed_jobs"] == again["removed_final_files"] == 0


def test_reconcile_releases_guard_after_failure(tmp_path, monkeypatch):
    store = _store(tmp_path)

    def fail():
        raise OSError("isolated spool failure")

    monkeypatch.setattr(store._pdf_spool, "list_pdf_paths", fail)
    try:
        store.reconcile_job_pdf_spool()
    except OSError:
        pass
    else:
        raise AssertionError("Spool failure was hidden")
    monkeypatch.undo()
    with store._pdf_spool.reconciliation_guard() as acquired:
        assert acquired
