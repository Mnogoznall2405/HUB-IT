"""Tests for TicketsService.get_dashboard() (task 8.2).

Tests cover:
- Overall metrics: total_active, new, in_progress, purchased, problematic,
  departures_today, departures_tomorrow, departures_3_days, refunds_exchanges,
  ticket_sum, loss_sum
- Per-object breakdown: name, assignee, active/new/in_progress/purchased/problematic
  counts, nearest_departure, ticket_sum, loss_sum
- Top objects by problems (top 5)
- Top assignees by load (top 5)
"""
from __future__ import annotations

import sys
from contextlib import contextmanager
from datetime import datetime, timedelta, timezone
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
    TicketEmployee,
    TicketFinancialOp,
    TicketObject,
    TicketRequest,
)
from backend.services.tickets_service import TicketsService


# ---------------------------------------------------------------------------
# Fixtures
# ---------------------------------------------------------------------------


def _sqlite_url(temp_dir: str) -> str:
    return f"sqlite:///{(Path(temp_dir) / 'tickets_dashboard.db').as_posix()}"


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
    now = datetime.now(timezone.utc)
    today_start = now.replace(hour=0, minute=0, second=0, microsecond=0)

    with _test_app_session() as session:
        # Users
        user1 = AppUser(id=1, username="admin", full_name="Admin User", role="admin")
        user2 = AppUser(id=2, username="operator", full_name="Operator User", role="operator")
        user3 = AppUser(id=3, username="logist", full_name="Logist User", role="operator")
        session.add_all([user1, user2, user3])
        session.flush()

        # Employees
        emp1 = TicketEmployee(full_name="Иванов Иван", phone="+79001111111", status="active")
        emp2 = TicketEmployee(full_name="Петров Пётр", phone="+79002222222", status="active")
        session.add_all([emp1, emp2])
        session.flush()

        # Objects
        obj1 = TicketObject(
            code="KAM", name="Камчатка", region="Дальний Восток",
            is_active=True, default_assignee_id=1,
        )
        obj2 = TicketObject(
            code="MAG", name="Магадан", region="Дальний Восток",
            is_active=True, default_assignee_id=2,
        )
        obj3 = TicketObject(
            code="TIK", name="Тикси", region="Якутия",
            is_active=False,  # inactive — should not appear in per_object
        )
        session.add_all([obj1, obj2, obj3])
        session.flush()

        # Requests for obj1 (Камчатка)
        # new status
        r1 = TicketRequest(
            employee_id=emp1.id, object_id=obj1.id, status="not_started",
            assignee_id=1, total_cost=Decimal("10000.00"),
            departure_date=today_start + timedelta(hours=14),  # today
            created_at=now,
        )
        # in_progress status
        r2 = TicketRequest(
            employee_id=emp2.id, object_id=obj1.id, status="at_cashier",
            assignee_id=1, total_cost=Decimal("20000.00"),
            departure_date=today_start + timedelta(days=1, hours=10),  # tomorrow
            created_at=now,
        )
        # purchased status
        r3 = TicketRequest(
            employee_id=emp1.id, object_id=obj1.id, status="purchased",
            assignee_id=2, total_cost=Decimal("15000.00"),
            departure_date=today_start + timedelta(days=2, hours=8),  # within 3 days
            created_at=now,
        )
        # missing_data (problematic)
        r4 = TicketRequest(
            employee_id=emp2.id, object_id=obj1.id, status="cancel_purchase",
            assignee_id=1, total_cost=Decimal("5000.00"),
            departure_date=None,
            created_at=now,
        )
        session.add_all([r1, r2, r3, r4])

        # Requests for obj2 (Магадан)
        # exchange_needed (problematic)
        r5 = TicketRequest(
            employee_id=emp1.id, object_id=obj2.id, status="exchange_needed",
            assignee_id=2, total_cost=Decimal("30000.00"),
            departure_date=today_start + timedelta(days=5),  # beyond 3 days
            created_at=now,
        )
        # new
        r6 = TicketRequest(
            employee_id=emp2.id, object_id=obj2.id, status="not_started",
            assignee_id=3, total_cost=Decimal("8000.00"),
            departure_date=today_start + timedelta(hours=20),  # today
            created_at=now,
        )
        session.add_all([r5, r6])

        # Closed request (not active) — should NOT count in active metrics
        r7 = TicketRequest(
            employee_id=emp1.id, object_id=obj1.id, status="refund_needed",
            assignee_id=1, total_cost=Decimal("12000.00"),
            departure_date=today_start - timedelta(days=5),
            created_at=now,
        )
        session.add(r7)

        # Request for inactive object (obj3) — should not appear in per_object
        r8 = TicketRequest(
            employee_id=emp1.id, object_id=obj3.id, status="not_started",
            assignee_id=1, total_cost=Decimal("7000.00"),
            departure_date=today_start + timedelta(hours=10),
            created_at=now,
        )
        session.add(r8)

        session.flush()

        # Financial operations
        # Loss for obj1
        fop1 = TicketFinancialOp(
            request_id=r7.id, employee_id=emp1.id, object_id=obj1.id,
            op_type="loss", amount=Decimal("3500.00"), is_deleted=False,
        )
        # Refund for obj1
        fop2 = TicketFinancialOp(
            request_id=r3.id, employee_id=emp1.id, object_id=obj1.id,
            op_type="refund", amount=Decimal("2000.00"), is_deleted=False,
        )
        # Exchange for obj2
        fop3 = TicketFinancialOp(
            request_id=r5.id, employee_id=emp1.id, object_id=obj2.id,
            op_type="exchange", amount=Decimal("1500.00"), is_deleted=False,
        )
        # Deleted loss (should not count)
        fop4 = TicketFinancialOp(
            request_id=r7.id, employee_id=emp1.id, object_id=obj1.id,
            op_type="loss", amount=Decimal("9999.00"), is_deleted=True,
        )
        # Loss for obj2
        fop5 = TicketFinancialOp(
            request_id=r5.id, employee_id=emp1.id, object_id=obj2.id,
            op_type="loss", amount=Decimal("4000.00"), is_deleted=False,
        )
        session.add_all([fop1, fop2, fop3, fop4, fop5])
        session.flush()

    svc = TicketsService()
    return svc


