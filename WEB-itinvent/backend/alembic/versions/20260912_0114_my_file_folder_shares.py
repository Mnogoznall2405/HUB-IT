"""my file folder public share links."""
from alembic import op
import sqlalchemy as sa

revision = '20260912_0114'
down_revision = '20260911_0113'
branch_labels = None
depends_on = None


def _schema() -> str | None:
    return 'app' if op.get_bind().dialect.name == 'postgresql' else None


def upgrade():
    if op.get_context().config.attributes.get('itinvent_scope') == 'chat': return
    schema = _schema()

    op.add_column('my_file_folders', sa.Column('share_token', sa.String(128), nullable=True), schema=schema)
    op.add_column('my_file_folders', sa.Column('share_token_enc', sa.Text(), nullable=True), schema=schema)
    op.add_column('my_file_folders', sa.Column('share_token_hash', sa.String(64), nullable=True), schema=schema)
    op.add_column('my_file_folders', sa.Column('share_created_at', sa.DateTime(timezone=True), nullable=True), schema=schema)
    op.create_index(
        'ix_app_my_file_folders_share_token_hash',
        'my_file_folders',
        ['share_token_hash'],
        schema=schema,
    )


def downgrade():
    if op.get_context().config.attributes.get('itinvent_scope') == 'chat': return
    schema = _schema()
    op.drop_index('ix_app_my_file_folders_share_token_hash', table_name='my_file_folders', schema=schema)
    op.drop_column('my_file_folders', 'share_created_at', schema=schema)
    op.drop_column('my_file_folders', 'share_token_hash', schema=schema)
    op.drop_column('my_file_folders', 'share_token_enc', schema=schema)
    op.drop_column('my_file_folders', 'share_token', schema=schema)
