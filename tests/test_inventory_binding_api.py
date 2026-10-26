"""Привязка ПК к карточкам ITINVENT: фоновый цикл связывает, список только читает сохранённое."""

from __future__ import annotations

import importlib.util
import sys
from pathlib import Path
from types import SimpleNamespace

import pytest

BACKEND_ROOT = Path(__file__).resolve().parents[1] / "WEB-itinvent"
if str(BACKEND_ROOT) not in sys.path:
    sys.path.insert(0, str(BACKEND_ROOT))

MODULE_PATH = BACKEND_ROOT / "backend" / "api" / "v1" / "inventory.py"
SPEC = importlib.util.spec_from_file_location("inventory_binding_api_module", MODULE_PATH)
inventory = importlib.util.module_from_spec(SPEC)
assert SPEC is not None and SPEC.loader is not None
SPEC.loader.exec_module(inventory)

from backend.services import inventory_binding as binding  # noqa: E402

TEST_AGENT_API_KEY = "test-inventory-agent-key"
NOW_TS = 1_710_000_500
MAC_1 = "AA-BB-CC-DD-EE-01"


@pytest.fixture
def env(temp_dir, monkeypatch):
    database_url = f"sqlite:///{(Path(temp_dir) / 'binding.db').as_posix()}"
    monkeypatch.setenv("ITINV_AGENT_API_KEYS", TEST_AGENT_API_KEY)
    monkeypatch.setenv("ITINV_AGENT_API_KEY", "")
    monkeypatch.setattr(inventory, "is_app_database_configured", lambda: True)
    monkeypatch.setattr(inventory, "get_app_database_url", lambda: database_url)
    monkeypatch.setattr(
        inventory,
        "get_local_store",
        lambda *args, **kwargs: (_ for _ in ()).throw(AssertionError("local_store should not be used")),
    )
    monkeypatch.setattr(inventory.time, "time", lambda: NOW_TS)
    monkeypatch.setattr(inventory, "_get_database_name_map", lambda: {"DB1": "Main DB", "DB2": "Other DB"})
    monkeypatch.setattr(inventory, "_get_accessible_db_ids", lambda current_user: ["DB1", "DB2"])
    monkeypatch.setattr(inventory, "_open_network_lookup_connection", lambda: None)
    monkeypatch.setattr(inventory, "_resolve_network_link", lambda conn, mac_address, ip_list: None)

    def _itinvent_must_not_be_queried(*args, **kwargs):
        raise AssertionError("list path must not query ITINVENT per host")

    monkeypatch.setattr(inventory, "_resolve_sql_context", _itinvent_must_not_be_queried)

    cards = {"DB1": [], "DB2": []}
    failing: set = set()

    def pull(db_id):
        if db_id in failing:
            raise RuntimeError("database unavailable")
        return [dict(item) for item in cards[db_id]]

    return SimpleNamespace(
        store=inventory.AppInventoryStore(database_url=database_url),
        cards=cards,
        failing=failing,
        pull=pull,
    )


def _user(role="admin", permissions=("computers.read", "computers.read_all")):
    return inventory.User(id=1, username="tester", role=role, permissions=list(permissions))


def _card(inv_no, *, mac="", name="", branch_name="Тюмень", branch_no="101", location="Кабинет 12"):
    return {
        "inv_no": inv_no,
        "mac_address": mac,
        "network_name": name,
        "domain_name": "",
        "ip_address": "10.10.1.11",
        "model_name": "Dell OptiPlex 7090",
        "branch_no": branch_no,
        "branch_name": branch_name,
        "location_name": location,
        "employee_name": "Петров А.А.",
    }


def _report(hostname, mac, network=None):
    payload = inventory.InventoryPayload(
        hostname=hostname,
        mac_address=mac,
        ip_primary="10.10.1.11",
        ip_list=["10.10.1.11"],
        report_type="heartbeat",
        network=network,
        timestamp=NOW_TS - 100,
    )
    assert inventory.receive_inventory(payload, x_api_key=TEST_AGENT_API_KEY)["success"] is True


def _cycle(env, mode="full"):
    return binding.run_binding_cycle(env.store, db_ids=["DB1", "DB2"], mode=mode, pull=env.pull)


