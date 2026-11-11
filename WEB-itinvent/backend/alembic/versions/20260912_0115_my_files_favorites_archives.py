"""my files favorites and folder archive grants."""
from alembic import op
import sqlalchemy as sa

revision = '20260912_0115'
down_revision = '20260912_0114'
branch_labels = None
depends_on = None


def _schema() -> str | None:
    return 'app' if op.get_bind().dialect.name == 'postgresql' else None


def upgrade():
    if op.get_context().config.attributes.get('itinvent_scope') == 'chat': return
    schema = _schema()

    op.add_column('my_files', sa.Column('is_favorite', sa.Boolean(), nullable=False, server_default=sa.false()), schema=schema)
    op.add_column('my_file_folders', sa.Column('is_favorite', sa.Boolean(), nullable=False, server_default=sa.false()), schema=schema)
    op.alter_column('my_file_download_grants', 'file_id', existing_type=sa.String(64), nullable=True, schema=schema)
    op.add_column('my_file_download_grants', sa.Column('folder_id', sa.String(64), nullable=True), schema=schema)
    op.create_index(
        'ix_app_my_file_download_grants_folder_id',
        'my_file_download_grants',
        ['folder_id'],
        schema=schema,
    )


def downgrade():
    if op.get_context().config.attributes.get('itinvent_scope') == 'chat': return
    schema = _schema()
    op.drop_index('ix_app_my_file_download_grants_folder_id', table_name='my_file_download_grants', schema=schema)
    op.drop_column('my_file_download_grants', 'folder_id', schema=schema)
    op.execute(sa.delete(sa.table('my_file_download_grants', schema=schema)).where(sa.column('file_id').is_(None)))
    op.alter_column('my_file_download_grants', 'file_id', existing_type=sa.String(64), nullable=False, schema=schema)
    op.drop_column('my_file_folders', 'is_favorite', schema=schema)
    op.drop_column('my_files', 'is_favorite', schema=schema)
