"""Data-quality panel of the equipment database (read-only, current database).

Every rule is one set-based SELECT over ITEMS (CI_TYPE = 1, the rows the list shows).
Counters are cached per database for a few minutes and computed one rule at a time
under a total time budget: a slow database yields "unknown" for the rest instead of
a hung request. Nothing here writes to any database.

Rules
- no_photo            no FILES photo row
- no_part_no          PART_NO still pending (same predicate as the 1C reconcile KPI)
- no_owner            no owner or an owner id missing from OWNERS
- no_branch_location  branch or location not set
- no_serial           empty serial in a type where >= 80 % of items (min 10) have one
- serial_cyrillic     Russian letters inside the serial (look-alike Latin letters typed wrong)
- serial_odd_chars    spaces or symbols other than Latin letters, digits and . _ / -
- duplicate_serial    the same serial on two or more items
- duplicate_inv_no    the same inventory number on two or more items
- ip_no_mac            IP address is set but MAC is empty
- mac_invalid          MAC is not made of 12-hex-digit groups (several MACs in one field are fine)
- duplicate_mac        the same MAC on two or more items
- duplicate_ip         the same IP on two or more items
- dismissed_owner     owner is a person (FIO-like name) missing from the address book
- serial_photo_similar / serial_photo_mismatch
                      the serial read from the label photo (PostgreSQL ``equipment_photo_ocr``)
                      resembles / contradicts ITEMS.SERIAL_NO; unknown until photos are analysed
"""

from __future__ import annotations

import logging
import re
import threading
import time
from datetime import datetime, timezone
from typing import Any, Callable, Iterable, Optional

logger = logging.getLogger(__name__)

SUMMARY_TTL_SEC = 300
TIME_BUDGET_SEC = 25.0
DEFAULT_LIMIT = 50
MAX_LIMIT = 200
EXPORT_LIMIT = 20000
SERIAL_MIN_TYPE_ITEMS = 10
SERIAL_MIN_FILLED_PCT = 80
MAX_DISMISSED_OWNERS = 1500

STATUS_OK = "ok"
STATUS_UNKNOWN = "unknown"

RULE_NO_PHOTO = "no_photo"
RULE_NO_PART_NO = "no_part_no"
RULE_NO_OWNER = "no_owner"
RULE_NO_BRANCH_LOCATION = "no_branch_location"
RULE_NO_SERIAL = "no_serial"
RULE_DUPLICATE_SERIAL = "duplicate_serial"
RULE_DUPLICATE_INV_NO = "duplicate_inv_no"
RULE_DISMISSED_OWNER = "dismissed_owner"
RULE_SERIAL_CYRILLIC = "serial_cyrillic"
RULE_SERIAL_ODD_CHARS = "serial_odd_chars"
RULE_IP_NO_MAC = "ip_no_mac"
RULE_MAC_INVALID = "mac_invalid"
RULE_DUPLICATE_MAC = "duplicate_mac"
RULE_DUPLICATE_IP = "duplicate_ip"
NETWORK_RULES = {RULE_IP_NO_MAC, RULE_MAC_INVALID, RULE_DUPLICATE_MAC, RULE_DUPLICATE_IP}
RULE_SERIAL_PHOTO_SIMILAR = "serial_photo_similar"
RULE_SERIAL_PHOTO_MISMATCH = "serial_photo_mismatch"
_OCR_RULES = {
    RULE_SERIAL_PHOTO_SIMILAR: "similar",
    RULE_SERIAL_PHOTO_MISMATCH: "mismatch",
}
MAX_OCR_ITEMS = 1500

# T-SQL: BIN2 makes the bracket ranges compare by code point, so А-Я/а-я/Ё/ё are exactly Cyrillic.
_BIN2 = "COLLATE Cyrillic_General_BIN2"

_PLACEHOLDER_SERIALS = "'', '-', '--', '0', 'n/a', 'none', 'б/н', 'б.н', 'нет', 'без номера'"


class QualityUnavailableError(RuntimeError):
    """The equipment database could not be read."""


class UnknownRuleError(ValueError):
    pass


def _serial_filled(alias: str) -> str:
    return (
        f"({alias}.SERIAL_NO IS NOT NULL "
        f"AND LOWER(LTRIM(RTRIM({alias}.SERIAL_NO))) NOT IN ({_PLACEHOLDER_SERIALS}))"
    )


