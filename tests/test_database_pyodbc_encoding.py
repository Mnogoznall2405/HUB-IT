"""pyodbc SQL Server charset configuration (CHAR/cp1251, WCHAR/utf-16-le)."""
from __future__ import annotations

import pyodbc
import pytest

from backend.database.connection import configure_pyodbc_encoding


class _FakeConnection:
    def __init__(self) -> None:
        self.decoding: list[tuple] = []
        self.encoding: list[tuple] = []

    def setdecoding(self, ctype, *, encoding=None, **kwargs):
        self.decoding.append((ctype, encoding, kwargs))

    def setencoding(self, encoding=None, ctype=None, **kwargs):
        self.encoding.append((ctype, encoding, kwargs))


def test_configure_pyodbc_encoding_defaults_to_cp1251_for_sql_char(monkeypatch):
    monkeypatch.delenv("SQL_CHAR_ENCODING", raising=False)
    monkeypatch.delenv("SQL_WCHAR_ENCODING", raising=False)
    monkeypatch.delenv("SQL_PARAM_ENCODING", raising=False)

    conn = _FakeConnection()
    configure_pyodbc_encoding(conn)  # type: ignore[arg-type]

    assert (pyodbc.SQL_CHAR, "cp1251", {}) in [(c, e, k) for c, e, k in conn.decoding]
    assert (pyodbc.SQL_WCHAR, "utf-16-le", {}) in [(c, e, k) for c, e, k in conn.decoding]
    assert (pyodbc.SQL_CHAR, "cp1251", {}) in [(c, e, k) for c, e, k in conn.encoding]


def test_configure_pyodbc_encoding_respects_env_override(monkeypatch):
    monkeypatch.setenv("SQL_CHAR_ENCODING", "latin1")
    monkeypatch.setenv("SQL_WCHAR_ENCODING", "utf-16-le")

    conn = _FakeConnection()
    configure_pyodbc_encoding(conn)  # type: ignore[arg-type]

    char_decode = next(item for item in conn.decoding if item[0] == pyodbc.SQL_CHAR)
    assert char_decode[1] == "latin1"
