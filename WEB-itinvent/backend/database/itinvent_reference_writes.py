"""
Write access to ITINVENT reference tables (vendors, branches, statuses, locations,
equipment types and models) in SQL Server.

The legacy schema has no foreign keys and no IDENTITY columns: keys are allocated
as ``MAX + 1`` under an exclusive table lock, and "is this row used" is checked by
hand against every table that stores the key. Everything for one operation runs in
a single short transaction (``db.get_connection()`` commits on exit, rolls back on
error). Only parameterized ``?`` queries; table and column names come from the
constants below, never from request data.
"""
from __future__ import annotations

from typing import Any, Callable, Dict, List, Optional

from backend.database.connection import get_db as _default_get_db

KINDS = ("vendors", "branches", "statuses", "locations", "types", "models")

# Only these CI_TYPE categories are managed here: 1 = equipment, 4 = consumables.
# Other categories (documents, AD objects, ...) belong to the legacy client.
MANAGED_CI_TYPES = (1, 4)

NAME_MAX_LENGTH = 255
LIST_LIMIT = 5000

_USAGE_COLUMNS = ("BRANCH_NO", "LOC_NO", "TYPE_NO", "MODEL_NO", "STATUS_NO", "VENDOR_NO")

_TABLE_LABELS = {
    "ITEMS": "оборудование и расходники",
    "DOCS": "акты",
    "INVENT": "инвентаризации",
    "JOBS": "работы",
    "LANS": "сети",
    "ORDERS": "заказы",
    "SCHEDULES": "расписания",
    "TASKS": "задачи",
    "LOC_BRANCH": "привязки кабинетов к филиалам",
    "LOC_TREE_GROUP": "группы дерева локаций",
    "CI_MODELS": "модели",
    "CI_TYPES": "типы",
}

# (table, column, scoped_by_ci_type) per kind. A row counts as "used" if any of
# these tables holds its key. Tables/columns missing in a given database are skipped.
_BRANCH_USAGE = tuple(
    (table, "BRANCH_NO", False)
    for table in ("ITEMS", "DOCS", "INVENT", "JOBS", "LANS", "ORDERS", "SCHEDULES", "TASKS", "LOC_BRANCH", "LOC_TREE_GROUP")
)
_LOCATION_USAGE = tuple(
    (table, "LOC_NO", False)
    for table in ("ITEMS", "DOCS", "INVENT", "JOBS", "LANS", "SCHEDULES", "TASKS", "LOC_TREE_GROUP")
)
_USAGE: Dict[str, tuple] = {
    "vendors": (("CI_MODELS", "VENDOR_NO", False), ("CI_TYPES", "VENDOR_NO", False)),
    "branches": _BRANCH_USAGE,
    "statuses": (("ITEMS", "STATUS_NO", False),),
    "locations": _LOCATION_USAGE,
    # DOCS.TYPE_NO is the document type (CI_TYPE 10), so it never refers to these types.
    "types": (
        ("ITEMS", "TYPE_NO", True),
        ("CI_MODELS", "TYPE_NO", True),
        ("JOBS", "TYPE_NO", False),
        ("TASKS", "TYPE_NO", False),
    ),
    "models": (("ITEMS", "MODEL_NO", True),),
}


class ReferenceDataError(Exception):
    """Business-rule failure; ``code`` is one of invalid/not_found/duplicate/in_use."""

    def __init__(self, code: str, message: str, **extra: Any) -> None:
        super().__init__(message)
        self.code = code
        self.message = message
        self.extra = extra


def _get_db(db_id: Optional[str], get_db_fn: Optional[Callable[[Optional[str]], Any]]) -> Any:
    return (get_db_fn or _default_get_db)(db_id)


def normalize_name(value: Any) -> str:
    text = " ".join(str(value or "").split())
    if not text:
        raise ReferenceDataError("invalid", "Название не может быть пустым")
    if len(text) > NAME_MAX_LENGTH:
        raise ReferenceDataError("invalid", f"Название длиннее {NAME_MAX_LENGTH} символов")
    return text


def _to_int(value: Any, field: str, *, required: bool = True) -> Optional[int]:
    if value in (None, ""):
        if required:
            raise ReferenceDataError("invalid", f"Не указано поле {field}")
        return None
    try:
        number = int(value)
    except (TypeError, ValueError):
        raise ReferenceDataError("invalid", f"Некорректное значение поля {field}") from None
    if number < 0:  # legacy data has real rows with key 0 (e.g. a vendor)
        raise ReferenceDataError("invalid", f"Некорректное значение поля {field}")
    return number


