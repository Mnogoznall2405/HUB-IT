# 📊 Image_scan — Полный архитектурный анализ и аудит проблем

**Дата анализа:** 2026-05-06  
**Репозиторий:** C:\Project\Image_scan  
**Платформа:** Python (FastAPI) + React (Vite) + SQLite/PostgreSQL  
**Код изменён:** Нет (только анализ и запись в файл)

---

## Содержание

1. [Архитектурная модель](#1-архитектурная-модель)
2. [Полная структура проекта](#2-полная-структура-проекта)
3. [Критические проблемы (Топ-5)](#3-критические-проблемы-топ-5)
4. [Аудит проблем по категориям](#4-аудит-проблем-по-категориям)
   - 4.1 [Architectural Decay](#41-architectural-decay)
   - 4.2 [God Files & Functions](#42-god-files--functions)
   - 4.3 [Consistency Rot](#43-consistency-rot)
   - 4.4 [Type & Contract Debt](#44-type--contract-debt)
   - 4.5 [Test Debt](#45-test-debt)
   - 4.6 [Dependency & Config Debt](#46-dependency--config-debt)
   - 4.7 [Performance & Resource Hygiene](#47-performance--resource-hygiene)
   - 4.8 [Error Handling & Observability](#48-error-handling--observability)
   - 4.9 [Security Hygiene](#49-security-hygiene)
   - 4.10 [Documentation Drift](#410-documentation-drift)
5. [Frontend-специфичные проблемы](#5-frontend-специфичные-проблемы)
6. [Сводная таблица находок](#6-сводная-таблица-находок)
7. [Open Questions](#7-open-questions)
8. [Things that look bad but are actually fine](#8-things-that-look-bad-but-are-actually-fine)

---

## 1. Архитектурная модель

Проект представляет собой **IT-инвентаризационную платформу HUB-IT** с следующей архитектурой:

### Backend (FastAPI)
- **FastAPI** с Dependency Injection (`api/deps.py`)
- **Layered architecture**: API → Services → Database
- **Множественные СУБД**: SQLAlchemy (PostgreSQL), raw sqlite3, pyodbc (SQL Server) — одновременно
- **Alembic** миграции для PostgreSQL (30+ миграций)
- **Сервисы** реализованы как Python-классы с собственной логикой схем (inline `_ensure_schema`)

### Frontend (React + Vite)
- **React 18+** с хуками, без TypeScript
- **Feature-based** организация компонентов
- **Custom hooks** для бизнес-логики (~50+ hooks)
- **Context API** для глобального состояния (Auth, Notifications, Preferences)
- **SWR-кэширование** через собственную обёртку (`swrCache.js`)
- **Material-UI v5** + Tailwind CSS v4
- **PWA** (Service Worker, Web App Manifest)

### AI-модуль
- **OpenRouter** клиент для LLM
- **RAG Retrieval** для базы знаний
- **Tool Registry** с инструментами для IT Invent, Office, Files

### Сканирование сети
- **scan_agent** — агент сбора данных
- **scan_server** — сервер обработки

---

## 2. Полная структура проекта

> 📄 **Подробная структура сохранена в файле `PROJECT_STRUCTURE.md`**

### Ключевая статистика

| Показатель | Backend | Frontend | Всего |
|---|---|---|---|
| **Python файлов** | ~120 | — | ~120 |
| **React/JSX файлов** | — | ~300 | ~300 |
| **Тестовых файлов** | — | ~120 | ~120 |
| **Alembic миграций** | 30+ | — | 30+ |
| **API endpoints** | 20+ маршрутов | — | 20+ |
| **Сервисов** | 40+ | — | 40+ |
| **Компонентов** | — | 150+ | 150+ |

### Самые большие файлы (God Files)

**Backend:**
| Файл | Строк | Churn (6м) |
|---|---|---|
| `backend/chat/service.py` | 5,488 | 5 |
| `backend/services/mail_service.py` | 4,522 | 5 |
| `backend/services/network_service.py` | 4,352 | 5 |
| `backend/services/hub_service.py` | 4,155 | 4 |
| `backend/database/queries.py` | 2,857 | 6 |
| `backend/services/mfu_monitor_service.py` | 2,851 | 4 |
| `backend/ai_chat/service.py` | 2,592 | — |

**Frontend:**
| Файл | Строк | Churn (6м) |
|---|---|---|
| `frontend/src/api/client.test.js` | 6,104 | 9 |
| `frontend/src/pages/Settings.jsx` | 5,555 | 6 |
| `frontend/src/pages/Chat.jsx` | 5,455 | — |
| `frontend/src/pages/Tasks.jsx` | 5,332 | — |
| `frontend/src/pages/Mail.jsx` | 3,291 | 5 |
| `frontend/src/pages/Dashboard.jsx` | 3,108 | — |

---

## 3. Критические проблемы (Топ-5)

### 🔴 C001: 18 захардкоженных секретов в `.env`
- **Где:** `C:\Project\Image_scan\.env` (строки 1, 2, 17, 27, 34, 41, 93, 94, 100, 101, 121, 164, 180, 189, 190, 200, 208, 219)
- **Что:** Токены Telegram, API-ключи OpenRouter, пароли SQL Server, JWT-секреты, API-ключи агентов, приватный ключ WebPush
- **Риск:** Утечка репозитория = компрометация всей инфраструктуры
- **Рекомендация:** Перенести секреты в менеджер секретов (Vault, AWS Secrets Manager) или `.env.local` в `.gitignore`

### 🔴 C002: God-классы по 4000+ строк
- **Где:** `backend/chat/service.py:336`, `backend/services/mail_service.py:293`, `backend/services/network_service.py:497`, `backend/services/hub_service.py:208`
- **Что:** Каждый сервис содержит 10+ различных ответственностей (мессенджинг, загрузка файлов, кэширование, уведомления, Exchange-транспорт, Excel-импорт, геометрия карт и т.д.)
- **Риск:** Невозможно тестировать изолированно; изменение одной фичи ломает 10 других; onboarding нового разработчика занимает недели
- **Рекомендация:** Разделить по Domain-Driven Design: `ChatMessageService`, `ChatUploadService`, `ChatNotificationService`, `MailTransportService`, `MailMailboxService`, `NetworkBranchService`, `NetworkDeviceService`

### 🔴 C003: God-страницы на фронтенде по 5000+ строк
- **Где:** `frontend/src/pages/Settings.jsx:1` (5555), `Chat.jsx:1` (5455), `Tasks.jsx:1` (5332)
- **Что:** UI + бизнес-логика + API-вызовы + state management в одном файле
- **Риск:** Перерисовка всей страницы при изменении одного поля; невозможно переиспользовать логику; дублирование state между страницами
- **Рекомендация:** Вынести бизнес-логику в custom hooks (`useSettingsProfile`, `useChatMessages`, `useTaskBoard`), UI — в компоненты, а страницы — только как композиция

### 🔴 C004: Отсутствие единого слоя доступа к данным
- **Где:** Весь backend
- **Что:** Одновременно используются SQLAlchemy ORM (`chat/service.py`), raw sqlite3 (`mail_service.py`, `hub_service.py`), pyodbc (`database/queries.py`), и inline DDL в `_ensure_schema`
- **Риск:** SQL-инъекции (динамические f-string в `queries.py:1161`), невозможно поменять СУБД, дублирование миграций
- **Рекомендация:** Создать единый `Repository` слой с parameterized queries

### ✅ C005: `queries.py` и `queries_new.py` — дублирование (УСТРАНЕНО)
- **Где:** `backend/database/queries.py` и `backend/database/queries_new.py`
- **Было:** Две параллельные библиотеки SQL-запросов
- **Решение:** SQL-константы из `queries_new.py` перенесены в `equipment_db.py`, файл `queries_new.py` удалён
- **Статус:** ✅ Исправлено 2026-05-06

---

## 4. Аудит проблем по категориям

### 4.1 Architectural Decay

#### Циркулярные зависимости
- **Модуль `chat/` зависит от `services/` и наоборот:** `chat/service.py` импортирует `user_service`, `app_push_service`; `services/mail_service.py` импортирует `chat` модели для уведомлений
- **API слой знает слишком много:** `api/v1/chat.py` содержит WebSocket логику публикации (`_publish_message_created`), которую должен содержать `chat/realtime.py`

#### Нарушение слоёв
- `api/v1/chat.py` вызывает `chat_service.get_messages()` и тут же делает WS broadcast — API слой смешивает HTTP и WebSocket ответственности
- `database/queries.py:407` — `create_uploaded_transfer_act` содержит бизнес-правила (аннулирование актов), SQL-таблицы (`DOCS`, `DOCS_LIST`, `FILES`), и манипуляции с `ITEMS.DESCR`

#### Мёртвый код
- `backend/database/queries_new.py` — ✅ УДАЛЁН, SQL-константы перенесены в `equipment_db.py`
- `frontend/src/pages/Database.jsx.backup` и `Database.jsx.bak` — бэкап-файлы в репозитории

#### Абстракции, которые никто не использует
- `backend/appdb/sql_compat.py` — compatibility layer, но `database/queries.py` использует pyodbc напрямую

---

### 4.2 God Files & Functions

#### Backend God Classes (>500 LOC)

| ID | Файл | Класс | Строк | Проблема |
|---|---|---|---|---|
| F001 | `backend/chat/service.py:336` | `ChatService` | ~5,150 | Месседжинг, загрузки, файлы, кэш, presence, уведомления, task sharing |
| F002 | `backend/services/mail_service.py:293` | `MailService` | ~4,229 | Exchange EWS, mailbox CRUD, папки, сообщения, drafts, conversations, templates |
| F003 | `backend/services/network_service.py:497` | `NetworkService` | ~3,855 | Филиалы, устройства, порты, Excel-импорт, карты, MAC-резолвинг, audit |
| F004 | `backend/services/hub_service.py:208` | `HubService` | ~3,947 | Announcements, tasks, projects, objects, comments, attachments, push |

#### Backend God Functions (>100 LOC)

| ID | Файл | Функция | Строк | Проблема |
|---|---|---|---|---|
| F005 | `backend/database/queries.py:407` | `create_uploaded_transfer_act` | ~485 | SQL + бизнес-логика + файлы + оборудование в одной функции |
| F006 | `backend/database/queries.py:1063` | `get_equipment_act_file` | ~450+ | Multi-pass table probing, base64 decoding, scoring logic |
| F007 | `backend/services/network_service.py:596` | `_ensure_schema` | ~215 | Inline SQLite DDL для 10 таблиц |
| F008 | `backend/services/mail_service.py:900` | `_ensure_schema` | ~117 | Inline SQLite DDL для 7 таблиц |
| F009 | `backend/services/hub_service.py:834` | `_ensure_schema` | ~145 | Inline SQLite DDL для 10+ таблиц |
| F010 | `backend/services/network_service.py:1837` | `sync_socket_host_context` | ~200 | MAC resolution, DB loading, IP/FIO aggregation |
| F011 | `backend/chat/service.py:1742` | `get_messages` | ~185 | Cache lookup, pagination, query building, serialization |
| F012 | `backend/chat/service.py:2064` | `search_messages` | ~155 | Chunked DB scanning, attachment preload, text matching |

#### Frontend God Components (>500 LOC)

| ID | Файл | Компонент | Строк | Проблема |
|---|---|---|---|---|
| F013 | `frontend/src/pages/Settings.jsx:1` | `Settings` | 5,555 | 8+ вкладок, 20+ helper функций, прямые API-вызовы |
| F014 | `frontend/src/pages/Chat.jsx:1` | `Chat` | 5,455 | 30+ refs, 40+ state переменных, inline deduplication |
| F015 | `frontend/src/pages/Tasks.jsx:1` | `Tasks` | 5,332 | Kanban, analytics, CRUD, taxonomy, responsive logic |
| F016 | `frontend/src/pages/Mail.jsx:374` | `Mail` | 3,291 | Folder management, message list, reading pane, compose |
| F017 | `frontend/src/pages/Dashboard.jsx:1` | `Dashboard` | 3,108 | Announcements, tasks, navigation, mobile gestures |

---

### 4.3 Consistency Rot

#### Множественные способы делать одно и то же

**HTTP-клиенты:**
- `frontend/src/api/client.js` — Axios wrapper
- `frontend/src/api/json_client.js` — JSON-specific client
- Некоторые компоненты делают `fetch` напрямую

**Управление состоянием:**
- `useState` в каждой странице (дублирование)
- Context API (3 контекста)
- SWR кэш (`swrCache.js`)
- Локальное хранилище (`localStorage` для настроек)

**Обработка ошибок:**
- `api/v1/chat.py` — `except Exception as exc: _raise_chat_http_error(exc)` (все ошибки → HTTP 400)
- `services/mail_service.py` — `except Exception: pass` (молчаливое проглатывание)
- `chat/service.py` — `except Exception: users_by_id = {}` (молчаливый fallback)

**Timestamp helpers:**
- `_utc_now_iso` / `_now` — переопределены в `mail_service.py:164`, `hub_service.py:42`, `network_service.py:34`

**Нормализация текста:**
- `_normalize_text` — идентичный helper в 5+ файлах

**SQL-конструкция:**
- `database/queries.py:1161` — dynamic f-string SQL с `_quote_sqlserver_identifier()`
- Остальные файлы — static query strings
- Нет единого query builder

#### Дублированная логика

- **`_publish_message_created` / `_publish_message_deleted` / `_publish_message_read`** (`api/v1/chat.py:343`, `:482`, `:558`) — ~60 строк copy-paste WebSocket broadcast логики каждая
- **`QUERY_GET_EQUIPMENT_GROUPED`** vs **`QUERY_GET_EQUIPMENT_GROUPED_ALL`** — 40-строчные SELECT блоки отличаются только `OFFSET/FETCH` (перенесены в `equipment_db.py`)

---

### 4.4 Type & Contract Debt

#### Python
- **Отсутствие type hints** в большинстве legacy-файлов (`database/queries.py`, `json_db/*.py`)
- `# type: ignore` — не найдено (хорошо)
- **Loose dicts:** множество функций возвращают `dict` вместо `TypedDict` или Pydantic models

#### JavaScript
- **Нет TypeScript** во всём проекте
- **`as any` / `@ts-ignore`** — не найдено (потому что нет TS)
- **PropTypes** — не используются
- **Контракты API** — неявные, зависят от реализации `client.js`

#### API Boundaries
- `api/v1/chat.py` — сложные endpoint'ы с 10+ query parameters без валидации
- `api/v1/equipment.py` — 1903 строки, многие параметры не валидируются через Pydantic

---

### 4.5 Test Debt

#### Размер тестов

| Тест | Строк | Тестируемый код | Соотношение |
|---|---|---|---|
| `api/client.test.js` | 6,104 | `api/client.js` (1,319) | **4.6×** |
| `pages/Mail.test.jsx` | 3,498 | `pages/Mail.jsx` (3,291) | 1.06× |
| `pages/Chat.test.jsx` | — | `pages/Chat.jsx` (5,455) | низкое |

#### Проблемы с тестами

- **`client.test.js`** — тестирует ре-экспорты из sub-модулей (facade compatibility tests), а не бизнес-логику. Монолитный файл на 6000+ строк тестирует 20+ доменов
- **Excessive mocking** — `vi.mock('axios')` + `vi.spyOn` для проверки URL. Тесты хрупкие к изменению URL
- **Нет unit-тестов для God-сервисов** — `chat/service.py` (5488 строк) не имеет dedicated test-файла
- **Отсутствие интеграционных тестов** — только facade tests на фронтенде

#### Покрытие
- `backend/` — не удалось определить coverage без запуска pytest
- `frontend/` — есть `coverage`, но конкретные цифры неизвестны

---

### 4.6 Dependency & Config Debt

#### Python зависимости

**Дублирование между requirements.txt:**
- `openai`, `python-dotenv`, `openpyxl`, `pyodbc`, `python-docx`, `docx2pdf`, `Pillow` — встречаются в 2-3 файлах с разными version constraints
- `fastapi` + `uvicorn` — дублируются в backend и scan_server
- `PyMuPDF` — дублируется в backend, scan_server, scan_agent

**Отсутствие pinning:**
- Большинство backend-зависимостей **не имеют версий** (`fastapi`, `uvicorn`, `pyodbc` и т.д.)
- `constraints.txt` указан в `requirements.txt` но **файл не существует**

#### Frontend зависимости
- `quill` pinned to exact `2.0.2` — inconsistent
- `framer-motion@^12.38.0` — подозрительно высокий major (проверить валидность)
- `follow-redirects@^1.16.0` в `overrides` — возможно, фикс уязвимости
- **Tailwind v4** (`^4.2.2`) — очень новый, риск стабильности
- **Нет ESLint/Prettier** — отсутствие lint toolchain

#### Конфигурация
- `vite.config.js:11` — `loadEnv(mode, envDir, '')` загружает **все** env vars без фильтра `VITE_`, что может привести к утечке секретов в билд
- `.env.legacy` файлы в `backend/` и `backend/api/` — потенциальная путаница
- `postcss` + `autoprefixer` установлены, но `postcss.config.js` не найден

#### Env-переменные
- **30+ переменных** присутствуют в `.env` но **отсутствуют** в `.env.example`:
  - `SQL_SERVER_TRUSTED_CONNECTION`
  - `DATABASE_TYPE`
  - `ADMIN_USER_IDS`
  - `SMTP_USERNAME`, `SMTP_FROM_EMAIL`
  - `ACT_PARSE_MODEL`
  - `CHAT_MODULE_ENABLED`, `VITE_CHAT_ENABLED`
  - `CHAT_CACHE_TTL_SEC`, `CHAT_DB_POOL_SIZE`
  - Большинство `MFU_*` переменных
  - `SCAN_SERVER_AGENT_ONLINE_TIMEOUT_SEC`
  - `MAIL_NOTIFICATION_POLL_INTERVAL_SEC`
  - `VITE_MAIL_MODULE_ENABLED`

---

### 4.7 Performance & Resource Hygiene

#### N+1 Queries
- `chat/service.py:1742` — `get_messages` может делать N+1 для attachments и reply previews
- `services/mail_service.py` — `get_conversation_messages` скорее всего делает N+1 для каждого сообщения

#### Синхронная работа в async путях
- `database/queries.py` — использует pyodbc (синхронный) внутри FastAPI endpoints (async)
- `services/mail_service.py` — Exchange EWS операции могут быть синхронными блокировками

#### Кэширование
- Каждый сервис реализует **собственное кэширование**:
  - `chat/service.py` — custom `dict` + `RLock` + TTL
  - `mail_service.py` — `MailRuntimeCache` с `RuntimeCachePolicy`
  - Нет shared caching abstraction (Redis используется только для rate limiting)

#### Неочищенные слушатели
- `frontend/src/lib/chatSocket.js` — WebSocket соединения могут не закрываться при размонтировании
- `frontend/src/components/chat/useChatSocketEvents.js` — event listeners добавляются/удаляются неконсистентно

---

### 4.8 Error Handling & Observability

#### Проглатывание исключений

| Файл | Строка | Проблема |
|---|---|---|
| `api/v1/chat.py` | 745, 767, 791, 823, 864, 891, 919, 944, 970, 997, 1022, 1046, 1071, 1120, 1155, 1180, 1392, 1430, 1455, 1525 | `except Exception as exc: _raise_chat_http_error(exc)` — все ошибки (включая programming errors) оборачиваются в HTTP 400/403/404 |
| `services/mail_service.py` | 1366 | `except Exception: pass` — unread count fails silently |
| `chat/service.py` | 1244 | `except Exception: users_by_id = {}` — mention resolution fails silently |
| `database/queries.py` | 1114 | `except Exception: pass` — DOC_NUMBER resolution fails silently |
| `services/hub_service.py` | 1650 | `except Exception: pass` — push delivery failures swallowed |
| `services/network_service.py` | 1901 | `except Exception: payload = None` — MAC resolution invisible |

#### Неструктурированные логи
- Нет единого формата логирования
- `bot.log` в корне — монолитный лог-файл без rotation policy (есть bot.log.1-.5)
- Отсутствие correlation ID для tracing запросов через слои

---

### 4.9 Security Hygiene

#### 🔴 Hardcoded Secrets
- **18 секретов** в `C:\Project\Image_scan\.env` (см. Топ-5 C001)
- `JWT_SECRET_KEY` в `WEB-itinvent/_manual_env_tests/.env2` = `example-dev-secret` (слабое значение)

#### SQL-инъекции
- `database/queries.py:1161` — dynamic f-string SQL: `f"SELECT {_quote_sqlserver_identifier(column)} FROM ..."`
- `_quote_sqlserver_identifier` не является надёжной защитой от SQL-инъекций
- `database/queries.py:407` — `create_uploaded_transfer_act` использует string concatenation для SQL

#### Пермиссивная авторизация
- `api/v1/chat.py` — многие endpoints проверяют только `current_user` но не проверяют membership в conversation
- `api/v1/equipment.py` — 1903 строки, сложно проверить все пути авторизации

#### CORS
- Не удалось определить CORS policy без чтения `main.py`

---

### 4.10 Documentation Drift

#### README
- `README.md` был переписан (`5ef1ff2 Rewrite root README for full HUB-IT project overview`)
- `WEB-itinvent/README.md` — отдельный README для frontend/backend

#### Комментарии
- `database/queries.py` — legacy комментарии на русском языке, часть устарела
- `frontend/src/pages/Database.jsx.backup` — backup файл с устаревшим кодом

#### API документация
- FastAPI auto-docs доступны, но не проверены
- Нет документации по WebSocket events

---

## 5. Frontend-специфичные проблемы

### Props Drilling
- `Settings.jsx:932` — `SecurityTab` получает 10+ props
- `Tasks.jsx:2014` — `TaskPrimaryActions` drilled с 10+ boolean/action props
- `Tasks.jsx:2116` — `TaskActivityTabs` drilled с 15+ props

### Дублирование state
- Task state: `Tasks.jsx:377` + `Dashboard.jsx:308` — две отдельные копии
- Mailbox state: `Settings.jsx:608` + `Mail.jsx:374` — две отдельные копии
- Announcement state: `Dashboard.jsx:308` + `Settings.jsx:1674`

### Отсутствие Error Boundaries
- Ни одна страница не использует `ErrorBoundary`
- Краш в `Chat.jsx` (message reconciliation) или `Tasks.jsx` (`renderTaskCard`) приведёт к размонтированию всей страницы

### Backup-файлы в репозитории
- `frontend/src/pages/Database.jsx.backup`
- `frontend/src/pages/Database.jsx.bak`
- `frontend/src/pages/Dashboard.jsx.backup`

---

## 6. Сводная таблица находок

| ID | Категория | Файл:Строка | Severity | Усилия | Описание | Рекомендация |
|---|---|---|---|---|---|---|
| C001 | Security | `.env:1-219` | Critical | S | 18 hardcoded secrets | Перенести в vault |
| C002 | Architectural | `chat/service.py:336` | Critical | L | God class 5150 LOC | Разделить на домены |
| C003 | Architectural | `Settings.jsx:1` | Critical | L | God component 5555 LOC | Вынести в hooks |
| C004 | Architectural | `database/*.py` | Critical | L | 3 разных DB access patterns | Unified repository |
| C005 | Consistency | `queries.py` + `queries_new.py` | Critical | M | ✅ УСТРАНЕНО: queries_new удалён | — |
| F001 | God Class | `chat/service.py:336` | Critical | L | ChatService 5150 LOC | Разделить |
| F002 | God Class | `mail_service.py:293` | Critical | L | MailService 4229 LOC | Разделить |
| F003 | God Class | `network_service.py:497` | Critical | L | NetworkService 3855 LOC | Разделить |
| F004 | God Class | `hub_service.py:208` | Critical | L | HubService 3947 LOC | Разделить |
| F005 | God Func | `queries.py:407` | High | M | create_uploaded_transfer_act 485 LOC | Extract business rules |
| F006 | God Func | `queries.py:1063` | High | M | get_equipment_act_file 450+ LOC | Simplify |
| F007 | God Func | `network_service.py:596` | High | M | _ensure_schema 215 LOC | Use Alembic |
| F008 | God Func | `mail_service.py:900` | High | M | _ensure_schema 117 LOC | Use Alembic |
| F009 | God Func | `hub_service.py:834` | High | M | _ensure_schema 145 LOC | Use Alembic |
| F010 | God Func | `network_service.py:1837` | High | M | sync_socket_host_context 200 LOC | Split |
| F011 | God Func | `chat/service.py:1742` | High | M | get_messages 185 LOC | Extract helpers |
| F012 | God Func | `chat/service.py:2064` | High | M | search_messages 155 LOC | Extract helpers |
| F013 | God Comp | `Settings.jsx:1` | Critical | L | Settings 5555 LOC | Split into tabs |
| F014 | God Comp | `Chat.jsx:1` | Critical | L | Chat 5455 LOC | Extract 827 lines of utils |
| F015 | God Comp | `Tasks.jsx:1` | Critical | L | Tasks 5332 LOC | Split into sub-pages |
| F016 | God Comp | `Mail.jsx:374` | High | L | Mail 3291 LOC | Split into components |
| F017 | God Comp | `Dashboard.jsx:1` | High | L | Dashboard 3108 LOC | Extract widgets |
| D001 | Duplication | `api/v1/chat.py:343,482,558` | High | S | _publish_* copy-paste 60 lines each | Extract helper |
| D002 | Duplication | `equipment_db.py` | Medium | S | QUERY_GET_EQUIPMENT_GROUPED duplicate | Parameterize |
| D003 | Duplication | `mail_service.py:164` + 2 more | Medium | S | _utc_now_iso redefined 3x | Shared utils |
| D004 | Duplication | `chat/service.py:90` + 4 more | Medium | S | _normalize_text redefined 5x | Shared utils |
| T001 | Test Debt | `client.test.js` (6104 lines) | High | M | Test file 4.6× larger than code | Split by domain |
| T002 | Test Debt | `chat/service.py` (5488 lines) | High | L | No dedicated tests | Add unit tests |
| E001 | Error Handling | `api/v1/chat.py` (20+ lines) | High | M | Blanket except on all endpoints | Catch specific exceptions |
| E002 | Error Handling | `mail_service.py:1366` | Medium | S | except Exception: pass | Log and handle |
| E003 | Error Handling | `chat/service.py:1244` | Medium | S | except Exception: {} | Log and handle |
| S001 | Security | `.env` (18 secrets) | Critical | S | Hardcoded secrets | Use secret manager |
| S002 | Security | `queries.py:1161` | High | M | f-string SQL construction | Parameterized queries |
| S003 | Security | `_manual_env_tests/.env2:1` | Medium | S | Weak JWT secret | Generate strong secret |
| CFG001 | Config | `.env.example` | High | S | 30+ vars missing | Document all vars |
| CFG002 | Config | `requirements.txt` (4 files) | High | S | Unpinned deps | Pin versions |
| CFG003 | Config | `vite.config.js:11` | Medium | S | loadEnv loads all vars | Filter VITE_ prefix |
| P001 | Performance | `chat/service.py:1742` | Medium | M | Potential N+1 for attachments | Eager load |
| P002 | Performance | Multiple services | Medium | M | No shared caching | Redis for cache |
| P003 | Performance | `queries.py` | Medium | M | pyodbc sync in async path | Use async driver |

---

## 7. Open Questions

1. ✅ **Используется ли `database/queries.py` или `database/queries_new.py` как canonical?** — Решено: `queries_new.py` удалён, `equipment_db.py` теперь содержит свои SQL-константы
2. **Зачем backup-файлы (`Database.jsx.backup`, `.bak`) в репозитории?** Это история изменений или забытые файлы?
3. **Почему `_ensure_schema` реализован в 3+ сервисах вместо Alembic?** Это intentional для SQLite или tech debt?
4. **Используется ли TypeScript когда-либо?** В `package.json` есть `@types/react`, но весь код на JS.
5. **Какой coverage тестов?** Не удалось определить без запуска pytest/coverage.
6. **Почему `client.test.js` (6104 строки) тестирует только facade?** Это intentional или test debt?
7. **Есть ли staging environment?** `.env` содержит production-like credentials.

---

## 8. Things that look bad but are actually fine

1. **Глубоко вложенные callback'и в `chat/service.py`** — выглядят как callback hell, но это async/await с правильным использованием SQLAlchemy async session. Рефакторинг на цепочки не даст выигрыша.

2. **Multiple requirements.txt** — хотя дублирование кажется плохим, `scan_agent`, `scan_server` и `backend` — это отдельные deployable units, и у каждого свои зависимости. Общий `requirements.txt` в корне — для development окружения.

3. **Inline DDL в `_ensure_schema`** — для SQLite это на самом деле robust подход (self-healing schema), но только для локальных SQLite БД. Для PostgreSQL правильно используется Alembic.

4. **Большое количество custom hooks (~50)** — это не tech debt, а следование React best practices. Каждый hook encapsulates одну фичу.

5. **PWA + Service Worker + WebSocket + WebAuthn** — кажется перегруженным, но это требования enterprise-приложения (offline capability, real-time chat, passwordless auth).

---

## 9. ✅ Выполненные исправления

### queries_new.py удалён (2026-05-06)
- **Проблема:** Дублирование `database/queries.py` и `database/queries_new.py`
- **Решение:** 
  - SQL-константы из `queries_new.py` перенесены в `equipment_db.py`
  - Удалены все импорты `backend.database.queries_new` из `equipment_db.py`
  - Файл `database/queries_new.py` удалён
- **Результат:** Единый источник правды для equipment SQL-запросов

---

## 10. Рекомендации по приоритетам

### Срочно (1-2 недели)
1. 🔴 Удалить `.env` из репозитория и ротировать все секреты
2. 🔴 Удалить backup-файлы (`*.backup`, `*.bak`) из git
3. 🔴 Добавить `.env` в `.gitignore`

### Краткосрочно (1 месяц)
4. 🟠 Задокументировать все env-переменные в `.env.example`
5. 🟠 Закрепить версии Python-зависимостей
6. 🟠 Вынести `_normalize_text`, `_utc_now_iso` в `utils/common.py`
7. 🟠 Исправить `vite.config.js` — фильтровать env vars по префиксу `VITE_`

### Среднесрочно (2-3 месяца)
8. 🟡 Разделить God-сервисы backend на доменные сервисы
9. 🟡 Создать единый Repository слой для DB access
10. ✅ ~~Депрекейтнуть `database/queries.py` в пользу `queries_new.py`~~ — `queries_new.py` удалён, константы перенесены в `equipment_db.py`
11. 🟡 Разделить God-компоненты frontend (вынести бизнес-логику в hooks)

### Долгосрочно (3-6 месяцев)
12. 🟢 Добавить TypeScript на frontend
13. 🟢 Добавить mypy + type hints на backend
14. 🟢 Настроить ESLint + Prettier
15. 🟢 Добавить Error Boundaries на frontend
16. 🟢 Внедрить structured logging с correlation ID

---

*Файл создан автоматически на основе аудита codebase. Для обновления повторите анализ.*
