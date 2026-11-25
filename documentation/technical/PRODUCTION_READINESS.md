# PRODUCTION_READINESS.md — эксплуатационный runbook релиза HUB-IT

Дата подготовки: 2026-11-25. Назначение: единый runbook безопасного выпуска release-кандидата `integration/hub-it-release-candidate`.

## 1. Версии

| Параметр | Значение |
|---|---|
| Текущая production-ревизия БД | `20261118_0176` (проверено read-only на prod 2026-11-25) |
| Production PostgreSQL | 16.15 (Ubuntu, `10.103.0.10:5432`, db `hubit_chat`, user `hubit_chat_app`) |
| Layout production-БД | **legacy-public**: все 33 chat-таблицы с данными в схеме `public`; в `chat` — 4 пустых орфана (`chat_sticker_packs`, `chat_stickers`, `chat_user_sticker_packs`, `chat_event_outbox`, все 0 строк) |
| Итоговый SHA кандидата | `667ec342` (ветка `integration/hub-it-release-candidate`, включает merge main и merge-fix) |
| Последнее изменение кода приложения | `8e837468` + gate-фиксы `df0b70c9` (миграция 0178 + entitlement) |
| Целевая ревизия БД после релиза | `20261125_0182` (один head — проверено `alembic heads` на объединённом дереве) |

## 1a. Интеграция с актуальным main (2026-11-25, важно)

Во время подготовки RC в main были влиты пост-ремедиационные PR #68/#70/#71/#72 (my-files V3.x perf, AI/LLM benchmark harness, fix/a10-release-regression). Их коммиты отсутствовали в кандидате. Выполнен merge `origin/main` (af485f22) в релизную ветку (commit `c4c63572`):

- **Обнаружен и устранён форк alembic-цепочки**: и main, и RC имели разные миграции под ревизией `20261124_0178` (my_files_listing_indexes vs chat_sticker_favorites). Production на 0176, ни одна линия нигде не применена — sticker-серия перенумерована 0178/0179/0180 → **0180/0181/0182** (commit `957fac69`), DDL не изменён, только revision-id и связи цепочки. Финальный head: `20261125_0182`.
- Конфликты разрешены: `http.js` — оставлен RC CAS-протокол refresh-claim (строго сильнее, покрыт multitab E2E); `MyFiles.jsx` — версия main, т.к. она уже содержит все 7 RC-улучшений дословно + V3-эволюцию; `main.jsx` — сохранён RC bindGlobalErrorReporting, удалён устаревший grant-reload (main удалил намеренно); visual-артефакты и schema-доки — версии main.
- **Ревизии миграций в этом документе обновлены**: целевая `20261125_0182`. PG-гейт перепроверен на объединённой цепочке (см. п. 11).

## 2. Состав релиза

Все 42 PR программы ремедиации + Sticker V2, интегрированные merge'ем `82bff0c7` и gate-фиксами. Ключевые блоки: auth/security stack (FE-0198 enrollment UX, session economics), chat realtime + sticker v2 (favorites/recents/state, op-journal), My Files, scan/inventory разделение, desktop/mobile, миграции БД до 0180 включительно. Детальный состав: `documentation/technical/UNIFIED_RELEASE_CANDIDATE.md`.

## 3. Требования к окружению

- PostgreSQL ≥ 16.x (совместимо с 16.6–16.15, проверено гейтом на 16.6).
- Node `tools/node-v24.14.0-win-x64-full` на PATH для PM2.
- Место на диске БД: свободно ≥ 2× текущего размера `hubit_chat` (миграции строят индексы и добавляют колонки).
- Файловое хранилище chat-вложений/стикеров — доступно и забэкаплено (см. п. 4).
- Даунтайм-окно: chat и backend должны быть остановлены на время миграций (ниже).

## 4. Резервное копирование

### 4.1 PostgreSQL (обязательно, до любых миграций)

```
pg_dump -h 10.103.0.10 -U hubit_chat_app -Fc -f hubit_chat_prerelease_<дата>.dump hubit_chat
```

Проверка восстановления **обязательна** (не только создание дампа): восстановить дамп в изолированную БД на тестовом PG и убедиться, что `pg_restore` завершается без ошибок и count-ы ключевых таблиц совпадают:

```
createdb hubit_restore_check
pg_restore -d hubit_restore_check hubit_chat_prerelease_<дата>.dump
psql -d hubit_restore_check -c "SELECT count(*) FROM public.chat_messages; SELECT count(*) FROM public.chat_stickers;"
```

### 4.2 Файловые хранилища

Скопировать каталоги вложений/стикеров chat (пути из production `.env` — `CHAT_FILES_DIR`/sticker storage) в резервное расположение. Проверить восстановление: распаковать копию в тестовый каталог и сверить количество файлов и суммарный размер.

## 5. Порядок остановки несовместимых процессов

Миграции применяются **только при остановленных** backend/chat-процессах (schema-check fail-closed: процессы на старте сравнивают `system.alembic_version` с head и не стартуют при рассинхроне; но DDL во время работы недопустим):

