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
