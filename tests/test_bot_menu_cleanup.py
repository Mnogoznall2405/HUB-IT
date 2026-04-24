#!/usr/bin/env python3
# -*- coding: utf-8 -*-

from pathlib import Path
from unittest.mock import AsyncMock, Mock, patch

import pytest

from bot.config import States


def _build_message_update() -> AsyncMock:
    update = AsyncMock()
    update.effective_user = Mock()
    update.effective_user.id = 123456
    update.message = AsyncMock()
    update.message.reply_text = AsyncMock()
    update.callback_query = None
    return update


def _build_callback_update(callback_data: str) -> AsyncMock:
    update = AsyncMock()
    update.effective_user = Mock()
    update.effective_user.id = 123456
    update.callback_query = AsyncMock()
    update.callback_query.data = callback_data
    update.callback_query.answer = AsyncMock()
    update.callback_query.edit_message_text = AsyncMock()
    update.callback_query.message = Mock()
    update.callback_query.message.chat_id = 999
    update.message = None
    return update


def _build_context() -> AsyncMock:
    context = AsyncMock()
    context.user_data = {}
    context.bot = AsyncMock()
    return context


def _extract_callback_data(reply_markup) -> list[str]:
    return [
        button.callback_data
        for row in reply_markup.inline_keyboard
        for button in row
    ]


@pytest.mark.asyncio
async def test_work_menu_has_no_mfu_button():
    from bot.handlers.work import start_work

    update = _build_message_update()
    context = _build_context()

    with patch("bot.utils.decorators.check_user_access", new=AsyncMock(return_value=True)):
        result = await start_work(update, context)

    assert result == States.WORK_TYPE_SELECTION
    reply_markup = update.message.reply_text.call_args.kwargs["reply_markup"]
    callback_data = _extract_callback_data(reply_markup)

    assert "work:cartridge" not in callback_data
    assert callback_data == [
        "work:battery_replacement",
        "work:component_replacement",
        "work:pc_cleaning",
        "back_to_main",
    ]


@pytest.mark.asyncio
async def test_export_menu_has_no_mfu_export():
    from bot.handlers.export import show_export_menu

    update = _build_message_update()
    context = _build_context()

    with patch("bot.utils.decorators.check_user_access", new=AsyncMock(return_value=True)):
        result = await show_export_menu(update, context)

    assert result == States.DB_SELECTION_MENU
    reply_markup = update.message.reply_text.call_args.kwargs["reply_markup"]
    callback_data = _extract_callback_data(reply_markup)

    assert "export_type:cartridges" not in callback_data
    assert callback_data == [
        "export_type:unfound",
        "export_type:transfers",
        "export_type:battery",
        "export_type:pc_cleaning",
        "export_type:pc_components",
        "back_to_main",
    ]


@pytest.mark.asyncio
async def test_stale_work_cartridge_callback_is_rejected():
    from bot.handlers.work import handle_work_type

    update = _build_callback_update("work:cartridge")
    context = _build_context()

    result = await handle_work_type(update, context)

    assert result == States.WORK_TYPE_SELECTION
    update.callback_query.edit_message_text.assert_called_once()
    message_text = update.callback_query.edit_message_text.call_args.args[0]
    assert "больше недоступна" in message_text


@pytest.mark.asyncio
async def test_stale_export_cartridges_callback_is_rejected():
    from bot.handlers.export import handle_export_type

    update = _build_callback_update("export_type:cartridges")
    context = _build_context()

    result = await handle_export_type(update, context)

    assert result == States.DB_SELECTION_MENU
    update.callback_query.edit_message_text.assert_called_once()
    message_text = update.callback_query.edit_message_text.call_args.args[0]
    assert "больше недоступен" in message_text


def test_main_handler_source_has_no_work_cartridge_route():
    source = Path("bot/main.py").read_text(encoding="utf-8")

    assert "work:cartridge" not in source
