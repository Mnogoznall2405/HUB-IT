"""Property-based tests for dashboard and kanban (task 8.5).

**Validates: Requirements 16.1, 16.2, 17.1**

Properties tested:
- Property 22: Dashboard metrics correctness — total_active equals count of
  requests in active statuses; ticket_sum equals sum of total_cost for active
  requests (Decimal precision).
- Property 23: Kanban grouping by status — every request appears in exactly
  one column based on its status; requests with needs_review=True or
  is_urgent=True go to "Проблема"; closed/archive requests don't appear.
"""
from __future__ import annotations

import sys
from contextlib import contextmanager
from datetime import datetime, timezone, timedelta
from decimal import Decimal
from pathlib import Path

import pytest
from hypothesis import given, settings, HealthCheck
from hypothesis import strategies as st
from sqlalchemy import create_engine, event
from sqlalchemy.orm import sessionmaker

PROJECT_ROOT = Path(__file__).resolve().parents[1]
WEB_ROOT = PROJECT_ROOT / "WEB-itinvent"

if str(WEB_ROOT) not in sys.path:
    sys.path.insert(0, str(WEB_ROOT))

from backend.appdb.models import AppBase, AppUser
from backend.appdb.tickets_models import TicketEmployee, TicketObject, TicketRequest
from backend.services.tickets_service import (
    VALID_STATUSES,
    TicketsService,
)


# ---------------------------------------------------------------------------
# Constants mirroring the service implementation
# ---------------------------------------------------------------------------

ACTIVE_STATUSES = {
    "new", "data_check", "missing_data", "ready_to_buy",
    "in_progress", "purchased", "exchange_needed",
}

KANBAN_STATUSES = {
    "new", "data_check", "missing_data", "ready_to_buy",
    "in_progress",
    "purchased",
    "exchange_needed", "refund",
    "cancelled",
    "no_show",
}

# Statuses excluded from kanban (closed, archive)
EXCLUDED_FROM_KANBAN = {"closed", "archive"}

STATUS_COLUMN_MAP = {
    "new": "Не запущен",
    "data_check": "Не запущен",
    "missing_data": "Не запущен",
    "ready_to_buy": "Не запущен",
    "in_progress": "В работе",
    "purchased": "Куплен",
    "exchange_needed": "Возврат/обмен",
    "refund": "Возврат/обмен",
    "cancelled": "Отмена",
    "no_show": "Проблема",
}


# ---------------------------------------------------------------------------
# Helper: create a fresh service with isolated in-memory database
# ---------------------------------------------------------------------------


def _make_service():
    """Create a TicketsService with a fresh in-memory SQLite database.

    Returns (service, session_factory, cleanup_fn).
    """
    import backend.services.tickets_service as ts_module

    url = "sqlite:///:memory:"

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

    # Seed test data: user, employee, object
    with _test_app_session() as session:
        user = AppUser(id=1, username="admin", full_name="Admin User", role="admin")
        session.add(user)
        session.flush()

        emp = TicketEmployee(
            full_name="Тестов Тест Тестович",
            phone="+79001111111",
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
        "user_id": 1,
        "emp_id": emp_id,
        "obj_id": obj_id,
    }

    # Monkey-patch app_session for this service instance
    original_app_session = ts_module.app_session
    ts_module.app_session = _test_app_session

    def cleanup():
        ts_module.app_session = original_app_session

    return svc, _test_app_session, cleanup


# ---------------------------------------------------------------------------
# Hypothesis strategies
# ---------------------------------------------------------------------------

# Strategy for generating a random status from all valid statuses
status_strategy = st.sampled_from(sorted(VALID_STATUSES))

# Strategy for generating a list of requests with random statuses
request_data_strategy = st.lists(
    st.fixed_dictionaries({
        "status": status_strategy,
        "total_cost": st.decimals(
            min_value=Decimal("0.00"),
            max_value=Decimal("99999.99"),
            places=2,
            allow_nan=False,
            allow_infinity=False,
        ),
        "is_urgent": st.booleans(),
        "needs_review": st.booleans(),
    }),
    min_size=1,
    max_size=20,
)


# ---------------------------------------------------------------------------
# Property 22: Dashboard metrics correctness
# ---------------------------------------------------------------------------


