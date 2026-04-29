from __future__ import annotations

import hashlib
import json
import logging
import os
import re
import threading
import time
from datetime import datetime, timezone
from typing import Any
from uuid import uuid4

from sqlalchemy import delete, select

from backend.ai_chat.document_extractors import extract_text_from_path
from backend.appdb.db import app_session, ensure_app_schema_initialized
from backend.appdb.models import AppAiKbChunk, AppAiKbDocument
from backend.services.kb_service import kb_service

TOKEN_RE = re.compile(r"[0-9A-Za-zА-Яа-яЁё_]{3,}", flags=re.UNICODE)
logger = logging.getLogger(__name__)


def _utc_now() -> datetime:
    return datetime.now(timezone.utc)


def _normalize_text(value: object) -> str:
    return str(value or "").strip()


def _env_float(name: str, default: float, minimum: float, maximum: float) -> float:
    raw = _normalize_text(os.getenv(name)) or str(default)
    try:
        value = float(raw)
    except Exception:
        value = float(default)
    return max(minimum, min(maximum, value))


def _normalize_tags(value: Any) -> list[str]:
    if not isinstance(value, list):
        return []
    return [str(item or "").strip() for item in value if str(item or "").strip()]


def _article_to_text(article: dict[str, Any]) -> str:
    content = article.get("content") if isinstance(article.get("content"), dict) else {}
    lines = [
        _normalize_text(article.get("title")),
        _normalize_text(article.get("summary")),
        _normalize_text(content.get("overview")),
        _normalize_text(content.get("symptoms")),
        _normalize_text(content.get("escalation")),
    ]
    for key in ("checks", "commands", "resolution_steps", "rollback_steps"):
        values = content.get(key) if isinstance(content, dict) else []
        if isinstance(values, list):
            lines.extend(_normalize_text(item) for item in values if _normalize_text(item))
    faq = content.get("faq") if isinstance(content, dict) else []
    if isinstance(faq, list):
        for item in faq:
            if not isinstance(item, dict):
                continue
            lines.append(_normalize_text(item.get("question")))
            lines.append(_normalize_text(item.get("answer")))
    return "\n".join(line for line in lines if line)


def _chunk_text(text: str, *, size: int = 1200, overlap: int = 180) -> list[str]:
    normalized = _normalize_text(text)
    if not normalized:
        return []
    chunks: list[str] = []
    start = 0
    while start < len(normalized):
        end = min(len(normalized), start + size)
        chunks.append(normalized[start:end].strip())
        if end >= len(normalized):
            break
        start = max(0, end - overlap)
    return [chunk for chunk in chunks if chunk]


def _tokenize(value: str) -> list[str]:
    return [item.lower() for item in TOKEN_RE.findall(str(value or ""))]


def _load_json_object(raw_value: Any) -> dict[str, Any]:
    try:
        payload = json.loads(str(raw_value or "{}"))
    except Exception:
        return {}
    return payload if isinstance(payload, dict) else {}


def _chunk_metadata_payload(
    *,
    article: dict[str, Any],
    primary_attachment: dict[str, Any] | None,
) -> dict[str, Any]:
    return {
        "article_id": _normalize_text(article.get("id")),
        "title": _normalize_text(article.get("title")),
        "category": _normalize_text(article.get("category")),
        "article_type": _normalize_text(article.get("article_type")),
        "summary": _normalize_text(article.get("summary")),
        "tags": _normalize_tags(article.get("tags")),
        "primary_attachment_id": _normalize_text((primary_attachment or {}).get("id")),
        "primary_attachment_name": _normalize_text((primary_attachment or {}).get("file_name")),
        "primary_attachment_content_type": _normalize_text((primary_attachment or {}).get("content_type")),
    }


