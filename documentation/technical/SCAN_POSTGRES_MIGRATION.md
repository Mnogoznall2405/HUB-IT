# Scan Center: переход SQLite → PostgreSQL

## Решение

PostgreSQL нужен Scan Center для устойчивой параллельной работы очереди, worker и web-панели. Он не повышает качество распознавания ДСП и почти не влияет на время Tesseract: OCR остаётся CPU/RAM-задачей.

Переход выполнять отдельным этапом после установки обратно совместимой версии сервера. До переключения агенты продолжают работать с теми же HTTP API и локальным outbox.

## Базовый замер 14.07.2026

Команда:

```powershell
python scripts\benchmark_scan_storage.py --repeats 5 --json-output tmp\scan-storage-before.json
```

Рабочая SQLite БД на момент замера:

| Показатель | Значение |
|---|---:|
| Файл БД | 2057,0 МиБ |
| Оценочно занято страницами | 890,7 МиБ |
| Задания анализа | 198 689 |
| Инциденты | 64 107 |
| Наблюдения запусков | 156 422 |
| p95 подсчёта статусов jobs | 26,3 мс |
| p95 выборки непроверенных | 8,0 мс |
| p95 выборки метрик за 24 часа | 327,7 мс |

Вывод: срочной аварийной причины менять БД нет — типовые чтения быстрые, исторических lock-ошибок мало. Но размер, общий lock внутри `ScanStore` и дальнейший рост делают миграцию разумной до увеличения числа worker/API процессов.

Backup перед миграцией (пример): `data/scan_server/backups/scan_server_YYYYMMDD_HHMMSS.db`.

## Что даст PostgreSQL

- независимые транзакции API и worker вместо одного SQLite writer;
- `FOR UPDATE SKIP LOCKED` для безопасной параллельной выдачи jobs;
- нормальную конкуренцию heartbeat, ingest, dashboard и очистки retention;
- предсказуемые индексы и `VACUUM` без остановки всего Scan Center;
- возможность горизонтально запустить несколько API/worker процессов.

Не даст:

- лучшего распознавания бледного или повёрнутого грифа;
- ускорения рендеринга PDF и Tesseract;
- исправления тайм-аутов OCR без настройки DPI, лимитов памяти и worker.

## Целевая схема

- отдельная переменная `SCAN_DATABASE_URL` (`postgresql+psycopg://…`), **не** импорт `APP_DATABASE_URL` из web backend;
- schema **`scan`** на том же PostgreSQL-инстансе; роль с правами на schema `scan` (можно начать с той же роли, что app/chat, затем сузить);
- таблицы (имена сохранены для совместимости SQL):
  - `scan_agents` (+ `outbox_depth`, `dead_letter_depth`, `last_ingest_ok_at`)
  - `scan_tasks`
  - `scan_task_system_metrics`
  - `scan_jobs`
  - `scan_findings`
  - `scan_incidents`
  - `scan_task_file_observations`
  - `scan_artifacts`
- timestamps остаются unix epoch (`BIGINT`); JSON-поля — `TEXT` (совместимость с `_json_dumps` / `_json_loads`; фильтр pattern на PG через `::jsonb`);
- claim jobs: `FOR UPDATE SKIP LOCKED`;
- PDF/spool и archive остаются на диске.

Код: dual-backend в `ScanStore` — пустой `SCAN_DATABASE_URL` → SQLite; иначе → PostgreSQL (`scan_server/db.py`, `pg_compat.py`, `models.py`, Alembic `scan_server/alembic`).

## Безопасный порядок перехода

1. Развернуть код dual-backend (SQLite default).
2. Создать schema `scan`, применить DDL (`ensure_scan_schema` / alembic).
3. Backfill из копии SQLite:

```powershell
python scripts\migrate_scan_sqlite_to_postgres.py `
  --source-db-path data\scan_server\backups\scan_server_YYYYMMDD_HHMMSS.db `
  --target-database-url "postgresql+psycopg://USER:PASS@127.0.0.1:5432/hubit_chat" `
  --truncate
```

4. Сверить COUNT по 8 таблицам, статусы jobs, orphan finding/incident, sample checksum.
5. Storage benchmark на PG (после cutover — `tmp\scan-storage-after.json`).
6. Cutover: stop worker (+ при необходимости API write) → дельта/полный повтор backfill → выставить `SCAN_DATABASE_URL` в `.env` → restart `itinvent-scan` / `itinvent-scan-worker`.
7. Smoke: `/health` → `storage_backend=postgres`, dashboard, claim, heartbeat, ingest.
8. SQLite snapshot read-only ≥ срок retention.

Dual-write не использовать.

## Критерии переключения

- количество строк и статусов совпадает для всех **восьми** таблиц;
- отсутствуют `finding`/`incident` без существующего job;
- очередь после переключения обрабатывается без дублей;
- ни один `analysis_incomplete` не превращается в `done_clean`;
- p95 API dashboard/incidents не хуже исходного замера;
- lock/deadlock retry наблюдаемы в логах;
- rollback: убрать `SCAN_DATABASE_URL`, restart на SQLite snapshot.

## Быстрое улучшение до миграции

SQLite остаётся в WAL. Индексы `scan_jobs(created_at)` / `finished_at` уже добавлены. `VACUUM` — только в отдельное окно после резервной копии.

## Статус cutover (17–18.07.2026)

- Dual-backend в коде; production `SCAN_DATABASE_URL` → schema `scan` на `hubit_chat` (роль `hubit_chat_app`).
- Live backfill сверен (8 таблиц, orphans=0, sample checksum OK).
- `/health` → `storage_backend=postgres`.
- PM2 ecosystem читает `SCAN_DATABASE_URL` из `.env` (`scripts/pm2/ecosystem.scan.config.js`).
- Claim jobs / poll tasks: `FOR UPDATE SKIP LOCKED`.
- Hot path matches: атомарный `create_finding_and_incident(..., finalize_status=...)`.
- SQLite `data/scan_server/scan_server.db` + `data/scan_server/backups/` — rollback snapshot (не удалять).
- Rollback: убрать `SCAN_DATABASE_URL` из `.env`, пересоздать scan из ecosystem (`pm2 start scripts/pm2/ecosystem.scan.config.js`).
