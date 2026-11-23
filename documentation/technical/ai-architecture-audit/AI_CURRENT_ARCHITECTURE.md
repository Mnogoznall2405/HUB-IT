# Текущая архитектура встроенного ИИ HUB-IT

Дата аудита: 2026-11-23. Метод: чтение кода + прогон тестов + изолированный эксперимент. Все ссылки — `файл:строка`.

## 1. Общая схема

```
Сотрудник (React/WebView2/Expo)
  → POST /chat/conversations/{id}/messages  (или WS-команда / вложение / choice-кнопка)
  → ChatService.send_message (транзакция chat БД)
  → _schedule_ai_run_for_message (asyncio-задача, post-commit)
  → queue_run_for_message → _enqueue_run → INSERT app.ai_bot_runs(status=queued)
  ────────────────────────────  граница процессов  ────────────────────────────
  PM2-процесс itinvent-ai-chat-worker (start_ai_chat_worker.py, concurrency=4 в prod)
  → claim: SELECT ... FOR UPDATE SKIP LOCKED → status=running
  → _execute_run: контекст → промпт → LLM-цикл с tool_calls → финальный ответ
  → ответ публикуется как обычное chat-сообщение от bot_user_id (client_message_id="ai-run:{id}")
  → action-карточки подтверждений при изменяющих действиях
  → status=completed/failed/cancelled + usage_json + result_json (tool_traces)
```

ИИ — **не отдельный сервис**, а участник обычной чат-системы: боты хранятся в `app.ai_bots`, диалоги — стандартные чат-конверсации, ответ — обычное сообщение. Отдельный PM2-воркер исполняет run'ы; FastAPI-процесс только ставит их в очередь.

Ключевые файлы:
- `WEB-itinvent/backend/ai_chat/service.py` (~7300 строк) — оркестратор: очередь, контекст, tool-цикл, финализация, доставка.
- `WEB-itinvent/backend/ai_chat/tools/` — 16 модулей, **100 зарегистрированных инструментов** (проверено `len(ai_tool_registry._tools)` в живом импорте, 23.11.2026).
- `shared/llm/client.py` — единый LLM-шлюз (RouterAI/OpenAI-compatible; локальных `OpenAI()` нет — инвариант AGENTS.md соблюдён).
- `WEB-itinvent/start_ai_chat_worker.py` + `scripts/pm2/ecosystem.backend.config.js:255-276` — воркер.
- `WEB-itinvent/backend/ai_sandbox/` — отдельная подсистема выполнения кода (OpenCode в rootless-Podman), по умолчанию выключена.

## 2. Жизненный цикл запроса (проверено по коду)

| # | Этап | Реализация |
|---|---|---|
| 1 | Сообщение пользователя | `api/v1/chat/messages.py:530-536`; те же триггеры: WS `ws_commands.py:361`, uploads `uploads.py:108`, stickers `stickers.py:218`, choice `ai.py:317` |
| 2 | Постановка в очередь | `_schedule_ai_run_for_message` (`api/v1/chat/_common.py:1077-1096`) → `queue_run_for_message` (`service.py:3806-3822`) → `_enqueue_run` (`service.py:3827-4042`) |
| 3 | Идентификация пользователя | JWT `require_permission(PERM_CHAT_AI_USE)` на входе; `require_bot_access`/`require_conversation_access` (`ai_chat/access.py:34-74`) при enqueue |
| 4 | Дедуп и лимиты очереди | Дедуп по `trigger_message_id` (`service.py:3954-3964`); per-user/global лимиты → `failed` при переполнении, сообщение не теряется (`:3971-4003`) |
| 5 | Claim воркером | `FOR UPDATE SKIP LOCKED` — только PostgreSQL; на sqlite без блокировки (dev/test) (`service.py:4647-4657`) |
| 6 | Сборка контекста | `_build_conversation_context` (`service.py:6722-7032`): ≤20 сообщений, вложения+OCR, KB top-5, память, rolling summary |
| 7 | Проверки прав на инструменты | `filter_tools_for_user` при сборе (`service.py:5151-5154`) + повторная проверка при execute (`tools/registry.py:56-95`) |
| 8 | LLM-вызов | `complete_json` через `shared/llm` со схемой `AI_CHAT_RESPONSE_SCHEMA_WITH_TOOLS` (maxItems=AI_TOOL_CALL_LIMIT, `service.py:505, 6231`) |
| 9 | Tool-цикл | `service.py:6253-6530`: ≤6 раундов × ≤3 вызова; мета-инструмент `ai.request_tool_group` расширяет набор; параллельное исполнение независимых вызовов (`_detect_data_dependencies` + gather, `:5161-5375`) |
| 10 | Финализация | budget-final или forced-final со схемой без инструментов (`:6515, 6580`) → артефакты/карточки выбора (`:6600-6721`) |
| 11 | Доставка ответа | chat-сообщение от bot_user_id, идемпотентно по `client_message_id` (`:4806-4813`); превью-стриминг с троттлингом 0.6с/40 симв. (`:4747-4753`) |
| 12 | Подтверждения | Изменяющие действия — только `app.ai_pending_actions` карточки; confirm: атомарный claim + повтор прав (`action_cards.py:2273-2318`) |
| 13 | Диагностика | `ai_bot_runs`: status/stage/error/request_json/result_json(tool_traces)/usage_json; stage-тайминги `_log_ai_run_timing` (`service.py:2475-2481`) |

