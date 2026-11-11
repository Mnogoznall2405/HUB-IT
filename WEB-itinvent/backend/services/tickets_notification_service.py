"""Notification service for the Tickets/Logistics module.

Provides SLA-monitoring notifications:
- Departure soon (ticket not purchased)
- Missing data stale (request stuck in missing_data status)
- Stuck requests (no status change for N days)
- New losses (financial operations of type 'loss' in last 24h)

Thresholds are configurable via the ticket_notification_rules table.
"""
from __future__ import annotations

import logging
from dataclasses import dataclass, field
from datetime import datetime, timedelta, timezone
from typing import Any

from sqlalchemy import select

from backend.appdb.db import app_session
from backend.appdb.tickets_models import (
    TicketFinancialOp,
    TicketNotificationRule,
    TicketRequest,
)

logger = logging.getLogger(__name__)


# ---------------------------------------------------------------------------
# Constants
# ---------------------------------------------------------------------------

# Terminal statuses — requests in these statuses are not flagged
TERMINAL_STATUSES = {"purchased", "closed", "archive", "cancelled"}

# Statuses excluded from "departure soon" check
DEPARTURE_SOON_EXCLUDED_STATUSES = {"purchased", "closed", "archive", "cancelled"}

# Default thresholds (used when no rule found in DB)
DEFAULT_DEPARTURE_SOON_DAYS = 3
DEFAULT_MISSING_DATA_STALE_DAYS = 3
DEFAULT_STUCK_REQUEST_DAYS = 5

# Rule type identifiers (match seed data in migration)
RULE_DEPARTURE_SOON = "departure_soon"
RULE_MISSING_DATA_STALE = "missing_data_stale"
RULE_STUCK_REQUEST = "stuck_request"
RULE_NEW_LOSS = "new_loss"


# ---------------------------------------------------------------------------
# Data structures
# ---------------------------------------------------------------------------


@dataclass
class Notification:
    """A single notification item."""

    id: str
    rule_type: str
    title: str
    message: str
    request_id: int | None = None
    financial_op_id: int | None = None
    severity: str = "warning"  # info, warning, critical
    created_at: datetime = field(default_factory=lambda: datetime.now(timezone.utc))

    def to_dict(self) -> dict[str, Any]:
        return {
            "id": self.id,
            "rule_type": self.rule_type,
            "title": self.title,
            "message": self.message,
            "request_id": self.request_id,
            "financial_op_id": self.financial_op_id,
            "severity": self.severity,
            "created_at": self.created_at.isoformat(),
        }


# ---------------------------------------------------------------------------
# Helper
# ---------------------------------------------------------------------------


def _utcnow() -> datetime:
    return datetime.now(timezone.utc)


def _ensure_aware(dt: datetime) -> datetime:
    """Ensure a datetime is timezone-aware (UTC). Handles naive datetimes from SQLite."""
    if dt.tzinfo is None:
        return dt.replace(tzinfo=timezone.utc)
    return dt


# ---------------------------------------------------------------------------
# Service
# ---------------------------------------------------------------------------


