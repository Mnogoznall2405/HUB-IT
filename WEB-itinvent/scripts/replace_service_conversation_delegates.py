"""Replace conversation read ChatService methods with delegates."""
from __future__ import annotations

import re
from pathlib import Path

SERVICE_PATH = Path(__file__).resolve().parents[1] / "backend" / "chat" / "service.py"

DELEGATES = {
    "get_conversation": '''    def get_conversation(
        self,
        *,
        current_user_id: int,
        conversation_id: str,
    ) -> dict:
        self._ensure_available()
        return self._conversation_reads.get_conversation(
            current_user_id=int(current_user_id),
            conversation_id=conversation_id,
        )
''',
    "get_conversation_summaries_for_users": '''    def get_conversation_summaries_for_users(
        self,
        *,
        conversation_id: str,
        user_ids: list[int] | set[int] | tuple[int, ...],
    ) -> dict[int, dict]:
        self._ensure_available()
        return self._conversation_reads.get_conversation_summaries_for_users(
            conversation_id=conversation_id,
            user_ids=user_ids,
        )
''',
    "get_conversation_assets_summary": '''    def get_conversation_assets_summary(
        self,
        *,
        current_user_id: int,
        conversation_id: str,
        recent_limit: int = 8,
    ) -> dict:
        self._ensure_available()
        return self._conversation_reads.get_conversation_assets_summary(
            current_user_id=int(current_user_id),
            conversation_id=conversation_id,
            recent_limit=recent_limit,
        )
''',
    "list_conversation_attachments": '''    def list_conversation_attachments(
        self,
        *,
        current_user_id: int,
        conversation_id: str,
        kind: str,
        limit: int = 20,
        before_attachment_id: Optional[str] = None,
    ) -> dict:
        self._ensure_available()
        return self._conversation_reads.list_conversation_attachments(
            current_user_id=int(current_user_id),
            conversation_id=conversation_id,
            kind=kind,
            limit=limit,
            before_attachment_id=before_attachment_id,
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
    SERVICE_PATH.write_text(text, encoding="utf-8")
    print("conversation delegates updated")


if __name__ == "__main__":
    main()