```
powershell -File scripts\pm2\restart-all.ps1 -WhatIf   # проверить состав — НЕ запускать
pm2 stop all                                            # фактическая остановка (owner-approved)
```

Проверить, что нет активных подключений приложения к БД:

```
psql -c "SELECT pid, application_name, state FROM pg_stat_activity WHERE datname='hubit_chat' AND pid <> pg_backend_pid();"
```

Завершить/подождать оставшиеся сессии. Не использовать `pg_terminate` для системных процессов.

## 6. Последовательность миграций

Проверено гейтом на точной реплике production (schema-only дамп + alembic `0176` + реальные sticker-данные): upgrade `0176 → 0180` проходит чисто (rc 0), все 8 пост-проверок PASS.

```
cd <repo>/WEB-itinvent
set ALEMБIC_DATABASE_URL=postgresql+psycopg://<prod-dsn>   # или -x url=...
alembic -c backend/alembic.ini current                      # ожидание: 20261118_0176
alembic -c backend/alembic.ini upgrade head                 # до 20261125_0182
alembic -c backend/alembic.ini current                      # проверка: 20261125_0182
```

Ключевые свойства, подтверждённые гейтом:
- **0178 самовосстанавливается**: если базовые sticker-таблицы отсутствуют (исторический баг детекции 0085/0086 на legacy-public), они создаются в схеме фактического размещения chat-данных (`public` на prod) до создания зависимых favorites/recents. Сценарий проверен: таблицы удалены в обеих схемах → восстановлены в `public` с корректными FK.
- **Данные сохраняются**: sticker packs/stickers/user-packs и их содержимое не затрагиваются destructive-операциями; `position` добавляется с сохранением данных; favorites/recents/state создаются в `public` рядом с базовыми таблицами.
- **Повторный upgrade — no-op**: миграции идемпотентны, alembic не переприменяет уже stamped ревизии.
- **Прерванная миграция**: восстановление проверено (прерывание посередине цепочки → повторный upgrade доводит до head без ошибок).
- **Invalid concurrent index**: сценарий убитого `CREATE INDEX CONCURRENTLY` — 0174 детектирует invalid index и перестраивает его (проверено на реальном terminate backend'а построения индекса).
- **Realtime relay/presence**: таблицы валидны в `public` после upgrade; runtime-валидация PASS.

Если upgrade падает — **не применять повторно вслепую** и не править БД вручную: снять ошибку, свериться с пунктом 10 (rollback), эскалация владельцу.

## 7. Порядок запуска после миграций

Строго через штатные скрипты (они чистят orphan-процессы и порты; голый `pm2 restart` запрещён):

```
powershell -File scripts\pm2\restart-backend.ps1    # backend + scan
powershell -File scripts\pm2\restart-chat.ps1       # split chat realtime
```

Frontend публикуется через `scripts/iis/publish_frontend_iis.ps1` (IIS отдаёт `C:\inetpub\wwwroot\itinvent`; **не** `npm run build` в dist — это не deploy). Комбинированный вариант: `scripts/deploy.ps1` (publish + restart-all + health-check).

## 8. Service Worker

В релиз входит обновлённый SW (фикс в gate-фазе). После публикации frontend: пользователям достаточно обычного обновления страницы — SW обновится по стандартному жизненному циклу. Принудительный skipWaiting не требуется; при проблемах — очистка site data вручную на клиенте.

## 9. Health-check и smoke-тесты после выпуска

```
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
- миграция падает с ошибкой на любом шаге (особенно FK/index в sticker-миграциях 0180-0182 и concurrent-индексах 0174/0178);
- после upgrade `alembic current` ≠ `20261125_0180`;
- backend/chat не стартуют (schema_migration_check fail);
- realtime недоступен после старта;
- потеря/повреждение данных sticker/сообщений (несовпадение count с бэкапом).

### Rollback-план

**Принцип: downgrade БД не выполняется без доказанной совместимости.** Миграции 0177→0182 добавляют колонки/таблицы — обратная совместимость со старым кодом **не доказана** (старый код может не ожидать новых колонок/NOT NULL дефолтов). Поэтому:

1. **Откат приложения** (код/frontend/backend на прежнюю версию) — допустим только после проверки совместимости схемы 0180 со старым кодом. До такой проверки приложение не откатывается на старую версию против мигрированной БД.
2. **Откат БД** — только восстановлением из дамка п. 4.1 в новую/очищенную БД с переключением DSN. Это единственный безопасный путь.
3. Frontend-rollback — публикация прежнего build через `publish_frontend_iis.ps1` из сохранённого артефакта.
4. Все rollback-действия — только с явного разрешения владельца.

## 11. PostgreSQL Release Gate — результаты (изолированный PG 16.6, port 54329)

| Сценарий | Результат |
|---|---|
| S1 fresh install (пустая БД → head) | **PASS** — всё в `chat` схеме консистентно; re-upgrade no-op PASS |
| S2 production-like: точная реплика (prod schema dump + alembic 0176 + sticker-данные в public + орфаны в chat) upgrade 0176→0180 | **PASS 8/8** — версия 0180; favorites/recents/state в `public`; position добавлен с сохранением данных; sticker-данные целы; FK → `public.chat_stickers`; орфаны в `chat` нетронуты (0 строк); `applied_op_batch_ids` есть; realtime-таблицы валидны в `public` |
| S2b re-upgrade no-op | **PASS** — миграции не переприменяются |
| S3 прерванная миграция → resume | **PASS** — доводка до 0180, recents-таблица + индексы корректны |
| S4 repair: базовые таблицы удалены в обеих схемах, 0086 stamped | **PASS** — 0178 восстановила trio в `public` (3/3), FK=1 |
| S5 realtime relay/presence валидация на prodlike-public | **PASS** — schema=public, missing=none |
| S6 invalid concurrent index (реально убитый CREATE INDEX CONCURRENTLY: backend terminated mid-build, indisvalid=false) → 0174 | **PASS** — индекс перестроен до valid state, 800000 строк сохранены |
| `pytest tests/test_pg_sticker_gate.py` на реальном PG | **PASS 2/2** |
| U1-U8 union-chain (после merge main + перенумерации): prodlike 0176→0182, favorites/recents/state в public, position/op_batch колонки, myfiles updated_at, FK, re-upgrade no-op, downgrade head→0177 | **PASS** — все проверки green |

Тестовый инстанс: portable PostgreSQL 16.6 (совместим с prod 16.15 — одна major-версия), изолированный кластер, production не использовался для тестов.

## 12. Security Gate — результаты

- **Sticker entitlement**: устранён forgery-вектор leg-3 — `media_kind='sticker'` фильтр добавлен; crafted filename `sticker-<id>--x.png` больше не даёт доступа. Коммит `df0b70c9`, тесты 29+15 green.
- **FE-0198 enrollment**: серверной enforcement-границы нет by design — session economics (30 мин idle для внешней untrusted-сессии vs 7 дней trusted). Классификация обязательной политики vs рекомендованного UX — решение владельца: `documentation/technical/FE0198_ENROLLMENT_POLICY_DECISION.md` (варианты A/B).
- **Sticker import**: лимиты размера есть (5MB/стикер, 100MB/пакет, ≤200 стикеров, семафор параллельности 6), но **per-user rate-limit на `POST /sticker-packs/import` отсутствует**. Смягчающие факторы: требуется permission `PERM_CHAT_WRITE`, внутрикорпоративная платформа, импорт bounded по размеру. Остаточный риск: авторизованный пользователь может инициировать повторные импорты с внешней нагрузкой на Telegram API. Рекомендация (не блокер, решение владельца): добавить per-user rate-limit в следующей итерации.
- Существующие механизмы защиты не ослаблены.

## 13. Регрессия на итоговом SHA

| Проверка | Результат | Конфигурация |
|---|---|---|
| Vitest полный на финальном SHA | 5218 passed / 12 failed / 2 skipped | тот же failure signature, что классифицированный baseline (9 pre-existing идентичны `cfc5e012`, Tasks/Database — flaky под нагрузкой, 107/107 в изоляции) |
| pytest backend полный | 6620 passed / 70 failed / 78 skipped | классификация: см. UNIFIED_RELEASE_VERIFICATION.md + финальный baseline-compare (приложение ниже) |
| P0 E2E | 11/11 PASS | local stack, E2E_FILES_WORKER=1 |
| Multitab auth | 5/5 PASS | |
| Sticker V2 E2E (units + visual + emoji-picker) | green | |
| Файлы/стикеры отправка, recents sync, WS, SW | green (E2E на dev-стеке с живым WS) | |
| My Files | 13/13 admin после фикса ruRU-пагинации теста | |
| Desktop/mobile smoke | ALL GREEN на prod-билде, mobile 390px viewport | |
| FE-0023 perf gate на RC-билде | паритет с baseline: mobile settle 1665/1010ms, DOM 2393/1760, scroll p95 34ms 0 janky | prod build |
| Login/dashboard perf | cold login p50 2.2s, warm dashboard 319ms | |

Известное ограничение харнесса: ad-hoc serve-prod не проксирует WS-upgrade → chat perf на production build с полноценным WS не измерялся (стенд не позволяет); chat-функционал полностью покрыт E2E на dev-стеке с живым WS.

## 14. Открытые решения владельца (не блокеры выпуска, но требуют решения)

1. FE-0198: вариант A (принять session economics как enforcement) или вариант B (mandatory server-side enrollment — отдельная задача). См. FE0198_ENROLLMENT_POLICY_DECISION.md.
2. Per-user rate-limit на sticker import — добавить или принять риск.
3. Offline op-journal recents — in-memory persistence (известное accepted limitation).

## 15. Что запрещено без отдельного разрешения

Force-push ветки, merge в main, production-миграции, deploy, закрытие исходных PR — только по явной команде владельца.
