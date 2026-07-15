# Контракт интеграции 1С ↔ HUB

## Назначение и граница записи

Этот контур предназначен для **чтения** справочников, остатков, движений и
вложений из 1С и для сверки их с карточками имущества HUB.

HUB **не создаёт и не проводит документы в 1С**. Любое изменение в рамках
сверки относится только к app-owned registry и legacy-проекции `ITEMS.PART_NO`
в HUB. Будущий исходящий контур в 1С допускается исключительно отдельным
проектом: outbox, идемпотентный адаптер, подтверждение проведения и отдельное
право доступа.

| Область | Источник истины |
|---|---|
| Учётные/физические остатки, склад, движения | 1С Бухгалтерия (`buh20`) |
| IT-карточка, `ITEMS.ID`, владелец, внутренний процесс передачи | HUB / SQL Server |
| Подтверждённые связи 1С и HUB, аудит решений | app-owned PostgreSQL |
| Акт без проведения | Документ HUB; не меняет владельца имущества |

## Идентификаторы и гранулярность

Ни ФИО, ни наименование номенклатуры не являются ключом. ФИО используется
только для предложения кандидата и никогда не создаёт связь автоматически.

- Карточка HUB: неизменяемый `ITEMS.ID` в пределах `hub_db_id`.
- Номенклатура 1С: `nomenclature_ref`; отображаемый код сохраняется только как
  снимок для диагностики.
- Склад 1С: `warehouse_ref`.
- Базовая строка сверки: `(source_base, nomenclature_ref, warehouse_ref)`.
- Серии, характеристики и партии суммируются в `qty_1c_total`, но сохраняются
  в детализации с `source_row_count`.
- Сотрудник ЗУП: `EmployeeCode`/ref связывается с владельцем HUB отдельно от
  склада. Статус занятости дополняет связь, но не определяет её.

## App-owned registry

Миграция `20260713_0063` создаёт таблицы решений в схеме `app` PostgreSQL:

| Таблица | Назначение |
|---|---|
| `one_c_item_links` | Кандидат или подтверждённая связь `hub_db_id + ITEMS.ID + source_base`; `pending`, `linked`, `excluded`, `invalid`, версия и проверяющий |
| `one_c_warehouse_owner_links` | Подтверждённая связь склада 1С с владельцем HUB; несколько складов у владельца допустимы; версия решения |
| `one_c_employee_owner_links` | Отдельная связь сотрудника ЗУП и владельца HUB; версия решения |
| `one_c_reconcile_events` | Неизменяемый журнал before/after, причины, исполнителя и correlation ID |

Обновление любой связи выполняется через CAS: `expected_version` входит в
условие `UPDATE`, а попытка создать версию `0` защищена уникальным ключом.
У одного склада может быть несколько исторических решений, но только один
`active` владелец для `(source_base, warehouse_ref, hub_db_id)`; прежде чем
назначить другого, текущее решение нужно явно деактивировать с причиной.

`PART_NO` остаётся только legacy-проекцией подтверждённой связи, пока все
потребители не переведены на registry. Миграция выполняется сначала как preview:

`POST /api/v1/warehouse-1c/reconcile/migrate-legacy?dry_run=true`

Применение требует администратора, `database.write`,
`warehouse_1c.reconcile.write`, `confirm=true` и включённый
`WAREHOUSE_1C_RECONCILE_REGISTRY_WRITE_ENABLED=1`. Валидные старые коды
становятся `pending`, сентинел «нет в 1С» — `excluded` с причиной; некорректные
значения помечаются `invalid`.

### Индексируемый каталог 1С

Миграция `20260713_0064` добавляет read-only копию каталогов 1С:
`one_c_catalog_snapshots`, `one_c_catalog_entries` и
`one_c_catalog_tokens`. Первая загрузка атомарно публикует полное поколение.
Последующие загрузки сравниваются по fingerprint и в одной MVCC-транзакции
меняют только добавленные, удалённые или изменённые ref и их токены; читатели
никогда не видят частичный каталог. Это не допускает повторной записи миллионов
неизменившихся токенов и нагрузки на WAL из-за одной новой позиции. Токены и
ref индексируются в app storage, поэтому backend не строит полный Python
token-index при каждом старте.

Read-only COM bridge прогревается в фоне при запуске backend. Поиск склада
сотрудника возвращается отдельно от живых остатков: интерфейс показывает
найденный склад сразу, а остатки догружает вторым запросом.

`WAREHOUSE_1C_CATALOG_APP_STORAGE=auto` использует этот snapshot, когда
настроен `APP_DATABASE_URL`. Значение `0`/`false` оставляет JSON cache как
контролируемый rollback/fallback, не меняя read-only границу 1С.

## Права и подтверждение

