from __future__ import annotations

import json
import sqlite3
from typing import Any, Callable, Dict, List, Optional

ACTIVE_TASK_STATUSES = ("queued", "delivered", "acknowledged")
# Hostname/agent-id prefix invent removed (fail-closed unknown branch).
BRANCH_SOURCE_AGENT = "agent"
BRANCH_SOURCE_JOB = "job"
BRANCH_SOURCE_INCIDENT = "incident"
BRANCH_SOURCE_UNKNOWN = "unknown"


def _json_loads(value: Any, default: Any) -> Any:
    text = str(value or "").strip()
    if not text:
        return default
    try:
        return json.loads(text)
    except Exception:
        return default


# Agents table/list UI only needs a few heartbeat metadata signals. Full
# last_heartbeat_json can be hundreds of KB/agent and blows list JSON budgets.
_HEARTBEAT_TOP_KEYS = (
    "mac_address",
    "version",
    "status",
    "hostname",
    "branch",
    "ip_address",
    "queue_pending",
)
_HEARTBEAT_META_KEYS = (
    "agent_version",
    "analysis_version",
    "mac_address",
    "outbox_depth",
    "dead_letter_depth",
    "outbox_stale",
    "outbox_oldest_age_sec",
    "pending_update",
    "legacy_itinvent_present",
    "low_disk",
)


def _slim_last_heartbeat(payload: Any) -> Dict[str, Any]:
    if not isinstance(payload, dict):
        return {}
    out: Dict[str, Any] = {}
    for key in _HEARTBEAT_TOP_KEYS:
        if key in payload and payload.get(key) not in (None, "", [], {}):
            out[key] = payload.get(key)
    meta_in = payload.get("metadata") if isinstance(payload.get("metadata"), dict) else {}
    meta_out = {
        key: meta_in.get(key)
        for key in _HEARTBEAT_META_KEYS
        if key in meta_in and meta_in.get(key) not in (None, "", [], {})
    }
    if meta_out:
        out["metadata"] = meta_out
    return out


def _normalize_task_status_filter(value: Any) -> List[str]:
    raw = str(value or "").strip().lower()
    if not raw or raw == "all":
        return []
    if raw == "active":
        return list(ACTIVE_TASK_STATUSES)
    if raw == "final":
        return ["completed", "failed", "expired"]
    return [item for item in {part.strip().lower() for part in raw.split(",")} if item]


def _normalize_online_filter(value: Any) -> Optional[bool]:
    raw = str(value or "").strip().lower()
    if not raw or raw == "all":
        return None
    if raw in {"1", "true", "yes", "online"}:
        return True
    if raw in {"0", "false", "no", "offline"}:
        return False
    return None


def _normalize_mac_for_lookup(value: Any) -> str:
    return "".join(
        ch for ch in str(value or "").upper()
        if ch.isdigit() or ("A" <= ch <= "F")
    )


def _normalize_sort_dir(value: Any) -> str:
    return "asc" if str(value or "").strip().lower() == "asc" else "desc"


def _task_priority(task: Optional[Dict[str, Any]]) -> int:
    status_value = str((task or {}).get("status") or "").strip().lower()
    if status_value == "acknowledged":
        return 3
    if status_value == "delivered":
        return 2
    if status_value == "queued":
        return 1
    return 0


