"""A1: centralized timeout/liveness policy for AI worker paths.

Layered model (driver timeouts are the primary mechanism — a Python-level
deadline cannot kill a blocking thread):

  Layer 1 — drivers: SQL Server ``conn.timeout`` (AI-scoped via
    ``ai_sql_query_timeout`` ContextVar), ldap3 ``connect_timeout`` /
    ``receive_timeout``, exchangelib per-request timeout, subprocess
    timeouts. These actually release the blocked call.
  Layer 2 — orchestration: ``ai_tool_wall_timeout_sec`` bounds how long the
    *run* waits for one tool call. On timeout the call is abandoned (the
    worker thread may keep running until the driver frees it) and the
    leaked thread is counted.
  Layer 3 — run: ``ai_run_timeout_sec`` is a cooperative deadline checked at
    stage checkpoints; combined with Layers 1-2 the overshoot is at most one
    tool timeout.
  Layer 4 — recovery: watchdog (opt-in) reaps orphaned runs; queued runs get
    a separate, longer threshold so queue backlog is not mistaken for a hang.

Every knob is env-configurable with safe defaults and clamped ranges.
"""

from __future__ import annotations

import os


def _env_seconds(name: str, default: float, minimum: float, maximum: float) -> float:
    raw = str(os.environ.get(name, "") or "").strip()
    try:
        value = float(raw) if raw else float(default)
    except (TypeError, ValueError):
        value = float(default)
    return max(minimum, min(maximum, value))


def _env_int(name: str, default: int, minimum: int, maximum: int) -> int:
    raw = str(os.environ.get(name, "") or "").strip()
    try:
        value = int(raw) if raw else int(default)
    except (TypeError, ValueError):
        value = int(default)
    return max(minimum, min(maximum, value))


def ai_tool_wall_timeout_sec() -> float:
    """Max seconds a run waits for a single tool call (default 120)."""
    return _env_seconds("AI_TOOL_WALL_TIMEOUT_SEC", 120.0, 5.0, 1800.0)


def ai_tool_executor_workers() -> int:
    """Dedicated tool executor size; exhaustion degrades to timeout errors,
    never to an unbounded wait (default 12 — covers ~4 concurrent runs each
    issuing a small parallel group)."""
    return _env_int("AI_TOOL_EXECUTOR_WORKERS", 12, 1, 32)


def ai_tool_executor_max_pending() -> int:
    """A1 admission control: max tool calls accepted beyond ``workers`` and
    left waiting in the executor queue. Past ``workers + max_pending`` the
    call is *rejected* with a distinct capacity error — it never starts, so
    the "unknown outcome" message is never emitted for it (default 24)."""
    return _env_int("AI_TOOL_EXECUTOR_MAX_PENDING", 24, 0, 256)


def ai_sql_query_timeout_sec() -> float:
    """SQL Server statement timeout for reads issued by AI tools (default 60s).
    Applies only inside AI tool execution — UI/API paths keep the driver
    default (unlimited) so legit long exports are untouched."""
    return _env_seconds("AI_SQL_QUERY_TIMEOUT_SEC", 60.0, 5.0, 600.0)


def ai_sql_mutation_timeout_sec() -> float:
    """SQL Server statement timeout for AI action-card confirms (writes).
    Longer than reads because batch transfers/consume operations are heavier
    (default 120s)."""
    return _env_seconds("AI_SQL_MUTATION_TIMEOUT_SEC", 120.0, 5.0, 900.0)


def ai_run_timeout_sec() -> float:
    """Cooperative deadline for one whole AI run (default 900s — matches the
    watchdog stale threshold so a run fails cleanly before being reaped)."""
    return _env_seconds("AI_RUN_TIMEOUT_SEC", 900.0, 60.0, 7200.0)


def watchdog_stale_sec() -> int:
    return max(60, int(os.environ.get("AI_RUN_WATCHDOG_STALE_SEC", "900") or 900))


def watchdog_queued_stale_sec() -> int:
    """Stale threshold for never-claimed ``queued`` runs (default 1800s).
    Kept above the running threshold: a busy-but-alive worker legitimately
    holds queued rows for a long time — only a dead worker leaves them
    unclaimed this long."""
    return max(
        watchdog_stale_sec(),
        _env_int("AI_RUN_WATCHDOG_QUEUED_STALE_SEC", 1800, 60, 86400),
    )


def ai_worker_heartbeat_interval_sec() -> float:
    """How often the claim loop writes its liveness heartbeat (default 15s)."""
    return _env_seconds("AI_WORKER_HEARTBEAT_SEC", 15.0, 5.0, 300.0)


def ai_worker_heartbeat_fresh_sec() -> float:
    """Max heartbeat age for the watchdog to treat the claim loop as alive.
    Only a LIVE loop may reap stale queued rows; absent/stale heartbeat →
    queued rows are left untouched (a future worker can still claim them)."""
    return _env_seconds("AI_WORKER_HEARTBEAT_FRESH_SEC", 120.0, 30.0, 3600.0)


def ai_voice_scan_max_entries() -> int:
    """Hard bound on filesystem entries inspected per voice scan (P2)."""
    return _env_int("AI_VOICE_SCAN_MAX_ENTRIES", 5000, 100, 100000)


def ai_action_confirm_timeout_sec() -> float:
    """HTTP-level bound for action-card confirm calls (default 130s, just
    above the mail-send budget so the driver's own timeout fires first)."""
    return _env_seconds("AI_ACTION_CONFIRM_TIMEOUT_SEC", 130.0, 10.0, 600.0)


def ai_voice_report_max_files() -> int:
    """Cap on ``*_report.json`` files scanned per voice tool call."""
    return _env_int("AI_VOICE_REPORT_MAX_FILES", 300, 10, 5000)


def ai_voice_report_max_bytes() -> int:
    return _env_int("AI_VOICE_REPORT_MAX_BYTES", 2 * 1024 * 1024, 64 * 1024, 64 * 1024 * 1024)


def ai_doc_extract_max_bytes() -> int:
    """Max file size read into memory by document extractors (default 50MB)."""
    return _env_int("AI_DOC_EXTRACT_MAX_BYTES", 50 * 1024 * 1024, 1024 * 1024, 512 * 1024 * 1024)


def ai_warehouse_call_timeout_sec() -> float:
    """Bound for 1C warehouse coroutines; above the internal 45s budget so the
    driver's own deadline fires first (default 75s)."""
    return _env_seconds("AI_WAREHOUSE_CALL_TIMEOUT_SEC", 75.0, 10.0, 600.0)


def ai_mfu_snapshot_timeout_sec() -> float:
    return _env_seconds("AI_MFU_SNAPSHOT_TIMEOUT_SEC", 5.0, 1.0, 60.0)


def mail_singleflight_wait_sec() -> float:
    """Max seconds a non-leader waits on a singleflight call before running
    its own producer (default 120)."""
    return _env_seconds("MAIL_SINGLEFLIGHT_WAIT_SEC", 120.0, 5.0, 900.0)
