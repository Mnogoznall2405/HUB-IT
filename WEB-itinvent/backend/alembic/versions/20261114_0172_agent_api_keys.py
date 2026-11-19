"""Per-agent API keys for scan/inventory agents (HIGH-03 bound-key store).

Revision ID: 20261114_0172
Revises: 20261113_0171

The shared ``app.agent_api_keys`` table replaces flat ``SCAN_AGENT_API_KEYS`` /
``INVENTORY_AGENT_API_KEYS`` env maps so new agents can be enrolled without a
service restart. Keys are stored encrypted (``secret_crypto_service`` /
``MAIL_CREDENTIALS_KEY``) plus a SHA-256 lookup index — a DB dump alone does
not leak usable credentials.
"""
from __future__ import annotations

from alembic import op
import sqlalchemy as sa


revision = "20261114_0172"
down_revision = "20261113_0171"
branch_labels = None
depends_on = None

TABLE = "agent_api_keys"


def _scope() -> str:
    return str(op.get_context().config.attributes.get("itinvent_scope", "all") or "all").strip().lower()


def _schema() -> str | None:
    return "app" if op.get_bind().dialect.name == "postgresql" else None


def upgrade() -> None:
    if _scope() == "chat":
        return
    schema = _schema()
    bind = op.get_bind()
    if sa.inspect(bind).has_table(TABLE, schema=schema):
        return
    op.create_table(
        TABLE,
        sa.Column("agent_id", sa.String(255), nullable=False),
        sa.Column("hostname", sa.String(255), nullable=False, server_default=""),
        sa.Column("scan_key_sha256", sa.String(64), nullable=True),
        sa.Column("scan_key_enc", sa.Text(), nullable=True),
        sa.Column("inv_key_sha256", sa.String(64), nullable=True),
        sa.Column("inv_key_enc", sa.Text(), nullable=True),
        sa.Column("source", sa.String(32), nullable=False, server_default="auto"),
        sa.Column("created_at", sa.BigInteger(), nullable=False),
        sa.Column("updated_at", sa.BigInteger(), nullable=False),
        sa.PrimaryKeyConstraint("agent_id", name="pk_app_agent_api_keys"),
        schema=schema,
    )
    op.create_index(
        "ix_app_agent_api_keys_scan_sha",
        TABLE,
        ["scan_key_sha256"],
        schema=schema,
        unique=True,
    )
    op.create_index(
        "ix_app_agent_api_keys_inv_sha",
        TABLE,
        ["inv_key_sha256"],
        schema=schema,
        unique=True,
    )


def downgrade() -> None:
    if _scope() == "chat":
        return
    schema = _schema()
    bind = op.get_bind()
    if sa.inspect(bind).has_table(TABLE, schema=schema):
        op.drop_index("ix_app_agent_api_keys_inv_sha", table_name=TABLE, schema=schema)
        op.drop_index("ix_app_agent_api_keys_scan_sha", table_name=TABLE, schema=schema)
        op.drop_table(TABLE, schema=schema)
