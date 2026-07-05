"""Pure SQL builders for task observer membership filters."""

from __future__ import annotations

from typing import Any


def build_observer_membership_clause(user_id: int, *, uses_postgresql: bool) -> tuple[str, list[Any]]:
    """Return SQL clause + params for whether user_id is listed in observer_user_ids JSON."""
    uid = int(user_id)
    if uses_postgresql:
        return (
            "EXISTS (SELECT 1 FROM json_array_elements_text(COALESCE(NULLIF(observer_user_ids, ''), '[]')::json) je WHERE CAST(je AS INTEGER) = ?)",
            [uid],
        )
    return (
        "EXISTS (SELECT 1 FROM json_each(COALESCE(observer_user_ids, '[]')) je WHERE CAST(je.value AS INTEGER) = ?)",
        [uid],
    )
