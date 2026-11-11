"""Legacy my-files preview table marker

Revision ID: 20260607_0046
Revises: 20260604_0045
Create Date: 2026-06-07 18:00:00.000000

This revision existed on the production database before the migration file was
restored in the repository. Keep it as a marker so Alembic can continue from
databases already stamped with 20260607_0046.
"""
from __future__ import annotations


revision = "20260607_0046"
down_revision = "20260604_0045"
branch_labels = None
depends_on = None


def upgrade() -> None:
    return None


def downgrade() -> None:
    return None
