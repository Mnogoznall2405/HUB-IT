from __future__ import annotations

import asyncio
import sys
from pathlib import Path
from unittest.mock import MagicMock


ROOT = Path(__file__).resolve().parents[1]
WEB_ROOT = ROOT / "WEB-itinvent"
if str(WEB_ROOT) not in sys.path:
    sys.path.insert(0, str(WEB_ROOT))

from backend.database import queries as db_queries  # noqa: E402
from backend.services.warehouse_1c_service import Warehouse1CService  # noqa: E402


def _mock_single_hub_db(monkeypatch, db_id="ITINVENT", db_name="ITINVENT"):
    monkeypatch.setattr(
        "backend.api.v1.database.get_all_db_configs",
        lambda: [{"id": db_id, "name": db_name}],
    )

def test_match_nomenclature_to_hub_query_exact_and_candidates(monkeypatch):
    fake_db = MagicMock()

    def fake_execute(sql, params=()):
        sql_cf = str(sql).casefold()
        if "in (" in sql_cf and "part_no" in sql_cf and "не%найден" not in sql_cf:
            assert "pn-111" in params
            return [
                {
                    "inv_no": 1001,
                    "serial_no": "SN-A",
                    "hw_serial_no": "",
                    "part_no": "PN-111",
                    "model_name": "Dell P2419H",
                    "type_name": "Монитор",
                    "vendor_name": "Dell",
                    "owner_no": 10,
                    "employee_name": "Иванов Иван",
                    "employee_dept": "IT",
                },
                {
                    "inv_no": 1002,
                    "serial_no": "SN-B",
                    "hw_serial_no": "",
                    "part_no": "PN-111",
                    "model_name": "Dell P2419H",
                    "type_name": "Монитор",
                    "vendor_name": "Dell",
                    "owner_no": 20,
                    "employee_name": "Петров Пётр",
                    "employee_dept": "IT",
                },
            ]
        if "не%найден" in sql_cf or "part_no is null" in sql_cf:
            # Candidates must not include items with a usable different PART_NO —
            # the SQL already filters via _PART_NO_UNUSABLE_SQL.
            assert any("%p2419h%" in str(p).casefold() for p in params)
            return [
                {
                    "inv_no": 2001,
                    "serial_no": "SN-C",
                    "hw_serial_no": "",
                    "part_no": "",
                    "model_name": "Dell P2419H",
                    "type_name": "Монитор",
                    "vendor_name": "Dell",
                    "owner_no": 10,
                    "employee_name": "Иванов Иван",
                    "employee_dept": "IT",
                },
                {
                    "inv_no": 1001,  # already in exact — should be filtered out
                    "serial_no": "SN-A",
                    "hw_serial_no": "",
                    "part_no": "",
                    "model_name": "Dell P2419H",
                    "type_name": "Монитор",
                    "vendor_name": "Dell",
                    "owner_no": 10,
                    "employee_name": "Иванов Иван",
                    "employee_dept": "IT",
                },
            ]
        return []

    fake_db.execute_query.side_effect = fake_execute
    monkeypatch.setattr(db_queries, "get_db", lambda db_id=None: fake_db)

    result = db_queries.match_nomenclature_to_hub_query(
        part_nos=["PN-111"],
        model_patterns=["p2419h"],
        prefer_owner_no=10,
        limit=50,
    )

    assert len(result["exact"]) == 2
    assert result["exact"][0]["is_current_owner"] is True
    assert result["exact"][0]["owner_no"] == 10
    assert result["exact"][0]["inv_no"] == "1001"
    assert result["exact"][1]["is_current_owner"] is False

    assert len(result["candidates"]) == 1
    assert result["candidates"][0]["inv_no"] == "2001"
    assert result["candidates"][0]["part_no"] == ""
    assert result["candidates"][0]["is_current_owner"] is True


def test_match_nomenclature_to_hub_query_skips_unusable_part_and_empty_patterns(monkeypatch):
    fake_db = MagicMock()
    fake_db.execute_query.return_value = []
    monkeypatch.setattr(db_queries, "get_db", lambda db_id=None: fake_db)

    result = db_queries.match_nomenclature_to_hub_query(
        part_nos=["не найден", "-"],
        model_patterns=["ab", ""],  # too short / empty
        prefer_owner_no=5,
    )

    assert result == {"exact": [], "candidates": []}
    fake_db.execute_query.assert_not_called()


