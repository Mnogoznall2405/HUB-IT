from __future__ import annotations

import asyncio


def windows_selector_loop_factory() -> asyncio.AbstractEventLoop:
    # uvicorn >= 0.36 builds its own loop and ignores the event loop policy. On Windows the
    # default ProactorEventLoop closes the listening socket after a single failed AcceptEx
    # (WinError 64, cpython#93758), leaving the process alive but not accepting connections.
    return asyncio.SelectorEventLoop()
