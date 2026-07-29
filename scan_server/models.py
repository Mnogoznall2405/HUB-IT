"""SQLAlchemy models for PostgreSQL schema ``scan`` (epoch BIGINT + jsonb)."""

from __future__ import annotations

from sqlalchemy import (
    BigInteger,
    Float,
    Index,
    Integer,
    MetaData,
    Text,
    text,
)
from sqlalchemy.orm import DeclarativeBase, Mapped, mapped_column

from .db import SCAN_SCHEMA

metadata = MetaData(schema=SCAN_SCHEMA)


class Base(DeclarativeBase):
    metadata = metadata


class ScanAgent(Base):
    __tablename__ = "scan_agents"

    agent_id: Mapped[str] = mapped_column(Text, primary_key=True)
    hostname: Mapped[str] = mapped_column(Text, nullable=False, server_default=text("''"))
    branch: Mapped[str] = mapped_column(Text, nullable=False, server_default=text("''"))
    ip_address: Mapped[str] = mapped_column(Text, nullable=False, server_default=text("''"))
    version: Mapped[str] = mapped_column(Text, nullable=False, server_default=text("''"))
    status: Mapped[str] = mapped_column(Text, nullable=False, server_default=text("'online'"))
    last_seen_at: Mapped[int] = mapped_column(BigInteger, nullable=False, server_default=text("0"))
    # JSON kept as TEXT for drop-in compatibility with existing _json_dumps/_json_loads paths.
    last_heartbeat_json: Mapped[str] = mapped_column(Text, nullable=False, server_default=text("'{}'"))
    updated_at: Mapped[int] = mapped_column(BigInteger, nullable=False, server_default=text("0"))
    outbox_depth: Mapped[int] = mapped_column(Integer, nullable=False, server_default=text("0"))
    dead_letter_depth: Mapped[int] = mapped_column(Integer, nullable=False, server_default=text("0"))
    last_ingest_ok_at: Mapped[int] = mapped_column(BigInteger, nullable=False, server_default=text("0"))

    __table_args__ = (Index("idx_scan_agents_last_seen", last_seen_at.desc()),)


class ScanTask(Base):
    __tablename__ = "scan_tasks"

    id: Mapped[str] = mapped_column(Text, primary_key=True)
    agent_id: Mapped[str] = mapped_column(Text, nullable=False)
    command: Mapped[str] = mapped_column(Text, nullable=False)
    payload_json: Mapped[str] = mapped_column(Text, nullable=False, server_default=text("'{}'"))
    status: Mapped[str] = mapped_column(Text, nullable=False)
    created_at: Mapped[int] = mapped_column(BigInteger, nullable=False)
    updated_at: Mapped[int] = mapped_column(BigInteger, nullable=False)
    due_at: Mapped[int] = mapped_column(BigInteger, nullable=False)
    ttl_at: Mapped[int] = mapped_column(BigInteger, nullable=False)
    delivered_at: Mapped[int | None] = mapped_column(BigInteger, nullable=True)
    acked_at: Mapped[int | None] = mapped_column(BigInteger, nullable=True)
    completed_at: Mapped[int | None] = mapped_column(BigInteger, nullable=True)
    attempt_count: Mapped[int] = mapped_column(Integer, nullable=False, server_default=text("0"))
    next_attempt_at: Mapped[int] = mapped_column(BigInteger, nullable=False)
    dedupe_key: Mapped[str | None] = mapped_column(Text, nullable=True)
    error_text: Mapped[str | None] = mapped_column(Text, nullable=True)
    result_json: Mapped[str | None] = mapped_column(Text, nullable=True)

    __table_args__ = (
        Index("idx_scan_tasks_agent_status_next", "agent_id", "status", "next_attempt_at", "due_at"),
        Index("idx_scan_tasks_ttl", "ttl_at"),
        Index("idx_scan_tasks_dedupe", "agent_id", "dedupe_key"),
        Index("idx_scan_tasks_agent_status_ttl_updated", "agent_id", "status", "ttl_at", "updated_at", "created_at"),
    )


