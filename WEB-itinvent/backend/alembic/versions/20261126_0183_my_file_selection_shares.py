"""Persist bounded public file selections and bind their download grants."""
from alembic import op
import sqlalchemy as sa


revision = "20261126_0183"
down_revision = "20261125_0182"
branch_labels = None
depends_on = None


def _schema():
    return None if op.get_bind().dialect.name == "sqlite" else "app"


def upgrade():
    schema = _schema()
    op.create_table(
        "my_file_selection_shares",
        sa.Column("token_hash", sa.String(64), primary_key=True),
        sa.Column("token_enc", sa.Text(), nullable=False),
        sa.Column("created_by_user_id", sa.Integer(), nullable=False),
        sa.Column("members_json", sa.Text(), nullable=False),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False),
        sa.Column("expires_at", sa.DateTime(timezone=True), nullable=False),
        schema=schema,
    )
    op.create_index(
        "ix_app_my_file_selection_shares_owner", "my_file_selection_shares",
        ["created_by_user_id", "expires_at"], schema=schema,
    )
    op.add_column("my_file_download_grants", sa.Column("selection_token_hash", sa.String(64)), schema=schema)


def downgrade():
    schema = _schema()
    # Selection grants must not become ordinary file grants on rollback.
    grants = sa.Table("my_file_download_grants", sa.MetaData(), sa.Column("selection_token_hash"), schema=schema)
    op.execute(grants.delete().where(grants.c.selection_token_hash.is_not(None)))
    with op.batch_alter_table("my_file_download_grants", schema=schema) as batch:
        batch.drop_column("selection_token_hash")
    op.drop_table("my_file_selection_shares", schema=schema)
