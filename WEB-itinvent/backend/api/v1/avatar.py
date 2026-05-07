"""
Avatar upload, retrieval and deletion endpoints.
"""
from __future__ import annotations

import hashlib
import io
import logging
from datetime import datetime, timezone
from pathlib import Path
from typing import Optional

from fastapi import APIRouter, Depends, File, HTTPException, UploadFile, status
from fastapi.responses import FileResponse
from PIL import Image, ImageOps, UnidentifiedImageError

from backend.api.deps import get_current_active_user
from backend.config import PROJECT_ROOT
from backend.models.auth import User
from backend.services.user_service import user_service

router = APIRouter()
logger = logging.getLogger(__name__)

_AVATARS_DIR = PROJECT_ROOT / "data" / "avatars"
_AVATARS_DIR.mkdir(parents=True, exist_ok=True)

_AVATAR_MAX_SIZE_BYTES = 5 * 1024 * 1024
_AVATAR_TARGET_SIZE = 512
_ALLOWED_CONTENT_TYPES = {
    "image/jpeg",
    "image/png",
    "image/webp",
    "image/gif",
}


def _avatar_file_name(user_id: int, content_hash: str) -> str:
    return f"{user_id}_{content_hash}.webp"


def _process_avatar_image(raw_bytes: bytes) -> bytes:
    try:
        with Image.open(io.BytesIO(raw_bytes)) as img:
            # Verify it's actually an image
            img.verify()
    except Exception as exc:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="Invalid image file",
        ) from exc

    try:
        with Image.open(io.BytesIO(raw_bytes)) as img:
            # Apply EXIF orientation
            img = ImageOps.exif_transpose(img)
            # Convert to RGBA if necessary, then to RGB for webp
            if img.mode in ("P", "LA", "L"):
                img = img.convert("RGBA")
            if img.mode == "RGBA":
                # Create white background for transparent images
                background = Image.new("RGB", img.size, (255, 255, 255))
                background.paste(img, mask=img.split()[3])
                img = background
            elif img.mode != "RGB":
                img = img.convert("RGB")

            # Resize to 512x512 using cover crop (center crop)
            width, height = img.size
            min_dim = min(width, height)
            left = (width - min_dim) // 2
            top = (height - min_dim) // 2
            right = left + min_dim
            bottom = top + min_dim
            img = img.crop((left, top, right, bottom))
            img = img.resize((_AVATAR_TARGET_SIZE, _AVATAR_TARGET_SIZE), Image.Resampling.LANCZOS)

            output = io.BytesIO()
            img.save(output, format="WEBP", quality=85, method=6)
            return output.getvalue()
    except UnidentifiedImageError as exc:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="Unrecognized image format",
        ) from exc
    except Exception as exc:
        logger.exception("Avatar processing failed")
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail="Failed to process image",
        ) from exc


def _remove_old_avatar(user_id: int) -> None:
    try:
        for old_path in _AVATARS_DIR.glob(f"{user_id}_*.webp"):
            if old_path.is_file():
                old_path.unlink()
    except Exception:
        logger.exception("Failed to remove old avatar for user %s", user_id)


@router.post("/avatar", response_model=dict)
async def upload_avatar(
    file: UploadFile = File(...),
    current_user: User = Depends(get_current_active_user),
):
    if not file.content_type or file.content_type not in _ALLOWED_CONTENT_TYPES:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail=f"Unsupported file type. Allowed: {', '.join(_ALLOWED_CONTENT_TYPES)}",
        )

    raw_bytes = await file.read()
    if len(raw_bytes) > _AVATAR_MAX_SIZE_BYTES:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail=f"File too large. Max size: {_AVATAR_MAX_SIZE_BYTES // (1024 * 1024)}MB",
        )

    processed_bytes = _process_avatar_image(raw_bytes)
    content_hash = hashlib.sha256(processed_bytes).hexdigest()[:8]
    file_name = _avatar_file_name(int(current_user.id), content_hash)
    file_path = _AVATARS_DIR / file_name

    # Remove old avatar file
    _remove_old_avatar(int(current_user.id))

    # Write new file
    file_path.write_bytes(processed_bytes)

    # Build cache-busted URL
    cache_bust = int(datetime.now(timezone.utc).timestamp())
    avatar_url = f"/api/v1/settings/avatar/{current_user.id}/file?v={cache_bust}"

    # Update user record
    updated = user_service.update_user(int(current_user.id), avatar_url=avatar_url)
    if not updated:
        # Cleanup on failure
        file_path.unlink(missing_ok=True)
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail="Failed to update user avatar",
        )

    return {"avatar_url": avatar_url}


@router.delete("/avatar", response_model=dict)
async def delete_avatar(
    current_user: User = Depends(get_current_active_user),
):
    _remove_old_avatar(int(current_user.id))

    updated = user_service.update_user(int(current_user.id), avatar_url=None)
    if not updated:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="User not found",
        )

    return {"avatar_url": None}


@router.get("/avatar/{user_id}/file")
async def get_avatar_file(
    user_id: int,
):
    # Find the actual file on disk (pattern: {user_id}_*.webp)
    candidates = list(_AVATARS_DIR.glob(f"{user_id}_*.webp"))
    if not candidates:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="Avatar not found",
        )

    # Use the most recently modified file
    file_path = max(candidates, key=lambda p: p.stat().st_mtime)

    return FileResponse(
        path=str(file_path),
        media_type="image/webp",
        filename=file_path.name,
        content_disposition_type="inline",
    )
