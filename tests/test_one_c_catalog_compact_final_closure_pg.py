"""Final-closure PG matrix for 1C incremental compact — SAFE test DB ONLY.

Covers: deferred previous cleanup, CAS ordering, token_stats drift property
tests, out-of-order/concurrent benches, recovery shapes. Never touches prod.
"""
from __future__ import annotations

import os
import random
import re
import sys
import time
from concurrent.futures import ThreadPoolExecutor, as_completed
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
REQUIRED_DB = "hubit_chat_retention_test_20260804154706"
SOURCE = "inc_final_closure"
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
    chosen = REQUIRED_DB
    for key in ("APP_DATABASE_URL", "CHAT_DATABASE_URL"):
        value = (os.getenv(key) or file_env.get(key) or "").strip()
        if value:
            return _with_db(value, chosen)
    return None


def _sa_url(dsn: str) -> str:
    if dsn.startswith("postgresql://"):
        return "postgresql+psycopg://" + dsn[len("postgresql://") :]
    return dsn


def _assert_safe(conn) -> None:
    from sqlalchemy import text

    current = conn.execute(text("SELECT current_database()")).scalar_one()
    name = str(current)
    if name.casefold() in HARD_REJECT or not ALLOWED_RE.match(name):
        pytest.fail(f"REFUSED current_database()={name!r}")
    if name != REQUIRED_DB:
        pytest.skip(f"Stage requires {REQUIRED_DB}, got {name}")


@pytest.fixture(scope="module")
def pg_url():
    dsn = _resolve_dsn()
    if not dsn:
        pytest.skip("No allowed 1C search test DB configured")
    name = _db_name(dsn)
    if name.casefold() in HARD_REJECT or not ALLOWED_RE.match(name):
        pytest.fail(f"REFUSED unsafe DSN db={name!r}")
    import psycopg

    with psycopg.connect(dsn, autocommit=True) as conn:
        with conn.cursor() as cur:
            cur.execute("SELECT current_database()")
            current = cur.fetchone()[0]
    if str(current).casefold() in HARD_REJECT or not ALLOWED_RE.match(str(current)):
        pytest.fail(f"REFUSED current_database()={current!r}")
    if str(current) != REQUIRED_DB:
        pytest.skip(f"Stage requires {REQUIRED_DB}, got {current}")
    return _sa_url(dsn)


@pytest.fixture(scope="module")
def closure_env(pg_url):
    os.environ["APP_DATABASE_URL"] = pg_url
    os.environ["WAREHOUSE_1C_CATALOG_WRITE_COMPACT"] = "1"
    os.environ["WAREHOUSE_1C_CATALOG_SEARCH_ENGINE"] = "tokens"
    os.environ["WAREHOUSE_1C_CATALOG_SEARCH_CANARY_PERCENT"] = "0"
    os.environ["WAREHOUSE_1C_CATALOG_COMPACT_TOKEN_STATS_MODE"] = "delta"
    os.environ["WAREHOUSE_1C_CATALOG_COMPACT_INCREMENTAL_MAX_CHANGED_ROWS"] = "50000"
    os.environ["WAREHOUSE_1C_CATALOG_COMPACT_INCREMENTAL_MAX_CHANGED_PERCENT"] = "50"
    os.environ["WAREHOUSE_1C_CATALOG_COMPACT_PREVIOUS_CLEANUP_ENABLED"] = "0"
    os.environ["WAREHOUSE_1C_CATALOG_COMPACT_PREVIOUS_CLEANUP_DRY_RUN"] = "1"
    os.environ["WAREHOUSE_1C_CATALOG_COMPACT_ALLOW_CREATE_ALL"] = "1"
    os.environ["SKIP_PG_SCHEMA_DOCS"] = "1"

    from sqlalchemy import text
    from backend.appdb.db import get_app_engine, initialize_app_schema

    engine = get_app_engine(pg_url)
    with engine.begin() as conn:
        _assert_safe(conn)
        conn.execute(text('CREATE SCHEMA IF NOT EXISTS "app"'))
        conn.execute(text('CREATE SCHEMA IF NOT EXISTS "system"'))
        conn.execute(text("CREATE EXTENSION IF NOT EXISTS pg_trgm"))
    initialize_app_schema(pg_url, force=True)
    yield pg_url


