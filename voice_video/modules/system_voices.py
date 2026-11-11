"""Служебные голоса (автоответчик, «абонент недоступен»): не люди, в промпты анализа и протокол не попадают.

Реплика считается служебной, если голос назван «Автоответчик» (эталон голоса) или безымянная метка (SPEAKER_xx) произносит
типовую фразу автоответчика. Названным людям реплики не отсекаются: человек может процитировать фразу в разговоре.
Чистая логика покрыта tests/test_voice_system_voices.py.
"""
from __future__ import annotations

import re
from typing import Any, Dict, List, Tuple

SYSTEM_NAMES = {"автоответчик"}
PHRASES = re.compile(
    r"абонент\s+(?:сейчас\s+)?не\s+может\s+ответить|номер\s+не\s+отвечает|оставьте\s+сообщение|"
    r"оставайтесь\s+на\s+линии|продолжаем\s+дозваниваться|телефон\s+(?:занят|выключен)|"
    r"вызываемый\s+абонент|аппарат\s+абонента\s+выключен|после\s+(?:длинного\s+)?(?:сигнала|гудка)",
    re.IGNORECASE,
)
_UNNAMED = re.compile(r"^(?:P\d+_)?SPEAKER_", re.IGNORECASE)


def is_system_segment(segment: Dict[str, Any]) -> bool:
    speaker = str(segment.get("speaker") or "").strip()
    if speaker.lower() in SYSTEM_NAMES:
        return True
    return bool(_UNNAMED.match(speaker)) and bool(PHRASES.search(str(segment.get("text") or "")))


def drop_system_voices(segments: List[Dict[str, Any]]) -> Tuple[List[Dict[str, Any]], int]:
    """(реплики без служебных голосов, сколько убрано)."""
    kept = [s for s in segments if not is_system_segment(s)]
    return kept, len(segments) - len(kept)
