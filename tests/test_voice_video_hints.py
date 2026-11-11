"""voice_video/video_speaker_hints.py: рамка активного говорящего, виды плиток, склейка, сводка «плитка ↔ голос»."""
from __future__ import annotations

import importlib.util
from pathlib import Path

import numpy as np
import pytest

ROOT = Path(__file__).resolve().parents[1]
spec = importlib.util.spec_from_file_location("video_hints_under_test", ROOT / "voice_video" / "video_speaker_hints.py")
vh = importlib.util.module_from_spec(spec)
spec.loader.exec_module(vh)

ORANGE = (200, 135, 70)


def _frame():
    image = np.full((720, 1280, 3), (40, 40, 40), dtype=np.uint8)
    return image


def _ring(image, box, thickness=3, color=ORANGE):
    x0, y0, x1, y1 = box
    image[y0:y0 + thickness, x0:x1 + 1] = color
    image[y1 - thickness + 1:y1 + 1, x0:x1 + 1] = color
    image[y0:y1 + 1, x0:x0 + thickness] = color
    image[y0:y1 + 1, x1 - thickness + 1:x1 + 1] = color


def test_active_tile_is_the_orange_ring_not_orange_blobs_or_empty_frames():
    image = _frame()
    _ring(image, (430, 112, 850, 349))
    image[300:340, 900:1000] = ORANGE                    # сплошное оранжевое пятно (стол/предмет на фото) — не рамка
    box = vh.find_active_tile(image)
    assert box is not None and all(abs(a - b) <= 2 for a, b in zip(box, (430, 112, 850, 349)))
    assert vh.find_active_tile(_frame()) is None          # никто не подсвечен
    thin_noise = _frame()
    thin_noise[100:103, 10:60] = ORANGE                  # короткая линия (значок) — не плитка
    assert vh.find_active_tile(thin_noise) is None


def test_tile_kinds_separate_people_from_rooms_and_empty_labels():
    assert vh.tile_kind("Вельчев Игорь Петрович") == "person"
    assert vh.tile_kind("Руденко Владислав Александрович") == "person"
    assert vh.tile_kind('ПАО "Запсибгазпром" г.Москва') == "room"
    assert vh.tile_kind("Санкт-Петербург, ул. Чапаева 15, 4-401") == "room"
    assert vh.tile_kind("Магадан") == "room" and vh.tile_kind("Белушья губа") == "room"
    assert vh.tile_kind("  ") == "unknown"


def test_consolidate_joins_neighbours_and_tolerates_one_missed_frame_but_not_a_long_gap():
    samples = [{"t": t, "name": n} for t, n in [(0, "А"), (2, "А"), (4, ""), (6, "А"), (8, "Б"), (10, "Б"), (30, "Б")]]
    spans = vh.consolidate(samples, 2.0)
    assert [(s["name"], s["start"], s["end"]) for s in spans] == [("А", 0, 8), ("Б", 8, 12), ("Б", 30, 32)]


def test_ocr_variants_of_one_tile_are_merged_into_the_most_frequent_name():
    spans = [{"start": 0, "end": 100, "name": 'ПАО "Запсибгазпром Москва'}, {"start": 100, "end": 140, "name": 'ПАО "Запсибгазпром\' гМосква'},
             {"start": 140, "end": 200, "name": "Вельчев Игорь Петрович"}, {"start": 200, "end": 210, "name": "ьчев Игорь Петрович"}]
    mapping = vh.canonical_names(spans)
    assert mapping['ПАО "Запсибгазпром\' гМосква'] == 'ПАО "Запсибгазпром Москва'
    assert mapping["ьчев Игорь Петрович"] == "Вельчев Игорь Петрович"
    assert mapping['ПАО "Запсибгазпром Москва'] != mapping["Вельчев Игорь Петрович"]


