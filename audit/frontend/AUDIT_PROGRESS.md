# Прогресс аудита web-фронтенда

## Текущий этап: Цикл 6–7 завершены; следующий — перекрёстная проверка (цикл 8)

```text
Текущий этап: Цикл 8 (перекрёстная проверка) — завершается; точка продолжения в NEXT_ACTIONS.md
Дата и время: 2026-11-22, ~23:45
Проверенные страницы: 36/36 маршрутов открыты; мутационные сценарии выполнены и зачищены;
  мобильная вёрстка 15 страниц (375×812 viewport-only), 1366/1280/1536/1920
Проверенные компоненты глубоко: Login, MainLayout (poller/drawer), диалоги создания
  (задача/папка), композер письма, автокомплиты, контекстное меню чата, вкладки MyFiles
Подтверждённые дефекты: High 4 (FE-0004, FE-0022, FE-0023, FE-0059), Medium 24, Low 33
Неподтверждённые гипотезы: FE-0016 (транзиентные 401), FE-0050/0051 (агент D),
  FE-0060 (индикатор офлайна), PWA-баннер, несвежий список задач после создания
Сохранённые доказательства: evidence/screenshots (3), сводки агентов A/C/D,
  Lighthouse по /login, замеры PERFORMANCE.md, network/console в журнале сессии
Непроверенные области: /about, /dlp//file-egress//groups-access//kb/manage (права),
  /my-files/edit/:fileId (ONLYOFFICE), zoom 80/150%, heap/долгие сессии, холодный кэш
Ограничения: production (мутации — только тестовые данные, зачищены); отчёт агента E
  (безопасность) не получен — стоп-запрос отправлен, ответ ожидается
Следующая задача: по желанию владельца — инкогнито-тест FE-0004, отчёт агента E,
  точечные Playwright-спеки; список в NEXT_ACTIONS.md
```

## Журнал циклов

### Цикл 1 — Архитектура и карта (DONE)
- 36 маршрутов из App.jsx; стек React 18/Vite 7/MUI 5/rrd 7; vitest (unit-node, ui-dom) + Playwright.
- Production-сервер идентифицирован (PM2: backend/chat/scan/bot/voice…), IIS frontend.

### Цикл 2 — Статический анализ субагентами (A/C/D DONE; E — ответ ожидается)
- A (UI/UX): 28 находок (2 High, 21 Medium, 5 Low) — сводка в evidence/agent-A-uiux-summary.md
- C (perf): ~15 находок + сильные положительные результаты — evidence/agent-C-perf-summary.md
- D (state/cache/async): 7 находок + проверенные защиты — evidence/agent-D-state-summary.md

### Цикл 3 — Браузерное тестирование (DONE: 36/36 маршрутов, состояния — насколько возможно read-only)
- Ключевые находки: FE-0004, FE-0007, FE-0011, FE-0014, FE-0009, FE-0010, дубли запросов.

### Цикл 4 — Функциональные сценарии (DONE read-only + мутации с тестовыми данными)
- PASS: redirect-ы, дебаунс поиска, вкладки (без гонок), drawer, создание/удаление задачи,
  папки MyFiles, сообщение чата, черновик письма.
- FAIL: удаление/перемещение черновика (FE-0056, API 400 + молчание UI).

### Цикл 5 — Производительность (PARTIAL)
- Замеры по 25 страницам (PERFORMANCE.md). Тяжёлые: computers search 3.2 c,
  docflow/absences 2×3.4–3.8 c, scan/events 3.7 c, voice 3×1.2–1.3 c, admin 30 вызовов,
  database 31 вызов (all-grouped ×2 по 1000).
- Не проверено: память/долгие сессии, холодный кэш, throttling.

### Цикл 6 — State/Cache (агент D DONE)
- FE-0046..0051; подтверждено: детальные страницы/чат/auth — защищены (seq/abort/dedupe/backoff).

### Цикл 7 — Визуальный/адаптив (PARTIAL)
- 1920×1080: FAIL только /scan-center (12px overflow). 1366×768, 1280×720: PASS.
- 375×812 (viewport-only): PASS по переполнениям, кроме /scan-center (табы до 506px)
  и чипов /database (вероятно, скролл-ряд). Найден FE-0052 («Scan Center»).