def serial_filled_sql(alias: str) -> str:
    """Public twin of the "serial is really filled" predicate (used by the photo OCR batch)."""
    return _serial_filled(alias)


_MAC_SEPARATORS = (":", "-", ".", ";", ",", " ")


def _mac_clean_sql(alias: str) -> str:
    """MAC without separators, upper-cased (T-SQL)."""
    expr = f"UPPER(LTRIM(RTRIM({alias}.MAC_ADDRESS)))"
    for sep in _MAC_SEPARATORS:
        expr = f"REPLACE({expr}, '{sep}', '')"
    return expr


def _mac_filled(alias: str) -> str:
    return f"({alias}.MAC_ADDRESS IS NOT NULL AND LTRIM(RTRIM({alias}.MAC_ADDRESS)) <> '')"


def _ip_filled(alias: str) -> str:
    return f"({alias}.IP_ADDRESS IS NOT NULL AND LTRIM(RTRIM({alias}.IP_ADDRESS)) <> '')"


def normalize_mac_address(raw: Any, *, allow_multiple: bool = False) -> Optional[str]:
    """``AA:BB:CC:DD:EE:FF`` for one MAC typed in any style; ``None`` for an empty value.

    Raises ValueError when the value is not made of 12-hex-digit groups. With
    ``allow_multiple`` a field that holds several MACs is accepted and returned as typed.
    """
    text = _text(raw)
    if not text:
        return None
    if re.sub(r"[0-9A-Fa-f:.\-;,\s]", "", text):
        raise ValueError("MAC address contains invalid characters")
    digits = re.sub(r"[^0-9A-Fa-f]", "", text).upper()
    if len(digits) == 12:
        return ":".join(digits[i:i + 2] for i in range(0, 12, 2))
    if allow_multiple and digits and len(digits) % 12 == 0:
        return text
    raise ValueError("MAC address must have 12 hexadecimal digits")


def _part_no_pending_sql() -> str:
    from backend.database import queries

    return queries._PART_NO_PENDING_SQL


# (rule, title, description, severity) — the order is the order of the tiles.
RULES: list[dict[str, str]] = [
    {"rule": RULE_NO_PHOTO, "title": "Нет фото",
     "description": "У позиции нет ни одной фотографии.", "severity": "warning"},
    {"rule": RULE_NO_PART_NO, "title": "Нет партномера 1С",
     "description": "PART_NO пуст или ещё не подтверждён (без отметки «нет в 1С»).", "severity": "warning"},
    {"rule": RULE_NO_OWNER, "title": "Нет владельца",
     "description": "Сотрудник не указан или отсутствует в справочнике владельцев.", "severity": "error"},
    {"rule": RULE_DISMISSED_OWNER, "title": "Владелец не найден в справочнике",
     "description": "Владелец-человек отсутствует в адресной книге — вероятно, уволен. "
                    "Определяется по ФИО, возможны неточности.", "severity": "error"},
    {"rule": RULE_NO_BRANCH_LOCATION, "title": "Нет филиала или кабинета",
     "description": "Не заполнен филиал либо расположение.", "severity": "warning"},
    {"rule": RULE_NO_SERIAL, "title": "Нет серийного номера",
     "description": "Пустой серийный номер в типе, где он есть почти у всех позиций.", "severity": "warning"},
    {"rule": RULE_SERIAL_CYRILLIC, "title": "Кириллица в серийном номере",
     "description": "В серийнике есть русские буквы (часто А, В, С, Е, К, М, Н, О, Р, Т, Х "
                    "вместо латинских) — по такому номеру позицию не найти и не сверить.",
     "severity": "error"},
    {"rule": RULE_SERIAL_ODD_CHARS, "title": "Пробелы и лишние символы в серийнике",
     "description": "В серийном номере пробелы или символы кроме латиницы, цифр и . _ / -.",
     "severity": "warning"},
    {"rule": RULE_SERIAL_PHOTO_SIMILAR, "title": "Серийник похож на фото — проверить глазами",
     "description": "Модель прочитала на этикетке номер, отличающийся от записанного на один символ "
                    "(O/0, I/1, S/5 и т. п.). Нужна проверка человеком; данные появляются после "
                    "распознавания фото.", "severity": "warning"},
    {"rule": RULE_SERIAL_PHOTO_MISMATCH, "title": "Серийник не совпал с фото",
     "description": "Этикетка прочитана, но ни одно фото позиции не подтверждает записанный номер. "
                    "Возможна опечатка в базе или неверное чтение — сверьте по фото.", "severity": "error"},
    {"rule": RULE_DUPLICATE_SERIAL, "title": "Дубли серийных номеров",
     "description": "Один серийный номер у нескольких позиций.", "severity": "error"},
    {"rule": RULE_DUPLICATE_INV_NO, "title": "Дубли инвентарных номеров",
     "description": "Один инвентарный номер у нескольких позиций.", "severity": "error"},
    {"rule": RULE_IP_NO_MAC, "title": "Есть IP, нет MAC",
     "description": "IP-адрес указан, а MAC-адрес не заполнен — такую технику не найти по MAC "
                    "и не сопоставить с мониторингом. MAC можно вписать прямо в строке.",
     "severity": "warning"},
    {"rule": RULE_MAC_INVALID, "title": "MAC в неверном формате",
     "description": "MAC-адрес записан не двенадцатью шестнадцатеричными символами "
                    "(лишние знаки, обрезан). Если символов ровно 12, формат можно исправить в один клик.",
     "severity": "error"},
    {"rule": RULE_DUPLICATE_MAC, "title": "Дубли MAC-адресов",
     "description": "Один MAC-адрес у нескольких позиций.", "severity": "error"},
    {"rule": RULE_DUPLICATE_IP, "title": "Дубли IP-адресов",
     "description": "Один IP-адрес у нескольких позиций.", "severity": "warning"},
]
_RULE_INDEX = {item["rule"]: item for item in RULES}
_SQL_RULES = {
    RULE_NO_PHOTO, RULE_NO_PART_NO, RULE_NO_OWNER, RULE_NO_BRANCH_LOCATION,
    RULE_NO_SERIAL, RULE_DUPLICATE_SERIAL, RULE_DUPLICATE_INV_NO,
    RULE_SERIAL_CYRILLIC, RULE_SERIAL_ODD_CHARS,
    *NETWORK_RULES,
}


