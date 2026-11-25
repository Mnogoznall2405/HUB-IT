# UNIFIED_RELEASE_VERIFICATION — доказательства прогонов

Кандидат: `integration/hub-it-release-candidate` @ `8e837468` (merge `82bff0c7` + gate/review фиксы).
Все прогоны — локальный e2e-стек (`E2E_LOCAL=1`, backend sqlite+in-memory pg-подмена, seeded users e2e_admin/e2e_user/e2e_fresh), prod build где указано.

## 1. Release Gate E2E (p0-стенд :18002/:5199, chromium headless-shell)

| Сюита | Результат | Состав |
|---|---|---|
| remediation-p0 + multitab | **11/11 passed** (4.1 min) | FE-0059 strict lost-rotation (grace replay восстанавливает, post-grace revoked_jti 401, новая пара жива), FE-0198 strict (CDP virtual authenticator: обязательный диалог после login **и после F5**, deep-link /dashboard возвращает на /login, «Не сейчас» скрыт), FE-0198 unsupported-сценарий отдельно, ChatCallsProvider lifecycle (window-listener счётчики: guest 0 → login 2 → logout 0 → смена user ровно 2 → logout 0), FE-0083 multitab ×5 |
| SW-repro на prod build | ALL GREEN | cold start / SPA navigation / SW update / offline fallback / stale cache — renderer crash устранён (root cause: `navigator.setAppBadge` в SW — fatal mojo IPC в chrome-headless-shell) |

## 2. Sticker V2

| Слой | Результат |
|---|---|
| Frontend units | **122/122** (12 файлов: chatStickerStore 24, TelegramStickersTab 36, ManageDialog 9, suggestions 6, media 6, search-index perf 1, …); после сериализации flush'ей перепроверено: store 24/24, UI-batch 61/61 |
| Backend pytest | **72 passed + 1 skipped** (pg-gate); service-level 29/29 и HTTP-boundary 15/15 перепроверены после фикса file-loss |
| chat-stickers-v2.spec.js | **6/6** (packs manage с честным DnD, favorites server-verified + reload persist, recents cross-reload, default-pack delete refusal, cross-user isolation) |
| chat-stickers-v2-visual.spec.js | **5/5** |
| chat-emoji-picker.spec.js | **15/15** включая WS realtime-доставку стикера A→B |
| Матрица покрытия чеклиста | 19/19 пунктов мапятся на поведенческие тесты (независимый аудит: ~180 тестов, без mock-echo/таутологий); gaps уровня MINOR: offline-журнал in-memory, нет explicit remove-чужого-пака негатива, emoji-only без e2e |

## 3. Полные прогоны

### vitest (frontend, SHA 6387fa80)
5217 passed / 13 failed / 2 skipped, 7 файлов. Классификация всех 13:
- 9 падений в 5 файлах **идентичны baseline `cfc5e012`** (TaskWorkspacePanel — ожидание URL без `task_tab=comments`, chatNotifications, Chat.test, ComposePrefillBootstrap, AiStatusPolling) — pre-existing baseline-дефекты тестов.
- `Tasks.test.jsx`, `Database.test.jsx` — **107/107 в изоляции**; падают только под нагрузкой полного прогона → flaky-infra, не регрессия.

### pytest (backend mono-scope, `--continue-on-collection-errors`)
**6620 passed / 70 failed / 78 skipped / 10 errors** за 42.5 мин.
- 10 errors — collection: опциональные зависимости машины (`watchdog`, `soundfile`, `telegram`, `TELEGRAM_BOT_TOKEN`, `CHAT_ENABLED` runtime guard).
- 70 failed — кластеры: bot/transfer (15+), voice (15+), my-files, hub-tasks, chat-misc, scan/agent. Сэмпл-верификация на baseline `cfc5e012` — **идентичные падения** во всех проверенных файлах: route_auth_sweep, hub_tasks, my_files_service, chat_calls_migration, chat_scheduled_messages, chat_runtime_split, chat_address_book_resolve → pre-existing, не регрессии merge. Bot/voice/transfer кластеры — env-зависимые (нет bot token, аудио-стека, скан-инфраструктуры).
- Контроль после фиксов миграций: `test_chat_calls_migration`/`test_chat_scheduled_messages`/`test_chat_sticker_favorites` перепрогнаны на RC — см. коммит 8e837468 (результат в конце документа).

