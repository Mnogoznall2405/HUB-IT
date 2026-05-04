from __future__ import annotations

from dataclasses import dataclass
from typing import Any, Callable, Iterable


def _normalize_text(value: Any, default: str = "") -> str:
    if value is None:
        return default
    try:
        text = str(value).strip()
    except Exception:
        return default
    return text or default


class MailMessageActionError(Exception):
    pass


@dataclass(frozen=True)
class MailMessageMoveResult:
    message_id: str
    folder: str
    source_folder: str
    source_exchange_id: str
    target_exchange_id: str


@dataclass(frozen=True)
class MailReadStateBulkResult:
    changed: int
    failed: int


class MailMessageActions:
    def __init__(
        self,
        *,
        resolve_folder: Callable[[Any, str], tuple[Any, str]],
        encode_message_id: Callable[[str, str, str | None], str],
    ) -> None:
        self.resolve_folder = resolve_folder
        self.encode_message_id = encode_message_id

    def _message_item(self, *, account: Any, folder_key: str, exchange_id: str) -> tuple[Any, str, Any]:
        folder_obj, resolved_folder_key = self.resolve_folder(account, folder_key)
        try:
            item = folder_obj.get(id=exchange_id)
        except Exception as exc:
            raise MailMessageActionError(f"Message not found: {exchange_id}") from exc
        return folder_obj, resolved_folder_key, item

    def set_read_state(self, *, account: Any, folder_key: str, exchange_id: str, is_read: bool) -> bool:
        _folder_obj, _resolved_folder_key, item = self._message_item(
            account=account,
            folder_key=folder_key,
            exchange_id=exchange_id,
        )
        try:
            current_read = getattr(item, "is_read", None)
            if current_read is not bool(is_read):
                item.is_read = bool(is_read)
                item.save(update_fields=["is_read"])
            return True
        except Exception as exc:
            state = "read" if is_read else "unread"
            raise MailMessageActionError(f"Failed to mark message as {state}: {exc}") from exc

    def set_items_read_state(self, *, items: Iterable[Any], is_read: bool) -> MailReadStateBulkResult:
        changed = 0
        failed = 0
        for item in items:
            try:
                current_read = bool(getattr(item, "is_read", False))
                if current_read == bool(is_read):
                    continue
                item.is_read = bool(is_read)
                item.save(update_fields=["is_read"])
                changed += 1
            except Exception:
                failed += 1
        return MailReadStateBulkResult(changed=changed, failed=failed)

    def mark_all_read(self, *, folder_targets: Iterable[tuple[Any, str]]) -> MailReadStateBulkResult:
        changed = 0
        failed = 0
        for folder_obj, _folder_key in folder_targets:
            try:
                unread_items = list(folder_obj.filter(is_read=False))
            except Exception:
                unread_items = []
            result = self.set_items_read_state(items=unread_items, is_read=True)
            changed += result.changed
            failed += result.failed
        return MailReadStateBulkResult(changed=changed, failed=failed)

    def move_message(
        self,
        *,
        account: Any,
        folder_key: str,
        exchange_id: str,
        target_folder: str,
        mailbox_id: str | None,
    ) -> MailMessageMoveResult:
        source_folder_obj, source_folder_key, item = self._message_item(
            account=account,
            folder_key=folder_key,
            exchange_id=exchange_id,
        )
        target_folder_obj, target_folder_key = self.resolve_folder(account, target_folder)
        try:
            moved_item = item.move(target_folder_obj)
            new_exchange_id = _normalize_text(getattr(moved_item, "id", None) or getattr(item, "id", None))
        except Exception as exc:
            raise MailMessageActionError(f"Failed to move message: {exc}") from exc

        return MailMessageMoveResult(
            message_id=self.encode_message_id(target_folder_key, new_exchange_id, mailbox_id),
            folder=target_folder_key,
            source_folder=source_folder_key,
            source_exchange_id=exchange_id,
            target_exchange_id=new_exchange_id,
        )

    def delete_message(self, *, account: Any, folder_key: str, exchange_id: str) -> None:
        _folder_obj, _resolved_folder_key, item = self._message_item(
            account=account,
            folder_key=folder_key,
            exchange_id=exchange_id,
        )
        try:
            item.delete()
        except Exception as exc:
            raise MailMessageActionError(f"Failed to delete message: {exc}") from exc
