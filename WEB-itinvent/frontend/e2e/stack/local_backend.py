"""Local E2E backend: real ``backend.main:app`` on a throwaway SQLite DB.

Started by Playwright ``webServer`` when ``E2E_LOCAL=1``. Everything the app
needs is created here before uvicorn boots: environment, schema, seed users
and the ticket dictionaries the UI lists. Nothing reaches the production
database — app/chat runtime state lives in ``e2e/stack/.state/`` and is wiped
on every run.

Seed users (test-only credentials, never real accounts):
    e2e_admin / e2e-local-admin-pass   (role=admin)
    e2e_user  / e2e-local-user-pass    (role=operator)
"""
from __future__ import annotations

import os
import shutil
import sqlite3
import sys
from pathlib import Path

STACK_DIR = Path(__file__).resolve().parent
FRONTEND_DIR = STACK_DIR.parent.parent
WEB_ROOT = FRONTEND_DIR.parent
STATE_NAME = os.environ.get("E2E_STATE_NAME", ".state")
if not STATE_NAME.startswith(".state") or Path(STATE_NAME).name != STATE_NAME:
    raise RuntimeError("E2E state must be a .state directory immediately below stack/")
STATE_DIR = STACK_DIR / STATE_NAME
APP_DB = STATE_DIR / "app.sqlite3"
CHAT_DB = STATE_DIR / "chat.sqlite3"

# Работающая копия может лежать глубоко в дереве каталогов (worktree,
# .codex_tmp) — тогда путь вложения стикера упирается в MAX_PATH=260 и
# backend не может скопировать файл в чат. Для таких запусков каталог
# данных выносится наружу через E2E_HUB_DATA_DIR (например C:\Temp\...).
# E2E_HUB_DATA_DIR — это *корневой* каталог, выделенный под тестовые
# данные: реальные файлы живут в уникальной поддиректории вида
# ``hub_data-<state>`` с маркером владения, сам корень никогда не удаляется.
HUB_DATA_MARKER = ".hub-it-e2e-owned"


def _resolve_hub_data_dir() -> Path:
    raw = os.environ.get("E2E_HUB_DATA_DIR")
    if not raw:
        return STATE_DIR / "hub_data"
    root = Path(raw).expanduser()
    if not root.is_dir():
        raise RuntimeError(
            "E2E_HUB_DATA_DIR must be an existing directory designated for "
            f"test data; got: {root}"
        )
    resolved_root = root.resolve()
    state_dir = STATE_DIR.resolve()
    if resolved_root == state_dir or state_dir in resolved_root.parents:
        raise RuntimeError(
            f"E2E_HUB_DATA_DIR must not point inside the E2E state dir: {resolved_root}"
        )
    if resolved_root.parent == resolved_root:
        raise RuntimeError(
            f"E2E_HUB_DATA_DIR must not be a filesystem root: {resolved_root}"
        )
    child = (resolved_root / f"hub_data-{STATE_NAME.lstrip('.')}").resolve()
    if child.parent != resolved_root:
        raise RuntimeError(f"E2E data dir escaped its designated root: {child}")
    return child


def _reset_hub_data_dir(target: Path) -> None:
    """Пересоздать каталог данных — только если он явно принадлежит E2E.

    Вне .state удаляется исключительно директория ``hub_data-state*`` с
    маркером ``HUB_DATA_MARKER`` и ожидаемым содержимым. Любая другая цель
    завершает запуск ошибкой, ничего не изменив на диске.
    """
    resolved = target.resolve()
    if resolved == (STATE_DIR / "hub_data").resolve():
        return  # внутри .state — удаляется вместе с ним
    if not resolved.name.startswith("hub_data-state"):
        raise RuntimeError(
            f"E2E refuses to manage an unmanaged data path: {resolved}"
        )
    if resolved.exists():
        marker = resolved / HUB_DATA_MARKER
        expected = f"hub-it-e2e {STATE_NAME}"
        actual = marker.read_text(encoding="utf-8").strip() if marker.is_file() else ""
        if actual != expected:
            raise RuntimeError(
                "E2E refuses to delete an unmarked directory "
                f"{resolved}: expected {HUB_DATA_MARKER} containing {expected!r}; "
                "remove it manually if the directory is disposable"
            )
        shutil.rmtree(resolved)
    resolved.mkdir(parents=True, exist_ok=True)
    (resolved / HUB_DATA_MARKER).write_text(f"hub-it-e2e {STATE_NAME}", encoding="utf-8")


