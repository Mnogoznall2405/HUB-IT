"""Словарь компании: аббревиатуры, объекты, подрядчики — без раздувания промпта.

Подтверждённый словарь живёт в PostgreSQL (вкладка «Словарь» в интерфейсе) и выгружается voice_server в
``data/company_glossary.json``; пайплайн читает только этот файл. Здесь — чистая логика без сети и БД:

* ``select_relevant`` — в промпт идут только термины, которые встречаются в этой записи (плюс небольшое ядро);
* ``format_prompt_block`` — компактный блок с жёстким потолком по размеру;
* ``correct_text`` — детерминированная замена подтверждённых вариантов написания (ошибок распознавания), без LLM;
* ``hot_terms`` — короткий список имён/объектов для подсказки распознаванию речи;
* ``parse_candidates`` — разбор ответа LLM с кандидатами в словарь (человек подтверждает их во вкладке).
"""
from __future__ import annotations

import json
import re
from functools import lru_cache
from pathlib import Path
from typing import Any, Dict, Iterable, List, Optional, Sequence, Tuple

KINDS = ("abbr", "object", "org", "doc", "person", "other")
KIND_LABELS = {"abbr": "Аббревиатура", "object": "Объект", "org": "Организация", "doc": "Документ",
               "person": "Человек", "other": "Другое"}
UNKNOWN_EXPANSION = ("?", "—", "-", "неизвестно", "unknown")


def _norm(text: Any) -> str:
    return re.sub(r"\s+", " ", str(text or "").lower().replace("ё", "е")).strip()


@lru_cache(maxsize=40000)
def _pattern(phrase: str) -> "re.Pattern[str]":
    return re.compile(r"(?<![0-9a-zа-яе])" + re.escape(_norm(phrase)) + r"(?![0-9a-zа-яе])")


def load_terms(path: Optional[Path]) -> List[Dict[str, Any]]:
    """Подтверждённые термины из выгрузки; нет файла или он битый — пустой словарь (пайплайн работает как раньше)."""
    if not path:
        return []
    try:
        data = json.loads(Path(path).read_text(encoding="utf-8"))
    except (OSError, ValueError):
        data = {}  # основной выгрузки может не быть (словарь ещё не заполнен) — сотрудники всё равно подгружаются
    terms = data.get("terms") if isinstance(data, dict) else data
    # Сотрудники и объекты из структуры компании (staff_glossary.json рядом): отдельный файл, выгрузка словаря его не затирает
    try:
        staff = json.loads(Path(path).with_name("staff_glossary.json").read_text(encoding="utf-8"))
        terms = list(terms or []) + list(staff.get("terms") or [])
    except (OSError, ValueError, AttributeError):
        pass
    out = []
    for item in terms or []:
        if isinstance(item, dict) and str(item.get("term") or "").strip() \
                and str(item.get("status") or "confirmed") == "confirmed":
            out.append(item)
    return out


def select_relevant(terms: Sequence[Dict[str, Any]], text: str, *, max_terms: int = 40,
                    core_limit: int = 12) -> List[Dict[str, Any]]:
    """Термины, встретившиеся в тексте (сам термин или его вариант написания), по убыванию частоты + ядро.

    Ядро — термины с ``core: true`` (общие для всей компании), не больше ``core_limit``.
    """
    haystack = _norm(text)
    scored: List[Tuple[int, int, Dict[str, Any]]] = []
    core: List[Dict[str, Any]] = []
    for index, item in enumerate(terms):
        phrases = [item.get("term")] + list(item.get("aliases") or []) + list(item.get("match") or [])
        hits = sum(len(_pattern(p).findall(haystack)) for p in phrases if str(p or "").strip())
        if hits:
            scored.append((-hits, index, item))
        elif item.get("core"):
            core.append(item)
    chosen = [item for _, _, item in sorted(scored, key=lambda row: (row[0], row[1]))]
    for item in core[:core_limit]:
        if len(chosen) >= max_terms:
            break
        chosen.append(item)
    return chosen[:max_terms]


