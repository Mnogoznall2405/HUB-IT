"""Internal OpenAI-compatible gateway authentication for OpenCode jobs.

This module deliberately contains no public FastAPI router. The ASGI entrypoint
is ``backend.ai_sandbox_gateway_main`` and must only bind to the sandbox control
network. Provider credentials stay in that service; containers receive a
short-lived, job-scoped HUB bearer whose SHA-256 digest is the only persisted
secret material.
"""
from __future__ import annotations

import hashlib
import hmac
import json
import os
import secrets
from dataclasses import dataclass
from datetime import datetime, timedelta, timezone
from typing import Any, Mapping

from fastapi import APIRouter, Header, HTTPException, Request, status
from fastapi.concurrency import run_in_threadpool
from fastapi.responses import StreamingResponse
from sqlalchemy import select, update

from backend.appdb.db import app_session
from shared.llm import iter_openai_sse, normalize_gateway_request, openrouter_client
from shared.llm.openai_gateway import MAX_GATEWAY_INPUT_BYTES, OpenAiGatewayValidationError

from .models import AppAiSandboxGatewayGrant, AppAiSandboxJob, AppAiSandboxSession


GATEWAY_TOKEN_TTL = timedelta(minutes=15)
GATEWAY_MAX_REQUESTS = 128
_ACTIVE_JOB_STATUSES = {"claimed", "running", "waiting_permission"}


def _utc_now() -> datetime:
    return datetime.now(timezone.utc)


def _aware(value: datetime) -> datetime:
    return value if value.tzinfo is not None else value.replace(tzinfo=timezone.utc)


def _token_hash(raw_token: str) -> str:
    return hashlib.sha256(raw_token.encode("utf-8")).hexdigest()


def _opaque_scope(value: object, *, label: str, maximum: int = 128) -> str:
    normalized = str(value or "").strip()
    if (
        not normalized
        or len(normalized) > maximum
        or any(character in normalized for character in "\r\n\x00")
    ):
        raise GatewayAuthorizationError(f"Invalid sandbox {label}")
    return normalized


class GatewayAuthorizationError(PermissionError):
    pass


class GatewayConfigurationError(RuntimeError):
    pass


class GatewayBearerToken:
    __slots__ = ("_value",)

    def __init__(self, value: str | None = None) -> None:
        candidate = secrets.token_urlsafe(48) if value is None else str(value).strip()
        if len(candidate) < 32 or len(candidate) > 512 or any(ch in candidate for ch in "\r\n\x00"):
            raise GatewayAuthorizationError("Invalid sandbox gateway bearer")
        self._value = candidate

    def reveal(self) -> str:
        return self._value

    def digest(self) -> str:
        return _token_hash(self._value)

    def __repr__(self) -> str:
        return "GatewayBearerToken(<redacted>)"


@dataclass(frozen=True)
class GatewayAccessGrant:
    id: str
    job_id: str
    session_id: str
    user_id: int
    token: GatewayBearerToken
    expires_at: datetime

    def __repr__(self) -> str:
        return (
            f"GatewayAccessGrant(id={self.id!r}, job_id={self.job_id!r}, "
            f"session_id={self.session_id!r}, user_id={self.user_id!r}, "
            f"expires_at={self.expires_at!r}, token=<redacted>)"
        )


@dataclass(frozen=True)
class GatewayRequestScope:
    grant_id: str
    job_id: str
    session_id: str
    user_id: int
    request_number: int


@dataclass(frozen=True)
class SandboxGatewaySettings:
    enabled: bool
    forced_model: str
    maximum_output_tokens: int = 4_000

    @classmethod
    def from_env(cls, environ: Mapping[str, str] | None = None) -> "SandboxGatewaySettings":
        values = os.environ if environ is None else environ
        enabled = str(values.get("AI_SANDBOX_ENABLED", "0") or "0").strip().lower() in {
            "1", "true", "yes", "on"
        }
        settings = cls(
            enabled=enabled,
            forced_model=str(values.get("AI_SANDBOX_LLM_MODEL", "") or "").strip(),
            maximum_output_tokens=int(values.get("AI_SANDBOX_LLM_MAX_OUTPUT_TOKENS", "4000") or 4000),
        )
        settings.validate()
        return settings

    def validate(self) -> None:
        if not self.enabled:
            raise GatewayConfigurationError("OpenCode sandbox gateway is disabled")
        if (
            not self.forced_model
            or len(self.forced_model) > 200
            or any(ch in self.forced_model for ch in "\r\n\x00")
        ):
            raise GatewayConfigurationError("AI_SANDBOX_LLM_MODEL is required")
        if not (1 <= int(self.maximum_output_tokens) <= 16_000):
            raise GatewayConfigurationError("AI_SANDBOX_LLM_MAX_OUTPUT_TOKENS is invalid")


