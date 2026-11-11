"""Replace ChatService method bodies with thin delegations to split modules."""
from __future__ import annotations

import ast
import textwrap
from pathlib import Path

SERVICE = Path(__file__).resolve().parents[1] / "backend" / "chat" / "service.py"

DELEGATIONS = {
    "create_direct_conversation": "_group_service",
    "get_or_create_notes_conversation": "_group_service",
    "create_group_conversation": "_group_service",
    "add_group_members": "_group_service",
    "remove_group_member": "_group_service",
    "update_group_member_role": "_group_service",
    "transfer_group_ownership": "_group_service",
    "leave_group": "_group_service",
    "update_group_profile": "_group_service",
    "update_group_avatar": "_group_service",
    "get_group_avatar_file_path": "_group_service",
    "get_presence": "_presence_service",
    "_get_presence_map": "_presence_service",
    "_get_users_map": "_presence_service",
    "_serialize_user": "_presence_service",
    "_build_presence_payload": "_presence_service",
    "_build_message_read_receipts": "_presence_service",
    "_mask_database_url": "_presence_service",
    "list_chat_folders": "_folder_service",
    "create_chat_folder": "_folder_service",
    "update_chat_folder": "_folder_service",
    "delete_chat_folder": "_folder_service",
    "get_chat_folder": "_folder_service",
    "set_chat_folder_conversations": "_folder_service",
    "add_chat_folder_conversation": "_folder_service",
    "remove_chat_folder_conversation": "_folder_service",
    "_require_membership": "_membership",
    "_get_active_membership": "_membership",
    "_require_group_membership": "_membership",
    "_require_group_manager": "_membership",
    "_require_group_owner": "_membership",
    "_lock_conversation_for_write": "_membership",
    "_conversation_member_ids": "_membership",
    "_append_system_message": "_membership",
    "_resolve_reply_message": "_membership",
    "_create_chat_notifications": "_notification_orchestrator",
}

PUBLIC_ENSURE = {
    "create_direct_conversation",
    "get_or_create_notes_conversation",
    "create_group_conversation",
    "add_group_members",
    "remove_group_member",
    "update_group_member_role",
    "transfer_group_ownership",
    "leave_group",
    "update_group_profile",
    "update_group_avatar",
    "get_group_avatar_file_path",
    "get_presence",
    "list_chat_folders",
    "create_chat_folder",
    "update_chat_folder",
    "delete_chat_folder",
    "get_chat_folder",
    "set_chat_folder_conversations",
    "add_chat_folder_conversation",
    "remove_chat_folder_conversation",
}


def build_body(name: str, target: str, args: list[str]) -> str:
    call_args = ", ".join(args)
    lines = []
    if name in PUBLIC_ENSURE:
        lines.append("        self._ensure_available()")
    lines.append(f"        return self.{target}.{name}({call_args})")
    return "\n".join(lines) + "\n"


def main() -> None:
    src = SERVICE.read_text(encoding="utf-8")
    lines = src.splitlines(keepends=True)
    tree = ast.parse(src)
    replacements: list[tuple[int, int, str]] = []

    for node in tree.body:
        if not isinstance(node, ast.ClassDef) or node.name != "ChatService":
            continue
        for item in node.body:
            if not isinstance(item, ast.FunctionDef):
                continue
            if item.name not in DELEGATIONS:
                continue
            target = DELEGATIONS[item.name]
            arg_names = [a.arg for a in item.args.args if a.arg != "self"]
            # include keyword-only
            arg_names += [a.arg for a in item.args.kwonlyargs]
            call_parts = []
            for arg in arg_names:
                if arg in item.args.kwonlyargs and any(
                    d is not None for d in item.args.kw_defaults
                ):
                    call_parts.append(f"{arg}={arg}")
                else:
                    call_parts.append(f"{arg}={arg}")
            body = build_body(item.name, target, call_parts)
            replacements.append((item.lineno, item.end_lineno, body))

    replacements.sort(key=lambda x: x[0], reverse=True)
    for start, end, body in replacements:
        # keep def line(s) including decorators
        chunk = "".join(lines[start - 1 : end])
        def_lines = []
        body_start_idx = start - 1
        for i in range(start - 1, end):
            line = lines[i]
            stripped = line.lstrip()
            if stripped.startswith("def ") or stripped.startswith("@"):
                def_lines.append(line)
                body_start_idx = i + 1
            elif stripped.startswith('"""') or stripped.startswith("'''"):
                def_lines.append(line)
                body_start_idx = i + 1
            else:
                break
        new_chunk = "".join(def_lines) + body
        lines[start - 1 : end] = [new_chunk]

    SERVICE.write_text("".join(lines), encoding="utf-8")
    print(f"Replaced {len(replacements)} methods with delegations")


if __name__ == "__main__":
    main()
