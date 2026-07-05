from __future__ import annotations

import base64
import html
import logging
import re
from typing import Any, Callable

from backend.services.mail_outgoing_html import plain_text_to_html
from backend.services.mail_reference_codec import (
    build_inline_attachment_src,
    encode_attachment_token,
    encode_message_id,
    extract_attachment_raw_id,
    normalize_attachment_content_id,
)

logger = logging.getLogger(__name__)


def _normalize_text(value: Any, default: str = "") -> str:
    if value is None:
        return default
    try:
        text = str(value).strip()
    except Exception:
        return default
    return text or default


def serialize_person(value: Any) -> dict[str, str | None]:
    if value is None:
        return {"name": None, "email": None, "display": None}
    if isinstance(value, str):
        email = _normalize_text(value).lower()
        display = email or None
        return {"name": None, "email": email or None, "display": display}
    email = _normalize_text(getattr(value, "email_address", None)).lower()
    name = _normalize_text(
        getattr(value, "name", None)
        or getattr(value, "display_name", None)
        or getattr(value, "mailbox_name", None)
    )
    display = name or email or None
    return {
        "name": name or None,
        "email": email or None,
        "display": display,
    }


def person_lookup_key(person: dict[str, Any] | None) -> str:
    if not isinstance(person, dict):
        return ""
    return _normalize_text(person.get("email") or person.get("display") or person.get("name")).lower()


def item_sender_person(item: Any) -> dict[str, str | None]:
    sender = getattr(item, "sender", None)
    if sender is not None:
        person = serialize_person(sender)
        if person.get("email") or person.get("display"):
            return person
    author = getattr(item, "author", None)
    if author is not None:
        person = serialize_person(author)
        if person.get("email") or person.get("display"):
            return person
    return {"name": None, "email": None, "display": None}


def item_sender(item: Any) -> str:
    return _normalize_text(item_sender_person(item).get("email")).lower()


def draft_sender_person_fallback(
    folder_key: str,
    mailbox_email: str,
    base_person: dict[str, str | None],
) -> dict[str, str | None]:
    if _normalize_text(folder_key).lower() != "drafts":
        return base_person
    if _normalize_text(base_person.get("email")) or _normalize_text(base_person.get("display")):
        return base_person
    email = _normalize_text(mailbox_email).lower()
    if not email:
        return base_person
    return {"name": None, "email": email, "display": email}


def item_recipient_people(
    item: Any,
    attrs: tuple[str, ...] = ("to_recipients", "cc_recipients"),
) -> list[dict[str, str | None]]:
    recipients: list[dict[str, str | None]] = []
    seen: set[str] = set()
    for attr in attrs:
        values = getattr(item, attr, None) or []
        for rec in values:
            person = serialize_person(rec)
            lookup_key = person_lookup_key(person)
            if not lookup_key or lookup_key in seen:
                continue
            seen.add(lookup_key)
            recipients.append(person)
    return recipients


def item_recipients(item: Any) -> list[str]:
    return [
        _normalize_text(person.get("email")).lower()
        for person in item_recipient_people(item)
        if _normalize_text(person.get("email"))
    ]


def item_bcc_recipient_people(item: Any) -> list[dict[str, str | None]]:
    return item_recipient_people(item, attrs=("bcc_recipients",))


def item_bcc_recipients(item: Any) -> list[str]:
    return [
        _normalize_text(person.get("email")).lower()
        for person in item_bcc_recipient_people(item)
        if _normalize_text(person.get("email"))
    ]


def item_message_id(item: Any) -> str:
    return _normalize_text(getattr(item, "message_id", None)).strip()


def normalize_subject_for_conversation(subject: Any) -> str:
    value = _normalize_text(subject).lower()
    if not value:
        return "(без темы)"
    normalized = re.sub(r"^(?:(?:re|fwd?|fw)\s*:\s*)+", "", value, flags=re.IGNORECASE).strip()
    return normalized or "(без темы)"


