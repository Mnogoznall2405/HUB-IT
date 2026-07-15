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
  1C on every keystroke. If neither indexed nor legacy snapshot is available,
  autocomplete fails fast and asks an administrator to refresh the catalogue.
"""
from __future__ import annotations

import asyncio
import base64
import binascii
from bisect import insort
import gc
import logging
import os
import re
import threading
import time
from concurrent.futures import Future, ThreadPoolExecutor
from datetime import date, datetime, timezone
from typing import Any, Callable

from backend.json_db.manager import JSONDataManager
from backend.services.one_c_catalog_search import (
    catalog_entry_match_rank,
    catalog_query_tokens,
    catalog_rows_fingerprint,
)
from backend.services.warehouse_1c_scope import (
    Warehouse1CAllScopeConfigurationError,
    select_hub_db_configs_for_scope,
)


logger = logging.getLogger(__name__)

DEFAULT_1C_SERVER = "tmn-srv-1c-01.zsgp.corp,tmn-srv-1c-02.zsgp.corp"
DEFAULT_1C_REF = "buh20"

NOMENCLATURE_CATALOG = "Номенклатура"
WAREHOUSE_CATALOG = "Склады"
SERIES_CATALOG = "бит_стр_СерииНоменклатуры"
TRANSFER_DOCUMENT = "бит_стр_ПеремещениеМеждуСкладами"
RECEIPT_DOCUMENT = "бит_стр_ПриходныйОрдер"
EXPENSE_DOCUMENT = "бит_стр_РасходныйОрдер"
ATTACHED_FILES_CATALOG = "бит_ХранилищеДополнительнойИнформации"

# Registrar documents that can be opened from the movements grid.
# Order matters for UUID resolution: try the most common warehouse docs first.
WAREHOUSE_REGISTRAR_DOCUMENTS: tuple[dict[str, Any], ...] = (
    {
        "name": TRANSFER_DOCUMENT,
        "key": "transfer",
        "title": "Перемещение между складами",
        "has_route": True,
    },
    {
        "name": RECEIPT_DOCUMENT,
        "key": "receipt",
        "title": "Приходный ордер",
        "has_route": False,
    },
    {
        "name": EXPENSE_DOCUMENT,
        "key": "expense",
        "title": "Расходный ордер",
        "has_route": False,
    },
)

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
DEFAULT_MAX_ATTACHED_FILE_BYTES = 25 * 1024 * 1024

QUERY_TIMEOUT_SEC = 45
MAX_CONCURRENT_1C_CALLS = 2
MAX_QUEUED_1C_CALLS = 16
COM_CIRCUIT_BREAKER_FAILURES = 4
COM_CIRCUIT_BREAKER_COOLDOWN_SECONDS = 60
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
CATALOG_APP_RETRY_COOLDOWN_SECONDS = 60
CATALOG_SYNC_LEADER_LOCK_KEY = 48151624
PROCESS_BRIDGE_DISPATCHER = "backend.services.warehouse_1c_process_dispatcher:dispatch"
PROCESS_BRIDGE_OPERATIONS = (
    "warmup",
    "balances",
    "balances_batch",
    "catalog_sync",
    "movements",
)
_PROCESS_BRIDGE_DISABLED = object()


class Warehouse1CValidationError(ValueError):
    """Raised for bad/insufficient filters — mapped to HTTP 400/422."""


class Warehouse1CQueryError(RuntimeError):
    """Raised for 1C connection/query failures — mapped to HTTP 502."""


class Warehouse1CCatalogUnavailableError(RuntimeError):
    """Raised when autocomplete has neither a snapshot nor a memory fallback."""


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


def encode_movement_cursor(offset: int) -> str:
    payload = f"movement-offset:{max(0, int(offset))}".encode("ascii")
    return base64.urlsafe_b64encode(payload).decode("ascii").rstrip("=")


def decode_movement_cursor(value: str | None) -> int:
    text = normalize_text(value)
    if not text:
        return 0
    try:
        padded = text + "=" * (-len(text) % 4)
        decoded = base64.urlsafe_b64decode(padded.encode("ascii")).decode("ascii")
        prefix, raw_offset = decoded.split(":", 1)
        if prefix != "movement-offset":
            raise ValueError("unexpected cursor")
        return max(0, int(raw_offset))
    except (ValueError, UnicodeDecodeError, binascii.Error) as exc:
        raise Warehouse1CValidationError("Некорректный cursor движений") from exc


def utc_now_iso() -> str:
    return datetime.now(timezone.utc).isoformat()


def env_positive_int(name: str, default: int, minimum: int) -> int:
    try:
        return max(int(os.getenv(name, str(default)) or default), minimum)
    except Exception:
        return max(int(default), minimum)


def max_attached_file_bytes() -> int:
    return env_positive_int(
        "WAREHOUSE_1C_MAX_ATTACHED_FILE_BYTES",
        DEFAULT_MAX_ATTACHED_FILE_BYTES,
        1024,
    )


def empty_catalog_cache() -> dict[str, Any]:
    return {
        "nomenclature": [],
        "warehouses": [],
        "updated_at": "",
        "last_attempt_at": "",
        "last_error": "",
        "nomenclature_fingerprint": "",
        "warehouses_fingerprint": "",
        "nomenclature_truncated": False,
        "warehouses_truncated": False,
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


def sort_catalog_json_rows(rows: list[list[str]]) -> list[list[str]]:
    """Canonicalize a catalogue snapshot independently of 1C row order."""
    rows.sort(key=lambda row: tuple(str(value or "") for value in row))
    return rows


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


def search_text_tokens(text: str) -> list[str]:
    """Split a user query into AND-tokens for smart nomenclature search."""
    return catalog_query_tokens(normalize_text(text))


def haystack_matches_all_tokens(haystack: str, tokens: list[str]) -> bool:
    if not tokens:
        return False
    hay = str(haystack or "").casefold()
    return all(token in hay for token in tokens)


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


def _guess_extension(filename: str) -> str:
    text = normalize_text(filename)
    if "." not in text:
        return ""
    return text.rsplit(".", 1)[-1].lower()[:32]


def _guess_content_type(filename: str) -> str:
    ext = _guess_extension(filename)
    mapping = {
        "pdf": "application/pdf",
        "png": "image/png",
        "jpg": "image/jpeg",
        "jpeg": "image/jpeg",
        "gif": "image/gif",
        "tif": "image/tiff",
        "tiff": "image/tiff",
        "bmp": "image/bmp",
        "doc": "application/msword",
        "docx": "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
        "xls": "application/vnd.ms-excel",
        "xlsx": "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
        "txt": "text/plain; charset=utf-8",
        "rtf": "application/rtf",
        "zip": "application/zip",
    }
    return mapping.get(ext, "application/octet-stream")


class _Warehouse1CConnectionPool:
    """Keeps up to ``size`` persistent 1C COM connections alive for the life
    of the process, one per worker thread, instead of reconnecting on every
    call — ``Connect()`` (full login + session setup on the 1C cluster) is
    the dominant cost of a request, not the query that follows it.
    """

    def __init__(
        self,
        connect_fn: Callable[[], Any],
        size: int,
        *,
        queue_limit: int = MAX_QUEUED_1C_CALLS,
    ) -> None:
        self._connect_fn = connect_fn
        self._local = threading.local()
        self._size = max(1, int(size))
        self._queue_limit = max(0, int(queue_limit))
        self._capacity = self._size + self._queue_limit
        self._slots = threading.BoundedSemaphore(self._capacity)
        self._metrics_lock = threading.Lock()
        self._in_flight = 0
        self._completed = 0
        self._failed = 0
        self._timed_out = 0
        self._consecutive_failures = 0
        self._circuit_open_until = 0.0
        self._last_error = ""
        # The initializer only sets up the COM apartment on the worker
        # thread — it does NOT connect to 1C. If 1C is temporarily
        # unreachable that must not permanently break the whole pool (a
        # failing initializer would turn the executor into a BrokenThreadPool
        # for every future submission, forever). The actual 1C connection is
        # created lazily, on first use, inside each job.
        self._executor = ThreadPoolExecutor(
            max_workers=self._size,
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
            self._record_completion(success=True)
            raise Warehouse1CValidationError(validation_error_message)
        if query_error_message is not None:
            self._record_completion(success=False, error=query_error_message)
            raise Warehouse1CQueryError(query_error_message)
        if has_result:
            self._record_completion(success=True)
            return result
        self._record_completion(success=False, error="Неизвестная ошибка при обращении к 1С")
        raise Warehouse1CQueryError("Неизвестная ошибка при обращении к 1С")

    def submit(self, func: Callable[..., Any], *args: Any, **kwargs: Any) -> "Future[Any]":
        now = time.monotonic()
        with self._metrics_lock:
            if self._circuit_open_until > now:
                remaining = max(1, int(self._circuit_open_until - now))
                raise Warehouse1CQueryError(
                    f"Интеграция 1С временно приостановлена после ошибок; повторите через {remaining} сек."
                )
        if not self._slots.acquire(blocking=False):
            raise Warehouse1CQueryError(
                "Очередь запросов к 1С заполнена; повторите запрос позже"
            )
        with self._metrics_lock:
            self._in_flight += 1
        try:
            future = self._executor.submit(self._run_job, func, args, kwargs)
        except Exception:
            with self._metrics_lock:
                self._in_flight = max(0, self._in_flight - 1)
            self._slots.release()
            raise

        def _release_slot(_future: Future[Any]) -> None:
            self._slots.release()

        future.add_done_callback(_release_slot)
        return future

    def _record_completion(self, *, success: bool, error: str = "") -> None:
        with self._metrics_lock:
            self._in_flight = max(0, self._in_flight - 1)
            self._completed += 1
            if success:
                self._consecutive_failures = 0
                return
            self._failed += 1
            self._consecutive_failures += 1
            self._last_error = str(error or "Ошибка обращения к 1С")[:500]
            if self._consecutive_failures >= COM_CIRCUIT_BREAKER_FAILURES:
                self._circuit_open_until = time.monotonic() + COM_CIRCUIT_BREAKER_COOLDOWN_SECONDS

    def record_timeout(self) -> None:
        """Expose wait timeouts without pretending a hung COM call returned."""
        with self._metrics_lock:
            self._timed_out += 1
            self._failed += 1
            self._consecutive_failures += 1
            self._last_error = "1С не ответила вовремя"
            if self._consecutive_failures >= COM_CIRCUIT_BREAKER_FAILURES:
                self._circuit_open_until = time.monotonic() + COM_CIRCUIT_BREAKER_COOLDOWN_SECONDS

    def get_status(self) -> dict[str, Any]:
        with self._metrics_lock:
            now = time.monotonic()
            open_for = max(0, int(self._circuit_open_until - now))
            return {
                "workers": self._size,
                "queue_limit": self._queue_limit,
                "in_flight": self._in_flight,
                "queue_length": max(0, self._in_flight - self._size),
                "completed": self._completed,
                "failed": self._failed,
                "timed_out": self._timed_out,
                "consecutive_failures": self._consecutive_failures,
                "circuit_breaker": "open" if open_for else "closed",
                "retry_after_seconds": open_for,
                "last_error": self._last_error,
            }

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
    # A process can host multiple API/test service instances.  Parsing a
    # ~700k-row cache and rebuilding the token frequency map for each one is
    # both expensive and needlessly multiplies memory.  Instances using the
    # normal shared store reuse one immutable snapshot; explicit test/custom
    # stores still remain isolated.
    _shared_catalog_lock = threading.Lock()
    _shared_catalog_snapshot: tuple[
        list[tuple[str, str, str, str]],
        list[tuple[str, str, str]],
        dict[str, int],
    ] | None = None

    def __init__(
        self,
        data_manager: JSONDataManager | None = None,
        *,
        enable_process_bridge: bool | None = None,
        catalog_snapshot_store: Any | None = None,
    ) -> None:
        self._pool = _Warehouse1CConnectionPool(self._connect, MAX_CONCURRENT_1C_CALLS)
        configured_bridge = str(os.getenv("WAREHOUSE_1C_PROCESS_BRIDGE_ENABLED", "")).strip().lower()
        self._process_bridge_enabled = (
            configured_bridge in {"1", "true", "yes", "on"}
            if enable_process_bridge is None
            else bool(enable_process_bridge)
        )
        self._process_bridge: Any | None = None
        self._process_bridge_error = ""
        if self._process_bridge_enabled:
            try:
                from backend.services.warehouse_1c_process_bridge import Warehouse1CProcessBridge

                dispatcher_path = (
                    str(os.getenv("WAREHOUSE_1C_BRIDGE_DISPATCHER") or "").strip()
                    or PROCESS_BRIDGE_DISPATCHER
                )
                raw_operations = str(os.getenv("WAREHOUSE_1C_BRIDGE_READ_OPERATIONS") or "").strip()
                operations = (
                    [part.strip().lower() for part in raw_operations.split(",") if part.strip()]
                    if raw_operations
                    else PROCESS_BRIDGE_OPERATIONS
                )
                self._process_bridge = Warehouse1CProcessBridge(
                    dispatcher_path,
                    allowed_operations=operations,
                    queue_limit=env_positive_int("WAREHOUSE_1C_BRIDGE_QUEUE_LIMIT", MAX_QUEUED_1C_CALLS, 0),
                    failure_threshold=env_positive_int(
                        "WAREHOUSE_1C_BRIDGE_FAILURE_THRESHOLD",
                        COM_CIRCUIT_BREAKER_FAILURES,
                        1,
                    ),
                    cooldown_seconds=env_positive_int(
                        "WAREHOUSE_1C_BRIDGE_COOLDOWN_SECONDS",
                        COM_CIRCUIT_BREAKER_COOLDOWN_SECONDS,
                        1,
                    ),
                    maximum_message_bytes=env_positive_int(
                        "WAREHOUSE_1C_BRIDGE_MAX_MESSAGE_BYTES",
                        8 * 1024 * 1024,
                        1024,
                    ),
                )
            except Exception as exc:
                self._process_bridge_error = str(exc)[:500]
                logger.exception("Warehouse 1C process bridge configuration failed")
        self.data_manager = data_manager or JSONDataManager()
        self._uses_shared_catalog = data_manager is None
        # Production backends use an app-owned indexed snapshot whenever the
        # app DB is configured.  A custom JSONDataManager is primarily a test
        # / recovery seam, so it intentionally remains on the legacy path
        # unless a caller explicitly injects an indexed store.
        self._catalog_snapshot_store: Any | None = catalog_snapshot_store
        if self._catalog_snapshot_store is None and self._uses_shared_catalog:
            try:
                from backend.services.one_c_catalog_snapshot_service import OneCCatalogSnapshotStore

                candidate_store = OneCCatalogSnapshotStore()
                if candidate_store.enabled:
                    self._catalog_snapshot_store = candidate_store
            except Exception as exc:
                # The JSON cache remains an explicit rollback/fallback path;
                # failing to configure the optional app snapshot must never
                # turn a read-only 1C endpoint into a write path or crash
                # backend startup.
                logger.warning("Warehouse 1C app catalogue store is unavailable: %s", exc)
        self._legacy_catalog_loaded = False
        self._catalog_sync_lock = threading.Lock()
        self._catalog_leader_lock = threading.Lock()
        self._catalog_mode_lock = threading.Lock()
        self._catalog_read_mode = "unavailable"
        self._catalog_fallback_reason = "catalog_not_loaded"
        self._catalog_app_retry_after = 0.0
        self._catalog_app_status_cache: dict[str, Any] | None = None
        self._catalog_leader_status: dict[str, Any] = {
            "mode": "not_checked",
            "is_leader": False,
            "last_checked_at": "",
        }
        startup_app_status = self._app_catalog_status() if self._catalog_snapshot_store is not None else None
        if startup_app_status and startup_app_status.get("has_snapshot"):
            self._nomenclature_cache = []
            self._warehouses_cache = []
            self._word_frequency_index = {}
            self._catalog_read_mode = "app_snapshot"
            self._catalog_fallback_reason = ""
        elif self._uses_shared_catalog:
            cls = type(self)
            with cls._shared_catalog_lock:
                snapshot = cls._shared_catalog_snapshot
                if snapshot is None:
                    cache = self.load_catalog_cache()
                    nomenclature = json_rows_to_nomenclature_entries(cache.get("nomenclature"))
                    warehouses = json_rows_to_catalog_entries(cache.get("warehouses"))
                    word_index = self._build_nomenclature_word_index(nomenclature)
                    snapshot = (nomenclature, warehouses, word_index)
                    cls._shared_catalog_snapshot = snapshot
                self._nomenclature_cache, self._warehouses_cache, self._word_frequency_index = snapshot
                self._legacy_catalog_loaded = True
            self._catalog_read_mode = (
                "memory_fallback" if self._nomenclature_cache or self._warehouses_cache else "unavailable"
            )
            self._catalog_fallback_reason = (
                "snapshot_empty" if self._catalog_snapshot_store is not None else "app_storage_disabled"
            )
            if self._catalog_snapshot_store is not None:
                self._catalog_app_retry_after = time.monotonic() + CATALOG_APP_RETRY_COOLDOWN_SECONDS
        else:
            cache = self.load_catalog_cache()
            self._nomenclature_cache = json_rows_to_nomenclature_entries(cache.get("nomenclature"))
            self._warehouses_cache = json_rows_to_catalog_entries(cache.get("warehouses"))
            self._word_frequency_index = self._build_nomenclature_word_index(self._nomenclature_cache)
            self._legacy_catalog_loaded = True
            self._catalog_read_mode = (
                "memory_fallback" if self._nomenclature_cache or self._warehouses_cache else "unavailable"
            )
            self._catalog_fallback_reason = (
                "snapshot_empty" if self._catalog_snapshot_store is not None else "app_storage_disabled"
            )
            if self._catalog_snapshot_store is not None:
                self._catalog_app_retry_after = time.monotonic() + CATALOG_APP_RETRY_COOLDOWN_SECONDS

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
            self._pool.record_timeout()
            raise Warehouse1CQueryError(
                "1С не ответила вовремя. Попробуйте сузить фильтр (номенклатура/склад) и повторить запрос."
            ) from exc

    async def _run_process_bridge(
        self,
        operation: str,
        payload: dict[str, Any],
        *,
        timeout: float = QUERY_TIMEOUT_SEC,
    ) -> Any:
        """Run one typed read through the killable COM child when enabled."""
        if not self._process_bridge_enabled:
            return _PROCESS_BRIDGE_DISABLED
        if self._process_bridge is None:
            detail = self._process_bridge_error or "не настроен"
            raise Warehouse1CQueryError(f"Process bridge 1С недоступен: {detail}")
        try:
            return await asyncio.to_thread(self._run_process_bridge_sync, operation, payload, timeout=timeout)
        except Exception as exc:
            # A bridge timeout/restart is an unknown result.  Never fall back
            # to in-process COM, otherwise the feature flag would silently
            # recreate the very hung-call failure mode it is meant to close.
            raise Warehouse1CQueryError(f"Process bridge 1С: {exc}") from exc

    @staticmethod
    def _warmup_connection_sync(connection: Any) -> dict[str, Any]:
        """Confirm that a read-only COM connection is open in its worker."""
        return {"ready": connection is not None, "warmed_at": utc_now_iso()}

    def warmup_connection(self) -> dict[str, Any]:
        """Open the COM read connection before the first interactive request."""
        bridged = self._run_process_bridge_sync("warmup", {}, timeout=QUERY_TIMEOUT_SEC)
        if bridged is not _PROCESS_BRIDGE_DISABLED:
            return dict(bridged or {"ready": True})
        result = self._pool.submit(self._warmup_connection_sync).result(timeout=QUERY_TIMEOUT_SEC)
        return dict(result or {"ready": True})

    def _run_process_bridge_sync(
        self,
        operation: str,
        payload: dict[str, Any],
        *,
        timeout: float = QUERY_TIMEOUT_SEC,
    ) -> Any:
        if not self._process_bridge_enabled:
            return _PROCESS_BRIDGE_DISABLED
        if self._process_bridge is None:
            detail = self._process_bridge_error or "не настроен"
            raise Warehouse1CQueryError(f"Process bridge 1С недоступен: {detail}")
        try:
            return self._process_bridge.call(operation, payload, timeout=timeout)
        except Exception as exc:
            raise Warehouse1CQueryError(f"Process bridge 1С: {exc}") from exc

    def shutdown(self) -> None:
        if self._process_bridge is not None:
            try:
                self._process_bridge.shutdown()
            except Exception:
                logger.exception("Warehouse 1C process bridge shutdown failed")
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

    def _app_catalog_status(self, *, force: bool = False) -> dict[str, Any] | None:
        store = self._catalog_snapshot_store
        if store is None:
            return None
        if (
            not force
            and self._catalog_read_mode != "app_snapshot"
            and time.monotonic() < self._catalog_app_retry_after
        ):
            return self._catalog_app_status_cache
        try:
            status = store.get_status(source_base=DEFAULT_1C_REF)
            result = dict(status) if isinstance(status, dict) else None
            self._catalog_app_status_cache = result
            return result
        except Exception as exc:
            logger.warning("Warehouse 1C app catalogue store status failed: %s", exc)
            return None

    def _ensure_legacy_catalog_cache_loaded(self) -> dict[str, Any]:
        """Load JSON only when the app snapshot cannot answer a read.

        This is deliberately lazy for APP_DATABASE_URL deployments: the
        normal backend path no longer parses the complete directory and builds
        the Python frequency map merely because a worker starts.
        """
        if self._legacy_catalog_loaded:
            return self.load_catalog_cache()
        cache = self.load_catalog_cache()
        self._nomenclature_cache = json_rows_to_nomenclature_entries(cache.get("nomenclature"))
        self._warehouses_cache = json_rows_to_catalog_entries(cache.get("warehouses"))
        self._word_frequency_index = self._build_nomenclature_word_index(self._nomenclature_cache)
        self._legacy_catalog_loaded = True
        if self._catalog_snapshot_store is None and self._uses_shared_catalog:
            cls = type(self)
            with cls._shared_catalog_lock:
                cls._shared_catalog_snapshot = (
                    self._nomenclature_cache,
                    self._warehouses_cache,
                    self._word_frequency_index,
                )
        return cache

    def _clear_legacy_catalog_memory(self) -> None:
        self._nomenclature_cache = []
        self._warehouses_cache = []
        self._word_frequency_index = {}
        self._legacy_catalog_loaded = False

    def _activate_app_catalog(self) -> None:
        with self._catalog_mode_lock:
            self._clear_legacy_catalog_memory()
            self._catalog_read_mode = "app_snapshot"
            self._catalog_fallback_reason = ""
            self._catalog_app_retry_after = 0.0

    def _activate_memory_catalog(self, reason: str) -> bool:
        with self._catalog_mode_lock:
            self._ensure_legacy_catalog_cache_loaded()
            available = bool(self._nomenclature_cache or self._warehouses_cache)
            self._catalog_read_mode = "memory_fallback" if available else "unavailable"
            self._catalog_fallback_reason = normalize_text(reason) or "snapshot_unavailable"
            self._catalog_app_retry_after = time.monotonic() + CATALOG_APP_RETRY_COOLDOWN_SECONDS
            return available

    def _refresh_catalog_snapshot_from_store(self) -> dict[str, Any]:
        """Refresh this backend's read snapshot after an external bridge sync."""
        app_status = self._app_catalog_status(force=True)
        if app_status and app_status.get("has_snapshot"):
            self._activate_app_catalog()
            return empty_catalog_cache()
        cache = self.load_catalog_cache()
        nomenclature = json_rows_to_nomenclature_entries(cache.get("nomenclature"))
        warehouses = json_rows_to_catalog_entries(cache.get("warehouses"))
        self._nomenclature_cache = nomenclature
        self._warehouses_cache = warehouses
        self._word_frequency_index = self._build_nomenclature_word_index(nomenclature)
        if self._uses_shared_catalog:
            cls = type(self)
            with cls._shared_catalog_lock:
                cls._shared_catalog_snapshot = (
                    self._nomenclature_cache,
                    self._warehouses_cache,
                    self._word_frequency_index,
                )
        self._legacy_catalog_loaded = True
        self._catalog_read_mode = "memory_fallback" if nomenclature or warehouses else "unavailable"
        self._catalog_fallback_reason = "snapshot_empty"
        return cache

    def _catalog_status_payload(
        self,
        *,
        nomenclature_count: int,
        warehouses_count: int,
        updated_at: str,
        last_attempt_at: str,
        last_error: str,
        nomenclature_truncated: bool,
        warehouses_truncated: bool,
        source: str,
        app_snapshot: dict[str, Any] | None = None,
    ) -> dict[str, Any]:
        age_seconds: int | None = None
        if updated_at:
            try:
                parsed = datetime.fromisoformat(updated_at.replace("Z", "+00:00"))
                if parsed.tzinfo is None:
                    parsed = parsed.replace(tzinfo=timezone.utc)
                age_seconds = max(0, int((datetime.now(timezone.utc) - parsed).total_seconds()))
            except (TypeError, ValueError):
                age_seconds = None
        stale_after = env_positive_int("WAREHOUSE_1C_CATALOG_STALE_SECONDS", 7200, 60)
        nomenclature_truncated = bool(nomenclature_truncated)
        warehouses_truncated = bool(warehouses_truncated)
        last_error = normalize_text(last_error)
        if last_error:
            status = "error"
        elif not updated_at:
            status = "unknown"
        elif nomenclature_truncated or warehouses_truncated:
            status = "incomplete"
        elif age_seconds is not None and age_seconds > stale_after:
            status = "stale"
        else:
            status = "ok"
        result = {
            "nomenclature_count": int(nomenclature_count),
            "warehouses_count": int(warehouses_count),
            "updated_at": updated_at,
            "last_success_at": updated_at,
            "last_attempt_at": last_attempt_at,
            "last_error": last_error,
            "sync_in_progress": self._catalog_sync_lock.locked(),
            "age_seconds": age_seconds,
            "stale_after_seconds": stale_after,
            "nomenclature_truncated": nomenclature_truncated,
            "warehouses_truncated": warehouses_truncated,
            "complete": bool(updated_at) and not nomenclature_truncated and not warehouses_truncated and not last_error,
            "status": status,
            "source": source,
            "read_mode": self._catalog_read_mode,
            "fallback_reason": self._catalog_fallback_reason,
        }
        if app_snapshot is not None:
            result["app_snapshot"] = app_snapshot
        return result

    def get_catalog_status(self) -> dict[str, Any]:
        app_status = self._app_catalog_status()
        app_retry_blocked = (
            self._catalog_read_mode != "app_snapshot"
            and time.monotonic() < self._catalog_app_retry_after
        )
        if app_status and app_status.get("has_snapshot") and not app_retry_blocked:
            self._activate_app_catalog()
            result = self._catalog_status_payload(
                nomenclature_count=int(app_status.get("nomenclature_count") or 0),
                warehouses_count=int(app_status.get("warehouses_count") or 0),
                updated_at=normalize_text(app_status.get("updated_at")),
                last_attempt_at=normalize_text(app_status.get("last_attempt_at")),
                last_error=normalize_text(app_status.get("last_error")),
                nomenclature_truncated=bool(app_status.get("nomenclature_truncated")),
                warehouses_truncated=bool(app_status.get("warehouses_truncated")),
                source="app_db_indexed_snapshot",
                app_snapshot=app_status,
            )
            result["generation"] = int(app_status.get("generation") or 0)
            return result

        fallback_reason = self._catalog_fallback_reason if app_retry_blocked else "snapshot_empty"
        if app_status is None and not app_retry_blocked:
            fallback_reason = "snapshot_unavailable"
        elif app_status is not None and normalize_text(app_status.get("last_error")) and not app_retry_blocked:
            fallback_reason = "snapshot_error"
        self._activate_memory_catalog(fallback_reason)
        cache = self.load_catalog_cache()
        fallback_error = normalize_text(cache.get("last_error"))
        if app_status and normalize_text(app_status.get("last_error")):
            app_error = normalize_text(app_status.get("last_error"))
            fallback_error = fallback_error or f"App catalogue snapshot: {app_error}"
        return self._catalog_status_payload(
            nomenclature_count=len(cache.get("nomenclature") or []),
            warehouses_count=len(cache.get("warehouses") or []),
            updated_at=normalize_text(cache.get("updated_at")),
            last_attempt_at=normalize_text(cache.get("last_attempt_at")),
            last_error=fallback_error,
            nomenclature_truncated=bool(cache.get("nomenclature_truncated")),
            warehouses_truncated=bool(cache.get("warehouses_truncated")),
            source="catalog_snapshot_json_fallback" if self._catalog_snapshot_store is not None else "catalog_snapshot",
            app_snapshot=app_status,
        )

    def get_runtime_status(self) -> dict[str, Any]:
        """Readiness payload for the read-only 1C bridge.

        This deliberately reports health and cache completeness separately:
        callers must not infer a zero stock balance from a stale cache or a
        tripped COM circuit breaker.
        """
        catalog = self.get_catalog_status()
        if self._process_bridge is not None:
            bridge = dict(self._process_bridge.get_status())
            bridge["mode"] = "process"
        elif self._process_bridge_enabled:
            bridge = {
                "mode": "process",
                "ready": False,
                "circuit_breaker": "open",
                "last_error": self._process_bridge_error or "Process bridge 1С не настроен",
            }
        else:
            bridge = self._pool.get_status()
            bridge["mode"] = "in_process_compatibility"
        ready = catalog.get("status") in {"ok", "stale", "incomplete"} and bridge.get("circuit_breaker") != "open"
        return {
            "ready": bool(ready),
            "mode": "read_only",
            "source_base": DEFAULT_1C_REF,
            "catalog": catalog,
            "catalog_leader": dict(self._catalog_leader_status),
            "bridge": bridge,
            "as_of": utc_now_iso(),
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
        save_legacy_cache = True
        cache["last_attempt_at"] = utc_now_iso()
        try:
            bridged = self._run_process_bridge_sync(
                "catalog_sync",
                {},
                timeout=CATALOG_SYNC_TIMEOUT_SEC,
            )
            if bridged is not _PROCESS_BRIDGE_DISABLED:
                # The child persisted the shared app/JSON snapshot.  Reload
                # only the lightweight reader state here; do not overwrite a
                # newer child JSON fallback with this parent's stale payload.
                save_legacy_cache = False
                self._refresh_catalog_snapshot_from_store()
                return self.get_catalog_status()
            nomenclature = self._pool.submit(self._fetch_all_nomenclature_sync).result(
                timeout=CATALOG_SYNC_TIMEOUT_SEC
            )
            warehouses = self._pool.submit(self._fetch_all_warehouses_sync).result(
                timeout=CATALOG_SYNC_TIMEOUT_SEC
            )
            next_nomenclature = sort_catalog_json_rows(nomenclature_entries_to_json_rows(nomenclature))
            next_warehouses = sort_catalog_json_rows(catalog_entries_to_json_rows(warehouses))
            nomenclature_fingerprint = catalog_rows_fingerprint(next_nomenclature)
            warehouses_fingerprint = catalog_rows_fingerprint(next_warehouses)
            cache["nomenclature"] = next_nomenclature
            cache["warehouses"] = next_warehouses
            cache["nomenclature_fingerprint"] = nomenclature_fingerprint
            cache["warehouses_fingerprint"] = warehouses_fingerprint
            cache["updated_at"] = utc_now_iso()
            cache["last_error"] = ""
            cache["nomenclature_truncated"] = len(nomenclature) >= CATALOG_NOMENCLATURE_MAX_ROWS
            cache["warehouses_truncated"] = len(warehouses) >= CATALOG_WAREHOUSES_MAX_ROWS
            app_snapshot_persisted = False
            if self._catalog_snapshot_store is not None:
                try:
                    current_snapshot_status = self._catalog_snapshot_store.get_status(
                        source_base=DEFAULT_1C_REF
                    )
                    snapshot_unchanged = bool(
                        current_snapshot_status
                        and current_snapshot_status.get("has_snapshot")
                        and current_snapshot_status.get("nomenclature_fingerprint") == nomenclature_fingerprint
                        and current_snapshot_status.get("warehouses_fingerprint") == warehouses_fingerprint
                        and bool(current_snapshot_status.get("nomenclature_truncated"))
                        == bool(cache["nomenclature_truncated"])
                        and bool(current_snapshot_status.get("warehouses_truncated"))
                        == bool(cache["warehouses_truncated"])
                    )
                    if snapshot_unchanged:
                        self._catalog_snapshot_store.record_attempt_success(source_base=DEFAULT_1C_REF)
                        snapshot_status = self._catalog_snapshot_store.get_status(source_base=DEFAULT_1C_REF)
                    else:
                        snapshot_status = self._catalog_snapshot_store.replace_snapshot(
                            nomenclature=next_nomenclature,
                            warehouses=next_warehouses,
                            source_base=DEFAULT_1C_REF,
                            nomenclature_truncated=cache["nomenclature_truncated"],
                            warehouses_truncated=cache["warehouses_truncated"],
                            nomenclature_fingerprint=nomenclature_fingerprint,
                            warehouses_fingerprint=warehouses_fingerprint,
                        )
                    app_snapshot_persisted = isinstance(snapshot_status, dict) and bool(
                        snapshot_status.get("has_snapshot")
                    )
                except Exception as exc:
                    # Preserve the successful read in JSON rather than losing
                    # autocomplete during a temporary app DB failure.  This
                    # path still never calls a mutable 1C API.
                    logger.exception("Warehouse 1C app catalogue snapshot write failed")
                    cache["last_error"] = f"App catalogue snapshot: {format_com_error(exc)}"
                    try:
                        self._catalog_snapshot_store.record_attempt_failure(cache["last_error"], source_base=DEFAULT_1C_REF)
                    except Exception:
                        logger.exception("Warehouse 1C app catalogue failure status write failed")

            if app_snapshot_persisted:
                self._catalog_app_status_cache = dict(snapshot_status)
                self._activate_app_catalog()
            else:
                self._nomenclature_cache = nomenclature
                self._warehouses_cache = warehouses
                self._rebuild_nomenclature_word_index()
                self._legacy_catalog_loaded = True
                self._catalog_read_mode = "memory_fallback"
                self._catalog_fallback_reason = "snapshot_write_failed"
                if self._catalog_snapshot_store is None and self._uses_shared_catalog:
                    cls = type(self)
                    with cls._shared_catalog_lock:
                        cls._shared_catalog_snapshot = (
                            self._nomenclature_cache,
                            self._warehouses_cache,
                            self._word_frequency_index,
                        )
        except Exception as exc:
            logger.exception("Warehouse 1C catalog sync failed")
            cache["last_error"] = format_com_error(exc)
            if self._catalog_snapshot_store is not None:
                try:
                    self._catalog_snapshot_store.record_attempt_failure(
                        cache["last_error"],
                        source_base=DEFAULT_1C_REF,
                    )
                except Exception:
                    logger.exception("Warehouse 1C app catalogue failure status write failed")
        finally:
            if save_legacy_cache:
                try:
                    self.save_catalog_cache(cache)
                except Exception:
                    logger.exception("Warehouse 1C legacy catalogue cache write failed")
            self._catalog_sync_lock.release()
        return self.get_catalog_status()

    def sync_catalog_from_1c_as_leader(self) -> dict[str, Any]:
        """Refresh catalogues under one PostgreSQL advisory lease when available.

        Backend instances only read the shared snapshot.  On local SQLite/dev
        there is no distributed coordinator, so the existing per-process lock
        remains the safe fallback and status reports that limitation.
        """
        if not self._catalog_leader_lock.acquire(blocking=False):
            status = self.get_catalog_status()
            status["leader"] = {**self._catalog_leader_status, "is_leader": False}
            return status
        try:
            checked_at = utc_now_iso()
            try:
                from sqlalchemy import text
                from backend.appdb.db import get_app_engine, is_app_database_configured

                if not is_app_database_configured():
                    self._catalog_leader_status = {
                        "mode": "local_fallback",
                        "is_leader": True,
                        "last_checked_at": checked_at,
                    }
                    status = self.sync_catalog_from_1c()
                    status["leader"] = dict(self._catalog_leader_status)
                    return status

                engine = get_app_engine()
                if engine.dialect.name != "postgresql":
                    self._catalog_leader_status = {
                        "mode": "local_fallback",
                        "is_leader": True,
                        "last_checked_at": checked_at,
                    }
                    status = self.sync_catalog_from_1c()
                    status["leader"] = dict(self._catalog_leader_status)
                    return status

                with engine.connect() as connection:
                    acquired = bool(
                        connection.execute(
                            text("SELECT pg_try_advisory_lock(:lock_key)"),
                            {"lock_key": CATALOG_SYNC_LEADER_LOCK_KEY},
                        ).scalar()
                    )
                    if not acquired:
                        self._catalog_leader_status = {
                            "mode": "postgres_advisory_lease",
                            "is_leader": False,
                            "last_checked_at": checked_at,
                        }
                        status = self.get_catalog_status()
                        status["leader"] = dict(self._catalog_leader_status)
                        return status
                    self._catalog_leader_status = {
                        "mode": "postgres_advisory_lease",
                        "is_leader": True,
                        "last_checked_at": checked_at,
                    }
                    try:
                        status = self.sync_catalog_from_1c()
                    finally:
                        connection.execute(
                            text("SELECT pg_advisory_unlock(:lock_key)"),
                            {"lock_key": CATALOG_SYNC_LEADER_LOCK_KEY},
                        )
                    status["leader"] = dict(self._catalog_leader_status)
                    return status
            except Exception as exc:
                self._catalog_leader_status = {
                    "mode": "error",
                    "is_leader": False,
                    "last_checked_at": checked_at,
                    "last_error": format_com_error(exc),
                }
                logger.exception("Warehouse 1C catalog leader lease failed")
                raise
        finally:
            self._catalog_leader_lock.release()

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
        tokens = search_text_tokens(text_cf)
        if not tokens:
            return []
        starts: list[dict[str, Any]] = []
        contains: list[dict[str, Any]] = []
        primary = tokens[0]
        for ref, name, name_cf in entries:
            if not haystack_matches_all_tokens(name_cf, tokens):
                continue
            item = {"ref": ref, "name": name}
            if name_cf.startswith(primary):
                starts.append(item)
                if len(starts) >= limit:
                    break
            elif len(contains) < limit:
                contains.append(item)
        if len(starts) >= limit:
            return starts[:limit]
        return starts + contains[: limit - len(starts)]

    @staticmethod
    def _filter_nomenclature_catalog(
        entries: list[tuple[str, str, str, str]],
        text_cf: str,
        limit: int,
    ) -> list[dict[str, Any]]:
        tokens = search_text_tokens(text_cf)
        if not tokens:
            return []
        ranked: list[list[tuple[tuple[str, str, str], dict[str, Any]]]] = [[], [], []]
        for ref, code, name, name_cf in entries:
            rank = catalog_entry_match_rank(code, name, tokens)
            if rank is None:
                continue
            item = {"ref": ref, "code": code, "name": name}
            sort_key = (
                " ".join(name.casefold().split()),
                " ".join(code.casefold().split()),
                ref,
            )
            insort(ranked[rank], (sort_key, item))
            if len(ranked[rank]) > limit:
                ranked[rank].pop()
        results = [item for bucket in ranked for _sort_key, item in bucket]
        return results[:limit]

    # ------------------------------------------------------------------
    # Nomenclature / warehouse autocomplete
    # ------------------------------------------------------------------
    def _search_nomenclature_sync(self, connection: Any, text: str, limit: int) -> list[dict[str, Any]]:
        tokens = search_text_tokens(text)
        if not tokens:
            return []
        token_clauses = [
            f"(Ном.Наименование ПОДОБНО &Текст{i} ИЛИ Ном.Код ПОДОБНО &Текст{i})"
            for i in range(len(tokens))
        ]
        query = connection.NewObject("Query")
        query.Text = f"""
ВЫБРАТЬ ПЕРВЫЕ {limit}
    Ном.Ссылка КАК Ссылка,
    Ном.Код КАК Код,
    Ном.Наименование КАК Наименование
ИЗ
    Справочник.Номенклатура КАК Ном
ГДЕ
    {" И ".join(token_clauses)}
    И НЕ Ном.ПометкаУдаления
УПОРЯДОЧИТЬ ПО
    Ном.Наименование
"""
        for i, token in enumerate(tokens):
            query.SetParameter(f"Текст{i}", f"%{escape_like(token)}%")
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
        tokens = search_text_tokens(text)
        if not tokens:
            return []
        token_clauses = [f"Скл.Наименование ПОДОБНО &Текст{i}" for i in range(len(tokens))]
        query = connection.NewObject("Query")
        query.Text = f"""
ВЫБРАТЬ ПЕРВЫЕ {limit}
    Скл.Ссылка КАК Ссылка,
    Скл.Наименование КАК Наименование
ИЗ
    Справочник.Склады КАК Скл
ГДЕ
    {" И ".join(token_clauses)}
    И НЕ Скл.ПометкаУдаления
УПОРЯДОЧИТЬ ПО
    Скл.Наименование
"""
        for i, token in enumerate(tokens):
            query.SetParameter(f"Текст{i}", f"%{escape_like(token)}%")
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
        if self._catalog_read_mode == "app_snapshot":
            available, app_rows = await asyncio.to_thread(
                self._search_app_catalog_snapshot,
                "nomenclature",
                normalized_text,
                normalized_limit,
            )
            if available:
                return app_rows
            self._activate_memory_catalog("snapshot_query_failed")
        if self._nomenclature_cache:
            # A rare/typo'd query never fills the result buckets and scans the
            # full ~700k-row cache (tens of ms) — keep that off the event loop.
            return await asyncio.to_thread(
                self._filter_nomenclature_catalog,
                self._nomenclature_cache,
                normalized_text.casefold(),
                normalized_limit,
            )
        raise Warehouse1CCatalogUnavailableError(
            "Каталог номенклатуры 1С ещё не загружен. Запустите обновление каталога и повторите поиск."
        )

    async def search_warehouses(self, text: str = "", limit: int | None = None) -> list[dict[str, Any]]:
        normalized_text = normalize_text(text)
        if len(normalized_text) < 2:
            return []
        normalized_limit = clamp_limit(limit, AUTOCOMPLETE_DEFAULT_LIMIT, WAREHOUSE_AUTOCOMPLETE_MAX_LIMIT)
        if self._catalog_read_mode == "app_snapshot":
            available, app_rows = await asyncio.to_thread(
                self._search_app_catalog_snapshot,
                "warehouses",
                normalized_text,
                normalized_limit,
            )
            if available:
                return app_rows
            self._activate_memory_catalog("snapshot_query_failed")
        if self._warehouses_cache:
            return await asyncio.to_thread(
                self._filter_catalog, self._warehouses_cache, normalized_text.casefold(), normalized_limit
            )
        raise Warehouse1CCatalogUnavailableError(
            "Каталог складов 1С ещё не загружен. Запустите обновление каталога и повторите поиск."
        )

    # ------------------------------------------------------------------
    # Employee warehouse match + smart nomenclature suggest (cache-only)
    # ------------------------------------------------------------------
    @staticmethod
    def _build_nomenclature_word_index(
        entries: list[tuple[str, str, str, str]],
    ) -> dict[str, int]:
        frequency: dict[str, int] = {}
        for _ref, _code, name, _name_cf in entries:
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
        return frequency

    def _rebuild_nomenclature_word_index(self) -> None:
        self._word_frequency_index = self._build_nomenclature_word_index(self._nomenclature_cache)

    def _search_app_catalog_snapshot(
        self,
        catalog_type: str,
        text: str,
        limit: int,
    ) -> tuple[bool, list[dict[str, Any]]]:
        store = self._catalog_snapshot_store
        if store is None:
            return False, []
        try:
            available, rows = store.search_entries(
                catalog_type=catalog_type,
                text=text,
                limit=limit,
                source_base=DEFAULT_1C_REF,
            )
            return bool(available), list(rows or [])
        except Exception as exc:
            logger.warning("Warehouse 1C app catalogue search failed: %s", exc)
            return False, []

    def _lookup_app_catalog_snapshot(
        self,
        catalog_type: str,
        ref: str,
    ) -> tuple[bool, dict[str, str] | None]:
        store = self._catalog_snapshot_store
        if store is None:
            return False, None
        try:
            available, row = store.lookup_entry(
                catalog_type=catalog_type,
                ref=ref,
                source_base=DEFAULT_1C_REF,
            )
            return bool(available), dict(row) if isinstance(row, dict) else None
        except Exception as exc:
            logger.warning("Warehouse 1C app catalogue lookup failed: %s", exc)
            return False, None

    def lookup_nomenclature_ref(self, ref: str) -> dict[str, str] | None:
        normalized_ref = normalize_text(ref)
        if not normalized_ref:
            return None
        available, row = self._lookup_app_catalog_snapshot("nomenclature", normalized_ref)
        if available:
            return row
        self._ensure_legacy_catalog_cache_loaded()
        for entry_ref, code, name, _name_cf in self._nomenclature_cache:
            if entry_ref == normalized_ref:
                return {"ref": entry_ref, "code": code, "name": name}
        return None

    def lookup_nomenclature_codes(self, codes: list[str]) -> dict[str, dict[str, str]]:
        """Resolve exact catalogue codes without materialising the full app snapshot."""
        normalized_codes = {
            normalize_text(code).casefold()
            for code in codes or []
            if normalize_text(code)
        }
        if not normalized_codes:
            return {}
        store = self._catalog_snapshot_store
        if store is not None:
            try:
                available, rows = store.lookup_nomenclature_codes(
                    normalized_codes,
                    source_base=DEFAULT_1C_REF,
                )
                if available:
                    return {
                        str(key).casefold(): dict(value)
                        for key, value in dict(rows or {}).items()
                        if isinstance(value, dict)
                    }
            except Exception as exc:
                logger.warning("Warehouse 1C app catalogue code lookup failed: %s", exc)
        self._ensure_legacy_catalog_cache_loaded()
        result: dict[str, dict[str, str]] = {}
        for entry_ref, code, name, _name_cf in self._nomenclature_cache:
            code_key = normalize_text(code).casefold()
            if code_key in normalized_codes:
                result[code_key] = {"ref": entry_ref, "code": code, "name": name}
        return result

    def lookup_warehouse_ref(self, ref: str) -> dict[str, str] | None:
        normalized_ref = normalize_text(ref)
        if not normalized_ref:
            return None
        available, row = self._lookup_app_catalog_snapshot("warehouses", normalized_ref)
        if available:
            return row
        self._ensure_legacy_catalog_cache_loaded()
        for entry_ref, name, _name_cf in self._warehouses_cache:
            if entry_ref == normalized_ref:
                return {"ref": entry_ref, "name": name}
        return None

    @staticmethod
    def _match_employee_warehouse_entries(
        employee_name: str,
        entries: list[dict[str, Any]],
    ) -> dict[str, Any]:
        employee_key = normalize_match_key(employee_name)
        if not employee_key:
            return {"status": "not_found", "warehouse": None, "candidates": []}

        scored: list[tuple[int, dict[str, str]]] = []
        for entry in entries:
            ref = normalize_text(entry.get("ref"))
            name = normalize_text(entry.get("name"))
            if not ref or not name:
                continue
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

    def _match_employee_warehouse(self, employee_name: str) -> dict[str, Any]:
        self._ensure_legacy_catalog_cache_loaded()
        return self._match_employee_warehouse_entries(
            employee_name,
            [{"ref": ref, "name": name} for ref, name, _name_cf in self._warehouses_cache],
        )

    async def _match_employee_warehouse_async(self, employee_name: str) -> dict[str, Any]:
        # A surname is a deliberately broad candidate query.  The existing
        # FIO scorer still decides matched vs ambiguous, so a DB search can
        # never turn a fuzzy name into an automatic owner mapping.
        surname_tokens = person_name_tokens(employee_name)
        candidate_text = surname_tokens[0] if surname_tokens else employee_name
        available, rows = await asyncio.to_thread(
            self._search_app_catalog_snapshot,
            "warehouses",
            candidate_text,
            max(200, EMPLOYEE_WAREHOUSE_MATCH_LIMIT),
        )
        if available:
            return self._match_employee_warehouse_entries(employee_name, rows)
        return await asyncio.to_thread(self._match_employee_warehouse, employee_name)

    def _search_nomenclature_substring(self, query_cf: str, limit: int) -> list[dict[str, Any]]:
        if not query_cf:
            return []
        return self._filter_nomenclature_catalog(self._nomenclature_cache, query_cf, limit)

    def _suggest_nomenclature_sync(self, hub_text: str, limit: int) -> dict[str, Any]:
        normalized = normalize_text(hub_text)
        if not normalized:
            return {"tried_query": "", "results": [], "source_text": ""}

        tokens = search_text_tokens(normalized)

        # Multi-word AND first: "Ippon 800" → both tokens must match.
        if len(tokens) >= 2:
            results = self._filter_nomenclature_catalog(
                self._nomenclature_cache,
                normalized.casefold(),
                limit,
            )
            if results:
                return {
                    "tried_query": normalized,
                    "results": results,
                    "source_text": normalized,
                }

        full_cf = normalized.casefold()
        if len(full_cf) >= 2:
            results = self._search_nomenclature_substring(full_cf, limit)
            if results:
                return {
                    "tried_query": normalized,
                    "results": results,
                    "source_text": normalized,
                }

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

    def _suggest_nomenclature_from_app_snapshot(self, hub_text: str, limit: int) -> dict[str, Any] | None:
        """Use indexed token rows for suggestion ranking without a RAM index."""
        normalized = normalize_text(hub_text)
        if not normalized:
            return {"tried_query": "", "results": [], "source_text": ""}
        available, results = self._search_app_catalog_snapshot("nomenclature", normalized, limit)
        if not available:
            return None
        if results:
            return {"tried_query": normalized, "results": results, "source_text": normalized}

        tokens = search_text_tokens(normalized)
        if not tokens and len(normalized) >= 2:
            tokens = [normalized.casefold()]
        store = self._catalog_snapshot_store
        if store is None:
            return None
        try:
            frequencies_available, frequencies = store.token_frequencies(
                catalog_type="nomenclature",
                tokens=tokens,
                source_base=DEFAULT_1C_REF,
            )
        except Exception as exc:
            logger.warning("Warehouse 1C app catalogue token ranking failed: %s", exc)
            return None
        if not frequencies_available:
            return None
        tokens_sorted = sorted(
            dict.fromkeys(tokens),
            key=lambda token: (int(frequencies.get(token, 0)), -len(token)),
        )
        for token in tokens_sorted:
            candidate = token
            while len(candidate) >= SUGGEST_MIN_TOKEN_LEN:
                available, candidate_results = self._search_app_catalog_snapshot(
                    "nomenclature",
                    candidate,
                    limit,
                )
                if not available:
                    return None
                if candidate_results:
                    return {
                        "tried_query": candidate,
                        "results": candidate_results,
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
                balance_payload = await self.get_balances(
                    warehouse_ref=warehouse["ref"],
                    limit=normalized_balances_limit,
                    include_meta=True,
                )
                if isinstance(balance_payload, dict):
                    result["balances"] = list(balance_payload.get("items") or [])
                    result["balances_meta"] = {
                        key: value for key, value in balance_payload.items() if key not in {"items", "aggregates"}
                    }
                else:
                    result["balances"] = balance_payload
            status_name = str(warehouse.get("name") or normalized_name or "").strip()
            employment = resolve_employment_status(status_name)
            result["employment_status"] = employment.get("status")
            result["employment_label"] = employment.get("label") or ""
            result["employment_matched_name"] = employment.get("matched_name")
            return result

        match = await self._match_employee_warehouse_async(normalized_name)
        result = {
            "status": match["status"],
            "warehouse": match.get("warehouse"),
            "candidates": match.get("candidates") or [],
            "balances": [],
        }
        if match["status"] == "matched" and load_balances and match.get("warehouse"):
            balance_payload = await self.get_balances(
                warehouse_ref=match["warehouse"]["ref"],
                limit=normalized_balances_limit,
                include_meta=True,
            )
            if isinstance(balance_payload, dict):
                result["balances"] = list(balance_payload.get("items") or [])
                result["balances_meta"] = {
                    key: value for key, value in balance_payload.items() if key not in {"items", "aggregates"}
                }
            else:
                result["balances"] = balance_payload

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
        app_payload = await asyncio.to_thread(
            self._suggest_nomenclature_from_app_snapshot,
            normalized_text,
            normalized_limit,
        )
        if app_payload is not None:
            return app_payload
        self._ensure_legacy_catalog_cache_loaded()
        if self._nomenclature_cache:
            return await asyncio.to_thread(
                self._suggest_nomenclature_sync,
                normalized_text,
                normalized_limit,
            )

        tokens = search_text_tokens(normalized_text)
        if len(tokens) >= 2:
            live_and = await self._run_pooled(
                self._search_nomenclature_sync,
                normalized_text,
                normalized_limit,
            )
            if live_and:
                return {
                    "tried_query": normalized_text,
                    "results": live_and,
                    "source_text": normalized_text,
                }

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

    @staticmethod
    def aggregate_balance_rows(rows: list[dict[str, Any]]) -> list[dict[str, Any]]:
        """Aggregate batch/series rows into one reconciliation unit.

        1C reports characteristics, series and batches separately.  Quantity
        reconciliation is intentionally performed at
        ``(source_base, nomenclature_ref, warehouse_ref)`` while retaining the
        raw register rows as auditable detail.
        """
        buckets: dict[tuple[str, str, str], dict[str, Any]] = {}
        for raw in rows or []:
            row = dict(raw)
            nomenclature_ref = normalize_1c_ref(row.get("nomenclature_ref"))
            warehouse_ref = normalize_1c_ref(row.get("warehouse_ref"))
            if not nomenclature_ref or not warehouse_ref:
                continue
            key = (DEFAULT_1C_REF, nomenclature_ref, warehouse_ref)
            bucket = buckets.setdefault(
                key,
                {
                    "source_base": DEFAULT_1C_REF,
                    "nomenclature_ref": nomenclature_ref,
                    "nomenclature_code": normalize_text(row.get("nomenclature_code")),
                    "nomenclature_name": normalize_text(row.get("nomenclature_name")),
                    "warehouse_ref": warehouse_ref,
                    "warehouse_name": normalize_text(row.get("warehouse_name")),
                    "qty_1c_total": 0.0,
                    "qty_balance": 0.0,
                    "cost_1c_total": 0.0,
                    "source_row_count": 0,
                    "details": [],
                    "status": "ok",
                },
            )
            try:
                bucket["qty_1c_total"] += float(row.get("qty_balance") or 0)
                bucket["qty_balance"] = bucket["qty_1c_total"]
            except (TypeError, ValueError):
                pass
            try:
                bucket["cost_1c_total"] += float(row.get("cost_balance") or 0)
            except (TypeError, ValueError):
                pass
            bucket["source_row_count"] += 1
            bucket["details"].append(row)
        return sorted(
            buckets.values(),
            key=lambda item: (
                str(item.get("nomenclature_code") or "").casefold(),
                str(item.get("warehouse_name") or "").casefold(),
            ),
        )

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
            tokens = search_text_tokens(text)
            if not tokens:
                raise Warehouse1CValidationError(
                    "Укажите номенклатуру, склад или текст поиска перед запросом остатков"
                )
            for i in range(len(tokens)):
                where_clauses.append(
                    f"(О.Номенклатура.Наименование ПОДОБНО &Текст{i}"
                    f" ИЛИ О.Номенклатура.Код ПОДОБНО &Текст{i})"
                )

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
    О.Номенклатура.Наименование,
    О.Склад.Наименование,
    О.СерияНоменклатуры.Наименование
"""
        if nomenclature_obj is not None:
            query.SetParameter("Номенклатура", nomenclature_obj)
        if warehouse_obj is not None:
            query.SetParameter("Склад", warehouse_obj)
        if text and not nomenclature_ref:
            for i, token in enumerate(search_text_tokens(text)):
                query.SetParameter(f"Текст{i}", f"%{escape_like(token)}%")

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
        include_meta: bool = False,
    ) -> list[dict[str, Any]] | dict[str, Any]:
        normalized_limit = clamp_limit(limit, BALANCES_DEFAULT_LIMIT, BALANCES_MAX_LIMIT)
        bridged = await self._run_process_bridge(
            "balances",
            {
                "nomenclature_ref": normalize_1c_ref(nomenclature_ref),
                "warehouse_ref": normalize_1c_ref(warehouse_ref),
                "text": normalize_text(text),
                "limit": normalized_limit,
                "include_meta": bool(include_meta),
            },
        )
        if bridged is not _PROCESS_BRIDGE_DISABLED:
            return bridged
        # The extra row lets callers distinguish a complete balance result
        # from a safety-capped response without an expensive COUNT query in 1C.
        rows = await self._run_pooled(
            self._get_balances_sync,
            normalize_1c_ref(nomenclature_ref),
            normalize_1c_ref(warehouse_ref),
            normalize_text(text),
            normalized_limit + 1,
        )
        items = rows[:normalized_limit]
        truncated = len(rows) > normalized_limit
        if not include_meta:
            return items
        return {
            "items": items,
            "aggregates": self.aggregate_balance_rows(items),
            "returned": len(items),
            "total": len(items) if not truncated else None,
            "has_more": truncated,
            "truncated": truncated,
            "as_of": utc_now_iso(),
            "source": "live_1c",
            "status": "incomplete" if truncated else "ok",
            "incomplete_reason": "limit_cap" if truncated else None,
        }

    def _get_balances_batch_sync(
        self,
        connection: Any,
        nomenclature_refs: list[str],
        warehouse_ref: str,
        limit: int,
    ) -> list[dict[str, Any]]:
        references = connection.NewObject("Массив")
        for ref in nomenclature_refs:
            references.Добавить(self._rebuild_ref(connection, NOMENCLATURE_CATALOG, ref))

        warehouse_obj = None
        where_clauses = [
            "О.Номенклатура В (&Номенклатуры)",
            "О.КоличествоОстаток > 0",
        ]
        if warehouse_ref:
            warehouse_obj = self._rebuild_ref(connection, WAREHOUSE_CATALOG, warehouse_ref)
            where_clauses.append("О.Склад = &Склад")

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
    О.Номенклатура.Наименование,
    О.Склад.Наименование,
    О.СерияНоменклатуры.Наименование
"""
        query.SetParameter("Номенклатуры", references)
        if warehouse_obj is not None:
            query.SetParameter("Склад", warehouse_obj)
        selection = query.Execute().Select()
        rows: list[dict[str, Any]] = []
        while selection.Next():
            row = self._row_to_balance(connection, selection)
            if has_positive_qty(row.get("qty_balance")):
                rows.append(row)
        return rows

    async def get_balances_batch(
        self,
        *,
        nomenclature_refs: list[str],
        warehouse_ref: str = "",
        limit_per_nomenclature: int = 50,
    ) -> dict[str, Any]:
        """Return aggregated balance units for a bounded set of references.

        This is intentionally all-or-nothing: a 1C timeout/error yields an
        error response, never synthetic zero rows for some of the requested
        nomenclatures.
        """
        refs = list(
            dict.fromkeys(
                normalize_1c_ref(ref)
                for ref in nomenclature_refs or []
                if normalize_1c_ref(ref)
            )
        )
        if not refs:
            raise Warehouse1CValidationError("Нужна хотя бы одна номенклатура 1С")
        if len(refs) > 50:
            raise Warehouse1CValidationError("В batch-запросе допускается не более 50 номенклатур")
        per_ref = clamp_limit(limit_per_nomenclature, 50, 200)
        bridged = await self._run_process_bridge(
            "balances_batch",
            {
                "nomenclature_refs": refs,
                "warehouse_ref": normalize_1c_ref(warehouse_ref),
                "limit_per_nomenclature": per_ref,
            },
        )
        if bridged is not _PROCESS_BRIDGE_DISABLED:
            return bridged
        # Cap one request independently from the outer request count so the
        # COM bridge remains bounded under an accidentally broad selection.
        max_rows = min(5000, len(refs) * per_ref)
        rows = await self._run_pooled(
            self._get_balances_batch_sync,
            refs,
            normalize_1c_ref(warehouse_ref),
            max_rows + 1,
        )
        truncated = len(rows) > max_rows
        visible_rows = rows[:max_rows]
        aggregates = self.aggregate_balance_rows(visible_rows)
        compact_items: list[dict[str, Any]] = []
        for aggregate in aggregates:
            compact = dict(aggregate)
            compact.pop("details", None)
            compact_items.append(compact)
        return {
            "items": compact_items,
            "requested": len(refs),
            "returned": len(compact_items),
            "source_row_count": len(visible_rows),
            "total": len(compact_items) if not truncated else None,
            "has_more": truncated,
            "truncated": truncated,
            "as_of": utc_now_iso(),
            "source": "live_1c",
            "status": "incomplete" if truncated else "ok",
            "incomplete_reason": "limit_cap" if truncated else None,
        }

    def _match_warehouse_to_owner(
        self,
        warehouse_name: str,
        owners: list[dict[str, Any]],
    ) -> tuple[dict[str, Any] | None, int]:
        matched, score = self._match_warehouse_to_owners(warehouse_name, owners)
        if not matched:
            return None, 0
        return matched[0], score

    def _match_warehouse_to_owners(
        self,
        warehouse_name: str,
        owners: list[dict[str, Any]],
    ) -> tuple[list[dict[str, Any]], int]:
        """Return all OWNERS tied at the best FIO score (duplicates with same name)."""
        best_score = 0
        best_owners: list[dict[str, Any]] = []
        for owner in owners or []:
            owner_name = str(
                owner.get("OWNER_DISPLAY_NAME")
                or owner.get("owner_display_name")
                or ""
            ).strip()
            if not owner_name:
                continue
            score = fio_person_match_score(owner_name, warehouse_name)
            if score < 50:
                continue
            if score > best_score:
                best_score = score
                best_owners = [owner]
            elif score == best_score:
                best_owners.append(owner)
        if best_score < 50:
            return [], 0
        return best_owners, best_score

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
        scope: str = "current",
        include_meta: bool = False,
    ) -> list[dict[str, Any]] | dict[str, Any]:
        """Balances by nomenclature enriched with HUB count and employment status.

        ``scope`` defaults to the current HUB database.  Cross-database
        aggregation is intentionally opt-in and the router exposes it to
        administrators only; otherwise another tenant's equipment can affect
        a reconciliation result.
        """
        from backend.api.v1.database import get_all_db_configs
        from backend.database import queries as db_queries
        from backend.services.employment_status_service import resolve_employment_status_batch

        normalized_ref = normalize_1c_ref(nomenclature_ref)
        if not normalized_ref:
            raise Warehouse1CValidationError("nomenclature_ref обязателен")

        balance_payload = await self.get_balances(
            nomenclature_ref=normalized_ref,
            limit=limit,
            include_meta=True,
        )
        if isinstance(balance_payload, dict):
            raw_balances = list(balance_payload.get("items") or [])
            balance_meta = {
                key: value
                for key, value in balance_payload.items()
                if key not in {"items", "aggregates"}
            }
        else:
            raw_balances = list(balance_payload or [])
            balance_meta = {
                "returned": len(raw_balances),
                "total": len(raw_balances),
                "has_more": False,
                "truncated": False,
                "as_of": utc_now_iso(),
                "source": "live_1c",
                "status": "ok",
            }
        balance_status = normalize_text(balance_meta.get("status")).lower() or "unknown"
        balance_truncated = bool(balance_meta.get("truncated")) or bool(balance_meta.get("has_more"))
        balance_incomplete = balance_status != "ok" or balance_truncated
        balances = self.aggregate_balance_rows(raw_balances) or list(raw_balances)
        if not balances:
            if not include_meta:
                return []
            return {
                "items": [],
                "returned": 0,
                "total": balance_meta.get("total", 0),
                "has_more": bool(balance_meta.get("has_more")),
                "truncated": balance_truncated,
                "as_of": balance_meta.get("as_of") or utc_now_iso(),
                "source": balance_meta.get("source") or "live_1c",
                "status": "incomplete" if balance_incomplete and balance_status == "ok" else balance_status,
            }

        current_db_id = str(db_id or "").strip() or None
        scope_key = normalize_text(scope).lower() or "current"
        if scope_key not in {"current", "all"}:
            raise Warehouse1CValidationError("scope должен быть current или all")
        try:
            db_configs = select_hub_db_configs_for_scope(
                get_all_db_configs(),
                current_db_id=current_db_id,
                scope=scope_key,
            )
        except Warehouse1CAllScopeConfigurationError as exc:
            raise Warehouse1CValidationError(str(exc)) from exc

        warehouse_names = [
            str(row.get("warehouse_name") or "").strip()
            for row in balances
        ]
        employment_map = resolve_employment_status_batch(warehouse_names)

        # Per warehouse: preferred owner (for UI link) + total hub count across DBs.
        # IMPORTANT: Hub may have duplicate OWNER rows with the same FIO — count all of them.
        owner_by_warehouse: dict[str, tuple[dict[str, Any] | None, int]] = {}
        owner_link_method_by_warehouse: dict[str, str] = {}
        hub_count_by_warehouse: dict[str, int] = {}
        owner_count_by_warehouse: dict[str, dict[int, int]] = {}

        for cfg in db_configs:
            one_db_id = str(cfg.get("id") or "").strip() or None
            is_current_db = bool(
                current_db_id
                and one_db_id
                and current_db_id.casefold() == one_db_id.casefold()
            )
            try:
                owners = db_queries.list_owners_compact(db_id=one_db_id)
            except Exception as exc:
                logger.warning("list_owners_compact failed for db=%s: %s", one_db_id, exc)
                continue

            # Explicit warehouse-owner links are authoritative.  FIO matching
            # remains a read-only suggestion only when there is no confirmed
            # link for this exact 1C warehouse reference.
            from backend.services.one_c_reconcile_registry_service import one_c_reconcile_registry_service

            warehouse_refs = [str(row.get("warehouse_ref") or "").strip() for row in balances]
            try:
                explicit_owner_links = await asyncio.to_thread(
                    one_c_reconcile_registry_service.get_active_owner_links,
                    hub_db_id=str(one_db_id or "default"),
                    warehouse_refs=warehouse_refs,
                )
            except Exception as exc:
                # An unavailable/migrating app registry must not turn a
                # read-only balance view into a 500.  We preserve the older
                # FIO-only *candidate* path and never label its counts exact.
                logger.warning("Warehouse 1C owner-link registry lookup failed for db=%s: %s", one_db_id, exc)
                explicit_owner_links = {}

            matched_owner_nos: list[int] = []
            warehouse_owners_for_db: dict[str, list[tuple[dict[str, Any], int]]] = {}
            for balance_row in balances:
                warehouse_name = str(balance_row.get("warehouse_name") or "").strip()
                warehouse_ref = str(balance_row.get("warehouse_ref") or "").strip()
                if not warehouse_name:
                    continue
                cache_key = warehouse_ref or warehouse_name.casefold()
                if cache_key in warehouse_owners_for_db:
                    continue
                explicit_owner_nos = explicit_owner_links.get(warehouse_ref) or []
                if explicit_owner_nos:
                    wanted: set[int] = set()
                    for value in explicit_owner_nos:
                        try:
                            parsed_owner_no = int(value)
                        except (TypeError, ValueError):
                            continue
                        if parsed_owner_no > 0:
                            wanted.add(parsed_owner_no)
                    matched_owners = [
                        owner
                        for owner in owners
                        if str(owner.get("OWNER_NO") or owner.get("owner_no") or "").strip().isdigit()
                        and int(owner.get("OWNER_NO") or owner.get("owner_no")) in wanted
                    ]
                    score = 100
                    mapping_method = "explicit"
                else:
                    matched_owners, score = self._match_warehouse_to_owners(warehouse_name, owners)
                    mapping_method = "fio_candidate"
                if not matched_owners:
                    continue
                resolved: list[tuple[dict[str, Any], int]] = []
                for owner in matched_owners:
                    try:
                        owner_no = int(owner.get("OWNER_NO") or owner.get("owner_no"))
                    except (TypeError, ValueError):
                        continue
                    if owner_no <= 0:
                        continue
                    resolved.append((owner, owner_no))
                    if owner_no not in matched_owner_nos:
                        matched_owner_nos.append(owner_no)
                if not resolved:
                    continue
                warehouse_owners_for_db[cache_key] = resolved
                owner_link_method_by_warehouse[cache_key] = mapping_method
                # Prefer current-DB owner for the employee link; if several — first for now,
                # later re-pick by who actually has matching equipment.
                prev_owner, _prev_score = owner_by_warehouse.get(cache_key, (None, 0))
                if prev_owner is None or is_current_db:
                    owner_by_warehouse[cache_key] = (resolved[0][0], score)

            if not matched_owner_nos:
                continue

            try:
                counts = db_queries.count_equipment_by_owners_hub_query(
                    matched_owner_nos,
                    part_no=part_no,
                    part_nos=[nomenclature_code] if nomenclature_code else None,
                    model_name=model_name,
                    hub_query=hub_query,
                    hub_query_source=hub_query_source,
                    db_id=one_db_id,
                )
            except Exception as exc:
                logger.warning("count_equipment_by_owners_hub_query failed for db=%s: %s", one_db_id, exc)
                continue

            for cache_key, resolved in warehouse_owners_for_db.items():
                per_owner = owner_count_by_warehouse.setdefault(cache_key, {})
                score = owner_by_warehouse.get(cache_key, (None, 0))[1] or 0
                for owner, owner_no in resolved:
                    add = int(counts.get(owner_no, 0))
                    hub_count_by_warehouse[cache_key] = (
                        hub_count_by_warehouse.get(cache_key, 0) + add
                    )
                    per_owner[owner_no] = per_owner.get(owner_no, 0) + add
                    if not is_current_db and owner_by_warehouse.get(cache_key, (None, 0))[0] is not None:
                        continue
                    prev = owner_by_warehouse.get(cache_key, (None, 0))[0]
                    prev_no = None
                    try:
                        prev_no = int(prev.get("OWNER_NO") or prev.get("owner_no")) if prev else None
                    except (TypeError, ValueError, AttributeError):
                        prev_no = None
                    prev_count = per_owner.get(prev_no, 0) if prev_no is not None else -1
                    if prev is None or add > prev_count:
                        owner_by_warehouse[cache_key] = (owner, score)

        enriched: list[dict[str, Any]] = []
        as_of = balance_meta.get("as_of") or utc_now_iso()
        row_status = "incomplete" if balance_incomplete and balance_status == "ok" else balance_status
        for row in balances:
            payload = dict(row)
            warehouse_name = str(row.get("warehouse_name") or "").strip()
            warehouse_ref = str(row.get("warehouse_ref") or "").strip()
            cache_key = warehouse_ref or warehouse_name.casefold()
            owner, score = owner_by_warehouse.get(cache_key, (None, 0))
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
                # Matched person → always show a number (0 if no PART_NO hits).
                hub_count = int(hub_count_by_warehouse.get(cache_key, 0))
            elif cache_key in hub_count_by_warehouse:
                # Matched only in a non-current DB and owner_by_warehouse missed —
                # still expose the aggregated count.
                hub_count = int(hub_count_by_warehouse.get(cache_key, 0))

            if hub_owner_no is not None or hub_count is not None:
                employment = employment_map.get(warehouse_name) or {
                    "status": "unknown",
                    "label": "",
                    "matched_name": None,
                }
            else:
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
                    # ``hub_count`` is an observed candidate count produced
                    # by a PART_NO/model and owner match.  Without immutable
                    # HUB item IDs from the registry it is not proof of a
                    # confirmed 1C link, so never present it as exact.
                    "hub_count_kind": "candidate" if hub_count is not None else "unknown",
                    "hub_match_score": score or None,
                    "owner_link_method": owner_link_method_by_warehouse.get(cache_key, "unmatched"),
                    "employment_status": employment.get("status"),
                    "employment_label": employment.get("label") or "",
                    "employment_matched_name": employment.get("matched_name"),
                    "qty_1c_total": float(row.get("qty_1c_total") or row.get("qty_balance") or 0),
                    "exact_linked_count": None if balance_incomplete else 0,
                    "unlinked_candidate_count": hub_count,
                    "source_row_count": int(row.get("source_row_count") or 1),
                    "as_of": as_of,
                    "source": balance_meta.get("source") or "live_1c",
                    "status": row_status,
                }
            )
            enriched.append(payload)
        if not include_meta:
            return enriched
        return {
            "items": enriched,
            "returned": len(enriched),
            "total": balance_meta.get("total", len(enriched)),
            "has_more": bool(balance_meta.get("has_more")),
            "truncated": balance_truncated,
            "as_of": as_of,
            "source": balance_meta.get("source") or "live_1c",
            "status": row_status,
            "exact": not balance_incomplete,
        }

    def _resolve_prefer_owner_no_for_db(
        self,
        *,
        db_id: str | None,
        owner_no: int | None,
        current_db_id: str | None,
        warehouse_label: str,
        employee_label: str,
    ) -> int | None:
        from backend.database import queries as db_queries

        prefer: int | None = None
        current_key = str(current_db_id or "").strip().casefold()
        db_key = str(db_id or "").strip().casefold()
        if owner_no and current_key and db_key and current_key == db_key:
            prefer = owner_no

        label = warehouse_label or employee_label
        if prefer is None and label:
            owners = db_queries.list_owners_compact(db_id=db_id)
            matched_owner, score = self._match_warehouse_to_owner(label, owners)
            if matched_owner is not None and score >= 50:
                try:
                    prefer = int(matched_owner.get("OWNER_NO") or matched_owner.get("owner_no"))
                except (TypeError, ValueError):
                    prefer = None
                if prefer is not None and prefer <= 0:
                    prefer = None
        return prefer

    def _match_nomenclature_to_hub_one_db(
        self,
        *,
        part_nos: list[str],
        model_patterns: list[str],
        prefer_owner_no: int | None,
        limit: int,
        db_id: str | None,
        db_name: str,
        is_current_db: bool,
    ) -> dict[str, list[dict[str, Any]]]:
        from backend.database import queries as db_queries

        matched = db_queries.match_nomenclature_to_hub_query(
            part_nos=part_nos,
            model_patterns=model_patterns,
            prefer_owner_no=prefer_owner_no,
            limit=limit,
            db_id=db_id,
        )

        def _tag(rows: list[dict[str, Any]]) -> list[dict[str, Any]]:
            tagged: list[dict[str, Any]] = []
            for row in rows or []:
                payload = dict(row)
                payload["hub_db_id"] = db_id or ""
                payload["hub_db_name"] = db_name
                payload["is_current_db"] = bool(is_current_db)
                tagged.append(payload)
            # The match dialog may confirm a link directly, so include the
            # app-owned CAS version in the same page rather than making the
            # client guess that every row is version 0 after migration.
            try:
                from backend.services.one_c_reconcile_registry_service import one_c_reconcile_registry_service

                item_ids = [str(item.get("item_id") or "").strip() for item in tagged]
                links = one_c_reconcile_registry_service.get_item_links(
                    hub_db_id=str(db_id or "default"),
                    hub_item_ids=item_ids,
                )
            except Exception:
                logger.warning("Unable to load 1C link versions for HUB match db=%s", db_id, exc_info=True)
                links = {}
            for payload in tagged:
                link = links.get(str(payload.get("item_id") or "").strip())
                payload["one_c_link"] = link
                payload["expected_version"] = int(link.get("version") or 0) if link else 0
            return tagged

        return {
            "exact": _tag(list(matched.get("exact") or [])),
            "candidates": _tag(list(matched.get("candidates") or [])),
        }

    async def match_nomenclature_to_hub(
        self,
        nomenclature_code: str = "",
        nomenclature_name: str = "",
        nomenclature_ref: str = "",
        owner_no: int | None = None,
        warehouse_name: str = "",
        employee_name: str = "",
        qty_balance: float | None = None,
        limit: int | None = None,
        db_id: str | None = None,
        scope: str = "current",
    ) -> dict[str, Any]:
        """Reverse match in the current HUB DB unless an admin opts into all."""
        from backend.api.v1.database import get_all_db_configs
        from backend.database import queries as db_queries

        code = normalize_text(nomenclature_code)
        name = normalize_text(nomenclature_name)
        ref = normalize_1c_ref(nomenclature_ref)
        if not code and not name:
            raise Warehouse1CValidationError("nomenclature_code или nomenclature_name обязателен")

        normalized_limit = clamp_limit(limit, 50, 200)
        prefer_owner_hint: int | None = None
        try:
            prefer_owner_hint = int(owner_no) if owner_no is not None else None
        except (TypeError, ValueError):
            prefer_owner_hint = None
        if prefer_owner_hint is not None and prefer_owner_hint <= 0:
            prefer_owner_hint = None

        warehouse_label = normalize_text(warehouse_name)
        employee_label = normalize_text(employee_name)
        current_db_id = str(db_id or "").strip() or None

        expected_qty: float | None = None
        if qty_balance is not None:
            try:
                expected_qty = float(qty_balance)
            except (TypeError, ValueError):
                expected_qty = None
            if expected_qty is not None and expected_qty < 0:
                expected_qty = None

        part_nos: list[str] = []
        if code and db_queries._is_usable_hub_part_no(code):
            part_nos.append(code)

        source_text = name or code
        tokens = tokenize_hub_text(source_text)
        if not tokens and len(source_text) >= SUGGEST_MIN_TOKEN_LEN:
            tokens = [source_text.casefold()]

        model_patterns: list[str] = []
        seen_patterns: set[str] = set()
        for token in sorted(dict.fromkeys(tokens), key=lambda t: (-len(t), t)):
            if len(token) < SUGGEST_MIN_TOKEN_LEN or token in seen_patterns:
                continue
            seen_patterns.add(token)
            model_patterns.append(token)
            if len(model_patterns) >= 6:
                break

        scope_key = normalize_text(scope).lower() or "current"
        if scope_key not in {"current", "all"}:
            raise Warehouse1CValidationError("scope должен быть current или all")
        try:
            db_configs = select_hub_db_configs_for_scope(
                get_all_db_configs(),
                current_db_id=current_db_id,
                scope=scope_key,
            )
        except Warehouse1CAllScopeConfigurationError as exc:
            raise Warehouse1CValidationError(str(exc)) from exc

        exact: list[dict[str, Any]] = []
        candidates: list[dict[str, Any]] = []
        searched_dbs: list[dict[str, Any]] = []

        for cfg in db_configs:
            one_db_id = str(cfg.get("id") or "").strip() or None
            one_db_name = str(cfg.get("name") or one_db_id or "Hub").strip() or "Hub"
            is_current_db = bool(
                current_db_id
                and one_db_id
                and current_db_id.casefold() == one_db_id.casefold()
            )
            prefer = self._resolve_prefer_owner_no_for_db(
                db_id=one_db_id,
                owner_no=prefer_owner_hint,
                current_db_id=current_db_id,
                warehouse_label=warehouse_label,
                employee_label=employee_label,
            )
            try:
                one = self._match_nomenclature_to_hub_one_db(
                    part_nos=part_nos,
                    model_patterns=model_patterns,
                    prefer_owner_no=prefer,
                    limit=normalized_limit,
                    db_id=one_db_id,
                    db_name=one_db_name,
                    is_current_db=is_current_db,
                )
            except Exception as exc:
                logger.warning("match-to-hub failed for db=%s: %s", one_db_id, exc)
                searched_dbs.append({
                    "id": one_db_id,
                    "name": one_db_name,
                    "error": str(exc)[:200],
                })
                continue

            exact.extend(one.get("exact") or [])
            candidates.extend(one.get("candidates") or [])
            searched_dbs.append({
                "id": one_db_id,
                "name": one_db_name,
                "prefer_owner_no": prefer,
                "exact_count": len(one.get("exact") or []),
                "candidates_count": len(one.get("candidates") or []),
            })

        need_more = False
        owners_with_exact: set[tuple[str, int]] = set()
        for row in exact:
            try:
                owner_id = int(row.get("owner_no"))
            except (TypeError, ValueError):
                continue
            if owner_id > 0:
                owners_with_exact.add((str(row.get("hub_db_id") or ""), owner_id))

        # When reconciling a specific person's warehouse / owner: only THEIR exact
        # PART_NO hits. Foreign holders (e.g. Levitsky while checking Kiselev) must
        # not appear — even if they already own that part in Hub.
        has_person_context = bool(prefer_owner_hint or warehouse_label or employee_label)
        exact_for_current = [row for row in exact if row.get("is_current_owner")]
        if has_person_context:
            exact = exact_for_current
            matched_count = len(exact_for_current)
            if expected_qty is not None and expected_qty > matched_count:
                need_more = True
            elif matched_count > 0:
                candidates = []
        elif exact_for_current:
            exact = exact_for_current
            matched_count = len(exact_for_current)
            if expected_qty is not None and expected_qty > matched_count:
                need_more = True
            else:
                candidates = []

        if candidates and owners_with_exact:
            filtered_candidates: list[dict[str, Any]] = []
            for row in candidates:
                try:
                    owner_id = int(row.get("owner_no"))
                except (TypeError, ValueError):
                    owner_id = None
                db_key = str(row.get("hub_db_id") or "")
                if owner_id is not None and (db_key, owner_id) in owners_with_exact:
                    if not (need_more and row.get("is_current_owner")):
                        continue
                # With a person context, keep only this person's candidates unless need_more.
                if has_person_context and not need_more and not row.get("is_current_owner"):
                    continue
                filtered_candidates.append(row)
            candidates = filtered_candidates

        def _sort_key(row: dict[str, Any]) -> tuple:
            return (
                0 if row.get("is_current_owner") else 1,
                0 if row.get("is_current_db") else 1,
                str(row.get("hub_db_name") or "").casefold(),
                str(row.get("employee_name") or "").casefold(),
                str(row.get("inv_no") or ""),
            )

        exact = sorted(exact, key=_sort_key)
        candidates = sorted(candidates, key=_sort_key)

        return {
            "exact": exact,
            "candidates": candidates,
            "need_more": need_more,
            "matched_count": len(exact),
            "qty_balance": expected_qty,
            "databases": searched_dbs,
            "query": {
                "nomenclature_ref": ref,
                "nomenclature_code": code,
                "nomenclature_name": name,
                "part_nos": part_nos,
                "tokens": model_patterns,
                "owner_no": prefer_owner_hint,
                "warehouse_name": warehouse_label,
                "employee_name": employee_label,
                "qty_balance": expected_qty,
                "current_db_id": current_db_id,
            },
        }

    # ------------------------------------------------------------------
    # Ведомость с деньгами (movements)
    # ------------------------------------------------------------------
    @staticmethod
    def _is_actual_movement(row: dict[str, Any]) -> bool:
        """Exclude virtual-table opening/closing balance boundary rows.

        ``ОстаткиИОбороты`` emits rows for the requested period boundaries.
        They have an unchanged balance, no registrar and zero turnover, so
        presenting them as documents makes the route and attachment controls
        look broken.  A real registrar is retained even for a zero-value
        correction; cost-only movements are retained through turnover fields.
        """
        if is_meaningful_1c_ref(row.get("registrar_ref")) or normalize_text(row.get("registrar_name")):
            return True
        turnover_fields = (
            "qty_in",
            "qty_out",
            "cost_in",
            "cost_out",
            "cost_accounting_in",
            "cost_accounting_out",
        )
        return any(abs(one_c_number(row.get(field))) > QTY_EPSILON for field in turnover_fields)

    def _row_to_movement(self, connection: Any, row: Any) -> dict[str, Any]:
        qty_start = one_c_number(row.КоличествоНачало)
        qty_end = one_c_number(row.КоличествоКонец)
        cost_acc_start = one_c_number(row.СтоимостьБухНачало)
        cost_acc_end = one_c_number(row.СтоимостьБухКонец)
        transfer_number = one_c_text(connection, row.НомерПеремещения)
        transfer_date = one_c_datetime(connection, row.ДатаПеремещения)
        registrar_ref = ref_uuid(connection, row.Регистратор)
        supported_document_type = ""
        if is_meaningful_1c_ref(ref_uuid(connection, row.СсылкаПеремещения)):
            supported_document_type = "transfer"
        elif is_meaningful_1c_ref(ref_uuid(connection, row.СсылкаПрихода)):
            supported_document_type = "receipt"
        elif is_meaningful_1c_ref(ref_uuid(connection, row.СсылкаРасхода)):
            supported_document_type = "expense"
        return {
            "registrar_ref": registrar_ref,
            "registrar_name": one_c_text(connection, row.Регистратор),
            "registrar_number": transfer_number,
            "registrar_date": transfer_date,
            "is_transfer": bool(transfer_number),
            # The UI must not offer a dead detail link for arbitrary register
            # documents: only the explicit document joins below are supported.
            "can_open_detail": bool(supported_document_type and is_meaningful_1c_ref(registrar_ref)),
            "registrar_document_type": supported_document_type or None,
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
    Перемещение.Ссылка КАК СсылкаПеремещения,
    Приход.Ссылка КАК СсылкаПрихода,
    Расход.Ссылка КАК СсылкаРасхода,
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
        ЛЕВОЕ СОЕДИНЕНИЕ Документ.бит_стр_ПриходныйОрдер КАК Приход
        ПО ОиО.Регистратор = Приход.Ссылка
        ЛЕВОЕ СОЕДИНЕНИЕ Документ.бит_стр_РасходныйОрдер КАК Расход
        ПО ОиО.Регистратор = Расход.Ссылка
УПОРЯДОЧИТЬ ПО
    ОиО.ПериодСекунда УБЫВ
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
            # A movement is history, not a current-balance view.  Closing
            # receipts/expenses are still material even when the final qty is
            # zero or negative, so never filter on qty_end here.
            movement = self._row_to_movement(connection, selection)
            if self._is_actual_movement(movement):
                rows.append(movement)
        return rows

    async def get_movements(
        self,
        nomenclature_ref: str,
        warehouse_ref: str = "",
        series_ref: str = "",
        date_from: str | None = None,
        date_to: str | None = None,
        limit: int | None = None,
        cursor: str | None = None,
        include_meta: bool = False,
    ) -> list[dict[str, Any]] | dict[str, Any]:
        normalized_nomenclature_ref = normalize_1c_ref(nomenclature_ref)
        if not normalized_nomenclature_ref:
            raise Warehouse1CValidationError("nomenclature_ref обязателен для ведомости движений")
        parsed_date_from = parse_date_param(date_from, "date_from")
        parsed_date_to = parse_date_param(date_to, "date_to")
        # The movements screen is a document history.  Empty date fields mean
        # the complete history for the selected nomenclature/warehouse; a
        # hidden rolling window made real transfer documents look missing.
        if parsed_date_from is not None and parsed_date_to is None:
            parsed_date_to = date.today()
        if parsed_date_from is not None and parsed_date_to is not None and parsed_date_from > parsed_date_to:
            raise Warehouse1CValidationError("date_from не может быть позже date_to")
        normalized_limit = clamp_limit(limit, MOVEMENTS_DEFAULT_LIMIT, MOVEMENTS_MAX_LIMIT)
        offset = decode_movement_cursor(cursor)
        if offset >= MOVEMENTS_MAX_LIMIT:
            raise Warehouse1CValidationError("Достигнут максимальный объём выдачи движений; сузьте период")
        bridged = await self._run_process_bridge(
            "movements",
            {
                "nomenclature_ref": normalized_nomenclature_ref,
                "warehouse_ref": normalize_1c_ref(warehouse_ref),
                "series_ref": normalize_1c_ref(series_ref),
                "date_from": parsed_date_from.isoformat() if parsed_date_from else "",
                "date_to": parsed_date_to.isoformat() if parsed_date_to else "",
                "limit": normalized_limit,
                "cursor": cursor or "",
                "include_meta": bool(include_meta),
            },
        )
        if bridged is not _PROCESS_BRIDGE_DISABLED:
            return bridged
        # Fetch one extra row so a caller can distinguish a complete history
        # from the first page of a truncated one without an extra COM query.
        fetch_limit = min(MOVEMENTS_MAX_LIMIT, offset + normalized_limit + 1)
        rows = await self._run_pooled(
            self._get_movements_sync,
            normalized_nomenclature_ref,
            normalize_1c_ref(warehouse_ref),
            normalize_1c_ref(series_ref),
            parsed_date_from,
            parsed_date_to,
            fetch_limit,
        )
        # Keep the contract correct for alternate bridge implementations and
        # test seams as well as for the local COM query above.
        rows = [row for row in rows if self._is_actual_movement(row)]
        page = rows[offset : offset + normalized_limit]
        next_offset = offset + len(page)
        has_more_within_cap = len(rows) > next_offset
        cap_reached = next_offset >= MOVEMENTS_MAX_LIMIT and len(rows) >= MOVEMENTS_MAX_LIMIT
        has_more = has_more_within_cap and next_offset < MOVEMENTS_MAX_LIMIT
        if not include_meta:
            return page
        return {
            "items": page,
            "returned": len(page),
            "total": (offset + len(page)) if not has_more else None,
            "has_more": has_more,
            "truncated": has_more or cap_reached,
            "incomplete_reason": "limit_cap" if cap_reached else ("next_page" if has_more else None),
            "next_cursor": encode_movement_cursor(next_offset) if has_more else None,
            "as_of": utc_now_iso(),
            "source": "live_1c",
            "status": "incomplete" if (has_more or cap_reached) else "ok",
            "date_from": parsed_date_from.isoformat() if parsed_date_from else None,
            "date_to": parsed_date_to.isoformat() if parsed_date_to else None,
        }

    # ------------------------------------------------------------------
    # Movement / transfer detail (registrar drill-down + attached files)
    # ------------------------------------------------------------------
    @staticmethod
    def _is_permission_denied_error(exc: Exception) -> bool:
        message = format_com_error(exc).casefold()
        return "недостаточно прав" in message

    def _get_attached_files_sync(self, connection: Any, owner_ref: Any) -> dict[str, Any]:
        # BIT "Прикрепление файлов" stores attachments in
        # Справочник.бит_ХранилищеДополнительнойИнформации (not BSP ПрисоединенныеФайлы).
        try:
            query = connection.NewObject("Query")
            query.Text = f"""
ВЫБРАТЬ
    Х.Ссылка КАК СсылкаФайла,
    Х.Наименование КАК Наименование,
    Х.ИмяФайла КАК ИмяФайла,
    Х.ВидДанных КАК ВидДанных,
    Х.ТипХраненияФайла КАК ТипХраненияФайла
ИЗ
    Справочник.{ATTACHED_FILES_CATALOG} КАК Х
ГДЕ
    Х.Объект = &Объект
    И НЕ Х.ПометкаУдаления
"""
            query.SetParameter("Объект", owner_ref)
            selection = query.Execute().Select()
            files: list[dict[str, Any]] = []
            while selection.Next():
                filename = one_c_text(connection, selection.ИмяФайла)
                title = one_c_text(connection, selection.Наименование)
                display_name = filename or title or "Без имени"
                files.append(
                    {
                        "ref": ref_uuid(connection, selection.СсылкаФайла),
                        "name": display_name,
                        "extension": _guess_extension(display_name),
                        "size": None,
                        "storage_type": one_c_text(connection, selection.ТипХраненияФайла),
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
                        f"справочника «{ATTACHED_FILES_CATALOG}» в 1С. "
                        "Попросите администратора 1С выдать право чтения."
                    ),
                }
            if "таблица не найдена" in last_error.casefold():
                return {
                    "status": "unsupported",
                    "files": [],
                    "message": (
                        "В этой базе 1С не найден справочник "
                        f"«{ATTACHED_FILES_CATALOG}»."
                    ),
                }
            return {
                "status": "empty",
                "files": [],
                "message": last_error or "Прикреплённые файлы не найдены.",
            }

    def _extract_storage_bytes(self, connection: Any, storage_value: Any) -> bytes:
        if storage_value is None:
            return b""
        payload = storage_value
        try:
            payload = storage_value.Получить()
        except Exception:
            payload = storage_value
        if payload is None:
            return b""
        try:
            b64 = connection.Base64Строка(payload)
            text = normalize_text(b64).replace("\r", "").replace("\n", "")
            if text:
                return base64.b64decode(text)
        except Exception:
            pass
        try:
            hex_str = connection.ПолучитьHexСтрокуИзДвоичныхДанных(payload)
            text = normalize_text(hex_str)
            if text:
                return bytes.fromhex(text)
        except Exception as exc:
            raise Warehouse1CQueryError(
                f"Не удалось прочитать содержимое файла из 1С: {format_com_error(exc)}"
            ) from exc
        return b""

    def _resolve_registrar_document(
        self,
        connection: Any,
        registrar_ref: str,
    ) -> tuple[dict[str, Any], Any, Any]:
        """Resolve UUID against known warehouse document types.

        Returns (meta, owner_ref, selection) where selection has at least
        Номер/Дата/Комментарий and type-specific warehouse fields.
        """
        last_error = ""
        for meta in WAREHOUSE_REGISTRAR_DOCUMENTS:
            doc_name = meta["name"]
            try:
                owner_ref = self._rebuild_document_ref(connection, doc_name, registrar_ref)
            except Warehouse1CValidationError as exc:
                last_error = str(exc)
                continue

            if meta.get("has_route"):
                select_fields = """
    Док.Номер КАК Номер,
    Док.Дата КАК Дата,
    Док.Комментарий КАК Комментарий,
    Док.СкладОтправитель КАК СкладОтправитель,
    Док.СкладПолучатель КАК СкладПолучатель,
    НЕОПРЕДЕЛЕНО КАК Склад,
    НЕОПРЕДЕЛЕНО КАК Контрагент
"""
            else:
                select_fields = """
    Док.Номер КАК Номер,
    Док.Дата КАК Дата,
    Док.Комментарий КАК Комментарий,
    НЕОПРЕДЕЛЕНО КАК СкладОтправитель,
    НЕОПРЕДЕЛЕНО КАК СкладПолучатель,
    Док.Склад КАК Склад,
    Док.Контрагент КАК Контрагент
"""
            try:
                query = connection.NewObject("Query")
                query.Text = f"""
ВЫБРАТЬ
{select_fields}
ИЗ
    Документ.{doc_name} КАК Док
ГДЕ
    Док.Ссылка = &Ссылка
"""
                query.SetParameter("Ссылка", owner_ref)
                selection = query.Execute().Select()
                if selection.Next():
                    return meta, owner_ref, selection
            except Exception as exc:
                last_error = format_com_error(exc)
                continue

        detail = f" ({last_error})" if last_error else ""
        raise Warehouse1CValidationError(
            f"Документ склада не найден по указанной ссылке{detail}"
        )

    def _get_attached_file_content_sync(
        self,
        connection: Any,
        *,
        registrar_ref: str,
        file_ref: str,
    ) -> dict[str, Any]:
        # Resolve owner by trying known document types — attachments belong to
        # receipt/expense orders as well as inter-warehouse transfers.
        _meta, owner_ref, _selection = self._resolve_registrar_document(
            connection, registrar_ref
        )
        file_obj_ref = self._rebuild_ref(connection, ATTACHED_FILES_CATALOG, file_ref)
        query = connection.NewObject("Query")
        query.Text = f"""
ВЫБРАТЬ ПЕРВЫЕ 1
    Х.Ссылка КАК СсылкаФайла,
    Х.Наименование КАК Наименование,
    Х.ИмяФайла КАК ИмяФайла,
    Х.ПутьКФайлу КАК ПутьКФайлу
ИЗ
    Справочник.{ATTACHED_FILES_CATALOG} КАК Х
ГДЕ
    Х.Ссылка = &Файл
    И Х.Объект = &Объект
    И НЕ Х.ПометкаУдаления
"""
        query.SetParameter("Файл", file_obj_ref)
        query.SetParameter("Объект", owner_ref)
        selection = query.Execute().Select()
        if not selection.Next():
            raise Warehouse1CValidationError(
                "Файл не найден или не принадлежит указанному документу"
            )

        filename = one_c_text(connection, selection.ИмяФайла)
        title = one_c_text(connection, selection.Наименование)
        display_name = filename or title or "file.bin"
        path = one_c_text(connection, selection.ПутьКФайлу)

        content = b""
        if path:
            try:
                if os.path.getsize(path) > max_attached_file_bytes():
                    raise Warehouse1CQueryError(
                        "Файл в 1С превышает разрешённый размер для скачивания"
                    )
                with open(path, "rb") as handle:
                    content = handle.read()
            except OSError as exc:
                raise Warehouse1CQueryError(
                    "Не удалось прочитать вложенный файл из 1С"
                ) from exc
        else:
            obj = selection.СсылкаФайла.ПолучитьОбъект()
            content = self._extract_storage_bytes(connection, obj.Хранилище)

        if not content:
            raise Warehouse1CQueryError("Файл в 1С пустой или недоступен")
        if len(content) > max_attached_file_bytes():
            raise Warehouse1CQueryError(
                "Файл в 1С превышает разрешённый размер для скачивания"
            )

        return {
            "name": display_name,
            "content_type": _guess_content_type(display_name),
            "content": content,
            "size": len(content),
        }

    def _get_movement_detail_sync(self, connection: Any, registrar_ref: str) -> dict[str, Any]:
        meta, owner_ref, selection = self._resolve_registrar_document(
            connection, registrar_ref
        )
        attached = self._get_attached_files_sync(connection, owner_ref)
        is_transfer = bool(meta.get("has_route"))
        return {
            "registrar_ref": normalize_text(registrar_ref),
            "registrar_name": one_c_text(connection, owner_ref),
            "registrar_number": one_c_text(connection, selection.Номер),
            "registrar_date": one_c_datetime(connection, selection.Дата),
            "document_type": meta["key"],
            "document_title": meta["title"],
            "is_transfer": is_transfer,
            "warehouse_ref": ref_uuid(connection, selection.Склад),
            "warehouse_name": one_c_text(connection, selection.Склад),
            "counterparty_name": one_c_text(connection, selection.Контрагент),
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

    async def get_movement_file(self, registrar_ref: str, file_ref: str) -> dict[str, Any]:
        normalized_registrar = normalize_text(registrar_ref)
        normalized_file = normalize_text(file_ref)
        if not normalized_registrar:
            raise Warehouse1CValidationError("registrar_ref обязателен")
        if not normalized_file:
            raise Warehouse1CValidationError("file_ref обязателен")
        return await self._run_pooled(
            self._get_attached_file_content_sync,
            registrar_ref=normalized_registrar,
            file_ref=normalized_file,
        )


warehouse_1c_service = Warehouse1CService()


async def background_warehouse_1c_catalog_sync_loop() -> None:
    interval = env_positive_int(
        "WAREHOUSE_1C_CATALOG_SYNC_INTERVAL_SECONDS",
        DEFAULT_CATALOG_SYNC_INTERVAL_SECONDS,
        300,
    )
    try:
        warmup = await asyncio.to_thread(warehouse_1c_service.warmup_connection)
        logger.info("Warehouse 1C COM bridge warmup finished: ready=%s", warmup.get("ready"))
    except asyncio.CancelledError:
        raise
    except Exception as exc:
        logger.warning("Warehouse 1C COM bridge warmup failed: %s", exc)
    await asyncio.sleep(30)
    # A restart must not immediately rebuild a healthy shared snapshot. The
    # first full refresh is useful only when no promoted generation exists;
    # otherwise wait for the configured catalogue SLA interval.
    initial_status = await asyncio.to_thread(warehouse_1c_service.get_catalog_status)
    initial_app_snapshot = initial_status.get("app_snapshot") or {}
    if initial_status.get("read_mode") == "app_snapshot" and initial_app_snapshot.get("has_snapshot"):
        await asyncio.sleep(interval)
    while True:
        try:
            logger.info("Starting scheduled warehouse 1C catalog sync")
            status = await asyncio.to_thread(warehouse_1c_service.sync_catalog_from_1c_as_leader)
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
