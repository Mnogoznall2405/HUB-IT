# Дополнительный аудит backend-доменов — 3 ноября 2026

Найдено **5 новых дефектов Medium**, не включённых в DTASK-01…07, DBIZ-01…07, DDOC-01…07 и исходный remediation registry. Код приложения не изменён. Production, конфигурации, внешние отправки и реальные БД не затрагивались.

R — воспроизведение исполняемых функций текущего кода через AST в изолированном harness; S — прослеженный путь по коду; H — непроверенная гипотеза. R здесь не означает HTTP E2E или подтверждённый production-инцидент.

## BDOM-01 — Medium / R+S: «Уведомить аудиторию об изменениях» теряет все push jobs

- **Триггер:** автор/модератор меняет опубликованную запись, установив `notify_on_update=true`; у получателя включены уведомления ленты.
- **Caller/guards:** `WEB-itinvent/frontend/src/components/feed/FeedComposerDialog.jsx:743` — переключатель, `:412` — payload; `WEB-itinvent/backend/api/v1/hub.py:712` — PATCH, `:718` — manager permission, `:720` — service; `WEB-itinvent/backend/services/hub_service.py:5321` дополнительно проверяет автора/администратора.
- **Причина:** `hub_service.py:5411` вызывает `_create_announcement_notifications`, но игнорирует возвращаемый список. Helper `:5117` записывает bell notifications, а `:5120` возвращает jobs для внешнего push. Сам batch writer `:4186–4262` push не ставит. В `update_announcement` отсутствует последующий `_schedule_hub_push_jobs`; для create и publish он есть (`:5295`, `:6598`).
- **Результат:** редактирование и bell notification сохраняются, однако push не ставится вообще. Это детерминированная потеря на обычном успешном пути, а не crash-window.
- **Изолированная проверка:** исполнены реальные AST `update_announcement` и `_create_announcement_notifications`, запись объявления — SQLite `:memory:`, внешние границы подменены без отправки. Выход: `bell_rows=1, created_push_jobs=1, scheduled_push_jobs=0`.
- **Минимальное исправление:** сохранить jobs, завершить транзакцию, затем поставить их тем же механизмом, который используют create/publish. Возврат результата перенести после постановки. Не отправлять push до commit.
- **Acceptance:** PATCH опубликованной записи с флагом → сохранённая правка, один bell и одна постановка push на включённого адресата; flag=false/исключённый автор/выключенный канал → отсутствует лишняя постановка; rollback → ни отправки, ни сохранённого bell.

## BDOM-02 — Medium / R+S: новый срок задачи не получает новый reminder

- **Триггер:** задача уже входила в окно приближающегося срока, напоминание получено; срок перенесён на новую дату либо задача завершена и снова открыта с новым сроком. При входе в новое окно тот же исполнитель не получает нового `task.deadline_soon`.
- **Caller/guards:** worker `WEB-itinvent/backend/services/task_due_notification_worker.py:44` → `hub_service.run_task_due_notification_cycle`; `hub_service.py:10009` → `:10158` → `_ensure_task_due_notifications_for_user:9885`. Проверяются действующий assignee/delegate, незавершённый статус, валидный срок, окно 72 ч и настройка email (`:9889–9953`).
- **Причина:** `_notification_exists` (`hub_service.py:4264`) проверяет только recipient/event/entity и при этом вызове `:9937` не получает ни дату, ни версию срока. Email дедупликация ещё строже: `:3922–3923` принудительно заменяет key на `task.deadline_soon:<task>:<recipient>`, исключая `updated_at` и `due_at`. `task_email_outbox_service.py:101` делает `INSERT OR IGNORE` по уникальному dedupe key.
- **Проверка соседних путей:** update создаёт отдельное `task.deadline_changed` (`hub_service.py:7609–7621`), но не очищает reminder identity. Reopen меняет due/status (`:9252`) и создаёт `task.reopened` (`:9285`), также без нового reminder cycle. Эти события сообщают о самом изменении, но не о последующем наступлении нового окна.
- **Изолированная проверка:** реальные AST `_ensure_task_due_notifications_for_user`, `_notification_exists`, `_queue_task_email_event`; SQLite `:memory:` с unique email key, сеть отключена через stubs. Два разных срока внутри активного окна, два запуска: `notification_rows=1, email_rows=1`. Harness проверяет сам worker после изменения due; HTTP update/reopen не запускались.
- **Последствие:** старый bell блокирует напоминание до удаления retention/вручную; старый outbox key блокирует новый email, пока сохраняется его строка. Проблема не относится к уже известной гонке claim/SMTP BE-03.
- **Минимальное исправление:** включить нормализованный срок/идентификатор reminder cycle в обе identity, сохранив дедупликацию повторных запусков для одного срока. Старые уведомления и sent-историю не удалять.
- **Acceptance:** reminder D1 → перенос далеко вперёд на D2 → вход в окно D2 → ровно один новый bell и email intent; повтор worker в том же окне не добавляет дублей; reopen с новым сроком тоже формирует новый cycle; обычная правка описания не создаёт reminder заново.

