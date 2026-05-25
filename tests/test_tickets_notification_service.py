"""Tests for TicketsNotificationService (task 8.4).

Tests cover:
- check_departure_soon(): finds requests with upcoming departures not in terminal statuses
- check_missing_data_stale(): finds requests stuck in missing_data status
- check_stuck_requests(): finds requests with no status change for N days
- check_new_losses(): finds loss financial operations created in last 24h
- get_all_pending(): aggregates all notifications, filters dismissed
- dismiss_notification(): marks notification as dismissed for a user
- Configurable thresholds via ticket_notification_rules table
- Rule enable/disable functionality
"""
from __future__ import annotations

import sys
from contextlib import contextmanager
from datetime import datetime, timedelta, timezone
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
    TicketEmployee,
    TicketFinancialOp,
    TicketNotificationRule,
    TicketObject,
    TicketRequest,
)
from backend.services.tickets_notification_service import (
    DEFAULT_DEPARTURE_SOON_DAYS,
    DEFAULT_MISSING_DATA_STALE_DAYS,
    DEFAULT_STUCK_REQUEST_DAYS,
    RULE_DEPARTURE_SOON,
    RULE_MISSING_DATA_STALE,
    RULE_NEW_LOSS,
    RULE_STUCK_REQUEST,
    TicketsNotificationService,
)


# ---------------------------------------------------------------------------
# Fixtures
# ---------------------------------------------------------------------------


def _sqlite_url(temp_dir: str) -> str:
    return f"sqlite:///{(Path(temp_dir) / 'tickets_notifications.db').as_posix()}"


@pytest.fixture
def db_setup(temp_dir, monkeypatch):
    """Create a fresh SQLite database with all ticket tables and seed data."""
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

    monkeypatch.setattr(
        "backend.services.tickets_notification_service.app_session", _test_app_session
    )

    # Seed base data
    now = datetime.now(timezone.utc)
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

        # Seed notification rules
        rules = [
            TicketNotificationRule(
                rule_type=RULE_DEPARTURE_SOON,
                is_enabled=True,
                threshold_days=3,
                notify_roles="admin,operator",
            ),
            TicketNotificationRule(
                rule_type=RULE_MISSING_DATA_STALE,
                is_enabled=True,
                threshold_days=3,
                notify_roles="admin,operator",
            ),
            TicketNotificationRule(
                rule_type=RULE_STUCK_REQUEST,
                is_enabled=True,
                threshold_days=5,
                notify_roles="admin,operator",
            ),
            TicketNotificationRule(
                rule_type=RULE_NEW_LOSS,
                is_enabled=True,
                threshold_days=None,
                notify_roles="admin,operator",
            ),
        ]
        session.add_all(rules)
        session.flush()

    return {
        "session_factory": _test_app_session,
        "emp_id": emp_id,
        "obj_id": obj_id,
        "user_id": 1,
        "now": now,
    }


@pytest.fixture
def service(db_setup):
    """Create a TicketsNotificationService instance."""
    return TicketsNotificationService()


# ---------------------------------------------------------------------------
# Tests: check_departure_soon
# ---------------------------------------------------------------------------


