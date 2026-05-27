# HUB-IT

Внутренняя платформа учёта IT-инфраструктуры, обслуживания оборудования, операционного Hub, service desk, почты/чата и контура поиска чувствительных документов на рабочих станциях. Один доменный словарь на весь монорепозиторий (web, Telegram-бот, Windows-агенты, scan).

_Навигация по коду: [AGENTS.md](./AGENTS.md)._

## Language

### Платформа и каналы

**HUB-IT**:
Каноническое имя продукта и платформы в этом репозитории.
_Avoid_: Image_scan (имя папки репо), IT-invent (legacy-имя web-модуля без уточнения)

**Web-клиент**:
Браузерное приложение `WEB-itinvent` (адаптивный UI, PWA/web-push где включено).
_Avoid_: APK, native app, Capacitor shell (удалены из репозитория)

### Доступ в web

**Web role**:
Шаблон прав пользователя в HUB-IT web: `viewer`, `operator` или `admin` (не путать с группой AD).
_Avoid_: permission, AD-группа, «роль в домене»

**Web permission**:
Атомарное право на действие или раздел API/UI (`tasks.read`, `scan.ack`, `database.write`, …).
_Avoid_: role, «уровень доступа» без строки permission

**Custom permission profile**:
Персональный набор **Web permission**, подменяющий шаблон **Web role** (`use_custom_permissions`).
_Avoid_: новая role «scan-only», смешение role и permission в одном слове

**Telegram-бот**:
Оперативный канал для поиска оборудования, актов и регистрации работ (`bot/`).

**Windows-агент (inventory)**:
Служба на ПК: сбор **Inventory host** и отправка на **Inventory server** (`agent.py`).
_Avoid_: scan-агент (это отдельный **Scan agent**)

### Операции Hub и service desk

**Hub task**:
Внутренняя операционная задача в Hub (назначение, контролёр, статусы, отчёт); UI — «Задачи», `/tasks`.
_Avoid_: ticket, тикет, заявка (если имеется в виду Ticket)

**Hub task project**:
Группировка **Hub task** (например «Общие», системный проект напоминаний по актам); поле `project_id` у задачи.
_Avoid_: ticket object, ITINVENT database

**Hub task object**:
Справочник объектов/направлений для задач Hub (отдельная сущность, не объект Ticket).
_Avoid_: **Equipment record**, **Ticket** object

**Ticket**:
Заявка в контуре service desk / logistics (объекты, исполнители, импорт, finops, история); UI — «Tickets», `/tickets`.
_Avoid_: hub task, задача Hub, «задача» без уточнения контекста

**Hub announcement**:
Объявление в Hub с аудиторией, версией и опциональным подтверждением прочтения.

**Hub notification**:
In-app уведомление пользователю Hub, привязанное к сущности (`entity_type` / `entity_id`).
_Avoid_: **Chat message**, Telegram, почтовое письмо

### Перемещение и акты

**Equipment transfer**:
Запись о перемещении техники между сотрудниками/локациями в **Shared JSON ledger** (`equipment_transfers.json`); создаётся ботом и web, не меняет **Equipment record** в SQL напрямую.
_Avoid_: **Hub task**, **Ticket**, запись в ITINVENT без учётного процесса

**Transfer act job**:
Фоновая операция web по генерации/обработке DOCX/PDF акта перемещения; очередь в **App runtime store** (`transfer_act_jobs`).
_Avoid_: **Equipment transfer** как синоним (JSON уже может существовать отдельно)

**Transfer act reminder**:
Напоминание подписать/загрузить акт; хранится в PostgreSQL (`equipment_transfer_act_reminders`) и обычно порождает связанную **Hub task** (`task_id`).
_Avoid_: обычная **Hub task** без контекста акта, **Ticket**

### Хранилища данных

**Equipment catalog (ITINVENT)**:
Семейство учётных БД оборудования в **SQL Server**; источник истины для **Equipment record**.
_Avoid_: PostgreSQL, **Shared JSON ledger**, «база» без имени

