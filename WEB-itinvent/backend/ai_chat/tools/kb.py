"""Knowledge base tools for ai_chat: on-demand article search and open."""
from __future__ import annotations

import os
from pathlib import Path
from typing import Any, Optional

from pydantic import BaseModel, Field, field_validator

from backend.ai_chat.tools.base import AiTool, AiToolResult
from backend.ai_chat.tools.context import (
    AiToolExecutionContext,
    KB_TOOL_ARTICLES_GET,
    KB_TOOL_ARTICLES_SEARCH,
    KB_TOOL_ATTACHMENT_GET_TEXT,
    KB_TOOL_ATTACHMENT_SEND,
    KB_TOOL_CATEGORIES_LIST,
)
from backend.ai_chat.tools.registry import ai_tool_registry
from backend.services.kb_service import kb_service
from backend.services.user_service import user_service


def _index_search(*, query: str, limit: int, current_user: dict[str, Any]) -> list[dict[str, Any]]:
    """Full-text KB index search (covers attachment file contents). Empty list on failure."""
    if not _normalize_text(query):
        return []
    try:
        from backend.ai_chat.retrieval_interface import ai_kb_retrieval

        ai_kb_retrieval.ensure_index_fresh()
        hits = ai_kb_retrieval.retrieve(query=query, limit=limit, current_user=current_user)
        return list(hits or [])
    except Exception:
        return []

DEFAULT_LIMIT = 10
# Size cap for a KB file the agent attaches to its answer (the file is read into memory).
KB_SEND_MAX_BYTES = max(1, int(os.environ.get("AI_KB_SEND_MAX_MB", "50") or 50)) * 1024 * 1024
MAX_LIMIT = 20
_MAX_TEXT_FIELD = 2000
_MAX_LIST_ITEMS = 40


def _normalize_text(value: object) -> str:
    return str(value or "").strip()


def _bounded_text(value: object, limit: int = _MAX_TEXT_FIELD) -> str:
    return _normalize_text(value)[:limit]


def _bounded_list(value: Any, limit: int = _MAX_LIST_ITEMS) -> list[str]:
    return [_bounded_text(item, 500) for item in list(value or [])[:limit] if _normalize_text(item)]


def _tool_user(context: AiToolExecutionContext) -> dict[str, Any]:
    user_id = int(context.user_id or 0)
    try:
        user = user_service.get_by_id(user_id)
    except Exception:
        user = None
    return user if isinstance(user, dict) else {"id": user_id}


def _attachment_refs(attachments: list[Any], limit: int = 10) -> list[dict[str, Any]]:
    return [
        {
            "id": _normalize_text(item.get("id")),
            "file_name": _normalize_text(item.get("file_name") or item.get("name")) or None,
        }
        for item in list(attachments or [])[:limit]
        if isinstance(item, dict) and _normalize_text(item.get("id"))
    ]


def _article_card(row: dict[str, Any]) -> dict[str, Any]:
    attachments = row.get("attachments") if isinstance(row.get("attachments"), list) else []
    return {
        "id": _normalize_text(row.get("id")),
        "title": _normalize_text(row.get("title")),
        "category": _normalize_text(row.get("category")) or None,
        "article_type": _normalize_text(row.get("article_type")) or None,
        "summary": _bounded_text(row.get("summary"), 500) or None,
        "tags": [str(tag) for tag in list(row.get("tags") or [])[:12]],
        "status": _normalize_text(row.get("status")) or None,
        "updated_at": _normalize_text(row.get("updated_at")) or None,
        "primary_attachment_id": _normalize_text(row.get("primary_attachment_id")) or None,
        "attachments_count": len(attachments),
        "attachments": _attachment_refs(attachments),
    }


class KbArticlesSearchArgs(BaseModel):
    query: Optional[str] = Field(default=None, max_length=300)
    category: Optional[str] = Field(default=None, max_length=200)
    limit: int = Field(default=DEFAULT_LIMIT, ge=1, le=MAX_LIMIT)

    @field_validator("query", "category", mode="before")
    @classmethod
    def _normalize(cls, value):
        text = _normalize_text(value)
        return text or None


