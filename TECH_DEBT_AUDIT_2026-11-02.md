# Аудит HUB-IT — 2 ноября 2026

> **Продолжен 3 ноября 2026.** Актуальный результат — раздел «Второй проход», 19 модульных отчётов и [сверка исходных 33 пунктов](documentation/technical/audits/2026-11-02/INITIAL_FINDINGS_RECHECK_2026-11-03.md). Ниже сначала сохранена история первого прохода: её 33 пункта и результаты dependency audit нельзя считать неизменным текущим состоянием. Другие процессы вносили исправления; этому аудиту они не приписываются.

> **Исправления 3 ноября:** статус каждой находки, замер BE-06, что не сделано и шаги выкладки — в [REMEDIATION_STATUS_2026-11-03.md](documentation/technical/audits/2026-11-02/REMEDIATION_STATUS_2026-11-03.md). Ничего не выкачено и не закоммичено.

> **Дополнительный проход 3 ноября — Voice:** [четыре новые воспроизведённые находки DVOICE-01…04](documentation/technical/audits/2026-11-02/CONTINUATION_VOICE_2026-11-03.md): гонка отмены, удаление проекта при активном aux job, остановка продвижения архиватора и потеря TTL-привязки после ошибки archive marker. **1 High, 3 Medium; OPEN / R**, отдельно от исходных 33 ID. Код и production этим проходом не менялись. Уточнение достоверности: вступление remediation-отчёта и его раздел 1С противоречат друг другу по рестарту; текущая выкладка не подтверждена.

Главный вывод: обнаружены воспроизводимые дефекты целостности файлов и очередей, потеря контекста сессии, гонки кеша и повторная внешняя отправка. Их следует исправлять до расширения функциональности. Подтверждения отсутствия остальных ошибок или полной целостности production этот аудит не даёт.

В реестре **33 находки: 1 Critical, 16 High, 15 Medium, 1 Low**. Это число отдельных проблем текущей выборки, включая связанные механизмы с разными исправлениями; не оценка общего количества ошибок в репозитории. Отдельная гипотеза mail overload в этот счёт не включена.

## Область и достоверность

- Read-only исследование кода; единственное намеренное изменение исходного дерева — этот отчёт. Тесты создавали изолированные временные БД/каталоги. Production, `.env`, IIS, PM2 и данные пользователей не изменялись; деплоя и рестартов не было.
- Использованы `tech-debt-audit` и `diagnose`. По инструкции навыка большой репозиторий исследован четырьмя параллельными аудиторами: backend; frontend; Scan/Inventory; mobile/Desktop/bot/shared. Общая сводка проверена основным аудитором.
- Это выборочный инженерный аудит большого монорепозитория, а не построчная проверка каждого файла, pentest или нагрузочная приёмка.
- На момент подсчёта: 4 608 отслеживаемых исходных файлов, 1 133 242 строки Python/JS/TS/C#. Это размер, а не объём вручную прочитанного кода. Исключены tools/vendor/node_modules/dist и служебные каталоги навыков.
- Рабочее дерево уже содержало многочисленные изменения и новые файлы. Во время чтения `ItObjectDetail.jsx` менялся другим процессом; номера строк этого компонента повторно сверены. Это наблюдения текущего дерева, не атомарный снимок одного коммита. При финальной проверке HEAD: `da8f0915`.
- Прочитаны прежний `TECH_DEBT_AUDIT.md`, карта, правила тестирования, доменный контекст и релевантные ADR. Исторические записи о production не считаются текущим подтверждением. Старый отчёт сохранён.
- **R** — механизм воспроизведён на реальной функции/методе в изолированной среде; **S** — подтверждён чтением реализации и вызывающего кода; **H** — гипотеза, требующая отдельного сценария. R не означает воспроизведение полного пользовательского пути или инцидента в production.
- NEW означает запись текущего прогона без утверждения, что дефект появился после прошлого аудита. STILL OPEN/CHANGED указываются только там, где старый пункт сопоставлен с текущим кодом.

## Основные выводы

1. **OP-01, Critical при запуске на заполненной цели:** миграция Hub сначала фиксирует удаление данных, затем допускает пустой/несовместимый источник. Изолированно получен успешный выход с потерей всех 11 контрольных строк.
2. **BE-02, High:** сохранение контекста одной auth-сессии удаляет параллельно созданную другую сессию.
3. **SC-01/SC-02, High:** уборщик может удалить ещё не зарегистрированный PDF; старый владелец Scan-задания может завершить новую попытку и удалить её spool.
4. **BE-03, High:** старый обработчик task-email может отправить письмо и перезаписать результат уже новой попытки.
5. **BE-04/BE-05/FE-02:** загрузка фото допускает как повторную вставку после сбоя, так и успешный ответ со старым фото вместо новых bytes.
6. **FE-01, High:** обновление после мутации присоединяется к старому запросу и вновь кеширует устаревшие данные.
7. **SC-03, High:** перезапуски возвращают счётчик попыток Scan назад, сохраняя бесконечный crash-retry.
8. **BE-01, High:** mail executor не переносит ContextVar с текущей сессией, необходимый для AD-почты.
9. **OP-02/OP-03:** тестовые Scan-пути способны выбрать обычную БД из окружения; пять необходимых Desktop-исходников скрыты `.gitignore`.
10. **OP-04:** актуальный `npm audit --omit=dev` сообщил 24 уязвимых пакета: 11 high, 12 moderate, 1 low. Достижимость конкретных уязвимостей не проверена.

Также приоритетны **CL-01** — воспроизведённая повторная отправка акта после неоднозначного Telegram timeout — и **CL-02**, где медленный ответ мобильного мониторинга бесконечно отменяется последующими тиками.

## Архитектура по коду

React/Vite — общий web-клиент браузера и WPF/WebView2 Desktop. Expo Android — отдельный клиент. FastAPI backend обслуживает доменные API и интеграции SQL Server/1С; chat имеет отдельный runtime. App/chat используют PostgreSQL, legacy ITINVENT и фото — SQL Server. Telegram-бот разделяет часть хранения и сервисов с backend. Scan и Inventory — разные контуры агентов, очередей и обработки, их нельзя объединять при исправлениях.

Критическая сложность проходит по границам нескольких ресурсов: SQL Server и файловый checkpoint загрузки фото; spool и запись Scan job; snapshot и история Inventory; внешняя отправка и статус outbox. Локальный lock или атомарный первоначальный claim не обеспечивают целостность всей операции. Дополнительное архитектурное расхождение: AI tools импортируют приватные функции HTTP-router, а Scan по-прежнему создаёт схему при старте, хотя основной backend перешёл на Alembic.

