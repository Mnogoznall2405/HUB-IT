from __future__ import annotations

import logging
import os
from pathlib import Path
import re
import unicodedata
from typing import Any, Dict, Iterable, List, Optional, Tuple

import yaml

from .pattern_filters import incident_pattern_filter_metadata

logger = logging.getLogger(__name__)


def _repo_root() -> Path:
    return Path(__file__).resolve().parent.parent


def _patterns_file() -> Path:
    raw = str(os.getenv("SCAN_PATTERNS_FILE", "")).strip()
    if raw:
        return Path(raw)
    return _repo_root() / "patterns_strict.yaml"


def _read_text_with_fallback(path: Path) -> str:
    for encoding in ("utf-8-sig", "utf-8", "cp1251"):
        try:
            return path.read_text(encoding=encoding)
        except Exception:
            continue
    return ""


def _re_flags(flags: Any) -> int:
    out = 0
    if not isinstance(flags, list):
        return out
    for item in flags:
        token = str(item or "").strip().lower()
        if token in {"ignorecase", "i"}:
            out |= re.IGNORECASE
        elif token in {"dotall", "s"}:
            out |= re.DOTALL
        elif token in {"multiline", "m"}:
            out |= re.MULTILINE
    return out


def _normalize_pattern_category(value: Any) -> str:
    text = str(value or "").strip()
    return text or "Общие"


def _normalize_enabled_by_default(value: Any) -> bool:
    if isinstance(value, bool):
        return value
    if value is None:
        return True
    raw = str(value or "").strip().lower()
    if raw in {"0", "false", "no", "off", "disabled"}:
        return False
    if raw in {"1", "true", "yes", "on", "enabled"}:
        return True
    return True


def _load_defs() -> Tuple[List[Dict[str, Any]], Dict[str, float], Dict[str, float]]:
    default_thresholds = {"dsp": 1.0, "review": 0.8}
    path = _patterns_file()
    if not path.exists():
        logger.error("patterns file not found: %s", path)
        return [], {}, default_thresholds

    text = _read_text_with_fallback(path)
    if not text.strip():
        logger.error("patterns file is empty: %s", path)
        return [], {}, default_thresholds

    try:
        payload = yaml.safe_load(text) or {}
    except Exception as exc:
        logger.error("patterns file parse failed: %s", exc)
        return [], {}, default_thresholds

    rows = payload.get("patterns") if isinstance(payload, dict) else []
    if not isinstance(rows, list):
        rows = []

    defs: List[Dict[str, Any]] = []
    weights: Dict[str, float] = {}
    for row in rows:
        if not isinstance(row, dict):
            continue
        if str(row.get("type") or "regex").strip().lower() != "regex":
            continue
        pattern_id = str(row.get("id") or "").strip()
        pattern_raw = str(row.get("pattern") or "")
        if not pattern_id or not pattern_raw:
            continue
        weight = float(row.get("weight") or 1.0)
        flags = _re_flags(row.get("flags"))
        try:
            regex = re.compile(pattern_raw, flags)
        except Exception as exc:
            logger.warning("pattern compile failed id=%s: %s", pattern_id, exc)
            continue
        defs.append(
            {
                "id": pattern_id,
                "name": str(row.get("name") or pattern_id),
                "category": _normalize_pattern_category(row.get("category")),
                "enabled_by_default": _normalize_enabled_by_default(row.get("enabled_by_default")),
                "weight": weight,
                "regex": regex,
            }
        )
        weights[pattern_id] = weight

    if not defs:
        logger.warning("No regex patterns loaded from %s", path)

    scoring = payload.get("scoring") if isinstance(payload, dict) else {}
    thresholds = scoring.get("thresholds") if isinstance(scoring, dict) else {}
    dsp_threshold = float((thresholds or {}).get("dsp") or 1.0)
    review_threshold = float((thresholds or {}).get("review") or 0.8)

    logger.info("Loaded strict patterns: count=%s file=%s", len(defs), path)
    return defs, weights, {"dsp": dsp_threshold, "review": review_threshold}


PATTERN_DEFS, PATTERN_WEIGHTS, THRESHOLDS = _load_defs()
ALLOWED_PATTERN_IDS = set(PATTERN_WEIGHTS.keys())


def allowed_pattern_ids() -> set[str]:
    return set(ALLOWED_PATTERN_IDS)


def normalize_pattern_filter(allowed_pattern_ids: Optional[Iterable[Any]]) -> Optional[set[str]]:
    if allowed_pattern_ids is None:
        return None
    normalized = {
        str(item or "").strip()
        for item in allowed_pattern_ids
        if str(item or "").strip()
    }
    if not normalized:
        return None
    return normalized & ALLOWED_PATTERN_IDS


