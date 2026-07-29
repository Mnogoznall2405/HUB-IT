#!/usr/bin/env python
# -*- coding: utf-8 -*-
"""Build gzipped Russian settlements index for ticket city autocomplete.

Source dataset:
  https://github.com/NickyX3/russia_settlements (settlements.csv)
  ~159k localities: города, пгт, посёлки, сёла, деревни, хутора, станицы...

Usage:
  python scripts/build_russian_settlements_index.py
  python scripts/build_russian_settlements_index.py --download
"""
from __future__ import annotations

import argparse
import csv
import gzip
import json
import urllib.request
from pathlib import Path


ROOT = Path(__file__).resolve().parents[1]
SOURCE_URL = "https://raw.githubusercontent.com/NickyX3/russia_settlements/main/settlements.csv"
CSV_PATH = ROOT / "data" / "geo" / "settlements.csv"
OUT_PATH = ROOT / "WEB-itinvent" / "backend" / "resources" / "geo" / "russian_settlements.json.gz"

TYPE_LABELS = {
    "г": "город",
    "пгт": "пгт",
    "рп": "рабочий посёлок",
    "п": "посёлок",
    "с": "село",
    "д": "деревня",
    "х": "хутор",
    "ст": "станция",
    "ст-ца": "станица",
    "аул": "аул",
    "нп": "нп",
    "дп": "дачный посёлок",
}


def download_csv() -> None:
    CSV_PATH.parent.mkdir(parents=True, exist_ok=True)
    print(f"Downloading {SOURCE_URL}")
    urllib.request.urlretrieve(SOURCE_URL, CSV_PATH)
    print(f"Saved {CSV_PATH} ({CSV_PATH.stat().st_size} bytes)")


def build_index() -> None:
    if not CSV_PATH.exists():
        raise SystemExit(f"CSV not found: {CSV_PATH}. Run with --download first.")

    items: list[list] = []
    with CSV_PATH.open(encoding="utf-8-sig", newline="") as handle:
        reader = csv.DictReader(handle, delimiter=";")
        for row in reader:
            name = (row.get("settlement") or "").strip()
            if not name:
                continue
            typ = (row.get("type") or "").strip()
            region = (row.get("region") or "").strip()
            try:
                population = int(float(str(row.get("population") or "0").replace(" ", "") or 0))
            except Exception:
                population = 0
            items.append([name, typ, region, population])

    items.sort(key=lambda row: (-int(row[3] or 0), str(row[0]), str(row[2])))
    payload = {"type_labels": TYPE_LABELS, "items": items}

    OUT_PATH.parent.mkdir(parents=True, exist_ok=True)
    with gzip.open(OUT_PATH, "wt", encoding="utf-8", compresslevel=9) as handle:
        json.dump(payload, handle, ensure_ascii=False, separators=(",", ":"))

    print(f"Wrote {OUT_PATH}")
    print(f"items={len(items)} bytes={OUT_PATH.stat().st_size}")


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--download", action="store_true", help="Download settlements.csv first")
    args = parser.parse_args()
    if args.download or not CSV_PATH.exists():
        download_csv()
    build_index()


if __name__ == "__main__":
    main()
