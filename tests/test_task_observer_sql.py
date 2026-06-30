from __future__ import annotations

from backend.services.task_observer_sql import build_observer_membership_clause


def test_build_observer_membership_clause_postgresql():
    clause, params = build_observer_membership_clause(5, uses_postgresql=True)
    assert "json_array_elements_text" in clause
    assert params == [5]


def test_build_observer_membership_clause_sqlite():
    clause, params = build_observer_membership_clause(7, uses_postgresql=False)
    assert "json_each" in clause
    assert params == [7]
