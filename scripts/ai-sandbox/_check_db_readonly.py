"""Read-only readiness check for OpenCode sandbox (no DDL/DML)."""
from __future__ import annotations

import os
import re
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]
ENV_PATH = ROOT / ".env"


def load_env() -> dict[str, str]:
    out: dict[str, str] = {}
    for line in ENV_PATH.read_text(encoding="utf-8").splitlines():
        if not line or line.startswith("#") or "=" not in line:
            continue
        k, v = line.split("=", 1)
        out[k.strip()] = v.strip()
    return out


def main() -> int:
    env = load_env()
    print("=== local .env feature flags (values redacted where secret) ===")
    for k in [
        "AI_SANDBOX_ENABLED",
        "AI_SANDBOX_CONTENT_TRANSFER_READY",
        "AI_SANDBOX_IMAGE",
        "AI_SANDBOX_OPENCODE_VERSION",
        "AI_SANDBOX_LLM_MODEL",
        "AI_SANDBOX_LLM_GATEWAY_URL",
        "AI_SANDBOX_CONTENT_TRANSFER_URL",
        "AI_SANDBOX_INTERNAL_NETWORK",
        "AI_SANDBOX_WORKSPACE_ROOT",
        "AI_SANDBOX_SECCOMP_PROFILE",
        "AI_SANDBOX_QUOTA_HELPER",
        "AI_SANDBOX_UID",
        "AI_SANDBOX_GID",
    ]:
        v = env.get(k, "<missing>")
        if "TOKEN" in k or "PASSWORD" in k:
            v = "<set>" if v and not v.startswith("<") else v
        print(f"{k}={v}")

    url = env.get("APP_DATABASE_URL", "")
    if not url:
        print("NO_APP_DATABASE_URL")
        return 2

    # Prefer psycopg sync URL
    sa_url = url.replace("postgresql+psycopg://", "postgresql://")
    try:
        import psycopg
    except ImportError:
        print("psycopg_missing")
        return 3

    print("\n=== PostgreSQL read-only (host redacted) ===")
    tables = [
        "ai_sandbox_sessions",
        "ai_sandbox_jobs",
        "ai_sandbox_files",
        "ai_sandbox_permissions",
        "ai_sandbox_transfer_grants",
        "ai_sandbox_gateway_grants",
    ]
    with psycopg.connect(sa_url, connect_timeout=10) as conn:
        with conn.cursor() as cur:
            cur.execute("select current_database(), current_user, current_setting('search_path')")
            db, user, sp = cur.fetchone()
            print(f"db={db} user={user} search_path={sp}")

            # alembic version table(s)
            for ver_table in ("alembic_version", "app.alembic_version", "public.alembic_version"):
                try:
                    cur.execute(f"select version_num from {ver_table}")
                    rows = [r[0] for r in cur.fetchall()]
                    print(f"alembic_via={ver_table} versions={rows}")
                except Exception as e:
                    conn.rollback()
                    print(f"alembic_via={ver_table} err={type(e).__name__}")

            # schema presence
            cur.execute(
                """
                select table_schema, table_name
                from information_schema.tables
                where table_name = any(%s)
                order by table_schema, table_name
                """,
                (tables,),
            )
            found = cur.fetchall()
            print("sandbox_tables_found=")
            for schema, name in found:
                print(f"  {schema}.{name}")
            missing = sorted(set(tables) - {n for _, n in found})
            print("sandbox_tables_missing=", missing or "none")

            # revision markers if app alembic uses version table with multiple heads
            cur.execute(
                """
                select n.nspname, c.relname
                from pg_class c
                join pg_namespace n on n.oid = c.relnamespace
                where c.relname like '%alembic%version%'
                order by 1,2
                """
            )
            print("alembic_relations=", cur.fetchall())

            # 0098 prerequisite bots table
            cur.execute(
                """
                select table_schema, table_name
                from information_schema.tables
                where table_name in ('ai_bots','app_ai_bots')
                order by 1,2
                """
            )
            print("ai_bots_tables=", cur.fetchall())

    print("\nDONE_DB_CHECK")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
