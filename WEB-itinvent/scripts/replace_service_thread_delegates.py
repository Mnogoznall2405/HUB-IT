"""Replace extracted ChatService methods with thin delegates."""
from __future__ import annotations

import re
from pathlib import Path

SERVICE_PATH = Path(__file__).resolve().parents[1] / "backend" / "chat" / "service.py"

DELEGATES = {
    "get_message": '''    def get_message(
        self,
        *,
        current_user_id: int,
        message_id: str,
    ) -> dict:
        self._ensure_available()
        return self._thread_reads.get_message(
            current_user_id=int(current_user_id),
            message_id=message_id,
        )
''',
    "get_messages_for_users": '''    def get_messages_for_users(
        self,
        *,
        message_id: str,
        user_ids: list[int],
    ) -> dict[int, dict]:
        self._ensure_available()
        return self._thread_reads.get_messages_for_users(
            message_id=message_id,
            user_ids=user_ids,
        )
''',
    "get_messages": '''    def get_messages(
        self,
        *,
        current_user_id: int,
        conversation_id: str,
        before_message_id: Optional[str] = None,
        after_message_id: Optional[str] = None,
        limit: int = 100,
    ) -> dict:
        self._ensure_available()
        return self._thread_reads.get_messages(
            current_user_id=int(current_user_id),
            conversation_id=conversation_id,
            before_message_id=before_message_id,
            after_message_id=after_message_id,
            limit=limit,
        )
''',
    "get_thread_bootstrap": '''    def get_thread_bootstrap(
        self,
        *,
        current_user_id: int,
        conversation_id: str,
        focus_message_id: Optional[str] = None,
        limit: int = 40,
    ) -> dict[str, Any]:
        self._ensure_available()
        return self._thread_reads.get_thread_bootstrap(
            current_user_id=int(current_user_id),
            conversation_id=conversation_id,
            focus_message_id=focus_message_id,
            limit=limit,
        )
''',
    "search_messages": '''    def search_messages(
        self,
        *,
        current_user_id: int,
        conversation_id: str,
        q: str,
        limit: int = 20,
        before_message_id: Optional[str] = None,
    ) -> dict:
        self._ensure_available()
        return self._thread_reads.search_messages(
            current_user_id=int(current_user_id),
            conversation_id=conversation_id,
            q=q,
            limit=limit,
            before_message_id=before_message_id,
        )
''',
    "get_message_reads": '''    def get_message_reads(self, *, current_user_id: int, message_id: str) -> dict:
        self._ensure_available()
        return self._thread_reads.get_message_reads(
            current_user_id=int(current_user_id),
            message_id=message_id,
        )
''',
    "get_message_read_delta": '''    def get_message_read_delta(self, *, conversation_id: str, message_id: str) -> dict:
        self._ensure_available()
        return self._thread_reads.get_message_read_delta(
            conversation_id=conversation_id,
            message_id=message_id,
        )
''',
    "_serialize_thread_messages_payload": '''    def _serialize_thread_messages_payload(
        self,
        *,
        session,
        conversation: ChatConversation,
        current_user_id: int,
        messages: list[ChatMessage],
        has_older: bool,
        has_newer: bool,
        lightweight: bool = False,
    ) -> dict[str, Any]:
        return self._thread_reads._serialize_thread_messages_payload(
            session=session,
            conversation=conversation,
            current_user_id=int(current_user_id),
            messages=messages,
            has_older=has_older,
            has_newer=has_newer,
            lightweight=lightweight,
        )
''',
}


def replace_method(text: str, name: str, replacement: str) -> str:
    pat = re.compile(rf"    def {re.escape(name)}\(.*?(?=\n    def |\nchat_service =)", re.DOTALL)
    new_text, count = pat.subn(replacement + "\n", text, count=1)
    if count != 1:
        raise SystemExit(f"replace failed for {name}: {count}")
    return new_text


def main() -> None:
    text = SERVICE_PATH.read_text(encoding="utf-8")
    for name, body in DELEGATES.items():
        text = replace_method(text, name, body.rstrip())
    stub = '''
    def _batch_action_cards_for_messages(self, *, session, message_ids: list[str]) -> dict[str, dict]:
        return {}
'''
    if "_batch_action_cards_for_messages" not in text:
        text = text.replace(
            "    def _get_message_action_card(self, *, message_id: str) -> dict | None:",
            stub + "\n    def _get_message_action_card(self, *, message_id: str) -> dict | None:",
        )
    SERVICE_PATH.write_text(text, encoding="utf-8")
    print("service delegates updated", SERVICE_PATH)


if __name__ == "__main__":
    main()
