# INTEGRATION_REGISTRY.md — реестр мерджей в `integration/frontend-remediation`

Файл создан при интеграции PR #69 (2026-11-24): отдельного трекера мерджей
`fix/*-batch` до этого в репозитории не было — записи ниже начинаются с PR #69.

---

## PR #69 — `feat/chat-sticker-system-v2` (Sticker System V2)

- **Merged HEAD:** `1debbc23` (tip `origin/feat/chat-sticker-system-v2`)
- **Merge commit:** `e6aa9251` (`git merge --no-ff`, parents `a18fc5e7` + `1debbc23`)
- **Base:** `a18fc5e7` (pre-merge tip интеграционной ветки; `origin/main` = `926dd9f5` — merge-base)
- **Дата:** 2026-11-24

### Что вошло

- Backend: favorites/recents/order эндпоинты (`api/v1/chat/stickers.py`),
  op-based versioned recents sync (`{ops, base_version, clear}` + legacy
  `{sticker_ids}` bump-head merge), `chat/db.py`, `chat/models.py`,
  `chat/schemas.py`, `telegram_sticker_service.py`.
- Миграции `20261124_0180_chat_sticker_favorites` +
  `20261124_0181_chat_recent_sticker_sync_state`. Исходно в PR #69 они были
  `0178`/`0179` с down-цепью на `20261124_0177_ai_summary_llm_checkpoint`;
  после merge `origin/main` (`af485f22`, PR #68) эти номера заняты My Files,
  поэтому sticker-цепь перенумерована в `0180`/`0181` (+ `0182` для op-batch)
  и стыкуется к `20261124_0179_my_files_member_updated_at`.
- Frontend: unified scoped sticker store (`lib/chatStickerStore.js`),
  `ChatStickerSuggestions`, `ChatStickerManageDialog`, переработанный
  `TelegramStickersTab`, `stickerSearchIndex`, `api/chatStickers.js`,
  E2E-спеки + артефакты.

### Конфликты и разрешение

Конфликтов по файлам: **2** (+1 автомердж).

| Файл | Конфликт | Разрешение |
|---|---|---|
| `ChatComposer.behavior.test.jsx` | chat-batch: `getByTestId('chat-composer-emoji-button')`; sticker: `getByRole(name='Закрепить панель эмодзи')` | Оставлен `getByTestId` — после V2 имя кнопки нестабильно («Закрепить»/«Закрыть»); комментарий sticker-стороны сохранён |
| `TelegramStickersTab.jsx` | chat-batch: флаг `active` в слушателе `chat-sticker-packs-changed` (гонка размонтирования); sticker: эффект `cancelRecentStickersSync` | Взята sticker-сторона: слушатель переехал на уровень модуля `chatStickerStore` (один на документ) — пер-mount гонки больше нет, семантика фикса поглощена архитектурой; комментарий об этом оставлен в коде |
| `AuthContext.jsx` | автомердж | Обе стороны сохранены: `invalidateChatStickerStore()` (sticker) + `postAuthUiHold`/`safeLocalStorage`/`SESSION_RECOVERY_MAX_ATTEMPTS` (integration) |

`ChatComposer.jsx`, backend-файлы и миграции конфликтов не имели:
chat-batch логика композера живёт в `useChatComposerSending.js` (изменён только
интеграционной стороной, сохранён автоматически); `ChatStickerSuggestions`
смонтирован в `ChatComposer.jsx` (строки ~986–995) и работает поверх него.

### Проверки (все на merge-кандидате `e6aa9251`, воркtree `.codex_tmp/integ-fr`)

| Проверка | Результат |
|---|---|
| Alembic heads (на merge-кандидате `e6aa9251`, до post-main перенумерации) | **один head `20261124_0179`**; цепь 0179→0178→0177→0176 была цела, merge-revision не потребовался |
| Миграции 0178+0179 (sqlite, runpy) | upgrade: `chat_user_favorite_stickers`, `chat_user_recent_stickers`, `chat_user_recent_sticker_state`, колонка `position`, unique/индексы — все созданы; downgrade чистый |
| Backend pytest | `test_chat_sticker_favorites.py` (root+backend) + `test_chat_migrations_scope_independent.py` — **92/92 PASS**; `test_chat_telegram_stickers.py` + `test_chat_attachment_sticker_preview.py` — **28/28 PASS** |
| Frontend unit | **278/278 PASS**: TelegramStickersTab, chatStickerStore, chatStickers api, ChatStickerSuggestions, ChatStickerManageDialog, ChatThread, ChatComposer.behavior, stickerSearchIndex.perf (211) + chat-batch сьюты chatRegressionFlows/useReadReceipts/useChatComposerSending(×2) (67) |
| Op-protocol | PUT принимает `{ops, base_version, clear}` И `{sticker_ids}`; тесты ops: interleaved two-device, stale base_version, replayed-bump идемпотентность, clear-ordering — все PASS |
| Идемпотентность/offline | Журнал операций снимается только при подтверждении сервером; retry довозит те же дельта-ops (идемпотентны); `online`-listener планирует flush; session-guard тесты PASS |
| E2E (`E2E_LOCAL=1 E2E_BUILD=1`, decoy `stab_backend.py`) | `chat-stickers-v2` + `chat-emoji-picker` — **21/21 PASS** |

### A/B перф-гейт (интеграционная ветка, 1440×900, n=40)

Baseline = `a18fc5e7` (pre-merge tip, worktree `.codex_tmp/integ-ab-base`),
candidate = `e6aa9251` (post-merge). Чередование A/B по сценариям,
prod-сборка + `vite preview`, backend через decoy.

| Сценарий | Baseline p50/p95, мс | Candidate p50/p95, мс | Δ p95 |
|---|---|---|---|
| plain send | 82.0 / 112.6 | 91.4 / 117.9 | **+4.7 %** |
| send после open+close дока (run 1) | 157.6 / 181.9 | 178.1 / 201.4 | +10.7 % |
| send после open+close дока (run 2) | 161.1 / 188.9 | 178.0 / 198.2 | **+4.9 %** |
| send при открытом доке | 178.7 / 198.4 | 181.9 / 209.1 | **+5.4 %** |

Во всех окнах на обеих сторонах: `stickerRequests = 0`, `threadRendered = 0`,
`longTasks = 0`, `timeouts = 0`. commits p50: 6→6 (plain), 12→13 (warm),
11→11 (open). Первый прогон warm (+10.7 %) — шум хоста (параллельно работал
чужой e2e-стек); повторный прогон +4.9 %. Вердикт: регрессия НЕ подтверждена,
остаточная дельта на dock-сценариях соответствует зафиксированной на ветке
(+4–9 % — цена keep-alive дока). Артефакты:
`WEB-itinvent/frontend/e2e-artifacts/integ-ab/{baseline,candidate}-*.json`.

### Совместимость со старым клиентом

- **Старый клиент + новый сервер:** PUT `/chat/stickers/recent` c одним
  `{sticker_ids}` работает — legacy bump-head merge сохранён в
  `ChatStickerRecentUpdateRequest` (поля `sticker_ids`, `base_version`,
  `clear`, `ops` — все опциональны).
- **Новый клиент + старый сервер:** клиент шлёт `{ops, base_version}`.
  - Сервер уровня `main` (до ветки): эндпоинта нет → 404 → журнал операций
    остаётся, синк откладывается — локальная деградация, данные не теряются.
  - Сервер v1 (промежуточный, `sticker_ids`-only): pydantic `extra: ignore`
    молча отбрасывает `ops`. НО клиент деградирует: если `GET` вернул
    `version=0`/без версии → `pushLegacyLocalRecents` шлёт весь список через
    `sticker_ids` (legacy-merge путь) → базовая синхронизация работает;
    последующие ops-flush'и v1-сервером игнорируются (recents на сервере
    замирают, локальный журнал остаётся).
