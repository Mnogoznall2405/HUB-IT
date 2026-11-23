# Реестр дефектов web-фронтенда (ISSUES)

Статусы: Confirmed (подтверждено доказательством) / Suspected (гипотеза) / Blocked.
Обновлено: 2026-11-22 (циклы 1–8). Полные отчёты субагентов A/C/D/E — в
`evidence/agent-*-report.md` (восстановлены после инцидента удаления файлов; краткие
сводки — `evidence/agent-*-summary.md`). Все записи перепроверены: ключевые позиции
High/Medium подтверждены повторным чтением кода и/или живыми замерами.

---

## High

### FE-0004 — Публичная ссылка на общую папку с невалидным токеном ведёт на /login вместо ошибки (только без сессии)

- Категория: Функциональный дефект (публичный маршрут); Серьёзность: High; Статус: Confirmed (поведение ×2), механизм не установлен окончательно
- Страница: /shared-folders/:token; Компонент: SharedFolder
- Файлы: `src/pages/SharedFolder.jsx:47–57`; смежные: `src/api/http.js:176–184,311–378`, `src/api/myFiles.js:353–381` (папки) vs `:682–696` (файлы)
- Шаги: анонимный браузер → https://hubit.zsgp.ru/shared-folders/definitely-invalid-token-xyz
- Ожидаемое: Alert «Папка недоступна…» (аналог /shared-files/:invalid — там всё корректно).
- Фактическое: экран входа. С сессией — Alert показывается корректно. API отвечает 404 «Folder not found» даже без авторизации (проверено fetch credentials:'omit'). IIS web.config исключён (SPA-fallback корректен); 401-перехватчик не срабатывает на 404.
- Подтверждающие данные: живая проверка 2026-11-22 (2 раза), a11y-снапшоты; контроль /shared-files PASS.
- Рекомендация: воспроизвести в incognito для фиксации механизма; выровнять folder-эндпоинты с file (FE-0006).
- Связанные: FE-0006. Требует проверки backend.

### FE-0022 — Кликабельные строки таблицы «Склад 1С» недоступны с клавиатуры (desktop)

- Категория: Доступность; Серьёзность: High; Статус: Confirmed (код)
- Файлы: `src/pages/Warehouse1C.jsx:2163–2216` (TableRow onClick без role/tabIndex/onKeyDown), `:1976–1980` (кликабельная TableCell «сопоставление 1С↔HUB»)
- Фактическое: карточку документа можно открыть только мышью; мобильный рядок (:487) корректно имеет role/tabIndex/Enter — асимметрия.
- Влияние: пользователи клавиатуры/скринридеров не могут открыть документы.
- Рекомендация: дублировать паттерн мобильного рядка или добавить явную кнопку «Открыть».
- Источник: агент A.

### FE-0023 — Мобильная вкладка «Оборудование» (/networks) рендерит все порты (до 10 000) без виртуализации

- Категория: Производительность; Серьёзность: High; Статус: Confirmed (код)
- Файлы: `src/components/networks/EquipmentTab.jsx:351–433` (лимит 10 000, карточки), `src/pages/Networks.jsx:871`; аналогично `SocketsTab.jsx:220–229` (розетки)
- Фактическое: desktop-таблица виртуализируется, мобильная — нет: на телефоне вкладка может отрендерить тысячи карточек → фризы/падение вкладки.
- Рекомендация: react-window (уже в зависимостях) или пагинация для мобильной раскладки.
- Источник: агент C.

---

## Medium

### FE-0001 — Ошибка входа на английском при русском интерфейсе
- Статус: Confirmed; Страница: /login; Файлы: `src/pages/Login.jsx:593–616`; текст из `backend/api/v1/auth.py:801,818`
- Фактическое: баннер «Incorrect username or password» (POST /auth/login → 401; a11y-снапшот).
- Рекомендация: маппинг известных ошибок на русские тексты. Связанные: FE-0002.

### FE-0002 — Вложенные live-регионы role="status" в уведомлении входа
- Статус: Confirmed; Страница: /login; Файлы: `src/pages/Login.jsx:282–294` (InfoBanner role=status) внутри `:416–439` (обёртка role=status aria-live=polite)
- Фактическое: a11y-снапшот: `status "Incorrect…"` ×2 → двойное объявление скринридером; live-region внутри live-region — ARIA-антипаттерн.

### FE-0006 — Мёртвый whitelist публичных my-files URL в 401-перехватчике
- Статус: Confirmed (код); Файлы: `src/api/http.js:176–184`
- Фактическое: `isMyFilesPublicRequestUrl` матчит `/my-files/public/` (файлы — матчится), но НЕ `/my-files/public-folders/` (папки); folder-запросы идут без `suppressAuthRequired`. Любой 401 на folder-запросе запускает refresh-цепочку/auth-required. Тест client.test.js:200 проверяет несуществующий в рантайме URL-паттерн.
- Рекомендация: добавить public-folders в whitelist + suppressAuthRequired; поправить тест. Связанные: FE-0004.

### FE-0007 — Сломанные вложения публикаций ленты (410 Gone) — 8 шт. за загрузку
- Статус: Confirmed; Страница: /feed
- Фактическое: 8× `GET /api/v1/hub/announcements/{id}/attachments/{id}/file` → 410 за одну загрузку; консоль: 8 ошибок.
- Рекомендация: тихая обработка 410/404 вложений + placeholder. Требует проверки backend (почему вложения Gone, но ссылки остались).

### FE-0008 — Дашборд компьютеров: тяжёлый поиск по всем базам на загрузке (3.2 с) и дубли в списке изменений
- Статус: Confirmed (замер); Страница: /computers
- Фактическое: GET `/api/v1/inventory/computers/search?scope=all&…` 3250 мс (1001 ПК); в алерте «Новые изменения…: 40» имя `BELG-ENRGY-0001-D` дважды (дубли при слиянии баз?).
- Рекомендация: не блокировать загрузку; дедуп. Требует проверки backend (медленный запрос).

### FE-0009 — Безымянные combobox-фильтры (ZWSP) на нескольких страницах
- Статус: Confirmed; Страницы: /tickets (3), /database, /mail, /my-files, /statistics, /warehouse-1c и др.
- Фактическое: a11y-снапшоты: `combobox "​"` / `group "​"` — Autocomplete без aria-label.
- Рекомендация: aria-label каждому Autocomplete.

### FE-0013 — Адресная книга: два запроса docflow/absences по 3.4–3.8 с на загрузке
- Статус: Confirmed (замер); Страница: /address-book
- Фактическое: `v1/docflow/absences` 3841 мс + `v1/docflow/absences?employee_code=…` 3359 мс.
- Рекомендация: лениво/кэшировать; причина — backend (COM-bridge). needsBackendCheck.

### FE-0014 — Панель уведомлений без семантики диалога
- Статус: Confirmed (DOM); Компонент: notifications Drawer (MainLayout)
- Фактическое: у открытого Drawer корень `role="presentation"`, Paper без `role="dialog"`/`aria-modal`/`aria-label`; фокус-менеджмент при этом корректен (фокус внутри, Tab не уходит, Esc, возврат на колокольчик).
- Рекомендация: `role="dialog" aria-modal="true" aria-label="Уведомления"` на Paper.

### FE-0024 — Networks: 16+ IconButton без aria-label
- Статус: Confirmed (код); Файлы: `Networks.jsx:2132,2214,2704,2712,2748,3006`; `EquipmentTab.jsx:249,313,320,417,513,568`; `SocketsTab.jsx:198,285,381`; `InteractiveMapCanvas.jsx:409,414,419`; `BranchDialogs.jsx:146`
- Источник: агент A.

### FE-0025 — TaskCard: Открыть/Редактировать/Скопировать без доступного имени
- Статус: Rejected (цикл 12: MUI Tooltip с string title выставляет aria-label; имена есть); Файл: `src/components/hub/tasks/TaskCard.jsx:321,334,362`

### FE-0026 — Невидимый фокус в чате и истории тостов
- Статус: Confirmed (код); Файлы: `src/components/chat/ChatBubble.jsx:1820–1856` (outline:none без focus-visible); `src/components/layout/ToastHistoryList.jsx:70–86` (role=button, outline:none)

### FE-0027 — «Загрузка…» не читается в протоколах встреч (тёмное на тёмном)
- Статус: Confirmed (код); Файл: `src/pages/voice-video/VoiceLogViewer.jsx:240–242` (bgcolor #1a1b23 + text.secondary; рядом «Лог пуст» корректно использует rgba(255,255,255,0.4))

### FE-0028 — Mfu: Drawer 360px шире экранов <360px
- Статус: Confirmed (код); Файл: `src/pages/Mfu.jsx:1297–1298` (`width:{xs:360}`)

### FE-0029 — Networks: keydown-листенер переустанавливается на каждый рендер
- Статус: Confirmed (код); Файл: `src/pages/Networks.jsx:2055–2074` (deps — незамемоизированные функции)

### FE-0030 — Networks.jsx: ~80 useState в одном компоненте (3300 строк)
- Статус: Confirmed (структурно); Файл: `src/pages/Networks.jsx:138–311` — любой ввод перерисовывает страницу с картой

### FE-0031 — InteractiveMapCanvas: полный ре-рендер карты на каждый pointermove
- Статус: Confirmed (код); Файл: `src/components/networks/InteractiveMapCanvas.jsx:530–544,55–105` — `setDraggedPoint` без троттлинга → пересчёт кластеризации всех точек

### FE-0032 — MyFiles: массовое скачивание без очереди/лимита
- Статус: Confirmed (код); Файл: `src/pages/MyFiles.jsx:1332–1337` — выбор десятков файлов → десятки параллельных загрузок

### FE-0033 — Warehouse1C: списки 200–1000 строк без виртуализации и memo
- Статус: Confirmed (код); Файл: `src/pages/Warehouse1C.jsx:903/923, 1922/1970, 2121/2162`

### FE-0034 — IconButton без aria-label на публичных и др. страницах
- Статус: Suspected (цикл 12: Tooltip-обёрнутые кнопки имеют aria-label и дефектом не являются; реальные случаи — `Vcs.jsx:686-698`, `Mfu.jsx:988-994`, `UsersTab.jsx:321`); Файлы: `SharedFolder.jsx:231,248` (ложное срабатывание)

### FE-0035 — Networks: кликабельные TableRow без клавиатуры
- Статус: Confirmed (код); Файлы: `Networks.jsx:2243`, `SocketsTab.jsx:351`

### FE-0046 — ItObjectDetail: сводка «Пароли» без AbortSignal
- Статус: Confirmed (код); Файлы: `src/pages/ItObjectDetail.jsx:60`; `src/api/passwords.js:6–9` (getEntries не поддерживает signal) — дублирование при remount, не отменяется при смене :objectRef
- Источник: агент D.

### FE-0053 — Диалог создания задачи: пустой заголовок (ZWSP), имя «Dialog» по умолчанию
- Статус: Confirmed (a11y-снапшот `dialog "Dialog"`, текст начинается с ZWSP); Файл: `src/components/hub/tasks/TasksCreateDialog.jsx`
- Контраст: диалоги «Новая папка»/«Удалить папку»/«Удалить сообщение?» — с корректными заголовками.

### FE-0056 — Удаление/перемещение черновика письма: API 400, UI молчит
- Статус: Confirmed (сеть: POST `…/delete` → 400 и POST `…/move` → 400; ни тоста, ни диалога; элемент остаётся; состояние «догоняет» синхронизация — черновик исчез после ресинка)
- Файлы: фронт `src/api/mailMessageActions.js:28–29`, UI панели чтения; причина — backend `services/mail_message_actions.py:303–313` (`_message_item` не находит черновик → MailMessageActionError → 400)
- Серьёзность: Medium (сценарий «удалить черновик» сломан, но самовосстанавливается синком; нет обработки ошибки — фронт).
- Рекомендация: фронт — показать ошибку и/или использовать специальный путь удаления черновиков; backend — выяснить 400. needsBackendCheck.

---

## Low

| ID | Суть | Файл/место | Статус |
|---|---|---|---|
| FE-0003 | Кнопка показа пароля 25×25px (< минимума 36px) | `Login.jsx` (форма логина) | Confirmed (замер) |
| FE-0005 | Дубли идентичных poll-запросов уведомлений на загрузке (2× poll?since=…&limit=20) | `MainLayout.jsx:1413–1611` | Confirmed (сеть) |
| FE-0010 | Английские MUI-лейблы в русском UI: «Open» у Autocomplete (/database, /scan-center, /company-structure, /warehouse-1c); на /address-book — «Открыть» (непоследовательно); «Loading...» `App.jsx:164–166` | Autocomplete popupIndicator без локализации | Confirmed |
| FE-0011 | /scan-center: переполнение 12px при 1920 (MuiGrid spacing) → горизонтальный скролл; при 1366/1280 чисто | ScanCenter (Grid «Состояние контура») | Confirmed (замер+скриншот) |
| FE-0012 | /docflow: дубль идентичных `tasks?scope=inbox` на загрузке (222+195 мс) | Docflow.jsx | Confirmed (сеть) |
| FE-0015 | Сессия сброшена при смене UA (mobile-эмуляция): /auth/me → 401 → auth-required → logout. После находки FE-0059 более вероятен общий механизм: перезагрузка попала в окно ротации (grace 15 c), UA-пиннинг не подтверждён | AuthContext + backend deps | Rejected (цикл 13: дубль/следствие FE-0059) |
| FE-0016 | Транзиентные 5×401 в консоли при rapid-switch вкладок /tasks; при повторе не воспроизведены; возможно, окно разлогина | неизвестный ресурс | Rejected (цикл 13: нет воспроизводимого источника) |
| FE-0017 | ESLint: 1 error (`chatRegressionFlows.test.jsx:426` 'describe' no-undef) + 1143 warnings chat, 735 warnings mail (no-unused-vars) | eslint-конфиг | Confirmed |
| FE-0018 | /voice: три запроса ~1.2–1.3 c на загрузку (jobs?limit=100, meetings?limit=20, meetings?limit=1) | VoiceVideo; причина — backend | Confirmed (замер) |
| FE-0019 | /admin: 30 API-вызовов на загрузку, auth/sessions 1.1 c | Admin/UsersTab | Confirmed (замер) |
| FE-0020 | Возраст снимка 1С в сырых секундах («169 979 сек»); интеграция 1С отстаёт на ~2 дня | /construction, /it/requests | Confirmed (needsBackendCheck) |
| FE-0036 | Мёртвые состояния equipmentLoading/socketsLoading/mapsLoading (сеттеры не вызываются) | `Networks.jsx:302–304` | Confirmed |
| FE-0037 | Вечно disabled кнопка-индикатор «Установлена» | `HubDesktopDeploySection.jsx:422` | Rejected (цикл 12: намеренный disabled «Установить» с Tooltip) |
| FE-0038 | Двойная система стилей: Tailwind (Login/чат) vs MUI sx (остальное) | глобально | Confirmed |
| FE-0039 | Тема light-only (`theme/index.js:31`), AGENTS.md требует dark theme — противоречие | theme/index.js | Confirmed |
| FE-0040 | qrcode статически в чанке Login/Passwords (нужен только для TOTP-QR) | `Login.jsx:3`, `PasswordUnlockDialog.jsx:2` | Confirmed |
| FE-0041 | SharedFile: ежесекундный setNowMs безусловно | `SharedFile.jsx:576–579` | Confirmed |
| FE-0042 | Statistics: повторный fetch при переключении вкладки/периода без swrCache | `Statistics.jsx:290–296` | Confirmed |
| FE-0043 | FeedCommentsPanel: опрос 15 c → K+1 запрос при K раскрытых ветках | `FeedCommentsPanel.jsx:130–138` | Confirmed |
| FE-0044 | Безымянные tablist («Tab list») на страницах с несколькими наборами вкладок | /tasks×2, /database, /statistics, /voice | Confirmed (a11y) |
| FE-0045 | Tasks: каждая вкладка перезабирает список (rapid-switch: 7 кликов → 10 запросов, 3× sort_by=due_at) | Tasks.jsx | Confirmed (сеть) |
| FE-0047 | «Эпоха отказа auth» не сбрасывается входом passkey/trusted-device (окно ≤12 мин) | `src/api/http.js:61–64,281–283` | Confirmed (код), влияние Suspected |
| FE-0048 | swrCache: force-чтение присоединяется к идущему обычному запросу — «Обновить» не гарантирует fetch | `src/lib/swrCache.js:114–117` | Confirmed |
| FE-0049 | Computers: loadChangesDeferred без abort/cancelled (setState после unmount) | `Computers.jsx:950–960` | Confirmed |
| FE-0050 | ChatOpen: createDirectConversation дважды в StrictMode dev | `ChatOpen.jsx:56` | Rejected (цикл 13: cancelled-проверка + get-or-create) |
| FE-0051 | swrCache: потребитель может применить «отсоединённый» ответ без перепроверки | `src/lib/swrCache.js` | Suspected |
| FE-0052 | Мобильный заголовок /scan-center — «Scan Center», десктоп — «Контроль документов»; остальные страницы русские | `ScanCenterPage.jsx:2028` | Confirmed |
| FE-0054 | При открытии диалога создания задачи — 2 идентичных GET `/hub/users/controllers` | TasksCreateDialog wiring | Confirmed (сеть) |
| FE-0057 | Панель чтения письма: блок даты (76×42, pointer-events:auto) наезжает на кнопки «Удалить»/«Ещё действия» — клик по центру кнопки попадает в дату | Mail reading pane | Confirmed (замер геометрии) |
| FE-0058 | Удаление задачи через нативный window.confirm; папки/сообщения — MUI-диалоги: непоследовательный паттерн подтверждений | Tasks | Confirmed |
| FE-0060 | Чат: во время офлайна (5 c) не появляется индикатор потери связи — проверить порог показа | /chat | Rejected (цикл 12: индикатор реализован, исходное утверждение ложно) |
| FE-0061 | Страница входа без landmark `<main>` (axe: landmark-one-main); SharedFile имеет component="main", login (Tailwind) — нет | `Login.jsx` | Confirmed (Lighthouse/axe) |
| FE-0062 | Viewport-мета запрещает масштабирование: `maximum-scale=1.0, user-scalable=no` — WCAG 1.4.4 (слабовидящие не могут увеличить). Закреплено тестом `indexHtml.test.js:10-11` — осознанное решение, требует пересмотра | `index.html:7` | Confirmed |
| FE-0063 | `/robots.txt` отдаёт SPA index.html (200, HTML) — IIS SPA-fallback не исключает robots.txt; Lighthouse: «robots.txt is not valid». Для внутреннего портала некритично, но гигиена конфига | `public/web.config:150–161` | Confirmed (live) |

### FE-0059 — Обрыв сети >15 с во время ротации refresh-токена принудительно разлогинивает

- Категория: Auth/надёжность сети; Серьёзность: **High**; Статус: Confirmed (поведение, причина установлена; осознанный компромисс — см. AUTH_SECURITY_STACK.md:18–19)
- Страница: любые защищённые (воспроизведено на /chat, 2026-11-22 ~23:25)
- Файлы: причина — `backend/api/v1/auth.py:1648` (`grace_ttl = … refresh_rotation_grace_seconds or 15`), `:135` (`_REFRESH_GRACE_MAX_HITS = 1`), `:1656–1687` (reuse → family revoke → 401); фронт восстановления не имеет (и не может без смены политики auth)
- Шаги: 1) живая сессия ~50 мин (access-TTL 15 мин); 2) офлайн ≥5 с в момент ротации; 3) возврат сети.
- Фактическое: консоль: WS failed ×N, auth/me и auth/refresh ERR_INTERNET_DISCONNECTED; после возврата: auth/me 401 → auth/refresh 401 → auth-required → localStorage 'user' удалён → /login. Сессия потеряна полностью.
- Механизм: одноразовая ротация refresh; grace старого токена 15 с; обрыв дольше окна (или потеря ответа ротации) → «already used» → 401 → logout. Объясняет FE-0015 и, вероятно, FE-0016.
- Влияние: пользователи нестабильных сетей (роуминг Wi-Fi, мобильный интернет, VPN) теряют сессию и несохранённый ввод.
- Рекомендация (решение владельца; auth-политику не менять как side effect): рассмотреть grace 60–120 с для web или мягкое восстановление с сохранением черновиков; замерить метрики `refresh_reuse_detected` / `refresh_expired_or_already_used`.
- Дополнительно (наблюдение): во время офлайна в чате НЕ появился ни один индикатор потери связи — проверить порог показа.

## Мутационные сценарии (тестовые данные, production; согласовано владельцем)

**PASS:** создание+удаление задачи (валидация каскадом, проект предзаполнен); создание+корзина+«Удалить навсегда» папки MyFiles (автообновление списка); отправка+удаление сообщения в чате «Заметки» (через WS); сохранение черновика письма (Escape → MUI-диалог). Все тестовые данные удалены полностью (проверено: задач нет, папка удалена навсегда, сообщение удалено, черновик исчез из Черновиков и Удаленных).
**FAIL:** удаление/перемещение черновика (FE-0056).

## Наблюдения (не дефекты фронтенда)

- Дубль учётных записей одного сотрудника в справочнике (две AD-записи; идентификаторы обезличены) — данные AD; не фронтенд.
- Список задач после создания не показал задачу до смены скоупа (возможно, назначение на дублирующую учётку) — Suspected.
- Композер письма: нет явной кнопки закрытия (только Escape) — UX-наблюдение.
- Login notice живёт 5.2 с (ошибку легко пропустить) — UX-наблюдение.
- PWA: Chrome «Banner not shown: beforeinstallpromptevent.preventDefault() called…» — Suspected.
- `/it/requests` без параметра открывает первую активную заявку — задокументированное поведение.
- Два механизма «админского» доступа: `/admin` по правам (canAccessAdminArea), `/dlp`,`/file-egress` по role==='admin' — согласовать (продукт).
- VoiceVideoPage.jsx:622: MobileShellPageHeader с `display:'none'` — мёртвая разметка.

## Агент E: надёжность и безопасность (полный отчёт: evidence/agent-E-security-report.md)

| ID | Суть | Файл/место | Серьёзность | Статус |
|---|---|---|---|---|
| FE-0064 | Self-XSS через вставку: contentEditable-редактор описания задачи (мобильный) без перехвата paste; начальное значение и сохранение экранируются, но вставленный из буфера HTML исполняется в origin до конвертации (в почтовом редакторе paste санируется — здесь нет) | `src/components/hub/tasks/MobileCreateDescriptionEditor.jsx:27–33,84–91` | Medium | Confirmed (код); runtime-подтверждение желательно |
| FE-0065 | CSP включён только как Report-Only; при переводе в enforce сломается drawio (нет `frame-src` — наследует `default-src 'self'`) | `public/web.config:186` | Low (рекомендация; слой защиты не реализован) | Confirmed |
| FE-0066 | Почтовые вложения: нет клиентских проверок размера/типа/количества; IIS режет на 64 МБ (`web.config:12–16`) с неочевидной ошибкой после полной загрузки | `src/components/mail/MailComposeHost.jsx:993–1008` | Low | Confirmed; needsBackendCheck (лимиты FastAPI) |
| FE-0067 | VoiceMeetingSummary: ReactMarkdown без rehype-sanitize (в отличие от MarkdownRenderer) — прямого XSS нет, защита держится на дефолтах библиотеки | `src/pages/voice-video/VoiceMeetingSummary.jsx:301` | Low | Confirmed |
| FE-0068 | Ссылка target=_blank из HTML-подписи проходит sanitizeMailHtmlFragment без добавления rel=noopener (гарантия есть только в buildRenderedMailHtml) | `src/components/mail/mailHtmlContent.js:23–24,80–92`, `AiMailActionEditDialog.jsx:96,186` | Low | Confirmed |
| FE-0069 | Клиентские права — только UX-слой: `alwaysGrantedPermissions` даёт всем роли mail.access/my_files.write/tasks.create и др.; при отсутствии `permissions` от сервера включается `rolePermissionFallback`; `role==='admin'` → hasPermission=true без списка. **Обязательна серверная сверка всех routePermissions/adminOnly-эндпоинтов (включая персональные данные: tickets.personal_data.read, address_book.*)** | `src/contexts/AuthContext.jsx:17–34,132–141,698–707`, `src/App.jsx:108–149` | Info (не уязвимость; требует backend-сверки) | Confirmed |
| FE-0070 | Нет глобального сбора ошибок (window.onerror/unhandledrejection) — покрываются только chunk-ошибки; «тихие» отказы вне React-дерева не наблюдаемы | `src/main.jsx:44–54` | Low | Confirmed |
| FE-0071 | Сырые axios-сообщения могут попасть в UI («Request failed with status code 500»; не-HTML не-JSON текст ответа показывается целиком) | `src/components/mail/mailErrorModel.js:16–24,72–74` | Low | Confirmed; needsBackendCheck (формат 5xx) |
| FE-0072 | 403 приравнен к «сессия отклонена» (isDefinitiveAuthRejection: 401 ИЛИ 403) → лишние logout, если сервер отдаёт 403-из-за-прав на auth-цепочке | `src/api/http.js:186-189`, `AuthContext.jsx:171-174,256-258` | Low | Rejected (цикл 13: 403 не вызывает logout обычных запросов) |
| FE-0073 | quill 2.0.2 (точный pin, история XSS) — все входы/выходы обёрнуты DOMPurify-санитайзерами; npm audit не проводился (прод-сервер) | `package.json:42`, `MailRichTextEditor.jsx:161–192` | Info | Confirmed (обвязка) |
| FE-0074 | MyFiles: window.open same-origin без noopener (все прочие ~20 вызовов — с 'noopener,noreferrer') | `src/pages/MyFiles.jsx:401` | Info | Confirmed |
| FE-0075 | drawio-мост: при невалидном VITE_DRAWIO_EDITOR_URL origin='' → проверка origin пропускается, ответ postMessage на '*' (event.source-чек остаётся) | `src/components/itObjects/ObjectNetmapTab.jsx:122–135`, `src/lib/drawio.js:72–79` | Info (edge) | Rejected (цикл 13: origin||'*' недостижим) |
| FE-0076 | AI-письмо: plain-text body отправляется с is_html=true — если сервер не экранирует, пользовательские `<` станут разметкой у получателя | `src/pages/chat/AiMailActionEditDialog.jsx:119–129` | Low | Suspected; needsBackendCheck |

**Проверено агентом E и подтверждённо защищено** (важные отрицательные результаты):
все 4 `dangerouslySetInnerHTML` — через единый DOMPurify-санитайзер; входящая почта —
анти-трекинг/анти-overlay + финальная санитизация; MarkdownRenderer — rehype-sanitize;
все 27 `target="_blank"` в JSX — с noopener; JWT не хранится в localStorage (cookie-based,
`withCredentials`), silent-refresh ~12 мин с fan-out guard; `revokeObjectURL` повсеместно;
SW-кэши версионированы, index.html/sw.js no-cache; ловких `catch {}` вокруг localStorage —
best-effort, пользовательские ошибки не глотаются; RootErrorBoundary глобальный.













































## Карточки записей FE-0078…FE-0325 (перепроверка циклов 12–13)

> Карточки перегенерированы из ISSUES.json; исходные утверждения, текущие выводы
> и история перепроверок хранятся в полях originalClaim/currentConclusion/
> reverificationHistory каждой записи.

### FE-0078 — Чат: авто-реотправленное после офлайна сообщение исчезает из ленты отправителя до перезагрузки
- Категория: Functional/Chat | Серьёзность: High | Статус: Fixed-externally
- Файл: `WEB-itinvent/frontend/src/lib/chatSocket.js` :657,1107-1186 (offline queue + flushQueue); слияние в ленте — useChatThreadMessageMerge.js
- Суть/механизм: Авто-реотправка СУЩЕСТВУЕТ: WS outbox (enqueueOfflineMessage/flushQueue, request_id сохраняется, таймаут продлевается) — peer получил сообщение без ручного retry. НО e2e chat-realtime.spec.js:185 падает на :202: после resend в ленте ОТПРАВИТЕЛЯ токен найден 0 раз (ожидалось 1) — оптимистичный failed-пузырь снят, серверная копия не смержена (дедуп по client_message_id ломается). Получатель видит сообщение, отправитель — нет до reload. Первичная формулировка «нет авто-реотправки» по коду была ошибочна — перепроверка рантаймом.
- Доказательства: E2E_LOCAL=1 playwright chat-realtime.spec.js «sender is offline» → FAIL на :202 (toHaveCount(1) received 0 за 15 c); :194-199 прошли — индикатор ⚠ и авто-доставка peer-у работают; trace/screenshot: test-results/chat-realtime-*reconnect-exactly-once*; [cycle12:confirmed] High, ручная проверка: offline queue + flushQueue (chatSocket.js:657,1107-1186) не восстанавливают сообщение в ленте отправителя; E2E chat-realtime «sender is offline» падает на toHaveCount(1), код чата после 1a94d39a не менялся.; [cycle13:fixed-externally] Live E2E cycle 13: chat-realtime.spec.js «sender is offline» прошёл на 8462d971 (3/3, 1.9m), включая sender count=1 после reconnect и reload.

### FE-0079 — Чат: loadingOlder залипает true при смене диалога — дозагрузка истории мёртва
- Категория: State/Chat | Серьёзность: Medium | Статус: Confirmed
- Файл: `WEB-itinvent/frontend/src/pages/chat/useChatThreadController.js` :591 (set true),855-859 (finally сбрасывает только если activeConversationIdRef===id),895
- Суть/механизм: переключение диалога во время дозагрузки оставляет loadingOlder=true навсегда: кнопка «Показать ранние сообщения» уходит в loading и не возвращается до remount.
- Доказательства: статическая проверка по file:line (цикл 9, перепроверено вручную); [cycle12:confirmed] setLoadingOlder(true) на 591, сброс в finally только при совпадении activeConversationIdRef (855-859); при смене диалога флаг залипает и loadOlderMessages блокируется проверкой loadingOlder (895).

### FE-0080 — Чат: мёртвый TCP-сокет → до ~50 c «подключено» без индикатора обрыва
- Категория: UX/ConnectionState | Серьёзность: Medium | Статус: Confirmed
- Файл: `WEB-itinvent/frontend/src/lib/chatSocket.js` :heartbeat 25s, maxMissedPongs=2; transport-healthy окно ~60s
- Суть/механизм: на half-open соединении (сеть упала без RST) индикатор появляется только после ~2 промахов pong; сглаживает FE-0060: порог баннера 2 c (ChatThreadHeader.jsx:35) есть, но упирается в transport-health gate.
- Доказательства: статическая проверка по file:line (цикл 9, перепроверено вручную); [cycle12:confirmed] HEARTBEAT_MS=25s, maxMissedPongs=2 (chatSocket.js:32-33,245); при мёртвом TCP статус остаётся connected до ~50 c, индикатор обрыва не появляется.
- Связано: FE-0060

### FE-0081 — Чат: pending read-receipt IDs сбрасываются при переключении диалога
- Категория: State/Chat | Серьёзность: Low | Статус: Confirmed
- Файл: `WEB-itinvent/frontend/src/components/chat/useReadReceipts.js` :112-124,139-172
- Суть/механизм: накопленные неотправленные mark-read ID стираются при смене conversationId — квитанции прочтения теряются молча.
- Доказательства: статическая проверка по file:line (цикл 9, перепроверено вручную); [cycle12:confirmed] resetTracking очищает pendingReadIdsRef/optimisticReadIdsRef при смене normalizedConversationId (useReadReceipts.js:112-124,139-172) — неотправленные read-receipt IDs теряются.

