#!/usr/bin/env python3
"""Delete hub test announcements from production app DB (PostgreSQL or local SQLite)."""
from __future__ import annotations

import argparse
import importlib
import os
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
WEB_ROOT = ROOT / "WEB-itinvent"
if str(WEB_ROOT) not in sys.path:
    sys.path.insert(0, str(WEB_ROOT))

TEST_AUTHOR_FULL_NAMES = {
    "Announcement Author",
}
TEST_AUTHOR_USERNAMES = {
    "author",
}
TEST_TITLES = {
    "Expired Note",
    "Archive Me",
    "Versioned Note Updated",
    "Operator Direct Note",
    "Viewer Role Note",
}
TEST_TITLE_FRAGMENTS = (
    "Проверка заметок ограниченного доступа",
    "Заметка для СПб",
    "Заметка для заметки",
)


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


def _normalize(value: object) -> str:
    return str(value or "").strip()


def is_test_announcement(row: dict) -> bool:
    author_full_name = _normalize(row.get("author_full_name"))
    author_username = _normalize(row.get("author_username"))
    title = _normalize(row.get("title"))
    preview = _normalize(row.get("preview"))

    if author_full_name in TEST_AUTHOR_FULL_NAMES or author_username in TEST_AUTHOR_USERNAMES:
        return True
    if title in TEST_TITLES:
        return True
    if any(fragment in title for fragment in TEST_TITLE_FRAGMENTS):
        return True
    if preview.lower().startswith("тест "):
        return True
    if title and preview == "Preview" and author_full_name in TEST_AUTHOR_FULL_NAMES:
        return True
    return False


def list_announcement_rows(service) -> list[dict]:
    with service._lock, service._connect() as conn:
        rows = conn.execute(f"SELECT * FROM {service._ANN_TABLE} ORDER BY published_at DESC").fetchall()
    return [dict(row) for row in rows]


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument(
        "--dry-run",
        action="store_true",
        help="Only print announcements that would be deleted.",
    )
    args = parser.parse_args()

    load_dotenv()
    database_url = (os.environ.get("APP_DATABASE_URL") or "").strip() or None
    hub_service_module = importlib.import_module("backend.services.hub_service")
    service = hub_service_module.HubService(database_url=database_url)
    storage = "PostgreSQL (APP_DATABASE_URL)" if database_url else f"SQLite ({service.db_path})"
    print(f"Storage: {storage}")

    rows = list_announcement_rows(service)
    candidates = [row for row in rows if is_test_announcement(row)]

    if not candidates:
        print("No test announcements matched current heuristics.")
        return 0

    print(f"Matched test announcements: {len(candidates)}")
    for row in candidates:
        print(
            f"- {row.get('id')} | {row.get('title')} | "
            f"author={row.get('author_full_name') or row.get('author_username') or '-'}"
        )

    if args.dry_run:
        print("Dry run only; nothing deleted.")
        return 0

    deleted = 0
    missing = 0
    for row in candidates:
        ann_id = _normalize(row.get("id"))
        if not ann_id:
            continue
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

    print(f"done: deleted={deleted}, not_found={missing}, kept={len(rows) - deleted}")
    return 0 if missing == 0 else 1


if __name__ == "__main__":
    raise SystemExit(main())
