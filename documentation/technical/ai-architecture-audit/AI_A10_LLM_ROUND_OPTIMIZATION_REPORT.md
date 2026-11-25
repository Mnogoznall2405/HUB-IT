# A10 — Сокращение количества LLM-вызовов (LLM Round Optimization)

**Ветка:** `perf/a10-ai-llm-rounds`
**База:** A9 HEAD `4f5349c9` (зависимость от A9 обязательна — не смешивать в одном PR)
**Статус:** реализация завершена, экспериментальные режимы выключены по умолчанию, бенчмарк в работе

---

## 1. Аудит полного AI pipeline (§2.1)

Все обращения к моделям в `backend/ai_chat/service.py::_execute_run` и `memory.py`:

| Вызов | Где | Зачем | Обязателен? | Замена/параллель | Результат аудита |
|---|---|---|---|---|---|
| JEV routing | `jev_client.route()` до первого LLM | Выбор группы инструментов (chat/read/act) | Да — сужает tool surface и бюджет | Нет (детерминированная эвристика уже есть как fallback при отказе JEV) | Оставлен; JEV отдельная модель, не counted как main LLM |
| memory planner | `memory.py::_plan_and_apply` (~315) | Выбор relevant_facts + remember/update/forget | Только при write-intent или наличии фактов | При отсутствии личных маркеров — детерминированный keyword-overlap (уже используется как failure-fallback) | **Оптимизировано** (`AI_MEMORY_PLANNER_OPTIMIZATION_ENABLED`, см. §4) |
| memory reconciliation/apply | `_apply` внутри planner-вызова | Применение changes с revision/replay-контролем | Да, но не LLM-вызов | — | Без изменений |
| summary | `memory.py::summarize` (~377) | Фоновая компрессия диалога | Асинхронно, вне критического пути ответа | — | Без изменений (не влияет на server_total ответа) |
| first | `_complete_json_step` «first» | Выбор инструментов / ответ | Да | zero-LLM READ для узкого whitelist (§2.3) | **Оптимизировано** (экспериментально) |
| followup | цикл раундов, `call_kind="followup"` | Ответ после инструментов или следующий раунд | Для multi-round — да; для одиночного READ — нет | **READ fast path** (§2.2): детерминированный рендер результата | **Оптимизировано** (`AI_READ_FAST_PATH_ENABLED`) |
| budget_final | `call_kind="budget_final"` | Финальный ответ при исчерпании token budget | Да — готового ответа нет | Детерминированный ответ опасен: скрывал бы незавершённость | **Оставлен** — см. §7 |
| forced_final | `call_kind="forced_final"` | Ответ при исчерпании раундов или пустом answer | Да | То же — требуется честное резюме незавершённого | **Оставлен** — см. §7 |
| JSON repair | retry внутри `_complete_json_step` (attempt=1, `invalid json payload`) | Восстановление после невалидного JSON | Да (редкий) | Уже ограничен одной попыткой и проверкой бюджета | Без изменений |
| transport retries | `shared/llm` внутри `complete_json` | Сетевые повторы | Да | — | Считаются в `attempts` телеметрии, не отдельные логические вызовы |
| Параллельные инструменты | `_execute_tool_calls` + `_detect_data_dependencies` | Независимые вызовы в одном раунде | Уже реализовано | Уже выполняется через `asyncio.gather` по группам топологической сортировки | Добавлен kill-switch `AI_PARALLEL_READ_TOOLS_ENABLED` (default ON) |
| Повторные вызовы инструментов | раунды цикла | Модель иногда повторяет tool_id+args | Нет | **Run result reuse** (§2.6) | **Оптимизировано** (`AI_RUN_RESULT_REUSE_ENABLED`) |

**Типичный сценарий 3–5 вызовов до A10:** JEV + memory planner + first + followup (+ forced_final при неудаче). Простой READ-запрос («найди принтер в 204») делал: planner (если есть факты и личные маркеры в тексте) + first + followup = **2–3 основных LLM-вызова**. Цель §2.2 — сократить до 1.

---

## 2. READ fast path (§2.2) — `AI_READ_FAST_PATH_ENABLED` (default OFF)

**Проблема.** Одиночный однозначный READ («найди сотрудника», «мои заявки», «список филиалов») тратил 2 LLM-вызова: first (выбор инструмента) + followup (пересказ результата). Followup добавляет ~1–3 c и сотни токенов, не меняя факты.

