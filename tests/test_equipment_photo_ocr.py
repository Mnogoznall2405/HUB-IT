"""Serial-number recognition on equipment photos through the real equipment router.

FILES/ITEMS run on an in-memory SQLite stand (T-SQL paging/TOP translated), the OCR store on a
throw-away app database, the vision model is a fake that answers in call order. Pinned:
a batch pays for each photo once, item verdicts follow the *current* serial and any matching
photo confirms the item, a replaced photo (reused FILE_NO) loses its result, items without a
serial are never sent to the model, and a missing table degrades instead of breaking photos.
"""
from __future__ import annotations

import io
import json
import re
import sqlite3
import sys
from pathlib import Path

import pytest

PROJECT_ROOT = Path(__file__).resolve().parents[1]
WEB_ROOT = PROJECT_ROOT / "WEB-itinvent"
if str(WEB_ROOT) not in sys.path:
    sys.path.insert(0, str(WEB_ROOT))

from backend.models.auth import User  # noqa: E402

ADMIN = User(
    id=1, username="root", full_name="Root Admin", role="admin", is_active=True,
    permissions=["database.read", "database.write"], use_custom_permissions=True,
    custom_permissions=["database.read", "database.write"],
)
READER = User(
    id=2, username="reader", full_name="Reader", role="viewer", is_active=True,
    permissions=["database.read"], use_custom_permissions=True, custom_permissions=["database.read"],
)

SCHEMA = """
CREATE TABLE ITEMS (ID INTEGER, CI_TYPE INTEGER, INV_NO TEXT, SERIAL_NO TEXT, PART_NO TEXT,
    TYPE_NO INTEGER, MODEL_NO INTEGER, EMPL_NO INTEGER, BRANCH_NO INTEGER, LOC_NO INTEGER);
CREATE TABLE FILES (ITEM_ID INTEGER, CI_TYPE INTEGER, FILE_TYPE INTEGER, FILE_NO INTEGER,
    FILE_NAME TEXT, FILE_DESCR TEXT, FILE_SIZE REAL, CREATE_DATE TEXT, CREATE_USER TEXT,
    FILE_DATA BLOB, FILE_SMALL_IMAGE_DATA BLOB);
CREATE TABLE OWNERS (OWNER_NO INTEGER, OWNER_DISPLAY_NAME TEXT);
CREATE TABLE CI_TYPES (CI_TYPE INTEGER, TYPE_NO INTEGER, TYPE_NAME TEXT);
CREATE TABLE CI_MODELS (CI_TYPE INTEGER, MODEL_NO INTEGER, MODEL_NAME TEXT);
CREATE TABLE BRANCHES (BRANCH_NO INTEGER, BRANCH_NAME TEXT);
CREATE TABLE LOCATIONS (LOC_NO INTEGER, DESCR TEXT);
"""


def _png() -> bytes:
    from PIL import Image

    out = io.BytesIO()
    Image.new("RGB", (64, 48), (120, 130, 140)).save(out, format="PNG")
    return out.getvalue()


class SqliteSqlServer:
    def __init__(self, conn: sqlite3.Connection):
        self.conn = conn

    def execute_query(self, sql: str, params=()):
        params = tuple(params or ())
        if "SELECT TOP 1 " in sql:
            sql = sql.replace("SELECT TOP 1 ", "SELECT ") + " LIMIT 1"
        if re.search(r"OFFSET \? ROWS FETCH NEXT \? ROWS ONLY", sql):
            sql = sql.replace("OFFSET ? ROWS FETCH NEXT ? ROWS ONLY", "LIMIT ? OFFSET ?")
            *head, offset, limit = params
            params = (*head, limit, offset)
        cursor = self.conn.execute(sql, params)
        columns = [c[0] for c in cursor.description or []]
        return [dict(zip(columns, row)) for row in cursor.fetchall()]


class FakeLlm:
    """Vision model stand-in: answers in call order, counts the paid calls."""

    def __init__(self):
        self.answers: list[str] = []
        self.calls = 0

    def is_configured(self) -> bool:
        return True

    def complete_vision(self, **_kwargs):
        self.calls += 1
        return self.answers.pop(0), {"prompt_tokens": 1000, "completion_tokens": 50}


def label(*serials: str) -> str:
    return json.dumps({"photo_type": "label", "serials": [{"value": s, "caption": "S/N"} for s in serials]})