class TestCheckDepartureSoon:
    """Tests for check_departure_soon()."""

    def test_finds_request_with_departure_within_threshold(self, service, db_setup):
        """Request with departure in 2 days and status 'in_progress' should be flagged."""
        now = datetime.now(timezone.utc)
        session_factory = db_setup["session_factory"]

        with session_factory() as session:
            req = TicketRequest(
                employee_id=db_setup["emp_id"],
                object_id=db_setup["obj_id"],
                status="in_progress",
                departure_date=now + timedelta(days=2),
                created_at=now,
                updated_at=now,
            )
            session.add(req)
            session.flush()
            req_id = req.id

        notifications = service.check_departure_soon()
        assert len(notifications) == 1
        assert notifications[0].request_id == req_id
        assert notifications[0].rule_type == RULE_DEPARTURE_SOON

    def test_excludes_purchased_status(self, service, db_setup):
        """Request with status 'purchased' should NOT be flagged."""
        now = datetime.now(timezone.utc)
        session_factory = db_setup["session_factory"]

        with session_factory() as session:
            req = TicketRequest(
                employee_id=db_setup["emp_id"],
                object_id=db_setup["obj_id"],
                status="purchased",
                departure_date=now + timedelta(days=1),
                created_at=now,
                updated_at=now,
            )
            session.add(req)
            session.flush()

        notifications = service.check_departure_soon()
        assert len(notifications) == 0

    def test_excludes_cancelled_status(self, service, db_setup):
        """Request with status 'cancelled' should NOT be flagged."""
        now = datetime.now(timezone.utc)
        session_factory = db_setup["session_factory"]

        with session_factory() as session:
            req = TicketRequest(
                employee_id=db_setup["emp_id"],
                object_id=db_setup["obj_id"],
                status="cancelled",
                departure_date=now + timedelta(days=1),
                created_at=now,
                updated_at=now,
            )
            session.add(req)
            session.flush()

        notifications = service.check_departure_soon()
        assert len(notifications) == 0

    def test_excludes_departure_beyond_threshold(self, service, db_setup):
        """Request with departure in 10 days should NOT be flagged (threshold=3)."""
        now = datetime.now(timezone.utc)
        session_factory = db_setup["session_factory"]

        with session_factory() as session:
            req = TicketRequest(
                employee_id=db_setup["emp_id"],
                object_id=db_setup["obj_id"],
                status="in_progress",
                departure_date=now + timedelta(days=10),
                created_at=now,
                updated_at=now,
            )
            session.add(req)
            session.flush()

        notifications = service.check_departure_soon()
        assert len(notifications) == 0

    def test_excludes_past_departure(self, service, db_setup):
        """Request with departure in the past should NOT be flagged."""
        now = datetime.now(timezone.utc)
        session_factory = db_setup["session_factory"]

        with session_factory() as session:
            req = TicketRequest(
                employee_id=db_setup["emp_id"],
                object_id=db_setup["obj_id"],
                status="in_progress",
                departure_date=now - timedelta(days=1),
                created_at=now,
                updated_at=now,
            )
            session.add(req)
            session.flush()

        notifications = service.check_departure_soon()
        assert len(notifications) == 0

    def test_custom_threshold(self, service, db_setup):
        """Custom threshold overrides DB value."""
        now = datetime.now(timezone.utc)
        session_factory = db_setup["session_factory"]

        with session_factory() as session:
            req = TicketRequest(
                employee_id=db_setup["emp_id"],
                object_id=db_setup["obj_id"],
                status="in_progress",
                departure_date=now + timedelta(days=4),
                created_at=now,
                updated_at=now,
            )
            session.add(req)
            session.flush()

        # Default threshold is 3, so 4 days out should not be flagged
        notifications = service.check_departure_soon()
        assert len(notifications) == 0

        # With threshold=5, it should be flagged
        notifications = service.check_departure_soon(days_threshold=5)
        assert len(notifications) == 1

    def test_severity_critical_for_1_day(self, service, db_setup):
        """Departure within 1 day should have 'critical' severity."""
        now = datetime.now(timezone.utc)
        session_factory = db_setup["session_factory"]

        with session_factory() as session:
            req = TicketRequest(
                employee_id=db_setup["emp_id"],
                object_id=db_setup["obj_id"],
                status="in_progress",
                departure_date=now + timedelta(hours=12),
                created_at=now,
                updated_at=now,
            )
            session.add(req)
            session.flush()

        notifications = service.check_departure_soon()
        assert len(notifications) == 1
        assert notifications[0].severity == "critical"


# ---------------------------------------------------------------------------
# Tests: check_missing_data_stale
# ---------------------------------------------------------------------------


