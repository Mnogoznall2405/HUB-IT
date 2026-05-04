"""
Stable mail reference and attachment token codecs.

These helpers form the API identity contract between frontend links and backend
Exchange objects. Keep compatibility for old v1 message ids and att1 tokens.
"""
from __future__ import annotations

from typing import Any
from urllib.parse import quote
import base64
import re


ATTACHMENT_TOKEN_PREFIX = "att2_"
ATTACHMENT_TOKEN_PREFIX_LEGACY = "att1_"


class MailReferenceError(ValueError):
    """Mail reference token is missing or malformed."""


def normalize_text(value: Any, default: str = "") -> str:
    text = str(value or "").strip()
    return text or default


def encode_message_id(folder: str, exchange_id: str, mailbox_id: str | None = None) -> str:
    normalized_mailbox_id = normalize_text(mailbox_id)
    if normalized_mailbox_id:
        raw = f"v2::{normalized_mailbox_id}::{normalize_text(folder, 'inbox')}::{normalize_text(exchange_id)}"
    else:
        raw = f"{normalize_text(folder, 'inbox')}::{normalize_text(exchange_id)}"
    return base64.urlsafe_b64encode(raw.encode("utf-8")).decode("utf-8").rstrip("=")


def decode_message_ref(token: str) -> tuple[str, str, str]:
    value = normalize_text(token)
    if not value:
        raise MailReferenceError("Message id is required")
    padded = value + "=" * ((4 - len(value) % 4) % 4)
    try:
        raw = base64.urlsafe_b64decode(padded.encode("utf-8")).decode("utf-8")
    except Exception as exc:
        raise MailReferenceError("Invalid message id") from exc
    mailbox_id = ""
    if raw.startswith("v2::"):
        parts = raw.split("::", 3)
        if len(parts) != 4:
            raise MailReferenceError("Invalid message id payload")
        _, mailbox_id, folder, exchange_id = parts
    else:
        if "::" not in raw:
            raise MailReferenceError("Invalid message id payload")
        folder, exchange_id = raw.split("::", 1)
    if not exchange_id:
        raise MailReferenceError("Invalid message id payload")
    return normalize_text(folder, "inbox").lower(), exchange_id, normalize_text(mailbox_id)


def decode_message_id(token: str) -> tuple[str, str]:
    folder, exchange_id, _mailbox_id = decode_message_ref(token)
    return folder, exchange_id


def encode_folder_id(scope: str, exchange_id: str) -> str:
    raw = f"{normalize_text(scope, 'mailbox')}::{normalize_text(exchange_id)}"
    return base64.urlsafe_b64encode(raw.encode("utf-8")).decode("utf-8").rstrip("=")


def decode_folder_id(token: str) -> tuple[str, str]:
    value = normalize_text(token)
    if not value:
        raise MailReferenceError("Folder id is required")
    padded = value + "=" * ((4 - len(value) % 4) % 4)
    try:
        raw = base64.urlsafe_b64decode(padded.encode("utf-8")).decode("utf-8")
    except Exception as exc:
        raise MailReferenceError("Invalid folder id") from exc
    if "::" not in raw:
        raise MailReferenceError("Invalid folder id payload")
    scope, exchange_id = raw.split("::", 1)
    if not exchange_id:
        raise MailReferenceError("Invalid folder id payload")
    return normalize_text(scope, "mailbox").lower(), exchange_id


def encode_attachment_token(attachment_id: str, mailbox_id: str | None = None) -> str:
    value = normalize_text(attachment_id)
    if not value:
        return ""
    # Exchange attachment ids are already compact base64-like strings. Re-encoding
    # them into another base64 wrapper creates very long path segments that
    # HTTP.sys rejects before the request reaches FastAPI. Keep only a minimal
    # URL-safe transform and rely on message_id/mailbox_id for mailbox scope.
    escaped = (
        value
        .replace("~", "~~")
        .replace("-", "~d")
        .replace("_", "~u")
        .replace("+", "-")
        .replace("/", "_")
        .rstrip("=")
    )
    return f"{ATTACHMENT_TOKEN_PREFIX}{escaped}"


