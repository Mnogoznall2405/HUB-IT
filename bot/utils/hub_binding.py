#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
Привязка Telegram ID к учётной записи HUB (MED-10).

Доступ к боту должен отзываться при деактивации пользователя HUB и
учитывать его права портала: без привязки любой член Telegram-группы или
запись в allowlist сохранял бы доступ после увольнения/блокировки.

Источник данных совпадает с web-рантаймом: ``app.users`` при настроенном
``APP_DATABASE_URL``, иначе общий с web файл ``data/web_users.json`` через
``local_store``. Ошибки чтения трактуются fail-closed (доступ запрещён).
"""

from __future__ import annotations

import json
import logging
import sys
import threading
import time
from pathlib import Path
from typing import Optional

_WEB_ROOT = Path(__file__).resolve().parents[2] / "WEB-itinvent"
if _WEB_ROOT.exists() and str(_WEB_ROOT) not in sys.path:
    sys.path.insert(0, str(_WEB_ROOT))

_REPO_ROOT = Path(__file__).resolve().parents[2]
if str(_REPO_ROOT) not in sys.path:
    sys.path.insert(0, str(_REPO_ROOT))

logger = logging.getLogger(__name__)

WEB_USERS_FILE = "web_users.json"
PERM_DATABASE_READ = "database.read"
PERM_DATABASE_WRITE = "database.write"

# Короткое окно кэша: деактивация пользователя HUB прекращает доступ бота
# в течение минут, не заставляя перечитывать таблицу на каждое сообщение.
_CACHE_TTL_SEC = 300.0

_cache_lock = threading.Lock()
_cache: dict[int, tuple[float, Optional[dict]]] = {}
_use_app_db_cached: Optional[bool] = None


def _use_app_database() -> bool:
    """APP_DATABASE_URL фиксируется на старте процесса; читаем один раз."""
    global _use_app_db_cached
    if _use_app_db_cached is None:
        try:
            from backend.appdb.db import is_app_database_configured

            _use_app_db_cached = bool(is_app_database_configured())
        except Exception:
            # backend.appdb недоступен в этом окружении — JSON/local_store режим
            _use_app_db_cached = False
    return _use_app_db_cached


def _load_from_app_db(telegram_id: int) -> Optional[dict]:
    from sqlalchemy import select

    from backend.appdb.db import app_session
    from backend.appdb.models import AppUser

    with app_session() as session:
        row = session.scalars(
            select(AppUser).where(AppUser.telegram_id == int(telegram_id))
        ).first()
        if row is None:
            return None
        try:
            custom = json.loads(str(row.custom_permissions_json or "[]"))
        except Exception:
            custom = []
        if not isinstance(custom, list):
            custom = []
        return {
            "id": int(row.id),
            "username": str(row.username or ""),
            "is_active": bool(row.is_active),
            "role": str(row.role or "viewer"),
            "use_custom_permissions": bool(row.use_custom_permissions),
            "custom_permissions": custom,
        }


def _load_from_local_store(telegram_id: int) -> Optional[dict]:
    from bot.local_json_store import load_json_data

    users = load_json_data(WEB_USERS_FILE, default_content=[])
    if not isinstance(users, list):
        return None
    for user in users:
        if not isinstance(user, dict):
            continue
        try:
            bound_id = int(user.get("telegram_id") or 0)
        except (TypeError, ValueError):
            continue
        if bound_id and bound_id == int(telegram_id):
            return {
                "id": int(user.get("id") or 0),
                "username": str(user.get("username") or ""),
                "is_active": bool(user.get("is_active", True)),
                "role": str(user.get("role") or "viewer"),
                "use_custom_permissions": bool(user.get("use_custom_permissions", False)),
                "custom_permissions": user.get("custom_permissions") or [],
            }
    return None


def resolve_hub_user(telegram_id: int) -> Optional[dict]:
    """Возвращает HUB user, привязанный к Telegram ID, или None.

    None означает «нет привязки или источник недоступен» — вызывающий код
    обязан трактовать это как отказ (fail-closed).
    """
    try:
        tid = int(telegram_id)
    except (TypeError, ValueError):
        return None
    now = time.monotonic()
    with _cache_lock:
        cached = _cache.get(tid)
        if cached is not None and (now - cached[0]) < _CACHE_TTL_SEC:
            return dict(cached[1]) if cached[1] is not None else None

    try:
        user = _load_from_app_db(tid) if _use_app_database() else _load_from_local_store(tid)
    except Exception as exc:
        logger.warning(
            "Не удалось проверить привязку Telegram ID %s к пользователю HUB: %s",
            tid,
            exc,
        )
        return None

    with _cache_lock:
        _cache[tid] = (time.monotonic(), dict(user) if user is not None else None)
    return dict(user) if user is not None else None


def hub_user_has_permission(user: Optional[dict], permission: str) -> bool:
    """Эффективные права портала для привязанного пользователя."""
    if not isinstance(user, dict):
        return False
    try:
        from backend.services.authorization_service import authorization_service

        return bool(
            authorization_service.has_permission(
                user.get("role"),
                permission,
                use_custom_permissions=bool(user.get("use_custom_permissions")),
                custom_permissions=user.get("custom_permissions"),
            )
        )
    except Exception as exc:
        logger.warning(
            "Не удалось проверить право %s у HUB user %s: %s",
            permission,
            user.get("id"),
            exc,
        )
        return False


def _reset_cache() -> None:
    """Тесты: сбросить мемоизированные привязки и режим хранилища."""
    global _use_app_db_cached
    with _cache_lock:
        _cache.clear()
        _use_app_db_cached = None
