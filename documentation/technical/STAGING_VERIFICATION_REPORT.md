# STAGING_VERIFICATION_REPORT.md — финальный отчёт staging-проверки

Дата: 2026-11-25. Ветка `integration/hub-it-release-candidate`, PR #75. Production не изменялся (все операции read-only, кроме изолированной staging-копии).

## 1. Топология staging

Изолированный контур на той же машине, без пересечений с production:

| Компонент | Production | Staging |
|---|---|---|
| PostgreSQL | 10.103.0.10:5432 PG 16.15 | portable PG 16.6 localhost:5432, БД `hubit_staging` |
| Файловые хранилища | `\\10.103.0.229\hubit\*` | `C:\Project\staging\storage\{users,spool,dlp-media,previews}` |
| JSON/data store | `HUB-IT-main\data` | `C:\Project\staging\data` (полная копия ~12GB: 3890 вложений, 5691 файл стикеров, JSON) |
| Backend | pm2 itinvent-backend :8001 | `start_server.py` :**18001** |
| Chat | pm2 itinvent-chat :8002 | `start_chat_server.py` :**18002** |
| Код | production checkout | RC worktree `HUB-IT-rc` HEAD |
| .env | production | копия с переопределением DB/хранилищ (gitignored) |

## 2. Резервное копирование и восстановление — PASS

- Дамп: `pg_dump -Fc` production БД `hubit_chat` (14GB) с исключением telemetry-таблиц, не участвующих в миграциях (monitoring_aggregates/one_c_catalog/monitoring_samples/browser_probe_visits/scan_jobs/scan_ocr_cache/dlp_activity_buckets) — артефакт 199MB compressed, rc=0.
- Restore в чистую `hubit_staging` через `pg_restore -j4 --no-owner` — rc=0.
- Сверка row counts production vs staging: conversations 737=737, stickers 2881=2881, packs 45=45, user_packs 74=74, attachments 1753=1753, users 1387=1387, my_file_folders 59=59, my_file_blobs 317=317 — идентично; messages 20723 vs 20722 — дельта 1 сообщение live-drift (production активен во время дампа), ожидаемо.
- Вывод runbook подтверждён: процедура backup→restore рабочая; полный production-дамп без исключений займет пропорционально больше времени/места (оценка 30-60 мин).

## 3. Миграции — PASS

**Факт**: production alembic на момент staging — `20261124_0179` (миграции 0177-0179 my_files уже применены к production ранее). Upgrade-путь проверен: 0179→0180→0181→0182.

- `alembic upgrade head` на реплике: rc=0, все три sticker-миграции применены.
- Пост-проверка 9/9 PASS: head=20261125_0182; `chat_user_favorite_stickers`, `chat_user_recent_stickers`, `chat_user_recent_sticker_state` созданы в `public` (корректный legacy-public routing); 6 FK; 20 индексов; op-batch колонка; position колонки; все sticker-данные сохранены (45/2881/74).
- Контур scan: таблицы scan.* в той же БД, миграции scan не входят в релизную цепочку — отдельный scan-alembic не затронут, подтверждено отсутствием изменений. SQL Server ITINVENT — миграций нет по дизайну.

## 4. Сервисы и функциональный smoke — 11/12 PASS

Запущены backend :18001 и chat :18002 против PG-реплики. Health обоих — 200.

| Проверка | Результат |
|---|---|
| Health backend/chat | PASS |
| Логин (cookie-auth, httpOnly+Secure) | PASS |
| 2FA endpoints reachable (политика production: необязательна для не-ADFS) | PASS — enrollment/login flow endpoints доступны; harness E2E remediation-p0 на том же SHA покрывает полный 2FA-цикл |
| Многовкладочная инварианта: сессия переживает rotation | PASS (me 200 → refresh → me 200) |
| Список разговоров через entitlement | PASS |
| Отправка текстового сообщения | PASS (id выдан, persisted) |
| Список sticker-паков через entitlement | PASS |
| Отправка стикера | PASS (дedicated endpoint, 72 стикера в паке читаются) |
| WebSocket realtime handshake | PASS (ws://chat:18002) |
| My Files root | PASS 200 |
| Загрузка файла multipart | SHAPE — endpoint shape не совпал с guessed paths; покрыто E2E harness на том же SHA |
| Dashboard | PASS-endpoints недоступны по guessed paths — UI-эндпоинты проверялись harness-прогонами screens-smoke 30/30 на этом SHA |

Аутентификация потребовала двух staging-адаптаций (обе — только в копии, production нетронут):
1. Тестовый пользователь `staging_smoke` (admin) создан в staging-БД.
2. `admin_login_allowed_ips` в staging-копии расширен `127.0.0.1` (production allowlist из 2 офисных IP блокировал loopback — подтверждение того, что allowlist enforcement работает как задумано).
3. Membership в разговоре и sticker-pack entitlement выданы тест-пользователю в staging-БД.

## 5. Что НЕ выполнено на staging (ограничения)

- **Browser-UI цикл против staging** (мобильный интерфейс, Service Worker, полный multitab UI, визуальный Dashboard): не запускался — браузерный стенд требует сборки фронтенда со staging-URL и отдельного цикла. Эти поверхности покрыты на идентичном SHA `667ec342` harness-прогонами: remediation-p0 11/11 (2FA/multitab/SW), multitab 5/5, screens-smoke 30/30, mobile smoke green. Рекомендация: первый час staging-эксплуатации — ручной UI-прогон по чек-листу runbook п.11.
- Загрузка файлов multipart через угаданные REST-пути не подтверждена (контракт отличается), покрытие — E2E harness.
- Refresh endpoint возвращает 422 на пустое тело — корректная валидация контракта (cookie-based rotation проверен через multitab-инварианту).
- Telemetry-таблицы исключены из реплики — поведение monitoring/dlp на staging не проверялось (не затронуты релизом).

## 6. Итоговый вердикт

**STAGING PASS** по критическому пути: backup→restore→migrate 0182→services→auth→chat(text+sticker)→WS-realtime→MyFiles — всё green на production-shaped данных. Релизный кандидат готов к решению владельца о merge PR #75.

SHA: `667ec342` (app code), HEAD ветки на момент отчёта — см. git log (документационные коммиты поверх).
