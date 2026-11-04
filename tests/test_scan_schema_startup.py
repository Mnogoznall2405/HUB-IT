"""Scan startup must not run DDL: it only compares scan.alembic_version with the code's head."""
import sys
from pathlib import Path

import pytest
from sqlalchemy import create_engine, event, inspect, text
from sqlalchemy.pool import StaticPool

PROJECT_ROOT = Path(__file__).resolve().parents[1]
if str(PROJECT_ROOT) not in sys.path:
    sys.path.insert(0, str(PROJECT_ROOT))

from scan_server import db as scan_db  # noqa: E402


@pytest.fixture
def engine():
    """SQLite stand-in for PostgreSQL: the ``scan`` schema is an attached database."""
    eng = create_engine("sqlite://", poolclass=StaticPool)

    @event.listens_for(eng, "connect")
    def _attach(dbapi_connection, _record):
        dbapi_connection.execute("ATTACH DATABASE ':memory:' AS scan")

    return eng


def _stamp(engine, version):
    with engine.begin() as conn:
        conn.execute(text("CREATE TABLE scan.alembic_version (version_num VARCHAR(32) NOT NULL)"))
        if version:
            conn.execute(text("INSERT INTO scan.alembic_version VALUES (:v)"), {"v": version})


def test_startup_reports_version_state_without_creating_anything(engine, monkeypatch):
    monkeypatch.delenv("SCAN_SCHEMA_DEV_AUTO_CREATE", raising=False)
    assert scan_db.prepare_scan_schema(engine)["status"] == "unreadable"  # no version table yet

    _stamp(engine, "20260917_0002")
    result = scan_db.prepare_scan_schema(engine)
    assert result["status"] == "behind" and result["expected"] == "20261102_0003"

    with engine.begin() as conn:
        conn.execute(text("UPDATE scan.alembic_version SET version_num = '20261102_0003'"))
    assert scan_db.prepare_scan_schema(engine)["status"] == "current"

    with engine.begin() as conn:
        conn.execute(text("UPDATE scan.alembic_version SET version_num = '29990101_9999'"))
    assert scan_db.prepare_scan_schema(engine)["status"] == "unknown_revision"

    # Not a single application table was created by any of the startups above.
    assert inspect(engine).get_table_names(schema="scan") == ["alembic_version"]


def test_dev_flag_is_the_only_way_to_run_startup_ddl(monkeypatch):
    monkeypatch.delenv("SCAN_SCHEMA_DEV_AUTO_CREATE", raising=False)
    assert scan_db.dev_auto_create_enabled() is False
    monkeypatch.setenv("SCAN_SCHEMA_DEV_AUTO_CREATE", "1")
    assert scan_db.dev_auto_create_enabled() is True
