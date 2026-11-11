"""Catalog of configured ITINVENT databases, shared by routers, AI tools and Scan (AR-01)."""
from __future__ import annotations

import logging
import os
from typing import List

from backend.config import config
from backend.database.connection import get_database_config

logger = logging.getLogger(__name__)


_DB_CATALOG: List[dict] = [
    {
        "id": "ITINVENT",
        "name": "ITINVENT",
        "access": "read-only",
    },
    {
        "id": "MSK-ITINVENT",
        "name": "MSK-ITINVENT (Москва)",
        "access": "read-only",
    },
    {
        "id": "OBJ-ITINVENT",
        "name": "OBJ-ITINVENT (Объекты)",
        "access": "read-write",
    },
    {
        "id": "SPB-ITINVENT",
        "name": "SPB-ITINVENT (Санкт-Петербург)",
        "access": "read-only",
    },
]


def _is_db_configured(db_id: str) -> bool:
    cfg = get_database_config(db_id)
    return all(
        str(cfg.get(key) or "").strip()
        for key in ("host", "database", "username", "password")
    )


def get_all_db_configs() -> List[dict]:
    """Get configured databases from AVAILABLE_DATABASES and env DB_* settings."""
    available_raw = os.getenv("AVAILABLE_DATABASES", "")
    if available_raw.strip():
        allowed_ids = {
            part.strip()
            for part in available_raw.split(",")
            if part.strip()
        }
    else:
        allowed_ids = {item["id"] for item in _DB_CATALOG}

    databases: List[dict] = []
    for item in _DB_CATALOG:
        db_id = str(item.get("id") or "").strip()
        if not db_id or db_id not in allowed_ids:
            continue
        if not _is_db_configured(db_id):
            logger.debug("Skipping database %s: incomplete configuration", db_id)
            continue
        databases.append(dict(item))

    if databases:
        return databases

    default_id = str(config.database.database or "ITINVENT").strip() or "ITINVENT"
    fallback = next((item for item in _DB_CATALOG if item["id"] == default_id), _DB_CATALOG[0])
    if _is_db_configured(fallback["id"]):
        return [dict(fallback)]
    return []
