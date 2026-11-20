from __future__ import annotations

from dataclasses import dataclass
from typing import Any, Callable

from backend.services.mail_message_listing import (
    _SEARCH_SCAN_SECONDS,
    received_at_epoch,
    scan_search_folders,
)
from backend.services.mail_message_serializer import item_display_attachment_stats
from backend.services.mail_reference_codec import MAIL_FLAG_CATEGORY


def _item_flagged(item: Any) -> bool:
    categories = getattr(item, "categories", None) or []
    return MAIL_FLAG_CATEGORY in categories


def _normalize_text(value: Any, default: str = "") -> str:
    if value is None:
        return default
    try:
        text = str(value).strip()
    except Exception:
        return default
    return text or default


def _item_attachment_hint(item: Any) -> tuple[bool, int]:
    stats = item_display_attachment_stats(item)
    if stats is not None:
        return stats
    has_attachments = bool(getattr(item, "has_attachments", False))
    return has_attachments, (1 if has_attachments else 0)


@dataclass(frozen=True)
class ConversationListResult:
    payload: dict[str, Any]
    searched_window: int
    search_limited: bool
    skipped_folders: int = 0


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
        scan = scan_search_folders(
            targets=self.search_target_folders(account, folder=normalized_folder, folder_scope=normalized_scope),
            folder_queryset=self.folder_queryset,
            message_matches_filters=self.message_matches_filters,
            filters=filters or {},
            batch_size=self.search_batch_size,
            budget=max(1, int(self.search_window_limit())),
            all_scope=normalized_scope.lower() == "all",
            # No outer awaitable bounds this call — the scan must bound itself.
            time_budget_seconds=_SEARCH_SCAN_SECONDS,
        )
        grouped: dict[str, dict[str, Any]] = {}
        for item, _folder_key in scan.matches:
            self._add_item_to_group(grouped, item)

        conversations = [
            self._serialize_group(item)
            for item in grouped.values()
            if not unread_only or int(item["unread_count"]) > 0
        ]
        conversations.sort(
            key=lambda item: (
                received_at_epoch(item.get("last_received_at")),
                str(item.get("last_received_at") or ""),
            ),
            reverse=True,
        )
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
                "search_limited": scan.search_limited,
                "searched_window": scan.searched_window,
                "skipped_folders": scan.skipped_folders,
            },
            searched_window=scan.searched_window,
            search_limited=scan.search_limited,
            skipped_folders=scan.skipped_folders,
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
                "is_flagged": False,
                "preview": _normalize_text(getattr(item, "text_body", None))[:280],
            }
            grouped[key] = group
        group["messages_count"] += 1
        group["is_flagged"] = bool(group["is_flagged"] or _item_flagged(item))
        if not bool(getattr(item, "is_read", False)):
            group["unread_count"] += 1
        has_attachments, attachments_count = _item_attachment_hint(item)
        group["has_attachments"] = bool(group["has_attachments"] or has_attachments)
        group["attachments_count"] = max(int(group["attachments_count"]), attachments_count)
        if received_iso and received_at_epoch(received_iso) > received_at_epoch(
            group.get("last_received_at")
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
            "is_flagged": bool(item["is_flagged"]),
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
            "is_flagged": any(bool(item.get("is_flagged")) for item in items),
            "last_received_at": items[-1].get("received_at"),
            "items": items,
        }
