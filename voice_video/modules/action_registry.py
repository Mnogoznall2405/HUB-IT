"""Реестр поручений: LLM отдаёт JSON, markdown-таблицу собираем сами.

Раньше LLM писала таблицу сама: «|» в тексте поручения или потерянная колонка
ломали разбор в веб-интерфейсе (строки молча пропадали). Формат таблицы прежний —
его читают clips.py, отчёты (md/html/pdf/docx) и voice_server.pipeline.
"""

import json
import re
from typing import Any, Dict, List, Optional

_FENCE_RE = re.compile(r"^```(?:json)?\s*|\s*```$", re.IGNORECASE)
_DASH = "—"


def _cell(value: Any) -> str:
    text = re.sub(r"\s+", " ", str(value or "")).strip()
    return text.replace("|", "/") or _DASH


def parse_registry_json(text: Optional[str]) -> Optional[List[Dict[str, Any]]]:
    """Ответ LLM -> [{"title", "items": [{"time", "task", "assignee", "deadline"}]}] или None."""
    if not text or not text.strip():
        return None
    raw = _FENCE_RE.sub("", text.strip())
    try:
        data = json.loads(raw)
    except ValueError:
        start, end = raw.find("{"), raw.rfind("}")
        if start < 0 or end <= start:
            return None
        try:
            data = json.loads(raw[start:end + 1])
        except ValueError:
            return None
    groups = data.get("groups") if isinstance(data, dict) else data
    if not isinstance(groups, list):
        return None
    out = []
    for group in groups:
        if not isinstance(group, dict):
            continue
        items = []
        for item in group.get("items") or []:
            if not isinstance(item, dict) or not str(item.get("task") or "").strip():
                continue
            items.append({
                "time": str(item.get("time") or "").strip(),
                "task": str(item.get("task")).strip(),
                "assignee": str(item.get("assignee") or "").strip(),
                "deadline": str(item.get("deadline") or "").strip(),
            })
        if items:
            out.append({"title": str(group.get("title") or "").strip(), "items": items})
    return out


def render_registry_markdown(groups: List[Dict[str, Any]]) -> str:
    """Таблица в прежнем формате; нумерация сквозная внутри каждой группы."""
    lines = ["## Протокол поручений", ""]
    for group in groups or []:
        title = _cell(group.get("title")) if group.get("title") else "Общие поручения"
        lines += [
            f"### {title}",
            "",
            "| № | Время | Поручение | Ответственный | Срок |",
            "|---|-------|-----------|---------------|------|",
        ]
        for n, item in enumerate(group.get("items") or [], 1):
            lines.append(
                f"| {n} | {_cell(item.get('time'))} | {_cell(item.get('task'))} | "
                f"{_cell(item.get('assignee'))} | {_cell(item.get('deadline'))} |"
            )
        lines.append("")
    return "\n".join(lines).rstrip() + "\n"


def registry_markdown_from_llm(text: Optional[str]) -> Optional[str]:
    """JSON -> markdown; старый ответ таблицей (модель проигнорировала формат) — как есть."""
    groups = parse_registry_json(text)
    if groups is not None:
        return render_registry_markdown(groups) if groups else None
    if text and "|" in text:
        return text
    return None
