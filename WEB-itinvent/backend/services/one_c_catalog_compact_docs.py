"""Build compact search documents from catalogue entry fields.

Reuses ``catalog_index_tokens`` so model-separator and ё/е semantics stay
identical to the token-row engine.
"""
from __future__ import annotations

import hashlib
from typing import Any

from backend.services.one_c_catalog_search import catalog_index_tokens, normalize_catalog_text


def _text(value: Any, *, maximum: int | None = None) -> str:
    text = str(value or "").strip()
    return text[:maximum] if maximum is not None else text


def build_search_document_fields(
    code: Any,
    name: Any,
) -> dict[str, Any]:
    """Return normalized fields + search_text + token list for one entry."""
    code_text = _text(code, maximum=200)
    name_text = _text(name)
    code_normalized = normalize_catalog_text(code_text)[:200]
    name_normalized = normalize_catalog_text(name_text)
    tokens = catalog_index_tokens(f"{code_text} {name_text}")
    # search_text: normalized fields + index tokens (for mid-token trigram).
    parts: list[str] = []
    seen: set[str] = set()
    for part in (code_normalized, name_normalized, *tokens):
        if not part or part in seen:
            continue
        seen.add(part)
        parts.append(part)
    search_text = " ".join(parts)
    # FTS document: space-joined index tokens (simple config, not russian).
    tsv_source = " ".join(tokens) if tokens else search_text
    return {
        "code_normalized": code_normalized,
        "name_normalized": name_normalized,
        "search_text": search_text,
        "tsv_source": tsv_source,
        "tokens": tokens,
    }


def escape_tsquery_token(token: str) -> str:
    """Escape a single lexeme for ``to_tsquery('simple', ...)``.

    Only alnum/underscore characters are kept; separators are removed so
    model tokens like ``m-70`` are already compacted by catalog_query_tokens.
    """
    cleaned = "".join(ch if ch.isalnum() or ch == "_" else "" for ch in str(token or ""))
    return cleaned


def build_and_prefix_tsquery(tokens: list[str]) -> str | None:
    """Build ``token1:* & token2:*`` for simple FTS prefix AND matching."""
    return build_and_tsquery(tokens, prefix=True)


def build_and_tsquery(tokens: list[str], *, prefix: bool = True) -> str | None:
    """Build AND tsquery; ``prefix=True`` appends ``:*`` per lexeme.

    Prefer exact lexemes for dense single-token FTS once code/name prefix
    stages have already run — ``:*`` on common brands forces huge postings.
    Keep prefix form for short (2-char) tokens and progressive typing.
    """
    parts: list[str] = []
    for token in tokens:
        escaped = escape_tsquery_token(token)
        if len(escaped) < 2:
            return None
        use_prefix = prefix or len(escaped) < 3
        parts.append(f"{escaped}:*" if use_prefix else escaped)
    if not parts:
        return None
    return " & ".join(parts)


def document_checksum(rows: list[tuple[str, str, str]]) -> str:
    """Stable fingerprint of (entry_ref, code_normalized, name_normalized)."""
    digest = hashlib.sha256()
    for ref, code_n, name_n in rows:
        for value in (ref, code_n, name_n):
            encoded = str(value or "").encode("utf-8")
            digest.update(len(encoded).to_bytes(4, "big"))
            digest.update(encoded)
        digest.update(b"\xff")
    return digest.hexdigest()


def hash_query_shape(text: str, *, catalog_type: str, tokens: list[str]) -> str:
    """Privacy-safe shape hash for shadow logs (no raw query/code/name/ref)."""
    payload = "|".join(
        [
            str(catalog_type or ""),
            str(len(str(text or ""))),
            str(len(tokens)),
            ",".join(str(len(token)) for token in tokens),
            ",".join("1" if any(ch.isdigit() for ch in token) else "0" for token in tokens),
        ]
    )
    return hashlib.sha256(payload.encode("utf-8")).hexdigest()[:16]
