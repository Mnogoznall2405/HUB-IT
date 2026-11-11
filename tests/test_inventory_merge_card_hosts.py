"""Список компьютеров: строки одного ПК (разные MAC) сливаются в одну; ошибки привязки не прячутся."""

from __future__ import annotations

import importlib.util
import sys
from pathlib import Path

BACKEND_ROOT = Path(__file__).resolve().parents[1] / "WEB-itinvent"
if str(BACKEND_ROOT) not in sys.path:
    sys.path.insert(0, str(BACKEND_ROOT))

MODULE_PATH = BACKEND_ROOT / "backend" / "api" / "v1" / "inventory.py"
SPEC = importlib.util.spec_from_file_location("inventory_merge_card_hosts_module", MODULE_PATH)
inventory = importlib.util.module_from_spec(SPEC)
assert SPEC is not None and SPEC.loader is not None
SPEC.loader.exec_module(inventory)


def _row(mac, hostname, inv="100885", db="ITINVENT", seen=100, hidden=False):
    return {
        "mac_address": mac,
        "hostname": hostname,
        "inventory_inv_no": inv,
        "database_id": db,
        "last_seen_at": seen,
        "is_hidden": hidden,
    }


def test_same_card_and_hostname_merge_into_freshest_row():
    rows = [
        _row("AA0000000001", "TMN-ENG-0040", seen=10),
        _row("AA0000000002", "tmn-eng-0040", seen=50),
        _row("AA0000000003", "TMN-ENG-0040", seen=30),
    ]
    merged = inventory._merge_records_of_same_card(rows)
    assert [item["mac_address"] for item in merged] == ["AA0000000002"]
    assert merged[0]["merged_hosts_count"] == 3
    assert sorted(merged[0]["alias_macs"]) == ["AA0000000001", "AA0000000003"]


def test_different_hostnames_on_one_card_stay_separate():
    rows = [_row("AA0000000001", "TMN-LAW-0015", inv="101849"), _row("AA0000000002", "TMN-LAW-0047", inv="101849")]
    assert len(inventory._merge_records_of_same_card(rows)) == 2


def test_unbound_other_card_and_hidden_rows_are_not_merged():
    rows = [
        _row("AA0000000001", "PC-1", inv=""),
        _row("AA0000000002", "PC-1", inv=""),
        _row("AA0000000003", "PC-2", inv="1", db="ITINVENT"),
        _row("AA0000000004", "PC-2", inv="1", db="SPB-ITINVENT"),
        _row("AA0000000005", "PC-3", inv="2"),
        _row("AA0000000006", "PC-3", inv="2", hidden=True),
    ]
    assert len(inventory._merge_records_of_same_card(rows)) == 6
