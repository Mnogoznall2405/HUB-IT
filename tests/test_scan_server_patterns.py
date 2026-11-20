from __future__ import annotations

import scan_server.patterns as patterns


def test_list_patterns_includes_loan_keyword_metadata():
    items = patterns.list_patterns()

    loan = next(item for item in items if item["id"] == "loan_keyword")
    assert loan["name"] == "Займ"
    assert loan["category"] == "Финансы"
    assert loan["enabled_by_default"] is True
    assert loan["weight"] == 0.8


def test_list_patterns_groups_internal_dsp_rules_for_incident_filter():
    dsp_items = [item for item in patterns.list_patterns() if item["id"].startswith("dsp_")]

    assert len(dsp_items) == 4
    assert {item["incident_filter_id"] for item in dsp_items} == {"dsp"}
    assert {item["incident_filter_name"] for item in dsp_items} == {"ДСП"}


def test_scan_text_respects_allowed_pattern_ids():
    text = "Password: secret-token-123\nДоговор займа подписан"

    matches = patterns.scan_text(text, allowed_pattern_ids=["loan_keyword"])

    assert [item["pattern"] for item in matches] == ["loan_keyword"]
    assert matches[0]["value"] == "займа"


def test_scan_text_empty_filter_keeps_legacy_all_patterns_behavior():
    text = "Password: secret-token-123"

    matches = patterns.scan_text(text, allowed_pattern_ids=[])

    assert any(item["pattern"] == "password_strict" for item in matches)


def test_dsp_and_plain_confidential_headers_are_detected():
    matches = patterns.scan_text("ДСП\nСекретно\nГриф: Конфиденциально")
    matched_ids = {item["pattern"] for item in matches}

    assert "dsp_with_exclusion" in matched_ids
    assert "secret_strict" in matched_ids


def test_secret_clearance_boilerplate_is_not_a_stamp():
    samples = [
        "имеющими степень секретности «секретно» (т.е. 3 форма допуска), при оформлении",
        "по форме № 3, степень секретности «секретно». — Жихаревой Татьяне",
        "сведения, отнесенные к конфиденциальной информации и коммерческой тайне. 3.3 В период",
        "5. Конфиденциальность 5.1. Стороны берут на себя взаимные обязательства по соблюдению режима конфиденциальности",
        "Конфиденциально ДОГОВОР № 7222-ВУ-4728/21-Ш1 на предоставление",
    ]
    for sample in samples:
        matches = patterns.scan_text(sample)
        assert not any(item["pattern"] == "secret_strict" for item in matches), sample
        assert not any(item["pattern"] == "classified_document_header" for item in matches), sample


def test_real_secret_stamp_and_classified_header_still_match():
    stamp_matches = patterns.scan_text("Секретно\n27.10.2020\nСтраница 1")
    assert any(item["pattern"] == "secret_strict" for item in stamp_matches)

    header_matches = patterns.scan_text("СОВЕРШЕННО СЕКРЕТНО\nЭкз. № 2\nПеречень сведений")
    assert any(item["pattern"] == "classified_document_header" for item in header_matches)
    assert any(item["pattern"] == "secret_strict" for item in header_matches)


def test_dsp_furniture_context_is_excluded():
    matches = patterns.scan_text("Столешница ДСП 22 мм, плита для мебели")

    assert not any(item["pattern"] == "dsp_with_exclusion" for item in matches)
    assert not any(
        item["pattern"] == "dsp_with_exclusion"
        for item in patterns.scan_text("лист ДСП 16 мм под столешницу")
    )


def test_dsp_particle_board_specs_are_excluded():
    samples = [
        "умя полками;материал  фасадов ДСП с пластиковым покрытием;  габ",
        "цвет: белый, материал: фасад- ДСП с прозрачным стеклом/каркас-",
        "2      407  Стол медицинский (ДСП с пластиком, с накладками в",
        "таль обивка иск.кожа, сиденье ДСП + пенополиуретан, цвет: слоно",
        "д оргтехнику 7 86х616х566 мм, ДСП, ц вет дуб медовый 3022 Кабин",
        "0 Стол для ноутбука, материал ДСП с пластиковым  покрытием, габ",
    ]

    for sample in samples:
        matches = patterns.scan_text(sample)
        assert not any(item["pattern"] == "dsp_with_exclusion" for item in matches), sample


def test_dsp_construction_drawing_context_is_excluded():
    """«ДСП» on floor plans / material schedules = particle board, not a stamp."""
    samples = [
        "Ведомость материалов: ДСП, железобетон, перекрытие, 3 этаж",
        "План этажа в осях 1-4, ДСП, отделка помещений",
        "Маркировка окон и дверей ДСП, здание поликлиники, этаж 2",
        "Спецификация ДСП, монолитная стяжка, фундамент",
        "Коридор, помещение 305, ДСП, гипсокартон ГВЛ",
    ]

    for sample in samples:
        matches = patterns.scan_text(sample)
        assert not any(item["pattern"] == "dsp_with_exclusion" for item in matches), sample


