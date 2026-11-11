from __future__ import annotations

import asyncio
import sys
import time
from pathlib import Path


ROOT = Path(__file__).resolve().parents[1]
WEB_ROOT = ROOT / "WEB-itinvent"
if str(WEB_ROOT) not in sys.path:
    sys.path.insert(0, str(WEB_ROOT))

from backend.database import queries as db_queries  # noqa: E402
from backend.services.warehouse_1c_service import warehouse_1c_service  # noqa: E402


def _run():
    return asyncio.run(warehouse_1c_service.get_employee_compare_summary(db_id="ITINVENT"))


def _patch_inputs(monkeypatch, *, owners, counts, warehouses, balances, balance_status="ok"):
    warehouse_1c_service._employee_compare_cache.clear()
    # The persisted snapshot lives in the shared app DB; tests opt in with their own store.
    monkeypatch.setattr(warehouse_1c_service, "_employee_compare_snapshot_store", None)
    monkeypatch.setattr(db_queries, "list_owners_compact", lambda db_id=None: owners)
    monkeypatch.setattr(db_queries, "get_owner_part_no_counts", lambda db_id=None: counts)
    monkeypatch.setattr(
        warehouse_1c_service,
        "_list_warehouse_catalog_entries",
        lambda: (warehouses, {"source": "test", "truncated": False, "as_of": None}),
    )

    async def fake_balances(*, warehouse_refs, limit=None):
        return {
            "items": balances,
            "status": balance_status,
            "truncated": False,
            "as_of": "2025-01-01T00:00:00",
            "source": "live_1c",
        }

    monkeypatch.setattr(
        warehouse_1c_service,
        "get_balances_for_warehouses",
        fake_balances,
    )


def test_compare_summary_marks_full_match(monkeypatch):
    _patch_inputs(
        monkeypatch,
        owners=[{"OWNER_NO": 7, "OWNER_DISPLAY_NAME": "Рябов Александр Сергеевич"}],
        counts=[
            {"owner_no": 7, "part_no": "PN-1", "item_count": 2},
        ],
        warehouses=[{"ref": "wh-1", "name": "Рябов А.С."}],
        balances=[
            {"warehouse_ref": "wh-1", "nomenclature_code": "pn-1", "qty_balance": 2},
        ],
    )

    payload = _run()
    assert payload["meta"]["status"] == "ok"
    assert payload["meta"]["owners_count"] == 1
    item = payload["items"][0]
    assert item["owner_no"] == 7
    assert item["status"] == "match"
    assert item["warehouse_ref"] == "wh-1"
    assert item["counts"]["match"] == 1
    assert item["counts"]["diff"] == 0


def test_compare_summary_diff_only_hub_only_1c(monkeypatch):
    _patch_inputs(
        monkeypatch,
        owners=[{"OWNER_NO": 7, "OWNER_DISPLAY_NAME": "Рябов Александр Сергеевич"}],
        counts=[
            {"owner_no": 7, "part_no": "PN-1", "item_count": 3},
            {"owner_no": 7, "part_no": "PN-2", "item_count": 1},
        ],
        warehouses=[{"ref": "wh-1", "name": "Рябов А.С."}],
        balances=[
            {"warehouse_ref": "wh-1", "nomenclature_code": "pn-1", "qty_balance": 1},
            {"warehouse_ref": "wh-1", "nomenclature_code": "99", "qty_balance": 5},
        ],
    )

    item = _run()["items"][0]
    assert item["status"] == "diff"
    assert item["counts"]["diff"] == 1
    assert item["counts"]["only_hub"] == 1
    assert item["counts"]["only_1c"] == 1


def test_compare_summary_no_warehouse_and_sentinel(monkeypatch):
    _patch_inputs(
        monkeypatch,
        owners=[{"OWNER_NO": 9, "OWNER_DISPLAY_NAME": "Сидоров Пётр Ильич"}],
        counts=[
            {"owner_no": 9, "part_no": "", "item_count": 2},
            {"owner_no": 9, "part_no": "нет в 1С", "item_count": 1},
        ],
        warehouses=[],
        balances=[],
    )

    item = _run()["items"][0]
    assert item["status"] == "no_warehouse"
    assert item["counts"]["no_part"] == 2
    assert item["counts"]["hub_items"] == 3