def _list(db_id="DB1", user=None, **overrides):
    params = {
        "branch": None,
        "status_filter": None,
        "outlook_status": None,
        "q": None,
        "sort_by": "hostname",
        "sort_dir": "asc",
        "changed_only": False,
    }
    params.update(overrides)
    return inventory.get_computers(
        current_user=user or _user(),
        db_id_selected=db_id,
        scope="selected",
        **params,
    )


def test_new_pc_is_bound_by_mac_in_other_database_and_visible_in_selected_scope(env):
    _report("PC-A", MAC_1)
    env.cards["DB2"].append(_card("500001", mac=MAC_1, name="PC-A", branch_name="Сургут"))

    stats = _cycle(env)

    assert stats["bound_mac"] == 1
    rows = _list("DB1")
    assert [row["hostname"] for row in rows] == ["PC-A"]
    assert rows[0]["database_id"] == "DB2"
    assert rows[0]["branch_name"] == "Сургут"
    assert rows[0]["inventory_inv_no"] == "500001"
    assert rows[0]["is_unassigned"] is False

    detail = inventory.get_computer_detail(MAC_1, current_user=_user(), db_id_selected="DB1", scope="selected")
    assert detail["database_id"] == "DB2"
    assert detail["is_unassigned"] is False


def test_card_branch_change_is_refreshed_and_unchanged_card_is_not_rewritten(env):
    _report("PC-B", "AA-BB-CC-DD-EE-02")
    env.cards["DB1"].append(_card("500002", mac="AA-BB-CC-DD-EE-02", branch_name="Тюмень"))
    _cycle(env)

    env.cards["DB1"][0]["branch_name"] = "Ханты-Мансийск"
    env.cards["DB1"][0]["model_name"] = "HP ProDesk 400 G6"
    stats = _cycle(env)

    assert stats["refreshed"] == 1
    assert _list("DB1")[0]["branch_name"] == "Ханты-Мансийск"
    assert _list("DB1")[0]["inventory_model_name"] == "HP ProDesk 400 G6"
    assert _cycle(env)["refreshed"] == 0


def test_pc_without_card_is_unassigned_until_card_appears(env):
    _report("PC-C", "AA-BB-CC-DD-EE-03")
    _cycle(env)
    row = _list("DB1")[0]
    assert row["branch_name"] == "Без привязки"
    assert row["is_unassigned"] is True

    env.cards["DB1"].append(_card("500003", mac="AA-BB-CC-DD-EE-03"))
    _cycle(env)

    row = _list("DB1")[0]
    assert row["is_unassigned"] is False
    assert row["branch_name"] == "Тюмень"


def test_empty_branch_label_is_consistent_in_filter_and_summary(env):
    _report("PC-D", "AA-BB-CC-DD-EE-04")
    _report("PC-E", "AA-BB-CC-DD-EE-05")
    env.cards["DB1"].append(_card("500004", mac="AA-BB-CC-DD-EE-04", branch_name="", branch_no=""))
    _cycle(env)

    everything = _list("DB1")
    empty_branch = _list("DB1", branch=binding.EMPTY_BRANCH_LABEL)
    unassigned = _list("DB1", branch=binding.UNASSIGNED_BRANCH_LABEL)
    summary = inventory._computer_summary(everything)

    assert [row["hostname"] for row in empty_branch] == ["PC-D"]
    assert empty_branch[0]["is_unassigned"] is False
    assert [row["hostname"] for row in unassigned] == ["PC-E"]
    assert summary["branches"][binding.EMPTY_BRANCH_LABEL] == len(empty_branch) == 1
    assert summary["unassigned"] == len(unassigned) == 1


def test_failed_or_empty_database_pull_keeps_existing_bindings(env):
    _report("PC-F", "AA-BB-CC-DD-EE-06")
    env.cards["DB1"].append(_card("500005", mac="AA-BB-CC-DD-EE-06"))
    _cycle(env)

    env.failing.add("DB1")
    stats = _cycle(env)
    assert stats["dbs_failed"] == 1
    assert stats["unbound"] == 0
    assert _list("DB1")[0]["is_unassigned"] is False

    env.failing.clear()
    env.cards["DB1"] = []
    stats = _cycle(env)
    assert stats["unbound"] == 0
    assert _list("DB1")[0]["is_unassigned"] is False


