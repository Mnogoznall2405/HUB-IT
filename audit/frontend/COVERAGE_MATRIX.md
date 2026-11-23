# COVERAGE MATRIX — route inventory (cycle 19)

> Исторические таблицы ниже сохранены. Актуальная инвентаризация построена из `App.jsx`;
> 36 action-сценариев циклов 13–15 не считаются 100% покрытием.

## Полная карта маршрутов

| Маршрут | Категория | Интеграция | Уровень | Доказательство |
|---|---|---|---|---|
| `/` | Redirect | — | None | RootRoute -> first accessible |
| `/login` | Public | Auth | E2E | real 2FA setup/login (cycle14) |
| `/shared-files/:token` | Public/Param | Public share | E2E | access + download + revoke + forced expiry (cycle17) |
| `/shared-folders/:token` | Public/Param | Public share | Functional | 2000-file large folder (cycle13) |
| `/about` | Standalone | — | Functional | Перейти в HUB |
| `/dashboard` | Standalone | API | Functional | real greeting/task/mail/chat counters (cycle17) |
| `/feed` | Standalone | API | E2E | create post -> reload (cycle16/17) |
| `/tickets` | Standalone | API | Functional | create dialog |
| `/tasks` | Standalone | API | E2E | create + edit + checklist -> reload (cycle16/17) |
| `/chat` | Standalone | WS/API | E2E | notes send -> reload; cross-tab dedupe (cycle16/17) |
| `/database` | Standalone | SQL Server | Blocked | equipment APIs 500/503; no SQL/branch data |
| `/networks` | Standalone | API | Functional | 10k ports mobile |
| `/vcs` | Standalone | API | Functional | add terminal dialog |
| `/mfu` | Standalone | 1C/API | Functional | error/empty state |
| `/monitoring` | Standalone | SNMP/API | Functional | empty/search state |
| `/computers` | Standalone | API | Smoke | empty state: 0 PCs; no data fixtures |
| `/scan-center` | Standalone | Scan API | Functional | queue tab |
| `/voice` | Standalone | Voice API | Functional | tab + refresh |
| `/dlp` | Standalone | DLP API | Functional | refresh |
| `/file-egress` | Standalone | DLP API | Functional | refresh |
| `/statistics` | Standalone | API | Smoke | controls render; 0 records / no data |
| `/mail` | Standalone | Exchange EWS | Blocked | EWS, not IMAP/SMTP; credentials gate; MAIL_MODULE_ENABLED=0 |
| `/menu` | Standalone | — | Functional | navigate Tasks |
| `/address-book` | Standalone | API | Functional | refresh/empty |
| `/company-structure` | Standalone | API | Functional | tabs + refresh |
| `/warehouse-1c` | Standalone | 1C | Functional | balances tab |
| `/it/objects` | Standalone | API | Functional | retry/error |
| `/construction` | Standalone | 1C/SQL | Blocked | 502: BUH20_1C creds absent |
| `/docflow` | Standalone | 1C/API | Functional | connect dialog |
| `/passwords` | Standalone | API | Functional | new record dialog |
| `/groups-access` | Standalone | AD/API | Functional | refresh |
| `/my-files` | Standalone | API/storage | E2E | upload + search + reload + image preview (cycle18/19; preview worker); FE-0326 rejected (invalid test fixture) |
| `/kb/manage` | Standalone | KB API | E2E | create article -> reload -> reopen (cycle17) |
| `/help` | Standalone | — | Functional | open article |
| `/profile` | Standalone | API | Functional | expand service data |
| `/chat/open` | Param/Child | API | Functional | invalid link -> /chat |
| `/networks/:branchId` | Param/Child | API | Functional | branch selected |
| `/it/requests/:requestRef?` | Param/Child | 1C | Functional | История tab |
| `/it/objects/:objectRef` | Param/Child | API | Blocked | IT objects DB unavailable |
| `/construction/objects/:objectId` | Param/Child | 1C/SQL | Functional | managed synthetic object renders (cycle17) |
| `/construction/objects/:objectId/directions/:groupRef` | Param/Child | 1C/SQL | E2E | work plan saved + F5 draft loss (cycle17) |
| `/construction/objects/:objectId/directions/:groupRef/requests/:requestRef` | Param/Child | 1C/SQL | Blocked | no 1C request fixture |
| `/construction/objects/:objectId/requests/:requestRef` | Param/Child | 1C/SQL | Blocked | no 1C request fixture |
| `/my-files/edit/:fileId` | Param/Child | ONLYOFFICE | Blocked | editor server unavailable |
| `/mail/compose` | Param/Child | Exchange EWS | Blocked | credentials gate; no EWS test server |
| `/settings/:section?` | Param/Child | API | Functional | app section |
| `/admin/:section?` | Param/Child | API | E2E | create synthetic user -> reload (cycle16/17) |
| `/dashboard/news` | Redirect | — | None | LegacyNewsRedirect |
| `/ad-users` | Redirect | — | None | -> /admin/ad-users |
| `/kb` | Redirect | — | None | -> /help |
| `*` | Redirect | — | None | HomeRedirect |

