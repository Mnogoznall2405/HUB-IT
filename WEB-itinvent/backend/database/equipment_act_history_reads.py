"""
Read-only equipment act and transfer history queries for SQL Server inventory data.
"""
from typing import Any, Callable, List, Optional

from backend.database.connection import get_db as _default_get_db


EquipmentLookup = Callable[[str, Optional[str]], Optional[dict]]


def _quote_sqlserver_identifier(identifier: Any) -> str:
    """Bracket-quote a SQL Server identifier; values must still use parameters."""
    normalized = str(identifier or "").strip()
    if not normalized or any(char in normalized for char in "\x00\r\n"):
        raise ValueError("Invalid SQL Server identifier")
    return f"[{normalized.replace(']', ']]')}]"


def _get_db(db_id: Optional[str], get_db_fn: Optional[Callable[[Optional[str]], Any]]) -> Any:
    return (get_db_fn or _default_get_db)(db_id)


def _get_equipment_by_inv(
    inv_no: str,
    db_id: Optional[str],
    equipment_by_inv_fn: Optional[EquipmentLookup],
) -> Optional[dict]:
    if equipment_by_inv_fn is not None:
        return equipment_by_inv_fn(inv_no, db_id)

    from backend.database.queries import get_equipment_by_inv as _default_get_equipment_by_inv

    return _default_get_equipment_by_inv(inv_no, db_id)


