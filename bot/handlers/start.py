#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
Обработчики базовых команд: /start, /help, /cancel

Содержит обработчики для начальных команд и справки.
"""

import logging
from telegram import Update, InlineKeyboardMarkup, InlineKeyboardButton
from telegram.ext import ContextTypes, ConversationHandler

from bot.config import Messages
from bot.utils.decorators import require_user_access
from bot.utils.keyboards import create_main_menu_keyboard
from bot.local_json_store import load_json_data, save_json_data

logger = logging.getLogger(__name__)


@require_user_access
async def start(update: Update, context: ContextTypes.DEFAULT_TYPE) -> int:
    """
    Обработчик команды /start - отправляет приветственное сообщение

    Создает главное меню бота с кнопками для выбора режима поиска.
    Сбрасывает все состояния пользователя и завершает все активные ConversationHandler.

    Параметры:
        update: Объект обновления от Telegram API
        context: Контекст выполнения команды

    Возвращает:
        int: ConversationHandler.END для сброса состояний
    """
    user_id = update.effective_user.id

    # Логируем сброс состояния
    logger.info(f"Пользователь {user_id} вызвал /start - сброс всех состояний")

    # Принудительно завершаем все ConversationHandler'ы
    from telegram.ext import ConversationHandler

    # Сбрасываем все состояния пользователя
    context.user_data.clear()

    # Завершаем текущий ConversationHandler если он есть
    if hasattr(context, '_conversations') and context._conversations:
        context._conversations.clear()

    # Дополнительная очистка временных файлов
    import os
    import glob
    for temp_file in glob.glob("temp_transfer_*.jpg"):
        try:
            os.remove(temp_file)
        except:
            pass

    for temp_file in glob.glob("temp_*.jpg"):
        try:
            os.remove(temp_file)
        except:
            pass

    # Проверяем: есть ли пользователь в списке назначенных баз
    from bot.database_manager import database_manager
    assigned_db = database_manager.get_user_assigned_database(user_id)

    # Если пользователя нет в базе и он не админ — показываем выбор базы
    if not assigned_db and not database_manager.is_admin_user(user_id):
        await show_database_selection(update, context, user_id)
        return ConversationHandler.END

    # Получаем текущую БД пользователя
    current_db = database_manager.get_user_database(user_id)

    # Отправляем приветственное сообщение с главным меню
    welcome_text = (
        f"{Messages.MAIN_MENU}\n\n"
        f"📊 <b>Текущая база данных:</b> {current_db}"
    )

    await update.message.reply_text(
        welcome_text,
        parse_mode='HTML',
        reply_markup=create_main_menu_keyboard()
    )
    
    # Возвращаем END для завершения любых активных ConversationHandler
    return ConversationHandler.END


async def show_database_selection(update: Update, context: ContextTypes.DEFAULT_TYPE, user_id: int) -> None:
    """
    Показывает кнопки выбора базы данных для нового пользователя

    Параметры:
        update: Объект обновления от Telegram API
        context: Контекст выполнения команды
        user_id: ID пользователя Telegram
    """
    from bot.database_manager import database_manager

    # Получаем список доступных баз
    databases = database_manager.get_available_database_info()

    keyboard = []
    for db_info in databases:
        keyboard.append([InlineKeyboardButton(
            f"{db_info.display_name}",
            callback_data=f"select_db:{db_info.name}"
        )])

    reply_markup = InlineKeyboardMarkup(keyboard)

    await update.message.reply_text(
        "Добро пожаловать!\n\n"
        "Выберите базу данных для работы:",
        reply_markup=reply_markup
    )
    logger.info(f"Пользователю {user_id} показано меню выбора базы данных")


@require_user_access
async def handle_database_selection(update: Update, context: ContextTypes.DEFAULT_TYPE) -> None:
    """
    Обработчик выбора базы данных для нового пользователя

    Параметры:
        update: Объект обновления от Telegram API
        context: Контекст выполнения команды
    """
    from bot.database_manager import database_manager
    query = update.callback_query
    await query.answer()

    user_id = update.effective_user.id
    data = query.data

    if data.startswith('select_db:'):
        db_name = data.split(':', 1)[1]

        # Сохраняем выбор в user_db_selection.json
        data = load_json_data(database_manager.user_selection_name, default_content={})
        if not isinstance(data, dict):
            data = {}
        data[str(user_id)] = db_name
        save_json_data(database_manager.user_selection_name, data)

        # Обновляем в памяти
        database_manager.user_assigned_db[user_id] = db_name
        database_manager.user_selected_db[user_id] = db_name

        await query.edit_message_text(
            f"✅ Выбрана база данных: {db_name}\n\n"
            f"Теперь нажмите /start для начала работы"
        )
        logger.info(f"Пользователь {user_id} выбрал базу данных: {db_name}")


@require_user_access
async def help_command(update: Update, context: ContextTypes.DEFAULT_TYPE) -> None:
    """
    Обработчик команды /help - отправляет справочную информацию

    Предоставляет пользователю подробную информацию о функциях бота,
    доступных командах и инструкции по использованию.

    Параметры:
        update: Объект обновления от Telegram API
        context: Контекст выполнения команды
    """
    help_text = """
