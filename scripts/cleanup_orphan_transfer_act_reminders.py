"""Remove transfer-act reminders without Hub tasks; dry-run unless --apply.

Uses only the configured PostgreSQL app schema. The JSON backup contains complete
rows for rollback (restore reminders first, then groups, in one transaction).
No tasks, uploaded documents, or files are deleted.
"""
from __future__ import annotations

import argparse
import json
from datetime import datetime, timezone
from pathlib import Path

from dotenv import dotenv_values
from sqlalchemy import create_engine, text
from sqlalchemy.engine import make_url


ROOT = Path(__file__).resolve().parents[1]
ORPHAN = "NOT EXISTS (SELECT 1 FROM app.hub_tasks t WHERE t.id = r.task_id)"


def run(*, apply: bool = False) -> dict:
    values = dotenv_values(ROOT / ".env")
    url = values.get("APP_DATABASE_URL") or values.get("CHAT_DATABASE_URL")
    if not url or make_url(url).get_backend_name() != "postgresql":
        raise RuntimeError("Expected configured PostgreSQL app database")
    engine = create_engine(url, isolation_level="SERIALIZABLE", connect_args={
        "connect_timeout": 8,
        "options": "-c statement_timeout=15000 -c lock_timeout=3000"
                   + ("" if apply else " -c default_transaction_read_only=on"),
    })
    with engine.begin() as conn:
        if apply and not conn.execute(text(
            "SELECT pg_try_advisory_xact_lock(20260908, 101681)"
        )).scalar_one():
            raise RuntimeError("Another cleanup is running")
        # Verify the actual schema, including inbound foreign keys, before deletion.
        tables = conn.execute(text("""
            SELECT table_schema, table_name FROM information_schema.tables
            WHERE table_name IN ('equipment_transfer_act_reminders',
                'equipment_transfer_act_reminder_groups', 'hub_tasks')
        """)).mappings().all()
        if len(tables) != 3 or any(row["table_schema"] != "app" for row in tables):
            raise RuntimeError("Unexpected table schema; inspect before cleanup")
        foreign_keys = conn.execute(text("""
            SELECT conrelid::regclass::text AS source_table
            FROM pg_constraint WHERE contype = 'f'
            AND confrelid IN ('app.equipment_transfer_act_reminders'::regclass,
                             'app.equipment_transfer_act_reminder_groups'::regclass)
        """)).scalars().all()
        if any(name not in ('app.equipment_transfer_act_reminder_groups',
                            'equipment_transfer_act_reminder_groups') for name in foreign_keys):
            raise RuntimeError("Unexpected inbound foreign key; inspect before cleanup")
        rows = [dict(row) for row in conn.execute(text(
            f"SELECT r.* FROM app.equipment_transfer_act_reminders r WHERE {ORPHAN} "
            "ORDER BY r.reminder_id" + (" FOR UPDATE" if apply else "")
        )).mappings()]
        if len(rows) > 1000:
            raise RuntimeError("More than 1000 candidates; review scope before cleanup")
        groups = [dict(row) for row in conn.execute(text(f"""
            SELECT g.* FROM app.equipment_transfer_act_reminder_groups g
            JOIN app.equipment_transfer_act_reminders r ON r.reminder_id=g.reminder_id
            WHERE {ORPHAN} ORDER BY g.id
        """)).mappings()]
        result = {"apply": apply, "reminders": len(rows), "groups": len(groups)}
        if not apply or not rows:
            return result

        def active_rows():
            return [dict(row) for row in conn.execute(text("""
                SELECT r.reminder_id, to_jsonb(r)::text AS reminder,
                       to_jsonb(g)::text AS reminder_group
                FROM app.equipment_transfer_act_reminders r
                JOIN app.hub_tasks t ON t.id=r.task_id
                LEFT JOIN app.equipment_transfer_act_reminder_groups g
                    ON g.reminder_id=r.reminder_id
                ORDER BY r.reminder_id, g.id
            """)).mappings()]

        active_before = active_rows()
        backup_dir = ROOT / "deploy_backups" / "data"
        backup_dir.mkdir(parents=True, exist_ok=True)
        backup = backup_dir / ("orphan-transfer-reminders-" +
            datetime.now(timezone.utc).strftime("%Y%m%dT%H%M%S%fZ") + ".json")
        payload = {"schema": "app", "reminders": rows, "groups": groups}
        with backup.open("x", encoding="utf-8") as stream:
            json.dump(payload, stream, ensure_ascii=False, indent=2)
            stream.flush()
            import os
            os.fsync(stream.fileno())
        if json.loads(backup.read_text(encoding="utf-8")) != payload:
            raise RuntimeError("Backup verification failed")
        deleted_reminders = deleted_groups = 0
        for start in range(0, len(rows), 100):
            ids = [row["reminder_id"] for row in rows[start:start + 100]]
            deleted_groups += conn.execute(text(f"""
                DELETE FROM app.equipment_transfer_act_reminder_groups g
                USING app.equipment_transfer_act_reminders r
                WHERE g.reminder_id=r.reminder_id AND r.reminder_id=ANY(:ids)
                  AND {ORPHAN}
            """), {"ids": ids}).rowcount
            deleted_reminders += conn.execute(text(f"""
                DELETE FROM app.equipment_transfer_act_reminders r
                WHERE r.reminder_id=ANY(:ids) AND {ORPHAN}
            """), {"ids": ids}).rowcount
        if (deleted_reminders, deleted_groups) != (len(rows), len(groups)):
            raise RuntimeError("Deletion count changed; rolling back")
        if active_rows() != active_before:
            raise RuntimeError("Active reminder data changed; rolling back")
        result.update(backup=str(backup), active_rows_preserved=len(active_before))
    engine.dispose()
    return result


if __name__ == "__main__":
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--apply", action="store_true")
    args = parser.parse_args()
    try:
        print(json.dumps(run(apply=args.apply), ensure_ascii=False))
    except Exception as exc:
        # Driver exceptions can contain connection details; do not print them.
        print(json.dumps({"error": type(exc).__name__, "committed": False}))
        raise SystemExit(1)
