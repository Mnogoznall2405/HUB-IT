"""Vision-in-the-loop verification: render structure preview and compare to original page."""

from __future__ import annotations

import base64
import io
import logging
import os
import textwrap
from typing import Any

from shared.doc_convert.structure import (
    DEFAULT_VISION_MAX_TOKENS,
    DEFAULT_VISION_TIMEOUT,
    PAGE_STRUCTURE_SCHEMA,
    bbox_is_usable,
    normalize_structure_payload,
    structure_to_markdown,
)

logger = logging.getLogger(__name__)

try:
    from PIL import Image, ImageDraw, ImageFont  # type: ignore
except Exception:  # pragma: no cover
    Image = None
    ImageDraw = None
    ImageFont = None

VERIFY_ENABLED = str(os.environ.get("DOC_CONVERT_VERIFY", "1")).strip().lower() not in {
    "0",
    "false",
    "no",
    "off",
}
VERIFY_ROUNDS = max(0, min(4, int(os.environ.get("DOC_CONVERT_VERIFY_ROUNDS", "3"))))
VERIFY_MIN_FIDELITY = float(os.environ.get("DOC_CONVERT_VERIFY_MIN_FIDELITY", "0.9"))
REBUILD_ON_LOW_FIDELITY = str(os.environ.get("DOC_CONVERT_REBUILD_ON_LOW_FIDELITY", "1")).strip().lower() not in {
    "0",
    "false",
    "no",
    "off",
}
MAX_PAGE_MARKDOWN_CHARS = max(2000, int(os.environ.get("DOC_CONVERT_MAX_PAGE_CHARS", "25000") or "25000"))

_BLOCK_SCHEMA = PAGE_STRUCTURE_SCHEMA["properties"]["blocks"]

VERIFY_SCHEMA: dict[str, Any] = {
    "type": "object",
    "additionalProperties": False,
    "properties": {
        "ok": {"type": "boolean"},
        "fidelity": {"type": "number"},
        "issues": {
            "type": "array",
            "items": {
                "type": "object",
                "additionalProperties": False,
                "properties": {
                    "code": {"type": "string"},
                    "detail": {"type": "string"},
                },
                "required": ["code", "detail"],
            },
        },
        "doc_kind": {"type": "string", "enum": ["prose", "form", "mixed"]},
        "title": {"type": "string"},
        "title_centered": {"type": "boolean"},
        "title_bbox_norm": {
            "type": "array",
            "items": {"type": "number"},
            "minItems": 4,
            "maxItems": 4,
        },
        "blocks": _BLOCK_SCHEMA,
    },
    "required": [
        "ok",
        "fidelity",
        "issues",
        "doc_kind",
        "title",
        "title_centered",
        "title_bbox_norm",
        "blocks",
    ],
}

VERIFY_SYSTEM_PROMPT = (
    "You are a strict document fidelity verifier. You receive a SIDE-BY-SIDE image: "
    "LEFT = ORIGINAL page, RIGHT = RECONSTRUCTION preview (colored bbox outlines). "
    "Score harshly: missing words, wrong structure, wrong geometry, invented text "
    "must lower fidelity. "
    "Critical failures: list items packed into a table; missing paragraphs; "
    "duplicate title; invented/repeated text; wrong order; wrong/missing bboxes; "
    "missing underline/bold; form fields missing; signature omitted; "
    "text that does not match the original wording. "
    "If good: ok=true, fidelity>=0.9, issues=[], blocks=[]. "
    "If bad: ok=false, list concrete issues, return CORRECTED full plan with accurate "
    "title_bbox_norm and every block.bbox_norm / ink_bbox_norm, "
    "transcribing text from the ORIGINAL (left) only. "
    "Never invent text. Prefer paragraphs/lists for prose; tables only for real grids."
)

VERIFY_USER_PROMPT = (
    "SIDE-BY-SIDE: left=ORIGINAL, right=RECONSTRUCTION. "
    "Current plan JSON includes bbox_norm per block. "
    "Compare carefully. If anything is wrong, return a corrected full plan "
    "with exact text from the ORIGINAL and accurate bboxes."
)