class ScanAgentReadStore:
    def __init__(
        self,
        *,
        lock: Any,
        connect: Callable[[], Any],
        serialize_task_row: Callable[..., Dict[str, Any]],
        now: Callable[[], int],
        agent_online_timeout_sec: Callable[[], int],
        resolve_agent_sql_context_enabled: Callable[[], bool],
        resolve_agent_sql_context: Callable[[Any, Any], Optional[Dict[str, Any]]],
        is_postgres: Optional[Callable[[], bool]] = None,
    ) -> None:
        self._lock = lock
        self._connect = connect
        self._serialize_task_row = serialize_task_row
        self._now = now
        self._agent_online_timeout_sec = agent_online_timeout_sec
        self._resolve_agent_sql_context_enabled = resolve_agent_sql_context_enabled
        self._resolve_agent_sql_context = resolve_agent_sql_context
        self._is_postgres = is_postgres or (lambda: False)

    def _serialize_job_as_task_row(
        self,
        row: sqlite3.Row,
        now_ts: Optional[int] = None,
        *,
        slim: bool = False,
    ) -> Dict[str, Any]:
        current_ts = int(now_ts or self._now())
        item = dict(row)
        job_status = str(item.get("status") or "").strip().lower()
        created_at = int(item.get("created_at") or 0)
        started_at = int(item.get("started_at") or 0)
        finished_at = int(item.get("finished_at") or 0)
        mapped_status = "acknowledged" if job_status == "processing" else "queued"
        updated_at = finished_at or started_at or created_at
        payload: Dict[str, Any] = {}
        if not slim:
            loaded = _json_loads(item.get("payload_json"), {})
            payload = loaded if isinstance(loaded, dict) else {}
        return {
            "id": str(item.get("id") or ""),
            "agent_id": str(item.get("agent_id") or ""),
            "command": "scan_now",
            "payload": payload,
            "result": {},
            "status": mapped_status,
            "error_text": str(item.get("error_text") or "").strip(),
            "attempt_count": 0,
            "created_at": created_at,
            "updated_at": updated_at,
            "delivered_at": started_at if started_at else 0,
            "acked_at": started_at if job_status == "processing" and started_at else 0,
            "completed_at": finished_at,
            "ttl_at": current_ts + 24 * 60 * 60,
            "is_active": job_status in {"queued", "processing"},
            "elapsed_seconds": max(0, (finished_at or updated_at or current_ts) - created_at) if created_at else 0,
        }

    def _fetch_task_summaries(
        self,
        conn: sqlite3.Connection,
        agent_ids: List[str],
        *,
        now_ts: int,
        slim: bool = False,
    ) -> tuple[Dict[str, Dict[str, Any]], Dict[str, Dict[str, Any]]]:
        normalized_ids = [str(agent_id or "").strip() for agent_id in agent_ids if str(agent_id or "").strip()]
        if not normalized_ids:
            return {}, {}

        placeholders = ", ".join("?" for _ in normalized_ids)
        # Table/list paths must not pull payload_json/result_json blobs.
        task_cols = (
            "t.id, t.agent_id, t.command, t.status, t.error_text, t.attempt_count, "
            "t.created_at, t.updated_at, t.delivered_at, t.acked_at, t.completed_at, "
            "t.ttl_at, t.next_attempt_at, t.due_at, t.dedupe_key, "
            "'{}' AS payload_json, '{}' AS result_json"
            if slim
            else "t.*"
        )
        active_rows = conn.execute(
            f"""
            SELECT *
            FROM (
                SELECT
                    {task_cols},
                    ROW_NUMBER() OVER (
                        PARTITION BY t.agent_id
                        ORDER BY
                            CASE LOWER(t.status)
                                WHEN 'acknowledged' THEN 3
                                WHEN 'delivered' THEN 2
                                WHEN 'queued' THEN 1
                                ELSE 0
                            END DESC,
                            COALESCE(t.acked_at, t.delivered_at, t.created_at) DESC,
                            t.created_at DESC
                    ) AS rn
                FROM scan_tasks t
                WHERE t.agent_id IN ({placeholders})
                  AND t.status IN ('queued', 'delivered', 'acknowledged')
                  AND t.ttl_at > ?
            )
            WHERE rn = 1
            """,
            [*normalized_ids, now_ts],
        ).fetchall()
        last_rows = conn.execute(
            f"""
            SELECT *
            FROM (
                SELECT
                    {task_cols},
                    ROW_NUMBER() OVER (
                        PARTITION BY t.agent_id
                        ORDER BY
                            COALESCE(t.updated_at, t.created_at) DESC,
                            t.created_at DESC
                    ) AS rn
                FROM scan_tasks t
                WHERE t.agent_id IN ({placeholders})
            )
            WHERE rn = 1
            """,
            normalized_ids,
        ).fetchall()

        active_map = {
            str(row["agent_id"]): self._serialize_task_row(row, now_ts=now_ts, slim=slim)
            for row in active_rows
        }
        last_map = {
            str(row["agent_id"]): self._serialize_task_row(row, now_ts=now_ts, slim=slim)
            for row in last_rows
        }
        return active_map, last_map

    def _fetch_job_summaries(
        self,
        conn: sqlite3.Connection,
        agent_ids: List[str],
        *,
        now_ts: int,
        slim: bool = False,
    ) -> tuple[Dict[str, Dict[str, Any]], Dict[str, Dict[str, Any]], Dict[str, int]]:
        normalized_ids = [str(agent_id or "").strip() for agent_id in agent_ids if str(agent_id or "").strip()]
        if not normalized_ids:
            return {}, {}, {}
        placeholders = ", ".join("?" for _ in normalized_ids)
        job_cols = (
            "j.id, j.agent_id, j.status, j.error_text, j.created_at, j.started_at, j.finished_at, "
            "'{}' AS payload_json"
            if slim
            else "j.*"
        )

        active_rows = conn.execute(
            f"""
            SELECT {job_cols}
            FROM scan_jobs j
            JOIN (
                SELECT
                    agent_id,
                    MAX(
                        CASE LOWER(status)
                            WHEN 'processing' THEN 2
                            WHEN 'queued' THEN 1
                            ELSE 0
                        END
                    ) AS max_priority
                FROM scan_jobs
                WHERE agent_id IN ({placeholders})
                  AND status IN ('queued', 'processing')
                GROUP BY agent_id
            ) priority_map
                ON priority_map.agent_id = j.agent_id
            WHERE j.agent_id IN ({placeholders})
              AND j.status IN ('queued', 'processing')
              AND CASE LOWER(j.status)
                    WHEN 'processing' THEN 2
                    WHEN 'queued' THEN 1
                    ELSE 0
                  END = priority_map.max_priority
            ORDER BY j.agent_id, COALESCE(j.started_at, j.created_at) DESC, j.created_at DESC
            """,
            [*normalized_ids, *normalized_ids],
        ).fetchall()

        last_rows = conn.execute(
            f"""
            SELECT {job_cols}
            FROM scan_jobs j
            JOIN (
                SELECT
                    agent_id,
                    MAX(COALESCE(finished_at, started_at, created_at)) AS max_order_ts
                FROM scan_jobs
                WHERE agent_id IN ({placeholders})
                GROUP BY agent_id
            ) latest_map
                ON latest_map.agent_id = j.agent_id
            WHERE j.agent_id IN ({placeholders})
              AND COALESCE(j.finished_at, j.started_at, j.created_at) = latest_map.max_order_ts
            ORDER BY j.agent_id, j.created_at DESC
            """,
            [*normalized_ids, *normalized_ids],
        ).fetchall()

        count_rows = conn.execute(
            f"""
            SELECT agent_id, COUNT(*) AS job_count
            FROM scan_jobs
            WHERE agent_id IN ({placeholders})
              AND status IN ('queued', 'processing')
            GROUP BY agent_id
            """,
            normalized_ids,
        ).fetchall()

        active_map: Dict[str, Dict[str, Any]] = {}
        for row in active_rows:
            agent_id = str(row["agent_id"] or "").strip()
            if agent_id and agent_id not in active_map:
                active_map[agent_id] = self._serialize_job_as_task_row(row, now_ts=now_ts, slim=slim)

        last_map: Dict[str, Dict[str, Any]] = {}
        for row in last_rows:
            agent_id = str(row["agent_id"] or "").strip()
            if agent_id and agent_id not in last_map:
                last_map[agent_id] = self._serialize_job_as_task_row(row, now_ts=now_ts, slim=slim)

        count_map: Dict[str, int] = {
            str(row["agent_id"] or "").strip(): int(row["job_count"] or 0)
            for row in count_rows
            if str(row["agent_id"] or "").strip()
        }
        return active_map, last_map, count_map

    def _fetch_active_task_counts(
        self,
        conn: sqlite3.Connection,
        agent_ids: List[str],
        *,
        now_ts: int,
    ) -> Dict[str, int]:
        normalized_ids = [str(agent_id or "").strip() for agent_id in agent_ids if str(agent_id or "").strip()]
        if not normalized_ids:
            return {}
        placeholders = ", ".join("?" for _ in normalized_ids)
        rows = conn.execute(
            f"""
            SELECT agent_id, COUNT(*) AS task_count
            FROM scan_tasks
            WHERE agent_id IN ({placeholders})
              AND status IN ('queued', 'delivered', 'acknowledged')
              AND ttl_at > ?
            GROUP BY agent_id
            """,
            [*normalized_ids, now_ts],
        ).fetchall()
        return {
            str(row["agent_id"] or "").strip(): int(row["task_count"] or 0)
            for row in rows
            if str(row["agent_id"] or "").strip()
        }

    def _resolve_branch_from_sql_context(
        self,
        *,
        sql_context_cache: Dict[str, Optional[Dict[str, Any]]],
        mac_address: str,
        hostname: Any,
    ) -> str:
        if not self._resolve_agent_sql_context_enabled():
            return ""
        context_key = f"{_normalize_mac_for_lookup(mac_address)}|{str(hostname or '').strip().lower()}"
        if context_key not in sql_context_cache:
            sql_context_cache[context_key] = self._resolve_agent_sql_context(mac_address, hostname)
        sql_context = sql_context_cache.get(context_key)
        if isinstance(sql_context, dict):
            return str(sql_context.get("branch_name") or "").strip()
        return ""

    def _batch_latest_branches(
        self,
        conn: sqlite3.Connection,
        agent_ids: List[str],
    ) -> Dict[str, str]:
        """Bulk branch names from jobs then incidents (compat wrapper)."""
        meta = self._batch_latest_branch_meta(conn, agent_ids)
        return {agent_id: str(info.get("branch") or "") for agent_id, info in meta.items()}

    def _batch_latest_branch_meta(
        self,
        conn: sqlite3.Connection,
        agent_ids: List[str],
    ) -> Dict[str, Dict[str, str]]:
        """Bulk branch truth from jobs then incidents (no N+1, no hostname invent)."""
        normalized_ids = [str(agent_id or "").strip() for agent_id in agent_ids if str(agent_id or "").strip()]
        if not normalized_ids:
            return {}
        placeholders = ", ".join("?" for _ in normalized_ids)
        out: Dict[str, Dict[str, str]] = {}
        job_rows = conn.execute(
            f"""
            SELECT agent_id, branch
            FROM (
                SELECT
                    agent_id,
                    branch,
                    ROW_NUMBER() OVER (
                        PARTITION BY agent_id
                        ORDER BY created_at DESC
                    ) AS rn
                FROM scan_jobs
                WHERE agent_id IN ({placeholders})
                  AND TRIM(COALESCE(branch, '')) <> ''
            ) ranked
            WHERE rn = 1
            """,
            normalized_ids,
        ).fetchall()
        for row in job_rows:
            agent_id = str(row["agent_id"] or "").strip()
            branch_name = str(row["branch"] or "").strip()
            if agent_id and branch_name:
                out[agent_id] = {"branch": branch_name, "source": BRANCH_SOURCE_JOB}
        missing = [agent_id for agent_id in normalized_ids if agent_id not in out]
        if not missing:
            return out
        miss_placeholders = ", ".join("?" for _ in missing)
        incident_rows = conn.execute(
            f"""
            SELECT agent_id, branch
            FROM (
                SELECT
                    agent_id,
                    branch,
                    ROW_NUMBER() OVER (
                        PARTITION BY agent_id
                        ORDER BY created_at DESC
                    ) AS rn
                FROM scan_incidents
                WHERE agent_id IN ({miss_placeholders})
                  AND TRIM(COALESCE(branch, '')) <> ''
            ) ranked
            WHERE rn = 1
            """,
            missing,
        ).fetchall()
        for row in incident_rows:
            agent_id = str(row["agent_id"] or "").strip()
            branch_name = str(row["branch"] or "").strip()
            if agent_id and branch_name and agent_id not in out:
                out[agent_id] = {"branch": branch_name, "source": BRANCH_SOURCE_INCIDENT}
        return out

    def _shape_agent_row(
        self,
        row: sqlite3.Row,
        *,
        agent_id: str,
        now_ts: int,
        active_map: Dict[str, Dict[str, Any]],
        last_map: Dict[str, Dict[str, Any]],
        active_job_map: Dict[str, Dict[str, Any]],
        last_job_map: Dict[str, Dict[str, Any]],
        active_job_count_map: Dict[str, int],
        active_task_count_map: Optional[Dict[str, int]] = None,
        sql_context_cache: Optional[Dict[str, Optional[Dict[str, Any]]]] = None,
        branch_source_hint: Optional[str] = None,
    ) -> Dict[str, Any]:
        item = dict(row)
        agent_col_branch = str(item.get("branch") or "").strip()
        resolved = str(item.get("resolved_branch") or "").strip()
        if agent_col_branch:
            item["branch"] = agent_col_branch
            item["branch_source"] = BRANCH_SOURCE_AGENT
        elif resolved:
            item["branch"] = resolved
            item["branch_source"] = str(branch_source_hint or BRANCH_SOURCE_UNKNOWN).strip() or BRANCH_SOURCE_UNKNOWN
        else:
            item["branch"] = ""
            item["branch_source"] = BRANCH_SOURCE_UNKNOWN
        item["ip_address"] = str(item.get("resolved_ip_address") or item.get("ip_address") or "").strip()
        item.pop("resolved_branch", None)
        item.pop("resolved_ip_address", None)
        for noise_key in (
            "hostname_sort",
            "agent_id_sort",
            "branch_sort",
            "ip_address_sort",
            "version_sort",
            "is_online",
        ):
            item.pop(noise_key, None)
        age_sec = max(0, now_ts - int(item.get("last_seen_at") or 0))
        item["age_seconds"] = age_sec
        item["is_online"] = age_sec <= self._agent_online_timeout_sec()
        raw_heartbeat_text = item.pop("last_heartbeat_json", None)
        if raw_heartbeat_text is None:
            # Table projection intentionally omits the huge heartbeat blob; synthesize
            # the few UI signals from dedicated agent columns.
            heartbeat_payload = {
                "version": str(item.get("version") or "").strip(),
                "hostname": str(item.get("hostname") or "").strip(),
                "branch": str(item.get("branch") or "").strip(),
                "ip_address": str(item.get("ip_address") or "").strip(),
                "metadata": {
                    "agent_version": str(item.get("version") or "").strip(),
                    "outbox_depth": int(item.get("outbox_depth") or 0),
                    "dead_letter_depth": int(item.get("dead_letter_depth") or 0),
                },
            }
        else:
            raw_heartbeat = _json_loads(raw_heartbeat_text, {})
            heartbeat_payload = raw_heartbeat if isinstance(raw_heartbeat, dict) else {}
        item["last_heartbeat"] = _slim_last_heartbeat(heartbeat_payload)
        # No hostname/prefix invent and no external SQL context invent for branch.

        active_task = active_map.get(agent_id)
        active_job = active_job_map.get(agent_id)
        if active_job and (
            active_task is None
            or str((active_task or {}).get("command") or "").strip().lower() == "ping"
            or _task_priority(active_job) > _task_priority(active_task)
        ):
            active_task = active_job

        last_task = last_map.get(agent_id)
        last_job = last_job_map.get(agent_id)
        if last_job and (
            last_task is None
            or str((last_task or {}).get("command") or "").strip().lower() == "ping"
            or int((last_job or {}).get("updated_at") or (last_job or {}).get("created_at") or 0)
            >= int((last_task or {}).get("updated_at") or (last_task or {}).get("created_at") or 0)
        ):
            last_task = last_job

        item["active_task"] = active_task
        item["last_task"] = last_task
        queue_counts = [
            int(item.get("queue_size") or 0),
            int(active_job_count_map.get(agent_id, 0) or 0),
        ]
        if active_task_count_map is not None:
            queue_counts.append(int(active_task_count_map.get(agent_id, 0) or 0))
        item["queue_size"] = max(queue_counts)
        return item

    def list_agents(self) -> List[Dict[str, Any]]:
        now_ts = self._now()
        with self._lock, self._connect() as conn:
            rows = conn.execute(
                """
                SELECT
                    a.*,
                    COALESCE(
                        NULLIF(a.branch, ''),
                        (
                            SELECT j.branch
                            FROM scan_jobs j
                            WHERE j.agent_id = a.agent_id AND j.branch <> ''
                            ORDER BY j.created_at DESC
                            LIMIT 1
                        ),
                        (
                            SELECT i.branch
                            FROM scan_incidents i
                            WHERE i.agent_id = a.agent_id AND i.branch <> ''
                            ORDER BY i.created_at DESC
                            LIMIT 1
                        ),
                        ''
                    ) as resolved_branch,
                    COALESCE(
                        NULLIF(a.ip_address, ''),
                        (
                            SELECT h.ip_address
                            FROM scan_agents h
                            WHERE h.agent_id = a.agent_id AND h.ip_address <> ''
                            ORDER BY h.last_seen_at DESC
                            LIMIT 1
                        ),
                        ''
                    ) as resolved_ip_address,
                    (
                        SELECT COUNT(*)
                        FROM scan_tasks t
                        WHERE t.agent_id = a.agent_id
                          AND t.status IN ('queued', 'delivered', 'acknowledged')
                          AND t.ttl_at > ?
                    ) as queue_size,
                    (
                        SELECT COUNT(*)
                        FROM scan_tasks t
                        WHERE t.agent_id = a.agent_id
                          AND t.status = 'expired'
                    ) as expired_tasks
                FROM scan_agents a
                ORDER BY a.last_seen_at DESC
                """,
                (now_ts,),
            ).fetchall()
            agent_ids = [str(row["agent_id"] or "").strip() for row in rows if str(row["agent_id"] or "").strip()]
            need_meta_ids = [
                str(row["agent_id"] or "").strip()
                for row in rows
                if str(row["agent_id"] or "").strip() and not str(row["branch"] or "").strip()
            ]
            branch_meta = self._batch_latest_branch_meta(conn, need_meta_ids)
            active_map, last_map = self._fetch_task_summaries(conn, agent_ids, now_ts=now_ts)
            active_job_map, last_job_map, active_job_count_map = self._fetch_job_summaries(conn, agent_ids, now_ts=now_ts)
        out: List[Dict[str, Any]] = []
        for row in rows:
            agent_id = str(row["agent_id"] or "").strip()
            agent_col = str(row["branch"] or "").strip()
            if agent_col:
                source_hint = BRANCH_SOURCE_AGENT
            else:
                info = branch_meta.get(agent_id) or {}
                source_hint = str(info.get("source") or BRANCH_SOURCE_UNKNOWN)
            out.append(
                self._shape_agent_row(
                    row,
                    agent_id=agent_id,
                    now_ts=now_ts,
                    active_map=active_map,
                    last_map=last_map,
                    active_job_map=active_job_map,
                    last_job_map=last_job_map,
                    active_job_count_map=active_job_count_map,
                    branch_source_hint=source_hint,
                )
            )
        return out

    def _merge_agent_runtime_rows(
        self,
        rows: List[sqlite3.Row],
        *,
        conn: sqlite3.Connection,
        now_ts: int,
        slim: bool = False,
    ) -> List[Dict[str, Any]]:
        mutable_rows: List[Dict[str, Any]] = [dict(row) for row in rows]
        agent_ids = [
            str(row.get("agent_id") or "").strip()
            for row in mutable_rows
            if str(row.get("agent_id") or "").strip()
        ]
        need_branch_ids = [
            str(row.get("agent_id") or "").strip()
            for row in mutable_rows
            if str(row.get("agent_id") or "").strip()
            and not str(row.get("branch") or "").strip()
            and not str(row.get("resolved_branch") or "").strip()
        ]
        branch_meta = self._batch_latest_branch_meta(conn, need_branch_ids)
        source_by_agent: Dict[str, str] = {}
        for row in mutable_rows:
            agent_id = str(row.get("agent_id") or "").strip()
            if str(row.get("branch") or "").strip():
                source_by_agent[agent_id] = BRANCH_SOURCE_AGENT
                continue
            if str(row.get("resolved_branch") or "").strip():
                source_by_agent[agent_id] = BRANCH_SOURCE_AGENT
                continue
            info = branch_meta.get(agent_id) or {}
            bulk_branch = str(info.get("branch") or "").strip()
            if bulk_branch:
                row["resolved_branch"] = bulk_branch
                source_by_agent[agent_id] = str(info.get("source") or BRANCH_SOURCE_UNKNOWN)
            else:
                source_by_agent[agent_id] = BRANCH_SOURCE_UNKNOWN
        active_map, last_map = self._fetch_task_summaries(conn, agent_ids, now_ts=now_ts, slim=slim)
        active_job_map, last_job_map, active_job_count_map = self._fetch_job_summaries(
            conn, agent_ids, now_ts=now_ts, slim=slim
        )
        active_task_count_map = self._fetch_active_task_counts(conn, agent_ids, now_ts=now_ts)
        out: List[Dict[str, Any]] = []
        for row in mutable_rows:
            agent_id = str(row.get("agent_id") or "").strip()
            out.append(
                self._shape_agent_row(
                    row,
                    agent_id=agent_id,
                    now_ts=now_ts,
                    active_map=active_map,
                    last_map=last_map,
                    active_job_map=active_job_map,
                    last_job_map=last_job_map,
                    active_job_count_map=active_job_count_map,
                    active_task_count_map=active_task_count_map,
                    branch_source_hint=source_by_agent.get(agent_id),
                )
            )
        return out

    def list_agents_activity(self, *, agent_ids: List[str]) -> Dict[str, Any]:
        normalized_ids = [str(agent_id or "").strip() for agent_id in agent_ids if str(agent_id or "").strip()]
        if not normalized_ids:
            return {"items": []}
        unique_ids = list(dict.fromkeys(normalized_ids))
        placeholders = ", ".join("?" for _ in unique_ids)
        now_ts = self._now()
        with self._lock, self._connect() as conn:
            # Explicit columns + slim merge (same projection as agents/table).
            rows = conn.execute(
                f"""
                SELECT
                    a.agent_id,
                    a.hostname,
                    a.branch,
                    a.ip_address,
                    a.version,
                    a.status,
                    a.last_seen_at,
                    a.updated_at,
                    a.outbox_depth,
                    a.dead_letter_depth,
                    a.last_ingest_ok_at,
                    COALESCE(NULLIF(a.branch, ''), '') AS resolved_branch,
                    COALESCE(NULLIF(a.ip_address, ''), '') AS resolved_ip_address,
                    0 AS queue_size
                FROM scan_agents a
                WHERE a.agent_id IN ({placeholders})
                """,
                unique_ids,
            ).fetchall()
            items = self._merge_agent_runtime_rows(list(rows), conn=conn, now_ts=now_ts, slim=True)
        order_map = {agent_id: index for index, agent_id in enumerate(unique_ids)}
        items.sort(key=lambda item: order_map.get(str(item.get("agent_id") or "").strip(), len(order_map)))
        return {
            "items": [
                {
                    "agent_id": str(item.get("agent_id") or "").strip(),
                    "is_online": bool(item.get("is_online")),
                    "last_seen_at": int(item.get("last_seen_at") or 0),
                    "queue_size": int(item.get("queue_size") or 0),
                    "active_task": item.get("active_task"),
                    "last_task": item.get("last_task"),
                }
                for item in items
            ]
        }

    def _list_agents_table_python(
        self,
        *,
        q: Optional[str] = None,
        branch: Optional[str] = None,
        online: Optional[str] = None,
        task_status: Optional[str] = None,
        limit: int = 50,
        offset: int = 0,
        sort_by: Optional[str] = None,
        sort_dir: Optional[str] = None,
    ) -> Dict[str, Any]:
        items = self.list_agents()
        needle = str(q or "").strip().lower()
        branch_needle = str(branch or "").strip().lower()
        online_filter = _normalize_online_filter(online)
        status_filters = _normalize_task_status_filter(task_status)
        normalized_sort_by = str(sort_by or "").strip().lower() or "online"
        normalized_sort_dir = _normalize_sort_dir(sort_dir)

        def matches_task_status(item: Dict[str, Any]) -> bool:
            if not status_filters:
                return True
            active_task = item.get("active_task") or {}
            last_task = item.get("last_task") or {}
            active_status = str(active_task.get("status") or "").strip().lower()
            last_status = str(last_task.get("status") or "").strip().lower()
            if "none" in status_filters:
                return not active_status
            if any(status_value in ACTIVE_TASK_STATUSES for status_value in status_filters):
                return active_status in status_filters
            return last_status in status_filters

        filtered: List[Dict[str, Any]] = []
        for item in items:
            if branch_needle and branch_needle not in str(item.get("branch") or "").strip().lower():
                continue
            if online_filter is not None and bool(item.get("is_online")) != online_filter:
                continue
            if needle:
                text = " ".join(
                    [
                        str(item.get("hostname") or ""),
                        str(item.get("agent_id") or ""),
                        str(item.get("branch") or ""),
                        str(item.get("ip_address") or ""),
                        str(item.get("version") or ""),
                    ]
                ).lower()
                if needle not in text:
                    continue
            if not matches_task_status(item):
                continue
            filtered.append(item)

        def sort_key(item: Dict[str, Any]):
            active_task = item.get("active_task") or {}
            last_task = item.get("last_task") or {}
            if normalized_sort_by in {"hostname", "agent_id"}:
                return str(item.get("hostname") or item.get("agent_id") or "").lower()
            if normalized_sort_by == "branch":
                return str(item.get("branch") or "").lower()
            if normalized_sort_by == "ip_address":
                return str(item.get("ip_address") or "").lower()
            if normalized_sort_by in {"status", "online"}:
                return (
                    1 if item.get("is_online") else 0,
                    _task_priority(active_task),
                    int(item.get("last_seen_at") or 0),
                )
            if normalized_sort_by == "queue_size":
                return (int(item.get("queue_size") or 0), int(item.get("last_seen_at") or 0))
            if normalized_sort_by == "active_task":
                return (_task_priority(active_task), int((active_task or {}).get("created_at") or 0))
            if normalized_sort_by == "last_result":
                return (
                    int((last_task or {}).get("updated_at") or 0),
                    int((last_task or {}).get("completed_at") or 0),
                )
            return int(item.get("last_seen_at") or 0)

        filtered.sort(key=sort_key, reverse=normalized_sort_dir != "asc")
        safe_limit = max(1, min(200, int(limit)))
        safe_offset = max(0, int(offset))
        paged = filtered[safe_offset:safe_offset + safe_limit]
        return {"total": len(filtered), "items": paged}

    def list_agents_table(
        self,
        *,
        q: Optional[str] = None,
        branch: Optional[str] = None,
        online: Optional[str] = None,
        task_status: Optional[str] = None,
        limit: int = 50,
        offset: int = 0,
        sort_by: Optional[str] = None,
        sort_dir: Optional[str] = None,
    ) -> Dict[str, Any]:
        normalized_sort_by = str(sort_by or "").strip().lower() or "online"
        normalized_sort_dir = _normalize_sort_dir(sort_dir)
        needle_probe = str(q or "").strip()
        branch_probe = str(branch or "").strip()
        # SQLite LOWER() is ASCII-only; Cyrillic filters need Python casefold there.
        # PostgreSQL Unicode LOWER covers branch/non-ASCII q on the SQL path.
        non_ascii_filter = any(ord(ch) > 127 for ch in (needle_probe + branch_probe))
        if non_ascii_filter and not bool(self._is_postgres()):
            return self._list_agents_table_python(
                q=q,
                branch=branch,
                online=online,
                task_status=task_status,
                limit=limit,
                offset=offset,
                sort_by=sort_by,
                sort_dir=sort_dir,
            )
        # SQL path covers branch / Cyrillic q (PG) / task_status. Python only for
        # unsupported sort keys (queue_size, active_task, last_result, …).
        sort_expr_map = {
            "online": "is_online",
            "hostname": "hostname_sort",
            "agent_id": "agent_id_sort",
            "branch": "branch_sort",
            "ip_address": "ip_address_sort",
        }
        order_expr = sort_expr_map.get(normalized_sort_by)
        if not order_expr:
            return self._list_agents_table_python(
                q=q,
                branch=branch,
                online=online,
                task_status=task_status,
                limit=limit,
                offset=offset,
                sort_by=sort_by,
                sort_dir=sort_dir,
            )

        # Agent.branch first; empty filled later in _merge from jobs/incidents.
        # Filter also checks jobs/incidents so SQL matches Python branch truth.
        resolved_branch_sql = "COALESCE(NULLIF(a.branch, ''), '')"
        resolved_ip_sql = "COALESCE(NULLIF(a.ip_address, ''), '')"
        needle = str(q or "").strip().lower()
        branch_needle = str(branch or "").strip().lower()
        online_filter = _normalize_online_filter(online)
        status_filters = _normalize_task_status_filter(task_status)
        safe_limit = max(1, min(200, int(limit)))
        safe_offset = max(0, int(offset))
        now_ts = self._now()
        online_cutoff = now_ts - self._agent_online_timeout_sec()
        where_parts: List[str] = []
        params: List[Any] = [online_cutoff]
        if branch_needle:
            branch_like = f"%{branch_needle}%"
            where_parts.append(
                """
                (
                    LOWER(base.resolved_branch) LIKE ?
                    OR EXISTS (
                        SELECT 1 FROM scan_jobs j
                        WHERE j.agent_id = base.agent_id
                          AND LOWER(j.branch) LIKE ?
                    )
                    OR EXISTS (
                        SELECT 1 FROM scan_incidents i
                        WHERE i.agent_id = base.agent_id
                          AND LOWER(i.branch) LIKE ?
                    )
                )
                """
            )
            params.extend([branch_like, branch_like, branch_like])
        if needle:
            from .database import looks_like_hostname_query

            if looks_like_hostname_query(needle):
                where_parts.append(
                    """
                    (
                        base.hostname_sort = ?
                        OR base.hostname_sort LIKE ?
                        OR base.agent_id_sort = ?
                        OR base.agent_id_sort LIKE ?
                    )
                    """
                )
                prefix = f"{needle}%"
                params.extend([needle, prefix, needle, prefix])
            else:
                where_parts.append(
                    """
                    (
                        base.hostname_sort LIKE ?
                        OR base.agent_id_sort LIKE ?
                        OR base.branch_sort LIKE ?
                        OR base.ip_address_sort LIKE ?
                        OR base.version_sort LIKE ?
                    )
                    """
                )
                like_value = f"%{needle}%"
                params.extend([like_value, like_value, like_value, like_value, like_value])
        if online_filter is not None:
            where_parts.append("base.is_online = ?")
            params.append(1 if online_filter else 0)
        if status_filters:
            active_exists = """
                (
                    EXISTS (
                        SELECT 1 FROM scan_tasks t
                        WHERE t.agent_id = base.agent_id
                          AND t.status IN ('queued', 'delivered', 'acknowledged')
                          AND t.ttl_at > ?
                    )
                    OR EXISTS (
                        SELECT 1 FROM scan_jobs j
                        WHERE j.agent_id = base.agent_id
                          AND j.status IN ('queued', 'processing')
                    )
                )
            """
            if "none" in status_filters:
                where_parts.append(f"NOT {active_exists}")
                params.append(now_ts)
            elif any(status_value in ACTIVE_TASK_STATUSES for status_value in status_filters):
                active_statuses = [s for s in status_filters if s in ACTIVE_TASK_STATUSES]
                placeholders = ", ".join("?" for _ in active_statuses)
                # Jobs: processing≈acknowledged, queued≈queued (no delivered mapping).
                job_statuses: List[str] = []
                if "queued" in active_statuses:
                    job_statuses.append("queued")
                if "acknowledged" in active_statuses or "delivered" in active_statuses:
                    job_statuses.append("processing")
                job_clause = ""
                job_params: List[Any] = []
                if job_statuses:
                    job_ph = ", ".join("?" for _ in job_statuses)
                    job_clause = f"""
                        OR EXISTS (
                            SELECT 1 FROM scan_jobs j
                            WHERE j.agent_id = base.agent_id
                              AND j.status IN ({job_ph})
                        )
                    """
                    job_params = list(job_statuses)
                where_parts.append(
                    f"""
                    (
                        EXISTS (
                            SELECT 1 FROM scan_tasks t
                            WHERE t.agent_id = base.agent_id
                              AND t.status IN ({placeholders})
                              AND t.ttl_at > ?
                        )
                        {job_clause}
                    )
                    """
                )
                params.extend([*active_statuses, now_ts, *job_params])
            else:
                # Final / last-task statuses.
                placeholders = ", ".join("?" for _ in status_filters)
                where_parts.append(
                    f"""
                    EXISTS (
                        SELECT 1 FROM (
                            SELECT t.status AS status
                            FROM scan_tasks t
                            WHERE t.agent_id = base.agent_id
                            ORDER BY COALESCE(t.updated_at, t.created_at) DESC, t.created_at DESC
                            LIMIT 1
                        ) last_t
                        WHERE LOWER(last_t.status) IN ({placeholders})
                    )
                    """
                )
                params.extend(list(status_filters))
        where_clause = f"WHERE {' AND '.join(where_parts)}" if where_parts else ""
        order_clause = (
            f"{order_expr} {normalized_sort_dir.upper()}, base.last_seen_at DESC, base.agent_id_sort ASC"
        )

        with self._lock, self._connect() as conn:
            # Explicit columns: never SELECT last_heartbeat_json for table pages.
            # Single page query with window total — avoids double CTE evaluation.
            base_cte = f"""
                WITH base AS (
                    SELECT
                        a.agent_id,
                        a.hostname,
                        a.branch,
                        a.ip_address,
                        a.version,
                        a.status,
                        a.last_seen_at,
                        a.updated_at,
                        a.outbox_depth,
                        a.dead_letter_depth,
                        a.last_ingest_ok_at,
                        {resolved_branch_sql} AS resolved_branch,
                        {resolved_ip_sql} AS resolved_ip_address,
                        CASE WHEN a.last_seen_at >= ? THEN 1 ELSE 0 END AS is_online,
                        LOWER(a.hostname) AS hostname_sort,
                        LOWER(a.agent_id) AS agent_id_sort,
                        LOWER({resolved_branch_sql}) AS branch_sort,
                        LOWER({resolved_ip_sql}) AS ip_address_sort,
                        LOWER(COALESCE(a.version, '')) AS version_sort,
                        0 AS queue_size
                    FROM scan_agents a
                )
            """
            rows = conn.execute(
                f"""
                {base_cte}
                SELECT
                    agent_id, hostname, branch, ip_address, version, status,
                    last_seen_at, updated_at, outbox_depth, dead_letter_depth,
                    last_ingest_ok_at, resolved_branch, resolved_ip_address,
                    is_online, hostname_sort, agent_id_sort, branch_sort,
                    ip_address_sort, version_sort, queue_size,
                    COUNT(*) OVER() AS total_count
                FROM base
                {where_clause}
                ORDER BY {order_clause}
                LIMIT ? OFFSET ?
                """,
                [*params, safe_limit, safe_offset],
            ).fetchall()
            if rows:
                total = int(rows[0]["total_count"] or 0)
            elif safe_offset > 0:
                total = int(
                    conn.execute(
                        f"""
                        {base_cte}
                        SELECT COUNT(*) AS cnt
                        FROM base
                        {where_clause}
                        """,
                        params,
                    ).fetchone()["cnt"]
                    or 0
                )
            else:
                total = 0
            items = self._merge_agent_runtime_rows(list(rows), conn=conn, now_ts=now_ts, slim=True)
        return {"total": total, "items": items, "view": "summary"}

    def list_branches(self) -> List[str]:
        """Distinct branch names only — no full agents list / task merge.

        Push WHERE into each arm so empty-branch fleets do not scan huge
        scan_jobs just to return []. Agents + incidents cover the filter UI;
        jobs rarely add unique labels and dominate cold latency (~400k rows).
        """
        values: Dict[str, str] = {}
        with self._lock, self._connect() as conn:
            rows = conn.execute(
                """
                SELECT DISTINCT TRIM(branch) AS branch_name
                FROM (
                    SELECT branch FROM scan_agents
                    WHERE TRIM(COALESCE(branch, '')) <> ''
                    UNION ALL
                    SELECT branch FROM scan_incidents
                    WHERE TRIM(COALESCE(branch, '')) <> ''
                ) branches
                """
            ).fetchall()

        for row in rows:
            branch_name = str(row["branch_name"] or "").strip()
            if branch_name:
                values.setdefault(branch_name.casefold(), branch_name)

        return [values[key] for key in sorted(values.keys())]
