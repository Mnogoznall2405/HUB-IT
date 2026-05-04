from __future__ import annotations

from datetime import datetime, timezone
from typing import Any, Callable


def _normalize_text(value: Any, default: str = "") -> str:
    if value is None:
        return default
    try:
        text = str(value).strip()
    except Exception:
        return default
    return text or default


class MailConversationFinderError(Exception):
    pass


class MailConversationFinder:
    def __init__(
        self,
        *,
        search_target_folders: Callable[..., list[tuple[Any, str]]],
        folder_queryset: Callable[[Any, str], Any],
        item_conversation_key: Callable[[Any], str],
        decode_message_id: Callable[[str], tuple[str, str]],
        resolve_folder: Callable[[Any, str], tuple[Any, str]],
        search_batch_size: int,
        search_window_limit: Callable[[], int],
    ) -> None:
        self.search_target_folders = search_target_folders
        self.folder_queryset = folder_queryset
        self.item_conversation_key = item_conversation_key
        self.decode_message_id = decode_message_id
        self.resolve_folder = resolve_folder
        self.search_batch_size = max(1, int(search_batch_size))
        self.search_window_limit = search_window_limit

    def _scan_targets(
        self,
        *,
        targets: list[tuple[Any, str]],
        conversation_key: str,
        searched_window: int = 0,
    ) -> tuple[list[tuple[Any, str]], str, int, bool]:
        items_raw: list[tuple[Any, str]] = []
        last_folder_key = ""
        search_budget = max(1, int(self.search_window_limit()))
        search_limited = False

        for folder_obj, folder_key in targets:
            last_folder_key = folder_key
            queryset = self.folder_queryset(folder_obj, folder_key)
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
                    if self.item_conversation_key(item) == conversation_key:
                        items_raw.append((item, folder_key))
                scanned += len(batch_items)
                searched_window += len(batch_items)
                if len(batch_items) < batch_limit:
                    break
            if search_limited:
                break
        return items_raw, last_folder_key, searched_window, search_limited

    def find(
        self,
        *,
        account: Any,
        conversation_id: str,
        folder: str = "inbox",
        folder_scope: str = "current",
    ) -> tuple[str, list[tuple[Any, str]], str]:
        conversation_key = _normalize_text(conversation_id)
        if not conversation_key:
            raise MailConversationFinderError("Conversation id is required")

        normalized_folder = _normalize_text(folder, "inbox")
        normalized_scope = _normalize_text(folder_scope, "current")
        targets = self.search_target_folders(
            account,
            folder=normalized_folder,
            folder_scope=normalized_scope,
        )
        items_raw, last_folder_key, searched_window, _search_limited = self._scan_targets(
            targets=targets,
            conversation_key=conversation_key,
        )
        last_folder_key = last_folder_key or normalized_folder

        if not items_raw:
            direct_item = None
            try:
                folder_key_from_message, exchange_id = self.decode_message_id(conversation_key)
                folder_obj, last_folder_key = self.resolve_folder(account, folder_key_from_message)
                direct_item = folder_obj.get(id=exchange_id)
            except Exception:
                direct_item = None
            if direct_item is not None:
                conversation_key = self.item_conversation_key(direct_item)
            try:
                if direct_item is None:
                    folder_obj, last_folder_key = self.resolve_folder(account, normalized_folder)
                    direct_item = folder_obj.get(id=conversation_key)
            except Exception:
                direct_item = None

            if direct_item is not None:
                derived_key = self.item_conversation_key(direct_item)
                if derived_key:
                    conversation_key = derived_key
                items_raw, last_scanned_folder_key, _searched_window, _search_limited = self._scan_targets(
                    targets=targets,
                    conversation_key=conversation_key,
                    searched_window=searched_window,
                )
                last_folder_key = last_scanned_folder_key or last_folder_key
                if not items_raw:
                    items_raw = [(direct_item, last_folder_key)]

        if not items_raw:
            raise MailConversationFinderError("Conversation not found")

        items_raw.sort(
            key=lambda pair: getattr(pair[0], "datetime_received", None)
            or getattr(pair[0], "datetime_created", None)
            or datetime.min.replace(tzinfo=timezone.utc)
        )
        return conversation_key, items_raw, last_folder_key