class TestDashboardMetricsCorrectness:
    """Property 22: Dashboard metrics correctness.

    **Validates: Requirements 16.1, 16.2**

    For any set of requests with random statuses:
    1. total_active equals the count of requests in active statuses.
    2. ticket_sum equals the sum of total_cost for all active requests
       (Decimal precision).
    """

    @given(requests_data=request_data_strategy)
    @settings(max_examples=15, suppress_health_check=[HealthCheck.function_scoped_fixture])
    def test_dashboard_total_active_matches_manual_count(self, requests_data):
        """Dashboard total_active equals manual count of active-status requests."""
        service, session_factory, cleanup = _make_service()
        try:
            seed = service._seed

            # Create requests with random statuses
            with session_factory() as session:
                for i, req_data in enumerate(requests_data):
                    now = datetime.now(timezone.utc)
                    req = TicketRequest(
                        employee_id=seed["emp_id"],
                        object_id=seed["obj_id"],
                        status=req_data["status"],
                        total_cost=req_data["total_cost"],
                        is_urgent=req_data["is_urgent"],
                        needs_review=req_data["needs_review"],
                        version=1,
                        source="manual",
                        created_at=now + timedelta(seconds=i),
                        updated_at=now + timedelta(seconds=i),
                    )
                    session.add(req)

            # Calculate expected values manually
            expected_active_count = sum(
                1 for r in requests_data if r["status"] in ACTIVE_STATUSES
            )
            expected_ticket_sum = sum(
                (r["total_cost"] for r in requests_data if r["status"] in ACTIVE_STATUSES),
                Decimal("0.00"),
            )

            # Get dashboard data
            dashboard = service.get_dashboard()

            # Verify total_active
            assert dashboard["metrics"]["total_active"] == expected_active_count, (
                f"Expected total_active={expected_active_count}, "
                f"got {dashboard['metrics']['total_active']}. "
                f"Statuses: {[r['status'] for r in requests_data]}"
            )

            # Verify ticket_sum (Decimal precision)
            actual_ticket_sum = Decimal(dashboard["metrics"]["ticket_sum"])
            assert actual_ticket_sum == expected_ticket_sum, (
                f"Expected ticket_sum={expected_ticket_sum}, "
                f"got {actual_ticket_sum}. "
                f"Active costs: {[r['total_cost'] for r in requests_data if r['status'] in ACTIVE_STATUSES]}"
            )
        finally:
            cleanup()

    @given(requests_data=request_data_strategy)
    @settings(max_examples=15, suppress_health_check=[HealthCheck.function_scoped_fixture])
    def test_dashboard_per_object_active_count_consistent(self, requests_data):
        """Dashboard per_object active count is consistent with total metrics."""
        service, session_factory, cleanup = _make_service()
        try:
            seed = service._seed

            # Create requests with random statuses
            with session_factory() as session:
                for i, req_data in enumerate(requests_data):
                    now = datetime.now(timezone.utc)
                    req = TicketRequest(
                        employee_id=seed["emp_id"],
                        object_id=seed["obj_id"],
                        status=req_data["status"],
                        total_cost=req_data["total_cost"],
                        is_urgent=req_data["is_urgent"],
                        needs_review=req_data["needs_review"],
                        version=1,
                        source="manual",
                        created_at=now + timedelta(seconds=i),
                        updated_at=now + timedelta(seconds=i),
                    )
                    session.add(req)

            # Get dashboard data
            dashboard = service.get_dashboard()

            # Since all requests belong to the same object, per_object[0].active
            # should equal total_active
            if dashboard["per_object"]:
                obj_data = dashboard["per_object"][0]
                assert obj_data["active"] == dashboard["metrics"]["total_active"], (
                    f"per_object active={obj_data['active']} != "
                    f"total_active={dashboard['metrics']['total_active']}"
                )

                # Per-object ticket_sum should equal overall ticket_sum
                assert Decimal(obj_data["ticket_sum"]) == Decimal(dashboard["metrics"]["ticket_sum"]), (
                    f"per_object ticket_sum={obj_data['ticket_sum']} != "
                    f"total ticket_sum={dashboard['metrics']['ticket_sum']}"
                )
        finally:
            cleanup()


# ---------------------------------------------------------------------------
# Property 23: Kanban grouping by status
# ---------------------------------------------------------------------------


