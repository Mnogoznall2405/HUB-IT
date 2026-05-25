"""Property-based tests for history record creation in TicketsService.

**Validates: Requirements 8.1, 8.4, 9.5, 10.1, 10.3, 10.4**

Property 14: Status change creates history record and system comment
Property 15: Field change history immutability and completeness

Properties tested:
1. Every successful change_status() call creates exactly one history record with
   field_name="status" and one system comment (type="system").
2. When update_request() changes tracked fields (route, assignee_id, total_cost,
   departure_date, arrival_date), each changed field creates a separate history record.
3. History records are immutable — no update/delete methods exist on the service.
4. get_history() always returns records in reverse chronological order (newest first).
"""
from __future__ import annotations

import sys
import time
from contextlib import contextmanager
from datetime import datetime, timedelta, timezone
from decimal import Decimal
from pathlib import Path

import pytest
from hypothesis import given, settings, assume, HealthCheck
from hypothesis import strategies as st
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
    STATUS_TRANSITIONS,
    TRACKED_FIELDS,
    VALID_STATUSES,
    CreateRequestDTO,
    Pagination,
    TicketsService,
    UpdateRequestDTO,
)


# ---------------------------------------------------------------------------
# Strategies
# ---------------------------------------------------------------------------


def status_and_allowed_target():
    """Strategy that picks a (current_status, target_status) pair where the transition is allowed."""
    pairs = []
    for src, targets in STATUS_TRANSITIONS.items():
        for tgt in targets:
            pairs.append((src, tgt))
    return st.sampled_from(pairs)


def two_different_statuses():
    """Strategy that picks two different valid statuses (for admin transitions)."""
    return st.tuples(
        st.sampled_from(sorted(VALID_STATUSES)),
        st.sampled_from(sorted(VALID_STATUSES)),
    ).filter(lambda pair: pair[0] != pair[1])


# Strategy for route strings (tracked field)
route_strategy = st.text(
    alphabet=st.characters(whitelist_categories=("L", "N", "P", "Z")),
    min_size=1,
    max_size=100,
)

# Strategy for total_cost (Decimal, tracked field)
cost_strategy = st.decimals(
    min_value=Decimal("0.01"),
    max_value=Decimal("999999.99"),
    places=2,
    allow_nan=False,
    allow_infinity=False,
)

# Strategy for dates (tracked fields)
date_strategy = st.datetimes(
    min_value=datetime(2020, 1, 1),
    max_value=datetime(2030, 12, 31),
    timezones=st.just(timezone.utc),
)

# Strategy for assignee_id (tracked field)
assignee_strategy = st.sampled_from([1, 2, None])


# ---------------------------------------------------------------------------
# Fixtures
# ---------------------------------------------------------------------------


@pytest.fixture
def service(temp_dir, monkeypatch):
    """Create a TicketsService with a fresh SQLite database (same pattern as status tests)."""
    import backend.appdb.db as appdb

    url = f"sqlite:///{(Path(temp_dir) / 'tickets_prop_history.db').as_posix()}"

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
        admin_user = AppUser(id=1, username="admin", full_name="Admin User", role="admin")
        operator_user = AppUser(id=2, username="operator", full_name="Operator User", role="operator")
        session.add_all([admin_user, operator_user])
        session.flush()

        emp = TicketEmployee(
            full_name="Тестов Тест Тестович",
            phone="+79001234567",
            status="active",
        )
        session.add(emp)
        session.flush()
        emp_id = emp.id

        obj = TicketObject(
            code="TST",
            name="Тестовый объект",
            region="Тестовый регион",
            is_active=True,
        )
        session.add(obj)
        session.flush()
        obj_id = obj.id

    svc = TicketsService()
    svc._test_session_factory = _test_app_session
    svc._seed = {
        "admin_user": {"id": 1, "role": "admin"},
        "operator_user": {"id": 2, "role": "operator"},
        "emp_id": emp_id,
        "obj_id": obj_id,
    }
    svc._session_factory = _test_app_session
    return svc


