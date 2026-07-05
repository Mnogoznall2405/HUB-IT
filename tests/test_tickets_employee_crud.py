"""
Unit tests for TicketsService employee CRUD operations.
Tests encryption, masking, validation, and basic CRUD flows.
"""
from __future__ import annotations

import os
import uuid
from datetime import datetime, timedelta, timezone
from pathlib import Path

import pytest

# Ensure crypto key is set for tests
os.environ.setdefault("MAIL_CREDENTIALS_KEY", "test-key-for-tickets-employee-crud-unit-tests-32ch")

from backend.appdb.db import app_session, initialize_app_schema
from backend.appdb.tickets_models import TicketEmployee, TicketEmployeeDocument
from backend.services.secret_crypto_service import decrypt_secret, encrypt_secret
from backend.services.tickets_service import (
    MASKED_VALUE,
    Pagination,
    TicketsNotFoundError,
    TicketsService,
    TicketsValidationError,
    _parse_date,
)


@pytest.fixture
def db_url(temp_dir):
    """Create a fresh SQLite database for each test."""
    db_path = Path(temp_dir) / f"tickets_test_{uuid.uuid4().hex}.db"
    url = f"sqlite:///{db_path.as_posix()}"
    initialize_app_schema(url)
    return url


@pytest.fixture
def service(db_url):
    """Create a TicketsService instance with the test database URL."""
    return TicketsService(database_url=db_url)


# ---------------------------------------------------------------------------
# Tests: list_employees
# ---------------------------------------------------------------------------


class TestListEmployees:
    def test_empty_list(self, service):
        result = service.list_employees()
        assert result.items == []
        assert result.total == 0
        assert result.page == 1

    def test_list_with_employees(self, service, db_url):
        # Seed employees
        with app_session(db_url) as session:
            for i in range(3):
                emp = TicketEmployee(
                    full_name=f"Employee {i}",
                    status="active",
                    created_at=datetime.now(timezone.utc),
                    updated_at=datetime.now(timezone.utc),
                )
                session.add(emp)

        result = service.list_employees()
        assert result.total == 3
        assert len(result.items) == 3

    def test_search_by_name(self, service, db_url):
        with app_session(db_url) as session:
            session.add(TicketEmployee(
                full_name="Иванов Иван Иванович",
                status="active",
                created_at=datetime.now(timezone.utc),
                updated_at=datetime.now(timezone.utc),
            ))
            session.add(TicketEmployee(
                full_name="Петров Пётр Петрович",
                status="active",
                created_at=datetime.now(timezone.utc),
                updated_at=datetime.now(timezone.utc),
            ))

        # Search with matching case (SQLite doesn't support Unicode lower())
        result = service.list_employees(search="Иванов")
        assert result.total == 1
        assert result.items[0]["full_name"] == "Иванов Иван Иванович"

    def test_search_min_length(self, service, db_url):
        """Search with less than 2 chars should return all."""
        with app_session(db_url) as session:
            session.add(TicketEmployee(
                full_name="Test Employee",
                status="active",
                created_at=datetime.now(timezone.utc),
                updated_at=datetime.now(timezone.utc),
            ))

        # Single char search should not filter
        result = service.list_employees(search="T")
        assert result.total == 1  # Returns all

    def test_filter_by_status(self, service, db_url):
        with app_session(db_url) as session:
            session.add(TicketEmployee(
                full_name="Active Employee",
                status="active",
                created_at=datetime.now(timezone.utc),
                updated_at=datetime.now(timezone.utc),
            ))
            session.add(TicketEmployee(
                full_name="Dismissed Employee",
                status="dismissed",
                created_at=datetime.now(timezone.utc),
                updated_at=datetime.now(timezone.utc),
            ))

        result = service.list_employees(status="dismissed")
        assert result.total == 1
        assert result.items[0]["full_name"] == "Dismissed Employee"

    def test_pagination(self, service, db_url):
        with app_session(db_url) as session:
            for i in range(10):
                session.add(TicketEmployee(
                    full_name=f"Employee {i:02d}",
                    status="active",
                    created_at=datetime.now(timezone.utc),
                    updated_at=datetime.now(timezone.utc),
                ))

        result = service.list_employees(pagination=Pagination(page=1, page_size=25))
        assert result.total == 10
        assert len(result.items) == 10


