"""Shadow-read compact search against the token engine answer.



User always receives the tokens (primary) answer.  Compact runs in a bounded

worker pool with its *own* Session (never the request Session).  Failures,

timeouts, and queue overflow never break the user request.



Logs contain hashed query shapes only — never raw query/code/name/ref.

"""

from __future__ import annotations



import logging

import random

import threading

import time

from concurrent.futures import Future, ThreadPoolExecutor, TimeoutError as FuturesTimeout

from dataclasses import dataclass, field

from typing import Any, Callable



from sqlalchemy import text



from backend.appdb.db import get_app_session_factory

from backend.services.one_c_catalog_compact_docs import hash_query_shape

from backend.services.one_c_catalog_compact_flags import OneCCatalogCompactFlags, get_compact_flags

from backend.services.one_c_catalog_compact_search import OneCCatalogCompactSearch

from backend.services.one_c_catalog_search import catalog_query_tokens





logger = logging.getLogger(__name__)



# Bounded pool: overflow skips shadow so the user path never waits on a queue.

_SHADOW_MAX_WORKERS = 2

_SHADOW_MAX_PENDING = 8

_executor_lock = threading.Lock()

_executor: ThreadPoolExecutor | None = ThreadPoolExecutor(

    max_workers=_SHADOW_MAX_WORKERS,

    thread_name_prefix="one_c_compact_shadow",

)

_pending = 0

_pending_lock = threading.Lock()





@dataclass

class ShadowCompareResult:

    sampled: bool = False

    compared: bool = False

    timed_out: bool = False

    skipped_queue_full: bool = False

    error: str = ""

    query_shape: str = ""

    catalog_type: str = ""

    query_token_count: int = 0

    query_len: int = 0

    primary_top_n: list[str] = field(default_factory=list)

    compact_top_n: list[str] = field(default_factory=list)

    missing_refs: int = 0

    extra_refs: int = 0

    rank_swaps: int = 0

    primary_latency_ms: float = 0.0

    compact_latency_ms: float = 0.0

    compact_stage: str = ""

    shadow_backend_pid: int | None = None





def _top_refs(rows: list[dict[str, Any]], n: int = 10) -> list[str]:

    out: list[str] = []

    for row in rows[:n]:

        ref = str(row.get("ref") or "")

        if ref:

            out.append(ref)

    return out





def compare_ref_lists(primary: list[str], compact: list[str]) -> tuple[int, int, int]:

    primary_set = set(primary)

    compact_set = set(compact)

    missing = len(primary_set - compact_set)

    extra = len(compact_set - primary_set)

    swaps = 0

    for index, ref in enumerate(primary):

        if index < len(compact) and compact[index] != ref and ref in compact_set:

            swaps += 1

    return missing, extra, swaps





def shutdown_shadow_executor(*, wait: bool = True) -> None:

    """Close the shadow thread pool (process shutdown / tests)."""

    global _executor

    with _executor_lock:

        executor = _executor

        _executor = None

    if executor is not None:

        executor.shutdown(wait=wait, cancel_futures=True)





def _get_executor() -> ThreadPoolExecutor | None:

    with _executor_lock:

        return _executor





def _try_acquire_slot() -> bool:

    global _pending

    with _pending_lock:

        if _pending >= _SHADOW_MAX_PENDING:

            return False

        _pending += 1

        return True





def _release_slot() -> None:

    global _pending

    with _pending_lock:

        if _pending > 0:

            _pending -= 1





def pending_shadow_count() -> int:

    with _pending_lock:

        return _pending





def run_compact_shadow_search_isolated(

    *,

    database_url: str | None,

    catalog_type: str,

    text_query: str,

    limit: int,

    source_base: str,

    generation: int,

    flags: OneCCatalogCompactFlags | None = None,

    statement_timeout_ms: int | None = None,

) -> Any:

    """Run compact search on a *dedicated* Session inside the calling thread.



    - Opens Session via factory (never reuses a caller/request Session)

    - Never commits

    - Always closes in ``finally``

    - Applies statement_timeout so timed-out work frees the connection

    """

    resolved = flags or get_compact_flags()

    timeout_ms = max(

        1,

        int(

            statement_timeout_ms

            if statement_timeout_ms is not None

            else resolved.shadow_timeout_ms

        ),

    )

    factory = get_app_session_factory(database_url)

    session = factory()

    backend_pid: int | None = None

    try:

        if session.get_bind().dialect.name == "postgresql":

            try:

                session.execute(text(f"SET LOCAL statement_timeout = '{timeout_ms}ms'"))

                backend_pid = int(

                    session.execute(text("SELECT pg_backend_pid()")).scalar_one()

                )

            except Exception:

                backend_pid = None

        searcher = OneCCatalogCompactSearch(database_url, flags=resolved)

        result = searcher.search_entries_on_session(

            session,

            catalog_type=catalog_type,

            text_query=text_query,

            limit=limit,

            source_base=source_base,

            generation=generation,

        )

        # Attach pid for thread-safety tests (not logged as PII).

        try:

            setattr(result, "shadow_backend_pid", backend_pid)

        except Exception:

            pass

        return result

    finally:

        try:

            session.rollback()

        except Exception:

            pass

        session.close()





