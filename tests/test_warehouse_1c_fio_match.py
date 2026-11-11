# -*- coding: utf-8 -*-
from backend.services.warehouse_1c_service import (
    Warehouse1CService,
    fio_person_match_score,
    tokenize_hub_text,
)


def test_fio_full_name_matches_initials_warehouse():
    score = fio_person_match_score(
        "Рябов Александр Сергеевич",
        "Рябов А.С.",
    )
    assert score >= 80


def test_fio_full_name_matches_prefixed_initials_warehouse():
    score = fio_person_match_score(
        "Рябов Александр Сергеевич",
        "Склад Рябов А.С.",
    )
    assert score >= 80


def test_fio_exact_full_name():
    score = fio_person_match_score(
        "Рябов Александр Сергеевич",
        "Рябов Александр Сергеевич",
    )
    assert score == 100


def test_fio_matches_warehouse_with_trailing_location():
    score = fio_person_match_score(
        "Рябов Александр Сергеевич",
        "Склад Рябов А.С. Тюмень",
    )
    assert score >= 80


def test_fio_surname_only_does_not_match():
    assert fio_person_match_score("Манько", "Манько Иван") == 0
    assert fio_person_match_score("Манько Иван", "Манько") == 0


def test_fio_different_surnames_do_not_match():
    assert fio_person_match_score("Иванов Петр", "Петров Иванов") == 0


def test_fio_treats_yo_and_ye_as_equivalent():
    score = fio_person_match_score(
        "Лераман Алена Юрьевна",
        "Лераман Алёна Юрьевна",
    )
    assert score == 100


def test_tokenize_hub_text_keeps_hyphenated_part_no():
    tokens = tokenize_hub_text("BE850G2-RS")
    assert "be850g2-rs" in tokens


def test_tokenize_hub_text_full_model():
    tokens = tokenize_hub_text("HP LaserJet Pro M404dn")
    assert "laserjet" in tokens
    assert "m404dn" in tokens


def test_fio_object_warehouse_is_found_by_person_name():
    # Склад объекта в 1С: «<объект> <ФИО>», фамилия не первая.
    assert fio_person_match_score(
        "Кириленко Сергей Сергеевич",
        "АРКТИКА - 4 КОС (п. Тикси) Кириленко С.С",
    ) >= 50
    assert fio_person_match_score(
        "Горчаков Виктор Васильевич",
        "АРКТИКА - 4 .1 этап  (п. Тикси 2 очер Горчаков В В",
    ) >= 50


def test_fio_object_warehouse_handles_truncated_and_abbreviated_name():
    assert fio_person_match_score(
        "Чернюк Андрей Викторович",
        "АРКТИКА - 4 КОС (п. Тикси) Чернюк Андрей Викторови",
    ) >= 50
    assert fio_person_match_score(
        "Исаев Виктор Викторович",
        "АРКТИКА - 4 КОС (п. Тикси) Исаев Вик. Вик.",
    ) >= 50


def test_fio_object_warehouse_does_not_match_other_person_or_surname_only():
    assert fio_person_match_score(
        "Кириленко Сергей Сергеевич",
        "АРКТИКА - 4 КОС (п. Тикси) Кириленко Андрей Петрович",
    ) == 0
    assert fio_person_match_score(
        "Кириленко",
        "АРКТИКА - 4 КОС (п. Тикси) Кириленко С.С",
    ) == 0
    assert fio_person_match_score(
        "Иванов Петр Сергеевич",
        "АРКТИКА - 4 КОС (п. Тикси) Кириленко С.С",
    ) == 0


def test_fio_personal_warehouse_outranks_object_warehouse():
    personal = fio_person_match_score("Горчаков Виктор Васильевич", "Горчаков В.В.")
    on_object = fio_person_match_score(
        "Горчаков Виктор Васильевич",
        "АРКТИКА - 4 .1 этап  (п. Тикси 2 очер Горчаков В В",
    )
    assert personal > on_object > 0


def test_employee_with_personal_and_object_warehouse_resolves_to_personal():
    entries = [
        {"ref": "obj", "name": "АРКТИКА - 4 КОС (п. Тикси) Горчаков В.В."},
        {"ref": "me", "name": "Горчаков В.В."},
    ]
    match = Warehouse1CService._match_employee_warehouse_entries("Горчаков Виктор Васильевич", entries)
    assert match["status"] == "matched"
    assert match["warehouse"]["ref"] == "me"


def test_employee_on_two_objects_returns_both_as_candidates():
    entries = [
        {"ref": "a", "name": "АРКТИКА - 4 КОС (п. Тикси) Горчаков В.В."},
        {"ref": "b", "name": "АРКТИКА - 4 .1 этап  (п. Тикси 2 очер Горчаков В В"},
        {"ref": "c", "name": "АРКТИКА - 4 КОС (п. Тикси) Димов В.Д."},
    ]
    match = Warehouse1CService._match_employee_warehouse_entries("Горчаков Виктор Васильевич", entries)
    assert match["status"] == "ambiguous"
    assert {item["ref"] for item in match["candidates"]} == {"a", "b"}
