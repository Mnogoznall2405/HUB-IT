"""Resumable equipment photo upload over the real router and upload service.

Only the SQL Server boundary is replaced (equipment lookup and the FILES insert);
sessions, chunks, idempotency and completion run for real on a temp directory.
"""
from __future__ import annotations

import hashlib
import sys
import threading
from concurrent.futures import ThreadPoolExecutor
from pathlib import Path
from types import SimpleNamespace

import pytest
from fastapi import FastAPI
from fastapi.testclient import TestClient

PROJECT_ROOT = Path(__file__).resolve().parents[1]
WEB_ROOT = PROJECT_ROOT / "WEB-itinvent"
if str(WEB_ROOT) not in sys.path:
    sys.path.insert(0, str(WEB_ROOT))

from backend.api import deps  # noqa: E402
from backend.api.v1 import equipment  # noqa: E402
from backend.services import equipment_photo_upload_service as uploads  # noqa: E402

CHUNK = uploads.CHUNK_SIZE_BYTES
PHOTO = b"\xff\xd8\xff" + bytes(range(256)) * 2800  # ~700 KB -> 3 chunks
BASE = "/api/v1/equipment"


@pytest.fixture
def ctx(monkeypatch, tmp_path):
    monkeypatch.setenv("EQUIPMENT_PHOTO_UPLOAD_DIR", str(tmp_path / "uploads"))
    inserted = []
    stored = set()  # FILE_NO values that currently exist in FILES
    gate = SimpleNamespace(wait=None)

    def fake_insert(**kwargs):
        if gate.wait is not None:
            gate.wait.wait(5)
        inserted.append(kwargs)
        stored.add(100 + len(inserted))
        return {"file_no": 100 + len(inserted), "ci_type": 1, "item_id": kwargs["item_id"]}

    monkeypatch.setattr(equipment.equipment_photos, "resolve_equipment_ci_type", lambda *a, **k: 1)
    monkeypatch.setattr(equipment.equipment_photos, "insert_equipment_photo", fake_insert)
    monkeypatch.setattr(
        equipment.equipment_photos,
        "get_equipment_photo_meta",
        lambda item_id, file_no, *a, **k: {"created_at": None} if file_no in stored else None,
    )
    monkeypatch.setattr(equipment.equipment_photo_check_service, "record_upload", lambda **kwargs: None)

    async def no_ocr(**kwargs):
        return None

    monkeypatch.setattr(equipment.equipment_photo_ocr_service, "analyze_photo_safe", no_ocr)

    app = FastAPI()
    app.include_router(equipment.router, prefix=BASE)
    user = SimpleNamespace(id=15, username="mobile-user", role="admin", permissions=[], is_active=True)
    app.dependency_overrides[deps.get_current_active_user] = lambda: user
    app.dependency_overrides[equipment.get_request_scoped_database_id] = lambda: "main"
    client = TestClient(app, base_url="https://testserver")
    yield SimpleNamespace(client=client, app=app, inserted=inserted, stored=stored, gate=gate, user=user)
    client.close()


def open_session(ctx, client_id="photo-0001-aaaa", data=PHOTO, **extra):
    return ctx.client.post(
        f"{BASE}/7/photo-uploads",
        json={"client_id": client_id, "file_name": "IMG_1.jpg", "size": len(data), "mime_type": "image/jpeg", **extra},
    )


def put_chunk(ctx, upload_id, index, data=PHOTO):
    part = data[index * CHUNK:(index + 1) * CHUNK]
    return ctx.client.put(
        f"{BASE}/photo-uploads/{upload_id}/chunks/{index}",
        content=part,
        headers={"content-type": "application/octet-stream"},
    )


