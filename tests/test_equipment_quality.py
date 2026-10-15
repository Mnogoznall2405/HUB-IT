"""Data-quality panel through the real equipment router.

The rule SQL runs on an in-memory SQLite copy of the ITEMS/OWNERS/FILES schema (the T-SQL
paging suffix is translated by the stand), so every rule's predicate is exercised, not mocked.
"""
from __future__ import annotations

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

READER = User(
    id=1, username="reader", full_name="Reader", role="viewer", is_active=True,
    permissions=["database.read"], use_custom_permissions=True, custom_permissions=["database.read"],
)
NO_RIGHTS = User(
    id=2, username="nobody", full_name="Nobody", role="viewer", is_active=True,
    permissions=[], use_custom_permissions=True, custom_permissions=[],
)

SCHEMA = """
CREATE TABLE ITEMS (ID INTEGER, CI_TYPE INTEGER, INV_NO TEXT, SERIAL_NO TEXT, PART_NO TEXT,
    TYPE_NO INTEGER, MODEL_NO INTEGER, EMPL_NO INTEGER, BRANCH_NO INTEGER, LOC_NO INTEGER);
CREATE TABLE OWNERS (OWNER_NO INTEGER, OWNER_DISPLAY_NAME TEXT);
CREATE TABLE FILES (ITEM_ID INTEGER, CI_TYPE INTEGER, FILE_TYPE INTEGER, FILE_NO INTEGER);
CREATE TABLE CI_TYPES (CI_TYPE INTEGER, TYPE_NO INTEGER, TYPE_NAME TEXT);
CREATE TABLE CI_MODELS (CI_TYPE INTEGER, MODEL_NO INTEGER, MODEL_NAME TEXT);
CREATE TABLE BRANCHES (BRANCH_NO INTEGER, BRANCH_NAME TEXT);
CREATE TABLE LOCATIONS (LOC_NO INTEGER, DESCR TEXT);
"""


class SqliteSqlServer:
    """execute_query() over SQLite with the few T-SQL spellings the rules use translated."""

    def __init__(self, conn: sqlite3.Connection):
        self.conn = conn
        self.queries: list[str] = []

    def execute_query(self, sql: str, params=()):
        params = tuple(params or ())
        sql = sql.replace("N'", "'")
        # T-SQL PATINDEX(pattern COLLATE BIN2, col) > 0  ->  col GLOB pattern (code-point ranges).
        sql = re.sub(
            r"PATINDEX\('%(\[.*?\])%' COLLATE Cyrillic_General_BIN2, ([\w.]+)\) > 0",
            lambda m: f"{m.group(2)} GLOB '*{m.group(1)}*'",
            sql,
        )
        match = re.search(r"OFFSET \? ROWS FETCH NEXT \? ROWS ONLY", sql)
        if match:
            sql = sql.replace(match.group(0), "LIMIT ? OFFSET ?")
            *head, offset, limit = params
            params = (*head, limit, offset)
        self.queries.append(sql)
        cursor = self.conn.execute(sql, params)
        columns = [c[0] for c in cursor.description or []]
        return [dict(zip(columns, row)) for row in cursor.fetchall()]