GENERAL = json.dumps({"photo_type": "general", "serials": []})


@pytest.fixture
def ocr_env(monkeypatch, prebuilt_app_db):
    from fastapi import FastAPI
    from fastapi.testclient import TestClient
    from backend.api import deps
    from backend.api.v1 import equipment as equipment_api
    from backend.appdb.db import app_session
    from backend.database import equipment_current_act_reads, equipment_photos, queries
    from backend.services import equipment_photo_check_service as checks
    from backend.services import equipment_photo_ocr_service as ocr
    from backend.services import equipment_quality_service as quality

    database_url = f"sqlite:///{prebuilt_app_db.as_posix()}"
    for module in (ocr, checks):
        monkeypatch.setattr(module, "app_session", lambda url=None: app_session(database_url))
        monkeypatch.setattr(module, "is_app_database_configured", lambda: True)
    ocr.reset_table_probe()
    quality.clear_cache()

    conn = sqlite3.connect(":memory:", check_same_thread=False)
    conn.executescript(SCHEMA)
    db = SqliteSqlServer(conn)
    monkeypatch.setattr(queries, "get_db", lambda db_id=None: db)
    monkeypatch.setattr(equipment_photos, "_default_get_db", lambda db_id=None: db)
    monkeypatch.setattr(equipment_current_act_reads, "lookup_current_acts", lambda ids, db_id=None, **_: {})

    llm = FakeLlm()
    monkeypatch.setattr(ocr, "openrouter_client", llm)
    monkeypatch.setattr(ocr, "is_enabled", lambda: True)
    monkeypatch.setattr(ocr, "RUN_WORKERS", 1)

    current = {"user": ADMIN}
    app = FastAPI()
    app.include_router(equipment_api.router, prefix="/equipment")
    app.dependency_overrides[deps.get_current_active_user] = lambda: current["user"]
    app.dependency_overrides[deps.get_request_scoped_database_id] = lambda: "main"

    class Env:
        pass

    env = Env()
    env.client = TestClient(app)
    env.conn = conn
    env.llm = llm
    env.ocr = ocr
    env.current = current
    env.monkeypatch = monkeypatch
    env.database_url = database_url
    env.equipment_photos = equipment_photos

    def add_item(item_id, inv_no, serial):
        conn.execute(
            "INSERT INTO ITEMS VALUES (?,?,?,?,?,?,?,?,?,?)",
            (item_id, 1, inv_no, serial, "1C-1", 1, 1, 0, 1, 1),
        )

    def add_photo(item_id, file_no, created_at):
        conn.execute(
            "INSERT INTO FILES VALUES (?,?,0,?,?,?,?,?,?,?,NULL)",
            (item_id, 1, file_no, f"p{file_no}.png", "", 0.1, created_at, "Someone", _png()),
        )

    env.add_item = add_item
    env.add_photo = add_photo
    conn.execute("INSERT INTO BRANCHES VALUES (1, 'Главный')")
    conn.execute("INSERT INTO LOCATIONS VALUES (1, 'Каб. 101')")
    conn.execute("INSERT INTO CI_TYPES VALUES (1, 1, 'Ноутбук')")
    conn.execute("INSERT INTO CI_MODELS VALUES (1, 1, 'ThinkPad')")
    return env


def _seed_catalog(env):
    env.add_item(1, "OK-1", "SN12345678")
    env.add_item(2, "SIM-1", "ABC0123456")
    env.add_item(3, "BAD-1", "ZZZ999888")
    env.add_item(4, "NOSERIAL", "")
    env.add_item(5, "MULTI", "MM-5555")
    # Newest first is the order the batch visits them in (and the fake answers in).
    env.add_photo(5, 1, "2026-10-15 10:00:00")   # label that matches
    env.add_photo(5, 2, "2026-10-14 10:00:00")   # general view
    env.add_photo(1, 1, "2026-10-13 10:00:00")
    env.add_photo(2, 1, "2026-10-12 10:00:00")
    env.add_photo(3, 1, "2026-10-11 10:00:00")
    env.add_photo(4, 1, "2026-10-10 10:00:00")   # item without a serial: never sent
    env.llm.answers = [
        label("MM-5555"),
        GENERAL,
        label("SN12345678"),
        label("ABCO123456"),        # letter O instead of zero
        label("QQQ111222"),
    ]


