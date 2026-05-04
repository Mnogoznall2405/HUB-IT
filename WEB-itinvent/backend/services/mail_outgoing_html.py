"""
Outgoing mail HTML composition.

Keeps body/signature normalization independent from MailService runtime,
database access, and Exchange transport.
"""
from __future__ import annotations

from html.parser import HTMLParser
from typing import Any
import html
import re


OUTGOING_MAIL_BODY_STYLE = (
    "margin:0;"
    "padding:0;"
    "font-family:Aptos, Calibri, Arial, Helvetica, sans-serif;"
    "font-size:11pt;"
    "line-height:1.5;"
)
OUTGOING_WRAPPER_PATTERN = re.compile(
    r'^\s*<div\b[^>]*data-mail-outgoing=(["\'])true\1[^>]*>(?P<body>[\s\S]*)</div>\s*$',
    re.IGNORECASE,
)
OUTGOING_SIGNATURE_WRAPPER_PATTERN = re.compile(
    r'^\s*<div\b[^>]*data-mail-signature=(["\'])true\1[^>]*>(?P<body>[\s\S]*)</div>\s*$',
    re.IGNORECASE,
)
OUTGOING_QUOTED_MARKERS = (
    '<div class="quoted-mail"',
    "<div class='quoted-mail'",
    'class="quoted-mail"',
    "class='quoted-mail'",
    'class="gmail_quote"',
    "class='gmail_quote'",
    'class="protonmail_quote"',
    "class='protonmail_quote'",
    'class="yahoo_quoted"',
    "class='yahoo_quoted'",
    'class="moz-cite-prefix"',
    "class='moz-cite-prefix'",
    "data-mail-quoted-history",
)
OUTGOING_QUOTED_HEADER_PATTERN = re.compile(r"(from|sent|date|to|subject|от|дата|кому|тема)\s*:", re.IGNORECASE)
SIGNATURE_LINE_STYLE_PROPS = {
    "margin": "0 0 4px 0",
    "line-height": "1.35",
}
OUTGOING_DEFAULT_TEXT_COLOR = "#000000"
OUTGOING_LOW_CONTRAST_ON_WHITE = 2.4
OUTGOING_NAMED_COLORS = {
    "black": "#000000",
    "white": "#ffffff",
}


def normalize_text(value: Any, default: str = "") -> str:
    text = str(value or "").strip()
    return text or default


def plain_text_to_html(text: Any) -> str:
    value = str(text or "")
    normalized = value.replace("\r\n", "\n").replace("\r", "\n")
    return html.escape(normalized).replace("\n", "<br>")


def _parse_css_color_component(value: Any) -> int:
    raw = normalize_text(value)
    if not raw:
        return 0
    try:
        if raw.endswith("%"):
            return round((float(raw[:-1]) / 100) * 255)
        return round(float(raw))
    except Exception:
        return 0


def _parse_css_alpha_component(value: Any) -> float:
    raw = normalize_text(value)
    if not raw:
        return 1.0
    try:
        if raw.endswith("%"):
            return max(0.0, min(1.0, float(raw[:-1]) / 100))
        return max(0.0, min(1.0, float(raw)))
    except Exception:
        return 1.0


def _clamp_color_byte(value: int) -> int:
    return max(0, min(255, int(value)))


