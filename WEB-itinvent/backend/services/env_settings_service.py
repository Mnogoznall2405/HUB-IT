"""
Environment settings management with audit logging and apply plan metadata.
"""
from __future__ import annotations

import re
import sqlite3
from dataclasses import dataclass
from datetime import datetime, timezone
from pathlib import Path
from typing import Optional


TARGET_BACKEND = "backend"
TARGET_SCAN_BACKEND = "scan_backend"
TARGET_FRONTEND = "frontend"
TARGET_TELEGRAM_BOT = "telegram_bot"

_ENV_KEY_RE = re.compile(r"^\s*(?:export\s+)?([A-Za-z_][A-Za-z0-9_-]*)\s*=\s*(.*)\s*$")
_SENSITIVE_MARKERS = (
    "SECRET",
    "PASSWORD",
    "TOKEN",
    "API_KEY",
    "PRIVATE_KEY",
    "MAIL_CREDENTIALS_KEY",
)
_DIRECT_DESCRIPTIONS = {
    "TELEGRAM_BOT_TOKEN": ("Telegram bot", "Токен Telegram-бота для подключения к Bot API."),
    "ALLOWED_GROUP_ID": ("Telegram bot", "ID группы Telegram, из которой бот принимает команды."),
    "ALLOWED_USERS": ("Telegram bot", "Список user_id, которым разрешён доступ к Telegram-боту."),
    "OPENROUTER_API_KEY": ("ИИ и интеграции", "Ключ доступа к OpenRouter API для ИИ-запросов."),
    "OPENROUTER_BASE_URL": ("ИИ и интеграции", "Базовый URL OpenRouter API."),
    "OCR_MODEL": ("ИИ и интеграции", "Модель OCR для распознавания текста и серийных номеров."),
    "CARTRIDGE_ANALYSIS_MODEL": ("ИИ и интеграции", "Модель для анализа картриджей и расходников."),
    "SQL_SERVER_HOST": ("База данных", "Основной SQL Server для backend."),
    "SQL_SERVER_DATABASE": ("База данных", "Основная база данных SQL Server."),
    "SQL_SERVER_USERNAME": ("База данных", "Логин подключения к SQL Server."),
    "SQL_SERVER_PASSWORD": ("База данных", "Пароль подключения к SQL Server."),
    "AVAILABLE_DATABASES": ("База данных", "Список доступных баз данных в web-интерфейсе."),
    "SMTP_SERVER": ("Почта и SMTP", "SMTP-сервер для исходящей почты."),
    "EMAIL_ADDRESS": ("Почта и SMTP", "Почтовый адрес сервисной учётной записи."),
    "EMAIL_PASSWORD": ("Почта и SMTP", "Пароль сервисной почты."),
    "TRANSFER_TEMPLATE_PATH": ("Документы", "Путь к шаблону акта передачи."),
    "TRANSFER_ACTS_DIR": ("Документы", "Каталог для сохранения актов передачи."),
    "MAX_TRANSFER_PHOTOS": ("Документы", "Максимум фотографий для одного акта передачи."),
    "MAIL_MODULE_ENABLED": ("Почта Exchange", "Включает или выключает почтовый модуль backend."),
    "MAIL_EXCHANGE_HOST": ("Почта Exchange", "Хост Exchange для почтового модуля."),
    "MAIL_EWS_URL": ("Почта Exchange", "Полный URL EWS Exchange."),
    "MAIL_VERIFY_TLS": ("Почта Exchange", "Проверять ли TLS-сертификат при подключении к Exchange."),
    "MAIL_IT_RECIPIENTS": ("Почта Exchange", "Список IT-получателей уведомлений."),
    "MAIL_LOG_RETENTION_DAYS": ("Почта Exchange", "Сколько дней хранить журнал почтовых операций."),
    "MAIL_SEARCH_WINDOW_LIMIT": ("Почта Exchange", "Лимит окна поиска писем."),
    "MAIL_MAX_FILES": ("Почта Exchange", "Максимум файлов во вложениях одного письма."),
    "MAIL_MAX_FILE_SIZE_MB": ("Почта Exchange", "Максимальный размер одного вложения в МБ."),
    "MAIL_MAX_TOTAL_SIZE_MB": ("Почта Exchange", "Максимальный суммарный размер вложений в МБ."),
    "MAIL_CREDENTIALS_KEY": ("Почта Exchange", "Ключ для шифрования сохранённых почтовых паролей."),
    "VITE_API_URL": ("Frontend", "Базовый адрес API, который встраивается в frontend-сборку."),
    "VITE_BACKEND_HOST": ("Frontend", "Хост backend для dev/build конфигурации frontend."),
    "VITE_BACKEND_PORT": ("Frontend", "Порт backend для dev/build конфигурации frontend."),
    "VITE_BASE_PATH": ("Frontend", "Базовый путь SPA при публикации frontend."),
    "VITE_SCAN_BACKEND_TARGET": ("Frontend", "Адрес scan backend для dev proxy frontend."),
    "BACKEND_PORT": ("Backend API", "Порт запуска основного backend API."),
    "DEBUG": ("Backend API", "Флаг debug-режима backend."),
    "CORS_ORIGINS": ("Backend API", "Разрешённые источники CORS для backend."),
    "JWT_EXPIRE_MINUTES": ("Безопасность", "Срок жизни access token в минутах."),
    "JWT_SECRET_KEY": ("Безопасность", "Основной JWT-ключ подписи."),
    "JWT_SECRET_KEYS": ("Безопасность", "Кольцо активных JWT-ключей; первый используется для подписи."),
    "JWT_PREVIOUS_SECRET_KEYS": ("Безопасность", "Старые JWT-ключи для бесшовной ротации."),
    "AUTH_COOKIE_NAME": ("Безопасность", "Имя auth-cookie с access token."),
    "AUTH_COOKIE_SECURE": ("Безопасность", "Разрешать cookie только по HTTPS."),
    "AUTH_COOKIE_SAMESITE": ("Безопасность", "Политика SameSite для auth-cookie."),
    "AUTH_COOKIE_DOMAIN": ("Безопасность", "Домен auth-cookie."),
    "SESSION_IDLE_TIMEOUT_MINUTES": ("Сессии", "Idle timeout веб-сессии в минутах."),
    "SESSION_HISTORY_RETENTION_DAYS": ("Сессии", "Сколько дней хранить историю закрытых сессий."),
    "SESSION_CLEANUP_MIN_INTERVAL_SECONDS": ("Сессии", "Минимальный интервал между авто-cleanup сессий."),
    "LDAP_SERVER": ("Active Directory", "Адрес LDAP/AD сервера."),
    "LDAP_DOMAIN": ("Active Directory", "Домен Active Directory."),
    "LDAP_BASE_DN": ("Active Directory", "Base DN для поиска пользователей в AD."),
    "LDAP_SYNC_USER": ("Active Directory", "Логин сервисной учётной записи для синхронизации AD."),
    "LDAP_SYNC_PASSWORD": ("Active Directory", "Пароль сервисной учётной записи для синхронизации AD."),
    "LDAP_SYNC_INTERVAL_SECONDS": ("Active Directory", "Интервал фоновой синхронизации AD в секундах."),
    "SCAN_AGENT_SCAN_ON_START": (
        "Scan backend",
        "Запускать локальный scan сразу при старте агента. По умолчанию 0: scan выполняется только по серверной команде scan_now.",
    ),
    "SCAN_AGENT_WATCHDOG_ENABLED": (
        "Scan backend",
        "Включать realtime watchdog для отслеживания файловых изменений. По умолчанию 0; для on-demand режима оставьте выключенным.",
    ),
    "ITINV_OUTLOOK_SEARCH_ROOTS": (
        "Scan backend",
        "Дополнительные корни для поиска PST/OST через ';'. По умолчанию D:\\; пустое значение отключает extra-root поиск.",
    ),
}
_CATEGORY_ORDER = [
    "Backend API",
    "Безопасность",
    "Сессии",
    "Active Directory",
    "База данных",
    "Почта Exchange",
    "Почта и SMTP",
    "ИИ и интеграции",
    "Scan backend",
    "Telegram bot",
    "Frontend",
    "Документы",
    "Прочее",
]
_TARGET_META = {
    TARGET_BACKEND: {
        "id": TARGET_BACKEND,
        "label": "Основной backend",
        "description": "Основной FastAPI backend на 127.0.0.1:8001.",
        "apply_hint": "После изменения нужен перезапуск backend-процесса.",
        "commands": ["pm2 restart itinvent-backend"],
    },
    TARGET_SCAN_BACKEND: {
        "id": TARGET_SCAN_BACKEND,
        "label": "Scan backend",
        "description": "Сервис scan/backend на 127.0.0.1:8011.",
        "apply_hint": "После изменения нужен перезапуск scan backend.",
        "commands": ["pm2 restart itinvent-scan"],
    },
    TARGET_TELEGRAM_BOT: {
        "id": TARGET_TELEGRAM_BOT,
        "label": "Telegram bot",
        "description": "Telegram-бот и связанные интеграции.",
        "apply_hint": "После изменения нужен перезапуск Telegram-бота.",
        "commands": ["pm2 restart itinvent-bot"],
    },
    TARGET_FRONTEND: {
        "id": TARGET_FRONTEND,
        "label": "Frontend build",
        "description": "Frontend собирается отдельно и публикуется через IIS.",
        "apply_hint": "После изменения нужен новый build frontend.",
        "commands": [
            "cd C:\\Project\\Image_scan\\WEB-itinvent\\frontend",
            "npm run build",
        ],
    },
}


