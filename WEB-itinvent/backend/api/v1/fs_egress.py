from __future__ import annotations

import asyncio
import functools
import logging
import os
import threading
from typing import Any, Callable, Dict, List, Optional

import anyio
from fastapi import APIRouter, Depends, Header, HTTPException, Query, Request, status
from fastapi.responses import HTMLResponse, Response

from backend import inventory_runtime
from backend.api.deps import ensure_user_permission, get_current_admin_user, get_current_user
from backend.services import dlp_report_service, fs_egress_store_service as store
from backend.utils.upload_limits import read_json_body_limited

logger = logging.getLogger(__name__)
router = APIRouter()

# Agent-supplied media is rendered in an admin session: only these types are
# safe to display inline. Anything else is forced to octet-stream + nosniff,
# otherwise a malicious agent could store text/html and run script as admin.
_MEDIA_INLINE_PREFIXES = ("image/", "video/", "audio/")
_MEDIA_INLINE_TYPES = {"application/pdf", "application/octet-stream"}


def _dlp_media_response(content: bytes, content_type: Any) -> Response:
    mime = str(content_type or "").strip().lower().split(";")[0].strip()
    if mime.startswith("image/svg"):
        # SVG can carry script; opened directly it executes in the admin's origin.
        mime = "application/octet-stream"
    elif not (mime in _MEDIA_INLINE_TYPES or mime.startswith(_MEDIA_INLINE_PREFIXES)):
        mime = "application/octet-stream"
    return Response(
        content=content,
        media_type=mime,
        headers={
            "Cache-Control": "private, max-age=3600",
            "X-Content-Type-Options": "nosniff",
        },
    )

# Ingest posts hold a pooled DB connection for the whole store call; unbounded agent
# concurrency exhausts the shared APP pool and starves user-facing requests. anyio
# primitives are single-loop, so one limiter per running loop — production serves a
# single uvicorn loop anyway.
_ingest_limiters: Dict[int, anyio.CapacityLimiter] = {}
_ingest_admission: "threading.BoundedSemaphore | None" = None
_ingest_queue_admission: "threading.BoundedSemaphore | None" = None


def _ingest_max_concurrency() -> int:
    try:
        return max(1, int(str(os.getenv("ITINV_INGEST_MAX_CONCURRENCY", "6") or "6")))
    except ValueError:
        return 6


def _get_ingest_limiter() -> anyio.CapacityLimiter:
    key = id(asyncio.get_running_loop())
    limiter = _ingest_limiters.get(key)
    if limiter is None:
        limiter = _ingest_limiters[key] = anyio.CapacityLimiter(_ingest_max_concurrency())
    return limiter


def _get_ingest_admission() -> "threading.BoundedSemaphore":
    """Hard cap on *running* store calls.

    A request cancelled/timed out abandons its worker thread but releases the anyio
    token — without this semaphore abandoned writes could again exceed the cap.
    threading primitives are loop-agnostic, so one semaphore serves every loop.
    """
    global _ingest_admission
    if _ingest_admission is None:
        _ingest_admission = threading.BoundedSemaphore(_ingest_max_concurrency())
    return _ingest_admission


def _get_ingest_queue_admission() -> threading.BoundedSemaphore:
    global _ingest_queue_admission
    if _ingest_queue_admission is None:
        # Bound live HTTP calls separately from workers that outlive a timeout.
        _ingest_queue_admission = threading.BoundedSemaphore(3 * _ingest_max_concurrency())
    return _ingest_queue_admission


def _ingest_timeout_sec() -> float:
    try:
        return max(1.0, float(str(os.getenv("ITINV_INGEST_TIMEOUT_SEC", "60") or "60")))
    except ValueError:
        return 60.0