HUB_DATA_DIR = _resolve_hub_data_dir()

BACKEND_PORT = int(os.environ.get("E2E_BACKEND_PORT", "18001"))

# Environment must be set before any backend import — config and services
# snapshot os.environ at import time. Explicit assignment (not setdefault):
# a developer's root .env must not leak real endpoints into the test stack.
os.environ.update(
    {
        "APP_ENV": "development",
        "APP_DATABASE_URL": f"sqlite:///{APP_DB.as_posix()}",
        "CHAT_DATABASE_URL": f"sqlite:///{CHAT_DB.as_posix()}",
        "CHAT_MODULE_ENABLED": "1",
        "CHAT_REALTIME_TRANSPORT": "local",
        "CHAT_SURFACE": "full",
        "HUBIT_RUNTIME_ROLE": "embedded",
        "JWT_SECRET_KEY": "e2e-local-jwt-secret-not-for-production",
        "AUTH_COOKIE_SECURE": "false",
        # Background loops that would otherwise reach for LDAP / SQL Server /
        # external services — none of that exists in the test stack.
        "LDAP_SYNC_BACKGROUND_ENABLED": "0",
        "LDAP_APP_USER_SYNC_ENABLED": "0",
        "AD_GROUPS_ACCESS_SYNC_ENABLED": "0",
        "ADDRESS_BOOK_SYNC_ENABLED": "0",
        "WAREHOUSE_1C_CATALOG_SYNC_ENABLED": "0",
        "TASK_DUE_NOTIFICATION_BACKGROUND_ENABLED": "0",
        "DOCFLOW_NOTIFICATION_BACKGROUND_ENABLED": "0",
        "ANNOUNCEMENT_PUBLISH_BACKGROUND_ENABLED": "0",
        "MFU_RUNTIME_MONITOR_ENABLED": "0",
        "MONITORING_BACKGROUND_ENABLED": "0",
        "MONITORING_RETENTION_APPLY": "0",
        "MAIL_MODULE_ENABLED": "0",
        "MAIL_NOTIFICATION_BACKGROUND_ENABLED": "0",
        "MY_FILES_INLINE_WORKER_ENABLED": "1" if os.environ.get("E2E_FILES_WORKER") == "1" else "0",
        "WINDOWS_SSO_ENABLED": "0",
        # The seed users have no second factor; the browser login flow is the
        # contract under test, not the 2FA enrollment wizard. The root .env
        # ships AUTH_2FA_POLICY=external_only and loopback is outside the
        # internal CIDRs, so both the flag and the policy must be off.
        "AUTH_2FA_ENFORCED": "0",
        "AUTH_2FA_POLICY": "off",
        # Loopback counts as the internal network zone: skips the per-IP
        # login rate limit (5/min) that a multi-spec run would hit.
        "AUTH_2FA_INTERNAL_CIDRS": "10.0.0.0/8,127.0.0.0/8,::1/128",
        # Browser uploads send Origin: http://127.0.0.1:5174 (the Playwright
        # baseURL host) — my_files upload rejects origins outside cors_origins,
        # and the root .env points at production hosts.
        "CORS_ORIGINS": f"http://127.0.0.1:{os.environ.get('E2E_FRONTEND_PORT', '5174')},http://localhost:{os.environ.get('E2E_FRONTEND_PORT', '5174')}",
        # File writes must stay inside .state — otherwise uploads and chat
        # attachments land in the developer's real data/ directory.
        "HUB_DATA_DIR": str(HUB_DATA_DIR),
        "MY_FILES_STORAGE_DIR": str(STATE_DIR / "my_files"),
        "MY_FILES_SPOOL_DIR": str(STATE_DIR / "my_files_spool"),
        "MY_FILES_PREVIEWS_DIR": str(STATE_DIR / "my_files_previews"),
        "SQL_SERVER_HOST": "127.0.0.1",
        "SQL_SERVER_DATABASE": "HUB_IT_E2E_UNAVAILABLE",
        "SQL_SERVER_USERNAME": "",
        "SQL_SERVER_PASSWORD": "",
        "SQL_SERVER_DRIVER": "HUB_IT_E2E_DISABLED_DRIVER",
        "WAREHOUSE_1C_PROCESS_BRIDGE_ENABLED": "0",
        "BUH20_1C_USER": "",
        "BUH20_1C_PASSWORD": "",
        "TASK_EMAIL_AUTODISPATCH_ENABLED": "0",
        "AUTH_NEW_LOGIN_EMAIL_ENABLED": "0",
        "REDIS_URL": "",
        "REDIS_PASSWORD": "",
        # Telegram-import в тестовом стеке недоступен (нет bot token) — вместо
        # него сидится локальный набор; short_name попадает в список
        # «дефолтных», поэтому _ensure_default_packs авто-устанавливает его
        # любому пользователю при первом list_packs.
        "CHAT_DEFAULT_STICKER_PACKS": "e2e_test_pack,e2e_big_pack",
        "TELEGRAM_BOT_TOKEN": "",
    }
)