### FE-0082 — Чат: коллизия typing-таймаутов между диалогами — сброс чужого индикатора
- Категория: State/Chat | Серьёзность: Low | Статус: Confirmed
- Файл: `WEB-itinvent/frontend/src/components/chat/useChatSocketEvents.js` :543-560
- Суть/механизм: перепроверка: ключ таймаутов `${conversationId}:${typingUserId}` — прямой коллизии нет; остаточный кейс: один и тот же пользователь «печатает» в двух диалогах — таймаут из старого диалога гасит индикатор в новом (список typingUsers общий). Доп. (цикл 11): таймеры/typingUsers не очищаются cleanup-ом эффекта — до 4 с на неактуальной беседе; два участника с одинаковым именем гасят индикатор друг друга.
- Доказательства: статическая проверка по file:line (цикл 9, перепроверено вручную); [cycle12:confirmed] Ключ таймаута включает conversationId, но setTypingUsers — плоский список имён; таймаут старого диалога удаляет того же пользователя из индикатора нового (useChatSocketEvents.js:543-560).

### FE-0083 — Межвкладочная гонка refresh → отзыв token family → разлогин ВСЕХ вкладок
- Категория: Auth/Concurrency | Серьёзность: High | Статус: Confirmed
- Файл: `WEB-itinvent/frontend/src/api/http.js` :54,66-76
- Суть/механизм: Триггер в реальности: silent refresh на каждый visibilitychange (AuthContext.jsx:471-508) — пробуждение ноутбука с N вкладок → гонка внутри grace-окна → массовый logout. Потеря несохранённых черновиков — да (принудительный logout). Grace/MAX_HITS не трогать (auth-политика).
- Доказательства: probe_refresh_race.mjs (local stack): 3 параллельных POST /auth/refresh с одной кукой → [200,200,401]; далее /auth/me → 401 и во ВТОРОЙ вкладке (тот же cookie jar) → 401 — family отозвана, обе вкладки разлогинены; код: http.js:54,66-76 — refreshInFlight только внутри вкладки; navigator.locks/BroadcastChannel отсутствуют; backend auth.py:135 (_REFRESH_GRACE_MAX_HITS=1), 1648-1676 (grace 15 c → revoke family); [cycle12:confirmed] High, ручная проверка: refreshInFlight только внутри вкладки (http.js:54,66-76), navigator.locks/BroadcastChannel нет; backend grace max 1 -> 3 параллельных refresh дают [200,200,401] и отзыв family (probe_refresh_race.mjs).; [cycle13:confirmed] Live cycle 13: 3 параллельных POST /auth/refresh с одной кукой дали [401,200,200], затем /auth/me 401 — family отозвана, вкладки разлогинены.; [cycle14:live] Two-tab browser race on isolated stack 5219/18002: three concurrent POST /auth/refresh from two pages sharing cookies -> [200,401,200]; /auth/me -> 401; a NEW refresh cookie after the race -> 401 "Refresh token has been revoked"; both tabs reloaded to /login.; [cycle16:live] Same cookie, 3 parallel POST /auth/refresh -> [200,200,401]. Cookies from a successful response -> /auth/me 401 and /auth/refresh 401 "revoked": the third hit exceeded grace MAX_HITS and revoked the family, killing the winners too. Control: two sequential retries within grace -> [200,200], new access 200. Trigger is concurrency, not staleness.; [cycle17:live] Clean stand b95c4cac, grace 15 s, MAX_HITS=1, four isolated families. A: one sequential stale retry -> 200, first new access/refresh 200. B: two sequential stale retries -> [200,401 expired/already used], first new access/refresh 401 revoked. C: three parallel -> [200,200,401], both winner access/refresh 401. D: stale after grace -> 401 revoked, new access/refresh 200. The family is revoked by the reuse that exceeds MAX_HITS=1, not by concurrency per se; parallel refresh only produces the excess reuse faster.
- Связано: FE-0059

### FE-0084 — Service Worker обновляется только полной перезагрузкой приложения; уведомление об обновлении — только в Settings
- Категория: PWA/Reliability | Серьёзность: Medium | Статус: Confirmed
- Файл: `WEB-itinvent/frontend/src/main.jsx` :66-84
- Суть/механизм: нет периодического registration.update() и prompt на обновление виден лишь в карточке настроек — пользователи с долгоживущими сессиями работают на устаревшем бандле (объясняет часть «странных» репортов типа FE-0004).
- Доказательства: статическая проверка по file:line (цикл 9, перепроверено вручную); [cycle12:confirmed] SW регистрируется и проверяет update на load (main.jsx:66-84), но skipWaiting не автоматический; applyPwaUpdate доступен только в HubItPwaSettingsCard (grep: других вхождений нет).; [cycle15:live] Stale-SW probe on built app :5223: changed sw.js version; registration.update() produced waiting=true while active/controller remained the old worker and old app-shell/assets caches were still used. Visiting /settings/app did not show an update/refresh label.
- Связано: FE-0004

### FE-0085 — После применения SW-обновления соседние вкладки остаются на старом бандле
- Категория: PWA/State | Серьёзность: Low | Статус: Confirmed
- Файл: `WEB-itinvent/frontend/src/lib/pwaInstall.js` :184-192,266-276
- Суть/механизм: controllerchange обрабатывается только во вкладке-инициаторе; остальные вкладки не уведомляются.
- Доказательства: статическая проверка по file:line (цикл 9, перепроверено вручную); [cycle12:confirmed] После skipWaiting новая SW обслуживает новые запросы, но уже открытые вкладки остаются на старом бандле до перезагрузки; механизма broadcast/reload в pwaInstall.js нет.; [cycle15:live] Stale-SW probe: new worker waiting, old controller still serves the page; other tabs would remain on the old bundle until skipWaiting+reload.

### FE-0086 — Поздний suppressed-401 всё равно стирает localStorage.user → вкладки расходятся в auth-состоянии
- Категория: Auth/State | Серьёзность: Low | Статус: Confirmed
- Файл: `WEB-itinvent/frontend/src/api/http.js` :316-371
- Суть/механизм: removeItem(user) безусловен даже когда auth-required подавлён: одна вкладка «выходит» локально, другие считают сессию живой.
- Доказательства: статическая проверка по file:line (цикл 9, перепроверено вручную); [cycle12:confirmed] http.js:370 удаляет localStorage.user при 401 независимо от suppressAuthRequired; поздний ответ подавленного запроса расходится с состоянием вкладки.

### FE-0087 — SW: фоновая ревалидация runtime-кэша не обёрнута в waitUntil — может не завершиться
- Категория: PWA/Cache | Серьёзность: Low | Статус: Confirmed
- Файл: `WEB-itinvent/frontend/public/sw.js` :608-626
- Доказательства: статическая проверка по file:line (цикл 9, перепроверено вручную); [cycle12:confirmed] handleStaticAssetRequest запускает fetch и cache.put в фоне (sw.js:608-626), не оборачивая networkPromise в event.waitUntil — SW может быть остановлен до записи.

### FE-0088 — Scan Center: вкладки не синхронизированы с URL — нет deep-link, ломаны Back/Forward и reload
- Категория: Navigation | Серьёзность: Medium | Статус: Confirmed
- Файл: `WEB-itinvent/frontend/src/pages/scan-center/ScanCenterPage.jsx` :522 (useState overview),2062-2076 (onChange/onNavigate без searchParams)
- Суть/механизм: перезагрузка на любой вкладке возвращает на «Обзор»; невозможно сослаться на конкретную секцию.
- Доказательства: статическая проверка по file:line (цикл 9, перепроверено вручную); [cycle12:confirmed] activeSection хранится только в useState (ScanCenterPage.jsx:522), onChange/onNavigate вызывают setActiveSection (2062,2076) без searchParams — deep-link, Back/Forward и reload не работают.

### FE-0089 — Dashboard: ошибка ручного обновления стирает все карточки в empty-state
- Категория: UX/ErrorState | Серьёзность: Low | Статус: Confirmed
- Файл: `WEB-itinvent/frontend/src/pages/Dashboard.jsx` :736-745
- Доказательства: статическая проверка по file:line (цикл 9, перепроверено вручную); [cycle12:confirmed] При ошибке не-silent загрузки Dashboard делает setPayload(EMPTY_DASHBOARD) (Dashboard.jsx:736-743), стирая ранее показанные карточки.

### FE-0090 — Dashboard: ошибка загрузки показана дважды (верхний Alert + warning секции)
- Категория: UX/ErrorState | Серьёзность: Low | Статус: Confirmed
- Файл: `WEB-itinvent/frontend/src/pages/Dashboard.jsx` :1046,1537
- Доказательства: статическая проверка по file:line (цикл 9, перепроверено вручную); [cycle12:confirmed] Ошибка показывается верхним Alert (Dashboard.jsx:1537) и warning-пленкой секции внимания (1046) — дубль.

### FE-0091 — Dashboard: ошибка сохранения раскладки невидима за диалогом редактирования
- Категория: UX/ErrorState | Серьёзность: Low | Статус: Confirmed
- Файл: `WEB-itinvent/frontend/src/pages/Dashboard.jsx` :998-1008
- Доказательства: статическая проверка по file:line (цикл 9, перепроверено вручную); [cycle12:confirmed] handleSaveSections пишет ошибку через setError (Dashboard.jsx:1003-1004), не закрывая диалог customizeOpen, — текст скрыт за диалогом.

### FE-0092 — Dashboard импортирует hubAPI через legacy client.js-баррель (нарушение конвенции api/)
- Категория: Architecture | Серьёзность: Low | Статус: Confirmed
- Файл: `WEB-itinvent/frontend/src/pages/Dashboard.jsx` :50
- Доказательства: статическая проверка по file:line (цикл 9, перепроверено вручную); [cycle12:confirmed] Dashboard.jsx:50 импортирует hubAPI из legacy-барреля ../api/client вместо отдельного api-файла.

### FE-0093 — scanSSE-pulse перезапускает эффект активности → лишний getAgentsActivity на каждый SSE-event
- Категория: Performance | Серьёзность: Low | Статус: Confirmed
- Файл: `WEB-itinvent/frontend/src/pages/scan-center/ScanCenterPage.jsx` :1423-1467
- Доказательства: статическая проверка по file:line (цикл 9, перепроверено вручную); [cycle12:confirmed] Эффект активности зависит от scanSsePulse (ScanCenterPage.jsx:1467), поэтому каждый SSE-pulse перезапускает tick и делает лишний getAgentsActivity.

### FE-0094 — Scan Center: cleanup при unmount абортирует только 3 семейства запросов — остальные завершаются в фоне
- Категория: State/Async | Серьёзность: Low | Статус: Confirmed
- Файл: `WEB-itinvent/frontend/src/pages/scan-center/ScanCenterPage.jsx` :1339-1343
- Доказательства: статическая проверка по file:line (цикл 9, перепроверено вручную); [cycle12:confirmed] Unmount-cleanup абортирует только review/agents/hosts (ScanCenterPage.jsx:1339-1343); остальные fetch-семейства продолжаются в фоне.

### FE-0095 — SharedFolder: download-guard молча глотает ошибку скачивания
- Категория: Functional/PublicRoute | Серьёзность: Low | Статус: Confirmed
- Файл: `WEB-itinvent/frontend/src/pages/SharedFolder.jsx` :60,77
- Доказательства: статическая проверка по file:line (цикл 9, перепроверено вручную); [cycle12:confirmed] handleDownload/handleDownloadAll при активной загрузке делают return без сообщения (SharedFolder.jsx:60,77) — повторный клик молча игнорируется.

### FE-0096 — SharedFolder: ошибка скачивания мапится в «не удалось связаться» (неверное сообщение)
- Категория: Functional/PublicRoute | Серьёзность: Low | Статус: Confirmed
- Файл: `WEB-itinvent/frontend/src/pages/SharedFolder.jsx` :29-36,66-67,84-85
- Доказательства: статическая проверка по file:line (цикл 9, перепроверено вручную); [cycle12:confirmed] resolveError для любого 4xx возвращает «Папка недоступна — ссылка отключена…» (SharedFolder.jsx:29-36), хотя ошибка скачивания файла может быть иной.

### FE-0097 — SharedFolder: состояние ошибки без кнопки повтора
- Категория: UX/PublicRoute | Серьёзность: Low | Статус: Confirmed
- Файл: `WEB-itinvent/frontend/src/pages/SharedFolder.jsx` :137-139
- Доказательства: статическая проверка по file:line (цикл 9, перепроверено вручную); [cycle12:confirmed] Состояние ошибки — только Alert без кнопки повтора (SharedFolder.jsx:137-139).

### FE-0098 — SharedFolder: полный список файлов рендерится без ограничений (лимит сервера неизвестен)
- Категория: Performance | Серьёзность: Low | Статус: Confirmed
- Файл: `WEB-itinvent/frontend/src/pages/SharedFolder.jsx` :93,207
- Доказательства: статическая проверка по file:line (цикл 9, перепроверено вручную); [cycle12:confirmed] items берётся из payload и рендерится полным map без лимита/пагинации (SharedFolder.jsx:93,207); серверный лимит не документирован.; [cycle13:confirmed] get_public_folder выбирает все готовые AppMyFile поддерева без LIMIT (my_files_service.py:4300-4309) и возвращает полный items (4341-4345), а клиент рендерит items.map без окна, пагинации или виртуализации (SharedFolder.jsx:207-259). На папке с тысячами файлов это один длинный синхронный рендер и десятки тысяч MUI-узлов, причём «Файлов: N» (SharedFolder.jsx:171) показывает полный размер и не сигнализирует о тяжести. Ограничения на число файлов в шаре нет — формулировка «лимит сервера неизвестен» уточняется как «лимита нет». Фактический объём папок не измерялся, но неограниченный рендер подтверждён по коду.; [cycle13:live] Live cycle 13 large-data probe: synthetic 2000-file public folder rendered in 8.38 s, 20 180 DOM nodes, body height 98 184 px, JS heap 186 MB (isolated stand, route-mocked payload). This confirms the unbounded-render impact, not just the code path.; [cycle14:live] Synthetic 2000-file public folder on isolated stand: 8.38 s first render, 20180 DOM nodes, 98184 px body, 186 MB heap.

### FE-0099 — Почта: двойной GET /mail/bootstrap на свежей вкладке (scope pending → resolved → повторная выборка)
- Категория: Performance/Mail | Серьёзность: Low | Статус: Confirmed
- Файл: `WEB-itinvent/frontend/src/pages/Mail.jsx` :455-457,1062-1064
- Суть/механизм: закрывает открытый вопрос PERFORMANCE.md о дубле bootstrap.
- Доказательства: статическая проверка по file:line (цикл 9, перепроверено вручную); [cycle12:confirmed] Mail.jsx повторно грузит bootstrap при переходе scope pending→resolved; код Mail.jsx после 1a94d39a не менялся, прежний network-захват 2× GET /mail/bootstrap остаётся в силе.

### FE-0100 — Почта: ссылки без target уводят внешний сайт ВНУТРИ sandbox-iframe чтения
- Категория: Security/Mail | Серьёзность: Medium | Статус: Confirmed
- Файл: `WEB-itinvent/frontend/src/components/mail/mailHtmlContent.js` :36-63
- Суть/механизм: навигация происходит в самом фрейме: фишинговая ссылка открывается «внутри» письма под хромом приложения. Нужен base target=_blank или перехват навигации.
- Доказательства: статическая проверка по file:line (цикл 9, перепроверено вручную); [cycle12:confirmed] buildMailSandboxSrcDoc не добавляет base target=_blank и не переписывает ссылки (mailHtmlSandboxDocument.js:36-63); ссылка без target навигирует сам sandbox-iframe, уводя внешний сайт внутрь панели чтения.

### FE-0101 — Почта: превью вложения без индикатора загрузки; повторный клик молча проглатывается; abort нет
- Категория: UX/Mail | Серьёзность: Low | Статус: Confirmed
- Файл: `WEB-itinvent/frontend/src/components/mail/useMailMessageFileActions.js` :237-252,373-394
- Доказательства: статическая проверка по file:line (цикл 9, перепроверено вручную); [cycle12:confirmed] Для обычного превью loading не выставляется до await (useMailMessageFileActions.js:373-388), повторный клик не блокируется, AbortSignal нет — только generation-guard.

### FE-0102 — Почта: optimistic-откат mark-read опирается только на refetch — при его сбое счётчики расходятся
- Категория: State/Mail | Серьёзность: Low | Статус: Confirmed
- Файл: `WEB-itinvent/frontend/src/components/mail/useMailReadMutations.js` :300-319
- Доказательства: статическая проверка по file:line (цикл 9, перепроверено вручную); [cycle12:confirmed] Optimistic mark-read откатывается только через refetch; при его сбое счётчики остаются рассинхронизированными (useMailReadMutations.js).

### FE-0103 — Почта: «Сохранить черновик?» спрашивается даже при синхронизированном состоянии → дубль upsert
- Категория: UX/Mail | Серьёзность: Low | Статус: Confirmed
- Файл: `WEB-itinvent/frontend/src/components/mail/MailComposeHost.jsx` :484-561,641-677
- Доказательства: статическая проверка по file:line (цикл 9, перепроверено вручную); [cycle12:confirmed] closeCompose при наличии контента всегда открывает «Сохранить черновик?» (MailComposeHost.jsx:641-677), не проверяя draftSyncState==='synced' — повторный upsert.

### FE-0104 — Почта: черновик быстрого ответа теряется при переключении писем
- Категория: UX/Mail | Серьёзность: Low | Статус: Confirmed
- Файл: `WEB-itinvent/frontend/src/components/mail/MailQuickReplyDraftField.jsx` :26-30
- Доказательства: статическая проверка по file:line (цикл 9, перепроверено вручную); [cycle12:confirmed] Черновик быстрого ответа хранится в состоянии поля и теряется при переключении письма; отдельного per-message хранилища нет (MailQuickReplyDraftField.jsx).

### FE-0105 — Почта: автосохранение черновика multipart без AbortSignal и индикации прогресса
- Категория: State/Mail | Серьёзность: Low | Статус: Confirmed
- Файл: `WEB-itinvent/frontend/src/components/mail/MailComposeHost.jsx` :505-521
- Доказательства: статическая проверка по file:line (цикл 9, перепроверено вручную); [cycle12:confirmed] saveDraftMultipart вызывается без AbortSignal (MailComposeHost.jsx:505-521); прогресс ограничен draftSyncState='saving', отмены нет.

### FE-0106 — /my-files/edit/:fileId без hubBare: портальный хром + рабочая область 100dvh уходит под фолд
- Категория: UI/Editor | Серьёзность: Medium | Статус: Rejected
- Файл: `WEB-itinvent/frontend/src/App.jsx` :594-602
- Суть/механизм: в HUB_BARE_PATTERNS маршрут отсутствует — поверх шапки/сайдбара и padding вьюпорт редактора обрезается снизу; часть контента недоступна без прокрутки.
- Доказательства: статическая проверка по file:line (цикл 9, перепроверено вручную); [cycle12:not-a-defect] Запись уже опровергнута перепроверкой (статус в реестре): /my-files/edit/:fileId обслуживается отдельным MyFilesEditor и не наследует портальный chrome; текущий App.jsx:600-602 это подтверждает.

### FE-0107 — Повторный ?compare= молча игнорируется для уже открытого документа
- Категория: Functional/Editor | Серьёзность: Medium | Статус: Confirmed
- Файл: `WEB-itinvent/frontend/src/components/myFiles/MyFilesEditorWorkspace.jsx` :183-186,459
- Суть/механизм: дедупликация открытого документа срабатывает до диспатча compare; startCompare не проброшен через imperative handle — повторный запрос сравнения теряется.
- Доказательства: статическая проверка по file:line (цикл 9, перепроверено вручную); [cycle12:confirmed] compareVersion передаётся только активному документу (MyFilesEditorWorkspace.jsx:173), а workspace создаёт документ один раз (25-28); повторный ?compare= для уже открытого fileId не переинициализирует сравнение.

### FE-0108 — Desktop: isValidWorkspaceEditorRoute отклоняет ?compare= → деградация до in-window диалога
- Категория: Desktop/Editor | Серьёзность: Medium | Статус: Confirmed
- Файл: `WEB-itinvent/frontend/src/lib/desktopBridge.js` :540-542
- Доказательства: статическая проверка по file:line (цикл 9, перепроверено вручную); [cycle12:confirmed] isValidWorkspaceEditorRoute требует точный путь /my-files/edit/<id> без query (desktopBridge.js:540-542), поэтому route с ?compare= отклоняется и редактор деградирует до in-window диалога.

### FE-0109 — Desktop: нативная лента вкладок отклоняется целиком при >16 документов или заголовке >128 символов
- Категория: Desktop/Editor | Серьёзность: Medium | Статус: Confirmed
- Файл: `WEB-itinvent/frontend/src/lib/desktopBridge.js` :46-47,551,561
- Суть/механизм: payload выбрасывается молча — вкладки «замирают» без диагностики.
- Доказательства: статическая проверка по file:line (цикл 9, перепроверено вручную); [cycle12:confirmed] Лимиты MAXIMUM_WORKSPACE_DOCUMENTS=16 и MAXIMUM_WORKSPACE_DOCUMENT_TITLE_LENGTH=128 (desktopBridge.js:46-47) отбрасывают всю нативную ленту при превышении.

### FE-0110 — Закрытие редактора может зависнуть, если iframe DocSpace упал — editor.requestClose() не отвечает
- Категория: Editor/Reliability | Серьёзность: Medium | Статус: Suspected
- Файл: `WEB-itinvent/frontend/src/components/myFiles/useMyFilesEditorSession.js` :436-440
- Суть/механизм: требуется рантайм-проверка с убитым renderer процессом.
- Доказательства: статическая проверка по file:line (цикл 9, перепроверено вручную); [cycle12:confirmed] close() вызывает editor.requestClose() без таймаута/fallback (useMyFilesEditorSession.js:436-440); если iframe DocSpace не отвечает, закрытие зависает. Статус остаётся Suspected.; [cycle13:unverifiable] Код действительно не имеет таймаута или fallback: close() при frameReady вызывает editor.requestClose() и ждёт события onRequestClose, которое остаётся единственным путём к onClose (useMyFilesEditorSession.js:209,436-440). Даже аварийный крестик, показываемый в phase error/loading, вызывает тот же handleClose → requestClose (MyFilesEditorShell.jsx:46-47,61-65,172-177), а MUI Dialog onClose делегирует туда же (MyFilesOfficeEditorDialog.jsx:10-16). Сценарий «iframe убит после frameReady» в этой среде не воспроизводим: живого Document Server и убитого renderer нет, поэтому user-visible зависание не подтверждено.

### FE-0111 — Восстановление версии при открытом редакторе — живой сеанс может перезаписать восстановленную версию
- Категория: Editor/Data | Серьёзность: Medium | Статус: Rejected
- Файл: `WEB-itinvent/frontend/src/components/myfiles/MyFilesVersionHistory.jsx` :795,844
- Доказательства: статическая проверка по file:line (цикл 9, перепроверено вручную); [cycle12:not-a-defect] Факт не подтверждён: бэкенд после restore чистит office_session_key (my_files_collab_service.py:844) и отклоняет save старой сессии как stale (199-211,512-514), поэтому живой сеанс не может перезаписать восстановленную версию.

### FE-0112 — Устаревший DocsAPI SDK переиспользуется при смене settings.public_path
- Категория: Editor/Config | Серьёзность: Low | Статус: Confirmed
- Файл: `WEB-itinvent/frontend/src/components/myFiles/useMyFilesEditorSession.js` :22-24,259
- Доказательства: статическая проверка по file:line (цикл 9, перепроверено вручную); [cycle12:confirmed] loadDocsApi возвращает уже загруженный window.DocsAPI.DocEditor, игнорируя новый publicPath (useMyFilesEditorSession.js:22-24); смена settings.public_path не перезагружает SDK.

### FE-0113 — officeUiTheme зафиксирован на mount на весь сеанс — смена темы во время редактирования не применяется
- Категория: Editor/UI | Серьёзность: Low | Статус: Confirmed
- Файл: `WEB-itinvent/frontend/src/components/myFiles/useMyFilesEditorSession.js` :69,459
- Доказательства: статическая проверка по file:line (цикл 9, перепроверено вручную); [cycle12:confirmed] officeUiTheme вычисляется один раз при вызове хука (useMyFilesEditorSession.js:69), а эффект создания редактора зависит от fileId/accountKey/restart (459), не от темы.

### FE-0114 — Почтовый office-просмотр не передаёт ui_theme — превью игнорирует тёмную тему
- Категория: Mail/Editor | Серьёзность: Low | Статус: Confirmed
- Файл: `WEB-itinvent/frontend/src/components/mail/useMailMessageFileActions.js` :19,34-38
- Доказательства: статическая проверка по file:line (цикл 9, перепроверено вручную); [cycle12:confirmed] В useMailMessageFileActions.js нет передачи ui_theme/theme в office-view конфиг — превью не учитывает тёмную тему.

### FE-0115 — Синхронный revokeObjectURL сразу после click — хрупко на iOS Safari
- Категория: Files/Compat | Серьёзность: Low | Статус: Suspected
- Файл: `WEB-itinvent/frontend/src/components/mail/mailMessageFileActions.js` :337-360
- Суть/механизм:  Ещё 2 точки: networksHelpers.js:75-84, ObjectNetmapTab.jsx:402-413 (в Networks.jsx:1237 для оригинала сделан setTimeout — несогласованность). +MyFiles.jsx:handleExportPdf (~:676) — тот же паттерн revoke сразу после click().
- Доказательства: статическая проверка по file:line (цикл 9, перепроверено вручную); [cycle12:wrong-evidence] Синхронный revoke после click находится не в useMailMessageFileActions.js, а в downloadBlobFile: link.click(); URL.revokeObjectURL(url) сразу (mailMessageFileActions.js:357-359); для popup-ветки там же стоит задержка 60 с.; [cycle13:unverifiable] Ссылка на useMailMessageFileActions.js была ошибочной: синхронный revoke находится в downloadBlobFile (mailMessageFileActions.js:354-359), и в якорной ветке для iOS Safari вне standalone-режима он сохраняется; 60-секундная задержка включена только для popup-ветки iOS standalone с безопасными типами (343-352). Тот же паттерн остаётся в networksHelpers.js:75-84, MyFiles.jsx:674-681, Statistics.jsx:324-331, useTasksPageController.jsx:457-464 и ObjectNetmapTab.jsx:402-413, тогда как KnowledgeBase.jsx:308-309 уже отложил revoke на 60 с из-за обрыва загрузки в Safari/Firefox. Проверить фактическое поведение iOS Safari здесь нечем (нет устройства и WebKit), поэтому пользовательский обрыв загрузки не подтверждён.

### FE-0116 — block() не снимает readyTimer → устаревшее предупреждение «редактор грузится долго»
- Категория: Editor/State | Серьёзность: Low | Статус: Rejected
- Файл: `WEB-itinvent/frontend/src/components/myFiles/useMyFilesEditorSession.js` :147-152
- Доказательства: статическая проверка по file:line (цикл 9, перепроверено вручную); [cycle12:not-a-defect] block() действительно не очищает readyTimer (useMyFilesEditorSession.js:147-152), но при phase=blocked поверхность показывает статус блокировки (MyFilesEditorSurface.jsx:21-24), а не устаревшее «редактор грузится долго» — пользовательского дефекта нет.

### FE-0117 — Почтовый office-view: цепочка fetch без AbortSignal (контроллер страницы абортит, путь почты — нет)
- Категория: Mail/Async | Серьёзность: Low | Статус: Confirmed
- Файл: `WEB-itinvent/frontend/src/components/mail/useMailMessageFileActions.js` :291-299,319-328
- Доказательства: статическая проверка по file:line (цикл 9, перепроверено вручную); [cycle12:confirmed] Цепочка mail office-view в useMailMessageFileActions.js не принимает AbortSignal; отмена ограничена previewGenerationRef, сетевой запрос продолжается.

### FE-0118 — MyFilesVersionHistory: async-действия без защиты от unmount
- Категория: State/Async | Серьёзность: Low | Статус: Confirmed
- Файл: `WEB-itinvent/frontend/src/components/myfiles/MyFilesVersionHistory.jsx` :107-135
- Доказательства: статическая проверка по file:line (цикл 9, перепроверено вручную); [cycle12:confirmed] download/restore в MyFilesVersionHistory.jsx:107-135 пишут busyId/error после await без mounted/cancelled-проверки.

### FE-0119 — Начальный конфиг редактора не валидирует key/token (путь refresh — валидирует)
- Категория: Editor/Config | Серьёзность: Low | Статус: Confirmed
- Файл: `WEB-itinvent/frontend/src/components/myFiles/useMyFilesEditorSession.js` :263-266 vs 311-335
- Доказательства: статическая проверка по file:line (цикл 9, перепроверено вручную); [cycle12:confirmed] Начальный config передаётся в DocEditor без проверки key/token (useMyFilesEditorSession.js:306-335); refresh-путь такую проверку делает (263-266).

### FE-0120 — Мёртвый код: MailOfficeAttachmentInlinePreview + buildOfficeInlinePreviewState не используются
- Категория: Architecture | Серьёзность: Info | Статус: Confirmed
- Файл: `WEB-itinvent/frontend/src/components/mail/MailOfficeAttachmentInlinePreview.jsx` :12
- Доказательства: статическая проверка по file:line (цикл 9, перепроверено вручную); [cycle12:confirmed] MailOfficeAttachmentInlinePreview и buildOfficeInlinePreviewState определены, но нигде не импортируются/вызываются (поиск по components/mail и Mail.jsx — только определения).

### FE-0121 — History-view: проверка аккаунта строже, чем у сессии — user без id всегда «invalid»
- Категория: Editor/State | Серьёзность: Low | Статус: Confirmed
- Файл: `WEB-itinvent/frontend/src/components/myfiles/MyFilesOfficeHistoryView.jsx` :13,82
- Доказательства: статическая проверка по file:line (цикл 9, перепроверено вручную); [cycle12:confirmed] History-view сравнивает editorConfig.user.id только с id (MyFilesOfficeHistoryView.jsx:13,82), тогда как сессия допускает fallback на username — user без id всегда invalid.

### FE-0122 — Deep-link ?edit= обходит проверки preferredWindow/opening
- Категория: MyFiles/Navigation | Серьёзность: Info | Статус: Confirmed
- Файл: `WEB-itinvent/frontend/src/pages/MyFiles.jsx` :365-372
- Доказательства: статическая проверка по file:line (цикл 9, перепроверено вручную); [cycle12:confirmed] Deep-link ?edit= сразу вызывает setOfficeEditorFile (MyFiles.jsx:365-372) без проверок preferredWindow/opening, которые есть у обычного открытия.

