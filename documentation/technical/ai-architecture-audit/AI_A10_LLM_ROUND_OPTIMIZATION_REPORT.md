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

**Архитектурный прогон (scripted LLM):** unit-тесты `tests/test_ai_llm_rounds.py` (30) фиксируют гарды fast path, паттерны direct-read, ветвление planner-skip и scalar-рендеринг. NOT MEASURED для архитектурного числа вызовов на корпусе — заменяется реальным прогоном.

## 10. Цели A10 (§2.10) — статус

| Цель | Статус |
|---|---|
| Простой READ: 2→1 LLM-вызов | Реализовано за флагом; подтверждение — real-прогон |
| Исключение необязательного planner | Реализовано за флагом |
| Среднее число LLM-вызовов −25–40% | Ожидает real-прогона |
| server_total p50/p95 ↓ | Ожидает real-прогона |
| Суммарные токены на run ↓ | Ожидает real-прогона |
| Без новых нарушений прав/безопасности | Юнит-тесты гардов + ACT исключён из всех путей |
| Без неполных/выдуманных ответов | Частичные списки и неудачные результаты всегда идут через LLM |

## 11. Регрессии (§2.11)

- `tests/test_ai_llm_rounds.py` — **30/30**
- `tests/test_ai_prompt_compaction.py` — **20/20**
- A1: `test_ai_run_stability.py` + `test_ai_run_watchdog.py` — green (включая `test_tool_call_timeout_integration_in_execute_tool_calls` после фикса `reuse_state`)
- A3: `test_ai_prompt_injection.py` — 1 падение `test_prompt_contains_no_highest_priority_and_untrusted_blocks`, **идентичное baseline `4f5349c9`** (env-sensitivity, не A10)
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
