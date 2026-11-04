"""DOPS-01: the replace-style migrators share the hub migrator's safety contract.

Driven through the real network migrator script against a SQLite "target"; the other four
(mail, mfu, reminders, env audit) use the same ``_migration_safety.safe_replace``.
"""
from __future__ import annotations

import importlib.util
import sqlite3
import sys
from pathlib import Path

import pytest
from sqlalchemy import create_engine, text

PROJECT_ROOT = Path(__file__).resolve().parents[1]
SCRIPTS = PROJECT_ROOT / "scripts"
if str(SCRIPTS) not in sys.path:
    sys.path.insert(0, str(SCRIPTS))
spec = importlib.util.spec_from_file_location("migrate_network_sqlite_to_postgres", SCRIPTS / "migrate_network_sqlite_to_postgres.py")
script = importlib.util.module_from_spec(spec)
assert spec.loader is not None
sys.modules[spec.name] = script
spec.loader.exec_module(script)

TABLES = script.TABLES_IN_ORDER


def _make_source(path: Path, *, branches: int, drop: str | None = None) -> None:
    conn = sqlite3.connect(path)
    for name in TABLES:
        if name == drop:
            continue
        if name == "network_branches":
            conn.execute("CREATE TABLE network_branches (id INTEGER PRIMARY KEY, name TEXT NOT NULL)")
        else:
            conn.execute(f"CREATE TABLE {name} (id INTEGER PRIMARY KEY)")
    for i in range(branches):
        conn.execute("INSERT INTO network_branches (id, name) VALUES (?, ?)", (i + 1, f"b{i}"))
    conn.commit()
    conn.close()


@pytest.fixture()
def target_engine(tmp_path):
    engine = create_engine(f"sqlite+pysqlite:///{(tmp_path / 'target.db').as_posix()}")
    with engine.begin() as conn:
        for name in TABLES:
            if name == "network_branches":
                # UNIQUE makes the Nth INSERT fail when the source has duplicate names.
                conn.execute(text("CREATE TABLE network_branches (id INTEGER PRIMARY KEY, name TEXT NOT NULL UNIQUE)"))
            else:
                conn.execute(text(f"CREATE TABLE {name} (id INTEGER PRIMARY KEY)"))
        conn.execute(text("INSERT INTO network_branches (id, name) VALUES (100, 'keep')"))
    return engine


@pytest.fixture(autouse=True)
def _skip_backend_init(monkeypatch, tmp_path):
    import backend.appdb.db as appdb
    import backend.services.network_service as network_service

    url = f"sqlite+pysqlite:///{(tmp_path / 'target.db').as_posix()}"
    monkeypatch.setattr(appdb, "ensure_app_database_configured", lambda *_a, **_k: url)
    monkeypatch.setattr(appdb, "get_app_engine", lambda *_a, **_k: create_engine(url))
    monkeypatch.setattr(appdb, "initialize_app_schema", lambda *_a, **_k: None)
    monkeypatch.setattr(network_service, "NetworkService", lambda *_a, **_k: None)


def _run(monkeypatch, tmp_path, source: Path, *extra: str) -> int:
    url = f"sqlite+pysqlite:///{(tmp_path / 'target.db').as_posix()}"
    monkeypatch.setattr(
        sys, "argv", ["migrate", "--source-db-path", str(source), "--target-database-url", url, *extra]
    )
    return script.main()


def _names(engine) -> list[str]:
    with engine.connect() as conn:
        return [r[0] for r in conn.execute(text("SELECT name FROM network_branches ORDER BY id"))]


def test_empty_source_never_wipes_a_filled_target(monkeypatch, tmp_path, target_engine):
    source = tmp_path / "src.db"
    _make_source(source, branches=0)
    with pytest.raises(SystemExit):
        _run(monkeypatch, tmp_path, source, "--execute", "--overwrite")
    assert _names(target_engine) == ["keep"]


def test_incomplete_source_aborts_before_touching_the_target(monkeypatch, tmp_path, target_engine):
    source = tmp_path / "src.db"
    _make_source(source, branches=2, drop="network_audit_log")
    with pytest.raises(SystemExit):
        _run(monkeypatch, tmp_path, source, "--execute", "--overwrite")
    assert _names(target_engine) == ["keep"]


def test_dry_run_and_missing_overwrite_change_nothing(monkeypatch, tmp_path, target_engine, capsys):
    source = tmp_path / "src.db"
    _make_source(source, branches=2)
    with pytest.raises(SystemExit):
        _run(monkeypatch, tmp_path, source, "--execute")  # non-empty target, no --overwrite
    assert _names(target_engine) == ["keep"]

    assert _run(monkeypatch, tmp_path, source, "--overwrite") == 0  # no --execute: report only
    assert "Dry-run" in capsys.readouterr().out
    assert _names(target_engine) == ["keep"]


def test_failing_insert_rolls_the_delete_back(monkeypatch, tmp_path, target_engine):
    source = tmp_path / "src.db"
    _make_source(source, branches=2)
    conn = sqlite3.connect(source)  # both rows named "dup": the 2nd INSERT violates the target UNIQUE
    conn.execute("UPDATE network_branches SET name = 'dup' WHERE id IN (1, 2)")
    conn.commit()
    conn.close()
    with pytest.raises(Exception):
        _run(monkeypatch, tmp_path, source, "--execute", "--overwrite")
    assert _names(target_engine) == ["keep"]


def test_explicit_execute_and_overwrite_replace_the_target(monkeypatch, tmp_path, target_engine):
    source = tmp_path / "src.db"
    _make_source(source, branches=3)
    assert _run(monkeypatch, tmp_path, source, "--execute", "--overwrite") == 0
    assert _names(target_engine) == ["b0", "b1", "b2"]