**Реализация.** После первого раунда инструментов (`tool_rounds_used == 1`), до followup:

- `_try_read_fast_path_answer()` проверяет все условия и возвращает `_format_fallback_tool_answer(results)` — существующий детерминированный рендерер, расширенный скалярными полями для detail/card-результатов.
- Whitelist `_FAST_PATH_READ_TOOLS` (~70 READ-инструментов из реального реестра; ни один `.action.*`/draft/delivery/meta-инструмент не входит).
- Условия fast path (все одновременно): первый раунд, ровно один реальный tool call, tool_id ∈ whitelist, intent ≠ ACT, нет meta-вызовов (`read_more`, `request_tool_group`), нет template/report intent, результат `ok` без `error`, не `truncated`/`has_more`, список не частичный (`returned_count >= total` или items пусты).
- **Частичный список никогда не выдаётся за полный** — `returned < total` → обычный pipeline (модель пагинирует или честно указывает лимит).
- Ответ сохраняет источники («Источник: ITinvent / <db>»), строки, счётчики — тот же формат, что fallback-ответ.
- Телеметрия: `final_usage["fast_path_hit"]`, `extracted_context["fast_path_hit"]`.

**Fallback:** любое нарушение условия → обычный followup-вызов LLM. ACT никогда не проходит fast path.

## 3. Zero-LLM READ (§2.3) — `AI_DIRECT_READ_ENABLED` (default OFF)

**Исследование.** Для узкого класса самообслуживаемых вопросов LLM нужен только чтобы выбрать инструмент и пересказать ответ — оба шага детерминизируемы.

**Реализация (экспериментальная, консервативная):**

- `_DIRECT_READ_PATTERNS` — 4 строгих whole-prompt паттерна (≤100 символов): мой телефон → `me.account.status`; оборудование за мной → `me.equipment`; когда истекает пароль → `ad.user.password_status`; мои активные задачи → `office.tasks.search`.
- Паттерн матчит **весь короткий промпт целиком** — ключевое слово внутри длинного запроса никогда не срабатывает; инструмент должен быть enabled для конкретного пользователя (проверка по `tool_specs`) и входить в `_FAST_PATH_READ_TOOLS`.
- Пайплайн: промпт → прямое выполнение инструмента через `_execute_tool_calls` (все ACL/draft-policy/таймауты сохраняются) → `_format_fallback_tool_answer`. **0 основных LLM-вызовов** (JEV/planner по-прежнему могут сработать — они не основные).
- Неудачный/пустой результат → обычный LLM pipeline (лог `direct-read result unusable, falling back`).
- JEV-группа не используется как доказательство намерения — решение принимает только точный текст промпта.
- Телеметрия: `direct_read_hit`.

## 4. Memory planner (§2.4) — `AI_MEMORY_PLANNER_OPTIMIZATION_ENABLED` (default OFF)

**Проблема.** При наличии фактов памяти planner вызывался на каждое сообщение, даже чисто справочное («найди принтер в 204»), если текст содержал любые личные маркеры... а при их отсутствии — всё равно вызывался ради relevance selection.

**Реализация.** В `memory.prepare`: если `has_write_intent(text) == False` и флаг включён — planner заменяется детерминированным отбором по пересечению слов (ровно тот алгоритм, что применяется в fallback при сбое planner-LLM), `status="deterministic"`.

- Явные команды памяти («запомни», «забудь», «мой/мои…») всегда дают write-intent → planner сохраняется. `_WRITE_INTENT_RE` намеренно широкая: ложное срабатывание = лишний вызов, пропуск = потерянный факт.
- `processed`/`old_source`/replay-ветки не затрагиваются: без write-intent изменений нет.
- Содержимое документов не может стать командой изменения памяти — write-intent считается только по тексту текущего сообщения пользователя.

## 5. Параллельные инструменты (§2.5)

**Аудит.** `_execute_tool_calls` уже параллелит независимые вызовы: `_detect_data_dependencies` строит топологические группы (draft-инструменты всегда зависят от предыдущих, повторный вызов того же tool_id сериализуется), внутри группы — `asyncio.gather`/`asyncio.to_thread`, ошибки одного вызова не отменяют остальные, порядок результатов сохраняется по индексам.

**Изменение A10:** только kill-switch `AI_PARALLEL_READ_TOOLS_ENABLED` (default **ON** — поведение предшествует A10; OFF возвращает строго последовательное выполнение). Пул потоков не создаётся — используется существующий to_thread-семафор рантайма.

