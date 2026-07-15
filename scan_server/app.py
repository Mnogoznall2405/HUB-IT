from __future__ import annotations

import asyncio
import json
import os
import logging
import hashlib
import sqlite3
import socket
import sys
import threading
import time
from contextlib import asynccontextmanager
from io import BytesIO
from pathlib import Path
from typing import Any, Dict, List, Optional
from urllib.error import HTTPError, URLError
from urllib.request import Request as UrlRequest, urlopen

from fastapi import Cookie, Depends, FastAPI, File, Form, Header, HTTPException, Query, Request, UploadFile, status
from fastapi.responses import StreamingResponse
from fastapi.security import HTTPAuthorizationCredentials, HTTPBearer
from pydantic import BaseModel
from agent_version import SCAN_ANALYSIS_VERSION, SCAN_OCR_PAGE_LIMIT, SCAN_TEXT_PAGE_LIMIT

from .config import config
from .database import ScanStore
from .memory_guard import get_process_rss_bytes
from .ocr import FOCUSED_REGION_DPI, MAX_FOCUSED_REGION_PIXELS, MAX_RENDERED_PAGE_PIXELS
from .patterns import list_patterns
from .report_export import XLSX_MEDIA_TYPE, build_scan_task_incidents_excel
from .system_metrics import SystemMetricsSampler
from .worker import ScanWorker

logging.basicConfig(
    level=logging.INFO,
    format="%(asctime)s [%(levelname)s] %(message)s",
    datefmt="%Y-%m-%d %H:%M:%S",
)
logger = logging.getLogger("scan-server")
security_optional = HTTPBearer(auto_error=False)
AUTH_COOKIE_NAME = str(os.getenv("AUTH_COOKIE_NAME", "itinvent_access_token")).strip() or "itinvent_access_token"
PERM_SCAN_READ = "scan.read"
PERM_SCAN_ACK = "scan.ack"
PERM_SCAN_TASKS = "scan.tasks"

if sys.platform.startswith("win") and hasattr(asyncio, "WindowsSelectorEventLoopPolicy"):
    # Proactor loop on Windows can leave uvicorn alive but no longer accepting
    # new connections after transient socket errors such as WinError 64.
    asyncio.set_event_loop_policy(asyncio.WindowsSelectorEventLoopPolicy())


def _now_ts() -> int:
    return int(time.time())


class IngestPayload(BaseModel):
    agent_id: str
    hostname: str
    branch: Optional[str] = ""
    user_login: Optional[str] = ""
    user_full_name: Optional[str] = ""
    file_path: str
    file_name: Optional[str] = ""
    file_hash: Optional[str] = ""
    file_size: Optional[int] = 0
    source_kind: Optional[str] = "unknown"
    event_id: Optional[str] = ""
    scan_task_id: Optional[str] = ""
    text_excerpt: Optional[str] = ""
    pdf_slice_b64: Optional[str] = ""
    document_b64: Optional[str] = ""
    local_pattern_hits: Optional[List[Dict[str, Any]]] = None
    metadata: Optional[Dict[str, Any]] = None


class HeartbeatPayload(BaseModel):
    agent_id: str
    hostname: str
    branch: Optional[str] = ""
    ip_address: Optional[str] = ""
    version: Optional[str] = ""
    status: Optional[str] = "online"
    queue_pending: Optional[int] = 0
    last_seen_at: Optional[int] = None
    metadata: Optional[Dict[str, Any]] = None


class TaskCreatePayload(BaseModel):
    agent_id: str
    command: str
    payload: Optional[Dict[str, Any]] = None
    dedupe_key: Optional[str] = None


class TaskResultPayload(BaseModel):
    agent_id: str
    status: str
    result: Optional[Dict[str, Any]] = None
    error_text: Optional[str] = ""


class IncidentAckPayload(BaseModel):
    ack_by: Optional[str] = ""


class IncidentBulkAckPayload(BaseModel):
    incident_ids: Optional[List[str]] = None
    filters: Optional[Dict[str, Any]] = None
    ack_by: Optional[str] = ""
    confirm_all: bool = False


store = ScanStore(
    db_path=config.db_path,
    archive_dir=config.archive_dir,
    task_ack_timeout_sec=config.task_ack_timeout_sec,
    agent_online_timeout_sec=config.agent_online_timeout_sec,
    resolve_agent_sql_context=config.resolve_agent_sql_context,
    job_processing_timeout_sec=config.job_processing_timeout_sec,
    sqlite_busy_timeout_ms=config.sqlite_busy_timeout_ms,
    sqlite_busy_retry_attempts=config.sqlite_busy_retry_attempts,
    sqlite_busy_retry_base_ms=config.sqlite_busy_retry_base_ms,
)
stop_event = threading.Event()
watchdog_stop_event = threading.Event()
worker: Optional[ScanWorker] = (
    ScanWorker(store=store, config=config, stop_event=stop_event)
    if config.scan_worker_enabled
    else None
)
watchdog_thread: Optional[threading.Thread] = None
startup_maintenance_thread: Optional[threading.Thread] = None
ingest_semaphore: Optional[asyncio.Semaphore] = None
ingest_semaphore_loop: Optional[asyncio.AbstractEventLoop] = None
dashboard_cache_lock = threading.Lock()
dashboard_cache_payload: Optional[Dict[str, Any]] = None
dashboard_cache_ts = 0.0
web_auth_cache_lock = threading.Lock()
web_auth_cache: Dict[str, tuple[float, Dict[str, Any]]] = {}
SYSTEM_METRICS_INTERVAL_SEC = 5.0
metrics_sampler: Optional[SystemMetricsSampler] = None


