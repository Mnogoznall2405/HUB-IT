"""The Telegram bot is a single asyncio loop: slow OCR / SQL work must not freeze other chats."""
from __future__ import annotations

import asyncio
import sys
import time
from pathlib import Path
from types import SimpleNamespace

import pytest

PROJECT_ROOT = Path(__file__).resolve().parents[1]
if str(PROJECT_ROOT) not in sys.path:
    sys.path.insert(0, str(PROJECT_ROOT))

from bot.handlers import search as search_handlers  # noqa: E402
from bot.services import ocr_service  # noqa: E402

SLOW_SECONDS = 0.4
MAX_ALLOWED_LOOP_GAP = 0.2


async def _max_loop_gap_during(coro) -> float:
    gaps: list[float] = []
    stop = asyncio.Event()

    async def ticker() -> None:
        last = time.perf_counter()
        while not stop.is_set():
            await asyncio.sleep(0.01)
            now = time.perf_counter()
            gaps.append(now - last)
            last = now

    task = asyncio.create_task(ticker())
    await asyncio.sleep(0.05)
    await coro
    stop.set()
    await task
    return max(gaps)


@pytest.mark.asyncio
async def test_ocr_vision_call_does_not_block_the_event_loop(monkeypatch, tmp_path):
    image = tmp_path / "serial.jpg"
    image.write_bytes(b"\xff\xd8\xff")

    def slow_vision(**_kwargs):
        time.sleep(SLOW_SECONDS)
        return "Серийный номер: ABC123456", {}

    monkeypatch.setattr(ocr_service.openrouter_client, "is_configured", lambda: True)
    monkeypatch.setattr(ocr_service.openrouter_client, "complete_vision", slow_vision)

    gap = await _max_loop_gap_during(ocr_service.analyze_image(str(image)))

    assert gap < MAX_ALLOWED_LOOP_GAP, f"bot event loop was blocked for {gap:.2f}s"


@pytest.mark.asyncio
async def test_equipment_search_sql_lookup_does_not_block_the_event_loop(monkeypatch):
    class _SlowDb:
        def find_by_inventory_number(self, _inv_no):
            return {}

        def find_by_serial_number(self, _serial):
            time.sleep(SLOW_SECONDS)
            return {}

        def close_connection(self):
            pass

    monkeypatch.setattr(search_handlers.database_manager, "create_database_connection", lambda _uid: _SlowDb())
    sent: list[str] = []

    async def reply_text(text, **_kwargs):
        sent.append(text)

    update = SimpleNamespace(
        effective_user=SimpleNamespace(id=1),
        message=SimpleNamespace(text="SN123456789", photo=None, document=None, reply_text=reply_text),
    )

    gap = await _max_loop_gap_during(search_handlers.find_by_serial_input(update, SimpleNamespace()))

    assert any("не найдено" in text for text in sent), sent
    assert gap < MAX_ALLOWED_LOOP_GAP, f"bot event loop was blocked for {gap:.2f}s"
