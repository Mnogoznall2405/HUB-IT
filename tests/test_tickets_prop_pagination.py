"""Property-based tests for pagination and sorting (task 2.7).

**Validates: Requirements 2.2, 2.3**

Properties tested:
- Property 9: Pagination correctness — union of all pages equals full set,
  no duplicates, no missing items, total == N, page_size matches requested
  (or default 25 for invalid).
- Property 10: Sort ordering — returned items are correctly ordered
  (ascending or descending) by the chosen sortable field; invalid sort_field
  defaults to created_at.
"""
from __future__ import annotations

import sys
from contextlib import contextmanager
from datetime import datetime, timezone, timedelta
from decimal import Decimal
from math import ceil
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
    CreateRequestDTO,
    Pagination,
    PagedResult,
    RequestFilters,
    SORTABLE_COLUMNS,
    VALID_PAGE_SIZES,
    TicketsService,
)


# ---------------------------------------------------------------------------
# Helper: create a fresh service with isolated in-memory database
# ---------------------------------------------------------------------------


def _make_service():
    """Create a TicketsService with a fresh in-memory SQLite database.

    Returns (service, cleanup_fn). Each call gets an isolated DB so
    Hypothesis examples don't interfere with each other.
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

    return svc, cleanup


def _create_n_requests(service: TicketsService, n: int) -> list[dict]:
    """Create N requests with varying data for sorting tests.

    Each request gets distinct created_at, departure_date, total_cost,
    and alternating status/is_urgent to enable meaningful sort verification.
    """
    seed = service._seed
    results = []
    statuses = ["new", "in_progress", "purchased", "data_check", "missing_data"]
    base_time = datetime(2024, 1, 1, tzinfo=timezone.utc)
    for i in range(n):
        dto = CreateRequestDTO(
            employee_id=seed["emp_id"],
            object_id=seed["obj_id"],
            status=statuses[i % len(statuses)],
            assignee_id=seed["user_id"],
            departure_date=base_time + timedelta(days=i * 3),
            arrival_date=base_time + timedelta(days=i * 3 + 7),
            submitted_at=base_time + timedelta(hours=i * 2),
            route=f"Route-{i}",
            total_cost=Decimal(f"{1000 + i * 500}.{(i * 7) % 100:02d}"),
            is_urgent=(i % 2 == 0),
        )
        results.append(service.create_request(dto))
    return results


# ---------------------------------------------------------------------------
# Property 9: Pagination correctness
# ---------------------------------------------------------------------------


class TestPaginationCorrectness:
    """Property 9: Pagination correctness.

    **Validates: Requirements 2.2**

    For any N requests (1–30) and any valid page_size (25, 50, 100):
    - total == N
    - sum of items across all pages == N
    - no duplicate IDs across pages
    - page_size matches requested (or default 25 for invalid)
    """

    @given(
        n=st.integers(min_value=1, max_value=30),
        page_size=st.sampled_from([25, 50, 100]),
    )
    @settings(max_examples=15, suppress_health_check=[HealthCheck.function_scoped_fixture])
    def test_pagination_union_equals_full_set(self, n, page_size):
        """Union of all pages equals the full dataset with no duplicates."""
        service, cleanup = _make_service()
        try:
            # Create N requests
            created = _create_n_requests(service, n)
            created_ids = {r["id"] for r in created}

            # Fetch all pages
            all_fetched_ids = set()
            total_items_fetched = 0
            expected_total_pages = ceil(n / page_size)

            for page_num in range(1, expected_total_pages + 1):
                result = service.list_requests(
                    pagination=Pagination(page=page_num, page_size=page_size)
                )

                # total should always equal N
                assert result.total == n, (
                    f"Expected total={n}, got total={result.total} on page {page_num}"
                )

                # total_pages should be correct
                assert result.total_pages == expected_total_pages, (
                    f"Expected total_pages={expected_total_pages}, "
                    f"got {result.total_pages}"
                )

                # page_size in result matches requested
                assert result.page_size == page_size, (
                    f"Expected page_size={page_size}, got {result.page_size}"
                )

                # Each page has at most page_size items
                assert len(result.items) <= page_size

                # Collect IDs (check no duplicates across pages)
                page_ids = {item["id"] for item in result.items}
                overlap = all_fetched_ids & page_ids
                assert not overlap, (
                    f"Duplicate IDs found across pages: {overlap}"
                )
                all_fetched_ids |= page_ids
                total_items_fetched += len(result.items)

            # Union of all pages equals the full set
            assert all_fetched_ids == created_ids, (
                f"Missing IDs: {created_ids - all_fetched_ids}, "
                f"Extra IDs: {all_fetched_ids - created_ids}"
            )

            # Sum of items across all pages == N
            assert total_items_fetched == n
        finally:
            cleanup()

    @given(
        n=st.integers(min_value=1, max_value=30),
        invalid_page_size=st.integers(min_value=1, max_value=200).filter(
            lambda x: x not in VALID_PAGE_SIZES
        ),
    )
    @settings(max_examples=15, suppress_health_check=[HealthCheck.function_scoped_fixture])
    def test_invalid_page_size_defaults_to_25(self, n, invalid_page_size):
        """Invalid page_size values default to 25."""
        service, cleanup = _make_service()
        try:
            _create_n_requests(service, n)

            result = service.list_requests(
                pagination=Pagination(page=1, page_size=invalid_page_size)
            )

            # page_size should default to 25
            assert result.page_size == 25, (
                f"Invalid page_size={invalid_page_size} should default to 25, "
                f"got {result.page_size}"
            )
            assert result.total == n
        finally:
            cleanup()


# ---------------------------------------------------------------------------
# Property 10: Sort ordering
# ---------------------------------------------------------------------------


class TestSortOrdering:
    """Property 10: Sort ordering.

    **Validates: Requirements 2.3**

    For each sortable column, items are in correct order (asc/desc).
    Invalid sort_field defaults to created_at.
    """

    @given(
        sort_field=st.sampled_from(list(SORTABLE_COLUMNS.keys())),
        sort_dir=st.sampled_from(["asc", "desc"]),
    )
    @settings(max_examples=15, suppress_health_check=[HealthCheck.function_scoped_fixture])
    def test_sort_ordering_correct(self, sort_field, sort_dir):
        """Items returned are correctly ordered by the specified field."""
        service, cleanup = _make_service()
        try:
            # Create requests with different created_at/status/total_cost
            n = 8
            _create_n_requests(service, n)

            filters = RequestFilters(sort_field=sort_field, sort_dir=sort_dir)
            result = service.list_requests(
                filters=filters,
                pagination=Pagination(page=1, page_size=100),
            )

            assert result.total == n
            assert len(result.items) == n

            # Extract the sort field values from results
            field_key = SORTABLE_COLUMNS[sort_field]
            values = [item.get(field_key) for item in result.items]

            # Verify ordering: compare adjacent pairs
            for i in range(len(values) - 1):
                v_curr = values[i]
                v_next = values[i + 1]

                # Handle None values — SQLite sorts NULLs differently,
                # skip pairs with None for robustness
                if v_curr is None or v_next is None:
                    continue

                if sort_dir == "asc":
                    assert v_curr <= v_next, (
                        f"Sort asc violated at index {i}: "
                        f"{v_curr!r} > {v_next!r} (field={sort_field})"
                    )
                else:
                    assert v_curr >= v_next, (
                        f"Sort desc violated at index {i}: "
                        f"{v_curr!r} < {v_next!r} (field={sort_field})"
                    )
        finally:
            cleanup()

    @given(
        invalid_field=st.text(
            alphabet=st.characters(whitelist_categories=("L", "N")),
            min_size=3,
            max_size=15,
        ).filter(lambda x: x not in SORTABLE_COLUMNS),
    )
    @settings(max_examples=15, suppress_health_check=[HealthCheck.function_scoped_fixture])
    def test_invalid_sort_field_defaults_to_created_at(self, invalid_field):
        """Invalid sort_field defaults to created_at DESC ordering."""
        service, cleanup = _make_service()
        try:
            n = 5
            created = _create_n_requests(service, n)

            # Use invalid sort_field — should default to created_at desc
            filters = RequestFilters(sort_field=invalid_field, sort_dir="desc")
            result = service.list_requests(
                filters=filters,
                pagination=Pagination(page=1, page_size=100),
            )

            assert result.total == n

            # Verify items are sorted by created_at descending (default)
            created_at_values = [item.get("created_at") for item in result.items]
            for i in range(len(created_at_values) - 1):
                v_curr = created_at_values[i]
                v_next = created_at_values[i + 1]
                if v_curr is not None and v_next is not None:
                    assert v_curr >= v_next, (
                        f"Default sort (created_at desc) violated at index {i}: "
                        f"{v_curr!r} < {v_next!r}"
                    )
        finally:
            cleanup()