def _key_fingerprint(value: Optional[str]) -> str:
    token = str(value or "").strip()
    if not token:
        return "none"
    return hashlib.sha256(token.encode("utf-8", errors="ignore")).hexdigest()[:12]


def _check_agent_key(x_api_key: Optional[str]) -> None:
    token = str(x_api_key or "").strip()
    if not token or token not in set(config.api_keys):
        logger.warning("Scan API rejected unknown key fingerprint=%s", _key_fingerprint(token))
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Invalid API key",
        )


def _resolve_access_token(
    credentials: Optional[HTTPAuthorizationCredentials],
    access_token_cookie: Optional[str],
) -> Optional[str]:
    if credentials and credentials.credentials:
        return credentials.credentials
    if access_token_cookie:
        return str(access_token_cookie).strip() or None
    return None


def _credentials_exception() -> HTTPException:
    return HTTPException(
        status_code=status.HTTP_401_UNAUTHORIZED,
        detail="Could not validate credentials",
        headers={"WWW-Authenticate": "Bearer"},
    )


def _forbidden_exception(permission: str) -> HTTPException:
    return HTTPException(
        status_code=status.HTTP_403_FORBIDDEN,
        detail=f"Insufficient permissions: {permission}",
    )


def _fetch_web_user(token: str) -> Dict[str, Any]:
    cache_key = hashlib.sha256(token.encode("utf-8", errors="ignore")).hexdigest()
    now_value = time.monotonic()
    with web_auth_cache_lock:
        cached = web_auth_cache.get(cache_key)
        if cached is not None and cached[0] > now_value:
            return dict(cached[1])

    request = UrlRequest(
        config.web_auth_me_url,
        headers={
            "Authorization": f"Bearer {token}",
            "Accept": "application/json",
        },
        method="GET",
    )
    try:
        with urlopen(request, timeout=config.web_auth_timeout_sec) as response:
            payload = json.loads(response.read().decode("utf-8"))
    except HTTPError as exc:
        if exc.code in {status.HTTP_401_UNAUTHORIZED, status.HTTP_403_FORBIDDEN}:
            raise _credentials_exception() from exc
        raise HTTPException(
            status_code=status.HTTP_503_SERVICE_UNAVAILABLE,
            detail="Web auth service unavailable",
        ) from exc
    except (URLError, TimeoutError, OSError, ValueError, json.JSONDecodeError) as exc:
        logger.warning("Web auth request failed: %s", exc)
        raise HTTPException(
            status_code=status.HTTP_503_SERVICE_UNAVAILABLE,
            detail="Web auth service unavailable",
        ) from exc

    if not isinstance(payload, dict) or not payload.get("id") or not bool(payload.get("is_active", True)):
        raise _credentials_exception()
    ttl = int(config.web_auth_cache_ttl_sec)
    if ttl > 0:
        with web_auth_cache_lock:
            if len(web_auth_cache) >= 512:
                expired = [key for key, value in web_auth_cache.items() if value[0] <= now_value]
                for key in expired:
                    web_auth_cache.pop(key, None)
                if len(web_auth_cache) >= 512:
                    web_auth_cache.pop(next(iter(web_auth_cache)), None)
            web_auth_cache[cache_key] = (now_value + ttl, dict(payload))
    return payload


def require_web_permission(permission: str):
    def _dependency(
        credentials: Optional[HTTPAuthorizationCredentials] = Depends(security_optional),
        access_token_cookie: Optional[str] = Cookie(None, alias=AUTH_COOKIE_NAME),
    ) -> Dict[str, Any]:
        token = _resolve_access_token(credentials, access_token_cookie)
        if not token:
            raise _credentials_exception()
        user_raw = _fetch_web_user(token)
        permissions = {
            str(item or "").strip()
            for item in (user_raw.get("permissions") if isinstance(user_raw.get("permissions"), list) else [])
            if str(item or "").strip()
        }
        if permission not in permissions:
            raise _forbidden_exception(permission)

        return user_raw

    return _dependency


def _model_dump(model: BaseModel) -> Dict[str, Any]:
    if hasattr(model, "model_dump"):
        return model.model_dump()
    return model.dict()


def _web_actor(user: Dict[str, Any]) -> str:
    for key in ("username", "login", "email", "full_name", "id"):
        value = str(user.get(key) or "").strip()
        if value:
            return value
    return "authenticated-user"


def _request_ip(request: Optional[Request]) -> str:
    client = getattr(request, "client", None)
    host = getattr(client, "host", "")
    return str(host or "").strip()


def _path_size_mb(path: Path) -> float:
    try:
        return round(path.stat().st_size / (1024 * 1024), 2)
    except Exception:
        return 0.0


def _read_lock_pid(lock_name: str) -> int:
    lock_path = config.db_path.parent / lock_name
    try:
        text = lock_path.read_text(encoding="ascii", errors="ignore").strip()
        return int(text or 0)
    except Exception:
        if lock_name == "scan_server.lock":
            return os.getpid()
        return 0