- 1536×864 (эквивалент масштаба 125%): /scan-center FAIL (горизонтальный скролл), остальные PASS.
- Mobile-эмуляция с UA-сменой сбросила сессию (FE-0015) — позже переосмыслено в FE-0059.

### Цикл 8 — Перекрёстная проверка (DONE)

- **FE-0059 (High) установлен**: обрыв сети во время ротации refresh → принудительный
  разлогин (grace 15 с, auth.py:1648; задокументировано в AUTH_SECURITY_STACK.md:18–19).
  Объединяет FE-0015/0016 в одну причину. Воспроизведено офлайн-эмуляцией на /chat.
- FE-0011 подтверждён и при 1536×864 (=125% масштаб).
- Мутационные сценарии закрыты (PASS + FE-0056).
- **Агент E завершил**: 14 находок → интегрированы как FE-0064…FE-0076 (вкл. self-XSS
  через paste FE-0064); полный отчёт evidence/agent-E-security-report.md. По его ответу:
  удалений/сборок не выполнял (источник Desktop-сборки 21:45 остаётся нераскрытым —
  вероятно, внешняя сессия на сервере).
- Полные отчёты A/C/D снова доступны в evidence/ (восстановлены после инцидента).
- Перепроверка ключевых позиций своими глазами: FE-0022 (Warehouse1C:2163/1975 — onClick
  без клавиатуры), FE-0023 (EquipmentTab:351 .map без виртуализации, desktop
  виртуализируется :203/:218; лимит 10000 — Networks.jsx:871), FE-0026 (ChatBubble:1853–1856
  outline:none), FE-0027 (путь исправлен на pages/voice-video/), FE-0046 (ItObjectDetail:58–60
  signal не передаётся в passwordsAPI.getEntries). ISSUES.json валиден (74 записи).
- Итог: **High 4, Medium 25, Low 41, Info 4, Suspected 9 — всего 74 записи.**



## Инцидент 2026-11-22 ~23:00 — закрыт

Файлы отчётов `audit/frontend/` удалены; по подтверждению владельца — им самим.
Все отчёты и скриншоты восстановлены из журнала сессии. Опасения сняты.

Отдельно: сборка/тесты Desktop в 21:45–22:48 запускались не владельцем; источник
не установлен (предположительно субагент E — ответ ожидается). Остаточные
MSBuild/Roslyn-узлы простаивают, серверу не мешают. `useMailMessageFileActions.test.js`
потроган, содержимое идентично HEAD.
Меры: сохранять отчёты после каждого цикла; критичные артефакты дублировать вне репо
(`audit/` в .gitignore).

### Цикл 9 — Шесть субагентов + локальный стек (DONE)

- Запущено 6 независимых explore-агентов: ONLYOFFICE/редактор, почта, чат-realtime,
  PWA/auth/сессия, dashboard/scan/public-shares, myfiles/statistics/tasks.
  Все завершились; находки перепроверены вручную по file:line.
- Локальный стек (E2E_LOCAL=1): auth-guards 5/6 PASS — единственный FAIL
  («non-admin is redirected out of the admin area») разобран: operator легитимно
  имеет scan.tasks → canAccessAdminArea=true. Ожидание теста устарело → FE-0136
  (техдолг: красный набор маскирует регрессии).
- Runtime zoom-пробник (probe_zoom.mjs, локальный стек): dashboard/chat/my-files
  без переполнений при 80/100/150%; scan-center — docW 1930-1938>1920 на ВСЕХ
  масштабах (подтверждение FE-0011 вживую). Консоль: hubit://open/dashboard
  без обработчика → FE-0138; 404 scan-* — особенность сида, не дефект.
- /about: e2e_fresh логинится → штатный гейт онбординга на /about; скриншоты
  1920/375 — страница целостна. Ранее наблюдавшееся «/login→/about у анонима»
  признано артефактом среды (зомби-профиль Chrome/межпрогонные артефакты),
  продуктовым дефектом НЕ является; побочный вывод оформлен как FE-0137.
- PWA-гипотеза «Banner not shown» ОПРОВЕРГНУТА: осознанная подавленка +
  install-CTA в карточке настроек.
