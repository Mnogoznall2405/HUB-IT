"""Staged rollout of an ``install_package`` task (for example HUB Desktop) to the scan agents.

Usage (from the repository root, with the production .env next to it):

    python -I scripts/scan/rollout_install_package.py --package-id hub-desktop            # dry run: counts only
    python -I scripts/scan/rollout_install_package.py --package-id hub-desktop --apply    # queue in waves

Only online agents that support the command (``--min-agent-version``) are queued. Every wave waits until
the tasks finish; the rollout stops by itself when too many tasks fail or a service stops answering.
Package, hash, kind and arguments always come from the server manifest (SCAN_INSTALL_MANIFEST_PATH);
this script only chooses the agents. Re-running is safe: agents that already have a task with the same
dedupe key are skipped.
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

DEFAULT_WAVES = "25,100,150,1000000"


def _read_env(name: str) -> str:
    for line in (ROOT / ".env").read_text(encoding="utf-8", errors="ignore").splitlines():
        match = re.match(rf"^{name}=(.*)$", line.strip())
        if match:
            return match.group(1).strip().strip("'\"")
    return ""


def _version_key(value: str) -> tuple:
    return tuple(int("".join(ch for ch in piece if ch.isdigit()) or 0) for piece in str(value or "").split("."))


def _healthy() -> bool:
    for url in ("http://127.0.0.1:8001/health", "http://127.0.0.1:8011/health", "http://127.0.0.1:8012/health"):
        try:
            if urllib.request.urlopen(url, timeout=15).status != 200:
                return False
        except Exception:
            return False
    return True


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    parser.add_argument("--package-id", required=True)
    parser.add_argument("--min-agent-version", default="1.4.15", help="agents older than this cannot run install_package")
    parser.add_argument("--waves", default=DEFAULT_WAVES, help="comma separated wave sizes")
    parser.add_argument("--wave-timeout-min", type=int, default=20)
    parser.add_argument("--max-failed-pct", type=float, default=5.0)
    parser.add_argument("--apply", action="store_true", help="queue the tasks (default is a dry run)")
    args = parser.parse_args()

    import scan_server.app as app
    from scan_server.install_packages import install_task_payload, resolve_install_package

    config = app.config
    info = resolve_install_package(config.install_manifest_path, args.package_id)
    payload = install_task_payload(info)
    key = f"install-{info.package_id}-{info.version or 'any'}"
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
    eligible = [r for r in rows if _version_key(r[2]) >= min_key and r[0] not in done]
    online = [r for r in eligible if now - (r[3] or 0) < 600]
    print(f"package {info.package_id} {info.version} sha {info.sha256[:8]}.. key {key}")
    print(f"agents total {len(rows)}, eligible {len(eligible)}, online now {len(online)}")
    if not args.apply:
        print("dry run: nothing queued (use --apply)")
        return 0

    random.Random(15).shuffle(online)
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
                agent_id=row[0], command="install_package", payload=payload, ttl_days=config.task_ttl_days, dedupe_key=key
            )
        print(f"wave {number}: queued {len(ids)}", flush=True)
        deadline = time.time() + args.wave_timeout_min * 60
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
            finished = status.get("completed", 0) + status.get("failed", 0)
            failed = status.get("failed", 0)
            print(f"wave {number}: {status}", flush=True)
            if failed > max(2, args.max_failed_pct / 100.0 * len(ids)):
                print("STOP: too many failed tasks", flush=True)
                return 2
            if not _healthy():
                print("STOP: service health check failed", flush=True)
                return 2
            if finished >= 0.9 * len(ids):
                break
    print("ROLLOUT_COMPLETE")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
