#!/usr/bin/env python3
"""Collect HUB-IT platform metrics for competition report (readonly SELECT)."""
from __future__ import annotations

import json
import sqlite3
import sys
from datetime import datetime, timezone
from pathlib import Path
from typing import Any

from sqlalchemy import text

ROOT = Path(__file__).resolve().parents[2]
WEB_ROOT = ROOT / "WEB-itinvent"
sys.path.insert(0, str(WEB_ROOT))

OUTPUT = ROOT / "documentation" / "user-guides" / "_hub_platform_metrics_snapshot.json"
PERIOD_START = "2025-01-01"
SCAN_DB = ROOT / "data" / "scan_server" / "scan_server.db"


def _utcnow_iso() -> str:
    return datetime.now(timezone.utc).replace(microsecond=0).isoformat()


def _safe_count(engine, sql: str, params: dict | None = None) -> int | None:
    try:
        with engine.connect() as conn:
            value = conn.execute(text(sql), params or {}).scalar()
            return int(value or 0)
    except Exception as exc:
        return {"error": str(exc)}  # type: ignore[return-value]


def _collect_postgres_metrics() -> dict[str, Any]:
    from backend.appdb.db import get_app_engine, is_app_database_configured

    if not is_app_database_configured():
        return {"configured": False, "error": "APP_DATABASE_URL is not configured"}

    engine = get_app_engine()
    dialect = str(engine.dialect.name).lower()
    metrics: dict[str, Any] = {"configured": True, "dialect": dialect}

    queries: dict[str, str] = {
        "users_total": "SELECT COUNT(*) FROM app.users",
        "users_with_telegram": (
            "SELECT COUNT(DISTINCT telegram_id) FROM app.user_db_selection "
            "WHERE telegram_id IS NOT NULL"
        ),
        "active_users_since_2025": (
            "SELECT COUNT(DISTINCT user_id) FROM app.sessions "
            "WHERE created_at >= :period_start"
        ),
        "departments_total": "SELECT COUNT(*) FROM app.departments",
        "hub_tasks_total": "SELECT COUNT(*) FROM app.hub_tasks",
        "hub_tasks_done": (
            "SELECT COUNT(*) FROM app.hub_tasks WHERE status = 'done' OR completed_at IS NOT NULL"
        ),
        "hub_tasks_since_2025": (
            "SELECT COUNT(*) FROM app.hub_tasks WHERE created_at >= :period_start"
        ),
        "hub_task_comments": "SELECT COUNT(*) FROM app.hub_task_comments",
        "hub_announcements": "SELECT COUNT(*) FROM app.hub_announcements",
        "hub_task_projects": "SELECT COUNT(*) FROM app.hub_task_projects",
        "my_files_total": "SELECT COUNT(*) FROM app.my_files",
        "password_vault_entries": (
            "SELECT COUNT(*) FROM app.password_vault_entries WHERE is_archived = FALSE"
        ),
        "inventory_hosts_total": "SELECT COUNT(*) FROM app.inventory_hosts",
        "inventory_hosts_recent": (
            "SELECT COUNT(*) FROM app.inventory_hosts "
            "WHERE last_seen_at IS NOT NULL AND last_seen_at >= EXTRACT(EPOCH FROM NOW() - INTERVAL '7 days')"
        ),
        "ticket_requests_total": "SELECT COUNT(*) FROM app.ticket_requests",
        "mail_messages_log": "SELECT COUNT(*) FROM app.mail_messages_log",
        "kb_articles": (
            "SELECT COUNT(*) FROM app.json_records WHERE file_name = 'kb_articles.json'"
        ),
        "equipment_transfers": (
            "SELECT COUNT(*) FROM app.json_records WHERE file_name = 'equipment_transfers.json'"
        ),
        "pc_cleanings": (
            "SELECT COUNT(*) FROM app.json_records WHERE file_name = 'pc_cleanings.json'"
        ),
        "battery_replacements": (
            "SELECT COUNT(*) FROM app.json_records WHERE file_name = 'battery_replacements.json'"
        ),
        "component_replacements": (
            "SELECT COUNT(*) FROM app.json_records WHERE file_name = 'component_replacements.json'"
        ),
    }

    if dialect == "sqlite":
        queries = {
            key: sql.replace("app.", "")
            for key, sql in queries.items()
        }

    params = {"period_start": PERIOD_START}
    for key, sql in queries.items():
        result = _safe_count(engine, sql, params)
        metrics[key] = result

    chat_queries = {
        "chat_conversations": "SELECT COUNT(*) FROM chat.chat_conversations",
        "chat_messages": "SELECT COUNT(*) FROM chat.chat_messages",
        "chat_messages_since_2025": (
            "SELECT COUNT(*) FROM chat.chat_messages WHERE created_at >= :period_start"
        ),
    }
    if dialect == "sqlite":
        chat_queries = {k: v.replace("chat.", "") for k, v in chat_queries.items()}

    for key, sql in chat_queries.items():
        try:
            with engine.connect() as conn:
                metrics[key] = int(conn.execute(text(sql), params).scalar() or 0)
        except Exception:
            metrics[key] = None

    return metrics


def _collect_scan_metrics() -> dict[str, Any]:
    if not SCAN_DB.exists():
        return {"configured": False, "path": str(SCAN_DB)}

    try:
        conn = sqlite3.connect(SCAN_DB)
        cur = conn.cursor()
        tables = {
            "scan_agents": "SELECT COUNT(*) FROM scan_agents",
            "scan_incidents": "SELECT COUNT(*) FROM scan_incidents",
            "scan_jobs": "SELECT COUNT(*) FROM scan_jobs",
        }
        result: dict[str, Any] = {"configured": True, "path": str(SCAN_DB)}
        for key, sql in tables.items():
            try:
                result[key] = int(cur.execute(sql).fetchone()[0])
            except Exception as exc:
                result[key] = {"error": str(exc)}
        conn.close()
        return result
    except Exception as exc:
        return {"configured": False, "error": str(exc), "path": str(SCAN_DB)}


def main() -> None:
    snapshot = {
        "generated_at": _utcnow_iso(),
        "period_start": PERIOD_START,
        "period_note": "С запуска платформы по дату формирования отчёта",
        "postgres": _collect_postgres_metrics(),
        "scan_center": _collect_scan_metrics(),
    }
    OUTPUT.parent.mkdir(parents=True, exist_ok=True)
    OUTPUT.write_text(json.dumps(snapshot, ensure_ascii=False, indent=2), encoding="utf-8")
    print(f"Written: {OUTPUT}")
    print(json.dumps(snapshot, ensure_ascii=False, indent=2))


if __name__ == "__main__":
    main()