def _ci_type(value: Any) -> int:
    number = _to_int(value, "ci_type")
    if number not in MANAGED_CI_TYPES:
        raise ReferenceDataError("invalid", "Категория не поддерживается (доступны оборудование и расходники)")
    return number


def _check_kind(kind: str) -> str:
    if kind not in KINDS:
        raise ReferenceDataError("not_found", "Неизвестный справочник")
    return kind


def _lock_table(cursor: Any, table: str) -> None:
    cursor.execute(f"SELECT TOP 1 1 FROM {table} WITH (TABLOCKX, HOLDLOCK)")
    cursor.fetchall()


def _next_no(cursor: Any, table: str, pk: str) -> int:
    """MAX+1 over the whole table (also across CI_TYPE), under the exclusive lock."""
    cursor.execute(f"SELECT ISNULL(MAX({pk}), 0) + 1 FROM {table} WITH (TABLOCKX, HOLDLOCK)")
    return int(cursor.fetchone()[0])


def _row_dicts(cursor: Any) -> List[dict]:
    columns = [column[0] for column in cursor.description] if cursor.description else []
    return [dict(zip(columns, row)) for row in cursor.fetchall()]


def _fetch_one(cursor: Any, query: str, params: tuple = ()) -> Optional[dict]:
    cursor.execute(query, params)
    rows = _row_dicts(cursor)
    return rows[0] if rows else None


def _exists(cursor: Any, query: str, params: tuple = ()) -> bool:
    cursor.execute(query, params)
    return cursor.fetchone() is not None


# --------------------------------------------------------------------------
# Reading
# --------------------------------------------------------------------------

def _like(value: Optional[str]) -> Optional[str]:
    text = " ".join(str(value or "").split()).lower()
    return f"%{text}%" if text else None


def list_references(
    kind: str,
    db_id: Optional[str] = None,
    *,
    ci_type: Any = None,
    type_no: Any = None,
    branch_no: Any = None,
    q: Optional[str] = None,
    get_db_fn: Optional[Callable[[Optional[str]], Any]] = None,
) -> List[dict]:
    _check_kind(kind)
    db = _get_db(db_id, get_db_fn)
    like = _like(q)

    if kind in ("vendors", "branches", "statuses"):
        table, pk, name = {
            "vendors": ("VENDORS", "VENDOR_NO", "VENDOR_NAME"),
            "branches": ("BRANCHES", "BRANCH_NO", "BRANCH_NAME"),
            "statuses": ("STATUS", "STATUS_NO", "DESCR"),
        }[kind]
        sql = f"SELECT TOP {LIST_LIMIT} {pk} AS id, {name} AS name FROM {table}"
        params: list = []
        if like:
            sql += f" WHERE LOWER({name}) LIKE ?"
            params.append(like)
        sql += f" ORDER BY {name}, {pk}"
        return db.execute_query(sql, tuple(params))

    if kind == "types":
        sql = (
            f"SELECT TOP {LIST_LIMIT} TYPE_NO AS id, TYPE_NAME AS name, CI_TYPE AS ci_type "
            "FROM CI_TYPES WHERE CI_TYPE = ?"
        )
        params = [_ci_type(ci_type if ci_type is not None else 1)]
        if like:
            sql += " AND LOWER(TYPE_NAME) LIKE ?"
            params.append(like)
        sql += " ORDER BY TYPE_NAME, TYPE_NO"
        return db.execute_query(sql, tuple(params))

    if kind == "models":
        sql = (
            f"SELECT TOP {LIST_LIMIT} m.MODEL_NO AS id, m.MODEL_NAME AS name, m.CI_TYPE AS ci_type, "
            "m.TYPE_NO AS type_no, t.TYPE_NAME AS type_name, m.VENDOR_NO AS vendor_no, v.VENDOR_NAME AS vendor_name "
            "FROM CI_MODELS m "
            "LEFT JOIN CI_TYPES t ON t.TYPE_NO = m.TYPE_NO AND t.CI_TYPE = m.CI_TYPE "
            "LEFT JOIN VENDORS v ON v.VENDOR_NO = m.VENDOR_NO "
            "WHERE m.CI_TYPE = ?"
        )
        params = [_ci_type(ci_type if ci_type is not None else 1)]
        if type_no not in (None, ""):
            sql += " AND m.TYPE_NO = ?"
            params.append(_to_int(type_no, "type_no"))
        if like:
            sql += " AND LOWER(m.MODEL_NAME) LIKE ?"
            params.append(like)
        sql += " ORDER BY m.MODEL_NAME, m.MODEL_NO"
        return db.execute_query(sql, tuple(params))

    # locations
    sql = f"SELECT TOP {LIST_LIMIT} l.LOC_NO AS id, l.DESCR AS name FROM LOCATIONS l WHERE 1 = 1"
    params = []
    if branch_no not in (None, ""):
        sql += " AND EXISTS (SELECT 1 FROM LOC_BRANCH lb WHERE lb.LOC_NO = l.LOC_NO AND lb.BRANCH_NO = ?)"
        params.append(_to_int(branch_no, "branch_no"))
    if like:
        sql += " AND LOWER(l.DESCR) LIKE ?"
        params.append(like)
    sql += " ORDER BY l.DESCR, l.LOC_NO"
    rows = db.execute_query(sql, tuple(params))
    links: Dict[int, List[int]] = {}
    for link in db.execute_query("SELECT LOC_NO, BRANCH_NO FROM LOC_BRANCH ORDER BY BRANCH_NO"):
        links.setdefault(int(link["LOC_NO"]), []).append(int(link["BRANCH_NO"]))
    for row in rows:
        row["branch_nos"] = links.get(int(row["id"]), [])
    return rows