def _rule_where(rule: str) -> str:
    """WHERE fragment over ITEMS aliased ``i`` (CI_TYPE filter is added by the caller)."""
    if rule == RULE_NO_PHOTO:
        return (
            "NOT EXISTS (SELECT 1 FROM FILES f WHERE f.ITEM_ID = i.ID "
            "AND f.CI_TYPE = i.CI_TYPE AND f.FILE_TYPE = 0)"
        )
    if rule == RULE_NO_PART_NO:
        return _part_no_pending_sql()
    if rule == RULE_NO_OWNER:
        return (
            "(i.EMPL_NO IS NULL OR i.EMPL_NO <= 0 "
            "OR NOT EXISTS (SELECT 1 FROM OWNERS ow WHERE ow.OWNER_NO = i.EMPL_NO))"
        )
    if rule == RULE_NO_BRANCH_LOCATION:
        return (
            "(i.BRANCH_NO IS NULL OR i.BRANCH_NO <= 0 "
            "OR i.LOC_NO IS NULL OR i.LOC_NO <= 0)"
        )
    if rule == RULE_NO_SERIAL:
        return (
            f"(NOT {_serial_filled('i')} AND i.TYPE_NO IN ("
            "SELECT s.TYPE_NO FROM ITEMS s WHERE s.CI_TYPE = 1 AND s.TYPE_NO IS NOT NULL "
            "GROUP BY s.TYPE_NO "
            f"HAVING COUNT(1) >= {SERIAL_MIN_TYPE_ITEMS} "
            f"AND SUM(CASE WHEN {_serial_filled('s')} THEN 1 ELSE 0 END) * 100 "
            f">= {SERIAL_MIN_FILLED_PCT} * COUNT(1)))"
        )
    if rule == RULE_DUPLICATE_SERIAL:
        return (
            f"({_serial_filled('i')} "
            "AND UPPER(LTRIM(RTRIM(i.SERIAL_NO))) IN ("
            "SELECT UPPER(LTRIM(RTRIM(d.SERIAL_NO))) FROM ITEMS d "
            f"WHERE d.CI_TYPE = 1 AND {_serial_filled('d')} "
            "GROUP BY UPPER(LTRIM(RTRIM(d.SERIAL_NO))) HAVING COUNT(1) > 1))"
        )
    if rule == RULE_SERIAL_CYRILLIC:
        # «б/н» (без номера) is a placeholder, not a mistyped serial.
        return (
            f"({_serial_filled('i')} AND "
            f"PATINDEX(N'%[А-Яа-яЁё]%' {_BIN2}, i.SERIAL_NO) > 0)"
        )
    if rule == RULE_SERIAL_ODD_CHARS:
        # Cyrillic is judged by its own rule; here only spaces and stray symbols.
        return (
            f"({_serial_filled('i')} AND "
            f"PATINDEX(N'%[^-A-Za-z0-9._/А-Яа-яЁё]%' {_BIN2}, i.SERIAL_NO) > 0)"
        )
    if rule == RULE_DUPLICATE_INV_NO:
        return (
            "(i.INV_NO IS NOT NULL AND i.INV_NO IN ("
            "SELECT d.INV_NO FROM ITEMS d WHERE d.CI_TYPE = 1 AND d.INV_NO IS NOT NULL "
            "GROUP BY d.INV_NO HAVING COUNT(1) > 1))"
        )
    if rule == RULE_IP_NO_MAC:
        return f"({_ip_filled('i')} AND NOT {_mac_filled('i')})"
    if rule == RULE_MAC_INVALID:
        clean = _mac_clean_sql("i")
        return (
            f"({_mac_filled('i')} AND "
            f"(LEN({clean}) % 12 <> 0 OR {clean} LIKE '%[^0-9A-F]%'))"
        )
    if rule == RULE_DUPLICATE_MAC:
        return (
            f"({_mac_filled('i')} AND {_mac_clean_sql('i')} IN ("
            f"SELECT {_mac_clean_sql('d')} FROM ITEMS d "
            f"WHERE d.CI_TYPE = 1 AND {_mac_filled('d')} "
            f"GROUP BY {_mac_clean_sql('d')} HAVING COUNT(1) > 1))"
        )
    if rule == RULE_DUPLICATE_IP:
        return (
            f"({_ip_filled('i')} AND LTRIM(RTRIM(i.IP_ADDRESS)) IN ("
            "SELECT LTRIM(RTRIM(d.IP_ADDRESS)) FROM ITEMS d "
            f"WHERE d.CI_TYPE = 1 AND {_ip_filled('d')} "
            "GROUP BY LTRIM(RTRIM(d.IP_ADDRESS)) HAVING COUNT(1) > 1))"
        )
    raise UnknownRuleError(rule)