def maybe_shadow_compare(

    *,

    catalog_type: str,

    text_query: str,

    primary_rows: list[dict[str, Any]],

    primary_latency_ms: float,

    compact_search: Callable[[], Any],

    flags: OneCCatalogCompactFlags | None = None,

    top_n: int = 10,

) -> ShadowCompareResult:

    resolved = flags or get_compact_flags()

    tokens = catalog_query_tokens(text_query)

    shape = hash_query_shape(text_query, catalog_type=catalog_type, tokens=tokens)

    result = ShadowCompareResult(

        query_shape=shape,

        catalog_type=catalog_type,

        query_token_count=len(tokens),

        query_len=len(str(text_query or "")),

        primary_top_n=_top_refs(primary_rows, top_n),

        primary_latency_ms=primary_latency_ms,

    )

    if not resolved.search_shadow:

        return result

    rate = resolved.shadow_sample_rate

    if rate <= 0:

        return result

    if rate < 1.0 and random.random() > rate:

        return result

    result.sampled = True



    executor = _get_executor()

    if executor is None:

        result.error = "executor_shutdown"

        return result

    if not _try_acquire_slot():

        result.skipped_queue_full = True

        result.error = "queue_full"

        logger.info(

            "1C compact shadow skipped queue_full shape=%s catalog_type=%s",

            shape,

            catalog_type,

        )

        return result



    def _wrapped() -> Any:

        try:

            return compact_search()

        finally:

            _release_slot()



    timeout_s = max(0.01, resolved.shadow_timeout_ms / 1000.0)

    future: Future

    try:

        future = executor.submit(_wrapped)

    except RuntimeError:

        _release_slot()

        result.error = "executor_shutdown"

        return result



    try:

        compact_result = future.result(timeout=timeout_s)

    except FuturesTimeout:

        result.timed_out = True

        # Do not wait on the worker: statement_timeout on its Session frees the

        # PG connection; slot is released in _wrapped finally.

        logger.info(

            "1C compact shadow timeout shape=%s catalog_type=%s timeout_ms=%s",

            shape,

            catalog_type,

            resolved.shadow_timeout_ms,

        )

        return result

    except Exception as exc:

        result.error = type(exc).__name__

        logger.info(

            "1C compact shadow error shape=%s catalog_type=%s err_type=%s",

            shape,

            catalog_type,

            type(exc).__name__,

        )

        return result



    try:

        if hasattr(compact_result, "rows"):

            rows = list(compact_result.rows or [])

            result.compact_latency_ms = float(getattr(compact_result, "latency_ms", 0.0) or 0.0)

            result.compact_stage = str(getattr(compact_result, "stage", "") or "")

            if getattr(compact_result, "error", ""):

                result.error = str(compact_result.error)

            pid = getattr(compact_result, "shadow_backend_pid", None)

            if pid is not None:

                result.shadow_backend_pid = int(pid)

        else:

            rows = list(compact_result or [])

        result.compact_top_n = _top_refs(rows, top_n)

        missing, extra, swaps = compare_ref_lists(result.primary_top_n, result.compact_top_n)

        result.missing_refs = missing

        result.extra_refs = extra

        result.rank_swaps = swaps

        result.compared = True

        logger.info(

            "1C compact shadow compare shape=%s catalog_type=%s qlen=%s tokens=%s "

            "missing=%s extra=%s swaps=%s primary_ms=%.1f compact_ms=%.1f stage=%s",

            shape,

            catalog_type,

            result.query_len,

            result.query_token_count,

            missing,

            extra,

            swaps,

            result.primary_latency_ms,

            result.compact_latency_ms,

            result.compact_stage,

        )

    except Exception as exc:

        result.error = type(exc).__name__

        logger.info(

            "1C compact shadow compare failed shape=%s err_type=%s",

            shape,

            type(exc).__name__,

        )

    return result





def run_compact_shadow_search(

    *,

    database_url: str | None,

    catalog_type: str,

    text_query: str,

    limit: int,

    source_base: str,

    generation: int,

    flags: OneCCatalogCompactFlags | None = None,

) -> Any:

    """Backward-compatible name — always uses an isolated Session."""

    return run_compact_shadow_search_isolated(

        database_url=database_url,

        catalog_type=catalog_type,

        text_query=text_query,

        limit=limit,

        source_base=source_base,

        generation=generation,

        flags=flags,

    )





def shadow_after_tokens(

    *,

    database_url: str | None,

    catalog_type: str,

    text_query: str,

    limit: int,

    source_base: str,

    generation: int,

    primary_rows: list[dict[str, Any]],

    primary_started: float,

    flags: OneCCatalogCompactFlags | None = None,

) -> ShadowCompareResult:

    primary_latency_ms = (time.perf_counter() - primary_started) * 1000.0

    resolved = flags or get_compact_flags()



    def _compact():

        return run_compact_shadow_search_isolated(

            database_url=database_url,

            catalog_type=catalog_type,

            text_query=text_query,

            limit=limit,

            source_base=source_base,

            generation=generation,

            flags=resolved,

            statement_timeout_ms=resolved.shadow_timeout_ms,

        )



    try:

        return maybe_shadow_compare(

            catalog_type=catalog_type,

            text_query=text_query,

            primary_rows=primary_rows,

            primary_latency_ms=primary_latency_ms,

            compact_search=_compact,

            flags=resolved,

        )

    except Exception as exc:

        logger.info(

            "1C compact shadow wrapper failed err_type=%s",

            type(exc).__name__,

        )

        return ShadowCompareResult(error=type(exc).__name__)


