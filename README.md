# HUB-IT

Единый монорепозиторий для внутренней платформы учёта и обслуживания IT-инфраструктуры.

Проект объединяет несколько подсистем:

- web-приложение для операторов и администраторов;
- Telegram-бот для оперативной работы с оборудованием;
- Windows-агент инвентаризации;
- scan-agent и scan-server для поиска чувствительных документов на рабочих станциях;
- вспомогательные скрипты развёртывания, PM2, отчёты и пользовательскую документацию.

## Что входит в проект

### 1. Web-приложение

Каталог: [WEB-itinvent](./WEB-itinvent)

- backend на FastAPI;
- frontend на React + Vite;
- JWT-аутентификация и роли;
- страницы оборудования, сетей, базы, статистики, центра управления, `Scan Center`;
- интеграция с SQL Server, локальным кэшем и сервисами мониторинга.

### 2. Telegram-бот

Каталог: [bot](./bot)

- поиск оборудования по сотруднику и серийному номеру;
- OCR и распознавание серийных номеров;
- формирование актов, экспортов и служебных отчётов;
- работа с несколькими БД и справочниками.

### 3. Windows-агенты

Основной runtime:

- [agent.py](./agent.py)
- [scan_agent/agent.py](./scan_agent/agent.py)

Возможности:

- сбор инвентаризации по ПК: hostname, user, serial, CPU, RAM, диски, мониторы, OS, сеть, security, updates, Outlook;
- отправка inventory и heartbeat на backend;
- sidecar-сканирование документов на `Desktop`, `Documents`, `Downloads`;
- MSI-установка, автозапуск через `Scheduled Task`, uninstall и runtime в `C:\ProgramData\IT-Invent\Agent`.

### 4. Scan server

Каталог: [scan_server](./scan_server)

- принимает `heartbeat`, `tasks/poll`, `task_result`, `ingest`;
- хранит агентов, задачи и инциденты;
- обрабатывает PDF/text/OCR pipeline;
- обслуживает `Scan Center` во web-интерфейсе.

### 5. Документация и эксплуатация

Каталоги:

- [documentation](./documentation)
- [agent/docs](./agent/docs)
- [scripts](./scripts)

Там лежат:

- пользовательские инструкции;
- технические заметки и troubleshooting;
- PM2-скрипты;
- deployment и GPO/MSI-инструкции по агентам.

## Стек

- Python
- FastAPI
- React 18 + Vite
- Material UI
- SQL Server + `pyodbc`
- Telegram Bot API
- OpenRouter / OCR-модели
- PM2 для orchestration сервисов на сервере
- Windows PowerShell для установки и обслуживания агентов

## Основная структура репозитория

```text
Image_scan/
├── WEB-itinvent/          # Web backend + frontend
├── bot/                   # Telegram-бот
├── agent/                 # MSI, docs и packaging агента
├── inventory_server/      # Очередь и ingest-сервис inventory на отдельном порту
├── scan_agent/            # Scan sidecar
├── scan_server/           # Сервер задач и инцидентов scan
├── documentation/         # Общая документация проекта
├── scripts/               # PM2, install/uninstall и сервисные скрипты
├── templates/             # Шаблоны документов
├── tests/                 # Автотесты
├── agent.py               # Основной inventory-agent runtime
├── agent_installer.py     # MSI install/uninstall helper logic
└── .env.example           # Шаблон конфигурации
```

## Быстрый старт для разработки

### 1. Подготовить окружение

```powershell
cd C:\Project\Image_scan
python -m venv .venv
.venv\Scripts\activate
pip install -r requirements.txt
```

Для web-frontend отдельно нужен Node.js 18+.

### 2. Подготовить `.env`

```powershell
Copy-Item .env.example .env
```

В `.env` обычно настраиваются:

- Telegram и OpenRouter;
- SQL Server;
- web-backend;
- scan-server;
- inventory-agent / scan-agent;
- mail и MFU-мониторинг.

Важно:

- `.env` не хранится в git;
- для production нельзя оставлять demo/default secrets.

### 3. Запуск по подсистемам

Web backend:

```powershell
cd C:\Project\Image_scan\WEB-itinvent\backend
python -m uvicorn main:app --reload --port 8001
```

Web frontend:

```powershell
cd C:\Project\Image_scan\WEB-itinvent\frontend
npm install
npm run dev
```

Telegram-бот:

```powershell
cd C:\Project\Image_scan
python -m bot.main
```

Scan server:

```powershell
cd C:\Project\Image_scan
python -m scan_server.app
```

Inventory ingest server:

```powershell
cd C:\Project\Image_scan
python -m inventory_server
```

Локальный запуск inventory-agent:

```powershell
cd C:\Project\Image_scan
python agent.py --once
```

## PM2 / серверный старт

Для Windows-сервера у тебя уже есть готовые скрипты в [scripts/pm2](./scripts/pm2).

Основные:

- [start-all.ps1](./scripts/pm2/start-all.ps1)
- [restart-all.ps1](./scripts/pm2/restart-all.ps1)
- [stop-all.ps1](./scripts/pm2/stop-all.ps1)

По текущей конфигурации под PM2 обычно живут:

- `itinvent-backend`
- `itinvent-inventory`
- `itinvent-scan`
- `itinvent-bot`

## Агенты и MSI

Точка входа по агенту:

- [agent/README.md](./agent/README.md)

Там подробно описаны:

- сборка MSI;
- silent install/uninstall;
- runtime в `C:\ProgramData\IT-Invent\Agent`;
- `Scheduled Task` автозапуск;
- логи, uninstall, troubleshooting.

Отдельные технические отчёты по агентам:

- [AGENT_SYSTEM_COLLECTION_REPORT.md](./agent/docs/AGENT_SYSTEM_COLLECTION_REPORT.md)
- [AGENT_SCAN_INSTALL_REPORT.md](./agent/docs/AGENT_SCAN_INSTALL_REPORT.md)

## Документация

Общая документация:

- [documentation/README.md](./documentation/README.md)

Полезные разделы:

- [documentation/user-guides](./documentation/user-guides)
- [documentation/technical](./documentation/technical)
- [agent/docs](./agent/docs)

## Тесты

Базовые команды:

```powershell
cd C:\Project\Image_scan
pytest -q -o addopts="" --basetemp=.pytest-tmp tests
```

Отдельно frontend:

```powershell
cd C:\Project\Image_scan\WEB-itinvent\frontend
npm test
npm run build
```

## Где смотреть логи

Основной Windows-agent:

- `C:\ProgramData\IT-Invent\Agent\Logs\itinvent_agent.log`

Scan-agent:

- `C:\ProgramData\IT-Invent\ScanAgent\scan_agent.log`

MSI helper:

- `C:\Windows\Temp\itinvent_agent_msi_helper.log`

PM2 и runtime серверных процессов:

- через PM2 и логи запущенных сервисов `itinvent-backend`, `itinvent-inventory`, `itinvent-scan`, `itinvent-bot`

## Для чего этот README

Этот файл описывает проект целиком на уровне репозитория.

За деталями по отдельным подсистемам смотри:

- web: [WEB-itinvent/README.md](./WEB-itinvent/README.md)
- agent: [agent/README.md](./agent/README.md)
- общая документация: [documentation/README.md](./documentation/README.md)
