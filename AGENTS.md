# AGENTS.md — HUB-IT

Отвечать по-русски, сначала итог, затем необходимые детали. HUB-IT — монорепозиторий внутренней IT-платформы: React 18/Vite/MUI, Python/FastAPI, SQL Server, PostgreSQL, WPF/WebView2 и Expo Android.

Не добавлять обязательные Redis, Docker, новый брокер сообщений или сервис без прямого указания пользователя. Существующие опциональные контуры сохранять и проверять по коду/runtime.

## Навигация по задаче

Изучать только относящиеся к запросу код, тесты и документы. Подробная [карта репозитория и команды](documentation/technical/REPOSITORY_MAP.md) — справочник по необходимости. Обзор — [README.md](README.md), язык домена — [CONTEXT.md](CONTEXT.md), решения — `docs/adr/`. Не создавать второй словарь терминов вместо `CONTEXT.md`.

| Область | Где начинать |
|---|---|
| Web API / auth | `WEB-itinvent/backend/main.py`, `api/v1/`, `api/deps.py`, `services/`; [Web guide](WEB-itinvent/CLAUDE.md) |
| Web UI / браузер на телефоне | `WEB-itinvent/frontend/src/pages/`, `src/App.jsx`, доменные `src/api/`; frontend общий для браузера и Desktop |
| Chat | `WEB-itinvent/backend/chat_main.py`, `backend/chat/`, `backend/ai_chat/`; [архитектура](documentation/technical/CHAT_BACKEND_ARCHITECTURE.md) |
| Scan | `scan_server/`, `scan_agent/`; [архитектура и IIS proxy](documentation/technical/SCAN_ARCHITECTURE.md) |
| Inventory | `agent.py`, `agent/`, `inventory_server/` |
| Desktop | `desktop/`; [README](desktop/README.md) |
| Android | `mobile-hub/`; [README](mobile-hub/README.md) |
| Telegram | `bot/`; [README](bot/README.md) |
| 1С | `integrations/1c/`; [интеграция](documentation/technical/ONE_C_INTEGRATION.md) |
| Хранилища | [PostgreSQL schema](documentation/technical/POSTGRES_APP_SCHEMA.md), [общие JSON](data/README.md) |
| Эксплуатация | [PM2 runbook](scripts/pm2/README.md), [IIS](documentation/technical/IIS_DEPLOYMENT_WEB.md) |

## Проверочные команды

Выбирать проверки по изменению, не запускать весь список автоматически:

- Python: `pytest -q tests/test_<area>_<feature>.py`; bot — `pytest -q -c pytest.bot.ini`.
- Frontend из `WEB-itinvent/frontend`: релевантные `npm test` / Vitest, `npm run build` по правилам ниже.
- Desktop: `dotnet test desktop/Hub.Desktop.sln -c Release`.
- Mobile: команды и проверки из `mobile-hub/README.md`.

Повторять успешные проверки при новых изменениях, сбоях или конкретной непроверенной гипотезе. Не считать локальные тесты автоматически изолированными: перед запуском проверки, которая обращается к БД или сервисам, проверить её fixtures и настройки окружения.

## Правила для AI-агентов

### Режим работы

- «Проверить», «разобраться», «аудит», «найти причину» — read-only диагностика без изменений.
- «Исправить», «сделать», «реализовать» — минимальный diff, релевантные тесты и проверяемый результат.
- Сначала разрешать неопределённость по запросу, ранее принятым решениям, коду и тестам. Спрашивать о неразрешённом выборе, который существенно меняет согласованную бизнес-логику, публичный контракт, схему данных или риск потери данных. Рутинные обратимые решения внутри согласованного объёма принимать самостоятельно, обозначая существенные допущения. Пока требуется ответ, продолжать независимую разрешённую работу. Production-согласования действуют отдельно.
- Определять область через `rg`; открывать относящиеся к запросу entrypoint, соседний код, тесты и профильные документы по необходимости. Не читать весь репозиторий или обязательный набор документов перед каждой правкой.
- Если документация расходится с runtime-кодом или production-фактами, зафиксировать противоречие и проверить реализацию безопасным способом; не выбирать версию молча.
- Менять только относящиеся к задаче файлы. Следовать стилю соседнего кода и слоям `router/handler → service → store`.
- Не выполнять попутный рефакторинг, не добавлять зависимости «на будущее» и не менять публичное поведение без запроса.
- Рабочее дерево может быть грязным: не перезаписывать чужие изменения, не использовать `git reset --hard`/`git checkout --`, не создавать коммиты и ветки без просьбы.
- Отвечать пользователю по-русски, если не попросили иначе.

