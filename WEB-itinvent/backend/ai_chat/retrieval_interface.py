from __future__ import annotations

import itertools
import json
import logging
import os
import re
from typing import Any, Protocol

from sqlalchemy import and_, case, cast, false, func, literal_column, or_, select, true
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
_IDENTIFIER_CANDIDATE_RE = re.compile(r"[0-9A-Za-zА-Яа-яЁё]+(?:[-_][0-9A-Za-zА-Яа-яЁё]+)*", flags=re.UNICODE)
_TSQUERY_TOKEN_RE = re.compile(r"[0-9A-Za-zА-Яа-яЁё_]{3,}\Z", flags=re.UNICODE)


def _exact_identifier_tokens(query: str) -> list[str]:
    tokens: list[str] = []
    seen: set[str] = set()
    for match in _IDENTIFIER_CANDIDATE_RE.findall(str(query or "")):
        token = str(match or "").strip().lower()
        digit_count = sum(1 for char in token if char.isdigit())
        if digit_count < 4 or token in seen:
            continue
        seen.add(token)
        tokens.append(token)
    return tokens[:4]


def _pg_hybrid_retrieval_enabled() -> bool:
    return str(os.getenv("AI_KB_PG_HYBRID_FTS_ENABLED", "0") or "0").strip().lower() in {"1", "true", "yes", "on"}


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
    return AppAiKbChunk.title + literal_column("' '") + AppAiKbChunk.content


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


def _department_acl_ids(current_user: dict[str, Any] | None) -> tuple[list[str], list[str]]:
    if current_user is None or user_can_manage_kb_all(current_user):
        return [], []
    member_department_ids = sorted(
        department_service.get_user_department_ids(
            current_user,
            roles=[DEPARTMENT_MEMBER_ROLE, DEPARTMENT_MANAGER_ROLE],
        )
    )
    manager_department_ids = sorted(
        department_service.get_user_department_ids(current_user, roles=[DEPARTMENT_MANAGER_ROLE])
    )
    return member_department_ids, manager_department_ids


def _kb_acl_clause(
    current_user: dict[str, Any] | None,
    *,
    member_department_ids: list[str] | None = None,
    manager_department_ids: list[str] | None = None,
):
    if current_user is None:
        return false()
    if user_can_manage_kb_all(current_user):
        return true()

    scope = func.lower(func.coalesce(_metadata_text("visibility_scope"), VISIBILITY_GLOBAL))
    valid_scopes = (VISIBILITY_PRIVATE, VISIBILITY_DEPARTMENT, VISIBILITY_DEPARTMENT_MANAGERS)
    globally_visible = ~scope.in_(valid_scopes)
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
    member_ids = list(member_department_ids or [])
    manager_ids = list(manager_department_ids or [])
    if member_ids:
        clauses.append(and_(scope == VISIBILITY_DEPARTMENT, department_id.in_(member_ids)))
    if manager_ids:
        clauses.append(and_(scope == VISIBILITY_DEPARTMENT_MANAGERS, department_id.in_(manager_ids)))
    return or_(*clauses)


def _fallback_tokens(query: str) -> list[str]:
    tokens: list[str] = []
    seen: set[str] = set()
    for token in _tokenize(query):
        if token in seen:
            continue
        seen.add(token)
        tokens.append(token)
        if len(tokens) >= _MAX_FALLBACK_TOKENS:
            break
    return tokens


def _meaningful_fts_tokens(session, tokens: list[str]) -> list[str]:
    if not tokens:
        return []
    rows = session.connection().exec_driver_sql(
        """
        SELECT token
        FROM unnest(%s::text[]) WITH ORDINALITY AS items(token, item_order)
        WHERE to_tsvector('russian', token) <> ''::tsvector
        ORDER BY item_order
        """,
        (list(tokens),),
    ).scalars().all()
    return [str(item or "").strip() for item in rows if str(item or "").strip()]


def _needed_coverage(tokens: list[str]) -> int:
    total = len(tokens)
    return max(1, total - (1 if total <= 3 else 2))


def _coverage_tsquery_text(tokens: list[str]) -> str:
    if any(not _TSQUERY_TOKEN_RE.fullmatch(str(token or "")) for token in tokens):
        raise ValueError("unsafe FTS token")
    needed = _needed_coverage(tokens)
    return " | ".join(
        "(" + " & ".join(combination) + ")"
        for combination in itertools.combinations(tokens, needed)
    )


