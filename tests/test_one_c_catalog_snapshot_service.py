from __future__ import annotations

import asyncio
import sys
from pathlib import Path
from types import SimpleNamespace

import pytest
from fastapi import HTTPException
from sqlalchemy import select
from sqlalchemy.dialects import postgresql


ROOT = Path(__file__).resolve().parents[1]
WEB_ROOT = ROOT / "WEB-itinvent"
if str(WEB_ROOT) not in sys.path:
    sys.path.insert(0, str(WEB_ROOT))

from backend.services.one_c_catalog_snapshot_service import (  # noqa: E402
    CATALOG_NOMENCLATURE,
    OneCCatalogSnapshotStore,
)
from backend.services.one_c_catalog_search import catalog_rows_fingerprint  # noqa: E402
from backend.appdb.db import app_session, initialize_app_schema  # noqa: E402
from backend.appdb.models import AppOneCCatalogEntry, AppOneCCatalogToken  # noqa: E402
from backend.api.v1.warehouse_1c import _run_or_raise  # noqa: E402
from backend.services.warehouse_1c_service import (  # noqa: E402
    Warehouse1CCatalogUnavailableError,
    Warehouse1CService,
    background_warehouse_1c_catalog_sync_loop,
)


def _store(temp_dir) -> OneCCatalogSnapshotStore:
    database_url = f"sqlite:///{(Path(temp_dir) / 'one_c_catalog.db').as_posix()}"
    initialize_app_schema(database_url)
    return OneCCatalogSnapshotStore(database_url)


def _seed(store: OneCCatalogSnapshotStore):
    return store.replace_snapshot(
        nomenclature=[
            ("nom-1", "PN-101", "Ippon Back Basic 800"),
            ("nom-2", "PN-650", "Ippon Back Basic 650"),
            ("nom-3", "APC-9", "APC Smart UPS"),
        ],
        warehouses=[
            ("wh-1", "Склад Иванов И.И."),
            ("wh-2", "Основной склад"),
        ],
    )


def test_postgres_snapshot_batches_use_copy_in_the_current_transaction():
    written = []

    class Copy:
        def __enter__(self):
            return self

        def __exit__(self, *_args):
            return False

        def write_row(self, row):
            written.append(row)

    class Cursor:
        def __enter__(self):
            return self

        def __exit__(self, *_args):
            return False

        def copy(self, sql):
            assert sql == "COPY app.example (first, second) FROM STDIN"
            return Copy()

    driver = SimpleNamespace(cursor=lambda: Cursor())
    raw_connection = SimpleNamespace(driver_connection=driver)

    class Session:
        def get_bind(self):
            return SimpleNamespace(dialect=SimpleNamespace(name="postgresql"))

        def connection(self):
            return SimpleNamespace(connection=raw_connection)

    copied = OneCCatalogSnapshotStore._copy_rows(
        Session(),
        table="example",
        columns=("first", "second"),
        rows=[{"first": "a", "second": 1}, {"first": "b", "second": 2}],
    )

    assert copied is True
    assert written == [("a", 1), ("b", 2)]


def test_postgres_catalog_tie_break_uses_stable_binary_collation():
    expression = OneCCatalogSnapshotStore._stable_order_column(
        AppOneCCatalogEntry.name_normalized,
        "postgresql",
    )
    compiled = str(expression.compile(dialect=postgresql.dialect()))

    assert 'COLLATE "C"' in compiled


