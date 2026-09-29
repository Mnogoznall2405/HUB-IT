"""Inventory search indexes: composite prefetch btree + pg_trgm GIN для LIKE-паттернов.

Фаза 2.6 аудита COMPUTERS_PERF_AUDIT_2026-09-18. Композитные btree создаются на
обоих диалектах (SQLite — для dev/test-parity), trgm GIN — только PostgreSQL.
CREATE EXTENSION pg_trgm требует прав суперпользователя/владельца БД — перед
применением проверить privileges и свободное место (GIN по текстовым колонкам
на ~10k+ хостов занимает ощутимое место).
"""
from alembic import op
import sqlalchemy as sa

revision = '20260918_0118'
down_revision = '20260914_0117'
branch_labels = None
depends_on = None

_COMPOSITE_INDEXES = [
    # list_mac_addresses_for_db_ids(db_ids, branch) — db_id IN + branch_name
    ("inventory_host_sql_contexts", ["db_id", "branch_name"], "sql_ctx_db_branch"),
    # get_sql_context / upsert_sql_context — db_id = + mac_address =
    ("inventory_host_sql_contexts", ["db_id", "mac_address"], "sql_ctx_db_mac"),
    # контекст-префетч по хостам — mac/hostname + db_id
    ("inventory_host_sql_contexts", ["mac_address", "db_id"], "sql_ctx_mac_db"),
    ("inventory_host_sql_contexts", ["hostname", "db_id"], "sql_ctx_host_db"),
    # outlook-префетч — mac_address IN + kind =
    ("inventory_outlook_files", ["mac_address", "kind"], "outlook_mac_kind"),
    # user_profiles-префетч — mac_address IN
    ("inventory_user_profiles", ["mac_address", "user_name"], "profiles_mac_user"),
    # data_version_probe — max(updated_at)
    ("inventory_hosts", ["updated_at"], "hosts_updated_at"),
    ("inventory_host_sql_contexts", ["updated_at"], "sql_ctx_updated_at"),
]

_TRGM_INDEXES = [
    # search_host_keys — LIKE '%..%' по identity/user колонкам
    ("inventory_hosts", ["hostname"], "hosts_hostname_trgm"),
    ("inventory_hosts", ["user_login"], "hosts_user_login_trgm"),
    ("inventory_hosts", ["user_full_name"], "hosts_user_full_name_trgm"),
    ("inventory_hosts", ["ip_primary"], "hosts_ip_primary_trgm"),
    # profiles / outlook LIKE
    ("inventory_user_profiles", ["user_name"], "profiles_user_name_trgm"),
    ("inventory_user_profiles", ["profile_path"], "profiles_profile_path_trgm"),
    ("inventory_outlook_files", ["file_path"], "outlook_file_path_trgm"),
    ("inventory_outlook_files", ["file_type"], "outlook_file_type_trgm"),
    # sql-контекст LIKE (branch/location/employee/db_id поля поиска)
    ("inventory_host_sql_contexts", ["branch_name"], "sql_ctx_branch_trgm"),
    ("inventory_host_sql_contexts", ["location_name"], "sql_ctx_location_trgm"),
    ("inventory_host_sql_contexts", ["employee_name"], "sql_ctx_employee_trgm"),
    ("inventory_host_sql_contexts", ["db_id"], "sql_ctx_db_id_trgm"),
]


def _index_name(suffix: str, schema: str | None) -> str:
    return f"ix_app_inventory_{suffix}" if schema else f"ix_inventory_{suffix}"


def upgrade():
    if op.get_context().config.attributes.get('itinvent_scope') == 'chat':
        return
    dialect = op.get_bind().dialect.name
    schema = 'app' if dialect == 'postgresql' else None
    for table, columns, suffix in _COMPOSITE_INDEXES:
        op.create_index(_index_name(suffix, schema), table, columns, schema=schema)
    if dialect != 'postgresql':
        return
    op.execute('CREATE EXTENSION IF NOT EXISTS pg_trgm')
    for table, columns, suffix in _TRGM_INDEXES:
        op.create_index(
            _index_name(suffix, schema),
            table,
            columns,
            schema=schema,
            postgresql_using='gin',
            postgresql_ops={column: 'gin_trgm_ops' for column in columns},
        )


def downgrade():
    if op.get_context().config.attributes.get('itinvent_scope') == 'chat':
        return
    dialect = op.get_bind().dialect.name
    schema = 'app' if dialect == 'postgresql' else None
    if dialect == 'postgresql':
        for _table, _columns, suffix in reversed(_TRGM_INDEXES):
            op.drop_index(_index_name(suffix, schema), table_name=_table, schema=schema)
    for table, _columns, suffix in reversed(_COMPOSITE_INDEXES):
        op.drop_index(_index_name(suffix, schema), table_name=table, schema=schema)
