"""
Property-based tests for ticket attachment validation (task 5.3).

Property 24: Attachment format and size validation
Property 25: Attachment count limit

**Validates: Requirements 18.2, 18.5**

For any file with extension NOT in ALLOWED_ATTACHMENT_EXTENSIONS, upload raises
TicketsValidationError. For any file with size > MAX_ATTACHMENT_SIZE, upload raises
TicketsValidationError. For any file with valid extension and size <= MAX_ATTACHMENT_SIZE,
upload succeeds.

After uploading MAX_ATTACHMENTS_PER_REQUEST (10) files, the next upload raises
TicketsValidationError with a message about the limit.
"""
from __future__ import annotations

import sys
import uuid as uuid_mod
from contextlib import contextmanager
from decimal import Decimal
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
    TicketAttachment,
    TicketEmployee,
    TicketObject,
    TicketRequest,
)
from backend.services.tickets_service import (
    ALLOWED_ATTACHMENT_EXTENSIONS,
    MAX_ATTACHMENT_SIZE,
    MAX_ATTACHMENTS_PER_REQUEST,
    TicketsService,
    TicketsValidationError,
)


# ---------------------------------------------------------------------------
# Strategies
# ---------------------------------------------------------------------------

# Valid extensions sampled from the allowed set
valid_extensions = st.sampled_from(sorted(ALLOWED_ATTACHMENT_EXTENSIONS))

# Invalid extensions: short alphabetic strings NOT in the allowed set
invalid_extensions = st.text(
    min_size=1, max_size=5, alphabet=st.characters(whitelist_categories=("L",))
).filter(lambda ext: ext.lower() not in ALLOWED_ATTACHMENT_EXTENSIONS)

# File sizes within the allowed limit (1 byte to MAX_ATTACHMENT_SIZE)
valid_file_sizes = st.integers(min_value=1, max_value=MAX_ATTACHMENT_SIZE)

# File sizes exceeding the limit
invalid_file_sizes = st.integers(
    min_value=MAX_ATTACHMENT_SIZE + 1, max_value=MAX_ATTACHMENT_SIZE + 1024
)

# Base file names (without extension)
base_file_names = st.text(
    min_size=1, max_size=20, alphabet=st.characters(whitelist_categories=("L", "N"))
)

# Valid attachment types
valid_file_types = st.sampled_from(["itinerary", "pdf_ticket", "receipt", "voucher", "other"])


# ---------------------------------------------------------------------------
# Helper: create a fresh service instance
# ---------------------------------------------------------------------------


def _create_service(temp_dir: str, monkeypatch) -> TicketsService:
    """Create a TicketsService with a fresh SQLite database and temp upload dir."""
    import backend.appdb.db as appdb

    # Use unique DB per call to avoid state leakage
    db_name = f"tickets_prop_att_{uuid_mod.uuid4().hex[:8]}.db"
    url = f"sqlite:///{(Path(temp_dir) / db_name).as_posix()}"

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

    # Seed test data: user, employee, object, request
    with _test_app_session() as session:
        user = AppUser(id=1, username="admin", full_name="Admin User", role="admin")
        session.add(user)
        session.flush()

        emp = TicketEmployee(
            full_name="Иванов Иван Иванович",
            phone="+79001234567",
            status="active",
        )
        session.add(emp)
        session.flush()

        obj = TicketObject(
            code="KAM",
            name="Камчатка",
            region="Дальний Восток",
            is_active=True,
        )
        session.add(obj)
        session.flush()

        req = TicketRequest(
            employee_id=emp.id,
            object_id=obj.id,
            status="new",
            assignee_id=user.id,
            total_cost=Decimal("15000.00"),
            version=1,
        )
        session.add(req)
        session.flush()
        request_id = req.id

    svc = TicketsService()
    svc._test_session_factory = _test_app_session
    svc._seed = {
        "user_id": 1,
        "request_id": request_id,
        "upload_dir": str(Path(temp_dir) / "uploads" / "tickets"),
    }
    return svc


@pytest.fixture
def service(temp_dir, monkeypatch):
    """Create a TicketsService with a fresh SQLite database and temp upload dir."""
    return _create_service(temp_dir, monkeypatch)


