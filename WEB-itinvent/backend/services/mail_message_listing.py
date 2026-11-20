from __future__ import annotations

import itertools
import logging
import queue
import threading
from collections import deque
from dataclasses import dataclass
from datetime import date, datetime, time, timedelta, timezone
from threading import Lock
from time import monotonic
from typing import Any, Callable

logger = logging.getLogger(__name__)

# A query with many hits makes even the server-side pass scan up to `budget`
# matching items — an item budget alone stretches the request past the
# client's 30s timeout, so the whole scan (server pass + unfiltered
# supplement sweep) shares one wall-clock budget. The unrestricted tail that
# only covers Cc/display_to gaps gets a smaller slice of it.
_SEARCH_SCAN_SECONDS = 15.0
_SUPPLEMENT_SCAN_SECONDS = 6.0
# Parallel FindItem batch workers for all-folders scans. Bounded: EWS
# throttling and the shared protocol session dislike heavy fan-out.
_MULTI_FOLDER_WORKERS = 4


def _normalize_text(value: Any, default: str = "") -> str:
    if value is None:
        return default
    try:
        text = str(value).strip()
    except Exception:
        return default
    return text or default


def received_at_epoch(value: Any) -> float:
    """Epoch seconds for a serialized ISO ``received_at`` value.

    Lexicographic comparison of tz-aware ISO strings misorders across
    timezone offsets ("10:00+03:00" > "08:00+00:00" string-wise, yet it is
    the older instant in UTC). Naive values are treated as UTC — the
    backend serializes UTC by convention. Unparsable values sort oldest.
    """
    text = _normalize_text(value)
    if not text:
        return float("-inf")
    try:
        parsed = datetime.fromisoformat(text.replace("Z", "+00:00"))
    except (TypeError, ValueError):
        return float("-inf")
    if parsed.tzinfo is None:
        parsed = parsed.replace(tzinfo=timezone.utc)
    try:
        return parsed.timestamp()
    except (OverflowError, OSError, ValueError):
        return float("-inf")


def message_matches_filters(
    item: Any,
    *,
    item_sender: Callable[[Any], str],
    item_recipients: Callable[[Any], list[str]],
    item_importance: Callable[[Any], str],
    item_sender_display: Callable[[Any], str] | None = None,
    item_recipient_displays: Callable[[Any], list[str]] | None = None,
    query_text: str = "",
    has_attachments: bool = False,
    date_from: date | None = None,
    date_to: date | None = None,
    from_filter: str = "",
    to_filter: str = "",
    subject_filter: str = "",
    body_filter: str = "",
    importance_filter: str = "",
) -> bool:
    if has_attachments:
        has_attachment_flag = getattr(item, "has_attachments", None)
        if has_attachment_flag is None:
            has_attachment_flag = bool(getattr(item, "attachments", None) or [])
        if not bool(has_attachment_flag):
            return False

    received = getattr(item, "datetime_received", None) or getattr(item, "datetime_created", None)
    if received is not None:
        try:
            received_date = received.date()
        except Exception:
            received_date = None
    else:
        received_date = None

    if date_from and (received_date is None or received_date < date_from):
        return False
    if date_to and (received_date is None or received_date > date_to):
        return False

    sender_haystack = item_sender(item).lower()
    if item_sender_display is not None:
        display = _normalize_text(item_sender_display(item)).lower()
        if display:
            sender_haystack = f"{sender_haystack} {display}".strip()
    recipients_haystack = " ".join(item_recipients(item)).lower()
    if item_recipient_displays is not None:
        displays = " ".join(
            value for value in (_normalize_text(raw).lower() for raw in item_recipient_displays(item)) if value
        )
        if displays:
            recipients_haystack = f"{recipients_haystack} {displays}".strip()

    if from_filter and from_filter not in sender_haystack:
        return False

    if to_filter and to_filter not in recipients_haystack:
        return False

    if subject_filter:
        subject = _normalize_text(getattr(item, "subject", "")).lower()
        if subject_filter not in subject:
            return False

    if body_filter:
        body_preview = _normalize_text(getattr(item, "text_body", None))
        if not body_preview:
            body_preview = _normalize_text(getattr(item, "body", None))
        if body_filter not in body_preview.lower():
            return False

    if importance_filter and item_importance(item) != importance_filter:
        return False

    if query_text:
        subject = _normalize_text(getattr(item, "subject", "")).lower()
        body_preview = _normalize_text(getattr(item, "text_body", "")).lower()
        if (
            query_text not in subject
            and query_text not in sender_haystack
            and query_text not in recipients_haystack
            and query_text not in body_preview
        ):
            return False

    return True


