"""
Pure IT mail template rules used by MailService.

This module has no database or Exchange dependencies, so template validation and
rendering can be tested without booting the mail runtime.
"""
from __future__ import annotations

from dataclasses import dataclass
from typing import Any
import re


TEMPLATE_FIELD_TYPES = {"text", "textarea", "select", "multiselect", "date", "checkbox", "email", "tel"}


class TemplateValidationError(ValueError):
    """Template field or value payload is invalid."""


class AttachmentLimitError(ValueError):
    """Attachment payload violates configured file limits."""


@dataclass(frozen=True)
class AttachmentLimits:
    max_files: int
    max_file_size: int
    max_total_size: int


def normalize_text(value: Any, default: str = "") -> str:
    text = str(value or "").strip()
    return text or default


def normalize_field_options(value: Any) -> list[str]:
    if value is None:
        return []
    raw_options: list[Any]
    if isinstance(value, str):
        raw_options = [part for part in re.split(r"[;\n]+", value) if normalize_text(part)]
    elif isinstance(value, list):
        raw_options = value
    else:
        raise TemplateValidationError("Template field options must be an array or string")

    normalized: list[str] = []
    seen: set[str] = set()
    for item in raw_options:
        if isinstance(item, dict):
            option_value = normalize_text(item.get("value") or item.get("label"))
        else:
            option_value = normalize_text(item)
        if not option_value or option_value in seen:
            continue
        seen.add(option_value)
        normalized.append(option_value)
    return normalized


def normalize_template_field(raw_field: Any, index: int = 0) -> dict[str, Any]:
    if not isinstance(raw_field, dict):
        raise TemplateValidationError("Each template field must be an object")
    key = normalize_text(raw_field.get("key")).lower()
    key = re.sub(r"[^a-z0-9_.-]", "_", key)
    key = re.sub(r"_+", "_", key).strip("_")
    if not key:
        raise TemplateValidationError("Template field key is required")

    field_type = normalize_text(raw_field.get("type"), "text").lower()
    if field_type not in TEMPLATE_FIELD_TYPES:
        raise TemplateValidationError(f"Unsupported template field type: {field_type}")

    label = normalize_text(raw_field.get("label"), key)
    default_value = raw_field.get("default_value")
    required = bool(raw_field.get("required", True))
    try:
        order = int(raw_field.get("order", index))
    except Exception:
        order = index
    options = normalize_field_options(raw_field.get("options"))
    if field_type in {"select", "multiselect"} and not options:
        raise TemplateValidationError(f"Field '{key}' requires non-empty options")
    if field_type not in {"select", "multiselect"}:
        options = []

    if field_type == "checkbox":
        default_normalized: Any = bool(default_value)
    elif field_type == "multiselect":
        if isinstance(default_value, list):
            default_normalized = [item for item in normalize_field_options(default_value) if item in options]
        else:
            default_normalized = []
    else:
        default_normalized = normalize_text(default_value)

    return {
        "key": key,
        "label": label,
        "type": field_type,
        "required": required,
        "placeholder": normalize_text(raw_field.get("placeholder")),
        "help_text": normalize_text(raw_field.get("help_text")),
        "default_value": default_normalized,
        "options": options,
        "order": order,
    }


def normalize_template_fields(raw_fields: Any) -> list[dict[str, Any]]:
    if not isinstance(raw_fields, list):
        raise TemplateValidationError("Template fields must be an array")
    normalized = [normalize_template_field(item, idx) for idx, item in enumerate(raw_fields)]
    normalized.sort(key=lambda item: int(item.get("order", 0)))
    return normalized


def value_to_template_string(value: Any) -> str:
    if isinstance(value, list):
        return ", ".join(normalize_text(item) for item in value if normalize_text(item))
    if isinstance(value, bool):
        return "Да" if value else "Нет"
    return normalize_text(value)


def render_template(text: str, values: dict[str, Any]) -> str:
    source = normalize_text(text)

    def _replace(match: re.Match[str]) -> str:
        key = normalize_text(match.group(1))
        return value_to_template_string(values.get(key))

    return re.sub(r"\{\{\s*([A-Za-z0-9_.-]+)\s*\}\}", _replace, source)


def coerce_field_value(field: dict[str, Any], raw_value: Any) -> Any:
    field_type = normalize_text(field.get("type"), "text").lower()
    options = field.get("options") if isinstance(field.get("options"), list) else []
    default_value = field.get("default_value")
    value = raw_value if raw_value is not None else default_value

    if field_type == "checkbox":
        if isinstance(value, bool):
            return value
        return str(value).strip().lower() in {"1", "true", "yes", "on", "да"}

    if field_type == "multiselect":
        if isinstance(value, list):
            values = [normalize_text(item) for item in value]
        else:
            values = [part for part in re.split(r"[;,]+", normalize_text(value)) if normalize_text(part)]
        filtered: list[str] = []
        seen: set[str] = set()
        for item in values:
            if item in seen:
                continue
            if options and item not in options:
                continue
            seen.add(item)
            filtered.append(item)
        return filtered

    text = normalize_text(value)
    if field_type == "select":
        if not text:
            return ""
        if options and text not in options:
            raise TemplateValidationError(f"Field '{field.get('key')}' has unsupported value")
        return text
    if field_type == "email":
        if text and not re.match(r"^[^\s@]+@[^\s@]+\.[^\s@]+$", text):
            raise TemplateValidationError(f"Field '{field.get('key')}' must contain a valid email")
        return text
    if field_type == "tel":
        if text and not re.match(r"^[0-9+\-() ]{5,}$", text):
            raise TemplateValidationError(f"Field '{field.get('key')}' must contain a valid phone")
        return text
    if field_type == "date":
        if text and not re.match(r"^\d{4}-\d{2}-\d{2}$", text):
            raise TemplateValidationError(f"Field '{field.get('key')}' must be in YYYY-MM-DD format")
        return text
    return text


def validate_template_values(template_fields: list[dict[str, Any]], values: dict[str, Any]) -> dict[str, Any]:
    normalized_values: dict[str, Any] = {}
    missing: list[str] = []
    for field in template_fields:
        key = normalize_text(field.get("key"))
        if not key:
            continue
        coerced = coerce_field_value(field, values.get(key))
        normalized_values[key] = coerced

        if not bool(field.get("required", True)):
            continue
        field_type = normalize_text(field.get("type"))
        if field_type == "checkbox":
            if coerced is not True:
                missing.append(key)
            continue
        if field_type == "multiselect":
            if not isinstance(coerced, list) or len(coerced) == 0:
                missing.append(key)
            continue
        if not normalize_text(coerced):
            missing.append(key)

    if missing:
        raise TemplateValidationError(f"Missing required template fields: {', '.join(missing)}")
    return normalized_values


def validate_attachments_limits(attachments: list[tuple[str, bytes]], limits: AttachmentLimits) -> None:
    safe_attachments = attachments or []
    if len(safe_attachments) > int(limits.max_files):
        raise AttachmentLimitError(f"Too many attachments. Maximum is {int(limits.max_files)}")
    total_size = 0
    for filename, content in safe_attachments:
        size = len(content or b"")
        if size > int(limits.max_file_size):
            raise AttachmentLimitError(
                f"Attachment '{normalize_text(filename, 'attachment.bin')}' exceeds "
                f"{int(limits.max_file_size) // (1024 * 1024)}MB limit"
            )
        total_size += size
        if total_size > int(limits.max_total_size):
            raise AttachmentLimitError(
                f"Total attachment size exceeds {int(limits.max_total_size) // (1024 * 1024)}MB limit"
            )