- Чтение требует `warehouse_1c.read`.
- Изменение связи требует одновременно `warehouse_1c.reconcile.write` и
  `database.write`.
- Для обычного пользователя сервер всегда использует assigned/current HUB DB;
  `hub_db_id` в body не даёт сменить БД. `scope=all` и явный DB override
  разрешены только администратору, когда `WAREHOUSE_1C_RECONCILE_ALLOWED_DB_IDS`
  содержит каждый включаемый ID существующей HUB БД. Пустой или устаревший
  allowlist блокирует `scope=all` (fail closed).
- Любая мутация связи передаёт typed-request с причиной и обязательным
  `expected_version` (`0` для ещё не существующей связи); для legacy-проекции
  также обязателен `expected_part_no`. Устаревшее решение получает `409`.
- Для контролируемого audit-only rollback установить
  `WAREHOUSE_1C_RECONCILE_REGISTRY_WRITE_ENABLED=0`: сервер и UI скроют ручную
  запись. В штатном режиме флаг включён; он открывает только HUB-side
  registry/`PART_NO`, никогда не запись в 1С.
- Явные связи склада/владельца и EmployeeCode/владельца создаются только
  администратором через подтверждённые `/reconcile/warehouse-owner-links` и
  `/reconcile/employee-owner-links`.
- Auto-link — только preview: он не имеет commit-ветки. Каждая связь
  подтверждается отдельно через typed `apply-part-no` с точным
  `nomenclature_ref`, `expected_version`, причиной и `confirm=true`. ФИО и
  fuzzy-подбор никогда не являются основанием для batch auto-commit.

## Контракт read API

`GET /balances`, `POST /balances/batch`, движения и reconcile-ответы различают
нулевой остаток от неполного/неизвестного результата. Для агрегатов возвращаются
`qty_1c_total`, `exact_linked_count`, `unlinked_candidate_count`,
`source_row_count`, `as_of`, `source` и `status`.

Состояния:

| `status` | Значение для UI и сверки |
|---|---|
| `ok` | Полный результат; допустимо сравнение количества |
| `unknown` | Данные отсутствуют или недоступны; нельзя считать нулём |
| `incomplete` | Лимит/страница/источник неполны; итоговый вывод запрещён |
| `error` | Ошибка источника; итоговый вывод запрещён |

Для pageable-ответов используются `returned`, `total`, `has_more`, `truncated`
и cursor. Движения по умолчанию запрашивают серверный период 90 дней,
сортируются от новых к старым и не отбрасывают строки с `qty_end = 0`.
`owner-mismatches` при `unknown`/`incomplete`/`error` не публикует `delta`,
`exact_linked_count`, `only_in_1c` или итоговые mismatch-строки: неполный
остаток не может быть основанием для количественного вывода.
`POST /balances/batch` принимает максимум 50 ref и выполняет один запрос 1С;
карточка оборудования не должна делать fan-out из десятков live-запросов.
`/reconcile/hub-over-1c` для одной HUB БД использует keyset cursor. `total`
(`source_total`) — точное число исходных PART_NO-групп HUB; `comparison_total`
появляется только после полной проверки. При cross-DB, timeout или неполном
источнике возвращается `status=incomplete`, а не выдаётся неполный список за
итоговый результат. UI показывает это отдельным предупреждением и догружает
страницы только по `next_cursor`.

## Cache, COM и readiness

Каталог синхронизируется лидером через PostgreSQL advisory lease; backend
читает общий snapshot. Статус доступен по:

- `GET /api/v1/warehouse-1c/status` — readiness, bridge, лидер и каталог;
- `GET /api/v1/warehouse-1c/catalog/status` — cache-метаданные;
- `POST /api/v1/warehouse-1c/catalog/sync` — только администратор.

Текущие эксплуатационные параметры (переопределяются env):

| Переменная | Значение по умолчанию |
|---|---:|
| `WAREHOUSE_1C_CATALOG_SYNC_INTERVAL_SECONDS` | 3600 с |
| `WAREHOUSE_1C_CATALOG_STALE_SECONDS` | 7200 с |
| `WAREHOUSE_1C_CATALOG_APP_STORAGE` | `auto` |
| `WAREHOUSE_1C_RECONCILE_ALLOWED_DB_IDS` | пусто — `scope=all` выключен |
| `WAREHOUSE_1C_PROCESS_BRIDGE_ENABLED` | `0` (включать после controlled rollout) |
| `WAREHOUSE_1C_BRIDGE_QUEUE_LIMIT` | 16 запросов |
| `WAREHOUSE_1C_BRIDGE_FAILURE_THRESHOLD` | 4 |
| `WAREHOUSE_1C_BRIDGE_COOLDOWN_SECONDS` | 60 с |
| COM workers | 1 isolated bridge process |
| Очередь COM | 16 запросов |
| Circuit breaker | 4 подряд ошибки, cooldown 60 с |
| `WAREHOUSE_1C_MAX_ATTACHED_FILE_BYTES` | 25 MiB |

