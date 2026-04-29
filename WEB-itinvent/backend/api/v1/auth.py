"""
Authentication API endpoints.
"""
from __future__ import annotations

from datetime import datetime, timedelta, timezone
from typing import Any, Optional
import hashlib
import logging
import uuid

from fastapi import APIRouter, Depends, status, HTTPException, Request, Response, Cookie
from fastapi.concurrency import run_in_threadpool
from fastapi.security import HTTPAuthorizationCredentials, HTTPBearer

from backend.api.deps import ensure_admin_ip_allowed, get_current_active_user, get_current_admin_user, get_current_session_id, get_current_user, require_permission
from backend.config import config
from backend.models.auth import (
    User,
    LoginRequest,
    LoginResponse,
    LoginModeResponse,
    ChangePasswordRequest,
    RefreshResponse,
    TwoFactorSetupStartRequest,
    TwoFactorSetupResponse,
    TwoFactorSetupVerifyRequest,
    TwoFactorSetupVerifyResponse,
    TwoFactorLoginVerifyRequest,
    BackupCodesResponse,
    TrustedDeviceInfo,
    TrustedDeviceRegistrationOptionsRequest,
    TrustedDeviceRegistrationVerifyRequest,
    TrustedDeviceAuthOptionsRequest,
    TrustedDeviceAuthVerifyRequest,
    PasskeyLoginVerifyRequest,
    UserCreateRequest,
    TaskDelegateLink,
    TaskDelegateLinksUpdateRequest,
    UserUpdateRequest,
    SessionInfo,
)
from backend.utils.security import decode_access_token, token_ttl_seconds
from backend.services.authorization_service import authorization_service
from backend.services.session_service import session_service
from backend.services.session_auth_context_service import session_auth_context_service
from backend.services.settings_service import settings_service
from backend.services.user_db_selection_service import user_db_selection_service
from backend.services.mail_service import mail_service
from backend.services.user_service import user_service
from backend.services.auth_runtime_store_service import auth_runtime_store_service
from backend.services.auth_security_service import AuthSecurityError, auth_security_service
from backend.services.ad_sync_service import run_ad_sync
from backend.services.session_auth_context_service import normalize_exchange_login
from backend.services.authorization_service import (
    PERM_SETTINGS_SESSIONS_MANAGE,
    PERM_SETTINGS_USERS_MANAGE,
)
from backend.services.trusted_device_service import TrustedDeviceServiceError, trusted_device_service
from backend.database.connection import set_user_database
from backend.utils.request_network import build_request_network_context, resolve_twofa_policy


router = APIRouter()
security_optional = HTTPBearer(auto_error=False)
logger = logging.getLogger(__name__)

_LOGIN_FAILURE_LIMIT = 5
_LOGIN_FAILURE_WINDOW_SECONDS = 600
_LOGIN_BAN_SEQUENCE_SECONDS = [600, 3600, 86400]
_LOGIN_ESCALATION_RESET_SECONDS = 86400
_LOGIN_FAILURE_STATE_NAMESPACE = "auth_login_failures"
_LOGIN_BAN_STATE_NAMESPACE = "auth_login_bans"
_LOGIN_ESCALATION_STATE_NAMESPACE = "auth_login_escalation"


def _request_is_https(request: Request) -> bool:
    forwarded_proto = str(request.headers.get("x-forwarded-proto", "") or "").strip().lower()
    if forwarded_proto:
        return forwarded_proto.split(",")[0].strip() == "https"
    if str(request.headers.get("x-forwarded-ssl", "") or "").strip().lower() == "on":
        return True
    if str(request.headers.get("x-arr-ssl", "") or "").strip():
        return True
    if str(request.headers.get("front-end-https", "") or "").strip().lower() == "on":
        return True
    if str(request.headers.get("x-url-scheme", "") or "").strip().lower() == "https":
        return True
    return str(request.url.scheme or "").lower() == "https"


def _is_passkey_login_available() -> bool:
    rp_id = str(config.security.webauthn_rp_id or "").strip()
    origin = str(config.security.webauthn_origin or "").strip()
    return bool(rp_id and origin)


def _ensure_external_passkey_login(network_zone: str) -> None:
    if str(network_zone or "").strip().lower() == "internal":
        raise HTTPException(status_code=403, detail="Biometric login is disabled for internal network")


def _auth_lockout_now_utc() -> datetime:
    return datetime.now(timezone.utc)


def _normalize_login_username(username: str) -> str:
    normalizer = getattr(user_service, "_normalize_username", None)
    if callable(normalizer):
        normalized = str(normalizer(username) or "").strip().lower()
    else:
        normalized = str(username or "").strip().lower()
    return normalized or "anonymous"


def _login_lockout_key(*, client_ip: str, username: str) -> str:
    normalized_ip = str(client_ip or "").strip() or "unknown"
    normalized_username = _normalize_login_username(username)
    return f"{normalized_ip}:{normalized_username}"


def _request_user_agent_bucket(request: Request) -> str:
    user_agent = str(request.headers.get("user-agent", "") or "").strip().lower()
    if not user_agent:
        return "unknown"
    browser = "other"
    for marker, label in (
        ("yabrowser", "yandex"),
        ("edg/", "edge"),
        ("firefox", "firefox"),
        ("crios", "chrome"),
        ("chrome", "chrome"),
        ("safari", "safari"),
    ):
        if marker in user_agent:
            browser = label
            break
    platform = "desktop"
    if "android" in user_agent:
        platform = "android"
    elif "iphone" in user_agent or "ipad" in user_agent:
        platform = "ios"
    digest = hashlib.sha256(user_agent.encode("utf-8")).hexdigest()[:10]
    return f"{browser}:{platform}:{digest}"


def _passkey_rate_limit_key(*, client_ip: str, request: Request) -> str:
    normalized_ip = str(client_ip or "").strip() or "unknown"
    return f"{normalized_ip}:{_request_user_agent_bucket(request)}"


def _refresh_rate_limit_key(*, token_data: Any, client_ip: str) -> str:
    normalized_ip = str(client_ip or "").strip() or "unknown"
    user_id = str(getattr(token_data, "user_id", "") or "").strip() or "unknown-user"
    session_id = str(getattr(token_data, "session_id", "") or "").strip() or "unknown-session"
    return f"{session_id}:{user_id}:{normalized_ip}"


def _auth_store_get_dict(namespace: str, key: str) -> dict[str, Any]:
    payload = auth_runtime_store_service.get_json(namespace, key)
    return payload if isinstance(payload, dict) else {}


