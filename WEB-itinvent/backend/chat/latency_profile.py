"""Chat latency profiling: stage traces, event-loop stack samples, executor waits.

Profiling-only helpers. Does not change SQL / pool sizes / sequence.
Controlled via env flags (defaults keep production behavior).
"""
from __future__ import annotations

import asyncio
import contextvars
import os
import sys
import threading
import time
import traceback
from collections import Counter
from concurrent.futures import ThreadPoolExecutor
from dataclasses import dataclass, field
from pathlib import Path
from typing import Any, Callable

_ACTIVE_ENDPOINT: contextvars.ContextVar[str] = contextvars.ContextVar("chat_active_endpoint", default="")
_TASK_STATS_LOCK = threading.Lock()
_TASK_STATS: dict[str, Any] = {
    "samples": 0,
    "active_max": 0,
    "active_sum": 0,
    "by_name": Counter(),
    "create_hints": Counter(),
}


def set_active_endpoint(name: str) -> None:
    try:
        _ACTIVE_ENDPOINT.set(str(name or "")[:120])
    except Exception:
        pass


def get_active_endpoint() -> str:
    try:
        return str(_ACTIVE_ENDPOINT.get() or "")
    except Exception:
        return ""


def task_stats_snapshot() -> dict[str, Any]:
    with _TASK_STATS_LOCK:
        samples = int(_TASK_STATS.get("samples") or 0)
        active_sum = float(_TASK_STATS.get("active_sum") or 0)
        by_name = dict((_TASK_STATS.get("by_name") or Counter()).most_common(20))
        return {
            "samples": samples,
            "active_max": int(_TASK_STATS.get("active_max") or 0),
            "active_mean": round(active_sum / samples, 1) if samples else 0.0,
            "top_task_names": by_name,
        }


def _sample_asyncio_tasks() -> dict[str, Any]:
    try:
        tasks = asyncio.all_tasks()
    except Exception:
        return {}
    names = Counter()
    for task in tasks:
        try:
            name = str(task.get_name() or "unknown")
        except Exception:
            name = "unknown"
        names[name.split(":")[0][:60]] += 1
    active = len(tasks)
    with _TASK_STATS_LOCK:
        _TASK_STATS["samples"] = int(_TASK_STATS.get("samples") or 0) + 1
        _TASK_STATS["active_sum"] = float(_TASK_STATS.get("active_sum") or 0) + active
        _TASK_STATS["active_max"] = max(int(_TASK_STATS.get("active_max") or 0), active)
        bucket: Counter = _TASK_STATS.setdefault("by_name", Counter())  # type: ignore[assignment]
        bucket.update(names)
    return {"active_tasks": active, "top_task_names": dict(names.most_common(12))}


def _env_flag(name: str, default: str = "1") -> bool:
    return str(os.getenv(name, default) or default).strip().lower() in {"1", "true", "yes", "on"}


def _env_float(name: str, default: float) -> float:
    try:
        return float(str(os.getenv(name, str(default)) or default).strip() or default)
    except Exception:
        return float(default)


_FLAGS_FILE = Path(__file__).resolve().parents[3] / "tmp" / "chat-profile-flags.json"
_FLAGS_CACHE: dict[str, Any] = {
    "mtime": None,
    "data": {},
    "checked_at": 0.0,
    "source": "env",
    "last_ordinary_snapshot": None,
}
# Never Path.stat() on every request — that itself stalls the event loop under load.
_FLAGS_RELOAD_INTERVAL_SEC = 1.0
_LEGACY_ORDINARY_COMBINED_FLAG = "CHAT_HUB_ORDINARY_NOTIFICATIONS_ENABLED"
_ORDINARY_WRITE_FLAG = "CHAT_HUB_ORDINARY_WRITE_ENABLED"
_ORDINARY_READ_FLAG = "CHAT_HUB_ORDINARY_READ_VISIBLE"


def _parse_bool_flag(value: Any, *, default: bool = True) -> bool:
    if isinstance(value, bool):
        return value
    if value is None:
        return bool(default)
    return str(value).strip().lower() in {"1", "true", "yes", "on"}


