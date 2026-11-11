#!/usr/bin/env python3
"""One-shot / resumable compact 1C catalogue search backfill (TEST DB only by default).

Safety:
  - Refuses production DB names (hubit_chat / postgres / templates) by default
  - Allows only hubit_chat_retention_test_% or hubit_chat_1c_search_test_%
  - Production hubit_chat requires explicit --allow-prod (still fail-closed:
    --execute + --allow-enabled-flag + COMPACT_BACKFILL_ENABLED=1)
  - Dry-run by default; requires --execute AND COMPACT_BACKFILL_ENABLED=1
  - Never calls 1C; builds from app.one_c_catalog_entries only
  - Cluster templates (postgres / template0 / template1) are NEVER allowed

Usage:
  python scripts/one_c_catalog_compact_backfill.py
  python scripts/one_c_catalog_compact_backfill.py --execute
  python scripts/one_c_catalog_compact_backfill.py --allow-prod --execute --allow-enabled-flag
"""
from __future__ import annotations

import argparse
import json
import os
import re
import sys
from pathlib import Path
from urllib.parse import urlparse, urlunparse, unquote


ROOT = Path(__file__).resolve().parents[1]
WEB_ROOT = ROOT / "WEB-itinvent"
if str(WEB_ROOT) not in sys.path:
    sys.path.insert(0, str(WEB_ROOT))

HARD_REJECT = frozenset({"hubit_chat", "postgres", "template0", "template1"})
CLUSTER_TEMPLATES = frozenset({"postgres", "template0", "template1"})
PROD_DB = "hubit_chat"
ALLOWED_RE = re.compile(
    r"^(hubit_chat_retention_test_.+|hubit_chat_1c_search_test_.+)$",
    re.IGNORECASE,
)


def _load_dotenv() -> dict[str, str]:
    path = ROOT / ".env"
    env: dict[str, str] = {}
    if not path.is_file():
        return env
    for line in path.read_text(encoding="utf-8", errors="replace").splitlines():
        text = line.strip()
        if not text or text.startswith("#") or "=" not in text:
            continue
        key, value = text.split("=", 1)
        value = value.strip()
        if len(value) >= 2 and value[0] == value[-1] and value[0] in "\"'":
            value = value[1:-1]
        env[key.strip()] = value
    return env


def _normalize_url(raw: str) -> str:
    text = (raw or "").strip()
    for prefix in ("postgresql+psycopg://", "postgresql+psycopg2://"):
        if text.startswith(prefix):
            return "postgresql://" + text[len(prefix) :]
    return text


def _db_name(url: str) -> str:
    parsed = urlparse(_normalize_url(url))
    return unquote(parsed.path or "").lstrip("/").split("/")[0]


def _with_db(url: str, database: str) -> str:
    parsed = urlparse(_normalize_url(url))
    return urlunparse(parsed._replace(path="/" + database))


def _redact(url: str) -> str:
    parsed = urlparse(_normalize_url(url))
    netloc = parsed.hostname or ""
    if parsed.port:
        netloc = f"{netloc}:{parsed.port}"
    if parsed.username:
        netloc = f"{parsed.username}:***@{netloc}"
    return urlunparse(parsed._replace(netloc=netloc))


def _resolve_dsn(explicit: str | None, *, allow_prod: bool = False) -> str:
    if explicit:
        return _normalize_url(explicit)
    file_env = _load_dotenv()
    if allow_prod:
        for key in ("APP_DATABASE_URL", "CHAT_DATABASE_URL"):
            value = (os.getenv(key) or file_env.get(key) or "").strip()
            if value:
                return _normalize_url(value)
        raise SystemExit("REFUSED: --allow-prod requires APP_DATABASE_URL")
    for key in ("ONE_C_SEARCH_TEST_DATABASE_URL", "TEST_DATABASE_URL"):
        value = (os.getenv(key) or "").strip()
        if value:
            return _normalize_url(value)
    for key in ("ONE_C_SEARCH_TEST_DATABASE_URL", "TEST_DATABASE_URL"):
        value = (file_env.get(key) or "").strip()
        if value:
            return _normalize_url(value)
    chosen_path = ROOT / "tmp" / "one_c_search_benchmark" / "results" / "chosen_test_db.txt"
    chosen = chosen_path.read_text(encoding="utf-8").strip() if chosen_path.is_file() else ""
    if not chosen or not ALLOWED_RE.match(chosen) or chosen.casefold() in HARD_REJECT:
        raise SystemExit(
            "REFUSED: set ONE_C_SEARCH_TEST_DATABASE_URL to an allowed test DB "
            "(hubit_chat_retention_test_% / hubit_chat_1c_search_test_%) "
            "or pass --allow-prod for explicit production backfill"
        )
    for key in ("APP_DATABASE_URL", "CHAT_DATABASE_URL"):
        value = (os.getenv(key) or file_env.get(key) or "").strip()
        if value:
            return _with_db(value, chosen)
    raise SystemExit("REFUSED: no APP/CHAT_DATABASE_URL available to rewrite to test DB")