- Новые записи: FE-0077…FE-0138 (61 шт.). Из них High +2:
  FE-0077 (нет авто-реотправки failed-сообщений чата — противоречит коду и
  e2e-спецификации), FE-0082 (межвкладочная гонка refresh → family revoke →
  разлогин всех вкладок).
- Поднят: FE-0047 Low→Medium (passkey/trusted-device не сбрасывают эпоху).
- Обновлены заметки: FE-0004 (вероятная причина — устаревший бандл/SW, FE-0083),
  FE-0011 (zoom-подтверждение), FE-0060 (порог 2 c + gate ~60 c → FE-0079),
  FE-0072 (уточнено: бизнес-403 подавляются, остаток — инфра-403).
- Итог реестра: **135 записей — High 6, Medium 42, Low 79, Info 8,
  Suspected 15.**


### Цикл 10 — Контроль качества + runtime-верификация (DONE)

- **Слияние с audit/frontend-2026-11-22:** удалённый реестр (75 записей, PR-ревью)
  взят за базу для FE-0001…FE-0077; локальные цикл-9 находки перенумерованы
  +1 → FE-0078…FE-0138. Конфликт FE-0077 разрешён: почтовая находка сохранена.
  Резервная копия вне репо: C:\audit-backup-frontend-20261123-004048 (SHA256SUMS).
- Расхождение 135/136 объяснено: локальный срез потерял FE-0077 (медленный
  draft-save) — восстановлена; итоговый счёт **136 записей**.
- **FE-0078 (chat) — переформулирован после рантайм-пробы:** авто-реотправка
  существует (WS outbox flushQueue). Реальный дефект: после resend сообщение
  исчезает из ленты отправителя до reload (e2e :202 FAIL, received 0).
- **FE-0083 (refresh-race) — ПОДТВЕРЖДЁН рантаймом:** 3 параллельных refresh
  с одной кукой → [200,200,401] → family revoked → /auth/me 401 в обеих
  вкладках (общий cookie jar). Реальный триггер: silent-refresh на
  visibilitychange при пробуждении N вкладок.
- Выборочная перепроверка 24 записей: FE-0079/0080/0081/0082(уточнён)/
  0085/0087/0088/0089/0090/0091/0093/0095/0097/0106/0107/0108/0109/0115/
  0123/0124(→Suspected)/0127/0129/0130/0131/0133 — механизмы подтверждены
  по file:line; пути исправлены (agents указали неверные каталоги).
- FE-0136 (auth-guards спека) переклассифицировано: техдолг теста, Low —
  не дефект приложения.
- Валидатор (audit/frontend-2026-11-22) прогнан: 0 ошибок; схема
  evidence/verification приведена к конвенции ветки.
- Итог: **136 записей — High 5, Medium 41, Low 82, Info 8, Suspected 17**
  (Confirmed 119, Suspected 17 по статусам).

### Цикл 11 — Волна субагентов ×6: глубокое покрытие страниц (DONE)

- 6 независимых read-only субагентов: Networks, Tickets/KB/Feed/Docflow,
  Voice/Monitoring, Login/Auth/Layout, Chat/Mail-libs, Account/Admin.
- **+113 новых записей: FE-0139…FE-0251.** Итог **249 записей** —
  High 11, Medium 97, Low 132, Info 9; Confirmed 214 / Suspected 35.
- Новые High (+6): FE-0208 backup-коды 2FA недостижимы (LoginRoute unmount
  до setStep), FE-0209 required trusted-device недостижим, FE-0217
  inline-изображение письма теряется после autosave, FE-0229 ранний return
  до хуков → крах настроек в Desktop, FE-0231 стирание делегатов при
  bulk-загрузке, FE-0237 гонка менеджеров отделов → порча ролей.
- Перепроверено вручную: drawio saveThenClose (FE-0139), networks
  sync-on-read (FE-0143), backup-codes race (FE-0208), delegates wipe
  (FE-0231), hooks-order (FE-0229) — все подтверждены.
- Merge-доработки: FE-0082 дополнен (typing cleanup), FE-0115 дополнен
  (+2 точки revokeObjectURL).
