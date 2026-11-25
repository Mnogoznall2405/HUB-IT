# POST_RELEASE_BACKLOG.md — остаточные задачи после релиза

Дата: 2026-11-25. Всё нижеперечисленное сознательно вынесено за рамки релиза PR #75. Ничего из этого не блокирует staging/выпуск; порядок и приоритет — решение владельца. Новых функций в текущий релиз не добавлять.

## 1. Решения владельца (из Security Gate)

| # | Тема | Суть | Материалы |
|---|---|---|---|
| B-1 | FE-0198 enrollment enforcement | Принять session economics (вариант A: 30-мин idle для внешней untrusted-сессии vs 7 дней trusted) или заказать server-side mandatory enrollment (вариант B: limited-scope сессии + middleware + recovery-путь). Риск обхода клиентского gate оценён как нулевой по последствиям (обходящий уже имеет валидную сессию, новых прав не получает). | `FE0198_ENROLLMENT_POLICY_DECISION.md` |
| B-2 | Rate-limit sticker import | `POST /sticker-packs/import` не имеет per-user rate-limit (размерные лимиты есть: 5MB/стикер, 100MB/пакет, ≤200 стикеров, семафор 6). Добавить лимит или принять риск. | PRODUCTION_READINESS.md п. 12 |
| B-3 | Персистентный offline op-journal | Op-journal recents хранится in-memory — при рестарте процесса неподтверждённые операции повторяются/теряются. Нужна durable-персистентность с идемпотентностью. | UNIFIED_RELEASE_VERIFICATION.md |

## 2. Отдельные инженерные направления

| # | Тема | Суть |
|---|---|---|
| B-4 | FE-0215 Exchange | Интеграция Exchange — отдельное направление, вне ремедиации. |
| B-5 | FE-0064 safe-paste | PR #10 `fix/fe-0064-task-editor-safe-paste` (+200 строк, 4 файла, тесты) — готов к отдельному review/merge после релиза. НЕ закрыт, не вошёл в #75. |
| B-6 | Пять OPEN-записей аудита | Открытые записи фронтенд-аудита, не вошедшие в программу ремедиации. Сверить с `audit/frontend-2026-11-22` (PR #9) перед постановкой в работу. |
| B-7 | #15 docs/ai-architecture-audit | Документация AI-архитектурного аудита (+725 строк) — merge или закрытие по решению владельца. |
| B-8 | #74 feat/a11-ai-intelligence | Пост-релизное направление AI routing — отдельная программа. |
| B-9 | Salvage из #73 | Расширенные sticker-тесты параллельной сессии (`test_user_uploaded_stickerlike_filename_does_not_grant_entitlement`, `test_user_upload_cannot_set_sticker_media_kind` и др., ~70 строк нового покрытия) — рекомендуется перенести до закрытия #73. |

## 3. Baseline-fail тесты (pre-existing, не регрессии релиза)

Исправлять отдельными задачами — они фейлятся и на baseline `cfc5e012`:

- **vitest**: `useChatComposePrefillBootstrap` (тест+impl byte-identical baseline — сломан структурно), Tasks/Database — flaky под нагрузкой полного прогона (107/107 в изоляции, требуют стабилизации тестовой инфраструктуры), остальные 9 файлов baseline-сигнатуры.
- **pytest** (~70 в полном прогоне): кластеры — voice-стек (dead_air/diarization/suggest), bot durability/transfer, ai_chat/ai_sandbox, app_db identity, chat runtime/redis readiness, e2e-ai — все воспроизводятся на baseline в идентичном окружении (same-env compare 2026-11-25). Типовые корни: отсутствующие внешние сервисы/токены в тест-окружении, инфраструктурные зависимости scan/voice, устаревшие контракты. Разобрать по владельцам подсистем.
- **my-files virtualization/name-columns E2E**: сидирование упирается в queue cap (max_active_jobs=5) — спекам нужен управляемый воркер или пред-сидированное состояние.
- **my-files-admin pagination**: исправлено в рамках gate (ruRU aria-labels) — закрыто, здесь для хронологии.

## 4. Технический долг инфраструктуры тестов

- `test_pg_sticker_gate.py` требует `psycopg2`-совместимый URL — привести harness к psycopg v3 единообразно.
- Полный pytest периодически висит на сетевых ожиданиях без `--timeout` — внедрить pytest-timeout в CI-контур.
- Visual baselines compact-ux — регенерировать после merge #75 и зафиксировать свежие.