### Production safety

Production по умолчанию только read-only. Отсутствие полноценного staging не разрешает тестировать изменения на production: использовать локальную среду, тестовую БД или изолированный harness.

Без явного запроса пользователя запрещено:

- менять `.env`, IIS, PM2, PostgreSQL config и Windows settings;
- выполнять DDL/DML/DELETE, миграции, retention и cleanup в production;
- перезапускать процессы, освобождать порты и выполнять deployment;
- удалять таблицы, индексы, пользователей, файлы или данные.

Явный запрос или ранее данное согласие пользователя считается разрешением на указанную операцию в согласованных окружении и объёме. Повторно спрашивать только при изменении цели, объёма, существенных рисков или обнаружении дополнительных последствий. Перед запросом выполнить всю разрешённую подготовку и представить конкретную операцию, ожидаемый эффект, rollback и post-check. Запрос исправления кода сам по себе не разрешает deployment или restart.

Перед разрешённой опасной операцией: read-only проверка точной цели, затем команда, ожидаемый эффект, rollback и post-check.

Пользователей по умолчанию деактивировать, сохраняя PK, историю и связи. Cleanup должен иметь dry-run, feature flag `false` по умолчанию, ограниченные batch-операции, single-run lock, метрики и безопасный повторный запуск.

### Секреты

- Не выводить пароли, токены, cookies, приватные ключи и строки подключения в код, команды, логи или отчёты.
- Не коммитить `.env` и локальный `LLM_PROJECT_CONTEXT.md`; в `.env.example` оставлять только плейсхолдеры.
- Не передавать секреты через CLI, если доступны env или защищённый конфигурационный файл.

### Данные и миграции

#### SQL Server

- SQL Server — source of truth для legacy ITINVENT и оборудования.
- Для `pyodbc` использовать параметризованные запросы с `?`; не конкатенировать пользовательские значения.
- Не менять смысл legacy-полей и процедур без проверки потребителей.

#### PostgreSQL

- PostgreSQL хранит app/chat/scan runtime.
- Production-изменения схемы выполнять через существующие Alembic-механизмы; не добавлять runtime `CREATE TABLE/INDEX` в request path.
- Перед миграцией проверить фактическую схему, объём, индексы, FK, дубликаты, orphan rows, блокировки и свободное место.
- Использовать существующую ORM/SQL abstraction и bound parameters драйвера.
- Не держать сетевые вызовы, тяжёлую сериализацию и вычисления внутри транзакций; долгие операции делать batch-ами с rollback-планом.

Критический инвариант chat: ORM и базовые миграции используют логическую схему `chat`. Legacy PostgreSQL runtime может через `schema_translate_map` направлять её в `public`, если таблицы `chat.chat_conversations` ещё нет. Поэтому перед миграцией, `alembic check` или ручным SQL нужно проверить фактическую runtime-схему; нельзя без проверки считать `public.chat_*` или `chat.*` универсальным source of truth.

#### JSON

- `data/*.json` совместно используют web и bot: соблюдать существующие locking-паттерны и атомарную запись.
- При `APP_ENV=production` JSON runtime не должен молча переходить на SQLite; использовать предусмотренное PostgreSQL-хранилище и штатную миграцию.

### Backend и конкурентность

- Держать транзакции короткими.
- Для status transition, approve/reject, update/update и повторных запросов проверять гонки, идемпотентность и lost update.
- Не выполнять блокирующий I/O в event loop.
- Для WebSocket учитывать reconnect, ordering, duplicate delivery, backpressure и медленных клиентов.
- ACK не должен ждать необязательные уведомления, внешние вызовы или тяжёлую сериализацию.
- Workers должны безопасно переживать повторный запуск и работу нескольких процессов.
- Логировать структурированно и без секретов; добавлять request/correlation id и stage, когда это принято в подсистеме.

### Frontend

- Новые доменные API размещать в отдельных файлах `WEB-itinvent/frontend/src/api/`; не раздувать legacy `client.js`.
- Не делать полный refetch страницы, если достаточно точечного обновления объекта или query cache.
- Сохранять design system, адаптивность и dark theme.
- Проверять loading, empty, error, reconnect и expired-session состояния.
- Не ломать silent refresh, возврат на вкладку, WebSocket reconnect и текущий auth flow.
- Данные API не считать доверенным HTML.

