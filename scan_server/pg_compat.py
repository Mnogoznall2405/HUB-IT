"""sqlite3-like connection wrapper over SQLAlchemy/PostgreSQL for ScanStore."""

from __future__ import annotations

import json
import re
from typing import Any, Iterable, Mapping, Optional, Sequence, Union

from sqlalchemy import text
from sqlalchemy.engine import Connection, Engine

_QMARK_RE = re.compile(r"\?")


def qmark_to_named(sql: str, params: Any = None) -> tuple[str, Mapping[str, Any]]:
    if params is None:
        return sql, {}
    if isinstance(params, Mapping):
        return sql, params
    values = list(params)
    bind: dict[str, Any] = {}
    index = 0

    def _repl(_: re.Match[str]) -> str:
        nonlocal index
        key = f"p{index}"
        if index >= len(values):
            raise ValueError(f"Not enough SQL bind params for placeholder #{index}")
        bind[key] = values[index]
        index += 1
        return f":{key}"

    converted = _QMARK_RE.sub(_repl, sql)
    if index != len(values):
        raise ValueError(f"Unused SQL bind params: expected {index}, got {len(values)}")
    return converted, bind


def _normalize_cell(value: Any) -> Any:
    if isinstance(value, (dict, list)):
        return json.dumps(value, ensure_ascii=False)
    return value


class PgRow(Mapping[str, Any]):
    def __init__(self, mapping: Mapping[str, Any]) -> None:
        self._data = {str(key): _normalize_cell(value) for key, value in mapping.items()}
        self._keys = tuple(self._data.keys())

    def __getitem__(self, key: Union[str, int]) -> Any:
        if isinstance(key, int):
            return self._data[self._keys[key]]
        return self._data[key]

    def __iter__(self):
        return iter(self._keys)

    def __len__(self) -> int:
        return len(self._keys)

    def keys(self):
        return self._keys


class PgCursor:
    def __init__(self, conn: "PgConnection") -> None:
        self._conn = conn
        self._rows: list[PgRow] = []
        self._index = 0
        self.rowcount = -1
        self.lastrowid: Optional[int] = None

    def execute(self, sql: str, params: Any = None) -> "PgCursor":
        sql_text = str(sql or "").strip()
        if not sql_text:
            return self
        upper = sql_text.upper()
        if upper.startswith("PRAGMA"):
            self._rows = []
            self._index = 0
            self.rowcount = 0
            return self
        converted, bind = qmark_to_named(sql_text, params)
        result = self._conn.sa_conn.execute(text(converted), bind)
        self.rowcount = int(result.rowcount or 0)
        if result.returns_rows:
            self._rows = [PgRow(row._mapping) for row in result]
        else:
            self._rows = []
            # Best-effort lastrowid for IDENTITY inserts.
            try:
                inserted = result.inserted_primary_key
                if inserted:
                    self.lastrowid = int(inserted[0])
            except Exception:
                self.lastrowid = None
        self._index = 0
        return self

    def executemany(self, sql: str, seq_of_params: Iterable[Sequence[Any]]) -> "PgCursor":
        total = 0
        for params in seq_of_params:
            self.execute(sql, params)
            total += max(0, int(self.rowcount or 0))
        self.rowcount = total
        return self

    def fetchone(self) -> Optional[PgRow]:
        if self._index >= len(self._rows):
            return None
        row = self._rows[self._index]
        self._index += 1
        return row

    def fetchall(self) -> list[PgRow]:
        rows = self._rows[self._index :]
        self._index = len(self._rows)
        return rows

    def fetchmany(self, size: int = 1) -> list[PgRow]:
        end = min(len(self._rows), self._index + max(1, int(size or 1)))
        rows = self._rows[self._index : end]
        self._index = end
        return rows

    def close(self) -> None:
        self._rows = []
        self._index = 0


class PgConnection:
    def __init__(self, engine: Engine) -> None:
        self._engine = engine
        self._ctx = engine.connect()
        self.sa_conn: Connection = self._ctx.__enter__()
        self._txn = self.sa_conn.begin()

    def __enter__(self) -> "PgConnection":
        return self

    def __exit__(self, exc_type, exc, tb) -> None:
        try:
            if exc_type is None:
                self.commit()
            else:
                self.rollback()
        finally:
            self.close()

    def execute(self, sql: str, params: Any = None) -> PgCursor:
        cursor = PgCursor(self)
        return cursor.execute(sql, params)

    def executemany(self, sql: str, seq_of_params: Iterable[Sequence[Any]]) -> PgCursor:
        cursor = PgCursor(self)
        return cursor.executemany(sql, seq_of_params)

    def executescript(self, script: str) -> None:
        for statement in str(script or "").split(";"):
            stmt = statement.strip()
            if not stmt or stmt.upper().startswith("PRAGMA"):
                continue
            self.execute(stmt)

    def commit(self) -> None:
        if self._txn is not None and self._txn.is_active:
            self._txn.commit()
            self._txn = self.sa_conn.begin()

    def rollback(self) -> None:
        if self._txn is not None and self._txn.is_active:
            self._txn.rollback()
            self._txn = self.sa_conn.begin()

    def close(self) -> None:
        try:
            if self._txn is not None and self._txn.is_active:
                self._txn.rollback()
        except Exception:
            pass
        try:
            self._ctx.__exit__(None, None, None)
        except Exception:
            pass


class NullLock:
    def acquire(self, *args, **kwargs) -> bool:
        return True

    def release(self) -> None:
        return None

    def __enter__(self) -> "NullLock":
        return self

    def __exit__(self, exc_type, exc, tb) -> bool:
        return False