def _cleanup(url: str) -> None:
    from sqlalchemy import text
    from backend.appdb.db import get_app_engine

    engine = get_app_engine(url)
    with engine.begin() as conn:
        _assert_safe(conn)
        for table in (
            "one_c_catalog_search_token_stats",
            "one_c_catalog_search_documents",
            "one_c_catalog_search_index_state",
            "one_c_catalog_tokens",
            "one_c_catalog_entries",
            "one_c_catalog_snapshots",
        ):
            conn.execute(
                text(f"DELETE FROM app.{table} WHERE source_base = :s"),
                {"s": SOURCE},
            )


def _rows(n: int, *, name_prefix: str = "Item") -> list[tuple[str, str, str]]:
    return [(f"r{i:06d}", f"C{i:06d}", f"{name_prefix} {i:06d}") for i in range(n)]


def _recompute_token_freqs(session, *, source_base: str, catalog_type: str, index_version: int):
    from sqlalchemy import text

    rows = session.execute(
        text(
            """
            SELECT search_text FROM app.one_c_catalog_search_documents
            WHERE source_base = :s AND catalog_type = :c AND index_version = :v
            """
        ),
        {"s": source_base, "c": catalog_type, "v": index_version},
    ).all()
    freqs: dict[str, int] = {}
    for (search_text,) in rows:
        seen: set[str] = set()
        for part in str(search_text or "").split():
            if len(part) >= 2 and part not in seen:
                seen.add(part)
                freqs[part] = freqs.get(part, 0) + 1
    return freqs


def _load_token_stats(session, *, source_base: str, catalog_type: str, index_version: int):
    from sqlalchemy import text

    rows = session.execute(
        text(
            """
            SELECT token, frequency FROM app.one_c_catalog_search_token_stats
            WHERE source_base = :s AND catalog_type = :c AND index_version = :v
              AND frequency > 0
            """
        ),
        {"s": source_base, "c": catalog_type, "v": index_version},
    ).all()
    return {str(t): int(f) for t, f in rows}