## Находки: backend

Оценка трудоёмкости: S — локальное изменение; M — несколько связанных модулей и сценариев; L — согласование хранения/протокола и миграция. Это относительная оценка, не срок.

| ID / статус | Категория | Файл:строка | Уровень / трудоёмкость | Доказательство и последствие | Рекомендация |
|---|---|---|---|---|---|
| BE-01 NEW / R | Контекст запроса | `WEB-itinvent/backend/api/v1/mail.py:178`, `:188`; `WEB-itinvent/backend/services/mail_account_profile_resolver.py:41`; `WEB-itinvent/backend/services/mail_service.py:504` | High / S | `run_in_executor` не копирует ContextVar session ID. Реальная функция дала caller=session-A, worker=None. Режим primary_session не получает credential текущего AD-входа. | Передавать `copy_context().run`; проверить HTTP-путь AD-вход → mail/bootstrap и синхронизацию пароля. |
| BE-02 NEW / R | Гонки, целостность | `WEB-itinvent/backend/services/session_auth_context_service.py:80`, `:88`, `:104`, `:159` | High / M | Read-modify-replace всей таблицы: A и B читают старый снимок, B сохраняет свой и удаляет уже созданную A. Реальные методы с SQLAlchemy/SQLite оставили только B. | Адресный upsert/delete по session ID, cleanup отдельным ограниченным запросом; не синхронизировать всю таблицу при одной сессии. |
| BE-03 NEW / R | Outbox, гонки | `WEB-itinvent/backend/services/task_email_outbox_service.py:151`, `:195`, `:234`, `:251`, `:267` | High / M | Heartbeat проверяет лишь sending; ACK — только ID. Старый worker после reclaim принимает чужой claim за свой. Harness: touch=True, старый ACK изменил failed→sent. | Claim token во всех heartbeat/finalize UPDATE. Для неизвестного SMTP-результата отдельно определить запрет автоматической повторной отправки. |
| BE-04 NEW / R | Идемпотентность фото | `WEB-itinvent/backend/services/equipment_photo_upload_service.py:287`; `WEB-itinvent/backend/api/v1/equipment.py:4007`; `WEB-itinvent/backend/database/equipment_photos.py:382`; `WEB-itinvent/backend/database/connection.py:212` | High / L | Вставка фото уже committed до записи result.json. Ошибка записи маркера → retry вызывает второй INSERT. Callback вместо SQL, реальный complete: два вызова commit после OSError checkpoint. | Надёжный idempotency key, связанный с FILES, либо recovery ledger с поиском ранее выполненной операции. Схему и совместимость согласовать отдельно. |
| BE-05 NEW / R | Владение блокировкой | `WEB-itinvent/backend/services/equipment_photo_upload_service.py:32`, `:225`, `:267` | Medium / M | Lock complete истекает через 120 с без heartbeat; другой вызов может забрать его у ещё работающего первого. Первый finally удаляет чужой lock. Реальный acquire разрешил обоих после старения mtime. | Ownership token, heartbeat и удаление только своего lock либо межпроцессная блокировка. Не заменяет исправление BE-04. |
| BE-06 NEW / S | SQL, скорость | `WEB-itinvent/backend/services/session_auth_context_service.py:80`, `:164`, `:190`; `WEB-itinvent/backend/services/mail_service.py:5204` | Medium / M | Поиск одной сессии читает и сортирует все credential context: O(N) вместо lookup. Чтение с истёкшими записями дополнительно запускает полную перезапись. | SELECT по session_id/user_id/expiry; очистка вне request path. Baseline: SQL time, query count, p95 на одинаковом числе сессий. |

## Находки: frontend

| ID / статус | Категория | Файл:строка | Уровень / трудоёмкость | Доказательство и последствие | Рекомендация |
|---|---|---|---|---|---|
| FE-01 NEW / R | Кеш, гонки запросов | `WEB-itinvent/frontend/src/lib/swrCache.js:63`, `:107`, `:158`; `WEB-itinvent/frontend/src/pages/Networks.jsx:879` | High / M | Prefix invalidation удаляет готовый кеш, но сохраняет in-flight. Force-fetch после мутации ждёт старое чтение. Node: oldResult=OLD, afterMutation=OLD, newFetcherCalls=0, cached=OLD. | Поколение на ключ; отсоединять старое чтение и запрещать ему публикацию после invalidation. |
| FE-02 NEW / R | Целостность фото | `WEB-itinvent/frontend/src/lib/resumablePhotoUpload.js:73`, `:134`, `:158`; `WEB-itinvent/backend/services/equipment_photo_upload_service.py:162` | High / M | client_id зависит от metadata, не bytes. Файлы AAAA и BBBB с одинаковыми name/size/mtime дают один ID. Завершённая серверная сессия возвращает прежний file_no без загрузки второго файла. | Digest содержимого в идентификаторе и серверная проверка; учитывать детерминизм сжатия и восстановление существующих очередей. |
| FE-03 NEW / S | Polling, stale response | `WEB-itinvent/frontend/src/pages/ItObjectDetail.jsx:298`, `:311`, `:343`; `WEB-itinvent/frontend/src/api/client.js:242` | Medium / S | 15-секундный polling и refresh после привязки устройств перекрываются; response пишет state без версии. Старый ответ может восстановить удалённую привязку. Timeout клиента — 30 с. | Один polling в полёте, generation guard success/error/finally, обесценивание старого ответа при мутации. Браузерный repro не запускался. |
| FE-04 NEW / S | Устойчивость offline-очереди | `WEB-itinvent/frontend/src/lib/photoUploadQueue.js:70`, `:135`, `:229` | Medium / M | Любая ошибка IndexedDB навсегда переводит очередь в память без уведомления. Enqueue успешен, но закрытие вкладки теряет новое offline-фото; старые persistent записи не переносятся в memory-store. | Явный статус устойчивости, предупреждение о несохранённых файлах, обработка recoverable IDB ошибок и безопасное восстановление. |
| FE-05 NEW / S | Смена сессии, атрибуция | `WEB-itinvent/frontend/src/pages/database/usePhotoUploadQueue.js:16`; `WEB-itinvent/frontend/src/lib/photoUploadQueue.js:123`, `:143`, `:190`, `:256`; `WEB-itinvent/frontend/src/contexts/AuthContext.jsx:654` | High / M | User очереди задаётся карточкой; cleanup лишь снимает listener. Logout не останавливает очередь. После A→logout→B без открытия карточки retry A может уйти с cookie B при наличии у B прав. Сценарий статический, E2E не выполнен. | Привязать очередь к AuthContext/session generation, отменять upload при смене сессии; сохранять, но не исполнять чужие задания. |
| FE-06 STILL OPEN NEW-FE-02 / S | Запросы и объём данных | `WEB-itinvent/frontend/src/pages/Networks.jsx:752`, `:863`, `:1265`, `:1281` | Medium / M | После одной мутации refreshBranchContext делает 6 контекстных чтений и ещё список портов; limits sockets/ports — 10 000. Доказан fan-out, фактическое замедление не измерялось. | Патчить объект ответом мутации, адресно обновлять зависимости; сначала замерить число/объём запросов и p95 по одинаковому филиалу. |

