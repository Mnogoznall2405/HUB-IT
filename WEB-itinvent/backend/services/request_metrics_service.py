"""
In-process HTTP request metrics for operational tuning.
"""
from __future__ import annotations

import logging
import os
import re
import time
import uuid
from collections import Counter, deque
from dataclasses import dataclass, field
from datetime import datetime, timezone
from threading import Lock
from typing import Any, Awaitable, Callable

from starlette.requests import Request
from starlette.responses import Response
import anyio


logger = logging.getLogger("backend.request_metrics")

_UUID_SEGMENT_RE = re.compile(
    r"^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$"
)
_LONG_TOKEN_SEGMENT_RE = re.compile(r"^[A-Za-z0-9_-]{24,}$")


def _env_flag(name: str, default: str = "1") -> bool:
    return str(os.getenv(name, default)).strip().lower() in {"1", "true", "yes", "on"}


def _env_int(name: str, default: int, minimum: int, maximum: int) -> int:
    raw = str(os.getenv(name, str(default)) or "").strip()
    try:
        value = int(raw)
    except (TypeError, ValueError):
        value = int(default)
    return max(int(minimum), min(int(maximum), value))


def _env_float(name: str, default: float, minimum: float, maximum: float) -> float:
    raw = str(os.getenv(name, str(default)) or "").strip()
    try:
        value = float(raw)
    except (TypeError, ValueError):
        value = float(default)
    return max(float(minimum), min(float(maximum), value))


def _utc_iso(timestamp: float) -> str:
    return datetime.fromtimestamp(float(timestamp), tz=timezone.utc).isoformat()


def _percentile(values: list[float], percentile: float) -> float:
    if not values:
        return 0.0
    ordered = sorted(float(value) for value in values)
    if len(ordered) == 1:
        return ordered[0]
    rank = max(0.0, min(1.0, float(percentile) / 100.0)) * (len(ordered) - 1)
    lower = int(rank)
    upper = min(lower + 1, len(ordered) - 1)
    if lower == upper:
        return ordered[lower]
    weight = rank - lower
    return ordered[lower] + (ordered[upper] - ordered[lower]) * weight


def _normalize_unmatched_path(path: str) -> str:
    parts: list[str] = []
    for segment in str(path or "/").strip("/").split("/"):
        if not segment:
            continue
        if segment.isdigit() or _UUID_SEGMENT_RE.match(segment) or _LONG_TOKEN_SEGMENT_RE.match(segment):
            parts.append("{id}")
        else:
            parts.append(segment)
    return "/" + "/".join(parts)


@dataclass
class _RouteRequestStats:
    method: str
    path: str
    sample_size: int
    count: int = 0
    server_error_count: int = 0
    client_error_count: int = 0
    total_ms: float = 0.0
    max_ms: float = 0.0
    first_seen_at: float = field(default_factory=time.time)
    last_seen_at: float = field(default_factory=time.time)
    status_counts: Counter[str] = field(default_factory=Counter)
    samples_ms: deque[float] = field(default_factory=deque)

    def __post_init__(self) -> None:
        self.samples_ms = deque(maxlen=max(1, int(self.sample_size)))

    def record(self, *, status_code: int, duration_ms: float, now: float) -> None:
        status = int(status_code or 0)
        elapsed = max(0.0, float(duration_ms))
        self.count += 1
        self.total_ms += elapsed
        self.max_ms = max(self.max_ms, elapsed)
        self.last_seen_at = now
        self.status_counts[str(status)] += 1
        self.samples_ms.append(elapsed)
        if status >= 500:
            self.server_error_count += 1
        elif status >= 400:
            self.client_error_count += 1

    def snapshot(self) -> dict[str, Any]:
        samples = list(self.samples_ms)
        mean_ms = self.total_ms / self.count if self.count else 0.0
        return {
            "method": self.method,
            "path": self.path,
            "count": self.count,
            "server_error_count": self.server_error_count,
            "client_error_count": self.client_error_count,
            "server_error_rate": round(self.server_error_count / self.count, 4) if self.count else 0.0,
            "client_error_rate": round(self.client_error_count / self.count, 4) if self.count else 0.0,
            "mean_ms": round(mean_ms, 1),
            "p50_ms": round(_percentile(samples, 50), 1),
            "p95_ms": round(_percentile(samples, 95), 1),
            "p99_ms": round(_percentile(samples, 99), 1),
            "max_ms": round(self.max_ms, 1),
            "sample_count": len(samples),
            "status_counts": dict(sorted(self.status_counts.items())),
            "first_seen_at": _utc_iso(self.first_seen_at),
            "last_seen_at": _utc_iso(self.last_seen_at),
        }


