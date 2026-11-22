# Матрица покрытия аудита (web-фронтенд)

Статусы: `TODO` / `IN_PROGRESS` / `PASS` / `FAIL` / `BLOCKED`. «—» = неприменимо.
Колонки: UI (визуал/адаптив), FUNC (функциональные сценарии), PERF (производительность),
ST (state/cache/async), ERR (ошибки/надёжность).
Обновлено: 2026-11-22, циклы 1–5.

| Маршрут | Страница | UI | FUNC | PERF | ST | ERR | Примечание |
|---|---|---|---|---|---|---|---|
| `/login` | Login | FAIL | IN_PROGRESS | PASS | PASS | FAIL | FE-0001,0002,0003; mobile не допроверена (сессия) |
| `/` | RootRoute | PASS | PASS | — | PASS | PASS | redirect по правам OK |
| `/shared-files/:token` | SharedFile | PASS | PASS | PASS | PASS | PASS | невалидный токен → корректная ошибка; FE-0041 |
| `/shared-folders/:token` | SharedFolder | PASS | FAIL | PASS | PASS | FAIL | FE-0004 (анонимно → /login), FE-0034 |
| `/about` | About | TODO | TODO | TODO | TODO | TODO | онбординг-шаг, не достигнут (пользователь прошёл) |
| `/dashboard` | Dashboard | PASS | IN_PROGRESS | PASS | PASS | PASS | мутационные кнопки не проверялись |
| `/feed` | Feed | PASS | TODO | IN_PROGRESS | PASS | FAIL | FE-0007 (410 вложения ×8) |
| `/tickets` | Tickets | PASS | TODO | PASS | TODO | PASS | FE-0009 (безымянные combobox) |
| `/tasks` | Tasks (+6 вкладок) | PASS | PASS | PASS | PASS | PASS | rapid-switch: без гонок; FE-0045 (повторные fetch) |
| `/chat` | Chat | PASS | TODO | IN_PROGRESS | PASS | PASS | WS-поведение не проверено живьём (агент D: код OK) |
| `/database` | Database | PASS | TODO | PASS | TODO | PASS | FE-0009, FE-0010 («Open»); 31 API на загрузку |
| `/networks` | Networks (+вкладки) | PASS | TODO | FAIL | PASS | PASS | FE-0023 (mobile без виртуализации), FE-0024,0029,0030,0031,0036 |
| `/vcs` | Vcs | PASS | TODO | PASS | TODO | PASS | FE-0034 (IconButton) |
| `/mfu` | Mfu | PASS | TODO | PASS | TODO | PASS | FE-0028 (Drawer 360px), FE-0034 |
| `/monitoring` | Monitoring | PASS | TODO | PASS | PASS | PASS | polling 10 с — осознанный дизайн (D-7) |
| `/computers` | Computers | PASS | TODO | FAIL | PASS | PASS | FE-0008 (поиск 3.2 c), FE-0049 (D-6) |
| `/scan-center` | ScanCenter | FAIL | TODO | FAIL | PASS | PASS | FE-0011 (overflow 12px при 1920), scan/events 3.7 c |
| `/voice` | VoiceVideo | PASS | TODO | FAIL | TODO | PASS | FE-0018 (3×1.2–1.3 c), FE-0027 |
| `/dlp`, `/file-egress` | FileEgress | — | BLOCKED | — | — | — | нет прав (adminOnly) у тестовой учётки |
| `/statistics` | Statistics | PASS | TODO | IN_PROGRESS | PASS | PASS | FE-0042 (без кэша вкладок) |
| `/mail` | Mail | PASS | TODO | IN_PROGRESS | PASS | PASS | bootstrap 1.4 c; двойной bootstrap? — проверить |
| `/menu` | MobileMenu | PASS | PASS | — | PASS | PASS | мобильное меню OK |
| `/address-book` | AddressBook | PASS | PASS | FAIL | PASS | PASS | FE-0013 (absences 2×3.4–3.8 c); debounce OK |
| `/company-structure` | CompanyStructure | PASS | TODO | PASS | TODO | PASS | FE-0010 («Open») |
| `/warehouse-1c` | Warehouse1C | FAIL | TODO | FAIL | TODO | PASS | FE-0022 (клавиатура), FE-0033 (без виртуализации) |
| `/it/requests/:ref?` | ItPurchaseRequests | PASS | IN_PROGRESS | PASS | PASS | PASS | deep-link OK; FE-0020 (возраст снимка) |
| `/it/objects` | ItObjects | PASS | TODO | PASS | PASS | PASS | |
| `/construction` (+detail) | ConstructionObjects | PASS | TODO | PASS | PASS | PASS | FE-0020 (169 979 сек) |
| `/docflow` | Docflow | PASS | TODO | PASS | PASS | PASS | FE-0012 (дубль tasks) |
| `/passwords` | Passwords | PASS | TODO | PASS | PASS | PASS | FE-0046 (D-1, AbortSignal) |
| `/groups-access` | GroupsAccess | — | BLOCKED | — | — | — | нет прав; редирект на /dashboard корректен |
| `/my-files` | MyFiles | PASS | TODO | IN_PROGRESS | PASS | PASS | FE-0032 (bulk download) |
| `/my-files/edit/:fileId` | MyFilesEditor | TODO | TODO | TODO | TODO | TODO | ONLYOFFICE — не проверен (нужен файл) |
| `/kb/manage` | KnowledgeBase | — | BLOCKED | — | — | — | нет kb.write; редирект корректен |
| `/help` | Help | PASS | PASS | PASS | PASS | PASS | |
| `/profile` | Profile | PASS | TODO | PASS | PASS | PASS | |
| `/settings/:section?` | Settings | PASS | TODO | PASS | TODO | PASS | |
| `/admin/:section?` | Admin | PASS | TODO | IN_PROGRESS | TODO | PASS | FE-0019 (30 API, sessions 1.1 c) |
| Redirects (`/kb`, `/ad-users`, `/dashboard/news`) | — | PASS | PASS | — | PASS | PASS | |

