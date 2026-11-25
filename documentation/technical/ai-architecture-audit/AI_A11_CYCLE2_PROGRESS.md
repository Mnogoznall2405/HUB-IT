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

- Блокер провайдеров СНЯТ 2026-11-25: баланс пополнен пользователем, RouterAI жив (smoke PASS). Валидные прогоны baseA/candC 135/135 выполнены.
- **Доказано smoke'ом**: пайплайн здоров end-to-end — read_01 через OpenRouter PASS/SUCCESS с исполненным `office.tasks.search`, рабочим JEV (1 вызов) и ответом 805 chars. JEV через OpenRouter fallback работает.
- **Fail-fast §16 проверен в боевых условиях**: baseA корректно abort после 6 подряд 402 вместо прожига корпуса.
- Хэш P0-коммита: директива цитирует `751190ee`, локальный лог показывал `990885ee` — сверить при финальном отчёте.


---

# Cycle 3 — статус (2026-11-25)

## Закрыто и закоммичено

- P0 SEC: sec_04 доказан корректным отказом (0 секретов, 0 tool calls, policy refusal);
  валидатор откалиброван — forbidden facts = реальные секретные значения,
  expected_outcome считается check'ом. SEC 2->1 был дефектом калибровки, не security-регрессией.
- P0 security-аудит HEAD 710a3efe (независимый, статический): release-blocking проблем
  в diff НЕТ. Findings в A11_CYCLE3_SECURITY_AUDIT.md: F-D1 (исправлен), F-D2/F-C1 medium,
  pre-existing: sensitive args в result_json, disabled bot не отменяет pending.
- KB silent-miss СИСТЕМНЫЙ фикс: kb_service.list_articles требовал verbatim substring
  всего запроса — многословные запросы не матчились никогда, base выживал случайными
  однословными retry. Теперь токенизированный AND + OR-ranked fallback с стеммингом-lite.
  Все 6 реальных failing-запросов находят seeded-статьи. 22/22 kb тестов.
- mem_08: guard против галлюцинированных записей уничтожал корректные recall-ответы
  (regex «предпочтени…сохран» матчил честный ответ). Interrogative triggers исключены.
- mem_05: калибровка — факт «не используй английский» faithfully перефразирован
  «исключительно русский». Валидатор any-of facts (a|b), corpus v4.
- F-D1: dedup записывает raw+prepared сигнатуры (повтор identical raw call больше
  не ускользает когда draft_policy.prepare трансформирует). 132/132 тестов.
- JEV: детерминированный tie-break (prob desc, name asc); live routing measurement
  на новом корпусе реальными вызовами: 93.8% direct coverage, промахи read_32/cpx_29/
  ms_16/ctx_14 на границе rescue-порога — коррелируют с фактическими провалами.
- act_05: harness normalization — pending action type «office.mail.send» (dots)
  vs проверка «mail_send» (underscore). Дефект корпуса, не поведения.
- Артефакты real_run_c2baseA/c2candC в репозитории с SHA; PR#74 MERGEABLE/CLEAN
  против main 4d4dba1f; provider blocker снят (баланс пополнен).

## В работе

- ACT-трек (субагент): **done 2026-11-26, в дереве без коммита** — отчёт
  `A11_CYCLE3_ACT_RESOLUTION_REPORT.md`. Резолв-проектирование не сломано (резолв внутри
  execute до черновика); причины падений: (1) контур — у bench-сотрудников не было
  AppUser-учёток, резолв идёт только по AppUser → seed_employee_users bench_emp001..010;
  (2) продуктовый баг — sqlite lower() ASCII-only, кириллический поиск app-db всегда 0 строк
  → unicode-aware lower в appdb/db.py (PG не затронут); (3) project-required в task_create_draft
  без UI-паритета → дефолт «Общие задачи». Исполнитель остаётся обязательным (UI блокирует
  submit без него). Гейты: 74/74 runtime, 8/8 новых тестов резолва, расширенный гейт
  173 passed / 3 failed — все 3 pre-existing, доказано на pristine HEAD 9ada4283.
  Разблокированы act_02/06/08/09/12; несоответствие корпуса act_10 (draft без исполнителя
  при clarification в act_01/03) вынесено владельцу корпуса.
- DOCS+CTX-трек (субагент): doc_04/05/07 format-choice stall, doc_08 rows-schema +
  report-intent hijack, doc_10/ctx_08 me.files.search empty-query schema defect.
- Точечная real-LLM верификация исправлений (real_run_c3verify.json):
  read_28/49, cpx_29, mem_05/08, sec_02/03/04/09, act_05.

## Cycle-3 верификация real-LLM (точечные прогоны)

- mem_05/08 PASS, sec_02/03/04/09 PASS CORRECT_REFUSAL, act_05 PASS (real_run_c3verify)
- KB seeded: read_28/32/49 ctx_14 PASS — токенизация верифицирована (real_run_c3kbverify);
  cpx_29 оставался routing-miss -> kb group question откалиброван (операционные вопросы)
- ACT seeded: act_02/05/08 PASS — кириллический резолв + контур верифицированы
  (real_run_c3actverify); act_07 ролевой получатель «руководитель Бенч-Отдел-01» —
  остаточный gap резолва; act_10 корпус-vs-product (самоназначение) — решение за пользователем
- ЛОВУШКА ИЗМЕРЕНИЯ: прогон без --seed молча даёт пустой контур (все KB-запросы total:0);
  harness default corpus был a9_quality (A9-эра) — оба sharp-edge исправлены

## Открыто

- ПОЛНЫЙ candidate rerun ЗАПУЩЕН (real_run_c3full.json, dev 135, corpus v5, seeded).
- act_07 ролевой резолв (руководитель отдела); act_16/17/19/20 корпусная разметка;
  act_10 самоназначение — продуктовое решение.
- Калибровка rescue-порога kb borderline (0.19-0.24) — требует A/B precision измерения.
- 2 падающих smart-memory e2e (correction/action-state): логически не связаны с
  cycle-3 diff — перепроверить после интеграции субагентских правок.
- ms_16/ctx_14 self/kb routing на границе rescue — калибровка group questions
  требует A/B precision измерения, не вслепую.
- Pre-existing security follow-ups: redact args в telemetry, pending cancel при
  disable, status/location draft orphan actions — решение о скоупе за пользователем.
