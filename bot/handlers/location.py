#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
Универсальные обработчики для выбора локации с пагинацией (transfer и др.).
"""
import logging
from telegram import Update, InlineKeyboardMarkup, InlineKeyboardButton
from telegram.ext import ContextTypes

from bot.config import States
from bot.utils.pagination import PaginationHandler

logger = logging.getLogger(__name__)

_transfer_location_pagination_handler = PaginationHandler(
    page_key='transfer_location_page',
    items_key='transfer_location_suggestions',
    items_per_page=8,
    callback_prefix='transfer_location'
)

_PAGINATION_HANDLERS = {
    'transfer': _transfer_location_pagination_handler,
}

_NAVIGATION_RETURN_STATES = {
    'transfer': States.TRANSFER_NEW_LOCATION,
}


async def handle_location_navigation_universal(
    update: Update,
    context: ContextTypes.DEFAULT_TYPE,
    mode: str
) -> int:
    """Универсальный обработчик навигации по страницам локаций."""
    query = update.callback_query

    pagination_handler = _PAGINATION_HANDLERS.get(mode)
    return_state = _NAVIGATION_RETURN_STATES.get(mode)

    if not pagination_handler or return_state is None:
        logger.warning(f"Неизвестный режим навигации: {mode}")
        return None

    callback_prefix = pagination_handler.callback_prefix
    data = query.data
    direction = None

    if data == f'{callback_prefix}_prev':
        direction = 'prev'
    elif data == f'{callback_prefix}_next':
        direction = 'next'

    if direction is None:
        return None

    pagination_handler.handle_navigation(update, context, direction)

    branch_key = f'{mode}_location_branch'
    branch = context.user_data.get(branch_key, '')

    await show_location_buttons(
        message=query.message,
        context=context,
        mode=mode,
        branch=branch,
        query=query
    )

    return return_state


async def show_location_buttons(message, context, mode='transfer', branch='', query=None):
    """Показывает кнопки выбора локации для выбранного филиала с пагинацией."""
    from bot.services.suggestions import get_locations_by_branch

    try:
        user_id = getattr(context, '_user_id', None)

        if not user_id:
            logger.warning("user_id не найден в context для show_location_buttons")
            text = "📍 Введите локацию (необязательно):"
            if query:
                await query.edit_message_text(text)
            else:
                await message.reply_text(text)
            return

        locations = get_locations_by_branch(user_id, branch)

        if not locations:
            text = "📍 Введите локацию (необязательно):"
            if query:
                await query.edit_message_text(text)
            else:
                await message.reply_text(text)
            return

        pagination_handler = _PAGINATION_HANDLERS.get(mode)
        if pagination_handler:
            pagination_handler.set_items(context, locations)
        else:
            context.user_data[f'{mode}_location_suggestions'] = locations

        context.user_data[f'{mode}_location_branch'] = branch

        if pagination_handler:
            page_locations, current_page, total_pages, has_prev, has_next = pagination_handler.get_page_data(context)
            start_idx = current_page * pagination_handler.items_per_page
        else:
            current_page = context.user_data.get(f'{mode}_location_page', 0)
            items_per_page = 8
            total_pages = (len(locations) + items_per_page - 1) // items_per_page
            start_idx = current_page * items_per_page
            end_idx = start_idx + items_per_page
            page_locations = locations[start_idx:end_idx]

        keyboard = []
        for idx, loc in enumerate(page_locations):
            global_idx = start_idx + idx
            keyboard.append([InlineKeyboardButton(
                f"📍 {loc}",
                callback_data=f"{mode}_location:{global_idx}"
            )])

        nav_buttons = []
        if current_page > 0:
            nav_buttons.append(InlineKeyboardButton("◀️ Назад", callback_data=f"{mode}_location_prev"))

        if total_pages > 1:
            nav_buttons.append(InlineKeyboardButton(
                f"📄 {current_page + 1}/{total_pages}",
                callback_data=f"{mode}_location_page_info"
            ))

        if current_page < total_pages - 1:
            nav_buttons.append(InlineKeyboardButton("Вперед ▶️", callback_data=f"{mode}_location_next"))

        if nav_buttons:
            keyboard.append(nav_buttons)

        keyboard.append([InlineKeyboardButton(
            "⌨️ Ввести вручную",
            callback_data=f"{mode}_location:manual"
        )])

        reply_markup = InlineKeyboardMarkup(keyboard)
        text = f"📊 Выберите локацию для филиала <b>{branch}</b>:"

        if query:
            await query.edit_message_text(text, parse_mode='HTML', reply_markup=reply_markup)
        else:
            await message.reply_text(text, parse_mode='HTML', reply_markup=reply_markup)

    except Exception as e:
        logger.error(f"Ошибка в show_location_buttons: {e}")


__all__ = [
    'PaginationHandler',
    '_transfer_location_pagination_handler',
    'handle_location_navigation_universal',
    'show_location_buttons',
]