@dataclass
class _EnvEntry:
    kind: str
    raw: str
    key: Optional[str] = None
    value: Optional[str] = None


def _utc_now_iso() -> str:
    return datetime.now(timezone.utc).replace(microsecond=0).isoformat()


def _is_sensitive_key(key: str) -> bool:
    upper_key = str(key or "").upper()
    return any(marker in upper_key for marker in _SENSITIVE_MARKERS)


def _mask_value(key: str, value: Optional[str]) -> str:
    text = "" if value is None else str(value)
    if not _is_sensitive_key(key):
        return text
    return f"Скрыто (длина {len(text)})"


def _normalize_value(value: Optional[str]) -> str:
    if value is None:
        return ""
    return str(value)


def _build_targets(key: str) -> tuple[list[str], bool]:
    upper_key = str(key or "").upper()
    if upper_key.startswith("VITE_"):
        return [TARGET_FRONTEND], True
    if upper_key.startswith("SCAN_") or upper_key.startswith("MFU_"):
        return [TARGET_SCAN_BACKEND], False
    if upper_key.startswith("TELEGRAM_") or upper_key.startswith("BOT_") or upper_key.startswith("OPENROUTER_"):
        return [TARGET_TELEGRAM_BOT], False
    if upper_key.startswith("ALLOWED_GROUP") or upper_key.startswith("ALLOWED_USERS"):
        return [TARGET_TELEGRAM_BOT], False
    if upper_key.startswith("SMTP_") or upper_key.startswith("EMAIL_") or upper_key.startswith("TRANSFER_") or upper_key == "MAX_TRANSFER_PHOTOS":
        return [TARGET_TELEGRAM_BOT], False
    if upper_key.startswith("DB_") or upper_key.startswith("SQL_SERVER_") or upper_key == "AVAILABLE_DATABASES":
        return [TARGET_BACKEND, TARGET_TELEGRAM_BOT], False
    return [TARGET_BACKEND], False