class TicketsNotificationService:
    """SLA notification service for the Tickets/Logistics module (singleton)."""

    def __init__(self, database_url: str | None = None) -> None:
        self._database_url = database_url
        # In-memory dismissed notifications: {user_id: set(notification_id)}
        self._dismissed: dict[int, set[str]] = {}

    # ------------------------------------------------------------------
    # Public API
    # ------------------------------------------------------------------

    def check_departure_soon(self, days_threshold: int | None = None) -> list[Notification]:
        """Find requests where departure_date is within N days and status is not terminal.

        Args:
            days_threshold: Override threshold. If None, loads from DB rules or uses default.

        Returns:
            List of Notification objects for requests with upcoming departures.
        """
        threshold = days_threshold if days_threshold is not None else self._get_threshold(
            RULE_DEPARTURE_SOON, DEFAULT_DEPARTURE_SOON_DAYS
        )

        if not self._is_rule_enabled(RULE_DEPARTURE_SOON):
            return []

        now = _utcnow()
        deadline = now + timedelta(days=threshold)

        notifications: list[Notification] = []

        with app_session(self._database_url) as session:
            query = (
                select(TicketRequest)
                .where(TicketRequest.departure_date.isnot(None))
                .where(TicketRequest.departure_date <= deadline)
                .where(TicketRequest.departure_date >= now)
                .where(TicketRequest.status.notin_(DEPARTURE_SOON_EXCLUDED_STATUSES))
            )
            requests = session.scalars(query).all()

            for req in requests:
                days_left = (_ensure_aware(req.departure_date) - now).days
                notifications.append(Notification(
                    id=f"departure_soon_{req.id}",
                    rule_type=RULE_DEPARTURE_SOON,
                    title="Вылет скоро",
                    message=f"Заявка #{req.id}: вылет через {days_left} дн., статус: {req.status}",
                    request_id=req.id,
                    severity="critical" if days_left <= 1 else "warning",
                    created_at=now,
                ))

        return notifications

    def check_missing_data_stale(self, days_threshold: int | None = None) -> list[Notification]:
        """Find requests in 'missing_data' status for more than N days.

        Args:
            days_threshold: Override threshold. If None, loads from DB rules or uses default.

        Returns:
            List of Notification objects for stale missing_data requests.
        """
        threshold = days_threshold if days_threshold is not None else self._get_threshold(
            RULE_MISSING_DATA_STALE, DEFAULT_MISSING_DATA_STALE_DAYS
        )

        if not self._is_rule_enabled(RULE_MISSING_DATA_STALE):
            return []

        now = _utcnow()
        cutoff = now - timedelta(days=threshold)

        notifications: list[Notification] = []

        with app_session(self._database_url) as session:
            query = (
                select(TicketRequest)
                .where(TicketRequest.status == "missing_data")
                .where(TicketRequest.updated_at <= cutoff)
            )
            requests = session.scalars(query).all()

            for req in requests:
                days_stale = (now - _ensure_aware(req.updated_at)).days
                notifications.append(Notification(
                    id=f"missing_data_stale_{req.id}",
                    rule_type=RULE_MISSING_DATA_STALE,
                    title="Не хватает данных",
                    message=f"Заявка #{req.id}: в статусе 'Не хватает данных' уже {days_stale} дн.",
                    request_id=req.id,
                    severity="warning",
                    created_at=now,
                ))

        return notifications

    def check_stuck_requests(self, days_threshold: int | None = None) -> list[Notification]:
        """Find requests that haven't changed status in more than N days.

        Excludes requests in terminal statuses (closed, archive, cancelled).

        Args:
            days_threshold: Override threshold. If None, loads from DB rules or uses default.

        Returns:
            List of Notification objects for stuck requests.
        """
        threshold = days_threshold if days_threshold is not None else self._get_threshold(
            RULE_STUCK_REQUEST, DEFAULT_STUCK_REQUEST_DAYS
        )

        if not self._is_rule_enabled(RULE_STUCK_REQUEST):
            return []

        now = _utcnow()
        cutoff = now - timedelta(days=threshold)

        notifications: list[Notification] = []

        with app_session(self._database_url) as session:
            query = (
                select(TicketRequest)
                .where(TicketRequest.status.notin_(TERMINAL_STATUSES))
                .where(TicketRequest.updated_at <= cutoff)
            )
            requests = session.scalars(query).all()

            for req in requests:
                days_stuck = (now - _ensure_aware(req.updated_at)).days
                notifications.append(Notification(
                    id=f"stuck_request_{req.id}",
                    rule_type=RULE_STUCK_REQUEST,
                    title="Заявка зависла",
                    message=f"Заявка #{req.id}: не менялся статус {days_stuck} дн.",
                    request_id=req.id,
                    severity="warning" if days_stuck < 10 else "critical",
                    created_at=now,
                ))

        return notifications

    def check_new_losses(self) -> list[Notification]:
        """Find financial operations of type 'loss' created in the last 24 hours.

        Returns:
            List of Notification objects for new losses.
        """
        if not self._is_rule_enabled(RULE_NEW_LOSS):
            return []

        now = _utcnow()
        since = now - timedelta(hours=24)

        notifications: list[Notification] = []

        with app_session(self._database_url) as session:
            query = (
                select(TicketFinancialOp)
                .where(TicketFinancialOp.op_type == "loss")
                .where(TicketFinancialOp.is_deleted.is_(False))
                .where(TicketFinancialOp.created_at >= since)
            )
            ops = session.scalars(query).all()

            for op in ops:
                notifications.append(Notification(
                    id=f"new_loss_{op.id}",
                    rule_type=RULE_NEW_LOSS,
                    title="Новая потеря",
                    message=f"Потеря #{op.id}: сумма {op.amount} руб.",
                    request_id=op.request_id,
                    financial_op_id=op.id,
                    severity="warning",
                    created_at=now,
                ))

        return notifications

    def get_all_pending(self, user: dict[str, Any] | None = None) -> list[Notification]:
        """Aggregate all pending notifications from all check methods.

        Filters out dismissed notifications for the given user.

        Args:
            user: User dict with at least 'id' key. If None, returns all.

        Returns:
            Combined list of all active notifications.
        """
        all_notifications: list[Notification] = []

        all_notifications.extend(self.check_departure_soon())
        all_notifications.extend(self.check_missing_data_stale())
        all_notifications.extend(self.check_stuck_requests())
        all_notifications.extend(self.check_new_losses())

        # Filter out dismissed notifications for this user
        if user is not None:
            user_id = user.get("id")
            if user_id is not None:
                dismissed = self._dismissed.get(user_id, set())
                all_notifications = [
                    n for n in all_notifications if n.id not in dismissed
                ]

        return all_notifications

    def dismiss_notification(self, notification_id: str, user: dict[str, Any]) -> None:
        """Mark a notification as dismissed for the given user.

        Uses in-memory storage (session-based). Dismissed notifications
        won't appear in get_all_pending() for this user.

        Args:
            notification_id: The notification ID to dismiss.
            user: User dict with at least 'id' key.
        """
        user_id = user.get("id")
        if user_id is None:
            return

        if user_id not in self._dismissed:
            self._dismissed[user_id] = set()

        self._dismissed[user_id].add(notification_id)

    def get_rules(self) -> list[dict[str, Any]]:
        """Get all notification rules from the database.

        Returns:
            List of rule dicts with id, rule_type, is_enabled, threshold_days, notify_roles.
        """
        with app_session(self._database_url) as session:
            query = select(TicketNotificationRule).order_by(TicketNotificationRule.id)
            rules = session.scalars(query).all()
            return [self._rule_to_dict(r) for r in rules]

    def update_rule(self, rule_id: int, data: dict[str, Any]) -> dict[str, Any]:
        """Update a notification rule.

        Args:
            rule_id: ID of the rule to update.
            data: Dict with optional keys: is_enabled, threshold_days, notify_roles.

        Returns:
            Updated rule dict.

        Raises:
            ValueError: If rule not found.
        """
        now = _utcnow()
        with app_session(self._database_url) as session:
            rule = session.scalars(
                select(TicketNotificationRule).where(TicketNotificationRule.id == rule_id)
            ).first()

            if rule is None:
                raise ValueError(f"Notification rule with id={rule_id} not found")

            if "is_enabled" in data:
                rule.is_enabled = bool(data["is_enabled"])
            if "threshold_days" in data and data["threshold_days"] is not None:
                rule.threshold_days = int(data["threshold_days"])
            if "notify_roles" in data:
                rule.notify_roles = str(data["notify_roles"])

            rule.updated_at = now
            session.flush()
            result = self._rule_to_dict(rule)

        return result

    # ------------------------------------------------------------------
    # Private helpers
    # ------------------------------------------------------------------

    def _get_threshold(self, rule_type: str, default: int) -> int:
        """Load threshold_days from DB for a given rule_type, or return default."""
        try:
            with app_session(self._database_url) as session:
                rule = session.scalars(
                    select(TicketNotificationRule).where(
                        TicketNotificationRule.rule_type == rule_type
                    )
                ).first()
                if rule is not None and rule.threshold_days is not None:
                    return rule.threshold_days
        except Exception:
            logger.warning("Failed to load threshold for rule %s, using default %d", rule_type, default)
        return default

    def _is_rule_enabled(self, rule_type: str) -> bool:
        """Check if a notification rule is enabled. Defaults to True if not found."""
        try:
            with app_session(self._database_url) as session:
                rule = session.scalars(
                    select(TicketNotificationRule).where(
                        TicketNotificationRule.rule_type == rule_type
                    )
                ).first()
                if rule is not None:
                    return rule.is_enabled
        except Exception:
            logger.warning("Failed to check rule enabled status for %s, defaulting to True", rule_type)
        return True

    @staticmethod
    def _rule_to_dict(rule: TicketNotificationRule) -> dict[str, Any]:
        """Convert a TicketNotificationRule to a dict."""
        return {
            "id": rule.id,
            "rule_type": rule.rule_type,
            "is_enabled": rule.is_enabled,
            "threshold_days": rule.threshold_days,
            "notify_roles": rule.notify_roles,
            "created_at": rule.created_at.isoformat() if rule.created_at else None,
            "updated_at": rule.updated_at.isoformat() if rule.updated_at else None,
        }


# ---------------------------------------------------------------------------
# Module-level singleton
# ---------------------------------------------------------------------------

tickets_notification_service = TicketsNotificationService()