class TestKanbanGroupingByStatus:
    """Property 23: Kanban grouping by status.

    **Validates: Requirements 17.1**

    For any set of requests with random statuses:
    1. Every kanban-eligible request appears in exactly one column.
    2. Requests with needs_review=True or is_urgent=True go to "Проблема".
    3. Closed/archive requests don't appear on the kanban board.
    4. The union of all column cards equals the set of kanban-eligible requests.
    """

    @given(requests_data=request_data_strategy)
    @settings(max_examples=15, suppress_health_check=[HealthCheck.function_scoped_fixture])
    def test_kanban_every_request_in_exactly_one_column(self, requests_data):
        """Every kanban-eligible request appears in exactly one column."""
        service, session_factory, cleanup = _make_service()
        try:
            seed = service._seed
            created_ids = []

            # Create requests with random statuses
            with session_factory() as session:
                for i, req_data in enumerate(requests_data):
                    now = datetime.now(timezone.utc)
                    req = TicketRequest(
                        employee_id=seed["emp_id"],
                        object_id=seed["obj_id"],
                        status=req_data["status"],
                        total_cost=req_data["total_cost"],
                        is_urgent=req_data["is_urgent"],
                        needs_review=req_data["needs_review"],
                        version=1,
                        source="manual",
                        created_at=now + timedelta(seconds=i),
                        updated_at=now + timedelta(seconds=i),
                    )
                    session.add(req)
                    session.flush()
                    created_ids.append((req.id, req_data))

            # Get kanban data
            kanban = service.get_kanban()

            # Collect all card IDs from all columns
            all_kanban_ids = []
            for column_name, cards in kanban.items():
                for card in cards:
                    all_kanban_ids.append(card["id"])

            # Check no duplicates across columns
            assert len(all_kanban_ids) == len(set(all_kanban_ids)), (
                f"Duplicate IDs found across kanban columns: "
                f"{[x for x in all_kanban_ids if all_kanban_ids.count(x) > 1]}"
            )

            # Determine which requests should be on kanban
            for req_id, req_data in created_ids:
                status = req_data["status"]
                is_urgent = req_data["is_urgent"]
                needs_review = req_data["needs_review"]

                # Kanban-eligible: status in kanban_statuses OR flagged
                is_eligible = (
                    status in KANBAN_STATUSES
                    or is_urgent
                    or needs_review
                )
                # But closed/archive without flags are excluded
                if status in EXCLUDED_FROM_KANBAN and not is_urgent and not needs_review:
                    is_eligible = False

                if is_eligible:
                    assert req_id in all_kanban_ids, (
                        f"Request {req_id} (status={status}, urgent={is_urgent}, "
                        f"review={needs_review}) should be on kanban but is missing"
                    )
                else:
                    assert req_id not in all_kanban_ids, (
                        f"Request {req_id} (status={status}, urgent={is_urgent}, "
                        f"review={needs_review}) should NOT be on kanban but is present"
                    )
        finally:
            cleanup()

    @given(requests_data=request_data_strategy)
    @settings(max_examples=15, suppress_health_check=[HealthCheck.function_scoped_fixture])
    def test_kanban_flagged_requests_go_to_problema(self, requests_data):
        """Requests with needs_review=True or is_urgent=True go to 'Проблема'."""
        service, session_factory, cleanup = _make_service()
        try:
            seed = service._seed
            created_ids = []

            # Create requests with random statuses
            with session_factory() as session:
                for i, req_data in enumerate(requests_data):
                    now = datetime.now(timezone.utc)
                    req = TicketRequest(
                        employee_id=seed["emp_id"],
                        object_id=seed["obj_id"],
                        status=req_data["status"],
                        total_cost=req_data["total_cost"],
                        is_urgent=req_data["is_urgent"],
                        needs_review=req_data["needs_review"],
                        version=1,
                        source="manual",
                        created_at=now + timedelta(seconds=i),
                        updated_at=now + timedelta(seconds=i),
                    )
                    session.add(req)
                    session.flush()
                    created_ids.append((req.id, req_data))

            # Get kanban data
            kanban = service.get_kanban()

            # Build a map of id -> column
            id_to_column: dict[int, str] = {}
            for column_name, cards in kanban.items():
                for card in cards:
                    id_to_column[card["id"]] = column_name

            # Verify flagged requests go to "Проблема"
            for req_id, req_data in created_ids:
                is_urgent = req_data["is_urgent"]
                needs_review = req_data["needs_review"]
                status = req_data["status"]

                if (is_urgent or needs_review) and req_id in id_to_column:
                    assert id_to_column[req_id] == "Проблема", (
                        f"Request {req_id} (status={status}, urgent={is_urgent}, "
                        f"review={needs_review}) should be in 'Проблема' "
                        f"but is in '{id_to_column[req_id]}'"
                    )
        finally:
            cleanup()

    @given(requests_data=request_data_strategy)
    @settings(max_examples=15, suppress_health_check=[HealthCheck.function_scoped_fixture])
    def test_kanban_closed_archive_excluded(self, requests_data):
        """Closed and archive requests without flags don't appear on kanban."""
        service, session_factory, cleanup = _make_service()
        try:
            seed = service._seed
            created_ids = []

            # Create requests with random statuses
            with session_factory() as session:
                for i, req_data in enumerate(requests_data):
                    now = datetime.now(timezone.utc)
                    req = TicketRequest(
                        employee_id=seed["emp_id"],
                        object_id=seed["obj_id"],
                        status=req_data["status"],
                        total_cost=req_data["total_cost"],
                        is_urgent=req_data["is_urgent"],
                        needs_review=req_data["needs_review"],
                        version=1,
                        source="manual",
                        created_at=now + timedelta(seconds=i),
                        updated_at=now + timedelta(seconds=i),
                    )
                    session.add(req)
                    session.flush()
                    created_ids.append((req.id, req_data))

            # Get kanban data
            kanban = service.get_kanban()

            # Collect all card IDs
            all_kanban_ids = set()
            for column_name, cards in kanban.items():
                for card in cards:
                    all_kanban_ids.add(card["id"])

            # Verify closed/archive without flags are excluded
            for req_id, req_data in created_ids:
                status = req_data["status"]
                is_urgent = req_data["is_urgent"]
                needs_review = req_data["needs_review"]

                if status in EXCLUDED_FROM_KANBAN and not is_urgent and not needs_review:
                    assert req_id not in all_kanban_ids, (
                        f"Request {req_id} (status={status}, urgent={is_urgent}, "
                        f"review={needs_review}) is closed/archive without flags "
                        f"and should NOT appear on kanban"
                    )
        finally:
            cleanup()

    @given(requests_data=request_data_strategy)
    @settings(max_examples=15, suppress_health_check=[HealthCheck.function_scoped_fixture])
    def test_kanban_union_equals_eligible_set(self, requests_data):
        """Union of all column cards equals the set of kanban-eligible requests."""
        service, session_factory, cleanup = _make_service()
        try:
            seed = service._seed
            created_ids = []

            # Create requests with random statuses
            with session_factory() as session:
                for i, req_data in enumerate(requests_data):
                    now = datetime.now(timezone.utc)
                    req = TicketRequest(
                        employee_id=seed["emp_id"],
                        object_id=seed["obj_id"],
                        status=req_data["status"],
                        total_cost=req_data["total_cost"],
                        is_urgent=req_data["is_urgent"],
                        needs_review=req_data["needs_review"],
                        version=1,
                        source="manual",
                        created_at=now + timedelta(seconds=i),
                        updated_at=now + timedelta(seconds=i),
                    )
                    session.add(req)
                    session.flush()
                    created_ids.append((req.id, req_data))

            # Get kanban data
            kanban = service.get_kanban()

            # Collect all card IDs from kanban
            all_kanban_ids = set()
            for column_name, cards in kanban.items():
                for card in cards:
                    all_kanban_ids.add(card["id"])

            # Compute expected eligible set
            expected_eligible_ids = set()
            for req_id, req_data in created_ids:
                status = req_data["status"]
                is_urgent = req_data["is_urgent"]
                needs_review = req_data["needs_review"]

                is_eligible = (
                    status in KANBAN_STATUSES
                    or is_urgent
                    or needs_review
                )
                if status in EXCLUDED_FROM_KANBAN and not is_urgent and not needs_review:
                    is_eligible = False

                if is_eligible:
                    expected_eligible_ids.add(req_id)

            # Union of all columns should equal the eligible set
            assert all_kanban_ids == expected_eligible_ids, (
                f"Kanban IDs mismatch. "
                f"Missing: {expected_eligible_ids - all_kanban_ids}, "
                f"Extra: {all_kanban_ids - expected_eligible_ids}"
            )
        finally:
            cleanup()