def _describe_variable(key: str) -> tuple[str, str]:
    normalized_key = str(key or "").strip()
    upper_key = normalized_key.upper()
    exact = _DIRECT_DESCRIPTIONS.get(upper_key)
    if exact:
        return exact
    if upper_key.startswith("DB_"):
        return ("База данных", f"Параметр подключения для алиаса базы данных {normalized_key[3:]}.")
    if upper_key.startswith("SCAN_SERVER_"):
        return ("Scan backend", f"Параметр scan backend: {normalized_key}.")
    if upper_key.startswith("SCAN_AGENT_"):
        return ("Scan backend", f"Параметр scan agent: {normalized_key}.")
    if upper_key.startswith("SCAN_"):
        return ("Scan backend", f"Параметр scan-контура: {normalized_key}.")
    if upper_key.startswith("MFU_"):
        return ("Scan backend", f"Параметр мониторинга МФУ: {normalized_key}.")
    if upper_key.startswith("ITINV_"):
        return ("Scan backend", f"Параметр inventory/agent контура: {normalized_key}.")
    if upper_key.startswith("MAIL_"):
        return ("Почта Exchange", f"Параметр почтового модуля: {normalized_key}.")
    if upper_key.startswith("LDAP_"):
        return ("Active Directory", f"Параметр интеграции с Active Directory: {normalized_key}.")
    if upper_key.startswith("SESSION_"):
        return ("Сессии", f"Параметр life-cycle веб-сессий: {normalized_key}.")
    if upper_key.startswith("JWT_") or upper_key.startswith("AUTH_COOKIE_"):
        return ("Безопасность", f"Параметр аутентификации и токенов: {normalized_key}.")
    if upper_key.startswith("VITE_"):
        return ("Frontend", f"Переменная frontend build: {normalized_key}.")
    if upper_key.startswith("TELEGRAM_") or upper_key.startswith("BOT_"):
        return ("Telegram bot", f"Параметр Telegram-бота: {normalized_key}.")
    if upper_key.startswith("SMTP_") or upper_key.startswith("EMAIL_"):
        return ("Почта и SMTP", f"SMTP/почтовый параметр: {normalized_key}.")
    return ("Прочее", f"Служебная переменная окружения {normalized_key}.")