class RequestMetricsService:
    def __init__(self) -> None:
        self._lock = Lock()
        self._routes: dict[tuple[str, str], _RouteRequestStats] = {}
        self._started_at = time.time()
        self._total_requests = 0
        self._total_server_errors = 0

    @property
    def enabled(self) -> bool:
        return _env_flag("REQUEST_METRICS_ENABLED", "1")

    @property
    def max_routes(self) -> int:
        return _env_int("REQUEST_METRICS_MAX_ROUTES", 300, 20, 5000)

    @property
    def sample_size(self) -> int:
        return _env_int("REQUEST_METRICS_SAMPLE_SIZE", 512, 20, 5000)

    @property
    def slow_threshold_ms(self) -> float:
        return _env_float("REQUEST_METRICS_SLOW_MS", 1000.0, 50.0, 60000.0)

    def reset(self) -> None:
        with self._lock:
            self._routes.clear()
            self._started_at = time.time()
            self._total_requests = 0
            self._total_server_errors = 0

    def route_path_for_request(self, request: Request) -> str:
        route = request.scope.get("route")
        route_path = str(getattr(route, "path", "") or "").strip()
        if route_path:
            return route_path
        return _normalize_unmatched_path(str(request.url.path or "/"))

    def record(self, *, method: str, path: str, status_code: int, duration_ms: float) -> None:
        if not self.enabled:
            return
        method_key = str(method or "GET").strip().upper() or "GET"
        path_key = str(path or "/").strip() or "/"
        now = time.time()
        key = (method_key, path_key)
        with self._lock:
            bucket = self._routes.get(key)
            if bucket is None:
                if len(self._routes) >= self.max_routes:
                    oldest_key = min(self._routes.items(), key=lambda item: item[1].last_seen_at)[0]
                    self._routes.pop(oldest_key, None)
                bucket = _RouteRequestStats(method=method_key, path=path_key, sample_size=self.sample_size)
                self._routes[key] = bucket
            bucket.record(status_code=int(status_code or 0), duration_ms=float(duration_ms), now=now)
            self._total_requests += 1
            if int(status_code or 0) >= 500:
                self._total_server_errors += 1

    def should_log_slow(self, duration_ms: float) -> bool:
        return self.enabled and float(duration_ms or 0.0) >= self.slow_threshold_ms

    def snapshot(self, *, limit: int = 50, sort_by: str = "p95_ms") -> dict[str, Any]:
        valid_sort_keys = {"count", "mean_ms", "p95_ms", "p99_ms", "max_ms", "server_error_count"}
        sort_key = sort_by if sort_by in valid_sort_keys else "p95_ms"
        with self._lock:
            routes = [bucket.snapshot() for bucket in self._routes.values()]
            total_requests = self._total_requests
            total_server_errors = self._total_server_errors
            started_at = self._started_at

        routes.sort(key=lambda item: (float(item.get(sort_key) or 0), int(item.get("count") or 0)), reverse=True)
        limited_routes = routes[: max(1, min(200, int(limit or 50)))]
        return {
            "enabled": self.enabled,
            "started_at": _utc_iso(started_at),
            "uptime_sec": round(max(0.0, time.time() - started_at), 1),
            "route_count": len(routes),
            "total_requests": total_requests,
            "total_server_errors": total_server_errors,
            "server_error_rate": round(total_server_errors / total_requests, 4) if total_requests else 0.0,
            "slow_threshold_ms": self.slow_threshold_ms,
            "sort_by": sort_key,
            "routes": limited_routes,
            "hotspots": self._build_hotspots(routes),
            "pools": self._pool_status(),
            "background_jobs": self._background_job_status(),
        }

    @staticmethod
    def _engine_pool_status(engine) -> dict[str, Any]:
        pool = engine.pool
        payload = {"status": str(pool.status())}
        for name in ("size", "checkedin", "checkedout", "overflow"):
            method = getattr(pool, name, None)
            if callable(method):
                try:
                    payload[name] = int(method())
                except Exception:
                    pass
        return payload

    def _pool_status(self) -> dict[str, Any]:
        payload: dict[str, Any] = {}
        try:
            from backend.appdb.db import get_app_engine, is_app_database_configured
            if is_app_database_configured():
                payload["app"] = self._engine_pool_status(get_app_engine())
        except Exception as exc:
            payload["app"] = {"error": type(exc).__name__}
        try:
            from backend.chat.db import get_chat_engine, is_chat_enabled
            if is_chat_enabled():
                payload["chat"] = self._engine_pool_status(get_chat_engine())
        except Exception as exc:
            payload["chat"] = {"error": type(exc).__name__}
        return payload

    @staticmethod
    def _background_job_status() -> dict[str, Any]:
        payload: dict[str, Any] = {}
        try:
            from backend.services.ad_app_user_import_service import load_ad_app_user_sync_state
            payload["ad_sync"] = load_ad_app_user_sync_state()
        except Exception as exc:
            payload["ad_sync"] = {"status": "error", "error": type(exc).__name__}
        try:
            from backend.services.mail_notification_service import mail_notification_service
            mail_status = mail_notification_service.get_runtime_status()
            try:
                from sqlalchemy import func, select
                from backend.appdb.db import app_session, is_app_database_configured
                from backend.appdb.models import AppMailRuntimeSnapshot
                if is_app_database_configured():
                    with app_session() as session:
                        rows = session.execute(
                            select(
                                AppMailRuntimeSnapshot.snapshot_type,
                                func.count(AppMailRuntimeSnapshot.id),
                                func.max(AppMailRuntimeSnapshot.as_of),
                                func.max(AppMailRuntimeSnapshot.updated_at),
                            ).group_by(AppMailRuntimeSnapshot.snapshot_type)
                        ).all()
                    mail_status["shared_snapshots"] = {
                        str(snapshot_type): {
                            "count": int(count or 0),
                            "last_success_at": last_success_at.isoformat() if last_success_at else None,
                            "last_update_at": last_update_at.isoformat() if last_update_at else None,
                        }
                        for snapshot_type, count, last_success_at, last_update_at in rows
                    }
            except Exception as exc:
                mail_status["shared_snapshot_error"] = type(exc).__name__
            payload["mail_sync"] = mail_status
        except Exception as exc:
            payload["mail_sync"] = {"status": "error", "error": type(exc).__name__}
        return payload

    def _build_hotspots(self, routes: list[dict[str, Any]]) -> list[dict[str, Any]]:
        total = sum(int(item.get("count") or 0) for item in routes)
        threshold_ms = self.slow_threshold_ms
        hotspots: list[dict[str, Any]] = []
        for item in routes:
            count = int(item.get("count") or 0)
            p95_ms = float(item.get("p95_ms") or 0.0)
            mean_ms = float(item.get("mean_ms") or 0.0)
            server_error_rate = float(item.get("server_error_rate") or 0.0)
            traffic_share = (count / total) if total else 0.0
            reason = ""
            severity = "info"
            if server_error_rate >= 0.02 and count >= 5:
                severity = "high"
                reason = "server_error_rate"
            elif p95_ms >= threshold_ms:
                severity = "high" if p95_ms >= threshold_ms * 2 else "medium"
                reason = "slow_p95"
            elif traffic_share >= 0.2 and mean_ms >= 200:
                severity = "medium"
                reason = "hot_path"
            if not reason:
                continue
            hotspots.append(
                {
                    "severity": severity,
                    "reason": reason,
                    "method": item.get("method"),
                    "path": item.get("path"),
                    "count": count,
                    "traffic_share": round(traffic_share, 4),
                    "mean_ms": item.get("mean_ms"),
                    "p95_ms": item.get("p95_ms"),
                    "p99_ms": item.get("p99_ms"),
                    "server_error_rate": item.get("server_error_rate"),
                }
            )
            if len(hotspots) >= 10:
                break
        return hotspots