def test_pg_previous_not_deleted_during_incremental_patch(closure_env):
    """100k corpus: patch 100 refs; previous version docs deleted during patch = 0."""
    from sqlalchemy import text
    from backend.appdb.db import get_app_engine, get_app_session_factory
    from backend.services.one_c_catalog_compact_writer import (
        CompactCatalogPatch,
        OneCCatalogCompactWriter,
    )
    from backend.services.one_c_catalog_snapshot_service import OneCCatalogSnapshotStore

    url = closure_env
    _cleanup(url)
    store = OneCCatalogSnapshotStore(url)
    total = 100_000
    base = _rows(total)
    store.replace_snapshot(
        nomenclature=base,
        warehouses=[],
        source_base=SOURCE,
        nomenclature_fingerprint="fp-base",
        warehouses_fingerprint="",
    )

    engine = get_app_engine(url)
    with engine.begin() as conn:
        _assert_safe(conn)
        # Simulate a retained previous version (as after versioned switch).
        conn.execute(
            text(
                """
                INSERT INTO app.one_c_catalog_search_documents (
                    source_base, generation, catalog_type, index_version, entry_ref,
                    code_normalized, name_normalized, search_text, search_tsv,
                    created_at, updated_at
                )
                SELECT source_base, generation, catalog_type, 9, entry_ref,
                       code_normalized, name_normalized, search_text, search_tsv,
                       created_at, updated_at
                FROM app.one_c_catalog_search_documents
                WHERE source_base = :s AND catalog_type = :c
                  AND index_version = (
                    SELECT active_index_version
                    FROM app.one_c_catalog_search_index_state
                    WHERE source_base = :s AND catalog_type = :c
                  )
                LIMIT 500
                """
            ),
            {"s": SOURCE, "c": CATALOG},
        )
        conn.execute(
            text(
                """
                UPDATE app.one_c_catalog_search_index_state
                SET previous_index_version = 9,
                    previous_cleanup_after = NULL
                WHERE source_base = :s AND catalog_type = :c
                """
            ),
            {"s": SOURCE, "c": CATALOG},
        )
        prev_before = conn.execute(
            text(
                """
                SELECT COUNT(*) FROM app.one_c_catalog_search_documents
                WHERE source_base = :s AND catalog_type = :c AND index_version = 9
                """
            ),
            {"s": SOURCE, "c": CATALOG},
        ).scalar_one()
        assert int(prev_before) > 0

    # Patch 100 refs via writer directly (active version).
    factory = get_app_session_factory(url)
    writer = OneCCatalogCompactWriter(enabled=True)
    session = factory()
    try:
        _assert_safe(session.connection())
        state = session.execute(
            text(
                """
                SELECT active_index_version, source_fingerprint
                FROM app.one_c_catalog_search_index_state
                WHERE source_base = :s AND catalog_type = :c
                """
            ),
            {"s": SOURCE, "c": CATALOG},
        ).one()
        active = int(state[0])
        base_fp = str(state[1])
        upserts = tuple(
            (f"r{i:06d}", f"C{i:06d}", f"Patched {i:06d}") for i in range(100)
        )
        report = writer.apply_incremental_patch(
            session,
            source_base=SOURCE,
            generation=1,
            patch=CompactCatalogPatch(
                catalog_type=CATALOG,
                upserts=upserts,
                expected_count=total,
                changed_count=100,
                incoming_count=total,
                catalog_fingerprint="fp-patched",
                base_fingerprint=base_fp,
                sync_id="sync-closure-100",
            ),
        )
        session.commit()
        assert report.ok and report.outcome == "applied"
        assert report.documents_upserted == 100
    finally:
        session.close()

    with engine.connect() as conn:
        _assert_safe(conn)
        prev_after = conn.execute(
            text(
                """
                SELECT COUNT(*) FROM app.one_c_catalog_search_documents
                WHERE source_base = :s AND catalog_type = :c AND index_version = 9
                """
            ),
            {"s": SOURCE, "c": CATALOG},
        ).scalar_one()
        # Key proof: previous version untouched during ordinary incremental.
        assert int(prev_after) == int(prev_before)
        st = conn.execute(
            text(
                """
                SELECT previous_index_version, previous_cleanup_after, source_fingerprint
                FROM app.one_c_catalog_search_index_state
                WHERE source_base = :s AND catalog_type = :c
                """
            ),
            {"s": SOURCE, "c": CATALOG},
        ).one()
        assert int(st[0]) == 9
        assert st[1] is not None  # cleanup scheduled
        assert str(st[2]) == "fp-patched"
        active_docs = conn.execute(
            text(
                """
                SELECT COUNT(*) FROM app.one_c_catalog_search_documents
                WHERE source_base = :s AND catalog_type = :c AND index_version = :v
                """
            ),
            {"s": SOURCE, "c": CATALOG, "v": active},
        ).scalar_one()
        assert int(active_docs) == total

    out = ROOT / "tmp" / "hub-architecture-remediation" / "closure_previous_cleanup_100k.json"
    out.parent.mkdir(parents=True, exist_ok=True)
    out.write_text(
        (
            "{\n"
            f'  "db": "{REQUIRED_DB}",\n'
            f'  "prev_docs_before": {int(prev_before)},\n'
            f'  "prev_docs_after_patch": {int(prev_after)},\n'
            f'  "prev_deleted_during_patch": {int(prev_before) - int(prev_after)},\n'
            f'  "patched_refs": 100\n'
            "}\n"
        ),
        encoding="utf-8",
    )


