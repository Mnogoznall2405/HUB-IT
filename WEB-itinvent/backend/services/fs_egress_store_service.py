"""File egress / telegram probe persistence: PostgreSQL primary, SQLite fallback for tests."""
from __future__ import annotations

import base64
import logging
import os
import re
import sys
import threading
import time
from datetime import datetime, timedelta, timezone
from functools import lru_cache
from pathlib import Path
from typing import Any, Callable, Dict, List, Optional, Protocol

from backend.services.dlp_categories import CATEGORY_META
from backend.utils.network_scope import resolve_network_scope

logger = logging.getLogger(__name__)

PROJECT_ROOT = Path(__file__).resolve().parents[3]
if str(PROJECT_ROOT) not in sys.path:
    sys.path.insert(0, str(PROJECT_ROOT))


class _EgressStoreProto(Protocol):
    def ingest_file_left(self, events: List[Dict[str, Any]]) -> int: ...
    def list_file_left(
        self,
        *,
        computer_name: str = "",
        channel: str = "",
        limit: int = 100,
        offset: int = 0,
    ) -> List[Dict[str, Any]]: ...
    def upsert_telegram_chats(
        self,
        *,
        computer_name: str,
        windows_user: str,
        chats: List[Dict[str, Any]],
    ) -> int: ...
    def save_report(self, *, computer_name: str, windows_user: str, html: str) -> None: ...
    def save_media(
        self,
        *,
        computer_name: str,
        file_name: str,
        content: bytes,
        content_type: str = "application/octet-stream",
    ) -> None: ...
    def list_telegram_chats(self, *, computer_name: str = "", limit: int = 100) -> List[Dict[str, Any]]: ...
    def get_report(self, computer_name: str) -> Optional[Dict[str, Any]]: ...


class EgressStoreUnavailableError(RuntimeError):
    """The primary (PostgreSQL) egress store cannot be used and no fallback is allowed."""


def _sqlite_fallback_allowed() -> bool:
    return str(os.getenv("FS_EGRESS_ALLOW_SQLITE_FALLBACK", "") or "").strip().lower() in {"1", "true", "yes", "on"}


def _sqlite_db_path() -> Path:
    override = str(os.getenv("FS_EGRESS_DB_PATH", "") or "").strip()
    if override:
        return Path(override)
    data_dir = Path(os.getenv("FS_EGRESS_DATA_DIR", str(PROJECT_ROOT / "data" / "fs_egress")))
    return data_dir / "fs_egress.db"


@lru_cache(maxsize=1)
def get_egress_store() -> _EgressStoreProto:
    """APP_DATABASE_URL (PostgreSQL) is the store.  SQLite only when explicitly allowed
    (``FS_EGRESS_ALLOW_SQLITE_FALLBACK=1``, dev/tests): a silent fallback splits ingest and read
    across processes and, being cached, outlives a short PostgreSQL outage (DINT-04).  A failure
    raises and is NOT cached (lru_cache does not store exceptions), so the next call retries."""
    primary_error: Exception | None = None
    try:
        from backend.appdb.db import is_app_database_configured
        from backend.appdb.file_egress_store import AppFileEgressStore

        if is_app_database_configured():
            logger.info("file egress store: PostgreSQL (APP_DATABASE_URL)")
            return AppFileEgressStore()
    except Exception as exc:
        primary_error = exc
        logger.warning("file egress PostgreSQL store unavailable: %s", exc)

    if not _sqlite_fallback_allowed():
        raise EgressStoreUnavailableError("file egress store is unavailable") from primary_error

    from inventory_server.egress_store import EgressEventStore

    path = _sqlite_db_path()
    logger.warning("file egress store: SQLite fallback at %s", path)
    return EgressEventStore(db_path=path)


def ingest_events(events: List[Dict[str, Any]]) -> int:
    return get_egress_store().ingest_file_left(events)


