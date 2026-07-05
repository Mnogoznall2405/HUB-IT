"""Tests for TicketsService.get_kanban() (task 8.3).

Tests cover:
- Kanban column grouping by status
- "Проблема" column for no_show, needs_review=True, is_urgent=True
- Filters by object_ids and assignee_ids (AND logic)
- Card dict structure (id, employee_name, object_name, departure_date, route, is_urgent, assignee_name, status)
- Empty kanban when no matching requests
"""
from __future__ import annotations

import sys
from contextlib import contextmanager
from datetime import datetime, timezone
from decimal import Decimal
from pathlib import Path

import pytest
from sqlalchemy import create_engine, event
from sqlalchemy.orm import sessionmaker

PROJECT_ROOT = Path(__file__).resolve().parents[1]
WEB_ROOT = PROJECT_ROOT / "WEB-itinvent"

if str(WEB_ROOT) not in sys.path:
    sys.path.insert(0, str(WEB_ROOT))

from backend.appdb.models import AppBase, AppUser
from backend.appdb.tickets_models import TicketEmployee, TicketObject, TicketRequest
from backend.services.tickets_service import TicketsService


# ---------------------------------------------------------------------------
# Fixtures
# ---------------------------------------------------------------------------


def _sqlite_url(temp_dir: str) -> str:
    return f"sqlite:///{(Path(temp_dir) / 'tickets_kanban.db').as_posix()}"


@pytest.fixture
def service(temp_dir, monkeypatch):
    """Create a TicketsService with a fresh SQLite database and seed data."""
    import backend.appdb.db as appdb

    url = _sqlite_url(temp_dir)

    appdb._engines.clear()
    appdb._session_factories.clear()
    appdb._initialized_schema_urls.clear()

    monkeypatch.setenv("APP_DATABASE_URL", url)

    try:
        from backend.config import config
        monkeypatch.setattr(config, "app_database_url", url, raising=False)
    except (ImportError, AttributeError):
        pass

    engine = create_engine(
        url,
        execution_options={"schema_translate_map": {"app": None, "system": None}},
    )

    @event.listens_for(engine, "connect")
    def _set_sqlite_pragma(dbapi_conn, connection_record):
        cursor = dbapi_conn.cursor()
        cursor.execute("PRAGMA foreign_keys=OFF")
        cursor.close()

    AppBase.metadata.create_all(engine, checkfirst=True)

    SessionLocal = sessionmaker(bind=engine)

    @contextmanager
    def _test_app_session(database_url=None):
        session = SessionLocal()
        try:
            yield session
            session.commit()
        except Exception:
            session.rollback()
            raise
        finally:
            session.close()

    monkeypatch.setattr("backend.services.tickets_service.app_session", _test_app_session)

    # Seed test data
    with _test_app_session() as session:
        user1 = AppUser(id=1, username="admin", full_name="Admin User", role="admin")
        user2 = AppUser(id=2, username="operator", full_name="Operator User", role="operator")
        session.add_all([user1, user2])
        session.flush()

        emp1 = TicketEmployee(full_name="Иванов Иван Иванович", phone="+79001234567", status="active")
        emp2 = TicketEmployee(full_name="Петров Пётр Петрович", phone="+79009876543", status="active")
        session.add_all([emp1, emp2])
        session.flush()
        emp1_id = emp1.id
        emp2_id = emp2.id

        obj1 = TicketObject(code="KAM", name="Камчатка", region="Дальний Восток", is_active=True)
        obj2 = TicketObject(code="MAG", name="Магадан", region="Дальний Восток", is_active=True)
        session.add_all([obj1, obj2])
        session.flush()
        obj1_id = obj1.id
        obj2_id = obj2.id

        # Create requests in various statuses
        now = datetime.now(timezone.utc)
        requests_data = [
            {"employee_id": emp1_id, "object_id": obj1_id, "status": "not_started", "assignee_id": 1,
             "route": "Москва - Камчатка", "departure_date": now},
            {"employee_id": emp2_id, "object_id": obj2_id, "status": "not_started", "assignee_id": 2,
             "route": "Москва - Магадан", "departure_date": now,
             "needs_review": True},
            {"employee_id": emp1_id, "object_id": obj1_id, "status": "at_cashier", "assignee_id": 1,
             "route": "Москва - Камчатка", "departure_date": now},
            {"employee_id": emp2_id, "object_id": obj2_id, "status": "at_cashier", "assignee_id": 2,
             "route": "Москва - Магадан", "departure_date": now,
             "is_urgent": True},
            {"employee_id": emp2_id, "object_id": obj2_id, "status": "purchased", "assignee_id": 2,
             "route": "Москва - Магадан", "departure_date": now},
            {"employee_id": emp1_id, "object_id": obj1_id, "status": "exchange_needed", "assignee_id": 1,
             "route": "Москва - Камчатка", "departure_date": now},
            {"employee_id": emp2_id, "object_id": obj2_id, "status": "refund_needed", "assignee_id": 2,
             "route": "Москва - Магадан", "departure_date": now},
            {"employee_id": emp1_id, "object_id": obj1_id, "status": "cancel_purchase", "assignee_id": 1,
             "route": "Москва - Камчатка", "departure_date": now},
        ]

        for rd in requests_data:
            req = TicketRequest(
                employee_id=rd["employee_id"],
                object_id=rd["object_id"],
                status=rd["status"],
                assignee_id=rd.get("assignee_id"),
                route=rd.get("route"),
                departure_date=rd.get("departure_date"),
                total_cost=Decimal("10000.00"),
                is_urgent=rd.get("is_urgent", False),
                needs_review=rd.get("needs_review", False),
                source="manual",
                version=1,
                created_at=now,
                updated_at=now,
            )
            session.add(req)
        session.flush()

    svc = TicketsService()
    svc._seed = {
        "user1_id": 1,
        "user2_id": 2,
        "emp1_id": emp1_id,
        "emp2_id": emp2_id,
        "obj1_id": obj1_id,
        "obj2_id": obj2_id,
    }
    return svc