def test_compare_summary_skips_owner_without_hub_and_warehouse(monkeypatch):
    _patch_inputs(
        monkeypatch,
        owners=[
            {"OWNER_NO": 7, "OWNER_DISPLAY_NAME": "Рябов Александр Сергеевич"},
            {"OWNER_NO": 8, "OWNER_DISPLAY_NAME": "Неттехники Ааа Ббб"},
        ],
        counts=[{"owner_no": 7, "part_no": "PN-1", "item_count": 1}],
        warehouses=[{"ref": "wh-1", "name": "Рябов А.С."}],
        balances=[{"warehouse_ref": "wh-1", "nomenclature_code": "pn-1", "qty_balance": 1}],
    )

    payload = _run()
    assert payload["meta"]["owners_count"] == 1
    assert payload["items"][0]["owner_no"] == 7


def test_compare_summary_unknown_balance_status_fails_closed(monkeypatch):
    _patch_inputs(
        monkeypatch,
        owners=[{"OWNER_NO": 7, "OWNER_DISPLAY_NAME": "Рябов Александр Сергеевич"}],
        counts=[{"owner_no": 7, "part_no": "PN-1", "item_count": 2}],
        warehouses=[{"ref": "wh-1", "name": "Рябов А.С."}],
        # Эта строка без fail-closed guard дала бы match (2 == 2).
        balances=[
            {"warehouse_ref": "wh-1", "nomenclature_code": "pn-1", "qty_balance": 2},
        ],
        balance_status="unknown",
    )

    payload = _run()
    assert payload["meta"]["status"] == "incomplete"
    assert payload["meta"]["balances_status"] == "unknown"
    item = payload["items"][0]
    assert item["status"] == "unknown"
    assert item["part_status"] == {}
    assert item["counts"]["match"] == 0
    assert item["counts"]["diff"] == 0
    assert item["counts"]["only_hub"] == 0
    assert item["counts"]["only_1c"] == 0
    # Локальные Hub-факты сохраняются.
    assert item["counts"]["hub_items"] == 2


def test_compare_summary_part_quantities_evidence(monkeypatch):
    _patch_inputs(
        monkeypatch,
        owners=[{"OWNER_NO": 42, "OWNER_DISPLAY_NAME": "Иванов Иван Иванович"}],
        counts=[
            {"owner_no": 42, "part_no": "ЦБ-00195776", "item_count": 2},
            {"owner_no": 42, "part_no": "PN-9", "item_count": 1},
        ],
        warehouses=[{"ref": "wh-1", "name": "Иванов И.И."}],
        balances=[
            {"warehouse_ref": "wh-1", "nomenclature_code": "цб-00195776", "qty_balance": 1},
        ],
    )

    item = _run()["items"][0]
    key = "цб-00195776"
    assert item["status"] == "diff"
    assert item["part_status"][key] == "diff"
    assert item["part_status"]["pn-9"] == "only_hub"
    assert item["part_quantities"][key] == {"hub_count": 2, "qty_1c": 1}
    assert item["part_quantities"]["pn-9"] == {"hub_count": 1, "qty_1c": None}
    assert item["counts"]["diff"] == 1
    assert item["counts"]["only_hub"] == 1


def test_compare_summary_sums_balance_series_rows(monkeypatch):
    _patch_inputs(
        monkeypatch,
        owners=[{"OWNER_NO": 7, "OWNER_DISPLAY_NAME": "Рябов Александр Сергеевич"}],
        counts=[{"owner_no": 7, "part_no": "PN-1", "item_count": 1}],
        warehouses=[{"ref": "wh-1", "name": "Рябов А.С."}],
        balances=[
            {"warehouse_ref": "wh-1", "nomenclature_code": "pn-1", "qty_balance": 0.5},
            {"warehouse_ref": "wh-1", "nomenclature_code": "PN-1", "qty_balance": 0.5},
        ],
    )

    item = _run()["items"][0]
    assert item["status"] == "match"
    assert item["part_status"]["pn-1"] == "match"
    assert item["part_quantities"]["pn-1"] == {"hub_count": 1, "qty_1c": 1.0}