def _clone_jsonable(payload: Dict[str, Any]) -> Dict[str, Any]:
    return json.loads(json.dumps(payload, ensure_ascii=False))


def _is_sqlite_busy_error(exc: BaseException) -> bool:
    text = str(exc or "").lower()
    return isinstance(exc, sqlite3.OperationalError) and (
        "database is locked" in text
        or "database table is locked" in text
        or "database is busy" in text
    )


def _get_cached_dashboard(now_value: float, ttl_sec: int) -> Optional[Dict[str, Any]]:
    if ttl_sec <= 0:
        return None
    with dashboard_cache_lock:
        if dashboard_cache_payload is None:
            return None
        age_sec = max(0.0, now_value - dashboard_cache_ts)
        if age_sec > ttl_sec:
            return None
        payload = _clone_jsonable(dashboard_cache_payload)
    payload["cached"] = True
    payload["cache_age_sec"] = round(age_sec, 2)
    return payload


def _store_dashboard_cache(payload: Dict[str, Any], now_value: float) -> None:
    global dashboard_cache_payload, dashboard_cache_ts
    with dashboard_cache_lock:
        dashboard_cache_payload = _clone_jsonable(payload)
        dashboard_cache_ts = now_value


def _get_stale_dashboard(now_value: float) -> Optional[Dict[str, Any]]:
    with dashboard_cache_lock:
        if dashboard_cache_payload is None:
            return None
        age_sec = max(0.0, now_value - dashboard_cache_ts)
        payload = _clone_jsonable(dashboard_cache_payload)
    payload["cached"] = True
    payload["degraded"] = True
    payload["cache_age_sec"] = round(age_sec, 2)
    return payload


def _is_pdf_ingest_payload(data: Dict[str, Any], pdf_bytes: Optional[bytes] = None) -> bool:
    source_kind = str(data.get("source_kind") or "").strip().lower()
    return source_kind in {"pdf", "pdf_slice"} or bool(data.get("pdf_slice_b64")) or bool(pdf_bytes)


def _backpressure_exception(status_payload: Dict[str, Any], *, is_pdf: bool) -> HTTPException:
    retry_after_sec = int(status_payload.get("retry_after_sec") or config.ingest_retry_after_sec)
    return HTTPException(
        status_code=status.HTTP_429_TOO_MANY_REQUESTS,
        detail={
            "error": "scan_pdf_ingest_backpressure" if is_pdf else "scan_ingest_backpressure",
            "message": (
                "PDF scan queue is temporarily overloaded"
                if is_pdf
                else "Scan ingest queue is temporarily overloaded"
            ),
            **status_payload,
        },
        headers={"Retry-After": str(retry_after_sec)},
    )


def _queue_ingest_blocking(data: Dict[str, Any], *, request_ip: str, pdf_bytes: Optional[bytes] = None) -> Dict[str, Any]:
    is_pdf = _is_pdf_ingest_payload(data, pdf_bytes=pdf_bytes)
    pressure = store.ingest_backpressure_status(
        max_pending_pdf_jobs=config.ingest_max_pending_pdf_jobs,
        transient_max_gb=config.transient_max_gb,
        max_pending_jobs=config.ingest_max_pending_jobs,
        retry_after_base_sec=config.ingest_retry_after_sec,
        retry_after_max_sec=config.ingest_retry_after_max_sec,
    )
    if is_pdf:
        if bool(pressure.get("active")):
            raise _backpressure_exception(pressure, is_pdf=True)
    else:
        if bool(pressure.get("total_active")):
            raise _backpressure_exception(pressure, is_pdf=False)
    store.touch_agent_presence(
        agent_id=str(data.get("agent_id") or "").strip(),
        hostname=str(data.get("hostname") or "").strip(),
        branch=str(data.get("branch") or "").strip(),
        ip_address=request_ip,
        metadata={"last_source": "ingest"},
    )
    queued = store.queue_job(data, pdf_bytes=pdf_bytes)
    return {"success": True, **queued}


def _get_ingest_semaphore() -> asyncio.Semaphore:
    global ingest_semaphore, ingest_semaphore_loop
    loop = asyncio.get_running_loop()
    if ingest_semaphore is None or ingest_semaphore_loop is not loop:
        ingest_semaphore = asyncio.Semaphore(max(1, int(config.ingest_max_concurrency)))
        ingest_semaphore_loop = loop
    return ingest_semaphore


async def _run_ingest(data: Dict[str, Any], *, request_ip: str, pdf_bytes: Optional[bytes] = None) -> Dict[str, Any]:
    async with _get_ingest_semaphore():
        return await asyncio.to_thread(_queue_ingest_blocking, data, request_ip=request_ip, pdf_bytes=pdf_bytes)


def _loop_descriptor() -> str:
    try:
        loop = asyncio.get_running_loop()
        return f"{type(loop).__module__}.{type(loop).__name__}"
    except RuntimeError:
        return "unavailable"


def _policy_descriptor() -> str:
    policy = asyncio.get_event_loop_policy()
    return f"{type(policy).__module__}.{type(policy).__name__}"


def _watchdog_probe_host(host: str) -> str:
    normalized = str(host or "").strip().lower()
    if normalized in {"", "0.0.0.0", "::", "[::]", "localhost"}:
        return "127.0.0.1"
    return str(host or "").strip()