class TestCheckMissingDataStale:
    """Tests for check_missing_data_stale()."""

    def test_finds_stale_missing_data_request(self, service, db_setup):
        """Request in missing_data for 5 days should be flagged (threshold=3)."""
        now = datetime.now(timezone.utc)
        session_factory = db_setup["session_factory"]

        with session_factory() as session:
            req = TicketRequest(
                employee_id=db_setup["emp_id"],
                object_id=db_setup["obj_id"],
                status="missing_data",
                created_at=now - timedelta(days=10),
                updated_at=now - timedelta(days=5),
            )
            session.add(req)
            session.flush()
            req_id = req.id

        notifications = service.check_missing_data_stale()
        assert len(notifications) == 1
        assert notifications[0].request_id == req_id
        assert notifications[0].rule_type == RULE_MISSING_DATA_STALE

    def test_excludes_recently_updated(self, service, db_setup):
        """Request in missing_data updated 1 day ago should NOT be flagged."""
        now = datetime.now(timezone.utc)
        session_factory = db_setup["session_factory"]

        with session_factory() as session:
            req = TicketRequest(
                employee_id=db_setup["emp_id"],
                object_id=db_setup["obj_id"],
                status="missing_data",
                created_at=now - timedelta(days=10),
                updated_at=now - timedelta(days=1),
            )
            session.add(req)
            session.flush()

        notifications = service.check_missing_data_stale()
        assert len(notifications) == 0

    def test_excludes_other_statuses(self, service, db_setup):
        """Request in 'new' status should NOT be flagged by missing_data check."""
        now = datetime.now(timezone.utc)
        session_factory = db_setup["session_factory"]

        with session_factory() as session:
            req = TicketRequest(
                employee_id=db_setup["emp_id"],
                object_id=db_setup["obj_id"],
                status="new",
                created_at=now - timedelta(days=10),
                updated_at=now - timedelta(days=10),
            )
            session.add(req)
            session.flush()

        notifications = service.check_missing_data_stale()
        assert len(notifications) == 0


# ---------------------------------------------------------------------------
# Tests: check_stuck_requests
# ---------------------------------------------------------------------------


class TestCheckStuckRequests:
    """Tests for check_stuck_requests()."""

    def test_finds_stuck_request(self, service, db_setup):
        """Request not updated for 7 days in non-terminal status should be flagged."""
        now = datetime.now(timezone.utc)
        session_factory = db_setup["session_factory"]

        with session_factory() as session:
            req = TicketRequest(
                employee_id=db_setup["emp_id"],
                object_id=db_setup["obj_id"],
                status="in_progress",
                created_at=now - timedelta(days=10),
                updated_at=now - timedelta(days=7),
            )
            session.add(req)
            session.flush()
            req_id = req.id

        notifications = service.check_stuck_requests()
        assert len(notifications) == 1
        assert notifications[0].request_id == req_id
        assert notifications[0].rule_type == RULE_STUCK_REQUEST

    def test_excludes_terminal_statuses(self, service, db_setup):
        """Requests in terminal statuses should NOT be flagged."""
        now = datetime.now(timezone.utc)
        session_factory = db_setup["session_factory"]

        terminal = ["closed", "archive", "cancelled", "purchased"]
        with session_factory() as session:
            for status in terminal:
                req = TicketRequest(
                    employee_id=db_setup["emp_id"],
                    object_id=db_setup["obj_id"],
                    status=status,
                    created_at=now - timedelta(days=20),
                    updated_at=now - timedelta(days=20),
                )
                session.add(req)
            session.flush()

        notifications = service.check_stuck_requests()
        assert len(notifications) == 0

    def test_excludes_recently_updated(self, service, db_setup):
        """Request updated 2 days ago should NOT be flagged (threshold=5)."""
        now = datetime.now(timezone.utc)
        session_factory = db_setup["session_factory"]

        with session_factory() as session:
            req = TicketRequest(
                employee_id=db_setup["emp_id"],
                object_id=db_setup["obj_id"],
                status="in_progress",
                created_at=now - timedelta(days=10),
                updated_at=now - timedelta(days=2),
            )
            session.add(req)
            session.flush()

        notifications = service.check_stuck_requests()
        assert len(notifications) == 0

    def test_severity_critical_for_long_stuck(self, service, db_setup):
        """Request stuck for 15 days should have 'critical' severity."""
        now = datetime.now(timezone.utc)
        session_factory = db_setup["session_factory"]

        with session_factory() as session:
            req = TicketRequest(
                employee_id=db_setup["emp_id"],
                object_id=db_setup["obj_id"],
                status="new",
                created_at=now - timedelta(days=20),
                updated_at=now - timedelta(days=15),
            )
            session.add(req)
            session.flush()

        notifications = service.check_stuck_requests()
        assert len(notifications) == 1
        assert notifications[0].severity == "critical"


