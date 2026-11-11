"""Structured page extraction + signature crop helpers for high-fidelity export."""

from __future__ import annotations

import base64
import io
import logging
import os
from typing import Any

from shared.doc_convert.models import PageMarkdown, SignatureCrop
from shared.doc_convert.render import RenderedPage

logger = logging.getLogger(__name__)

try:
    from PIL import Image  # type: ignore
except Exception:  # pragma: no cover
    Image = None

DEFAULT_VISION_MAX_TOKENS = max(2000, int(os.environ.get("DOC_CONVERT_VISION_MAX_TOKENS", "16000")))
DEFAULT_VISION_TIMEOUT = float(os.environ.get("DOC_CONVERT_VISION_TIMEOUT_SEC", "120"))

# Block-based schema: prose docs stay prose; tables only when visible as grids/forms.
PAGE_STRUCTURE_SCHEMA: dict[str, Any] = {
    "type": "object",
    "additionalProperties": False,
    "properties": {
        "doc_kind": {"type": "string", "enum": ["prose", "form", "mixed"]},
        "title": {"type": "string"},
        "title_centered": {"type": "boolean"},
        "blocks": {
            "type": "array",
            "items": {
                "type": "object",
                "additionalProperties": False,
                "properties": {
                    "type": {
                        "type": "string",
                        "enum": ["paragraph", "list", "table", "signature"],
                    },
                    "text": {"type": "string"},
                    "align": {
                        "type": "string",
                        "enum": ["left", "center", "justify"],
                    },
                    "bold": {"type": "boolean"},
                    "indent_first": {"type": "boolean"},
                    "items": {"type": "array", "items": {"type": "string"}},
                    "list_marker": {
                        "type": "string",
                        "enum": ["dash", "bullet", "number"],
                    },
                    "rows": {
                        "type": "array",
                        "items": {
                            "type": "array",
                            "items": {"type": "string"},
                        },
                    },
                    "left_text": {"type": "string"},
                    "right_text": {"type": "string"},
                    "has_handwriting": {"type": "boolean"},
                    "bbox_norm": {
                        "type": "array",
                        "items": {"type": "number"},
                        "minItems": 4,
                        "maxItems": 4,
                    },
                    "ink_bbox_norm": {
                        "type": "array",
                        "items": {"type": "number"},
                        "minItems": 4,
                        "maxItems": 4,
                    },
                },
                "required": [
                    "type",
                    "text",
                    "align",
                    "bold",
                    "indent_first",
                    "items",
                    "list_marker",
                    "rows",
                    "left_text",
                    "right_text",
                    "has_handwriting",
                    "bbox_norm",
                    "ink_bbox_norm",
                ],
            },
        },
        "title_bbox_norm": {
            "type": "array",
            "items": {"type": "number"},
            "minItems": 4,
            "maxItems": 4,
        },
    },
    "required": ["doc_kind", "title", "title_centered", "title_bbox_norm", "blocks"],
}

STRUCTURE_SYSTEM_PROMPT = (
    "You reconstruct document pages into an ordered block plan for Word export. "
    "Look at the page yourself and decide what each visual piece is — do not assume "
    "the page is a form/table. Many pages are plain prose with paragraphs and lists. "
    "Return ONLY JSON matching the schema. "
    "FIDELITY (critical): transcribe EVERY visible word exactly as printed — "
    "Cyrillic, numbers, punctuation, blanks. Do not paraphrase, summarize, or invent. "
    "Do not repeat the same sentence. Do not dump the whole page into one cell. "
    "GEOMETRY (critical): every region uses normalized page coordinates "
    "bbox_norm=[x0,y0,x1,y1] in 0..1 relative to the FULL page image. "
    "title_bbox_norm = title region; each block.bbox_norm = that block's region; "
    "for signature handwriting also set ink_bbox_norm tightly around ink only "
    "(else [0,0,0,0]). Be precise — these pixels drive overlay/preview verification. "
    "Workflow: (1) title + title_bbox_norm, (2) scan top-to-bottom, (3) emit blocks "
    "in reading order with accurate bboxes. "
    "Block types: paragraph, list, table, signature. "
    "Rules: "
    "- Use list for dash/bullet/numbered items; NEVER pack list items into a table. "
    "- Use table ONLY for a real bordered grid or label|value form. "
    "- Mark underline as __text__ and bold spans as **text__. "
    "- Put title only in title (do not duplicate as a paragraph). "
    "Never invent text. Never split phrases word-by-word. Keep all content."
)

