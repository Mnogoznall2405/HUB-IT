# -*- coding: utf-8 -*-
"""Searchable catalog of Russian settlements (cities, villages, poselki)."""
from __future__ import annotations

import gzip
import json
import logging
import threading
from functools import lru_cache
from pathlib import Path
from typing import Any


logger = logging.getLogger(__name__)

DEFAULT_INDEX_PATH = (
    Path(__file__).resolve().parent.parent / "resources" / "geo" / "russian_settlements.json.gz"
)


def normalize_settlement_search(value: Any) -> str:
    return (
        str(value or "")
        .strip()
        .casefold()
        .replace("ё", "е")
    )


class RussianSettlementsService:
    def __init__(self, index_path: Path | None = None) -> None:
        self.index_path = Path(index_path or DEFAULT_INDEX_PATH)
        self._lock = threading.Lock()
        self._items: list[dict[str, Any]] | None = None
        self._type_labels: dict[str, str] = {}

    def _load(self) -> None:
        if self._items is not None:
            return
        with self._lock:
            if self._items is not None:
                return
            if not self.index_path.exists():
                logger.error("Settlements index not found: %s", self.index_path)
                self._items = []
                self._type_labels = {}
                return
            opener = gzip.open if str(self.index_path).endswith(".gz") else open
            with opener(self.index_path, "rt", encoding="utf-8") as handle:
                payload = json.load(handle)
            labels = payload.get("type_labels") if isinstance(payload, dict) else {}
            raw_items = payload.get("items") if isinstance(payload, dict) else payload
            self._type_labels = {
                str(key): str(value)
                for key, value in (labels or {}).items()
            }
            items: list[dict[str, Any]] = []
            for row in raw_items or []:
                if not isinstance(row, (list, tuple)) or len(row) < 3:
                    continue
                name = str(row[0] or "").strip()
                if not name:
                    continue
                typ = str(row[1] or "").strip()
                region = str(row[2] or "").strip()
                try:
                    population = int(row[3] or 0)
                except Exception:
                    population = 0
                items.append(
                    {
                        "name": name,
                        "type": typ,
                        "type_label": self._type_labels.get(typ, typ or "нп"),
                        "region": region,
                        "population": population,
                        "_search_name": normalize_settlement_search(name),
                        "_search_region": normalize_settlement_search(region),
                    }
                )
            self._items = items
            logger.info("Loaded %s Russian settlements from %s", len(items), self.index_path)

    def search(self, query: str = "", limit: int = 30) -> dict[str, Any]:
        self._load()
        items = self._items or []
        limited = max(1, min(int(limit or 30), 100))
        normalized = normalize_settlement_search(query)
        if not normalized:
            return {
                "items": [
                    {
                        "name": item["name"],
                        "type": item["type"],
                        "type_label": item["type_label"],
                        "region": item["region"],
                        "population": item["population"],
                    }
                    for item in items[:limited]
                ],
                "total": len(items),
                "limit": limited,
                "source": "russian_settlements",
            }

        starts: list[dict[str, Any]] = []
        contains: list[dict[str, Any]] = []
        for item in items:
            name = item["_search_name"]
            region = item["_search_region"]
            if name.startswith(normalized):
                starts.append(item)
            elif normalized in name or normalized in region:
                contains.append(item)
            if len(starts) >= limited:
                break

        matched = (starts + contains)[:limited]
        return {
            "items": [
                {
                    "name": item["name"],
                    "type": item["type"],
                    "type_label": item["type_label"],
                    "region": item["region"],
                    "population": item["population"],
                }
                for item in matched
            ],
            "total": len(items),
            "limit": limited,
            "source": "russian_settlements",
        }


@lru_cache(maxsize=1)
def get_russian_settlements_service() -> RussianSettlementsService:
    return RussianSettlementsService()


russian_settlements_service = get_russian_settlements_service()