async def _run_ingest(fn: Callable[..., Any], *args: Any) -> Any:
    """Run store work under a bounded queue; overflow waits, then 503s."""
    queue = _get_ingest_queue_admission()
    if not queue.acquire(blocking=False):
        raise HTTPException(
            status_code=status.HTTP_503_SERVICE_UNAVAILABLE,
            detail="Ingest queue busy",
            headers={"Retry-After": "30"},
        )
    try:
        with anyio.fail_after(_ingest_timeout_sec()):
            admission = _get_ingest_admission()
            while not admission.acquire(blocking=False):
                await anyio.sleep(0.01)

            ownership = threading.Lock()
            pending = True

            def guarded() -> Any:
                nonlocal pending
                with ownership:
                    if not pending:
                        return None
                    pending = False
                try:
                    return fn(*args)
                finally:
                    admission.release()

            try:
                return await anyio.to_thread.run_sync(
                    guarded, abandon_on_cancel=True, limiter=_get_ingest_limiter()
                )
            finally:
                # Cancellation before thread startup must neither leak the slot nor
                # allow that worker to start a stale write later.
                with ownership:
                    if pending:
                        pending = False
                        admission.release()
    except TimeoutError as exc:
        raise HTTPException(
            status_code=status.HTTP_503_SERVICE_UNAVAILABLE,
            detail="Ingest queue busy",
            headers={"Retry-After": "30"},
        ) from exc
    finally:
        queue.release()


# Bound-key auth hits Postgres on a cache miss; under DB stalls the sync lookup
# froze the whole event loop (event_loop.blocked on agent ingest paths). Keep a
# small dedicated pool so a stalled lookup cannot starve other to_thread work.
_key_check_limiters: Dict[int, anyio.CapacityLimiter] = {}


def _key_check_max_concurrency() -> int:
    try:
        return max(1, int(str(os.getenv("ITINV_KEY_CHECK_MAX_CONCURRENCY", "8") or "8")))
    except ValueError:
        return 8


def _get_key_check_limiter() -> anyio.CapacityLimiter:
    key = id(asyncio.get_running_loop())
    limiter = _key_check_limiters.get(key)
    if limiter is None:
        limiter = _key_check_limiters[key] = anyio.CapacityLimiter(_key_check_max_concurrency())
    return limiter


async def _run_key_check(fn: Callable[..., Any], *args: Any) -> Any:
    return await anyio.to_thread.run_sync(
        functools.partial(fn, *args), limiter=_get_key_check_limiter()
    )


# Temporary: DLP UI/API read path is admin-only while the page is mothballed.
_DLP_READ = [Depends(get_current_admin_user)]


def _load_agent_api_keys() -> List[str]:
    keys: List[str] = []
    ring = str(os.getenv("ITINV_AGENT_API_KEYS", "") or "").strip()
    if ring:
        for part in ring.split(","):
            key = part.strip()
            if key and key not in keys:
                keys.append(key)
    legacy = str(os.getenv("ITINV_AGENT_API_KEY", "") or "").strip()
    if legacy and legacy not in keys:
        keys.append(legacy)
    return keys


def _bound_agent_name_for_key(candidate: Optional[str]) -> str:
    token = str(candidate or "").strip()
    try:
        return inventory_runtime._bound_agent_name_for_key(
            token,
            # Preserve the shared-ring fallback; DB-managed keys must be verified.
            raise_on_error=bool(token) and token not in _load_agent_api_keys(),
        )
    except Exception as exc:
        raise HTTPException(
            status_code=status.HTTP_503_SERVICE_UNAVAILABLE,
            detail="Agent key verification unavailable",
            headers={"Retry-After": "30"},
        ) from exc


def _check_agent_identity(x_api_key: Optional[str], computer_name: Optional[str]) -> None:
    """A key bound via ``INVENTORY_AGENT_API_KEYS`` may only act for its own computer."""
    bound = _bound_agent_name_for_key(x_api_key)
    if bound and not inventory_runtime._bound_identity_matches(bound, computer_name):
        logger.warning(
            "Ingest rejected key bound to computer=%s used for computer_name=%s",
            bound,
            str(computer_name or "").strip(),
        )
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Invalid API Key",
        )


def _check_egress_events_scope(x_api_key: Optional[str], events: List[Any]) -> None:
    """A bound key may only send ``computer_name`` of its own computer — the whole batch."""
    bound = _bound_agent_name_for_key(x_api_key)
    if not bound:
        return
    names = {str(e.get("computer_name") or "").strip() for e in events if isinstance(e, dict)}
    if not names or not all(
        inventory_runtime._bound_identity_matches(bound, name) for name in names
    ):
        raise HTTPException(status_code=403, detail="API key is bound to another computer")