## Реальный знаменатель

- Всего route entry в `App.jsx`: **51**.
- Redirect/service: **5** (`/`, `/dashboard/news`, `/ad-users`, `/kb`, `*`).
- Пользовательских route entry: **46**.
- 3 public, 31 standalone protected, 12 parameterized/child.
- 12 admin sections, 6 settings tabs.

## Покрытие (cycle 17)

| Уровень | Кол-во | Доля от 46 |
|---|---|---|
| E2E | 9 | 19.6% |
| Functional (без E2E) | 27 | 58.7% |
| Functional + E2E | 36 | 78.3% |
| Smoke-only | 2 | 4.3% |
| Blocked (среда) | 8 | 17.4% |
| Redirect | 5 | — |

- **Functional/E2E: 36/46 = 78.3%**.
- **E2E: 9/46 = 19.6%**.
- Smoke-only: `/computers`, `/statistics` — empty states без данных; не считаются проверенными с данными.
- Blocked: 8 entry, включая `/mail`, `/mail/compose`, `/construction`, 2 request-child, `/database`, `/my-files/edit`, `/it/objects/:objectRef`.

## Cycle 17 — воспроизводимость и новые E2E

| Проверка | Результат |
|---|---|
| Five E2E с нуля на clean b95c4cac | 5/5 PASS (feed, tasks, chat, myFiles, admin) |
| Public file share | access 200, download 200, revoke 204 -> 404, forced expiry -> 404/expired page |
| KB article | create -> reload -> reopen PASS |
| Construction workspace | managed object + work plan -> reload PASS; F5 draft lost without prompt |
| Dashboard | real counters render, no API errors |
| Statistics / Computers | controls render, 0 records; no data fixtures |
| Database | equipment APIs 500/503; blocked |
| My Files editor | ONLYOFFICE server unavailable; blocked |
| IT object detail | objects DB unavailable; blocked |

## Cycle 18 — достоверность тестов и новый дефект превью

| Проверка | Результат |
|---|---|
| Five E2E assertions | 5/5 PASS; **49 обязательных** проверок (feed 8, tasks 14, chat 9, myFiles 12, admin 6) |
| Negative controls | **10/10 FAIL как ожидалось**: API error, missing save, wrong record, duplicates (tasks/chat/myFiles/admin), hidden records, login timeout; положительный feed — PASS |
| FE-0232 strict test | 11/11 checks: links 0 -> 1, injected bulk 500 -> Save `items:[]` -> 0; control 1 -> 1 |
| FE-0239 strict test | 8/8 checks: PUT D2 `[14]` after stale D1 response; D2 16 -> 14, D1 unchanged |
| FE-0259 strict test | 11/11 checks: plan PUT 200 + persisted; daily/weekly drafts dirty; F5 no beforeunload; both lost |
| FE-0326 (corrected in cycle19) | **Rejected / false positive**: the cycle18 fixture was an invalid 180-byte PNG (IDAT CRC mismatch); valid small/medium/large PNGs preview correctly |
| Preview worker | required for My Files previews (`WEB-itinvent/start_preview_worker.py`); without it status stays `queued` |
| `/computers`, `/statistics` | still no data fixtures; smoke only |
| EWS | FE-0215 analysis: full E2E blocked; service-level mock would be limited contract test |

## Cycle 19 — финальная верификация

| Проверка | Результат |
|---|---|
| Valid PNG matrix (FE-0326) | small 32x32, medium 512x512, large 1600x1200: private/public preview 200, WebP/PNG valid, Pillow/browser decode, no visual error, downloads match |
| FE-0326 root cause | invalid 180-byte test PNG (IDAT CRC mismatch, zlib error), not the app; fixture fixed; MyFiles 12/12, 0 observations |
| Hardened negative controls | 10/10 EXPECTED_FAILURE with specific checks; positive PASS; browser launch error = INFRA_FAILURE, not counted |
| Strict rerun 9879be04 | five E2E 5/5 (49 checks); FE-0232 11/11; FE-0239 8/8; FE-0259 11/11 |
| Refresh matrix | A/B/C/D confirmed on 9879be04 |
| FE-0194 | mocked overview with nameless target reproduces split TypeError/error boundary; real trigger unproven; Suspected |
| Registry | 324: 268 Confirmed / 12 Suspected / 2 Fixed / 42 Rejected; validator 0 errors |

