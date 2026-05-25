"""
Property-based tests for encryption, masking, and employee document validation.

Properties tested:
- Property 19: Personal data masking by permission
- Property 20: Encryption round-trip
- Property 21: Employee document validation

**Validates: Requirements 7.3, 7.4, 14.3, 14.4, 14.5**

Uses @settings(max_examples=15) on all property tests to keep execution fast.
"""
from __future__ import annotations

import os
import sys
import uuid
from contextlib import contextmanager
from datetime import datetime, timedelta, timezone
from pathlib import Path

import pytest
from hypothesis import given, settings, HealthCheck
from hypothesis import strategies as st
from sqlalchemy import create_engine, event
from sqlalchemy.orm import sessionmaker

# Ensure crypto key is set for tests
os.environ.setdefault("MAIL_CREDENTIALS_KEY", "test-key-for-tickets-prop-encryption-tests-32ch")

PROJECT_ROOT = Path(__file__).resolve().parents[1]
WEB_ROOT = PROJECT_ROOT / "WEB-itinvent"

if str(WEB_ROOT) not in sys.path:
    sys.path.insert(0, str(WEB_ROOT))

from backend.appdb.models import AppBase
from backend.appdb.tickets_models import TicketEmployee, TicketEmployeeDocument
from backend.services.secret_crypto_service import decrypt_secret, encrypt_secret
from backend.services.tickets_service import (
    MASKED_VALUE,
    TicketsService,
    TicketsValidationError,
)


# ---------------------------------------------------------------------------
# Fixtures
# ---------------------------------------------------------------------------


@pytest.fixture
def service(temp_dir, monkeypatch):
    """Create a TicketsService with a fresh SQLite database."""
    import backend.appdb.db as appdb

    url = f"sqlite:///{(Path(temp_dir) / 'tickets_prop_enc.db').as_posix()}"

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

    svc = TicketsService()
    svc._test_session_factory = _test_app_session
    return svc


# ---------------------------------------------------------------------------
# Strategies
# ---------------------------------------------------------------------------

# Non-empty text for personal data values (stripped — no leading/trailing whitespace)
# The service strips inputs before encryption, so we generate pre-stripped strings.
personal_data_text = st.text(
    min_size=1,
    max_size=100,
    alphabet=st.characters(
        blacklist_categories=("Cs",),  # Exclude surrogates
        blacklist_characters="\x00",
    ),
).map(str.strip).filter(lambda s: len(s) > 0)

# Past date strategy for issue_date (valid dates)
past_date_strategy = st.datetimes(
    min_value=datetime(1950, 1, 1),
    max_value=datetime(2024, 1, 1),
    timezones=st.just(timezone.utc),
)

# Future date strategy for invalid issue_date
future_date_strategy = st.datetimes(
    min_value=datetime(2030, 1, 1),
    max_value=datetime(2100, 12, 31),
    timezones=st.just(timezone.utc),
)


# ---------------------------------------------------------------------------
# Property 19: Personal data masking by permission
# ---------------------------------------------------------------------------