def _resolve_doc_type_names(
    type_nos: List[Any],
    db_id: Optional[str] = None,
    *,
    get_db_fn: Optional[Callable[[Optional[str]], Any]] = None,
) -> dict[int, str]:
    """
    Resolve DOCS.TYPE_NO -> readable type name from doc-type lookup tables.

    This function is defensive because DB snapshots may differ:
    it discovers candidate tables in INFORMATION_SCHEMA and tries each one.
    """
    normalized_type_nos: List[int] = []
    for raw in type_nos or []:
        try:
            value = int(raw)
        except (TypeError, ValueError):
            continue
        if value not in normalized_type_nos:
            normalized_type_nos.append(value)

    if not normalized_type_nos:
        return {}

    db = _get_db(db_id, get_db_fn)
    mapping: dict[int, str] = {}

    def _doc_label_score(label: str) -> int:
        text = str(label or "").strip().lower()
        if not text:
            return 0
        keywords = [
            "акт",
            "аннулир",
            "док",
            "перемещ",
            "передач",
            "прием",
            "наклад",
            "счет",
        ]
        return 1 if any(keyword in text for keyword in keywords) else 0

    def _query_table_mapping(
        *,
        table_name: str,
        type_column: str,
        name_column: str,
    ) -> dict[int, str]:
        if not table_name or not type_column or not name_column:
            return {}
        try:
            safe_table_name = _quote_sqlserver_identifier(table_name)
            safe_type_column = _quote_sqlserver_identifier(type_column)
            safe_name_column = _quote_sqlserver_identifier(name_column)
        except ValueError:
            return {}
        placeholders = ", ".join(["?"] * len(normalized_type_nos))
        query = f"""
            SELECT
                t.{safe_type_column} AS type_no,
                t.{safe_name_column} AS type_name
            FROM {safe_table_name} t
            WHERE t.{safe_type_column} IN ({placeholders})
        """
        try:
            rows = db.execute_query(query, tuple(sorted(normalized_type_nos)))
        except Exception:
            return {}

        result: dict[int, str] = {}
        for row in rows or []:
            try:
                type_no = int(row.get("type_no") or row.get("TYPE_NO"))
            except (TypeError, ValueError):
                continue
            type_name = str(row.get("type_name") or row.get("TYPE_NAME") or "").strip()
            if type_no in normalized_type_nos and type_name:
                result[type_no] = type_name
        return result

    # 1) Preferred source: FK from DOCS.TYPE_NO to dictionary table.
    fk_candidates: List[dict[str, str]] = []
    try:
        fk_rows = db.execute_query(
            """
            SELECT DISTINCT
                kcu2.TABLE_NAME AS ref_table,
                kcu2.COLUMN_NAME AS ref_column
            FROM INFORMATION_SCHEMA.REFERENTIAL_CONSTRAINTS rc
            INNER JOIN INFORMATION_SCHEMA.KEY_COLUMN_USAGE kcu1
                ON rc.CONSTRAINT_NAME = kcu1.CONSTRAINT_NAME
            INNER JOIN INFORMATION_SCHEMA.KEY_COLUMN_USAGE kcu2
                ON rc.UNIQUE_CONSTRAINT_NAME = kcu2.CONSTRAINT_NAME
               AND kcu1.ORDINAL_POSITION = kcu2.ORDINAL_POSITION
            WHERE kcu1.TABLE_NAME = 'DOCS'
              AND kcu1.COLUMN_NAME = 'TYPE_NO'
            """
        )
        for row in fk_rows or []:
            ref_table = str(row.get("ref_table") or row.get("REF_TABLE") or "").strip()
            ref_column = str(row.get("ref_column") or row.get("REF_COLUMN") or "").strip()
            if not ref_table or not ref_column:
                continue
            # Resolve preferred title column in referenced table.
            col_rows = db.execute_query(
                """
                SELECT
                    MAX(CASE WHEN c.COLUMN_NAME = 'TYPE_NAME' THEN 1 ELSE 0 END) AS has_type_name,
                    MAX(CASE WHEN c.COLUMN_NAME = 'DESCR' THEN 1 ELSE 0 END) AS has_descr
                FROM INFORMATION_SCHEMA.COLUMNS c
                WHERE c.TABLE_NAME = ?
                  AND c.COLUMN_NAME IN ('TYPE_NAME', 'DESCR')
                """,
                (ref_table,),
            )
            has_type_name = int((col_rows[0].get("has_type_name") or col_rows[0].get("HAS_TYPE_NAME") or 0)) == 1 if col_rows else False
            has_descr = int((col_rows[0].get("has_descr") or col_rows[0].get("HAS_DESCR") or 0)) == 1 if col_rows else False
            if not (has_type_name or has_descr):
                continue
            fk_candidates.append(
                {
                    "table_name": ref_table,
                    "type_column": ref_column,
                    "name_column": "TYPE_NAME" if has_type_name else "DESCR",
                }
            )
    except Exception:
        fk_candidates = []

    best_fk_mapping: dict[int, str] = {}
    best_fk_score = (-1, -1)
    for item in fk_candidates:
        candidate_mapping = _query_table_mapping(
            table_name=item["table_name"],
            type_column=item["type_column"],
            name_column=item["name_column"],
        )
        if not candidate_mapping:
            continue
        doc_hits = sum(_doc_label_score(value) for value in candidate_mapping.values())
        score = (doc_hits, len(candidate_mapping))
        if score > best_fk_score:
            best_fk_score = score
            best_fk_mapping = candidate_mapping

    # FK source is authoritative for document types.
    if best_fk_mapping:
        return best_fk_mapping

    # 2) Fallback source: only DOC* tables with TYPE_NO + TYPE_NAME/DESCR.
    candidate_tables: List[dict[str, Any]] = []
    try:
        table_rows = db.execute_query(
            """
            SELECT
                c.TABLE_NAME AS table_name,
                MAX(CASE WHEN c.COLUMN_NAME = 'TYPE_NO' THEN 1 ELSE 0 END) AS has_type_no,
                MAX(CASE WHEN c.COLUMN_NAME = 'TYPE_NAME' THEN 1 ELSE 0 END) AS has_type_name,
                MAX(CASE WHEN c.COLUMN_NAME = 'DESCR' THEN 1 ELSE 0 END) AS has_descr
            FROM INFORMATION_SCHEMA.COLUMNS c
            WHERE c.TABLE_NAME LIKE '%DOC%'
              AND c.COLUMN_NAME IN ('TYPE_NO', 'TYPE_NAME', 'DESCR')
            GROUP BY c.TABLE_NAME
            """
        )
        for row in table_rows or []:
            table_name = str(row.get("table_name") or row.get("TABLE_NAME") or "").strip()
            if not table_name or table_name.upper() in {"DOCS", "DOCS_LIST"}:
                continue
            has_type_no = int(row.get("has_type_no") or row.get("HAS_TYPE_NO") or 0) == 1
            has_type_name = int(row.get("has_type_name") or row.get("HAS_TYPE_NAME") or 0) == 1
            has_descr = int(row.get("has_descr") or row.get("HAS_DESCR") or 0) == 1
            if has_type_no and (has_type_name or has_descr):
                candidate_tables.append(
                    {
                        "table_name": table_name,
                        "name_column": "TYPE_NAME" if has_type_name else "DESCR",
                    }
                )
    except Exception:
        candidate_tables = []

    best_mapping: dict[int, str] = {}
    best_score = (-1, -1, -1)
    for item in candidate_tables:
        candidate_mapping = _query_table_mapping(
            table_name=str(item.get("table_name") or ""),
            type_column="TYPE_NO",
            name_column=str(item.get("name_column") or ""),
        )
        if not candidate_mapping:
            continue
        doc_hits = sum(_doc_label_score(value) for value in candidate_mapping.values())
        # Require at least one document-like label to avoid wrong dictionary.
        if doc_hits <= 0:
            continue
        table_name = str(item.get("table_name") or "").upper()
        doc_priority = 1 if table_name.startswith("DOC") else 0
        score = (doc_hits, len(candidate_mapping), doc_priority)
        if score > best_score:
            best_score = score
            best_mapping = candidate_mapping

    return best_mapping


