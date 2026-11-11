"""Runtime access to the chat API package namespace (test monkeypatch compatibility)."""
from __future__ import annotations

import sys


def chat_api():
    return sys.modules["backend.api.v1.chat"]
