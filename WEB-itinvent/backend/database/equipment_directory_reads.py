"""
Read-only branch/location directory queries for SQL Server inventory data.
"""
from typing import Any, Callable, List, Optional

from backend.database.connection import get_db as _default_get_db


QUERY_GET_ALL_BRANCHES = """
    SELECT BRANCH_NO, BRANCH_NAME
    FROM BRANCHES
    ORDER BY BRANCH_NAME
"""

QUERY_GET_ALL_LOCATIONS = """
    SELECT
        l.LOC_NO as LOC_NO,
        l.DESCR as LOC_NAME
    FROM LOCATIONS l
    WHERE l.LOC_NO IS NOT NULL
    ORDER BY l.DESCR, l.LOC_NO
"""

QUERY_GET_ALL_LOCATIONS_WITH_BRANCH_PRIORITY = """
    SELECT
        l.LOC_NO as LOC_NO,
        l.DESCR as LOC_NAME
    FROM LOCATIONS l
    WHERE l.LOC_NO IS NOT NULL
    ORDER BY
        CASE
            WHEN EXISTS (
                SELECT 1
                FROM ITEMS i
                WHERE i.BRANCH_NO = ?
                  AND i.LOC_NO = l.LOC_NO
            ) THEN 0
            ELSE 1
        END,
        l.DESCR,
        l.LOC_NO
"""

QUERY_GET_LOCATIONS_BY_BRANCH_COLUMN = """
    SELECT
        l.LOC_NO as LOC_NO,
        l.DESCR as LOC_NAME,
        l.BRANCH_NO as BRANCH_NO
    FROM LOCATIONS l
    WHERE l.LOC_NO IS NOT NULL
      AND l.BRANCH_NO = ?
    ORDER BY l.DESCR, l.LOC_NO
"""

QUERY_LOCATIONS_HAS_BRANCH_COLUMN = """
    SELECT TOP 1 1 as ok
    FROM INFORMATION_SCHEMA.COLUMNS
    WHERE TABLE_NAME = 'LOCATIONS'
      AND COLUMN_NAME = 'BRANCH_NO'
"""


def _get_db(db_id: Optional[str], get_db_fn: Optional[Callable[[Optional[str]], Any]]) -> Any:
    return (get_db_fn or _default_get_db)(db_id)


def locations_has_branch_column(
    db_id: Optional[str] = None,
    *,
    get_db_fn: Optional[Callable[[Optional[str]], Any]] = None,
) -> bool:
    """Return whether LOCATIONS has an explicit BRANCH_NO relation column."""
    db = _get_db(db_id, get_db_fn)
    try:
        return bool(db.execute_query(QUERY_LOCATIONS_HAS_BRANCH_COLUMN))
    except Exception:
        return False


def get_all_branches(
    db_id: Optional[str] = None,
    *,
    get_db_fn: Optional[Callable[[Optional[str]], Any]] = None,
) -> List[dict]:
    """Get all branches from database."""
    db = _get_db(db_id, get_db_fn)
    rows = db.execute_query(QUERY_GET_ALL_BRANCHES)
    return [
        {
            "id": row.get("id", row.get("BRANCH_NO")),
            "name": row.get("name", row.get("BRANCH_NAME")),
        }
        for row in rows
    ]


def get_locations_by_branch(
    branch_id: Any,
    db_id: Optional[str] = None,
    *,
    get_db_fn: Optional[Callable[[Optional[str]], Any]] = None,
) -> List[dict]:
    """
    Legacy compatibility wrapper.

    Historically locations were resolved through ITEMS for a selected branch.
    The canonical source is now the full LOCATIONS directory, with branch_id used
    only to prioritize locations already seen in ITEMS for that branch.
    """
    return get_all_locations(db_id, branch_no=branch_id, get_db_fn=get_db_fn)


def get_all_locations(
    db_id: Optional[str] = None,
    branch_no: Any = None,
    *,
    get_db_fn: Optional[Callable[[Optional[str]], Any]] = None,
) -> List[dict]:
    """Get the full location directory from LOCATIONS with optional branch priority."""
    db = _get_db(db_id, get_db_fn)
    normalized_branch = None if branch_no in (None, "", "null") else branch_no
    if normalized_branch is None:
        rows = db.execute_query(QUERY_GET_ALL_LOCATIONS)
    elif locations_has_branch_column(db_id, get_db_fn=get_db_fn):
        rows = db.execute_query(QUERY_GET_LOCATIONS_BY_BRANCH_COLUMN, (normalized_branch,))
    else:
        rows = db.execute_query(QUERY_GET_ALL_LOCATIONS_WITH_BRANCH_PRIORITY, (normalized_branch,))
    result = []
    for row in rows:
        item = {
            "loc_no": row.get("loc_no", row.get("LOC_NO")),
            "loc_name": row.get("loc_name", row.get("LOC_NAME")),
        }
        row_branch_no = row.get("branch_no", row.get("BRANCH_NO"))
        if row_branch_no is not None:
            item["branch_no"] = row_branch_no
        result.append(item)
    return result


def get_branch_by_no(
    branch_no: Any,
    db_id: Optional[str] = None,
    *,
    get_db_fn: Optional[Callable[[Optional[str]], Any]] = None,
) -> Optional[dict]:
    """Get branch by BRANCH_NO."""
    db = _get_db(db_id, get_db_fn)
    query = """
        SELECT
            b.BRANCH_NO,
            b.BRANCH_NAME
        FROM BRANCHES b
        WHERE b.BRANCH_NO = ?
    """
    rows = db.execute_query(query, (branch_no,))
    return rows[0] if rows else None


def get_location_by_no(
    loc_no: Any,
    db_id: Optional[str] = None,
    *,
    get_db_fn: Optional[Callable[[Optional[str]], Any]] = None,
) -> Optional[dict]:
    """Get location by LOC_NO."""
    db = _get_db(db_id, get_db_fn)
    query = """
        SELECT
            l.LOC_NO,
            l.DESCR as LOC_NAME
        FROM LOCATIONS l
        WHERE l.LOC_NO = ?
    """
    rows = db.execute_query(query, (loc_no,))
    return rows[0] if rows else None


def is_location_in_branch(
    loc_no: Any,
    branch_no: Any,
    db_id: Optional[str] = None,
    *,
    get_db_fn: Optional[Callable[[Optional[str]], Any]] = None,
) -> bool:
    """Validate LOCATIONS.BRANCH_NO when the schema supports branch-specific locations."""
    if loc_no in (None, "") or branch_no in (None, ""):
        return False
    if not locations_has_branch_column(db_id, get_db_fn=get_db_fn):
        return True

    db = _get_db(db_id, get_db_fn)
    rows = db.execute_query(
        """
        SELECT TOP 1 1 as ok
        FROM LOCATIONS l
        WHERE l.LOC_NO = ?
          AND l.BRANCH_NO = ?
        """,
        (loc_no, branch_no),
    )
    return bool(rows)