def _is_valid_agent_api_key(candidate: Optional[str]) -> bool:
    token = str(candidate or "").strip()
    if not token:
        return False
    return token in set(_load_agent_api_keys()) or bool(_bound_agent_name_for_key(token))


@router.post("/fs-egress")
async def ingest_fs_egress(request: Request, x_api_key: Optional[str] = Header(None)) -> Dict[str, Any]:
    if not await _run_key_check(_is_valid_agent_api_key, x_api_key):
        raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="Invalid API Key")
    body = await read_json_body_limited(request)
    events = body.get("events") if isinstance(body, dict) else None
    if not isinstance(events, list):
        raise HTTPException(status_code=400, detail="events list required")
    await _run_key_check(_check_egress_events_scope, x_api_key, events)
    try:
        inserted = await _run_ingest(store.ingest_events, events)
    except store.EgressStoreUnavailableError as exc:
        # 503 keeps the agent's events queued for retry instead of losing them.
        raise HTTPException(status_code=503, detail="Egress store unavailable", headers={"Retry-After": "30"}) from exc
    return {"success": True, "inserted": inserted}


@router.get("/fs-egress", dependencies=_DLP_READ)
def list_fs_egress(
    computer_name: str = Query(""),
    channel: str = Query(""),
    limit: int = Query(100, ge=1, le=500),
    offset: int = Query(0, ge=0),
    group: int = Query(0, ge=0, le=1),
    include_noise: int = Query(0, ge=0, le=1),
    send_state: str = Query(""),
) -> Dict[str, Any]:
    try:
        items = store.list_events(
            computer_name=computer_name,
            channel=channel,
            limit=limit,
            offset=offset,
            group=bool(group),
            include_noise=bool(include_noise),
            send_state=send_state,
        )
        # The hidden-noise count is a regex scan — only needed while noise is hidden.
        noise_hidden = (
            0
            if include_noise
            else store.count_events(
                computer_name=computer_name,
                channel=channel,
                noise_only=True,
            )
        )
    except store.EgressStoreUnavailableError as exc:
        raise HTTPException(status_code=503, detail="Egress store unavailable", headers={"Retry-After": "30"}) from exc
    return {
        "success": True,
        "items": items,
        "total": len(items),
        "noise_hidden": noise_hidden,
    }


@router.get("/dlp/hosts", dependencies=_DLP_READ)
def list_dlp_hosts(category: str = Query("")) -> Dict[str, Any]:
    """Per-computer DLP stats (file events + visits) with branch/full-name."""
    try:
        hosts = store.list_dlp_hosts(category=category)
    except store.EgressStoreUnavailableError as exc:
        raise HTTPException(status_code=503, detail="Egress store unavailable", headers={"Retry-After": "30"}) from exc
    return {"success": True, "hosts": hosts}


@router.get("/dlp/summary", dependencies=_DLP_READ)
def dlp_summary() -> Dict[str, Any]:
    """Current-day counters + display-category breakdown for the page header."""
    try:
        summary = store.get_dlp_summary()
    except store.EgressStoreUnavailableError as exc:
        raise HTTPException(status_code=503, detail="Egress store unavailable", headers={"Retry-After": "30"}) from exc
    return {"success": True, "summary": summary}


@router.get("/dlp/activity", dependencies=_DLP_READ)
def dlp_activity(
    computer_name: str = Query(""),
    day: str = Query(""),
) -> Dict[str, Any]:
    """Per-host 5-minute activity buckets for one branch-local day (agent 1.4.19+)."""
    try:
        result = store.get_dlp_activity(computer_name=computer_name.strip(), day=day.strip())
    except store.EgressStoreUnavailableError as exc:
        raise HTTPException(status_code=503, detail="Egress store unavailable", headers={"Retry-After": "30"}) from exc
    return {"success": True, **result}


@router.get("/dlp/attention", dependencies=_DLP_READ)
def dlp_attention(day: str = Query("")) -> Dict[str, Any]:
    """Per-host day rollup: activity + browser focus + usb/messenger files."""
    try:
        hosts = store.get_dlp_attention(day=day.strip())
    except store.EgressStoreUnavailableError as exc:
        raise HTTPException(status_code=503, detail="Egress store unavailable", headers={"Retry-After": "30"}) from exc
    return {"success": True, "hosts": hosts}


