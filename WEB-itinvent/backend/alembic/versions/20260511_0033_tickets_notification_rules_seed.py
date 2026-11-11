"""Seed default notification rules for the Tickets/Logistics module."""
from __future__ import annotations

from datetime import datetime, timezone

from alembic import op
import sqlalchemy as sa


revision = "20260511_0033"
down_revision = "20260511_0032"
branch_labels = None
depends_on = None

DEFAULT_RULES = [
    {
        "rule_type": "departure_soon",
        "is_enabled": True,
        "threshold_days": 3,
        "notify_roles": "admin,operator",
    },
    {
        "rule_type": "missing_data_stale",
        "is_enabled": True,
        "threshold_days": 3,
        "notify_roles": "admin,operator",
    },
    {
        "rule_type": "stuck_request",
        "is_enabled": True,
        "threshold_days": 5,
        "notify_roles": "admin,operator",
    },
    {
        "rule_type": "new_loss",
        "is_enabled": True,
        "threshold_days": None,
        "notify_roles": "admin,operator",
    },
]


def _scope() -> str:
    return str(op.get_context().config.attributes.get("itinvent_scope", "all") or "all").strip().lower()


def _schema(name: str) -> str | None:
    bind = op.get_bind()
    if bind.dialect.name == "postgresql":
        return name
    return None


def _qualified(schema: str | None, table_name: str) -> str:
    if schema:
        return f'"{schema}"."{table_name}"'
    return table_name


def upgrade() -> None:
    if _scope() == "chat":
        return

    bind = op.get_bind()
    app_schema = _schema("app")
    rules_table = _qualified(app_schema, "ticket_notification_rules")
    now_iso = datetime.now(timezone.utc).isoformat()

    for rule in DEFAULT_RULES:
        # Only insert if rule_type does not already exist
        existing = bind.execute(
            sa.text(f"SELECT id FROM {rules_table} WHERE rule_type = :rule_type LIMIT 1"),
            {"rule_type": rule["rule_type"]},
        ).scalar()

        if existing is None:
            bind.execute(
                sa.text(
                    f"""
                    INSERT INTO {rules_table}
                        (rule_type, is_enabled, threshold_days, notify_roles, created_at, updated_at)
                    VALUES
                        (:rule_type, :is_enabled, :threshold_days, :notify_roles, :created_at, :updated_at)
                    """
                ),
                {
                    "rule_type": rule["rule_type"],
                    "is_enabled": rule["is_enabled"],
                    "threshold_days": rule["threshold_days"],
                    "notify_roles": rule["notify_roles"],
                    "created_at": now_iso,
                    "updated_at": now_iso,
                },
            )


def downgrade() -> None:
    if _scope() == "chat":
        return

    bind = op.get_bind()
    app_schema = _schema("app")
    rules_table = _qualified(app_schema, "ticket_notification_rules")

    for rule in DEFAULT_RULES:
        bind.execute(
            sa.text(f"DELETE FROM {rules_table} WHERE rule_type = :rule_type"),
            {"rule_type": rule["rule_type"]},
        )
