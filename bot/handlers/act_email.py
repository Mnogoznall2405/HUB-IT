#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
Обработчик отправки актов приема-передачи на email
"""
import logging
import os
import asyncio
import re
from datetime import datetime
from telegram import Update, InlineKeyboardButton, InlineKeyboardMarkup, ReplyKeyboardRemove
from telegram.ext import ContextTypes

from bot.utils.decorators import handle_errors, require_user_access
from bot.database_manager import database_manager
from bot.email_sender import EmailSender

# Импортируем функцию безопасного удаления файлов
from bot.services.pdf_generator import remove_file_with_retry, remove_word_temp_files

logger = logging.getLogger(__name__)


async def send_multiple_acts_email(
    recipient_email: str,
    acts_info: dict,
    email_sender: EmailSender
) -> bool:
    """
    Отправляет все акты одним письмом
    
    Параметры:
        recipient_email: Email получателя
        acts_info: Информация о всех актах (структура act_files_info)
        email_sender: Экземпляр EmailSender
    
    Возвращает:
        bool: Успешность отправки
    """
    try:
        acts_list = acts_info.get('acts', [])
        new_employee = acts_info.get('new_employee', 'Неизвестный')
        total_equipment = acts_info.get('total_equipment', 0)
        db_name = acts_info.get('db_name', '')
        
        # Формируем тему письма
        date_str = datetime.now().strftime("%d.%m.%Y")
        subject = f"Акты приема-передачи оборудования от {date_str}"
        
        # Формируем тело письма
        body_lines = [
            "Добрый день!",
            "",
            "Во вложении акты приема-передачи оборудования:",
            ""
        ]
        
        # Добавляем список актов
        for idx, act in enumerate(acts_list, 1):
            old_employee = act.get('old_employee', 'Неизвестный')
            equipment_count = act.get('equipment_count', 0)
            body_lines.append(
                f"{idx}. От {old_employee} → {new_employee} ({equipment_count} ед.)"
            )
        
        body_lines.extend([
            "",
            f"Всего единиц оборудования: {total_equipment}",
            f"База данных: {db_name}" if db_name else "",
            f"Дата: {datetime.now().strftime('%d.%m.%Y %H:%M')}",
            "",
            "Пожалуйста, подпишите акты и отправьте подписанные отсканированные акты ответным письмом.",
            "",
            "Спасибо!"
        ])
        
        body = "\n".join(line for line in body_lines if line is not None)
        
        # Собираем файлы для отправки
        files = {}
        for idx, act in enumerate(acts_list):
            pdf_path = act.get('pdf_path')  # Исправлено: было 'path', должно быть 'pdf_path'
            if pdf_path and os.path.exists(pdf_path):
                # Используем уникальный ключ для каждого файла
                files[f'act_pdf_{idx}'] = pdf_path
            else:
                logger.warning(f"Файл акта не найден: {pdf_path}")
        
        if not files:
            logger.error("Нет файлов для отправки")
            return False
        
        # Отправляем письмо
        success = await asyncio.to_thread(
            email_sender.send_files,
            recipient_email=recipient_email,
            files=files,
            subject=subject,
            body=body
        )
        
        if success:
            logger.info(f"Успешно отправлено {len(files)} актов на {recipient_email}")
        else:
            logger.error(f"Ошибка отправки актов на {recipient_email}")
        
        return success
        
    except Exception as e:
        logger.error(f"Ошибка в send_multiple_acts_email: {e}", exc_info=True)
        return False


@handle_errors
@require_user_access
async def handle_act_action_callback(update: Update, context: ContextTypes.DEFAULT_TYPE):
    """
    Обработка действий после создания акта: отправка на email или пропуск.
    Поддерживает как одиночные акты (act_file_info), так и множественные (act_files_info).
    """
    query = update.callback_query
    await query.answer(text="Обрабатываю действие…", show_alert=False)
    logger.info(f"[ACT_EMAIL] Получен callback: {query.data}")
    logger.info(f"[ACT_EMAIL] User ID: {update.effective_user.id}")

    try:
        data = query.data
        
        # Проверяем наличие множественных актов (новая структура)
        acts_info = context.user_data.get('act_files_info')
        # Fallback на старую структуру для обратной совместимости
        act_info = context.user_data.get('act_file_info')

        if data == 'act:skip':
            # Удаляем все временные файлы с механизмом повторных попыток
            if acts_info and acts_info.get('acts'):
                for act in acts_info['acts']:
                    pdf_path = act.get('pdf_path')  # Исправлено: было 'path'
                    if pdf_path and os.path.exists(pdf_path):
                        remove_file_with_retry(pdf_path, max_attempts=3, delay=0.3)
                        # Также удаляем временные файлы Word если это DOCX
                        if pdf_path.endswith('.docx'):
                            remove_word_temp_files(pdf_path)
            elif act_info and act_info.get('path') and os.path.exists(act_info['path']):
                remove_file_with_retry(act_info['path'], max_attempts=3, delay=0.3)
                if act_info['path'].endswith('.docx'):
                    remove_word_temp_files(act_info['path'])
            
            context.user_data.pop('act_files_info', None)
            context.user_data.pop('act_file_info', None)
            await query.edit_message_text("⏭ Действие пропущено. Возвращаю в главное меню…")
            from bot.handlers.start import return_to_main_menu
            await return_to_main_menu(update, context)
            return

        elif data == 'act:email_owners':
            logger.info(f"[ACT_EMAIL] Обработка act:email_owners")
            logger.info(f"[ACT_EMAIL] acts_info: {acts_info}")
            logger.info(f"[ACT_EMAIL] acts_info is None: {acts_info is None}")
            logger.info(f"[ACT_EMAIL] acts_info.get('acts') if acts_info else None: {acts_info.get('acts') if acts_info else None}")
            
            # Отправка каждому старому владельцу его акта
            if not acts_info or not acts_info.get('acts'):
                logger.error(f"[ACT_EMAIL] acts_info пустой или нет актов!")
                await query.edit_message_text(
                    "❌ Информация об актах не найдена. Попробуйте выполнить перемещение заново."
                )
                from bot.handlers.start import return_to_main_menu
                await return_to_main_menu(update, context)
                return
            
            logger.info(f"[ACT_EMAIL] Найдено актов: {len(acts_info['acts'])}")
            acts_list = acts_info['acts']
            
            # Проверяем наличие файлов
            missing_files = []
            for act in acts_list:
                if not act.get('pdf_path') or not os.path.exists(act['pdf_path']):
                    missing_files.append(act.get('old_employee', 'Неизвестный'))
            
            if missing_files:
                await query.edit_message_text(
                    f"❌ <b>Некоторые файлы актов не найдены</b>\n\n"
                    f"Отсутствуют акты для:\n" + 
                    "\n".join(f"  • {emp}" for emp in missing_files) +
                    "\n\n💡 <i>Рекомендация: Попробуйте выполнить перемещение заново.</i>",
                    parse_mode='HTML'
                )
                from bot.handlers.start import return_to_main_menu
                await return_to_main_menu(update, context)
                return
            
            # Отправляем каждому старому владельцу
            await query.edit_message_text("📧 Отправка актов старым владельцам...")
            
            user_id = update.effective_user.id
            user_db = database_manager.create_database_connection(user_id)
            
            if not user_db:
                await context.bot.send_message(
                    chat_id=query.message.chat_id,
                    text="❌ База данных не выбрана. Пожалуйста, выберите базу данных в меню управления."
                )
                from bot.handlers.start import return_to_main_menu
                await return_to_main_menu(update, context)
                return
            
            successful_sends = []
            failed_sends = []
            
            for act in acts_list:
                old_employee = act.get('old_employee', 'Неизвестный')
                pdf_path = act.get('pdf_path')
                filename = act.get('filename', os.path.basename(pdf_path))
                
                logger.info(f"[ACT_EMAIL] Обработка акта для {old_employee}")
                logger.info(f"[ACT_EMAIL] PDF путь: {pdf_path}")
                
                # Получаем email старого владельца
                try:
                    logger.info(f"[ACT_EMAIL] Получение email для {old_employee} (strict=True)")
                    owner_email = await asyncio.to_thread(user_db.get_owner_email, old_employee, strict=True)
                    logger.info(f"[ACT_EMAIL] Email (strict=True): {owner_email}")
                    
                    if not owner_email:
                        logger.info(f"[ACT_EMAIL] Получение email для {old_employee} (strict=False)")
                        owner_email = await asyncio.to_thread(user_db.get_owner_email, old_employee, strict=False)
                        logger.info(f"[ACT_EMAIL] Email (strict=False): {owner_email}")
                    
                    if not owner_email:
                        logger.warning(f"Email не найден для {old_employee}")
                        failed_sends.append({
                            'employee': old_employee,
                            'reason': 'Email не найден в БД'
                        })
                        continue
                    
                    logger.info(f"[ACT_EMAIL] Email найден: {owner_email}")
                    logger.info(f"[ACT_EMAIL] Подготовка к отправке акта")
                    
                    # Отправляем акт
                    email_sender = EmailSender()
                    subject = f"Акт приема-передачи оборудования: {filename}"
                    body = (
                        f"Добрый день, {old_employee}!\n\n"
                        "Во вложении акт приема-передачи оборудования.\n\n"
                        "Пожалуйста, подпишите его и отправьте подписанный отсканированный акт ответным письмом.\n\n"
                        "Спасибо!"
                    )
                    
                    logger.info(f"[ACT_EMAIL] Отправка email на {owner_email}")
                    success = await asyncio.to_thread(
                        email_sender.send_files,
                        recipient_email=owner_email,
                        files={'act_pdf': pdf_path},
                        subject=subject,
                        body=body
                    )
                    logger.info(f"[ACT_EMAIL] Результат отправки: {success}")
                    
                    if success:
                        successful_sends.append({
                            'employee': old_employee,
                            'email': owner_email
                        })
                        logger.info(f"Акт успешно отправлен {old_employee} на {owner_email}")
                    else:
                        failed_sends.append({
                            'employee': old_employee,
                            'reason': 'Ошибка отправки email'
                        })
                        logger.error(f"Не удалось отправить акт {old_employee}")
                
                except Exception as e:
                    logger.error(f"Ошибка при отправке акта {old_employee}: {e}")
                    failed_sends.append({
                        'employee': old_employee,
                        'reason': str(e)
                    })
            
            # Формируем итоговое сообщение
            if successful_sends and not failed_sends:
                result_text = (
                    f"✅ <b>Все акты успешно отправлены!</b>\n\n"
                    f"📧 Отправлено актов: {len(successful_sends)}\n\n"
                    "Получатели:\n"
                )
                for send in successful_sends:
                    result_text += f"  • {send['employee']} → {send['email']}\n"
                
                # Удаляем файлы после успешной отправки с механизмом повторных попыток
                for act in acts_list:
                    pdf_path = act.get('pdf_path')
                    if pdf_path and os.path.exists(pdf_path):
                        remove_file_with_retry(pdf_path, max_attempts=3, delay=0.3)
                        # Удаляем временные файлы Word если это DOCX
                        if pdf_path.endswith('.docx'):
                            remove_word_temp_files(pdf_path)
                
                context.user_data.pop('act_files_info', None)
                
                await context.bot.send_message(
                    chat_id=query.message.chat_id,
                    text=result_text,
                    parse_mode='HTML'
                )
                from bot.handlers.start import return_to_main_menu
                await return_to_main_menu(update, context)
                
            elif successful_sends and failed_sends:
                result_text = (
                    f"⚠️ <b>Акты отправлены частично</b>\n\n"
                    f"✅ Успешно отправлено: {len(successful_sends)}\n"
                )
                for send in successful_sends:
                    result_text += f"  • {send['employee']} → {send['email']}\n"
                
                result_text += f"\n❌ Не удалось отправить: {len(failed_sends)}\n"
                for fail in failed_sends:
                    result_text += f"  • {fail['employee']} ({fail['reason']})\n"
                
                result_text += "\n💡 <i>Для неотправленных актов используйте 'Ввести email вручную'</i>"
                
                await context.bot.send_message(
                    chat_id=query.message.chat_id,
                    text=result_text,
                    parse_mode='HTML'
                )
                from bot.handlers.start import return_to_main_menu
                await return_to_main_menu(update, context)
                
            else:
                result_text = (
                    "❌ <b>Не удалось отправить ни одного акта</b>\n\n"
                    "Причины:\n"
                )
                for fail in failed_sends:
                    result_text += f"  • {fail['employee']}: {fail['reason']}\n"
                
                result_text += "\n💡 <i>Используйте 'Ввести email вручную' для отправки</i>"
                
                keyboard = [
                    [InlineKeyboardButton("✉️ Ввести email вручную", callback_data="act:email")],
                    [InlineKeyboardButton("⏭ Пропустить", callback_data="act:skip")]
                ]
                reply_markup = InlineKeyboardMarkup(keyboard)
                
                await context.bot.send_message(
                    chat_id=query.message.chat_id,
                    text=result_text,
                    reply_markup=reply_markup,
                    parse_mode='HTML'
                )
            
            return
        
        elif data == 'act:email':
            # Обработка множественных актов - ввод email вручную
            if acts_info and acts_info.get('acts'):
                acts_list = acts_info['acts']
                acts_count = len(acts_list)
                total_equipment = acts_info.get('total_equipment', 0)
                new_employee = acts_info.get('new_employee', 'Неизвестный')
                
                # Проверяем наличие файлов
                missing_files = []
                for act in acts_list:
                    if not act.get('pdf_path') or not os.path.exists(act['pdf_path']):  # Исправлено: было 'path'
                        missing_files.append(act.get('old_employee', 'Неизвестный'))
                
                if missing_files:
                    await query.edit_message_text(
                        f"❌ <b>Некоторые файлы актов не найдены</b>\n\n"
                        f"Отсутствуют акты для:\n" + 
                        "\n".join(f"  • {emp}" for emp in missing_files) +
                        "\n\n💡 <i>Рекомендация: Попробуйте выполнить перемещение заново.</i>",
                        parse_mode='HTML'
                    )
                    from bot.handlers.start import return_to_main_menu
                    await return_to_main_menu(update, context)
                    return
                
                # Предлагаем ввести email вручную
                await query.edit_message_text(
                    f"📧 <b>Отправка актов на email</b>\n\n"
                    f"📄 Количество актов: {acts_count}\n"
                    f"📦 Всего единиц оборудования: {total_equipment}\n"
                    f"👤 Новый владелец: {new_employee}\n\n"
                    f"Введите email адрес получателя:",
                    parse_mode='HTML'
                )
                await context.bot.send_message(
                    chat_id=query.message.chat_id,
                    text="✉️ Введите email адрес:",
                    reply_markup=ReplyKeyboardRemove()
                )
                
                context.user_data['waiting_for_email'] = True
                return
            
            # Fallback на старую структуру (одиночный акт)
            elif act_info:
                if not act_info.get('path') or not os.path.exists(act_info['path']):
                    await query.edit_message_text("❌ Файл акта не найден. Попробуйте выполнить перемещение заново.")
                    from bot.handlers.start import return_to_main_menu
                    await return_to_main_menu(update, context)
                    return

                filename = act_info.get('filename') or os.path.basename(act_info['path'])
                keyboard = InlineKeyboardMarkup([
                    [InlineKeyboardButton("📧 Отправить на email владельца", callback_data='act:email_owner')],
                    [InlineKeyboardButton("⌨️ Ввести email вручную", callback_data='act:email_input')]
                ])
                await query.edit_message_text(
                    f"Выберите способ отправки акта: {filename}",
                    reply_markup=keyboard
                )
                return
            else:
                await query.edit_message_text("❌ Информация об актах не найдена.")
                from bot.handlers.start import return_to_main_menu
                await return_to_main_menu(update, context)
                return

        elif data == 'act:email_input':
            # Для множественных актов просто запрашиваем email
            if acts_info and acts_info.get('acts'):
                acts_count = len(acts_info['acts'])
                await query.edit_message_text(f"📧 Введите email адрес для отправки {acts_count} актов:")
                await context.bot.send_message(
                    chat_id=query.message.chat_id,
                    text="Введите email адрес:",
                    reply_markup=ReplyKeyboardRemove()
                )
                context.user_data['waiting_for_email'] = True
                return
            
            # Fallback на старую структуру
            if not act_info or not act_info.get('path') or not os.path.exists(act_info['path']):
                await query.edit_message_text("❌ Файл акта не найден. Попробуйте выполнить перемещение заново.")
                from bot.handlers.start import return_to_main_menu
                await return_to_main_menu(update, context)
                return

            filename = act_info.get('filename') or os.path.basename(act_info['path'])
            await query.edit_message_text(f"📧 Введите email адрес для отправки акта: {filename}")
            await context.bot.send_message(
                chat_id=query.message.chat_id,
                text="Введите email адрес:",
                reply_markup=ReplyKeyboardRemove()
            )

            context.user_data['waiting_for_email'] = True
            context.user_data['email_file_info'] = {
                'path': act_info['path'],
                'filename': filename,
                'data_type': act_info.get('data_type', 'act_pdf')
            }
            return

        elif data == 'act:email_owner':
            # Эта функция работает только для одиночных актов
            if not act_info or not act_info.get('path') or not os.path.exists(act_info['path']):
                await query.edit_message_text("❌ Файл акта не найден. Попробуйте выполнить перемещение заново.")
                from bot.handlers.start import return_to_main_menu
                await return_to_main_menu(update, context)
                return

            filename = act_info.get('filename') or os.path.basename(act_info['path'])
            employee_name = act_info.get('from_employee_value')

            if not employee_name:
                keyboard = InlineKeyboardMarkup([
                    [InlineKeyboardButton("⌨️ Ввести email вручную", callback_data='act:email_input')]
                ])
                await query.edit_message_text(
                    "❌ Не удалось определить сотрудника-выдавшего акт. Введите email вручную.",
                    reply_markup=keyboard
                )
                return

            try:
                user_id = update.effective_user.id
                user_db = database_manager.create_database_connection(user_id)
                if user_db is None:
                    await query.edit_message_text(
                        "❌ База данных не выбрана. Пожалуйста, выберите базу данных в меню управления."
                    )
                    from bot.handlers.start import return_to_main_menu
                    await return_to_main_menu(update, context)
                    return

                owner_email = await asyncio.to_thread(user_db.get_owner_email, employee_name, strict=True)
                if not owner_email:
                    owner_email = await asyncio.to_thread(user_db.get_owner_email, employee_name, strict=False)

                if not owner_email:
                    keyboard = InlineKeyboardMarkup([
                        [InlineKeyboardButton("⌨️ Ввести email вручную", callback_data='act:email_input')]
                    ])
                    await query.edit_message_text(
                        f"❌ Email владельца для сотрудника \"{employee_name}\" не найден. Введите email вручную.",
                        reply_markup=keyboard
                    )
                    return

                loading_message = await query.edit_message_text("📧 Отправка акта на email владельца…")

                try:
                    email_sender = EmailSender()
                    data_type = act_info.get('data_type', 'act_pdf')
                    
                    subject = f"Акт приема-передачи оборудования: {filename}"
                    body = (
                        "Добрый день!\n\n"
                        "Во вложении акт приема-передачи оборудования.\n\n"
                        "Пожалуйста, подпишите его и отправьте подписанный отсканированный акт ответным письмом.\n\n"
                        "Спасибо!"
                    )
                    
                    success = await asyncio.to_thread(
                        email_sender.send_files,
                        recipient_email=owner_email,
                        files={data_type: act_info['path']},
                        subject=subject,
                        body=body
                    )

                    if success:
                        await loading_message.edit_text(
                            f"✅ Акт {filename} успешно отправлен на {owner_email}!"
                        )
                        # Удаляем файл с механизмом повторных попыток
                        remove_file_with_retry(act_info['path'], max_attempts=3, delay=0.3)
                        if act_info['path'].endswith('.docx'):
                            remove_word_temp_files(act_info['path'])
                        
                        context.user_data.pop('act_file_info', None)
                        from bot.handlers.start import return_to_main_menu
                        await return_to_main_menu(update, context)
                        return
                    else:
                        keyboard = InlineKeyboardMarkup([
                            [InlineKeyboardButton("⌨️ Ввести email вручную", callback_data='act:email_input')]
                        ])
                        await loading_message.edit_text(
                            "❌ Ошибка при отправке на email владельца. Введите email вручную.",
                            reply_markup=keyboard
                        )
                        return
                except Exception as e:
                    logger.error(f"Ошибка при автоматической отправке акта на email владельца: {e}")
                    keyboard = InlineKeyboardMarkup([
                        [InlineKeyboardButton("⌨️ Ввести email вручную", callback_data='act:email_input')]
                    ])
                    await query.edit_message_text(
                        "❌ Произошла ошибка при отправке. Введите email вручную.",
                        reply_markup=keyboard
                    )
                    return
            except Exception as e:
                logger.error(f"Ошибка при определении email владельца: {e}")
                keyboard = InlineKeyboardMarkup([
                    [InlineKeyboardButton("⌨️ Ввести email вручную", callback_data='act:email_input')]
                ])
                await query.edit_message_text(
                    "❌ Не удалось получить email владельца. Введите email вручную.",
                    reply_markup=keyboard
                )
                return

        # Если дошли сюда, значит callback_data не распознан
        logger.warning(f"[ACT_EMAIL] Неизвестный callback_data: {data}")
        await query.edit_message_text("❌ Неизвестное действие. Попробуйте выполнить операцию заново.")
        from bot.handlers.start import return_to_main_menu
        await return_to_main_menu(update, context)
        
    except Exception as e:
        logger.error(f"Ошибка при обработке act-действия: {e}", exc_info=True)
        await query.edit_message_text("❌ Ошибка при обработке запроса. Попробуйте позже.")



@handle_errors
async def handle_email_input(update: Update, context: ContextTypes.DEFAULT_TYPE):
    """
    Обработчик ввода email адреса для отправки акта (одиночного или множественных)
    """
    if not context.user_data.get('waiting_for_email'):
        return
    
    if not update.message or not update.message.text:
        await update.message.reply_text("Пожалуйста, введите корректный email адрес.")
        return
    
    email_text = update.message.text.strip()
    
    # Валидация email
    if not validate_email(email_text):
        await update.message.reply_text(
            "❌ Некорректный формат email адреса.\n"
            "Пожалуйста, введите корректный email (например: user@example.com)"
        )
        return
    
    # Проверяем наличие множественных актов
    acts_info = context.user_data.get('act_files_info')
    
    if acts_info and acts_info.get('acts'):
        # Обработка множественных актов
        acts_count = len(acts_info['acts'])
        total_equipment = acts_info.get('total_equipment', 0)
        new_employee = acts_info.get('new_employee', 'Неизвестный')
        
        loading_message = await update.message.reply_text(
            f"📧 <b>Отправка актов на email...</b>\n\n"
            f"📄 Актов: {acts_count}\n"
            f"📦 Единиц оборудования: {total_equipment}\n"
            f"📮 Получатель: {email_text}\n\n"
            f"⏳ Пожалуйста, подождите...",
            parse_mode='HTML'
        )
        
        try:
            email_sender = EmailSender()
            
            # Вызываем функцию отправки множественных актов
            success = await send_multiple_acts_email(
                recipient_email=email_text,
                acts_info=acts_info,
                email_sender=email_sender
            )
            
            if success:
                await loading_message.edit_text(
                    f"✅ <b>Акты успешно отправлены!</b>\n\n"
                    f"📄 Отправлено актов: {acts_count}\n"
                    f"📦 Единиц оборудования: {total_equipment}\n"
                    f"👤 Новый владелец: {new_employee}\n"
                    f"📮 Получатель: {email_text}\n\n"
                    f"Все акты отправлены одним письмом.",
                    parse_mode='HTML'
                )
                
                # Удаляем все временные файлы после успешной отправки
                for act in acts_info['acts']:
                    pdf_path = act.get('pdf_path')  # Исправлено: было 'path'
                    if pdf_path and os.path.exists(pdf_path):
                        remove_file_with_retry(pdf_path, max_attempts=3, delay=0.3)
                        if pdf_path.endswith('.docx'):
                            remove_word_temp_files(pdf_path)
                
                # Очищаем контекст
                context.user_data.pop('waiting_for_email', None)
                context.user_data.pop('act_files_info', None)
                
                from bot.handlers.start import return_to_main_menu
                await return_to_main_menu(update, context)
            else:
                # Предлагаем повторить при ошибке
                keyboard = InlineKeyboardMarkup([
                    [InlineKeyboardButton("🔄 Повторить", callback_data="act:email_input")],
                    [InlineKeyboardButton("⏭ Пропустить", callback_data="act:skip")]
                ])
                await loading_message.edit_text(
                    "❌ <b>Ошибка при отправке письма</b>\n\n"
                    "Возможные причины:\n"
                    "• Неверный формат email адреса\n"
                    "• Проблемы с SMTP-сервером\n"
                    "• Слишком большой размер вложений\n\n"
                    "💡 <i>Проверьте email адрес и попробуйте еще раз.</i>",
                    reply_markup=keyboard,
                    parse_mode='HTML'
                )
        except Exception as e:
            logger.error(f"Ошибка при отправке множественных актов на email {email_text}: {e}")
            keyboard = InlineKeyboardMarkup([
                [InlineKeyboardButton("🔄 Повторить", callback_data="act:email_input")],
                [InlineKeyboardButton("⏭ Пропустить", callback_data="act:skip")]
            ])
            await loading_message.edit_text(
                "❌ <b>Произошла критическая ошибка при отправке</b>\n\n"
                "Возможные причины:\n"
                "• Технические неполадки SMTP-сервера\n"
                "• Проблемы с сетевым подключением\n"
                "• Ошибка в данных актов\n\n"
                "💡 <i>Рекомендация: Попробуйте позже или обратитесь к администратору.</i>",
                reply_markup=keyboard,
                parse_mode='HTML'
            )
        return
    
    # Fallback на старую структуру (одиночный акт)
    email_file_info = context.user_data.get('email_file_info')
    
    if not email_file_info or not email_file_info.get('path') or not os.path.exists(email_file_info['path']):
        await update.message.reply_text("❌ Файл акта не найден. Попробуйте выполнить перемещение заново.")
        context.user_data.pop('waiting_for_email', None)
        context.user_data.pop('email_file_info', None)
        from bot.handlers.start import return_to_main_menu
        await return_to_main_menu(update, context)
        return
    
    loading_message = await update.message.reply_text(f"📧 Отправка акта на {email_text}…")
    
    try:
        email_sender = EmailSender()
        filename = email_file_info.get('filename') or os.path.basename(email_file_info['path'])
        data_type = email_file_info.get('data_type', 'act_pdf')
        
        subject = f"Акт приема-передачи оборудования: {filename}"
        body = (
            "Добрый день!\n\n"
            "Во вложении акт приема-передачи оборудования.\n\n"
            "Пожалуйста, подпишите его и отправьте подписанный отсканированный акт ответным письмом.\n\n"
            "Спасибо!"
        )
        
        success = await asyncio.to_thread(
            email_sender.send_files,
            recipient_email=email_text,
            files={data_type: email_file_info['path']},
            subject=subject,
            body=body
        )
        
        if success:
            await loading_message.edit_text(
                f"✅ Акт {filename} успешно отправлен на {email_text}!"
            )
            # Удаляем файл с механизмом повторных попыток
            remove_file_with_retry(email_file_info['path'], max_attempts=3, delay=0.3)
            if email_file_info['path'].endswith('.docx'):
                remove_word_temp_files(email_file_info['path'])
            
            context.user_data.pop('waiting_for_email', None)
            context.user_data.pop('email_file_info', None)
            context.user_data.pop('act_file_info', None)
            
            from bot.handlers.start import return_to_main_menu
            await return_to_main_menu(update, context)
        else:
            # Предлагаем повторить при ошибке
            keyboard = InlineKeyboardMarkup([
                [InlineKeyboardButton("🔄 Повторить", callback_data="act:email_input")],
                [InlineKeyboardButton("⏭ Пропустить", callback_data="act:skip")]
            ])
            await loading_message.edit_text(
                "❌ <b>Ошибка при отправке письма</b>\n\n"
                "Возможные причины:\n"
                "• Неверный формат email адреса\n"
                "• Проблемы с SMTP-сервером\n"
                "• Слишком большой размер вложения\n\n"
                "💡 <i>Проверьте email адрес и попробуйте еще раз.</i>",
                reply_markup=keyboard,
                parse_mode='HTML'
            )
    except Exception as e:
        logger.error(f"Ошибка при отправке акта на email {email_text}: {e}")
        keyboard = InlineKeyboardMarkup([
            [InlineKeyboardButton("🔄 Повторить", callback_data="act:email_input")],
            [InlineKeyboardButton("⏭ Пропустить", callback_data="act:skip")]
        ])
        await loading_message.edit_text(
            "❌ <b>Произошла критическая ошибка при отправке</b>\n\n"
            "Возможные причины:\n"
            "• Технические неполадки SMTP-сервера\n"
            "• Проблемы с сетевым подключением\n"
            "• Ошибка в данных акта\n\n"
            "💡 <i>Рекомендация: Попробуйте позже или обратитесь к администратору.</i>",
            reply_markup=keyboard,
            parse_mode='HTML'
        )


def validate_email(email: str) -> bool:
    """
    Валидация email адреса
    
    Параметры:
        email: Email адрес для проверки
        
    Возвращает:
        bool: True если email корректен, иначе False
    """
    pattern = r'^[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}$'
    return re.match(pattern, email) is not None