def _as_int(value: Any) -> int:
    try:
        return int(value or 0)
    except (TypeError, ValueError):
        return 0


def _text(value: Any) -> str:
    return str(value or "").strip()


def _db(get_db_fn: Optional[Callable], db_id: Any):
    if get_db_fn is None:
        from backend.database import queries

        get_db_fn = queries.get_db
    return get_db_fn(db_id)


def _first_value(rows: Iterable[dict[str, Any]], *keys: str) -> int:
    for row in rows or []:
        for key in keys:
            if key in row:
                return _as_int(row[key])
    return 0


_FIO_TOKEN = re.compile(r"^[А-ЯЁ][а-яё\-]+$|^[А-ЯЁ]\.?([А-ЯЁ]\.?)?$")

# Owners also hold warehouses, rooms and departments written like «Склад Кириленко».
_NOT_A_PERSON_WORDS = frozenset({
    "склад", "офис", "кабинет", "отдел", "объект", "филиал", "цех", "участок", "магазин",
    "база", "подразделение", "управление", "служба", "бухгалтерия", "отделение", "пункт",
    "хранилище", "лаборатория", "приемная", "приёмная", "производство", "ремонт", "резерв",
    "списание", "утиль", "брак", "аренда", "общий", "общая", "серверная", "архив",
})


def looks_like_person(name: str) -> bool:
    """Only FIO-like owner names are judged; objects and departments are left alone."""
    tokens = _text(name).split()
    if not 2 <= len(tokens) <= 3:
        return False
    if any(token.lower() in _NOT_A_PERSON_WORDS for token in tokens):
        return False
    return all(_FIO_TOKEN.match(token) for token in tokens)


# ---- dismissed owners (address book is the source, not SQL) -----------------

