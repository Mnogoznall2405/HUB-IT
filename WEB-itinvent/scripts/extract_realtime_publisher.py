"""Move chat realtime publish helpers from API _common to backend.chat."""
from __future__ import annotations

import re
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
COMMON = ROOT / "backend" / "api" / "v1" / "chat" / "_common.py"
OUT = ROOT / "backend" / "chat" / "realtime_publisher.py"

START_MARKERS = (
    "async def _publish_unread_summary",
    "async def _get_unread_summaries",
    "async def _get_conversation_updates_for_users",
)
END_MARKER = "async def _publish_presence_updated"


def main() -> None:
    lines = COMMON.read_text(encoding="utf-8").splitlines()
    start = next(i for i, l in enumerate(lines) if l.startswith(START_MARKERS[0]))
    end = next(i for i, l in enumerate(lines) if l.startswith(END_MARKER))
    end_body = end
    for j in range(end + 1, len(lines)):
        if lines[j].startswith("# Backward-compatible alias"):
            end_body = j
            break
    chunk = lines[start:end_body]
    body = []
    for line in chunk:
        text = line.replace("_pkg()._run_chat_call", "_run_chat_call")
        text = text.replace("_chat_service()", "_chat_service")
        text = text.replace("_chat_realtime()", "_chat_realtime")
        body.append(text)
    header = '''"""Realtime inbox publish orchestration for chat events."""
from __future__ import annotations

import asyncio
import time
from typing import Any, Optional


def _api_common():
    from backend.api.v1.chat import _common as common

    return common


def _pkg():
    return _api_common()._pkg()


def _chat_service():
    return _api_common()._chat_service()


def _chat_realtime():
    return _api_common()._chat_realtime()


async def _run_chat_call(func, /, **kwargs):
    return await _pkg()._run_chat_call(func, **kwargs)


def _log_request_timing(route_name: str, request_id: str, started_at: float, **context: Any) -> None:
    _api_common()._log_request_timing(route_name, request_id, started_at, **context)


'''
    OUT.write_text(header + "\n".join(body).rstrip() + "\n", encoding="utf-8")
    replacement = (
        "from backend.chat.realtime_publisher import (  # noqa: F401\n"
        "    _get_conversation_updates_for_users,\n"
        "    _get_unread_summaries,\n"
        "    _publish_conversation_updated,\n"
        "    _publish_deleted_conversation,\n"
        "    _publish_group_conversation_change,\n"
        "    _publish_message_created,\n"
        "    _publish_message_created_after_send,\n"
        "    _publish_message_deleted,\n"
        "    _publish_message_deleted_after_soft_delete,\n"
        "    _publish_message_read,\n"
        "    _publish_message_read_after_mark_read,\n"
        "    _publish_message_updated,\n"
        "    _publish_message_updated_after_edit,\n"
        "    _publish_presence_updated,\n"
        "    _publish_unread_summary,\n"
        ")\n\n"
    )
    new_common = "\n".join(lines[:start]) + "\n\n" + replacement + "\n".join(lines[end_body:])
    COMMON.write_text(new_common, encoding="utf-8")
    print("wrote", OUT)


if __name__ == "__main__":
    main()
