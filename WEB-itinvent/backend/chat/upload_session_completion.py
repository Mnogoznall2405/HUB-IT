"""Materialize completed upload-session files into chat attachments."""
from __future__ import annotations

from contextlib import contextmanager
from pathlib import Path
from typing import Any, Callable, Iterator

from backend.chat.upload_session_transfer import validate_upload_session_file_complete
from backend.chat.utils import normalize_text as _normalize_text


def _duration_seconds_or_none(value: object) -> int | None:
    text = _normalize_text(value)
    if not text:
        return None
    try:
        return int(float(text))
    except (TypeError, ValueError):
        return None


class UploadSessionCompletionMaterializer:
    """Owns filesystem materialization for completed upload-session files."""

    def __init__(
        self,
        *,
        attachments_root: Callable[[], Path],
        part_path: Callable[[str, str], Path],
        normalize_transfer_encoding: Callable[[object], str],
        write_decoded_transfer_payload: Callable[..., tuple[int, bytes, int]],
        probe_image_dimensions: Callable[[bytes, str], tuple[int | None, int | None]],
    ) -> None:
        self._attachments_root = attachments_root
        self._part_path = part_path
        self._normalize_transfer_encoding = normalize_transfer_encoding
        self._write_decoded_transfer_payload = write_decoded_transfer_payload
        self._probe_image_dimensions = probe_image_dimensions

    @contextmanager
    def materialize(self, manifest: dict[str, Any]) -> Iterator[list[dict[str, Any]]]:
        prepared = self._materialize(manifest)
        committed = False
        try:
            yield prepared
            committed = True
        finally:
            if not committed:
                self.cleanup_prepared_files(prepared)

    @staticmethod
    def cleanup_prepared_files(prepared: list[dict[str, Any]]) -> None:
        for item in list(prepared or []):
            path = item.get("path") if isinstance(item, dict) else None
            if not isinstance(path, Path):
                continue
            try:
                path.unlink(missing_ok=True)
            except Exception:
                pass

    def _materialize(self, manifest: dict[str, Any]) -> list[dict[str, Any]]:
        session_id = _normalize_text(manifest.get("session_id"))
        conversation_id = _normalize_text(manifest.get("conversation_id"))
        if not session_id:
            raise ValueError("session_id is required")
        if not conversation_id:
            raise ValueError("conversation_id is required")

        conversation_dir = self._attachments_root() / conversation_id
        conversation_dir.mkdir(parents=True, exist_ok=True)
        prepared: list[dict[str, Any]] = []
        moved_paths: list[Path] = []
        total_decoded_size = 0
        try:
            for file_payload in list(manifest.get("files") or []):
                if not isinstance(file_payload, dict):
                    continue
                validate_upload_session_file_complete(file_payload)
                expected_size = int(file_payload.get("size", 0) or 0)
                original_size = int(file_payload.get("original_size", 0) or 0)
                transfer_encoding = self._normalize_transfer_encoding(file_payload.get("transfer_encoding"))
                file_id = _normalize_text(file_payload.get("file_id"))
                if not file_id:
                    raise ValueError("Upload session file is missing file_id")

                part_path = self._part_path(session_id, file_id)
                if not part_path.exists() or not part_path.is_file():
                    raise ValueError("Upload session file is missing")
                if int(part_path.stat().st_size) != expected_size:
                    raise ValueError("Upload session file size mismatch")

                storage_name = _normalize_text(file_payload.get("storage_name"))
                if not storage_name:
                    raise ValueError("Upload session file is missing storage_name")
                final_path = conversation_dir / Path(storage_name).name
                if final_path.exists():
                    final_path.unlink(missing_ok=True)

                try:
                    with part_path.open("rb") as source:
                        file_size, probe_bytes, total_decoded_size = self._write_decoded_transfer_payload(
                            source_stream=source,
                            target_path=final_path,
                            transfer_encoding=transfer_encoding,
                            expected_original_size=original_size,
                            total_size=total_decoded_size,
                        )
                except Exception:
                    final_path.unlink(missing_ok=True)
                    raise

                mime_type = _normalize_text(file_payload.get("mime_type"))
                width, height = self._probe_image_dimensions(probe_bytes, mime_type)
                moved_paths.append(final_path)
                part_path.unlink(missing_ok=True)

                # Compress video if applicable
                if (mime_type or "").lower().startswith("video/"):
                    try:
                        from backend.chat.video_compress import compress_video, probe_video_info
                        compressed_path = final_path.with_suffix(".compressed.mp4")
                        result = compress_video(final_path, compressed_path)
                        if result and result.exists():
                            final_path.unlink(missing_ok=True)
                            result.rename(final_path)
                            file_size = final_path.stat().st_size
                            mime_type = "video/mp4"
                        info = probe_video_info(final_path)
                        if info.get("width") and info.get("height"):
                            width = info["width"]
                            height = info["height"]
                    except Exception:
                        pass

                prepared.append(
                    {
                        "attachment_id": _normalize_text(file_payload.get("attachment_id") or file_payload.get("file_id")),
                        "file_name": _normalize_text(file_payload.get("file_name")),
                        "mime_type": mime_type,
                        "media_kind": _normalize_text(file_payload.get("media_kind")) or None,
                        "file_size": file_size,
                        "width": width,
                        "height": height,
                        "duration_seconds": _duration_seconds_or_none(file_payload.get("duration_seconds")),
                        "storage_name": storage_name,
                        "path": final_path,
                    }
                )
            return prepared
        except Exception:
            self.cleanup_prepared_files([{"path": path} for path in moved_paths])
            raise
