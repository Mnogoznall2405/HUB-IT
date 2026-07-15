from __future__ import annotations

import argparse
import json
import sqlite3
import uuid
from pathlib import Path, PureWindowsPath
from typing import Any

try:
    from .backfill_scan_task_links import DEFAULT_DB_PATH, backup_database
except ImportError:
    from backfill_scan_task_links import DEFAULT_DB_PATH, backup_database


def _connect(db_path: Path) -> sqlite3.Connection:
    conn = sqlite3.connect(db_path, timeout=60)
    conn.row_factory = sqlite3.Row
    conn.execute("PRAGMA busy_timeout=60000")
    return conn


def repair_false_finding_observations(
    db_path: Path,
    *,
    apply: bool = False,
    create_backup: bool = True,
    task_id: str = "",
    hostname: str = "",
    source_backup: Path | None = None,
) -> dict[str, Any]:
    normalized_path = Path(db_path).resolve()
    if not normalized_path.exists():
        raise FileNotFoundError(f"Scan database not found: {normalized_path}")

    filter_task_id = str(task_id or "").strip()
    filter_hostname = str(hostname or "").strip()
    observation_scope = []
    observation_scope_params: list[Any] = []
    incident_scope = []
    incident_scope_params: list[Any] = []
    if filter_task_id:
        observation_scope.append("o.scan_task_id=?")
        observation_scope_params.append(filter_task_id)
        incident_scope.append("j.scan_task_id=?")
        incident_scope_params.append(filter_task_id)
    if filter_hostname:
        observation_scope.append("LOWER(o.hostname)=LOWER(?)")
        observation_scope_params.append(filter_hostname)
        incident_scope.append("LOWER(i.hostname)=LOWER(?)")
        incident_scope_params.append(filter_hostname)

    false_conditions = [
        "o.observation_type IN ('found_new', 'found_duplicate')",
        "TRIM(COALESCE(o.linked_incident_id, ''))=''",
        "j.status IN ('done_clean', 'failed')",
        "i.id IS NULL",
        *observation_scope,
    ]
    false_where_clause = " AND ".join(false_conditions)

    backup_path = None
    if apply and create_backup:
        backup_path = backup_database(normalized_path)

    with _connect(normalized_path) as conn:
        source_path = Path(source_backup).resolve() if source_backup else None
        if source_path:
            if not source_path.exists():
                raise FileNotFoundError(f"Repair source backup not found: {source_path}")
            conn.execute("ATTACH DATABASE ? AS repair_source", (str(source_path),))
        orphan_job_scope = []
        orphan_job_params: list[Any] = []
        if filter_task_id:
            orphan_job_scope.append("b.scan_task_id=?")
            orphan_job_params.append(filter_task_id)
        if filter_hostname:
            orphan_job_scope.append("LOWER(i.hostname)=LOWER(?)")
            orphan_job_params.append(filter_hostname)
        orphan_job_scope_sql = f" AND {' AND '.join(orphan_job_scope)}" if orphan_job_scope else ""
        restorable_jobs = 0
        if source_path:
            restorable_jobs = int(
                conn.execute(
                    f"""
                    SELECT COUNT(*)
                    FROM scan_incidents i
                    JOIN repair_source.scan_jobs b ON b.id=i.job_id
                    LEFT JOIN main.scan_jobs current ON current.id=i.job_id
                    WHERE current.id IS NULL {orphan_job_scope_sql}
                    """,
                    orphan_job_params,
                ).fetchone()[0]
            )
        orphan_scope_sql = ""
        orphan_scope_params: list[Any] = []
        if filter_task_id:
            orphan_scope_sql += " AND 1=0"
        if filter_hostname:
            orphan_scope_sql += " AND LOWER(i.hostname)=LOWER(?)"
            orphan_scope_params.append(filter_hostname)
        orphan_jobs = int(
            conn.execute(
                f"""
                SELECT COUNT(*)
                FROM scan_incidents i
                LEFT JOIN main.scan_jobs current ON current.id=i.job_id
                WHERE current.id IS NULL
                  {orphan_scope_sql}
                """,
                orphan_scope_params,
            ).fetchone()[0]
        )

        false_rows = conn.execute(
            f"""
            SELECT o.id, o.scan_task_id, o.hostname, o.observation_type, j.status AS job_status
            FROM scan_task_file_observations o
            JOIN scan_jobs j ON j.id=o.linked_job_id
            LEFT JOIN scan_incidents i ON i.job_id=j.id
            WHERE {false_where_clause}
            ORDER BY o.created_at, o.id
            """,
            observation_scope_params,
        ).fetchall()
        dangling_rows = conn.execute(
            f"""
            SELECT o.id
            FROM scan_task_file_observations o
            LEFT JOIN scan_incidents i ON i.id=o.linked_incident_id
            WHERE TRIM(COALESCE(o.linked_incident_id, ''))<>''
              AND i.id IS NULL
              {"AND " + " AND ".join(observation_scope) if observation_scope else ""}
            """,
            observation_scope_params,
        ).fetchall()

        restored_jobs = 0
        reconstructed_jobs = 0
        removed = 0
        observations_created = 0
        if apply:
            conn.execute("BEGIN IMMEDIATE")
            try:
                if source_path and restorable_jobs:
                    cursor = conn.execute(
                        f"""
                        INSERT OR IGNORE INTO main.scan_jobs
                        SELECT b.*
                        FROM scan_incidents i
                        JOIN repair_source.scan_jobs b ON b.id=i.job_id
                        LEFT JOIN main.scan_jobs current ON current.id=i.job_id
                        WHERE current.id IS NULL {orphan_job_scope_sql}
                        """,
                        orphan_job_params,
                    )
                    restored_jobs = int(cursor.rowcount or 0)

                orphan_incidents = conn.execute(
                    f"""
                    SELECT
                        i.job_id,
                        i.agent_id,
                        i.hostname,
                        i.branch,
                        i.user_login,
                        i.user_full_name,
                        i.file_path,
                        i.created_at
                    FROM scan_incidents i
                    LEFT JOIN main.scan_jobs current ON current.id=i.job_id
                    WHERE current.id IS NULL
                      {orphan_scope_sql}
                    """,
                    orphan_scope_params,
                ).fetchall()
                if orphan_incidents:
                    cursor = conn.executemany(
                        """
                        INSERT INTO scan_jobs(
                            id, agent_id, hostname, branch, user_login, user_full_name,
                            file_path, file_name, file_hash, file_size, source_kind, event_id,
                            scan_task_id, status, created_at, started_at, finished_at,
                            error_text, summary, attempt_count, payload_json
                        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, '', 0, 'unknown', NULL, NULL,
                                  'done_with_incident', ?, ?, ?, NULL, ?, 0, ?)
                        """,
                        [
                            (
                                str(row["job_id"] or ""),
                                str(row["agent_id"] or ""),
                                str(row["hostname"] or ""),
                                str(row["branch"] or ""),
                                str(row["user_login"] or ""),
                                str(row["user_full_name"] or ""),
                                str(row["file_path"] or ""),
                                PureWindowsPath(str(row["file_path"] or "")).name,
                                int(row["created_at"] or 0),
                                int(row["created_at"] or 0),
                                int(row["created_at"] or 0),
                                "Восстановлено из записи инцидента",
                                json.dumps(
                                    {"reconstructed_from_incident": True},
                                    ensure_ascii=False,
                                ),
                            )
                            for row in orphan_incidents
                        ],
                    )
                    reconstructed_jobs = int(cursor.rowcount or 0)

                removal_ids = {
                    str(row["id"])
                    for row in [*false_rows, *dangling_rows]
                    if str(row["id"] or "").strip()
                }
                if removal_ids:
                    cursor = conn.executemany(
                        "DELETE FROM scan_task_file_observations WHERE id=?",
                        [(observation_id,) for observation_id in sorted(removal_ids)],
                    )
                    removed = int(cursor.rowcount or 0)

                missing_rows = conn.execute(
                    f"""
                    SELECT
                        i.id AS incident_id,
                        i.severity,
                        i.created_at,
                        j.id AS job_id,
                        j.scan_task_id,
                        j.agent_id,
                        j.hostname,
                        j.file_path,
                        j.file_hash,
                        j.event_id,
                        j.source_kind
                    FROM scan_incidents i
                    JOIN scan_jobs j ON j.id=i.job_id
                    LEFT JOIN scan_task_file_observations o
                      ON o.linked_incident_id=i.id AND o.scan_task_id=j.scan_task_id
                    WHERE TRIM(COALESCE(j.scan_task_id, ''))<>''
                      AND o.id IS NULL
                      {"AND " + " AND ".join(incident_scope) if incident_scope else ""}
                    """,
                    incident_scope_params,
                ).fetchall()
                if missing_rows:
                    cursor = conn.executemany(
                        """
                        INSERT INTO scan_task_file_observations(
                            id, scan_task_id, agent_id, hostname, file_path, file_hash, event_id,
                            observation_type, linked_job_id, linked_incident_id, source_kind,
                            severity, created_at
                        ) VALUES (?, ?, ?, ?, ?, ?, ?, 'found_new', ?, ?, ?, ?, ?)
                        """,
                        [
                            (
                                uuid.uuid4().hex,
                                str(row["scan_task_id"] or ""),
                                str(row["agent_id"] or ""),
                                str(row["hostname"] or ""),
                                str(row["file_path"] or ""),
                                str(row["file_hash"] or ""),
                                str(row["event_id"] or ""),
                                str(row["job_id"] or ""),
                                str(row["incident_id"] or ""),
                                str(row["source_kind"] or ""),
                                str(row["severity"] or ""),
                                int(row["created_at"] or 0),
                            )
                            for row in missing_rows
                        ],
                    )
                    observations_created = int(cursor.rowcount or 0)
                conn.commit()
            except Exception:
                conn.rollback()
                raise
        else:
            missing_rows = conn.execute(
                f"""
                SELECT i.id
                FROM scan_incidents i
                JOIN scan_jobs j ON j.id=i.job_id
                LEFT JOIN scan_task_file_observations o
                  ON o.linked_incident_id=i.id AND o.scan_task_id=j.scan_task_id
                WHERE TRIM(COALESCE(j.scan_task_id, ''))<>''
                  AND o.id IS NULL
                  {"AND " + " AND ".join(incident_scope) if incident_scope else ""}
                """,
                incident_scope_params,
            ).fetchall()

    return {
        "mode": "apply" if apply else "dry-run",
        "db_path": str(normalized_path),
        "backup_path": str(backup_path) if backup_path else "",
        "task_id": filter_task_id,
        "hostname": filter_hostname,
        "matched": len(false_rows),
        "dangling_observations": len(dangling_rows),
        "missing_observations": len(missing_rows),
        "restorable_jobs": restorable_jobs,
        "orphan_jobs": orphan_jobs,
        "restored_jobs": restored_jobs,
        "reconstructed_jobs": reconstructed_jobs,
        "removed": removed,
        "observations_created": observations_created,
    }


