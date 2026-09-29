"""Cross-database equipment transfer between ITINVENT SQL Server databases.

Moves an ITEMS row (CI_TYPE=1) into another database together with its core
history (CI_HISTORY, DOCS+DOCS_LIST, MOVES+MOVES_LIST, FILES, COMMENTS,
FIELDS_VALUES), then removes the item and its child rows from the source DB.
Dictionary references (owners, branches, locations, statuses, types, models,
vendors, suppliers, companies) are remapped by name and auto-created in the
target DB when missing — everything created is reported back.

The item always receives a fresh INV_NO in the target DB; the previous number
is kept in INV_NO_BUH and in a closing CI_HISTORY record.
"""
from __future__ import annotations

import logging
import re
from datetime import datetime
from typing import Any, Optional

from backend.database import queries
from backend.database.connection import get_db

logger = logging.getLogger(__name__)


def _norm(value: Any) -> str:
    return re.sub(r"\s+", " ", str(value or "").strip().lower())


def _text(value: Any) -> str:
    return str(value or "").strip()


def _num_text(value: Any) -> str:
    """Render float-ish numbers (INV_NO) without a trailing .0."""
    try:
        num = float(value)
    except (TypeError, ValueError):
        return _text(value)
    return str(int(num)) if num.is_integer() else str(num)


# ---------------------------------------------------------------------------
# Dictionary resolution helpers (id <-> name maps per database)
# ---------------------------------------------------------------------------

def _load_dicts(db, db_id: Optional[str] = None) -> dict[str, Any]:
    """Load dictionary id->name (source) structures needed for remapping."""
    def rows(sql):
        return db.execute_query(sql)

    return {
        "branch": {int(r["BRANCH_NO"]): r["BRANCH_NAME"] for r in rows("SELECT BRANCH_NO, BRANCH_NAME FROM BRANCHES") if r.get("BRANCH_NO") is not None},
        "location": {int(r["LOC_NO"]): r["DESCR"] for r in rows("SELECT LOC_NO, DESCR FROM LOCATIONS") if r.get("LOC_NO") is not None},
        "status": {int(r["STATUS_NO"]): r["DESCR"] for r in rows("SELECT STATUS_NO, DESCR FROM STATUS") if r.get("STATUS_NO") is not None},
        "type": {(int(r["TYPE_NO"]), int(r["CI_TYPE"])): r["TYPE_NAME"] for r in rows("SELECT TYPE_NO, CI_TYPE, TYPE_NAME FROM CI_TYPES") if r.get("TYPE_NO") is not None and r.get("CI_TYPE") is not None},
        "model": {(int(r["MODEL_NO"]), int(r["CI_TYPE"])): (r["MODEL_NAME"], r.get("TYPE_NO"), r.get("VENDOR_NO")) for r in rows("SELECT MODEL_NO, CI_TYPE, TYPE_NO, MODEL_NAME, VENDOR_NO FROM CI_MODELS") if r.get("MODEL_NO") is not None and r.get("CI_TYPE") is not None},
        "vendor": {int(r["VENDOR_NO"]): r["VENDOR_NAME"] for r in rows("SELECT VENDOR_NO, VENDOR_NAME FROM VENDORS") if r.get("VENDOR_NO") is not None},
        "supplier": {int(r["SUPPL_NO"]): r["SUPPL_NAME"] for r in rows("SELECT SUPPL_NO, SUPPL_NAME FROM SUPPLIERS") if r.get("SUPPL_NO") is not None},
        "company": {int(r["COMP_NO"]): r["COMP_NAME"] for r in rows("SELECT COMP_NO, COMP_NAME FROM COMPANY") if r.get("COMP_NO") is not None},
        "owner": {
            int(r["OWNER_NO"]): {
                "name": r.get("OWNER_DISPLAY_NAME") or " ".join(p for p in [r.get("OWNER_LNAME"), r.get("OWNER_FNAME"), r.get("OWNER_MNAME")] if p),
                "login": r.get("OWNER_LOGIN"),
            }
            for r in rows("SELECT OWNER_NO, OWNER_LNAME, OWNER_FNAME, OWNER_MNAME, OWNER_DISPLAY_NAME, OWNER_LOGIN FROM OWNERS")
            if r.get("OWNER_NO") is not None
        },
    }


def _build_name_index(id_to_name: dict[int, Any], key=str) -> dict[str, int]:
    """name -> id index for the target DB dictionaries."""
    index: dict[str, int] = {}
    for row_id, name in id_to_name.items():
        text = _norm(name if not isinstance(name, dict) else name.get("name"))
        if text and text not in index:
            index[text] = row_id
    return index


