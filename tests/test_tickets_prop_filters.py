"""Property-based tests for filter composition and search (task 2.8).

Properties tested:
- Property 11: Filter correctness (AND composition)
- Property 12: Search substring matching

**Validates: Requirements 3.1, 4.1, 5.1, 6.1, 6.5**

Uses Hypothesis with @settings(max_examples=15) to keep tests fast.
Focuses on ASCII search terms for reliable SQLite property testing.
"""
from __future__ import annotations

import sys
from contextlib import contextmanager
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
from backend.appdb.tickets_models import TicketEmployee, TicketObject, TicketRequest
from backend.services.tickets_service import (
    CreateRequestDTO,
    Pagination,
    RequestFilters,
    TicketsService,
    VALID_STATUSES,
)


# ---------------------------------------------------------------------------
# Strategies
# ---------------------------------------------------------------------------

# ASCII-only search terms (2+ chars) for reliable SQLite case-insensitive matching
ascii_search_st = st.text(
    alphabet=st.characters(whitelist_categories=("L", "N"), whitelist_characters="+-. "),
    min_size=2,
    max_size=10,
).filter(lambda s: len(s.strip()) >= 2)

# Status strategy from valid statuses
status_st = st.sampled_from(sorted(VALID_STATUSES))

# Subset of statuses for filter
status_filter_st = st.lists(status_st, min_size=0, max_size=4, unique=True)

# Object IDs (we'll have 3 objects seeded with IDs 1, 2, 3)
object_id_st = st.integers(min_value=1, max_value=3)
object_filter_st = st.lists(object_id_st, min_size=0, max_size=3, unique=True)

# Assignee IDs (we'll have 2 users seeded with IDs 1, 2 + None for unassigned)
assignee_id_st = st.sampled_from([1, 2, None])
assignee_filter_st = st.lists(assignee_id_st, min_size=0, max_size=3, unique=True)


# ---------------------------------------------------------------------------
# Fixtures
# ---------------------------------------------------------------------------


@pytest.fixture(scope="module")
def prop_service():
    """Create a TicketsService with a fresh SQLite database seeded with diverse data."""
    import backend.appdb.db as appdb

    base_dir = Path(__file__).resolve().parent.parent / ".pytest_runtime"
    base_dir.mkdir(parents=True, exist_ok=True)
    import uuid as uuid_mod
    db_path = base_dir / f"prop_filters_{uuid_mod.uuid4().hex}.db"
    url = f"sqlite:///{db_path.as_posix()}"

    appdb._engines.clear()
    appdb._session_factories.clear()
    appdb._initialized_schema_urls.clear()

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

    # Seed test data
    with _test_app_session() as session:
        # Users
        user1 = AppUser(id=1, username="admin", full_name="Admin User", role="admin")
        user2 = AppUser(id=2, username="operator", full_name="Operator User", role="operator")
        session.add_all([user1, user2])
        session.flush()

        # Employees with ASCII-searchable fields
        employees = [
            TicketEmployee(full_name="John Smith", phone="+79001111111", status="active"),
            TicketEmployee(full_name="Alice Brown", phone="+79002222222", status="active"),
            TicketEmployee(full_name="Bob Wilson", phone="+79003333333", status="active"),
        ]
        session.add_all(employees)
        session.flush()
        emp_ids = [e.id for e in employees]

        # Objects with ASCII codes
        objects = [
            TicketObject(id=1, code="KAM", name="Kamchatka", region="Far East", is_active=True),
            TicketObject(id=2, code="MAG", name="Magadan", region="Far East", is_active=True),
            TicketObject(id=3, code="TIK", name="Tiksi", region="Yakutia", is_active=True),
        ]
        session.add_all(objects)
        session.flush()

    # Patch app_session for the service
    import backend.services.tickets_service as ts_module
    original_app_session = ts_module.app_session
    ts_module.app_session = _test_app_session

    svc = TicketsService()

    # Seed diverse requests covering different combinations
    statuses_to_use = ["new", "in_progress", "purchased", "cancelled", "refund", "closed"]
    import itertools
    combos = list(itertools.product(emp_ids, [1, 2, 3], statuses_to_use, [1, 2, None]))
    # Create a subset of requests (enough for property testing)
    for emp_id, obj_id, status, assignee_id in combos[:36]:
        dto = CreateRequestDTO(
            employee_id=emp_id,
            object_id=obj_id,
            status=status,
            assignee_id=assignee_id,
        )
        svc.create_request(dto)

    yield svc, emp_ids

    # Cleanup
    ts_module.app_session = original_app_session
    engine.dispose()
    try:
        db_path.unlink(missing_ok=True)
    except Exception:
        pass


# ---------------------------------------------------------------------------
# Property 11: Filter correctness (AND composition)
# ---------------------------------------------------------------------------