request_metrics_service = RequestMetricsService()


async def request_metrics_middleware(
    request: Request,
    call_next: Callable[[Request], Awaitable[Response]],
) -> Response:
    started_at = time.perf_counter()
    status_code = 500
    correlation_id = str(request.headers.get("X-Correlation-ID") or request.headers.get("X-Request-ID") or uuid.uuid4())
    borrowed_tokens = None
    try:
        response = await call_next(request)
        status_code = int(getattr(response, "status_code", 500) or 500)
        response.headers["X-Correlation-ID"] = correlation_id
        return response
    except Exception:
        status_code = 500
        raise
    finally:
        duration_ms = (time.perf_counter() - started_at) * 1000.0
        try:
            borrowed_tokens = int(anyio.to_thread.current_default_thread_limiter().borrowed_tokens)
        except Exception:
            borrowed_tokens = None
        path = request_metrics_service.route_path_for_request(request)
        request_metrics_service.record(
            method=request.method,
            path=path,
            status_code=status_code,
            duration_ms=duration_ms,
        )
        if request_metrics_service.should_log_slow(duration_ms):
            logger.warning(
                "http.slow timestamp=%s correlation_id=%s method=%s path=%s status=%s took_ms=%.1f anyio_borrowed_tokens=%s pools=%s",
                _utc_iso(time.time()),
                correlation_id,
                request.method,
                path,
                status_code,
                duration_ms,
                borrowed_tokens,
                request_metrics_service._pool_status(),
            )
