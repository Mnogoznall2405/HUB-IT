"""Staged rollout of a ``self_update`` task (new agent MSI) to the scan agents.

Usage (from the repository root, with the production .env next to it):

    python scripts/scan/rollout_self_update.py                 # dry run: counts only
    python scripts/scan/rollout_self_update.py --apply         # queue in waves

The package comes from the server settings (SCAN_AGENT_PACKAGE_PATH / SCAN_AGENT_PACKAGE_SHA256) and its
version is the repository AGENT_VERSION; this script only chooses the agents. Only online agents older than
the target and not older than ``--min-agent-version`` are queued. A wave counts as done when its agents report
the target version. The rollout stops by itself when too many tasks fail, the pilot wave does not reach the
target, or a service stops answering. Re-running is safe: agents that already have a task with the same dedupe
key are skipped.
"""
from __future__ import annotations

import argparse
import random
import re
import sys
import time
import urllib.request
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]
sys.path.insert(0, str(ROOT))

import sqlalchemy as sa  # noqa: E402

DEFAULT_WAVES = "8,40,150,1000000"
DEFAULT_HEALTH = "http://127.0.0.1:8001/health,http://127.0.0.1:8011/health"


def _read_env(name: str) -> str:
    for line in (ROOT / ".env").read_text(encoding="utf-8", errors="ignore").splitlines():
        match = re.match(rf"^{name}=(.*)$", line.strip())
        if match:
            return match.group(1).strip().strip("'\"")
    return ""


def _version_key(value: str) -> tuple:
    return tuple(int("".join(ch for ch in piece if ch.isdigit()) or 0) for piece in str(value or "").split("."))


def _healthy(urls: list[str]) -> bool:
    for url in urls:
        try:
            if urllib.request.urlopen(url, timeout=15).status != 200:
                return False
        except Exception:
            return False
    return True


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    parser.add_argument("--min-agent-version", default="1.4.11", help="older agents are not queued")
    parser.add_argument("--waves", default=DEFAULT_WAVES, help="comma separated wave sizes; the first one is the pilot")
    parser.add_argument("--wave-timeout-min", type=int, default=25)
    parser.add_argument("--max-failed-pct", type=float, default=5.0)
    parser.add_argument("--pilot-min-pct", type=float, default=75.0, help="share of the pilot wave that must reach the target")
    parser.add_argument("--online-sec", type=int, default=600)
    parser.add_argument("--health-urls", default=DEFAULT_HEALTH)
    parser.add_argument("--apply", action="store_true", help="queue the tasks (default is a dry run)")
    args = parser.parse_args()

    import scan_server.app as app
    from scan_server.agent_package import package_payload, resolve_agent_package

    config = app.config
    info = resolve_agent_package(
        package_path=config.agent_package_path,
        package_url=config.agent_package_url,
        package_sha256=config.agent_package_sha256,
    )
    payload = package_payload(info)
    target = info.expected_version
    target_key = _version_key(target)
    key = f"self_update-{target}"
    health_urls = [item.strip() for item in args.health_urls.split(",") if item.strip()]
    engine = sa.create_engine(
        _read_env("SCAN_DATABASE_URL"), connect_args={"options": "-c default_transaction_read_only=on"}
    )
    min_key = _version_key(args.min_agent_version)

    now = time.time()
    with engine.connect() as conn:
        rows = conn.execute(sa.text("select agent_id,hostname,version,last_seen_at from scan.scan_agents")).fetchall()
        done = {
            row[0]
            for row in conn.execute(sa.text("select agent_id from scan.scan_tasks where dedupe_key=:k"), {"k": key})
        }
    eligible = [r for r in rows if min_key <= _version_key(r[2]) < target_key and r[0] not in done]
    online = [r for r in eligible if now - (r[3] or 0) < args.online_sec]
    print(f"package {info.filename} -> {target} sha {info.msi_sha256[:8]}.. key {key}")
    print(f"agents total {len(rows)}, eligible {len(eligible)}, online now {len(online)}")
    if not args.apply:
        print("dry run: nothing queued (use --apply)")
        return 0
    if not _healthy(health_urls):
        print("STOP: service health check failed before the rollout", flush=True)
        return 2

    random.Random(17).shuffle(online)
    sizes = [int(item) for item in args.waves.split(",") if item.strip()]
    position = 0
    for number, size in enumerate(sizes, start=1):
        chunk = online[position : position + size]
        position += size
        if not chunk:
            continue
        ids = [row[0] for row in chunk]
        for row in chunk:
            app.store.create_task(
                agent_id=row[0], command="self_update", payload=payload, ttl_days=config.task_ttl_days, dedupe_key=key
            )
        print(f"wave {number}: queued {len(ids)}", flush=True)
        deadline = time.time() + args.wave_timeout_min * 60
        updated = 0
        while time.time() < deadline:
            time.sleep(30)
            with engine.connect() as conn:
                status = dict(
                    conn.execute(
                        sa.text(
                            "select status,count(*) from scan.scan_tasks where dedupe_key=:k and agent_id=any(:i) group by 1"
                        ),
                        {"k": key, "i": ids},
                    ).fetchall()
                )
                versions = [
                    row[0]
                    for row in conn.execute(
                        sa.text("select version from scan.scan_agents where agent_id=any(:i)"), {"i": ids}
                    )
                ]
            updated = sum(1 for version in versions if _version_key(version) >= target_key)
            failed = status.get("failed", 0)
            print(f"wave {number}: tasks {status}, on {target}: {updated}/{len(ids)}", flush=True)
            if failed > max(2, args.max_failed_pct / 100.0 * len(ids)):
                print("STOP: too many failed tasks", flush=True)
                return 2
            if not _healthy(health_urls):
                print("STOP: service health check failed", flush=True)
                return 2
            if updated >= 0.9 * len(ids):
                break
        if number == 1 and updated < args.pilot_min_pct / 100.0 * len(ids):
            print(f"STOP: pilot wave reached the target on {updated}/{len(ids)} agents only", flush=True)
            return 2
    print("ROLLOUT_COMPLETE")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