def parse_outgoing_css_color(value: Any) -> dict[str, float] | None:
    raw = normalize_text(value).lower()
    raw = re.sub(r"\s*!important\s*$", "", raw, flags=re.IGNORECASE).strip()
    if not raw or raw in {"transparent", "inherit", "initial", "currentcolor"}:
        return None
    raw = OUTGOING_NAMED_COLORS.get(raw, raw)

    hex_match = re.match(r"^#([0-9a-f]{3,4}|[0-9a-f]{6}|[0-9a-f]{8})$", raw, re.IGNORECASE)
    if hex_match:
        hex_value = hex_match.group(1)
        if len(hex_value) <= 4:
            parts = [
                part * 2
                for part in [
                    hex_value[0],
                    hex_value[1],
                    hex_value[2],
                    hex_value[3] if len(hex_value) > 3 else "f",
                ]
            ]
        else:
            parts = [hex_value[0:2], hex_value[2:4], hex_value[4:6], hex_value[6:8] or "ff"]
        return {
            "r": int(parts[0], 16),
            "g": int(parts[1], 16),
            "b": int(parts[2], 16),
            "a": int(parts[3], 16) / 255,
        }

    rgb_match = re.match(r"^rgba?\((.+)\)$", raw, re.IGNORECASE)
    if not rgb_match:
        return None
    parts = [part for part in re.split(r"[,\s]+", re.sub(r"\s*/\s*", " ", rgb_match.group(1))) if part]
    if len(parts) < 3:
        return None
    return {
        "r": _clamp_color_byte(_parse_css_color_component(parts[0])),
        "g": _clamp_color_byte(_parse_css_color_component(parts[1])),
        "b": _clamp_color_byte(_parse_css_color_component(parts[2])),
        "a": _parse_css_alpha_component(parts[3]) if len(parts) >= 4 else 1.0,
    }


def _srgb_to_linear(value: float) -> float:
    normalized = value / 255
    if normalized <= 0.03928:
        return normalized / 12.92
    return ((normalized + 0.055) / 1.055) ** 2.4


def _relative_luminance(color: dict[str, float]) -> float:
    return (
        (0.2126 * _srgb_to_linear(color["r"]))
        + (0.7152 * _srgb_to_linear(color["g"]))
        + (0.0722 * _srgb_to_linear(color["b"]))
    )


def _contrast_ratio(left_color: dict[str, float], right_color: dict[str, float]) -> float:
    left = _relative_luminance(left_color)
    right = _relative_luminance(right_color)
    lighter = max(left, right)
    darker = min(left, right)
    return (lighter + 0.05) / (darker + 0.05)


def _is_low_contrast_outgoing_text_color(value: Any) -> bool:
    color = parse_outgoing_css_color(value)
    if not color or color["a"] <= 0.05:
        return False
    return _contrast_ratio(color, {"r": 255, "g": 255, "b": 255, "a": 1}) < OUTGOING_LOW_CONTRAST_ON_WHITE


def merge_outgoing_readable_text_style(style_value: Any) -> str:
    declarations: list[str] = []
    changed = False
    for part in str(style_value or "").split(";"):
        declaration = part.strip()
        if not declaration or ":" not in declaration:
            continue
        name, raw_value = declaration.split(":", 1)
        if name.strip().lower() == "color" and _is_low_contrast_outgoing_text_color(raw_value):
            declarations.append(f"color:{OUTGOING_DEFAULT_TEXT_COLOR}")
            changed = True
        else:
            declarations.append(declaration)
    if not changed:
        return str(style_value or "")
    return ";".join(declarations) + ";"


def merge_signature_line_style(style_value: Any) -> str:
    normalized_style = merge_outgoing_readable_text_style(style_value)
    declarations: list[str] = []
    for part in str(normalized_style or "").split(";"):
        declaration = part.strip()
        if not declaration or ":" not in declaration:
            continue
        name = declaration.split(":", 1)[0].strip().lower()
        if name in SIGNATURE_LINE_STYLE_PROPS:
            continue
        declarations.append(declaration)
    declarations.extend(f"{name}:{value}" for name, value in SIGNATURE_LINE_STYLE_PROPS.items())
    return ";".join(declarations) + ";"