def _probe_local_health(host: str, port: int, timeout_sec: int) -> bool:
    probe_host = _watchdog_probe_host(host)
    request = (
        f"GET /health HTTP/1.1\r\n"
        f"Host: {probe_host}:{port}\r\n"
        "Connection: close\r\n"
        "User-Agent: scan-listener-watchdog\r\n\r\n"
    ).encode("ascii", errors="ignore")
    try:
        with socket.create_connection((probe_host, port), timeout=timeout_sec) as conn:
            conn.settimeout(timeout_sec)
            conn.sendall(request)
            head = conn.recv(128)
        return head.startswith(b"HTTP/1.1 200") or head.startswith(b"HTTP/1.0 200")
    except Exception as exc:
        logger.debug(
            "Scan listener watchdog probe failed for %s:%s: %s",
            probe_host,
            port,
            exc,
        )
        return False


def _listener_watchdog(stop_signal: threading.Event) -> None:
    probe_host = _watchdog_probe_host(config.host)
    interval_sec = max(1, int(config.watchdog_interval_sec))
    timeout_sec = max(1, int(config.watchdog_timeout_sec))
    failure_limit = max(1, int(config.watchdog_failures))
    startup_grace_sec = max(0, int(config.watchdog_startup_grace_sec))

    if startup_grace_sec and stop_signal.wait(startup_grace_sec):
        return

    failures = 0
    logger.info(
        "Scan listener watchdog started: target=%s:%s interval=%ss timeout=%ss failures=%s",
        probe_host,
        config.port,
        interval_sec,
        timeout_sec,
        failure_limit,
    )
    while not stop_signal.wait(interval_sec):
        if _probe_local_health(config.host, config.port, timeout_sec):
            if failures:
                logger.warning(
                    "Scan listener watchdog recovered after %s failed probe(s)",
                    failures,
                )
            failures = 0
            continue

        failures += 1
        logger.error(
            "Scan listener watchdog probe failed %s/%s for %s:%s",
            failures,
            failure_limit,
            probe_host,
            config.port,
        )
        if failures < failure_limit:
            continue

        logger.critical(
            "Scan listener watchdog detected dead HTTP listener on %s:%s; terminating process for PM2 restart",
            probe_host,
            config.port,
        )
        os._exit(70)


def _run_startup_maintenance() -> None:
    try:
        purge_result = store.purge_all_artifacts()
        if any(int(purge_result.get(key) or 0) > 0 for key in ("artifact_rows", "artifact_files", "artifact_dirs")):
            logger.info(
                "Scan artifact purge completed: rows=%s files=%s dirs=%s",
                int(purge_result.get("artifact_rows") or 0),
                int(purge_result.get("artifact_files") or 0),
                int(purge_result.get("artifact_dirs") or 0),
            )
        spool_result = store.reconcile_job_pdf_spool()
        if any(int(spool_result.get(key) or 0) > 0 for key in ("removed_orphan_files", "removed_final_files", "failed_jobs")):
            logger.info(
                "Transient PDF spool reconcile completed: orphan=%s final=%s failed_jobs=%s",
                int(spool_result.get("removed_orphan_files") or 0),
                int(spool_result.get("removed_final_files") or 0),
                int(spool_result.get("failed_jobs") or 0),
            )
    except Exception as exc:
        logger.exception("Scan startup maintenance failed: %s", exc)


@asynccontextmanager
async def lifespan(_: FastAPI):
    stop_event.clear()
    watchdog_stop_event.clear()
    global startup_maintenance_thread, metrics_sampler
    startup_maintenance_thread = None
    if worker is None:
        startup_maintenance_thread = threading.Thread(
            target=_run_startup_maintenance,
            daemon=True,
            name="scan-startup-maintenance",
        )
        startup_maintenance_thread.start()
    else:
        _run_startup_maintenance()
    if worker is not None and not worker.is_alive():
        worker.start()
    global watchdog_thread
    watchdog_thread = None
    if config.watchdog_enabled:
        watchdog_thread = threading.Thread(
            target=_listener_watchdog,
            args=(watchdog_stop_event,),
            daemon=True,
            name="scan-listener-watchdog",
        )
        watchdog_thread.start()
    metrics_sampler = SystemMetricsSampler(
        store=store,
        stop_event=stop_event,
        interval_sec=SYSTEM_METRICS_INTERVAL_SEC,
    )
    metrics_sampler.start()
    logger.info(
        "Scan asyncio runtime: policy=%s loop=%s",
        _policy_descriptor(),
        _loop_descriptor(),
    )
    logger.info("Scan server started on %s:%s", config.host, config.port)
    yield
    watchdog_stop_event.set()
    if watchdog_thread is not None and watchdog_thread.is_alive():
        watchdog_thread.join(timeout=5)
    stop_event.set()
    if metrics_sampler is not None and metrics_sampler.is_alive():
        metrics_sampler.join(timeout=5)
    if worker is not None and worker.is_alive():
        worker.join(timeout=5)
    logger.info("Scan server stopped")


app = FastAPI(
    title="IT-Invent Scan Server",
    version="1.0.0",
    lifespan=lifespan,
)


