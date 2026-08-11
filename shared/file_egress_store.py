"""Shared SQLite store for file_left + telegram probe payloads."""

from __future__ import annotations

# Re-export implementation for inventory_server and WEB backend.
import sys
from pathlib import Path

_SERVER = Path(__file__).resolve().parents[1] / "inventory_server"
if str(_SERVER.parent) not in sys.path:
    sys.path.insert(0, str(_SERVER.parent))

from inventory_server.egress_store import EgressEventStore  # noqa: E402

__all__ = ["EgressEventStore"]