def format_prompt_block(terms: Sequence[Dict[str, Any]], max_chars: int = 1800) -> str:
    """Компактный блок для системного промпта; пустой словарь — пустая строка (промпт не меняется)."""
    meanings, spellings = [], []
    for item in terms:
        term = str(item.get("term") or "").strip()
        expansion = str(item.get("expansion") or "").strip()
        if expansion and _norm(expansion) not in UNKNOWN_EXPANSION:
            meanings.append(f"{term} — {expansion}")
        else:
            spellings.append(term)
    if not meanings and not spellings:
        return ""
    lines = ["", "Глоссарий компании (строительная компания; пиши эти слова именно так и не придумывай других расшифровок):"]
    used = sum(len(line) for line in lines)
    for line in meanings:
        if used + len(line) + 3 > max_chars:
            break
        lines.append(f"- {line}")
        used += len(line) + 3
    if spellings:
        tail = "Верное написание: " + ", ".join(spellings)
        lines.append(tail[:max(0, max_chars - used)])
    return "\n".join(lines) + "\n"


def format_objects_block(terms: Sequence[Dict[str, Any]], max_chars: int = 2000) -> str:
    """Постоянный компактный список объектов строительства для промптов анализа/протокола/реестра.

    Объекты с общим первым словом («Белушья Губа Склад ГСМ», «Белушья Губа Общежитие») сворачиваются в одну строку
    «Белушья Губа: Склад ГСМ; Общежитие», чтобы список был короче; потолок max_chars не даёт раздуть промпт.
    """
    names = []
    for item in terms:
        if (item.get("kind") or "") == "object" and str(item.get("term") or "").strip():
            names.append(re.sub(r"\s+", " ", str(item["term"])).strip())
    if not names:
        return ""
    groups: Dict[str, List[str]] = {}
    for name in dict.fromkeys(names):
        first = name.split(" ", 1)[0]
        groups.setdefault(_norm(first), []).append(name)
    entries = []
    for members in sorted(groups.values(), key=lambda m: (-len(m), m[0])):
        if len(members) == 1:
            entries.append(members[0])
            continue
        split = [m.split(" ") for m in members]
        common = 0
        while all(len(w) > common for w in split) and len({_norm(w[common]) for w in split}) == 1:
            common += 1   # общий префикс слов: «Белушья Губа», а не только «Белушья»
        common = max(common, 1)
        label = " ".join(split[0][:common]).rstrip(" -")
        rest = [" ".join(w[common:]).lstrip("- ").strip() or "(основной)" for w in split]
        first_words = [r.split(" ")[0] for r in rest if r != "(основной)"]
        if any(a != b and b.startswith(a) for a in first_words for b in first_words):
            entries.append("; ".join(members))   # «Земля», «Земля/1»: общий префикс разрезал бы название — пишем целиком
            continue
        entries.append(f"{label}: " + "; ".join(rest))
    header = ("\nОбъекты строительства компании (при упоминании пиши название именно так; привязывай темы и поручения к объекту, "
              "если он понятен из разговора; не придумывай объекты, которых нет в списке):\n")
    body, used = [], len(header)
    for entry in entries:
        if used + len(entry) + 3 > max_chars:
            break
        body.append(f"- {entry}")
        used += len(entry) + 3
    return header + "\n".join(body) + "\n"


def hot_terms(terms: Sequence[Dict[str, Any]], text: str = "", limit: int = 30,
              kinds: Iterable[str] = ("object", "org", "person", "abbr")) -> List[str]:
    """Короткий список слов для подсказки распознаванию речи: сначала встретившиеся в тексте, потом ядро."""
    wanted = set(kinds)
    pool = [t for t in terms if (t.get("kind") or "other") in wanted]
    chosen = select_relevant(pool, text, max_terms=limit) if text else [t for t in pool if t.get("core")][:limit]
    return [str(t["term"]).strip() for t in chosen][:limit]


def correct_text(text: str, terms: Sequence[Dict[str, Any]]) -> Tuple[str, int]:
    """Заменяет подтверждённые варианты написания на термин. Только точные совпадения целых слов.

    Регистр первой буквы сохраняется («унто» -> «УМТО» остаётся аббревиатурой, «Анкор» после точки — с заглавной).
    """
    count = 0
    result = str(text or "")
    for item in terms:
        term = str(item.get("term") or "").strip()
        for alias in item.get("aliases") or []:
            alias = str(alias or "").strip()
            if not alias or _norm(alias) == _norm(term):
                continue
            pattern = re.compile(r"(?<![0-9A-Za-zА-Яа-яЁё])" + re.escape(alias) + r"(?![0-9A-Za-zА-Яа-яЁё])", re.IGNORECASE)
            result, n = pattern.subn(lambda m, t=term: _keep_case(m.group(0), t), result)
            count += n
    return result, count


