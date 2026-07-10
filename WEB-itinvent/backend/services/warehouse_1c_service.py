# -*- coding: utf-8 -*-
"""Live warehouse balances/movements queries against 1C Бухгалтерия 2.0 (buh20)
via V83.COMConnector (Windows only).

Stock balances and turnovers are never cached — they change continuously, so
every "Остатки"/"Ведомость с деньгами" search hits 1C directly. To keep this
safe for the shared 1C server (also used by real accountants), heavy queries
always push their filter into the virtual table condition instead of an
external ГДЕ (see scripts/1c_queries/buh20_vedomost_s_dengami.txt for the
perf finding that motivated this).

What *is* cached, to avoid the multi-second Connect() cost on every request:

- A small pool of persistent COM connections (see ``_Warehouse1CConnectionPool``)
  is kept warm for the lifetime of the process — Connect() itself (full login
  + session setup on the 1C cluster) is the dominant cost, not the query that
  follows it.
- The Номенклатура/Склады directories used for autocomplete are periodically
  synced in full into an in-memory + JSON cache (see ``sync_catalog_from_1c``),
  so typing in the autocomplete filters in memory instead of round-tripping to
  1C on every keystroke. If the cache has never been populated yet, autocomplete
  falls back to a live 1C query.
"""
from __future__ import annotations

import asyncio
import gc
import logging
import os
import re
import threading
from concurrent.futures import Future, ThreadPoolExecutor
from datetime import date, datetime, timezone
from typing import Any, Callable

from backend.json_db.manager import JSONDataManager


logger = logging.getLogger(__name__)

DEFAULT_1C_SERVER = "tmn-srv-1c-01.zsgp.corp,tmn-srv-1c-02.zsgp.corp"
DEFAULT_1C_REF = "buh20"

NOMENCLATURE_CATALOG = "Номенклатура"
WAREHOUSE_CATALOG = "Склады"
SERIES_CATALOG = "бит_стр_СерииНоменклатуры"
TRANSFER_DOCUMENT = "бит_стр_ПеремещениеМеждуСкладами"

AUTOCOMPLETE_DEFAULT_LIMIT = 20
AUTOCOMPLETE_MAX_LIMIT = 50
# Склады directory is small (~5.3k rows, vs ~710k for Номенклатура) and many
# entries share generic substrings (a city name, "склад", "ЖК", ...) because
# warehouses are often created one-per-employee/location. A plain alphabetical
# substring match with the shared 50-row cap silently drops matches that don't
# happen to sort into the first page, which reads as "missing" warehouses —
# so the warehouse endpoint allows a larger page.
WAREHOUSE_AUTOCOMPLETE_MAX_LIMIT = 100
BALANCES_DEFAULT_LIMIT = 200
BALANCES_MAX_LIMIT = 500
MOVEMENTS_DEFAULT_LIMIT = 500
MOVEMENTS_MAX_LIMIT = 2000

QUERY_TIMEOUT_SEC = 45
MAX_CONCURRENT_1C_CALLS = 2
SUGGEST_MIN_TOKEN_LEN = 3
SUGGEST_DEFAULT_LIMIT = 20
EMPLOYEE_WAREHOUSE_MATCH_LIMIT = 20
EMPLOYEE_WAREHOUSE_MIN_CONTAINS_LEN = 4
EMPTY_1C_REF = "00000000-0000-0000-0000-000000000000"
QTY_EPSILON = 1e-9

_MATCH_WS_RE = re.compile(r"\s+")
_TOKEN_RE = re.compile(r"[0-9A-Za-zА-Яа-яЁё]+", re.UNICODE)
_PART_NO_TOKEN_RE = re.compile(r"[0-9A-Za-zА-Яа-яЁё]+(?:-[0-9A-Za-zА-Яа-яЁё]+)+", re.UNICODE)
_WAREHOUSE_PREFIX_TOKENS = frozenset({
    "склад",
    "скл",
    "жк",
    "офис",
    "филиал",
    "отдел",
    "центр",
    "цех",
})

CATALOG_CACHE_FILE = "warehouse_1c_catalog_cache.json"
# Measured on buh20: ~709,598 nomenclature rows and ~5,340 warehouse rows
# (НЕ ПометкаУдаления). These caps exist only as a runaway-query safety net,
# with generous headroom over the measured counts for organic growth — they
# are NOT meant to be hit in normal operation (see the logged warning below).
CATALOG_NOMENCLATURE_MAX_ROWS = 1_000_000
CATALOG_WAREHOUSES_MAX_ROWS = 20_000
# A full, uncapped fetch of ~715k rows over COM measured well under a minute
# in practice, but this is a background job (default interval: 1h) — a
# generous timeout costs nothing and avoids flaky failures under server load.
CATALOG_SYNC_TIMEOUT_SEC = 600
DEFAULT_CATALOG_SYNC_INTERVAL_SECONDS = 3600


class Warehouse1CValidationError(ValueError):
    """Raised for bad/insufficient filters — mapped to HTTP 400/422."""


class Warehouse1CQueryError(RuntimeError):
    """Raised for 1C connection/query failures — mapped to HTTP 502."""


def normalize_text(value: Any) -> str:
    return str(value or "").strip()


def is_meaningful_1c_ref(value: Any) -> bool:
    text = normalize_text(value).lower()
    return bool(text) and text != EMPTY_1C_REF


def normalize_1c_ref(value: Any) -> str:
    text = normalize_text(value)
    return text if is_meaningful_1c_ref(text) else ""


def has_positive_qty(value: Any) -> bool:
    try:
        return float(value or 0) > QTY_EPSILON
    except (TypeError, ValueError):
        return False


def quote_1c(value: str) -> str:
    return value.replace('"', '""')


def build_connection_string(server: str, ref: str, user: str, password: str) -> str:
    return (
        f'Srvr="{quote_1c(server)}";'
        f'Ref="{quote_1c(ref)}";'
        f'Usr="{quote_1c(user)}";'
        f'Pwd="{quote_1c(password)}";'
    )


def escape_like(value: str) -> str:
    return value.replace("~", "~~").replace("%", "~%").replace("_", "~_")


def format_com_error(exc: Exception) -> str:
    excepinfo = getattr(exc, "excepinfo", None)
    if isinstance(excepinfo, (tuple, list)) and len(excepinfo) > 2 and excepinfo[2]:
        return normalize_text(excepinfo[2])
    return normalize_text(str(exc)) or "Ошибка обращения к 1С"


def clamp_limit(value: int | None, default: int, maximum: int) -> int:
    try:
        parsed = int(value) if value is not None else default
    except (TypeError, ValueError):
        parsed = default
    return max(1, min(parsed, maximum))


def parse_date_param(value: str | None, field_name: str) -> date | None:
    text = normalize_text(value)
    if not text:
        return None
    try:
        return datetime.strptime(text, "%Y-%m-%d").date()
    except ValueError as exc:
        raise Warehouse1CValidationError(f"Некорректная дата в поле {field_name}: {value}") from exc


def utc_now_iso() -> str:
    return datetime.now(timezone.utc).isoformat()


def env_positive_int(name: str, default: int, minimum: int) -> int:
    try:
        return max(int(os.getenv(name, str(default)) or default), minimum)
    except Exception:
        return max(int(default), minimum)


def empty_catalog_cache() -> dict[str, Any]:
    return {
        "nomenclature": [],
        "warehouses": [],
        "updated_at": "",
        "last_attempt_at": "",
        "last_error": "",
    }


# Catalog entries are kept in memory as plain tuples rather than dicts — at
# buh20 scale (~710k nomenclature rows) this noticeably cuts per-row Python
# object overhead, and pre-computing the casefolded search keys once at sync
# time avoids redoing it on every keystroke.
# Warehouses: (ref, name, name_casefold)
# Nomenclature: (ref, code, name, name_casefold)
def build_warehouse_entry(ref: str, name: str) -> tuple[str, str, str]:
    normalized_name = normalize_text(name)
    return (normalize_text(ref), normalized_name, normalized_name.casefold())


def build_nomenclature_entry(ref: str, code: str, name: str) -> tuple[str, str, str, str]:
    normalized_name = normalize_text(name)
    normalized_code = normalize_text(code)
    return (normalize_text(ref), normalized_code, normalized_name, normalized_name.casefold())