# --------------------------------------------------------------------------
# Usage
# --------------------------------------------------------------------------

def _existing_columns(cursor: Any) -> set:
    placeholders = ", ".join("?" for _ in _USAGE_COLUMNS)
    cursor.execute(
        "SELECT t.name, c.name FROM sys.columns c JOIN sys.tables t ON t.object_id = c.object_id "
        f"WHERE c.name IN ({placeholders})",
        _USAGE_COLUMNS,
    )
    return {(str(row[0]).upper(), str(row[1]).upper()) for row in cursor.fetchall()}


def _usage(cursor: Any, kind: str, ref_id: int, ci_type: Optional[int]) -> List[dict]:
    existing = _existing_columns(cursor)
    result: List[dict] = []
    for table, column, scoped in _USAGE[kind]:
        if (table, column) not in existing:
            continue
        sql = f"SELECT COUNT(1) FROM {table} WHERE {column} = ?"
        params: list = [ref_id]
        if scoped:
            sql += " AND CI_TYPE = ?"
            params.append(ci_type)
        cursor.execute(sql, tuple(params))
        count = int((cursor.fetchone() or [0])[0] or 0)
        if count > 0:
            result.append({"table": table, "label": _TABLE_LABELS.get(table, table), "count": count})
    return result


def _usage_message(usage: List[dict]) -> str:
    parts = ", ".join(f"{item['label']}: {item['count']}" for item in usage)
    return f"Запись используется ({parts}) — удаление невозможно"


def get_reference_usage(
    kind: str,
    ref_id: Any,
    db_id: Optional[str] = None,
    *,
    ci_type: Any = None,
    get_db_fn: Optional[Callable[[Optional[str]], Any]] = None,
) -> dict:
    _check_kind(kind)
    number = _to_int(ref_id, "id")
    scoped_ci_type = _ci_type(ci_type if ci_type is not None else 1) if kind in ("types", "models") else None
    db = _get_db(db_id, get_db_fn)
    with db.get_connection() as conn:
        cursor = conn.cursor()
        if _read_row(cursor, kind, number, scoped_ci_type) is None:
            raise ReferenceDataError("not_found", "Запись не найдена")
        usage = _usage(cursor, kind, number, scoped_ci_type)
    return {"id": number, "total": sum(item["count"] for item in usage), "usage": usage}


# --------------------------------------------------------------------------
# Row access
# --------------------------------------------------------------------------