def test_card_missing_from_successful_pull_unbinds_and_rebinds_when_back(env, monkeypatch):
    monkeypatch.setenv("INVENTORY_BINDING_UNBIND_ENABLED", "1")
    _report("PC-G", "AA-BB-CC-DD-EE-07")
    env.cards["DB1"].append(_card("500006", mac="AA-BB-CC-DD-EE-07"))
    _cycle(env)
    assert _list("DB1")[0]["is_unassigned"] is False

    env.cards["DB1"] = [_card("500007", mac="AA-BB-CC-DD-EE-99")]
    stats = _cycle(env)
    assert stats["unbound"] == 1
    assert _list("DB1")[0]["is_unassigned"] is True

    env.cards["DB1"].append(_card("500006", mac="AA-BB-CC-DD-EE-07"))
    _cycle(env)
    assert _list("DB1")[0]["is_unassigned"] is False


def test_secondary_physical_adapter_mac_binds_host(env):
    network = {"devices": [{"mac_address": "AA-BB-CC-DD-EE-18", "virtual": False}]}
    _report("PC-H", "AA-BB-CC-DD-EE-08", network=network)
    env.cards["DB2"].append(_card("500008", mac="AA-BB-CC-DD-EE-18", branch_name="Сургут"))

    stats = _cycle(env)

    assert stats["bound_adapter_mac"] == 1
    row = _list("DB1")[0]
    assert row["database_id"] == "DB2"
    assert row["branch_name"] == "Сургут"


def test_hostname_fallback_binds_only_single_card(env):
    _report("PC-I", "AA-BB-CC-DD-EE-09")
    env.cards["DB1"].append(_card("500009", name="PC-I"))
    env.cards["DB2"].append(_card("500010", name="PC-I"))

    stats = _cycle(env)
    assert stats["hostname_ambiguous"] == 1
    assert _list("DB1")[0]["is_unassigned"] is True

    env.cards["DB2"] = []
    stats = _cycle(env)
    assert stats["bound_hostname"] == 1
    assert _list("DB1")[0]["inventory_inv_no"] == "500009"


def test_unbind_is_off_by_default_and_only_counted(env, monkeypatch):
    monkeypatch.delenv("INVENTORY_BINDING_UNBIND_ENABLED", raising=False)
    _report("PC-N2", "AA-BB-CC-DD-EE-0F")
    env.cards["DB1"].append(_card("500016", mac="AA-BB-CC-DD-EE-0F"))
    _cycle(env)

    env.cards["DB1"] = [_card("500017", mac="AA-BB-CC-DD-EE-98")]
    stats = _cycle(env)

    assert stats["would_unbind"] == 1
    assert stats["unbound"] == 0
    assert _list("DB1")[0]["is_unassigned"] is False


def test_legacy_duplicate_rows_for_same_host_do_not_break_full_cycle(env):
    _report("PC-N", "AA-BB-CC-DD-EE-0E")
    env.cards["DB1"].append(_card("500015", mac="AA-BB-CC-DD-EE-0E", branch_name="Тюмень"))
    for legacy_name in ("old-name", "pc-n"):
        env.store.upsert_sql_context(
            mac_address="AA-BB-CC-DD-EE-0E",
            hostname=legacy_name,
            db_id="DB1",
            context={"inv_no": "500015", "branch_name": "Тюмень"},
        )

    first = _cycle(env)
    second = _cycle(env)

    assert first["status"] == "ok"
    assert second["status"] == "ok"
    assert _list("DB1")[0]["is_unassigned"] is False


def test_bind_cap_per_cycle_carries_remaining_hosts_to_next_cycle(env, monkeypatch):
    monkeypatch.setenv("INVENTORY_BINDING_MAX_BINDS_PER_CYCLE", "1")
    _report("PC-P1", "AA-BB-CC-DD-EE-21")
    _report("PC-P2", "AA-BB-CC-DD-EE-22")
    env.cards["DB1"].append(_card("500021", mac="AA-BB-CC-DD-EE-21"))
    env.cards["DB1"].append(_card("500022", mac="AA-BB-CC-DD-EE-22"))

    first = _cycle(env)
    assert first["bound_mac"] == 1
    assert first["capped"] == 1
    second = _cycle(env)
    assert second["bound_mac"] == 1
    assert all(not row["is_unassigned"] for row in _list("DB1"))