for database_id in ('ITINVENT', 'MSK-ITINVENT', 'OBJ-ITINVENT', 'SPB-ITINVENT'):
    os.environ.update({
        f'DB_{database_id}_HOST': '127.0.0.1',
        f'DB_{database_id}_DATABASE': 'HUB_IT_E2E_UNAVAILABLE',
        f'DB_{database_id}_USERNAME': '',
        f'DB_{database_id}_PASSWORD': '',
    })

if str(WEB_ROOT) not in sys.path:
    sys.path.insert(0, str(WEB_ROOT))


def _seed() -> None:
    """Fresh schema + deterministic fixtures for the browser flows."""
    # Внешний каталог проверяется и пересоздаётся до .state — при ошибке
    # владения запуск падает до любого удаления.
    _reset_hub_data_dir(HUB_DATA_DIR)
    shutil.rmtree(STATE_DIR, ignore_errors=True)
    if APP_DB.exists() or CHAT_DB.exists():
        raise RuntimeError("E2E SQLite files are busy; choose an unused E2E_STATE_NAME")
    STATE_DIR.mkdir(parents=True, exist_ok=True)

    for database_path in (APP_DB, CHAT_DB):
        with sqlite3.connect(database_path) as connection:
            journal_mode = connection.execute('PRAGMA journal_mode=WAL').fetchone()[0]
            if str(journal_mode).lower() != 'wal':
                raise RuntimeError(f'E2E database did not enable WAL: {database_path.name}')

    if str(WEB_ROOT.parent) not in sys.path:
        sys.path.insert(0, str(WEB_ROOT.parent))
    from local_store import get_local_store
    get_local_store(data_dir=STATE_DIR / 'local_store')

    from backend.appdb.db import app_session, initialize_app_schema
    from backend.appdb.tickets_models import TicketEmployee, TicketObject
    from backend.chat.db import initialize_chat_schema
    from backend.services.user_service import user_service

    initialize_app_schema()
    initialize_chat_schema()

    for username, password, role, full_name in (
        ("e2e_admin", "e2e-local-admin-pass", "admin", "E2E Админ"),
        ("e2e_user", "e2e-local-user-pass", "operator", "E2E Пользователь"),
        # Fresh account: no about_onboarding_completed_at — drives the
        # /about onboarding gate and its return-path flow in auth-guards.
        ("e2e_fresh", "e2e-local-fresh-pass", "operator", "E2E Новый"),
    ):
        if user_service.get_by_username(username) is None:
            user_service.create_user(
                username,
                password=password,
                role=role,
                full_name=full_name,
                email=f"{username}@example.com",
            )

    assert user_service.authenticate("e2e_admin", "e2e-local-admin-pass"), (
        "seeded user cannot authenticate — user_service did not persist to the app DB"
    )

    # Admin logins are restricted to an IP allowlist stored in app settings;
    # the shipped default only covers the production admin host. Allow the
    # loopback addresses the test stack actually sees.
    from backend.services.app_settings_service import app_settings_service

    allowed = app_settings_service.get_admin_login_allowed_ips()
    for ip in ("127.0.0.1", "::1"):
        if ip not in allowed:
            allowed.append(ip)
    app_settings_service.update_settings({"admin_login_allowed_ips": allowed})

    from datetime import datetime, timezone
    from sqlalchemy import select

    from backend.appdb.models import AppUser

    now = datetime.now(timezone.utc)
    with app_session() as session:
        # create_user leaves about_onboarding_completed_at NULL, and the SPA
        # force-redirects such users to /about until onboarding is done.
        # e2e_fresh intentionally keeps NULL — it plays the first-login user.
        for row in session.scalars(select(AppUser)).all():
            if row.username != "e2e_fresh" and row.about_onboarding_completed_at is None:
                row.about_onboarding_completed_at = now

        if session.query(TicketObject).count() == 0:
            session.add_all(
                [
                    TicketObject(
                        code="MSK", name="Москва", region="Центр",
                        is_active=True, created_at=now, updated_at=now,
                    ),
                    TicketEmployee(
                        full_name="Иванов Иван Иванович", date_of_birth_enc="",
                        status="active", created_at=now, updated_at=now,
                    ),
                ]
            )