def _read_row(cursor: Any, kind: str, ref_id: int, ci_type: Optional[int]) -> Optional[dict]:
    if kind == "vendors":
        return _fetch_one(cursor, "SELECT VENDOR_NO AS id, VENDOR_NAME AS name FROM VENDORS WHERE VENDOR_NO = ?", (ref_id,))
    if kind == "branches":
        return _fetch_one(cursor, "SELECT BRANCH_NO AS id, BRANCH_NAME AS name FROM BRANCHES WHERE BRANCH_NO = ?", (ref_id,))
    if kind == "statuses":
        return _fetch_one(cursor, "SELECT STATUS_NO AS id, DESCR AS name FROM STATUS WHERE STATUS_NO = ?", (ref_id,))
    if kind == "locations":
        row = _fetch_one(cursor, "SELECT LOC_NO AS id, DESCR AS name FROM LOCATIONS WHERE LOC_NO = ?", (ref_id,))
        if row is not None:
            cursor.execute("SELECT BRANCH_NO FROM LOC_BRANCH WHERE LOC_NO = ? ORDER BY BRANCH_NO", (ref_id,))
            row["branch_nos"] = [int(item[0]) for item in cursor.fetchall()]
        return row
    if kind == "types":
        return _fetch_one(
            cursor,
            "SELECT TYPE_NO AS id, TYPE_NAME AS name, CI_TYPE AS ci_type FROM CI_TYPES WHERE TYPE_NO = ? AND CI_TYPE = ?",
            (ref_id, ci_type),
        )
    return _fetch_one(
        cursor,
        "SELECT MODEL_NO AS id, MODEL_NAME AS name, CI_TYPE AS ci_type, TYPE_NO AS type_no, VENDOR_NO AS vendor_no "
        "FROM CI_MODELS WHERE MODEL_NO = ? AND CI_TYPE = ?",
        (ref_id, ci_type),
    )


def _require_branches(cursor: Any, branch_nos: List[int]) -> None:
    for branch_no in branch_nos:
        if not _exists(cursor, "SELECT 1 FROM BRANCHES WHERE BRANCH_NO = ?", (branch_no,)):
            raise ReferenceDataError("invalid", f"Филиал {branch_no} не найден")


def _parse_branch_nos(value: Any) -> List[int]:
    if not isinstance(value, (list, tuple)):
        raise ReferenceDataError("invalid", "branch_nos должен быть списком")
    numbers = sorted({_to_int(item, "branch_nos") for item in value})
    return [number for number in numbers if number is not None]


def _check_duplicate(
    cursor: Any,
    kind: str,
    name: str,
    *,
    exclude_id: int,
    ci_type: Optional[int] = None,
    type_no: Optional[int] = None,
    branch_nos: Optional[List[int]] = None,
) -> None:
    lowered = name.lower()
    if kind == "vendors":
        found = _exists(
            cursor,
            "SELECT TOP 1 1 FROM VENDORS WHERE LOWER(LTRIM(RTRIM(VENDOR_NAME))) = ? AND VENDOR_NO <> ?",
            (lowered, exclude_id),
        )
    elif kind == "branches":
        found = _exists(
            cursor,
            "SELECT TOP 1 1 FROM BRANCHES WHERE LOWER(LTRIM(RTRIM(BRANCH_NAME))) = ? AND BRANCH_NO <> ?",
            (lowered, exclude_id),
        )
    elif kind == "statuses":
        found = _exists(
            cursor,
            "SELECT TOP 1 1 FROM STATUS WHERE LOWER(LTRIM(RTRIM(DESCR))) = ? AND STATUS_NO <> ?",
            (lowered, exclude_id),
        )
    elif kind == "types":
        found = _exists(
            cursor,
            "SELECT TOP 1 1 FROM CI_TYPES WHERE LOWER(LTRIM(RTRIM(TYPE_NAME))) = ? AND CI_TYPE = ? AND TYPE_NO <> ?",
            (lowered, ci_type, exclude_id),
        )
    elif kind == "models":
        found = _exists(
            cursor,
            "SELECT TOP 1 1 FROM CI_MODELS WHERE LOWER(LTRIM(RTRIM(MODEL_NAME))) = ? "
            "AND CI_TYPE = ? AND TYPE_NO = ? AND MODEL_NO <> ?",
            (lowered, ci_type, type_no, exclude_id),
        )
    else:
        if branch_nos:
            placeholders = ", ".join("?" for _ in branch_nos)
            found = _exists(
                cursor,
                "SELECT TOP 1 1 FROM LOCATIONS l JOIN LOC_BRANCH lb ON lb.LOC_NO = l.LOC_NO "
                f"WHERE LOWER(LTRIM(RTRIM(l.DESCR))) = ? AND l.LOC_NO <> ? AND lb.BRANCH_NO IN ({placeholders})",
                (lowered, exclude_id, *branch_nos),
            )
        else:
            found = _exists(
                cursor,
                "SELECT TOP 1 1 FROM LOCATIONS l WHERE LOWER(LTRIM(RTRIM(l.DESCR))) = ? AND l.LOC_NO <> ? "
                "AND NOT EXISTS (SELECT 1 FROM LOC_BRANCH lb WHERE lb.LOC_NO = l.LOC_NO)",
                (lowered, exclude_id),
            )
    if found:
        raise ReferenceDataError("duplicate", "Запись с таким названием уже существует")