def _auth_store_set_dict(namespace: str, key: str, payload: dict[str, Any], *, ttl_seconds: int) -> None:
    auth_runtime_store_service.set_json(
        namespace,
        key,
        payload,
        ttl_seconds=max(1, int(ttl_seconds or 1)),
    )


def _delete_login_failure_state(lockout_key: str) -> None:
    auth_runtime_store_service.delete(_LOGIN_FAILURE_STATE_NAMESPACE, lockout_key)


def _active_login_ban(lockout_key: str) -> dict[str, Any] | None:
    payload = _auth_store_get_dict(_LOGIN_BAN_STATE_NAMESPACE, lockout_key)
    if not payload:
        return None
    now_ts = int(_auth_lockout_now_utc().timestamp())
    expires_at = int(payload.get("expires_at", 0) or 0)
    if expires_at <= now_ts:
        auth_runtime_store_service.delete(_LOGIN_BAN_STATE_NAMESPACE, lockout_key)
        return None
    return {
        "ban_level": max(0, int(payload.get("ban_level", 0) or 0)),
        "expires_at": expires_at,
        "retry_after": max(1, expires_at - now_ts),
    }


def _login_escalation_state(lockout_key: str, *, now_ts: int) -> dict[str, Any] | None:
    payload = _auth_store_get_dict(_LOGIN_ESCALATION_STATE_NAMESPACE, lockout_key)
    if not payload:
        return None
    last_failed_at = int(payload.get("last_failed_at", 0) or 0)
    if last_failed_at <= 0 or last_failed_at + _LOGIN_ESCALATION_RESET_SECONDS <= now_ts:
        auth_runtime_store_service.delete(_LOGIN_ESCALATION_STATE_NAMESPACE, lockout_key)
        return None
    max_level = max(0, len(_LOGIN_BAN_SEQUENCE_SECONDS) - 1)
    return {
        "ban_level": min(max_level, max(0, int(payload.get("ban_level", 0) or 0))),
        "last_failed_at": last_failed_at,
    }


def _save_login_escalation_state(lockout_key: str, *, ban_level: int, now_ts: int) -> None:
    max_level = max(0, len(_LOGIN_BAN_SEQUENCE_SECONDS) - 1)
    _auth_store_set_dict(
        _LOGIN_ESCALATION_STATE_NAMESPACE,
        lockout_key,
        {
            "ban_level": min(max_level, max(0, int(ban_level))),
            "last_failed_at": int(now_ts),
        },
        ttl_seconds=_LOGIN_ESCALATION_RESET_SECONDS,
    )


def _record_failed_login_attempt(*, lockout_key: str, client_ip: str, username: str) -> dict[str, Any]:
    now_ts = int(_auth_lockout_now_utc().timestamp())
    escalation_state = _login_escalation_state(lockout_key, now_ts=now_ts)
    if escalation_state is not None:
        _save_login_escalation_state(
            lockout_key,
            ban_level=int(escalation_state.get("ban_level", 0) or 0),
            now_ts=now_ts,
        )

    attempts_payload = _auth_store_get_dict(_LOGIN_FAILURE_STATE_NAMESPACE, lockout_key)
    attempts = [
        int(item)
        for item in list(attempts_payload.get("attempts") or [])
        if int(item or 0) > now_ts - _LOGIN_FAILURE_WINDOW_SECONDS
    ]
    attempts.append(now_ts)
    if len(attempts) < _LOGIN_FAILURE_LIMIT:
        _auth_store_set_dict(
            _LOGIN_FAILURE_STATE_NAMESPACE,
            lockout_key,
            {"attempts": attempts},
            ttl_seconds=_LOGIN_FAILURE_WINDOW_SECONDS,
        )
        return {"banned": False, "attempts": len(attempts)}

    next_level = 0
    if escalation_state is not None:
        next_level = min(
            int(escalation_state.get("ban_level", 0) or 0) + 1,
            len(_LOGIN_BAN_SEQUENCE_SECONDS) - 1,
        )
    ban_seconds = int(_LOGIN_BAN_SEQUENCE_SECONDS[next_level])
    expires_at = now_ts + ban_seconds
    _auth_store_set_dict(
        _LOGIN_BAN_STATE_NAMESPACE,
        lockout_key,
        {"ban_level": next_level, "expires_at": expires_at},
        ttl_seconds=ban_seconds,
    )
    _save_login_escalation_state(lockout_key, ban_level=next_level, now_ts=now_ts)
    _delete_login_failure_state(lockout_key)
    logger.warning(
        "Auth login lockout activated username=%s client_ip=%s ban_level=%s expires_at=%s",
        _normalize_login_username(username),
        str(client_ip or "").strip() or "unknown",
        next_level,
        datetime.fromtimestamp(expires_at, tz=timezone.utc).isoformat(),
    )
    return {
        "banned": True,
        "ban_level": next_level,
        "expires_at": expires_at,
        "retry_after": ban_seconds,
    }


def _raise_login_lockout(*, retry_after: int) -> None:
    raise HTTPException(
        status_code=429,
        detail="Too many failed login attempts, try again later",
        headers={"Retry-After": str(max(1, int(retry_after or 1)))},
    )


def _validate_assigned_database_or_raise(database_id: Optional[str]) -> Optional[str]:
    normalized = str(database_id or "").strip()
    if not normalized:
        return None
    from backend.api.v1.database import get_all_db_configs
    allowed = {str(item.get("id")) for item in get_all_db_configs()}
    if normalized not in allowed:
        raise HTTPException(status_code=400, detail="Invalid assigned_database")
    return normalized


def _apply_default_database(user: dict) -> None:
    """
    Resolve and apply default DB for user after login.

    Priority:
    1) Bot assignment by Telegram ID (user_db_selection.json)
    2) Pinned database in web settings
    """
    user_id = int(user["id"])
    username = str(user["username"])

    assigned_db = (str(user.get("assigned_database") or "").strip() or None)
    if not assigned_db:
        assigned_db = user_db_selection_service.get_assigned_database(user.get("telegram_id"))
    if assigned_db:
        set_user_database(user_id, assigned_db, username)
        return

    settings = settings_service.get_user_settings(user_id)
    pinned = (settings.get("pinned_database") or "").strip()
    if pinned:
        set_user_database(user_id, pinned, username)


