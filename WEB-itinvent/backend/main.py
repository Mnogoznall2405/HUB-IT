"""
Main FastAPI application entry point.
"""
import sys
import os

# CRITICAL: Switch to SelectorEventLoop on Windows BEFORE any asyncio imports
# ProactorEventLoop crashes with WinError 64 under high connection churn
if sys.platform == 'win32':
    import asyncio
    asyncio.set_event_loop_policy(asyncio.WindowsSelectorEventLoopPolicy())
    print(f"Using SelectorEventLoop (Python {sys.version})")

import logging
from pathlib import Path

# Add parent directory to path for bot imports
project_root = Path(__file__).parent.parent
if str(project_root) not in sys.path:
    sys.path.insert(0, str(project_root))

import asyncio
from contextlib import asynccontextmanager
from anyio import to_thread
from fastapi import FastAPI, Request
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import JSONResponse

from backend.config import config
from backend.api.v1 import auth, equipment, database, json_operations, settings, networks, discovery, inventory, kb, mfu, hub, mail, ad_users, vcs, ai_bots, departments
from backend.services.ad_sync_service import background_ad_sync_loop
from backend.services.auth_runtime_store_service import auth_runtime_store_service
from backend.services.mail_notification_service import mail_notification_service
from backend.services.mfu_monitor_service import mfu_runtime_monitor
from backend.rate_limit import limiter, rate_limit_exception, rate_limit_exception_handler, internal_ip_bypass_middleware
from local_store import get_local_store


def _env_flag(name: str, default: str = "0") -> bool:
    return str(os.getenv(name, default)).strip().lower() in {"1", "true", "yes", "on"}


def _env_positive_int(name: str, default: int, minimum: int) -> int:
    raw = str(os.getenv(name, str(default)) or "").strip()
    try:
        return max(int(raw), int(minimum))
    except Exception:
        return max(int(default), int(minimum))


MAIL_MODULE_ENABLED = _env_flag("MAIL_MODULE_ENABLED", "0")
MAIL_NOTIFICATION_BACKGROUND_ENABLED = _env_flag("MAIL_NOTIFICATION_BACKGROUND_ENABLED", "1")
LDAP_SYNC_BACKGROUND_ENABLED = _env_flag("LDAP_SYNC_BACKGROUND_ENABLED", "1")
MFU_RUNTIME_MONITOR_ENABLED = _env_flag("MFU_RUNTIME_MONITOR_ENABLED", "1")
SUPPRESS_NOISY_ACCESS_LOGS = _env_flag("SUPPRESS_NOISY_ACCESS_LOGS", "1")
ANYIO_THREAD_TOKENS = _env_positive_int("ANYIO_THREAD_TOKENS", 120, 40)


class _UvicornAccessNoiseFilter(logging.Filter):
    def filter(self, record: logging.LogRecord) -> bool:
        try:
            message = record.getMessage()
        except Exception:
            return True
        if (
            '"POST /api/v1/inventory HTTP/1.1"' in message
            and (' 200 ' in message or ' 429 ' in message)
        ):
            return False
        if '"WebSocket /api/v1/chat/ws" 403' in message:
            return False
        return True


class _UvicornErrorNoiseFilter(logging.Filter):
    def filter(self, record: logging.LogRecord) -> bool:
        try:
            message = record.getMessage()
        except Exception:
            return True
        # Suppress WinError 64 (client disconnected) - normal under high load
        if 'WinError 64' in message or 'Удаленный узел закрыл подключение' in message:
            return False
        if '"WebSocket /api/v1/chat/ws" 403' in message:
            return False
        if 'connection rejected (403 Forbidden)' in message:
            return False
        return True


def _install_uvicorn_access_noise_filter() -> None:
    if not SUPPRESS_NOISY_ACCESS_LOGS:
        return
    access_logger = logging.getLogger("uvicorn.access")
    access_logger.setLevel(logging.CRITICAL + 1)
    access_logger.disabled = True
    access_logger.propagate = False
    if not any(isinstance(item, _UvicornAccessNoiseFilter) for item in access_logger.filters):
        access_logger.addFilter(_UvicornAccessNoiseFilter())
    for handler in access_logger.handlers:
        handler.setLevel(logging.CRITICAL + 1)
        if not any(isinstance(item, _UvicornAccessNoiseFilter) for item in handler.filters):
            handler.addFilter(_UvicornAccessNoiseFilter())
    error_logger = logging.getLogger("uvicorn.error")
    if not any(isinstance(item, _UvicornErrorNoiseFilter) for item in error_logger.filters):
        error_logger.addFilter(_UvicornErrorNoiseFilter())
    for handler in error_logger.handlers:
        if not any(isinstance(item, _UvicornErrorNoiseFilter) for item in handler.filters):
            handler.addFilter(_UvicornErrorNoiseFilter())