class _TargetDicts:
    """name -> target id resolver with auto-create; logs every creation."""

    def __init__(self, target_db, source_dicts: dict[str, Any], report_created: list[str]):
        self.db = target_db
        self.src = source_dicts
        self.created = report_created
        # target name->id indexes
        tgt = _load_dicts(target_db, "")
        self.branch_idx = _build_name_index(tgt["branch"])
        self.location_idx = _build_name_index(tgt["location"])
        self.status_idx = _build_name_index(tgt["status"])
        self.type_idx = {_norm(v): k for k, v in tgt["type"].items()}
        self.model_idx = {_norm(v[0]): k for k, v in tgt["model"].items()}
        self.vendor_idx = _build_name_index(tgt["vendor"])
        self.supplier_idx = _build_name_index(tgt["supplier"])
        self.company_idx = _build_name_index(tgt["company"])
        self.owner_by_login = {_norm(o.get("login")): k for k, o in tgt["owner"].items() if o.get("login")}
        self.owner_by_name = _build_name_index(tgt["owner"])

    def _next_id(self, cursor, table: str, col: str, where: str = "", params: tuple = ()) -> int:
        cursor.execute(f"SELECT ISNULL(MAX({col}), 0) + 1 FROM {table} WITH (TABLOCKX, HOLDLOCK) {where}", params)
        return int(cursor.fetchone()[0])

    def branch(self, source_id, cursor) -> Optional[int]:
        if not source_id:
            return None
        name = self.src["branch"].get(int(source_id))
        key = _norm(name)
        if not key:
            return None
        if key in self.branch_idx:
            return self.branch_idx[key]
        new_id = self._next_id(cursor, "BRANCHES", "BRANCH_NO")
        cursor.execute("INSERT INTO BRANCHES (BRANCH_NO, BRANCH_NAME) VALUES (?, ?)", (new_id, name))
        self.branch_idx[key] = new_id
        self.created.append(f"филиал «{name}» -> {new_id}")
        return new_id

    def location(self, source_id, cursor, branch_no: Optional[int] = None) -> Optional[int]:
        if not source_id:
            return None
        name = self.src["location"].get(int(source_id))
        key = _norm(name)
        if not key:
            return None
        if key in self.location_idx:
            return self.location_idx[key]
        new_id = self._next_id(cursor, "LOCATIONS", "LOC_NO")
        cursor.execute("INSERT INTO LOCATIONS (LOC_NO, DESCR) VALUES (?, ?)", (new_id, name))
        if branch_no:
            cursor.execute("INSERT INTO LOC_BRANCH (LOC_NO, BRANCH_NO) VALUES (?, ?)", (new_id, int(branch_no)))
        self.location_idx[key] = new_id
        self.created.append(f"локация «{name}» -> {new_id}")
        return new_id

    def status(self, source_id, cursor) -> Optional[int]:
        if not source_id:
            return None
        name = self.src["status"].get(int(source_id))
        key = _norm(name)
        if not key:
            return None
        if key in self.status_idx:
            return self.status_idx[key]
        new_id = self._next_id(cursor, "STATUS", "STATUS_NO")
        cursor.execute("INSERT INTO STATUS (STATUS_NO, DESCR) VALUES (?, ?)", (new_id, name))
        self.status_idx[key] = new_id
        self.created.append(f"статус «{name}» -> {new_id}")
        return new_id

    def ci_type(self, source_type_no, ci_type: int, cursor) -> Optional[int]:
        if source_type_no is None:
            return None
        name = self.src["type"].get((int(source_type_no), int(ci_type)))
        key = _norm(name)
        if not key:
            return None
        if key in self.type_idx:
            return int(self.type_idx[key][0])
        new_id = self._next_id(cursor, "CI_TYPES", "TYPE_NO", "WHERE CI_TYPE = ?", (int(ci_type),))
        cursor.execute("INSERT INTO CI_TYPES (TYPE_NO, CI_TYPE, TYPE_NAME) VALUES (?, ?, ?)", (new_id, int(ci_type), name))
        self.type_idx[key] = (new_id, int(ci_type))
        self.created.append(f"тип «{name}» -> {new_id} (ci_type={ci_type})")
        return new_id

    def vendor(self, source_id, cursor) -> Optional[int]:
        if not source_id:
            return None
        name = self.src["vendor"].get(int(source_id))
        key = _norm(name)
        if not key:
            return None
        if key in self.vendor_idx:
            return self.vendor_idx[key]
        new_id = self._next_id(cursor, "VENDORS", "VENDOR_NO")
        cursor.execute("INSERT INTO VENDORS (VENDOR_NO, VENDOR_NAME) VALUES (?, ?)", (new_id, name))
        self.vendor_idx[key] = new_id
        self.created.append(f"производитель «{name}» -> {new_id}")
        return new_id

    def model(self, source_model_no, ci_type: int, cursor, type_no: Optional[int]) -> Optional[int]:
        if source_model_no is None:
            return None
        entry = self.src["model"].get((int(source_model_no), int(ci_type)))
        if not entry:
            return None
        name, src_type_no, src_vendor_no = entry
        key = _norm(name)
        if not key:
            return None
        if key in self.model_idx:
            return int(self.model_idx[key][0])
        vendor_no = self.vendor(src_vendor_no, cursor)
        if type_no is None and src_type_no is not None:
            type_no = self.ci_type(src_type_no, int(ci_type), cursor)
        new_id = self._next_id(cursor, "CI_MODELS", "MODEL_NO", "WHERE CI_TYPE = ?", (int(ci_type),))
        cursor.execute(
            "INSERT INTO CI_MODELS (MODEL_NO, CI_TYPE, TYPE_NO, MODEL_NAME, VENDOR_NO) VALUES (?, ?, ?, ?, ?)",
            (new_id, int(ci_type), type_no, name, vendor_no),
        )
        self.model_idx[key] = (new_id, int(ci_type))
        self.created.append(f"модель «{name}» -> {new_id} (ci_type={ci_type})")
        return new_id

    def supplier(self, source_id, cursor) -> Optional[int]:
        if not source_id:
            return None
        name = self.src["supplier"].get(int(source_id))
        key = _norm(name)
        if not key:
            return None
        if key in self.supplier_idx:
            return self.supplier_idx[key]
        new_id = self._next_id(cursor, "SUPPLIERS", "SUPPL_NO")
        cursor.execute("INSERT INTO SUPPLIERS (SUPPL_NO, SUPPL_NAME) VALUES (?, ?)", (new_id, name))
        self.supplier_idx[key] = new_id
        self.created.append(f"поставщик «{name}» -> {new_id}")
        return new_id

    def company(self, source_id, cursor) -> Optional[int]:
        if not source_id:
            return None
        name = self.src["company"].get(int(source_id))
        key = _norm(name)
        if not key:
            return None
        if key in self.company_idx:
            return self.company_idx[key]
        new_id = self._next_id(cursor, "COMPANY", "COMP_NO")
        cursor.execute("INSERT INTO COMPANY (COMP_NO, COMP_NAME) VALUES (?, ?)", (new_id, name))
        self.company_idx[key] = new_id
        self.created.append(f"компания «{name}» -> {new_id}")
        return new_id

    def owner(self, source_id, cursor) -> Optional[int]:
        """Resolve owner by login -> display name -> create."""
        if not source_id:
            return None
        info = self.src["owner"].get(int(source_id))
        if not info:
            return None
        login_key = _norm(info.get("login"))
        if login_key and login_key in self.owner_by_login:
            return self.owner_by_login[login_key]
        name_key = _norm(info.get("name"))
        if name_key and name_key in self.owner_by_name:
            return self.owner_by_name[name_key]
        name = _text(info.get("name"))
        if not name:
            return None
        new_id = self._next_id(cursor, "OWNERS", "OWNER_NO")
        lname, fname, mname = queries._parse_fio(name)
        cursor.execute(
            """INSERT INTO OWNERS (OWNER_NO, OWNER_LNAME, OWNER_FNAME, OWNER_MNAME,
                                   OWNER_DISPLAY_NAME, OWNER_DEPT)
               VALUES (?, ?, ?, ?, ?, ?)""",
            (new_id, lname, fname, mname, name, ""),
        )
        self.owner_by_name[name_key] = new_id
        if login_key:
            self.owner_by_login[login_key] = new_id
        self.created.append(f"сотрудник «{name}» -> {new_id}")
        return new_id