def _flags_file_data() -> dict[str, Any]:
    """Hot-reloadable profile flags (no PM2 restart required for disable tests).

    Partially-written JSON is ignored: keep the previous good snapshot.
    Prefer writing the flags file via atomic replace (tmp + os.replace) so all
    workers observe the same complete document after mtime changes.
    """
    now = time.monotonic()
    checked_at = float(_FLAGS_CACHE.get("checked_at") or 0.0)
    if (now - checked_at) < _FLAGS_RELOAD_INTERVAL_SEC:
        return dict(_FLAGS_CACHE.get("data") or {})
    _FLAGS_CACHE["checked_at"] = now
    try:
        if not _FLAGS_FILE.exists():
            _FLAGS_CACHE["mtime"] = None
            _FLAGS_CACHE["data"] = {}
            _FLAGS_CACHE["source"] = "env"
            return {}
        mtime = _FLAGS_FILE.stat().st_mtime
        if _FLAGS_CACHE.get("mtime") == mtime:
            return dict(_FLAGS_CACHE.get("data") or {})
        import json

        # Read full bytes once; reject incomplete/non-object JSON without clobbering cache.
        raw = _FLAGS_FILE.read_bytes()
        if not raw.strip():
            return dict(_FLAGS_CACHE.get("data") or {})
        data = json.loads(raw.decode("utf-8"))
        if not isinstance(data, dict):
            return dict(_FLAGS_CACHE.get("data") or {})
        previous = dict(_FLAGS_CACHE.get("data") or {})
        _FLAGS_CACHE["mtime"] = mtime
        _FLAGS_CACHE["data"] = data
        _FLAGS_CACHE["source"] = "file"
        _maybe_log_ordinary_flag_change(previous=previous, current=data, source="file")
        return dict(data)
    except Exception:
        # Keep last good snapshot on parse/IO errors (partial write / race).
        return dict(_FLAGS_CACHE.get("data") or {})


def _flag(name: str, default: str = "1") -> bool:
    file_data = _flags_file_data()
    if name in file_data:
        return _parse_bool_flag(file_data.get(name), default=_parse_bool_flag(default))
    return _env_flag(name, default)


def _flag_present(name: str) -> bool:
    file_data = _flags_file_data()
    if name in file_data:
        return True
    return os.getenv(name) is not None


def _ordinary_flag(name: str, *, default: str = "1") -> bool:
    """Resolve split ordinary flag with fallback to legacy combined flag."""
    if _flag_present(name):
        return _flag(name, default)
    if _flag_present(_LEGACY_ORDINARY_COMBINED_FLAG):
        return _flag(_LEGACY_ORDINARY_COMBINED_FLAG, default)
    return _flag(name, default)


def _maybe_log_ordinary_flag_change(
    *,
    previous: dict[str, Any],
    current: dict[str, Any],
    source: str,
) -> None:
    try:
        import logging

        keys = (_ORDINARY_WRITE_FLAG, _ORDINARY_READ_FLAG, _LEGACY_ORDINARY_COMBINED_FLAG)
        interesting = any(previous.get(key) != current.get(key) for key in keys if key in current or key in previous)
        if not interesting:
            return
        write_enabled = hub_ordinary_write_enabled()
        read_visible = hub_ordinary_read_visible()
        snapshot = (write_enabled, read_visible, source)
        if _FLAGS_CACHE.get("last_ordinary_snapshot") == snapshot:
            return
        _FLAGS_CACHE["last_ordinary_snapshot"] = snapshot
        logging.getLogger("backend.chat.hub_bell_flags").info(
            "chat.hub_ordinary_flags source=%s write_enabled=%s read_visible=%s pid=%s",
            source,
            int(bool(write_enabled)),
            int(bool(read_visible)),
            os.getpid(),
        )
    except Exception:
        pass


def hub_ordinary_flags_source() -> str:
    _flags_file_data()
    if _flag_present(_ORDINARY_WRITE_FLAG) or _flag_present(_ORDINARY_READ_FLAG) or _flag_present(
        _LEGACY_ORDINARY_COMBINED_FLAG
    ):
        if _FLAGS_CACHE.get("source") == "file" and any(
            key in (_FLAGS_CACHE.get("data") or {})
            for key in (_ORDINARY_WRITE_FLAG, _ORDINARY_READ_FLAG, _LEGACY_ORDINARY_COMBINED_FLAG)
        ):
            return "file"
        return "env"
    return str(_FLAGS_CACHE.get("source") or "env")


# --- Feature flags for subsystem disable tests ---
# Prefer tmp/chat-profile-flags.json for A/B disable runs (hot reload).
CHAT_LAG_STACK_THRESHOLD_MS = _env_float("CHAT_LAG_STACK_THRESHOLD_MS", 200.0)