PERM_DLP_SCHEDULE_MANAGE = "scan.schedules.manage"


@router.get("/dlp/work-schedules")
def list_dlp_work_schedules(current_user=Depends(get_current_user)) -> Dict[str, Any]:
    """Branch work schedules + known branch names for the admin editor."""
    ensure_user_permission(current_user, PERM_DLP_SCHEDULE_MANAGE)
    try:
        data = store.list_work_schedules()
    except store.EgressStoreUnavailableError as exc:
        raise HTTPException(status_code=503, detail="Egress store unavailable", headers={"Retry-After": "30"}) from exc
    return {"success": True, **data}


@router.put("/dlp/work-schedules/{branch_name}")
def save_dlp_work_schedule(
    branch_name: str,
    payload: Dict[str, Any],
    current_user=Depends(get_current_user),
) -> Dict[str, Any]:
    ensure_user_permission(current_user, PERM_DLP_SCHEDULE_MANAGE)
    body = payload if isinstance(payload, dict) else {}
    body["branch_name"] = branch_name
    try:
        row = store.save_work_schedule(body, updated_by=str(getattr(current_user, "username", "") or ""))
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc
    except store.EgressStoreUnavailableError as exc:
        raise HTTPException(status_code=503, detail="Egress store unavailable", headers={"Retry-After": "30"}) from exc
    return {"success": True, "schedule": row}


@router.delete("/dlp/work-schedules/{branch_name}")
def delete_dlp_work_schedule(
    branch_name: str,
    current_user=Depends(get_current_user),
) -> Dict[str, Any]:
    ensure_user_permission(current_user, PERM_DLP_SCHEDULE_MANAGE)
    try:
        deleted = store.delete_work_schedule(branch_name)
    except store.EgressStoreUnavailableError as exc:
        raise HTTPException(status_code=503, detail="Egress store unavailable", headers={"Retry-After": "30"}) from exc
    if not deleted:
        raise HTTPException(status_code=404, detail="График для филиала не задан")
    return {"success": True}


@router.post("/telegram-probe")
async def ingest_telegram_probe(request: Request, x_api_key: Optional[str] = Header(None)) -> Dict[str, Any]:
    if not await _run_key_check(_is_valid_agent_api_key, x_api_key):
        raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="Invalid API Key")
    payload = await read_json_body_limited(request)
    if not isinstance(payload, dict):
        raise HTTPException(status_code=400, detail="JSON object required")
    await _run_key_check(_check_agent_identity, x_api_key, payload.get("computer_name"))
    result = await _run_ingest(store.ingest_telegram_payload, payload)
    return {"success": True, **result}


@router.get("/telegram-probe", dependencies=_DLP_READ)
def list_telegram_probe(
    computer_name: str = Query(""),
    limit: int = Query(100, ge=1, le=500),
) -> Dict[str, Any]:
    return {
        "success": True,
        "chats": store.list_telegram_chats(computer_name=computer_name, limit=limit),
    }


@router.get("/telegram-probe/report", dependencies=_DLP_READ)
def telegram_probe_report(
    computer_name: str = Query(...),
):
    """Always build the current report on the server (single live snapshot per PC)."""
    try:
        row = dlp_report_service.get_current_report_html(computer_name)
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc
    return HTMLResponse(content=row.get("html") or "")


@router.get(
    "/telegram-probe/media/{computer_name}/{file_name}",
    dependencies=_DLP_READ,
)
def telegram_probe_media(computer_name: str, file_name: str):
    """Serve uploaded Telegram probe media (photo/video/file) for DLP UI."""
    safe_name = str(file_name or "").replace("\\", "/").split("/")[-1].strip()
    if not computer_name.strip() or not safe_name or ".." in safe_name:
        raise HTTPException(status_code=400, detail="invalid media path")
    row = store.get_telegram_media(computer_name=computer_name.strip(), file_name=safe_name)
    if not row or not row.get("content"):
        raise HTTPException(status_code=404, detail="media not found")
    return _dlp_media_response(row["content"], row.get("content_type"))