def _exact_identifier_clause(tokens: list[str]):
    document_lower = func.lower(_document_text())
    boundary = "0-9A-Za-zА-Яа-яЁё_"
    clauses = [
        document_lower.op("~")(f"(^|[^{boundary}]){re.escape(token)}([^{boundary}]|$)")
        for token in tokens
    ]
    if not clauses:
        return true()
    return and_(*clauses)


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
        if not _pg_hybrid_retrieval_enabled() or not self._is_postgres_available():
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
        normalized_query = _normalize_text(query)
        raw_tokens = _fallback_tokens(normalized_query)
        if not normalized_query or not raw_tokens or current_user is None:
            return []
        member_department_ids, manager_department_ids = _department_acl_ids(current_user)
        exact_identifier_tokens = _exact_identifier_tokens(normalized_query)
        rows = []
        with app_session() as session:
            tokens = _meaningful_fts_tokens(session, raw_tokens)
            if not tokens:
                return []
            for mode in ("strict", "exact_identifiers", "bounded_or", "trgm"):
                statement = self._build_postgres_fts_statement(
                    query=normalized_query,
                    allowed_scope=allowed_scope,
                    limit=limit,
                    current_user=current_user,
                    mode=mode,
                    tokens=tokens,
                    member_department_ids=member_department_ids,
                    manager_department_ids=manager_department_ids,
                    exact_identifier_tokens=exact_identifier_tokens,
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
        member_department_ids: list[str] | None = None,
        manager_department_ids: list[str] | None = None,
        exact_identifier_tokens: list[str] | None = None,
    ):
        allowed = [
            _normalize_text(item).lower()
            for item in list(allowed_scope or [])
            if _normalize_text(item)
        ]
        if allowed:
            category = func.lower(_metadata_text("category"))
            statement = statement.where(category.in_(allowed))
        if exact_identifier_tokens:
            statement = statement.where(_exact_identifier_clause(exact_identifier_tokens))
        return statement.where(
            _kb_acl_clause(
                current_user,
                member_department_ids=member_department_ids,
                manager_department_ids=manager_department_ids,
            )
        )

    def _build_postgres_fts_statement(
        self,
        *,
        query: str,
        allowed_scope: list[str] | None = None,
        limit: int = 5,
        current_user: dict[str, Any] | None = None,
        mode: str = "strict",
        tokens: list[str] | None = None,
        member_department_ids: list[str] | None = None,
        manager_department_ids: list[str] | None = None,
        exact_identifier_tokens: list[str] | None = None,
    ):
        normalized_query = _normalize_text(query)
        tokens = list(tokens if tokens is not None else _fallback_tokens(normalized_query))
        if not normalized_query or not tokens:
            return None
        max_items = max(1, int(limit or 5))
        exact_tokens = list(exact_identifier_tokens if exact_identifier_tokens is not None else _exact_identifier_tokens(normalized_query))
        document = _document_tsvector()

        if mode == "exact_identifiers":
            if not exact_tokens:
                return None
            rank = literal_column("100.0").label("rank")
            statement = (
                select(AppAiKbChunk, rank)
                .where(_exact_identifier_clause(exact_tokens))
                .order_by(AppAiKbChunk.updated_at.desc(), AppAiKbChunk.chunk_index.asc())
                .limit(max_items)
            )
        elif mode == "strict":
            ts_query = func.plainto_tsquery(_FTS_CONFIG, normalized_query)
            rank = func.ts_rank_cd(document, ts_query).label("rank")
            statement = (
                select(AppAiKbChunk, rank)
                .where(document.op("@@")(ts_query))
                .order_by(rank.desc(), AppAiKbChunk.updated_at.desc(), AppAiKbChunk.chunk_index.asc())
                .limit(max_items)
            )
        elif mode == "bounded_or":
            ts_query = func.to_tsquery(_FTS_CONFIG, _coverage_tsquery_text(tokens))
            rank = func.ts_rank_cd(document, ts_query).label("rank")
            statement = (
                select(AppAiKbChunk, rank)
                .where(document.op("@@")(ts_query))
                .order_by(rank.desc(), AppAiKbChunk.updated_at.desc(), AppAiKbChunk.chunk_index.asc())
                .limit(max_items)
            )
        elif mode == "trgm":
            document_lower = func.lower(_document_text())
            match_clauses = []
            score = None
            coverage = None
            for token in tokens:
                similarity = func.word_similarity(token, document_lower)
                matched = document_lower.op("%>")(token)
                match_clauses.append(matched)
                covered = case((matched, 1), else_=0)
                score = similarity if score is None else score + similarity
                coverage = covered if coverage is None else coverage + covered
            rank = score.label("rank")
            statement = select(AppAiKbChunk, rank).where(or_(*match_clauses))
            if len(tokens) > 1:
                statement = statement.where(coverage >= _needed_coverage(tokens))
                statement = statement.order_by(coverage.desc())
            statement = statement.order_by(rank.desc(), AppAiKbChunk.updated_at.desc(), AppAiKbChunk.chunk_index.asc()).limit(max_items)
        else:
            raise ValueError(f"unsupported retrieval mode: {mode}")
        return self._apply_common_filters(
            statement,
            allowed_scope=allowed_scope,
            current_user=current_user,
            member_department_ids=member_department_ids,
            manager_department_ids=manager_department_ids,
            exact_identifier_tokens=exact_tokens,
        )

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
        payload["backend"] = "postgres_hybrid_fts" if _pg_hybrid_retrieval_enabled() and self._is_postgres_available() else "python"
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