def audit_enabled() -> bool:
    # Per-stage JSONL tracing is intentionally opt-in: under message fan-out it can
    # generate hundreds of MB and compete with the chat process for CPU and disk.
    return _flag("CHAT_AUDIT_ENABLED", "0")


def profile_stack_enabled() -> bool:
    return _flag("CHAT_PROFILE_STACK_ENABLED", "0")


def presence_sidefx_enabled() -> bool:
    return _flag("CHAT_PRESENCE_SIDEFX_ENABLED", "1")


def hub_clear_after_mark_read_enabled() -> bool:
    return _flag("CHAT_HUB_CLEAR_AFTER_MARK_READ_ENABLED", "1")


def hub_ordinary_write_enabled() -> bool:
    """Create new ordinary chat hub_notifications rows (legacy writer).

    Independent from READ_VISIBLE so rollback can re-enable writes without
    resurfacing ~695k legacy unread in the bell badge.
    """
    return _ordinary_flag(_ORDINARY_WRITE_FLAG, default="1")


def hub_ordinary_read_visible() -> bool:
    """Expose ordinary chat hub rows in poll / unread counts / bell UI."""
    return _ordinary_flag(_ORDINARY_READ_FLAG, default="1")


def hub_ordinary_notifications_enabled() -> bool:
    """Back-compat alias for WRITE_ENABLED."""
    return hub_ordinary_write_enabled()


def inbox_meta_after_send_enabled() -> bool:
    return _flag("CHAT_INBOX_META_AFTER_SEND_ENABLED", "1")


def delivery_state_after_send_enabled() -> bool:
    return _flag("CHAT_DELIVERY_STATE_AFTER_SEND_ENABLED", "1")


def event_outbox_poll_enabled() -> bool:
    return _flag("CHAT_EVENT_OUTBOX_POLL_ENABLED", "1")


def profile_trace(trace_id: str, stage: str, elapsed_ms: float, **fields: Any) -> None:
    if not audit_enabled():
        return
    try:
        from backend.chat.send_audit import audit_send_trace

        audit_send_trace(trace_id=trace_id, stage=stage, elapsed_ms=float(elapsed_ms), **fields)
    except Exception:
        pass


@dataclass
class StageClock:
    """Wall-clock stage accumulator for one request/command."""

    trace_id: str
    kind: str
    t0: float = field(default_factory=time.perf_counter)
    marks: dict[str, float] = field(default_factory=dict)
    stages_ms: dict[str, float] = field(default_factory=dict)

    def mark(self, name: str) -> None:
        self.marks[name] = time.perf_counter()

    def span(self, name: str, start_mark: str, end_mark: str | None = None) -> float:
        end = self.marks.get(end_mark or name) or time.perf_counter()
        start = self.marks.get(start_mark)
        if start is None:
            return 0.0
        ms = max(0.0, (end - start) * 1000.0)
        self.stages_ms[name] = ms
        return ms

    def measure(self, name: str) -> Callable[[], None]:
        started = time.perf_counter()

        def _done() -> None:
            self.stages_ms[name] = max(0.0, (time.perf_counter() - started) * 1000.0)

        return _done

    def total_ms(self) -> float:
        return max(0.0, (time.perf_counter() - self.t0) * 1000.0)

    def accounted_ms(self) -> float:
        return float(sum(self.stages_ms.values()))

    def unaccounted_ms(self) -> float:
        return max(0.0, self.total_ms() - self.accounted_ms())

    def emit(self, *, stage: str = "latency_breakdown") -> None:
        profile_trace(
            self.trace_id,
            stage,
            self.total_ms(),
            kind=self.kind,
            accounted_ms=round(self.accounted_ms(), 1),
            unaccounted_ms=round(self.unaccounted_ms(), 1),
            **{f"{k}": round(float(v), 1) for k, v in self.stages_ms.items()},
        )


# --- Event loop stack sampling ---
# Important: capture from a helper thread DURING the lag window.
# Capturing on the event-loop thread after sleep wakes only shows the probe itself.

_main_thread_id: int | None = None
_lag_stack_lock = threading.Lock()
_last_lag_stack_at = 0.0
_recent_stacks: list[tuple[float, list[dict[str, Any]]]] = []
_sampler_started = False


def note_main_thread() -> None:
    global _main_thread_id
    _main_thread_id = threading.get_ident()
    _ensure_stack_sampler()