def test_compare_summary_refresh_bypasses_cached_snapshot(monkeypatch):
    monkeypatch.setattr(time, "monotonic", lambda: 0.0)
    balances = [{"warehouse_ref": "wh-1", "nomenclature_code": "pn-1", "qty_balance": 2}]
    _patch_inputs(
        monkeypatch,
        owners=[{"OWNER_NO": 7, "OWNER_DISPLAY_NAME": "Рябов Александр Сергеевич"}],
        counts=[{"owner_no": 7, "part_no": "PN-1", "item_count": 2}],
        warehouses=[{"ref": "wh-1", "name": "Рябов А.С."}],
        balances=balances,
    )

    first = _run()
    assert first["items"][0]["part_quantities"]["pn-1"]["qty_1c"] == 2

    balances.clear()
    balances.append({"warehouse_ref": "wh-1", "nomenclature_code": "pn-1", "qty_balance": 5})

    cached = _run()
    assert cached["items"][0]["part_quantities"]["pn-1"]["qty_1c"] == 2

    fresh = asyncio.run(
        warehouse_1c_service.get_employee_compare_summary(db_id="ITINVENT", refresh=True)
    )
    assert fresh["items"][0]["part_quantities"]["pn-1"]["qty_1c"] == 5
    assert fresh["items"][0]["part_status"]["pn-1"] == "diff"


def test_compare_summary_queued_refresh_shares_inflight_rebuild(monkeypatch):
    warehouse_1c_service._employee_compare_cache.clear()
    monkeypatch.setattr(time, "monotonic", lambda: 0.0)
    builds = []

    async def scenario():
        monkeypatch.setattr(
            warehouse_1c_service,
            "_employee_compare_lock",
            asyncio.Lock(),
        )
        build_started = asyncio.Event()
        release_build = asyncio.Event()

        async def fake_build(db_id=None):
            builds.append(db_id)
            build_started.set()
            await release_build.wait()
            return {"meta": {"status": "ok"}, "items": [], "generation": len(builds)}

        monkeypatch.setattr(
            warehouse_1c_service,
            "_build_employee_compare_summary",
            fake_build,
        )

        first = asyncio.create_task(
            warehouse_1c_service.get_employee_compare_summary(db_id="ITINVENT", refresh=True)
        )
        await build_started.wait()
        second = asyncio.create_task(
            warehouse_1c_service.get_employee_compare_summary(db_id="ITINVENT", refresh=True)
        )
        await asyncio.sleep(0)
        release_build.set()
        first_result, second_result = await asyncio.gather(first, second)
        assert builds == ["ITINVENT"]
        third_result = await warehouse_1c_service.get_employee_compare_summary(
            db_id="ITINVENT",
            refresh=True,
        )
        assert builds == ["ITINVENT", "ITINVENT"]
        return first_result, second_result, third_result

    first_result, second_result, third_result = asyncio.run(scenario())
    try:
        assert first_result["generation"] == 1
        assert second_result["generation"] == 1
        assert third_result["generation"] == 2
    finally:
        warehouse_1c_service._employee_compare_cache.clear()


def test_compare_summary_incomplete_clears_part_quantities(monkeypatch):
    _patch_inputs(
        monkeypatch,
        owners=[{"OWNER_NO": 7, "OWNER_DISPLAY_NAME": "Рябов Александр Сергеевич"}],
        counts=[{"owner_no": 7, "part_no": "PN-1", "item_count": 2}],
        warehouses=[{"ref": "wh-1", "name": "Рябов А.С."}],
        balances=[
            {"warehouse_ref": "wh-1", "nomenclature_code": "pn-1", "qty_balance": 1},
        ],
        balance_status="unknown",
    )

    payload = _run()
    assert payload["meta"]["status"] == "incomplete"
    item = payload["items"][0]
    assert item["status"] == "unknown"
    assert item["part_status"] == {}
    assert item["part_quantities"] == {}


