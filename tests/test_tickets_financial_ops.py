"""Tests for TicketsService financial operations CRUD (task 5.2).

Tests cover:
- create_financial_op() with validation
- update_financial_op() with allowed fields
- list_financial_ops() with filters and pagination
- delete_financial_op() soft delete
- Decimal(12,2) precision for amounts
- FK references (request_id, employee_id, object_id)
- Filters: request_id, employee_id, object_id, op_type, refund_status, date range, include_deleted
"""
from __future__ import annotations

import sys
from contextlib import contextmanager
from datetime import datetime, timezone, timedelta
from decimal import Decimal
from pathlib import Path

import pytest

PROJECT_ROOT = Path(__file__).resolve().parents[1]
WEB_ROOT = PROJECT_ROOT / "WEB-itinvent"

if str(WEB_ROOT) not in sys.path:
    sys.path.insert(0, str(WEB_ROOT))

from backend.appdb.models import AppBase
from backend.appdb.tickets_models import TicketFinancialOp, TicketObject, TicketEmployee, TicketRequest
from backend.services.tickets_service import (
    FinOpFilters,
    Pagination,
    TicketsNotFoundError,
    TicketsService,
    TicketsValidationError,
)


def _sqlite_url(temp_dir: str) -> str:
    return f"sqlite:///{(Path(temp_dir) / 'tickets_finops.db').as_posix()}"


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


@pytest.fixture
def seed_data(service, temp_dir, monkeypatch):
    """Seed some reference data (object, employee, request) for FK tests."""
    from sqlalchemy import create_engine, event
    from sqlalchemy.orm import sessionmaker

    url = _sqlite_url(temp_dir)
    engine = create_engine(
        url,
        execution_options={"schema_translate_map": {"app": None, "system": None}},
    )
    SessionLocal = sessionmaker(bind=engine)

    @contextmanager
    def _session():
        session = SessionLocal()
        try:
            yield session
            session.commit()
        except Exception:
            session.rollback()
            raise
        finally:
            session.close()

    now = datetime.now(timezone.utc)

    with _session() as session:
        obj = TicketObject(
            code="KAM",
            name="Камчатка",
            region="Дальний Восток",
            is_active=True,
            created_at=now,
            updated_at=now,
        )
        session.add(obj)
        session.flush()
        obj_id = obj.id

        emp = TicketEmployee(
            full_name="Иванов Иван Иванович",
            date_of_birth_enc="",
            status="active",
            created_at=now,
            updated_at=now,
        )
        session.add(emp)
        session.flush()
        emp_id = emp.id

        req = TicketRequest(
            employee_id=emp_id,
            object_id=obj_id,
            status="new",
            total_cost=Decimal("0.00"),
            is_urgent=False,
            needs_review=False,
            source="manual",
            version=1,
            created_at=now,
            updated_at=now,
        )
        session.add(req)
        session.flush()
        req_id = req.id

    return {"object_id": obj_id, "employee_id": emp_id, "request_id": req_id}


# ---------------------------------------------------------------------------
# create_financial_op tests
# ---------------------------------------------------------------------------


class TestCreateFinancialOp:
    def test_create_basic_refund(self, service):
        result = service.create_financial_op(
            {"op_type": "refund", "amount": "1500.50", "reason": "Отмена рейса"},
            user_id=1,
        )
        assert result["op_type"] == "refund"
        assert result["amount"] == "1500.50"
        assert result["reason"] == "Отмена рейса"
        assert result["is_deleted"] is False
        assert result["id"] is not None

    def test_create_exchange(self, service):
        result = service.create_financial_op(
            {"op_type": "exchange", "amount": "200.00"},
            user_id=1,
        )
        assert result["op_type"] == "exchange"
        assert result["amount"] == "200.00"

    def test_create_loss(self, service):
        result = service.create_financial_op(
            {"op_type": "loss", "amount": "3000.00", "reason": "Неиспользованный билет"},
            user_id=1,
        )
        assert result["op_type"] == "loss"

    def test_create_with_fk_references(self, service, seed_data):
        result = service.create_financial_op(
            {
                "op_type": "refund",
                "amount": "500.00",
                "request_id": seed_data["request_id"],
                "employee_id": seed_data["employee_id"],
                "object_id": seed_data["object_id"],
            },
            user_id=1,
        )
        assert result["request_id"] == seed_data["request_id"]
        assert result["employee_id"] == seed_data["employee_id"]
        assert result["object_id"] == seed_data["object_id"]

    def test_create_with_op_date_and_refund_status(self, service):
        result = service.create_financial_op(
            {
                "op_type": "refund",
                "amount": "1000.00",
                "op_date": "2024-06-15",
                "refund_status": "pending",
            },
            user_id=1,
        )
        assert result["refund_status"] == "pending"
        assert result["op_date"] is not None

    def test_create_invalid_op_type_raises(self, service):
        with pytest.raises(TicketsValidationError) as exc_info:
            service.create_financial_op(
                {"op_type": "invalid_type", "amount": "100.00"},
                user_id=1,
            )
        assert "op_type" in str(exc_info.value)

    def test_create_missing_op_type_raises(self, service):
        with pytest.raises(TicketsValidationError) as exc_info:
            service.create_financial_op(
                {"amount": "100.00"},
                user_id=1,
            )
        assert "op_type is required" in str(exc_info.value)

    def test_create_negative_amount_raises(self, service):
        with pytest.raises(TicketsValidationError) as exc_info:
            service.create_financial_op(
                {"op_type": "refund", "amount": "-100.00"},
                user_id=1,
            )
        assert "negative" in str(exc_info.value)

    def test_create_decimal_precision(self, service):
        result = service.create_financial_op(
            {"op_type": "loss", "amount": "12345.67"},
            user_id=1,
        )
        assert result["amount"] == "12345.67"

    def test_create_zero_amount(self, service):
        result = service.create_financial_op(
            {"op_type": "refund", "amount": "0.00"},
            user_id=1,
        )
        assert result["amount"] == "0.00"

    def test_create_default_amount_when_not_provided(self, service):
        result = service.create_financial_op(
            {"op_type": "refund"},
            user_id=1,
        )
        assert result["amount"] == "0.00"


