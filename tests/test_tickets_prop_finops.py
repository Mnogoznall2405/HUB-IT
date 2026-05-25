"""Property-based tests for financial operations (task 5.4).

Properties tested:
- Property 28: Loss report filtering and totals (Decimal precision)
- Property 30: Financial operation CRUD integrity

**Validates: Requirements 11.2, 11.3**
"""
from __future__ import annotations

import sys
from contextlib import contextmanager
from datetime import datetime, timezone, timedelta
from decimal import Decimal
from pathlib import Path

import pytest
from hypothesis import given, settings, assume, HealthCheck
from hypothesis import strategies as st

PROJECT_ROOT = Path(__file__).resolve().parents[1]
WEB_ROOT = PROJECT_ROOT / "WEB-itinvent"

if str(WEB_ROOT) not in sys.path:
    sys.path.insert(0, str(WEB_ROOT))

from backend.appdb.models import AppBase
from backend.appdb.tickets_models import TicketFinancialOp
from backend.services.tickets_service import (
    FinOpFilters,
    Pagination,
    TicketsService,
    TicketsValidationError,
)


# ---------------------------------------------------------------------------
# Strategies
# ---------------------------------------------------------------------------

st_amount = st.decimals(
    min_value=0, max_value=999999, places=2, allow_nan=False, allow_infinity=False
)
st_op_type = st.sampled_from(["refund", "exchange", "loss"])
st_reason = st.text(
    min_size=0, max_size=100,
    alphabet=st.characters(whitelist_categories=("L", "N", "P", "Z")),
)

# Date strategy: dates within a reasonable range for filtering
st_op_date = st.dates(
    min_value=datetime(2023, 1, 1).date(),
    max_value=datetime(2025, 12, 31).date(),
).map(lambda d: d.isoformat())


@st.composite
def st_financial_op(draw):
    """Strategy that generates a valid financial operation dict."""
    return {
        "op_type": draw(st_op_type),
        "amount": str(draw(st_amount)),
        "reason": draw(st_reason) or None,
        "op_date": draw(st_op_date),
    }


@st.composite
def st_financial_ops_list(draw):
    """Strategy that generates a list of financial operations (2-10 items)."""
    n = draw(st.integers(min_value=2, max_value=10))
    ops = []
    for _ in range(n):
        ops.append(draw(st_financial_op()))
    return ops


# ---------------------------------------------------------------------------
# Fixtures
# ---------------------------------------------------------------------------


def _sqlite_url(temp_dir: str) -> str:
    return f"sqlite:///{(Path(temp_dir) / 'tickets_prop_finops.db').as_posix()}"


@pytest.fixture
def service(temp_dir, monkeypatch):
    """Create a TicketsService with a fresh SQLite database."""
    from sqlalchemy import create_engine, event
    from sqlalchemy.orm import sessionmaker

    url = _sqlite_url(temp_dir)

    import backend.appdb.db as appdb
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
        cursor.execute("PRAGMA foreign_keys=ON")
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

    return TicketsService()


# ---------------------------------------------------------------------------
# Property 28: Loss report filtering and totals (Decimal precision)
#
# Create multiple financial ops with random amounts (Decimal), types, dates.
# Apply various filters (op_type, date range).
# Verify filtered results match expected items.
# Verify sum of amounts uses Decimal precision (no float rounding errors).
#
# **Validates: Requirements 11.2, 11.3**
# ---------------------------------------------------------------------------


