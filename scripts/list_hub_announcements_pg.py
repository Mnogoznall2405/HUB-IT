#!/usr/bin/env python3
"""List hub announcements from PostgreSQL (APP_DATABASE_URL)."""
from __future__ import annotations

import os
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]


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


def normalize_pg_url(url: str) -> str:
    return (
        url.replace("postgresql+psycopg://", "postgresql://")
        .replace("postgresql+psycopg2://", "postgresql://")
    )


def connect(url: str):
    try:
        import psycopg

        return psycopg.connect(normalize_pg_url(url))
    except ImportError:
        import psycopg2

        return psycopg2.connect(normalize_pg_url(url))


def main() -> int:
    load_dotenv()
    url = (os.environ.get("APP_DATABASE_URL") or os.environ.get("CHAT_DATABASE_URL") or "").strip()
    if not url:
        print("APP_DATABASE_URL / CHAT_DATABASE_URL not set", file=sys.stderr)
        return 1

    conn = connect(url)
    cur = conn.cursor()

    for schema in ("app", "public"):
        try:
            cur.execute(
                f"""
                SELECT id, title, preview, is_active, author_full_name, published_at, updated_at, priority
                FROM {schema}.hub_announcements
                ORDER BY published_at DESC NULLS LAST, title ASC
                """
            )
            rows = cur.fetchall()
        except Exception as exc:
            print(f"schema {schema}: {exc}", file=sys.stderr)
            continue

        print(f"source: PostgreSQL ({schema})")
        print(f"total: {len(rows)}")
        print("-" * 100)

        for index, row in enumerate(rows, start=1):
            ann_id, title, preview, is_active, author, published_at, updated_at, priority = row
            active = "active" if int(is_active or 0) else "archived"
            preview_text = (preview or "").replace("\n", " ")
            if len(preview_text) > 120:
                preview_text = preview_text[:117] + "..."

            print(f"{index:>3}. id={ann_id}")
            print(f"     title: {title}")
            print(f"     preview: {preview_text or '(empty)'}")
            print(f"     author: {author or '-'} | priority: {priority} | {active}")
            print(f"     published: {published_at} | updated: {updated_at}")
            print()

        conn.close()
        return 0

    conn.close()
    print("hub_announcements table not found in app/public schemas", file=sys.stderr)
    return 1


if __name__ == "__main__":
    raise SystemExit(main())
