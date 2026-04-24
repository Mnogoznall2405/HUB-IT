from __future__ import annotations

from fastapi import Request, Response
from ipaddress import ip_address, ip_network
from starlette.middleware.base import BaseHTTPMiddleware

from backend.config import config
from backend.utils.request_network import build_request_network_context

# Internal network ranges exempt from rate limiting
INTERNAL_NETWORKS = [
    ip_network("10.0.0.0/8"),
    ip_network("172.16.0.0/12"),
    ip_network("192.168.0.0/16"),
    ip_network("127.0.0.0/8"),
]

def _is_internal_ip(request: Request) -> bool:
    """Check if request comes from internal network."""
    try:
        client_ip = str(build_request_network_context(request).client_ip or "").strip()
        if not client_ip:
            return False
        addr = ip_address(client_ip)
        return any(addr in net for net in INTERNAL_NETWORKS)
    except (ValueError, TypeError):
        return False


def _forwarded_ip(request: Request) -> str:
    client_ip = str(build_request_network_context(request).client_ip or "").strip()
    return client_ip or "unknown"


# Middleware to skip rate limiting for internal IPs
class InternalIPBypassMiddleware(BaseHTTPMiddleware):
    """Bypass rate limiting for requests from internal networks."""
    async def dispatch(self, request: Request, call_next):
        if _is_internal_ip(request):
            # Mark request to skip rate limiting
            request.state.skip_rate_limit = True
        return await call_next(request)


try:  # pragma: no cover - dependency/runtime wiring
    from slowapi import Limiter
    from slowapi.errors import RateLimitExceeded
    from slowapi.extension import _rate_limit_exceeded_handler
    from slowapi.middleware import SlowAPIMiddleware

    limiter = Limiter(
        key_func=_forwarded_ip,
        storage_uri=str(config.security.rate_limit_storage_url or "memory://").strip() or "memory://",
    )

    # Custom rate limit key func that returns None for internal IPs (skip limiting)
    _original_key_func = limiter._key_func

    def _smart_key_func(request: Request):
        if getattr(request.state, 'skip_rate_limit', False):
            return None  # None means skip rate limiting in slowapi
        return _original_key_func(request)

    limiter._key_func = _smart_key_func

    rate_limit_exception = RateLimitExceeded
    rate_limit_exception_handler = _rate_limit_exceeded_handler
    slowapi_middleware = SlowAPIMiddleware
    internal_ip_bypass_middleware = InternalIPBypassMiddleware
except Exception:  # pragma: no cover - safe fallback
    class _NoopLimiter:
        def limit(self, *_args, **_kwargs):
            def _decorator(func):
                return func

            return _decorator

    limiter = _NoopLimiter()
    rate_limit_exception = None
    rate_limit_exception_handler = None
    slowapi_middleware = None
    internal_ip_bypass_middleware = None
