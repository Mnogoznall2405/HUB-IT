from __future__ import annotations

import sys
from pathlib import Path

import pytest


ROOT = Path(__file__).resolve().parents[1]
WEB_ROOT = ROOT / "WEB-itinvent"
if str(WEB_ROOT) not in sys.path:
    sys.path.insert(0, str(WEB_ROOT))

from backend.database import equipment_photos  # noqa: E402


PNG_BYTES = (
    b"\x89PNG\r\n\x1a\n" + b"\x00" * 24
)


class FakeCursor:
    def __init__(self, fetchone_value=None, rowcount=0):
        self._fetchone = fetchone_value
        self.rowcount = rowcount
        self.executed = []

    def execute(self, query, params=None):
        self.executed.append((query, tuple(params or ())))

    def fetchone(self):
        return self._fetchone


class FakeConnection:
    def __init__(self, cursor):
        self._cursor = cursor

    def cursor(self):
        return self._cursor

    def __enter__(self):
        return self

    def __exit__(self, *exc):
        return False


class FakeDB:
    def __init__(self, responses=None, cursor=None):
        self.calls = []
        self._responses = list(responses or [])
        self._cursor = cursor

    def execute_query(self, query, params=None):
        self.calls.append((query, tuple(params or ())))
        return self._responses.pop(0) if self._responses else []

    def get_connection(self):
        return FakeConnection(self._cursor)


def _db_factory(db):
    return lambda db_id=None: db


def test_lookup_photo_counts_ignores_act_scans_and_reports_failures():
    db = FakeDB([[{"item_id": 7, "photo_count": 2}]])
    counts = equipment_photos.lookup_equipment_photo_counts(
        [7, "8", 7, "bad"], "db", get_db_fn=_db_factory(db)
    )
    assert counts == {7: 2}
    query, params = db.calls[0]
    # Act scans share FILES (FILE_TYPE=1, ITEM_ID=DOC_NO): photos only, same CI_TYPE.
    assert "FILE_TYPE = 0" in query
    assert "i.CI_TYPE = f.CI_TYPE" in query
    assert params == (7, 8)

    class BrokenDB:
        def execute_query(self, query, params=None):
            raise RuntimeError("boom")

    assert equipment_photos.lookup_equipment_photo_counts(
        [1], "db", get_db_fn=lambda db_id=None: BrokenDB()
    ) is None
    assert equipment_photos.lookup_equipment_photo_counts([], "db") == {}


def test_list_equipment_photos_scopes_by_ci_type_and_item():
    db = FakeDB([
        [{"CI_TYPE": 1}],
        [
            {
                "FILE_NO": 10,
                "FILE_NAME": "a.jpg",
                "FILE_DESCR": "front",
                "FILE_SIZE": 1.5,
                "CREATE_DATE": "2026-01-01 10:00:00",
                "CREATE_USER": "admin",
                "has_thumb": 1,
            }
        ],
    ])

    result = equipment_photos.list_equipment_photos("77", db_id="main", get_db_fn=_db_factory(db))

    assert result == [{
        "file_no": 10,
        "file_name": "a.jpg",
        "description": "front",
        "size_mb": 1.5,
        "has_thumb": True,
        "created_at": "2026-01-01 10:00:00",
        "created_by": "admin",
    }]
    assert "CI_TYPE = ? AND ITEM_ID = ?" in db.calls[1][0]
    assert db.calls[1][1] == (1, 77)


def test_list_equipment_photos_raises_for_missing_item():
    db = FakeDB([[]])
    with pytest.raises(equipment_photos.EquipmentNotFoundError):
        equipment_photos.list_equipment_photos(404, get_db_fn=_db_factory(db))


def test_get_equipment_photo_returns_blob_and_scopes_item():
    db = FakeDB([[{"FILE_NAME": "a.jpg", "FILE_DESCR": "", "blob_data": PNG_BYTES}]])

    payload = equipment_photos.get_equipment_photo(10, item_id=77, get_db_fn=_db_factory(db))

    assert payload["data"] == PNG_BYTES
    assert payload["file_name"] == "a.jpg"
    assert "AND ITEM_ID = ?" in db.calls[0][0]
    assert db.calls[0][1] == (10, 77)


def test_get_equipment_photo_thumb_falls_back_to_full_data():
    db = FakeDB([
        [{"FILE_NAME": "a.jpg", "FILE_DESCR": "", "blob_data": None}],
        [{"blob_data": PNG_BYTES}],
    ])

    payload = equipment_photos.get_equipment_photo(10, item_id=5, thumb=True, get_db_fn=_db_factory(db))

    assert payload["data"] == PNG_BYTES
    assert "FILE_SMALL_IMAGE_DATA" in db.calls[0][0]
    assert "FILE_DATA" in db.calls[1][0]


def test_insert_equipment_photo_validates_and_writes(monkeypatch):
    cursor = FakeCursor(fetchone_value=(99,))
    db = FakeDB([[{"CI_TYPE": 1}]], cursor=cursor)
    monkeypatch.setattr(equipment_photos, "_build_thumbnail", lambda data: b"THUMB")

    result = equipment_photos.insert_equipment_photo(
        item_id=77,
        file_name="photo.jpg",
        file_bytes=PNG_BYTES,
        created_by="tester",
        db_id="main",
        get_db_fn=_db_factory(db),
    )

    assert result == {"file_no": 99, "ci_type": 1, "item_id": 77}
    insert_query, insert_params = cursor.executed[1]
    assert "INSERT INTO FILES" in insert_query
    assert insert_params[0] == 99
    assert insert_params[1] == 1       # CI_TYPE
    assert insert_params[2] == 77      # ITEM_ID
    assert insert_params[3] == 0       # FILE_TYPE photo
    assert insert_params[4] == "photo.jpg"
    assert insert_params[7] == PNG_BYTES   # FILE_DATA
    assert insert_params[8] == b"THUMB"    # FILE_SMALL_IMAGE_DATA
    assert insert_params[9] == "tester"    # CREATE_USER (GETDATE() is inline SQL)