# ---------------------------------------------------------------------------
# Tests: check_new_losses
# ---------------------------------------------------------------------------


class TestCheckNewLosses:
    """Tests for check_new_losses()."""

    def test_finds_recent_loss(self, service, db_setup):
        """Loss created 2 hours ago should be flagged."""
        now = datetime.now(timezone.utc)
        session_factory = db_setup["session_factory"]

        with session_factory() as session:
            op = TicketFinancialOp(
                op_type="loss",
                amount=Decimal("5000.00"),
                is_deleted=False,
                created_at=now - timedelta(hours=2),
                updated_at=now - timedelta(hours=2),
            )
            session.add(op)
            session.flush()
            op_id = op.id

        notifications = service.check_new_losses()
        assert len(notifications) == 1
        assert notifications[0].financial_op_id == op_id
        assert notifications[0].rule_type == RULE_NEW_LOSS

    def test_excludes_old_losses(self, service, db_setup):
        """Loss created 48 hours ago should NOT be flagged."""
        now = datetime.now(timezone.utc)
        session_factory = db_setup["session_factory"]

        with session_factory() as session:
            op = TicketFinancialOp(
                op_type="loss",
                amount=Decimal("5000.00"),
                is_deleted=False,
                created_at=now - timedelta(hours=48),
                updated_at=now - timedelta(hours=48),
            )
            session.add(op)
            session.flush()

        notifications = service.check_new_losses()
        assert len(notifications) == 0

    def test_excludes_refund_type(self, service, db_setup):
        """Financial op of type 'refund' should NOT be flagged."""
        now = datetime.now(timezone.utc)
        session_factory = db_setup["session_factory"]

        with session_factory() as session:
            op = TicketFinancialOp(
                op_type="refund",
                amount=Decimal("3000.00"),
                is_deleted=False,
                created_at=now - timedelta(hours=1),
                updated_at=now - timedelta(hours=1),
            )
            session.add(op)
            session.flush()

        notifications = service.check_new_losses()
        assert len(notifications) == 0

    def test_excludes_deleted_losses(self, service, db_setup):
        """Soft-deleted loss should NOT be flagged."""
        now = datetime.now(timezone.utc)
        session_factory = db_setup["session_factory"]

        with session_factory() as session:
            op = TicketFinancialOp(
                op_type="loss",
                amount=Decimal("5000.00"),
                is_deleted=True,
                created_at=now - timedelta(hours=1),
                updated_at=now - timedelta(hours=1),
            )
            session.add(op)
            session.flush()

        notifications = service.check_new_losses()
        assert len(notifications) == 0


# ---------------------------------------------------------------------------
# Tests: get_all_pending
# ---------------------------------------------------------------------------