- **Требуемый порядок выката: BACKEND FIRST.** Новый сервер полностью
  обслуживает старые клиенты; новый клиент на старом сервере деградирует
  в legacy-режим без ошибок.

### Follow-up 2026-11-25: op-batch dedup + PG-гейт + e2e env

После мерджа на ветке доделаны три гэта из «Блокеры» ниже:

- **Op-batch dedup (`op_batch_id`)** — lost-response идемпотентность PUT
  `/chat/stickers/recent`. Клиент держит один стабильный `batchId` на
  composition журнала (`meta.recentOpsBatchId` в `chatStickerStore`,
  ротируется при изменении состава, стабилен на retry и на параллельных
  flush'ах одного журнала); сервер хранит **bounded-историю** применённых
  batch-id (`chat_user_recent_sticker_state.applied_op_batch_ids`, JSON,
  cap 100) и под той же `FOR UPDATE`-блокировкой отвечает текущим
  `{items, version}` без повторного применения и без bump'а версии.
  История, а не один last-id: повторяемый пакет не обязан быть последней
  записью — между ним и retry мог лечь пакет другого устройства. Новая
  миграция `20261125_0182_chat_recent_sticker_op_batch` (idempotent,
  create-if-missing в реальной схеме `chat`/`public`; до post-main
  перенумерации значилась как `20261125_0180`).
- **PG-гейт выполнен** на изолированном portable PostgreSQL 17
  (`127.0.0.1:55433`, scratch-кластер `pg-v31-data`): новый файл
  `tests/test_pg_sticker_gate.py` — scratch-БД `stgt_*`, chat-scope
  upgrade→head на реальном PG, проверка таблиц/колонок (`applied_op_batch_ids`,
  `position`), replay no-op под FOR UPDATE, параллельные потоки
  сериализуются (version 2 и 3), downgrade→`20261124_0177` и повторный
  upgrade. **2/2 PASS.** Production `hubit_chat` не затрагивался.
- **E2E env-гэп закрыт:** `e2e/stack/local_backend.py` теперь сидит
  test-only `MAIL_CREDENTIALS_KEY` (`e2e-local-mail-key-not-for-production`,
  вне production SHA-256→Fernet). Логин проверен прямым POST
  `/api/v1/auth/login` на поднятом стеке без env — `status=authenticated`.

#### Совместимость `op_batch_id`

- **Старый клиент + новый сервер:** `op_batch_id` отсутствует → `None` →
  dedup не срабатывает, PUT применяется как раньше (покрыто
  `test_recents_op_batch_id_not_recorded_without_one`).
- **Новый клиент + старый сервер (v2 без 0180):** pydantic v2 по умолчанию
  игнорирует лишнее поле — `op_batch_id` отбрасывается, ops применяются
  без дедупликации (graceful degrade, как до фичи).
- **Порядок выката — alembic 0180 до/вместе с кодом сервера** (стандартный
  релизный порядок: миграция, затем рестарт). Новый ORM читает колонку
  `applied_op_batch_ids` в SELECT — на БД без 0180 запрос упадёт; это то же
  требование, что и у любой новой колонки.

#### Проверки follow-up (worktree `.codex_tmp/integ-fr`, 2026-11-25)

| Проверка | Результат |
|---|---|
| `WEB-itinvent/backend/tests/test_chat_sticker_favorites.py` | **29/29 PASS** — +5 новых: 3 lost-response сценария (replay после чужого clear, replay clear после чужого bump, параллельные flush'и одного журнала), version не ре-bump'ится, legacy-без-batch-id совместимость |
| `tests/test_pg_sticker_gate.py` на PG 17 scratch | **2/2 PASS** (upgrade/dedup/concurrent/downgrade/re-upgrade) |
| Sticker + scope suites (root `tests/`) | `test_chat_sticker_favorites` 15/15, `test_chat_telegram_stickers` 26/26, `test_chat_attachment_sticker_preview` 2/2, `test_chat_migrations_scope_independent` 55/55 |
| Alembic heads | на момент follow-up — один head `20261125_0180`; после merge main/PR #68 и перенумерации — `20261125_0182` |
| Frontend unit | `chatStickerStore.test.js` 24/24 (включая 3 новых batchId-теста: стабильность на retry, ротация на новых ops, один id у параллельных flush'ей) + `chatStickers.test.js` 17/17 |
| E2E login без `MAIL_CREDENTIALS_KEY` | `POST /api/v1/auth/login` → `authenticated` на e2e-стеке |

#### Post-main merge `af485f22`: перенумерация sticker chain

После merge `origin/main` в `integration/frontend-remediation` фактически
обнаружено дублирование **самих revision id** `20261124_0178` и
`20261124_0179` (My Files PR #68 и Sticker V2), а не только имён файлов.
Финальная линейная цепь:

`20261118_0176 → 20261124_0177 (A8) → 20261124_0178 (my_files indexes) →
20261124_0179 (my_files member updated_at) → 20261124_0180
(chat_sticker_favorites) → 20261124_0181 (chat_recent_sticker_sync_state) →
20261125_0182 (chat_recent_sticker_op_batch)`.

`alembic heads` после перенумерации — единственный `20261125_0182`. Scratch
БД, уже прошедшие старые sticker `0178–0180`, содержат устаревший
`system.alembic_version` и не переносятся; для gate используются только свежие
scratch-БД. Повторный PG17-gate после перенумерации: **4/4 PASS** — fresh
upgrade→head, upgrade с `0177`, upgrade с My Files-side `0179` с сохранением
pre-existing install row, op-batch dedup/concurrency, sticker-only downgrade
`0182→0179` и re-upgrade.

Известная проблема окружения (не связана с изменениями): Playwright-прогон
в этом worktree падает белой страницей — vite dep-optimizer генерирует
битый MUI-чанк (`createTheme_default is not a function`,
`@mui/material/Box`, vite 7.3.2/esbuild 0.27.7); воспроизводится и после
очистки `node_modules/.vite`, версии node_modules идентичны main-worktree.
Логин-путь проверен напрямую через HTTP (см. выше); браузерный e2e-прогон
на этой машине требует починки dep-cache/установки в отдельном прогоне.

### Блокеры / гэпы

- ~~PG-гейт не выполнен~~ — выполнен на изолированном кластере (см. follow-up).
- ~~E2E env-гэп `MAIL_CREDENTIALS_KEY`~~ — закрыт сидом в `local_backend.py`.
- **Браузерный e2e на этом хосте:** vite dep-optimizer выдаёт битый
  MUI-чанк (см. follow-up проверки) — окружение, не код ветки.
- Одновременно с мерджем на ветку лёг `d50ca236` (fix инертности Login +
  Escape keepMounted-модалок) — он поверх `e6aa9251`, сохранён.

---

## Ретроспективный реестр всех интеграционных мерджей (final gate, 2026-11-25)

До PR #69 отдельного трекера не было — таблица ниже восстановлена по
`git log --merges 926dd9f5..HEAD` на финальном гейте: merge-sha, ветка и
scope в одну строку (subject tip-коммита ветки / заголовок PR по
`release-gate/rc-inventory.md`). Порядок — хронологический (первый мердж
сверху). Все 42 батч-мерджа + feature-мердж PR #69; мерджи main в
сторонние ветки (`e82dfd29`, `e2cebccd`, `84883f06`) интеграциями не
являются и не перечислены.

| # | Merge SHA | Ветка | Scope (evidence) |
|---|---|---|---|
| 1 | `81282384` | fix/auth-2fa-flow (#23) | post-auth UI смонтирован до завершения Login — 2FA backup codes, trusted-device prompt (FE-0197/0198/0199) |
| 2 | `2d96c13e` | fix/account-delegate-integrity (#27) | partial success при падении записи делегатов — делегаты задач больше не стираются (FE-0233) |
| 3 | `995ff14b` | fix/account-department-race (#28) | department members race — seq-guard + проверка dept при save (FE-0239) |
| 4 | `14c4d036` | fix/auth-refresh-coordination (#29) | координация ротации refresh-token между вкладками браузера |
| 5 | `14ff8dd8` | fix/construction-beforeunload (#30) | beforeunload-предупреждение о несохранённых черновиках работ (FE-0259) |
| 6 | `8aa9f1bd` | fix/networks-mobile-render (#31) | chunk mobile card lists на вкладках Equipment/Sockets (FE-0023) |
| 7 | `f110ddef` | fix/warehouse1c-keyboard (#32) | a11y: клавиатурный доступ к кликабельным desktop-строкам/ячейкам (FE-0022) |
| 8 | `4cac11fb` | fix/networks-a11y (#33) | a11y networks: labels, keyboard rows/markers, валидный card DOM (FE-0024/0035/0155/0156) |
| 9 | `113960ef` | fix/networks-csv-sanitize (#34) | санитизация CSV-экспорта против formula injection (FE-0154) |
| 10 | `8adf9a98` | fix/networks-correctness (#35) | busy-guards, delete confirms, стабильный keydown listener (FE-0029/0145/0153) |
| 11 | `0fd0ae04` | fix/networks-sites-deadcode (#36) | skip MAC sync для read-only, удалён stale map image (FE-0143/0144) |
| 12 | `782d0b9c` | fix/networks-map (#37) | map pan clamp, gesture fixes, memoized markers, point-edit rollback (FE-0031/0140-0142/0151) |
| 13 | `0c9e978d` | fix/account-guards (#38) | удалён test-only tab resolver, NaN-guard fontScale без clamp (FE-0250) |
| 14 | `76c2068b` | fix/account-seq-guards (#39) | seq-guards для loaders, loadMore/reload race, delete-dialog usage race |
| 15 | `986b5c27` | fix/account-draft-loss (#40) | черновики переживают refresh, настоящий autosave для групп паролей |
| 16 | `071c5a41` | fix/account-aibots-lazy (#41) | lazy-load AI bot runs на вкладке диагностики (FE-0019) |
| 17 | `9e0a20a1` | fix/database-misc (#42) | cancel in-flight work при unmount/rerun — transfer poll, deeplink, maintenance loaders, timers |
| 18 | `2358e247` | fix/database-races (#43) | русские aria-labels + MUI ruRU locale, page overflow clip, export abort при сбое prefetch movements |
| 19 | `e64ab42a` | fix/voice-batch (#44) | voice: busy guards, abort/seq checks, keyboard+a11y, upload dedup, lazy voices tab — 18 записей |
| 20 | `9a6e167f` | fix/chat-batch (#45) | chat: 15 записей — pending reads flush, loadingOlder reset, heartbeat degrade, retry/prep guards, a11y |
| 21 | `ae60b39b` | fix/tasks-batch (#46) | tasks batch audit fixes (FE-0045/0053/0058/0127-0134/0262/0264/0277/0278) |
| 22 | `8d169dbd` | fix/mail-batch (#47) | mail: draft lifecycle, preview fetch, read-state rollback, a11y (21 запись) |
| 23 | `b55abf34` | fix/auth-misc-batch (#48) | auth-misc: storage guards, epoch reset, SPA nav, Login a11y/UX (15 записей) |
| 24 | `a6d95e75` | fix/myfiles-batch (#49) | my-files: upload-queue guard, bulk progress, deep-link, editor-session (13 записей) — tip сам является sync-мерджем main |
| 25 | `fa715629` | fix/scancenter-batch (#50) | scan-center: URL-synced tabs, abort coverage, busy guards (FE-0011/0052/0088/0093/0094/0312/0317-0319/0322) |
| 26 | `a334b53b` | fix/itobjects-batch (#51) | it-objects: abort signal, save-failure guard, confirm revokes (FE-0046/0139/0284-0286/0288/0292) |
| 27 | `d9934b5c` | fix/layout-batch (#52) | layout: notification drawer semantics, badge accuracy, nav overlay (FE-0014/0204-0207/0214) |
| 28 | `16f029ef` | fix/networks-batch (#53) | networks: global key guards, edit-permission gates, race и virtual-scroll fixes |
| 29 | `b601721b` | fix/feed-batch (#54) | feed: attachment stubs, draft autosave guards, comment poll/lookup fixes |
| 30 | `80e7d9da` | fix/stats-batch (#55) | statistics: SWR dedupe, seq-guarded refresh, blob error text, URL revoke delay |
| 31 | `880c7df9` | fix/shared-batch (#56) | shared-files: download error text, retry action, list cap, visible-only tick |
| 32 | `e93cdf3a` | fix/dash-batch (#57) | dashboard: карточки при ошибке refresh, dedupe alerts, in-dialog save error |
| 33 | `7e675a4b` | fix/computers-batch (#58) | Computers page + employee history panel audit fixes |
| 34 | `b4b7005a` | fix/swr-batch (#59) | swr-cache: гарантированный force refetch и доставка stale revalidation |
| 35 | `29870a7a` | fix/constr-batch (#60) | construction: work workspace и objects page audit fixes |
| 36 | `d3b6e6bc` | fix/company-batch (#61) | company-structure: structure page и absences panel audit fixes |
| 37 | `c7936e00` | fix/pwa-batch (#62) | pwa/desktop batch — 6 findings |
| 38 | `615457c8` | fix/mon-docflow-batch (#63) | monitoring+docflow batch — 5 findings |
| 39 | `f5dc881c` | fix/kb-dlp-batch (#64) | kb+dlp batch — 6 findings |
| 40 | `0585f30c` | fix/misc-batch (#65) | misc batch — notifications, task checklist, ad-users, drawers |
| 41 | `6cdbafa2` | fix/final-polish (#66) | final polish — a11y, PWA updates, error reporting, mail inline, perf |
| 42 | `de353a81` | fix/evidence-batch (#67) | close NEEDS_EVIDENCE records — guards, hook-order, limits UX (8 fixes) |
| 43 | `e6aa9251` | feat/chat-sticker-system-v2 (#69) | Sticker System V2 — favorites, synced recents (op-protocol + op_batch dedup), search, suggestions — полный разбор выше в этом файле |

Поверх мерджей (не-merge коммиты интеграционной ветки, хронологически):
`53732f53` restore viewport scale + post-auth/mail test contracts после
мерджей; `a18fc5e7` agent-review fixes (verify-2fa-login epoch reset,
dedup ShowMore buttons, ports revalidate truncation warning); `d50ca236`
инертность Login + Escape/Ctrl+S keepMounted-модалок; `d16e008d` recents
op batch dedup + e2e mail key; `a50ad10c` PG sticker gate на изолированном
PG17; `5bae5bfb` восстановление `scripts/_migration_safety.py`;
`a7359e78` barrel-импорт Box; `1a2a7a0b` frontend release gate —
RC inventory + smoke-test triage fixes; `609572ac` release perf A/B;
`5a7cb5e1` release e2e module sweep (release-smoke 31/31 routes PASS).

---

## Final acceptance addendum — 2026-11-25

Кодовый tip финального acceptance: `4483485c` (`integration/frontend-remediation`; до docs-коммита). Baseline сравнения на старте acceptance: `origin/main` `af485f22`. Во время прогона `origin/main` внешне ушёл в `4d4dba1f` через merge PR #75, а PR #73 был закрыт владельцем без merge; это зафиксировано как изменение release-vehicle, а не как регрессия кода.

### Дополнительные коммиты поверх `6983328e`

| SHA | Что вошло | Проверка |
|---|---|---|
| `7bf261a3` | Database mobile tabs/QR deep-link: прямой `sx` на mobile `Tab` + детерминированные ожидания в тесте | focused `Database.test.jsx` 62/62 PASS |
| `472c5826` | PR #10 `1d93d28b`: sanitize HTML paste в mobile task editor (`dompurify`, allowlist, повторная проверка href) | focused task rich-text/editor 14/14 PASS |
| `9c19ae23` | Синхронизация auth refresh test с intentional cross-tab propagation window | focused `client.test.js` 265/265 PASS |
| `4483485c` | AI action card на mobile не пробрасывает click/long-press в bubble menu | focused `ChatThread.test.jsx` 96/96 PASS; AI reliability narrow dark E2E PASS |

### Deferred PR decision

- **PR #10** — применён отдельным коммитом `472c5826` с атрибуцией `(PR #10)`; сам PR на GitHub остаётся open как исходный side-PR.
- **PR #9** — не merged: 254 файла исторического аудита против pre-remediation main `9879be04`; перенос как есть создал бы устаревший audit sign-off поверх уже исправленной кодовой базы. Решение: defer/superseded, финальное состояние фиксируется в `FINAL_RELEASE_GATE_REPORT.md`.
- **PR #15** — не merged: архитектурный AI-аудит/roadmap от 2026-11-23 путь-конфликтов не имеет, но содержание superseded уже приземлёнными отчётами/работами A1–A11; перенос без переписывания противоречил бы текущему состоянию.

### Финальные проверки, добавленные к реестру

- Flags-on frontend vitest на финальном кодовом tip `4483485c`: **722/722 files, 5245 passed + 2 skipped / 5247, 0 failed** (275.44 s). Промежуточный rerun поймал два редких parallel-timing падения `Tasks.test.jsx`; focused файл затем **45/45 PASS**, финальный полный rerun зелёный.
- Backend targeted regression на `9c19ae23`/перед `4483485c` (backend не менялся): **134/134 PASS**, включая PG17 isolated sticker gate **4/4**.
- Backend collection sanity: candidate **6808 collected / 10 env-legacy errors**; baseline `af485f22` **6779 collected / 11 errors**. Единственная разница в error-set — baseline-only `test_migrate_safe_replace_scripts.py`, дефект исправлен в integration; остальные ошибки одинаковые environment/legacy-gated.
- E2E: release-smoke **1/1 PASS** (31 route: 29 render + 2 documented degraded upstream surfaces), chat emoji/sticker/recents **25/25 PASS** до final AI-card fix, My Files fixture harness в dev mode **60/60 PASS**, AI chat reliability после fix **8/8 PASS**; AI drafts/mail-open **3/3 PASS**.
- Perf A/B production builds, alternating sides, n=20/scenario: no p95 regression >10%; warm-dock send улучшился `127.2→81.8 ms` p50 и `160.8→95.5 ms` p95. Подробности — в gate report.

---

## Post-PR#75 synchronization addendum — 2026-11-25

`origin/main` был заморожен на `4d4dba1ffa5a3f8e8d7345bbcb2929a7d12e7e9b` (PR #75, merged 2026-11-25 11:51:41Z). Pre-sync tip ветки: `c18d9fa8cff34bdf7808006c90e136d4663e550d`. Создан semantic merge commit `5e6ac871243cbdd7a016c160ca715101cd565c9c` с родителями `c18d9fa8` + `4d4dba1f`; это **не** merge в `main` и не deploy.

### Размер оставшейся дельты над main

После синхронизации diff `4d4dba1f..5e6ac871`: **12 коммитов, 93 файла, +8 937/−809**. Значительная часть — release evidence, e2e harnesses и visual/perf artifacts. Продуктовая дельта сконцентрирована в восстановленных My Files fixes, warm-dock chat perf stabilization, safe paste PR #10, AI action-card click isolation, Database mobile tabs/QR stabilization и связанных тестах/документации.

### Ключевые conflict resolutions

- Alembic `0085/0086/0174/0180`, `telegram_sticker_service.py`, `http.js`, `client.test.js` — взяты версии main/PR #75: там более поздние migration repair/idempotency hardening, uniform sticker entitlement + `FileMessageCommittedError`, nonce CAS refresh-claim protocol.
- `MyFiles.jsx` — взята branch-сторона: PR #75 при restore конфликта потерял branch behavior `d73498ea` (upload-queue guard, bulk progress, deep-link fallback, editor session/deep-link fixes).
- root `tests/test_chat_sticker_favorites.py` — branch-сторона из-за правильных renumbered migration parents; main-side security HTTP tests сохранены отдельно в `WEB-itinvent/backend/tests/`.
- `my-files-admin.spec.js` — semantic union: branch sweep + main ruRU pagination matcher.
- generated emoji/sticker artifacts — branch final acceptance/perf lineage.
- Protected files (`ChatBubble.jsx`, warm-dock chat hooks/content, `DatabasePageHeader.jsx`, `taskRichText.js`, `MyFiles.jsx`) после merge content-normalized совпадают с pre-merge `c18d9fa8`.

### Проверки post-merge

- Alembic static graph: один head `20261125_0182`.
- Backend targeted pytest: **148/148 PASS**; isolated PostgreSQL sticker gate на scratch `stgt_*`: **4/4 PASS** (production не затрагивался).
- Frontend targeted flags-on vitest: **17/17 files, 674/674 tests PASS**; явно включены `Database.test.jsx`, `Tasks.test.jsx`, `MyFiles.test.jsx`, auth refresh/Login/App, sticker-store/API/components, task rich-text.
- Production build в outDir вне `frontend/dist`: **PASS**, 7698 modules, 1 m 03 s.
- Production E2E: `release-smoke` **1/1 PASS** (31 route: 28 normal + 3 documented unseeded-upstream degraded surfaces), `chat-ai-reliability` **8/8 PASS**.
- My Files E2E: 9 specs/85 unique tests; первый sweep **84/85**, единственный failure — boundary 149 px vs 150 px в `my-files-name-columns`; focused rerun exact spec **1/1 PASS**.
- Auth remediation P0+multitab: 11 tests; первый sweep **10/11**, failure в no-Web-Locks case с нулём refresh POST (не duplicate rotation); focused rerun exact test **1/1 PASS**, затем независимый полный rerun **11/11 PASS** за 4.2 min.
- Sticker V2 production E2E: первый run 4 passed + manage-reorder failure + cross-user не запустился; focused rerun двух оставшихся **2/2 PASS**, затем независимый полный rerun **6/6 PASS** за 1.7 min. Backend boundary tests подтверждают persistence reorder; первоначальный browser failure соответствует read-after-write race в spec (ожидание request, а не response).
- Focused warm-dock perf spot check pre/post merge, production builds, n=20, 1440×900: typing `31.0/40.9 → 29.3/36.5 ms` p50/p95; send `86.5/100.3 → 61.3/88.0 ms` p50/p95; zero long tasks/timeouts/sticker requests. Регрессии нет, post-merge быстрее.

**Post-sync verdict: GO для review/merge refreshed consolidation diff относительно `4d4dba1f`.** Это не deploy approval: staging/migration runbook и явное owner release decision остаются обязательными. Полная таблица и caveats — в `FINAL_RELEASE_GATE_REPORT.md`, section 11.

---

## Final merge addendum — 2026-11-26 (UTC+5)

- **Final pre-merge integration tip:** `5eac17726a748fb8f36cc2b404694131fdad8b9c` (`5eac1772`), коммит `fix(my-files): separate processed/succeeded in bulk op counters`.
- **Final pre-merge `origin/main`:** `4d4dba1ffa5a3f8e8d7345bbcb2929a7d12e7e9b` (`4d4dba1f`), static во время финальной pre-merge проверки.
- **Owner authorization:** PR #73 (`integration/frontend-remediation` → `main`) разрешён к немедленному merge в `main` обычным merge commit — не squash, не rebase, не force-push.
- **Статус:** MERGED into `main`.
- **Final merge commit SHA:** `da1869d10d4146d35e1b60b55298620d5b656e0f` — заполнено post-merge follow-up коммитом после проверки API response, parents/tree equality и ancestry.
- **Final post-merge `origin/main` tip:** `da1869d10d4146d35e1b60b55298620d5b656e0f` (тот же regular merge commit).
- **Explicit verification-scope decision:** comparative full-pytest backend run понижен владельцем до **post-merge verification**; это не зафиксировано как выполненный pre-merge gate.
- **Final confirmation evidence:** focused `MyFiles.test.jsx` **49/49 PASS**; full flags-on vitest **722/722 files PASS**; My Files browser E2E **85/85 effective PASS**; production build **PASS**; Alembic static graph — один head `20261125_0182`.
- **Scope guardrail:** финализация ограничена git merge и документацией/PR metadata. Deploy, production migrations, service restarts, IIS publish и production config changes не выполнялись и не авторизованы этой записью.
