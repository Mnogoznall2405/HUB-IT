"""PG chaos / versioned rebuild tests — SAFE test DB only."""
from __future__ import annotations

import os
import re
import sys
import time
from pathlib import Path
from urllib.parse import unquote, urlparse, urlunparse

import pytest


ROOT = Path(__file__).resolve().parents[1]
WEB_ROOT = ROOT / "WEB-itinvent"
if str(WEB_ROOT) not in sys.path:
    sys.path.insert(0, str(WEB_ROOT))

HARD_REJECT = frozenset({"hubit_chat", "postgres", "template0", "template1"})
ALLOWED_RE = re.compile(
    r"^(hubit_chat_retention_test_.+|hubit_chat_1c_search_test_.+)$",
    re.IGNORECASE,
)
SOURCE = "bench_ver_rebuild"
CATALOG = "nomenclature"


def _normalize_url(raw: str) -> str:
    text = (raw or "").strip()
    for prefix in ("postgresql+psycopg://", "postgresql+psycopg2://"):
        if text.startswith(prefix):
            return "postgresql://" + text[len(prefix) :]
    return text


def _db_name(url: str) -> str:
    return unquote(urlparse(_normalize_url(url)).path or "").lstrip("/").split("/")[0]


def _with_db(url: str, database: str) -> str:
    return urlunparse(urlparse(_normalize_url(url))._replace(path="/" + database))


def _load_dotenv() -> dict[str, str]:
    path = ROOT / ".env"
    env: dict[str, str] = {}
    if not path.is_file():
        return env
    for line in path.read_text(encoding="utf-8", errors="replace").splitlines():
        text = line.strip()
        if not text or text.startswith("#") or "=" not in text:
            continue
        key, value = text.split("=", 1)
        value = value.strip()
        if len(value) >= 2 and value[0] == value[-1] and value[0] in "\"'":
            value = value[1:-1]
        env[key.strip()] = value
    return env


def _resolve_dsn() -> str | None:
    for key in ("ONE_C_SEARCH_TEST_DATABASE_URL", "TEST_DATABASE_URL"):
        value = (os.getenv(key) or "").strip()
        if value:
            return _normalize_url(value)
    file_env = _load_dotenv()
    for key in ("ONE_C_SEARCH_TEST_DATABASE_URL", "TEST_DATABASE_URL"):
        value = (file_env.get(key) or "").strip()
        if value:
            return _normalize_url(value)
    chosen_path = ROOT / "tmp" / "one_c_search_benchmark" / "results" / "chosen_test_db.txt"
    chosen = chosen_path.read_text(encoding="utf-8").strip() if chosen_path.is_file() else ""
    if not chosen or not ALLOWED_RE.match(chosen):
        return None
    for key in ("APP_DATABASE_URL", "CHAT_DATABASE_URL"):
        value = (os.getenv(key) or file_env.get(key) or "").strip()
        if value:
            return _with_db(value, chosen)
    return None


def _sa_url(dsn: str) -> str:
    if dsn.startswith("postgresql://"):
        return "postgresql+psycopg://" + dsn[len("postgresql://") :]
    return dsn


@pytest.fixture(scope="module")
def pg_dsn():
    dsn = _resolve_dsn()
    if not dsn:
        pytest.skip("No SAFE 1C search test DB configured")
    name = _db_name(dsn)
    if name.casefold() in HARD_REJECT or not ALLOWED_RE.match(name):
        pytest.skip(f"Refused unsafe db={name}")
    import psycopg

    with psycopg.connect(dsn, autocommit=True) as conn:
        with conn.cursor() as cur:
            cur.execute("SELECT current_database()")
            current = str(cur.fetchone()[0])
    if current.casefold() in HARD_REJECT or not ALLOWED_RE.match(current):
        pytest.skip(f"Refused current_database={current}")
    # Ensure versioned columns exist (0081 applied on test DB only).
    with psycopg.connect(dsn, autocommit=True) as conn:
        with conn.cursor() as cur:
            cur.execute(
                """
                SELECT 1 FROM information_schema.columns
                WHERE table_schema='app'
                  AND table_name='one_c_catalog_search_index_state'
                  AND column_name='active_index_version'
                """
            )
            if cur.fetchone() is None:
                pytest.skip("0081 versioned columns missing on test DB — apply migration first")
    return dsn