class EnvSettingsService:
    def __init__(
        self,
        env_path: Optional[Path] = None,
        audit_db_path: Optional[Path] = None,
    ):
        project_root = Path(__file__).resolve().parents[3]
        self.env_path = Path(env_path) if env_path is not None else project_root / ".env"
        self.audit_db_path = Path(audit_db_path) if audit_db_path is not None else project_root / "data" / "env_settings_audit.db"
        self.env_path.parent.mkdir(parents=True, exist_ok=True)
        self.audit_db_path.parent.mkdir(parents=True, exist_ok=True)
        if not self.env_path.exists():
            self.env_path.write_text("", encoding="utf-8")
        self._ensure_audit_schema()

    def _connect_audit(self) -> sqlite3.Connection:
        return sqlite3.connect(self.audit_db_path)

    def _ensure_audit_schema(self) -> None:
        with self._connect_audit() as conn:
            conn.execute(
                """
                CREATE TABLE IF NOT EXISTS env_settings_audit (
                    id INTEGER PRIMARY KEY AUTOINCREMENT,
                    key TEXT NOT NULL,
                    old_value_masked TEXT NOT NULL DEFAULT '',
                    new_value_masked TEXT NOT NULL DEFAULT '',
                    actor_user_id INTEGER NOT NULL DEFAULT 0,
                    actor_username TEXT NOT NULL DEFAULT '',
                    changed_at TEXT NOT NULL,
                    apply_targets TEXT NOT NULL DEFAULT '',
                    requires_frontend_build INTEGER NOT NULL DEFAULT 0
                )
                """
            )
            conn.execute(
                """
                CREATE INDEX IF NOT EXISTS idx_env_settings_audit_key_changed_at
                ON env_settings_audit(key, changed_at DESC)
                """
            )

    def _read_entries(self) -> list[_EnvEntry]:
        raw_text = self.env_path.read_text(encoding="utf-8") if self.env_path.exists() else ""
        entries: list[_EnvEntry] = []
        for line in raw_text.splitlines():
            match = _ENV_KEY_RE.match(line)
            if not match:
                entries.append(_EnvEntry(kind="raw", raw=line))
                continue
            key, value = match.group(1), match.group(2)
            entries.append(_EnvEntry(kind="binding", raw=line, key=key, value=value))
        return entries

    def _write_entries(self, entries: list[_EnvEntry]) -> None:
        lines = []
        for entry in entries:
            if entry.kind == "binding" and entry.key is not None:
                lines.append(f"{entry.key}={entry.value or ''}")
            else:
                lines.append(entry.raw)
        text = "\n".join(lines)
        if lines:
            text += "\n"
        self.env_path.write_text(text, encoding="utf-8")

    def _current_map(self, entries: Optional[list[_EnvEntry]] = None) -> dict[str, str]:
        resolved = entries if entries is not None else self._read_entries()
        result: dict[str, str] = {}
        for entry in resolved:
            if entry.kind == "binding" and entry.key is not None:
                result[entry.key] = entry.value or ""
        return result

    def _serialize_item(self, key: str, value: str) -> dict:
        category, description = _describe_variable(key)
        targets, requires_frontend_build = _build_targets(key)
        return {
            "key": key,
            "value": value,
            "masked_value": _mask_value(key, value),
            "is_sensitive": _is_sensitive_key(key),
            "category": category,
            "description": description,
            "apply_targets": targets,
            "apply_target_labels": [_TARGET_META[target]["label"] for target in targets],
            "requires_frontend_build": requires_frontend_build,
            "requires_restart_targets": [target for target in targets if target != TARGET_FRONTEND],
        }

    def list_variables(self) -> list[dict]:
        current = self._current_map()

        def sort_key(item: dict) -> tuple[int, str]:
            category = item["category"]
            order = _CATEGORY_ORDER.index(category) if category in _CATEGORY_ORDER else len(_CATEGORY_ORDER)
            return (order, item["key"])

        items = [self._serialize_item(key, current[key]) for key in current]
        return sorted(items, key=sort_key)

    def get_deployment_targets(self) -> list[dict]:
        return [dict(meta) for meta in _TARGET_META.values()]

    def get_recent_changes(self, *, limit: int = 15) -> list[dict]:
        with self._connect_audit() as conn:
            rows = conn.execute(
                """
                SELECT key, old_value_masked, new_value_masked, actor_user_id, actor_username,
                       changed_at, apply_targets, requires_frontend_build
                FROM env_settings_audit
                ORDER BY changed_at DESC, id DESC
                LIMIT ?
                """,
                (int(limit),),
            ).fetchall()
        recent = []
        for row in rows:
            targets = [item for item in str(row[6] or "").split(",") if item]
            recent.append(
                {
                    "key": row[0],
                    "old_value_masked": row[1],
                    "new_value_masked": row[2],
                    "actor_user_id": int(row[3] or 0),
                    "actor_username": row[4] or "",
                    "changed_at": row[5],
                    "apply_targets": targets,
                    "apply_target_labels": [_TARGET_META[target]["label"] for target in targets if target in _TARGET_META],
                    "requires_frontend_build": bool(row[7]),
                }
            )
        return recent

    def _build_apply_plan(self, changed_keys: list[str]) -> list[dict]:
        grouped: dict[str, dict] = {}
        for key in changed_keys:
            targets, requires_frontend_build = _build_targets(key)
            for target in targets:
                meta = _TARGET_META[target]
                entry = grouped.setdefault(
                    target,
                    {
                        "target": target,
                        "label": meta["label"],
                        "description": meta["description"],
                        "apply_hint": meta["apply_hint"],
                        "commands": list(meta["commands"]),
                        "keys": [],
                        "requires_frontend_build": False,
                        "requires_restart": target != TARGET_FRONTEND,
                    },
                )
                entry["keys"].append(key)
                entry["requires_frontend_build"] = entry["requires_frontend_build"] or requires_frontend_build

        return list(grouped.values())

    def get_snapshot(self, *, updated: int = 0, apply_plan: Optional[list[dict]] = None) -> dict:
        return {
            "updated": int(updated),
            "items": self.list_variables(),
            "deployment_targets": self.get_deployment_targets(),
            "apply_plan": apply_plan or [],
            "recent_changes": self.get_recent_changes(),
        }

    def update_variables(
        self,
        updates: dict[str, Optional[str]],
        *,
        actor_user_id: int,
        actor_username: str,
    ) -> dict:
        normalized_updates = {
            str(key).strip(): _normalize_value(value)
            for key, value in (updates or {}).items()
            if str(key).strip()
        }
        entries = self._read_entries()
        current = self._current_map(entries)
        index_by_key = {
            entry.key: idx
            for idx, entry in enumerate(entries)
            if entry.kind == "binding" and entry.key is not None
        }

        changed_keys: list[str] = []
        recent_changes: list[dict] = []
        changed_at = _utc_now_iso()

        for key, new_value in normalized_updates.items():
            old_value = current.get(key)
            if old_value == new_value:
                continue
            if key in index_by_key:
                entries[index_by_key[key]].value = new_value
            else:
                entries.append(_EnvEntry(kind="binding", raw="", key=key, value=new_value))
            changed_keys.append(key)

            apply_targets, requires_frontend_build = _build_targets(key)
            recent_changes.append(
                {
                    "key": key,
                    "old_value_masked": _mask_value(key, old_value),
                    "new_value_masked": _mask_value(key, new_value),
                    "actor_user_id": int(actor_user_id or 0),
                    "actor_username": str(actor_username or "").strip(),
                    "changed_at": changed_at,
                    "apply_targets": apply_targets,
                    "apply_target_labels": [_TARGET_META[target]["label"] for target in apply_targets],
                    "requires_frontend_build": requires_frontend_build,
                }
            )

        apply_plan = self._build_apply_plan(changed_keys)
        if changed_keys:
            self._write_entries(entries)
            with self._connect_audit() as conn:
                for item in recent_changes:
                    conn.execute(
                        """
                        INSERT INTO env_settings_audit (
                            key,
                            old_value_masked,
                            new_value_masked,
                            actor_user_id,
                            actor_username,
                            changed_at,
                            apply_targets,
                            requires_frontend_build
                        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?)
                        """,
                        (
                            item["key"],
                            item["old_value_masked"],
                            item["new_value_masked"],
                            item["actor_user_id"],
                            item["actor_username"],
                            item["changed_at"],
                            ",".join(item["apply_targets"]),
                            1 if item["requires_frontend_build"] else 0,
                        ),
                    )

        snapshot = self.get_snapshot(updated=len(changed_keys), apply_plan=apply_plan)
        if recent_changes:
            snapshot["recent_changes"] = recent_changes + [
                item for item in snapshot["recent_changes"]
                if item["changed_at"] != changed_at or item["actor_username"] != str(actor_username or "").strip()
            ]
            snapshot["recent_changes"] = snapshot["recent_changes"][:15]
        return snapshot


env_settings_service = EnvSettingsService()