# ---------------------------------------------------------------------------
# Item + history copy
# ---------------------------------------------------------------------------

_ITEM_TABLE = "ITEMS"

# child tables copied to the target DB: (table, item_fk_col, pk_col)
# CARTRIGES_REPLACES is intentionally excluded — its NOT NULL CARTRIGE_ITEM_ID
# points at cartridge items that stay in the source DB.
_COPY_TABLES = (
    ("CI_HISTORY", "ITEM_ID", "HIST_ID"),
    ("FILES", "ITEM_ID", "FILE_NO"),
    ("COMMENTS", "ITEM_ID", "COMMENT_NO"),
    ("FIELDS_VALUES", "ITEM_ID", None),
    ("DEV_SERVICE", "ITEM_ID", "SERVICE_NO"),
)

# child rows deleted from the source DB (incl. ones we do not copy)
_DELETE_TABLES = (
    ("CI_HISTORY", "ITEM_ID"),
    ("DOCS_LIST", "ITEM_ID"),
    ("MOVES_LIST", "ITEM_ID"),
    ("FILES", "ITEM_ID"),
    ("COMMENTS", "ITEM_ID"),
    ("FIELDS_VALUES", "ITEM_ID"),
    ("FIELDS", "ITEM_NO"),
    ("FIELDS_LINKS", "ITEM_NO"),
    ("CARTRIGES_REPLACES", "ITEM_ID"),
    ("DEV_SERVICE", "ITEM_ID"),
    ("INVENT_LIST", "ITEM_ID"),
    ("TASKS_LIST", "ITEM_ID"),
    ("JOBS_LIST", "ITEM_ID"),
)

# tables whose rows are counted only for the report (deleted, not copied)
_SUMMARY_TABLES = (
    ("INVENT_LIST", "ITEM_ID", "инвентаризационные ведомости"),
    ("TASKS_LIST", "ITEM_ID", "задачи"),
    ("JOBS_LIST", "ITEM_ID", "задания"),
    ("CARTRIGES_REPLACES", "ITEM_ID", "замены картриджей"),
)

