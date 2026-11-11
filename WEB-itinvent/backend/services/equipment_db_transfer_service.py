"""Cross-database equipment transfer between ITINVENT SQL Server databases.

Moves a verified ITEMS batch (CI_TYPE=1) and its history, documents and BLOBs
in one cross-database SQL Server transaction. Unsupported links block the
operation; source document originals remain as archival copies.
Dictionary references (owners, branches, locations, statuses, types, models,
vendors, suppliers, companies) are remapped by name and auto-created in the
target DB when missing — everything created is reported back.

The item always receives a fresh INV_NO in the target DB; the previous number
is kept in INV_NO_BUH and in a closing CI_HISTORY record.
"""
from __future__ import annotations

import hashlib
import io
import json
import logging
import math
import re
from contextlib import contextmanager
from datetime import datetime
from pathlib import Path
from typing import Any, Optional
from uuid import uuid4

from backend.database import queries
from backend.database.connection import get_db, get_database_config
from backend.services import transfer_service

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
        "location_branch": {(int(r["LOC_NO"]), int(r["BRANCH_NO"])) for r in rows("SELECT LOC_NO, BRANCH_NO FROM LOC_BRANCH") if r.get("LOC_NO") is not None and r.get("BRANCH_NO") is not None},
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
        self.location_idx = {}
        for loc_no, name in sorted(tgt["location"].items()):
            branches = [branch for loc, branch in tgt["location_branch"] if loc == loc_no] or [None]
            for branch in branches:
                self.location_idx.setdefault((_norm(name), branch), loc_no)
        self.status_idx = _build_name_index(tgt["status"])
        self.type_idx = {(k[1], _norm(v)): k for k, v in tgt["type"].items()}
        self.model_idx = {}
        for key, value in sorted(tgt["model"].items()):
            self.model_idx.setdefault((key[1], _norm(value[0]), value[1], value[2] or None), key)
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
        key = (_norm(name), branch_no)
        if not key[0]:
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
        key = (int(ci_type), _norm(name))
        if not key[1]:
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
        if not _norm(name):
            return None
        vendor_no = _remap_required(self, "vendor", src_vendor_no, cursor) or None
        if type_no is None and src_type_no is not None:
            type_no = self.ci_type(src_type_no, int(ci_type), cursor)
        if type_no is None:
            return None
        key = (int(ci_type), _norm(name), type_no, vendor_no)
        if key in self.model_idx:
            return int(self.model_idx[key][0])
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
                                   OWNER_DISPLAY_NAME, OWNER_DEPT, OWNER_LOGIN)
               VALUES (?, ?, ?, ?, ?, ?, ?)""",
            (new_id, lname, fname, mname, name, "", info.get("login")),
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
    ("DEV_SERVICE", "ITEM_ID", "SERVICE_NO"),
)

# Only successfully copied equipment links may be deleted; scope by CI_TYPE where available.
_DELETE_TABLES = (
    ("CI_HISTORY", "ITEM_ID"),
    ("DOCS_LIST", "ITEM_ID"),
    ("MOVES_LIST", "ITEM_ID"),
    ("FILES", "ITEM_ID"),
    ("COMMENTS", "ITEM_ID"),
    ("DEV_SERVICE", "ITEM_ID"),
)

# Unsupported relations block the batch before any writes.
_SUMMARY_TABLES = (
    ("INVENT_LIST", "ITEM_ID", "инвентаризационные ведомости"),
    ("TASKS_LIST", "ITEM_ID", "задачи"),
    ("JOBS_LIST", "ITEM_ID", "задания"),
    ("CARTRIGES_REPLACES", "ITEM_ID", "замены картриджей"),
    ("FIELDS_VALUES", "ITEM_ID", "дополнительные поля"),
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
    if kind == "vendor":
        return resolver.vendor(sid, cursor)
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
                val = _remap_required(resolver, "supplier", val, tgt_cursor)
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
                    if values[idx] not in (None, 0) and new_val is None:
                        raise DbTransferValidationError(f"История: не удалось сопоставить {col}, ID {values[idx]}")
                    if new_val is None and col.endswith("_NEW") and fallbacks and col in fallbacks:
                        new_val = fallbacks[col]
                    values[idx] = new_val
                    remapped_vals[col] = new_val
        placeholders = ", ".join("?" * len(columns))
        tgt_cursor.execute(f"INSERT INTO {table} ({', '.join(columns)}) VALUES ({placeholders})", tuple(values))
        copied += 1
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


def _insert_item(cur, resolver, item, new_id, new_inv_no, item_cols, *, source_db_id,
                 target_owner_no, target_branch_no, target_loc_no, changed_by):
    item_ci_type = 1
    old_id = int(item["ID"])
    resolved_owner_no = target_owner_no
    type_no = resolver.ci_type(item.get("TYPE_NO"), item_ci_type, cur)
    if type_no is None:
        raise ValueError("не удалось сопоставить TYPE_NO в целевой базе")
    model_no = resolver.model(item.get("MODEL_NO"), item_ci_type, cur, type_no)
    if model_no is None:
        raise ValueError("не удалось сопоставить MODEL_NO в целевой базе")
    status_no = _remap_required(resolver, "status", item.get("STATUS_NO"), cur) or _default_status(cur)
    if status_no is None:
        raise ValueError("не удалось сопоставить STATUS_NO в целевой базе")
    branch_no = target_branch_no if target_branch_no is not None else resolver.branch(item.get("BRANCH_NO"), cur)
    if branch_no is None:
        raise ValueError("не удалось сопоставить BRANCH_NO в целевой базе")
    loc_no = target_loc_no if target_loc_no is not None else resolver.location(item.get("LOC_NO"), cur, branch_no=branch_no)
    if loc_no is None:
        raise ValueError("не удалось сопоставить LOC_NO в целевой базе")
    cur.execute("SELECT COUNT(*) FROM LOC_BRANCH WHERE LOC_NO = ? AND BRANCH_NO = ?", (loc_no, branch_no))
    if not cur.fetchone()[0]:
        raise DbTransferValidationError("Выбранная локация не принадлежит целевому филиалу")
    empl_no = resolved_owner_no if resolved_owner_no is not None else resolver.owner(item.get("EMPL_NO"), cur)
    comp_no = _remap_required(resolver, "company", item.get("COMP_NO"), cur)
    suppl_no = _remap_required(resolver, "supplier", item.get("SUPPL_NO"), cur)
    service_suppl_no = _remap_required(resolver, "supplier", item.get("SERVICE_SUPPL_NO"), cur)

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

    return {"EMPL_NO_NEW": empl_no, "BRANCH_NO_NEW": branch_no, "LOC_NO_NEW": loc_no,
            "STATUS_NO_NEW": status_no, "COMP_NO_NEW": comp_no or 0,
            "TYPE_NO_NEW": type_no, "MODEL_NO_NEW": model_no}


_OP_MARKER = "\nHUB_DB_TRANSFER_V1:"


class DbTransferValidationError(ValueError):
    """Nothing may be deleted when preflight or verification fails."""


class DbTransferConflict(DbTransferValidationError):
    """An operation key or source snapshot conflicts with another request."""


class DbTransferAccessError(PermissionError):
    """The caller cannot read this database or this cross-database operation."""


def _identifier(value):
    return "[" + str(value).replace("]", "]]") + "]"


class _CursorDatabase:
    """Read through the same SQL Server transaction, optionally in another DB."""

    def __init__(self, cursor, database=None, locked=False):
        self.cursor = cursor
        self.database = database
        self.locked = locked

    def execute_query(self, sql, params=()):
        if self.database or self.locked:
            def qualify(match):
                table = match.group(2)
                prefix = f"{_identifier(self.database)}.dbo." if self.database else ""
                alias = f" {match.group(3)}" if match.group(3) else ""
                hint = " WITH (UPDLOCK, HOLDLOCK)" if self.locked else ""
                return f"{match.group(1)} {prefix}{table}{alias}{hint}"
            # T-SQL requires the alias before WITH (...). Exclude clause
            # keywords so an unaliased table does not consume WHERE/JOIN/etc.
            sql = re.sub(
                r"\b(FROM|JOIN)\s+([A-Z_]+)\b"
                r"(?:\s+((?:AS\s+)?(?!(?:WHERE|JOIN|LEFT|RIGHT|INNER|OUTER|FULL|CROSS|ON|WITH|ORDER|GROUP|HAVING|UNION|FOR|OFFSET|FETCH|SET)\b)[A-Za-z_]\w*))?",
                qualify, sql, flags=re.I,
            )
        self.cursor.execute(sql, params or ())
        columns = [c[0] for c in self.cursor.description]
        return [dict(zip(columns, row)) for row in self.cursor.fetchall()]


@contextmanager
def _transfer_locks(conn, database_names):
    # Session locks survive the short read transaction while PDFs are rendered.
    # Acquire both databases in the same order, including opposite directions.
    acquired = []
    try:
        for database in sorted(set(database_names), key=str.casefold):
            cur = conn.cursor()
            cur.execute(
                f"DECLARE @result int; EXEC @result = {_identifier(database)}.sys.sp_getapplock "
                "@Resource = ?, @LockMode = 'Exclusive', @LockOwner = 'Session', "
                "@LockTimeout = 0; SELECT @result",
                ("HUB equipment database transfer v1",),
            )
            if int(cur.fetchone()[0]) < 0:
                raise DbTransferConflict("Другая операция переноса уже выполняется. Повторите запрос позже.")
            acquired.append(database)
        conn.commit()
        yield
        conn.commit()
    except Exception:
        conn.rollback()
        raise
    finally:
        for database in reversed(acquired):
            conn.cursor().execute(
                f"EXEC {_identifier(database)}.sys.sp_releaseapplock "
                "@Resource = ?, @LockOwner = 'Session'",
                ("HUB equipment database transfer v1",),
            )


def _ordered(rows):
    # Equality checks use original bytes, not lossy serializations of BLOBs.
    return sorted(rows, key=lambda row: tuple(str(row.get(k)) for k in sorted(row) if k not in {"FILE_DATA", "FILE_SMALL_IMAGE_DATA"}))


def _snapshot(db, inv_nos):
    bundle = {"items": [], "children": {}, "docs": {}, "moves": {}, "blocked": {}}
    for inv in inv_nos:
        rows = db.execute_query("SELECT * FROM ITEMS WHERE CI_TYPE = 1 AND INV_NO = ?", (float(inv),))
        if len(rows) != 1:
            raise DbTransferValidationError(f"Инв. {inv}: карточка не найдена или номер неоднозначен")
        item = rows[0]
        item_id = int(item["ID"])
        bundle["items"].append(item)
        children = {}
        for table, column, _pk in _COPY_TABLES:
            scope = " AND CI_TYPE = 1" if table in {"FILES", "COMMENTS"} else ""
            children[table] = _ordered(db.execute_query(f"SELECT * FROM {table} WHERE {column} = ?{scope}", (item_id,)))
        bundle["children"][item_id] = children
        blockers = []
        for table, column, label in _SUMMARY_TABLES:
            scope = " AND CI_TYPE = 1" if table in {"INVENT_LIST", "JOBS_LIST"} else ""
            if table == "FIELDS_VALUES":
                rows = db.execute_query("SELECT * FROM FIELDS_VALUES WHERE TRY_CONVERT(int, ITEM_ID) = ? AND ITEM_NO = 1", (item_id,))
            else:
                rows = db.execute_query(f"SELECT * FROM {table} WHERE {column} = ?{scope}", (item_id,))
            if rows:
                blockers.append(f"{label}: {len(rows)}")
        bundle["blocked"][item_id] = blockers
        docs = db.execute_query(
            "SELECT DISTINCT d.* FROM DOCS d JOIN DOCS_LIST dl ON dl.DOC_NO = d.DOC_NO "
            "WHERE dl.ITEM_ID = ? AND (dl.CI_TYPE = 1 OR dl.CI_TYPE IS NULL)", (item_id,),
        )
        for doc in docs:
            doc_no = int(doc["DOC_NO"])
            if doc_no not in bundle["docs"]:
                bundle["docs"][doc_no] = {
                    "header": doc,
                    "lines": _ordered(db.execute_query("SELECT * FROM DOCS_LIST WHERE DOC_NO = ?", (doc_no,))),
                    "files": _ordered(db.execute_query("SELECT * FROM FILES WHERE CI_TYPE = 10 AND ITEM_ID = ?", (doc_no,))),
                    "comments": _ordered(db.execute_query("SELECT * FROM COMMENTS WHERE CI_TYPE = 10 AND ITEM_ID = ?", (doc_no,))),
                }
        moves = db.execute_query(
            "SELECT DISTINCT m.* FROM MOVES m JOIN MOVES_LIST ml ON ml.MOVE_NO = m.MOVE_NO WHERE ml.ITEM_ID = ?", (item_id,),
        )
        for move in moves:
            move_no = int(move["MOVE_NO"])
            if move_no not in bundle["moves"]:
                bundle["moves"][move_no] = {
                    "header": move,
                    "lines": _ordered(db.execute_query("SELECT * FROM MOVES_LIST WHERE MOVE_NO = ?", (move_no,))),
                }
    return bundle


def _dictionary_references(bundle, dictionaries):
    """Track only dictionaries that affect this batch and its historical rows."""
    refs = {kind: set() for kind in ("owner", "branch", "location", "status", "type", "model", "vendor", "supplier", "company")}

    def add(kind, value, ci_type=1):
        if value not in (None, 0):
            value = int(value)
            refs[kind].add((value, int(ci_type or 1)) if kind in {"type", "model"} else value)

    for item in bundle["items"]:
        for column, kind in (("EMPL_NO", "owner"), ("BRANCH_NO", "branch"), ("LOC_NO", "location"),
                             ("STATUS_NO", "status"), ("TYPE_NO", "type"), ("MODEL_NO", "model"),
                             ("COMP_NO", "company"), ("SUPPL_NO", "supplier"), ("SERVICE_SUPPL_NO", "supplier")):
            add(kind, item.get(column))
    for children in bundle["children"].values():
        for row in children["CI_HISTORY"]:
            for old, new, kind in _HIST_REMAP:
                add(kind, row.get(old), row.get("CI_TYPE_OLD"))
                add(kind, row.get(new), row.get("CI_TYPE_NEW"))
        for row in children["DEV_SERVICE"]:
            add("supplier", row.get("SERVICE_SUPPL_NO"))
    for document in bundle["docs"].values():
        row = document["header"]
        add("type", row.get("TYPE_NO"), 10)
        for column, kind in (("EMPL_NO", "owner"), ("BRANCH_NO", "branch"), ("LOC_NO", "location"), ("COMP_NO", "company"), ("SUPPL_NO", "supplier")):
            add(kind, row.get(column))
    for move in bundle["moves"].values():
        row = move["header"]
        for column, kind in (("SOURCE_BRANCH_NO", "branch"), ("TARGET_BRANCH_NO", "branch"),
                             ("COMP_NO", "company"), ("SOURCE_EMPL_NO", "owner"), ("TARGET_EMPL_NO", "owner")):
            add(kind, row.get(column))
    for key in refs["model"]:
        model = dictionaries["model"].get(key)
        if model:
            add("type", model[1], key[1])
            add("vendor", model[2])
    return refs


def _dictionary_snapshot(dictionaries, references):
    result = {kind: {key: dictionaries[kind].get(key) for key in keys} for kind, keys in references.items()}
    result["location_branch"] = {pair for pair in dictionaries["location_branch"] if pair[0] in references["location"]}
    return result


def _validate_files(files):
    for row in files:
        payload = row.get("FILE_DATA")
        if not payload:
            raise DbTransferValidationError(f"Файл № {row['FILE_NO']}: содержимое отсутствует; перенос отменён")
        if str(row.get("FILE_NAME") or "").lower().endswith(".pdf"):
            try:
                from pypdf import PdfReader
                pdf = PdfReader(io.BytesIO(bytes(payload)))
                if pdf.is_encrypted or not len(pdf.pages):
                    raise ValueError("unreadable PDF")
            except Exception:
                raise DbTransferValidationError(f"PDF № {row['FILE_NO']} недоступен или повреждён; перенос отменён") from None


def _validate_snapshot(bundle):
    for item_id, blockers in bundle["blocked"].items():
        if blockers:
            raise DbTransferValidationError(
                f"Карточка ID {item_id}: перенос пока не поддерживает связи ({'; '.join(blockers)}). Источник сохранён."
            )
    for children in bundle["children"].values():
        _validate_files(children["FILES"])
    for doc_no, document in bundle["docs"].items():
        if not document["files"]:
            raise DbTransferValidationError(f"Документ № {doc_no}: вложения отсутствуют; перенос отменён")
        _validate_files(document["files"])


def _insert_row(cur, table, row):
    columns = list(row)
    cur.execute(f"INSERT INTO {table} ({', '.join(columns)}) VALUES ({', '.join('?' for _ in columns)})", tuple(row[c] for c in columns))


def _default_status(cur):
    cur.execute("SELECT TOP 1 STATUS_NO FROM STATUS ORDER BY STATUS_NO")
    row = cur.fetchone()
    return int(row[0]) if row else None


def _next_inventory(cur, locked=False):
    hint = " WITH (TABLOCKX, HOLDLOCK)" if locked else ""
    cur.execute(f"SELECT ISNULL(MAX(CAST(INV_NO AS INT)), 0) + 1 FROM ITEMS{hint} WHERE INV_NO IS NOT NULL AND ISNUMERIC(INV_NO) = 1")
    return int(cur.fetchone()[0])


def _remap_required(resolver, kind, value, cur, context=None):
    if value in (None, 0):
        return value
    result = _remap_hist_value(resolver, kind, value, cur, context or {})
    if result is None:
        raise DbTransferValidationError(f"Не удалось сопоставить справочник {kind}, ID {value}")
    return result


def _copy_document_groups(cur, resolver, groups, item_map, *, moves=False, verification):
    table, list_table, key = ("MOVES", "MOVES_LIST", "MOVE_NO") if moves else ("DOCS", "DOCS_LIST", "DOC_NO")
    mapping = {}
    file_count = 0
    for old_no, group in groups.items():
        row = dict(group["header"])
        new_no = resolver._next_id(cur, table, key)
        mapping[old_no] = new_no
        row[key] = new_no
        if moves:
            refs = {"SOURCE_BRANCH_NO": "branch", "TARGET_BRANCH_NO": "branch", "COMP_NO": "company", "SOURCE_EMPL_NO": "owner", "TARGET_EMPL_NO": "owner"}
        else:
            refs = {"EMPL_NO": "owner", "BRANCH_NO": "branch", "LOC_NO": "location", "COMP_NO": "company", "SUPPL_NO": "supplier"}
            if row.get("TYPE_NO") not in (None, 0):
                row["TYPE_NO"] = resolver.ci_type(row["TYPE_NO"], 10, cur)
                if row["TYPE_NO"] is None:
                    raise DbTransferValidationError("Не удалось сопоставить тип документа")
            if _OP_MARKER in str(row.get("ADDINFO") or ""):
                # Keep business text and the original PDF; a copied historical
                # document must not become another authoritative operation log.
                row["ADDINFO"] = row["ADDINFO"].split(_OP_MARKER, 1)[0]
        for column, kind in refs.items():
            if column in row:
                row[column] = _remap_required(resolver, kind, row[column], cur, {"branch_no": row.get("BRANCH_NO")})
        _insert_row(cur, table, row)
        for original in group["lines"]:
            if int(original["ITEM_ID"]) not in item_map:
                continue
            if not moves and original.get("CI_TYPE") not in (None, 1):
                continue
            line = {**original, key: new_no, "ITEM_ID": item_map[int(original["ITEM_ID"])]}
            _insert_row(cur, list_table, line)
        if not moves:
            for original in group["files"]:
                _copy_file(cur, resolver, original, new_no, verification)
                file_count += 1
            for original in group["comments"]:
                _insert_row(cur, "COMMENTS", {**original, "COMMENT_NO": resolver._next_id(cur, "COMMENTS", "COMMENT_NO"), "ITEM_ID": new_no})
    return mapping, file_count


def _copy_file(cur, resolver, original, new_object_id, verification):
    row = {**original, "FILE_NO": resolver._next_id(cur, "FILES", "FILE_NO"), "ITEM_ID": new_object_id}
    _insert_row(cur, "FILES", row)
    verification.append(row)
    return row["FILE_NO"]


def _verify_files(cur, files):
    for expected in files:
        cur.execute("SELECT * FROM FILES WHERE FILE_NO = ? AND CI_TYPE = ? AND ITEM_ID = ?", (expected["FILE_NO"], expected["CI_TYPE"], expected["ITEM_ID"]))
        columns = [c[0] for c in cur.description]
        found = cur.fetchone()
        if found is None:
            raise DbTransferValidationError("Проверка вложений не пройдена: файл отсутствует")
        actual = dict(zip(columns, found))
        for column in ("FILE_DATA", "FILE_SMALL_IMAGE_DATA", "FILE_NAME"):
            if actual.get(column) != expected.get(column):
                raise DbTransferValidationError("Проверка вложений не пройдена: содержимое или имя не совпадает")


def _decode_operation(addinfo):
    text = str(addinfo or "")
    if _OP_MARKER not in text:
        raise DbTransferConflict("Журнал операции повреждён; автоматический повтор запрещён")
    suffix = text.rsplit(_OP_MARKER, 1)[-1]
    operation_id, separator, payload = suffix.partition(":{")
    if not separator:
        raise DbTransferConflict("Журнал операции повреждён; автоматический повтор запрещён")
    try:
        stored = json.loads("{" + payload)
        if not isinstance(stored, dict) or not isinstance(stored.get("report"), dict) or not stored.get("fingerprint"):
            raise ValueError()
        return operation_id, stored
    except (TypeError, ValueError):
        raise DbTransferConflict("Журнал операции повреждён; автоматический повтор запрещён") from None


def _read_operation(db, operation_id, fingerprint, target_db_id):
    marker = _OP_MARKER + operation_id + ":"
    rows = db.execute_query("SELECT DOC_NO, ADDINFO FROM DOCS WHERE ADDINFO LIKE ?", ("%" + marker + "%",))
    candidates = []
    for row in rows:
        key, stored = _decode_operation(row["ADDINFO"])
        report = stored["report"]
        if key == operation_id and report.get("act_doc_no") == row["DOC_NO"] and report.get("target_db") == target_db_id:
            candidates.append(stored)
    if len(candidates) > 1:
        raise DbTransferConflict("Найден неоднозначный журнал операции")
    if not candidates:
        return None
    stored = candidates[0]
    if stored["fingerprint"] != fingerprint:
        raise DbTransferConflict("operation_id уже использован с другими параметрами")
    return {**stored["report"], "replayed": True}


def get_transfer_file(db_id, file_no, current_user, current_db_id):
    if db_id not in queries.get_available_databases():
        raise DbTransferValidationError("Неизвестная база данных")
    rows = get_db(db_id).execute_query(
        "SELECT f.FILE_NAME, f.FILE_DATA, d.DOC_NO, d.ADDINFO, d.CREATE_USER_NAME FROM FILES f "
        "JOIN DOCS d ON d.DOC_NO = f.ITEM_ID WHERE f.FILE_NO = ? AND f.CI_TYPE = 10 AND f.FILE_DESCR = ?",
        (file_no, "HUB transfer receipt PDF v1"),
    )
    if not rows or not rows[0].get("FILE_DATA"):
        return None
    row = rows[0]
    if getattr(current_user, "role", "") != "admin" and current_db_id != db_id:
        try:
            _key, stored = _decode_operation(row["ADDINFO"])
            report = stored["report"]
        except DbTransferConflict:
            raise DbTransferAccessError("Нет доступа к PDF этой операции") from None
        creator_id = report.get("created_by_user_id")
        owns = (creator_id == getattr(current_user, "id", None)) if creator_id is not None else (
            bool(getattr(current_user, "username", "")) and row["CREATE_USER_NAME"] == current_user.username)
        acts = report.get("acts")
        allowed = (owns and bool(current_db_id) and report.get("source_db") == current_db_id
                   and report.get("target_db") == db_id and report.get("act_doc_no") == row["DOC_NO"]
                   and isinstance(acts, list)
                   and any(isinstance(act, dict) and act.get("file_no") == file_no for act in acts))
        if not allowed:
            raise DbTransferAccessError("Нет доступа к PDF этой операции")
    return {"FILE_NAME": row["FILE_NAME"], "FILE_DATA": row["FILE_DATA"]}


def save_transfer_followup(report):
    """Persist optional task outcome without repeating the committed transfer."""
    marker = _OP_MARKER + report["operation_id"] + ":"
    with get_db(report["target_db"]).get_connection() as conn:
        cur = conn.cursor()
        cur.execute("SELECT ADDINFO FROM DOCS WITH (UPDLOCK, HOLDLOCK) WHERE DOC_NO = ?", (report["act_doc_no"],))
        row = cur.fetchone()
        if not row or marker not in str(row[0]):
            raise DbTransferConflict("Журнал завершённой операции не найден")
        header, stored_text = str(row[0]).split(marker, 1)
        stored = json.loads(stored_text)
        for key in ("task", "task_error"):
            if key in report:
                stored["report"][key] = report[key]
        cur.execute("UPDATE DOCS SET ADDINFO = ? WHERE DOC_NO = ?",
                    (header + marker + json.dumps(stored, ensure_ascii=False), report["act_doc_no"]))


def transfer_items_to_db(*, source_db_id, target_db_id, inv_nos, target_owner_no=None,
                         target_owner_name=None, target_owner_dept=None, target_branch_no=None,
                         target_loc_no=None, changed_by="IT-WEB", operation_id=None, request_context=None):
    """Atomically move a verified batch on one SQL Server, including original PDFs.

    The receipt journal commits with both databases. Rendering, PDF validation
    and SHA-256 computation happen before the write transaction. A failed
    transaction leaves all source rows, shared documents and files intact.
    """
    operation_id = str(operation_id or uuid4())
    if not re.fullmatch(r"[A-Za-z0-9.:-]{8,64}", operation_id):
        raise DbTransferValidationError("Некорректный operation_id")
    source_config, target_config = get_database_config(source_db_id), get_database_config(target_db_id)
    if source_config["host"].casefold() != target_config["host"].casefold():
        raise DbTransferValidationError("Безопасный перенос между разными SQL Server пока не поддерживается")
    if source_config["database"].casefold() == target_config["database"].casefold():
        raise DbTransferValidationError("Исходная и целевая базы должны различаться")
    try:
        inv_nos = sorted(set(float(str(v).strip()) for v in inv_nos))
        if not inv_nos or any(not math.isfinite(v) for v in inv_nos):
            raise ValueError()
    except (ValueError, TypeError):
        raise DbTransferValidationError("Некорректные инвентарные номера") from None
    scope = dict(source_db=source_db_id, target_db=target_db_id, inv_nos=inv_nos,
                 owner=target_owner_no, owner_name=target_owner_name, owner_dept=target_owner_dept,
                 branch=target_branch_no, location=target_loc_no, actor=changed_by, context=request_context)
    fingerprint = hashlib.sha256(json.dumps(scope, sort_keys=True, ensure_ascii=False).encode()).hexdigest()
    src_db, tgt_db = get_db(source_db_id), get_db(target_db_id)
    tables = {"ITEMS", "DOCS", "DOCS_LIST", "MOVES", "MOVES_LIST", "FILES", "COMMENTS", "CI_HISTORY", "DEV_SERVICE"}
    columns = {}
    for table in tables:
        cols = _table_columns(src_db, table)
        if not cols or set(cols) != set(_table_columns(tgt_db, table)):
            raise DbTransferValidationError(f"Схемы таблицы {table} не совпадают; перенос отменён")
        columns[table] = cols
    source_name, target_name = source_config["database"], target_config["database"]
    with tgt_db.get_connection() as conn:
        with _transfer_locks(conn, (source_name, target_name)):
            cur = conn.cursor()
            target = _CursorDatabase(cur)
            replay = _read_operation(target, operation_id, fingerprint, target_db_id)
            if replay is not None:
                return replay
            source = _CursorDatabase(cur, source_name)
            bundle = _snapshot(source, inv_nos)
            source_dicts = _load_dicts(source)
            next_inv = _next_inventory(cur)
            owner_row = None
            if target_owner_no is not None:
                owners = target.execute_query("SELECT * FROM OWNERS WHERE OWNER_NO = ?", (target_owner_no,))
                if not owners:
                    raise DbTransferValidationError("Получатель не найден в целевой базе")
                owner_row = owners[0]
            owner_name = (owner_row or {}).get("OWNER_DISPLAY_NAME") or str(target_owner_name or "").strip()
            if not owner_name:
                raise DbTransferValidationError("Не указан получатель")
            conn.commit()
            _validate_snapshot(bundle)
            references = _dictionary_references(bundle, source_dicts)
            dictionary_snapshot = _dictionary_snapshot(source_dicts, references)
            # Rendering and hashing run without an open database transaction.
            act_items = []
            for index, item in enumerate(bundle["items"]):
                model = source_dicts["model"].get((int(item.get("MODEL_NO") or 0), 1))
                owner = source_dicts["owner"].get(int(item.get("EMPL_NO") or 0), {})
                act_items.append(dict(type_name=source_dicts["type"].get((int(item.get("TYPE_NO") or 0), 1), ""),
                                      model_name=model[0] if model else "", serial_no=item.get("SERIAL_NO") or "",
                                      part_no=item.get("PART_NO") or "", inv_no=next_inv + index,
                                      inv_no_old=item.get("INV_NO"), old_employee_name=owner.get("name") or ""))
            file_hashes = {int(row["FILE_NO"]): hashlib.sha256(bytes(row["FILE_DATA"])).hexdigest()
                           for children in bundle["children"].values() for row in children["FILES"]}
            file_hashes.update({int(row["FILE_NO"]): hashlib.sha256(bytes(row["FILE_DATA"])).hexdigest()
                                for doc in bundle["docs"].values() for row in doc["files"]})
            acts = transfer_service.generate_transfer_acts(act_items, owner_name,
                    (owner_row or {}).get("OWNER_DEPT") or target_owner_dept or "", None, target_db_id,
                    operation_id=operation_id)
            generated = []
            for act in acts:
                record = transfer_service.get_act_record(act["act_id"])
                if not record or not transfer_service._is_valid_pdf(Path(record["file_path"])):
                    raise DbTransferValidationError("Новый PDF акта не создан; перенос отменён")
                generated.append((dict(act), Path(record["file_path"]).read_bytes()))
            report = dict(source_db=source_db_id, target_db=target_db_id, operation_id=operation_id,
                          created_refs=[], items=[], errors=[], acts=[], replayed=False,
                          created_by_user_id=(request_context or {}).get("user_id"))
            # Lock and re-read the complete source set, including file bytes and
            # shared document lines. Native ITINVENT writers need not know our lock.
            locked_source = _CursorDatabase(cur, source_name, locked=True)
            current = _snapshot(locked_source, inv_nos)
            if current != bundle or _dictionary_snapshot(_load_dicts(locked_source), references) != dictionary_snapshot or _next_inventory(cur, locked=True) != next_inv:
                raise DbTransferConflict("Данные изменились во время подготовки; источник сохранён. Повторите запрос.")
            locked_target = _CursorDatabase(cur, locked=True)
            if owner_row is not None and locked_target.execute_query("SELECT * FROM OWNERS WHERE OWNER_NO = ?", (target_owner_no,)) != [owner_row]:
                raise DbTransferConflict("Получатель изменился во время подготовки; источник сохранён")
            resolver = _TargetDicts(locked_target, source_dicts, report["created_refs"])
            resolved_owner = target_owner_no
            if resolved_owner is None:
                resolved_owner = resolver.owner_by_name.get(_norm(owner_name))
                if resolved_owner is None:
                    resolved_owner = resolver._next_id(cur, "OWNERS", "OWNER_NO")
                    lname, fname, mname = queries._parse_fio(owner_name)
                    _insert_row(cur, "OWNERS", dict(OWNER_NO=resolved_owner, OWNER_LNAME=lname, OWNER_FNAME=fname,
                        OWNER_MNAME=mname, OWNER_DISPLAY_NAME=owner_name, OWNER_DEPT=target_owner_dept or ""))
                    report["created_refs"].append(f"сотрудник «{owner_name}» -> {resolved_owner}")
                    resolver.owner_by_name[_norm(owner_name)] = resolved_owner
            report["resolved_owner_no"] = resolved_owner
            item_map, verification = {}, []
            for index, item in enumerate(bundle["items"]):
                old_id = int(item["ID"])
                new_id = resolver._next_id(cur, "ITEMS", "ID")
                new_inv = next_inv + index
                if _text(item.get("SERIAL_NO")):
                    duplicate = target.execute_query(
                        "SELECT i.ID FROM ITEMS i JOIN CI_MODELS m ON i.MODEL_NO = m.MODEL_NO AND i.CI_TYPE = m.CI_TYPE "
                        "WHERE i.CI_TYPE = 1 AND LOWER(LTRIM(RTRIM(i.SERIAL_NO))) = ? AND LOWER(LTRIM(RTRIM(m.MODEL_NAME))) = ?",
                        (_norm(item["SERIAL_NO"]), _norm(act_items[index]["model_name"])),
                    )
                    if duplicate:
                        raise DbTransferConflict("Серийный номер и модель уже есть в целевой базе")
                fallback = _insert_item(cur, resolver, item, new_id, new_inv, columns["ITEMS"],
                    source_db_id=source_db_id, target_owner_no=resolved_owner, target_branch_no=target_branch_no,
                    target_loc_no=target_loc_no, changed_by=changed_by)
                item_map[old_id] = new_id
                copied = {}
                for table, _column, pk in _COPY_TABLES:
                    rows = bundle["children"][old_id][table]
                    copied[table] = len(rows)
                    if table == "FILES":
                        for row in rows:
                            _copy_file(cur, resolver, row, new_id, verification)
                    else:
                        # Replay only the captured rows; no additional connection.
                        class Captured:
                            def execute_query(self, sql, params=()):
                                return rows
                        _copy_generic_children(Captured(), cur, resolver, table, "ITEM_ID", pk,
                            old_id, new_id, columns[table], fallbacks=fallback)
                hist_id = resolver._next_id(cur, "CI_HISTORY", "HIST_ID")
                _insert_row(cur, "CI_HISTORY", dict(HIST_ID=hist_id, ITEM_ID=new_id, **fallback,
                    INV_NO_OLD=item["INV_NO"], INV_NO_NEW=new_inv, CI_TYPE_OLD=1, CI_TYPE_NEW=1,
                    CH_DATE=datetime.now(), CH_USER=changed_by,
                    CH_COMMENT=f"Перенос из {source_db_id}, ID {old_id}; операция {operation_id}"))
                report["items"].append(dict(inv_no=item["INV_NO"], inv_no_old=item["INV_NO"], inv_no_new=new_inv,
                    old_item_id=old_id, new_item_id=new_id, status="ok", copied=copied, act_item=act_items[index]))
            doc_map, doc_files = _copy_document_groups(cur, resolver, bundle["docs"], item_map, verification=verification)
            move_map, _ = _copy_document_groups(cur, resolver, bundle["moves"], item_map, moves=True, verification=verification)
            receipt_no = _insert_transfer_act(cur, resolver, list(item_map.values()), source_db_id=source_db_id,
                old_inv_map={item_map[int(i["ID"])]: i["INV_NO"] for i in bundle["items"]}, changed_by=changed_by,
                owner_no=resolved_owner, branch_no=target_branch_no, loc_no=target_loc_no)
            report["act_doc_no"] = receipt_no
            for act, content in generated:
                row = dict(FILE_NO=resolver._next_id(cur, "FILES", "FILE_NO"), CI_TYPE=10, ITEM_ID=receipt_no,
                    FILE_TYPE=1, FILE_NAME=act["file_name"], FILE_SIZE=len(content) / 1048576,
                    FILE_DESCR="HUB transfer receipt PDF v1", FILE_DATA=content, CREATE_DATE=datetime.now(), CREATE_USER=changed_by)
                _insert_row(cur, "FILES", row)
                verification.append(row)
                report["acts"].append({**act, "file_no": row["FILE_NO"], "db_id": target_db_id, "doc_no": receipt_no})
            _verify_files(cur, verification)
            report["verification"] = dict(documents=len(doc_map), moves=len(move_map),
                original_files=len(file_hashes), document_files=doc_files, generated_files=len(generated),
                sha256={str(k): v for k, v in file_hashes.items()})
            report["document_map"] = {str(k): v for k, v in doc_map.items()}
            report["summary"] = dict(total=len(item_map), ok=len(item_map), failed=0)
            # Exact scope: document PDFs and document headers stay in the source
            # as archival originals, including those shared with unmoved items.
            for old_id in item_map:
                for table, column in _DELETE_TABLES:
                    scope = " AND CI_TYPE = 1" if table in {"FILES", "COMMENTS"} else ""
                    if table == "DOCS_LIST":
                        scope = " AND (CI_TYPE = 1 OR CI_TYPE IS NULL)"
                    cur.execute(f"DELETE FROM {_identifier(source_name)}.dbo.{table} WHERE {column} = ?{scope}", (old_id,))
                cur.execute(f"DELETE FROM {_identifier(source_name)}.dbo.ITEMS WHERE ID = ? AND CI_TYPE = 1", (old_id,))
                if cur.rowcount != 1:
                    raise DbTransferConflict("Исходная карточка изменилась; перенос отменён")
            journal = dict(fingerprint=fingerprint, report=report)
            cur.execute("UPDATE DOCS SET ADDINFO = ? WHERE DOC_NO = ?", (
                f"Перенос из базы {source_db_id}." + _OP_MARKER + operation_id + ":" + json.dumps(journal, ensure_ascii=False), receipt_no))
            # The journal, original PDFs, new receipt and deletion commit together.
            conn.commit()
            return report