def _require_type(cursor: Any, type_no: int, ci_type: int) -> None:
    if not _exists(cursor, "SELECT 1 FROM CI_TYPES WHERE TYPE_NO = ? AND CI_TYPE = ?", (type_no, ci_type)):
        raise ReferenceDataError("invalid", "Тип не найден в выбранной категории")


def _require_vendor(cursor: Any, vendor_no: int) -> None:
    if not _exists(cursor, "SELECT 1 FROM VENDORS WHERE VENDOR_NO = ?", (vendor_no,)):
        raise ReferenceDataError("invalid", "Производитель не найден")


# --------------------------------------------------------------------------
# Create
# --------------------------------------------------------------------------

def create_reference(
    kind: str,
    payload: Dict[str, Any],
    db_id: Optional[str] = None,
    *,
    get_db_fn: Optional[Callable[[Optional[str]], Any]] = None,
) -> dict:
    _check_kind(kind)
    name = normalize_name(payload.get("name"))
    ci_type: Optional[int] = None
    type_no: Optional[int] = None
    vendor_no: Optional[int] = None
    branch_nos: List[int] = []
    if kind in ("types", "models"):
        ci_type = _ci_type(payload.get("ci_type", 1))
    if kind == "models":
        type_no = _to_int(payload.get("type_no"), "type_no")
        vendor_no = _to_int(payload.get("vendor_no"), "vendor_no", required=False)
    if kind == "locations":
        branch_nos = _parse_branch_nos(payload.get("branch_nos"))
        if not branch_nos:
            raise ReferenceDataError("invalid", "Укажите хотя бы один филиал для кабинета")

    db = _get_db(db_id, get_db_fn)
    with db.get_connection() as conn:
        cursor = conn.cursor()
        if kind == "vendors":
            new_no = _next_no(cursor, "VENDORS", "VENDOR_NO")
            _check_duplicate(cursor, kind, name, exclude_id=-1)
            cursor.execute("INSERT INTO VENDORS (VENDOR_NO, VENDOR_NAME) VALUES (?, ?)", (new_no, name))
        elif kind == "branches":
            new_no = _next_no(cursor, "BRANCHES", "BRANCH_NO")
            _check_duplicate(cursor, kind, name, exclude_id=-1)
            cursor.execute("INSERT INTO BRANCHES (BRANCH_NO, BRANCH_NAME) VALUES (?, ?)", (new_no, name))
        elif kind == "statuses":
            new_no = _next_no(cursor, "STATUS", "STATUS_NO")
            _check_duplicate(cursor, kind, name, exclude_id=-1)
            cursor.execute("INSERT INTO STATUS (STATUS_NO, DESCR) VALUES (?, ?)", (new_no, name))
        elif kind == "types":
            new_no = _next_no(cursor, "CI_TYPES", "TYPE_NO")
            if not _exists(cursor, "SELECT TOP 1 1 FROM CI_TYPES WHERE CI_TYPE = ?", (ci_type,)):
                raise ReferenceDataError("invalid", "Категория не найдена")
            _check_duplicate(cursor, kind, name, exclude_id=-1, ci_type=ci_type)
            cursor.execute(
                "INSERT INTO CI_TYPES (TYPE_NO, CI_TYPE, TYPE_NAME) VALUES (?, ?, ?)",
                (new_no, ci_type, name),
            )
        elif kind == "models":
            new_no = _next_no(cursor, "CI_MODELS", "MODEL_NO")
            _require_type(cursor, type_no, ci_type)
            if vendor_no is not None:
                _require_vendor(cursor, vendor_no)
            _check_duplicate(cursor, kind, name, exclude_id=-1, ci_type=ci_type, type_no=type_no)
            cursor.execute(
                "INSERT INTO CI_MODELS (MODEL_NO, CI_TYPE, TYPE_NO, MODEL_NAME, VENDOR_NO) VALUES (?, ?, ?, ?, ?)",
                (new_no, ci_type, type_no, name, vendor_no),
            )
        else:
            new_no = _next_no(cursor, "LOCATIONS", "LOC_NO")
            _require_branches(cursor, branch_nos)
            _check_duplicate(cursor, kind, name, exclude_id=-1, branch_nos=branch_nos)
            cursor.execute("INSERT INTO LOCATIONS (LOC_NO, DESCR) VALUES (?, ?)", (new_no, name))
            for branch_no in branch_nos:
                cursor.execute("INSERT INTO LOC_BRANCH (LOC_NO, BRANCH_NO) VALUES (?, ?)", (new_no, branch_no))
        return _read_row(cursor, kind, new_no, ci_type) or {"id": new_no, "name": name}