def _create_request(service, status: str = "new") -> dict:
    """Helper to create a request with a given initial status."""
    seed = service._seed
    dto = CreateRequestDTO(
        employee_id=seed["emp_id"],
        object_id=seed["obj_id"],
        status=status,
    )
    return service.create_request(dto)


# ---------------------------------------------------------------------------
# Property 14: Status change creates history record and system comment
# ---------------------------------------------------------------------------


class TestPropertyStatusChangeCreatesHistoryAndComment:
    """Every successful change_status() call creates exactly one history record
    with field_name='status' and one system comment (type='system').

    **Validates: Requirements 8.1, 8.4, 9.5**
    """

    @settings(max_examples=15, suppress_health_check=[HealthCheck.function_scoped_fixture])
    @given(data=status_and_allowed_target())
    def test_status_change_creates_one_history_record(self, service, data):
        """A valid status transition creates exactly one history record with field_name='status'."""
        current_status, target_status = data
        req = _create_request(service, status=current_status)

        # Get history before the change
        history_before = service.get_history(req["id"])

        service.change_status(
            request_id=req["id"],
            new_status=target_status,
            user=service._seed["operator_user"],
            expected_version=req["version"],
        )

        # Get history after the change
        history_after = service.get_history(req["id"])

        # Exactly one new history record was created
        assert history_after.total == history_before.total + 1

        # The newest record (first in reverse chronological order) is the status change
        newest_record = history_after.items[0]
        assert newest_record["field_name"] == "status"
        assert newest_record["old_value"] == current_status
        assert newest_record["new_value"] == target_status

    @settings(max_examples=15, suppress_health_check=[HealthCheck.function_scoped_fixture])
    @given(data=status_and_allowed_target())
    def test_status_change_creates_system_comment(self, service, data):
        """A valid status transition creates exactly one system comment."""
        current_status, target_status = data
        req = _create_request(service, status=current_status)

        # Get comments before the change
        comments_before = service.get_comments(req["id"])

        service.change_status(
            request_id=req["id"],
            new_status=target_status,
            user=service._seed["operator_user"],
            expected_version=req["version"],
        )

        # Get comments after the change
        comments_after = service.get_comments(req["id"])

        # Exactly one new comment was created
        assert comments_after.total == comments_before.total + 1

        # The newest comment (last in chronological order) is a system comment
        newest_comment = comments_after.items[-1]
        assert newest_comment["comment_type"] == "system"
        assert current_status in newest_comment["text"]
        assert target_status in newest_comment["text"]

    @settings(max_examples=15, suppress_health_check=[HealthCheck.function_scoped_fixture])
    @given(data=two_different_statuses())
    def test_admin_status_change_also_creates_history_and_comment(self, service, data):
        """Admin status transitions also create history record and system comment."""
        current_status, target_status = data
        req = _create_request(service, status=current_status)

        service.change_status(
            request_id=req["id"],
            new_status=target_status,
            user=service._seed["admin_user"],
            expected_version=req["version"],
        )

        history = service.get_history(req["id"])
        comments = service.get_comments(req["id"])

        # At least one history record exists for the status change
        status_records = [h for h in history.items if h["field_name"] == "status"]
        assert len(status_records) == 1
        assert status_records[0]["old_value"] == current_status
        assert status_records[0]["new_value"] == target_status

        # At least one system comment exists
        system_comments = [c for c in comments.items if c["comment_type"] == "system"]
        assert len(system_comments) == 1

    @settings(max_examples=15, suppress_health_check=[HealthCheck.function_scoped_fixture])
    @given(
        data=status_and_allowed_target(),
        comment_text=st.text(min_size=1, max_size=100),
    )
    def test_status_change_history_records_comment(self, service, data, comment_text):
        """History record stores the optional comment from the status change."""
        current_status, target_status = data
        req = _create_request(service, status=current_status)

        service.change_status(
            request_id=req["id"],
            new_status=target_status,
            user=service._seed["operator_user"],
            expected_version=req["version"],
            comment=comment_text,
        )

        history = service.get_history(req["id"])
        newest_record = history.items[0]
        # Comment is stored (truncated to 500 chars)
        expected_comment = comment_text[:500]
        assert newest_record["comment"] == expected_comment


