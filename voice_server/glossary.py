"""API словаря компании: список (кандидаты/подтверждённые), правка, подтверждение, отклонение.

Любое изменение сразу выгружает подтверждённые термины в ``voice_video/data/company_glossary.json`` —
оттуда их читает пайплайн (подстановка в промпты, корректор написаний, подсказка распознаванию речи).
"""
from __future__ import annotations

import logging
import re
from pathlib import Path
from typing import Any, Dict, List, Optional

from fastapi import APIRouter, Depends, HTTPException, Query, status
from pydantic import BaseModel, Field

from . import glossary_store, pipeline
from .auth import PERM_MANAGE, PERM_READ, require_web_permission, web_actor

logger = logging.getLogger("voice-server")
router = APIRouter(prefix="/api/v1/voice/glossary", tags=["voice-glossary"])

TERM_ID_RE = re.compile(r"^[0-9a-fA-F-]{36}$")


def export_path() -> Path:
    return pipeline.vv_root() / "data" / "company_glossary.json"


def _export() -> None:
    try:
        glossary_store.export_confirmed(export_path())
    except Exception:  # noqa: BLE001 - правка уже сохранена; выгрузка повторится при следующем изменении
        logger.exception("glossary export failed")


def ingest_for_meeting(base: str) -> Optional[Dict[str, int]]:
    """Кандидаты записи (файл рядом с отчётами) -> очередь подтверждения. Сбой не мешает завершению задания."""
    try:
        safe = pipeline.sanitize_base(base)
        mdir = pipeline.meeting_dir(safe) if safe else None
        if not mdir:
            return None
        return glossary_store.ingest_candidates_file(mdir / f"{safe}_glossary_candidates.json", safe)
    except Exception:  # noqa: BLE001
        logger.exception("glossary ingest failed")
        return None


class TermCreate(BaseModel):
    term: str = Field(..., min_length=2, max_length=120)
    kind: str = Field("other", max_length=16)
    expansion: str = Field("", max_length=500)
    aliases: List[str] = Field(default_factory=list, max_length=12)
    status: str = Field("confirmed", max_length=16)
    core: bool = False


class TermUpdate(BaseModel):
    term: Optional[str] = Field(None, min_length=2, max_length=120)
    kind: Optional[str] = Field(None, max_length=16)
    expansion: Optional[str] = Field(None, max_length=500)
    aliases: Optional[List[str]] = Field(None, max_length=12)
    status: Optional[str] = Field(None, max_length=16)
    core: Optional[bool] = None


def _term_or_404(term_id: str) -> Dict[str, Any]:
    term = glossary_store.get_term(term_id) if TERM_ID_RE.match(str(term_id or "")) else None
    if not term:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Term not found")
    return term


@router.get("")
def list_terms(
    status_filter: Optional[str] = Query(None, alias="status"),
    q: str = Query("", max_length=120),
    limit: int = Query(500, ge=1, le=2000),
    offset: int = Query(0, ge=0),
    user: Dict[str, Any] = Depends(require_web_permission(PERM_READ)),
) -> Dict[str, Any]:
    return glossary_store.list_terms(status=status_filter, q=q, limit=limit, offset=offset)


@router.post("", status_code=status.HTTP_201_CREATED)
def create_term(
    payload: TermCreate,
    user: Dict[str, Any] = Depends(require_web_permission(PERM_MANAGE)),
) -> Dict[str, Any]:
    try:
        created = glossary_store.create_term(**payload.model_dump(), actor=web_actor(user))
    except ValueError as exc:
        raise HTTPException(status.HTTP_409_CONFLICT if "уже есть" in str(exc) else status.HTTP_422_UNPROCESSABLE_ENTITY, str(exc))
    _export()
    return created


@router.put("/{term_id}")
def update_term(
    term_id: str,
    payload: TermUpdate,
    user: Dict[str, Any] = Depends(require_web_permission(PERM_MANAGE)),
) -> Dict[str, Any]:
    _term_or_404(term_id)
    try:
        updated = glossary_store.update_term(term_id, payload.model_dump(exclude_none=True), actor=web_actor(user))
    except ValueError as exc:
        raise HTTPException(status.HTTP_409_CONFLICT if "уже есть" in str(exc) else status.HTTP_422_UNPROCESSABLE_ENTITY, str(exc))
    _export()
    return updated or {}


@router.delete("/{term_id}")
def delete_term(
    term_id: str,
    user: Dict[str, Any] = Depends(require_web_permission(PERM_MANAGE)),
) -> Dict[str, Any]:
    _term_or_404(term_id)
    glossary_store.delete_term(term_id)
    _export()
    return {"deleted": True}
