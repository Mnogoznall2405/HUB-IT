#!/usr/bin/env python3
from __future__ import annotations

import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT / "WEB-itinvent"))
from dotenv import load_dotenv

load_dotenv(ROOT / ".env", override=False)

from backend.services.hub_service import hub_service
from backend.services.user_service import user_service

PREFIXES = ("BenchAudit ", "BenchListPayload ", "BenchWorkflow ")


def main() -> int:
    creator = user_service.get_by_id(1253) or {"id": 1253}
    deleted = 0
    with hub_service._db_conn(write=False) as conn:
        rows = conn.execute(
            """
            SELECT id, title FROM hub_tasks
            WHERE title LIKE ? OR title LIKE ? OR title LIKE ?
            LIMIT 8000
            """,
            tuple(f"{p}%" for p in PREFIXES),
        ).fetchall()
    print(f"found {len(rows)}")
    for row in rows:
        try:
            if hub_service.delete_task(task_id=str(row["id"]), actor_user_id=int(creator["id"]), is_admin=True):
                deleted += 1
        except Exception as exc:  # noqa: BLE001
            print(f"fail {row['id']}: {exc}")
    print(f"deleted {deleted}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