def test_catalog_snapshot_search_lookup_and_generation_are_indexed(temp_dir):
    store = _store(temp_dir)
    status = _seed(store)

    assert status is not None
    assert status["has_snapshot"] is True
    assert status["nomenclature_count"] == 3
    assert status["warehouses_count"] == 2

    available, rows = store.search_entries(
        catalog_type=CATALOG_NOMENCLATURE,
        text="Ippon 800",
        limit=20,
    )
    assert available is True
    assert [row["ref"] for row in rows] == ["nom-1"]

    # Typeahead still works on a token substring, without deserialising the
    # whole catalogue into a process-local Python index.
    available, rows = store.search_entries(
        catalog_type=CATALOG_NOMENCLATURE,
        text="ppo",
        limit=20,
    )
    assert available is True
    assert {row["ref"] for row in rows} == {"nom-1", "nom-2"}

    available, codes = store.lookup_nomenclature_codes(["pn-101", "missing"])
    assert available is True
    assert codes["pn-101"]["ref"] == "nom-1"

    previous_generation = status["generation"]
    store.replace_snapshot(
        nomenclature=[("nom-new", "NEW-1", "New catalogue row")],
        warehouses=[("wh-new", "Новый склад")],
    )
    updated = store.get_status()
    assert updated is not None
    assert updated["generation"] == previous_generation
    available, old = store.lookup_entry(catalog_type=CATALOG_NOMENCLATURE, ref="nom-1")
    assert available is True
    assert old is None


def test_catalog_snapshot_reads_never_initialize_app_schema(temp_dir, monkeypatch):
    store = _store(temp_dir)
    _seed(store)

    def fail_schema_init(*_args, **_kwargs):
        raise AssertionError("catalogue reads must not initialize the app schema")

    monkeypatch.setattr("backend.appdb.db.initialize_app_schema", fail_schema_init)

    status = store.get_status()
    available, rows = store.search_entries(
        catalog_type=CATALOG_NOMENCLATURE,
        text="Ippon",
        limit=20,
    )
    lookup_available, item = store.lookup_entry(
        catalog_type=CATALOG_NOMENCLATURE,
        ref="nom-1",
    )

    assert status["has_snapshot"] is True
    assert available is True
    assert {row["ref"] for row in rows} == {"nom-1", "nom-2"}
    assert lookup_available is True
    assert item["ref"] == "nom-1"


def test_warehouse_service_uses_app_catalog_without_python_cache(temp_dir):
    store = _store(temp_dir)
    _seed(store)
    service = Warehouse1CService(enable_process_bridge=False, catalog_snapshot_store=store)
    try:
        assert service._nomenclature_cache == []
        assert service._word_frequency_index == {}

        rows = asyncio.run(service.search_nomenclature("Ippon 800"))
        assert [row["ref"] for row in rows] == ["nom-1"]
        assert service._nomenclature_cache == []

        assert service.lookup_nomenclature_ref("nom-1") == {
            "ref": "nom-1",
            "code": "PN-101",
            "name": "Ippon Back Basic 800",
        }
        suggestion = asyncio.run(service.suggest_nomenclature("Ippon 800"))
        assert [row["ref"] for row in suggestion["results"]] == ["nom-1"]
        assert service.get_catalog_status()["source"] == "app_db_indexed_snapshot"
    finally:
        service.shutdown()


def test_app_snapshot_and_memory_fallback_return_the_same_ranking(temp_dir):
    entries = [
        ("nom-1", "PN-101", "Ippon Back Basic 800"),
        ("nom-2", "PN-650", "Ippon Back Basic 650"),
        ("nom-3", "APC-9", "APC Smart UPS"),
    ]
    app_store = _store(temp_dir)
    app_store.replace_snapshot(nomenclature=entries, warehouses=[])

    class MemoryJsonStore:
        def load_json(self, _name, default_content=None):
            return {
                "nomenclature": [list(row) for row in entries],
                "warehouses": [],
                "updated_at": "2026-07-13T10:00:00+00:00",
                "last_error": "",
            }

        def save_json(self, _name, _payload):
            raise AssertionError("search must not write")

    class EmptySnapshotStore:
        enabled = True

        def get_status(self, **_kwargs):
            return {"available": True, "has_snapshot": False, "last_error": ""}

    app_service = Warehouse1CService(enable_process_bridge=False, catalog_snapshot_store=app_store)
    memory_service = Warehouse1CService(
        data_manager=MemoryJsonStore(),
        enable_process_bridge=False,
        catalog_snapshot_store=EmptySnapshotStore(),
    )
    try:
        app_rows = asyncio.run(app_service.search_nomenclature("Ippon"))
        memory_rows = asyncio.run(memory_service.search_nomenclature("Ippon"))
    finally:
        app_service.shutdown()
        memory_service.shutdown()

    assert [row["ref"] for row in app_rows] == [row["ref"] for row in memory_rows]