# ---------------------------------------------------------------------------
# Property 15: Field change history immutability and completeness
# ---------------------------------------------------------------------------


class TestPropertyFieldChangeHistoryImmutabilityAndCompleteness:
    """When update_request() changes tracked fields, each changed field creates a
    separate history record. History records are immutable and returned in reverse
    chronological order.

    **Validates: Requirements 10.1, 10.3, 10.4**
    """

    @settings(max_examples=15, suppress_health_check=[HealthCheck.function_scoped_fixture])
    @given(new_route=route_strategy)
    def test_route_change_creates_history_record(self, service, new_route):
        """Changing the route field creates a history record for 'route'."""
        req = _create_request(service, status="new")

        dto = UpdateRequestDTO(
            route=new_route,
            _provided_fields={"route"},
        )
        service.update_request(req["id"], dto, user_id=2)

        history = service.get_history(req["id"])
        route_records = [h for h in history.items if h["field_name"] == "route"]
        assert len(route_records) == 1
        assert route_records[0]["new_value"] == new_route

    @settings(max_examples=15, suppress_health_check=[HealthCheck.function_scoped_fixture])
    @given(new_cost=cost_strategy)
    def test_total_cost_change_creates_history_record(self, service, new_cost):
        """Changing total_cost creates a history record for 'total_cost'."""
        req = _create_request(service, status="new")

        dto = UpdateRequestDTO(
            total_cost=new_cost,
            _provided_fields={"total_cost"},
        )
        service.update_request(req["id"], dto, user_id=2)

        history = service.get_history(req["id"])
        cost_records = [h for h in history.items if h["field_name"] == "total_cost"]
        # Only creates a record if value actually changed (default is 0.00)
        if new_cost != Decimal("0.00"):
            assert len(cost_records) == 1
            assert cost_records[0]["new_value"] == str(new_cost)
        else:
            # No change from default, no history record
            assert len(cost_records) == 0

    @settings(max_examples=15, suppress_health_check=[HealthCheck.function_scoped_fixture])
    @given(new_assignee=st.sampled_from([1, 2]))
    def test_assignee_change_creates_history_record(self, service, new_assignee):
        """Changing assignee_id creates a history record for 'assignee_id'."""
        req = _create_request(service, status="new")
        # Default assignee is None, so any non-None value is a change
        dto = UpdateRequestDTO(
            assignee_id=new_assignee,
            _provided_fields={"assignee_id"},
        )
        service.update_request(req["id"], dto, user_id=2)

        history = service.get_history(req["id"])
        assignee_records = [h for h in history.items if h["field_name"] == "assignee_id"]
        assert len(assignee_records) == 1
        assert assignee_records[0]["old_value"] is None
        assert assignee_records[0]["new_value"] == str(new_assignee)

    @settings(max_examples=15, suppress_health_check=[HealthCheck.function_scoped_fixture])
    @given(new_date=date_strategy)
    def test_departure_date_change_creates_history_record(self, service, new_date):
        """Changing departure_date creates a history record for 'departure_date'."""
        req = _create_request(service, status="new")

        dto = UpdateRequestDTO(
            departure_date=new_date,
            _provided_fields={"departure_date"},
        )
        service.update_request(req["id"], dto, user_id=2)

        history = service.get_history(req["id"])
        date_records = [h for h in history.items if h["field_name"] == "departure_date"]
        assert len(date_records) == 1
        assert date_records[0]["old_value"] is None
        assert date_records[0]["new_value"] is not None

    @settings(max_examples=15, suppress_health_check=[HealthCheck.function_scoped_fixture])
    @given(
        new_route=route_strategy,
        new_cost=cost_strategy,
        new_assignee=st.sampled_from([1, 2]),
    )
    def test_multiple_field_changes_create_separate_records(self, service, new_route, new_cost, new_assignee):
        """When multiple tracked fields change in one update, each gets a separate history record."""
        assume(new_cost != Decimal("0.00"))  # Ensure cost actually changes from default

        req = _create_request(service, status="new")

        dto = UpdateRequestDTO(
            route=new_route,
            total_cost=new_cost,
            assignee_id=new_assignee,
            _provided_fields={"route", "total_cost", "assignee_id"},
        )
        service.update_request(req["id"], dto, user_id=2)

        history = service.get_history(req["id"])

        # Each changed field has its own record
        field_names = [h["field_name"] for h in history.items]
        assert "route" in field_names
        assert "total_cost" in field_names
        assert "assignee_id" in field_names

        # Total records = number of changed fields (3)
        assert history.total == 3

    @settings(max_examples=15, suppress_health_check=[HealthCheck.function_scoped_fixture])
    @given(data=status_and_allowed_target())
    def test_history_immutability_no_update_delete_methods(self, service, data):
        """TicketsService has no methods to update or delete history records.

        This verifies the immutability requirement — once created, history records
        cannot be modified or removed through the service interface.
        """
        # Verify that TicketsService does not expose update/delete for history
        assert not hasattr(service, "update_history")
        assert not hasattr(service, "delete_history")
        assert not hasattr(service, "edit_history")
        assert not hasattr(service, "remove_history")

    @settings(max_examples=15, suppress_health_check=[HealthCheck.function_scoped_fixture])
    @given(data=status_and_allowed_target())
    def test_history_returned_in_reverse_chronological_order(self, service, data):
        """get_history() returns records in reverse chronological order (newest first)."""
        current_status, target_status = data
        req = _create_request(service, status=current_status)

        # First change: update route
        dto = UpdateRequestDTO(
            route="Москва - Камчатка",
            _provided_fields={"route"},
        )
        service.update_request(req["id"], dto, user_id=2)

        # Second change: status transition
        service.change_status(
            request_id=req["id"],
            new_status=target_status,
            user=service._seed["operator_user"],
            expected_version=req["version"],
        )

        history = service.get_history(req["id"])

        # Should have at least 2 records
        assert history.total >= 2

        # Verify reverse chronological order: each record's created_at >= next record's
        for i in range(len(history.items) - 1):
            current_time = history.items[i]["created_at"]
            next_time = history.items[i + 1]["created_at"]
            assert current_time >= next_time, (
                f"History not in reverse chronological order: "
                f"{current_time} should be >= {next_time}"
            )

    @settings(max_examples=15, suppress_health_check=[HealthCheck.function_scoped_fixture])
    @given(new_route=route_strategy)
    def test_history_records_changed_by_id(self, service, new_route):
        """History records store the user ID of who made the change."""
        req = _create_request(service, status="new")
        user_id = 2  # operator

        dto = UpdateRequestDTO(
            route=new_route,
            _provided_fields={"route"},
        )
        service.update_request(req["id"], dto, user_id=user_id)

        history = service.get_history(req["id"])
        assert history.total >= 1
        newest = history.items[0]
        assert newest["changed_by_id"] == user_id

    @settings(max_examples=15, suppress_health_check=[HealthCheck.function_scoped_fixture])
    @given(new_route=route_strategy)
    def test_unchanged_field_does_not_create_history(self, service, new_route):
        """Setting a field to its current value does not create a history record."""
        req = _create_request(service, status="new")

        # First update: set route
        dto1 = UpdateRequestDTO(
            route=new_route,
            _provided_fields={"route"},
        )
        service.update_request(req["id"], dto1, user_id=2)

        history_after_first = service.get_history(req["id"])

        # Second update: set same route again
        dto2 = UpdateRequestDTO(
            route=new_route,
            _provided_fields={"route"},
        )
        service.update_request(req["id"], dto2, user_id=2)

        history_after_second = service.get_history(req["id"])

        # No new record because value didn't change
        assert history_after_second.total == history_after_first.total
