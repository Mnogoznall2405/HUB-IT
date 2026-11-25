# A11 Cycle 2 — Progress Tracker

Ветка: `feat/a11-ai-intelligence` (PR #74) · Рабочее дерево: `C:\Project\HUB-IT-a10-rel` · Baseline-дерево: `C:\Project\HUB-IT-a11-base` @ af485f22

## Статус разделов директивы

| § | Трек | Статус | Доказательства |
|---|------|--------|----------------|
| 2 | Setup, прогресс-файл | done | этот файл; HEAD история `git log` |
| 3 | P0 database fail-closed: матрица + confirm-time | **done** | 19/19 `test_ai_database_failclosed.py`; confirm-time revalidation: каталог+non-admin strict+admin multi-db restore; 25/25 failclosed, works canonical row.database_id |
| 4 | P1 dedup: mutation-aware invalidation | **done** | 9/9 test_ai_loop_guard.py — контрастные пары block/allow |
| 5 | Loop Guard полный | **done** | `AI_LOOP_GUARD_ENABLED`, no-progress stop после 2 раундов, телеметрия в result_json `loop_guard`; 123/123 runtime+rounds; no-progress stop verифицирован pipeline-тестами |
| 6 | JEV top-1 rescue флаг + precision/recall/confusion | **done** | AI_JEV_TOP1_RESCUE (default 1, runtime) в service.py + 4 теста; 134/134 jev + 45/45 routing/e2e зелёные; 9-artifacts/jev_eval.py + jev_eval_report.json: replay 740 реальных векторов (P 0.73/R 0.77 ON vs P 0.73/R 0.72 OFF, 5 уникальных спасений vs 2 routable-коллизии), sweep-полоса [0.25,0.5), матрица 19/19 ON |
| 7 | Семантика инструментов аудит | **partial** | цикл 1: описания itinvent/office/kb/directory/network; продолжение pending |
| 9 | Аргументы/валидация/coreference | **done-основное** | actionable errors field_path/args_hint/example, extra-forbidden fix (первопричина read_09-11); 10/10 тестов; coreference gap задокументирован |
| 10 | MULTISTEP 25 real-LLM сценариев | pending | корпус ms_01..ms_25 существует, прогон pending |
| 11 | Восстановление после ошибок | pending | — |
| 12 | Полигон BLOCKED-маркировка | **partial** | `expect.external_source` + conn-hints → BLOCKED в валидаторе v2 |
| 13 | Валидатор качества | **done-code** | outcome taxonomy SUCCESS/CLARIFICATION/REFUSAL/NOT_FOUND/PARTIAL/FAILED/BLOCKED; expected-tool errors → cap PARTIAL; PASS-при-ошибке закрыт |
| 14 | Benchmark A–E | **in-progress** | devbase-136 признан инфраструктурно недействительным (93 empty answers с idx42); baseA (config A, dev split, af485f22) запущен |
| 15 | Holdout | **done-разметка** | read_09/10/11/24 → dev; fresh read_15/17/19/29 → holdout; corpus v2 |
| 16 | Checkpoint/resume | **done-code** | `--resume` hash-verified (code/corpus/seed sha), `--failfast N` provider outage stop, per-scenario incremental `_dump()` |
| 17 | Latency/токены сравнение | pending | — |
| 18 | chat_runtime tech debt | **done** | 11 каталог-падений исправлены субагентом, 74/74 зелёные |
| 19 | Полные регрессии + PostgreSQL | pending | — |
| 20 | Security-ревью итогового diff | pending | — |
| 22 | Итоговый отчёт + PR update | pending | — |
| 23 | Критерии завершения | pending | — |

## Ключевые решения и факты цикла

1. **real_run_a11devbase.json недействителен как baseline интеллекта**: провайдерский outage с 42-го сценария → 93 empty answers без инструментов, `error_text: «ИИ временно недоступен…»`. Артефакт сохранён как документированный инфраструктурный сбой, не как мерило.
2. **Двухдеревная схема бенчмарка**: config A/B крутятся в `HUB-IT-a11-base` @ af485f22 (prod-код main + скопированный harness), config C/D/E — в a10-rel на ветке. Исключает смешивание версий кода (§16).
3. **corpus v2 (a11-v2)**: 200 сценариев, dev 135 / holdout 65; expected_outcome разметка act_01/03 → clarification, sec_* → refusal/not_found/clarification.
4. **act_01/03 resolution**: без исполнителя корректный исход — clarification, не draft (решение директивы).
5. **Dedup redesign**: все эффекты дедупятся (защита от double-send/double-create), read-сигнатуры инвалидируются после успешной мутации → read-after-write работает.
6. **Loop guard**: прогресс = ok-результат или новая форма ошибки; 2 раунда без прогресса → честная остановка с директивой модели сообщить предел возможного.

## Открытые вопросы/блокеры

- **БЛОКЕР: оба провайдерских счёта пусты.** RouterAI: 402 «-0,00 руб» (корень сгоревшего devbase — не интеллект модели). OpenRouter: «exceed your available credits». Все real-LLM измерения (§10/14/15) остановлены до пополнения.
- **Доказано smoke'ом**: пайплайн здоров end-to-end — read_01 через OpenRouter PASS/SUCCESS с исполненным `office.tasks.search`, рабочим JEV (1 вызов) и ответом 805 chars. JEV через OpenRouter fallback работает.
- **Fail-fast §16 проверен в боевых условиях**: baseA корректно abort после 6 подряд 402 вместо прожига корпуса.
- Хэш P0-коммита: директива цитирует `751190ee`, локальный лог показывал `990885ee` — сверить при финальном отчёте.