### FE-0123 — MyFiles: drop файлов на строку папки во время активной загрузки запускает параллельную очередь
- Категория: Functional/MyFiles | Серьёзность: Medium | Статус: Confirmed
- Файл: `WEB-itinvent/frontend/src/pages/MyFiles.jsx` :1007-1039
- Суть/механизм: guard активной загрузки обходится: stopPropagation на строке не даёт сработать глобальному guard — две очереди аплоада конкурируют.
- Доказательства: статическая проверка по file:line (цикл 9, перепроверено вручную); [cycle12:confirmed] Drop на строку папки не проверяет активную загрузку и запускает собственную очередь (MyFiles.jsx, обработчик drop папки); параллельная очередь с основной загрузкой.

### FE-0124 — MyFiles: выделение не сбрасывается при смене библиотеки — действия применяются к невидимым файлам
- Категория: State/MyFiles | Серьёзность: Low | Статус: Confirmed
- Файл: `WEB-itinvent/frontend/src/pages/MyFiles.jsx` :1097-1099,1153-1155
- Суть/механизм: перепроверка: clearSelection-эффект зависит от [currentFolderId, viewParam, searchQuery, typeFilter, dateFilter] — если переключение библиотеки меняет viewParam, выделение сбрасывается корректно; дефект есть только если библиотека переключается без смены viewParam — требует рантайм-пробы.
- Доказательства: статическая проверка по file:line (цикл 9, перепроверено вручную); [cycle12:confirmed] Эффект очистки выделения зависит от currentFolderId/view/search/type/date (MyFiles.jsx:1097-1099), но не от libraryId; при смене библиотеки без смены folder выделение сохраняется.; [cycle13:confirmed] Эффект очистки не зависит от libraryId (MyFiles.jsx:1097-1099), а navigateToLibrary меняет только library/view и не трогает folder (594-596), поэтому при переходе между корнями библиотек currentFolderId остаётся null и выделение сохраняется. Действия при этом не применяются к скрытым файлам: selectedFiles и selectedFolders фильтруются по текущим visibleItems/visibleFolders (1196-1203), поэтому bulk-delete с count=0 просто выходит, а bulk-move с count=0 показывает ложный успех «Выбранные объекты перемещены» (1343-1397). Реальный дефект — залипший счётчик «Выбрано: N» (1954-1972) и ложный успех перемещения, а не операции над файлами старой библиотеки.

### FE-0125 — MyFiles: deep-link на удалённую/чужую папку — только тост; ?folder= остаётся → повторные ошибки
- Категория: Functional/MyFiles | Серьёзность: Low | Статус: Confirmed
- Файл: `WEB-itinvent/frontend/src/pages/MyFiles.jsx` :320-322
- Доказательства: статическая проверка по file:line (цикл 9, перепроверено вручную); [cycle12:confirmed] При невалидном ?folder= catch 320-322 только показывает toast (notifyApiError); параметр не удаляется (currentFolderId читается из searchParams, MyFiles.jsx:163), поэтому reload/повторные действия снова дают ошибку.; [cycle13:confirmed] При удалённой или чужой папке бэкенд отдаёт 404: _folder_row_locked требует совпадения owner и deleted_at is None (my_files_service.py:1864-1871), а list_my_files маппит MyFilesNotFoundError в 404 (my_files.py:278-297,120-124). Фронтенд в catch только показывает notifyApiError и не чистит searchParams (MyFiles.jsx:320-322), а currentFolderId продолжает читаться из ?folder= (163); после reload запрос повторяется и снова падает, при этом список остаётся пустым или старым. Параметр остаётся в URL, и по коду повторная ошибка воспроизводится при каждом открытии ссылки.

### FE-0126 — MyFiles: массовые delete/move — по запросу на элемент, последовательно, без прогресса
- Категория: Performance/MyFiles | Серьёзность: Low | Статус: Confirmed
- Файл: `WEB-itinvent/frontend/src/pages/MyFiles.jsx` :1292-1309,1354-1371
- Доказательства: статическая проверка по file:line (цикл 9, перепроверено вручную); [cycle12:confirmed] Bulk delete/move по-прежнему выполняет отдельный запрос на каждый элемент в последовательном for-of (MyFiles.jsx:1292-1309, 1354-1371); добавлен лишь bulkBusy-гард (1276, 1344) и итоговый счётчик, живого прогресса нет.

### FE-0127 — Tasks: добавление пункта чек-листа идёт в обход очереди мутаций → гонка toggle/add теряет обновления
- Категория: Tasks/Concurrency | Серьёзность: Medium | Статус: Confirmed
- Файл: `WEB-itinvent/frontend/src/pages/tasks/hooks/useTaskDetails.jsx` :729-767
- Суть/механизм: toggle сериализуется через checklistMutationRef (items из existing), add читает stale task.checklist_items и шлёт updateTask напрямую — возможен lost update.
- Доказательства: статическая проверка по file:line (цикл 9, перепроверено вручную); [cycle12:confirmed] handleAddTaskChecklistItem читает task.checklist_items (759) и сразу вызывает updateTask (762), минуя checklistMutationRef, тогда как toggle сериализуется через chain (733-742); гонка toggle/add теряет обновления.

### FE-0128 — Tasks: чекбокс чек-листа без optimistic-отклика; мёртвый проп updatingItemId
- Категория: UX/Tasks | Серьёзность: Low | Статус: Confirmed
- Файл: `WEB-itinvent/frontend/src/components/hub/TaskChecklist.jsx` :6-7,39-40
- Доказательства: статическая проверка по file:line (цикл 9, перепроверено вручную); [cycle12:confirmed] TaskDetailChecklist не прокидывает updatingItemId (TaskDetailChecklist.jsx:3-15), поэтому условие disabled в TaskChecklist.jsx:39 никогда не истинно; чекбокс управляется только данными задачи (38), optimistic-отклика нет.

### FE-0129 — Tasks: ensureTaskDiscussion с устаревшим completion → переход к ранее активной задаче
- Категория: Tasks/State | Серьёзность: Medium | Статус: Confirmed
- Файл: `WEB-itinvent/frontend/src/pages/tasks/hooks/useTaskDetails.jsx` :483-495
- Доказательства: статическая проверка по file:line (цикл 9, перепроверено вручную); [cycle12:confirmed] После await openTaskDiscussion (483) нет проверки актуальности задачи, а updateSearch с устаревшим замыканием выставляет task=normalizedTaskId (489-494) — возврат к ранее активной задаче.

### FE-0130 — Tasks: устаревший ответ getTaskComments затирает только что добавленный комментарий
- Категория: Tasks/State | Серьёзность: Medium | Статус: Confirmed
- Файл: `WEB-itinvent/frontend/src/pages/tasks/hooks/useTaskDetails.jsx` :161-163,462
- Доказательства: статическая проверка по file:line (цикл 9, перепроверено вручную); [cycle12:confirmed] getTaskComments (161-163) отсекает только чужой taskId, а handleAddTaskComment добавляет комментарий локально (462-465); ответ старого запроса заменяет массив setDetailsComments и теряет добавленный комментарий.

### FE-0131 — Tasks: openTaskDetails без зависимости visibleTaskItems → открывает устаревшую позицию списка
- Категория: Tasks/State | Серьёзность: Low | Статус: Confirmed
- Файл: `WEB-itinvent/frontend/src/pages/tasks/hooks/useTaskDetails.jsx` :329,353
- Доказательства: статическая проверка по file:line (цикл 9, перепроверено вручную); [cycle12:confirmed] openTaskDetails читает visibleTaskItems (329), но в deps useCallback только [taskDiscussionChatEnabled, updateSearch] (353) — возможен показ устаревшей строки списка.

### FE-0132 — Tasks: несохранённые изменения canvas теряются при unmount во время in-flight save
- Категория: Tasks/State | Серьёзность: Low | Статус: Rejected
- Файл: `WEB-itinvent/frontend/src/components/hub/tasks/TaskCanvasWorkspace.jsx` :332-340
- Доказательства: статическая проверка по file:line (цикл 9, перепроверено вручную); [cycle12:confirmed] Unmount-cleanup (332-340) при savingRef.current === true выходит без flush (334), поэтому правки из pendingSceneRef, накопленные во время in-flight save, теряются.; [cycle13:refuted] Unmount-cleanup действительно выходит без flush при savingRef.current === true (332-340), но это не теряет правки: savePending в finally после успешного ответа сам планирует таймер, если pendingSceneRef непуст (308-320), а savePendingRef после размонтирования не обнуляется (324-326). Поэтому сценарий «правки, накопленные во время in-flight save» сохраняется отложенным вызовом; потеря возможна только при отказе самой save-операции, что не является заявленным механизмом.

### FE-0133 — Tasks: handleDeleteTask без busy-guard → двойной confirm даёт ложный тост ошибки; ref мутируется в render
- Категория: Tasks/UX | Серьёзность: Low | Статус: Confirmed
- Файл: `WEB-itinvent/frontend/src/pages/tasks/hooks/useTaskWorkflowActions.js` :158-176
- Доказательства: статическая проверка по file:line (цикл 9, перепроверено вручную); [cycle12:confirmed] handleDeleteTask (163-176) без busy-guard, а selectedTaskRef мутируется в теле рендера (158-161); повторный confirm даёт второй DELETE и ложный тост ошибки.

### FE-0134 — Tasks: переключение вкладок деталей задачи пушит записи в history — Back циклит по вкладкам
- Категория: Navigation | Серьёзность: Low | Статус: Confirmed
- Файл: `WEB-itinvent/frontend/src/pages/tasks/hooks/useTaskDetails.jsx` :373-378
- Доказательства: статическая проверка по file:line (цикл 9, перепроверено вручную); [cycle12:confirmed] setTaskDetailTab вызывает updateSearch с { replace: false } (375-377), а updateSearch делает navigate push (121-124) — Back возвращает по вкладкам.; [cycle13:confirmed] setTaskDetailTab вызывает updateSearch с replace: false (373-378), а updateSearch делает navigate с replace:false (115-125), то есть каждое переключение вкладки деталей добавляет запись в history. Пользователь нажимает Back и возвращается на предыдущую вкладку вместо выхода из карточки; цикл повторяется по числу переключений.

### FE-0135 — Statistics: текст ошибки blob-ответа нечитаем в тосте экспорта
- Категория: UX/Statistics | Серьёзность: Low | Статус: Confirmed
- Файл: `WEB-itinvent/frontend/src/pages/Statistics.jsx` :333-335
- Доказательства: статическая проверка по file:line (цикл 9, перепроверено вручную); [cycle12:confirmed] Экспорт запрашивается с responseType: 'blob' (json_client.js:255), а catch передаёт ошибку в notifyApiError (Statistics.jsx:335); extractApiDetail ищет строковый detail/message и не читает Blob (NotificationContext.jsx:92-109).; [cycle13:confirmed] Подтверждается: экспорт запрашивается с responseType:'blob' (json_client.js:252-255), а catch передаёт ошибку в notifyApiError (Statistics.jsx:333-335). extractApiDetail (NotificationContext.jsx:92-110) читает только строковые detail/message/error и не разбирает Blob, поэтому серверный detail (json_operations.py:743-747) теряется. В тосте остаётся техническое «Request failed with status code N» на английском вместо причины отказа — это не дамп «[object Blob]», но пользователь причины не видит; в проекте уже есть образец разбора через blob.text() (EquipmentDetailPhotosPanel.jsx:54-65).

### FE-0136 — E2E auth-guards: ожидание редиректа оператора из /admin устарело — техдолг теста, не дефект приложения
- Категория: Tests/Debt | Серьёзность: Low | Статус: Rejected
- Файл: `WEB-itinvent/frontend/e2e/auth-guards.spec.js` :59-76
- Суть/механизм: поведение приложения корректно по текущей политике прав (operator + scan.tasks ∈ ADMIN_AREA_PERMISSIONS); падение спеки — устаревшее ожидание, красный набор маскирует регрессии. Не дефект продукта.
- Доказательства: E2E_LOCAL=1 auth-guards: 5/6 pass; «non-admin is redirected out of the admin area» FAIL — /admin доступен operator легитимно (scan.tasks в ADMIN_AREA_PERMISSIONS); [cycle12:not-a-defect] Поведение приложения корректно: operator имеет scan.tasks (authorization_service.py:138) в ADMIN_AREA_PERMISSIONS (components/account/accountNavigationConfig.jsx:28), и AdminAreaRoute его пускает (App.jsx:285-288). Техдолг остаётся в спеке: auth-guards.spec.js:74-76 всё ещё безусловно ждёт уход с /admin.

### FE-0137 — Маршрутизация доверяет кэшированному localStorage.user до валидации сессии — вспышка чужого экрана
- Категория: Auth/UX | Серьёзность: Info | Статус: Confirmed
- Файл: `WEB-itinvent/frontend/src/contexts/AuthContext.jsx` :270-296
- Суть/механизм: offline-session tradeoff: /login мгновенно уводит на landing/about по устаревшему user, затем 401-валидация возвращает; наблюдалось в probe при сохранившейся сессии e2e_fresh.
- Доказательства: статическая проверка по file:line (цикл 9, перепроверено вручную); [cycle12:confirmed] Кэшированный user применяется из localStorage до валидации сессии (AuthContext.jsx:270-288), после чего LoginRoute сразу редиректит по isAuthenticated (App.jsx:237-249); комментарий 281-282 подтверждает намеренную offline-политику.

### FE-0138 — Попытка запуска hubit:// протокола при браузерном входе — console-ошибка «scheme does not have a registered handler»
- Категория: Desktop/UX | Серьёзность: Info | Статус: Confirmed
- Файл: `WEB-itinvent/frontend/src/lib/desktopProtocolHandoff.js` :240-276
- Суть/механизм: механизм handoff ожидаем, но ошибка засоряет консоль и путает диагностику.
- Доказательства: console capture cycle9: "Failed to launch hubit://open/dashboard …" на веб-логине; [cycle12:confirmed] DesktopProtocolHandoff авто-запускает hubit:// при загрузке страницы (DesktopProtocolHandoff.jsx:67-70) через anchor.click (desktopProtocolHandoff.js:270-275) без проверки регистрации схемы — console-ошибка в браузере остаётся.

### FE-0139 — Drawio-редактор: при ошибке сохранения диалог закрывается и несохранённые правки теряются
- Категория: DataLoss/Editor | Серьёзность: Medium | Статус: Confirmed
- Файл: `WEB-itinvent/frontend/src/components/itObjects/ObjectNetmapTab.jsx` :104-108: save(pending) возвращает false при ошибке, но onCloseRef.current() вызывается безусловно; saveError видна уже закрытому диалогу
- Суть/механизм: сетевой сбой/409 → правки схемы стёрты без предупреждения; pendingXmlRef теряется
- Доказательства: статическая проверка по file:line (цикл 11, агент + ручная перепроверка); [cycle12:confirmed] saveThenClose (104-108) игнорирует false от save() и безусловно зовёт onCloseRef.current(); saveError (96-98) адресована уже закрытому диалогу.

### FE-0140 — Networks: «Отмена» редактирования точки карты не откатывает локальные изменения mapPoints
- Категория: State/Maps | Серьёзность: Medium | Статус: Confirmed
- Файл: `WEB-itinvent/frontend/src/pages/Networks.jsx` :2576-2603,3106-3108,3226-3228: поля мутируют mapPoints на каждый ввод; Отмена делает только setPointEditMode(false)
- Суть/механизм: черновых полей нет; маркеры/таблица показывают несохранённые значения до refreshBranchContext
- Доказательства: статическая проверка по file:line (цикл 11, агент + ручная перепроверка); [cycle12:confirmed] Поля точки мутируют mapPoints на каждый ввод (2576-2588, 2601-2603; мобильный дубль 3218-3224), а «Отмена» делает только setPointEditMode(false) (2606, 3227).

### FE-0141 — Networks: мобильный режим размещения точки не работает — клики по карте игнорируются
- Категория: UX/Maps | Серьёзность: Medium | Статус: Confirmed
- Файл: `WEB-itinvent/frontend/src/pages/Networks.jsx` :2872-2873 (onPointDrop/onCanvasClick только при mobileMapEditMode); 1340-1352,337-347 ставят placingMarker, но не mobileMapEditMode; InteractiveMapCanvas.jsx:311
- Суть/механизм: на телефоне размещение выглядит сломанным — требуется неочевидное нажатие «замка»
- Доказательства: статическая проверка по file:line (цикл 11, агент + ручная перепроверка); [cycle12:confirmed] На мобильном onPointDrop/onCanvasClick передаются лишь при mobileMapEditMode (2872-2873), а togglePlacingMarker (337-347) и applySocketPointDraft (1340-1352) ставят только placingMarker — тапы по карте игнорируются до нажатия «замка» (2919).

### FE-0142 — Networks: первый жест панорамы карты после касания маркера «съедается»
- Категория: Pointer/Maps | Серьёзность: Medium | Статус: Confirmed
- Файл: `WEB-itinvent/frontend/src/components/networks/InteractiveMapCanvas.jsx` :519/646 (isPointPointerDownRef на marker down),305-307 (сброс только в container pointerup),547/677 (stopPropagation у маркера),205
- Суть/механизм: застрявший ref блокирует инициализацию следующего жеста панорамы/пинча
- Доказательства: статическая проверка по file:line (цикл 11, агент + ручная перепроверка); [cycle12:confirmed] isPointPointerDownRef ставится на pointerdown маркера (519, 646) и сбрасывается только в handlePointerUp контейнера (305-307), куда событие не всплывает из-за stopPropagation (521, 547/677); следующий pointerdown панорамы отсекается на 205-207.

### FE-0143 — Networks: автосинк MAC/ФИО дёргает write-эндпоинт у read-only пользователей → 403-тосты
- Категория: Permissions/Networks | Серьёзность: Medium | Статус: Confirmed
- Файл: `WEB-itinvent/frontend/src/pages/Networks.jsx` :1562-1590: syncSocketHostContext без проверки canEdit; backend networks.py:410 требует PERM_NETWORKS_WRITE
- Суть/механизм: каждый заход read-only пользователя → гарантированный 403 + notifyWarning + console.error
- Доказательства: статическая проверка по file:line (цикл 11, агент + ручная перепроверка); [cycle12:confirmed] Эффект автосинка (1562-1590) не проверяет canEdit и вызывает syncSocketHostContext (1577), а бэкенд требует networks.write (networks.py:403-410) — read-only пользователь получает 403 и notifyWarning.

### FE-0144 — Networks: устаревшее изображение карты при смене/ошибке загрузки — точки новой карты поверх старой
- Категория: State/Maps | Серьёзность: Medium | Статус: Confirmed
- Файл: `WEB-itinvent/frontend/src/pages/Networks.jsx` :1079-1112: mapBlobUrl/mapIsPdf/mapRenderedFrom не сбрасываются до завершения downloadMapFile; при ошибке остаётся прежний URL
- Суть/механизм: <img> с revoked-URL + точки новой карты → ложное позиционирование
- Доказательства: статическая проверка по file:line (цикл 11, агент + ручная перепроверка); [cycle12:confirmed] При смене selectedMapId прежние mapBlobUrl/mapIsPdf/mapRenderedFrom не сбрасываются до конца downloadMapFile (1079-1100), а cleanup отзывает старый URL (1108-1110); при ошибке <img> остаётся с revoked-URL, точки новой карты рисуются поверх.

### FE-0145 — Networks: нет busy-guards на saveMap/commitPendingPoint/saveSelectedPoint/removeSelectedPoint/removeMap
- Категория: BusyGuards/Networks | Серьёзность: Medium | Статус: Confirmed
- Файл: `WEB-itinvent/frontend/src/pages/Networks.jsx` :1259-1290,1354-1390,1413-1448; кнопки MapDialog.jsx:77,:2467-2475,:2605-2607,:3110-3113,:3230-3232
- Суть/механизм: двойной клик → две карты/две точки/повторный DELETE с ложным тостом ошибки
- Доказательства: статическая проверка по file:line (цикл 11, агент + ручная перепроверка); [cycle12:confirmed] saveMap (1259), commitPendingPoint (1354), saveSelectedPoint (1413), removeSelectedPoint (1436) и removeMap (1292) не имеют busy-guard; кнопки MapDialog.jsx:76-78 и панелей не блокируются на время запроса.

### FE-0146 — Networks: site_name карты захардкожен в «Первомайская 19/21»
- Категория: Data/Networks | Серьёзность: Medium | Статус: Confirmed
- Файл: `WEB-itinvent/frontend/src/pages/Networks.jsx` :1267,1278: site_name = p21 ? Первомайская 21 : Первомайская 19 — для любого другого site пишется неверное имя
- Суть/механизм: неверное имя сайта в БД и выгрузках для всех не-«Первомайская» локаций
- Доказательства: статическая проверка по file:line (цикл 11, агент + ручная перепроверка); [cycle12:confirmed] site_name жёстко выбирается между «Первомайская 21/19» по site_code (1267, 1278), хотя MapDialog получает sites с именами; для прочих площадок в БД пишется неверное имя.

### FE-0147 — Networks: Escape глобально отменяет редактирование порта поверх любых диалогов
- Категория: Keyboard/Networks | Серьёзность: Medium | Статус: Confirmed
- Файл: `WEB-itinvent/frontend/src/pages/Networks.jsx` :2055-2074: window keydown Escape→cancelEditPort без проверки открытых Dialog/Drawer; Ctrl+S аналогично; listener перевешивается каждый рендер
- Суть/механизм: Escape в диалоге дополнительно уничтожает несохранённый draft порта
- Доказательства: статическая проверка по file:line (цикл 11, агент + ручная перепроверка); [cycle12:confirmed] Глобальный window keydown (2055-2074) на Escape вызывает cancelEditPort без проверки открытых Dialog/Drawer, а на Ctrl+S сохраняет порт (2063-2068) — Escape в диалоге уничтожает draft.

### FE-0148 — Networks: read-only пользователь попадает в режим размещения точки → серия 403
- Категория: Permissions/Networks | Серьёзность: Medium | Статус: Confirmed
- Файл: `WEB-itinvent/frontend/src/pages/Networks.jsx` :1477-1492,2086-2114 → startSocketPointCreation:1450-1475 → applySocketPointDraft:1340-1352 — ни один не проверяет canEdit
- Суть/механизм: UX «разрешил, потом отказал»: панель размещения активна, каждый клик → 403-тост
- Доказательства: статическая проверка по file:line (цикл 11, агент + ручная перепроверка); [cycle12:confirmed] startSocketPointCreation (1450-1475) и applySocketPointDraft (1340-1352) не проверяют canEdit; вызовы из handleSocketRowClick (1477-1492) и handlePortRowClick (2086-2114) открывают панель размещения read-only пользователю, далее 403 на createMapPoint.

### FE-0149 — Networks: гонка загрузки db-mapping при быстром переоткрытии диалога филиала
- Категория: Race/Networks | Серьёзность: Medium | Статус: Confirmed
- Файл: `WEB-itinvent/frontend/src/pages/Networks.jsx` :1737-1753: openEditBranchDialog грузит getBranchDbMapping без seq/abort-guard
- Суть/механизм: ответ по филиалу A может прийти после открытия B → в диалоге B чужая БД, сохранение запишет её в B
- Доказательства: статическая проверка по file:line (цикл 11, агент + ручная перепроверка); [cycle12:confirmed] openEditBranchDialog выставляет branchEditId и грузит getBranchDbMapping без seq/abort-guard (1737-1752); ответ по филиалу A перезаписывает branchEditDbId уже открытого B (1746).

### FE-0150 — Networks/SWR: протухшие данные показываются бессрочно — фоновая ревалидация не доходит до UI
- Категория: Cache/Networks | Серьёзность: Medium | Статус: Confirmed
- Файл: `WEB-itinvent/frontend/src/lib/swrCache.js` :151-165: stale-запись → фоновой fetch пишет только в кэш; loadBranchContext применяет только синхронный data
- Суть/механизм: повторный заход показывает устаревший снапшот до полного перезахода
- Доказательства: статическая проверка по file:line (цикл 11, агент + ручная перепроверка); [cycle12:confirmed] getOrFetchSWR на stale-записи запускает фоновый fetch и сразу возвращает старый data (swrCache.js:151-165), а loadBranchContext применяет только этот синхронный data (756-805) — обновление из кэша до UI не доходит.; [cycle13:confirmed] На протухшей записи getOrFetchSWR запускает runDedupedFetch и сразу возвращает старый entry.data (swrCache.js:151-165), а setCacheEntry (79-85) не имеет подписчиков — обновлённый кэш некому применить к UI. loadBranchContext применяет только синхронный data (Networks.jsx:756-805), эффект перезапускается лишь при смене branchIdNum (972-993), а SWR_STALE_MS=60 с при retention 30 мин и отсутствии focus/visibility-ревалидации делает окно реальным. Собственная проба на реальном swrCache.js воспроизвела сценарий: вызов вернул v1 (isFresh=false), фоновая выборка прошла один раз и через 120 мс в кэше был v2, а вызывающий остался с v1. Итог: после возврата на филиал через минуту UI держит старый снапшот до смены филиала или мутации (refreshBranchContext вызывается только после мутаций, 898-906).

### FE-0151 — Networks: панорама карты не ограничена — карту можно утащить за экран
- Категория: Zoom/Maps | Серьёзность: Medium | Статус: Confirmed
- Файл: `WEB-itinvent/frontend/src/components/networks/InteractiveMapCanvas.jsx` :274-277 (setOffset без clamp),463; zoomBy:161 клампит только scale
- Суть/механизм: «потерянная» карта до нажатия сброса
- Доказательства: статическая проверка по file:line (цикл 11, агент + ручная перепроверка); [cycle12:confirmed] handlePointerMove пишет offset без ограничений (274-277), zoomBy клампит только scale (161); сброс offset только по кнопке (424) — карту можно утащить за экран.

### FE-0152 — Networks: виртуализация — stale scrollTop после размонтирования контейнера → «пустая» таблица
- Категория: Virtualization/Networks | Серьёзность: Medium | Статус: Confirmed
- Файл: `WEB-itinvent/frontend/src/components/networks/useVirtualizedTableWindow.js` :41-67 + EquipmentTab.jsx:339-344: state scrollTop переживает размонтирование TableContainer
- Суть/механизм: после поиска — гигантский topSpacer + пустая таблица до первого scroll
- Доказательства: статическая проверка по file:line (цикл 11, агент + ручная перепроверка); [cycle12:confirmed] scrollTop живёт в state и не сбрасывается при размонтировании (useVirtualizedTableWindow.js:33-35); при перемонтировании без изменения itemCount эффект [enabled,itemCount] (48-59) не ресинхронизирует его с новым узлом — пустая таблица до scroll. При обычном поиске смена числа строк маскирует дефект.; [cycle13:confirmed] scrollTop хранится в state хука (33-35), а эффект [enabled, itemCount] при перемонтировании таблицы с теми же deps не перезапускается (46-67). В SocketsTab/EquipmentTab TableContainer рендерится только на desktop (220, 308), поэтому после перехода mobile→desktop контейнер новый со scrollTop=0, но окно виртуализации считается по старому scrollTop: сверху остаётся большой spacer, таблица выглядит пустой до первого скролла.

### FE-0153 — Networks: удаление точки карты и устройства без подтверждения
- Категория: UX/Networks | Серьёзность: Medium | Статус: Confirmed
- Файл: `WEB-itinvent/frontend/src/pages/Networks.jsx` :1436-1448 (removeSelectedPoint DELETE сразу),1989-2009 (deleteDevice без confirm); у карты/розетки/филиала подтверждения есть
- Суть/механизм: удаление устройства каскадно забирает порты/привязки — нет пути назад
- Доказательства: статическая проверка по file:line (цикл 11, агент + ручная перепроверка); [cycle12:confirmed] removeSelectedPoint удаляет сразу, без confirm (1436-1448), а deleteDevice вызывается прямо из кнопки DeviceDialog.jsx:136-143 и тоже без подтверждения (1989-2009).

### FE-0154 — Networks: CSV-экспорт портов — data-URI без кавычек/экранирования; возможна CSV formula-injection
- Категория: Export/Security | Серьёзность: Medium | Статус: Confirmed
- Файл: `WEB-itinvent/frontend/src/components/networks/EquipmentTab.jsx` :180-201: encodeURI не кодирует # ; + & =; поля без кавычек; значения =/+/- в начале → формулы в Excel
- Суть/механизм: битый CSV при спецсимволах; потенциальная formula-injection
- Доказательства: статическая проверка по file:line (цикл 11, агент + ручная перепроверка); [cycle12:confirmed] CSV собирается join(';') без кавычек и кодируется encodeURI (EquipmentTab.jsx:194-196), который не экранирует # ; + & =; значения с ведущими =/+/- уходят в Excel как формулы.

### FE-0155 — Networks: вложенные <button> внутри CardActionArea — невалидный DOM
- Категория: Accessibility | Серьёзность: Low | Статус: Confirmed
- Файл: `WEB-itinvent/frontend/src/components/networks/BranchList.jsx` :50-88 (IconButton ×2 внутри CardActionArea=button); SocketsTab.jsx:241-301; EquipmentTab.jsx:376-430
- Суть/механизм: невалидный HTML, запутанный фокус/screen reader Runtime-подтверждено цикл 11: React выводит validateDOMNesting warning на живой странице.
- Доказательства: статическая проверка по file:line (цикл 11, агент + ручная перепроверка); [cycle12:confirmed] CardActionArea рендерит <button>, внутри которого лежат IconButton (BranchList.jsx:50-86, SocketsTab.jsx:241-298, EquipmentTab.jsx:376-430) — невалидная вложенность button.

### FE-0156 — Networks: маркеры карты недоступны с клавиатуры
- Категория: Accessibility | Серьёзность: Low | Статус: Confirmed
- Файл: `WEB-itinvent/frontend/src/components/networks/InteractiveMapCanvas.jsx` :516-565,644-695: <Box onClick> без role/tabIndex/onKeyDown
- Суть/механизм: точки нельзя выбрать/переместить без мыши
- Доказательства: статическая проверка по file:line (цикл 11, агент + ручная перепроверка); [cycle12:confirmed] Маркеры и кластеры — <Box onClick> без role/tabIndex/onKeyDown (516-565, 644-695); Tooltip здесь с React-node title, так что фокусируемого имени у маркера нет.

### FE-0157 — Networks: клик после перетаскивания точки может «просочиться» на canvas
- Категория: Pointer/Maps | Серьёзность: Low | Статус: Rejected
- Файл: `WEB-itinvent/frontend/src/components/networks/InteractiveMapCanvas.jsx` :530-544 (pointDragRef.moved но не dragRef.moved),310-329 (handleCanvasClick проверяет только dragRef)
- Суть/механизм: спорадические лишние точки/деселект после drag — зависит от click-target после pointer capture
- Доказательства: статическая проверка по file:line (цикл 11, агент + ручная перепроверка); [cycle12:unverifiable] Маркер гасит click (stopPropagation, 559-565), а handleCanvasClick отбрасывает цели [data-map-point=1] (317-319), но не проверяет pointDragRef.moved; протечка возможна только если браузер доставит click контейнеру после pointer capture — статически не решается.; [cycle13:refuted] Клик по маркеру гасится stopPropagation в onClick (559-565), а handleCanvasClick дополнительно отбрасывает цель внутри [data-map-point=1] (317-319). pointDragRef при перетаскивании ставит pointer capture на маркер (522-528), поэтому pointerup и производный click остаются на маркере; достижимого пути, где click доходит до контейнера после drag, в поддерживаемых браузерах нет.

