"""DBOT-01: the work flow must not run for users without bot access, at any step."""
from unittest.mock import AsyncMock, Mock

import pytest
from telegram.ext import ConversationHandler

from bot.config import Messages


def _message_update(text="Работы"):
    update = Mock()
    update.effective_user = Mock(id=424242)
    update.message = Mock(text=text, reply_text=AsyncMock())
    update.callback_query = None
    return update


def _callback_update(data):
    update = Mock()
    update.effective_user = Mock(id=424242)
    update.message = None
    update.callback_query = Mock(data=data, answer=AsyncMock(), edit_message_text=AsyncMock())
    return update


def _context():
    context = Mock()
    context.user_data = {"work_type": "battery", "work_equipment": {"ID": 1}}
    context.bot = AsyncMock()
    return context


@pytest.mark.asyncio
async def test_direct_work_text_from_unauthorized_user_starts_nothing(monkeypatch):
    from bot.handlers import work

    monkeypatch.setattr(work, "check_user_access", AsyncMock(return_value=False))
    lookups = Mock()
    monkeypatch.setattr(work.database_manager, "get_user_database", lookups, raising=False)
    update, context = _message_update(), _context()

    result = await work.start_work(update, context)

    assert result == ConversationHandler.END
    update.message.reply_text.assert_awaited_once_with(Messages.ACCESS_DENIED)
    lookups.assert_not_called()
    assert context.user_data == {} or "work_type" not in context.user_data


@pytest.mark.asyncio
async def test_access_revoked_between_preview_and_confirm_blocks_the_write(monkeypatch):
    from bot.handlers import work

    monkeypatch.setattr(work, "check_user_access", AsyncMock(return_value=False))
    writers = {name: AsyncMock(return_value=True) for name in
               ("save_battery_replacement", "save_pc_cleaning", "save_component_replacement_pc")}
    for name, writer in writers.items():
        monkeypatch.setattr(work, name, writer)
    update, context = _callback_update("work_confirm_yes"), _context()

    result = await work.handle_work_confirmation(update, context)

    assert result == ConversationHandler.END
    for writer in writers.values():
        writer.assert_not_awaited()
    update.callback_query.answer.assert_awaited_once()