# ---------------------------------------------------------------------------
# Property 24: Attachment format and size validation
# ---------------------------------------------------------------------------


class TestProperty24AttachmentFormatAndSizeValidation:
    """Property 24: Attachment format and size validation.

    **Validates: Requirements 18.2**

    For any file with extension NOT in ALLOWED_ATTACHMENT_EXTENSIONS, upload raises
    TicketsValidationError. For any file with size > MAX_ATTACHMENT_SIZE, upload raises
    TicketsValidationError. For any file with valid extension and size <= MAX_ATTACHMENT_SIZE,
    upload succeeds.
    """

    @settings(max_examples=15, suppress_health_check=[HealthCheck.function_scoped_fixture])
    @given(ext=invalid_extensions, file_type=valid_file_types, base_name=base_file_names)
    def test_invalid_extension_raises_error(self, service, ext, file_type, base_name):
        """For any file with extension NOT in ALLOWED_ATTACHMENT_EXTENSIONS, upload raises TicketsValidationError.

        **Validates: Requirements 18.2**
        """
        seed = service._seed
        file_name = f"{base_name}.{ext}"
        with pytest.raises(TicketsValidationError) as exc_info:
            service.upload_attachment(
                request_id=seed["request_id"],
                file_name=file_name,
                file_content=b"test content",
                file_type=file_type,
                user_id=seed["user_id"],
                base_upload_dir=seed["upload_dir"],
            )
        assert "not allowed" in str(exc_info.value)

    @settings(max_examples=15, suppress_health_check=[HealthCheck.function_scoped_fixture])
    @given(size=invalid_file_sizes, ext=valid_extensions, file_type=valid_file_types)
    def test_oversized_file_raises_error(self, service, size, ext, file_type):
        """For any file with size > MAX_ATTACHMENT_SIZE, upload raises TicketsValidationError.

        **Validates: Requirements 18.2**
        """
        seed = service._seed
        file_content = b"x" * size
        with pytest.raises(TicketsValidationError) as exc_info:
            service.upload_attachment(
                request_id=seed["request_id"],
                file_name=f"bigfile.{ext}",
                file_content=file_content,
                file_type=file_type,
                user_id=seed["user_id"],
                base_upload_dir=seed["upload_dir"],
            )
        assert "exceeds maximum" in str(exc_info.value)

    @settings(max_examples=15, suppress_health_check=[HealthCheck.function_scoped_fixture])
    @given(ext=valid_extensions, file_type=valid_file_types, base_name=base_file_names)
    def test_valid_extension_and_size_succeeds(self, service, ext, file_type, base_name):
        """For any file with valid extension and size <= MAX_ATTACHMENT_SIZE, upload succeeds.

        **Validates: Requirements 18.2**
        """
        assume(len(base_name) > 0)
        seed = service._seed

        # Create a fresh request for each hypothesis example to avoid hitting count limit
        import backend.services.tickets_service as svc_mod
        with svc_mod.app_session() as session:
            fresh_req = TicketRequest(
                employee_id=1,
                object_id=1,
                status="new",
                assignee_id=seed["user_id"],
                total_cost=Decimal("0.00"),
                version=1,
            )
            session.add(fresh_req)
            session.flush()
            request_id = fresh_req.id

        file_name = f"{base_name}.{ext}"
        # Use small content to keep tests fast
        file_content = b"valid content"
        result = service.upload_attachment(
            request_id=request_id,
            file_name=file_name,
            file_content=file_content,
            file_type=file_type,
            user_id=seed["user_id"],
            base_upload_dir=seed["upload_dir"],
        )
        assert result["file_name"] == file_name
        assert result["file_type"] == file_type
        assert result["file_size"] == len(file_content)
        assert result["id"]  # UUID generated


# ---------------------------------------------------------------------------
# Property 25: Attachment count limit
# ---------------------------------------------------------------------------


