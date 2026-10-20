"""Read employee receipts/returns directly from the SQL Server audit trail."""
from datetime import date, datetime, time, timedelta
from typing import Optional

from backend.database.connection import get_db


def get_employee_history(
    owner_no: int,
    db_id: Optional[str] = None,
    *,
    date_from: Optional[date] = None,
    date_to: Optional[date] = None,
    direction: str = "all",
    q: str = "",
    page: int = 1,
    limit: int = 50,
) -> dict:
    # OWNER_NO is local to a database. Never resolve this read by display name
    # or by the employee's *current* ITEMS: returned equipment must remain visible.
    incoming = "(h.EMPL_NO_NEW = ? AND COALESCE(h.EMPL_NO_OLD, 0) <> ?)"
    outgoing = "(h.EMPL_NO_OLD = ? AND COALESCE(h.EMPL_NO_NEW, 0) <> ?)"
    if direction == "incoming":
        predicate, params = incoming, [owner_no, owner_no]
    elif direction == "outgoing":
        predicate, params = outgoing, [owner_no, owner_no]
    else:
        predicate, params = f"({incoming} OR {outgoing})", [owner_no] * 4
    if date_from:
        predicate += " AND h.CH_DATE >= ?"
        params.append(datetime.combine(date_from, time.min))
    if date_to:
        predicate += " AND h.CH_DATE < ?"
        params.append(datetime.combine(date_to + timedelta(days=1), time.min))

    # Event-side values are authoritative; the live card is only a fallback.
    side = "h.EMPL_NO_NEW = selected.owner_no"

    def event_value(column: str) -> str:
        return f"CASE WHEN {side} THEN h.{column}_NEW ELSE h.{column}_OLD END"

    cte = f"""
        WITH selected AS (SELECT CAST(? AS INTEGER) AS owner_no), events AS (
            SELECT h.HIST_ID AS hist_id, h.ITEM_ID AS item_id,
                h.CH_DATE AS ch_date, h.CH_USER AS ch_user, h.CH_COMMENT AS ch_comment,
                CASE WHEN {side} THEN 'incoming' ELSE 'outgoing' END AS direction,
                h.EMPL_NO_OLD AS old_employee_no, old_owner.OWNER_DISPLAY_NAME AS old_employee_name,
                h.EMPL_NO_NEW AS new_employee_no, new_owner.OWNER_DISPLAY_NAME AS new_employee_name,
                COALESCE(NULLIF(LTRIM(RTRIM({event_value('INV_NO')})), ''), i.INV_NO) AS inv_no,
                COALESCE(NULLIF(LTRIM(RTRIM({event_value('SERIAL_NO')})), ''), i.SERIAL_NO) AS serial_no,
                COALESCE(NULLIF(event_model.MODEL_NAME, ''), current_model.MODEL_NAME) AS model_name,
                COALESCE(NULLIF(event_type.TYPE_NAME, ''), current_type.TYPE_NAME) AS type_name,
                i.INV_NO AS current_inv_no,
                branch.BRANCH_NAME AS branch_name, location.DESCR AS location_name
            FROM CI_HISTORY h
            CROSS JOIN selected
            LEFT JOIN OWNERS old_owner ON old_owner.OWNER_NO = h.EMPL_NO_OLD
            LEFT JOIN OWNERS new_owner ON new_owner.OWNER_NO = h.EMPL_NO_NEW
            LEFT JOIN ITEMS i ON i.ID = h.ITEM_ID
            LEFT JOIN CI_MODELS event_model ON event_model.CI_TYPE = 1 AND event_model.MODEL_NO = {event_value('MODEL_NO')}
            LEFT JOIN CI_TYPES event_type ON event_type.CI_TYPE = 1 AND event_type.TYPE_NO = {event_value('TYPE_NO')}
            LEFT JOIN CI_MODELS current_model ON current_model.CI_TYPE = i.CI_TYPE AND current_model.MODEL_NO = i.MODEL_NO
            LEFT JOIN CI_TYPES current_type ON current_type.CI_TYPE = i.CI_TYPE AND current_type.TYPE_NO = i.TYPE_NO
            LEFT JOIN BRANCHES branch ON branch.BRANCH_NO = {event_value('BRANCH_NO')}
            LEFT JOIN LOCATIONS location ON location.LOC_NO = {event_value('LOC_NO')}
            WHERE {predicate}
        )
    """
    search = ""
    if q.strip():
        pattern = q.strip()
        for char in ("~", "%", "_", "["):
            pattern = pattern.replace(char, "~" + char)
        search = "WHERE (model_name LIKE ? ESCAPE '~' OR inv_no LIKE ? ESCAPE '~' OR serial_no LIKE ? ESCAPE '~')"
        params.extend([f"%{pattern}%"] * 3)

    db = get_db(db_id)
    params.insert(0, owner_no)
    totals = db.execute_query(cte + f"SELECT COUNT(*) AS total FROM events {search}", tuple(params))
    total = int(totals[0]["total"]) if totals else 0
    rows = db.execute_query(
        cte + f""", numbered AS (
            SELECT *, ROW_NUMBER() OVER (
                ORDER BY CASE WHEN ch_date IS NULL THEN 1 ELSE 0 END, ch_date DESC, hist_id DESC
            ) AS row_no FROM events {search}
        )
        SELECT * FROM numbered WHERE row_no > ? AND row_no <= ? ORDER BY row_no
        """,
        tuple(params + [(page - 1) * limit, page * limit]),
    )
    for row in rows:
        row.pop("row_no", None)
    return {"owner_no": owner_no, "history": rows, "total": total, "page": page, "limit": limit}
