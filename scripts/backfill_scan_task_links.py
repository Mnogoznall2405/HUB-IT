from __future__ import annotations

import argparse
import sqlite3
import uuid
from collections import defaultdict
from datetime import datetime
from pathlib import Path
from typing import Any


PROJECT_ROOT = Path(__file__).resolve().parent.parent
DEFAULT_DB_PATH = PROJECT_ROOT / "data" / "scan_server" / "scan_server.db"


def _connect(db_path: Path) -> sqlite3.Connection:
    conn = sqlite3.connect(db_path, timeout=60)
    conn.row_factory = sqlite3.Row
    conn.execute("PRAGMA busy_timeout=60000")
    return conn


def backup_database(db_path: Path) -> Path:
    timestamp = datetime.now().strftime("%Y%m%d_%H%M%S")
    backup_path = db_path.with_name(f"{db_path.name}.before-task-link-backfill-{timestamp}.bak")
    with _connect(db_path) as source, sqlite3.connect(backup_path) as destination:
        source.backup(destination)
    return backup_path


def _load_candidates(
    conn: sqlite3.Connection,
    grace_seconds: int,
    *,
    task_id: str = "",
    hostname: str = "",
) -> list[dict[str, Any]]:
    task_where = " AND id=?" if task_id else ""
    task_params = (task_id,) if task_id else ()
    task_rows = conn.execute(
        f"""
        SELECT id, agent_id, created_at, COALESCE(completed_at, updated_at, created_at) AS finished_at
        FROM scan_tasks
        WHERE command='scan_now'{task_where}
        ORDER BY agent_id, created_at
        """,
        task_params,
    ).fetchall()
    tasks_by_agent: dict[str, list[sqlite3.Row]] = defaultdict(list)
    for row in task_rows:
        tasks_by_agent[str(row["agent_id"] or "").strip()].append(row)

    job_where = " AND LOWER(j.hostname)=LOWER(?)" if hostname else ""
    job_params = (hostname,) if hostname else ()
    job_rows = conn.execute(
        f"""
        SELECT
            j.*,
            i.id AS incident_id,
            i.severity AS incident_severity
        FROM scan_jobs j
        LEFT JOIN scan_incidents i ON i.job_id=j.id
        WHERE TRIM(COALESCE(j.scan_task_id, ''))=''
        {job_where}
        ORDER BY j.created_at, j.id
        """,
        job_params,
    ).fetchall()

    candidates: list[dict[str, Any]] = []
    for job in job_rows:
        agent_id = str(job["agent_id"] or "").strip()
        created_at = int(job["created_at"] or 0)
        direct_tasks = [
            task
            for task in tasks_by_agent.get(agent_id, [])
            if int(task["created_at"] or 0) <= created_at
            <= int(task["finished_at"] or task["created_at"] or 0)
        ]
        if direct_tasks:
            task = max(direct_tasks, key=lambda row: int(row["created_at"] or 0))
        else:
            late_tasks = [
                task
                for task in tasks_by_agent.get(agent_id, [])
                if int(task["finished_at"] or task["created_at"] or 0) < created_at
                <= int(task["finished_at"] or task["created_at"] or 0) + grace_seconds
            ]
            if not late_tasks:
                continue
            task = max(late_tasks, key=lambda row: int(row["finished_at"] or row["created_at"] or 0))
        candidates.append(
            {
                "job": dict(job),
                "task_id": str(task["id"] or "").strip(),
                "task_created_at": int(task["created_at"] or 0),
                "task_finished_at": int(task["finished_at"] or 0),
            }
        )
    return candidates


