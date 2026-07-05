"""Mailbox quota snapshot import and reporting API."""
from __future__ import annotations

import logging
import os
from typing import Optional

from fastapi import APIRouter, Depends, Header, HTTPException, Query, status
from fastapi.concurrency import run_in_threadpool

from backend.api.deps import ensure_user_permission, get_current_active_user
from backend.models.auth import User
from backend.models.mailbox_quota import (
    MailboxQuotaImportResponse,
    MailboxQuotaRowsPage,
    MailboxQuotaSnapshotImport,
    MailboxQuotaSnapshotStats,
    MailboxQuotaSnapshotSummary,
)
from backend.services.authorization_service import PERM_MAIL_QUOTAS_READ
from backend.services.mailbox_quota_service import mailbox_quota_service

router = APIRouter()
logger = logging.getLogger(__name__)


def _api_key_fingerprint(candidate: Optional[str]) -> str:
    value = str(candidate or "").strip()
    if not value:
        return "missing"
    if len(value) <= 8:
        return "short"
    return f"{value[:4]}...{value[-4:]}"


def _configured_import_keys() -> set[str]:
    keys: set[str] = set()
    ring_raw = str(os.getenv("MAIL_QUOTA_IMPORT_API_KEYS", "") or "").strip()
    if ring_raw:
        keys.update(item.strip() for item in ring_raw.split(",") if item.strip())
    legacy_key = str(os.getenv("MAIL_QUOTA_IMPORT_API_KEY", "") or "").strip()
    if legacy_key:
        keys.add(legacy_key)
    return keys


def _is_valid_import_api_key(candidate: Optional[str]) -> bool:
    keys = _configured_import_keys()
    if not keys:
        return False
    value = str(candidate or "").strip()
    return bool(value) and value in keys


async def get_current_quota_reader(
    current_user: User = Depends(get_current_active_user),
):
    ensure_user_permission(current_user, PERM_MAIL_QUOTAS_READ)
    return current_user


@router.post("/mailbox-quota-snapshots", response_model=MailboxQuotaImportResponse)
async def import_mailbox_quota_snapshot(
    payload: MailboxQuotaSnapshotImport,
    x_api_key: Optional[str] = Header(None),
):
    if not _is_valid_import_api_key(x_api_key):
        logger.warning(
            "Mailbox quota import rejected unknown key fingerprint=%s",
            _api_key_fingerprint(x_api_key),
        )
        raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="Invalid API Key")

    max_upload_mb = max(1, int(str(os.getenv("MAIL_QUOTA_MAX_UPLOAD_MB", "25") or "25")))
    # Rough guard: reject obviously huge payloads before DB work.
    if len(payload.rows) > 10000:
        raise HTTPException(status_code=status.HTTP_413_REQUEST_ENTITY_TOO_LARGE, detail="Too many rows")

    estimated_bytes = len(payload.rows) * 512
    if estimated_bytes > max_upload_mb * 1024 * 1024:
        raise HTTPException(status_code=status.HTTP_413_REQUEST_ENTITY_TOO_LARGE, detail="Payload too large")

    try:
        return await run_in_threadpool(mailbox_quota_service.import_snapshot, payload)
    except ValueError as exc:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail=str(exc)) from exc
    except Exception as exc:
        logger.exception("Mailbox quota import failed")
        raise HTTPException(status_code=status.HTTP_500_INTERNAL_SERVER_ERROR, detail=str(exc)) from exc


@router.get("/mailbox-quota-snapshots", response_model=list[MailboxQuotaSnapshotSummary])
async def list_mailbox_quota_snapshots(
    limit: int = Query(20, ge=1, le=100),
    _: User = Depends(get_current_quota_reader),
):
    return await run_in_threadpool(mailbox_quota_service.list_snapshots, limit=limit)


@router.get("/mailbox-quota-snapshots/latest", response_model=MailboxQuotaSnapshotSummary)
async def get_latest_mailbox_quota_snapshot(
    _: User = Depends(get_current_quota_reader),
):
    snapshot = await run_in_threadpool(mailbox_quota_service.get_latest_snapshot)
    if snapshot is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="No snapshots found")
    return snapshot


@router.get("/mailbox-quota-snapshots/{snapshot_id}/summary", response_model=MailboxQuotaSnapshotStats)
async def get_mailbox_quota_snapshot_summary(
    snapshot_id: int,
    _: User = Depends(get_current_quota_reader),
):
    try:
        return await run_in_threadpool(mailbox_quota_service.get_snapshot_summary, snapshot_id)
    except ValueError as exc:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail=str(exc)) from exc


@router.get("/mailbox-quota-snapshots/{snapshot_id}/rows", response_model=MailboxQuotaRowsPage)
async def list_mailbox_quota_rows(
    snapshot_id: int,
    search: str = Query("", max_length=200),
    over_quota: bool = Query(False),
    warning_90: bool = Query(False),
    no_quota: bool = Query(False),
    database_name: str = Query("", max_length=255),
    limit: int = Query(100, ge=1, le=500),
    offset: int = Query(0, ge=0),
    _: User = Depends(get_current_quota_reader),
):
    try:
        return await run_in_threadpool(
            mailbox_quota_service.list_rows,
            snapshot_id,
            search=search,
            over_quota=over_quota,
            warning_90=warning_90,
            no_quota=no_quota,
            database_name=database_name,
            limit=limit,
            offset=offset,
        )
    except ValueError as exc:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail=str(exc)) from exc
