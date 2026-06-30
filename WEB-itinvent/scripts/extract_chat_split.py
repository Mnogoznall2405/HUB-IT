"""One-off helper: extract ChatService methods into split modules."""
from __future__ import annotations

import ast
import re
import textwrap
from pathlib import Path

SERVICE_PATH = Path(__file__).resolve().parents[1] / "backend" / "chat" / "service.py"
CHAT_DIR = SERVICE_PATH.parent


def extract_methods(source: str, method_names: set[str]) -> dict[str, str]:
    tree = ast.parse(source)
    lines = source.splitlines(keepends=True)
    result: dict[str, str] = {}
    for node in tree.body:
        if not isinstance(node, ast.ClassDef) or node.name != "ChatService":
            continue
        for item in node.body:
            if not isinstance(item, (ast.FunctionDef, ast.AsyncFunctionDef)):
                continue
            if item.name not in method_names:
                continue
            start = item.lineno - 1
            end = item.end_lineno
            body = "".join(lines[start:end])
            result[item.name] = body
    return result


def method_to_store(body: str, *, indent: str = "    ") -> str:
    """Convert ChatService method to store method (self -> self._service for service calls)."""
    lines = body.splitlines()
    if not lines:
        return ""
    # Drop decorators if any
    while lines and lines[0].strip().startswith("@"):
        lines.pop(0)
    # Replace def line: keep name, fix self
    def_line = lines[0]
    m = re.match(r"(\s*)def\s+(\w+)\s*\(", def_line)
    if not m:
        raise ValueError(f"Bad def line: {def_line!r}")
    name = m.group(2)
    # Re-indent body as store method
    raw_body = "\n".join(lines[1:])
    # self._ensure_available() -> delegate to service
    raw_body = raw_body.replace("self._ensure_available()", "self._service._ensure_available()")
    # Most other self. calls stay as self._service.
    # But we're IN the store, so self. without _service should map to _service
    converted_lines = []
    for line in raw_body.splitlines():
        stripped = line.lstrip()
        if not stripped:
            converted_lines.append("")
            continue
        lead = line[: len(line) - len(stripped)]
        # Replace self.X with self._service.X except self._service
        new = re.sub(r"\bself\.(?!_service\b)", "self._service.", stripped)
        converted_lines.append(lead + new)
    return f"{indent}def {name}{def_line[def_line.index('('):]}\n" + "\n".join(converted_lines)


def main() -> None:
    source = SERVICE_PATH.read_text(encoding="utf-8")
    thread_methods = {
        "get_messages",
        "get_thread_bootstrap",
        "search_messages",
        "get_message",
        "get_message_reads",
        "get_message_read_delta",
        "get_messages_for_users",
        "_serialize_thread_messages_payload",
    }
    conv_methods = {
        "get_conversation",
        "get_conversation_summaries_for_users",
        "get_conversation_assets_summary",
        "list_conversation_attachments",
    }
    extracted = extract_methods(source, thread_methods | conv_methods)
    print("Extracted:", sorted(extracted.keys()))
    missing = (thread_methods | conv_methods) - set(extracted.keys())
    if missing:
        print("MISSING:", missing)


if __name__ == "__main__":
    main()
