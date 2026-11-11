from __future__ import annotations

import logging
import os
from typing import Callable

from shared.doc_convert.merge import strip_markdown_fences
from shared.doc_convert.models import PageMarkdown
from shared.doc_convert.render import RenderedPage, page_has_usable_text, text_layer_to_markdown
from shared.llm import OpenRouterClientError, openrouter_client

logger = logging.getLogger(__name__)

VISION_SYSTEM_PROMPT = (
    "You convert scanned or photographed document pages into clean Markdown. "
    "Preserve document structure as closely as possible: centered titles, "
    "headings, paragraphs, bullet/numbered lists, GFM tables, key-value forms, "
    "and signature blocks. "
    "For forms and 2-column tables (label | value), ALWAYS emit a GitHub-flavored "
    "Markdown table with one row per field; keep full phrases in a single cell — "
    "never split one phrase across multiple lines/cells word-by-word. "
    "Do not invent text that is not visible. "
    "Keep bold emphasis with **text** when clearly bold in the source. "
    "For signature areas, keep role/company on the left and /Name/ on the right "
    "as a short paragraph or 2-column table. "
    "Omit repetitive running headers/footers and page numbers when possible. "
    "Return Markdown only — no code fences, no commentary."
)

VISION_USER_PROMPT = (
    "Convert this document page image into clean structured Markdown that matches "
    "the visual layout. "
    "1) Title/header as # or ##. "
    "2) Any grid/form/table as a GFM table (| col | col |). "
    "3) Keep complete sentences and field values on one line inside cells. "
    "4) Preserve signature block after the table. "
    "Do not output one word per line."
)

DEFAULT_VISION_MAX_TOKENS = max(2000, int(os.environ.get("DOC_CONVERT_VISION_MAX_TOKENS", "16000")))


VisionFn = Callable[..., tuple[str, dict]]


def _default_vision(
    *,
    image_bytes: bytes,
    mime_type: str,
    prompt: str,
    system_prompt: str,
    max_tokens: int,
) -> tuple[str, dict]:
    return openrouter_client.complete_vision(
        image_bytes=image_bytes,
        mime_type=mime_type,
        prompt=prompt,
        system_prompt=system_prompt,
        purpose="doc_convert",
        temperature=0.0,
        max_tokens=max_tokens,
    )


def extract_page_markdown(
    page: RenderedPage,
    *,
    force_vision: bool = False,
    vision_fn: VisionFn | None = None,
    max_tokens: int = DEFAULT_VISION_MAX_TOKENS,
) -> PageMarkdown:
    if not force_vision and page_has_usable_text(page.text_layer):
        markdown = text_layer_to_markdown(page.text_layer)
        return PageMarkdown(
            page_index=page.page_index,
            markdown=markdown,
            source="text",
            char_count=len(markdown),
        )

    runner = vision_fn or _default_vision
    try:
        text, _usage = runner(
            image_bytes=page.png_bytes,
            mime_type="image/png",
            prompt=VISION_USER_PROMPT,
            system_prompt=VISION_SYSTEM_PROMPT,
            max_tokens=max_tokens,
        )
    except OpenRouterClientError:
        raise
    except Exception as exc:
        raise OpenRouterClientError(f"Document vision failed: {exc}") from exc

    markdown = strip_markdown_fences(text)
    if not markdown and page.text_layer.strip():
        markdown = text_layer_to_markdown(page.text_layer)
        return PageMarkdown(
            page_index=page.page_index,
            markdown=markdown,
            source="text",
            char_count=len(markdown),
        )
    return PageMarkdown(
        page_index=page.page_index,
        markdown=markdown,
        source="vision",
        char_count=len(markdown),
    )


def extract_pages_markdown(
    pages: list[RenderedPage],
    *,
    force_vision: bool = False,
    vision_fn: VisionFn | None = None,
    max_tokens: int = DEFAULT_VISION_MAX_TOKENS,
) -> list[PageMarkdown]:
    results: list[PageMarkdown] = []
    for page in pages:
        logger.info(
            "doc_convert: extract page=%s source_file=%s force_vision=%s text_chars=%s",
            page.page_index,
            page.source_name,
            force_vision,
            len(page.text_layer or ""),
        )
        results.append(
            extract_page_markdown(
                page,
                force_vision=force_vision,
                vision_fn=vision_fn,
                max_tokens=max_tokens,
            )
        )
    return results