class KbArticlesGetArgs(BaseModel):
    article_id: str = Field(..., min_length=1, max_length=200)

    @field_validator("article_id", mode="before")
    @classmethod
    def _normalize(cls, value):
        return _normalize_text(value)


class KbArticlesSearchTool(AiTool):
    tool_id = KB_TOOL_ARTICLES_SEARCH
    description = (
        "Search Hub knowledge base articles by free text and optional category. "
        "Matches article text AND attachment file contents via the full-text index. "
        "Returns compact article cards (id, title, summary, tags); open the needed one with kb.articles.get."
    )
    input_model = KbArticlesSearchArgs
    stage = "checking_kb"

    def execute(self, *, context: AiToolExecutionContext, args: KbArticlesSearchArgs) -> AiToolResult:
        user = _tool_user(context)
        try:
            result = kb_service.list_articles(
                q=_normalize_text(args.query),
                category=_normalize_text(args.category),
                status="published",
                limit=int(args.limit or DEFAULT_LIMIT),
                current_user=user,
            )
        except Exception as exc:
            return AiToolResult(tool_id=self.tool_id, ok=False, error=str(exc))
        items = result.get("items") if isinstance(result, dict) else []
        cards = []
        seen_ids: set[str] = set()
        for row in items or []:
            if not isinstance(row, dict):
                continue
            card = _article_card(row)
            card["match_source"] = "article_text"
            cards.append(card)
            if card["id"]:
                seen_ids.add(card["id"])
        for hit in _index_search(query=_normalize_text(args.query), limit=int(args.limit or DEFAULT_LIMIT), current_user=user):
            article_id = _normalize_text(hit.get("article_id"))
            if not article_id or article_id in seen_ids:
                continue
            seen_ids.add(article_id)
            cards.append(
                {
                    "id": article_id,
                    "title": _normalize_text(hit.get("title")) or None,
                    "category": _normalize_text(hit.get("category")) or None,
                    "article_type": _normalize_text(hit.get("article_type")) or None,
                    "summary": _bounded_text(hit.get("summary"), 500) or None,
                    "tags": [str(tag) for tag in list(hit.get("tags") or [])[:12]],
                    "status": None,
                    "updated_at": None,
                    "primary_attachment_id": _normalize_text(hit.get("primary_attachment_id")) or None,
                    "primary_attachment_name": _normalize_text(hit.get("primary_attachment_name")) or None,
                    "attachments_count": 0,
                    "match_source": "full_text_index",
                    "score": hit.get("score"),
                }
            )
        return AiToolResult(
            tool_id=self.tool_id,
            ok=True,
            data={
                "total": result.get("total") if isinstance(result, dict) else len(items or []),
                "count": len(cards),
                "items": cards[: MAX_LIMIT],
            },
        )


