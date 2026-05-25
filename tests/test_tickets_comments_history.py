"""Tests for TicketsService comments and history (task 2.3).

Tests cover:
- add_comment() with text validation (1–2000 chars), type (normal/problem/clarification/system)
- get_comments() — chronological order (oldest first), paginated
- get_history() — reverse chronological, 20 per page
- Field change tracking (status, assignee, dates, cost, route) as separate history records
- History records are immutable (no edit/delete methods)
"""
from __future__ import annotations

import sys
import time
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
from backend.appdb.tickets_models import (
    TicketChangeHistory,
    TicketComment,
    TicketEmployee,
    TicketObject,
    TicketRequest,
)
from backend.services.tickets_service import (
    CreateRequestDTO,
    Pagination,
    PagedResult,
    TicketsNotFoundError,
    TicketsService,
    TicketsValidationError,
    UpdateRequestDTO,
)


# ---------------------------------------------------------------------------
# Fixtures
# ---------------------------------------------------------------------------


def _sqlite_url(temp_dir: str) -> str:
    return f"sqlite:///{(Path(temp_dir) / 'tickets_comments_history.db').as_posix()}"


@pytest.fixture
def service(temp_dir, monkeypatch):
    """Create a TicketsService with a fresh SQLite database."""
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

    # Seed test data: users, employee, object
    with _test_app_session() as session:
        user = AppUser(id=1, username="admin", full_name="Admin User", role="admin")
        session.add(user)
        user2 = AppUser(id=2, username="operator", full_name="Operator User", role="operator")
        session.add(user2)
        session.flush()

        emp1 = TicketEmployee(
            full_name="Иванов Иван Иванович",
            phone="+79001234567",
            status="active",
        )
        session.add(emp1)
        session.flush()
        emp1_id = emp1.id

        obj1 = TicketObject(
            code="KAM",
            name="Камчатка",
            region="Дальний Восток",
            is_active=True,
        )
        session.add(obj1)
        session.flush()
        obj1_id = obj1.id

    svc = TicketsService()
    svc._test_session_factory = _test_app_session
    svc._seed = {
        "user_id": 1,
        "user2_id": 2,
        "emp1_id": emp1_id,
        "obj1_id": obj1_id,
    }
    return svc


def _create_request(service) -> dict:
    """Helper to create a request with defaults."""
    seed = service._seed
    dto = CreateRequestDTO(
        employee_id=seed["emp1_id"],
        object_id=seed["obj1_id"],
        status="new",
        assignee_id=seed["user_id"],
        route="Москва - Камчатка",
        total_cost=Decimal("15000.00"),
    )
    return service.create_request(dto)


# ---------------------------------------------------------------------------
# add_comment tests
# ---------------------------------------------------------------------------


