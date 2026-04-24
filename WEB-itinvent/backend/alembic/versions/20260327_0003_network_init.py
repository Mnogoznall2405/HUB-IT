"""Create network tables in app schema."""
from __future__ import annotations

from alembic import op
import sqlalchemy as sa


revision = "20260327_0003"
down_revision = "20260327_0002"
branch_labels = None
depends_on = None


def _scope() -> str:
    return str(op.get_context().config.attributes.get("itinvent_scope", "all") or "all").strip().lower()


def _schema() -> str | None:
    bind = op.get_bind()
    if bind.dialect.name == "postgresql":
        return "app"
    return None


def _remote(schema: str | None, table_name: str, column_name: str = "id") -> str:
    if schema:
        return f"{schema}.{table_name}.{column_name}"
    return f"{table_name}.{column_name}"


def upgrade() -> None:
    if _scope() == "chat":
        return
    schema = _schema()

    op.create_table(
        "network_branches",
        sa.Column("id", sa.Integer(), autoincrement=True, nullable=False),
        sa.Column("city_code", sa.Text(), nullable=False),
        sa.Column("branch_code", sa.Text(), nullable=False),
        sa.Column("name", sa.Text(), nullable=False),
        sa.Column("is_active", sa.Integer(), nullable=False, server_default="1"),
        sa.Column("created_at", sa.Text(), nullable=False),
        sa.Column("updated_at", sa.Text(), nullable=False),
        sa.Column("default_site_code", sa.Text(), nullable=True),
        sa.PrimaryKeyConstraint("id"),
        sa.UniqueConstraint("city_code", "branch_code", name="uq_network_branches_city_branch"),
        schema=schema,
    )
    op.create_index("idx_network_branches_city", "network_branches", ["city_code"], unique=False, schema=schema)

    op.create_table(
        "network_sites",
        sa.Column("id", sa.Integer(), autoincrement=True, nullable=False),
        sa.Column("branch_id", sa.Integer(), nullable=False),
        sa.Column("site_code", sa.Text(), nullable=False),
        sa.Column("name", sa.Text(), nullable=False),
        sa.Column("sort_order", sa.Integer(), nullable=False, server_default="0"),
        sa.Column("created_at", sa.Text(), nullable=False),
        sa.Column("updated_at", sa.Text(), nullable=False),
        sa.ForeignKeyConstraint(["branch_id"], [_remote(schema, "network_branches")], ondelete="CASCADE"),
        sa.PrimaryKeyConstraint("id"),
        sa.UniqueConstraint("branch_id", "site_code", name="uq_network_sites_branch_site_code"),
        schema=schema,
    )

    op.create_table(
        "network_devices",
        sa.Column("id", sa.Integer(), autoincrement=True, nullable=False),
        sa.Column("branch_id", sa.Integer(), nullable=False),
        sa.Column("site_id", sa.Integer(), nullable=True),
        sa.Column("device_code", sa.Text(), nullable=False),
        sa.Column("device_type", sa.Text(), nullable=False, server_default="switch"),
        sa.Column("vendor", sa.Text(), nullable=True),
        sa.Column("model", sa.Text(), nullable=True),
        sa.Column("sheet_name", sa.Text(), nullable=True),
        sa.Column("mgmt_ip", sa.Text(), nullable=True),
        sa.Column("notes", sa.Text(), nullable=True),
        sa.Column("created_at", sa.Text(), nullable=False),
        sa.Column("updated_at", sa.Text(), nullable=False),
        sa.ForeignKeyConstraint(["branch_id"], [_remote(schema, "network_branches")], ondelete="CASCADE"),
        sa.ForeignKeyConstraint(["site_id"], [_remote(schema, "network_sites")], ondelete="SET NULL"),
        sa.PrimaryKeyConstraint("id"),
        sa.UniqueConstraint("branch_id", "device_code", name="uq_network_devices_branch_device_code"),
        schema=schema,
    )
    op.create_index("idx_network_devices_branch", "network_devices", ["branch_id"], unique=False, schema=schema)

    op.create_table(
        "network_ports",
        sa.Column("id", sa.Integer(), autoincrement=True, nullable=False),
        sa.Column("device_id", sa.Integer(), nullable=False),
        sa.Column("port_name", sa.Text(), nullable=False),
        sa.Column("patch_panel_port", sa.Text(), nullable=True),
        sa.Column("location_code", sa.Text(), nullable=True),
        sa.Column("vlan_raw", sa.Text(), nullable=True),
        sa.Column("vlan_normalized_json", sa.Text(), nullable=True),
        sa.Column("endpoint_name_raw", sa.Text(), nullable=True),
        sa.Column("endpoint_ip_raw", sa.Text(), nullable=True),
        sa.Column("endpoint_mac_raw", sa.Text(), nullable=True),
        sa.Column("endpoint_count", sa.Integer(), nullable=False, server_default="0"),
        sa.Column("is_occupied", sa.Integer(), nullable=False, server_default="0"),
        sa.Column("row_source_hash", sa.Text(), nullable=True),
        sa.Column("created_at", sa.Text(), nullable=False),
        sa.Column("updated_at", sa.Text(), nullable=False),
        sa.ForeignKeyConstraint(["device_id"], [_remote(schema, "network_devices")], ondelete="CASCADE"),
        sa.PrimaryKeyConstraint("id"),
        sa.UniqueConstraint("device_id", "port_name", name="uq_network_ports_device_port_name"),
        schema=schema,
    )
    op.create_index("idx_network_ports_device", "network_ports", ["device_id"], unique=False, schema=schema)

    op.create_table(
        "network_socket_profiles",
        sa.Column("id", sa.Integer(), autoincrement=True, nullable=False),
        sa.Column("branch_id", sa.Integer(), nullable=False),
        sa.Column("panel_count", sa.Integer(), nullable=False),
        sa.Column("ports_per_panel", sa.Integer(), nullable=False),
        sa.Column("is_uniform", sa.Integer(), nullable=False, server_default="1"),
        sa.Column("created_at", sa.Text(), nullable=False),
        sa.Column("updated_at", sa.Text(), nullable=False),
        sa.ForeignKeyConstraint(["branch_id"], [_remote(schema, "network_branches")], ondelete="CASCADE"),
        sa.PrimaryKeyConstraint("id"),
        sa.UniqueConstraint("branch_id", name="uq_network_socket_profiles_branch_id"),
        schema=schema,
    )

    op.create_table(
        "network_panels",
        sa.Column("id", sa.Integer(), autoincrement=True, nullable=False),
        sa.Column("branch_id", sa.Integer(), nullable=False),
        sa.Column("panel_index", sa.Integer(), nullable=False),
        sa.Column("port_count", sa.Integer(), nullable=False),
        sa.Column("sort_order", sa.Integer(), nullable=False, server_default="0"),
        sa.Column("created_at", sa.Text(), nullable=False),
        sa.Column("updated_at", sa.Text(), nullable=False),
        sa.ForeignKeyConstraint(["branch_id"], [_remote(schema, "network_branches")], ondelete="CASCADE"),
        sa.PrimaryKeyConstraint("id"),
        sa.UniqueConstraint("branch_id", "panel_index", name="uq_network_panels_branch_panel_index"),
        schema=schema,
    )
    op.create_index("idx_network_panels_branch", "network_panels", ["branch_id"], unique=False, schema=schema)

    op.create_table(
        "network_sockets",
        sa.Column("id", sa.Integer(), autoincrement=True, nullable=False),
        sa.Column("branch_id", sa.Integer(), nullable=False),
        sa.Column("site_id", sa.Integer(), nullable=True),
        sa.Column("socket_code", sa.Text(), nullable=False),
        sa.Column("panel_no", sa.Integer(), nullable=True),
        sa.Column("port_no", sa.Integer(), nullable=True),
        sa.Column("port_id", sa.Integer(), nullable=True),
        sa.Column("device_id", sa.Integer(), nullable=True),
        sa.Column("mac_address", sa.Text(), nullable=True),
        sa.Column("fio", sa.Text(), nullable=True),
        sa.Column("fio_source_db", sa.Text(), nullable=True),
        sa.Column("fio_resolved_at", sa.Text(), nullable=True),
        sa.Column("created_at", sa.Text(), nullable=False),
        sa.Column("updated_at", sa.Text(), nullable=False),
        sa.ForeignKeyConstraint(["branch_id"], [_remote(schema, "network_branches")], ondelete="CASCADE"),
        sa.ForeignKeyConstraint(["site_id"], [_remote(schema, "network_sites")], ondelete="SET NULL"),
        sa.ForeignKeyConstraint(["port_id"], [_remote(schema, "network_ports")], ondelete="SET NULL"),
        sa.ForeignKeyConstraint(["device_id"], [_remote(schema, "network_devices")], ondelete="SET NULL"),
        sa.PrimaryKeyConstraint("id"),
        sa.UniqueConstraint("branch_id", "socket_code", name="uq_network_sockets_branch_socket_code"),
        schema=schema,
    )
    op.create_index("idx_network_sockets_branch_code", "network_sockets", ["branch_id", "socket_code"], unique=False, schema=schema)
    op.create_index("idx_network_sockets_port", "network_sockets", ["port_id"], unique=False, schema=schema)

    op.create_table(
        "network_branch_db_map",
        sa.Column("id", sa.Integer(), autoincrement=True, nullable=False),
        sa.Column("branch_id", sa.Integer(), nullable=False),
        sa.Column("db_id", sa.Text(), nullable=False),
        sa.Column("updated_at", sa.Text(), nullable=False),
        sa.Column("updated_by", sa.Text(), nullable=True),
        sa.ForeignKeyConstraint(["branch_id"], [_remote(schema, "network_branches")], ondelete="CASCADE"),
        sa.PrimaryKeyConstraint("id"),
        sa.UniqueConstraint("branch_id", name="uq_network_branch_db_map_branch_id"),
        schema=schema,
    )

    op.create_table(
        "network_maps",
        sa.Column("id", sa.Integer(), autoincrement=True, nullable=False),
        sa.Column("branch_id", sa.Integer(), nullable=False),
        sa.Column("site_id", sa.Integer(), nullable=True),
        sa.Column("title", sa.Text(), nullable=True),
        sa.Column("floor_label", sa.Text(), nullable=True),
        sa.Column("file_name", sa.Text(), nullable=False),
        sa.Column("mime_type", sa.Text(), nullable=False),
        sa.Column("file_blob", sa.LargeBinary(), nullable=False),
        sa.Column("file_size", sa.Integer(), nullable=False, server_default="0"),
        sa.Column("checksum_sha256", sa.Text(), nullable=False),
        sa.Column("source_path", sa.Text(), nullable=True),
        sa.Column("created_at", sa.Text(), nullable=False),
        sa.Column("updated_at", sa.Text(), nullable=False),
        sa.ForeignKeyConstraint(["branch_id"], [_remote(schema, "network_branches")], ondelete="CASCADE"),
        sa.ForeignKeyConstraint(["site_id"], [_remote(schema, "network_sites")], ondelete="SET NULL"),
        sa.PrimaryKeyConstraint("id"),
        sa.UniqueConstraint("branch_id", "file_name", name="uq_network_maps_branch_file_name"),
        schema=schema,
    )
    op.create_index("idx_network_maps_branch", "network_maps", ["branch_id"], unique=False, schema=schema)

    op.create_table(
        "network_map_points",
        sa.Column("id", sa.Integer(), autoincrement=True, nullable=False),
        sa.Column("branch_id", sa.Integer(), nullable=False),
        sa.Column("map_id", sa.Integer(), nullable=False),
        sa.Column("site_id", sa.Integer(), nullable=True),
        sa.Column("device_id", sa.Integer(), nullable=True),
        sa.Column("port_id", sa.Integer(), nullable=True),
        sa.Column("socket_id", sa.Integer(), nullable=True),
        sa.Column("x_ratio", sa.Float(), nullable=False),
        sa.Column("y_ratio", sa.Float(), nullable=False),
        sa.Column("label", sa.Text(), nullable=True),
        sa.Column("note", sa.Text(), nullable=True),
        sa.Column("color", sa.Text(), nullable=True),
        sa.Column("created_at", sa.Text(), nullable=False),
        sa.Column("updated_at", sa.Text(), nullable=False),
        sa.ForeignKeyConstraint(["branch_id"], [_remote(schema, "network_branches")], ondelete="CASCADE"),
        sa.ForeignKeyConstraint(["map_id"], [_remote(schema, "network_maps")], ondelete="CASCADE"),
        sa.ForeignKeyConstraint(["site_id"], [_remote(schema, "network_sites")], ondelete="SET NULL"),
        sa.ForeignKeyConstraint(["device_id"], [_remote(schema, "network_devices")], ondelete="SET NULL"),
        sa.ForeignKeyConstraint(["port_id"], [_remote(schema, "network_ports")], ondelete="SET NULL"),
        sa.ForeignKeyConstraint(["socket_id"], [_remote(schema, "network_sockets")], ondelete="SET NULL"),
        sa.PrimaryKeyConstraint("id"),
        schema=schema,
    )
    op.create_index("idx_network_map_points_map", "network_map_points", ["map_id"], unique=False, schema=schema)
    op.create_index("idx_network_map_points_device", "network_map_points", ["device_id"], unique=False, schema=schema)
    op.create_index("idx_network_map_points_branch", "network_map_points", ["branch_id"], unique=False, schema=schema)
    op.create_index("idx_network_map_points_socket", "network_map_points", ["socket_id"], unique=False, schema=schema)

    op.create_table(
        "network_import_jobs",
        sa.Column("id", sa.Integer(), autoincrement=True, nullable=False),
        sa.Column("city_code", sa.Text(), nullable=False),
        sa.Column("branch_id", sa.Integer(), nullable=True),
        sa.Column("status", sa.Text(), nullable=False),
        sa.Column("started_at", sa.Text(), nullable=False),
        sa.Column("finished_at", sa.Text(), nullable=True),
        sa.Column("summary_json", sa.Text(), nullable=True),
        sa.Column("error_text", sa.Text(), nullable=True),
        sa.ForeignKeyConstraint(["branch_id"], [_remote(schema, "network_branches")], ondelete="SET NULL"),
        sa.PrimaryKeyConstraint("id"),
        schema=schema,
    )

    op.create_table(
        "network_audit_log",
        sa.Column("id", sa.Integer(), autoincrement=True, nullable=False),
        sa.Column("branch_id", sa.Integer(), nullable=True),
        sa.Column("entity_type", sa.Text(), nullable=False),
        sa.Column("entity_id", sa.Text(), nullable=True),
        sa.Column("action", sa.Text(), nullable=False),
        sa.Column("diff_json", sa.Text(), nullable=True),
        sa.Column("actor_user_id", sa.Integer(), nullable=True),
        sa.Column("actor_role", sa.Text(), nullable=True),
        sa.Column("created_at", sa.Text(), nullable=False),
        sa.ForeignKeyConstraint(["branch_id"], [_remote(schema, "network_branches")], ondelete="SET NULL"),
        sa.PrimaryKeyConstraint("id"),
        schema=schema,
    )
    op.create_index("idx_network_audit_branch", "network_audit_log", ["branch_id"], unique=False, schema=schema)


