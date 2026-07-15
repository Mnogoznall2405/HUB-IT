"""Shared normalization and relevance rules for 1C catalogue search.

1C remains read-only.  These helpers only normalize text from the app-owned
catalogue snapshot so every search backend uses the same case-insensitive
semantics.
"""
from __future__ import annotations

import hashlib
import re
from functools import lru_cache
from typing import Any


_ALNUM_CLASS = "0-9A-Za-zА-Яа-яЁё"
_WORD_RE = re.compile(rf"[{_ALNUM_CLASS}]+", re.UNICODE)
_SEPARATED_MODEL_RE = re.compile(
    rf"[{_ALNUM_CLASS}]+(?:[-_./\\]+[{_ALNUM_CLASS}]+)+",
    re.UNICODE,
)
_SPACED_MODEL_RE = re.compile(
    rf"(?<![{_ALNUM_CLASS}])(?:[A-Za-zА-Яа-яЁё]\s+\d[{_ALNUM_CLASS}]*|\d+\s+[A-Za-zА-Яа-яЁё][{_ALNUM_CLASS}]*)(?![{_ALNUM_CLASS}])",
    re.UNICODE,
)
_NON_ALNUM_RE = re.compile(rf"[^{_ALNUM_CLASS}]+", re.UNICODE)
_WHITESPACE_RE = re.compile(r"\s+")


def normalize_catalog_text(value: Any) -> str:
    return _WHITESPACE_RE.sub(" ", str(value or "").casefold()).strip()


def catalog_rows_fingerprint(rows: Any) -> str:
    """Hash canonical JSON-style catalogue rows without joining them in RAM."""
    digest = hashlib.sha256()
    for row in rows or []:
        values = row if isinstance(row, (list, tuple)) else ()
        for value in values:
            encoded = str(value or "").encode("utf-8")
            digest.update(len(encoded).to_bytes(4, "big"))
            digest.update(encoded)
        digest.update(b"\xff")
    return digest.hexdigest()


def _compact(value: str) -> str:
    return _NON_ALNUM_RE.sub("", value.casefold())


def _model_fragments(value: str) -> list[tuple[int, int, str]]:
    text = str(value or "")
    spans: list[tuple[int, int, str]] = []
    for pattern in (_SEPARATED_MODEL_RE, _SPACED_MODEL_RE):
        for match in pattern.finditer(text):
            compact = _compact(match.group(0))[:200]
            if len(compact) < 2 or not any(ch.isalpha() for ch in compact) or not any(ch.isdigit() for ch in compact):
                continue
            spans.append((match.start(), match.end(), compact))
    spans.sort(key=lambda row: (row[0], -(row[1] - row[0])))
    selected: list[tuple[int, int, str]] = []
    for row in spans:
        if any(row[0] < existing[1] and existing[0] < row[1] for existing in selected):
            continue
        selected.append(row)
    return selected


def catalog_index_tokens(value: Any) -> list[str]:
    """Tokens stored for a 1C catalogue entry.

    Alongside ordinary words, model/part-number fragments get a compact form:
    ``M-70`` and ``M 70`` both add ``m70``.  This keeps spelling differences
    from turning into false "not found" results.
    """
    text = str(value or "")
    candidates: list[tuple[int, str]] = []
    for start, _end, token in _model_fragments(text):
        candidates.append((start, token))
    for match in _SEPARATED_MODEL_RE.finditer(text):
        token = match.group(0).casefold()[:200]
        if len(token) >= 2:
            candidates.append((match.start(), token))
    for match in _WORD_RE.finditer(text):
        token = match.group(0).casefold()[:200]
        if len(token) >= 2:
            candidates.append((match.start(), token))

    seen: set[str] = set()
    result: list[str] = []
    for _position, token in sorted(candidates, key=lambda row: row[0]):
        if token in seen:
            continue
        seen.add(token)
        result.append(token)
    return result


def catalog_query_tokens(value: Any) -> list[str]:
    """Return ordered AND-tokens for a user query."""
    text = str(value or "")
    model_spans = _model_fragments(text)
    candidates: list[tuple[int, str]] = [(start, token) for start, _end, token in model_spans]

    def overlaps_model(start: int, end: int) -> bool:
        return any(start < model_end and model_start < end for model_start, model_end, _token in model_spans)

    for match in _WORD_RE.finditer(text):
        if overlaps_model(match.start(), match.end()):
            continue
        token = match.group(0).casefold()[:200]
        if len(token) >= 2:
            candidates.append((match.start(), token))

    seen: set[str] = set()
    result: list[str] = []
    for _position, token in sorted(candidates, key=lambda row: row[0]):
        if token in seen:
            continue
        seen.add(token)
        result.append(token)
    if result:
        return result
    normalized = normalize_catalog_text(text)
    return [normalized] if len(normalized) >= 2 else []


@lru_cache(maxsize=512)
def _separator_tolerant_pattern(token: str) -> re.Pattern[str] | None:
    pieces: list[str] = []
    has_transition = False
    previous = ""
    for character in token:
        if previous and (
            (previous.isalpha() and character.isdigit())
            or (previous.isdigit() and character.isalpha())
        ):
            pieces.append(r"[-_./\\\s]*")
            has_transition = True
        pieces.append(re.escape(character))
        previous = character
    return re.compile("".join(pieces), re.IGNORECASE) if has_transition else None


def _entry_contains_query(haystack: str, query_tokens: list[str]) -> bool:
    for query in query_tokens:
        if query in haystack:
            continue
        pattern = _separator_tolerant_pattern(query)
        if pattern is None or pattern.search(haystack) is None:
            return False
    return True


def catalog_entry_match_rank(code: Any, name: Any, query_tokens: list[str]) -> int | None:
    """Return relevance bucket, or ``None`` when an entry does not match.

    Exact model/code tokens rank first, token prefixes such as ``M70q`` rank
    second, and arbitrary internal occurrences (for example in a long serial
    or article) rank last.
    """
    if not query_tokens:
        return None
    # The legacy JSON fallback can contain ~710k rows.  Reject ordinary misses
    # with cheap substring checks before tokenizing the handful of matches.
    haystack = f"{str(code or '').casefold()} {str(name or '').casefold()}"
    if not _entry_contains_query(haystack, query_tokens):
        return None
    entry_tokens = catalog_index_tokens(f"{code or ''} {name or ''}")
    if not entry_tokens or not all(any(query in token for token in entry_tokens) for query in query_tokens):
        return None
    primary = query_tokens[0]
    if primary in entry_tokens:
        return 0
    if any(token.startswith(primary) for token in entry_tokens):
        return 1
    return 2
