# COVERAGE MATRIX — route inventory (cycle 16)

> Старые таблицы ниже — исторические (циклы 1–15). Актуальная инвентаризация построена
> непосредственно из `App.jsx` (51 route entry) и не считает 36 сценариев 100% покрытием.

## Полная карта маршрутов

| Маршрут | Категория | Интеграция | Уровень | Доказательство |
|---|---|---|---|---|
| `/` | Redirect | — | None | RootRoute -> first accessible |
| `/login` | Public | Auth | E2E | real 2FA setup/login (cycle14) |
| `/shared-files/:token` | Public/Param | Public share | Functional | invalid-token error + retry |
| `/shared-folders/:token` | Public/Param | Public share | Functional | 2000-file large folder (cycle13) |
| `/about` | Standalone | — | Functional | Перейти в HUB |
| `/dashboard` | Standalone | — | Smoke | rendered |
| `/feed` | Standalone | API | E2E | create post -> reload (cycle16) |
| `/tickets` | Standalone | API | Functional | create dialog |
| `/tasks` | Standalone | API | E2E | create + edit + checklist -> reload (cycle16) |
| `/chat` | Standalone | WS/API | E2E | notes send -> reload; cross-tab dedup (cycle16); offline send (cycle13) |
| `/database` | Standalone | SQL Server | Smoke | rendered |
| `/networks` | Standalone | API | Functional | 10k ports mobile |
| `/vcs` | Standalone | API | Functional | add terminal dialog |
| `/mfu` | Standalone | 1C/API | Functional | error/empty state |
| `/monitoring` | Standalone | SNMP/API | Functional | empty/search state |
| `/computers` | Standalone | API | Smoke | rendered |
| `/scan-center` | Standalone | Scan API | Functional | queue tab |
| `/voice` | Standalone | Voice API | Functional | tab + refresh |
| `/dlp` | Standalone | DLP API | Functional | refresh |
| `/file-egress` | Standalone | DLP API | Functional | refresh |
| `/statistics` | Standalone | API | Smoke | rendered |
| `/mail` | Standalone | Mail provider | Blocked | corporate password gate; no test mailbox |
| `/menu` | Standalone | — | Functional | navigate Tasks |
| `/address-book` | Standalone | API | Functional | refresh/empty |
| `/company-structure` | Standalone | API | Functional | tabs + refresh |
| `/warehouse-1c` | Standalone | 1C | Functional | balances tab |
| `/it/objects` | Standalone | API | Functional | retry/error |
| `/construction` | Standalone | 1C/SQL | Blocked | 502: BUH20_1C creds absent |
| `/docflow` | Standalone | 1C/API | Functional | connect dialog |
| `/passwords` | Standalone | API | Functional | new record dialog |
| `/groups-access` | Standalone | AD/API | Functional | refresh |
| `/my-files` | Standalone | API/storage | E2E | upload + search + reload + preview (cycle16) |
| `/kb/manage` | Standalone | KB API | Smoke | rendered? not exercised |
| `/help` | Standalone | — | Functional | open article |
| `/profile` | Standalone | API | Functional | expand service data |
| `/chat/open` | Param/Child | API | Functional | invalid link -> /chat |
| `/networks/:branchId` | Param/Child | API | Functional | branch selected |
| `/it/requests/:requestRef?` | Param/Child | 1C | Functional | История tab |
| `/it/objects/:objectRef` | Param/Child | API | Smoke | not exercised |
| `/construction/objects/:objectId` | Param/Child | 1C/SQL | Blocked | no configured object + 1C absent |
| `/construction/objects/:objectId/directions/:groupRef` | Param/Child | 1C/SQL | Blocked | no fixture |
| `/construction/objects/:objectId/directions/:groupRef/requests/:requestRef` | Param/Child | 1C/SQL | Blocked | no fixture |
| `/construction/objects/:objectId/requests/:requestRef` | Param/Child | 1C/SQL | Blocked | no fixture |
| `/my-files/edit/:fileId` | Param/Child | ONLYOFFICE | Smoke | editor error state |
| `/mail/compose` | Param/Child | Mail provider | Blocked | credentials gate |
| `/settings/:section?` | Param/Child | API | Functional | app section |
| `/admin/:section?` | Param/Child | API | E2E | create synthetic user -> reload (cycle16) |
| `/dashboard/news` | Redirect | — | None | LegacyNewsRedirect |
| `/ad-users` | Redirect | — | None | -> /admin/ad-users |
| `/kb` | Redirect | — | None | -> /help |
| `*` | Redirect | — | None | HomeRedirect |

## Реальный знаменатель (cycle 16)

- Всего route entry в `App.jsx`: **51**.
- Redirect/service: **5** (`/`, `/dashboard/news`, `/ad-users`, `/kb`, `*`).
- Пользовательских route entry: **46**.
- Первичные категории: 3 public, 31 standalone protected, 12 parameterized/child.
- Вложенные разделы: 12 admin sections (`users, departments, ad-users, references, ai-bots, sessions, my-files, feedback, hub-desktop, work-schedules, chat-groups, system`) и 6 settings tabs (`appearance, notifications, ai, security, app, about`).

## Покрытие

| Уровень | Кол-во | Доля от 46 user-visible |
|---|---|---|
| E2E | 6 | 13.0% |
| Functional (без E2E) | 26 | 56.5% |
| Functional + E2E | 32 | 69.6% |
| Smoke-only | 7 | 15.2% |
| Blocked (среда) | 7 | 15.2% |
| Redirect | 5 | — |

- **Functional/E2E: 32/46 = 69.6%**, не 100%.
- **E2E: 6/46 = 13.0%**.
- **Smoke-only + blocked: 14/46 = 30.4%** без функционального действия.
- 36 action-сценариев циклов 13–15 покрывают 32 route entry; ещё 14 entry не имеют functional/E2E-действия.
- Admin sections: 2/12 functional (users, departments); settings tabs: 1/6 functional (app).

## Cycle 16 — полные E2E (UI → API → SQLite → повторное открытие)

| Сценарий | Маршрут | Что проверено | Результат |
|---|---|---|---|
| Публикация в ленте | `/feed` | title + body → Опубликовать → reload | PASS, запись в списке после reload |
| Задача + чек-лист | `/tasks` | create с исполнителем → edit описания → чек-лист → reload | PASS, изменения сохранены |
| Заметки чата | `/chat` | отправка → вторая вкладка → reload → API messages | PASS, 2 сообщения без дублей |
| Загрузка файла | `/my-files` | upload session → reload → поиск → preview содержимого | PASS, контент сохранён |
| Синтетический пользователь | `/admin/users` | create → reload → поиск | PASS, пользователь в списке |
| Refresh-ротация | API | lost response / grace / 3 parallel | PASS (family revoke подтверждён) |

## Явно не покрыто функционально

`/dashboard`, `/database`, `/computers`, `/statistics`, `/kb/manage`,
`/my-files/edit/:fileId`, `/it/objects/:objectRef`;
10 из 12 admin sections; 5 из 6 settings tabs.
Blocked: `/mail`, `/mail/compose`, `/construction` и 4 construction child routes.

## Уровни

- **Smoke** — страница открылась и отрисовала базовый shell.
- **Functional** — выполнено главное действие/состояние (таб, refresh, диалог, error-state), результат проверен.
- **E2E** — UI → API → SQLite/WS → повторное открытие.
- **Blocked** — среда не позволяет выполнить сценарий (нет интеграции/fixture); зафиксировано как ограничение, не как PASS.

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

