"""Tests for TicketsService.change_status() with simplified status workflow."""
from __future__ import annotations

import sys
from contextlib import contextmanager
from pathlib import Path

import pytest
from sqlalchemy import create_engine, event, select
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
    TicketsConflictError,
    TicketsNotFoundError,
    TicketsService,
    TicketsTransitionError,
    TicketsValidationError,
)


def _sqlite_url(temp_dir: str) -> str:
    return f"sqlite:///{(Path(temp_dir) / 'tickets_status.db').as_posix()}"


@pytest.fixture
def service(temp_dir, monkeypatch):
    import backend.appdb.db as appdb

    url = _sqlite_url(temp_dir)
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

    with _test_app_session() as session:
        session.add_all([
            AppUser(id=1, username="admin", full_name="Admin User", role="admin"),
            AppUser(id=2, username="operator", full_name="Operator User", role="operator"),
        ])
        emp = TicketEmployee(full_name="Иванов Иван Иванович", phone="+79001234567", status="active")
        session.add(emp)
        session.flush()
        emp_id = emp.id
        obj = TicketObject(code="KAM", name="Камчатка", region="Дальний Восток", is_active=True)
        session.add(obj)
        session.flush()
        obj_id = obj.id

    svc = TicketsService()
    svc._seed = {
        "admin_user": {"id": 1, "role": "admin"},
        "operator_user": {"id": 2, "role": "operator"},
        "emp_id": emp_id,
        "obj_id": obj_id,
    }
    svc._session_factory = _test_app_session
    return svc


def _create_request(service, status="not_started") -> dict:
    seed = service._seed
    dto = CreateRequestDTO(
        employee_id=seed["emp_id"],
        object_id=seed["obj_id"],
        status=status,
    )
    return service.create_request(dto)


class TestStatusTransitionsValid:
    def test_not_started_to_at_cashier(self, service):
        req = _create_request(service)
        result = service.change_status(
            request_id=req["id"],
            new_status="at_cashier",
            user=service._seed["operator_user"],
            expected_version=req["version"],
        )
        assert result["status"] == "at_cashier"

    def test_at_cashier_to_purchased(self, service):
        req = _create_request(service, status="at_cashier")
        result = service.change_status(
            request_id=req["id"],
            new_status="purchased",
            user=service._seed["operator_user"],
            expected_version=req["version"],
        )
        assert result["status"] == "purchased"

    def test_purchased_to_exchange_needed(self, service):
        req = _create_request(service, status="purchased")
        result = service.change_status(
            request_id=req["id"],
            new_status="exchange_needed",
            user=service._seed["operator_user"],
            expected_version=req["version"],
        )
        assert result["status"] == "exchange_needed"

    def test_exchange_needed_to_at_cashier(self, service):
        req = _create_request(service, status="exchange_needed")
        result = service.change_status(
            request_id=req["id"],
            new_status="at_cashier",
            user=service._seed["operator_user"],
            expected_version=req["version"],
        )
        assert result["status"] == "at_cashier"


class TestStatusTransitionsInvalid:
    def test_not_started_to_purchased_rejected(self, service):
        req = _create_request(service)
        with pytest.raises(TicketsTransitionError) as exc_info:
            service.change_status(
                request_id=req["id"],
                new_status="purchased",
                user=service._seed["operator_user"],
                expected_version=req["version"],
            )
        assert exc_info.value.current_status == "not_started"
        assert "at_cashier" in exc_info.value.allowed

    def test_refund_needed_terminal(self, service):
        req = _create_request(service, status="refund_needed")
        with pytest.raises(TicketsTransitionError):
            service.change_status(
                request_id=req["id"],
                new_status="purchased",
                user=service._seed["operator_user"],
                expected_version=req["version"],
            )


class TestAdminBypass:
    def test_admin_can_skip_transitions(self, service):
        req = _create_request(service)
        result = service.change_status(
            request_id=req["id"],
            new_status="purchased",
            user=service._seed["admin_user"],
            expected_version=req["version"],
        )
        assert result["status"] == "purchased"


class TestOptimisticLocking:
    def test_conflict_on_stale_version(self, service):
        req = _create_request(service)
        service.change_status(
            request_id=req["id"],
            new_status="at_cashier",
            user=service._seed["operator_user"],
            expected_version=1,
        )
        with pytest.raises(TicketsConflictError):
            service.change_status(
                request_id=req["id"],
                new_status="purchased",
                user=service._seed["operator_user"],
                expected_version=1,
            )


class TestHistoryRecord:
    def test_history_record_created(self, service):
        req = _create_request(service)
        service.change_status(
            request_id=req["id"],
            new_status="at_cashier",
            user=service._seed["operator_user"],
            expected_version=req["version"],
        )
        with service._session_factory() as session:
            history = session.scalars(
                select(TicketChangeHistory).where(TicketChangeHistory.request_id == req["id"])
            ).all()
            assert len(history) == 1
            assert history[0].old_value == "not_started"
            assert history[0].new_value == "at_cashier"


class TestSystemComment:
    def test_system_comment_created(self, service):
        req = _create_request(service)
        service.change_status(
            request_id=req["id"],
            new_status="at_cashier",
            user=service._seed["operator_user"],
            expected_version=req["version"],
        )
        with service._session_factory() as session:
            comments = session.scalars(
                select(TicketComment).where(
                    TicketComment.request_id == req["id"],
                    TicketComment.comment_type == "system",
                )
            ).all()
            assert len(comments) == 1


class TestNotFound:
    def test_nonexistent_request(self, service):
        with pytest.raises(TicketsNotFoundError):
            service.change_status(
                request_id=99999,
                new_status="at_cashier",
                user=service._seed["operator_user"],
                expected_version=1,
            )

    def test_invalid_status_value(self, service):
        req = _create_request(service)
        with pytest.raises(TicketsValidationError):
            service.change_status(
                request_id=req["id"],
                new_status="bogus",
                user=service._seed["operator_user"],
                expected_version=req["version"],
            )