class AiKbRetrievalService:
    def __init__(self) -> None:
        self._sync_lock = threading.Lock()
        self._last_sync_monotonic = 0.0
        self._sync_interval_sec = _env_float("AI_KB_INDEX_FRESHNESS_TTL_SEC", 30.0, 1.0, 3600.0)

    def sync_index(self, *, image_extractor=None) -> None:
        ensure_app_schema_initialized()
        source = kb_service.list_articles(status="published", limit=500, offset=0)
        articles = list(source.get("items") or [])
        published_ids = {str(item.get("id") or "").strip() for item in articles if str(item.get("id") or "").strip()}

        with app_session() as session:
            existing_docs = {
                str(item.kb_article_id): item
                for item in session.scalars(select(AppAiKbDocument)).all()
                if str(item.kb_article_id or "").strip()
            }
            for article in articles:
                article_id = str(article.get("id") or "").strip()
                if not article_id:
                    continue
                attachment_texts: list[str] = []
                primary_attachment = kb_service.resolve_effective_primary_attachment(article)
                for attachment in list(article.get("attachments") or []):
                    attachment_id = str((attachment or {}).get("id") or "").strip()
                    if not attachment_id:
                        continue
                    resolved = kb_service.get_attachment(article_id=article_id, attachment_id=attachment_id)
                    if not resolved:
                        continue
                    extracted = extract_text_from_path(
                        resolved.get("path") or "",
                        file_name=resolved.get("file_name") or "",
                        mime_type=resolved.get("content_type") or "",
                        image_extractor=image_extractor,
                    )
                    if extracted:
                        attachment_texts.append(extracted[:12000])
                base_text = _article_to_text(article)
                attachment_blob = "\n\n".join(attachment_texts)
                combined = "\n\n".join(part for part in [base_text, attachment_blob] if part).strip()
                content_hash = hashlib.sha256(
                    json.dumps(
                        {
                            "updated_at": article.get("updated_at"),
                            "title": article.get("title"),
                            "summary": article.get("summary"),
                            "article_type": article.get("article_type"),
                            "primary_attachment_id": _normalize_text((primary_attachment or {}).get("id")),
                            "content": article.get("content"),
                            "attachments": [
                                {
                                    "id": item.get("id"),
                                    "file_name": item.get("file_name"),
                                    "size": item.get("size"),
                                    "uploaded_at": item.get("uploaded_at"),
                                }
                                for item in list(article.get("attachments") or [])
                            ],
                        },
                        ensure_ascii=False,
                        sort_keys=True,
                    ).encode("utf-8")
                ).hexdigest()

                doc = existing_docs.get(article_id)
                if doc is not None and str(doc.content_hash or "") == content_hash:
                    continue
                if doc is None:
                    doc = AppAiKbDocument(
                        id=str(uuid4()),
                        kb_article_id=article_id,
                    )
                    session.add(doc)
                    session.flush()
                doc.title = _normalize_text(article.get("title"))
                doc.status = "published"
                doc.content_hash = content_hash
                doc.payload_json = json.dumps(
                    {
                        "article_id": article_id,
                        "title": article.get("title"),
                        "summary": article.get("summary"),
                        "category": article.get("category"),
                        "article_type": article.get("article_type"),
                        "tags": list(article.get("tags") or []),
                        "primary_attachment_id": _normalize_text((primary_attachment or {}).get("id")),
                        "primary_attachment_name": _normalize_text((primary_attachment or {}).get("file_name")),
                        "primary_attachment_content_type": _normalize_text((primary_attachment or {}).get("content_type")),
                        "updated_at": article.get("updated_at"),
                    },
                    ensure_ascii=False,
                )
                doc.updated_at = _utc_now()
                session.execute(delete(AppAiKbChunk).where(AppAiKbChunk.document_id == doc.id))
                for index, chunk in enumerate(_chunk_text(combined)):
                    metadata_payload = _chunk_metadata_payload(
                        article=article,
                        primary_attachment=primary_attachment,
                    )
                    session.add(
                        AppAiKbChunk(
                            id=str(uuid4()),
                            document_id=doc.id,
                            kb_article_id=article_id,
                            chunk_index=index,
                            title=doc.title,
                            content=chunk,
                            metadata_json=json.dumps(metadata_payload, ensure_ascii=False),
                        )
                    )
            for article_id, doc in existing_docs.items():
                if article_id in published_ids:
                    continue
                session.execute(delete(AppAiKbChunk).where(AppAiKbChunk.document_id == doc.id))
                session.delete(doc)
        self._last_sync_monotonic = time.monotonic()

    def ensure_index_fresh(self, *, image_extractor=None, max_age_sec: float | None = None) -> None:
        age_limit = float(max_age_sec if max_age_sec is not None else self._sync_interval_sec)
        now = time.monotonic()
        if self._last_sync_monotonic > 0 and (now - self._last_sync_monotonic) < age_limit:
            logger.debug("AI KB index is fresh; skipping sync: age_sec=%.1f ttl_sec=%.1f", now - self._last_sync_monotonic, age_limit)
            return
        with self._sync_lock:
            now = time.monotonic()
            if self._last_sync_monotonic > 0 and (now - self._last_sync_monotonic) < age_limit:
                logger.debug("AI KB index is fresh after lock; skipping sync: age_sec=%.1f ttl_sec=%.1f", now - self._last_sync_monotonic, age_limit)
                return
            self.sync_index(image_extractor=image_extractor)

    def get_metrics(self) -> dict[str, float | str]:
        now = time.monotonic()
        age_sec = 0.0 if self._last_sync_monotonic <= 0 else max(0.0, now - self._last_sync_monotonic)
        return {
            "backend": "python",
            "index_age_sec": round(age_sec, 1),
            "freshness_ttl_sec": round(float(self._sync_interval_sec), 1),
        }

    def retrieve(self, *, query: str, allowed_scope: list[str] | None = None, limit: int = 5) -> list[dict[str, Any]]:
        ensure_app_schema_initialized()
        tokens = _tokenize(query)
        if not tokens:
            return []
        allowed = {str(item or "").strip().lower() for item in list(allowed_scope or []) if str(item or "").strip()}
        with app_session() as session:
            rows = session.scalars(select(AppAiKbChunk)).all()
        scored: list[tuple[int, AppAiKbChunk]] = []
        for row in rows:
            metadata = _load_json_object(row.metadata_json)
            category = str(metadata.get("category") or "").strip().lower()
            if allowed and category not in allowed:
                continue
            haystack = f"{row.title}\n{row.content}".lower()
            score = 0
            for token in tokens:
                score += haystack.count(token) * 3
                if token in str(row.title or "").lower():
                    score += 4
            if score <= 0:
                continue
            scored.append((score, row))
        scored.sort(key=lambda item: (item[0], -int(item[1].chunk_index or 0)), reverse=True)
        payloads: list[dict[str, Any]] = []
        for score, row in scored[: max(1, int(limit or 5))]:
            metadata = _load_json_object(row.metadata_json)
            payloads.append(
                {
                    "score": score,
                    "article_id": row.kb_article_id,
                    "title": str(metadata.get("title") or row.title or "").strip(),
                    "category": str(metadata.get("category") or "").strip(),
                    "content": str(row.content or "").strip(),
                    "article_type": str(metadata.get("article_type") or "").strip(),
                    "summary": str(metadata.get("summary") or "").strip(),
                    "tags": _normalize_tags(metadata.get("tags")),
                    "primary_attachment_id": str(metadata.get("primary_attachment_id") or "").strip(),
                    "primary_attachment_name": str(metadata.get("primary_attachment_name") or "").strip(),
                    "primary_attachment_content_type": str(metadata.get("primary_attachment_content_type") or "").strip(),
                }
            )
        return payloads

    def retrieve_template_candidates(
        self,
        *,
        query: str,
        allowed_scope: list[str] | None = None,
        limit: int = 5,
    ) -> list[dict[str, Any]]:
        ensure_app_schema_initialized()
        tokens = _tokenize(query)
        if not tokens:
            return []
        allowed = {str(item or "").strip().lower() for item in list(allowed_scope or []) if str(item or "").strip()}
        with app_session() as session:
            chunks = session.scalars(select(AppAiKbChunk)).all()
        best_by_article: dict[str, dict[str, Any]] = {}
        for row in chunks:
            metadata = _load_json_object(row.metadata_json)
            article_id = _normalize_text(metadata.get("article_id") or row.kb_article_id)
            if not article_id:
                continue
            if _normalize_text(metadata.get("article_type")).lower() != "template":
                continue
            category = _normalize_text(metadata.get("category")).lower()
            if allowed and category not in allowed:
                continue
            primary_attachment_id = _normalize_text(metadata.get("primary_attachment_id"))
            if not primary_attachment_id:
                continue
            haystack = "\n".join(
                part for part in [
                    _normalize_text(metadata.get("title") or row.title),
                    _normalize_text(metadata.get("summary")),
                    " ".join(_normalize_tags(metadata.get("tags"))),
                    _normalize_text(row.content),
                ]
                if part
            ).lower()
            score = 0
            for token in tokens:
                score += haystack.count(token) * 3
                if token in _normalize_text(metadata.get("title") or row.title).lower():
                    score += 5
                if token in _normalize_text(metadata.get("summary")).lower():
                    score += 2
            if score <= 0:
                continue
            current = best_by_article.get(article_id)
            if current is not None and int(current.get("score") or 0) >= score:
                continue
            best_by_article[article_id] = {
                "score": score,
                "article_id": article_id,
                "title": _normalize_text(metadata.get("title") or row.title),
                "category": _normalize_text(metadata.get("category")),
                "summary": _normalize_text(metadata.get("summary")),
                "tags": _normalize_tags(metadata.get("tags")),
                "content_preview": _normalize_text(row.content),
                "attachment_id": primary_attachment_id,
                "attachment_name": _normalize_text(metadata.get("primary_attachment_name")),
                "attachment_content_type": _normalize_text(metadata.get("primary_attachment_content_type")),
            }
        ranked = sorted(
            best_by_article.values(),
            key=lambda item: (int(item.get("score") or 0), item.get("title") or ""),
            reverse=True,
        )
        return ranked[: max(1, int(limit or 5))]


ai_kb_retrieval_service = AiKbRetrievalService()
