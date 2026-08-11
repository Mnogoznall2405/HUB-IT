"""Check PostgreSQL connection headroom for the active dual-chat PM2 layout."""
from __future__ import annotations

import argparse
import json
import subprocess
import sys
from pathlib import Path
from typing import Any


PROJECT_ROOT = Path(__file__).resolve().parents[1]
WEB_ROOT = PROJECT_ROOT / "WEB-itinvent"


def evaluate_connection_budget(
    *,
    max_connections: int,
    total_connections: int,
    managed_connections: int,
    configured_managed_capacity: int,
    reserve: int,
) -> dict[str, int | bool]:
    """Compare current runtime headroom with the configured worst-case envelope."""
    maximum = max(0, int(max_connections))
    total = max(0, int(total_connections))
    managed = min(total, max(0, int(managed_connections)))
    target_reserve = max(0, int(reserve))
    unmanaged = max(0, total - managed)
    available_now = max(0, maximum - total)
    projected_total = unmanaged + max(0, int(configured_managed_capacity))
    projected_available = max(0, maximum - projected_total)
    return {
        "max_connections": maximum,
        "total_connections": total,
        "managed_connections": managed,
        "unmanaged_connections": unmanaged,
        "configured_managed_capacity": max(0, int(configured_managed_capacity)),
        "available_now": available_now,
        "reserve_target": target_reserve,
        "reserve_available_now": available_now >= target_reserve,
        "projected_total_connections": projected_total,
        "projected_available_connections": projected_available,
        "projected_reserve_available": projected_available >= target_reserve,
    }


def _load_configured_budget() -> dict[str, Any]:
    script = PROJECT_ROOT / "scripts" / "pm2" / "postgres_connection_budget.js"
    completed = subprocess.run(
        ["node", str(script)],
        check=True,
        capture_output=True,
        text=True,
        cwd=str(PROJECT_ROOT),
    )
    payload = json.loads(completed.stdout)
    if not isinstance(payload, dict):
        raise RuntimeError("PM2 PostgreSQL budget helper returned an invalid payload")
    return payload


def _query_runtime_connection_counts() -> tuple[int, dict[str, int]]:
    if str(WEB_ROOT) not in sys.path:
        sys.path.insert(0, str(WEB_ROOT))
    from sqlalchemy import text
    from backend.chat.db import get_chat_database_url, get_chat_read_engine

    database_url = get_chat_database_url()
    if not database_url.lower().startswith("postgres"):
        raise RuntimeError("CHAT_DATABASE_URL is not a PostgreSQL URL")
    with get_chat_read_engine(database_url).connect() as connection:
        maximum = int(
            connection.execute(text("SELECT current_setting('max_connections')::integer")).scalar_one()
        )
        rows = connection.execute(
            text(
                """
                SELECT COALESCE(application_name, '') AS application_name, COUNT(*) AS count
                FROM pg_stat_activity
                WHERE datname = current_database()
                GROUP BY COALESCE(application_name, '')
                ORDER BY count DESC, application_name ASC
                """
            )
        ).mappings().all()
    return maximum, {str(row["application_name"]): int(row["count"]) for row in rows}


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(description="Check PostgreSQL connection reserve before Hub/Chat rollout.")
    parser.add_argument("--reserve", type=int, default=20, help="Required currently free PostgreSQL connections")
    parser.add_argument(
        "--enforce",
        action="store_true",
        help="Exit non-zero when the live PostgreSQL reserve is below --reserve",
    )
    parser.add_argument(
        "--enforce-projected",
        action="store_true",
        help="Exit non-zero when the configured dual-chat envelope leaves less than --reserve",
    )
    parser.add_argument("--json", action="store_true", help="Emit machine-readable JSON only")
    return parser.parse_args()


def main() -> int:
    args = parse_args()
    budget = _load_configured_budget()
    maximum, by_application = _query_runtime_connection_counts()
    managed_names = {str(item) for item in budget.get("managed_application_names") or []}
    managed = sum(count for name, count in by_application.items() if name in managed_names)
    total = sum(by_application.values())
    evaluation = evaluate_connection_budget(
        max_connections=maximum,
        total_connections=total,
        managed_connections=managed,
        configured_managed_capacity=int(budget.get("configured_managed_capacity") or 0),
        reserve=max(0, int(args.reserve)),
    )
    payload = {
        "mode": budget.get("mode"),
        "budget": evaluation,
        "connections_by_application": by_application,
        "configured_processes": budget.get("processes") or [],
    }
    if args.json:
        print(json.dumps(payload, ensure_ascii=False, sort_keys=True))
    else:
        print(
            "PostgreSQL connections: "
            f"used={evaluation['total_connections']}/{evaluation['max_connections']} "
            f"free={evaluation['available_now']} reserve={evaluation['reserve_target']} "
            f"live_ok={evaluation['reserve_available_now']}"
        )
        print(
            "Dual-chat configured peak: "
            f"managed={evaluation['configured_managed_capacity']} "
            f"projected_total={evaluation['projected_total_connections']} "
            f"projected_free={evaluation['projected_available_connections']} "
            f"projected_ok={evaluation['projected_reserve_available']}"
        )
        for name, count in by_application.items():
            print(f"  {name or '(unset)'}: {count}")
    if args.enforce and not bool(evaluation["reserve_available_now"]):
        print(
            "REFUSING ROLLOUT: PostgreSQL live reserve is below the required threshold.",
            file=sys.stderr,
        )
        return 2
    if args.enforce_projected and not bool(evaluation["projected_reserve_available"]):
        print(
            "REFUSING ROLLOUT: configured dual-chat connection envelope leaves too little reserve.",
            file=sys.stderr,
        )
        return 3
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