class ScanTaskSystemMetric(Base):
    __tablename__ = "scan_task_system_metrics"

    scan_task_id: Mapped[str] = mapped_column(Text, primary_key=True)
    captured_at: Mapped[int] = mapped_column(BigInteger, primary_key=True)
    cpu_percent: Mapped[float] = mapped_column(Float, nullable=False, server_default=text("0"))
    memory_percent: Mapped[float] = mapped_column(Float, nullable=False, server_default=text("0"))
    memory_used_bytes: Mapped[int] = mapped_column(BigInteger, nullable=False, server_default=text("0"))
    memory_available_bytes: Mapped[int] = mapped_column(BigInteger, nullable=False, server_default=text("0"))
    disk_read_bytes: Mapped[int] = mapped_column(BigInteger, nullable=False, server_default=text("0"))
    disk_write_bytes: Mapped[int] = mapped_column(BigInteger, nullable=False, server_default=text("0"))
    disk_read_bps: Mapped[float] = mapped_column(Float, nullable=False, server_default=text("0"))
    disk_write_bps: Mapped[float] = mapped_column(Float, nullable=False, server_default=text("0"))
    network_sent_bytes: Mapped[int] = mapped_column(BigInteger, nullable=False, server_default=text("0"))
    network_received_bytes: Mapped[int] = mapped_column(BigInteger, nullable=False, server_default=text("0"))
    network_sent_bps: Mapped[float] = mapped_column(Float, nullable=False, server_default=text("0"))
    network_received_bps: Mapped[float] = mapped_column(Float, nullable=False, server_default=text("0"))
    process_rss_bytes: Mapped[int] = mapped_column(BigInteger, nullable=False, server_default=text("0"))

    __table_args__ = (Index("idx_scan_task_system_metrics_captured", "captured_at"),)


class ScanJob(Base):
    __tablename__ = "scan_jobs"

    id: Mapped[str] = mapped_column(Text, primary_key=True)
    agent_id: Mapped[str] = mapped_column(Text, nullable=False, server_default=text("''"))
    hostname: Mapped[str] = mapped_column(Text, nullable=False, server_default=text("''"))
    branch: Mapped[str] = mapped_column(Text, nullable=False, server_default=text("''"))
    user_login: Mapped[str] = mapped_column(Text, nullable=False, server_default=text("''"))
    user_full_name: Mapped[str] = mapped_column(Text, nullable=False, server_default=text("''"))
    file_path: Mapped[str] = mapped_column(Text, nullable=False, server_default=text("''"))
    file_name: Mapped[str] = mapped_column(Text, nullable=False, server_default=text("''"))
    file_hash: Mapped[str] = mapped_column(Text, nullable=False, server_default=text("''"))
    file_size: Mapped[int] = mapped_column(BigInteger, nullable=False, server_default=text("0"))
    source_kind: Mapped[str] = mapped_column(Text, nullable=False, server_default=text("'unknown'"))
    event_id: Mapped[str | None] = mapped_column(Text, nullable=True)
    scan_task_id: Mapped[str | None] = mapped_column(Text, nullable=True)
    status: Mapped[str] = mapped_column(Text, nullable=False)
    created_at: Mapped[int] = mapped_column(BigInteger, nullable=False)
    started_at: Mapped[int | None] = mapped_column(BigInteger, nullable=True)
    finished_at: Mapped[int | None] = mapped_column(BigInteger, nullable=True)
    error_text: Mapped[str | None] = mapped_column(Text, nullable=True)
    summary: Mapped[str | None] = mapped_column(Text, nullable=True)
    attempt_count: Mapped[int] = mapped_column(Integer, nullable=False, server_default=text("0"))
    payload_json: Mapped[str] = mapped_column(Text, nullable=False, server_default=text("'{}'"))
    metrics_json: Mapped[str] = mapped_column(Text, nullable=False, server_default=text("'{}'"))

    __table_args__ = (
        Index("idx_scan_jobs_status_created", "status", "created_at"),
        Index("idx_scan_jobs_agent_status_created", "agent_id", "status", "created_at"),
        Index("idx_scan_jobs_agent_created", "agent_id", "created_at"),
        Index("idx_scan_jobs_created_at", "created_at"),
        Index("idx_scan_jobs_finished_at", "finished_at"),
        Index("idx_scan_jobs_status_source_kind", "status", "source_kind"),
        Index("idx_scan_jobs_error_text", "error_text"),
        Index(
            "idx_scan_jobs_event_id",
            "event_id",
            unique=True,
            postgresql_where=text("event_id IS NOT NULL AND event_id <> ''"),
        ),
        Index(
            "idx_scan_jobs_scan_task_status",
            "scan_task_id",
            "status",
            "created_at",
            postgresql_where=text("scan_task_id IS NOT NULL AND scan_task_id <> ''"),
        ),
    )


class ScanFinding(Base):
    __tablename__ = "scan_findings"

    id: Mapped[str] = mapped_column(Text, primary_key=True)
    job_id: Mapped[str] = mapped_column(Text, nullable=False)
    severity: Mapped[str] = mapped_column(Text, nullable=False)
    category: Mapped[str] = mapped_column(Text, nullable=False)
    matched_patterns_json: Mapped[str] = mapped_column(Text, nullable=False, server_default=text("'[]'"))
    short_reason: Mapped[str] = mapped_column(Text, nullable=False, server_default=text("''"))
    created_at: Mapped[int] = mapped_column(BigInteger, nullable=False)

    __table_args__ = (Index("idx_scan_findings_job", "job_id"),)