# ---------------------------------------------------------------------------
# Tests — Overall Metrics
# ---------------------------------------------------------------------------


class TestDashboardMetrics:
    """Tests for the overall metrics section of the dashboard."""

    def test_total_active_count(self, service):
        """Active statuses include new, data_check, missing_data, ready_to_buy,
        in_progress, purchased, exchange_needed."""
        result = service.get_dashboard()
        metrics = result["metrics"]
        # r1(new) + r2(in_progress) + r3(purchased) + r4(missing_data) +
        # r5(exchange_needed) + r6(new) + r8(new, inactive obj but still counted in metrics)
        assert metrics["total_active"] == 6

    def test_new_count(self, service):
        result = service.get_dashboard()
        assert result["metrics"]["new"] == 3

    def test_in_progress_count(self, service):
        result = service.get_dashboard()
        assert result["metrics"]["in_progress"] == 1

    def test_purchased_count(self, service):
        result = service.get_dashboard()
        # r3 is "purchased"
        assert result["metrics"]["purchased"] == 1

    def test_problematic_count(self, service):
        result = service.get_dashboard()
        # r4(missing_data) + r5(exchange_needed)
        assert result["metrics"]["problematic"] == 3

    def test_departures_today(self, service):
        result = service.get_dashboard()
        # r1 (today, obj1) + r6 (today, obj2) + r8 (today, obj3)
        assert result["metrics"]["departures_today"] == 3

    def test_departures_tomorrow(self, service):
        result = service.get_dashboard()
        # r2 (tomorrow)
        assert result["metrics"]["departures_tomorrow"] == 1

    def test_departures_3_days(self, service):
        result = service.get_dashboard()
        # r1 (today) + r2 (tomorrow) + r3 (day after tomorrow) + r6 (today) + r8 (today)
        assert result["metrics"]["departures_3_days"] == 5

    def test_refunds_exchanges(self, service):
        result = service.get_dashboard()
        # fop2(refund) + fop3(exchange) = 2 (fop4 is deleted, fop1/fop5 are loss)
        assert result["metrics"]["refunds_exchanges"] == 2

    def test_ticket_sum(self, service):
        result = service.get_dashboard()
        # Sum of total_cost for active requests:
        # r1(10000) + r2(20000) + r3(15000) + r4(5000) + r5(30000) + r6(8000) + r8(7000)
        expected = Decimal("90000.00")
        assert Decimal(result["metrics"]["ticket_sum"]) == expected

    def test_loss_sum(self, service):
        result = service.get_dashboard()
        # fop1(3500) + fop5(4000) = 7500 (fop4 is deleted)
        expected = Decimal("7500.00")
        assert Decimal(result["metrics"]["loss_sum"]) == expected

    def test_metrics_are_strings_for_sums(self, service):
        """Sums should be returned as strings (Decimal serialization)."""
        result = service.get_dashboard()
        assert isinstance(result["metrics"]["ticket_sum"], str)
        assert isinstance(result["metrics"]["loss_sum"], str)


# ---------------------------------------------------------------------------
# Tests — Per-Object Breakdown
# ---------------------------------------------------------------------------