## Сквозные области

| Область | Статус | Примечание |
|---|---|---|
| AuthContext / токены / silent refresh | PASS (код) с замечаниями | D-2: эпоха отказа не сбрасывается passkey/TrustedDevice (FE-0047); FE-0015 (UA-сброс сессии — needsBackendCheck) |
| api/http.js перехватчики | FAIL | FE-0006 (мёртвый whitelist public-folders) |
| swrCache | PASS с замечаниями | D-3: force-join (FE-0048); D-4 Suspected |
| Layout / навигация | FAIL | FE-0014 (drawer без dialog-семантики), FE-0044 (tablist) |
| Стартовый бандл / code-splitting | PASS | ~223 КБ gz, 38 lazy-маршрутов, guard-скрипт (агент C) |
| WebSocket (chat) | PASS (код) | живой WS-тест не проводился |
| Уведомления/тосты | PASS | фокус/Escape/Esc OK; FE-0014 |
| Тема/dark mode | FAIL | FE-0039: light-only, противоречие с AGENTS.md |
| PWA/service worker | IN_PROGRESS | «Banner not shown» (Suspected) |
| Локализация интерфейса | FAIL | FE-0001, FE-0010 |

## Экраны/масштаб

| Проверка | Статус | Результат |
|---|---|---|
| 1920×1080 (все страницы) | DONE | FAIL только /scan-center (FE-0011) |
| 1366×768 (dashboard/tasks/database/scan-center) | DONE | PASS |
| 1280×720 (те же) | DONE | PASS |
| 375×812 mobile | BLOCKED | mobile-эмуляция сбросила сессию (FE-0015); повторить после повторного входа |
| Zoom 80/125/150% | TODO | |
| Клававиatura/фокус | PARTIAL | drawer PASS; FE-0022/0026/0035 — код |