def catalog_entries_to_json_rows(entries: list[tuple[str, str, str]]) -> list[list[str]]:
    # Persisted as compact [ref, name] pairs (not {"ref": ..., "name": ...}
    # objects) purely to keep the on-disk/DB JSON blob smaller at this scale —
    # the casefolded name is cheap to recompute on load.
    return [[ref, name] for ref, name, _ in entries]


def nomenclature_entries_to_json_rows(entries: list[tuple[str, str, str, str]]) -> list[list[str]]:
    return [[ref, code, name] for ref, code, name, _ in entries]


def json_rows_to_catalog_entries(rows: Any) -> list[tuple[str, str, str]]:
    entries: list[tuple[str, str, str]] = []
    if not isinstance(rows, list):
        return entries
    for row in rows:
        if isinstance(row, (list, tuple)) and len(row) >= 2:
            entries.append(build_warehouse_entry(row[0], row[1]))
        elif isinstance(row, dict):
            # Backward-compat with the earlier {"ref": ..., "name": ...} shape.
            entries.append(build_warehouse_entry(row.get("ref"), row.get("name")))
    return entries


def json_rows_to_nomenclature_entries(rows: Any) -> list[tuple[str, str, str, str]]:
    entries: list[tuple[str, str, str, str]] = []
    if not isinstance(rows, list):
        return entries
    for row in rows:
        if isinstance(row, (list, tuple)):
            if len(row) >= 3:
                entries.append(build_nomenclature_entry(row[0], row[1], row[2]))
            elif len(row) >= 2:
                entries.append(build_nomenclature_entry(row[0], "", row[1]))
        elif isinstance(row, dict):
            entries.append(
                build_nomenclature_entry(row.get("ref"), row.get("code"), row.get("name"))
            )
    return entries


def normalize_match_key(value: Any) -> str:
    return _MATCH_WS_RE.sub(" ", normalize_text(value).casefold()).strip()


def match_tokens(value: str) -> list[str]:
    return _TOKEN_RE.findall(normalize_match_key(value))


def is_word_boundary_contains(haystack: str, needle: str) -> bool:
    """True when needle is a whole-token subsequence of haystack (or equal)."""
    needle_key = normalize_match_key(needle)
    haystack_key = normalize_match_key(haystack)
    if not needle_key or not haystack_key:
        return False
    if needle_key == haystack_key:
        return True
    if len(needle_key) < EMPLOYEE_WAREHOUSE_MIN_CONTAINS_LEN:
        return False
    needle_tokens = match_tokens(needle_key)
    haystack_tokens = match_tokens(haystack_key)
    if not needle_tokens or not haystack_tokens:
        return False
    # All needle tokens must appear as whole tokens in haystack (order-independent).
    haystack_set = set(haystack_tokens)
    return all(token in haystack_set for token in needle_tokens)


def person_name_tokens(value: str) -> list[str]:
    tokens = match_tokens(value)
    while tokens and tokens[0] in _WAREHOUSE_PREFIX_TOKENS:
        tokens = tokens[1:]
    return tokens


def _is_initial_token(token: str) -> bool:
    return len(token) == 1 and token.isalpha()


def _name_part_initial_letters(tokens: list[str]) -> list[str]:
    letters: list[str] = []
    for token in tokens[1:]:
        if _is_initial_token(token):
            letters.append(token)
        elif len(token) >= 2:
            letters.append(token[0])
    return letters


def fio_person_match_score(employee_name: str, warehouse_name: str) -> int:
    """Higher is better; 0 means no match."""
    employee_key = normalize_match_key(employee_name)
    warehouse_key = normalize_match_key(warehouse_name)
    if not employee_key or not warehouse_key:
        return 0
    if employee_key == warehouse_key:
        return 100

    employee_tokens = person_name_tokens(employee_name)
    warehouse_tokens = person_name_tokens(warehouse_name)
    if not employee_tokens or not warehouse_tokens:
        return 0
    if employee_tokens[0] != warehouse_tokens[0]:
        return 0

    employee_given = employee_tokens[1:]
    warehouse_given = warehouse_tokens[1:]
    if not employee_given or not warehouse_given:
        return 0

    employee_initials = _name_part_initial_letters(employee_tokens)
    warehouse_initials = _name_part_initial_letters(warehouse_tokens)
    warehouse_only_initials = all(_is_initial_token(token) for token in warehouse_given)
    employee_only_initials = all(_is_initial_token(token) for token in employee_given)

    if warehouse_only_initials and employee_initials:
        if warehouse_initials == employee_initials[: len(warehouse_initials)]:
            return 80
    if employee_only_initials and warehouse_initials:
        if employee_initials == warehouse_initials[: len(employee_initials)]:
            return 80

    employee_significant = [token for token in employee_given if len(token) >= 3]
    warehouse_significant = [token for token in warehouse_given if len(token) >= 3]
    if employee_significant and warehouse_significant:
        shorter, longer = (
            (employee_significant, warehouse_significant)
            if len(employee_significant) <= len(warehouse_significant)
            else (warehouse_significant, employee_significant)
        )
        longer_set = set(longer)
        if all(token in longer_set for token in shorter):
            return 60

    if is_word_boundary_contains(warehouse_key, employee_key) or is_word_boundary_contains(
        employee_key, warehouse_key
    ):
        return 50
    return 0


def tokenize_hub_text(text: str) -> list[str]:
    normalized = normalize_text(text)
    tokens: list[str] = []
    seen: set[str] = set()
    for token in _PART_NO_TOKEN_RE.findall(normalized):
        folded = token.casefold()
        if folded not in seen:
            seen.add(folded)
            tokens.append(folded)
    for token in _TOKEN_RE.findall(normalized):
        folded = token.casefold()
        if len(folded) < SUGGEST_MIN_TOKEN_LEN or folded in seen:
            continue
        seen.add(folded)
        tokens.append(folded)
    return tokens


def one_c_text(connection: Any, value: Any) -> str:
    if value is None:
        return ""
    try:
        return normalize_text(connection.String(value))
    except Exception:
        return normalize_text(value)


def one_c_number(value: Any) -> float:
    if value is None:
        return 0.0
    try:
        return float(value)
    except (TypeError, ValueError):
        return 0.0


def one_c_datetime(connection: Any, value: Any) -> str | None:
    if value is None:
        return None
    if hasattr(value, "isoformat"):
        try:
            return value.isoformat()
        except Exception:
            pass
    text = one_c_text(connection, value)
    return text or None


def ref_uuid(connection: Any, value: Any) -> str:
    if value is None:
        return ""
    try:
        result = normalize_text(connection.String(value.УникальныйИдентификатор()))
    except Exception:
        return ""
    return result if is_meaningful_1c_ref(result) else ""