- Валидатор: 0 ошибок; 1 неверный путь исправлен (FE-0152).
- «Проверено корректно» от агентов: useRequestGuard, swrCache,
  read-receipts, upload-resume, livekit-сессия, drawer AbortController,
  MyFilesAdminBrowser (эталон), SWR requestSeq, командная палитра ARIA.

### Цикл 11 (продолжение) — волна ×4 + рантайм-пробы (в работе)

- Дополнительные субагенты: Tasks/Construction/Company/AddressBook,
  Computers/Transfer/DLP/Statistics, MyFiles+Chat-остатки, Scan/Database.
- **+78 записей: FE-0252…FE-0302** (включая рантайм FE-0252/0253/0254).
  Итог на момент фиксации: **300 записей — High 12, Medium 113,
  Low 162, Info 13; Confirmed 246 / Suspected 54**.
- Новые High: FE-0259 — нет beforeunload в construction-workspace
  (потеря черновиков при F5, в Panel/Canvas он есть).
- Рантайм-подтверждено: /database +400px overflow при zoom 200%
  (FE-0252), heap 85→85→143MB за 3 раунда ×8 маршрутов (FE-0253,
  Suspected), validateDOMNesting <button> на /networks вживую
  (FE-0155 повышен до Confirmed runtime), hubit:// console-ошибка
  в браузере (FE-0254 Info).
- Матрица 500: /tasks|/mail|/database под сплошным 500 — layout и
  alert-ы показываются (деградация работает, дефекта «белый экран» нет).
- Отмечено verified-fixed (не дефект): CompanyStructureOverview
  getElk().then — .catch присутствует (:379-381).
- CLAUDE.md устарел: Search.jsx/Transfer.jsx/Work.jsx — несуществуют
  (информация агента Computers).
- Волна ×4 завершена: Tasks/Construction/Company (22), Computers/Transfer/DLP
  (22), Scan/Database (20), ручная доработка MyFiles/ChatContextPanel (3),
  revealMessage/loadMeetings/offlineCache/TGS (4), рантайм (3).
- **ИТОГ ЦИКЛА: 322 записи — High 12, Medium 122, Low 174, Info 14;
  Confirmed 266 / Suspected 56.** Цель «≥300» перевыполнена.
- Dedup при мерже: Statistics-revoke→FE-0291, openActFile→FE-0283,
  export-movements→FE-0302 (повышен до Confirmed).
- Runtime: офлайн-баннер «Нет подключения» работает; dino-страница при
  document-навигации офлайн — артефакт vite-dev (SW только PROD, а
  handleNavigationRequest в sw.js имеет network+cache+fallback — корректно).
- Агент MyFiles deep (c5d05716) упал на rate-limit дважды — область
  покрыта частично ручным проходом (FE-0303/0304) — дочитать в цикле 12.

## Цикл 12 — перепроверка всех 322 записей (2026-11-23)

- Проверены все 322 записи: чанки 1–8 (chunk_1..8.json), вердикты в
  evidence/cycle12/verdicts_1..8.json. Чанк 2 перезапущен после падения
  агента; чанк 3 доверифицирован вручную и сверен с отдельным агентом;
  High-12 проверены отдельно.
- Вердикты: confirmed 290 / not-a-defect 17 / unverifiable 10 /
  wrong-evidence 4 / fixed-externally 1; missing 0, дублей id 0.
- После слияния: Confirmed 254, Suspected 50, Fixed-externally 1,
  Rejected 17; всего 322. Severity не менялась: High 12, Medium 122,
  Low 174, Info 14.
- Rejected (17): FE-0025, FE-0037, FE-0060, FE-0106, FE-0111, FE-0116,
  FE-0136, FE-0172, FE-0173, FE-0174, FE-0184, FE-0193, FE-0196,
  FE-0210, FE-0211, FE-0212, FE-0231 — ложные срабатывания/намеренное
  поведение, обоснования в evidence каждой записи.
- Fixed-externally (1): FE-0225 — отправка стикера уже использует
  ref-guard и client_message_id (useChatStickerSending.js:17-50).