**ITINVENT database**:
Конкретный именованный экземпляр **Equipment catalog** (`db_id` / `database_id` в конфиге и API): host + catalog, напр. основная или `ITINVENT2`.
_Avoid_: **App runtime store**, `hubit_chat`, «database» без `db_id`

**Selected ITINVENT database**:
ITINVENT database, с которой пользователь или бот работает сейчас: `pinned_database` (web), `assigned_database` (профиль), `user_db_selection` (Telegram).
_Avoid_: PostgreSQL URL, переключатель «базы» в смысле PG

**App runtime store**:
App-owned данные в PostgreSQL (`APP_DATABASE_URL`, опционально `CHAT_DATABASE_URL`): Hub, чат, tickets, inventory hosts, почта (часть), настройки. Схемы: [POSTGRES_APP_SCHEMA.md](./documentation/technical/POSTGRES_APP_SCHEMA.md) (обновляется после миграций, см. `SKIP_PG_SCHEMA_DOCS`).
_Avoid_: ITINVENT, JSON, «основная база» без уточнения

**Shared JSON ledger**:
Общие JSON-файлы в `data/` для bot + web (перемещения, работы, кэши); не заменяют **Equipment catalog** и не дублируют весь **App runtime store**.
_Avoid_: база данных, ITINVENT, PostgreSQL

### Учёт оборудования и агенты

**Equipment record**:
Одна запись техники в **Equipment catalog (ITINVENT)** в рамках выбранной **ITINVENT database**: инв. №, серийник, сотрудник, **ITINVENT branch**, статус.
_Avoid_: «запись в JSON» как замена учёту, **Inventory host**

**Inventory server**:
Отдельный сервис приёма отчётов **Windows-агента (inventory)** (`inventory_server/`); буфер/очередь ingest, не web-backend и не **Scan server**.
_Avoid_: **Inventory host** (это уже сохранённый снимок в PostgreSQL), Scan

**Inventory host**:
Снимок конкретного ПК после обработки ingest (hostname, MAC, железо, пользователь, сеть); хранится в **App runtime store** (`inventory_hosts`), не подменяет **Equipment record**.
_Avoid_: equipment (без уточнения), **Inventory server** как синоним, scan-инцидент

### Scan (чувствительные документы)

**Scan agent**:
Sidecar на рабочей станции: сканирует Desktop/Documents/Downloads, шлёт ingest/heartbeat на **Scan server** (`scan_agent/`).
_Avoid_: Windows-агент, inventory-agent, «агент» без уточнения

**Scan server**:
Отдельный сервис очереди и инцидентов (`scan_server/`, порт 8011); SQLite, не PostgreSQL app store.
_Avoid_: backend, inventory server

**Scan task**:
Оффлайн-команда сервера агенту (например `ping`, `scan_now`); очередь в SQLite **Scan server**.
_Avoid_: hub task, ticket, «задача» без уточнения

**Scan incident**:
Зафиксированное срабатывание по чувствительному содержимому файла; ACK в **Scan Center**.
_Avoid_: inventory event, equipment record, hub notification

**Scan Center**:
Раздел web UI (`/scan-center`); API `/scan/*` через IIS proxy на **Scan server**.
_Avoid_: «центр сканирования» в смысле инвентаризации ПК

### Филиал и сеть

**ITINVENT branch**:
Филиал в **Equipment catalog**: `BRANCH_NO`, `BRANCH_NAME` в SQL Server.
_Avoid_: **Network branch**, **Scan branch label** без уточнения

**Network branch**:
Филиал в модуле сетевого учёта (`network_branches` в **App runtime store**); карты, розетки, панели; связь с **ITINVENT database** через `network_branch_db_map`.
_Avoid_: **ITINVENT branch** как синоним, Scan

**Scan branch label**:
Произвольная строка у **Scan agent** / в **Scan incident** (SQLite); фильтр в **Scan Center**, не синхронизируется с **ITINVENT branch**.
_Avoid_: BRANCH_NO, «филиал в базе» без слоя