class TestGetAllPending:
    """Tests for get_all_pending()."""

    def test_aggregates_all_notifications(self, service, db_setup):
        """get_all_pending should combine notifications from all check methods."""
        now = datetime.now(timezone.utc)
        session_factory = db_setup["session_factory"]

        with session_factory() as session:
            # Departure soon
            req1 = TicketRequest(
                employee_id=db_setup["emp_id"],
                object_id=db_setup["obj_id"],
                status="in_progress",
                departure_date=now + timedelta(days=1),
                created_at=now,
                updated_at=now,
            )
            # Stuck request
            req2 = TicketRequest(
                employee_id=db_setup["emp_id"],
                object_id=db_setup["obj_id"],
                status="new",
                created_at=now - timedelta(days=10),
                updated_at=now - timedelta(days=10),
            )
            session.add_all([req1, req2])
            session.flush()

        user = {"id": 1, "role": "admin"}
        notifications = service.get_all_pending(user)
        assert len(notifications) >= 2

    def test_filters_dismissed_notifications(self, service, db_setup):
        """Dismissed notifications should not appear in get_all_pending."""
        now = datetime.now(timezone.utc)
        session_factory = db_setup["session_factory"]

        with session_factory() as session:
            req = TicketRequest(
                employee_id=db_setup["emp_id"],
                object_id=db_setup["obj_id"],
                status="in_progress",
                departure_date=now + timedelta(days=1),
                created_at=now,
                updated_at=now,
            )
            session.add(req)
            session.flush()
            req_id = req.id

        user = {"id": 1, "role": "admin"}

        # Before dismiss
        notifications = service.get_all_pending(user)
        assert any(n.request_id == req_id for n in notifications)

        # Dismiss the notification
        notification_id = f"departure_soon_{req_id}"
        service.dismiss_notification(notification_id, user)

        # After dismiss
        notifications = service.get_all_pending(user)
        assert not any(n.id == notification_id for n in notifications)

    def test_no_user_returns_all(self, service, db_setup):
        """get_all_pending with user=None returns all notifications without filtering."""
        now = datetime.now(timezone.utc)
        session_factory = db_setup["session_factory"]

        with session_factory() as session:
            req = TicketRequest(
                employee_id=db_setup["emp_id"],
                object_id=db_setup["obj_id"],
                status="in_progress",
                departure_date=now + timedelta(days=1),
                created_at=now,
                updated_at=now,
            )
            session.add(req)
            session.flush()

        notifications = service.get_all_pending(user=None)
        assert len(notifications) >= 1


# ---------------------------------------------------------------------------
# Tests: dismiss_notification
# ---------------------------------------------------------------------------


class TestDismissNotification:
    """Tests for dismiss_notification()."""

    def test_dismiss_stores_for_user(self, service, db_setup):
        """Dismissed notification is stored per user."""
        user = {"id": 42, "role": "operator"}
        service.dismiss_notification("test_notification_1", user)

        assert "test_notification_1" in service._dismissed[42]

    def test_dismiss_does_not_affect_other_users(self, service, db_setup):
        """Dismissing for one user doesn't affect another."""
        user1 = {"id": 1, "role": "admin"}
        user2 = {"id": 2, "role": "operator"}

        service.dismiss_notification("notif_1", user1)

        assert "notif_1" in service._dismissed.get(1, set())
        assert "notif_1" not in service._dismissed.get(2, set())

    def test_dismiss_no_user_id_is_noop(self, service, db_setup):
        """Dismissing with no user id does nothing."""
        user = {"role": "admin"}  # no 'id' key
        service.dismiss_notification("notif_1", user)
        # Should not raise


# ---------------------------------------------------------------------------
# Tests: Rule configuration
# ---------------------------------------------------------------------------