class KbArticlesGetTool(AiTool):
    tool_id = KB_TOOL_ARTICLES_GET
    description = (
        "Open one knowledge base article by id and return its structured content "
        "(overview, symptoms, checks, commands, resolution steps, faq) and attachment metadata."
    )
    input_model = KbArticlesGetArgs
    stage = "checking_kb"

    def execute(self, *, context: AiToolExecutionContext, args: KbArticlesGetArgs) -> AiToolResult:
        try:
            article = kb_service.get_article(args.article_id, current_user=_tool_user(context))
        except Exception as exc:
            return AiToolResult(tool_id=self.tool_id, ok=False, error=str(exc))
        if not isinstance(article, dict):
            return AiToolResult(tool_id=self.tool_id, ok=False, error="KB article not found.")
        content = article.get("content") if isinstance(article.get("content"), dict) else {}
        attachments = [
            {
                "id": _normalize_text(item.get("id")),
                "file_name": _normalize_text(item.get("file_name") or item.get("name")) or None,
                "size": item.get("size"),
            }
            for item in list(article.get("attachments") or [])[:20]
            if isinstance(item, dict)
        ]
        return AiToolResult(
            tool_id=self.tool_id,
            ok=True,
            data={
                "id": _normalize_text(article.get("id")),
                "title": _normalize_text(article.get("title")),
                "category": _normalize_text(article.get("category")) or None,
                "article_type": _normalize_text(article.get("article_type")) or None,
                "summary": _bounded_text(article.get("summary")) or None,
                "tags": [str(tag) for tag in list(article.get("tags") or [])[:12]],
                "updated_at": _normalize_text(article.get("updated_at")) or None,
                "content": {
                    "overview": _bounded_text(content.get("overview")),
                    "symptoms": _bounded_text(content.get("symptoms")),
                    "checks": _bounded_list(content.get("checks")),
                    "commands": _bounded_list(content.get("commands")),
                    "resolution_steps": _bounded_list(content.get("resolution_steps")),
                    "rollback_steps": _bounded_list(content.get("rollback_steps")),
                    "escalation": _bounded_text(content.get("escalation")),
                    "faq": [
                        {"question": _bounded_text(item.get("question"), 300), "answer": _bounded_text(item.get("answer"))}
                        for item in list(content.get("faq") or [])[:20]
                        if isinstance(item, dict)
                    ],
                },
                "primary_attachment_id": _normalize_text(article.get("primary_attachment_id")) or None,
                "attachments": attachments,
            },
        )


class KbAttachmentGetTextArgs(BaseModel):
    article_id: str = Field(..., min_length=1, max_length=200)
    attachment_id: str = Field(..., min_length=1, max_length=200)

    @field_validator("article_id", "attachment_id", mode="before")
    @classmethod
    def _normalize(cls, value):
        return _normalize_text(value)


class KbAttachmentGetTextTool(AiTool):
    tool_id = KB_TOOL_ATTACHMENT_GET_TEXT
    description = (
        "Extract and return text content of a KB article attachment (docx, pdf, xlsx, txt, images). "
        "Use after kb.articles.get when the needed data lives inside an attached file."
    )
    input_model = KbAttachmentGetTextArgs
    stage = "checking_kb"

    def execute(self, *, context: AiToolExecutionContext, args: KbAttachmentGetTextArgs) -> AiToolResult:
        user = _tool_user(context)
        try:
            article = kb_service.get_article(args.article_id, current_user=user)
        except Exception as exc:
            return AiToolResult(tool_id=self.tool_id, ok=False, error=str(exc))
        if not isinstance(article, dict):
            return AiToolResult(tool_id=self.tool_id, ok=False, error="KB article not found.")
        try:
            attachment = kb_service.get_attachment(
                article_id=args.article_id,
                attachment_id=args.attachment_id,
            )
        except Exception as exc:
            return AiToolResult(tool_id=self.tool_id, ok=False, error=str(exc))
        if not isinstance(attachment, dict):
            return AiToolResult(tool_id=self.tool_id, ok=False, error="KB attachment not found.")
        try:
            from backend.ai_chat.document_extractors import extract_text_from_path

            text = extract_text_from_path(
                attachment.get("path") or "",
                file_name=attachment.get("file_name") or "",
                mime_type=attachment.get("content_type") or "",
            )
        except Exception as exc:
            return AiToolResult(tool_id=self.tool_id, ok=False, error=str(exc))
        if not _normalize_text(text):
            return AiToolResult(
                tool_id=self.tool_id,
                ok=False,
                error="No text could be extracted from this attachment.",
            )
        return AiToolResult(
            tool_id=self.tool_id,
            ok=True,
            data={
                "article_id": args.article_id,
                "attachment_id": args.attachment_id,
                "file_name": _normalize_text(attachment.get("file_name") or attachment.get("name")) or None,
                "content_type": _normalize_text(attachment.get("content_type")) or None,
                "text": _bounded_text(text, 12000),
            },
        )


