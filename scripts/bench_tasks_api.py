"""Quick benchmark for hub tasks list/dashboard (read-only)."""
from __future__ import annotations

import sys
import time
from pathlib import Path

PROJECT_ROOT = Path(__file__).resolve().parents[1]
WEB_ROOT = PROJECT_ROOT / "WEB-itinvent"
if str(WEB_ROOT) not in sys.path:
    sys.path.insert(0, str(WEB_ROOT))

from backend.appdb.db import is_app_database_configured
from backend.services.hub_service import HubService


def main() -> None:
    print("app_db_configured", is_app_database_configured())
    svc = HubService()
    if not svc._use_app_db:
        print("skip: HubService not on app database")
        return

    for uid in (1, 5):
        started = time.perf_counter()
        payload = svc.list_tasks(user_id=uid, scope="my", role_scope="both", limit=150)
        elapsed_ms = (time.perf_counter() - started) * 1000
        print(
            f"list_tasks uid={uid}: {elapsed_ms:.1f}ms "
            f"total={payload.get('total')} items={len(payload.get('items') or [])}"
        )

    started = time.perf_counter()
    dashboard = svc.get_dashboard(user_id=5, tasks_limit=40)
    elapsed_ms = (time.perf_counter() - started) * 1000
    task_items = ((dashboard.get("tasks") or {}).get("items") or [])
    print(f"get_dashboard uid=5: {elapsed_ms:.1f}ms tasks={len(task_items)}")

    for uid in (1, 5):
        started = time.perf_counter()
        counts = svc.get_unread_counts(user_id=uid)
        elapsed_ms = (time.perf_counter() - started) * 1000
        print(
            f"get_unread_counts uid={uid}: {elapsed_ms:.1f}ms "
            f"tasks_open={counts.get('tasks_open')} "
            f"unread_comments={counts.get('tasks_with_unread_comments')}"
        )


if __name__ == "__main__":
    main()