# CI_HISTORY columns remapped through dictionaries. Order matters: branches are
# resolved before locations so a created location can be linked to its branch.
_HIST_REMAP = (
    ("EMPL_NO_OLD", "EMPL_NO_NEW", "owner"),
    ("BRANCH_NO_OLD", "BRANCH_NO_NEW", "branch"),
    ("LOC_NO_OLD", "LOC_NO_NEW", "location"),
    ("STATUS_NO_OLD", "STATUS_NO_NEW", "status"),
    ("COMP_NO_OLD", "COMP_NO_NEW", "company"),
    ("SUPPL_NO_OLD", "SUPPL_NO_NEW", "supplier"),
    ("SERVICE_SUPPL_NO_OLD", "SERVICE_SUPPL_NO_NEW", "supplier"),
    ("TYPE_NO_OLD", "TYPE_NO_NEW", "type"),
    ("MODEL_NO_OLD", "MODEL_NO_NEW", "model"),
)


def _table_columns(db, table: str) -> list[str]:
    rows = db.execute_query(
        "SELECT COLUMN_NAME FROM INFORMATION_SCHEMA.COLUMNS WHERE TABLE_NAME = ? ORDER BY ORDINAL_POSITION",
        (table,),
    )
    return [r["COLUMN_NAME"] for r in rows]


def _remap_hist_value(resolver, kind: str, source_id, cursor, item_ctx: dict[str, Any]):
    if source_id in (None, 0):
        return None
    try:
        sid = int(source_id)
    except (TypeError, ValueError):
        return None
    ci_type = int(item_ctx.get("ci_type") or 1)
    if kind == "owner":
        return resolver.owner(sid, cursor)
    if kind == "branch":
        return resolver.branch(sid, cursor)
    if kind == "location":
        return resolver.location(sid, cursor, branch_no=item_ctx.get("branch_no"))
    if kind == "status":
        return resolver.status(sid, cursor)
    if kind == "company":
        return resolver.company(sid, cursor)
    if kind == "supplier":
        return resolver.supplier(sid, cursor)
    if kind == "type":
        return resolver.ci_type(sid, ci_type, cursor)
    if kind == "model":
        return resolver.model(sid, ci_type, cursor, type_no=None)
    return None


def _copy_generic_children(src_db, tgt_cursor, resolver, table, item_col, pk_col, old_item_id, new_item_id, columns, fallbacks=None):
    rows = src_db.execute_query(f"SELECT * FROM {table} WHERE {item_col} = ?", (old_item_id,))
    copied = 0
    for row in rows:
        values = []
        for col in columns:
            val = row.get(col)
            if col == item_col:
                val = new_item_id
            elif pk_col and col == pk_col:
                val = resolver._next_id(tgt_cursor, table, pk_col)
            elif table == "DEV_SERVICE" and col == "SERVICE_SUPPL_NO":
                val = _remap_hist_value(resolver, "supplier", val, tgt_cursor, {})
            values.append(val)
        # remap CI_HISTORY dictionary columns (branch first, then locations are
        # linked to their remapped branch); *_NEW columns are NOT NULL so an
        # unresolvable source reference falls back to the item's target values.
        if table == "CI_HISTORY":
            remapped_vals: dict[str, Any] = {}
            for old_col, new_col, kind in _HIST_REMAP:
                for col, ci_col in ((old_col, "CI_TYPE_OLD"), (new_col, "CI_TYPE_NEW")):
                    if col not in columns:
                        continue
                    idx = columns.index(col)
                    ci_val = values[columns.index(ci_col)] if ci_col in columns else 1
                    ctx: dict[str, Any] = {"ci_type": ci_val}
                    if kind == "location":
                        br_col = "BRANCH_NO_OLD" if col == old_col else "BRANCH_NO_NEW"
                        ctx["branch_no"] = remapped_vals.get(br_col)
                    new_val = _remap_hist_value(resolver, kind, values[idx], tgt_cursor, ctx)
                    if new_val is None and col.endswith("_NEW") and fallbacks and col in fallbacks:
                        new_val = fallbacks[col]
                    values[idx] = new_val
                    remapped_vals[col] = new_val
        placeholders = ", ".join("?" * len(columns))
        tgt_cursor.execute(f"INSERT INTO {table} ({', '.join(columns)}) VALUES ({placeholders})", tuple(values))
        copied += 1
    return copied