## Находки: Scan и Inventory

| ID / статус | Категория | Файл:строка | Уровень / трудоёмкость | Доказательство и последствие | Рекомендация |
|---|---|---|---|---|---|
| SC-01 STILL OPEN NEW-SC-22 / R | Потеря PDF | `scan_server/database.py:3217`, `:1479`; `scan_server/worker.py:169` | High / M | PDF публикуется до INSERT job. Reconcile принимает его за orphan и удаляет. Harness: queued job принята без PDF, следующий reconcile failed_jobs=1. | Согласованная стадия staging/publication, защита незавершённой записи от уборщика. Простая перестановка операций оставляет другое окно сбоя. |
| SC-02 NEW / R | Lease, целостность результата | `scan_server/database.py:3298`, `:3620`, `:3792`; `scan_server/worker.py:240` | High / L | Recovery передаёт job новому worker, но старый finalize проверяет ID без token. Может перезаписать новую попытку, удалить её spool и создать дубли incidents. Reclaim + stale finalize воспроизведены. | Claim generation во всех writes и удалении payload, heartbeat для длинной обработки. |
| SC-03 CHANGED NEW-SC-03 / R | Бесконечный crash-retry | `scan_server/database.py:3338`, `:3410`; `scan_server/worker.py:169`, `:1031` | High / M | Startup recovery уменьшает attempts, claim не ограничивает их. Повторные crash/reclaim оставляют attempts=1. Обычный OCR timeout уже ограничен двумя попытками — прежнее общее описание слишком широкое. | Не уменьшать выданные попытки; ограничить recovery/claim и переводить исчерпанные задания в явный конечный статус. |
| SC-04 STILL OPEN NEW-SC-12 / R | Повторная обработка | `inventory_server/database.py:49`, `:94`; `inventory_server/__main__.py:28` | Medium / M | Конструктор любого store сбрасывает все processing→queued. Cleanup/vacuum создаёт store параллельно worker. Два экземпляра на временной SQLite повторно claim-нули один ID. | Recovery вне конструктора, по истёкшему lease/владельцу; отдельный maintenance-open без изменения статусов. |
| SC-05 NEW / S | История оборудования | `WEB-itinvent/backend/inventory_runtime.py:914`, `:927`, `:940`; `WEB-itinvent/backend/appdb/inventory_store.py:953`, `:1157` | High / L | Snapshot и change events пишутся раздельно. После успешного snapshot ошибка append лишь логируется; история теряется. Даже повтор payload сравнит уже новый snapshot и не восстановит diff. | Общая транзакция snapshot+events либо durable event intent до подтверждения обработки. Fault injection не запускался. |
| SC-06 CHANGED NEW-SC-08 / S | Переполнение памяти | `scan_server/app.py:133`, `:662`, `:1067`, `:1106`; `scan_server/config.py:299` | Medium / M | До ingest-семафора тело до 50 MiB уже целиком в памяти; ожидающие запросы удерживают bytes. JSON base64 не ограничен max_length. Порядок потребления сырых bytes — N×50 MiB, не измеренный пик процесса. | Admission до materialization, общий бюджет байтов, bounded ожидание и backpressure. Учесть IIS body limits, сейчас они не проверены. |
| SC-07 STILL OPEN AUD9-031 / S | Зависание OCR | `scan_server/worker.py:408`, `:497`, `:515` | Medium / L | future timeout не прекращает running native work. Windows thread pool сохраняет вычисление, retry добавляет работу; shutdown(wait=True) под lock может ждать бессрочно. | Общий процессный deadline/recycle и ограниченная остановка. Частные timeout Tesseract/LibreOffice снижают риск, но не заменяют общий deadline. |
| SC-08 STILL OPEN AUD9-037 / S | Миграции и runtime DDL | `scan_server/db.py:63`, `:70`, `:76`; `scan_server/database.py:923` | Medium / M | Startup выполняет CREATE SCHEMA, metadata.create_all и CREATE INDEX. Это расходится с принятой migration-only эксплуатацией; старт зависит от DDL-прав и может держать блокировки на заполненной БД. | Перенести создание в Alembic; runtime только проверяет версию/совместимость. Миграции применять отдельно по разрешению. |

## Находки: бот, мобильный клиент и Desktop