def test_empty_app_snapshot_uses_memory_fallback_without_db_search():
    class MemoryJsonStore:
        def load_json(self, _name, default_content=None):
            return {
                "nomenclature": [["wanted", "LEN-M70Q", "Lenovo ThinkCentre Tiny M70q"]],
                "warehouses": [["wh-1", "Основной склад"]],
                "updated_at": "2026-07-13T10:00:00+00:00",
                "last_attempt_at": "2026-07-13T10:00:00+00:00",
                "last_error": "",
            }

        def save_json(self, _name, _payload):
            raise AssertionError("search must not write the legacy cache")

    class EmptySnapshotStore:
        enabled = True

        def __init__(self):
            self.search_calls = 0

        def get_status(self, **_kwargs):
            return {
                "available": True,
                "has_snapshot": False,
                "nomenclature_count": 0,
                "warehouses_count": 0,
                "last_error": "",
            }

        def search_entries(self, **_kwargs):
            self.search_calls += 1
            return False, []

    snapshot_store = EmptySnapshotStore()
    service = Warehouse1CService(
        data_manager=MemoryJsonStore(),
        enable_process_bridge=False,
        catalog_snapshot_store=snapshot_store,
    )
    try:
        result_sets = [
            asyncio.run(service.search_nomenclature(query))
            for query in ("m70", "M70", "m-70", "M 70")
        ]
        status = service.get_catalog_status()
    finally:
        service.shutdown()

    assert all([row["ref"] for row in rows] == ["wanted"] for rows in result_sets)
    assert snapshot_store.search_calls == 0
    assert status["read_mode"] == "memory_fallback"
    assert status["fallback_reason"] == "snapshot_empty"


def test_autocomplete_fails_fast_when_no_catalog_source_exists(monkeypatch):
    class EmptyJsonStore:
        def load_json(self, _name, default_content=None):
            return dict(default_content or {})

        def save_json(self, _name, _payload):
            raise AssertionError("autocomplete must stay read-only")

    class EmptySnapshotStore:
        enabled = True

        def get_status(self, **_kwargs):
            return {"available": True, "has_snapshot": False, "last_error": ""}

    service = Warehouse1CService(
        data_manager=EmptyJsonStore(),
        enable_process_bridge=False,
        catalog_snapshot_store=EmptySnapshotStore(),
    )

    async def fail_live_com(*_args, **_kwargs):
        raise AssertionError("autocomplete must not fall back to live COM")

    monkeypatch.setattr(service, "_run_pooled", fail_live_com)
    try:
        with pytest.raises(Warehouse1CCatalogUnavailableError):
            asyncio.run(service.search_nomenclature("m70"))
    finally:
        service.shutdown()


def test_catalog_unavailable_maps_to_http_503():
    async def unavailable():
        raise Warehouse1CCatalogUnavailableError("refresh required")

    with pytest.raises(HTTPException) as exc_info:
        asyncio.run(_run_or_raise(unavailable()))

    assert exc_info.value.status_code == 503
    assert exc_info.value.detail == {
        "code": "catalog_unavailable",
        "message": "refresh required",
    }


def test_snapshot_query_failure_stays_on_memory_fallback_during_cooldown():
    class MemoryJsonStore:
        def load_json(self, _name, default_content=None):
            return {
                "nomenclature": [["wanted", "LEN-M70Q", "Lenovo ThinkCentre Tiny M70q"]],
                "warehouses": [],
                "updated_at": "2026-07-13T10:00:00+00:00",
                "last_error": "",
            }

        def save_json(self, _name, _payload):
            raise AssertionError("search must not write")

    class FailingSnapshotStore:
        enabled = True

        def __init__(self):
            self.search_calls = 0

        def get_status(self, **_kwargs):
            return {
                "available": True,
                "has_snapshot": True,
                "generation": 1,
                "nomenclature_count": 1,
                "warehouses_count": 0,
                "updated_at": "2026-07-13T10:00:00+00:00",
                "last_error": "",
            }

        def search_entries(self, **_kwargs):
            self.search_calls += 1
            return False, []

    snapshot_store = FailingSnapshotStore()
    service = Warehouse1CService(
        data_manager=MemoryJsonStore(),
        enable_process_bridge=False,
        catalog_snapshot_store=snapshot_store,
    )
    try:
        first = asyncio.run(service.search_nomenclature("m70"))
        second = asyncio.run(service.search_nomenclature("M70"))
        status = service.get_catalog_status()
    finally:
        service.shutdown()

    assert first == second
    assert snapshot_store.search_calls == 1
    assert status["read_mode"] == "memory_fallback"
    assert status["fallback_reason"] == "snapshot_query_failed"


