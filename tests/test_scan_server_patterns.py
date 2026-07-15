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
    matches = patterns.scan_text("ДСП\nСекретно\nКонфиденциально")
    matched_ids = {item["pattern"] for item in matches}

    assert "dsp_with_exclusion" in matched_ids
    assert "secret_strict" in matched_ids


def test_dsp_furniture_context_is_excluded():
    matches = patterns.scan_text("Столешница ДСП 22 мм, плита для мебели")

    assert not any(item["pattern"] == "dsp_with_exclusion" for item in matches)


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