def _dismissed_owners(
    *, db_id: Any, get_db_fn: Optional[Callable], cache: Optional[dict] = None
) -> Optional[dict[int, dict[str, Any]]]:
    """{owner_no: {name, items}} for person-owners absent from the address book.

    None when the address book cache is empty or stale — the status is unknown, not clean.
    """
    from backend.services import employment_status_service as employment

    rows = _db(get_db_fn, db_id).execute_query(
        """
        SELECT i.EMPL_NO AS owner_no, o.OWNER_DISPLAY_NAME AS owner_name, COUNT(1) AS item_count
        FROM ITEMS i
        INNER JOIN OWNERS o ON o.OWNER_NO = i.EMPL_NO
        WHERE i.CI_TYPE = 1 AND i.EMPL_NO > 0
        GROUP BY i.EMPL_NO, o.OWNER_DISPLAY_NAME
        """,
        (),
    ) or []
    people = {
        _as_int(row.get("owner_no")): row
        for row in rows
        if looks_like_person(_text(row.get("owner_name")))
    }
    names = [_text(row.get("owner_name")) for row in people.values()]
    statuses = employment.resolve_employment_status_batch(names, cache=cache)
    if names and all(
        statuses.get(name, {}).get("status") == employment.STATUS_UNKNOWN for name in names
    ):
        return None
    result: dict[int, dict[str, Any]] = {}
    for owner_no, row in people.items():
        name = _text(row.get("owner_name"))
        if statuses.get(name, {}).get("status") == employment.STATUS_DISMISSED:
            result[owner_no] = {"name": name, "items": _as_int(row.get("item_count"))}
    return result


# ---- photo OCR rules (verdicts come from PostgreSQL, not SQL Server) ---------

def _ocr_item_verdicts(
    *, db_id: Any, get_db_fn: Optional[Callable]
) -> Optional[dict[int, dict[str, Any]]]:
    """Per-item OCR verdicts; None while nothing was analysed yet (the status is unknown, not clean)."""
    from backend.services import equipment_photo_ocr_service as ocr

    verdicts = ocr.item_verdicts(db_id=db_id, get_db_fn=get_db_fn)
    return verdicts or None


def _ocr_items(verdicts: dict[int, dict[str, Any]], verdict: str) -> dict[int, dict[str, Any]]:
    return {item_id: info for item_id, info in verdicts.items() if info["verdict"] == verdict}


# ---- summary ----------------------------------------------------------------

_summary_cache: dict[str, tuple[float, dict[str, Any]]] = {}
_summary_lock = threading.Lock()


def clear_cache() -> None:
    with _summary_lock:
        _summary_cache.clear()


def _now_iso() -> str:
    return datetime.now(timezone.utc).isoformat(timespec="seconds")


def _compute_summary(
    *, db_id: Any, get_db_fn: Optional[Callable], address_book_cache: Optional[dict]
) -> dict[str, Any]:
    db = _db(get_db_fn, db_id)
    started = time.monotonic()
    try:
        total = _first_value(
            db.execute_query("SELECT COUNT(1) AS c FROM ITEMS i WHERE i.CI_TYPE = 1", ()),
            "c", "C",
        )
    except Exception as exc:
        logger.warning("Equipment quality total failed db=%s", db_id, exc_info=True)
        raise QualityUnavailableError("equipment database unavailable") from exc

    rules: list[dict[str, Any]] = []
    ocr_verdicts: Optional[dict[int, dict[str, Any]]] = None
    ocr_loaded = False
    for meta in RULES:
        rule = meta["rule"]
        count: Optional[int] = None
        if time.monotonic() - started <= TIME_BUDGET_SEC:
            try:
                if rule in _OCR_RULES:
                    if not ocr_loaded:
                        ocr_verdicts = _ocr_item_verdicts(db_id=db_id, get_db_fn=get_db_fn)
                        ocr_loaded = True
                    count = (
                        None if ocr_verdicts is None
                        else len(_ocr_items(ocr_verdicts, _OCR_RULES[rule]))
                    )
                elif rule == RULE_DISMISSED_OWNER:
                    owners = _dismissed_owners(
                        db_id=db_id, get_db_fn=get_db_fn, cache=address_book_cache
                    )
                    count = None if owners is None else sum(o["items"] for o in owners.values())
                else:
                    rows = db.execute_query(
                        f"SELECT COUNT(1) AS c FROM ITEMS i WHERE i.CI_TYPE = 1 AND {_rule_where(rule)}",
                        (),
                    )
                    count = _first_value(rows, "c", "C")
            except Exception:
                logger.warning("Equipment quality rule failed rule=%s db=%s", rule, db_id, exc_info=True)
        known = count is not None
        rules.append({
            **meta,
            "count": count,
            "total": total,
            "pct": round(count * 100.0 / total, 1) if known and total else (0.0 if known else None),
            "status": STATUS_OK if known else STATUS_UNKNOWN,
        })
    return {"rules": rules, "total": total, "as_of": _now_iso(), "cached": False}


