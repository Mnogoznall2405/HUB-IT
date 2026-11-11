"""
Read-only owner/type/status/model reference queries for SQL Server inventory data.
"""
from __future__ import annotations

from typing import Any, Callable, List, Optional

from backend.database.connection import get_db as _default_get_db

QUERY_GET_ALL_EQUIPMENT_TYPES = """
    SELECT CI_TYPE, TYPE_NO, TYPE_NAME
    FROM CI_TYPES
    WHERE CI_TYPE IS NOT NULL AND TYPE_NO IS NOT NULL
    ORDER BY TYPE_NAME
"""

QUERY_GET_ALL_STATUSES = """
    SELECT STATUS_NO, DESCR as STATUS_NAME
    FROM STATUS
    ORDER BY DESCR
"""

QUERY_GET_STATUS_BY_NO = """
    SELECT
        s.STATUS_NO,
        s.DESCR as STATUS_NAME
    FROM STATUS s
    WHERE s.STATUS_NO = ?
"""

QUERY_GET_DEFAULT_STATUS_PREFERRED = """
    SELECT TOP 1 s.STATUS_NO
    FROM STATUS s
    WHERE LOWER(CAST(s.DESCR AS NVARCHAR(255))) LIKE N'%эксплуата%'
    ORDER BY s.STATUS_NO
"""

QUERY_GET_DEFAULT_STATUS_FALLBACK = """
    SELECT TOP 1 s.STATUS_NO
    FROM STATUS s
    ORDER BY s.STATUS_NO
"""

QUERY_GET_TYPE_BY_NO = """
    SELECT
        t.CI_TYPE,
        t.TYPE_NO,
        t.TYPE_NAME
    FROM CI_TYPES t
    WHERE t.CI_TYPE = ? AND t.TYPE_NO = ?
"""

QUERY_GET_MODELS_BY_TYPE = """
    SELECT
        m.MODEL_NO as model_no,
        m.MODEL_NAME as model_name,
        m.TYPE_NO as type_no,
        m.CI_TYPE as ci_type
    FROM CI_MODELS m
    WHERE m.CI_TYPE = ? AND m.TYPE_NO = ?
    ORDER BY m.MODEL_NAME
"""

QUERY_GET_MODEL_BY_NO = """
    SELECT
        m.CI_TYPE,
        m.TYPE_NO,
        m.MODEL_NO,
        m.MODEL_NAME
    FROM CI_MODELS m
    WHERE m.CI_TYPE = ? AND m.MODEL_NO = ?
"""

QUERY_GET_OWNER_BY_NO = """
    SELECT
        o.OWNER_NO,
        o.OWNER_DISPLAY_NAME,
        o.OWNER_DEPT
    FROM OWNERS o
    WHERE o.OWNER_NO = ?
"""

QUERY_GET_OWNER_EMAIL_BY_NO = """
    SELECT TOP 1 NULLIF(LTRIM(RTRIM(o.OWNER_EMAIL)), '') AS OWNER_EMAIL
    FROM OWNERS o
    WHERE o.OWNER_NO = ?
"""


def _get_db(db_id: Optional[str], get_db_fn: Optional[Callable[[Optional[str]], Any]]) -> Any:
    return (get_db_fn or _default_get_db)(db_id)


def get_all_equipment_types(
    db_id: Optional[str] = None,
    *,
    get_db_fn: Optional[Callable[[Optional[str]], Any]] = None,
) -> List[dict]:
    db = _get_db(db_id, get_db_fn)
    return db.execute_query(QUERY_GET_ALL_EQUIPMENT_TYPES)


def get_all_statuses(
    db_id: Optional[str] = None,
    *,
    get_db_fn: Optional[Callable[[Optional[str]], Any]] = None,
) -> List[dict]:
    db = _get_db(db_id, get_db_fn)
    rows = db.execute_query(QUERY_GET_ALL_STATUSES)
    return [
        {
            "status_no": row.get("status_no", row.get("STATUS_NO")),
            "status_name": row.get("status_name", row.get("STATUS_NAME")),
        }
        for row in rows
    ]


def get_status_by_no(
    status_no: int,
    db_id: Optional[str] = None,
    *,
    get_db_fn: Optional[Callable[[Optional[str]], Any]] = None,
) -> Optional[dict]:
    db = _get_db(db_id, get_db_fn)
    rows = db.execute_query(QUERY_GET_STATUS_BY_NO, (status_no,))
    return rows[0] if rows else None


