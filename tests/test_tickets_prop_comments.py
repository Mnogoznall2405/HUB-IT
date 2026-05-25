"""Property-based tests for comment validation and ordering.

Feature: tickets-logistics
Property 16: Comment text validation
Property 17: Comment chronological ordering

**Validates: Requirements 9.1, 9.2, 9.3, 9.4**
"""
from __future__ import annotations

import sys
from contextlib import contextmanager
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
from backend.appdb.tickets_models import (
    TicketComment,
    TicketEmployee,
    TicketObject,
    TicketRequest,
)
from backend.services.tickets_service import (
    COMMENT_MAX_LENGTH,
    COMMENT_MIN_LENGTH,
    VALID_COMMENT_TYPES,
    CreateRequestDTO,
    Pagination,
    TicketsService,
    TicketsValidationError,
)


# ---------------------------------------------------------------------------
# Fixtures
# ---------------------------------------------------------------------------


def _sqlite_url(temp_dir: str) -> str:
    return f"sqlite:///{(Path(temp_dir) / 'tickets_prop_comments.db').as_posix()}"


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

    # Seed test data: user, employee, object
    with _test_app_session() as session:
        user = AppUser(id=1, username="admin", full_name="Admin User", role="admin")
        session.add(user)
        session.flush()

        emp = TicketEmployee(
            full_name="Тестовый Сотрудник",
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
        "user_id": 1,
        "emp_id": emp_id,
        "obj_id": obj_id,
    }
    return svc


def _create_request(service) -> dict:
    """Helper to create a ticket request for testing."""
    seed = service._seed
    dto = CreateRequestDTO(
        employee_id=seed["emp_id"],
        object_id=seed["obj_id"],
        status="new",
        assignee_id=seed["user_id"],
        route="Москва - Тест",
        total_cost=Decimal("10000.00"),
    )
    return service.create_request(dto)


# ---------------------------------------------------------------------------
# Property 16: Comment text validation
# **Validates: Requirements 9.1, 9.3, 9.4**
# ---------------------------------------------------------------------------


@settings(max_examples=15, suppress_health_check=[HealthCheck.function_scoped_fixture])
@given(
    text=st.text(min_size=COMMENT_MIN_LENGTH, max_size=COMMENT_MAX_LENGTH),
    comment_type=st.sampled_from(sorted(VALID_COMMENT_TYPES)),
)
def test_prop16_valid_comment_text_accepted(service, text, comment_type):
    """Property 16a: Text with 1–2000 chars and valid comment_type is accepted.

    **Validates: Requirements 9.1, 9.3**
    """
    req = _create_request(service)
    result = service.add_comment(
        request_id=req["id"],
        text=text,
        comment_type=comment_type,
        user_id=service._seed["user_id"],
    )
    assert result["id"] is not None
    assert result["text"] == text
    assert result["comment_type"] == comment_type
    assert result["author_id"] == service._seed["user_id"]
    assert result["created_at"] is not None


@settings(max_examples=15, suppress_health_check=[HealthCheck.function_scoped_fixture])
@given(
    text=st.text(min_size=COMMENT_MAX_LENGTH + 1, max_size=COMMENT_MAX_LENGTH + 500),
)
def test_prop16_too_long_comment_raises(service, text):
    """Property 16b: Text with >2000 chars raises TicketsValidationError.

    **Validates: Requirements 9.4**
    """
    req = _create_request(service)
    with pytest.raises(TicketsValidationError):
        service.add_comment(
            request_id=req["id"],
            text=text,
            comment_type="normal",
            user_id=service._seed["user_id"],
        )


def test_prop16_empty_comment_raises(service):
    """Property 16c: Text with 0 chars raises TicketsValidationError.

    **Validates: Requirements 9.4**
    """
    req = _create_request(service)
    with pytest.raises(TicketsValidationError):
        service.add_comment(
            request_id=req["id"],
            text="",
            comment_type="normal",
            user_id=service._seed["user_id"],
        )


@settings(max_examples=15, suppress_health_check=[HealthCheck.function_scoped_fixture])
@given(
    invalid_type=st.text(min_size=1, max_size=50).filter(
        lambda t: t not in VALID_COMMENT_TYPES
    ),
)
def test_prop16_invalid_comment_type_raises(service, invalid_type):
    """Property 16d: Invalid comment_type raises TicketsValidationError.

    **Validates: Requirements 9.1**
    """
    req = _create_request(service)
    with pytest.raises(TicketsValidationError):
        service.add_comment(
            request_id=req["id"],
            text="Valid comment text",
            comment_type=invalid_type,
            user_id=service._seed["user_id"],
        )


# ---------------------------------------------------------------------------
# Property 17: Comment chronological ordering
# **Validates: Requirements 9.2**
# ---------------------------------------------------------------------------


@settings(max_examples=15, suppress_health_check=[HealthCheck.function_scoped_fixture])
@given(n_comments=st.integers(min_value=2, max_value=10))
def test_prop17_comments_chronological_order(service, n_comments):
    """Property 17: For N comments (2–10) added to a request, get_comments()
    returns them in chronological order with non-decreasing created_at.

    **Validates: Requirements 9.2**
    """
    req = _create_request(service)

    # Add N comments sequentially
    for i in range(n_comments):
        service.add_comment(
            request_id=req["id"],
            text=f"Comment number {i}",
            comment_type="normal",
            user_id=service._seed["user_id"],
        )

    # Retrieve all comments
    result = service.get_comments(req["id"], Pagination(page=1, page_size=100))

    assert result.total == n_comments
    assert len(result.items) == n_comments

    # Verify chronological ordering: created_at[i] <= created_at[i+1]
    for i in range(len(result.items) - 1):
        current_ts = result.items[i]["created_at"]
        next_ts = result.items[i + 1]["created_at"]
        assert current_ts <= next_ts, (
            f"Comments not in chronological order: "
            f"comment[{i}].created_at={current_ts} > comment[{i+1}].created_at={next_ts}"
        )

    # Verify the text order matches insertion order (oldest first)
    for i in range(n_comments):
        assert result.items[i]["text"] == f"Comment number {i}"
