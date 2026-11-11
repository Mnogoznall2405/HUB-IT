"""Internal authenticated content bridge for the dedicated sandbox VM.

These routes are not a browser API and are deliberately excluded from
OpenAPI. IIS must expose them only on the worker control network.
"""
from __future__ import annotations

import os
import shutil
import tempfile
from pathlib import Path

from fastapi import APIRouter, File, Header, HTTPException, UploadFile, status
from fastapi.responses import FileResponse

from backend.ai_sandbox.schemas import (
    SandboxJobManifestView,
    SandboxOutputTransferGrantView,
    SandboxOutputTransferResult,
    SandboxWorkerJobState,
    SandboxWorkerFinalizeRequest,
    SandboxWorkerPermissionRequest,
    SandboxWorkerPermissionState,
    SandboxWorkerResultRequest,
    SandboxWorkerResultResponse,
)
from backend.ai_sandbox.transfer import SandboxTransferCredentials
from backend.api.v1.chat._shim import chat_api


router = APIRouter(include_in_schema=False)


def _service():
    from backend.ai_sandbox.app_service import ai_sandbox_app_service

    return ai_sandbox_app_service


def _require_worker_service(authorization: str | None) -> None:
    try:
        credentials = SandboxTransferCredentials.from_env()
    except Exception as exc:
        raise HTTPException(
            status_code=status.HTTP_503_SERVICE_UNAVAILABLE,
            detail="Sandbox transfer authentication is unavailable",
        ) from exc
    if not credentials.matches_authorization_header(authorization):
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Sandbox worker authentication failed",
            headers={"WWW-Authenticate": "Bearer"},
        )


def _one_time_token(authorization: str | None) -> str:
    value = str(authorization or "")
    scheme, separator, token = value.partition(" ")
    if separator != " " or scheme.lower() != "bearer" or not token.strip():
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="One-time sandbox transfer token is required",
            headers={"WWW-Authenticate": "Bearer"},
        )
    return token.strip()


@router.post(
    "/internal/ai/sandbox/jobs/{job_id}/permissions",
    response_model=SandboxWorkerPermissionState,
)
async def create_ai_sandbox_permission(
    job_id: str,
    payload: SandboxWorkerPermissionRequest,
    authorization: str | None = Header(default=None),
):
    _require_worker_service(authorization)
    try:
        return await chat_api()._run_chat_call(
            _service().create_permission_request,
            session_id=payload.session_id,
            job_id=job_id,
            opencode_permission_id=payload.opencode_permission_id,
            tool=payload.tool,
            operation=payload.operation,
            arguments_preview=payload.arguments,
            message_id=None,
        )
    except Exception as exc:
        chat_api()._raise_chat_http_error(exc)


@router.get(
    "/internal/ai/sandbox/jobs/{job_id}/permissions/{permission_id}",
    response_model=SandboxWorkerPermissionState,
)
async def get_ai_sandbox_permission(
    job_id: str,
    permission_id: str,
    authorization: str | None = Header(default=None),
):
    _require_worker_service(authorization)
    try:
        return await chat_api()._run_chat_call(
            _service().get_permission_for_worker,
            job_id=job_id,
            permission_id=permission_id,
        )
    except Exception as exc:
        chat_api()._raise_chat_http_error(exc)


@router.post(
    "/internal/ai/sandbox/jobs/{job_id}/result",
    response_model=SandboxWorkerResultResponse,
)
async def record_ai_sandbox_result(
    job_id: str,
    payload: SandboxWorkerResultRequest,
    authorization: str | None = Header(default=None),
):
    _require_worker_service(authorization)
    try:
        return await chat_api()._run_chat_call(
            _service().record_worker_result,
            job_id=job_id,
            opencode_session_id=payload.opencode_session_id,
            assistant_markdown=payload.assistant_markdown,
            files=[item.model_dump(mode="json") for item in payload.files],
        )
    except Exception as exc:
        chat_api()._raise_chat_http_error(exc)


@router.post(
    "/internal/ai/sandbox/jobs/{job_id}/finalize",
    response_model=SandboxWorkerResultResponse,
)
async def finalize_ai_sandbox_result(
    job_id: str,
    payload: SandboxWorkerFinalizeRequest,
    authorization: str | None = Header(default=None),
):
    _require_worker_service(authorization)
    try:
        return await chat_api()._run_chat_call(
            _service().finalize_worker_result,
            job_id=job_id,
            assistant_markdown=payload.assistant_markdown,
        )
    except Exception as exc:
        chat_api()._raise_chat_http_error(exc)


@router.post(
    "/internal/ai/sandbox/jobs/{job_id}/status",
    response_model=SandboxWorkerJobState,
)
async def publish_ai_sandbox_job_status(
    job_id: str,
    authorization: str | None = Header(default=None),
):
    _require_worker_service(authorization)
    try:
        return await chat_api()._run_chat_call(_service().publish_current_job_status, job_id=job_id)
    except Exception as exc:
        chat_api()._raise_chat_http_error(exc)