🤖 <b>Справка по работе с IT-invent Bot</b>

<b>📋 Основные возможности:</b>

🔎 <b>Поиск оборудования</b>
• По серийному номеру вручную или по фото
• По сотруднику с подсказками
• По типу оборудования, филиалу и локации

📦 <b>Перемещение оборудования</b>
• Распознавание серийных номеров по нескольким фото
• Выбор нового сотрудника с подсказками
• Формирование акта приема-передачи
• Отправка документов в чат или по email

<b>🔧 Работы и обслуживание:</b>
• 🔋 Замена батареи ИБП
• 🖥️ Замена компонентов ПК
• 🧹 Чистка ПК

<b>📊 Экспорт данных:</b>
• 📦 Ненайденное оборудование
• 🔄 Перемещения оборудования
• 🔋 Замены батареи ИБП
• 🧹 Чистка ПК
• 💾 Замены компонентов ПК
• 📤 Полный экспорт базы данных

<b>🗄️ Управление базами данных:</b>
• Переключение между базами данных
• Просмотр статистики по базе
• Экспорт выбранной базы в Excel

<b>⚙️ Команды:</b>
/start — главное меню и сброс текущего сценария
/help — эта справка
/cancel — отмена текущего действия

<b>💡 Советы:</b>
• Для OCR отправляйте четкие и хорошо освещенные фото
• Для возврата в главное меню используйте /start
• Все работы и перемещения сохраняются автоматически

<b>🔐 Доступ:</b>
Бот доступен только пользователям из разрешенной Telegram-группы и списка разрешенных пользователей.
    """

    await update.message.reply_text(help_text, parse_mode='HTML')


async def cancel(update: Update, context: ContextTypes.DEFAULT_TYPE) -> int:
    """
    Обработчик команды /cancel - отменяет текущую операцию
    
    Очищает временные данные и возвращает пользователя в главное меню.
    
    Параметры:
        update: Объект обновления от Telegram API
        context: Контекст выполнения
        
    Возвращает:
        int: ConversationHandler.END
    """
    # Очищаем временные данные
    from bot.config import StorageKeys
    
    temp_keys = [
        StorageKeys.TEMP_PHOTOS,
        StorageKeys.TEMP_SERIALS,
        StorageKeys.UNFOUND_DATA,
        StorageKeys.TRANSFER_DATA,
        StorageKeys.DB_VIEW_RESULTS,
        StorageKeys.DB_VIEW_PAGE
    ]
    
    for key in temp_keys:
        context.user_data.pop(key, None)
    
    # Отправляем сообщение об отмене
    await update.message.reply_text(
        "❌ Операция отменена.\n\n" + Messages.MAIN_MENU,
        reply_markup=create_main_menu_keyboard()
    )
    
    logger.info(f"Пользователь {update.effective_user.id} отменил операцию")
    
    return ConversationHandler.END



async def return_to_main_menu(update: Update, context: ContextTypes.DEFAULT_TYPE) -> None:
    """
    Возвращает пользователя в главное меню
    
    Отправляет главное меню с информацией о текущей базе данных.
    Может быть вызвана как из обычного сообщения, так и из callback query.
    
    Параметры:
        update: Объект обновления от Telegram API
        context: Контекст выполнения
    """
    from bot.database_manager import database_manager
    
    user_id = update.effective_user.id
    current_db = database_manager.get_user_database(user_id)
    
    menu_text = (
        f"{Messages.MAIN_MENU}\n\n"
        f"📊 <b>Текущая база данных:</b> {current_db}"
    )
    
    # Определяем, откуда пришел вызов
    if update.callback_query:
        # Если из callback query, отправляем новое сообщение
        await update.callback_query.message.reply_text(
            menu_text,
            parse_mode='HTML',
            reply_markup=create_main_menu_keyboard()
        )
    elif update.message:
        # Если из обычного сообщения
        await update.message.reply_text(
            menu_text,
            parse_mode='HTML',
            reply_markup=create_main_menu_keyboard()
        )
    else:
        # Fallback - отправляем через bot
        await context.bot.send_message(
            chat_id=user_id,
            text=menu_text,
            parse_mode='HTML',
            reply_markup=create_main_menu_keyboard()
        )