# ---------------------------------------------------------------------------
# Tests: get_employee
# ---------------------------------------------------------------------------


class TestGetEmployee:
    def test_not_found(self, service):
        with pytest.raises(TicketsNotFoundError):
            service.get_employee(9999)

    def test_get_with_documents_masked(self, service, db_url):
        """Without personal_data.read permission, data should be masked."""
        with app_session(db_url) as session:
            emp = TicketEmployee(
                full_name="Test Person",
                status="active",
                date_of_birth_enc=encrypt_secret("1990-01-15"),
                created_at=datetime.now(timezone.utc),
                updated_at=datetime.now(timezone.utc),
            )
            session.add(emp)
            session.flush()

            doc = TicketEmployeeDocument(
                employee_id=emp.id,
                passport_series_number_enc=encrypt_secret("1234 567890"),
                issued_by_enc=encrypt_secret("ОВД Москвы"),
                issue_date=datetime(2020, 5, 10, tzinfo=timezone.utc),
                registration_address_enc=encrypt_secret("г. Москва, ул. Ленина, д. 1"),
                is_current=True,
                created_at=datetime.now(timezone.utc),
                updated_at=datetime.now(timezone.utc),
            )
            session.add(doc)
            session.flush()
            emp_id = emp.id

        # No permission — masked
        result = service.get_employee(emp_id, user_permissions=["tickets.read"])
        assert result["full_name"] == "Test Person"
        assert len(result["documents"]) == 1
        assert result["documents"][0]["passport_series_number"] == MASKED_VALUE
        assert result["documents"][0]["issued_by"] == MASKED_VALUE
        assert result["documents"][0]["registration_address"] == MASKED_VALUE

    def test_get_with_documents_decrypted(self, service, db_url):
        """With personal_data.read permission, data should be decrypted."""
        with app_session(db_url) as session:
            emp = TicketEmployee(
                full_name="Test Person",
                status="active",
                date_of_birth_enc=encrypt_secret("1990-01-15"),
                created_at=datetime.now(timezone.utc),
                updated_at=datetime.now(timezone.utc),
            )
            session.add(emp)
            session.flush()

            doc = TicketEmployeeDocument(
                employee_id=emp.id,
                passport_series_number_enc=encrypt_secret("1234 567890"),
                issued_by_enc=encrypt_secret("ОВД Москвы"),
                issue_date=datetime(2020, 5, 10, tzinfo=timezone.utc),
                registration_address_enc=encrypt_secret("г. Москва, ул. Ленина, д. 1"),
                is_current=True,
                created_at=datetime.now(timezone.utc),
                updated_at=datetime.now(timezone.utc),
            )
            session.add(doc)
            session.flush()
            emp_id = emp.id

        # With permission — decrypted
        result = service.get_employee(
            emp_id,
            user_permissions=["tickets.read", "tickets.personal_data.read"],
        )
        assert result["documents"][0]["passport_series_number"] == "1234 567890"
        assert result["documents"][0]["issued_by"] == "ОВД Москвы"
        assert result["documents"][0]["registration_address"] == "г. Москва, ул. Ленина, д. 1"


# ---------------------------------------------------------------------------
# Tests: create_employee
# ---------------------------------------------------------------------------


