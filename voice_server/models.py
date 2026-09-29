"""SQLAlchemy models for the voice job registry (schema ``voice``)."""

from __future__ import annotations

from sqlalchemy import (
    Boolean,
    BigInteger,
    Column,
    DateTime,
    Index,
    Integer,
    JSON,
    String,
    Text,
    func,
)
from sqlalchemy.orm import DeclarativeBase

from .db import VOICE_SCHEMA


class Base(DeclarativeBase):
    pass


class VoiceJob(Base):
    """One pipeline invocation: process / resume naming / enroll voice."""

    __tablename__ = "voice_jobs"

    id = Column(String(36), primary_key=True)
    kind = Column(String(16), nullable=False, default="process")  # process|resume|enroll
    status = Column(String(16), nullable=False, default="queued")  # queued|processing|done|failed|cancelled

    # Meeting/file identity
    base_filename = Column(String(512), nullable=True, index=True)
    original_filename = Column(String(1024), nullable=True)
    stored_path = Column(Text, nullable=True)
    file_size = Column(BigInteger, nullable=True)

    # Processing settings (mirrors run.py CLI flags) and result summary
    settings = Column(JSON, nullable=True)
    speaker_map = Column(JSON, nullable=True)
    enroll = Column(JSON, nullable=True)
    parent_job_id = Column(String(36), nullable=True)
    result = Column(JSON, nullable=True)

    stage = Column(String(64), nullable=True)
    progress = Column(Integer, nullable=False, default=0)
    error = Column(Text, nullable=True)
    log_tail = Column(Text, nullable=True)

    cancel_requested = Column(Boolean, nullable=False, default=False)

    # Warm-storage archive marker (Phase 5)
    archive_path = Column(Text, nullable=True)
    archive_at = Column(DateTime(timezone=True), nullable=True)

    created_by = Column(String(256), nullable=True)
    created_at = Column(DateTime(timezone=True), server_default=func.now(), nullable=False)
    started_at = Column(DateTime(timezone=True), nullable=True)
    finished_at = Column(DateTime(timezone=True), nullable=True)
    updated_at = Column(
        DateTime(timezone=True), server_default=func.now(), onupdate=func.now(), nullable=False
    )

    __table_args__ = (
        Index("ix_voice_jobs_status", "status"),
        Index("ix_voice_jobs_created_at", "created_at"),
        {"schema": VOICE_SCHEMA},
    )


class VoiceShareLink(Base):
    """Opaque share token for a meeting report; expiry enforced on resolve."""

    __tablename__ = "share_links"

    token = Column(String(64), primary_key=True)
    base_filename = Column(String(512), nullable=False)
    created_by = Column(String(256), nullable=True)
    created_at = Column(DateTime(timezone=True), server_default=func.now(), nullable=False)
    expires_at = Column(DateTime(timezone=True), nullable=False)

    __table_args__ = (
        Index("ix_share_links_expires_at", "expires_at"),
        {"schema": VOICE_SCHEMA},
    )


class VoiceAssignmentStatus(Base):
    """Per-assignment status: pending / in_progress / done + comment."""

    __tablename__ = "voice_assignment_statuses"

    id = Column(String(36), primary_key=True)
    base_filename = Column(String(512), nullable=False)
    num = Column(String(16), nullable=False)
    status = Column(String(16), nullable=False, default="pending")
    comment = Column(Text, nullable=True)
    marked_by = Column(String(256), nullable=True)
    created_at = Column(DateTime(timezone=True), server_default=func.now(), nullable=False)
    updated_at = Column(
        DateTime(timezone=True), server_default=func.now(), onupdate=func.now(), nullable=False
    )

    __table_args__ = (
        Index("ix_voice_assignment_statuses_base", "base_filename"),
        {"schema": VOICE_SCHEMA},
    )