class _Warehouse1CConnectionPool:
    """Keeps up to ``size`` persistent 1C COM connections alive for the life
    of the process, one per worker thread, instead of reconnecting on every
    call — ``Connect()`` (full login + session setup on the 1C cluster) is
    the dominant cost of a request, not the query that follows it.
    """

    def __init__(self, connect_fn: Callable[[], Any], size: int) -> None:
        self._connect_fn = connect_fn
        self._local = threading.local()
        # The initializer only sets up the COM apartment on the worker
        # thread — it does NOT connect to 1C. If 1C is temporarily
        # unreachable that must not permanently break the whole pool (a
        # failing initializer would turn the executor into a BrokenThreadPool
        # for every future submission, forever). The actual 1C connection is
        # created lazily, on first use, inside each job.
        self._executor = ThreadPoolExecutor(
            max_workers=size,
            thread_name_prefix="warehouse1c-com",
            initializer=self._init_worker,
        )

    @staticmethod
    def _init_worker() -> None:
        import pythoncom  # type: ignore

        pythoncom.CoInitialize()

    def _get_connection(self) -> Any:
        connection = getattr(self._local, "connection", None)
        if connection is None:
            connection = self._connect_fn()
            self._local.connection = connection
        return connection

    def _drop_connection(self) -> None:
        self._local.connection = None

    def _run_job(self, func: Callable[..., Any], args: tuple, kwargs: dict) -> Any:
        # See the note on _execute_with_com's historical implementation:
        # COM exception objects created while the apartment is initialized
        # can end up in a traceback reference cycle that only cyclic GC can
        # break. If that GC pass happens after CoUninitialize() (e.g. lazily
        # at interpreter shutdown), releasing the leftover COM proxy crashes
        # the process with an access violation. So we: (1) only ever keep
        # plain string error messages around past the except blocks — never
        # the original exception object; (2) run gc.collect() on any error
        # path while still inside the apartment; (3) raise the final clean
        # exception outside of any except block so Python doesn't implicitly
        # chain it (__context__) back onto the original COM exception.
        validation_error_message: str | None = None
        query_error_message: str | None = None
        result: Any = None
        has_result = False

        try:
            connection = self._get_connection()
            result = func(connection, *args, **kwargs)
            has_result = True
        except Warehouse1CValidationError as exc:
            validation_error_message = str(exc)
        except Exception:
            # The cached connection might be stale (dropped 1C session,
            # network blip, server restart) — drop it and retry exactly once
            # with a freshly created connection before giving up.
            logger.warning("Warehouse 1C job failed on first attempt, retrying with a fresh connection")
            self._drop_connection()
            try:
                connection = self._get_connection()
                result = func(connection, *args, **kwargs)
                has_result = True
            except Warehouse1CValidationError as retry_exc:
                validation_error_message = str(retry_exc)
            except Exception as retry_exc:
                logger.exception("Warehouse 1C query failed after reconnect retry")
                query_error_message = format_com_error(retry_exc)

        if validation_error_message is not None or query_error_message is not None:
            gc.collect()
        if validation_error_message is not None:
            raise Warehouse1CValidationError(validation_error_message)
        if query_error_message is not None:
            raise Warehouse1CQueryError(query_error_message)
        if has_result:
            return result
        raise Warehouse1CQueryError("Неизвестная ошибка при обращении к 1С")

    def submit(self, func: Callable[..., Any], *args: Any, **kwargs: Any) -> "Future[Any]":
        return self._executor.submit(self._run_job, func, args, kwargs)

    def _cleanup_worker(self) -> None:
        import pythoncom  # type: ignore

        self._drop_connection()
        gc.collect()
        pythoncom.CoUninitialize()

    def shutdown(self, size: int) -> None:
        futures = [self._executor.submit(self._cleanup_worker) for _ in range(size)]
        for future in futures:
            try:
                future.result(timeout=10)
            except Exception:
                logger.exception("Warehouse 1C pool cleanup job failed")
        self._executor.shutdown(wait=True)