class _SignatureSpacingHtmlParser(HTMLParser):
    def __init__(self) -> None:
        super().__init__(convert_charrefs=False)
        self.parts: list[str] = []

    @staticmethod
    def _format_attrs(attrs: list[tuple[str, str | None]]) -> str:
        formatted: list[str] = []
        for name, value in attrs:
            if value is None:
                formatted.append(f" {name}")
                continue
            formatted.append(f' {name}="{html.escape(str(value), quote=True)}"')
        return "".join(formatted)

    @staticmethod
    def _should_compact(tag: str, attrs: list[tuple[str, str | None]]) -> bool:
        if tag.lower() not in {"p", "div"}:
            return False
        attr_names = {str(name or "").lower() for name, _ in attrs}
        return "data-mail-outgoing" not in attr_names and "data-mail-signature" not in attr_names

    @classmethod
    def _compact_attrs(cls, tag: str, attrs: list[tuple[str, str | None]]) -> list[tuple[str, str | None]]:
        if not cls._should_compact(tag, attrs):
            return attrs
        next_attrs: list[tuple[str, str | None]] = []
        style_seen = False
        for name, value in attrs:
            if str(name or "").lower() == "style":
                next_attrs.append((name, merge_signature_line_style(value)))
                style_seen = True
            else:
                next_attrs.append((name, value))
        if not style_seen:
            next_attrs.append(("style", merge_signature_line_style("")))
        return next_attrs

    def handle_starttag(self, tag: str, attrs: list[tuple[str, str | None]]) -> None:
        self.parts.append(f"<{tag}{self._format_attrs(self._compact_attrs(tag, attrs))}>")

    def handle_startendtag(self, tag: str, attrs: list[tuple[str, str | None]]) -> None:
        self.parts.append(f"<{tag}{self._format_attrs(self._compact_attrs(tag, attrs))}>")

    def handle_endtag(self, tag: str) -> None:
        self.parts.append(f"</{tag}>")

    def handle_data(self, data: str) -> None:
        self.parts.append(data)

    def handle_entityref(self, name: str) -> None:
        self.parts.append(f"&{name};")

    def handle_charref(self, name: str) -> None:
        self.parts.append(f"&#{name};")

    def handle_comment(self, data: str) -> None:
        self.parts.append(f"<!--{data}-->")

    def handle_decl(self, decl: str) -> None:
        self.parts.append(f"<!{decl}>")

    def get_html(self) -> str:
        return "".join(self.parts)


class _OutgoingReadableTextHtmlParser(HTMLParser):
    def __init__(self) -> None:
        super().__init__(convert_charrefs=False)
        self.parts: list[str] = []

    @staticmethod
    def _format_attrs(attrs: list[tuple[str, str | None]]) -> str:
        formatted: list[str] = []
        for name, value in attrs:
            if value is None:
                formatted.append(f" {name}")
                continue
            formatted.append(f' {name}="{html.escape(str(value), quote=True)}"')
        return "".join(formatted)

    @staticmethod
    def _normalize_attrs(attrs: list[tuple[str, str | None]]) -> list[tuple[str, str | None]]:
        next_attrs: list[tuple[str, str | None]] = []
        for name, value in attrs:
            if str(name or "").lower() == "style":
                next_attrs.append((name, merge_outgoing_readable_text_style(value)))
            else:
                next_attrs.append((name, value))
        return next_attrs

    def handle_starttag(self, tag: str, attrs: list[tuple[str, str | None]]) -> None:
        self.parts.append(f"<{tag}{self._format_attrs(self._normalize_attrs(attrs))}>")

    def handle_startendtag(self, tag: str, attrs: list[tuple[str, str | None]]) -> None:
        self.parts.append(f"<{tag}{self._format_attrs(self._normalize_attrs(attrs))}>")

    def handle_endtag(self, tag: str) -> None:
        self.parts.append(f"</{tag}>")

    def handle_data(self, data: str) -> None:
        self.parts.append(data)

    def handle_entityref(self, name: str) -> None:
        self.parts.append(f"&{name};")

    def handle_charref(self, name: str) -> None:
        self.parts.append(f"&#{name};")

    def handle_comment(self, data: str) -> None:
        self.parts.append(f"<!--{data}-->")

    def handle_decl(self, decl: str) -> None:
        self.parts.append(f"<!{decl}>")

    def get_html(self) -> str:
        return "".join(self.parts)