class KbCategoriesListArgs(BaseModel):
    pass


class KbCategoriesListTool(AiTool):
    tool_id = KB_TOOL_CATEGORIES_LIST
    description = "List Hub knowledge base categories for filtering kb.articles.search."
    input_model = KbCategoriesListArgs
    stage = "checking_kb"

    def execute(self, *, context: AiToolExecutionContext, args: BaseModel) -> AiToolResult:
        try:
            categories = kb_service.list_categories()
        except Exception as exc:
            return AiToolResult(tool_id=self.tool_id, ok=False, error=str(exc))
        return AiToolResult(
            tool_id=self.tool_id,
            ok=True,
            data={"count": len(categories or []), "items": list(categories or [])[:50]},
        )


class KbAttachmentSendTool(AiTool):
    tool_id = KB_TOOL_ATTACHMENT_SEND
    description = (
        "Attach a file from a published knowledge base article (form, template, instruction, document) "
        "to your answer in this chat. Find it first with kb.articles.search / kb.articles.get and pass "
        "article_id and attachment_id. The file is delivered right after your text answer; call this "
        "only when the user asked for the file itself, and never claim delivery if this tool failed."
    )
    input_model = KbAttachmentGetTextArgs
    stage = "checking_kb"

    def execute(self, *, context: AiToolExecutionContext, args: KbAttachmentGetTextArgs) -> AiToolResult:
        if not bool(getattr(context, "allow_kb_document_delivery", False)):
            return AiToolResult(
                tool_id=self.tool_id,
                ok=False,
                error=(
                    "Отправка файлов из базы знаний выключена в настройках агента. "
                    "Дай ссылку на статью вместо файла."
                ),
            )
        user = _tool_user(context)
        try:
            article = kb_service.get_article(args.article_id, current_user=user)
        except Exception as exc:
            return AiToolResult(tool_id=self.tool_id, ok=False, error=str(exc))
        if not isinstance(article, dict):
            return AiToolResult(tool_id=self.tool_id, ok=False, error="KB article not found or not available to this employee.")
        if _normalize_text(article.get("status")).lower() != "published":
            return AiToolResult(tool_id=self.tool_id, ok=False, error="Only files of published KB articles can be sent.")
        try:
            attachment = kb_service.get_attachment(
                article_id=args.article_id,
                attachment_id=args.attachment_id,
                current_user=user,
            )
        except Exception as exc:
            return AiToolResult(tool_id=self.tool_id, ok=False, error=str(exc))
        if not isinstance(attachment, dict):
            return AiToolResult(tool_id=self.tool_id, ok=False, error="KB attachment not found.")
        try:
            size = Path(str(attachment.get("path") or "")).stat().st_size
        except OSError:
            return AiToolResult(tool_id=self.tool_id, ok=False, error="KB attachment file is missing on the server.")
        if size > KB_SEND_MAX_BYTES:
            return AiToolResult(
                tool_id=self.tool_id,
                ok=False,
                error=(
                    f"Файл слишком большой для отправки в чат ({size // (1024 * 1024)} МБ, "
                    f"лимит {KB_SEND_MAX_BYTES // (1024 * 1024)} МБ). Дай ссылку на статью."
                ),
            )
        return AiToolResult(
            tool_id=self.tool_id,
            ok=True,
            data={
                "article_id": args.article_id,
                "attachment_id": args.attachment_id,
                "article_title": _normalize_text(article.get("title")) or None,
                "file_name": _normalize_text(attachment.get("file_name") or attachment.get("name")) or None,
                "size": size,
                "delivery": "attached_after_answer",
            },
        )


for tool in [
    KbArticlesSearchTool(),
    KbArticlesGetTool(),
    KbAttachmentGetTextTool(),
    KbAttachmentSendTool(),
    KbCategoriesListTool(),
]:
    ai_tool_registry.register(tool)
