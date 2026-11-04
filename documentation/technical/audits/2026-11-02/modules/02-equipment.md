# 02. Оборудование, База, фото, акты и перемещения

> **Актуализация 2026-11-03:** DEQP-01/02/03 описывают снимок 02.11. Digest, completion ledger/recovery и token/heartbeat lock изменены извне; исходные симптомы не переносить автоматически на текущий код. Crash recovery остаётся частично непроверенным. См. BE-04/05/FE-02 в [повторной сверке](../INITIAL_FINDINGS_RECHECK_2026-11-03.md). DEQP-04/05 требуют самостоятельного закрытия.

Дата: 2026-11-02. Режим: read-only исходного кода и данных, запись только этого отчёта.
Главный результат: подтверждены четыре дефекта загрузки/проверки фото и один риск неограниченного накопления upload-сессий; межбазовый перенос имеет существенно более сильные гарантии, чем обычная файловая загрузка.
Оценка: **5 находок: 3 High, 2 Medium**. Пункты DEQP-01/02/03 уточняют BE-04/BE-05/FE-02 основного аудита; DEQP-04/05 — дополнительный разбор.
R — механизм воспроизведён изолированно; S — подтверждён реализацией/callers; H — гипотеза, не включённая в число дефектов.
Номера строк относятся к текущему изменяемому рабочему дереву. Production, `.env`, COM, SQL Server и реальные фото пользователей не использовались.

## Граница модуля и потоки данных

| Сценарий | Вход/оркестрация | Данные и выход |
|---|---|---|
| Таблица оборудования и карточка | `WEB-itinvent/frontend/src/pages/Database.jsx`; `pages/database/`; `backend/api/v1/equipment.py` | SQL Server ITEMS/OWNERS/CI_* через database/queries.py; app-owned отметки отдельно |
| Фото с возобновлением | `WEB-itinvent/frontend/src/lib/resumablePhotoUpload.js:73`; `WEB-itinvent/backend/api/v1/equipment.py:3956` | Дисковая сессия/части → complete → SQL Server FILES → result.json |
| Проверка/отклонение фото | `WEB-itinvent/backend/services/equipment_photo_check_service.py:334`, `:381` | Метаданные FILES + PostgreSQL AppEquipmentPhotoCheck, user identity и file_created_at |
| Передача сотруднику | `WEB-itinvent/backend/services/equipment_transfer_execution_service.py:88` | Per-item SQL transaction с history → durable checkpoint → PDF → reminder |
| Межбазовый перенос | `WEB-itinvent/backend/services/equipment_db_transfer_service.py:898` | Две SQL Server DB на одном сервере, общий connection/transaction, копия history/PDF/BLOB, receipt journal |
| Фоновое создание актов | `WEB-itinvent/backend/services/transfer_act_job_service.py:211`, `:566` | app transfer jobs, claim started_at, heartbeat/checkpoint/finalize |
| OCR фото/качество | `WEB-itinvent/backend/services/equipment_photo_ocr_service.py:295` | App OCR state, текущий SERIAL_NO из SQL Server, fingerprints и ручные отметки |

Важная граница: обычная передача сотруднику допускает результат с успешными и неуспешными отдельными позициями.
Это иной контракт, чем атомарный межбазовый перенос; их нельзя исправлять одинаковой заменой всех операций одной большой транзакцией.
Файлы PDF при межбазовом переносе сохраняются как оригиналы в источнике, тогда как записи оборудования удаляются в рамках согласованного переноса.
App-owned статусы проверки фото и SQL Server FILES не участвуют в общей распределённой транзакции.

## Проверенные инварианты