## BDOM-03 — Medium / R+S: настройки уведомлений теряют изменения между независимыми процессами

- **Триггер:** два backend workers/независимых экземпляра одновременно меняют preferences разных пользователей в одном store либо пересекается старый и новый runtime при замене процесса. Для одного singleton в одном процессе эта конкретная гонка закрыта.
- **Caller/guards:** `WEB-itinvent/backend/api/v1/settings.py:338–352` — PATCH только текущего активного пользователя; чужой user_id от клиента не принимается. `notification_preferences_service.py:63` создаёт `RLock` на экземпляре, `:142` держит его при update.
- **Причина:** `notification_preferences_service.py:181–189` загружает весь словарь пользователей, меняет одну запись и сохраняет весь документ. `local_store.py:465–489` атомарно переписывает документ через `DELETE` и повторные INSERT, но транзакция не включает предыдущее чтение service. Instance-lock не синхронизирует второй процесс. Атомарность каждого save не предотвращает lost update между двумя save.
- **Изолированная проверка:** реальные AST методов preferences-service, два независимых экземпляра с собственными `RLock`, общий словарь store и barrier после второго load до save. Одновременные `user1.chat=false` и `user2.chat=false` завершились без ошибки, итог: `{'1': false, '2': true}`. Подменён только storage boundary; реальная межпроцессная SQLite contention не измерялась.
- **Последствие:** уже подтверждённое отключение канала другого пользователя откатывается; пользователь снова получает нежелательные уведомления.
- **Минимальное исправление:** адресный upsert записи пользователя через существующий `get_entry/set_entry` store-контракт либо атомарный read/merge/write внутри одной store-транзакции. Для concurrent patches одного пользователя также нужен merge/CAS, а не независимые read+set.
- **Acceptance:** два процесса обновляют разные user records под barrier → оба изменения сохранены; два процесса меняют разные поля одного пользователя → ни одно поле не откатывается; ошибки записи возвращаются клиенту.
- **Ограничение:** число реальных production writers не проверялось. Сценарий условный для нескольких независимых writers, сам lost-update механизм воспроизведён; не заявляется текущая потеря пользовательских настроек в production.

## BDOM-04 — Medium / R+S: успешный ответ preferences PATCH при провале сохранения

- **Триггер:** SQLite store не может записать документ, например из-за исчерпанного места, readonly volume или lock timeout.
- **Caller/guards:** тот же аутентифицированный PATCH `settings.py:338`; `:350` ловит только validation `ValueError`, `:352` безусловно формирует успешный response из service result.
- **Причина:** `local_store.py:486–488` ловит ошибку сохранения и возвращает `False`. `notification_preferences_service.py:75–76` игнорирует этот результат; update `:189–195` возвращает новое значение без подтверждения сохранения.
- **Изолированная проверка:** AST класса preferences-service с настоящими DEFAULTS и методами `_load_all/_save_all/update_preferences`; storage boundary возвращает существующий `chat=true` и `save_json=False`. Получено `response_chat=false, persisted_chat=true, exception=None`. Это воспроизведение ошибки persistence boundary, без реального disk fault.
- **Последствие:** UI сообщает об отключённом канале, но последующее чтение и отправители используют прежнее значение. В отличие от BDOM-03, дефект возможен даже при одном writer и не зависит от гонки.
- **Минимальное исправление:** проверять boolean save, при `False` поднимать типизированную ошибку недоступности хранения; API возвращает 503, UI сохраняет прежнее подтверждённое состояние и предлагает повтор.
- **Acceptance:** fault injection `save_json=False` → PATCH 503, прежние значения сохранены, успешный статус не выдаётся; после восстановления store повторный PATCH → 200 и GET возвращает новое значение.

