"""voice_video/modules/system_voices.py: автоответчик не попадает в анализ, а люди, процитировавшие фразу, остаются."""
from __future__ import annotations

import importlib.util
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
spec = importlib.util.spec_from_file_location("system_voices_under_test", ROOT / "voice_video" / "modules" / "system_voices.py")
sv = importlib.util.module_from_spec(spec)
spec.loader.exec_module(sv)


def test_answering_machine_is_dropped_by_voice_name_or_typical_phrase_but_people_are_kept():
    segments = [
        {"speaker": "Автоответчик", "text": "что угодно"},                                              # эталон голоса «Автоответчик»
        {"speaker": "SPEAKER_03", "text": "Абонент сейчас не может ответить на ваш звонок."},          # безымянная метка + типовая фраза
        {"speaker": "SPEAKER_02", "text": "Номер не отвечает. Оставьте сообщение на автоответчик."},
        {"speaker": "Веклич Иван Алексеевич", "text": "Номер не отвечает, перезвоню позже"},          # человек процитировал — остаётся
        {"speaker": "SPEAKER_05", "text": "Да, я поняла."},                                           # безымянный, но обычная речь
    ]
    kept, dropped = sv.drop_system_voices(segments)
    assert dropped == 3 and [s["speaker"] for s in kept] == ["Веклич Иван Алексеевич", "SPEAKER_05"]
