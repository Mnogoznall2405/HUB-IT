from __future__ import annotations

import json
import logging
from typing import Any, Protocol

from sqlalchemy import and_, case, cast, func, literal_column, or_, select, true
from sqlalchemy.dialects.postgresql import JSONB

from backend.ai_chat.retrieval import AiKbRetrievalService, _metadata_visible_to_user, _tokenize
from backend.services.access_policy_service import (
    VISIBILITY_DEPARTMENT,
    VISIBILITY_DEPARTMENT_MANAGERS,
    VISIBILITY_GLOBAL,
    VISIBILITY_PRIVATE,
    user_can_manage_kb_all,
)
from backend.services.department_service import DEPARTMENT_MANAGER_ROLE, DEPARTMENT_MEMBER_ROLE, department_service
from backend.appdb.db import app_session
from backend.appdb.models import AppAiKbChunk

logger = logging.getLogger(__name__)

_FTS_CONFIG = literal_column("'russian'")
_MAX_FALLBACK_TOKENS = 12
_TRIGRAM_SIMILARITY_THRESHOLD = 0.6


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


def _document_text():
    return func.coalesce(AppAiKbChunk.title, "") + literal_column("' '") + func.coalesce(AppAiKbChunk.content, "")


def _document_tsvector():
    return func.to_tsvector(_FTS_CONFIG, _document_text())


def _metadata_jsonb():
    return cast(AppAiKbChunk.metadata_json, JSONB)


def _metadata_text(key: str):
    return _metadata_jsonb().op("->>")(key)


def _user_int(value: Any) -> int:
    try:
        return int(value or 0)
    except Exception:
        return 0


def _kb_acl_clause(current_user: dict[str, Any] | None):
    scope = func.lower(func.coalesce(_metadata_text("visibility_scope"), VISIBILITY_GLOBAL))
    valid_scopes = (VISIBILITY_PRIVATE, VISIBILITY_DEPARTMENT, VISIBILITY_DEPARTMENT_MANAGERS)
    globally_visible = ~scope.in_(valid_scopes)
    if current_user is None:
        return globally_visible
    if user_can_manage_kb_all(current_user):
        return true()

    clauses = [globally_visible]
    owner_clauses = []
    uid = _user_int(current_user.get("id"))
    if uid > 0:
        owner_clauses.append(_metadata_text("owner_user_id") == str(uid))
    username = _normalize_text(current_user.get("username")).lower()
    if username:
        owner_clauses.append(func.lower(func.coalesce(_metadata_text("created_by"), "")) == username)
    if owner_clauses:
        clauses.append(and_(scope == VISIBILITY_PRIVATE, or_(*owner_clauses)))

    department_id = _metadata_text("department_id")
    member_department_ids = sorted(
        department_service.get_user_department_ids(
            current_user,
            roles=[DEPARTMENT_MEMBER_ROLE, DEPARTMENT_MANAGER_ROLE],
        )
    )
    manager_department_ids = sorted(
        department_service.get_user_department_ids(current_user, roles=[DEPARTMENT_MANAGER_ROLE])
    )
    if member_department_ids:
        clauses.append(and_(scope == VISIBILITY_DEPARTMENT, department_id.in_(member_department_ids)))
    if manager_department_ids:
        clauses.append(and_(scope == VISIBILITY_DEPARTMENT_MANAGERS, department_id.in_(manager_department_ids)))
    return or_(*clauses)


def _fallback_tokens(query: str) -> list[str]:
    return _tokenize(query)[:_MAX_FALLBACK_TOKENS]


def _token_coverage_expression(document, tokens: list[str]):
    coverage = None
    for token in tokens:
        token_query = func.plainto_tsquery(_FTS_CONFIG, token)
        matched = case((document.op("@@")(token_query), 1), else_=0)
        coverage = matched if coverage is None else coverage + matched
    return coverage


