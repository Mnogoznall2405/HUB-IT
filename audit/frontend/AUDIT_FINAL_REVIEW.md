# AUDIT FINAL REVIEW — HUB-IT web frontend (cycle 19)

- Дата: 2026-11-23
- PR аудита: #9, HEAD `5a173ff6` (реестр 324 записи).
- Финальная проверка кода: **`9879be04`** (main на 2026-11-23), чистый `git archive`; frontend и backend из одной версии; SQLite `.state-cycle19`, backend 18009, proxy 5229, preview worker.
- Режим: read-only. Приложение, backend, конфигурация, production не изменялись; merge/deploy не выполнялись.

## 1. Главный результат контроля качества

**FE-0326 отклонён как false positive.** Цикл 18 сообщил о повреждённом `preview.png`; цикл 19 выяснил, что повреждённым был **тестовый PNG** (180 байт: IHDR валиден, IDAT CRC mismatch, 6 лишних байт, zlib «incorrect data check»), а не артефакт приложения. Приложение сохранило и отдало невалидный исходник; оптимизация изображения его пропустила. Валидные PNG (small 32x32, medium 512x512, large 1600x1200) дали валидные private/public preview (WebP или исходный PNG), Pillow и браузер декодировали, natural sizes 32/512/1600, ошибок нет, публичный download отдаёт сохранённое представление (WebP для оптимизированных small/large, исходный PNG для medium); приватный legacy GET — 410 by design, актуальный контракт — grant. Фикстура исправлена на валидный 186-байтный PNG; MyFiles E2E — 11 mandatory + 1 observation, 0 failed.

Это не «ошибка приложения»; это ошибка аудиторского теста, исправленная в `audit/frontend/`.

## 2. Достоверность тестового механизма

| Проверка | Результат |
|---|---|
| Positive five E2E на `9879be04` | **5/5 PASS**, **48 обязательных checks + 1 observation check** (MyFiles 11 mandatory + 1 observation), 0 failed |
| Negative controls | **10/10 EXPECTED_FAILURE** с конкретными failed checks; injection applied; start подтверждён |
| Timeout control | `login_timeout` — EXPECTED_FAILURE по `waitForURL` timeout |
| Meta browser launch error | **INFRA_FAILURE**, не засчитан как negative; `countedAsExpected=false` |
| Strict FE-0232 | 11/11 checks, exit 0 |
| Strict FE-0239 | 8/8 checks, exit 0 |
| Strict FE-0259 | 11/11 checks, exit 0 |
| Refresh matrix A-D | A 200/200, new token alive; B 200/401, family revoked; C [200,200,401], winners dead; D old 401, new alive |
| Validator | **0 ошибок**, 324 records |

Negative controls больше не принимают ненулевой exit code за успех: требуется старт сценария, применение контроля, конкретная failed check (или ожидаемый timeout) и отсутствие infra-error. Случайный запуск браузера с несуществующим каналом классифицирован как `INFRA_FAILURE` и не засчитан.

## 3. Итоговые числа

| Показатель | Значение |
|---|---|
| Всего записей | **324** |
| Подтверждённые дефекты (Confirmed) | **268** |
| Неподтверждённые риски (Suspected) | **12** |
| Отклонённые (Rejected) | **42** (включая FE-0326) |
| Уже исправленные (Fixed-externally) | **2** (FE-0078, FE-0225) |
| Актуальные High | **11** |
| Исторические High | 12 |
| Исправленные High | 1 (FE-0078) |
| Runtime-proven High | 10 (включая FE-0078; unresolved 9) |
| Static-only High | 1 (FE-0215) |
| Runtime-not-reproduced High | 1 (FE-0230, Suspected) |
| E2E-проверенных route entry | **9** |
| Functional route entry | 27; Functional+E2E 36/46 (78.3%) |
| Smoke-only | 2 (`/computers`, `/statistics`; пустые данные) |
| Blocked route entry | **8** |
| Severity | High 12, Medium 124, Low 173, Info 15 |