def test_pg_cleanup_dry_run_then_controlled(closure_env):
    from datetime import datetime, timedelta, timezone

    from sqlalchemy import text
    from backend.appdb.db import get_app_session_factory
    from backend.services.one_c_catalog_compact_cleanup import (
        OneCCatalogCompactCleanupService,
    )

    url = closure_env
    factory = get_app_session_factory(url)
    session = factory()
    try:
        _assert_safe(session.connection())
        # Ensure grace elapsed for previous=9 from prior test (or seed).
        session.execute(
            text(
                """
                UPDATE app.one_c_catalog_search_index_state
                SET previous_cleanup_after = :past
                WHERE source_base = :s AND catalog_type = :c
                  AND previous_index_version = 9
                """
            ),
            {
                "s": SOURCE,
                "c": CATALOG,
                "past": datetime.now(timezone.utc) - timedelta(seconds=10),
            },
        )
        session.commit()

        dry = OneCCatalogCompactCleanupService(
            enabled=True, dry_run=True, batch_size=2000, max_batches=20
        )
        report_dry = dry.run_once(session)
        session.commit()
        assert report_dry.outcome == "dry_run"
        assert report_dry.documents_deleted > 0

        prev_before = session.execute(
            text(
                """
                SELECT COUNT(*) FROM app.one_c_catalog_search_documents
                WHERE source_base = :s AND index_version = 9
                """
            ),
            {"s": SOURCE},
        ).scalar_one()

        live = OneCCatalogCompactCleanupService(
            enabled=True,
            dry_run=False,
            batch_size=2000,
            max_batches=100,
            max_runtime_seconds=120,
            pause_ms=0,
        )
        report_live = live.run_once(session)
        session.commit()
        assert report_live.outcome == "cleaned"
        prev_after = session.execute(
            text(
                """
                SELECT COUNT(*) FROM app.one_c_catalog_search_documents
                WHERE source_base = :s AND index_version = 9
                """
            ),
            {"s": SOURCE},
        ).scalar_one()
        assert int(prev_after) == 0
        assert int(prev_before) > 0
        # Active untouched
        active = session.execute(
            text(
                """
                SELECT active_index_version FROM app.one_c_catalog_search_index_state
                WHERE source_base = :s AND catalog_type = :c
                """
            ),
            {"s": SOURCE, "c": CATALOG},
        ).scalar_one()
        active_n = session.execute(
            text(
                """
                SELECT COUNT(*) FROM app.one_c_catalog_search_documents
                WHERE source_base = :s AND index_version = :v
                """
            ),
            {"s": SOURCE, "v": int(active)},
        ).scalar_one()
        assert int(active_n) == 100_000
    finally:
        session.close()


def test_pg_cas_out_of_order_and_idempotent(closure_env):
    from sqlalchemy import text
    from backend.appdb.db import get_app_session_factory
    from backend.services.one_c_catalog_compact_writer import (
        CompactCatalogPatch,
        OneCCatalogCompactWriter,
    )

    url = closure_env
    factory = get_app_session_factory(url)
    writer = OneCCatalogCompactWriter(enabled=True)
    session = factory()
    try:
        _assert_safe(session.connection())
        state = session.execute(
            text(
                """
                SELECT source_fingerprint, checkpoint_ref, active_index_version
                FROM app.one_c_catalog_search_index_state
                WHERE source_base = :s AND catalog_type = :c
                """
            ),
            {"s": SOURCE, "c": CATALOG},
        ).one()
        current_fp = str(state[0])
        # Late/old patch based on fp-base while current is ahead.
        late = writer.apply_incremental_patch(
            session,
            source_base=SOURCE,
            generation=1,
            patch=CompactCatalogPatch(
                catalog_type=CATALOG,
                upserts=(("r000000", "C000000", "Late"),),
                expected_count=100_000,
                changed_count=1,
                incoming_count=100_000,
                catalog_fingerprint="fp-old-target",
                base_fingerprint="fp-base",
                sync_id="sync-late-ooo",
            ),
        )
        session.commit()
        assert late.outcome == "out_of_order"

        # Idempotent redelivery of current sync.
        sync_cur = str(state[1] or "sync-closure-100")
        noop = writer.apply_incremental_patch(
            session,
            source_base=SOURCE,
            generation=1,
            patch=CompactCatalogPatch(
                catalog_type=CATALOG,
                upserts=(("r000000", "C000000", "Ignored"),),
                expected_count=100_000,
                catalog_fingerprint=current_fp,
                base_fingerprint=current_fp,
                sync_id=sync_cur,
            ),
        )
        session.commit()
        assert noop.outcome == "noop"
    finally:
        session.close()