@pytest.fixture()
def session_factory(pg_dsn, monkeypatch):
    sa = _sa_url(pg_dsn)
    monkeypatch.setenv("APP_DATABASE_URL", sa)
    monkeypatch.setenv("WAREHOUSE_1C_CATALOG_WRITE_COMPACT", "1")
    from backend.appdb.db import get_app_session_factory

    return get_app_session_factory(sa)


def _cleanup(session):
    from sqlalchemy import text

    for table in (
        "one_c_catalog_search_token_stats",
        "one_c_catalog_search_documents",
        "one_c_catalog_search_index_state",
        "one_c_catalog_tokens",
        "one_c_catalog_entries",
        "one_c_catalog_snapshots",
    ):
        session.execute(
            text(f"DELETE FROM app.{table} WHERE source_base = :s"),
            {"s": SOURCE},
        )
    session.commit()


def _seed_entries(session, n: int = 200, *, mutate_pct: float = 0.0):
    from sqlalchemy import text

    session.execute(
        text(
            """
            INSERT INTO app.one_c_catalog_snapshots (
                source_base, active_generation,
                nomenclature_count, warehouses_count,
                nomenclature_truncated, warehouses_truncated,
                nomenclature_fingerprint, warehouses_fingerprint,
                updated_at, last_attempt_at, last_error, created_at
            ) VALUES (
                :s, 1, :n, 0, false, false, 'fp', 'fp',
                NOW(), NOW(), '', NOW()
            )
            ON CONFLICT (source_base) DO UPDATE SET
                active_generation=1,
                nomenclature_count=EXCLUDED.nomenclature_count,
                updated_at=NOW()
            """
        ),
        {"s": SOURCE, "n": n},
    )
    for i in range(n):
        name = f"Item {i} Model M-{i % 20} Ippon Алёна"
        if mutate_pct > 0 and i < int(n * mutate_pct):
            name = f"Changed {i} Model M-{i % 20} Ups"
        session.execute(
            text(
                """
                INSERT INTO app.one_c_catalog_entries (
                    source_base, generation, catalog_type, ref, code, name,
                    code_normalized, name_normalized, created_at
                ) VALUES (
                    :s, 1, :c, :ref, :code, :name,
                    lower(:code), lower(replace(:name, 'ё', 'е')), NOW()
                )
                ON CONFLICT (source_base, generation, catalog_type, ref)
                DO UPDATE SET name=EXCLUDED.name, name_normalized=EXCLUDED.name_normalized
                """
            ),
            {
                "s": SOURCE,
                "c": CATALOG,
                "ref": f"r{i:06d}",
                "code": f"C{i:05d}",
                "name": name,
            },
        )
    session.commit()


