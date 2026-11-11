"""Repair previously installed sandbox tables for durable result delivery."""
from alembic import op
import sqlalchemy as sa

revision = '20260914_0116'
down_revision = '20260912_0115'
branch_labels = None
depends_on = None

OLD_ACTIVE = "'preparing','queued','claimed','running','waiting_permission'"
NEW_ACTIVE = OLD_ACTIVE + ",'finalizing','cleanup_pending'"
TERMINAL = "'succeeded','failed','cancelled','expired'"


def _apply(forward):
    if op.get_context().config.attributes.get('itinvent_scope') == 'chat':
        return
    schema = 'app' if op.get_bind().dialect.name == 'postgresql' else None
    inspector = sa.inspect(op.get_bind())
    if not forward:
        prefix = 'app.' if schema else ''
        if op.get_bind().execute(sa.text(f"SELECT count(*) FROM {prefix}ai_sandbox_jobs WHERE status IN ('finalizing','cleanup_pending')")).scalar():
            raise RuntimeError('Drain sandbox finalization before downgrade')
    columns = {
        'ai_sandbox_jobs': [
            sa.Column('finalization_state', sa.String(24), nullable=False, server_default='not_required'),
            sa.Column('finalization_markdown', sa.Text(), nullable=False, server_default=''),
            sa.Column('assistant_message_id', sa.String(36)),
            sa.Column('cleanup_terminal_status', sa.String(24)),
        ],
        'ai_sandbox_files': [sa.Column('delivery_status', sa.String(24), nullable=False, server_default='not_applicable')],
    }
    checks = {
        'ai_sandbox_jobs': {
            'ck_app_ai_sandbox_jobs_status': f"status IN ({NEW_ACTIVE if forward else OLD_ACTIVE},{TERMINAL})",
            'ck_app_ai_sandbox_jobs_finalization_state': "finalization_state IN ('not_required','pending','published')",
            'ck_app_ai_sandbox_jobs_cleanup_terminal': "cleanup_terminal_status IS NULL OR cleanup_terminal_status IN ('failed','cancelled','expired')",
        },
        'ai_sandbox_files': {'ck_app_ai_sandbox_files_delivery_status': "delivery_status IN ('not_applicable','pending','attached','unavailable')"},
    }
    for table, additions in columns.items():
        existing = {c['name'] for c in inspector.get_columns(table, schema=schema)}
        existing_checks = {c['name'] for c in inspector.get_check_constraints(table, schema=schema)}
        indexes = {i['name'] for i in inspector.get_indexes(table, schema=schema)}
        with op.batch_alter_table(table, schema=schema) as batch:
            for name in checks[table]:
                if name in existing_checks:
                    batch.drop_constraint(name, type_='check')
            if table == 'ai_sandbox_jobs':
                for name in ('ix_app_ai_sandbox_jobs_finalization', 'ix_app_ai_sandbox_jobs_finalization_state', 'uq_app_ai_sandbox_jobs_one_active_per_user'):
                    if name in indexes:
                        batch.drop_index(name)
            for column in additions:
                if forward and column.name not in existing:
                    batch.add_column(column)
                elif not forward and column.name in existing:
                    batch.drop_column(column.name)
            for name, expression in checks[table].items():
                if forward or name == 'ck_app_ai_sandbox_jobs_status':
                    batch.create_check_constraint(name, expression)
            if table == 'ai_sandbox_jobs':
                active = sa.text(f"status IN ({NEW_ACTIVE if forward else OLD_ACTIVE})")
                batch.create_index('uq_app_ai_sandbox_jobs_one_active_per_user', ['user_id'], unique=True, postgresql_where=active, sqlite_where=active)
                if forward:
                    batch.create_index('ix_app_ai_sandbox_jobs_finalization', ['status','finalization_state','updated_at'])
                    batch.create_index('ix_app_ai_sandbox_jobs_finalization_state', ['finalization_state'])


def upgrade():
    _apply(True)


def downgrade():
    _apply(False)