### Прочие E2E
| Сюита | Результат |
|---|---|
| screens-smoke | **30/30** |
| my-files-admin | **13/13** (после фикса ruRU aria-labels пагинации) |
| my-files-virtualization / name-columns | инфра-ограничение: seed упирается в `max_active_jobs_per_user=5` (429 «Too many files queued»), impl byte-identical обеим сторонам merge — регрессия исключена статически |
| Mobile web smoke (390×844, prod build) | ALL GREEN: login/dashboard/chat/tasks/my-files/feed, горизонтального overflow нет |
| FE-0232/0239/0259 runtime | 10/10, 9/9, 15/15 green |

## 4. Performance (prod build `6387fa80`, serve-prod :5311)

| Метрика | RC | Baseline B (cfc5e012) | Вердикт |
|---|---|---|---|
| Mobile Оборудование settle | 1665ms | 1870ms | паритет |
| Mobile Розетки settle | 1010ms | 1026ms | паритет |
| Mobile DOM nodes | 2393 / 1760 | 2393 / 1760 | идентично |
| Desktop settle | 958 / 1373ms | 964 / 1366ms | паритет |
| Desktop equipment DOM | 925 | 925 | идентично |
| Scroll p95 / janky | 34ms / 0 из 25 | 34ms / 0 | идентично |
| longtasks mobile | 3/Σ674ms, 2/Σ232ms | 3/Σ0.7s, 2/Σ0.26s | идентично |
| Cold login p50 | 2232ms (n=3, fresh context) | — | baseline отсутствует, абсолютное значение приемлемо |
| Warm dashboard p50 | 319ms (n=3) | — | — |

## 5. Миграции

- `alembic heads` → единственный head `20261125_0180`; 183 ревизии, ни одного missing down_revision, один исторический branch+merge (20260327_0006 → 20260328_0010) — валиден.
- Production-стартап миграции не применяет (initialize_*_schema — только compare+log) — подтверждено ревью.
- Фиксы кандидата (коммит `8e837468`): 0086 детектирует схему по факту (`chat`/`public`), верифицировано на sqlite: upgrade→tables+FK OK, re-upgrade no-op, downgrade OK, no-chat-tables skip OK. 0085 — та же детекция для realtime-таблиц (зеркалит runtime `postgres_realtime.py`). 0174 — идемпотентный concurrent index (skip valid / drop invalid / recreate; downgrade IF EXISTS).
- Не покрыто локально: pg-специфичные ветки (нет PostgreSQL на машине) — обязателен pg-gate на staging перед продом.

## 6. Независимое ревью (7 параллельных ревьюеров по SHA 6f5290d4)

| Область | Вердикт | Ключевые находки |
|---|---|---|
| Frontend integration | PASS-WITH-NOTES | merge чист, virtualization/stickers/auth коэкзистируют; minor: FE-0198 refreshSession error-path |
| Backend integration | PASS-WITH-NOTES | wiring не продублирован; MAJOR file-loss в sticker send → **исправлен**; minor entitlement leg-3, import rate-limit |
| Security | PASS-WITH-NOTES | rotation/2FA/WebAuthn серверная сторона не ослаблена; нет server-side enforcement enrollment-гейта (accepted, смягчено 30-мин idle-сессией); secrets hygiene OK |
| DB migrations | **FAIL → исправлен** | BLOCKER 0086/0085 legacy-public schema → **исправлен и верифицирован**; MAJOR 0174 → исправлен; 1C runtime DDL — pre-existing, отдельной задачей |
| Concurrency/realtime | PASS-WITH-NOTES | refresh rotation атомарен, WS backpressure/ACK корректны; MAJOR recents overlap flush → **исправлен**; minor grace-hit=1, fire-and-forget callbacks |
| Test integrity | PASS-WITH-NOTES | ослаблений в gate-коммитах нет, FE-0198 strict реально strict; MAJOR широкий catch в DnD → **исправлен**; visual spec не pixel-baseline (by design) |
| Sticker V2 QA | PASS-WITH-NOTES | ~180 поведенческих тестов, покрытие чеклиста реальное; minors задокументированы |

## 7. Хвостовые проверки post-fix

- После `8e837468`: chatStickerStore 24/24, sticker UI batch 61/61, backend sticker service 29/29, HTTP boundary 15/15, manage-DnD E2E passed (28.1s).
- Контрольный прогон migration-тестов на RC post-fix (`8e837468`): test_chat_sticker_favorites 15/15 green; test_chat_calls_migration — `test_database_without_chat_tables_is_left_alone` и test_chat_scheduled_messages (3 теста 0124/0125) падают **идентично baseline `cfc5e012`** (подтверждено прямым прогоном на обоих SHA) — pre-existing env/baseline-дефекты, не следствие фиксов 0085/0086 и не регрессии merge.
