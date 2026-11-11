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


class MailFolderMutationError(Exception):
    pass


@dataclass(frozen=True)
class MailFolderMutationResult:
    folder_id: str
    payload: dict[str, Any]


def _default_folder_cls():
    from exchangelib.folders import Folder

    return Folder


class MailFolderMutations:
    def __init__(
        self,
        *,
        standard_folder_keys: set[str],
        safe_folder_attr: Callable[[Any, str], Any],
        standard_folders: Callable[[Any], dict[str, Any]],
        resolve_folder: Callable[[Any, str], tuple[Any, str]],
        folder_scope_for_alias: Callable[[str], str],
        decode_folder_id: Callable[[str], tuple[str, str]],
        encode_folder_id: Callable[[str, str], str],
        custom_folder_root: Callable[[Any, str], Any],
        find_existing_child_folder: Callable[[Any, str], Any],
        serialize_folder_node: Callable[..., dict[str, Any]],
        folder_cls_factory: Callable[[], Any] = _default_folder_cls,
    ) -> None:
        self.standard_folder_keys = set(standard_folder_keys)
        self.safe_folder_attr = safe_folder_attr
        self.standard_folders = standard_folders
        self.resolve_folder = resolve_folder
        self.folder_scope_for_alias = folder_scope_for_alias
        self.decode_folder_id = decode_folder_id
        self.encode_folder_id = encode_folder_id
        self.custom_folder_root = custom_folder_root
        self.find_existing_child_folder = find_existing_child_folder
        self.serialize_folder_node = serialize_folder_node
        self.folder_cls_factory = folder_cls_factory

    def _standard_exchange_map(self, account: Any) -> dict[str, str]:
        return {
            _normalize_text(getattr(folder_obj, "id", None)): alias
            for alias, folder_obj in self.standard_folders(account).items()
            if _normalize_text(getattr(folder_obj, "id", None))
        }

    def _parent_id_for_folder(self, account: Any, *, folder_obj: Any, scope_key: str) -> str | None:
        parent = getattr(folder_obj, "parent", None)
        parent_exchange_id = _normalize_text(getattr(parent, "id", None))
        if not parent_exchange_id:
            return None
        parent_id = self._standard_exchange_map(account).get(parent_exchange_id)
        if parent_id is not None:
            return parent_id
        root_attr = "archive_msg_folder_root" if scope_key == "archive" else "msg_folder_root"
        root_exchange_id = _normalize_text(getattr(self.safe_folder_attr(account, root_attr), "id", None))
        if parent_exchange_id != root_exchange_id:
            return self.encode_folder_id(scope_key, parent_exchange_id)
        return None

    def create_folder(
        self,
        *,
        account: Any,
        name: str,
        parent_folder_id: str = "",
        scope: str = "mailbox",
        favorite_ids: set[str],
    ) -> MailFolderMutationResult:
        folder_name = _normalize_text(name)
        if not folder_name:
            raise MailFolderMutationError("Folder name is required")

        scope_key = _normalize_text(scope, "mailbox").lower()
        parent_folder = None
        if _normalize_text(parent_folder_id):
            parent_folder, parent_key = self.resolve_folder(account, parent_folder_id)
            if str(parent_key) in self.standard_folder_keys:
                scope_key = self.folder_scope_for_alias(str(parent_key))
            else:
                resolved_scope, _ = self.decode_folder_id(str(parent_key))
                scope_key = resolved_scope
        if parent_folder is None:
            parent_folder = self.custom_folder_root(account, scope_key)
        if parent_folder is None:
            raise MailFolderMutationError(f"Folder root is not available: {scope_key}")

        try:
            Folder = self.folder_cls_factory()
        except Exception as exc:
            raise MailFolderMutationError("exchangelib package is not installed") from exc

        created = None
        create_errors: list[str] = []
        create_parents = [parent_folder]
        fallback_root = (
            self.safe_folder_attr(account, "archive_msg_folder_root")
            if scope_key == "archive"
            else self.safe_folder_attr(account, "msg_folder_root")
        )
        fallback_root_id = _normalize_text(getattr(fallback_root, "id", None))
        primary_root_id = _normalize_text(getattr(parent_folder, "id", None))
        if fallback_root is not None and fallback_root_id and fallback_root_id != primary_root_id:
            create_parents.append(fallback_root)

        for candidate_parent in create_parents:
            try:
                created = Folder(parent=candidate_parent, name=folder_name)
                created.save()
                parent_folder = candidate_parent
                break
            except Exception as exc:
                existing_folder = self.find_existing_child_folder(candidate_parent, folder_name)
                if existing_folder is not None:
                    created = existing_folder
                    parent_folder = candidate_parent
                    break
                create_errors.append(str(exc))
                created = None

        if created is None:
            joined_errors = "; ".join(error for error in create_errors if error) or "unknown error"
            raise MailFolderMutationError(f"Failed to create folder: {joined_errors}")

        scope_key = _normalize_text(scope_key, "mailbox").lower()
        created_folder_id = self.encode_folder_id(scope_key, _normalize_text(getattr(created, "id", None)))
        parent_id = self._standard_exchange_map(account).get(_normalize_text(getattr(parent_folder, "id", None)))
        if parent_id is None:
            root_exchange_id = _normalize_text(getattr(self.custom_folder_root(account, scope_key), "id", None))
            parent_exchange_id = _normalize_text(getattr(parent_folder, "id", None))
            if parent_exchange_id and parent_exchange_id != root_exchange_id:
                parent_id = self.encode_folder_id(scope_key, parent_exchange_id)

        return MailFolderMutationResult(
            folder_id=created_folder_id,
            payload=self.serialize_folder_node(
                account,
                created,
                folder_key=created_folder_id,
                scope=scope_key,
                parent_id=parent_id,
                favorite_ids=favorite_ids,
            ),
        )

    def rename_folder(
        self,
        *,
        account: Any,
        folder_id: str,
        name: str,
        favorite_ids: set[str],
    ) -> MailFolderMutationResult:
        next_name = _normalize_text(name)
        if not next_name:
            raise MailFolderMutationError("Folder name is required")
        folder_obj, folder_key = self.resolve_folder(account, folder_id)
        if folder_key in self.standard_folder_keys:
            raise MailFolderMutationError("Standard folders cannot be renamed")
        try:
            folder_obj.name = next_name
            folder_obj.save(update_fields=["name"])
        except Exception as exc:
            raise MailFolderMutationError(f"Failed to rename folder: {exc}") from exc

        scope_key, _ = self.decode_folder_id(folder_key)
        parent_id = self._parent_id_for_folder(account, folder_obj=folder_obj, scope_key=scope_key)
        return MailFolderMutationResult(
            folder_id=folder_key,
            payload=self.serialize_folder_node(
                account,
                folder_obj,
                folder_key=folder_key,
                scope=scope_key,
                parent_id=parent_id,
                favorite_ids=favorite_ids,
            ),
        )

    def delete_folder(self, *, account: Any, folder_id: str) -> str:
        folder_obj, folder_key = self.resolve_folder(account, folder_id)
        if folder_key in self.standard_folder_keys:
            raise MailFolderMutationError("Standard folders cannot be deleted")
        try:
            folder_obj.delete()
        except Exception as exc:
            raise MailFolderMutationError(f"Failed to delete folder: {exc}") from exc
        return folder_key