def backfill_scan_task_links(
    db_path: Path,
    *,
    apply: bool = False,
    grace_hours: int = 48,
    create_backup: bool = True,
    task_id: str = "",
    hostname: str = "",
) -> dict[str, Any]:
    normalized_path = Path(db_path).resolve()
    if not normalized_path.exists():
        raise FileNotFoundError(f"Scan database not found: {normalized_path}")
    grace_seconds = max(0, int(grace_hours)) * 60 * 60
    filter_task_id = str(task_id or "").strip()
    filter_hostname = str(hostname or "").strip()
    backup_path: Path | None = None
    if apply and create_backup:
        backup_path = backup_database(normalized_path)

    with _connect(normalized_path) as conn:
        candidates = _load_candidates(
            conn,
            grace_seconds,
            task_id=filter_task_id,
            hostname=filter_hostname,
        )
        by_task: dict[str, dict[str, Any]] = {}
        for candidate in candidates:
            task_id = candidate["task_id"]
            job = candidate["job"]
            entry = by_task.setdefault(
                task_id,
                {
                    "task_id": task_id,
                    "agent_id": str(job.get("agent_id") or ""),
                    "hostname": str(job.get("hostname") or ""),
                    "jobs": 0,
                    "observations": 0,
                },
            )
            entry["jobs"] += 1

        observations_created = 0
        observations_reassigned = 0
        jobs_updated = 0
        if apply and candidates:
            conn.execute("BEGIN IMMEDIATE")
            try:
                for candidate in candidates:
                    job = candidate["job"]
                    task_id = candidate["task_id"]
                    job_id = str(job.get("id") or "")
                    update_cursor = conn.execute(
                        """
                        UPDATE scan_jobs
                        SET scan_task_id=?
                        WHERE id=? AND TRIM(COALESCE(scan_task_id, ''))=''
                        """,
                        (task_id, job_id),
                    )
                    if int(update_cursor.rowcount or 0) != 1:
                        continue
                    jobs_updated += 1
                    incident_id = str(job.get("incident_id") or "").strip()
                    if not incident_id:
                        continue
                    existing_observation = conn.execute(
                        """
                        SELECT id
                        FROM scan_task_file_observations
                        WHERE linked_job_id=?
                        LIMIT 1
                        """,
                        (job_id,),
                    ).fetchone()
                    if existing_observation is not None:
                        conn.execute(
                            """
                            UPDATE scan_task_file_observations
                            SET scan_task_id=?,
                                linked_incident_id=CASE
                                    WHEN linked_incident_id='' THEN ?
                                    ELSE linked_incident_id
                                END,
                                severity=CASE
                                    WHEN severity='' THEN ?
                                    ELSE severity
                                END
                            WHERE linked_job_id=?
                            """,
                            (
                                task_id,
                                incident_id,
                                str(job.get("incident_severity") or ""),
                                job_id,
                            ),
                        )
                        observations_reassigned += 1
                        continue
                    conn.execute(
                        """
                        INSERT INTO scan_task_file_observations(
                            id, scan_task_id, agent_id, hostname, file_path, file_hash, event_id,
                            observation_type, linked_job_id, linked_incident_id, source_kind, severity, created_at
                        ) VALUES (?, ?, ?, ?, ?, ?, ?, 'found_new', ?, ?, ?, ?, ?)
                        """,
                        (
                            uuid.uuid4().hex,
                            task_id,
                            str(job.get("agent_id") or ""),
                            str(job.get("hostname") or ""),
                            str(job.get("file_path") or ""),
                            str(job.get("file_hash") or ""),
                            str(job.get("event_id") or ""),
                            job_id,
                            incident_id,
                            str(job.get("source_kind") or ""),
                            str(job.get("incident_severity") or ""),
                            int(job.get("created_at") or 0),
                        ),
                    )
                    observations_created += 1
                    by_task[task_id]["observations"] += 1
                conn.commit()
            except Exception:
                conn.rollback()
                raise

    return {
        "mode": "apply" if apply else "dry-run",
        "db_path": str(normalized_path),
        "backup_path": str(backup_path) if backup_path else "",
        "grace_hours": int(grace_hours),
        "task_id": filter_task_id,
        "hostname": filter_hostname,
        "jobs_matched": len(candidates),
        "jobs_updated": jobs_updated,
        "observations_created": observations_created,
        "observations_reassigned": observations_reassigned,
        "tasks": list(by_task.values()),
    }


def _parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(
        description="Backfill scan_task_id and observations for late scan jobs.",
    )
    parser.add_argument("--db", type=Path, default=DEFAULT_DB_PATH, help="Path to scan_server.db")
    parser.add_argument("--apply", action="store_true", help="Apply changes; default is dry-run")
    parser.add_argument("--grace-hours", type=int, default=48, help="Late delivery window after task finish")
    parser.add_argument("--task-id", default="", help="Limit backfill to one scan task")
    parser.add_argument("--hostname", default="", help="Limit candidate jobs to one hostname")
    parser.add_argument("--all", action="store_true", help="Allow an unscoped apply across all tasks")
    return parser.parse_args()


def main() -> int:
    args = _parse_args()
    if args.apply and not args.all and not str(args.task_id or "").strip() and not str(args.hostname or "").strip():
        raise SystemExit("Refusing unscoped apply: pass --task-id, --hostname, or explicit --all")
    result = backfill_scan_task_links(
        args.db,
        apply=bool(args.apply),
        grace_hours=max(0, int(args.grace_hours)),
        task_id=str(args.task_id or "").strip(),
        hostname=str(args.hostname or "").strip(),
    )
    print(f"Mode: {result['mode']}")
    print(f"Database: {result['db_path']}")
    if result["backup_path"]:
        print(f"Backup: {result['backup_path']}")
    print(f"Matched jobs: {result['jobs_matched']}")
    print(f"Updated jobs: {result['jobs_updated']}")
    print(f"Created observations: {result['observations_created']}")
    print(f"Reassigned observations: {result['observations_reassigned']}")
    for item in result["tasks"]:
        print(
            f"- task={item['task_id']} host={item['hostname'] or '-'} "
            f"agent={item['agent_id'] or '-'} jobs={item['jobs']}"
        )
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