class TestCreateEmployee:
    def test_create_basic(self, service):
        result = service.create_employee(
            {"full_name": "Новый Сотрудник", "phone": "+79001234567"},
            user_permissions=["tickets.write", "tickets.personal_data.read"],
        )
        assert result["full_name"] == "Новый Сотрудник"
        assert result["phone"] == "+79001234567"
        assert result["status"] == "active"
        assert result["id"] is not None

    def test_create_with_document(self, service):
        result = service.create_employee(
            {
                "full_name": "Сотрудник с Документом",
                "documents": [
                    {
                        "passport_series_number": "4515 123456",
                        "issued_by": "УФМС России",
                        "issue_date": "2018-03-20",
                        "registration_address": "г. Санкт-Петербург",
                    }
                ],
            },
            user_permissions=["tickets.write", "tickets.personal_data.read"],
        )
        assert result["full_name"] == "Сотрудник с Документом"
        assert len(result["documents"]) == 1
        assert result["documents"][0]["passport_series_number"] == "4515 123456"
        assert result["documents"][0]["issued_by"] == "УФМС России"
        assert result["documents"][0]["issue_date"] is not None

    def test_create_with_department_position_and_split_passport(self, service):
        result = service.create_employee(
            {
                "full_name": "Новый Сотрудник",
                "department": "ИТ-отдел",
                "position": "Системный администратор",
                "documents": [
                    {
                        "passport_series": "4515",
                        "passport_number": "123456",
                        "issued_by": "УФМС России",
                        "issuer_code": "770-001",
                        "birth_place": "Москва",
                        "issue_date": "2018-03-20",
                        "registration_address": "г. Москва",
                    }
                ],
            },
            user_permissions=["tickets.write", "tickets.personal_data.read"],
        )
        assert result["department"] == "ИТ-отдел"
        assert result["position"] == "Системный администратор"
        assert result["documents"][0]["passport_series"] == "4515"
        assert result["documents"][0]["passport_number"] == "123456"
        assert result["documents"][0]["issuer_code"] == "770-001"
        assert result["documents"][0]["birth_place"] == "Москва"

    def test_create_missing_full_name(self, service):
        with pytest.raises(TicketsValidationError, match="full_name is required"):
            service.create_employee({"full_name": ""})

    def test_create_with_invalid_status(self, service):
        with pytest.raises(TicketsValidationError, match="status must be one of"):
            service.create_employee({"full_name": "Test", "status": "invalid_status"})

    def test_create_document_missing_passport(self, service):
        with pytest.raises(TicketsValidationError, match="passport_series_number or passport_series"):
            service.create_employee(
                {
                    "full_name": "Test",
                    "documents": [{"issued_by": "Test", "issue_date": "2020-01-01"}],
                }
            )

    def test_create_document_missing_issued_by(self, service):
        with pytest.raises(TicketsValidationError, match="issued_by is required"):
            service.create_employee(
                {
                    "full_name": "Test",
                    "documents": [
                        {"passport_series_number": "1234 567890", "issue_date": "2020-01-01"}
                    ],
                }
            )

    def test_create_document_missing_issue_date(self, service):
        with pytest.raises(TicketsValidationError, match="issue_date is required"):
            service.create_employee(
                {
                    "full_name": "Test",
                    "documents": [
                        {"passport_series_number": "1234 567890", "issued_by": "Test"}
                    ],
                }
            )

    def test_create_document_future_issue_date(self, service):
        future_date = (datetime.now(timezone.utc) + timedelta(days=30)).strftime("%Y-%m-%d")
        with pytest.raises(TicketsValidationError, match="issue_date must not be in the future"):
            service.create_employee(
                {
                    "full_name": "Test",
                    "documents": [
                        {
                            "passport_series_number": "1234 567890",
                            "issued_by": "Test",
                            "issue_date": future_date,
                        }
                    ],
                }
            )

    def test_create_document_encrypted_in_db(self, service, db_url):
        """Verify that personal data is actually encrypted in the database."""
        result = service.create_employee(
            {
                "full_name": "Encrypted Test",
                "documents": [
                    {
                        "passport_series_number": "9999 888777",
                        "issued_by": "Secret Agency",
                        "issue_date": "2019-06-15",
                        "registration_address": "Secret Address",
                    }
                ],
            },
            user_permissions=["tickets.write", "tickets.personal_data.read"],
        )

        # Read raw from DB — should be encrypted, not plaintext
        with app_session(db_url) as session:
            from sqlalchemy import select

            doc = session.scalars(
                select(TicketEmployeeDocument).where(
                    TicketEmployeeDocument.employee_id == result["id"]
                )
            ).first()
            assert doc is not None
            # Encrypted values should NOT be plaintext
            assert doc.passport_series_number_enc != "9999 888777"
            assert doc.issued_by_enc != "Secret Agency"
            assert doc.registration_address_enc != "Secret Address"
            # But decrypting should give back the original
            assert decrypt_secret(doc.passport_series_number_enc) == "9999 888777"
            assert decrypt_secret(doc.issued_by_enc) == "Secret Agency"
            assert decrypt_secret(doc.registration_address_enc) == "Secret Address"


