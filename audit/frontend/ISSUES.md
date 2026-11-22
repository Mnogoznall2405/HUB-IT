# Реестр дефектов web-фронтенда (ISSUES)

Статусы: Confirmed (подтверждено доказательством) / Suspected (гипотеза) / Blocked.
Обновлено: 2026-11-22 (циклы 1–8). Полные отчёты субагентов A/C/D/E — в
`evidence/agent-*-report.md` (восстановлены после инцидента удаления файлов; краткие
сводки — `evidence/agent-*-summary.md`). Все записи перепроверены: ключевые позиции
High/Medium подтверждены повторным чтением кода и/или живыми замерами.

---

## High

### FE-0059 — Обрыв сети >15 с во время ротации refresh-токена принудительно разлогинивает

- Категория: Auth/надёжность сети; Серьёзность: **High**; Статус: Confirmed (живое воспроизведение + код + документация)
- Файлы: причина — `WEB-itinvent/backend/api/v1/auth.py:1648` (grace = `refresh_rotation_grace_seconds` или **15 с**), `:135` (`_REFRESH_GRACE_MAX_HITS = 1`), `:1656–1687` (reuse → family revoke → 401); фронт `contexts/AuthContext.jsx:171–174,256–258` (401/403 → invalidateSession)
- Воспроизведение: офлайн ≥5 с при сессии ~50 мин (access-TTL 15 мин, момент ротации) → после возврата auth/me 401 → auth/refresh 401 → logout, `/login`, `localStorage.user` удалён (консоль: ERR_INTERNET_DISCONNECTED ×N, WS failed ×N).
- Механизм: одноразовая ротация refresh; grace-окно старого токена 15 с; обрыв/потеря ответа дольше окна → «already used» → 401 → logout. AUTH_SECURITY_STACK.md:18–19 фиксирует как осознанный компромисс.
- Влияние: пользователи нестабильных сетей теряют сессию и несохранённый ввод; вероятная причина FE-0015/FE-0016.
- Рекомендация (решение владельца; auth-политику не менять как side effect): grace 60–120 с для web или мягкое восстановление с сохранением черновиков; замерить `refresh_reuse_detected`/`refresh_expired_or_already_used`.
- Регрессионные тесты: backend — «офлайн дольше grace → 401, в grace → успех» (unit на refresh-роут); e2e — разлогин при обрыве с сохранением несохранённого ввода.

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

### FE-0004 — Анонимный /shared-folders/:invalid показал экран входа — только в одном долгоживущем профиле; в чистом профиле НЕ воспроизводится

- Категория: PublicRoute/ServiceWorker; Серьёзность: Medium; Статус: **Suspected** (наблюдение зафиксировано, причина не подтверждена)
- История: 2026-11-22 17:16–17:18 в Chrome владельца (без сессии) `/shared-folders/:invalid` дважды показал экран входа; контроль `/shared-files/:invalid` — корректная ошибка.
- Независимая проверка 2026-11-23: в **чистом профиле** (включая точную последовательность `/dashboard` → `/nonexistent` → `/shared-folders/invalid`, return-path в sessionStorage) — **корректная ошибка «Папка недоступна — ссылка отключена или срок хранения истёк.»** Деплой в окне наблюдения исключён: файлы IIS-сайта (`C:\inetpub\wwwroot\itinvent`) не менялись с 20.11 15:10.
- Вывод: текущий production-бандл обрабатывает сценарий правильно. Вероятная причина исходного наблюдения — устаревший service-worker app-shell в долгоживущем профиле (политика `skipWaiting` только по явному сообщению — см. отчёт агента E, раздел SW): пользователь со старым shell видит устаревшие маршруты до перезагрузки.
- Рекомендация: повторить наблюдение в профиле владельца; рассмотреть UX обновления SW после деплоев («доступна новая версия»). Связанные: FE-0006.
- Регрессионные тесты: e2e-спека «публичные ссылки без сессии» (`/shared-files/:invalid`, `/shared-folders/:invalid` → тексты ошибок, без редиректа).

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
- Статус: Confirmed (код); Файл: `src/components/hub/tasks/TaskCard.jsx:322,335,363` («Удалить» :352 подписан — непоследовательность)

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
- Статус: Confirmed (код); Файлы: `SharedFolder.jsx:231,248` (публичная!); `MailTemplatesDialog.jsx:183,190,196`; `VoiceLogViewer.jsx:229,234`; `Passwords.jsx:900`; `passwords/PasswordFiltersPanel.jsx:39`; `Vcs.jsx:686`; `Mfu.jsx:990`; `UsersTab.jsx:321`

