from __future__ import annotations

from typing import Any, Callable, Dict, List, Optional


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


def _normalize_sort_dir(value: Any) -> str:
    return "asc" if str(value or "").strip().lower() == "asc" else "desc"


def _severity_rank_to_label(rank: Any) -> str:
    rank_value = int(rank or 0)
    if rank_value >= 3:
        return "high"
    if rank_value == 2:
        return "medium"
    if rank_value == 1:
        return "low"
    return "none"


class ScanHostReadStore:
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

    def list_hosts(
        self,
        *,
        q: Optional[str] = None,
        branch: Optional[str] = None,
        status: Optional[str] = None,
        severity: Optional[str] = None,
        limit: int = 200,
    ) -> List[Dict[str, Any]]:
        response = self.list_hosts_table(
            q=q,
            branch=branch,
            status=status,
            severity=severity,
            limit=limit,
            offset=0,
            sort_by="incidents_new",
            sort_dir="desc",
        )
        return response["items"]

    def list_hosts_table(
        self,
        *,
        q: Optional[str] = None,
        branch: Optional[str] = None,
        status: Optional[str] = None,
        severity: Optional[str] = None,
        limit: int = 50,
        offset: int = 0,
        sort_by: Optional[str] = None,
        sort_dir: Optional[str] = None,
    ) -> Dict[str, Any]:
        conditions: List[str] = []
        params: List[Any] = []

        if status:
            conditions.append("LOWER(i.status) = ?")
            params.append(str(status).strip().lower())
        if severity:
            conditions.append("LOWER(i.severity) = ?")
            params.append(str(severity).strip().lower())

        where_clause = f"WHERE {' AND '.join(conditions)}" if conditions else ""
        safe_limit = max(1, min(500, int(limit)))
        safe_offset = max(0, int(offset))
        normalized_sort_by = str(sort_by or "").strip().lower() or "incidents_new"
        normalized_sort_dir = _normalize_sort_dir(sort_dir)
        branch_needle = str(branch or "").strip().casefold()
        q_needle = str(q or "").strip().casefold()
        sort_map = {
            "hostname": "LOWER(host.hostname)",
            "branch": "LOWER(branch)",
            "user": "LOWER(user)",
            "ip_address": "LOWER(ip_address)",
            "incidents_total": "host.incidents_total",
            "incidents_new": "host.incidents_new",
            "severity": "host.top_severity_rank",
            "last_incident_at": "host.last_incident_at",
        }
        order_expr = sort_map.get(normalized_sort_by, "host.incidents_new")
        if normalized_sort_by == "incidents_new":
            order_clause = (
                f"{order_expr} {normalized_sort_dir.upper()}, "
                f"host.top_severity_rank DESC, "
                "host.last_incident_at DESC, "
                "LOWER(host.hostname) ASC"
            )
        else:
            order_clause = f"{order_expr} {normalized_sort_dir.upper()}, LOWER(host.hostname) ASC"

        with self._lock, self._connect() as conn:
            rows = conn.execute(
                f"""
                SELECT
                    host.hostname,
                    host.incidents_total,
                    host.incidents_new,
                    host.last_incident_at,
                    host.top_severity_rank,
                    COALESCE((
                        SELECT ix.branch
                        FROM scan_incidents ix
                        WHERE LOWER(ix.hostname) = LOWER(host.hostname)
                          AND TRIM(COALESCE(ix.branch, '')) <> ''
                        ORDER BY ix.created_at DESC
                        LIMIT 1
                    ), '') as branch,
                    COALESCE((
                        SELECT COALESCE(NULLIF(TRIM(ix.user_full_name), ''), NULLIF(TRIM(ix.user_login), ''), '')
                        FROM scan_incidents ix
                        WHERE LOWER(ix.hostname) = LOWER(host.hostname)
                          AND (
                            TRIM(COALESCE(ix.user_full_name, '')) <> ''
                            OR TRIM(COALESCE(ix.user_login, '')) <> ''
                          )
                        ORDER BY ix.created_at DESC
                        LIMIT 1
                    ), '') as user,
                    COALESCE((
                        SELECT a.ip_address
                        FROM scan_agents a
                        WHERE LOWER(a.hostname) = LOWER(host.hostname)
                          AND TRIM(COALESCE(a.ip_address, '')) <> ''
                        ORDER BY a.last_seen_at DESC
                        LIMIT 1
                    ), '') as ip_address
                FROM (
                    SELECT
                        i.hostname as hostname,
                        COUNT(*) as incidents_total,
                        SUM(CASE WHEN i.status='new' THEN 1 ELSE 0 END) as incidents_new,
                        MAX(i.created_at) as last_incident_at,
                        MAX(
                            CASE LOWER(i.severity)
                                WHEN 'high' THEN 3
                                WHEN 'medium' THEN 2
                                WHEN 'low' THEN 1
                                ELSE 0
                            END
                        ) as top_severity_rank
                    FROM scan_incidents i
                    {where_clause}
                    GROUP BY i.hostname
                ) host
                ORDER BY {order_clause}
                """,
                params,
            ).fetchall()

            out: List[Dict[str, Any]] = []
            for row in rows:
                host = str(row["hostname"] or "").strip()
                if not host:
                    continue

                detail_rows = conn.execute(
                    """
                    SELECT
                        i.branch,
                        i.user_login,
                        i.user_full_name,
                        i.created_at,
                        i.file_path,
                        j.file_name,
                        j.source_kind
                    FROM scan_incidents i
                    LEFT JOIN scan_jobs j ON j.id = i.job_id
                    WHERE LOWER(i.hostname) = LOWER(?)
                    ORDER BY i.created_at DESC
                    LIMIT 400
                    """,
                    (host,),
                ).fetchall()
                ext_counts: Dict[str, int] = {}
                source_counts: Dict[str, int] = {}

                for d in detail_rows:
                    ext = _file_ext_from_values(d["file_name"], d["file_path"])
                    if ext:
                        ext_counts[ext] = int(ext_counts.get(ext, 0) + 1)
                    source = str(d["source_kind"] or "").strip().lower()
                    if source:
                        source_counts[source] = int(source_counts.get(source, 0) + 1)

                top_exts = [name for name, _ in sorted(ext_counts.items(), key=lambda it: (-it[1], it[0]))[:5]]
                top_sources = [name for name, _ in sorted(source_counts.items(), key=lambda it: (-it[1], it[0]))[:5]]

                item = {
                    "hostname": host,
                    "incidents_total": int(row["incidents_total"] or 0),
                    "incidents_new": int(row["incidents_new"] or 0),
                    "last_incident_at": int(row["last_incident_at"] or 0),
                    "top_severity": _severity_rank_to_label(row["top_severity_rank"]),
                    "branch": str(row["branch"] or "").strip(),
                    "user": str(row["user"] or "").strip(),
                    "ip_address": str(row["ip_address"] or "").strip(),
                    "top_exts": top_exts,
                    "top_source_kinds": top_sources,
                }
                if branch_needle and branch_needle not in item["branch"].casefold():
                    continue
                if q_needle:
                    text = " ".join(
                        [
                            item["hostname"],
                            item["branch"],
                            item["user"],
                            item["ip_address"],
                            " ".join(item["top_exts"]),
                            " ".join(item["top_source_kinds"]),
                        ]
                    ).casefold()
                    if q_needle not in text:
                        continue
                out.append(item)
        total = len(out)
        paged = out[safe_offset:safe_offset + safe_limit]
        return {"total": int(total), "items": paged}

    def list_host_scan_runs(self, *, hostname: str, limit: int = 30, offset: int = 0) -> Dict[str, Any]:
        normalized_host = str(hostname or "").strip()
        if not normalized_host:
            return {"total": 0, "items": [], "limit": max(1, min(100, int(limit))), "offset": max(0, int(offset))}
        safe_limit = max(1, min(100, int(limit)))
        safe_offset = max(0, int(offset))
        now_ts = self._now()
        with self._lock, self._connect() as conn:
            agent_rows = conn.execute(
                "SELECT agent_id FROM scan_agents WHERE LOWER(hostname)=LOWER(?)",
                (normalized_host,),
            ).fetchall()
            agent_ids = [str(row["agent_id"] or "").strip() for row in agent_rows if str(row["agent_id"] or "").strip()]
            obs_task_rows = conn.execute(
                """
                SELECT DISTINCT scan_task_id
                FROM scan_task_file_observations
                WHERE LOWER(hostname)=LOWER(?) AND scan_task_id <> ''
                """,
                (normalized_host,),
            ).fetchall()
            task_ids = [str(row["scan_task_id"] or "").strip() for row in obs_task_rows if str(row["scan_task_id"] or "").strip()]
            conditions = ["LOWER(COALESCE(a.hostname, ''))=LOWER(?)"]
            params: List[Any] = [normalized_host]
            if agent_ids:
                placeholders = ", ".join("?" for _ in agent_ids)
                conditions.append(f"t.agent_id IN ({placeholders})")
                params.extend(agent_ids)
            if task_ids:
                placeholders = ", ".join("?" for _ in task_ids)
                conditions.append(f"t.id IN ({placeholders})")
                params.extend(task_ids)
            where_clause = "WHERE t.command='scan_now' AND (" + " OR ".join(conditions) + ")"
            total = conn.execute(
                f"""
                SELECT COUNT(*)
                FROM scan_tasks t
                LEFT JOIN scan_agents a ON a.agent_id = t.agent_id
                {where_clause}
                """,
                params,
            ).fetchone()[0]
            rows = conn.execute(
                f"""
                SELECT
                    t.*,
                    COALESCE(NULLIF(a.hostname, ''), ?) AS hostname,
                    COALESCE(jf.failed_jobs_count, 0) AS failed_jobs_count,
                    COALESCE(jf.failed_job_errors, '') AS failed_job_errors,
                    SUM(CASE WHEN o.observation_type='found_new' THEN 1 ELSE 0 END) AS found_new,
                    SUM(CASE WHEN o.observation_type='found_duplicate' THEN 1 ELSE 0 END) AS found_duplicate,
                    SUM(CASE WHEN o.observation_type='deleted' THEN 1 ELSE 0 END) AS deleted_count,
                    SUM(CASE WHEN o.observation_type='cleaned' THEN 1 ELSE 0 END) AS cleaned_count,
                    SUM(CASE WHEN o.observation_type='moved' THEN 1 ELSE 0 END) AS moved_count,
                    COUNT(o.id) AS observations_total
                FROM scan_tasks t
                LEFT JOIN scan_agents a ON a.agent_id = t.agent_id
                LEFT JOIN scan_task_file_observations o ON o.scan_task_id = t.id
                LEFT JOIN (
                    SELECT
                        scan_task_id,
                        SUM(error_count) AS failed_jobs_count,
                        GROUP_CONCAT(error_text || ' (' || error_count || ')', '; ') AS failed_job_errors
                    FROM (
                        SELECT
                            scan_task_id,
                            COALESCE(NULLIF(error_text, ''), 'Ошибка без текста') AS error_text,
                            COUNT(*) AS error_count
                        FROM scan_jobs
                        WHERE status='failed'
                        GROUP BY scan_task_id, COALESCE(NULLIF(error_text, ''), 'Ошибка без текста')
                    )
                    GROUP BY scan_task_id
                ) jf ON jf.scan_task_id = t.id
                {where_clause}
                GROUP BY t.id
                ORDER BY COALESCE(t.completed_at, t.updated_at, t.created_at) DESC
                LIMIT ? OFFSET ?
                """,
                [normalized_host, *params, safe_limit, safe_offset],
            ).fetchall()
        items: List[Dict[str, Any]] = []
        for row in rows:
            item = self._serialize_task_row(row, now_ts=now_ts)
            item["hostname"] = str(row["hostname"] or normalized_host).strip()
            item["failed_jobs_count"] = int(row["failed_jobs_count"] or 0)
            item["failed_job_errors"] = str(row["failed_job_errors"] or "").strip()
            item["observation_counts"] = {
                "found_new": int(row["found_new"] or 0),
                "found_duplicate": int(row["found_duplicate"] or 0),
                "deleted": int(row["deleted_count"] or 0),
                "cleaned": int(row["cleaned_count"] or 0),
                "moved": int(row["moved_count"] or 0),
                "total": int(row["observations_total"] or 0),
            }
            items.append(item)
        return {"total": int(total or 0), "items": items, "limit": safe_limit, "offset": safe_offset}

    def list_task_observations(
        self,
        *,
        task_id: str,
        limit: int = 200,
        offset: int = 0,
    ) -> Dict[str, Any]:
        normalized_task_id = str(task_id or "").strip()
        if not normalized_task_id:
            return {"total": 0, "items": [], "limit": max(1, min(500, int(limit))), "offset": max(0, int(offset))}
        safe_limit = max(1, min(500, int(limit)))
        safe_offset = max(0, int(offset))
        with self._lock, self._connect() as conn:
            total = conn.execute(
                "SELECT COUNT(*) FROM scan_task_file_observations WHERE scan_task_id=?",
                (normalized_task_id,),
            ).fetchone()[0]
            rows = conn.execute(
                """
                SELECT o.*, i.status AS incident_status, i.resolved_at, i.resolved_reason
                FROM scan_task_file_observations o
                LEFT JOIN scan_incidents i ON i.id = o.linked_incident_id
                WHERE o.scan_task_id=?
                ORDER BY
                    CASE o.observation_type
                        WHEN 'found_new' THEN 0
                        WHEN 'found_duplicate' THEN 1
                        WHEN 'moved' THEN 2
                        WHEN 'deleted' THEN 3
                        WHEN 'cleaned' THEN 4
                        ELSE 5
                    END ASC,
                    o.created_at DESC
                LIMIT ? OFFSET ?
                """,
                (normalized_task_id, safe_limit, safe_offset),
            ).fetchall()
        next_offset = safe_offset + len(rows)
        return {
            "total": int(total or 0),
            "items": [dict(row) for row in rows],
            "limit": safe_limit,
            "offset": safe_offset,
            "has_more": next_offset < int(total or 0),
            "next_offset": next_offset if next_offset < int(total or 0) else None,
        }