def _act_document_filter_sql(*, doc_alias: str = "d") -> str:
    """SQL fragment for act/transfer documents (excludes annulled)."""
    number_col = f"LOWER(COALESCE({doc_alias}.DOC_NUMBER, N''))"
    addinfo_col = f"LOWER(COALESCE({doc_alias}.ADDINFO, N''))"
    return f"""
        (
            {number_col} LIKE N'%акт%'
            OR {addinfo_col} LIKE N'%акт%'
            OR {number_col} LIKE N'%перемещ%'
            OR {addinfo_col} LIKE N'%перемещ%'
        )
        AND {number_col} NOT LIKE N'%аннулир%'
        AND {addinfo_col} NOT LIKE N'%аннулир%'
    """


def search_equipment_acts(
    q: str,
    *,
    limit: int = 50,
    db_id: Optional[str] = None,
    get_db_fn: Optional[Callable[[Optional[str]], Any]] = None,
) -> dict:
    """
    Search act/transfer documents across DOCS linked to equipment items.

    Returns grouped documents with linked equipment rows.
    """
    query_text = str(q or "").strip()
    safe_limit = max(1, min(int(limit or 50), 50))
    if len(query_text) < 2:
        return {"query": query_text, "total": 0, "acts": [], "truncated": False}

    like_pattern = f"%{query_text.lower()}%"
    # Только номер акта и ФИО/фамилия сотрудника (не инв./серийный №).
    search_conditions = [
        "LOWER(COALESCE(d.DOC_NUMBER, N'')) LIKE ?",
        "LOWER(COALESCE(o.OWNER_DISPLAY_NAME, N'')) LIKE ?",
    ]
    params: List[Any] = [like_pattern, like_pattern]
    if query_text.isdigit():
        search_conditions.append("d.DOC_NO = ?")
        params.append(int(query_text))

    fetch_limit = safe_limit * 5
    act_filter = _act_document_filter_sql(doc_alias="d")
    sql = f"""
        SELECT TOP {fetch_limit}
            d.DOC_NO AS doc_no,
            d.DOC_NUMBER AS doc_number,
            d.DOC_DATE AS doc_date,
            d.TYPE_NO AS type_no,
            b.BRANCH_NAME AS branch_name,
            l.DESCR AS location_name,
            o.OWNER_DISPLAY_NAME AS employee_name,
            dl.ITEM_ID AS item_id,
            CAST(i.INV_NO AS VARCHAR(64)) AS inv_no,
            i.SERIAL_NO AS serial_no,
            m.MODEL_NAME AS model_name
        FROM DOCS d
        INNER JOIN DOCS_LIST dl ON dl.DOC_NO = d.DOC_NO
        INNER JOIN ITEMS i ON i.ID = dl.ITEM_ID AND i.CI_TYPE = 1
        LEFT JOIN CI_MODELS m ON m.CI_TYPE = i.CI_TYPE AND m.MODEL_NO = i.MODEL_NO
        LEFT JOIN BRANCHES b ON b.BRANCH_NO = d.BRANCH_NO
        LEFT JOIN LOCATIONS l ON l.LOC_NO = d.LOC_NO
        LEFT JOIN OWNERS o ON o.OWNER_NO = d.EMPL_NO
        WHERE (dl.CI_TYPE = 1 OR dl.CI_TYPE IS NULL)
          AND ({' OR '.join(search_conditions)})
          AND {act_filter}
        ORDER BY
            CASE WHEN d.DOC_DATE IS NULL THEN 1 ELSE 0 END,
            d.DOC_DATE DESC,
            d.DOC_NO DESC
    """

    db = _get_db(db_id, get_db_fn)
    rows = db.execute_query(sql, tuple(params))

    acts_map: dict[int, dict] = {}
    doc_order: List[int] = []
    for row in rows or []:
        try:
            doc_no = int(row.get("doc_no") or row.get("DOC_NO"))
        except (TypeError, ValueError):
            continue

        if doc_no not in acts_map:
            if len(doc_order) >= safe_limit:
                continue
            doc_order.append(doc_no)
            acts_map[doc_no] = {
                "doc_no": doc_no,
                "doc_number": str(row.get("doc_number") or row.get("DOC_NUMBER") or "").strip(),
                "doc_date": row.get("doc_date") or row.get("DOC_DATE"),
                "type_no": row.get("type_no") or row.get("TYPE_NO"),
                "branch_name": str(row.get("branch_name") or row.get("BRANCH_NAME") or "").strip(),
                "location_name": str(row.get("location_name") or row.get("LOCATION_NAME") or "").strip(),
                "employee_name": str(row.get("employee_name") or row.get("EMPLOYEE_NAME") or "").strip(),
                "items": [],
            }

        act_payload = acts_map.get(doc_no)
        if not act_payload:
            continue

        item_id_raw = row.get("item_id") or row.get("ITEM_ID")
        try:
            item_id = int(item_id_raw) if item_id_raw is not None else None
        except (TypeError, ValueError):
            item_id = None

        inv_no = str(row.get("inv_no") or row.get("INV_NO") or "").strip()
        serial_no = str(row.get("serial_no") or row.get("SERIAL_NO") or "").strip()
        model_name = str(row.get("model_name") or row.get("MODEL_NAME") or "").strip()
        existing_items = act_payload["items"]
        if item_id is not None and not any(item.get("item_id") == item_id for item in existing_items):
            existing_items.append(
                {
                    "item_id": item_id,
                    "inv_no": inv_no,
                    "serial_no": serial_no,
                    "model_name": model_name,
                }
            )

    acts_list = [acts_map[doc_no] for doc_no in doc_order if doc_no in acts_map]
    type_name_map = _resolve_doc_type_names(
        [act.get("type_no") or act.get("TYPE_NO") for act in acts_list],
        db_id=db_id,
        get_db_fn=get_db_fn,
    )
    for act in acts_list:
        raw_type_no = act.get("type_no") or act.get("TYPE_NO")
        try:
            type_no = int(raw_type_no) if raw_type_no is not None else None
        except (TypeError, ValueError):
            type_no = None
        if type_no is not None and type_no in type_name_map:
            act["type_name"] = type_name_map[type_no]
        else:
            act["type_name"] = ""

    file_doc_nos: set[int] = set()
    if doc_order:
        placeholders = ", ".join(["?"] * len(doc_order))
        try:
            file_rows = db.execute_query(
                f"""
                SELECT DISTINCT f.ITEM_ID AS doc_no
                FROM FILES f
                WHERE f.ITEM_ID IN ({placeholders})
                """,
                tuple(doc_order),
            )
        except Exception:
            file_rows = []
        for file_row in file_rows or []:
            try:
                file_doc_nos.add(int(file_row.get("doc_no") or file_row.get("DOC_NO")))
            except (TypeError, ValueError):
                continue

    for act in acts_list:
        act["has_file"] = act["doc_no"] in file_doc_nos

    truncated = len(doc_order) >= safe_limit and bool(rows)
    return {
        "query": query_text,
        "total": len(acts_list),
        "acts": acts_list,
        "truncated": truncated,
    }