def main() -> int:
    parser = argparse.ArgumentParser(
        description="Remove final clean/failed jobs incorrectly recorded as scan findings.",
    )
    parser.add_argument("--db", type=Path, default=DEFAULT_DB_PATH)
    parser.add_argument("--apply", action="store_true")
    parser.add_argument("--task-id", default="")
    parser.add_argument("--hostname", default="")
    parser.add_argument("--source-backup", type=Path)
    parser.add_argument("--all", action="store_true")
    args = parser.parse_args()
    if args.apply and not args.all and not str(args.task_id).strip() and not str(args.hostname).strip():
        raise SystemExit("Refusing unscoped apply: pass --task-id, --hostname, or explicit --all")

    result = repair_false_finding_observations(
        args.db,
        apply=bool(args.apply),
        task_id=str(args.task_id).strip(),
        hostname=str(args.hostname).strip(),
        source_backup=args.source_backup,
    )
    print(f"Mode: {result['mode']}")
    print(f"Database: {result['db_path']}")
    if result["backup_path"]:
        print(f"Backup: {result['backup_path']}")
    print(f"Matched false observations: {result['matched']}")
    print(f"Dangling observations: {result['dangling_observations']}")
    print(f"Missing observations: {result['missing_observations']}")
    print(f"Restorable jobs: {result['restorable_jobs']}")
    print(f"Orphan jobs: {result['orphan_jobs']}")
    print(f"Restored jobs: {result['restored_jobs']}")
    print(f"Reconstructed jobs: {result['reconstructed_jobs']}")
    print(f"Removed false observations: {result['removed']}")
    print(f"Created observations: {result['observations_created']}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