STRUCTURE_USER_PROMPT = (
    "Inspect this page and choose the correct block sequence yourself. "
    "Transcribe all text exactly. For every title/block return accurate bbox_norm "
    "(0..1). Rebuild top-to-bottom. Prefer paragraphs/lists for policies; tables "
    "only if a real table/form grid is visible. Preserve underlines/bold and every "
    "list item. Leave blank form values empty rather than guessing."
)


def _empty_signature() -> dict[str, Any]:
    return {
        "left_text": "",
        "right_text": "",
        "has_handwriting": False,
        "bbox_norm": [0.0, 0.0, 0.0, 0.0],
        "ink_bbox_norm": [0.0, 0.0, 0.0, 0.0],
    }


def _normalize_bbox(value: object) -> list[float]:
    bbox = list(value or [0, 0, 0, 0])
    while len(bbox) < 4:
        bbox.append(0)
    return [
        max(0.0, min(1.0, float(bbox[0] or 0))),
        max(0.0, min(1.0, float(bbox[1] or 0))),
        max(0.0, min(1.0, float(bbox[2] or 0))),
        max(0.0, min(1.0, float(bbox[3] or 0))),
    ]


def bbox_is_usable(bbox: list[float] | None, *, min_w: float = 0.02, min_h: float = 0.01) -> bool:
    if not bbox or len(bbox) != 4:
        return False
    return (bbox[2] - bbox[0]) >= min_w and (bbox[3] - bbox[1]) >= min_h