def test_pg_concurrent_patch_cas(closure_env):
    """Two threads race CAS; at most one applies a conflicting base→target."""
    from sqlalchemy import text
    from backend.appdb.db import get_app_session_factory
    from backend.services.one_c_catalog_compact_writer import (
        CompactCatalogPatch,
        OneCCatalogCompactWriter,
    )

    url = closure_env
    factory = get_app_session_factory(url)

    # Read current base.
    session = factory()
    try:
        _assert_safe(session.connection())
        base_fp = session.execute(
            text(
                """
                SELECT source_fingerprint FROM app.one_c_catalog_search_index_state
                WHERE source_base = :s AND catalog_type = :c
                """
            ),
            {"s": SOURCE, "c": CATALOG},
        ).scalar_one()
        base_fp = str(base_fp)
    finally:
        session.close()

    outcomes: list[str] = []

    def _race(target: str, sync: str) -> str:
        w = OneCCatalogCompactWriter(enabled=True)
        s = factory()
        try:
            report = w.apply_incremental_patch(
                s,
                source_base=SOURCE,
                generation=1,
                patch=CompactCatalogPatch(
                    catalog_type=CATALOG,
                    upserts=(("r000001", "C000001", f"Race {target}"),),
                    expected_count=100_000,
                    changed_count=1,
                    incoming_count=100_000,
                    catalog_fingerprint=target,
                    base_fingerprint=base_fp,
                    sync_id=sync,
                ),
            )
            s.commit()
            return report.outcome
        finally:
            s.close()

    with ThreadPoolExecutor(max_workers=2) as pool:
        futs = [
            pool.submit(_race, "fp-race-a", "sync-race-a"),
            pool.submit(_race, "fp-race-b", "sync-race-b"),
        ]
        for fut in as_completed(futs):
            outcomes.append(fut.result())

    applied = [o for o in outcomes if o == "applied"]
    rejected = [o for o in outcomes if o in {"out_of_order", "stale", "noop", "lock_skipped"}]
    assert len(applied) <= 1
    assert len(applied) + len(rejected) == 2


