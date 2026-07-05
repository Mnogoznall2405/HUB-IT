"""Pure formatting and normalization helpers for chat."""
from __future__ import annotations

import re
import struct
from datetime import datetime, timezone
from pathlib import Path
from typing import Optional

from backend.chat.chat_constants import CHAT_GROUP_ROLES
from backend.chat.utils import normalize_text as _normalize_text

_MARKDOWN_TABLE_SEPARATOR_RE = re.compile(r"^\s*\|?\s*:?-{3,}:?\s*(?:\|\s*:?-{3,}:?\s*)+\|?\s*$")


def _utc_now() -> datetime:
    return datetime.now(timezone.utc)


def _normalize_body_format(value: object, default: str = "plain") -> str:
    normalized = _normalize_text(value).lower() or default
    return normalized if normalized in {"plain", "markdown"} else "plain"


def _normalize_member_role(value: object) -> str:
    normalized = _normalize_text(value).lower()
    return normalized if normalized in CHAT_GROUP_ROLES else "member"


def _display_user_name(user: Optional[dict]) -> str:
    payload = user or {}
    return (
        _normalize_text(payload.get("full_name"))
        or _normalize_text(payload.get("username"))
        or f"user-{int(payload.get('id', 0) or 0)}"
    )


def _normalize_mention_handle(value: object) -> str:
    return _normalize_text(value).lstrip("@").lower()


def _mention_handle_from_person_name(value: object) -> str:
    return re.sub(r"[^0-9A-Za-zА-Яа-яЁё_.-]+", "", _normalize_text(value).replace(" ", "_")).lower()


def _strip_markdown_preview(value: object) -> str:
    text = _normalize_text(value)
    if not text:
        return ""
    cleaned_lines: list[str] = []
    in_fence = False
    for raw_line in text.replace("\r\n", "\n").split("\n"):
        line = raw_line.strip()
        if not line:
            continue
        if re.match(r"^(?:```|~~~)", line):
            in_fence = not in_fence
            continue
        if _MARKDOWN_TABLE_SEPARATOR_RE.match(line):
            continue
        if line.startswith("|") and line.endswith("|"):
            cells = [cell.strip() for cell in line.split("|") if cell.strip()]
            line = " | ".join(cells)
        line = re.sub(r"^\s{0,3}#{1,6}\s+", "", line)
        line = re.sub(r"^\s{0,3}>\s?", "", line)
        line = re.sub(r"^\s{0,3}- \[[ xX]\]\s+", "", line)
        line = re.sub(r"^\s{0,3}(?:[-*+]\s+|\d+[.)]\s+)", "", line)
        line = re.sub(r"\[([^\]\n]+)\]\([^)]+\)", r"\1", line)
        line = re.sub(r"(\*\*|__)(.*?)\1", r"\2", line)
        line = re.sub(r"`([^`]+)`", r"\1", line)
        line = re.sub(r"[*_~]{1,3}", "", line)
        line = re.sub(r"\s+", " ", line).strip()
        if line:
            cleaned_lines.append(line)
        if not in_fence and len(cleaned_lines) >= 3:
            break
    return " ".join(cleaned_lines).strip()


def _iso(value: Optional[datetime]) -> Optional[str]:
    if value is None:
        return None
    if value.tzinfo is None:
        value = value.replace(tzinfo=timezone.utc)
    return value.astimezone(timezone.utc).isoformat()


def _direct_key(user_a: int, user_b: int) -> str:
    first, second = sorted((int(user_a), int(user_b)))
    return f"{first}:{second}"


def _notes_key(user_id: int) -> str:
    return f"notes:{int(user_id)}"


def _safe_file_name(value: object) -> str:
    raw = Path(str(value or "file.bin")).name.strip() or "file.bin"
    sanitized = re.sub(r"[^\w.() \-]", "_", raw, flags=re.UNICODE).strip(" .")
    return sanitized or "file.bin"


