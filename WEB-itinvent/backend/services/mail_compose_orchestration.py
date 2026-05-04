from __future__ import annotations

import re
from dataclasses import dataclass
from typing import Any, Callable, Iterable

from backend.services.mail_outgoing_html import build_outgoing_html_body


class ComposeValidationError(ValueError):
    """Raised when outbound compose input cannot produce a valid plan."""


@dataclass(frozen=True)
class RecipientSet:
    to: list[str]
    cc: list[str]
    bcc: list[str]


@dataclass(frozen=True)
class DraftUpsertPlan:
    effective_mailbox_id: str
    retain_attachment_ids: list[str]
    recipients: RecipientSet
    subject: str
    body: str
    is_html: bool
    compose_mode: str
    reply_to_message_id: str
    forward_message_id: str


@dataclass(frozen=True)
class OutboundSendPlan:
    effective_mailbox_id: str
    recipients: RecipientSet
    subject: str
    body: str
    is_html: bool
    reply_to_message_id: str
    forward_message_id: str
    draft_id: str


def normalize_text(value: Any, default: str = "") -> str:
    text = str(value or "").strip()
    return text or default


def parse_recipients(value: str | Iterable[Any] | None) -> list[str]:
    if value is None:
        parts: Iterable[Any] = []
    elif isinstance(value, str):
        parts = [value]
    else:
        parts = value

    result: list[str] = []
    seen: set[str] = set()
    for raw_part in parts:
        for part in re.split(r"[;,]+", str(raw_part or "")):
            email = normalize_text(part).lower()
            if not email or email in seen:
                continue
            seen.add(email)
            result.append(email)
    return result


def build_recipient_set(
    *,
    to: list[str] | None = None,
    cc: list[str] | None = None,
    bcc: list[str] | None = None,
    require_to: bool = False,
) -> RecipientSet:
    recipients = RecipientSet(
        to=parse_recipients(to or []),
        cc=parse_recipients(cc or []),
        bcc=parse_recipients(bcc or []),
    )
    if require_to and not recipients.to:
        raise ComposeValidationError("At least one recipient is required")
    return recipients


def resolve_outbound_mailbox_id(
    *,
    mailbox_id: str | None = None,
    draft_id: str | None = None,
    reply_to_message_id: str | None = None,
    forward_message_id: str | None = None,
    mailbox_id_from_message: Callable[[str | None], str],
    mailbox_scope_resolver: Callable[..., str],
) -> str:
    explicit_mailbox_id = normalize_text(mailbox_id)
    if explicit_mailbox_id:
        return explicit_mailbox_id
    return mailbox_scope_resolver(
        mailbox_id,
        mailbox_id_from_message(draft_id),
        mailbox_id_from_message(reply_to_message_id),
        mailbox_id_from_message(forward_message_id),
    )


def prepare_outgoing_body(
    *,
    body: Any,
    signature: Any,
    is_html: bool,
    has_reply_or_forward: bool,
) -> str:
    final_body = normalize_text(body)
    normalized_signature = normalize_text(signature)
    if is_html:
        return build_outgoing_html_body(
            final_body,
            normalized_signature,
            prefer_signature_before_quote=bool(has_reply_or_forward),
        )
    if normalized_signature:
        return f"{final_body}\n\n{normalized_signature}" if final_body else normalized_signature
    return final_body


def build_reply_forward_reference_headers(
    *,
    reply_message_id: str = "",
    reply_references: str = "",
    forward_message_id: str = "",
) -> dict[str, str]:
    reference_ids: list[str] = []
    normalized_reply_id = normalize_text(reply_message_id)
    if normalized_reply_id:
        reference_ids.append(normalized_reply_id)
    normalized_reply_references = normalize_text(reply_references)
    if normalized_reply_references:
        reference_ids.extend([part for part in normalized_reply_references.split() if part])
    normalized_forward_id = normalize_text(forward_message_id)
    if normalized_forward_id:
        reference_ids.append(normalized_forward_id)

    headers: dict[str, str] = {}
    if normalized_reply_id:
        headers["in_reply_to"] = normalized_reply_id
    unique_references: list[str] = []
    seen: set[str] = set()
    for value in reference_ids:
        normalized = normalize_text(value)
        if not normalized or normalized in seen:
            continue
        seen.add(normalized)
        unique_references.append(normalized)
    if unique_references:
        headers["references"] = " ".join(unique_references)
    return headers


def build_draft_upsert_plan(
    *,
    mailbox_id: str | None = None,
    draft_id: str = "",
    compose_mode: str = "draft",
    to: list[str] | None = None,
    cc: list[str] | None = None,
    bcc: list[str] | None = None,
    subject: Any = "",
    body: Any = "",
    is_html: bool = True,
    reply_to_message_id: str = "",
    forward_message_id: str = "",
    retain_existing_attachments: list[str] | None = None,
    attachment_id_resolver: Callable[[str], str],
    mailbox_id_from_message: Callable[[str | None], str],
    mailbox_scope_resolver: Callable[..., str],
) -> DraftUpsertPlan:
    return DraftUpsertPlan(
        effective_mailbox_id=resolve_outbound_mailbox_id(
            mailbox_id=mailbox_id,
            draft_id=draft_id,
            reply_to_message_id=reply_to_message_id,
            forward_message_id=forward_message_id,
            mailbox_id_from_message=mailbox_id_from_message,
            mailbox_scope_resolver=mailbox_scope_resolver,
        ),
        retain_attachment_ids=[
            attachment_id_resolver(token)
            for token in (retain_existing_attachments or [])
            if normalize_text(token)
        ],
        recipients=build_recipient_set(to=to, cc=cc, bcc=bcc),
        subject=normalize_text(subject),
        body=normalize_text(body),
        is_html=bool(is_html),
        compose_mode=normalize_text(compose_mode, "draft"),
        reply_to_message_id=normalize_text(reply_to_message_id),
        forward_message_id=normalize_text(forward_message_id),
    )


def build_outbound_send_plan(
    *,
    mailbox_id: str | None = None,
    draft_id: str = "",
    to: list[str],
    cc: list[str] | None = None,
    bcc: list[str] | None = None,
    subject: Any,
    body: Any,
    signature: Any,
    is_html: bool = True,
    reply_to_message_id: str = "",
    forward_message_id: str = "",
    mailbox_id_from_message: Callable[[str | None], str],
    mailbox_scope_resolver: Callable[..., str],
) -> OutboundSendPlan:
    normalized_reply_id = normalize_text(reply_to_message_id)
    normalized_forward_id = normalize_text(forward_message_id)
    return OutboundSendPlan(
        effective_mailbox_id=resolve_outbound_mailbox_id(
            mailbox_id=mailbox_id,
            draft_id=draft_id,
            reply_to_message_id=normalized_reply_id,
            forward_message_id=normalized_forward_id,
            mailbox_id_from_message=mailbox_id_from_message,
            mailbox_scope_resolver=mailbox_scope_resolver,
        ),
        recipients=build_recipient_set(to=to, cc=cc, bcc=bcc, require_to=True),
        subject=normalize_text(subject),
        body=prepare_outgoing_body(
            body=body,
            signature=signature,
            is_html=bool(is_html),
            has_reply_or_forward=bool(normalized_reply_id or normalized_forward_id),
        ),
        is_html=bool(is_html),
        reply_to_message_id=normalized_reply_id,
        forward_message_id=normalized_forward_id,
        draft_id=normalize_text(draft_id),
    )
