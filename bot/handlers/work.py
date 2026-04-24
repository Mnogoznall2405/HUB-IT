#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
Обработчики для регистрации выполненных работ
"""
import json
import logging
import os
import re
import traceback
from datetime import datetime
from pathlib import Path

from telegram import Update, InlineKeyboardButton, InlineKeyboardMarkup
from telegram.ext import ContextTypes, ConversationHandler

from bot.config import States, Messages
from bot.utils.decorators import handle_errors
from bot.utils.keyboards import create_main_menu_keyboard
from bot.services.input_identifier_service import (
    detect_identifiers_from_image,
    detect_identifiers_from_text,
)
from bot.services.validation import validate_serial_number
from bot.database_manager import database_manager
from bot.universal_database import UniversalInventoryDB
from bot.local_json_store import append_json_data, load_json_data

logger = logging.getLogger(__name__)


async def handle_serial_input_with_ocr(
    update: Update,
    context: ContextTypes.DEFAULT_TYPE,
    temp_file_prefix: str,
    user_data_serial_key: str,
    user_data_equipment_key: str,
    error_state: str,
    equipment_type_name: str,
    confirmation_handler: callable
) -> int:
    """
    Универсальный обработчик ввода серийного номера с поддержкой OCR

    Параметры:
        update: Объект обновления от Telegram API
        context: Контекст выполнения
        temp_file_prefix: Префикс временного файла (например, "temp_battery_")
        user_data_serial_key: Ключ для сохранения серийного номера в user_data
        user_data_equipment_key: Ключ для сохранения оборудования в user_data
        error_state: Состояние для возврата при ошибке
        equipment_type_name: Название типа оборудования (например, "ИБП", "ПК")
        confirmation_handler: Функция-обработчик подтверждения

    Возвращает:
        int: Следующее состояние
    """
    user_id = update.effective_user.id
    search_inv_no = None
    search_serial_no = None
    source_label = "manual"

    is_photo_message = bool(update.message and update.message.photo)
    is_document_image_message = bool(
        update.message
        and update.message.document
        and str(update.message.document.mime_type or "").startswith("image/")
    )
    is_text_message = bool(update.message and update.message.text)

    if is_photo_message or is_document_image_message:
        status_msg = await update.message.reply_text("🔍 Анализирую изображение...")
        file_path = None
        source_kind = "photo" if is_photo_message else "document"
        try:
            if is_photo_message:
                photo = update.message.photo[-1]
                incoming_file = await context.bot.get_file(photo.file_id)
                file_id = photo.file_id
                file_ext = ".jpg"
            else:
                document = update.message.document
                incoming_file = await context.bot.get_file(document.file_id)
                file_id = document.file_id
                original_name = str(document.file_name or "work_qr_image").strip()
                file_ext = os.path.splitext(original_name)[1] or ".jpg"
                logger.info(
                    "[WORK] received_document_image user_id=%s name=%s mime=%s size=%s",
                    user_id,
                    original_name,
                    document.mime_type,
                    document.file_size,
                )

            file_path = f"{temp_file_prefix}{file_id}{file_ext}"
            await incoming_file.download_to_drive(file_path)

            detection = await detect_identifiers_from_image(file_path)
            search_inv_no = detection.get("inv_no")
            search_serial_no = detection.get("serial_no")

            if detection.get("detector") == "qr":
                source_label = f"qr_{source_kind}"
                logger.info(
                    "[WORK][QR] detected_from_%s user_id=%s inv_no=%s serial_no=%s",
                    source_kind,
                    user_id,
                    search_inv_no or "-",
                    search_serial_no or "-",
                )
            elif detection.get("detector") == "ocr":
                source_label = f"ocr_{source_kind}"
                logger.info(
                    "[WORK][OCR] fallback_from_%s user_id=%s serial=%s",
                    source_kind,
                    user_id,
                    search_serial_no or "-",
                )
            else:
                logger.info("[WORK][QR] not_detected_from_%s user_id=%s", source_kind, user_id)

        except Exception as e:
            logger.error(f"Error processing image in work flow: {e}")
            await update.message.reply_text(
                "❌ Не удалось распознать QR/серийный номер.\n"
                "Пожалуйста, попробуйте другое изображение или введите номер вручную."
            )
            return error_state
        finally:
            try:
                if file_path and os.path.exists(file_path):
                    os.remove(file_path)
            except Exception:
                pass
            try:
                await status_msg.delete()
            except Exception:
                pass

    elif is_text_message:
        text_input = update.message.text.strip()
        detection = detect_identifiers_from_text(text_input)
        if detection.get("detector") == "qr":
            search_inv_no = detection.get("inv_no")
            search_serial_no = detection.get("serial_no")
            source_label = "qr_text"
            logger.info(
                "[WORK][QR] detected_from_text user_id=%s inv_no=%s serial_no=%s text_len=%s",
                user_id,
                search_inv_no or "-",
                search_serial_no or "-",
                len(text_input),
            )
        elif detection.get("detector") == "manual":
            search_serial_no = detection.get("serial_no")
            source_label = "manual_text"
            logger.info(
                "[WORK][QR] not_detected_from_text user_id=%s fallback_manual_serial=%s",
                user_id,
                search_serial_no or "-",
            )

    if not search_inv_no and not search_serial_no:
        await update.message.reply_text(
            "❌ Не удалось определить номер.\n"
            "Отправьте QR-code (фото/документ/текст) или серийный номер:"
        )
        return error_state

    if (
        not search_inv_no
        and search_serial_no
        and source_label in {"manual_text", "ocr_photo", "ocr_document"}
        and not validate_serial_number(search_serial_no)
    ):
        await update.message.reply_text(
            f"⚠️ Неверный формат серийного номера: {search_serial_no}\n\n"
            "Серийный номер должен содержать только буквы, цифры и символы: - _ . :\n"
            "Попробуйте еще раз:"
        )
        return error_state

    # Поиск оборудования в базе данных
    db_name = database_manager.get_user_database(user_id)
    config = database_manager.get_database_config(db_name)

    if config:
        db = UniversalInventoryDB(config)

        result = None
        if search_inv_no:
            logger.info("[WORK] try_inv_lookup user_id=%s inv_no=%s", user_id, search_inv_no)
            result = db.find_by_inventory_number(search_inv_no)
            logger.info("[WORK] inv_lookup_result user_id=%s found=%s", user_id, bool(result))

        if not result and search_serial_no:
            logger.info("[WORK] try_serial_lookup user_id=%s serial=%s", user_id, search_serial_no)
            result = db.find_by_serial_number(search_serial_no)
            logger.info("[WORK] serial_lookup_result user_id=%s found=%s", user_id, bool(result))

        # Проверяем тип результата - может быть список или одиночная запись
        equipment = None
        if isinstance(result, list):
            if result and len(result) > 0:
                equipment = result[0]
        elif result is not None:
            equipment = result

        if equipment:
            # Найдено оборудование - сохраняем данные
            serial_to_save = (
                equipment.get('SERIAL_NO')
                or equipment.get('HW_SERIAL_NO')
                or search_serial_no
                or search_inv_no
                or ''
            )
            context.user_data[user_data_serial_key] = serial_to_save
            context.user_data[user_data_equipment_key] = equipment

            # Показываем информацию для подтверждения
            return await confirmation_handler(update, context, equipment)
        else:
            # Оборудование не найдено
            target = search_inv_no or search_serial_no or "-"
            await update.message.reply_text(
                f"⚠️ {equipment_type_name} с номером <b>{target}</b> не найден в базе данных.\n\n"
                f"📊 База: {db_name}\n\n"
                "Проверьте номер и попробуйте снова:",
                parse_mode='HTML'
            )
            return error_state
    else:
        await update.message.reply_text("❌ Ошибка подключения к базе данных")
        return ConversationHandler.END


@handle_errors
async def start_work(update: Update, context: ContextTypes.DEFAULT_TYPE) -> int:
    """
    Начало процесса регистрации работы
    """
    logger.info(f"[WORK] Начало процесса регистрации работы, user_id={update.effective_user.id}")

    keyboard = [
        [InlineKeyboardButton("🔋 Замена батареи ИБП", callback_data="work:battery_replacement")],
        [InlineKeyboardButton("🖥️ Замена компонентов ПК", callback_data="work:component_replacement")],
        [InlineKeyboardButton("🧹 Чистка ПК", callback_data="work:pc_cleaning")],
        [InlineKeyboardButton("◀️ Назад", callback_data="back_to_main")]
    ]
    reply_markup = InlineKeyboardMarkup(keyboard)

    logger.info(
        "[WORK] Создана клавиатура с кнопками: "
        "battery_replacement, component_replacement, pc_cleaning, back_to_main"
    )

    if update.callback_query:
        logger.info(f"[WORK] Отправка меню через callback_query")
        await update.callback_query.edit_message_text(
            "🔧 <b>Регистрация выполненных работ</b>\n\n"
            "Выберите тип работы:",
            parse_mode='HTML',
            reply_markup=reply_markup
        )
    else:
        logger.info(f"[WORK] Отправка меню через message")
        await update.message.reply_text(
            "🔧 <b>Регистрация выполненных работ</b>\n\n"
            "Выберите тип работы:",
            parse_mode='HTML',
            reply_markup=reply_markup
        )

    logger.info(f"[WORK] Переход в состояние WORK_TYPE_SELECTION")
    return States.WORK_TYPE_SELECTION


@handle_errors
async def handle_work_type(update: Update, context: ContextTypes.DEFAULT_TYPE) -> int:
    """
    Обработчик выбора типа работы
    """
    query = update.callback_query
    await query.answer()

    callback_data = query.data

    logger.info(f"[WORK] Получен callback: {callback_data}, user_id={update.effective_user.id}")

    # Обработка кнопки "Назад"
    if callback_data == 'back_to_main':
        logger.info(f"[WORK] Обработка кнопки 'Назад' - возврат в главное меню")

        user_id = update.effective_user.id
        current_db = database_manager.get_user_database(user_id)

        logger.info(f"[WORK] Отправка сообщения о возврате в главное меню")
        await query.edit_message_text("✅ Возврат в главное меню")

        logger.info(f"[WORK] Отправка главного меню")
        await context.bot.send_message(
            chat_id=query.message.chat_id,
            text=f"{Messages.MAIN_MENU}\n\n📊 <b>Текущая база данных:</b> {current_db}",
            parse_mode='HTML',
            reply_markup=create_main_menu_keyboard()
        )

        logger.info(f"[WORK] Завершение ConversationHandler")
        return ConversationHandler.END

    work_type = callback_data.split(':', 1)[1] if ':' in callback_data else ''

    if work_type == 'cartridge':
        await query.edit_message_text(
            "⚠️ Регистрация замены комплектующих МФУ больше недоступна в боте.\n\n"
            "Доступны только замена батареи ИБП, замена компонентов ПК и чистка ПК."
        )
        return States.WORK_TYPE_SELECTION

    elif work_type == 'battery_replacement':
        context.user_data['work_type'] = 'battery_replacement'
        message_text = (
            "🔋 <b>Замена батареи ИБП</b>\n\n"
            "📷 Отправьте фото/документ с QR или серийным номером\n"
            "Или отправьте QR payload/серийный номер текстом:"
        )
        await query.edit_message_text(message_text, parse_mode='HTML')
        return States.WORK_BATTERY_SERIAL_INPUT

    elif work_type == 'component_replacement':
        context.user_data['work_type'] = 'component_replacement'
        message_text = (
            "🖥️ <b>Замена компонентов ПК</b>\n\n"
            "📷 Отправьте фото/документ с QR или серийным номером\n"
            "Или отправьте QR payload/серийный номер текстом:"
        )
        await query.edit_message_text(message_text, parse_mode='HTML')
        return States.WORK_COMPONENT_SERIAL_INPUT

    elif work_type == 'pc_cleaning':
        context.user_data['work_type'] = 'pc_cleaning'
        message_text = (
            "🖥️ <b>Чистка ПК</b>\n\n"
            "📷 Отправьте фото/документ с QR или серийным номером\n"
            "Или отправьте QR payload/серийный номер текстом:"
        )
        await query.edit_message_text(message_text, parse_mode='HTML')
        return States.WORK_PC_CLEANING_SERIAL_INPUT

    return States.WORK_TYPE_SELECTION


@handle_errors
async def handle_back_to_main_external(update: Update, context: ContextTypes.DEFAULT_TYPE) -> None:
    """
    Обработчик для кнопки "Главное меню" - вызывается извне ConversationHandler
    """
    query = update.callback_query
    await query.answer()

    user_id = update.effective_user.id
    current_db = database_manager.get_user_database(user_id)

    logger.info(f"[WORK] Возврат в главное меню (внешний обработчик)")

    await query.edit_message_text("✅ Возврат в главное меню")
    await context.bot.send_message(
        chat_id=query.message.chat_id,
        text=f"{Messages.MAIN_MENU}\n\n📊 <b>Текущая база данных:</b> {current_db}",
        parse_mode='HTML',
        reply_markup=create_main_menu_keyboard()
    )


@handle_errors
async def handle_restart_work(update: Update, context: ContextTypes.DEFAULT_TYPE) -> None:
    """
    Обработчик для кнопки "Обработать ещё" - запускает новую работу после завершения предыдущей
    Вызывается извне ConversationHandler
    """
    query = update.callback_query
    await query.answer()

    callback_data = query.data
    work_type = callback_data.split(':', 1)[1] if ':' in callback_data else ''

    logger.info(f"[WORK RESTART] Перезапуск работы: {work_type}")

    # Очищаем старые данные
    clear_work_data(context)

    # Отправляем сообщение в зависимости от типа работы
    if work_type == 'pc_cleaning':
        await context.bot.send_message(
            chat_id=query.message.chat_id,
            text="🖥️ <b>Чистка ПК</b>\n\n📷 Отправьте фото/документ с QR или серийным номером\nИли отправьте QR payload/серийный номер текстом:",
            parse_mode='HTML'
        )
    elif work_type == 'battery_replacement':
        await context.bot.send_message(
            chat_id=query.message.chat_id,
            text="🔋 <b>Замена батареи ИБП</b>\n\n📷 Отправьте фото/документ с QR или серийным номером\nИли отправьте QR payload/серийный номер текстом:",
            parse_mode='HTML'
        )
    elif work_type == 'component_replacement':
        await context.bot.send_message(
            chat_id=query.message.chat_id,
            text="🖥️ <b>Замена компонентов ПК</b>\n\n📷 Отправьте фото/документ с QR или серийным номером\nИли отправьте QR payload/серийный номер текстом:",
            parse_mode='HTML'
        )
    else:
        await context.bot.send_message(
            chat_id=query.message.chat_id,
            text="❌ Неизвестный тип работы"
        )
        return

    # Устанавливаем work_type для последующих обработчиков
    context.user_data['work_type'] = work_type


@handle_errors
async def work_battery_serial_input(update: Update, context: ContextTypes.DEFAULT_TYPE) -> int:
    """
    Обработчик ввода серийного номера ИБП с поддержкой OCR
    """
    return await handle_serial_input_with_ocr(
        update=update,
        context=context,
        temp_file_prefix="temp_battery_",
        user_data_serial_key="battery_serial_no",
        user_data_equipment_key="battery_equipment",
        error_state=States.WORK_BATTERY_SERIAL_INPUT,
        equipment_type_name="ИБП",
        confirmation_handler=show_battery_confirmation
    )


async def show_battery_confirmation(update: Update, context: ContextTypes.DEFAULT_TYPE, equipment: dict) -> int:
    """
    Показывает подтверждение для замены батареи ИБП
    """
    serial_no = equipment.get('SERIAL_NO', 'N/A')
    hw_serial_no = equipment.get('HW_SERIAL_NO', '')
    model_name = equipment.get('MODEL_NAME', 'Неизвестная модель')
    branch = equipment.get('BRANCH_NAME', 'Не указан')
    location = equipment.get('LOCATION', 'Не указано')
    employee = equipment.get('EMPLOYEE_NAME', 'Не назначен')

    # Формируем текст подтверждения
    serial_display = f"{serial_no} / {hw_serial_no}" if hw_serial_no else serial_no

    confirmation_text = (
        "📋 <b>Подтверждение замены батареи ИБП</b>\n\n"
        f"🔢 <b>Серийный номер:</b> {serial_display}\n"
        f"🖥️ <b>Модель:</b> {model_name}\n"
        f"🏢 <b>Филиал:</b> {branch}\n"
        f"📍 <b>Локация:</b> {location}\n"
        f"👤 <b>Сотрудник:</b> {employee}\n\n"
        "❓ Сохранить эти данные?"
    )

    keyboard = [
        [
            InlineKeyboardButton("✅ Сохранить", callback_data="confirm_work"),
            InlineKeyboardButton("❌ Отменить", callback_data="cancel_work")
        ]
    ]
    reply_markup = InlineKeyboardMarkup(keyboard)

    if update.callback_query:
        await update.callback_query.message.reply_text(
            confirmation_text,
            parse_mode='HTML',
            reply_markup=reply_markup
        )
    else:
        await update.message.reply_text(
            confirmation_text,
            parse_mode='HTML',
            reply_markup=reply_markup
        )

    return States.WORK_BATTERY_CONFIRMATION


@handle_errors
async def work_pc_cleaning_serial_input(update: Update, context: ContextTypes.DEFAULT_TYPE) -> int:
    """
    Обработчик ввода серийного номера ПК с поддержкой OCR
    """
    return await handle_serial_input_with_ocr(
        update=update,
        context=context,
        temp_file_prefix="temp_pc_cleaning_",
        user_data_serial_key="pc_cleaning_serial_no",
        user_data_equipment_key="pc_cleaning_equipment",
        error_state=States.WORK_PC_CLEANING_SERIAL_INPUT,
        equipment_type_name="ПК",
        confirmation_handler=show_pc_cleaning_confirmation
    )


async def show_pc_cleaning_confirmation(update: Update, context: ContextTypes.DEFAULT_TYPE, equipment: dict) -> int:
    """
    Показывает подтверждение для чистки ПК с информацией о последней чистке
    """
    serial_no = equipment.get('SERIAL_NO', 'N/A')
    hw_serial_no = equipment.get('HW_SERIAL_NO', '')
    model_name = equipment.get('MODEL_NAME', 'Неизвестная модель')
    branch = equipment.get('BRANCH_NAME', 'Не указан')
    location = equipment.get('LOCATION', 'Не указано')
    employee = equipment.get('EMPLOYEE_NAME', 'Не назначен')

    # Ищем последнюю чистку этого ПК
    last_cleaning_section = ""
    file_path = Path("data/pc_cleanings.json")

    try:
        cleanings = load_json_data(str(file_path), default_content=[])
        if not isinstance(cleanings, list):
            cleanings = []

        # Ищем чистки для этого серийного номера
        pc_cleanings = [
            c for c in cleanings
            if c.get('serial_no') == serial_no or c.get('serial_no') == hw_serial_no
        ]

        if pc_cleanings:
            pc_cleanings.sort(key=lambda x: x.get('timestamp', ''), reverse=True)
            last_cleaning = pc_cleanings[0]
            last_date = datetime.fromisoformat(last_cleaning['timestamp'])

            now = datetime.now()
            days_ago = (now - last_date).days
            if days_ago == 0:
                time_ago = "сегодня"
            elif days_ago == 1:
                time_ago = "вчера"
            elif days_ago < 7:
                time_ago = f"{days_ago} дн. назад"
            elif days_ago < 30:
                time_ago = f"{days_ago // 7} нед. назад"
            elif days_ago < 365:
                time_ago = f"{days_ago // 30} мес. назад"
            else:
                time_ago = f"{days_ago // 365} г. назад"

            last_cleaning_section = (
                "\n"
                f"🧹 <b>История чисток</b>\n"
                f"📅 <b>Последняя:</b> {last_date.strftime('%d.%m.%Y')} в {last_date.strftime('%H:%M')}\n"
                f"🕒 <b>Давность:</b> {time_ago}\n"
                f"🔁 <b>Всего чисток:</b> {len(pc_cleanings)}\n"
            )
    except Exception as e:
        logger.error(f"Error reading pc_cleanings data: {e}")

    serial_display = f"{serial_no} / {hw_serial_no}" if hw_serial_no else serial_no

    confirmation_text = (
        "📋 <b>Подтверждение чистки ПК</b>\n\n"
        f"🔢 <b>Серийный номер:</b> {serial_display}\n"
        f"🖥️ <b>Модель:</b> {model_name}\n"
        f"🏢 <b>Филиал:</b> {branch}\n"
        f"📍 <b>Локация:</b> {location}\n"
        f"👤 <b>Сотрудник:</b> {employee}\n"
        f"{last_cleaning_section}"
        "❓ Сохранить новую чистку?"
    )

    keyboard = [
        [
            InlineKeyboardButton("✅ Сохранить", callback_data="confirm_work"),
            InlineKeyboardButton("❌ Отменить", callback_data="cancel_work")
        ]
    ]
    reply_markup = InlineKeyboardMarkup(keyboard)

    if update.callback_query:
        await update.callback_query.message.reply_text(
            confirmation_text,
            parse_mode='HTML',
            reply_markup=reply_markup
        )
    else:
        await update.message.reply_text(
            confirmation_text,
            parse_mode='HTML',
            reply_markup=reply_markup
        )

    return States.WORK_PC_CLEANING_CONFIRMATION


@handle_errors
async def handle_work_confirmation(update: Update, context: ContextTypes.DEFAULT_TYPE) -> int:
    """
    Обработчик подтверждения сохранения работы
    """
    query = update.callback_query
    await query.answer()

    if query.data == "confirm_work":
        # Сохраняем user_id для функций сохранения
        context._user_id = update.effective_user.id

        # Сохраняем данные
        work_type = context.user_data.get('work_type')

        if work_type == 'battery_replacement':
            success = await save_battery_replacement(context)
        elif work_type == 'pc_cleaning':
            success = await save_pc_cleaning(context)
        elif work_type == 'component_replacement':
            success = await save_component_replacement_pc(context)
        else:
            success = False
            logger.error(f"Неизвестный тип работы: {work_type}")

        if success:
            # Получаем work_type до очистки данных
            work_type = context.user_data.get('work_type', '')

            # Создаем клавиатуру с кнопками
            keyboard = []
            if work_type == 'pc_cleaning':
                keyboard.append([
                    InlineKeyboardButton("🔄 Обработать еще", callback_data="work:pc_cleaning"),
                    InlineKeyboardButton("🏠 Главное меню", callback_data="back_to_main")
                ])
            elif work_type == 'battery_replacement':
                keyboard.append([
                    InlineKeyboardButton("🔄 Обработать еще", callback_data="work:battery_replacement"),
                    InlineKeyboardButton("🏠 Главное меню", callback_data="back_to_main")
                ])
            elif work_type == 'component_replacement':
                keyboard.append([
                    InlineKeyboardButton("🔄 Обработать еще", callback_data="work:component_replacement"),
                    InlineKeyboardButton("🏠 Главное меню", callback_data="back_to_main")
                ])
            else:
                keyboard.append([InlineKeyboardButton("🏠 Главное меню", callback_data="back_to_main")])

            reply_markup = InlineKeyboardMarkup(keyboard)

            await query.edit_message_text(
                "✅ Данные успешно сохранены!\n"
                "Информация о выполненной работе добавлена.",
                reply_markup=reply_markup
            )

            # НЕ очищаем work_type - он нужен для кнопки "Обработать еще"
            # Очищаем только данные оборудования
            context.user_data.pop('battery_equipment', None)
            context.user_data.pop('pc_cleaning_equipment', None)
            context.user_data.pop('component_replacement_equipment', None)
            context.user_data.pop('battery_serial_no', None)
            context.user_data.pop('pc_cleaning_serial_no', None)
            context.user_data.pop('component_replacement_serial_no', None)
            context.user_data.pop('pc_component_type', None)
            context.user_data.pop('pc_component_name', None)

            # Переходим в состояние успеха - разговор остается активным
            return States.WORK_SUCCESS
        else:
            await query.edit_message_text(
                "❌ Ошибка при сохранении данных.\n"
                "Попробуйте еще раз."
            )
            clear_work_data(context)
            return ConversationHandler.END

    elif query.data == "cancel_work":
        await query.edit_message_text("❌ Операция отменена.")
        clear_work_data(context)

        return ConversationHandler.END

    return ConversationHandler.END


@handle_errors
async def handle_work_success_action(update: Update, context: ContextTypes.DEFAULT_TYPE) -> int:
    """
    Обработчик действий из состояния успеха (кнопки "Обработать еще" и "Главное меню")
    """
    query = update.callback_query
    await query.answer()

    callback_data = query.data

    # Обработка кнопки "Назад в главное меню"
    if callback_data == 'back_to_main':
        user_id = update.effective_user.id
        current_db = database_manager.get_user_database(user_id)

        await query.edit_message_text("✅ Возврат в главное меню")
        await context.bot.send_message(
            chat_id=query.message.chat_id,
            text=f"{Messages.MAIN_MENU}\n\n📊 <b>Текущая база данных:</b> {current_db}",
            parse_mode='HTML',
            reply_markup=create_main_menu_keyboard()
        )

        clear_work_data(context)
        return ConversationHandler.END

    # Обработка кнопки "Обработать еще"
    if callback_data.startswith('work:'):
        work_type = callback_data.split(':', 1)[1] if ':' in callback_data else ''

        logger.info(f"[WORK SUCCESS] Перезапуск работы: {work_type}")

        # Очищаем старые данные оборудования, но оставляем work_type
        context.user_data.pop('battery_equipment', None)
        context.user_data.pop('pc_cleaning_equipment', None)
        context.user_data.pop('component_replacement_equipment', None)
        context.user_data.pop('battery_serial_no', None)
        context.user_data.pop('pc_cleaning_serial_no', None)
        context.user_data.pop('component_replacement_serial_no', None)
        context.user_data.pop('pc_component_type', None)
        context.user_data.pop('pc_component_name', None)

        # Устанавливаем work_type
        context.user_data['work_type'] = work_type

        # Отправляем сообщение в зависимости от типа работы
        if work_type == 'pc_cleaning':
            await query.edit_message_text(
                "🖥️ <b>Чистка ПК</b>\n\n"
                "📷 Отправьте фото/документ с QR или серийным номером\n"
                "Или отправьте QR payload/серийный номер текстом:",
                parse_mode='HTML'
            )
            return States.WORK_PC_CLEANING_SERIAL_INPUT
        elif work_type == 'battery_replacement':
            await query.edit_message_text(
                "🔋 <b>Замена батареи ИБП</b>\n\n"
                "📷 Отправьте фото/документ с QR или серийным номером\n"
                "Или отправьте QR payload/серийный номер текстом:",
                parse_mode='HTML'
            )
            return States.WORK_BATTERY_SERIAL_INPUT
        elif work_type == 'component_replacement':
            await query.edit_message_text(
                "🖥️ <b>Замена компонентов ПК</b>\n\n"
                "📷 Отправьте фото/документ с QR или серийным номером\n"
                "Или отправьте QR payload/серийный номер текстом:",
                parse_mode='HTML'
            )
            return States.WORK_COMPONENT_SERIAL_INPUT
    return States.WORK_SUCCESS


async def save_battery_replacement(context: ContextTypes.DEFAULT_TYPE) -> bool:
    """
    Сохраняет данные о замене батареи ИБП в JSON и обновляет описание в базе данных
    """
    try:
        file_path = Path("data/battery_replacements.json")

        # Получаем текущую БД пользователя
        user_id = context._user_id if hasattr(context, '_user_id') else None
        db_name = database_manager.get_user_database(user_id) if user_id else 'ITINVENT'

        # Получаем данные об ИБП
        equipment = context.user_data.get('battery_equipment', {})
        equipment_id = equipment.get('ID')
        current_description = equipment.get('DESCRIPTION') or ''

        # Формируем строку с датой замены батареи
        replacement_date = datetime.now().strftime("%d.%m.%Y %H:%M")
        replacement_note = f"\r\nПоследняя замена батареи: {replacement_date} (IT-BOT)"

        # Обновляем описание в базе данных
        if equipment_id:
            config = database_manager.get_database_config(db_name)
            if config:
                db = UniversalInventoryDB(config)

                # Проверяем, есть ли уже запись о замене батареи в описании
                if "Последняя замена батареи:" in current_description:
                    # Обновляем последнюю запись о замене
                    new_description = re.sub(
                        r'Последняя замена батареи:.*?\(IT-BOT\)',
                        f'Последняя замена батареи: {replacement_date} (IT-BOT)',
                        current_description
                    )
                else:
                    # Добавляем новую запись к описанию
                    new_description = current_description + replacement_note

                # UPDATE в базе
                try:
                    with db._get_connection() as conn:
                        cursor = conn.cursor()
                        cursor.execute("""
                            UPDATE ITEMS
                            SET DESCR = ?, CH_DATE = GETDATE(), CH_USER = 'IT-BOT'
                            WHERE ID = ?
                        """, (new_description, equipment_id))
                        conn.commit()
                        logger.info(f"Обновлено описание для ID={equipment_id}: добавлена замена батареи от {replacement_date}")
                except Exception as e:
                    logger.error(f"Ошибка обновления описания: {e}")

        # Создаем запись для JSON
        record = {
            'serial_no': context.user_data.get('battery_serial_no', ''),
            'hw_serial_no': equipment.get('HW_SERIAL_NO', ''),
            'model_name': equipment.get('MODEL_NAME', ''),
            'manufacturer': equipment.get('MANUFACTURER', ''),
            'branch': equipment.get('BRANCH_NAME', ''),
            'location': equipment.get('LOCATION', ''),
            'employee': equipment.get('EMPLOYEE_NAME', ''),
            'inv_no': equipment.get('INV_NO', ''),
            'db_name': db_name,
            'timestamp': datetime.now().isoformat()
        }

        saved = append_json_data(str(file_path), record)
        if not saved:
            logger.error("Не удалось сохранить замену батареи в локальное хранилище: file=%s", file_path.name)
            return False

        logger.info("Сохранена замена батареи ИБП: storage=sqlite file=%s db_name=%s", file_path.name, db_name)
        return True

    except Exception as e:
        logger.error(f"Ошибка сохранения замены батареи: {e}")
        traceback.print_exc()
        return False


async def save_pc_cleaning(context: ContextTypes.DEFAULT_TYPE) -> bool:
    """
    Сохраняет данные о чистке ПК в JSON и обновляет описание в базе данных
    """
    try:
        file_path = Path("data/pc_cleanings.json")

        # Получаем текущую БД пользователя
        user_id = context._user_id if hasattr(context, '_user_id') else None
        db_name = database_manager.get_user_database(user_id) if user_id else 'ITINVENT'

        # Получаем данные о ПК
        equipment = context.user_data.get('pc_cleaning_equipment', {})
        equipment_id = equipment.get('ID')
        current_description = equipment.get('DESCRIPTION') or ''

        # Формируем строку с датой чистки (используем \r\n для переноса строки в SQL Server)
        cleaning_date = datetime.now().strftime("%d.%m.%Y %H:%M")
        cleaning_note = f"\r\nПоследняя чистка: {cleaning_date} (IT-BOT)"

        # Обновляем описание в базе данных
        if equipment_id:
            config = database_manager.get_database_config(db_name)
            if config:
                db = UniversalInventoryDB(config)

                # Проверяем, есть ли уже запись о чистке в описании
                if "Последняя чистка:" in current_description:
                    # Обновляем последнюю запись о чистке
                    # Заменяем последнюю запись о чистке на новую
                    new_description = re.sub(
                        r'Последняя чистка:.*?\(IT-BOT\)',
                        f'Последняя чистка: {cleaning_date} (IT-BOT)',
                        current_description
                    )
                else:
                    # Добавляем новую запись к описанию
                    new_description = current_description + cleaning_note

                # UPDATE в базе
                try:
                    with db._get_connection() as conn:
                        cursor = conn.cursor()
                        cursor.execute("""
                            UPDATE ITEMS
                            SET DESCR = ?, CH_DATE = GETDATE(), CH_USER = 'IT-BOT'
                            WHERE ID = ?
                        """, (new_description, equipment_id))
                        conn.commit()
                        logger.info(f"Обновлено описание для ID={equipment_id}: добавлена чистка от {cleaning_date}")
                except Exception as e:
                    logger.error(f"Ошибка обновления описания: {e}")

        # Создаем запись для JSON
        record = {
            'serial_no': context.user_data.get('pc_cleaning_serial_no', ''),
            'hw_serial_no': equipment.get('HW_SERIAL_NO', ''),
            'model_name': equipment.get('MODEL_NAME', ''),
            'manufacturer': equipment.get('MANUFACTURER', ''),
            'branch': equipment.get('BRANCH_NAME', ''),
            'location': equipment.get('LOCATION', ''),
            'employee': equipment.get('EMPLOYEE_NAME', ''),
            'inv_no': equipment.get('INV_NO', ''),
            'db_name': db_name,
            'timestamp': datetime.now().isoformat()
        }

        saved = append_json_data(str(file_path), record)
        if not saved:
            logger.error("Не удалось сохранить чистку ПК в локальное хранилище: file=%s", file_path.name)
            return False

        logger.info("Сохранена чистка ПК: storage=sqlite file=%s db_name=%s", file_path.name, db_name)
        return True

    except Exception as e:
        logger.error(f"Ошибка сохранения чистки ПК: {e}")
        traceback.print_exc()
        return False


def clear_work_data(context: ContextTypes.DEFAULT_TYPE):
    """
    Очищает временные данные работы
    """
    keys_to_clear = [
        'work_type',
        'battery_serial_no', 'battery_equipment',
        'pc_cleaning_serial_no', 'pc_cleaning_equipment',
        'component_replacement_serial_no', 'component_replacement_equipment',
        'pc_component_type', 'pc_component_name'
    ]

    for key in keys_to_clear:
        context.user_data.pop(key, None)



@handle_errors
async def work_component_serial_input(update: Update, context: ContextTypes.DEFAULT_TYPE) -> int:
    """
    Обработчик ввода серийного номера ПК для замены компонента с поддержкой OCR
    """
    return await handle_serial_input_with_ocr(
        update=update,
        context=context,
        temp_file_prefix="temp_component_replacement_",
        user_data_serial_key="component_replacement_serial_no",
        user_data_equipment_key="component_replacement_equipment",
        error_state=States.WORK_COMPONENT_SERIAL_INPUT,
        equipment_type_name="ПК",
        confirmation_handler=show_component_selection_pc
    )


async def show_component_selection_pc(update: Update, context: ContextTypes.DEFAULT_TYPE, equipment: dict) -> int:
    """
    Показывает меню выбора компонента ПК для замены
    """
    serial_no = equipment.get('SERIAL_NO', 'N/A')
    hw_serial_no = equipment.get('HW_SERIAL_NO', '')
    model_name = equipment.get('MODEL_NAME', 'Неизвестная модель')

    # Формируем текст с информацией о ПК
    serial_display = f"{serial_no} / {hw_serial_no}" if hw_serial_no else serial_no

    message_text = (
        f"🖥️ <b>Замена компонентов ПК</b>\n\n"
        f"🔢 <b>Серийный номер:</b> {serial_display}\n"
        f"💻 <b>Модель:</b> {model_name}\n\n"
        f"🔧 Выберите компонент для замены:"
    )

    # Создаем клавиатуру с компонентами ПК
    keyboard = [
        [InlineKeyboardButton("💾 HDD/SSD (Накопитель)", callback_data="pc_component:hdd_ssd")],
        [InlineKeyboardButton("❄️ Кулер (Охлаждение)", callback_data="pc_component:cooler")],
        [InlineKeyboardButton("🔲 Материнская плата", callback_data="pc_component:motherboard")],
        [InlineKeyboardButton("🎮 Оперативная память (RAM)", callback_data="pc_component:ram")],
        [InlineKeyboardButton("⚡ Блок питания (PSU)", callback_data="pc_component:psu")],
        [InlineKeyboardButton("📺 Видеокарта (GPU)", callback_data="pc_component:gpu")],
        [InlineKeyboardButton("🔧 Другое", callback_data="pc_component:other")],
        [InlineKeyboardButton("❌ Отмена", callback_data="pc_component:cancel")]
    ]
    reply_markup = InlineKeyboardMarkup(keyboard)

    if update.callback_query:
        await update.callback_query.message.reply_text(
            message_text,
            reply_markup=reply_markup,
            parse_mode='HTML'
        )
    else:
        await update.message.reply_text(
            message_text,
            reply_markup=reply_markup,
            parse_mode='HTML'
        )

    return States.WORK_COMPONENT_SELECTION


@handle_errors
async def handle_pc_component_selection(update: Update, context: ContextTypes.DEFAULT_TYPE) -> int:
    """
    Обработчик выбора компонента ПК для замены
    """
    query = update.callback_query
    await query.answer()

    data = query.data

    if data.startswith('pc_component:'):
        component_type = data.split(':', 1)[1] if ':' in data else ''

        if component_type == 'cancel':
            await query.edit_message_text("❌ Операция отменена")
            clear_work_data(context)
            return ConversationHandler.END

        # Маппинг типов компонентов к их отображаемым именам
        component_names = {
            'hdd_ssd': 'HDD/SSD (Накопитель)',
            'cooler': 'Кулер (Охлаждение)',
            'motherboard': 'Материнская плата',
            'ram': 'Оперативная память (RAM)',
            'psu': 'Блок питания (PSU)',
            'gpu': 'Видеокарта (GPU)',
            'other': 'Другое'
        }

        component_name = component_names.get(component_type, component_type)
        context.user_data['pc_component_type'] = component_type
        context.user_data['pc_component_name'] = component_name

        # Показываем подтверждение
        return await show_component_confirmation_pc(update, context)

    return States.WORK_COMPONENT_SELECTION

@handle_errors
async def show_component_confirmation_pc(update: Update, context: ContextTypes.DEFAULT_TYPE) -> int:
    """
    Показывает подтверждение для замены компонента ПК
    """
    equipment = context.user_data.get('component_replacement_equipment', {})
    component_name = context.user_data.get('pc_component_name', 'Неизвестный компонент')

    serial_no = equipment.get('SERIAL_NO', 'N/A')
    hw_serial_no = equipment.get('HW_SERIAL_NO', '')
    model_name = equipment.get('MODEL_NAME', 'Неизвестная модель')
    branch = equipment.get('BRANCH_NAME', 'Не указан')
    location = equipment.get('LOCATION', 'Не указано')
    employee = equipment.get('EMPLOYEE_NAME', 'Не назначен')

    # Ищем последнюю замену этого компонента для этого ПК
    last_replacement_section = ""
    file_path = Path("data/component_replacements.json")

    component_type = context.user_data.get('pc_component_type', '')

    try:
        replacements = load_json_data(str(file_path), default_content=[])
        if not isinstance(replacements, list):
            replacements = []

        pc_replacements = [
            r for r in replacements
            if (r.get('serial_no') == serial_no or r.get('serial_no') == hw_serial_no)
            and r.get('component_type') == component_type
        ]

        if pc_replacements:
            pc_replacements.sort(key=lambda x: x.get('timestamp', ''), reverse=True)
            last_replacement = pc_replacements[0]
            last_date = datetime.fromisoformat(last_replacement['timestamp'])

            days_ago = (datetime.now() - last_date).days
            if days_ago == 0:
                time_ago = "сегодня"
            elif days_ago == 1:
                time_ago = "вчера"
            elif days_ago < 7:
                time_ago = f"{days_ago} дн. назад"
            elif days_ago < 30:
                time_ago = f"{days_ago // 7} нед. назад"
            elif days_ago < 365:
                time_ago = f"{days_ago // 30} мес. назад"
            else:
                time_ago = f"{days_ago // 365} г. назад"

            last_replacement_section = (
                "\n"
                f"🧾 <b>История замен</b>\n"
                f"📅 <b>Последняя:</b> {last_date.strftime('%d.%m.%Y')} в {last_date.strftime('%H:%M')}\n"
                f"🕒 <b>Давность:</b> {time_ago}\n"
                f"🔁 <b>Всего замен:</b> {len(pc_replacements)}\n"
            )
    except Exception as e:
        logger.error(f"Error reading component_replacements data: {e}")

    serial_display = f"{serial_no} / {hw_serial_no}" if hw_serial_no else serial_no

    confirmation_text = (
        "📋 <b>Подтверждение замены компонента ПК</b>\n\n"
        f"🔢 <b>Серийный номер:</b> {serial_display}\n"
        f"💻 <b>Модель:</b> {model_name}\n"
        f"🏢 <b>Филиал:</b> {branch}\n"
        f"📍 <b>Локация:</b> {location}\n"
        f"👤 <b>Сотрудник:</b> {employee}\n"
        f"🔧 <b>Компонент:</b> {component_name}\n"
        f"{last_replacement_section}"
        "❓ Сохранить эти данные?"
    )

    keyboard = [
        [
            InlineKeyboardButton("✅ Сохранить", callback_data="confirm_work"),
            InlineKeyboardButton("❌ Отменить", callback_data="cancel_work")
        ]
    ]
    reply_markup = InlineKeyboardMarkup(keyboard)

    if update.callback_query:
        await update.callback_query.message.reply_text(
            confirmation_text,
            parse_mode='HTML',
            reply_markup=reply_markup
        )
    else:
        await update.message.reply_text(
            confirmation_text,
            parse_mode='HTML',
            reply_markup=reply_markup
        )

    return States.WORK_COMPONENT_CONFIRMATION


async def save_component_replacement_pc(context: ContextTypes.DEFAULT_TYPE) -> bool:
    """
    Сохраняет данные о замене компонента ПК в JSON и обновляет описание в базе данных
    """
    try:
        file_path = Path("data/component_replacements.json")

        # Получаем текущую БД пользователя
        user_id = context._user_id if hasattr(context, '_user_id') else None
        db_name = database_manager.get_user_database(user_id) if user_id else 'ITINVENT'

        # Получаем данные о ПК
        equipment = context.user_data.get('component_replacement_equipment', {})
        equipment_id = equipment.get('ID')
        current_description = equipment.get('DESCRIPTION') or ''

        component_name = context.user_data.get('pc_component_name', 'Неизвестный компонент')
        component_type = context.user_data.get('pc_component_type', 'other')

        # Формируем строку с датой замены компонента (используем \r\n для переноса строки)
        replacement_date = datetime.now().strftime("%d.%m.%Y %H:%M")
        replacement_note = f"\r\nЗамена {component_name}: {replacement_date} (IT-BOT)"

        # Обновляем описание в базе данных
        if equipment_id:
            config = database_manager.get_database_config(db_name)
            if config:
                db = UniversalInventoryDB(config)

                # Проверяем, есть ли уже запись о замене этого компонента в описании
                # Используем regex для поиска существующей записи
                pattern = rf'Замена {re.escape(component_name)}:.*?\(IT-BOT\)'
                if re.search(pattern, current_description):
                    # Обновляем последнюю запись о замене
                    new_description = re.sub(
                        pattern,
                        f'Замена {component_name}: {replacement_date} (IT-BOT)',
                        current_description
                    )
                else:
                    # Добавляем новую запись к описанию
                    new_description = current_description + replacement_note

                # UPDATE в базе
                try:
                    with db._get_connection() as conn:
                        cursor = conn.cursor()
                        cursor.execute("""
                            UPDATE ITEMS
                            SET DESCR = ?, CH_DATE = GETDATE(), CH_USER = 'IT-BOT'
                            WHERE ID = ?
                        """, (new_description, equipment_id))
                        conn.commit()
                        logger.info(f"Обновлено описание для ID={equipment_id}: добавлена замена {component_name} от {replacement_date}")
                except Exception as e:
                    logger.error(f"Ошибка обновления описания: {e}")

        # Создаем запись для JSON
        record = {
            'serial_no': context.user_data.get('component_replacement_serial_no', ''),
            'hw_serial_no': equipment.get('HW_SERIAL_NO', ''),
            'model_name': equipment.get('MODEL_NAME', ''),
            'manufacturer': equipment.get('MANUFACTURER', ''),
            'branch': equipment.get('BRANCH_NAME', ''),
            'location': equipment.get('LOCATION', ''),
            'employee': equipment.get('EMPLOYEE_NAME', ''),
            'inv_no': equipment.get('INV_NO', ''),
            'component_type': component_type,
            'component_name': component_name,
            'db_name': db_name,
            'timestamp': datetime.now().isoformat()
        }

        saved = append_json_data(str(file_path), record)
        if not saved:
            logger.error("Не удалось сохранить замену компонента ПК в локальное хранилище: file=%s", file_path.name)
            return False

        logger.info("Сохранена замена компонента ПК: storage=sqlite file=%s db_name=%s", file_path.name, db_name)
        return True

    except Exception as e:
        logger.error(f"Ошибка сохранения замены компонента ПК: {e}")
        traceback.print_exc()
        return False