def _media_cap_bytes() -> int:
    try:
        return max(0, int(str(os.getenv("ITINV_INGEST_MEDIA_MAX_BYTES", str(64 * 1024 * 1024)) or "")))
    except ValueError:
        return 64 * 1024 * 1024


class _MediaBudget:
    """Caps total decoded media bytes per ingest request.

    Overflow items are dropped (not the whole request): a hard reject would make the
    agent retry the same oversized batch forever.
    """

    def __init__(self, limit: int) -> None:
        self._limit = limit
        self.used = 0
        self.dropped = 0
        self.dropped_bytes = 0

    def take(self, size: int) -> bool:
        if self.used + size > self._limit:
            self.dropped += 1
            self.dropped_bytes += size
            return False
        self.used += size
        return True

    def report(self, kind: str) -> None:
        if self.dropped:
            logger.warning(
                "ingest %s media budget exceeded: dropped=%s dropped_bytes=%s cap=%s",
                kind,
                self.dropped,
                self.dropped_bytes,
                self._limit,
            )


def _save_media_items(
    store: Any,
    *,
    batch_attr: str,
    single_attrs: List[str],
    items: List[Dict[str, Any]],
) -> int:
    """One batched session when the store supports it, per-item fallback otherwise."""
    if not items:
        return 0
    batch_fn = getattr(store, batch_attr, None)
    if callable(batch_fn):
        return int(batch_fn(items) or 0)
    single = next(
        (getattr(store, attr, None) for attr in single_attrs if callable(getattr(store, attr, None))),
        None,
    )
    if single is None:
        return 0
    for item in items:
        single(
            computer_name=item["computer_name"],
            file_name=item["file_name"],
            content=item["content"],
            content_type=item["content_type"],
        )
    return len(items)


def list_events(
    *,
    computer_name: str = "",
    channel: str = "",
    limit: int = 100,
    offset: int = 0,
    group: bool = False,
    include_noise: bool = False,
    send_state: str = "",
) -> List[Dict[str, Any]]:
    store = get_egress_store()
    try:
        return store.list_file_left(
            computer_name=computer_name,
            channel=channel,
            limit=limit,
            offset=offset,
            group=group,
            include_noise=include_noise,
            send_state=send_state,
        )
    except TypeError:
        # SQLite fallback store predates group/noise kwargs — raw listing still works.
        return store.list_file_left(
            computer_name=computer_name,
            channel=channel,
            limit=limit,
            offset=offset,
        )


def count_events(
    *,
    computer_name: str = "",
    channel: str = "",
    include_noise: bool = True,
    noise_only: bool = False,
) -> int:
    store = get_egress_store()
    counter = getattr(store, "count_file_left", None)
    if not callable(counter):
        return 0
    return int(
        counter(
            computer_name=computer_name,
            channel=channel,
            include_noise=include_noise,
            noise_only=noise_only,
        )
        or 0
    )


# Branch context from AD/ITINVENT is an expensive SQL Server read — reuse it for
# ~10 minutes per process instead of per request.
_branch_ctx_lock = threading.Lock()
_branch_ctx_cache: Dict[str, Any] = {"expires": 0.0, "ctx": {}}
_BRANCH_CTX_TTL_SEC = 600.0


def _get_branch_context() -> Dict[str, Any]:
    now = time.time()
    with _branch_ctx_lock:
        if float(_branch_ctx_cache.get("expires") or 0.0) > now:
            return _branch_ctx_cache.get("ctx") or {}
    try:
        from backend.services import ad_users_service

        ctx = ad_users_service._load_branch_mapping_context() or {}
    except Exception:
        logger.warning("dlp hosts: branch mapping context unavailable", exc_info=True)
        ctx = {}
    with _branch_ctx_lock:
        _branch_ctx_cache["expires"] = now + _BRANCH_CTX_TTL_SEC
        _branch_ctx_cache["ctx"] = ctx
    return ctx