class TestAddComment:
    def test_add_comment_basic(self, service):
        req = _create_request(service)
        result = service.add_comment(
            request_id=req["id"],
            text="Тестовый комментарий",
            comment_type="normal",
            user_id=service._seed["user_id"],
        )
        assert result["id"] is not None
        assert result["request_id"] == req["id"]
        assert result["text"] == "Тестовый комментарий"
        assert result["comment_type"] == "normal"
        assert result["author_id"] == service._seed["user_id"]
        assert result["created_at"] is not None

    def test_add_comment_type_problem(self, service):
        req = _create_request(service)
        result = service.add_comment(
            request_id=req["id"],
            text="Проблема с билетом",
            comment_type="problem",
            user_id=service._seed["user_id"],
        )
        assert result["comment_type"] == "problem"

    def test_add_comment_type_clarification(self, service):
        req = _create_request(service)
        result = service.add_comment(
            request_id=req["id"],
            text="Уточнение по маршруту",
            comment_type="clarification",
            user_id=service._seed["user_id"],
        )
        assert result["comment_type"] == "clarification"

    def test_add_comment_type_system(self, service):
        req = _create_request(service)
        result = service.add_comment(
            request_id=req["id"],
            text="Статус изменён: new → in_progress",
            comment_type="system",
            user_id=None,
        )
        assert result["comment_type"] == "system"
        assert result["author_id"] is None

    def test_add_comment_min_length(self, service):
        """Comment with exactly 1 character should succeed."""
        req = _create_request(service)
        result = service.add_comment(
            request_id=req["id"],
            text="A",
            comment_type="normal",
            user_id=service._seed["user_id"],
        )
        assert result["text"] == "A"

    def test_add_comment_max_length(self, service):
        """Comment with exactly 2000 characters should succeed."""
        req = _create_request(service)
        text = "x" * 2000
        result = service.add_comment(
            request_id=req["id"],
            text=text,
            comment_type="normal",
            user_id=service._seed["user_id"],
        )
        assert len(result["text"]) == 2000

    def test_add_comment_empty_text_raises(self, service):
        """Empty text should raise TicketsValidationError."""
        req = _create_request(service)
        with pytest.raises(TicketsValidationError) as exc_info:
            service.add_comment(
                request_id=req["id"],
                text="",
                comment_type="normal",
                user_id=service._seed["user_id"],
            )
        assert "1" in str(exc_info.value) and "2000" in str(exc_info.value)

    def test_add_comment_too_long_raises(self, service):
        """Text longer than 2000 chars should raise TicketsValidationError."""
        req = _create_request(service)
        with pytest.raises(TicketsValidationError):
            service.add_comment(
                request_id=req["id"],
                text="x" * 2001,
                comment_type="normal",
                user_id=service._seed["user_id"],
            )

    def test_add_comment_invalid_type_raises(self, service):
        """Invalid comment_type should raise TicketsValidationError."""
        req = _create_request(service)
        with pytest.raises(TicketsValidationError) as exc_info:
            service.add_comment(
                request_id=req["id"],
                text="Valid text",
                comment_type="invalid_type",
                user_id=service._seed["user_id"],
            )
        assert "comment_type" in str(exc_info.value)

    def test_add_comment_request_not_found_raises(self, service):
        """Adding comment to non-existent request should raise TicketsNotFoundError."""
        with pytest.raises(TicketsNotFoundError):
            service.add_comment(
                request_id=99999,
                text="Test",
                comment_type="normal",
                user_id=service._seed["user_id"],
            )

    def test_add_comment_none_text_raises(self, service):
        """None text should raise TicketsValidationError."""
        req = _create_request(service)
        with pytest.raises(TicketsValidationError):
            service.add_comment(
                request_id=req["id"],
                text=None,
                comment_type="normal",
                user_id=service._seed["user_id"],
            )


# ---------------------------------------------------------------------------
# get_comments tests
# ---------------------------------------------------------------------------


class TestGetComments:
    def test_get_comments_empty(self, service):
        req = _create_request(service)
        result = service.get_comments(req["id"])
        assert isinstance(result, PagedResult)
        assert result.total == 0
        assert result.items == []

    def test_get_comments_chronological_order(self, service):
        """Comments should be returned oldest first (ASC by created_at)."""
        req = _create_request(service)

        c1 = service.add_comment(req["id"], "First", "normal", service._seed["user_id"])
        c2 = service.add_comment(req["id"], "Second", "normal", service._seed["user_id"])
        c3 = service.add_comment(req["id"], "Third", "normal", service._seed["user_id"])

        result = service.get_comments(req["id"])
        assert result.total == 3
        texts = [item["text"] for item in result.items]
        assert texts == ["First", "Second", "Third"]

    def test_get_comments_paginated(self, service):
        req = _create_request(service)

        # Add 30 comments
        for i in range(30):
            service.add_comment(req["id"], f"Comment {i}", "normal", service._seed["user_id"])

        # Page 1 with page_size 25
        page1 = service.get_comments(req["id"], Pagination(page=1, page_size=25))
        assert len(page1.items) == 25
        assert page1.total == 30
        assert page1.page == 1

        # Page 2
        page2 = service.get_comments(req["id"], Pagination(page=2, page_size=25))
        assert len(page2.items) == 5
        assert page2.total == 30

        # No overlap
        ids_page1 = {item["id"] for item in page1.items}
        ids_page2 = {item["id"] for item in page2.items}
        assert ids_page1.isdisjoint(ids_page2)

    def test_get_comments_different_types(self, service):
        """Comments of all types should be returned together."""
        req = _create_request(service)

        service.add_comment(req["id"], "Normal comment", "normal", service._seed["user_id"])
        service.add_comment(req["id"], "Problem found", "problem", service._seed["user_id"])
        service.add_comment(req["id"], "System event", "system", None)

        result = service.get_comments(req["id"])
        assert result.total == 3
        types = [item["comment_type"] for item in result.items]
        assert "normal" in types
        assert "problem" in types
        assert "system" in types


