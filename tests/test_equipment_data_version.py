"""data_version counter: bump on invalidate, shared store fallback."""
import pytest

from backend.database import equipment_db


@pytest.fixture(autouse=True)
def _isolate_version_store(tmp_path, monkeypatch):
    monkeypatch.setattr(equipment_db, "_data_version_local_store", None)
    equipment_db._data_version_cache.clear()

    from local_store import get_local_store

    store = get_local_store(data_dir=tmp_path)
    monkeypatch.setattr(equipment_db, "_data_version_local_store", store)
    monkeypatch.setattr(
        "backend.appdb.db.is_app_database_configured", lambda: False
    )
    yield
    equipment_db._data_version_cache.clear()


def test_version_starts_at_zero_and_bumps_on_invalidate():
    assert equipment_db.get_equipment_data_version("db_a") == 0

    equipment_db.invalidate_equipment_cache("db_a")
    assert equipment_db.get_equipment_data_version("db_a") == 1

    equipment_db.invalidate_equipment_cache("db_a")
    assert equipment_db.get_equipment_data_version("db_a") == 2


def test_versions_are_scoped_per_database():
    equipment_db.invalidate_equipment_cache("db_a")
    assert equipment_db.get_equipment_data_version("db_a") == 1
    assert equipment_db.get_equipment_data_version("db_b") == 0


def test_invalidate_without_db_bumps_all_known_versions():
    equipment_db.invalidate_equipment_cache("db_a")
    equipment_db.invalidate_equipment_cache("db_b")

    equipment_db.invalidate_equipment_cache(None)

    assert equipment_db.get_equipment_data_version("db_a") == 2
    assert equipment_db.get_equipment_data_version("db_b") == 2


def test_grouped_response_carries_data_version(monkeypatch):
    monkeypatch.setattr(equipment_db, "get_db", lambda db_id=None: None)
    monkeypatch.setattr(
        equipment_db, "_get_cached_equipment_total", lambda *a, **kw: 0
    )
    monkeypatch.setattr(
        equipment_db,
        "_group_rows_by_branch_location",
        lambda rows: {},
    )

    class _Db:
        def execute_query(self, *a, **kw):
            return []

    monkeypatch.setattr(equipment_db, "get_db", lambda db_id=None: _Db())

    payload = equipment_db.get_equipment_grouped(page=1, limit=10, db_id="db_a")
    assert payload["data_version"] == 0

    equipment_db.invalidate_equipment_cache("db_a")
    payload = equipment_db.get_equipment_grouped(page=1, limit=10, db_id="db_a")
    assert payload["data_version"] == 1


def test_data_version_persisted_in_store(tmp_path):
    equipment_db.invalidate_equipment_cache("db_a")
    # Reading back through the store proves the bump persisted, not only memoized.
    raw = equipment_db._data_version_store().load_json(
        "equipment_data_version.json", default_content={}
    )
    assert raw["equipment_data_version:db_a"] == 1
