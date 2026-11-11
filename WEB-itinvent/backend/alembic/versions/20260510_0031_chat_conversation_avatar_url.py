"""add avatar_url to chat_conversations

Revision ID: 20260510_0031
Revises: 20260508_0030
Create Date: 2026-05-10 14:30:00.000000
"""
from __future__ import annotations

from alembic import op
import sqlalchemy as sa

revision = '20260510_0031'
down_revision = '20260508_0030'
branch_labels = None
depends_on = None


def upgrade() -> None:
    # Determine schema: check if table exists in 'chat' or 'public'
    bind = op.get_bind()
    result = bind.execute(sa.text("""
        SELECT table_schema 
        FROM information_schema.tables 
        WHERE table_name = 'chat_conversations' AND 
              table_schema IN ('chat', 'public')
    """))
    row = result.fetchone()
    schema = row[0] if row else 'public'
    
    op.add_column(
        'chat_conversations',
        sa.Column('avatar_url', sa.String(512), nullable=True),
        schema=schema,
    )


def downgrade() -> None:
    bind = op.get_bind()
    result = bind.execute(sa.text("""
        SELECT table_schema 
        FROM information_schema.tables 
        WHERE table_name = 'chat_conversations' AND 
              table_schema IN ('chat', 'public')
    """))
    row = result.fetchone()
    schema = row[0] if row else 'public'
    
    op.drop_column('chat_conversations', 'avatar_url', schema=schema)
