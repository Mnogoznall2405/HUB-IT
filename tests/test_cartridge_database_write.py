#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""Unit tests for CartridgeDatabase management-table write methods."""
from __future__ import annotations

import sys
from pathlib import Path

import pytest

PROJECT_ROOT = Path(__file__).resolve().parents[1]
WEB_ROOT = PROJECT_ROOT / "WEB-itinvent"
if str(WEB_ROOT) not in sys.path:
    sys.path.insert(0, str(WEB_ROOT))

from backend.json_db.cartridges import CartridgeDatabase  # noqa: E402


class _DictDataManager:
    """Minimal JSONDataManager stub backed by an in-memory dict."""

    def __init__(self, initial=None):
        self.documents = dict(initial or {})

    def load_json(self, filename, default_content=None):
        return self.documents.get(filename, default_content)

    def save_json(self, filename, data):
        self.documents[filename] = data
        return True


def _make_db(initial=None) -> CartridgeDatabase:
    return CartridgeDatabase(data_manager=_DictDataManager(initial))


def test_list_entries_sorted_and_shaped():
    db = _make_db(
        {
            "cartridge_database.json": {
                "zebra printer": {
                    "oem_cartridge": "Z1",
                    "compatible_models": [],
                    "is_color": False,
                },
                "alpha printer": {
                    "oem_cartridge": "A1",
                    "is_color": True,
                    "compatible_models": [
                        {"model": "CF283A", "description": "cart", "color": "Черный"}
                    ],
                },
            }
        }
    )

    entries = db.list_entries()

    assert [e["printer_model"] for e in entries] == ["alpha printer", "zebra printer"]
    assert entries[0]["compatible_models"][0]["model"] == "CF283A"
    assert entries[0]["is_color"] is True


def test_upsert_creates_new_normalized_key():
    db = _make_db()

    entry = db.upsert_entry(
        "  HP LaserJet Pro M404dn  ",
        oem_cartridge="CF276A",
        compatible_models=[{"model": "CF276A", "color": "Черный"}],
        is_color=False,
    )

    assert db.get_printers_for_cartridge("CF276A") == ["hp laserjet pro m404dn"]
    raw = db._load_raw_database()
    assert "hp laserjet pro m404dn" in raw
    assert entry["oem_cartridge"] == "CF276A"


def test_upsert_merges_preserving_unmanaged_fields():
    db = _make_db(
        {
            "cartridge_database.json": {
                "hp laserjet m404dn": {
                    "oem_cartridge": "OLD",
                    "is_color": False,
                    "components": ["cartridge", "fuser"],
                    "fuser_models": ["RM2-2554"],
                    "compatible_models": [
                        {
                            "model": "CF276A",
                            "description": "orig desc",
                            "color": "Черный",
                            "page_yield": 3000,
                        },
                        {"model": "CF276X", "description": "xl", "color": "Черный"},
                    ],
                }
            }
        }
    )

    db.upsert_entry(
        "HP LaserJet M404dn",
        oem_cartridge="CF276A",
        compatible_models=[
            {"model": "CF276A"},  # keeps description/page_yield
            {"model": "W2030A", "color": "Черный"},  # new model replaces CF276X
        ],
    )

    raw = db._load_raw_database()["hp laserjet m404dn"]
    assert raw["components"] == ["cartridge", "fuser"]
    assert raw["fuser_models"] == ["RM2-2554"]

    models = {m["model"]: m for m in raw["compatible_models"]}
    assert set(models) == {"CF276A", "W2030A"}
    assert models["CF276A"]["description"] == "orig desc"
    assert models["CF276A"]["page_yield"] == 3000

    # cartridge lookup follows the table immediately after write
    assert db.get_printers_for_cartridge("W2030A") == ["hp laserjet m404dn"]
    assert db.get_printers_for_cartridge("CF276X") == []


def test_upsert_without_compatible_models_keeps_list():
    db = _make_db(
        {
            "cartridge_database.json": {
                "printer x": {
                    "compatible_models": [{"model": "C1", "color": "Черный"}],
                }
            }
        }
    )

    db.upsert_entry("Printer X", is_color=True)

    raw = db._load_raw_database()["printer x"]
    assert raw["is_color"] is True
    assert [m["model"] for m in raw["compatible_models"]] == ["C1"]


def test_delete_entry_removes_and_reports():
    db = _make_db({"cartridge_database.json": {"printer x": {"oem_cartridge": "C1"}}})

    assert db.delete_entry("Printer X") is True
    assert db.delete_entry("Printer X") is False
    assert db._load_raw_database() == {}
    assert db.list_entries() == []


def test_upsert_requires_printer_model():
    db = _make_db()
    with pytest.raises(ValueError):
        db.upsert_entry("   ")
