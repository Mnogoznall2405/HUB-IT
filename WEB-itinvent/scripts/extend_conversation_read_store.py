"""Append conversation read methods to ChatConversationReadStore."""
from __future__ import annotations

import re
from pathlib import Path

SERVICE_PATH = Path(__file__).resolve().parents[1] / "backend" / "chat" / "service.py"
STORE_PATH = Path(__file__).resolve().parents[1] / "backend" / "chat" / "chat_conversation_read_store.py"

METHODS = [
    "get_conversation",
    "get_conversation_summaries_for_users",
    "get_conversation_assets_summary",
    "list_conversation_attachments",
]

HELPERS = [
    "_cache_get", "_cache_set", "_require_membership", "_build_conversation_detail_payload",
    "_build_conversation_summary_payload", "_serialize_conversation", "_list_attachments_by_message",
    "_get_presence_map", "_get_users_map", "_get_attachment_kind", "_conversation_attachment_to_payload",
    "_normalize_attachment_kind_filter", "_apply_attachment_kind_filter",
]


def extract_method(lines: list[str], name: str) -> list[str]:
    pat = re.compile(rf"^    def {re.escape(name)}\(")
    start = next(i for i, line in enumerate(lines) if pat.match(line))
    end = len(lines)
    for j in range(start + 1, len(lines)):
        if lines[j].startswith("    def ") or lines[j].startswith("chat_service"):
            end = j
            break
    chunk = lines[start:end]
    out = []
    for line in chunk:
        if line.startswith("        "):
            out.append(line)
        elif line.startswith("    "):
            out.append(line)
        elif line.strip() == "":
            out.append(line)
        else:
            out.append("        " + line)
        text = out[-1]
        text = text.replace("self._ensure_available()", "")
        for prefix in HELPERS:
            text = re.sub(rf"\bself\.{prefix}\b", f"self._service.{prefix}", text)
        out[-1] = text
    return out


def main() -> None:
    service_lines = SERVICE_PATH.read_text(encoding="utf-8").splitlines()
    store_text = STORE_PATH.read_text(encoding="utf-8")
    additions = []
    for name in METHODS:
        if f"def {name}(" in store_text:
            continue
        additions.extend(extract_method(service_lines, name))
        additions.append("")
    if additions:
        STORE_PATH.write_text(store_text.rstrip() + "\n\n" + "\n".join(additions) + "\n", encoding="utf-8")
        print("extended", STORE_PATH)
    else:
        print("no additions needed")


if __name__ == "__main__":
    main()
