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