def _needed_coverage(tokens: list[str]) -> int:
    return max(1, len(tokens) - 1)


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
        template_only: bool = False,
    ) -> list[dict[str, Any]]:
        rows = []
        with app_session() as session:
            for mode in ("strict", "bounded_or", "trgm"):
                statement = self._build_postgres_fts_statement(
                    query=query,
                    allowed_scope=allowed_scope,
                    limit=limit,
                    current_user=current_user,
                    mode=mode,
                    template_only=template_only,
                )
                if statement is None:
                    continue
                rows = session.execute(statement).all()
                if rows:
                    break
        payloads: list[dict[str, Any]] = []
        for row, rank_value in rows:
            metadata = _load_json_object(row.metadata_json)
            if not _metadata_visible_to_user(current_user, metadata):
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

    def _apply_common_filters(
        self,
        statement,
        *,
        allowed_scope: list[str] | None,
        current_user: dict[str, Any] | None,
        template_only: bool = False,
    ):
        allowed = [
            _normalize_text(item).lower()
            for item in list(allowed_scope or [])
            if _normalize_text(item)
        ]
        if allowed:
            category = func.lower(_metadata_text("category"))
            statement = statement.where(category.in_(allowed))
        if template_only:
            statement = statement.where(func.lower(_metadata_text("article_type")) == "template")
            statement = statement.where(func.coalesce(_metadata_text("primary_attachment_id"), "") != "")
        return statement.where(_kb_acl_clause(current_user))

    def _build_postgres_fts_statement(
        self,
        *,
        query: str,
        allowed_scope: list[str] | None = None,
        limit: int = 5,
        current_user: dict[str, Any] | None = None,
        mode: str = "strict",
        template_only: bool = False,
    ):
        normalized_query = _normalize_text(query)
        tokens = _fallback_tokens(normalized_query)
        if not normalized_query or not tokens:
            return None
        max_items = max(1, int(limit or 5))
        document = _document_tsvector()

        if mode == "strict":
            ts_query = func.plainto_tsquery(_FTS_CONFIG, normalized_query)
            rank = func.ts_rank_cd(document, ts_query).label("rank")
            statement = (
                select(AppAiKbChunk, rank)
                .where(document.op("@@")(ts_query))
                .order_by(rank.desc(), AppAiKbChunk.updated_at.desc(), AppAiKbChunk.chunk_index.asc())
                .limit(max_items)
            )
        elif mode == "bounded_or":
            or_query = " | ".join(tokens)
            ts_query = func.to_tsquery(_FTS_CONFIG, or_query)
            coverage = _token_coverage_expression(document, tokens)
            rank = func.ts_rank_cd(document, ts_query).label("rank")
            statement = (
                select(AppAiKbChunk, rank)
                .where(document.op("@@")(ts_query))
                .where(coverage >= _needed_coverage(tokens))
                .order_by(coverage.desc(), rank.desc(), AppAiKbChunk.updated_at.desc(), AppAiKbChunk.chunk_index.asc())
                .limit(max_items)
            )
        elif mode == "trgm":
            document_lower = func.lower(_document_text())
            match_clauses = []
            score = None
            coverage = None
            for token in tokens:
                similarity = func.word_similarity(token, document_lower)
                match_clauses.append(document_lower.op("%>")(token))
                covered = case((similarity >= _TRIGRAM_SIMILARITY_THRESHOLD, 1), else_=0)
                score = similarity if score is None else score + similarity
                coverage = covered if coverage is None else coverage + covered
            rank = score.label("rank")
            statement = (
                select(AppAiKbChunk, rank)
                .where(or_(*match_clauses))
                .where(coverage >= _needed_coverage(tokens))
                .order_by(coverage.desc(), rank.desc(), AppAiKbChunk.updated_at.desc(), AppAiKbChunk.chunk_index.asc())
                .limit(max_items)
            )
        else:
            raise ValueError(f"unsupported retrieval mode: {mode}")
        return self._apply_common_filters(
            statement,
            allowed_scope=allowed_scope,
            current_user=current_user,
            template_only=template_only,
        )

    def retrieve_template_candidates(
        self,
        *,
        query: str,
        allowed_scope: list[str] | None = None,
        limit: int = 5,
        current_user: dict[str, Any] | None = None,
    ) -> list[dict[str, Any]]:
        max_items = max(1, int(limit or 5))
        if self._is_postgres_available():
            try:
                rows = self._retrieve_postgres_fts(
                    query=query,
                    allowed_scope=allowed_scope,
                    limit=max_items * 3,
                    current_user=current_user,
                    template_only=True,
                )
                best_by_article: dict[str, dict[str, Any]] = {}
                for item in rows:
                    article_id = _normalize_text(item.get("article_id"))
                    if not article_id:
                        continue
                    score = float(item.get("score") or 0.0)
                    current = best_by_article.get(article_id)
                    if current is not None and float(current.get("score") or 0.0) >= score:
                        continue
                    best_by_article[article_id] = {
                        "score": score,
                        "article_id": article_id,
                        "title": _normalize_text(item.get("title")),
                        "category": _normalize_text(item.get("category")),
                        "summary": _normalize_text(item.get("summary")),
                        "tags": _normalize_tags(item.get("tags")),
                        "content_preview": _normalize_text(item.get("content")),
                        "attachment_id": _normalize_text(item.get("primary_attachment_id")),
                        "attachment_name": _normalize_text(item.get("primary_attachment_name")),
                        "attachment_content_type": _normalize_text(item.get("primary_attachment_content_type")),
                    }
                ranked = sorted(
                    best_by_article.values(),
                    key=lambda item: (float(item.get("score") or 0.0), item.get("title") or ""),
                    reverse=True,
                )
                return ranked[:max_items]
            except Exception:
                logger.exception("AI KB Postgres template retrieval failed; falling back to Python scorer")
        return self._fallback.retrieve_template_candidates(
            query=query,
            allowed_scope=allowed_scope,
            limit=limit,
            current_user=current_user,
        )

    def get_metrics(self) -> dict[str, Any]:
        payload = dict(self._fallback.get_metrics())
        payload["backend"] = "postgres_hybrid_fts" if self._is_postgres_available() else "python"
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
        return self._backend.retrieve_template_candidates(query=query, allowed_scope=allowed_scope, limit=limit, current_user=current_user)

    def get_metrics(self) -> dict[str, Any]:
        return self._backend.get_metrics()


def build_ai_kb_retrieval_interface() -> AiKbRetrievalInterface:
    fallback = AiKbRetrievalService()
    return AiKbRetrievalInterface(PostgresFtsAiKbRetrievalAdapter(fallback))


ai_kb_retrieval = build_ai_kb_retrieval_interface()