REBUILD_SYSTEM_PROMPT = (
    "You rebuild a document page plan from the ORIGINAL image after a failed verify. "
    "Previous attempt had fidelity issues listed by the user. "
    "Ignore the broken previous layout; re-read the ORIGINAL carefully. "
    "Return a complete corrected JSON plan matching the schema. "
    "Transcribe every visible word. Prefer paragraphs/lists for prose; "
    "tables only for real grids/forms. Accurate bbox_norm for title and every block. "
    "Never invent or repeat text."
)


def _load_font(size: int = 18):
    candidates = [
        "C:/Windows/Fonts/arial.ttf",
        "C:/Windows/Fonts/times.ttf",
        "C:/Windows/Fonts/cour.ttf",
        "/usr/share/fonts/truetype/dejavu/DejaVuSans.ttf",
    ]
    for path in candidates:
        try:
            return ImageFont.truetype(path, size=size)
        except Exception:
            continue
    return ImageFont.load_default()


def _strip_markers(text: str) -> str:
    return (
        str(text or "")
        .replace("**", "")
        .replace("__", "")
        .strip()
    )


def _block_plain_text(block: dict[str, Any]) -> str:
    kind = str(block.get("type") or "")
    if kind == "paragraph":
        return _strip_markers(str(block.get("text") or ""))
    if kind == "list":
        marker = "— " if str(block.get("list_marker") or "dash") == "dash" else "• "
        return "\n".join(marker + _strip_markers(str(item)) for item in list(block.get("items") or []) if str(item).strip())
    if kind == "table":
        lines = []
        for row in list(block.get("rows") or []):
            cells = [_strip_markers(str(cell)) for cell in list(row or [])]
            lines.append(" | ".join(cells))
        return "\n".join(lines)
    if kind == "signature":
        left = _strip_markers(str(block.get("left_text") or ""))
        right = _strip_markers(str(block.get("right_text") or ""))
        return f"{left}   ________   {right}".strip()
    return _strip_markers(str(block.get("text") or ""))