def test_match_nomenclature_to_hub_service_builds_tokens(monkeypatch):
    service = Warehouse1CService()
    _mock_single_hub_db(monkeypatch)
    captured = {}

    def fake_query(**kwargs):
        captured.update(kwargs)
        return {
            "exact": [{"inv_no": "1", "owner_no": 42, "is_current_owner": True}],
            "candidates": [{"inv_no": "2", "is_current_owner": False}],
        }

    monkeypatch.setattr(db_queries, "match_nomenclature_to_hub_query", fake_query)

    payload = asyncio.run(
        service.match_nomenclature_to_hub(
            nomenclature_code="PN-777",
            nomenclature_name="Монитор Dell P2419H",
            nomenclature_ref="00000000-0000-0000-0000-000000000001",
            owner_no=42,
            limit=30,
            db_id="ITINVENT",
        )
    )

    assert captured["part_nos"] == ["PN-777"]
    assert captured["prefer_owner_no"] == 42
    assert captured["limit"] == 30
    assert captured["db_id"] == "ITINVENT"
    assert any("p2419h" in str(t).casefold() for t in captured["model_patterns"])
    assert payload["exact"][0]["inv_no"] == "1"
    assert payload["exact"][0]["hub_db_id"] == "ITINVENT"
    # Exact hit on this person → hide candidates / other owners
    assert payload["candidates"] == []
    assert payload["query"]["nomenclature_code"] == "PN-777"
    assert payload["query"]["owner_no"] == 42


def test_match_nomenclature_to_hub_hides_foreign_exact_when_person_has_none(monkeypatch):
    """Kiselev's warehouse must not list Levitsky's exact PART_NO hit."""
    service = Warehouse1CService()
    _mock_single_hub_db(monkeypatch)

    def fake_query(**kwargs):
        return {
            "exact": [
                {"inv_no": "10", "owner_no": 99, "is_current_owner": False},
            ],
            "candidates": [
                {"inv_no": "20", "owner_no": 42, "is_current_owner": True, "part_no": ""},
            ],
        }

    monkeypatch.setattr(db_queries, "match_nomenclature_to_hub_query", fake_query)

    payload = asyncio.run(
        service.match_nomenclature_to_hub(
            nomenclature_code="PN-777",
            nomenclature_name="Lenovo ThinkCentre M720q",
            owner_no=42,
            db_id="ITINVENT",
        )
    )

    assert payload["exact"] == []
    assert len(payload["candidates"]) == 1
    assert payload["candidates"][0]["inv_no"] == "20"


def test_match_nomenclature_to_hub_filters_to_current_owner_exact_only(monkeypatch):
    service = Warehouse1CService()
    _mock_single_hub_db(monkeypatch)

    def fake_query(**kwargs):
        return {
            "exact": [
                {"inv_no": "100665", "owner_no": 2900, "is_current_owner": True},
                {"inv_no": "100666", "owner_no": 11, "is_current_owner": False},
            ],
            "candidates": [
                {"inv_no": "2001", "owner_no": 2900, "is_current_owner": True, "part_no": ""},
            ],
        }

    monkeypatch.setattr(db_queries, "match_nomenclature_to_hub_query", fake_query)

    payload = asyncio.run(
        service.match_nomenclature_to_hub(
            nomenclature_code="C0000262381",
            nomenclature_name="Компьютер Lenovo",
            owner_no=2900,
            qty_balance=1,
            db_id="ITINVENT",
        )
    )

    assert [row["inv_no"] for row in payload["exact"]] == ["100665"]
    assert payload["candidates"] == []
    assert payload["need_more"] is False