| ID / статус | Категория | Файл:строка | Уровень / трудоёмкость | Доказательство и последствие | Рекомендация |
|---|---|---|---|---|---|
| CL-01 NEW / R | Повторная внешняя отправка | `bot/handlers/transfer.py:90`, `:124`, `:1416`, `:1426` | High / M | Внутренний retry после Telegram TimedOut повторяет документ, уже принятый сервером. Durable sending checkpoint защищает следующий запуск, но не повторы внутри функции. Реальная AST-функция: function_result=True, accepted_deliveries=2. | После неоднозначного исхода delivery_unknown без автоматического resend; повторять только гарантированно неотправленные операции. |
| CL-02 NEW / S | Starvation запросов | `mobile-hub/src/screens/monitoring/NativeMonitoringScreen.tsx:49`, `:74`; `mobile-hub/src/monitoring/monitoringModel.ts:12`; `mobile-hub/src/api/client.ts:25` | High / S | Каждый 15-секундный tick отменяет предыдущий запрос и меняет generation. При стабильном ответе 16–29 с запросы никогда не завершаются, initial loading не снимается; timeout клиента 30 с не помогает. | Пропускать tick при in-flight либо планировать следующий poll после завершения. Сетевой repro на Android не запускался. |
| CL-03 NEW / S | Целостность отображения | `mobile-hub/src/screens/monitoring/NativeMonitoringDetail.tsx:86`, `:110`, `:143`, `:214` | Medium / S | При смене интерфейса/периода заголовок меняется сразу, история остаётся от прежнего. Ошибка нового запроса сохраняет старый график под новым контекстом. Guard generation защищает ответ, но не уже сохранённый state. | Хранить историю с ключом target/interface/hours; показывать только совпадающий ключ, иначе loading/empty. |
| CL-04 NEW / S | Фоновая нагрузка | `mobile-hub/src/screens/monitoring/NativeMonitoringDetail.tsx:89`, `:127`; `mobile-hub/src/screens/monitoring/NativeMonitoringScreen.tsx:71`; `mobile-hub/app/(shell)/_layout.tsx:29` | Medium / S | Таймеры detail/history зависят от mount и dependencies, не от focus/AppState. freezeOnBlur сохраняет вкладку, но в коде нет остановки таймеров карточки при переходе в другой раздел. Реальный расход батареи/сети не измерен. | Оба цикла привязать к focus и AppState, отменять запросы при потере активности; проверить на устройстве. |
| CL-05 NEW / S | Рост журнала, event loop | `bot/services/transfer_operation_store.py:77`, `:141`, `:157`; `local_store.py:439`; `bot/handlers/transfer.py:1417` | Medium / M | Каждый checkpoint читает все операции и переписывает весь документ через DELETE+INSERT; число операций и событий не ограничено в модуле. Вызов синхронный из async-handler. Цена растёт с полной историей, не одной операцией. | Адресная запись операции в существующем store; вынести blocking storage из event loop. Retention согласовать отдельно, без удаления истории по умолчанию. |
| CL-06 NEW / S | Неограниченное накопление | `desktop/Hub.Desktop/Transfers/DesktopSharedFileRegistry.cs:15`, `:25`, `:38`, `:111`, `:142`; `desktop/Hub.Desktop/Interop/DesktopBridgeHost.cs:251` | Medium / M | MaximumFiles=100 ограничивает одну регистрацию. Две map сохраняют новые пути/token весь срок жизни host без TTL/общего лимита и освобождения после загрузки. Tray-session может накапливать записи и старые разрешения чтения. | Освобождение использованных token, TTL/общий лимит и очистка при завершении сессии. Межпользовательская эксплуатация не проверена. |

## Находки: эксплуатация, целостность репозитория и архитектура

| ID / статус | Категория | Файл:строка | Уровень / трудоёмкость | Доказательство и последствие | Рекомендация |
|---|---|---|---|---|---|
| OP-01 STILL OPEN NEW-OP-01 / R | Разрушительная миграция | `scripts/migrate_hub_sqlite_to_postgres.py:25`, `:80`, `:82`, `:85`, `:99`; `WEB-itinvent/README.md:91` | Critical / M | DELETE зафиксирован до проверки таблиц/копирования. Пустая существующая SQLite допускается, пропуски таблиц считаются нулём, итог успешен. AST main с временными SQLite и заменой backend init: 11 целевых строк → 0, exit=0. Автозапуска не обнаружено; риск возникает при операторском запуске. | Dry-run по умолчанию, проверка полноты источника и цели, явный execute, отказ на заполненной цели без отдельного overwrite, атомарный перенос и backup. Не запускать для проверки на production. |
| OP-02 STILL OPEN NEW-OP-02 / S | Изоляция тестов | `tests/conftest.py:34`; `tests/test_scan_pg_compat.py:26`, `:42`, `:96`, `:111`; `scan_server/config.py:20`, `:167` | High / S | Conftest изолирует APP/CHAT/Inventory, но не SCAN_DATABASE_URL. PG-тесты выбирают обычный URL, делают INSERT/DELETE, а claim_next_jobs(10) может захватить и чужие queued jobs. dotenv способен подставить runtime URL. | Только SCAN_TEST_DATABASE_URL, fail-closed guard тестовой цели и изоляция набора jobs; обычный runtime URL обнулять до импорта config. Опасные тесты не запускались. |
| OP-03 STILL OPEN NEW-OP-03 / S | Воспроизводимость Desktop | `.gitignore:11`; `desktop/Hub.Desktop/MainWindow.xaml.cs:18`, `:114` | High / S | Правило downloads/ скрывает Desktop/Downloads. На диске есть 5 C# файлов, `git ls-files desktop/Hub.Desktop/Downloads` пуст, git check-ignore подтверждает игнорирование. MainWindow использует namespace и типы этих файлов. | Узкое исключение для source-каталога; включить необходимые исходники в контроль версий по отдельному запросу. Чистый clone/build не выполнен, точная ошибка компилятора не утверждается. |
| OP-04 CHANGED NEW-OP-05 / S | Зависимости | `WEB-itinvent/frontend/package.json:26`, `:30`, `:46`, `:52`; `WEB-itinvent/frontend/package-lock.json:1` | High / M | npm audit --omit=dev: 24 уязвимых пакета, 11 high / 12 moderate / 1 low, critical=0, exit=1. В отчёте есть axios, xlsx и транзитивные зависимости. Это число пакетов, не число независимых CVE. | Адресно разобрать advisory, используемые возможности и цепочки; обновлять с регрессией соответствующих сценариев. Не выполнять audit fix --force. |
| OP-05 NEW / S | Документация релиза | `WEB-itinvent/README.md:78`, `:82`; `WEB-itinvent/backend/alembic/env.py:39` | Low / S | README предлагает bare alembic upgrade head, но env.py намеренно запрещает URL из .env и требует явную цель. Команда не является готовой инструкцией релиза. | Согласовать README с runbook, использовать защищённую ALEMBIC_DATABASE_URL без секретов в CLI. Защиту env.py сохранить. |
| AR-01 NEW / S | Нарушение слоёв | `WEB-itinvent/backend/ai_chat/tools/computers.py:123`, `:203`, `:220`; `WEB-itinvent/backend/ai_chat/tools/context.py:7`; `docs/adr/0003-chat-backend-module-layout.md:38` | Medium / M | Домен AI tools импортирует HTTP-router и приватные inventory helpers. Изменение transport может сломать background tools; изолированная проверка требует загрузки API-модуля. Это обратная зависимость, не доказанный circular import. | Извлечь конкретные read/normalization helpers в существующий service/store слой, оставить совместимые адаптеры; без переписывания всего модуля. |
| AR-02 CHANGED AUD9-034/035 / S | Концентрация ответственности | `WEB-itinvent/backend/services/hub_service.py:1`; `WEB-itinvent/backend/chat/service.py:1`; `WEB-itinvent/frontend/src/components/chat/ChatContextPanel.jsx:1`; `docs/adr/0003-chat-backend-module-layout.md:46` | Medium / L | hub_service — 10 542 строки, ChatService — 4 442 при цели ADR 800–1200, ChatContextPanel — 4 139. Файлы одновременно большие и часто меняются. Размер сам по себе не баг; долг — сохраняющаяся концентрация orchestration и зависимостей вопреки принятому разделению. | При исправлении конкретных дефектов выносить один cohesive сценарий за раз с boundary-проверкой; отдельный масштабный рефакторинг не требуется для закрытия большинства находок. |

