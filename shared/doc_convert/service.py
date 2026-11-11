from __future__ import annotations

import logging
import os
import time
from concurrent.futures import ThreadPoolExecutor, as_completed
from typing import Iterable

from shared.doc_convert.extract import extract_pages_markdown
from shared.doc_convert.merge import count_markdown_tables, merge_page_markdown
from shared.doc_convert.models import ConvertedDocument, ConvertSource, PageMarkdown
from shared.doc_convert.render import DEFAULT_MAX_PAGES, is_image_source, page_has_usable_text, render_source
from shared.doc_convert.structure import extract_page_structure, structure_to_markdown

logger = logging.getLogger(__name__)

DEFAULT_MAX_FILE_BYTES = max(1, int(os.environ.get("DOC_CONVERT_MAX_FILE_MB", "15"))) * 1024 * 1024
USE_STRUCTURED_VISION = str(os.environ.get("DOC_CONVERT_STRUCTURED_VISION", "1")).strip().lower() not in {
    "0",
    "false",
    "no",
    "off",
}
VISION_PAGE_WORKERS = max(1, min(4, int(os.environ.get("DOC_CONVERT_VISION_WORKERS", "3"))))


class DocConvertError(RuntimeError):
    """Raised when document conversion cannot proceed safely."""


def convert_sources(
    sources: Iterable[ConvertSource],
    *,
    max_pages: int = DEFAULT_MAX_PAGES,
    max_file_bytes: int = DEFAULT_MAX_FILE_BYTES,
    force_vision: bool | None = None,
    vision_fn=None,
    vision_json_fn=None,
    high_fidelity: bool = True,
) -> ConvertedDocument:
    source_list = [item for item in list(sources or []) if item and item.data]
    if not source_list:
        raise DocConvertError("Нет файлов для конвертации")

    warnings: list[str] = []
    rendered = []
    page_offset = 0
    source_names: list[str] = []
    remaining_pages = max(1, int(max_pages))

    for source in source_list:
        name = str(source.file_name or "document").strip() or "document"
        source_names.append(name)
        data = bytes(source.data or b"")
        if len(data) > max_file_bytes:
            raise DocConvertError(f"Файл слишком большой: {name}")
        if remaining_pages <= 0:
            warnings.append(f"Пропущены страницы после лимита {max_pages}: {name}")
            break
        force = bool(force_vision) if force_vision is not None else is_image_source(
            file_name=name,
            mime_type=source.mime_type,
        )
        pages = render_source(
            file_name=name,
            data=data,
            mime_type=source.mime_type,
            max_pages=remaining_pages,
            page_index_offset=page_offset,
        )
        if not pages:
            warnings.append(f"Не удалось прочитать: {name}")
            continue
        if force:
            for page in pages:
                page.text_layer = ""
        rendered.extend(pages)
        page_offset += len(pages)
        remaining_pages = max(0, int(max_pages) - len(rendered))

    if not rendered:
        raise DocConvertError("Не удалось подготовить страницы документа")

    if len(rendered) >= max_pages:
        warnings.append(f"Обработаны первые {max_pages} страниц.")

    # Production chat path: structured JSON vision (high fidelity).
    # Unit tests that inject markdown vision_fn without vision_json_fn keep the hybrid path.
    use_structured = bool(
        high_fidelity
        and USE_STRUCTURED_VISION
        and (vision_json_fn is not None or vision_fn is None)
    )

    structure_pages: list[dict] = []
    signatures = []
    page_markdown: list[PageMarkdown] = []

    if use_structured:
        text_pages: list = []
        vision_pages: list = []
        for page in rendered:
            needs_vision = bool(force_vision) or not page_has_usable_text(page.text_layer)
            if not needs_vision:
                text_pages.append(page)
            else:
                vision_pages.append(page)

        def _process_vision_page(page):
            started = time.perf_counter()
            logger.info(
                "doc_convert: structured vision page=%s source_file=%s",
                page.page_index,
                page.source_name,
            )
            try:
                result = extract_page_structure(page, vision_json_fn=vision_json_fn)
                logger.info(
                    "doc_convert: structured vision page=%s finished in %.1fs",
                    page.page_index,
                    time.perf_counter() - started,
                )
                return ("ok", page, result)
            except Exception as exc:
                logger.warning(
                    "doc_convert: structured vision failed page=%s error=%s; falling back",
                    page.page_index,
                    exc,
                )
                return ("fallback", page, exc)

        workers = min(VISION_PAGE_WORKERS, max(1, len(vision_pages)))
        results: list = []
        if vision_pages:
            if workers == 1 or len(vision_pages) == 1:
                results = [_process_vision_page(page) for page in vision_pages]
            else:
                logger.info(
                    "doc_convert: parallel structured vision pages=%s workers=%s",
                    len(vision_pages),
                    workers,
                )
                with ThreadPoolExecutor(max_workers=workers) as pool:
                    futures = [pool.submit(_process_vision_page, page) for page in vision_pages]
                    for future in as_completed(futures):
                        results.append(future.result())
                results.sort(key=lambda item: int(item[1].page_index or 0))

        for status, page, payload in results:
            if status == "ok":
                page_md, structure_payload, crop = payload
                page_markdown.append(page_md)
                structure_pages.append(structure_payload)
                if crop is not None:
                    signatures.append(crop)
            else:
                warnings.append(f"Страница {page.page_index}: structured vision fallback")
                page_markdown.extend(
                    extract_pages_markdown(
                        [page],
                        force_vision=True,
                        vision_fn=vision_fn,
                    )
                )

        if text_pages:
            page_markdown.extend(
                extract_pages_markdown(
                    text_pages,
                    force_vision=False,
                    vision_fn=vision_fn,
                )
            )
        page_markdown.sort(key=lambda item: int(item.page_index or 0))
        structure_pages.sort(key=lambda item: int(item.get("page_index") or 0))
        signatures.sort(key=lambda item: int(item.page_index or 0))
    else:
        page_markdown = extract_pages_markdown(
            rendered,
            force_vision=bool(force_vision),
            vision_fn=vision_fn,
        )

    markdown = merge_page_markdown(page_markdown)
    if not markdown.strip() and structure_pages:
        markdown = "\n\n".join(structure_to_markdown(item) for item in structure_pages).strip()
    if not markdown.strip():
        raise DocConvertError("Не удалось распознать содержимое документа")

    used_vision = any(page.source == "vision" for page in page_markdown) or bool(structure_pages)
    table_count = count_markdown_tables(markdown)
    if not table_count and structure_pages:
        from shared.doc_convert.structure import normalize_structure_payload

        table_count = 0
        for item in structure_pages:
            normalized = normalize_structure_payload(item)
            table_count += sum(1 for block in normalized["blocks"] if block.get("type") == "table")
            # Legacy cached payloads.
            table_count += len(list(item.get("tables") or []))

    fidelities = [
        float(item.get("verify_fidelity") or 0.0)
        for item in structure_pages
        if float(item.get("verify_fidelity") or 0.0) > 0
    ]
    verify_fidelity = (sum(fidelities) / len(fidelities)) if fidelities else 0.0

    logger.info(
        "doc_convert: done pages=%s vision=%s tables=%s signatures=%s chars=%s structured=%s fidelity=%.2f",
        len(page_markdown),
        used_vision,
        table_count,
        len(signatures),
        len(markdown),
        bool(structure_pages),
        verify_fidelity,
    )
    return ConvertedDocument(
        markdown=markdown,
        pages=page_markdown,
        source_names=source_names,
        warnings=warnings,
        table_count=table_count,
        page_count=len(page_markdown) or len(structure_pages),
        used_vision=used_vision,
        structure_pages=structure_pages,
        signatures=signatures,
        verify_fidelity=verify_fidelity,
    )
