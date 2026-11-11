"""«Предложить идею»: отправка предложений, статус своих предложений и разбор администраторами."""
from __future__ import annotations

from contextlib import contextmanager
from typing import Literal

from fastapi import APIRouter, Depends, HTTPException, Query
from pydantic import BaseModel, ConfigDict, Field

from backend.api.deps import require_permission
from backend.models.auth import User
from backend.services.authorization_service import PERM_DASHBOARD_READ, PERM_FEEDBACK_MANAGE
from backend.services.feedback_service import FeedbackRateLimited, FeedbackService, feedback_service
from backend.services.feedback_store import FeedbackNotReady

router = APIRouter()

NOT_READY_DETAIL = "Раздел предложений ещё не подключён на сервере"

CategoryLiteral = Literal["idea", "inconvenience", "bug", "other"]
StatusLiteral = Literal["new", "in_progress", "accepted", "declined", "done"]


class SuggestionCreate(BaseModel):
    model_config = ConfigDict(extra="forbid")

    category: CategoryLiteral
    title: str = Field(max_length=500)
    message: str = Field(max_length=10000)
    section: str | None = Field(default=None, max_length=512)


class SuggestionUpdate(BaseModel):
    model_config = ConfigDict(extra="forbid")

    status: StatusLiteral | None = None
    admin_note: str | None = Field(default=None, max_length=5000)


def get_feedback_service() -> FeedbackService:
    return feedback_service


@contextmanager
def _translated_errors():
    try:
        yield
    except FeedbackNotReady:
        raise HTTPException(503, NOT_READY_DETAIL) from None
    except FeedbackRateLimited as exc:
        raise HTTPException(429, str(exc)) from None
    except LookupError as exc:
        raise HTTPException(404, str(exc)) from None
    except ValueError as exc:
        raise HTTPException(422, str(exc)) from None


@router.post("", status_code=201)
def create_suggestion(
    body: SuggestionCreate,
    current_user: User = Depends(require_permission(PERM_DASHBOARD_READ)),
    svc: FeedbackService = Depends(get_feedback_service),
):
    with _translated_errors():
        return svc.create(user_id=current_user.id, payload=body.model_dump())


@router.get("/mine")
def list_my_suggestions(
    limit: int = Query(default=50, ge=1, le=200),
    current_user: User = Depends(require_permission(PERM_DASHBOARD_READ)),
    svc: FeedbackService = Depends(get_feedback_service),
):
    with _translated_errors():
        return svc.list_mine(user_id=current_user.id, limit=limit)


@router.get("")
def list_all_suggestions(
    status: str | None = Query(default=None, max_length=32),
    limit: int = Query(default=50, ge=1, le=200),
    offset: int = Query(default=0, ge=0, le=100000),
    _current_user: User = Depends(require_permission(PERM_FEEDBACK_MANAGE)),
    svc: FeedbackService = Depends(get_feedback_service),
):
    with _translated_errors():
        return svc.list_all(status=status, limit=limit, offset=offset)


@router.patch("/{item_id}")
def update_suggestion(
    item_id: str,
    body: SuggestionUpdate,
    current_user: User = Depends(require_permission(PERM_FEEDBACK_MANAGE)),
    svc: FeedbackService = Depends(get_feedback_service),
):
    changes = body.model_dump(exclude_unset=True)
    with _translated_errors():
        return svc.update(item_id=item_id, actor_user_id=current_user.id, changes=changes)