def _sync_ad_primary_mailbox_after_password_login(user: dict, *, request_username: str, password: str) -> None:
    if str((user or {}).get("auth_source") or "").strip().lower() != "ldap":
        return
    if not str(password or "").strip():
        return
    try:
        mail_service.ensure_primary_ad_mailbox_credentials(
            user=user,
            exchange_login=normalize_exchange_login(request_username),
            mailbox_password=password,
        )
    except Exception:
        logger.warning(
            "Failed to sync AD primary mailbox credentials after login: user_id=%s",
            int((user or {}).get("id") or 0),
            exc_info=True,
        )


def _auth_cookie_samesite() -> str:
    return str(config.app.auth_cookie_samesite or "strict")


def _set_auth_cookies(response: Response, *, access_token: str, refresh_token: str, access_ttl_seconds: int, refresh_ttl_seconds: int) -> None:
    response.set_cookie(
        key=config.app.auth_cookie_name,
        value=access_token,
        max_age=max(1, int(access_ttl_seconds or 1)),
        httponly=True,
        secure=bool(config.app.auth_cookie_secure),
        samesite=_auth_cookie_samesite(),
        domain=config.app.auth_cookie_domain,
        path="/",
    )
    response.set_cookie(
        key=config.app.auth_refresh_cookie_name,
        value=refresh_token,
        max_age=max(1, int(refresh_ttl_seconds or 1)),
        httponly=True,
        secure=bool(config.app.auth_cookie_secure),
        samesite=_auth_cookie_samesite(),
        domain=config.app.auth_cookie_domain,
        path="/api/v1/auth",
    )


def _clear_auth_cookies(response: Response) -> None:
    response.delete_cookie(
        key=config.app.auth_cookie_name,
        domain=config.app.auth_cookie_domain,
        path="/",
    )
    response.delete_cookie(
        key=config.app.auth_refresh_cookie_name,
        domain=config.app.auth_cookie_domain,
        path="/api/v1/auth",
    )


def _revoke_token_if_present(token: str | None) -> None:
    token_data = decode_access_token(token or "")
    jti = str(getattr(token_data, "jti", "") or "").strip() if token_data else ""
    if jti:
        auth_runtime_store_service.revoke_jti(jti, ttl_seconds=token_ttl_seconds(token_data))


def _build_current_user_payload(current_user: User, request: Request) -> User:
    raw_user = user_service.get_by_id(int(current_user.id)) or user_service.get_by_username(current_user.username)
    if not raw_user:
        return current_user
    network_context = build_request_network_context(request)
    effective_policy = resolve_twofa_policy()
    public_user = auth_security_service._build_public_user(
        raw_user,
        network_zone=network_context.network_zone,
        twofa_policy=effective_policy,
    )
    return User(**public_user)


def _request_is_internal(request: Optional[Request]) -> bool:
    if request is None:
        return False
    try:
        return str(build_request_network_context(request).network_zone or "").strip().lower() == "internal"
    except Exception:
        return False


def _enforce_rate_limit(
    *,
    namespace: str,
    key: str,
    limit: int,
    window_seconds: int,
    request: Optional[Request] = None,
) -> None:
    if _request_is_internal(request):
        return
    normalized_key = str(key or "").strip().lower()
    if not normalized_key:
        normalized_key = "anonymous"
    network_zone = "unknown"
    if request is not None:
        try:
            network_zone = str(build_request_network_context(request).network_zone or "unknown").strip().lower()
        except Exception:
            network_zone = "unknown"
    storage_key = f"{namespace}:{network_zone}:{normalized_key}"
    counter = auth_runtime_store_service.increment_counter(
        "rate_limit",
        storage_key,
        window_seconds=max(1, int(window_seconds)),
    )
    if int(counter.get("count", 0) or 0) > int(limit):
        raise HTTPException(status_code=429, detail="Too many requests, try again later")


@router.post("/login", response_model=LoginResponse)
async def login(payload: LoginRequest, request: Request, response: Response):
    """
    Login endpoint - authenticate user and return JWT token.
    """
    network_context = build_request_network_context(request)
    ip_address = network_context.client_ip
    lockout_key = _login_lockout_key(client_ip=ip_address, username=payload.username)
    remote_host = str(request.client.host).strip() if request.client and request.client.host else ""
    forwarded_for = str(request.headers.get("x-forwarded-for") or "").strip()
    forwarded_proto = str(request.headers.get("x-forwarded-proto") or "").strip()
    active_ban = await run_in_threadpool(_active_login_ban, lockout_key)
    if active_ban is not None:
        _raise_login_lockout(retry_after=int(active_ban.get("retry_after", 1) or 1))
    await run_in_threadpool(
        _enforce_rate_limit,
        namespace="auth_login",
        key=f"{ip_address}:{_normalize_login_username(payload.username)}",
        limit=5,
        window_seconds=60,
        request=request,
    )
    user = await run_in_threadpool(user_service.authenticate, payload.username, payload.password)
    if not user:
        failed_attempt = await run_in_threadpool(
            _record_failed_login_attempt,
            lockout_key=lockout_key,
            client_ip=ip_address,
            username=payload.username,
        )
        if bool(failed_attempt.get("banned")):
            _raise_login_lockout(retry_after=int(failed_attempt.get("retry_after", 1) or 1))
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Incorrect username or password",
            headers={"WWW-Authenticate": "Bearer"},
        )

    await run_in_threadpool(_delete_login_failure_state, lockout_key)

    if not user.get("is_active", True):
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="User is inactive",
        )
    ensure_admin_ip_allowed(
        user,
        client_ip=ip_address,
        via_forwarded_header=bool(getattr(network_context, "via_forwarded_header", False)),
        entrypoint="login",
        status_code=status.HTTP_401_UNAUTHORIZED,
        detail="Incorrect username or password",
    )
    raw_user = await run_in_threadpool(user_service.get_by_id, int(user.get("id") or 0)) or dict(user)
    try:
        login_result = await run_in_threadpool(
            auth_security_service.start_login,
            user=raw_user,
            password=payload.password,
            request_username=payload.username,
            ip_address=ip_address,
            user_agent=request.headers.get("user-agent", ""),
            network_zone=network_context.network_zone,
        )
        if login_result["status"] == "authenticated":
            login_result = await run_in_threadpool(
                auth_security_service.complete_password_only_login,
                user=raw_user,
                password=payload.password,
                request_username=payload.username,
                ip_address=ip_address,
                user_agent=request.headers.get("user-agent", ""),
                network_zone=network_context.network_zone,
            )
        if login_result["status"] == "authenticated":
            _set_auth_cookies(
                response,
                access_token=str(login_result.get("access_token") or ""),
                refresh_token=str(login_result.get("refresh_token") or ""),
                access_ttl_seconds=int(login_result.get("access_ttl_seconds") or 0),
                refresh_ttl_seconds=int(login_result.get("refresh_ttl_seconds") or 0),
            )
            await run_in_threadpool(_apply_default_database, login_result["user"])
            await run_in_threadpool(
                _sync_ad_primary_mailbox_after_password_login,
                login_result["user"],
                request_username=payload.username,
                password=payload.password,
            )
        logger.info(
            "Auth login decision username=%s client_ip=%s remote_host=%s xff=%s zone=%s trusted_proxy=%s via_xff=%s https=%s xfp=%s policy=%s status=%s challenge=%s cookies_set=%s",
            str(payload.username or "").strip(),
            ip_address,
            remote_host,
            forwarded_for,
            network_context.network_zone,
            bool(getattr(network_context, "trusted_proxy", False)),
            bool(getattr(network_context, "via_forwarded_header", False)),
            _request_is_https(request),
            forwarded_proto,
            resolve_twofa_policy(),
            str(login_result.get("status") or ""),
            str(login_result.get("login_challenge_id") or ""),
            bool(login_result.get("status") == "authenticated"),
        )
        return LoginResponse(
            status=login_result["status"],
            access_token=None,
            token_type="bearer",
            user=User(**login_result["user"]) if login_result.get("user") else None,
            session_id=login_result.get("session_id"),
            login_challenge_id=login_result.get("login_challenge_id"),
            available_second_factors=list(login_result.get("available_second_factors") or []),
            trusted_devices_available=bool(login_result.get("trusted_devices_available")),
        )
    except AuthSecurityError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc


@router.get("/login-mode", response_model=LoginModeResponse)
async def get_login_mode(request: Request):
    network_context = build_request_network_context(request)
    biometric_enabled = (
        str(network_context.network_zone or "").strip().lower() == "external"
        and _is_passkey_login_available()
    )
    return LoginModeResponse(
        network_zone=str(network_context.network_zone or "external").strip().lower() or "external",
        biometric_login_enabled=bool(biometric_enabled),
    )


@router.post("/passkey-login/options")
async def passkey_login_options(request: Request):
    network_context = build_request_network_context(request)
    _ensure_external_passkey_login(network_context.network_zone)
    await run_in_threadpool(
        _enforce_rate_limit,
        namespace="auth_passkey_login_options",
        key=_passkey_rate_limit_key(client_ip=network_context.client_ip, request=request),
        limit=30,
        window_seconds=60,
        request=request,
    )
    rp_id = str(config.security.webauthn_rp_id or "").strip()
    if not rp_id:
        raise HTTPException(status_code=503, detail="WebAuthn is not configured")
    options = await run_in_threadpool(trusted_device_service.build_discoverable_authentication_options, rp_id=rp_id)
    challenge_id = uuid.uuid4().hex
    await run_in_threadpool(
        auth_runtime_store_service.save_webauthn_challenge,
        challenge_id,
        {
            "purpose": "passkey_login",
            "expected_origin": str(config.security.webauthn_origin or "").strip(),
            "expected_rp_id": rp_id,
            "challenge": options["challenge"],
        },
        ttl_seconds=max(60, int(config.security.twofa_challenge_ttl_sec or 600)),
    )
    return {"challenge_id": challenge_id, "public_key": options}


@router.post("/passkey-login/verify", response_model=LoginResponse)
async def passkey_login_verify(payload: PasskeyLoginVerifyRequest, request: Request, response: Response):
    network_context = build_request_network_context(request)
    _ensure_external_passkey_login(network_context.network_zone)
    await run_in_threadpool(
        _enforce_rate_limit,
        namespace="auth_passkey_login_verify",
        key=_passkey_rate_limit_key(client_ip=network_context.client_ip, request=request),
        limit=30,
        window_seconds=60,
        request=request,
    )
    challenge = await run_in_threadpool(auth_runtime_store_service.pop_webauthn_challenge, payload.challenge_id)
    if not isinstance(challenge, dict) or challenge.get("purpose") != "passkey_login":
        raise HTTPException(status_code=400, detail="WebAuthn authentication challenge expired")
    device = await run_in_threadpool(
        trusted_device_service.find_device_by_credential,
        str((payload.credential or {}).get("id") or ""),
        discoverable_only=True,
    )
    if not device:
        await run_in_threadpool(trusted_device_service.audit_event, "auth_fail", reason="passkey_device_not_found")
        raise HTTPException(status_code=400, detail="Trusted device not found")
    try:
        verification = await run_in_threadpool(
            trusted_device_service.verify_authentication_response,
            credential=payload.credential,
            expected_challenge=str(challenge.get("challenge") or ""),
            expected_origin=str(challenge.get("expected_origin") or ""),
            expected_rp_id=str(challenge.get("expected_rp_id") or ""),
            device=device,
            require_user_verification=True,
        )
    except TrustedDeviceServiceError as exc:
        await run_in_threadpool(
            trusted_device_service.audit_event,
            "auth_fail",
            user_id=int(device.get("user_id") or 0),
            device_id=str(device.get("id") or ""),
            reason="passkey_verify",
        )
        raise HTTPException(status_code=400, detail=str(exc)) from exc
    user = await run_in_threadpool(user_service.get_by_id, int(device.get("user_id") or 0))
    if not user:
        raise HTTPException(status_code=400, detail="User not found")
    if not user.get("is_active", True):
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="User is inactive")
    try:
        ensure_admin_ip_allowed(
            user,
            client_ip=network_context.client_ip,
            via_forwarded_header=bool(getattr(network_context, "via_forwarded_header", False)),
            entrypoint="login",
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Authentication failed",
        )
    except HTTPException:
        await run_in_threadpool(
            trusted_device_service.audit_event,
            "auth_fail",
            user_id=int(user.get("id") or 0),
            device_id=str(device.get("id") or ""),
            reason="admin_ip",
        )
        raise
    try:
        await run_in_threadpool(trusted_device_service.update_sign_count, str(device.get("id") or ""), int(verification.get("new_sign_count") or 0))
        result = await run_in_threadpool(
            auth_security_service.complete_passkey_login,
            user=user,
            device=device,
            ip_address=network_context.client_ip,
            user_agent=request.headers.get("user-agent", ""),
            network_zone=network_context.network_zone,
            request_username=str(user.get("username") or ""),
        )
    except AuthSecurityError as exc:
        await run_in_threadpool(
            trusted_device_service.audit_event,
            "auth_fail",
            user_id=int(user.get("id") or 0),
            device_id=str(device.get("id") or ""),
            reason="passkey_complete",
        )
        raise HTTPException(status_code=400, detail=str(exc)) from exc
    _set_auth_cookies(
        response,
        access_token=str(result.get("access_token") or ""),
        refresh_token=str(result.get("refresh_token") or ""),
        access_ttl_seconds=int(result.get("access_ttl_seconds") or 0),
        refresh_ttl_seconds=int(result.get("refresh_ttl_seconds") or 0),
    )
    await run_in_threadpool(_apply_default_database, result["user"])
    return LoginResponse(
        status="authenticated",
        access_token=None,
        token_type="bearer",
        user=User(**result["user"]),
        session_id=result.get("session_id"),
    )