## BDOM-05 — Medium / R+S: Excel скрывает усечение task analytics

- **Триггер:** пользователь с ограниченной областью доступа экспортирует аналитику широкого периода, SQL scan достигает предела 2000 строк.
- **Caller/guards:** `WEB-itinvent/backend/api/v1/hub.py:1528–1547` требует `tasks.read` и передаёт текущего пользователя в exporter. Exporter `task_analytics_export_service.py:146` передаёт его дальше, поэтому обход ACL не заявляется.
- **Причина:** `hub_service.py:532` задаёт cap=2000; `_collect_analytics_acl_visible_task_ids:8498–8520` возвращает `truncated=True`, а `get_task_analytics:8724` помещает его в payload. Весь `build_task_analytics_excel` (`task_analytics_export_service.py:134–252`) этот флаг не читает и не записывает предупреждение. В браузере предупреждение предусмотрено явно (`WEB-itinvent/frontend/src/components/hub/tasks/TasksAnalyticsView.jsx:73–76`).
- **Результат:** файл содержит частичные totals, разбивки и проценты как обычный полный отчёт; получатель отдельного файла не может понять, что исходная выборка усечена. Фильтры широкого периода не раскрывают это ограничение.
- **Изолированная проверка:** исполнен настоящий AST exporter с настоящим openpyxl; заменён только источник analytics на payload `summary.total=2000, truncated=True`. XLSX разобран в памяти: `summary_total_exported=true, truncation_warning_present=false`. Все ячейки осмотрены, данных/файлов production нет.
- **Минимальное исправление:** при truncated добавить заметное предупреждение на сводном листе и признак неполноты отчёта; либо вернуть явный отказ экспорта с просьбой сузить фильтры. Существующий ACL cap не убирать без отдельного решения и замера.
- **Acceptance:** fixture с более 2000 кандидатами для ограниченного пользователя → экспорт показывает предупреждение о неполноте/требует сузить фильтры; неполный отчёт нельзя принять за полный при передаче XLSX. Малый полный отчёт → предупреждения нет.

## Проверки и ограничения

- Прочитаны AGENTS.md, старые модули 04/05/09, REMEDIATION_STATUS_2026-11-03.md и релевантные места остальных модулей для проверки дублей.
- Выполнены пять узких isolated harness-сценариев, выводы приведены выше. Harness извлекает AST без импорта application singleton и без schema initialization. SQL — только заново созданная SQLite `:memory:`. openpyxl читает/пишет BytesIO. Внешние API, SMTP, push и COM не вызывались.
- Первый harness остановился из-за неточного диагностического `_as_int` stub (второй аргумент настоящего helper — fallback); stub исправлен, полный последующий запуск завершился exit 0. Это ошибка harness, не дополнительный дефект продукта.
- Pytest/E2E, live HTTP, PostgreSQL и реальные пользователи не запускались; suites totals не заявляются. Новые тестовые файлы не добавлялись.
- Проверены native construction calculation/planning guards: parent lock, общий session через `_work`, CAS версий, проверка scope/архивных работ; новых доказанных дефектов этой области в реестр не добавлено. Feedback имеет advisory-lock на пользователя и row lock изменения; простое обвинение в count-before-insert race для PostgreSQL было бы неверно.
- Не включён уже описанный в старом модуле 04 crash-window scheduled publish commit→push; не повторены SMTP claim, task edit CAS, stale realtime membership, cache eviction, ticket imports и циклы оргдерева.
- Фактические runtime-конфигурации, объёмы данных и доля усечённых отчётов не измерялись. Production incident rate/p95/RSS не заявляются.
- Изменён только этот markdown. Исправлений, deployment/restart, DDL/DML production не выполнялось; для реализации и выкладки нужен отдельный запрос.