def _normalize_dlp_login(value: str) -> str:
    """'ZSGP\\user' / 'user.zsgp' / 'user' → lower-cased login for branch lookup."""
    raw = str(value or "").strip()
    if "\\" in raw:
        raw = raw.split("\\")[-1]
    raw = raw.strip().lower()
    if raw.endswith(".zsgp"):
        raw = raw[: -len(".zsgp")]
    return raw


# Host stats + summary are full-table aggregates (regex included) — cache briefly
# per process so the DLP page does not re-scan ~1.3M rows on every open.
# The cache is single-flight + stale-while-revalidate: after TTL expiry one
# caller recomputes while the rest get the stale value, so an ingest burst
# cannot pile dozens of identical heavy scans onto Postgres at once.
_dlp_cache_lock = threading.Lock()
_dlp_cache: Dict[str, Any] = {}
_dlp_refreshing: set = set()
_DLP_CACHE_TTL_SEC = 60.0


def _dlp_serve(key: str, compute: Callable[[], Any]) -> Any:
    now = time.time()
    with _dlp_cache_lock:
        entry = _dlp_cache.get(key) or {}
        if float(entry.get("expires") or 0.0) > now and entry.get("value") is not None:
            return entry["value"]
        stale = entry.get("value")
        if stale is not None and key in _dlp_refreshing:
            return stale
        _dlp_refreshing.add(key)
    try:
        value = compute()
    except Exception:
        if stale is not None:
            return stale
        raise
    finally:
        with _dlp_cache_lock:
            _dlp_refreshing.discard(key)
    with _dlp_cache_lock:
        _dlp_cache[key] = {"value": value, "expires": time.time() + _DLP_CACHE_TTL_SEC}
    return value


def _invalidate_attention_cache() -> None:
    with _dlp_cache_lock:
        for key in [k for k in _dlp_cache if str(k).startswith("attention")]:
            _dlp_cache.pop(key, None)


def _filter_hosts_by_category(rows: List[Dict[str, Any]], category: str) -> List[Dict[str, Any]]:
    cat = str(category or "").strip()
    if not cat:
        return rows
    store = get_egress_store()
    try:
        hosts = store.list_today_category_hosts(cat)
    except Exception:
        return rows
    return [row for row in rows if str(row.get("computer_name") or "") in hosts]


def list_dlp_hosts(category: str = "") -> List[Dict[str, Any]]:
    rows = _dlp_serve("hosts", _compute_dlp_hosts)
    return _filter_hosts_by_category(rows, category)


def _compute_dlp_hosts() -> List[Dict[str, Any]]:
    store = get_egress_store()
    lister = getattr(store, "list_dlp_host_stats", None)
    if not callable(lister):
        return []
    rows = lister() or []
    ctx = _get_branch_context()
    resolver = None
    if ctx:
        try:
            from backend.services import ad_users_service

            resolver = ad_users_service._resolve_branch_for_login
        except Exception:
            resolver = None
    for row in rows:
        # Primary branch source: the inventory binding (same as the Computers page).
        # Fallback: login → AD/ITINVENT user→branch map (only for hosts without a
        # binding — the map covers equipment owners, not every domain user).
        branch_no: Any = row.get("sql_branch_no") or None
        branch_name: Optional[str] = row.get("sql_branch_name") or None
        login = ""
        if branch_name is None:
            for candidate in (row.get("user_login"), row.get("windows_user")):
                norm = _normalize_dlp_login(candidate or "")
                if not norm:
                    continue
                if not login:
                    login = norm
                if resolver is None:
                    break
                try:
                    no, name = resolver(norm, ctx)
                except Exception:
                    no, name = None, None
                if no is not None:
                    login, branch_no, branch_name = norm, no, name
                    break
                if branch_name is None:
                    branch_name = name
        if not login:
            login = _normalize_dlp_login(row.get("user_login") or row.get("windows_user") or "")
        if branch_no is None:
            # Same fallback as the Computers page: no ITINVENT binding and no
            # user->branch map hit -> resolve the branch by host IP (CIDR rules).
            scope = resolve_network_scope([row.get("ip_primary")])
            if scope is not None:
                branch_name = scope.get("branch_name") or branch_name
        row["login"] = login
        row["branch_no"] = branch_no
        row["branch_name"] = branch_name or None
    return rows