@pytest.fixture
def quality_env(monkeypatch, prebuilt_app_db):
    from fastapi import FastAPI
    from fastapi.testclient import TestClient
    from backend.api import deps
    from backend.api.v1 import equipment as equipment_api
    from backend.appdb.db import app_session
    from backend.database import queries
    from backend.services import employment_status_service as employment
    from backend.services import equipment_photo_ocr_service as ocr
    from backend.services import equipment_quality_service as quality

    conn = sqlite3.connect(":memory:", check_same_thread=False)
    conn.executescript(SCHEMA)
    db = SqliteSqlServer(conn)
    quality.clear_cache()
    # The OCR rules read PostgreSQL: point them at a throw-away database, never the real one.
    database_url = f"sqlite:///{prebuilt_app_db.as_posix()}"
    ocr.reset_table_probe()
    for module in (ocr, ocr.checks):
        monkeypatch.setattr(module, "app_session", lambda url=None: app_session(database_url))
        monkeypatch.setattr(module, "is_app_database_configured", lambda: True)
    monkeypatch.setattr(queries, "get_db", lambda db_id=None: db)
    # Address book: only these two people still work here.
    monkeypatch.setattr(
        employment,
        "resolve_employment_status_batch",
        lambda names, cache=None: {
            name: {"status": employment.STATUS_ACTIVE if name in {"Иванов Иван", "Петров Пётр"} else employment.STATUS_DISMISSED}
            for name in names
        },
    )

    current = {"user": READER}
    app = FastAPI()
    app.include_router(equipment_api.router, prefix="/equipment")
    app.dependency_overrides[deps.get_current_active_user] = lambda: current["user"]
    app.dependency_overrides[deps.get_request_scoped_database_id] = lambda: "main"

    class Env:
        pass

    env = Env()
    env.client = TestClient(app)
    env.conn = conn
    env.db = db
    env.current = current
    env.quality = quality

    def add_item(item_id, inv_no, serial="SN-%d", part_no="1C-1", type_no=1, empl_no=10,
                 branch_no=1, loc_no=1, photo=True, ci_type=1):
        serial_value = serial % item_id if isinstance(serial, str) and "%d" in serial else serial
        conn.execute(
            "INSERT INTO ITEMS VALUES (?,?,?,?,?,?,?,?,?,?)",
            (item_id, ci_type, inv_no, serial_value, part_no, type_no, 1, empl_no, branch_no, loc_no),
        )
        if photo:
            conn.execute("INSERT INTO FILES VALUES (?,?,0,1)", (item_id, ci_type))

    env.add_item = add_item
    conn.execute("INSERT INTO OWNERS VALUES (10, 'Иванов Иван')")
    conn.execute("INSERT INTO OWNERS VALUES (11, 'Сидоров Сидор')")
    conn.execute("INSERT INTO OWNERS VALUES (12, 'Склад Кириленко')")
    conn.execute("INSERT INTO BRANCHES VALUES (1, 'Главный')")
    conn.execute("INSERT INTO LOCATIONS VALUES (1, 'Каб. 101')")
    conn.execute("INSERT INTO CI_TYPES VALUES (1, 1, 'Ноутбук')")
    conn.execute("INSERT INTO CI_MODELS VALUES (1, 1, 'ThinkPad')")
    return env


def _counts(env):
    response = env.client.get("/equipment/quality/summary", params={"refresh": True})
    assert response.status_code == 200, response.text
    return {rule["rule"]: rule for rule in response.json()["rules"]}


def _issue_inv_nos(env, rule, **params):
    response = env.client.get("/equipment/quality/issues", params={"rule": rule, **params})
    assert response.status_code == 200, response.text
    return [row["inv_no"] for row in response.json()["items"]], response.json()


def test_each_rule_finds_only_its_own_dirty_rows(quality_env):
    add = quality_env.add_item
    add(1, "A-1")                                             # clean
    add(2, "A-2", photo=False)                                # no photo
    add(3, "A-3", part_no="")                                 # no PART_NO
    add(4, "A-4", part_no="нет в 1С")                         # closed sentinel: not a defect
    add(5, "A-5", empl_no=0)                                  # no owner
    add(6, "A-6", empl_no=999)                                # owner id missing from OWNERS
    add(7, "A-7", branch_no=0)                                # no branch
    add(8, "A-8", loc_no=None)                                # no location
    add(9, "A-9", empl_no=11)                                 # owner left the company
    add(10, "A-10", empl_no=12)                               # object, not a person: not judged
    # Filler so the type has >= 10 items and most carry a serial.
    for item_id in range(20, 32):
        add(item_id, f"B-{item_id}")
    add(40, "S-1", serial="")                                 # missing serial in a "serial" type
    add(41, "S-2", serial="-")                                # placeholder counts as missing
    add(42, "D-1", serial="DUP-1")
    add(43, "D-2", serial=" dup-1 ")                          # same serial, other case/spaces
    add(44, "I-1")
    add(45, "I-1")                                            # duplicate inventory number
    add(50, "O-1", ci_type=2, photo=False)                    # other CI type: never counted

    rules = _counts(quality_env)

    expected = {
        "no_photo": ["A-2"],
        "no_part_no": ["A-3"],
        "no_owner": ["A-5", "A-6"],
        "no_branch_location": ["A-7", "A-8"],
        "no_serial": ["S-1", "S-2"],
        "duplicate_serial": ["D-1", "D-2"],
        "duplicate_inv_no": ["I-1", "I-1"],
        "dismissed_owner": ["A-9"],
    }
    for rule, inv_nos in expected.items():
        found, body = _issue_inv_nos(quality_env, rule, limit=200)
        assert sorted(found) == sorted(inv_nos), rule
        assert rules[rule]["count"] == len(inv_nos), rule
        assert body["total"] == len(inv_nos), rule
    total = rules["no_photo"]["total"]
    # 10 + 12 filler + 6 serial/duplicate rows; the CI_TYPE 2 row is outside the list.
    assert total == 28 and rules["no_photo"]["pct"] == round(1 * 100 / 28, 1)


