#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
Обработчики перемещения оборудования с актом приема-передачи
Загрузка фотографий, распознавание серийных номеров, генерация PDF-акта.
"""
import asyncio
import copy
import logging
import os
from datetime import datetime
from typing import Any
from uuid import uuid4
from telegram import Update, ReplyKeyboardRemove, InlineKeyboardMarkup, InlineKeyboardButton
from telegram.ext import ContextTypes, ConversationHandler
from telegram.error import TimedOut

from bot.config import States, Messages, StorageKeys
from bot.utils.decorators import require_user_access, handle_errors
from bot.services.input_identifier_service import detect_identifiers_from_image, detect_identifiers_from_text
from bot.services.validation import validate_employee_name, validate_serial_number
from bot.database_manager import database_manager
from bot.equipment_data_manager import EquipmentDataManager
from bot.services.transfer_operation_store import (
    BotTransferOperationStore,
    TransferOperationConflict,
)
from shared.transfer_command import TransferCommandOutcome, run_transfer_command

logger = logging.getLogger(__name__)

# Глобальный менеджер данных
equipment_manager = EquipmentDataManager()
transfer_operation_store = BotTransferOperationStore()


TRANSFER_OPERATION_ID_KEY = "transfer_operation_id"
TRANSFER_OPERATION_STATE_KEY = "transfer_operation_state"
TRANSFER_RETRY_SERIALS_KEY = "transfer_retry_serials"
ONE_C_SYNC_STATE_NOT_REQUESTED = "not_requested"
TRANSFER_CONFIRM_CALLBACK_PREFIX = "confirm_transfer:"


def _new_transfer_operation_id() -> str:
    """Return an idempotency key compatible with the Web transfer contract."""
    return f"bot-{uuid4()}"


def _ensure_transfer_operation_id(context: ContextTypes.DEFAULT_TYPE) -> str:
    operation_id = str(context.user_data.get(TRANSFER_OPERATION_ID_KEY) or "").strip()
    if operation_id:
        return operation_id

    operation_id = _new_transfer_operation_id()
    context.user_data[TRANSFER_OPERATION_ID_KEY] = operation_id
    context.user_data.setdefault(TRANSFER_OPERATION_STATE_KEY, "draft")
    return operation_id


def _operation_id_from_callback(callback_data: str) -> str:
    value = str(callback_data or "")
    if not value.startswith(TRANSFER_CONFIRM_CALLBACK_PREFIX):
        return ""
    return value[len(TRANSFER_CONFIRM_CALLBACK_PREFIX):].strip()


def _is_confirm_transfer_callback(callback_data: str) -> bool:
    value = str(callback_data or "")
    return value == "confirm_transfer" or bool(_operation_id_from_callback(value))


def _has_recorded_transfer_operation(operation_id: str) -> bool:
    """Check the local ledger without blocking a new transfer on a read error."""
    try:
        return equipment_manager.has_transfer_operation(operation_id)
    except Exception as exc:
        logger.warning("Не удалось проверить operation_id=%s в журнале перемещений: %s", operation_id, exc)
        return False


# ============================ ОБРАБОТЧИК ПАГИНАЦИИ ============================
# Импортируем универсальные обработчики локаций из location.py
from bot.handlers.location import (
    _transfer_location_pagination_handler,
    show_location_buttons,
    handle_location_navigation_universal
)


async def send_document_with_retry(
    context: ContextTypes.DEFAULT_TYPE,
    chat_id: int,
    document_path: str,
    filename: str,
    caption: str,
    max_retries: int = 3
) -> bool:
    """
    Отправляет документ с автоматическим повтором при timed out ошибке

    Параметры:
        context: Контекст выполнения бота
        chat_id: ID чата для отправки
        document_path: Путь к файлу
        filename: Имя файла
        caption: Подпись к документу
        max_retries: Максимальное количество попыток

    Возвращает:
        bool: True если успешно отправлено, False иначе
    """
    for attempt in range(max_retries):
        try:
            with open(document_path, 'rb') as doc_file:
                await context.bot.send_document(
                    chat_id=chat_id,
                    document=doc_file,
                    filename=filename,
                    caption=caption
                )
            logger.info(f"Документ успешно отправлен с попытки {attempt + 1}")
            return True

        except TimedOut as e:
            logger.warning(f"Попытка {attempt + 1}/{max_retries}: Таймаут отправки документа {filename}")
            if attempt < max_retries - 1:
                # Ждем перед следующей попыткой
                wait_time = (attempt + 1) * 2  # 2, 4, 6 секунд
                logger.info(f"Ждем {wait_time} сек. перед повторной попыткой...")
                await asyncio.sleep(wait_time)
            else:
                logger.error(f"Не удалось отправить документ после {max_retries} попыток")

        except Exception as e:
            logger.error(f"Ошибка отправки документа {filename}: {e}")
            # Другие ошибки не retry'им
            break

    return False


def _coerce_item_id(value: Any) -> int | None:
    try:
        item_id = int(value)
    except (TypeError, ValueError):
        return None
    return item_id if item_id > 0 else None


def _resolve_grouped_equipment_item_ids(
    transfer_db,
    grouped_equipment: dict[str, list[dict]],
) -> tuple[dict[str, list[dict]], list[dict[str, Any]]]:
    """Resolve every selected card before the first inventory mutation.

    The scan result normally already contains ``ITEMS.ID``.  It is still
    checked against the database so a deleted/non-equipment card cannot enter
    a transfer.  Legacy contexts without an id are resolved once by serial and
    immediately converted to an immutable id.
    """
    resolved_groups: dict[str, list[dict]] = {}
    failures: list[dict[str, Any]] = []
    seen_item_ids: set[int] = set()

    for old_employee, equipment_list in grouped_equipment.items():
        for raw_item in equipment_list:
            item = copy.deepcopy(raw_item if isinstance(raw_item, dict) else {})
            equipment = item.get("equipment") if isinstance(item.get("equipment"), dict) else {}
            serial = str(item.get("serial") or equipment.get("SERIAL_NO") or equipment.get("HW_SERIAL_NO") or "").strip()
            requested_item_id = _coerce_item_id(item.get("item_id") or equipment.get("ID") or equipment.get("id"))

            try:
                if requested_item_id is not None:
                    resolved = transfer_db.resolve_transfer_item_by_id(requested_item_id)
                else:
                    resolved = transfer_db.resolve_transfer_item_by_serial(serial)
            except Exception as exc:
                logger.error("Не удалось разрешить ITEMS.ID для %s: %s", serial or requested_item_id, exc, exc_info=True)
                resolved = {"success": False, "message": str(exc)}

            if not resolved.get("success"):
                failures.append(
                    {
                        "item_id": requested_item_id or "",
                        "serial": serial,
                        "error": str(resolved.get("message") or "Не удалось определить ITEMS.ID"),
                        "retryable": True,
                    }
                )
                continue

            item_id = _coerce_item_id(resolved.get("item_id"))
            if item_id is None:
                failures.append(
                    {
                        "item_id": "",
                        "serial": serial,
                        "error": "База не вернула корректный ITEMS.ID",
                        "retryable": False,
                    }
                )
                continue
            if item_id in seen_item_ids:
                failures.append(
                    {
                        "item_id": item_id,
                        "serial": serial,
                        "error": "Одна карточка ITEMS.ID повторяется в операции",
                        "retryable": False,
                    }
                )
                continue

            seen_item_ids.add(item_id)
            item["item_id"] = item_id
            item["serial"] = serial or str(resolved.get("serial_number") or "")
            copied_equipment = dict(equipment)
            copied_equipment["ID"] = item_id
            item["equipment"] = copied_equipment
            resolved_groups.setdefault(str(old_employee), []).append(item)

    # A failed resolve is preflight: no selected item is allowed to mutate.
    if failures:
        return {}, failures
    return resolved_groups, []


def _operation_payload(
    *,
    chat_id: int,
    db_name: str,
    grouped_equipment: dict[str, list[dict]],
    new_employee: str,
    new_employee_dept: str,
    new_employee_id: int,
    new_branch: str,
    new_branch_no: int | None,
    new_location: str,
    new_loc_no: int | None,
) -> dict[str, Any]:
    items: list[dict[str, Any]] = []
    for old_employee, equipment_list in grouped_equipment.items():
        for item in equipment_list:
            items.append(
                {
                    "item_id": int(item["item_id"]),
                    "serial": str(item.get("serial") or ""),
                    "old_employee": str(old_employee),
                }
            )
    return {
        "chat_id": int(chat_id),
        "db_name": str(db_name or ""),
        "new_employee": str(new_employee or ""),
        "new_employee_dept": str(new_employee_dept or ""),
        "new_employee_id": int(new_employee_id),
        "new_branch": str(new_branch or ""),
        "new_branch_no": new_branch_no,
        "new_location": str(new_location or ""),
        "new_loc_no": new_loc_no,
        "grouped_equipment": copy.deepcopy(grouped_equipment),
        "items": items,
    }


def _restore_operation_payload(context: ContextTypes.DEFAULT_TYPE, payload: dict[str, Any]) -> dict[str, list[dict]]:
    """Restore a persisted operation when a callback arrives after restart."""
    grouped_equipment = payload.get("grouped_equipment")
    if not isinstance(grouped_equipment, dict):
        return {}
    context.user_data.setdefault("grouped_equipment", copy.deepcopy(grouped_equipment))
    for key in ("new_employee", "new_employee_dept", "new_branch", "new_location"):
        if key in payload:
            context.user_data.setdefault(key, payload[key])
    restored = context.user_data.get("grouped_equipment")
    return restored if isinstance(restored, dict) else {}


def _operation_outcome_for_preflight_failures(failures: list[dict[str, Any]]) -> TransferCommandOutcome[dict]:
    outcome: TransferCommandOutcome[dict] = TransferCommandOutcome(item_id_key="item_id")
    outcome.failed.extend(copy.deepcopy(failures))
    return outcome


def _attach_serials_to_outcome(
    outcome: TransferCommandOutcome[dict],
    grouped_equipment: dict[str, list[dict]],
) -> None:
    serial_by_item_id = {
        str(item.get("item_id")): str(item.get("serial") or "")
        for equipment_list in grouped_equipment.values()
        for item in equipment_list
        if isinstance(item, dict)
    }
    for failure in outcome.failed:
        failure.setdefault("serial", serial_by_item_id.get(str(failure.get("item_id") or ""), ""))


def _operation_ledger_entries(
    *,
    transferred_groups: dict[str, list[dict]],
    acts: list[dict[str, Any]],
    db_name: str,
    new_employee: str,
    new_branch: str,
    new_location: str,
    operation_id: str,
) -> list[dict[str, Any]]:
    act_path_by_owner = {
        str(act.get("old_employee") or ""): str(act.get("pdf_path") or "")
        for act in acts
        if isinstance(act, dict)
    }
    entries: list[dict[str, Any]] = []
    for old_employee, equipment_list in transferred_groups.items():
        act_pdf_path = act_path_by_owner.get(str(old_employee), "")
        for item in equipment_list:
            equipment = item.get("equipment") if isinstance(item.get("equipment"), dict) else {}
            item_id = _coerce_item_id(item.get("item_id"))
            if item_id is None:
                raise ValueError("Нельзя записать transfer ledger без ITEMS.ID")
            additional_data = dict(equipment)
            additional_data.update(
                {
                    "db_name": db_name,
                    "branch": new_branch,
                    "location": new_location,
                    "operation_id": operation_id,
                    "item_id": item_id,
                    "one_c_sync_state": ONE_C_SYNC_STATE_NOT_REQUESTED,
                }
            )
            entries.append(
                {
                    "serial_number": str(item.get("serial") or ""),
                    "new_employee": new_employee,
                    "old_employee": old_employee,
                    "item_id": item_id,
                    "operation_id": operation_id,
                    "additional_data": additional_data,
                    "act_pdf_path": act_pdf_path,
                }
            )
    return entries


def _transfer_operation_before_acts(
    transfer_db,
    grouped_equipment: dict[str, list[dict]],
    new_employee: str,
    new_employee_id: int,
    new_branch_no=None,
    new_loc_no=None,
    operation_id: str = "",
) -> tuple[dict[str, list[dict]], TransferCommandOutcome[dict]]:
    """Confirm the whole bot operation before any act or JSON-ledger work.

    A bot transfer can contain several old owners, but it remains one command.
    Consequently a failure in *any* group prevents documents and ledger rows
    for every group.  Confirmed item moves are still returned to the caller so
    it can report the exact retryable serials without creating duplicate acts.
    """

    operation_items: list[dict] = []
    for old_employee, equipment_list in grouped_equipment.items():
        for equipment in equipment_list:
            operation_items.append(
                {
                    "old_employee": old_employee,
                    "equipment": equipment,
                }
            )

    def _execute_item(operation_item: dict, item_id: str) -> dict:
        old_employee = str(operation_item.get("old_employee") or "")
        equipment = operation_item.get("equipment") or {}
        serial = str(equipment.get("serial") or "")
        comment = f"Перемещение оборудования: {old_employee} -> {new_employee}"
        if operation_id:
            comment = f"{comment} [operation_id={operation_id}]"
        try:
            result = transfer_db.transfer_equipment_by_id_with_history(
                item_id=int(item_id),
                display_serial=serial,
                new_employee_id=new_employee_id,
                new_employee_name=new_employee,
                new_branch_no=new_branch_no,
                new_loc_no=new_loc_no,
                comment=comment,
                operation_id=operation_id,
            )
        except Exception as exc:
            logger.error(f"Ошибка обновления БД для {serial}: {exc}", exc_info=True)
            # An exception is an unknown state, not an explicit SQL refusal.
            # Suppress automatic retry until the operation is investigated.
            return {"success": False, "message": str(exc), "retryable": False}

        if result.get('success'):
            logger.info(f"✅ База обновлена: {result.get('message')}")
        else:
            error = str(result.get('message') or 'Не удалось обновить БД')
            logger.warning(f"⚠️ Не удалось обновить БД для {serial}: {error}")
        return result

    outcome = run_transfer_command(
        operation_items,
        item_id_getter=lambda item: (item.get("equipment") or {}).get("item_id"),
        item_id_key="item_id",
        execute=_execute_item,
        invalid_item_error="Не указан ITEMS.ID",
        duplicate_item_error="ITEMS.ID повторяется в операции",
        unknown_result_error="Не удалось подтвердить перенос в базе данных",
    )
    transferred_groups: dict[str, list[dict]] = {}
    for success in outcome.successes:
        old_employee = str(success.item.get("old_employee") or "")
        transferred_groups.setdefault(old_employee, []).append(success.item.get("equipment") or {})

    _attach_serials_to_outcome(outcome, grouped_equipment)
    return transferred_groups, outcome


@require_user_access
async def start_transfer(update: Update, context: ContextTypes.DEFAULT_TYPE) -> int:
    """
    Начало процесса перемещения оборудования
    
    Параметры:
        update: Объект обновления от Telegram API
        context: Контекст выполнения
        
    Возвращает:
        int: Состояние TRANSFER_WAIT_PHOTOS
    """
    # Инициализируем контекст для хранения данных о перемещении
    context.user_data[StorageKeys.TEMP_PHOTOS] = []
    context.user_data[StorageKeys.TEMP_SERIALS] = []
    context.user_data[TRANSFER_OPERATION_ID_KEY] = _new_transfer_operation_id()
    context.user_data[TRANSFER_OPERATION_STATE_KEY] = "draft"
    # A retry list belongs only to the previous partial command; never mix it
    # into a newly scanned transfer.
    context.user_data.pop(TRANSFER_RETRY_SERIALS_KEY, None)
    context.user_data.pop('act_files_info', None)
    
    await update.message.reply_text(
        "📦 <b>Перемещение оборудования с актом</b>\n\n"
        "Отправьте фотографии оборудования (до 10 штук).\n"
        "Можете отправить несколько фото подряд.\n\n"
        "Также можно отправить QR payload текстом или ввести серийный номер вручную.\n\n"
        "💡 Для QR лучше отправлять изображение как файл (документ) без сжатия.\n\n"
        "ℹ️ <i>Оборудование будет автоматически сгруппировано по текущим владельцам.\n"
        "Для каждого старого сотрудника будет создан отдельный акт приема-передачи.</i>\n\n"
        "После загрузки всех фото отправьте команду /done для продолжения.",
        reply_markup=ReplyKeyboardRemove(),
        parse_mode='HTML'
    )
    return States.TRANSFER_WAIT_PHOTOS


@handle_errors
async def receive_transfer_photos(update: Update, context: ContextTypes.DEFAULT_TYPE) -> int:
    """
    Обработчик получения фотографий для перемещения
    
    Параметры:
        update: Объект обновления от Telegram API
        context: Контекст выполнения
        
    Возвращает:
        int: Следующее состояние
    """
    # Обработка команды /done
    if update.message and update.message.text and update.message.text.startswith('/done'):
        photos = context.user_data.get(StorageKeys.TEMP_PHOTOS, [])
        serials_data = context.user_data.get(StorageKeys.TEMP_SERIALS, [])
        
        if not serials_data:
            await update.message.reply_text(
                "❌ Вы не добавили ни одной единицы оборудования.\n"
                "Отправьте фото/QR или текст с серийным номером."
            )
            return States.TRANSFER_WAIT_PHOTOS
        
        # Группируем оборудование для предварительного просмотра
        from bot.services.equipment_grouper import group_equipment_by_employee
        grouped_equipment = group_equipment_by_employee(serials_data)
        groups_count = len(grouped_equipment)
        
        # Переходим к запросу нового сотрудника
        await update.message.reply_text(
            f"✅ Обработано изображений: {len(photos)}.\n"
            f"📦 Распознано единиц оборудования: {len(serials_data)}\n"
            f"👥 Будет создано актов: {groups_count}\n\n"
            "Теперь укажите ФИО нового сотрудника, которому будет передано оборудование:"
        )
        return States.TRANSFER_NEW_EMPLOYEE
    
    # Обработка текстовых сообщений (не команд)
    if update.message and update.message.text and not update.message.text.startswith('/'):
        text_input = update.message.text.strip()
        if not text_input:
            await update.message.reply_text("❌ Пустой ввод. Отправьте QR/серийный номер или фото.")
            return States.TRANSFER_WAIT_PHOTOS

        from bot.config import config
        max_photos = config.transfer.max_photos
        current_items = context.user_data.get(StorageKeys.TEMP_SERIALS, [])
        if len(current_items) >= max_photos:
            await update.message.reply_text(
                f"⚠️ Достигнут лимит единиц ({max_photos}).\n"
                "Отправьте /done для продолжения."
            )
            return States.TRANSFER_WAIT_PHOTOS

        user_id = update.effective_user.id if update.effective_user else None
        source_label = "manual_text"
        search_inv_no = None
        search_serial_no = None

        detection = detect_identifiers_from_text(text_input)
        if detection.get("detector") == "qr":
            search_inv_no = detection.get("inv_no")
            search_serial_no = detection.get("serial_no")
            source_label = "qr_text"
            logger.info(
                "[TRANSFER][QR] detected_from_text user_id=%s inv_no=%s serial_no=%s text_len=%s",
                user_id,
                search_inv_no or "-",
                search_serial_no or "-",
                len(text_input),
            )
        elif detection.get("detector") == "manual":
            search_serial_no = detection.get("serial_no")
            logger.info(
                "[TRANSFER][QR] not_detected_from_text user_id=%s fallback_manual_serial=%s",
                user_id,
                search_serial_no or "-",
            )

        if (
            not search_inv_no
            and search_serial_no
            and source_label == "manual_text"
            and not validate_serial_number(search_serial_no)
        ):
            await update.message.reply_text(
                "❌ Некорректный формат серийного номера.\n"
                "Используйте только буквы, цифры и символы: - _ . :"
            )
            return States.TRANSFER_WAIT_PHOTOS

        db = database_manager.create_database_connection(user_id)
        if not db:
            await update.message.reply_text("⚠️ Не удалось подключиться к базе данных.")
            return States.TRANSFER_WAIT_PHOTOS

        try:
            equipment = {}

            if search_inv_no:
                logger.info("[TRANSFER] try_inv_lookup user_id=%s inv_no=%s", user_id, search_inv_no)
                equipment = db.find_by_inventory_number(search_inv_no)
                logger.info("[TRANSFER] inv_lookup_result user_id=%s found=%s", user_id, bool(equipment))

            if not equipment and search_serial_no:
                logger.info("[TRANSFER] try_serial_lookup user_id=%s serial=%s", user_id, search_serial_no)
                equipment = db.find_by_serial_number(search_serial_no)
                logger.info("[TRANSFER] serial_lookup_result user_id=%s found=%s", user_id, bool(equipment))
        except Exception as e:
            lookup_value = search_inv_no or search_serial_no or "-"
            logger.warning(f"Ошибка поиска оборудования {lookup_value}: {e}")
            equipment = None
        finally:
            db.close_connection()

        if equipment:
            employee_name = equipment.get('EMPLOYEE_NAME') or 'Не указан'
            if employee_name and employee_name != 'Не указан':
                employee_name = employee_name.strip() or 'Не указан'

            serial_to_save = (
                equipment.get('SERIAL_NO')
                or equipment.get('HW_SERIAL_NO')
                or search_serial_no
                or search_inv_no
                or ""
            )
            search_target = search_inv_no or search_serial_no or serial_to_save

            context.user_data[StorageKeys.TEMP_SERIALS].append({
                'serial': serial_to_save,
                'serial_input': search_target,
                'item_id': _coerce_item_id(equipment.get('ID') or equipment.get('id')),
                'current_employee': employee_name,
                'equipment': equipment,
                'search_source': source_label,
            })

            await update.message.reply_text(
                f"✅ Оборудование найдено в базе!\n"
                f"🔎 Поиск: <b>{search_target}</b>\n"
                f"👤 Числится на: <b>{employee_name}</b>\n"
                f"📦 Всего единиц: {len(context.user_data[StorageKeys.TEMP_SERIALS])}\n\n"
                "Отправьте еще фото/QR/текст или /done для продолжения.",
                parse_mode='HTML'
            )
        else:
            target = search_inv_no or search_serial_no or "-"
            await update.message.reply_text(
                f"❌ Оборудование с номером <b>{target}</b> не найдено в базе.\n"
                "Отправьте другой QR/номер.",
                parse_mode='HTML'
            )
        return States.TRANSFER_WAIT_PHOTOS
    
    # Обработка фотографий и изображений-документов
    is_photo_message = bool(update.message and update.message.photo)
    is_document_image_message = bool(
        update.message
        and update.message.document
        and str(update.message.document.mime_type or "").startswith("image/")
    )

    if is_photo_message or is_document_image_message:
        try:
            # Проверяем лимит единиц оборудования
            current_items = context.user_data.get(StorageKeys.TEMP_SERIALS, [])
            from bot.config import config
            max_photos = config.transfer.max_photos
            
            if len(current_items) >= max_photos:
                await update.message.reply_text(
                    f"⚠️ Достигнут лимит единиц ({max_photos}).\n"
                    "Отправьте /done для продолжения."
                )
                return States.TRANSFER_WAIT_PHOTOS
            
            source_kind = "photo"
            source_label = "manual"
            search_inv_no = None
            search_serial_no = None

            if is_photo_message:
                photo = update.message.photo[-1]
                incoming_file = await context.bot.get_file(photo.file_id)
                file_id = photo.file_id
                file_ext = ".jpg"
            else:
                source_kind = "document"
                document = update.message.document
                incoming_file = await context.bot.get_file(document.file_id)
                file_id = document.file_id
                original_name = str(document.file_name or "transfer_qr_image").strip()
                file_ext = os.path.splitext(original_name)[1] or ".jpg"
                logger.info(
                    "[TRANSFER] received_document_image user_id=%s name=%s mime=%s size=%s",
                    update.effective_user.id if update.effective_user else None,
                    original_name,
                    document.mime_type,
                    document.file_size,
                )
            
            await update.message.reply_text("🛠️ Фото обрабатывается, пожалуйста, подождите...")
            
            # Создаем временный путь для сохранения файла
            photo_path = f"temp_transfer_{file_id}{file_ext}"
            await incoming_file.download_to_drive(photo_path)

            detection = await detect_identifiers_from_image(photo_path)
            search_inv_no = detection.get("inv_no")
            search_serial_no = detection.get("serial_no")
            qr_payload_text = detection.get("qr_payload_text")

            if detection.get("detector") == "qr":
                source_label = f"qr_{source_kind}"
                logger.info(
                    "[TRANSFER][QR] detected_from_%s user_id=%s inv_no=%s serial_no=%s payload_len=%s",
                    source_kind,
                    update.effective_user.id if update.effective_user else None,
                    search_inv_no or "-",
                    search_serial_no or "-",
                    len(qr_payload_text or ""),
                )
            elif detection.get("detector") == "ocr":
                source_label = f"ocr_{source_kind}"
                logger.info(
                    "[TRANSFER][OCR] fallback_from_%s user_id=%s serial=%s",
                    source_kind,
                    update.effective_user.id if update.effective_user else None,
                    search_serial_no or "-",
                )
            else:
                logger.info(
                    "[TRANSFER][QR] not_detected_from_%s user_id=%s",
                    source_kind,
                    update.effective_user.id if update.effective_user else None,
                )

            # Если идентификаторы не найдены - не используем файл.
            if not search_inv_no and not search_serial_no:
                cleanup_temp_file(photo_path)
                await update.message.reply_text(
                    "📷 Файл получен, но QR/серийный номер не распознан.\n"
                    "Файл не будет использован. Отправьте другое изображение."
                )
                return States.TRANSFER_WAIT_PHOTOS
            
            # Проверяем наличие оборудования в базе
            user_id = update.effective_user.id
            db = database_manager.create_database_connection(user_id)
            
            if not db:
                cleanup_temp_file(photo_path)
                await update.message.reply_text(
                    "⚠️ Не удалось подключиться к базе данных.\n"
                    "Фото не будет использовано. Попробуйте позже."
                )
                return States.TRANSFER_WAIT_PHOTOS
            
            try:
                equipment = {}

                # 1) Сначала точный поиск по инвентарному номеру из QR.
                if search_inv_no:
                    logger.info(
                        "[TRANSFER] try_inv_lookup user_id=%s inv_no=%s",
                        user_id,
                        search_inv_no,
                    )
                    equipment = db.find_by_inventory_number(search_inv_no)
                    logger.info(
                        "[TRANSFER] inv_lookup_result user_id=%s found=%s",
                        user_id,
                        bool(equipment),
                    )

                # 2) Если по INV_NO не нашли - ищем по SERIAL_NO.
                if not equipment and search_serial_no:
                    logger.info(
                        "[TRANSFER] try_serial_lookup user_id=%s serial=%s",
                        user_id,
                        search_serial_no,
                    )
                    equipment = db.find_by_serial_number(search_serial_no)
                    logger.info(
                        "[TRANSFER] serial_lookup_result user_id=%s found=%s",
                        user_id,
                        bool(equipment),
                    )
            except Exception as e:
                lookup_value = search_inv_no or search_serial_no or "-"
                logger.warning(f"Ошибка поиска оборудования {lookup_value}: {e}")
                equipment = None
            finally:
                db.close_connection()
            
            if equipment:
                # Оборудование найдено - добавляем в список
                employee_name = equipment.get('EMPLOYEE_NAME') or 'Не указан'
                if employee_name and employee_name != 'Не указан':
                    employee_name = employee_name.strip() or 'Не указан'

                serial_to_save = (
                    equipment.get('SERIAL_NO')
                    or equipment.get('HW_SERIAL_NO')
                    or search_serial_no
                    or search_inv_no
                    or ""
                )
                search_target = search_inv_no or search_serial_no or serial_to_save
                
                context.user_data[StorageKeys.TEMP_PHOTOS].append(photo_path)
                context.user_data[StorageKeys.TEMP_SERIALS].append({
                    'serial': serial_to_save,  # Используем реальный серийный номер из БД при наличии
                    'serial_input': search_target,  # Сохраняем фактический идентификатор поиска
                    'item_id': _coerce_item_id(equipment.get('ID') or equipment.get('id')),
                    'current_employee': employee_name,
                    'equipment': equipment,
                    'search_source': source_label,
                })
                
                await update.message.reply_text(
                    f"✅ Оборудование найдено в базе!\n"
                    f"🔎 Поиск: <b>{search_target}</b>\n"
                    f"👤 Числится на: <b>{employee_name}</b>\n"
                    f"📦 Всего единиц: {len(context.user_data[StorageKeys.TEMP_SERIALS])}\n\n"
                    "Отправьте еще фото/QR или /done для продолжения.",
                    parse_mode='HTML'
                )
            else:
                # Оборудование не найдено - не используем
                cleanup_temp_file(photo_path)
                target = search_inv_no or search_serial_no or "-"
                await update.message.reply_text(
                    f"❌ Оборудование с номером <b>{target}</b> не найдено в базе.\n"
                    "Фото не будет использовано. Отправьте другое фото.",
                    parse_mode='HTML'
                )
            
            return States.TRANSFER_WAIT_PHOTOS
            
        except Exception as e:
            logger.error(f"Ошибка обработки фото для перемещения: {e}")
            await update.message.reply_text(
                "❌ Ошибка обработки фотографии. Попробуйте еще раз."
            )
            return States.TRANSFER_WAIT_PHOTOS
    
    # Если получено что-то другое
    await update.message.reply_text(
        "Пожалуйста, отправьте фото, QR (фото/документ/текст), серийный номер или /done."
    )
    return States.TRANSFER_WAIT_PHOTOS


@handle_errors
async def receive_new_employee(update: Update, context: ContextTypes.DEFAULT_TYPE) -> int:
    """
    Обработчик ввода нового сотрудника

    Параметры:
        update: Объект обновления от Telegram API
        context: Контекст выполнения

    Возвращает:
        int: Следующее состояние
    """
    if not update.message or not update.message.text:
        await update.message.reply_text("Пожалуйста, введите ФИО нового сотрудника.")
        return States.TRANSFER_NEW_EMPLOYEE

    from bot.handlers.suggestions_handler import show_employee_suggestions

    new_employee = update.message.text.strip()

    # Показываем подсказки если есть совпадения
    if await show_employee_suggestions(
        update, context, new_employee,
        mode='transfer',
        pending_key='pending_transfer_employee_input',
        suggestions_key='transfer_employee_suggestions'
    ):
        return States.TRANSFER_NEW_EMPLOYEE

    # Валидация ФИО
    if not validate_employee_name(new_employee):
        await update.message.reply_text(
            "❌ ФИО должно содержать только буквы и пробелы.\n"
            "Пожалуйста, введите корректное ФИО."
        )
        return States.TRANSFER_NEW_EMPLOYEE

    # Проверяем, существует ли сотрудник в базе
    user_id = update.effective_user.id
    db = database_manager.create_database_connection(user_id)
    employee_exists = False

    if db:
        try:
            owner_no = db.get_owner_no_by_name(new_employee, strict=True)
            if not owner_no:
                owner_no = db.get_owner_no_by_name(new_employee, strict=False)
            employee_exists = owner_no is not None
        except Exception as e:
            logger.error(f"Ошибка проверки сотрудника: {e}")
        finally:
            db.close_connection()

    # Если сотрудника нет в базе - запрашиваем подтверждение
    if not employee_exists:
        from telegram import InlineKeyboardMarkup, InlineKeyboardButton

        context.user_data['pending_employee_add'] = new_employee

        keyboard = [
            [InlineKeyboardButton("✅ Да, добавить", callback_data="transfer_emp_add:confirm")],
            [InlineKeyboardButton("❌ Отмена", callback_data="transfer_emp_add:cancel")]
        ]

        await update.message.reply_text(
            f"⚠️ <b>Сотрудник не найден</b>\n\n"
            f"Сотрудник <b>{new_employee}</b> не найден в базе данных.\n\n"
            f"Добавить нового сотрудника и продолжить?",
            parse_mode='HTML',
            reply_markup=InlineKeyboardMarkup(keyboard)
        )

        return States.TRANSFER_NEW_EMPLOYEE

    # Сотрудник существует - продолжаем
    context.user_data['new_employee'] = new_employee

    # Получаем отдел нового сотрудника из БД
    await get_employee_department(update, context, new_employee)

    # Запрашиваем филиал
    await update.message.reply_text(
        "🏢 <b>Укажите филиал</b>\n\n"
        "Введите название филиала, куда перемещено оборудование:",
        parse_mode='HTML'
    )

    return States.TRANSFER_NEW_BRANCH


@handle_errors
async def receive_transfer_branch(update: Update, context: ContextTypes.DEFAULT_TYPE) -> int:
    """
    Обработчик ввода филиала

    Параметры:
        update: Объект обновления от Telegram API
        context: Контекст выполнения

    Возвращает:
        int: Следующее состояние
    """
    if not update.message or not update.message.text:
        await update.message.reply_text("Пожалуйста, введите название филиала.")
        return States.TRANSFER_NEW_BRANCH

    from bot.handlers.suggestions_handler import show_transfer_branch_suggestions

    branch = update.message.text.strip()

    # Показываем подсказки если есть совпадения
    if await show_transfer_branch_suggestions(
        update, context, branch,
        pending_key='pending_transfer_branch_input',
        suggestions_key='transfer_branch_suggestions'
    ):
        return States.TRANSFER_NEW_BRANCH

    # Сохраняем филиал
    context.user_data['new_branch'] = branch

    # Показываем кнопки локаций для выбранного филиала
    await show_transfer_location_buttons(update, context, branch)

    return States.TRANSFER_NEW_LOCATION


async def show_transfer_location_buttons(update: Update, context: ContextTypes.DEFAULT_TYPE, branch: str) -> None:
    """
    Показывает кнопки выбора локации для выбранного филиала (при перемещении) с пагинацией.
    Использует show_location_buttons с mode='transfer'.
    """
    user_id = update.effective_user.id
    context._user_id = user_id  # Сохраняем для show_location_buttons

    await show_location_buttons(
        message=update.message,
        context=context,
        mode='transfer',
        branch=branch
    )


@handle_errors
async def receive_transfer_location(update: Update, context: ContextTypes.DEFAULT_TYPE) -> int:
    """
    Обработчик ввода локации/кабинета

    Параметры:
        update: Объект обновления от Telegram API
        context: Контекст выполнения

    Возвращает:
        int: Следующее состояние
    """
    if not update.message or not update.message.text:
        await update.message.reply_text("Пожалуйста, введите локацию/кабинет.")
        return States.TRANSFER_NEW_LOCATION

    from bot.handlers.suggestions_handler import show_transfer_location_suggestions

    location = update.message.text.strip()

    # Показываем подсказки если есть совпадения
    if await show_transfer_location_suggestions(
        update, context, location,
        pending_key='pending_transfer_location_input',
        suggestions_key='transfer_location_suggestions'
    ):
        return States.TRANSFER_NEW_LOCATION

    # Сохраняем локацию
    context.user_data['new_location'] = location

    # Показываем подтверждение
    await show_transfer_confirmation(update, context)

    return States.TRANSFER_CONFIRMATION


async def show_transfer_confirmation(update: Update, context: ContextTypes.DEFAULT_TYPE) -> None:
    """
    Отображает данные для подтверждения перемещения с группировкой по сотрудникам
    
    Параметры:
        update: Объект обновления от Telegram API
        context: Контекст выполнения
    """
    from bot.services.equipment_grouper import group_equipment_by_employee
    
    new_employee = context.user_data.get('new_employee', 'Не указан')
    serials_data = context.user_data.get(StorageKeys.TEMP_SERIALS, [])
    
    # Группируем оборудование по старым сотрудникам
    grouped_equipment = group_equipment_by_employee(serials_data)
    
    # Фильтруем пустые группы (edge case)
    grouped_equipment = {k: v for k, v in grouped_equipment.items() if v}
    
    # Проверка на пустые данные
    if not grouped_equipment:
        error_text = "❌ Нет данных для перемещения. Попробуйте снова."
        if update.callback_query:
            await update.callback_query.edit_message_text(error_text)
        else:
            await update.message.reply_text(error_text)
        return
    
    # Проверка на превышение лимита актов (edge case)
    MAX_ACTS_PER_TRANSFER = 10
    if len(grouped_equipment) > MAX_ACTS_PER_TRANSFER:
        error_text = (
            f"⚠️ Слишком много групп ({len(grouped_equipment)}).\n"
            f"Максимум: {MAX_ACTS_PER_TRANSFER} актов за одну операцию.\n\n"
            "Пожалуйста, разделите перемещение на несколько операций."
        )
        if update.callback_query:
            await update.callback_query.edit_message_text(error_text)
        else:
            await update.message.reply_text(error_text)
        return
    
    # Сохраняем сгруппированные данные в контексте
    context.user_data['grouped_equipment'] = grouped_equipment
    _ensure_transfer_operation_id(context)

    # Подсчитываем общее количество единиц и групп
    total_count = len(serials_data)
    groups_count = len(grouped_equipment)

    # Получаем филиал и локацию
    new_branch = context.user_data.get('new_branch', 'Не указан')
    new_location = context.user_data.get('new_location', 'Не указан')

    # Формируем сообщение с группами
    confirmation_text = (
        "📋 <b>Подтверждение перемещения оборудования</b>\n\n"
        f"👤 <b>Новый сотрудник:</b> {new_employee}\n"
        f"🏢 <b>Филиал:</b> {new_branch}\n"
        f"📍 <b>Локация:</b> {new_location}\n"
        f"📦 <b>Всего единиц:</b> {total_count}\n"
        f"👥 <b>Количество актов:</b> {groups_count}\n\n"
    )

    # Добавляем информацию о каждой группе
    for act_num, (old_employee, equipment_list) in enumerate(grouped_equipment.items(), 1):
        confirmation_text += f"📄 <b>Акт {act_num}: От {old_employee}</b>\n"
        confirmation_text += f"🔢 Серийные номера ({len(equipment_list)} шт.):\n"
        
        for i, item in enumerate(equipment_list, 1):
            serial = item.get('serial', 'Неизвестен')
            confirmation_text += f"{i}. {serial}\n"
        
        confirmation_text += "\n"
    
    confirmation_text += "Подтвердите перемещение оборудования?"
    
    # Создаем клавиатуру подтверждения
    keyboard = [
        [
            InlineKeyboardButton(
                "✅ Подтвердить",
                callback_data=f"{TRANSFER_CONFIRM_CALLBACK_PREFIX}{_ensure_transfer_operation_id(context)}",
            ),
            InlineKeyboardButton("❌ Отменить", callback_data="cancel_transfer")
        ]
    ]
    reply_markup = InlineKeyboardMarkup(keyboard)
    
    if update.callback_query:
        await update.callback_query.edit_message_text(
            confirmation_text,
            reply_markup=reply_markup,
            parse_mode='HTML'
        )
    else:
        await update.message.reply_text(
            confirmation_text,
            reply_markup=reply_markup,
            parse_mode='HTML'
        )


@handle_errors
async def handle_transfer_confirmation(update: Update, context: ContextTypes.DEFAULT_TYPE) -> int:
    """Confirm one durable transfer command and then deliver its acts.

    Inventory mutations are all attempted before any document, Telegram send
    or JSON-ledger side effect.  A checkpoint records the immutable command
    and every delivery transition, so a restart cannot retarget a reused
    serial number or silently create a second ledger entry.
    """
    query = update.callback_query
    await query.answer()

    if _is_confirm_transfer_callback(query.data):
        callback_operation_id = _operation_id_from_callback(query.data)
        if callback_operation_id:
            context.user_data[TRANSFER_OPERATION_ID_KEY] = callback_operation_id
        operation_id = callback_operation_id or _ensure_transfer_operation_id(context)
        operation_state = str(context.user_data.get(TRANSFER_OPERATION_STATE_KEY) or "draft")
        if operation_state == "processing":
            logger.info("Повторное подтверждение уже выполняемой операции %s подавлено", operation_id)
            return ConversationHandler.END

        checkpoint = transfer_operation_store.get(operation_id)
        if checkpoint and str(checkpoint.get("status") or "") == "completed":
            logger.info("Повторное подтверждение завершённой операции %s подавлено", operation_id)
            await query.edit_message_text("ℹ️ Это перемещение уже было завершено. Повторный перенос не выполнен.")
            clear_transfer_data(context)
            return ConversationHandler.END
        if checkpoint and str(checkpoint.get("status") or "") == "partial":
            # The original command already had a non-confirmed item.  It is
            # intentionally terminal: retry must be a new command containing
            # only explicitly failed serials, never a continuation that could
            # create acts/ledger for a previously partial operation.
            await query.edit_message_text(
                "⚠️ Эта операция уже завершилась частично. Акты и JSON-журнал для неё запрещены; "
                "создайте новую операцию только для неуспешных позиций."
            )
            clear_transfer_data(context, preserve_retry_serials=True)
            return ConversationHandler.END
        if not checkpoint and (operation_state == "completed" or _has_recorded_transfer_operation(operation_id)):
            logger.info("Повторное подтверждение завершённой операции %s подавлено", operation_id)
            await query.edit_message_text(
                "ℹ️ Это перемещение уже было подтверждено. Повторный перенос не выполнен."
            )
            clear_transfer_data(context)
            return ConversationHandler.END

        context.user_data[TRANSFER_OPERATION_STATE_KEY] = "processing"
        if checkpoint:
            grouped_equipment = _restore_operation_payload(
                context,
                checkpoint.get("payload") if isinstance(checkpoint.get("payload"), dict) else {},
            )
        else:
            grouped_equipment = context.user_data.get('grouped_equipment', {})

        if not grouped_equipment:
            await query.edit_message_text("❌ Ошибка: данные операции перемещения не найдены.")
            clear_transfer_data(context)
            return ConversationHandler.END

        await query.edit_message_text("🛠️ Проверка перемещения и создание актов приема-передачи...")
        retry_serials: list[str] = []
        try:
            new_employee = context.user_data.get('new_employee', '')
            new_employee_dept = context.user_data.get('new_employee_dept', '')
            new_branch = context.user_data.get('new_branch', '')
            new_location = context.user_data.get('new_location', '')
            user_id = update.effective_user.id
            checkpoint_payload = checkpoint.get("payload") if checkpoint and isinstance(checkpoint.get("payload"), dict) else {}
            db_name = str(checkpoint_payload.get("db_name") or database_manager.get_user_database(user_id) or "")

            successful_acts: list[dict] = []
            failed_acts: list[str] = []
            transferred_groups: dict[str, list[dict]] = {}
            transfer_confirmed = False
            operation_outcome: TransferCommandOutcome[dict] | None = None
            transfer_problem: str | None = None

            checkpoint_status = str(checkpoint.get("status") or "") if checkpoint else ""
            if checkpoint_status in {
                "inventory_confirmed",
                "acts_ready",
                "acts_failed",
                "delivery_pending",
                "delivery_unknown",
                "ledger_recorded",
            }:
                transferred_groups = copy.deepcopy(checkpoint_payload.get("grouped_equipment") or {})
                transfer_confirmed = bool(transferred_groups)
                new_employee = checkpoint_payload.get("new_employee", new_employee)
                new_employee_dept = checkpoint_payload.get("new_employee_dept", new_employee_dept)
                new_branch = checkpoint_payload.get("new_branch", new_branch)
                new_location = checkpoint_payload.get("new_location", new_location)
            else:
                transfer_db = None
                if (
                    checkpoint_status == "resolved"
                    and db_name
                    and str(database_manager.get_user_database(user_id) or "") != db_name
                ):
                    transfer_problem = (
                        "Текущая HUB-база отличается от базы, в которой была подтверждена операция. "
                        "Переключитесь обратно на исходную базу перед восстановлением."
                    )
                else:
                    transfer_db = database_manager.create_database_connection(user_id)
                if not transfer_db:
                    if not transfer_problem:
                        logger.error("Не удалось подключиться к базе данных для перемещения")
                        transfer_problem = "Не удалось подключиться к базе данных для перемещения."
                else:
                    try:
                        if checkpoint_status == "resolved" and checkpoint_payload:
                            resolved_groups = copy.deepcopy(checkpoint_payload.get("grouped_equipment") or {})
                            new_employee_id = checkpoint_payload.get("new_employee_id")
                            new_branch_no = checkpoint_payload.get("new_branch_no")
                            new_loc_no = checkpoint_payload.get("new_loc_no")
                            new_employee = checkpoint_payload.get("new_employee", new_employee)
                            new_employee_dept = checkpoint_payload.get("new_employee_dept", new_employee_dept)
                            new_branch = checkpoint_payload.get("new_branch", new_branch)
                            new_location = checkpoint_payload.get("new_location", new_location)
                        else:
                            new_employee_id = transfer_db.get_owner_no_by_name(new_employee, strict=True)
                            if not new_employee_id:
                                new_employee_id = transfer_db.get_owner_no_by_name(new_employee, strict=False)
                            if not new_employee_id:
                                logger.info("Сотрудник '%s' не найден в OWNERS, создаём новую запись", new_employee)
                                new_employee_id = transfer_db.create_owner(
                                    employee_name=new_employee,
                                    department=new_employee_dept,
                                )
                            new_branch_no = transfer_db.get_branch_no_by_name(new_branch) if new_branch else None
                            new_loc_no = transfer_db.get_loc_no_by_descr(new_location) if new_location else None
                            resolved_groups, resolve_failures = _resolve_grouped_equipment_item_ids(
                                transfer_db,
                                grouped_equipment,
                            )
                            if resolve_failures:
                                operation_outcome = _operation_outcome_for_preflight_failures(resolve_failures)
                                transfer_problem = "Не удалось безопасно определить все ITEMS.ID до перемещения."
                                resolved_groups = {}

                        if not new_employee_id:
                            logger.error("Не удалось создать владельца для '%s'", new_employee)
                            transfer_problem = "Не удалось определить или создать нового владельца."
                        elif operation_outcome is None:
                            if checkpoint is None:
                                payload = _operation_payload(
                                    chat_id=query.message.chat_id,
                                    db_name=db_name,
                                    grouped_equipment=resolved_groups,
                                    new_employee=new_employee,
                                    new_employee_dept=new_employee_dept,
                                    new_employee_id=int(new_employee_id),
                                    new_branch=new_branch,
                                    new_branch_no=new_branch_no,
                                    new_location=new_location,
                                    new_loc_no=new_loc_no,
                                )
                                checkpoint = transfer_operation_store.create_or_get(operation_id, payload)
                            for idx, (old_employee, equipment_list) in enumerate(resolved_groups.items(), 1):
                                await context.bot.send_message(
                                    chat_id=query.message.chat_id,
                                    text=(
                                        f"🛠️ Проверка перемещения {idx} из {len(resolved_groups)}...\n"
                                        f"От: {old_employee}\n"
                                        f"Единиц оборудования: {len(equipment_list)}"
                                    ),
                                )
                            transferred_groups, operation_outcome = _transfer_operation_before_acts(
                                transfer_db=transfer_db,
                                grouped_equipment=resolved_groups,
                                new_employee=new_employee,
                                new_employee_id=int(new_employee_id),
                                new_branch_no=new_branch_no,
                                new_loc_no=new_loc_no,
                                operation_id=operation_id,
                            )
                            transfer_confirmed = operation_outcome.is_complete
                            retry_serials = [
                                str(failure.get("serial") or "").strip()
                                for failure in operation_outcome.failed
                                if bool(failure.get("retryable")) and str(failure.get("serial") or "").strip()
                            ]
                            if transfer_confirmed:
                                checkpoint = transfer_operation_store.checkpoint(
                                    operation_id,
                                    status="inventory_confirmed",
                                    note="all item ids confirmed in HUB",
                                    outcome={"success_count": len(operation_outcome.successes), "failed": []},
                                )
                            else:
                                transfer_operation_store.checkpoint(
                                    operation_id,
                                    status="partial",
                                    note="inventory command is incomplete; acts and ledger are prohibited",
                                    outcome={
                                        "success_count": len(operation_outcome.successes),
                                        "failed": copy.deepcopy(operation_outcome.failed),
                                    },
                                )
                                transferred_groups = {}
                    except TransferOperationConflict as exc:
                        transfer_problem = str(exc)
                    except Exception as exc:
                        logger.error("Ошибка при обновлении базы данных: %s", exc, exc_info=True)
                        transfer_problem = "Во время подтверждения перемещения произошла техническая ошибка."
                    finally:
                        transfer_db.close_connection()

            if operation_outcome is not None and not transfer_confirmed:
                context.user_data.pop('act_files_info', None)
                if retry_serials:
                    context.user_data[TRANSFER_RETRY_SERIALS_KEY] = retry_serials
                else:
                    context.user_data.pop(TRANSFER_RETRY_SERIALS_KEY, None)
                retry_details = [
                    failure
                    for failure in operation_outcome.failed
                    if bool(failure.get("retryable")) and str(failure.get("serial") or "").strip()
                ]
                result_text = (
                    "⚠️ <b>Перемещение подтверждено не полностью.</b>\n\n"
                    "Акты, отправка документов и записи JSON-журнала не созданы ни для одной группы.\n"
                    "Уже подтверждённые позиции не включены в повтор, чтобы не создать дубликаты.\n\n"
                )
                if retry_details:
                    result_text += "Повторить можно только эти серийные номера:\n"
                    for failure in retry_details:
                        result_text += f"  • {failure['serial']} — {failure.get('error') or 'Не удалось подтвердить перенос'}\n"
                else:
                    result_text += "Проверьте состояние операции в HUB перед новой попыткой."
                await context.bot.send_message(chat_id=query.message.chat_id, text=result_text, parse_mode='HTML')
                return ConversationHandler.END

            if not transfer_confirmed or not transferred_groups:
                await context.bot.send_message(
                    chat_id=query.message.chat_id,
                    text=(
                        "❌ <b>Не удалось подтвердить перемещение.</b>\n\n"
                        f"{transfer_problem or 'Не получен подтверждённый результат изменения имущества.'}\n\n"
                        "Акты, отправка документов и записи JSON-журнала не созданы."
                    ),
                    parse_mode='HTML',
                )
                return ConversationHandler.END

            checkpoint = transfer_operation_store.get(operation_id)
            acts = copy.deepcopy(checkpoint.get("acts") or []) if checkpoint else []
            if not acts or checkpoint_status == "acts_failed":
                from bot.services.pdf_generator import generate_multiple_transfer_acts

                generated_acts = await generate_multiple_transfer_acts(
                    new_employee=new_employee,
                    new_employee_dept=new_employee_dept,
                    grouped_equipment=transferred_groups,
                    db_name=db_name,
                    operation_id=operation_id,
                )
                failed_acts = [
                    str(act.get("old_employee") or "Неизвестен")
                    for act in generated_acts
                    if not act.get("success") or not act.get("pdf_path") or not os.path.exists(str(act.get("pdf_path") or ""))
                ]
                if failed_acts:
                    transfer_operation_store.checkpoint(
                        operation_id,
                        status="acts_failed",
                        note="all document/ledger delivery is prohibited until every act exists",
                        acts=generated_acts,
                    )
                    await context.bot.send_message(
                        chat_id=query.message.chat_id,
                        text=(
                            "❌ <b>Не удалось подготовить все акты.</b>\n\n"
                            "Ни один акт не отправлен и JSON-журнал не изменён.\n"
                            + "\n".join(f"  • {owner}" for owner in failed_acts)
                        ),
                        parse_mode='HTML',
                    )
                    return ConversationHandler.END
                acts = [dict(act, delivery_status="pending") for act in generated_acts]
                checkpoint = transfer_operation_store.checkpoint(
                    operation_id,
                    status="acts_ready",
                    note="all deterministic act files are ready",
                    acts=acts,
                    ledger_entries=_operation_ledger_entries(
                        transferred_groups=transferred_groups,
                        acts=acts,
                        db_name=db_name,
                        new_employee=new_employee,
                        new_branch=new_branch,
                        new_location=new_location,
                        operation_id=operation_id,
                    ),
                )
            else:
                checkpoint_status = str(checkpoint.get("status") or "") if checkpoint else ""

            # The per-act `sending` checkpoint is written before the Telegram
            # side effect.  A restart in this state intentionally does not
            # re-send an ambiguous document and cannot duplicate its ledger.
            delivery_unknown = False
            for index, act in enumerate(acts):
                delivery_status = str(act.get("delivery_status") or "pending")
                old_employee = str(act.get("old_employee") or "Неизвестен")
                if delivery_status == "sent":
                    successful_acts.append(act)
                    continue
                if delivery_status in {"sending", "failed"}:
                    delivery_unknown = True
                    failed_acts.append(old_employee)
                    continue

                updated_acts = copy.deepcopy(acts)
                updated_acts[index]["delivery_status"] = "sending"
                transfer_operation_store.checkpoint(
                    operation_id,
                    status="delivery_pending",
                    note=f"document dispatch started for {old_employee}",
                    acts=updated_acts,
                )
                acts = updated_acts
                pdf_path = str(act.get("pdf_path") or "")
                caption = f"✅ Акт приема-передачи\nОт: {old_employee}\nКому: {new_employee}"
                sent = await send_document_with_retry(
                    context=context,
                    chat_id=query.message.chat_id,
                    document_path=pdf_path,
                    filename=str(act.get("filename") or os.path.basename(pdf_path)),
                    caption=caption,
                    max_retries=3,
                )
                updated_acts = copy.deepcopy(acts)
                updated_acts[index]["delivery_status"] = "sent" if sent else "failed"
                checkpoint = transfer_operation_store.checkpoint(
                    operation_id,
                    status="delivery_pending" if sent else "delivery_unknown",
                    note=("document delivered" if sent else "document delivery failed or is unknown"),
                    acts=updated_acts,
                )
                acts = updated_acts
                if sent:
                    successful_acts.append(acts[index])
                else:
                    failed_acts.append(old_employee)
                    delivery_unknown = True

            if delivery_unknown:
                await context.bot.send_message(
                    chat_id=query.message.chat_id,
                    text=(
                        "⚠️ <b>Перемещение подтверждено, но доставка актов не завершена.</b>\n\n"
                        "JSON-журнал не изменён: повторная отправка документов автоматически запрещена, "
                        "пока не будет проверен checkpoint операции.\n"
                        + "\n".join(f"  • {owner}" for owner in failed_acts)
                    ),
                    parse_mode='HTML',
                )
                return ConversationHandler.END

            checkpoint = transfer_operation_store.get(operation_id)
            ledger_entries = copy.deepcopy(checkpoint.get("ledger_entries") or []) if checkpoint else []
            if not checkpoint or not bool(checkpoint.get("ledger_written")):
                if not equipment_manager.add_transfer_operation_entries_once(ledger_entries):
                    raise RuntimeError("Не удалось зафиксировать JSON-журнал перемещения")
                checkpoint = transfer_operation_store.checkpoint(
                    operation_id,
                    status="ledger_recorded",
                    note="all documents delivered; ledger written exactly once",
                    ledger_written=True,
                )
            transfer_operation_store.checkpoint(
                operation_id,
                status="completed",
                note="transfer delivery and ledger completed",
            )
            context.user_data[TRANSFER_OPERATION_STATE_KEY] = "completed"
            context.user_data['act_files_info'] = {
                'acts': successful_acts,
                'new_employee': new_employee,
                'new_employee_dept': new_employee_dept,
                'total_equipment': sum(act.get('equipment_count', 0) for act in successful_acts),
                'db_name': db_name,
                'operation_id': operation_id,
                'one_c_sync_state': ONE_C_SYNC_STATE_NOT_REQUESTED,
            }
            total_equipment = sum(act.get('equipment_count', 0) for act in successful_acts)
            keyboard = [
                [InlineKeyboardButton("📧 Отправить старым владельцам", callback_data="act:email_owners")],
                [InlineKeyboardButton("✉️ Ввести email вручную", callback_data="act:email")],
                [InlineKeyboardButton("⏭ Пропустить", callback_data="act:skip")],
            ]
            await context.bot.send_message(
                chat_id=query.message.chat_id,
                text=(
                    "✅ <b>Перемещение оборудования завершено!</b>\n\n"
                    f"📄 Создано актов: {len(successful_acts)}\n"
                    f"📦 Всего единиц оборудования: {total_equipment}\n"
                    f"👤 Новый владелец: {new_employee}\n\n"
                    "Все акты отправлены вам в чат.\n\nХотите отправить все акты на email?"
                ),
                reply_markup=InlineKeyboardMarkup(keyboard),
                parse_mode='HTML',
            )
        except Exception as e:
            logger.error(f"Ошибка при создании актов: {e}", exc_info=True)
            await context.bot.send_message(
                chat_id=query.message.chat_id,
                text=(
                    "❌ <b>Произошла критическая ошибка при создании актов</b>\n\n"
                    "Возможные причины:\n"
                    "• Проблемы с подключением к базе данных\n"
                    "• Ошибка в данных оборудования\n"
                    "• Технические неполадки\n\n"
                    "💡 <i>Рекомендация: Попробуйте выполнить операцию заново через несколько минут.\n"
                    "Если ошибка повторяется, обратитесь к администратору.</i>"
                ),
                parse_mode='HTML'
            )
        finally:
            clear_transfer_data(context, preserve_retry_serials=bool(retry_serials))

    elif query.data == "cancel_transfer":
        await query.edit_message_text("❌ Перемещение оборудования отменено.")
        clear_transfer_data(context)
    
    return ConversationHandler.END


async def generate_transfer_act(new_employee: str, new_employee_dept: str, serials_data: list, db_name: str) -> str:
    """
    Генерирует PDF-акт приема-передачи
    
    Параметры:
        new_employee: ФИО нового сотрудника
        new_employee_dept: Отдел нового сотрудника
        serials_data: Список данных об оборудовании
        db_name: Название базы данных
        
    Возвращает:
        str: Путь к созданному PDF-файлу
    """
    from bot.services.pdf_generator import generate_transfer_act_pdf
    
    try:
        pdf_path = await generate_transfer_act_pdf(new_employee, new_employee_dept, serials_data, db_name)
        return pdf_path
        
    except Exception as e:
        logger.error(f"Ошибка генерации акта: {e}", exc_info=True)
        return None


def cleanup_temp_file(file_path: str) -> None:
    """
    Удаляет временный файл
    
    Параметры:
        file_path: Путь к файлу
    """
    try:
        if os.path.exists(file_path):
            os.remove(file_path)
            logger.info(f"Временный файл {file_path} удален")
    except Exception as e:
        logger.warning(f"Не удалось удалить временный файл {file_path}: {e}")


def clear_transfer_data(
    context: ContextTypes.DEFAULT_TYPE,
    *,
    preserve_retry_serials: bool = False,
) -> None:
    """
    Очищает временные данные перемещения из контекста
    
    Параметры:
        context: Контекст выполнения
    """
    # Удаляем временные фотографии
    photos = context.user_data.get(StorageKeys.TEMP_PHOTOS, [])
    for photo_path in photos:
        cleanup_temp_file(photo_path)
    
    # Очищаем данные из контекста
    keys_to_clear = [
        StorageKeys.TEMP_PHOTOS,
        StorageKeys.TEMP_SERIALS,
        'new_employee',
        'new_employee_dept',
        'grouped_equipment',
        TRANSFER_OPERATION_ID_KEY,
        TRANSFER_OPERATION_STATE_KEY,
    ]
    if not preserve_retry_serials:
        keys_to_clear.append(TRANSFER_RETRY_SERIALS_KEY)
    
    for key in keys_to_clear:
        context.user_data.pop(key, None)



@handle_errors
async def handle_employee_suggestion_callback(update: Update, context: ContextTypes.DEFAULT_TYPE) -> int:
    """
    Обработчик выбора сотрудника из подсказок для перемещения

    Параметры:
        update: Объект обновления от Telegram API
        context: Контекст выполнения

    Возвращает:
        int: Следующее состояние
    """
    from bot.handlers.suggestions_handler import handle_employee_suggestion_generic

    query = update.callback_query
    data = query.data

    # Обработка подтверждения добавления нового сотрудника
    if data.startswith('transfer_emp_add:'):
        action = data.split(':', 1)[1]

        if action == 'confirm':
            # Пользователь подтвердил добавление нового сотрудника
            employee_name = context.user_data.get('pending_employee_add', '').strip()

            if not employee_name:
                await query.answer()
                await query.edit_message_text("❌ Ошибка: ФИО сотрудника не найдено.")
                return States.TRANSFER_NEW_EMPLOYEE

            context.user_data['new_employee'] = employee_name
            context.user_data.pop('pending_employee_add', None)

            await query.answer()
            await query.edit_message_text(f"✅ Будет добавлен новый сотрудник: {employee_name}")

            # Запрашиваем филиал
            await query.message.reply_text(
                "🏢 <b>Укажите филиал</b>\n\n"
                "Введите название филиала, куда перемещено оборудование:",
                parse_mode='HTML'
            )

            return States.TRANSFER_NEW_BRANCH

        elif action == 'cancel':
            # Пользователь отменил - просим ввести ФИО заново
            context.user_data.pop('pending_employee_add', None)

            await query.answer()
            await query.edit_message_text(
                "❌ Отменено. Пожалуйста, введите ФИО сотрудника заново."
            )

            await query.message.reply_text(
                "👤 <b>Введите ФИО нового сотрудника</b>\n\n"
                "На кого перемещаем оборудование?",
                parse_mode='HTML'
            )

            return States.TRANSFER_NEW_EMPLOYEE

    suggestions = context.user_data.get('transfer_employee_suggestions', [])
    
    # Обработка выбора конкретного сотрудника
    if data.startswith('transfer_emp:') and not data.endswith((':manual', ':refresh')):
        try:
            idx = int(data.split(':', 1)[1])
            if 0 <= idx < len(suggestions):
                selected_name = suggestions[idx]
                context.user_data['new_employee'] = selected_name

                # Получаем отдел выбранного сотрудника
                await get_employee_department(update, context, selected_name)

                await query.answer()
                await query.edit_message_text(f"✅ Выбран сотрудник: {selected_name}")

                # Запрашиваем филиал
                await query.message.reply_text(
                    "🏢 <b>Укажите филиал</b>\n\n"
                    "Введите название филиала, куда перемещено оборудование:",
                    parse_mode='HTML'
                )

                return States.TRANSFER_NEW_BRANCH
        except (ValueError, IndexError) as e:
            logger.error(f"Ошибка обработки выбора сотрудника: {e}")
    
    # Обработка "Ввести как есть"
    elif data == 'transfer_emp:manual':
        pending = context.user_data.get('pending_transfer_employee_input', '').strip()

        if not pending:
            await query.answer()
            await query.edit_message_text(
                "❌ Не найден введённый текст. Пожалуйста, введите ФИО заново."
            )
            return States.TRANSFER_NEW_EMPLOYEE

        if not validate_employee_name(pending):
            await query.answer()
            await query.edit_message_text(
                "❌ ФИО должно содержать только буквы и пробелы.\n"
                "Пожалуйста, введите корректное ФИО."
            )
            return States.TRANSFER_NEW_EMPLOYEE

        context.user_data['new_employee'] = pending

        # Получаем отдел введенного сотрудника
        await get_employee_department(update, context, pending)

        await query.answer()
        await query.edit_message_text(f"✅ Принято: {pending}")

        # Запрашиваем филиал
        await query.message.reply_text(
            "🏢 <b>Укажите филиал</b>\n\n"
            "Введите название филиала, куда перемещено оборудование:",
            parse_mode='HTML'
        )

        return States.TRANSFER_NEW_BRANCH

    # Обработка "Обновить список" - используем универсальный обработчик
    return await handle_employee_suggestion_generic(
        update=update,
        context=context,
        mode='transfer',
        storage_key='new_employee',
        pending_key='pending_transfer_employee_input',
        suggestions_key='transfer_employee_suggestions',
        next_state=States.TRANSFER_NEW_BRANCH,
        next_message="🏢 <b>Укажите филиал</b>\n\nВведите название филиала, куда перемещено оборудование:"
    )


async def get_employee_department(update: Update, context: ContextTypes.DEFAULT_TYPE, employee_name: str) -> None:
    """
    Получает отдел сотрудника из БД и сохраняет в context
    
    Параметры:
        update: Объект обновления от Telegram API
        context: Контекст выполнения
        employee_name: ФИО сотрудника
    """
    user_id = update.effective_user.id
    db = database_manager.create_database_connection(user_id)
    
    new_employee_dept = ''
    if db:
        try:
            # Сначала пробуем точное совпадение
            new_employee_dept = db.get_owner_dept(employee_name, strict=True)
            logger.info(f"Поиск отдела (strict=True) для '{employee_name}': {new_employee_dept}")
            
            # Если не нашли - пробуем нечеткий поиск
            if not new_employee_dept:
                new_employee_dept = db.get_owner_dept(employee_name, strict=False)
                logger.info(f"Поиск отдела (strict=False) для '{employee_name}': {new_employee_dept}")
            
            # Если все еще не нашли - пробуем через find_by_employee
            if not new_employee_dept:
                logger.warning(f"Отдел не найден через get_owner_dept, пробуем find_by_employee")
                employees = db.find_by_employee(employee_name, strict=False)
                if employees and len(employees) > 0:
                    # Берем отдел из первой записи оборудования
                    new_employee_dept = employees[0].get('OWNER_DEPT', '')
                    logger.info(f"Отдел найден через find_by_employee: {new_employee_dept}")
            
            context.user_data['new_employee_dept'] = new_employee_dept if new_employee_dept else ''
            logger.info(f"Итоговый отдел для '{employee_name}': '{new_employee_dept}'")
            
        except Exception as e:
            logger.error(f"Ошибка при получении отдела сотрудника '{employee_name}': {e}", exc_info=True)
            context.user_data['new_employee_dept'] = ''
    else:
        logger.warning("Не удалось создать подключение к БД")
        context.user_data['new_employee_dept'] = ''


async def show_transfer_confirmation_after_callback(query, context: ContextTypes.DEFAULT_TYPE) -> None:
    """
    Отображает подтверждение перемещения после callback с группировкой по сотрудникам
    
    Параметры:
        query: Callback query
        context: Контекст выполнения
    """
    from bot.services.equipment_grouper import group_equipment_by_employee
    
    new_employee = context.user_data.get('new_employee', 'Не указан')
    serials_data = context.user_data.get(StorageKeys.TEMP_SERIALS, [])
    
    # Группируем оборудование по старым сотрудникам
    grouped_equipment = group_equipment_by_employee(serials_data)
    
    # Фильтруем пустые группы (edge case)
    grouped_equipment = {k: v for k, v in grouped_equipment.items() if v}
    
    # Проверка на пустые данные
    if not grouped_equipment:
        await query.message.reply_text("❌ Нет данных для перемещения. Попробуйте снова.")
        return
    
    # Проверка на превышение лимита актов (edge case)
    MAX_ACTS_PER_TRANSFER = 10
    if len(grouped_equipment) > MAX_ACTS_PER_TRANSFER:
        error_text = (
            f"⚠️ Слишком много групп ({len(grouped_equipment)}).\n"
            f"Максимум: {MAX_ACTS_PER_TRANSFER} актов за одну операцию.\n\n"
            "Пожалуйста, разделите перемещение на несколько операций."
        )
        await query.message.reply_text(error_text)
        return
    
    # Сохраняем сгруппированные данные в контексте
    context.user_data['grouped_equipment'] = grouped_equipment
    _ensure_transfer_operation_id(context)

    # Подсчитываем общее количество единиц и групп
    total_count = len(serials_data)
    groups_count = len(grouped_equipment)

    # Получаем филиал и локацию
    new_branch = context.user_data.get('new_branch', 'Не указан')
    new_location = context.user_data.get('new_location', 'Не указан')

    # Формируем сообщение с группами
    confirmation_text = (
        "📋 <b>Подтверждение перемещения оборудования</b>\n\n"
        f"👤 <b>Новый сотрудник:</b> {new_employee}\n"
        f"🏢 <b>Филиал:</b> {new_branch}\n"
        f"📍 <b>Локация:</b> {new_location}\n"
        f"📦 <b>Всего единиц:</b> {total_count}\n"
        f"👥 <b>Количество актов:</b> {groups_count}\n\n"
    )

    # Добавляем информацию о каждой группе
    for act_num, (old_employee, equipment_list) in enumerate(grouped_equipment.items(), 1):
        confirmation_text += f"📄 <b>Акт {act_num}: От {old_employee}</b>\n"
        confirmation_text += f"🔢 Серийные номера ({len(equipment_list)} шт.):\n"
        
        for i, item in enumerate(equipment_list, 1):
            serial = item.get('serial', 'Неизвестен')
            confirmation_text += f"{i}. {serial}\n"
        
        confirmation_text += "\n"
    
    confirmation_text += "Подтвердите перемещение оборудования?"
    
    # Создаем клавиатуру подтверждения
    keyboard = [
        [
            InlineKeyboardButton(
                "✅ Подтвердить",
                callback_data=f"{TRANSFER_CONFIRM_CALLBACK_PREFIX}{_ensure_transfer_operation_id(context)}",
            ),
            InlineKeyboardButton("❌ Отменить", callback_data="cancel_transfer")
        ]
    ]
    reply_markup = InlineKeyboardMarkup(keyboard)
    
    await query.message.reply_text(
        confirmation_text,
        reply_markup=reply_markup,
        parse_mode='HTML'
    )


@handle_errors
async def handle_transfer_branch_callback(update: Update, context: ContextTypes.DEFAULT_TYPE) -> int:
    """
    Обработчик выбора филиала из подсказок

    Параметры:
        update: Объект обновления от Telegram API
        context: Контекст выполнения

    Возвращает:
        int: Следующее состояние
    """
    query = update.callback_query
    await query.answer()

    data = query.data
    suggestions = context.user_data.get('transfer_branch_suggestions', [])

    # Обработка выбора конкретного филиала
    if data.startswith('transfer_branch:') and not data.endswith(':manual'):
        try:
            idx = int(data.split(':', 1)[1])
            if 0 <= idx < len(suggestions):
                selected_branch = suggestions[idx]
                context.user_data['new_branch'] = selected_branch

                await query.edit_message_text(f"✅ Выбран филиал: {selected_branch}")

                # Показываем кнопки локаций для выбранного филиала (используем универсальную функцию)
                context._user_id = query.from_user.id
                await show_location_buttons(
                    message=query.message,
                    context=context,
                    mode='transfer',
                    branch=selected_branch,
                    query=query
                )

                return States.TRANSFER_NEW_LOCATION
        except (ValueError, IndexError) as e:
            logger.error(f"Ошибка обработки выбора филиала: {e}")

    # Обработка "Ввести как есть"
    elif data == 'transfer_branch:manual':
        pending = context.user_data.get('pending_transfer_branch_input', '').strip()

        if not pending:
            await query.edit_message_text(
                "❌ Не найден введённый текст. Пожалуйста, введите филиал заново."
            )
            return States.TRANSFER_NEW_BRANCH

        context.user_data['new_branch'] = pending
        await query.edit_message_text(f"✅ Принято: {pending}")

        # Показываем кнопки локаций для выбранного филиала (используем универсальную функцию)
        context._user_id = query.from_user.id
        await show_location_buttons(
            message=query.message,
            context=context,
            mode='transfer',
            branch=pending,
            query=query
        )

        return States.TRANSFER_NEW_LOCATION

    return States.TRANSFER_NEW_BRANCH


@handle_errors
async def handle_transfer_location_callback(update: Update, context: ContextTypes.DEFAULT_TYPE) -> int:
    """
    Обработчик выбора локации из подсказок

    Параметры:
        update: Объект обновления от Telegram API
        context: Контекст выполнения

    Возвращает:
        int: Следующее состояние
    """
    query = update.callback_query
    await query.answer()

    data = query.data
    suggestions = _transfer_location_pagination_handler.get_items(context)

    # Обработка выбора конкретной локации
    if data.startswith('transfer_location:') and not data.endswith(':manual'):
        try:
            idx = int(data.split(':', 1)[1])
            if 0 <= idx < len(suggestions):
                selected_location = suggestions[idx]
                context.user_data['new_location'] = selected_location

                await query.edit_message_text(f"✅ Выбрана локация: {selected_location}")

                # Показываем подтверждение
                await show_transfer_confirmation(update, context)

                return States.TRANSFER_CONFIRMATION
        except (ValueError, IndexError) as e:
            logger.error(f"Ошибка обработки выбора локации: {e}")

    # Обработка "Ввести как есть"
    elif data == 'transfer_location:manual':
        pending = context.user_data.get('pending_transfer_location_input', '').strip()

        if not pending:
            await query.edit_message_text(
                "❌ Не найден введённый текст. Пожалуйста, введите локацию заново."
            )
            return States.TRANSFER_NEW_LOCATION

        context.user_data['new_location'] = pending
        await query.edit_message_text(f"✅ Принято: {pending}")

        # Показываем подтверждение
        await show_transfer_confirmation(update, context)

        return States.TRANSFER_CONFIRMATION

    # Обработка навигации по страницам через универсальный обработчик
    elif data in ('transfer_location_prev', 'transfer_location_next'):
        return await handle_location_navigation_universal(update, context, mode='transfer') or States.TRANSFER_NEW_LOCATION

    elif data == 'transfer_location_page_info':
        # Информационная кнопка - ничего не делаем
        await query.answer()
        return States.TRANSFER_NEW_LOCATION

    return States.TRANSFER_NEW_LOCATION