class ScanIncident(Base):
    __tablename__ = "scan_incidents"

    id: Mapped[str] = mapped_column(Text, primary_key=True)
    finding_id: Mapped[str] = mapped_column(Text, nullable=False)
    job_id: Mapped[str] = mapped_column(Text, nullable=False)
    agent_id: Mapped[str] = mapped_column(Text, nullable=False, server_default=text("''"))
    hostname: Mapped[str] = mapped_column(Text, nullable=False, server_default=text("''"))
    branch: Mapped[str] = mapped_column(Text, nullable=False, server_default=text("''"))
    user_login: Mapped[str] = mapped_column(Text, nullable=False, server_default=text("''"))
    user_full_name: Mapped[str] = mapped_column(Text, nullable=False, server_default=text("''"))
    file_path: Mapped[str] = mapped_column(Text, nullable=False, server_default=text("''"))
    severity: Mapped[str] = mapped_column(Text, nullable=False)
    status: Mapped[str] = mapped_column(Text, nullable=False, server_default=text("'new'"))
    created_at: Mapped[int] = mapped_column(BigInteger, nullable=False)
    ack_at: Mapped[int | None] = mapped_column(BigInteger, nullable=True)
    ack_by: Mapped[str | None] = mapped_column(Text, nullable=True)
    resolved_at: Mapped[int | None] = mapped_column(BigInteger, nullable=True)
    resolved_reason: Mapped[str | None] = mapped_column(Text, nullable=True)
    resolved_by_task_id: Mapped[str | None] = mapped_column(Text, nullable=True)

    __table_args__ = (
        Index("idx_scan_incidents_status_created", "status", "created_at"),
        Index("idx_scan_incidents_branch", "branch", "created_at"),
        Index("idx_scan_incidents_created", created_at.desc()),
        Index("idx_scan_incidents_severity", "severity"),
        Index("idx_scan_incidents_hostname_status_created", "hostname", "status", created_at.desc()),
        Index("idx_scan_incidents_status_hostname_created", "status", "hostname", created_at.desc()),
        Index("idx_scan_incidents_job", "job_id"),
        # Functional index also ensured in db.ensure_scan_schema for existing DBs.
        Index(
            "idx_scan_incidents_hostname_lower_created",
            text("lower(hostname)"),
            created_at.desc(),
        ),
    )


class ScanTaskFileObservation(Base):
    __tablename__ = "scan_task_file_observations"

    id: Mapped[str] = mapped_column(Text, primary_key=True)
    scan_task_id: Mapped[str] = mapped_column(Text, nullable=False, server_default=text("''"))
    agent_id: Mapped[str] = mapped_column(Text, nullable=False, server_default=text("''"))
    hostname: Mapped[str] = mapped_column(Text, nullable=False, server_default=text("''"))
    file_path: Mapped[str] = mapped_column(Text, nullable=False, server_default=text("''"))
    file_hash: Mapped[str] = mapped_column(Text, nullable=False, server_default=text("''"))
    event_id: Mapped[str] = mapped_column(Text, nullable=False, server_default=text("''"))
    observation_type: Mapped[str] = mapped_column(Text, nullable=False, server_default=text("''"))
    linked_job_id: Mapped[str] = mapped_column(Text, nullable=False, server_default=text("''"))
    linked_incident_id: Mapped[str] = mapped_column(Text, nullable=False, server_default=text("''"))
    source_kind: Mapped[str] = mapped_column(Text, nullable=False, server_default=text("''"))
    severity: Mapped[str] = mapped_column(Text, nullable=False, server_default=text("''"))
    created_at: Mapped[int] = mapped_column(BigInteger, nullable=False)

    __table_args__ = (
        Index("idx_scan_observations_task_created", "scan_task_id", created_at.desc()),
        Index("idx_scan_observations_hostname_created", "hostname", created_at.desc()),
        Index("idx_scan_observations_task_hash", "scan_task_id", "file_hash"),
        Index(
            "idx_scan_observations_linked_job",
            "linked_job_id",
            postgresql_where=text("linked_job_id <> ''"),
        ),
        Index(
            "idx_scan_observations_linked_incident",
            "linked_incident_id",
            postgresql_where=text("linked_incident_id <> ''"),
        ),
    )


class ScanArtifact(Base):
    __tablename__ = "scan_artifacts"

    id: Mapped[int] = mapped_column(Integer, primary_key=True, autoincrement=True)
    job_id: Mapped[str] = mapped_column(Text, nullable=False)
    artifact_type: Mapped[str] = mapped_column(Text, nullable=False)
    storage_path: Mapped[str] = mapped_column(Text, nullable=False)
    size_bytes: Mapped[int] = mapped_column(BigInteger, nullable=False, server_default=text("0"))
    created_at: Mapped[int] = mapped_column(BigInteger, nullable=False)

    __table_args__ = (Index("idx_scan_artifacts_job", "job_id"),)

