"""Chat attachment payloads, paths and media variants."""
from __future__ import annotations

import gzip
import io
import logging
from datetime import datetime, timezone
from pathlib import Path
from typing import Any, Callable, Optional
from uuid import uuid4

from PIL import Image, ImageDraw, ImageOps, UnidentifiedImageError
from sqlalchemy import and_, or_

from backend.chat.models import ChatMessageAttachment


_VARIANT_MAX_DIMENSIONS = {
    "thumb": 320,
    "preview": 1280,
}


def _normalize_text(value: object, default: str = "") -> str:
    text = str(value or "").strip()
    return text or default


def _iso(value: Optional[datetime]) -> Optional[str]:
    if value is None:
        return None
    if value.tzinfo is None:
        value = value.replace(tzinfo=timezone.utc)
    return value.astimezone(timezone.utc).isoformat()


class ChatAttachmentMedia:
    def __init__(self, *, attachments_root: Callable[[], Path], logger: logging.Logger | None = None) -> None:
        self._attachments_root = attachments_root
        self._logger = logger or logging.getLogger("backend.chat.attachment_media")

    @staticmethod
    def build_variant_url(*, message_id: str, attachment_id: str, variant: str) -> str:
        return (
            f"/api/v1/chat/messages/{message_id}/attachments/{attachment_id}/file"
            f"?inline=1&variant={variant}"
        )

    def build_variant_urls(self, attachment: ChatMessageAttachment) -> dict[str, str]:
        mime_type = _normalize_text(getattr(attachment, "mime_type", None)).lower()
        message_id = _normalize_text(getattr(attachment, "message_id", None))
        attachment_id = _normalize_text(getattr(attachment, "id", None))
        if not message_id or not attachment_id:
            return {}
        if mime_type.startswith("image/"):
            return {
                "thumb": self.build_variant_url(
                    message_id=message_id,
                    attachment_id=attachment_id,
                    variant="thumb",
                ),
                "preview": self.build_variant_url(
                    message_id=message_id,
                    attachment_id=attachment_id,
                    variant="preview",
                ),
            }
        if mime_type.startswith("video/"):
            return {
                "poster": self.build_variant_url(
                    message_id=message_id,
                    attachment_id=attachment_id,
                    variant="poster",
                ),
            }
        return {}

    def resolve_variant_path(self, *, conversation_id: str, attachment_id: str, variant: str) -> Path:
        root = self._attachments_root().resolve()
        variants_dir = (root / _normalize_text(conversation_id) / ".variants").resolve()
        variants_dir.mkdir(parents=True, exist_ok=True)
        file_path = (variants_dir / f"{Path(_normalize_text(attachment_id)).name}-{_normalize_text(variant)}.png").resolve()
        try:
            file_path.relative_to(root)
        except ValueError as exc:
            raise ValueError("Invalid attachment variant path") from exc
        return file_path

    def ensure_image_variant(
        self,
        *,
        conversation_id: str,
        attachment: ChatMessageAttachment,
        source_path: Path,
        variant: str,
    ) -> dict[str, str]:
        max_dimension = int(_VARIANT_MAX_DIMENSIONS.get(variant, _VARIANT_MAX_DIMENSIONS["preview"]))
        variant_path = self.resolve_variant_path(
            conversation_id=conversation_id,
            attachment_id=attachment.id,
            variant=variant,
        )
        if variant_path.exists() and variant_path.is_file():
            self._logger.info("chat.media_variant attachment_id=%s variant=%s hit=1", attachment.id, variant)
            return {
                "path": str(variant_path),
                "file_name": variant_path.name,
                "mime_type": "image/png",
            }

        try:
            with Image.open(source_path) as image:
                image = ImageOps.exif_transpose(image)
                resample = getattr(Image, "Resampling", Image).LANCZOS
                image.thumbnail((max_dimension, max_dimension), resample)
                if image.mode not in {"RGB", "RGBA"}:
                    image = image.convert("RGBA" if "A" in image.getbands() else "RGB")
                image.save(variant_path, format="PNG", optimize=True)
            self._logger.info("chat.media_variant attachment_id=%s variant=%s hit=0 created", attachment.id, variant)
            return {
                "path": str(variant_path),
                "file_name": variant_path.name,
                "mime_type": "image/png",
            }
        except Exception as exc:
            self._logger.error(
                "chat.media_variant_error attachment_id=%s variant=%s conversation_id=%s error=%s",
                attachment.id,
                variant,
                conversation_id,
                str(exc),
                exc_info=True,
            )
            try:
                if variant_path.exists():
                    variant_path.unlink()
            except Exception:
                pass
            raise

    def ensure_video_poster_variant(
        self,
        *,
        conversation_id: str,
        attachment: ChatMessageAttachment,
    ) -> dict[str, str]:
        variant = "poster"
        variant_path = self.resolve_variant_path(
            conversation_id=conversation_id,
            attachment_id=attachment.id,
            variant=variant,
        )
        if variant_path.exists() and variant_path.is_file():
            self._logger.info("chat.media_variant attachment_id=%s variant=%s hit=1", attachment.id, variant)
            return {
                "path": str(variant_path),
                "file_name": variant_path.name,
                "mime_type": "image/png",
            }

        width = max(320, int(getattr(attachment, "width", 0) or 0) or 720)
        height = max(180, int(getattr(attachment, "height", 0) or 0) or int(round(width * 9 / 16)))
        canvas = Image.new("RGBA", (width, height), "#0f172a")
        draw = ImageDraw.Draw(canvas)
        draw.rounded_rectangle((0, 0, width, height), radius=max(18, width // 18), fill="#0f172a")
        draw.rounded_rectangle(
            (max(12, width // 28), max(12, height // 28), width - max(12, width // 28), height - max(12, height // 28)),
            radius=max(14, width // 22),
            outline="#475569",
            width=max(2, width // 240),
        )
        triangle_width = max(44, width // 7)
        triangle_height = max(52, height // 5)
        center_x = width // 2
        center_y = height // 2
        draw.polygon(
            [
                (center_x - triangle_width // 3, center_y - triangle_height // 2),
                (center_x - triangle_width // 3, center_y + triangle_height // 2),
                (center_x + triangle_width // 2, center_y),
            ],
            fill="#e2e8f0",
        )
        canvas.save(variant_path, format="PNG", optimize=True)
        self._logger.info("chat.media_variant attachment_id=%s variant=%s hit=0", attachment.id, variant)
        return {
            "path": str(variant_path),
            "file_name": variant_path.name,
            "mime_type": "image/png",
        }

    def to_payload(self, attachment: ChatMessageAttachment) -> dict:
        return {
            "id": attachment.id,
            "file_name": attachment.file_name,
            "mime_type": _normalize_text(attachment.mime_type) or None,
            "file_size": int(attachment.file_size or 0),
            "width": int(attachment.width) if attachment.width is not None else None,
            "height": int(attachment.height) if attachment.height is not None else None,
            "variant_urls": self.build_variant_urls(attachment),
            "created_at": _iso(attachment.created_at) or "",
        }

    @staticmethod
    def get_kind(mime_type: object) -> str:
        normalized_mime_type = _normalize_text(mime_type).lower()
        if normalized_mime_type.startswith("image/"):
            return "image"
        if normalized_mime_type.startswith("video/"):
            return "video"
        if normalized_mime_type.startswith("audio/"):
            return "audio"
        return "file"

    @staticmethod
    def normalize_kind_filter(value: object) -> str:
        normalized = _normalize_text(value).lower()
        if normalized in {"image", "video", "file", "audio"}:
            return normalized
        raise ValueError("Attachment kind must be one of: image, video, file, audio")

    @staticmethod
    def apply_kind_filter(*, query, kind: str):
        if kind == "image":
            return query.where(ChatMessageAttachment.mime_type.like("image/%"))
        if kind == "video":
            return query.where(ChatMessageAttachment.mime_type.like("video/%"))
        if kind == "audio":
            return query.where(ChatMessageAttachment.mime_type.like("audio/%"))
        return query.where(
            or_(
                ChatMessageAttachment.mime_type.is_(None),
                and_(
                    ChatMessageAttachment.mime_type.not_like("image/%"),
                    ChatMessageAttachment.mime_type.not_like("video/%"),
                    ChatMessageAttachment.mime_type.not_like("audio/%"),
                ),
            )
        )

    def conversation_to_payload(self, attachment: ChatMessageAttachment, *, kind: Optional[str] = None) -> dict:
        resolved_kind = kind or self.get_kind(attachment.mime_type)
        return {
            "id": attachment.id,
            "message_id": attachment.message_id,
            "kind": resolved_kind,
            "file_name": attachment.file_name,
            "mime_type": _normalize_text(attachment.mime_type) or None,
            "file_size": int(attachment.file_size or 0),
            "width": int(attachment.width) if attachment.width is not None else None,
            "height": int(attachment.height) if attachment.height is not None else None,
            "variant_urls": self.build_variant_urls(attachment),
            "created_at": _iso(attachment.created_at) or "",
        }

    def resolve_path(self, *, conversation_id: str, storage_name: str) -> Path:
        root = self._attachments_root().resolve()
        file_path = (root / _normalize_text(conversation_id) / Path(_normalize_text(storage_name)).name).resolve()
        try:
            file_path.relative_to(root)
        except ValueError as exc:
            raise ValueError("Invalid attachment path") from exc
        return file_path

    def repair_gzipped_image_if_needed(
        self,
        *,
        session,
        conversation_id: str,
        attachment: ChatMessageAttachment,
        file_path: Path,
    ) -> Path:
        mime_type = _normalize_text(getattr(attachment, "mime_type", None)).lower()
        if not mime_type.startswith("image/"):
            return file_path
        if not file_path.exists() or not file_path.is_file():
            return file_path

        try:
            with file_path.open("rb") as source:
                header = source.read(3)
        except OSError:
            return file_path

        if header != b"\x1f\x8b\x08":
            return file_path

        temp_path = file_path.with_name(f"{file_path.name}.{uuid4().hex}.repair")
        try:
            compressed_payload = file_path.read_bytes()
            decoded_payload = gzip.decompress(compressed_payload)
            with Image.open(io.BytesIO(decoded_payload)) as image:
                validated_image = ImageOps.exif_transpose(image)
                try:
                    validated_image.load()
                    width = int(validated_image.size[0])
                    height = int(validated_image.size[1])
                finally:
                    if validated_image is not image:
                        validated_image.close()

            with temp_path.open("wb") as target:
                target.write(decoded_payload)
            temp_path.replace(file_path)

            attachment.file_size = len(decoded_payload)
            attachment.width = width if width > 0 else None
            attachment.height = height if height > 0 else None
            session.add(attachment)
            self._logger.warning(
                "chat.attachment_storage_repaired attachment_id=%s conversation_id=%s bytes=%d width=%s height=%s",
                attachment.id,
                conversation_id,
                len(decoded_payload),
                attachment.width,
                attachment.height,
            )
        except (OSError, EOFError, gzip.BadGzipFile, UnidentifiedImageError):
            self._logger.exception(
                "chat.attachment_storage_repair_failed attachment_id=%s conversation_id=%s",
                getattr(attachment, "id", ""),
                conversation_id,
            )
            try:
                temp_path.unlink(missing_ok=True)
            except Exception:
                pass
        return file_path
