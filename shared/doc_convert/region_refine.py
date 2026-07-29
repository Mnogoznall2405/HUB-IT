"""Region-aware refinement: re-read each block crop from the original page."""

from __future__ import annotations

import base64
import io
import logging
import os
from typing import Any

from PIL import Image

from shared.doc_convert.structure import (
    DEFAULT_VISION_MAX_TOKENS,
    DEFAULT_VISION_TIMEOUT,
    normalize_structure_payload,
    structure_to_markdown,
)

logger = logging.getLogger(__name__)

REGION_REFINE_ENABLED = str(os.getenv("DOC_CONVERT_REGION_REFINE", "1")).strip().lower() not in {
    "0",
    "false",
    "no",
    "off",
}
REGION_REFINE_MAX_BLOCKS = max(1, int(os.getenv("DOC_CONVERT_REGION_REFINE_MAX_BLOCKS", "12") or "12"))

REGION_SCHEMA: dict[str, Any] = {
    "type": "object",
    "additionalProperties": False,
    "properties": {
        "type": {
            "type": "string",
            "enum": ["paragraph", "list", "table", "signature"],
        },
        "text": {"type": "string"},
        "items": {"type": "array", "items": {"type": "string"}},
        "rows": {
            "type": "array",
            "items": {
                "type": "array",
                "items": {"type": "string"},
            },
        },
        "left_text": {"type": "string"},
        "right_text": {"type": "string"},
        "confidence": {"type": "number"},
    },
    "required": [
        "type",
        "text",
        "items",
        "rows",
        "left_text",
        "right_text",
        "confidence",
    ],
}

REGION_SYSTEM = (
    "You re-read ONE cropped region from a document page. "
    "Transcribe ONLY what is visible in this crop. "
    "Keep the same block type. Do not invent text. "
    "Preserve Cyrillic, numbers, punctuation, blank fields. "
    "Return JSON only."
)


def _bbox_usable(bbox: Any) -> bool:
    if not isinstance(bbox, list) or len(bbox) != 4:
        return False
    try:
        x0, y0, x1, y1 = [float(v) for v in bbox]
    except Exception:
        return False
    return x1 - x0 >= 0.03 and y1 - y0 >= 0.02


def crop_region_png(page_png: bytes, bbox_norm: list[float], *, pad: float = 0.01) -> bytes | None:
    try:
        image = Image.open(io.BytesIO(page_png)).convert("RGB")
    except Exception:
        return None
    width, height = image.size
    if width < 8 or height < 8:
        return None
    x0 = max(0.0, float(bbox_norm[0]) - pad)
    y0 = max(0.0, float(bbox_norm[1]) - pad)
    x1 = min(1.0, float(bbox_norm[2]) + pad)
    y1 = min(1.0, float(bbox_norm[3]) + pad)
    if x1 <= x0 or y1 <= y0:
        return None
    left = max(0, int(x0 * width))
    top = max(0, int(y0 * height))
    right = min(width, int(x1 * width))
    bottom = min(height, int(y1 * height))
    if right - left < 8 or bottom - top < 8:
        return None
    cropped = image.crop((left, top, right, bottom))
    buffer = io.BytesIO()
    cropped.save(buffer, format="PNG", optimize=True)
    return buffer.getvalue()


def _merge_region_into_block(block: dict[str, Any], refined: dict[str, Any]) -> dict[str, Any]:
    out = dict(block)
    block_type = str(refined.get("type") or block.get("type") or "paragraph").strip().lower()
    if block_type not in {"paragraph", "list", "table", "signature"}:
        block_type = str(block.get("type") or "paragraph")
    out["type"] = block_type

    text = str(refined.get("text") or "").strip()
    if text:
        out["text"] = text

    items = [str(x).strip() for x in list(refined.get("items") or []) if str(x).strip()]
    if items and block_type == "list":
        out["items"] = items
        out["text"] = "\n".join(f"- {item}" for item in items)

    rows = []
    for row in list(refined.get("rows") or []):
        if not isinstance(row, list):
            continue
        cells = [str(cell or "").strip() for cell in row]
        if any(cells):
            rows.append(cells)
    if rows and block_type == "table":
        out["rows"] = rows

    left_text = str(refined.get("left_text") or "").strip()
    right_text = str(refined.get("right_text") or "").strip()
    if left_text:
        out["left_text"] = left_text
    if right_text:
        out["right_text"] = right_text
    return out