class SqlAlchemyGatewayAccessBroker:
    """Register, consume and revoke a short-lived bearer in PostgreSQL."""

    def issue(
        self,
        *,
        job_id: str,
        session_id: str,
        user_id: int,
        now: datetime | None = None,
        max_requests: int = GATEWAY_MAX_REQUESTS,
    ) -> GatewayAccessGrant:
        timestamp = now or _utc_now()
        request_budget = max(1, min(int(max_requests), GATEWAY_MAX_REQUESTS))
        token = GatewayBearerToken()
        grant_id = secrets.token_hex(24)
        with app_session() as db:
            job = db.execute(
                select(AppAiSandboxJob)
                .where(
                    AppAiSandboxJob.id == _opaque_scope(job_id, label="job id"),
                    AppAiSandboxJob.session_id == _opaque_scope(session_id, label="session id"),
                    AppAiSandboxJob.user_id == int(user_id),
                    AppAiSandboxJob.status.in_(tuple(_ACTIVE_JOB_STATUSES)),
                )
                .with_for_update()
            ).scalar_one_or_none()
            session_row = db.get(AppAiSandboxSession, session_id)
            if job is None or session_row is None or int(session_row.user_id) != int(user_id):
                raise GatewayAuthorizationError("Gateway grant scope is not an active sandbox job")
            deadline = _aware(job.deadline_at)
            expires_at = min(deadline, timestamp + GATEWAY_TOKEN_TTL)
            if expires_at <= timestamp:
                raise GatewayAuthorizationError("Sandbox job deadline expired")
            db.execute(
                update(AppAiSandboxGatewayGrant)
                .where(
                    AppAiSandboxGatewayGrant.job_id == job.id,
                    AppAiSandboxGatewayGrant.status == "active",
                )
                .values(status="revoked", revoked_at=timestamp, updated_at=timestamp)
            )
            db.add(
                AppAiSandboxGatewayGrant(
                    id=grant_id,
                    job_id=job.id,
                    session_id=session_id,
                    user_id=int(user_id),
                    token_hash=token.digest(),
                    status="active",
                    request_count=0,
                    max_requests=request_budget,
                    expires_at=expires_at,
                    created_at=timestamp,
                    updated_at=timestamp,
                )
            )
        return GatewayAccessGrant(
            id=grant_id,
            job_id=str(job_id),
            session_id=str(session_id),
            user_id=int(user_id),
            token=token,
            expires_at=expires_at,
        )

    def authenticate(
        self,
        *,
        authorization: str | None,
        job_id: str,
        session_id: str,
        user_id: str | int,
        now: datetime | None = None,
    ) -> GatewayRequestScope:
        scheme, separator, candidate = str(authorization or "").partition(" ")
        if separator != " " or scheme.lower() != "bearer" or not candidate.strip():
            raise GatewayAuthorizationError("Sandbox gateway bearer is required")
        token = GatewayBearerToken(candidate.strip())
        safe_job_id = _opaque_scope(job_id, label="job id")
        safe_session_id = _opaque_scope(session_id, label="session id")
        try:
            safe_user_id = int(user_id)
        except (TypeError, ValueError) as exc:
            raise GatewayAuthorizationError("Invalid sandbox user scope") from exc
        timestamp = now or _utc_now()
        with app_session() as db:
            row = db.execute(
                select(AppAiSandboxGatewayGrant)
                .where(AppAiSandboxGatewayGrant.token_hash == token.digest())
                .with_for_update()
            ).scalar_one_or_none()
            if row is None:
                raise GatewayAuthorizationError("Sandbox gateway bearer was not recognized")
            if row.status != "active":
                raise GatewayAuthorizationError("Sandbox gateway bearer is no longer active")
            if _aware(row.expires_at) <= timestamp:
                row.status = "expired"
                row.revoked_at = timestamp
                row.updated_at = timestamp
                raise GatewayAuthorizationError("Sandbox gateway bearer expired")
            if not (
                hmac.compare_digest(row.job_id, safe_job_id)
                and hmac.compare_digest(row.session_id, safe_session_id)
                and int(row.user_id) == safe_user_id
            ):
                raise GatewayAuthorizationError("Sandbox gateway bearer scope mismatch")
            job = db.get(AppAiSandboxJob, row.job_id)
            if job is None or job.status not in _ACTIVE_JOB_STATUSES:
                row.status = "revoked"
                row.revoked_at = timestamp
                row.updated_at = timestamp
                raise GatewayAuthorizationError("Sandbox job is no longer active")
            if int(row.request_count or 0) >= int(row.max_requests or 0):
                row.status = "exhausted"
                row.revoked_at = timestamp
                row.updated_at = timestamp
                raise GatewayAuthorizationError("Sandbox gateway request budget exhausted")
            row.request_count = int(row.request_count or 0) + 1
            row.last_used_at = timestamp
            row.updated_at = timestamp
            if row.request_count >= row.max_requests:
                # This request is valid. The next replay is rejected even if
                # the worker has not yet reached its finally/revoke path.
                row.status = "exhausted"
            request_number = row.request_count
            grant_id = row.id
        return GatewayRequestScope(
            grant_id=grant_id,
            job_id=safe_job_id,
            session_id=safe_session_id,
            user_id=safe_user_id,
            request_number=request_number,
        )

    def revoke(self, *, grant_id: str, job_id: str, now: datetime | None = None) -> bool:
        timestamp = now or _utc_now()
        with app_session() as db:
            result = db.execute(
                update(AppAiSandboxGatewayGrant)
                .where(
                    AppAiSandboxGatewayGrant.id == _opaque_scope(grant_id, label="grant id"),
                    AppAiSandboxGatewayGrant.job_id == _opaque_scope(job_id, label="job id"),
                    AppAiSandboxGatewayGrant.status.in_(("active", "exhausted")),
                )
                .values(status="revoked", revoked_at=timestamp, updated_at=timestamp)
            )
            return bool(result.rowcount)

    def revoke_job(self, *, job_id: str, now: datetime | None = None) -> int:
        timestamp = now or _utc_now()
        with app_session() as db:
            result = db.execute(
                update(AppAiSandboxGatewayGrant)
                .where(
                    AppAiSandboxGatewayGrant.job_id == _opaque_scope(job_id, label="job id"),
                    AppAiSandboxGatewayGrant.status.in_(("active", "exhausted")),
                )
                .values(status="revoked", revoked_at=timestamp, updated_at=timestamp)
            )
            return int(result.rowcount or 0)


