"""PostgreSQL-backed mail send idempotency ledger.

In-memory storage is forbidden: processing leases and replay must survive
process restart. Enable with MAIL_SEND_IDEMPOTENCY=1; empty/off is a no-op.
"""
from __future__ import annotations

import hashlib
import hmac
import json
import logging
import os
import threading
import uuid
from dataclasses import dataclass
from datetime import datetime, timedelta, timezone
from typing import Any, Callable

from sqlalchemy import select, update
from sqlalchemy.exc import IntegrityError

from backend.appdb.db import app_session, ensure_app_schema_initialized
from backend.appdb.models import AppMailSendIdempotency


logger = logging.getLogger(__name__)

STATUS_RESERVED = "reserved"
STATUS_PROCESSING = "processing"
STATUS_SENT = "sent"
STATUS_FAILED = "failed"
STATUS_UNKNOWN = "unknown"

MAX_BACKEND_SEND_BUDGET_SEC = 120
DEFAULT_LEASE_MARGIN_SEC = 30
DEFAULT_PROCESSING_LEASE_SEC = MAX_BACKEND_SEND_BUDGET_SEC + DEFAULT_LEASE_MARGIN_SEC

_TRUE = frozenset({"1", "true", "yes", "on"})
_METRIC_NAMES = (
    "idempotency_proceed",
    "idempotency_hit",
    "payload_conflict",
    "send_unknown",
    "duplicate_send_prevented",
    "reconciliation_success",
    "reconciliation_failed",
)
_metrics_lock = threading.Lock()
_METRICS = {name: 0 for name in _METRIC_NAMES}


@dataclass(frozen=True)
class MailSendIdempotencyClaim:
    action: str
    row_id: str | None = None
    result: dict[str, Any] | None = None
    internet_message_id: str = ""


def _proceed_claim(*, row_id: str | None, internet_message_id: str = "") -> MailSendIdempotencyClaim:
    increment_mail_send_idempotency_metric("idempotency_proceed")
    return MailSendIdempotencyClaim(
        action="proceed",
        row_id=row_id,
        internet_message_id=internet_message_id,
    )


def mail_send_idempotency_enabled(raw: Any | None = None) -> bool:
    value = os.getenv("MAIL_SEND_IDEMPOTENCY") if raw is None else raw
    if value is None:
        return False
    text = str(value).strip().lower()
    if not text:
        return False
    return text in _TRUE


def mail_send_processing_lease_sec(raw: Any | None = None) -> int:
    value = os.getenv("MAIL_SEND_PROCESSING_LEASE_SEC") if raw is None else raw
    text = str(value or "").strip()
    if not text:
        return DEFAULT_PROCESSING_LEASE_SEC
    try:
        parsed = int(text)
    except (TypeError, ValueError):
        logger.warning(
            "MAIL_SEND_PROCESSING_LEASE_SEC=%r is invalid; using %s",
            text,
            DEFAULT_PROCESSING_LEASE_SEC,
        )
        return DEFAULT_PROCESSING_LEASE_SEC
    if parsed < MAX_BACKEND_SEND_BUDGET_SEC:
        logger.warning(
            "MAIL_SEND_PROCESSING_LEASE_SEC=%s is below send budget %s; clamping",
            parsed,
            MAX_BACKEND_SEND_BUDGET_SEC,
        )
        return MAX_BACKEND_SEND_BUDGET_SEC
    return parsed


def reset_mail_send_idempotency_metrics() -> None:
    with _metrics_lock:
        for name in _METRIC_NAMES:
            _METRICS[name] = 0


def mail_send_idempotency_metrics() -> dict[str, int]:
    with _metrics_lock:
        return dict(_METRICS)


def increment_mail_send_idempotency_metric(name: str) -> None:
    if name not in _METRICS:
        return
    with _metrics_lock:
        _METRICS[name] += 1
    logger.info("mail.idempotency event=%s", name)


def _utcnow() -> datetime:
    return datetime.now(timezone.utc)


def _as_utc(value: datetime | None) -> datetime | None:
    if value is None:
        return None
    if value.tzinfo is None:
        return value.replace(tzinfo=timezone.utc)
    return value.astimezone(timezone.utc)


def _normalize_mailbox_id(value: Any) -> str:
    return str(value or "").strip() or "primary"


def _normalize_emails(values: Any) -> list[str]:
    items: list[str] = []
    seen: set[str] = set()
    for raw in list(values or []):
        email = str(raw or "").strip().lower()
        if not email or email in seen:
            continue
        seen.add(email)
        items.append(email)
    items.sort()
    return items