class TestProperty19MaskingByPermission:
    """
    **Validates: Requirements 7.3, 7.4, 14.4**

    For any employee with documents, get_employee without tickets.personal_data.read
    returns MASKED_VALUE for all encrypted fields; with the permission returns the
    original values.
    """

    @settings(
        max_examples=15,
        suppress_health_check=[HealthCheck.function_scoped_fixture],
        deadline=None,
    )
    @given(
        passport=personal_data_text,
        issued_by=personal_data_text,
        registration_address=personal_data_text,
    )
    def test_masking_without_permission(self, service, passport, issued_by, registration_address):
        """Without tickets.personal_data.read, all encrypted fields return MASKED_VALUE."""
        now = datetime.now(timezone.utc)

        # Create employee with document directly via the session
        with service._test_session_factory() as session:
            emp = TicketEmployee(
                full_name=f"Test Employee {uuid.uuid4().hex[:8]}",
                status="active",
                created_at=now,
                updated_at=now,
            )
            session.add(emp)
            session.flush()

            doc = TicketEmployeeDocument(
                employee_id=emp.id,
                passport_series_number_enc=encrypt_secret(passport),
                issued_by_enc=encrypt_secret(issued_by),
                issue_date=datetime(2020, 1, 1, tzinfo=timezone.utc),
                registration_address_enc=encrypt_secret(registration_address),
                is_current=True,
                created_at=now,
                updated_at=now,
            )
            session.add(doc)
            session.flush()
            emp_id = emp.id

        # Request without personal_data.read permission
        result = service.get_employee(emp_id, user_permissions=["tickets.read"])

        assert len(result["documents"]) == 1
        doc_result = result["documents"][0]

        # All encrypted fields must be masked
        assert doc_result["passport_series_number"] == MASKED_VALUE
        assert doc_result["issued_by"] == MASKED_VALUE
        assert doc_result["registration_address"] == MASKED_VALUE

    @settings(
        max_examples=15,
        suppress_health_check=[HealthCheck.function_scoped_fixture],
        deadline=None,
    )
    @given(
        passport=personal_data_text,
        issued_by=personal_data_text,
        registration_address=personal_data_text,
    )
    def test_decryption_with_permission(self, service, passport, issued_by, registration_address):
        """With tickets.personal_data.read, all encrypted fields return original values."""
        now = datetime.now(timezone.utc)

        # Create employee with document directly via the session
        with service._test_session_factory() as session:
            emp = TicketEmployee(
                full_name=f"Test Employee {uuid.uuid4().hex[:8]}",
                status="active",
                created_at=now,
                updated_at=now,
            )
            session.add(emp)
            session.flush()

            doc = TicketEmployeeDocument(
                employee_id=emp.id,
                passport_series_number_enc=encrypt_secret(passport),
                issued_by_enc=encrypt_secret(issued_by),
                issue_date=datetime(2020, 1, 1, tzinfo=timezone.utc),
                registration_address_enc=encrypt_secret(registration_address),
                is_current=True,
                created_at=now,
                updated_at=now,
            )
            session.add(doc)
            session.flush()
            emp_id = emp.id

        # Request with personal_data.read permission
        result = service.get_employee(
            emp_id,
            user_permissions=["tickets.read", "tickets.personal_data.read"],
        )

        assert len(result["documents"]) == 1
        doc_result = result["documents"][0]

        # All encrypted fields must return original plaintext values
        assert doc_result["passport_series_number"] == passport
        assert doc_result["issued_by"] == issued_by
        assert doc_result["registration_address"] == registration_address


# ---------------------------------------------------------------------------
# Property 20: Encryption round-trip
# ---------------------------------------------------------------------------


class TestProperty20EncryptionRoundTrip:
    """
    **Validates: Requirements 14.3**

    For any string, encrypt_secret followed by decrypt_secret returns the original
    string. Empty string encrypts to empty string.
    """

    @settings(max_examples=15)
    @given(data=personal_data_text)
    def test_encrypt_decrypt_roundtrip(self, data):
        """For any non-empty string, decrypt(encrypt(data)) == data."""
        encrypted = encrypt_secret(data)
        decrypted = decrypt_secret(encrypted)
        assert decrypted == data

    @settings(max_examples=15)
    @given(data=personal_data_text)
    def test_encrypted_differs_from_plaintext(self, data):
        """For any non-empty string, the encrypted value must differ from plaintext."""
        encrypted = encrypt_secret(data)
        assert encrypted != data

    def test_empty_string_encrypts_to_empty(self):
        """Empty string encrypts to empty string (special case)."""
        assert encrypt_secret("") == ""
        assert decrypt_secret("") == ""


# ---------------------------------------------------------------------------
# Property 21: Employee document validation
# ---------------------------------------------------------------------------