def test_catalog_snapshot_search_is_case_insensitive_separator_tolerant_and_relevant(temp_dir):
    store = _store(temp_dir)
    noise = [
        (f"noise-{index}", f"CODE-{index:02d}", f"Accessory X{index:02d}M70Z")
        for index in range(25)
    ]
    store.replace_snapshot(
        nomenclature=[
            *noise,
            ("wanted", "LEN-M70Q", "Lenovo ThinkCentre Tiny M70q"),
            ("hyphen", "LEN-M-70", "Lenovo ThinkCentre M-70"),
            ("space", "LEN-M70", "Lenovo ThinkCentre M 70"),
        ],
        warehouses=[],
    )

    expected = None
    for query in ("m70", "M70", "m-70", "M 70"):
        available, rows = store.search_entries(
            catalog_type=CATALOG_NOMENCLATURE,
            text=query,
            limit=20,
        )
        assert available is True
        refs = [row["ref"] for row in rows]
        assert set(refs[:3]) == {"hyphen", "space", "wanted"}
        assert refs[2] == "wanted"
        if expected is None:
            expected = refs
        else:
            assert refs == expected


def test_catalog_token_trigram_migration_matches_substring_search():
    migration_path = (
        WEB_ROOT
        / "backend"
        / "alembic"
        / "versions"
        / "20260713_0065_one_c_catalog_token_trgm.py"
    )
    source = migration_path.read_text(encoding="utf-8")

    assert 'down_revision = "20260713_0064"' in source
    assert "CREATE EXTENSION IF NOT EXISTS pg_trgm" in source
    assert "USING gin (token gin_trgm_ops)" in source
    assert "ix_app_one_c_catalog_tokens_token_trgm" in source


def test_catalog_fingerprint_migration_tracks_committed_snapshot_content():
    migration_path = (
        WEB_ROOT
        / "backend"
        / "alembic"
        / "versions"
        / "20260714_0066_one_c_catalog_fingerprints.py"
    )
    source = migration_path.read_text(encoding="utf-8")

    assert 'down_revision = "20260713_0065"' in source
    assert "nomenclature_fingerprint" in source
    assert "warehouses_fingerprint" in source


def test_catalog_sync_promotes_app_snapshot_without_rebuilding_local_index(temp_dir, monkeypatch):
    class MemoryJsonStore:
        def __init__(self):
            self.payload = {}

        def load_json(self, _name, default_content=None):
            return dict(self.payload or default_content or {})

        def save_json(self, _name, payload):
            self.payload = dict(payload)

    class Done:
        def __init__(self, value):
            self.value = value

        def result(self, timeout=None):
            return self.value

    store = _store(temp_dir)
    json_store = MemoryJsonStore()
    service = Warehouse1CService(
        data_manager=json_store,
        enable_process_bridge=False,
        catalog_snapshot_store=store,
    )

    nomenclature = [("nom-sync", "SYNC-1", "Synced item", "synced item")]
    warehouses = [("wh-sync", "Склад синхронизации", "склад синхронизации")]

    def fake_submit(function):
        if function.__name__ == "_fetch_all_nomenclature_sync":
            return Done(nomenclature)
        if function.__name__ == "_fetch_all_warehouses_sync":
            return Done(warehouses)
        raise AssertionError(f"Unexpected pool function: {function.__name__}")

    monkeypatch.setattr(service._pool, "submit", fake_submit)
    try:
        status = service.sync_catalog_from_1c()
        assert status["source"] == "app_db_indexed_snapshot"
        assert status["nomenclature_count"] == 1
        assert service._nomenclature_cache == []
        assert service._word_frequency_index == {}
        assert asyncio.run(service.search_nomenclature("Synced"))[0]["ref"] == "nom-sync"
    finally:
        service.shutdown()


