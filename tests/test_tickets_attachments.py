"""Tests for TicketsService attachment upload/download/delete (task 5.1).

Tests cover:
- upload_attachment(): format validation, size validation, count limit, file storage
- delete_attachment(): file removal, DB record deletion, change history creation
- list_attachments(): listing all attachments for a request

Requirements: 18.1, 18.2, 18.3, 18.4, 18.5
"""
from __future__ import annotations

import sys
from contextlib import contextmanager
from datetime import datetime, timezone
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
    TicketAttachment,
    TicketChangeHistory,
    TicketEmployee,
    TicketObject,
    TicketRequest,
)
from backend.services.tickets_service import (
    ALLOWED_ATTACHMENT_EXTENSIONS,
    MAX_ATTACHMENT_SIZE,
    MAX_ATTACHMENTS_PER_REQUEST,
    TicketsNotFoundError,
    TicketsService,
    TicketsValidationError,
)


# ---------------------------------------------------------------------------
# Fixtures
# ---------------------------------------------------------------------------


def _sqlite_url(temp_dir: str) -> str:
    return f"sqlite:///{(Path(temp_dir) / 'tickets_attachments.db').as_posix()}"


@pytest.fixture
def service(temp_dir, monkeypatch):
    """Create a TicketsService with a fresh SQLite database and temp upload dir."""
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


# ---------------------------------------------------------------------------
# Tests: upload_attachment
# ---------------------------------------------------------------------------


