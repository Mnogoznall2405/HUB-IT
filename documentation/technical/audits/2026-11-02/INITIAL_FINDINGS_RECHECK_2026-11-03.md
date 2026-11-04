# Повторная сверка 33 исходных находок — 2026-11-03

Источник ID: `TECH_DEBT_AUDIT_2026-11-02.md`, первые таблицы BE/FE/SC/CL/OP/AR, до модульного продолжения.
Проверен счёт: BE 6 + FE 6 + SC 8 + CL 6 + OP 5 + AR 2 = **33 уникальных ID**.
Итог: **OPEN 3; CHANGED 30; NOT_RECHECKED 0; CLOSED 0**.
CHANGED означает изменение механизма в текущем дереве, включая частичные исправления; это не утверждение о закрытии риска.
OPEN означает, что исходный механизм остаётся актуальным. NOT_RECHECKED означает отсутствие свежей сверки кода.
CLOSED не используется: полной согласованной acceptance всех затронутых границ в этой сверке нет.
Исправления ниже сделаны другими процессами/участниками, не этим read-only проходом. Единственная запись прохода — этот файл.
Данные production, конфигурация окружения, деплой и внешние отправки не проверялись и не выполнялись.
Ссылки на исходники относительно корня репозитория; номера строк соответствуют чтению текущего рабочего дерева, не единому commit.

## Backend

### BE-01 — CHANGED
- `WEB-itinvent/backend/api/v1/mail.py:183-184`: появился `contextvars.copy_context()` и executor запускает `ctx.run`.
- Старый lost-ContextVar harness больше не описывает реализацию; модульный mail-проход подтвердил перенос контекста. AD login → mail/bootstrap через реальный HTTP/Exchange здесь не выполнен.

### BE-02 — CHANGED
- `WEB-itinvent/backend/services/session_auth_context_service.py:160-168`, `:228`: app DB store делает адресный upsert по session ID, delete адресный.
- Полная `_save_items` остаётся в dev/local ветке; старую app DB потерю чужой сессии нельзя повторять как неизменённый код. Параллельная acceptance login/logout/expiry на PostgreSQL не выполнена.

### BE-03 — CHANGED
- `WEB-itinvent/backend/services/task_email_outbox_service.py:208`, `:238-252`, `:271-294`: claim_token/attempt_count проверяются touch и failed.
- `:254-269`: sent ACK намеренно без claim token, что прямо объяснено комментарием; старый sender всё ещё может закончить внешний send после reclaim. Частичное изменение, не exactly-once и не CLOSED; политика ambiguous SMTP требует отдельной приёмки.

### BE-04 — CHANGED
- `WEB-itinvent/backend/api/v1/equipment.py:3992-4027`, `:4053-4074`: появились ledger и recovery ранее вставленного FILE_NO.
- `:4017-4025`: lookup error/несколько кандидатов возвращают None и допускают повторную вставку; сопоставление recent item/author не равнозначно digest bytes. Crash между SQL INSERT и app-ledger остаётся отдельной границей; SQL Server fault-injection не выполнен.

### BE-05 — CHANGED
- `WEB-itinvent/backend/services/equipment_photo_upload_service.py:233-283`, `:302-309`, `:333-334`: token владельца, heartbeat и release только своего token.
- Старое описание «120 секунд без heartbeat и безусловный unlink чужого lock» устарело. Межпроцессный стресс stale takeover/heartbeat/commit на Windows не повторялся.

### BE-06 — CHANGED
- `WEB-itinvent/backend/services/session_auth_context_service.py:173-190`: app DB lookup использует `session.get` одной строки; expiry удаляет эту строку.
- Полный скан остаётся для локального fallback (`:191-210`), не основного app DB пути. SQL baseline и p95 на том же объёме сессий не измерены.

## Frontend

### FE-01 — CHANGED
- `WEB-itinvent/frontend/src/lib/swrCache.js:63-76`, `:119-131`: invalidation отсоединяет matching in-flight; публикация проверяет identity promise.
- Уже выполнены свежий Node harness (`cached=NEW`) и `swrCache.test.js`, 6/6 passed. Эти проверки подтверждают функцию, но полный Networks UI mutation/navigation acceptance не выполнялся; статус CHANGED, не CLOSED.

### FE-02 — CHANGED
- `WEB-itinvent/frontend/src/lib/resumablePhotoUpload.js:88-110`, `:163`: новые w2 IDs включают bytes digest; legacyId сохраняет прежние metadata IDs для старой очереди.
- Исходная коллизия новых файлов адресована кодом. Старые задания сознательно совместимы со старым форматом; deterministic compression/resume и правильные bytes через server download не проверены.

### FE-03 — CHANGED
- `WEB-itinvent/frontend/src/pages/ItObjectDetail.jsx:300-335`: poll пропускается при in-flight; manual/mutation load отменяет предыдущий, response/catch проверяют sequence.
- Старый безусловный setState после перекрывающихся poll устарел; браузерный сценарий старый poll → remove link → delayed response здесь не исполнялся.