# ---------------------------------------------------------------------------
# Tests: update_employee
# ---------------------------------------------------------------------------


class TestUpdateEmployee:
    def test_update_basic_fields(self, service, db_url):
        # Create employee first
        with app_session(db_url) as session:
            emp = TicketEmployee(
                full_name="Original Name",
                phone="+70001112233",
                status="active",
                created_at=datetime.now(timezone.utc),
                updated_at=datetime.now(timezone.utc),
            )
            session.add(emp)
            session.flush()
            emp_id = emp.id

        result = service.update_employee(
            emp_id,
            {"full_name": "Updated Name", "phone": "+79998887766"},
            user_permissions=["tickets.write"],
        )
        assert result["full_name"] == "Updated Name"
        assert result["phone"] == "+79998887766"

    def test_update_status(self, service, db_url):
        with app_session(db_url) as session:
            emp = TicketEmployee(
                full_name="To Dismiss",
                status="active",
                created_at=datetime.now(timezone.utc),
                updated_at=datetime.now(timezone.utc),
            )
            session.add(emp)
            session.flush()
            emp_id = emp.id

        result = service.update_employee(emp_id, {"status": "dismissed"})
        assert result["status"] == "dismissed"

    def test_update_not_found(self, service):
        with pytest.raises(TicketsNotFoundError):
            service.update_employee(9999, {"full_name": "Ghost"})

    def test_update_invalid_status(self, service, db_url):
        with app_session(db_url) as session:
            emp = TicketEmployee(
                full_name="Test",
                status="active",
                created_at=datetime.now(timezone.utc),
                updated_at=datetime.now(timezone.utc),
            )
            session.add(emp)
            session.flush()
            emp_id = emp.id

        with pytest.raises(TicketsValidationError, match="status must be one of"):
            service.update_employee(emp_id, {"status": "bogus"})

    def test_update_add_document(self, service, db_url):
        with app_session(db_url) as session:
            emp = TicketEmployee(
                full_name="Doc Test",
                status="active",
                created_at=datetime.now(timezone.utc),
                updated_at=datetime.now(timezone.utc),
            )
            session.add(emp)
            session.flush()
            emp_id = emp.id

        result = service.update_employee(
            emp_id,
            {
                "documents": [
                    {
                        "passport_series_number": "1111 222333",
                        "issued_by": "МВД",
                        "issue_date": "2021-01-01",
                    }
                ]
            },
            user_permissions=["tickets.write", "tickets.personal_data.read"],
        )
        assert len(result["documents"]) == 1
        assert result["documents"][0]["passport_series_number"] == "1111 222333"

    def test_update_existing_document(self, service, db_url):
        with app_session(db_url) as session:
            emp = TicketEmployee(
                full_name="Doc Update Test",
                status="active",
                created_at=datetime.now(timezone.utc),
                updated_at=datetime.now(timezone.utc),
            )
            session.add(emp)
            session.flush()

            doc = TicketEmployeeDocument(
                employee_id=emp.id,
                passport_series_number_enc=encrypt_secret("0000 111222"),
                issued_by_enc=encrypt_secret("Old Issuer"),
                issue_date=datetime(2019, 1, 1, tzinfo=timezone.utc),
                registration_address_enc=encrypt_secret("Old Address"),
                is_current=True,
                created_at=datetime.now(timezone.utc),
                updated_at=datetime.now(timezone.utc),
            )
            session.add(doc)
            session.flush()
            emp_id = emp.id
            doc_id = doc.id

        result = service.update_employee(
            emp_id,
            {
                "documents": [
                    {
                        "id": doc_id,
                        "passport_series_number": "5555 666777",
                        "issued_by": "New Issuer",
                    }
                ]
            },
            user_permissions=["tickets.write", "tickets.personal_data.read"],
        )
        assert result["documents"][0]["passport_series_number"] == "5555 666777"
        assert result["documents"][0]["issued_by"] == "New Issuer"

    def test_update_document_future_issue_date(self, service, db_url):
        with app_session(db_url) as session:
            emp = TicketEmployee(
                full_name="Future Date Test",
                status="active",
                created_at=datetime.now(timezone.utc),
                updated_at=datetime.now(timezone.utc),
            )
            session.add(emp)
            session.flush()

            doc = TicketEmployeeDocument(
                employee_id=emp.id,
                passport_series_number_enc=encrypt_secret("1234 567890"),
                issued_by_enc=encrypt_secret("Issuer"),
                issue_date=datetime(2020, 1, 1, tzinfo=timezone.utc),
                registration_address_enc="",
                is_current=True,
                created_at=datetime.now(timezone.utc),
                updated_at=datetime.now(timezone.utc),
            )
            session.add(doc)
            session.flush()
            emp_id = emp.id
            doc_id = doc.id

        future_date = (datetime.now(timezone.utc) + timedelta(days=30)).strftime("%Y-%m-%d")
        with pytest.raises(TicketsValidationError, match="issue_date must not be in the future"):
            service.update_employee(
                emp_id,
                {"documents": [{"id": doc_id, "issue_date": future_date}]},
            )