### FE-0158 — Networks: openMapDialogCreate игнорирует default_site_code филиала
- Категория: Data/Networks | Серьёзность: Low | Статус: Confirmed
- Файл: `WEB-itinvent/frontend/src/pages/Networks.jsx` :1217: setMapSiteCode(p19) жёстко vs диалог устройства :1895 использует selectedBranch.default_site_code
- Суть/механизм: создание карты для не-p19 филиала требует ручного исправления
- Доказательства: статическая проверка по file:line (цикл 11, агент + ручная перепроверка); [cycle12:confirmed] openMapDialogCreate жёстко ставит setMapSiteCode('p19') (1217), тогда как диалог устройства берёт selectedBranch.default_site_code (1895) — для другого филиала сайт карты приходится менять вручную.

### FE-0159 — Networks: город филиала захардкожен в «tmn» + мёртвый createBranchCity
- Категория: Logic/Networks | Серьёзность: Low | Статус: Confirmed
- Файл: `WEB-itinvent/frontend/src/pages/Networks.jsx` :217 (createBranchCity без UI),1637 (city_code fallback tmn),747 (getBranches tmn)
- Суть/механизм: невозможно создать/увидеть филиал другого города — фича недорезана
- Доказательства: статическая проверка по file:line (цикл 11, агент + ручная перепроверка); [cycle12:confirmed] createBranchCity инициализируется 'tmn' и сеттера нигде нет (217), city_code при создании падает в 'tmn' (1637), а список филиалов грузится только getBranches('tmn') (746-747).

### FE-0160 — Networks: пакет мёртвого кода (ImportDialog, mobilePortEditorOpen, equipmentLoading, hasBranchDbChanges, focusPointId, containerWidth)
- Категория: Architecture/DeadCode | Серьёзность: Low | Статус: Confirmed
- Файл: `WEB-itinvent/frontend/src/components/networks/ImportDialog.jsx` :весь файл не импортируется; Networks.jsx:204,302-304,491-494,1714-1735,732-742; SocketsTab prop pointEditMode; useVirtualizedTableWindow.js:35
- Суть/механизм: мёртвый код раздувает god-component
- Доказательства: статическая проверка по file:line (цикл 11, агент + ручная перепроверка); [cycle12:confirmed] ImportDialog.jsx нигде не импортируется; equipmentLoading (302) и hasBranchDbChanges (491) не читаются, mobilePortEditorOpen только set (204/1858/1868), focusPointId (732) не используется, SocketsTab не принимает pointEditMode (125-134), а containerWidth из хука (35) не деструктурируется.

### FE-0161 — Networks: молчаливое усечение выборок по limit (10000/5000) — неверные счётчики и «не найдено»
- Категория: Data/Networks | Серьёзность: Low | Статус: Suspected
- Файл: `WEB-itinvent/frontend/src/pages/Networks.jsx` :765 (sockets limit 10000),871 (ports limit 10000),1059/2030 (поиск limit 5000) — UI не сигнализирует о неполноте
- Суть/механизм: для крупных филиалов — тихая потеря части данных во всех производных
- Доказательства: статическая проверка по file:line (цикл 11, агент + ручная перепроверка); [cycle12:confirmed] Запросы ограничены limit 10000/5000 (765, 871, 1059, 2030) без индикатора усечения — при превышении UI молча теряет часть портов/розеток.; [cycle13:unverifiable] Лимиты 10000/5000 действительно жёстко заданы на клиенте (765, 871, 1059, 2030), бэкенд принимает не больше 10000 (313, 330), а признака усечения/общего total в ответе нет. При этом вкладка показывает длину загруженного списка (SocketsTab.jsx:185), тогда как обзорный блок показывает истинный sockets_count из metrics (Networks.jsx:2723-2727), то есть расхождение возможно. Но достижимость требует филиала с более 10000 розеток/портов, а таких данных в репозитории нет, поэтому пользовательский эффект не подтверждён.

### FE-0162 — Networks: мелкие хронометражи — setTimeout(0) без очистки, expectedRef безусловный, setPointerCapture без try, ключ AuditTab
- Категория: Async/Networks | Серьёзность: Low | Статус: Rejected
- Файл: `WEB-itinvent/frontend/src/pages/Networks.jsx` :1467-1468; ObjectNetmapTab.jsx:72 (expectedVersion безусловно → lost-update); InteractiveMapCanvas.jsx:528,657; AuditTab.jsx:84
- Суть/механизм: совокупность узких edge-кейсов
- Доказательства: статическая проверка по file:line (цикл 11, агент + ручная перепроверка); [cycle12:confirmed] setTimeout(0) в startSocketPointCreation не сохраняется и не очищается (1467-1468), expectedRef.current безусловно перезаписывается из version (ObjectNetmapTab.jsx:72), setPointerCapture без try (InteractiveMapCanvas.jsx:528, 657), ключ строки аудита включает index (AuditTab.jsx:84).; [cycle13:refuted] Все четыре пункта — защитные мелочи без наблюдаемого состояния: setTimeout(0) вызывает applySocketPointDraft, который лишь применяет уже сохранённый черновик (1467-1468), expectedRef синхронизируется с версией того же map-объекта, которую родитель обновляет после сохранения (ObjectNetmapTab.jsx:72, 87-88), setPointerCapture на pointerdown поддерживается браузерами, а ключ AuditTab использует index только как fallback при отсутствии id (AuditTab.jsx:84), при этом бэкенд всегда отдаёт id. Воспроизводимого пользовательского дефекта нет.

### FE-0163 — KnowledgeBase: клик по элементу списка перезагружает весь список и дублирует загрузку детали
- Категория: Perf/KB | Серьёзность: Medium | Статус: Confirmed
- Файл: `WEB-itinvent/frontend/src/pages/KnowledgeBase.jsx` :679,710,742 (selectedXId в deps useCallback),749-759 (эффекты перезапускаются),666-669,697-700,729-732
- Суть/механизм: каждый выбор → лишний запрос списка + мерцание + до 2 запросов детали
- Доказательства: статическая проверка по file:line (цикл 11, агент + ручная перепроверка); [cycle12:confirmed] Загрузчики списков держат selectedArticleId/selectedTemplateId/selectedCardId в deps (679, 710, 742), а эффекты вызывают их (749-759); клик меняет selected (1490/1535), вызывая повторный запрос списка и повторную загрузку детали (666-669).

### FE-0164 — Feed: автосохранение создаёт пустой черновик при простом открытии композера
- Категория: SideEffects/Feed | Серьёзность: Medium | Статус: Confirmed
- Файл: `WEB-itinvent/frontend/src/components/feed/FeedComposerDialog.jsx` :318-335 (эффект без dirty-проверки),183,326
- Суть/механизм: каждый «открыл и закрыл» → пустой черновик на сервере
- Доказательства: статическая проверка по file:line (цикл 11, агент + ручная перепроверка); [cycle12:confirmed] Автосейв-эффект (318-335) срабатывает при открытии без dirty-проверки и создаёт draft (326) с пустыми title/body; бэкенд принимает пустой draft — проверка title только для не-draft (hub_service.py:5393-5394).

### FE-0165 — Feed: параллельные автосохранения плодят дубли черновиков
- Категория: Race/Feed | Серьёзность: Medium | Статус: Confirmed
- Файл: `WEB-itinvent/frontend/src/components/feed/FeedComposerDialog.jsx` :320-334: таймер читает draftId из замыкания без отмены in-flight запроса
- Суть/механизм: дубли черновиков при быстром вводе; setState после закрытия
- Доказательства: статическая проверка по file:line (цикл 11, агент + ручная перепроверка); [cycle12:confirmed] Таймер автосейва не отменяет in-flight createDraft, а draftId читается из замыкания (320-328); при вводе до ответа уходит второй createDraft — дубли черновиков и setState после закрытия (327, 329).

### FE-0166 — Docflow: objectURL предпросмотра утекает при уходе; out-of-order ответ ломает учёт URL
- Категория: ResourceLeak/Docflow | Серьёзность: Low | Статус: Confirmed
- Файл: `WEB-itinvent/frontend/src/pages/Docflow.jsx` :1225-1226,1665-1670,1745-1758: нет unmount-cleanup; .current присваивается ДО проверки sequence
- Суть/механизм: утечка blob-памяти за сессию; отозванный URL теряет владельца
- Доказательства: статическая проверка по file:line (цикл 11, агент + ручная перепроверка); [cycle12:confirmed] Unmount-cleanup есть: useEffect(() => () => revokePreviewObjectUrl()) на Docflow.jsx:1788 (с baseline 6eccf3ce), поэтому «утечка при уходе» не подтверждается. Остаётся out-of-order: previewObjectUrl.current присваивается до проверки sequence (1745-1751), и поздний ответ оставляет ref на уже отозванном URL (1755-1758).

### FE-0167 — Feed: hash-эффект комментария повторно дёргает N запросов на каждый 15-с полл
- Категория: Race/Feed | Серьёзность: Medium | Статус: Confirmed
- Файл: `WEB-itinvent/frontend/src/components/feed/FeedCommentsPanel.jsx` :130-138,140-166: эффект зависит от items → каждый полл перезапускает; нет cancelled
- Суть/механизм: при битой ссылке — всплески запросов каждые 15 с
- Доказательства: статическая проверка по file:line (цикл 11, агент + ручная перепроверка); [cycle12:confirmed] Эффект 140-166 зависит от items и при каждом фоновом полле (130-138, интервал 15 с) заново делает getComments по каждому root с ответами; отмены/seq нет, только .catch(() => undefined).

### FE-0168 — KB Help: открытие статьи без упорядочивания ответов → показ чужой статьи
- Категория: Race/Help | Серьёзность: Medium | Статус: Confirmed
- Файл: `WEB-itinvent/frontend/src/pages/help/KbHelpSection.jsx` :265-279: openArticle без seq/abort/cancelled; ошибка глотается в setDetail(null)
- Суть/механизм: быстрые клики по статьям → побеждает поздний ОТВЕТ
- Доказательства: статическая проверка по file:line (цикл 11, агент + ручная перепроверка); [cycle12:confirmed] openArticle (265-279) после await безусловно пишет setDetail/setDetailLoading, без seq/abort, а ошибка гасится в setDetail(null); поздний ответ перетирает выбранную статью.

### FE-0169 — KB Help: жёсткий лимит 300 статей без пагинации — тихое усечение базы
- Категория: Pagination/Help | Серьёзность: Low | Статус: Confirmed
- Файл: `WEB-itinvent/frontend/src/pages/help/KbHelpSection.jsx` :222-225: limit:300, total игнорируется, индикатора усечения нет
- Суть/механизм: часть базы знаний невидима без предупреждения
- Доказательства: статическая проверка по file:line (цикл 11, агент + ручная перепроверка); [cycle12:confirmed] На 224 запрашивается limit:300, total из ответа (kb_service.py:328) не используется, счётчик 308/330 считает только загруженные статьи; пагинации и предупреждения о срезе нет.

### FE-0170 — IT-заявки: устаревший фильтр склада фильтрует, пока Select рисует «Все склады»
- Категория: State/Filters | Серьёзность: Medium | Статус: Confirmed
- Файл: `WEB-itinvent/frontend/src/pages/ItPurchaseRequests.jsx` :834 (warehouseRef в запросе),1060-1085 (renderValue показывает «Все склады» при отсутствии в фасетах)
- Суть/механизм: пустой список при визуально сброшенном фильтре
- Доказательства: статическая проверка по file:line (цикл 11, агент + ручная перепроверка); [cycle12:confirmed] warehouseRef уходит в запрос (834), а renderValue (1071) при отсутствии ref в facets рисует «Все склады», не сбрасывая warehouseRef; facets считаются до фильтра по складу (backend 1630-1638), поэтому расхождение возникает при поиске/смене снимка.

### FE-0171 — IT-заявки: ошибка загрузки детали невидима, когда заявки нет в списке
- Категория: UX/ErrorState | Серьёзность: Medium | Статус: Confirmed
- Файл: `WEB-itinvent/frontend/src/pages/ItPurchaseRequests.jsx` :665-681 (RequestDetail),1136: {error} рендерится только внутри ветки с request
- Суть/механизм: неудачная загрузка выглядит как «ничего не выбрано»
- Доказательства: статическая проверка по file:line (цикл 11, агент + ручная перепроверка); [cycle12:confirmed] RequestDetail при !request (669-681) возвращает «Выберите заявку» до рендера error (693); detailError, переданный на 1136, не виден, если заявки нет ни в списке, ни в detail.

### FE-0172 — Feed: openAnalytics без busy-guard → дубли запросов
- Категория: BusyGuards/Feed | Серьёзность: Low | Статус: Rejected
- Файл: `WEB-itinvent/frontend/src/pages/Feed.jsx` :589-601
- Суть/механизм: двойной клик → два getAnalytics
- Доказательства: статическая проверка по file:line (цикл 11, агент + ручная перепроверка); [cycle12:not-a-defect] У openAnalytics (589-601) нет busy-guard, но единственный триггер — MenuItem FeedPostCard.jsx:269, а menuAction (145-147) сначала закрывает меню; повторный вызов практически недостижим.

### FE-0173 — Feed: архив/удаление поста — сравнение id без нормализации типов
- Категория: State/Feed | Серьёзность: Low | Статус: Rejected
- Файл: `WEB-itinvent/frontend/src/pages/Feed.jsx` :555,577 (item.id !== post.id) vs patchPost:358-361 (String-нормализация)
- Суть/механизм: при number/string-расхождении элемент останется до перезагрузки
- Доказательства: статическая проверка по file:line (цикл 11, агент + ручная перепроверка); [cycle12:not-a-defect] archive/delete получают тот же объект из items (Feed.jsx:677-679, selectedPost ищется в items 273-277), поэтому item.id !== post.id для этого элемента ложно при любом типе; String-нормализация в patchPost (358-361) — защитная.

### FE-0174 — IT-заявки: request_ref подставляется в URL без encodeURIComponent
- Категория: Routing | Серьёзность: Low | Статус: Rejected
- Файл: `WEB-itinvent/frontend/src/pages/ItPurchaseRequests.jsx` :910,946: navigate(`/it/requests/${ref}`)
- Суть/механизм: ref с / или спецсимволами сломает маршрут
- Доказательства: статическая проверка по file:line (цикл 11, агент + ручная перепроверка); [cycle12:not-a-defect] request_ref формируется как UUID из 36 символов (warehouse_1c_it_requests.py:131-144), слэшей и спецсимволов не бывает; navigate на 910/946 безопасен.

### FE-0175 — Docflow: dangling previewObjectUrl.current после отозванного URL
- Категория: ResourceLeak/Docflow | Серьёзность: Low | Статус: Rejected
- Файл: `WEB-itinvent/frontend/src/pages/Docflow.jsx` :1749+1757-1758
- Суть/механизм: после устаревшей последовательности .current указывает на мёртвый URL
- Доказательства: статическая проверка по file:line (цикл 11, агент + ручная перепроверка); [cycle12:confirmed] В createObjectUrl (1745-1750) пишется previewObjectUrl.current, а в stale-ветке (1755-1758) URL отзывается без очистки .current; затем close/следующий preview отзывает мёртвый URL, а URL актуального превью может остаться неотозванным.; [cycle13:refuted] Гонка достижима только при двух перекрывающихся openAttachmentPreview (закрыть превью во время загрузки и открыть другое): stale-ветка пишет previewObjectUrl.current = objectUrl (1749), затем отзывает его (1755-1759), оставляя в ref мёртвый URL. Однако следующий close/open отзывает именно мёртвый URL, а актуальный URL остаётся живым, то есть превью показывается корректно; последствие — утечка blob-URL (память), а не потеря/подмена превью.

### FE-0176 — Voice: единый actionBusyKey затирается параллельными действиями → двойной сабмит
- Категория: BusyGuards/Voice | Серьёзность: Medium | Статус: Confirmed
- Файл: `WEB-itinvent/frontend/src/pages/voice-video/VoiceVideoPage.jsx` :132-142 (runAction без «уже занято»),828-845; VoiceJobsSection.jsx:368,451; VoiceLabelingSection.jsx:196-205
- Суть/механизм: finally первого действия обнуляет ключ пока второе в полёте
- Доказательства: статическая проверка по file:line (цикл 11, агент + ручная перепроверка); [cycle12:confirmed] runAction (132-142) хранит один actionBusyKey и в finally ставит null; параллельные действия с разными ключами (имя встречи 453-462, id задачи 828-848) перетирают друг друга, снимая блокировку с ещё идущего действия.

### FE-0177 — Voice: ретраи в карточке встречи обходят AbortController → stale-запись чужой встречи
- Категория: Race/Voice | Серьёзность: Medium | Статус: Confirmed
- Файл: `WEB-itinvent/frontend/src/pages/voice-video/VoiceMeetingDrawer.jsx` :980-1004 (retry* без signal и без base-проверки), cleanup отменяет только transcriptAbortRef
- Суть/механизм: запоздавший ответ ретрая заполняет карточку новой встречи данными старой
- Доказательства: статическая проверка по file:line (цикл 11, агент + ручная перепроверка); [cycle12:confirmed] retryTopics/retryAssignments/retryTranscript (980-1001) вызывают API без signal и без сверки base; cleanup (1003-1004) отменяет только transcriptAbortRef, поэтому ответ ретрая пишется в уже другую встречу.

### FE-0178 — Voice: el.play() без .catch → unhandled promise rejection
- Категория: ErrorHandling/Voice | Серьёзность: Low | Статус: Confirmed
- Файл: `WEB-itinvent/frontend/src/pages/voice-video/VoiceMeetingDrawer.jsx` :849,864,868,~1268
- Суть/механизм: частые сики/смена src → AbortError в консоль/мониторинг
- Доказательства: статическая проверка по file:line (цикл 11, агент + ручная перепроверка); [cycle12:confirmed] el.play?.() на 849, 864, 868 и 1268 не имеет .catch; AbortError при смене src или паузе даёт unhandled promise rejection.

### FE-0179 — Voice: Space и Delete перехватываются глобально при фокусе на кнопках — кнопки не активируются, Delete удаляет сегмент
- Категория: A11y/Voice | Серьёзность: Medium | Статус: Confirmed
- Файл: `WEB-itinvent/frontend/src/pages/voice-video/VoiceLabelEditor.jsx` :90-94 (isTypingTarget без BUTTON/A),505-529
- Суть/механизм: клавиатурный пользователь не может активировать кнопки Space-ом; случайное удаление сегмента
- Доказательства: статическая проверка по file:line (цикл 11, агент + ручная перепроверка); [cycle12:confirmed] isTypingTarget (90-94) не относит button/a к полям ввода, а глобальный keydown делает preventDefault для Space (505-507) и удаляет сегмент по Delete (528-529).

### FE-0180 — Voice: Escape в редакторе сбрасывает выделение даже при открытых меню/диалогах
- Категория: Keyboard/Voice | Серьёзность: Low | Статус: Confirmed
- Файл: `WEB-itinvent/frontend/src/pages/voice-video/VoiceLabelEditor.jsx` :530-531: window keydown без проверки Menu/Dialog (ср. защита Monitoring.jsx:131-142)
- Суть/механизм: закрытие меню спикера снимает выделение сегмента
- Доказательства: статическая проверка по file:line (цикл 11, агент + ручная перепроверка); [cycle12:confirmed] Escape на 530-531 безусловно вызывает setSelectedId(null); проверки открытых Menu (884-938) или Dialog (841-882) нет.

### FE-0181 — Voice: waveform без pointercancel — застрявший drag на тач-устройствах
- Категория: Pointer/Voice | Серьёзность: Medium | Статус: Confirmed
- Файл: `WEB-itinvent/frontend/src/pages/voice-video/VoiceLabelWaveform.jsx` :81-114,146-148: нет onPointerCancel
- Суть/механизм: системная отмена жеста оставляет drag/pressRef — ложный seek при следующем касании
- Доказательства: статическая проверка по file:line (цикл 11, агент + ручная перепроверка); [cycle12:confirmed] На Box (143-148) есть только onPointerDown/Move/Up (81-114), onPointerCancel отсутствует; pressRef и drag не сбрасываются при системной отмене жеста.

### FE-0182 — Voice: unhandled rejection при отказе clipboard.writeText и неочищаемый setTimeout
- Категория: ErrorHandling/Voice | Серьёзность: Low | Статус: Confirmed
- Файл: `WEB-itinvent/frontend/src/pages/voice-video/VoiceLogViewer.jsx` :166-171
- Суть/механизм: кнопка «Копировать» молча падает на http/старом браузере
- Доказательства: статическая проверка по file:line (цикл 11, агент + ручная перепроверка); [cycle12:wrong-evidence] Факт неверен: navigator.clipboard?.writeText(...).then(...) при отсутствии clipboard не падает — опциональная цепочка короткозамыкает всё выражение (проверено в node). Реальный дефект рядом: у промиса writeText нет .catch (отказ на http/при запрете) и setTimeout на 169 не очищается.; [cycle13:confirmed] Подтверждается с исправленной формулировкой: старого TypeError нет — при отсутствии navigator.clipboard опциональная цепочка короткозамыкает всё выражение вместе с .then (проверено в node), поэтому «undefined.then» невозможен. Реальный дефект — отсутствие .catch и fallback: при отказе Clipboard API (нет разрешения, документ не в фокусе, ограничение политики или встроенного браузера) клик «Копировать всё» молча ничего не делает, copied не выставляется, а отклонение уходит в unhandledrejection. Общий helper lib/clipboard.js:1-12 с textarea-fallback здесь не используется; setTimeout на VoiceLogViewer.jsx:169 также не очищается, поэтому повторное копирование и закрытие диалога оставляют висящий таймер.

### FE-0183 — Voice: getSummary .then без проверки abort → чужая сводка при смене встречи
- Категория: Race/Voice | Серьёзность: Medium | Статус: Confirmed
- Файл: `WEB-itinvent/frontend/src/pages/voice-video/VoiceMeetingSummary.jsx` :167-184: signal передан, но then(setSummary) не проверяет aborted (в отличие от :179)
- Суть/механизм: мигание сводки предыдущей встречи
- Доказательства: статическая проверка по file:line (цикл 11, агент + ручная перепроверка); [cycle12:confirmed] getSummary на 172-173 вызывает .then(setSummary) без проверки controller.signal.aborted, тогда как для статусов на 179 такая проверка есть; при смене base возможен показ старой сводки.

### FE-0184 — Voice: summary.decisions/open_questions/participants без защиты .length → крах вкладки
- Категория: ErrorHandling/Voice | Серьёзность: Low | Статус: Rejected
- Файл: `WEB-itinvent/frontend/src/pages/voice-video/VoiceMeetingSummary.jsx` :221-222,234,313,348,355 (topics защищён :213, остальные — нет)
- Суть/механизм: TypeError при частичном ответе API
- Доказательства: статическая проверка по file:line (цикл 11, агент + ручная перепроверка); [cycle12:not-a-defect] Эндпоинт /voice/meetings/{base}/summary всегда возвращает decisions/open_questions/topics/participants массивами (voice_server/pipeline.py:256-264), поэтому .length на 221-222,234,348,355 не может упасть на текущем контракте.

### FE-0185 — Voice: связь поручения с задачей сохраняется с .catch(()=>{}) — тихая потеря task_id
- Категория: ErrorHandling/Voice | Серьёзность: Medium | Статус: Confirmed
- Файл: `WEB-itinvent/frontend/src/pages/voice-video/VoiceAssignmentsTab.jsx` :242-244
- Суть/механизм: UI показывает «задача создана», связь не сохранена → дубль задачи после перезагрузки
- Доказательства: статическая проверка по file:line (цикл 11, агент + ручная перепроверка); [cycle12:confirmed] updateAssignmentStatus вызывается fire-and-forget с .catch(() => {}) (242-244) после успешного patchStatus; task_id на сервере не сохраняется, а UI уже показывает успех.

### FE-0186 — Voice: removeVariant без busy-защиты — двойной DELETE → ложная ошибка
- Категория: BusyGuards/Voice | Серьёзность: Medium | Статус: Confirmed
- Файл: `WEB-itinvent/frontend/src/pages/voice-video/VoiceLabelQualityPanel.jsx` :82-89,148-152
- Суть/механизм: второй клик → 404 «Не удалось удалить» при выполненном удалении; можно удалять во время variant-job
- Доказательства: статическая проверка по file:line (цикл 11, агент + ручная перепроверка); [cycle12:confirmed] removeVariant (82-89) без busy-состояния, кнопка удаления (149) не disabled ни во время запроса, ни при variantJobActive; второй DELETE даёт 404 и ошибку при уже выполненном удалении.

### FE-0187 — Voice: панели калибровки/качества/лиц — load() без abort и mounted-флага
- Категория: Leaks/Voice | Серьёзность: Low | Статус: Confirmed
- Файл: `WEB-itinvent/frontend/src/pages/voice-video/VoiceLabelCalibrationPanel.jsx` :78-92; VoiceLabelQualityPanel.jsx:54-68; VoiceLabelFacesPanel.jsx:118-126; VoiceMeetingDrawer.jsx:872-876
- Суть/механизм: setState на размонтированном компоненте; race двух load
- Доказательства: статическая проверка по file:line (цикл 11, агент + ручная перепроверка); [cycle12:confirmed] load() в калибровке (78-92), качестве (54-64), лицах (118-126) и getAssignees в карточке (872-876) не имеют abort/mounted-проверок: два load могут перезаписать друг друга, setState идёт после размонтирования.

### FE-0188 — Voice: превью лиц кликабельны только мышью — <img onClick> с пустым alt
- Категория: A11y/Voice | Серьёзность: Medium | Статус: Confirmed
- Файл: `WEB-itinvent/frontend/src/pages/voice-video/VoiceLabelFacesPanel.jsx` :50-68: Box component=img без role/tabIndex/onKeyDown, alt=''
- Суть/механизм: клавиатурный пользователь не может исключить лишние лица
- Доказательства: статическая проверка по file:line (цикл 11, агент + ручная перепроверка); [cycle12:confirmed] Превью лиц — Box component="img" с onClick и alt="" (50-68), без role/tabIndex/onKeyDown; выбор лиц недоступен с клавиатуры.

### FE-0189 — Voice: смена порядка сортировки встреч не сбрасывает страницу
- Категория: UX/Voice | Серьёзность: Low | Статус: Confirmed
- Файл: `WEB-itinvent/frontend/src/pages/voice-video/VoiceVideoPage.jsx` :789-790 (onOrderChange=setMeetingsOrder без setMeetingsPage(0)) vs :394-416
- Суть/механизм: страница 3 другого порядка — «пропадающие» встречи
- Доказательства: статическая проверка по file:line (цикл 11, агент + ручная перепроверка); [cycle12:confirmed] onOrderChange={setMeetingsOrder} на 790 не сбрасывает meetingsPage, тогда как остальные фильтры (394-414) вызывают setMeetingsPage(0); смена порядка оставляет страницу 3.

### FE-0190 — Voice: загрузка файлов без дедупликации — один файл можно отправить дважды
- Категория: Dedup/Voice | Серьёзность: Low | Статус: Confirmed
- Файл: `WEB-itinvent/frontend/src/pages/voice-video/VoiceUploadDialog.jsx` :145-150: addFiles фильтрует только расширение
- Суть/механизм: два одинаковых job и две карточки встречи
- Доказательства: статическая проверка по file:line (цикл 11, агент + ручная перепроверка); [cycle12:confirmed] addFiles (145-151) фильтрует только по расширению и добавляет файлы без сверки name/size; handleSubmit отправляет каждый элемент files (238-259), дубликат создаёт второй job.

### FE-0191 — Voice: glossary — мутации без busy-защиты + data.items без guard
- Категория: BusyGuards/Voice | Серьёзность: Low | Статус: Confirmed
- Файл: `WEB-itinvent/frontend/src/pages/voice-video/VoiceGlossarySection.jsx` :169-185 (нет busy),239 (items.map без ?.)
- Суть/механизм: лавина запросов; крах при отсутствии items
- Доказательства: статическая проверка по file:line (цикл 11, агент + ручная перепроверка); [cycle12:confirmed] act (169-177) не имеет busy-состояния и не блокирует повторные клики по статусу/удалению. Часть про крах data.items.map (239) не подтверждается — backend всегда возвращает items (glossary_store.py:82), но отсутствие busy реально.

### FE-0192 — Monitoring: isStale считает повреждённую дату «свежей» (NaN > x → false)
- Категория: Data/Monitoring | Серьёзность: Low | Статус: Confirmed
- Файл: `WEB-itinvent/frontend/src/pages/monitoring/monitoringFormat.js` :17: new Date(value).getTime() NaN → не устарело
- Суть/механизм: битый checked_at отображается как свежие данные
- Доказательства: статическая проверка по file:line (цикл 11, агент + ручная перепроверка); [cycle12:confirmed] isStale (17) при битой дате получает NaN, и сравнение NaN > seconds*1000 даёт false, поэтому повреждённый checked_at считается свежим.

### FE-0193 — Monitoring: deletedIds — вечный tombstone; устройство с переиспользованным id не появится
- Категория: State/Monitoring | Серьёзность: Low | Статус: Rejected
- Файл: `WEB-itinvent/frontend/src/pages/Monitoring.jsx` :72,112-113,227-231: Set без очистки по времени/событию
- Суть/механизм: «невидимое» устройство после удаления+пересоздания в одной сессии
- Доказательства: статическая проверка по file:line (цикл 11, агент + ручная перепроверка); [cycle12:not-a-defect] Tombstone deletedIds (72,112-113) может скрыть только тот же id, а id целей — uuid4 (network_monitor_store.py:145); переиспользование id после удаления невозможно, Set ограничен сессией и чистится при перезагрузке.

### FE-0194 — Monitoring: target.name.split без защиты — target без name роняет всю сетку
- Категория: ErrorHandling/Monitoring | Серьёзность: Low | Статус: Suspected
- Файл: `WEB-itinvent/frontend/src/pages/monitoring/MonitoringDeviceGrid.jsx` :34: displayTargetName защищает, но прямой вызов split — нет
- Суть/механизм: белый экран списка устройств при неполной записи
- Доказательства: статическая проверка по file:line (цикл 11, агент + ручная перепроверка); [cycle12:confirmed] На 34 target.name.split без защиты, хотя displayTargetName (monitoringFormat.js:28) использует ?. и fallback. name в БД NOT NULL (monitoring_models.py:29), но Monitoring.jsx:113 при отсутствии id добавляет частичный {id, summary} из patchTarget (198), и такая запись роняет сетку.; [cycle13:confirmed] Подтверждается как незащищённое обращение, а не как частый пользовательский сценарий: MonitoringDeviceGrid.jsx:34 вызывает target.name.split без ?., хотя displayTargetName рядом использует ?. и fallback. В БД name NOT NULL (monitoring_models.py:29), поэтому нормальный ответ API имя содержит; путь к записи без name даёт только частичный patchTarget({id, summary}) при сохранении интерфейса (Monitoring.jsx:198), если цели уже нет в списке (рассинхронизация списка и детали), после чего при возврате к сетке рендер падает. Падение ловит RouteErrorBoundary (App.jsx:308-338) — пользователь увидит экран ошибки маршрута, а не «белый экран»; сценарий редкий, поэтому Low оправдана, но guard в строке 34 нужен.; [cycle19:mocked-browser] Route-mocked /monitoring/overview with one target without name: console TypeError at MonitoringDeviceGrid.jsx:29, "Route render failed", error boundary "Не удалось отобразить раздел". No real backend target without name was observed; status remains Suspected.