def test_pg_versioned_noop_and_build_and_rollback(session_factory):
    from backend.services.one_c_catalog_compact_rebuild import (
        OneCCatalogCompactVersionedRebuild,
    )
    from backend.services.one_c_catalog_compact_search import OneCCatalogCompactSearch
    from backend.services.one_c_catalog_compact_flags import parse_compact_flags
    from sqlalchemy import text

    session = session_factory()
    try:
        _cleanup(session)
        _seed_entries(session, 120)
        orch = OneCCatalogCompactVersionedRebuild(enabled=True, cleanup_grace_seconds=0)
        r1 = orch.rebuild_after_sync(
            session,
            source_base=SOURCE,
            generation=1,
            catalog_type=CATALOG,
            expected_count=120,
        )
        session.commit()
        assert r1.ok and r1.outcome == "built"
        assert r1.active_index_version == 1
        v1 = r1.active_index_version

        # Active serves during / after build
        flags = parse_compact_flags({"WAREHOUSE_1C_CATALOG_SEARCH_ENGINE": "compact"})
        searcher = OneCCatalogCompactSearch(flags=flags)
        assert searcher.is_ready(
            session, source_base=SOURCE, catalog_type=CATALOG, generation=1
        )
        hit = searcher.search_entries_on_session(
            session,
            catalog_type=CATALOG,
            text_query="C00010",
            limit=5,
            source_base=SOURCE,
            generation=1,
        )
        assert hit.ready and hit.rows

        # Fingerprint no_op
        r2 = orch.rebuild_after_sync(
            session,
            source_base=SOURCE,
            generation=1,
            catalog_type=CATALOG,
            expected_count=120,
        )
        session.commit()
        assert r2.outcome == "no_op"
        assert r2.active_index_version == v1

        # Changed sync → new version; old remains until cleanup
        _seed_entries(session, 120, mutate_pct=0.1)
        r3 = orch.rebuild_after_sync(
            session,
            source_base=SOURCE,
            generation=1,
            catalog_type=CATALOG,
            expected_count=120,
        )
        session.commit()
        assert r3.outcome == "built"
        assert r3.active_index_version == v1 + 1
        assert r3.previous_index_version == v1
        old_count = session.execute(
            text(
                """
                SELECT COUNT(*) FROM app.one_c_catalog_search_documents
                WHERE source_base=:s AND catalog_type=:c AND index_version=:v
                """
            ),
            {"s": SOURCE, "c": CATALOG, "v": v1},
        ).scalar_one()
        assert int(old_count) == 120

        # Injected failure keeps previous ready
        r4 = orch.rebuild_after_sync(
            session,
            source_base=SOURCE,
            generation=1,
            catalog_type=CATALOG,
            expected_count=120,
            force=True,
            inject_fail_before_switch=True,
        )
        session.commit()
        assert r4.outcome == "failed"
        assert searcher.is_ready(
            session, source_base=SOURCE, catalog_type=CATALOG, generation=1
        )
        state = session.execute(
            text(
                """
                SELECT active_index_version, status
                FROM app.one_c_catalog_search_index_state
                WHERE source_base=:s AND catalog_type=:c
                """
            ),
            {"s": SOURCE, "c": CATALOG},
        ).mappings().one()
        assert int(state["active_index_version"]) == r3.active_index_version
        assert state["status"] == "ready"

        # Cleanup previous after grace (0)
        deleted = orch.cleanup_previous_versions(
            session, source_base=SOURCE, catalog_type=CATALOG, force=True
        )
        session.commit()
        assert deleted == 120
    finally:
        _cleanup(session)
        session.close()


def test_pg_lock_skipped_parallel(session_factory, pg_dsn):
    import psycopg
    from backend.services.one_c_catalog_compact_rebuild import (
        REBUILD_ADVISORY_LOCK_KEY,
        OneCCatalogCompactVersionedRebuild,
    )

    session = session_factory()
    try:
        _cleanup(session)
        _seed_entries(session, 40)
        with psycopg.connect(pg_dsn, autocommit=True) as holder:
            with holder.cursor() as cur:
                cur.execute(f"SELECT pg_try_advisory_lock({int(REBUILD_ADVISORY_LOCK_KEY)})")
                assert cur.fetchone()[0] is True
            orch = OneCCatalogCompactVersionedRebuild(enabled=True)
            report = orch.rebuild_after_sync(
                session,
                source_base=SOURCE,
                generation=1,
                catalog_type=CATALOG,
                expected_count=40,
            )
            assert report.outcome == "lock_skipped"
            with holder.cursor() as cur:
                cur.execute(f"SELECT pg_advisory_unlock({int(REBUILD_ADVISORY_LOCK_KEY)})")
    finally:
        _cleanup(session)
        session.close()