def test_compare_summary_sums_balances_of_several_warehouses_of_one_person(monkeypatch):
    _patch_inputs(
        monkeypatch,
        owners=[{"OWNER_NO": 7, "OWNER_DISPLAY_NAME": "Рябов Александр Сергеевич"}],
        counts=[{"owner_no": 7, "part_no": "PN-1", "item_count": 3}],
        warehouses=[
            {"ref": "wh-1", "name": "ОБЪЕКТ-1 (Тикси) Рябов А.С."},
            {"ref": "wh-2", "name": "ОБЪЕКТ-2 (Диксон) Рябов А.С."},
        ],
        balances=[
            {"warehouse_ref": "wh-1", "nomenclature_code": "pn-1", "qty_balance": 1},
            {"warehouse_ref": "wh-2", "nomenclature_code": "pn-1", "qty_balance": 2},
        ],
    )

    item = _run()["items"][0]
    assert item["status"] == "match"
    assert item["part_quantities"]["pn-1"] == {"hub_count": 3, "qty_1c": 3.0}
    assert item["warehouse_count"] == 2
    assert [w["ref"] for w in item["warehouses"]] == ["wh-1", "wh-2"]
    assert "Тикси" in item["warehouse_name"] and "Диксон" in item["warehouse_name"]



def test_compare_summary_over_ref_cap_drops_summed_candidates_instead_of_failing(monkeypatch):
    from backend.services import warehouse_1c_service as service_module

    _patch_inputs(
        monkeypatch,
        owners=[{"OWNER_NO": 7, "OWNER_DISPLAY_NAME": "Рябов Александр Сергеевич"}],
        counts=[{"owner_no": 7, "part_no": "PN-1", "item_count": 3}],
        warehouses=[
            {"ref": "wh-1", "name": "ОБЪЕКТ-1 (Тикси) Рябов А.С."},
            {"ref": "wh-2", "name": "ОБЪЕКТ-2 (Диксон) Рябов А.С."},
        ],
        balances=[],
    )
    requested: list[int] = []

    async def capped_balances(*, warehouse_refs, limit=None):
        if len(warehouse_refs) > service_module.DISMISSED_WAREHOUSE_REFS_MAX:
            raise service_module.Warehouse1CValidationError("too many warehouses")
        requested.append(len(warehouse_refs))
        return {"items": [], "status": "ok", "truncated": False, "as_of": "2025-01-01T00:00:00", "source": "live_1c"}

    monkeypatch.setattr(warehouse_1c_service, "get_balances_for_warehouses", capped_balances)
    monkeypatch.setattr(service_module, "DISMISSED_WAREHOUSE_REFS_MAX", 1)

    item = _run()["items"][0]
    assert requested == [] or requested == [0]
    assert item["warehouses"] == []
    assert item["status"] == "ambiguous"