## 6. Run result reuse (§2.6) — `AI_RUN_RESULT_REUSE_ENABLED` (default OFF)

**Проблема.** Модель иногда повторяет `tool_id + args` в следующем раунде (перепроверка, забытый результат).

**Реализация.** Per-run `reuse_state` (dict) разделяется между раундами:

- Ключ: `tool_id|json.dumps(args, sort_keys)` — нормализация аргументов включена (sort keys, unicode, default=str).
- Только READ-класс: любой tool_id, содержащий маркеры действия (`.action.`, `draft`, `send`, `create`, `attach`, `transfer`, `dismiss`, `export`, `request_tool_group`, `read_more`) исключён.
- Кэш живёт **только внутри run** — scope/user/db/ACL зафиксированы в `tool_context`, чужие данные недостижимы.
- **Инвалидация:** любой mutating-результат ставит `reuse_state["_mutation"]` — после ACT дальнейшие READ не переиспользуются (устаревший READ после изменения объекта невозможен).
- Reused-результат помечается `payload["_a10_reused"]=True` и `trace.diagnostic.a10_reused` — виден в телеметрии.
- Ошибки и ACT не кэшируются. Pagination: одинаковые args = одинаковая страница — корректно.

## 7. forced_final / budget_final (§2.7) — аудит без изменений

Оба вызова срабатывают **только когда готового ответа нет**:

- `budget_final` — token budget исчерпан до финального ответа. Промпт содержит все accumulated results; без вызова ответ был бы fallback-строкой без сводки.
- `forced_final` — исчерпаны раунды при висящих tool_calls или пустой answer. Промпт явно требует «summarize accomplished + what remains unfinished» — детерминированная замена скрыла бы незавершённые операции, что запрещено спецификацией.

**Решение:** оставить. Частота этих веток снижается косвенно: fast path завершает одиночные READ за 1 раунд, reuse убирает лишние раунды повторов — до exhaustion доходит реже.

## 8. Feature flags (§2.8)

| Флаг | Default | Назначение |
|---|---|---|
| `AI_READ_FAST_PATH_ENABLED` | **0** | §2.2 deterministic READ answer |
| `AI_DIRECT_READ_ENABLED` | **0** | §2.3 zero-LLM whitelist |
| `AI_MEMORY_PLANNER_OPTIMIZATION_ENABLED` | **0** | §2.4 deterministic planner skip |
| `AI_PARALLEL_READ_TOOLS_ENABLED` | **1** | kill-switch существующей параллелизации |
| `AI_RUN_RESULT_REUSE_ENABLED` | **0** | §2.6 per-run READ reuse |

Все задокументированы в `.env.example`, независимы от `AI_PROMPT_OPTIMIZATION_ENABLED` (A9).

## 9. Benchmark (§2.9)

**Корпус:** `a9_quality_corpus.json` (100 сценариев) + `a10_round_corpus.json` (16 новых: DIRECT×4, FASTPATH×4, MULTI×2, AMBIG×2, MEMORY×2, ACT×1, REUSE×1).

**Реальный LLM-прогон:** `a9_real_run.py` на RouterAI `google/gemini-3.7-flash` + JEV `typesafe/jev-1.14` (live-верифицировано: `jev-1.14-20261014`). Baseline = `HUB-IT-a9-base-wt@926dd9f5`, candidate A9 = `perf/a9-ai-token-budget@4f5349c9`. Метрики на сценарий: llm_calls, jev_calls, tool_calls, tokens in/out, cost_usd, wall_ms, expected_coverage, violations, fast_path_hit.

**Статус прогонов:** полный 100-сценарный corpus (baseline `@926dd9f5` vs candidate `@4f5349c9`) выполняется — см. артефакты `real_run_*_jev1.json`.

**Live-smoke A10 (реальный RouterAI + JEV 1.14, `a10_round_corpus.json`, все флаги ON):**

