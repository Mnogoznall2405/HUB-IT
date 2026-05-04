from __future__ import annotations

from dataclasses import dataclass
from typing import Any, Callable


def _normalize_text(value: Any, default: str = "") -> str:
    if value is None:
        return default
    try:
        text = str(value).strip()
    except Exception:
        return default
    return text or default


@dataclass(frozen=True)
class ConversationListResult:
    payload: dict[str, Any]
    searched_window: int
    search_limited: bool


class MailConversationPayloadBuilder:
    def __init__(
        self,
        *,
        search_target_folders: Callable[..., list[tuple[Any, str]]],
        folder_queryset: Callable[[Any, str], Any],
        message_matches_filters: Callable[..., bool],
        item_conversation_key: Callable[[Any], str],
        item_sender: Callable[[Any], str],
        item_recipients: Callable[[Any], list[str]],
        item_sender_person: Callable[[Any], dict[str, str | None]],
        item_recipient_people: Callable[[Any], list[dict[str, str | None]]],
        person_lookup_key: Callable[[dict[str, Any] | None], str],
        search_batch_size: int,
        search_window_limit: Callable[[], int],
    ) -> None:
        self.search_target_folders = search_target_folders
        self.folder_queryset = folder_queryset
        self.message_matches_filters = message_matches_filters
        self.item_conversation_key = item_conversation_key
        self.item_sender = item_sender
        self.item_recipients = item_recipients
        self.item_sender_person = item_sender_person
        self.item_recipient_people = item_recipient_people
        self.person_lookup_key = person_lookup_key
        self.search_batch_size = max(1, int(search_batch_size))
        self.search_window_limit = search_window_limit

    def list_conversations(
        self,
        *,
        account: Any,
        folder: str = "inbox",
        folder_scope: str = "current",
        limit: int = 50,
        offset: int = 0,
        unread_only: bool = False,
        filters: dict[str, Any] | None = None,
    ) -> ConversationListResult:
        safe_limit = max(1, min(200, int(limit or 50)))
        safe_offset = max(0, int(offset or 0))
        normalized_folder = _normalize_text(folder, "inbox")
        normalized_scope = _normalize_text(folder_scope, "current")
        filter_values = dict(filters or {})

        scanned = 0
        search_limited = False
        search_budget = max(1, int(self.search_window_limit()))
        grouped: dict[str, dict[str, Any]] = {}
        targets = self.search_target_folders(
            account,
            folder=normalized_folder,
            folder_scope=normalized_scope,
        )

        for folder_obj, folder_key in targets:
            queryset = self.folder_queryset(folder_obj, folder_key)
            scan_offset = 0
            while True:
                if scanned >= search_budget:
                    search_limited = True
                    break
                batch_limit = min(self.search_batch_size, search_budget - scanned)
                batch_items = list(queryset[scan_offset: scan_offset + batch_limit])
                if not batch_items:
                    break
                for item in batch_items:
                    if not self.message_matches_filters(item, **filter_values):
                        continue
                    self._add_item_to_group(grouped, item)
                scanned += len(batch_items)
                scan_offset += len(batch_items)
                if len(batch_items) < batch_limit:
                    break
            if search_limited:
                break

        conversations = [
            self._serialize_group(item)
            for item in grouped.values()
            if not unread_only or int(item["unread_count"]) > 0
        ]
        conversations.sort(key=lambda item: item.get("last_received_at") or "", reverse=True)
        total = len(conversations)
        page_items = conversations[safe_offset: safe_offset + safe_limit]
        next_offset = safe_offset + len(page_items)
        return ConversationListResult(
            payload={
                "items": page_items,
                "folder": normalized_folder,
                "limit": safe_limit,
                "offset": safe_offset,
                "total": total,
                "has_more": next_offset < total,
                "next_offset": next_offset if next_offset < total else None,
                "search_limited": bool(search_limited),
                "searched_window": scanned,
            },
            searched_window=scanned,
            search_limited=bool(search_limited),
        )

    def _add_item_to_group(self, grouped: dict[str, dict[str, Any]], item: Any) -> None:
        key = self.item_conversation_key(item)
        group = grouped.get(key)
        received = getattr(item, "datetime_received", None) or getattr(item, "datetime_created", None)
        received_iso = received.isoformat() if received else None
        sender = self.item_sender(item)
        participants = [sender, *self.item_recipients(item)]
        participant_people = [
            self.item_sender_person(item),
            *self.item_recipient_people(item),
        ]
        if group is None:
            group = {
                "conversation_id": key,
                "subject": _normalize_text(getattr(item, "subject", "")) or "(без темы)",
                "participants": [],
                "participant_people": [],
                "participants_set": set(),
                "participant_people_set": set(),
                "messages_count": 0,
                "unread_count": 0,
                "last_received_at": received_iso,
                "has_attachments": False,
                "attachments_count": 0,
                "preview": _normalize_text(getattr(item, "text_body", None))[:280],
            }
            grouped[key] = group
        group["messages_count"] += 1
        if not bool(getattr(item, "is_read", False)):
            group["unread_count"] += 1
        attachments_count = len(getattr(item, "attachments", None) or [])
        group["has_attachments"] = bool(group["has_attachments"] or attachments_count > 0)
        group["attachments_count"] = max(int(group["attachments_count"]), attachments_count)
        if received_iso and (
            not group.get("last_received_at")
            or str(received_iso) > str(group.get("last_received_at"))
        ):
            group["last_received_at"] = received_iso
            group["preview"] = _normalize_text(getattr(item, "text_body", None))[:280]
            group["subject"] = _normalize_text(getattr(item, "subject", "")) or "(без темы)"
        for participant in participants:
            value = _normalize_text(participant).lower()
            if value and value not in group["participants_set"]:
                group["participants_set"].add(value)
                group["participants"].append(value)
        for participant in participant_people:
            value = self.person_lookup_key(participant)
            if value and value not in group["participant_people_set"]:
                group["participant_people_set"].add(value)
                group["participant_people"].append(participant)

    @staticmethod
    def _serialize_group(item: dict[str, Any]) -> dict[str, Any]:
        return {
            "conversation_id": item["conversation_id"],
            "subject": item["subject"],
            "participants": item["participants"],
            "participant_people": item["participant_people"],
            "messages_count": int(item["messages_count"]),
            "unread_count": int(item["unread_count"]),
            "last_received_at": item["last_received_at"],
            "has_attachments": bool(item["has_attachments"]),
            "attachments_count": int(item["attachments_count"]),
            "preview": item["preview"],
        }

    def conversation_detail_payload(
        self,
        *,
        conversation_id: str,
        items: list[dict[str, Any]],
    ) -> dict[str, Any]:
        participants: list[str] = []
        participant_people: list[dict[str, str | None]] = []
        participant_email_seen: set[str] = set()
        participant_people_seen: set[str] = set()
        for item in items:
            for value in [item.get("sender"), *(item.get("to") or []), *(item.get("cc") or [])]:
                email = _normalize_text(value).lower()
                if not email or email in participant_email_seen:
                    continue
                participant_email_seen.add(email)
                participants.append(email)
            for person in [item.get("sender_person"), *(item.get("to_people") or []), *(item.get("cc_people") or [])]:
                lookup_key = self.person_lookup_key(person)
                if not lookup_key or lookup_key in participant_people_seen:
                    continue
                participant_people_seen.add(lookup_key)
                participant_people.append(person)

        return {
            "conversation_id": conversation_id,
            "subject": items[-1].get("subject") or "(без темы)",
            "participants": participants,
            "participant_people": participant_people,
            "messages_count": len(items),
            "unread_count": sum(1 for item in items if not item.get("is_read")),
            "last_received_at": items[-1].get("received_at"),
            "items": items,
        }