def normalize_outgoing_readable_text_colors(value: Any) -> str:
    source = normalize_text(value)
    if not source:
        return ""
    parser = _OutgoingReadableTextHtmlParser()
    try:
        parser.feed(source)
        parser.close()
    except Exception:
        return source
    return normalize_text(parser.get_html())


def normalize_signature_line_spacing(value: Any) -> str:
    source = normalize_text(value)
    if not source:
        return ""
    parser = _SignatureSpacingHtmlParser()
    try:
        parser.feed(source)
        parser.close()
    except Exception:
        return source
    return normalize_text(parser.get_html())


def unwrap_outgoing_html_wrapper(value: Any, *, pattern: re.Pattern[str]) -> str:
    source = normalize_text(value)
    if not source:
        return ""
    match = pattern.match(source)
    if not match:
        return source
    return normalize_text(match.group("body"))


def normalize_signature_html(value: Any) -> str:
    without_outgoing_wrapper = unwrap_outgoing_html_wrapper(value, pattern=OUTGOING_WRAPPER_PATTERN)
    without_signature_wrapper = unwrap_outgoing_html_wrapper(
        without_outgoing_wrapper,
        pattern=OUTGOING_SIGNATURE_WRAPPER_PATTERN,
    )
    return normalize_outgoing_readable_text_colors(normalize_signature_line_spacing(without_signature_wrapper))


def split_outgoing_html_for_signature(body_html: Any, *, prefer_blockquote_split: bool = False) -> tuple[str, str]:
    source = normalize_text(body_html)
    if not source:
        return "", ""

    lowered = source.lower()
    split_indexes: list[int] = []
    for marker in OUTGOING_QUOTED_MARKERS:
        idx = lowered.find(marker.lower())
        if idx > 0:
            split_indexes.append(idx)

    if prefer_blockquote_split and not split_indexes:
        blockquote_idx = lowered.find("<blockquote")
        if blockquote_idx > 0 and OUTGOING_QUOTED_HEADER_PATTERN.search(source[:blockquote_idx]):
            split_indexes.append(blockquote_idx)

    if not split_indexes:
        return source, ""

    split_index = min(split_indexes)
    primary_html = source[:split_index].rstrip()
    quoted_html = source[split_index:].lstrip()
    return primary_html, quoted_html


def wrap_outgoing_html_fragment(fragment_html: Any) -> str:
    source = normalize_text(fragment_html)
    if not source:
        return ""
    return f'<div data-mail-outgoing="true" style="{OUTGOING_MAIL_BODY_STYLE}">{source}</div>'


def build_outgoing_html_body(
    body_html: Any,
    signature_html: Any = "",
    *,
    prefer_signature_before_quote: bool = False,
) -> str:
    body_source = normalize_outgoing_readable_text_colors(body_html)
    signature_source = normalize_signature_html(signature_html)

    primary_html, quoted_html = (
        split_outgoing_html_for_signature(
            body_source,
            prefer_blockquote_split=prefer_signature_before_quote,
        )
        if prefer_signature_before_quote
        else (body_source, "")
    )

    has_primary_html = bool(primary_html)
    has_signature_html = bool(signature_source)

    parts: list[str] = []
    if primary_html:
        parts.append(primary_html)
    if signature_source:
        signature_margin_top = "16px" if has_primary_html else "0"
        parts.append(
            f'<div data-mail-signature="true" style="margin:{signature_margin_top} 0 0 0;">{signature_source}</div>'
        )
    if quoted_html:
        quoted_margin_top = "16px" if (has_primary_html or has_signature_html) else "0"
        parts.append(
            f'<div data-mail-quoted-block="true" style="margin:{quoted_margin_top} 0 0 0;">{quoted_html}</div>'
        )

    if not parts and body_source:
        parts.append(body_source)
    if not parts and signature_source:
        parts.append(signature_source)

    return wrap_outgoing_html_fragment("".join(parts))