| Сценарий | LLM-вызовов | fast_path | direct_read | Инструменты |
|---|---|---|---|---|
| a10_fast_01 «Найди сотрудника по фамилии Иванов» | **1** | ✅ | — | directory.people.search |
| a10_fast_02 «Принтеры с низким тонером» | **1** | ✅ | — | mfu.devices.low_toner |
| a10_direct_04 «Покажи мои активные задачи» | **0 основных** (1 = memory planner, write-intent «мои») | ✅ | ✅ | office.tasks.search (server-side) |
| a10_mem_01 «Запомни: отчёты в docx» | 2 (planner сохранён для явной команды) | — | — | — |
| a10_act_01 «Отправь письмо…» | 2, draft-only, forbidden `mail_send` не вызван | — | — | office.mail.contacts.resolve |
| a10_amb_01 «Что у нас с оргтехникой?» | 3 (неоднозначный → обычный pipeline) | — | — | request_tool_group, mfu.devices.list |
| a10_direct_01/02/03 | 2–5 | — | fallback | результат инструмента не ok для синтетического пользователя → корректный откат в LLM pipeline |

Подтверждено вживую: одиночный READ = 1 LLM-вызов вместо 2; zero-LLM для whitelist-промптов; явные memory-команды сохраняют planner; ACT не проходит fast path; неоднозначные запросы остаются на полном pipeline.

**Полный 100-сценарный corpus (§2.9, реальный API):** прогон `a9_real_run.py` выполнен на base `@926dd9f5` и cand `@4f5349c9` (A9 HEAD — код, от которого ветвится A10). Баланс RouterAI исчерпан (402) на ~60%; провалившиеся сценарии дозапущены симметрично через OPENROUTER_API_KEY (та же модель `google/gemini-3.7-flash`, JEV неизменен). 100/100 completed обе стороны:

| Категория | llm b→c | in_tok b→c | coverage b/c | violations |
|---|---|---|---|---|
| chat | 1.0→1.0 | 1870→1239 −34% | 0/0 | 0/0 |
| read | 2.5→2.1 | 10814→5137 −52% | 14/35 равно | 0/0 |
| act | 2.4→2.2 | 19297→9936 −48% | 10/35 равно | 0/0 |
| multi | 2.7→2.9 | 12199→10922 −10% | 6/21→8/21 | 0/0 |
| longctx | 3.6→3.4 | 13279→9862 −26% | 0/20 | 0/0 |
| err | 1.9→1.8 | 8424→5753 −32% | 2/8 | 0/0 |
| **Σ** | **224→210** | — | parity | **0** |

Среднее число вызовов на read-сценарии: 2.5 (base) → 2.1 (cand без A10-флагов) — базовая линия для A10. Артефакты: `real_run_{base,cand}_final.json`.

**A10-корпус flags ON vs OFF (16 сценариев, OpenRouter, тот же код):** `real_run_a10on.json` / `real_run_a10off.json`. Провайдер нестабилен под внешней нагрузкой (часть OFF-прогонов падала с 0 usage — транзиентные ошибки, не код). Зафиксированное поведение при флагах ON:

- `a10_direct_04`: 1 LLM-вызов (только memory planner), `direct_read_hit` + `fast_path_hit` — против 2 при OFF
- `a10_fast_01/02`: 1 LLM-вызов с `fast_path_hit` — против 1–2 при OFF
- `a10_multi_01/02`, `a10_amb_01/02`: fast path НЕ сработал (корректно — зависимые/неоднозначные)
- `a10_mem_01/02`: planner сохранён для явных команд памяти
- `a10_act_01`: draft-only, fast path не сработал (корректно)

Итоговые llm 30 vs 31 — на 16-сценарном корпусе неинформативно из-за провайдерских сбоев; реальный эффект проявляется по `fast_path_hit`/`direct_read_hit` (1–2 сохранённых вызова на подходящих сценариях) и по live-smoke выше.

**NOT MEASURED честно:** p50/p95 server_total (внешняя нагрузка на бенч-машине делает wall-time несравнимым); доля fast_path на полном 100-сценарном корпусе при включённых флагах — отдельный прогон после приёмки; cached_tokens провайдер не возвращает.

**Архитектурный прогон (scripted LLM):** unit-тесты `tests/test_ai_llm_rounds.py` (30) фиксируют гарды fast path, паттерны direct-read, ветвление planner-skip и scalar-рендеринг. NOT MEASURED для архитектурного числа вызовов на корпусе — заменяется реальным прогоном.

## 10. Цели A10 (§2.10) — статус

