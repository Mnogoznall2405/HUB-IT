"""Network monitoring runtime; schemas are installed by Alembic, never requests."""
from __future__ import annotations

from datetime import datetime

from sqlalchemy import Boolean, DateTime, Float, ForeignKey, Index, Integer, JSON, String, Text, UniqueConstraint
from sqlalchemy.orm import Mapped, mapped_column

from backend.appdb.models import APP_SCHEMA, AppBase, utcnow


class MonitoringProfile(AppBase):
    __tablename__ = "monitoring_profiles"
    __table_args__ = {"schema": APP_SCHEMA}
    id: Mapped[str] = mapped_column(String(36), primary_key=True)
    name: Mapped[str] = mapped_column(String(120))
    community_enc: Mapped[str] = mapped_column(Text)
    updated_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=utcnow)


class MonitoringTarget(AppBase):
    __tablename__ = "monitoring_targets"
    __table_args__ = {"schema": APP_SCHEMA}
    id: Mapped[str] = mapped_column(String(36), primary_key=True)
    # Legacy network registry uses its own SQL store; validated through it. NULL - not linked (migration 0143).
    network_device_id: Mapped[int | None] = mapped_column(Integer, unique=True, nullable=True)
    # IT object (it_objects.source_ref) the device belongs to; NULL - not assigned (migration 0153).
    object_ref: Mapped[str | None] = mapped_column(String(128), nullable=True, index=True)
    name: Mapped[str] = mapped_column(String(160))
    address: Mapped[str] = mapped_column(String(45))
    port: Mapped[int] = mapped_column(Integer, default=161)
    profile_id: Mapped[str] = mapped_column(ForeignKey(f"{APP_SCHEMA}.monitoring_profiles.id"))
    enabled: Mapped[bool] = mapped_column(Boolean, default=True)
    settings: Mapped[dict] = mapped_column(JSON, default=dict)
    current: Mapped[dict] = mapped_column(JSON, default=dict)
    updated_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=utcnow)


class MonitoringInterface(AppBase):
    __tablename__ = "monitoring_interfaces"
    __table_args__ = (UniqueConstraint("target_id", "name", name="uq_monitoring_interface_name"), {"schema": APP_SCHEMA})
    id: Mapped[str] = mapped_column(String(36), primary_key=True)
    target_id: Mapped[str] = mapped_column(ForeignKey(f"{APP_SCHEMA}.monitoring_targets.id"), index=True)
    name: Mapped[str] = mapped_column(String(255))
    snmp_index: Mapped[int] = mapped_column(Integer)
    settings: Mapped[dict] = mapped_column(JSON, default=dict)
    current: Mapped[dict] = mapped_column(JSON, default=dict)


class MonitoringSample(AppBase):
    __tablename__ = "monitoring_samples"
    __table_args__ = (
        UniqueConstraint("target_id", "interface_id", "observed_at", name="uq_monitoring_sample"),
        Index("ix_monitoring_samples_retention", "observed_at"),
        {"schema": APP_SCHEMA},
    )
    id: Mapped[str] = mapped_column(String(36), primary_key=True)
    target_id: Mapped[str] = mapped_column(ForeignKey(f"{APP_SCHEMA}.monitoring_targets.id"))
    # Empty string identifies the device-level series, not an interface.
    interface_id: Mapped[str] = mapped_column(String(36), default="")
    observed_at: Mapped[datetime] = mapped_column(DateTime(timezone=True))
    values: Mapped[dict] = mapped_column(JSON)


class MonitoringAggregate(AppBase):
    __tablename__ = "monitoring_aggregates"
    __table_args__ = (
        UniqueConstraint("target_id", "interface_id", "resolution", "bucket_at", name="uq_monitoring_aggregate"),
        Index("ix_monitoring_aggregates_retention", "resolution", "bucket_at"),
        {"schema": APP_SCHEMA},
    )
    id: Mapped[str] = mapped_column(String(36), primary_key=True)
    target_id: Mapped[str] = mapped_column(ForeignKey(f"{APP_SCHEMA}.monitoring_targets.id"))
    interface_id: Mapped[str] = mapped_column(String(36), default="")
    resolution: Mapped[int] = mapped_column(Integer)
    bucket_at: Mapped[datetime] = mapped_column(DateTime(timezone=True))
    values: Mapped[dict] = mapped_column(JSON)


class MonitoringEvent(AppBase):
    __tablename__ = "monitoring_events"
    __table_args__ = (Index("ix_monitoring_events_target_time", "target_id", "opened_at"), {"schema": APP_SCHEMA})
    id: Mapped[str] = mapped_column(String(36), primary_key=True)
    target_id: Mapped[str] = mapped_column(ForeignKey(f"{APP_SCHEMA}.monitoring_targets.id"))
    interface_id: Mapped[str] = mapped_column(String(36), default="")
    kind: Mapped[str] = mapped_column(String(60))
    title: Mapped[str] = mapped_column(String(255))
    severity: Mapped[str] = mapped_column(String(20))
    opened_at: Mapped[datetime] = mapped_column(DateTime(timezone=True))
    closed_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)


class MonitoringWorkerState(AppBase):
    __tablename__ = "monitoring_worker_state"
    __table_args__ = {"schema": APP_SCHEMA}
    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    heartbeat_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)
    cycle_seconds: Mapped[float | None] = mapped_column(Float, nullable=True)