def test_summary_names_unknown_voice_lists_room_roster_and_flags_name_conflicts():
    spans = [{"start": 0, "end": 60, "name": "Пылаева Виктория Викторовна"},
             {"start": 60, "end": 200, "name": 'ПАО "Запсибгазпром" г.Москва'},
             {"start": 200, "end": 290, "name": "Вельчев Игорь Петрович"},
             {"start": 290, "end": 300, "name": "Руденко Владислав Александрович"}]
    turns = [{"start": 0, "end": 60, "speaker": "SPEAKER_05"},                 # безымянный голос на плитке-человеке
             {"start": 60, "end": 200, "speaker": "Водопьянов Юрий Леонидович"},  # комната
             {"start": 200, "end": 290, "speaker": "Величко Андрей Александрович"},  # аккаунт «Вельчев», голос — Величко
             {"start": 290, "end": 300, "speaker": "Руденко Владислав Александрович"}]  # совпало — не конфликт
    result = vh.summarize_hints(spans, turns, min_seconds=20)
    assert result["suggested"] == {"SPEAKER_05": "Пылаева Виктория Викторовна"}
    assert [(c["speaker"], c["tile"]) for c in result["conflicts"]] == [("Величко Андрей Александрович", "Вельчев Игорь Петрович")]
    assert result["rooms"] == {'ПАО "Запсибгазпром" г.Москва': [{"speaker": "Водопьянов Юрий Леонидович", "seconds": 140.0, "share": 1.0}]}
    # слишком мало подсвеченной речи (Руденко 10 с < 20 с) — подсказки не даём
    assert "Руденко Владислав Александрович" not in result["suggested"]


def test_summary_requires_clear_majority_for_a_name_suggestion():
    spans = [{"start": 0, "end": 50, "name": "Пылаева Виктория Викторовна"}, {"start": 50, "end": 100, "name": "Руденко Владислав Александрович"}]
    turns = [{"start": 0, "end": 100, "speaker": "SPEAKER_05"}]      # один голос поровну на двух плитках — не гадаем
    assert vh.summarize_hints(spans, turns)["suggested"] == {}


def test_one_voice_label_lighting_two_different_people_is_reported_as_mixed():
    spans = [{"start": 0, "end": 60, "name": "Пылаева Виктория Викторовна"}, {"start": 60, "end": 130, "name": "Чернетов Алексей Евгеньевич"}]
    turns = [{"start": 0, "end": 130, "speaker": "SPEAKER_05"}, {"start": 130, "end": 200, "speaker": "SPEAKER_01"}]
    result = vh.summarize_hints(spans, turns, min_seconds=20)
    assert [m["speaker"] for m in result["mixed"]] == ["SPEAKER_05"]
    assert {t["tile"] for t in result["mixed"][0]["tiles"]} == {"Пылаева Виктория Викторовна", "Чернетов Алексей Евгеньевич"}
    assert result["suggested"] == {}                      # смешанному голосу имя не предлагаем
    one_person = vh.summarize_hints(spans[:1], turns[:1], min_seconds=20)
    assert one_person["mixed"] == [] and one_person["suggested"] == {"SPEAKER_05": "Пылаева Виктория Викторовна"}


def test_face_summary_flags_face_that_contradicts_the_named_voice_but_ignores_rooms():
    samples = [{"t": i * 2.0, "name": "Вельчев Игорь Петрович", "face": "Величко Андрей Александрович"} for i in range(40)]
    samples += [{"t": 100 + i * 2.0, "name": 'ПАО "Запсибгазпром" г.Москва', "face": "Миронов Сергей"} for i in range(30)]
    samples += [{"t": 200 + i * 2.0, "name": "Руденко Владислав Александрович", "face": "Руденко Владислав Александрович"} for i in range(30)]
    turns = [{"start": 0, "end": 80, "speaker": "Руденко Владислав Александрович"},     # на аккаунте «Вельчев» лицо Величко, голос назван Руденко
             {"start": 100, "end": 160, "speaker": "Водопьянов Юрий Леонидович"},       # комната: лицо в кадре не обязано говорить
             {"start": 200, "end": 260, "speaker": "Руденко Владислав Александрович"}]  # лицо и голос совпали
    result = vh.summarize_faces(samples, turns, 2.0, min_seconds=20)
    assert result["face_voice_conflicts"] == [{"tile": "Вельчев Игорь Петрович", "face": "Величко Андрей Александрович",
                                               "voice": "Руденко Владислав Александрович", "seconds": 80.0}]
    assert result["tiles"]['ПАО "Запсибгазпром" г.Москва'][0]["person"] == "Миронов Сергей"