**Актуальные High (11):** FE-0022, FE-0023, FE-0059, FE-0083, FE-0197, FE-0198, FE-0215, FE-0230, FE-0232, FE-0239, FE-0259.
**Fixed High:** FE-0078.
**Suspected High:** FE-0230.

**Backlog coverage:** 19 REM-групп упоминают **23 FE-ID** (10 Confirmed + 12 Suspected + FE-0326 test-infra). Остальные **258 Confirmed** — deferred; **41 Rejected** и **2 Fixed-externally** не входят в приоритетный backlog. Полный индекс всех 324 ID — `REMEDIATION_COVERAGE.md`; ни одна запись не потеряна.

### Static vs browser/API

- **Static-only High:** FE-0215 (EWS mail; live blocked).
- **Runtime browser/API High:** FE-0022, FE-0023, FE-0059, FE-0083, FE-0197, FE-0198, FE-0232, FE-0239, FE-0259; FE-0078 fixed.
- **Mocked-browser evidence:** FE-0194 (monitoring, Suspected); FE-0230 real WebView2 negative.
- **Rejected:** FE-0326 (valid-PNG matrix refuted the claim).

## 4. Серьёзные дефекты — финальная достоверность

| ID | Severity | Достоверность / сценарий | Влияние | Готовность к задаче |
|---|---|---|---|---|
| FE-0197 | High | Высокая; cycle14 real 2FA setup/login; setup-complete step unmount | 2FA backup/recovery UX | Готов (P0) |
| FE-0198 | High | Высокая; cycle14 real 2FA/trusted-device flow; sheet not rendered | Обход обязательного trusted-device | Готов (P0) |
| FE-0059 | High | Высокая; refresh matrix 9879be04 | Потеря сессии после потерянного ответа ротации | Готов (P0/P1) |
| FE-0083 | High | Высокая; matrix A-D | Массовый logout вкладок при parallel refresh | Готов (P0/P1) |
| FE-0023 | High | Высокая; cycle14 10k ports mobile (~30 s, 181k DOM, 930 MB) | Мобильный freeze | Готов (P1) |
| FE-0232 | High | Высокая; strict 11/11, links 1→0 | Потеря делегатов при сбое bulk | Готов (P0/P1) |
| FE-0239 | High | Высокая; strict 8/8, D2 16→14 | Неверные руководители отдела | Готов (P0/P1) |
| FE-0259 | High | Высокая; strict 11/11, daily+weekly drafts lost | Потеря несохранённой сводки/плана | Готов (P1) |
| FE-0325 | Medium | Высокая; cycle14/15 PWA offline | Вечный loader без сети | Готов (P2) |
| FE-0326 | Medium (historical) / Rejected | Опровергнут матрицей valid PNG | Нет дефекта приложения | Приложение не чинить; тест-фикстура исправлена |
| FE-0230 | High (Suspected) | Статический инвариант; live negative | Потенциальный крах настроек, путь не доказан | Spike, не fix |

FE-0230 оставлен **Suspected**: 9 хуков до early return, 0 после; parent guard + `desktop.capabilities` re-render; реальный WebView2 late-hostReady + click не дал краха; достижимый card-local re-render не найден. Новых доказательств в цикле 19 нет.

## 5. 12 Suspected — итог