def test_insert_equipment_photo_downscales_large_image():
    import io as _io

    Image = pytest.importorskip("PIL.Image")
    big = _io.BytesIO()
    Image.new("RGB", (4000, 3000), (120, 30, 30)).save(big, format="JPEG")
    big_bytes = big.getvalue()

    cursor = FakeCursor(fetchone_value=(100,))
    db = FakeDB([[{"CI_TYPE": 1}]], cursor=cursor)

    equipment_photos.insert_equipment_photo(
        item_id=77,
        file_name="big.png",
        file_bytes=big_bytes,
        created_by="tester",
        get_db_fn=_db_factory(db),
    )

    _, params = cursor.executed[1]
    stored = params[7]
    assert stored[:3] == b"\xff\xd8\xff"
    assert len(stored) < len(big_bytes)
    assert params[4] == "big.jpg"
    with Image.open(_io.BytesIO(stored)) as stored_img:
        assert max(stored_img.size) <= equipment_photos.ORIG_MAX_EDGE_PX


def test_insert_equipment_photo_rejects_non_image():
    db = FakeDB([[{"CI_TYPE": 1}]], cursor=FakeCursor())
    with pytest.raises(equipment_photos.PhotoValidationError):
        equipment_photos.insert_equipment_photo(
            item_id=77,
            file_name="doc.pdf",
            file_bytes=b"%PDF-1.4 fake",
            created_by="tester",
            get_db_fn=_db_factory(db),
        )


def test_insert_equipment_photo_rejects_oversize():
    db = FakeDB([[{"CI_TYPE": 1}]], cursor=FakeCursor())
    with pytest.raises(equipment_photos.PhotoValidationError):
        equipment_photos.insert_equipment_photo(
            item_id=77,
            file_name="big.jpg",
            file_bytes=b"\xff\xd8\xff" + b"0" * (equipment_photos.MAX_PHOTO_BYTES + 1),
            created_by="tester",
            get_db_fn=_db_factory(db),
        )


def test_rotate_equipment_photo_turns_image_and_thumbnail_keeping_the_row_identity():
    import io as _io

    Image = pytest.importorskip("PIL.Image")
    src = _io.BytesIO()
    Image.new("RGB", (400, 200), (10, 120, 30)).save(src, format="JPEG")
    cursor = FakeCursor(fetchone_value=(src.getvalue(), "front.jpeg"))
    db = FakeDB(cursor=cursor)

    result = equipment_photos.rotate_equipment_photo(
        item_id=77, file_no=9, degrees=90, db_id="main", get_db_fn=_db_factory(db),
    )

    assert result["file_no"] == 9 and result["file_name"] == "front.jpeg" and result["has_thumb"] is True
    select_query, select_params = cursor.executed[0]
    assert "UPDLOCK" in select_query and select_params == (9, 77)
    update_query, params = cursor.executed[1]
    # Photo identity (FILE_NO, CREATE_DATE, CREATE_USER) is untouched: checks stay valid.
    assert "CREATE_DATE" not in update_query and "CREATE_USER" not in update_query
    stored, thumb = params[0], params[1]
    with Image.open(_io.BytesIO(stored)) as turned:
        assert turned.size == (200, 400)
    with Image.open(_io.BytesIO(thumb)) as turned_thumb:
        assert turned_thumb.size[0] < turned_thumb.size[1]
    assert params[4:] == (9, 77)


def test_rotate_equipment_photo_validates_angle_and_reports_missing_photo():
    cursor = FakeCursor(fetchone_value=None)
    db = FakeDB(cursor=cursor)
    with pytest.raises(equipment_photos.PhotoValidationError):
        equipment_photos.rotate_equipment_photo(
            item_id=77, file_no=9, degrees=45, get_db_fn=_db_factory(db),
        )
    assert cursor.executed == []
    assert equipment_photos.rotate_equipment_photo(
        item_id=77, file_no=9, degrees=-90, get_db_fn=_db_factory(db),
    ) is None


def test_delete_equipment_photo_scopes_item_and_type():
    cursor = FakeCursor(rowcount=1)
    db = FakeDB([], cursor=cursor)

    removed = equipment_photos.delete_equipment_photo(
        item_id=77, file_no=10, get_db_fn=_db_factory(db)
    )

    assert removed is True
    query, params = cursor.executed[0]
    assert "DELETE FROM FILES" in query
    assert "FILE_TYPE = 0" in query and "ITEM_ID = ?" in query
    assert params == (10, 77)


def test_sniff_image_mime_recognizes_common_formats():
    assert equipment_photos._sniff_image_mime(b"\xff\xd8\xff\xe0" + b"0" * 10) == "image/jpeg"
    assert equipment_photos._sniff_image_mime(PNG_BYTES) == "image/png"
    assert equipment_photos._sniff_image_mime(b"GIF89a" + b"0" * 10) == "image/gif"
    assert equipment_photos._sniff_image_mime(b"RIFF" + b"0000" + b"WEBP" + b"0" * 4) == "image/webp"
    assert equipment_photos._sniff_image_mime(b"%PDF-1.4") is None