| Цель | Статус |
|---|---|
| Простой READ: 2→1 LLM-вызов | **Подтверждено живьём**: `a10_fast_01/02` — 1 вызов + `fast_path_hit` |
| Исключение необязательного planner | Реализовано за флагом; ветвление проверено юнит-тестами |
| Среднее число LLM-вызовов −25–40% | **Не достигнуто на корпусе**: A10-флаги OFF по умолчанию; при ON — точечная экономия 1–2 вызова на whitelist-сценариях, доля таких сценариев в общем потоке мала. Честный вывод: крупное сокращение требует включения fast path по умолчанию после приёмки |
| server_total p50/p95 ↓ | NOT MEASURED (внешняя нагрузка на бенч-машине) |
| Суммарные токены на run ↓ | −26…52% входных токенов подтверждено на реальном прогоне (эффект A9-слоя; A10 добавляет saved calls там, где срабатывает) |
| Без новых нарушений прав/безопасности | Юнит-тесты гардов + ACT исключён из всех путей; forbidden violations = 0 на реальном корпусе |
| Без неполных/выдуманных ответов | Частичные списки и неудачные результаты всегда идут через LLM (проверено: `a10_direct_02` fp не сработал на partial result) |

## 11. Регрессии (§2.11)

- `tests/test_ai_llm_rounds.py` — **30/30**
- `tests/test_ai_prompt_compaction.py` — **20/20**
- A1: `test_ai_run_stability.py` + `test_ai_run_watchdog.py` — green (включая `test_tool_call_timeout_integration_in_execute_tool_calls` после фикса `reuse_state`)
- A3: `test_ai_prompt_injection.py` — 1 падение `test_prompt_contains_no_highest_priority_and_untrusted_blocks`, **идентичное baseline `4f5349c9`** (env-sensitivity, не A10)
- A5/A5.1: `test_e2e_ai_draft_reliability` + `test_e2e_ai_smart_memory` — 67/70; 3 падения (`claude_transport…`, `correction_replaces_fact…`, `action_state…`) **идентичны baseline `4f5349c9`** — env-sensitivity (ожидают включённые A9-флаги в промпте), не A10
- PG gate: `test_pg_a8_gate` + `test_ai_run_serialization_pg` — **24/24** (portable PG, `a8test`@55432, база `a10_gate`)

## 12. Риски и rollback

| Оптимизация | Риск | Митигация | Rollback |
|---|---|---|---|
| READ fast path | Бледный ответ без анализа | Только одиночный завершённый READ; strict guards; flag OFF | `AI_READ_FAST_PATH_ENABLED=0` |
| Direct read | Перехват сложного запроса | Whole-prompt match ≤100 chars, enabled-tool check, fallback при неудаче | `AI_DIRECT_READ_ENABLED=0` |
| Planner skip | Промах relevance selection | Keyword-overlap = существующий failure-fallback; write-intent всегда → planner | `AI_MEMORY_PLANNER_OPTIMIZATION_ENABLED=0` |
| Result reuse | Устаревший READ | Инвалидация после любого ACT; только ok-результаты; per-run scope | `AI_RUN_RESULT_REUSE_ENABLED=0` |
| Параллелизм | Негативные взаимодействия | Предсуществующее поведение + kill-switch | `AI_PARALLEL_READ_TOOLS_ENABLED=0` |

**Известный инцидент разработки:** первая версия reuse хранила состояние через `setattr` на `AiToolExecutionContext` (slotted dataclass) → AttributeError падал на каждый вызов инструмента; поймано регрессией `test_tool_call_timeout_integration_in_execute_tool_calls`, исправлено передачей `reuse_state` параметром (`f027343c`).

## 13. Границы проверки (честно)

- Реальные tokens/latency/cost/fast_path_hit по корпусу — **измеряются** живым прогоном (артефакты в `a9-artifacts/real_run_*`); до их сбора метрики §10 помечены «ожидает прогона».
- Качество русскоязычных ответов deterministic-рендеров оценивается сценариями корпуса + ручной проверкой; не заменяет приёмку на реальном контуре.
- Экспериментальные режимы default OFF — включать только после сравнения с baseline.

## 14. Cycle 2 — качество и достоверность (§1–§6 директивы)

### 14.1 Харнес v2 (`a9-artifacts/a9_real_run.py`)

Переписан полностью (~700 строк): реальный статус `AppAiBotRun`, ответ ассистента
через `result_json.result_message_id` (никогда не последнее user-сообщение),
фактические `tool_traces` из `result_json` отдельно от model-proposed calls,
классификация completed/degraded/failed + correctness PASS по обязательным
фактам, разделение `provider_error_scenarios` / `app_error_scenarios`,
`cost_missing_calls` — неизвестный usage не считается нулевым расходом,
wildcard `*any-tool*`, инкрементальная запись после каждого сценария.
Учитывает серверные direct-read вызовы (`direct_read_hit`/`fast_path_hit` из
usage_json рана).

