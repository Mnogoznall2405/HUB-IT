"""Persist bounded public file selections and bind their download grants."""
from alembic import op
import sqlalchemy as sa


revision = "20261126_0183"
down_revision = "20261125_0182"
branch_labels = None
depends_on = None


def _schema() -> str | None:
    return None if op.get_bind().dialect.name == "sqlite" else "app"


def _scope() -> str:
    cfg = getattr(op.get_context(), "config", None)
    attrs = getattr(cfg, "attributes", None) or {}
    return str(attrs.get("itinvent_scope", "all") or "all").strip().lower()


def _has_table(schema: str | None, table_name: str) -> bool:
    return bool(sa.inspect(op.get_bind()).has_table(table_name, schema=schema))


def _has_column(schema: str | None, table_name: str, column_name: str) -> bool:
    if not _has_table(schema, table_name):
        return False
    return any(
        str(item.get("name") or "") == column_name
        for item in sa.inspect(op.get_bind()).get_columns(table_name, schema=schema)
    )


def _index_names(schema: str | None, table_name: str) -> set[str]:
    if not _has_table(schema, table_name):
        return set()
    return {
        str(item.get("name") or "")
        for item in sa.inspect(op.get_bind()).get_indexes(table_name, schema=schema)
    }


def upgrade():
    # My Files is an app-scope domain. In a chat-only database the interleaved
    # app revisions are intentionally no-ops, so app.my_file_download_grants
    # does not exist there and must not be altered.
    if _scope() == "chat":
        return
    schema = _schema()
    if not _has_table(schema, "my_file_selection_shares"):
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
    if "ix_app_my_file_selection_shares_owner" not in _index_names(schema, "my_file_selection_shares"):
        op.create_index(
            "ix_app_my_file_selection_shares_owner", "my_file_selection_shares",
            ["created_by_user_id", "expires_at"], schema=schema,
        )
    if not _has_column(schema, "my_file_download_grants", "selection_token_hash"):
        with op.batch_alter_table("my_file_download_grants", schema=schema) as batch:
            batch.add_column(sa.Column("selection_token_hash", sa.String(64)))


def downgrade():
    if _scope() == "chat":
        return
    schema = _schema()
    if _has_column(schema, "my_file_download_grants", "selection_token_hash"):
        # Selection grants must not become ordinary file grants on rollback.
        grants = sa.Table("my_file_download_grants", sa.MetaData(), sa.Column("selection_token_hash"), schema=schema)
        op.execute(grants.delete().where(grants.c.selection_token_hash.is_not(None)))
        with op.batch_alter_table("my_file_download_grants", schema=schema) as batch:
            batch.drop_column("selection_token_hash")
    if _has_table(schema, "my_file_selection_shares"):
        op.drop_table("my_file_selection_shares", schema=schema)