def _normalize_token_list(values: Any) -> list[str]:
    items = sorted({str(item or "").strip() for item in list(values or []) if str(item or "").strip()})
    return items


def _attachment_fingerprints(attachments: list[tuple[str, bytes]] | None) -> list[dict[str, Any]]:
    fingerprints: list[dict[str, Any]] = []
    for filename, content in list(attachments or []):
        payload = content if isinstance(content, (bytes, bytearray)) else b""
        fingerprints.append(
            {
                "name": str(filename or "").strip(),
                "sha256": hashlib.sha256(bytes(payload)).hexdigest(),
                "size": len(payload),
            }
        )
    fingerprints.sort(key=lambda item: (item["name"], item["sha256"], item["size"]))
    return fingerprints


def hash_mail_send_payload(
    *,
    mailbox_id: str,
    to: list[str] | None,
    cc: list[str] | None,
    bcc: list[str] | None,
    subject: str,
    body: str,
    is_html: bool,
    reply_to_message_id: str = "",
    forward_message_id: str = "",
    draft_id: str = "",
    retain_existing_attachments: list[str] | None = None,
    forward_attachment_refs: list[str] | None = None,
    attachments: list[tuple[str, bytes]] | None = None,
) -> str:
    canonical = {
        "mailbox_id": _normalize_mailbox_id(mailbox_id),
        "to": _normalize_emails(to),
        "cc": _normalize_emails(cc),
        "bcc": _normalize_emails(bcc),
        "subject": str(subject or ""),
        "body": str(body or ""),
        "is_html": bool(is_html),
        "reply_to_message_id": str(reply_to_message_id or "").strip(),
        "forward_message_id": str(forward_message_id or "").strip(),
        "draft_id": str(draft_id or "").strip(),
        "retain_existing_attachments": _normalize_token_list(retain_existing_attachments),
        "attachments": _attachment_fingerprints(attachments),
    }
    # Keep the historical hash for clients that do not prune forwarded files.
    if forward_attachment_refs is not None:
        canonical["forward_attachment_refs"] = _normalize_token_list(forward_attachment_refs)
    encoded = json.dumps(canonical, ensure_ascii=True, sort_keys=True, separators=(",", ":"))
    return hashlib.sha256(encoded.encode("utf-8")).hexdigest()


def _new_internet_message_id() -> str:
    return f"<hubit-send-{uuid.uuid4().hex}@local>"


def _load_result(raw: str | None) -> dict[str, Any]:
    try:
        payload = json.loads(str(raw or "{}"))
    except Exception:
        return {}
    return payload if isinstance(payload, dict) else {}


def _dump_result(result: dict[str, Any] | None) -> str:
    safe = dict(result or {})
    safe.pop("body", None)
    safe.pop("password", None)
    return json.dumps(safe, ensure_ascii=True, separators=(",", ":"), default=str)[:20_000]


