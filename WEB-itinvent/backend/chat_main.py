"""Chat-only FastAPI entrypoint (isolated process from Main HUB API)."""
from __future__ import annotations

import asyncio
import logging
import os
import sys
import time
from contextlib import asynccontextmanager
from pathlib import Path

# CRITICAL: SelectorEventLoop on Windows BEFORE other asyncio imports.
if sys.platform == "win32":
    import asyncio as _asyncio

    _asyncio.set_event_loop_policy(_asyncio.WindowsSelectorEventLoopPolicy())
    print(f"[chat] Using SelectorEventLoop (Python {sys.version})")

# WEB-itinvent (package root for `backend.*`) + repo root for shared modules.
_web_root = Path(__file__).resolve().parent.parent
_repo_root = _web_root.parent
for _root in (_repo_root, _web_root):
    if str(_root) not in sys.path:
        sys.path.insert(0, str(_root))

from anyio import to_thread
from fastapi import FastAPI, Request
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import JSONResponse

from backend.config import config
from backend.api.v1 import auth, system
from backend.rate_limit import limiter, rate_limit_exception, rate_limit_exception_handler, internal_ip_bypass_middleware
from backend.runtime_role import get_runtime_role, is_chat_process
from backend.services.auth_runtime_store_service import auth_runtime_store_service
from backend.services.request_metrics_service import request_metrics_middleware
from backend.json_db.manager import validate_json_runtime_storage


def _env_positive_int(name: str, default: int, minimum: int) -> int:
    raw = str(os.getenv(name, str(default)) or "").strip()
    try:
        return max(int(raw), int(minimum))
    except Exception:
        return max(int(default), int(minimum))


def _env_flag(name: str, default: bool = False) -> bool:
    raw = str(os.getenv(name, "1" if default else "0") or "").strip().lower()
    return raw in {"1", "true", "yes", "on"}


ANYIO_THREAD_TOKENS = _env_positive_int("ANYIO_THREAD_TOKENS", 80, 20)


def _configure_anyio_thread_limiter() -> int:
    limiter_obj = to_thread.current_default_thread_limiter()
    current_tokens = int(getattr(limiter_obj, "total_tokens", 0) or 0)
    if current_tokens < ANYIO_THREAD_TOKENS:
        limiter_obj.total_tokens = ANYIO_THREAD_TOKENS
    return int(getattr(limiter_obj, "total_tokens", ANYIO_THREAD_TOKENS) or ANYIO_THREAD_TOKENS)


def _pool_snapshot(engine) -> dict:
    pool = getattr(engine, "pool", None)
    if pool is None:
        return {"available": False}
    checked_out = int(getattr(pool, "checkedout", lambda: 0)() or 0)
    checked_in = int(getattr(pool, "checkedin", lambda: 0)() or 0)
    overflow = int(getattr(pool, "overflow", lambda: 0)() or 0)
    size = int(getattr(pool, "size", lambda: 0)() or 0)
    return {
        "available": True,
        "pool_size": size,
        "checked_out": checked_out,
        "checked_in": checked_in,
        "overflow": overflow,
        "max_overflow": int(getattr(pool, "_max_overflow", 0) or 0),
        "timeout": float(getattr(pool, "_timeout", 0) or 0),
    }


