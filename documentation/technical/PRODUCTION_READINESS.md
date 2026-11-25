# PRODUCTION_READINESS.md — эксплуатационный runbook релиза HUB-IT

Дата подготовки: 2026-11-25 (обновлено после merge main и перенумерации миграций). Назначение: единый runbook безопасного выпуска release-кандидата `integration/hub-it-release-candidate`.

## 1. Версии

| Параметр | Значение |
|---|---|
| Текущая production-ревизия БД | `20261124_0179` (read-only проверка 2026-11-25 при staging: миграции 0177-0179 my_files уже применены). **Перед реальным выпуском повторно проверить `alembic current`** — стартовая ревизия может измениться |
| Production PostgreSQL | 16.15 (Ubuntu, `10.103.0.10:5432`, db `hubit_chat`, user `hubit_chat_app`) |
| Layout production-БД | **legacy-public**: все 33 chat-таблицы с данными в схеме `public`; в `chat` — 4 пустых орфана (`chat_sticker_packs`, `chat_stickers`, `chat_user_sticker_packs`, `chat_event_outbox`, все 0 строк) |
| Итоговый SHA кандидата | `3474bb94` (ветка `integration/hub-it-release-candidate`, запушена, PR #75) |
| Последнее изменение кода приложения | `667ec342` (merge-fix MyFiles.jsx); далее только docs |
| Целевая ревизия БД после релиза | `20261125_0182` (один head — проверено `alembic heads` на объединённом дереве) |

## 1a. Интеграция с актуальным main (2026-11-25, важно)

Во время подготовки RC в main были влиты пост-ремедиационные PR #68/#70/#71/#72 (my-files V3.x perf, AI/LLM benchmark harness, fix/a10-release-regression). Их коммиты отсутствовали в кандидате. Выполнен merge `origin/main` (af485f22) в релизную ветку (commit `c4c63572`):

- **Обнаружен и устранён форк alembic-цепочки**: и main, и RC имели разные миграции под ревизией `20261124_0178` (my_files_listing_indexes vs chat_sticker_favorites). Production на 0176, ни одна линия нигде не применена — sticker-серия перенумерована 0178/0179/0180 → **0180/0181/0182** (commit `957fac69`), DDL не изменён, только revision-id и связи цепочки. Финальный head: `20261125_0182`.
- Конфликты разрешены: `http.js` — оставлен RC CAS-протокол refresh-claim (строго сильнее, покрыт multitab E2E); `MyFiles.jsx` — byte-exact версия main (она уже содержит все 7 RC-улучшений дословно + V3-эволюцию; в merge-коммит initially попали conflict-маркеры — исправлено commit `667ec342`, подтверждено тестами); `main.jsx` — сохранён RC bindGlobalErrorReporting, удалён устаревший grant-reload (main удалил намеренно); visual-артефакты и schema-доки — версии main.
- **Все ссылки на ревизии в этом документе — финальные** (после перенумерации). Исторические результаты PG-гейта до перенумерации вынесены в п. 11.2 с явной пометкой.

## 2. Состав релиза

Все 42 PR программы ремедиации + Sticker V2 + пост-ремедиационные изменения main (my-files V3.x perf, AI/LLM harness, a10-regression fixes). Ключевые блоки: auth/security stack (FE-0198 enrollment UX, session economics), chat realtime + sticker v2 (favorites/recents/state, op-journal), My Files, scan/inventory разделение, desktop/mobile, миграции БД до `20261125_0182` включительно. Детальный состав: `documentation/technical/UNIFIED_RELEASE_CANDIDATE.md`.

## 3. Требования к окружению

- PostgreSQL ≥ 16.x (совместимо с 16.6–16.15, проверено гейтом на 16.6).
- Node `tools/node-v24.14.0-win-x64-full` на PATH для PM2.
- Место на диске БД: свободно ≥ 2× текущего размера `hubit_chat` (миграции строят индексы и добавляют колонки).
- Все файловые хранилища доступны и забэкаплены (см. п. 4).
- Даунтайм-окно: chat и backend должны быть остановлены на время миграций (ниже).

## 4. Резервное копирование — полный перечень затронутых контуров

Релиз затрагивает не только chat. Обязательный перечень бэкапов:

### 4.1 PostgreSQL `hubit_chat` — все схемы (system, chat, app, scan, public)

Миграции релиза затрагивают схемы `app` (my-files индексы/колонки), `public`/`chat` (sticker-таблицы, realtime), `system` (alembic_version). Дамп всей БД целиком:

```
pg_dump -h 10.103.0.10 -U hubit_chat_app -Fc -f hubit_chat_prerelease_<дата>.dump hubit_chat
```

Проверка восстановления **обязательна** (не только создание дампа): восстановить дамп в изолированную БД на тестовом PG и убедиться, что `pg_restore` завершается без ошибок и count-ы ключевых таблиц совпадают:

```
createdb hubit_restore_check
pg_restore -d hubit_restore_check hubit_chat_prerelease_<дата>.dump
psql -d hubit_restore_check -c "SELECT count(*) FROM public.chat_messages; SELECT count(*) FROM public.chat_stickers; SELECT count(*) FROM app.my_files;"
```

### 4.2 SQL Server ITINVENT

Миграции релиза SQL Server не затрагивают (source of truth legacy-инвентаря, только чтение/прикладные операции). Полноценный бэкап — штатное регламентное задание SQL Server; перед релизом достаточно убедиться, что регламентный бэкап свежий (проверить дату последнего backup через `msdb.dbo.backupset`). Отдельный релизный бэкап не требуется, но рекомендуется.

### 4.3 Файловые хранилища (production-пути из `.env`)

| Хранилище | Production-путь | Что там |
|---|---|---|
| `HUBIT_STORAGE_UNC` | `\\10.103.0.229\hubit` | корень сетевого хранилища |
| `MY_FILES_STORAGE_DIR` | `\\10.103.0.229\hubit\users` | durable user files (per-user) |
| `MY_FILES_SPOOL_DIR` | `\\10.103.0.229\hubit\spool` | spool загрузок/обработки |
| `DLP_MEDIA_STORAGE_DIR` | `\\10.103.0.229\hubit\dlp-media` | DLP media |
| `MY_FILES_PREVIEWS_DIR` | default (внутри storage) | превью my-files |
| data_dir backend | локальный каталог backend-процесса | chat-вложения, sticker pack storage (`chat_sticker_packs/`), runtime JSON |

Копирование: robocopy/rsync каждого корня в резервное расположение. Проверка восстановления: распаковать копию в тестовый каталог и сверить количество файлов и суммарный размер; для sticker storage — сверить count файлов с count строк `public.chat_stickers`.

### 4.4 JSON data-файлы (`data/*.json`)

Разделяются web и ботом (transfers, cleanings, replacements, user_db_selection и др.). Копируются простым файл-копированием каталога `data/`; проверка — валидность JSON и count записей выборочно.

### 4.5 Прочие артефакты

`transfer_acts/` (сгенерированные акты), frontend build-каталог IIS `C:\inetpub\wwwroot\itinvent` (для frontend-rollback — сохранить копию текущего build до публикации нового).

## 5. Порядок остановки несовместимых процессов

Миграции применяются **только при остановленных** backend/chat-процессах (schema-check fail-closed: процессы на старте сравнивают `system.alembic_version` с head и не стартуют при рассинхроне; но DDL во время работы недопустим):

```powershell
powershell -File scripts\pm2\stop-all.ps1     # штатная остановка всех PM2-процессов
```

Проверить, что нет активных подключений приложения к БД:

```
psql -c "SELECT pid, application_name, state FROM pg_stat_activity WHERE datname='hubit_chat' AND pid <> pg_backend_pid();"
```

Завершить/подождать оставшиеся сессии. Не использовать `pg_terminate` для системных процессов.

## 6. Последовательность миграций

Проверено гейтом на точной реплике production на финальной цепочке (после перенумерации): upgrade `0176 → 0182` (полная цепочка) и `0179 → 0182` (staging от фактической production-ревизии) проходит чисто (rc 0), все пост-проверки PASS (п. 11.1).

Команды — PowerShell (рабочая оболочка проекта):

```powershell
cd <repo>\WEB-itinvent
$env:ALEMBIC_DATABASE_URL = "postgresql+psycopg://<prod-dsn>"   # либо параметр: alembic -x url=<dsn>
python -m alembic -c backend\alembic.ini current                # ожидание: 20261124_0179 (перепроверить перед выпуском)
python -m alembic -c backend\alembic.ini upgrade head           # до 20261125_0182
python -m alembic -c backend\alembic.ini current                # проверка: 20261125_0182
```

Ключевые свойства, подтверждённые гейтом на финальной цепочке:
- **0180 (chat_sticker_favorites) самовосстанавливается**: если базовые sticker-таблицы отсутствуют (исторический баг детекции 0085/0086 на legacy-public), они создаются в схеме фактического размещения chat-данных (`public` на prod) до создания зависимых favorites/recents. Сценарий проверен: таблицы удалены в обеих схемах → восстановлены в `public` с корректными FK.
- **Данные сохраняются**: sticker packs/stickers/user-packs не затрагиваются destructive-операциями; `position` добавляется в `chat_user_sticker_packs`/`chat_user_recent_stickers` с сохранением данных; favorites/recents/state создаются в `public` рядом с базовыми таблицами.
- **Повторный upgrade — no-op**: миграции идемпотентны, alembic не переприменяет уже stamped ревизии.
- **Прерванная миграция**: восстановление проверено (прерывание посередине цепочки → повторный upgrade доводит до head без ошибок).
- **Invalid concurrent index**: сценарий реально убитого `CREATE INDEX CONCURRENTLY` — 0174 детектирует invalid index и перестраивает его (проверено end-to-end: terminate backend mid-build, indisvalid=false → valid, 800k строк сохранены).
- **Realtime relay/presence**: таблицы валидны в `public` после upgrade; runtime-валидация PASS.
- **my-files миграции main (0178/0179)** входят в ту же линейную цепочку и применяются перед sticker-серией — проверено на union-реплике (`updated_at` на `app.my_file_collaborators` и listing-индексы присутствуют).

Если upgrade падает — **не применять повторно вслепую** и не править БД вручную: снять ошибку, свериться с пунктом 10 (rollback), эскалация владельцу.

## 7. Порядок запуска после миграций

Строго через штатные скрипты (они чистят orphan-процессы и порты; голый `pm2 restart` запрещён):

```powershell
powershell -File scripts\pm2\restart-backend.ps1    # backend + scan (включает restart-scan)
powershell -File scripts\pm2\restart-chat.ps1       # split chat realtime
powershell -File scripts\pm2\restart-my-files-worker.ps1   # my-files worker (очередь обработки файлов)
```

Проверено: все перечисленные скрипты существуют в `scripts\pm2\` репозитория. Frontend публикуется через `scripts\iis\publish_frontend_iis.ps1` (IIS отдаёт `C:\inetpub\wwwroot\itinvent`; **не** `npm run build` в dist — это не deploy). Комбинированный вариант: `scripts\deploy.ps1` (publish + restart-all + health-check).

## 8. Service Worker

В релиз входит обновлённый SW (фикс в gate-фазе). После публикации frontend: пользователям достаточно обычного обновления страницы — SW обновится по стандартному жизненному циклу. Принудительный skipWaiting не требуется; при проблемах — очистка site data вручную на клиенте.

## 9. Health-check и smoke-тесты после выпуска

```powershell
powershell -File scripts\pm2\health-check.ps1        # без -RepairBackend/-RepairScan
```

Smoke-минимум (вручную, 5–10 минут):
1. Логин внешним пользователем (password/TOTP) — сессия создаётся, редирект на enrollment-gate корректный.
2. Чат: отправка текстового сообщения, получение realtime (вторая вкладка/клиент).
3. Стикеры: открытие picker, отправка стикера, favorites/recents обновляются.
4. My Files: список файлов грузится, скачивание одного файла.
5. WebSocket: в devtools нет ошибок reconnect-шторма.

## 10. Критерии остановки выпуска и rollback

**Немедленная остановка выпуска**, если:
- миграция падает с ошибкой на любом шаге (особенно FK/index в sticker-миграциях 0180–0182 и my-files concurrent-индексах 0178);
- после upgrade `alembic current` ≠ `20261125_0182`;
- backend/chat не стартуют (schema_migration_check fail);
- realtime недоступен после старта;
- потеря/повреждение данных sticker/сообщений/файлов (несовпадение count с бэкапом).

### Rollback-план

**Принцип: downgrade БД не выполняется без доказанной совместимости.** Миграции 0177→0182 добавляют колонки/таблицы/индексы — обратная совместимость со старым кодом **не доказана** (старый код может не ожидать новых колонок/NOT NULL дефолтов). Поэтому:

1. **Откат приложения** (код/frontend/backend на прежнюю версию) — допустим только после доказанной проверки совместимости схемы **0182** со старым кодом. До такой проверки приложение не откатывается на старую версию против мигрированной БД.
2. **Откат БД** — только восстановлением из дампа п. 4.1 в новую/очищенную БД с переключением DSN. Это единственный безопасный путь.
3. **Откат файловых хранилищ** — восстановление из копий п. 4.3–4.4, если релизная логика успела переместить/переименовать файлы (в текущем составе релиза таких операций нет, но проверить по журналу worker'ов).
4. Frontend-rollback — публикация прежнего build через `publish_frontend_iis.ps1` из сохранённой копии `C:\inetpub\wwwroot\itinvent` (п. 4.5).
5. Все rollback-действия — только с явного разрешения владельца.

## 11. PostgreSQL Release Gate — результаты (изолированный PG 16.6, port 54329)

### 11.1 Актуальные результаты — финальная цепочка после merge main и перенумерации (head `20261125_0182`)

| Сценарий | Результат |
|---|---|
| U1 union-chain prodlike upgrade 0176→0182 (точная реплика prod-схемы, legacy-public, sticker-данные seeded) | **PASS** — rc 0, версия `20261125_0182` |
| U2 favorites/recents/state размещение | **PASS** — `chat_user_favorite_stickers`, `chat_user_recent_stickers`, `chat_user_recent_sticker_state` созданы в `public` |
| U3 сохранность sticker-данных | **PASS** — packs/stickers целы после upgrade |
| U4 колонки `position`/`applied_op_batch_ids` | **PASS** — position в `chat_user_sticker_packs` и `chat_user_recent_stickers`, op_batch в state-таблице |
| U5 my-files миграции main в той же цепочке | **PASS** — `updated_at` на `app.my_file_collaborators` присутствует |
| U6 FK favorites | **PASS** — fk=1, корректные ссылки |
| U7 re-upgrade no-op | **PASS** — миграции не переприменяются |
| U8 downgrade head→0177 | **PASS** — sticker-таблицы снимаются, версия 0177 |
| S6 invalid concurrent index (реально убитый CREATE INDEX CONCURRENTLY: backend terminated mid-build, indisvalid=false) → 0174 | **PASS** — индекс перестроен до valid state, 800000 строк сохранены |
| `pytest tests/test_pg_sticker_gate.py` на реальном PG против финальной цепочки | **PASS 2/2** |

### 11.2 Исторические результаты — цепочка ДО перенумерации (head был `20261125_0180`, sticker-миграции под номерами 0178–0180)

Выполнялись на pre-merge кандидате; DDL-логика миграций с тех пор не менялась (только revision-id и связи цепочки), поэтому доказательная сила сохраняется, но номера ревизий в строках ниже — старые:

| Сценарий | Результат |
|---|---|
| S1 fresh install (пустая БД → head) | **PASS** — всё в `chat` схеме консистентно; re-upgrade no-op PASS |
| S2 production-like: точная реплика (prod schema dump + alembic 0176 + sticker-данные в public + орфаны в chat) upgrade 0176→0180 | **PASS 8/8** — версия 0180; favorites/recents/state в `public`; sticker-данные целы; FK → `public.chat_stickers`; орфаны в `chat` нетронуты (0 строк); realtime-таблицы валидны |
| S2b re-upgrade no-op — исторические правки миграций не вызывают их повторного выполнения | **PASS** |
| S3 прерванная миграция → resume | **PASS** — доводка до head, recents-таблица + индексы корректны |
| S4 repair: базовые таблицы удалены в обеих схемах, 0086 stamped | **PASS** — sticker-миграция восстановила trio в `public` (3/3), FK=1 (та же логика теперь в 0180) |
| S5 realtime relay/presence валидация на prodlike-public | **PASS** — schema=public, missing=none |

Тестовый инстанс: portable PostgreSQL 16.6 (совместим с prod 16.15 — одна major-версия), изолированный кластер, production не использовался для тестов.

## 12. Security Gate — результаты

- **Sticker entitlement**: устранён forgery-вектор leg-3 — `media_kind='sticker'` фильтр добавлен; crafted filename `sticker-<id>--x.png` больше не даёт доступа. Коммит `df0b70c9`, тесты 29+15 green.
- **FE-0198 enrollment**: серверной enforcement-границы нет by design — session economics (30 мин idle для внешней untrusted-сессии vs 7 дней trusted). Классификация обязательной политики vs рекомендованного UX — решение владельца: `documentation/technical/FE0198_ENROLLMENT_POLICY_DECISION.md` (варианты A/B).
- **Sticker import**: лимиты размера есть (5MB/стикер, 100MB/пакет, ≤200 стикеров, семафор параллельности 6), но **per-user rate-limit на `POST /sticker-packs/import` отсутствует**. Смягчающие факторы: требуется permission `PERM_CHAT_WRITE`, внутрикорпоративная платформа, импорт bounded по размеру. Остаточный риск: авторизованный пользователь может инициировать повторные импорты с внешней нагрузкой на Telegram API. Рекомендация (не блокер, решение владельца): добавить per-user rate-limit в следующей итерации.
- Существующие механизмы защиты не ослаблены.

## 13. Регрессия на итоговом SHA

| Проверка | Результат | Конфигурация |
|---|---|---|
| Vitest полный на финальном SHA `667ec342` | **5226 passed / 13 failed / 2 skipped** (722 файла, 5241 тест) | failure signature = классифицированный baseline: compose-prefill доказан pre-existing (тест и impl byte-identical baseline `cfc5e012`), Tasks/Database — flaky под нагрузкой (107/107 в изоляции), остальные идентичны baseline |
| pytest backend полный | 6620 passed / 70 failed / 78 skipped | исчерпывающая same-env классификация: 56 nodeids подтверждены падающими на baseline bulk-прогоном + 14 suspect direct-rerun идентичны в обоих окружениях (13 failed/1 passed в обоих) — **ноль регрессий** |
| P0 E2E | 11/11 PASS | local stack, E2E_FILES_WORKER=1 |
| Multitab auth | 5/5 PASS | |
| Sticker V2 E2E (units + visual + emoji-picker) | green | |
| Файлы/стикеры отправка, recents sync, WS, SW | green (E2E на dev-стеке с живым WS) | |
| My Files | 13/13 admin + suite 65/65 после merge-fix | |
| Desktop/mobile smoke | ALL GREEN на prod-билде, mobile 390px viewport | |
| Merge-дельта верификация | http.js client.test 265/265, refreshCoordination PASS, requestOrdering 17/17, production build PASS на union-дереве | SHA `667ec342` |
| FE-0023 perf gate на RC-билде | паритет с baseline: mobile settle 1665/1010ms, DOM 2393/1760, scroll p95 34ms 0 janky | prod build (pre-merge SHA) |
| Login/dashboard perf | cold login p50 2.2s, warm dashboard 319ms | |

Известные ограничения харнесса: ad-hoc serve-prod не проксирует WS-upgrade → chat perf на production build с полноценным WS не измерялся (стенд не позволяет); полный E2E-прогон поверх финального merge-SHA целиком не повторялся (merge-дельта покрыта адресно); compact-ux visual baselines после merge требуют регенерации при первом прогоне.

## 14. Открытые решения владельца (не блокеры выпуска, но требуют решения)

См. сводный backlog `documentation/technical/POST_RELEASE_BACKLOG.md` — там же FE-0215, FE-0064, OPEN-записи аудита и baseline-fail тесты.

## 15. Что запрещено без отдельного разрешения

Force-push ветки, merge в main, production-миграции, deploy, закрытие исходных PR — только по явной команде владельца.
