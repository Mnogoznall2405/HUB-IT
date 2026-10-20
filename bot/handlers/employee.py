#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
Обработчики поиска оборудования по сотруднику
Содержит функции для поиска всего оборудования, закрепленного за сотрудником.
"""
import asyncio
import logging
import os
from telegram import Update, ReplyKeyboardRemove, InlineKeyboardMarkup, InlineKeyboardButton
from telegram.ext import ContextTypes, ConversationHandler

from bot.config import States, Messages, StorageKeys, PaginationConfig
from bot.utils.decorators import require_user_access, handle_errors
from bot.utils.formatters import format_equipment_info
from bot.utils.pagination import paginate_results, PaginationHandler
from bot.services.validation import validate_employee_name
from bot.database_manager import database_manager

logger = logging.getLogger(__name__)


# ============================ ОБРАБОТЧИК ПАГИНАЦИИ ============================

# Обработчик для пагинации оборудования сотрудника
_employee_pagination_handler = PaginationHandler(
    page_key=StorageKeys.DB_VIEW_PAGE,
    items_key=StorageKeys.DB_VIEW_RESULTS,
    items_per_page=PaginationConfig().employee_items_per_page,
    callback_prefix='emp'
)


@require_user_access
async def ask_find_by_employee(update: Update, context: ContextTypes.DEFAULT_TYPE) -> int:
    """
    Обработчик запроса поиска по сотруднику
    
    Переводит бота в режим ожидания ввода ФИО сотрудника.
    
    Параметры:
        update: Объект обновления от Telegram API
        context: Контекст выполнения
        
    Возвращает:
        int: Состояние FIND_BY_EMPLOYEE_WAIT_INPUT
    """
    await update.message.reply_text(
        "👤 Введите ФИО сотрудника для поиска оборудования.\n\n"
        "💡 Можно вводить частичное имя (например, 'Иванов' или 'Иван').",
        reply_markup=ReplyKeyboardRemove()
    )
    return States.FIND_BY_EMPLOYEE_WAIT_INPUT


@handle_errors
async def find_by_employee_input(update: Update, context: ContextTypes.DEFAULT_TYPE) -> int:
    """
    Обработчик ввода ФИО сотрудника
    
    Обрабатывает текстовый ввод ФИО и ищет все оборудование сотрудника.
    
    Параметры:
        update: Объект обновления от Telegram API
        context: Контекст выполнения
        
    Возвращает:
        int: States.EMPLOYEE_PAGINATION или ConversationHandler.END
    """
    if not update.message.text:
        await update.message.reply_text("❌ Введите ФИО сотрудника.")
        return ConversationHandler.END
    
    employee_name = update.message.text.strip()
    
    # Показываем подсказки если есть совпадения
    from bot.handlers.suggestions_handler import show_employee_suggestions
    
    if await show_employee_suggestions(
        update, context, employee_name,
        mode='employee_search',
        pending_key='pending_employee_search_input',
        suggestions_key='employee_search_suggestions'
    ):
        return States.FIND_BY_EMPLOYEE_WAIT_INPUT
    
    # Валидация ФИО
    if not validate_employee_name(employee_name):
        await update.message.reply_text(
            "❌ Некорректный формат ФИО.\n"
            "ФИО должно содержать только буквы, цифры и пробелы."
        )
        return ConversationHandler.END
    
    # Поиск в базе данных
    try:
        user_id = update.effective_user.id
        db = database_manager.create_database_connection(user_id)
        
        if not db:
            await update.message.reply_text("❌ Ошибка подключения к базе данных.")
            return ConversationHandler.END
        
        # Поиск оборудования сотрудника
        equipment_list = await asyncio.to_thread(db.find_by_employee, employee_name)
        
        if not equipment_list:
            await update.message.reply_text(
                f"❌ У сотрудника <b>{employee_name}</b> не найдено оборудования.",
                parse_mode='HTML'
            )
            db.close_connection()
            return ConversationHandler.END
        
        # Сохраняем результаты для пагинации через PaginationHandler
        _employee_pagination_handler.set_items(context, equipment_list)
        _employee_pagination_handler.reset_pagination(context)
        context.user_data['employee_name'] = employee_name
        
        # Отображаем первую страницу
        await show_employee_equipment_page(update, context)
        
        db.close_connection()
        return States.EMPLOYEE_PAGINATION
        
    except Exception as e:
        logger.error(f"Ошибка поиска оборудования сотрудника: {e}")
        await update.message.reply_text(
            "❌ Ошибка при поиске в базе данных. Попробуйте позже."
        )
        return ConversationHandler.END


async def show_employee_equipment_page(update: Update, context: ContextTypes.DEFAULT_TYPE) -> None:
    """
    Отображает страницу с оборудованием сотрудника

    Параметры:
        update: Объект обновления от Telegram API
        context: Контекст выполнения
    """
    equipment_list = _employee_pagination_handler.get_items(context)
    employee_name = context.user_data.get('employee_name', 'Неизвестный')

    # Пагинация через PaginationHandler
    page_items, current_page, total_pages, has_prev, has_next = _employee_pagination_handler.get_page_data(context)

    # Формируем сообщение
    message_lines = [
        f"👤 <b>Сотрудник:</b> {employee_name}",
        f"📋 <b>Найдено единиц:</b> {len(equipment_list)}",
        f"📄 <b>Страница:</b> {current_page + 1} из {total_pages}\n"
    ]

    for i, equipment in enumerate(page_items, 1):
        item_num = current_page * _employee_pagination_handler.items_per_page + i
        message_lines.append(f"<b>{item_num}.</b>")
        message_lines.append(format_equipment_info(equipment))
        message_lines.append("")  # Пустая строка между единицами
    
    message_text = "\n".join(message_lines)
    
    # Создаем клавиатуру навигации
    keyboard = []
    nav_buttons = []
    
    if has_prev:
        nav_buttons.append(InlineKeyboardButton("◀️ Назад", callback_data="emp_prev"))
    
    nav_buttons.append(InlineKeyboardButton(f"📄 {current_page+1}/{total_pages}", callback_data="page_info"))
    
    if has_next:
        nav_buttons.append(InlineKeyboardButton("Вперед ▶️", callback_data="emp_next"))
    
    if nav_buttons:
        keyboard.append(nav_buttons)
    
    # Дополнительные кнопки
    keyboard.extend([
        [InlineKeyboardButton("📤 Экспортировать всё", callback_data="emp_export")],
        [InlineKeyboardButton("🏠 Главное меню", callback_data="back_to_menu")]
    ])
    
    reply_markup = InlineKeyboardMarkup(keyboard)
    
    if update.callback_query:
        await update.callback_query.edit_message_text(
            message_text,
            parse_mode='HTML',
            reply_markup=reply_markup
        )
    else:
        await update.message.reply_text(
            message_text,
            parse_mode='HTML',
            reply_markup=reply_markup
        )


@handle_errors
async def handle_employee_pagination(update: Update, context: ContextTypes.DEFAULT_TYPE) -> int:
    """
    Обрабатывает навигацию по страницам результатов поиска по сотруднику
    
    Параметры:
        update: Объект обновления от Telegram API
        context: Контекст выполнения
        
    Возвращает:
        int: States.EMPLOYEE_PAGINATION или ConversationHandler.END
    """
    query = update.callback_query
    await query.answer()
    
    callback_data = query.data
    
    if callback_data == "emp_prev":
        _employee_pagination_handler.handle_navigation(update, context, 'prev')
        await show_employee_equipment_page(update, context)
        return States.EMPLOYEE_PAGINATION

    elif callback_data == "emp_next":
        _employee_pagination_handler.handle_navigation(update, context, 'next')
        await show_employee_equipment_page(update, context)
        return States.EMPLOYEE_PAGINATION
    
    elif callback_data == "emp_export":
        # Экспорт оборудования сотрудника
        equipment_list = context.user_data.get(StorageKeys.DB_VIEW_RESULTS, [])
        employee_name = context.user_data.get('employee_name', 'Неизвестный')
        
        if not equipment_list:
            await query.edit_message_text("❌ Нет данных для экспорта.")
            return ConversationHandler.END
        
        await query.edit_message_text("⏳ Создание Excel файла...")
        
        # Создаем Excel файл
        excel_path = await export_employee_equipment_to_excel(employee_name, equipment_list, context)
        
        if excel_path:
            # Сохраняем путь к файлу для возможной отправки на email
            context.user_data['export_file'] = excel_path
            context.user_data['export_employee_name'] = employee_name
            
            # Показываем опции доставки
            keyboard = [
                [InlineKeyboardButton("💬 Отправить в чат", callback_data="emp_export_chat")],
                [InlineKeyboardButton("📧 Email сотрудника", callback_data="emp_export_employee_email")],
                [InlineKeyboardButton("📧 Ввести email", callback_data="emp_export_email")],
                [InlineKeyboardButton("🔙 Назад", callback_data="emp_export_back")]
            ]
            reply_markup = InlineKeyboardMarkup(keyboard)
            
            await context.bot.send_message(
                chat_id=query.message.chat_id,
                text=f"✅ Excel файл создан!\n\n"
                     f"📄 Оборудование сотрудника: {employee_name}\n"
                     f"📊 Единиц оборудования: {len(equipment_list)}\n\n"
                     f"Выберите способ доставки:",
                reply_markup=reply_markup
            )
            return States.EMPLOYEE_PAGINATION
        else:
            await context.bot.send_message(
                chat_id=query.message.chat_id,
                text="❌ Ошибка создания Excel файла."
            )
            return ConversationHandler.END
    
    elif callback_data == "back_to_menu":
        from bot.utils.keyboards import create_main_menu_keyboard
        await query.edit_message_text("✅ Возврат в главное меню")
        await context.bot.send_message(
            chat_id=query.message.chat_id,
            text=Messages.MAIN_MENU,
            reply_markup=create_main_menu_keyboard()
        )
        return ConversationHandler.END
    
    elif callback_data == "page_info":
        # Информационная кнопка, ничего не делаем
        return States.EMPLOYEE_PAGINATION
    
    return States.EMPLOYEE_PAGINATION


@handle_errors
async def handle_employee_export_delivery(update: Update, context: ContextTypes.DEFAULT_TYPE) -> int:
    """
    Обрабатывает выбор способа доставки экспортированного файла
    
    Параметры:
        update: Объект обновления от Telegram API
        context: Контекст выполнения
        
    Возвращает:
        int: Следующее состояние
    """
    query = update.callback_query
    await query.answer()
    
    callback_data = query.data
    
    if callback_data == "emp_export_chat":
        # Отправка в чат
        excel_path = context.user_data.get('export_file')
        employee_name = context.user_data.get('export_employee_name', 'Неизвестный')
        
        if excel_path and os.path.exists(excel_path):
            try:
                with open(excel_path, 'rb') as file:
                    await context.bot.send_document(
                        chat_id=query.message.chat_id,
                        document=file,
                        filename=os.path.basename(excel_path),
                        caption=f"📊 Оборудование сотрудника: {employee_name}"
                    )
                
                await query.edit_message_text("✅ Файл отправлен в чат!")
                
                # Удаляем временный файл
                os.remove(excel_path)
                
            except Exception as e:
                logger.error(f"Ошибка отправки файла: {e}")
                await query.edit_message_text("❌ Ошибка отправки файла.")
        else:
            await query.edit_message_text("❌ Файл не найден.")
        
        return ConversationHandler.END
    
    elif callback_data == "emp_export_employee_email":
        # Отправка на email сотрудника (автоматически из БД)
        excel_path = context.user_data.get('export_file')
        employee_name = context.user_data.get('export_employee_name', 'Неизвестный')
        
        if not excel_path or not os.path.exists(excel_path):
            await query.edit_message_text("❌ Файл не найден.")
            return ConversationHandler.END
        
        await query.edit_message_text("🔍 Поиск email сотрудника в базе данных...")
        
        # Получаем email сотрудника из БД
        user_id = update.effective_user.id
        db = database_manager.create_database_connection(user_id)
        
        if db:
            try:
                # Сначала точное совпадение
                employee_email = await asyncio.to_thread(db.get_owner_email, employee_name, strict=True)
                
                # Если не нашли - нечеткий поиск
                if not employee_email:
                    employee_email = await asyncio.to_thread(db.get_owner_email, employee_name, strict=False)
                
                if employee_email:
                    logger.info(f"Email сотрудника '{employee_name}': {employee_email}")
                    
                    # Отправляем на найденный email
                    from bot.email_sender import send_export_email
                    
                    files_dict = {'equipment': excel_path}
                    success = send_export_email(
                        recipient=employee_email,
                        csv_files=files_dict,
                        subject=f"Ваше оборудование",
                        body=f"Здравствуйте, {employee_name}!\n\nВо вложении список закрепленного за вами оборудования."
                    )
                    
                    if success:
                        await context.bot.send_message(
                            chat_id=query.message.chat_id,
                            text=f"✅ Файл успешно отправлен на email сотрудника:\n{employee_email}"
                        )
                    else:
                        await context.bot.send_message(
                            chat_id=query.message.chat_id,
                            text="❌ Ошибка отправки email. Проверьте настройки SMTP."
                        )
                    
                    # Удаляем временный файл
                    if os.path.exists(excel_path):
                        os.remove(excel_path)
                else:
                    # Email не найден - предлагаем ввести вручную
                    await context.bot.send_message(
                        chat_id=query.message.chat_id,
                        text=f"❌ Email сотрудника '{employee_name}' не найден в базе данных.\n\n"
                             f"📧 Введите email адрес вручную:"
                    )
                    return States.EMPLOYEE_EMAIL_INPUT
                    
            except Exception as e:
                logger.error(f"Ошибка получения/отправки email: {e}", exc_info=True)
                await context.bot.send_message(
                    chat_id=query.message.chat_id,
                    text=f"❌ Ошибка: {str(e)}"
                )
        else:
            await context.bot.send_message(
                chat_id=query.message.chat_id,
                text="❌ Ошибка подключения к базе данных."
            )
        
        return ConversationHandler.END
    
    elif callback_data == "emp_export_email":
        # Запрос email вручную
        await query.edit_message_text(
            "📧 <b>Отправка на email</b>\n\n"
            "Введите email адрес для отправки файла:",
            parse_mode='HTML'
        )
        return States.EMPLOYEE_EMAIL_INPUT
    
    elif callback_data == "emp_export_back":
        # Возврат к списку оборудования
        await show_employee_equipment_page(update, context)
        return States.EMPLOYEE_PAGINATION
    
    return States.EMPLOYEE_PAGINATION


@handle_errors
async def handle_employee_export_email_input(update: Update, context: ContextTypes.DEFAULT_TYPE) -> int:
    """
    Обрабатывает ввод email для отправки экспортированного файла
    
    Параметры:
        update: Объект обновления от Telegram API
        context: Контекст выполнения
        
    Возвращает:
        int: ConversationHandler.END
    """
    import re
    from bot.email_sender import send_export_email
    
    email = update.message.text.strip()
    
    # Валидация email
    if not re.match(r'^[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}$', email):
        await update.message.reply_text(
            "❌ Некорректный email адрес. Попробуйте еще раз."
        )
        return States.EMPLOYEE_EMAIL_INPUT
    
    excel_path = context.user_data.get('export_file')
    employee_name = context.user_data.get('export_employee_name', 'Неизвестный')
    
    if not excel_path or not os.path.exists(excel_path):
        await update.message.reply_text("❌ Файл не найден.")
        return ConversationHandler.END
    
    await update.message.reply_text("📤 Отправка на email...")
    
    try:
        # Отправляем email
        # send_export_email ожидает словарь с файлами
        files_dict = {'equipment': excel_path}
        success = send_export_email(
            recipient=email,
            csv_files=files_dict,
            subject=f"Оборудование сотрудника: {employee_name}",
            body=f"Во вложении список оборудования сотрудника {employee_name}."
        )
        
        if success:
            await update.message.reply_text(
                f"✅ Файл успешно отправлен на {email}!"
            )
        else:
            await update.message.reply_text(
                "❌ Ошибка отправки email. Проверьте настройки SMTP."
            )
        
        # Удаляем временный файл
        if os.path.exists(excel_path):
            os.remove(excel_path)
    
    except Exception as e:
        logger.error(f"Ошибка отправки email: {e}")
        await update.message.reply_text(
            f"❌ Ошибка отправки email: {str(e)}"
        )
    
    return ConversationHandler.END


async def export_employee_equipment_to_excel(employee_name: str, equipment_list: list, context: ContextTypes.DEFAULT_TYPE) -> str:
    """
    Экспортирует оборудование сотрудника в Excel

    Параметры:
        employee_name: ФИО сотрудника
        equipment_list: Список оборудования
        context: Контекст выполнения

    Возвращает:
        str: Путь к созданному файлу или None при ошибке
    """
    import pandas as pd
    from pathlib import Path
    from datetime import datetime

    from bot.services.excel_service import SimpleExcelExporter

    try:
        # Подготавливаем данные для DataFrame
        data = []
        for item in equipment_list:
            row = {
                'Тип': item.get('TYPE_NAME', ''),
                'Модель': item.get('MODEL_NAME', ''),
                'Серийный номер': item.get('SERIAL_NO', ''),
                'Инвентарный номер': item.get('INV_NO', ''),
                'Статус': item.get('STATUS', ''),
                'Локация': item.get('LOCATION', ''),
                'Отдел': item.get('OWNER_DEPT', ''),
                'Описание': item.get('DESCRIPTION', '')
            }
            data.append(row)

        # Создаем DataFrame
        df = pd.DataFrame(data)

        # Создаем имя файла
        timestamp = datetime.now().strftime('%Y%m%d_%H%M%S')
        safe_name = "".join(c for c in employee_name if c.isalnum() or c in (' ', '-', '_')).strip()
        filename = f"equipment_{safe_name}_{timestamp}.xlsx"
        output_file = f"exports/{filename}"

        # Создаем экспортер и экспортируем
        exporter = SimpleExcelExporter()
        exporter.export_dataframe(
            df=df,
            output_file=output_file,
            title=f"Оборудование сотрудника: {employee_name}"
        )

        logger.info(f"Экспорт оборудования сотрудника '{employee_name}' завершен: {output_file}")
        return output_file

    except Exception as e:
        logger.error(f"Ошибка экспорта оборудования сотрудника: {e}")
        return None



@handle_errors
async def handle_employee_search_suggestion(update: Update, context: ContextTypes.DEFAULT_TYPE) -> int:
    """
    Обрабатывает выбор сотрудника из подсказок при поиске
    
    Параметры:
        update: Объект обновления от Telegram API
        context: Контекст выполнения
        
    Возвращает:
        int: Следующее состояние
    """
    query = update.callback_query
    await query.answer()
    
    data = query.data
    suggestions = context.user_data.get('employee_search_suggestions', [])
    
    # Обработка выбора конкретного сотрудника
    if data.startswith('employee_search_emp:') and not data.endswith((':manual', ':refresh')):
        try:
            idx = int(data.split(':', 1)[1])
            if 0 <= idx < len(suggestions):
                selected_name = suggestions[idx]
                
                await query.edit_message_text(f"✅ Выбран сотрудник: {selected_name}")
                
                # Поиск оборудования
                user_id = update.effective_user.id
                db = database_manager.create_database_connection(user_id)
                
                if not db:
                    await context.bot.send_message(
                        chat_id=query.message.chat_id,
                        text="❌ Ошибка подключения к базе данных."
                    )
                    return ConversationHandler.END
                
                equipment_list = await asyncio.to_thread(db.find_by_employee, selected_name)
                
                if not equipment_list:
                    await context.bot.send_message(
                        chat_id=query.message.chat_id,
                        text=f"❌ У сотрудника <b>{selected_name}</b> не найдено оборудования.",
                        parse_mode='HTML'
                    )
                    db.close_connection()
                    return ConversationHandler.END
                
                # Сохраняем результаты через PaginationHandler
                _employee_pagination_handler.set_items(context, equipment_list)
                _employee_pagination_handler.reset_pagination(context)
                context.user_data['employee_name'] = selected_name
                
                # Создаем временный update для show_employee_equipment_page
                from telegram import Message
                temp_message = query.message
                temp_update = Update(update.update_id, message=temp_message)
                
                await show_employee_equipment_page(temp_update, context)
                
                db.close_connection()
                return States.EMPLOYEE_PAGINATION
                
        except (ValueError, IndexError) as e:
            logger.error(f"Ошибка обработки выбора сотрудника: {e}")
    
    # Обработка "Ввести как есть"
    elif data == 'employee_search_emp:manual':
        pending = context.user_data.get('pending_employee_search_input', '').strip()
        
        if not pending:
            await query.edit_message_text("❌ Не найден введённый текст. Пожалуйста, введите ФИО заново.")
            return States.FIND_BY_EMPLOYEE_WAIT_INPUT
        
        await query.edit_message_text(f"✅ Принято: {pending}")
        
        # Поиск оборудования
        user_id = update.effective_user.id
        db = database_manager.create_database_connection(user_id)
        
        if not db:
            await context.bot.send_message(
                chat_id=query.message.chat_id,
                text="❌ Ошибка подключения к базе данных."
            )
            return ConversationHandler.END
        
        equipment_list = await asyncio.to_thread(db.find_by_employee, pending)
        
        if not equipment_list:
            await context.bot.send_message(
                chat_id=query.message.chat_id,
                text=f"❌ У сотрудника <b>{pending}</b> не найдено оборудования.",
                parse_mode='HTML'
            )
            db.close_connection()
            return ConversationHandler.END
        
        # Сохраняем результаты через PaginationHandler
        _employee_pagination_handler.set_items(context, equipment_list)
        _employee_pagination_handler.reset_pagination(context)
        context.user_data['employee_name'] = pending
        
        # Создаем временный update
        from telegram import Message
        temp_message = query.message
        temp_update = Update(update.update_id, message=temp_message)
        
        await show_employee_equipment_page(temp_update, context)
        
        db.close_connection()
        return States.EMPLOYEE_PAGINATION
    
    # Обработка "Обновить список"
    elif data == 'employee_search_emp:refresh':
        from bot.handlers.suggestions_handler import handle_employee_suggestion_generic
        return await handle_employee_suggestion_generic(
            update=update,
            context=context,
            mode='employee_search',
            storage_key='employee_name',
            pending_key='pending_employee_search_input',
            suggestions_key='employee_search_suggestions',
            next_state=States.FIND_BY_EMPLOYEE_WAIT_INPUT,
            next_message=None
        )
    
    return States.FIND_BY_EMPLOYEE_WAIT_INPUT