| ID | Тема | Что сделано / чего не хватает |
|---|---|---|
| FE-0004 | `/shared-folders` invalid → login в долгоживущем профиле | Нужен persistent Chrome profile со stale SW/auth; чистый профиль не воспроизводит |
| FE-0051 | swrCache «отсоединённый» ответ | Static; нужен algorithm/race harness; без нового runtime не меняли |
| FE-0076 | AI mail plain-text `is_html=true` | Нужен mail/AI harness; EWS/mail module blocked |
| FE-0110 | editor close hang при падении DocSpace | Нужен ONLYOFFICE test server |
| FE-0115 | revokeObjectURL сразу после click | Нужен iOS Safari/WebKit |
| FE-0161 | Networks limit 10000/5000 без индикатора | Нужен dataset > limit |
| FE-0194 | Monitoring `target.name.split` | **Mocked overview воспроизвёл TypeError + error boundary**; real backend target без name не наблюдался → Suspected |
| FE-0230 | Desktop hooks early return | Real WebView2 negative; нужен достижимый card-local re-render |
| FE-0265 | Suspense на dialogs-слой | Нужен lazy-chunk failure harness |
| FE-0300 | DLP >200 чатов | Нужен dataset >200 |
| FE-0323 | scanHosts fallback truncation | Static latent; нужен вызов в проде/данные |
| FE-0324 | Database lookup limits 500/1000 | Нужен SQL test set > limits |

Ни один Suspected не переведён в Confirmed: mocked/negative/static evidence недостаточно для пользовательского подтверждения. Для заблокированных интеграций минимальная инфраструктура указана в backlog.

## 6. Покрытие и блокировки

- **E2E 9/46 route entry:** `/login`, `/feed`, `/tasks`, `/chat`, `/my-files`, `/admin/:section?`, `/shared-files/:token`, `/kb/manage`, `/construction/objects/:objectId/directions/:groupRef`.
- **Functional 27:** остальные пользовательские маршруты с действием/состоянием.
- **Smoke 2:** `/computers`, `/statistics` — пустые данные; не считаются проверенными с данными.
- **Blocked 8:** `/mail`, `/mail/compose`, `/construction`, 2 request-child construction, `/database`, `/my-files/edit`, `/it/objects/:objectRef`.
- **Blocked High:** FE-0215 (EWS test server/mailbox).
- **Не покрыто данными:** компьютеры, статистика, БД, IT-объекты, ONLYOFFICE.

## 7. Проверка полноты

- `ISSUES.json` — 324 записи; `issueCounters` совпадают с фактическими (268/12/2/42; High 12, Medium 124, Low 173, Info 15).
- `highBreakdown`: historical 12, active 11, fixed 1, runtime-proven 10, unresolved 9, static-only FE-0215, runtime-not-reproduced FE-0230, suspectedHigh FE-0230.
- `ISSUES.md` перегенерирован; `COVERAGE_MATRIX.md` синхронизирован; `AUDIT_PROGRESS.md`/`NEXT_ACTIONS.md` обновлены.
- Валидатор: **0 ошибок**.
- Строгие тесты повторно прогнаны на `9879be04`: five E2E 5/5 (48 mandatory + 1 observation), FE-0232 11/11, FE-0239 8/8, FE-0259 11/11, refresh matrix A-D.

## 8. Ограничения

- FE-0232/0239 используют test-only сетевые инъекции; сохранение проверено на реальном изолированном backend.
- FE-0259: план сохранён реально; потеря черновика — клиентское поведение.
- FE-0197/0198, FE-0023, FE-0325 проверены в циклах 14/15; повторно не запускались без новой гипотезы.
- FE-0215: полный E2E невозможен без EWS test server; только limited service-level contract test.
- FE-0326: false positive; приложение не требует исправления.
- Все данные синтетические; production не затрагивался.

## 9. Следующие шаги

1. Исправления P0: 2FA (FE-0197/0198), refresh resilience (FE-0059/0083), делегаты (FE-0232).
2. P1: руководители отделов (FE-0239), черновики Construction (FE-0259), мобильная производительность (FE-0023).
3. P2: PWA (FE-0325), EWS inline (FE-0215, после test double), monitoring guard (FE-0194).
4. Тестовая инфраструктура: EWS double, ONLYOFFICE/SQL/10k/mobile/PWA harness, обязательная валидация PNG-фикстур.
5. FE-0230 — spike на достижимый card-local re-render; без него не исправлять.

Подробный план — `REMEDIATION_BACKLOG.md`.
