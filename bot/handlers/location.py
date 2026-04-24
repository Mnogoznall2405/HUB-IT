#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
Универсальные обработчики для выбора локации с пагинацией

Модуль содержит переиспользуемые компоненты для работы с локациями:
- PaginationHandler для разных режимов
- Универсальная функция показа кнопок локаций
- Универсальный обработчик навигации
"""
import logging
from telegram import Update, InlineKeyboardMarkup, InlineKeyboardButton
from telegram.ext import ContextTypes

from bot.config import States
from bot.utils.pagination import PaginationHandler

logger = logging.getLogger(__name__)


# ============================ ОБРАБОТЧИКИ ПАГИНАЦИИ ============================

# Обработчик для пагинации локаций в unfound
_unfound_location_pagination_handler = PaginationHandler(
    page_key='unfound_location_page',
    items_key='unfound_location_suggestions',
    items_per_page=8,
    callback_prefix='unfound_location'
)

# Обработчик для пагинации локаций в transfer
_transfer_location_pagination_handler = PaginationHandler(
    page_key='transfer_location_page',
    items_key='transfer_location_suggestions',
    items_per_page=8,
    callback_prefix='transfer_location'
)

# Обработчик для пагинации локаций в work
# Словарь обработчиков пагинации по режимам
_PAGINATION_HANDLERS = {
    'unfound': _unfound_location_pagination_handler,
    'transfer': _transfer_location_pagination_handler,
}

# Словарь состояний для возврата после навигации
_NAVIGATION_RETURN_STATES = {
    'unfound': States.UNFOUND_LOCATION_INPUT,
    'transfer': States.TRANSFER_NEW_LOCATION,
}


# ============================ УНИВЕРСАЛЬНЫЕ ОБРАБОТЧИКИ ============================

async def handle_location_navigation_universal(
    update: Update,
    context: ContextTypes.DEFAULT_TYPE,
    mode: str
) -> int:
    """
    Универсальный обработчик навигации по страницам локаций.

    Параметры:
        update: Объект обновления от Telegram API
        context: Контекст выполнения
        mode: Режим работы ('unfound', 'transfer', и т.д.)

    Возвращает:
        int: Следующее состояние или None если действие не обработано
    """
    query = update.callback_query

    # Получаем обработчик и состояние для режима
    pagination_handler = _PAGINATION_HANDLERS.get(mode)
    return_state = _NAVIGATION_RETURN_STATES.get(mode)

    if not pagination_handler or return_state is None:
        logger.warning(f"Неизвестный режим навигации: {mode}")
        return None

    # Определяем префикс callback данных
    callback_prefix = pagination_handler.callback_prefix

    # Проверяем callback данные
    data = query.data
    direction = None

    if data == f'{callback_prefix}_prev':
        direction = 'prev'
    elif data == f'{callback_prefix}_next':
        direction = 'next'

    if direction is None:
        # Это не кнопка навигации, выходим
        return None

    # Выполняем навигацию
    pagination_handler.handle_navigation(update, context, direction)

    # Получаем ветку и обновляем отображение
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


async def show_location_buttons(message, context, mode='unfound', branch='', query=None):
    """
    Показывает кнопки выбора локации для выбранного филиала с пагинацией

    Параметры:
        message: Объект Message или CallbackQuery.message
        context: Контекст выполнения
        mode: Режим работы ('unfound', 'transfer', и т.д.)
        branch: Выбранный филиал
        query: Объект CallbackQuery (опционально, для редактирования сообщения)
    """
    from bot.services.suggestions import get_locations_by_branch

    try:
        # Получаем user_id из context
        user_id = getattr(context, '_user_id', None)

        if not user_id:
            logger.warning("user_id не найден в context для show_location_buttons")
            text = "📍 Введите локацию (необязательно):"
            if query:
                await query.edit_message_text(text)
            else:
                await message.reply_text(text)
            return

        # Получаем локации из БД для выбранного филиала
        locations = get_locations_by_branch(user_id, branch)

        if not locations:
            # Если локации не получены, просим ввести вручную
            text = "📍 Введите локацию (необязательно):"
            if query:
                await query.edit_message_text(text)
            else:
                await message.reply_text(text)
            return

        # Сохраняем полный список локаций через PaginationHandler
        if mode == 'unfound':
            _unfound_location_pagination_handler.set_items(context, locations)
        elif mode == 'transfer':
            _transfer_location_pagination_handler.set_items(context, locations)
        else:
            # Для других modes используем старый метод
            context.user_data[f'{mode}_location_suggestions'] = locations

        # Сохраняем branch для навигации
        context.user_data[f'{mode}_location_branch'] = branch

        # Пагинация - получаем данные через PaginationHandler
        if mode == 'unfound':
            page_locations, current_page, total_pages, has_prev, has_next = _unfound_location_pagination_handler.get_page_data(context)
            start_idx = current_page * _unfound_location_pagination_handler.items_per_page
        elif mode == 'transfer':
            page_locations, current_page, total_pages, has_prev, has_next = _transfer_location_pagination_handler.get_page_data(context)
            start_idx = current_page * _transfer_location_pagination_handler.items_per_page
        else:
            # Старый метод для других modes
            current_page = context.user_data.get(f'{mode}_location_page', 0)
            items_per_page = 8
            total_pages = (len(locations) + items_per_page - 1) // items_per_page
            start_idx = current_page * items_per_page
            end_idx = start_idx + items_per_page
            page_locations = locations[start_idx:end_idx]

        keyboard = []
        for idx, loc in enumerate(page_locations):
            global_idx = start_idx + idx  # Глобальный индекс в полном списке
            keyboard.append([InlineKeyboardButton(
                f"📍 {loc}",
                callback_data=f"{mode}_location:{global_idx}"
            )])

        # Навигация
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

        # Для transfer и work используем "Ввести вручную", для остальных "Пропустить"
        if mode == 'transfer':
            keyboard.append([InlineKeyboardButton(
                "⌨️ Ввести вручную",
                callback_data=f"{mode}_location:manual"
            )])
        else:
            keyboard.append([InlineKeyboardButton(
                "⏭️ Пропустить",
                callback_data="skip_location"
            )])

        reply_markup = InlineKeyboardMarkup(keyboard)
        text = f"📊 Выберите локацию для филиала <b>{branch}</b>:"

        # Используем query.edit_message_text если передан query, иначе message.reply_text
        if query:
            await query.edit_message_text(text, parse_mode='HTML', reply_markup=reply_markup)
        else:
            await message.reply_text(text, parse_mode='HTML', reply_markup=reply_markup)

    except Exception as e:
        logger.error(f"Ошибка в show_location_buttons: {e}")


# ============================ ЭКСПОРТЫ ДЛЯ ИСПОЛЬЗОВАНИЯ В ДРУГИХ МОДУЛЯХ ============================

__all__ = [
    'PaginationHandler',
    '_unfound_location_pagination_handler',
    '_transfer_location_pagination_handler',
    'handle_location_navigation_universal',
    'show_location_buttons',
]