def item_conversation_key(item: Any) -> str:
    conversation_id = getattr(item, "conversation_id", None)
    if conversation_id is not None:
        value = _normalize_text(getattr(conversation_id, "id", None) or conversation_id)
        if value:
            return value
    return normalize_subject_for_conversation(getattr(item, "subject", ""))


def item_attachments_count(item: Any) -> int:
    attachments = getattr(item, "attachments", None)
    if attachments is not None:
        count = len(list(attachments))
        if count > 0:
            return count
    return 1 if bool(getattr(item, "has_attachments", False)) else 0


def item_importance(item: Any) -> str:
    value = _normalize_text(getattr(item, "importance", None), "normal").lower()
    if value in {"high", "low", "normal"}:
        return value
    return "normal"


class MailMessageSerializer:
    def __init__(
        self,
        *,
        inline_attachment_embed_max_size: int,
        is_downloadable_attachment: Callable[[Any], bool],
    ) -> None:
        self.inline_attachment_embed_max_size = max(0, int(inline_attachment_embed_max_size or 0))
        self.is_downloadable_attachment = is_downloadable_attachment

    def build_quote_html(self, item: Any) -> str:
        sender_person = item_sender_person(item)
        sender = _normalize_text(sender_person.get("display") or sender_person.get("email")) or "-"
        subject = _normalize_text(getattr(item, "subject", "")) or "(без темы)"
        received = getattr(item, "datetime_received", None) or getattr(item, "datetime_created", None)
        received_label = received.strftime("%d.%m.%Y %H:%M") if received else "-"
        body_html = _normalize_text(getattr(item, "body", None))
        if not body_html:
            body_html = plain_text_to_html(_normalize_text(getattr(item, "text_body", None)))
        header = (
            f"<p><strong>От:</strong> {html.escape(sender)}</p>"
            f"<p><strong>Дата:</strong> {html.escape(received_label)}</p>"
            f"<p><strong>Тема:</strong> {html.escape(subject)}</p>"
        )
        return f"<div class=\"quoted-mail\"><br><br>{header}<blockquote>{body_html}</blockquote></div>"

    def should_embed_inline_attachment(self, attachment: Any) -> bool:
        content_id = normalize_attachment_content_id(getattr(attachment, "content_id", None))
        if not content_id and not bool(getattr(attachment, "is_inline", False)):
            return False
        content_type = _normalize_text(getattr(attachment, "content_type", "")).lower()
        if not content_type.startswith("image/"):
            return False
        try:
            size = int(getattr(attachment, "size", 0) or 0)
        except Exception:
            size = 0
        return size > 0 and size <= self.inline_attachment_embed_max_size

    def build_inline_attachment_data_url(self, attachment: Any) -> str | None:
        if not self.should_embed_inline_attachment(attachment):
            return None
        try:
            content = attachment.content
        except Exception:
            content = b""
        if not isinstance(content, (bytes, bytearray)) or not content:
            return None
        content_type = _normalize_text(getattr(attachment, "content_type", "application/octet-stream"))
        encoded = base64.b64encode(bytes(content)).decode("ascii")
        return f"data:{content_type};base64,{encoded}"

    def build_compose_context(self, item: Any, mailbox_email: str, mailbox_id: str | None = None) -> dict[str, Any]:
        mailbox = _normalize_text(mailbox_email).lower()
        subject = _normalize_text(getattr(item, "subject", "")) or "(без темы)"
        sender = item_sender(item)
        to_values = item_recipients(item)
        cc_values = [
            _normalize_text(getattr(rec, "email_address", None)).lower()
            for rec in (getattr(item, "cc_recipients", None) or [])
            if _normalize_text(getattr(rec, "email_address", None))
        ]

        def _dedupe(values: list[str]) -> list[str]:
            result: list[str] = []
            seen: set[str] = set()
            for value in values:
                email = _normalize_text(value).lower()
                if not email or email == mailbox or email in seen:
                    continue
                seen.add(email)
                result.append(email)
            return result

        quote_html = self.build_quote_html(item)
        reply_subject = subject if re.match(r"(?i)^re:\s*", subject) else f"Re: {subject}"
        forward_subject = subject if re.match(r"(?i)^fwd?:\s*", subject) else f"Fwd: {subject}"

        reply_all_to = _dedupe([sender, *to_values])
        if sender and sender in reply_all_to:
            filtered_to = [sender]
            filtered_to.extend([value for value in reply_all_to if value != sender])
            reply_all_to = filtered_to

        return {
            "mailbox_id": _normalize_text(mailbox_id) or None,
            "mailbox_email": mailbox or None,
            "reply": {
                "subject": reply_subject,
                "to": _dedupe([sender]),
                "cc": [],
                "quote_html": quote_html,
            },
            "reply_all": {
                "subject": reply_subject,
                "to": reply_all_to,
                "cc": _dedupe(cc_values),
                "quote_html": quote_html,
            },
            "forward": {
                "subject": forward_subject,
                "to": [],
                "cc": [],
                "quote_html": quote_html,
            },
        }

    def serialize_message_detail(
        self,
        *,
        item: Any,
        folder_key: str,
        mailbox_id: str | None = None,
        mailbox_email: str,
        restore_hint_folder: str | None = None,
        draft_context: dict[str, Any] | None = None,
        include_inline_data_urls: bool = False,
    ) -> dict[str, Any]:
        received = getattr(item, "datetime_received", None) or getattr(item, "datetime_created", None)
        received_iso = received.isoformat() if received else None
        body_html = _normalize_text(getattr(item, "body", None))
        body_text = _normalize_text(getattr(item, "text_body", None))
        if not body_text and body_html:
            body_text = _normalize_text(re.sub(r"<[^>]+>", " ", body_html))

        resolved_mailbox_id = _normalize_text(mailbox_id)
        encoded_message_id = encode_message_id(folder_key, _normalize_text(getattr(item, "id", "")), resolved_mailbox_id)

        attachments = []
        for att in (getattr(item, "attachments", None) or []):
            attachment_raw_id = extract_attachment_raw_id(att)
            download_token = encode_attachment_token(attachment_raw_id, resolved_mailbox_id)
            content_id = normalize_attachment_content_id(getattr(att, "content_id", None))
            is_inline = bool(getattr(att, "is_inline", False) or content_id)
            is_downloadable = bool((download_token or attachment_raw_id) and self.is_downloadable_attachment(att))
            if not is_downloadable:
                logger.warning(
                    "Mail attachment is not downloadable: name=%s mailbox_id=%s message_exchange_id=%s attachment_type=%s stable_id=%s",
                    _normalize_text(getattr(att, "name", "attachment.bin")),
                    resolved_mailbox_id or "",
                    _normalize_text(getattr(item, "id", "")),
                    type(att).__name__,
                    attachment_raw_id or "",
                )
            attachments.append(
                {
                    "id": attachment_raw_id,
                    "download_token": download_token,
                    "downloadable": is_downloadable,
                    "name": _normalize_text(getattr(att, "name", "attachment.bin")),
                    "content_type": _normalize_text(getattr(att, "content_type", "")),
                    "size": int(getattr(att, "size", 0) or 0),
                    "content_id": content_id,
                    "is_inline": is_inline,
                    "inline_src": build_inline_attachment_src(
                        message_id=encoded_message_id,
                        attachment_ref=download_token or attachment_raw_id,
                    ) if is_inline and (download_token or attachment_raw_id) else None,
                    "inline_data_url": self.build_inline_attachment_data_url(att)
                    if include_inline_data_urls and is_inline
                    else None,
                }
            )

        sender_person = draft_sender_person_fallback(folder_key, mailbox_email, item_sender_person(item))
        to_people = item_recipient_people(item, attrs=("to_recipients",))
        cc_people = item_recipient_people(item, attrs=("cc_recipients",))
        bcc_people = item_bcc_recipient_people(item)
        compose_context = self.build_compose_context(item, mailbox_email, resolved_mailbox_id)

        sender_email = _normalize_text(sender_person.get("email")).lower()
        return {
            "id": encoded_message_id,
            "mailbox_id": resolved_mailbox_id or None,
            "exchange_id": _normalize_text(getattr(item, "id", "")),
            "folder": folder_key,
            "subject": _normalize_text(getattr(item, "subject", "")),
            "sender": sender_email,
            "sender_person": sender_person,
            "sender_name": sender_person.get("name"),
            "sender_email": sender_person.get("email"),
            "sender_display": sender_person.get("display") or sender_email,
            "to": [
                _normalize_text(person.get("email")).lower()
                for person in to_people
                if _normalize_text(person.get("email"))
            ],
            "to_people": to_people,
            "cc": [
                _normalize_text(person.get("email")).lower()
                for person in cc_people
                if _normalize_text(person.get("email"))
            ],
            "cc_people": cc_people,
            "bcc": [
                _normalize_text(person.get("email")).lower()
                for person in bcc_people
                if _normalize_text(person.get("email"))
            ],
            "bcc_people": bcc_people,
            "received_at": received_iso,
            "is_read": bool(getattr(item, "is_read", False)),
            "body_html": body_html,
            "body_text": body_text,
            "importance": item_importance(item),
            "categories": [str(value).strip() for value in (getattr(item, "categories", None) or []) if str(value).strip()],
            "reminder_is_set": bool(getattr(item, "reminder_is_set", False)),
            "reminder_due_by": (
                getattr(item, "reminder_due_by", None).isoformat()
                if getattr(item, "reminder_due_by", None) is not None
                else None
            ),
            "internet_message_id": item_message_id(item) or None,
            "conversation_id": item_conversation_key(item),
            "restore_hint_folder": restore_hint_folder,
            "attachments": attachments,
            "compose_context": compose_context,
            "draft_context": draft_context or None,
            "has_external_images": bool(re.search(r"<img[^>]+src=['\"]https?://", body_html, flags=re.IGNORECASE)),
            "can_archive": not str(folder_key).startswith("archive"),
            "can_move": True,
        }

    def serialize_message_preview(
        self,
        *,
        item: Any,
        folder_key: str,
        mailbox_id: str | None = None,
        mailbox_email: str = "",
    ) -> dict[str, Any]:
        received = getattr(item, "datetime_received", None) or getattr(item, "datetime_created", None)
        received_iso = received.isoformat() if received else None
        body_text = _normalize_text(getattr(item, "text_body", None))
        if not body_text:
            body_text = _normalize_text(getattr(item, "body", None))
        body_preview = body_text[:350]
        has_attachments = bool(getattr(item, "has_attachments", False))
        sender_person = draft_sender_person_fallback(folder_key, mailbox_email, item_sender_person(item))
        recipient_people = item_recipient_people(item)
        sender_email = _normalize_text(sender_person.get("email")).lower()
        return {
            "id": encode_message_id(folder_key, _normalize_text(getattr(item, "id", "")), _normalize_text(mailbox_id)),
            "mailbox_id": _normalize_text(mailbox_id) or None,
            "exchange_id": _normalize_text(getattr(item, "id", "")),
            "folder": folder_key,
            "subject": _normalize_text(getattr(item, "subject", "")),
            "sender": sender_email,
            "sender_person": sender_person,
            "sender_name": sender_person.get("name"),
            "sender_email": sender_person.get("email"),
            "sender_display": sender_person.get("display") or sender_email,
            "recipients": item_recipients(item),
            "recipient_people": recipient_people,
            "received_at": received_iso,
            "is_read": bool(getattr(item, "is_read", False)),
            "has_attachments": has_attachments,
            "attachments_count": item_attachments_count(item),
            "body_preview": body_preview,
            "importance": item_importance(item),
            "categories": [str(value).strip() for value in (getattr(item, "categories", None) or []) if str(value).strip()],
        }