@router.post("/logout")
async def logout(
    response: Response,
    current_user: User = Depends(get_current_user),
    credentials: Optional[HTTPAuthorizationCredentials] = Depends(security_optional),
    access_token_cookie: Optional[str] = Cookie(None, alias=config.app.auth_cookie_name),
    refresh_token_cookie: Optional[str] = Cookie(None, alias=config.app.auth_refresh_cookie_name),
):
    """
    Logout endpoint.
    """
    token = None
    if credentials and credentials.credentials:
        token = credentials.credentials
    elif access_token_cookie:
        token = str(access_token_cookie).strip() or None

    token_data = decode_access_token(token or "")
    if token_data and token_data.session_id:
        session_service.close_session(token_data.session_id)
        session_auth_context_service.delete_session_context(token_data.session_id)
    _revoke_token_if_present(token)
    _revoke_token_if_present(refresh_token_cookie)
    if refresh_token_cookie:
        refresh_data = decode_access_token(refresh_token_cookie, expected_token_type="refresh")
        if refresh_data and refresh_data.jti:
            auth_runtime_store_service.consume_refresh_token(refresh_data.jti)
    _clear_auth_cookies(response)
    return {"message": "Successfully logged out", "username": current_user.username}


@router.get("/me", response_model=User)
async def get_current_user_info(
    request: Request,
    current_user: User = Depends(get_current_active_user),
):
    """
    Get current authenticated user information.
    """
    return _build_current_user_payload(current_user, request)


@router.post("/change-password")
async def change_password(
    request: ChangePasswordRequest,
    current_user: User = Depends(get_current_active_user),
):
    """
    Change current user's password.
    """
    changed = user_service.change_password(current_user.id, request.old_password, request.new_password)
    if not changed:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="Incorrect old password",
        )
    closed_sessions = session_service.close_user_sessions(int(current_user.id))
    revoked_devices = trusted_device_service.revoke_all_user_devices(int(current_user.id))
    for item in session_service.list_sessions(active_only=False):
        if int(item.get("user_id", 0) or 0) == int(current_user.id):
            session_auth_context_service.delete_session_context(item.get("session_id"))
    return {
        "message": "Password changed successfully",
        "closed_sessions": closed_sessions,
        "revoked_devices": revoked_devices,
    }


@router.post("/enable-2fa", response_model=TwoFactorSetupResponse)
async def enable_twofa(payload: TwoFactorSetupStartRequest, request: Request):
    await run_in_threadpool(
        _enforce_rate_limit,
        namespace="auth_enable_twofa",
        key=str(payload.login_challenge_id or ""),
        limit=5,
        window_seconds=60,
        request=request,
    )
    try:
        result = await run_in_threadpool(auth_security_service.start_totp_enrollment, payload.login_challenge_id)
        return TwoFactorSetupResponse(**result)
    except AuthSecurityError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc


@router.post("/verify-2fa", response_model=TwoFactorSetupVerifyResponse)
async def verify_twofa_setup(payload: TwoFactorSetupVerifyRequest, request: Request, response: Response):
    await run_in_threadpool(
        _enforce_rate_limit,
        namespace="auth_verify_twofa_setup",
        key=str(payload.login_challenge_id or ""),
        limit=3,
        window_seconds=60,
        request=request,
    )
    try:
        result = await run_in_threadpool(
            auth_security_service.finalize_totp_enrollment,
            payload.login_challenge_id,
            totp_code=payload.totp_code,
        )
    except AuthSecurityError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc
    _set_auth_cookies(
        response,
        access_token=str(result.get("access_token") or ""),
        refresh_token=str(result.get("refresh_token") or ""),
        access_ttl_seconds=int(result.get("access_ttl_seconds") or 0),
        refresh_ttl_seconds=int(result.get("refresh_ttl_seconds") or 0),
    )
    await run_in_threadpool(_apply_default_database, result["user"])
    return TwoFactorSetupVerifyResponse(
        status="authenticated",
        access_token=None,
        token_type="bearer",
        user=User(**result["user"]),
        session_id=result.get("session_id"),
        backup_codes=list(result.get("backup_codes") or []),
    )


@router.post("/verify-2fa-login", response_model=LoginResponse)
async def verify_twofa_login(payload: TwoFactorLoginVerifyRequest, request: Request, response: Response):
    await run_in_threadpool(
        _enforce_rate_limit,
        namespace="auth_verify_twofa_login",
        key=str(payload.login_challenge_id or ""),
        limit=3,
        window_seconds=60,
        request=request,
    )
    try:
        result = await run_in_threadpool(
            auth_security_service.verify_login_second_factor,
            payload.login_challenge_id,
            totp_code=payload.totp_code,
            backup_code=payload.backup_code,
        )
    except AuthSecurityError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc
    _set_auth_cookies(
        response,
        access_token=str(result.get("access_token") or ""),
        refresh_token=str(result.get("refresh_token") or ""),
        access_ttl_seconds=int(result.get("access_ttl_seconds") or 0),
        refresh_ttl_seconds=int(result.get("refresh_ttl_seconds") or 0),
    )
    await run_in_threadpool(_apply_default_database, result["user"])
    return LoginResponse(
        status="authenticated",
        access_token=None,
        token_type="bearer",
        user=User(**result["user"]),
        session_id=result.get("session_id"),
    )