def get_default_status_no(
    db_id: Optional[str] = None,
    *,
    get_db_fn: Optional[Callable[[Optional[str]], Any]] = None,
) -> Optional[int]:
    db = _get_db(db_id, get_db_fn)
    rows = db.execute_query(QUERY_GET_DEFAULT_STATUS_PREFERRED, ())
    if rows:
        value = rows[0].get("STATUS_NO") or rows[0].get("status_no")
        try:
            return int(value) if value is not None else None
        except (TypeError, ValueError):
            return None

    rows = db.execute_query(QUERY_GET_DEFAULT_STATUS_FALLBACK, ())
    if not rows:
        return None
    value = rows[0].get("STATUS_NO") or rows[0].get("status_no")
    try:
        return int(value) if value is not None else None
    except (TypeError, ValueError):
        return None


def get_type_by_no(
    type_no: int,
    db_id: Optional[str] = None,
    ci_type: int = 1,
    *,
    get_db_fn: Optional[Callable[[Optional[str]], Any]] = None,
) -> Optional[dict]:
    db = _get_db(db_id, get_db_fn)
    rows = db.execute_query(QUERY_GET_TYPE_BY_NO, (ci_type, type_no))
    return rows[0] if rows else None


def get_models_by_type(
    type_no: int,
    db_id: Optional[str] = None,
    ci_type: int = 1,
    *,
    get_db_fn: Optional[Callable[[Optional[str]], Any]] = None,
) -> List[dict]:
    db = _get_db(db_id, get_db_fn)
    return db.execute_query(QUERY_GET_MODELS_BY_TYPE, (ci_type, type_no))


def get_model_no_by_name(
    model_name: str,
    ci_type: int = 1,
    strict: bool = True,
    db_id: Optional[str] = None,
    *,
    get_db_fn: Optional[Callable[[Optional[str]], Any]] = None,
) -> Optional[int]:
    if not model_name:
        return None
    db = _get_db(db_id, get_db_fn)
    where_clause = "m.MODEL_NAME = ?" if strict else "m.MODEL_NAME LIKE ?"
    param = model_name if strict else f"%{model_name}%"
    query = f"""
        SELECT TOP 1 m.MODEL_NO
        FROM CI_MODELS m
        WHERE m.CI_TYPE = ? AND {where_clause}
        ORDER BY m.MODEL_NO
    """
    rows = db.execute_query(query, (ci_type, param))
    if not rows:
        return None
    value = rows[0].get("MODEL_NO") or rows[0].get("model_no")
    try:
        return int(value) if value is not None else None
    except (TypeError, ValueError):
        return None


def get_model_by_no(
    model_no: int,
    db_id: Optional[str] = None,
    ci_type: int = 1,
    *,
    get_db_fn: Optional[Callable[[Optional[str]], Any]] = None,
) -> Optional[dict]:
    db = _get_db(db_id, get_db_fn)
    rows = db.execute_query(QUERY_GET_MODEL_BY_NO, (ci_type, model_no))
    return rows[0] if rows else None


def get_owner_by_no(
    owner_no: int,
    db_id: Optional[str] = None,
    *,
    get_db_fn: Optional[Callable[[Optional[str]], Any]] = None,
) -> Optional[dict]:
    db = _get_db(db_id, get_db_fn)
    rows = db.execute_query(QUERY_GET_OWNER_BY_NO, (owner_no,))
    return rows[0] if rows else None


def get_owner_no_by_name(
    employee_name: str,
    strict: bool = True,
    db_id: Optional[str] = None,
    *,
    get_db_fn: Optional[Callable[[Optional[str]], Any]] = None,
) -> Optional[int]:
    if not employee_name:
        return None
    db = _get_db(db_id, get_db_fn)
    where_clause = "o.OWNER_DISPLAY_NAME = ?" if strict else "o.OWNER_DISPLAY_NAME LIKE ?"
    param = employee_name if strict else f"%{employee_name}%"
    query = f"""
        SELECT TOP 1 o.OWNER_NO
        FROM OWNERS o
        WHERE {where_clause}
        ORDER BY o.OWNER_NO
    """
    rows = db.execute_query(query, (param,))
    if not rows:
        return None
    value = rows[0].get("OWNER_NO") or rows[0].get("owner_no")
    try:
        return int(value) if value is not None else None
    except (TypeError, ValueError):
        return None


def get_owner_email_by_no(
    owner_no: int,
    db_id: Optional[str] = None,
    *,
    get_db_fn: Optional[Callable[[Optional[str]], Any]] = None,
) -> Optional[str]:
    db = _get_db(db_id, get_db_fn)
    rows = db.execute_query(QUERY_GET_OWNER_EMAIL_BY_NO, (owner_no,))
    if not rows:
        return None
    value = rows[0].get("OWNER_EMAIL") or rows[0].get("owner_email")
    if value is None:
        return None
    email = str(value).strip()
    return email or None