def test_dropped_connection_resumes_and_inserts_exactly_one_photo(ctx):
    created = open_session(ctx).json()
    upload_id = created["upload_id"]
    assert created["total_chunks"] == 3 and created["received"] == []

    assert put_chunk(ctx, upload_id, 0).json()["received"] == [0]
    assert put_chunk(ctx, upload_id, 2).json()["received"] == [0, 2]
    # Connection dropped before chunk 1: finishing now is refused and nothing is inserted.
    assert ctx.client.post(f"{BASE}/photo-uploads/{upload_id}/complete").status_code == 409
    assert ctx.inserted == []

    # The app restarts and opens the same upload again: the server remembers chunks 0 and 2.
    resumed = open_session(ctx).json()
    assert resumed["upload_id"] == upload_id and resumed["received"] == [0, 2]
    assert ctx.client.get(f"{BASE}/photo-uploads/{upload_id}").json()["received"] == [0, 2]

    put_chunk(ctx, upload_id, 1)
    done = ctx.client.post(f"{BASE}/photo-uploads/{upload_id}/complete")
    assert done.status_code == 200
    assert done.json() == {"file_no": 101, "item_id": 7, "file_name": "IMG_1.jpg"}
    assert ctx.inserted[0]["file_bytes"] == PHOTO
    assert ctx.inserted[0]["db_id"] == "main"

    # The response was lost on a bad link and the client retries: same photo, no duplicate.
    again = ctx.client.post(f"{BASE}/photo-uploads/{upload_id}/complete")
    assert again.status_code == 200 and again.json()["file_no"] == 101
    reopened = open_session(ctx).json()
    assert reopened["status"] == "complete" and reopened["file_no"] == 101
    assert len(ctx.inserted) == 1


def test_resent_chunk_is_harmless_and_bad_chunks_are_rejected(ctx):
    upload_id = open_session(ctx).json()["upload_id"]
    put_chunk(ctx, upload_id, 0)
    assert put_chunk(ctx, upload_id, 0).json()["received"] == [0]
    assert ctx.client.put(
        f"{BASE}/photo-uploads/{upload_id}/chunks/1", content=b"short",
        headers={"content-type": "application/octet-stream"},
    ).status_code == 400
    assert put_chunk(ctx, upload_id, 0).status_code == 200
    assert ctx.client.put(
        f"{BASE}/photo-uploads/{upload_id}/chunks/9", content=PHOTO[:CHUNK],
        headers={"content-type": "application/octet-stream"},
    ).status_code == 400


def test_checksum_mismatch_inserts_nothing(ctx):
    upload_id = open_session(ctx, sha256="0" * 64).json()["upload_id"]
    for index in range(3):
        put_chunk(ctx, upload_id, index)
    assert ctx.client.post(f"{BASE}/photo-uploads/{upload_id}/complete").status_code == 400
    assert ctx.inserted == []

    good = open_session(ctx, client_id="photo-0002-bbbb", sha256=hashlib.sha256(PHOTO).hexdigest()).json()
    for index in range(3):
        put_chunk(ctx, good["upload_id"], index)
    assert ctx.client.post(f"{BASE}/photo-uploads/{good['upload_id']}/complete").status_code == 200


def test_oversize_empty_and_client_id_reuse_are_refused(ctx):
    assert open_session(ctx, data=b"x" * (16 * 1024 * 1024)).status_code == 400
    assert ctx.client.post(
        f"{BASE}/7/photo-uploads", json={"client_id": "photo-0003-cccc", "size": 0},
    ).status_code == 422
    assert open_session(ctx, client_id="photo-0004-dddd").status_code == 200
    assert open_session(ctx, client_id="photo-0004-dddd", data=PHOTO[:1000]).status_code == 409


def test_another_user_cannot_see_or_finish_the_upload(ctx):
    upload_id = open_session(ctx).json()["upload_id"]
    ctx.app.dependency_overrides[deps.get_current_active_user] = lambda: SimpleNamespace(
        id=99, username="other", role="admin", permissions=[], is_active=True,
    )
    assert ctx.client.get(f"{BASE}/photo-uploads/{upload_id}").status_code == 404
    assert put_chunk(ctx, upload_id, 0).status_code == 404
    assert ctx.client.post(f"{BASE}/photo-uploads/{upload_id}/complete").status_code == 404
    assert ctx.client.delete(f"{BASE}/photo-uploads/{upload_id}").status_code == 404
    assert ctx.client.get(f"{BASE}/photo-uploads/not-an-id").status_code == 404


def test_parallel_complete_inserts_one_photo(ctx):
    upload_id = open_session(ctx).json()["upload_id"]
    for index in range(3):
        put_chunk(ctx, upload_id, index)
    ctx.gate.wait = threading.Event()

    def finish():
        return ctx.client.post(f"{BASE}/photo-uploads/{upload_id}/complete")

    with ThreadPoolExecutor(max_workers=2) as pool:
        first = pool.submit(finish)
        # The second call arrives while the first is still inserting.
        for _ in range(100):
            if (Path(uploads._root()) / upload_id / "complete.lock").exists():
                break
            threading.Event().wait(0.02)
        second = finish()
        assert second.status_code == 409
        ctx.gate.wait.set()
        assert first.result().status_code == 200
    assert len(ctx.inserted) == 1
    assert finish().json()["file_no"] == 101