def _assert_safe(dsn: str, *, allow_prod: bool = False) -> str:
    name = _db_name(dsn)
    if name.casefold() in CLUSTER_TEMPLATES:
        raise SystemExit(f"REFUSED: DSN targets cluster template {name!r}")
    if allow_prod:
        if name.casefold() != PROD_DB:
            raise SystemExit(
                f"REFUSED: --allow-prod only permits {PROD_DB!r}, got {name!r}"
            )
    elif name.casefold() in HARD_REJECT or not ALLOWED_RE.match(name):
        raise SystemExit(
            f"REFUSED: DSN targets non-allowed DB {name!r} "
            "(pass --allow-prod for hubit_chat production path)"
        )
    import psycopg

    with psycopg.connect(dsn, autocommit=True) as conn:
        with conn.cursor() as cur:
            cur.execute("SELECT current_database()")
            current = cur.fetchone()[0]
    current_s = str(current)
    if current_s.casefold() in CLUSTER_TEMPLATES:
        raise SystemExit(f"REFUSED: current_database()={current_s!r} is a cluster template")
    if allow_prod:
        if current_s.casefold() != PROD_DB:
            raise SystemExit(
                f"REFUSED: --allow-prod current_database()={current_s!r} != {PROD_DB!r}"
            )
    elif current_s.casefold() in HARD_REJECT or not ALLOWED_RE.match(current_s):
        raise SystemExit(f"REFUSED: current_database()={current_s!r} not allowed")
    return current_s


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--dsn", default="", help="Explicit DB DSN (optional)")
    parser.add_argument("--source-base", default="buh20")
    parser.add_argument(
        "--execute",
        action="store_true",
        help="Apply backfill (still requires COMPACT_BACKFILL_ENABLED=1)",
    )
    parser.add_argument(
        "--allow-enabled-flag",
        action="store_true",
        help="Permit execute when WAREHOUSE_1C_CATALOG_COMPACT_BACKFILL_ENABLED=1",
    )
    parser.add_argument(
        "--allow-prod",
        action="store_true",
        help=(
            "Allow targeting production hubit_chat (explicit opt-in; still requires "
            "--execute + --allow-enabled-flag + COMPACT_BACKFILL_ENABLED=1). "
            "Templates remain hard-rejected."
        ),
    )
    args = parser.parse_args()

    dsn = _resolve_dsn(args.dsn or None, allow_prod=bool(args.allow_prod))
    db_name = _assert_safe(dsn, allow_prod=bool(args.allow_prod))
    print(
        f"target_db={db_name} dsn={_redact(dsn)} dry_run={not args.execute} "
        f"allow_prod={bool(args.allow_prod)}"
    )

    # Ensure SQLAlchemy app URL uses the resolved DSN for this process only.
    os.environ["APP_DATABASE_URL"] = dsn.replace("postgresql://", "postgresql+psycopg://", 1)

    from backend.services.one_c_catalog_compact_backfill import OneCCatalogCompactBackfill
    from backend.services.one_c_catalog_compact_flags import get_compact_flags

    flags = get_compact_flags()
    dry_run = not args.execute
    if args.execute:
        if not flags.compact_backfill_enabled:
            print(
                "REFUSED: execute requires WAREHOUSE_1C_CATALOG_COMPACT_BACKFILL_ENABLED=1 "
                "(fail-closed). Use dry-run without --execute."
            )
            return 2
        if not args.allow_enabled_flag:
            print(
                "REFUSED: pass --allow-enabled-flag together with --execute "
                "to acknowledge a one-shot backfill on the verified target DB."
            )
            return 2
        if db_name.casefold() == PROD_DB and not args.allow_prod:
            print(
                "REFUSED: production hubit_chat requires --allow-prod "
                "(fail-closed; HARD_REJECT not silently disabled)."
            )
            return 2

    report = OneCCatalogCompactBackfill(
        dsn.replace("postgresql://", "postgresql+psycopg://", 1),
        dry_run=dry_run,
        source_base=args.source_base,
    ).run()
    print(json.dumps({
        "dry_run": report.dry_run,
        "enabled": report.enabled,
        "allow_prod": bool(args.allow_prod),
        "target_db": db_name,
        "stopped_reason": report.stopped_reason,
        "processed": report.processed,
        "upserted": report.upserted,
        "errors": report.errors,
        "elapsed_seconds": round(report.elapsed_seconds, 3),
        "free_disk_bytes": report.free_disk_bytes,
        "catalogs": {
            key: {
                k: v for k, v in value.items()
                if k != "checksum" or True
            }
            for key, value in report.catalogs.items()
        },
    }, ensure_ascii=False, indent=2))
    return 0 if report.stopped_reason in {"completed", ""} or report.dry_run else 1


if __name__ == "__main__":
    raise SystemExit(main())