# ---------------------------------------------------------------------------
# get_history tests
# ---------------------------------------------------------------------------


class TestGetHistory:
    def test_get_history_empty(self, service):
        req = _create_request(service)
        result = service.get_history(req["id"])
        assert isinstance(result, PagedResult)
        assert result.total == 0
        assert result.items == []

    def test_get_history_reverse_chronological(self, service):
        """History should be returned newest first (DESC by created_at)."""
        req = _create_request(service)

        # Make multiple updates to generate history
        dto1 = UpdateRequestDTO(route="Route A", _provided_fields={"route"})
        service.update_request(req["id"], dto1, user_id=service._seed["user_id"])

        dto2 = UpdateRequestDTO(route="Route B", _provided_fields={"route"})
        service.update_request(req["id"], dto2, user_id=service._seed["user_id"])

        dto3 = UpdateRequestDTO(route="Route C", _provided_fields={"route"})
        service.update_request(req["id"], dto3, user_id=service._seed["user_id"])

        result = service.get_history(req["id"])
        assert result.total == 3
        # Newest first: Route C should be the most recent change
        new_values = [item["new_value"] for item in result.items]
        assert new_values == ["Route C", "Route B", "Route A"]

    def test_get_history_default_page_size_20(self, service):
        """Default page size for history should be 20."""
        req = _create_request(service)

        # Create 25 history records by updating route 25 times
        for i in range(25):
            dto = UpdateRequestDTO(route=f"Route {i}", _provided_fields={"route"})
            service.update_request(req["id"], dto, user_id=service._seed["user_id"])

        result = service.get_history(req["id"])
        assert result.page_size == 20
        assert len(result.items) == 20
        assert result.total == 25

        # Page 2
        page2 = service.get_history(req["id"], Pagination(page=2, page_size=20))
        assert len(page2.items) == 5

    def test_history_records_are_immutable(self, service):
        """No update/delete methods exist for history records."""
        # Verify that TicketsService has no methods to edit or delete history
        assert not hasattr(service, "update_history")
        assert not hasattr(service, "delete_history")
        assert not hasattr(service, "edit_history")
        assert not hasattr(service, "remove_history")


# ---------------------------------------------------------------------------
# Field change tracking tests
# ---------------------------------------------------------------------------