# ---------------------------------------------------------------------------
# update_financial_op tests
# ---------------------------------------------------------------------------


class TestUpdateFinancialOp:
    def test_update_amount(self, service):
        created = service.create_financial_op(
            {"op_type": "refund", "amount": "100.00"},
            user_id=1,
        )
        updated = service.update_financial_op(
            created["id"], {"amount": "250.75"}, user_id=1
        )
        assert updated["amount"] == "250.75"

    def test_update_reason(self, service):
        created = service.create_financial_op(
            {"op_type": "loss", "amount": "500.00", "reason": "Old reason"},
            user_id=1,
        )
        updated = service.update_financial_op(
            created["id"], {"reason": "New reason"}, user_id=1
        )
        assert updated["reason"] == "New reason"

    def test_update_refund_status(self, service):
        created = service.create_financial_op(
            {"op_type": "refund", "amount": "100.00", "refund_status": "pending"},
            user_id=1,
        )
        updated = service.update_financial_op(
            created["id"], {"refund_status": "completed"}, user_id=1
        )
        assert updated["refund_status"] == "completed"

    def test_update_op_date(self, service):
        created = service.create_financial_op(
            {"op_type": "refund", "amount": "100.00"},
            user_id=1,
        )
        updated = service.update_financial_op(
            created["id"], {"op_date": "2024-03-15"}, user_id=1
        )
        assert "2024-03-15" in updated["op_date"]

    def test_update_op_type(self, service):
        created = service.create_financial_op(
            {"op_type": "refund", "amount": "100.00"},
            user_id=1,
        )
        updated = service.update_financial_op(
            created["id"], {"op_type": "exchange"}, user_id=1
        )
        assert updated["op_type"] == "exchange"

    def test_update_not_found_raises(self, service):
        with pytest.raises(TicketsNotFoundError):
            service.update_financial_op(99999, {"amount": "100.00"}, user_id=1)

    def test_update_deleted_raises(self, service):
        created = service.create_financial_op(
            {"op_type": "refund", "amount": "100.00"},
            user_id=1,
        )
        service.delete_financial_op(created["id"], user_id=1)
        with pytest.raises(TicketsNotFoundError):
            service.update_financial_op(created["id"], {"amount": "200.00"}, user_id=1)

    def test_update_invalid_op_type_raises(self, service):
        created = service.create_financial_op(
            {"op_type": "refund", "amount": "100.00"},
            user_id=1,
        )
        with pytest.raises(TicketsValidationError):
            service.update_financial_op(
                created["id"], {"op_type": "invalid"}, user_id=1
            )


# ---------------------------------------------------------------------------
# list_financial_ops tests
# ---------------------------------------------------------------------------


