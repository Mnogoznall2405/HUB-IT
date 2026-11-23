# AI JEV — интеграционный sign-off: A5 (PR #21) + A5.1 (PR #22) → main

Дата: 2026-11-23. Исполнитель: независимая приёмка (Devin).

## 1. Исходные и итоговые HEAD

| Объект | До | После |
|---|---|---|
| `main` | `f84e1565` (merge A3, PR #20) | **`ca023c2e`** |
| PR #21 (A5) | head `b2d36b38`, base `main` | **MERGED**, merge-коммит **`8fe51ab7`** |
| PR #22 (A5.1) | head `e1a05d23` → `a4c4473f` (signoff-фикс экспортёра), base переведён на `main` | **MERGED**, merge-коммит **`ca023c2e`** |

Стратегия: merge-коммиты (как принято в репозитории, см. `f84e1565`). Force-push к main не применялся; branch protection не настроена (API 404), обязательных CI checks нет (check-runs пусты на обоих head). Deploy не выполнялся.

## 2. Проверки перед слиянием

- Фактические HEAD совпали с заявленными; `mergeable=clean` у обоих PR.
- Diff PR #21 — только A5-файлы (service.py, tools/context.py, tools/registry.py, отчёт, 4 тестовых файла): +1606/−125.
- Diff PR #22 после retarget на `main` — только 3 коммита A5.1, 6 файлов, +839/−14. Rebase не потребовался (merge-метод, A5-коммиты — предки ветки).
- Незакоммиченные изменения в рабочих деревьях — чужие (пользователя, HUB-IT-main), не затронуты.

## 3. Безопасность (код `ca023c2e`, статическая проверка + тесты)

- **CHAT**: `run_allowed_tools = frozenset()` — tool specs пусты, вызовы не исполняются; пустой ответ → текстовый fallback без tools/файлов (e2e `test_chat_run_...`).
- **READ**: `run_allowed_tools` = только `tool_effect(id) == read` из точного allowlist `_TOOL_READ_TOOLS` (100 инструментов проаудированы); неизвестный id → `unknown`, fail-closed; model-generated `artifacts`/`kb_attachment_send` стрипаются и в CHAT, и в READ; specs фильтруются по потолку до отправки модели.
- **ACT**: действия только через draft/action-card подтверждение; серверная проверка прав и получателя (A3) сохранена — `test_ai_prompt_injection` зелёные.
- **JEV**: один `decide()` — mode-вопросы (`m_mode_chat`/`m_mode_act`) в том же запросе, доп. сетевых вызовов нет; пустой выбор/fallback/timeout ≠ CHAT; конфликт chat+core (tool-mode) и chat+routed (group-mode) → READ; переходы CHAT→READ→ACT→CHAT покрыты e2e.
- **Серверный потолок**: `AiToolRegistry.execute_bounded()` отклоняет внепотолочные вызовы и считает `mode_denied_calls` (`registry.py:216-257`).

## 4. Производительность и телеметрия

- `ai_run_profile_final`: `queue_wait_ms` / `processing_ms` / `server_total_ms` (queue+processing, **не** TTFT), `intent`, `used_tools`/`error_tools`/`mode_denied`/`meta_calls`, `prompt/completion/total_tokens`; `elapsed_ms` сохранён для совместимости.
- `run_id` сквозной: `ai_chat.run.*` laps, `ai_jev_routing`, `ai_jev_routing_cache` hit/miss.
- Экспортёр `ai_run_profile_export.py`: сбалансированный парсер `key=value` + `ast.literal_eval` (не `eval`) — списки с пробелами восстанавливаются полностью; повреждённые строки → `parse_errors`, фантомных run нет; per-mode stage p50/p95; `by_cache`, `by_outcome`; многораундовые laps агрегируются per-run без двойного суммирования.
- CLI-проверка на синтетике: `used_tools=['a','b']` → `executed_calls=2`; ok/error/denied/meta разведены.
- Реальные сетевые JEV/LLM показатели: **NOT MEASURED** — ключей/провайдеров на стенде нет.

## 5. Тесты (финальный `main` `ca023c2e`)

| Прогон | Результат |
|---|---|
| Полная матрица: intent_modes, jev_routing, tool_routing, tool_permissions, prompt_injection (A3), serialization (A4), stability+watchdog (A1), mail_lifecycle, e2e_intent_modes, e2e_draft_reliability, run_profile_export | **408/409 PASS**, 1 FAIL |
| Legacy `AI_JEV_ROUTING=0` (e2e_draft_reliability + mail_lifecycle) | **58/59 PASS**, 1 FAIL — тот же |
| Экспортёр unit | **12/12 PASS** |

Единственный FAIL: `test_claude_transport_keeps_recipient_arguments_through_http_worker` — **pre-existing** (воспроизведён на baseline `2fdb29bc` до A5). Сигнатура на `ca023c2e` идентична baseline: `'types.SimpleNamespace' object is not iterable`, `pop from empty list` — характер и причина не изменились, к A5/A5.1 отношения не имеет.

## 6. Feature flag — фактическое состояние

- Код: `AI_JEV_ROUTING` default `"0"` (`service.py:1245`), `.env.example` = `0`. **Merge сам по себе JEV не активирует.**
- **ВНИМАНИЕ (требует решения владельца перед деплоем)**: локальный `.env` в `C:\Project\HUB-IT-main` содержит `AI_JEV_ROUTING=1` (выставлен ранее, до merge). Если этот `.env` обслуживает production-backend на данной машине, **деплой/перезапуск кода `ca023c2e` активирует JEV-роутинг**. Перед деплоем выставить `AI_JEV_ROUTING=0` в соответствующем production `.env`. Изменять production ENV в рамках этой задачи запрещено — флаг не тронут.
- Конфигурация реального production-сервера извне не проверялась (нет доступа) — статус флага вне локального `.env` **не подтверждён**.

## 7. Известные проблемы и ограничения

1. `test_claude_transport_...` — pre-existing дефект фейк-транспорта в тесте (вне scope A5/A5.1).
2. Точность JEV-модели, реальные p50/p95, токены — не измерены (нет провайдеров); staging-процедура в `AI_JEV_A51_REPORT.md` §3.
3. `kb_attachment_send`/`me.files.attach` — покрытие unit-уровнем, не e2e.
4. Group-mode конфликт разрешён в пользу READ — осознанный fail-safe, задокументирован.

## 8. Что осталось перед включением JEV для сотрудников

1. Убедиться, что production `.env` имеет `AI_JEV_ROUTING=0` **до** деплоя `ca023c2e` (см. §6).
2. Staging-замер: ≥20 повторов CHAT/READ/ACT, cold/warm, cache hit/miss, TTFT, токены, точность маршрутизации; калибровка `AI_JEV_ROUTING_THRESHOLD`.
3. Починить или изолировать `test_claude_transport_...` в тестовом стенде.
4. Пилотный rollout за флагом с мониторингом `ai_run_profile_final` / `mode_denied_calls`.

## Решение

Оба PR корректно интегрированы в `main` (`ca023c2e`), дерево итогового main идентично проверенной ветке. Регрессий не выявлено. Deploy не выполнялся. Условие безопасного деплоя — `AI_JEV_ROUTING=0` в production `.env` — задокументировано как обязательное действие владельца.