gateway_access_broker = SqlAlchemyGatewayAccessBroker()
router = APIRouter(include_in_schema=False)


def _gateway_headers(
    authorization: str | None,
    job_id: str | None,
    session_id: str | None,
    user_id: str | None,
) -> GatewayRequestScope:
    try:
        return gateway_access_broker.authenticate(
            authorization=authorization,
            job_id=str(job_id or ""),
            session_id=str(session_id or ""),
            user_id=str(user_id or ""),
        )
    except GatewayAuthorizationError as exc:
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Sandbox gateway authorization failed",
            headers={"WWW-Authenticate": "Bearer"},
        ) from exc


@router.post("/v1/chat/completions")
async def sandbox_chat_completions(
    request: Request,
    authorization: str | None = Header(default=None),
    x_hub_sandbox_job_id: str | None = Header(default=None),
    x_hub_sandbox_session_id: str | None = Header(default=None),
    x_hub_sandbox_user_id: str | None = Header(default=None),
):
    try:
        gateway_settings = SandboxGatewaySettings.from_env()
    except GatewayConfigurationError as exc:
        raise HTTPException(status_code=status.HTTP_503_SERVICE_UNAVAILABLE, detail="Sandbox LLM gateway unavailable") from exc
    await run_in_threadpool(
        _gateway_headers,
        authorization,
        x_hub_sandbox_job_id,
        x_hub_sandbox_session_id,
        x_hub_sandbox_user_id,
    )
    content_length = request.headers.get("content-length")
    if content_length:
        try:
            if int(content_length) > MAX_GATEWAY_INPUT_BYTES:
                raise ValueError
        except ValueError as exc:
            raise HTTPException(status_code=status.HTTP_413_REQUEST_ENTITY_TOO_LARGE, detail="Gateway request is too large") from exc
    body = await request.body()
    if len(body) > MAX_GATEWAY_INPUT_BYTES:
        raise HTTPException(status_code=status.HTTP_413_REQUEST_ENTITY_TOO_LARGE, detail="Gateway request is too large")
    try:
        payload = json.loads(body)
        if not isinstance(payload, dict):
            raise ValueError
        normalized = normalize_gateway_request(
            payload,
            forced_model=gateway_settings.forced_model,
            maximum_output_tokens=gateway_settings.maximum_output_tokens,
        )
    except (ValueError, json.JSONDecodeError, OpenAiGatewayValidationError) as exc:
        raise HTTPException(status_code=status.HTTP_422_UNPROCESSABLE_ENTITY, detail="Invalid gateway request") from exc

    def _stream():
        chunks = openrouter_client.stream_chat_completion(
            messages=normalized["messages"],
            model=normalized["model"],
            purpose="chat",
            temperature=normalized["temperature"],
            max_tokens=normalized["max_tokens"],
            tools=normalized.get("tools"),
            tool_choice=normalized.get("tool_choice"),
            timeout=900.0,
        )
        yield from iter_openai_sse(chunks)

    return StreamingResponse(
        _stream(),
        media_type="text/event-stream",
        headers={"Cache-Control": "no-store", "X-Accel-Buffering": "no"},
    )