class TestListFinancialOps:
    def test_list_empty(self, service):
        result = service.list_financial_ops()
        assert result.items == []
        assert result.total == 0

    def test_list_returns_created_ops(self, service):
        service.create_financial_op({"op_type": "refund", "amount": "100.00"}, user_id=1)
        service.create_financial_op({"op_type": "loss", "amount": "200.00"}, user_id=1)

        result = service.list_financial_ops()
        assert result.total == 2
        assert len(result.items) == 2

    def test_list_excludes_deleted_by_default(self, service):
        op1 = service.create_financial_op({"op_type": "refund", "amount": "100.00"}, user_id=1)
        service.create_financial_op({"op_type": "loss", "amount": "200.00"}, user_id=1)
        service.delete_financial_op(op1["id"], user_id=1)

        result = service.list_financial_ops()
        assert result.total == 1
        assert result.items[0]["op_type"] == "loss"

    def test_list_include_deleted(self, service):
        op1 = service.create_financial_op({"op_type": "refund", "amount": "100.00"}, user_id=1)
        service.create_financial_op({"op_type": "loss", "amount": "200.00"}, user_id=1)
        service.delete_financial_op(op1["id"], user_id=1)

        result = service.list_financial_ops(filters=FinOpFilters(include_deleted=True))
        assert result.total == 2

    def test_filter_by_op_type(self, service):
        service.create_financial_op({"op_type": "refund", "amount": "100.00"}, user_id=1)
        service.create_financial_op({"op_type": "loss", "amount": "200.00"}, user_id=1)
        service.create_financial_op({"op_type": "exchange", "amount": "300.00"}, user_id=1)

        result = service.list_financial_ops(filters=FinOpFilters(op_type="loss"))
        assert result.total == 1
        assert result.items[0]["op_type"] == "loss"

    def test_filter_by_request_id(self, service, seed_data):
        service.create_financial_op(
            {"op_type": "refund", "amount": "100.00", "request_id": seed_data["request_id"]},
            user_id=1,
        )
        service.create_financial_op({"op_type": "loss", "amount": "200.00"}, user_id=1)

        result = service.list_financial_ops(
            filters=FinOpFilters(request_id=seed_data["request_id"])
        )
        assert result.total == 1
        assert result.items[0]["request_id"] == seed_data["request_id"]

    def test_filter_by_employee_id(self, service, seed_data):
        service.create_financial_op(
            {"op_type": "refund", "amount": "100.00", "employee_id": seed_data["employee_id"]},
            user_id=1,
        )
        service.create_financial_op({"op_type": "loss", "amount": "200.00"}, user_id=1)

        result = service.list_financial_ops(
            filters=FinOpFilters(employee_id=seed_data["employee_id"])
        )
        assert result.total == 1
        assert result.items[0]["employee_id"] == seed_data["employee_id"]

    def test_filter_by_object_id(self, service, seed_data):
        service.create_financial_op(
            {"op_type": "refund", "amount": "100.00", "object_id": seed_data["object_id"]},
            user_id=1,
        )
        service.create_financial_op({"op_type": "loss", "amount": "200.00"}, user_id=1)

        result = service.list_financial_ops(
            filters=FinOpFilters(object_id=seed_data["object_id"])
        )
        assert result.total == 1
        assert result.items[0]["object_id"] == seed_data["object_id"]

    def test_filter_by_refund_status(self, service):
        service.create_financial_op(
            {"op_type": "refund", "amount": "100.00", "refund_status": "pending"},
            user_id=1,
        )
        service.create_financial_op(
            {"op_type": "refund", "amount": "200.00", "refund_status": "completed"},
            user_id=1,
        )

        result = service.list_financial_ops(
            filters=FinOpFilters(refund_status="pending")
        )
        assert result.total == 1
        assert result.items[0]["refund_status"] == "pending"

    def test_filter_by_date_range(self, service):
        service.create_financial_op(
            {"op_type": "refund", "amount": "100.00", "op_date": "2024-01-15"},
            user_id=1,
        )
        service.create_financial_op(
            {"op_type": "loss", "amount": "200.00", "op_date": "2024-06-15"},
            user_id=1,
        )
        service.create_financial_op(
            {"op_type": "exchange", "amount": "300.00", "op_date": "2024-12-15"},
            user_id=1,
        )

        date_from = datetime(2024, 3, 1, tzinfo=timezone.utc)
        date_to = datetime(2024, 9, 30, tzinfo=timezone.utc)

        result = service.list_financial_ops(
            filters=FinOpFilters(date_from=date_from, date_to=date_to)
        )
        assert result.total == 1
        assert result.items[0]["op_type"] == "loss"

    def test_pagination(self, service):
        for i in range(30):
            service.create_financial_op(
                {"op_type": "refund", "amount": str(i * 10)},
                user_id=1,
            )

        page1 = service.list_financial_ops(pagination=Pagination(page=1, page_size=25))
        assert len(page1.items) == 25
        assert page1.total == 30
        assert page1.total_pages == 2

        page2 = service.list_financial_ops(pagination=Pagination(page=2, page_size=25))
        assert len(page2.items) == 5


# ---------------------------------------------------------------------------
# delete_financial_op tests
# ---------------------------------------------------------------------------


class TestDeleteFinancialOp:
    def test_soft_delete(self, service):
        created = service.create_financial_op(
            {"op_type": "refund", "amount": "100.00"},
            user_id=1,
        )
        service.delete_financial_op(created["id"], user_id=1)

        # Should not appear in default list
        result = service.list_financial_ops()
        assert result.total == 0

        # Should appear with include_deleted
        result = service.list_financial_ops(filters=FinOpFilters(include_deleted=True))
        assert result.total == 1
        assert result.items[0]["is_deleted"] is True

    def test_delete_not_found_raises(self, service):
        with pytest.raises(TicketsNotFoundError):
            service.delete_financial_op(99999, user_id=1)

    def test_delete_already_deleted_raises(self, service):
        created = service.create_financial_op(
            {"op_type": "refund", "amount": "100.00"},
            user_id=1,
        )
        service.delete_financial_op(created["id"], user_id=1)
        with pytest.raises(TicketsNotFoundError):
            service.delete_financial_op(created["id"], user_id=1)
