from __future__ import annotations

import sys
from pathlib import Path


ROOT = Path(__file__).resolve().parents[1]
WEB_ROOT = ROOT / "WEB-itinvent"
if str(WEB_ROOT) not in sys.path:
    sys.path.insert(0, str(WEB_ROOT))

from backend.database import queries as db_queries  # noqa: E402


class FakeDB:
    def __init__(self, responses=None):
        self.calls = []
        self._responses = list(responses or [])

    def execute_query(self, query, params=None):
        self.calls.append((query, params))
        if not self._responses:
            return []
        response = self._responses.pop(0)
        if isinstance(response, Exception):
            raise response
        return response


def _compact(query: str) -> str:
    return " ".join(query.split())


def test_resolve_pc_context_uses_late_bound_db_and_normalized_mac_first(monkeypatch):
    row = {"inv_no": "1001", "network_name": "MAC-HIT"}
    fake_db = FakeDB([[row]])
    db_ids = []

    def fake_get_db(db_id=None):
        db_ids.append(db_id)
        return fake_db

    monkeypatch.setattr(db_queries, "get_db", fake_get_db)

    result = db_queries.resolve_pc_context_by_mac_or_hostname(
        mac_address="aa:bb-cc.dd ee ff",
        hostname="PC-01",
        db_id="main",
    )

    assert result == row
    assert db_ids == ["main"]
    assert len(fake_db.calls) == 1
    query, params = fake_db.calls[0]
    assert params == ("AABBCCDDEEFF",)
    assert "COALESCE(i.MAC_ADDRESS" in _compact(query)


def test_resolve_pc_context_falls_back_to_fqdn_short_hostname(monkeypatch):
    row = {"inv_no": "1002", "network_name": "PC-01"}
    fake_db = FakeDB([[], [row]])
    monkeypatch.setattr(db_queries, "get_db", lambda db_id=None: fake_db)

    result = db_queries.resolve_pc_context_by_mac_or_hostname(
        mac_address=None,
        hostname="PC-01.corp.example",
        db_id="main",
    )

    assert result == row
    assert [params for _query, params in fake_db.calls] == [
        ("PC-01.corp.example", "PC-01.corp.example"),
        ("PC-01", "PC-01"),
    ]


def test_resolve_pc_context_falls_back_from_mac_exception_to_hostname(monkeypatch):
    row = {"inv_no": "1003", "network_name": "PC-02"}
    fake_db = FakeDB([RuntimeError("legacy schema"), [row]])
    monkeypatch.setattr(db_queries, "get_db", lambda db_id=None: fake_db)

    result = db_queries.resolve_pc_context_by_mac_or_hostname(
        mac_address="AA-BB-CC-DD-EE-02",
        hostname="PC-02",
        db_id="main",
    )

    assert result == row
    assert [params for _query, params in fake_db.calls] == [
        ("AABBCCDDEE02",),
        ("PC-02", "PC-02"),
    ]


def test_resolve_pc_context_returns_none_for_empty_inputs_without_sql(monkeypatch):
    fake_db = FakeDB()
    monkeypatch.setattr(db_queries, "get_db", lambda db_id=None: fake_db)

    result = db_queries.resolve_pc_context_by_mac_or_hostname(
        mac_address="",
        hostname="",
        db_id="main",
    )

    assert result is None
    assert fake_db.calls == []


def test_resolve_pc_context_returns_none_when_lookup_rows_are_empty(monkeypatch):
    fake_db = FakeDB([[], []])
    monkeypatch.setattr(db_queries, "get_db", lambda db_id=None: fake_db)

    result = db_queries.resolve_pc_context_by_mac_or_hostname(
        mac_address="AA-BB-CC-DD-EE-03",
        hostname="PC-03",
        db_id="main",
    )

    assert result is None
    assert [params for _query, params in fake_db.calls] == [
        ("AABBCCDDEE03",),
        ("PC-03", "PC-03"),
    ]
