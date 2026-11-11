"""Weekly work planning and atomic daily crew reports."""
from alembic import op
import sqlalchemy as sa

revision = '20260908_0109'
down_revision = '20260908_0108'
branch_labels = None
depends_on = None


def upgrade():
    if op.get_context().config.attributes.get('itinvent_scope') == 'chat': return
    schema = 'app' if op.get_bind().dialect.name == 'postgresql' else None
    for table, period in [('construction_week_plans', 'week_start'), ('construction_day_crews', 'work_date')]:
        columns = [sa.Column('object_id', sa.String(64), primary_key=True), sa.Column(period, sa.Date(), primary_key=True),
                   sa.Column('version', sa.Integer(), nullable=False), sa.Column('payload_json', sa.Text(), nullable=False)]
        if table == 'construction_week_plans': columns.append(sa.Column('baseline_json', sa.Text(), nullable=False))
        op.create_table(table, *columns, schema=schema)
    op.create_table('construction_planning_audit',
        sa.Column('id', sa.Integer(), primary_key=True, autoincrement=True),
        sa.Column('object_id', sa.String(64), nullable=False), sa.Column('period', sa.Date(), nullable=False),
        sa.Column('kind', sa.String(16), nullable=False), sa.Column('actor_user_id', sa.Integer(), nullable=False),
        sa.Column('actor_name', sa.String(255), nullable=False), sa.Column('changed_at', sa.DateTime(timezone=True), nullable=False),
        sa.Column('before_json', sa.Text(), nullable=False), sa.Column('after_json', sa.Text(), nullable=False), schema=schema)
    op.create_index('ix_construction_planning_audit_scope', 'construction_planning_audit', ['object_id','period','id'], schema=schema)


def downgrade():
    if op.get_context().config.attributes.get('itinvent_scope') == 'chat': return
    schema = 'app' if op.get_bind().dialect.name == 'postgresql' else None
    for table in ['construction_planning_audit', 'construction_day_crews', 'construction_week_plans']: op.drop_table(table, schema=schema)
