from __future__ import annotations

import asyncio
import sys
from pathlib import Path
from unittest.mock import MagicMock


ROOT = Path(__file__).resolve().parents[1]
WEB_ROOT = ROOT / "WEB-itinvent"
if str(WEB_ROOT) not in sys.path:
    sys.path.insert(0, str(WEB_ROOT))

from backend.services.warehouse_1c_service import Warehouse1CService  # noqa: E402


def test_get_balances_with_hub_enriches_rows(monkeypatch):
    service = Warehouse1CService()

    async def fake_get_balances(**kwargs):
        return [
            {
                "warehouse_ref": "w1",
                "warehouse_name": "Рябов А.С.",
                "qty_balance": 1,
                "nomenclature_name": "Монитор",
            },
            {
                "warehouse_ref": "w2",
                "warehouse_name": "Основной склад",
                "qty_balance": 3,
                "nomenclature_name": "Монитор",
            },
        ]

    monkeypatch.setattr(service, "get_balances", fake_get_balances)

    fake_queries = MagicMock()
    fake_queries.list_owners_compact.return_value = [
        {"OWNER_NO": 10, "OWNER_DISPLAY_NAME": "Рябов Александр Сергеевич"},
    ]
    fake_queries.count_equipment_by_owners_hub_query.return_value = {10: 2}

    import backend.database.queries as db_queries

    monkeypatch.setattr(db_queries, "list_owners_compact", fake_queries.list_owners_compact)
    monkeypatch.setattr(
        db_queries,
        "count_equipment_by_owners_hub_query",
        fake_queries.count_equipment_by_owners_hub_query,
    )

    monkeypatch.setattr(
        "backend.services.employment_status_service.resolve_employment_status_batch",
        lambda names, cache=None: {
            "Рябов А.С.": {
                "status": "active",
                "label": "Сотрудник работает",
                "matched_name": "Рябов Александр Сергеевич",
            },
        },
    )

    rows = asyncio.run(
        service.get_balances_with_hub(
            nomenclature_ref="n1",
            part_no="PN-111",
            model_name="Dell P2419H",
        )
    )

    fake_queries.count_equipment_by_owners_hub_query.assert_called_once()
    call_kwargs = fake_queries.count_equipment_by_owners_hub_query.call_args.kwargs
    assert call_kwargs["part_no"] == "PN-111"
    assert call_kwargs["model_name"] == "Dell P2419H"

    assert len(rows) == 2
    person_row = rows[0]
    assert person_row["hub_owner_no"] == 10
    assert person_row["hub_count"] == 2
    assert person_row["employment_status"] == "active"
    assert person_row["employment_label"] == "Сотрудник работает"

    warehouse_row = rows[1]
    assert warehouse_row["hub_count"] is None
    assert warehouse_row["hub_owner_no"] is None
    assert warehouse_row["employment_status"] == "unknown"
    assert warehouse_row["employment_label"] == ""


def test_get_balances_with_hub_requires_nomenclature_ref():
    service = Warehouse1CService()
    try:
        asyncio.run(service.get_balances_with_hub(nomenclature_ref=""))
        assert False, "expected validation error"
    except Exception as exc:
        assert "nomenclature_ref" in str(exc).lower() or "обязателен" in str(exc).lower()
