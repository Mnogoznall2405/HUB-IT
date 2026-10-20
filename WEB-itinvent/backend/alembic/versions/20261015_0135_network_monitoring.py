"""Network monitoring profiles, series, incidents and worker heartbeat.

Revision ID: 20261015_0135
Revises: 20261014_0134
"""
from alembic import op
import sqlalchemy as sa

revision = "20261015_0135"
down_revision = "20261014_0134"
branch_labels = None
depends_on = None


def _schema():
    return "app" if op.get_bind().dialect.name == "postgresql" else None


def upgrade():
    if op.get_context().config.attributes.get("itinvent_scope") == "chat":
        return
    schema = _schema()
    prefix = "app." if schema else ""
    existing = set(sa.inspect(op.get_bind()).get_table_names(schema=schema))

    def create(name, *columns):
        if name in existing:
            return False
        op.create_table(name, *columns, schema=schema)
        return True

    def key():
        return sa.Column("id", sa.String(36), primary_key=True)

    def target():
        return sa.Column("target_id", sa.String(36), sa.ForeignKey(prefix + "monitoring_targets.id"), nullable=False)

    create("monitoring_profiles", key(), sa.Column("name", sa.String(120), nullable=False),
           sa.Column("community_enc", sa.Text(), nullable=False), sa.Column("updated_at", sa.DateTime(timezone=True), nullable=False))
    create("monitoring_targets", key(), sa.Column("network_device_id", sa.Integer(), nullable=False, unique=True),
           sa.Column("name", sa.String(160), nullable=False), sa.Column("address", sa.String(45), nullable=False),
           sa.Column("port", sa.Integer(), nullable=False),
           sa.Column("profile_id", sa.String(36), sa.ForeignKey(prefix + "monitoring_profiles.id"), nullable=False),
           sa.Column("enabled", sa.Boolean(), nullable=False), sa.Column("settings", sa.JSON(), nullable=False),
           sa.Column("current", sa.JSON(), nullable=False), sa.Column("updated_at", sa.DateTime(timezone=True), nullable=False))
    if create("monitoring_interfaces", key(), target(), sa.Column("name", sa.String(255), nullable=False),
              sa.Column("snmp_index", sa.Integer(), nullable=False), sa.Column("settings", sa.JSON(), nullable=False),
              sa.Column("current", sa.JSON(), nullable=False), sa.UniqueConstraint("target_id", "name", name="uq_monitoring_interface_name")):
        op.create_index("ix_app_monitoring_interfaces_target_id", "monitoring_interfaces", ["target_id"], schema=schema)
    if create("monitoring_samples", key(), target(), sa.Column("interface_id", sa.String(36), nullable=False),
              sa.Column("observed_at", sa.DateTime(timezone=True), nullable=False), sa.Column("values", sa.JSON(), nullable=False),
              sa.UniqueConstraint("target_id", "interface_id", "observed_at", name="uq_monitoring_sample")):
        op.create_index("ix_monitoring_samples_series", "monitoring_samples", ["target_id", "interface_id", "observed_at"], schema=schema)
        op.create_index("ix_monitoring_samples_retention", "monitoring_samples", ["observed_at"], schema=schema)
    if create("monitoring_aggregates", key(), target(), sa.Column("interface_id", sa.String(36), nullable=False),
              sa.Column("resolution", sa.Integer(), nullable=False), sa.Column("bucket_at", sa.DateTime(timezone=True), nullable=False),
              sa.Column("values", sa.JSON(), nullable=False),
              sa.UniqueConstraint("target_id", "interface_id", "resolution", "bucket_at", name="uq_monitoring_aggregate")):
        op.create_index("ix_monitoring_aggregates_series", "monitoring_aggregates", ["target_id", "interface_id", "resolution", "bucket_at"], schema=schema)
        op.create_index("ix_monitoring_aggregates_retention", "monitoring_aggregates", ["resolution", "bucket_at"], schema=schema)
    if create("monitoring_events", key(), target(), sa.Column("interface_id", sa.String(36), nullable=False),
              sa.Column("kind", sa.String(60), nullable=False), sa.Column("title", sa.String(255), nullable=False),
              sa.Column("severity", sa.String(20), nullable=False), sa.Column("opened_at", sa.DateTime(timezone=True), nullable=False),
              sa.Column("closed_at", sa.DateTime(timezone=True), nullable=True)):
        op.create_index("ix_monitoring_events_target_time", "monitoring_events", ["target_id", "opened_at"], schema=schema)
    create("monitoring_worker_state", sa.Column("id", sa.Integer(), primary_key=True),
           sa.Column("heartbeat_at", sa.DateTime(timezone=True), nullable=True), sa.Column("cycle_seconds", sa.Float(), nullable=True))


def downgrade():
    if op.get_context().config.attributes.get("itinvent_scope") == "chat":
        return
    schema = _schema()
    existing = set(sa.inspect(op.get_bind()).get_table_names(schema=schema))
    for name in ("monitoring_worker_state", "monitoring_events", "monitoring_aggregates", "monitoring_samples",
                 "monitoring_interfaces", "monitoring_targets", "monitoring_profiles"):
        if name in existing:
            op.drop_table(name, schema=schema)