@app.get("/health")
async def health() -> Dict[str, Any]:
    rss_bytes = get_process_rss_bytes()
    return {
        "status": "ok",
        "time": _now_ts(),
        "pid": os.getpid(),
        "rss_mb": round(rss_bytes / (1024 * 1024), 1) if rss_bytes else 0.0,
        "db_size_mb": _path_size_mb(config.db_path),
        "wal_size_mb": _path_size_mb(Path(str(config.db_path) + "-wal")),
        "api_lock_pid": _read_lock_pid("scan_server.lock"),
        "worker_lock_pid": _read_lock_pid("scan_worker.lock"),
        "ingest": {
            "max_concurrency": int(config.ingest_max_concurrency),
            "max_pending_pdf_jobs": int(config.ingest_max_pending_pdf_jobs),
            "max_pending_jobs": int(config.ingest_max_pending_jobs),
            "transient_max_gb": float(config.transient_max_gb),
            "retry_after_sec": int(config.ingest_retry_after_sec),
            "retry_after_max_sec": int(config.ingest_retry_after_max_sec),
        },
        "watchdog": {
            "enabled": bool(config.watchdog_enabled),
            "timeout_sec": int(config.watchdog_timeout_sec),
            "failures": int(config.watchdog_failures),
        },
        "analysis": {
            "analysis_version": SCAN_ANALYSIS_VERSION,
            "ocr_page_limit": SCAN_OCR_PAGE_LIMIT,
            "text_page_limit": SCAN_TEXT_PAGE_LIMIT,
            "ocr_lang": str(config.ocr_lang),
            "ocr_dpi": int(config.ocr_dpi),
            "focused_ocr_dpi": int(FOCUSED_REGION_DPI),
            "full_page_max_pixels": int(MAX_RENDERED_PAGE_PIXELS),
            "focused_region_max_pixels": int(MAX_FOCUSED_REGION_PIXELS),
            "pdf_max_bytes": int(config.pdf_max_bytes),
            "job_workers": int(config.scan_job_max_workers),
            "ocr_workers": int(config.ocr_max_processes),
        },
        "system_metrics": {
            "enabled": bool(metrics_sampler is not None and metrics_sampler.collector.available),
            "interval_sec": SYSTEM_METRICS_INTERVAL_SEC,
        },
    }


@app.post("/api/v1/scan/heartbeat")
def heartbeat(
    payload: HeartbeatPayload,
    request: Request,
    x_api_key: Optional[str] = Header(None),
) -> Dict[str, Any]:
    _check_agent_key(x_api_key)
    data = _model_dump(payload)
    if not str(data.get("ip_address") or "").strip():
        data["ip_address"] = _request_ip(request)
    data["last_seen_at"] = int(data.get("last_seen_at") or _now_ts())
    row = store.upsert_agent_heartbeat(data)
    return {"success": True, "agent_id": row["agent_id"], "last_seen_at": row["last_seen_at"]}


@app.post("/api/v1/scan/ingest")
async def ingest(
    payload: IngestPayload,
    request: Request,
    x_api_key: Optional[str] = Header(None),
) -> Dict[str, Any]:
    _check_agent_key(x_api_key)
    data = _model_dump(payload)
    return await _run_ingest(data, request_ip=_request_ip(request))


@app.post("/api/v1/scan/ingest/pdf-slice")
async def ingest_pdf_slice(
    request: Request,
    metadata_json: str = Form(...),
    pdf_slice: UploadFile = File(...),
    x_api_key: Optional[str] = Header(None),
) -> Dict[str, Any]:
    _check_agent_key(x_api_key)
    try:
        raw_metadata = json.loads(str(metadata_json or "{}"))
    except Exception as exc:
        raise HTTPException(status_code=400, detail="Invalid metadata_json") from exc
    if not isinstance(raw_metadata, dict):
        raise HTTPException(status_code=400, detail="metadata_json must be an object")
    metadata = _model_dump(IngestPayload(**raw_metadata))
    metadata["source_kind"] = "pdf_slice"
    metadata["pdf_slice_b64"] = ""
    details = metadata.get("metadata") if isinstance(metadata.get("metadata"), dict) else {}
    details.setdefault("ocr_page_limit", SCAN_OCR_PAGE_LIMIT)
    details.setdefault("text_page_limit", SCAN_TEXT_PAGE_LIMIT)
    details.setdefault("pages_in_slice", 0)
    details.setdefault("extraction_outcomes", [])
    metadata["metadata"] = details
    pdf_bytes = await pdf_slice.read(int(config.pdf_max_bytes) + 1)
    if not pdf_bytes:
        raise HTTPException(status_code=400, detail="pdf_slice is empty")
    if len(pdf_bytes) > int(config.pdf_max_bytes):
        details["analysis_incomplete_reason"] = "pdf_slice_payload_too_large"
        outcomes = details.get("extraction_outcomes") if isinstance(details.get("extraction_outcomes"), list) else []
        outcomes.append({"method": "pdf_slice_upload", "outcome": "too_large"})
        details["extraction_outcomes"] = outcomes
        metadata["metadata"] = details
        metadata["source_kind"] = "analysis_incomplete"
        return await _run_ingest(metadata, request_ip=_request_ip(request))
    return await _run_ingest(metadata, request_ip=_request_ip(request), pdf_bytes=pdf_bytes)