class TestProperty11FilterANDComposition:
    """Property 11: For any combination of filters (object_ids, statuses, assignee_ids),
    every returned item satisfies ALL active filters (AND logic).
    Items not matching any filter are excluded.

    **Validates: Requirements 3.1, 4.1, 5.1, 6.1, 6.5**
    """

    @given(
        object_ids=object_filter_st,
        statuses=status_filter_st,
        assignee_ids=assignee_filter_st,
    )
    @settings(max_examples=15, suppress_health_check=[HealthCheck.function_scoped_fixture])
    def test_all_returned_items_satisfy_all_active_filters(
        self, prop_service, object_ids, statuses, assignee_ids
    ):
        """Every returned item must satisfy ALL active filter conditions."""
        svc, _ = prop_service

        filters = RequestFilters(
            object_ids=object_ids,
            statuses=statuses,
            assignee_ids=assignee_ids,
        )
        result = svc.list_requests(filters=filters, pagination=Pagination(page=1, page_size=100))

        for item in result.items:
            # If object_ids filter is active, item must match
            if object_ids:
                assert item["object_id"] in object_ids, (
                    f"Item {item['id']} has object_id={item['object_id']} "
                    f"but filter requires one of {object_ids}"
                )

            # If statuses filter is active, item must match
            if statuses:
                assert item["status"] in statuses, (
                    f"Item {item['id']} has status={item['status']} "
                    f"but filter requires one of {statuses}"
                )

            # If assignee_ids filter is active, item must match
            if assignee_ids:
                has_none = None in assignee_ids
                non_none_ids = [aid for aid in assignee_ids if aid is not None]
                item_assignee = item["assignee_id"]
                if has_none and non_none_ids:
                    assert item_assignee is None or item_assignee in non_none_ids, (
                        f"Item {item['id']} has assignee_id={item_assignee} "
                        f"but filter requires one of {assignee_ids}"
                    )
                elif has_none:
                    assert item_assignee is None, (
                        f"Item {item['id']} has assignee_id={item_assignee} "
                        f"but filter requires unassigned (None)"
                    )
                else:
                    assert item_assignee in non_none_ids, (
                        f"Item {item['id']} has assignee_id={item_assignee} "
                        f"but filter requires one of {non_none_ids}"
                    )

    @given(
        object_ids=object_filter_st,
        statuses=status_filter_st,
        assignee_ids=assignee_filter_st,
    )
    @settings(max_examples=15, suppress_health_check=[HealthCheck.function_scoped_fixture])
    def test_no_matching_items_excluded(
        self, prop_service, object_ids, statuses, assignee_ids
    ):
        """Items matching ALL filters must not be excluded from results.

        We verify this by checking that the filtered count equals the count
        of items from the full list that satisfy all conditions.
        """
        svc, _ = prop_service

        # Get all items (no filters)
        all_result = svc.list_requests(
            filters=RequestFilters(),
            pagination=Pagination(page=1, page_size=100),
        )

        # Get filtered items
        filters = RequestFilters(
            object_ids=object_ids,
            statuses=statuses,
            assignee_ids=assignee_ids,
        )
        filtered_result = svc.list_requests(
            filters=filters,
            pagination=Pagination(page=1, page_size=100),
        )

        # Manually count items from all_result that match all filters
        expected_count = 0
        for item in all_result.items:
            matches = True
            if object_ids and item["object_id"] not in object_ids:
                matches = False
            if statuses and item["status"] not in statuses:
                matches = False
            if assignee_ids:
                has_none = None in assignee_ids
                non_none_ids = [aid for aid in assignee_ids if aid is not None]
                item_assignee = item["assignee_id"]
                if has_none and non_none_ids:
                    if not (item_assignee is None or item_assignee in non_none_ids):
                        matches = False
                elif has_none:
                    if item_assignee is not None:
                        matches = False
                else:
                    if item_assignee not in non_none_ids:
                        matches = False
            if matches:
                expected_count += 1

        assert filtered_result.total == expected_count, (
            f"Expected {expected_count} items matching filters, got {filtered_result.total}. "
            f"Filters: object_ids={object_ids}, statuses={statuses}, assignee_ids={assignee_ids}"
        )


# ---------------------------------------------------------------------------
# Property 12: Search substring matching
# ---------------------------------------------------------------------------