# ---------------------------------------------------------------------------
# Tests: _parse_date helper
# ---------------------------------------------------------------------------


class TestParseDate:
    def test_none(self):
        assert _parse_date(None) is None

    def test_empty_string(self):
        assert _parse_date("") is None

    def test_iso_date(self):
        result = _parse_date("2023-06-15")
        assert result == datetime(2023, 6, 15, tzinfo=timezone.utc)

    def test_iso_datetime(self):
        result = _parse_date("2023-06-15T10:30:00")
        assert result == datetime(2023, 6, 15, 10, 30, 0, tzinfo=timezone.utc)

    def test_datetime_object(self):
        dt = datetime(2023, 1, 1, 12, 0, 0, tzinfo=timezone.utc)
        assert _parse_date(dt) == dt

    def test_naive_datetime_gets_utc(self):
        dt = datetime(2023, 1, 1, 12, 0, 0)
        result = _parse_date(dt)
        assert result.tzinfo == timezone.utc

    def test_invalid_format(self):
        assert _parse_date("not-a-date") is None


# ---------------------------------------------------------------------------
# Tests: Encryption round-trip
# ---------------------------------------------------------------------------


class TestEncryptionRoundTrip:
    def test_encrypt_decrypt(self):
        original = "4515 123456"
        encrypted = encrypt_secret(original)
        assert encrypted != original
        assert decrypt_secret(encrypted) == original

    def test_empty_string(self):
        assert encrypt_secret("") == ""
        assert decrypt_secret("") == ""

    def test_none_value(self):
        assert encrypt_secret(None) == ""
        assert decrypt_secret(None) == ""
