# Scan Architecture (MVP)

План безопасного переноса очереди и инцидентов в PostgreSQL и базовые замеры: [SCAN_POSTGRES_MIGRATION.md](./SCAN_POSTGRES_MIGRATION.md).

## OCR capacity and measurements

- The worker runs up to 4 jobs and 4 OCR tasks concurrently in production and uses Windows `BelowNormal` priority.
- Ingest backpressure starts at 200 pending documents; agents persist deferred uploads in the local outbox.
- Full-page rendering is capped at 20 million pixels. A3 remains at a true 300 DPI.
- Large A2/A1/A0 sheets also get four direct PDF clip renders for header/footer corners at up to 400 DPI,
  capped at 12 million pixels per clip. The clips are rendered from the PDF, not cropped from a downscaled page.
- The three-page PDF slice is capped at 50 MiB; an oversize or damaged slice is `analysis_incomplete`, never clean.
- Every job records queue, processing, OCR and conversion times plus effective render DPI. The dashboard reports
  24-hour throughput, p50/p95 latency, oldest pending age and downscaled-page count.
- While a scan task is active, server CPU, memory, disk and network counters are sampled every 5 seconds into
  `scan_task_system_metrics`; use `GET /api/v1/scan/tasks/{task_id}/system-metrics` for the timeline and summary.
- On worker restart, interrupted `processing` jobs are immediately requeued without deleting their transient spool.
- Repeat a real-folder measurement with
  `python scripts\benchmark_scan_ocr.py <path> --require-prefix dsp_ --json-output <report.json>`.
- Repeat the large-sheet control with
  `python scripts\benchmark_scan_large_page.py --json-output <report.json>`.

## Цель

Добавить контур поиска чувствительных документов без влияния на текущий backend инвентаризации.

## Компоненты

1. `scan_agent/agent.py`
- Сканирует Windows Known Folders (`Desktop`, `Documents`, `Downloads`), OneDrive Personal/Business
  и дополнительные каталоги из `SCAN_AGENT_EXTRA_ROOTS` (включая UNC). Целые диски автоматически не обходятся.
- Watchdog отслеживает изменения в этих папках в реальном времени.
- Хэширует файлы и сохраняет state в `%ProgramData%\IT-Invent\ScanAgent\scan_agent_state.json`.
- Не пересканирует неизмененные/уже обработанные файлы.
- PDF:
  - текстовый слой проверяется локально максимум на первых 10 страницах;
  - независимо от качества текстового слоя всегда отправляется только фрагмент первых 3 страниц для OCR;
  - полный PDF на сервер не передаётся.
- Изображения (`JPG/PNG/TIFF/BMP/WEBP`) и Office/ODF отправляются через `/ingest/document`;
  Office временно конвертируется LibreOffice, после чего OCR получает только первые 3 страницы.
- Текстовые файлы читаются потоково целиком, включая UTF-16.
- `analysis_version` в state заставляет повторно проверить файл после изменения OCR или правил.
- Polling задач: `ping`, `scan_now`.

2. `scan_server/app.py` (FastAPI, порт `127.0.0.1:8011`)
- API приема (`/ingest`, `/ingest/pdf-slice`, `/ingest/document`, `/heartbeat`), очереди задач
  (`/tasks/poll`, `/tasks/{id}/result`), UI (`/incidents`, `/review-items`, `/dashboard`, `/agents`).
- SQLite база: `data/scan_server/scan_server.db`.
- Worker обрабатывает задания последовательно и создает инциденты.
- OCR: `rus`, 300 DPI для страницы и усиленная проверка верхней/нижней области в масштабе 400 DPI. Для русскоязычных грифов это снижает путаницу похожих кириллических и латинских букв; типовые OCR-подмены дополнительно нормализуются правилами.
- Неполный анализ получает финальный статус `analysis_incomplete` и никогда не считается `done_clean`.

3. IIS reverse proxy
- `/api/v1/scan/*` -> `127.0.0.1:8011`
- `/api/*` -> `127.0.0.1:8001` (основной backend)

4. Frontend
- Страница `Scan Center` (`/scan-center`) с:
  - сводкой,
  - графиками (severity/филиалы/динамика),
  - статусами агентов/очередей,
  - инцидентами и ACK,
  - списком «Не удалось проверить» с хостом, путём и причиной,
  - явной политикой: «OCR — первые 3 страницы; текстовый слой — до 10 страниц».

## Очередь оффлайн-команд

- Таблица `scan_tasks`.
- Статусы: `queued -> delivered -> acknowledged -> completed|failed|expired`.
- `scan_now` остаётся `acknowledged`, пока агент не передаст `ingest_complete=true` и все связанные server jobs
  не выйдут из `queued|processing`; ранний `completed` от агента не обходит эту проверку.
- Если агент оффлайн: задачи остаются в `queued`.
- При poll доставляются по FIFO.
- TTL по умолчанию: 7 дней (`SCAN_TASK_TTL_DAYS`).
- Повторная доставка: backoff до 15 минут при отсутствии результата.

## Retention

- По умолчанию 90 дней (`SCAN_RETENTION_DAYS`).
- Worker раз в час чистит старые инциденты/задачи/артефакты.
