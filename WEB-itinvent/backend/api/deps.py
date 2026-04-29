"""
FastAPI dependency functions for authentication and database access.
"""
from typing import Any, Callable, Optional
import logging

from fastapi import Depends, HTTPException, status, Cookie, Header, Request, WebSocket
from fastapi.concurrency import run_in_threadpool
from fastapi.security import HTTPBearer, HTTPAuthorizationCredentials

from backend.config import config
from backend.models.auth import User
from backend.utils.security import decode_access_token
from backend.database.connection import get_user_database
from backend.utils.request_network import build_request_network_context
from backend.services.app_settings_service import app_settings_service
from backend.services.authorization_service import authorization_service
from backend.services.session_service import session_service
from backend.services.settings_service import settings_service
from backend.services.session_auth_context_service import session_auth_context_service
from backend.services.user_db_selection_service import user_db_selection_service
from backend.services.user_service import user_service
from backend.services.auth_runtime_store_service import auth_runtime_store_service
from backend.services.trusted_device_service import trusted_device_service


security_optional = HTTPBearer(auto_error=False)
logger = logging.getLogger(__name__)


def _user_role(user: User | dict[str, Any] | None) -> str:
    if isinstance(user, dict):
        return str(user.get("role") or "").strip().lower()
    return str(getattr(user, "role", "") or "").strip().lower()


def _user_username(user: User | dict[str, Any] | None) -> str:
    if isinstance(user, dict):
        return str(user.get("username") or "").strip()
    return str(getattr(user, "username", "") or "").strip()


def ensure_admin_ip_allowed(
    user: User | dict[str, Any] | None,
    *,
    client_ip: str,
    via_forwarded_header: bool = False,
    entrypoint: str,
    status_code: int,
    detail: str,
) -> None:
    if _user_role(user) != "admin":
        return
    if app_settings_service.is_admin_login_ip_allowed(client_ip):
        return
    logger.warning(
        "Admin IP allowlist rejected username=%s client_ip=%s via_forwarded_header=%s entrypoint=%s",
        _user_username(user) or "unknown",
        str(client_ip or "").strip() or "unknown",
        bool(via_forwarded_header),
        str(entrypoint or "").strip() or "session",
    )
    headers = {"WWW-Authenticate": "Bearer"} if int(status_code) == status.HTTP_401_UNAUTHORIZED else None
    raise HTTPException(status_code=status_code, detail=detail, headers=headers)


def _resolve_access_token(
    credentials: Optional[HTTPAuthorizationCredentials],
    access_token_cookie: Optional[str],
) -> Optional[str]:
    if credentials and credentials.credentials:
        return credentials.credentials
    if access_token_cookie:
        return str(access_token_cookie).strip() or None
    return None


def _load_user_from_token(token: Optional[str]) -> User:
    credentials_exception = HTTPException(
        status_code=status.HTTP_401_UNAUTHORIZED,
        detail="Could not validate credentials",
        headers={"WWW-Authenticate": "Bearer"},
    )

    normalized_token = str(token or "").strip()
    if not normalized_token:
        raise credentials_exception

    token_data = decode_access_token(normalized_token, expected_token_type="access")
    if token_data is None:
        raise credentials_exception
    if token_data.jti and auth_runtime_store_service.is_jti_revoked(token_data.jti):
        raise credentials_exception

    if token_data.session_id and not session_service.is_session_active(token_data.session_id):
        session_auth_context_service.delete_session_context(token_data.session_id)
        raise credentials_exception

    user_raw = None
    if token_data.user_id not in (None, 0):
        user_raw = user_service.get_by_id(token_data.user_id)
    if user_raw is None and token_data.username:
        user_raw = user_service.get_by_username(token_data.username)
    if not user_raw:
        raise credentials_exception

    if not trusted_device_service.is_token_device_valid(
        user_id=int(user_raw.get("id") or 0),
        token_device_id=token_data.device_id,
    ):
        raise credentials_exception

    if token_data.session_id:
        session_service.touch_session(token_data.session_id)

    public_user = user_service.to_public_user(user_raw)
    public_user["permissions"] = authorization_service.get_effective_permissions(
        public_user.get("role"),
        use_custom_permissions=bool(public_user.get("use_custom_permissions", False)),
        custom_permissions=public_user.get("custom_permissions"),
    )
    return User(**public_user)


