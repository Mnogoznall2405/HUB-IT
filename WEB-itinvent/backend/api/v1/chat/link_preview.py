"""Link preview endpoint for chat."""
from __future__ import annotations

from fastapi import APIRouter, Depends, Query

from backend.api.deps import require_permission
from backend.chat.link_preview_service import fetch_link_preview
from backend.models.auth import User
from backend.services.authorization_service import PERM_CHAT_READ

router = APIRouter()


@router.get("/link-preview")
async def get_link_preview(
    url: str = Query(...),
    _: User = Depends(require_permission(PERM_CHAT_READ)),
):
    """Fetch Open Graph metadata for the given URL."""
    return fetch_link_preview(url)
