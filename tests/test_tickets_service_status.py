"""Tests for TicketsService.change_status() (task 2.2).

Tests cover:
- Status transitions validated against STATUS_TRANSITIONS matrix
- Admin role bypasses transition matrix
- Optimistic locking via version field (increment on success, conflict on mismatch)
- History record created on every status change
- System comment created on every status change
"""
from __future__ import annotations

import sys
from contextlib import contextmanager
from datetime import datetime, timezone
from decimal import Decimal
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
    STATUS_TRANSITIONS,
    CreateRequestDTO,
    TicketsConflictError,
    TicketsNotFoundError,
    TicketsService,
    TicketsTransitionError,
    TicketsValidationError,
)


# ---------------------------------------------------------------------------
# Fixtures
# ---------------------------------------------------------------------------


def _sqlite_url(temp_dir: str) -> str:
    return f"sqlite:///{(Path(temp_dir) / 'tickets_status.db').as_posix()}"


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
        admin_user = AppUser(id=1, username="admin", full_name="Admin User", role="admin")
        operator_user = AppUser(id=2, username="operator", full_name="Operator User", role="operator")
        session.add_all([admin_user, operator_user])
        session.flush()

        emp = TicketEmployee(
            full_name="Иванов Иван Иванович",
            phone="+79001234567",
            status="active",
        )
        session.add(emp)
        session.flush()
        emp_id = emp.id

        obj = TicketObject(
            code="KAM",
            name="Камчатка",
            region="Дальний Восток",
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


def _create_request(service, status="new") -> dict:
    """Helper to create a request with a given status."""
    seed = service._seed
    dto = CreateRequestDTO(
        employee_id=seed["emp_id"],
        object_id=seed["obj_id"],
        status=status,
    )
    return service.create_request(dto)


# ---------------------------------------------------------------------------
# Tests: Valid transitions
# ---------------------------------------------------------------------------


class TestStatusTransitionsValid:
    """Test that valid transitions succeed according to the state machine."""

    def test_new_to_data_check(self, service):
        req = _create_request(service, status="new")
        result = service.change_status(
            request_id=req["id"],
            new_status="data_check",
            user=service._seed["operator_user"],
            expected_version=req["version"],
        )
        assert result["status"] == "data_check"
        assert result["version"] == req["version"] + 1

    def test_new_to_missing_data(self, service):
        req = _create_request(service, status="new")
        result = service.change_status(
            request_id=req["id"],
            new_status="missing_data",
            user=service._seed["operator_user"],
            expected_version=req["version"],
        )
        assert result["status"] == "missing_data"

    def test_new_to_cancelled(self, service):
        req = _create_request(service, status="new")
        result = service.change_status(
            request_id=req["id"],
            new_status="cancelled",
            user=service._seed["operator_user"],
            expected_version=req["version"],
        )
        assert result["status"] == "cancelled"

    def test_data_check_to_ready_to_buy(self, service):
        req = _create_request(service, status="data_check")
        result = service.change_status(
            request_id=req["id"],
            new_status="ready_to_buy",
            user=service._seed["operator_user"],
            expected_version=req["version"],
        )
        assert result["status"] == "ready_to_buy"

    def test_purchased_to_exchange_needed(self, service):
        req = _create_request(service, status="purchased")
        result = service.change_status(
            request_id=req["id"],
            new_status="exchange_needed",
            user=service._seed["operator_user"],
            expected_version=req["version"],
        )
        assert result["status"] == "exchange_needed"

    def test_closed_to_archive(self, service):
        req = _create_request(service, status="closed")
        result = service.change_status(
            request_id=req["id"],
            new_status="archive",
            user=service._seed["operator_user"],
            expected_version=req["version"],
        )
        assert result["status"] == "archive"


# ---------------------------------------------------------------------------
# Tests: Invalid transitions
# ---------------------------------------------------------------------------


class TestStatusTransitionsInvalid:
    """Test that invalid transitions are rejected."""

    def test_new_to_purchased_rejected(self, service):
        req = _create_request(service, status="new")
        with pytest.raises(TicketsTransitionError) as exc_info:
            service.change_status(
                request_id=req["id"],
                new_status="purchased",
                user=service._seed["operator_user"],
                expected_version=req["version"],
            )
        assert exc_info.value.current_status == "new"
        assert exc_info.value.new_status == "purchased"
        assert "data_check" in exc_info.value.allowed

    def test_archive_to_any_rejected(self, service):
        req = _create_request(service, status="archive")
        with pytest.raises(TicketsTransitionError) as exc_info:
            service.change_status(
                request_id=req["id"],
                new_status="new",
                user=service._seed["operator_user"],
                expected_version=req["version"],
            )
        assert exc_info.value.allowed == []

    def test_invalid_status_value(self, service):
        req = _create_request(service, status="new")
        with pytest.raises(TicketsValidationError):
            service.change_status(
                request_id=req["id"],
                new_status="nonexistent_status",
                user=service._seed["operator_user"],
                expected_version=req["version"],
            )


# ---------------------------------------------------------------------------
# Tests: Admin bypass
# ---------------------------------------------------------------------------


class TestAdminBypass:
    """Test that admin role bypasses the transition matrix."""

    def test_admin_can_skip_transitions(self, service):
        """Admin can go from 'new' directly to 'purchased' (normally not allowed)."""
        req = _create_request(service, status="new")
        result = service.change_status(
            request_id=req["id"],
            new_status="purchased",
            user=service._seed["admin_user"],
            expected_version=req["version"],
        )
        assert result["status"] == "purchased"

    def test_admin_can_transition_from_archive(self, service):
        """Admin can transition from archive (normally no transitions allowed)."""
        req = _create_request(service, status="archive")
        result = service.change_status(
            request_id=req["id"],
            new_status="new",
            user=service._seed["admin_user"],
            expected_version=req["version"],
        )
        assert result["status"] == "new"

    def test_admin_still_validates_status_value(self, service):
        """Admin cannot set an invalid status value."""
        req = _create_request(service, status="new")
        with pytest.raises(TicketsValidationError):
            service.change_status(
                request_id=req["id"],
                new_status="bogus",
                user=service._seed["admin_user"],
                expected_version=req["version"],
            )


# ---------------------------------------------------------------------------
# Tests: Optimistic locking
# ---------------------------------------------------------------------------


class TestOptimisticLocking:
    """Test optimistic locking via version field."""

    def test_version_increments_on_success(self, service):
        req = _create_request(service, status="new")
        assert req["version"] == 1

        result = service.change_status(
            request_id=req["id"],
            new_status="data_check",
            user=service._seed["operator_user"],
            expected_version=1,
        )
        assert result["version"] == 2

    def test_conflict_on_stale_version(self, service):
        req = _create_request(service, status="new")

        # First change succeeds
        service.change_status(
            request_id=req["id"],
            new_status="data_check",
            user=service._seed["operator_user"],
            expected_version=1,
        )

        # Second change with stale version fails
        with pytest.raises(TicketsConflictError) as exc_info:
            service.change_status(
                request_id=req["id"],
                new_status="missing_data",
                user=service._seed["operator_user"],
                expected_version=1,  # stale!
            )
        assert exc_info.value.current_version == 2
        assert exc_info.value.expected_version == 1
        assert exc_info.value.current_status == "data_check"

    def test_sequential_changes_with_correct_versions(self, service):
        req = _create_request(service, status="new")

        r1 = service.change_status(
            request_id=req["id"],
            new_status="data_check",
            user=service._seed["operator_user"],
            expected_version=1,
        )
        assert r1["version"] == 2

        r2 = service.change_status(
            request_id=req["id"],
            new_status="ready_to_buy",
            user=service._seed["operator_user"],
            expected_version=2,
        )
        assert r2["version"] == 3
        assert r2["status"] == "ready_to_buy"


# ---------------------------------------------------------------------------
# Tests: History record creation
# ---------------------------------------------------------------------------


class TestHistoryRecord:
    """Test that a TicketChangeHistory record is created on every status change."""

    def test_history_record_created(self, service, temp_dir, monkeypatch):
        req = _create_request(service, status="new")
        service.change_status(
            request_id=req["id"],
            new_status="data_check",
            user=service._seed["operator_user"],
            expected_version=req["version"],
        )

        # Query history directly
        with service._session_factory() as session:
            history = session.scalars(
                select(TicketChangeHistory).where(
                    TicketChangeHistory.request_id == req["id"]
                )
            ).all()
            assert len(history) == 1
            record = history[0]
            assert record.field_name == "status"
            assert record.old_value == "new"
            assert record.new_value == "data_check"
            assert record.changed_by_id == 2  # operator user
            assert record.source == "manual"

    def test_history_record_with_comment(self, service, temp_dir, monkeypatch):
        req = _create_request(service, status="new")
        service.change_status(
            request_id=req["id"],
            new_status="cancelled",
            user=service._seed["operator_user"],
            expected_version=req["version"],
            comment="Клиент отказался",
        )

        with service._session_factory() as session:
            history = session.scalars(
                select(TicketChangeHistory).where(
                    TicketChangeHistory.request_id == req["id"]
                )
            ).first()
            assert history.comment == "Клиент отказался"


# ---------------------------------------------------------------------------
# Tests: System comment creation
# ---------------------------------------------------------------------------


class TestSystemComment:
    """Test that a system TicketComment is created on every status change."""

    def test_system_comment_created(self, service, temp_dir, monkeypatch):
        req = _create_request(service, status="new")
        service.change_status(
            request_id=req["id"],
            new_status="data_check",
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
            comment = comments[0]
            assert "new" in comment.text
            assert "data_check" in comment.text
            assert comment.author_id == 2  # operator user

    def test_system_comment_includes_user_comment(self, service, temp_dir, monkeypatch):
        req = _create_request(service, status="new")
        service.change_status(
            request_id=req["id"],
            new_status="cancelled",
            user=service._seed["operator_user"],
            expected_version=req["version"],
            comment="Причина отмены",
        )

        with service._session_factory() as session:
            comments = session.scalars(
                select(TicketComment).where(
                    TicketComment.request_id == req["id"],
                    TicketComment.comment_type == "system",
                )
            ).all()
            assert len(comments) == 1
            assert "Причина отмены" in comments[0].text


# ---------------------------------------------------------------------------
# Tests: Not found
# ---------------------------------------------------------------------------


class TestNotFound:
    """Test that change_status raises TicketsNotFoundError for missing requests."""

    def test_nonexistent_request(self, service):
        with pytest.raises(TicketsNotFoundError):
            service.change_status(
                request_id=99999,
                new_status="data_check",
                user=service._seed["operator_user"],
                expected_version=1,
            )
