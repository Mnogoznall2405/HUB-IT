from __future__ import annotations

import sys
from pathlib import Path


ROOT = Path(__file__).resolve().parents[1]
WEB_ROOT = ROOT / "WEB-itinvent"
if str(WEB_ROOT) not in sys.path:
    sys.path.insert(0, str(WEB_ROOT))

from backend.services.warehouse_1c_service import (  # noqa: E402
    Warehouse1CService,
    haystack_matches_all_tokens,
    search_text_tokens,
)


def test_search_text_tokens_splits_words():
    assert search_text_tokens("Ippon 800") == ["ippon", "800"]
    assert search_text_tokens("  DELL   P2419H ") == ["dell", "p2419h"]


def test_haystack_matches_all_tokens_and_logic():
    name = "ибп ippon back basic 800 euro"
    assert haystack_matches_all_tokens(name, ["ippon", "800"]) is True
    assert haystack_matches_all_tokens(name, ["ippon", "650"]) is False
    assert haystack_matches_all_tokens("ippon 650", ["ippon", "800"]) is False


def test_filter_nomenclature_requires_all_tokens():
    entries = [
        ("r1", "C1", "ИБП Ippon Back Basic 800 Euro", "ибп ippon back basic 800 euro"),
        ("r2", "C2", "ИБП Ippon Back Basic 650 Euro", "ибп ippon back basic 650 euro"),
        ("r3", "C3", "APC Smart-UPS 800", "apc smart-ups 800"),
    ]
    rows = Warehouse1CService._filter_nomenclature_catalog(entries, "ippon 800", limit=20)
    assert [row["ref"] for row in rows] == ["r1"]


def test_filter_nomenclature_is_case_insensitive_and_ranks_model_prefixes():
    noise = [
        (
            f"noise-{index}",
            f"CODE-{index:02d}",
            f"Accessory X{index:02d}M70Z",
            f"accessory x{index:02d}m70z",
        )
        for index in range(25)
    ]
    entries = [
        *noise,
        ("wanted", "LEN-M70Q", "Lenovo ThinkCentre Tiny M70q", "lenovo thinkcentre tiny m70q"),
    ]

    lower = Warehouse1CService._filter_nomenclature_catalog(entries, "m70", limit=20)
    upper = Warehouse1CService._filter_nomenclature_catalog(entries, "M70", limit=20)

    assert lower == upper
    assert lower[0]["ref"] == "wanted"


def test_filter_nomenclature_treats_common_model_separators_as_equivalent():
    entries = [
        ("hyphen", "LEN-M-70", "Lenovo ThinkCentre M-70", "lenovo thinkcentre m-70"),
        ("space", "LEN-M70", "Lenovo ThinkCentre M 70", "lenovo thinkcentre m 70"),
    ]

    for query in ("m70", "M70", "m-70", "M 70"):
        rows = Warehouse1CService._filter_nomenclature_catalog(entries, query, limit=20)
        assert {row["ref"] for row in rows} == {"hyphen", "space"}


def test_suggest_nomenclature_prefers_multi_token_and(monkeypatch):
    service = Warehouse1CService()
    service._nomenclature_cache = [
        ("r1", "C1", "ИБП Ippon Back Basic 800 Euro", "ибп ippon back basic 800 euro"),
        ("r2", "C2", "ИБП Ippon Back Basic 650 Euro", "ибп ippon back basic 650 euro"),
        ("r3", "C3", "Монитор Dell", "монитор dell"),
    ]
    service._word_frequency_index = {"ippon": 2, "800": 1, "650": 1}

    payload = service._suggest_nomenclature_sync("Ippon 800", limit=10)

    assert payload["tried_query"] == "Ippon 800"
    assert [row["ref"] for row in payload["results"]] == ["r1"]