@app.post("/api/v1/scan/ingest/document")
async def ingest_document(
    request: Request,
    metadata_json: str = Form(...),
    document: UploadFile = File(...),
    x_api_key: Optional[str] = Header(None),
) -> Dict[str, Any]:
    _check_agent_key(x_api_key)
    try:
        raw_metadata = json.loads(str(metadata_json or "{}"))
    except Exception as exc:
        raise HTTPException(status_code=400, detail="Invalid metadata_json") from exc
    if not isinstance(raw_metadata, dict):
        raise HTTPException(status_code=400, detail="metadata_json must be an object")
    metadata = _model_dump(IngestPayload(**raw_metadata))
    metadata.pop("document_b64", None)
    file_name = str(metadata.get("file_name") or document.filename or "document.bin")
    extension = Path(file_name).suffix.lower()
    supported = {
        ".jpg", ".jpeg", ".png", ".tif", ".tiff", ".bmp", ".webp",
        ".doc", ".docx", ".odt", ".xls", ".xlsx", ".ods",
        ".ppt", ".pptx", ".odp",
    }
    if extension not in supported:
        raise HTTPException(status_code=415, detail="Unsupported document type")
    document_bytes = await document.read(int(config.pdf_max_bytes) + 1)
    if not document_bytes:
        raise HTTPException(status_code=400, detail="document is empty")
    if len(document_bytes) > int(config.pdf_max_bytes):
        details = metadata.get("metadata") if isinstance(metadata.get("metadata"), dict) else {}
        details["analysis_incomplete_reason"] = "document_payload_too_large"
        outcomes = details.get("extraction_outcomes") if isinstance(details.get("extraction_outcomes"), list) else []
        outcomes.append({"method": "document_upload", "outcome": "too_large"})
        details["extraction_outcomes"] = outcomes
        metadata["metadata"] = details
        metadata["source_kind"] = "analysis_incomplete"
        return await _run_ingest(metadata, request_ip=_request_ip(request))
    metadata["source_kind"] = "image" if extension in {".jpg", ".jpeg", ".png", ".tif", ".tiff", ".bmp", ".webp"} else "office"
    return await _run_ingest(metadata, request_ip=_request_ip(request), pdf_bytes=document_bytes)


@app.get("/api/v1/scan/tasks/poll")
def poll_tasks(
    request: Request,
    agent_id: str = Query(..., min_length=1),
    limit: int = Query(10, ge=1, le=50),
    x_api_key: Optional[str] = Header(None),
) -> Dict[str, Any]:
    _check_agent_key(x_api_key)
    store.touch_agent_presence(
        agent_id=agent_id,
        ip_address=_request_ip(request),
        metadata={"last_source": "poll_tasks"},
    )
    tasks = store.poll_tasks(agent_id=agent_id, limit=min(limit, config.poll_limit))
    return {"agent_id": agent_id, "tasks": tasks}


@app.post("/api/v1/scan/tasks/{task_id}/result")
def task_result(
    task_id: str,
    payload: TaskResultPayload,
    request: Request,
    x_api_key: Optional[str] = Header(None),
) -> Dict[str, Any]:
    _check_agent_key(x_api_key)
    status_value = str(payload.status or "").strip().lower()
    if status_value not in {"acknowledged", "completed", "failed"}:
        raise HTTPException(status_code=400, detail="Unsupported status")
    store.touch_agent_presence(
        agent_id=payload.agent_id,
        ip_address=_request_ip(request),
        metadata={"last_source": "task_result", "task_status": status_value},
    )
    result = store.report_task_result(
        agent_id=payload.agent_id,
        task_id=task_id,
        status=status_value,
        result=payload.result,
        error_text=payload.error_text,
    )
    if result is None:
        raise HTTPException(status_code=404, detail="Task not found")
    return {"success": True, **result}


@app.post("/api/v1/scan/tasks")
def create_task(
    payload: TaskCreatePayload,
    _: Dict[str, Any] = Depends(require_web_permission(PERM_SCAN_TASKS)),
) -> Dict[str, Any]:
    command = str(payload.command or "").strip().lower()
    if command not in {"ping", "scan_now"}:
        raise HTTPException(status_code=400, detail="Unsupported command")
    created = store.create_task(
        agent_id=payload.agent_id,
        command=command,
        payload=payload.payload,
        ttl_days=config.task_ttl_days,
        dedupe_key=payload.dedupe_key,
    )
    return {"success": True, "task": created}


@app.get("/api/v1/scan/incidents")
def incidents(
    status_value: Optional[str] = Query(None, alias="status"),
    severity: Optional[str] = Query(None),
    branch: Optional[str] = Query(None),
    hostname: Optional[str] = Query(None),
    task_id: Optional[str] = Query(None),
    source_kind: Optional[str] = Query(None),
    file_ext: Optional[str] = Query(None),
    date_from: Optional[str] = Query(None),
    date_to: Optional[str] = Query(None),
    has_fragment: Optional[bool] = Query(None),
    ack_by: Optional[str] = Query(None),
    pattern_id: Optional[str] = Query(None),
    q: Optional[str] = Query(None),
    limit: int = Query(100, ge=1, le=5000),
    offset: int = Query(0, ge=0),
    _: Dict[str, Any] = Depends(require_web_permission(PERM_SCAN_READ)),
) -> Dict[str, Any]:
    return store.list_incidents(
        status=status_value,
        severity=severity,
        branch=branch,
        hostname=hostname,
        task_id=task_id,
        source_kind=source_kind,
        file_ext=file_ext,
        date_from=date_from,
        date_to=date_to,
        has_fragment=has_fragment,
        ack_by=ack_by,
        pattern_id=pattern_id,
        q=q,
        limit=limit,
        offset=offset,
    )