def test_compare_summary_serves_stale_snapshot_and_rebuilds_in_background(monkeypatch):
    from backend.services import warehouse_1c_service as service_module

    _patch_inputs(
        monkeypatch,
        owners=[{"OWNER_NO": 7, "OWNER_DISPLAY_NAME": "Рябов Александр Сергеевич"}],
        counts=[{"owner_no": 7, "part_no": "PN-1", "item_count": 3}],
        warehouses=[{"ref": "wh-1", "name": "Рябов А.С."}],
        balances=[{"warehouse_ref": "wh-1", "nomenclature_code": "pn-1", "qty_balance": 3}],
    )
    builds: list[int] = []
    original_build = warehouse_1c_service._build_employee_compare_summary

    async def counting_build(db_id=None):
        builds.append(1)
        await asyncio.sleep(0.05)
        return await original_build(db_id)

    monkeypatch.setattr(warehouse_1c_service, "_build_employee_compare_summary", counting_build)

    async def scenario():
        await warehouse_1c_service.get_employee_compare_summary(db_id="ITINVENT")
        for entry in warehouse_1c_service._employee_compare_cache.values():
            entry["at"] -= service_module.EMPLOYEE_COMPARE_SUMMARY_TTL_SECONDS + 1.0
        started = time.perf_counter()
        stale = await warehouse_1c_service.get_employee_compare_summary(db_id="ITINVENT")
        answered_in = time.perf_counter() - started
        await asyncio.sleep(0.3)
        return stale, answered_in

    stale, answered_in = asyncio.run(scenario())
    assert stale["items"], "the previous snapshot is served"
    assert answered_in < 0.04, "a stale snapshot must not wait for the rebuild"
    assert len(builds) == 2, "the background rebuild ran exactly once"


def test_compare_summary_past_stale_window_is_served_marked_stale_without_waiting(monkeypatch):
    from backend.services import warehouse_1c_service as service_module

    _patch_inputs(
        monkeypatch,
        owners=[{"OWNER_NO": 7, "OWNER_DISPLAY_NAME": "Рябов Александр Сергеевич"}],
        counts=[{"owner_no": 7, "part_no": "PN-1", "item_count": 3}],
        warehouses=[{"ref": "wh-1", "name": "Рябов А.С."}],
        balances=[{"warehouse_ref": "wh-1", "nomenclature_code": "pn-1", "qty_balance": 3}],
    )
    builds: list[int] = []
    original_build = warehouse_1c_service._build_employee_compare_summary

    async def slow_build(db_id=None):
        builds.append(1)
        await asyncio.sleep(0.05)
        return await original_build(db_id)

    monkeypatch.setattr(warehouse_1c_service, "_build_employee_compare_summary", slow_build)

    async def scenario():
        await warehouse_1c_service.get_employee_compare_summary(db_id="ITINVENT")
        for entry in warehouse_1c_service._employee_compare_cache.values():
            entry["at"] -= service_module.EMPLOYEE_COMPARE_SUMMARY_STALE_SECONDS + 60.0
        started = time.perf_counter()
        old = await warehouse_1c_service.get_employee_compare_summary(db_id="ITINVENT")
        answered_in = time.perf_counter() - started
        await asyncio.sleep(0.3)
        fresh = await warehouse_1c_service.get_employee_compare_summary(db_id="ITINVENT")
        return old, answered_in, fresh

    old, answered_in, fresh = asyncio.run(scenario())
    assert old["items"] and old["stale"] is True and old["stale_age_seconds"] >= 1800
    assert answered_in < 0.04, "a snapshot older than the stale window must not make the user wait for 1C"
    assert len(builds) == 2, "the background rebuild ran exactly once"
    assert not fresh.get("stale"), "the rebuilt snapshot replaces the old one"


def test_compare_summary_serves_last_good_snapshot_when_1c_fails_and_backs_off(monkeypatch, caplog):
    from backend.services import warehouse_1c_service as service_module

    _patch_inputs(
        monkeypatch,
        owners=[{"OWNER_NO": 7, "OWNER_DISPLAY_NAME": "Рябов Александр Сергеевич"}],
        counts=[{"owner_no": 7, "part_no": "PN-1", "item_count": 3}],
        warehouses=[{"ref": "wh-1", "name": "Рябов А.С."}],
        balances=[{"warehouse_ref": "wh-1", "nomenclature_code": "pn-1", "qty_balance": 3}],
    )
    warehouse_1c_service._employee_compare_failures.clear()
    calls: list[int] = []

    async def failing_build(db_id=None):
        calls.append(1)
        raise RuntimeError("1C bridge timed out")

    async def scenario():
        good = await warehouse_1c_service.get_employee_compare_summary(db_id="ITINVENT")
        for entry in warehouse_1c_service._employee_compare_cache.values():
            entry["at"] -= service_module.EMPLOYEE_COMPARE_SNAPSHOT_MAX_AGE_SECONDS + 5.0
        monkeypatch.setattr(warehouse_1c_service, "_build_employee_compare_summary", failing_build)
        first = await warehouse_1c_service.get_employee_compare_summary(db_id="ITINVENT")
        second = await warehouse_1c_service.get_employee_compare_summary(db_id="ITINVENT")
        return good, first, second

    with caplog.at_level("WARNING"):
        good, first, second = asyncio.run(scenario())
    warehouse_1c_service._employee_compare_failures.clear()
    failure_logs = [r for r in caplog.records if "build failed" in r.getMessage()]
    assert len(failure_logs) == 1 and "1C bridge timed out" in failure_logs[0].getMessage()
    assert good["items"] and not good.get("stale")
    assert first["items"] == good["items"] and first["stale"] is True
    assert second["stale"] is True
    assert len(calls) == 1, "1C is not called again inside the back-off window"