### FE-04 — CHANGED
- `WEB-itinvent/frontend/src/lib/photoUploadQueue.js:79-109`, `:122-124`; `WEB-itinvent/frontend/src/pages/database/EquipmentDetailPhotosPanel.jsx:916`: durable-state, повтор IDB и предупреждение о памяти.
- Вечный молчаливый fallback заменён более явной моделью. Browser quota/open failure/reload/recovery вместе не проверены; устойчивость каждого файла после закрытия вкладки не утверждается.

### FE-05 — CHANGED
- `WEB-itinvent/frontend/src/lib/photoUploadQueue.js:160`, `:186-208`, `:313`, `:385`: выбор job проверяет текущего пользователя; upload имеет AbortController и session check в progress.
- Отдельной немедленной остановки от `auth-changed` в singleton нет: проверка progress зависит от callback. Изменение снижает исходный риск, но A→logout→B в середине chunk/retry нужно проверить через браузер и серверную атрибуцию.

### FE-06 — OPEN
- `WEB-itinvent/frontend/src/pages/Networks.jsx:752-765`, `:863-887`, `:1265`, `:1281`: полный branch refresh после точечной мутации сохранён.
- По-прежнему шесть context reads + ports, два лимита 10000. SWR fix не устраняет этот fan-out; численная оценка production скорости отсутствует.

## Scan и Inventory

### SC-01 — CHANGED
- `scan_server/database.py:1480-1485`, `:1517`: orphan reconciliation получил 900-секундный grace по mtime.
- Это защита свежей публикации, а не общий атомарный staging+INSERT protocol. Задержка writer сверх grace/сбой после публикации требуют отдельного сценария; потеря PDF не объявляется полностью устранённой.

### SC-02 — CHANGED
- `scan_server/database.py:32-36`, `:3663-3714`, `:3867-3868`; `scan_server/worker.py:873-878`, `:1102`: claim_attempt передаётся worker и guards записи/финализации.
- Token optional для совместимости отдельных callers. Полная проверка stale owner → incident write → finalize → spool removal, включая все альтернативные callers, не повторялась.

### SC-03 — CHANGED
- `scan_server/database.py:3315-3369`: recovery больше не уменьшает attempt_count, исчерпанные processing переводит failed.
- Cap применяется recovery, а исходный claim `:3453` остаётся отдельной границей выбора queued. Повторный многократный crash/reclaim acceptance в этой сверке не запускался.

### SC-04 — CHANGED
- `inventory_server/database.py:13-22`: recover_interrupted по умолчанию False; `inventory_server/app.py:41` включает recovery для runtime.
- Maintenance construction больше не сбрасывает processing без явного флага. Это не доказывает межпроцессный claim/lease и исключение второго runtime-owner; см. модульный inventory отчёт.

### SC-05 — CHANGED
- `WEB-itinvent/backend/inventory_runtime.py:928-940`; `WEB-itinvent/backend/appdb/inventory_store.py:945-997`: change_events передаются в upsert_host и сохраняются в его transaction.
- Исходный app snapshot/history split изменён; локальная dev-ветка и crash/rollback acceptance для общего payload отдельно не запускались.

### SC-06 — CHANGED
- `scan_server/app.py:1075-1079`, `:1116`: admission перемещён перед `UploadFile.read`, ожидающие multipart не держат весь распакованный файл этим кодом.
- JSON/base64 и multipart parser имеют другие границы materialization. Общий RSS/backpressure/timeout/budget по всем ingest routes не проверен; исходную оценку N×50 MiB нельзя переносить на исправленный upload путь без уточнения.

### SC-07 — CHANGED
- `scan_server/worker.py:440-457`, `:550`: pool recycle не ждёт stale pool (`wait=False`), остановка вынесена в bounded shutdown helper.
- Running native thread по-прежнему не уничтожается timeout; замена pool может оставить работу старого pool. Стресс повторных зависаний и финальный shutdown Windows не выполнен.

### SC-08 — CHANGED
- `scan_server/db.py:20-22`, `:54-57`, `:139-142`: runtime DDL включается явным SCAN_SCHEMA_DEV_AUTO_CREATE, иначе проверяется версия.
- DDL implementation `:72-89` сохранена для opt-in; flag не равнозначен проверке APP_ENV. Default production path изменён, фактический production flag/schema не проверены.

## Клиенты, Desktop и бот

### CL-01 — CHANGED
- `bot/handlers/transfer.py:105-108`, `:135-137`, `:1441-1452`: TimedOut больше не retry, caller фиксирует delivery_unknown.
- Повтор разрешён для RetryAfter. Реальная доставка/восстановление после restart здесь не проверялись; чужое изменение не записывается как исправление аудитора.

### CL-02 — CHANGED
- `mobile-hub/src/screens/monitoring/NativeMonitoringScreen.tsx:51-55`, `:76-82`: poll пропускается при inFlight, manual load сохраняет supersede.
- Старый starvation от автоматического abort overview изменён. Detail использует другую схему generation; Android сценарий 16–29-секундного ответа не выполнен.