def _keep_case(original: str, term: str) -> str:
    if term.isupper() or not original[:1].isupper():
        return term
    return term[:1].upper() + term[1:]


def correct_segments(segments: List[Dict[str, Any]], terms: Sequence[Dict[str, Any]]) -> int:
    """Исправляет text сегментов на месте; возвращает число замен."""
    total = 0
    if not terms:
        return 0
    for segment in segments:
        fixed, n = correct_text(segment.get("text", ""), terms)
        if n:
            segment["text"] = fixed
            total += n
    return total


def parse_candidates(payload: Any, existing: Sequence[Dict[str, Any]] = (), *, max_items: int = 80) -> List[Dict[str, Any]]:
    """Ответ LLM -> список кандидатов {term, kind, expansion, aliases, evidence}; уже известные термины отбрасываются."""
    if isinstance(payload, str):
        match = re.search(r"\{.*\}", payload, re.S)
        try:
            payload = json.loads(match.group(0)) if match else None
        except ValueError:
            payload = None
    if not isinstance(payload, dict):
        return []
    known = {_norm(item.get("term")) for item in existing}
    for item in existing:
        known.update(_norm(a) for a in item.get("aliases") or [])
    out: Dict[str, Dict[str, Any]] = {}

    def add(term: Any, kind: str, expansion: Any = "", evidence: Any = "", aliases: Iterable[Any] = ()):
        term = re.sub(r"\s+", " ", str(term or "")).strip(" .,;:«»\"'")
        key = _norm(term)
        if len(key) < 2 or len(term) > 60 or key in known or key in out:
            return
        expansion = str(expansion or "").strip()
        out[key] = {"term": term, "kind": kind if kind in KINDS else "other",
                    "expansion": "" if _norm(expansion) in UNKNOWN_EXPANSION else expansion[:200],
                    "evidence": str(evidence or "").strip()[:300],
                    "aliases": [str(a).strip() for a in aliases if str(a or "").strip()][:5]}

    for row in payload.get("abbreviations") or []:
        if isinstance(row, dict):
            add(row.get("abbr") or row.get("term"), "abbr", row.get("expansion"), row.get("evidence"))
    for key, kind in (("objects", "object"), ("organizations", "org"), ("document_types", "doc")):
        for row in payload.get(key) or []:
            add(row.get("name") if isinstance(row, dict) else row, kind)
    for row in payload.get("suspected_asr_errors") or []:
        # «text → likely»: в словарь идёт верное написание, а неверное — как вариант (alias), если оно ему не равно
        if isinstance(row, dict) and str(row.get("likely") or "").strip() not in ("", "?", "—"):
            likely = str(row["likely"]).split("/")[0].strip()
            add(likely, "other", evidence=row.get("reason"), aliases=[row.get("text")])
    return list(out.values())[:max_items]


CANDIDATE_PROMPT = (
    "Ниже краткое содержание видеоконференций строительной компании (стройплощадки, бухгалтерия, снабжение, ПТО). "
    "Извлеки JSON с полями: \"abbreviations\" (список {\"abbr\",\"expansion\",\"evidence\"}; расшифровку давай только если она "
    "очевидна из контекста или общеизвестна в строительстве, иначе \"?\"), \"objects\" (площадки, города, объекты), "
    "\"organizations\" (подрядчики, заказчики, госорганы), \"document_types\" (виды документов), "
    "\"suspected_asr_errors\" (список {\"text\",\"likely\",\"reason\"} — слова, похожие на ошибки распознавания речи; "
    "likely — как верно, или \"?\"). Только JSON, без пояснений.\n\n"
)


def build_candidate_context(topics: Sequence[Dict[str, Any]], max_chars: int = 24000) -> str:
    """Краткое содержание тем для извлечения кандидатов (названия и summary, с потолком)."""
    parts, used = [], 0
    for index, topic in enumerate(topics):
        chunk = f"[{index}] {topic.get('topic_title', '')}\n{(topic.get('summary') or '')[:700]}"
        if used + len(chunk) > max_chars:
            break
        parts.append(chunk)
        used += len(chunk)
    return "\n\n".join(parts)