### FE-0035 — Networks: кликабельные TableRow без клавиатуры
- Статус: Confirmed (код); Файлы: `Networks.jsx:2243`, `SocketsTab.jsx:351`

### FE-0046 — ItObjectDetail: сводка «Пароли» без AbortSignal
- Статус: Confirmed (код); Файлы: `src/pages/ItObjectDetail.jsx:60`; `src/api/passwords.js:6–9` (getEntries не поддерживает signal) — дублирование при remount, не отменяется при смене :objectRef
- Источник: агент D.

### FE-0053 — Диалог создания задачи: пустой заголовок (ZWSP), имя «Dialog» по умолчанию
- Статус: Confirmed (a11y-снапшот `dialog "Dialog"`, текст начинается с ZWSP); Файл: `src/components/hub/tasks/TasksCreateDialog.jsx`
- Контраст: диалоги «Новая папка»/«Удалить папку»/«Удалить сообщение?» — с корректными заголовками.

### FE-0056 — Удаление/перемещение черновика письма: API 400; путь ошибки в UI существует (исходная проба его не зафиксировала)
- Статус: Confirmed по API-составляющей (сеть: POST `…/delete` → 400 и POST `…/move` → 400; черновик исчез из папки только после ресинка). **Коррекция после независимой проверки:** «UI молчит» из первичного отчёта не подтверждено — в коде есть путь ошибки (`useMailSelectedPreviewActions.js:28–31,41–46` → setError → Alert панели чтения, fallback «Не удалось удалить письмо.»); исходная проба не искала этот Alert. Требуется live-проверка с корректной пробой.
- Файлы: фронт `WEB-itinvent/frontend/src/api/mailMessageActions.js:28–29`; UI `components/mail/useMailSelectedPreviewActions.js:28–46`; вероятная причина — backend `WEB-itinvent/backend/services/mail_message_actions.py:83–94` (`resolve_folder`/`get` → «Message not found»: черновик не находится в резолвимой папке/ящике на момент операции)
- Серьёзность: Medium (сценарий «удалить только что сохранённый черновик» сломан на уровне API; состояние самовосстанавливается синком).
- Рекомендация: backend — воспроизвести с захватом тела 400; фронт — проверить видимость Alert при неудаче. needsBackendCheck. Связанные: FE-0077.

---

## Low