| Инвариант | Текущее подтверждение | Результат |
|---|---|---|
| Поздняя смена X-Database-ID не перенаправляет незавершённую photo session | `equipment.py:4001-4015`: DB берётся из manifest | Сохранён |
| Чужой user не читает/завершает сессию | `WEB-itinvent/backend/services/equipment_photo_upload_service.py:111`: _load_owned сверяет user_id | Сохранён на service-уровне |
| Chunk имеет ожидаемый размер и допустимый индекс | `WEB-itinvent/backend/services/equipment_photo_upload_service.py:104`, `:196` | Сохранён; HTTP body уже материализован до проверки |
| Повтор complete после успешно записанного результата не вставляет второй раз | `WEB-itinvent/backend/services/equipment_photo_upload_service.py:265-274` | Сохранён только при наличии result.json |
| Один upload не вставляется дважды после произвольного crash | `WEB-itinvent/backend/services/equipment_photo_upload_service.py:287-288` | Нарушен, DEQP-01 |
| Ручные verified/rejected взаимоисключающие | `WEB-itinvent/backend/services/equipment_photo_check_service.py:354`, `:406` | Нарушен при конкурентном обновлении, DEQP-04 |
| Межбазовый перенос не работает между разными SQL hosts | `WEB-itinvent/backend/services/equipment_db_transfer_service.py:910-914` | Явный отказ |
| Операции A→B и B→A берут application locks в одном порядке | `WEB-itinvent/backend/services/equipment_db_transfer_service.py:566-595` | Сохранён |
| Source не изменился за время генерации PDF | `WEB-itinvent/backend/services/equipment_db_transfer_service.py:983-990` | Полный reread под UPDLOCK/HOLDLOCK и сравнение snapshot |
| BLOB/PDF переносятся bytes, а не только карточками | `WEB-itinvent/backend/services/equipment_db_transfer_service.py:967`, `:794`, `:801` | Реализованы hashing и проверка копии; реальные bytes не проверены |
| Неизвестная ошибка transfer не означает безопасный retry | `WEB-itinvent/backend/services/equipment_transfer_execution_service.py:171-179` | retryable=false |
| Частичная batch-передача не создаёт вводящий в заблуждение общий акт | `WEB-itinvent/backend/services/equipment_transfer_execution_service.py:218-222` | Сохранён |
| Потерявший claim worker не пишет checkpoint/terminal state | `WEB-itinvent/backend/services/transfer_act_job_service.py:461`, `:491`, `:609` | Token guards есть; обходные callers требуют отдельной проверки |

## DEQP-01 — commit фото и completion checkpoint не атомарны

**High, R прежнего прогона + S повторной сверки; трудоёмкость L. Связь: BE-04.**
Код: `WEB-itinvent/backend/services/equipment_photo_upload_service.py:287-288`.
Caller: `WEB-itinvent/backend/api/v1/equipment.py:4007-4027`.
SQL commit: `WEB-itinvent/backend/database/connection.py:212`; INSERT: `WEB-itinvent/backend/database/equipment_photos.py:382`.
Операция сначала получает результат callback commit, затем сохраняет result.json; это разные ресурсы и разные commit boundaries.
Crash/ошибка диска после SQL commit оставляет FILES, но сессия продолжает считаться незавершённой.
Следующий complete снова выполняет INSERT, потому что persistent idempotency key в FILES/журнале не связывается с upload_id.
В исходном аудите реальная complete с OSError checkpoint и callback-счётчиком дала два commit; в этом углублении порядок повторно подтверждён чтением.
HTTP docstring «Insert once» (`equipment.py:3996`) сильнее реально обеспеченной гарантии.
Минимальное направление исправления: durable idempotency record, атомарно связанный с SQL INSERT, либо надёжное recovery сопоставление выполненной операции.
Смена SQL Server schema/ключей требует отдельного решения; одного файлового lock недостаточно.
Приёмка: оборвать процесс после INSERT до записи result, повторить complete, проверить одну FILES и идентичный FILE_NO/hash.
Дополнительно проверить недоступность диска, обрыв ответа уже после complete, restart и два одновременных HTTP complete.

## DEQP-02 — истекающая блокировка допускает двух исполнителей

**Medium, R прежнего прогона + S повторной сверки; M. Связь: BE-05.**
Код: `WEB-itinvent/backend/services/equipment_photo_upload_service.py:32`, `:225-249`, `:267-292`.
После 120 секунд другой запрос удаляет lock по mtime, хотя первый может ждать SQL Server.
Нет heartbeat и ownership token; первый finally может удалить lock второго.
Проблема возникает и без падения процесса, в отличие от DEQP-01.
Repro предыдущего аудита: первый acquire=true, старение mtime без release, второй acquire=true; реализация сейчас та же.
Исправление: межпроцессный ownership/token и heartbeat; освобождение только своего lease.
Приёмка: commit дольше stale threshold, конкурентный complete, проверка единственного владельца и отсутствие чужого unlink.
Делать timeout SQL/HTTP короче lease полезно, но само по себе не закрывает crash и ownership.