def _copy_docs(src_db, tgt_cursor, resolver, old_item_id, new_item_id, docs_cols, docs_list_cols):
    """Copy DOCS headers that reference the item via DOCS_LIST + their lines."""
    docs_rows = src_db.execute_query(
        """SELECT DISTINCT d.* FROM DOCS d
           JOIN DOCS_LIST dl ON dl.DOC_NO = d.DOC_NO
           WHERE dl.ITEM_ID = ?""",
        (old_item_id,),
    )
    copied_docs = 0
    for doc in docs_rows:
        new_doc_no = resolver._next_id(tgt_cursor, "DOCS", "DOC_NO")
        remapped_branch = None
        values = []
        for col in docs_cols:
            val = doc.get(col)
            if col == "DOC_NO":
                val = new_doc_no
            elif col == "EMPL_NO":
                val = _remap_hist_value(resolver, "owner", val, tgt_cursor, {})
            elif col == "BRANCH_NO":
                val = _remap_hist_value(resolver, "branch", val, tgt_cursor, {})
                remapped_branch = val
            elif col == "LOC_NO":
                val = _remap_hist_value(resolver, "location", val, tgt_cursor, {"branch_no": remapped_branch})
            elif col == "COMP_NO":
                val = _remap_hist_value(resolver, "company", val, tgt_cursor, {})
            elif col == "SUPPL_NO":
                val = _remap_hist_value(resolver, "supplier", val, tgt_cursor, {})
            values.append(val)
        tgt_cursor.execute(
            f"INSERT INTO DOCS ({', '.join(docs_cols)}) VALUES ({', '.join('?' * len(docs_cols))})",
            tuple(values),
        )
        copied_docs += 1
        # copy all lines of this act that point at our item
        lines = src_db.execute_query("SELECT * FROM DOCS_LIST WHERE DOC_NO = ? AND ITEM_ID = ?", (doc["DOC_NO"], old_item_id))
        for line in lines:
            vals = []
            for col in docs_list_cols:
                v = line.get(col)
                if col == "DOC_NO":
                    v = new_doc_no
                elif col == "ITEM_ID":
                    v = new_item_id
                vals.append(v)
            tgt_cursor.execute(
                f"INSERT INTO DOCS_LIST ({', '.join(docs_list_cols)}) VALUES ({', '.join('?' * len(docs_list_cols))})",
                tuple(vals),
            )
    return copied_docs


def _copy_moves(src_db, tgt_cursor, resolver, old_item_id, new_item_id, moves_cols, moves_list_cols):
    moves_rows = src_db.execute_query(
        """SELECT DISTINCT m.* FROM MOVES m
           JOIN MOVES_LIST ml ON ml.MOVE_NO = m.MOVE_NO
           WHERE ml.ITEM_ID = ?""",
        (old_item_id,),
    )
    copied = 0
    for move in moves_rows:
        new_move_no = resolver._next_id(tgt_cursor, "MOVES", "MOVE_NO")
        values = []
        for col in moves_cols:
            val = move.get(col)
            if col == "MOVE_NO":
                val = new_move_no
            elif col in ("SOURCE_BRANCH_NO", "TARGET_BRANCH_NO"):
                val = _remap_hist_value(resolver, "branch", val, tgt_cursor, {})
            values.append(val)
        tgt_cursor.execute(
            f"INSERT INTO MOVES ({', '.join(moves_cols)}) VALUES ({', '.join('?' * len(moves_cols))})",
            tuple(values),
        )
        copied += 1
        lines = src_db.execute_query("SELECT * FROM MOVES_LIST WHERE MOVE_NO = ? AND ITEM_ID = ?", (move["MOVE_NO"], old_item_id))
        for line in lines:
            vals = []
            for col in moves_list_cols:
                v = line.get(col)
                if col == "MOVE_NO":
                    v = new_move_no
                elif col == "ITEM_ID":
                    v = new_item_id
                vals.append(v)
            tgt_cursor.execute(
                f"INSERT INTO MOVES_LIST ({', '.join(moves_list_cols)}) VALUES ({', '.join('?' * len(moves_list_cols))})",
                tuple(vals),
            )
    return copied


def _insert_transfer_act(tgt_cursor, resolver, item_ids: list[int], *, source_db_id, old_inv_map, changed_by, owner_no, branch_no, loc_no):
    """Create a receipt act (DOCS + DOCS_LIST) in the target DB."""
    # doc type heuristic: reuse the most recent non-annulled act type
    tgt_cursor.execute(
        """SELECT TOP 1 d.TYPE_NO FROM DOCS d
           WHERE d.TYPE_NO IS NOT NULL
             AND (LOWER(COALESCE(d.DOC_NUMBER, N'')) LIKE N'%акт%' OR LOWER(COALESCE(d.ADDINFO, N'')) LIKE N'%акт%')
             AND LOWER(COALESCE(d.DOC_NUMBER, N'')) NOT LIKE N'%аннулир%'
             AND LOWER(COALESCE(d.ADDINFO, N'')) NOT LIKE N'%аннулир%'
           ORDER BY CASE WHEN d.DOC_DATE IS NULL THEN 1 ELSE 0 END, d.DOC_DATE DESC, d.DOC_NO DESC"""
    )
    row = tgt_cursor.fetchone()
    type_no = int(row[0]) if row and row[0] is not None else 0
    new_doc_no = resolver._next_id(tgt_cursor, "DOCS", "DOC_NO")
    now = datetime.now()
    old_invs = ", ".join(str(v) for v in old_inv_map.values() if v is not None) or "-"
    addinfo = f"Перенос из базы {source_db_id}. Старые инв. №: {old_invs}"
    tgt_cursor.execute(
        """INSERT INTO DOCS (DOC_NO, TYPE_NO, COMP_NO, BRANCH_NO, LOC_NO, EMPL_NO, SUPPL_NO,
                              DOC_NUMBER, DOC_DATE, DOC_SUMM, ADDINFO, CREATE_DATE, CREATE_USER_NAME, CH_DATE, CH_USER)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)""",
        (new_doc_no, type_no, 0, branch_no, loc_no, owner_no, None,
         f"Акт переноса {new_doc_no}", now, 0, addinfo, now, changed_by, now, changed_by),
    )
    for item_id in item_ids:
        tgt_cursor.execute("INSERT INTO DOCS_LIST (DOC_NO, ITEM_ID, CI_TYPE) VALUES (?, ?, 1)", (new_doc_no, item_id))
    return new_doc_no