def _draw_text_in_box(
    draw: Any,
    *,
    box: tuple[int, int, int, int],
    text: str,
    font: Any,
    align: str = "left",
    fill: tuple[int, int, int] = (20, 20, 20),
) -> None:
    x0, y0, x1, y1 = box
    width = max(8, x1 - x0)
    approx_chars = max(8, width // max(8, getattr(font, "size", 16) // 2))
    y = y0 + 2
    line_height = max(14, int(getattr(font, "size", 16) * 1.25))
    for paragraph in str(text or "").splitlines() or [""]:
        wrapped = textwrap.wrap(paragraph, width=approx_chars) or [paragraph]
        for chunk in wrapped:
            if y + line_height > y1:
                return
            bbox = draw.textbbox((0, 0), chunk, font=font)
            text_w = bbox[2] - bbox[0]
            if align == "center":
                x = x0 + max(0, (width - text_w) // 2)
            else:
                x = x0 + 2
            draw.text((x, y), chunk, fill=fill, font=font)
            y += line_height


def render_structure_preview_png(
    structure: dict[str, Any],
    *,
    width: int = 900,
    min_height: int = 1200,
    original_png: bytes | None = None,
) -> bytes:
    """Render layout preview; uses bbox_norm pixel regions when available."""
    if Image is None or ImageDraw is None:
        raise RuntimeError("Pillow is required for structure preview")

    data = normalize_structure_payload(structure)
    if original_png:
        with Image.open(io.BytesIO(original_png)) as source:
            src_w, src_h = source.size
        scale = min(1.0, 1280 / float(max(src_w, src_h, 1)))
        width = max(320, int(src_w * scale))
        height = max(320, int(src_h * scale))
    else:
        height = min_height

    font_title = _load_font(max(18, width // 40))
    font_body = _load_font(max(14, width // 55))
    font_small = _load_font(max(12, width // 65))
    image = Image.new("RGB", (width, height), color=(255, 255, 255))
    draw = ImageDraw.Draw(image)

    blocks = list(data.get("blocks") or [])
    spatial = bbox_is_usable(list(data.get("title_bbox_norm") or [])) or any(
        bbox_is_usable(list(block.get("bbox_norm") or [])) for block in blocks
    )

    if spatial:
        title = str(data.get("title") or "").strip()
        title_bbox = list(data.get("title_bbox_norm") or [])
        if title and bbox_is_usable(title_bbox):
            box = (
                int(title_bbox[0] * width),
                int(title_bbox[1] * height),
                int(title_bbox[2] * width),
                int(title_bbox[3] * height),
            )
            draw.rectangle(box, outline=(30, 90, 200), width=2)
            _draw_text_in_box(
                draw,
                box=box,
                text=title,
                font=font_title,
                align="center" if data.get("title_centered", True) else "left",
            )
        elif title:
            _draw_text_in_box(
                draw,
                box=(40, 20, width - 40, 80),
                text=title,
                font=font_title,
                align="center" if data.get("title_centered", True) else "left",
            )

        for block in blocks:
            bbox = list(block.get("bbox_norm") or [])
            if not bbox_is_usable(bbox):
                continue
            box = (
                int(bbox[0] * width),
                int(bbox[1] * height),
                int(bbox[2] * width),
                int(bbox[3] * height),
            )
            kind = str(block.get("type") or "")
            outline = {
                "paragraph": (40, 140, 80),
                "list": (180, 120, 40),
                "table": (160, 60, 60),
                "signature": (100, 60, 160),
            }.get(kind, (30, 90, 200))
            draw.rectangle(box, outline=outline, width=2)
            text = _block_plain_text(block)
            font = font_small if kind == "table" else font_body
            align = "center" if str(block.get("align") or "") == "center" else "left"
            _draw_text_in_box(draw, box=box, text=text, font=font, align=align)
            ink = list(block.get("ink_bbox_norm") or [])
            if kind == "signature" and bbox_is_usable(ink):
                ink_box = (
                    int(ink[0] * width),
                    int(ink[1] * height),
                    int(ink[2] * width),
                    int(ink[3] * height),
                )
                draw.rectangle(ink_box, outline=(220, 40, 40), width=2)
    else:
        # Flow fallback when geometry is missing.
        margin = 48
        max_chars = max(40, (width - 2 * margin) // 10)
        y = margin
        line_height = 28
        title = str(data.get("title") or "").strip()
        if title:
            for chunk in textwrap.wrap(title, width=max_chars) or [title]:
                draw.text(((width - draw.textbbox((0, 0), chunk, font=font_title)[2]) // 2, y), chunk, fill=(20, 20, 20), font=font_title)
                y += line_height + 4
            y += 10
        for block in blocks:
            text = _block_plain_text(block)
            for chunk in textwrap.wrap(text, width=max_chars) or [text]:
                draw.text((margin, y), chunk, fill=(20, 20, 20), font=font_body)
                y += line_height
                if y > height - margin:
                    break
            y += 8
            if y > height - margin:
                break

    buffer = io.BytesIO()
    image.save(buffer, format="PNG")
    return buffer.getvalue()


def _resize_for_verify(png_bytes: bytes, *, max_side: int = 1280) -> bytes:
    if Image is None:
        return png_bytes
    with Image.open(io.BytesIO(png_bytes)) as image:
        image = image.convert("RGB")
        width, height = image.size
        scale = min(1.0, float(max_side) / float(max(width, height, 1)))
        if scale < 0.999:
            image = image.resize(
                (max(1, int(width * scale)), max(1, int(height * scale))),
                Image.Resampling.LANCZOS,
            )
        buffer = io.BytesIO()
        image.save(buffer, format="PNG", optimize=True)
        return buffer.getvalue()


def _side_by_side_png(original_png: bytes, preview_png: bytes, *, max_side: int = 1400) -> bytes:
    """Compose LEFT=original, RIGHT=preview for easier visual compare."""
    if Image is None or ImageDraw is None:
        return _resize_for_verify(original_png, max_side=max_side)
    left = Image.open(io.BytesIO(original_png)).convert("RGB")
    right = Image.open(io.BytesIO(preview_png)).convert("RGB")
    target_h = min(left.height, right.height, max_side)

    def _fit(img: Any) -> Any:
        scale = target_h / float(max(img.height, 1))
        if abs(scale - 1.0) < 0.001:
            return img
        return img.resize(
            (max(1, int(img.width * scale)), max(1, int(img.height * scale))),
            Image.Resampling.LANCZOS,
        )

    left = _fit(left)
    right = _fit(right)
    gap = 8
    label_h = 28
    canvas = Image.new(
        "RGB",
        (left.width + right.width + gap, max(left.height, right.height) + label_h),
        color=(245, 245, 245),
    )
    draw = ImageDraw.Draw(canvas)
    font = _load_font(16)
    draw.text((8, 6), "ORIGINAL", fill=(20, 20, 20), font=font)
    draw.text((left.width + gap + 8, 6), "RECONSTRUCTION", fill=(20, 20, 20), font=font)
    canvas.paste(left, (0, label_h))
    canvas.paste(right, (left.width + gap, label_h))
    if canvas.width > max_side * 2:
        scale = (max_side * 2) / float(canvas.width)
        canvas = canvas.resize(
            (max(1, int(canvas.width * scale)), max(1, int(canvas.height * scale))),
            Image.Resampling.LANCZOS,
        )
    buffer = io.BytesIO()
    canvas.save(buffer, format="PNG", optimize=True)
    return buffer.getvalue()


def verify_structure_against_page(
    *,
    original_png: bytes,
    structure: dict[str, Any],
    vision_json_fn=None,
    max_tokens: int = DEFAULT_VISION_MAX_TOKENS,
    timeout: float = DEFAULT_VISION_TIMEOUT,
) -> dict[str, Any]:
    """Compare original page vs structure preview; return verifier payload."""
    from shared.llm import OpenRouterClientError, openrouter_client

    preview_png = render_structure_preview_png(structure, original_png=original_png)
    compare_png = _side_by_side_png(original_png, preview_png)
    context = {
        "current_plan": normalize_structure_payload(structure),
        "current_markdown": structure_to_markdown(structure)[:4000],
    }
    user_content = [
        {
            "type": "text",
            "text": VERIFY_USER_PROMPT + "\n\nCurrent plan JSON:\n" + str(context["current_plan"])[:6000],
        },
        {
            "type": "text",
            "text": "SIDE-BY-SIDE compare image (left=ORIGINAL, right=RECONSTRUCTION):",
        },
        {
            "type": "image_url",
            "image_url": {
                "url": f"data:image/png;base64,{base64.b64encode(compare_png).decode('ascii')}"
            },
        },
    ]

    try:
        if vision_json_fn is None:
            payload, _usage = openrouter_client.complete_json(
                system_prompt=VERIFY_SYSTEM_PROMPT,
                user_content=user_content,
                purpose="doc_convert",
                temperature=0.0,
                max_tokens=max_tokens,
                response_schema=VERIFY_SCHEMA,
                schema_name="doc_convert_verify",
                strict_json_schema=True,
                response_healing=True,
                timeout=timeout,
            )
        else:
            payload, _usage = vision_json_fn(
                system_prompt=VERIFY_SYSTEM_PROMPT,
                user_content=user_content,
                max_tokens=max_tokens,
                timeout=timeout,
            )
    except OpenRouterClientError:
        raise
    except Exception as exc:
        raise OpenRouterClientError(f"Document verify vision failed: {exc}") from exc

    if not isinstance(payload, dict):
        payload = {}
    ok = bool(payload.get("ok"))
    try:
        fidelity = float(payload.get("fidelity") or 0.0)
    except Exception:
        fidelity = 0.0
    fidelity = max(0.0, min(1.0, fidelity))
    issues = [
        {
            "code": str(item.get("code") or "issue"),
            "detail": str(item.get("detail") or ""),
        }
        for item in list(payload.get("issues") or [])
        if isinstance(item, dict)
    ]
    corrected = None
    if list(payload.get("blocks") or []) or str(payload.get("title") or "").strip():
        corrected = normalize_structure_payload(
            {
                "doc_kind": payload.get("doc_kind") or structure.get("doc_kind") or "prose",
                "title": payload.get("title") if payload.get("title") is not None else structure.get("title"),
                "title_centered": payload.get("title_centered", structure.get("title_centered", True)),
                "title_bbox_norm": payload.get("title_bbox_norm")
                or structure.get("title_bbox_norm")
                or [0, 0, 0, 0],
                "blocks": payload.get("blocks") or structure.get("blocks") or [],
                "page_index": structure.get("page_index") or 0,
            }
        )
    return {
        "ok": ok,
        "fidelity": fidelity,
        "issues": issues,
        "corrected": corrected,
    }


def rebuild_structure_from_issues(
    page_png: bytes,
    structure: dict[str, Any],
    issues: list[dict[str, Any]],
    *,
    vision_json_fn=None,
    max_tokens: int = DEFAULT_VISION_MAX_TOKENS,
    timeout: float = DEFAULT_VISION_TIMEOUT,
) -> dict[str, Any]:
    """Full re-extract from original, guided by previous verify issues."""
    from shared.llm import OpenRouterClientError, openrouter_client

    issue_lines = [
        f"- {item.get('code')}: {item.get('detail')}"
        for item in list(issues or [])
        if isinstance(item, dict)
    ] or ["- previous plan failed fidelity check"]
    previous_md = structure_to_markdown(structure)[:3500]
    user_content = [
        {
            "type": "text",
            "text": (
                "Previous attempt failed verification.\n"
                "Issues:\n"
                + "\n".join(issue_lines[:12])
                + "\n\nBroken markdown (do NOT copy blindly):\n"
                + previous_md
                + "\n\nRe-read the ORIGINAL image and return a corrected full page plan."
            ),
        },
        {
            "type": "image_url",
            "image_url": {
                "url": f"data:image/png;base64,{base64.b64encode(_resize_for_verify(page_png)).decode('ascii')}"
            },
        },
    ]
    try:
        if vision_json_fn is None:
            payload, _usage = openrouter_client.complete_json(
                system_prompt=REBUILD_SYSTEM_PROMPT,
                user_content=user_content,
                purpose="doc_convert",
                temperature=0.0,
                max_tokens=max_tokens,
                response_schema=PAGE_STRUCTURE_SCHEMA,
                schema_name="doc_convert_rebuild",
                strict_json_schema=True,
                response_healing=True,
                timeout=timeout,
            )
        else:
            payload, _usage = vision_json_fn(
                system_prompt=REBUILD_SYSTEM_PROMPT,
                user_content=user_content,
                max_tokens=max_tokens,
                timeout=timeout,
            )
    except OpenRouterClientError:
        raise
    except Exception as exc:
        raise OpenRouterClientError(f"Document rebuild vision failed: {exc}") from exc

    if not isinstance(payload, dict):
        return structure
    rebuilt = normalize_structure_payload(payload)
    rebuilt["page_index"] = int(structure.get("page_index") or rebuilt.get("page_index") or 0)
    return rebuilt


def clamp_bloated_structure(structure: dict[str, Any], *, max_chars: int | None = None) -> dict[str, Any]:
    """Drop absurdly bloated tables/blocks that explode export size."""
    limit = MAX_PAGE_MARKDOWN_CHARS if max_chars is None else max(1000, int(max_chars))
    current = normalize_structure_payload(structure)
    markdown = structure_to_markdown(current)
    if len(markdown) <= limit:
        return current
    logger.warning(
        "doc_convert: bloated structure chars=%s limit=%s — trimming tables",
        len(markdown),
        limit,
    )
    blocks = []
    for block in list(current.get("blocks") or []):
        kind = str(block.get("type") or "")
        if kind == "table":
            rows = list(block.get("rows") or [])[:40]
            trimmed_rows = []
            for row in rows:
                cells = [str(cell or "")[:400] for cell in list(row or [])[:12]]
                trimmed_rows.append(cells)
            block = dict(block)
            block["rows"] = trimmed_rows
        elif kind == "paragraph":
            block = dict(block)
            block["text"] = str(block.get("text") or "")[:4000]
        elif kind == "list":
            block = dict(block)
            block["items"] = [str(item)[:500] for item in list(block.get("items") or [])[:80]]
        blocks.append(block)
    current["blocks"] = blocks
    current["title"] = str(current.get("title") or "")[:500]
    return normalize_structure_payload(current)


def refine_structure_with_verify(
    page_png: bytes,
    structure: dict[str, Any],
    *,
    vision_json_fn=None,
    rounds: int | None = None,
    min_fidelity: float | None = None,
) -> tuple[dict[str, Any], list[str]]:
    """Region refine → verify→patch loop → optional full rebuild. Returns (structure, warnings)."""
    warnings: list[str] = []
    current = clamp_bloated_structure(normalize_structure_payload(structure))

    try:
        from shared.doc_convert.region_refine import enrich_structure_from_regions

        current, region_warnings = enrich_structure_from_regions(
            page_png,
            current,
            vision_json_fn=vision_json_fn,
        )
        warnings.extend(region_warnings)
        current = clamp_bloated_structure(current)
    except Exception as exc:
        logger.warning("doc_convert: region refine skipped: %s", exc)
        warnings.append(f"region refine skipped: {exc}")

    if not VERIFY_ENABLED:
        return current, warnings
    max_rounds = VERIFY_ROUNDS if rounds is None else max(0, int(rounds))
    if max_rounds <= 0:
        return current, warnings
    threshold = VERIFY_MIN_FIDELITY if min_fidelity is None else float(min_fidelity)
    last_issues: list[dict[str, Any]] = []
    reached_ok = False

    for round_index in range(1, max_rounds + 1):
        try:
            result = verify_structure_against_page(
                original_png=page_png,
                structure=current,
                vision_json_fn=vision_json_fn,
            )
        except Exception as exc:
            logger.warning("doc_convert: verify round=%s failed: %s", round_index, exc)
            warnings.append(f"verify round {round_index} failed: {exc}")
            break

        fidelity = float(result.get("fidelity") or 0.0)
        ok = bool(result.get("ok")) or fidelity >= threshold
        issues = list(result.get("issues") or [])
        last_issues = issues
        logger.info(
            "doc_convert: verify round=%s ok=%s fidelity=%.2f issues=%s",
            round_index,
            ok,
            fidelity,
            len(issues),
        )
        if ok:
            if fidelity:
                current["verify_fidelity"] = fidelity
            reached_ok = True
            break

        corrected = result.get("corrected")
        if not isinstance(corrected, dict) or not list(corrected.get("blocks") or []):
            warnings.append(f"verify round {round_index}: no usable correction")
            break
        corrected["page_index"] = int(current.get("page_index") or corrected.get("page_index") or 0)
        current = clamp_bloated_structure(normalize_structure_payload(corrected))
        current["verify_fidelity"] = fidelity
        if issues:
            warnings.append(
                "verify: " + "; ".join(f"{item.get('code')}: {item.get('detail')}" for item in issues[:3])
            )

    if (
        not reached_ok
        and REBUILD_ON_LOW_FIDELITY
        and float(current.get("verify_fidelity") or 0.0) < threshold
    ):
        try:
            logger.info("doc_convert: rebuild pass after low fidelity=%.2f", float(current.get("verify_fidelity") or 0))
            rebuilt = rebuild_structure_from_issues(
                page_png,
                current,
                last_issues,
                vision_json_fn=vision_json_fn,
            )
            current = clamp_bloated_structure(rebuilt)
            # One final verify after rebuild.
            result = verify_structure_against_page(
                original_png=page_png,
                structure=current,
                vision_json_fn=vision_json_fn,
            )
            fidelity = float(result.get("fidelity") or 0.0)
            ok = bool(result.get("ok")) or fidelity >= threshold
            current["verify_fidelity"] = fidelity
            logger.info(
                "doc_convert: post-rebuild verify ok=%s fidelity=%.2f",
                ok,
                fidelity,
            )
            if not ok:
                corrected = result.get("corrected")
                if isinstance(corrected, dict) and list(corrected.get("blocks") or []):
                    corrected["page_index"] = int(current.get("page_index") or 0)
                    current = clamp_bloated_structure(normalize_structure_payload(corrected))
                    current["verify_fidelity"] = fidelity
                warnings.append(f"post-rebuild fidelity={fidelity:.2f}")
        except Exception as exc:
            logger.warning("doc_convert: rebuild pass failed: %s", exc)
            warnings.append(f"rebuild failed: {exc}")

    return current, warnings