@router.post("/browser-probe")
async def ingest_browser_probe(request: Request, x_api_key: Optional[str] = Header(None)) -> Dict[str, Any]:
    if not await _run_key_check(_is_valid_agent_api_key, x_api_key):
        raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="Invalid API Key")
    payload = await read_json_body_limited(request)
    if not isinstance(payload, dict):
        raise HTTPException(status_code=400, detail="JSON object required")
    await _run_key_check(_check_agent_identity, x_api_key, payload.get("computer_name"))
    result = await _run_ingest(store.ingest_browser_payload, payload)
    return {"success": True, **result}


@router.get("/browser-probe", dependencies=_DLP_READ)
def list_browser_probe(
    computer_name: str = Query(""),
    category: str = Query(""),
    day: str = Query(""),
    source: str = Query(""),
    q: str = Query(""),
    limit: int = Query(100, ge=1, le=500),
    offset: int = Query(0, ge=0),
    merge: int = Query(0, ge=0, le=1),
) -> Dict[str, Any]:
    items = store.list_browser_visits(
        computer_name=computer_name,
        category=category,
        day=day,
        source=source,
        q=q,
        limit=limit,
        offset=offset,
        merge=bool(merge),
    )
    total = store.count_browser_visits(
        computer_name=computer_name,
        category=category,
        day=day,
        source=source,
        q=q,
    )
    return {"success": True, "items": items, "total": total}


@router.get("/browser-probe/hosts", dependencies=_DLP_READ)
def list_browser_probe_hosts() -> Dict[str, Any]:
    return {"success": True, "hosts": store.list_browser_hosts()}


@router.get("/browser-probe/days", dependencies=_DLP_READ)
def list_browser_probe_days(
    computer_name: str = Query(...),
    source: str = Query(""),
) -> Dict[str, Any]:
    return {
        "success": True,
        "days": store.list_browser_days(computer_name=computer_name, source=source),
    }


@router.get(
    "/browser-probe/media/{computer_name}/{file_name}",
    dependencies=_DLP_READ,
)
def browser_probe_media(computer_name: str, file_name: str):
    """Serve uploaded browser probe screenshots for DLP UI."""
    safe_name = str(file_name or "").replace("\\", "/").split("/")[-1].strip()
    if not computer_name.strip() or not safe_name or ".." in safe_name:
        raise HTTPException(status_code=400, detail="invalid media path")
    row = store.get_browser_media(computer_name=computer_name.strip(), file_name=safe_name)
    if not row or not row.get("content"):
        raise HTTPException(status_code=404, detail="media not found")
    return _dlp_media_response(row["content"], row.get("content_type") or "image/png")


@router.post("/max-probe")
async def ingest_max_probe(request: Request, x_api_key: Optional[str] = Header(None)) -> Dict[str, Any]:
    if not await _run_key_check(_is_valid_agent_api_key, x_api_key):
        raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="Invalid API Key")
    payload = await read_json_body_limited(request)
    if not isinstance(payload, dict):
        raise HTTPException(status_code=400, detail="JSON object required")
    await _run_key_check(_check_agent_identity, x_api_key, payload.get("computer_name"))
    result = await _run_ingest(store.ingest_max_payload, payload)
    return {"success": True, **result}


@router.get("/max-probe", dependencies=_DLP_READ)
def list_max_probe(
    computer_name: str = Query(""),
    limit: int = Query(100, ge=1, le=500),
) -> Dict[str, Any]:
    return {
        "success": True,
        "chats": store.list_max_chats(computer_name=computer_name, limit=limit),
    }


@router.get(
    "/max-probe/media/{computer_name}/{file_name}",
    dependencies=_DLP_READ,
)
def max_probe_media(computer_name: str, file_name: str):
    safe_name = str(file_name or "").replace("\\", "/").split("/")[-1].strip()
    if not computer_name.strip() or not safe_name or ".." in safe_name:
        raise HTTPException(status_code=400, detail="invalid media path")
    row = store.get_max_media(computer_name=computer_name.strip(), file_name=safe_name)
    if not row or not row.get("content"):
        raise HTTPException(status_code=404, detail="media not found")
    return _dlp_media_response(row["content"], row.get("content_type"))