def _truncate_text(value: object, limit: int = 160) -> str:
    text = _normalize_text(value)
    return text if len(text) <= limit else f"{text[: max(0, limit - 3)].rstrip()}..."


def _parse_dt(value: object) -> Optional[datetime]:
    text = _normalize_text(value)
    if not text:
        return None
    try:
        parsed = datetime.fromisoformat(text)
    except ValueError:
        return None
    if parsed.tzinfo is None:
        parsed = parsed.replace(tzinfo=timezone.utc)
    return parsed.astimezone(timezone.utc)


def _probe_image_dimensions(payload: bytes, mime_type: object) -> tuple[int | None, int | None]:
    normalized_mime_type = _normalize_text(mime_type).lower()
    if not normalized_mime_type.startswith("image/") or not payload:
        return None, None

    try:
        if payload.startswith(b"\x89PNG\r\n\x1a\n") and len(payload) >= 24:
            width, height = struct.unpack(">II", payload[16:24])
            return int(width), int(height)

        if payload[:6] in {b"GIF87a", b"GIF89a"} and len(payload) >= 10:
            width, height = struct.unpack("<HH", payload[6:10])
            return int(width), int(height)

        if payload.startswith(b"BM") and len(payload) >= 26:
            width = int.from_bytes(payload[18:22], "little", signed=True)
            height = abs(int.from_bytes(payload[22:26], "little", signed=True))
            if width > 0 and height > 0:
                return width, height

        if payload.startswith(b"RIFF") and payload[8:12] == b"WEBP" and len(payload) >= 30:
            chunk_type = payload[12:16]
            if chunk_type == b"VP8X" and len(payload) >= 30:
                width = 1 + int.from_bytes(payload[24:27], "little")
                height = 1 + int.from_bytes(payload[27:30], "little")
                return int(width), int(height)
            if chunk_type == b"VP8L" and len(payload) >= 25:
                bits = int.from_bytes(payload[21:25], "little")
                width = (bits & 0x3FFF) + 1
                height = ((bits >> 14) & 0x3FFF) + 1
                return int(width), int(height)
            if chunk_type == b"VP8 " and len(payload) >= 30:
                width = int.from_bytes(payload[26:28], "little")
                height = int.from_bytes(payload[28:30], "little")
                return int(width), int(height)

        if payload.startswith(b"\xff\xd8"):
            offset = 2
            payload_length = len(payload)
            while offset + 9 < payload_length:
                if payload[offset] != 0xFF:
                    offset += 1
                    continue
                marker = payload[offset + 1]
                offset += 2
                if marker in {0xD8, 0xD9}:
                    continue
                if offset + 2 > payload_length:
                    break
                segment_length = int.from_bytes(payload[offset:offset + 2], "big")
                if segment_length < 2 or offset + segment_length > payload_length:
                    break
                if marker in {
                    0xC0, 0xC1, 0xC2, 0xC3,
                    0xC5, 0xC6, 0xC7,
                    0xC9, 0xCA, 0xCB,
                    0xCD, 0xCE, 0xCF,
                } and offset + 7 <= payload_length:
                    height = int.from_bytes(payload[offset + 3:offset + 5], "big")
                    width = int.from_bytes(payload[offset + 5:offset + 7], "big")
                    return int(width), int(height)
                offset += segment_length
    except Exception:
        return None, None

    return None, None


def _probe_video_dimensions(file_path: Path, mime_type: object) -> tuple[int | None, int | None]:
    normalized_mime_type = _normalize_text(mime_type).lower()
    if not normalized_mime_type.startswith("video/"):
        return None, None
    try:
        import cv2
        cap = cv2.VideoCapture(str(file_path))
        if cap.isOpened():
            width = int(cap.get(cv2.CAP_PROP_FRAME_WIDTH))
            height = int(cap.get(cv2.CAP_PROP_FRAME_HEIGHT))
            cap.release()
            if width > 0 and height > 0:
                return width, height
        else:
            cap.release()
    except Exception:
        pass
    return None, None