def test_abort_drops_unfinished_upload_but_keeps_completed_result(ctx):
    upload_id = open_session(ctx).json()["upload_id"]
    put_chunk(ctx, upload_id, 0)
    assert ctx.client.delete(f"{BASE}/photo-uploads/{upload_id}").json() == {"ok": True}
    assert ctx.client.get(f"{BASE}/photo-uploads/{upload_id}").status_code == 404

    kept = open_session(ctx, client_id="photo-0005-eeee").json()["upload_id"]
    for index in range(3):
        put_chunk(ctx, kept, index)
    ctx.client.post(f"{BASE}/photo-uploads/{kept}/complete")
    ctx.client.delete(f"{BASE}/photo-uploads/{kept}")
    assert ctx.client.post(f"{BASE}/photo-uploads/{kept}/complete").json()["file_no"] == 101


def test_expired_uploads_are_cleaned_only_when_asked(ctx):
    import os
    import time

    stale = open_session(ctx).json()["upload_id"]
    fresh = open_session(ctx, client_id="photo-0006-ffff").json()["upload_id"]
    old = time.time() - 3 * 24 * 3600
    os.utime(Path(uploads._root()) / stale, (old, old))

    assert uploads.cleanup_expired(dry_run=True) == {"scanned": 2, "expired": 1, "removed": 0}
    assert ctx.client.get(f"{BASE}/photo-uploads/{stale}").status_code == 200
    assert uploads.cleanup_expired(dry_run=False)["removed"] == 1
    assert ctx.client.get(f"{BASE}/photo-uploads/{stale}").status_code == 404
    assert ctx.client.get(f"{BASE}/photo-uploads/{fresh}").status_code == 200


def test_resending_a_file_whose_photo_was_deleted_creates_a_new_photo(ctx):
    upload_id = open_session(ctx).json()["upload_id"]
    for index in range(3):
        put_chunk(ctx, upload_id, index)
    assert ctx.client.post(f"{BASE}/photo-uploads/{upload_id}/complete").json()["file_no"] == 101

    # The photo is deleted from the card; the user picks the very same file again.
    ctx.stored.discard(101)
    reopened = open_session(ctx).json()
    assert reopened["status"] == "uploading" and reopened["received"] == []
    for index in range(3):
        put_chunk(ctx, reopened["upload_id"], index)
    assert ctx.client.post(f"{BASE}/photo-uploads/{reopened['upload_id']}/complete").json()["file_no"] == 102
    assert len(ctx.inserted) == 2


def test_finished_upload_stays_finished_when_the_client_resends_a_different_size(ctx):
    upload_id = open_session(ctx).json()["upload_id"]
    for index in range(3):
        put_chunk(ctx, upload_id, index)
    ctx.client.post(f"{BASE}/photo-uploads/{upload_id}/complete")

    # A re-compressed copy of the same file has another size: still the same finished photo.
    again = open_session(ctx, data=PHOTO[:600_000])
    assert again.status_code == 200
    assert again.json()["status"] == "complete" and again.json()["file_no"] == 101
    assert len(ctx.inserted) == 1


def test_stale_lock_owner_cannot_release_a_lock_taken_over_after_it_went_stale(tmp_path):
    import os
    import time

    first = uploads._acquire_complete_lock(tmp_path)
    assert first and uploads._acquire_complete_lock(tmp_path) is None  # held and fresh

    old = time.time() - uploads.COMPLETE_LOCK_STALE_SECONDS - 5
    os.utime(tmp_path / "complete.lock", (old, old))
    second = uploads._acquire_complete_lock(tmp_path)  # takeover of a stale lock
    assert second and second != first

    uploads._release_complete_lock(tmp_path, first)  # the slow first caller finishes late
    assert (tmp_path / "complete.lock").exists()
    assert uploads._acquire_complete_lock(tmp_path) is None  # still owned by the second caller

    uploads._release_complete_lock(tmp_path, second)
    assert not (tmp_path / "complete.lock").exists()


