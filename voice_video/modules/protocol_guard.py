"""Jev как дешёвый контролёр протокола: направление темы и «сторож» поручений.

Чистая логика без сети и без config: вызов Jev передаётся как ``decide(state, questions) -> {qid: answer} | None``
(в проде — ``modules.jev.jev_decide``). Сбой Jev никогда не ломает протокол: тема остаётся без метки, поручение — без флага.

* ``classify_topics`` — к какому направлению строительной компании относится тема (+ вторая по вероятности);
* ``check_items`` — каждое поручение реестра: следует ли оно из транскрипта темы и назначен ли ответственный.
  Сомнительные не удаляются, а получают ``flags`` — реестр рисует их с пометкой «⚠ проверить: причина».
"""
from __future__ import annotations

import re
from concurrent.futures import ThreadPoolExecutor
from typing import Any, Callable, Dict, List, Optional, Sequence

Decide = Callable[[Any, Dict[str, Dict]], Optional[Dict[str, Dict]]]

# ключ -> описание для Jev
DOMAIN_CATEGORIES: Dict[str, str] = {
    "construction": "Строительство и производство работ на объекте (СМР, отсыпка, монтаж, техника, графики ГПР, подрядчики на площадке)",
    "docs": "Исполнительная и проектная документация, приёмка и подписание работ (ИД, РД, ПСД, КС-2, КС-3, акты, ВОР)",
    "commissioning": "Пусконаладочные работы (ПНР), испытания, сдача систем",
    "supply": "Снабжение, материалы, ТМЦ, склад, логистика, доставка, суда и рейсы",
    "finance": "Финансы и бухгалтерия: авансы, оплата, договоры и допсоглашения, сметы, бюджеты, зарплата",
    "hr": "Персонал: подбор, командирование, билеты, выезд на объект, охрана труда и ТБ",
    "legal": "Юридические и разрешительные вопросы, согласования с госорганами, технические условия",
    "it": "ИТ, связь, оборудование для связи и видеосвязи",
    "other": "Другое или не относится к перечисленному",
}
DOMAIN_LABELS: Dict[str, str] = {
    "construction": "Стройка", "docs": "Документация", "commissioning": "ПНР", "supply": "Снабжение",
    "finance": "Финансы", "hr": "Персонал", "legal": "Юристы/согласования", "it": "ИТ", "other": "Другое",
}

_SPEAKER_LABEL = re.compile(r"^(?:P\d+_)?SPEAKER_", re.IGNORECASE)
_NO_OWNER = re.compile(r"^(?:—|-|не\s+(?:назначен|определ[её]н|указан)\w*|нет|n/?a)?$", re.IGNORECASE)
_TIME = re.compile(r"\d+")


def _answer_prob(answers: Optional[Dict[str, Dict]], key: str) -> Optional[float]:
    value = (answers or {}).get(key)
    if isinstance(value, dict) and "noul" in value:
        try:
            return float(value["noul"])
        except (TypeError, ValueError):
            return None
    return None


def to_seconds(text: Any) -> Optional[float]:
    """«04:59», «1:02:10», «04:59–05:30» -> секунды первого времени."""
    parts = _TIME.findall(str(text or "").split("–")[0].split("-")[0])
    numbers = [int(p) for p in parts[:3]]
    if len(numbers) == 2:
        return numbers[0] * 60 + numbers[1]
    if len(numbers) == 3:
        return numbers[0] * 3600 + numbers[1] * 60 + numbers[2]
    return None


def _segment_start(segment: Dict[str, Any]) -> float:
    for key in ("start_time", "start"):
        try:
            return float(segment[key])
        except (KeyError, TypeError, ValueError):
            continue
    return 0.0


def topic_for_time(topics: Sequence[Dict[str, Any]], seconds: Optional[float]) -> Optional[Dict[str, Any]]:
    """Тема, в диапазон которой попадает момент; из нескольких (соседние темы касаются границей) — та, что
    началась позже всех; нет содержащей — ближайшая по расстоянию до диапазона.

    Время в реестре поручений — начало темы или момент внутри неё (его пишет LLM): поиск только по «ближайшему
    началу» относил поручения из середины темы в соседнюю.
    """
    if seconds is None or not topics:
        return None
    # допуск: время в реестре — «мм:сс» с округлением вниз, а начало темы бывает 467.7 с
    containing = [t for t in topics
                  if float(t.get("start_time") or 0) - 1.5 <= seconds <= float(t.get("end_time") or 0)]
    if containing:
        return max(containing, key=lambda t: float(t.get("start_time") or 0))

    def distance(topic: Dict[str, Any]) -> float:
        start = float(topic.get("start_time") or 0)
        end = float(topic.get("end_time") or start)
        return min(abs(seconds - start), abs(seconds - end))

    return min(topics, key=distance)


_WORD = re.compile(r"[а-яёa-z0-9]{4,}", re.IGNORECASE)


def _stems(text: str) -> set:
    """Грубые основы слов (первые 5 букв): достаточно, чтобы связать поручение с репликой без лемматизатора."""
    return {w.lower().replace("ё", "е")[:5] for w in _WORD.findall(str(text or ""))}