## Проверки и результаты

| Проверка | Фактический результат | Предел вывода |
|---|---|---|
| AST Python без импорта приложений | 1 539 файлов разобраны, syntax errors=0 | Не проверяет отсутствующие импорты, runtime и бизнес-логику; были SyntaxWarning о строковых escape в тестах. |
| Маркеры merge conflict в исходниках/JSON/Markdown | Не обнаружены в отобранных файлах | Не заменяет проверку семантики merge и бинарных артефактов. |
| App/chat Alembic, AST revision/down_revision | 156 ревизий, один head `20261030_0153`, нет дублей и отсутствующих родителей | Включены новые файлы текущего дерева. Upgrade/downgrade и живая схема не проверены. |
| Scan Alembic, тот же анализ | 2 ревизии, один head `20260917_0002`, нет дублей/пропущенных родителей | Не означает совместимость ORM и production. |
| `python -m pytest -q tests/test_outbox_crash_recovery.py` | **22 passed, 4 warnings**, 12,63 с, exit=0 | APP/CHAT перенаправлены conftest на SQLite; SCAN_DATABASE_URL принудительно пустой; live opt-in выключен. При atexit pytest получил WinError 5 при cleanup старого pytest-current вне репо. Assertions прошли, очистка окружения не полностью успешна. |
| Backend diagnostic harness | 5 успешных воспроизведений: ContextVar, lost session, stale email owner, photo checkpoint, stale photo lock | AST-методы/реальная функция, SQLite memory/temp, callbacks вместо внешних отправок и SQL Server. Это не E2E. |
| Frontend Node diagnostic harness | 2 успешных воспроизведения: старый SWR после invalidation; одинаковый photo ID для разных bytes | Функции, без браузерного lifecycle и UI-приёмки. |
| Scan/Inventory diagnostic harness | 3 успешных сценария: spool race; второй store повторно claim; stale finalize + rollback attempts | Временные SQLite/каталоги; финальные прогоны exit=0. Первые cleanup попытки на Windows упали из-за handles; исправление harness и закрытие соединений дали штатную очистку. |
| Telegram diagnostic harness | Реальная функция retry: два принятых документа после потери первого ответа | Транспорт заменён, отправок настоящим пользователям не было; воспроизведён механизм ambiguous timeout. |
| Migration diagnostic harness | Реальный control flow main: пустой источник, 11 целевых строк удалены, exit=0 | Backend init заменён, только временные SQLite; миграция против PostgreSQL не запускалась. |
| `git diff --check` | exit=0, есть уведомления LF→CRLF | Не доказывает корректность чужого diff. |
| `npm audit --omit=dev --json --fetch-timeout=15000 --fetch-retries=0` | exit=1 из-за найденных advisories, не из-за сетевого сбоя; 24 пакета | Реестр зависимостей; не тест эксплуатируемости приложения. |
| Целостность Desktop source tracking | 5 необходимых Downloads/*.cs на диске игнорируются и отсутствуют в git ls-files | Сборка чистого клона не запускалась. |

## Приоритетные исправления

1. **OP-01 — остановить небезопасное применение одноразовых миграторов.** Сначала проверить источник и количество строк, затем dry-run с явной целью. Стирание и копирование должны иметь общий rollback; лучше отказаться от overwrite без отдельного флага. Проверка: пустой/неполный источник не меняет существующую цель, ошибка посередине сохраняет прежние данные.
2. **SC-01/SC-02/SC-03 — целостность Scan.** Ввести согласованный staging, token каждой попытки, token-guard результата и удаления PDF, необратимый счётчик попыток. Проверка: writer/reconcile, old/new owner и crash-recovery с финальной сверкой bytes/hash и единственности результата.
3. **BE-02/BE-06 — адресные auth-context операции.** Убрать load-all/replace-all; upsert по session ID, delete только своей/истёкшей сессии. Проверка: два одновременных входа и очистка expiry не удаляют чужую активную сессию; замер SQL time/query count до/после.
4. **BE-03 — владение task email.** Claim token передать heartbeat/send-result/failure, исключить старый ACK. Сценарий неизвестного SMTP-исхода требует отдельного решения; исправление БД само по себе не обеспечивает exactly-once во внешней системе.
5. **BE-04/BE-05/FE-02 — корректность фото.** Digest bytes и durable completion, связанный с idempotency key; затем token-lease. Проверка: crash после INSERT, медленный commit дольше lease и два разных файла одинаковых metadata дают правильные bytes и одну запись на одну логическую загрузку.

Следующие короткие изменения: FE-01 (кеш после мутации) и BE-01 (перенос ContextVar). Они локальнее, чем исправления схемы хранения, и имеют уже воспроизведённый сигнал.

## Быстрые улучшения

- [ ] BE-01: перенос контекста в executor и проверка AD-почты через API.
- [ ] FE-03: последовательность ответов и один polling in-flight в MonitoringTab.
- [ ] CL-02: не отменять медленный запрос каждым автоматическим tick мобильного мониторинга.
- [ ] OP-02: закрыть выбор обычного SCAN_DATABASE_URL в тестах до любых широких pytest-прогонов.
- [ ] OP-03: узкое исключение `.gitignore` для Desktop исходников, проверить чистую сборку.
- [ ] OP-05: исправить неполную команду Alembic в README.

## Что выглядит подозрительно, но не признано дефектом

- `scan_server/database.py:3417`: начальный PostgreSQL claim использует SKIP LOCKED и RETURNING. Сам claim атомарен; SC-02 относится к восстановлению и завершению старого владельца.
- `scan_server/worker.py:1031`: обычный OCR timeout ограничен двумя попытками. Бесконечность SC-03 доказана для повторных process crash/recovery, не для каждого штатного timeout.
- `WEB-itinvent/frontend/src/lib/chatSocket.js:1168`: просроченные request_id пропускаются; утверждение об их обязательном повторном исполнении отвергнуто. На `:1111` уже есть warning при переполнении; sendMessage/markRead требуют open socket, поэтому нельзя автоматически считать shift потерей пользовательского сообщения.
- `scan_server/realtime.py:67`: SSE несёт invalidation, не сами документы. Переполнение само по себе не доказательство потери бизнес-данных; нужно проверять последующий resync.
- `scan_agent/agent.py:1398`: переполненные outbox элементы переходят в dead-letter с причиной, а не исчезают молча.
- `WEB-itinvent/frontend/src/components/addressBook/useDocflowAbsenceMarks.js:1`: active/AbortController и userKey защищают личные пометки от старого ответа; гонка между пользователями здесь не подтверждена.
- `WEB-itinvent/backend/alembic/env.py:39`: отказ от неявного production URL — полезная защита. Ошибка находится в документации команды, не в этой проверке.
- Пройденный `tests/test_outbox_crash_recovery.py:1` подтверждает покрываемые им push/chat outbox сценарии. Его результат нельзя распространять на отдельный task-email outbox из BE-03.
- `local_store.py:484`: раздельные load/save в update_json_array сами по себе подозрительны, но действующий caller в просмотренных подсистемах не найден. Потеря данных в production через этот метод не утверждается.

## Открытые риски и ограничения

- **H, mail overload:** `WEB-itinvent/backend/api/v1/mail.py:432` освобождает semaphore при отмене request, хотя SOAP thread продолжает работу (`:455`). Executor `:165` использует стандартную очередь без явной границы. Нужен cancellation/stress harness; возможное накопление работы пока не включено в подтверждённые дефекты.
- Не проводились PostgreSQL/SQL Server integrity checks: FK/orphans/duplicates, consistency snapshot, BLOB/PDF hashes production, проверка свободного места/locks. Целостность данных production остаётся непроверенной.
- Не измерялись production p50/p95/p99, RSS, event-loop lag, SQL execution time и профили очередей. FE-06/BE-06/SC-06 — подтверждённые структуры затрат/ресурсных рисков, а не численная оценка текущей задержки или OOM в production.
- Полный backend/frontend suite, браузерный E2E, clean Desktop build, Android build и release-приёмка не запускались. Широкий pytest особенно нежелателен до OP-02. `npm run build` не выполнялся: live dist не затрагивался.
- Python CVE audit, статический dead-code/circular-dependency анализ специализированными утилитами и полный анализ dependency manifests всех клиентов не выполнены. Инструменты не устанавливались.
- Не проверены текущий запуск optional workers, фактическая схема chat/public и применённые production миграции. Статическая цепочка ревизий не заменяет проверку схемы.
- Старые находки, не перечисленные с текущими доказательствами, не закрыты и не переподтверждены автоматически. Сравнение с прежним аудитом выборочное.

## Отдельные действия после аудита

Этот файл содержит план исправлений, но не разрешение их применять. Для исправления нужен отдельный запрос; для изменения production, миграций, конфигурации, рестартов и деплоя — отдельное согласование конкретной операции с rollback и post-check. Сам отчёт развёртывания не требует.

---

## Второй проход: подробный разбор по модулям

Продолжение по запросу пользователя: каждый доменный модуль рассматривается отдельно, включая frontend/backend/worker/store и вызывающие контуры. Подробности вынесены в `documentation/technical/audits/2026-11-02/modules/`; этот раздел является общим планом и индексом. Исходный реестр 33 находок выше — история первого прохода, а не неизменный текущий список: другие процессы продолжают менять исходники. Текущие уточнения и статусы в этом разделе и модульных отчётах имеют приоритет.

Для каждого модуля фиксируются: границы и точки входа; путь данных; обязательные инварианты; проверенные сценарии; находки с доказательствами; конкурентные переходы; лимиты памяти/очередей/соединений; существующие тесты и пробелы; план минимальных исправлений и их приёмки; отвергнутые гипотезы; непроверенные внешние зависимости. Наличие отчёта не означает полной динамической приёмки модуля.

### Матрица модулей

| № | Модуль | Отчёт | Состояние второго прохода |
|---|---|---|---|
| 01 | Auth, sessions, settings, permissions, AD users/groups | [01-auth-settings.md](documentation/technical/audits/2026-11-02/modules/01-auth-settings.md) | Разбор 02.11 + уточнение 03.11; 2 старых механизма изменены |
| 02 | Оборудование, База, фото, акты, перемещения | [02-equipment.md](documentation/technical/audits/2026-11-02/modules/02-equipment.md) | Разбор 02.11 + уточнение photo recovery/locks/digest 03.11 |
| 03 | Warehouse 1C, каталог, остатки, сверка | [03-warehouse-1c.md](documentation/technical/audits/2026-11-02/modules/03-warehouse-1c.md) | Разбор записан; SQL/COM production не вызывались |
| 04 | Задачи, лента, участники, уведомления | [04-tasks-feed.md](documentation/technical/audits/2026-11-02/modules/04-tasks-feed.md) | Разбор записан; task-email guard уточнён 03.11 |
| 05 | Tickets, строительство, работы, VCS | [05-tickets-construction.md](documentation/technical/audits/2026-11-02/modules/05-tickets-construction.md) | Разбор записан; import/workflow и rollback gaps |
| 06 | Chat, WebSocket, realtime, attachments, push | [06-chat-realtime.md](documentation/technical/audits/2026-11-02/modules/06-chat-realtime.md) | Разбор записан; split-runtime E2E не выполнялся |
| 07 | HUB Assistant, AI tools, LLM gateway, sandbox | [07-ai-llm.md](documentation/technical/audits/2026-11-02/modules/07-ai-llm.md) | Разбор записан; ordinary Assistant и OpenCode разделены |
| 08 | Mail/Exchange, отправка и кеши | [08-mail.md](documentation/technical/audits/2026-11-02/modules/08-mail.md) | Разбор 03.11; потеря ContextVar уже изменена |
| 09 | Docflow/DMService, адресная книга, структура | [09-docflow-directory.md](documentation/technical/audits/2026-11-02/modules/09-docflow-directory.md) | Разбор 03.11; реальные ДО/ЗУП не вызывались |
| 10 | My Files, публичные ссылки, previews, KB, vault | [10-files-kb-vault.md](documentation/technical/audits/2026-11-02/modules/10-files-kb-vault.md) | Разбор 03.11; chunk/reveal воспроизведены изолированно |
| 11 | Сети, мониторинг, IT-объекты, MFU/discovery | [11-networks-monitoring.md](documentation/technical/audits/2026-11-02/modules/11-networks-monitoring.md) | Разбор 03.11; прежние SWR/polling изменены |
| 12 | Scan server/agent, spool, OCR, review | [12-scan.md](documentation/technical/audits/2026-11-02/modules/12-scan.md) | Разбор 03.11; старые recovery/grace/DDL guards перепроверены |
| 13 | Inventory ingest/runtime, Windows agent | [13-inventory-agent.md](documentation/technical/audits/2026-11-02/modules/13-inventory-agent.md) | Разбор 03.11; dead-letter и double claim воспроизведены |
| 14 | Expo Android, native APIs/cache/lifecycle | [14-mobile.md](documentation/technical/audits/2026-11-02/modules/14-mobile.md) | Разбор 03.11; физический Android не проверен |
| 15 | Desktop WPF/WebView2, bridge/update/transfers | [15-desktop.md](documentation/technical/audits/2026-11-02/modules/15-desktop.md) | Разбор 03.11; clean clone/build и GUI не проверены |
| 16 | Telegram bot, transfer checkpoint, OCR/export | [16-bot.md](documentation/technical/audits/2026-11-02/modules/16-bot.md) | Разбор 03.11; старые retry/journal изменены |
| 17 | Voice/video, FS egress, Bitrix/1C integration sources | [17-integrations.md](documentation/technical/audits/2026-11-02/modules/17-integrations.md) | Разбор доступного кода; BSL отсутствуют, внешний CMS непроверен |
| 18 | Общая frontend-платформа, routing/cache/offline/SW | [18-frontend-platform.md](documentation/technical/audits/2026-11-02/modules/18-frontend-platform.md) | Разбор записан; SWR статус уточнён 03.11, legacy bridge условный |
| 19 | Данные, SQL pools, Alembic, миграторы, PM2/test isolation | [19-infrastructure-data.md](documentation/technical/audits/2026-11-02/modules/19-infrastructure-data.md) | Разбор записан; live readiness/DDL/backup не проверены |

### Текущие уточнения к первому проходу

- **OP-01, Hub-мигратор:** в текущем дереве появились `--execute`, `--overwrite`, проверка полноты/пустоты источника и одна транзакция удаления+копирования. Эти изменения сделаны вне этого аудита. Четыре локальных теста мигратора прошли; исходный сценарий случайного стирания через этот файл больше не соответствует текущей реализации. Другие одноразовые миграторы проверяются отдельно и автоматически исправленными не считаются.
- **OP-02, Scan tests:** текущие conftest и PG-тесты используют `SCAN_TEST_DATABASE_URL` и guard тестового имени. Локальный прогон без test URL дал три passed/two skipped для Scan; реальный PG roundtrip не выполнялся. Предыдущая запись о прямом использовании обычного SCAN_DATABASE_URL устарела для этих файлов.
- **OP-03:** добавлено исключение `.gitignore` для Desktop Downloads; факт попадания всех необходимых source-файлов в переносимый checkout и clean build проверяется в отчёте Desktop. Изменение ignore само по себе не является проверкой сборки.

### Верификация второго прохода

- `tests/test_migrate_hub_sqlite_script.py tests/test_scan_pg_compat.py`: 7 passed, 2 skipped, 4 warnings, 14,23 с, exit=0. APP/CHAT/Inventory — изолированные fixtures; SCAN URL и test URL принудительно пустые. Atexit pytest снова сообщил WinError 5 при очистке старого pytest-current вне репозитория.
- Frontend cache/chunk/offline профиль: 15 passed, 1 failed (timeout динамического импорта analytics, 15 с), exit=1. Изолированный повтор только этого теста с лимитом 45 с: 1 passed, 4 deselected/skipped по фильтру, 4,19 с, exit=0. Это ограничение/нестабильность времени тестового импорта; исходный общий прогон не объявляется полностью зелёным.

### Результат продолжения 3 ноября

Записаны все 19 запланированных модульных разборов. Они содержат более 3 300 строк анализа, карты вызовов, инварианты, сценарии, R/S/H-доказательства, ограничения и приёмку. Объём документа не равен доле построчно прочитанного миллиона строк: coverage lists и непроверенные подмодули указаны в каждом файле. Полный live stack, физические клиенты, BSL и внешний CMS не объявляются проверенными.

Для исходных 33 ID выполнена [отдельная свежая сверка](documentation/technical/audits/2026-11-02/INITIAL_FINDINGS_RECHECK_2026-11-03.md): **30 CHANGED, 3 OPEN, 0 CLOSED**. CHANGED включает частичные изменения и оставшиеся риски; это не «30 исправлено». OPEN в исходном наборе — FE-06, AR-01, AR-02. Новые модульные находки имеют собственные ID и не включены в эти 33. Повторяющиеся механизмы и гипотезы нельзя складывать как независимые подтверждённые баги.

### Очерёдность исправлений по результатам углубления

Это план следующей реализации, а не разрешение менять код или production. Порядок учитывает риск потери данных/доступа; внутри одного этапа независимые изменения можно реализовывать отдельно.

| Этап | Задача и ID | Минимальный объём | Обязательная приёмка |
|---|---|---|---|
| 1 | Одноразовый backup code и отзыв доступа: DAUTH-03/04/09, DCHAT-01/02/03, DBOT-01, DMOB-01 | CAS consume, согласованная revocation, проверка действующих прав на границах, надёжный credential cleanup | Два входа одним кодом → один успех; revoke действует на REST/WS; прямой bot entry запрещён; offline logout + cold start не восстанавливает пригодные credentials |
| 2 | Целостность файлов: DFILE-01/02/03/04, DCHAT-04/05, DMOB-02 | Сериализация chunk, ownership staging, атомарный blob ref_count, token worker, cleanup после подтверждённого commit | Параллельные chunks/дедуп/detach/cancel/crash → одна корректная версия bytes; каждый принятый файл нормально скачивается и совпадает SHA-256 |
| 3 | Надёжный исход внешнего действия: DMAIL-01 и связанные send findings, DDOC-01/02/03, DAI-02/08 | Intent/correlation, CAS confirm/cancel, status-check recovery; ambiguous outcome отдельно от failed | Потеря ответа после принятой отправки/записи не приводит к повтору; cancelled не маскирует выполненный эффект; pending восстанавливается по факту |
| 4 | Durable очередь агентов и egress: DSCAN-01, DINV-01/02, DINT-02/03 | Handoff pending→dead до unlink, межпроцессный claim, metadata failure isolation | Дисковый отказ сохраняет исходный payload; два store не берут одну задачу; недоступный файл не завершает monitor |
| 5 | Сверка и бизнес-состояние: DWH-01/03, DEQP-04, DBIZ-01/03/04, DBOT-02/03/05 | Составной DB+owner key, fail-closed completeness, CAS статусов, актуальный словарь import, scope/version work-команды | Разные БД с одинаковым PK не смешиваются; verify/reject не истинны одновременно; imported ticket виден/валиден в workflow; partial write не выглядит полным success |
| 6 | Реальные deadlines и backpressure: DMAIL overload, DINT-01, DSCAN-02/04, DAI-06/07 | Admission до чтения тела, bound queue/bytes, supervisor независимо от stdout, один retry budget | Slow/cancel/silent/flood сценарии держат фактическую concurrency/память и deadline в согласованном бюджете; принятые операции не пропадают |
| 7 | Согласованное UI-состояние: DTASK realtime/checklist, DWH movements, DFILE-08, DMOB-03/04, DNET MFU | Request/session generation, filter membership, отмена lifecycle и адресный cache update | Overlap, A→B, logout, unmount, delete/snapshot/reconnect не публикуют старые данные, файлы или secret |
| 8 | Эксплуатация и воспроизводимость: DOPS-01/02/03, DDESK-01/02/03, DINT-04/05/06 | Безопасные остальные миграторы, pool discard/create lock, tracked sources, owner cleanup, явное storage policy | Dry-run и rollback сохраняют цель; broken conn не возвращается; чистый checkout собирается; closed окна/скачивания освобождаются; production fallback запрещён по принятой политике |

Уточнения перед реализацией, где требуется решение владельца: политика admin reset/revocation; статус неизвестного SMTP/DMService результата; хранение idempotency/correlation в нескольких БД; контракт нескольких action cards на одно сообщение; источники BSL и внешнего CMS. Остальные обратимые детали не требуют отдельного проектирования новой инфраструктуры. Redis/Docker/новый брокер в плане не предлагаются.

### Конкретные проверки каждого следующего исправления

1. Выбрать один ID и прочитать текущий caller/source заново: рабочее дерево продолжает меняться.
2. Получить воспроизведение на подходящей boundary; для race/crash допустим узкий harness с явным interleaving, для UI — локальный сценарий пользователя.
3. Зафиксировать ожидаемый final state: rows/status/permissions + bytes/hash + выдача пользователю. Одного успешного HTTP или зелёного unit helper недостаточно.
4. Внести минимальный diff и выполнить только затронутый профиль. Performance — baseline и сравнение на тех же данных, не оценка по размеру исходников.
5. В этом плане/модульном отчёте указать фактические файлы, результат, ограничения и статус «локально проверено». Production migration/restart/deploy — отдельная операция с rollback и post-check.

### Реестр выполненной верификации углубления

| Контур | Проверки | Итог и предел |
|---|---|---|
| Auth | refresh recovery, authorization, TOTP | 15 passed, 5 warnings; backup-code race/auth-context/env probes отдельно R. Windows atexit cleanup warning |
| Tasks/Tickets/Construction | status, journal progress, observers, participants | 50 passed, 4 warnings; realtime filter Node probe отдельно R. Windows atexit cleanup warning |
| Chat | upload store/transfer/completion, WS session lifecycle | 22 passed, 2 warnings; split-store upload/scheduled probes отдельно R; два live узла не запускались |
| AI | run watchdog/retry, mail recipients | 30 passed, 4 warnings; confirm/cancel и card projection probes R; внешние tools/LLM не вызывались |
| Mail/Docflow | DMService client | 25 passed, 1 warning; mail semaphore cancellation peak=4 при limit=1 и docflow reconcile probes R; Exchange/ДО не вызывались |
| Scan/Inventory | конкретные recovery/stale owner/OCR deadline, Inventory queue, agent backpressure; отдельный grace test | 26 passed в двух непересекающихся запусках; один профиль с WinError 5 atexit cleanup; новые agent/file/claim probes R |
| Mobile | 5 узких Jest suites | 35 passed, 2 act warnings; SecureStore/part/player TS-VM probes R; физический Android не проверялся |
| SWR | актуальный swrCache.test.js и Node probe | 6 passed, cached=NEW; старый DFE-01 изменён извне |
| Frontend общая платформа | cache/chunk/offline | Исходный профиль 15 passed/1 timeout failed; exact повтор 1 passed, остальные отфильтрованы; общий профиль не переписан в passed |
| Infra/Scan isolation | Hub мигратор + Scan compatibility | 7 passed, 2 PG skipped; временные SQLite; production и PostgreSQL не проверялись |
| FS egress | test_fs_egress_core.py | 5 passed, 1 failed на UNC PermissionError; suite не зелёный, причина разобрана как DINT-03 |
| Bot/Voice/SQL pools | изолированные реальные AST функции | Воспроизведены work SQL failure→success, отсутствие retry после timeout, late Voice cancel, потеря egress pending, broken pool reuse, engine init race. Metadata race probe не засчитан как R |

Результаты профилей не складываются в единый «весь репозиторий прошёл»: часть запусков относится к разным снимкам исходников, встречаются повторные проверки и отдельные failures/skips. Модульные файлы содержат команды и точные границы.

### Что остаётся непроверенным

- Production consistency: FK/orphans/duplicates, применённая схема/индексы, реальные PDF/BLOB bytes, restore из backup, свободное место/locks и live effective configs.
- End-to-end на реальных Exchange/1С/AD/Telegram/AV, двух Chat узлах, Android и Desktop. Внешние действия/отправки не выполнялись.
- Полная построчная проверка ML/voice_video, всех AI tools/OpenCode executor и внешнего Bitrix/OneBoat; BSL source отсутствуют в доступном checkout. Это явные границы, не подтверждение отсутствия ошибок.
- Текущий итог dependency advisories после внешних обновлений: исторические 24 пакета из первого audit не обновлялись новым сетевым npm/pip audit.
- Production p95/p99/RSS/SQL-планы: синтетические наблюдения, включая scheduler на 1000 целей, не являются production-SLO.

Изменения этого продолжения — только этот план, 19 модульных Markdown и файл повторной сверки. Исходники, БД, окружение, Git staging/коммиты, процессы и публикация этим аудитом не менялись. Для документации deployment не нужен.

### Дополнительная проверка Voice — 3 ноября

В [CONTINUATION_VOICE_2026-11-03.md](documentation/technical/audits/2026-11-02/CONTINUATION_VOICE_2026-11-03.md) добавлены DVOICE-01…04 со ссылками на код, воспроизведениями и критериями исправления. Реальные FastAPI-роутеры/store/архиватор проверялись на временных SQLite и файлах; гонка отмены задавалась контролируемым interleaving. Harness: 4 дефекта в 6 сценариях и 1 отвергнутая гипотеза; исходники по SHA-256 неизменны. Существующий профиль `tests/test_voice_server.py -k 'archiver or worker'`: **7 passed, 58 deselected, 2 warnings**, exit 0. Production PostgreSQL, активный ML worker и фактическое включение архивирования не проверены; исправлений и выкладки нет.
