# CYCLE 13 — глубокая runtime-верификация frontend

- Дата: 2026-11-23
- База аудита: PR #9, audit-коммит `a7174909` (322 записи).
- Кодовая база проверки: рабочее дерево `C:\Project\HUB-IT-main`, HEAD `8462d971` + незакоммиченные правки пользователя на момент проверки. После завершения проверки main перешёл на `5513db68` (merge PR #11); файлы Auth/Login/chat/http/desktopBridge, затронутые live-проверками, между этими коммитами не менялись.
- Изолированный стенд: `e2e/stack/local_backend.py` (throwaway SQLite `.state-cycle13`, порт 18002) + `vite` (5219); trial-сборка в `output`-вне-`dist` (порт 5221). Production, IIS, PM2, `.env` и реальные данные не затрагивались.

## 1. Итог

| Показатель | Значение |
|---|---|
| Записей в реестре | **323** (было 322, добавлена FE-0325) |
| Новых подтверждённых дефектов | **1** — FE-0325 (PWA offline hang) |
| Существующих дефектов, подтверждённых в браузере | **3** — FE-0197, FE-0198, FE-0083 |
| Исправлено внешним кодом (browser proof) | **1** — FE-0078 |
| Опровергнуто в цикле 13 | **23** |
| Осталось Suspected | **12** |
| Статусы после цикла 13 | Confirmed 269 / Suspected 12 / Fixed-externally 2 / Rejected 40 |
| Severity | High 12 / Medium 123 / Low 173 / Info 15 |

Вердикты цикла 13 (60 уникальных записей: 50 Suspected + 9 High/live + FE-0325):
**confirmed 27, refuted 23, unverifiable 9, fixed-externally 1**.

## 2. Качество реестра

### 2.1. 23 записи без `lines`

Все 23 записи получили конкретные диапазоны либо явный `linesNote`:

- FE-0083, FE-0084, FE-0085, FE-0086, FE-0099, FE-0100, FE-0102, FE-0104,
  FE-0106, FE-0107, FE-0108, FE-0109, FE-0111, FE-0114, FE-0115, FE-0117,
  FE-0120, FE-0123, FE-0128, FE-0136, FE-0137, FE-0138.
- FE-0016 — `lines: "n/a"` + `linesNote`: источник 401 не установлен, URL не сохранены, повторная проба без 4xx/5xx.

Проверка: `node -e` по реестру — записей с пустым `lines` **0**.

### 2.2. Четыре wrong-evidence

Исходные утверждения сохранены в `originalClaim`/`originalEvidence`; текущие выводы — в `title`/`file`/`lines`/`currentConclusion`.

- **FE-0034** — сужено до реальных случаев: `UsersTab.jsx:321`, `Mfu.jsx:988-990`, `MailTemplatesDialog.jsx:183/190`, `SocketsTab.jsx:285/381`, `EquipmentTab.jsx:313` (Tooltip→span). SharedFolder/Vcs/Passwords/Voice — ложные (Tooltip даёт aria-label).
- **FE-0115** — ссылка исправлена на `mailMessageFileActions.js:337-360`; синхронный revoke остаётся в якорной ветке, 60 с — только popup-ветка iOS standalone; поведение iOS Safari не проверено.
- **FE-0182** — старая формулировка про TypeError опровергнута; актуальный дефект: нет `.catch`/fallback у `clipboard.writeText`, unhandled rejection, setTimeout не очищается.
- **FE-0250** — `adminOnlyFallback` не мёртв, но избыточен; подтверждён только test-only `resolveAvailableSettingsTabs`; severity понижена до Info.

### 2.3. Почему в цикле 12 было 290 confirmed-вердиктов и 254 Confirmed-статуса

`verdict` — результат конкретной перепроверки, `status` — текущее состояние записи в реестре. В цикле 12:

- 290 записей получили verdict `confirmed`;
- 254 из них имели статус `Confirmed`;
- **36** остались `Suspected`: код подтверждал утверждение, но пользовательский эффект зависел от dev-only/среды/объёма данных (например, FE-0050, FE-0072, FE-0197 до live-проверки);
- остальные 32: 17 Rejected, 10 unverifiable, 4 wrong-evidence, 1 fixed-externally.

После цикла 13 статусы пересчитаны по последним доказательствам; 36 «confirmed-but-Suspected» прошли повторную проверку, часть из них опровергнута или подтверждена live. Формула и история сохранены в `ISSUES.json.statusModel` и в `reverificationHistory` каждой записи.

### 2.4. История

Для всех 323 записей добавлены:

- `originalClaim` — исходное утверждение (не перезаписывается);
- `originalEvidence` — доказательства до циклов 12/13;
- `currentConclusion` — актуальный вывод;
- `reverificationHistory` — `{cycle, date, verdict, note}` для циклов 12 и 13.

## 3. Live-проверка High

### FE-0197 — backup-коды 2FA недостижимы (подтверждено)

На изолированном стенде Playwright route-mocked auth flow: `login → 2fa_setup_required → enable-2fa → verify-2fa`, ответ verify содержал `backup_codes`.

- После submit на 250/800/2000/4000 мс URL уже `/dashboard`;
- текст «Сохраните backup-коды» и коды `AAAA-BBBB` не появлялись;
- `localStorage.user` установлен.

Причина: `verifyTwoFactorSetup` вызывает `applyAuthenticatedPayload` (setUser) до `setStep('setup_complete')`; `LoginRoute` (`App.jsx:237-252`) размонтирует Login.

### FE-0198 — обязательная привязка trusted-device недостижима (подтверждено)

Аналогичный flow `login → 2fa_required → verify-2fa-login` с `discoverable_trusted_devices_count=0`, `network_zone=external`.

- После submit URL сразу `/dashboard`;
- `[data-testid="login-remember-device-dialog"]` не появлялся ни на одном срезе.

### FE-0083 — межвкладочная гонка refresh (подтверждено live API)

- 3 параллельных `POST /api/v1/auth/refresh` с одной cookie: `[401, 200, 200]`;
- затем `GET /api/v1/auth/me` с исходными cookie: **401** «Could not validate credentials».

Token family отозвана; все вкладки с общей cookie jar разлогиниваются (`http.js:54,66-76`; `auth.py:135,1648-1675`).

### FE-0078 — offline-send в чате (fixed-externally)

`E2E_LOCAL=1` `e2e/chat-realtime.spec.js` на отдельном стеке 18003/5220:

- **3 passed (1.9m)**;
- кейс «message sent while the sender is offline goes out on reconnect exactly once» прошёл за 23.4 с, включая sender count=1 после reconnect и после reload.

На коммите `1a94d39a` этот кейс падал; на `8462d971` — проходит. FE-0078 переведён в `Fixed-externally`.

### FE-0230 — hooks order в Desktop (не воспроизведено live)

Статический дефект остаётся: ранний `return null` до хуков в `HubItPwaSettingsCard`/`ChatNotificationsSettingsCard` при позднем `bridgeReady`. Симуляция `desktop.hostReady` на стенде переключила `data-desktop-shell`, но React-ошибки не дала: принудительный re-render размонтировал поддерево карточки. Live-воспроизведение требует реального WebView2 с поздним handshake; статус оставлен Confirmed (static).

### Остальные High

- **FE-0022, FE-0023, FE-0059, FE-0215, FE-0232, FE-0239, FE-0259** — статически подтверждены, live не выполнялись: нет Document Server/mailbox/1C/SQL/desktop-хоста. Причины зафиксированы в `currentConclusion`.

## 4. Перепроверка 50 Suspected

Все 50 записей распределены по 6 направлениям и проверены независимыми агентами; каждый вердикт содержит code refs и confidence. Итог по 50 Suspected:

- **Подтверждено (confirmed)** — 18;
- **Опровергнуто (refuted)** — 23;
- **Unverifiable** — 9;
- **Fixed-externally** — 0.

С учётом 9 live/High-записей и FE-0325 общий итог цикла 13: 27 confirmed, 23 refuted, 9 unverifiable, 1 fixed-externally.

Ключевые опровержения:

- FE-0015/FE-0016 — дубли/следствия FE-0059, отдельного воспроизводимого дефекта нет.
- FE-0072 — 403 не вызывает logout обычных запросов; refresh отдаёт 401, 403 на `/auth/me` — admin-IP policy.
- FE-0075 — `origin || '*'` недостижим: невалидный URL падает до iframe.
- FE-0257 — `JSON.parse` обёрнут try/catch вызывающего; повреждённая запись = cache miss.
- FE-0050/FE-0258/FE-0303 — нет дублирующего POST/TGS-падения/двойного group action.
- FE-0132, FE-0157, FE-0162, FE-0175, FE-0256, FE-0260, FE-0261, FE-0263, FE-0267, FE-0270, FE-0273, FE-0276, FE-0280 — защитные/narrow-code наблюдения без достижимого пользовательского сценария (подробности в `evidence/cycle13/verdicts_state_race.json`).
- FE-0216 — бэкенд отдаёт относительный `inline_src`, а не `data:`/absolute; стрип remote/data — намеренная защита.
- FE-0279 — inert-зазор есть, но демонстрируемого ухода фокуса в текущих порталах нет.

Оставшиеся **12 Suspected**: FE-0004, FE-0051, FE-0076, FE-0110, FE-0115, FE-0161, FE-0194, FE-0253, FE-0265, FE-0300, FE-0323, FE-0324.

## 5. Новые глубокие испытания

### 5.1. Service Worker и offline cold start

Trial-сборка (`vite build` вне `dist`) + `vite preview :5221`:

- SW регистрируется, active/controller=true;
- кэши: `hubit-app-shell-*`, `hubit-app-assets-*`, `itinvent-push-runtime-v1`;
- cold load `/login` — 110 мс;
- offline reload отдаёт shell **200**, но страница остаётся на «Загружаем раздел… | Подготавливаем интерфейс HUB-IT» на 10/30/55/65 с.

**Новый дефект FE-0325** (Medium, Confirmed): `AuthContext.verifySession` при status=0 (offline) бесконечно повторяет retry с максимальной задержкой 30 с и не вызывает `setLoading(false)`; SW при этом исправно отдаёт shell. Пользователь PWA/Desktop видит вечный загрузчик вместо входа/офлайн-экрана.

### 5.2. Память: 12 раундов × 8 SPA-маршрутов

Playwright + CDP, `HeapProfiler.collectGarbage` перед каждым чтением:

`37.1 → 47.7 → 49.0 → 49.5 → 50.3 → 50.6 → 50.7 → 50.9 → 23.3 → 44.6 → 48.3 → 49.2 MB`

После прогрева heap плато ~49–51 MB и падает до 23 MB после полного GC. Монотонного роста нет; FE-0253 остаётся **unverifiable** (исходные 85→143 MB — GC/lazy-chunk шум, а не доказанная утечка).

### 5.3. HTTP 401/403/429/500

- 401 на `/hub/tasks` → редирект на `/login` (сессия трактуется как отклонённая);
- 403 → в области задач отображается сырой backend `detail` («E2E forced 403»), без logout;
- 429/500 не завершены: исчерпан лимит логинов изолированного стенда (5/мин). Зафиксировано как ограничение, не как дефект.

### 5.4. Мультивкладочность

API-проба refresh race (FE-0083) воспроизвела отзыв family. Полноценный UI-сценарий двух вкладок с общими cookie не запускался; это ограничение покрытия.

### 5.5. Большой объём данных

Публичная папка с синтетическими **2000 файлами** (route-mocked payload, изолированный стенд):

- первый рендер — **8.38 с**;
- **20 180** DOM-узлов, **2001** интерактивный элемент;
- высота body — **98 184 px**, JS heap — **186 MB**.

Это подтверждает пользовательский эффект FE-0098 (неограниченный `items.map` без виртуализации/пагинации), а не только наличие строки кода. Скриншот: `evidence/cycle13/live-large-sharedfolder.png`.

## 6. Покрытие и метод расчёта

| Метрика | Значение | Метод |
|---|---|---|
| Статическое покрытие реестра | **323/323 = 100%** | Каждая запись имеет file/lines или linesNote и вердикт цикла 12/13 |
| Перепроверка Suspected | **50/50 = 100%** | 6 независимых агентов + ручная сверка High |
| Функциональное покрытие маршрутов | **12/36 = 33.3%** | Уникальные маршруты, реально отрисованные в Playwright на стенде: `/login`, `/dashboard`, `/tasks`, `/my-files`, `/chat`, `/networks`, `/computers`, `/database`, `/statistics`, `/settings`, `/settings/app`, `/shared-folders/:token` |
| Runtime-покрытие находок | **7/323 = 2.2%** | Записи с новым live-доказательством в цикле 13: FE-0197, FE-0198, FE-0078, FE-0083, FE-0098, FE-0253, FE-0325 |
| Runtime-покрытие High | **4/12 = 33.3%** | Live: FE-0197, FE-0198, FE-0083, FE-0078; FE-0230 — попытка live, inconclusive |
| High с попыткой live | **5/12 = 41.7%** | + FE-0230 |

Метод: маршрут считается функционально покрытым, если он хотя бы один раз отрисован в браузере на изолированном стенде (не 200 от vite и не статический импорт). Runtime-покрытие находки — наличие live browser/API-доказательства в цикле 13, а не только code review. Проценты не экстраполируются на production.

## 7. Что нельзя проверить в этой среде

- Реальный ONLYOFFICE Document Server: FE-0110, FE-0112, FE-0113, FE-0119.
- Реальный почтовый провайдер/mailbox: FE-0215, FE-0216; локальный стек запускается с `MAIL_MODULE_ENABLED=0`.
- Реальный WebView2/Desktop с поздним `bridgeReady`: FE-0230.
- iOS Safari/WebKit: FE-0115 (синхронный revoke), мобильные safe-area/zoom-сценарии.
- Production-объёмы: >10000 портов/розеток (FE-0161), >1000 отделов (FE-0324), >200 чатов (FE-0300), большие SharedFolder (FE-0098).
- 1С/SQL-данные строительного workspace: FE-0259, FE-0260, FE-0261.
- 429/500 UI: лимит логинов изолированного стенда; нужен отдельный прогон с заранее созданной сессией.
- Полный UI двух вкладок с общими cookie: FE-0083 проверен на API-уровне.

## 8. Доказательства

- `audit/frontend/evidence/cycle13/verdicts_*.json` — 60 вердиктов с codeRefs/confidence.
- `audit/frontend/evidence/cycle13/live-evidence.md` — протокол live-проверок.
- `audit/frontend/evidence/cycle13/live-fe0197.png`, `live-fe0198.png` — скриншоты после verify.
- `audit/frontend/evidence/cycle13/live-chat-e2e.log` — 3 passed chat-realtime.
- `audit/frontend/evidence/cycle13/cycle13_summary.json` — счётчики и verdict breakdown.
- `audit/frontend/ISSUES.json` — `statusModel`, `originalClaim`, `currentConclusion`, `reverificationHistory`.

Ключевые code refs: `Login.jsx:1404-1521`, `AuthContext.jsx:310-339,557-568`, `App.jsx:237-252`, `http.js:54,66-76`, `auth.py:135,1648-1675`, `chatSocket.js:1107-1186`, `useChatThreadMessageMerge.js:25-68`, `useMyFilesEditorSession.js:436-440`, `my_files_collab_service.py:844`, `useAccountSectionData.js:244-251,637-644`, `DepartmentsTab.jsx:58-89,129-142`, `ConstructionWorkWorkspace.jsx:40-41,165`.