def test_hostname_binding_is_skipped_while_any_database_is_unavailable(env):
    _report("PC-L", "AA-BB-CC-DD-EE-0B")
    env.cards["DB2"].append(_card("500012", name="PC-L"))
    env.failing.add("DB1")

    stats = _cycle(env)

    assert stats["dbs_failed"] == 1
    assert stats["bound_hostname"] == 0
    assert _list("DB2")[0]["is_unassigned"] is True


def test_host_mode_does_not_pull_cards_for_already_bound_host(env):
    _report("PC-K", "AA-BB-CC-DD-EE-0C")
    env.cards["DB1"].append(_card("500013", mac="AA-BB-CC-DD-EE-0C"))
    _cycle(env)
    pulled = []

    def counting_pull(db_id):
        pulled.append(db_id)
        return env.pull(db_id)

    binding.run_binding_cycle(
        env.store,
        db_ids=["DB1", "DB2"],
        mode="host",
        host_keys=["AABBCCDDEE0C"],
        pull=counting_pull,
    )

    assert pulled == []


def test_cached_admin_listing_does_not_leak_other_database_pcs_to_limited_user(env):
    _report("PC-M", "AA-BB-CC-DD-EE-0D")
    env.cards["DB2"].append(_card("500014", mac="AA-BB-CC-DD-EE-0D"))
    _cycle(env)
    assert [row["hostname"] for row in _list("DB1")] == ["PC-M"]

    limited = _user(role="viewer", permissions=("computers.read",))
    assert _list("DB1", user=limited) == []


def test_host_scope_selected_hides_other_database_pcs_without_read_all(env):
    _report("PC-J", "AA-BB-CC-DD-EE-0A")
    env.cards["DB2"].append(_card("500011", mac="AA-BB-CC-DD-EE-0A"))
    _cycle(env)

    limited = _user(role="viewer", permissions=("computers.read",))
    assert _list("DB1", user=limited) == []
    assert [row["hostname"] for row in _list("DB2", user=limited)] == ["PC-J"]
    assert [row["hostname"] for row in _list("DB1")] == ["PC-J"]


@pytest.mark.parametrize(
    "raw, expected",
    [
        ("AA-BB-CC-DD-EE-01", "AABBCCDDEE01"),
        ("aa:bb:cc:dd:ee:01", "AABBCCDDEE01"),
        ("00-00-00-00-00-00-00-E0", ""),
        ("000000000000", ""),
        ("FFFFFFFFFFFF", ""),
        ("", ""),
    ],
)
def test_normalize_mac_rejects_tunnel_and_placeholder_addresses(raw, expected):
    assert binding.normalize_mac(raw) == expected


def test_match_prefers_primary_mac_then_adapter_then_free_hostname():
    index1 = binding.build_card_index("DB1", [{"inv_no": "1", "mac_address": "AA-BB-CC-DD-EE-02", "network_name": "PC-X"}])
    index2 = binding.build_card_index("DB2", [{"inv_no": "2", "mac_address": "AA-BB-CC-DD-EE-01"}])
    indexes = [index1, index2]

    primary, _ = binding.match_host(indexes, mac="AABBCCDDEE01", adapter_macs=["AABBCCDDEE02"], hostname="PC-X", taken=set())
    assert (primary.db_id, primary.inv_no, primary.source) == ("DB2", "2", "mac")

    adapter, _ = binding.match_host(indexes, mac="AABBCCDDEE09", adapter_macs=["AABBCCDDEE02"], hostname="PC-X", taken=set())
    assert (adapter.db_id, adapter.inv_no, adapter.source) == ("DB1", "1", "adapter_mac")

    taken_match, ambiguous = binding.match_host(
        indexes, mac="", adapter_macs=[], hostname="PC-X", taken={("DB1", "1")}
    )
    assert taken_match is None and ambiguous is False