class MailSendIdempotencyStore:
    def __init__(
        self,
        database_url: str | None = None,
        *,
        now_fn: Callable[[], datetime] | None = None,
        lease_sec: int | None = None,
    ) -> None:
        self._database_url = str(database_url or "").strip() or None
        self._now = now_fn or _utcnow
        self._lease_sec = int(lease_sec) if lease_sec is not None else None

    def _ready(self) -> None:
        ensure_app_schema_initialized(self._database_url)

    def _lease_seconds(self) -> int:
        if self._lease_sec is not None:
            return max(int(self._lease_sec), MAX_BACKEND_SEND_BUDGET_SEC)
        return mail_send_processing_lease_sec()

    def _find(self, session, *, user_id: int, mailbox_id: str, idempotency_key: str):
        return session.execute(
            select(AppMailSendIdempotency).where(
                AppMailSendIdempotency.user_id == int(user_id),
                AppMailSendIdempotency.mailbox_id == mailbox_id,
                AppMailSendIdempotency.idempotency_key == idempotency_key,
            )
        ).scalar_one_or_none()

    def get(self, *, user_id: int, mailbox_id: str, idempotency_key: str) -> AppMailSendIdempotency | None:
        self._ready()
        with app_session(self._database_url) as session:
            return self._find(
                session,
                user_id=int(user_id),
                mailbox_id=_normalize_mailbox_id(mailbox_id),
                idempotency_key=str(idempotency_key or "").strip(),
            )

    def claim(
        self,
        *,
        user_id: int,
        mailbox_id: str,
        idempotency_key: str,
        request_payload_hash: str,
    ) -> MailSendIdempotencyClaim:
        self._ready()
        now = self._now()
        lease_sec = self._lease_seconds()
        lease_until = now + timedelta(seconds=lease_sec)
        scope_mailbox = _normalize_mailbox_id(mailbox_id)
        key = str(idempotency_key or "").strip()
        payload_hash = str(request_payload_hash or "").strip()
        with app_session(self._database_url) as session:
            existing = self._find(
                session,
                user_id=int(user_id),
                mailbox_id=scope_mailbox,
                idempotency_key=key,
            )
            if existing is None:
                row = AppMailSendIdempotency(
                    id=uuid.uuid4().hex,
                    user_id=int(user_id),
                    mailbox_id=scope_mailbox,
                    idempotency_key=key,
                    request_payload_hash=payload_hash,
                    status=STATUS_PROCESSING,
                    internet_message_id=_new_internet_message_id(),
                    response_json="{}",
                    error_code=None,
                    processing_lease_until=lease_until,
                    created_at=now,
                    updated_at=now,
                    completed_at=None,
                )
                session.add(row)
                try:
                    session.flush()
                except IntegrityError:
                    session.rollback()
                    raced = self._find(
                        session,
                        user_id=int(user_id),
                        mailbox_id=scope_mailbox,
                        idempotency_key=key,
                    )
                    if raced is None:
                        raise
                    return self._interpret_existing(
                        session,
                        raced,
                        payload_hash=payload_hash,
                        now=now,
                        lease_sec=lease_sec,
                        lease_until=lease_until,
                    )
                return _proceed_claim(
                    row_id=row.id,
                    internet_message_id=row.internet_message_id,
                )
            return self._interpret_existing(
                session,
                existing,
                payload_hash=payload_hash,
                now=now,
                lease_sec=lease_sec,
                lease_until=lease_until,
            )

    def _interpret_existing(
        self,
        session,
        row: AppMailSendIdempotency,
        *,
        payload_hash: str,
        now: datetime,
        lease_sec: int,
        lease_until: datetime,
        retried: bool = False,
    ) -> MailSendIdempotencyClaim:
        if not hmac.compare_digest(str(row.request_payload_hash or ""), payload_hash):
            increment_mail_send_idempotency_metric("payload_conflict")
            return MailSendIdempotencyClaim(action="conflict")
        status = str(row.status or "").strip()
        if status == STATUS_SENT:
            increment_mail_send_idempotency_metric("idempotency_hit")
            increment_mail_send_idempotency_metric("duplicate_send_prevented")
            return MailSendIdempotencyClaim(
                action="replay",
                row_id=row.id,
                result=_load_result(row.response_json),
                internet_message_id=str(row.internet_message_id or ""),
            )
        if status == STATUS_UNKNOWN:
            increment_mail_send_idempotency_metric("send_unknown")
            return MailSendIdempotencyClaim(
                action="unknown",
                row_id=row.id,
                internet_message_id=str(row.internet_message_id or ""),
            )
        if status == STATUS_FAILED:
            # Atomic transition: two retries that both read "failed" must not
            # both become senders — only the UPDATE that matches wins.
            claimed = session.execute(
                update(AppMailSendIdempotency)
                .where(
                    AppMailSendIdempotency.id == row.id,
                    AppMailSendIdempotency.status == STATUS_FAILED,
                )
                .values(
                    status=STATUS_PROCESSING,
                    processing_lease_until=lease_until,
                    error_code=None,
                    completed_at=None,
                    updated_at=now,
                )
            ).rowcount
            if claimed:
                return _proceed_claim(
                    row_id=row.id,
                    internet_message_id=str(row.internet_message_id or "") or _new_internet_message_id(),
                )
            return self._reinterpret_after_race(
                session,
                row,
                payload_hash=payload_hash,
                now=now,
                lease_sec=lease_sec,
                lease_until=lease_until,
                retried=retried,
            )
        if status in {STATUS_RESERVED, STATUS_PROCESSING}:
            lease = _as_utc(row.processing_lease_until)
            if lease is None:
                created = _as_utc(row.created_at) or now
                lease = created + timedelta(seconds=lease_sec)
            if now < lease:
                increment_mail_send_idempotency_metric("duplicate_send_prevented")
                return MailSendIdempotencyClaim(
                    action="in_flight",
                    row_id=row.id,
                    internet_message_id=str(row.internet_message_id or ""),
                )
            if status == STATUS_RESERVED:
                claimed = session.execute(
                    update(AppMailSendIdempotency)
                    .where(
                        AppMailSendIdempotency.id == row.id,
                        AppMailSendIdempotency.status == STATUS_RESERVED,
                    )
                    .values(
                        status=STATUS_PROCESSING,
                        processing_lease_until=lease_until,
                        updated_at=now,
                    )
                ).rowcount
                if claimed:
                    return _proceed_claim(
                        row_id=row.id,
                        internet_message_id=str(row.internet_message_id or "") or _new_internet_message_id(),
                    )
                return self._reinterpret_after_race(
                    session,
                    row,
                    payload_hash=payload_hash,
                    now=now,
                    lease_sec=lease_sec,
                    lease_until=lease_until,
                    retried=retried,
                )
            claimed = session.execute(
                update(AppMailSendIdempotency)
                .where(
                    AppMailSendIdempotency.id == row.id,
                    AppMailSendIdempotency.status == STATUS_PROCESSING,
                )
                .values(
                    status=STATUS_UNKNOWN,
                    completed_at=now,
                    updated_at=now,
                )
            ).rowcount
            if claimed:
                increment_mail_send_idempotency_metric("send_unknown")
                increment_mail_send_idempotency_metric("reconciliation_failed")
                return MailSendIdempotencyClaim(
                    action="unknown",
                    row_id=row.id,
                    internet_message_id=str(row.internet_message_id or ""),
                )
            return self._reinterpret_after_race(
                session,
                row,
                payload_hash=payload_hash,
                now=now,
                lease_sec=lease_sec,
                lease_until=lease_until,
                retried=retried,
            )
        increment_mail_send_idempotency_metric("send_unknown")
        return MailSendIdempotencyClaim(action="unknown", row_id=row.id)

    def _reinterpret_after_race(
        self,
        session,
        row: AppMailSendIdempotency,
        *,
        payload_hash: str,
        now: datetime,
        lease_sec: int,
        lease_until: datetime,
        retried: bool,
    ) -> MailSendIdempotencyClaim:
        """A conditional UPDATE lost a race: another claim already transitioned
        this row. Re-read it and interpret the new status. Bounded to one retry —
        if the row is still under an active lease afterwards we stop rather than
        risk becoming a duplicate sender."""
        session.refresh(row)
        if retried:
            status = str(row.status or "").strip()
            if status in {STATUS_RESERVED, STATUS_PROCESSING}:
                increment_mail_send_idempotency_metric("duplicate_send_prevented")
                return MailSendIdempotencyClaim(
                    action="in_flight",
                    row_id=row.id,
                    internet_message_id=str(row.internet_message_id or ""),
                )
            if status == STATUS_UNKNOWN:
                return MailSendIdempotencyClaim(
                    action="unknown",
                    row_id=row.id,
                    internet_message_id=str(row.internet_message_id or ""),
                )
        return self._interpret_existing(
            session,
            row,
            payload_hash=payload_hash,
            now=now,
            lease_sec=lease_sec,
            lease_until=lease_until,
            retried=True,
        )

    def complete_sent(self, row_id: str, result: dict[str, Any] | None = None) -> None:
        self._finish(row_id, status=STATUS_SENT, result=result, error_code=None)

    def complete_failed(self, row_id: str, error_code: str | None = None) -> None:
        self._finish(row_id, status=STATUS_FAILED, result=None, error_code=error_code)

    def complete_unknown(self, row_id: str, error_code: str | None = None) -> None:
        """The send may have been accepted: later claims get ``unknown`` and never ``proceed``."""
        self._finish(row_id, status=STATUS_UNKNOWN, result=None, error_code=error_code)

    def _finish(
        self,
        row_id: str,
        *,
        status: str,
        result: dict[str, Any] | None,
        error_code: str | None,
    ) -> None:
        identifier = str(row_id or "").strip()
        if not identifier:
            return
        self._ready()
        now = self._now()
        with app_session(self._database_url) as session:
            values: dict[str, Any] = {
                "status": status,
                "updated_at": now,
                "completed_at": now,
                "processing_lease_until": None,
            }
            if status == STATUS_SENT:
                values["response_json"] = _dump_result(result)
                values["error_code"] = None
            else:
                values["error_code"] = str(error_code or "MAIL_SEND_FAILED")[:64]
            # Never overwrite a terminal "sent" row: a late failure from an
            # earlier attempt must not hide a completed send.
            session.execute(
                update(AppMailSendIdempotency)
                .where(
                    AppMailSendIdempotency.id == identifier,
                    AppMailSendIdempotency.status != STATUS_SENT,
                )
                .values(**values)
            )