| ID | Суть | Файл/место | Статус |
|---|---|---|---|
| FE-0003 | Кнопка показа пароля 25×25px (< минимума 36px) | `Login.jsx` (форма логина) | Confirmed (замер) |
| FE-0005 | Дубли идентичных poll-запросов уведомлений на загрузке (2× poll?since=…&limit=20) | `MainLayout.jsx:1413–1611` | Confirmed (сеть) |
| FE-0010 | Английские MUI-лейблы в русском UI: «Open» у Autocomplete (/database, /scan-center, /company-structure, /warehouse-1c); на /address-book — «Открыть» (непоследовательно); «Loading...» `App.jsx:164–166` | Autocomplete popupIndicator без локализации | Confirmed |
| FE-0011 | /scan-center: переполнение 12px при 1920 (MuiGrid spacing) → горизонтальный скролл; при 1366/1280 чисто | ScanCenter (Grid «Состояние контура») | Confirmed (замер+скриншот) |
| FE-0012 | /docflow: дубль идентичных `tasks?scope=inbox` на загрузке (222+195 мс) | Docflow.jsx | Confirmed (сеть) |
| FE-0015 | Сессия сброшена при смене UA (mobile-эмуляция): /auth/me → 401 → auth-required → logout. После находки FE-0059 более вероятен общий механизм: перезагрузка попала в окно ротации (grace 15 c), UA-пиннинг не подтверждён | AuthContext + backend deps | Suspected (см. FE-0059) |
| FE-0016 | Транзиентные 5×401 в консоли при rapid-switch вкладок /tasks; при повторе не воспроизведены; возможно, окно разлогина | неизвестный ресурс | Suspected |
| FE-0017 | ESLint: 1 error (`chatRegressionFlows.test.jsx:426` 'describe' no-undef) + 1143 warnings chat, 735 warnings mail (no-unused-vars) | eslint-конфиг | Confirmed |
| FE-0018 | /voice: три запроса ~1.2–1.3 c на загрузку (jobs?limit=100, meetings?limit=20, meetings?limit=1) | VoiceVideo; причина — backend | Confirmed (замер) |
| FE-0019 | /admin: 30 API-вызовов на загрузку, auth/sessions 1.1 c | Admin/UsersTab | Confirmed (замер) |
| FE-0020 | Возраст снимка 1С в сырых секундах («169 979 сек»); интеграция 1С отстаёт на ~2 дня | /construction, /it/requests | Confirmed (needsBackendCheck) |
| FE-0036 | Мёртвые состояния equipmentLoading/socketsLoading/mapsLoading (сеттеры не вызываются) | `Networks.jsx:302–304` | Confirmed |
| FE-0037 | Вечно disabled кнопка-индикатор «Установлена» | `HubDesktopDeploySection.jsx:422` | Confirmed |
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
| FE-0050 | ChatOpen: createDirectConversation дважды в StrictMode dev | `ChatOpen.jsx:56` | Suspected (dev-only) |
| FE-0051 | swrCache: потребитель может применить «отсоединённый» ответ без перепроверки | `src/lib/swrCache.js` | Suspected |
| FE-0052 | Мобильный заголовок /scan-center — «Scan Center», десктоп — «Контроль документов»; остальные страницы русские | `ScanCenterPage.jsx:2028` | Confirmed |
| FE-0054 | При открытии диалога создания задачи — 2 идентичных GET `/hub/users/controllers` | TasksCreateDialog wiring | Confirmed (сеть) |
| FE-0057 | Панель чтения письма: блок даты (76×42, pointer-events:auto) наезжает на кнопки «Удалить»/«Ещё действия» — клик по центру кнопки попадает в дату | Mail reading pane | Confirmed (замер геометрии) |
| FE-0058 | Удаления через нативный window.confirm в 6+ местах (задачи, группы, ящики, голоса, протоколы) vs MUI-диалоги в MyFiles/чате — непоследовательный паттерн | `TaskWorkspacePanel.jsx:356`, `useAccountSectionData.js:750,873`, `ProfileTab.jsx:311`, `VoiceVoicesSection.jsx:118`, `VoiceVideoPage.jsx:455` | Confirmed |
| FE-0060 | Чат: индикатор потери связи «Нет сети» в коде ЕСТЬ (`ChatThreadHeader.jsx:37–61`); исходное утверждение «не появляется» вероятно ошибочно (проба с неверным шаблоном) — повторить наблюдение | `ChatThreadHeader.jsx:37–61` | Suspected (вероятно опровергнуто) |
| FE-0061 | Страница входа без landmark `<main>` (axe: landmark-one-main); SharedFile имеет component="main", login (Tailwind) — нет | `Login.jsx` | Confirmed (Lighthouse/axe) |
| FE-0062 | Viewport-мета запрещает масштабирование: `maximum-scale=1.0, user-scalable=no` — WCAG 1.4.4 (слабовидящие не могут увеличить). Закреплено тестом `indexHtml.test.js:10-11` — осознанное решение, требует пересмотра | `index.html:7` | Confirmed |
| FE-0063 | `/robots.txt` отдаёт SPA index.html (200, HTML) — IIS SPA-fallback не исключает robots.txt; Lighthouse: «robots.txt is not valid». Для внутреннего портала некритично, но гигиена конфига | `public/web.config:150–161` | Confirmed (live) |
| FE-0077 | Почта: POST /drafts/upsert-multipart (сохранение черновика с вложениями) местами 7–26 с — http.slow в логах backend за 19–20.11; причина требует backend-анализа | `mail_service.py:4777–4856` | Confirmed (логи; needsBackendCheck) |

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
| FE-0072 | 403 приравнен к «сессия отклонена» (isDefinitiveAuthRejection: 401 ИЛИ 403) → лишние logout, если сервер отдаёт 403-из-за-прав на auth-цепочке | `src/api/http.js:186–189`, `AuthContext.jsx:171–174,256–258` | Low | Suspected; needsBackendCheck |
| FE-0073 | quill 2.0.2 (точный pin, история XSS) — все входы/выходы обёрнуты DOMPurify-санитайзерами; npm audit не проводился (прод-сервер) | `package.json:42`, `MailRichTextEditor.jsx:161–192` | Info | Confirmed (обвязка) |
| FE-0074 | MyFiles: window.open same-origin без noopener (все прочие ~20 вызовов — с 'noopener,noreferrer') | `src/pages/MyFiles.jsx:401` | Info | Confirmed |
| FE-0075 | drawio-мост: при невалидном VITE_DRAWIO_EDITOR_URL origin='' → проверка origin пропускается, ответ postMessage на '*' (event.source-чек остаётся) | `src/components/itObjects/ObjectNetmapTab.jsx:122–135`, `src/lib/drawio.js:72–79` | Info (edge) | Suspected; рекомендация fail-closed |
| FE-0076 | AI-письмо: plain-text body отправляется с is_html=true — если сервер не экранирует, пользовательские `<` станут разметкой у получателя | `src/pages/chat/AiMailActionEditDialog.jsx:119–129` | Low | Suspected; needsBackendCheck |