def _run(env, limit=50):
    response = env.client.post("/equipment/photos/ocr/run", json={"limit": limit})
    assert response.status_code == 200, response.text
    return response.json()


def _summary(env):
    response = env.client.get("/equipment/photos/ocr/summary")
    assert response.status_code == 200, response.text
    return response.json()


def _rules(env):
    response = env.client.get("/equipment/quality/summary", params={"refresh": True})
    assert response.status_code == 200, response.text
    return {rule["rule"]: rule for rule in response.json()["rules"]}


def test_batch_confirms_by_photo_flags_the_doubtful_and_never_pays_twice(ocr_env):
    _seed_catalog(ocr_env)

    assert _run(ocr_env)["started"] is True

    assert ocr_env.llm.calls == 5          # the item without a serial was not sent
    summary = _summary(ocr_env)
    assert summary["analyzed"] == 5 and summary["pending"] == 0
    assert (summary["items_confirmed"], summary["items_similar"], summary["items_mismatch"]) == (2, 1, 1)
    assert summary["run"]["tokens_in"] == 5000

    # Any matching photo confirms the item; the general view is just "no label".
    multi = ocr_env.client.get("/equipment/5/photos").json()
    assert multi["serial_confirmed_by_photo"] is True
    assert {p["file_no"]: p["ocr_verdict"] for p in multi["photos"]} == {1: "match", 2: "no_label"}
    similar = ocr_env.client.get("/equipment/2/photos").json()
    assert similar["serial_confirmed_by_photo"] is False
    assert similar["photos"][0]["ocr_verdict"] == "similar"
    assert similar["photos"][0]["ocr_serials"] == ["ABCO123456"]

    # The quality panel lists what a person has to look at, with what the photo says.
    rules = _rules(ocr_env)
    assert rules["serial_photo_similar"]["count"] == 1 and rules["serial_photo_mismatch"]["count"] == 1
    body = ocr_env.client.get("/equipment/quality/issues", params={"rule": "serial_photo_mismatch"}).json()
    assert [(i["inv_no"], i["note"]) for i in body["items"]] == [("BAD-1", "На фото: QQQ111222")]

    # Re-running finds nothing new and spends nothing.
    again = _run(ocr_env)
    assert again["started"] is True
    assert ocr_env.llm.calls == 5


def test_corrected_serial_changes_the_verdict_and_a_replaced_photo_loses_its_result(ocr_env):
    _seed_catalog(ocr_env)
    _run(ocr_env)

    # Someone fixed the typo in the database: the stored reading now matches.
    ocr_env.conn.execute("UPDATE ITEMS SET SERIAL_NO = 'ABCO123456' WHERE ID = 2")
    assert ocr_env.client.get("/equipment/2/photos").json()["photos"][0]["ocr_verdict"] == "match"
    assert _rules(ocr_env)["serial_photo_similar"]["count"] == 0

    # The photo was deleted and its FILE_NO reused by another picture.
    ocr_env.conn.execute("UPDATE FILES SET CREATE_DATE = '2026-10-16 09:00:00' WHERE ITEM_ID = 1")
    replaced = ocr_env.client.get("/equipment/1/photos").json()
    assert replaced["serial_confirmed_by_photo"] is False
    assert replaced["photos"][0]["ocr_verdict"] == ""

    ocr_env.llm.answers = [label("SN12345678")]
    _run(ocr_env)
    assert ocr_env.llm.calls == 6
    assert ocr_env.client.get("/equipment/1/photos").json()["serial_confirmed_by_photo"] is True


def test_a_photo_a_person_has_checked_stops_being_doubtful_until_the_mark_is_withdrawn(ocr_env):
    _seed_catalog(ocr_env)
    _run(ocr_env)
    assert _rules(ocr_env)["serial_photo_similar"]["count"] == 1
    assert _rules(ocr_env)["serial_photo_mismatch"]["count"] == 1

    # Items 2 ("similar") and 3 ("mismatch") get their photo checked by a person.
    for item_id in (2, 3):
        assert ocr_env.client.post(f"/equipment/{item_id}/photos/1/verify").status_code == 200

    listing = ocr_env.client.get("/equipment/2/photos").json()
    assert listing["photos"][0]["ocr_verdict"] == "reviewed"
    assert listing["serial_confirmed_by_photo"] is False
    rules = _rules(ocr_env)
    assert rules["serial_photo_similar"]["count"] == 0 and rules["serial_photo_mismatch"]["count"] == 0
    assert _summary(ocr_env)["items_similar"] == 0

    # Withdrawing the mark puts the item back on the list.
    assert ocr_env.client.delete("/equipment/2/photos/1/verify").status_code == 200
    assert ocr_env.client.get("/equipment/2/photos").json()["photos"][0]["ocr_verdict"] == "similar"
    assert _rules(ocr_env)["serial_photo_similar"]["count"] == 1


