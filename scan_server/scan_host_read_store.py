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
        is_postgres: Optional[Callable[[], bool]] = None,
    ) -> None:
        self._lock = lock
        self._connect = connect
        self._serialize_task_row = serialize_task_row
        self._now = now
        self._is_postgres = is_postgres or (lambda: False)

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

        safe_limit = max(1, min(500, int(limit)))
        safe_offset = max(0, int(offset))
        normalized_sort_by = str(sort_by or "").strip().lower() or "incidents_new"
        normalized_sort_dir = _normalize_sort_dir(sort_dir)
        branch_needle = str(branch or "").strip().casefold()
        q_needle = str(q or "").strip().casefold()
        # Push hostname-like search into SQL before GROUP BY so we do not aggregate every host.
        from .database import looks_like_hostname_query

        if q_needle and looks_like_hostname_query(q_needle):
            conditions.append("(LOWER(i.hostname) = ? OR LOWER(i.hostname) LIKE ?)")
            params.extend([q_needle, f"{q_needle}%"])
        where_clause = f"WHERE {' AND '.join(conditions)}" if conditions else ""
        # Post-agg filters (branch/user text) need context before paging. Default UI
        # path has no such filters — page aggregates in SQL and load context only
        # for the page (avoids DISTINCT ON over every host).
        needs_context_before_page = bool(branch_needle) or (
            bool(q_needle) and not looks_like_hostname_query(q_needle)
        )
        sort_sql_map = {
            "hostname": "LOWER(hostname)",
            "incidents_total": "incidents_total",
            "incidents_new": "incidents_new",
            "severity": "top_severity_rank",
            "last_incident_at": "last_incident_at",
        }
        sql_sort_expr = sort_sql_map.get(normalized_sort_by)
        can_page_in_sql = (not needs_context_before_page) and sql_sort_expr is not None

        with self._lock, self._connect() as conn:
            agg_sql = f"""
                SELECT
                    i.hostname AS hostname,
                    COUNT(*) AS incidents_total,
                    SUM(CASE WHEN i.status='new' THEN 1 ELSE 0 END) AS incidents_new,
                    MAX(i.created_at) AS last_incident_at,
                    MAX(
                        CASE LOWER(i.severity)
                            WHEN 'high' THEN 3
                            WHEN 'medium' THEN 2
                            WHEN 'low' THEN 1
                            ELSE 0
                        END
                    ) AS top_severity_rank
                FROM scan_incidents i
                {where_clause}
                GROUP BY i.hostname
            """
            if can_page_in_sql:
                total = int(
                    conn.execute(
                        f"SELECT COUNT(*) AS cnt FROM ({agg_sql}) agg",
                        params,
                    ).fetchone()["cnt"]
                    or 0
                )
                order_sql = (
                    f"{sql_sort_expr} {normalized_sort_dir.upper()}, "
                    f"incidents_new DESC, top_severity_rank DESC, "
                    f"last_incident_at DESC, LOWER(hostname) ASC"
                )
                rows = conn.execute(
                    f"""
                    SELECT * FROM ({agg_sql}) agg
                    ORDER BY {order_sql}
                    LIMIT ? OFFSET ?
                    """,
                    [*params, safe_limit, safe_offset],
                ).fetchall()
                paged: List[Dict[str, Any]] = []
                host_keys = [str(row["hostname"] or "").strip() for row in rows if str(row["hostname"] or "").strip()]
                context = self._batch_host_list_context(conn, host_keys)
                for row in rows:
                    host = str(row["hostname"] or "").strip()
                    if not host:
                        continue
                    ctx = context.get(host.casefold()) or {}
                    item = {
                        "hostname": host,
                        "incidents_total": int(row["incidents_total"] or 0),
                        "incidents_new": int(row["incidents_new"] or 0),
                        "last_incident_at": int(row["last_incident_at"] or 0),
                        "top_severity": _severity_rank_to_label(row["top_severity_rank"]),
                        "branch": str(ctx.get("branch") or "").strip(),
                        "user": str(ctx.get("user") or "").strip(),
                        "ip_address": str(ctx.get("ip_address") or "").strip(),
                        "top_exts": [],
                        "top_source_kinds": [],
                    }
                    if q_needle and looks_like_hostname_query(q_needle):
                        # Already constrained in SQL; keep case-insensitive contains check.
                        if q_needle not in host.casefold():
                            continue
                    paged.append(item)
                self._enrich_host_table_page(conn, paged)
                return {"total": int(total), "items": paged}

            rows = conn.execute(agg_sql, params).fetchall()
            host_keys = []
            agg_by_host: Dict[str, Any] = {}
            for row in rows:
                host = str(row["hostname"] or "").strip()
                if not host:
                    continue
                key = host.casefold()
                host_keys.append(host)
                agg_by_host[key] = row

            context = self._batch_host_list_context(conn, host_keys)
            candidates: List[Dict[str, Any]] = []
            for host in host_keys:
                key = host.casefold()
                row = agg_by_host[key]
                ctx = context.get(key) or {}
                item = {
                    "hostname": host,
                    "incidents_total": int(row["incidents_total"] or 0),
                    "incidents_new": int(row["incidents_new"] or 0),
                    "last_incident_at": int(row["last_incident_at"] or 0),
                    "top_severity": _severity_rank_to_label(row["top_severity_rank"]),
                    "branch": str(ctx.get("branch") or "").strip(),
                    "user": str(ctx.get("user") or "").strip(),
                    "ip_address": str(ctx.get("ip_address") or "").strip(),
                    "top_exts": [],
                    "top_source_kinds": [],
                    "_severity_rank": int(row["top_severity_rank"] or 0),
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
                        ]
                    ).casefold()
                    if q_needle not in text:
                        continue
                candidates.append(item)

            reverse = normalized_sort_dir == "desc"

            def _sort_key(item: Dict[str, Any]) -> Any:
                hostname_key = str(item.get("hostname") or "").casefold()
                if normalized_sort_by == "hostname":
                    return hostname_key
                if normalized_sort_by == "branch":
                    return (str(item.get("branch") or "").casefold(), hostname_key)
                if normalized_sort_by == "user":
                    return (str(item.get("user") or "").casefold(), hostname_key)
                if normalized_sort_by == "ip_address":
                    return (str(item.get("ip_address") or "").casefold(), hostname_key)
                if normalized_sort_by == "incidents_total":
                    return (int(item.get("incidents_total") or 0), hostname_key)
                if normalized_sort_by == "severity":
                    return (int(item.get("_severity_rank") or 0), hostname_key)
                if normalized_sort_by == "last_incident_at":
                    return (int(item.get("last_incident_at") or 0), hostname_key)
                return (
                    int(item.get("incidents_new") or 0),
                    int(item.get("_severity_rank") or 0),
                    int(item.get("last_incident_at") or 0),
                    hostname_key,
                )

            candidates.sort(key=_sort_key, reverse=reverse)
            total = len(candidates)
            paged = candidates[safe_offset : safe_offset + safe_limit]
            self._enrich_host_table_page(conn, paged)
            for item in paged:
                item.pop("_severity_rank", None)
        return {"total": int(total), "items": paged}

    def _batch_host_list_context(self, conn: Any, hostnames: List[str]) -> Dict[str, Dict[str, str]]:
        out: Dict[str, Dict[str, str]] = {}
        if not hostnames:
            return out
        # Latest non-empty branch/user per host from incidents.
        # Prefer scoped lookup for the page/candidate set — full-table DISTINCT ON
        # previously dominated hosts_table latency under statement_timeout.
        if self._is_postgres():
            placeholders = ", ".join("?" for _ in hostnames)
            lowered = [host.casefold() for host in hostnames]
            branch_rows = conn.execute(
                f"""
                SELECT DISTINCT ON (LOWER(hostname))
                    hostname,
                    COALESCE(branch, '') AS branch
                FROM scan_incidents
                WHERE LOWER(hostname) IN ({placeholders})
                  AND TRIM(COALESCE(branch, '')) <> ''
                ORDER BY LOWER(hostname), created_at DESC
                """,
                lowered,
            ).fetchall()
            user_rows = conn.execute(
                f"""
                SELECT DISTINCT ON (LOWER(hostname))
                    hostname,
                    COALESCE(NULLIF(TRIM(user_full_name), ''), NULLIF(TRIM(user_login), ''), '') AS user_name
                FROM scan_incidents
                WHERE LOWER(hostname) IN ({placeholders})
                  AND (
                    TRIM(COALESCE(user_full_name, '')) <> ''
                    OR TRIM(COALESCE(user_login, '')) <> ''
                  )
                ORDER BY LOWER(hostname), created_at DESC
                """,
                lowered,
            ).fetchall()
            ip_rows = conn.execute(
                f"""
                SELECT DISTINCT ON (LOWER(hostname))
                    hostname,
                    COALESCE(ip_address, '') AS ip_address
                FROM scan_agents
                WHERE LOWER(hostname) IN ({placeholders})
                  AND TRIM(COALESCE(ip_address, '')) <> ''
                ORDER BY LOWER(hostname), last_seen_at DESC
                """,
                lowered,
            ).fetchall()
            for row in branch_rows:
                host = str(row["hostname"] or "").strip()
                if not host:
                    continue
                out[host.casefold()] = {
                    "branch": str(row["branch"] or "").strip(),
                    "user": "",
                    "ip_address": "",
                }
            for row in user_rows:
                host = str(row["hostname"] or "").strip()
                if not host:
                    continue
                slot = out.setdefault(host.casefold(), {"branch": "", "user": "", "ip_address": ""})
                slot["user"] = str(row["user_name"] or "").strip()
            for row in ip_rows:
                host = str(row["hostname"] or "").strip()
                if not host:
                    continue
                slot = out.setdefault(host.casefold(), {"branch": "", "user": "", "ip_address": ""})
                slot["ip_address"] = str(row["ip_address"] or "").strip()
            return out

        rows = conn.execute(
            """
            SELECT hostname, branch, user_full_name, user_login, created_at
            FROM scan_incidents
            ORDER BY created_at DESC
            """
        ).fetchall()
        for row in rows:
            host = str(row["hostname"] or "").strip()
            if not host:
                continue
            key = host.casefold()
            slot = out.setdefault(key, {"branch": "", "user": "", "ip_address": ""})
            branch = str(row["branch"] or "").strip()
            user = str(row["user_full_name"] or "").strip() or str(row["user_login"] or "").strip()
            if branch and not slot["branch"]:
                slot["branch"] = branch
            if user and not slot["user"]:
                slot["user"] = user
        ip_rows = conn.execute(
            """
            SELECT hostname, ip_address, last_seen_at
            FROM scan_agents
            WHERE TRIM(COALESCE(ip_address, '')) <> ''
            ORDER BY last_seen_at DESC
            """
        ).fetchall()
        for row in ip_rows:
            host = str(row["hostname"] or "").strip()
            if not host:
                continue
            key = host.casefold()
            slot = out.setdefault(key, {"branch": "", "user": "", "ip_address": ""})
            if not slot.get("ip_address"):
                slot["ip_address"] = str(row["ip_address"] or "").strip()
        return out

    def _enrich_host_table_page(self, conn: Any, page: List[Dict[str, Any]]) -> None:
        hosts = [str(item.get("hostname") or "").strip() for item in page if str(item.get("hostname") or "").strip()]
        if not hosts:
            return
        placeholders = ", ".join("?" for _ in hosts)
        lowered = [host.casefold() for host in hosts]
        detail_rows = conn.execute(
            f"""
            SELECT hostname, file_path, file_name, source_kind
            FROM (
                SELECT
                    i.hostname,
                    i.file_path,
                    j.file_name,
                    j.source_kind,
                    ROW_NUMBER() OVER (
                        PARTITION BY LOWER(i.hostname)
                        ORDER BY i.created_at DESC
                    ) AS rn
                FROM scan_incidents i
                LEFT JOIN scan_jobs j ON j.id = i.job_id
                WHERE LOWER(i.hostname) IN ({placeholders})
            ) ranked
            WHERE rn <= 80
            """,
            lowered,
        ).fetchall()

        per_host_ext: Dict[str, Dict[str, int]] = {}
        per_host_source: Dict[str, Dict[str, int]] = {}
        for detail in detail_rows:
            host_key = str(detail["hostname"] or "").strip().casefold()
            if not host_key:
                continue
            ext_counts = per_host_ext.setdefault(host_key, {})
            source_counts = per_host_source.setdefault(host_key, {})
            ext = _file_ext_from_values(detail["file_name"], detail["file_path"])
            if ext:
                ext_counts[ext] = int(ext_counts.get(ext, 0) + 1)
            source = str(detail["source_kind"] or "").strip().lower()
            if source:
                source_counts[source] = int(source_counts.get(source, 0) + 1)

        for item in page:
            host_key = str(item.get("hostname") or "").strip().casefold()
            ext_counts = per_host_ext.get(host_key, {})
            source_counts = per_host_source.get(host_key, {})
            item["top_exts"] = [name for name, _ in sorted(ext_counts.items(), key=lambda it: (-it[1], it[0]))[:5]]
            item["top_source_kinds"] = [
                name for name, _ in sorted(source_counts.items(), key=lambda it: (-it[1], it[0]))[:5]
            ]

    def list_host_scan_runs(
        self,
        *,
        hostname: str,
        limit: int = 30,
        offset: int = 0,
        view: str = "detail",
    ) -> Dict[str, Any]:
        normalized_host = str(hostname or "").strip()
        if not normalized_host:
            return {"total": 0, "items": [], "limit": max(1, min(100, int(limit))), "offset": max(0, int(offset))}
        safe_limit = max(1, min(100, int(limit)))
        safe_offset = max(0, int(offset))
        from .scan_view import normalize_scan_list_view

        resolved_view = normalize_scan_list_view(view, default="detail")
        slim = resolved_view == "summary"
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
            if self._is_postgres():
                failed_errors_expr = (
                    "STRING_AGG(error_text || ' (' || error_count::text || ')', '; ' "
                    "ORDER BY error_text)"
                )
            else:
                failed_errors_expr = (
                    "GROUP_CONCAT(error_text || ' (' || error_count || ')', '; ')"
                )
            # PostgreSQL requires non-aggregated selected columns in GROUP BY.
            # Restrict failed-job aggregation to candidate tasks for this host.
            rows = conn.execute(
                f"""
                SELECT
                    t.id, t.agent_id, t.command, t.status, t.error_text, t.attempt_count,
                    t.created_at, t.updated_at, t.delivered_at, t.acked_at, t.completed_at,
                    t.ttl_at, t.next_attempt_at, t.due_at, t.dedupe_key,
                    t.payload_json, t.result_json,
                    MAX(COALESCE(NULLIF(a.hostname, ''), ?)) AS hostname,
                    COALESCE(MAX(jf.failed_jobs_count), 0) AS failed_jobs_count,
                    COALESCE(MAX(jf.failed_job_errors), '') AS failed_job_errors,
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
                        {failed_errors_expr} AS failed_job_errors
                    FROM (
                        SELECT
                            j.scan_task_id,
                            COALESCE(NULLIF(j.error_text, ''), 'Ошибка без текста') AS error_text,
                            COUNT(*) AS error_count
                        FROM scan_jobs j
                        WHERE j.status='failed'
                          AND j.scan_task_id IN (
                              SELECT t2.id
                              FROM scan_tasks t2
                              LEFT JOIN scan_agents a2 ON a2.agent_id = t2.agent_id
                              {where_clause.replace("t.", "t2.").replace("a.", "a2.")}
                          )
                        GROUP BY j.scan_task_id, COALESCE(NULLIF(j.error_text, ''), 'Ошибка без текста')
                    ) failed_by_text
                    GROUP BY scan_task_id
                ) jf ON jf.scan_task_id = t.id
                {where_clause}
                GROUP BY t.id
                ORDER BY COALESCE(MAX(t.completed_at), MAX(t.updated_at), MAX(t.created_at)) DESC
                LIMIT ? OFFSET ?
                """,
                [normalized_host, *params, *params, safe_limit, safe_offset],
            ).fetchall()
        items: List[Dict[str, Any]] = []
        for row in rows:
            item = self._serialize_task_row(row, now_ts=now_ts, slim=slim)
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
        return {
            "total": int(total or 0),
            "items": items,
            "limit": safe_limit,
            "offset": safe_offset,
            "view": resolved_view,
        }

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
