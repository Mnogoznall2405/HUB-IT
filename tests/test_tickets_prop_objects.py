"""
Property-based tests for TicketsService object management.

**Validates: Requirements 13.3, 13.4, 13.5**

Property 26: Object code uniqueness
  - Generate random codes (2–10 chars)
  - Create object with code → succeeds
  - Try to create another object with same code → verify ValueError raised
  - Verify codes of different lengths (2, 5, 10) all work
  - Verify codes <2 or >10 chars raise ValueError

Property 27: Object deactivation preserves existing links
  - Create object, create request linked to it
  - Deactivate object (is_active=False)
  - Verify request still references the object (get_request returns correct object_id)
  - Verify deactivated object excluded from list_objects(include_inactive=False)
  - Verify deactivated object included in list_objects(include_inactive=True)
"""
from __future__ import annotations

import sys
import uuid
from contextlib import contextmanager
from pathlib import Path
from unittest.mock import patch

import pytest
from hypothesis import given, settings, HealthCheck
from hypothesis import strategies as st

PROJECT_ROOT = Path(__file__).resolve().parents[1]
WEB_ROOT = PROJECT_ROOT / "WEB-itinvent"

if str(WEB_ROOT) not in sys.path:
    sys.path.insert(0, str(WEB_ROOT))

from backend.appdb.models import AppBase
from backend.appdb.tickets_models import TicketObject, TicketEmployee, TicketRequest
from backend.services.tickets_service import TicketsService, CreateRequestDTO


# ---------------------------------------------------------------------------
# Strategies
# ---------------------------------------------------------------------------

valid_code_st = st.text(
    min_size=2, max_size=10, alphabet=st.characters(whitelist_categories=("L", "N"))
)

invalid_code_short_st = st.text(
    min_size=0, max_size=1, alphabet=st.characters(whitelist_categories=("L", "N"))
)

invalid_code_long_st = st.text(
    min_size=11, max_size=30, alphabet=st.characters(whitelist_categories=("L", "N"))
)

valid_name_st = st.text(
    min_size=1, max_size=150, alphabet=st.characters(whitelist_categories=("L", "N", "Z"))
).filter(lambda s: s.strip() != "")

valid_region_st = st.text(
    min_size=1, max_size=100, alphabet=st.characters(whitelist_categories=("L", "N", "Z"))
).filter(lambda s: s.strip() != "")

# Strategy for codes of specific valid lengths (2, 5, 10)
code_length_2_st = st.text(
    min_size=2, max_size=2, alphabet=st.characters(whitelist_categories=("L", "N"))
)
code_length_5_st = st.text(
    min_size=5, max_size=5, alphabet=st.characters(whitelist_categories=("L", "N"))
)
code_length_10_st = st.text(
    min_size=10, max_size=10, alphabet=st.characters(whitelist_categories=("L", "N"))
)

# Strategy for non-admin roles
non_admin_role_st = st.sampled_from(["operator", "viewer", "user", "guest", ""])


# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------

_RUNTIME_DIR = Path(__file__).resolve().parent.parent / ".pytest_runtime"


def _admin_user() -> dict:
    return {"id": 1, "username": "admin", "role": "admin"}


def _non_admin_user(role: str = "operator") -> dict:
    return {"id": 2, "username": "user", "role": role}


@contextmanager
def _fresh_service():
    """Create a TicketsService with a fresh in-memory SQLite database per test example."""
    import backend.appdb.db as appdb

    _RUNTIME_DIR.mkdir(parents=True, exist_ok=True)
    db_path = _RUNTIME_DIR / f"prop_obj_{uuid.uuid4().hex}.db"
    url = f"sqlite:///{db_path.as_posix()}"

    appdb._engines.clear()
    appdb._session_factories.clear()
    appdb._initialized_schema_urls.clear()

    from sqlalchemy import create_engine, event
    from sqlalchemy.orm import sessionmaker

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

    with patch("backend.services.tickets_service.app_session", _test_app_session):
        try:
            yield TicketsService(), _test_app_session
        finally:
            engine.dispose()
            try:
                db_path.unlink(missing_ok=True)
            except OSError:
                pass