class TestUploadAttachment:
    """Tests for upload_attachment()."""

    def test_upload_valid_pdf(self, service):
        """Upload a valid PDF file succeeds."""
        seed = service._seed
        content = b"%PDF-1.4 fake content"
        result = service.upload_attachment(
            request_id=seed["request_id"],
            file_name="ticket.pdf",
            file_content=content,
            file_type="pdf_ticket",
            user_id=seed["user_id"],
            base_upload_dir=seed["upload_dir"],
        )

        assert result["request_id"] == seed["request_id"]
        assert result["file_name"] == "ticket.pdf"
        assert result["file_type"] == "pdf_ticket"
        assert result["file_size"] == len(content)
        assert result["uploaded_by_id"] == seed["user_id"]
        assert result["id"]  # UUID generated
        assert result["storage_path"]
        # Verify file was written to disk
        assert Path(result["storage_path"]).exists()
        assert Path(result["storage_path"]).read_bytes() == content

    def test_upload_valid_jpg(self, service):
        """Upload a valid JPG file succeeds."""
        seed = service._seed
        content = b"\xff\xd8\xff\xe0 fake jpg"
        result = service.upload_attachment(
            request_id=seed["request_id"],
            file_name="photo.JPG",
            file_content=content,
            file_type="receipt",
            user_id=seed["user_id"],
            base_upload_dir=seed["upload_dir"],
        )

        assert result["file_name"] == "photo.JPG"
        assert result["file_type"] == "receipt"
        # Extension is case-insensitive
        assert result["storage_path"].endswith(".jpg")

    def test_upload_valid_png(self, service):
        """Upload a valid PNG file succeeds."""
        seed = service._seed
        content = b"\x89PNG fake png"
        result = service.upload_attachment(
            request_id=seed["request_id"],
            file_name="scan.png",
            file_content=content,
            file_type="itinerary",
            user_id=seed["user_id"],
            base_upload_dir=seed["upload_dir"],
        )
        assert result["file_name"] == "scan.png"

    def test_upload_valid_docx(self, service):
        """Upload a valid DOCX file succeeds."""
        seed = service._seed
        content = b"PK\x03\x04 fake docx"
        result = service.upload_attachment(
            request_id=seed["request_id"],
            file_name="document.docx",
            file_content=content,
            file_type="other",
            user_id=seed["user_id"],
            base_upload_dir=seed["upload_dir"],
        )
        assert result["file_name"] == "document.docx"

    def test_upload_valid_xlsx(self, service):
        """Upload a valid XLSX file succeeds."""
        seed = service._seed
        content = b"PK\x03\x04 fake xlsx"
        result = service.upload_attachment(
            request_id=seed["request_id"],
            file_name="report.xlsx",
            file_content=content,
            file_type="voucher",
            user_id=seed["user_id"],
            base_upload_dir=seed["upload_dir"],
        )
        assert result["file_name"] == "report.xlsx"

    def test_upload_invalid_extension(self, service):
        """Upload with invalid extension raises TicketsValidationError."""
        seed = service._seed
        with pytest.raises(TicketsValidationError) as exc_info:
            service.upload_attachment(
                request_id=seed["request_id"],
                file_name="virus.exe",
                file_content=b"malicious",
                file_type="other",
                user_id=seed["user_id"],
                base_upload_dir=seed["upload_dir"],
            )
        assert "not allowed" in str(exc_info.value)

    def test_upload_no_extension(self, service):
        """Upload with no extension raises TicketsValidationError."""
        seed = service._seed
        with pytest.raises(TicketsValidationError) as exc_info:
            service.upload_attachment(
                request_id=seed["request_id"],
                file_name="noextension",
                file_content=b"content",
                file_type="other",
                user_id=seed["user_id"],
                base_upload_dir=seed["upload_dir"],
            )
        assert "not allowed" in str(exc_info.value)

    def test_upload_exceeds_size_limit(self, service):
        """Upload exceeding 20 MB raises TicketsValidationError."""
        seed = service._seed
        # Create content just over 20 MB
        content = b"x" * (MAX_ATTACHMENT_SIZE + 1)
        with pytest.raises(TicketsValidationError) as exc_info:
            service.upload_attachment(
                request_id=seed["request_id"],
                file_name="large.pdf",
                file_content=content,
                file_type="pdf_ticket",
                user_id=seed["user_id"],
                base_upload_dir=seed["upload_dir"],
            )
        assert "exceeds maximum" in str(exc_info.value)

    def test_upload_exactly_max_size(self, service):
        """Upload exactly at 20 MB limit succeeds."""
        seed = service._seed
        content = b"x" * MAX_ATTACHMENT_SIZE
        result = service.upload_attachment(
            request_id=seed["request_id"],
            file_name="exact.pdf",
            file_content=content,
            file_type="pdf_ticket",
            user_id=seed["user_id"],
            base_upload_dir=seed["upload_dir"],
        )
        assert result["file_size"] == MAX_ATTACHMENT_SIZE

    def test_upload_max_attachments_limit(self, service):
        """Upload fails when 10 attachments already exist."""
        seed = service._seed
        # Upload 10 attachments
        for i in range(MAX_ATTACHMENTS_PER_REQUEST):
            service.upload_attachment(
                request_id=seed["request_id"],
                file_name=f"file_{i}.pdf",
                file_content=b"content",
                file_type="other",
                user_id=seed["user_id"],
                base_upload_dir=seed["upload_dir"],
            )

        # 11th should fail
        with pytest.raises(TicketsValidationError) as exc_info:
            service.upload_attachment(
                request_id=seed["request_id"],
                file_name="file_11.pdf",
                file_content=b"content",
                file_type="other",
                user_id=seed["user_id"],
                base_upload_dir=seed["upload_dir"],
            )
        assert "Maximum" in str(exc_info.value)
        assert "10" in str(exc_info.value)

    def test_upload_invalid_file_type(self, service):
        """Upload with invalid file_type raises TicketsValidationError."""
        seed = service._seed
        with pytest.raises(TicketsValidationError) as exc_info:
            service.upload_attachment(
                request_id=seed["request_id"],
                file_name="file.pdf",
                file_content=b"content",
                file_type="invalid_type",
                user_id=seed["user_id"],
                base_upload_dir=seed["upload_dir"],
            )
        assert "Invalid file_type" in str(exc_info.value)

    def test_upload_nonexistent_request(self, service):
        """Upload to non-existent request raises TicketsNotFoundError."""
        seed = service._seed
        with pytest.raises(TicketsNotFoundError):
            service.upload_attachment(
                request_id=99999,
                file_name="file.pdf",
                file_content=b"content",
                file_type="other",
                user_id=seed["user_id"],
                base_upload_dir=seed["upload_dir"],
            )

    def test_upload_case_insensitive_extension(self, service):
        """Extension validation is case-insensitive."""
        seed = service._seed
        for ext in ["PDF", "Jpg", "JPEG", "Png", "DOC", "Docx", "XLS", "XLSX"]:
            result = service.upload_attachment(
                request_id=seed["request_id"],
                file_name=f"file.{ext}",
                file_content=b"content",
                file_type="other",
                user_id=seed["user_id"],
                base_upload_dir=seed["upload_dir"],
            )
            assert result["file_name"] == f"file.{ext}"

    def test_upload_storage_path_format(self, service):
        """Storage path follows uploads/tickets/{request_id}/{uuid}.{ext} format."""
        seed = service._seed
        result = service.upload_attachment(
            request_id=seed["request_id"],
            file_name="ticket.pdf",
            file_content=b"content",
            file_type="pdf_ticket",
            user_id=seed["user_id"],
            base_upload_dir=seed["upload_dir"],
        )
        path = result["storage_path"]
        # Should contain request_id in path
        assert str(seed["request_id"]) in path
        # Should end with .pdf
        assert path.endswith(".pdf")


# ---------------------------------------------------------------------------
# Tests: delete_attachment
# ---------------------------------------------------------------------------