**Протокол tool-calling**: не нативные OpenAI `tool_calls`, а JSON-режим — модель возвращает `{answer_markdown, tool_calls[]}` по response_schema; результаты инструментов подаются следующим вызовом как JSON-блок в пересобранном user-промпте (`_format_tool_results_for_prompt`, `service.py:1966`). Связность call↔result держится на `call_id` и дисциплине модели, без протокольных гарантий.

## 3. LLM-слой (`shared/llm`)

- Провайдер: **RouterAI** (`ROUTERAI_BASE_URL=https://routerai.ru/api/v1`, дефолт `google/gemini-3.7-flash`, `.env.example:14-15`). Ключ `ROUTERAI_API_KEY`, fallback `OPENROUTER_API_KEY`/`OPENAI_API_KEY` (`client.py:432-438`).
- `complete_json` (`client.py:696-815`): streaming-режим с инкрементальным извлечением `answer_markdown` (`json_stream.py`); fallback stream→plain; fallback strict-schema→`json_object`; per-purpose модели `ROUTERAI_MODEL_*`.
- Устойчивость: ≤3 транзиентных ретрая (429/5xx/timeout), backoff, общий wall-budget 90с (`client.py:82-87`), DNS-fallback с DoH (`:91-120`), SDK `max_retries=0`.
- JEV (`jev_client.py`): отдельный decision-эндпоинт `/systemone` для маршрутизации tool-групп; `AI_JEV_ROUTING=0` по умолчанию — выключен; fallback — детерминированные группы.
- OCR/vision: `extract_image_text`/`complete_vision` — единственный OCR-путь для сканов/картинок (`service.py:6874, 6905`).

## 4. Инструменты (100 шт., подтверждено)

Модули: itinvent(28) · office(14) · ad(8) · network(8) · self_service/me+helpdesk(7) · it_reports(5) · kb(5) · mfu(4) · warehouse(4) · itinvent_works(4) · files(3) · chat(3) · directory(2) · computers(2) · voice(2) · tool_group_request(1).

Контракт (`tools/base.py:36-56`, `registry.py:44-116`): pydantic `input_model` → JSON-schema в spec; в промпт идёт **компактный текст** `tool_id — description | args`, не сырой schema (`service.py:2026-2053`), сгруппированный по бюджетам символов (потолок ~13k токенов на все спеки, предупреждение при >20 спеках).

Все изменяющие инструменты — `*_draft`: создают только карточку подтверждения; реальная мутация — при confirm пользователем. Исключения: `ai.files.*` (артефакты чата, флаг `allow_generated_artifacts`), `itinvent.action.status/location_change_draft` (создают неподтверждаемые карточки — дефект, см. GAPS P2).

Источники данных: SQL Server ITINVENT (pyodbc), PostgreSQL appdb, AD/LDAP (ldap3), SQLite local_store, 1С (COM-bridge), файловая система, сеть/subprocess, JSON-кэши.

## 5. RAG (база знаний)

- Статьи — JSON `data/kb_articles.json` (общий с Telegram-ботом); индекс — проекция `app.ai_kb_documents`/`app.ai_kb_chunks`, чанк 1200 симв. с перекрытием 180 (`retrieval.py:76-88, 131-303`).
- Ленивая синхронизация **в пути запроса** по TTL 30с: полный листинг статей + инкремент по sha256-хэшу; OCR изображений вложений через vision-LLM при переиндексации (`retrieval.py:211-226`, `service.py:6905`).
- Поиск — два бэкенда за `AiKbRetrievalInterface` (`retrieval_interface.py`):
  - **Postgres FTS**: `to_tsvector('simple', concat_ws(' ',title,content)) @@ websearch_to_tsquery('simple', query)` + `ts_rank_cd` (`:132-143`). 'simple' = без стемминга и стоп-слов; websearch = строгий AND всех слов.
  - **Python-fallback**: `select(all chunks)` в память + подстроковый count-скоринг (`retrieval.py:327-371`).
- Embeddings/векторного поиска **нет нигде** в backend/shared (проверено grep).
- Права: `can_view_kb_item` по metadata чанка (корректно в fallback, после LIMIT — в PG-пути: `retrieval_interface.py:95-98`).
- Citations нет: в промпт идут `[title | category] content` без id/ссылок (`service.py:6913-6916`).

## 6. Память и контекст