def _looks_like_list_table(rows: list[Any]) -> bool:
    """Detect list items wrongly packed into a 2-column table."""
    if not rows or len(rows) < 2:
        return False
    flat: list[str] = []
    for row in rows:
        cells = [str(cell or "").strip() for cell in list(row or [])]
        if not cells:
            continue
        # Real label|value forms usually have short labels in col0.
        if len(cells) >= 2:
            left, right = cells[0], cells[1]
            # Both sides look like list fragments (semicolon, lowercase start).
            listish = 0
            for cell in (left, right):
                if not cell:
                    continue
                if cell.endswith(";") or cell.endswith("."):
                    listish += 1
                elif cell[:1].islower():
                    listish += 1
            if listish >= 2:
                flat.extend([c for c in (left, right) if c])
                continue
            # Classic form: short bold-ish label + value → not a list table.
            if len(left) <= 40 and right and not right.endswith(";"):
                return False
        flat.extend([c for c in cells if c])
    if len(flat) < 3:
        return False
    ends = sum(1 for item in flat if item.endswith(";") or item.endswith("."))
    lower_starts = sum(1 for item in flat if item[:1].islower())
    return ends >= max(2, len(flat) // 2) or lower_starts >= max(2, len(flat) // 2)


def guard_fix_structure(blocks: list[dict[str, Any]]) -> list[dict[str, Any]]:
    """Deterministic fixes that must not wait for the verifier."""
    fixed: list[dict[str, Any]] = []
    for block in blocks:
        kind = str(block.get("type") or "")
        if kind == "table" and _looks_like_list_table(list(block.get("rows") or [])):
            items: list[str] = []
            for row in list(block.get("rows") or []):
                for cell in list(row or []):
                    text = str(cell or "").strip()
                    if text:
                        items.append(text)
            fixed.append(
                {
                    **block,
                    "type": "list",
                    "items": items,
                    "rows": [],
                    "list_marker": "dash",
                    "text": "",
                }
            )
            logger.info("doc_convert: guard converted fake table → list items=%s", len(items))
            continue
        fixed.append(block)
    # Reading order by geometry when bboxes exist.
    if any(bbox_is_usable(list(block.get("bbox_norm") or [])) for block in fixed):
        fixed.sort(
            key=lambda block: (
                float((block.get("bbox_norm") or [0, 0, 0, 0])[1]),
                float((block.get("bbox_norm") or [0, 0, 0, 0])[0]),
            )
        )
    return fixed


def normalize_structure_payload(payload: dict[str, Any]) -> dict[str, Any]:
    """Normalize new block schema and legacy paragraphs_before/tables schema."""
    data = dict(payload or {})
    title = str(data.get("title") or "").strip()
    title_centered = bool(data.get("title_centered", True))
    title_bbox_norm = _normalize_bbox(data.get("title_bbox_norm"))
    blocks = [item for item in list(data.get("blocks") or []) if isinstance(item, dict)]

    if not blocks:
        # Legacy fallback used by older cached conversions.
        for paragraph in list(data.get("paragraphs_before") or []):
            text = str(paragraph or "").strip()
            if text:
                blocks.append(
                    {
                        "type": "paragraph",
                        "text": text,
                        "align": "left",
                        "bold": False,
                        "indent_first": True,
                        "items": [],
                        "list_marker": "dash",
                        "rows": [],
                        **_empty_signature(),
                    }
                )
        for table in list(data.get("tables") or []):
            rows = list((table or {}).get("rows") or [])
            if rows:
                blocks.append(
                    {
                        "type": "table",
                        "text": "",
                        "align": "left",
                        "bold": False,
                        "indent_first": False,
                        "items": [],
                        "list_marker": "dash",
                        "rows": rows,
                        **_empty_signature(),
                    }
                )
        for paragraph in list(data.get("paragraphs_after") or []):
            text = str(paragraph or "").strip()
            if text:
                blocks.append(
                    {
                        "type": "paragraph",
                        "text": text,
                        "align": "left",
                        "bold": False,
                        "indent_first": True,
                        "items": [],
                        "list_marker": "dash",
                        "rows": [],
                        **_empty_signature(),
                    }
                )
        signature = data.get("signature") if isinstance(data.get("signature"), dict) else {}
        if any(str(signature.get(key) or "").strip() for key in ("left_text", "right_text")) or bool(
            signature.get("has_handwriting")
        ):
            ink = list(signature.get("bbox_norm") or [0, 0, 0, 0])
            blocks.append(
                {
                    "type": "signature",
                    "text": "",
                    "align": "left",
                    "bold": False,
                    "indent_first": False,
                    "items": [],
                    "list_marker": "dash",
                    "rows": [],
                    "left_text": str(signature.get("left_text") or ""),
                    "right_text": str(signature.get("right_text") or ""),
                    "has_handwriting": bool(signature.get("has_handwriting")),
                    "bbox_norm": ink,
                    "ink_bbox_norm": ink,
                }
            )

    normalized_blocks: list[dict[str, Any]] = []
    for raw in blocks:
        kind = str(raw.get("type") or "paragraph").strip().lower()
        if kind not in {"paragraph", "list", "table", "signature"}:
            kind = "paragraph"
        text = str(raw.get("text") or "").strip()
        # Drop accidental title duplicate as the first paragraph.
        if kind == "paragraph" and title and text.rstrip(".") == title.rstrip("."):
            continue
        align = str(raw.get("align") or "left").strip().lower()
        if align not in {"left", "center", "justify"}:
            align = "left"
        list_marker = str(raw.get("list_marker") or "dash").strip().lower()
        if list_marker not in {"dash", "bullet", "number"}:
            list_marker = "dash"
        bbox = _normalize_bbox(raw.get("bbox_norm"))
        ink_bbox = _normalize_bbox(raw.get("ink_bbox_norm") or raw.get("bbox_norm"))
        # Legacy signature used bbox_norm for ink.
        if kind == "signature" and not bbox_is_usable(ink_bbox) and bbox_is_usable(bbox):
            ink_bbox = list(bbox)
        normalized_blocks.append(
            {
                "type": kind,
                "text": text,
                "align": align,
                "bold": bool(raw.get("bold")),
                "indent_first": bool(raw.get("indent_first", kind == "paragraph")),
                "items": [str(item).strip() for item in list(raw.get("items") or []) if str(item).strip()],
                "list_marker": list_marker,
                "rows": list(raw.get("rows") or []),
                "left_text": str(raw.get("left_text") or "").strip(),
                "right_text": str(raw.get("right_text") or "").strip(),
                "has_handwriting": bool(raw.get("has_handwriting")),
                "bbox_norm": bbox,
                "ink_bbox_norm": ink_bbox,
            }
        )

    normalized_blocks = guard_fix_structure(normalized_blocks)

    has_table = any(block["type"] == "table" for block in normalized_blocks)
    has_prose = any(block["type"] in {"paragraph", "list"} for block in normalized_blocks)
    doc_kind = str(data.get("doc_kind") or "").strip().lower()
    if doc_kind not in {"prose", "form", "mixed"}:
        if has_table and has_prose:
            doc_kind = "mixed"
        elif has_table:
            doc_kind = "form"
        else:
            doc_kind = "prose"

    return {
        "doc_kind": doc_kind,
        "title": title,
        "title_centered": title_centered,
        "title_bbox_norm": title_bbox_norm,
        "blocks": normalized_blocks,
        "page_index": int(data.get("page_index") or 0),
        "verify_fidelity": float(data.get("verify_fidelity") or 0.0),
    }


def structure_to_markdown(payload: dict[str, Any]) -> str:
    data = normalize_structure_payload(payload)
    lines: list[str] = []
    title = data["title"]
    if title:
        lines.extend([f"# {title}", ""])
    for block in data["blocks"]:
        kind = block["type"]
        if kind == "paragraph":
            text = str(block.get("text") or "").strip()
            if not text:
                continue
            if block.get("bold") and not (text.startswith("**") and text.endswith("**")):
                text = f"**{text}**"
            lines.extend([text, ""])
        elif kind == "list":
            marker = "—" if block.get("list_marker") == "dash" else "-"
            for item in list(block.get("items") or []):
                lines.append(f"{marker} {item}")
            lines.append("")
        elif kind == "table":
            rows = list(block.get("rows") or [])
            if not rows:
                continue
            width = max((len(row) for row in rows), default=0)
            if width < 1:
                continue
            normalized = [list(row) + [""] * (width - len(row)) for row in rows]
            header = normalized[0]
            lines.append("| " + " | ".join(str(cell) for cell in header) + " |")
            lines.append("| " + " | ".join(["---"] * width) + " |")
            for row in normalized[1:]:
                lines.append("| " + " | ".join(str(cell) for cell in row) + " |")
            lines.append("")
        elif kind == "signature":
            left = str(block.get("left_text") or "").strip()
            right = str(block.get("right_text") or "").strip()
            if left or right:
                lines.append(f"{left}  {right}".strip())
    return "\n".join(lines).strip()


def iter_signature_blocks(payload: dict[str, Any]) -> list[dict[str, Any]]:
    data = normalize_structure_payload(payload)
    result = [block for block in data["blocks"] if block["type"] == "signature"]
    # Legacy top-level signature
    if not result and isinstance(payload.get("signature"), dict):
        result.append(
            {
                "type": "signature",
                **_empty_signature(),
                **payload["signature"],
            }
        )
    return result


def _clamp01(value: float) -> float:
    return max(0.0, min(1.0, float(value)))


def _signature_ink_rgba(image: "Image.Image") -> "Image.Image":
    """Keep dark ink, make paper/white background transparent for Word overlay."""
    rgba = image.convert("RGBA")
    # Vectorized path — pixel Python loops are too slow on zoomed page crops.
    try:
        import numpy as np  # type: ignore

        arr = np.asarray(rgba).astype("int16")
        r = arr[:, :, 0]
        g = arr[:, :, 1]
        b = arr[:, :, 2]
        brightness = (r + g + b) // 3
        out = arr.copy()
        out[:, :, 0] = np.minimum(r, 40)
        out[:, :, 1] = np.minimum(g, 40)
        out[:, :, 2] = np.minimum(b, 40)
        out[:, :, 3] = 255
        soft = (brightness >= 200) & (brightness < 235)
        out[:, :, 3] = np.where(
            soft,
            np.clip(((235 - brightness) * 255) // 35, 0, 255),
            out[:, :, 3],
        )
        paper = brightness >= 235
        out[paper, 0] = 255
        out[paper, 1] = 255
        out[paper, 2] = 255
        out[paper, 3] = 0
        return Image.fromarray(out.astype("uint8"), mode="RGBA")
    except Exception:
        pixels = rgba.load()
        width, height = rgba.size
        for y in range(height):
            for x in range(width):
                r, g, b, _a = pixels[x, y]
                brightness = (r + g + b) / 3.0
                if brightness >= 235:
                    pixels[x, y] = (255, 255, 255, 0)
                elif brightness >= 200:
                    alpha = int(max(0, min(255, (235 - brightness) * (255 / 35))))
                    pixels[x, y] = (r, g, b, alpha)
                else:
                    pixels[x, y] = (min(r, 40), min(g, 40), min(b, 40), 255)
        return rgba


def _trim_transparent(image: "Image.Image", *, pad: int = 2) -> "Image.Image":
    if image.mode != "RGBA":
        return image
    alpha = image.split()[-1]
    bbox = alpha.getbbox()
    if not bbox:
        return image
    left, top, right, bottom = bbox
    left = max(0, left - pad)
    top = max(0, top - pad)
    right = min(image.width, right + pad)
    bottom = min(image.height, bottom + pad)
    return image.crop((left, top, right, bottom))


def crop_signature_from_page(
    page: RenderedPage,
    *,
    bbox_norm: list[float],
    left_text: str = "",
    right_text: str = "",
    padding_ratio: float = 0.015,
) -> SignatureCrop | None:
    if Image is None:
        return None
    if not bbox_norm or len(bbox_norm) != 4:
        return None
    x0, y0, x1, y1 = [_clamp01(v) for v in bbox_norm]
    if x1 - x0 < 0.02 or y1 - y0 < 0.01:
        return None
    try:
        with Image.open(io.BytesIO(page.png_bytes)) as image:
            width, height = image.size
            pad_x = padding_ratio * width
            pad_y = padding_ratio * height
            left = max(0, int(x0 * width - pad_x))
            top = max(0, int(y0 * height - pad_y))
            right = min(width, int(x1 * width + pad_x))
            bottom = min(height, int(y1 * height + pad_y))
            if right - left < 8 or bottom - top < 8:
                return None
            cropped = image.crop((left, top, right, bottom))
            # Guardrail: refuse absurd full-page "signature" crops that freeze export.
            if cropped.width * cropped.height > 1_200_000:
                logger.warning(
                    "doc_convert: signature bbox too large page=%s size=%sx%s; skip crop",
                    page.page_index,
                    cropped.width,
                    cropped.height,
                )
                return None
            ink = _trim_transparent(_signature_ink_rgba(cropped))
            if ink.width < 6 or ink.height < 6:
                return None
            buffer = io.BytesIO()
            ink.save(buffer, format="PNG")
            return SignatureCrop(
                page_index=page.page_index,
                png_bytes=buffer.getvalue(),
                left_text=str(left_text or "").strip(),
                right_text=str(right_text or "").strip(),
            )
    except Exception as exc:
        logger.warning("doc_convert: signature crop failed page=%s error=%s", page.page_index, exc)
        return None


def signatures_to_payload(signatures: list[SignatureCrop]) -> list[dict[str, Any]]:
    result: list[dict[str, Any]] = []
    for item in signatures:
        result.append(
            {
                "page_index": item.page_index,
                "left_text": item.left_text,
                "right_text": item.right_text,
                "png_b64": base64.b64encode(item.png_bytes).decode("ascii"),
            }
        )
    return result


def signatures_from_payload(payload: list[Any] | None) -> list[SignatureCrop]:
    result: list[SignatureCrop] = []
    for item in list(payload or []):
        if not isinstance(item, dict):
            continue
        raw = str(item.get("png_b64") or "").strip()
        if not raw:
            continue
        try:
            png_bytes = base64.b64decode(raw.encode("ascii"), validate=False)
        except Exception:
            continue
        if not png_bytes:
            continue
        result.append(
            SignatureCrop(
                page_index=int(item.get("page_index") or 0),
                png_bytes=png_bytes,
                left_text=str(item.get("left_text") or "").strip(),
                right_text=str(item.get("right_text") or "").strip(),
            )
        )
    return result


def extract_page_structure(
    page: RenderedPage,
    *,
    vision_json_fn=None,
    max_tokens: int = DEFAULT_VISION_MAX_TOKENS,
    timeout: float = DEFAULT_VISION_TIMEOUT,
) -> tuple[PageMarkdown, dict[str, Any], SignatureCrop | None]:
    from shared.llm import OpenRouterClientError, openrouter_client

    encoded = base64.b64encode(page.png_bytes).decode("ascii")
    data_url = f"data:image/png;base64,{encoded}"
    user_content = [
        {"type": "text", "text": STRUCTURE_USER_PROMPT},
        {"type": "image_url", "image_url": {"url": data_url}},
    ]

    runner = vision_json_fn
    try:
        if runner is None:
            payload, _usage = openrouter_client.complete_json(
                system_prompt=STRUCTURE_SYSTEM_PROMPT,
                user_content=user_content,
                purpose="doc_convert",
                temperature=0.0,
                max_tokens=max_tokens,
                response_schema=PAGE_STRUCTURE_SCHEMA,
                schema_name="doc_convert_page",
                strict_json_schema=True,
                response_healing=True,
                timeout=timeout,
            )
        else:
            payload, _usage = runner(
                system_prompt=STRUCTURE_SYSTEM_PROMPT,
                user_content=user_content,
                max_tokens=max_tokens,
                timeout=timeout,
            )
    except OpenRouterClientError:
        raise
    except Exception as exc:
        raise OpenRouterClientError(f"Document structure vision failed: {exc}") from exc

    if not isinstance(payload, dict):
        payload = {}
    payload = normalize_structure_payload(payload)
    payload["page_index"] = int(page.page_index)

    try:
        from shared.doc_convert.verify import refine_structure_with_verify

        payload, verify_warnings = refine_structure_with_verify(
            page.png_bytes,
            payload,
            vision_json_fn=vision_json_fn,
        )
        if verify_warnings:
            logger.info(
                "doc_convert: verify warnings page=%s count=%s",
                page.page_index,
                len(verify_warnings),
            )
    except Exception as exc:
        logger.warning("doc_convert: verify loop skipped page=%s error=%s", page.page_index, exc)

    payload = normalize_structure_payload(payload)
    payload["page_index"] = int(page.page_index)
    markdown = structure_to_markdown(payload)
    page_md = PageMarkdown(
        page_index=page.page_index,
        markdown=markdown,
        source="vision",
        char_count=len(markdown),
    )

    crop = None
    for signature_payload in iter_signature_blocks(payload):
        ink_bbox = list(
            signature_payload.get("ink_bbox_norm") or signature_payload.get("bbox_norm") or []
        )
        if bool(signature_payload.get("has_handwriting")) or bbox_is_usable(ink_bbox):
            crop = crop_signature_from_page(
                page,
                bbox_norm=ink_bbox,
                left_text=str(signature_payload.get("left_text") or ""),
                right_text=str(signature_payload.get("right_text") or ""),
            )
            if crop is not None:
                break
    return page_md, payload, crop