def _capture_main_thread_stack(limit: int = 40) -> list[dict[str, Any]]:
    frames = sys._current_frames()
    target = _main_thread_id
    if target is None:
        for thread in threading.enumerate():
            if thread.name == "MainThread":
                target = thread.ident
                break
    if target is None or target not in frames:
        return []
    # Skip our own sampler frames if we ever sample the wrong thread.
    stack = traceback.extract_stack(frames[target], limit=limit)
    out: list[dict[str, Any]] = []
    for frame in stack[-16:]:
        filename = str(frame.filename)
        func = str(frame.name)
        if "latency_profile.py" in filename and func in {
            "_capture_main_thread_stack",
            "_stack_sampler_loop",
            "emit_lag_stack_sample",
        }:
            continue
        out.append(
            {
                "file": filename[-120:],
                "func": func[:80],
                "line": int(frame.lineno or 0),
            }
        )
    return out[-12:]


def _stack_sampler_loop() -> None:
    while True:
        try:
            frames = _capture_main_thread_stack()
            if frames:
                with _lag_stack_lock:
                    _recent_stacks.append((time.time(), frames))
                    if len(_recent_stacks) > 40:
                        del _recent_stacks[: len(_recent_stacks) - 40]
        except Exception:
            pass
        time.sleep(0.05)


def _ensure_stack_sampler() -> None:
    global _sampler_started
    if _sampler_started or not profile_stack_enabled():
        return
    worker = threading.Thread(target=_stack_sampler_loop, name="chat-lag-stack-sampler", daemon=True)
    worker.start()
    _sampler_started = True


def emit_lag_stack_sample(*, lag_ms: float, process: str = "chat") -> None:
    if not profile_stack_enabled() or not audit_enabled():
        return
    if lag_ms < float(CHAT_LAG_STACK_THRESHOLD_MS):
        return
    global _last_lag_stack_at
    now = time.time()
    samples_in_window = 0
    with _lag_stack_lock:
        if (now - _last_lag_stack_at) < 2.0:
            return
        _last_lag_stack_at = now
        # Prefer a stack captured during the lag window (last ~lag_ms).
        window_sec = max(0.2, float(lag_ms) / 1000.0)
        candidates = [item for item in _recent_stacks if (now - item[0]) <= window_sec + 0.05]
        samples_in_window = len(candidates)
        frames = candidates[-1][1] if candidates else (_recent_stacks[-1][1] if _recent_stacks else [])
    # Prefer a frame that is not the profiler itself / idle select.
    top: dict[str, Any] = {}
    for frame in reversed(frames):
        file_name = str(frame.get("file") or "")
        func_name = str(frame.get("func") or "")
        if "latency_profile.py" in file_name:
            continue
        if func_name in {"stat", "exists", "_select"} and (
            "pathlib.py" in file_name or "selectors.py" in file_name
        ):
            continue
        top = frame
        break
    if not top and frames:
        top = frames[-1]
    profile_trace(
        "loop",
        "event_loop_lag_stack",
        lag_ms,
        process=process,
        top_file=top.get("file"),
        top_func=top.get("func"),
        top_line=top.get("line"),
        stack=frames,
        samples_in_window=samples_in_window,
    )


# --- Executor wait instrumentation ---

_EXECUTOR_STATS_LOCK = threading.Lock()
_EXECUTOR_STATS: dict[str, dict[str, float | int]] = {}


def _bump_executor_stat(pool_name: str, *, wait_ms: float, work_ms: float, func_name: str) -> None:
    with _EXECUTOR_STATS_LOCK:
        row = _EXECUTOR_STATS.setdefault(
            pool_name,
            {
                "samples": 0,
                "wait_sum_ms": 0.0,
                "work_sum_ms": 0.0,
                "wait_max_ms": 0.0,
                "work_max_ms": 0.0,
                "active": 0,
            },
        )
        row["samples"] = int(row["samples"]) + 1
        row["wait_sum_ms"] = float(row["wait_sum_ms"]) + float(wait_ms)
        row["work_sum_ms"] = float(row["work_sum_ms"]) + float(work_ms)
        row["wait_max_ms"] = max(float(row["wait_max_ms"]), float(wait_ms))
        row["work_max_ms"] = max(float(row["work_max_ms"]), float(work_ms))
        row["last_func"] = func_name  # type: ignore[assignment]


def executor_snapshot() -> dict[str, Any]:
    with _EXECUTOR_STATS_LOCK:
        return {name: dict(stats) for name, stats in _EXECUTOR_STATS.items()}


