from __future__ import annotations

import scan_server.patterns as patterns


def test_list_patterns_includes_loan_keyword_metadata():
    items = patterns.list_patterns()

    loan = next(item for item in items if item["id"] == "loan_keyword")
    assert loan["name"] == "Займ"
    assert loan["category"] == "Финансы"
    assert loan["enabled_by_default"] is True
    assert loan["weight"] == 0.8


def test_scan_text_respects_allowed_pattern_ids():
    text = "Password: secret-token-123\nДоговор займа подписан"

    matches = patterns.scan_text(text, allowed_pattern_ids=["loan_keyword"])

    assert [item["pattern"] for item in matches] == ["loan_keyword"]
    assert matches[0]["value"] == "займа"


def test_scan_text_empty_filter_keeps_legacy_all_patterns_behavior():
    text = "Password: secret-token-123"

    matches = patterns.scan_text(text, allowed_pattern_ids=[])

    assert any(item["pattern"] == "password_strict" for item in matches)