def get_dlp_activity(*, computer_name: str, day: str = "") -> Dict[str, Any]:
    store = get_egress_store()
    getter = getattr(store, "list_dlp_activity", None)
    if not callable(getter):
        return {"buckets": [], "summary": {}, "apps_top": []}
    from backend.services import dlp_work_schedule_service as schedules_service

    # The branch schedule resolves BEFORE the bucket query: it defines both
    # which wall-clock day the host sees and the work/lunch/off zones.
    schedule = None
    host_row = None
    try:
        host_key = str(computer_name or "").strip().upper()
        host_row = next(
            (
                row
                for row in list_dlp_hosts()
                if str(row.get("computer_name") or "").upper() == host_key
            ),
            None,
        )
        schedules = schedules_service.load_schedules(store)
        if schedules:
            schedule = schedules_service.schedule_for_branch(
                schedules, (host_row or {}).get("branch_name")
            )
    except Exception:
        # A lookup hiccup must not hide store errors: fall back to the
        # Tyumen day and let the getter raise whatever it would.
        logger.warning("dlp schedules: lookup failed, falling back to Tyumen day", exc_info=True)
        schedule = None
        host_row = None
    offset = int(schedule.get("tz_offset_minutes") or 0) if schedule else 0
    day_key = str(day or "").strip() or datetime.now(
        timezone(timedelta(minutes=300 + offset))
    ).date().isoformat()
    payload = getter(computer_name=computer_name, day=day_key, tz_offset_minutes=offset) or {
        "buckets": [],
        "summary": {},
        "apps_top": [],
    }
    try:
        # Always runs: with no schedule it just tags zone=work and zeroes the new
        # fields, keeping the response shape consistent for the frontend.
        schedules_service.apply_to_activity_payload(schedule, payload)
    except Exception:
        logger.warning("dlp schedules: activity reclassification skipped", exc_info=True)
    payload["local_time"] = {
        "day": day_key,
        "branch_name": (host_row or {}).get("branch_name") or None,
        "utc_offset_minutes": 300 + offset,
        "work_start_min": schedule.get("work_start_min") if schedule else None,
        "work_end_min": schedule.get("work_end_min") if schedule else None,
        "lunch_start_min": schedule.get("lunch_start_min") if schedule else None,
        "lunch_end_min": schedule.get("lunch_end_min") if schedule else None,
        "workdays_mask": schedule.get("workdays_mask") if schedule else None,
    }
    return payload


def get_dlp_attention(day: str = "") -> List[Dict[str, Any]]:
    """Per-host day rollup (activity + focus + file egress), enriched like /dlp/hosts."""
    day_key = str(day or "").strip()

    def compute() -> Dict[str, Any]:
        store = get_egress_store()
        getter = getattr(store, "dlp_attention_stats", None)
        stats = getter(day=day_key) if callable(getter) else []
        stats = stats or []
        # Reuse the cached /dlp/hosts enrichment (login, full name, branch) instead
        # of resolving it here a second time.
        enriched: Dict[str, Dict[str, Any]] = {}
        try:
            for host_row in list_dlp_hosts():
                enriched[str(host_row.get("computer_name") or "").upper()] = host_row
        except Exception:
            enriched = {}
        for row in stats:
            info = enriched.get(str(row.get("computer_name") or "").upper())
            if info:
                row["windows_user"] = row.get("windows_user") or info.get("windows_user") or ""
                row["user_login"] = info.get("user_login") or info.get("login") or ""
                row["user_full_name"] = info.get("user_full_name") or ""
                row["branch_no"] = info.get("branch_no")
                row["branch_name"] = info.get("branch_name")
        try:
            from backend.services import dlp_work_schedule_service as schedules_service

            schedules_service.apply_to_attention_rows(store, stats, day_key)
        except Exception:
            logger.warning("dlp schedules: attention reclassification skipped", exc_info=True)
        return {"day": day_key, "hosts": stats}

    cached = _dlp_serve(f"attention:{day_key}", compute)
    return (cached or {}).get("hosts") or []