## DEQP-03 — метаданные файла используются как идентичность содержимого

**High, R прежнего Node harness + S повторной сверки; M. Связь: FE-02.**
Код: `WEB-itinvent/frontend/src/lib/resumablePhotoUpload.js:73-80`.
Server: `WEB-itinvent/backend/services/equipment_photo_upload_service.py:162-172`.
Seed содержит item/db/name/size/lastModified, но не bytes. Криптографический SHA256 от metadata не исправляет эту коллизию смыслов.
Два разных файла одинаковых metadata дают один client_id и одну upload session.
Если первая уже завершена, server возвращает старый FILE_NO независимо от нового size/digest аргумента — это намеренное правило для повторного сжатия.
Результат: UI получает успешную «загрузку» второго файла, фактически остаются bytes первого.
Fix outline: учитывать digest исходных bytes и согласованный ключ логической загрузки; повторное сжатие должно быть детерминированным или отдельно версионированным.
Приёмка: разные bytes с одинаковыми metadata; один и тот же файл после reload; повторное сжатие на двух клиентах; файл удалён после прежнего completion.
Не заменять stable client_id случайным ID на каждую попытку: это сломает resume и увеличит дубли.

## DEQP-04 — одновременные verify и reject сохраняют оба статуса

**High, R нового углубления; M.**
Чтение строки: `WEB-itinvent/backend/services/equipment_photo_check_service.py:241-252`.
Verify: `:354-367`; reject: `:406-418`; очистка противоположного статуса: `:161-172`.
Оба request читают исходную строку, где verified_at и rejected_at равны NULL, без FOR UPDATE/CAS версии.
Verify назначает verified_at, reject вызывает _clear_verified на своём старом объекте, где поле уже NULL.
SQLAlchemy не считает присваивание NULL поверх прочитанного NULL изменением, поэтому UPDATE reject не обязательно содержит verified_at=NULL.
После двух commits в БД остаются и verified_at, и rejected_at.
Второе направление зеркально: _clear_rejected также работает с локальным snapshot.
Новый harness извлёк реальные _clear_verified/_clear_rejected через AST и выполнил тот же pattern в двух SQLAlchemy Session на SQLite :memory:.
Вывод: `PHOTO_CHECK_RACE True True`, assertion обоих сохранённых timestamps прошёл, exit=0.
Harness доказывает механизм ORM dirty tracking; это не полное HTTP-исполнение и не PostgreSQL race test.
Fix outline: атомарный UPDATE всех полей итогового состояния, CAS по version либо row lock на существующей строке плюс корректная гонка создания.
Рассмотреть CHECK-инвариант невозможности двух активных статусов после очистки существующих конфликтов; миграция только отдельно.
Приёмка: два синхронно стартующих API verify/reject, существующая и отсутствующая строка, repeated requests, финальная БД с одним состоянием.
Проверить unverify и edit reject reason на том же version contract, иначе они останутся обходом.

## DEQP-05 — отсутствует общий бюджет дискового upload-spool

**Medium, S; M.**
Код: `WEB-itinvent/backend/services/equipment_photo_upload_service.py:138-175`, `:308`, `:312`; constants `:31-34`.
Размер одного фото ограничен, но количество незавершённых сессий/общие bytes пользователя и всего spool не ограничены в модуле.
Новые client_id создают новые каталоги; сохранённые chunks живут до abort/complete/очистки.
Cleanup удаляет только истёкшие, по умолчанию dry-run/feature flag false, TTL — 48 часов, batch — 200.
Это корректные защитные defaults удаления, но они не являются admission quota.
Много прерванных загрузок может заполнять диск, а исчерпание диска затрагивает также DEQP-01 checkpoint.
Фактический размер spool, свободное место и включение cleanup production не проверены; OOM/disk-full инцидент не утверждается.
Fix outline: ограничить активные sessions и суммарные bytes до создания/приёма chunk, вернуть явный retryable quota error; сохранить resumable задания.
Не включать автоматическое удаление существующих файлов без отдельного разрешения и retention-дизайна.
Приёмка: много уникальных session IDs, параллельный обход квоты, restart, освобождение квоты после abort/complete.

## Производительность и критические ресурсы

