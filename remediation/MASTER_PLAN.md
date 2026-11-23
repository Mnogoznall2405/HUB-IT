# MASTER PLAN — программа исправления фронтенда HUB-IT

- Создано: 2026-11-23
- База: `origin/main` = `f84e1565`
- Аудит: PR #9 (`audit/frontend-2026-11-22` @ `bbc9ed1e`), тестированный SHA `9879be04`
- Реестр: `remediation/PROGRESS.json` — все 324 записи. Исходный `audit/frontend/ISSUES.json` не изменяется.
- Проверка расхождения баз: `git diff 9879be04 origin/main` по всем приоритетным файлам (Login.jsx, AuthContext.jsx, http.js, useAccountSectionData.js, DepartmentsTab.jsx, ConstructionWorkWorkspace.jsx, EquipmentTab.jsx, Warehouse1C.jsx) — **0 строк**: аудированный код идентичен текущему main.

## Жёсткие ограничения (напоминание)

- Работа только в отдельных worktree (`C:\Project\HUB-IT-*`); рабочее дерево владельца `HUB-IT-main` не трогаем.
- Нет merge, нет deploy, нет изменения production, нет ослабления 2FA/RBAC/replay-защиты.
- Один PR — одна связанная группа дефектов; каждый PR — тесты и описание первопричины.

## Фаза P0 — безопасность и целостность данных

| Порядок | Группа | FE-ID | Ветка | Комментарий |
|---|---|---|---|---|
| P0.1 | 2FA flow | FE-0197, FE-0198 | `fix/auth-2fa-flow` | setup_complete и remember-device sheet до размонтирования Login |
| P0.2 | Refresh | FE-0059, FE-0083 | `fix/auth-refresh-coordination` | координация вкладок; MAX_HITS/grace не менять |
| P0.3 | Делегаты | FE-0232 | `fix/account-delegate-integrity` | отличать «загружено пусто» от «не загрузилось» |
| P0.4 | Отделы | FE-0239 | `fix/account-department-race` | seq-guard/abort на loadMembers + проверка departmentId |

## Фаза P1 — потеря данных / тяжёлая производительность

| Порядок | Группа | FE-ID | Ветка |
|---|---|---|---|
| P1.1 | Construction drafts | FE-0259 | `fix/construction-draft-protection` |
| P1.2 | Networks perf | FE-0023 | `perf/networks-large-port-lists` (нужен baseline) |
| P1.3 | Warehouse a11y | FE-0022 | `fix/warehouse-keyboard-rows` |

## Фаза P2 — Medium-пачки по областям

P2.0 PWA offline (FE-0325) → `fix/pwa-offline-cold-start`; далее партии по `batch` из PROGRESS.json:
mail (24), database (22), chat (22), account-остальные (≈17), auth-misc (≈19 без P0), voice (21), tasks (19), my-files (16), networks-остальные (26), scan-center (11), construction-остальные, monitoring, company-structure, layout/dashboard, it-objects/requests, shared-links, feed, statistics, docflow, kb, dlp, computers, desktop, api-client, notifications, routing, infra/build/theme.

Правило партии: не более ~10 связанных дефектов на PR; смежные severity сначала.

## Фаза P3 — Low/Info

Те же batch-группы; тривиальные правки объединяем по области, не по десятку файлов сразу.

## Suspected → Spike

FE-0004, FE-0051, FE-0076, FE-0110, FE-0115, FE-0161, FE-0194, FE-0230, FE-0265, FE-0300, FE-0323, FE-0324.
Сначала доказать достижимость (harness/dataset); без доказательства — не исправлять, статус NEEDS_EVIDENCE.
Отдельные лёгкие случаи с моком (FE-0194 nameless target guard — mocked TypeError) можно переводить в fix после повторного воспроизведения.

## Fixed-externally → проверка

FE-0078 (chat offline-resend), FE-0225 (sticker double-send) — проверить наличие исправления на main регресс-тестами, затем `ALREADY_FIXED`.

## Rejected

42 записи — только регистрация; код не трогаем. FE-0326 — тест-фикстура, не приложение.

## Тестовая стратегия

- Дефолт: E2E/интеграция через публичные интерфейсы (AGENTS.md «Test quality»).
- Unit только там, где E2E не достигает шва (гонки, state machines) — с обоснованием в PR.
- Строгие скрипты аудита: `audit/frontend/evidence/` — переиспользовать FE-0232 (11 checks), FE-0239 (8), FE-0259 (11), refresh matrix A–D, five E2E (48 mandatory + 1 observation).
- Frontend проверки: `npm run test:run -- <paths>` в `WEB-itinvent/frontend`; trial build `npx vite build --outDir <вне dist>`; Playwright только релевантные spec с `E2E_LOCAL=1`.
- Backend (при затрагивании auth.py и пр.): `pytest -q tests/test_<area>.py`.
- UI: скриншоты до/после; perf: baseline→after на production build.

## Порядок внутри каждого дефекта

Воспроизведение → первопричина → падающий тест → минимальный фикс → проверки (unit/integration/E2E/build/git diff --check) → независимое ревью → PR → обновление PROGRESS.json.

## Зависимости PRов

- `fix/auth-2fa-flow` и `fix/auth-refresh-coordination` оба трогают `http.js`/`AuthContext.jsx`/`Login.jsx` → делать **последовательно**: 2FA первым, refresh — с ребейзом после merge либо на отдельном пересечении с минимальным конфликтом.
- FE-0232 и FE-0239 — один файл-семейство `pages/account/**`, разные хуки — можно параллельно в разных worktree.
- Остальные batch-PRы независимы друг от друга.
