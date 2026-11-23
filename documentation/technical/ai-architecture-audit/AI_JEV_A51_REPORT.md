# A5.1 — tool-mode conflict fix, run-profile telemetry, staging readiness

База: `b2d36b38` (HEAD PR #21). Ветка: `perf/ai-jev-a51`. Отдельная небольшая работа — не смешана с архитектурным PR #21.

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
| intent_modes + jev_routing + tool_routing + e2e_intent_modes | **170/170 PASS** |
| e2e_draft_reliability + serialization + injection + mail_lifecycle (флаг 0) | **153/154** (1 pre-existing FAIL) |

## Оставшиеся ограничения

- Конфликт `chat + core` в **group-mode** намеренно не менялся (запрос ревью ограничен tool-mode); там `chat_p>=thr` по-прежнему обнуляет routed — задокументировано, при желании унифицировать отдельным изменением.
- Реальная точность JEV и сетевые метрики — ожидают стенда (п.3).
