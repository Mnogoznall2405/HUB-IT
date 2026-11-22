# Реестр дефектов web-фронтенда (ISSUES)

Статусы: Confirmed (подтверждено доказательством) / Suspected (гипотеза) / Blocked.
Детали в `evidence/agent-*-report.md`. Обновлено: 2026-11-22 (циклы 1–4).

---

## High

### FE-0004 — Публичная ссылка на общую папку с невалидным токеном ведёт на /login вместо ошибки (только без сессии)

- Категория: Функциональный дефект (публичный маршрут)
- Серьёзность: High; Статус: Confirmed (поведение); механизм до конца не установлен
- Страница: /shared-folders/:token; Компонент: SharedFolder
- Файлы: `src/pages/SharedFolder.jsx:47–57`; смежные: `src/api/http.js:176–184,311–378`, `src/api/myFiles.js:353–381,682–687`
- Шаги: анонимный браузер → https://hubit.zsgp.ru/shared-folders/definitely-invalid-token-xyz
- Ожидаемое: Alert «Папка недоступна…» (как на /shared-files/:invalid — там всё корректно).
- Фактическое: экран входа. С сессией — Alert показывается корректно. API отвечает 404 «Folder not found» и без авторизации (проверено fetch credentials:'omit').
- Подтверждающие данные: живая проверка 2026-11-22 (2 раза), снапшоты; контроль на /shared-files — PASS.
- Рекомендация: выровнять поведение folder-эндпоинтов с file-эндпоинтами (см. FE-0006); воспроизвести анонимный сценарий в incognito для фиксации механизма.
- Связанные: FE-0006. Требует проверки backend.

### FE-0022 — Кликабельные строки таблицы «Склад 1С» недоступны с клавиатуры (desktop)

- Категория: Доступность; Серьёзность: High; Статус: Confirmed (код)
- Файлы: `src/pages/Warehouse1C.jsx:2163–2216` (TableRow onClick без role/tabIndex/onKeyDown), `:1976–1980` (кликабельная TableCell «сопоставление 1С↔HUB»)
- Фактическое: карточку документа можно открыть только мышью; мобильный рядок (:487) корректно имеет role/tabIndex/Enter — асимметрия.
- Влияние: пользователи клавиатуры/скринридеров не могут открыть документы.
- Рекомендация: дублировать паттерн мобильного рядка (role="button", tabIndex, onKeyDown Enter/Space) или добавить явную кнопку «Открыть».
- Источник: агент A (`evidence/agent-A-uiux-report.md`).

### FE-0023 — Мобильная вкладка «Оборудование» (/networks) рендерит все порты (до 10 000) без виртуализации

- Категория: Производительность; Серьёзность: High; Статус: Confirmed (код)
- Файлы: `src/components/networks/EquipmentTab.jsx:351–433` (лимит 10 000, карточки), `src/pages/Networks.jsx:871`; аналогично `SocketsTab.jsx:220–229` (розетки)
- Фактическое: desktop-таблица виртуализируется, мобильная — нет: на телефоне вкладка может отрендерить тысячи карточек → фризы/падение вкладки.
- Рекомендация: react-window (уже в зависимостях) или выгрузка страницами и для мобильной раскладки.
- Источник: агент C (`evidence/agent-C-perf-report.md`, п.1.1–1.2).

---

## Medium

### FE-0001 — Ошибка входа на английском при русском интерфейсе

- Статус: Confirmed; Серьёзность: Medium; Страница: /login
- Файлы: отображение `src/pages/Login.jsx:593–616`; текст из `backend/api/v1/auth.py:801,818`
- Фактическое: баннер «Incorrect username or password» (POST /auth/login → 401).
- Рекомендация: маппинг известных ошибок на русские тексты. Связанные: FE-0002.

### FE-0002 — Вложенные live-регионы role="status" в уведомлении входа

- Статус: Confirmed; Серьёзность: Medium; Страница: /login
- Файлы: `src/pages/Login.jsx:282–294` (InfoBanner role=status) внутри `:416–439` (обёртка role=status aria-live=polite)
- Фактическое: сообщение в двух вложенных live-регионах; в a11y-снапшоте `status` ×2 → двойное объявление скринридером.
- Рекомендация: оставить live-семантику на одном уровне.

