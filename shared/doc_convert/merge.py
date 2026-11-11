from __future__ import annotations

import re

from shared.doc_convert.models import PageMarkdown

_HEADER_FOOTER_RE = re.compile(r"^\s*(page|стр\.?|страница)\s*\d+(\s*(of|/|из)\s*\d+)?\s*$", re.IGNORECASE)
_FENCE_RE = re.compile(r"^```(?:markdown|md)?\s*$", re.IGNORECASE)


def strip_markdown_fences(text: str) -> str:
    lines = str(text or "").replace("\r\n", "\n").replace("\r", "\n").split("\n")
    if len(lines) >= 2 and _FENCE_RE.match(lines[0].strip()) and lines[-1].strip() == "```":
        lines = lines[1:-1]
    return "\n".join(lines).strip()


def _normalize_line(line: str) -> str:
    return re.sub(r"\s+", " ", str(line or "").strip()).lower()


def _is_likely_running_header(line: str) -> bool:
    normalized = _normalize_line(line)
    if not normalized:
        return False
    if _HEADER_FOOTER_RE.match(normalized):
        return True
    if normalized.isdigit() and len(normalized) <= 4:
        return True
    return False


def dedupe_repeated_headers(pages: list[PageMarkdown]) -> list[PageMarkdown]:
    if len(pages) < 2:
        return pages
    first_lines: list[str] = []
    for page in pages:
        for line in page.markdown.splitlines():
            if line.strip():
                first_lines.append(_normalize_line(line))
                break
    if len(first_lines) < 2:
        return pages
    counts: dict[str, int] = {}
    for line in first_lines:
        counts[line] = counts.get(line, 0) + 1
    repeated = {line for line, count in counts.items() if count >= 2 and line}
    if not repeated:
        return pages
    result: list[PageMarkdown] = []
    for page in pages:
        lines = page.markdown.splitlines()
        cleaned: list[str] = []
        skipped_first = False
        for line in lines:
            if not skipped_first and line.strip() and _normalize_line(line) in repeated:
                skipped_first = True
                continue
            if _is_likely_running_header(line):
                continue
            cleaned.append(line)
        result.append(
            PageMarkdown(
                page_index=page.page_index,
                markdown="\n".join(cleaned).strip(),
                source=page.source,
                char_count=len("\n".join(cleaned).strip()),
            )
        )
    return result


def merge_page_markdown(pages: list[PageMarkdown]) -> str:
    cleaned = dedupe_repeated_headers(pages)
    chunks: list[str] = []
    for page in cleaned:
        text = strip_markdown_fences(page.markdown)
        if not text:
            continue
        chunks.append(text)
    return "\n\n".join(chunks).strip()


def count_markdown_tables(markdown: str) -> int:
    count = 0
    lines = str(markdown or "").splitlines()
    index = 0
    while index < len(lines) - 1:
        line = lines[index].strip()
        next_line = lines[index + 1].strip()
        if "|" in line and re.match(r"^\|?\s*:?-{3,}", next_line):
            count += 1
            index += 2
            while index < len(lines) and "|" in lines[index]:
                index += 1
            continue
        index += 1
    return count
