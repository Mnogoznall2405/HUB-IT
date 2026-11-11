from __future__ import annotations

import importlib.util
import sqlite3
import sys
from pathlib import Path

import pytest
from sqlalchemy import create_engine, text

PROJECT_ROOT = Path(__file__).resolve().parents[1]
SCRIPT_PATH = PROJECT_ROOT / "scripts" / "migrate_hub_sqlite_to_postgres.py"
spec = importlib.util.spec_from_file_location("migrate_hub_sqlite_to_postgres", SCRIPT_PATH)
script = importlib.util.module_from_spec(spec)
assert spec.loader is not None
sys.modules[spec.name] = script
spec.loader.exec_module(script)


def _make_source(path: Path, *, announcements: int, with_all_tables: bool = True) -> None:
    conn = sqlite3.connect(path)
    tables = script.TABLES_IN_ORDER if with_all_tables else ["hub_announcements"]
    for name in tables:
        if name == "hub_announcements":
            conn.execute("CREATE TABLE hub_announcements (id INTEGER PRIMARY KEY, title TEXT)")
        else:
            conn.execute(f"CREATE TABLE {name} (id INTEGER PRIMARY KEY)")
    for i in range(announcements):
        conn.execute("INSERT INTO hub_announcements (id, title) VALUES (?, ?)", (i + 1, f"a{i}"))
    conn.commit()
    conn.close()


def _run(monkeypatch, tmp_path, source: Path, *extra: str) -> int:
    target_url = f"sqlite+pysqlite:///{(tmp_path / 'target.db').as_posix()}"
    monkeypatch.setattr(
        sys, "argv",
        ["migrate", "--source-db-path", str(source), "--target-database-url", target_url, *extra],
    )
    return script.main()


@pytest.fixture()
def target_engine(tmp_path):
    engine = create_engine(f"sqlite+pysqlite:///{(tmp_path / 'target.db').as_posix()}")
    with engine.begin() as conn:
        for name in script.TABLES_IN_ORDER:
            if name == "hub_announcements":
                conn.execute(text("CREATE TABLE hub_announcements (id INTEGER PRIMARY KEY, title TEXT)"))
            else:
                conn.execute(text(f"CREATE TABLE {name} (id INTEGER PRIMARY KEY)"))
        conn.execute(text("INSERT INTO hub_announcements (id, title) VALUES (100, 'keep')"))
    return engine


def _target_titles(engine) -> list[str]:
    with engine.connect() as conn:
        return [r[0] for r in conn.execute(text("SELECT title FROM hub_announcements ORDER BY id"))]


@pytest.fixture(autouse=True)
def _skip_backend_init(monkeypatch, tmp_path):
    init_calls: list[str] = []
    import backend.services.hub_service as hub_service  # import (and its module-level init) before patching
    import backend.appdb.db as appdb

    target_url = f"sqlite+pysqlite:///{(tmp_path / 'target.db').as_posix()}"
    monkeypatch.setattr(appdb, "ensure_app_database_configured", lambda *_a, **_k: target_url)
    monkeypatch.setattr(appdb, "get_app_engine", lambda *_a, **_k: create_engine(target_url))
    monkeypatch.setattr(appdb, "initialize_app_schema", lambda *_a, **_k: init_calls.append("schema"))
    monkeypatch.setattr(hub_service, "HubService", lambda *_a, **_k: init_calls.append("hub_service"))
    return init_calls


def test_empty_source_does_not_wipe_filled_target(monkeypatch, tmp_path, target_engine):
    source = tmp_path / "src.db"
    _make_source(source, announcements=0)
    with pytest.raises(SystemExit):
        _run(monkeypatch, tmp_path, source, "--execute", "--overwrite")
    assert _target_titles(target_engine) == ["keep"]


def test_incomplete_source_is_refused(monkeypatch, tmp_path, target_engine):
    source = tmp_path / "src.db"
    _make_source(source, announcements=3, with_all_tables=False)
    with pytest.raises(SystemExit):
        _run(monkeypatch, tmp_path, source, "--execute", "--overwrite")
    assert _target_titles(target_engine) == ["keep"]


def test_filled_target_needs_overwrite_and_default_is_dry_run(monkeypatch, tmp_path, target_engine):
    source = tmp_path / "src.db"
    _make_source(source, announcements=2)
    with pytest.raises(SystemExit):
        _run(monkeypatch, tmp_path, source, "--execute")
    assert _target_titles(target_engine) == ["keep"]
    with pytest.raises(SystemExit):
        _run(monkeypatch, tmp_path, source)
    assert _target_titles(target_engine) == ["keep"]


def test_overwrite_execute_replaces_target(monkeypatch, tmp_path, target_engine):
    source = tmp_path / "src.db"
    _make_source(source, announcements=2)
    assert _run(monkeypatch, tmp_path, source, "--execute", "--overwrite") == 0
    assert _target_titles(target_engine) == ["a0", "a1"]


def test_dry_run_does_not_initialize_schema_or_hub_service(monkeypatch, tmp_path, target_engine, _skip_backend_init):
    # Both inits can write (DDL, task backfill), so they must stay behind --execute.
    source = tmp_path / "src.db"
    _make_source(source, announcements=2)
    assert _run(monkeypatch, tmp_path, source, "--overwrite") == 0  # dry-run report only
    assert _skip_backend_init == []
    assert _target_titles(target_engine) == ["keep"]
    assert _run(monkeypatch, tmp_path, source, "--execute", "--overwrite") == 0
    assert _skip_backend_init == ["schema", "hub_service"]