def _seed_employee(session_factory) -> int:
    """Create a test employee and return its ID."""
    with session_factory() as session:
        emp = TicketEmployee(
            full_name="Тестов Тест Тестович",
            phone="+79001234567",
            status="active",
        )
        session.add(emp)
        session.flush()
        return emp.id


# ---------------------------------------------------------------------------
# Property 26: Object code uniqueness
# ---------------------------------------------------------------------------


class TestProperty26ObjectCodeUniqueness:
    """Property 26: Object code uniqueness.

    **Validates: Requirements 13.3**
    """

    @settings(max_examples=15)
    @given(code=valid_code_st, name=valid_name_st, region=valid_region_st)
    def test_valid_code_create_succeeds_duplicate_raises(self, code, name, region):
        """For any code string of length 2–10, create_object succeeds;
        creating two objects with the same code raises ValueError (uniqueness)."""
        admin = _admin_user()

        with _fresh_service() as (service, _):
            # First creation should succeed
            result = service.create_object({"code": code, "name": name, "region": region}, admin)
            assert result["code"] == code

            # Second creation with same code must raise ValueError
            with pytest.raises(ValueError, match="already exists"):
                service.create_object(
                    {"code": code, "name": "Another Name", "region": "Another Region"},
                    admin,
                )

    @settings(max_examples=15)
    @given(code=code_length_2_st, name=valid_name_st, region=valid_region_st)
    def test_code_length_2_works(self, code, name, region):
        """Codes of length 2 are valid and creation succeeds."""
        admin = _admin_user()

        with _fresh_service() as (service, _):
            result = service.create_object({"code": code, "name": name, "region": region}, admin)
            assert result["code"] == code
            assert len(code) == 2

    @settings(max_examples=15)
    @given(code=code_length_5_st, name=valid_name_st, region=valid_region_st)
    def test_code_length_5_works(self, code, name, region):
        """Codes of length 5 are valid and creation succeeds."""
        admin = _admin_user()

        with _fresh_service() as (service, _):
            result = service.create_object({"code": code, "name": name, "region": region}, admin)
            assert result["code"] == code
            assert len(code) == 5

    @settings(max_examples=15)
    @given(code=code_length_10_st, name=valid_name_st, region=valid_region_st)
    def test_code_length_10_works(self, code, name, region):
        """Codes of length 10 are valid and creation succeeds."""
        admin = _admin_user()

        with _fresh_service() as (service, _):
            result = service.create_object({"code": code, "name": name, "region": region}, admin)
            assert result["code"] == code
            assert len(code) == 10

    @settings(max_examples=15)
    @given(code=invalid_code_short_st)
    def test_code_too_short_raises_value_error(self, code):
        """For any code of length < 2, create_object raises ValueError."""
        admin = _admin_user()

        with _fresh_service() as (service, _):
            with pytest.raises(ValueError, match="2 and 10"):
                service.create_object(
                    {"code": code, "name": "Test Object", "region": "Test Region"},
                    admin,
                )

    @settings(max_examples=15)
    @given(code=invalid_code_long_st)
    def test_code_too_long_raises_value_error(self, code):
        """For any code of length > 10, create_object raises ValueError."""
        admin = _admin_user()

        with _fresh_service() as (service, _):
            with pytest.raises(ValueError, match="2 and 10"):
                service.create_object(
                    {"code": code, "name": "Test Object", "region": "Test Region"},
                    admin,
                )

    @settings(max_examples=15)
    @given(role=non_admin_role_st, code=valid_code_st, name=valid_name_st, region=valid_region_st)
    def test_non_admin_cannot_create_object(self, role, code, name, region):
        """Non-admin users cannot create objects (PermissionError)."""
        user = _non_admin_user(role)

        with _fresh_service() as (service, _):
            with pytest.raises(PermissionError):
                service.create_object(
                    {"code": code, "name": name, "region": region},
                    user,
                )


