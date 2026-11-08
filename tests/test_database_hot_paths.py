from datetime import datetime, timedelta, timezone

import pytest
from sqlalchemy import event

from backend.appdb.db import app_session, get_app_engine
from backend.appdb.models import AppMyFile, AppMyFilePreview
from backend.services.my_files_service import MyFilesService
from scan_server.database import ScanStore


@pytest.mark.parametrize('kind', ['ready_pdf', 'unsupported'])
def test_idle_preview_poll_has_bounded_query_count(tmp_path, kind):
    url = f"sqlite:///{(tmp_path / 'preview.db').as_posix()}"
    service = MyFilesService(database_url=url, storage_root=tmp_path / 'files')
    service._database_url_or_raise()
    now = datetime.now(timezone.utc)
    with app_session(url) as session:
        for i in range(100):
            name = 'report.pdf' if kind == 'ready_pdf' else 'archive.bin'
            mime = 'application/pdf' if kind == 'ready_pdf' else 'application/octet-stream'
            session.add(AppMyFile(
                id=f'file-{i}', blob_id=f'blob-{i}', owner_user_id=7,
                status='ready', original_file_name=name, download_file_name=name,
                mime_type=mime, download_mime_type=mime, original_size_bytes=10,
                security_scan_status='clean', expires_at=now + timedelta(days=1),
            ))
            if kind == 'ready_pdf':
                session.add(AppMyFilePreview(blob_id=f'blob-{i}', status='ready'))
    queries = []
    engine = get_app_engine(url)
    def record(_conn, _cursor, statement, _params, _context, _many):
        if statement.lstrip().upper().startswith('SELECT'):
            queries.append(statement)
    event.listen(engine, 'before_cursor_execute', record)
    try:
        assert service.process_next_preview_job() is False
    finally:
        event.remove(engine, 'before_cursor_execute', record)
    print(f'{kind}: SELECT count={len(queries)}')
    assert len(queries) <= 3


def test_scan_backpressure_matches_full_counts_and_uses_only_pending_rows(tmp_path, monkeypatch):
    store = ScanStore(db_path=tmp_path / 'scan.db', archive_dir=tmp_path / 'archive',
                      task_ack_timeout_sec=300, agent_online_timeout_sec=1800)
    with store._connect() as conn:
        for status in ('queued', 'processing', 'done_clean', 'failed'):
            for source in ('pdf', 'pdf_slice', 'image', 'office', 'text', 'unknown'):
                conn.execute(
                    'INSERT INTO scan_jobs(id,status,source_kind,created_at) VALUES(?,?,?,?)',
                    (f'{status}-{source}', status, source, 1),
                )
        conn.commit()
    old_pdf = store.pdf_job_status_counts()
    old_total = store.job_status_counts()
    kwargs = dict(max_pending_pdf_jobs=5, transient_max_gb=10, max_pending_jobs=10, spool={'gb': 0})
    expected = store.ingest_backpressure_status(
        **kwargs, pdf_queued=old_pdf['pdf_queued'], pdf_processing=old_pdf['pdf_processing'],
        total_pending=old_total['pending'],
    )
    assert store.ingest_backpressure_status(**kwargs) == expected
    assert expected['total_pending'] == 12
    assert store.pending_job_status_counts() == {
        'pdf_queued': 4, 'pdf_processing': 4, 'pdf_pending': 8, 'pending': 12,
    }
    with store._connect() as conn:
        conn.execute("UPDATE scan_jobs SET status='done_clean' WHERE status='queued'")
        conn.commit()
    assert store.pending_job_status_counts()['pending'] == 12  # existing TTL contract
    monkeypatch.setattr(store, '_counts_cache_ttl_sec', -1)
    assert store.pending_job_status_counts()['pending'] == 6
    monkeypatch.setattr(store, 'pending_job_status_counts', lambda: pytest.fail('unnecessary query'))
    assert store.ingest_backpressure_status(
        **kwargs, pdf_queued=4, pdf_processing=4, total_pending=12,
    ) == expected


