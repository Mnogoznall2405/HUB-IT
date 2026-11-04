"""Read access to agent inventory hosts shared by API routers and AI tools (AR-01).

The routers keep thin adapters over these functions so existing patch points and callers
stay valid, while domain code (AI tools) no longer imports a FastAPI router for them.
"""
from __future__ import annotations

import re
from typing import Any, Callable, Dict, Optional

from backend.appdb.db import ensure_app_schema_initialized, get_app_database_url, is_app_database_configured
from backend.appdb.inventory_store import AppInventoryStore
from local_store import get_local_store

INVENTORY_FILE = "agent_inventory_cache.json"
ONLINE_MAX_AGE_SECONDS = 12 * 60
STALE_MAX_AGE_SECONDS = 60 * 60


def normalize_text(value: Any) -> str:
    return str(value or "").replace("\x00", "").strip()


def normalize_mac(value: Any) -> str:
    return re.sub(r"[^0-9A-Fa-f]", "", normalize_text(value)).upper()


def inventory_database_url() -> Optional[str]:
    if not is_app_database_configured():
        return None
    database_url = get_app_database_url()
    if not database_url:
        return None
    return ensure_app_schema_initialized(database_url)


def get_inventory_app_store() -> Optional[AppInventoryStore]:
    database_url = inventory_database_url()
    if not database_url:
        return None
    return AppInventoryStore(database_url=database_url)


def get_inventory_host(
    mac_address: str,
    *,
    app_store_factory: Optional[Callable[[], Optional[AppInventoryStore]]] = None,
) -> Optional[Dict[str, Any]]:
    """One host by MAC; ``app_store_factory`` lets a caller supply its own store lookup."""
    app_store = (app_store_factory or get_inventory_app_store)()
    if app_store is not None:
        return app_store.get_host(mac_address)

    store = get_local_store()
    payload = store.load_json(INVENTORY_FILE, default_content={})
    if not isinstance(payload, dict):
        return None
    return payload.get(normalize_text(mac_address))