- Wrong-evidence (4): FE-0034 (Tooltip даёт aria-label; реальные случаи
  Vcs/Mfu/UsersTab), FE-0115 (revoke находится в mailMessageFileActions.js:357-359),
  FE-0182 и FE-0250 (уточнены file/lines/формулировка).
- Unverifiable (10): FE-0004, FE-0015, FE-0016, FE-0051, FE-0075,
  FE-0076, FE-0157, FE-0253, FE-0323, FE-0324 — переведены в
  Suspected с пояснением.
- High-12 подтверждены: FE-0022, FE-0023, FE-0059, FE-0078, FE-0083,
  FE-0197, FE-0198, FE-0215, FE-0230, FE-0232, FE-0239, FE-0259.
  FE-0197/0198: verifyTwoFactorSetup/Login вызывают applyAuthenticatedPayload
  (setUser) до setStep('setup_complete')/remember-device, LoginRoute
  (App.jsx:237-252) размонтирует Login раньше — экран backup-кодов и
  обязательная привязка устройства недостижимы.
- FE-0230: ChatNotificationsSettingsCard переехал в
  pages/account/settings/notifications/; ранний return null до хуков
  сохранён, путь в реестре обновлён.
- Бэкап перед слиянием: audit/frontend/backups/ISSUES-20261123-093910.json
  (и .md). Валидатор: 0 ошибок. ISSUES.md перегенерирован (247 карточек
  FE-0078+; карточки FE-0025/0034 обновлены вручную).
- Ограничения: перепроверка статическая по коду + ранее снятые runtime-
  доказательства; production не трогали, новые живые пробы не выполнялись.

## Цикл 13 — глубокая runtime-верификация (2026-11-23)

- База: audit-коммит a7174909 (322 записи), проверка кода на HEAD 8462d971 + рабочее дерево.
- Изолированный стенд: e2e/stack/local_backend.py (SQLite .state-cycle13, 18002) + vite 5219;
  trial-сборка вне dist + vite preview 5221. Production/IIS/PM2/.env не затрагивались.
- Качество реестра: заполнены все 23 записи без lines (0 пустых), исправлены 4 wrong-evidence,
  для всех 323 записей добавлены originalClaim/originalEvidence/currentConclusion/reverificationHistory
  и statusModel с объяснением 290 confirmed-вердиктов vs 254 Confirmed-статусов.
- Live High: FE-0197 и FE-0198 подтверждены в браузере (после verify URL сразу /dashboard,
  backup-коды и trusted-device sheet не появляются); FE-0083 подтверждён API-пробой
  [401,200,200] -> /auth/me 401; FE-0078 прошёл E2E chat-realtime 3/3 и переведён в Fixed-externally.
- FE-0230: попытка live-симуляции позднего desktop.hostReady не дала React-ошибки; статус Confirmed (static).
- 50 Suspected перепроверены 6 независимыми агентами: подтверждено 18, опровергнуто 23,
  unverifiable 9; с live/High и FE-0325 итого 27 confirmed / 23 refuted / 9 unverifiable / 1 fixed.
- Новый дефект FE-0325 (Medium, Confirmed): offline cold reload PWA висит на «Загружаем раздел…»
  >65 c; AuthContext бесконечно ретраит refresh при status=0, SW отдаёт shell 200.
- Глубокие тесты: 12 раундов x 8 маршрутов с принудительным GC — heap плато 49-51 MB,
  монотонного роста нет (FE-0253 остаётся unverifiable); SW регистрируется/контролирует,
  offline shell 200, но auth recovery не завершается.
- Итог: 323 записи; Confirmed 269, Suspected 12, Fixed-externally 2, Rejected 40;
  High 12, Medium 123, Low 173, Info 15. Валидатор: 0 ошибок.
- Подробный отчёт: CYCLE_13_REVIEW.md; evidence/cycle13/.

## Цикл 14 — runtime-покрытие и критические сценарии (2026-11-23)

- База d2fe61a7; код HEAD 5513db68. Изолированные стенды 18002/5219, 18004/5222 (2FA),
  trial-сборка + прокси 5223. Production не затрагивался.
- Схема verification v2: static-code / local-browser / local-browser-mock / local-api /
  test-harness / production-observer; старые значения в verificationLegacy.