### FE-0006 — Мёртвый whitelist публичных my-files URL в 401-перехватчике

- Категория: Надёжность/безопасность; Серьёзность: Medium; Статус: Confirmed (код)
- Файлы: `src/api/http.js:176–184` — `isMyFilesPublicRequestUrl` матчит только `/my-files/public/` и `/my-files/public?`; реальные эндпоинты: файлы `/my-files/public/{token}` (матчится), папки `/my-files/public-folders/{token}` (НЕ матчится); `src/api/myFiles.js:353,360,368,381` против `:683,688`.
- Фактическое: folder-запросы идут без `suppressAuthRequired` и вне whitelist: любой 401 на них запускает refresh-цепочку и `auth-required` (снос сессии/редирект), чего нет у file-запросов. Регресс-тест client.test.js:200 проверяет несуществующий в рантайме URL.
- Рекомендация: добавить `/my-files/public-folders/` в whitelist и `suppressAuthRequired` в folder-запросы; поправить тест на реальные URL.
- Связанные: FE-0004.

### FE-0007 — Сломанные вложения публикаций ленты (410 Gone) — 8 шт. на живой проверке

- Категория: Данные/UX; Серьёзность: Medium; Статус: Confirmed
- Страница: /feed (и /dashboard «Последние новости»)
- Фактическое: 8 запросов `/api/v1/hub/announcements/{id}/attachments/{id}/file` → 410 за одну загрузку ленты; в консоли — 8 ошибок; вложения не отображаются.
- Влияние: пользователи видят битые вложения у старых новостей; шум ошибок в консоли.
- Рекомендация: фронт — обрабатывать 410/404 вложений тихо (placeholder «вложение недоступно»); бэк — чистить ссылки или отдавать заглушку.
- Требует проверки backend. Подтверждающие данные: console capture 2026-11-22 (seq 7–14).

### FE-0008 — Дашборд компьютеров: тяжёлый поиск по всем базам на загрузке (3.2 с) и дубли в списке изменений

- Категория: Производительность/данные; Серьёзность: Medium; Статус: Confirmed (замер); причина — Suspected
- Страница: /computers
- Фактическое: GET `/api/v1/inventory/computers/search?scope=all&search_fields=...` 3250 мс при 1001 ПК; в алерте «Новые изменения оборудования на ПК: 40» имя `BELG-ENRGY-0001-D` встречается дважды (возможен дубликат при слиянии нескольких баз).
- Рекомендация: фронт — не блокировать загрузку дашборда этим запросом (параллельно/лениво), дедуп списка; причина медленного endpoint — backend.
- Требует проверки backend (медленный запрос).

### FE-0009 — Безымянные combobox-фильтры (ZWSP) на нескольких страницах

- Категория: Доступность; Серьёзность: Medium; Статус: Confirmed
- Страницы: /tickets (3 шт.), /database (неск.), /mail, /my-files, /statistics, /warehouse-1c и др.
- Фактическое: в a11y-снапшотах `combobox "​"` / `group "​"` (zero-width space как accessible name) — Autocomplete без aria-label.
- Влияние: скринридер объявляет безымянные поля; невозможность отличить фильтры голосом.
- Рекомендация: добавить aria-label каждому Autocomplete (тексты уже есть рядом в UI).

### FE-0013 — Адресная книга: два запроса docflow/absences по 3.4–3.8 с на загрузке

- Категория: Производительность; Серьёзность: Medium; Статус: Confirmed (замер)
- Страница: /address-book
- Фактическое: `v1/docflow/absences` 3841 мс + `v1/docflow/absences?employee_code=…` 3359 мс за одну загрузку страницы.
- Рекомендация: кэшировать/параллелить/лениво подгружать панель отсутствий; причина медленности — backend (COM-bridge).
- Требует проверки backend.

### FE-0014 — Панель уведомлений без семантики диалога

- Категория: Доступность; Серьёзность: Medium; Статус: Confirmed (DOM)
- Страница: все страницы (MainLayout); компонент: notifications Drawer
- Фактическое: у открытого Drawer `role="presentation"` на корне, у Paper нет `role="dialog"`, `aria-modal`, `aria-label`; при этом фокус-менеджмент корректен (фокус внутри, Tab не уходит, Esc закрывает, фокус возвращается на колокольчик).
- Влияние: скринридер не объявляет открытие панели.
- Рекомендация: `role="dialog" aria-modal="true" aria-label="Уведомления"` на Paper.