@router.post("/refresh", response_model=RefreshResponse)
async def refresh_auth_tokens(
    request: Request,
    response: Response,
    refresh_token_cookie: Optional[str] = Cookie(None, alias=config.app.auth_refresh_cookie_name),
):
    network_context = build_request_network_context(request)
    token_data = decode_access_token(refresh_token_cookie or "", expected_token_type="refresh")
    if token_data is None or not token_data.jti or not token_data.session_id or not token_data.user_id:
        await run_in_threadpool(
            _enforce_rate_limit,
            namespace="auth_refresh_invalid",
            key=str(network_context.client_ip or ""),
            limit=10,
            window_seconds=60,
            request=request,
        )
        raise HTTPException(status_code=401, detail="Refresh token is invalid")
    await run_in_threadpool(
        _enforce_rate_limit,
        namespace="auth_refresh",
        key=_refresh_rate_limit_key(token_data=token_data, client_ip=network_context.client_ip),
        limit=10,
        window_seconds=60,
        request=request,
    )
    if await run_in_threadpool(auth_runtime_store_service.is_jti_revoked, token_data.jti):
        raise HTTPException(status_code=401, detail="Refresh token has been revoked")
    refresh_state = await run_in_threadpool(auth_runtime_store_service.consume_refresh_token, token_data.jti)
    if not refresh_state:
        raise HTTPException(status_code=401, detail="Refresh token is expired or already used")
    await run_in_threadpool(auth_runtime_store_service.revoke_jti, token_data.jti, ttl_seconds=token_ttl_seconds(token_data))
    user = await run_in_threadpool(user_service.get_by_id, int(token_data.user_id))
    if not user:
        raise HTTPException(status_code=401, detail="User not found")
    try:
        refreshed = await run_in_threadpool(
            auth_security_service.refresh_session_tokens,
            user=user,
            session_id=str(token_data.session_id),
            device_id=str(refresh_state.get("device_id") or token_data.device_id or f"session:{token_data.session_id}"),
            network_zone=network_context.network_zone,
            twofa_policy=resolve_twofa_policy(),
        )
    except AuthSecurityError as exc:
        raise HTTPException(status_code=401, detail=str(exc)) from exc
    _set_auth_cookies(
        response,
        access_token=str(refreshed.get("access_token") or ""),
        refresh_token=str(refreshed.get("refresh_token") or ""),
        access_ttl_seconds=int(refreshed.get("access_ttl_seconds") or 0),
        refresh_ttl_seconds=int(refreshed.get("refresh_ttl_seconds") or 0),
    )
    return RefreshResponse(
        access_token=None,
        token_type="bearer",
        user=User(**refreshed["user"]),
        session_id=refreshed.get("session_id"),
    )


@router.post("/backup-codes/regenerate", response_model=BackupCodesResponse)
async def regenerate_backup_codes(
    current_user: User = Depends(get_current_active_user),
):
    try:
        return BackupCodesResponse(
            backup_codes=auth_security_service.regenerate_backup_codes(int(current_user.id))
        )
    except AuthSecurityError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc


@router.post("/trusted-devices/register/options")
async def trusted_device_register_options(
    payload: TrustedDeviceRegistrationOptionsRequest,
    request: Request,
    current_user: User = Depends(get_current_active_user),
    session_id: Optional[str] = Depends(get_current_session_id),
):
    network_context = build_request_network_context(request)
    _enforce_rate_limit(
        namespace="auth_trusted_device_register_options",
        key=f"{int(current_user.id)}:{str(session_id or network_context.client_ip or '')}",
        limit=5,
        window_seconds=60,
        request=request,
    )
    rp_id = str(config.security.webauthn_rp_id or "").strip()
    if not rp_id:
        raise HTTPException(status_code=503, detail="WebAuthn is not configured")
    options = trusted_device_service.build_registration_options(
        user_id=int(current_user.id),
        username=current_user.username,
        display_name=current_user.full_name or current_user.username,
        rp_id=rp_id,
        rp_name=str(config.security.webauthn_rp_name or "HUB-IT").strip() or "HUB-IT",
        exclude_devices=trusted_device_service.list_devices(int(current_user.id), active_only=True),
        platform_only=bool(payload.platform_only),
    )
    challenge_id = uuid.uuid4().hex
    auth_runtime_store_service.save_webauthn_challenge(
        challenge_id,
        {
            "purpose": "register",
            "user_id": int(current_user.id),
            "session_id": str(session_id or "").strip() or None,
            "expected_origin": str(config.security.webauthn_origin or "").strip(),
            "expected_rp_id": rp_id,
            "challenge": options["challenge"],
            "label": str(payload.label or "").strip() or None,
            "platform_only": bool(payload.platform_only),
        },
        ttl_seconds=max(60, int(config.security.twofa_challenge_ttl_sec or 600)),
    )
    return {"challenge_id": challenge_id, "public_key": options}


@router.post("/trusted-devices/register/verify", response_model=TrustedDeviceInfo)
async def trusted_device_register_verify(
    payload: TrustedDeviceRegistrationVerifyRequest,
    request: Request,
    current_user: User = Depends(get_current_active_user),
):
    _enforce_rate_limit(
        namespace="auth_trusted_device_register_verify",
        key=f"{int(current_user.id)}:{str(payload.challenge_id or '')}",
        limit=5,
        window_seconds=60,
        request=request,
    )
    challenge = auth_runtime_store_service.pop_webauthn_challenge(payload.challenge_id)
    if not isinstance(challenge, dict) or challenge.get("purpose") != "register":
        raise HTTPException(status_code=400, detail="WebAuthn registration challenge expired")
    if int(challenge.get("user_id") or 0) != int(current_user.id):
        raise HTTPException(status_code=403, detail="Challenge does not belong to current user")
    try:
        verification = trusted_device_service.verify_registration_response(
            credential=payload.credential,
            expected_challenge=str(challenge.get("challenge") or ""),
            expected_origin=str(challenge.get("expected_origin") or ""),
            expected_rp_id=str(challenge.get("expected_rp_id") or ""),
            require_user_verification=True,
        )
        created = trusted_device_service.register_device(
            user_id=int(current_user.id),
            label=str(payload.label or challenge.get("label") or "").strip() or "Доверенное устройство",
            credential_id=str(verification.get("credential_id") or ""),
            public_key_b64=str(verification.get("public_key_b64") or ""),
            sign_count=int(verification.get("sign_count") or 0),
            transports=list((payload.credential or {}).get("response", {}).get("transports") or []),
            aaguid=verification.get("aaguid"),
            rp_id=str(challenge.get("expected_rp_id") or ""),
            origin=str(challenge.get("expected_origin") or ""),
            is_discoverable=True,
        )
    except TrustedDeviceServiceError as exc:
        trusted_device_service.audit_event(
            "auth_fail",
            user_id=int(current_user.id),
            reason="registration_verify",
        )
        raise HTTPException(status_code=400, detail=str(exc)) from exc
    return TrustedDeviceInfo(**created, is_current_device=False)


