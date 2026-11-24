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