def test_match_nomenclature_to_hub_keeps_candidates_when_qty_exceeds_exact(monkeypatch):
    service = Warehouse1CService()
    _mock_single_hub_db(monkeypatch)

    def fake_query(**kwargs):
        return {
            "exact": [
                {"inv_no": "101435", "owner_no": 2900, "is_current_owner": True},
                {"inv_no": "101436", "owner_no": 55, "is_current_owner": False},
            ],
            "candidates": [
                {"inv_no": "101999", "owner_no": 2900, "is_current_owner": True, "part_no": ""},
                {"inv_no": "102000", "owner_no": 11, "is_current_owner": False, "part_no": ""},
                # Owner 55 already has exact PART_NO — their no-part units must be hidden
                {"inv_no": "102001", "owner_no": 55, "is_current_owner": False, "part_no": ""},
            ],
        }

    monkeypatch.setattr(db_queries, "match_nomenclature_to_hub_query", fake_query)

    payload = asyncio.run(
        service.match_nomenclature_to_hub(
            nomenclature_code="ЦБ-00133586",
            nomenclature_name='Монитор 23,8" Philips 243V7QDSB',
            owner_no=2900,
            qty_balance=2,
            db_id="ITINVENT",
        )
    )

    assert [row["inv_no"] for row in payload["exact"]] == ["101435"]
    assert [row["inv_no"] for row in payload["candidates"]] == ["101999", "102000"]
    assert payload["need_more"] is True
    assert payload["matched_count"] == 1
    assert payload["qty_balance"] == 2.0


def test_match_nomenclature_to_hub_resolves_owner_from_warehouse_name(monkeypatch):
    service = Warehouse1CService()
    _mock_single_hub_db(monkeypatch)

    monkeypatch.setattr(
        "backend.database.queries.list_owners_compact",
        lambda db_id=None: [{"OWNER_NO": 2900, "OWNER_DISPLAY_NAME": "Козловский Максим Евгеньевич"}],
    )
    monkeypatch.setattr(
        service,
        "_match_warehouse_to_owner",
        lambda warehouse_name, owners: ({"OWNER_NO": 2900}, 100),
    )

    captured = {}

    def fake_query(**kwargs):
        captured.update(kwargs)
        return {
            "exact": [
                {"inv_no": "1", "owner_no": 2900, "is_current_owner": True},
                {"inv_no": "2", "owner_no": 11, "is_current_owner": False},
            ],
            "candidates": [],
        }

    monkeypatch.setattr(db_queries, "match_nomenclature_to_hub_query", fake_query)

    payload = asyncio.run(
        service.match_nomenclature_to_hub(
            nomenclature_code="C0000262381",
            nomenclature_name="Компьютер Lenovo",
            warehouse_name="Козловский Максим Евгеньевич",
            db_id="ITINVENT",
        )
    )

    assert captured["prefer_owner_no"] == 2900
    assert [row["inv_no"] for row in payload["exact"]] == ["1"]
    assert payload["query"]["owner_no"] is None
    assert payload["query"]["warehouse_name"] == "Козловский Максим Евгеньевич"


def test_match_nomenclature_to_hub_searches_all_configured_databases(monkeypatch):
    service = Warehouse1CService()
    monkeypatch.setenv("WAREHOUSE_1C_RECONCILE_ALLOWED_DB_IDS", "ITINVENT,MSK-ITINVENT")
    monkeypatch.setattr(
        "backend.api.v1.database.get_all_db_configs",
        lambda: [
            {"id": "ITINVENT", "name": "ITINVENT"},
            {"id": "MSK-ITINVENT", "name": "MSK"},
        ],
    )

    calls = []

    def fake_query(**kwargs):
        calls.append(kwargs.get("db_id"))
        db_id = kwargs.get("db_id")
        if db_id == "ITINVENT":
            return {
                "exact": [{"inv_no": "100", "owner_no": 1, "is_current_owner": True}],
                "candidates": [],
            }
        return {
            "exact": [{"inv_no": "200", "owner_no": 9, "is_current_owner": False}],
            "candidates": [{"inv_no": "201", "owner_no": 9, "is_current_owner": False, "part_no": ""}],
        }

    monkeypatch.setattr(db_queries, "match_nomenclature_to_hub_query", fake_query)

    payload = asyncio.run(
        service.match_nomenclature_to_hub(
            nomenclature_code="PN-1",
            nomenclature_name="Dell P2419H",
            owner_no=1,
            db_id="ITINVENT",
            qty_balance=1,
            scope="all",
        )
    )

    assert calls == ["ITINVENT", "MSK-ITINVENT"]
    assert [row["inv_no"] for row in payload["exact"]] == ["100"]
    assert payload["exact"][0]["hub_db_id"] == "ITINVENT"
    assert payload["candidates"] == []
    assert len(payload["databases"]) == 2
