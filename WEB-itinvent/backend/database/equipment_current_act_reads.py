"""Set-based lookup of the current downloadable act for equipment rows."""

from __future__ import annotations

import logging
from typing import Any, Callable, Iterable, Optional


logger = logging.getLogger(__name__)

_MAX_ITEM_IDS_PER_QUERY = 1800


def _read(row: dict, *keys: str) -> Any:
    for key in keys:
        value = row.get(key)
        if value is not None:
            return value
    return None


def _item_id(row: dict) -> Optional[int]:
    try:
        value = _read(row, "id", "ID", "item_id", "ITEM_ID")
        return int(value) if value is not None else None
    except (TypeError, ValueError):
        return None


def _chunks(values: list[int], size: int) -> Iterable[list[int]]:
    for offset in range(0, len(values), size):
        yield values[offset : offset + size]


def enrich_equipment_current_acts(
    equipment_rows: list[dict] | None,
    db_id: Optional[str] = None,
    *,
    get_db_fn: Callable[[Optional[str]], Any],
) -> list[dict]:
    """Attach the newest non-annulled act with a file for the current owner.

    One set-based query is used per SQL Server parameter chunk. A lookup
    failure is represented by ``current_act_available=None`` so the UI never
    mistakes an unavailable lookup for a confirmed missing act.
    """
    enriched = []
    item_ids: list[int] = []
    for source in equipment_rows or []:
        row = dict(source or {})
        row["current_act_available"] = None
        row["current_act_doc_no"] = None
        row["current_act_doc_number"] = None
        row["current_act_doc_date"] = None
        enriched.append(row)
        item_id = _item_id(row)
        if item_id is not None and item_id not in item_ids:
            item_ids.append(item_id)

    if not item_ids:
        return enriched

    acts_by_item_id: dict[int, dict] = {}
    try:
        db = get_db_fn(db_id)
        for item_id_chunk in _chunks(item_ids, _MAX_ITEM_IDS_PER_QUERY):
            placeholders = ", ".join("?" for _ in item_id_chunk)
            rows = db.execute_query(
                f"""
                WITH ranked_acts AS (
                    SELECT
                        dl.ITEM_ID AS item_id,
                        d.DOC_NO AS doc_no,
                        d.DOC_NUMBER AS doc_number,
                        d.DOC_DATE AS doc_date,
                        ROW_NUMBER() OVER (
                            PARTITION BY dl.ITEM_ID
                            ORDER BY
                                CASE WHEN d.DOC_DATE IS NULL THEN 1 ELSE 0 END,
                                d.DOC_DATE DESC,
                                d.CREATE_DATE DESC,
                                d.DOC_NO DESC
                        ) AS row_no
                    FROM DOCS_LIST dl
                    INNER JOIN ITEMS i
                        ON i.ID = dl.ITEM_ID
                       AND i.CI_TYPE = 1
                    INNER JOIN DOCS d
                        ON d.DOC_NO = dl.DOC_NO
                    LEFT JOIN OWNERS item_owner
                        ON item_owner.OWNER_NO = i.EMPL_NO
                    LEFT JOIN OWNERS document_owner
                        ON document_owner.OWNER_NO = d.EMPL_NO
                    -- Keep the latest real assignment to the current owner.
                    -- Model/location-only history rows must not reset act validity.
                    OUTER APPLY (
                        SELECT TOP 1
                            h.CH_DATE AS current_owner_since,
                            h.CH_COMMENT AS current_owner_comment
                        FROM CI_HISTORY h
                        WHERE h.ITEM_ID = dl.ITEM_ID
                          AND h.EMPL_NO_NEW = i.EMPL_NO
                          AND (
                              h.EMPL_NO_OLD IS NULL
                              OR h.EMPL_NO_OLD <> h.EMPL_NO_NEW
                          )
                        ORDER BY h.CH_DATE DESC
                    ) current_owner
                    WHERE dl.ITEM_ID IN ({placeholders})
                      AND (dl.CI_TYPE = 1 OR dl.CI_TYPE IS NULL)
                      AND i.EMPL_NO IS NOT NULL
                      AND (
                          d.EMPL_NO = i.EMPL_NO
                          OR (
                              -- Legacy syncs can duplicate an employee under a new
                              -- OWNER_NO. Keep this strict: exact normalized full name.
                              d.EMPL_NO IS NOT NULL
                              AND NULLIF(
                                  LTRIM(RTRIM(COALESCE(item_owner.OWNER_DISPLAY_NAME, N''))),
                                  N''
                              ) IS NOT NULL
                              AND LOWER(LTRIM(RTRIM(document_owner.OWNER_DISPLAY_NAME))) =
                                  LOWER(LTRIM(RTRIM(item_owner.OWNER_DISPLAY_NAME)))
                          )
                          OR (
                              -- Some uploaded legacy acts contain the recipient in
                              -- structured text but have a stale/template EMPL_NO.
                              -- Accept only a document for the current assignment where
                              -- the current surname is immediately on the recipient side.
                              d.EMPL_NO IS NOT NULL
                              AND current_owner.current_owner_since IS NOT NULL
                              AND CONVERT(DATE, d.DOC_DATE) >=
                                  CONVERT(DATE, current_owner.current_owner_since)
                              AND NULLIF(
                                  LTRIM(RTRIM(COALESCE(item_owner.OWNER_LNAME, N''))),
                                  N''
                              ) IS NOT NULL
                              AND (
                                  LOWER(LTRIM(COALESCE(d.ADDINFO, N''))) LIKE
                                      N'передача:%' + NCHAR(8594) + N' ' +
                                      LOWER(LTRIM(RTRIM(item_owner.OWNER_LNAME))) + N'%'
                                  OR LOWER(LTRIM(COALESCE(d.ADDINFO, N''))) LIKE
                                      N'передача:%-> ' +
                                      LOWER(LTRIM(RTRIM(item_owner.OWNER_LNAME))) + N'%'
                                  OR LOWER(LTRIM(COALESCE(d.ADDINFO, N''))) LIKE
                                      N'акт ' + CONVERT(NVARCHAR(32), d.DOC_NO) + N' % - ' +
                                      LOWER(LTRIM(RTRIM(item_owner.OWNER_LNAME))) + N'%'
                              )
                          )
                          OR (
                              d.EMPL_NO IS NULL
                              AND current_owner.current_owner_since IS NOT NULL
                              AND (
                                  -- Some legacy imports created DOCS before CI_HISTORY,
                                  -- but recorded the exact act number in the transfer comment.
                                  LOWER(LTRIM(COALESCE(current_owner.current_owner_comment, N''))) + N' '
                                      LIKE N'акт ' + CONVERT(NVARCHAR(32), d.DOC_NO) + N'[^0-9]%'
                                  OR LOWER(LTRIM(COALESCE(current_owner.current_owner_comment, N''))) + N' '
                                      LIKE N'акт №' + CONVERT(NVARCHAR(32), d.DOC_NO) + N'[^0-9]%'
                                  OR (
                                      -- A small set of old transfers wrote no history
                                      -- comment. Accept only a same-day document created
                                      -- immediately before assignment and naming the owner.
                                      d.CREATE_DATE < current_owner.current_owner_since
                                      AND d.CREATE_DATE >= DATEADD(
                                          MINUTE, -10, current_owner.current_owner_since
                                      )
                                      AND CONVERT(DATE, d.DOC_DATE) =
                                          CONVERT(DATE, current_owner.current_owner_since)
                                      AND NULLIF(
                                          LTRIM(RTRIM(COALESCE(item_owner.OWNER_LNAME, N''))),
                                          N''
                                      ) IS NOT NULL
                                      AND LOWER(COALESCE(d.ADDINFO, N'')) LIKE
                                          N'%' + LOWER(LTRIM(RTRIM(item_owner.OWNER_LNAME))) + N'%'
                                  )
                                  OR d.CREATE_DATE >= current_owner.current_owner_since
                              )
                          )
                      )
                      AND (
                          LOWER(COALESCE(d.DOC_NUMBER, N'')) LIKE N'%акт%'
                          OR LOWER(COALESCE(d.ADDINFO, N'')) LIKE N'%акт%'
                          OR LOWER(COALESCE(d.DOC_NUMBER, N'')) LIKE N'%перемещ%'
                          OR LOWER(COALESCE(d.ADDINFO, N'')) LIKE N'%перемещ%'
                      )
                      AND LOWER(COALESCE(d.DOC_NUMBER, N'')) NOT LIKE N'%аннулир%'
                      AND LOWER(COALESCE(d.ADDINFO, N'')) NOT LIKE N'%аннулир%'
                      AND EXISTS (
                          SELECT 1
                          FROM FILES f
                          WHERE f.ITEM_ID = d.DOC_NO
                      )
                )
                SELECT item_id, doc_no, doc_number, doc_date
                FROM ranked_acts
                WHERE row_no = 1
                """,
                tuple(item_id_chunk),
            )
            for act in rows or []:
                try:
                    item_id = int(_read(act, "item_id", "ITEM_ID"))
                except (TypeError, ValueError):
                    continue
                acts_by_item_id[item_id] = act
    except Exception:
        logger.warning(
            "Current equipment act lookup failed for db_id=%s item_count=%s",
            db_id,
            len(item_ids),
            exc_info=True,
        )
        return enriched

    for row in enriched:
        item_id = _item_id(row)
        if item_id is None:
            continue
        act = acts_by_item_id.get(item_id)
        row["current_act_available"] = act is not None
        if act is None:
            continue
        row["current_act_doc_no"] = _read(act, "doc_no", "DOC_NO")
        row["current_act_doc_number"] = _read(act, "doc_number", "DOC_NUMBER")
        row["current_act_doc_date"] = _read(act, "doc_date", "DOC_DATE")
    return enriched