# ---------------------------------------------------------------------------
# Property 27: Object deactivation preserves existing links
# ---------------------------------------------------------------------------


class TestProperty27ObjectDeactivationPreservesLinks:
    """Property 27: Object deactivation preserves existing links.

    **Validates: Requirements 13.4, 13.5**
    """

    @settings(max_examples=15)
    @given(code=valid_code_st, name=valid_name_st, region=valid_region_st)
    def test_deactivated_object_request_still_references_it(self, code, name, region):
        """Create object, create request linked to it, deactivate object.
        Verify request still references the object (get_request returns correct object_id)."""
        admin = _admin_user()

        with _fresh_service() as (service, session_factory):
            # Create object
            obj = service.create_object({"code": code, "name": name, "region": region}, admin)

            # Create employee for the request
            emp_id = _seed_employee(session_factory)

            # Create request linked to the object
            dto = CreateRequestDTO(employee_id=emp_id, object_id=obj["id"])
            request = service.create_request(dto)

            # Deactivate the object
            service.update_object(obj["id"], {"is_active": False}, admin)

            # Verify request still references the object
            fetched_request = service.get_request(request["id"])
            assert fetched_request is not None
            assert fetched_request["object_id"] == obj["id"]

    @settings(max_examples=15)
    @given(code=valid_code_st, name=valid_name_st, region=valid_region_st)
    def test_deactivated_object_excluded_from_active_list(self, code, name, region):
        """After deactivating an object, list_objects(include_inactive=False) excludes it."""
        admin = _admin_user()

        with _fresh_service() as (service, _):
            created = service.create_object(
                {"code": code, "name": name, "region": region}, admin
            )

            # Deactivate
            service.update_object(created["id"], {"is_active": False}, admin)

            # Must not appear in active-only list
            active_objects = service.list_objects(include_inactive=False)
            active_codes = [obj["code"] for obj in active_objects]
            assert code not in active_codes

    @settings(max_examples=15)
    @given(code=valid_code_st, name=valid_name_st, region=valid_region_st)
    def test_deactivated_object_included_in_full_list(self, code, name, region):
        """After deactivating an object, list_objects(include_inactive=True) includes it."""
        admin = _admin_user()

        with _fresh_service() as (service, _):
            created = service.create_object(
                {"code": code, "name": name, "region": region}, admin
            )

            # Deactivate
            service.update_object(created["id"], {"is_active": False}, admin)

            # Must still appear in full list
            all_objects = service.list_objects(include_inactive=True)
            all_codes = [obj["code"] for obj in all_objects]
            assert code in all_codes

    @settings(max_examples=15)
    @given(code=valid_code_st, name=valid_name_st, region=valid_region_st)
    def test_deactivation_preserves_object_data(self, code, name, region):
        """The object's data (code, name, region) is preserved after deactivation."""
        admin = _admin_user()

        with _fresh_service() as (service, _):
            created = service.create_object(
                {"code": code, "name": name, "region": region}, admin
            )

            # Deactivate
            deactivated = service.update_object(created["id"], {"is_active": False}, admin)

            # All original data preserved
            assert deactivated["code"] == code
            assert deactivated["name"] == name
            assert deactivated["region"] == region
            assert deactivated["is_active"] is False
            assert deactivated["id"] == created["id"]

    @settings(max_examples=15)
    @given(role=non_admin_role_st, code=valid_code_st, name=valid_name_st, region=valid_region_st)
    def test_non_admin_cannot_update_object(self, role, code, name, region):
        """Non-admin users cannot update (deactivate) objects (PermissionError)."""
        admin = _admin_user()
        user = _non_admin_user(role)

        with _fresh_service() as (service, _):
            # Create as admin
            created = service.create_object(
                {"code": code, "name": name, "region": region}, admin
            )

            # Non-admin cannot update
            with pytest.raises(PermissionError):
                service.update_object(created["id"], {"is_active": False}, user)