def test_dsp_registration_number_references_are_excluded():
    """«ДСП» в регистрационном номере — гриф цитируемого письма, не этого документа."""
    samples = [
        "направлено письмо исх. № ГФ/КАС-480ДСП от 30.06.2026",
        "исх. №448/3477дсп от 15.03.2024 в адрес заказчика",
        "ответ на письмо от 24.09.2025 № СФ/50676-дсп",
        "письмом от 13.11.2024 № 153/5/17256дсп",
        "протокола №260дсп от 24.05.2024 шифр объекта",
        "запрос Исх. ФКП/СФ/628 дсп от 25.05.26г, предоставлена",
    ]

    for sample in samples:
        matches = patterns.scan_text(sample)
        assert not any(item["pattern"] == "dsp_with_exclusion" for item in matches), sample


def test_dsp_luminaire_model_codes_are_excluded():
    """«ДСП-40»/«ДСП52-32-101» — серия светильников (пылевлагозащита), не гриф."""
    samples = [
        "светильник освещения котельной ДСП-40",
        "светодиодные светильники ДСП-40 40Вт, установленные",
        "светильник светодиодный ДСП44-38-042 Надтап Е 840",
        "светодиодный, 48Вт, ~220В, IP65 ДСП52-48-201 Optima 840",
        "накладной с СД 32 Вт, IP65 ДСП 44-38-003 Flagman F",
    ]

    for sample in samples:
        matches = patterns.scan_text(sample)
        assert not any(item["pattern"] == "dsp_with_exclusion" for item in matches), sample


def test_dsp_after_small_number_still_matches():
    """«Экз. № 2 ДСП» — реальный гриф, двузначный номер экземпляра ≠ регномер."""
    matches = patterns.scan_text("Гриф: ДСП\nЭкз. № 2")
    assert any(item["pattern"] == "dsp_with_exclusion" for item in matches)

    matches = patterns.scan_text("Экземпляр № 2 ДСП")
    assert any(item["pattern"] == "dsp_with_exclusion" for item in matches)

    matches = patterns.scan_text("Гриф — ДСП\nЭкз. № 2")
    assert any(item["pattern"] == "dsp_with_exclusion" for item in matches)


def test_standalone_dsp_secrecy_mark_still_matches():
    matches = patterns.scan_text("Гриф: ДСП\nЭкз. № 2\nТолько для служебного пользования")

    assert any(item["pattern"] == "dsp_with_exclusion" for item in matches)


def test_repeated_same_rule_does_not_raise_severity():
    matches = [
        {"pattern": "login_strict"},
        {"pattern": "login_strict"},
        {"pattern": "login_strict"},
    ]

    assert patterns.classify_severity(matches) == "low"


def test_normalization_handles_ocr_spacing():
    matches = patterns.scan_text("Д л я  с л у ж е б н о г о  п о л ь з о в а н и я")

    assert any(item["pattern"] == "dsp_official_use" for item in matches)


def test_ocr_distorted_dsp_phrase_requires_review():
    matches = patterns.scan_text("Д1я служебн0го пользованя")

    assert any(item["pattern"] == "dsp_ocr_variant" for item in matches)
    assert patterns.classify_severity(matches) == "medium"


def test_real_ocr_distortions_of_dsp_phrase_require_review():
    samples = [
        "Для служейного пользования",
        "Дли служа бного пользования",
    ]

    for sample in samples:
        matches = patterns.scan_text(sample)
        assert any(item["pattern"] == "dsp_ocr_variant" for item in matches)
        assert patterns.classify_severity(matches) == "medium"


def test_damaged_dsp_phrase_is_detected_from_official_context():
    samples = [
        "Для служебного mn oA\nп. 37 Перечня сведений ВС\nЭкз. № 2",
        "Tina ¢ тужеб ного пользования Hck. пр\nп. 161 Перечни сведений ac РФ",
    ]

    for sample in samples:
        matches = patterns.scan_text(sample)
        assert any(item["pattern"] == "dsp_ocr_context" for item in matches)
        assert patterns.classify_severity(matches) == "medium"


def test_exact_dsp_phrase_does_not_double_count_fuzzy_rule():
    matches = patterns.scan_text("Для служебного пользования")
    matched_ids = [item["pattern"] for item in matches]

    assert "dsp_official_use" in matched_ids
    assert "dsp_ocr_variant" not in matched_ids
    assert "dsp_ocr_context" not in matched_ids
