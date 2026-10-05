"""«Мой компьютер» and password status for people with several AD accounts.

A person has accounts that differ only by the separator (kozlovskii.me / kozlovskii_me); the computer he works
on now is written to the AD "Notes" field by the logon script, while the inventory also holds an old machine of
the other account. Accounts with «Password never expires» must not be reported as expired.
"""
from __future__ import annotations

import importlib
import sys
import time
from pathlib import Path
from types import SimpleNamespace

_ROOT = Path(__file__).resolve().parents[1]
for _p in (str(_ROOT), str(_ROOT / "WEB-itinvent")):
    if _p not in sys.path:
        sys.path.insert(0, _p)

ad = importlib.import_module("backend.services.ad_users_service")
self_service = importlib.import_module("backend.ai_chat.tools.self_service")
identity_module = importlib.import_module("backend.ai_chat.self_identity")


def _attr(value, raw=None):
    return SimpleNamespace(value=value, raw_values=[raw] if raw is not None else None)


def _entry(**kwargs):
    return SimpleNamespace(**{k: _attr(v) for k, v in kwargs.items()})


class _Conn:
    def __init__(self, entries):
        self.entries = entries

    def search(self, **_kwargs):
        return True

    def unbind(self):
        pass


def test_last_logon_computer_comes_from_every_account_of_the_same_person(monkeypatch):
    entries = [
        _entry(sAMAccountName="kozlovskii.me", info=None),
        _entry(sAMAccountName="kozlovskii_me", info="2026/10/02 09:22:21 <logon> @ TMN-IT-0009"),
        _entry(sAMAccountName="kozlovskii_other", info="2026/10/04 09:00:00 <logon> @ TMN-OTHER-1"),
    ]
    monkeypatch.setattr(ad, "_open_ad_connection", lambda: _Conn(entries))
    monkeypatch.setattr(ad, "_resolve_ad_search_base", lambda: "DC=x")
    result = ad.get_ad_last_logon_computers("kozlovskii.me")
    assert [(r["login"], r["computer"], r["event"]) for r in result] == [("kozlovskii_me", "TMN-IT-0009", "logon")]


def test_account_with_never_expires_flag_is_not_reported_as_expired():
    old_pwd_last_set = 133_000_000_000_000_000  # a FILETIME long in the past
    entry = SimpleNamespace(
        sAMAccountName=_attr("kozlovskii.me"),
        displayName=_attr("Козловский М.Е."),
        pwdLastSet=_attr(old_pwd_last_set, raw=old_pwd_last_set),
        userAccountControl=_attr(66048, raw=66048),  # NORMAL_ACCOUNT | DONT_EXPIRE_PASSWORD
    )
    status = ad._entry_password_status(entry)
    assert status["password_never_expires"] is True
    assert status["expired"] is False and status["must_change_now"] is False


def test_current_computer_from_ad_goes_first_and_old_machines_are_dropped(monkeypatch):
    now = time.time()
    hosts = {
        "AABBCCDDEE01": {"hostname": "TMN-IT-0009", "mac_address": "AABBCCDDEE01", "last_seen": now - 3600},
        "AABBCCDDEE02": {"hostname": "TMN-ENT-0066", "mac_address": "AABBCCDDEE02", "last_seen": now - 100 * 86400, "user_login": "ZSGP\kozlovskii.me"},
        "AABBCCDDEE03": {"hostname": "TMN-LAPTOP-7", "mac_address": "AABBCCDDEE03", "last_seen": now - 2 * 86400, "user_login": "ZSGP\kozlovskii.me"},
    }

    class _Store:
        def search_host_keys(self, query, fields, *a, **k):
            if "identity" in fields:
                return {m for m, h in hosts.items() if h["hostname"].lower() == query.lower()}
            return {"AABBCCDDEE02", "AABBCCDDEE03"}

    inventory = importlib.import_module("backend.api.v1.inventory")
    monkeypatch.setattr(inventory, "_get_inventory_app_store", lambda: _Store())
    monkeypatch.setattr(inventory, "_get_inventory_host", lambda mac: hosts.get(mac))
    monkeypatch.setattr(self_service, "_ad_last_logon_hostnames", lambda identity: ["TMN-IT-0009"])
    identity = identity_module.SelfIdentity(
        user_id=5, full_name="Козловский", emails=(), ad_login="kozlovskii.me",
        database_id="ITINVENT", owner_no=None, owner_match="none",
    )
    result = self_service._my_hosts(identity, [])
    assert [h["hostname"] for h in result] == ["TMN-IT-0009", "TMN-LAPTOP-7"]
