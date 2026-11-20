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

    def _item_by_id(self, folder_obj: Any, exchange_id: str) -> Any:
        # Fallback path only needs conversation_id; hydrate later loads detail fields.
        try:
            return folder_obj.all().only("conversation_id").get(id=exchange_id)
        except Exception:
            return folder_obj.get(id=exchange_id)

    def _scan_targets(
        self,
        *,
        targets: list[tuple[Any, str]],
        conversation_key: str,
        searched_window: int = 0,
        require_complete: bool = False,
        allow_restricted: bool = True,
    ) -> tuple[list[tuple[Any, str]], str, int, bool]:
        items_raw: list[tuple[Any, str]] = []
        last_folder_key = ""
        search_budget = max(1, int(self.search_window_limit()))
        search_limited = False
        restricted_id = None
        restricted_ok = allow_restricted
        restricted_ran = False
        if restricted_ok:
            try:
                from exchangelib.properties import ConversationId

                # The restriction only accepts a real ConversationId object —
                # subject-derived keys fail here or at the filter and are scanned.
                restricted_id = ConversationId(conversation_key)
            except Exception:
                restricted_ok = False

        for folder_obj, folder_key in targets:
            last_folder_key = folder_key
            if isinstance(folder_obj, Exception):
                # Scope enumeration failed for this branch of the folder
                # hierarchy. A "complete" scan must be honest and fail instead
                # of silently returning a partial conversation.
                if require_complete:
                    raise MailConversationFinderError(
                        f"Conversation scope is unavailable: {folder_obj}"
                    ) from folder_obj
                search_limited = True
                continue
            queryset = self.folder_queryset(folder_obj, folder_key)
            if restricted_ok:
                # One indexed FindItem beats sweeping the whole folder for a
                # ConversationId key. A server that rejects the field drops to
                # the raw scan below and is not retried for other folders.
                try:
                    restricted_items = list(queryset.filter(conversation_id=restricted_id))
                except Exception:
                    restricted_items = None
                    restricted_ok = False
                restricted_ran = True
                if restricted_items is not None:
                    for item in restricted_items:
                        if not require_complete and searched_window >= search_budget:
                            search_limited = True
                            break
                        if self.item_conversation_key(item) == conversation_key:
                            items_raw.append((item, folder_key))
                        searched_window += 1
                    if search_limited:
                        break
                    continue
            scanned = 0
            while True:
                if not require_complete and searched_window >= search_budget:
                    search_limited = True
                    break
                batch_limit = self.search_batch_size if require_complete else min(self.search_batch_size, search_budget - searched_window)
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
        if restricted_ok and restricted_ran and not items_raw:
            # The restriction answered empty for every folder — the key may be
            # subject-derived (normalized_subject fallback), which the server
            # treats as a well-formed but absent id. One raw sweep resolves it.
            return self._scan_targets(
                targets=targets,
                conversation_key=conversation_key,
                searched_window=searched_window,
                require_complete=require_complete,
                allow_restricted=False,
            )
        return items_raw, last_folder_key, searched_window, search_limited

    def find(
        self,
        *,
        account: Any,
        conversation_id: str,
        folder: str = "inbox",
        folder_scope: str = "current",
        require_complete: bool = False,
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
        allowed_folder_keys = {key for _folder, key in targets}
        direct_item = None
        direct_folder_key = ""
        if require_complete:
            # An explicit message reference can identify the thread before reading the folders.
            try:
                ref_folder, exchange_id = self.decode_message_id(conversation_key)
                folder_obj, resolved_folder_key = self.resolve_folder(account, ref_folder)
                if resolved_folder_key in allowed_folder_keys:
                    direct_item = self._item_by_id(folder_obj, exchange_id)
                    direct_folder_key = resolved_folder_key
                    conversation_key = self.item_conversation_key(direct_item) or conversation_key
            except Exception:
                direct_item = None

        items_raw, last_folder_key, searched_window, _search_limited = self._scan_targets(
            targets=targets,
            conversation_key=conversation_key,
            require_complete=require_complete,
        )
        last_folder_key = last_folder_key or normalized_folder
        if not items_raw and direct_item is not None:
            items_raw = [(direct_item, direct_folder_key)]
            last_folder_key = direct_folder_key

        if not items_raw:
            try:
                folder_key_from_message, exchange_id = self.decode_message_id(conversation_key)
                folder_obj, direct_folder_key = self.resolve_folder(account, folder_key_from_message)
                if direct_folder_key not in allowed_folder_keys:
                    raise MailConversationFinderError("Message is outside the selected folders")
                direct_item = self._item_by_id(folder_obj, exchange_id)
            except Exception:
                direct_item = None
            if direct_item is not None:
                conversation_key = self.item_conversation_key(direct_item)
            try:
                if direct_item is None:
                    folder_obj, direct_folder_key = self.resolve_folder(account, normalized_folder)
                    if direct_folder_key not in allowed_folder_keys:
                        raise MailConversationFinderError("Message is outside the selected folders")
                    direct_item = self._item_by_id(folder_obj, conversation_key)
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
                    require_complete=require_complete,
                )
                last_folder_key = last_scanned_folder_key or last_folder_key
                if not items_raw:
                    items_raw = [(direct_item, direct_folder_key)]
                    last_folder_key = direct_folder_key

        if not items_raw:
            raise MailConversationFinderError("Conversation not found")

        items_raw.sort(
            key=lambda pair: getattr(pair[0], "datetime_received", None)
            or getattr(pair[0], "datetime_created", None)
            or datetime.min.replace(tzinfo=timezone.utc)
        )
        return conversation_key, items_raw, last_folder_key