### CL-03 — CHANGED
- `mobile-hub/src/screens/monitoring/NativeMonitoringDetail.tsx:127-130`, `:152-156`: сохранённая история имеет target/interface/hours key; render берёт только совпадающую.
- Старый график под новым заголовком отсекается кодом. Acceptance смена интерфейса/периода + fail нового запроса на устройстве не выполнена.

### CL-04 — CHANGED
- `mobile-hub/src/screens/monitoring/NativeMonitoringDetail.tsx:85`, `:96`, `:136`; `mobile-hub/src/monitoring/useMonitoringActive.ts:6-15`: detail/history привязаны к active.
- Overview также использует active (`NativeMonitoringScreen.tsx:76-82`). Реальное focus/AppState/freezeOnBlur и прекращение traffic в фоне не измерены.

### CL-05 — CHANGED
- `bot/services/transfer_operation_store.py:77-85`, `:141-161`; `bot/handlers/transfer.py:37`, `:1422`: keyed row операции и async journal wrapper вместо полной перезаписи журнала из handler.
- Retention и события отдельной операции не ограничены прежним образом автоматически; проверка скорости на большой истории/параллельные процессы не выполнена.

### CL-06 — CHANGED
- `desktop/Hub.Desktop/Transfers/DesktopSharedFileRegistry.cs:19-20`, `:122-130`, `:161`, `:167-183`: общий cap 500, TTL 30 минут, purge и Clear.
- Неограниченность двух map адресована кодом. Clean build, TimeProvider expiry/cap tests и фактическое использование Clear при logout/host lifecycle не выполнены в этой сверке.

## Операции, зависимости и архитектура

### OP-01 — CHANGED
- `scripts/migrate_hub_sqlite_to_postgres.py:30-37`, `:103-121`, `:133-148`: dry-run, execute/overwrite, preflight и общий commit после копирования.
- В основном отчёте зафиксирован профиль мигратора/Scan tests: 7 passed, 2 skipped; заново не запускался. Другие миграторы и production rollback не подтверждены, исходный report не переписан.

### OP-02 — CHANGED
- `tests/conftest.py:53-57`; `tests/test_scan_pg_compat.py:16-25`, `:55`, `:124`: выделенный test URL и test-name guard.
- Реальный PG roundtrip не выполнялся. Наличие других тестов с собственными обходами guard не исключено; широкие suites этой сверкой не запускались.

### OP-03 — CHANGED
- `.gitignore:12`: добавлено исключение Desktop Downloads; необходимые файлы доступны на диске.
- Свежий `git ls-files desktop/Hub.Desktop/Downloads` по-прежнему пуст: ignore fix не равно source tracking/переносимому checkout. Clean clone/build не выполнен; незакоммиченные исходники не потерять.

### OP-04 — CHANGED
- `WEB-itinvent/frontend/package.json:30`, `:52`, `:73`; `package-lock.json:4806-4807`, `:12971-12972`: manifest сейчас axios ^1.15.2, xlsx ^0.18.5, Vite ^7.3.2; lock фиксирует axios 1.21.0 и xlsx 0.18.5.
- Новый сетевой npm audit не запускался; прежние 24 пакета/11 high — исторический результат, не текущий счёт. Advisory reachability и исправление xlsx не подтверждены.

### OP-05 — CHANGED
- `WEB-itinvent/README.md:78-85`: явные cwd/config и защищённый ALEMBIC_DATABASE_URL вместо прежней неполной команды.
- Production migration не запускалась; другие рецепты README должны читаться с этим precondition. Это коррекция документации вне текущей сверки.

### AR-01 — OPEN
- `WEB-itinvent/backend/ai_chat/tools/context.py:7`; `WEB-itinvent/backend/ai_chat/tools/computers.py:123`, `:203`, `:220`, `:335`: импорты HTTP router/private helpers сохраняются.
- Transport → domain boundary по-прежнему обратная; circular import не доказывался. Нового рефакторинга/изолированной acceptance нет.

### AR-02 — OPEN
- `WEB-itinvent/backend/services/hub_service.py:1`; `WEB-itinvent/backend/chat/service.py:1`; `WEB-itinvent/frontend/src/components/chat/ChatContextPanel.jsx:1`: 10542 / 4442 / 4139 строк при свежем подсчёте.
- Числа совпали с первым реестром; концентрация orchestration остаётся. Размер не объявляется самостоятельным runtime bug; обязательная крупная перепись не предлагается.

## Предел вывода и следующие проверки

- Повторно прочитаны конкретные source paths всех 33 ID; модульные заметки использованы как указатели, старые статусы не копировались без code check.
- Новых broad tests, SQL/DML, network audit, Android/Desktop build и production acceptance не было.
- Ранее выполненные harness/SWR tests подтверждают только указанный узкий механизм; не превращены в CLOSED всего пользовательского сценария.
- Необходимы отдельные решения/проверки: SMTP ambiguous delivery; photo recovery по bytes и ledger availability; Scan long writer/grace и native hang; source tracking Desktop; новый dependency advisory audit.
- При дальнейшем изменении исходников проверять статус заново. Для deploy/restart/migration этот документ разрешения не даёт.
