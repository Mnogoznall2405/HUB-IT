"""SQLite-like compatibility wrapper over SQLAlchemy connections."""
from __future__ import annotations

import re
from collections.abc import Iterator, Mapping
from typing import Any

from sqlalchemy import inspect, text


class CompatRow(Mapping[str, Any]):
    def __init__(self, payload: Mapping[str, Any]) -> None:
        self._payload = dict(payload)

    def __getitem__(self, key: str | int) -> Any:
        if isinstance(key, int):
            return list(self._payload.values())[key]
        return self._payload[key]

    def __iter__(self) -> Iterator[str]:
        return iter(self._payload)

    def __len__(self) -> int:
        return len(self._payload)


class CompatResult:
    def __init__(self, rows: list[CompatRow] | None = None, *, rowcount: int = 0) -> None:
        self._rows = rows or []
        self.rowcount = rowcount

    def fetchone(self):
        return self._rows[0] if self._rows else None

    def fetchall(self):
        return list(self._rows)


class SqlAlchemyCompatConnection:
    def __init__(
        self,
        engine,
        *,
        table_names: set[str],
        schema: str | None = None,
        returning_id_tables: set[str] | None = None,
    ) -> None:
        self._engine = engine
        self._connection = engine.connect()
        self._transaction = self._connection.begin()
        self._table_names = sorted({str(item) for item in table_names if str(item).strip()}, key=len, reverse=True)
        self._schema = str(schema).strip() if schema else None
        self._returning_id_tables = {str(item) for item in (returning_id_tables or set()) if str(item).strip()}
        self.total_changes = 0
        self._last_insert_rowid: int | None = None
        self._closed = False

    def __enter__(self):
        return self

    def __exit__(self, exc_type, exc, tb) -> None:
        try:
            if exc_type is not None:
                self.rollback()
            else:
                self.commit()
        finally:
            self.close()

    def close(self) -> None:
        if self._closed:
            return
        try:
            if self._transaction.is_active:
                self._transaction.rollback()
        finally:
            self._connection.close()
            self._closed = True

    def commit(self) -> None:
        if self._closed:
            return
        if self._transaction.is_active:
            self._transaction.commit()
        self._transaction = self._connection.begin()

    def rollback(self) -> None:
        if self._closed:
            return
        if self._transaction.is_active:
            self._transaction.rollback()
        self._transaction = self._connection.begin()

    def execute(self, sql: str, params: tuple[Any, ...] | list[Any] | None = None):
        statement = str(sql or "")
        if self._is_pragma_foreign_keys(statement):
            return CompatResult([])
        if self._is_pragma_table_info(statement):
            return self._pragma_table_info(statement)
        if self._is_select_last_insert_rowid(statement):
            row = CompatRow({"last_insert_rowid()": self._last_insert_rowid or 0})
            return CompatResult([row], rowcount=1 if self._last_insert_rowid is not None else 0)

        insert_target = self._insert_target(statement)
        rewritten = self._rewrite_tables(statement)
        rewritten = self._rewrite_insert_or_ignore(rewritten)
        rewritten = self._rewrite_insert_returning_id(rewritten, statement)
        rewritten = self._rewrite_sqlite_ddl(rewritten)
        bound_sql, bound_params = self._bind_qmark_params(rewritten, params or ())
        result = self._connection.execute(text(bound_sql), bound_params)
        if result.returns_rows:
            rows = [CompatRow(row) for row in result.mappings().all()]
            self.total_changes = max(0, int(result.rowcount or len(rows) or 0))
            if insert_target and insert_target in self._returning_id_tables and rows:
                first_row = rows[0]
                inserted_id = first_row.get("id")
                if inserted_id is not None:
                    self._last_insert_rowid = int(inserted_id)
            return CompatResult(rows, rowcount=self.total_changes)
        self.total_changes = max(0, int(result.rowcount or 0))
        if insert_target and insert_target in self._returning_id_tables:
            lastrowid = getattr(result, "lastrowid", None)
            if lastrowid is not None:
                self._last_insert_rowid = int(lastrowid)
        return CompatResult([], rowcount=self.total_changes)

    def executemany(self, sql: str, seq_of_params) -> CompatResult:
        total_rowcount = 0
        for item in seq_of_params or []:
            result = self.execute(sql, item)
            total_rowcount += int(result.rowcount or 0)
        self.total_changes = total_rowcount
        return CompatResult([], rowcount=total_rowcount)

    def executescript(self, script: str) -> None:
        chunks = [chunk.strip() for chunk in str(script or "").split(";")]
        for chunk in chunks:
            if chunk:
                self.execute(chunk)

    def _is_pragma_table_info(self, sql: str) -> bool:
        return bool(re.match(r"^\s*PRAGMA\s+table_info\(", sql, flags=re.IGNORECASE))

    def _is_pragma_foreign_keys(self, sql: str) -> bool:
        return bool(re.match(r"^\s*PRAGMA\s+foreign_keys\s*=", sql, flags=re.IGNORECASE))

    def _is_select_last_insert_rowid(self, sql: str) -> bool:
        return bool(re.match(r"^\s*SELECT\s+last_insert_rowid\(\)\s*$", sql, flags=re.IGNORECASE))

    def _pragma_table_info(self, sql: str) -> CompatResult:
        match = re.search(r"PRAGMA\s+table_info\(([^)]+)\)", sql, flags=re.IGNORECASE)
        table_name = str(match.group(1) if match else "").strip().strip('"').strip("'")
        inspector = inspect(self._connection)
        columns = inspector.get_columns(table_name, schema=self._schema)
        pk = set(inspector.get_pk_constraint(table_name, schema=self._schema).get("constrained_columns") or [])
        rows = []
        for index, column in enumerate(columns):
            rows.append(
                CompatRow(
                    {
                        "cid": index,
                        "name": column.get("name"),
                        "type": str(column.get("type") or ""),
                        "notnull": 0 if column.get("nullable", True) else 1,
                        "dflt_value": None,
                        "pk": 1 if column.get("name") in pk else 0,
                    }
                )
            )
        return CompatResult(rows)

    def _rewrite_tables(self, sql: str) -> str:
        if not self._schema:
            return sql

        rewritten = sql
        for table_name in self._table_names:
            rewritten = re.sub(
                rf"(?<![\w.]){re.escape(table_name)}(?![\w.])",
                f"{self._schema}.{table_name}",
                rewritten,
            )
        return rewritten

    def _bind_qmark_params(self, sql: str, params: tuple[Any, ...] | list[Any]):
        values = list(params)
        bound_params: dict[str, Any] = {}
        parts: list[str] = []
        param_index = 0
        for char in sql:
            if char == "?":
                key = f"p{param_index}"
                parts.append(f":{key}")
                bound_params[key] = values[param_index]
                param_index += 1
            else:
                parts.append(char)
        return "".join(parts), bound_params

    def _rewrite_insert_or_ignore(self, sql: str) -> str:
        if "INSERT OR IGNORE INTO" not in sql.upper() or not self._schema:
            return sql
        rewritten = re.sub(r"INSERT\s+OR\s+IGNORE\s+INTO", "INSERT INTO", sql, count=1, flags=re.IGNORECASE)
        if re.search(r"\bON\s+CONFLICT\b", rewritten, flags=re.IGNORECASE):
            return rewritten
        return f"{rewritten.rstrip()} ON CONFLICT DO NOTHING"

    def _insert_target(self, sql: str) -> str | None:
        match = re.match(r"^\s*INSERT(?:\s+OR\s+IGNORE)?\s+INTO\s+([A-Za-z0-9_.]+)\s*\(([^)]*)\)", sql, flags=re.IGNORECASE)
        if not match:
            return None
        table_token = str(match.group(1) or "").strip().split(".")[-1]
        return table_token or None

    def _rewrite_insert_returning_id(self, sql: str, original_sql: str) -> str:
        target = self._insert_target(original_sql)
        if not target or target not in self._returning_id_tables:
            return sql
        if re.search(r"\bRETURNING\b", sql, flags=re.IGNORECASE):
            return sql
        match = re.match(r"^\s*INSERT(?:\s+OR\s+IGNORE)?\s+INTO\s+[A-Za-z0-9_.]+\s*\(([^)]*)\)", original_sql, flags=re.IGNORECASE)
        if not match:
            return sql
        columns = [item.strip().strip('"').strip("'").lower() for item in str(match.group(1)).split(",")]
        if "id" in columns:
            return sql
        return f"{sql.rstrip()} RETURNING id"

    def _rewrite_sqlite_ddl(self, sql: str) -> str:
        rewritten = str(sql or "")
        if self._engine.dialect.name != "postgresql":
            return rewritten
        rewritten = re.sub(
            r"\bINTEGER\s+PRIMARY\s+KEY\s+AUTOINCREMENT\b",
            "INTEGER GENERATED BY DEFAULT AS IDENTITY PRIMARY KEY",
            rewritten,
            flags=re.IGNORECASE,
        )
        rewritten = re.sub(
            r"\bAUTOINCREMENT\b",
            "",
            rewritten,
            flags=re.IGNORECASE,
        )
        rewritten = re.sub(
            r"\bBLOB\b",
            "BYTEA",
            rewritten,
            flags=re.IGNORECASE,
        )
        return rewritten