def test_compare_summary_failure_without_snapshot_still_raises(monkeypatch):
    import pytest

    _patch_inputs(monkeypatch, owners=[], counts=[], warehouses=[], balances=[])
    warehouse_1c_service._employee_compare_failures.clear()

    async def failing_build(db_id=None):
        raise RuntimeError("1C bridge timed out")

    monkeypatch.setattr(warehouse_1c_service, "_build_employee_compare_summary", failing_build)
    with pytest.raises(RuntimeError):
        _run()
    warehouse_1c_service._employee_compare_failures.clear()


class _MemorySnapshotStore:
    """Stands in for the app-DB JSON store that outlives a backend restart."""

    def __init__(self):
        self.documents: dict[str, dict] = {}

    def load_json(self, name, default=None):
        return self.documents.get(name, default)

    def save_json(self, name, data):
        self.documents[name] = data
        return True


def _persisting_service(monkeypatch):
    _patch_inputs(
        monkeypatch,
        owners=[{"OWNER_NO": 7, "OWNER_DISPLAY_NAME": "Рябов Александр Сергеевич"}],
        counts=[{"owner_no": 7, "part_no": "PN-1", "item_count": 3}],
        warehouses=[{"ref": "wh-1", "name": "Рябов А.С."}],
        balances=[{"warehouse_ref": "wh-1", "nomenclature_code": "pn-1", "qty_balance": 3}],
    )
    store = _MemorySnapshotStore()
    monkeypatch.setattr(warehouse_1c_service, "_employee_compare_snapshot_store", store)
    warehouse_1c_service._employee_compare_failures.clear()
    return store


def _age_stored_snapshot(store, seconds):
    from datetime import datetime, timedelta, timezone

    for record in store.documents.values():
        record["saved_at"] = (datetime.now(timezone.utc) - timedelta(seconds=seconds)).isoformat()


def test_compare_summary_survives_restart_without_calling_1c(monkeypatch):
    store = _persisting_service(monkeypatch)
    built = asyncio.run(warehouse_1c_service.get_employee_compare_summary(db_id="ITINVENT"))
    assert store.documents, "the good snapshot is persisted"

    # Backend restart: the in-memory cache is gone, 1C is down.
    warehouse_1c_service._employee_compare_cache.clear()
    calls: list[int] = []

    async def unreachable_build(db_id=None):
        calls.append(1)
        raise RuntimeError("1C bridge timed out")

    monkeypatch.setattr(warehouse_1c_service, "_build_employee_compare_summary", unreachable_build)
    restored = asyncio.run(warehouse_1c_service.get_employee_compare_summary(db_id="ITINVENT"))

    assert restored["items"] == built["items"]
    assert not restored.get("stale")
    assert calls == [], "a fresh persisted snapshot needs no 1C call"