## Явно не покрыто функционально

`/computers`, `/statistics` (empty), 8 blocked entry; 10 из 12 admin sections
(users — E2E; departments — read-only); 5 из 6 settings tabs (app — functional).

## Уровни

- **Smoke** — страница открылась и отрисовала shell; данных нет.
- **Functional** — выполнено главное действие/состояние, результат проверен.
- **E2E** — UI → API → SQLite/WS → повторное открытие.
- **Blocked** — среда не позволяет выполнить сценарий; это ограничение, не PASS.

---

# Историческая матрица (циклы 1–15)

# Матрица покрытия аудита (web-фронтенд)

Статусы: `TODO` / `IN_PROGRESS` / `PASS` / `FAIL` / `BLOCKED`. «—» = неприменимо.
Колонки: UI (визуал/адаптив), FUNC (функциональные сценарии), PERF (производительность),
ST (state/cache/async), ERR (ошибки/надёжность).
Обновлено: 2026-11-22, циклы 1–7 (восстановлено после инцидента).

| Маршрут | Страница | UI | FUNC | PERF | ST | ERR | Примечание |
|---|---|---|---|---|---|---|---|
| `/login` | Login | FAIL | PASS | PASS | PASS | FAIL | FE-0001/0002/0003; сценарии входа/ошибок проверены |
| `/` | RootRoute | PASS | PASS | — | PASS | PASS | redirect по правам OK |
| `/shared-files/:token` | SharedFile | PASS | PASS | PASS | PASS | PASS | невалидный токен → корректная ошибка; FE-0041 |
| `/shared-folders/:token` | SharedFolder | PASS | FAIL | PASS | PASS | FAIL | FE-0004 (анонимно → /login), FE-0034 |
| `/about` | About | TODO | TODO | TODO | TODO | TODO | онбординг не достигнут (пользователь прошёл) |
| `/dashboard` | Dashboard | PASS | IN_PROGRESS | PASS | PASS | PASS | мутационные кнопки не проверялись |
| `/feed` | Feed | PASS | TODO | IN_PROGRESS | PASS | FAIL | FE-0007 (410 вложения ×8) |
| `/tickets` | Tickets | PASS | TODO | PASS | TODO | PASS | FE-0009 |
| `/tasks` | Tasks (+6 вкладок) | PASS | PASS | PASS | PASS | PASS | мутации: создание+удаление PASS; FE-0045/0053/0054/0058 |
| `/chat` | Chat | PASS | PASS | IN_PROGRESS | PASS | PASS | сообщение отправлено/удалено (WS); FE-0026 |
| `/database` | Database | PASS | TODO | FAIL | TODO | PASS | 31 API на загрузку; FE-0009/0010 |
| `/networks` | Networks (+вкладки) | PASS | TODO | FAIL | PASS | PASS | FE-0023/0024/0029/0030/0031/0035/0036 |
| `/vcs` | Vcs | PASS | TODO | PASS | TODO | PASS | FE-0034 |
| `/mfu` | Mfu | PASS | TODO | PASS | TODO | PASS | FE-0028/0034 |
| `/monitoring` | Monitoring | PASS | TODO | PASS | PASS | PASS | polling 10 с — осознанный дизайн |
| `/computers` | Computers | PASS | TODO | FAIL | PASS | PASS | FE-0008 (3.2 c), FE-0049 |
| `/scan-center` | ScanCenter | FAIL | TODO | FAIL | PASS | PASS | FE-0011 (overflow@1920, табы@375), FE-0009/0010/0052, scan/events 3.7 c |
| `/voice` | VoiceVideo | PASS | TODO | FAIL | TODO | PASS | FE-0018, FE-0027 |
| `/dlp`, `/file-egress` | FileEgress | — | BLOCKED | — | — | — | нет прав (adminOnly) у тестовой учётки |
| `/statistics` | Statistics | PASS | TODO | IN_PROGRESS | PASS | PASS | FE-0042 |
| `/mail` | Mail | FAIL | PASS | IN_PROGRESS | PASS | FAIL | FUNC: черновик PASS, удаление/перемещение черновика FAIL (FE-0056); FE-0057; bootstrap 1.4 c |
| `/menu` | MobileMenu | PASS | PASS | — | PASS | PASS | мобильное меню OK |
| `/address-book` | AddressBook | PASS | PASS | FAIL | PASS | PASS | FE-0013; debounce OK |
| `/company-structure` | CompanyStructure | PASS | TODO | PASS | TODO | PASS | FE-0010 («Open») |
| `/warehouse-1c` | Warehouse1C | FAIL | TODO | FAIL | TODO | PASS | FE-0022 (клавиатура), FE-0033 |
| `/it/requests/:ref?` | ItPurchaseRequests | PASS | IN_PROGRESS | PASS | PASS | PASS | deep-link OK; FE-0020 |
| `/it/objects` | ItObjects | PASS | TODO | PASS | PASS | PASS | |
| `/construction` (+detail) | ConstructionObjects | PASS | TODO | PASS | PASS | PASS | FE-0020 |
| `/docflow` | Docflow | PASS | TODO | PASS | PASS | PASS | FE-0012 |
| `/passwords` | Passwords | PASS | TODO | PASS | PASS | PASS | FE-0046 (сводка в ItObjectDetail), FE-0034 |
| `/groups-access` | GroupsAccess | — | BLOCKED | — | — | — | нет прав; редирект на /dashboard корректен |
| `/my-files` | MyFiles | PASS | PASS | IN_PROGRESS | PASS | PASS | мутации PASS; вкладки Недавние/Избранное/Корзина/Доступно мне — PASS; FE-0032 |
| `/my-files/edit/:fileId` | MyFilesEditor | TODO | IN_PROGRESS | TODO | TODO | TODO | цикл 9: статический аудит ONLYOFFICE → FE-0106…FE-0122 (нет hubBare, ?compare= no-op, desktop-маршрут) |
| `/kb/manage` | KnowledgeBase | — | BLOCKED | — | — | — | нет kb.write; редирект корректен |
| `/help` | Help | PASS | PASS | PASS | PASS | PASS | |
| `/profile` | Profile | PASS | TODO | PASS | PASS | PASS | |
| `/settings/:section?` | Settings | PASS | TODO | PASS | TODO | PASS | |
| `/admin/:section?` | Admin | PASS | TODO | IN_PROGRESS | TODO | PASS | FE-0019 |
| Redirects (`/kb`, `/ad-users`, `/dashboard/news`) | — | PASS | PASS | — | PASS | PASS | |

