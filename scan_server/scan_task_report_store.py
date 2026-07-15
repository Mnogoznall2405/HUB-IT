from __future__ import annotations

import json
from typing import Any, Callable, Dict, List, Optional


def _json_loads(value: Any, default: Any) -> Any:
    text = str(value or "").strip()
    if not text:
        return default
    try:
        return json.loads(text)
    except Exception:
        return default


def _file_ext_from_values(file_name: Any, file_path: Any) -> str:
    raw_name = str(file_name or "").strip()
    raw_path = str(file_path or "").strip()
    candidate = raw_name or raw_path
    if not candidate:
        return ""
    name_part = candidate.replace("\\", "/").split("/")[-1]
    if "." not in name_part:
        return ""
    return name_part.rsplit(".", 1)[-1].strip().lower()


class ScanTaskIncidentReportStore:
    def __init__(
        self,
        *,
        lock: Any,
        connect: Callable[[], Any],
        serialize_task_row: Callable[..., Dict[str, Any]],
        now: Callable[[], int],
    ) -> None:
        self._lock = lock
        self._connect = connect
        self._serialize_task_row = serialize_task_row
        self._now = now

    def get_scan_task_incident_report(self, *, task_id: str) -> Optional[Dict[str, Any]]:
        normalized_task_id = str(task_id or "").strip()
        if not normalized_task_id:
            return None
        now_ts = self._now()
        with self._lock, self._connect() as conn:
            task_row = conn.execute(
                """
                SELECT
                    t.*,
                    COALESCE(
                        NULLIF(a.hostname, ''),
                        (
                            SELECT j.hostname
                            FROM scan_jobs j
                            WHERE j.scan_task_id=t.id AND j.hostname <> ''
                            ORDER BY j.created_at DESC
                            LIMIT 1
                        ),
                        (
                            SELECT o.hostname
                            FROM scan_task_file_observations o
                            WHERE o.scan_task_id=t.id AND o.hostname <> ''
                            ORDER BY o.created_at DESC
                            LIMIT 1
                        ),
                        ''
                    ) AS hostname
                FROM scan_tasks t
                LEFT JOIN scan_agents a ON a.agent_id=t.agent_id
                WHERE t.id=? AND t.command='scan_now'
                LIMIT 1
                """,
                (normalized_task_id,),
            ).fetchone()
            if task_row is None:
                return None

            job_counts_row = conn.execute(
                """
                SELECT
                    COUNT(*) AS jobs_total,
                    SUM(CASE WHEN status IN ('queued', 'processing') THEN 1 ELSE 0 END) AS jobs_pending,
                    SUM(CASE WHEN status='done_clean' THEN 1 ELSE 0 END) AS jobs_done_clean,
                    SUM(CASE WHEN status='done_with_incident' THEN 1 ELSE 0 END) AS jobs_done_with_incident,
                    SUM(CASE WHEN status='analysis_incomplete' THEN 1 ELSE 0 END) AS jobs_incomplete,
                    SUM(CASE WHEN status='failed' THEN 1 ELSE 0 END) AS jobs_failed
                FROM scan_jobs
                WHERE scan_task_id=?
                """,
                (normalized_task_id,),
            ).fetchone()
            observation_counts_row = conn.execute(
                """
                SELECT
                    SUM(CASE WHEN observation_type='found_new' THEN 1 ELSE 0 END) AS found_new,
                    SUM(CASE WHEN observation_type='found_duplicate' THEN 1 ELSE 0 END) AS found_duplicate,
                    SUM(CASE WHEN observation_type='deleted' THEN 1 ELSE 0 END) AS deleted_count,
                    SUM(CASE WHEN observation_type='cleaned' THEN 1 ELSE 0 END) AS cleaned_count,
                    SUM(CASE WHEN observation_type='moved' THEN 1 ELSE 0 END) AS moved_count,
                    COUNT(*) AS observations_total
                FROM scan_task_file_observations
                WHERE scan_task_id=?
                """,
                (normalized_task_id,),
            ).fetchone()
            observation_rows = conn.execute(
                """
                SELECT
                    id,
                    scan_task_id,
                    agent_id,
                    hostname,
                    file_path,
                    file_hash,
                    event_id,
                    observation_type,
                    linked_job_id,
                    linked_incident_id,
                    source_kind,
                    severity,
                    created_at
                FROM scan_task_file_observations
                WHERE scan_task_id=?
                ORDER BY created_at DESC
                """,
                (normalized_task_id,),
            ).fetchall()
            observations = [dict(row) for row in observation_rows]
            observation_map: Dict[str, Dict[str, Any]] = {}
            for row in observation_rows:
                incident_id = str(row["linked_incident_id"] or "").strip()
                if not incident_id:
                    continue
                entry = observation_map.setdefault(
                    incident_id,
                    {"types": [], "created_at": 0},
                )
                obs_type = str(row["observation_type"] or "").strip()
                if obs_type and obs_type not in entry["types"]:
                    entry["types"].append(obs_type)
                entry["created_at"] = max(int(entry["created_at"] or 0), int(row["created_at"] or 0))

            incident_rows = conn.execute(
                """
                SELECT
                    i.*,
                    f.category,
                    f.short_reason,
                    f.matched_patterns_json,
                    j.source_kind,
                    j.file_name,
                    j.file_hash,
                    j.file_size,
                    j.event_id,
                    j.scan_task_id,
                    j.status AS job_status,
                    j.created_at AS job_created_at,
                    j.started_at AS job_started_at,
                    j.finished_at AS job_finished_at
                FROM scan_incidents i
                LEFT JOIN scan_findings f ON f.id=i.finding_id
                LEFT JOIN scan_jobs j ON j.id=i.job_id
                WHERE
                    j.scan_task_id=?
                    OR i.id IN (
                        SELECT linked_incident_id
                        FROM scan_task_file_observations
                        WHERE scan_task_id=? AND linked_incident_id <> ''
                    )
                ORDER BY i.created_at DESC
                """,
                (normalized_task_id, normalized_task_id),
            ).fetchall()

        task = self._serialize_task_row(task_row, now_ts=now_ts)
        task["hostname"] = str(task_row["hostname"] or "").strip()

        incidents: List[Dict[str, Any]] = []
        severity_counts: Dict[str, int] = {}
        status_counts: Dict[str, int] = {}
        seen_incident_ids = set()
        for row in incident_rows:
            item = dict(row)
            incident_id = str(item.get("id") or "").strip()
            if incident_id in seen_incident_ids:
                continue
            seen_incident_ids.add(incident_id)
            observation_entry = observation_map.get(incident_id, {})
            observation_types = ", ".join(observation_entry.get("types") or [])
            item["matched_patterns"] = _json_loads(item.pop("matched_patterns_json", "[]"), [])
            item["file_ext"] = _file_ext_from_values(item.get("file_name"), item.get("file_path"))
            item["observation_types"] = observation_types or (
                "found_new" if str(item.get("scan_task_id") or "") == normalized_task_id else ""
            )
            item["observation_created_at"] = int(observation_entry.get("created_at") or item.get("created_at") or 0)
            severity = str(item.get("severity") or "none").strip().lower() or "none"
            status_value = str(item.get("status") or "").strip().lower()
            severity_counts[severity] = int(severity_counts.get(severity, 0) + 1)
            status_counts[status_value] = int(status_counts.get(status_value, 0) + 1)
            incidents.append(item)

        scan_started_at = int(task.get("created_at") or 0)
        scan_finished_at = int(task.get("completed_at") or task.get("updated_at") or 0)
        result = task.get("result") if isinstance(task.get("result"), dict) else {}
        db_jobs_total = int((job_counts_row or {})["jobs_total"] or 0)
        db_jobs_pending = int((job_counts_row or {})["jobs_pending"] or 0)
        db_jobs_clean = int((job_counts_row or {})["jobs_done_clean"] or 0)
        db_jobs_with_incident = int((job_counts_row or {})["jobs_done_with_incident"] or 0)
        db_jobs_incomplete = int((job_counts_row or {})["jobs_incomplete"] or 0)
        db_jobs_failed = int((job_counts_row or {})["jobs_failed"] or 0)
        task_is_final = str(task.get("status") or "").strip().lower() in {"completed", "failed", "expired"}
        if task_is_final:
            jobs_pending = db_jobs_pending
            jobs_clean = max(db_jobs_clean, int(result.get("jobs_done_clean") or 0))
            jobs_with_incident = max(
                db_jobs_with_incident,
                int(result.get("jobs_done_with_incident") or 0),
            )
            jobs_failed = max(db_jobs_failed, int(result.get("jobs_failed") or 0))
            jobs_incomplete = max(db_jobs_incomplete, int(result.get("jobs_incomplete") or 0))
            jobs_total = max(
                db_jobs_total,
                int(result.get("jobs_total") or 0),
                jobs_pending + jobs_clean + jobs_with_incident + jobs_incomplete + jobs_failed,
            )
        else:
            jobs_total = db_jobs_total
            jobs_pending = db_jobs_pending
            jobs_clean = db_jobs_clean
            jobs_with_incident = db_jobs_with_incident
            jobs_failed = db_jobs_failed
            jobs_incomplete = db_jobs_incomplete
        summary = {
            "hostname": task.get("hostname") or "",
            "scan_started_at": scan_started_at,
            "scan_finished_at": scan_finished_at,
            "jobs_total": jobs_total,
            "jobs_pending": jobs_pending,
            "jobs_done_clean": jobs_clean,
            "jobs_done_with_incident": jobs_with_incident,
            "jobs_failed": jobs_failed,
            "jobs_incomplete": jobs_incomplete,
            "found_new": int((observation_counts_row or {})["found_new"] or 0),
            "found_duplicate": int((observation_counts_row or {})["found_duplicate"] or 0),
            "deleted": int((observation_counts_row or {})["deleted_count"] or 0),
            "cleaned": int((observation_counts_row or {})["cleaned_count"] or 0),
            "moved": int((observation_counts_row or {})["moved_count"] or 0),
            "observations_total": int((observation_counts_row or {})["observations_total"] or 0),
            "incidents_total": len(incidents),
            "severity_counts": severity_counts,
            "status_counts": status_counts,
        }
        return {
            "task": task,
            "summary": summary,
            "incidents": incidents,
            "observations": observations,
        }