def get_equipment_acts_by_inv(
    inv_no: str,
    db_id: Optional[str] = None,
    *,
    get_db_fn: Optional[Callable[[Optional[str]], Any]] = None,
    equipment_by_inv_fn: Optional[EquipmentLookup] = None,
) -> dict:
    """
    Get equipment-linked documents (acts) by inventory number.

    Link is resolved through DOCS_LIST.ITEM_ID -> DOCS.DOC_NO.
    """
    equipment = _get_equipment_by_inv(inv_no, db_id, equipment_by_inv_fn)
    if not equipment:
        return {"item_id": None, "acts": []}

    item_id_raw = equipment.get("id") or equipment.get("ID")
    try:
        item_id = int(item_id_raw) if item_id_raw is not None else None
    except (TypeError, ValueError):
        item_id = None

    if item_id is None:
        return {"item_id": None, "acts": []}

    db = _get_db(db_id, get_db_fn)
    query = """
        SELECT
            dl.ITEM_ID AS item_id,
            dl.CI_TYPE AS ci_type,
            d.DOC_NO AS doc_no,
            d.DOC_NUMBER AS doc_number,
            d.DOC_DATE AS doc_date,
            d.TYPE_NO AS type_no,
            d.COMP_NO AS comp_no,
            d.BRANCH_NO AS branch_no,
            b.BRANCH_NAME AS branch_name,
            d.LOC_NO AS loc_no,
            l.DESCR AS location_name,
            d.EMPL_NO AS empl_no,
            o.OWNER_DISPLAY_NAME AS employee_name,
            d.SUPPL_NO AS suppl_no,
            d.DOC_SUMM AS doc_summ,
            d.ADDINFO AS add_info,
            d.CREATE_DATE AS create_date,
            d.CREATE_USER_NAME AS create_user_name,
            d.CH_DATE AS ch_date,
            d.CH_USER AS ch_user
        FROM DOCS_LIST dl
        INNER JOIN DOCS d ON d.DOC_NO = dl.DOC_NO
        LEFT JOIN BRANCHES b ON b.BRANCH_NO = d.BRANCH_NO
        LEFT JOIN LOCATIONS l ON l.LOC_NO = d.LOC_NO
        LEFT JOIN OWNERS o ON o.OWNER_NO = d.EMPL_NO
        WHERE dl.ITEM_ID = ?
          AND (dl.CI_TYPE = 1 OR dl.CI_TYPE IS NULL)
        ORDER BY
            CASE WHEN d.DOC_DATE IS NULL THEN 1 ELSE 0 END,
            d.DOC_DATE DESC,
            d.CREATE_DATE DESC,
            d.DOC_NO DESC
    """
    acts = db.execute_query(query, (item_id,))
    type_name_map = _resolve_doc_type_names(
        [act.get("type_no") or act.get("TYPE_NO") for act in acts or []],
        db_id=db_id,
        get_db_fn=get_db_fn,
    )
    for act in acts or []:
        raw_type_no = act.get("type_no") or act.get("TYPE_NO")
        try:
            type_no = int(raw_type_no) if raw_type_no is not None else None
        except (TypeError, ValueError):
            type_no = None
        if type_no is not None and type_no in type_name_map:
            act["type_name"] = type_name_map[type_no]

    return {"item_id": item_id, "acts": acts}


