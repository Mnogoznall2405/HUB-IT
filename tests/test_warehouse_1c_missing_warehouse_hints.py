from __future__ import annotations

import sys
from pathlib import Path


ROOT = Path(__file__).resolve().parents[1]
WEB_ROOT = ROOT / "WEB-itinvent"
if str(WEB_ROOT) not in sys.path:
    sys.path.insert(0, str(WEB_ROOT))

from backend.api.v1 import warehouse_1c as api  # noqa: E402
from backend.database import queries as db_queries  # noqa: E402
from backend.models.auth import User  # noqa: E402


def _user() -> User:
    return User(
        id=1,
        username="admin",
        role="admin",
        permissions=[],
        use_custom_permissions=False,
        custom_permissions=[],
    )


async def test_missing_warehouse_hints(monkeypatch):
    async def fake_balances(text="", limit=None, **_kwargs):
        assert text == "БУ-777"
        return [
            {
                "nomenclature_code": "БУ-777",
                "warehouse_name": "Петров П.П.",
                "warehouse_ref": "ref-1",
                "qty_balance": 2,
            },
            {
                "nomenclature_code": "БУ-777",
                "warehouse_name": "Петров П.П.",
                "warehouse_ref": "ref-1",
                "qty_balance": 1,
            },
            {
                "nomenclature_code": "БУ-777",
                "warehouse_name": "Общий склад",
                "warehouse_ref": "ref-2",
                "qty_balance": 4,
            },
            {  # другой код — отфильтровывается точным сравнением
                "nomenclature_code": "ДР-777",
                "warehouse_name": "Склад X",
                "warehouse_ref": "ref-3",
                "qty_balance": 9,
            },
            {  # нулевой остаток — пропускаем
                "nomenclature_code": "БУ-777",
                "warehouse_name": "Пустой склад",
                "warehouse_ref": "ref-4",
                "qty_balance": 0,
            },
        ]

    monkeypatch.setattr(api.warehouse_1c_service, "get_balances", fake_balances)

    async def fake_nomenclature(*_a, **_kw):
        return []

    monkeypatch.setattr(
        api.warehouse_1c_service, "search_nomenclature", fake_nomenclature
    )

    def fake_hub_holders(**_kwargs):
        return [
            {"owner_no": 7, "hub_count": 3, "owner_display_name": "Иванов И.И."},
            {"owner_no": 9, "hub_count": 1, "owner_display_name": "Текущий Сотрудник"},
        ]

    monkeypatch.setattr(
        db_queries, "count_all_owners_by_hub_query", fake_hub_holders
    )

    def fake_search_owners(term, limit=20, db_id=None):
        if "петров" in str(term).casefold():
            return [{"OWNER_NO": 5, "OWNER_DISPLAY_NAME": "Петров Пётр Петрович"}]
        return []

    monkeypatch.setattr(db_queries, "search_owners", fake_search_owners)

    def fake_history(inv_no, db_id=None):
        assert inv_no == "100665"
        return {
            "history": [
                {"old_employee_name": "Сидоров С.С.", "new_employee_name": "Текущий Сотрудник"},
                {"old_employee_name": "Сидоров С.С.", "new_employee_name": "Петров П.П."},
            ]
        }

    monkeypatch.setattr(
        db_queries, "get_equipment_history_by_inv", fake_history
    )

    payload = await api.get_missing_warehouse_hints(
        codes="БУ-777",
        inv_nos="100665",
        employee_name="Текущий Сотрудник",
        db_id=None,
        current_user=_user(),
    )

    assert len(payload["codes"]) == 1
    hint = payload["codes"][0]
    assert hint["code"] == "БУ-777"

    warehouses = {w["warehouse_name"]: w for w in hint["warehouses"]}
    assert set(warehouses) == {"Петров П.П.", "Общий склад"}
    petrov = warehouses["Петров П.П."]
    assert petrov["qty"] == 3  # 2 + 1 aggregated by warehouse
    assert petrov["employee_name"] == "Петров Пётр Петрович"
    assert petrov["owner_no"] == 5
    assert petrov["has_in_hub"] is False
    unknown = warehouses["Общий склад"]
    assert unknown["employee_name"] == ""
    assert unknown["has_in_hub"] is False

    # Текущий сотрудник исключён из hub_holders — он и так в задаче.
    assert hint["hub_holders"] == [
        {"owner_no": 7, "employee_name": "Иванов И.И.", "count": 3}
    ]

    assert payload["previous_owners"] == {"100665": ["Сидоров С.С.", "Петров П.П."]}


