# AUDIT SIGNOFF — HUB-IT web frontend

- **Приложение (тестируемый SHA):** `9879be04` (main на 2026-11-23), чистый `git archive`; frontend и backend из одной версии.
- **Аудит-ветка / PR:** PR #9, HEAD до sign-off `1d6e624e`; sign-off-коммит добавляет только `audit/frontend/`.
- **Режим:** read-only. Код приложения, backend, конфигурация и production не изменялись; merge/deploy не выполнялись.
- **Стенд:** SQLite `.state-cycle19`, backend 18009, proxy 5229, preview worker; синтетические данные.

## 1. Окончательные показатели

| Показатель | Значение |
|---|---|
| Всего записей | **324** |
| Подтверждённые (Confirmed) | **268** |
| Неподтверждённые риски (Suspected) | **12** |
| Отклонённые (Rejected) | **42** (включая FE-0326) |
| Fixed-externally | **2** (FE-0078, FE-0225) |
| Актуальные High | **11** |
| Исторические High | 12 |
| Исправленные High | 1 (FE-0078) |
| Runtime-proven High | 10 (включая FE-0078; unresolved 9) |
| Static-only High | 1 (FE-0215) |
| Runtime-not-reproduced High | 1 (FE-0230, Suspected) |
| E2E route entry | **9** |
| Functional route entry | 27 |
| Functional + E2E | **36/46 (78.3%)** |
| Smoke-only | 2 (`/computers`, `/statistics`) |
| Blocked route entry | **8** |
| Severity | High 12, Medium 124, Low 173, Info 15 |

**Актуальные High:** FE-0022, FE-0023, FE-0059, FE-0083, FE-0197, FE-0198, FE-0215, FE-0230, FE-0232, FE-0239, FE-0259.
**Fixed High:** FE-0078. **Suspected High:** FE-0230.

## 2. Что подтверждено runtime

- **High:** FE-0022 (Warehouse1C keyboard), FE-0023 (mobile 10k ports), FE-0059 (lost rotation), FE-0083 (refresh family), FE-0197/FE-0198 (2FA/trusted-device), FE-0232 (delegates), FE-0239 (wrong managers), FE-0259 (daily/weekly draft loss).
- **Medium/Low:** FE-0325 (PWA offline), FE-0194 (monitoring nameless target — mocked browser only), а также ранее подтверждённые runtime-записи.
- **FE-0078** — fixed externally.
- **FE-0326** — **Rejected**: valid PNG previews работают; повреждение было в невалидной тестовой фикстуре.

## 3. Что осталось неподтверждённым

12 Suspected: FE-0004, FE-0051, FE-0076, FE-0110, FE-0115, FE-0161, FE-0194, FE-0230, FE-0265, FE-0300, FE-0323, FE-0324. Для каждого в backlog/индексе указана минимальная инфраструктура: persistent profile/SW, swrCache harness, mail/AI, ONLYOFFICE, iOS Safari, >limit datasets, SQL test set, WebView2 harness.

## 4. Ограничения E2E

- **9/46 route entry E2E**; Functional+E2E 36/46 (78.3%).
- **8 blocked route entry:** `/mail`, `/mail/compose`, `/construction`, 2 construction request-child, `/database`, `/my-files/edit`, `/it/objects/:objectRef`.
- **FE-0215:** Exchange EWS, нет EWS test server/mailbox; возможен только limited service-level contract test.
- **FE-0230:** реальный WebView2 negative; достижимый card-local re-render не найден.
- **FE-0232/0239:** test-only сетевые инъекции; persistence проверена на реальном backend.
- **FE-0197/0198, FE-0023, FE-0325:** проверены в циклах 14–15; в финальном цикле не перезапускались без новой гипотезы.
- **FE-0326 download:** приватный legacy `GET /my-files/{id}/download` — 410 by design; актуальный контракт — grant; public download отдаёт сохранённое представление (WebP для optimized_media). `matchesOriginal=false` для small/large — ожидаемо, не дефект.
- **E2E arithmetic:** five E2E = **48 mandatory + 1 observation** (MyFiles 11+1). Прежние «49 mandatory» ошибочно включали non-mandatory `previewArtifactDecodes`; исправлено в отчётах.

## 5. Готовность к отдельным PR исправлений

- **P0:** FE-0197, FE-0198 (2FA/trusted-device); FE-0059 + FE-0083 (refresh); FE-0232 (delegates); FE-0239 (managers).
- **P1:** FE-0259 (drafts); FE-0023 (mobile 10k).
- **P2:** FE-0325 (PWA); FE-0215 (EWS after test double); FE-0194 (monitoring guard); FE-0110 (ONLYOFFICE).
- **P3 / grouped:** silent truncation FE-0161/0300/0323/0324; FE-0051; FE-0076; FE-0115; FE-0004; FE-0265.
- **Spike:** FE-0230 (no fix until a reachable card-local re-render is proven).
- **Test-infra:** validate PNG fixtures, EWS double, ONLYOFFICE/SQL/mobile/PWA/WebView2 harnesses.

Полный план: `REMEDIATION_BACKLOG.md`; индекс всех 324 ID: `REMEDIATION_COVERAGE.md`.

## 6. Финальные проверки

- `node audit/frontend/validate-issues-json.mjs` — **0 ошибок**.
- 324 уникальных ID; `issueCounters` = фактические (268/12/2/42; High 12, Medium 124, Low 173, Info 15).
- `highBreakdown`: historical 12, active 11, fixed 1, runtime-proven 10, unresolved 9, static-only FE-0215, runtime-not-reproduced FE-0230.
- `REMEDIATION_COVERAGE.md`: 324 строки, 324 уникальных ID; 23 в приоритетном backlog (10 Confirmed + 12 Suspected + FE-0326 test-infra), 258 Confirmed deferred, 41 Rejected не в backlog, 2 Fixed.
- Строгие тесты на `9879be04`: five E2E 5/5 (48 mandatory + 1 observation), FE-0232 11/11, FE-0239 8/8, FE-0259 11/11, refresh matrix A–D.
- Стенды остановлены; debug-порт 9229 не слушается.

## 7. Sign-off

Аудит завершён. Приложение не изменялось; результаты пригодны для отдельных PR исправлений по приоритетам выше. Новые циклы поиска не запускать без отдельного запроса.