### FE-0195 — Monitoring: диалог устройств — loadFree/change без mounted-флага
- Категория: Leaks/Monitoring | Серьёзность: Low | Статус: Confirmed
- Файл: `WEB-itinvent/frontend/src/components/itObjects/ObjectMonitoringDevicesDialog.jsx` :24-31,33-38,40-52
- Суть/механизм: setState на размонтированном диалоге; stale-write при быстром переоткрытии
- Доказательства: статическая проверка по file:line (цикл 11, агент + ручная перепроверка); [cycle12:confirmed] loadFree (24-31), эффект открытия (33-38) и change (40-52) не имеют abort/mounted-флага; при быстром закрытии/переоткрытии возможен setState после unmount и запись устаревшего ответа.

### FE-0196 — Monitoring: result.targets.filter без проверки поля — TypeError маскируется generic-ошибкой
- Категория: ErrorHandling/Monitoring | Серьёзность: Low | Статус: Rejected
- Файл: `WEB-itinvent/frontend/src/pages/Monitoring.jsx` :148
- Суть/механизм: ошибка формы ответа маскируется «Не удалось обновить данные»
- Доказательства: статическая проверка по file:line (цикл 11, агент + ручная перепроверка); [cycle12:not-a-defect] overview всегда возвращает targets (network_monitor_service.py:148), поэтому result.targets.filter на 148 не может получить undefined с текущим API; catch там маскирует только реальные сетевые ошибки.

### FE-0197 — Login: экран backup-кодов после первичной настройки 2FA недостижим — Login размонтируется раньше
- Категория: Auth/UX | Серьёзность: High | Статус: Confirmed
- Файл: `WEB-itinvent/frontend/src/pages/Login.jsx` :1505-1521 (submitTwoFactorSetup→verifyTwoFactorSetup→applyAuthenticatedPayload→setUser, AuthContext.jsx:557-568) → LoginRoute (App.jsx:237-239) отдаёт PostAuthNavigate → Login unmount ДО setStep(setup_complete); renderSetupCompleteStep — мёртвый код в проде
- Суть/механизм: пользователь не видит backup-коды при обязательной 2FA — риск блокировки при потере TOTP-устройства; тест Login.test.jsx:503 маскирует дефект (рендерит без LoginRoute)
- Доказательства: статическая проверка по file:line (цикл 11, агент + ручная перепроверка); [cycle12:confirmed] verifyTwoFactorSetup ставит user (AuthContext.jsx:557-568) до setStep('setup_complete') (Login.jsx:1514-1520); LoginRoute при isAuthenticated отдаёт PostAuthNavigate (App.jsx:237-253), Login размонтируется и renderSetupCompleteStep (2190-2219) не показывается.; [cycle13:confirmed] Live cycle 13 (route-mocked 2FA на изолированном стенде): после verify-2fa URL сразу /dashboard, экран backup-кодов не появился ни через 0.25/0.8/2/4 c.; [cycle14:live] Real 2FA flow on isolated stack 18004/5222 (policy=all, loopback=external, seeded e2e_admin): login -> 2fa_setup_required -> enable-2fa (real otpauth secret) -> TOTP -> verify-2fa. URL became /dashboard immediately; backup-code screen and codes did not appear at 4 s.

### FE-0198 — Login: обязательная привязка trusted-device (remember-device sheet) недостижима — тот же routing race
- Категория: Auth/UX | Серьёзность: High | Статус: Confirmed
- Файл: `WEB-itinvent/frontend/src/pages/Login.jsx` :1394-1415,1137-1153,1170-1181,2342-2399: setRememberDeviceOpen(true) при уже установленном user → sheet не рендерится
- Суть/механизм: required-enrollment молча пропускается — фича фактически отключена
- Доказательства: статическая проверка по file:line (цикл 11, агент + ручная перепроверка); [cycle12:confirmed] completeAuthenticatedRedirect (1404-1415) после установки user вызывает openRememberDevicePrompt → setRememberDeviceOpen(true) (1170-1181), но LoginRoute уже размонтировал Login (App.jsx:237-253), и sheet на 2342-2399 не рендерится — обязательная привязка пропускается.; [cycle13:confirmed] Live cycle 13 (route-mocked 2FA на изолированном стенде): после verify-2fa-login URL сразу /dashboard, remember-device sheet не появился ни через 0.25/0.8/2/4 c.; [cycle14:live] Real second login after enabling 2FA on 5222: login -> 2fa_required -> TOTP -> verify. External zone, discoverable_trusted_devices_count=0. URL became /dashboard; mandatory remember-device sheet did not appear.

### FE-0199 — Login: кастомный диалог «Запомнить устройство» без управления фокусом/Escape/inert
- Категория: A11y/Login | Серьёзность: Medium | Статус: Confirmed
- Файл: `WEB-itinvent/frontend/src/pages/Login.jsx` :2342-2399: role=dialog aria-modal без focus trap/autofocus/Escape/aria-hidden фона
- Суть/механизм: при появлении sheet фокус уходит на элементы под оверлеем
- Доказательства: статическая проверка по file:line (цикл 11, агент + ручная перепроверка); [cycle12:confirmed] Кастомный role="dialog" aria-modal (2342-2399) не имеет focus trap/autoFocus/Escape/aria-hidden фона; на 976-993 обрабатывается только overflow body.

### FE-0200 — Незащищённые Web Storage в горячих путях: интерцептор, restore сессии, route-функции
- Категория: Reliability/Storage | Серьёзность: Medium | Статус: Confirmed
- Файл: `WEB-itinvent/frontend/src/api/http.js` :248 (getItem в request-интерцепторе — ломает КАЖДЫЙ запрос),370; AuthContext.jsx:201,225,270,293; aboutOnboarding.js:36,43,46 из render-функций App.jsx:169,186,244; MainLayout.jsx:1121,1139,1762,1770,1937
- Суть/механизм: при заблокированном хранилище (корп-политики, приватные режимы): от вечного спиннера до падения API-слоя и невозможности входа
- Доказательства: статическая проверка по file:line (цикл 11, агент + ручная перепроверка); [cycle12:confirmed] localStorage/sessionStorage используются без try/catch в интерцепторе (http.js:248,370), восстановлении сессии (AuthContext.jsx:270,293), route-функциях (aboutOnboarding.js:36,43,46 из App.jsx:244) и MainLayout.jsx:1121,1139,1762,1770,1937; при заблокированном хранилище это ломает запросы и рендер.

### FE-0201 — Login: полный reload вместо SPA-навигации после passkey-входа
- Категория: Auth/UX | Серьёзность: Low | Статус: Confirmed
- Файл: `WEB-itinvent/frontend/src/pages/Login.jsx` :1642,1102-1115: window.location.assign параллельно SPA-навигации PostAuthNavigate
- Суть/механизм: лишний полный цикл загрузки приложения при каждом passkey/trusted-device входе
- Доказательства: статическая проверка по file:line (цикл 11, агент + ручная перепроверка); [cycle12:confirmed] redirectAfterAuthentication (1102-1115) делает window.location.assign, если pathname ещё /login; вызовы после passkey/trusted-device (1353, 1642) идут сразу после setUser, до коммита SPA-навигации LoginRoute, поэтому полный reload срабатывает.

### FE-0202 — Login: утечка window-слушателей в scheduleLoginPresentationRecovery
- Категория: Leaks/Login | Серьёзность: Low | Статус: Confirmed
- Файл: `WEB-itinvent/frontend/src/lib/loginPagePresentation.js` :179-195: visibilitychange+pageshow снимаются только при visible-событии; cleanup не вызывается (Login.jsx:1327,1373-1376,1385-1389)
- Суть/механизм: пара слушателей на каждую попытку passkey-входа
- Доказательства: статическая проверка по file:line (цикл 11, агент + ручная перепроверка); [cycle12:confirmed] scheduleLoginPresentationRecovery (179-194) снимает слушатели только по visible-событию, а возвращённый cleanup в Login.jsx (1327, 1373-1390) нигде не вызывается; пара слушателей копится на каждую попытку.

### FE-0203 — Login: 50-мс опрос WebAuthn API работает бесконечно
- Категория: Perf/Login | Серьёзность: Low | Статус: Confirmed
- Файл: `WEB-itinvent/frontend/src/lib/useWebAuthnAvailability.js` :50: setInterval останавливается только при появлении API или unmount
- Суть/механизм: 20 вызовов/сек вечно на машинах без PublicKeyCredential
- Доказательства: статическая проверка по file:line (цикл 11, агент + ручная перепроверка); [cycle12:confirmed] setInterval(markWebReady, 50) (50) очищается только при появлении API (34-37) или unmount; timeout на 52-56 лишь ставит timedOut, поэтому без PublicKeyCredential опрос идёт 20 раз/с всё время жизни страницы.

### FE-0204 — Layout: мёртвая зависимость isMailRoute перезапускает весь цикл поллинга
- Категория: Perf/Layout | Серьёзность: Low | Статус: Confirmed
- Файл: `WEB-itinvent/frontend/src/components/layout/MainLayout.jsx` :374,1290-1298,1652-1661: isMailRoute в deps, но в теле не используется
- Суть/механизм: пересоздание fetchUnreadCounts → рестарт интервала и 6 слушателей + внеочередной опрос
- Доказательства: статическая проверка по file:line (цикл 11, агент + ручная перепроверка); [cycle12:confirmed] isMailRoute добавлен в deps fetchUnreadCounts (1296), но в теле 1142-1298 не используется; смена /mail пересоздаёт колбэк и перезапускает эффект 1652-1661 — очистку/навешивание слушателей и внеочередной pollNotifications (1576).

### FE-0205 — Layout: частичный сбой refreshBellInbox визуально очищает колокольчик
- Категория: ErrorHandling/Layout | Серьёзность: Low | Статус: Confirmed
- Файл: `WEB-itinvent/frontend/src/components/layout/MainLayout.jsx` :1327-1359: Promise.allSettled + безусловные setNotifications/setMailNotifications
- Суть/механизм: транзиентная ошибка одного канала опустошает секцию
- Доказательства: статическая проверка по file:line (цикл 11, агент + ручная перепроверка); [cycle12:confirmed] refreshBellInbox (1327-1356) после Promise.allSettled безусловно вызывает setNotifications(nextHubItems) и setMailNotifications(nextMailItems); при отказе одного запроса его next* остаётся [], и секция колокольчика очищается.

### FE-0206 — Layout: оверлей pendingNavigation зависает до 10 с при редиректе целевого роута
- Категория: UX/Navigation | Серьёзность: Medium | Статус: Confirmed
- Файл: `WEB-itinvent/frontend/src/components/layout/MainLayout.jsx` :607-623,1886-1899: сброс только при pathname===targetPath или таймаут 10 с; PermissionRoute/AboutOnboardingRoute могут перенаправить
- Суть/механизм: клик по пункту с устаревшими правами → брендированный лоадер 10 с поверх страницы
- Доказательства: статическая проверка по file:line (цикл 11, агент + ручная перепроверка); [cycle12:confirmed] pendingNavigation снимается только при совпадении pathname с целью (607-623) или по таймауту 10 000 мс (1892-1899); PermissionRoute (App.jsx:265/272) может увести на другой путь, и оверлей висит до таймаута.

### FE-0207 — Layout: бейдж непрочитанной почты завышен до 20 с после прочтения из колокольчика
- Категория: Staleness/Layout | Серьёзность: Low | Статус: Confirmed
- Файл: `WEB-itinvent/frontend/src/components/layout/MainLayout.jsx` :199 (TTL 20s),1191-1201,1827-1843: markAsRead без applyMailUnreadDelta + без forceMailUnread
- Суть/механизм: бейдж врёт до 20 с после действия пользователя
- Доказательства: статическая проверка по file:line (цикл 11, агент + ручная перепроверка); [cycle12:confirmed] handleOpenMailNotification (1827-1844) после markAsRead вызывает fetchUnreadCounts без forceMailUnread, а TTL-ветка (1191-1195) до 20 с (199) переиспользует старое mail_unread; дельту applyMailUnreadDelta никто не применяет.

### FE-0208 — Notifications: побочный эффект внутри setState-апдейтера — очередь чат-тостов
- Категория: React/Concurrency | Серьёзность: Low | Статус: Confirmed
- Файл: `WEB-itinvent/frontend/src/contexts/NotificationContext.jsx` :347-380: мутация chatSerialQueueRef в чистом апдейтере
- Суть/механизм: в StrictMode dev — дубли/потери тостов; хрупкий паттерн для concurrent
- Доказательства: статическая проверка по file:line (цикл 11, агент + ручная перепроверка); [cycle12:confirmed] Мутация chatSerialQueueRef выполняется внутри setState-апдейтера (NotificationContext.jsx:347-380); в StrictMode апдейтер может вызываться дважды, очередь меняется повторно.

### FE-0209 — Notifications: seen-маркеры не синхронизируются между вкладками → дубли уведомлений
- Категория: MultiTab/Notifications | Серьёзность: Low | Статус: Confirmed
- Файл: `WEB-itinvent/frontend/src/contexts/NotificationContext.jsx` :194-196,433-449: чтение один раз, без storage-слушателя; windowsNotifications.js read-then-write без lock
- Суть/механизм: дублирующиеся тосты/системные уведомления в мультитабе
- Доказательства: статическая проверка по file:line (цикл 11, агент + ручная перепроверка); [cycle12:confirmed] Seen-маркеры читаются один раз (NotificationContext.jsx:194-196,433-449), storage-слушателя нет; запись read-then-write без lock — две вкладки дают дубли.; [cycle13:confirmed] Seen-ids читаются из localStorage один раз при монтировании (NotificationContext.jsx:56-65,194) и дальше живут в state каждой вкладки; storage-слушателя для itinvent_hub_seen_ids нет, есть только запись (76-83,222-226). Два окна с visibilityState=visible независимо опрашивают /hub/notifications/poll и обе показывают toast, потому что проверка идёт по локальному ref (MainLayout.jsx:1479,1504-1513), а dedupeMode:'recent' работает только внутри вкладки. Системные уведомления уже дедуплицируются через общий localStorage в systemNotificationRouter (45-82), поэтому остаётся дубль именно in-app тостов.

### FE-0210 — Смена selected_database в одной вкладке молча меняет контекст остальных
- Категория: MultiTab/State | Серьёзность: Low | Статус: Rejected
- Файл: `WEB-itinvent/frontend/src/api/http.js` :248-251: X-Database-ID из localStorage на каждый запрос; storage-слушатель фильтрует только user (AuthContext.jsx:427-430)
- Суть/механизм: вкладка B шлёт новую БД со старым именем в шапке
- Доказательства: статическая проверка по file:line (цикл 11, агент + ручная перепроверка); [cycle12:not-a-defect] selected_database — намеренно общий контекст пользователя: X-Database-ID читается из localStorage на каждый запрос (http.js:248-251). Смена БД в одной вкладке обязана менять контекст остальных, отдельного per-tab состояния продукт не заявляет.

### FE-0211 — SW регистрируется по абсолютному пути; pathname-проверки игнорируют basename
- Категория: PWA/Deploy | Серьёзность: Low | Статус: Rejected
- Файл: `WEB-itinvent/frontend/src/main.jsx` :68 (register /sw.js),24-25 (pathname !== /my-files)
- Суть/механизм: при хостинге под виртуальным каталогом — промах scope / пропущенная миграционная перезагрузка
- Доказательства: статическая проверка по file:line (цикл 11, агент + ручная перепроверка); [cycle12:not-a-defect] Приложение публикуется в корень IIS-сайта (web.config в public, Vite base='/'), поэтому абсолютные /sw.js и pathname /my-files корректны; basename-деплой не поддерживается и не заявлен.

### FE-0212 — Пользователь с нулевым набором прав после логина попадает в пустой редирект
- Категория: Routing/Auth | Серьёзность: Low | Статус: Rejected
- Файл: `WEB-itinvent/frontend/src/App.jsx` :152-155,237-252: resolveFirstAccessiblePath→/login→PostAuthNavigate→Navigate на тот же путь
- Суть/механизм: пустой /login вместо осмысленного экрана/выхода
- Доказательства: статическая проверка по file:line (цикл 11, агент + ручная перепроверка); [cycle12:not-a-defect] alwaysGrantedPermissions гарантирует dashboard.read и другие базовые права (AuthContext.jsx:17-34), поэтому resolveFirstAccessiblePath не может вернуть пустой набор у аутентифицированного пользователя.

### FE-0213 — Login: преждевременный авто-submit backup-кода при length>=6 (формат 8-9 символов)
- Категория: Auth/UX | Серьёзность: Low | Статус: Confirmed
- Файл: `WEB-itinvent/frontend/src/pages/Login.jsx` :82-88,1579-1603: isCompleteBackupInput принимает >=6
- Суть/механизм: ложная ошибка «неверный код» при медленном вводе
- Доказательства: статическая проверка по file:line (цикл 11, агент + ручная перепроверка); [cycle12:confirmed] isCompleteBackupInput возвращает true для любой строки длиной >=6 (Login.jsx:82-88), авто-submit срабатывает через 650 мс (1584-1601), хотя backup-код 8-9 символов — часть кода уходит на проверку.; [cycle13:confirmed] isCompleteBackupInput возвращает true для любой строки длиной >=6 (Login.jsx:82-88), и effect на compact-viewport отправляет форму через 650 мс (1584-1601), тогда как коды генерируются 9-символьными XXXX-XXXX (twofa_service.py:149-160). При паузе после шестого символа на проверку уходит часть кода, пользователь видит ложную ошибку, а бэкенд списывает попытку в лимите 3 за 60 c (auth.py:1446-1453). Несколько таких пауз приводят к 429, поэтому дефект воспроизводим на мобильной ширине.

### FE-0214 — Layout: маркер «соединение восстановлено» теряется при StrictMode-двойном init
- Категория: React/Dev | Серьёзность: Info | Статус: Confirmed
- Файл: `WEB-itinvent/frontend/src/components/layout/MainLayout.jsx` :284: useState(consumeConnectionRestoredMarker) — инициализатор с побочным эффектом
- Суть/механизм: в dev баннер не показывается; прод корректен
- Доказательства: статическая проверка по file:line (цикл 11, агент + ручная перепроверка); [cycle12:confirmed] useState(consumeConnectionRestoredMarker) выполняет побочный эффект в инициализаторе (MainLayout.jsx:284); в StrictMode dev инициализатор вызывается дважды и маркер теряется. Production не затронут.

### FE-0215 — Почта: inline-изображение теряется из письма после autosave черновика
- Категория: DataLoss/Mail | Серьёзность: High | Статус: Confirmed
- Файл: `WEB-itinvent/frontend/src/components/mail/MailComposeHost.jsx` :524-539 + MailRichTextEditor.jsx:151-157,228-242 + mailComposeHtml.js:138-145: после saveDraftMultipart blob: отозван, DOM Quill не переписан (эффект выходит по nextValue===valueRef), buildPortableComposeHtml удаляет img как не-cid
- Суть/механизм: вставленная картинка молча выпадает при следующем autosave/отправке
- Доказательства: статическая проверка по file:line (цикл 11, агент + ручная перепроверка); [cycle12:confirmed] После autosave blob-URL inline-превью отзываются (MailComposeHost.jsx:524-539), DOM Quill не переписывается (эффект выходит по nextValue===valueRef, MailRichTextEditor.jsx:228-242), а buildPortableComposeHtml удаляет img с не-cid src (mailComposeHtml.js:138-145).; [cycle13:confirmed] Static remains confirmed; live mail check not possible: isolated stack runs MAIL_MODULE_ENABLED=0 and has no mailbox.; [cycle15:blocked] Cycle 15 mailbox investigation: local_backend forcibly sets MAIL_MODULE_ENABLED=0; no IMAP/SMTP fixture or test mailbox exists. Route-mocking can validate UI only, not server-side autosave/attachment persistence, so live check remains blocked.; [cycle17:blocked] The mail transport is Exchange EWS (backend/services/mail_service.py + mail_exchange_transport.create_exchange_account), not IMAP/SMTP. A local IMAP/SMTP fixture would not be used by the backend. The isolated stack forces MAIL_MODULE_ENABLED=0 and /mail shows the corporate-password gate; no EWS test server or test mailbox exists. Live inline-image/autosave verification remains blocked; route-mocking would be UI-only.; [cycle18:analysis] The draft path uses Exchange EWS, not IMAP/SMTP: MailDraftLifecycle.upsert_draft creates exchangelib Message(folder=account.drafts, HTMLBody, recipients), attaches FileAttachment objects (inline images are cid attachments), calls draft_item.save() (CreateItem) and save(update_fields=...) (UpdateItem); existing drafts are fetched via account.drafts/GetItem and deleted via DeleteItem. Minimal EWS contracts: GetFolder/FindFolder (Drafts), CreateItem/UpdateItem/GetItem/DeleteItem, attachment create/get, NTLM + TLS. No EWS test server exists; a full SOAP EWS double would be a separate service, not available without owner permission. A service-level mock of Account/Message could verify the HTML/attachment payload but not UI->EWS autosave/read; it would be a limited contract test, not E2E.

### FE-0216 — Почта: редактор стрипает inline-превью с data:/абсолютным URL при синхронизации значения
- Категория: DataLoss/Mail | Серьёзность: Medium | Статус: Rejected
- Файл: `WEB-itinvent/frontend/src/components/mail/MailRichTextEditor.jsx` :45-58 + mailComposeHtml.js:50-54 (REMOTE_RESOURCE_RE https?:|data:)
- Суть/механизм: если бэкенд отдаёт абсолютный inline_src/data: — восстановленные картинки исчезают
- Доказательства: статическая проверка по file:line (цикл 11, агент + ручная перепроверка); [cycle12:confirmed] REMOTE_RESOURCE_RE включает https?: и data: (mailComposeHtml.js:50-54), синхронизация значения вычищает такие img (MailRichTextEditor.jsx:45-58) — inline-превью с data:/абсолютным URL стрипается.; [cycle13:refuted] Текущий бэкенд отдаёт для inline-вложений относительный inline_src (/api/v1/mail/...), а не data: или https: (mail_reference_codec.py:333-340; mail_message_serializer.py:436-440), и compose-контекст берёт inline_src в приоритете (MailComposeHost.jsx:281-294). Синхронизация значения вычищает http(s):/data:-источники (mailComposeHtml.js:50-63,70-77), но относительный inline_src и blob:-превью переживают setQuillHtml; data: остаётся только как fallback inline_data_url, когда inline_src не построен. Удаление remote/data-картинок — намеренная защита от трекинга, закреплённая тестом (mailComposeHtml.test.js:18-26), а не потеря восстановленных превью.

### FE-0217 — Почта: localDraftDirtyRef засоряется служебными патчами → межвкладочная синхронизация черновика мертва
- Категория: MultiTab/Mail | Серьёзность: Medium | Статус: Confirmed
- Файл: `WEB-itinvent/frontend/src/components/mail/MailComposeHost.jsx` :144-152,503,527-538,547,848-853,916-926,978 + mailComposeState.js:150-161 + :465-468
- Суть/механизм: patchComposeState метит dirty на патчах сервера/прогресса → saved_at-guard никогда не доходит; last-writer-wins затирает свежий черновик соседней вкладки
- Доказательства: статическая проверка по file:line (цикл 11, агент + ручная перепроверка); [cycle12:confirmed] localDraftDirtyRef выставляется служебными патчами autosave/синхронизации (MailComposeHost.jsx:144-152,503,527-538,547,848-853,916-926,978), поэтому межвкладочная синхронизация считает черновик изменённым и не применяет чужой.

### FE-0218 — Почта: получатели письма читаются из снапшота до ожидания автосохранения — уходит старый список
- Категория: Race/Mail | Серьёзность: Medium | Статус: Confirmed
- Файл: `WEB-itinvent/frontend/src/components/mail/MailComposeHost.jsx` :782-784 (to/cc/bcc до lock) vs 802-814 (тело/вложения из sendState после)
- Суть/механизм: правка «Кому» во время ожидания черновика → письмо на старые адреса (окно ~30 с)
- Доказательства: статическая проверка по file:line (цикл 11, агент + ручная перепроверка); [cycle12:confirmed] to/cc/bcc читаются из снапшота до ожидания draftSaveInFlight (MailComposeHost.jsx:782-784), тело и вложения — из sendState после ожидания (802-814); правки получателей во время ожидания не попадут в отправку.

### FE-0219 — Почта: автодополнение получателей — searchContacts без .catch → unhandled rejection
- Категория: ErrorHandling/Mail | Серьёзность: Low | Статус: Confirmed
- Файл: `WEB-itinvent/frontend/src/components/mail/MailComposeHost.jsx` :173-181
- Суть/механизм: сбой сети → необработанный rejection, опции устаревают без уведомления
- Доказательства: статическая проверка по file:line (цикл 11, агент + ручная перепроверка); [cycle12:confirmed] searchContacts имеет только .then/.finally без .catch (MailComposeHost.jsx:173-181) — отклонённый запрос даёт unhandled rejection.

### FE-0220 — Чат: гонка подготовки файлов — guard на render-state теряет уже подготовленные файлы
- Категория: Race/Chat | Серьёзность: Medium | Статус: Confirmed
- Файл: `WEB-itinvent/frontend/src/components/chat/useChatFileSending.js` :112-119,137,202-237; аналогично applySelectedImageEdit/resetSelectedImageEdit 274-312,324-355
- Суть/механизм: два вызова до ре-рендера проходят guard; оба строят nextItems из stale → поздний перезаписывает ранний
- Доказательства: статическая проверка по file:line (цикл 11, агент + ручная перепроверка); [cycle12:confirmed] Guard подготовки файлов опирается на render-state (useChatFileSending.js:112-119,137,202-237); повторный вызов до ре-рендера теряет уже подготовленные файлы. Аналогично для image edit (274-312,324-355).

### FE-0221 — Чат: инвертированный guard touchCancel/pointerCancel → «призрачный» long-press
- Категория: Gestures/Chat | Серьёзность: Medium | Статус: Confirmed
- Файл: `WEB-itinvent/frontend/src/components/chat/useChatBubbleGestures.js` :189-199 (+таймер 93-97): resetLongPressGesture только при !mobileMessageInteractionsEnabled
- Суть/механизм: после отмены касания таймер 420 мс срабатывает на устаревшем target → ложное меню/выделение
- Доказательства: статическая проверка по file:line (цикл 11, агент + ручная перепроверка); [cycle12:confirmed] handleTouchCancel/pointerCancel сбрасывают long-press только при !mobileMessageInteractionsEnabled (useChatBubbleGestures.js:189-199), тогда как long-press активен при включённых интеракциях — «призрачный» жест.

### FE-0222 — Чат: retryFailedMessage без busy-guard → параллельные повторные отправки (файлы — полный re-upload)
- Категория: BusyGuards/Chat | Серьёзность: Medium | Статус: Confirmed
- Файл: `WEB-itinvent/frontend/src/components/chat/useChatComposerSending.js` :344-409 + useChatFileSending.js:503,538-541 (uploadAttempt не сохраняется)
- Суть/механизм: текст спасает client_message_id; файлы гоняют все чанки заново
- Доказательства: статическая проверка по file:line (цикл 11, агент + ручная перепроверка); [cycle12:confirmed] retryFailedMessage не имеет busy-guard (useChatComposerSending.js:344-409); uploadAttempt не сохраняется (useChatFileSending.js:503,538-541), повторный retry запускает параллельную отправку и полный re-upload.

### FE-0223 — Чат: отправка голосового не отменяется и не координируется с отправкой файлов
- Категория: Async/Chat | Серьёзность: Low | Статус: Confirmed
- Файл: `WEB-itinvent/frontend/src/components/chat/useChatFileSending.js` :634-651: sendVoiceFile без AbortController и вне fileUploadAbortRef/sendingFiles
- Суть/механизм: «отмена загрузки» не действует; параллельная отмена тронет не ту загрузку
- Доказательства: статическая проверка по file:line (цикл 11, агент + ручная перепроверка); [cycle12:confirmed] sendVoiceFile не использует AbortController и не входит в fileUploadAbortRef/sendingFiles (useChatFileSending.js:634-651) — голосовое нельзя отменить и оно не координируется с отправкой файлов.

### FE-0224 — Чат: chat-sticker-packs-changed перезагружает паки без guard на размонтирование
- Категория: Leaks/Chat | Серьёзность: Low | Статус: Confirmed
- Файл: `WEB-itinvent/frontend/src/components/chat/TelegramStickersTab.jsx` :156-164 vs 139-154 (первичная загрузка с cancelled)
- Суть/механизм: setState на размонтированном компоненте
- Доказательства: статическая проверка по file:line (цикл 11, агент + ручная перепроверка); [cycle12:confirmed] Обработчик chat-sticker-packs-changed перезагружает паки без cancelled/cleanup (TelegramStickersTab.jsx:156-164), в отличие от первичной загрузки (139-154).

### FE-0225 — Чат: отправка стикера — guard через render-state → возможен двойной send без client_message_id
- Категория: BusyGuards/Chat | Серьёзность: Low | Статус: Fixed-externally
- Файл: `WEB-itinvent/frontend/src/pages/chat/useChatStickerSending.js` :354-369,685-728
- Суть/механизм: два клика в одном кадре проходят; дедуп только сервером
- Доказательства: статическая проверка по file:line (цикл 11, агент + ручная перепроверка); [cycle12:fixed-externally] useChatStickerSending.js:17-26 — ref-based in-flight guard; :37-49 — client_message_id всегда → двойной send исключён ниже по стеку, дедуп есть

### FE-0226 — API: getCachedGet не принимает AbortSignal — кэшированные GET неотменяемы
- Категория: API/Async | Серьёзность: Low | Статус: Confirmed
- Файл: `WEB-itinvent/frontend/src/api/http.js` :388-419
- Суть/механизм: кэшированные справочники не отменяются при размонтировании — трафик в фоне
- Доказательства: статическая проверка по file:line (цикл 11, агент + ручная перепроверка); [cycle12:confirmed] getCachedGet не принимает signal и вызывает apiClient.get без него (http.js:388-419) — кэшированные GET неотменяемы.

### FE-0227 — Чат: video-стикер перекачивается при возврате во viewport (src+preload=auto)
- Категория: Perf/Chat | Серьёзность: Low | Статус: Confirmed
- Файл: `WEB-itinvent/frontend/src/components/chat/ChatStickerMedia.jsx` :213-227 + useChatStickerMediaActivity.js:97-111
- Суть/механизм: range-запросы webm при каждом проходе ленты
- Доказательства: статическая проверка по file:line (цикл 11, агент + ручная перепроверка); [cycle12:confirmed] Video-стикер использует src + preload=auto (ChatStickerMedia.jsx:213-227); при возврате в viewport активность снова включает загрузку (useChatStickerMediaActivity.js:97-111).

### FE-0228 — Почта: дубли файлов при повторном выборе/drag-drop в композере
- Категория: Dedup/Mail | Серьёзность: Low | Статус: Confirmed
- Файл: `WEB-itinvent/frontend/src/components/mail/MailComposeHost.jsx` :993-1007: без проверки имени/размера/lastModified
- Суть/механизм: один файл прикрепляется и отправляется дважды
- Доказательства: статическая проверка по file:line (цикл 11, агент + ручная перепроверка); [cycle12:confirmed] onDrop/onFileChange добавляют файлы без дедупликации по имени/размеру/lastModified (MailComposeHost.jsx:993-1007) — повторный выбор создаёт дубли.