@app.get("/api/v1/scan/incidents/inbox-groups")
def incident_inbox_groups(
    status_value: Optional[str] = Query(None, alias="status"),
    severity: Optional[str] = Query(None),
    branch: Optional[str] = Query(None),
    hostname: Optional[str] = Query(None),
    source_kind: Optional[str] = Query(None),
    file_ext: Optional[str] = Query(None),
    date_from: Optional[str] = Query(None),
    date_to: Optional[str] = Query(None),
    has_fragment: Optional[bool] = Query(None),
    ack_by: Optional[str] = Query(None),
    pattern_id: Optional[str] = Query(None),
    q: Optional[str] = Query(None),
    host_limit: int = Query(25, ge=1, le=100),
    host_offset: int = Query(0, ge=0),
    files_per_host: int = Query(25, ge=1, le=100),
    _: Dict[str, Any] = Depends(require_web_permission(PERM_SCAN_READ)),
) -> Dict[str, Any]:
    return store.list_incident_inbox_groups(
        status=status_value,
        severity=severity,
        branch=branch,
        hostname=hostname,
        source_kind=source_kind,
        file_ext=file_ext,
        date_from=date_from,
        date_to=date_to,
        has_fragment=has_fragment,
        ack_by=ack_by,
        pattern_id=pattern_id,
        q=q,
        host_limit=host_limit,
        host_offset=host_offset,
        files_per_host=files_per_host,
    )


@app.post("/api/v1/scan/incidents/{incident_id}/ack")
def ack_incident(
    incident_id: str,
    payload: IncidentAckPayload,
    user: Dict[str, Any] = Depends(require_web_permission(PERM_SCAN_ACK)),
) -> Dict[str, Any]:
    acked = store.ack_incident(incident_id=incident_id, ack_by=_web_actor(user))
    if acked is None:
        raise HTTPException(status_code=404, detail="Incident not found")
    return {"success": True, "incident": acked}


@app.post("/api/v1/scan/incidents/bulk-ack")
def bulk_ack_incidents(
    payload: IncidentBulkAckPayload,
    user: Dict[str, Any] = Depends(require_web_permission(PERM_SCAN_ACK)),
) -> Dict[str, Any]:
    incident_ids = [str(item or "").strip() for item in (payload.incident_ids or []) if str(item or "").strip()]
    filters = payload.filters if isinstance(payload.filters, dict) else {}
    has_filter = any(value not in (None, "", [], {}, False) for value in filters.values())
    if not incident_ids and not has_filter and not payload.confirm_all:
        raise HTTPException(status_code=400, detail="Bulk ACK requires incident_ids, a non-empty filter, or confirm_all=true")
    return store.bulk_ack_incidents(
        incident_ids=incident_ids,
        filters=filters,
        ack_by=_web_actor(user),
    )


@app.get("/api/v1/scan/hosts/{hostname}/scan-runs")
def host_scan_runs(
    hostname: str,
    limit: int = Query(30, ge=1, le=100),
    offset: int = Query(0, ge=0),
    _: Dict[str, Any] = Depends(require_web_permission(PERM_SCAN_READ)),
) -> Dict[str, Any]:
    return store.list_host_scan_runs(hostname=hostname, limit=limit, offset=offset)


@app.get("/api/v1/scan/tasks/{task_id}/observations")
def task_observations(
    task_id: str,
    limit: int = Query(200, ge=1, le=500),
    offset: int = Query(0, ge=0),
    _: Dict[str, Any] = Depends(require_web_permission(PERM_SCAN_READ)),
) -> Dict[str, Any]:
    return store.list_task_observations(task_id=task_id, limit=limit, offset=offset)


@app.get("/api/v1/scan/tasks/{task_id}/system-metrics")
def task_system_metrics(
    task_id: str,
    limit: int = Query(5000, ge=1, le=20000),
    offset: int = Query(0, ge=0),
    _: Dict[str, Any] = Depends(require_web_permission(PERM_SCAN_READ)),
) -> Dict[str, Any]:
    return store.list_task_system_metrics(task_id=task_id, limit=limit, offset=offset)


@app.get("/api/v1/scan/tasks/{task_id}/incidents/export")
def export_task_incidents(
    task_id: str,
    _: Dict[str, Any] = Depends(require_web_permission(PERM_SCAN_READ)),
):
    report = store.get_scan_task_incident_report(task_id=task_id)
    if report is None:
        raise HTTPException(status_code=404, detail="Scan task not found")
    file_bytes, filename = build_scan_task_incidents_excel(report)
    return StreamingResponse(
        BytesIO(file_bytes),
        media_type=XLSX_MEDIA_TYPE,
        headers={"Content-Disposition": f'attachment; filename="{filename}"'},
    )