def decode_attachment_ref(token: str) -> tuple[str, str]:
    value = normalize_text(token)
    if not value:
        raise MailReferenceError("Attachment token is required")
    if value.startswith(ATTACHMENT_TOKEN_PREFIX):
        encoded_part = value[len(ATTACHMENT_TOKEN_PREFIX):]
        if not encoded_part:
            raise MailReferenceError("Attachment token payload is empty")
        decoded_chars: list[str] = []
        index = 0
        while index < len(encoded_part):
            current = encoded_part[index]
            if current == "~":
                if index + 1 >= len(encoded_part):
                    raise MailReferenceError("Attachment token payload is invalid")
                marker = encoded_part[index + 1]
                if marker == "~":
                    decoded_chars.append("~")
                elif marker == "d":
                    decoded_chars.append("-")
                elif marker == "u":
                    decoded_chars.append("_")
                else:
                    raise MailReferenceError("Attachment token payload is invalid")
                index += 2
                continue
            if current == "-":
                decoded_chars.append("+")
            elif current == "_":
                decoded_chars.append("/")
            else:
                decoded_chars.append(current)
            index += 1
        normalized_attachment_id = normalize_text("".join(decoded_chars))
        if not normalized_attachment_id:
            raise MailReferenceError("Attachment token payload is invalid")
        if re.fullmatch(r"[A-Za-z0-9+/]+", normalized_attachment_id or "") and (len(normalized_attachment_id) % 4):
            normalized_attachment_id = normalized_attachment_id + "=" * ((4 - len(normalized_attachment_id) % 4) % 4)
        return "", normalized_attachment_id
    if not value.startswith(ATTACHMENT_TOKEN_PREFIX_LEGACY):
        raise MailReferenceError("Attachment token format is invalid")
    encoded_part = value[len(ATTACHMENT_TOKEN_PREFIX_LEGACY):]
    if not encoded_part:
        raise MailReferenceError("Attachment token payload is empty")
    padded = encoded_part + "=" * ((4 - len(encoded_part) % 4) % 4)
    try:
        raw = base64.urlsafe_b64decode(padded.encode("utf-8")).decode("utf-8")
    except Exception as exc:
        raise MailReferenceError("Attachment token payload is invalid") from exc
    normalized_raw = normalize_text(raw)
    if not normalized_raw:
        raise MailReferenceError("Attachment token payload is invalid")
    if normalized_raw.startswith("v2::"):
        parts = normalized_raw.split("::", 2)
        if len(parts) != 3:
            raise MailReferenceError("Attachment token payload is invalid")
        _, mailbox_id, attachment_id = parts
        resolved_attachment_id = normalize_text(attachment_id)
        if not resolved_attachment_id:
            raise MailReferenceError("Attachment token payload is invalid")
        return normalize_text(mailbox_id), resolved_attachment_id
    return "", normalized_raw


def decode_attachment_token(token: str) -> str:
    _mailbox_id, attachment_id = decode_attachment_ref(token)
    return attachment_id


def resolve_mailbox_scope(*scopes: str | None) -> str:
    for value in scopes:
        normalized = normalize_text(value)
        if normalized:
            return normalized
    return ""


def make_scoped_storage_key(*, mailbox_id: str | None = None, value: str) -> str:
    normalized_value = normalize_text(value)
    normalized_mailbox_id = normalize_text(mailbox_id)
    if not normalized_value:
        return ""
    if not normalized_mailbox_id:
        return normalized_value
    return f"{normalized_mailbox_id}::{normalized_value}"


def split_scoped_storage_key(value: str) -> tuple[str, str]:
    normalized = normalize_text(value)
    if "::" not in normalized:
        return "", normalized
    mailbox_id, payload = normalized.split("::", 1)
    return normalize_text(mailbox_id), normalize_text(payload)


def normalize_attachment_id_candidate(value: Any) -> str:
    if value is None:
        return ""
    if isinstance(value, bytes):
        try:
            value = value.decode("utf-8", errors="ignore")
        except Exception:
            value = str(value)
    if not isinstance(value, (str, int, float)):
        return ""
    normalized = normalize_text(value)
    if not normalized or normalized.lower() in {"none", "null"}:
        return ""
    if normalized.startswith("<") and normalized.endswith(">"):
        return ""
    return normalized


def extract_attachment_id_from_repr(value: Any) -> str:
    raw = normalize_text(value)
    if not raw:
        return ""
    for pattern in (
        r"(?:^|[({,\s])id=['\"]([^'\"]+)['\"]",
        r"(?:^|[({,\s])attachment_id=['\"]([^'\"]+)['\"]",
    ):
        match = re.search(pattern, raw)
        if match and normalize_text(match.group(1)):
            return normalize_text(match.group(1))
    if "<" not in raw and ">" not in raw and not any(ch.isspace() for ch in raw):
        return raw
    return ""


def extract_attachment_raw_id(attachment: Any) -> str:
    attachment_id = getattr(attachment, "attachment_id", None)
    item_id = getattr(attachment, "item_id", None)
    for candidate in (
        getattr(attachment_id, "id", None),
        getattr(attachment_id, "attachment_id", None),
        getattr(attachment_id, "value", None),
        getattr(attachment, "id", None),
        getattr(item_id, "id", None),
        getattr(item_id, "item_id", None),
        attachment_id if isinstance(attachment_id, (str, int, float, bytes)) else None,
    ):
        normalized = normalize_attachment_id_candidate(candidate)
        if normalized:
            return normalized
    for candidate in (attachment_id, item_id, attachment):
        normalized = extract_attachment_id_from_repr(candidate)
        if normalized:
            return normalized
    return ""


def normalize_attachment_content_id(value: Any) -> str:
    normalized = normalize_text(value)
    if normalized.lower().startswith("cid:"):
        normalized = normalized[4:]
    normalized = normalized.strip().strip("<>").strip()
    return normalized.lower()


def build_inline_attachment_src(*, message_id: str, attachment_ref: str) -> str | None:
    safe_message_id = normalize_text(message_id)
    safe_attachment_ref = normalize_text(attachment_ref)
    if not safe_message_id or not safe_attachment_ref:
        return None
    quoted_message_id = quote(safe_message_id, safe="")
    quoted_attachment_ref = quote(safe_attachment_ref, safe="")
    return f"/api/v1/mail/messages/{quoted_message_id}/attachments/{quoted_attachment_ref}?disposition=inline"