def _install_application_logger_bridge() -> None:
    source_logger = logging.getLogger("uvicorn.error")
    source_handlers = list(source_logger.handlers)
    if not source_handlers:
        return

    for logger_name in (
        "backend.chat.api",
        "backend.chat.websocket",
        "backend.chat.realtime",
        "backend.chat.service",
        "backend.chat.push_outbox",
    ):
        target_logger = logging.getLogger(logger_name)
        for handler in source_handlers:
            if handler not in target_logger.handlers:
                target_logger.addHandler(handler)
        target_logger.setLevel(min(target_logger.level or logging.INFO, logging.INFO))
        target_logger.propagate = False


_install_uvicorn_access_noise_filter()
_install_application_logger_bridge()


def _configure_anyio_thread_limiter() -> int:
    limiter = to_thread.current_default_thread_limiter()
    current_tokens = int(getattr(limiter, "total_tokens", 0) or 0)
    if current_tokens < ANYIO_THREAD_TOKENS:
        limiter.total_tokens = ANYIO_THREAD_TOKENS
    return int(getattr(limiter, "total_tokens", ANYIO_THREAD_TOKENS) or ANYIO_THREAD_TOKENS)


@asynccontextmanager
async def lifespan(app: FastAPI):
    """Application lifespan manager."""
    # Startup
    _install_uvicorn_access_noise_filter()
    _install_application_logger_bridge()
    thread_tokens = _configure_anyio_thread_limiter()
    sync_task: asyncio.Task | None = None
    if LDAP_SYNC_BACKGROUND_ENABLED:
        sync_task = asyncio.create_task(background_ad_sync_loop())
    if MFU_RUNTIME_MONITOR_ENABLED:
        await mfu_runtime_monitor.start()
    if MAIL_MODULE_ENABLED and MAIL_NOTIFICATION_BACKGROUND_ENABLED:
        await mail_notification_service.start()
    print(f"Starting {config.app.app_name} v{config.app.version}")
    print(f"Database: {config.database.host} / {config.database.database}")
    print(f"Debug mode: {config.app.debug}")
    print(
        "Background jobs:"
        f" ldap_sync={LDAP_SYNC_BACKGROUND_ENABLED}"
        f" mfu_monitor={MFU_RUNTIME_MONITOR_ENABLED}"
        f" mail_notifications={MAIL_MODULE_ENABLED and MAIL_NOTIFICATION_BACKGROUND_ENABLED}"
    )
    print(f"AnyIO thread tokens: {thread_tokens}")
    if config.jwt.secret_key == "your-secret-key-change-in-production":
        print("WARNING: insecure default JWT secret is configured. Set JWT_SECRET_KEYS or JWT_SECRET_KEY.")
    print(
        "Auth security:"
        f" 2fa_enforced={config.security.twofa_enforced}"
        f" 2fa_policy={config.security.twofa_policy or ('all' if config.security.twofa_enforced else 'off')}"
        f" runtime_store={auth_runtime_store_service.backend_name}"
        f" rate_limit_storage={(config.security.rate_limit_storage_url or 'memory://')}"
    )
    if str(config.app_db.database_url or "").strip():
        try:
            from backend.appdb.db import initialize_app_schema, ping_app_database

            initialize_app_schema()
            ping_app_database()
            print("Internal app database: configured and reachable")
            expired_runtime_items = auth_runtime_store_service.cleanup_expired()
            if expired_runtime_items:
                print(f"Auth runtime cleanup: removed {expired_runtime_items} expired items")
        except Exception as exc:
            print(f"Internal app database init warning: {exc}")
    else:
        try:
            store = get_local_store()
            print(f"Local SQLite store: {store.db_path}")
        except Exception as exc:
            print(f"SQLite init warning: {exc}")
    if config.chat.enabled:
        try:
            from backend.chat.service import chat_service
            from backend.chat.push_service import chat_push_service
            from backend.chat.realtime import chat_realtime
            from backend.ai_chat.service import ai_chat_service

            chat_status = chat_service.initialize_runtime()
            ai_chat_service.initialize_runtime()
            await chat_service.start()
            await chat_realtime.start()
            print(
                "Chat module:"
                f" enabled={chat_status.enabled}"
                f" configured={chat_status.configured}"
                f" available={chat_status.available}"
            )
            push_status = chat_push_service.get_runtime_status()
            print(
                "Chat push:"
                f" enabled={push_status['enabled']}"
                f" configured={push_status['configured']}"
                f" dependency_available={push_status['dependency_available']}"
                f" public_key_present={push_status['public_key_present']}"
                f" private_key_present={push_status['private_key_present']}"
                f" subject_present={push_status['subject_present']}"
            )
        except Exception as exc:
            print(f"Chat init warning: {exc}")
    yield
    # Shutdown
    print("Shutting down...")
    if sync_task is not None:
        sync_task.cancel()
    if MAIL_MODULE_ENABLED and MAIL_NOTIFICATION_BACKGROUND_ENABLED:
        await mail_notification_service.stop()
    if MFU_RUNTIME_MONITOR_ENABLED:
        await mfu_runtime_monitor.stop()
    if config.chat.enabled:
        try:
            from backend.chat.service import chat_service
            from backend.chat.realtime import chat_realtime

            await chat_realtime.stop()
            await chat_service.stop()
        except Exception:
            pass
    if sync_task is not None:
        try:
            await sync_task
        except asyncio.CancelledError:
            pass


