#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
Декораторы для обработчиков бота

Содержит декораторы для проверки доступа, логирования и обработки ошибок.
"""

import asyncio
import time
import logging
from functools import wraps
from typing import Callable, Any

from telegram import Update
from telegram.ext import ContextTypes, ConversationHandler

from bot.cache_manager import user_access_cache
from bot.utils.hub_binding import (
    PERM_DATABASE_READ,
    hub_user_has_permission,
    resolve_hub_user,
)

logger = logging.getLogger(__name__)


async def check_user_access(
    update: Update,
    context: ContextTypes.DEFAULT_TYPE,
    *,
    permission: str = PERM_DATABASE_READ,
) -> bool:
    """
    Проверяет доступ пользователя к боту с кэшированием.

    Два независимых уровня (MED-10):
    1) Telegram-гейт: ``ALLOWED_USERS`` или членство в ``ALLOWED_GROUP_ID``
       (кэшируется с прежними TTL).
    2) Привязка к HUB: Telegram ID должен принадлежать активному
       пользователю HUB, обладающему ``permission`` — иначе деактивация
       или потеря прав на портале не отзывала бы доступ к боту.

    Параметры:
        update: Объект обновления от Telegram API
        context: Контекст выполнения
        permission: Требуемое право портала (по умолчанию ``database.read``)

    Возвращает:
        bool: True если доступ разрешен
    """
    from bot.config import config

    user_id = str(update.effective_user.id)

    # Проверяем кэш
    cached_access = user_access_cache.get(user_id)
    if cached_access is not None:
        telegram_granted = cached_access
    else:
        telegram_granted = False

        # Проверяем список разрешенных пользователей
        if user_id in config.telegram.allowed_users:
            user_access_cache.set(user_id, True, ttl=86400)
            telegram_granted = True

        # Проверяем членство в группе
        elif config.telegram.allowed_group_id:
            try:
                member = await context.bot.get_chat_member(
                    chat_id=config.telegram.allowed_group_id,
                    user_id=update.effective_user.id,
                    read_timeout=2
                )
                telegram_granted = member.status in ['member', 'administrator', 'creator']

                if telegram_granted:
                    user_access_cache.set(user_id, True, ttl=3600)
                else:
                    user_access_cache.set(user_id, False, ttl=120)
            except Exception as e:
                error_msg = str(e)
                if "Timed out" in error_msg or "timeout" in error_msg.lower():
                    logger.warning(f"Таймаут при проверке членства в группе для пользователя {user_id}")
                elif "Chat not found" in error_msg:
                    logger.error(f"Группа {config.telegram.allowed_group_id} не найдена")
                elif "Bot was kicked" in error_msg:
                    logger.error(f"Бот исключен из группы {config.telegram.allowed_group_id}")
                else:
                    logger.warning(f"Ошибка проверки членства: {e}")

                user_access_cache.set(user_id, False, ttl=120)
        else:
            user_access_cache.set(user_id, False)

    if not telegram_granted:
        return False

    return await check_hub_user_access(update, permission=permission)


async def check_hub_user_access(
    update: Update,
    *,
    permission: str = PERM_DATABASE_READ,
) -> bool:
    """MED-10: Telegram ID должен быть привязан к активному HUB user.

    Пользователь должен существовать, быть активным и обладать ``permission``.
    ``TELEGRAM_REQUIRE_HUB_USER=0`` отключает проверку (аварийный откат).
    """
    from bot.config import config

    if not getattr(config.telegram, "require_hub_user", True):
        return True

    try:
        telegram_id = int(update.effective_user.id)
    except (TypeError, ValueError):
        return False

    # Блокирующее чтение БД/local_store — выносим из event loop бота.
    hub_user = await asyncio.to_thread(resolve_hub_user, telegram_id)
    if hub_user is None:
        logger.warning(f"Доступ запрещён: Telegram ID {telegram_id} не привязан к пользователю HUB")
        return False
    if not bool(hub_user.get("is_active", True)):
        logger.warning(
            f"Доступ запрещён: пользователь HUB {hub_user.get('id')} "
            f"(Telegram ID {telegram_id}) деактивирован"
        )
        return False
    if not hub_user_has_permission(hub_user, permission):
        logger.warning(
            f"Доступ запрещён: у пользователя HUB {hub_user.get('id')} "
            f"(Telegram ID {telegram_id}) нет права {permission}"
        )
        return False
    return True


async def send_access_denied(update: Update, context: ContextTypes.DEFAULT_TYPE) -> None:
    """Отправляет сообщение об отказе в доступе"""
    from bot.config import Messages
    await update.message.reply_text(Messages.ACCESS_DENIED)


def require_user_access(func: Callable) -> Callable:
    """
    Декоратор для проверки доступа пользователя к боту
    
    Использование:
        @require_user_access
        async def my_handler(update, context):
            ...
    """
    @wraps(func)
    async def wrapper(update: Update, context: ContextTypes.DEFAULT_TYPE, *args, **kwargs) -> Any:
        if not await check_user_access(update, context):
            await send_access_denied(update, context)
            return ConversationHandler.END if hasattr(func, '__conversation_handler__') else None
        return await func(update, context, *args, **kwargs)
    return wrapper


def require_hub_permission(permission: str) -> Callable:
    """
    Декоратор: доступ к боту + конкретное право портала у привязанного
    HUB user (например ``database.write`` для операций записи).

    Использование:
        @require_hub_permission(PERM_DATABASE_WRITE)
        async def my_handler(update, context):
            ...
    """
    def decorator(func: Callable) -> Callable:
        @wraps(func)
        async def wrapper(update: Update, context: ContextTypes.DEFAULT_TYPE, *args, **kwargs) -> Any:
            if not await check_user_access(update, context, permission=permission):
                await send_access_denied(update, context)
                return ConversationHandler.END if hasattr(func, '__conversation_handler__') else None
            return await func(update, context, *args, **kwargs)
        return wrapper
    return decorator


def log_execution_time(func: Callable) -> Callable:
    """
    Декоратор для логирования времени выполнения функции
    
    Использование:
        @log_execution_time
        async def slow_operation(update, context):
            ...
    """
    @wraps(func)
    async def wrapper(*args, **kwargs) -> Any:
        start_time = time.time()
        try:
            result = await func(*args, **kwargs)
            duration = time.time() - start_time
            logger.info(f"{func.__name__} выполнен за {duration:.2f}с")
            return result
        except Exception as e:
            duration = time.time() - start_time
            logger.error(f"{func.__name__} завершился с ошибкой за {duration:.2f}с: {e}")
            raise
    return wrapper


def handle_errors(func: Callable) -> Callable:
    """
    Декоратор для обработки ошибок в обработчиках
    
    Использование:
        @handle_errors
        async def my_handler(update, context):
            ...
    """
    @wraps(func)
    async def wrapper(update: Update, context: ContextTypes.DEFAULT_TYPE, *args, **kwargs) -> Any:
        try:
            return await func(update, context, *args, **kwargs)
        except Exception as e:
            logger.error(f"Ошибка в {func.__name__}: {e}", exc_info=True)
            
            # Отправляем пользователю понятное сообщение
            try:
                if update.message:
                    await update.message.reply_text(
                        "❌ Произошла ошибка при выполнении операции.\n"
                        "Попробуйте позже или обратитесь к администратору."
                    )
                elif update.callback_query:
                    await update.callback_query.answer(
                        "❌ Произошла ошибка",
                        show_alert=True
                    )
            except Exception:
                pass
            
            return ConversationHandler.END
    return wrapper