# --------------------------------------------------------------------------
# Update
# --------------------------------------------------------------------------

_UPDATE_FIELDS = {
    "vendors": ("name",),
    "branches": ("name",),
    "statuses": ("name",),
    "types": ("name",),
    "models": ("name", "type_no", "vendor_no"),
    "locations": ("name", "branch_nos"),
}

_NAME_UPDATE_SQL = {
    "vendors": "UPDATE VENDORS SET VENDOR_NAME = ? WHERE VENDOR_NO = ?",
    "branches": "UPDATE BRANCHES SET BRANCH_NAME = ? WHERE BRANCH_NO = ?",
    "statuses": "UPDATE STATUS SET DESCR = ? WHERE STATUS_NO = ?",
    "locations": "UPDATE LOCATIONS SET DESCR = ? WHERE LOC_NO = ?",
}

_TABLE_BY_KIND = {
    "vendors": "VENDORS",
    "branches": "BRANCHES",
    "statuses": "STATUS",
    "types": "CI_TYPES",
    "models": "CI_MODELS",
    "locations": "LOCATIONS",
}


def update_reference(
    kind: str,
    ref_id: Any,
    payload: Dict[str, Any],
    db_id: Optional[str] = None,
    *,
    ci_type: Any = None,
    get_db_fn: Optional[Callable[[Optional[str]], Any]] = None,
) -> dict:
    """Returns ``{"before": row, "after": row}`` so callers can log the change."""
    _check_kind(kind)
    number = _to_int(ref_id, "id")
    scoped_ci_type = _ci_type(ci_type if ci_type is not None else 1) if kind in ("types", "models") else None
    fields = {key: payload[key] for key in _UPDATE_FIELDS[kind] if key in payload}
    if not fields:
        raise ReferenceDataError("invalid", "Нет полей для изменения")
    new_name = normalize_name(fields["name"]) if "name" in fields else None

    db = _get_db(db_id, get_db_fn)
    with db.get_connection() as conn:
        cursor = conn.cursor()
        _lock_table(cursor, _TABLE_BY_KIND[kind])
        before = _read_row(cursor, kind, number, scoped_ci_type)
        if before is None:
            raise ReferenceDataError("not_found", "Запись не найдена")

        if kind == "models":
            target_type = before["type_no"]
            if "type_no" in fields:
                target_type = _to_int(fields["type_no"], "type_no")
                if target_type != before["type_no"]:
                    _require_type(cursor, target_type, scoped_ci_type)
                    if _usage(cursor, kind, number, scoped_ci_type):
                        raise ReferenceDataError(
                            "in_use", "Модель используется — сменить тип нельзя, иначе нарушится пара «тип–модель»"
                        )
            target_vendor = before["vendor_no"]
            if "vendor_no" in fields:
                target_vendor = _to_int(fields["vendor_no"], "vendor_no", required=False)
                if target_vendor is not None:
                    _require_vendor(cursor, target_vendor)
            target_name = new_name if new_name is not None else before["name"]
            _check_duplicate(cursor, kind, target_name, exclude_id=number, ci_type=scoped_ci_type, type_no=target_type)
            cursor.execute(
                "UPDATE CI_MODELS SET MODEL_NAME = ?, TYPE_NO = ?, VENDOR_NO = ? WHERE MODEL_NO = ? AND CI_TYPE = ?",
                (target_name, target_type, target_vendor, number, scoped_ci_type),
            )
        elif kind == "types":
            _check_duplicate(cursor, kind, new_name, exclude_id=number, ci_type=scoped_ci_type)
            cursor.execute(
                "UPDATE CI_TYPES SET TYPE_NAME = ? WHERE TYPE_NO = ? AND CI_TYPE = ?",
                (new_name, number, scoped_ci_type),
            )
        elif kind == "locations":
            current = list(before["branch_nos"])
            target = _parse_branch_nos(fields["branch_nos"]) if "branch_nos" in fields else current
            if "branch_nos" in fields:
                if not target:
                    raise ReferenceDataError("invalid", "У кабинета должен остаться хотя бы один филиал")
                _require_branches(cursor, target)
                for removed in sorted(set(current) - set(target)):
                    if _exists(
                        cursor,
                        "SELECT TOP 1 1 FROM ITEMS WHERE LOC_NO = ? AND BRANCH_NO = ?",
                        (number, removed),
                    ):
                        raise ReferenceDataError(
                            "in_use", f"Кабинет используется в филиале {removed} — отвязать его нельзя"
                        )
            target_name = new_name if new_name is not None else before["name"]
            _check_duplicate(cursor, kind, target_name, exclude_id=number, branch_nos=target)
            cursor.execute(_NAME_UPDATE_SQL["locations"], (target_name, number))
            for removed in sorted(set(current) - set(target)):
                cursor.execute("DELETE FROM LOC_BRANCH WHERE LOC_NO = ? AND BRANCH_NO = ?", (number, removed))
            for added in sorted(set(target) - set(current)):
                cursor.execute("INSERT INTO LOC_BRANCH (LOC_NO, BRANCH_NO) VALUES (?, ?)", (number, added))
        else:
            _check_duplicate(cursor, kind, new_name, exclude_id=number)
            cursor.execute(_NAME_UPDATE_SQL[kind], (new_name, number))

        after = _read_row(cursor, kind, number, scoped_ci_type)
    return {"before": before, "after": after}