def _combine_or(filters: list[Any]) -> Any:
    if not filters:
        return None
    current = filters[0]
    for item in filters[1:]:
        current = current | item
    return current


def _combine_and(filters: list[Any]) -> Any:
    if not filters:
        return None
    current = filters[0]
    for item in filters[1:]:
        current = current & item
    return current


def build_server_side_restriction(
    *,
    query_text: str = "",
    has_attachments: bool = False,
    date_from: date | None = None,
    date_to: date | None = None,
    subject_filter: str = "",
    body_filter: str = "",
    importance_filter: str = "",
) -> Any:
    """Build an EWS FindItem restriction from fields the server actually accepts.

    Field set verified against the on-prem Exchange (exchangelib 5.6.0):
    ``subject``/``body``/``sender``/``author``/``display_to``/``display_cc``
    ``icontains`` work; ``text_body`` and ``sender``/``author`` subfield
    paths are rejected (ErrorUnsupportedPathForQuery / InvalidField) and
    poison the whole OR.
    """
    try:
        from exchangelib import Q
    except Exception:
        return None

    restrictions: list[Any] = []
    if query_text:
        combined_query = _combine_or(
            [
                Q(subject__icontains=query_text),
                Q(body__icontains=query_text),
                Q(sender__icontains=query_text),
                Q(author__icontains=query_text),
                Q(display_to__icontains=query_text),
                Q(display_cc__icontains=query_text),
            ]
        )
        if combined_query is not None:
            restrictions.append(combined_query)
    if has_attachments:
        restrictions.append(Q(has_attachments=True))
    if subject_filter:
        restrictions.append(Q(subject__icontains=subject_filter))
    if body_filter:
        restrictions.append(Q(body__icontains=body_filter))
    if importance_filter:
        restrictions.append(Q(importance=importance_filter.capitalize()))
    dates = {}
    if date_from:
        dates["gte"] = datetime.combine(date_from, time.min, tzinfo=timezone.utc)
    if date_to and date_to < date.max:
        dates["lt"] = datetime.combine(date_to + timedelta(days=1), time.min, tzinfo=timezone.utc)
    if dates:
        received = Q(**{f"datetime_received__{op}": value for op, value in dates.items()})
        created = Q(**{f"datetime_created__{op}": value for op, value in dates.items()})
        restrictions.append(received | (~Q(datetime_received__exists=True) & created))
    return _combine_and(restrictions)


@dataclass(frozen=True)
class SearchScanResult:
    matches: list[tuple[Any, str]]
    searched_window: int
    search_limited: bool
    skipped_folders: int


