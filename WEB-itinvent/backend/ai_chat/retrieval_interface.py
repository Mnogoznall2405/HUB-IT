from __future__ import annotations

import json
import logging
from typing import Any, Protocol

from sqlalchemy import cast, func, literal_column, select
from sqlalchemy.dialects.postgresql import JSONB

from backend.ai_chat.retrieval import AiKbRetrievalService
from backend.services.access_policy_service import can_view_kb_item
from backend.appdb.db import app_session
from backend.appdb.models import AppAiKbChunk

logger = logging.getLogger(__name__)


def _normalize_text(value: object) -> str:
    return str(value or "").strip()


def _load_json_object(raw_value: Any) -> dict[str, Any]:
    try:
        payload = json.loads(str(raw_value or "{}"))
    except Exception:
        return {}
    return payload if isinstance(payload, dict) else {}


def _normalize_tags(value: Any) -> list[str]:
    if not isinstance(value, list):
        return []
    return [_normalize_text(item) for item in value if _normalize_text(item)]


class AiKbRetrievalBackend(Protocol):
    def ensure_index_fresh(self, *, image_extractor=None, max_age_sec: float | None = None) -> None:
        ...

    def retrieve(self, *, query: str, allowed_scope: list[str] | None = None, limit: int = 5, current_user: dict[str, Any] | None = None) -> list[dict[str, Any]]:
        ...

    def retrieve_template_candidates(
        self,
        *,
        query: str,
        allowed_scope: list[str] | None = None,
        limit: int = 5,
        current_user: dict[str, Any] | None = None,
    ) -> list[dict[str, Any]]:
        ...

    def get_metrics(self) -> dict[str, Any]:
        ...


class PostgresFtsAiKbRetrievalAdapter:
    def __init__(self, fallback: AiKbRetrievalService) -> None:
        self._fallback = fallback

    def ensure_index_fresh(self, *, image_extractor=None, max_age_sec: float | None = None) -> None:
        self._fallback.ensure_index_fresh(image_extractor=image_extractor, max_age_sec=max_age_sec)

    def _is_postgres_available(self) -> bool:
        try:
            with app_session() as session:
                bind = session.get_bind()
                return str(getattr(getattr(bind, "dialect", None), "name", "") or "").lower() == "postgresql"
        except Exception:
            return False

    def retrieve(self, *, query: str, allowed_scope: list[str] | None = None, limit: int = 5, current_user: dict[str, Any] | None = None) -> list[dict[str, Any]]:
        if not self._is_postgres_available():
            return self._fallback.retrieve(query=query, allowed_scope=allowed_scope, limit=limit, current_user=current_user)
        try:
            return self._retrieve_postgres_fts(query=query, allowed_scope=allowed_scope, limit=limit, current_user=current_user)
        except Exception:
            logger.exception("AI KB Postgres FTS retrieval failed; falling back to Python scorer")
            return self._fallback.retrieve(query=query, allowed_scope=allowed_scope, limit=limit, current_user=current_user)

    def _retrieve_postgres_fts(
        self,
        *,
        query: str,
        allowed_scope: list[str] | None = None,
        limit: int = 5,
        current_user: dict[str, Any] | None = None,
    ) -> list[dict[str, Any]]:
        statement = self._build_postgres_fts_statement(query=query, allowed_scope=allowed_scope, limit=limit)
        if statement is None:
            return []
        with app_session() as session:
            rows = session.execute(statement).all()
        payloads: list[dict[str, Any]] = []
        for row, rank_value in rows:
            metadata = _load_json_object(row.metadata_json)
            if current_user is not None and not can_view_kb_item(current_user, metadata):
                continue
            payloads.append(
                {
                    "score": float(rank_value or 0.0),
                    "article_id": row.kb_article_id,
                    "title": _normalize_text(metadata.get("title") or row.title),
                    "category": _normalize_text(metadata.get("category")),
                    "content": _normalize_text(row.content),
                    "article_type": _normalize_text(metadata.get("article_type")),
                    "summary": _normalize_text(metadata.get("summary")),
                    "tags": _normalize_tags(metadata.get("tags")),
                    "primary_attachment_id": _normalize_text(metadata.get("primary_attachment_id")),
                    "primary_attachment_name": _normalize_text(metadata.get("primary_attachment_name")),
                    "primary_attachment_content_type": _normalize_text(metadata.get("primary_attachment_content_type")),
                }
            )
        return payloads

    def _build_postgres_fts_statement(
        self,
        *,
        query: str,
        allowed_scope: list[str] | None = None,
        limit: int = 5,
    ):
        normalized_query = _normalize_text(query)
        if not normalized_query:
            return None
        allowed = [
            _normalize_text(item).lower()
            for item in list(allowed_scope or [])
            if _normalize_text(item)
        ]
        max_items = max(1, int(limit or 5))
        document = func.to_tsvector(
            literal_column("'simple'"),
            func.concat_ws(literal_column("' '"), AppAiKbChunk.title, AppAiKbChunk.content),
        )
        ts_query = func.websearch_to_tsquery(literal_column("'simple'"), normalized_query)
        rank = func.ts_rank_cd(document, ts_query).label("rank")
        statement = (
            select(AppAiKbChunk, rank)
            .where(document.op("@@")(ts_query))
            .order_by(rank.desc(), AppAiKbChunk.updated_at.desc(), AppAiKbChunk.chunk_index.asc())
            .limit(max_items)
        )
        if allowed:
            category = func.lower(
                cast(AppAiKbChunk.metadata_json, JSONB).op("->>")("category")
            )
            statement = statement.where(category.in_(allowed))
        return statement

    def retrieve_template_candidates(
        self,
        *,
        query: str,
        allowed_scope: list[str] | None = None,
        limit: int = 5,
        current_user: dict[str, Any] | None = None,
    ) -> list[dict[str, Any]]:
        return self._fallback.retrieve_template_candidates(
            query=query,
            allowed_scope=allowed_scope,
            limit=limit,
            current_user=current_user,
        )

    def get_metrics(self) -> dict[str, Any]:
        payload = dict(self._fallback.get_metrics())
        payload["backend"] = "postgres_fts" if self._is_postgres_available() else "python"
        return payload


class AiKbRetrievalInterface:
    def __init__(self, backend: AiKbRetrievalBackend) -> None:
        self._backend = backend

    def ensure_index_fresh(self, *, image_extractor=None, max_age_sec: float | None = None) -> None:
        self._backend.ensure_index_fresh(image_extractor=image_extractor, max_age_sec=max_age_sec)

    def retrieve(self, *, query: str, allowed_scope: list[str] | None = None, limit: int = 5, current_user: dict[str, Any] | None = None) -> list[dict[str, Any]]:
        return self._backend.retrieve(query=query, allowed_scope=allowed_scope, limit=limit, current_user=current_user)

    def retrieve_template_candidates(
        self,
        *,
        query: str,
        allowed_scope: list[str] | None = None,
        limit: int = 5,
        current_user: dict[str, Any] | None = None,
    ) -> list[dict[str, Any]]:
        return self._backend.retrieve_template_candidates(
            query=query,
            allowed_scope=allowed_scope,
            limit=limit,
            current_user=current_user,
        )

    def get_metrics(self) -> dict[str, Any]:
        return self._backend.get_metrics()


def build_ai_kb_retrieval_interface() -> AiKbRetrievalInterface:
    fallback = AiKbRetrievalService()
    return AiKbRetrievalInterface(PostgresFtsAiKbRetrievalAdapter(fallback))


ai_kb_retrieval = build_ai_kb_retrieval_interface()