def test_serial_rules_catch_russian_letters_and_stray_characters_but_not_placeholders(quality_env):
    add = quality_env.add_item
    add(1, "C-1", serial="1622А003600185")        # Cyrillic А inside a Latin serial
    add(2, "C-2", serial="б/н")                   # «без номера» placeholder: not a typo
    add(3, "C-3", serial="CNK7321MTC T")          # stray space
    add(4, "C-4", serial="CN-07WR56-FCC00-9BD.A_6/1")  # legal Dell-style serial
    add(5, "C-5", serial="FB2A4318 0969")         # space inside
    add(6, "C-6", serial="ABC#123")               # stray symbol
    add(7, "C-7", serial="1ВАТН076423")           # Cyrillic only: not double counted as odd chars

    _counts(quality_env)

    cyrillic, _ = _issue_inv_nos(quality_env, "serial_cyrillic")
    odd, _ = _issue_inv_nos(quality_env, "serial_odd_chars")
    assert sorted(cyrillic) == ["C-1", "C-7"]
    assert sorted(odd) == ["C-3", "C-5", "C-6"]


def test_summary_is_cached_and_refreshable(quality_env):
    quality_env.add_item(1, "A-1", photo=False)
    first = quality_env.client.get("/equipment/quality/summary", params={"refresh": True}).json()
    assert first["cached"] is False

    quality_env.add_item(2, "A-2", photo=False)
    cached = quality_env.client.get("/equipment/quality/summary").json()
    assert cached["cached"] is True
    assert {r["rule"]: r["count"] for r in cached["rules"]}["no_photo"] == 1

    fresh = quality_env.client.get("/equipment/quality/summary", params={"refresh": True}).json()
    assert {r["rule"]: r["count"] for r in fresh["rules"]}["no_photo"] == 2


def test_issue_list_pages_searches_and_exports_csv(quality_env):
    for item_id in range(1, 6):
        quality_env.add_item(item_id, f"N-{item_id}", photo=False)
    quality_env.add_item(6, "=SUM(1)", photo=False)

    page, body = _issue_inv_nos(quality_env, "no_photo", limit=2, offset=2)
    assert body["total"] == 6 and len(page) == 2

    found, body = _issue_inv_nos(quality_env, "no_photo", q="N-3")
    assert found == ["N-3"] and body["total"] == 1

    export = quality_env.client.get("/equipment/quality/issues/export", params={"rule": "no_photo"})
    assert export.status_code == 200
    assert export.headers["content-disposition"].endswith('quality-no_photo.csv"')
    text = export.content.decode("utf-8-sig")
    assert text.splitlines()[0].startswith("Инв. №;")
    # A cell starting with "=" must not become a spreadsheet formula.
    assert "'=SUM(1)" in text


def test_unknown_owner_status_is_reported_as_unknown_not_clean(quality_env, monkeypatch):
    from backend.services import employment_status_service as employment

    quality_env.add_item(1, "A-1", empl_no=11)
    monkeypatch.setattr(
        employment,
        "resolve_employment_status_batch",
        lambda names, cache=None: {n: {"status": employment.STATUS_UNKNOWN} for n in names},
    )

    rule = _counts(quality_env)["dismissed_owner"]

    assert rule["status"] == "unknown" and rule["count"] is None and rule["pct"] is None


def test_access_and_validation(quality_env):
    quality_env.current["user"] = NO_RIGHTS
    assert quality_env.client.get("/equipment/quality/summary").status_code == 403
    assert quality_env.client.get("/equipment/quality/issues", params={"rule": "no_photo"}).status_code == 403

    quality_env.current["user"] = READER
    assert quality_env.client.get("/equipment/quality/issues", params={"rule": "bogus"}).status_code == 404