def list_work_schedules() -> Dict[str, Any]:
    """Configured branch schedules plus the known branch list for the admin UI."""
    store = get_egress_store()
    rows = store.list_branch_work_schedules() if callable(getattr(store, "list_branch_work_schedules", None)) else []
    branches = sorted(
        {
            str(row.get("branch_name") or "").strip()
            for row in list_dlp_hosts()
            if str(row.get("branch_name") or "").strip()
        }
        | {str(row.get("branch_name") or "").strip() for row in rows if str(row.get("branch_name") or "").strip()},
        key=lambda name: name.lower(),
    )
    from backend.services import dlp_work_schedule_service as schedules_service

    return {
        "items": [schedules_service.serialize_schedule(row) for row in rows],
        "branches": branches,
    }


def save_work_schedule(payload: Dict[str, Any], *, updated_by: str = "") -> Dict[str, Any]:
    store = get_egress_store()
    data = payload if isinstance(payload, dict) else {}
    row = store.upsert_branch_work_schedule(
        branch_name=data.get("branch_name"),
        work_start_min=data.get("work_start_min"),
        work_end_min=data.get("work_end_min"),
        lunch_start_min=data.get("lunch_start_min"),
        lunch_end_min=data.get("lunch_end_min"),
        tz_offset_minutes=data.get("tz_offset_minutes") or 0,
        workdays_mask=data.get("workdays_mask") if data.get("workdays_mask") is not None else 31,
        updated_by=updated_by,
    )
    from backend.services import dlp_work_schedule_service as schedules_service

    schedules_service.invalidate_schedules_cache()
    _invalidate_attention_cache()
    return schedules_service.serialize_schedule(row)


def delete_work_schedule(branch_name: str) -> bool:
    store = get_egress_store()
    deleted = bool(store.delete_branch_work_schedule(branch_name=branch_name))
    if deleted:
        from backend.services import dlp_work_schedule_service as schedules_service

        schedules_service.invalidate_schedules_cache()
        _invalidate_attention_cache()
    return deleted


def get_dlp_summary() -> Dict[str, Any]:
    def compute() -> Dict[str, Any]:
        store = get_egress_store()
        getter = getattr(store, "dlp_summary", None)
        if not callable(getter):
            return {
                "hosts_total": 0,
                "hosts_active_today": 0,
                "visits_today": 0,
                "file_events_today": 0,
                "categories_today": {},
                "category_meta": CATEGORY_META,
            }
        summary = getter() or {}
        summary["category_meta"] = CATEGORY_META
        return summary

    return _dlp_serve("summary", compute)


