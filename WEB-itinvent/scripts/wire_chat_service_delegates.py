"""Replace inline ChatService methods with thin domain delegates."""
from __future__ import annotations

import ast
import re
from pathlib import Path

SERVICE_PATH = Path(__file__).resolve().parents[1] / "backend" / "chat" / "service.py"

DELEGATE_TARGETS: dict[str, str] = {
    # cache
    "_cache_key": "_cache",
    "_cache_get": "_cache",
    "_cache_set": "_cache",
    "_invalidate_user_cache": "_cache",
    "_invalidate_conversation_views_for_users": "_cache",
    # serialization
    "_serialize_upload_session_file": "_serialization",
    "_serialize_upload_session": "_serialization",
    "_build_conversation_payload": "_serialization",
    "_build_conversation_summary_payload": "_serialization",
    "_build_conversation_detail_payload": "_serialization",
    "_serialize_conversation_members": "_serialization",
    "_serialize_conversation": "_serialization",
    "_collect_message_payload_user_ids": "_serialization",
    "_serialize_message": "_serialization",
    "_get_message_action_card": "_serialization",
    "_build_conversation_message_preview": "_serialization",
    "_build_reply_previews": "_serialization",
    "_build_forward_previews": "_serialization",
    "_build_message_search_haystack": "_serialization",
    "_build_message_payload_for_members": "_serialization",
    # upload orchestrator
    "_upload_session_dir": "_upload_orchestrator",
    "_upload_session_manifest_path": "_upload_orchestrator",
    "_upload_session_part_path": "_upload_orchestrator",
    "_normalize_transfer_encoding": "_upload_orchestrator",
    "create_upload_session": "_upload_orchestrator",
    "get_upload_session": "_upload_orchestrator",
    "complete_upload_session": "_upload_orchestrator",
    "cancel_upload_session": "_upload_orchestrator",
    "send_files": "_upload_orchestrator",
    "_prepare_uploads": "_upload_orchestrator",
    # delivery state wrappers use module functions - handled separately
}


def _method_bounds(lines: list[str], name: str) -> tuple[int, int]:
    pat = re.compile(rf"^    def {re.escape(name)}\(")
    start = next(i for i, line in enumerate(lines) if pat.match(line))
    end = len(lines)
    for j in range(start + 1, len(lines)):
        if lines[j].startswith("    def ") or lines[j].startswith("chat_service"):
            end = j
            break
    return start, end


def _format_call(name: str, chunk: list[str]) -> str:
    cleaned = [line for line in chunk if line.strip() != "@staticmethod"]
    source = "class X:\n" + "\n".join(cleaned)
    tree = ast.parse(source)
    func = tree.body[0].body[0]
    assert isinstance(func, ast.FunctionDef)
    parts: list[str] = []
    for arg in func.args.args[1:]:
        parts.append(arg.arg)
    for arg, default in zip(func.args.kwonlyargs, func.args.kw_defaults or []):
        parts.append(f"{arg.arg}={arg.arg}")
    call = f"self.{DELEGATE_TARGETS[name]}.{name}({', '.join(parts)})"
    if name in {"send_files", "create_upload_session", "get_upload_session", "complete_upload_session", "cancel_upload_session"}:
        return "        self._ensure_available()\n        " + f"return {call}"
    return f"        return {call}"


def replace_method(text: str, name: str) -> str:
    lines = text.splitlines()
    start, end = _method_bounds(lines, name)
    chunk = lines[start:end]
    while chunk and (not chunk[-1].strip() or chunk[-1].strip().startswith("@")):
        chunk.pop()
    sig_end = 1
    balance = 0
    started = False
    for i, line in enumerate(chunk):
        if "(" in line:
            started = True
        balance += line.count("(") - line.count(")")
        if started and balance == 0 and line.rstrip().endswith(":"):
            sig_end = i + 1
            break
    sig_part = chunk[:sig_end]
    delegate_lines = [_format_call(name, chunk)]
    replacement = "\n".join(sig_part + delegate_lines) + "\n"
    return "\n".join(lines[:start] + replacement.splitlines() + lines[end:])


def ensure_init_and_imports(text: str) -> str:
    delivery_delegates = {
        "_get_or_create_conversation_state": "_get_or_create_conversation_state_impl",
        "_mark_sender_message_seen": "_mark_sender_message_seen_impl",
        "_increment_unread_counters_for_recipients": "_increment_unread_counters_for_recipients_impl",
        "_find_existing_client_message": "_find_existing_client_message_impl",
    }
    for method, impl in delivery_delegates.items():
        if f"return {impl}(" in text:
            continue
        lines = text.splitlines()
        try:
            start, end = _method_bounds(lines, method)
        except StopIteration:
            continue
        chunk = [line for line in lines[start:end] if line.strip() != "@staticmethod"]
        source = "class X:\n" + "\n".join(chunk)
        tree = ast.parse(source)
        func = tree.body[0].body[0]
        parts: list[str] = []
        for arg in func.args.args[1:]:
            parts.append(f"{arg.arg}={arg.arg}")
        for arg in func.args.kwonlyargs:
            parts.append(f"{arg.arg}={arg.arg}")
        replacement = "\n".join([chunk[0], f"        return {impl}({', '.join(parts)})", ""])
        text = "\n".join(lines[:start] + replacement.splitlines() + lines[end:])
    return text


def main() -> None:
    text = SERVICE_PATH.read_text(encoding="utf-8")
    text = ensure_init_and_imports(text)
    for name in DELEGATE_TARGETS:
        if f"def {name}(" not in text:
            continue
        if f"self.{DELEGATE_TARGETS[name]}.{name}(" in text:
            continue
        try:
            text = replace_method(text, name)
            print("delegated", name)
        except Exception as exc:
            print("skip", name, exc)
    SERVICE_PATH.write_text(text, encoding="utf-8")
    print("updated", SERVICE_PATH)


if __name__ == "__main__":
    main()
