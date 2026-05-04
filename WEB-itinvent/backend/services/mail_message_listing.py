from __future__ import annotations

from dataclasses import dataclass
from datetime import date
from typing import Any, Callable


def _normalize_text(value: Any, default: str = "") -> str:
    if value is None:
        return default
    try:
        text = str(value).strip()
    except Exception:
        return default
    return text or default


def message_matches_filters(
    item: Any,
    *,
    item_sender: Callable[[Any], str],
    item_recipients: Callable[[Any], list[str]],
    item_importance: Callable[[Any], str],
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
    if has_attachments and not bool(getattr(item, "attachments", None) or []):
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

    if from_filter and from_filter not in item_sender(item).lower():
        return False

    if to_filter and to_filter not in " ".join(item_recipients(item)).lower():
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
        sender = item_sender(item).lower()
        body_preview = _normalize_text(getattr(item, "text_body", "")).lower()
        if query_text not in subject and query_text not in sender and query_text not in body_preview:
            return False

    return True


@dataclass(frozen=True)
class MessageListResult:
    payload: dict[str, Any]
    searched_window: int
    search_limited: bool


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
    ) -> None:
        self.search_target_folders = search_target_folders
        self.folder_queryset = folder_queryset
        self.folder_total_hint = folder_total_hint
        self.serialize_message_preview = serialize_message_preview
        self.message_matches_filters = message_matches_filters
        self.parse_date_filter = parse_date_filter
        self.search_batch_size = max(1, int(search_batch_size))
        self.search_window_limit = search_window_limit

    def list_messages(
        self,
        *,
        account: Any,
        mailbox_id: str | None = None,
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
                )
                for item in page_items
            ]
            total = max(
                total_hint if total_hint is not None else 0,
                safe_offset + len(items) + (1 if has_more else 0),
            )
        else:
            serialized_items: list[dict[str, Any]] = []
            search_budget = max(1, int(self.search_window_limit()))
            for folder_obj, folder_key in targets:
                queryset = self.folder_queryset(folder_obj, folder_key)
                if unread_only:
                    queryset = queryset.filter(is_read=False)
                scanned = 0
                while True:
                    if searched_window >= search_budget:
                        search_limited = True
                        break
                    batch_limit = min(self.search_batch_size, search_budget - searched_window)
                    batch_items = list(queryset[scanned: scanned + batch_limit])
                    if not batch_items:
                        break
                    for item in batch_items:
                        if not self.message_matches_filters(
                            item,
                            query_text=query_text,
                            has_attachments=bool(has_attachments),
                            date_from=parsed_date_from,
                            date_to=parsed_date_to,
                            from_filter=normalized_from,
                            to_filter=normalized_to,
                            subject_filter=normalized_subject,
                            body_filter=normalized_body,
                            importance_filter=normalized_importance,
                        ):
                            continue
                        serialized_items.append(
                            self.serialize_message_preview(
                                item=item,
                                folder_key=folder_key,
                                mailbox_id=mailbox_id,
                            )
                        )
                    searched_window += len(batch_items)
                    scanned += len(batch_items)
                    if len(batch_items) < batch_limit:
                        break
                if search_limited:
                    break
            serialized_items.sort(
                key=lambda item: (
                    item.get("received_at") or "",
                    item.get("id") or "",
                ),
                reverse=True,
            )
            total = len(serialized_items)
            items = serialized_items[safe_offset: safe_offset + safe_limit]
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
            },
            searched_window=searched_window,
            search_limited=bool(search_limited),
        )