- **Краткосрочная**: окно 20 сообщений (`AI_CONTEXT_DB_MESSAGE_WINDOW`), рендер ~4500 ток.
- **Rolling summary**: LLM-сжатие батчей ≥8 старых сообщений, ≤1500 ток., CAS по `summary_until_seq` (`service.py:6942-6985`, `memory.py:42-50, 364-369`).
- **Долговременная память**: факты `app.ai_user_memories` с дословной цитатой-источником, `fact_key`, версиями, `normalized_hash`-дедупом; remember/update/forget через **LLM-планировщик на каждое сообщение** (пропуск при пустой памяти и отсутствии write-intent regex, `memory.py:286-333`); revision-CAS + replay-маркеры + write-barrier против гонок; изоляция по `user_id` (E2E-тесты подтверждают).
- Гейты: `AI_PERSONAL_MEMORY_ENABLED` (env, дефолт **0**) ∧ `bot.use_personal_memory` ∧ `conversation.use_personal_memory` ∧ `user_settings.ai_personal_memory_enabled` ∧ surface≠sandbox (`memory.py:343-345`, `service.py:230, 3520-3546, 3630`). По `AI_ASSISTANT_MEMORY.md` в проде включён с 08.10.2026 (проверено по доку, не по .env).
- **Бюджет контекста**: оценка `chars/4` (`service.py:2715-2740`), потолок `AI_INPUT_BUDGET_TOKENS=32000` → ~128K символов на промпт; `AI_MODEL_CONTEXT_WINDOW=32000` с safety-margin 2000 для реального usage.

## 7. Безопасность

- Три слоя прав: `bot.enabled_tools_json` → `tool_permissions` (exact→longest-prefix→fallback `chat.ai.use`) → повторная проверка в `registry.execute` (`registry.py:56-70`). Admin-only: `itinvent.equipment.search_multi_db`.
- Серверная идентичность: `me.*` без аргументов «кто»; scope БД — `effective_database_id`; почта/задачи — только `context.user_id`.
- Изменения: только draft-карточки; confirm — владелец + атомарный claim + повтор прав; mail — `idempotency_key` + запрет повтора при unknown-исходе.
- `ai_sandbox`: выключен по умолчанию (fail-closed), rootless Podman, internal-only network, digest-pinned image — самая защищённая часть системы.
- **Слабые места** (детали в AI_GAPS_AND_PROBLEMS.md): нет маркировки недоверенного контента в основном промпте (вложения/KB/письма — prompt-injection поверхность); PII уходит в RouterAI без redaction (redaction есть только у mail-фичи); сетевые инструменты принимают произвольный host/port.

## 8. Ограничения и env-флаги (проверено по коду)

| Флаг | Дефолт | Назначение |
|---|---|---|
| `AI_TOOL_CALL_LIMIT` | 3 | maxItems схемы + fallback лимита вызовов/раунд (`service.py:233,505,5178`) |
| `AI_TOOL_CALLS_PER_ROUND_LIMIT` | 3 | **другое имя** для лимита вызовов/раунд (`tools/context.py:427`) — расхождение, см. GAPS |
| `AI_TOOL_ROUND_LIMIT` | 6 | раундов tool-цикла (per-bot до 12) |
| `AI_TOOL_GROUP_EXPANSION_LIMIT` | 2 | запросов новых групп за run |
| `AI_INPUT_BUDGET_TOKENS` | 32000 | потолок промпта (×4 симв.) |
| `AI_MODEL_CONTEXT_WINDOW` | 32000 | окно модели для TokenBudget |
| `AI_PERSONAL_MEMORY_ENABLED` | **0** | глобальный выключатель памяти |
| `AI_JEV_ROUTING` | **0** | семантическая маршрутизация групп — выключена |
| `AI_RUN_WATCHDOG_ENABLED` | **0** | вотчдог зависших run — выключен |
| `AI_CHAT_WORKER_CONCURRENCY` | 2 (prod: **4**) | потоков воркера (ecosystem:266) |
| `AI_OPENROUTER_MAX_RETRIES` / `WALL_BUDGET` | 3 / 90с | устойчивость LLM-шлюза |

**Влияние лимитов на многошаговость**: сценарий «компьютер сотрудника → состояние → заявки → отчёт» = 4 зависимых шага = 4 раунда — влезает в дефолт с запасом ~2 раунда. Цепочки >6-8 зависимых шагов упираются в forced-final. LLM-вызовов на сообщение: 1 (простой ответ) … до 8 логических (tool-сценарий) + memory-planner + summary + JEV — до ~19 с опциями; HTTP-попыток к провайдеру в патологии ~140 (ретраи). Жёсткого таймаута на весь run **нет**.

## 9. Тестовая база

~189 AI-тестов пройдено при аудите (kb_retrieval 22, tool_permissions 10, tool_routing 34, run_retry 11, smart_memory 20, memory_migration 2, tool_validation 8, doc_extractors 6, chat_runtime 74) + десятки sandbox/office/mail-тестов. `eval_questions.json` — 53 вопроса с `expected_groups`/`requires_permission`, ручной раннер `compare_ai_models.py`; в CI не подключён.