@pytest.fixture
def ledger(monkeypatch, tmp_path):
    """The real insert ledger on a throw-away SQLite app database."""
    from sqlalchemy import create_engine
    from sqlalchemy.orm import sessionmaker

    from backend.appdb.models import AppEquipmentPhotoUploadLedger
    from backend.services import equipment_photo_upload_ledger as module

    engine = create_engine(
        f"sqlite+pysqlite:///{(tmp_path / 'ledger.db').as_posix()}"
    ).execution_options(schema_translate_map={"app": None})
    AppEquipmentPhotoUploadLedger.__table__.create(engine)
    factory = sessionmaker(bind=engine, expire_on_commit=False)

    from contextlib import contextmanager

    @contextmanager
    def session_scope(*args, **kwargs):
        session = factory()
        try:
            yield session
            session.commit()
        except Exception:
            session.rollback()
            raise
        finally:
            session.close()

    monkeypatch.setattr(module, "app_session", session_scope)
    monkeypatch.setattr(module, "is_available", lambda: True)
    return module


def _upload_all_chunks(ctx, upload_id):
    for index in range(3):
        put_chunk(ctx, upload_id, index)


def test_crash_between_insert_and_checkpoint_does_not_duplicate_the_photo(ctx, ledger, monkeypatch):
    upload_id = open_session(ctx).json()["upload_id"]
    _upload_all_chunks(ctx, upload_id)

    # The photo row is committed, then the checkpoint write fails (disk error / process killed).
    real_write = uploads._write_json_atomic
    monkeypatch.setattr(uploads, "_write_json_atomic", lambda *a, **k: (_ for _ in ()).throw(OSError("disk")))
    with pytest.raises(OSError):
        ctx.client.post(f"{BASE}/photo-uploads/{upload_id}/complete")
    assert len(ctx.inserted) == 1

    monkeypatch.setattr(uploads, "_write_json_atomic", real_write)
    retry = ctx.client.post(f"{BASE}/photo-uploads/{upload_id}/complete")
    assert retry.status_code == 200 and retry.json()["file_no"] == 101
    assert len(ctx.inserted) == 1


def test_ledger_entry_left_unfinished_by_a_crash_adopts_the_row_found_in_files(ctx, ledger, monkeypatch):
    upload_id = open_session(ctx).json()["upload_id"]
    _upload_all_chunks(ctx, upload_id)
    # The process died inside the insert: the ledger says "inserting" and FILES already has the row.
    ledger.begin(upload_id, item_id=7, created_by="mobile-user")
    ctx.stored.add(555)
    monkeypatch.setattr(
        equipment.equipment_photos, "find_recent_photo_file_nos", lambda *a, **k: [555]
    )
    done = ctx.client.post(f"{BASE}/photo-uploads/{upload_id}/complete")
    assert done.status_code == 200 and done.json()["file_no"] == 555
    assert ctx.inserted == []
    assert ledger.get(upload_id)["state"] == "done"


def test_ambiguous_recovery_inserts_instead_of_adopting_someone_elses_photo(ctx, ledger, monkeypatch):
    upload_id = open_session(ctx).json()["upload_id"]
    _upload_all_chunks(ctx, upload_id)
    ledger.begin(upload_id, item_id=7, created_by="mobile-user")
    monkeypatch.setattr(
        equipment.equipment_photos, "find_recent_photo_file_nos", lambda *a, **k: [555, 556]
    )
    done = ctx.client.post(f"{BASE}/photo-uploads/{upload_id}/complete")
    assert done.status_code == 200 and done.json()["file_no"] == 101
    assert len(ctx.inserted) == 1


def test_photo_deleted_after_a_finished_ledger_entry_can_be_uploaded_again(ctx, ledger):
    upload_id = open_session(ctx).json()["upload_id"]
    _upload_all_chunks(ctx, upload_id)
    assert ctx.client.post(f"{BASE}/photo-uploads/{upload_id}/complete").json()["file_no"] == 101
    ctx.stored.discard(101)
    reopened = open_session(ctx).json()
    _upload_all_chunks(ctx, reopened["upload_id"])
    assert ctx.client.post(f"{BASE}/photo-uploads/{reopened['upload_id']}/complete").json()["file_no"] == 102
    assert len(ctx.inserted) == 2