## Сквозные области

| Область | Статус | Примечание |
|---|---|---|
| AuthContext / токены / silent refresh | FAIL | FE-0059 (High), FE-0082 (High: межвкладочная гонка refresh → family revoke), FE-0047→Medium, FE-0085, FE-0137 |
| api/http.js перехватчики | FAIL | FE-0006 (мёртвый whitelist) |
| swrCache | PASS с замечаниями | FE-0048 Confirmed, FE-0051 Suspected |
| Layout / навигация | FAIL | FE-0014 (drawer), FE-0044 (tablist) |
| Стартовый бандл / code-splitting | PASS | ~223 КБ gz, 38 lazy-маршрутов (агент C) |
| WebSocket (chat) | FAIL | FE-0059; FE-0077 (High: нет авто-реотправки failed); FE-0078/0079/0080/0081; FE-0060 (индикатор), FE-0026 |
| Уведомления/тосты | PASS | фокус/Esc OK; FE-0014 |
| Тема/dark mode | FAIL | FE-0039 (light-only, противоречие AGENTS.md) |
| PWA/service worker | FAIL | FE-0083 (нет периодич. update-чека, заметка только в Settings), FE-0084/0086; «Banner not shown» опровергнуто (осознанная подавленка + CTA в настройках) |
| Локализация интерфейса | FAIL | FE-0001, FE-0010, FE-0052 |

## Экраны/масштаб

| Проверка | Статус | Результат |
|---|---|---|
| 1920×1080 (все страницы) | DONE | FAIL только /scan-center (FE-0011) |
| 1366×768 (dashboard/tasks/database/scan-center) | DONE | PASS |
| 1280×720 (те же) | DONE | PASS |
| 375×812 viewport-only | DONE | 15 страниц: чисто; /scan-center FAIL (табы до 506px); чипы /database — легитимный скролл-ряд (overflowX:auto), не дефект |
| 375×812 с UA-сменой | BLOCKED | сбрасывает сессию (см. FE-0059); не использовать |
| 1536×864 (=масштаб 125%) | DONE | /scan-center FAIL (гориз. скролл, как при 1920), /tasks — внутренний скролл таблицы (легитимно), остальные PASS |
| Клавиатура/фокус | PARTIAL | drawer PASS; FE-0022/0026/0035 — код |
| Zoom 80% | DONE (частично) | цикл 9 локальный стек: dashboard/chat/my-files PASS; scan-center FAIL (~10px, FE-0011) |
| Zoom 150% | DONE (частично) | то же: scan-center docW=1938>1920 (FE-0011); остальные PASS |
| /about (онбординг) | DONE (визуально) | e2e_fresh→/about штатно; скриншоты 1920/375 (evidence/cycle9/shots); баннер «Загрузка временно недоступна» |

