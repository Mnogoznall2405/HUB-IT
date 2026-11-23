# A5 — JEV Smart Routing (CHAT/READ/ACT) + per-run tool ceiling

База: `f84e1565` (main после слияния A3 PR #20). Ветка: `perf/ai-jev-smart-routing-a5`.

## 1. Архитектура до изменений

- `_build_conversation_context()` выполнялся **до** JEV-маршрутизации: история, файлы, KB (`ensure_index_fresh`+`retrieve`), память, rolling summary — для каждого рана, включая «привет».
- JEV решал только «какие группы инструментов» (`_route_tool_groups_jev` → set). Режимов не было.
- Защита от исполнения = только то, что модель *видит* (tool_specs) + `enabled_tools` (AG-2). Между «спеки в промпте» и `execute_bounded` отдельного per-run потолка не было — любой tool_id из `enabled_tools` исполнялся бы, даже если модель его не видела.
- `_keyword_routed_groups` и force-add `AI_TOOL_GROUP_OTHER` всегда подмешивались в routed — упоминание «принтера» в разговорном вопросе превращало CHAT в корпоративный поиск.

## 2. Найденные ошибки маршрутизации (доказано кодом)

1. **Keyword override в CHAT** — «расскажи, какие бывают принтеры» → keyword `принтер` → группа `itinvent` в routed → корпоративный поиск на разговорный вопрос.
2. **`other` безусловно добавлялась** даже при уверенном «инструменты не нужны».
3. **«Пустой» routed сохранял `ai.request_tool_group`** — приветствие могло расширить набор инструментов через мета-инструмент.
4. **Нет серверного потолка на исполнение** — модель, галлюцинирующая tool_id вне specs, прошла бы `execute_bounded`, если id входил в `enabled_tools` и права позволяли.
5. **KB-retrieval на каждом ране** — `ensure_index_fresh`+`retrieve` выполнялись и для чистого smalltalk.

## 3. Дизайн CHAT/READ/ACT

JEV остаётся единственным маршрутизатором. В тот же `jev_client.decide()` добавлены 2 вопроса (`m_mode_chat`, `m_mode_act`) — **без дополнительного сетевого вызова**.

Приоритет: `act > chat > read > undecided`.

| Режим | Условие | Потолок исполнения | Спеки в промпте | request_tool_group | KB |
|---|---|---|---|---|---|
| `chat` | chat_p ≥ threshold (act_p < threshold) | `∅` — ни один вызов не исполняется | `∅` | не предлагается / `mode_denied` | пропускается (если нет вложения) |
| `read` | есть routed-группы, act/chat не уверены | `enabled − *.action.*` | routed ∪ keyword | разрешён, спеки фильтруются по потолку | да |
| `act` | act_p ≥ threshold | `None` (legacy) | routed ∪ keyword | разрешён | да |
| `None` | JEV не уверен / fallback / routing off | `None` (legacy) | routed ∪ keyword | разрешён (recovery) | да |

Fail-safe: неопределённый JEV → режим `None` = прежняя семантика (действия всё равно требуют draft+confirm — «молча» не выполняются). Tool-mode (`AI_JEV_ROUTING_MODE=tool`): пустой выбор JEV → `chat`; непустой → `None`.

## 4. Серверные ограничения

- `AiToolExecutionContext.run_allowed_tools` (`frozenset|None`) + `intent_mode` + `mode_denied_calls` — устанавливаются оркестратором, не из модели.
- Проверка в `AiToolRegistry.execute_bounded` — единственная точка исполнения (покрывает прямые вызовы, autopagination, повторные раунды): отказ `tool_mode_denied` **до** занятия слота capacity, счётчик `mode_denied_calls`.
- `_handle_tool_group_expansion`: `mode_denied` при пустом потолке; `missing_specs` фильтруются по потолку (READ не выдаёт action-спеки даже при расширении).
- JEV **не** источник полномочий: потолок только сужает `enabled_tools`, никогда не расширяет. Tool-results/память/документы не участвуют в вопросах режима — повысить режим нельзя.

## 5. Схема исполнения рана (после)

```
claim → tool_context(AG-2 enabled) → fast_path
      → _fetch_routing_inputs (trigger+attachment+last5 msgs, ~1-2 idx запроса)
      → _route_for_run: smalltalk? → JEV decide(groups+mode, 1 вызов) → chat/read/act
      → _build_conversation_context(suppress_kb=chat&!attachment)
      → specs = enabled ∩ routed (∩ keyword, кроме chat)
      → LLM loop → _execute_tool_calls → execute_bounded[mode_denied?] → ответ
      → result_json: routed_groups, intent_mode, mode_denied_calls
```

## 6-9. Замеры (синтетика, fake `jev_client.decide` — НЕ сетевая задержка)

| Метрика | До | После |
|---|---|---|
| CPU `_route_tool_groups_jev` (весь путь, 2000 повт.) | ~42 мкс | **43 мкс** (+2 вопроса в том же вызове) |
| Сетевых вызовов JEV на ран | 1 | 1 (cache hit — 0) |
| Tool-specs в промпте при CHAT | все routed (тип. 5–50+) + request_tool_group | **0** |
| KB retrieve+index при CHAT (без вложений) | выполнялся | **пропускается** |
| Исполнение tool_id вне specs при CHAT | возможно (enabled∩права) | **запрещено** |
| `.action.*` при READ | исполнялись | **запрещены** |

Реальный выигрыш — сетевой/IO: меньше токенов промпта (0 спеков в CHAT → быстрее первый LLM-ответ), отсутствие KB-поиска. Точные ms/токены требуют прод-JEV+LLM — не измерялись (вне изолированной среды). Fake-decide замеры не выдаются за сетевую задержку.

## 10-11. Тесты

- `tests/test_ai_jev_intent_modes.py` — **35/35 PASS**: приоритеты режимов, сброс routed+other при chat, кэш с режимом, fallback, подавление keyword, `execute_bounded`-отказы, фильтрация спеков при расширении, матрица 19 размеченных сценариев (chat/read/act/ambiguous).
- `tests/test_ai_jev_routing.py` — **51/51 PASS** (1 тест обновлён под +2 mode-вопроса).
- Смежная регрессия — **285/285 PASS**: jev_routing, intent_modes, tool_routing, tool_permissions, prompt_injection (A3), run_conversation_serialization (A4), run_stability (A1), mail_draft_lifecycle.

## 12. Сохранение A1/A3/A4

A1: `execute_bounded` capacity/timeout/admission не тронуты — проверка стоит до слота. A3: draft_policy/grounding/intent не менялись; READ-потолок добавляет ограничение, ACT не снимает ни одной проверки A3. A4: сериализация run не затронута (миграций нет). Подтверждено общей регрессией выше.

## 13. Остаточные ограничения

1. `intent_mode` — решение JEV-модели: неверная классификация CHAT может скрыть нужный инструмент (смягчено: ошибка видна в `mode_denied_calls`/`intent_mode` в result_json; при неуверенности режим `None` сохраняет recovery).
2. Suppress KB при chat+вложение не применяется (вложение может требовать KB) — консервативно.
3. Tool-mode (`AI_JEV_ROUTING_MODE=tool`) не задаёт read/act — только chat при пустом выборе.
4. Точность JEV на реальной модели не измерялась — матрица тестирует plumbing с фиксированными вероятностями, не качество модели.
5. `_fetch_routing_inputs` — 2 лёгких запроса (trigger+attachments+5 сообщений) только при `AI_JEV_ROUTING=1`.

## 14. Рекомендации дальше

- Замерить p50/p95 TTFT и токены промпта на проде при включённом флаге (поля `intent_mode`/`mode_denied_calls` в result_json уже готовы).
- При хорошей точности JEV расширить light-context: отложить memory/summary до post-JEV решения.
- Рассмотреть read/act для tool-mode и калибровку `AI_JEV_ROUTING_THRESHOLD` по режимным вопросам.