### Внутренний чат

**Chat conversation**:
Диалог внутреннего мессенджера HUB-IT (direct/group); схема `chat` в PostgreSQL, UI `/chat`.
_Avoid_: Telegram, **Hub notification**, почта

**Chat message**:
Сообщение в **Chat conversation** (текст, вложения, реакции, preview **Hub task**).
_Avoid_: **Hub notification**, комментарий к **Ticket**

**Chat event outbox**:
Очередь доставки chat-событий (realtime/push) в PostgreSQL; не путать с **Chat message** как контентом диалога.
_Avoid_: **Hub notification**, `chat_push_outbox` (другая очередь, когда развёрнута)

### Почта и MFU

**User mailbox**:
Почтовый ящик пользователя в web (основной в `users` или дополнительные в `user_mailboxes`); доступ к Exchange/IMAP через backend mail API.
_Avoid_: **Chat message**, Telegram

**MFU device**:
Многофункциональное устройство (принтер/копир) в контуре учёта страниц; runtime и снимки счётчиков в схеме `system` (`mfu_*`), не в ITINVENT.
_Avoid_: **Equipment record**, **Inventory host**

## Relationships

- Один **Hub task** — много отчётов, вложений, комментариев; опционально **Hub task project** и **Hub task object**.
- **Ticket** не является разновидностью **Hub task**; общей таблицы нет.
- **Hub notification** ссылается на сущности Hub через `entity_type` / `entity_id`; не дублирует **Chat message**.
- **Equipment record** живёт только в **Equipment catalog (ITINVENT)** в рамке **ITINVENT database**.
- **Selected ITINVENT database** определяет, к какому SQL-подключению идут запросы equipment/database API и бота.
- **Equipment transfer** (JSON) не обновляет **Equipment record**; смена учёта — отдельный процесс/SQL.
- **Transfer act reminder** может ссылаться на **Hub task**; **Transfer act job** обрабатывает документы в PostgreSQL, не заменяя JSON-реестр перемещений.
- **Windows-агент (inventory)** → **Inventory server** → сохранение **Inventory host** в **App runtime store** (часто через web/worker).
- **Inventory host** может существовать без **Equipment record**; кэш **ITINVENT branch** для хоста — `inventory_host_sql_contexts`.
- **Scan agent** и **Inventory host** на одном ПК — независимые потоки.
- **Scan server**: **Scan task** → агент → возможный **Scan incident**; данные в SQLite, не в app PostgreSQL.
- **ITINVENT branch** ≠ **Network branch** ≠ **Scan branch label**; см. таблицу в разделе Language.
- **Network branch** связывается с **ITINVENT database** через `network_branch_db_map`, не подменяет `BRANCH_NO` в SQL.
- **Inventory host**, **Hub task**, **Ticket**, чат, почта (часть) — **App runtime store**; MFU runtime — схема `system` в том же PG-инстансе.
- **Shared JSON ledger** общий для bot и web; в production не подменяет PostgreSQL для app-runtime.
- **Web role** → шаблон **Web permission**; **Custom permission profile** переопределяет шаблон.
- Роль `admin` может обходить отдельные проверки permission — особенность реализации.

## Example dialogue

> **Dev:** «Создай задачу на загрузку подписанного акта перемещения.»  
> **Эксперт:** Это **Hub task**, часто из **Transfer act reminder**, не **Ticket**. Сам факт перемещения уже может быть в **Equipment transfer** (JSON).

> **Dev:** «Сгенерируй акт PDF по перемещению.»  
> **Эксперт:** Ставим **Transfer act job** в PostgreSQL; исходные данные берём из **Equipment transfer** или формы web, не пишем напрямую в ITINVENT.

> **Dev:** «Серийник не найден в SQL, агент уже шлёт inventory — куда писать?»  
> **Эксперт:** **Inventory host** в PostgreSQL; в ITINVENT ищем **Equipment record** в **Selected ITINVENT database** или «в учётной базе не найдено».