**Проверено агентом E и подтверждённо защищено** (важные отрицательные результаты):
все 4 `dangerouslySetInnerHTML` — через единый DOMPurify-санитайзер; входящая почта —
анти-трекинг/анти-overlay + финальная санитизация; MarkdownRenderer — rehype-sanitize;
все 27 `target="_blank"` в JSX — с noopener; JWT не хранится в localStorage (cookie-based,
`withCredentials`), silent-refresh ~12 мин с fan-out guard; `revokeObjectURL` повсеместно;
SW-кэши версионированы, index.html/sw.js no-cache; ловких `catch {}` вокруг localStorage —
best-effort, пользовательские ошибки не глотаются; RootErrorBoundary глобальный.



## Счётчики (подтверждённые; Info-записи FE-0069/0073/0074/0075 не входят в градации)

| Серьёзность | Кол-во | ID |
|---|---|---|
| Critical | 0 | — |
| High | 3 | FE-0022, FE-0023, FE-0059 |
| Medium | 26 | FE-0001,0002,0004,0006,0007,0008,0009,0013,0014,0024–0035,0046,0053,0056,0062,0064 |
| Low | 42 | FE-0003,0005,0010–0012,0015–0020,0036–0045,0047–0052,0054,0057,0058,0060,0061,0063,0065–0068,0070–0072,0076,0077 |
| Info | 4 | FE-0069, FE-0073, FE-0074, FE-0075 |

Статусы: Confirmed 66, Suspected 9 (FE-0004, 0015, 0016, 0050, 0051, 0060, 0072, 0075, 0076).
Итого записей: 75 (74 исходных + FE-0077, найденная при независимой проверке). Изменения по итогам независимой проверки (детали — AUDIT_REVIEW.md): FE-0004 понижен High/Confirmed → Medium/Suspected (в чистом профиле не воспроизводится); FE-0056 — «UI молчит» скорректировано (путь ошибки существует); FE-0060 — вероятно опровергнуто (индикатор существует). Исходный JSON заявлял suspected:9 при фактических 8 — счётчики пересчитаны скриптом по фактическим статусам; после переклассификации FE-0004 фактических Suspected — 9.