### FE-0229 — Чат: контекстное меню сообщения декларирует role=menu/menuitem без клавиатурной навигации
- Категория: A11y/Chat | Серьёзность: Low | Статус: Confirmed
- Файл: `WEB-itinvent/frontend/src/components/chat/ChatMessageContextMenu.jsx` :375-509: нет ArrowUp/Down/roving tabindex
- Суть/механизм: screen reader объявляет меню без ожидаемого управления
- Доказательства: статическая проверка по file:line (цикл 11, агент + ручная перепроверка); [cycle12:confirmed] Контейнер объявляет role=menu, пункты role=menuitem (ChatMessageContextMenu.jsx:376,83,520), но обработчиков ArrowUp/Down/Home/End и roving tabindex нет.

### FE-0230 — Аккаунт: ранний return null до хуков при runtime-флаге Desktop → крах рендера «Rendered fewer hooks»
- Категория: React/Hooks | Серьёзность: High | Статус: Suspected
- Файл: `WEB-itinvent/frontend/src/pages/account/settings/notifications/ChatNotificationsSettingsCard.jsx` :36 (if(isNativeShellRuntime()) return null до хуков 38-117); ChatNotificationsSettingsCard.jsx:30; platform.js:14-16; desktopBridge.js:905-907 (bridgeReady асинхронный)
- Суть/механизм: при готовности моста WebView2 карточка возвращает null до хуков → React crash страницы настроек в HUB Desktop; вспышка PWA-карточки в десктопе
- Доказательства: статическая проверка по file:line (цикл 11, агент + ручная перепроверка); [cycle12:confirmed] High, ручная проверка: isNativeShellRuntime() возвращает null до хуков (HubItPwaSettingsCard.jsx:36-38; ChatNotificationsSettingsCard.jsx:30-32, файл переехал в pages/account/settings/notifications/). Флаг зависит от асинхронного desktopBridgeReady (platform.js:14-16), поэтому смена false→true меняет число хуков и роняет рендер.; [cycle13:confirmed] Static remains confirmed; live simulation with a late desktop.hostReady on the isolated stand did not reproduce a hooks error (card subtree unmounted on re-render), so live reproduction is inconclusive.; [cycle15:blocked] Cycle 15 Desktop investigation: C# DesktopBridgeHost sends hostReady only after WebView2 bridge initialization; no Windows Desktop host/build is available in this audit, and browser simulation is not a valid WebView2 proof. Need a real WebView2 host with delayed CoreWebView2 init.; [cycle17:live] Real Windows WebView2 host: HUB.Desktop PerfBench build from b95c4cac, WebView2 157.0.4341.60, isolated profile, local stand. The desktop.ready handshake was delayed 8 s (test condition), then /settings/notifications was loaded. The card "Фоновая доставка чатов" mounted with shell=null; at the hostReady flip the "Обновить фоновую доставку" button was clicked synchronously. Result: shell=true, no pageerror/console error; the parent unmounted the card. Live crash not reproduced in this path.; [cycle18:static] Hooks before the early return: useTheme, useMemo, useAuth, useNotification, useState x2, useEffect x2, useCallback (9). With isNativeShellRuntime() true the component returns before all 9. AccountWorkspace renders the card only when !nativeShell; MainLayout handles DESKTOP_CAPABILITIES_CHANGED_EVENT via setDesktopActionsAvailable, so the capabilities message after hostReady re-renders the tree and removes the card. ChatNotificationsSettingsCard does not subscribe to hostReady; no synchronous card-local update on the flip.; [cycle18:live-negative] Real Windows WebView2 host (cycle 17 evidence): desktop.ready delayed 8 s, card mounted with shell=null, update button clicked synchronously at hostReady. No pageerror/console error; the parent unmounted the card. This is a negative live result, not proof that the defect is absent.

### FE-0231 — Аккаунт: isAdmin в useAccountSectionData без toLowerCase → пустые admin-разделы при роли «Admin»
- Категория: Permissions/Admin | Серьёзность: Medium | Статус: Rejected
- Файл: `WEB-itinvent/frontend/src/pages/account/hooks/useAccountSectionData.js` :69 (=== 'admin' без нормализации) vs accountNavigationConfig.jsx:161-163 (toLowerCase), UserDraftFields.jsx:39
- Суть/механизм: роут-гейт и навигация показывают разделы, а canManage*/loadEnv/loadAppSettings молча выходят — пустые админ-вкладки
- Доказательства: статическая проверка по file:line (цикл 11, агент + ручная перепроверка); [cycle12:not-a-defect] user.role нормализуется в нижний регистр в normalizeUserWithPermissions (AuthContext.jsx:134) до попадания в useAccountSectionData (строка 69); значение «Admin» в этот хук не приходит.

### FE-0232 — Аккаунт: падение bulk-загрузки делегатов → сохранение пользователя стирает все связи помощник/зам
- Категория: DataLoss/Admin | Серьёзность: High | Статус: Confirmed
- Файл: `WEB-itinvent/frontend/src/pages/account/hooks/useAccountSectionData.js` :244-251 (catch→merge с items:[] + console.error),637-644 (updateTaskDelegates из черновика); accountUserModel.js:27-39
- Суть/механизм: временный сбой одного эндпоинта → при любом сохранении карточки связи удаляются на сервере без предупреждения
- Доказательства: статическая проверка по file:line (цикл 11, агент + ручная перепроверка); [cycle12:confirmed] High, ручная проверка: при ошибке bulk-загрузки делегатов users остаются с task_delegate_links=[] (useAccountSectionData.js:244-251, accountUserModel.js:27-39); сохранение пользователя отправляет этот пустой список в updateTaskDelegates (637-644) и стирает связи.; [cycle13:confirmed] Static remains confirmed; live account-admin race not executed in cycle 13 (no test-data mutation outside throwaway stack).; [cycle15:blocked] Cycle 15 account fixtures not prepared; no approved mutation of delegate links in the isolated DB. Static catch->empty merge->save chain remains confirmed.; [cycle17:live] Synthetic users in isolated DB: owner 11 with delegate 12. Injected GET /auth/task-delegates 500 on page load; opened owner in admin, the delegate was absent from the drawer; Save sent PUT /auth/users/11/task-delegates {"items":[]} and the bulk link count went 1 -> 0. Control without injection: delegate present, Save kept 1 -> 1. Data loss reproduced; persistence checked on the real backend.; [cycle18:live] Strict regression test (11 checks, exit 0): cleared links 0; seeded 1; injected bulk 500 -> drawer hides delegate; Save PUT items:[]; links 1 -> 0; reseeded 1; control without injection -> drawer shows delegate, PUT items:1, links 1 -> 1. Script audit/frontend/evidence/cycle18/fe0232-delegates.cjs.

### FE-0233 — Аккаунт: частичный успех create/update пользователя показывается как полный провал
- Категория: ErrorHandling/Admin | Серьёзность: Medium | Статус: Confirmed
- Файл: `WEB-itinvent/frontend/src/pages/account/hooks/useAccountSectionData.js` :586-605,636-666: user создан/обновлён, но падение updateTaskDelegates → «Не удалось создать/обновить» + ok:false
- Суть/механизм: повторный «Сохранить» → 409 duplicate или повторный PUT; делегаты теряются
- Доказательства: статическая проверка по file:line (цикл 11, агент + ручная перепроверка); [cycle12:confirmed] Пользователь создан/обновлён, затем падение updateTaskDelegates уходит в общий catch и возвращает ok:false с текстом «Не удалось создать/обновить» (useAccountSectionData.js:586-605,636-666) — частичный успех показан как полный провал.

### FE-0234 — Аккаунт: удаление пользователя без busy-guard → повторный DELETE и ложная 404-ошибка
- Категория: BusyGuards/Admin | Серьёзность: Medium | Статус: Confirmed
- Файл: `WEB-itinvent/frontend/src/pages/account/admin/UsersTab.jsx` :592-618 (кнопка не disabled) + useAccountSectionData.js:672-686 (нет deleting-state)
- Суть/механизм: двойной клик → ложный тост «Не удалось удалить», диалог остаётся
- Доказательства: статическая проверка по file:line (цикл 11, агент + ручная перепроверка); [cycle12:confirmed] Кнопка удаления в диалоге не disabled во время запроса (UsersTab.jsx:601-617), handleDeleteUser не имеет deleting-state (useAccountSectionData.js:672-686) — повторный DELETE даёт 404 и ложную ошибку.

### FE-0235 — Аккаунт: тихие отказы валидации в handleSaveDraft — «Сохранить» ничего не делает без объяснения
- Категория: Validation/Admin | Серьёзность: Medium | Статус: Confirmed
- Файл: `WEB-itinvent/frontend/src/pages/account/admin/UsersTab.jsx` :208-210: username<3, нецелый telegram_id, невалидная квота → return без подсветки
- Суть/механизм: админ не понимает причину неработающей кнопки
- Доказательства: статическая проверка по file:line (цикл 11, агент + ручная перепроверка); [cycle12:confirmed] handleSaveDraft делает return при username<3, нецелом telegram_id или невалидной квоте без подсветки полей (UsersTab.jsx:208-210) — «Сохранить» молчит.

### FE-0236 — Аккаунт: завершение сессии без подтверждения, включая собственную сессию админа
- Категория: UX/Admin | Серьёзность: Medium | Статус: Confirmed
- Файл: `WEB-itinvent/frontend/src/pages/account/admin/SessionsTab.jsx` :149-156: onTerminate из меню строки, без диалога и маркировки текущей сессии
- Суть/механизм: один клик → мгновенный логаут себя или чужой сессии
- Доказательства: статическая проверка по file:line (цикл 11, агент + ручная перепроверка); [cycle12:confirmed] Завершение сессии из меню строки вызывает onTerminate без confirm (SessionsTab.jsx:149-156); текущая сессия не помечена.

### FE-0237 — Аккаунт: массовые операции над сессиями без подтверждения (несогласованно с normalize+confirm)
- Категория: UX/Admin | Серьёзность: Medium | Статус: Confirmed
- Файл: `WEB-itinvent/frontend/src/pages/account/admin/SessionsTab.jsx` :44-60 (Очистить устаревшие/Удалить неактивные без confirm) vs useAccountSectionData.js:749-753 (normalize с confirm)
- Суть/механизм: массовое закрытие сессий одним случайным кликом
- Доказательства: статическая проверка по file:line (цикл 11, агент + ручная перепроверка); [cycle12:confirmed] «Очистить устаревшие»/«Удалить неактивные» выполняются без подтверждения (SessionsTab.jsx:44-60), тогда как normalize использует confirm (useAccountSectionData.js:749-753).

### FE-0238 — Аккаунт: loadingMore навсегда застревает при гонке loadMore↔reload — пагинация ломается
- Категория: Race/Admin | Серьёзность: Medium | Статус: Confirmed
- Файл: `WEB-itinvent/frontend/src/pages/account/admin/FeedbackAdminSection.jsx` :133-151 (reload бампает requestRef),157-173 (finally сбрасывает loadingMore только при совпадении requestId)
- Суть/механизм: смена фильтра во время «Показать ещё» → кнопка навсегда disabled
- Доказательства: статическая проверка по file:line (цикл 11, агент + ручная перепроверка); [cycle12:confirmed] reload бампает requestRef (FeedbackAdminSection.jsx:133-151), а finally сбрасывает loadingMore только при совпадении requestId (157-173) — при гонке флаг залипает.

### FE-0239 — Аккаунт: гонка loadMembers между отделами → «Сохранить начальников» пишет роли в чужой отдел
- Категория: DataLoss/Admin | Серьёзность: High | Статус: Confirmed
- Файл: `WEB-itinvent/frontend/src/pages/account/admin/DepartmentsTab.jsx` :58-89 (loadMembers без seq-guard),129-142 (handleSaveManagers шлёт draftManagerIds в selectedDepartmentId)
- Суть/механизм: быстрый A→B → ответ по A перезаписывает memberships/draftManagerIds → роли отдела A уходят в отдел B
- Доказательства: статическая проверка по file:line (цикл 11, агент + ручная перепроверка); [cycle12:confirmed] High, ручная проверка: loadMembers без seq-guard (DepartmentsTab.jsx:58-89) может применить ответ старого отдела; handleSaveManagers отправляет draftManagerIds в текущий selectedDepartmentId (129-142).; [cycle13:confirmed] Static remains confirmed; live department-manager race not executed in cycle 13.; [cycle15:blocked] Cycle 15 department/user fixtures not prepared; no approved mutation. Static race remains confirmed.; [cycle17:live] Two synthetic departments: D1 managers [11], D2 managers [13]. D1 members GET delayed 3.2 s; selected D1 then quickly D2. The late D1 response overwrote draftManagerIds while D2 was selected; Save sent PUT /departments/D2/managers {"manager_user_ids":[11]}. After: D2 managers [11], D1 unchanged [11]. Wrong-department write reproduced on the real backend.; [cycle18:live] Strict regression test (8 checks, exit 0): D1 [14], D2 [16] before; delayed D1 members response applied while D2 selected (UI shows D1 owner/delegate); Save PUT /departments/D2/managers {"manager_user_ids":[14]}; after D1 [14], D2 [14]. Script audit/frontend/evidence/cycle18/fe0239-departments.cjs.

### FE-0240 — Аккаунт: loadLookups без seq-защиты → устаревшие справочники под новой базой
- Категория: Race/Admin | Серьёзность: Medium | Статус: Confirmed
- Файл: `WEB-itinvent/frontend/src/pages/account/admin/ItinventReferencesTab.jsx` :349-364 (нет loadSeq в отличие от loadRows 328-345)
- Суть/механизм: создание записи с чужими id типов/производителей при быстрой смене БД
- Доказательства: статическая проверка по file:line (цикл 11, агент + ручная перепроверка); [cycle12:confirmed] loadLookups не имеет loadSeq, в отличие от loadRows (ItinventReferencesTab.jsx:328-364) — устаревший ответ может перезаписать справочники новой базы.

### FE-0241 — Аккаунт: гонка openDelete — usage другой записи в диалоге удаления
- Категория: Race/Admin | Серьёзность: Medium | Статус: Confirmed
- Файл: `WEB-itinvent/frontend/src/pages/account/admin/ItinventReferencesTab.jsx` :452-464 (openDelete без seq),220,252 (disabled по usage)
- Суть/механизм: диалог для B показывает проверку A → лишний запрет или попытка удалить используемое
- Доказательства: статическая проверка по file:line (цикл 11, агент + ручная перепроверка); [cycle12:confirmed] openDelete не защищён seq-проверкой (ItinventReferencesTab.jsx:452-464), usage приходит асинхронно; диалог может показать usage другой записи (220,252).

### FE-0242 — Аккаунт: сброс графика работы филиала без подтверждения
- Категория: UX/Admin | Серьёзность: Medium | Статус: Confirmed
- Файл: `WEB-itinvent/frontend/src/pages/account/admin/WorkSchedulesAdminSection.jsx` :158-170,293-299: иконка сразу вызывает reset→deleteSchedule
- Суть/механизм: случайное удаление настроек рабочего времени
- Доказательства: статическая проверка по file:line (цикл 11, агент + ручная перепроверка); [cycle12:confirmed] Иконка сброса сразу вызывает reset→deleteSchedule без confirm (WorkSchedulesAdminSection.jsx:158-170,293-299).

### FE-0243 — Аккаунт: «Обновить»/повторный вход в раздел стирает несохранённые правки .env
- Категория: DataLoss/Admin | Серьёзность: Medium | Статус: Confirmed
- Файл: `WEB-itinvent/frontend/src/pages/account/admin/EnvVariablesTab.jsx` :39-46 (эффект сбрасывает draftValues на новый items),232 (onRefresh без dirtyCount) + useAccountSectionData.js:400-404
- Суть/механизм: один клик «Обновить» → потеря всех правок без предупреждения
- Доказательства: статическая проверка по file:line (цикл 11, агент + ручная перепроверка); [cycle12:confirmed] Эффект сбрасывает draftValues на новый items (EnvVariablesTab.jsx:39-46), onRefresh не учитывает dirtyCount (232) — несохранённые правки .env теряются.

### FE-0244 — Аккаунт: черновик IP-allowlist стирается сохранением соседней карточки
- Категория: DataLoss/Admin | Серьёзность: Medium | Статус: Confirmed
- Файл: `WEB-itinvent/frontend/src/pages/account/admin/AdminLoginAllowlistSettingsCard.jsx` :24-32 (useEffect по currentIps-новому массиву) + appSettingsModel.js:18 + TransferActReminderSettingsCard.jsx:85
- Суть/механизм: сохранение reminder-карточки молча сносит набранный allowlist
- Доказательства: статическая проверка по file:line (цикл 11, агент + ручная перепроверка); [cycle12:confirmed] useEffect по новому массиву currentIps перезаписывает черновик IP-allowlist (AdminLoginAllowlistSettingsCard.jsx:24-32) при сохранении соседней карточки.

### FE-0245 — Аккаунт: псевдо-автосохранение групп паролей затирается любым рефрешем
- Категория: DataLoss/Admin | Серьёзность: Medium | Статус: Confirmed
- Файл: `WEB-itinvent/frontend/src/pages/account/hooks/useAccountSectionData.js` :845-856 (autosave→return true БЕЗ запроса) + PasswordVaultGroupsSettingsCard.jsx:69,78,29,92
- Суть/механизм: иллюзия автосохранения — правки исчезают при «Обновить»/переходе
- Доказательства: статическая проверка по file:line (цикл 11, агент + ручная перепроверка); [cycle12:confirmed] autosave обновляет только локальный state и возвращает true без запроса (useAccountSectionData.js:845-856); любой loadPasswordGroups затирает псевдо-сохранение серверными значениями.

### FE-0246 — Аккаунт: раздел «Пользователи AD» доступен по ad_users.read, но эндпоинты admin-only → гарантированный 403
- Категория: Permissions/Admin | Серьёзность: Medium | Статус: Confirmed
- Файл: `WEB-itinvent/frontend/src/pages/AdUsers.jsx` :88-94 (ad_users.read) vs AdUsers.jsx:135,152-154 (getImportCandidates) vs backend ad_users.py:79-86 (admin-only)
- Суть/механизм: нерабочий пункт меню для держателей ad_users.read
- Доказательства: статическая проверка по file:line (цикл 11, агент + ручная перепроверка); [cycle12:confirmed] Навигация пускает по ad_users.read (accountNavigationConfig.jsx:88-94), а getImportCandidates и другие эндпоинты требуют get_current_admin_user (backend/api/v1/ad_users.py:79-86 и далее) — гарантированный 403 для не-админа с этим правом.

### FE-0247 — Аккаунт: шесть загрузчиков хука без seq/unmount-защиты (databases/env/appSettings/passwordGroups/aiBots/security)
- Категория: Race/Admin | Серьёзность: Medium | Статус: Confirmed
- Файл: `WEB-itinvent/frontend/src/pages/account/hooks/useAccountSectionData.js` :202-217,283-302,304-317,319-332,334-361,363-376 (защищены только beginUsers/beginSessions 219-281)
- Суть/механизм: setState после unmount; ответ старого запроса перезаписывает свежий
- Доказательства: статическая проверка по file:line (цикл 11, агент + ручная перепроверка); [cycle12:confirmed] Шесть загрузчиков (databases/env/appSettings/passwordGroups/aiBots/security) не имеют seq/unmount-защиты (useAccountSectionData.js:202-217,283-376), защищены только beginUsers/beginSessions (219-281).

### FE-0248 — Аккаунт: MyFilesStats.load без seq-защиты → старый поиск перезаписывает новый
- Категория: Race/Admin | Серьёзность: Medium | Статус: Confirmed
- Файл: `WEB-itinvent/frontend/src/pages/account/admin/MyFilesAdminTab.jsx` :111-125,129-132,140,204
- Суть/механизм: таблица показывает статистику под чужой запрос
- Доказательства: статическая проверка по file:line (цикл 11, агент + ручная перепроверка); [cycle12:confirmed] MyFilesStats.load не имеет seq-защиты (MyFilesAdminTab.jsx:111-125,129-132,140,204) — ответ старого поиска может перезаписать новый.

### FE-0249 — Аккаунт: confirm «Отключить ящик…» при фактическом удалении ящика
- Категория: UX/Admin | Серьёзность: Low | Статус: Confirmed
- Файл: `WEB-itinvent/frontend/src/pages/account/profile/ProfileTab.jsx` :311-314: текст «Отключить», а deleteMailbox удаляет
- Суть/механизм: непреднамеренное удаление подключённого ящика
- Доказательства: статическая проверка по file:line (цикл 11, агент + ручная перепроверка); [cycle12:confirmed] Confirm удаления ящика говорит «Отключить ящик» (ProfileTab.jsx:311), но вызывает mailAPI.deleteMailbox (313); рядом есть отдельное действие «Отключить» (469).

### FE-0250 — Аккаунт: test-only resolveAvailableSettingsTabs и избыточный adminOnlyFallback
- Категория: Architecture/DeadCode | Серьёзность: Info | Статус: Confirmed
- Файл: `WEB-itinvent/frontend/src/pages/account/accountConstants.jsx` :32-40
- Суть/механизм: ложная сложность конфигурации
- Доказательства: статическая проверка по file:line (цикл 11, агент + ручная перепроверка); [cycle12:wrong-evidence] adminOnlyFallback не мёртв: он используется в getAvailableAdminSections (accountNavigationConfig.jsx:179). Подтверждается только вторая часть — resolveAvailableSettingsTabs встречается лишь в тесте SettingsAiBots.test.jsx.; [cycle13:confirmed] Подтверждается вторая половина: resolveAvailableSettingsTabs (accountConstants.jsx:32-40) вместе со всем SETTINGS_TABS используется только тестом SettingsAiBots.test.jsx:26-57 и в рантайме не вызывается. adminOnlyFallback формально не мёртв — он читается в accountNavigationConfig.jsx:179, — но эффекта не даёт: для admin строка 180 всё равно вернёт true, а для ad-users срабатывает ветка permissions (176-178); флаг можно удалить без изменения поведения. Пользовательского дефекта здесь нет, это мёртвый код и лишняя конфигурация, поэтому severity следует понизить с Low до Info и отдельно решить судьбу теста мёртвой функции.

### FE-0251 — Аккаунт: пакет пропусков подтверждений/гардов (avatar delete, mailbox busy, AiBalance threshold wipe, Enter-during-saving, syncFromAD, shared savingBotId, NaN fontScale)
- Категория: Guards/Admin | Серьёзность: Low | Статус: Confirmed
- Файл: `WEB-itinvent/frontend/src/pages/account/profile/ProfileTab.jsx` :150,282-307; AiBalanceCard.jsx:42-45,95; MyFilesAdminTab.jsx:58-60,88-95; DepartmentsTab.jsx:144-159; BotSettingsWorkspace.jsx:48+useAccountSectionData.js:925,955; AppearanceTab.jsx:63+useAccountSectionData.js:113
- Суть/механизм: совокупность мелких дефектов: удаление аватара без confirm, затирание порога при check, повторный PATCH по Enter во время saving, syncFromAD без confirm, параллельные save ботов, NaN в слайдере
- Доказательства: статическая проверка по file:line (цикл 11, агент + ручная перепроверка); [cycle12:confirmed] Пакет подтверждён по перечисленным точкам: удаление аватара/ящика без busy-guard, сброс порога AiBalance, Enter во время сохранения, syncFromAD и общий savingBotId, NaN fontScale (ProfileTab.jsx:150,282-307; AiBalanceCard.jsx:42-45,95; MyFilesAdminTab.jsx:58-60,88-95; DepartmentsTab.jsx:144-159; BotSettingsWorkspace.jsx:48; AppearanceTab.jsx:63).

### FE-0252 — Database: горизонтальное переполнение ~400px при масштабе 200%
- Категория: UX/Zoom | Серьёзность: Medium | Статус: Confirmed
- Файл: `WEB-itinvent/frontend/src/pages/Database.jsx` :страница /database
- Суть/механизм: замер в Chrome 1920x1080 + zoom 200%: docW=2320 против vw=1920 (+400px); /mail /tasks /help чисто при 150/200%
- Доказательства: runtime-замер локального стека (цикл 11); [cycle12:confirmed] Runtime-замер цикла 11: /database при масштабе 200% даёт горизонтальное переполнение ~400px; фиксированного overflow-контейнера нет.

### FE-0253 — JS heap растёт при повторных переключениях страниц: 85→85→143MB за 3 раунда по 8 маршрутов
- Категория: Perf/Memory | Серьёзность: Medium | Статус: Rejected
- Файл: `WEB-itinvent/frontend/src` :роутинг
- Суть/механизм: CDP usedJSHeapSize после каждого раунда goto×8: +58MB на 3-м раунде; возможна легитимная инерция кэша чанков — нужен более длинный прогон/GC-профиль
- Доказательства: runtime-замер локального стека (цикл 11); [cycle12:unverifiable] Замер 85→85→143MB не контролирует GC и не воспроизводился повторно; утечка конкретного слушателя/кэша не локализована.; [cycle13:unverifiable] Замер probe_wave3.mjs:24-31 шёл hard-goto по 8 маршрутам, читал performance.memory.usedJSHeapSize сразу после 1.2 с ожидания и ни разу не вызывал HeapProfiler.collectGarbage, поэтому +58 МБ на третьем раунде неотличимы от отложенной сборки мусора и кэша скомпилированного кода. Hard-навигация уничтожает JS-realm, так что React-состояние, листенеры и модульные кэши между раундами копиться не могут, а общие кэши в коде ограничены (swrCache — 80 записей, ChatLinkPreview — 300, chatHelpers — 4000 с очисткой). Решает прогон 10+ раундов с HeapProfiler.collectGarbage перед каждым чтением: плоский post-GC тренд означает GC-шум, монотонный рост — утечку, а heap snapshot diff с retainer-путями локализует объект. Пока такого замера нет, утечка не доказана, но и не исключена: исходный тест SPA-переходы вообще не проверял.; [cycle14:refuted] Cycle 13/14 memory probe: 12 rounds x 8 routes with forced GC; heap 37.1→51 plateau→23.3 after full GC; no monotonic growth.

### FE-0254 — hubit://open/dashboard protocol launch вызывает console-ошибку в обычном браузере
- Категория: UX/Desktop | Серьёзность: Info | Статус: Confirmed
- Файл: `WEB-itinvent/frontend/src/lib/desktopProtocolHandoff.js` :запуск hubit:// при загрузке
- Суть/механизм: Chrome логирует «Failed to launch ... no registered handler» при каждой загрузке — шум в консоли, по сути детект Desktop-моста
- Доказательства: runtime-замер локального стека (цикл 11); [cycle12:confirmed] Запуск hubit://open/dashboard в обычном браузере даёт console-ошибку (desktopProtocolHandoff.js); это Info, на функциональность веб-версии не влияет.

### FE-0255 — Чат: revealMessage().then без .catch — unhandled rejection при падении поиска сообщения
- Категория: ErrorHandling/Chat | Серьёзность: Low | Статус: Confirmed
- Файл: `WEB-itinvent/frontend/src/pages/chat/useChatActiveConversationLifecycleEffects.js` :129: void revealMessage().then((found)=>...) без .catch
- Суть/механизм: сетевой сбой reveal → unhandled rejection; revealKey не ставится
- Доказательства: статическая проверка по file:line (цикл 11, ручная); [cycle12:confirmed] void revealMessage().then(...) без .catch (useChatActiveConversationLifecycleEffects.js:129) — ошибка поиска сообщения даёт unhandled rejection.

### FE-0256 — Voice: loadMeetings().then без .catch в эффекте фильтров
- Категория: ErrorHandling/Voice | Серьёзность: Low | Статус: Rejected
- Файл: `WEB-itinvent/frontend/src/pages/voice-video/VoiceVideoPage.jsx` :495: .then((ok)=>{if(ok===true)loadExportCount()}) без catch
- Суть/механизм: если loadMeetings бросит (не вернёт ok) → unhandled rejection
- Доказательства: статическая проверка по file:line (цикл 11, ручная); [cycle12:confirmed] loadMeetings().then(...) в эффекте фильтров без .catch (VoiceVideoPage.jsx:495); loadExportCount тоже не обрабатывает отказ.; [cycle13:refuted] loadMeetings не бросает: весь запрос обёрнут в try/catch, ошибка кладётся в errors.meetings и возвращается false (170-206), поэтому .then без .catch в эффекте фильтров (495-497) не создаёт unhandled rejection. loadExportCount также сам ловит ошибку, выставляет exportCountError и возвращает false (208-229), после чего флаг передаётся в дочерний компонент (805-806); описанной необработанной ошибки нет.

### FE-0257 — mobileOfflineCache: JSON.parse расшифрованного payload без обработки повреждённой записи
- Категория: ErrorHandling/Cache | Серьёзность: Low | Статус: Rejected
- Файл: `WEB-itinvent/frontend/src/lib/mobileOfflineCache.js` :192: decryptPayload → JSON.parse без try
- Суть/механизм: битая запись в IndexedDB → reject во всех потребителях кэша
- Доказательства: статическая проверка по file:line (цикл 11, ручная); [cycle12:confirmed] JSON.parse расшифрованного payload без try/catch (mobileOfflineCache.js:192) — повреждённая запись роняет чтение кэша.; [cycle13:refuted] JSON.parse находится в decryptPayload (mobileOfflineCache.js:185-193), но его единственный вызов — внутри getCachedMobileGetResponse, где decrypt и parse обёрнуты в try/catch с возвратом null при любой ошибке (337-369). Повреждённая или нерасшифровываемая запись превращается в cache miss, а не в reject у потребителей; inventory записи не расшифровывает (407-440). Описанного падения чтения кэша в текущем коде нет.

### FE-0258 — Чат: decodeTgsPayload JSON.parse без fallback — битый TGS-стикер
- Категория: ErrorHandling/Chat | Серьёзность: Low | Статус: Rejected
- Файл: `WEB-itinvent/frontend/src/components/chat/ChatStickerMedia.jsx` :35: JSON.parse(strFromU8(jsonBytes))
- Суть/механизм: невалидный/gzip-TGS → reject; поведение зависит от catch вызывающего
- Доказательства: статическая проверка по file:line (цикл 11, ручная); [cycle12:confirmed] decodeTgsPayload делает JSON.parse(strFromU8(jsonBytes)) без fallback (ChatStickerMedia.jsx:35); битый TGS даёт исключение.; [cycle13:refuted] JSON.parse в decodeTgsPayload не обёрнут локально, но вызывается внутри try/catch эффекта загрузки (ChatStickerMedia.jsx:109-138): SyntaxError перехватывается, выставляется loadFailed и рендерится fallback-эмодзи (189-197). Битый TGS не роняет компонент, не даёт unhandled rejection и не ломает экран чата; gzip определяется по сигнатуре байтов (:34). Пользовательского дефекта нет.

