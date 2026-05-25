"""Property-based tests for TicketsService.change_status() — status transitions and optimistic locking.

**Validates: Requirements 8.2, 8.3, 8.5**

Property 13: Status transition validity with optimistic locking

Properties tested:
1. For any valid status and any allowed transition from STATUS_TRANSITIONS, change_status succeeds
   and increments version.
2. For any valid status and any status NOT in its allowed transitions (non-admin), change_status
   raises TicketsTransitionError.
3. Admin can transition between any two valid statuses.
4. Optimistic locking: if expected_version != current version, TicketsConflictError is raised
   regardless of the transition validity.
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
from backend.appdb.tickets_models import (
    TicketEmployee,
    TicketObject,
    TicketRequest,
)
from backend.services.tickets_service import (
    STATUS_TRANSITIONS,
    VALID_STATUSES,
    CreateRequestDTO,
    TicketsConflictError,
    TicketsService,
    TicketsTransitionError,
    TicketsValidationError,
)


# ---------------------------------------------------------------------------
# Strategies
# ---------------------------------------------------------------------------

all_statuses = st.sampled_from(sorted(VALID_STATUSES))


def statuses_with_transitions():
    """Strategy that picks a status that has at least one allowed transition."""
    statuses_with_allowed = [s for s, t in STATUS_TRANSITIONS.items() if t]
    return st.sampled_from(statuses_with_allowed)


def status_and_allowed_target():
    """Strategy that picks a (current_status, target_status) pair where the transition is allowed."""
    pairs = []
    for src, targets in STATUS_TRANSITIONS.items():
        for tgt in targets:
            pairs.append((src, tgt))
    return st.sampled_from(pairs)


def status_and_disallowed_target():
    """Strategy that picks a (current_status, target_status) pair where the transition is NOT allowed (non-admin)."""
    pairs = []
    for src in STATUS_TRANSITIONS:
        allowed = set(STATUS_TRANSITIONS[src])
        disallowed = VALID_STATUSES - allowed - {src}  # exclude same-status (no-op)
        for tgt in disallowed:
            pairs.append((src, tgt))
    return st.sampled_from(pairs)


def two_different_statuses():
    """Strategy that picks two different valid statuses."""
    return st.tuples(all_statuses, all_statuses).filter(lambda pair: pair[0] != pair[1])


# ---------------------------------------------------------------------------
# Fixtures
# ---------------------------------------------------------------------------


@pytest.fixture
def service(temp_dir, monkeypatch):
    """Create a TicketsService with a fresh SQLite database (same pattern as unit tests)."""
    import backend.appdb.db as appdb

    url = f"sqlite:///{(Path(temp_dir) / 'tickets_prop_status.db').as_posix()}"

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


def _create_request(service, status: str) -> dict:
    """Helper to create a request with a given initial status."""
    seed = service._seed
    dto = CreateRequestDTO(
        employee_id=seed["emp_id"],
        object_id=seed["obj_id"],
        status=status,
    )
    return service.create_request(dto)


# ---------------------------------------------------------------------------
# Property 1: Valid transitions succeed and increment version
# ---------------------------------------------------------------------------


class TestPropertyValidTransitions:
    """For any valid status and any allowed transition, change_status succeeds and increments version.

    **Validates: Requirements 8.2**
    """

    @settings(max_examples=15, suppress_health_check=[HealthCheck.function_scoped_fixture])
    @given(data=status_and_allowed_target())
    def test_allowed_transition_succeeds_and_increments_version(self, service, data):
        current_status, target_status = data
        req = _create_request(service, status=current_status)

        result = service.change_status(
            request_id=req["id"],
            new_status=target_status,
            user=service._seed["operator_user"],
            expected_version=req["version"],
        )

        assert result["status"] == target_status
        assert result["version"] == req["version"] + 1


# ---------------------------------------------------------------------------
# Property 2: Disallowed transitions raise TicketsTransitionError (non-admin)
# ---------------------------------------------------------------------------


class TestPropertyDisallowedTransitions:
    """For any valid status and any status NOT in its allowed transitions (non-admin),
    change_status raises TicketsTransitionError.

    **Validates: Requirements 8.3**
    """

    @settings(max_examples=15, suppress_health_check=[HealthCheck.function_scoped_fixture])
    @given(data=status_and_disallowed_target())
    def test_disallowed_transition_raises_error(self, service, data):
        current_status, target_status = data
        req = _create_request(service, status=current_status)

        with pytest.raises(TicketsTransitionError) as exc_info:
            service.change_status(
                request_id=req["id"],
                new_status=target_status,
                user=service._seed["operator_user"],
                expected_version=req["version"],
            )

        assert exc_info.value.current_status == current_status
        assert exc_info.value.new_status == target_status
        assert exc_info.value.allowed == STATUS_TRANSITIONS[current_status]


# ---------------------------------------------------------------------------
# Property 3: Admin can transition between any two valid statuses
# ---------------------------------------------------------------------------


class TestPropertyAdminBypass:
    """Admin can transition between any two valid statuses, ignoring the transition matrix.

    **Validates: Requirements 8.2**
    """

    @settings(max_examples=15, suppress_health_check=[HealthCheck.function_scoped_fixture])
    @given(data=two_different_statuses())
    def test_admin_can_transition_any_pair(self, service, data):
        current_status, target_status = data
        req = _create_request(service, status=current_status)

        result = service.change_status(
            request_id=req["id"],
            new_status=target_status,
            user=service._seed["admin_user"],
            expected_version=req["version"],
        )

        assert result["status"] == target_status
        assert result["version"] == req["version"] + 1


# ---------------------------------------------------------------------------
# Property 4: Optimistic locking — wrong version raises TicketsConflictError
# ---------------------------------------------------------------------------


class TestPropertyOptimisticLocking:
    """If expected_version != current version, TicketsConflictError is raised
    regardless of the transition validity.

    **Validates: Requirements 8.5**
    """

    @settings(max_examples=15, suppress_health_check=[HealthCheck.function_scoped_fixture])
    @given(
        data=status_and_allowed_target(),
        version_offset=st.integers(min_value=1, max_value=100),
    )
    def test_stale_version_raises_conflict_on_valid_transition(self, service, data, version_offset):
        """Even a valid transition fails if expected_version is wrong."""
        current_status, target_status = data
        req = _create_request(service, status=current_status)

        wrong_version = req["version"] + version_offset  # always != current

        with pytest.raises(TicketsConflictError) as exc_info:
            service.change_status(
                request_id=req["id"],
                new_status=target_status,
                user=service._seed["operator_user"],
                expected_version=wrong_version,
            )

        assert exc_info.value.current_version == req["version"]
        assert exc_info.value.expected_version == wrong_version

    @settings(max_examples=15, suppress_health_check=[HealthCheck.function_scoped_fixture])
    @given(
        data=two_different_statuses(),
        version_offset=st.integers(min_value=1, max_value=100),
    )
    def test_stale_version_raises_conflict_for_admin(self, service, data, version_offset):
        """Admin also gets conflict error if version is wrong."""
        current_status, target_status = data
        req = _create_request(service, status=current_status)

        wrong_version = req["version"] + version_offset

        with pytest.raises(TicketsConflictError) as exc_info:
            service.change_status(
                request_id=req["id"],
                new_status=target_status,
                user=service._seed["admin_user"],
                expected_version=wrong_version,
            )

        assert exc_info.value.current_version == req["version"]
        assert exc_info.value.expected_version == wrong_version
