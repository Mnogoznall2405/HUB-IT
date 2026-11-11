from __future__ import annotations

import gzip
import json
from pathlib import Path

from backend.services.russian_settlements_service import RussianSettlementsService


def test_search_settlements_finds_city_and_village(tmp_path: Path):
    payload = {
        "type_labels": {"г": "город", "п": "посёлок", "д": "деревня"},
        "items": [
            ["Москва", "г", "Москва", 12_000_000],
            ["Тюмень", "г", "Тюменская область", 800_000],
            ["Боровский", "п", "Тюменская область", 15_000],
            ["Каменка", "д", "Тюменская область", 120],
        ],
    }
    index_path = tmp_path / "settlements.json.gz"
    with gzip.open(index_path, "wt", encoding="utf-8") as handle:
        json.dump(payload, handle, ensure_ascii=False)

    service = RussianSettlementsService(index_path=index_path)
    by_city = service.search("тюм", limit=10)
    assert any(item["name"] == "Тюмень" for item in by_city["items"])

    by_poselok = service.search("боров", limit=10)
    assert any(item["name"] == "Боровский" and item["type_label"] == "посёлок" for item in by_poselok["items"])

    by_village = service.search("камен", limit=10)
    assert any(item["name"] == "Каменка" and item["type"] == "д" for item in by_village["items"])


def test_default_index_loads_if_present():
    service = RussianSettlementsService()
    if not service.index_path.exists():
        return
    result = service.search("Москва", limit=5)
    assert result["total"] > 1000
    assert any(item["name"] == "Москва" for item in result["items"])
