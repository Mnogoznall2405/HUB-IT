#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
Обработчики экспорта данных
Экспорт ненайденного оборудования и перемещений, отправка на email.
"""
import logging
import os
import json
from telegram import Update, InlineKeyboardMarkup, InlineKeyboardButton
from telegram.ext import ContextTypes, ConversationHandler

from bot.config import States, Messages
from bot.utils.decorators import require_user_access, handle_errors
from bot.utils.keyboards import create_main_menu_keyboard
from bot.database_manager import database_manager
from bot.equipment_data_manager import EquipmentDataManager
from bot.email_sender import send_export_email
from bot.local_json_store import get_store, load_json_data

logger = logging.getLogger(__name__)

# Глобальный менеджер данных
equipment_manager = EquipmentDataManager()


def _build_export_menu_keyboard() -> InlineKeyboardMarkup:
    keyboard = [
        [InlineKeyboardButton("📦 Экспорт ненайденного оборудования", callback_data="export_type:unfound")],
        [InlineKeyboardButton("🔄 Экспорт перемещений", callback_data="export_type:transfers")],
        [InlineKeyboardButton("🔋 Экспорт замены батареи ИБП", callback_data="export_type:battery")],
        [InlineKeyboardButton("🖥️ Экспорт чистки ПК", callback_data="export_type:pc_cleaning")],
        [InlineKeyboardButton("💾 Экспорт компонентов ПК", callback_data="export_type:pc_components")],
        [InlineKeyboardButton("🔙 Назад в главное меню", callback_data="back_to_main")],
    ]
    return InlineKeyboardMarkup(keyboard)


def _log_sqlite_export_source(file_path: str, rows_count: int) -> None:
    try:
        store = get_store()
        logger.info(
            "[EXPORT] source=sqlite db_path=%s file=%s rows=%s",
            store.db_path,
            file_path,
            rows_count,
        )
    except Exception as exc:
        logger.warning("[EXPORT] source logging failed file=%s error=%s", file_path, exc)


@require_user_access
async def show_export_menu(update: Update, context: ContextTypes.DEFAULT_TYPE) -> int:
    """
    Отображает меню экспорта данных

    Параметры:
        update: Объект обновления от Telegram API
        context: Контекст выполнения

    Возвращает:
        int: Состояние для ConversationHandler
    """
    reply_markup = _build_export_menu_keyboard()

    await update.message.reply_text(
        "📊 <b>Экспорт данных</b>\n\n"
        "Выберите тип данных для экспорта:",
        parse_mode='HTML',
        reply_markup=reply_markup
    )

    return States.DB_SELECTION_MENU  # Используем существующее состояние


@handle_errors
async def handle_export_type(update: Update, context: ContextTypes.DEFAULT_TYPE) -> int:
    """
    Обрабатывает выбор типа экспорта
    
    Параметры:
        update: Объект обновления от Telegram API
        context: Контекст выполнения
        
    Возвращает:
        int: Следующее состояние
    """
    query = update.callback_query
    await query.answer()
    
    callback_data = query.data
    
    if callback_data.startswith("export_type:"):
        export_type = callback_data.split(":")[1]

        if export_type == "cartridges":
            await query.edit_message_text(
                "⚠️ Экспорт замен комплектующих МФУ больше недоступен в боте."
            )
            return States.DB_SELECTION_MENU

        context.user_data['export_type'] = export_type
        
        # Показываем выбор периода
        return await show_export_period(update, context)
    
    elif callback_data == "back_to_main":
        await query.edit_message_text("✅ Возврат в главное меню")
        await context.bot.send_message(
            chat_id=query.message.chat_id,
            text=Messages.MAIN_MENU,
            reply_markup=create_main_menu_keyboard()
        )
        return ConversationHandler.END
    
    return States.DB_SELECTION_MENU


async def show_export_period(update: Update, context: ContextTypes.DEFAULT_TYPE) -> int:
    """
    Показывает выбор периода экспорта

    Параметры:
        update: Объект обновления от Telegram API
        context: Контекст выполнения

    Возвращает:
        int: Следующее состояние
    """
    export_type = context.user_data.get('export_type', 'unfound')

    # Разные клавиатуры для разных типов экспорта
    if export_type in ('battery', 'pc_cleaning', 'pc_components'):
        # Для батареи, чистки ПК и компонентов ПК - выбор периода без выбора базы
        keyboard = [
            [InlineKeyboardButton("📅 За последний месяц", callback_data="export_period:1month")],
            [InlineKeyboardButton("📊 За последние 3 месяца", callback_data="export_period:3months")],
            [InlineKeyboardButton("📕 За весь период", callback_data="export_period:all")],
            [InlineKeyboardButton("🔙 Назад", callback_data="back_to_export_menu")]
        ]
    else:
        # Для остальных типов - стандартный выбор
        keyboard = [
            [InlineKeyboardButton("📅 Все данные", callback_data="export_period:full")],
            [InlineKeyboardButton("🆕 Только новые", callback_data="export_period:new")],
            [InlineKeyboardButton("🔙 Назад", callback_data="back_to_export_menu")]
        ]

    reply_markup = InlineKeyboardMarkup(keyboard)

    type_names = {
        'unfound': 'ненайденного оборудования',
        'transfers': 'перемещений',
        'battery': 'замен батареи ИБП',
        'pc_cleaning': 'чистки ПК',
        'pc_components': 'компонентов ПК'
    }
    type_name = type_names.get(export_type, 'данных')

    period_text = "Выберите период для экспорта:"
    if export_type == 'battery':
        period_text = "Выберите период для анализа замен батареи:"
    elif export_type == 'pc_cleaning':
        period_text = "Выберите период для анализа чисток ПК:"
    elif export_type == 'pc_components':
        period_text = "Выберите период для анализа компонентов ПК:"

    await update.callback_query.edit_message_text(
        f"📊 <b>Экспорт {type_name}</b>\n\n"
        f"{period_text}",
        parse_mode='HTML',
        reply_markup=reply_markup
    )

    return States.DB_SELECTION_MENU


@handle_errors
async def handle_export_period(update: Update, context: ContextTypes.DEFAULT_TYPE) -> int:
    """
    Обрабатывает выбор периода экспорта

    Параметры:
        update: Объект обновления от Telegram API
        context: Контекст выполнения

    Возвращает:
        int: Следующее состояние
    """
    query = update.callback_query
    await query.answer()

    callback_data = query.data
    export_type = context.user_data.get('export_type', 'unfound')

    if callback_data.startswith("export_period:"):
        period = callback_data.split(":")[1]
        context.user_data['export_period'] = period

        # Для батареи, чистки ПК и компонентов ПК - прямой экспорт без выбора базы
        if export_type == 'battery':
            return await handle_battery_export_directly(update, context, period)
        elif export_type == 'pc_cleaning':
            return await handle_pc_cleaning_export_directly(update, context, period)
        elif export_type == 'pc_components':
            return await handle_pc_components_export_directly(update, context, period)
        else:
            # Для остальных типов - показываем выбор базы данных
            return await show_export_database(update, context)

    elif callback_data == "back_to_export_menu":
        # Возврат к выбору типа экспорта
        reply_markup = _build_export_menu_keyboard()

        await query.edit_message_text(
            "📊 <b>Экспорт данных</b>\n\n"
            "Выберите тип данных для экспорта:",
            parse_mode='HTML',
            reply_markup=reply_markup
        )

    return States.DB_SELECTION_MENU


async def show_export_database(update: Update, context: ContextTypes.DEFAULT_TYPE) -> int:
    """
    Показывает выбор базы данных для экспорта
    
    Параметры:
        update: Объект обновления от Telegram API
        context: Контекст выполнения
        
    Возвращает:
        int: Следующее состояние
    """
    # Получаем список доступных БД
    available_databases = database_manager.get_available_databases()
    
    keyboard = [[InlineKeyboardButton("📦 Все базы", callback_data="export_db:all")]]
    
    for db_name in available_databases:
        keyboard.append([InlineKeyboardButton(f"🏛 {db_name}", callback_data=f"export_db:{db_name}")])
    
    keyboard.append([InlineKeyboardButton("🔙 Назад", callback_data="back_to_period")])
    
    reply_markup = InlineKeyboardMarkup(keyboard)
    
    await update.callback_query.edit_message_text(
        "📂 <b>Выбор базы данных</b>\n\n"
        "Выберите базу данных для экспорта:",
        parse_mode='HTML',
        reply_markup=reply_markup
    )
    
    return States.DB_SELECTION_MENU


@handle_errors
async def handle_export_database(update: Update, context: ContextTypes.DEFAULT_TYPE) -> int:
    """
    Обрабатывает выбор БД и выполняет экспорт
    
    Параметры:
        update: Объект обновления от Telegram API
        context: Контекст выполнения
        
    Возвращает:
        int: Следующее состояние
    """
    query = update.callback_query
    await query.answer()
    
    callback_data = query.data
    
    if callback_data.startswith("export_db:"):
        db_name = callback_data.split(":")[1]
        
        export_type = context.user_data.get('export_type', 'unfound')
        period = context.user_data.get('export_period', 'full')
        
        # Выполняем экспорт
        await query.edit_message_text("⏳ Подготовка данных для экспорта...")
        
        try:
            only_new = (period == 'new')
            db_filter = None if db_name == 'all' else db_name
            
            if export_type == 'unfound':
                # Экспорт ненайденного оборудования
                exported_files = equipment_manager.export_to_csv(
                    date_filter=None,
                    db_filter=db_filter,
                    only_new=only_new
                )
                
                unfound_csv = exported_files.get('unfound')
                
                if unfound_csv and os.path.exists(unfound_csv):
                    # Сохраняем путь к файлу
                    context.user_data['export_file'] = unfound_csv
                    
                    # Показываем опции доставки
                    return await show_delivery_options(update, context, unfound_csv)
                else:
                    await query.edit_message_text(
                        "❌ Нет данных для экспорта или ошибка создания файла."
                    )
                    return ConversationHandler.END
            
            elif export_type == 'transfers':
                # Экспорт перемещений
                text_file = equipment_manager.export_transfers_to_text(
                    date_filter=None,
                    db_filter=db_filter,
                    only_new=only_new
                )
                
                if text_file and os.path.exists(text_file):
                    context.user_data['export_file'] = text_file
                    return await show_delivery_options(update, context, text_file)
                else:
                    await query.edit_message_text(
                        "❌ Нет данных для экспорта или ошибка создания файла."
                    )
                    return ConversationHandler.END
            
            elif export_type == 'battery':
                # Экспорт замены батареи ИБП - показываем выбор периода
                return await handle_battery_export_directly(update, context)

        except Exception as e:
            logger.error(f"Ошибка при экспорте: {e}")
            await query.edit_message_text(
                f"❌ Ошибка при экспорте: {str(e)}"
            )
            return ConversationHandler.END
    
    elif callback_data == "back_to_period":
        return await show_export_period(update, context)
    
    return States.DB_SELECTION_MENU


async def show_delivery_options(update: Update, context: ContextTypes.DEFAULT_TYPE, file_path: str) -> int:
    """
    Показывает опции доставки файла
    
    Параметры:
        update: Объект обновления от Telegram API
        context: Контекст выполнения
        file_path: Путь к экспортированному файлу
        
    Возвращает:
        int: Следующее состояние
    """
    # Получаем размер файла
    file_size = os.path.getsize(file_path)
    size_kb = round(file_size / 1024, 1)
    filename = os.path.basename(file_path)
    
    keyboard = [
        [InlineKeyboardButton("💬 Отправить в чат", callback_data="delivery:chat")],
        [InlineKeyboardButton("📧 Отправить на email", callback_data="delivery:email")],
        [InlineKeyboardButton("🔙 Назад в главное меню", callback_data="back_to_main")]
    ]
    
    reply_markup = InlineKeyboardMarkup(keyboard)
    
    await update.callback_query.edit_message_text(
        f"✅ <b>Файл создан</b>\n\n"
        f"📄 Имя: {filename}\n"
        f"📊 Размер: {size_kb} КБ\n\n"
        f"Выберите способ доставки:",
        parse_mode='HTML',
        reply_markup=reply_markup
    )
    
    return States.DB_SELECTION_MENU


@handle_errors
async def handle_delivery(update: Update, context: ContextTypes.DEFAULT_TYPE) -> int:
    """
    Обрабатывает выбор способа доставки
    
    Параметры:
        update: Объект обновления от Telegram API
        context: Контекст выполнения
        
    Возвращает:
        int: ConversationHandler.END
    """
    query = update.callback_query
    await query.answer()
    
    callback_data = query.data
    
    if callback_data == "delivery:chat":
        # Отправка в чат
        file_path = context.user_data.get('export_file')
        
        if file_path and os.path.exists(file_path):
            await query.edit_message_text("📤 Отправка файла...")
            
            try:
                with open(file_path, 'rb') as file:
                    await context.bot.send_document(
                        chat_id=query.message.chat_id,
                        document=file,
                        filename=os.path.basename(file_path),
                        caption="✅ Экспортированные данные"
                    )
                
                await context.bot.send_message(
                    chat_id=query.message.chat_id,
                    text="✅ Файл успешно отправлен!"
                )
            
            except Exception as e:
                logger.error(f"Ошибка отправки файла: {e}")
                await context.bot.send_message(
                    chat_id=query.message.chat_id,
                    text=f"❌ Ошибка отправки файла: {str(e)}"
                )
        else:
            await query.edit_message_text("❌ Файл не найден.")
        
        return ConversationHandler.END
    
    elif callback_data == "delivery:email":
        # Запрос email адреса
        await query.edit_message_text(
            "📧 <b>Отправка на email</b>\n\n"
            "Введите email адрес для отправки файла:",
            parse_mode='HTML'
        )
        
        return States.UNFOUND_EMPLOYEE_INPUT  # Используем существующее состояние для ввода текста
    
    elif callback_data == "back_to_main":
        await query.edit_message_text("✅ Возврат в главное меню")
        await context.bot.send_message(
            chat_id=query.message.chat_id,
            text=Messages.MAIN_MENU,
            reply_markup=create_main_menu_keyboard()
        )
        return ConversationHandler.END
    
    return ConversationHandler.END


@handle_errors
async def handle_email_input(update: Update, context: ContextTypes.DEFAULT_TYPE) -> int:
    """
    Обрабатывает ввод email адреса и отправляет файл
    
    Параметры:
        update: Объект обновления от Telegram API
        context: Контекст выполнения
        
    Возвращает:
        int: ConversationHandler.END
    """
    email = update.message.text.strip()
    
    # Простая валидация email
    import re
    if not re.match(r'^[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}$', email):
        await update.message.reply_text(
            "❌ Некорректный email адрес. Попробуйте еще раз."
        )
        return States.UNFOUND_EMPLOYEE_INPUT
    
    file_path = context.user_data.get('export_file')
    export_type = context.user_data.get('export_type', 'export')
    
    if not file_path or not os.path.exists(file_path):
        await update.message.reply_text("❌ Файл не найден.")
        return ConversationHandler.END
    
    await update.message.reply_text("📤 Отправка на email...")
    
    try:
        # Отправляем email
        success = send_export_email(
            recipient=email,
            csv_files={export_type: file_path},
            subject="Экспорт данных IT-invent",
            body="Во вложении экспортированные данные из системы IT-invent."
        )
        
        if success:
            await update.message.reply_text(
                f"✅ Файл успешно отправлен на {email}!"
            )
        else:
            await update.message.reply_text(
                "❌ Ошибка отправки email. Проверьте настройки SMTP."
            )
    
    except Exception as e:
        logger.error(f"Ошибка отправки email: {e}")
        await update.message.reply_text(
            f"❌ Ошибка отправки email: {str(e)}"
        )
    
    return ConversationHandler.END



@handle_errors
async def handle_battery_export_directly(update: Update, context: ContextTypes.DEFAULT_TYPE, period: str) -> int:
    """
    Обрабатывает прямой экспорт замены батареи без выбора базы данных

    Параметры:
        update: Объект обновления от Telegram API
        context: Контекст выполнения
        period: Выбранный период

    Возвращает:
        int: Следующее состояние
    """
    query = update.callback_query
    await query.edit_message_text("⏳ Анализ данных о заменах батареи ИБП...")

    try:
        # Выполняем экспорт с структурированием по филиалам
        excel_file = await export_battery_to_excel_structured(period=period, db_filter=None)

        if excel_file and os.path.exists(excel_file):
            context.user_data['export_file'] = excel_file
            return await show_delivery_options(update, context, excel_file)
        else:
            await query.edit_message_text(
                "❌ Нет данных для экспорта или ошибка создания файла."
            )
            return ConversationHandler.END

    except Exception as e:
        logger.error(f"Ошибка при экспорте замены батареи: {e}")
        await query.edit_message_text(
            f"❌ Ошибка при экспорте: {str(e)}"
        )
        return ConversationHandler.END


@handle_errors
async def handle_pc_cleaning_export_directly(update: Update, context: ContextTypes.DEFAULT_TYPE, period: str) -> int:
    """
    Обрабатывает прямой экспорт чистки ПК без выбора базы данных

    Параметры:
        update: Объект обновления от Telegram API
        context: Контекст выполнения
        period: Выбранный период

    Возвращает:
        int: Следующее состояние
    """
    query = update.callback_query
    await query.edit_message_text("⏳ Анализ данных о чистках ПК...")

    try:
        # Выполняем экспорт с структурированием по филиалам
        excel_file = await export_pc_cleaning_to_excel_structured(period=period, db_filter=None)

        if excel_file and os.path.exists(excel_file):
            context.user_data['export_file'] = excel_file
            return await show_delivery_options(update, context, excel_file)
        else:
            await query.edit_message_text(
                "❌ Нет данных для экспорта или ошибка создания файла."
            )
            return ConversationHandler.END

    except Exception as e:
        logger.error(f"Ошибка при экспорте чистки ПК: {e}")
        await query.edit_message_text(
            f"❌ Ошибка при экспорте: {str(e)}"
        )
        return ConversationHandler.END


@handle_errors
async def handle_pc_components_export_directly(update: Update, context: ContextTypes.DEFAULT_TYPE, period: str) -> int:
    """
    Обрабатывает прямой экспорт компонентов ПК без выбора базы данных

    Параметры:
        update: Объект обновления от Telegram API
        context: Контекст выполнения
        period: Выбранный период

    Возвращает:
        int: Следующее состояние
    """
    query = update.callback_query
    await query.edit_message_text("⏳ Анализ данных о заменах компонентов ПК...")

    try:
        # Выполняем экспорт с структурированием по филиалам
        excel_file = await export_pc_components_to_excel_structured(period=period, db_filter=None)

        if excel_file and os.path.exists(excel_file):
            context.user_data['export_file'] = excel_file
            return await show_delivery_options(update, context, excel_file)
        else:
            await query.edit_message_text(
                "❌ Нет данных для экспорта или ошибка создания файла."
            )
            return ConversationHandler.END

    except Exception as e:
        logger.error(f"Ошибка при экспорте компонентов ПК: {e}")
        await query.edit_message_text(
            f"❌ Ошибка при экспорте: {str(e)}"
        )
        return ConversationHandler.END


async def export_battery_to_excel_structured(period: str = "all", db_filter: str = None) -> str:
    """
    Экспорт замен батареи ИБП в Excel с разделением по филиалам

    Параметры:
        period: Период экспорта (1month, 3months, all)
        db_filter: Фильтр по базе данных (None = все базы)

    Возвращает:
        str: Путь к созданному файлу
    """
    import json
    import pandas as pd
    from pathlib import Path
    from datetime import datetime

    from bot.services.excel_service import GroupedExcelExporter, filter_data_by_period, ColumnWidth

    try:
        file_path = Path("data/battery_replacements.json")

        data = load_json_data(str(file_path), default_content=[])
        if not isinstance(data, list):
            data = []
        _log_sqlite_export_source(file_path.name, len(data))

        if not data:
            return None

        # Фильтруем по БД если указан фильтр
        if db_filter:
            data = [item for item in data if item.get('db_name') == db_filter]

        if not data:
            return None

        # Фильтруем по периоду и получаем даты
        filtered_data, start_date, end_date = filter_data_by_period(data, period)

        if not filtered_data:
            return None

        # Создаем DataFrame с нужными полями
        rows = []
        logger.info(f"Обрабатываю {len(filtered_data)} записей о замене батареи")

        for item in filtered_data:
            row = {
                'Дата': item.get('timestamp', '').split('T')[0] if item.get('timestamp') else '',
                'Время': item.get('timestamp', '').split('T')[1].split('.')[0] if item.get('timestamp') else '',
                'Филиал': item.get('branch', ''),
                'Локация': item.get('location', ''),
                'Серийный номер': item.get('serial_no', ''),
                'Модель ИБП': item.get('model_name', ''),
                'Производитель': item.get('manufacturer', ''),
                'Сотрудник': item.get('employee', ''),
                'Инв. номер': item.get('inv_no', ''),
                'База данных': item.get('db_name', '')
            }
            rows.append(row)

        # Создаем DataFrame
        df = pd.DataFrame(rows)

        # Порядок колонок (с филиалом для группировки)
        df = df[['Дата', 'Время', 'Филиал', 'Локация', 'Серийный номер',
                 'Модель ИБП', 'Производитель', 'Сотрудник', 'Инв. номер', 'База данных']]

        # Сортируем по дате (новые сверху)
        df = df.sort_values('Дата', ascending=False)

        # Создаем экспортер
        exporter = GroupedExcelExporter()

        # Формируем диапазон дат
        date_range = exporter.format_date_range(start_date, end_date) if (start_date and end_date) else "все_даты"

        # Генерируем имя файла
        timestamp = datetime.now().strftime('%Y%m%d_%H%M%S')
        output_file = f"exports/батареи_ибп_{date_range}_{timestamp}.xlsx"

        # Ширина колонок
        column_widths = {
            'A': ColumnWidth.DATE,
            'B': ColumnWidth.TIME,
            'C': ColumnWidth.LOCATION,
            'D': ColumnWidth.SERIAL,
            'E': ColumnWidth.MODEL,
            'F': ColumnWidth.MANUFACTURER,
            'G': ColumnWidth.EMPLOYEE,
            'H': ColumnWidth.INV_NO,
            'I': ColumnWidth.DATABASE,
            'J': ColumnWidth.RESERVE,
            'K': ColumnWidth.TITLE
        }

        # Экспортируем с группировкой по филиалам
        exporter.export_by_branches(
            df=df,
            output_file=output_file,
            sheet_title_prefix="ФИЛИАЛ",
            summary_title="СВОДНЫЙ ОТЧЕТ ПО ЗАМЕНЕ БАТАРЕИ ИБП",
            date_range=date_range,
            branch_column='Филиал',
            column_widths=column_widths
        )

        logger.info(f"Создан отчет по замене батареи ИБП с разделением по филиалам: {output_file}")
        return output_file

    except Exception as e:
        logger.error(f"Ошибка экспорта замены батареи ИБП: {e}")
        import traceback
        traceback.print_exc()
        return None


async def export_pc_cleaning_to_excel_structured(period: str = "all", db_filter: str = None) -> str:
    """
    Экспорт чисток ПК в Excel с разделением по филиалам

    Параметры:
        period: Период экспорта (1month, 3months, all)
        db_filter: Фильтр по базе данных (None = все базы)

    Возвращает:
        str: Путь к созданному файлу
    """
    import json
    import pandas as pd
    from pathlib import Path
    from datetime import datetime

    from bot.services.excel_service import GroupedExcelExporter, filter_data_by_period, ColumnWidth

    try:
        file_path = Path("data/pc_cleanings.json")

        data = load_json_data(str(file_path), default_content=[])
        if not isinstance(data, list):
            data = []
        _log_sqlite_export_source(file_path.name, len(data))

        if not data:
            return None

        # Фильтруем по БД если указан фильтр
        if db_filter:
            data = [item for item in data if item.get('db_name') == db_filter]

        if not data:
            return None

        # Фильтруем по периоду и получаем даты
        filtered_data, start_date, end_date = filter_data_by_period(data, period)

        if not filtered_data:
            return None

        # Создаем DataFrame с нужными полями
        rows = []
        logger.info(f"Обрабатываю {len(filtered_data)} записей о чистке ПК")

        for item in filtered_data:
            row = {
                'Дата': item.get('timestamp', '').split('T')[0] if item.get('timestamp') else '',
                'Время': item.get('timestamp', '').split('T')[1].split('.')[0] if item.get('timestamp') else '',
                'Филиал': item.get('branch', ''),
                'Локация': item.get('location', ''),
                'Серийный номер': item.get('serial_no', ''),
                'Модель ПК': item.get('model_name', ''),
                'Производитель': item.get('manufacturer', ''),
                'Сотрудник': item.get('employee', ''),
                'Инв. номер': item.get('inv_no', ''),
                'База данных': item.get('db_name', '')
            }
            rows.append(row)

        # Создаем DataFrame
        df = pd.DataFrame(rows)

        # Порядок колонок (с филиалом для группировки)
        df = df[['Дата', 'Время', 'Филиал', 'Локация', 'Серийный номер',
                 'Модель ПК', 'Производитель', 'Сотрудник', 'Инв. номер', 'База данных']]

        # Сортируем по дате (новые сверху)
        df = df.sort_values('Дата', ascending=False)

        # Создаем экспортер
        exporter = GroupedExcelExporter()

        # Формируем диапазон дат
        date_range = exporter.format_date_range(start_date, end_date) if (start_date and end_date) else "все_даты"

        # Генерируем имя файла
        timestamp = datetime.now().strftime('%Y%m%d_%H%M%S')
        output_file = f"exports/чистки_пк_{date_range}_{timestamp}.xlsx"

        # Ширина колонок
        column_widths = {
            'A': ColumnWidth.DATE,
            'B': ColumnWidth.TIME,
            'C': ColumnWidth.LOCATION,
            'D': ColumnWidth.SERIAL,
            'E': ColumnWidth.MODEL,
            'F': ColumnWidth.MANUFACTURER,
            'G': ColumnWidth.EMPLOYEE,
            'H': ColumnWidth.INV_NO,
            'I': ColumnWidth.DATABASE,
            'J': ColumnWidth.RESERVE,
            'K': ColumnWidth.TITLE
        }

        # Экспортируем с группировкой по филиалам
        exporter.export_by_branches(
            df=df,
            output_file=output_file,
            sheet_title_prefix="ФИЛИАЛ",
            summary_title="СВОДНЫЙ ОТЧЕТ ПО ЧИСТКАМ ПК",
            date_range=date_range,
            branch_column='Филиал',
            column_widths=column_widths
        )

        logger.info(f"Создан отчет по чисткам ПК с разделением по филиалам: {output_file}")
        return output_file

    except Exception as e:
        logger.error(f"Ошибка экспорта чисток ПК: {e}")
        import traceback
        traceback.print_exc()
        return None


def get_period_name_ru(period: str) -> str:
    """
    Возвращает русское название периода

    Параметры:
        period: Период (1month, 3months, all)

    Возвращает:
        str: Русское название периода
    """
    period_names = {
        '1month': 'За последний месяц',
        '3months': 'За последние 3 месяца',
        'all': 'За весь период',
        'full': 'За весь период',
        'new': 'Только новые'
    }
    return period_names.get(period, period)


async def export_pc_components_to_excel_structured(period: str = "all", db_filter: str = None) -> str:
    """
    Экспорт замен компонентов ПК в Excel с разделением по филиалам

    Параметры:
        period: Период экспорта (1month, 3months, all)
        db_filter: Фильтр по базе данных (None = все базы)

    Возвращает:
        str: Путь к созданному файлу
    """
    import json
    import pandas as pd
    from pathlib import Path
    from datetime import datetime

    from bot.services.excel_service import GroupedExcelExporter, filter_data_by_period, ColumnWidth

    try:
        file_path = Path("data/component_replacements.json")

        data = load_json_data(str(file_path), default_content=[])
        if not isinstance(data, list):
            data = []
        _log_sqlite_export_source(file_path.name, len(data))

        if not data:
            return None

        # Фильтруем по БД если указан фильтр
        if db_filter:
            data = [item for item in data if item.get('db_name') == db_filter]

        if not data:
            return None

        # Фильтруем по периоду и получаем даты
        filtered_data, start_date, end_date = filter_data_by_period(data, period)

        if not filtered_data:
            return None

        # Создаем DataFrame с нужными полями
        rows = []
        logger.info(f"Обрабатываю {len(filtered_data)} записей о замене компонентов ПК")

        for item in filtered_data:
            row = {
                'Дата': item.get('timestamp', '').split('T')[0] if item.get('timestamp') else '',
                'Время': item.get('timestamp', '').split('T')[1].split('.')[0] if item.get('timestamp') else '',
                'Филиал': item.get('branch', ''),
                'Локация': item.get('location', ''),
                'Серийный номер': item.get('serial_no', ''),
                'Модель ПК': item.get('model_name', ''),
                'Производитель': item.get('manufacturer', ''),
                'Компонент': item.get('component_name', ''),
                'Тип компонента': item.get('component_type', ''),
                'Сотрудник': item.get('employee', ''),
                'Инв. номер': item.get('inv_no', ''),
                'База данных': item.get('db_name', '')
            }
            rows.append(row)

        # Создаем DataFrame
        df = pd.DataFrame(rows)

        # Порядок колонок (с филиалом для группировки)
        df = df[['Дата', 'Время', 'Филиал', 'Локация', 'Серийный номер',
                 'Модель ПК', 'Производитель', 'Компонент', 'Тип компонента',
                 'Сотрудник', 'Инв. номер', 'База данных']]

        # Сортируем по дате (новые сверху)
        df = df.sort_values('Дата', ascending=False)

        # Создаем экспортер
        exporter = GroupedExcelExporter()

        # Формируем диапазон дат
        date_range = exporter.format_date_range(start_date, end_date) if (start_date and end_date) else "все_даты"

        # Генерируем имя файла
        timestamp = datetime.now().strftime('%Y%m%d_%H%M%S')
        output_file = f"exports/компоненты_пк_{date_range}_{timestamp}.xlsx"

        # Ширина колонок
        column_widths = {
            'A': ColumnWidth.DATE,
            'B': ColumnWidth.TIME,
            'C': 15,  # Локация
            'D': ColumnWidth.SERIAL,
            'E': ColumnWidth.MODEL,
            'F': ColumnWidth.MANUFACTURER,
            'G': 25,  # Компонент
            'H': 20,  # Тип компонента
            'I': ColumnWidth.EMPLOYEE,
            'J': ColumnWidth.INV_NO,
            'K': ColumnWidth.DATABASE,
            'L': ColumnWidth.TITLE
        }

        # Экспортируем с группировкой по филиалам
        exporter.export_by_branches(
            df=df,
            output_file=output_file,
            sheet_title_prefix="ФИЛИАЛ",
            summary_title="СВОДНЫЙ ОТЧЕТ ПО ЗАМЕНЕ КОМПОНЕНТОВ ПК",
            date_range=date_range,
            branch_column='Филиал',
            column_widths=column_widths
        )

        logger.info(f"Создан отчет по замене компонентов ПК с разделением по филиалам: {output_file}")
        return output_file

    except Exception as e:
        logger.error(f"Ошибка экспорта замены компонентов ПК: {e}")
        import traceback
        traceback.print_exc()
        return None



