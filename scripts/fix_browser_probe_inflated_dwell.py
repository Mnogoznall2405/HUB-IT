#!/usr/bin/env python3
"""Fix inflated dwell in app.browser_probe_visits left by pre-1.4.19 agents.

Agents without idle detection credited a tab left in foreground overnight
(e.g. a PC left on since Friday) as active dwell — rows >90h exist on prod.
Rows with dwell_sec above --cap-sec are rebalanced: the surplus is moved to
idle_sec (shown separately as "Простой"), dwell_sec is capped.

Dry-run by default: prints candidate count, host count, hours to move and the
top-10 rows. Applies only with --apply, in batches of 1000 row ids, each batch
in its own short transaction. Re-running is safe: capped rows no longer match.
Requires the idle_sec column (Alembic 20261111_0167); aborts clearly without it.

Usage:
    python scripts/fix_browser_probe_inflated_dwell.py [--cap-sec 1800]
        [--profile focus|history|all] [--database-url URL] [--apply]
"""
from __future__ import annotations

import argparse
import os
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
WEB_ROOT = ROOT / "WEB-itinvent"
for path in (str(ROOT), str(WEB_ROOT)):
    if path not in sys.path:
        sys.path.insert(0, path)

BATCH_SIZE = 1000


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


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__.splitlines()[0])
    parser.add_argument("--cap-sec", type=float, default=1800.0,
                        help="Dwell cap in seconds (default 1800 = 30 min).")
    parser.add_argument("--profile", choices=("focus", "history", "all"), default="all")
    parser.add_argument("--database-url", default="",
                        help="Override APP_DATABASE_URL (e.g. a test SQLite copy).")
    parser.add_argument("--apply", action="store_true",
                        help="Apply the fix. Without it only a dry-run report is printed.")
    args = parser.parse_args()
    cap = float(args.cap_sec)
    if cap <= 0:
        print("error: --cap-sec must be positive")
        return 1

    load_dotenv()
    database_url = (args.database_url or os.environ.get("APP_DATABASE_URL") or "").strip()
    if not database_url:
        print("error: APP_DATABASE_URL is not configured (or pass --database-url)")
        return 1

    import sqlalchemy as sa
    from sqlalchemy import func, select, update

    from backend.appdb.db import app_session, get_app_engine
    from backend.appdb.models import AppBrowserProbeVisit

    engine = get_app_engine(database_url)
    schema = "app" if engine.dialect.name == "postgresql" else None
    with engine.connect() as connection:
        columns = {
            str(c.get("name") or "")
            for c in sa.inspect(connection).get_columns("browser_probe_visits", schema=schema)
        }
    if "idle_sec" not in columns:
        print(
            "error: browser_probe_visits.idle_sec is missing — "
            "apply Alembic migration 20261111_0167 first"
        )
        return 1

    visit = AppBrowserProbeVisit
    cond = [visit.dwell_sec > cap]
    if args.profile == "focus":
        cond.append(visit.profile == "focus")
    elif args.profile == "history":
        cond.append(visit.profile != "focus")

    with app_session(database_url=database_url) as session:
        row_count, hosts, move_sec = session.execute(
            select(
                func.count(),
                func.count(func.distinct(visit.computer_name)),
                func.coalesce(func.sum(visit.dwell_sec - cap), 0.0),
            ).where(*cond)
        ).one()
        top = session.execute(
            select(visit.computer_name, visit.title, visit.dwell_sec, visit.idle_sec)
            .where(*cond)
            .order_by(visit.dwell_sec.desc())
            .limit(10)
        ).all()

    hours = float(move_sec or 0) / 3600.0
    mode = "APPLY" if args.apply else "DRY-RUN"
    print(
        f"[{mode}] profile={args.profile} cap={cap:g}s: "
        f"rows={int(row_count or 0)} hosts={int(hosts or 0)} "
        f"dwell->idle hours={hours:.1f}"
    )
    for host, title, dwell, idle in top:
        print(
            f"  {host} | {str(title or '')[:50]:50s} | "
            f"dwell={float(dwell or 0) / 3600:.1f}h idle={float(idle or 0) / 3600:.1f}h"
        )
    if not args.apply:
        print("dry-run only; pass --apply to fix these rows")
        return 0
    if not row_count:
        return 0

    updated = 0
    while True:
        # Re-select each batch: rows already fixed no longer match, so
        # a re-run (or a crash mid-way) simply continues idempotently.
        with app_session(database_url=database_url) as session:
            ids = session.execute(
                select(visit.id).where(*cond).order_by(visit.id).limit(BATCH_SIZE)
            ).scalars().all()
        if not ids:
            break
        with app_session(database_url=database_url) as session:
            session.execute(
                update(visit)
                .where(visit.id.in_(ids), visit.dwell_sec > cap)
                .values(
                    idle_sec=func.coalesce(visit.idle_sec, 0.0) + (visit.dwell_sec - cap),
                    dwell_sec=cap,
                )
            )
        updated += len(ids)
        print(f"  batch applied: {len(ids)} rows (total {updated})")
    print(f"done: {updated} rows rebalanced")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