@router.post("/trusted-devices/auth/options")
async def trusted_device_auth_options(payload: TrustedDeviceAuthOptionsRequest, request: Request):
    _enforce_rate_limit(
        namespace="auth_trusted_device_options",
        key=str(payload.login_challenge_id or ""),
        limit=5,
        window_seconds=60,
        request=request,
    )
    challenge = auth_security_service.get_login_challenge(payload.login_challenge_id)
    devices = trusted_device_service.list_devices(int(challenge.get("user_id") or 0), active_only=True)
    if not devices:
        raise HTTPException(status_code=400, detail="У пользователя нет доверенных устройств")
    rp_id = str(config.security.webauthn_rp_id or "").strip()
    if not rp_id:
        raise HTTPException(status_code=503, detail="WebAuthn is not configured")
    options = trusted_device_service.build_authentication_options(
        rp_id=rp_id,
        devices=devices,
    )
    challenge_id = uuid.uuid4().hex
    auth_runtime_store_service.save_webauthn_challenge(
        challenge_id,
        {
            "purpose": "authenticate",
            "user_id": int(challenge.get("user_id") or 0),
            "login_challenge_id": str(payload.login_challenge_id),
            "expected_origin": str(config.security.webauthn_origin or "").strip(),
            "expected_rp_id": rp_id,
            "challenge": options["challenge"],
        },
        ttl_seconds=max(60, int(config.security.twofa_challenge_ttl_sec or 600)),
    )
    return {"challenge_id": challenge_id, "public_key": options}


@router.post("/trusted-devices/auth/verify", response_model=LoginResponse)
async def trusted_device_auth_verify(payload: TrustedDeviceAuthVerifyRequest, request: Request, response: Response):
    _enforce_rate_limit(
        namespace="auth_trusted_device_verify",
        key=str(payload.login_challenge_id or ""),
        limit=5,
        window_seconds=60,
        request=request,
    )
    challenge = auth_runtime_store_service.pop_webauthn_challenge(payload.challenge_id)
    if not isinstance(challenge, dict) or challenge.get("purpose") != "authenticate":
        raise HTTPException(status_code=400, detail="WebAuthn authentication challenge expired")
    if str(challenge.get("login_challenge_id") or "") != str(payload.login_challenge_id):
        raise HTTPException(status_code=400, detail="Challenge does not match login flow")
    device = trusted_device_service.find_device_by_credential(
        str((payload.credential or {}).get("id") or ""),
        user_id=int(challenge.get("user_id") or 0),
    )
    if not device:
        auth_security_service.delete_login_challenge(payload.login_challenge_id)
        trusted_device_service.audit_event(
            "auth_fail",
            user_id=int(challenge.get("user_id") or 0),
            reason="trusted_device_not_found",
        )
        raise HTTPException(status_code=400, detail="Trusted device not found")
    try:
        verification = trusted_device_service.verify_authentication_response(
            credential=payload.credential,
            expected_challenge=str(challenge.get("challenge") or ""),
            expected_origin=str(challenge.get("expected_origin") or ""),
            expected_rp_id=str(challenge.get("expected_rp_id") or ""),
            device=device,
        )
        trusted_device_service.update_sign_count(str(device.get("id") or ""), int(verification.get("new_sign_count") or 0))
        result = auth_security_service.finalize_trusted_device_login(payload.login_challenge_id, device=device)
    except (TrustedDeviceServiceError, AuthSecurityError) as exc:
        auth_security_service.delete_login_challenge(payload.login_challenge_id)
        trusted_device_service.audit_event(
            "auth_fail",
            user_id=int(challenge.get("user_id") or 0),
            device_id=str(device.get("id") or ""),
            reason="trusted_device_verify",
        )
        raise HTTPException(status_code=400, detail=str(exc)) from exc
    _set_auth_cookies(
        response,
        access_token=str(result.get("access_token") or ""),
        refresh_token=str(result.get("refresh_token") or ""),
        access_ttl_seconds=int(result.get("access_ttl_seconds") or 0),
        refresh_ttl_seconds=int(result.get("refresh_ttl_seconds") or 0),
    )
    _apply_default_database(result["user"])
    return LoginResponse(
        status="authenticated",
        access_token=None,
        token_type="bearer",
        user=User(**result["user"]),
        session_id=result.get("session_id"),
    )


@router.get("/trusted-devices", response_model=list[TrustedDeviceInfo])
async def list_trusted_devices(
    current_user: User = Depends(get_current_active_user),
    credentials: Optional[HTTPAuthorizationCredentials] = Depends(security_optional),
    access_token_cookie: Optional[str] = Cookie(None, alias=config.app.auth_cookie_name),
):
    token = None
    if credentials and credentials.credentials:
        token = credentials.credentials
    elif access_token_cookie:
        token = str(access_token_cookie).strip() or None
    token_data = decode_access_token(token or "", expected_token_type="access")
    current_device_id = str(token_data.device_id or "") if token_data else ""
    devices = trusted_device_service.list_devices(int(current_user.id), active_only=False)
    return [
        TrustedDeviceInfo(
            **item,
            is_current_device=current_device_id == f"trusted:{str(item.get('id') or '')}",
        )
        for item in devices
    ]


@router.delete("/trusted-devices/{device_id}")
async def revoke_trusted_device(
    device_id: str,
    current_user: User = Depends(get_current_active_user),
):
    device = trusted_device_service.revoke_device(user_id=int(current_user.id), device_id=device_id)
    if not device:
        raise HTTPException(status_code=404, detail="Trusted device not found")
    return {"success": True, "device_id": device_id}


@router.post("/users/{user_id}/reset-2fa")
async def admin_reset_twofa(
    user_id: int,
    _: User = Depends(get_current_admin_user),
):
    try:
        return auth_security_service.reset_user_twofa(user_id=int(user_id))
    except AuthSecurityError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc


@router.post("/reset-2fa-self")
async def reset_own_twofa(
    response: Response,
    current_user: User = Depends(get_current_active_user),
    credentials: Optional[HTTPAuthorizationCredentials] = Depends(security_optional),
    access_token_cookie: Optional[str] = Cookie(None, alias=config.app.auth_cookie_name),
    refresh_token_cookie: Optional[str] = Cookie(None, alias=config.app.auth_refresh_cookie_name),
):
    try:
        result = auth_security_service.reset_user_twofa(user_id=int(current_user.id))
    except AuthSecurityError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc

    token = None
    if credentials and credentials.credentials:
        token = credentials.credentials
    elif access_token_cookie:
        token = str(access_token_cookie).strip() or None
    _revoke_token_if_present(token)
    _revoke_token_if_present(refresh_token_cookie)
    if refresh_token_cookie:
        refresh_data = decode_access_token(refresh_token_cookie, expected_token_type="refresh")
        if refresh_data and refresh_data.jti:
            auth_runtime_store_service.consume_refresh_token(refresh_data.jti)
    _clear_auth_cookies(response)
    return result