def get_equipment_history_by_inv(
    inv_no: str,
    db_id: Optional[str] = None,
    *,
    get_db_fn: Optional[Callable[[Optional[str]], Any]] = None,
    equipment_by_inv_fn: Optional[EquipmentLookup] = None,
) -> dict:
    """
    Get transfer/change history for one equipment item by inventory number.

    CI_HISTORY is exposed through a normalized row shape so callers do not need
    to know legacy column names.
    """
    equipment = _get_equipment_by_inv(inv_no, db_id, equipment_by_inv_fn)
    if not equipment:
        return {"item_id": None, "history": []}

    item_id_raw = equipment.get("id") or equipment.get("ID")
    try:
        item_id = int(item_id_raw) if item_id_raw is not None else None
    except (TypeError, ValueError):
        item_id = None

    if item_id is None:
        return {"item_id": None, "history": []}

    query = """
        SELECT
            h.HIST_ID AS hist_id,
            h.ITEM_ID AS item_id,
            h.CH_DATE AS ch_date,
            h.CH_USER AS ch_user,
            h.CH_COMMENT AS ch_comment,
            h.EMPL_NO_OLD AS old_employee_no,
            old_owner.OWNER_DISPLAY_NAME AS old_employee_name,
            h.EMPL_NO_NEW AS new_employee_no,
            new_owner.OWNER_DISPLAY_NAME AS new_employee_name,
            h.BRANCH_NO_OLD AS old_branch_no,
            old_branch.BRANCH_NAME AS old_branch_name,
            h.BRANCH_NO_NEW AS new_branch_no,
            new_branch.BRANCH_NAME AS new_branch_name,
            h.LOC_NO_OLD AS old_loc_no,
            old_location.DESCR AS old_location_name,
            h.LOC_NO_NEW AS new_loc_no,
            new_location.DESCR AS new_location_name,
            h.STATUS_NO_OLD AS old_status_no,
            old_status.DESCR AS old_status_name,
            h.STATUS_NO_NEW AS new_status_no,
            new_status.DESCR AS new_status_name,
            h.SERIAL_NO_OLD AS old_serial_no,
            h.SERIAL_NO_NEW AS new_serial_no,
            h.INV_NO_OLD AS old_inv_no,
            h.INV_NO_NEW AS new_inv_no,
            h.TYPE_NO_OLD AS old_type_no,
            old_type.TYPE_NAME AS old_type_name,
            h.TYPE_NO_NEW AS new_type_no,
            new_type.TYPE_NAME AS new_type_name,
            h.MODEL_NO_OLD AS old_model_no,
            old_model.MODEL_NAME AS old_model_name,
            h.MODEL_NO_NEW AS new_model_no,
            new_model.MODEL_NAME AS new_model_name
        FROM CI_HISTORY h
        LEFT JOIN OWNERS old_owner ON old_owner.OWNER_NO = h.EMPL_NO_OLD
        LEFT JOIN OWNERS new_owner ON new_owner.OWNER_NO = h.EMPL_NO_NEW
        LEFT JOIN BRANCHES old_branch ON old_branch.BRANCH_NO = h.BRANCH_NO_OLD
        LEFT JOIN BRANCHES new_branch ON new_branch.BRANCH_NO = h.BRANCH_NO_NEW
        LEFT JOIN LOCATIONS old_location ON old_location.LOC_NO = h.LOC_NO_OLD
        LEFT JOIN LOCATIONS new_location ON new_location.LOC_NO = h.LOC_NO_NEW
        LEFT JOIN STATUS old_status ON old_status.STATUS_NO = h.STATUS_NO_OLD
        LEFT JOIN STATUS new_status ON new_status.STATUS_NO = h.STATUS_NO_NEW
        LEFT JOIN CI_TYPES old_type ON old_type.CI_TYPE = 1 AND old_type.TYPE_NO = h.TYPE_NO_OLD
        LEFT JOIN CI_TYPES new_type ON new_type.CI_TYPE = 1 AND new_type.TYPE_NO = h.TYPE_NO_NEW
        LEFT JOIN CI_MODELS old_model ON old_model.CI_TYPE = 1 AND old_model.MODEL_NO = h.MODEL_NO_OLD
        LEFT JOIN CI_MODELS new_model ON new_model.CI_TYPE = 1 AND new_model.MODEL_NO = h.MODEL_NO_NEW
        WHERE h.ITEM_ID = ?
        ORDER BY
            CASE WHEN h.CH_DATE IS NULL THEN 1 ELSE 0 END,
            h.CH_DATE DESC,
            h.HIST_ID DESC
    """
    db = _get_db(db_id, get_db_fn)
    return {"item_id": item_id, "history": db.execute_query(query, (item_id,))}