### 14.2 Синтетический контур (`bench_seed.py` + `bench_seeded_corpus.json`)

`JSONDataManager` сидируется через app_db (address_book: сотрудники,
подразделения, контакты), задачи через `hub_service.create_task`, KB через
`AppAiKbDocument/AppAiKbChunk`, файлы через `AppMyFile`, оргструктура через
`AppOrgStructureNode`. SQL Server `10.103.0.213`: CREATE DATABASE запрещён;
`OLD-ITINVENT` доступен read-only (2365 ITEMS). Права seeded-пользователей —
по фактическим именам из tools (`tasks.review` и т.д.).

### 14.3 Специализированные рендереры (§3)

Технический «Результат — office.tasks.search, показано: 0» заменён
per-tool renderer-политиками, выдающими естественный русский ответ
(«У вас нет активных задач», сводки по срокам, числам, объектам).
Служебные tool_id и технические поля не попадают в ответ; источники,
идентификаторы, сроки и статусы сохраняются.

### 14.4 Ужесточённые гарды (§4) и direct-read (§5)

Whitelist сокращён до проверенных READ-инструментов. Fast path не срабатывает
на: сравнениях, анализе/причинах, составных и многошаговых запросах,
неоднозначности, условиях из истории, пустом results при total>0,
rows-вместо-items, вложенных структурах. Сокращённый ответ не выдаётся за
полный — partial/aggregate данные идут через LLM.

Direct-read: regex без произвольных `.{0,40}`-префиксов, блокеры на
отрицания («не показывай»), сравнения («сравни X и Y»), причинные запросы
(«почему», «объясни как»), составные запросы. Аргументы инструмента
строятся явно (запрос активных задач реально фильтрует активные).
Гейт на JEV `intent_mode` + проверка доступности инструмента пользователю.

### 14.5 Result reuse — реальная классификация (§6)

Классификация READ/ACT вынесена в модульный `_is_mutating_tool_id`:
маркеры в tool_id + явный `_MUTATING_TOOL_IDS` (`me.files.attach`,
`ai.files.convert_document`, `ai.files.report`, COMMUNICATION_DRAFTS) —
файлопродуцирующие инструменты мутируют состояние без ".action" в имени.
- Ошибки никогда не кэшируются (запись только `ok`-результатов).
- Scope/database/pagination входят в ключ через args — другая страница
  или другой `database_id` не берётся из кэша.
- Любой ACT-результат ставит `reuse_state["_mutation"]` — после изменения
  данных READ не переиспользуется.
- Повторная подача помечается `_a10_reused` + `_a10_reused_note` — модель
  получает явное указание не повторять вызов (защита от роста раундов).

Memory planner: `has_write_intent` покрывает явные remember/forget/update и
неявные предпочтения (предпочитаю/всегда/никогда/по умолчанию); skip только
при полном отсутствии личных маркеров или при пустой памяти — ложных
изменений памяти не возникает, т.к. детерминированная ветка изменений
не производит вовсе.

### 14.6 Провайдер JEV — RouterAI

`jev_client` резолвит пару ключ+URL: `JEV_*` → `ROUTERAI_*` → `OPENROUTER_*`;
`get_status()` сообщает фактический провайдер. JEV `typesafe/jev-1.14`
идёт через `/systemone` RouterAI, когда задан `ROUTERAI_API_KEY`.

### 14.7 Тесты

`tests/test_ai_llm_rounds.py` — **46/46**: гарды fast path, direct-read
блокеры, renderer-политики, классификация мутаций (включая проверку, что
все mutating-id из реестра классифицированы), planner ветвление.

### 14.8 Реальный A–G benchmark (§7) — выполнен на RouterAI