### FE-0024 — Networks: 6+ IconButton без aria-label (Оборудование/Розетки/Карта)

- Категория: Доступность; Серьёзность: Medium; Статус: Confirmed (код)
- Файлы: `Networks.jsx:2132,2214,2704,2712,2748,3006`; `networks/EquipmentTab.jsx:249,313,320,417,513,568`; `SocketsTab.jsx:198,285,381`; `InteractiveMapCanvas.jsx:409,414,419`; аналогично `BranchDialogs.jsx:146`
- Источник: агент A.

### FE-0025 — Карточка задачи: Открыть/Редактировать/Скопировать без доступного имени

- Категория: Доступность; Серьёзность: Medium; Статус: Confirmed (код)
- Файл: `src/components/hub/tasks/TaskCard.jsx:322,335,363` («Удалить» на :352 подписан — непоследовательность)
- Источник: агент A.

### FE-0026 — Невидимый фокус в чате и истории тостов

- Категория: Доступность; Серьёзность: Medium; Статус: Confirmed (код)
- Файлы: `src/components/chat/ChatBubble.jsx:1820–1856` (кнопка выделения сообщения: outline:none без focus-visible); `src/components/layout/ToastHistoryList.jsx:70–86` (role=button, outline:none)
- Источник: агент A.

### FE-0027 — «Загрузка…» не читается в протоколах встреч (тёмное на тёмном)