def test_compare_summary_after_restart_serves_old_snapshot_at_once_and_rebuilds_in_background(monkeypatch):
    from backend.services import warehouse_1c_service as service_module

    store = _persisting_service(monkeypatch)
    asyncio.run(warehouse_1c_service.get_employee_compare_summary(db_id="ITINVENT"))
    _age_stored_snapshot(store, service_module.EMPLOYEE_COMPARE_SUMMARY_STALE_SECONDS + 60)
    warehouse_1c_service._employee_compare_cache.clear()

    builds: list[int] = []
    original_build = warehouse_1c_service._build_employee_compare_summary

    async def slow_build(db_id=None):
        builds.append(1)
        await asyncio.sleep(0.05)
        return await original_build(db_id)

    monkeypatch.setattr(warehouse_1c_service, "_build_employee_compare_summary", slow_build)

    async def scenario():
        started = time.perf_counter()
        served = await warehouse_1c_service.get_employee_compare_summary(db_id="ITINVENT")
        answered_in = time.perf_counter() - started
        await asyncio.sleep(0.3)
        return served, answered_in

    served, answered_in = asyncio.run(scenario())
    assert served["items"] and served["stale"] is True
    assert answered_in < 0.04, "the first user after a restart must not wait for 1C"
    assert builds == [1], "one background rebuild refreshes the snapshot"
    assert all(
        service_module.datetime.fromisoformat(record["saved_at"]).timestamp() > time.time() - 60
        for record in store.documents.values()
    ), "the rebuilt snapshot replaces the old one in the DB"


def test_compare_summary_ignores_persisted_snapshot_older_than_a_day(monkeypatch):
    from backend.services import warehouse_1c_service as service_module

    store = _persisting_service(monkeypatch)
    asyncio.run(warehouse_1c_service.get_employee_compare_summary(db_id="ITINVENT"))
    _age_stored_snapshot(store, service_module.EMPLOYEE_COMPARE_SNAPSHOT_MAX_AGE_SECONDS + 60)
    warehouse_1c_service._employee_compare_cache.clear()

    async def failing_build(db_id=None):
        raise RuntimeError("1C bridge timed out")

    monkeypatch.setattr(warehouse_1c_service, "_build_employee_compare_summary", failing_build)
    import pytest

    with pytest.raises(RuntimeError):
        asyncio.run(warehouse_1c_service.get_employee_compare_summary(db_id="ITINVENT"))
    warehouse_1c_service._employee_compare_failures.clear()


def test_compare_summary_truncated_balances_of_owners_without_hub_items_keep_hub_owners_ok(monkeypatch):
    # Owners holding Hub equipment must keep their badges when the best-effort load of
    # warehouse-only owners is truncated; only those owners become «unknown».
    _patch_inputs(
        monkeypatch,
        owners=[
            {"OWNER_NO": 7, "OWNER_DISPLAY_NAME": "Рябов Александр Сергеевич"},
            {"OWNER_NO": 8, "OWNER_DISPLAY_NAME": "Нетехники Иван Петрович"},
        ],
        counts=[{"owner_no": 7, "part_no": "PN-1", "item_count": 2}],
        warehouses=[
            {"ref": "wh-1", "name": "Рябов А.С."},
            {"ref": "wh-2", "name": "Нетехники И.П."},
        ],
        balances=[],
    )

    async def split_balances(*, warehouse_refs, limit=None):
        if "wh-2" in warehouse_refs:
            return {
                "items": [{"warehouse_ref": "wh-2", "nomenclature_code": "x", "qty_balance": 1}],
                "status": "incomplete",
                "truncated": True,
                "as_of": "2025-01-01T00:00:00",
                "source": "live_1c",
            }
        return {
            "items": [{"warehouse_ref": "wh-1", "nomenclature_code": "pn-1", "qty_balance": 2}],
            "status": "ok",
            "truncated": False,
            "as_of": "2025-01-01T00:00:00",
            "source": "live_1c",
        }

    monkeypatch.setattr(warehouse_1c_service, "get_balances_for_warehouses", split_balances)

    payload = _run()
    by_owner = {item["owner_no"]: item for item in payload["items"]}
    assert payload["meta"]["status"] == "ok"
    assert payload["meta"]["no_hub_owners_status"] == "incomplete"
    assert by_owner[7]["status"] == "match"
    assert by_owner[7]["part_quantities"]["pn-1"] == {"hub_count": 2, "qty_1c": 2.0}
    assert by_owner[8]["status"] == "unknown"
    assert by_owner[8]["part_quantities"] == {}