class TestProperty28DecimalPrecision:
    """Property 28: Loss report filtering and totals (Decimal precision)."""

    @settings(max_examples=15, suppress_health_check=[HealthCheck.function_scoped_fixture], deadline=None)
    @given(ops=st_financial_ops_list())
    def test_filter_by_op_type_sum_matches_decimal_total(self, service, ops):
        """For any set of financial operations, filtering by op_type returns
        exactly the matching items and the sum of amounts preserves Decimal
        precision (no float rounding errors).

        **Validates: Requirements 11.2, 11.3**
        """
        # Create all operations
        created_ops = []
        for op_data in ops:
            result = service.create_financial_op(op_data, user_id=1)
            created_ops.append(result)

        # For each op_type, verify filter correctness and Decimal sum precision
        for op_type in ["refund", "exchange", "loss"]:
            # Expected items from created data
            expected_items = [op for op in created_ops if op["op_type"] == op_type]
            expected_total = sum(Decimal(op["amount"]) for op in expected_items)

            # Get filtered results from service
            result = service.list_financial_ops(
                filters=FinOpFilters(op_type=op_type),
                pagination=Pagination(page=1, page_size=100),
            )

            # Verify count matches
            assert result.total == len(expected_items), (
                f"op_type={op_type}: expected count {len(expected_items)}, got {result.total}"
            )

            # Sum amounts from filtered results using Decimal
            actual_total = sum(Decimal(item["amount"]) for item in result.items)

            # Decimal precision: totals must match exactly (no float rounding)
            assert actual_total == expected_total, (
                f"op_type={op_type}: expected sum {expected_total}, got {actual_total}"
            )

        # Clean up for test isolation
        for op in created_ops:
            service.delete_financial_op(op["id"], user_id=1)

    @settings(max_examples=15, suppress_health_check=[HealthCheck.function_scoped_fixture], deadline=None)
    @given(ops=st_financial_ops_list())
    def test_filter_by_date_range_returns_matching_items(self, service, ops):
        """For any set of financial operations with dates, filtering by date
        range returns exactly the items whose op_date falls within the range.

        **Validates: Requirements 11.2, 11.3**
        """
        # Create all operations
        created_ops = []
        for op_data in ops:
            result = service.create_financial_op(op_data, user_id=1)
            created_ops.append(result)

        # Pick a date range: use 2024-01-01 to 2024-12-31
        date_from = datetime(2024, 1, 1, tzinfo=timezone.utc)
        date_to = datetime(2024, 12, 31, 23, 59, 59, tzinfo=timezone.utc)

        # Expected: items whose op_date is within range
        expected_ids = set()
        for op in created_ops:
            if op["op_date"] is not None:
                # Parse the stored date string
                op_date_str = op["op_date"]
                # The service stores dates as ISO strings; parse year
                try:
                    if "2024" in op_date_str[:4]:
                        expected_ids.add(op["id"])
                except (TypeError, IndexError):
                    pass

        # Get filtered results
        result = service.list_financial_ops(
            filters=FinOpFilters(date_from=date_from, date_to=date_to),
            pagination=Pagination(page=1, page_size=100),
        )

        actual_ids = {item["id"] for item in result.items}

        # All returned items must be in expected set
        assert actual_ids == expected_ids, (
            f"Date filter mismatch: expected {expected_ids}, got {actual_ids}"
        )

        # Verify sum uses Decimal precision
        expected_sum = sum(
            Decimal(op["amount"]) for op in created_ops if op["id"] in expected_ids
        )
        actual_sum = sum(Decimal(item["amount"]) for item in result.items)
        assert actual_sum == expected_sum

        # Clean up
        for op in created_ops:
            service.delete_financial_op(op["id"], user_id=1)

    @settings(max_examples=15, suppress_health_check=[HealthCheck.function_scoped_fixture], deadline=None)
    @given(amounts=st.lists(st_amount, min_size=1, max_size=10))
    def test_total_sum_no_floating_point_loss(self, service, amounts):
        """The sum of all amounts stored and retrieved preserves exact Decimal
        precision — no floating-point rounding errors.

        **Validates: Requirements 11.2, 11.3**
        """
        created_ids = []
        for amount in amounts:
            result = service.create_financial_op(
                {"op_type": "loss", "amount": str(amount)},
                user_id=1,
            )
            created_ids.append(result["id"])

        # Retrieve all
        result = service.list_financial_ops(
            filters=FinOpFilters(op_type="loss"),
            pagination=Pagination(page=1, page_size=100),
        )

        # Compute expected sum using Decimal arithmetic
        expected_sum = sum(amounts)
        actual_sum = sum(Decimal(item["amount"]) for item in result.items)

        assert actual_sum == expected_sum, (
            f"Decimal precision lost: expected {expected_sum}, got {actual_sum}"
        )

        # Clean up
        for op_id in created_ids:
            service.delete_financial_op(op_id, user_id=1)


# ---------------------------------------------------------------------------
# Property 30: Financial operation CRUD integrity
#
# Create → verify all fields stored correctly
# Update → verify only specified fields change
# Soft delete → verify excluded from default list, included with include_deleted=True
# Verify negative amounts rejected
# Verify invalid op_type rejected
#
# **Validates: Requirements 11.2, 11.3**
# ---------------------------------------------------------------------------


