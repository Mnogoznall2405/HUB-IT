# UNIFIED_RELEASE_CANDIDATE — объединённый релиз-кандидат HUB-IT

Ветка: `integration/hub-it-release-candidate` (worktree `C:\Project\HUB-IT-rc`).
Merge: `82bff0c7` = remediation-final (`cfc5e012`) + integration/frontend-remediation (`1a2a7a0b`, включая Sticker V2 PR #69 и post-merge стабилизацию).
Финальный SHA на момент отчёта: `8e837468` (поверх merge — release-gate фиксы, фиксы независимого ревью, test-only коммиты).

Детальные доказательства прогонов: [UNIFIED_RELEASE_VERIFICATION.md](UNIFIED_RELEASE_VERIFICATION.md).

## Состав кандидата

- **Сторона A (cfc5e012)**: FE-0023 производительность списков оборудования/розеток (chunked progressive rendering на mobile, react-window на desktop), My Files compact UX + virtualization, мультивкладочная координация refresh (FE-0083), release-gate инфраструктура (p0-стенд, FE-0059/0198 strict).
- **Сторона B (1a2a7a0b)**: Sticker V2 (Telegram-импорт паков, favorites/recents с op-journal синхронизацией, per-user ordering, suggestions, search index), emoji-picker dock/overlay, chat-улучшения.
- **Post-merge фиксы кандидата** (уникальные для этой ветки):
  - `6387fa80` — FE-0198: гейт обязательной регистрации trusted-device переживает F5 (race auto-passkey vs enrollment dialog); SW `navigator.setAppBadge` mojo-crash в chrome-headless-shell заглушён webdriver-гейтом на странице.
  - `8e837468` — фиксы независимого ревью: миграции 0085/0086/0174, сериализация flush'ей recents, file-loss в sticker send-path, честный DnD-тест.

## Вердикт по воротам

| Ворота | Результат |
|---|---|
| Release Gate p0 E2E | **11/11** (FE-0059 strict, FE-0198 strict incl. F5, ChatCallsProvider lifecycle hardened) |
| FE-0083 multitab | **5/5** (2/3/5/10 вкладок, HTTP-fallback, dead-storage, mid-refresh close) |
| Sticker V2 units | **122 frontend + 72 backend** green |
| Sticker E2E / visual / emoji-picker | **6/6, 5/5, 15/15** |
| screens-smoke | **30/30** |
| my-files-admin | **13/13** (после фикса ruRU-локализации пагинации — baseline-дефект теста) |
| vitest полный | 5217 passed, 13 failed — **все классифицированы**: 9 идентичны baseline `cfc5e012` (5 файлов), Tasks/Database проходят в изоляции (flaky под нагрузкой полного прогона). Регрессий merge нет |
| pytest полный | 6620 passed / 70 failed / 78 skipped — классификация: env-зависимые сьюты (bot token, voice deps, watchdog, CHAT_ENABLED) + **pre-existing baseline-падения** (сэмплы подтверждены идентичными падениями на `cfc5e012`); см. verification-документ |
| Миграции | single head `20261125_0180`, цепочка целостна (183 ревизии), блокер legacy-public schema **исправлен** |
| FE-0023 prod bench | **паритет** с исправленным baseline: mobile settle 1665/1010ms, DOM 2393/1760, scroll p95 34ms 0 janky |
| Login/dashboard perf | cold login p50 2232ms, warm dashboard p50 319ms (prod build) |
| Mobile web smoke | ALL GREEN (390×844: login, dashboard, chat, tasks, my-files, feed — без overflow) |
| Независимое ревью | 7 ревьюеров: **PASS-WITH-NOTES** по всем областям после исправления найденного |

## Найденные и исправленные дефекты кандидата

1. **FE-0198 race** (blocker релиз-гейта): auto-passkey попытка после F5 убивала обязательный enrollment-диалог через `clearPasskeyPresentationLock` → `setRememberDeviceOpen(false)` при уже залоченном `enrollmentGateOpenedRef`. Двойной фикс: lock-clear не закрывает required-диалог + auto-passkey не стартует при pending enrollment.
2. **SW mojo-crash**: `navigator.setAppBadge` из service worker — фатальный IPC в chrome-headless-shell (нет binder'а BadgeService) — убивал renderer на authed-навигации. Гейт `navigator.webdriver` на странице.
3. **Миграции 0085/0086 (BLOCKER ревью)**: жёсткая схема `chat` — на legacy-runtime с chat-таблицами в `public` 0086 молча пропускал базовые sticker-таблицы → 0178 падал бы на FK при релизной миграции; realtime-таблицы 0085 создавались не в той схеме → realtime не стартовал. Исправлено на детекцию по фактическому расположению `chat_conversations` (как в 0178 и runtime). Verified на sqlite: upgrade/re-upgrade/downgrade/skip.
4. **Миграция 0174**: `CREATE INDEX CONCURRENTLY` без идемпотентности — invalid-остаток после сбоя ломал повтор. Теперь skip valid / drop invalid + recreate / downgrade IF EXISTS.
5. **Sticker recents race (MAJOR)**: remove/clear flush мог перекрыть летящий debounced flush — сервер применял пакеты в произвольном порядке, удалённый стикер воскресал. Сериализация flush'ей per-scope promise-цепочкой; тесты обновлены под новый контракт (24/24).
6. **Sticker send file-loss (MAJOR)**: catch-all удалял файл даже когда сообщение уже committed (`FileMessageCommittedError`) — мёртвый attachment. Зеркалит orchestrator.
7. **DnD sticker E2E (test integrity)**: широкий catch проглатывал assertion-падения — fallback теперь только на отсутствие запроса.

## Принятые ограничения (PASS-WITH-NOTES, задокументированы)

- **FE-0198 — только клиентский gate**: серверного enforcement по network_zone нет; смягчено тем, что external-сессия без trusted device живёт 30 мин idle против 7 дней (session_service). Клиентский gate — UX/posture-контроль, не auth-граница.
- **Offline op-journal recents in-memory**: reload страницы до flush теряет remove/clear-операции (localStorage хранит display-список). Bump-операции переживают.
- **Rate-limit gaps (minor)**: `POST /sticker-packs/import` без per-user лимита (100MB проверяется post-download); chat chunk-upload/avatar — size-limited но не rate-limited.
- **Trusted-device registration без step-up auth** — смягчено revoke при смене пароля/2FA-reset и new-login alerts.
- **Refresh grace `_REFRESH_GRACE_MAX_HITS=1`**: security-first tradeoff, на нестабильных сетях возможен принудительный logout сессии.
- **Entitlement leg-3 стикеров**: LIKE-матчинг по file_name без media_kind-фильтра — теоретически форжабельно crafted filename, практическое impact ограничено публичностью Telegram-паков.
- **Visual spec** — генератор контрольных кадров + поведенческие проверки, не pixel-baseline visual regression.
- **1C catalog sync** выполняет DDL в runtime-транзакции (pre-existing, за рамками кандидата) — кандидат для отдельной задачи.
- **FE-0198 edge (minor UX)**: ошибка `refreshSession()` после успешной регистрации может оставить prompt закрытым со stale профилем до reload.

## Инфраструктурные ограничения верификации

- `my-files-virtualization`/`name-columns` E2E: сидирование упирается в queue cap (`max_active_jobs_per_user=5`) локального стека — impl-файлы byte-identical между сторонами merge, регрессия исключена статически; спекам нужен рабочий file-processing pipeline в стеке.
- PG-специфичные ветки миграций (chat-schema detection, concurrent index) проверены статически и по паттерну 0178/0175; pg-gate тесты требуют PostgreSQL и были skipped — **перед продом прогнать `pytest -q tests/test_pg_sticker_gate.py` на тестовой PG, включая legacy-public сценарий**.
- Полный pytest: 10 файлов не собираются без опциональных зависимостей (watchdog/soundfile/telegram/TELEGRAM_BOT_TOKEN/CHAT_ENABLED) — env-ограничение машины, не дефект.
- serve-prod harness не проксирует WS-upgrade — chat-тайминги на prod-билде измерены только через dev-стек E2E (realtime-доставка подтверждена emoji-picker WS-тестом).

## Релизные шаги (runbook)

1. Перед миграцией production: проверить фактическую схему chat-таблиц (`to_regclass('chat.chat_conversations')` vs `public`) — от этого зависит, где окажутся sticker/realtime таблицы; оба пути теперь корректны, но pg-gate прогон на staging обязателен.
2. `alembic -x url=<prod> upgrade head` по [runbook](scripts/pm2/README.md#миграции-бд-при-релизе) — до старта chat-процессов (schema-check fail-closed).
3. Деплой фронта через `scripts/iis/publish_frontend_iis.ps1` + `scripts/deploy.ps1`, далее health-check.
