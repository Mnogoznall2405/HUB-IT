"""Server-owned scope rules for cross-database 1C reconciliation.

``scope=all`` is intentionally not synonymous with every configured HUB
database.  It is an administrator-only reporting mode and must be constrained
by a deployment-owned allowlist, so adding a database configuration cannot
silently expose it to a 1C reconcile aggregate.
"""
from __future__ import annotations

import os
import re
from collections.abc import Iterable, Mapping
from typing import Any


RECONCILE_ALLOWED_DB_IDS_ENV = "WAREHOUSE_1C_RECONCILE_ALLOWED_DB_IDS"


class Warehouse1CAllScopeConfigurationError(ValueError):
    """The explicit cross-DB reconcile allowlist is absent or invalid."""


def configured_reconcile_allowed_db_ids(value: str | None = None) -> tuple[str, ...]:
    """Read a stable, case-insensitive list of allowed HUB database IDs.

    An empty value is deliberately *not* interpreted as all databases.  The
    caller must fail closed instead of broadening visibility during rollout.
    """

    raw = os.getenv(RECONCILE_ALLOWED_DB_IDS_ENV, "") if value is None else value
    seen: set[str] = set()
    values: list[str] = []
    for part in re.split(r"[,;\s]+", str(raw or "")):
        item = part.strip()
        key = item.casefold()
        if item and key not in seen:
            seen.add(key)
            values.append(item)
    return tuple(values)


def allowlisted_reconcile_db_configs(
    db_configs: Iterable[Mapping[str, Any]] | None,
    *,
    allowlist_value: str | None = None,
) -> list[dict[str, Any]]:
    """Return only configured databases explicitly allowed for ``scope=all``.

    A typo or stale ID in the allowlist is a configuration error, rather than
    a partial aggregate with an unnoticed missing HUB database.
    """

    allowed = configured_reconcile_allowed_db_ids(allowlist_value)
    if not allowed:
        raise Warehouse1CAllScopeConfigurationError(
            f"{RECONCILE_ALLOWED_DB_IDS_ENV} must explicitly list HUB databases for scope=all"
        )

    configured_by_id: dict[str, dict[str, Any]] = {}
    for raw_config in db_configs or ():
        config = dict(raw_config or {})
        db_id = str(config.get("id") or "").strip()
        if db_id:
            configured_by_id.setdefault(db_id.casefold(), config)

    missing = [db_id for db_id in allowed if db_id.casefold() not in configured_by_id]
    if missing:
        raise Warehouse1CAllScopeConfigurationError(
            "Unknown HUB database IDs in "
            f"{RECONCILE_ALLOWED_DB_IDS_ENV}: {', '.join(missing)}"
        )

    return [configured_by_id[db_id.casefold()] for db_id in allowed]


def select_hub_db_configs_for_scope(
    db_configs: Iterable[Mapping[str, Any]] | None,
    *,
    current_db_id: str | None,
    scope: str,
) -> list[dict[str, Any]]:
    """Select the HUB databases for a validated current/all scope.

    Current scope preserves the caller's one server-selected database.  All
    scope always delegates to the explicit reconciliation allowlist.
    """

    normalized_scope = str(scope or "current").strip().casefold() or "current"
    configs = [dict(config or {}) for config in db_configs or ()]
    selected_id = str(current_db_id or "").strip()
    if normalized_scope == "all":
        return allowlisted_reconcile_db_configs(configs)
    if normalized_scope != "current":
        raise ValueError("scope must be current or all")
    if selected_id:
        selected = [
            config
            for config in configs
            if str(config.get("id") or "").strip().casefold() == selected_id.casefold()
        ]
        return selected or [{"id": selected_id, "name": selected_id}]
    return configs or [{"id": None, "name": "default"}]


__all__ = [
    "RECONCILE_ALLOWED_DB_IDS_ENV",
    "Warehouse1CAllScopeConfigurationError",
    "allowlisted_reconcile_db_configs",
    "configured_reconcile_allowed_db_ids",
    "select_hub_db_configs_for_scope",
]
