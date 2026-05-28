#!/usr/bin/env python3
"""Delete hub test announcements by id (admin, production PG)."""
from __future__ import annotations

import importlib
import os
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
WEB_ROOT = ROOT / "WEB-itinvent"
if str(WEB_ROOT) not in sys.path:
    sys.path.insert(0, str(WEB_ROOT))


def load_dotenv() -> None:
    env_path = ROOT / ".env"
    if not env_path.exists():
        return
    for raw_line in env_path.read_text(encoding="utf-8", errors="replace").splitlines():
        line = raw_line.strip()
        if not line or line.startswith("#") or "=" not in line:
            continue
        key, value = line.split("=", 1)
        key = key.strip()
        value = value.strip().strip('"').strip("'")
        if key and key not in os.environ:
            os.environ[key] = os.path.expandvars(value)


IDS_TO_DELETE = [
    "3e0fb1c5-66c4-4c9c-be50-4fd3f279bd14",
    "321ab4da-1bd2-4094-b087-45df801bdc3b",
    "b135e1fa-f287-470a-945b-1756be5c9346",
]


def main() -> int:
    load_dotenv()
    hub_service_module = importlib.import_module("backend.services.hub_service")
    service = hub_service_module.HubService()

    deleted = 0
    missing = 0
    for ann_id in IDS_TO_DELETE:
        ok = service.delete_announcement(
            announcement_id=ann_id,
            actor_user_id=1,
            is_admin=True,
        )
        if ok:
            deleted += 1
            print(f"deleted: {ann_id}")
        else:
            missing += 1
            print(f"not found: {ann_id}")

    print(f"done: deleted={deleted}, not_found={missing}")
    return 0 if missing == 0 else 1


if __name__ == "__main__":
    raise SystemExit(main())