> **Dev:** «Куда падает отчёт agent.py?»  
> **Эксперт:** На **Inventory server**, затем в **Inventory host** в app store — не в **Scan server** и не в JSON.

> **Dev:** «Переключи базу на ITINVENT2.»  
> **Эксперт:** Меняем **Selected ITINVENT database** (`db_id`), не `APP_DATABASE_URL`. PostgreSQL остаётся тем же **App runtime store**.

> **Dev:** «Нужна задача scan_now на филиал.»  
> **Эксперт:** **Scan task** в **Scan server**, не **Hub task**. Фильтр — **Scan branch label**, не `BRANCH_NO`.

> **Dev:** «Сохрани перемещение в базу.»  
> **Эксперт:** Оперативный след — **Equipment transfer** в JSON. Учётная правка — **Equipment record** в SQL отдельно.

> **Dev:** «Сделай роль scan-only.»  
> **Эксперт:** **Custom permission profile** (`scan.read`, `scan.ack`), не новая **Web role**.

> **Dev:** «Поставь филиал Тюмень агенту scan.»  
> **Эксперт:** **Scan branch label**. Для каталога техники — **ITINVENT branch**; для карт сети — **Network branch**.

> **Dev:** «Отправь уведомление в чат задачи.»  
> **Эксперт:** **Chat message** в **Chat conversation** (`/chat`). **Hub notification** — колокольчик Hub, не Telegram.

> **Dev:** «Сколько страниц напечатал МФУ?»  
> **Эксперт:** Контур **MFU device**, таблицы `system.mfu_*`, не **Equipment record** и не inventory.

## Flagged ambiguities

- **Один PostgreSQL или два:** в `.env` часто `APP_DATABASE_URL=${CHAT_DATABASE_URL}` — один инстанс; при раздельном `CHAT_DATABASE_URL` таблицы `chat_*` могут жить на другом хосте. Для агентов: смотреть фактический URL, не предполагать полный набор таблиц `chat` на app-инстансе ([POSTGRES_APP_SCHEMA.md](./documentation/technical/POSTGRES_APP_SCHEMA.md)).
- **Обязателен ли Hub task для каждого перемещения:** **Equipment transfer** в JSON может существовать без **Transfer act reminder** / **Hub task**; напоминания и задачи — отдельный workflow.

## Documentation decisions

- **2026-05-26:** один корневой `CONTEXT.md` на весь монорепозиторий; без `CONTEXT-MAP.md` и без отдельных `*/CONTEXT.md`, пока команды не разойдутся по языку домена.
- **2026-05-26:** **Hub task** и **Ticket** — разные доменные понятия; не смешивать термин «задача» без уточнения.
- **2026-05-26:** **Unfound equipment** выведен; при ненаходе в ITINVENT — только сообщение, без JSON-реестра unfound.
- **2026-05-26:** контур Scan отдельно от inventory; SQLite **Scan server** ≠ PostgreSQL app store.
- **2026-05-26:** три слоя данных: **Equipment catalog**, **App runtime store**, **Shared JSON ledger**; не говорить «база» без уточнения.
- **2026-05-26:** web-доступ: **Web role** vs **Web permission** vs **Custom permission profile**.
- **2026-05-26:** **ITINVENT branch** vs **Scan branch label** vs **Network branch**.
- **2026-05-26:** справочник PostgreSQL — `documentation/technical/POSTGRES_APP_SCHEMA.md` (+ DDL snapshot); авто-обновление после Alembic, `SKIP_PG_SCHEMA_DOCS` в `.env`.
- **2026-05-26:** перемещения: **Equipment transfer** (JSON) + **Transfer act job** (PG) + **Transfer act reminder** / **Hub task**; не смешивать с правкой **Equipment record** в SQL.
- **2026-05-26:** **ITINVENT database** / **Selected ITINVENT database** — только SQL Server catalog; не путать с `APP_DATABASE_URL`.
- **2026-05-26:** **Inventory server** (ingest) vs **Inventory host** (снимок в PG); чат vs **Hub notification**; кратко почта/MFU.
