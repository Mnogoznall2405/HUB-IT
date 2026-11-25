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
- Миграции `20261124_0178_chat_sticker_favorites` +
  `20261124_0179_chat_recent_sticker_sync_state` (down-цепь на
  `20261124_0177_ai_summary_llm_checkpoint`).
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
| Alembic heads | **один head `20261124_0179`**; цепь 0179→0178→0177→0176 цела, merge-revision не потребовался |
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
  миграция `20261125_0180_chat_recent_sticker_op_batch` (idempotent,
  create-if-missing в реальной схеме `chat`/`public`).
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
| Alembic heads | один head `20261125_0180` |
| Frontend unit | `chatStickerStore.test.js` 24/24 (включая 3 новых batchId-теста: стабильность на retry, ротация на новых ops, один id у параллельных flush'ей) + `chatStickers.test.js` 17/17 |
| E2E login без `MAIL_CREDENTIALS_KEY` | `POST /api/v1/auth/login` → `authenticated` на e2e-стеке |

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