def test_pg_routing_user_key_metrics_path(session_factory, monkeypatch):
    from backend.services.one_c_catalog_compact_flags import opaque_routing_user_key
    from backend.services.one_c_catalog_compact_rebuild import (
        OneCCatalogCompactVersionedRebuild,
    )
    from backend.services.one_c_catalog_compact_search import CANARY_ROUTE_METRICS
    from backend.services.one_c_catalog_snapshot_service import OneCCatalogSnapshotStore

    session = session_factory()
    try:
        _cleanup(session)
        _seed_entries(session, 60)
        orch = OneCCatalogCompactVersionedRebuild(enabled=True)
        report = orch.rebuild_after_sync(
            session,
            source_base=SOURCE,
            generation=1,
            catalog_type=CATALOG,
            expected_count=60,
        )
        session.commit()
        assert report.outcome == "built"

        monkeypatch.setenv("WAREHOUSE_1C_CATALOG_SEARCH_ENGINE", "tokens")
        monkeypatch.setenv("WAREHOUSE_1C_CATALOG_SEARCH_CANARY_PERCENT", "100")
        store = OneCCatalogSnapshotStore()
        key = opaque_routing_user_key(99)
        before = CANARY_ROUTE_METRICS["canary_selected"]
        ok, rows = store.search_entries(
            catalog_type=CATALOG,
            text="C00001",
            limit=5,
            source_base=SOURCE,
            routing_user_key=key,
        )
        assert ok is True
        assert rows
        assert CANARY_ROUTE_METRICS["canary_selected"] >= before + 1
        # No raw id in key
        assert "99" not in key
    finally:
        _cleanup(session)
        session.close()


def test_pg_critical_fn_semantics(session_factory):
    from backend.services.one_c_catalog_compact_flags import parse_compact_flags
    from backend.services.one_c_catalog_compact_rebuild import (
        OneCCatalogCompactVersionedRebuild,
    )
    from backend.services.one_c_catalog_compact_search import OneCCatalogCompactSearch
    from sqlalchemy import text

    session = session_factory()
    try:
        _cleanup(session)
        # Seed critical cases
        session.execute(
            text(
                """
                INSERT INTO app.one_c_catalog_snapshots (
                    source_base, active_generation,
                    nomenclature_count, warehouses_count,
                    nomenclature_truncated, warehouses_truncated,
                    nomenclature_fingerprint, warehouses_fingerprint,
                    updated_at, last_attempt_at, last_error, created_at
                ) VALUES (
                    :s, 1, 5, 0, false, false, 'fp', 'fp',
                    NOW(), NOW(), '', NOW()
                )
                ON CONFLICT (source_base) DO UPDATE SET active_generation=1, updated_at=NOW()
                """
            ),
            {"s": SOURCE},
        )
        rows = [
            ("r1", "M-70", "Smart UPS Алёна"),
            ("r2", "PP01", "Ippon Back"),
            ("r3", "X99", "Cable HDMI 2.0"),
            ("r4", "Ё12", "Ёлка Test"),
            ("r5", "AB12", "Multi Word Match"),
        ]
        for ref, code, name in rows:
            session.execute(
                text(
                    """
                    INSERT INTO app.one_c_catalog_entries (
                        source_base, generation, catalog_type, ref, code, name,
                        code_normalized, name_normalized, created_at
                    ) VALUES (
                        :s, 1, :c, :ref, :code, :name,
                        lower(:code), lower(replace(:name, 'ё', 'е')), NOW()
                    )
                    ON CONFLICT (source_base, generation, catalog_type, ref) DO NOTHING
                    """
                ),
                {"s": SOURCE, "c": CATALOG, "ref": ref, "code": code, "name": name},
            )
        session.commit()
        orch = OneCCatalogCompactVersionedRebuild(enabled=True)
        report = orch.rebuild_after_sync(
            session,
            source_base=SOURCE,
            generation=1,
            catalog_type=CATALOG,
            expected_count=5,
        )
        session.commit()
        assert report.outcome == "built"
        flags = parse_compact_flags({"WAREHOUSE_1C_CATALOG_SEARCH_ENGINE": "compact"})
        searcher = OneCCatalogCompactSearch(flags=flags)

        def refs(q: str) -> set[str]:
            result = searcher.search_entries_on_session(
                session,
                catalog_type=CATALOG,
                text_query=q,
                limit=20,
                source_base=SOURCE,
                generation=1,
            )
            assert result.ready
            return {row["ref"] for row in result.rows}

        assert "r1" in refs("m70")
        assert "r1" in refs("M-70")
        assert "r2" in refs("PP")  # 2-char prefix
        assert "r4" in refs("елка") or "r4" in refs("ёлка")
        assert "r5" in refs("multi word")
    finally:
        _cleanup(session)
        session.close()
