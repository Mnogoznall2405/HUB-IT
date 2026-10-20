"""Company glossary (abbreviations, objects, contractors) with human confirmation.

Revision ID: 20261004_0007
Revises: 20261002_0006
Create Date: 2026-10-04
"""
from alembic import op
import sqlalchemy as sa

revision = "20261004_0007"
down_revision = "20261002_0006"
branch_labels = None
depends_on = None

_TABLE = "glossary_terms"


def upgrade() -> None:
    insp = sa.inspect(op.get_bind())
    if insp.has_table(_TABLE, schema="voice"):
        return  # таблицу уже создал bootstrap create_all — миграция идемпотентна
    op.create_table(
        _TABLE,
        sa.Column("id", sa.String(36), primary_key=True),
        sa.Column("term", sa.String(120), nullable=False),
        sa.Column("term_key", sa.String(120), nullable=False),
        sa.Column("kind", sa.String(16), nullable=False, server_default="other"),
        sa.Column("expansion", sa.Text(), nullable=True),
        sa.Column("aliases", sa.JSON(), nullable=True),
        sa.Column("status", sa.String(16), nullable=False, server_default="candidate"),
        sa.Column("core", sa.Boolean(), nullable=False, server_default=sa.false()),
        sa.Column("occurrences", sa.Integer(), nullable=False, server_default="1"),
        sa.Column("first_base", sa.String(512), nullable=True),
        sa.Column("last_base", sa.String(512), nullable=True),
        sa.Column("evidence", sa.Text(), nullable=True),
        sa.Column("created_by", sa.String(256), nullable=True),
        sa.Column("updated_by", sa.String(256), nullable=True),
        sa.Column("created_at", sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False),
        sa.Column("updated_at", sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False),
        schema="voice",
    )
    op.create_index("uq_glossary_terms_term_key", _TABLE, ["term_key"], unique=True, schema="voice")
    op.create_index("ix_glossary_terms_status", _TABLE, ["status"], schema="voice")


def downgrade() -> None:
    op.drop_index("ix_glossary_terms_status", table_name=_TABLE, schema="voice")
    op.drop_index("uq_glossary_terms_term_key", table_name=_TABLE, schema="voice")
    op.drop_table(_TABLE, schema="voice")