# Create FastAPI app
app = FastAPI(
    title=config.app.app_name,
    version=config.app.version,
    debug=config.app.debug,
    lifespan=lifespan,
    docs_url="/docs" if config.app.debug else None,
    redoc_url="/redoc" if config.app.debug else None,
)
app.state.limiter = limiter

if internal_ip_bypass_middleware is not None:
    app.add_middleware(internal_ip_bypass_middleware)

# Configure CORS
app.add_middleware(
    CORSMiddleware,
    allow_origins=config.app.cors_origins,
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)
# Global SlowAPIMiddleware stays disabled.
# Auth throttling is enforced explicitly in auth.py so internal requests can be skipped reliably.
if rate_limit_exception is not None and rate_limit_exception_handler is not None:
    app.add_exception_handler(rate_limit_exception, rate_limit_exception_handler)


# Health check endpoint
@app.get("/health")
async def health_check():
    """Health check endpoint."""
    payload = {"status": "ok", "version": config.app.version}
    if config.chat.enabled:
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
    return payload


# Exception handlers
@app.exception_handler(Exception)
async def global_exception_handler(request: Request, exc: Exception):
    """Global exception handler."""
    return JSONResponse(
        status_code=500,
        content={"detail": str(exc) if config.app.debug else "Internal server error"}
    )


# Include routers
app.include_router(auth.router, prefix="/api/v1/auth", tags=["Authentication"])
app.include_router(equipment.router, prefix="/api/v1/equipment", tags=["Equipment"])
app.include_router(database.router, prefix="/api/v1/database", tags=["Database Management"])
app.include_router(json_operations.router, prefix="/api/v1/json", tags=["JSON Operations"])
app.include_router(settings.router, prefix="/api/v1/settings", tags=["User Settings"])
app.include_router(networks.router, prefix="/api/v1/networks", tags=["Networks"])
app.include_router(discovery.router, prefix="/api/v1/discovery", tags=["Discovery"])
app.include_router(inventory.router, prefix="/api/v1/inventory", tags=["Inventory"])
app.include_router(kb.router, prefix="/api/v1/kb", tags=["Knowledge Base"])
app.include_router(mfu.router, prefix="/api/v1/mfu", tags=["MFU"])
app.include_router(hub.router, prefix="/api/v1/hub", tags=["Hub"])
app.include_router(departments.router, prefix="/api/v1/departments", tags=["Departments"])
app.include_router(ad_users.router, prefix="/api/v1/ad-users", tags=["AD Users"])
app.include_router(mail.router, prefix="/api/v1/mail", tags=["Mail"])
app.include_router(vcs.router, prefix="/api/v1/vcs", tags=["VCS"])
app.include_router(ai_bots.router, prefix="/api/v1/ai-bots", tags=["AI Bots"])
if config.chat.enabled:
    try:
        from backend.api.v1 import chat

        app.include_router(chat.router, prefix="/api/v1/chat", tags=["Chat"])
    except Exception as exc:
        print(f"Chat router warning: {exc}")

# Root endpoint
@app.get("/")
async def root():
    """Root endpoint with API information."""
    return {
        "name": config.app.app_name,
        "version": config.app.version,
        "docs": "/docs",
        "health": "/health"
    }


if __name__ == "__main__":
    import uvicorn
    backend_host = os.getenv("BACKEND_HOST", "127.0.0.1")
    backend_port = int(os.getenv("BACKEND_PORT", "8001"))
    uvicorn.run(
        "backend.main:app",
        host=backend_host,
        port=backend_port,
        loop="none",
        reload=config.app.debug,
    )
