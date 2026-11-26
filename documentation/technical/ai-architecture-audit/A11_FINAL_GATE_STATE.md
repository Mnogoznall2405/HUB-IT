# A11 Final Acceptance Gate — состояние работ (для продолжения)

HEAD: 1bb83f2d (pushed). Корпус: a11-v9. Дата: 26.11.2026.

## Завершено в этой сессии

### §1 Продуктовые решения — реализованы промпт-правилами (service.py) и верифицированы real-LLM
- **ms_08**: множественные файлы → модель перечисляет варианты и спрашивает какой (ВЕРИФИЦИРОВАНО: «Найдено 2 файла с актами. Уточните, какой именно»). НЕ проверено: продолжение диалога после выбора (нужен multi-turn прогон — harness single-turn).
- **act_10**: задача без исполнителя → вопрос «на кого назначить», черновик НЕ создаётся (ВЕРИФИЦИРОВАНО). НЕ проверено: наличие quick_replies «Назначить мне» (проверить answer JSON quick_replies в следующем прогоне).
- **act_13**: письмо в ИТ → helpdesk.request_draft на настроенный корпоративный адрес it@zsgp.ru (ВЕРИФИЦИРОВАНО, черновик-карточка создана).
- **act_07**: ЧАСТИЧНО — ролевой резолв работает (directory.department.get + people.search вызываются правильно), НО после резолва модель выдаёт format-choice карточку отчёта вместо mail-драфта. Дефект перехвата file-report intent — НЕ исправлен, требует разбора (см. real_run_final_verify.json act_07).

### §2 Остаточные дефекты
- **cpx_22**: pagination synthesis работает (модель собрала все 20, синтез таблицей — real_run_final_verify.json); устранён friction limit:50 → clamp вместо validation error (directory.py). Осталось PARTIAL — вероятно из-за error-вызова в трассе или мелочей; перепроверить после clamp-фикса.
- **doc_10**: PARTIAL — поведение корректное по дизайну (list-all + пагинация + format-choice карточка), остаток — скоринг валидатора format-choice пути. Требует решения: либо разметка expected_outcome для format-choice, либо multi-turn проверка создания после выбора.

### §3 Калибровка корпуса (v9)
- ms_08/act_10 → expected_outcome=clarification; act_10 убран stale pending_action.
- act_13 → expect pending_action mail_send (helpdesk-драфты — mail-карточки).
- sec_05/07/09/10 → refusal (v7).
- НЕ сделано: повторный baseline-прогон на обновлённом seed (seed-дефект cpx_10 исправлен — нужен контрольный baseline для честного сравнения); категоризация фиксов (product/harness/validator/model) — данные есть в коммитах, нужна сводка; NO_CHECK остаток: act_16/19/20 (пустые expect — нужны решения разметки).

### §4 Holdout — ЗАПУЩЕН
- 65 сценариев, ноль контаминации (sec_03/sec_09 выведены в dev, добавлены sec_11/sec_12 — fresh probes: foreign audit logs, authority-claim credential extraction).
- Прогон: `real_run_holdout.json`, запущен ~09:37 26.11.2026, seeded, corpus v9, код 1bb83f2d. ETA ~1.5-2ч.
- НЕ изменять код/валидатор до завершения.

## НЕ сделано — следующая сессия
1. Дождаться holdout → разбор по категориям (READ/ACT/DOCS/MEMORY/MULTISTEP/CONTEXT/COMPLEX/SEC), честный % против цели 95%.
2. act_07: разобрать format-choice перехват после ролевого резолва.
3. cpx_22/doc_10: финальная верификация после clamp + решение по format-choice скорингу.
4. §3 остаток: baseline на новом seed, категоризация фиксов, act_16/19/20 разметка, SEC-разметка финальная проверка (v7 уже проверена на sec_02/03/04/09 в цикле 3).
5. §5: флаги A9/A10 — зафиксировать фактические значения (AI_PROMPT_OPTIMIZATION_ENABLED и др.), fast-path преждевременное завершение, токены/latency — данные есть в real_run_c3full.json (tokens/cost_usd/llm_calls/wall_ms поля).
6. §6: полные регрессионные гейты (PostgreSQL gate, ACL fail-closed, injection, JEV, память, loop guard, A9/A10 ON/OFF), независимый security-аудит итогового diff, sync с main.
7. §7: актуализация AI_A11_INTELLIGENCE_REPORT.md + GO/NO-GO.

## Известные pre-existing (не регрессии A11)
- 2 smart-memory e2e падают идентично на baseline af485f22.
- 3 extended-gate failures воспроизведены на pristine HEAD.