@router.get("/sessions", response_model=list[SessionInfo])
async def get_sessions(
    _: User = Depends(require_permission(PERM_SETTINGS_SESSIONS_MANAGE)),
):
    """List web sessions available for admin session management."""
    return [SessionInfo(**item) for item in session_service.list_sessions(active_only=True)]


@router.delete("/sessions/{session_id}")
async def terminate_session(
    session_id: str,
    _: User = Depends(require_permission(PERM_SETTINGS_SESSIONS_MANAGE)),
):
    """Terminate a session by id."""
    closed = session_service.close_session_by_id(session_id)
    if not closed:
        raise HTTPException(status_code=404, detail="Session not found")
    session_auth_context_service.delete_session_context(session_id)
    return {"success": True, "session_id": session_id}


@router.post("/sessions/cleanup")
async def cleanup_sessions(
    _: User = Depends(require_permission(PERM_SETTINGS_SESSIONS_MANAGE)),
):
    """Deactivate expired sessions and purge stale history."""
    result = session_service.cleanup_sessions(force=True)
    active_sessions = session_service.list_sessions(active_only=True)
    session_auth_context_service.prune_active_sessions([
        str(item.get("session_id") or "").strip()
        for item in active_sessions
    ])
    return result


@router.post("/sessions/purge-inactive")
async def purge_inactive_sessions(
    _: User = Depends(require_permission(PERM_SETTINGS_SESSIONS_MANAGE)),
):
    """Delete every inactive or expired session record."""
    result = session_service.purge_inactive_sessions()
    active_sessions = session_service.list_sessions(active_only=True)
    session_auth_context_service.prune_active_sessions([
        str(item.get("session_id") or "").strip()
        for item in active_sessions
    ])
    return result


@router.get("/users", response_model=list[User])
async def list_users(
    _: User = Depends(require_permission(PERM_SETTINGS_USERS_MANAGE)),
):
    """List all web users."""
    return [User(**item) for item in user_service.list_users()]


@router.post("/users", response_model=User, status_code=status.HTTP_201_CREATED)
async def create_user(
    payload: UserCreateRequest,
    _: User = Depends(require_permission(PERM_SETTINGS_USERS_MANAGE)),
):
    """Create a web user."""
    try:
        assigned_database = _validate_assigned_database_or_raise(payload.assigned_database)
        created = user_service.create_user(
            username=payload.username,
            password=payload.password,
            role=payload.role,
            email=payload.email,
            full_name=payload.full_name,
            department=payload.department,
            job_title=payload.job_title,
            telegram_id=payload.telegram_id,
            assigned_database=assigned_database,
            is_active=payload.is_active,
            auth_source=payload.auth_source,
            use_custom_permissions=payload.use_custom_permissions,
            custom_permissions=payload.custom_permissions,
            mailbox_email=payload.mailbox_email,
            mailbox_login=payload.mailbox_login,
            mailbox_password=payload.mailbox_password,
            mail_signature_html=payload.mail_signature_html,
        )
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc
    return User(**created)


@router.patch("/users/{user_id}", response_model=User)
async def update_user(
    user_id: int,
    payload: UserUpdateRequest,
    current_user: User = Depends(require_permission(PERM_SETTINGS_USERS_MANAGE)),
):
    """Update web user properties."""
    if current_user.id == user_id and payload.is_active is False:
        raise HTTPException(status_code=400, detail="Cannot deactivate current admin user")

    payload_data = payload.model_dump(exclude_unset=True) if hasattr(payload, "model_dump") else payload.dict(exclude_unset=True)
    if "assigned_database" in payload_data:
        payload_data["assigned_database"] = _validate_assigned_database_or_raise(payload_data.get("assigned_database"))
    try:
        updated = user_service.update_user(
            user_id,
            **payload_data,
        )
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc
    if not updated:
        raise HTTPException(status_code=404, detail="User not found")
    return User(**updated)


@router.delete("/users/{user_id}")
async def delete_user(
    user_id: int,
    current_user: User = Depends(require_permission(PERM_SETTINGS_USERS_MANAGE)),
):
    """Delete a user. Cannot delete the default admin (id=1)."""
    if str(user_id) == str(current_user.id):
        raise HTTPException(status_code=400, detail="Cannot delete your own account.")
        
    deleted = user_service.delete_user(user_id)
    if not deleted:
        if user_id == 1:
             raise HTTPException(status_code=403, detail="Cannot delete the default admin account.")
        raise HTTPException(status_code=404, detail="User not found")
        
    return {"message": "User deleted successfully"}


@router.get("/users/{user_id}/task-delegates", response_model=list[TaskDelegateLink])
async def get_user_task_delegates(
    user_id: int,
    _: User = Depends(require_permission(PERM_SETTINGS_USERS_MANAGE)),
):
    if not user_service.get_by_id(user_id):
        raise HTTPException(status_code=404, detail="User not found")
    return [TaskDelegateLink(**item) for item in user_service.list_task_delegates(user_id)]


@router.put("/users/{user_id}/task-delegates", response_model=list[TaskDelegateLink])
async def update_user_task_delegates(
    user_id: int,
    payload: TaskDelegateLinksUpdateRequest,
    _: User = Depends(require_permission(PERM_SETTINGS_USERS_MANAGE)),
):
    try:
        updated = user_service.replace_task_delegates(
            user_id,
            [item.model_dump() if hasattr(item, "model_dump") else item.dict() for item in payload.items],
        )
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc
    return [TaskDelegateLink(**item) for item in updated]


@router.post("/sync-ad")
async def trigger_ad_sync(
    current_user: User = Depends(require_permission(PERM_SETTINGS_USERS_MANAGE)),
):
    """
    Manually trigger Active Directory synchronization.
    Requires users management permission.
    """
    try:
        # Run blocking I/O in thread pool
        result = await asyncio.to_thread(run_ad_sync, True)
        if result.get("status") == "error":
            raise HTTPException(status_code=500, detail=result.get("message", "Sync failed"))
        return result
    except Exception as e:
        logger.error(f"AD sync endpoint error: {e}")
        raise HTTPException(status_code=500, detail=str(e))