def _load_session_id_from_token(token: Optional[str]) -> Optional[str]:
    credentials_exception = HTTPException(
        status_code=status.HTTP_401_UNAUTHORIZED,
        detail="Could not validate credentials",
        headers={"WWW-Authenticate": "Bearer"},
    )

    normalized_token = str(token or "").strip()
    if not normalized_token:
        raise credentials_exception

    token_data = decode_access_token(normalized_token, expected_token_type="access")
    if token_data is None:
        raise credentials_exception
    if token_data.jti and auth_runtime_store_service.is_jti_revoked(token_data.jti):
        raise credentials_exception

    session_id = str(token_data.session_id or "").strip() or None
    if session_id and not session_service.is_session_active(session_id):
        session_auth_context_service.delete_session_context(session_id)
        raise credentials_exception
    return session_id


def _load_optional_user_from_token(token: Optional[str]) -> Optional[User]:
    normalized_token = str(token or "").strip()
    if not normalized_token:
        return None

    token_data = decode_access_token(normalized_token, expected_token_type="access")
    if token_data is None:
        return None
    if token_data.jti and auth_runtime_store_service.is_jti_revoked(token_data.jti):
        return None

    if token_data.session_id and not session_service.is_session_active(token_data.session_id):
        return None

    user_raw = None
    if token_data.user_id not in (None, 0):
        user_raw = user_service.get_by_id(token_data.user_id)
    if user_raw is None and token_data.username:
        user_raw = user_service.get_by_username(token_data.username)
    if not user_raw:
        return None

    if not trusted_device_service.is_token_device_valid(
        user_id=int(user_raw.get("id") or 0),
        token_device_id=token_data.device_id,
    ):
        return None

    if token_data.session_id:
        session_service.touch_session(token_data.session_id)

    public_user = user_service.to_public_user(user_raw)
    public_user["permissions"] = authorization_service.get_effective_permissions(
        public_user.get("role"),
        use_custom_permissions=bool(public_user.get("use_custom_permissions", False)),
        custom_permissions=public_user.get("custom_permissions"),
    )
    return User(**public_user)


async def get_current_user(
    request: Request,
    credentials: Optional[HTTPAuthorizationCredentials] = Depends(security_optional),
    access_token_cookie: Optional[str] = Cookie(None, alias=config.app.auth_cookie_name),
) -> User:
    """
    Dependency to get the current authenticated user from JWT token.

    Raises:
        HTTPException 401 if token is invalid or missing

    Returns:
        User object
    """
    token = _resolve_access_token(credentials, access_token_cookie)
    current_user = await run_in_threadpool(_load_user_from_token, token)
    network_context = build_request_network_context(request)
    ensure_admin_ip_allowed(
        current_user,
        client_ip=network_context.client_ip,
        via_forwarded_header=bool(network_context.via_forwarded_header),
        entrypoint="session",
        status_code=status.HTTP_403_FORBIDDEN,
        detail="Admin access from this IP is not allowed",
    )
    return current_user


async def get_current_session_id(
    credentials: Optional[HTTPAuthorizationCredentials] = Depends(security_optional),
    access_token_cookie: Optional[str] = Cookie(None, alias=config.app.auth_cookie_name),
) -> Optional[str]:
    token = _resolve_access_token(credentials, access_token_cookie)
    return await run_in_threadpool(_load_session_id_from_token, token)


async def get_current_user_from_websocket(websocket: WebSocket) -> User:
    authorization_header = str(websocket.headers.get("authorization") or "").strip()
    credentials = None
    if authorization_header.lower().startswith("bearer "):
        credentials = authorization_header[7:].strip() or None
    access_token_cookie = websocket.cookies.get(config.app.auth_cookie_name)
    token = _resolve_access_token(
        HTTPAuthorizationCredentials(scheme="Bearer", credentials=credentials) if credentials else None,
        access_token_cookie,
    )
    current_user = await run_in_threadpool(_load_user_from_token, token)
    network_context = build_request_network_context(websocket)
    ensure_admin_ip_allowed(
        current_user,
        client_ip=network_context.client_ip,
        via_forwarded_header=bool(network_context.via_forwarded_header),
        entrypoint="session",
        status_code=status.HTTP_403_FORBIDDEN,
        detail="Admin access from this IP is not allowed",
    )
    return current_user