class TestProperty21DocumentValidation:
    """
    **Validates: Requirements 14.5**

    For any document data missing a mandatory field (passport, issued_by, issue_date)
    or with issue_date in the future, validation fails.
    """

    @settings(
        max_examples=15,
        suppress_health_check=[HealthCheck.function_scoped_fixture],
        deadline=None,
    )
    @given(
        issued_by=personal_data_text,
        issue_date=past_date_strategy,
    )
    def test_missing_passport_fails(self, service, issued_by, issue_date):
        """Document without passport_series_number is rejected."""
        with pytest.raises(TicketsValidationError) as exc_info:
            service.create_employee(
                {
                    "full_name": "Test Employee",
                    "documents": [
                        {
                            "passport_series_number": "",
                            "issued_by": issued_by,
                            "issue_date": issue_date.strftime("%Y-%m-%d"),
                        }
                    ],
                }
            )
        assert any("passport_series_number" in e for e in exc_info.value.errors)

    @settings(
        max_examples=15,
        suppress_health_check=[HealthCheck.function_scoped_fixture],
        deadline=None,
    )
    @given(
        passport=personal_data_text,
        issue_date=past_date_strategy,
    )
    def test_missing_issued_by_fails(self, service, passport, issue_date):
        """Document without issued_by is rejected."""
        with pytest.raises(TicketsValidationError) as exc_info:
            service.create_employee(
                {
                    "full_name": "Test Employee",
                    "documents": [
                        {
                            "passport_series_number": passport,
                            "issued_by": "",
                            "issue_date": issue_date.strftime("%Y-%m-%d"),
                        }
                    ],
                }
            )
        assert any("issued_by" in e for e in exc_info.value.errors)

    @settings(
        max_examples=15,
        suppress_health_check=[HealthCheck.function_scoped_fixture],
        deadline=None,
    )
    @given(
        passport=personal_data_text,
        issued_by=personal_data_text,
    )
    def test_missing_issue_date_fails(self, service, passport, issued_by):
        """Document without issue_date is rejected."""
        with pytest.raises(TicketsValidationError) as exc_info:
            service.create_employee(
                {
                    "full_name": "Test Employee",
                    "documents": [
                        {
                            "passport_series_number": passport,
                            "issued_by": issued_by,
                            "issue_date": "",
                        }
                    ],
                }
            )
        assert any("issue_date" in e for e in exc_info.value.errors)

    @settings(
        max_examples=15,
        suppress_health_check=[HealthCheck.function_scoped_fixture],
        deadline=None,
    )
    @given(
        passport=personal_data_text,
        issued_by=personal_data_text,
        future_date=future_date_strategy,
    )
    def test_future_issue_date_fails(self, service, passport, issued_by, future_date):
        """Document with issue_date in the future is rejected."""
        with pytest.raises(TicketsValidationError) as exc_info:
            service.create_employee(
                {
                    "full_name": "Test Employee",
                    "documents": [
                        {
                            "passport_series_number": passport,
                            "issued_by": issued_by,
                            "issue_date": future_date.strftime("%Y-%m-%d"),
                        }
                    ],
                }
            )
        assert any("issue_date" in e for e in exc_info.value.errors)

    @settings(
        max_examples=15,
        suppress_health_check=[HealthCheck.function_scoped_fixture],
        deadline=None,
    )
    @given(
        passport=personal_data_text,
        issued_by=personal_data_text,
        issue_date=past_date_strategy,
        registration_address=personal_data_text,
    )
    def test_valid_document_succeeds(self, service, passport, issued_by, issue_date, registration_address):
        """Document with all mandatory fields and past issue_date is accepted."""
        result = service.create_employee(
            {
                "full_name": "Valid Doc Employee",
                "documents": [
                    {
                        "passport_series_number": passport,
                        "issued_by": issued_by,
                        "issue_date": issue_date.strftime("%Y-%m-%d"),
                        "registration_address": registration_address,
                    }
                ],
            },
            user_permissions=["tickets.write", "tickets.personal_data.read"],
        )
        assert result["id"] is not None
        assert len(result["documents"]) == 1
        assert result["documents"][0]["passport_series_number"] == passport
        assert result["documents"][0]["issued_by"] == issued_by