def downgrade() -> None:
    if _scope() == "chat":
        return
    schema = _schema()
    op.drop_index("idx_network_audit_branch", table_name="network_audit_log", schema=schema)
    op.drop_table("network_audit_log", schema=schema)
    op.drop_table("network_import_jobs", schema=schema)
    op.drop_index("idx_network_map_points_socket", table_name="network_map_points", schema=schema)
    op.drop_index("idx_network_map_points_branch", table_name="network_map_points", schema=schema)
    op.drop_index("idx_network_map_points_device", table_name="network_map_points", schema=schema)
    op.drop_index("idx_network_map_points_map", table_name="network_map_points", schema=schema)
    op.drop_table("network_map_points", schema=schema)
    op.drop_index("idx_network_maps_branch", table_name="network_maps", schema=schema)
    op.drop_table("network_maps", schema=schema)
    op.drop_table("network_branch_db_map", schema=schema)
    op.drop_index("idx_network_sockets_port", table_name="network_sockets", schema=schema)
    op.drop_index("idx_network_sockets_branch_code", table_name="network_sockets", schema=schema)
    op.drop_table("network_sockets", schema=schema)
    op.drop_index("idx_network_panels_branch", table_name="network_panels", schema=schema)
    op.drop_table("network_panels", schema=schema)
    op.drop_table("network_socket_profiles", schema=schema)
    op.drop_index("idx_network_ports_device", table_name="network_ports", schema=schema)
    op.drop_table("network_ports", schema=schema)
    op.drop_index("idx_network_devices_branch", table_name="network_devices", schema=schema)
    op.drop_table("network_devices", schema=schema)
    op.drop_table("network_sites", schema=schema)
    op.drop_index("idx_network_branches_city", table_name="network_branches", schema=schema)
    op.drop_table("network_branches", schema=schema)
