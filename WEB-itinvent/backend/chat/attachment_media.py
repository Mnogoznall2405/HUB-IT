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
from backend.chat.utils import normalize_text as _normalize_text


_VARIANT_MAX_DIMENSIONS = {
    "thumb": 320,
    "preview": 1280,
}



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

    @staticmethod
    def build_file_url(*, message_id: str, attachment_id: str, inline: bool = False) -> str:
        url = f"/api/v1/chat/messages/{message_id}/attachments/{attachment_id}/file"
        return f"{url}?inline=1" if inline else url

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
        source_path: Path | None = None,
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
                "mime_type": "image/jpeg",
            }

        video_path = source_path
        if video_path is None:
            video_path = (
                self._attachments_root().resolve()
                / _normalize_text(conversation_id)
                / _normalize_text(attachment.storage_name)
            )

        extracted = False
        if video_path and video_path.exists() and video_path.is_file():
            # Try ffmpeg first (better quality, faster)
            try:
                from backend.chat.video_compress import extract_poster_frame
                poster_result = extract_poster_frame(video_path, variant_path)
                if poster_result and poster_result.exists() and poster_result.stat().st_size > 0:
                    extracted = True
                    self._logger.info(
                        "chat.media_variant attachment_id=%s variant=%s hit=0 extracted via ffmpeg",
                        attachment.id, variant,
                    )
            except Exception as exc:
                self._logger.warning(
                    "chat.video_poster_ffmpeg_error attachment_id=%s error=%s",
                    attachment.id, str(exc),
                )

            # Fallback to cv2
            if not extracted:
                try:
                    import cv2
                    cap = cv2.VideoCapture(str(video_path))
                    if cap.isOpened():
                        ret, frame = cap.read()
                        if ret and frame is not None:
                            frame_h, frame_w = frame.shape[:2]
                            max_dim = 720
                            if max(frame_w, frame_h) > max_dim:
                                scale = max_dim / max(frame_w, frame_h)
                                new_w = int(frame_w * scale)
                                new_h = int(frame_h * scale)
                                frame = cv2.resize(frame, (new_w, new_h), interpolation=cv2.INTER_AREA)
                            jpeg_path = variant_path.with_suffix(".jpg")
                            cv2.imwrite(str(jpeg_path), frame, [cv2.IMWRITE_JPEG_QUALITY, 85])
                            if jpeg_path != variant_path:
                                jpeg_path.rename(variant_path)
                            extracted = True
                            self._logger.info(
                                "chat.media_variant attachment_id=%s variant=%s hit=0 extracted via cv2 %dx%d",
                                attachment.id, variant, frame_w, frame_h,
                            )
                        cap.release()
                    else:
                        cap.release()
                except Exception as exc:
                    self._logger.warning(
                        "chat.video_poster_cv2_error attachment_id=%s error=%s",
                        attachment.id, str(exc),
                    )

        if not extracted:
            width = max(320, int(getattr(attachment, "width", 0) or 0) or 720)
            height = max(180, int(getattr(attachment, "height", 0) or 0) or int(round(width * 9 / 16)))
            canvas = Image.new("RGB", (width, height), "#0f172a")
            draw = ImageDraw.Draw(canvas)
            triangle_size = max(36, min(width, height) // 6)
            cx, cy = width // 2, height // 2
            draw.polygon(
                [(cx - triangle_size // 3, cy - triangle_size // 2),
                 (cx - triangle_size // 3, cy + triangle_size // 2),
                 (cx + triangle_size // 2, cy)],
                fill="#e2e8f0",
            )
            canvas.save(variant_path, format="PNG", optimize=True)
            self._logger.info("chat.media_variant attachment_id=%s variant=%s hit=0 fallback", attachment.id, variant)

        return {
            "path": str(variant_path),
            "file_name": variant_path.name,
            "mime_type": "image/jpeg" if extracted else "image/png",
        }

    def to_payload(self, attachment: ChatMessageAttachment) -> dict:
        kind = self.get_kind(attachment.mime_type, getattr(attachment, "media_kind", None))
        message_id = _normalize_text(getattr(attachment, "message_id", None))
        attachment_id = _normalize_text(getattr(attachment, "id", None))
        return {
            "id": attachment.id,
            "kind": kind,
            "file_name": attachment.file_name,
            "mime_type": _normalize_text(attachment.mime_type) or None,
            "media_kind": _normalize_text(getattr(attachment, "media_kind", None)) or None,
            "file_size": int(attachment.file_size or 0),
            "width": int(attachment.width) if attachment.width is not None else None,
            "height": int(attachment.height) if attachment.height is not None else None,
            "duration_seconds": int(attachment.duration_seconds) if getattr(attachment, "duration_seconds", None) is not None else None,
            "original_url": self.build_file_url(message_id=message_id, attachment_id=attachment_id, inline=True) if message_id and attachment_id else None,
            "download_url": self.build_file_url(message_id=message_id, attachment_id=attachment_id) if message_id and attachment_id else None,
            "variant_urls": self.build_variant_urls(attachment),
            "created_at": _iso(attachment.created_at) or "",
        }

    @staticmethod
    def get_kind(mime_type: object, media_kind: object = None) -> str:
        normalized_media_kind = _normalize_text(media_kind).lower()
        if normalized_media_kind in {"image", "video", "audio", "file"}:
            return normalized_media_kind
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
            return query.where(or_(ChatMessageAttachment.media_kind == "image", ChatMessageAttachment.mime_type.like("image/%")))
        if kind == "video":
            return query.where(or_(ChatMessageAttachment.media_kind == "video", ChatMessageAttachment.mime_type.like("video/%")))
        if kind == "audio":
            return query.where(or_(ChatMessageAttachment.media_kind == "audio", ChatMessageAttachment.mime_type.like("audio/%")))
        return query.where(
            or_(
                ChatMessageAttachment.media_kind == "file",
                and_(
                    or_(ChatMessageAttachment.media_kind.is_(None), ChatMessageAttachment.media_kind.notin_(["image", "video", "audio"])),
                    or_(
                        ChatMessageAttachment.mime_type.is_(None),
                        and_(
                            ChatMessageAttachment.mime_type.not_like("image/%"),
                            ChatMessageAttachment.mime_type.not_like("video/%"),
                            ChatMessageAttachment.mime_type.not_like("audio/%"),
                        ),
                    ),
                ),
            )
        )

    def conversation_to_payload(self, attachment: ChatMessageAttachment, *, kind: Optional[str] = None) -> dict:
        resolved_kind = kind or self.get_kind(attachment.mime_type, getattr(attachment, "media_kind", None))
        message_id = _normalize_text(getattr(attachment, "message_id", None))
        attachment_id = _normalize_text(getattr(attachment, "id", None))
        return {
            "id": attachment.id,
            "message_id": attachment.message_id,
            "kind": resolved_kind,
            "file_name": attachment.file_name,
            "mime_type": _normalize_text(attachment.mime_type) or None,
            "media_kind": _normalize_text(getattr(attachment, "media_kind", None)) or None,
            "file_size": int(attachment.file_size or 0),
            "width": int(attachment.width) if attachment.width is not None else None,
            "height": int(attachment.height) if attachment.height is not None else None,
            "duration_seconds": int(attachment.duration_seconds) if getattr(attachment, "duration_seconds", None) is not None else None,
            "original_url": self.build_file_url(message_id=message_id, attachment_id=attachment_id, inline=True) if message_id and attachment_id else None,
            "download_url": self.build_file_url(message_id=message_id, attachment_id=attachment_id) if message_id and attachment_id else None,
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