class TestRuleConfiguration:
    """Tests for rule loading and updating."""

    def test_disabled_rule_returns_empty(self, service, db_setup):
        """When a rule is disabled, the check method returns empty list."""
        now = datetime.now(timezone.utc)
        session_factory = db_setup["session_factory"]

        # Create a request that would normally trigger departure_soon
        with session_factory() as session:
            req = TicketRequest(
                employee_id=db_setup["emp_id"],
                object_id=db_setup["obj_id"],
                status="in_progress",
                departure_date=now + timedelta(days=1),
                created_at=now,
                updated_at=now,
            )
            session.add(req)
            session.flush()

        # Verify it's flagged when enabled
        notifications = service.check_departure_soon()
        assert len(notifications) == 1

        # Disable the rule
        with session_factory() as session:
            rule = session.scalars(
                select(TicketNotificationRule).where(
                    TicketNotificationRule.rule_type == RULE_DEPARTURE_SOON
                )
            ).first()
            rule.is_enabled = False
            session.flush()

        # Should return empty now
        notifications = service.check_departure_soon()
        assert len(notifications) == 0

    def test_custom_threshold_from_db(self, service, db_setup):
        """Threshold loaded from DB overrides default."""
        now = datetime.now(timezone.utc)
        session_factory = db_setup["session_factory"]

        # Create request with departure in 6 days
        with session_factory() as session:
            req = TicketRequest(
                employee_id=db_setup["emp_id"],
                object_id=db_setup["obj_id"],
                status="in_progress",
                departure_date=now + timedelta(days=6),
                created_at=now,
                updated_at=now,
            )
            session.add(req)
            session.flush()

        # Default threshold is 3, so 6 days out should not be flagged
        notifications = service.check_departure_soon()
        assert len(notifications) == 0

        # Update threshold to 7 days in DB
        with session_factory() as session:
            rule = session.scalars(
                select(TicketNotificationRule).where(
                    TicketNotificationRule.rule_type == RULE_DEPARTURE_SOON
                )
            ).first()
            rule.threshold_days = 7
            session.flush()

        # Now it should be flagged
        notifications = service.check_departure_soon()
        assert len(notifications) == 1

    def test_get_rules(self, service, db_setup):
        """get_rules returns all notification rules."""
        rules = service.get_rules()
        assert len(rules) == 4
        rule_types = {r["rule_type"] for r in rules}
        assert rule_types == {
            RULE_DEPARTURE_SOON,
            RULE_MISSING_DATA_STALE,
            RULE_STUCK_REQUEST,
            RULE_NEW_LOSS,
        }

    def test_update_rule(self, service, db_setup):
        """update_rule modifies rule settings."""
        rules = service.get_rules()
        departure_rule = next(r for r in rules if r["rule_type"] == RULE_DEPARTURE_SOON)

        updated = service.update_rule(departure_rule["id"], {
            "is_enabled": False,
            "threshold_days": 7,
            "notify_roles": "admin",
        })

        assert updated["is_enabled"] is False
        assert updated["threshold_days"] == 7
        assert updated["notify_roles"] == "admin"

    def test_update_rule_not_found(self, service, db_setup):
        """update_rule raises ValueError for non-existent rule."""
        with pytest.raises(ValueError, match="not found"):
            service.update_rule(9999, {"is_enabled": False})


# ---------------------------------------------------------------------------
# Tests: Notification data structure
# ---------------------------------------------------------------------------


class TestNotificationStructure:
    """Tests for notification dict output."""

    def test_notification_to_dict(self, service, db_setup):
        """Notification.to_dict() returns expected structure."""
        now = datetime.now(timezone.utc)
        session_factory = db_setup["session_factory"]

        with session_factory() as session:
            req = TicketRequest(
                employee_id=db_setup["emp_id"],
                object_id=db_setup["obj_id"],
                status="in_progress",
                departure_date=now + timedelta(days=2),
                created_at=now,
                updated_at=now,
            )
            session.add(req)
            session.flush()

        notifications = service.check_departure_soon()
        assert len(notifications) == 1

        d = notifications[0].to_dict()
        assert "id" in d
        assert "rule_type" in d
        assert "title" in d
        assert "message" in d
        assert "request_id" in d
        assert "severity" in d
        assert "created_at" in d
        assert d["rule_type"] == RULE_DEPARTURE_SOON