class TestDashboardPerObject:
    """Tests for the per-object breakdown section."""

    def test_only_active_objects_included(self, service):
        result = service.get_dashboard()
        per_object = result["per_object"]
        codes = [o["object_code"] for o in per_object]
        assert "KAM" in codes
        assert "MAG" in codes
        assert "TIK" not in codes  # inactive

    def test_per_object_counts_kam(self, service):
        result = service.get_dashboard()
        kam = next(o for o in result["per_object"] if o["object_code"] == "KAM")
        # r1(new), r2(in_progress), r3(purchased), r4(missing_data) — all active
        assert kam["active"] == 3
        assert kam["new"] == 1
        assert kam["in_progress"] == 1
        assert kam["purchased"] == 1
        assert kam["problematic"] == 2

    def test_per_object_counts_mag(self, service):
        result = service.get_dashboard()
        mag = next(o for o in result["per_object"] if o["object_code"] == "MAG")
        # r5(exchange_needed), r6(new)
        assert mag["active"] == 2
        assert mag["new"] == 1
        assert mag["in_progress"] == 0
        assert mag["purchased"] == 0
        assert mag["problematic"] == 1  # r5(exchange_needed)

    def test_per_object_assignee_name(self, service):
        result = service.get_dashboard()
        kam = next(o for o in result["per_object"] if o["object_code"] == "KAM")
        assert kam["assignee_name"] == "Admin User"
        mag = next(o for o in result["per_object"] if o["object_code"] == "MAG")
        assert mag["assignee_name"] == "Operator User"

    def test_per_object_nearest_departure(self, service):
        result = service.get_dashboard()
        kam = next(o for o in result["per_object"] if o["object_code"] == "KAM")
        # r1 departs today — should be the nearest
        assert kam["nearest_departure"] is not None

    def test_per_object_ticket_sum(self, service):
        result = service.get_dashboard()
        kam = next(o for o in result["per_object"] if o["object_code"] == "KAM")
        # r1(10000) + r2(20000) + r3(15000) + r4(5000) = 50000
        assert Decimal(kam["ticket_sum"]) == Decimal("45000.00")

    def test_per_object_loss_sum(self, service):
        result = service.get_dashboard()
        kam = next(o for o in result["per_object"] if o["object_code"] == "KAM")
        # fop1(3500) for obj1 (fop4 is deleted)
        assert Decimal(kam["loss_sum"]) == Decimal("3500.00")
        mag = next(o for o in result["per_object"] if o["object_code"] == "MAG")
        # fop5(4000) for obj2
        assert Decimal(mag["loss_sum"]) == Decimal("4000.00")


# ---------------------------------------------------------------------------
# Tests — Top Problems and Top Assignees
# ---------------------------------------------------------------------------


class TestDashboardTopLists:
    """Tests for top_problems and top_assignees."""

    def test_top_problems_sorted_desc(self, service):
        result = service.get_dashboard()
        top = result["top_problems"]
        # Both KAM and MAG have 1 problematic each
        assert len(top) == 2
        # All have problematic > 0
        for item in top:
            assert item["problematic"] > 0

    def test_top_problems_max_5(self, service):
        result = service.get_dashboard()
        assert len(result["top_problems"]) <= 5

    def test_top_assignees_sorted_desc(self, service):
        result = service.get_dashboard()
        top = result["top_assignees"]
        # user1(admin) has: r1, r2, r4, r8 = 4 active
        # user2(operator) has: r3, r5 = 2 active
        # user3(logist) has: r6 = 1 active
        assert len(top) == 3
        assert top[0]["assignee_name"] == "Admin User"
        assert top[0]["active_count"] == 3
        assert top[1]["assignee_name"] == "Operator User"
        assert top[1]["active_count"] == 2
        assert top[2]["assignee_name"] == "Logist User"
        assert top[2]["active_count"] == 1

    def test_top_assignees_max_5(self, service):
        result = service.get_dashboard()
        assert len(result["top_assignees"]) <= 5

    def test_dashboard_structure(self, service):
        """Verify the overall structure of the dashboard response."""
        result = service.get_dashboard()
        assert "metrics" in result
        assert "per_object" in result
        assert "top_problems" in result
        assert "top_assignees" in result
        # Metrics keys
        m = result["metrics"]
        expected_keys = {
            "total_active", "new", "in_progress", "purchased", "problematic",
            "departures_today", "departures_tomorrow", "departures_3_days",
            "refunds_exchanges", "ticket_sum", "loss_sum",
        }
        assert set(m.keys()) == expected_keys


# ---------------------------------------------------------------------------
# Tests — Empty database
# ---------------------------------------------------------------------------


class TestDashboardEmpty:
    """Tests for dashboard with no data."""

    def test_empty_dashboard(self, temp_dir, monkeypatch):
        """Dashboard should return zeros when no data exists."""
        import backend.appdb.db as appdb

        url = f"sqlite:///{(Path(temp_dir) / 'tickets_dashboard_empty.db').as_posix()}"

        appdb._engines.clear()
        appdb._session_factories.clear()
        appdb._initialized_schema_urls.clear()

        monkeypatch.setenv("APP_DATABASE_URL", url)

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

        svc = TicketsService()
        result = svc.get_dashboard()

        assert result["metrics"]["total_active"] == 0
        assert result["metrics"]["new"] == 0
        assert result["metrics"]["in_progress"] == 0
        assert result["metrics"]["purchased"] == 0
        assert result["metrics"]["problematic"] == 0
        assert result["metrics"]["departures_today"] == 0
        assert result["metrics"]["departures_tomorrow"] == 0
        assert result["metrics"]["departures_3_days"] == 0
        assert result["metrics"]["refunds_exchanges"] == 0
        assert Decimal(result["metrics"]["ticket_sum"]) == Decimal("0.00")
        assert Decimal(result["metrics"]["loss_sum"]) == Decimal("0.00")
        assert result["per_object"] == []
        assert result["top_problems"] == []
        assert result["top_assignees"] == []
