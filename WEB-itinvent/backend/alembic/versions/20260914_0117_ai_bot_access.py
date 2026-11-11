"""Explicit per-agent access; existing permissions are deliberately not imported."""
from alembic import op
import sqlalchemy as sa

revision = '20260914_0117'
down_revision = '20260914_0116'
branch_labels = None
depends_on = None


def upgrade():
    if op.get_context().config.attributes.get('itinvent_scope') == 'chat':
        return
    schema = 'app' if op.get_bind().dialect.name == 'postgresql' else None
    op.create_table('ai_bot_access',
        sa.Column('bot_id', sa.String(64), primary_key=True),
        sa.Column('user_id', sa.Integer(), primary_key=True),
        sa.Column('allowed', sa.Boolean(), nullable=False, server_default=sa.false()),
        sa.Column('updated_by', sa.Integer(), nullable=False),
        sa.Column('updated_at', sa.DateTime(timezone=True), nullable=False), schema=schema)
    op.create_index('ix_app_ai_bot_access_user_id' if schema else 'ix_ai_bot_access_user_id',
                    'ai_bot_access', ['user_id'], schema=schema)


def downgrade():
    if op.get_context().config.attributes.get('itinvent_scope') == 'chat':
        return
    schema = 'app' if op.get_bind().dialect.name == 'postgresql' else None
    op.drop_table('ai_bot_access', schema=schema)