def test_unreadable_answer_is_recorded_once_and_counted_as_error(ocr_env):
    ocr_env.add_item(1, "OK-1", "SN12345678")
    ocr_env.add_photo(1, 1, "2026-10-13 10:00:00")
    ocr_env.llm.answers = ["this is not json"]

    result = _run(ocr_env)

    assert result["started"] is True
    assert _summary(ocr_env)["run"]["errors"] == 1
    _run(ocr_env)
    assert ocr_env.llm.calls == 1
    # Not a verdict about the serial: neither confirmed nor flagged.
    assert ocr_env.client.get("/equipment/1/photos").json()["serial_confirmed_by_photo"] is False


def test_switched_off_feature_is_refused_and_an_upload_triggers_recognition_only_when_on(ocr_env):
    ocr_env.add_item(1, "OK-1", "SN12345678")
    clock = {"n": 0}

    def fake_insert(**kwargs):
        clock["n"] += 1
        file_no = 10 + clock["n"]
        ocr_env.add_photo(int(kwargs["item_id"]), file_no, f"2026-10-15 11:00:{clock['n']:02d}")
        return {"file_no": file_no, "ci_type": 1, "item_id": int(kwargs["item_id"])}

    ocr_env.monkeypatch.setattr(ocr_env.equipment_photos, "insert_equipment_photo", fake_insert)
    ocr_env.current["user"] = ADMIN

    ocr_env.add_item(2, "NOSERIAL", "")

    def upload(item_id=1):
        response = ocr_env.client.post(
            f"/equipment/{item_id}/photos", files={"file": ("a.png", _png(), "image/png")}
        )
        assert response.status_code == 200, response.text

    ocr_env.monkeypatch.setattr(ocr_env.ocr, "is_enabled", lambda: False)
    ocr_env.llm.answers = [label("SN12345678")]
    upload()
    assert ocr_env.llm.calls == 0
    assert ocr_env.client.post("/equipment/photos/ocr/run", json={"limit": 5}).status_code == 409

    ocr_env.monkeypatch.setattr(ocr_env.ocr, "is_enabled", lambda: True)
    upload()
    assert ocr_env.llm.calls == 1
    photos = ocr_env.client.get("/equipment/1/photos").json()
    assert photos["serial_confirmed_by_photo"] is True

    # An item without a serial has nothing to compare with: its photo is not paid for.
    upload(item_id=2)
    assert ocr_env.llm.calls == 1


def test_batch_is_admin_only_and_a_reader_sees_the_summary(ocr_env):
    ocr_env.current["user"] = READER

    assert ocr_env.client.post("/equipment/photos/ocr/run", json={"limit": 5}).status_code == 403
    assert ocr_env.client.get("/equipment/photos/ocr/summary").status_code == 200
    assert ocr_env.llm.calls == 0


def test_missing_table_degrades_photos_and_refuses_the_batch(ocr_env):
    import sqlalchemy as sa

    _seed_catalog(ocr_env)
    engine = sa.create_engine(ocr_env.database_url)
    with engine.begin() as connection:
        connection.execute(sa.text("DROP TABLE equipment_photo_ocr"))
    ocr_env.ocr.reset_table_probe()

    listing = ocr_env.client.get("/equipment/5/photos")
    assert listing.status_code == 200
    assert listing.json()["ocr_available"] is False
    assert _summary(ocr_env)["store_available"] is False
    assert ocr_env.client.post("/equipment/photos/ocr/run", json={"limit": 5}).status_code == 503
    # Not analysed yet is "unknown", never a clean "0 problems".
    assert _rules(ocr_env)["serial_photo_mismatch"]["status"] == "unknown"
    assert ocr_env.llm.calls == 0
