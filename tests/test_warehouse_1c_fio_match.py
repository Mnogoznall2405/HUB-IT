# -*- coding: utf-8 -*-
from backend.services.warehouse_1c_service import (
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


def test_fio_surname_only_does_not_match():
    assert fio_person_match_score("Манько", "Манько Иван") == 0
    assert fio_person_match_score("Манько Иван", "Манько") == 0


def test_fio_different_surnames_do_not_match():
    assert fio_person_match_score("Иванов Петр", "Петров Иванов") == 0


def test_tokenize_hub_text_keeps_hyphenated_part_no():
    tokens = tokenize_hub_text("BE850G2-RS")
    assert "be850g2-rs" in tokens


def test_tokenize_hub_text_full_model():
    tokens = tokenize_hub_text("HP LaserJet Pro M404dn")
    assert "laserjet" in tokens
    assert "m404dn" in tokens