# --------------------------------------------------------------------------
# Delete
# --------------------------------------------------------------------------

def delete_reference(
    kind: str,
    ref_id: Any,
    db_id: Optional[str] = None,
    *,
    ci_type: Any = None,
    get_db_fn: Optional[Callable[[Optional[str]], Any]] = None,
) -> dict:
    """Delete a row nobody references. Returns the deleted row."""
    _check_kind(kind)
    number = _to_int(ref_id, "id")
    scoped_ci_type = _ci_type(ci_type if ci_type is not None else 1) if kind in ("types", "models") else None

    db = _get_db(db_id, get_db_fn)
    with db.get_connection() as conn:
        cursor = conn.cursor()
        _lock_table(cursor, _TABLE_BY_KIND[kind])
        row = _read_row(cursor, kind, number, scoped_ci_type)
        if row is None:
            raise ReferenceDataError("not_found", "Запись не найдена")
        usage = _usage(cursor, kind, number, scoped_ci_type)
        if usage:
            raise ReferenceDataError("in_use", _usage_message(usage), usage=usage)

        if kind == "vendors":
            cursor.execute("DELETE FROM VENDORS WHERE VENDOR_NO = ?", (number,))
        elif kind == "branches":
            cursor.execute("DELETE FROM BRANCHES WHERE BRANCH_NO = ?", (number,))
        elif kind == "statuses":
            cursor.execute("DELETE FROM STATUS WHERE STATUS_NO = ?", (number,))
        elif kind == "types":
            cursor.execute("DELETE FROM CI_TYPES WHERE TYPE_NO = ? AND CI_TYPE = ?", (number, scoped_ci_type))
        elif kind == "models":
            cursor.execute("DELETE FROM CI_MODELS WHERE MODEL_NO = ? AND CI_TYPE = ?", (number, scoped_ci_type))
        else:
            cursor.execute("DELETE FROM LOC_BRANCH WHERE LOC_NO = ?", (number,))
            cursor.execute("DELETE FROM LOCATIONS WHERE LOC_NO = ?", (number,))
    return row
