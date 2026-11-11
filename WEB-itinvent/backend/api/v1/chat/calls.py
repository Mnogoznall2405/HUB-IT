"""Voice/video calls of a conversation (LiveKit). See backend/chat/calls.py and
documentation/technical/CHAT_CALLS_LIVEKIT.md."""
from __future__ import annotations

import logging
from typing import Literal

from backend.api.v1.chat._shim import chat_api
from fastapi import APIRouter, Depends
from fastapi.responses import JSONResponse
from pydantic import BaseModel

from backend.api.deps import require_permission
from backend.chat.calls import (
    ERROR_ALREADY_ACTIVE,
    ERROR_CALL_ENDED,
    ERROR_NOT_CONFIGURED,
    CallEvent,
    CallOutcome,
    CallsNotConfigured,
    calls_available,
    chat_call_service,
)
from backend.models.auth import User
from backend.services.authorization_service import PERM_CHAT_READ, PERM_CHAT_WRITE

logger = logging.getLogger(__name__)

router = APIRouter()


class CallCreateRequest(BaseModel):
    media: Literal["audio", "video"]


def _error(status_code: int, code: str, message: str, **extra) -> JSONResponse:
    return JSONResponse(status_code=status_code, content={"code": code, "detail": message, **extra})


async def _publish_call_events(events: list[CallEvent]) -> None:
    realtime = chat_api().chat_realtime
    for event in events:
        try:
            await realtime.publish_inbox_events(
                user_ids=event.user_ids,
                event_type=event.event_type,
                payload=event.payload,
                conversation_id=event.conversation_id,
            )
        except Exception:
            logger.warning("chat_call stage=publish_failed event=%s", event.event_type, exc_info=True)


async def _run(function, **kwargs) -> CallOutcome | JSONResponse:
    try:
        outcome: CallOutcome = await chat_api()._run_chat_call(function, **kwargs)
    except CallsNotConfigured:
        return _error(503, ERROR_NOT_CONFIGURED, "Calls are not configured")
    except Exception as exc:
        chat_api()._raise_chat_http_error(exc)
        raise
    if outcome.events:
        # Publishing must not delay the HTTP answer: it runs after the response is prepared.
        chat_api()._schedule_chat_background_task(_publish_call_events(outcome.events), label="chat_call_events")
    return outcome


def _with_token(outcome: CallOutcome) -> dict:
    return {"call": outcome.call, "token": outcome.token, "url": outcome.url}


def _error_response(outcome: CallOutcome) -> JSONResponse:
    if outcome.error == ERROR_ALREADY_ACTIVE:
        return _error(409, ERROR_ALREADY_ACTIVE, "A call is already in progress in this conversation", call=outcome.call)
    return _error(409, ERROR_CALL_ENDED, "The call has ended", call=outcome.call)


@router.get("/calls/config")
async def get_calls_config(
    current_user: User = Depends(require_permission(PERM_CHAT_READ)),
):
    return {"enabled": calls_available()}


@router.post("/conversations/{conversation_id}/calls")
async def start_call(
    conversation_id: str,
    payload: CallCreateRequest,
    current_user: User = Depends(require_permission(PERM_CHAT_WRITE)),
):
    result = await _run(
        chat_call_service.create_call,
        current_user_id=int(current_user.id),
        conversation_id=conversation_id,
        media=payload.media,
    )
    if isinstance(result, JSONResponse):
        return result
    if result.error:
        return _error_response(result)
    return _with_token(result)


@router.get("/conversations/{conversation_id}/calls/active")
async def get_active_call(
    conversation_id: str,
    current_user: User = Depends(require_permission(PERM_CHAT_READ)),
):
    result = await _run(
        chat_call_service.get_active_call,
        current_user_id=int(current_user.id),
        conversation_id=conversation_id,
    )
    if isinstance(result, JSONResponse):
        return result
    return {"call": result.call}


@router.post("/calls/{call_id}/join")
async def join_call(
    call_id: str,
    current_user: User = Depends(require_permission(PERM_CHAT_WRITE)),
):
    result = await _run(chat_call_service.join_call, current_user_id=int(current_user.id), call_id=call_id)
    if isinstance(result, JSONResponse):
        return result
    if result.error:
        return _error_response(result)
    return _with_token(result)


@router.post("/calls/{call_id}/decline")
async def decline_call(
    call_id: str,
    current_user: User = Depends(require_permission(PERM_CHAT_WRITE)),
):
    result = await _run(chat_call_service.decline_call, current_user_id=int(current_user.id), call_id=call_id)
    if isinstance(result, JSONResponse):
        return result
    return {"call": result.call}


@router.post("/calls/{call_id}/leave")
async def leave_call(
    call_id: str,
    current_user: User = Depends(require_permission(PERM_CHAT_WRITE)),
):
    result = await _run(chat_call_service.leave_call, current_user_id=int(current_user.id), call_id=call_id)
    if isinstance(result, JSONResponse):
        return result
    return {"call": result.call}
