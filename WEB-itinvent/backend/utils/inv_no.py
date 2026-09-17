"""Inventory-number token normalization shared by equipment queries and act upload.

Both call sites historically defined their own ``_normalize_inv_no_token`` with
different semantics (queries keep non-numeric tokens, act upload drops them).
The shared helper makes the choice explicit via ``strict_digits``.
"""

import re
from typing import Any, Optional


def cleanup_inv_no_candidate(raw: Any) -> Optional[str]:
    """Strip whitespace/№/edge punctuation and collapse ``123.0``-style tokens."""
    text = str(raw or "").strip()
    if not text:
        return None
    text = re.sub(r"\s+", "", text)
    text = text.replace("№", "")
    text = text.strip(".,;:|")
    if not text:
        return None
    if re.fullmatch(r"\d+[.,]0+", text):
        text = re.split(r"[.,]", text, maxsplit=1)[0]
    return text or None


def normalize_inv_no_token(raw: Any, *, strict_digits: bool = False) -> Optional[str]:
    """Normalize an inventory-number token for resilient matching.

    ``strict_digits=False`` keeps non-numeric tokens like ``INV/2``
    (equipment lookup semantics). ``strict_digits=True`` returns ``None`` for
    anything not all-digits and normalizes leading zeros (act upload semantics).
    """
    text = cleanup_inv_no_candidate(raw)
    if not text:
        return None
    if re.fullmatch(r"\d+", text):
        return str(int(text))
    return None if strict_digits else text