def ingest_telegram_payload(payload: Dict[str, Any]) -> Dict[str, Any]:
    store = get_egress_store()
    computer_name = str(payload.get("computer_name") or "").strip() or "unknown"
    windows_user = str(payload.get("windows_user") or "").strip()
    chats = payload.get("chats") if isinstance(payload.get("chats"), list) else []
    chat_count = store.upsert_telegram_chats(
        computer_name=computer_name,
        windows_user=windows_user,
        chats=chats,
    )
    probe_root = PROJECT_ROOT / "telegram_uia_probe"
    if str(probe_root) not in sys.path:
        sys.path.insert(0, str(probe_root))
    egress_events: List[Dict[str, Any]] = []
    try:
        from telegram_probe.sync import extract_outgoing_file_left

        for chat in chats:
            egress_events.extend(
                extract_outgoing_file_left(
                    chat.get("messages") or [],
                    chat_name=str(chat.get("chat_name") or ""),
                    windows_user=windows_user,
                    computer_name=computer_name,
                    chat_id=str(chat.get("chat_id") or ""),
                )
            )
    except Exception:
        egress_events = []
    if egress_events:
        store.ingest_file_left(egress_events)
    report_html = payload.get("report_html")
    if isinstance(report_html, str) and report_html.strip():
        store.save_report(computer_name=computer_name, windows_user=windows_user, html=report_html)
    media_items: List[Dict[str, Any]] = []
    budget = _MediaBudget(_media_cap_bytes())
    for item in payload.get("media") or []:
        if not isinstance(item, dict):
            continue
        b64 = item.get("content_base64")
        if not b64:
            continue
        try:
            raw = base64.b64decode(b64)
        except Exception:
            continue
        if not budget.take(len(raw)):
            continue
        media_items.append(
            {
                "computer_name": computer_name,
                "file_name": str(item.get("name") or f"media_{len(media_items)}"),
                "content": raw,
                "content_type": str(item.get("content_type") or "application/octet-stream"),
            }
        )
    budget.report("telegram")
    media_count = _save_media_items(
        store, batch_attr="save_media_batch", single_attrs=["save_media"], items=media_items
    )
    return {
        "chats": chat_count,
        # media = items the agent may consider handled (saved + budget-dropped):
        # probes ack `media == sent`; counting drops keeps retries from looping forever.
        "media": media_count + budget.dropped,
        "media_saved": media_count,
        "media_dropped": budget.dropped,
        "egress": len(egress_events),
        "computer_name": computer_name,
        "backend": "postgresql" if _using_postgres() else "sqlite",
    }


def _using_postgres() -> bool:
    try:
        from backend.appdb.db import is_app_database_configured
        from backend.appdb.file_egress_store import AppFileEgressStore

        return is_app_database_configured() and isinstance(get_egress_store(), AppFileEgressStore)
    except Exception:
        return False


def list_telegram_chats(*, computer_name: str = "", limit: int = 100) -> List[Dict[str, Any]]:
    return get_egress_store().list_telegram_chats(computer_name=computer_name, limit=limit)


def get_telegram_report(computer_name: str) -> Optional[Dict[str, Any]]:
    return get_egress_store().get_report(computer_name)


def get_telegram_media(*, computer_name: str, file_name: str) -> Optional[Dict[str, Any]]:
    store = get_egress_store()
    getter = getattr(store, "get_media", None)
    if not callable(getter):
        return None
    return getter(computer_name=computer_name, file_name=file_name)


def _reclassify_browser_items(
    visits: List[Dict[str, Any]],
    focus_events: List[Dict[str, Any]],
) -> tuple[List[Dict[str, Any]], List[Dict[str, Any]]]:
    """Enrich category/domain; drop NTP / empty-tab noise."""
    try:
        from browser_probe.classify import classify_title, classify_visit, is_noise_visit
    except Exception:
        return visits, focus_events

    out_visits: List[Dict[str, Any]] = []
    for visit in visits:
        if not isinstance(visit, dict):
            continue
        row = dict(visit)
        url = str(row.get("url") or "")
        title = str(row.get("title") or "")
        if is_noise_visit(url, title):
            continue
        domain, category = classify_visit(url, title)
        if domain:
            row["domain"] = domain
        # Prefer non-other classification (server-side heuristics win over stale agent other).
        prev = str(row.get("category") or "other")
        if category != "other" or prev == "other":
            row["category"] = category
        out_visits.append(row)

    out_focus: List[Dict[str, Any]] = []
    for event in focus_events:
        if not isinstance(event, dict):
            continue
        row = dict(event)
        title = str(row.get("title") or "")
        if is_noise_visit(str(row.get("url") or ""), title):
            continue
        cat = classify_title(title)
        prev = str(row.get("category") or "other")
        if cat != "other" or prev == "other":
            row["category"] = cat
        out_focus.append(row)
    return out_visits, out_focus