class TestFieldChangeTracking:
    def test_track_route_change(self, service):
        req = _create_request(service)
        dto = UpdateRequestDTO(route="Новый маршрут", _provided_fields={"route"})
        service.update_request(req["id"], dto, user_id=service._seed["user_id"])

        history = service.get_history(req["id"])
        assert history.total == 1
        record = history.items[0]
        assert record["field_name"] == "route"
        assert record["old_value"] == "Москва - Камчатка"
        assert record["new_value"] == "Новый маршрут"
        assert record["changed_by_id"] == service._seed["user_id"]
        assert record["source"] == "manual"

    def test_track_assignee_change(self, service):
        req = _create_request(service)
        dto = UpdateRequestDTO(
            assignee_id=service._seed["user2_id"],
            _provided_fields={"assignee_id"},
        )
        service.update_request(req["id"], dto, user_id=service._seed["user_id"])

        history = service.get_history(req["id"])
        assert history.total == 1
        record = history.items[0]
        assert record["field_name"] == "assignee_id"
        assert record["old_value"] == str(service._seed["user_id"])
        assert record["new_value"] == str(service._seed["user2_id"])

    def test_track_total_cost_change(self, service):
        req = _create_request(service)
        dto = UpdateRequestDTO(
            total_cost=Decimal("25000.50"),
            _provided_fields={"total_cost"},
        )
        service.update_request(req["id"], dto, user_id=service._seed["user_id"])

        history = service.get_history(req["id"])
        assert history.total == 1
        record = history.items[0]
        assert record["field_name"] == "total_cost"
        assert record["old_value"] == "15000.00"
        assert record["new_value"] == "25000.50"

    def test_track_departure_date_change(self, service):
        req = _create_request(service)
        new_date = datetime(2025, 6, 15, 10, 0, 0, tzinfo=timezone.utc)
        dto = UpdateRequestDTO(
            departure_date=new_date,
            _provided_fields={"departure_date"},
        )
        service.update_request(req["id"], dto, user_id=service._seed["user_id"])

        history = service.get_history(req["id"])
        assert history.total == 1
        record = history.items[0]
        assert record["field_name"] == "departure_date"
        assert record["old_value"] is None  # Was not set
        assert "2025-06-15" in record["new_value"]

    def test_track_arrival_date_change(self, service):
        req = _create_request(service)
        new_date = datetime(2025, 7, 1, 12, 0, 0, tzinfo=timezone.utc)
        dto = UpdateRequestDTO(
            arrival_date=new_date,
            _provided_fields={"arrival_date"},
        )
        service.update_request(req["id"], dto, user_id=service._seed["user_id"])

        history = service.get_history(req["id"])
        assert history.total == 1
        record = history.items[0]
        assert record["field_name"] == "arrival_date"
        assert record["old_value"] is None
        assert "2025-07-01" in record["new_value"]

    def test_multiple_field_changes_create_separate_records(self, service):
        """Each changed tracked field should create a separate history record."""
        req = _create_request(service)
        dto = UpdateRequestDTO(
            route="Новый маршрут",
            total_cost=Decimal("30000.00"),
            assignee_id=service._seed["user2_id"],
            _provided_fields={"route", "total_cost", "assignee_id"},
        )
        service.update_request(req["id"], dto, user_id=service._seed["user_id"])

        history = service.get_history(req["id"])
        assert history.total == 3
        field_names = {item["field_name"] for item in history.items}
        assert field_names == {"route", "total_cost", "assignee_id"}

    def test_no_history_when_value_unchanged(self, service):
        """If a tracked field is 'updated' to the same value, no history record is created."""
        req = _create_request(service)
        # Update route to the same value
        dto = UpdateRequestDTO(
            route="Москва - Камчатка",  # Same as original
            _provided_fields={"route"},
        )
        service.update_request(req["id"], dto, user_id=service._seed["user_id"])

        history = service.get_history(req["id"])
        assert history.total == 0

    def test_non_tracked_fields_no_history(self, service):
        """Fields like is_urgent and needs_review are not tracked in history."""
        req = _create_request(service)
        dto = UpdateRequestDTO(
            is_urgent=True,
            needs_review=True,
            _provided_fields={"is_urgent", "needs_review"},
        )
        service.update_request(req["id"], dto, user_id=service._seed["user_id"])

        history = service.get_history(req["id"])
        assert history.total == 0

    def test_track_assignee_set_to_none(self, service):
        """Setting assignee to None should be tracked."""
        req = _create_request(service)
        dto = UpdateRequestDTO(
            assignee_id=None,
            _provided_fields={"assignee_id"},
        )
        service.update_request(req["id"], dto, user_id=service._seed["user_id"])

        history = service.get_history(req["id"])
        assert history.total == 1
        record = history.items[0]
        assert record["field_name"] == "assignee_id"
        assert record["old_value"] == str(service._seed["user_id"])
        assert record["new_value"] is None

    def test_change_source_parameter(self, service):
        """The change_source parameter should be stored in history records."""
        req = _create_request(service)
        dto = UpdateRequestDTO(route="Import route", _provided_fields={"route"})
        service.update_request(
            req["id"], dto, user_id=service._seed["user_id"], change_source="import"
        )

        history = service.get_history(req["id"])
        assert history.total == 1
        assert history.items[0]["source"] == "import"

    def test_history_records_have_timestamp(self, service):
        """Each history record should have a created_at timestamp."""
        req = _create_request(service)
        dto = UpdateRequestDTO(route="New route", _provided_fields={"route"})
        service.update_request(req["id"], dto, user_id=service._seed["user_id"])

        history = service.get_history(req["id"])
        assert history.total == 1
        assert history.items[0]["created_at"] is not None
