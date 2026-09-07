# Карта репозитория HUB-IT

Справочник по подсистемам, точкам входа и командам. Читать нужный раздел по задаче. Обязательные правила и production-согласования находятся в [AGENTS.md](../../AGENTS.md). Пути в кодовых блоках указаны относительно корня репозитория.

> Человекочитаемый обзор для людей: [README.md](../../README.md)  
> **Язык домена (термины):** [CONTEXT.md](../../CONTEXT.md)  
> **PostgreSQL:** [POSTGRES_APP_SCHEMA.md](../../documentation/technical/POSTGRES_APP_SCHEMA.md) · [DDL snapshot](../../documentation/technical/POSTGRES_APP_SCHEMA_DDL.md)  
> Детали web-приложения: [WEB-itinvent/CLAUDE.md](../../WEB-itinvent/CLAUDE.md)  
> Техдолг и рефакторинг: [TECH_DEBT_AUDIT.md](../../TECH_DEBT_AUDIT.md)

---

## О проекте

**HUB-IT** (`Image_scan/`) — монорепозиторий внутренней платформы учёта и обслуживания IT-инфраструктуры.

| Подсистема | Назначение |
|------------|------------|
| **WEB-itinvent** | Web UI + FastAPI: оборудование, сети, hub/tasks, почта, чат, tickets, Scan Center. Chat runtime может работать отдельным процессом `itinvent-chat` (`backend/chat_main.py`, порт **8002**) |
| **desktop** | Windows WPF/WebView2 shell существующего портала HUB; без отдельного backend и бизнес-логики |
| **bot** | Telegram-бот: поиск, акты, OCR, экспорты, регистрация работ |
| **agent** + **agent.py** | Windows inventory-agent (MSI, Scheduled Task) |
| **scan_agent** | Sidecar: поиск чувствительных документов на ПК |
| **scan_server** | Очередь задач, инциденты, OCR/PDF pipeline |
| **inventory_server** | Ingest/очередь inventory на отдельном порту |
| **data/** | Общие JSON-файлы (web + bot) |
| **shared/llm** | Единый OpenRouter LLM gateway (chat, mail, markdown, act parse, bot OCR) |
| **documentation/** | Пользовательские и технические гайды |
| **scripts/** | PM2, миграции, install/uninstall, утилиты |
| **tests/** | Python-тесты backend, bot, scan, inventory |

**Клиенты в репозитории:** браузерный web (адаптивный UI, PWA/web-push где включено), **Windows Desktop WPF/WebView2** (`desktop/`), **Expo Android** (`mobile-hub/`), Telegram-бот, Windows-агенты. Удалённый `mobile-android/` / Capacitor не восстанавливать.

**Стек:** Python, FastAPI, React 18 + Vite, MUI, .NET 8 WPF + WebView2, SQL Server (`pyodbc`), PostgreSQL (app/chat/scan runtime), Telegram API, PM2 (Windows-сервер), PowerShell (агенты).

Новый обязательный Redis, Docker или брокер сообщений не добавлять без отдельного архитектурного решения пользователя. Существующие опциональные Redis-контуры не удалять и не считать обязательной инфраструктурой без проверки runtime.

---

## Карта репозитория

```text
Image_scan/
├── shared/
│   └── llm/              # Единый OpenRouter gateway (все LLM-вызовы)
├── WEB-itinvent/
│   ├── backend/          # FastAPI, порт dev ~8001
│   │   ├── main.py       # Точка входа, include_router
│   │   ├── api/v1/       # REST-роутеры
│   │   ├── services/     # Бизнес-логика
│   │   ├── models/       # Pydantic
│   │   └── database/     # SQL Server connection
│   └── frontend/         # React + Vite, порт dev 5173
│       └── src/
│           ├── pages/    # Страницы (Database, ScanCenter, Mail, Chat, …)
│           ├── api/      # HTTP-клиенты (модули по доменам)
│           ├── components/
│           └── contexts/
├── bot/                  # python -m bot.main
│   ├── handlers/         # Telegram-сценарии
│   └── services/         # OCR, PDF, Excel, validation
├── agent/                # MSI, GPO, packaging, docs
├── agent.py              # Inventory-agent runtime (корень)
├── agent_installer.py    # MSI install/uninstall logic
├── scan_agent/           # scan sidecar (agent.py)
├── scan_server/          # python -m scan_server.app (:8011)
├── inventory_server/     # python -m inventory_server
├── integrations/
│   └── 1c/               # Исходники расширений/переходников 1С для HUB-IT
├── desktop/              # Windows WPF/WebView2 shell существующего web-портала
├── mobile-hub/           # Expo React Native (Android), см. mobile-hub/README.md
├── data/                 # JSON-хранилища (см. data/README.md)
├── documentation/        # user-guides + technical
├── scripts/              # pm2/, миграции, деплой
├── templates/            # DOCX-шаблоны актов
├── tests/                # pytest
└── .env.example          # Шаблон конфигурации (копировать в .env)
```

---

## Как связаны сервисы

```mermaid
flowchart LR
  subgraph clients [Клиенты]
    Web[WEB-itinvent в браузере]
    Desktop[HUB Desktop WebView2]
    Mobile[mobile-hub Expo Android]
    TG[Telegram bot]
    WinAgent[agent.py на ПК]
    ScanAgent[scan_agent]
  end

  subgraph server [Сервер]
    API[WEB-itinvent backend :8001]
    Chat[Chat API :8002 / :8004]
    Inv[inventory_server]
    Scan[scan_server :8011]
    SQL[(SQL Server ITINVENT)]
    PG[(PostgreSQL app/chat)]
    ScanDB[(PostgreSQL schema scan / SQLite dev fallback)]
    JSON[(data/*.json)]
  end

  Web --> API
  Desktop --> API
  Mobile --> API
  Web -->|chat через IIS в split-режиме| Chat
  TG --> SQL
  TG --> JSON
  API --> SQL
  API --> PG
  API --> JSON
  Chat --> PG
  WinAgent --> Inv
  WinAgent --> API
  ScanAgent --> Scan
  Scan --> ScanDB
  Web -->|/api/v1/scan/* через IIS proxy| Scan
```

**Scan Center:** frontend ходит на `/scan/*` (через тот же origin). В production IIS проксирует `/api/v1/scan/*` → `scan_server` (`127.0.0.1:8011`). Подробнее: [documentation/technical/SCAN_ARCHITECTURE.md](../../documentation/technical/SCAN_ARCHITECTURE.md).

**Chat runtime:** в обычном режиме Chat API работает на `8002`; подготовленный scale-вариант использует `8002` и `8004`, PostgreSQL realtime и отдельный IIS WebSocket upstream. Подробности — в [scripts/pm2/README.md](../../scripts/pm2/README.md) и [CHAT_BACKEND_ARCHITECTURE.md](../../documentation/technical/CHAT_BACKEND_ARCHITECTURE.md).

---

## Подсистемы (куда лезть в код)

### WEB-itinvent — backend

| Что | Где |
|-----|-----|
| Точка входа | `WEB-itinvent/backend/main.py` |
| Роутеры | `WEB-itinvent/backend/api/v1/*.py` |
| Auth deps | `WEB-itinvent/backend/api/deps.py` |
| Конфиг | `WEB-itinvent/backend/config.py`, корневой `.env` |
| SQL Server | `WEB-itinvent/backend/database/connection.py` |
| Сервисы | `WEB-itinvent/backend/services/` |

**Префиксы API** (`/api/v1/…`): `auth`, `equipment`, `database`, `json`, `settings`, `networks`, `discovery`, `inventory`, `kb`, `mfu`, `hub`, `departments`, `ad-users`, `mail`, `vcs`, `ai-bots`, `tickets`, `address-book`, `chat` (если включён).

OpenAPI в dev: `http://localhost:8001/docs`

### Chat runtime

| Что | Где |
|-----|-----|
| Entry point | `WEB-itinvent/backend/chat_main.py` |
| Chat domain | `WEB-itinvent/backend/chat/` |
| AI chat domain | `WEB-itinvent/backend/ai_chat/` |
| Single-node port | `8002` |
| Scale ports | `8002` и `8004`, только при подготовленном IIS WebSocket upstream |
| PM2 | `scripts/pm2/ecosystem.backend.config.js`, `scripts/pm2/ecosystem.chat.scale.config.js` |

### WEB-itinvent — frontend

| Что | Где |
|-----|-----|
| Роутинг | `WEB-itinvent/frontend/src/App.jsx` |
| Страницы | `WEB-itinvent/frontend/src/pages/` |
| API-модули | `WEB-itinvent/frontend/src/api/` (домены разбиты: `scanOverview.js`, `hubTasks.js`, `mail*.js`, …) |
| Совместимость | `client.js` — re-export/legacy; новый код — отдельные файлы в `api/` |
| Auth | `contexts/AuthContext.jsx` |
| Тема | `theme/index.js` |
| Платформа (только web) | `lib/platform.js` — `IS_CAPACITOR_*` / `isNativeShellRuntime()` всегда `false` |
| WebAuthn / passkey | `lib/useWebAuthnAvailability.js` — без native WebView-обёртки |

Ключевые маршруты: `/dashboard`, `/tasks`, `/tickets`, `/chat`, `/database`, `/networks`, `/scan-center`, `/mail`, `/computers`, `/settings`, …

**Удалённый клиент:** `mobile-android/` и Capacitor pipeline не восстанавливать. Native Android, Gradle и APK относятся к действующему `mobile-hub/`. Для мобильного браузера проверять общий web frontend (responsive web + PWA).

### Telegram-бот

| Что | Где |
|-----|-----|
| Entry | `bot/main.py` |
| Handlers | `bot/handlers/` (`search`, `transfer`, `work`, `export`, …) |
| Конфиг | `bot/config.py` |
| SQL | `bot/database_manager.py`, `bot/universal_database.py` |
| JSON store | `bot/local_json_store.py` → `data/` |

### HUB Desktop

| Что | Где |
|-----|-----|
| Solution | `desktop/Hub.Desktop.sln` |
| WPF shell | `desktop/Hub.Desktop/` |
| Tray / autostart / single instance | `desktop/Hub.Desktop/Autostart/`, `desktop/Hub.Desktop/Lifecycle/`, `MainWindow.xaml.cs` |
| MSI / Setup bundle | `desktop/Hub.Desktop.Installer/`, `desktop/Hub.Desktop.Setup/`, `scripts/desktop/build-installer.ps1` |
| Фирменные Windows-иконки | `desktop/Hub.Desktop/Assets/`, источник `WEB-itinvent/frontend/scripts/icon-source.png` |
| React/C# bridge | `desktop/Hub.Desktop/Interop/`, `WEB-itinvent/frontend/src/lib/desktopBridge.js`, `WEB-itinvent/frontend/src/lib/platform.js` |
| Origin/navigation policy | `desktop/Hub.Desktop/Security/NavigationPolicy.cs` |
| Тесты | `desktop/Hub.Desktop.Tests/` |
| Запуск и ограничения | `desktop/README.md` |

Desktop — тонкая оболочка web-портала: auth, REST, WebSocket и бизнес-логика остаются в существующих frontend/backend. Release разрешает только `https://hubit.zsgp.ru/`.

### Windows-агенты

| Компонент | Entry | Runtime на ПК |
|-----------|-------|----------------|
| Inventory | `agent.py` | `C:\ProgramData\HUB-IT\Agent\` |
| Scan sidecar | `scan_agent/agent.py` | `C:\ProgramData\HUB-IT\ScanAgent\` |
| MSI / GPO | `agent/`, `agent_installer.py` | см. `agent/README.md`, `agent/docs/` |

### scan_server

| Что | Где |
|-----|-----|
| API | `scan_server/app.py` |
| Worker | `scan_server/worker.py`, `worker_main.py` |
| БД | PostgreSQL schema `scan` (`SCAN_DATABASE_URL`) или SQLite `data/scan_server/scan_server.db` |
| OCR/PDF | `scan_server/ocr.py`, `pdf_spool.py` |

### inventory_server

| Что | Где |
|-----|-----|
| API | `inventory_server/app.py` |
| Worker | `inventory_server/worker.py` |

---

## Хранилища данных

| Хранилище | Назначение | Путь / переменные |
|-----------|------------|-------------------|
| **SQL Server** | Основная БД оборудования (legacy ITINVENT) | `SQL_SERVER_*`, `DB_{ID}_*` |
| **PostgreSQL** | App-owned runtime (production) | `APP_DATABASE_URL`, `CHAT_DATABASE_URL` |
| **JSON** | Перемещения, работы, кэши | `data/*.json` — [data/README.md](../../data/README.md) |
| **PostgreSQL `scan`** | Scan Center runtime | `SCAN_DATABASE_URL` (fallback SQLite `data/scan_server/scan_server.db`) |

**Важно:** `data/*.json` общие для **bot** и **web**. При записи учитывать гонки (атомарная запись, блокировки — смотреть существующие паттерны в `bot/local_json_store.py` и backend JSON API).

В production (`APP_ENV=production`) JSON runtime **не** должен silently откатываться на SQLite — нужен PostgreSQL и миграция (`scripts/migrate_json_store_sqlite_to_postgres.py`).

---

## Конфигурация

- Шаблон: [`.env.example`](../../.env.example) → скопировать в `.env` (в git не коммитить).
- Секреты: Telegram, OpenRouter, SQL, API keys агентов/scan, JWT, SMTP.
- Web backend может читать доп. настройки через `services/env_settings_service.py` и admin settings API.

**Не делать:** коммитить `.env`, реальные токены, `LLM_PROJECT_CONTEXT.md` (в `.gitignore` — только локально при необходимости).

---

## Запуск (разработка, Windows)

Из корня репозитория, после `python -m venv .venv` и `pip install -r requirements.txt -c constraints.txt`:

```powershell
# Web backend
cd WEB-itinvent\backend
python -m uvicorn main:app --reload --port 8001

# Web frontend (Node 18+)
cd WEB-itinvent\frontend
npm install
npm run dev

# Telegram bot
cd C:\Project\Image_scan
python -m bot.main

# Scan server
python -m scan_server.app

# Inventory server
python -m inventory_server

# Inventory agent (один прогон)
python agent.py --once

# Windows Desktop (WPF/WebView2)
dotnet run --project desktop\Hub.Desktop\Hub.Desktop.csproj

# Windows Desktop Setup.exe + MSI
powershell -ExecutionPolicy Bypass -File scripts\desktop\build-installer.ps1 -NoRestore

# Mobile (Expo, Android)
cd mobile-hub
npm install
npx expo start
```

**Production / сервер:** PM2 — [scripts/pm2/README.md](../../scripts/pm2/README.md). Основные контуры: `itinvent-backend` (`8001`), `itinvent-chat` (`8002`, optional scale `8004`), `itinvent-inventory`, `itinvent-scan` + worker, `itinvent-bot`; фоновые workers перечислены в PM2 runbook. Frontend на IIS, не под PM2.

Команды ниже являются справочными для разработки. Наличие команды перезапуска или deployment-скрипта не является разрешением выполнять её на production.

Для перезапуска backend использовать штатный скрипт:

```powershell
powershell -ExecutionPolicy Bypass -File scripts\pm2\restart-backend.ps1
# отдельный Chat API (порт 8002), если включён HUBIT_RUNTIME_ROLE split:
powershell -ExecutionPolicy Bypass -File scripts\pm2\restart-chat.ps1
```

Если `pm2.cmd` падает с ошибкой `node is not recognized`, запускать тот же скрипт с проектным Node в PATH:

```powershell
$env:PATH='C:\Project\Image_scan\tools\node-v24.14.0-win-x64-full;' + $env:PATH
powershell -ExecutionPolicy Bypass -File scripts\pm2\restart-backend.ps1
```

Не заменять его прямым `pm2 restart itinvent-backend`: скрипт чистит orphan `start_server.py`, освобождает порт `8001`, стартует из ecosystem-конфига и перезапускает связанные scan-процессы. Для полного контура использовать `scripts\pm2\restart-all.ps1`, для проверки — `scripts\pm2\health-check.ps1`.

---

## Тесты

```powershell
# Python (корень)
pytest -q tests

# Только bot
pytest -q -c pytest.bot.ini

# Frontend
cd WEB-itinvent\frontend
npm test
npm run build

# Windows Desktop
cd C:\Project\Image_scan
dotnet test desktop\Hub.Desktop.sln -c Release
```

Именование: `tests/test_<area>_<feature>.py`. Перед крупным рефакторингом API client — см. `WEB-itinvent/frontend/src/api/client.test.js`.

---


## Куда смотреть по типу задачи

| Задача | Первые файлы |
|--------|----------------|
| Страница / UI web | `WEB-itinvent/frontend/src/pages/`, `WEB-itinvent/frontend/src/App.jsx` |
| REST endpoint | `WEB-itinvent/backend/api/v1/`, затем `WEB-itinvent/backend/services/` |
| Права / JWT | `WEB-itinvent/backend/api/deps.py`, `WEB-itinvent/backend/services/authorization_service.py` |
| Оборудование, акты | `WEB-itinvent/backend/api/v1/equipment.py`, `WEB-itinvent/backend/api/v1/json_operations.py`, `data/equipment_transfers.json` |
| Hub / задачи | `WEB-itinvent/backend/api/v1/hub.py`, `WEB-itinvent/backend/services/hub_service.py`, `WEB-itinvent/frontend/src/api/hub*.js` |
| Почта | `WEB-itinvent/backend/api/v1/mail.py`, `WEB-itinvent/backend/services/mail_*.py` |
| Чат / AI | `shared/llm/`, `WEB-itinvent/backend/chat/`, `WEB-itinvent/backend/ai_chat/`, `WEB-itinvent/frontend/src/api/chat*.js` |
| Нативный Chat / жесты / папки | `mobile-hub/src/screens/chat/`, `mobile-hub/src/components/chat/`, [MOBILE_HUB_NATIVE_CHAT_GAP_ROADMAP.md](../../documentation/technical/MOBILE_HUB_NATIVE_CHAT_GAP_ROADMAP.md) |
| Scan Center | `WEB-itinvent/frontend/src/pages/ScanCenter.jsx`, `WEB-itinvent/frontend/src/api/scan*.js`, `scan_server/`, `documentation/technical/SCAN_ARCHITECTURE.md` |
| 1С / склад | `integrations/1c/`, `documentation/technical/ONE_C_INTEGRATION.md`, `documentation/technical/DOCFLOW_1C_INTEGRATION.md` |
| Telegram сценарий | `bot/handlers/<name>.py` |
| Агент на ПК | `agent.py`, `scan_agent/agent.py`, `agent/docs/` |
| JSON-данные | `data/`, `data/README.md` |
| Mobile / responsive web | `mobile-hub/`, `WEB-itinvent/frontend/src/`, `documentation/technical/MOBILE_HUB_CHECKLIST.md` |
| Деплой / PM2 | `scripts/pm2/` |
| Метрики и performance | `documentation/technical/REQUEST_METRICS.md`, `documentation/technical/CHAT_PERF_OBSERVABILITY.md`, `documentation/technical/HUB_CHAT_LOAD_TEST.md` |
| Безопасность auth | `documentation/technical/AUTH_SECURITY_STACK.md` |
| Пользовательская инструкция | `documentation/user-guides/` |
| Windows Desktop shell | `desktop/Hub.Desktop/`, `desktop/Hub.Desktop.Tests/`, `desktop/README.md` |
| Web на телефоне (UI, не APK) | `WEB-itinvent/frontend/src/pages/`, `WEB-itinvent/frontend/src/lib/platform.js`, Login/Settings responsive layout |
| Passkey / WebAuthn в браузере | `WEB-itinvent/frontend/src/lib/useWebAuthnAvailability.js`, `documentation/technical/AUTH_SECURITY_STACK.md` |

**Устарело (удалено из репо):** `mobile-android/` и Capacitor pipeline. Действующие Android/Gradle/APK-сборка и документация относятся к `mobile-hub/`.

---

## Связанная документация

| Документ | Содержание |
|----------|------------|
| [README.md](../../README.md) | Обзор, быстрый старт, логи |
| [WEB-itinvent/CLAUDE.md](../../WEB-itinvent/CLAUDE.md) | Web: архитектура, data JSON, design system |
| [WEB-itinvent/README.md](../../WEB-itinvent/README.md) | Кратко про web |
| [desktop/README.md](../../desktop/README.md) | Windows Desktop shell: scope, сборка, безопасность и локальные данные |
| [documentation/README.md](../../documentation/README.md) | Оглавление документации |
| [documentation/technical/README.md](../../documentation/technical/README.md) | Индекс технической документации |
| [documentation/technical/SCAN_ARCHITECTURE.md](../../documentation/technical/SCAN_ARCHITECTURE.md) | Scan pipeline |
| [documentation/technical/SCAN_POSTGRES_MIGRATION.md](../../documentation/technical/SCAN_POSTGRES_MIGRATION.md) | Scan PostgreSQL cutover и rollback |
| [documentation/technical/AUTH_SECURITY_STACK.md](../../documentation/technical/AUTH_SECURITY_STACK.md) | Auth / 2FA / passkeys |
| [documentation/technical/CHAT_BACKEND_ARCHITECTURE.md](../../documentation/technical/CHAT_BACKEND_ARCHITECTURE.md) | Chat backend и realtime |
| [documentation/technical/MOBILE_HUB_NATIVE_CHAT_GAP_ROADMAP.md](../../documentation/technical/MOBILE_HUB_NATIVE_CHAT_GAP_ROADMAP.md) | Native Chat: разрыв с web, жесты, папки, viewer |
| [documentation/technical/CHAT_PERF_OBSERVABILITY.md](../../documentation/technical/CHAT_PERF_OBSERVABILITY.md) | Chat метрики и performance |
| [documentation/technical/IIS_DEPLOYMENT_WEB.md](../../documentation/technical/IIS_DEPLOYMENT_WEB.md) | IIS reverse proxy и frontend deployment |
| [documentation/technical/MOBILE_HUB_CHECKLIST.md](../../documentation/technical/MOBILE_HUB_CHECKLIST.md) | Mobile-hub checklist |
| [documentation/technical/ONE_C_INTEGRATION.md](../../documentation/technical/ONE_C_INTEGRATION.md) | 1С integration |
| [agent/README.md](../../agent/README.md) | MSI, install, troubleshooting |
| [bot/README.md](../../bot/README.md) | Telegram-бот |
| [scan_server/README.md](../../scan_server/README.md) | Scan API |
| [data/README.md](../../data/README.md) | Схемы JSON-файлов |
| [TECH_DEBT_AUDIT.md](../../TECH_DEBT_AUDIT.md) | Backlog рефакторинга |
| [docs/adr/0001-remove-unfound-equipment.md](../../docs/adr/0001-remove-unfound-equipment.md) | Снятие контура unfound |
