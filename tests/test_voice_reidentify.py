"""voice_video/modules/reidentify.py: пореплечная проверка голосов по эталонам — осторожные правила замены метки."""
from __future__ import annotations

import importlib.util
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
spec = importlib.util.spec_from_file_location("reidentify_under_test", ROOT / "voice_video" / "modules" / "reidentify.py")
ri = importlib.util.module_from_spec(spec)
spec.loader.exec_module(ri)


def item(index, speaker, duration, **distances):
    return {"index": index, "speaker": speaker, "duration": duration, "distances": distances}


def test_a_clear_match_to_another_reference_relabels_but_ambiguous_short_or_similar_to_current_do_not():
    items = [
        item(0, "Костылев", 8.0, Руденко=0.12, Костылев=0.52, Тараева=0.60),     # явно Руденко, на Костылева не похож — меняем
        item(1, "Костылев", 8.0, Руденко=0.21, Костылев=0.27, Тараева=0.60),     # Руденко и Костылев почти равны — не гадаем
        item(2, "Костылев", 8.0, Руденко=0.40, Костылев=0.20, Тараева=0.55),     # это Костылев — остаётся
        item(3, "Костылев", 2.0, Руденко=0.10, Костылев=0.60),                   # слишком короткая реплика
        item(4, "SPEAKER_05", 6.0, Пылаева=0.14, Чернетов=0.50),                  # безымянная метка, чёткое совпадение — называем
        item(5, "Костылев", 8.0, Руденко=0.24, Костылев=0.30, Тараева=0.58),     # Руденко ближе, но реплика ещё похожа на Костылева (≤0.35)
        item(6, "Костылев", 8.0),                                                # нет расстояний
    ]
    assert ri.plan_relabel(items) == {0: "Руденко", 4: "Пылаева"}


def test_a_single_reference_needs_no_runner_up_margin_but_must_be_strictly_close():
    assert ri.plan_relabel([item(0, "SPEAKER_01", 5.0, Миняйчев=0.20)]) == {0: "Миняйчев"}
    assert ri.plan_relabel([item(0, "SPEAKER_01", 5.0, Миняйчев=0.31)]) == {}