- FE-0253 переведён в Rejected: 12 раундов с принудительным GC дали плато 49–51 MB
  и 23 MB после полного GC; утечки нет.
- FE-0194/FE-0300/FE-0324 остаются Suspected с statusRationale: статический механизм
  подтверждён, но пользовательский эффект требует недоступных данных/сценария.
- Real 2FA flow: FE-0197 и FE-0198 подтверждены без route-mocking (setup -> TOTP ->
  dashboard; backup-коды и remember-device не появляются).
- FE-0083: две вкладки, [200,401,200], новый refresh -> 401 revoked, обе вкладки на /login.
- FE-0023: 10k портов на mobile -> ~30.45 c блокировки, 181642 DOM-узла, heap 930 MB.
- FE-0325 уточнён: свежая офлайн-сессия висит >50 c, но только 2 refresh-попытки;
  reconnect возвращает /login за ~2 c; с сохранённой сессией показывается cached dashboard.
- Функциональные сценарии: +12 маршрутов (всего 24/36 = 66.7%); back и mobile overflow проверены.
- Итог: 323 записи; Confirmed 269, Suspected 11, Fixed-externally 2, Rejected 41.
  Валидатор: 0 ошибок. Отчёт: CYCLE_14_REVIEW.md.

## Цикл 15 — оставшиеся High и функциональная глубина (2026-11-23)

- База eb83a0c0; проверенный build 5513db68, текущий main 467512e5 (изменён только MyFiles).
- verification нормализован: 304 static -> static-code; enum валидатора строгий;
  старые значения в verificationLegacy. FE-0253: Rejected только для проверенного
  сценария, отсутствие утечек в целом не доказано.
- High breakdown: исторические 12, актуальные 11, runtime 7, static-only 5.
- FE-0022 подтверждён на мокированной таблице: clickable td/tr без tabindex/role,
  клавиатурной цели нет.
- FE-0059 подтверждён API: потерянный ответ ротации + 185 c > grace -> refresh 401
  revoked, /auth/me 401.
- FE-0325: 3 цикла offline/online с существующей сессией стабильны (~2.6 c);
  stale SW waiting не активируется и не показывается в settings.
- Functional +12 маршрутов (help, menu, it/objects, it/requests, groups-access,
  voice, monitoring, shared-files, admin, file-egress, dlp, chat/open); итого 36
  маршрутных сценариев, E2E 3.
- Остались static-only: FE-0215, FE-0230, FE-0232, FE-0239, FE-0259.
- Итог: 323 записи; Confirmed 269, Suspected 11, Fixed 2, Rejected 41.
  Валидатор 0 ошибок. Отчёт CYCLE_15_REVIEW.md.

## Цикл 16 — реальное покрытие и глубокие E2E (2026-11-23)

- База 60dfe457; проверенный код — чистый main 4776ce5f (PR #14), собран с
  локальными VITE_*-флагами из root .env (не публикуется).
- Инвентаризация из App.jsx: 51 route entry, 5 redirect, 46 user-visible,
  12 admin sections, 6 settings tabs.
- Реальное покрытие: E2E 6 (13.0%), Functional 26, Functional+E2E 32/46 (69.6%),
  Smoke-only 7, Blocked 7. «36 сценариев» = 32 route entry, не 100%.
- Новые полные E2E (5): feed publish, tasks create+edit+checklist, chat notes
  send+cross-tab+reload, my-files upload+search+preview, admin user create.
  Всего E2E-сценариев 8.
- FE-0083 подтверждён: 3 parallel refresh -> [200,200,401]; токены победителей
  после burst -> 401, family отозвана; sequential within grace -> [200,200].
- FE-0059 уточнён: старый токен после grace -> 401 revoked, но НОВЫЙ токен той же
  ротации остаётся 200; family не отозвана, причина logout — потеря ответа.
- Blocked: FE-0215 (нет mailbox), FE-0230 (нет WebView2), FE-0232/0239 (нет
  fixtures), FE-0259 (Construction 502), /database и /my-files/edit.
- Итог: 323 записи, Confirmed 269, Suspected 11, Fixed 2, Rejected 41.
  Валидатор 0 ошибок. Отчёт CYCLE_16_REVIEW.md.