def test_pg_token_stats_randomized_drift_parity(closure_env):
    """≥1000 randomized micro-patches; frequency mismatches vs recompute = 0."""
    from sqlalchemy import text
    from backend.appdb.db import get_app_session_factory
    from backend.services.one_c_catalog_compact_writer import (
        CompactCatalogPatch,
        OneCCatalogCompactWriter,
    )

    url = closure_env
    # Use a smaller dedicated scope to keep runtime/RSS bounded.
    source = SOURCE + "_drift"
    factory = get_app_session_factory(url)
    writer = OneCCatalogCompactWriter(enabled=True)
    session = factory()
    rng = random.Random(20260805)
    n = 200
    try:
        _assert_safe(session.connection())
        session.execute(
            text("DELETE FROM app.one_c_catalog_search_documents WHERE source_base=:s"),
            {"s": source},
        )
        session.execute(
            text("DELETE FROM app.one_c_catalog_search_token_stats WHERE source_base=:s"),
            {"s": source},
        )
        session.execute(
            text("DELETE FROM app.one_c_catalog_search_index_state WHERE source_base=:s"),
            {"s": source},
        )
        session.execute(
            text("DELETE FROM app.one_c_catalog_entries WHERE source_base=:s"),
            {"s": source},
        )
        # Seed via incremental full_rebuild from synthetic entries.
        for i in range(n):
            session.execute(
                text(
                    """
                    INSERT INTO app.one_c_catalog_entries (
                        source_base, generation, catalog_type, ref, code, name,
                        code_normalized, name_normalized, created_at
                    ) VALUES (
                        CAST(:s AS varchar(64)), 1, 'nomenclature',
                        CAST(:ref AS varchar(64)),
                        CAST(:code AS varchar(200)),
                        CAST(:name AS text),
                        lower(CAST(:code AS varchar(200))),
                        lower(CAST(:name AS text)),
                        NOW()
                    )
                    """
                ),
                {
                    "s": source,
                    "ref": f"d{i:04d}",
                    "code": f"D{i:04d}",
                    "name": f"Drift Item {i:04d} tok{i % 17}",
                },
            )
        session.commit()
        bootstrap = writer.apply_incremental_patch(
            session,
            source_base=source,
            generation=1,
            patch=CompactCatalogPatch(
                catalog_type=CATALOG,
                expected_count=n,
                incoming_count=n,
                changed_count=n,
                catalog_fingerprint="fp-drift-0",
                sync_id="sync-drift-0",
                full_rebuild=True,
            ),
        )
        session.commit()
        assert bootstrap.ok

        state = session.execute(
            text(
                """
                SELECT active_index_version, source_fingerprint
                FROM app.one_c_catalog_search_index_state
                WHERE source_base = :s AND catalog_type = :c
                """
            ),
            {"s": source, "c": CATALOG},
        ).one()
        active = int(state[0])
        fp = str(state[1])
        # Align stats to writer scope semantics (no versioned MIN_FREQUENCY=2 filter)
        # so delta↔recompute parity is well-defined.
        writer.rebuild_token_stats(
            session,
            source_base=source,
            generation=1,
            catalog_type=CATALOG,
            index_version=active,
        )
        session.commit()
        mismatches = 0
        patches = 1200
        for step in range(patches):
            idx = rng.randrange(n)
            ref = f"d{idx:04d}"
            code = f"D{idx:04d}"
            name = f"Drift Item {idx:04d} tok{rng.randrange(30)} x{step % 9}"
            next_fp = f"fp-drift-{step + 1}"
            report = writer.apply_incremental_patch(
                session,
                source_base=source,
                generation=1,
                patch=CompactCatalogPatch(
                    catalog_type=CATALOG,
                    upserts=((ref, code, name),),
                    expected_count=n,
                    changed_count=1,
                    incoming_count=n,
                    catalog_fingerprint=next_fp,
                    base_fingerprint=fp,
                    sync_id=f"sync-drift-{step + 1}",
                ),
            )
            session.commit()
            assert report.ok, report.outcome
            if report.outcome == "applied":
                fp = next_fp
            # Spot-check every 100 patches + final.
            if (step + 1) % 100 == 0 or step + 1 == patches:
                expected = _recompute_token_freqs(
                    session,
                    source_base=source,
                    catalog_type=CATALOG,
                    index_version=active,
                )
                actual = _load_token_stats(
                    session,
                    source_base=source,
                    catalog_type=CATALOG,
                    index_version=active,
                )
                if expected != actual:
                    mismatches += 1
        assert mismatches == 0
        out = ROOT / "tmp" / "hub-architecture-remediation" / "closure_token_stats_drift.json"
        out.write_text(
            (
                "{\n"
                f'  "patches": {patches},\n'
                f'  "frequency_mismatches": {mismatches},\n'
                f'  "corpus": {n}\n'
                "}\n"
            ),
            encoding="utf-8",
        )
    finally:
        try:
            session.rollback()
        except Exception:
            pass
        try:
            for table in (
                "one_c_catalog_search_token_stats",
                "one_c_catalog_search_documents",
                "one_c_catalog_search_index_state",
                "one_c_catalog_entries",
            ):
                session.execute(
                    text(f"DELETE FROM app.{table} WHERE source_base=:s"),
                    {"s": source},
                )
            session.commit()
        except Exception:
            try:
                session.rollback()
            except Exception:
                pass
        session.close()