### FE-0259 — Construction-workspace: нет beforeunload — черновики дневной сводки и недельного плана теряются при F5/закрытии
- Категория: DataLoss/Construction | Серьёзность: High | Статус: Confirmed
- Файл: `WEB-itinvent/frontend/src/components/construction/ConstructionWorkWorkspace.jsx` :dirty/useConstructionWorkLeaveGuard(dirty||saving) без beforeunload; в Panel.jsx:163-168 и TaskCanvasWorkspace.jsx:342-350 он есть
- Суть/механизм: потеря несохранённой сводки/плана/посещаемости молча
- Доказательства: статическая проверка по file:line (цикл 11, агент Tasks/Construction/Company); [cycle12:confirmed] High, ручная проверка: ConstructionWorkWorkspace использует только SPA-guard useConstructionWorkLeaveGuard (строка 41), beforeunload нет; в ConstructionWorkPanel.jsx:165-167 и TaskCanvasWorkspace.jsx:348-349 он есть. F5/закрытие теряет черновик.; [cycle13:confirmed] Static remains confirmed; live construction-workspace check blocked: local stack has no 1C/SQL construction data.; [cycle15:blocked] Cycle 15 mocked construction attempt reached the page but the workspace requires a configured object/direction («сначала настройте объект»); mocked planning alone is insufficient. F5/close/unmount still blocked by missing configured construction fixture.; [cycle17:live] Created a managed construction object with a GUID direction in the isolated DB, added a work via the UI (plan saved to the backend, visible after reload), switched to "Сводка за день", entered 5 in "За день" (dirty, "Сохранить сводку" shown). F5 reload: no beforeunload dialog; after reload the value is empty and the dirty UI is gone. The weekly/day draft is lost without a prompt; the route-level leave guard covers SPA navigation but not reload/close.; [cycle18:live] Strict regression test (11 checks, exit 0) on a synthetic managed object: work plan PUT 200 and persisted in planning API after reload; daily summary dirty ("Сохранить сводку") -> F5 without beforeunload -> value "" and dirty UI gone; weekly plan target dirty ("Сохранить план недели") -> F5 without beforeunload -> value "" and dirty UI gone. Script audit/frontend/evidence/cycle18/fe0259-construction.cjs.

### FE-0260 — Construction: data.items.find(id).version без fallback → TypeError при числовом id/исчезнувшем item
- Категория: ErrorHandling/Construction | Серьёзность: Medium | Статус: Rejected
- Файл: `WEB-itinvent/frontend/src/components/construction/ConstructionWorkPanel.jsx` :193-195; аналог в save workspace
- Суть/механизм: Object.entries(draft) ключи — строки; числовой i.id → undefined.version → generic-ошибка, черновик «залипает»
- Доказательства: статическая проверка по file:line (цикл 11, агент Tasks/Construction/Company); [cycle12:confirmed] data.items.find(i => i.id === id).version без optional chain (ConstructionWorkWorkspace.jsx:76); при числовом id или исчезнувшем item — TypeError. Аналогично в save workspace.; [cycle13:refuted] ID работ — UUID-строки (appdb/models.py:117, construction_work_service.py:188-196), а daily/attendance наполняются ключами из тех же data.items (69, 182-188), поэтому строгое сравнение i.id === id совпадает. data не перезагружается, пока есть dirty (44), а «Обновить» и смена режима заблокированы при dirty (110-114); исчезнувшая работа приводит к 409 от сервера, а не к TypeError. Числовой id и пропавший item в текущем контракте недостижимы.

### FE-0261 — Construction-panel: эффект перезагрузки при смене scope не проверяет dirty → осиротевшие ключи черновика
- Категория: State/Construction | Серьёзность: Medium | Статус: Rejected
- Файл: `WEB-itinvent/frontend/src/components/construction/ConstructionWorkPanel.jsx` :157-160 (нет if(dirty) return в отличие от workspace)
- Суть/механизм: setData(null)+load() при живом draft → stale-черновик поверх нового scope
- Доказательства: статическая проверка по file:line (цикл 11, агент Tasks/Construction/Company); [cycle12:confirmed] Эффект перезагрузки при смене scope в ConstructionWorkPanel.jsx:157-160 не проверяет dirty, в отличие от workspace (44) — осиротевшие ключи черновика.; [cycle13:refuted] Дата учёта в панели заблокирована при dirty || saving (239), а objectId/groupRef меняются только через страницу, где workspace принудительно перемонтируется ключом key={`${objectId}:${groupRef}`} (ConstructionDirectionDetail.jsx:724). Поэтому эффект 157-160 не может сменить scope при непустом черновике; сценарий осиротевших ключей в текущем UI недостижим.

### FE-0262 — Tasks: закрытие диалога создания молча стирает выбранные файлы и чек-лист (несогласованно с createData)
- Категория: DataLoss/Tasks | Серьёзность: Medium | Статус: Confirmed
- Файл: `WEB-itinvent/frontend/src/pages/tasks/hooks/useTaskCreateForm.js` :343-357 (Escape/backdrop/X чистит createFiles/createChecklistItems); useTaskEditForm.js:90-91 (pending-файлы чистятся на editOpen)
- Суть/механизм: тихая потеря выбранных файлов/чек-листа при случайном закрытии
- Доказательства: статическая проверка по file:line (цикл 11, агент Tasks/Construction/Company); [cycle12:confirmed] handleCloseCreateDialog очищает createFiles и createChecklistItems (useTaskCreateForm.js:343-357); Escape/backdrop/X вызывают его без подтверждения.

### FE-0263 — Tasks: workflow-конфликт по задаче B перебивает открытую деталь задачи A (detailsTask=B)
- Категория: State/Tasks | Серьёзность: Medium | Статус: Rejected
- Файл: `WEB-itinvent/frontend/src/pages/tasks/hooks/useTaskWorkflowActions.js` :43-55 → useTaskDetails.jsx:187-200: handleWorkflowConflict зовёт loadTaskDetails для любой конфликтной задачи
- Суть/механизм: панель и URL/выделение расходятся — детали показывают чужую задачу
- Доказательства: статическая проверка по file:line (цикл 11, агент Tasks/Construction/Company); [cycle12:confirmed] handleWorkflowConflict вызывает loadTaskDetails для конфликтной задачи (useTaskWorkflowActions.js:43-55 → useTaskDetails.jsx:187-200), подменяя открытую деталь задачи A на B.; [cycle13:refuted] При открытой детали задачи список полностью скрыт display:none (Tasks.jsx:72-83), поэтому действия над другой задачей B в этот момент недоступны: меню действий живёт только в TasksListLayout (135) и открывает диалоги для выбранной задачи. Конфликт обрабатывается для id текущей задачи (useTaskWorkflowActions.js:43-55), и loadTaskDetails перезагружает ту же карточку, а не подменяет A на B.

### FE-0264 — Tasks: loadTaskActivity глотает ошибку пустым catch — лента активности молча пуста
- Категория: ErrorHandling/Tasks | Серьёзность: Medium | Статус: Confirmed
- Файл: `WEB-itinvent/frontend/src/pages/tasks/hooks/useTaskDetails.jsx` :180-181: catch{} без индикации
- Суть/механизм: вкладка выглядит «без истории» при сетевом сбое
- Доказательства: статическая проверка по file:line (цикл 11, агент Tasks/Construction/Company); [cycle12:confirmed] loadTaskActivity имеет пустой catch (useTaskDetails.jsx:180-181) — лента активности молча остаётся пустой без ошибки/retry.

### FE-0265 — Tasks: единый Suspense(fallback=null) на весь dialogs-слой — suspend размонтирует все открытые диалоги
- Категория: React/Tasks | Серьёзность: Low | Статус: Suspected
- Файл: `WEB-itinvent/frontend/src/pages/tasks/TasksDialogsLayer.jsx` :28
- Суть/механизм: suspend любого lazy-диалога размонтирует остальные → потеря transient-состояния пикеров
- Доказательства: статическая проверка по file:line (цикл 11, агент Tasks/Construction/Company); [cycle12:confirmed] Один Suspense fallback=null на весь dialogs-слой (TasksDialogsLayer.jsx:28); suspend любого ленивого диалога размонтирует соседние открытые.; [cycle13:unverifiable] Единый Suspense fallback=null действительно охватывает весь слой (28-341), и suspend любого lazy-диалога снимет с экрана соседние. Но почти все lazy-диалоги смонтированы безусловно (162, 260, 305-339) и грузятся при монтировании слоя; условно монтируется только TasksCreateDialog (30-83, 214-258), а штатные сценарии не открывают два диалога одновременно. Теоретический путь через глобальный шорткат 'n' (useTasksPageController.jsx:683-686) поверх открытого review-диалога с потерей локального comment (TaskActionDialogs.jsx:640) есть, но его пользовательская достижимость не подтверждена.

### FE-0266 — CompanyStructure: loadTree без seq/abort-guard — устаревшее дерево побеждает и делает replaceState
- Категория: Race/Company | Серьёзность: Medium | Статус: Confirmed
- Файл: `WEB-itinvent/frontend/src/pages/CompanyStructure.jsx` :144-178: параллельные вызовы применяются в порядке resolve
- Суть/механизм: старший ответ перезаписывает дерево и выбор
- Доказательства: статическая проверка по file:line (цикл 11, агент Tasks/Construction/Company); [cycle12:confirmed] loadTree без seq/abort-guard (CompanyStructure.jsx:144-178): параллельные вызовы применяются в порядке resolve, устаревшее дерево может победить.; [cycle13:confirmed] loadTree не имеет ни sequence, ни AbortController: два параллельных GET применяются в порядке resolve через setTree и updateUrlState (144-178). Параллельность достижима: background-загрузка после админ-изменения не выставляет loading (535, 144-145), поэтому кнопка «Обновить», заблокированная только по loading (332-333), остаётся активной, и ответ старого запроса может перезаписать более свежее дерево и URL.

### FE-0267 — CompanyStructure: updateUrlState через сырой history.pushState мимо роутера — ломаный back-стек
- Категория: Routing/Company | Серьёзность: Medium | Статус: Rejected
- Файл: `WEB-itinvent/frontend/src/pages/CompanyStructure.jsx` :117-125: pushState + window.history.state со старым idx
- Суть/механизм: router-location устаревает; idx-ориентированные гарды неверно считают delta
- Доказательства: статическая проверка по file:line (цикл 11, агент Tasks/Construction/Company); [cycle12:confirmed] updateUrlState использует сырой history.pushState и старый history.state (CompanyStructure.jsx:117-125) мимо роутера — back-стек ломается.; [cycle13:refuted] updateUrlState действительно использует сырой history.pushState/replaceState со старым state (117-125), но страница нигде не читает location роутера: состояние берётся из window.location.search (76-85) и popstate (184-200). React Router 7 (package.json:61) на каждый popstate вызывает listener и обновляет location даже при delta=0, поэтому Back/Forward восстанавливают URL и выбранный узел; ломаного back-стека в текущем коде нет, каждый клик по узлу просто добавляет запись.

### FE-0268 — CompanyStructureOverview: ошибка layout/импорта ELK → перманентно пустой граф без ошибки и retry
- Категория: ErrorHandling/Company | Серьёзность: Medium | Статус: Confirmed
- Файл: `WEB-itinvent/frontend/src/pages/company-structure/CompanyStructureOverview.jsx` :45-52,316-381: .catch только гасит спиннер; elkInstancePromise остаётся rejected навсегда
- Суть/механизм: мёртвый «Обзор» при сбое чанка — только reload помогает
- Доказательства: статическая проверка по file:line (цикл 11, агент Tasks/Construction/Company); [cycle12:confirmed] getElk кэширует import() в elkInstancePromise (CompanyStructureOverview.jsx:45-52); при reject промис остаётся rejected навсегда, catch на 316-381 только гасит спиннер — граф пуст без retry.

### FE-0269 — CompanyStructure: ошибка getNodePeople → setPeople([]) — ложное «нет сотрудников»
- Категория: ErrorHandling/Company | Серьёзность: Low | Статус: Confirmed
- Файл: `WEB-itinvent/frontend/src/pages/CompanyStructure.jsx` :228-231
- Суть/механизм: панель сотрудников молча пуста при сбое
- Доказательства: статическая проверка по file:line (цикл 11, агент Tasks/Construction/Company); [cycle12:confirmed] Ошибка getNodePeople приводит к setPeople([]) (CompanyStructure.jsx:228-231) — UI показывает «нет сотрудников» вместо ошибки.

### FE-0270 — CompanyStructure: автокомплит — isOptionEqualToValue по kind+title, key без node_id → коллизия тёзок
- Категория: Data/Company | Серьёзность: Low | Статус: Rejected
- Файл: `WEB-itinvent/frontend/src/pages/CompanyStructure.jsx` :348,370
- Суть/механизм: выбор/подсветка чужой записи при одинаковых именах
- Доказательства: статическая проверка по file:line (цикл 11, агент Tasks/Construction/Company); [cycle12:confirmed] Автокомплит сравнивает по kind+title и использует key без node_id (CompanyStructure.jsx:348,370) — тёзки в одном kind коллизируют.; [cycle13:refuted] У Autocomplete нет prop value (340-352), поэтому isOptionEqualToValue не участвует в выборе: сравнение применяется только к контролируемому value, а здесь компонент неконтролируемый. Ключ опции уже включает node_id (370), так что утверждение о ключе без node_id устарело; коллизия тёзок не даёт пользовательского эффекта.

### FE-0271 — Construction-workspace: Escape/backdrop молча сбрасывает форму бригады (при этом входит в dirty)
- Категория: DataLoss/Construction | Серьёзность: Medium | Статус: Confirmed
- Файл: `WEB-itinvent/frontend/src/components/construction/ConstructionWorkWorkspace.jsx` :163: onClose=setCrewEditor(null) без confirm
- Суть/механизм: потеря введённых полей crew-формы
- Доказательства: статическая проверка по file:line (цикл 11, агент Tasks/Construction/Company); [cycle12:confirmed] onClose формы бригады — setCrewEditor(null) без confirm (ConstructionWorkWorkspace.jsx:163), хотя crewEditor входит в dirty (40).

### FE-0272 — Construction-workspace: рендер истории без optional chain → TypeError на битой записи
- Категория: ErrorHandling/Construction | Серьёзность: Low | Статус: Confirmed
- Файл: `WEB-itinvent/frontend/src/components/construction/ConstructionWorkWorkspace.jsx` :164: entry.after.targets.length без guard (асимметрично entry.before?)
- Суть/механизм: диалог истории роняется на неполной записи
- Доказательства: статическая проверка по file:line (цикл 11, агент Tasks/Construction/Company); [cycle12:confirmed] Рендер истории читает entry.after.targets.length без optional chain (ConstructionWorkWorkspace.jsx:164), а entry.before — с ?. — TypeError на битой записи.

### FE-0273 — Construction-panel: data?.items.length===0 при необязательном data.items; entry.after.date без guard
- Категория: ErrorHandling/Construction | Серьёзность: Low | Статус: Rejected
- Файл: `WEB-itinvent/frontend/src/components/construction/ConstructionWorkPanel.jsx` :101,110
- Суть/механизм: TypeError на неполном ответе API
- Доказательства: статическая проверка по file:line (цикл 11, агент Tasks/Construction/Company); [cycle12:confirmed] ConstructionWorkPanel.jsx:101,110: data?.items.length===0 и entry.after.date без guard при необязательных полях — падение на неполном ответе.; [cycle13:refuted] data?.items.length безопасен: при data=null optional chain обрывает всю цепочку, а при непустом data контракт read всегда содержит items (construction_work_service.py:168-174). Для day-записей before/after формируются сервисом как {date, values} (construction_work_service.py:219), поэтому entry.after.date определён; неполный ответ, на котором эти строки падали бы, текущим API не выдаётся.

### FE-0274 — AddressBook: onComposeEmail продублирован в JSX — dev-предупреждение о дубле prop
- Категория: Architecture/DeadCode | Серьёзность: Info | Статус: Confirmed
- Файл: `WEB-itinvent/frontend/src/pages/AddressBook.jsx` :958-963,993-998
- Суть/механизм: мёртвый проп
- Доказательства: статическая проверка по file:line (цикл 11, агент Tasks/Construction/Company); [cycle12:confirmed] onComposeEmail передан дважды в JSX (AddressBook.jsx:958-963,993-998) — dev-предупреждение React о дублирующемся prop.

### FE-0275 — Construction-workspace: нет лимита 300 записей на batch (в Panel есть с сообщением)
- Категория: Consistency/Construction | Серьёзность: Low | Статус: Confirmed
- Файл: `WEB-itinvent/frontend/src/components/construction/ConstructionWorkWorkspace.jsx` :editDay/setAttendance vs Panel.jsx:184-187
- Суть/механизм: payload daily/attendance неограничен → потенциальный отказ сервера
- Доказательства: статическая проверка по file:line (цикл 11, агент Tasks/Construction/Company); [cycle12:confirmed] В ConstructionWorkWorkspace editDay/setAttendance не ограничивают batch 300 записями, тогда как в Panel.jsx:184-187 лимит и сообщение есть.

### FE-0276 — useConstructionWorkLeaveGuard: activePopGuard — модульный синглтон → гард достаётся последнему подписчику
- Категория: Architecture/Guards | Серьёзность: Medium | Статус: Rejected
- Файл: `WEB-itinvent/frontend/src/components/construction/useConstructionWorkLeaveGuard.js` :14,129: push/replace/go мультиплексируются через Set, а popstate-гарда — только последний
- Суть/механизм: Back уходит мимо гарда первого dirty-редактора при двух смонтированных
- Доказательства: статическая проверка по file:line (цикл 11, агент Tasks/Construction/Company); [cycle12:confirmed] useConstructionWorkLeaveGuard хранит activePopGuard как модульный синглтон (строка 14,129): push/replace/go мультиплексируются Set, а popstate-гард достаётся последнему подписчику.; [cycle13:refuted] activePopGuard действительно модульный синглтон (4, 8, 129-133), но в текущих маршрутах одновременно не монтируются два dirty-гарда: workspace и его details-панель взаимоисключающи по dirty (Workspace.jsx:41-44, 110, 116), а ConstructionObjectSettingsDialog живёт на другой странице (ConstructionObjectDetail.jsx:340). Навигационный патч мультиплексирует подписчиков через Set (16-54), и тест на двух редакторов проходит; пользовательского сценария «гард достался последнему» в текущем UI нет.

### FE-0277 — TaskCanvas: disabled читает pendingSceneRef.current в рендере — нереактивный ref
- Категория: React/Tasks | Серьёзность: Info | Статус: Confirmed
- Файл: `WEB-itinvent/frontend/src/components/hub/tasks/TaskCanvasWorkspace.jsx` :764: disabled={!pendingSceneRef.current} — работает лишь из-за парного setSaveState
- Суть/механизм: хрупкая инварианта — «залипшая» кнопка при рефакторе
- Доказательства: статическая проверка по file:line (цикл 11, агент Tasks/Construction/Company); [cycle12:confirmed] TaskCanvasWorkspace.jsx:764: disabled={!pendingSceneRef.current} читает ref в рендере; работает только благодаря парному setSaveState, реактивности нет.

### FE-0278 — TaskCanvas: forbidden/error выставляет can_edit=false, но pendingSceneRef не чистится → вечный dirty
- Категория: State/Tasks | Серьёзность: Low | Статус: Confirmed
- Файл: `WEB-itinvent/frontend/src/components/hub/tasks/TaskCanvasWorkspace.jsx` :545-549
- Суть/механизм: «Есть несохранённые изменения» навсегда + бесконечный beforeunload у заблокированного
- Доказательства: статическая проверка по file:line (цикл 11, агент Tasks/Construction/Company); [cycle12:confirmed] Ветка forbidden/error выставляет can_edit=false (TaskCanvasWorkspace.jsx:545-549), но pendingSceneRef не очищается — вечный dirty.; [cycle13:confirmed] При task_canvas.error с code=forbidden выставляется can_edit=false (545-549), но pendingSceneRef не очищается и saveState не сбрасывается. Кнопка сохранения исчезает из-за canvas.can_edit (759), unmount-flush пропускает правки из-за canEditRef=false (332-340), а statusLabel при saveState='dirty' продолжает показывать «Есть несохранённые изменения» и beforeunload предупреждает (342-350). Сценарий достижим при отзыве прав/закрытии задачи во время редактирования (WS перепроверяет доступ каждые 5 c, task_canvas_ws.py:32, 221-235).

### FE-0279 — TaskCanvas: inert выставляется один раз — поздние порталы остаются фокусируемыми вне aria-modal
- Категория: A11y/Tasks | Серьёзность: Low | Статус: Rejected
- Файл: `WEB-itinvent/frontend/src/components/hub/tasks/TaskCanvasWorkspace.jsx` :367-398
- Суть/механизм: утечка фокуса из pseudo-fullscreen в Snackbars/Dialogs
- Доказательства: статическая проверка по file:line (цикл 11, агент Tasks/Construction/Company); [cycle12:confirmed] inert выставляется один раз при открытии (TaskCanvasWorkspace.jsx:367-398); порталы, смонтированные позже, остаются фокусируемыми вне aria-modal.; [cycle13:refuted] Как пользовательский дефект не подтверждается, хотя зазор в реализации есть: inert действительно снимается один раз (TaskCanvasWorkspace.jsx:366-398). Оба примера из описания не работают: ToastViewport рендерится инлайново (ToastViewport.jsx:235-258) внутри стека NotificationContext.jsx:471-521, который является сиблингом ветки воркспейса и потому сам получает inert, а MUI Snackbar в этом пути не порталится. Портируемые MUI Dialog-ы (Modal.js:188) в pseudo-fullscreen на странице задач открыть нечем: канвас не вызывает ни useConfirmDialog, ни Dialog, а глобальные диалоги срабатывают только по действию пользователя, недоступному за пределами инертного слоя. Остаётся теоретический риск для будущих порталов, но демонстрируемого ухода фокуса в текущем коде нет.

### FE-0280 — AddressBook: scope-ключ request-guard конкатенирует cityFilter+listMode без разделителя
- Категория: Architecture/Guards | Серьёзность: Info | Статус: Rejected
- Файл: `WEB-itinvent/frontend/src/pages/AddressBook.jsx` :213-214
- Суть/механизм: теоретическая коллизия контекста → гард пропустит чужой ответ
- Доказательства: статическая проверка по file:line (цикл 11, агент Tasks/Construction/Company); [cycle12:confirmed] Scope-ключ request-guard конкатенирует cityFilter и listMode без разделителя (AddressBook.jsx:213-214) — возможны коллизии ключей.; [cycle13:refuted] Scope-ключ действительно склеивает cityFilter и listMode без разделителя (213-214), но listMode принимает только фиксированные all/favorites/recent, а cityFilter — значение из списка городов, а не произвольный текст. Коллизия потребовала бы город, оканчивающийся на 'all'/'recent'/'favorites', либо подмену режима; в текущем UI такая пара состояний недостижима, поэтому устаревший ответ не может быть принят за актуальный.

### FE-0281 — Computers: незащищённые localStorage.getItem в инициализаторах useState → крах страницы при заблокированном storage
- Категория: Reliability/Storage | Серьёзность: Medium | Статус: Confirmed
- Файл: `WEB-itinvent/frontend/src/pages/Computers.jsx` :883,884,887,888,889; EmployeeHistoryPanel.jsx:155 — useState(()=>localStorage.getItem()) без try
- Суть/механизм: SecurityError в render-инициализаторе → белый экран; в том же файле readRecentSearches обёрнуты в try — несогласованность
- Доказательства: статическая проверка по file:line (цикл 11, агент Computers/Transfer/DLP); [cycle12:confirmed] useState-инициализаторы читают localStorage.getItem без try (Computers.jsx:883-889; EmployeeHistoryPanel.jsx:155) — при заблокированном storage страница падает.

### FE-0282 — Computers: незащищённые localStorage.setItem в эффектах (флаги/seen-карта до 500 записей)
- Категория: Reliability/Storage | Серьёзность: Low | Статус: Confirmed
- Файл: `WEB-itinvent/frontend/src/pages/Computers.jsx` :1405,1409,1413,1417,1427,1455; EmployeeHistoryPanel.jsx:157
- Суть/механизм: переполнение квоты/blocked storage → исключение из эффекта
- Доказательства: статическая проверка по file:line (цикл 11, агент Computers/Transfer/DLP); [cycle12:confirmed] localStorage.setItem в эффектах без try (Computers.jsx:1405-1455; EmployeeHistoryPanel.jsx:157) — quota/security error ломает эффект.

### FE-0283 — Database: гонка openActFile — нет seq-guard + утечка blob-URL при клике по акту B во время загрузки A
- Категория: Race/Database | Серьёзность: Medium | Статус: Confirmed
- Файл: `WEB-itinvent/frontend/src/pages/database/useEquipmentActFilePreview.js` :47-165: objectUrlRef перетирается без revoke; ответ A может перезаписать preview чужим файлом
- Суть/механизм: показ не того акта + утечка object-URL (у useMovementDetail filePreviewSequenceRef есть) Подтверждено вторым агентом: revoke только для текущего URL — проигравший утекает.
- Доказательства: статическая проверка по file:line (цикл 11, агент Computers/Transfer/DLP); [cycle12:confirmed] openActFile без seq-guard и с перетиранием objectUrlRef без revoke (useEquipmentActFilePreview.js:47-165): ответ A может перезаписать preview файла B.

### FE-0284 — ItObjects: тихая потеря несохранённых правок матрицы доступа при сохранении соседней строки
- Категория: DataLoss/ItObjects | Серьёзность: Medium | Статус: Confirmed
- Файл: `WEB-itinvent/frontend/src/components/itObjects/ObjectAccessMatrix.jsx` :45-46: useEffect сбрасывает values при новой ссылке person.sections (каждый load создаёт новый)
- Суть/механизм: правки строки A стираются при save строки B или «Обновить»
- Доказательства: статическая проверка по file:line (цикл 11, агент Computers/Transfer/DLP); [cycle12:confirmed] ObjectAccessMatrix PersonRow сбрасывает values при изменении ссылки person.sections (ObjectAccessMatrix.jsx:41-46); каждый load создаёт новый объект — несохранённые правки теряются.

### FE-0285 — ItObjects: отзыв всего доступа пользователя одним кликом без подтверждения
- Категория: UX/ItObjects | Серьёзность: Low | Статус: Confirmed
- Файл: `WEB-itinvent/frontend/src/components/itObjects/ObjectAccessMatrix.jsx` :61-70: IconButton → onSave(userId, all NONE)
- Суть/механизм: случайный отзыв доступа без confirm
- Доказательства: статическая проверка по file:line (цикл 11, агент Computers/Transfer/DLP); [cycle12:confirmed] IconButton отзыва доступа сразу вызывает onSave(userId, all NONE) без confirm (ObjectAccessMatrix.jsx:61-70).

### FE-0286 — ItObjects: «Снять» ответственного объекта без подтверждения
- Категория: UX/ItObjects | Серьёзность: Low | Статус: Confirmed
- Файл: `WEB-itinvent/frontend/src/pages/ItObjectDetail.jsx` :298-308: немедленный clearOwner (удаление объекта — через диалог)
- Суть/механизм: объект без владельца одним кликом
- Доказательства: статическая проверка по file:line (цикл 11, агент Computers/Transfer/DLP); [cycle12:confirmed] «Снять» ответственного вызывает clearOwner сразу (ItObjectDetail.jsx:298-308), удаление объекта при этом идёт через диалог.

### FE-0287 — Database: stale loc_no остаётся в состоянии при «пустом» поле локации после смены филиала
- Категория: State/Transfer | Серьёзность: Medium | Статус: Confirmed
- Файл: `WEB-itinvent/frontend/src/pages/database/useTransferFormState.js` :232-261 + LocationAutocompleteField.jsx:79-82: options.find→null (поле пустое), а transferLocationNo держит старый id → уходит в payload
- Суть/механизм: перемещение в неправильную локацию или ошибка сервера
- Доказательства: статическая проверка по file:line (цикл 11, агент Computers/Transfer/DLP); [cycle12:confirmed] При пустом поле локации options.find даёт null (LocationAutocompleteField.jsx:79-82), но transferLocationNo сохраняет старый id (useTransferFormState.js:232-261) и уходит в payload.

### FE-0288 — ItObjects: панель паролей объекта тихо обрезана до 100 записей без индикатора
- Категория: Data/ItObjects | Серьёзность: Low | Статус: Confirmed
- Файл: `WEB-itinvent/frontend/src/components/itObjects/ObjectPasswordsPanel.jsx` :17,52: limit=100 без «показано N из M»
- Суть/механизм: часть паролей невидима (в SectionSummary есть «100+» — несогласованность)
- Доказательства: статическая проверка по file:line (цикл 11, агент Computers/Transfer/DLP); [cycle12:confirmed] ObjectPasswordsPanel запрашивает limit=100 и не показывает «N из M» (ObjectPasswordsPanel.jsx:17,52) — панель тихо обрезана.

### FE-0289 — Statistics: обновление статистики после чистки обходит seq-guard → данные не того периода
- Категория: Race/Statistics | Серьёзность: Low | Статус: Confirmed
- Файл: `WEB-itinvent/frontend/src/pages/Statistics.jsx` :598 (loadPcStats с isCurrent=()=>true) + :239-242
- Суть/механизм: смена периода во время запроса → ответ старого периода перезаписывает; ошибка глотается .catch(()=>{})
- Доказательства: статическая проверка по file:line (цикл 11, агент Computers/Transfer/DLP); [cycle12:confirmed] onCleaningSaved вызывает loadPcStats(() => true) (Statistics.jsx:598), обходя seq-guard; при смене периода/вкладки старые данные могут перезаписать новые.

### FE-0290 — Statistics: немедленный revokeObjectURL после anchor.click() при экспорте Excel
- Категория: Download/Statistics | Серьёзность: Low | Статус: Confirmed
- Файл: `WEB-itinvent/frontend/src/pages/Statistics.jsx` :324-331 (нет задержки, у useTransferActJob:147-148 — 60 с)
- Суть/механизм: пустой/битый xlsx в части браузеров
- Доказательства: статическая проверка по file:line (цикл 11, агент Computers/Transfer/DLP); [cycle12:confirmed] Экспорт Excel делает revokeObjectURL сразу после anchor.click() (Statistics.jsx:324-331); в useTransferActJob.js:147-148 для того же сценария задержка 60 с.

### FE-0291 — ItObjects: loadFree в диалоге мониторинг-устройств без abort/seq — stale список
- Категория: Race/ItObjects | Серьёзность: Low | Статус: Confirmed
- Файл: `WEB-itinvent/frontend/src/components/itObjects/ObjectMonitoringDevicesDialog.jsx` :24-38
- Суть/механизм: устаревший список свободных устройств при переоткрытии Особенно критично для Desktop (WPF/WebView2 использует тот же фронтенд).
- Доказательства: статическая проверка по file:line (цикл 11, агент Computers/Transfer/DLP); [cycle12:confirmed] loadFree в ObjectMonitoringDevicesDialog.jsx:24-38 без abort/seq — ответ старого запроса может перезаписать новый список.

### FE-0292 — ItObjects: тихий провал загрузки филиалов в диалоге создания → объект создаётся без привязки
- Категория: ErrorHandling/ItObjects | Серьёзность: Low | Статус: Confirmed
- Файл: `WEB-itinvent/frontend/src/components/itObjects/ObjectCreateDialog.jsx` :22-24: catch→setBranches([])
- Суть/механизм: пользователь видит только «Без привязки» без признака сбоя
- Доказательства: статическая проверка по file:line (цикл 11, агент Computers/Transfer/DLP); [cycle12:confirmed] Ошибка загрузки филиалов в ObjectCreateDialog.jsx:22-24 приводит к setBranches([]), форма продолжает создание без привязки и без ошибки.