При `WAREHOUSE_1C_PROCESS_BRIDGE_ENABLED=1` COM выполняется только в отдельном
Windows child-process с JSON-only allowlist read-операций. Timeout завершает и
перезапускает child; сервер не делает silent fallback к in-process COM. В legacy
режиме status явно показывает `bridge.mode=in_process_compatibility`. В
мониторинг нужно вынести
возраст последней успешной синхронизации, `catalog.status`, последнюю ошибку,
`bridge.queue_length`, `bridge.timed_out` и состояние breaker. При `stale`,
`error` или открытом breaker UI показывает недоступность вместо нулевого остатка.

Вложения отдаются без physical path, с лимитом размера и через HTTP stream;
детальная карточка документа доступна только для явно поддержанных типов
регистратора.

## Перемещения и акты HUB

`POST /equipment/transfer` — inventory transfer. Он использует
client-generated `operation_id`, неизменяемый `ITEMS.ID`, блокировку строки и
одну SQL-транзакцию на позицию (history + update). Повтор того же
`operation_id` в той же БД тем же пользователем возвращает существующую задачу;
разный scope или payload получает конфликт. Задача атомарно захватывается
воркером. При восстановлении после commit SQL и до записи результата marker
`[operation_id=…]` в `CI_HISTORY` возвращает уже применённую позицию без второй
истории; reuse ID с другой целью или изменившимся текущим состоянием — конфликт.

Перед публикацией результата act worker сохраняет checkpoint с внутренними
act-records. Каждый документ имеет детерминированный ID и имя файла от
`operation_id` и состава группы: restart/retry повторно использует уже созданный
файл вместо второго акта. Physical path хранится только во внутреннем record и
никогда не возвращается API-клиенту.

Выбрана явная семантика partial-result: успешные позиции остаются перенесёнными,
неуспешные перечисляются для повторного запуска только по ним. Если есть хотя бы
одна ошибка, акт, сообщение и JSON-ledger не создаются. У всех успешных
inventory-transfer в ответе сохраняется `one_c_sync_state = not_requested`.

Web и Telegram-бот используют общий чистый контракт `shared.transfer_command`:
он нормализует immutable ID позиций, фиксирует только явные retryable-отказы и
не превращает неизвестную ошибку, дубликат или исключение в безопасный повтор.
Перед первой Telegram-отправкой бот сохраняет локальный durable checkpoint с
resolved `ITEMS.ID`, актами и статусом доставки каждой группы. Состояние
`sending` после рестарта считается неоднозначным: бот не отправляет такой файл
автоматически повторно и не записывает JSON-ledger, пока checkpoint не будет
проверен. Ledger фиксируется только после подтверждённой доставки всех актов и
дедуплицируется по `(operation_id, ITEMS.ID)`.

`POST /equipment/transfer/act-only` — document-only. Он намеренно не меняет
`ITEMS` и `CI_HISTORY`; такой акт не означает смену владельца.

`POST /equipment/transfer/location` — отдельный inventory-transfer без смены
владельца и без акта. Для него обязателен client-generated `operation_id`; он
идёт через тот же durable job и частичный command-result, а SQL replay ищет
marker по immutable `ITEMS.ID`. Повтор операции не добавляет вторую строку
`CI_HISTORY`; повторять можно только явные `retry_inv_nos` с новым ID.

## Rollout и rollback

1. Применить PostgreSQL migration и оставить
   `WAREHOUSE_1C_RECONCILE_REGISTRY_WRITE_ENABLED=0`.
2. Запустить legacy migration только с `dry_run=true`; сравнить новый и старый
   reconcile в audit-only режиме.
3. Проверить cache/status и расхождения, затем мигрировать только подтверждённые
   связи с `confirm=true`.
4. Включить feature flag и выдать новое write-право только назначенным ролям.
5. При rollback отключить flag и временно читать legacy `PART_NO`; не удалять
   registry/audit, чтобы не потерять историю решений.

## Восстановление

1. Если `/warehouse-1c/status` показывает открытый breaker, не повторять
   массовые запросы: дождаться cooldown и проверить доступность 1С/COM.
2. Если cache stale, запустить административный `/catalog/sync`; убедиться, что
   лидер один и последняя успешная синхронизация обновилась.
3. Если COM-запрос завис, выполнить штатный restart backend/bridge по PM2 и
   проверить readiness. Не подменять timeout нулевым остатком.
4. Для восстановления прерванной операции допустимо повторить тот же
   `operation_id`: уже проведённая SQL-позиция вернётся как replay без второй
   истории. Для нового исправляющего запуска использовать новый ID и только
   `retry_inv_nos` из явного partial-result.