def test_voice_lighting_a_room_and_a_person_is_mixed_but_a_lagging_frame_is_not():
    spans = [{"start": 0, "end": 120, "name": "Вологда"}, {"start": 120, "end": 180, "name": "Руденко Владислав Александрович"},
             {"start": 180, "end": 200, "name": 'ПАО "Запсибгазпром" г.Москва'}]
    turns = [{"start": 0, "end": 180, "speaker": "SPEAKER_00"}, {"start": 180, "end": 192, "speaker": "SPEAKER_00"}]
    result = vh.summarize_hints(spans, turns)
    assert [m["speaker"] for m in result["mixed"]] == ["SPEAKER_00"]
    assert {t["tile"] for t in result["mixed"][0]["tiles"]} == {"Вологда", "Руденко Владислав Александрович"}   # 12 с Москвы — запаздывание рамки


def test_split_assigns_segments_to_the_lit_tile_and_leaves_ambiguous_ones():
    spans = [{"start": 0, "end": 10, "name": "Вологда"}, {"start": 10, "end": 20, "name": "Руденко Владислав Александрович"}]
    segments = [{"start": 1, "end": 8, "speaker": "SPEAKER_00"},        # в подсветке Вологды
                {"start": 11, "end": 18, "speaker": "SPEAKER_00"},      # в подсветке Руденко
                {"start": 8, "end": 13, "speaker": "SPEAKER_00"},       # поровну на двух плитках — не гадаем
                {"start": 1, "end": 8, "speaker": "Водопьянов"},        # не склеенный голос — не трогаем
                {"start": 30, "end": 35, "speaker": "SPEAKER_00"}]      # нет подсветки
    assert vh.split_mixed_segments(segments, spans, ["SPEAKER_00"]) == {0: "Вологда", 1: "Руденко Владислав Александрович"}


def test_room_people_come_from_the_staff_of_the_same_city_and_skip_cities_that_narrow_nothing():
    staff = [{"kind": "person", "source": "staff", "term": "Лущан Валентин Владимирович", "expansion": "Руководитель проекта, Группа специальных проектов (Магадан)"},
             {"kind": "person", "source": "staff", "term": "Иванов Пётр Сидорович", "expansion": "Инженер, ПТО (Магадан)"},
             {"kind": "person", "source": "staff", "term": "Костылев Сергей Владимирович", "expansion": "Руководитель проекта, Группа по строительству (г.Вологда)"}]
    staff += [{"kind": "person", "source": "staff", "term": f"Москвин {i} Иванович", "expansion": f"Инженер (Москва)"} for i in range(30)]
    result = vh.room_people(["Магадан", "Вологда", 'ПАО "Запсибгазпром" г.Москва', "Белушья губа"], staff)
    assert [p["person"] for p in result["Магадан"]] == ["Лущан Валентин Владимирович"]   # на площадке берём руководителей, рядового инженера не добавляем
    assert [p["person"] for p in result["Вологда"]] == ["Костылев Сергей Владимирович"]
    assert "ПАО \"Запсибгазпром\" г.Москва" not in result and "Белушья губа" not in result    # Москва — 30 человек, ничего не сужает; Белуши нет в штате


def test_label_is_reused_only_while_the_ring_stays_put_in_consecutive_frames():
    box = (641, 352, 1063, 590)
    prev = {"index": 10, "box": box, "label": ("Пылаева Виктория Викторовна", 0.99), "read_index": 10}
    assert vh.can_reuse_label(prev, (643, 351, 1062, 590), 11)                # то же место, соседний кадр
    assert not vh.can_reuse_label(prev, (216, 340, 638, 589), 11)             # рамка перешла на другую плитку
    assert not vh.can_reuse_label(prev, box, 13)                              # между кадрами был разрыв — раскладка могла смениться
    assert not vh.can_reuse_label(prev, box, 11 + vh.REREAD_EVERY)            # давно не читали — перечитываем
    assert not vh.can_reuse_label(None, box, 0)


def test_video_is_read_only_around_speech_and_a_file_without_turns_is_read_whole():
    turns = [{"start": 5400, "end": 5410}, {"start": 5500, "end": 5520}, {"start": 9000, "end": 9060}]
    assert vh.speech_windows(turns, 60000) == [(5370.0, 5550.0), (8970.0, 9090.0)]     # близкие реплики склеены, пустые часы не читаем
    assert vh.speech_windows([{"start": 5, "end": 8}], 100) == [(0.0, 38.0)]            # запас не выходит за начало файла
    assert vh.speech_windows([{"start": 90, "end": 99}], 100) == [(60.0, 100.0)]        # и за конец
    assert vh.speech_windows([], 3600) == [(0.0, 3600)]