class TestProperty12SearchSubstringMatching:
    """Property 12: For any search string of length >= 2, every returned item
    contains the search string as a case-insensitive substring in at least one of:
    employee full_name, phone, object code, or request ID.

    **Validates: Requirements 3.1, 4.1, 5.1, 6.1, 6.5**
    """

    @given(search_term=st.sampled_from([
        "Jo", "Sm", "Ali", "Bro", "Bob", "Wil",
        "KAM", "MAG", "TIK", "kam", "mag", "tik",
        "+7900", "111", "222", "333",
    ]))
    @settings(max_examples=15, suppress_health_check=[HealthCheck.function_scoped_fixture])
    def test_every_result_contains_search_substring(self, prop_service, search_term):
        """Every returned item must contain the search string as a case-insensitive
        substring in at least one searchable field."""
        svc, _ = prop_service

        assume(len(search_term) >= 2)

        filters = RequestFilters(search=search_term)
        result = svc.list_requests(filters=filters, pagination=Pagination(page=1, page_size=100))

        # Build employee phone lookup from seeded data
        employee_phones = {
            "John Smith": "+79001111111",
            "Alice Brown": "+79002222222",
            "Bob Wilson": "+79003333333",
        }

        search_lower = search_term.lower()

        for item in result.items:
            # Check all searchable fields
            full_name = (item.get("employee_name") or "").lower()
            # Phone is not in the response dict but is searched in DB
            phone = employee_phones.get(item.get("employee_name"), "").lower()
            object_code = (item.get("object_code") or "").lower()
            request_id_str = str(item.get("id", ""))

            found_in_any = (
                search_lower in full_name
                or search_lower in phone
                or search_lower in object_code
                or search_lower in request_id_str
            )

            assert found_in_any, (
                f"Item {item['id']} does not contain search term '{search_term}' "
                f"in any searchable field. "
                f"full_name='{item.get('employee_name')}', "
                f"phone='{phone}', "
                f"object_code='{item.get('object_code')}', "
                f"id={item.get('id')}"
            )

    @given(search_term=st.text(
        alphabet=st.characters(whitelist_categories=("L", "N")),
        min_size=0,
        max_size=1,
    ))
    @settings(max_examples=15, suppress_health_check=[HealthCheck.function_scoped_fixture])
    def test_short_search_returns_all_items(self, prop_service, search_term):
        """Search with text < 2 chars returns all items (no filtering applied).

        **Validates: Requirement 6.4**
        """
        svc, _ = prop_service

        # Get all items without any search
        all_result = svc.list_requests(
            filters=RequestFilters(),
            pagination=Pagination(page=1, page_size=100),
        )

        # Get items with short search term (< 2 chars)
        search_result = svc.list_requests(
            filters=RequestFilters(search=search_term),
            pagination=Pagination(page=1, page_size=100),
        )

        assert search_result.total == all_result.total, (
            f"Search with '{search_term}' (len={len(search_term)}) returned "
            f"{search_result.total} items, but expected all {all_result.total} items "
            f"(no filtering for search < 2 chars)"
        )

    @given(search_term=st.sampled_from([
        "KAM", "MAG", "TIK", "kam", "mag", "tik",
    ]))
    @settings(max_examples=15, suppress_health_check=[HealthCheck.function_scoped_fixture])
    def test_search_is_case_insensitive_for_ascii(self, prop_service, search_term):
        """Search must be case-insensitive: 'KAM' and 'kam' return same results."""
        svc, _ = prop_service

        filters_upper = RequestFilters(search=search_term.upper())
        filters_lower = RequestFilters(search=search_term.lower())

        result_upper = svc.list_requests(
            filters=filters_upper, pagination=Pagination(page=1, page_size=100)
        )
        result_lower = svc.list_requests(
            filters=filters_lower, pagination=Pagination(page=1, page_size=100)
        )

        ids_upper = {item["id"] for item in result_upper.items}
        ids_lower = {item["id"] for item in result_lower.items}

        assert ids_upper == ids_lower, (
            f"Case-insensitive search failed for '{search_term}': "
            f"upper returned {len(ids_upper)} items, lower returned {len(ids_lower)} items"
        )

    @given(
        search_term=st.sampled_from(["KAM", "111", "Jo"]),
        statuses=status_filter_st,
        object_ids=object_filter_st,
    )
    @settings(max_examples=15, suppress_health_check=[HealthCheck.function_scoped_fixture])
    def test_search_combined_with_filters_is_and(self, prop_service, search_term, statuses, object_ids):
        """When search and filters are both active, results must satisfy BOTH
        the search condition AND all filter conditions (AND logic)."""
        svc, _ = prop_service

        filters = RequestFilters(
            search=search_term,
            statuses=statuses,
            object_ids=object_ids,
        )
        result = svc.list_requests(filters=filters, pagination=Pagination(page=1, page_size=100))

        # Build employee phone lookup from seeded data
        employee_phones = {
            "John Smith": "+79001111111",
            "Alice Brown": "+79002222222",
            "Bob Wilson": "+79003333333",
        }

        search_lower = search_term.lower()

        for item in result.items:
            # Must satisfy search
            full_name = (item.get("employee_name") or "").lower()
            phone = employee_phones.get(item.get("employee_name"), "").lower()
            object_code = (item.get("object_code") or "").lower()
            request_id_str = str(item.get("id", ""))

            found_in_any = (
                search_lower in full_name
                or search_lower in phone
                or search_lower in object_code
                or search_lower in request_id_str
            )
            assert found_in_any, (
                f"Item {item['id']} does not match search '{search_term}'"
            )

            # Must satisfy filters
            if statuses:
                assert item["status"] in statuses, (
                    f"Item {item['id']} has status={item['status']} "
                    f"but filter requires one of {statuses}"
                )
            if object_ids:
                assert item["object_id"] in object_ids, (
                    f"Item {item['id']} has object_id={item['object_id']} "
                    f"but filter requires one of {object_ids}"
                )
