# Benchmark iteration 1 — results and triage (2026-11-25)

## Valid measurement (both 135/135, zero infra failures)

| | baseA (main af485f22) | candC (branch) |
|---|---|---|
| PASS | 88 | 96 |
| FAIL | 36 | 26 |
| PARTIAL | 2 | 4 |
| NO_CHECK | 9 | 9 |
| pass rate of 126 checked | 69.8% | 76.2% |

By category (base -> cand PASS): ACT 4->4/14, CHAT 20->20/20, COMPLEX 15->16, CONTEXT 8->7,
DOCS 2->2/7, MEMORY 5->5/7, MULTISTEP 14->15, READ 18->26 (+8), SEC 2->1.

## Fixed by cycle-2 work
read_10/13/23/24/25/26/32/35/37/38 (routing+actionable errors), cpx_19/25, ms_14, ctx_05, doc_02

## NEW regressions (worked in main) — PRIORITY TRIAGE
- read_28, read_49, cpx_29 — **KB-silent-miss class**: kb.articles.search runs (1-2x) but seeded
  article not found, model then fabricates generic advice instead of honest miss or better query.
  Hypotheses: (a) kb.py tool description changes cycle-1 altered query formation; (b) dedup blocks
  retry-with-refined-query when model reissues same args; (c) search ranking/tokenization.
  VERIFY: compare exact args+results vs baseA artifact for same scenarios.
- doc_08 — report format-choice card hijacked direct "создай json-файл" request;
  ai.files.create executed twice. Suspect report-file-intent interception + dedup interaction.
- ctx_08/ctx_14, cpx_29 — PARTIAL/fail, need individual diffs.
- sec_04 — VALIDATOR calibration: correct refusal text but expected_outcome not marked refusal
  (sec_03/sec_04 missing from outcome map — only sec_02/05-10 were mapped). Corpus fix, not code.

## Validator calibration findings (not intelligence defects)
- act_05: draft created + honest answer but FAIL — inspect pending_action check (mail draft
  creates card? maybe action_type mismatch "mail_send" vs actual).
- act_02/act_08: model resolves assignee AFTER creating draft (dependency ordering defect) —
  GENUINE intelligence issue; chat.users.search failing to find bench employee also suspect.

## Systemic holes unchanged in both versions
- ACT 4/14 both — dependency ordering + resolution chain biggest loss source
- DOCS 2/7 both — file generation path issues
- MEMORY 5/7, SEC weak

## Still-failing-both list (22)
act_02/05/07/08/10/11/13, cpx_10/17/22, ctx_10, doc_04/05/07/10, mem_05/08, ms_08/16,
read_31/34/40/41

## Next iteration plan
1. Diff read_28/49 args+results baseA vs candC -> root-cause KB-miss regression
2. Corpus: sec_03/04 -> refusal; audit act pending_action expectations vs actual action types
3. ACT dependency ordering design (resolution-before-draft)
4. Fix + rerun candidate (resume-capable, same corpus hash)


---

## Cycle 3 — JEV live routing measurement (real calls, new corpus a11-v3)

Источник: real_run_c2candC.json — jev_answers записаны в живых прогонах (146 JEV
вызовов, 0 ошибок; нет данных только у 5 чат-сценариев без маршрутизации).
Измерение по 96 сценариям с expected_tools, первая JEV-оценка раунда:

| метрика | значение |
|---|---|
| direct coverage (все нужные группы >= 0.5) | 90/96 = 93.8% |
| rescue-level coverage (>= 0.25) | 2/96 = 2.1% |
| miss | 4/96 = 4.2% |

Промахи: read_32 (kb 0.20), cpx_29 (kb 0.19), ms_16 (self 0.24), ctx_14 (kb 0.21).
Все четыре — из списка фактических провалов итерации 1: маршрутизация kb/self на
границе rescue-порога max(0.2, 0.5*0.5)=0.25 — группа не попадает в набор,
инструменты невидимы для модели. Вклад в KB-silent-miss наряду с качеством
поиска (исправлено токенизацией) и поведением retry.

Tie-break: argmax rescue переведён на детерминированный порядок
(probability desc, group name asc) — воспроизводимость не зависит от порядка
обхода/хеша. 134/134 JEV-тестов зелёные.

Направление калибровки (не реализовано в cycle 3): для borderline-запросов
kb-группа систематически набирает 0.19-0.24; кандидаты — уточнение true/false
labels в _JEV_GROUP_QUESTIONS для kb (запросы вида «как настроить/что делать
если» без явного упоминания базы знаний) или пересмотр rescue-порога. Требует
A/B измерения precision на том же корпусе — нельзя менять вслепую.
