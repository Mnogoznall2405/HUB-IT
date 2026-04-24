"""Helpers for schema-aware internal SQLAlchemy models."""
from __future__ import annotations


def uses_named_schemas(database_url: str | None) -> bool:
    """Return True when the target database supports named schemas."""
    normalized = str(database_url or "").strip().lower()
    return bool(normalized) and not normalized.startswith("sqlite")


def schema_name(name: str, database_url: str | None) -> str | None:
    """Resolve a schema name for the current database backend."""
    return name if uses_named_schemas(database_url) else None