class TestProperty30CRUDIntegrity:
    """Property 30: Financial operation CRUD integrity."""

    @settings(max_examples=15, suppress_health_check=[HealthCheck.function_scoped_fixture], deadline=None)
    @given(op_data=st_financial_op())
    def test_create_stores_all_fields_correctly(self, service, op_data):
        """For any valid financial operation, create stores all fields correctly
        and they can be retrieved unchanged.

        **Validates: Requirements 11.2, 11.3**
        """
        created = service.create_financial_op(op_data, user_id=1)

        # Verify all fields stored correctly
        assert created["op_type"] == op_data["op_type"]
        assert Decimal(created["amount"]) == Decimal(op_data["amount"])
        assert created["is_deleted"] is False
        assert created["id"] is not None

        # Reason normalization: strip + empty→None
        expected_reason = op_data["reason"]
        if expected_reason:
            expected_reason = expected_reason.strip()[:500]
            if not expected_reason:
                expected_reason = None
        assert created["reason"] == expected_reason

        # op_date should be stored
        assert created["op_date"] is not None

        # Clean up
        service.delete_financial_op(created["id"], user_id=1)

    @settings(max_examples=15, suppress_health_check=[HealthCheck.function_scoped_fixture], deadline=None)
    @given(op_data=st_financial_op(), new_amount=st_amount)
    def test_update_only_changes_specified_fields(self, service, op_data, new_amount):
        """Updating one field preserves all other unmodified fields.

        **Validates: Requirements 11.2, 11.3**
        """
        created = service.create_financial_op(op_data, user_id=1)

        # Update only the amount field
        updated = service.update_financial_op(
            created["id"],
            {"amount": str(new_amount)},
            user_id=1,
        )

        # Verify amount was updated
        assert Decimal(updated["amount"]) == new_amount

        # Verify all other fields are preserved
        assert updated["op_type"] == created["op_type"]
        assert updated["reason"] == created["reason"]
        assert updated["request_id"] == created["request_id"]
        assert updated["employee_id"] == created["employee_id"]
        assert updated["object_id"] == created["object_id"]
        assert updated["refund_status"] == created["refund_status"]
        assert updated["is_deleted"] == created["is_deleted"]

        # Clean up
        service.delete_financial_op(created["id"], user_id=1)

    @settings(max_examples=15, suppress_health_check=[HealthCheck.function_scoped_fixture], deadline=None)
    @given(op_data=st_financial_op())
    def test_soft_delete_excludes_from_default_includes_with_flag(self, service, op_data):
        """After soft-delete, the operation is excluded from default listing
        but included with include_deleted=True.

        **Validates: Requirements 11.2, 11.3**
        """
        # Create
        created = service.create_financial_op(op_data, user_id=1)
        op_id = created["id"]

        # Verify it appears in default listing
        before_delete = service.list_financial_ops(
            pagination=Pagination(page=1, page_size=100),
        )
        ids_before = [item["id"] for item in before_delete.items]
        assert op_id in ids_before

        # Soft-delete
        service.delete_financial_op(op_id, user_id=1)

        # Verify excluded from default listing
        after_delete = service.list_financial_ops(
            pagination=Pagination(page=1, page_size=100),
        )
        ids_after = [item["id"] for item in after_delete.items]
        assert op_id not in ids_after

        # Verify included with include_deleted=True
        with_deleted = service.list_financial_ops(
            filters=FinOpFilters(include_deleted=True),
            pagination=Pagination(page=1, page_size=100),
        )
        ids_with_deleted = [item["id"] for item in with_deleted.items]
        assert op_id in ids_with_deleted

        # Verify is_deleted flag is True
        deleted_item = next(item for item in with_deleted.items if item["id"] == op_id)
        assert deleted_item["is_deleted"] is True

    @settings(max_examples=15, suppress_health_check=[HealthCheck.function_scoped_fixture], deadline=None)
    @given(
        amount=st.decimals(
            min_value=Decimal("0.01"), max_value=Decimal("999999"),
            places=2, allow_nan=False, allow_infinity=False,
        )
    )
    def test_negative_amounts_rejected(self, service, amount):
        """Negative amounts are always rejected by create_financial_op.

        **Validates: Requirements 11.2, 11.3**
        """
        negative_amount = -amount

        with pytest.raises(TicketsValidationError) as exc_info:
            service.create_financial_op(
                {"op_type": "refund", "amount": str(negative_amount)},
                user_id=1,
            )
        assert "negative" in str(exc_info.value).lower()

    @settings(max_examples=15, suppress_health_check=[HealthCheck.function_scoped_fixture], deadline=None)
    @given(
        invalid_type=st.text(min_size=1, max_size=20).filter(
            lambda t: t not in {"refund", "exchange", "loss"}
        )
    )
    def test_invalid_op_type_rejected(self, service, invalid_type):
        """Invalid op_type values are always rejected.

        **Validates: Requirements 11.2, 11.3**
        """
        with pytest.raises(TicketsValidationError) as exc_info:
            service.create_financial_op(
                {"op_type": invalid_type, "amount": "100.00"},
                user_id=1,
            )
        assert "op_type" in str(exc_info.value).lower()