def ingest_browser_payload(payload: Dict[str, Any]) -> Dict[str, Any]:
    store = get_egress_store()
    computer_name = str(payload.get("computer_name") or "").strip() or "unknown"
    windows_user = str(payload.get("windows_user") or "").strip()
    visits = payload.get("visits") if isinstance(payload.get("visits"), list) else []
    focus_events = (
        payload.get("focus_events") if isinstance(payload.get("focus_events"), list) else []
    )
    visits, focus_events = _reclassify_browser_items(visits, focus_events)
    ingest_fn = getattr(store, "ingest_browser_visits", None)
    visit_count = 0
    if callable(ingest_fn):
        visit_count = int(
            ingest_fn(
                computer_name=computer_name,
                windows_user=windows_user,
                visits=visits,
                focus_events=focus_events,
            )
            or 0
        )
    activity_items = payload.get("activity") if isinstance(payload.get("activity"), list) else []
    activity_count = 0
    if activity_items:
        ingest_activity = getattr(store, "ingest_activity_buckets", None)
        if callable(ingest_activity):
            activity_count = int(
                ingest_activity(
                    computer_name=computer_name,
                    windows_user=windows_user,
                    buckets=activity_items,
                )
                or 0
            )
    media_items = []
    budget = _MediaBudget(_media_cap_bytes())
    for item in payload.get("media") or []:
        if not isinstance(item, dict):
            continue
        b64 = item.get("content_base64")
        if not b64:
            continue
        try:
            raw = base64.b64decode(b64)
        except Exception:
            continue
        if not budget.take(len(raw)):
            continue
        media_items.append(
            {
                "computer_name": computer_name,
                "file_name": str(item.get("name") or f"browser_{len(media_items)}"),
                "content": raw,
                "content_type": str(item.get("content_type") or "image/png"),
            }
        )
    budget.report("browser")
    media_count = _save_media_items(
        store,
        batch_attr="save_browser_media_batch",
        single_attrs=["save_browser_media", "save_media"],
        items=media_items,
    )
    return {
        "visits": visit_count,
        "activity": activity_count,
        "media": media_count + budget.dropped,
        "media_saved": media_count,
        "media_dropped": budget.dropped,
        "computer_name": computer_name,
        "backend": "postgresql" if _using_postgres() else "sqlite",
    }


def list_browser_visits(
    *,
    computer_name: str = "",
    category: str = "",
    day: str = "",
    source: str = "",
    q: str = "",
    limit: int = 100,
    offset: int = 0,
    merge: bool = False,
) -> List[Dict[str, Any]]:
    store = get_egress_store()
    lister = getattr(store, "list_browser_visits", None)
    if not callable(lister):
        return []
    try:
        return lister(
            computer_name=computer_name,
            category=category,
            day=day,
            source=source,
            q=q,
            limit=limit,
            offset=offset,
            merge=merge,
        )
    except TypeError:
        return lister(
            computer_name=computer_name,
            category=category,
            limit=limit,
            offset=offset,
        )


def count_browser_visits(
    *,
    computer_name: str = "",
    category: str = "",
    day: str = "",
    source: str = "",
    q: str = "",
) -> int:
    store = get_egress_store()
    counter = getattr(store, "count_browser_visits", None)
    if not callable(counter):
        return 0
    return int(
        counter(
            computer_name=computer_name,
            category=category,
            day=day,
            source=source,
            q=q,
        )
        or 0
    )


def list_browser_hosts() -> List[Dict[str, Any]]:
    def compute() -> List[Dict[str, Any]]:
        store = get_egress_store()
        lister = getattr(store, "list_browser_hosts", None)
        if not callable(lister):
            return []
        return lister()

    return _dlp_serve("browser_hosts", compute)