@asynccontextmanager
async def lifespan(app: FastAPI):
    try:
        from backend.chat.async_logging import install_chat_async_logging

        install_chat_async_logging()
    except Exception as exc:
        print(f"[chat] async logging install warning: {exc}")

    _configure_anyio_thread_limiter()
    role = get_runtime_role()
    print(f"Starting Chat API v{config.app.version} role={role}")
    if not is_chat_process() and role != "embedded":
        print(f"[chat] WARNING: HUBIT_RUNTIME_ROLE={role}; expected chat")

    validate_json_runtime_storage()
    if str(config.app_db.database_url or "").strip():
        try:
            from backend.appdb.db import initialize_app_schema, ping_app_database

            initialize_app_schema()
            ping_app_database()
            expired = auth_runtime_store_service.cleanup_expired()
            if expired:
                print(f"Auth runtime cleanup: removed {expired} expired items")
            try:
                from backend.config import session_policy_snapshot
                from backend.services.session_service import session_service as _session_service

                policy = session_policy_snapshot()
                print(
                    "Session policy:"
                    f" internal_idle_days={policy.get('idle_timeout_internal_days')}"
                    f" refresh_days={policy.get('refresh_token_expire_days')}"
                    f" refresh_grace_sec={policy.get('refresh_rotation_grace_seconds')}"
                )
                backfill = _session_service.reapply_idle_policy_for_active_sessions()
                print(
                    "Session idle backfill:"
                    f" inspected={backfill.get('inspected')}"
                    f" updated={backfill.get('updated')}"
                )
            except Exception as session_policy_exc:
                print(f"Session policy/backfill warning: {session_policy_exc}")
        except Exception as exc:
            print(f"App DB init warning: {exc}")

    if not config.chat.enabled:
        raise RuntimeError("Chat module disabled; cannot start Chat API")

    from backend.chat.service import chat_service
    from backend.chat.push_service import chat_push_service
    from backend.chat.realtime import chat_realtime
    from backend.ai_chat.service import ai_chat_service

    chat_status = chat_service.initialize_runtime()
    ai_chat_service.initialize_runtime()
    try:
        from backend.chat.db import log_chat_pool_budget

        budget = log_chat_pool_budget(processes=int(os.getenv("CHAT_PROCESS_COUNT", "1") or 1))
        print(
            "[chat] DB pool budget "
            f"write_cap={budget.get('write_pool_capacity')} "
            f"read_cap={budget.get('read_pool_capacity')} "
            f"estimated={budget.get('estimated_total_pg_connections')} "
            f"limit={budget.get('connection_budget')}"
        )
    except Exception as exc:
        print(f"[chat] DB pool budget warning: {exc}")
    chat_surface = str(os.getenv("CHAT_SURFACE", "full") or "full").strip().lower()
    await chat_service.start()
    if chat_surface != "read":
        await chat_realtime.start()
        from backend.realtime.hub import hub_realtime_publisher

        await hub_realtime_publisher.start(realtime_manager=chat_realtime)

    from backend.chat.latency_profile import lag_probe_loop, note_main_thread

    note_main_thread()
    lag_task = asyncio.create_task(
        lag_probe_loop(process=f"chat:{chat_surface}"),
        name="chat-event-loop-lag-probe",
    )
    print(
        "Chat module:"
        f" enabled={chat_status.enabled}"
        f" configured={chat_status.configured}"
        f" available={chat_status.available}"
        f" surface={chat_surface}"
    )
    push_status = chat_push_service.get_runtime_status()
    print(
        "Chat push:"
        f" enabled={push_status['enabled']}"
        f" configured={push_status['configured']}"
    )

    yield

    print("Chat API shutting down...")
    lag_task.cancel()
    try:
        await lag_task
    except asyncio.CancelledError:
        pass
    try:
        if chat_surface != "read":
            from backend.realtime.hub import hub_realtime_publisher

            await hub_realtime_publisher.stop()
            await chat_realtime.stop()
        await chat_service.stop()
    except Exception:
        logging.getLogger(__name__).exception("Chat shutdown failed")
    try:
        from backend.chat.async_logging import stop_chat_async_logging

        stop_chat_async_logging()
    except Exception:
        pass


app = FastAPI(
    title=f"{config.app.app_name} Chat",
    version=config.app.version,
    debug=config.app.debug,
    lifespan=lifespan,
    docs_url="/docs" if config.app.debug else None,
    redoc_url="/redoc" if config.app.debug else None,
)
app.state.limiter = limiter

if internal_ip_bypass_middleware is not None:
    app.add_middleware(internal_ip_bypass_middleware)

app.add_middleware(
    CORSMiddleware,
    allow_origins=config.app.cors_origins,
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)
app.middleware("http")(request_metrics_middleware)


@app.middleware("http")
async def chat_latency_asgi_marks(request, call_next):
    """Stamp ASGI receive / middleware enter for handler_queue_wait measurement."""
    now = time.perf_counter()
    request.state.chat_asgi_received_at = now
    request.state.chat_middleware_enter_at = now
    response = await call_next(request)
    try:
        from backend.chat.latency_profile import profile_trace

        path = str(getattr(request.url, "path", "") or "")
        if path.startswith("/api/v1/chat/") and "elapsed" not in path:
            total_ms = (time.perf_counter() - now) * 1000.0
            if total_ms >= 200.0:
                profile_trace(
                    "http",
                    "asgi_request_total",
                    total_ms,
                    path=path[:120],
                    method=str(request.method or "")[:12],
                )
    except Exception:
        pass
    return response