def transfer_items_to_db(
    *,
    source_db_id: str,
    target_db_id: str,
    inv_nos: list[Any],
    target_owner_no: Optional[int] = None,
    target_owner_name: Optional[str] = None,
    target_owner_dept: Optional[str] = None,
    target_branch_no: Optional[int] = None,
    target_loc_no: Optional[int] = None,
    changed_by: str = "IT-WEB",
) -> dict[str, Any]:
    """Transfer equipment items to another ITINVENT database with history."""
    src_db = get_db(source_db_id)
    tgt_db = get_db(target_db_id)
    report: dict[str, Any] = {
        "source_db": source_db_id,
        "target_db": target_db_id,
        "created_refs": [],
        "items": [],
        "errors": [],
    }

    source_dicts = _load_dicts(src_db, source_db_id)
    resolver = _TargetDicts(tgt_db, source_dicts, report["created_refs"])

    item_cols = _table_columns(src_db, _ITEM_TABLE)
    hist_cols = _table_columns(src_db, "CI_HISTORY")
    files_cols = _table_columns(src_db, "FILES")
    comments_cols = _table_columns(src_db, "COMMENTS")
    fields_vals_cols = _table_columns(src_db, "FIELDS_VALUES")
    devsvc_cols = _table_columns(src_db, "DEV_SERVICE")
    docs_cols = _table_columns(src_db, "DOCS")
    docs_list_cols = _table_columns(src_db, "DOCS_LIST")
    moves_cols = _table_columns(src_db, "MOVES")
    moves_list_cols = _table_columns(src_db, "MOVES_LIST")

    col_specs = {
        "CI_HISTORY": hist_cols,
        "FILES": files_cols,
        "COMMENTS": comments_cols,
        "FIELDS_VALUES": fields_vals_cols,
        "DEV_SERVICE": devsvc_cols,
    }

    # resolve target owner once (explicit pick or create by name)
    with tgt_db.get_connection() as conn:
        cur = conn.cursor()
        resolved_owner_no = target_owner_no
        if resolved_owner_no is None and target_owner_name:
            resolved_owner_no = resolver.owner_by_name.get(_norm(target_owner_name))
            if resolved_owner_no is None:
                new_owner_no = resolver._next_id(cur, "OWNERS", "OWNER_NO")
                lname, fname, mname = queries._parse_fio(_text(target_owner_name))
                cur.execute(
                    """INSERT INTO OWNERS (OWNER_NO, OWNER_LNAME, OWNER_FNAME, OWNER_MNAME,
                                           OWNER_DISPLAY_NAME, OWNER_DEPT)
                       VALUES (?, ?, ?, ?, ?, ?)""",
                    (new_owner_no, lname, fname, mname, _text(target_owner_name), _text(target_owner_dept)),
                )
                resolver.owner_by_name[_norm(target_owner_name)] = new_owner_no
                report["created_refs"].append(f"сотрудник «{target_owner_name}» -> {new_owner_no}")
                resolved_owner_no = new_owner_no
    report["resolved_owner_no"] = resolved_owner_no

    new_item_ids: list[int] = []
    old_inv_map: dict[int, Any] = {}

    for raw_inv in inv_nos:
        item_result: dict[str, Any] = {"inv_no": raw_inv, "status": "pending"}
        try:
            try:
                inv_float = float(str(raw_inv).strip())
            except (TypeError, ValueError):
                item_result.update(status="error", message="некорректный инвентарный номер")
                report["items"].append(item_result)
                continue
            row = src_db.execute_query("SELECT * FROM ITEMS WHERE CI_TYPE = 1 AND INV_NO = ?", (inv_float,))
            if not row:
                item_result.update(status="error", message="предмет не найден в исходной базе")
                report["items"].append(item_result)
                continue
            item = dict(row[0])
            old_id = int(item["ID"])
            item_result["old_item_id"] = old_id
            item_result["inv_no_old"] = item.get("INV_NO")

            # duplicate guard: same serial + model name already in target
            serial = _norm(item.get("SERIAL_NO"))
            item_ci_type = int(item.get("CI_TYPE") or 1)
            model_entry = source_dicts["model"].get((int(item.get("MODEL_NO") or 0), item_ci_type))
            model_name = _norm(model_entry[0] if model_entry else "")
            if serial:
                dup = tgt_db.execute_query(
                    """SELECT i.ID FROM ITEMS i
                       LEFT JOIN CI_MODELS m ON i.MODEL_NO = m.MODEL_NO AND i.CI_TYPE = m.CI_TYPE
                       WHERE i.CI_TYPE = 1 AND LOWER(LTRIM(RTRIM(i.SERIAL_NO))) = ?
                         AND LOWER(LTRIM(RTRIM(COALESCE(m.MODEL_NAME, N'')))) = ?""",
                    (serial, model_name),
                )
                if dup:
                    item_result.update(status="error", message="такой серийник+модель уже есть в целевой базе")
                    report["items"].append(item_result)
                    continue

            with tgt_db.get_connection() as conn:
                cur = conn.cursor()
                new_id = resolver._next_id(cur, "ITEMS", "ID")
                cur.execute(
                    "SELECT ISNULL(MAX(CAST(INV_NO AS INT)), 0) + 1 FROM ITEMS WITH (TABLOCKX, HOLDLOCK) WHERE INV_NO IS NOT NULL AND ISNUMERIC(INV_NO) = 1"
                )
                new_inv_no = float(cur.fetchone()[0])

                type_no = resolver.ci_type(item.get("TYPE_NO"), item_ci_type, cur)
                if type_no is None:
                    raise ValueError("не удалось сопоставить TYPE_NO в целевой базе")
                model_no = resolver.model(item.get("MODEL_NO"), item_ci_type, cur, type_no)
                if model_no is None:
                    raise ValueError("не удалось сопоставить MODEL_NO в целевой базе")
                status_no = resolver.status(item.get("STATUS_NO"), cur) or queries.get_default_status_no(target_db_id)
                if status_no is None:
                    raise ValueError("не удалось сопоставить STATUS_NO в целевой базе")
                branch_no = target_branch_no if target_branch_no is not None else resolver.branch(item.get("BRANCH_NO"), cur)
                if branch_no is None:
                    raise ValueError("не удалось сопоставить BRANCH_NO в целевой базе")
                loc_no = target_loc_no if target_loc_no is not None else resolver.location(item.get("LOC_NO"), cur, branch_no=branch_no)
                if loc_no is None:
                    raise ValueError("не удалось сопоставить LOC_NO в целевой базе")
                empl_no = resolved_owner_no if resolved_owner_no is not None else resolver.owner(item.get("EMPL_NO"), cur)
                comp_no = resolver.company(item.get("COMP_NO"), cur)
                suppl_no = resolver.supplier(item.get("SUPPL_NO"), cur)
                service_suppl_no = resolver.supplier(item.get("SERVICE_SUPPL_NO"), cur)

                now = datetime.now()
                values = []
                for col in item_cols:
                    val = item.get(col)
                    if col == "ID":
                        val = new_id
                    elif col == "INV_NO":
                        val = new_inv_no
                    elif col == "INV_NO_BUH":
                        old_buh = _text(item.get("INV_NO_BUH"))
                        old_inv = _num_text(item.get("INV_NO"))
                        val = old_buh or (old_inv or None)
                    elif col == "TYPE_NO":
                        val = type_no
                    elif col == "MODEL_NO":
                        val = model_no
                    elif col == "STATUS_NO":
                        val = status_no
                    elif col == "BRANCH_NO":
                        val = branch_no
                    elif col == "LOC_NO":
                        val = loc_no
                    elif col == "EMPL_NO":
                        val = empl_no
                    elif col == "COMP_NO":
                        val = comp_no
                    elif col == "SUPPL_NO":
                        val = suppl_no
                    elif col == "SERVICE_SUPPL_NO":
                        val = service_suppl_no
                    elif col == "CH_DATE":
                        val = now
                    elif col == "CH_USER":
                        val = changed_by
                    elif col == "DESCR":
                        note = f"[перенос из {source_db_id}, инв. {_num_text(item.get('INV_NO')) or '?'}, id {old_id}]"
                        val = ((str(val) + " " + note).strip() if val else note)[:4000]
                    values.append(val)
                cur.execute(
                    f"INSERT INTO ITEMS ({', '.join(item_cols)}) VALUES ({', '.join('?' * len(item_cols))})",
                    tuple(values),
                )

                # closing history record about the cross-db move
                # (BRANCH_NO_NEW/LOC_NO_NEW/STATUS_NO_NEW/COMP_NO_NEW are NOT NULL)
                hist_id = resolver._next_id(cur, "CI_HISTORY", "HIST_ID")
                cur.execute(
                    """INSERT INTO CI_HISTORY (HIST_ID, ITEM_ID, EMPL_NO_NEW, BRANCH_NO_NEW, LOC_NO_NEW,
                                              STATUS_NO_NEW, COMP_NO_NEW, TYPE_NO_NEW, MODEL_NO_NEW,
                                              INV_NO_OLD, INV_NO_NEW, CI_TYPE_OLD, CI_TYPE_NEW,
                                              CH_DATE, CH_USER, CH_COMMENT)
                       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)""",
                    (hist_id, new_id, empl_no, branch_no, loc_no, status_no,
                     comp_no or 0, type_no, model_no,
                     item.get("INV_NO"), new_inv_no, 1, 1, now, changed_by,
                     f"Перенос из базы {source_db_id} (старый id {old_id}, инв. {_num_text(item.get('INV_NO')) or '-'})"),
                )

                # History copy must not fail silently: a failure aborts the item
                # (target txn rolls back, source row stays intact).
                copied = {}
                hist_fallbacks = {
                    "BRANCH_NO_NEW": branch_no,
                    "LOC_NO_NEW": loc_no,
                    "STATUS_NO_NEW": status_no,
                    "COMP_NO_NEW": comp_no or 0,
                }
                for table, item_col, pk_col in _COPY_TABLES:
                    cols = col_specs.get(table)
                    if not cols:
                        continue
                    copied[table] = _copy_generic_children(
                        src_db, cur, resolver, table, item_col, pk_col, old_id, new_id, cols,
                        fallbacks=hist_fallbacks if table == "CI_HISTORY" else None,
                    )
                copied["DOCS"] = _copy_docs(src_db, cur, resolver, old_id, new_id, docs_cols, docs_list_cols)
                copied["MOVES"] = _copy_moves(src_db, cur, resolver, old_id, new_id, moves_cols, moves_list_cols)

                # summary of source-only links
                for table, item_col, label in _SUMMARY_TABLES:
                    cnt = src_db.execute_query(f"SELECT COUNT(*) AS n FROM {table} WHERE {item_col} = ?", (old_id,))
                    if cnt and int(cnt[0]["n"] or 0):
                        item_result.setdefault("source_only_links", []).append(f"{label}: {int(cnt[0]['n'])}")

            src_owner = source_dicts["owner"].get(int(item.get("EMPL_NO") or 0)) or {}
            act_item = {
                "type_name": source_dicts["type"].get((int(item.get("TYPE_NO") or 0), item_ci_type)) or "",
                "model_name": (model_entry[0] if model_entry else "") or "",
                "serial_no": item.get("SERIAL_NO") or "",
                "part_no": item.get("PART_NO") or "",
                "inv_no": new_inv_no,
                "inv_no_old": item.get("INV_NO"),
                "old_employee_name": src_owner.get("name") or "",
            }

            # --- delete from source (separate txn, after target commit) ---
            deleted_children = {}
            try:
                with src_db.get_connection() as sconn:
                    scur = sconn.cursor()
                    for table, item_col in _DELETE_TABLES:
                        scur.execute(f"DELETE FROM {table} WHERE {item_col} = ?", (old_id,))
                        deleted_children[table] = scur.rowcount if scur.rowcount and scur.rowcount > 0 else 0
                    scur.execute("DELETE FROM ITEMS WHERE ID = ?", (old_id,))
            except Exception as exc:  # noqa: BLE001
                logger.exception("source cleanup failed for item %s", old_id)
                item_result.update(status="partial", message=f"скопировано в целевую (id {new_id}), но удаление в источнике не удалось: {exc}",
                                   new_item_id=new_id, inv_no_new=new_inv_no, copied=copied, act_item=act_item)
                report["items"].append(item_result)
                new_item_ids.append(new_id)
                old_inv_map[new_id] = item.get("INV_NO")
                continue

            item_result.update(
                status="ok",
                new_item_id=new_id,
                inv_no_new=new_inv_no,
                copied=copied,
                deleted_children={k: v for k, v in deleted_children.items() if v},
                act_item=act_item,
            )
            report["items"].append(item_result)
            new_item_ids.append(new_id)
            old_inv_map[new_id] = item.get("INV_NO")
        except Exception as exc:  # noqa: BLE001
            logger.exception("transfer of item inv_no=%s failed", raw_inv)
            item_result.update(status="error", message=str(exc))
            report["items"].append(item_result)

    # receipt act in the target DB covering all moved items
    if new_item_ids:
        try:
            with tgt_db.get_connection() as conn:
                cur = conn.cursor()
                report["act_doc_no"] = _insert_transfer_act(
                    cur, resolver, new_item_ids,
                    source_db_id=source_db_id, old_inv_map=old_inv_map,
                    changed_by=changed_by, owner_no=resolved_owner_no,
                    branch_no=target_branch_no, loc_no=target_loc_no,
                )
        except Exception as exc:  # noqa: BLE001
            logger.exception("transfer act insert failed")
            report["act_error"] = str(exc)

    ok = sum(1 for i in report["items"] if i.get("status") == "ok")
    report["summary"] = {"total": len(inv_nos), "ok": ok, "failed": len(inv_nos) - ok}
    return report