def evidence_fragment(task_text: str, topic: Dict[str, Any], transcript: Sequence[Dict[str, Any]],
                      radius: float = 75.0, max_chars: int = 6000) -> str:
    """Фрагмент транскрипта вокруг места, где обсуждали поручение.

    Тема бывает на 10–15 минут, а нужная реплика — в любом её месте; обрезка окна по длине давала ложные
    «нет в обсуждении». Ищем минуту темы с наибольшим числом слов поручения и берём ±radius секунд вокруг неё;
    не нашли ни одного совпадения — берём начало темы, как раньше.
    """
    wanted = _stems(task_text)
    start = float(topic.get("start_time") or 0)
    end = float(topic.get("end_time") or start + 300)
    inside = [seg for seg in transcript if start - 5 <= _segment_start(seg) <= end]
    if wanted and inside:
        hits = [(len(wanted & _stems(seg.get("text", ""))), _segment_start(seg)) for seg in inside]
        best_score, best_time = max(hits, key=lambda h: (h[0], -h[1]))
        if best_score > 0:
            # центр — середина самого «плотного» окна из 60 с, а не одна случайная реплика
            density = {}
            for _, moment in hits:
                density[moment] = sum(score for score, other in hits if abs(other - moment) <= 30)
            center = max(density, key=lambda m: (density[m], -m))
            lines = [f"{seg.get('speaker', '?')}: {seg.get('text', '')}" for seg in inside
                     if center - radius <= _segment_start(seg) <= center + radius]
            return chr(10).join(lines)[:max_chars]
    return topic_window_text(topic, transcript, max_chars=max_chars)


def topic_window_text(topic: Dict[str, Any], transcript: Sequence[Dict[str, Any]],
                      max_seconds: float = 900.0, max_chars: int = 14000) -> str:
    start = float(topic.get("start_time") or 0)
    end = min(float(topic.get("end_time") or start + 300), start + max_seconds)
    lines = [f"{seg.get('speaker', '?')}: {seg.get('text', '')}" for seg in transcript
             if start - 5 <= _segment_start(seg) <= end]
    return "\n".join(lines)[:max_chars]


# --- направление темы -------------------------------------------------------------

def classify_topics(topics: List[Dict[str, Any]], decide: Decide, workers: int = 4,
                    min_alt_probability: float = 0.25) -> int:
    """Проставляет теме domain, domain_confidence и (если есть) domain_alt. Возвращает число размеченных."""
    question = {"domain": {
        "type": "choice",
        "instructions": "К какому направлению строительной компании относится тема совещания?",
        "criteria": DOMAIN_CATEGORIES,
    }}

    def tag(topic: Dict[str, Any]) -> bool:
        state = {"topic": {"title": topic.get("topic_title", ""), "summary": (topic.get("summary") or "")[:900]}}
        answer = (decide(state, question) or {}).get("domain")
        if not isinstance(answer, dict) or answer.get("choice") not in DOMAIN_CATEGORIES:
            return False
        topic["domain"] = answer["choice"]
        topic["domain_confidence"] = round(float(answer.get("confidence") or 0.0), 2)
        probs = {k: float(v) for k, v in (answer.get("probabilities") or {}).items() if k in DOMAIN_CATEGORIES}
        alt = sorted(((p, k) for k, p in probs.items() if k != answer["choice"]), reverse=True)
        if alt and alt[0][0] >= min_alt_probability:
            topic["domain_alt"] = alt[0][1]
        return True

    with ThreadPoolExecutor(max_workers=max(1, workers)) as pool:
        return sum(pool.map(tag, topics))


# --- сторож поручений -------------------------------------------------------------

def owner_problem(assignee: Any) -> Optional[str]:
    """Детерминированная проверка ответственного (Jev метку диаризации за человека принимает)."""
    text = str(assignee or "").strip()
    if _SPEAKER_LABEL.match(text):
        return "ответственный — неопознанный голос"
    if _NO_OWNER.match(text):
        return "нет ответственного"
    return None


def check_items(groups: List[Dict[str, Any]], topics: Sequence[Dict[str, Any]], transcript: Sequence[Dict[str, Any]],
                decide: Decide, *, support_min: float = 0.4, owner_min: float = 0.5, workers: int = 4) -> int:
    """Ставит поручениям ``flags``. Возвращает число помеченных."""
    items = [item for group in groups for item in group.get("items", [])]

    def check(item: Dict[str, Any]) -> bool:
        flags: List[str] = []
        rule = owner_problem(item.get("assignee"))
        topic = topic_for_time(topics, to_seconds(item.get("time")))
        questions: Dict[str, Dict] = {}
        if topic is not None and transcript:
            questions["supported"] = {
                "type": "noul",
                "instructions": "Следует ли это поручение из данного фрагмента обсуждения (его действительно поручили или договорились сделать)?",
                "criteria": {"true": "Поручение подтверждается фрагментом", "false": "Фрагмент этого не подтверждает"},
            }
        if rule is None:
            questions["has_owner"] = {
                "type": "noul",
                "instructions": "Указан конкретный сотрудник-ответственный (а не пусто, «не определён» или общая формулировка)?",
                "criteria": {"true": "Ответственный указан", "false": "Нет ответственного"},
            }
        answers = None
        if questions:
            state: Dict[str, Any] = {"task": {k: item.get(k) for k in ("task", "assignee", "deadline")}}
            if "supported" in questions:
                state["fragment"] = evidence_fragment(str(item.get("task") or ""), topic, transcript)
            answers = decide(state, questions)
        supported, owner = _answer_prob(answers, "supported"), _answer_prob(answers, "has_owner")
        if supported is not None and supported < support_min:
            flags.append("нет в обсуждении")
        if rule:
            flags.append(rule)
        elif owner is not None and owner < owner_min:
            flags.append("нет ответственного")
        if flags:
            item["flags"] = flags
        return bool(flags)

    with ThreadPoolExecutor(max_workers=max(1, workers)) as pool:
        return sum(pool.map(check, items))