class TestDeleteAttachment:
    """Tests for delete_attachment()."""

    def _upload_one(self, service, file_name="test.pdf"):
        """Helper to upload a single attachment."""
        seed = service._seed
        return service.upload_attachment(
            request_id=seed["request_id"],
            file_name=file_name,
            file_content=b"test content for deletion",
            file_type="pdf_ticket",
            user_id=seed["user_id"],
            base_upload_dir=seed["upload_dir"],
        )

    def test_delete_removes_file(self, service):
        """Deleting an attachment removes the file from disk."""
        seed = service._seed
        att = self._upload_one(service)
        file_path = Path(att["storage_path"])
        assert file_path.exists()

        service.delete_attachment(
            request_id=seed["request_id"],
            attachment_id=att["id"],
            user_id=seed["user_id"],
        )

        assert not file_path.exists()

    def test_delete_removes_db_record(self, service):
        """Deleting an attachment removes it from the list."""
        seed = service._seed
        att = self._upload_one(service)

        service.delete_attachment(
            request_id=seed["request_id"],
            attachment_id=att["id"],
            user_id=seed["user_id"],
        )

        attachments = service.list_attachments(seed["request_id"])
        assert len(attachments) == 0

    def test_delete_creates_history_record(self, service):
        """Deleting an attachment creates a change history record."""
        seed = service._seed
        att = self._upload_one(service, file_name="important_doc.pdf")

        service.delete_attachment(
            request_id=seed["request_id"],
            attachment_id=att["id"],
            user_id=seed["user_id"],
        )

        # Check history was created by querying the DB directly
        from backend.services.tickets_service import app_session as _app_session
        # Use the monkeypatched session
        import backend.services.tickets_service as svc_mod
        with svc_mod.app_session() as session:
            from sqlalchemy import select
            history = session.scalars(
                select(TicketChangeHistory).where(
                    TicketChangeHistory.request_id == seed["request_id"],
                    TicketChangeHistory.field_name == "attachment_deleted",
                )
            ).all()
            assert len(history) == 1
            assert history[0].old_value == "important_doc.pdf"
            assert history[0].new_value is None
            assert history[0].changed_by_id == seed["user_id"]
            assert "important_doc.pdf" in history[0].comment

    def test_delete_nonexistent_attachment(self, service):
        """Deleting a non-existent attachment raises TicketsNotFoundError."""
        seed = service._seed
        with pytest.raises(TicketsNotFoundError):
            service.delete_attachment(
                request_id=seed["request_id"],
                attachment_id="nonexistent_id",
                user_id=seed["user_id"],
            )

    def test_delete_attachment_wrong_request(self, service):
        """Deleting an attachment from wrong request raises TicketsNotFoundError."""
        seed = service._seed
        att = self._upload_one(service)

        with pytest.raises(TicketsNotFoundError):
            service.delete_attachment(
                request_id=99999,
                attachment_id=att["id"],
                user_id=seed["user_id"],
            )

    def test_delete_when_file_already_missing(self, service):
        """Deleting an attachment when file is already gone still succeeds."""
        seed = service._seed
        att = self._upload_one(service)

        # Manually remove the file
        Path(att["storage_path"]).unlink()

        # Should not raise
        service.delete_attachment(
            request_id=seed["request_id"],
            attachment_id=att["id"],
            user_id=seed["user_id"],
        )

        attachments = service.list_attachments(seed["request_id"])
        assert len(attachments) == 0


# ---------------------------------------------------------------------------
# Tests: list_attachments
# ---------------------------------------------------------------------------


class TestListAttachments:
    """Tests for list_attachments()."""

    def test_list_empty(self, service):
        """List attachments for request with no attachments returns empty list."""
        seed = service._seed
        result = service.list_attachments(seed["request_id"])
        assert result == []

    def test_list_multiple(self, service):
        """List attachments returns all uploaded files."""
        seed = service._seed
        for i in range(3):
            service.upload_attachment(
                request_id=seed["request_id"],
                file_name=f"file_{i}.pdf",
                file_content=f"content_{i}".encode(),
                file_type="other",
                user_id=seed["user_id"],
                base_upload_dir=seed["upload_dir"],
            )

        result = service.list_attachments(seed["request_id"])
        assert len(result) == 3
        names = [att["file_name"] for att in result]
        assert "file_0.pdf" in names
        assert "file_1.pdf" in names
        assert "file_2.pdf" in names

    def test_list_nonexistent_request(self, service):
        """List attachments for non-existent request raises TicketsNotFoundError."""
        with pytest.raises(TicketsNotFoundError):
            service.list_attachments(99999)

    def test_list_after_delete(self, service):
        """List attachments reflects deletions."""
        seed = service._seed
        att1 = service.upload_attachment(
            request_id=seed["request_id"],
            file_name="keep.pdf",
            file_content=b"keep",
            file_type="other",
            user_id=seed["user_id"],
            base_upload_dir=seed["upload_dir"],
        )
        att2 = service.upload_attachment(
            request_id=seed["request_id"],
            file_name="delete_me.pdf",
            file_content=b"delete",
            file_type="other",
            user_id=seed["user_id"],
            base_upload_dir=seed["upload_dir"],
        )

        service.delete_attachment(
            request_id=seed["request_id"],
            attachment_id=att2["id"],
            user_id=seed["user_id"],
        )

        result = service.list_attachments(seed["request_id"])
        assert len(result) == 1
        assert result[0]["file_name"] == "keep.pdf"