def list_browser_days(*, computer_name: str, source: str = "") -> List[Dict[str, Any]]:
    store = get_egress_store()
    lister = getattr(store, "list_browser_days", None)
    if not callable(lister):
        return []
    return lister(computer_name=computer_name, source=source)


def get_browser_media(*, computer_name: str, file_name: str) -> Optional[Dict[str, Any]]:
    store = get_egress_store()
    getter = getattr(store, "get_browser_media", None)
    if not callable(getter):
        # Fallback: reuse telegram media table only if names collide — prefer dedicated.
        getter = getattr(store, "get_media", None)
    if not callable(getter):
        return None
    return getter(computer_name=computer_name, file_name=file_name)


def ingest_max_payload(payload: Dict[str, Any]) -> Dict[str, Any]:
    store = get_egress_store()
    computer_name = str(payload.get("computer_name") or "").strip() or "unknown"
    windows_user = str(payload.get("windows_user") or "").strip()
    chats = payload.get("chats") if isinstance(payload.get("chats"), list) else []
    upsert = getattr(store, "upsert_max_chats", None)
    chat_count = 0
    if callable(upsert):
        chat_count = int(
            upsert(computer_name=computer_name, windows_user=windows_user, chats=chats) or 0
        )
    # Outgoing MAX files → file_left (shared extractor: stable event_id,
    # real names from «Файл: name» labels, send_state evidence fields).
    probe_root = PROJECT_ROOT / "telegram_uia_probe"
    if str(probe_root) not in sys.path:
        sys.path.insert(0, str(probe_root))
    egress_events: List[Dict[str, Any]] = []
    try:
        from telegram_probe.sync import extract_outgoing_file_left

        for chat in chats:
            if not isinstance(chat, dict):
                continue
            egress_events.extend(
                extract_outgoing_file_left(
                    chat.get("messages") or [],
                    chat_name=str(chat.get("chat_name") or ""),
                    windows_user=windows_user,
                    computer_name=computer_name,
                    channel="max",
                    chat_id=str(chat.get("chat_id") or ""),
                )
            )
    except Exception:
        egress_events = []
    if egress_events:
        store.ingest_file_left(egress_events)
    media_items = []
    budget = _MediaBudget(_media_cap_bytes())
    for item in payload.get("media") or []:
        if not isinstance(item, dict):
            continue
        b64 = item.get("content_base64")
        if not b64:
            continue
        try:
            raw = base64.b64decode(b64)
        except Exception:
            continue
        if not budget.take(len(raw)):
            continue
        name = str(item.get("name") or f"max_{len(media_items)}.png")
        if "/" in name.replace("\\", "/"):
            name = name.replace("\\", "/").split("/")[-1]
        media_items.append(
            {
                "computer_name": computer_name,
                "file_name": name,
                "content": raw,
                "content_type": str(item.get("content_type") or "image/png"),
            }
        )
    budget.report("max")
    media_count = _save_media_items(
        store, batch_attr="save_max_media_batch", single_attrs=["save_max_media"], items=media_items
    )
    return {
        "chats": chat_count,
        "media": media_count + budget.dropped,
        "media_saved": media_count,
        "media_dropped": budget.dropped,
        "egress": len(egress_events),
        "computer_name": computer_name,
        "backend": "postgresql" if _using_postgres() else "sqlite",
    }


def list_max_chats(*, computer_name: str = "", limit: int = 100) -> List[Dict[str, Any]]:
    store = get_egress_store()
    lister = getattr(store, "list_max_chats", None)
    if not callable(lister):
        return []
    return lister(computer_name=computer_name, limit=limit)


def get_max_media(*, computer_name: str, file_name: str) -> Optional[Dict[str, Any]]:
    store = get_egress_store()
    getter = getattr(store, "get_max_media", None)
    if not callable(getter):
        return None
    return getter(computer_name=computer_name, file_name=file_name)