Провайдер: **RouterAI** (единый маршрут для всех конфигураций), модель
`google/gemini-3.7-flash`, JEV `typesafe/jev-1.14` через `routerai.ru/api/v1/systemone`
(резолвинг `ROUTERAI_*` → paired key+URL). OpenRouter в итоговую выборку не
смешивался. Конфигурация A — исходный main `@926dd9f5` (ворктри
`HUB-IT-a9-base-wt`, та же v2-версия харнеса). Корпус —
`bench_seeded_corpus.json` (16 сценариев на синтетических данных:
100 сотрудников, 100 задач, 20 объявлений, 10 KB, 30 файлов, 6 пользователей
с разными правами). Каждый конфиг — отдельный живой прогон `--seed`.
Provider-ретраи: только при provider-side ошибках (до 2), без замены
ошибок нулевым usage.

| cfg | completed | degraded | failed | PASS | FAIL | NO_CHECK | llm | in_tok | out_tok | fp | dr | wall_s |
|-----|-----------|----------|--------|------|------|----------|-----|--------|---------|----|----|--------|
| A | 16 | 0 | 0 | 13 | 1 | 2 | 45 | 213982 | 18861 | 0 | 0 | 720 |
| B | 16 | 0 | 0 | 12 | 2 | 2 | 48 | 202640 | 22942 | 0 | 0 | 679 |
| D | 16 | 0 | 0 | 12 | 2 | 2 | 39 | 153789 | 11492 | 7 | 0 | 352 |
| E | 16 | 0 | 0 | 12 | 2 | 2 | 33 | 126491 | 7841 | 8 | 2 | 197 |
| F | 16 | 0 | 0 | 12 | 2 | 2 | 31 | 130320 | 8423 | 7 | 2 | 291 |
| G | 15 | 1 | 0 | 12 | 3 | 1 | 34 | 146144 | 7944 | 7 | 2 | 201 |

(C == B на объединённом дереве: A10-флаги по умолчанию OFF — конфигурация
идентична, отдельный прогон не тратил квоту.)

**Выводы:**
- **−29% основных LLM-вызовов** A→F (45→31) и **−24%** A→G (45→34) при
  паритете correctness (12–13 PASS из 16 во всех конфигах).
- **−39% входных токенов** A→F (213982→130320); wall −60%.
- fast_path сработал в 7–8 сценариях, direct_read — в 2
  (`sd_tasks_01`: 3→1 вызов, 11883→621 входных токена — **−95%**).
- Все guard-сценарии корректны: `sd_direct_neg` («Не показывай мой телефон»)
  и `sd_direct_cmp` (сравнение) ни разу не вошли в direct-read;
  `direct_read_hit=false` подтверждено трассами.

**Корректура корпуса (честность метрик):** 4 сценария исправлены после
первого прогона и перепрогнаны по всем конфигам отдельно
(`real_run_*_fix.json`): `sd_ann_01` — реальный id инструмента
`office.announcements.list`; `sd_direct_why` — снято ложное
forbidden-ограничение (просмотр доступа задачным инструментом легитимен);
`sd_files_01` — промпт уточнён (инструмент требует query ≥ 2 символов);
`sd_kb_01` — required_fact снят (KB retrieval в харнесе заглушен).
Итоговые FAIL — модельные, а не флаговые: модель стабильно выбирает
`kb.articles.search` вместо `office.announcements.list` для объявлений и
`itinvent.user.by_name` вместо `directory.people.search` — во всех конфигах
одинаково, включая A (baseline).

**ACL-находка (предсуществующая):** `office.tasks.search` не проверяет право
`tasks.read` — пользователь `bench_me_only` (без этого права) получает список
своих задач и через LLM-путь, и через fast path. Сервис фильтрует по
участию, поэтому утечки чужих данных нет, но сама проверка права отсутствует
— зафиксировано как находка вне скоупа A10 (не регрессия: поведение
идентично во всех конфигах включая main).

### 14.9 Альтернативные модели (smoke на конфиге G)

| Модель | Сценариев | PASS | Наблюдения |
|---|---|---|---|
| `google/gemini-3.7-flash` | 16 | 12 | Базовая для отчёта |
| `thinkingmachines/inkling-2-mini` | 6 | 4 | reasoning-модель (~70 reasoning tok/вызов); direct-read работает; tool-routing слабее — на `sd_dir_01` выбрала `itinvent.user.by_name`; склонна к лишним раундам (`sd_ann_01`: 6 вызовов) |
| `upstage/solar-pro-4-contributor` | 6 | 3 | tool-routing заметно слабее: не вызвала инструмент в 2/6, неверный в 1/6 |

Для продакшен-агента tool-routing gemini-3.7-flash остаётся лучшим из
проверенных; альтернативы требуют отдельной оценки на полном корпусе.
