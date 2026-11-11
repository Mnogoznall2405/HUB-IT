"""Source-backed semantic memory, revision guard and replay ledger.

Revision ID: 20261008_0127
Revises: 20261005_0126
"""
from alembic import op
import sqlalchemy as sa

revision = "20261008_0127"
down_revision = "20261005_0126"
branch_labels = None
depends_on = None


def _scope():
    return str(op.get_context().config.attributes.get("itinvent_scope", "all") or "all").lower()


def _schema():
    return "app" if op.get_bind().dialect.name == "postgresql" else None


def upgrade():
    if _scope() == "chat":
        return
    schema = _schema()
    inspector = sa.inspect(op.get_bind())
    if not inspector.has_table("ai_memory_state", schema=schema):
        op.create_table("ai_memory_state",
            sa.Column("user_id", sa.Integer(), primary_key=True),
            sa.Column("revision", sa.BigInteger(), nullable=False, server_default="0"),
            sa.Column("write_barrier_at", sa.DateTime(timezone=True), nullable=True), schema=schema)
    if not inspector.has_table("ai_memory_facts", schema=schema):
        op.create_table("ai_memory_facts",
            sa.Column("memory_id", sa.String(64), primary_key=True),
            sa.Column("user_id", sa.Integer(), nullable=False),
            sa.Column("fact_key", sa.String(96), nullable=False),
            sa.Column("version", sa.Integer(), nullable=False, server_default="1"),
            sa.UniqueConstraint("user_id", "fact_key", name="uq_app_ai_memory_facts_user_key"), schema=schema)
        op.create_index("ix_app_ai_memory_facts_user_id", "ai_memory_facts", ["user_id"], schema=schema)
    if not inspector.has_table("ai_memory_events", schema=schema):
        op.create_table("ai_memory_events",
            sa.Column("id", sa.String(64), primary_key=True),
            sa.Column("user_id", sa.Integer(), nullable=False),
            sa.Column("conversation_id", sa.String(36), nullable=False),
            sa.Column("message_id", sa.String(64), nullable=False),
            sa.Column("conversation_seq", sa.BigInteger(), nullable=False, server_default="0"),
            sa.Column("status", sa.String(24), nullable=False),
            sa.Column("changes_json", sa.Text(), nullable=False, server_default="[]"),
            sa.Column("created_at", sa.DateTime(timezone=True), nullable=False),
            sa.UniqueConstraint("user_id", "message_id", name="uq_app_ai_memory_events_user_message"), schema=schema)
        op.create_index("ix_app_ai_memory_events_user_conversation_seq", "ai_memory_events",
                        ["user_id", "conversation_id", "conversation_seq"], schema=schema)


def downgrade():
    if _scope() == "chat":
        return
    schema = _schema()
    for name in ("ai_memory_events", "ai_memory_facts", "ai_memory_state"):
        if sa.inspect(op.get_bind()).has_table(name, schema=schema):
            op.drop_table(name, schema=schema)