async def get_current_active_user(
    current_user: User = Depends(get_current_user)
) -> User:
    """
    Dependency to get the current active user.

    Raises:
        HTTPException 400 if user is inactive

    Returns:
        Active User object
    """
    if not current_user.is_active:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="Inactive user"
        )
    return current_user


async def get_current_admin_user(
    current_user: User = Depends(get_current_active_user),
) -> User:
    """Dependency to ensure caller has admin role."""
    if current_user.role != "admin":
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="Admin privileges required",
        )
    return current_user


def ensure_user_permission(current_user: User, permission: str) -> None:
    """Raise HTTP 403 when user does not have the required permission."""
    if str(getattr(current_user, "role", "") or "").strip().lower() == "admin":
        return
    current_permissions = set(getattr(current_user, "permissions", []) or [])
    if permission in current_permissions:
        return
    if not authorization_service.has_permission(
        current_user.role,
        permission,
        use_custom_permissions=bool(getattr(current_user, "use_custom_permissions", False)),
        custom_permissions=getattr(current_user, "custom_permissions", []),
    ):
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail=f"Insufficient permissions: {permission}",
        )


def require_permission(permission: str) -> Callable[..., User]:
    """Dependency factory for permission checks."""

    async def _dependency(current_user: User = Depends(get_current_active_user)) -> User:
        ensure_user_permission(current_user, permission)
        return current_user

    return _dependency


# Optional: Skip authentication for development
async def get_current_user_optional(
    request: Request,
    credentials: Optional[HTTPAuthorizationCredentials] = Depends(security_optional),
    access_token_cookie: Optional[str] = Cookie(None, alias=config.app.auth_cookie_name),
) -> Optional[User]:
    """
    Optional authentication - returns None if no token provided.
    Useful for endpoints that work for both authenticated and anonymous users.
    """
    token = _resolve_access_token(credentials, access_token_cookie)
    current_user = await run_in_threadpool(_load_optional_user_from_token, token)
    if current_user is None:
        return None
    network_context = build_request_network_context(request)
    ensure_admin_ip_allowed(
        current_user,
        client_ip=network_context.client_ip,
        via_forwarded_header=bool(network_context.via_forwarded_header),
        entrypoint="session",
        status_code=status.HTTP_403_FORBIDDEN,
        detail="Admin access from this IP is not allowed",
    )
    return current_user


async def get_current_database_id(
    x_database_id: Optional[str] = Header(None, alias="X-Database-ID"),
    selected_database: Optional[str] = Cookie(None),
    current_user: User = Depends(get_current_active_user),
) -> Optional[str]:
    """
    Dependency to get the current user's selected database ID.

    Returns:
        Database ID (e.g., "ITINVENT", "MSK-ITINVENT") or None
    """
    def _normalize_database_id(value: object) -> Optional[str]:
        normalized = str(value or "").strip()
        if not normalized:
            return None
        try:
            from backend.api.v1.database import get_all_db_configs

            available_ids = {
                str(item.get("id") or "").strip()
                for item in list(get_all_db_configs() or [])
                if str(item.get("id") or "").strip()
            }
        except Exception:
            available_ids = set()
        if available_ids and normalized not in available_ids:
            return None
        return normalized

    user_assigned_db = _normalize_database_id(current_user.assigned_database)
    # If user is linked to Telegram and has assigned DB in bot mapping:
    # non-admin users are strictly pinned to that DB.
    assigned_db = user_assigned_db or _normalize_database_id(user_db_selection_service.get_assigned_database(current_user.telegram_id))
    if assigned_db and current_user.role != "admin":
        return assigned_db

    # Allow explicit request-scoped override.
    header_db = _normalize_database_id(x_database_id)
    if header_db:
        return header_db

    user_db = _normalize_database_id(get_user_database(current_user.id, current_user.username))
    if user_db:
        return user_db

    # Fallback to user settings pinned DB.
    settings = settings_service.get_user_settings(current_user.id)
    pinned = _normalize_database_id(settings.get("pinned_database"))
    if pinned:
        return pinned

    # Cookie fallback.
    cookie_db = _normalize_database_id(selected_database)
    if cookie_db:
        return cookie_db

    return None