def scan_search_folders(
    *,
    targets: list[tuple[Any, str]],
    folder_queryset: Callable[[Any, str], Any],
    message_matches_filters: Callable[..., bool],
    filters: dict[str, Any],
    batch_size: int,
    budget: int,
    all_scope: bool,
    time_budget_seconds: float = 0.0,
    multi_folder_queryset: Callable[[list[Any], Any], Any] | None = None,
    multi_folder_batch: int = 25,
    page_window: int = 0,
) -> SearchScanResult:
    query = filters.get("query_text") or ""
    subject = filters.get("subject_filter") or ""
    criteria = {
        key: filters[key] for key in ("has_attachments", "subject_filter", "body_filter", "importance_filter", "date_from", "date_to")
        if key in filters
    }
    common = build_server_side_restriction(**criteria)
    # DisplayTo is not a superset of the recipient SMTP addresses (especially Cc).
    quick = build_server_side_restriction(query_text=query, **criteria) if query and query not in subject else None
    matches: dict[tuple[str, Any], tuple[Any, str]] = {}
    readable: set[str] = set()
    skipped = {key: target for target, key in targets if isinstance(target, Exception)}
    key_by_folder_id = {
        _normalize_text(getattr(folder, "id", None)): key
        for folder, key in targets
        if not isinstance(folder, Exception) and _normalize_text(getattr(folder, "id", None))
    }

    needed = max(0, int(page_window or 0))

    def _received_dt(item: Any) -> datetime | None:
        return getattr(item, "datetime_received", None) or getattr(item, "datetime_created", None)

    def scan(
        restriction: Any,
        *,
        supplement_follows: bool,
        deadline: float | None,
        subset: list[tuple[Any, str]] | None = None,
    ) -> tuple[int, bool]:
        scan_targets = subset if subset is not None else targets
        pending = deque(
            (folder, key, None, restriction, 0, None)
            for folder, key in scan_targets if not isinstance(folder, Exception)
        )
        scanned = 0
        capped = False
        while pending and scanned < budget and (deadline is None or monotonic() < deadline):
            folder, key, item_iter, active, accepted, boundary = pending.popleft()
            # Give the remaining folders a first page before a large inbox can consume the budget.
            limit = min(batch_size, max(1, (budget - scanned) // (1 + len(pending))))
            try:
                if item_iter is None:
                    queryset = folder_queryset(folder, key)
                    if active is not None:
                        queryset = queryset.filter(active)
                    # ``qs[a:b]`` yields whole server pages and, on an already
                    # consumed queryset, may return nothing — iterate instead.
                    item_iter = iter(queryset)
                page = list(itertools.islice(item_iter, limit))
            except Exception as exc:
                if active is not None:
                    logger.warning("mail.search server-side filter failed error_type=%s", type(exc).__name__)
                    if not supplement_follows:
                        pending.append((folder, key, None, None, 0, None))
                elif not all_scope:
                    raise
                else:
                    skipped[key] = exc
                    logger.warning("mail.search folder scan failed error_type=%s", type(exc).__name__)
                continue

            scanned += len(page)
            if not page:
                readable.add(key)
            for item in page:
                if isinstance(item, Exception):
                    if not supplement_follows:
                        skipped[key] = item
                    continue
                readable.add(key)
                identity = (key, getattr(item, "id", None) or id(item))
                if identity not in matches and message_matches_filters(item, **filters):
                    matches[identity] = (item, key)
                    accepted += 1
                    if accepted == needed:
                        boundary = _received_dt(item)
            if len(page) == limit:
                # Items stream newest-first. Once a folder yielded the page's
                # worth of matches AND the fetched tail is strictly older than
                # the boundary match, unfetched items cannot displace it —
                # stop this folder. Equal timestamps keep it reading on.
                tail = _received_dt(page[-1]) if page else None
                if (
                    needed
                    and accepted >= needed
                    and boundary is not None
                    and tail is not None
                    and tail < boundary
                ):
                    capped = True
                else:
                    pending.append((folder, key, item_iter, active, accepted, boundary))
        return scanned, bool(pending) or capped

    def _match_scanned(item: Any, key: str) -> bool:
        identity = (key, getattr(item, "id", None) or id(item))
        if identity not in matches and message_matches_filters(item, **filters):
            matches[identity] = (item, key)
            return True
        return False

    def scan_batches(restriction: Any, *, deadline: float | None) -> tuple[int, list[tuple[Any, str]], bool]:
        """One FindItem per batch of folders instead of one per folder.

        Pages are independent offset slices pulled from a small worker pool —
        a fresh queryset per slice avoids the consumed-queryset pitfalls and
        lets a single batch fan out its reads. Batches that reject the
        restriction or a page fall back to the per-folder pass.
        """
        batch_size_folders = max(1, int(multi_folder_batch))
        mail_targets = [(f, k) for f, k in targets if not isinstance(f, Exception)]
        batches = [
            mail_targets[start:start + batch_size_folders]
            for start in range(0, len(mail_targets), batch_size_folders)
        ]
        if not batches:
            return 0, [], False
        state = {"scanned": 0, "limited": False}
        lock = Lock()
        exhausted = [False] * len(batches)
        failed_indexes: set[int] = set()
        failed: list[tuple[Any, str]] = []
        iterators: dict[int, Any] = {}
        work: queue.Queue[int] = queue.Queue()
        for batch_index in range(len(batches)):
            work.put(batch_index)

        def _stop_all(reason_limited: bool) -> None:
            with lock:
                exhausted[:] = [True] * len(batches)
                if reason_limited:
                    state["limited"] = True

        def _worker() -> None:
            while True:
                try:
                    batch_index = work.get(timeout=0.05)
                except queue.Empty:
                    if all(exhausted):
                        return
                    if deadline is not None and monotonic() >= deadline:
                        _stop_all(True)
                        return
                    continue
                batch = batches[batch_index]
                batch_keys = {k for _, k in batch}
                with lock:
                    if exhausted[batch_index]:
                        continue
                    remaining = budget - state["scanned"]
                if remaining <= 0:
                    _stop_all(True)
                    continue
                if deadline is not None and monotonic() >= deadline:
                    _stop_all(True)
                    continue
                limit = min(batch_size, max(1, remaining))
                try:
                    if batch_index not in iterators:
                        # ``qs[a:b]`` on a FolderCollection cannot seek — offset
                        # slices silently return an empty tail — so pages must
                        # stream through one iterator per batch. Tasks of a
                        # batch chain never overlap: the next page task is
                        # enqueued only after the current one finished.
                        queryset = multi_folder_queryset([f for f, _ in batch], restriction)
                        iterators[batch_index] = iter(queryset)
                    page = list(itertools.islice(iterators[batch_index], limit))
                except Exception as exc:
                    logger.warning("mail.search multi-folder page failed error_type=%s", type(exc).__name__)
                    with lock:
                        if batch_index not in failed_indexes:
                            failed_indexes.add(batch_index)
                            failed.extend(batch)
                        exhausted[batch_index] = True
                    continue
                if not page:
                    with lock:
                        exhausted[batch_index] = True
                        readable.update(batch_keys)
                    continue
                with lock:
                    state["scanned"] += len(page)
                resolved = 0
                for item in page:
                    if isinstance(item, Exception):
                        continue
                    parent_id = getattr(getattr(item, "parent_folder_id", None), "id", None)
                    key = key_by_folder_id.get(_normalize_text(parent_id))
                    if key is None:
                        key = next(iter(batch_keys)) if len(batch_keys) == 1 else None
                    if key is None:
                        continue
                    resolved += 1
                    with lock:
                        readable.add(key)
                        _match_scanned(item, key)
                if resolved == 0 and any(not isinstance(item, Exception) for item in page):
                    # parent_folder_id could not be mapped back — re-scan the
                    # batch per folder rather than silently dropping matches.
                    with lock:
                        if batch_index not in failed_indexes:
                            failed_indexes.add(batch_index)
                            failed.extend(batch)
                        exhausted[batch_index] = True
                    continue
                if len(page) < limit:
                    with lock:
                        exhausted[batch_index] = True
                        readable.update(batch_keys)
                else:
                    work.put(batch_index)

        workers = _MULTI_FOLDER_WORKERS
        threads = [
            threading.Thread(target=_worker, name=f"mail-scan-{index}", daemon=True)
            for index in range(workers)
        ]
        for thread in threads:
            thread.start()
        for thread in threads:
            thread.join(timeout=(max(0.0, deadline - monotonic()) + 5.0) if deadline is not None else None)
        if any(thread.is_alive() for thread in threads):
            _stop_all(True)
        return state["scanned"], failed, state["limited"]

    def scan_parallel(
        restriction: Any,
        *,
        supplement_follows: bool,
        deadline: float | None,
        subset: list[tuple[Any, str]] | None = None,
    ) -> tuple[int, list[tuple[Any, str]], bool]:
        """One FindItem stream per folder, fanned out over a worker pool.

        Each folder owns a single iterator — exchangelib queryset slices
        cannot seek (verified on the live mailbox: offset slices return
        empty or overlapping tails) — so a folder's pages stay sequential
        while different folders scan concurrently. Work items are pages,
        not folders: a folder's next-page task is requeued at the tail, so
        every pending folder reads a first page before any second page —
        the same fairness the sequential pass gets from its deque. Per-
        folder streams are server-sorted, so the page-window cap still
        applies per folder. Dropped folders are returned for fallback.
        """
        scan_targets = subset if subset is not None else targets
        folders = [(f, k) for f, k in scan_targets if not isinstance(f, Exception)]
        if not folders:
            return 0, [], False
        state = {"scanned": 0, "limited": False, "folders_left": len(folders)}
        lock = Lock()
        failed: list[tuple[Any, str]] = []
        errors: list[BaseException] = []
        iterators: dict[int, Any] = {}
        folder_state = [
            {"active": restriction, "accepted": 0, "boundary": None, "pages": 0}
            for _ in folders
        ]
        work: queue.Queue[int] = queue.Queue()
        for index in range(len(folders)):
            work.put(index)

        def _finish() -> None:
            with lock:
                state["folders_left"] -= 1

        def _scan_page(index: int) -> None:
            folder, key = folders[index]
            own = folder_state[index]
            with lock:
                remaining = budget - state["scanned"]
                folders_left = state["folders_left"]
            if remaining <= 0 or (deadline is not None and monotonic() >= deadline):
                with lock:
                    state["limited"] = True
                _finish()
                return
            if own["pages"] == 0:
                # The first page of every folder gets a fair share so each
                # folder is touched before the budget can be consumed.
                limit = min(batch_size, max(1, remaining // max(1, folders_left)))
            else:
                limit = min(batch_size, max(1, remaining))
            try:
                if index not in iterators:
                    queryset = folder_queryset(folder, key)
                    if own["active"] is not None:
                        queryset = queryset.filter(own["active"])
                    iterators[index] = iter(queryset)
                page = list(itertools.islice(iterators[index], limit))
            except Exception as exc:
                if own["active"] is not None:
                    logger.warning("mail.search server-side filter failed error_type=%s", type(exc).__name__)
                    if not supplement_follows:
                        # Retry the folder unfiltered — its state resets, and
                        # the requeued task lands behind the other folders.
                        own.update({"active": None, "accepted": 0, "boundary": None, "pages": 0})
                        iterators.pop(index, None)
                        work.put(index)
                        return
                    with lock:
                        failed.append((folder, key))
                    _finish()
                    return
                elif not all_scope:
                    raise
                else:
                    with lock:
                        skipped[key] = exc
                    logger.warning("mail.search folder scan failed error_type=%s", type(exc).__name__)
                    _finish()
                    return
            with lock:
                state["scanned"] += len(page)
            own["pages"] += 1
            for item in page:
                if isinstance(item, Exception):
                    if not supplement_follows:
                        with lock:
                            skipped[key] = item
                    continue
                with lock:
                    readable.add(key)
                    matched = _match_scanned(item, key)
                if matched:
                    own["accepted"] += 1
                    if own["accepted"] == needed:
                        own["boundary"] = _received_dt(item)
            if len(page) < limit:
                _finish()
                return
            tail = _received_dt(page[-1])
            if (
                needed
                and own["accepted"] >= needed
                and own["boundary"] is not None
                and tail is not None
                and tail < own["boundary"]
            ):
                with lock:
                    state["limited"] = True
                _finish()
                return
            work.put(index)

        def _worker() -> None:
            while True:
                try:
                    index = work.get(timeout=0.05)
                except queue.Empty:
                    if state["folders_left"] <= 0:
                        return
                    if deadline is not None and monotonic() >= deadline:
                        with lock:
                            state["limited"] = True
                        return
                    continue
                try:
                    _scan_page(index)
                except BaseException as exc:
                    with lock:
                        errors.append(exc)
                    return

        workers = min(_MULTI_FOLDER_WORKERS, len(folders))
        threads = [
            threading.Thread(target=_worker, name=f"mail-scan-{index}", daemon=True)
            for index in range(workers)
        ]
        for thread in threads:
            thread.start()
        for thread in threads:
            thread.join(timeout=(max(0.0, deadline - monotonic()) + 5.0) if deadline is not None else None)
        if any(thread.is_alive() for thread in threads):
            with lock:
                state["limited"] = True
        if errors:
            raise errors[0]
        return state["scanned"], failed, state["limited"]

    deadline = monotonic() + time_budget_seconds if time_budget_seconds > 0 else None
    # The restricted pass already covers every matchable field except To/Cc
    # *addresses* (names are indexed via display_to/display_cc). Only a plain
    # ASCII query can be an address token, so an unfiltered supplement sweep
    # runs solely for those — Cyrillic lookups skip it entirely.
    supplement_needed = quick is None or (bool(query) and query.isascii())
    mail_target_count = sum(1 for f, _ in targets if not isinstance(f, Exception))
    # Batched FolderCollection FindItems pay off only above the batch size —
    # below it, per-folder parallel streams are both faster and sorted.
    use_batch = (
        multi_folder_queryset is not None
        and mail_target_count > max(1, int(multi_folder_batch))
    )
    fast_scanned = 0
    limited = False
    if quick is not None and use_batch:
        fast_scanned, fast_failed, limited = scan_batches(quick, deadline=deadline)
    elif quick is not None and mail_target_count > 1:
        fast_scanned, fast_failed, limited = scan_parallel(
            quick, supplement_follows=supplement_needed, deadline=deadline
        )
    elif quick is not None:
        fast_scanned, limited = scan(quick, supplement_follows=supplement_needed, deadline=deadline)
        fast_failed = []
    else:
        fast_failed = []
    if fast_failed:
        extra, more_limited = scan(quick, supplement_follows=supplement_needed, deadline=deadline, subset=fast_failed)
        fast_scanned += extra
        limited = limited or more_limited
    scanned = 0
    if supplement_needed:
        # An unrestricted sweep only fills Cc/display_to gaps: cap its slice so
        # it cannot stall the response on a large mailbox.
        common_deadline = deadline
        if common is None and deadline is not None and _SUPPLEMENT_SCAN_SECONDS > 0:
            common_deadline = min(deadline, monotonic() + _SUPPLEMENT_SCAN_SECONDS)
        if use_batch:
            scanned, common_failed, more_limited = scan_batches(common, deadline=common_deadline)
        elif mail_target_count > 1:
            scanned, common_failed, more_limited = scan_parallel(
                common, supplement_follows=False, deadline=common_deadline
            )
        else:
            scanned, more_limited = scan(common, supplement_follows=False, deadline=common_deadline)
            common_failed = []
        limited = limited or more_limited
        if common_failed:
            extra, more_limited = scan(common, supplement_follows=False, deadline=common_deadline, subset=common_failed)
            scanned += extra
            limited = limited or more_limited
    if skipped and not readable:
        raise next(iter(skipped.values()))
    return SearchScanResult(list(matches.values()), fast_scanned + scanned, limited, len(skipped))


@dataclass(frozen=True)
class MessageListResult:
    payload: dict[str, Any]
    searched_window: int
    search_limited: bool
    skipped_folders: int = 0


class MailMessageListBuilder:
    def __init__(
        self,
        *,
        search_target_folders: Callable[..., list[tuple[Any, str]]],
        folder_queryset: Callable[..., Any],
        folder_total_hint: Callable[..., int | None],
        serialize_message_preview: Callable[..., dict[str, Any]],
        message_matches_filters: Callable[..., bool],
        parse_date_filter: Callable[[Any], date | None],
        search_batch_size: int,
        search_window_limit: Callable[[], int],
        multi_folder_queryset: Callable[..., Any] | None = None,
        multi_folder_batch: int = 25,
    ) -> None:
        self.search_target_folders = search_target_folders
        self.folder_queryset = folder_queryset
        self.folder_total_hint = folder_total_hint
        self.serialize_message_preview = serialize_message_preview
        self.message_matches_filters = message_matches_filters
        self.parse_date_filter = parse_date_filter
        self.search_batch_size = max(1, int(search_batch_size))
        self.search_window_limit = search_window_limit
        self.multi_folder_queryset = multi_folder_queryset
        self.multi_folder_batch = max(1, int(multi_folder_batch))

    def list_messages(
        self,
        *,
        account: Any,
        mailbox_id: str | None = None,
        mailbox_email: str = "",
        folder: str = "inbox",
        folder_scope: str = "current",
        limit: int = 50,
        offset: int = 0,
        q: str = "",
        unread_only: bool = False,
        has_attachments: bool = False,
        date_from: str = "",
        date_to: str = "",
        from_filter: str = "",
        to_filter: str = "",
        subject_filter: str = "",
        body_filter: str = "",
        importance: str = "",
    ) -> MessageListResult:
        safe_limit = max(1, min(200, int(limit or 50)))
        safe_offset = max(0, int(offset or 0))
        normalized_folder = _normalize_text(folder, "inbox")
        normalized_scope = _normalize_text(folder_scope, "current")
        query_text = _normalize_text(q).lower()
        normalized_from = _normalize_text(from_filter).lower()
        normalized_to = _normalize_text(to_filter).lower()
        normalized_subject = _normalize_text(subject_filter).lower()
        normalized_body = _normalize_text(body_filter).lower()
        normalized_importance = _normalize_text(importance).lower()
        parsed_date_from = self.parse_date_filter(date_from)
        parsed_date_to = self.parse_date_filter(date_to)
        filters_active = bool(
            query_text
            or has_attachments
            or parsed_date_from
            or parsed_date_to
            or normalized_from
            or normalized_to
            or normalized_subject
            or normalized_body
            or normalized_importance
        )

        targets = self.search_target_folders(
            account,
            folder=normalized_folder,
            folder_scope=normalized_scope,
        )
        searched_window = 0
        search_limited = False
        skipped_folders = 0
        folder_key = normalized_folder
        if len(targets) == 1 and normalized_scope.lower() != "all" and not filters_active:
            folder_obj, folder_key = targets[0]
            queryset = self.folder_queryset(folder_obj, folder_key, preview_only=True)
            if unread_only:
                queryset = queryset.filter(is_read=False)
            total_hint = self.folder_total_hint(folder_obj, unread_only=bool(unread_only))
            page_items = list(queryset[safe_offset: safe_offset + safe_limit + 1])
            has_more = len(page_items) > safe_limit
            page_items = page_items[:safe_limit]
            items = [
                self.serialize_message_preview(
                    item=item,
                    folder_key=folder_key,
                    mailbox_id=mailbox_id,
                    mailbox_email=mailbox_email,
                )
                for item in page_items
            ]
            total = max(
                total_hint if total_hint is not None else 0,
                safe_offset + len(items) + (1 if has_more else 0),
            )
        else:
            all_scope = normalized_scope.lower() == "all"

            def search_queryset(folder_obj: Any, key: str) -> Any:
                queryset = self.folder_queryset(folder_obj, key, preview_only=not normalized_body)
                return queryset.filter(is_read=False) if unread_only else queryset

            scan = scan_search_folders(
                targets=targets,
                folder_queryset=search_queryset,
                message_matches_filters=self.message_matches_filters,
                filters={
                    "query_text": query_text,
                    "has_attachments": bool(has_attachments),
                    "date_from": parsed_date_from,
                    "date_to": parsed_date_to,
                    "from_filter": normalized_from,
                    "to_filter": normalized_to,
                    "subject_filter": normalized_subject,
                    "body_filter": normalized_body,
                    "importance_filter": normalized_importance,
                },
                batch_size=self.search_batch_size,
                budget=max(1, int(self.search_window_limit())),
                all_scope=all_scope,
                time_budget_seconds=_SEARCH_SCAN_SECONDS,
                multi_folder_queryset=(
                    (lambda folders, restriction: self.multi_folder_queryset(
                        account, folders, restriction,
                        preview_only=not normalized_body,
                        unread_only=unread_only,
                    ))
                    if self.multi_folder_queryset is not None
                    else None
                ),
                multi_folder_batch=self.multi_folder_batch,
                page_window=safe_offset + safe_limit + 1,
            )
            searched_window = scan.searched_window
            search_limited = scan.search_limited
            skipped_folders = scan.skipped_folders
            # Sort the raw matches first and serialize only the requested page —
            # on hit-heavy queries serializing every match costs seconds.
            def _match_sort_key(entry: tuple[Any, str]) -> tuple[str, str, str]:
                item, key = entry
                received = getattr(item, "datetime_received", None) or getattr(item, "datetime_created", None)
                received_iso = received.isoformat() if received else ""
                return received_iso or "", key, _normalize_text(getattr(item, "id", ""))

            match_entries = sorted(scan.matches, key=_match_sort_key, reverse=True)
            total = len(match_entries)
            items = [
                self.serialize_message_preview(
                    item=item, folder_key=key, mailbox_id=mailbox_id, mailbox_email=mailbox_email,
                )
                for item, key in match_entries[safe_offset: safe_offset + safe_limit]
            ]
            folder_key = normalized_folder

        next_offset = safe_offset + len(items)
        final_total = max(total, safe_offset + len(items))
        return MessageListResult(
            payload={
                "items": items,
                "folder": folder_key,
                "limit": safe_limit,
                "offset": safe_offset,
                "total": final_total,
                "has_more": next_offset < final_total,
                "next_offset": next_offset if next_offset < final_total else None,
                "search_limited": bool(search_limited),
                "searched_window": searched_window,
                "skipped_folders": skipped_folders,
            },
            searched_window=searched_window,
            search_limited=bool(search_limited),
            skipped_folders=skipped_folders,
        )