### FE-0293 — Database: unhandled rejection при провале копирования расхождений
- Категория: ErrorHandling/Database | Серьёзность: Low | Статус: Confirmed
- Файл: `WEB-itinvent/frontend/src/pages/database/useDiscrepanciesCopy.js` :55-64 + lib/clipboard.js:28: handleCopy без try/catch
- Суть/механизм: кнопка молчит без объяснения (актуально WebView2/HTTP)
- Доказательства: статическая проверка по file:line (цикл 11, агент Computers/Transfer/DLP); [cycle12:confirmed] handleCopy не имеет try/catch (useDiscrepanciesCopy.js:55-64, lib/clipboard.js:28); отказ clipboard даёт unhandled rejection.

### FE-0294 — Database: список ошибок перемещения обрезан до 5 без пометки «и ещё N»
- Категория: UX/Transfer | Серьёзность: Low | Статус: Confirmed
- Файл: `WEB-itinvent/frontend/src/pages/database/TransferActionContent.jsx` :344: result.failed.slice(0,5)
- Суть/механизм: retry идёт по полному списку — пользователь видит меньше ошибок
- Доказательства: статическая проверка по file:line (цикл 11, агент Computers/Transfer/DLP); [cycle12:confirmed] TransferActionContent.jsx:344 обрезает result.failed до 5 без пометки «и ещё N» — остальные ошибки скрыты.

### FE-0295 — Database: ошибка поиска принтеров неотличима от «не найдено»
- Категория: ErrorHandling/Database | Серьёзность: Low | Статус: Confirmed
- Файл: `WEB-itinvent/frontend/src/pages/database/useConsumableQrPrinterPicker.js` :161-163: catch→setSearchResults([])
- Суть/механизм: сетевой сбой выглядит как пустой результат
- Доказательства: статическая проверка по file:line (цикл 11, агент Computers/Transfer/DLP); [cycle12:confirmed] catch в useConsumableQrPrinterPicker.js:161-163 делает setSearchResults([]) — ошибка поиска принтеров выглядит как «ничего не найдено».

### FE-0296 — DLP: «Обновить»/«Актуальный отчёт» без busy-guard — дубли запросов/отчётов
- Категория: BusyGuards/DLP | Серьёзность: Low | Статус: Confirmed
- Файл: `WEB-itinvent/frontend/src/pages/FileEgress.jsx` :163-178,253-262,308
- Суть/механизм: параллельные load; двойной клик = два отчёта
- Доказательства: статическая проверка по file:line (цикл 11, агент Computers/Transfer/DLP); [cycle12:confirmed] «Обновить» и «Актуальный отчёт» в FileEgress.jsx:163-178,253-262,308 не имеют busy-guard — повторные клики запускают параллельные запросы/отчёты.

### FE-0297 — DLP: тихий провал загрузки скриншота браузерного визита
- Категория: ErrorHandling/DLP | Серьёзность: Low | Статус: Confirmed
- Файл: `WEB-itinvent/frontend/src/components/dlp/BrowserVisitsPanel.jsx` :205-206: catch{setUrl("")}
- Суть/механизм: кнопка «Снимок» возвращается в исходное без объяснения
- Доказательства: статическая проверка по file:line (цикл 11, агент Computers/Transfer/DLP); [cycle12:confirmed] BrowserVisitsPanel.jsx:205-206 при ошибке скриншота делает catch { setUrl('') } — пользователь не узнаёт, что превью не загрузилось.

### FE-0298 — DLP: строки таблицы хостов/доменов доступны только мышью (без tabIndex/onKeyDown)
- Категория: A11y/DLP | Серьёзность: Low | Статус: Confirmed
- Файл: `WEB-itinvent/frontend/src/components/dlp/DlpHostList.jsx` :412-416 + BrowserVisitsPanel.jsx:629-635
- Суть/механизм: клавиатурный пользователь не откроет хост/домен
- Доказательства: статическая проверка по file:line (цикл 11, агент Computers/Transfer/DLP); [cycle12:confirmed] Строки таблицы хостов/доменов кликабельны только мышью: DlpHostList.jsx:412-416, BrowserVisitsPanel.jsx:629-635 без tabIndex/onKeyDown.

### FE-0299 — Statistics: setItems после cancelled в reloadRemaining — запись на размонтированном диалоге
- Категория: Leaks/Statistics | Серьёзность: Low | Статус: Confirmed
- Файл: `WEB-itinvent/frontend/src/pages/statistics/PcRemainingDialog.jsx` :82-90: .then пишет без проверки cancelled (есть только в catch/finally)
- Суть/механизм: устаревший список при переоткрытии
- Доказательства: статическая проверка по file:line (цикл 11, агент Computers/Transfer/DLP); [cycle12:confirmed] В reloadRemaining .then пишет setItems без проверки cancelled (PcRemainingDialog.jsx:82-90); cancelled проверяется только в catch/finally.

### FE-0300 — DLP: список telegram/max-чатов обрезан limit=200 без индикатора
- Категория: Data/DLP | Серьёзность: Low | Статус: Suspected
- Файл: `WEB-itinvent/frontend/src/pages/FileEgress.jsx` :220-235
- Суть/механизм: >200 диалогов → хвост молча невидим
- Доказательства: статическая проверка по file:line (цикл 11, агент Computers/Transfer/DLP); [cycle12:confirmed] Список telegram/max-чатов запрашивается с limit=200 (FileEgress.jsx:220-235) без индикатора усечения.; [cycle13:confirmed] Чаты запрашиваются с limit=200 на хост (FileEgress.jsx:220-223), бэкенд режет SQL LIMIT (le=500) и сортирует по updated_at desc без total/hasMore (fs_egress.py:401-409, file_egress_store.py:869-872). Панель Telegram/MAX не показывает признак усечения, а заголовки вкладок берут tgChats.length/maxChats.length (FileEgress.jsx:302-303) — при >200 диалогов счётчик «200» выглядит как полный, а более старые диалоги невидимы. Для сравнения, BrowserVisitsPanel явно пишет «Показаны последние N из total» (BrowserVisitsPanel.jsx:796), то есть паттерн в проекте есть, но здесь не применён. Требуется >200 диалогов на хост; механизм подтверждён по коду.

### FE-0301 — Database: поиск получателя/сотрудника без AbortController + устаревшие options при ошибке
- Категория: Race/Transfer | Серьёзность: Low | Статус: Confirmed
- Файл: `WEB-itinvent/frontend/src/pages/database/useTransferEmail.js` :50-58 + useTransferFormState.js:129-144
- Суть/механизм: старый запрос грузит сеть; ошибка → только console.error, options устаревают
- Доказательства: статическая проверка по file:line (цикл 11, агент Computers/Transfer/DLP); [cycle12:confirmed] Поиск получателя/сотрудника идёт без AbortController (useTransferEmail.js:50-58, useTransferFormState.js:129-144); при ошибке остаются устаревшие options.; [cycle13:confirmed] Cancelled-флаг защищает от применения устаревшего ответа (48-58, 127-143), поэтому отсутствие AbortController само по себе не портит состояние — отменяется только таймер, а запрос доигрывается вхолостую. Но при reject поиска catch лишь логирует (54-56, 139-141) и не очищает transferRecipientOptions/transferEmployeeOptions: под новым запросом остаются варианты предыдущего поиска, и получателя можно выбрать по неверному списку. Ошибка при этом пользователю не показывается.

### FE-0302 — Database: экспорт оборудования без листа перемещений при падении prefetch — только console.warn
- Категория: ErrorHandling/Transfer | Серьёзность: Low | Статус: Confirmed
- Файл: `WEB-itinvent/frontend/src/pages/database/useEmployeeEquipmentExport.js` :41-53
- Суть/механизм: пользователь получает неполный Excel без предупреждения Доп.: movements грузятся limit:500 — флаг усечения в файл не пишется.
- Доказательства: статическая проверка по file:line (цикл 11, агент Computers/Transfer/DLP); [cycle12:confirmed] При падении prefetch перемещений экспорт оборудования продолжается без листа перемещений, только console.warn (useEmployeeEquipmentExport.js:41-53).

### FE-0303 — Чат: groupActionBusy — единый слот на все действия группы; повторный запуск в одном кадре проходит
- Категория: BusyGuards/Chat | Серьёзность: Low | Статус: Rejected
- Файл: `WEB-itinvent/frontend/src/components/chat/ChatContextPanel.jsx` :1660,1931-1944: runGroupAction не проверяет busy перед стартом; кнопки disabled в UI, но два вызова до ре-рендера возможны
- Суть/механизм: finally первого обнуляет флаг до конца второго — то же окно, что FE-0180
- Доказательства: статическая проверка по file:line (цикл 11, ручная); [cycle12:confirmed] runGroupAction проверяет groupActionBusy только в UI (ChatContextPanel.jsx:1660,1931-1944); два вызова до ре-рендера проходят, слот один.; [cycle13:refuted] У runGroupAction нет раннего return по busy (ChatContextPanel.jsx:1931-1946), но флаг ставится синхронно до первого await, а все видимые точки запуска получают disabled={groupActionBusy} (2498-2580, 3355-3505) либо закрывают диалог до старта действия (2125-2135). React 18 сбрасывает состояние дискретного клика синхронно до следующего события, поэтому второй клик приходит уже в disabled-контрол; повторный запуск «в одном кадре» через UI не воспроизводится. Единый слот на все групповые действия — сериализация, а не наблюдаемый дефект.

### FE-0304 — Чат: loadAddMembersUsers без seq-guard — устаревшие результаты поиска при быстром вводе
- Категория: Race/Chat | Серьёзность: Low | Статус: Confirmed
- Файл: `WEB-itinvent/frontend/src/components/chat/ChatContextPanel.jsx` :1957-1967: getUsers без requestId/abort
- Суть/механизм: поздний ответ старого запроса перезаписывает список нового
- Доказательства: статическая проверка по file:line (цикл 11, ручная); [cycle12:confirmed] loadAddMembersUsers вызывает getUsers без requestId/abort (ChatContextPanel.jsx:1957-1967) — устаревший поиск может перезаписать новый.

### FE-0305 — Database: crypto.randomUUID() без fallback — перенос в другую БД падает на HTTP-развёртывании
- Категория: Compat/Database | Серьёзность: Medium | Статус: Confirmed
- Файл: `WEB-itinvent/frontend/src/pages/database/useDatabaseDbTransfer.js` :58: crypto.randomUUID() внутри try — нет в не-secure context (HTTP IIS); useTransferActJob.js:32-37 имеет fallback — несогласованность
- Суть/механизм: перенос оборудования всегда падает TypeError на HTTP-интранете
- Доказательства: статическая проверка по file:line (цикл 11, агент Scan/Database); [cycle12:confirmed] useDatabaseDbTransfer.js:58 вызывает crypto.randomUUID() напрямую; в не-secure context (HTTP IIS) метода нет, перенос падает. В useTransferActJob.js:32-37 fallback есть.

### FE-0306 — Database: storm-ретрай догрузки списка при падении эндпоинта — бесконечный поток запросов без backoff
- Категория: ErrorHandling/Database | Серьёзность: Medium | Статус: Confirmed
- Файл: `WEB-itinvent/frontend/src/pages/database/useDatabaseEquipmentData.js` :344-349,407-414: catch только console.error; nextEquipmentPage не сдвигается → sentinel пересоздаётся и вызывает onLoadMore снова
- Суть/механизм: при 500-эндпоинте непрерывные падающие запросы + вечный спиннер
- Доказательства: статическая проверка по file:line (цикл 11, агент Scan/Database); [cycle12:confirmed] При падении догрузки nextEquipmentPage не сдвигается, catch только console.error (useDatabaseEquipmentData.js:344-349,407-414) — sentinel повторно вызывает onLoadMore без backoff.

### FE-0307 — Database: тот же storm-ретрай для универсального поиска (осознанный механизм без предохранителя)
- Категория: ErrorHandling/Database | Серьёзность: Medium | Статус: Confirmed
- Файл: `WEB-itinvent/frontend/src/pages/database/useDatabaseSearch.js` :313-315: .catch(()=>{}) «next sentinel retries» без backoff/лимита/ошибки в UI
- Суть/механизм: при постоянной ошибке searchUniversal — непрерывные повторные запросы
- Доказательства: статическая проверка по file:line (цикл 11, агент Scan/Database); [cycle12:confirmed] Универсальный поиск имеет .catch(()=>{}) с комментарием «next sentinel retries» (useDatabaseSearch.js:313-315) без backoff/лимита/ошибки в UI.

### FE-0308 — Database: метаданные (типы/статусы/филиалы) без generation-защиты — чужие справочники под новой БД
- Категория: Race/Database | Серьёзность: Medium | Статус: Confirmed
- Файл: `WEB-itinvent/frontend/src/pages/database/useDatabaseEquipmentData.js` :168-232: setEquipmentTypes/Branches/Statuses без isCurrent; refreshCurrentDbData:430-441 проверяет generation только для fetchAllEquipment
- Суть/механизм: две быстрые смены БД → справочники старой БД; persisted-филиал валидируется по чужому списку
- Доказательства: статическая проверка по file:line (цикл 11, агент Scan/Database); [cycle12:confirmed] setEquipmentTypes/Branches/Statuses выполняются без isCurrent (useDatabaseEquipmentData.js:168-232); generation проверяется только для fetchAllEquipment (430-441).

### FE-0309 — Database: ошибка первичной загрузки проглатывается — пустая база без индикации
- Категория: ErrorHandling/Database | Серьёзность: Medium | Статус: Confirmed
- Файл: `WEB-itinvent/frontend/src/pages/database/useDatabaseEquipmentData.js` :416-418: fetchAllEquipment catch только console.error; состояния ошибки нет
- Суть/механизм: пользователь принимает упавшую загрузку за пустую базу
- Доказательства: статическая проверка по file:line (цикл 11, агент Scan/Database); [cycle12:confirmed] Ошибка fetchAllEquipment только console.error (useDatabaseEquipmentData.js:416-418); состояния ошибки нет — пустая база без индикации.

### FE-0310 — Database: «недавние карточки» без scope-защиты — чужие карточки при смене БД
- Категория: Race/Database | Серьёзность: Medium | Статус: Confirmed
- Файл: `WEB-itinvent/frontend/src/pages/database/useDatabaseRecentCards.js` :30-50,52-72,99-130: refreshRecentCards/touchRecentCard без requestId; список не чистится при dbName (в recentActs есть)
- Суть/механизм: touch старой БД добавляет её позицию в список новой
- Доказательства: статическая проверка по file:line (цикл 11, агент Scan/Database); [cycle12:confirmed] refreshRecentCards/touchRecentCard без requestId (useDatabaseRecentCards.js:30-72,99-130), список не чистится при смене dbName — чужие недавние карточки.

### FE-0311 — Database: смена БД без busy-guard + откат селекта к stale-значению при ошибке
- Категория: Race/Database | Серьёзность: Medium | Статус: Confirmed
- Файл: `WEB-itinvent/frontend/src/pages/database/useDatabaseSelection.js` :79-99: параллельные switchDatabase → двойной database-changed-рефетч; catch откатывает к захваченному previousDbId
- Суть/механизм: рассинхрон UI-селекта с реальной БД при частичном отказе
- Доказательства: статическая проверка по file:line (цикл 11, агент Scan/Database); [cycle12:confirmed] switchDatabase без busy-guard (useDatabaseSelection.js:79-99): параллельные переключения дают двойной database-changed, catch откатывает к захваченному previousDbId.

### FE-0312 — ScanCenter: ошибка observations кэшируется как «пусто» — ретрай навсегда заблокирован
- Категория: ErrorHandling/Scan | Серьёзность: Medium | Статус: Confirmed
- Файл: `WEB-itinvent/frontend/src/pages/scan-center/ScanCenterPage.jsx` :1130,1148-1155: не-append ошибка пишет {total:0,items:[]}; входной dedupe по currentBucket блокирует повтор
- Суть/механизм: run показывает «изменения не найдены» до перезагрузки
- Доказательства: статическая проверка по file:line (цикл 11, агент Scan/Database); [cycle12:confirmed] Не-append ошибка observations кэшируется как {total:0,items:[]} (ScanCenterPage.jsx:1130,1148-1155); dedupe по currentBucket блокирует повторный запрос — ретрай заблокирован.

### FE-0313 — Database: transfer-job поллинг продолжается ~10 мин после unmount страницы
- Категория: Leaks/Database | Серьёзность: Low | Статус: Confirmed
- Файл: `WEB-itinvent/frontend/src/pages/database/useTransferActJob.js` :155-229,39-44: хук без useEffect; seq инвалидируется только reset/новым poll
- Суть/механизм: фоновый трафик после ухода со страницы
- Доказательства: статическая проверка по file:line (цикл 11, агент Scan/Database); [cycle12:confirmed] Поллинг transfer-job живёт в хуке без useEffect (useTransferActJob.js:155-229,39-44); seq инвалидируется только reset/новым poll — после unmount страницы запросы продолжаются до ~10 мин.

### FE-0314 — Database: setTimeout(300мс) setSelectedItems без cleanup — галочки на чужой контекст
- Категория: Async/Database | Серьёзность: Low | Статус: Confirmed
- Файл: `WEB-itinvent/frontend/src/pages/database/useDatabaseWorkspaceIdentity.js` :30-32
- Суть/механизм: смена БД в окне таймера → выделение inv_no другого контекста
- Доказательства: статическая проверка по file:line (цикл 11, агент Scan/Database); [cycle12:confirmed] setTimeout(300мс) с setSelectedItems без cleanup (useDatabaseWorkspaceIdentity.js:30-32) — галочки применяются к чужому контексту после смены БД.

### FE-0315 — Database: long-press таймер карточки без unmount-cleanup — «призрачное» выделение
- Категория: Gestures/Database | Серьёзность: Low | Статус: Confirmed
- Файл: `WEB-itinvent/frontend/src/pages/database/ModernEquipmentCard.jsx` :184-200: 500мс таймер не очищается
- Суть/механизм: срабатывание на размонтированной карточке → выделение невидимого элемента
- Доказательства: статическая проверка по file:line (цикл 11, агент Scan/Database); [cycle12:confirmed] 500мс long-press таймер карточки не очищается при unmount (ModernEquipmentCard.jsx:184-200) — «призрачное» выделение.

### FE-0316 — Database: мёртвый prefetch чанков диалогов — guard !allEquipment?.length всегда истинен
- Категория: Perf/Database | Серьёзность: Medium | Статус: Confirmed
- Файл: `WEB-itinvent/frontend/src/pages/database/useDatabaseListController.js` :154-168: allEquipment — grouped-объект, .length===undefined → import() никогда не выполняется
- Суть/механизм: первое открытие карточки всегда платит chunk-load задержку
- Доказательства: статическая проверка по file:line (цикл 11, агент Scan/Database); [cycle12:confirmed] allEquipment — grouped-объект ({}), поэтому guard !allEquipment?.length всегда истинен (useDatabaseListController.js:154-168); prefetch import() никогда не выполняется.

### FE-0317 — ScanCenter: busyIncident/busyTaskAgent — одиночный слот без входного guard
- Категория: BusyGuards/Scan | Серьёзность: Low | Статус: Confirmed
- Файл: `WEB-itinvent/frontend/src/pages/scan-center/ScanCenterPage.jsx` :1486-1508,1773-1823: finally первого снимает busy второго
- Суть/механизм: повторный ack до конца запроса; лишние refresh-волны
- Доказательства: статическая проверка по file:line (цикл 11, агент Scan/Database); [cycle12:confirmed] busyIncident/busyTaskAgent — одиночные слоты без входного guard (ScanCenterPage.jsx:1486-1508,1773-1823); finally первого снимает busy второго.

### FE-0318 — Scan: refreshFirstPage без AbortSignal — запросы наслаиваются на медленном бэкенде
- Категория: Async/Scan | Серьёзность: Low | Статус: Confirmed
- Файл: `WEB-itinvent/frontend/src/hooks/useScanIncidentInbox.js` :121-152 vs 95-104 (loadFirstPage/loadMore с signal)
- Суть/механизм: отменённый запрос дочитывает трафик
- Доказательства: статическая проверка по file:line (цикл 11, агент Scan/Database); [cycle12:confirmed] refreshFirstPage не принимает AbortSignal (useScanIncidentInbox.js:121-152), в отличие от loadFirstPage/loadMore (95-104) — запросы наслаиваются.

### FE-0319 — ScanCenter: drawer-запросы (host incidents/runs) без abort — живут после закрытия
- Категория: Async/Scan | Серьёзность: Low | Статус: Confirmed
- Файл: `WEB-itinvent/frontend/src/pages/scan-center/ScanCenterPage.jsx` :992-997,1034-1047,1090-1093 + scanIncidents.js:20-25 (getHostScanRuns без options)
- Суть/механизм: лишний трафик после смены хоста
- Доказательства: статическая проверка по file:line (цикл 11, агент Scan/Database); [cycle12:confirmed] Drawer-запросы host incidents/runs без abort (ScanCenterPage.jsx:992-997,1034-1047,1090-1093; scanIncidents.js:20-25) — продолжаются после закрытия.

### FE-0320 — Database: загрузчики истории обслуживания без canceled-флага — чужая история при переоткрытии
- Категория: Race/Database | Серьёзность: Low | Статус: Confirmed
- Файл: `WEB-itinvent/frontend/src/pages/database/useDatabaseMaintenanceData.js` :86-141,162-197: loadWorkConsumables/loadCartridgeHistory и далее пишут после await
- Суть/механизм: окно показа истории другого оборудования
- Доказательства: статическая проверка по file:line (цикл 11, агент Scan/Database); [cycle12:confirmed] loadWorkConsumables/loadCartridgeHistory и другие загрузчики пишут после await без canceled-флага (useDatabaseMaintenanceData.js:86-141,162-197) — чужая история при переоткрытии.

### FE-0321 — Database: deep-link openLinkedConsumable без отмены — модалка не того deeplink
- Категория: Race/Database | Серьёзность: Low | Статус: Confirmed
- Файл: `WEB-itinvent/frontend/src/pages/database/useConsumableCard.js` :242-289
- Суть/механизм: быстрая навигация → last-resolved-wins модалки
- Доказательства: статическая проверка по file:line (цикл 11, агент Scan/Database); [cycle12:confirmed] openLinkedConsumable не отменяет предыдущий запрос (useConsumableCard.js:242-289) — модалка может открыть не тот deeplink.

### FE-0322 — Scan/UI: таймеры вспышек без cleanup (flash 120мс, pathCopied 1500мс)
- Категория: Async/UI | Серьёзность: Info | Статус: Confirmed
- Файл: `WEB-itinvent/frontend/src/pages/scan-center/HostDrawer.jsx` :192; QuickCameraDialog.jsx:71; IncidentsInboxSection.jsx:122
- Суть/механизм: setState после unmount — косметический техдолг
- Доказательства: статическая проверка по file:line (цикл 11, агент Scan/Database); [cycle12:confirmed] Таймеры вспышек (flash 120мс, pathCopied 1500мс) не очищаются при unmount: HostDrawer.jsx:192, QuickCameraDialog.jsx:71, IncidentsInboxSection.jsx:122.

### FE-0323 — API: getHostsFallbackFromIncidents молча усекает список хостов до incidentLimit (латентный)
- Категория: Data/Scan | Серьёзность: Low | Статус: Suspected
- Файл: `WEB-itinvent/frontend/src/api/scanHosts.js` :123-148: метод в проде не вызывается (только тесты) — латентный риск подключения
- Суть/механизм: если метод подключат — неполный список хостов без индикации
- Доказательства: статическая проверка по file:line (цикл 11, агент Scan/Database); [cycle12:unverifiable] getHostsFallbackFromIncidents в проде не вызывается (только тесты, scanHosts.js:123-148); это латентный риск, а не текущий дефект.; [cycle13:unverifiable] Функция действительно запрашивает только max(limit*4,500) инцидентов, игнорирует offset и не отдаёт признак усечения, поэтому при подключении список хостов был бы неполным (scanHosts.js:123-131). Но у экспортированного scanHostsAPI.getHosts в текущем дереве нет ни одного продакшн-вызова: client.js лишь отдаёт геттер (1166-1167), а Scan Center использует getHostsTable (ScanCenterPage.jsx:929). Латентный риск не проявляется, прод-дефект не демонстрируется; формулировка «только тесты» верна для внешнего API, хотя сама fallback-функция вызывается из getHosts (:136,147).

### FE-0324 — Database: справочники departments/movements с limit 500/1000 — переполнение зависит от данных
- Категория: Data/Database | Серьёзность: Low | Статус: Suspected
- Файл: `WEB-itinvent/frontend/src/pages/database/useDatabaseLookups.js` :28-39 + useTransferFormState.js
- Суть/механизм: при справочнике >лимита хвост молча недоступен в форме
- Доказательства: статическая проверка по file:line (цикл 11, агент Scan/Database); [cycle12:unverifiable] Лимиты справочников departments/movements 500/1000 (useDatabaseLookups.js:28-39) могут усечь данные только при превышении объёма; фактическое переполнение не проверено.; [cycle13:confirmed] API не может вернуть больше запрошенного: FastAPI ограничивает limit 2000 (equipment.py:1982), SQL — TOP с клампом (queries.py:3595-3602), а ответ — голый {"departments": [...]} без total/hasMore. Форма перевода в режиме MOVE с ручным сотрудником запрашивает 1000 (useTransferFormState.js:172) и рендерит обязательный Select (TransferActionContent.jsx:210-233): при >1000 отделов хвост по алфавиту недоступен и выбрать его нельзя, индикатора усечения нет; 500 — дефолт хука и API (useDatabaseLookups.js:29), в этом пути не используется. Для movements экспорт запрашивает 500 (useEmployeeEquipmentExport.js:43-49), хотя API отдаёт meta с truncated/hasMore (warehouse1c.js:76-85) — экспорт читает только items и meta игнорирует. Фактическое переполнение не измерялось (прод-БД не запрашивалась), поэтому дефект латентный, но механизм тихого усечения подтверждён.

### FE-0325 — PWA offline: холодная перезагрузка зависает на «Загружаем раздел…» — AuthContext бесконечно ретраит refresh
- Категория: Reliability/PWA | Серьёзность: Medium | Статус: Confirmed
- Страница: все маршруты (проверено /login)
- Файл: `WEB-itinvent/frontend/src/contexts/AuthContext.jsx` :310-339
- Доказательства: live local E2E (cycle 13): built app served by vite preview :5221, SW active and controls the page, app-shell/assets cached; offline reload /login stays on «Загружаем раздел… | Подготавливаем интерфейс HUB-IT» at 10/30/55/65 s.; AuthContext verifySession: error with HTTP status 0 (offline) is not a definitive 401/403, so scheduleRetry repeats forever with max 30 s delay; setLoading(false) is never called on this path (AuthContext.jsx:310-339).; SW itself serves the shell offline (200), so the hang is in auth recovery, not in the service worker navigation fallback.; [cycle14:live] PWA deep test on built app :5223: fresh offline reload stays on loader >50 s; only 2 refresh attempts during 50 s (no request storm); reconnect recovers to /login in ~2 s; offline reload with existing session shows /dashboard and «Нет подключения · Показываем сохранённые данные»; two tabs both show the loader.; [cycle15:live] Cycle 15 PWA: three offline/online reload cycles with existing session recovered to /dashboard each time (~2.6 s offline render, cached «Нет подключения» banner); stale-SW probe installed a new waiting worker while the old controller/caches stayed active and no settings update text appeared.
- Связано: FE-0084, FE-0085, FE-0070

### FE-0326 — My Files: PNG-превью — отклонено (повреждённый тестовый PNG; valid PNG обрабатываются корректно)
- Категория: MyFiles/Preview | Серьёзность: Medium | Статус: Rejected
- Страница: /my-files, /shared-files/:token
- Файл: `WEB-itinvent/backend/services/my_files_service.py` :3568-3663
- Доказательства: [cycle18:local-browser] Uploaded a 64x64 solid PNG (RGB 200,30,40). Authenticated preview dialog shows an image 64x64; canvas pixel (200,30,40) — the user-visible authenticated preview works.; [cycle18:local-api] GET /api/v1/my-files/{id}/preview/content -> 200 image/png, 180 bytes; Pillow Image.open(...).load() raises OSError "broken data stream". The previews dir contains the corrupt preview.png (180 bytes). Another upload's preview.webp (88 bytes) and thumb.webp (86 bytes) load fine.; [cycle18:local-browser] Public share: /shared-files/{token} renders <img src=/api/v1/my-files/public/{token}/preview/content>; the public preview endpoint returns 200 image/png 180 bytes and Pillow fails with the same broken stream. The original file download still works.; [cycle18:repeat] Reproduced on two uploads sharing blob 8726c036... (same PNG content); the uploaded original (186 bytes) opens fine in Pillow. Screenshot evidence/cycle18/shots/c18-public-preview.png.; [cycle19:matrix] Valid PNGs small 32x32 (117 B, SHA aac8...), medium 512x512 (4,485 B, SHA f440...), large 1600x1200 (5,769,402 B, SHA 9561...) uploaded via UI. Preview worker ready; private/public preview: small image/webp 80 B, medium image/png 4,485 B with SHA equal to the original, large image/webp 1,437,182 B. Browser img.complete true, natural sizes 32/512/1600, no visual error. Public download: small 80 B WebP (matches preview), medium 4,485 B PNG (matches original), large 1,437,182 B WebP (matches preview); storage_mode optimized_media for small/large, stored for medium. No corruption.; [cycle19:root-cause] The cycle18 "corrupt" source was the 180-byte base64 fixture in five-e2e: IHDR valid, IDAT length 129 with CRC mismatch, 6 trailing bytes, zlib "incorrect data check"; Pillow failed on the source itself. The app stored the invalid source and served it as preview.png; the image optimization path skipped it. The exact corruption is in the test fixture, not in the app or the preview worker.; [cycle19:download-contract] Legacy private GET /my-files/{id}/download returns 410 by design (comment: legacy blob/XHR path disabled). Current private download: POST /my-files/{id}/download-grant -> GET /my-files/download-grant/{token}; public: GET /my-files/public/{token}/download. Both return the stored representation. For optimized images the DB has storage_mode=optimized_media, download_file_name=*.webp, download_mime_type=image/webp; comparing to original SHA is invalid. The matrix used the legacy endpoint and original SHA, hence 410/matchesOriginal=false. Test methodology corrected; no new defect.

## Счётчики (цикл 14, после runtime-проверок и очистки схемы verification)

| Серьёзность | Кол-во |
|---|---|
| Critical | 0 |
| High | 12 (FE-0022, FE-0023, FE-0059, FE-0078, FE-0083, FE-0197, FE-0198, FE-0215, FE-0230, FE-0232, FE-0239, FE-0259) |
| Medium | 124 |
| Low | 173 |
| Info | 15 |
| Confirmed | 268 |
| Suspected (подмножество) | 12 |
| Fixed-externally | 2 |
| Rejected | 42 |
| **Всего записей** | **324** |