if rate_limit_exception is not None and rate_limit_exception_handler is not None:
    app.add_exception_handler(rate_limit_exception, rate_limit_exception_handler)


@app.get("/health")
async def health_check():
    return {
        "status": "ok",
        "version": config.app.version,
        "runtime_role": get_runtime_role(),
        "process": "chat",
    }


@app.get("/health/ready")
async def health_ready():
    redis_required = _env_flag("CHAT_REDIS_REQUIRED")
    realtime_required = _env_flag("CHAT_REALTIME_REQUIRED") or redis_required
    payload = {
        "status": "ok",
        "version": config.app.version,
        "runtime_role": get_runtime_role(),
        "process": "chat",
        "redis_required": redis_required,
        "realtime_required": realtime_required,
    }
    try:
        from backend.chat.service import chat_service

        payload["chat"] = await to_thread.run_sync(chat_service.get_health)
    except Exception:
        payload["chat"] = {
            "enabled": True,
            "available": False,
            "configured": bool(config.chat.database_url),
            "realtime_mode": "unknown",
        }
        payload["status"] = "degraded"
    if realtime_required:
        chat_health = payload.get("chat") or {}
        if redis_required and "realtime_available" not in chat_health:
            realtime_ready = bool(chat_health.get("redis_available")) and bool(
                chat_health.get("pubsub_subscribed")
            )
        else:
            realtime_ready = bool(chat_health.get("realtime_configured")) and bool(
                chat_health.get("realtime_available")
            ) and bool(chat_health.get("realtime_subscriber_ready"))
        if not realtime_ready:
            payload["status"] = "degraded"
            return JSONResponse(status_code=503, content=payload)
    return payload


@app.get("/health/pools")
async def health_pools():
    """DB pool utilization for Chat API process."""
    from backend.appdb.db import get_app_engine
    from backend.chat.db import get_chat_engine

    app_pool = {}
    chat_pool = {}
    try:
        app_pool = _pool_snapshot(get_app_engine())
    except Exception as exc:
        app_pool = {"available": False, "error": str(exc)}
    try:
        chat_pool = _pool_snapshot(get_chat_engine())
    except Exception as exc:
        chat_pool = {"available": False, "error": str(exc)}
    logging_stats = {}
    sender_metrics = {}
    try:
        from backend.chat.async_logging import logging_stats as _logging_stats

        logging_stats = _logging_stats()
    except Exception as exc:
        logging_stats = {"available": False, "error": str(exc)}
    try:
        from backend.chat.realtime import get_chat_realtime_metrics

        sender_metrics = get_chat_realtime_metrics()
    except Exception as exc:
        sender_metrics = {"available": False, "error": str(exc)}
    return {
        "process": "chat",
        "runtime_role": get_runtime_role(),
        "app_db": app_pool,
        "chat_db": chat_pool,
        "async_logging": logging_stats,
        "realtime_sender": sender_metrics,
    }


@app.exception_handler(Exception)
async def global_exception_handler(request: Request, exc: Exception):
    return JSONResponse(
        status_code=500,
        content={"detail": str(exc) if config.app.debug else "Internal server error"},
    )


# Auth is required for JWT/cookie validation on WS and HTTP chat routes.
# Login can still live on Main API; Chat only needs token verification paths.
app.include_router(auth.router, prefix="/api/v1/auth", tags=["Authentication"])
app.include_router(system.router, prefix="/api/v1/system", tags=["System"])

if config.chat.enabled:
    from backend.api.v1 import chat

    app.include_router(chat.router, prefix="/api/v1/chat", tags=["Chat"])
else:
    raise RuntimeError("CHAT_ENABLED must be on for Chat API")


@app.get("/")
async def root():
    return {
        "name": f"{config.app.app_name} Chat",
        "version": config.app.version,
        "runtime_role": get_runtime_role(),
        "health": "/health",
        "docs": "/docs" if config.app.debug else None,
    }


if __name__ == "__main__":
    import uvicorn

    host = os.getenv("BACKEND_HOST", "127.0.0.1")
    port = int(os.getenv("BACKEND_PORT", "8002"))
    uvicorn.run(
        "backend.chat_main:app",
        host=host,
        port=port,
        loop="none",
        reload=False,
    )