def test_unchanged_catalog_sync_does_not_rebuild_postgres_generation(temp_dir, monkeypatch):
    # 1C orders by name only, so equal names may swap refs between runs.
    # Content equality must not depend on that unstable row order.
    nomenclature = [
        ("nom-b", "SYNC-2", "Synced item", "synced item"),
        ("nom-a", "SYNC-1", "Synced item", "synced item"),
    ]
    warehouses = [("wh-sync", "Main warehouse", "main warehouse")]
    store = _store(temp_dir)
    canonical_nomenclature = [
        ["nom-a", "SYNC-1", "Synced item"],
        ["nom-b", "SYNC-2", "Synced item"],
    ]
    canonical_warehouses = [["wh-sync", "Main warehouse"]]
    store.replace_snapshot(
        nomenclature=nomenclature,
        warehouses=warehouses,
        nomenclature_fingerprint=catalog_rows_fingerprint(canonical_nomenclature),
        warehouses_fingerprint=catalog_rows_fingerprint(canonical_warehouses),
    )

    class MemoryJsonStore:
        def __init__(self):
            self.payload = {
                "nomenclature": [
                    ["nom-a", "SYNC-1", "Synced item"],
                    ["nom-b", "SYNC-2", "Synced item"],
                ],
                "warehouses": [["wh-sync", "Main warehouse"]],
                "updated_at": "2026-07-13T10:00:00+00:00",
                "last_error": "",
            }

        def load_json(self, _name, default_content=None):
            return dict(self.payload or default_content or {})

        def save_json(self, _name, payload):
            self.payload = dict(payload)

    class Done:
        def __init__(self, value):
            self.value = value

        def result(self, timeout=None):
            return self.value

    service = Warehouse1CService(
        data_manager=MemoryJsonStore(),
        enable_process_bridge=False,
        catalog_snapshot_store=store,
    )

    def fake_submit(function):
        if function.__name__ == "_fetch_all_nomenclature_sync":
            return Done(nomenclature)
        if function.__name__ == "_fetch_all_warehouses_sync":
            return Done(warehouses)
        raise AssertionError(f"Unexpected pool function: {function.__name__}")

    monkeypatch.setattr(service._pool, "submit", fake_submit)
    replace_calls = []
    original_replace = store.replace_snapshot

    def capture_replace(**kwargs):
        replace_calls.append(kwargs)
        return original_replace(**kwargs)

    monkeypatch.setattr(store, "replace_snapshot", capture_replace)
    try:
        status = service.sync_catalog_from_1c()
    finally:
        service.shutdown()

    assert status["generation"] == 1
    assert status["read_mode"] == "app_snapshot"
    assert replace_calls == []