def refine_block_from_crop(
    crop_png: bytes,
    block: dict[str, Any],
    *,
    vision_json_fn=None,
    max_tokens: int = 4000,
    timeout: float = DEFAULT_VISION_TIMEOUT,
) -> dict[str, Any] | None:
    from shared.llm import OpenRouterClientError, openrouter_client

    block_type = str(block.get("type") or "paragraph")
    hint = {
        "type": block_type,
        "text": str(block.get("text") or "")[:500],
        "items": list(block.get("items") or [])[:20],
        "rows": list(block.get("rows") or [])[:20],
        "cells": list(block.get("cells") or [])[:20],
    }
    user_content = [
        {
            "type": "text",
            "text": (
                f"Block type hint: {block_type}\n"
                f"Previous transcription (may be wrong):\n{hint}\n\n"
                "Re-read the crop carefully and return corrected JSON for THIS region only."
            ),
        },
        {
            "type": "image_url",
            "image_url": {
                "url": f"data:image/png;base64,{base64.b64encode(crop_png).decode('ascii')}"
            },
        },
    ]
    try:
        if vision_json_fn is None:
            payload, _usage = openrouter_client.complete_json(
                system_prompt=REGION_SYSTEM,
                user_content=user_content,
                purpose="doc_convert",
                temperature=0.0,
                max_tokens=max_tokens,
                response_schema=REGION_SCHEMA,
                schema_name="doc_convert_region",
                strict_json_schema=True,
                response_healing=True,
                timeout=timeout,
            )
        else:
            payload, _usage = vision_json_fn(
                system_prompt=REGION_SYSTEM,
                user_content=user_content,
                max_tokens=max_tokens,
                timeout=timeout,
            )
    except OpenRouterClientError:
        raise
    except Exception as exc:
        raise OpenRouterClientError(f"Region refine failed: {exc}") from exc

    if not isinstance(payload, dict):
        return None
    return _merge_region_into_block(block, payload)


def enrich_structure_from_regions(
    page_png: bytes,
    structure: dict[str, Any],
    *,
    vision_json_fn=None,
    max_blocks: int | None = None,
) -> tuple[dict[str, Any], list[str]]:
    """Re-transcribe each block using its crop from the original page."""
    if not REGION_REFINE_ENABLED:
        return structure, []

    current = normalize_structure_payload(structure)
    blocks = list(current.get("blocks") or [])
    if not blocks:
        return current, []

    limit = REGION_REFINE_MAX_BLOCKS if max_blocks is None else max(1, int(max_blocks))
    # Prefer larger / text-heavy blocks first.
    ranked = sorted(
        enumerate(blocks),
        key=lambda pair: (
            0 if _bbox_usable(pair[1].get("bbox_norm")) else 1,
            -len(str(pair[1].get("text") or "")),
        ),
    )
    warnings: list[str] = []
    updated = list(blocks)
    refined_count = 0

    for index, block in ranked[:limit]:
        bbox = block.get("bbox_norm")
        if not _bbox_usable(bbox):
            continue
        crop = crop_region_png(page_png, [float(v) for v in bbox])
        if not crop:
            continue
        try:
            refined = refine_block_from_crop(
                crop,
                block,
                vision_json_fn=vision_json_fn,
                max_tokens=min(DEFAULT_VISION_MAX_TOKENS, 6000),
            )
        except Exception as exc:
            logger.warning("doc_convert: region refine block=%s failed: %s", index, exc)
            warnings.append(f"region refine block {index} failed: {exc}")
            continue
        if refined:
            updated[index] = refined
            refined_count += 1

    current["blocks"] = updated
    current = normalize_structure_payload(current)
    if refined_count:
        logger.info(
            "doc_convert: region refine updated=%s/%s chars=%s",
            refined_count,
            len(blocks),
            len(structure_to_markdown(current)),
        )
    return current, warnings