def test_pg_token_stats_delta_sql_exception_savepoint(closure_env):
    """Force delta SQL failure → savepoint rollback → scope rebuild succeeds."""
    from unittest.mock import patch

    from sqlalchemy import text
    from backend.appdb.db import get_app_session_factory
    from backend.services.one_c_catalog_compact_writer import (
        CompactCatalogPatch,
        OneCCatalogCompactWriter,
    )

    url = closure_env
    source = SOURCE + "_delta_exc"
    factory = get_app_session_factory(url)
    writer = OneCCatalogCompactWriter(enabled=True)
    session = factory()
    try:
        _assert_safe(session.connection())
        for table in (
            "one_c_catalog_search_token_stats",
            "one_c_catalog_search_documents",
            "one_c_catalog_search_index_state",
            "one_c_catalog_entries",
        ):
            session.execute(
                text(f"DELETE FROM app.{table} WHERE source_base=:s"),
                {"s": source},
            )
        session.execute(
            text(
                """
                INSERT INTO app.one_c_catalog_entries (
                    source_base, generation, catalog_type, ref, code, name,
                    code_normalized, name_normalized, created_at
                ) VALUES
                (:s, 1, 'nomenclature', 'x1', 'X1', 'Alpha Beta', 'x1', 'alpha beta', NOW()),
                (:s, 1, 'nomenclature', 'x2', 'X2', 'Gamma Delta', 'x2', 'gamma delta', NOW())
                """
            ),
            {"s": source},
        )
        session.commit()
        boot = writer.apply_incremental_patch(
            session,
            source_base=source,
            generation=1,
            patch=CompactCatalogPatch(
                catalog_type=CATALOG,
                expected_count=2,
                incoming_count=2,
                changed_count=2,
                catalog_fingerprint="fp-x0",
                sync_id="sync-x0",
                full_rebuild=True,
            ),
        )
        session.commit()
        assert boot.ok

        def _boom(*_a, **_k):
            raise RuntimeError("synthetic_delta_sql_failure")

        with patch.object(writer, "apply_token_stats_delta", side_effect=_boom):
            report = writer.apply_incremental_patch(
                session,
                source_base=source,
                generation=1,
                patch=CompactCatalogPatch(
                    catalog_type=CATALOG,
                    upserts=(("x1", "X1", "Alpha Zeta"),),
                    expected_count=2,
                    changed_count=1,
                    incoming_count=2,
                    catalog_fingerprint="fp-x1",
                    base_fingerprint="fp-x0",
                    sync_id="sync-x1",
                ),
            )
            session.commit()
        assert report.ok and report.outcome == "applied"
        assert report.token_stats_mode == "scope"
        active = session.execute(
            text(
                """
                SELECT active_index_version FROM app.one_c_catalog_search_index_state
                WHERE source_base = :s AND catalog_type = :c
                """
            ),
            {"s": source, "c": CATALOG},
        ).scalar_one()
        expected = _recompute_token_freqs(
            session, source_base=source, catalog_type=CATALOG, index_version=int(active)
        )
        actual = _load_token_stats(
            session, source_base=source, catalog_type=CATALOG, index_version=int(active)
        )
        assert expected == actual
    finally:
        for table in (
            "one_c_catalog_search_token_stats",
            "one_c_catalog_search_documents",
            "one_c_catalog_search_index_state",
            "one_c_catalog_entries",
        ):
            session.execute(
                text(f"DELETE FROM app.{table} WHERE source_base=:s"),
                {"s": source},
            )
        session.commit()
        session.close()


def test_pg_startup_no_unexpected_compact_ddl_when_disallowed(closure_env):
    """With ALLOW_CREATE_ALL=0, create_all path skips compact tables."""
    from backend.appdb import db as appdb_db

    assert appdb_db._compact_create_all_allowed() is True  # fixture opted in
    os.environ["WAREHOUSE_1C_CATALOG_COMPACT_ALLOW_CREATE_ALL"] = "0"
    try:
        assert appdb_db._compact_create_all_allowed() is False
    finally:
        os.environ["WAREHOUSE_1C_CATALOG_COMPACT_ALLOW_CREATE_ALL"] = "1"
