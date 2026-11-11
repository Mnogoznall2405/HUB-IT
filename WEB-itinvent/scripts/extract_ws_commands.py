"""Extract websocket command dispatch from ws.py to backend.chat.ws_commands."""
from __future__ import annotations

from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
WS = ROOT / "backend" / "api" / "v1" / "chat" / "ws.py"
OUT = ROOT / "backend" / "chat" / "ws_commands.py"

START = "            try:"
END = "            except Exception as exc:"


def main() -> None:
    lines = WS.read_text(encoding="utf-8").splitlines()
    start = next(i for i, l in enumerate(lines) if l.strip() == "try:" and "message_type == \"chat.subscribe_inbox\"" in lines[i + 2])
    # find inner try before subscribe_inbox
    for i, line in enumerate(lines):
        if line.strip() == "try:" and i + 2 < len(lines) and 'message_type == "chat.subscribe_inbox"' in lines[i + 2]:
            start = i
            break
    end = next(i for i, l in enumerate(lines) if l.strip() == "except Exception as exc:" and i > start)
    chunk = lines[start + 1 : end]
    dedented = []
    for line in chunk:
        if line.startswith("                "):
            dedented.append(line[4:])
        elif line.startswith("            "):
            dedented.append(line[4:])
        else:
            dedented.append(line)
    header = '''"""WebSocket command dispatch for chat."""
from __future__ import annotations

import asyncio
import time
from typing import Any, Optional

from fastapi import HTTPException
from fastapi.concurrency import run_in_threadpool

from backend.api.deps import assert_access_token_still_valid, ensure_user_permission
from backend.models.auth import User
from backend.services.authorization_service import PERM_CHAT_READ, PERM_CHAT_WRITE


def _api():
    from backend.api.v1.chat._shim import chat_api

    return chat_api()


async def dispatch_chat_ws_command(
    *,
    current_user: User,
    connection_id: str,
    websocket,
    message_type: str,
    request_id: Optional[str],
    conversation_id: Optional[str],
    payload: dict[str, Any],
    ws_access_token: str,
    ws_token_check_counter: int,
    last_token_check_at: float,
) -> tuple[bool, int, float]:
    """Handle one WS command. Returns (should_continue, token_counter, last_token_check_at)."""
    chat_api = _api()
'''
    footer = "\n    return True, ws_token_check_counter, last_token_check_at\n"
    body = "\n".join(dedented)
    body = body.replace("chat_api()", "chat_api")
    OUT.write_text(header + body + footer, encoding="utf-8")
    print("wrote", OUT, "lines", len(dedented))


if __name__ == "__main__":
    main()