async def test_missing_warehouse_hints_matches_latin_lookalike_code(monkeypatch):
    """Код, записанный латиницей в 1С (AC-…), ловится поиском по варианту
    написания и сравнением с фолдингом букв-двойников."""
    seen_texts: list[str] = []

    async def fake_balances(text="", limit=None, **_kwargs):
        seen_texts.append(str(text))
        if str(text) != "AC-00159398":
            return []
        return [
            {
                "nomenclature_code": "AC-00159398",  # латинские A и C в 1С
                "warehouse_name": "Петров П.П.",
                "warehouse_ref": "ref-1",
                "qty_balance": 2,
            }
        ]

    monkeypatch.setattr(api.warehouse_1c_service, "get_balances", fake_balances)

    async def fake_nomenclature(*_a, **_kw):
        return []

    monkeypatch.setattr(
        api.warehouse_1c_service, "search_nomenclature", fake_nomenclature
    )
    monkeypatch.setattr(
        db_queries, "count_all_owners_by_hub_query", lambda **_kwargs: []
    )
    monkeypatch.setattr(db_queries, "search_owners", lambda *_a, **_kw: [])
    monkeypatch.setattr(
        db_queries, "get_equipment_history_by_inv", lambda *_a, **_kw: {"history": []}
    )

    payload = await api.get_missing_warehouse_hints(
        codes="АС-00159398",  # кириллица — как в Хабе
        inv_nos="",
        employee_name="Текущий Сотрудник",
        db_id=None,
        current_user=_user(),
    )

    assert "AC-00159398" in seen_texts  # искали латинский вариант тоже
    hint = payload["codes"][0]
    assert hint["warehouses"] == [
        {
            "warehouse_name": "Петров П.П.",
            "warehouse_ref": "ref-1",
            "qty": 2,
            "employee_name": "",
            "has_in_hub": False,
        }
    ]


async def test_missing_warehouse_hints_ref_fallback_when_text_empty(monkeypatch):
    """Текстовый поиск пуст → резолвим номенклатуру по коду и берём остатки
    по ref напрямую."""
    calls: list[dict] = []

    async def fake_balances(text="", nomenclature_ref="", limit=None, **_kwargs):
        calls.append({"text": str(text), "ref": str(nomenclature_ref)})
        if nomenclature_ref == "ref-nom-1":
            return [
                {
                    "nomenclature_code": "ЦБ-00159398",
                    "warehouse_name": "Склад Петрова",
                    "warehouse_ref": "ref-1",
                    "qty_balance": 5,
                }
            ]
        return []

    async def fake_nomenclature(text="", limit=None, **_kwargs):
        assert text == "ЦБ-00159398"
        return [{"ref": "ref-nom-1", "code": "ЦБ-00159398", "name": "Монитор"}]

    monkeypatch.setattr(api.warehouse_1c_service, "get_balances", fake_balances)
    monkeypatch.setattr(
        api.warehouse_1c_service, "search_nomenclature", fake_nomenclature
    )
    monkeypatch.setattr(
        db_queries, "count_all_owners_by_hub_query", lambda **_kwargs: []
    )
    monkeypatch.setattr(db_queries, "search_owners", lambda *_a, **_kw: [])
    monkeypatch.setattr(
        db_queries, "get_equipment_history_by_inv", lambda *_a, **_kw: {"history": []}
    )

    payload = await api.get_missing_warehouse_hints(
        codes="ЦБ-00159398",
        inv_nos="",
        employee_name="Текущий Сотрудник",
        db_id=None,
        current_user=_user(),
    )

    assert any(c["ref"] == "ref-nom-1" for c in calls)
    assert payload["codes"][0]["warehouses"][0]["warehouse_name"] == "Склад Петрова"
    assert payload["codes"][0]["warehouses"][0]["qty"] == 5


async def test_missing_warehouse_hints_has_in_hub_by_name_when_owner_dup(monkeypatch):
    """Дубль владельца в OWNERS: склад резолвится в другой owner_no, но имя
    совпадает с hub-holder → has_in_hub=True."""
    async def fake_balances(text="", limit=None, **_kwargs):
        return [
            {
                "nomenclature_code": "БУ-777",
                "warehouse_name": "Анисимова Ольга Юрьевна",
                "warehouse_ref": "ref-1",
                "qty_balance": 2,
            }
        ]

    async def fake_nomenclature(*_a, **_kw):
        return []

    monkeypatch.setattr(api.warehouse_1c_service, "get_balances", fake_balances)
    monkeypatch.setattr(
        api.warehouse_1c_service, "search_nomenclature", fake_nomenclature
    )
    monkeypatch.setattr(
        db_queries,
        "count_all_owners_by_hub_query",
        lambda **_kwargs: [
            {"owner_no": 7, "hub_count": 2, "owner_display_name": "Анисимова Ольга Юрьевна"}
        ],
    )
    monkeypatch.setattr(
        db_queries,
        "search_owners",
        lambda *_a, **_kw: [
            {"OWNER_NO": 5, "OWNER_DISPLAY_NAME": "Анисимова Ольга Юрьевна"}
        ],
    )
    monkeypatch.setattr(
        db_queries, "get_equipment_history_by_inv", lambda *_a, **_kw: {"history": []}
    )

    payload = await api.get_missing_warehouse_hints(
        codes="БУ-777",
        inv_nos="",
        employee_name="Текущий Сотрудник",
        db_id=None,
        current_user=_user(),
    )

    entry = payload["codes"][0]["warehouses"][0]
    assert entry["owner_no"] == 5
    assert entry["has_in_hub"] is True