class TestProperty25AttachmentCountLimit:
    """Property 25: Attachment count limit.

    **Validates: Requirements 18.5**

    After uploading MAX_ATTACHMENTS_PER_REQUEST (10) files, the next upload raises
    TicketsValidationError with a message about the limit.
    """

    @settings(max_examples=15, deadline=None, suppress_health_check=[HealthCheck.function_scoped_fixture])
    @given(
        extra_count=st.integers(min_value=1, max_value=5),
        ext=valid_extensions,
        file_type=valid_file_types,
    )
    def test_exceeding_max_attachments_raises_error(self, service, extra_count, ext, file_type):
        """After uploading MAX_ATTACHMENTS_PER_REQUEST files, the next upload raises TicketsValidationError.

        **Validates: Requirements 18.5**
        """
        seed = service._seed

        # Create a fresh request for each hypothesis example to avoid state accumulation
        import backend.services.tickets_service as svc_mod
        with svc_mod.app_session() as session:
            fresh_req = TicketRequest(
                employee_id=1,
                object_id=1,
                status="new",
                assignee_id=seed["user_id"],
                total_cost=Decimal("0.00"),
                version=1,
            )
            session.add(fresh_req)
            session.flush()
            request_id = fresh_req.id

        # Upload exactly MAX_ATTACHMENTS_PER_REQUEST files
        for i in range(MAX_ATTACHMENTS_PER_REQUEST):
            service.upload_attachment(
                request_id=request_id,
                file_name=f"file_{i}.{ext}",
                file_content=b"content",
                file_type=file_type,
                user_id=seed["user_id"],
                base_upload_dir=seed["upload_dir"],
            )

        # The next upload(s) should fail
        with pytest.raises(TicketsValidationError) as exc_info:
            service.upload_attachment(
                request_id=request_id,
                file_name=f"extra.{ext}",
                file_content=b"extra content",
                file_type=file_type,
                user_id=seed["user_id"],
                base_upload_dir=seed["upload_dir"],
            )
        error_msg = str(exc_info.value)
        assert "Maximum" in error_msg or "maximum" in error_msg.lower()
        assert str(MAX_ATTACHMENTS_PER_REQUEST) in error_msg

    @settings(max_examples=15, deadline=None, suppress_health_check=[HealthCheck.function_scoped_fixture])
    @given(ext=valid_extensions, file_type=valid_file_types)
    def test_delete_then_upload_succeeds(self, service, ext, file_type):
        """After deleting one attachment from a full request, upload succeeds again.

        **Validates: Requirements 18.5**
        """
        seed = service._seed

        # Create a fresh request for each hypothesis example
        import backend.services.tickets_service as svc_mod
        with svc_mod.app_session() as session:
            fresh_req = TicketRequest(
                employee_id=1,
                object_id=1,
                status="new",
                assignee_id=seed["user_id"],
                total_cost=Decimal("0.00"),
                version=1,
            )
            session.add(fresh_req)
            session.flush()
            request_id = fresh_req.id

        # Upload exactly MAX_ATTACHMENTS_PER_REQUEST files
        uploaded = []
        for i in range(MAX_ATTACHMENTS_PER_REQUEST):
            att = service.upload_attachment(
                request_id=request_id,
                file_name=f"file_{i}.{ext}",
                file_content=b"content",
                file_type=file_type,
                user_id=seed["user_id"],
                base_upload_dir=seed["upload_dir"],
            )
            uploaded.append(att)

        # Verify 11th upload fails
        with pytest.raises(TicketsValidationError):
            service.upload_attachment(
                request_id=request_id,
                file_name=f"overflow.{ext}",
                file_content=b"overflow",
                file_type=file_type,
                user_id=seed["user_id"],
                base_upload_dir=seed["upload_dir"],
            )

        # Delete one attachment
        service.delete_attachment(
            request_id=request_id,
            attachment_id=uploaded[0]["id"],
            user_id=seed["user_id"],
        )

        # Now upload should succeed again
        result = service.upload_attachment(
            request_id=request_id,
            file_name=f"replacement.{ext}",
            file_content=b"replacement content",
            file_type=file_type,
            user_id=seed["user_id"],
            base_upload_dir=seed["upload_dir"],
        )
        assert result["file_name"] == f"replacement.{ext}"
        assert result["request_id"] == request_id