def quality_summary(
    *,
    db_id: Any,
    refresh: bool = False,
    get_db_fn: Optional[Callable] = None,
    address_book_cache: Optional[dict] = None,
) -> dict[str, Any]:
    key = _text(db_id) or "default"
    # perf_counter: monotonic() ticks at ~15 ms on Windows, too coarse to order two calls.
    requested_at = time.perf_counter()

    def _fresh(entry: Optional[tuple[float, dict[str, Any]]], *, since: float = 0.0):
        return entry is not None and entry[0] > since and time.perf_counter() - entry[0] < SUMMARY_TTL_SEC

    with _summary_lock:
        entry = _summary_cache.get(key)
        if _fresh(entry) and not refresh:
            return {**entry[1], "cached": True}
        lock = _db_locks.setdefault(key, threading.Lock())
    # One computation per database at a time. Whoever waited for the lock reuses a result
    # computed after their request instead of repeating the whole pass.
    with lock:
        with _summary_lock:
            entry = _summary_cache.get(key)
        if _fresh(entry, since=requested_at):
            return {**entry[1], "cached": True}
        payload = _compute_summary(
            db_id=db_id, get_db_fn=get_db_fn, address_book_cache=address_book_cache
        )
        with _summary_lock:
            _summary_cache[key] = (time.perf_counter(), payload)
        return payload


_db_locks: dict[str, threading.Lock] = {}


# ---- issues -----------------------------------------------------------------

_ISSUE_FROM = """
    FROM ITEMS i
    LEFT JOIN CI_TYPES t ON i.CI_TYPE = t.CI_TYPE AND i.TYPE_NO = t.TYPE_NO
    LEFT JOIN CI_MODELS m ON i.MODEL_NO = m.MODEL_NO AND i.CI_TYPE = m.CI_TYPE
    LEFT JOIN OWNERS o ON i.EMPL_NO = o.OWNER_NO
    LEFT JOIN BRANCHES b ON i.BRANCH_NO = b.BRANCH_NO
    LEFT JOIN LOCATIONS l ON i.LOC_NO = l.LOC_NO
"""

_ISSUE_SEARCH = (
    "(CAST(i.INV_NO AS VARCHAR(64)) LIKE ? ESCAPE '\\' OR i.SERIAL_NO LIKE ? ESCAPE '\\' "
    "OR m.MODEL_NAME LIKE ? ESCAPE '\\' OR o.OWNER_DISPLAY_NAME LIKE ? ESCAPE '\\')"
)


def _escape_like(value: str) -> str:
    return value.replace("\\", "\\\\").replace("%", "\\%").replace("_", "\\_")


def _public_issue(row: dict[str, Any]) -> dict[str, Any]:
    def pick(*keys: str) -> Any:
        for key in keys:
            if key in row and row[key] is not None:
                return row[key]
        return ""

    return {
        "item_id": _as_int(pick("item_id", "ITEM_ID")),
        "inv_no": _text(pick("inv_no", "INV_NO")),
        "serial_no": _text(pick("serial_no", "SERIAL_NO")),
        "type_name": _text(pick("type_name", "TYPE_NAME")),
        "model_name": _text(pick("model_name", "MODEL_NAME")),
        "employee_name": _text(pick("employee_name", "EMPLOYEE_NAME")),
        "branch_name": _text(pick("branch_name", "BRANCH_NAME")),
        "location_name": _text(pick("location_name", "LOCATION_NAME")),
        "ip_address": _text(pick("ip_address", "IP_ADDRESS")),
        "mac_address": _text(pick("mac_address", "MAC_ADDRESS")),
        "note": "",
    }


def _network_note(rule: str, item: dict[str, Any]) -> str:
    ip, mac = item.get("ip_address", ""), item.get("mac_address", "")
    if rule == RULE_IP_NO_MAC:
        return f"IP {ip}, MAC не заполнен"
    if rule in (RULE_MAC_INVALID, RULE_DUPLICATE_MAC):
        return f"MAC {mac}" + (f" · IP {ip}" if ip else "")
    if rule == RULE_DUPLICATE_IP:
        return f"IP {ip}" + (f" · MAC {mac}" if mac else "")
    return ""


