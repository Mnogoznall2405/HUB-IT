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

### Блокеры / гэпы

- **PG-гейт не выполнен:** на хосте нет disposable PostgreSQL (порт 5432
  закрыт, psql/psql-сервис/portable отсутствуют; единственный PG — живой
  `hubit_chat`, DDL на нём запрещён). Покрытие: статическая цепь + sqlite
  upgrade/downgrade (0176→head упражнён напрямую) + scope-тесты (23 ревизии).
  Тот же гэп фиксировался на самой ветке (PG 17.6 прошлого прохода недоступен).
- **E2E env-гэп:** после мерджа батчей логин в e2e-стеке требует
  `MAIL_CREDENTIALS_KEY` — сейчас передаётся только через env при запуске;
  `e2e/stack/local_backend.py` его не сидит. Если другие e2e-прогоны падают на
  `apiLogin` 400 — причина эта.
- Одновременно с мерджем на ветку лёг `d50ca236` (fix инертности Login +
  Escape keepMounted-модалок) — он поверх `e6aa9251`, сохранён.
