# A11 — категоризация исправлений (директива final acceptance §3)

Честное разделение: НЕ всё является «ростом интеллекта модели». Категории по коммитам цикла.

## 1. Продуктовый код (реальные дефекты поведения системы)
- `7372ce2f` KB-поиск: verbatim-substring матчинг многословных запросов → токенизированный AND + ranked fallback. Класс read_28/49, cpx_29 — статьи существовали, но не находились никогда.
- `96f9d323` sqlite `lower()` ASCII-only — кириллические ФИО не резолвились в draft-инструментах никогда (act_02/05/08). Плюс обязательный проект задачи.
- `990885ee` fail-closed database_id — нет silent substitution.
- `f1f90568` confirm-time database revalidation (TOCTOU).
- `da96fd59`/`e47c1551` duplicate guard — mutation-aware invalidation, корректный скоуп.
- `a0f19e3f`/`85145100` loop guard — expansion storm budget.
- `aebbf967` handoff denial preservation, WOL/acts guards.
- `bd8c0239` report-interception: «отчёт» как топик-существительное требует governing verb — письмо об отчёте не перехватывается генерацией отчётов (act_07; регрессия самого цикла от soft-verb расширения).
- directory.py: пагинация offset была недостижима (schema forbid) — cpx_22; limit clamp вместо validation error; резолв руководителя отдела через позиции справочника (продуктовая модель: org-узлы не хранят head).
- `7ab22978` memory recall guard уничтожал корректные recall-ответы (mem_08); dedup F-D1 canonical signatures.

## 2. Маршрутизация и промпты (поведение модели через инструкции)
- `825c5f94`/`90ed16f1` JEV group questions, keyword matrix, tool descriptions, top1 rescue.
- `d500fcac` детерминированный JEV tie-break.
- `99fe0132` kb group question — операционные how-to вопросы без слова «статья».
- self-group: файловый поиск без притяжательного местоимения; выбор файла по ordinal после вариантов.
- `e409d5a6` продуктовые решения: compose=draft always; письмо в ИТ = helpdesk на корпоративный адрес; ролевые получатели резолвятся; задача без исполнителя — вопрос + «Назначить мне»; множественные файлы — варианты, не arbitrary; пагинация до полного набора с синтезом.
- `ad96652f` actionable validation errors.

## 3. Seed / контур (испытательные данные, не продукт)
- `3dfce97c` контакты plain strings вместо production-shape dicts — телефоны не индексировались (cpx_10/ctx_10 падали и на baseline).
- bench-сотрудники не были portal users — act-сценарии неисполняемы по построению.
- руководители отделов отсутствовали (позиции + org-данные) — act_07 неразрешим по построению.

## 4. Испытательная инфраструктура (harness)
- `e995a1ff` benchmark foundation; `00a63ac6` outcome taxonomy/resume/fail-fast.
- `9ada4283` default corpus указывал на A9-эру — прогоны мерили не тот корпус.
- `ad3be36f` harness parser; нормализация pending_action (dot vs underscore) — act_05-класс.
- any-of в expected_tools (pipe) — either-path сценарии не hard-fail'ятся (doc_11, act_13).
- multi-turn continuations ms_26/act_21/doc_11.

## 5. Валидатор / разметка корпуса (измерение, не поведение)
- `00439c73` sec_04: корректный отказ считался нарушением.
- sec v7: sec_05/07/09/10 refusal-разметка (not_found требовал формулировок, которые правильное поведение не производит).
- mem_05 any-of факты (перефразирование факта — не ошибка).
- doc v5: format-choice — спроектированное поведение для no-format запросов.
- act_10/ms_08: разметка под новые продуктовые решения (clarification).
- act_11: helpdesk-заявки — mail-карточки по дизайну.
- act_16/19/20: NO_CHECK закрыты (clarification / forbidden completion claims).
- read_50: clarification-разметка.
- corpus v8: деконтаминация holdout (sec_03/09 → dev; свежие sec_11/12).

## 6. Модельные улучшения (собственно интеллект)
Отдельного класса нет: провайдер/модель не менялись. Улучшение качества — следствие категорий 1-2 (система даёт модели корректные инструменты, данные и инструкции), а не обучения/смены модели.

## Контрольное измерение атрибуции
baseline-код + исправленный seed: act_07 PASS — т.е. исходный act_07-фейл в baseline был чистым seed-дефектом; в ветке он был усугублён регрессией перехвата (категория 1). cpx_10/ctx_10 — аналогично seed-дефекты (категория 3), подтверждено прогоном real_run_baseseed*.