def test_backfill_does_not_rewrite_preview_already_queued_by_another_worker(tmp_path, monkeypatch):
    # With SKIP LOCKED the claim query misses a queued row that another worker is
    # claiming; the backfill pass must then leave it alone instead of updating (and
    # blocking on) the same row from every worker thread. SQLite has no row locks, so
    # the claim query is made to miss the queued row by rewriting its status filter.
    url = f"sqlite:///{(tmp_path / 'queued.db').as_posix()}"
    service = MyFilesService(database_url=url, storage_root=tmp_path / 'files')
    service._database_url_or_raise()
    now = datetime.now(timezone.utc)
    old = now - timedelta(hours=1)
    with app_session(url) as session:
        session.add(AppMyFile(
            id='file-0', blob_id='blob-0', owner_user_id=7, status='ready',
            original_file_name='report.pdf', download_file_name='report.pdf',
            mime_type='application/pdf', download_mime_type='application/pdf',
            original_size_bytes=10, security_scan_status='clean',
            created_at=now, expires_at=now + timedelta(days=1),
        ))
        session.add(AppMyFilePreview(blob_id='blob-0', status='queued', updated_at=old))
    processed = []
    monkeypatch.setattr(service, 'process_preview_blob', processed.append)
    updates = []
    engine = get_app_engine(url)

    def hide_queued_from_claim(_conn, _cursor, statement, params, _context, _many):
        text = statement.lstrip().upper()
        if text.startswith('UPDATE') and 'MY_FILE_PREVIEWS' in text:
            updates.append(statement)
        if text.startswith('SELECT') and 'MY_FILE_PREVIEWS' in text and tuple(params) == ('queued',):
            params = tuple('not-queued' if p == 'queued' else p for p in params)
        return statement, params

    event.listen(engine, 'before_cursor_execute', hide_queued_from_claim, retval=True)
    try:
        assert service.process_next_preview_job() is False
    finally:
        event.remove(engine, 'before_cursor_execute', hide_queued_from_claim)
    assert updates == []
    assert processed == []
    with app_session(url) as session:
        preview = session.get(AppMyFilePreview, 'blob-0')
        assert preview.status == 'queued'
        assert preview.updated_at.replace(tzinfo=None) == old.replace(tzinfo=None)


def test_preview_backfill_still_queues_missing_supported_file(tmp_path, monkeypatch):
    url = f"sqlite:///{(tmp_path / 'backfill.db').as_posix()}"
    service = MyFilesService(database_url=url, storage_root=tmp_path / 'files')
    service._database_url_or_raise()
    now = datetime.now(timezone.utc)
    with app_session(url) as session:
        for i, (name, mime, security) in enumerate([
            ('archive.bin', 'application/octet-stream', 'clean'),
            ('blocked.pdf', 'application/pdf', 'infected'),
            ('report.pdf', 'application/pdf', 'clean'),
        ]):
            session.add(AppMyFile(
                id=f'file-{i}', blob_id=f'blob-{i}', owner_user_id=7, status='ready',
                original_file_name=name, download_file_name=name, mime_type=mime,
                download_mime_type=mime, original_size_bytes=10, security_scan_status=security,
                created_at=now + timedelta(seconds=i), expires_at=now + timedelta(days=1),
            ))
    processed = []
    monkeypatch.setattr(service, 'process_preview_blob', processed.append)
    # app_session disables autoflush: backfill is committed by the first idle
    # cycle and claimed by the next cycle, as before this optimization.
    assert service.process_next_preview_job() is False
    assert service.process_next_preview_job() is True
    assert processed == ['blob-2']
    with app_session(url) as session:
        previews = session.query(AppMyFilePreview).all()
        assert [(p.blob_id, p.status) for p in previews] == [('blob-2', 'processing')]