def wrap_executor_submit(
    executor: ThreadPoolExecutor,
    *,
    pool_name: str,
    func: Callable[..., Any],
    args: tuple[Any, ...] = (),
    kwargs: dict[str, Any] | None = None,
) -> Any:
    """Submit work and return a Future; records queue wait + work duration."""
    kwargs = kwargs or {}
    queued_at = time.perf_counter()
    func_name = getattr(func, "__name__", str(func))[:80]

    def _invoke() -> Any:
        started = time.perf_counter()
        wait_ms = (started - queued_at) * 1000.0
        with _EXECUTOR_STATS_LOCK:
            row = _EXECUTOR_STATS.setdefault(pool_name, {"active": 0, "samples": 0, "wait_sum_ms": 0.0, "work_sum_ms": 0.0, "wait_max_ms": 0.0, "work_max_ms": 0.0})
            row["active"] = int(row.get("active") or 0) + 1
        try:
            return func(*args, **kwargs)
        finally:
            work_ms = (time.perf_counter() - started) * 1000.0
            with _EXECUTOR_STATS_LOCK:
                row = _EXECUTOR_STATS.setdefault(pool_name, {"active": 0})
                row["active"] = max(0, int(row.get("active") or 0) - 1)
            _bump_executor_stat(pool_name, wait_ms=wait_ms, work_ms=work_ms, func_name=func_name)
            if wait_ms >= 20.0 or work_ms >= 100.0:
                profile_trace(
                    "executor",
                    "executor_job",
                    wait_ms,
                    pool=pool_name,
                    func=func_name,
                    wait_ms=round(wait_ms, 1),
                    work_ms=round(work_ms, 1),
                )

    return executor.submit(_invoke)


async def run_in_named_executor(
    executor: ThreadPoolExecutor,
    pool_name: str,
    func: Callable[..., Any],
    *args: Any,
    **kwargs: Any,
) -> Any:
    loop = asyncio.get_running_loop()
    future = wrap_executor_submit(executor, pool_name=pool_name, func=func, args=args, kwargs=kwargs)
    return await asyncio.wrap_future(future, loop=loop)


_LAST_LAG_CORRELATION_AT = 0.0
_LAG_CORRELATION_MIN_INTERVAL_SEC = 5.0


async def lag_probe_loop(*, process: str = "chat", interval_sec: float = 0.25) -> None:
    note_main_thread()
    global _LAST_LAG_CORRELATION_AT
    while True:
        if not audit_enabled():
            await asyncio.sleep(max(1.0, float(interval_sec)))
            continue
        started = time.perf_counter()
        await asyncio.sleep(interval_sec)
        lag_ms = max(0.0, (time.perf_counter() - started - interval_sec) * 1000.0)
        task_info = _sample_asyncio_tasks()
        if lag_ms >= 20.0:
            profile_trace(
                "loop",
                "event_loop_lag",
                lag_ms,
                process=process,
                endpoint=get_active_endpoint(),
                active_tasks=task_info.get("active_tasks"),
            )
            emit_lag_stack_sample(lag_ms=lag_ms, process=process)
            snap = executor_snapshot()
            if snap and lag_ms >= float(CHAT_LAG_STACK_THRESHOLD_MS):
                profile_trace(
                    "loop",
                    "executor_snapshot_on_lag",
                    lag_ms,
                    process=process,
                    pools=snap,
                    tasks=task_stats_snapshot(),
                )
            # Rate-limited correlation bundle (one detailed snapshot per window).
            now = time.time()
            if lag_ms >= float(CHAT_LAG_STACK_THRESHOLD_MS) and (
                now - _LAST_LAG_CORRELATION_AT
            ) >= float(_LAG_CORRELATION_MIN_INTERVAL_SEC):
                _LAST_LAG_CORRELATION_AT = now
                convoy = {}
                try:
                    from backend.chat.send_inflight_tracker import lock_convoy_snapshot

                    convoy = lock_convoy_snapshot(top_n=10)
                except Exception:
                    convoy = {}
                cpu_percent = None
                try:
                    import os

                    import psutil  # type: ignore

                    cpu_percent = float(psutil.Process(os.getpid()).cpu_percent(interval=None))
                except Exception:
                    cpu_percent = None
                profile_trace(
                    "loop",
                    "event_loop_lag_correlation",
                    lag_ms,
                    process=process,
                    endpoint=get_active_endpoint(),
                    active_tasks=task_info.get("active_tasks"),
                    pools=snap,
                    lock_convoy=convoy,
                    process_cpu_percent=cpu_percent,
                    wall_ts_ms=int(time.time() * 1000),
                )
