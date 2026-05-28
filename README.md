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
python -m pip install -r requirements.txt -c constraints.txt
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

### 3. Запуск по подсистемам (только разработка на своей машине)

> **На сервере приложений (`TMN-SRV-APP-*` и аналоги) backend поднимается только через PM2.**  
> Не запускайте вручную `uvicorn` / `start_server.py` на порту **8001**, если уже работает `itinvent-backend` в PM2 — иначе порт занят и PM2 уходит в бесконечные перезапуски (см. раздел [Порт 8001 и PM2](#порт-8001-и-pm2-типичная-ошибка) ниже).

Web backend (локальная отладка, **без PM2** на этом же порту):

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

## Запуск на сервере (production)

**Один способ для API backend на `127.0.0.1:8001` — PM2.** IIS проксирует `/api/*` на этот порт.

### Что поднимать

| Процесс PM2 | Назначение | Порт / примечание |
|-------------|------------|-------------------|
| `itinvent-backend` | Web API (FastAPI) | **8001** (`127.0.0.1`) |
| `itinvent-chat-push-worker` | Web Push для чата | без HTTP-порта |
| `itinvent-ai-chat-worker` | AI-ответы в чате | без HTTP-порта |
| `itinvent-inventory` | Ingest inventory с агентов | см. `inventory_server` |
| `itinvent-scan` | Scan API | **8011** (типично) |
| `itinvent-scan-worker` | OCR/PDF worker scan | — |
| `itinvent-bot` | Telegram-бот | — |

Frontend (React) — **IIS**, не PM2.

### Команды (из корня репозитория)

Первый старт или после смены конфигурации:

```powershell
cd C:\Project\Image_scan
powershell -File scripts\pm2\start-all.ps1
```

Перезапуск всего пакета:

```powershell
powershell -File scripts\pm2\restart-all.ps1
```

Остановка:

```powershell
powershell -File scripts\pm2\stop-all.ps1
```

Только backend:

```powershell
pm2 restart itinvent-backend
pm2 logs itinvent-backend --lines 50
```

Проверка здоровья:

```powershell
powershell -File scripts\pm2\health-check.ps1
pm2 list
```

Подробный runbook: [scripts/pm2/README.md](./scripts/pm2/README.md).

### Правила (чтобы не ловить конфликт порта)

1. **На сервере не запускать** `python start_server.py`, `uvicorn … --port 8001` и не держать второй PM2-профиль `itinvent-backend-a/b`, если не настроен scale-out.
2. **Перед ручной отладкой backend** на этой же машине: `pm2 stop itinvent-backend`, после отладки — снова `pm2 start itinvent-backend`.
3. **Не дублировать** службу NSSM/IIS `itinvent-backend` ([install_backend_service.ps1](./scripts/iis/install_backend_service.ps1)) и PM2 на одном порту **8001**.
4. В `pm2 list` у `itinvent-backend` нормальный признак — **uptime минуты/дни**, счётчик `↺` почти не растёт. Если `↺` тысячи и uptime секунды — см. раздел ниже.

---

## Порт 8001 и PM2: типичная ошибка

**Симптом:** в PM2 `itinvent-backend` — `online`, но `↺` (restarts) тысячи, uptime 1–10 с; в логе:

```text
ERROR: [Errno 10048] error while attempting to bind on address ('127.0.0.1', 8001)
```

**Причина:** порт **8001** уже занят другим `python.exe start_server.py` (старый процесс после сбоя PM2 или ручной запуск). PM2 поднимает новый экземпляр → не может забиндить порт → падает → снова стартует.

**Авто-защита:** при каждом старте `WEB-itinvent/start_server.py` на Windows освобождает «чужой» listener на порту backend перед запуском uvicorn. PM2 также настроен с `kill_timeout` / увеличенным `restart_delay`.

### Восстановление (одна команда)

```powershell
cd C:\Project\Image_scan
powershell -File scripts\pm2\restart-backend.ps1
```

Скрипт сам: останавливает PM2-процесс, убивает зависший listener на **8001**, поднимает backend и проверяет лог.

### Восстановление вручную

```powershell
# 1. Остановить цикл перезапусков PM2
pm2 stop itinvent-backend

# 2. Найти, кто держит 8001 (последний столбец — PID)
netstat -ano | findstr ":8001.*LISTENING"

# 3. Завершить зависший python (подставьте PID из netstat, не PID PM2)
taskkill /PID <PID> /F

# 4. Убедиться, что порт свободен (пустой вывод — хорошо)
netstat -ano | findstr ":8001.*LISTENING"

# 5. Запустить backend снова
pm2 start itinvent-backend

# 6. Проверка: в логе должно быть "Uvicorn running on http://127.0.0.1:8001"
pm2 logs itinvent-backend --lines 20 --nostream
pm2 list
```

После стабилизации (по желанию) сбросить счётчик рестартов: `pm2 reset itinvent-backend`.

Логи PM2: `%USERPROFILE%\.pm2\logs\itinvent-backend-error.log`.

---

## PM2 / серверный старт (кратко)

Скрипты: [scripts/pm2](./scripts/pm2) — `start-all.ps1`, `restart-all.ps1`, `stop-all.ps1`.

Процессы PM2 на типичном app-сервере:

- `itinvent-backend` — **только один** listener на **8001**
- `itinvent-chat-push-worker`, `itinvent-ai-chat-worker`
- `itinvent-inventory`, `itinvent-scan`, `itinvent-scan-worker`, `itinvent-bot`

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
pytest -q tests
```

Проверка текущего baseline-покрытия Telegram bot отдельно:

```powershell
pytest -q -c pytest.bot.ini
```

Python dependency audit:

```powershell
python -m pip install pip-audit
powershell -File scripts\check-python-deps.ps1 -Audit

# optional: checks this interpreter's full installed environment
powershell -File scripts\check-python-deps.ps1 -Environment
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