def test_compare_summary_loads_balances_in_chunks_so_a_per_call_cap_does_not_truncate(monkeypatch):
    from backend.services import warehouse_1c_service as service_module

    surnames = ["Аксёнов", "Бобров", "Волков", "Громов", "Дроздов"]
    _patch_inputs(
        monkeypatch,
        owners=[
            {"OWNER_NO": index + 1, "OWNER_DISPLAY_NAME": f"{surname} Иван Петрович"}
            for index, surname in enumerate(surnames)
        ],
        counts=[{"owner_no": index + 1, "part_no": "PN-1", "item_count": 1} for index in range(5)],
        warehouses=[
            {"ref": f"wh-{index + 1}", "name": f"{surname} И.П."}
            for index, surname in enumerate(surnames)
        ],
        balances=[],
    )
    monkeypatch.setattr(service_module, "EMPLOYEE_COMPARE_BALANCES_CHUNK", 2)
    calls: list[int] = []

    async def capped_balances(*, warehouse_refs, limit=None):
        calls.append(len(warehouse_refs))
        # Like 1C: one call returns at most 2 rows and reports the rest as truncated.
        rows = [
            {"warehouse_ref": ref, "nomenclature_code": "pn-1", "qty_balance": 1}
            for ref in warehouse_refs
        ]
        return {
            "items": rows[:2],
            "status": "incomplete" if len(rows) > 2 else "ok",
            "truncated": len(rows) > 2,
            "as_of": "2025-01-01T00:00:00",
            "source": "live_1c",
        }

    monkeypatch.setattr(warehouse_1c_service, "get_balances_for_warehouses", capped_balances)

    payload = _run()
    assert sorted(calls) == [1, 2, 2]
    assert payload["meta"]["status"] == "ok"
    assert [item["status"] for item in payload["items"]] == ["match"] * 5


def test_compare_summary_splits_a_truncated_chunk_in_half_instead_of_going_incomplete(monkeypatch):
    from backend.services import warehouse_1c_service as service_module

    surnames = ["Аксёнов", "Бобров", "Волков", "Громов", "Дроздов"]
    _patch_inputs(
        monkeypatch,
        owners=[
            {"OWNER_NO": index + 1, "OWNER_DISPLAY_NAME": f"{surname} Иван Петрович"}
            for index, surname in enumerate(surnames)
        ],
        counts=[{"owner_no": index + 1, "part_no": "PN-1", "item_count": 1} for index in range(5)],
        warehouses=[
            {"ref": f"wh-{index + 1}", "name": f"{surname} И.П."}
            for index, surname in enumerate(surnames)
        ],
        balances=[],
    )
    monkeypatch.setattr(service_module, "EMPLOYEE_COMPARE_BALANCES_CHUNK", 4)
    calls: list[int] = []

    async def capped_balances(*, warehouse_refs, limit=None):
        calls.append(len(warehouse_refs))
        rows = [
            {"warehouse_ref": ref, "nomenclature_code": "pn-1", "qty_balance": 1}
            for ref in warehouse_refs
        ]
        return {
            "items": rows[:2],
            "status": "incomplete" if len(rows) > 2 else "ok",
            "truncated": len(rows) > 2,
            "as_of": "2025-01-01T00:00:00",
            "source": "live_1c",
        }

    monkeypatch.setattr(warehouse_1c_service, "get_balances_for_warehouses", capped_balances)

    payload = _run()
    assert sorted(calls) == [1, 2, 2, 4]
    assert payload["meta"]["status"] == "ok"
    assert [item["status"] for item in payload["items"]] == ["match"] * 5
