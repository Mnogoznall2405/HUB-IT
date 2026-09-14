"""my files folders (drive-style navigation)."""
from alembic import op
import sqlalchemy as sa

revision = '20260911_0113'
down_revision = '20260909_0112'
branch_labels = None
depends_on = None


def _schema() -> str | None:
    return 'app' if op.get_bind().dialect.name == 'postgresql' else None


def upgrade():
    if op.get_context().config.attributes.get('itinvent_scope') == 'chat': return
    schema = _schema()
    folder_ref = f'{schema}.my_file_folders.id' if schema else 'my_file_folders.id'

    op.create_table(
        'my_file_folders',
        sa.Column('id', sa.String(64), primary_key=True),
        sa.Column('owner_user_id', sa.Integer(), nullable=False),
        sa.Column('parent_id', sa.String(64), sa.ForeignKey(folder_ref, ondelete='SET NULL'), nullable=True),
        sa.Column('name', sa.String(255), nullable=False),
        sa.Column('created_at', sa.DateTime(timezone=True), nullable=False),
        sa.Column('updated_at', sa.DateTime(timezone=True), nullable=False),
        sa.Column('deleted_at', sa.DateTime(timezone=True), nullable=True),
        schema=schema,
    )
    op.create_index('ix_app_my_file_folders_owner_parent', 'my_file_folders', ['owner_user_id', 'parent_id'], schema=schema)
    op.create_index('ix_app_my_file_folders_owner_deleted', 'my_file_folders', ['owner_user_id', 'deleted_at'], schema=schema)

    op.add_column('my_files', sa.Column('folder_id', sa.String(64), sa.ForeignKey(folder_ref, ondelete='SET NULL'), nullable=True), schema=schema)
    op.create_index('ix_app_my_files_folder', 'my_files', ['folder_id'], schema=schema)


def downgrade():
    if op.get_context().config.attributes.get('itinvent_scope') == 'chat': return
    schema = _schema()
    op.drop_index('ix_app_my_files_folder', table_name='my_files', schema=schema)
    op.drop_column('my_files', 'folder_id', schema=schema)
    op.drop_index('ix_app_my_file_folders_owner_deleted', table_name='my_file_folders', schema=schema)
    op.drop_index('ix_app_my_file_folders_owner_parent', table_name='my_file_folders', schema=schema)
    op.drop_table('my_file_folders', schema=schema)