- Категория: UI/контраст; Серьёзность: Medium; Статус: Confirmed (код)
- Файл: `src/components/voice-video/VoiceLogViewer.jsx:242` — text.secondary (#…) на фоне `#1a1b23`
- Источник: агент A.

### FE-0028 — Mfu: Drawer шириной 360px на экранах <360px

- Категория: UI/адаптивность; Серьёзность: Medium; Статус: Confirmed (код)
- Файл: `src/pages/Mfu.jsx:1297–1298` (`width:{xs:360}`)
- Источник: агент A.

### FE-0029 — Networks: ключевой обработчик keydown переустанавливается на каждый рендер

- Категория: Производительность; Серьёзность: Medium; Статус: Confirmed (код)
- Файл: `src/pages/Networks.jsx:2055–2074` (deps — незамемоизированные функции + displayedPorts)
- Источник: агент C.

### FE-0030 — Networks: ~80 useState в одном компоненте (3300 строк) — любой ввод перерисовывает страницу с картой

- Категория: Производительность/архитектура; Серьёзность: Medium; Статус: Confirmed (структурно)
- Файл: `src/pages/Networks.jsx:138–311`
- Источник: агент C.

### FE-0031 — InteractiveMapCanvas: полный ре-рендер карты на каждый pointermove

- Категория: Производительность; Серьёзность: Medium; Статус: Confirmed (код); масштаб — live
- Файл: `src/components/networks/InteractiveMapCanvas.jsx:530–544,55–105` — `setDraggedPoint` без троттлинга → пересчёт кластеризации всех точек
- Источник: агент C.

### FE-0032 — MyFiles: массовое скачивание без очереди/лимита параллельности

- Категория: Производительность/надёжность; Серьёзность: Medium; Статус: Confirmed (код)
- Файл: `src/pages/MyFiles.jsx:1332–1337`
- Влияние: выбор десятков файлов → десятки параллельных загрузок, падение сети/браузера.
- Источник: агент C.

### FE-0033 — Warehouse1C: списки 200–1000 строк без виртуализации и memo

- Категория: Производительность; Серьёзность: Medium; Статус: Confirmed (код)
- Файлы: `src/pages/Warehouse1C.jsx:903/923, 1922/1970, 2121/2162`
- Источник: агент C.

### FE-0034 — Публичные страницы SharedFolder: IconButton без aria-label

- Категория: Доступность; Серьёзность: Medium; Статус: Confirmed (код)
- Файл: `src/pages/SharedFolder.jsx:231,248` — доступные имена только в Tooltip (не доступны скринридеру)
- Источник: агент A. (Также `MailTemplatesDialog.jsx:183,190,196`, `VoiceLogViewer.jsx:229,234`, `Passwords.jsx:900`, `passwords/PasswordFiltersPanel.jsx:39`, `Vcs.jsx:686`, `Mfu.jsx:990`, `UsersTab.jsx:321`.)

### FE-0035 — Networks: кликабельные TableRow без клавиатуры (списки портов/розеток)

- Категория: Доступность; Серьёзность: Medium; Статус: Confirmed (код)
- Файлы: `Networks.jsx:2243`, `SocketsTab.jsx:351`
- Источник: агент A.

---

## Low

| ID | Суть | Файл/место | Статус |
|---|---|---|---|
| FE-0003 | Кнопка показа пароля 25×25px (< минимума 36px) | `Login.jsx` (форма логина) | Confirmed (замер) |
| FE-0005 | Дубли идентичных poll-запросов уведомлений на загрузке (2× poll?since=…&limit=20) | `MainLayout.jsx:1413–1611` | Confirmed (сеть) |
| FE-0010 | Английские MUI-лейблы в русском UI: кнопка «Open» у Autocomplete на /database, /scan-center, /company-structure, /warehouse-1c; на /address-book — «Открыть» (непоследовательно). Также «Loading...» в `App.jsx:164–166` | `App.jsx:164`, Autocomplete без локализации popupIndicator | Confirmed |
| FE-0011 | /scan-center: переполнение 12px при 1920 (MuiGrid spacing) → горизонтальный скролл; при 1366/1280 чисто | ScanCenter (Grid «Состояние контура») | Confirmed (замер+скриншот) |
| FE-0012 | /docflow: дубль идентичных `tasks?scope=inbox` на загрузке (222+195 мс) | Docflow.jsx | Confirmed (сеть) |
| FE-0015 | Сессия сброшена при смене UA (mobile-эмуляция): /auth/me → 401 → auth-required → logout. Наблюдение; похоже на UA-пиннинг сессии — проверить политику бэкенда | AuthContext + backend deps | Suspected (needsBackendCheck) |
| FE-0016 | Транзиентные 5×401 в консоли при быстрых переключениях вкладок /tasks; при повторе не воспроизведены | неизвестный ресурс (URL не сохранён) | Suspected |
| FE-0017 | ESLint: 1 error (`chatRegressionFlows.test.jsx:426` 'describe' is not defined — нет vitest-globals), 1143 warnings chat, 735 warnings mail (в основном no-unused-vars) | eslint-конфиг | Confirmed |
| FE-0018 | /voice: три медленных запроса ~1.2–1.3 c на загрузку (jobs?limit=100, meetings?limit=20, meetings?limit=1) | VoiceVideo; причина — backend | Confirmed (замер) |
| FE-0019 | /admin: 30 API-вызовов на загрузку, auth/sessions 1.1 c | Admin/UsersTab | Confirmed (замер) |
| FE-0020 | /construction, /it/requests: возраст снимка 1С в сырых секундах («169 979 сек») — нечитаемо; сама интеграция 1С отстаёт на ~2 дня | ConstructionObjects (alert) | Confirmed (наблюдение) |
| FE-0036 | Мёртвые состояния equipmentLoading/socketsLoading/mapsLoading (сеттеры не вызываются) | `Networks.jsx:302–304` | Confirmed (агент A) |
| FE-0037 | Вечно disabled кнопка-индикатор «Установлена» | `account/admin/HubDesktopDeploySection.jsx:422` | Confirmed (агент A) |
| FE-0038 | Двойная система стилей: Tailwind (Login, чат) vs MUI sx (остальное) + переменные --chat-* | глобально | Confirmed (агент A) |
| FE-0039 | Тема: AGENTS.md требует dark theme, но `theme/index.js:31` — только mode:'light'; dark-ветки (officeUiTokens/chatTelegramTheme) не активны | theme/index.js | Confirmed (агент A; противоречие докам) |
| FE-0040 | qrcode статически в чанке Login/Passwords (нужен только для TOTP-QR) | `Login.jsx:3`, `PasswordUnlockDialog.jsx:2` | Confirmed (агент C) |
| FE-0041 | SharedFile: ежесекундный setNowMs безусловно (нужен только для отсчёта срока) | `SharedFile.jsx:576–579` | Confirmed (агент C) |
| FE-0042 | Statistics: повторный fetch при переключении вкладки/периода без swrCache | `Statistics.jsx:290–296` | Confirmed (агент C) |
| FE-0043 | FeedCommentsPanel: опрос 15 c → K+1 запрос при K раскрытых ветках | `FeedCommentsPanel.jsx:130–138` | Confirmed (агент C) |
| FE-0044 | Множественные безымянные tablist («Tab list») на одной странице (/tasks: 2 шт., /database, /statistics, /voice) — без aria-label | несколько страниц | Confirmed (a11y-снапшоты) |
| FE-0045 | Tasks: каждая вкладка перезабирает список заново (rapid-switch: 7 кликов → 10 запросов, 3× одинаковых sort_by=due_at) | Tasks.jsx | Confirmed (сеть; согласуется с FE-0042) |

## UX-наблюдения (не дефекты)

- Login notice (ошибка входа) живёт 5.2 с и исчезает — легко пропустить (Login.jsx:593–616). Дизайн-решение.
- PWA: Chrome сообщает «Banner not shown: beforeinstallpromptevent.preventDefault() called…» — системный баннер установки подавлен, а свой не показывается. Проверить `serviceWorkerPush*`. Suspected, Low.
- /it/requests без параметра автоматически открывает первую активную заявку (finalUrl получает :requestRef) — неожиданно, но осознанно; задокументировать.
- Права: у учётки есть доступ в /admin (permission-based AdminAreaRoute), но /dlp и /file-egress закрыты (adminOnly по строке role==='admin') — два разных механизма доступа; согласовать (продуктовое решение).
- Положительное: стартовый бандл ~223 КБ gzip, все 38 маршрутов lazy, тяжёлые библиотеки — dynamic import; утечек слушателей/WS не найдено (агент C). Поиск адресной книги дебаунсится корректно (1 запрос на 10 символов). Колокольчик: фокус-менеджмент правильный.

## Агент D: State/Cache/Async (добавлено после цикла 6)

| ID | Суть | Файл/место | Серьёзность | Статус |
|---|---|---|---|---|
| FE-0046 | ItObjectDetail: сводка «Пароли» без AbortSignal; `passwordsAPI.getEntries` вообще не поддерживает `signal` — запрос не отменяется при смене `:objectRef`/unmount, дублируется при remount | `src/pages/ItObjectDetail.jsx:60`, `src/api/passwords.js:6-9` | Medium | Confirmed |
| FE-0047 | «Эпоха отказа auth» (`authRequiredNotified`) сбрасывается только после `/auth/login` и `/auth/verify-2fa`; вход по passkey (`/auth/passkey-login/verify`) и trusted-device её не сбрасывает — окно ≤12 мин без автологина при последующем отказе сессии | `src/api/http.js:61-64,281-283` | Low | Confirmed (код), влияние Suspected |
| FE-0048 | swrCache: `force`-чтение присоединяется к уже идущему обычному запросу того же ключа — «Обновить» не гарантирует новый fetch | `src/lib/swrCache.js:114-117` | Low | Confirmed |
| FE-0049 | Computers: `loadChangesDeferred` без abort/cancelled — setState после unmount | `src/pages/Computers.jsx:950-960` | Low | Confirmed |
| FE-0050 | ChatOpen: `createDirectConversation` вызывается дважды в StrictMode dev (lookup закэширован, create — нет) | `src/pages/ChatOpen.jsx:56` | Low | Suspected (dev-only) |
| FE-0051 | swrCache: инвалидация отсоединяет кэш, но await-нувший потребитель может применить «дофетченный» ответ без перепроверки | `src/lib/swrCache.js` | Low | Suspected |

Проверено и защищено (агент D): все детальные страницы сбрасывают состояние при смене
route-параметра; abort+seq-guard; чат — keyed in-flight, дедуп, backpressure ≤100,
backoff+heartbeat, degraded-poll; AuthContext refresh-гейт; debounce во всех серверных
поисках; пустых catch{} и вечных loading не найдено.

## Счётчики (подтверждённые)

| Серьёзность | Кол-во | ID |
|---|---|---|
| Critical | 0 | — |
| High | 3 | FE-0004, FE-0022, FE-0023 |
| Medium | 22 | FE-0001, 0002, 0006, 0007, 0008, 0009, 0013, 0014, 0024–0035, 0046 |
| Low | 22 | FE-0003, 0005, 0010–0012, 0015–0020, 0036–0045, 0047–0051 |

