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
class MailFolderTreeBuildResult:
    payload: dict[str, Any]
    stale_folder_ids: set[str]


class MailFolderTreeBuilder:
    def __init__(
        self,
        *,
        standard_folders_meta: dict[str, dict[str, Any]],
        safe_folder_attr: Callable[[Any, str], Any],
        encode_folder_id: Callable[[str, str], str],
        folder_scope_for_alias: Callable[[str], str],
        custom_folder_root: Callable[[Any, str], Any],
        is_mail_folder_visible_in_tree: Callable[[Any], bool],
    ) -> None:
        self.standard_folders_meta = standard_folders_meta
        self.safe_folder_attr = safe_folder_attr
        self.encode_folder_id = encode_folder_id
        self.folder_scope_for_alias = folder_scope_for_alias
        self.custom_folder_root = custom_folder_root
        self.is_mail_folder_visible_in_tree = is_mail_folder_visible_in_tree

    def folder_counts(self, folder_obj: Any) -> tuple[int, int]:
        total_attr = self.safe_folder_attr(folder_obj, "total_count")
        unread_attr = self.safe_folder_attr(folder_obj, "unread_count")
        try:
            total = int(total_attr)
        except Exception:
            total = None
        try:
            unread = int(unread_attr)
        except Exception:
            unread = None
        if total is not None and unread is not None:
            return max(0, total), max(0, unread)
        try:
            total = int(folder_obj.all().count())
        except Exception:
            total = 0
        try:
            unread = int(folder_obj.filter(is_read=False).count())
        except Exception:
            unread = 0
        return total, unread

    def folder_total_hint(self, folder_obj: Any, *, unread_only: bool = False) -> int | None:
        attr_name = "unread_count" if unread_only else "total_count"
        raw_value = self.safe_folder_attr(folder_obj, attr_name)
        try:
            return max(0, int(raw_value))
        except Exception:
            return None

    def folder_counts_from_hints(self, folder_obj: Any, *, fallback: bool = True) -> tuple[int, int]:
        total = self.folder_total_hint(folder_obj, unread_only=False)
        unread = self.folder_total_hint(folder_obj, unread_only=True)
        if total is not None and unread is not None:
            return total, unread
        if not fallback:
            return max(0, int(total or 0)), max(0, int(unread or 0))
        return self.folder_counts(folder_obj)

    def serialize_folder_node(
        self,
        folder_obj: Any,
        *,
        folder_key: str,
        scope: str,
        parent_id: str | None,
        favorite_ids: set[str],
        counts: tuple[int, int] | None = None,
    ) -> dict[str, Any]:
        total, unread = counts if counts is not None else self.folder_counts(folder_obj)
        well_known_key = folder_key if folder_key in self.standard_folders_meta else None
        standard_meta = self.standard_folders_meta.get(folder_key) if well_known_key else None
        return {
            "id": folder_key,
            "exchange_id": _normalize_text(getattr(folder_obj, "id", None)) or None,
            "name": _normalize_text(getattr(folder_obj, "name", None)) or (standard_meta or {}).get("label") or folder_key,
            "label": (standard_meta or {}).get("label") or _normalize_text(getattr(folder_obj, "name", None), folder_key),
            "scope": scope,
            "icon_key": (standard_meta or {}).get("icon_key") or "folder",
            "well_known_key": well_known_key,
            "parent_id": parent_id,
            "is_favorite": folder_key in favorite_ids,
            "is_distinguished": bool(well_known_key),
            "can_rename": not bool(well_known_key),
            "can_delete": not bool(well_known_key),
            "can_create_children": True,
            "total": total,
            "unread": unread,
            "child_folder_count": int(getattr(folder_obj, "child_folder_count", 0) or 0),
        }

    def list_folder_summary(self, *, standard_folders: dict[str, Any]) -> dict[str, dict[str, int]]:
        result: dict[str, dict[str, int]] = {}
        for key, folder_obj in standard_folders.items():
            total, unread = self.folder_counts(folder_obj)
            result[key] = {"total": total, "unread": unread}
        return result

    def build_tree(
        self,
        *,
        account: Any,
        standard_folders: dict[str, Any],
        walked_folders: list[tuple[Any, str, str]],
        favorite_ids: set[str],
        persisted_custom_folder_ids: set[str],
        summary: dict[str, Any] | None = None,
    ) -> MailFolderTreeBuildResult:
        folder_lookup = {
            folder_key: folder_obj
            for folder_obj, folder_key, _scope_key in walked_folders
        }
        standard_exchange_map = {
            _normalize_text(getattr(folder_obj, "id", None)): alias
            for alias, folder_obj in standard_folders.items()
            if _normalize_text(getattr(folder_obj, "id", None))
        }
        mailbox_root_id = _normalize_text(getattr(self.safe_folder_attr(account, "msg_folder_root"), "id", None))
        archive_root_id = _normalize_text(getattr(self.safe_folder_attr(account, "archive_msg_folder_root"), "id", None))
        mailbox_custom_root_id = _normalize_text(getattr(self.custom_folder_root(account, "mailbox"), "id", None))
        archive_custom_root_id = _normalize_text(getattr(self.custom_folder_root(account, "archive"), "id", None))

        def resolve_parent_id(folder_obj: Any, scope: str) -> str | None:
            parent = getattr(folder_obj, "parent", None)
            parent_exchange_id = _normalize_text(getattr(parent, "id", None))
            if not parent_exchange_id:
                return None
            if parent_exchange_id in standard_exchange_map:
                return standard_exchange_map[parent_exchange_id]
            root_ids = {mailbox_root_id, archive_root_id}
            if scope == "archive":
                root_ids.add(archive_custom_root_id)
            else:
                root_ids.add(mailbox_custom_root_id)
            if parent_exchange_id in root_ids:
                return None
            parent_scope = "archive" if scope == "archive" else "mailbox"
            parent_folder_id = self.encode_folder_id(parent_scope, parent_exchange_id)
            return parent_folder_id if parent_folder_id in folder_lookup else None

        items: list[dict[str, Any]] = []
        for alias, folder_obj in standard_folders.items():
            scope = self.folder_scope_for_alias(alias)
            summary_entry = summary.get(alias) if isinstance(summary, dict) else None
            if isinstance(summary_entry, dict):
                counts = (
                    max(0, int(summary_entry.get("total") or 0)),
                    max(0, int(summary_entry.get("unread") or 0)),
                )
            else:
                counts = self.folder_counts_from_hints(folder_obj, fallback=True)
            items.append(
                self.serialize_folder_node(
                    folder_obj,
                    folder_key=alias,
                    scope=scope,
                    parent_id=resolve_parent_id(folder_obj, scope),
                    favorite_ids=favorite_ids,
                    counts=counts,
                )
            )

        present_custom_folder_ids: set[str] = set()
        pending_custom_entries: dict[str, tuple[Any, str, str, str | None]] = {}
        for folder_obj, folder_key, scope_key in walked_folders:
            if folder_key in self.standard_folders_meta:
                continue
            present_custom_folder_ids.add(folder_key)
            pending_custom_entries[folder_key] = (
                folder_obj,
                folder_key,
                scope_key,
                resolve_parent_id(folder_obj, scope_key),
            )

        included_custom_folder_ids: set[str] = set()
        while pending_custom_entries:
            progressed = False
            for folder_key, entry in list(pending_custom_entries.items()):
                folder_obj, _resolved_folder_key, scope_key, parent_id = entry
                if parent_id and parent_id not in self.standard_folders_meta and parent_id not in included_custom_folder_ids:
                    if parent_id in pending_custom_entries:
                        continue
                    pending_custom_entries.pop(folder_key, None)
                    progressed = True
                    continue
                if not self.is_mail_folder_visible_in_tree(folder_obj):
                    pending_custom_entries.pop(folder_key, None)
                    progressed = True
                    continue
                items.append(
                    self.serialize_folder_node(
                        folder_obj,
                        folder_key=folder_key,
                        scope=scope_key,
                        parent_id=parent_id,
                        favorite_ids=favorite_ids,
                        counts=self.folder_counts_from_hints(folder_obj, fallback=True),
                    )
                )
                included_custom_folder_ids.add(folder_key)
                pending_custom_entries.pop(folder_key, None)
                progressed = True
            if not progressed:
                break

        stale_folder_ids = {
            folder_id
            for folder_id in persisted_custom_folder_ids
            if folder_id not in present_custom_folder_ids
        }

        items.sort(
            key=lambda item: (
                item.get("scope") != "mailbox",
                0 if item.get("well_known_key") else 1,
                str(item.get("label") or "").lower(),
            )
        )
        return MailFolderTreeBuildResult(
            payload={
                "items": items,
                "favorites": [item["id"] for item in items if item.get("is_favorite")],
            },
            stale_folder_ids=stale_folder_ids,
        )