def test_existing_snapshot_updates_only_changed_rows_in_active_generation(temp_dir):
    store = _store(temp_dir)
    initial = store.replace_snapshot(
        nomenclature=[
            ("nom-keep", "KEEP-1", "Unchanged item"),
            ("nom-change", "OLD-1", "Old item name"),
        ],
        warehouses=[("wh-keep", "Employee Warehouse")],
    )
    assert initial["generation"] == 1

    with app_session(store._database_url) as session:
        unchanged_before = session.scalar(
            select(AppOneCCatalogEntry).where(AppOneCCatalogEntry.ref == "nom-keep")
        )
        unchanged_created_at = unchanged_before.created_at

    updated = store.replace_snapshot(
        nomenclature=[
            ("nom-keep", "KEEP-1", "Unchanged item"),
            ("nom-change", "NEW-2", "New item name"),
            ("nom-added", "ADD-3", "Added item"),
        ],
        warehouses=[("wh-keep", "Employee Warehouse")],
    )

    assert updated["generation"] == 1
    assert updated["nomenclature_count"] == 3
    with app_session(store._database_url) as session:
        unchanged_after = session.scalar(
            select(AppOneCCatalogEntry).where(AppOneCCatalogEntry.ref == "nom-keep")
        )
        changed = session.scalar(
            select(AppOneCCatalogEntry).where(AppOneCCatalogEntry.ref == "nom-change")
        )
        old_tokens = session.scalars(
            select(AppOneCCatalogToken.token).where(
                AppOneCCatalogToken.entry_ref == "nom-change",
                AppOneCCatalogToken.token.like("%old%"),
            )
        ).all()
        new_tokens = session.scalars(
            select(AppOneCCatalogToken.token).where(AppOneCCatalogToken.entry_ref == "nom-change")
        ).all()

    assert unchanged_after.created_at == unchanged_created_at
    assert changed.code == "NEW-2"
    assert changed.name == "New item name"
    assert old_tokens == []
    assert "new" in new_tokens


def test_backend_restart_waits_interval_before_refreshing_existing_snapshot(monkeypatch):
    sleeps = []
    warmups = []

    async def fake_sleep(seconds):
        sleeps.append(seconds)
        if len(sleeps) == 2:
            raise asyncio.CancelledError

    monkeypatch.setenv("WAREHOUSE_1C_CATALOG_SYNC_INTERVAL_SECONDS", "3600")
    monkeypatch.setattr("backend.services.warehouse_1c_service.asyncio.sleep", fake_sleep)
    monkeypatch.setattr(
        "backend.services.warehouse_1c_service.warehouse_1c_service.warmup_connection",
        lambda: warmups.append(True) or {"ready": True},
    )
    monkeypatch.setattr(
        "backend.services.warehouse_1c_service.warehouse_1c_service.get_catalog_status",
        lambda: {
            "read_mode": "app_snapshot",
            "app_snapshot": {"has_snapshot": True},
        },
    )
    monkeypatch.setattr(
        "backend.services.warehouse_1c_service.warehouse_1c_service.sync_catalog_from_1c_as_leader",
        lambda: (_ for _ in ()).throw(AssertionError("restart must not refresh a healthy snapshot")),
    )

    with pytest.raises(asyncio.CancelledError):
        asyncio.run(background_warehouse_1c_catalog_sync_loop())

    assert sleeps == [30, 3600]
    assert warmups == [True]


def test_balances_with_hub_never_turns_truncated_source_into_exact_result(monkeypatch):
    service = Warehouse1CService(enable_process_bridge=False)

    async def fake_get_balances(**kwargs):
        assert kwargs["include_meta"] is True
        return {
            "items": [
                {
                    "warehouse_ref": "wh-1",
                    "warehouse_name": "Основной склад",
                    "qty_balance": 2,
                    "nomenclature_ref": "nom-1",
                }
            ],
            "returned": 1,
            "total": 3,
            "has_more": True,
            "truncated": True,
            "as_of": "2026-07-13T10:00:00+00:00",
            "source": "live_1c",
            "status": "ok",
        }

    monkeypatch.setattr(service, "get_balances", fake_get_balances)
    monkeypatch.setattr("backend.api.v1.database.get_all_db_configs", lambda: [{"id": "ITINVENT", "name": "ITINVENT"}])
    monkeypatch.setattr("backend.database.queries.list_owners_compact", lambda db_id=None: [])
    monkeypatch.setattr(
        "backend.services.employment_status_service.resolve_employment_status_batch",
        lambda names, cache=None: {},
    )
    try:
        payload = asyncio.run(
            service.get_balances_with_hub(
                nomenclature_ref="nom-1",
                db_id="ITINVENT",
                include_meta=True,
            )
        )
    finally:
        service.shutdown()

    assert payload["status"] == "incomplete"
    assert payload["truncated"] is True
    assert payload["as_of"] == "2026-07-13T10:00:00+00:00"
    assert payload["items"][0]["status"] == "incomplete"
    assert payload["items"][0]["exact_linked_count"] is None
