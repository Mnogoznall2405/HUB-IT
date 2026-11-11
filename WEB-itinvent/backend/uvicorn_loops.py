from __future__ import annotations

import asyncio


def windows_selector_loop_factory() -> asyncio.AbstractEventLoop:
    return asyncio.SelectorEventLoop()