def list_issues(
    *,
    db_id: Any,
    rule: str,
    limit: int = DEFAULT_LIMIT,
    offset: int = 0,
    query: str = "",
    get_db_fn: Optional[Callable] = None,
    address_book_cache: Optional[dict] = None,
) -> dict[str, Any]:
    if rule not in _RULE_INDEX:
        raise UnknownRuleError(rule)
    safe_limit = max(1, min(int(limit or DEFAULT_LIMIT), EXPORT_LIMIT))
    safe_offset = max(0, int(offset or 0))
    db = _db(get_db_fn, db_id)

    where = ["i.CI_TYPE = 1"]
    params: list[Any] = []
    status = STATUS_OK
    photo_notes: dict[int, str] = {}
    if rule in _OCR_RULES:
        verdicts = _ocr_item_verdicts(db_id=db_id, get_db_fn=get_db_fn)
        if verdicts is None:
            return {
                "rule": rule, "items": [], "total": 0, "offset": safe_offset,
                "limit": safe_limit, "status": STATUS_UNKNOWN,
            }
        flagged = _ocr_items(verdicts, _OCR_RULES[rule])
        item_ids = sorted(flagged)[:MAX_OCR_ITEMS]
        if not item_ids:
            return {
                "rule": rule, "items": [], "total": 0, "offset": safe_offset,
                "limit": safe_limit, "status": STATUS_OK,
            }
        where.append(f"i.ID IN ({', '.join('?' for _ in item_ids)})")
        params.extend(item_ids)
        photo_notes = {
            item_id: "На фото: " + ", ".join(info["photo_serials"][:3])
            for item_id, info in flagged.items()
            if info["photo_serials"]
        }
    elif rule == RULE_DISMISSED_OWNER:
        owners = _dismissed_owners(db_id=db_id, get_db_fn=get_db_fn, cache=address_book_cache)
        if owners is None:
            return {
                "rule": rule, "items": [], "total": 0, "offset": safe_offset,
                "limit": safe_limit, "status": STATUS_UNKNOWN,
            }
        owner_nos = sorted(owners)[:MAX_DISMISSED_OWNERS]
        if not owner_nos:
            return {
                "rule": rule, "items": [], "total": 0, "offset": safe_offset,
                "limit": safe_limit, "status": STATUS_OK,
            }
        where.append(f"i.EMPL_NO IN ({', '.join('?' for _ in owner_nos)})")
        params.extend(owner_nos)
    else:
        where.append(_rule_where(rule))

    needle = _text(query)[:100]
    if needle:
        pattern = f"%{_escape_like(needle)}%"
        where.append(_ISSUE_SEARCH)
        params.extend([pattern] * 4)

    where_sql = " AND ".join(where)
    # IP/MAC columns are optional in some snapshots: only the network rules ask for them.
    network_select = (
        ",\n                i.IP_ADDRESS AS ip_address,\n                i.MAC_ADDRESS AS mac_address"
        if rule in NETWORK_RULES else ""
    )
    try:
        total = _first_value(
            db.execute_query(
                f"SELECT COUNT(1) AS c {_ISSUE_FROM} WHERE {where_sql}", tuple(params)
            ),
            "c", "C",
        )
        rows = db.execute_query(
            f"""
            SELECT
                i.ID AS item_id,
                CAST(i.INV_NO AS VARCHAR(64)) AS inv_no,
                i.SERIAL_NO AS serial_no,
                t.TYPE_NAME AS type_name,
                m.MODEL_NAME AS model_name,
                o.OWNER_DISPLAY_NAME AS employee_name,
                b.BRANCH_NAME AS branch_name,
                l.DESCR AS location_name{network_select}
            {_ISSUE_FROM}
            WHERE {where_sql}
            ORDER BY i.INV_NO, i.ID
            OFFSET ? ROWS FETCH NEXT ? ROWS ONLY
            """,
            tuple(params + [safe_offset, safe_limit]),
        ) or []
    except Exception as exc:
        logger.warning("Equipment quality issues failed rule=%s db=%s", rule, db_id, exc_info=True)
        raise QualityUnavailableError("equipment database unavailable") from exc
    items = [_public_issue(row) for row in rows]
    for item in items:
        item["note"] = (
            _network_note(rule, item) if rule in NETWORK_RULES else photo_notes.get(item["item_id"], "")
        )
    return {
        "rule": rule,
        "items": items,
        "total": total,
        "offset": safe_offset,
        "limit": safe_limit,
        "status": status,
    }