@app.get("/api/v1/scan/dashboard")
def dashboard(
    _: Dict[str, Any] = Depends(require_web_permission(PERM_SCAN_READ)),
) -> Dict[str, Any]:
    now_value = time.monotonic()
    cached = _get_cached_dashboard(now_value, int(config.dashboard_cache_ttl_sec))
    if cached is not None:
        return cached
    try:
        payload = store.dashboard()
        payload["ingest_backpressure"] = store.ingest_backpressure_status(
            max_pending_pdf_jobs=config.ingest_max_pending_pdf_jobs,
            transient_max_gb=config.transient_max_gb,
            max_pending_jobs=getattr(config, "ingest_max_pending_jobs", None),
        )
    except Exception as exc:
        stale = _get_stale_dashboard(now_value)
        if stale is not None and _is_sqlite_busy_error(exc):
            logger.warning("Scan dashboard returning stale cache after SQLite lock: %s", exc)
            return stale
        if _is_sqlite_busy_error(exc):
            raise HTTPException(
                status_code=status.HTTP_503_SERVICE_UNAVAILABLE,
                detail="Scan dashboard is temporarily busy",
            ) from exc
        raise
    payload["cached"] = False
    payload["cache_age_sec"] = 0
    payload["degraded"] = False
    _store_dashboard_cache(payload, now_value)
    return payload


@app.get("/api/v1/scan/review-items")
def review_items(
    limit: int = Query(100, ge=1, le=500),
    offset: int = Query(0, ge=0),
    _: Dict[str, Any] = Depends(require_web_permission(PERM_SCAN_READ)),
) -> Dict[str, Any]:
    return store.list_incomplete_jobs(limit=limit, offset=offset)


@app.get("/api/v1/scan/patterns")
def patterns(
    _: Dict[str, Any] = Depends(require_web_permission(PERM_SCAN_READ)),
) -> Dict[str, Any]:
    items = list_patterns()
    return {"items": items, "total": len(items)}


@app.get("/api/v1/scan/agents")
def agents(
    _: Dict[str, Any] = Depends(require_web_permission(PERM_SCAN_READ)),
) -> List[Dict[str, Any]]:
    return store.list_agents()


@app.get("/api/v1/scan/agents/activity")
def agents_activity(
    agent_id: List[str] = Query([]),
    _: Dict[str, Any] = Depends(require_web_permission(PERM_SCAN_READ)),
) -> Dict[str, Any]:
    return store.list_agents_activity(agent_ids=agent_id)


@app.get("/api/v1/scan/branches")
def branches(
    _: Dict[str, Any] = Depends(require_web_permission(PERM_SCAN_READ)),
) -> List[str]:
    return store.list_branches()


@app.get("/api/v1/scan/agents/table")
def agents_table(
    q: Optional[str] = Query(None),
    branch: Optional[str] = Query(None),
    online: Optional[str] = Query(None),
    task_status: Optional[str] = Query(None),
    limit: int = Query(50, ge=1, le=200),
    offset: int = Query(0, ge=0),
    sort_by: Optional[str] = Query(None),
    sort_dir: Optional[str] = Query(None),
    _: Dict[str, Any] = Depends(require_web_permission(PERM_SCAN_READ)),
) -> Dict[str, Any]:
    return store.list_agents_table(
        q=q,
        branch=branch,
        online=online,
        task_status=task_status,
        limit=limit,
        offset=offset,
        sort_by=sort_by,
        sort_dir=sort_dir,
    )


@app.get("/api/v1/scan/hosts")
def hosts(
    q: Optional[str] = Query(None),
    branch: Optional[str] = Query(None),
    status_value: Optional[str] = Query(None, alias="status"),
    severity: Optional[str] = Query(None),
    limit: int = Query(200, ge=1, le=500),
    _: Dict[str, Any] = Depends(require_web_permission(PERM_SCAN_READ)),
) -> List[Dict[str, Any]]:
    return store.list_hosts(
        q=q,
        branch=branch,
        status=status_value,
        severity=severity,
        limit=limit,
    )


@app.get("/api/v1/scan/hosts/table")
def hosts_table(
    q: Optional[str] = Query(None),
    branch: Optional[str] = Query(None),
    status_value: Optional[str] = Query(None, alias="status"),
    severity: Optional[str] = Query(None),
    limit: int = Query(50, ge=1, le=500),
    offset: int = Query(0, ge=0),
    sort_by: Optional[str] = Query(None),
    sort_dir: Optional[str] = Query(None),
    _: Dict[str, Any] = Depends(require_web_permission(PERM_SCAN_READ)),
) -> Dict[str, Any]:
    return store.list_hosts_table(
        q=q,
        branch=branch,
        status=status_value,
        severity=severity,
        limit=limit,
        offset=offset,
        sort_by=sort_by,
        sort_dir=sort_dir,
    )


@app.get("/api/v1/scan/tasks")
def tasks(
    agent_id: Optional[str] = Query(None),
    status_value: Optional[str] = Query(None, alias="status"),
    command: Optional[str] = Query(None),
    limit: int = Query(50, ge=1, le=200),
    offset: int = Query(0, ge=0),
    _: Dict[str, Any] = Depends(require_web_permission(PERM_SCAN_READ)),
) -> Dict[str, Any]:
    return store.list_tasks(
        agent_id=agent_id,
        status=status_value,
        command=command,
        limit=limit,
        offset=offset,
    )


if __name__ == "__main__":
    import uvicorn

    uvicorn.run(
        app,
        host=config.host,
        port=config.port,
        reload=False,
        loop="scan_server.uvicorn_loops:windows_selector_loop_factory",
    )
