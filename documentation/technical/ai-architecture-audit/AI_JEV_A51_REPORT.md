# A5.1 — tool-mode conflict fix, run-profile telemetry, staging readiness

База: `b2d36b38` (HEAD PR #21). Ветка: `perf/ai-jev-a51`, **PR #22**. Отдельная небольшая работа — не смешана с архитектурным PR #21.

> **Цикл 2 (ревью PR #22)** — точечная коррекция телеметрии и group-mode риск:
>
> | # | Дефект | Исправление |
> |---|---|---|
> | 1 | `used_tools` фильтровал trace по `.get("ok")`, но audit_row использует `status="ok"/"error"` | Классификация по `status`+`ok`: `used_tools` (выполненные), `error_tools` (ошибочные), `mode_denied` (счётчик по режиму), `meta_calls` (`ai.request_tool_group`) — раздельные поля в `ai_run_profile_final`. E2E: READ + `directory.people.search` → id есть в `used_tools` лога |
> | 2 | `elapsed_ms` смешивал очередь и обработку | `queue_wait_ms` (enqueue→claim) / `processing_ms` (claim→финал) / `server_total_ms` (их сумма, серверный итог — НЕ клиентский TTFT); `elapsed_ms` сохранён = `processing_ms` для совместимости |
> | 3 | Экспортёр | +p50/p95 по стадиям **внутри каждого режима**; `by_cache`: JEV-латентность (`ai_jev_routing latency_ms`, теперь с `run_id`) и `server_total` для hit/miss/none; `profiles.complete/incomplete`; многораундовые `llm_followup`/`tools` агрегируются per-run (без двойного счёта); `by_outcome` completed/failed/cancelled |
> | 4 | Group-mode конфликт `m_mode_chat≥thr` + routed-группа давал уверенный CHAT | Тот же принцип, что tool-mode: уверенный CHAT требует `chat_p≥thr` И отсутствия JEV-выбора (`jev_selected`); конфликт → READ с сохранённым routed. Тривиальный случай ≤1 группы по-прежнему допускает CHAT |
>
> Тесты цикла 2: `test_mode_chat_label_with_routed_group_is_read_not_chat`, `test_read_run_profile_final_records_executed_tool` (e2e, caplog).

> **Цикл 3 (ревью PR #22) — потеря инструментов в экспортёре (P1):**
>
> **Причина**: `KV_RE = (\w+)=([^\s]+)` обрезал значения-списки по первому пробелу — `used_tools=['a', 'b']` превращался в `'a'`, теряя второй и последующие элементы. Воспроизведено до исправления: на строке ревью `executed_calls` было 1 вместо 2.
>
> **Исправление**: `_parse_profile_fields()` — строгий парсер `key=value`, где значение `[...]` читается по сбалансированным скобкам с учётом кавычек; `_parse_list()` — `ast.literal_eval` (не `eval`) с фолбэком на запятые. Профиль с единственным `run_id` считается повреждённой строкой → `parse_errors`, а не фантомный run. Парсер применён и к нефинальному `ai_run_profile` (те же list-поля). Безопасность: логируются только id/метрики — текстов сообщений, документов, писем и секретов в строках нет.
>
> **Полный путь проверен**: e2e `test_read_run_profile_final_two_tools_exported` — READ с двумя инструментами в одном раунде (`directory.people.search` + `office.mail.contacts.resolve`): оба в `ai_run_profile_final` и оба в экспортированном JSON; `test_read_run_profile_ok_and_error_tools` — ok/error разведены.
>
> **Пример** (строка ревью → JSON):
> `used_tools=['directory.people.search', 'office.mail.search'] error_tools=['office.tasks.search', 'kb.articles.search']` → `{"executed_calls": 2, "error_calls": 2, "mode_denied_calls": 0, "meta_calls": 0}`.
>
> **Тесты**: `test_ai_run_profile_export.py` — **12/12** (включая реальный CLI-запуск на файле); `test_e2e_ai_intent_modes.py` — **11/11**.

## 1. Противоречивая классификация в tool-mode — ИСПРАВЛЕНО

Дефект (подтверждён кодом): при `m_mode_chat >= threshold` **и** одновременно выбранном core-tool `_route_tools_jev` классифицировал ран как уверенный CHAT и отбрасывал выбранные инструменты — модель противоречила сама себе, а сервер принимал «разговорную» сторону конфликта.

Исправление (`service.py`, `_route_tools_jev`): уверенный CHAT требует **обоих** условий — `chat_p >= threshold` И пустой core-выбор. Конфликт `chat_p >= threshold + core_selected` разрешается в пользу выбора инструментов под READ-потолком (`act > read`, chat без core). `None`-режим при низких вероятностях сохраняет recovery через `ai.request_tool_group`.

Тесты (`tests/test_ai_jev_intent_modes.py`, +3):
- `chat_p=0.9 + t00=0.9` → `read`, инструмент сохранён (не chat);
- `chat_p=0.9`, пустой core → `chat`, пустой результат;
- `act_p=0.9 + chat_p=0.9 + core` → `act` (act всегда выше конфликтующего chat).

## 2. Диагностика производительности — ДОВЕДЕНА

| Метрика | Реализация |
|---|---|
| queue wait | `enqueue -> claim` из `run.created_at`/`run.started_at`; lap `ai_chat.run.queue_wait` с реальным `run_id` |
| JEV cache hit/miss | `run_id` добавлен во все `ai_jev_routing_cache` логи (group+tool mode) — сквозная корреляция |
| total elapsed | `ai_run_profile_final` в `finally` `_process_single_run` — wall-clock от claim до финализации, включая delivery; вложенные laps не суммируются |
| token usage | `prompt_tokens`/`completion_tokens`/`total_tokens` из `final_usage` в `ai_run_profile_final` |
| run_id | `_build_conversation_context` laps и `memory` lap исправлены: `trigger_message_id` больше не подменяет `run_id` |

Экспорт: `backend/scripts/ai_run_profile_export.py` — парсит worker-лог, группирует по `run_id`, считает p50/p95/mean по стадиям, `by_intent_mode`, cache hit/miss, токены. Стадии отчитываются по отдельности; authoritative total — `elapsed_ms` (двойного суммирования нет). Проверен на синтетических логах.

## 3. Staging benchmark — NOT MEASURED (блокер: нет ключей)

Доступа к реальным JEV/LLM нет — сетевые p50/p95, холодный/тёплый кэш, TTFT и точность маршрутизации **не измерялись и не выдуманы**. Готовность обеспечена:

- телеметрия из п.2 пишет всё, что нужно, по реальному `run_id`;
- `ai_run_profile_export.py` собирает p50/p95 из лога;
- `tests/test_e2e_ai_intent_modes.py` — воспроизводимые сценарии CHAT/READ/ACT на fake-provider (прогон регрессий, не latency).

Процедура для стенда: `AI_JEV_ROUTING=1` + ключи JEV/LLM → прогнать ≥20 повторов синтетических диалогов по каждому режиму (cold+repeat для cache hit/miss) → `--log worker.log --out profile.json`.

## 4. `AI_JEV_ROUTING=0` — регрессий нет

Фикстура `agent` в e2e-suite сама ставит флаг 0: **153/154 PASS** (`test_e2e_ai_draft_reliability`, `test_ai_run_conversation_serialization`, `test_ai_prompt_injection`, `test_mail_draft_lifecycle`). Единственный FAIL — `test_claude_transport_...`, pre-existing (воспроизводится на `2fdb29bc` до A5).

## 5. Результаты тестов

| Suite | Итог |
|---|---|
| Полный прогон (все A5/A5.1 suite + экспортёр, цикл 3) | **398/399 PASS**, 1 FAIL — `test_claude_transport_...` (pre-existing на `2fdb29bc`, вне scope) |
| `AI_JEV_ROUTING=0` legacy (e2e draft, serialization, injection, mail, stability) | зелёные в том же прогоне — фикстура держит флаг 0 |
| Экспортёр (unit + реальный CLI) | **12/12 PASS** |

## Оставшиеся ограничения

- Конфликт `chat + core` в **group-mode** намеренно не менялся (запрос ревью ограничен tool-mode); там `chat_p>=thr` по-прежнему обнуляет routed — задокументировано, при желании унифицировать отдельным изменением.
- Реальная точность JEV и сетевые метрики — ожидают стенда (п.3).
