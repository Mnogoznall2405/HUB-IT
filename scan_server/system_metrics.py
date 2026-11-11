from __future__ import annotations

import logging
import os
import threading
import time
from typing import Any, Callable, Dict, Optional

from .memory_guard import get_process_rss_bytes

try:
    import psutil
except Exception:  # pragma: no cover - production dependency guard
    psutil = None  # type: ignore[assignment]


logger = logging.getLogger(__name__)

_DEFAULT_SAMPLE_INTERVAL_SEC = 30.0
_SAMPLE_INTERVAL_MIN = 10
_SAMPLE_INTERVAL_MAX = 300


def resolve_system_metrics_sample_interval_sec(
    raw: str | None = None,
    *,
    default: float = _DEFAULT_SAMPLE_INTERVAL_SEC,
) -> float:
    """Parse SCAN_SYSTEM_METRICS_SAMPLE_INTERVAL_SECONDS.

    Accept only integers in [10, 300]; otherwise return safe default 30.
    """
    if raw is None:
        raw = os.getenv("SCAN_SYSTEM_METRICS_SAMPLE_INTERVAL_SECONDS")
    if raw is None or str(raw).strip() == "":
        return float(default)
    try:
        value = int(str(raw).strip())
    except Exception:
        return float(default)
    if value < _SAMPLE_INTERVAL_MIN or value > _SAMPLE_INTERVAL_MAX:
        return float(default)
    return float(value)


class SystemMetricsCollector:
    def __init__(
        self,
        *,
        psutil_module: Any = None,
        process_rss_provider: Callable[[], int] = get_process_rss_bytes,
    ) -> None:
        self._psutil = psutil_module if psutil_module is not None else psutil
        self._process_rss_provider = process_rss_provider
        self._previous: Optional[Dict[str, float]] = None

    @property
    def available(self) -> bool:
        return self._psutil is not None

    def collect(
        self,
        *,
        captured_at: Optional[int] = None,
        monotonic_at: Optional[float] = None,
    ) -> Dict[str, Any]:
        if self._psutil is None:
            raise RuntimeError("psutil is unavailable")
        captured = int(captured_at if captured_at is not None else time.time())
        monotonic_value = float(monotonic_at if monotonic_at is not None else time.monotonic())
        memory = self._psutil.virtual_memory()
        disk = self._psutil.disk_io_counters()
        network = self._psutil.net_io_counters()
        counters = {
            "monotonic": monotonic_value,
            "disk_read_bytes": float(getattr(disk, "read_bytes", 0) or 0),
            "disk_write_bytes": float(getattr(disk, "write_bytes", 0) or 0),
            "network_sent_bytes": float(getattr(network, "bytes_sent", 0) or 0),
            "network_received_bytes": float(getattr(network, "bytes_recv", 0) or 0),
        }
        rates = {
            "disk_read_bps": 0.0,
            "disk_write_bps": 0.0,
            "network_sent_bps": 0.0,
            "network_received_bps": 0.0,
        }
        if self._previous is not None:
            elapsed = max(0.001, monotonic_value - float(self._previous["monotonic"]))
            for name in rates:
                counter_name = name.removesuffix("_bps") + "_bytes"
                rates[name] = round(
                    max(0.0, counters[counter_name] - float(self._previous[counter_name])) / elapsed,
                    2,
                )
        self._previous = counters
        return {
            "captured_at": captured,
            "cpu_percent": round(float(self._psutil.cpu_percent(interval=None) or 0.0), 2),
            "memory_percent": round(float(getattr(memory, "percent", 0.0) or 0.0), 2),
            "memory_used_bytes": int(getattr(memory, "used", 0) or 0),
            "memory_available_bytes": int(getattr(memory, "available", 0) or 0),
            "disk_read_bytes": int(counters["disk_read_bytes"]),
            "disk_write_bytes": int(counters["disk_write_bytes"]),
            "network_sent_bytes": int(counters["network_sent_bytes"]),
            "network_received_bytes": int(counters["network_received_bytes"]),
            "process_rss_bytes": int(self._process_rss_provider() or 0),
            **rates,
        }


class SystemMetricsSampler(threading.Thread):
    """Background sampler decoupled from agent heartbeat / online-offline.

    Uses a monotonic schedule so reconnects/retries do not emit duplicate samples.
    Persist errors are isolated and never block the heartbeat path.
    """

    def __init__(
        self,
        *,
        store: Any,
        stop_event: threading.Event,
        interval_sec: float | None = None,
    ) -> None:
        super().__init__(daemon=True, name="scan-system-metrics")
        self.store = store
        self.stop_event = stop_event
        if interval_sec is None:
            self.interval_sec = resolve_system_metrics_sample_interval_sec()
        else:
            try:
                candidate = float(interval_sec)
            except Exception:
                candidate = _DEFAULT_SAMPLE_INTERVAL_SEC
            if candidate < _SAMPLE_INTERVAL_MIN or candidate > _SAMPLE_INTERVAL_MAX:
                candidate = _DEFAULT_SAMPLE_INTERVAL_SEC
            self.interval_sec = candidate
        self.collector = SystemMetricsCollector()
        self._sample_lock = threading.Lock()
        self._last_sample_mono: float | None = None

    def run(self) -> None:
        if not self.collector.available:
            logger.error("Scan system metrics are disabled: psutil is unavailable")
            return
        logger.info("Scan system metrics sampler started: interval=%.1fs", self.interval_sec)
        next_due = time.monotonic()
        while not self.stop_event.is_set():
            now_mono = time.monotonic()
            wait_sec = max(0.0, next_due - now_mono)
            if wait_sec > 0 and self.stop_event.wait(wait_sec):
                break
            if self.stop_event.is_set():
                break
            # Skip if a previous sample is still in progress (no parallel writes).
            if not self._sample_lock.acquire(blocking=False):
                next_due = time.monotonic() + self.interval_sec
                continue
            try:
                # Deduplicate: ignore if we already sampled within half-interval.
                sample_mono = time.monotonic()
                if (
                    self._last_sample_mono is not None
                    and (sample_mono - self._last_sample_mono) < (self.interval_sec * 0.5)
                ):
                    next_due = self._last_sample_mono + self.interval_sec
                    continue
                sample = self.collector.collect(monotonic_at=sample_mono)
                task_ids = self.store.active_scan_task_ids()
                if task_ids:
                    self.store.record_system_metric_samples(task_ids=task_ids, sample=sample)
                self._last_sample_mono = sample_mono
                next_due = sample_mono + self.interval_sec
            except Exception as exc:
                logger.warning("Scan system metrics sample failed: %s", exc)
                # Keep cadence even on persist errors; do not stall heartbeat/tasks.
                next_due = time.monotonic() + self.interval_sec
            finally:
                self._sample_lock.release()
        logger.info("Scan system metrics sampler stopped")