def _seed_sticker_pack() -> None:
    """Локальный набор из 3 статичных WebP-стикеров.

    Файлы лежат там же, где их кладёт реальный импорт
    (``HUB_DATA_DIR/chat_sticker_packs/<pack_id>/``), а маркер превью-кэша
    включает авто-установку набора пользователям. Доставка и рендер идут
    через настоящие эндпоинты — тестируется полный контур без Telegram.
    """
    import base64
    from uuid import uuid4

    from backend.chat.db import chat_write_session
    from backend.chat.models import ChatSticker, ChatStickerPack
    from backend.chat.telegram_sticker_service import (
        _PREVIEW_CACHE_MARKER,
        telegram_sticker_service,
    )

    # 1x1 прозрачный WebP — минимальный валидный файл, /file и /preview
    # отдают его как настоящий стикер.
    webp = base64.b64decode("UklGRiIAAABXRUJQVlA4IBYAAAAwAQCdASoBAAEADsD+JaQAA3AAAAAA")

    def _write_pack(short_name: str, title: str, count: int) -> None:
        pack_id = str(uuid4())
        sticker_ids = [str(uuid4()) for _ in range(count)]
        pack_dir = telegram_sticker_service._storage_root / pack_id
        pack_dir.mkdir(parents=True, exist_ok=True)
        for sticker_id in sticker_ids:
            (pack_dir / f"{sticker_id}.webp").write_bytes(webp)
            (pack_dir / f"{sticker_id}.preview").write_bytes(webp)
        (pack_dir / _PREVIEW_CACHE_MARKER).write_text("e2e", encoding="utf-8")

        with chat_write_session() as session:
            session.add(
                ChatStickerPack(
                    id=pack_id,
                    short_name=short_name,
                    title=title,
                    sticker_type="regular",
                )
            )
            for index, sticker_id in enumerate(sticker_ids):
                session.add(
                    ChatSticker(
                        id=sticker_id,
                        pack_id=pack_id,
                        telegram_file_id=f"e2e-file-{index}",
                        telegram_file_unique_id=f"e2e-unique-{index}",
                        emoji="\U0001f9ea",
                        format="static",
                        mime_type="image/webp",
                        storage_name=f"{sticker_id}.webp",
                        file_size=len(webp),
                        width=512,
                        height=512,
                        sort_order=index,
                    )
                )

    _write_pack("e2e_test_pack", "E2E Test Pack", 3)
    # Большой набор — замеры монтирования/прокрутки длинного списка
    # (реалистичный пользовательский пак, ~90 стикеров).
    _write_pack("e2e_big_pack", "E2E Big Pack", 90)


def main() -> None:
    _seed()
    _seed_sticker_pack()
    if os.environ.get("E2E_AI_RELIABILITY") == "1":
        from ai_reliability_seed import seed_ai_reliability
        seed_ai_reliability(STATE_DIR)
    if os.environ.get("E2E_MONITORING_SEED") == "1":
        from monitoring_seed import seed_monitoring
        seed_monitoring()

    import uvicorn

    uvicorn.run(
        "backend.main:app",
        host="127.0.0.1",
        port=BACKEND_PORT,
        log_level="warning",
        loop="asyncio",
    )


if __name__ == "__main__":
    main()
