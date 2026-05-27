#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
Точка входа для IT-invent Telegram Bot

Инициализирует и запускает бота с модульной архитектурой.
"""

import logging
from logging.handlers import RotatingFileHandler
import sys
import warnings

from telegram import Update
from telegram.ext import Application, CommandHandler, MessageHandler, filters, ContextTypes, CallbackQueryHandler
from telegram.warnings import PTBUserWarning

# Импорты из модулей бота
from bot.config import config
from bot.handlers import start, help_command, cancel
from local_store import get_local_store

# Фильтр для исключения кнопок главного меню
MAIN_MENU_BUTTONS_FILTER = (
    filters.Regex("^🔎 Добавить или Найти$") |
    filters.Regex("^👤 Найти по сотруднику$") |
    filters.Regex("^🗄️ Управление базами данных$") |
    filters.Regex("^📦 Перемещение оборудования с актом$") |
    filters.Regex("^🔧 Работы$") |
    filters.Regex("^📊 Экспорт данных$")
)

# Функции переключения больше не нужны - кнопки главного меню обрабатываются напрямую

# Настройка логирования с ротацией
def _configure_process_io():
    for stream in (sys.stdout, sys.stderr):
        if hasattr(stream, "reconfigure"):
            try:
                stream.reconfigure(encoding='utf-8', errors='replace')
            except Exception:
                pass


_configure_process_io()
warnings.filterwarnings(
    "ignore",
    message=r"If 'per_message=False', 'CallbackQueryHandler' will not be tracked for every message\..*",
    category=PTBUserWarning,
)


def setup_logging():
    """Настраивает систему логирования с ротацией файлов"""
    # Создаем форматтер
    formatter = logging.Formatter(
        '%(asctime)s - %(name)s - %(levelname)s - %(message)s'
    )
    
    # Rotating file handler (10 МБ, 5 файлов)
    file_handler = RotatingFileHandler(
        "bot.log",
        maxBytes=10*1024*1024,  # 10 МБ
        backupCount=5,
        encoding='utf-8'
    )
    file_handler.setFormatter(formatter)
    file_handler.setLevel(logging.INFO)
    
    # Console handler
    console_handler = logging.StreamHandler(sys.stdout)
    console_handler.setFormatter(formatter)
    console_handler.setLevel(logging.INFO)
    
    # Настройка root logger
    root_logger = logging.getLogger()
    root_logger.setLevel(logging.INFO)
    root_logger.addHandler(file_handler)
    root_logger.addHandler(console_handler)
    
    return logging.getLogger(__name__)


logger = setup_logging()


def register_handlers(application: Application) -> None:
    """
    Регистрирует все обработчики команд и сообщений
    
    Параметры:
        application: Объект Application от python-telegram-bot
    """
    from telegram.ext import ConversationHandler, MessageHandler, filters, CallbackQueryHandler
    from bot.config import States
    from bot.handlers.search import ask_find_equipment, find_by_serial_input, handle_search_again
    from bot.handlers.employee import (
        ask_find_by_employee,
        find_by_employee_input,
        handle_employee_pagination,
        handle_employee_export_delivery,
        handle_employee_export_email_input,
        handle_employee_search_suggestion
    )
    from bot.handlers.transfer import (
        start_transfer,
        receive_transfer_photos,
        receive_new_employee,
        receive_transfer_branch,
        receive_transfer_location,
        handle_transfer_branch_callback,
        handle_transfer_location_callback,
        handle_transfer_confirmation,
        handle_employee_suggestion_callback
    )
    from bot.handlers.database import (
        show_database_menu,
        handle_database_callback,
        show_equipment_types_menu,
        handle_equipment_pagination,
        show_export_database_menu,
        handle_export_database_callback
    )
    from bot.handlers.work import (
        start_work,
        handle_work_type,
        handle_work_confirmation,
        handle_work_success_action,
        work_battery_serial_input,
        show_battery_confirmation,
        save_battery_replacement,
        work_pc_cleaning_serial_input,
        show_pc_cleaning_confirmation,
        save_pc_cleaning,
        work_component_serial_input,
        show_component_selection_pc,
        handle_pc_component_selection,
        save_component_replacement_pc
    )
    from bot.handlers.export import (
        show_export_menu,
        handle_export_type,
        handle_export_period,
        handle_export_database,
        handle_delivery,
        handle_email_input
    )
    from bot.handlers.act_email import (
        handle_act_action_callback,
        handle_email_input as handle_act_email_input
    )
    
    # Базовые команды (кроме /start - он обрабатывается в fallbacks ConversationHandler)
    application.add_handler(CommandHandler("help", help_command))
    
    # ConversationHandler для поиска по серийному номеру
    search_conv_handler = ConversationHandler(
        entry_points=[
            MessageHandler(filters.Regex("^🔎 Добавить или Найти$"), ask_find_equipment),
            CallbackQueryHandler(handle_search_again, pattern="^search_again$")
        ],
        states={
            States.FIND_WAIT_INPUT: [
                MessageHandler(
                    filters.PHOTO
                    | filters.Document.IMAGE
                    | (filters.TEXT & ~filters.COMMAND & ~MAIN_MENU_BUTTONS_FILTER),
                    find_by_serial_input
                )
            ]
        },
        fallbacks=[
            CommandHandler("cancel", cancel),
            CommandHandler("start", start)
        ],
        name="search_conversation",
        persistent=False,
        allow_reentry=False
    )
    
    # ConversationHandler для поиска по сотруднику
    employee_conv_handler = ConversationHandler(
        entry_points=[
            MessageHandler(filters.Regex("^👤 Найти по сотруднику$"), ask_find_by_employee)
        ],
        states={
            States.FIND_BY_EMPLOYEE_WAIT_INPUT: [
                CallbackQueryHandler(handle_employee_search_suggestion, pattern="^employee_search_emp:"),
                MessageHandler(
                    filters.TEXT & ~filters.COMMAND & ~MAIN_MENU_BUTTONS_FILTER,
                    find_by_employee_input
                )
            ],
            States.EMPLOYEE_PAGINATION: [
                CallbackQueryHandler(handle_employee_export_delivery, pattern="^emp_export_(chat|email|employee_email|back)$"),
                CallbackQueryHandler(handle_employee_pagination)
            ],
            States.EMPLOYEE_EMAIL_INPUT: [
                MessageHandler(
                    filters.TEXT & ~filters.COMMAND & ~MAIN_MENU_BUTTONS_FILTER,
                    handle_employee_export_email_input
                )
            ]
        },
        fallbacks=[
            CommandHandler("cancel", cancel),
            CommandHandler("start", start)
        ],
        name="employee_conversation",
        persistent=False,
        allow_reentry=True
    )
    
    # ConversationHandler для перемещения оборудования
    transfer_conv_handler = ConversationHandler(
        entry_points=[
            MessageHandler(filters.Regex("^📦 Перемещение оборудования с актом$"), start_transfer)
        ],
        states={
            States.TRANSFER_WAIT_PHOTOS: [
                CommandHandler("done", receive_transfer_photos),
                MessageHandler(filters.PHOTO, receive_transfer_photos),
                MessageHandler(filters.Document.IMAGE, receive_transfer_photos),
                MessageHandler(filters.TEXT & ~filters.COMMAND & ~MAIN_MENU_BUTTONS_FILTER, receive_transfer_photos)
            ],
            States.TRANSFER_NEW_EMPLOYEE: [
                CallbackQueryHandler(handle_employee_suggestion_callback, pattern="^transfer_emp"),
                MessageHandler(filters.TEXT & ~filters.COMMAND & ~MAIN_MENU_BUTTONS_FILTER, receive_new_employee)
            ],
            States.TRANSFER_NEW_BRANCH: [
                CallbackQueryHandler(handle_transfer_branch_callback, pattern="^transfer_branch:"),
                MessageHandler(filters.TEXT & ~filters.COMMAND & ~MAIN_MENU_BUTTONS_FILTER, receive_transfer_branch)
            ],
            States.TRANSFER_NEW_LOCATION: [
                CallbackQueryHandler(handle_transfer_location_callback, pattern="^transfer_location"),
                MessageHandler(filters.TEXT & ~filters.COMMAND & ~MAIN_MENU_BUTTONS_FILTER, receive_transfer_location)
            ],
            States.TRANSFER_CONFIRMATION: [
                CallbackQueryHandler(handle_transfer_confirmation, pattern="^(confirm|cancel)_transfer$")
            ]
        },
        fallbacks=[
            CommandHandler("cancel", cancel),
            CommandHandler("start", start),
            
            
            
            
            
        ],
        name="transfer_conversation",
        persistent=False,
        allow_reentry=False
    )
    
    # ConversationHandler для управления БД
    database_conv_handler = ConversationHandler(
        entry_points=[
            MessageHandler(filters.Regex("^🗄️ Управление базами данных$"), show_database_menu)
        ],
        states={
            States.DB_SELECTION_MENU: [
                CallbackQueryHandler(handle_database_callback)
            ],
            States.DB_VIEW_PAGINATION: [
                CallbackQueryHandler(handle_equipment_pagination, pattern=r'^(eq_prev|eq_next|page_info)$'),
                CallbackQueryHandler(handle_database_callback)
            ]
        },
        fallbacks=[
            CommandHandler("cancel", cancel),
            CommandHandler("start", start),
            
            
            
            
            
        ],
        name="database_conversation",
        persistent=False,
        allow_reentry=False
    )
    
    # ConversationHandler для экспорта данных
    export_conv_handler = ConversationHandler(
        entry_points=[
            MessageHandler(filters.Regex("^📊 Экспорт данных$"), show_export_menu)
        ],
        states={
            States.DB_SELECTION_MENU: [
                CallbackQueryHandler(handle_export_type, pattern="^export_type:"),
                CallbackQueryHandler(handle_export_period, pattern="^export_period:"),
                CallbackQueryHandler(handle_export_period, pattern="^back_to_export_menu$"),
                CallbackQueryHandler(handle_export_database, pattern="^export_db:"),
                CallbackQueryHandler(handle_export_database, pattern="^back_to_period$"),
                CallbackQueryHandler(handle_delivery, pattern="^delivery:"),
                CallbackQueryHandler(handle_export_type, pattern="^back_to_main$")
            ],
            States.EMPLOYEE_EMAIL_INPUT: [
                MessageHandler(filters.TEXT & ~filters.COMMAND & ~MAIN_MENU_BUTTONS_FILTER, handle_email_input)
            ]
        },
        fallbacks=[
            CommandHandler("cancel", cancel),
            CommandHandler("start", start),
            
            
            
            
            
        ],
        name="export_conversation",
        persistent=False,
        allow_reentry=True
    )
    
    # ConversationHandler для работ
    work_conv_handler = ConversationHandler(
        entry_points=[
            MessageHandler(filters.Regex("^🔧 Работы$"), start_work)
        ],
        states={
            States.WORK_TYPE_SELECTION: [
                CallbackQueryHandler(handle_work_type, pattern="^work:"),
                CallbackQueryHandler(handle_work_type, pattern="^back_to_main$")
            ],
            States.WORK_BATTERY_SERIAL_INPUT: [
                MessageHandler(filters.PHOTO, work_battery_serial_input),
                MessageHandler(filters.Document.IMAGE, work_battery_serial_input),
                MessageHandler(filters.TEXT & ~filters.COMMAND & ~MAIN_MENU_BUTTONS_FILTER, work_battery_serial_input)
            ],
            States.WORK_BATTERY_CONFIRMATION: [
                CallbackQueryHandler(handle_work_confirmation, pattern="^(confirm|cancel)_work$")
            ],
            States.WORK_PC_CLEANING_SERIAL_INPUT: [
                MessageHandler(filters.PHOTO, work_pc_cleaning_serial_input),
                MessageHandler(filters.Document.IMAGE, work_pc_cleaning_serial_input),
                MessageHandler(filters.TEXT & ~filters.COMMAND & ~MAIN_MENU_BUTTONS_FILTER, work_pc_cleaning_serial_input)
            ],
            States.WORK_PC_CLEANING_CONFIRMATION: [
                CallbackQueryHandler(handle_work_confirmation, pattern="^(confirm|cancel)_work$")
            ],
            States.WORK_COMPONENT_SERIAL_INPUT: [
                MessageHandler(filters.PHOTO, work_component_serial_input),
                MessageHandler(filters.Document.IMAGE, work_component_serial_input),
                MessageHandler(filters.TEXT & ~filters.COMMAND & ~MAIN_MENU_BUTTONS_FILTER, work_component_serial_input)
            ],
            States.WORK_COMPONENT_SELECTION: [
                CallbackQueryHandler(handle_pc_component_selection, pattern="^pc_component:")
            ],
            States.WORK_COMPONENT_CONFIRMATION: [
                CallbackQueryHandler(handle_work_confirmation, pattern="^(confirm|cancel)_work$")
            ],
            States.WORK_SUCCESS: [
                CallbackQueryHandler(handle_work_success_action, pattern="^work:(pc_cleaning|battery_replacement|component_replacement)$"),
                CallbackQueryHandler(handle_work_success_action, pattern="^back_to_main$")
            ]
        },
        fallbacks=[
            CommandHandler("cancel", cancel),
            CommandHandler("start", start),
            
            
            
            
            
        ],
        name="work_conversation",
        persistent=False,
        allow_reentry=False
    )
    
    # Регистрируем ConversationHandler'ы
    # Кнопки главного меню обрабатываются через entry_points каждого ConversationHandler
    application.add_handler(search_conv_handler)
    application.add_handler(employee_conv_handler)
    application.add_handler(transfer_conv_handler)
    application.add_handler(database_conv_handler)
    application.add_handler(export_conv_handler)
    application.add_handler(work_conv_handler)

    # Обработчики для повторного запуска работ (кнопка "Обработать ещё")
    from bot.handlers.work import handle_restart_work, handle_back_to_main_external
    application.add_handler(CallbackQueryHandler(
        handle_restart_work,
        pattern="^work:(pc_cleaning|battery_replacement|component_replacement)$"
    ))

    # Обработчик для кнопки "Главное меню" (вызывается извне ConversationHandler)
    application.add_handler(CallbackQueryHandler(
        handle_back_to_main_external,
        pattern="^back_to_main$"
    ))

    # Обработчики для отправки актов на email (после ConversationHandler'ов)
    application.add_handler(CallbackQueryHandler(
        handle_act_action_callback, 
        pattern=r'^act:(email|email_input|email_owner|email_owners|skip)$'
    ))
    
    # Обработчик ввода email для актов (глобальный, в самом конце)
    application.add_handler(MessageHandler(
        filters.TEXT & ~filters.COMMAND,
        handle_act_email_input
    ))

    # Базовые команды (в конце, чтобы иметь приоритет над ConversationHandler)
    application.add_handler(CommandHandler("start", start))
    application.add_handler(CommandHandler("help", help_command))
    application.add_handler(CommandHandler("cancel", cancel))

    # Выбор базы данных для новых пользователей
    from bot.handlers.start import handle_database_selection
    application.add_handler(CallbackQueryHandler(handle_database_selection, pattern="^select_db:"))

    logger.info("Обработчики зарегистрированы: start, help, cancel, search, employee, transfer, database, export, act_email, db_selection")


def main() -> None:
    """Главная функция - точка входа в приложение"""
    logger.info("=" * 50)
    logger.info("Запуск IT-invent Bot v2.0 (модульная архитектура)")
    logger.info("=" * 50)

    try:
        try:
            store = get_local_store()
            logger.info(f"Local SQLite store: {store.db_path}")
        except Exception as sqlite_error:
            logger.warning(f"SQLite store init warning: {sqlite_error}")
        # Запускаем фоновые задачи обслуживания
        from bot.utils.maintenance import start_maintenance
        start_maintenance()

        # Создаем Application с увеличенным таймаутом
        from telegram.request import BaseRequest
        application = (
            Application.builder()
            .token(config.telegram.bot_token)
            .connect_timeout(60.0)  # Таймаут соединения
            .write_timeout(120.0)   # Таймаут записи
            .read_timeout(120.0)    # Таймаут чтения
            .pool_timeout(60.0)     # Таймаут пула соединений
            .build()
        )
        
        # Регистрируем обработчики
        register_handlers(application)
        
        logger.info("Бот успешно инициализирован")
        logger.info(f"Доступные базы данных: {', '.join(config.database.available_databases)}")
        logger.info("Бот запущен и ожидает сообщений...")
        
        # Запускаем бота
        application.run_polling(allowed_updates=Update.ALL_TYPES)
        
    except KeyboardInterrupt:
        logger.info("Получен сигнал остановки (Ctrl+C)")
    except Exception as e:
        logger.error(f"Критическая ошибка при запуске бота: {e}", exc_info=True)
        sys.exit(1)
    finally:
        # Останавливаем задачи обслуживания
        from bot.utils.maintenance import stop_maintenance
        stop_maintenance()
        logger.info("Бот остановлен")


if __name__ == "__main__":
    main()