### Инварианты подсистем

#### LLM

Все OpenRouter/LLM-вызовы — только через `shared/llm/`. Не создавать локальные `OpenAI()`-клиенты в backend, bot или services и не логировать потенциально конфиденциальные prompt/response без предусмотренной редактуры.

#### Scan и inventory

Не смешивать контуры:

- Scan: `scan_agent/`, `scan_server/`, PostgreSQL schema `scan` или явно разрешённый dev fallback;
- Inventory: `agent.py`, `agent/`, `inventory_server/`.

Перед изменением Scan routes/proxy прочитать [SCAN_ARCHITECTURE.md](./documentation/technical/SCAN_ARCHITECTURE.md).

#### Desktop

`desktop/` — тонкая WPF/WebView2-оболочка существующего портала. Auth, REST, WebSocket и бизнес-логика остаются во frontend/backend. Не дублировать backend и сохранять origin/navigation policy.

#### Mobile

Действующее приложение — Expo React Native в `mobile-hub/`. Старый `mobile-android/` и Capacitor pipeline удалены; не восстанавливать их. Наличие native-push API не означает наличие старого Capacitor-клиента.

#### Auth

Перед изменениями прочитать [AUTH_SECURITY_STACK.md](./documentation/technical/AUTH_SECURITY_STACK.md). Не менять session lifetime, refresh rotation, device trust, WebAuthn origin/RP ID и 2FA policy как побочный эффект. Ошибка одного клиента не должна ослаблять серверную проверку для остальных.

### Проверка изменений

Сначала запускать узкие тесты затронутой области, затем расширять набор при необходимости. Базовые команды собраны в разделе [Проверочные команды](#проверочные-команды) выше.

Дополнительно:

- database — upgrade/downgrade и проверка схемы на тестовой БД;
- concurrency — параллельный тест критического перехода и финального состояния;
- WebSocket — reconnect/duplicate/order для изменённого сценария;
- frontend — production build после изменений сборки, routing, auth или API client;
- Desktop — Release test/build для WebView2, navigation, packaging или auth bridge.

Не утверждать, что тесты пройдены, проблема исправлена или deployment выполнен без фактической проверки. Если проверка невозможна, назвать точную причину.

### Производительность

- Сначала определить узкое место и зафиксировать baseline.
- Сравнивать до/после в одинаковом сценарии и на одинаковом объёме данных.
- Для API/WS использовать подходящие p50/p95/p99, error rate, event-loop lag, queue wait и stage timings.
- Для SQL сравнивать query count, execution time, locks и план запроса.
- `EXPLAIN (ANALYZE, BUFFERS)` использовать только в безопасной среде либо с явным разрешением для production.
- Не объявлять оптимизацию успешной по одному прогону и не переносить небольшой benchmark на production scale без оговорки.

### Deployment и перезапуски

Наличие команд не даёт разрешения на их выполнение. Только по явному запросу пользователя:

- backend — `scripts/pm2/restart-backend.ps1`;
- split chat — `scripts/pm2/restart-chat.ps1`;
- весь контур — `scripts/pm2/restart-all.ps1`, только если нужен полный restart;
- frontend обслуживается IIS, а не PM2.

В рамках диагностики и post-check разрешены read-only health-запросы и `scripts/pm2/health-check.ps1` без `-RepairBackend` и `-RepairScan`. Режимы ремонта, рестарты и освобождение портов требуют явного разрешения.

Не заменять штатные скрипты прямым `pm2 restart`: они могут очищать orphan-процессы, освобождать порты и восстанавливать связанный runtime. `restart-backend.ps1` также вызывает `restart-scan.ps1`: включать этот побочный эффект в preflight и согласованный объём. Если `pm2.cmd` не находит Node, использовать проектный `tools/node-v24.14.0-win-x64-full` в PATH.

### Завершение задачи

В конце кратко сообщать:

1. Что сделано или какая причина найдена.
2. Какие файлы изменены.
3. Какие проверки выполнены и их фактический результат.
4. Что не удалось проверить.
5. Оставшиеся риски и отдельные действия для deployment.

Не пересказывать весь процесс без запроса.

## Поддержание инструкций

Обновлять правила при изменении обязательных инвариантов, а [карту репозитория](documentation/technical/REPOSITORY_MAP.md) — при смене подсистем, entrypoint или runtime. Подробности оставлять в README подсистем и профильной документации. Повторяющиеся поправки пользователя записывать в соответствующее правило без дублирования.
