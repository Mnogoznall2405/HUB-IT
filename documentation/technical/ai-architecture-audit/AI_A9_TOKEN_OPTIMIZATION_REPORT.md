# AI A9 Token Optimization Report

**Baseline SHA:** `926dd9f5` (main, post-A8 + My Files V2 + sticker-chain merge base)
**Candidate SHA:** `53d66ddb` (`perf/a9-ai-token-budget`)
**Дата:** 2026-11-24
**Scope:** только AI-агент HUB-IT (`WEB-itinvent/backend/ai_chat/`, `shared/llm/`). Интерфейс чата, стикеры, почта-модуль и «Мои файлы» не тронуты.

## 1. Статус A8 и baseline

- `main = 926dd9f5` — A8 слит (PR #26). Deploy выполняется владельцем по плану A8; **в рамках A9 выкладка не выполнялась**, production БД не трогалась.
- Эффективные флаги в коде main: `AI_SUMMARY_BACKGROUND_ENABLED` default `"0"` (service.py + start_ai_chat_worker.py), `AI_JEV_ROUTING` default `"0"`.
- Production-версия и реальные значения env недоступны из изолированного контура → измерения сняты на воспроизводимом sqlite-харнессе с реальным кодом сборки промпта. Цифры A7 (server p50 13.7 с, avg 19 841 tok) использованы как исторический ориентир, не как baseline.
- **Новая измеряемая baseline**: `prompt_audit_baseline` — см. раздел 4 (та же сборка промпта, до оптимизаций A9).

## 2. Архитектура формирования промпта

```
build_context (rolling_summary ≤1500 tok, 20-msg window, personal_memory ≤4000,
               task_state, file_context ≤9000 chars, KB ≤3000, template candidates)
        │
system_prompt = DEFAULT_BOT_PROMPT + bot.system_prompt + AI_JSON_OUTPUT_LOCK
              + AI_UNTRUSTED_DATA_RULE + JSON-keys/rules + ANSWER_STYLE + UNDERSTANDING
user_prompt   = Bot title + [tool specs per group] + [routing guides per group]
              + summary + history + memory + task_state + status + draft + files
              + KB + templates + instructions + CURRENT USER REQUEST (tail)
        │
_complete_json_step → _fit_prompt_pair(32000 tok budget) → complete_json(schema)
        │ first → [tool_calls] → execute → followup (system identical,
        │          user = prev_user_prompt + tool_results + running_summary + rules)
        └ budget_final / forced_final (SCHEMA_FINAL)
```

Tool specs подаются **текстом в user_prompt** (transport `complete_json` без `tools=`): per-group бюджеты itinvent 3500 / files 1500 / office 1500 / mfu·network·ad 700 / kb·chat 800 / self 1000 / directory 500 / warehouse 600 / other 300 → worst case ≈10.6k tok.

## 3. Инструментация (реализовано в A9)

- `_usage_dict` (`shared/llm/client.py`): теперь вытаскивает `cached_tokens` (`prompt_tokens_details.cached_tokens` / `prompt_cache_hit_tokens`).
- `_complete_json_step` пишет на каждый вызов: `run_id, call_seq, call_kind (first/followup/budget_final/forced_final), tool_round, model, est_system/user_tokens, prompt_blocks, usage, attempts, duration_ms, tool_calls, answer_chars` → в `usage_json` рана (`llm_calls`) + опциональный JSONL-синк `AI_LLM_CALL_LOG_FILE`. Контента промптов/ответов в телеметрии нет.
- `_prompt_block_sizes`: est-токены по именованным блокам промпта (headers → labels).

## 4. Замеренная разбивка токенов (est = len/4)

Харнес: `a9-artifacts/a9_prompt_audit.py` (sqlite, реальный `process_next_run`, scripted `complete_json`). В audit-среде JEV routing активен: routed groups = chat/directory/files/kb/office/self (33 spec урезаны `ai_tool_specs_excess`).

| Блок | chat 1msg | all-tools 1msg | all-tools 60msg | followup r2 |
|---|---|---|---|---|
| system total | 1572 | 1572 | 1572 | 1572→**identical** |
| S: constants+instr | 764 | 764 | 764 | 764 |
| S: answer_style | 416 | 416 | 416 | — |
| S: understanding | 393 | 393 | 393 | — |
| U: tool_specs (все группы) | — | 2744 | 2744 | 2744 |
| U: routing guides | — | ~2139 | ~2139 | ~2139 |
| U: empty placeholders | **~370** | ~370 | ~370 | ~370 |
| U: history+summary | 102 | 109 | 1092 | 109 |
| U: tool_results+running_sum | — | — | — | +230 |
| **TOTAL/run** | 2228 | 6730 | 7716 | 6721+7186=**13907** |

Ключевые находки аудита:
1. ~370 tok пустых плейсхолдеров («No KB context», «[]», «null»…) на **каждый** вызов, включая все followup-раунды.
2. Каждый followup пересылал изменённый system prompt + весь user prompt заново → префикс-кэш провайдера не срабатывал, multi-round ран ≈7k tok/раунд.
3. Раньше specs+guides шли **после** динамического контекста → общий префикс между ранами обрывался на первом динамическом блоке.

## 5. Реализованные оптимизации и результат

| Оптимизация | Эффект (est. tok) |
|---|---|
| Подавление пустых блоков (summary/memory/task_state/draft/files/KB/templates) | −307 на chat-вызов (−14%), −306 на all-tools; экономия повторяется каждый раунд |
| Followup = идентичный system prompt + user = строгий prefix-extension | весь prompt round1 (~5–6k tok) становится cache-hit кандидатом на раунды 2+; до этого хит был ~0 |
| Reorder: title+specs+guides первыми в user_prompt | общий префикс между ранами одного бота/JEV-решения растёт до ~5k (specs+guides+system) |
| `cached_tokens` в usage + `llm_calls` телеметрия | фактическую экономию кэша теперь видно в usage_json и JSONL-синке |

After-candidate (тот же харнес): chat 1921 (−13.8%), itinvent-read 1929, all-tools 6424 (−4.5%), 60-msg 7409 (−4%). Полные данные: `a9-artifacts/prompt_audit_candidate.json`.

Качественная семантика сохранена: untrusted-обёртки, хвост «CURRENT USER REQUEST (authoritative)», правила памяти (`memory_status` блок оставлен — он несёт поведенческие правила), все routing-инструкции и серверные проверки на месте. Подавляются только блоки, чей payload = плейсхолдер отсутствия.

## 5b. Cycle 2 — specs compaction, result projection, block-aware budget (`2a07a567`)

Like-for-like при **JEV=0** (baseline-условия): act_all_tools 6730 → **6065** (−10%), 60-msg 7716 → **7094**, followup-run 13907 → **12484**.
При **JEV=1** (prod-флаг): act_all_tools **2880**, 60-msg **4423**, 2-round run **6114** (2860+3254).

| Изменение | Эффект |
|---|---|
| Spec descriptions: сняты quoted example-листы и «(no arguments)» (дублируют routing guides), tier 400→280 | specs 2744→2386 (−13%) при JEV=0; self 726→535; все tool_id/required/enum сохранены |
| Tool results → LLM projection: list>10 → 10+`_omitted_items` (total/truncated сохранены), str>800 → маркер, drop raw/html/debug | payload-зависимый; исполнение работает на исходных dict |
| `_fit_prompt_pair` → block-aware: приоритеты, protected-блоки (request/tool_results/summary/task_state) не сжимаются, низкоприоритетные — head+tail | устранён слепой срез хвоста при >32k |
| Телеметрия: per-attempt outcome ok/failed, `usage:null` = unknown | разделение logical call / provider attempts |
| Харнес: fixed root discovery, `--jev`, outcome+real tool-execution asserts | воспроизводимость исправлена |

Routing guides (2139 est.) сознательно **не урезаны**: содержат правила draft/confirm/disambiguation (A3/A5) — сокращение рискует угадкой аргументов. Дальнейший выигрыш specs+guides → через JEV-routing (JEV=1 уже даёт −52%).

## 6. Prompt caching — анализ

- Модель бота — OpenRouter (`openai/gpt-4o-mini`-класс): OpenAI-семейство кэширует префикс ≥1024 tok автоматически (дисконт ~50%), Anthropic через `cache_control` (transport пока не проставляет — см. остатки).
- До A9: system prompt отличался между раундами → префикс ломался на ~700-м токене system. После: system байт-идентичен, user = prefix+append → hit на весь предыдущий prompt внутри рана и на system+specs (~5–6k) между ранами.
- Фактическую долю `cached_tokens` покажет телеметрия на живом провайдере — **NOT MEASURED** без API-ключа.

## 7. Регрессии

- `tests/test_ai_chat_runtime.py` + `test_e2e_ai_smart_memory.py`: **86 passed**; 9 failures побайтово идентичны baseline `5ee3408d`-родителю (pre-existing: itinvent-DB-фикстуры, attachment-metadata, smart-memory split-тесты — падают и без изменений A9).
- `test_pg_a8_gate.py` и A8-пути не затронуты (миграций нет).
- JEV on/off, transports, transports retries: код вызова не изменён (только содержимое промптов).

## 8. Оставшиеся узкие места (следующие итерации)

1. `tool_specs_self` 726 + `guide_self` 370, `tool_specs_office` 875 + `guide_office` 613 — per-tool ~90 tok; кандидат: компактный spec-формат/проекция описаний.
2. `S:other` 764 — две JSON-keys инструкции частично дублируют `AI_JSON_OUTPUT_LOCK`; «up to 3» захардкожено (max_calls_per_round=3 сейчас совпадает).
3. `budget_final`/`forced_final` system отличается — редкий путь, можно тоже свести к общему system + инструкцию в user tail.
4. `_fit_prompt_pair` — blunt head/tail trim при >32k; нужен block-aware budget manager (приоритеты §5 задания).
5. Tool results → LLM: `_format_tool_results_for_prompt` без projection — отдельная работа по payloads (`directory.people.search` и др.).
6. Memory planner — отдельный LLM-вызов до ответа; кэширование решений для повторных фактов.
7. Live A/B, реальные cached_tokens, p50/p95: **NOT MEASURED** — нет API-ключа в контуре; после деплоя телеметрия `llm_calls` даст факт.

## 9. Артефакты

- `a9-artifacts/a9_prompt_audit.py` — воспроизводимый харнес разбивки (sqlite, scripted LLM).
- `a9-artifacts/prompt_audit_candidate.json` — замер candidate.
- `AI_LLM_CALL_LOG_FILE=<path>.jsonl` — live per-call телеметрия (sizes/ids only).

## 10. Cycle 2 hardening (HEAD `9908a9f0`)

Ревью-дефекты закрыты:

- **P0 budget manager**: user prompt собирается как типизированные `(label, text)` блоки на этапе сборки — доверенность больше не выводится из текстовых заголовков (документ, имитирующий «CURRENT USER REQUEST», остаётся `file_context`). Слепой fallback `_compact_head_tail(joined)` удалён: system никогда не режется, protected-блоки (запрос, tool_results, running_summary, task_state, draft) не трогаются; при непомещении — целый промпт + `over_budget=true` в телеметрии вместо повреждённого.
- **P1 per-tool projection**: реестр политик по tool_id — SEARCH 15 items/800c, DETAIL 25/4000c (mail/doc тела не рубятся на 800), ACTION 50/8000c без drop (draft_id/recipients/диагностика целы для подтверждения), UNKNOWN 50/4000c без агрессивного drop. Маркеры `projection_truncated`/`omitted_items` отделены от серверного `truncated`; running summary показывает `shown_in_prompt=N/M`.
- **Spec signature**: вложенные объекты раскрываются `{file_name*: string, content*: string, format: xlsx|csv}[]` вместо голого `object[]` — модель не угадывает структуру аргументов.
- **Telemetry**: `logical_call_id`/`attempt_id`/`transport_attempts`/`streaming_fallback`/`finish_reason`/`cache_write_tokens`; failed-попытки пишутся в JSONL; aux-вызовы (memory_planner, summary) идут через общий `record_llm_call` с локом; `usage: null` = unknown.
- **Benchmark**: like-for-like матрица main@926dd9f5 × candidate × JEV{0,1} на одном харнесе и сценариях; `prompt_audit_base_jev*.json` сохранены отдельно от candidate.

### Замер (est. tok, sqlite-харнес, scripted LLM)

| Сценарий | base JEV=0 | c3 JEV=0 | base JEV=1 | c3 JEV=1 |
|---|---|---|---|---|
| chat_no_tools | 2228 | **1921 (−14%)** | 2228 | 1921 (−14%) |
| read_itinvent | 2236 | **1929 (−14%)** | 2236 | 1929 (−14%) |
| act_all_tools | 6730 | **6151 (−9%)** | 3276 | 2925 (−11%) |
| 60msg | 7716 | **7180 (−7%)** | 4799 | 4469 (−7%) |
| followup r1/r2 | 6710/7000 | **6131/6525 (−7..9%)** | 3256/3546 | 2905/3299 (−7..11%) |

Экономия A9 изолирована от JEV: −7..14% input на всех сценариях. До цели −40% не дотягивает — остатки в §8/§11.

### Тесты
`test_ai_prompt_compaction.py` — 11 тестов (protected-overflow, спуфинг заголовков, per-tool projection, nested-object signature) + `test_ai_prompt_budget_preserves_high_priority_tail` переведён на typed API. Runtime suite: 97 passed, 9 pre-existing baseline failures (проверено ранее stash-прогоном).

### Качество
`a9_quality_corpus.json` — 100 размеченных сценариев (20 CHAT/30 READ/20 ACT/10 multi/10 longctx/10 err) с ожидаемыми инструментами, фактами, запретами. Scripted-LLM проверяет контракты; качество генерации реальной модели — **NOT MEASURED** (нет провайдера).

## 11. TOP-10 оставшихся источников расхода (est. tok, JEV=0 act)

1. `guide_*` routing ~2139 (семантика: draft/confirm/дизамбигуация — резать рискованно).
2. `tool_specs_*` ~2400 после компакции (per-tool ~80–90 tok нижняя граница однострочника).
3. system `S:other` 764 (JSON-лок + untrusted-правило + bot prompt).
4. `guide_answer_style` 416 + `guide_understanding` 393 — дублируются в каждом раунде (часть кэш-префикса).
5. `conversation_history` — растёт линейно; окно уже ограничено.
6. `tool_results` — projection помогает, но большие детальные объекты (DETAIL 4000c) дороги.
7. `running_summary` + `tool_results` частично дублируют друг друга.
8. `file_context`/`kb_context` при вложениях.
9. `memory_status`/`db_label`/hints — мелочь по одному, суммарно ~150.
10. `task_state`/`active_draft` JSON — редко, но необжаты.

## 12. Отключение
Оптимизации обратимо: пустые блоки — условие рендера; compaction regexes — локальны; projection/fit — чистые функции, фолбэк = прошлое поведение по одному diff. Env-флаги не добавлялись (изменения безопасны по умолчанию).

## 13. Final gate (HEAD `6b782f99`)

### Закрыто
- **Дубль `_fit_prompt_pair`**: удалена устаревшая реализация (передавала строку в `_fit_prompt_blocks` — краш при переполнении). Осталась одна типизированная пара `_fit_prompt_pair_blocks` + string-shim.
- **Бюджет — реальное ограничение**: effective limit = `min(AI_INPUT_BUDGET_TOKENS, context_window − max_tokens − schema/transport reserve)`; консервативная калибровка 3 chars/token (для RU/JSON len/4 занижает). При `over_budget` провайдер НЕ вызывается — возвращается контролируемый ответ об ограничении + запись `skipped_over_budget` в телеметрии. Повторная проверка после invalid-JSON retry; бесконечных retries нет (max 1 retry).
- **ai.results.read_more**: оркестраторный meta-tool — постраничное чтение уже полученных `items` текущего run (result_index/offset/limit, ≤50/стр); scope/изоляция унаследованы, повторных обращений к корпоративному API нет.
- **Полнота схем**: `test_registry_signatures_preserve_required_and_enum` проверяет все 100 specs реестра — каждый required и каждый enum (первые 12 вложенными) присутствует в компактной сигнатуре.
- **Feature flags**: `AI_PROMPT_OPTIMIZATION_ENABLED` (master) + `AI_COMPACT_SPECS_ENABLED`, `AI_TOOL_RESULT_PROJECTION_ENABLED`, `AI_PROMPT_BLOCKS_ENABLED` — все default ON; при OFF: specs/projection/компрессия отключаются, но проверки бюджета и защита инструкций сохраняются (rollback без слепой обрезки).
- **Baseline JSON**: `prompt_audit_base_jev0/jev1.json` + `prompt_audit_c3_jev0/jev1.json` в репозитории (пропущенные ранее base-артефакты восстановлены).
- **Корпус**: `a9_quality_gate.py` — валидатор корпуса против реального реестра (100 tools); выявил и исправлены 15+ несуществующих tool_id/ wildcard. PASS.

### Регрессии
- sqlite: compaction 13/13; runtime+smart_memory — падения идентичны baseline (17 при `AI_RUN_TEST_DATABASE_URL` в env / 9 без — env-sensitivity, проверено прогоном baseline@926dd9f5: те же 17).
- **PostgreSQL 17.6 (portable, a8test@55432)**: `test_pg_a8_gate` + `test_ai_run_serialization_pg` — **24/24 PASS**.
- Флаг OFF: compaction 13/13 (флаги пинятся в тестах); safety-проверки активны.

### Ограничения / NOT MEASURED
- Live tokens/cached/latency — нет провайдера; scripted-LLM проверяет контракты, не качество генерации.
- Качество самостоятельного выбора модели на корпусе — требует live-прогона.

### Rollback-план
`AI_PROMPT_OPTIMIZATION_ENABLED=0` в env → A9-оптимизации off (поведение ≈ pre-A9 с сохранением safety); отдельные диагностические флаги — выше. Телеметрия независима от флагов.