@router.get(
    "/internal/ai/sandbox/jobs/{job_id}/status",
    response_model=SandboxWorkerJobState,
)
async def get_ai_sandbox_job_status(
    job_id: str,
    authorization: str | None = Header(default=None),
):
    _require_worker_service(authorization)
    try:
        return await chat_api()._run_chat_call(_service().get_worker_job_state, job_id=job_id)
    except Exception as exc:
        chat_api()._raise_chat_http_error(exc)


def _stage_upload(upload: UploadFile, *, expected_size: int) -> tuple[Path, Path]:
    quarantine = Path(tempfile.mkdtemp(prefix="hub-ai-sandbox-output-"))
    try:
        os.chmod(quarantine, 0o700)
    except OSError:
        pass
    destination = quarantine / "payload.bin"
    written = 0
    try:
        flags = os.O_WRONLY | os.O_CREAT | os.O_EXCL | getattr(os, "O_NOFOLLOW", 0)
        descriptor = os.open(destination, flags, 0o600)
        try:
            with os.fdopen(descriptor, "wb", closefd=False) as output:
                while chunk := upload.file.read(1024 * 1024):
                    written += len(chunk)
                    if written > expected_size:
                        raise ValueError("Sandbox output exceeds its declared size")
                    output.write(chunk)
                output.flush()
                os.fsync(output.fileno())
        finally:
            os.close(descriptor)
        if written != expected_size:
            raise ValueError("Sandbox output size changed in transit")
        return quarantine, destination
    except Exception:
        shutil.rmtree(quarantine, ignore_errors=True)
        raise


@router.post(
    "/internal/ai/sandbox/jobs/{job_id}/manifest",
    response_model=SandboxJobManifestView,
)
async def get_ai_sandbox_job_manifest(
    job_id: str,
    authorization: str | None = Header(default=None),
):
    _require_worker_service(authorization)
    try:
        return await chat_api()._run_chat_call(_service().issue_job_manifest, job_id=job_id)
    except Exception as exc:
        chat_api()._raise_chat_http_error(exc)


@router.post(
    "/internal/ai/sandbox/jobs/{job_id}/outputs/{file_id}/grant",
    response_model=SandboxOutputTransferGrantView,
)
async def create_ai_sandbox_output_transfer_grant(
    job_id: str,
    file_id: str,
    authorization: str | None = Header(default=None),
):
    _require_worker_service(authorization)
    try:
        return await chat_api()._run_chat_call(
            _service().issue_output_upload_grant,
            job_id=job_id,
            file_id=file_id,
        )
    except Exception as exc:
        chat_api()._raise_chat_http_error(exc)


@router.get("/internal/ai/sandbox/transfers/{grant_id}")
async def download_ai_sandbox_input(
    grant_id: str,
    authorization: str | None = Header(default=None),
):
    try:
        transfer = await chat_api()._run_chat_call(
            _service().consume_input_transfer,
            grant_id=grant_id,
            raw_token=_one_time_token(authorization),
        )
    except Exception as exc:
        chat_api()._raise_chat_http_error(exc)
    return FileResponse(
        path=transfer["path"],
        filename=transfer["file_name"],
        media_type=transfer["content_type"],
        headers={"Cache-Control": "no-store", "X-Content-Type-Options": "nosniff"},
    )


@router.put(
    "/internal/ai/sandbox/transfers/{grant_id}",
    response_model=SandboxOutputTransferResult,
)
async def upload_ai_sandbox_output(
    grant_id: str,
    file: UploadFile = File(...),
    authorization: str | None = Header(default=None),
):
    token = _one_time_token(authorization)
    claimed = None
    consume_started = False
    quarantine: Path | None = None
    try:
        claimed = await chat_api()._run_chat_call(
            _service().claim_output_upload,
            grant_id=grant_id,
            raw_token=token,
        )
        if isinstance(claimed.get("completed_result"), dict):
            return claimed["completed_result"]
        quarantine, staged_path = await chat_api()._run_chat_call(
            _stage_upload,
            file,
            expected_size=int(claimed["size_bytes"]),
        )
        consume_started = True
        return await chat_api()._run_chat_call(
            _service().consume_claimed_output_upload,
            claimed=claimed,
            staged_path=staged_path,
        )
    except Exception as exc:
        if claimed is not None and not consume_started:
            await chat_api()._run_chat_call(
                _service().revoke_claimed_transfer,
                grant_id=grant_id,
            )
        chat_api()._raise_chat_http_error(exc)
    finally:
        try:
            await file.close()
        finally:
            if quarantine is not None:
                shutil.rmtree(quarantine, ignore_errors=True)