def list_patterns() -> List[Dict[str, Any]]:
    out: List[Dict[str, Any]] = []
    for item in PATTERN_DEFS:
        pattern_id = str(item.get("id") or "").strip()
        if not pattern_id:
            continue
        pattern_name = str(item.get("name") or pattern_id)
        incident_filter = incident_pattern_filter_metadata(pattern_id, pattern_name)
        out.append(
            {
                "id": pattern_id,
                "name": pattern_name,
                "category": _normalize_pattern_category(item.get("category")),
                "weight": float(item.get("weight") or 1.0),
                "enabled_by_default": _normalize_enabled_by_default(item.get("enabled_by_default")),
                "incident_filter_id": incident_filter["id"],
                "incident_filter_name": incident_filter["name"],
            }
        )
    return out


def _snippet(text: str, start: int, end: int, radius: int = 36) -> str:
    left = max(0, start - radius)
    right = min(len(text), end + radius)
    return text[left:right].replace("\n", " ").strip()


_SPACED_DSP_PHRASE_RE = re.compile(
    r"(?i)д\s*л\s*я\s*с\s*л\s*у\s*ж\s*е\s*б\s*н\s*о\s*г\s*о\s*п\s*о\s*л\s*ь\s*з\s*о\s*в\s*а\s*н\s*и\s*я"
)
_SPACED_CYRILLIC_WORD_RE = re.compile(r"(?<!\w)(?:[а-яё][ \t]){3,}[а-яё](?!\w)", re.IGNORECASE)
_DSP_FURNITURE_RE = re.compile(r"(?i)(?:столешниц|мебел|плит|лист|дсп\s*22\s*мм|\b\d+\s*мм\b)")
_OCR_LATIN_TO_CYRILLIC = str.maketrans(
    "AaBCcEeHKMOoPpTXYxyD",
    "АаВСсЕеНКМОоРрТХУхуД",
)


def normalize_scan_text(value: Any) -> str:
    """Normalize OCR noise without changing the original evidence snippets."""
    text = unicodedata.normalize("NFKC", str(value or "")).replace("ё", "е").replace("Ё", "Е")
    text = text.replace("\u00ad", "").replace("\u200b", "")
    text = re.sub(r"(?<=\w)[\-‐‑–—]\s*(?=\w)", "", text)
    text = _SPACED_DSP_PHRASE_RE.sub("Для служебного пользования", text)
    text = _SPACED_CYRILLIC_WORD_RE.sub(lambda match: re.sub(r"\s+", "", match.group(0)), text)
    return re.sub(r"\s+", " ", text.translate(_OCR_LATIN_TO_CYRILLIC)).strip()


def _is_excluded_dsp_context(text: str, start: int, end: int) -> bool:
    left = max(0, start - 80)
    right = min(len(text), end + 80)
    return bool(_DSP_FURNITURE_RE.search(text[left:right]))


def scan_text(text: str, allowed_pattern_ids: Optional[Iterable[Any]] = None) -> List[Dict[str, str]]:
    source = str(text or "")
    if not source.strip():
        return []
    allowed = normalize_pattern_filter(allowed_pattern_ids)
    normalized_source = normalize_scan_text(source)
    sources = [source]
    if normalized_source and normalized_source != source:
        sources.append(normalized_source)
    out: List[Dict[str, str]] = []
    seen: set[tuple[str, str, str]] = set()
    for item in PATTERN_DEFS:
        pattern_id = str(item.get("id") or "")
        if allowed is not None and pattern_id not in allowed:
            continue
        name = str(item.get("name") or pattern_id)
        weight = float(item.get("weight") or 1.0)
        regex = item.get("regex")
        if not pattern_id or regex is None:
            continue
        for candidate in sources:
            for match in regex.finditer(candidate):
                if pattern_id == "dsp_with_exclusion" and _is_excluded_dsp_context(
                    candidate, match.start(), match.end()
                ):
                    continue
                key = (
                    pattern_id,
                    normalize_scan_text(match.group(0)).casefold(),
                    normalize_scan_text(_snippet(candidate, match.start(), match.end())).casefold(),
                )
                if key in seen:
                    continue
                seen.add(key)
                out.append(
                    {
                        "pattern": pattern_id,
                        "pattern_name": name,
                        "weight": str(weight),
                        "value": match.group(0),
                        "snippet": _snippet(candidate, match.start(), match.end()),
                    }
                )
                if len(out) >= 200:
                    return out
    matched_ids = {str(item.get("pattern") or "") for item in out}
    if "dsp_official_use" in matched_ids:
        out = [
            item for item in out
            if item.get("pattern") not in {"dsp_ocr_variant", "dsp_ocr_context"}
        ]
    elif "dsp_ocr_variant" in matched_ids:
        out = [item for item in out if item.get("pattern") != "dsp_ocr_context"]
    return out


def classify_severity(matches: List[Dict[str, str]]) -> str:
    if not matches:
        return "none"
    total_score = 0.0
    unique_pattern_ids = {
        str(item.get("pattern") or "")
        for item in matches
        if str(item.get("pattern") or "")
    }
    for pattern_id in unique_pattern_ids:
        total_score += float(PATTERN_WEIGHTS.get(pattern_id, 0.0))

    if total_score >= float(THRESHOLDS.get("dsp") or 1.0):
        return "high"
    if total_score >= float(THRESHOLDS.get("review") or 0.8):
        return "medium"
    return "low"