| Путь | Наблюдаемый механизм | Что измерять перед исправлением |
|---|---|---|
| Photo complete | b''.join всех chunks и полная SQL FILES вставка (`upload_service.py:278`) | RSS/bytes, parallel complete, время SQL/serialization; размер файла ограничен |
| Resumable progress | _received делает stat по каждому chunk (`:118`) | Число filesystem ops на один chunk × число частей, p95 на медленном диске |
| Cross-DB transfer | Полный source snapshot, docs/files, hashing, затем повторный snapshot | SQL count/time, суммарные BLOB bytes, время session application lock |
| PDF generation | Вынесена из открытой DB transaction, но application lock остаётся (`db_transfer_service.py:568`, `:958`) | Конкурентные переносы, lock wait/reject rate; нельзя менять без сохранения ordering |
| Photo OCR UI | Batched serial/fingerprint reads и вычисление по текущему SERIAL_NO | Query count по размеру карточек, LLM worker latency отдельно от UI |
| Per-item employee transfer | SQL операция на каждую позицию и lookup старой почты (`execution_service.py:192`) | Количество запросов и общий p95 по 1/10/100 позициям |

Не получены baseline/after и production p95; оптимизации не объявляются выполненными.

## План проверки исправлений и существующие тесты

1. Сначала воспроизвести DEQP-01/04 через настоящий локальный API с изолированными stores и управляемыми failpoints.
2. Для SQL Server cross-DB использовать отдельные тестовые DB с fixture schema; не запускать против ITINVENT production.
3. Проверить upgrade/downgrade только если добавляется idempotency/version constraint.
4. Проверить normal download целевого PDF, SHA256 bytes и сохранность оригинала источника, а не только число FILES.
5. Затем UI: session DB switch, repeated complete, logout/user change, parallel verify/reject.

Существующие подходящие файлы: `tests/test_e2e_equipment_photo_resumable_upload.py`, `tests/test_equipment_photos.py`, `tests/test_equipment_photo_checks.py`, `tests/test_equipment_photo_ocr.py`.
Для transfers: `tests/test_e2e_equipment_db_transfer.py`, `tests/test_transfer_integrity.py`, `tests/test_transfer_operation_idempotency.py`, `tests/test_e2e_transfer_act_pdf.py`.
Для документов: `tests/test_transfer_act_document_layout.py`, `tests/test_transfer_act_reminder_app_db_service.py`.
В этом углублении стандартные pytest suites не запускались; изолированный ORM harness выполнен отдельно.
Наличие теста не означает покрытие crash между SQL и файлом, concurrent opposite photo status или живую SQL Server acceptance.

## Отвергнутые подозрения и открытые вопросы

- Transfer не следует объявлять «сначала удаляет source, затем копирует»: копия, журнал и удаление коммитятся вместе (`db_transfer_service.py:1075`).
- UPDLOCK/HOLDLOCK и ordered application locks — не бесполезная блокировка; они защищают snapshot и ID allocation.
- Нельзя утверждать, что PDF не переносится: _copy_file/_verify_files работают с bytes/hash (`:794`, `:801`).
- Partial employee move намеренно не создаёт общий акт; это fail-closed поведение, не потеря документа.
- App photo provenance/check/OCR при межбазовом переносе не переносится этой SQL transaction. Нужна бизнес-политика: сохранять аттестацию или требовать новую проверку? Без решения это не объявлено багом.
- Failures post-insert _after_photo_inserted могут оставить FILES без части app метаданных (`equipment.py:4031`). Требуется отдельный fault-injection и проверка уже имеющегося recovery до новой находки.

## Прочитанные ключевые файлы и границы покрытия

- Полностью/большие релевантные части: `equipment_photo_upload_service.py`, `equipment_transfer_execution_service.py`, `equipment_db_transfer_service.py`.
- Целевые части: `equipment_photo_check_service.py`, `equipment_photo_ocr_service.py`, `transfer_act_job_service.py`, `database/equipment_photos.py`, `database/connection.py`, API `equipment.py`.
- Frontend: `resumablePhotoUpload.js`, `useEmployeeEquipmentData.js`, маршруты/подсказки по карте репозитория; весь каталог страниц не прочитан построчно.
- Tests просмотрены по контрактам/перечню и relevant assertions; весь тестовый код модуля не исполнен.
- Не проверены фактические SQL Server FK/triggers, данные и загрузка дисков, права реального оператора, IIS body limit и browser end-to-end.

Дальнейшая реализация и любое изменение production требуют отдельного запроса; сам отчёт деплоя не требует.
