"""Apply scoped session defaults; dry-run by default, no table/schema changes."""
from __future__ import annotations

import argparse
import json
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]
POLICY = {"tcp_keepalives_idle": "60", "tcp_keepalives_interval": "15",
          "tcp_keepalives_count": "4", "idle_in_transaction_session_timeout": "300000"}


def target_urls():
    from dotenv import dotenv_values
    from sqlalchemy.engine import make_url

    settings = dotenv_values(ROOT / ".env")
    seen = set()
    for key in ("APP_DATABASE_URL", "CHAT_DATABASE_URL", "SCAN_DATABASE_URL", "VOICE_DATABASE_URL"):
        raw = settings.get(key) or ""
        if not raw.startswith("postgres"):
            continue
        url = make_url(raw)
        identity = (url.host, url.port or 5432, url.database, url.username)
        if identity not in seen:
            seen.add(identity)
            yield url


def connect(url):
    import psycopg
    return psycopg.connect(host=url.host, port=url.port or 5432, dbname=url.database,
                          user=url.username, password=url.password, connect_timeout=5,
                          application_name="hubit-session-policy", autocommit=True,
                          options="-c statement_timeout=5000 -c lock_timeout=1000")


def scoped_values(conn):
    with conn.cursor() as cur:
        cur.execute("""SELECT s.setconfig FROM pg_db_role_setting s
            JOIN pg_database d ON d.oid=s.setdatabase JOIN pg_roles r ON r.oid=s.setrole
            WHERE d.datname=current_database() AND r.rolname=current_user""")
        row = cur.fetchone()
    values = dict(item.split("=", 1) for item in (row[0] if row else []))
    return {key: values.get(key) for key in POLICY}


def apply_values(conn, role, database, values):
    from psycopg import sql
    if set(values) != set(POLICY):
        raise ValueError("Unexpected policy keys")
    with conn.transaction(), conn.cursor() as cur:
        for key, value in values.items():
            base = sql.SQL("ALTER ROLE {} IN DATABASE {} ").format(sql.Identifier(role), sql.Identifier(database))
            if value is None:
                query = base + sql.SQL("RESET {}").format(sql.Identifier(key))
            else:
                query = base + sql.SQL("SET {} TO {}").format(sql.Identifier(key), sql.Literal(str(value)))
            cur.execute(query)


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("--apply", action="store_true")
    parser.add_argument("--backup", type=Path)
    parser.add_argument("--restore", type=Path)
    args = parser.parse_args()
    if args.apply and not args.backup:
        parser.error("--apply requires --backup")
    if args.apply and args.restore:
        parser.error("--apply and --restore are mutually exclusive")
    targets = list(target_urls())
    if not targets:
        raise RuntimeError("No PostgreSQL targets configured")
    prepared = []
    for url in targets:
        with connect(url) as conn, conn.cursor() as cur:
            cur.execute("SELECT current_user, current_database(), version() LIKE '%mingw%' OR version() LIKE '%Visual C++%'")
            role, database, windows_server = cur.fetchone()
            cur.execute("SELECT name, setting, context FROM pg_settings WHERE name=ANY(%s)", (list(POLICY),))
            actual = {name: {"setting": value, "context": context} for name, value, context in cur.fetchall()}
            if set(actual) != set(POLICY) or any(v["context"] != "user" for v in actual.values()):
                raise RuntimeError("Session policy cannot be safely configured for this role")
            proposed = dict(POLICY)
            if windows_server:
                # PostgreSQL does not support TCP_KEEPCNT on Windows.
                proposed["tcp_keepalives_count"] = "0"
            prepared.append({"role": role, "database": database, "scoped_before": scoped_values(conn),
                             "effective_before": actual, "proposed": proposed})
    if args.apply:
        if args.backup.exists():
            raise RuntimeError("Refusing to overwrite rollback snapshot")
        args.backup.parent.mkdir(parents=True, exist_ok=True)
        args.backup.write_text(json.dumps(prepared, indent=2), encoding="utf-8")
    restore = json.loads(args.restore.read_text(encoding="utf-8")) if args.restore else None
    changed = []
    try:
        for url, plan in zip(targets, prepared):
            values = plan["proposed"]
            if restore is not None:
                saved = [p for p in restore if (p["role"], p["database"]) == (plan["role"], plan["database"])]
                if len(saved) != 1:
                    raise RuntimeError("Rollback target does not match configured role/database")
                values = saved[0]["scoped_before"]
            if args.apply or restore is not None:
                with connect(url) as conn:
                    if scoped_values(conn) != plan["scoped_before"]:
                        raise RuntimeError("Policy changed after preflight")
                    apply_values(conn, plan["role"], plan["database"], values)
                changed.append((url, plan))
                with connect(url) as conn:
                    if scoped_values(conn) != values:
                        raise RuntimeError("Policy verification failed")
            plan["applied"] = bool(args.apply or restore is not None)
    except Exception:
        for url, plan in reversed(changed):
            with connect(url) as conn:
                apply_values(conn, plan["role"], plan["database"], plan["scoped_before"])
        raise
    print(json.dumps(prepared, indent=2))


if __name__ == "__main__":
    try:
        main()
    except Exception as error:
        # DB driver exceptions can include credentials; never print their text.
        print(json.dumps({"error": type(error).__name__, "sqlstate": getattr(error, "sqlstate", None)}))
        raise SystemExit(1)