class Warehouse1CService:
    def __init__(self, data_manager: JSONDataManager | None = None) -> None:
        self._pool = _Warehouse1CConnectionPool(self._connect, MAX_CONCURRENT_1C_CALLS)
        self.data_manager = data_manager or JSONDataManager()
        self._catalog_sync_lock = threading.Lock()
        cache = self.load_catalog_cache()
        self._nomenclature_cache: list[tuple[str, str, str, str]] = json_rows_to_nomenclature_entries(
            cache.get("nomenclature")
        )
        self._warehouses_cache: list[tuple[str, str, str]] = json_rows_to_catalog_entries(cache.get("warehouses"))
        self._word_frequency_index: dict[str, int] = {}
        self._rebuild_nomenclature_word_index()

    # ------------------------------------------------------------------
    # Connection helpers (blocking, run inside a pool worker thread)
    # ------------------------------------------------------------------
    def _connect(self) -> Any:
        import win32com.client  # type: ignore

        server = normalize_text(os.getenv("BUH20_1C_SERVER")) or DEFAULT_1C_SERVER
        ref = normalize_text(os.getenv("BUH20_1C_REF")) or DEFAULT_1C_REF
        user = normalize_text(os.getenv("BUH20_1C_USER"))
        password = normalize_text(os.getenv("BUH20_1C_PASSWORD"))
        if not user or not password:
            raise Warehouse1CQueryError("BUH20_1C_USER и BUH20_1C_PASSWORD не заданы в .env")

        connector = win32com.client.Dispatch("V83.COMConnector")
        return connector.Connect(build_connection_string(server, ref, user, password))

    def _rebuild_ref(self, connection: Any, catalog_name: str, uuid_str: str) -> Any:
        text = normalize_1c_ref(uuid_str)
        if not text:
            return None
        try:
            uid_com = connection.NewObject("УникальныйИдентификатор", text)
            catalog_manager = getattr(connection.Справочники, catalog_name)
            return catalog_manager.ПолучитьСсылку(uid_com)
        except Exception as exc:
            raise Warehouse1CValidationError(f"Некорректный идентификатор ссылки: {uuid_str}") from exc

    def _rebuild_document_ref(self, connection: Any, document_name: str, uuid_str: str) -> Any:
        text = normalize_text(uuid_str)
        if not text:
            return None
        try:
            uid_com = connection.NewObject("УникальныйИдентификатор", text)
            document_manager = getattr(connection.Документы, document_name)
            return document_manager.ПолучитьСсылку(uid_com)
        except Exception as exc:
            raise Warehouse1CValidationError(f"Некорректный идентификатор документа: {uuid_str}") from exc

    async def _run_pooled(self, sync_func, *args: Any, timeout: float = QUERY_TIMEOUT_SEC, **kwargs: Any) -> Any:
        try:
            future = self._pool.submit(sync_func, *args, **kwargs)
        except Exception as exc:
            raise Warehouse1CQueryError(f"Не удалось поставить запрос к 1С в очередь: {exc}") from exc

        loop = asyncio.get_running_loop()
        try:
            return await asyncio.wait_for(asyncio.wrap_future(future, loop=loop), timeout=timeout)
        except asyncio.TimeoutError as exc:
            raise Warehouse1CQueryError(
                "1С не ответила вовремя. Попробуйте сузить фильтр (номенклатура/склад) и повторить запрос."
            ) from exc

    def shutdown(self) -> None:
        self._pool.shutdown(MAX_CONCURRENT_1C_CALLS)

    # ------------------------------------------------------------------
    # Номенклатура/Склады catalog cache (used for instant autocomplete)
    # ------------------------------------------------------------------
    def load_catalog_cache(self) -> dict[str, Any]:
        payload = self.data_manager.load_json(CATALOG_CACHE_FILE, default_content=empty_catalog_cache())
        if not isinstance(payload, dict):
            return empty_catalog_cache()
        result = empty_catalog_cache()
        result.update(payload)
        if not isinstance(result.get("nomenclature"), list):
            result["nomenclature"] = []
        if not isinstance(result.get("warehouses"), list):
            result["warehouses"] = []
        return result

    def save_catalog_cache(self, payload: dict[str, Any]) -> None:
        self.data_manager.save_json(CATALOG_CACHE_FILE, payload)

    def get_catalog_status(self) -> dict[str, Any]:
        cache = self.load_catalog_cache()
        return {
            "nomenclature_count": len(self._nomenclature_cache),
            "warehouses_count": len(self._warehouses_cache),
            "updated_at": normalize_text(cache.get("updated_at")),
            "last_attempt_at": normalize_text(cache.get("last_attempt_at")),
            "last_error": normalize_text(cache.get("last_error")),
            "sync_in_progress": self._catalog_sync_lock.locked(),
        }

    def _fetch_all_nomenclature_sync(self, connection: Any) -> list[tuple[str, str, str, str]]:
        query = connection.NewObject("Query")
        query.Text = f"""
ВЫБРАТЬ ПЕРВЫЕ {CATALOG_NOMENCLATURE_MAX_ROWS}
    Ном.Ссылка КАК Ссылка,
    Ном.Код КАК Код,
    Ном.Наименование КАК Наименование
ИЗ
    Справочник.Номенклатура КАК Ном
ГДЕ
    НЕ Ном.ПометкаУдаления
УПОРЯДОЧИТЬ ПО
    Ном.Наименование
"""
        selection = query.Execute().Select()
        items: list[tuple[str, str, str, str]] = []
        while selection.Next():
            items.append(
                build_nomenclature_entry(
                    ref_uuid(connection, selection.Ссылка),
                    one_c_text(connection, selection.Код),
                    one_c_text(connection, selection.Наименование),
                )
            )
        if len(items) >= CATALOG_NOMENCLATURE_MAX_ROWS:
            logger.warning(
                "Warehouse 1C nomenclature catalog hit the safety cap (%s rows) — some items may be "
                "missing from autocomplete until the cap is raised",
                CATALOG_NOMENCLATURE_MAX_ROWS,
            )
        return items

    def _fetch_all_warehouses_sync(self, connection: Any) -> list[tuple[str, str, str]]:
        query = connection.NewObject("Query")
        query.Text = f"""
ВЫБРАТЬ ПЕРВЫЕ {CATALOG_WAREHOUSES_MAX_ROWS}
    Скл.Ссылка КАК Ссылка,
    Скл.Наименование КАК Наименование
ИЗ
    Справочник.Склады КАК Скл
ГДЕ
    НЕ Скл.ПометкаУдаления
УПОРЯДОЧИТЬ ПО
    Скл.Наименование
"""
        selection = query.Execute().Select()
        items: list[tuple[str, str, str]] = []
        while selection.Next():
            items.append(
                build_warehouse_entry(
                    ref_uuid(connection, selection.Ссылка),
                    one_c_text(connection, selection.Наименование),
                )
            )
        if len(items) >= CATALOG_WAREHOUSES_MAX_ROWS:
            logger.warning(
                "Warehouse 1C warehouses catalog hit the safety cap (%s rows) — some items may be "
                "missing from autocomplete until the cap is raised",
                CATALOG_WAREHOUSES_MAX_ROWS,
            )
        return items

    def sync_catalog_from_1c(self) -> dict[str, Any]:
        """Blocking, synchronous full refresh of both directories. Meant to be
        invoked off the event loop (``asyncio.to_thread``/``run_in_threadpool``);
        internally it goes through the same connection pool as interactive
        queries (submit + block on the future), one directory at a time so it
        only ever occupies a single pool worker, leaving the rest free to
        serve interactive requests while the sync is running.
        """
        if not self._catalog_sync_lock.acquire(blocking=False):
            status = self.get_catalog_status()
            status["sync_in_progress"] = True
            return status

        cache = self.load_catalog_cache()
        cache["last_attempt_at"] = utc_now_iso()
        try:
            nomenclature = self._pool.submit(self._fetch_all_nomenclature_sync).result(
                timeout=CATALOG_SYNC_TIMEOUT_SEC
            )
            warehouses = self._pool.submit(self._fetch_all_warehouses_sync).result(
                timeout=CATALOG_SYNC_TIMEOUT_SEC
            )
            cache["nomenclature"] = nomenclature_entries_to_json_rows(nomenclature)
            cache["warehouses"] = catalog_entries_to_json_rows(warehouses)
            cache["updated_at"] = utc_now_iso()
            cache["last_error"] = ""
            self._nomenclature_cache = nomenclature
            self._warehouses_cache = warehouses
            self._rebuild_nomenclature_word_index()
        except Exception as exc:
            logger.exception("Warehouse 1C catalog sync failed")
            cache["last_error"] = format_com_error(exc)
        finally:
            self.save_catalog_cache(cache)
            self._catalog_sync_lock.release()
        return self.get_catalog_status()

    @staticmethod
    def _filter_catalog(entries: list[tuple[str, str, str]], text_cf: str, limit: int) -> list[dict[str, Any]]:
        # entries are already alphabetically sorted (the 1C fetch query orders
        # by Наименование). Plain "first N alphabetical substring matches"
        # is not the same as "best N matches": many Склады rows share a
        # generic substring (a city, "склад", "ЖК", ...) because warehouses
        # are often created one-per-employee/location, so a query can have
        # hundreds of hits and the one the user wants may sort well past the
        # cap. Rank name-starts-with above name-contains (both keep their
        # relative alphabetical order) so the most relevant hits survive the
        # cap first.
        starts: list[dict[str, Any]] = []
        contains: list[dict[str, Any]] = []
        for ref, name, name_cf in entries:
            if name_cf.startswith(text_cf):
                starts.append({"ref": ref, "name": name})
                if len(starts) >= limit:
                    break
            elif len(contains) < limit and text_cf in name_cf:
                contains.append({"ref": ref, "name": name})
        if len(starts) >= limit:
            return starts[:limit]
        return starts + contains[: limit - len(starts)]

    @staticmethod
    def _filter_nomenclature_catalog(
        entries: list[tuple[str, str, str, str]],
        text_cf: str,
        limit: int,
    ) -> list[dict[str, Any]]:
        starts: list[dict[str, Any]] = []
        contains: list[dict[str, Any]] = []
        for ref, code, name, name_cf in entries:
            code_cf = code.casefold()
            if name_cf.startswith(text_cf) or code_cf.startswith(text_cf):
                starts.append({"ref": ref, "code": code, "name": name})
                if len(starts) >= limit:
                    break
            elif len(contains) < limit and (text_cf in name_cf or text_cf in code_cf):
                contains.append({"ref": ref, "code": code, "name": name})
        if len(starts) >= limit:
            return starts[:limit]
        return starts + contains[: limit - len(starts)]

    # ------------------------------------------------------------------
    # Nomenclature / warehouse autocomplete
    # ------------------------------------------------------------------
    def _search_nomenclature_sync(self, connection: Any, text: str, limit: int) -> list[dict[str, Any]]:
        query = connection.NewObject("Query")
        query.Text = f"""
ВЫБРАТЬ ПЕРВЫЕ {limit}
    Ном.Ссылка КАК Ссылка,
    Ном.Код КАК Код,
    Ном.Наименование КАК Наименование
ИЗ
    Справочник.Номенклатура КАК Ном
ГДЕ
    (Ном.Наименование ПОДОБНО &Текст
        ИЛИ Ном.Код ПОДОБНО &Текст)
    И НЕ Ном.ПометкаУдаления
УПОРЯДОЧИТЬ ПО
    Ном.Наименование
"""
        query.SetParameter("Текст", f"%{escape_like(text)}%")
        selection = query.Execute().Select()
        items: list[dict[str, Any]] = []
        while selection.Next():
            items.append(
                {
                    "ref": ref_uuid(connection, selection.Ссылка),
                    "code": one_c_text(connection, selection.Код),
                    "name": one_c_text(connection, selection.Наименование),
                }
            )
        return items

    def _search_warehouses_sync(self, connection: Any, text: str, limit: int) -> list[dict[str, Any]]:
        query = connection.NewObject("Query")
        query.Text = f"""
ВЫБРАТЬ ПЕРВЫЕ {limit}
    Скл.Ссылка КАК Ссылка,
    Скл.Наименование КАК Наименование
ИЗ
    Справочник.Склады КАК Скл
ГДЕ
    Скл.Наименование ПОДОБНО &Текст
    И НЕ Скл.ПометкаУдаления
УПОРЯДОЧИТЬ ПО
    Скл.Наименование
"""
        query.SetParameter("Текст", f"%{escape_like(text)}%")
        selection = query.Execute().Select()
        items: list[dict[str, Any]] = []
        while selection.Next():
            items.append(
                {
                    "ref": ref_uuid(connection, selection.Ссылка),
                    "name": one_c_text(connection, selection.Наименование),
                }
            )
        return items

    async def search_nomenclature(self, text: str = "", limit: int | None = None) -> list[dict[str, Any]]:
        normalized_text = normalize_text(text)
        if len(normalized_text) < 2:
            return []
        normalized_limit = clamp_limit(limit, AUTOCOMPLETE_DEFAULT_LIMIT, AUTOCOMPLETE_MAX_LIMIT)
        if self._nomenclature_cache:
            # A rare/typo'd query never fills the result buckets and scans the
            # full ~700k-row cache (tens of ms) — keep that off the event loop.
            return await asyncio.to_thread(
                self._filter_nomenclature_catalog,
                self._nomenclature_cache,
                normalized_text.casefold(),
                normalized_limit,
            )
        return await self._run_pooled(self._search_nomenclature_sync, normalized_text, normalized_limit)

    async def search_warehouses(self, text: str = "", limit: int | None = None) -> list[dict[str, Any]]:
        normalized_text = normalize_text(text)
        if len(normalized_text) < 2:
            return []
        normalized_limit = clamp_limit(limit, AUTOCOMPLETE_DEFAULT_LIMIT, WAREHOUSE_AUTOCOMPLETE_MAX_LIMIT)
        if self._warehouses_cache:
            return await asyncio.to_thread(
                self._filter_catalog, self._warehouses_cache, normalized_text.casefold(), normalized_limit
            )
        return await self._run_pooled(self._search_warehouses_sync, normalized_text, normalized_limit)

    # ------------------------------------------------------------------
    # Employee warehouse match + smart nomenclature suggest (cache-only)
    # ------------------------------------------------------------------
    def _rebuild_nomenclature_word_index(self) -> None:
        frequency: dict[str, int] = {}
        for _ref, _code, name, _name_cf in self._nomenclature_cache:
            seen_in_row: set[str] = set()
            for token in tokenize_hub_text(name):
                if token in seen_in_row:
                    continue
                seen_in_row.add(token)
                frequency[token] = frequency.get(token, 0) + 1
            code_tokens = tokenize_hub_text(_code)
            for token in code_tokens:
                if token in seen_in_row:
                    continue
                seen_in_row.add(token)
                frequency[token] = frequency.get(token, 0) + 1
        self._word_frequency_index = frequency

    def lookup_nomenclature_ref(self, ref: str) -> dict[str, str] | None:
        normalized_ref = normalize_text(ref)
        if not normalized_ref:
            return None
        for entry_ref, code, name, _name_cf in self._nomenclature_cache:
            if entry_ref == normalized_ref:
                return {"ref": entry_ref, "code": code, "name": name}
        return None

    def lookup_warehouse_ref(self, ref: str) -> dict[str, str] | None:
        normalized_ref = normalize_text(ref)
        if not normalized_ref:
            return None
        for entry_ref, name, _name_cf in self._warehouses_cache:
            if entry_ref == normalized_ref:
                return {"ref": entry_ref, "name": name}
        return None

    def _match_employee_warehouse(self, employee_name: str) -> dict[str, Any]:
        employee_key = normalize_match_key(employee_name)
        if not employee_key:
            return {"status": "not_found", "warehouse": None, "candidates": []}

        scored: list[tuple[int, dict[str, str]]] = []
        for ref, name, _name_cf in self._warehouses_cache:
            score = fio_person_match_score(employee_name, name)
            if score <= 0:
                continue
            scored.append((score, {"ref": ref, "name": name}))

        if not scored:
            return {"status": "not_found", "warehouse": None, "candidates": []}

        scored.sort(key=lambda item: (-item[0], item[1]["name"].casefold()))
        best_score = scored[0][0]
        best = [entry for score, entry in scored if score == best_score]
        if len(best) == 1:
            return {"status": "matched", "warehouse": best[0], "candidates": []}
        return {
            "status": "ambiguous",
            "warehouse": None,
            "candidates": best[:EMPLOYEE_WAREHOUSE_MATCH_LIMIT],
        }

    def _search_nomenclature_substring(self, query_cf: str, limit: int) -> list[dict[str, Any]]:
        if not query_cf:
            return []
        return self._filter_nomenclature_catalog(self._nomenclature_cache, query_cf, limit)

    def _suggest_nomenclature_sync(self, hub_text: str, limit: int) -> dict[str, Any]:
        normalized = normalize_text(hub_text)
        if not normalized:
            return {"tried_query": "", "results": [], "source_text": ""}

        full_cf = normalized.casefold()
        if len(full_cf) >= 2:
            results = self._search_nomenclature_substring(full_cf, limit)
            if results:
                return {
                    "tried_query": normalized,
                    "results": results,
                    "source_text": normalized,
                }

        tokens = tokenize_hub_text(normalized)
        if not tokens and len(normalized) >= 2:
            tokens = [normalized.casefold()]

        tokens_sorted = sorted(
            dict.fromkeys(tokens),
            key=lambda token: (self._word_frequency_index.get(token, 0), -len(token)),
        )

        for token in tokens_sorted:
            candidate = token
            while len(candidate) >= SUGGEST_MIN_TOKEN_LEN:
                results = self._search_nomenclature_substring(candidate, limit)
                if results:
                    return {
                        "tried_query": candidate,
                        "results": results,
                        "source_text": normalized,
                    }
                candidate = candidate[:-1]

        return {
            "tried_query": tokens_sorted[0] if tokens_sorted else normalized,
            "results": [],
            "source_text": normalized,
        }

    async def get_employee_warehouse(
        self,
        employee_name: str,
        warehouse_ref: str = "",
        load_balances: bool = True,
        balances_limit: int | None = None,
    ) -> dict[str, Any]:
        normalized_name = normalize_text(employee_name)
        normalized_warehouse_ref = normalize_1c_ref(warehouse_ref)
        if not normalized_name and not normalized_warehouse_ref:
            raise Warehouse1CValidationError("employee_name или warehouse_ref обязателен")

        normalized_balances_limit = clamp_limit(balances_limit, BALANCES_DEFAULT_LIMIT, BALANCES_MAX_LIMIT)

        from backend.services.employment_status_service import resolve_employment_status

        if normalized_warehouse_ref:
            warehouse = self.lookup_warehouse_ref(normalized_warehouse_ref)
            if warehouse is None:
                raise Warehouse1CValidationError("Склад 1С не найден в локальном справочнике")
            result: dict[str, Any] = {
                "status": "matched",
                "warehouse": warehouse,
                "candidates": [],
                "balances": [],
            }
            if load_balances:
                result["balances"] = await self.get_balances(
                    warehouse_ref=warehouse["ref"],
                    limit=normalized_balances_limit,
                )
            status_name = str(warehouse.get("name") or normalized_name or "").strip()
            employment = resolve_employment_status(status_name)
            result["employment_status"] = employment.get("status")
            result["employment_label"] = employment.get("label") or ""
            result["employment_matched_name"] = employment.get("matched_name")
            return result

        match = self._match_employee_warehouse(normalized_name)
        result = {
            "status": match["status"],
            "warehouse": match.get("warehouse"),
            "candidates": match.get("candidates") or [],
            "balances": [],
        }
        if match["status"] == "matched" and load_balances and match.get("warehouse"):
            result["balances"] = await self.get_balances(
                warehouse_ref=match["warehouse"]["ref"],
                limit=normalized_balances_limit,
            )

        status_name = ""
        if match.get("warehouse"):
            status_name = str(match["warehouse"].get("name") or "").strip()
        if not status_name:
            status_name = normalized_name
        employment = resolve_employment_status(status_name)
        result["employment_status"] = employment.get("status")
        result["employment_label"] = employment.get("label") or ""
        result["employment_matched_name"] = employment.get("matched_name")
        return result

    async def suggest_nomenclature(self, text: str = "", limit: int | None = None) -> dict[str, Any]:
        normalized_text = normalize_text(text)
        if not normalized_text:
            return {"tried_query": "", "results": [], "source_text": ""}
        normalized_limit = clamp_limit(limit, SUGGEST_DEFAULT_LIMIT, AUTOCOMPLETE_MAX_LIMIT)
        if self._nomenclature_cache:
            return await asyncio.to_thread(
                self._suggest_nomenclature_sync,
                normalized_text,
                normalized_limit,
            )

        tokens = tokenize_hub_text(normalized_text)
        if not tokens and len(normalized_text) >= 2:
            tokens = [normalized_text.casefold()]
        tokens_sorted = sorted(dict.fromkeys(tokens), key=len, reverse=True)
        for token in tokens_sorted:
            candidate = token
            while len(candidate) >= SUGGEST_MIN_TOKEN_LEN:
                live_results = await self._run_pooled(
                    self._search_nomenclature_sync,
                    candidate,
                    normalized_limit,
                )
                if live_results:
                    return {
                        "tried_query": candidate,
                        "results": live_results,
                        "source_text": normalized_text,
                    }
                candidate = candidate[:-1]

        live_results = await self._run_pooled(
            self._search_nomenclature_sync,
            normalized_text,
            normalized_limit,
        )
        return {
            "tried_query": normalized_text,
            "results": live_results,
            "source_text": normalized_text,
        }

    # ------------------------------------------------------------------
    # Остатки (balances)
    # ------------------------------------------------------------------
    def _row_to_balance(self, connection: Any, row: Any) -> dict[str, Any]:
        qty = one_c_number(row.КоличествоОстаток)
        cost_acc = one_c_number(row.СтоимостьБухОстаток)
        return {
            "nomenclature_ref": ref_uuid(connection, row.Номенклатура),
            "nomenclature_code": one_c_text(connection, row.КодНоменклатуры),
            "nomenclature_name": one_c_text(connection, row.Номенклатура),
            "characteristic_name": one_c_text(connection, row.Характеристика),
            "series_ref": ref_uuid(connection, row.Серия),
            "series_name": one_c_text(connection, row.Серия),
            "series_number": one_c_text(connection, row.СерийныйНомер),
            "warehouse_ref": ref_uuid(connection, row.Склад),
            "warehouse_name": one_c_text(connection, row.Склад),
            "batch_document_name": one_c_text(connection, row.ДокументПартии),
            "batch_status_name": one_c_text(connection, row.СтатусПартии),
            "cost_method_name": one_c_text(connection, row.ВидСебестоимости),
            "qty_balance": qty,
            "cost_balance": one_c_number(row.СтоимостьОстаток),
            "cost_accounting_balance": cost_acc,
            "avg_price": round(cost_acc / qty, 2) if qty else 0.0,
            "torg12_number": one_c_text(connection, row.НомерТН),
            "torg12_date": one_c_datetime(connection, row.ДатаТН),
            "invoice_number": one_c_text(connection, row.НомерСчФ),
            "invoice_date": one_c_datetime(connection, row.ДатаСчФ),
        }

    def _get_balances_sync(
        self,
        connection: Any,
        nomenclature_ref: str,
        warehouse_ref: str,
        text: str,
        limit: int,
    ) -> list[dict[str, Any]]:
        where_clauses: list[str] = []
        nomenclature_obj = None
        warehouse_obj = None

        if nomenclature_ref:
            nomenclature_obj = self._rebuild_ref(connection, NOMENCLATURE_CATALOG, nomenclature_ref)
            where_clauses.append("О.Номенклатура = &Номенклатура")
        if warehouse_ref:
            warehouse_obj = self._rebuild_ref(connection, WAREHOUSE_CATALOG, warehouse_ref)
            where_clauses.append("О.Склад = &Склад")
        if text and not nomenclature_ref:
            where_clauses.append("О.Номенклатура.Наименование ПОДОБНО &Текст")

        if not where_clauses:
            raise Warehouse1CValidationError(
                "Укажите номенклатуру, склад или текст поиска перед запросом остатков"
            )

        where_clauses.append("О.КоличествоОстаток > 0")

        query = connection.NewObject("Query")
        query.Text = f"""
ВЫБРАТЬ ПЕРВЫЕ {limit}
    О.Номенклатура КАК Номенклатура,
    О.Номенклатура.Код КАК КодНоменклатуры,
    О.ХарактеристикаНоменклатуры КАК Характеристика,
    О.СерияНоменклатуры КАК Серия,
    О.СерияНоменклатуры.СерийныйНомер КАК СерийныйНомер,
    О.Склад КАК Склад,
    О.ДокументПартии КАК ДокументПартии,
    О.СтатусПартии КАК СтатусПартии,
    О.ВидСебестоимости КАК ВидСебестоимости,
    О.КоличествоОстаток КАК КоличествоОстаток,
    О.СтоимостьОстаток КАК СтоимостьОстаток,
    О.СтоимостьБухОстаток КАК СтоимостьБухОстаток,
    ДокументТорг12.НомерДокумента КАК НомерТН,
    ДокументТорг12.ДатаДокумента КАК ДатаТН,
    ДокументСчФ.НомерДокумента КАК НомерСчФ,
    ДокументСчФ.ДатаДокумента КАК ДатаСчФ
ИЗ
    РегистрНакопления.бит_стр_ПартииТоваровНаСкладах.Остатки КАК О
        ЛЕВОЕ СОЕДИНЕНИЕ РегистрСведений.бит_стр_ВходящиеДокументы КАК ДокументТорг12
        ПО О.ДокументПартии = ДокументТорг12.ДокументОснование
            И (ДокументТорг12.ВидДокумента = ЗНАЧЕНИЕ(Справочник.бит_стр_ВидыДокументов.ТОРГ12))
        ЛЕВОЕ СОЕДИНЕНИЕ РегистрСведений.бит_стр_ВходящиеДокументы КАК ДокументСчФ
        ПО О.ДокументПартии = ДокументСчФ.ДокументОснование
            И (ДокументСчФ.ВидДокумента = ЗНАЧЕНИЕ(Справочник.бит_стр_ВидыДокументов.СчетФактура))
ГДЕ
    {" И ".join(where_clauses)}
УПОРЯДОЧИТЬ ПО
    О.Номенклатура, О.Склад
"""
        if nomenclature_obj is not None:
            query.SetParameter("Номенклатура", nomenclature_obj)
        if warehouse_obj is not None:
            query.SetParameter("Склад", warehouse_obj)
        if text and not nomenclature_ref:
            query.SetParameter("Текст", f"%{escape_like(text)}%")

        selection = query.Execute().Select()
        rows: list[dict[str, Any]] = []
        while selection.Next():
            row = self._row_to_balance(connection, selection)
            if has_positive_qty(row.get("qty_balance")):
                rows.append(row)
        return rows

    async def get_balances(
        self,
        nomenclature_ref: str = "",
        warehouse_ref: str = "",
        text: str = "",
        limit: int | None = None,
    ) -> list[dict[str, Any]]:
        normalized_limit = clamp_limit(limit, BALANCES_DEFAULT_LIMIT, BALANCES_MAX_LIMIT)
        return await self._run_pooled(
            self._get_balances_sync,
            normalize_1c_ref(nomenclature_ref),
            normalize_1c_ref(warehouse_ref),
            normalize_text(text),
            normalized_limit,
        )

    def _match_warehouse_to_owner(
        self,
        warehouse_name: str,
        owners: list[dict[str, Any]],
    ) -> tuple[dict[str, Any] | None, int]:
        best_score = 0
        best_owner: dict[str, Any] | None = None
        for owner in owners or []:
            owner_name = str(
                owner.get("OWNER_DISPLAY_NAME")
                or owner.get("owner_display_name")
                or ""
            ).strip()
            if not owner_name:
                continue
            score = fio_person_match_score(owner_name, warehouse_name)
            if score > best_score:
                best_score = score
                best_owner = owner
        if best_score < 50:
            return None, 0
        return best_owner, best_score

    async def get_balances_with_hub(
        self,
        nomenclature_ref: str = "",
        part_no: str = "",
        nomenclature_code: str = "",
        model_name: str = "",
        hub_query: str = "",
        hub_query_source: str = "model",
        limit: int | None = None,
        db_id: str | None = None,
    ) -> list[dict[str, Any]]:
        """Balances by nomenclature enriched with Hub count and employment status."""
        from backend.database import queries as db_queries
        from backend.services.employment_status_service import resolve_employment_status_batch

        normalized_ref = normalize_1c_ref(nomenclature_ref)
        if not normalized_ref:
            raise Warehouse1CValidationError("nomenclature_ref обязателен")

        balances = await self.get_balances(
            nomenclature_ref=normalized_ref,
            limit=limit,
        )
        if not balances:
            return []

        owners = db_queries.list_owners_compact(db_id=db_id)
        owner_by_warehouse: dict[str, tuple[dict[str, Any] | None, int]] = {}
        matched_owner_nos: list[int] = []
        employment_names: list[str] = []

        for row in balances:
            warehouse_name = str(row.get("warehouse_name") or "").strip()
            cache_key = warehouse_name.casefold()
            if cache_key not in owner_by_warehouse:
                owner_by_warehouse[cache_key] = self._match_warehouse_to_owner(
                    warehouse_name,
                    owners,
                )
            owner, score = owner_by_warehouse[cache_key]
            if owner is not None:
                try:
                    owner_no = int(owner.get("OWNER_NO") or owner.get("owner_no"))
                except (TypeError, ValueError):
                    owner_no = None
                if owner_no is not None and owner_no not in matched_owner_nos:
                    matched_owner_nos.append(owner_no)
            employment_names.append(warehouse_name)

        hub_counts = db_queries.count_equipment_by_owners_hub_query(
            matched_owner_nos,
            part_no=part_no,
            part_nos=[nomenclature_code] if nomenclature_code else None,
            model_name=model_name,
            hub_query=hub_query,
            hub_query_source=hub_query_source,
            db_id=db_id,
        )
        employment_map = resolve_employment_status_batch(employment_names)

        enriched: list[dict[str, Any]] = []
        for row in balances:
            payload = dict(row)
            warehouse_name = str(row.get("warehouse_name") or "").strip()
            owner, score = owner_by_warehouse.get(warehouse_name.casefold(), (None, 0))
            hub_owner_no = None
            hub_employee_name = ""
            hub_count = None
            if owner is not None:
                try:
                    hub_owner_no = int(owner.get("OWNER_NO") or owner.get("owner_no"))
                except (TypeError, ValueError):
                    hub_owner_no = None
                hub_employee_name = str(
                    owner.get("OWNER_DISPLAY_NAME")
                    or owner.get("owner_display_name")
                    or ""
                ).strip()
                if hub_owner_no is not None:
                    hub_count = int(hub_counts.get(hub_owner_no, 0))

            if hub_owner_no is not None:
                employment = employment_map.get(warehouse_name) or {
                    "status": "unknown",
                    "label": "",
                    "matched_name": None,
                }
            else:
                # Не персональный склад — статус занятости не применяем.
                employment = {
                    "status": "unknown",
                    "label": "",
                    "matched_name": None,
                }
            payload.update(
                {
                    "hub_owner_no": hub_owner_no,
                    "hub_employee_name": hub_employee_name,
                    "hub_count": hub_count,
                    "hub_match_score": score or None,
                    "employment_status": employment.get("status"),
                    "employment_label": employment.get("label") or "",
                    "employment_matched_name": employment.get("matched_name"),
                }
            )
            enriched.append(payload)
        return enriched

    # ------------------------------------------------------------------
    # Ведомость с деньгами (movements)
    # ------------------------------------------------------------------
    def _row_to_movement(self, connection: Any, row: Any) -> dict[str, Any]:
        qty_start = one_c_number(row.КоличествоНачало)
        qty_end = one_c_number(row.КоличествоКонец)
        cost_acc_start = one_c_number(row.СтоимостьБухНачало)
        cost_acc_end = one_c_number(row.СтоимостьБухКонец)
        transfer_number = one_c_text(connection, row.НомерПеремещения)
        transfer_date = one_c_datetime(connection, row.ДатаПеремещения)
        return {
            "registrar_ref": ref_uuid(connection, row.Регистратор),
            "registrar_name": one_c_text(connection, row.Регистратор),
            "registrar_number": transfer_number,
            "registrar_date": transfer_date,
            "is_transfer": bool(transfer_number),
            "period": one_c_datetime(connection, row.Период),
            "nomenclature_ref": ref_uuid(connection, row.Номенклатура),
            "nomenclature_code": one_c_text(connection, row.КодНоменклатуры),
            "nomenclature_name": one_c_text(connection, row.Номенклатура),
            "characteristic_name": one_c_text(connection, row.Характеристика),
            "series_ref": ref_uuid(connection, row.Серия),
            "series_name": one_c_text(connection, row.Серия),
            "warehouse_ref": ref_uuid(connection, row.Склад),
            "warehouse_name": one_c_text(connection, row.Склад),
            "batch_document_name": one_c_text(connection, row.ДокументПартии),
            "qty_start": qty_start,
            "qty_end": qty_end,
            "qty_in": one_c_number(row.КоличествоПриход),
            "qty_out": one_c_number(row.КоличествоРасход),
            "cost_start": one_c_number(row.СтоимостьНачало),
            "cost_end": one_c_number(row.СтоимостьКонец),
            "cost_in": one_c_number(row.СтоимостьПриход),
            "cost_out": one_c_number(row.СтоимостьРасход),
            "cost_accounting_start": cost_acc_start,
            "cost_accounting_end": cost_acc_end,
            "cost_accounting_in": one_c_number(row.СтоимостьБухПриход),
            "cost_accounting_out": one_c_number(row.СтоимостьБухРасход),
            "avg_price_start": round(cost_acc_start / qty_start, 2) if qty_start else 0.0,
            "avg_price_end": round(cost_acc_end / qty_end, 2) if qty_end else 0.0,
            "torg12_number": one_c_text(connection, row.НомерТН),
            "torg12_date": one_c_datetime(connection, row.ДатаТН),
            "invoice_number": one_c_text(connection, row.НомерСчФ),
            "invoice_date": one_c_datetime(connection, row.ДатаСчФ),
            # Populated only when the registrar is a "Перемещение МПЗ между
            # складами" document — every other registrar type (Поступление,
            # Реализация, ...) leaves these empty via the LEFT JOIN below.
            "transfer_from_warehouse_ref": ref_uuid(connection, row.СкладОтправитель),
            "transfer_from_warehouse_name": one_c_text(connection, row.СкладОтправитель),
            "transfer_to_warehouse_ref": ref_uuid(connection, row.СкладПолучатель),
            "transfer_to_warehouse_name": one_c_text(connection, row.СкладПолучатель),
        }

    def _get_movements_sync(
        self,
        connection: Any,
        nomenclature_ref: str,
        warehouse_ref: str,
        series_ref: str,
        date_from: date | None,
        date_to: date | None,
        limit: int,
    ) -> list[dict[str, Any]]:
        if not nomenclature_ref:
            raise Warehouse1CValidationError("Для ведомости обязательно нужно указать номенклатуру")

        nomenclature_obj = self._rebuild_ref(connection, NOMENCLATURE_CATALOG, nomenclature_ref)
        condition_parts = ["Номенклатура = &Номенклатура"]

        warehouse_obj = None
        if is_meaningful_1c_ref(warehouse_ref):
            warehouse_obj = self._rebuild_ref(connection, WAREHOUSE_CATALOG, warehouse_ref)
            condition_parts.append("Склад = &Склад")

        series_obj = None
        if is_meaningful_1c_ref(series_ref):
            series_obj = self._rebuild_ref(connection, SERIES_CATALOG, series_ref)
            condition_parts.append("СерияНоменклатуры = &Серия")

        period_start_expr = "&НачалоПериода" if date_from else ""
        period_end_expr = "&КонецПериода" if date_to else ""
        condition = " И ".join(condition_parts)

        query = connection.NewObject("Query")
        query.Text = f"""
ВЫБРАТЬ ПЕРВЫЕ {limit}
    ОиО.Регистратор КАК Регистратор,
    ОиО.ПериодСекунда КАК Период,
    ОиО.Номенклатура КАК Номенклатура,
    ОиО.Номенклатура.Код КАК КодНоменклатуры,
    ОиО.ХарактеристикаНоменклатуры КАК Характеристика,
    ОиО.СерияНоменклатуры КАК Серия,
    ОиО.Склад КАК Склад,
    ОиО.ДокументПартии КАК ДокументПартии,
    ОиО.КоличествоНачальныйОстаток КАК КоличествоНачало,
    ОиО.КоличествоКонечныйОстаток КАК КоличествоКонец,
    ОиО.КоличествоПриход КАК КоличествоПриход,
    ОиО.КоличествоРасход КАК КоличествоРасход,
    ОиО.СтоимостьНачальныйОстаток КАК СтоимостьНачало,
    ОиО.СтоимостьКонечныйОстаток КАК СтоимостьКонец,
    ОиО.СтоимостьПриход КАК СтоимостьПриход,
    ОиО.СтоимостьРасход КАК СтоимостьРасход,
    ОиО.СтоимостьБухНачальныйОстаток КАК СтоимостьБухНачало,
    ОиО.СтоимостьБухКонечныйОстаток КАК СтоимостьБухКонец,
    ОиО.СтоимостьБухПриход КАК СтоимостьБухПриход,
    ОиО.СтоимостьБухРасход КАК СтоимостьБухРасход,
    ДокументТорг12.НомерДокумента КАК НомерТН,
    ДокументТорг12.ДатаДокумента КАК ДатаТН,
    ДокументСчФ.НомерДокумента КАК НомерСчФ,
    ДокументСчФ.ДатаДокумента КАК ДатаСчФ,
    Перемещение.Номер КАК НомерПеремещения,
    Перемещение.Дата КАК ДатаПеремещения,
    Перемещение.СкладОтправитель КАК СкладОтправитель,
    Перемещение.СкладПолучатель КАК СкладПолучатель
ИЗ
    РегистрНакопления.бит_стр_ПартииТоваровНаСкладах.ОстаткиИОбороты({period_start_expr}, {period_end_expr}, Авто, , {condition}) КАК ОиО
        ЛЕВОЕ СОЕДИНЕНИЕ РегистрСведений.бит_стр_ВходящиеДокументы КАК ДокументТорг12
        ПО ОиО.ДокументПартии = ДокументТорг12.ДокументОснование
            И (ДокументТорг12.ВидДокумента = ЗНАЧЕНИЕ(Справочник.бит_стр_ВидыДокументов.ТОРГ12))
        ЛЕВОЕ СОЕДИНЕНИЕ РегистрСведений.бит_стр_ВходящиеДокументы КАК ДокументСчФ
        ПО ОиО.ДокументПартии = ДокументСчФ.ДокументОснование
            И (ДокументСчФ.ВидДокумента = ЗНАЧЕНИЕ(Справочник.бит_стр_ВидыДокументов.СчетФактура))
        ЛЕВОЕ СОЕДИНЕНИЕ Документ.бит_стр_ПеремещениеМеждуСкладами КАК Перемещение
        ПО ОиО.Регистратор = Перемещение.Ссылка
УПОРЯДОЧИТЬ ПО
    ОиО.ПериодСекунда
"""
        query.SetParameter("Номенклатура", nomenclature_obj)
        if warehouse_obj is not None:
            query.SetParameter("Склад", warehouse_obj)
        if series_obj is not None:
            query.SetParameter("Серия", series_obj)
        if date_from:
            query.SetParameter("НачалоПериода", datetime(date_from.year, date_from.month, date_from.day))
        if date_to:
            query.SetParameter(
                "КонецПериода",
                datetime(date_to.year, date_to.month, date_to.day, 23, 59, 59),
            )

        selection = query.Execute().Select()
        rows: list[dict[str, Any]] = []
        while selection.Next():
            row = self._row_to_movement(connection, selection)
            if has_positive_qty(row.get("qty_end")):
                rows.append(row)
        return rows

    async def get_movements(
        self,
        nomenclature_ref: str,
        warehouse_ref: str = "",
        series_ref: str = "",
        date_from: str | None = None,
        date_to: str | None = None,
        limit: int | None = None,
    ) -> list[dict[str, Any]]:
        normalized_nomenclature_ref = normalize_1c_ref(nomenclature_ref)
        if not normalized_nomenclature_ref:
            raise Warehouse1CValidationError("nomenclature_ref обязателен для ведомости движений")
        parsed_date_from = parse_date_param(date_from, "date_from")
        parsed_date_to = parse_date_param(date_to, "date_to")
        normalized_limit = clamp_limit(limit, MOVEMENTS_DEFAULT_LIMIT, MOVEMENTS_MAX_LIMIT)
        return await self._run_pooled(
            self._get_movements_sync,
            normalized_nomenclature_ref,
            normalize_1c_ref(warehouse_ref),
            normalize_1c_ref(series_ref),
            parsed_date_from,
            parsed_date_to,
            normalized_limit,
        )

    # ------------------------------------------------------------------
    # Movement / transfer detail (registrar drill-down + attached files)
    # ------------------------------------------------------------------
    @staticmethod
    def _is_permission_denied_error(exc: Exception) -> bool:
        message = format_com_error(exc).casefold()
        return "недостаточно прав" in message

    def _get_attached_files_sync(self, connection: Any, owner_ref: Any) -> dict[str, Any]:
        # Standard BSP attached-files register. The integration account may lack
        # read rights even though accountants see files in the thick client.
        where_variants = (
            "ПФ.ОбъектСФайлами = &Объект",
            "ПФ.ВладелецФайла = &Объект",
            "ПФ.ОбъектВладелец = &Объект",
        )
        last_error = ""
        for where_expr in where_variants:
            try:
                query = connection.NewObject("Query")
                query.Text = f"""
ВЫБРАТЬ
    ПФ.ПрисоединенныйФайл.Наименование КАК Имя,
    ПФ.ПрисоединенныйФайл.Расширение КАК Расширение,
    ПФ.ПрисоединенныйФайл.Размер КАК Размер,
    ПФ.ПрисоединенныйФайл КАК СсылкаФайла
ИЗ
    РегистрСведений.ПрисоединенныеФайлы КАК ПФ
ГДЕ
    {where_expr}
"""
                query.SetParameter("Объект", owner_ref)
                selection = query.Execute().Select()
                files: list[dict[str, Any]] = []
                while selection.Next():
                    name = one_c_text(connection, selection.Имя)
                    extension = one_c_text(connection, selection.Расширение)
                    display_name = name
                    if extension and not name.lower().endswith(f".{extension.lower()}"):
                        display_name = f"{name}.{extension}" if name else f"file.{extension}"
                    files.append(
                        {
                            "ref": ref_uuid(connection, selection.СсылкаФайла),
                            "name": display_name or "Без имени",
                            "extension": extension,
                            "size": one_c_number(selection.Размер),
                        }
                    )
                return {
                    "status": "ok",
                    "files": files,
                    "message": "",
                }
            except Exception as exc:
                last_error = format_com_error(exc)
                if self._is_permission_denied_error(exc):
                    return {
                        "status": "access_denied",
                        "files": [],
                        "message": (
                            "У учётной записи интеграции нет прав на чтение "
                            "регистра «ПрисоединенныеФайлы» в 1С. Попросите "
                            "администратора 1С выдать право чтения для КозловскийМЕ."
                        ),
                    }
                if "поле не найдено" in last_error.casefold():
                    continue
                if "таблица не найдена" in last_error.casefold():
                    return {
                        "status": "unsupported",
                        "files": [],
                        "message": "В этой базе 1С не найден стандартный регистр присоединённых файлов.",
                    }

        return {
            "status": "empty",
            "files": [],
            "message": last_error or "Прикреплённые файлы не найдены.",
        }

    def _get_movement_detail_sync(self, connection: Any, registrar_ref: str) -> dict[str, Any]:
        owner_ref = self._rebuild_document_ref(connection, TRANSFER_DOCUMENT, registrar_ref)
        query = connection.NewObject("Query")
        query.Text = f"""
ВЫБРАТЬ
    Пер.Номер КАК Номер,
    Пер.Дата КАК Дата,
    Пер.СкладОтправитель КАК СкладОтправитель,
    Пер.СкладПолучатель КАК СкладПолучатель,
    Пер.Комментарий КАК Комментарий
ИЗ
    Документ.{TRANSFER_DOCUMENT} КАК Пер
ГДЕ
    Пер.Ссылка = &Ссылка
"""
        query.SetParameter("Ссылка", owner_ref)
        selection = query.Execute().Select()
        if not selection.Next():
            raise Warehouse1CValidationError("Документ перемещения не найден по указанной ссылке")

        attached = self._get_attached_files_sync(connection, owner_ref)
        return {
            "registrar_ref": normalize_text(registrar_ref),
            "registrar_name": one_c_text(connection, owner_ref),
            "registrar_number": one_c_text(connection, selection.Номер),
            "registrar_date": one_c_datetime(connection, selection.Дата),
            "is_transfer": True,
            "transfer_from_warehouse_ref": ref_uuid(connection, selection.СкладОтправитель),
            "transfer_from_warehouse_name": one_c_text(connection, selection.СкладОтправитель),
            "transfer_to_warehouse_ref": ref_uuid(connection, selection.СкладПолучатель),
            "transfer_to_warehouse_name": one_c_text(connection, selection.СкладПолучатель),
            "comment": one_c_text(connection, selection.Комментарий),
            "files_status": attached["status"],
            "files_message": attached["message"],
            "files": attached["files"],
        }

    async def get_movement_detail(self, registrar_ref: str) -> dict[str, Any]:
        normalized_ref = normalize_text(registrar_ref)
        if not normalized_ref:
            raise Warehouse1CValidationError("registrar_ref обязателен")
        return await self._run_pooled(self._get_movement_detail_sync, normalized_ref)


warehouse_1c_service = Warehouse1CService()


async def background_warehouse_1c_catalog_sync_loop() -> None:
    interval = env_positive_int(
        "WAREHOUSE_1C_CATALOG_SYNC_INTERVAL_SECONDS",
        DEFAULT_CATALOG_SYNC_INTERVAL_SECONDS,
        300,
    )
    await asyncio.sleep(30)
    while True:
        try:
            logger.info("Starting scheduled warehouse 1C catalog sync")
            status = await asyncio.to_thread(warehouse_1c_service.sync_catalog_from_1c)
            logger.info(
                "Scheduled warehouse 1C catalog sync finished: nomenclature=%s warehouses=%s error=%s",
                status.get("nomenclature_count"),
                status.get("warehouses_count"),
                status.get("last_error") or "-",
            )
            await asyncio.sleep(interval)
        except asyncio.CancelledError:
            logger.info("Warehouse 1C catalog sync loop cancelled")
            break
        except Exception as exc:
            logger.error("Warehouse 1C catalog sync loop failed: %s", exc)
            await asyncio.sleep(300)
