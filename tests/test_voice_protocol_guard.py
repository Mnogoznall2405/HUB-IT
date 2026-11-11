"""voice_video/modules/protocol_guard.py: направление темы и сторож поручений (Jev подменён функцией)."""
from __future__ import annotations

import importlib.util
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
spec = importlib.util.spec_from_file_location("protocol_guard_under_test", ROOT / "voice_video" / "modules" / "protocol_guard.py")
pg = importlib.util.module_from_spec(spec)
spec.loader.exec_module(pg)

TOPICS = [
    {"topic_title": "Аванс по Можайску", "summary": "оплата песка", "start_time": 0, "end_time": 600},
    {"topic_title": "Выезд людей", "summary": "билеты", "start_time": 600, "end_time": 1200},
]
TRANSCRIPT = [
    {"speaker": "Иванов", "text": "платим шесть миллионов за песок", "start_time": 30},
    {"speaker": "Петров", "text": "билеты куплены на двадцать девятое", "start_time": 700},
]


def test_time_parsing_and_topic_lookup_use_topic_start():
    assert pg.to_seconds("04:59") == 299
    assert pg.to_seconds("1:02:10") == 3730
    assert pg.to_seconds("04:59–05:30") == 299
    assert pg.to_seconds("") is None
    assert pg.topic_for_time(TOPICS, 650)["topic_title"] == "Выезд людей"
    # время поручения — момент ВНУТРИ темы, а не её начало: ближайшее «начало» дало бы соседнюю тему
    assert pg.topic_for_time(TOPICS, 590)["topic_title"] == "Аванс по Можайску"
    assert pg.topic_for_time(TOPICS, 600)["topic_title"] == "Выезд людей"  # граница: конец одной = начало следующей
    rounded = [{"topic_title": "A", "start_time": 0, "end_time": 467.7}, {"topic_title": "B", "start_time": 467.7, "end_time": 900}]
    assert pg.topic_for_time(rounded, 467)["topic_title"] == "B"  # «07:47» при старте темы 467.7 с
    assert pg.topic_for_time([{"topic_title": "поздно", "start_time": 900, "end_time": 1000}], 100)["topic_title"] == "поздно"
    text = pg.topic_window_text(TOPICS[1], TRANSCRIPT)
    assert "билеты" in text and "песок" not in text  # окно — только своя тема


def test_domain_tagging_keeps_confidence_second_choice_and_survives_failures():
    answers = iter([
        {"domain": {"type": "choice", "choice": "finance", "confidence": 0.8,
                    "probabilities": {"finance": 0.8, "supply": 0.3, "hr": 0.02}}},
        None,  # сбой Jev на второй теме — тема просто остаётся без метки
    ])
    topics = [dict(t) for t in TOPICS]
    assert pg.classify_topics(topics, lambda state, questions: next(answers), workers=1) == 1
    assert topics[0]["domain"] == "finance" and topics[0]["domain_confidence"] == 0.8
    assert topics[0]["domain_alt"] == "supply"  # ≥0.25
    assert "domain" not in topics[1]
    unknown = [{"topic_title": "x", "summary": ""}]
    assert pg.classify_topics(unknown, lambda s, q: {"domain": {"choice": "выдумка", "confidence": 1}}) == 0


def test_guard_flags_unsupported_and_ownerless_items_but_keeps_them():
    def decide(state, questions):
        if "стройка" in state["task"]["task"] or "билет" in state["task"]["task"]:
            return {"supported": {"noul": 0.9}, "has_owner": {"noul": 0.9}}
        # поручение, которого в обсуждении не было, и ответственный «Анкор» (внешняя компания)
        return {"supported": {"noul": 0.1}, "has_owner": {"noul": 0.3}}

    groups = [{"title": "g", "items": [
        {"time": "00:00", "task": "оплатить песок", "assignee": "Иванов", "deadline": "пт"},          # выдумка
        {"time": "10:00", "task": "купить билет", "assignee": "Петров", "deadline": "сегодня"},          # ок
        {"time": "10:00", "task": "стройка: доклад", "assignee": "P2_SPEAKER_07", "deadline": ""},      # метка голоса
        {"time": "10:00", "task": "стройка: отчёт", "assignee": "не назначен", "deadline": ""},          # нет ответственного
    ]}]
    flagged = pg.check_items(groups, TOPICS, TRANSCRIPT, decide, workers=1)
    items = groups[0]["items"]
    assert flagged == 3 and len(items) == 4
    assert items[0]["flags"] == ["нет в обсуждении", "нет ответственного"]
    assert "flags" not in items[1]
    assert items[2]["flags"] == ["ответственный — неопознанный голос"]
    assert items[3]["flags"] == ["нет ответственного"]


def test_guard_is_silent_when_jev_is_unavailable():
    groups = [{"title": "g", "items": [{"time": "00:00", "task": "оплатить песок", "assignee": "Иванов", "deadline": ""}]}]
    assert pg.check_items(groups, TOPICS, TRANSCRIPT, lambda s, q: None, workers=1) == 0
    assert "flags" not in groups[0]["items"][0]


def test_evidence_fragment_finds_the_place_where_the_task_was_discussed_in_a_long_topic():
    topic = {"start_time": 0, "end_time": 1000}
    transcript = [{"speaker": "А", "text": "обсуждаем погоду и отпуск", "start_time": t} for t in range(0, 500, 20)]
    transcript += [{"speaker": "Б", "text": "график отправим в Шульгино до конца дня", "start_time": 700}]
    transcript += [{"speaker": "А", "text": "шумим про другое", "start_time": t} for t in range(720, 1000, 20)]
    fragment = pg.evidence_fragment("Подготовить график и отправить его в Шульгино", topic, transcript, radius=60)
    assert "Шульгино" in fragment and "погоду" not in fragment
    assert "погоду" in pg.evidence_fragment("совсем иное слово", topic, transcript)  # нет совпадений — начало темы