# ---------------------------------------------------------------------------
# Tests — Column grouping
# ---------------------------------------------------------------------------


class TestKanbanColumnGrouping:
    """Test that requests are grouped into correct kanban columns."""

    def test_all_columns_present(self, service):
        """All 6 kanban columns are always returned."""
        result = service.get_kanban()
        expected_columns = {"Не запущен", "В кассах", "Куплен", "Возврат/обмен", "Отмена", "Проблема"}
        assert set(result.keys()) == expected_columns

    def test_ne_zapuschen_column(self, service):
        result = service.get_kanban()
        column = result["Не запущен"]
        assert len(column) == 1
        assert column[0]["status"] == "not_started"

    def test_v_kassah_column(self, service):
        result = service.get_kanban()
        column = result["В кассах"]
        assert len(column) == 1
        assert column[0]["status"] == "at_cashier"

    def test_kuplen_column(self, service):
        """'Куплен' column contains purchased status."""
        result = service.get_kanban()
        column = result["Куплен"]
        assert len(column) == 1
        assert column[0]["status"] == "purchased"

    def test_vozvrat_obmen_column(self, service):
        """'Возврат/обмен' column contains exchange_needed and refund statuses."""
        result = service.get_kanban()
        column = result["Возврат/обмен"]
        statuses = {card["status"] for card in column}
        assert statuses == {"exchange_needed", "refund_needed"}
        assert len(column) == 2

    def test_otmena_column(self, service):
        """'Отмена' column contains cancelled status."""
        result = service.get_kanban()
        column = result["Отмена"]
        assert len(column) == 1
        assert column[0]["status"] == "cancel_purchase"

    def test_problema_column(self, service):
        result = service.get_kanban()
        column = result["Проблема"]
        assert len(column) == 2

    def test_all_statuses_represented(self, service):
        result = service.get_kanban()
        all_cards = []
        for cards in result.values():
            all_cards.extend(cards)
        statuses = {card["status"] for card in all_cards}
        assert "closed" not in statuses
        assert "archive" not in statuses


# ---------------------------------------------------------------------------
# Tests — Card structure
# ---------------------------------------------------------------------------


class TestKanbanCardStructure:
    """Test that kanban cards have the correct fields."""

    def test_card_has_required_fields(self, service):
        """Each card has all required fields."""
        result = service.get_kanban()
        required_fields = {"id", "employee_name", "object_name", "departure_date", "route", "is_urgent", "assignee_name", "status"}
        for column_cards in result.values():
            for card in column_cards:
                assert set(card.keys()) == required_fields

    def test_card_employee_name_populated(self, service):
        """Card employee_name is populated from the employee relationship."""
        result = service.get_kanban()
        for column_cards in result.values():
            for card in column_cards:
                assert card["employee_name"] in ("Иванов Иван Иванович", "Петров Пётр Петрович")

    def test_card_object_name_populated(self, service):
        """Card object_name is populated from the object relationship."""
        result = service.get_kanban()
        for column_cards in result.values():
            for card in column_cards:
                assert card["object_name"] in ("Камчатка", "Магадан")


# ---------------------------------------------------------------------------
# Tests — Filters
# ---------------------------------------------------------------------------


class TestKanbanFilters:
    """Test kanban filtering by object and assignee."""

    def test_filter_by_object_ids(self, service):
        """Filter by object_ids returns only requests for specified objects."""
        obj1_id = service._seed["obj1_id"]
        result = service.get_kanban({"object_ids": [obj1_id]})
        for column_cards in result.values():
            for card in column_cards:
                assert card["object_name"] == "Камчатка"

    def test_filter_by_assignee_ids(self, service):
        """Filter by assignee_ids returns only requests for specified assignees."""
        result = service.get_kanban({"assignee_ids": [1]})
        for column_cards in result.values():
            for card in column_cards:
                assert card["assignee_name"] == "Admin User"

    def test_filter_by_object_and_assignee(self, service):
        """Filters combine with AND logic."""
        obj2_id = service._seed["obj2_id"]
        result = service.get_kanban({"object_ids": [obj2_id], "assignee_ids": [2]})
        for column_cards in result.values():
            for card in column_cards:
                assert card["object_name"] == "Магадан"
                assert card["assignee_name"] == "Operator User"

    def test_filter_no_match_returns_empty_columns(self, service):
        """When filters match nothing, all columns are empty."""
        result = service.get_kanban({"object_ids": [9999]})
        for column_cards in result.values():
            assert column_cards == []

    def test_no_filters_returns_all(self, service):
        """Without filters, all kanban-eligible requests are returned."""
        result = service.get_kanban()
        total_cards = sum(len(cards) for cards in result.values())
        # 8 requests on the simplified kanban board
        assert total_cards == 8

    def test_empty_filter_lists_returns_all(self, service):
        """Empty filter lists are treated as no filter."""
        result = service.get_kanban({"object_ids": [], "assignee_ids": []})
        total_cards = sum(len(cards) for cards in result.values())
        assert total_cards == 8
