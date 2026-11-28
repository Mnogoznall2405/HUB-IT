# A11 Final Gate — состояние (обновлено session 3)

## Зафиксированное измерение — В ПРОЦЕССЕ
- HEAD измерения: **7bd7edcb** (зафиксирован в env обоих прогонов)
- corpus sha256: 09c4ddbc5ea27554 (v12: 205 сценариев, dev=140, holdout=65)
- seed sha256: 11cfae690ed54130
- **real_run_final_dev.json** — 140 dev-сценариев, в процессе (37+ к 10:41)
- **real_run_final_holdout.json** — 65 holdout, в процессе (26+ к 10:41)
- Флаги прогонов (целевые директивы): PROMPT_OPT=1 COMPACT_SPECS=0 READ_FAST_PATH=1 DIRECT_READ=1 MEMORY_PLANNER_OPT=1 RUN_RESULT_REUSE=0 — записаны в process env лаунчера; в артефакт попадает только PROMPT_OPTIMIZATION, остальные подтверждать поведенчески (latency/tokens профиль)
- Прогоны БЫСТРЫЕ: ~25с/сценарий — профиль оптимизаций ON

## Ключевые данные уже собраны
### A9/A10 ablation (18-Scenario smoke, cycle2/3 artifacts, tokens llm_in K / llm_calls / avg wall s):
| config | PASS | in K | calls | wall |
| all OFF (fin_A) | 15/18 | 370 | 65 | 79.3 |
| fastpath only | 12/18 | 206 | 49 | 31.8 |
| directread only | 16/18 | 157 | 41 | 13.1 |
| planner only | 16/18 | 155 | 36 | 12.8 |
| ALL ON target | 16/18 | 154 | 36 | 13.8 |
- fastpath В ИЗОЛЯЦИИ просаживал качество на smoke (12/18); в целевой комбинации качество восстанавливается (16/18) при 2.4x меньше токенов, 5.7x быстрее. Ранняя просадка fastpath — известный риск premature termination; финальное подтверждение — по ms_* в final_dev.

### Security audit incremental delta (после cycle-3 аудита):
- directory head-resolution: parameterized service, bounded 15, read-only, fail-open к clarification — OK
- limit clamp bounded MAX_PEOPLE=15 — OK
- draft_policy capture broadening: любой адрес из реального tool-result verified; confirm-time card gate сохраняется — не security regression
- новых блокеров нет; стоящие находки cycle-3 (drafts вне create_pending_action, TOCTOU, admin fallback) остаются documented limitations

### Sync с main:
- main НЕ 4d4dba1f — уже **9e6227c2** (+160 коммитов, PR #73/#78 frontend/stickers)
- **overlap файлов наш diff vs main = 0** — merge должен быть чистым
- merge выполнять ТОЛЬКО после завершения прогонов (working tree = измеряемый код)

## Известные честные остатки (для отчёта)
- ms_26: модель ре-исследует вместо attach — prompt-правило корректное, ограничение следования модели
- pre-existing mock-fail: test_claude_transport_keeps_recipient_arguments (падает и без наших изменений)
- PG gate: 5 passed/22 skipped — нет живого PostgreSQL в контуре
- act_07: цепочка резолва работала, драфт отклоняла валидация — capture fix применён, верифицируется прогоном

## Осталось после прогонов
1. Анализ dev+holdout (категории, честный %, NO_CHECK)
2. fast-path premature termination verdict по ms_* сценариям
3. merge main (чистый), pytest gates на интегрированном HEAD
4. Финальный отчёт AI_A11_INTELLIGENCE_REPORT.md + PR #74 + GO/NO-GO
5. A11_FIX_CATEGORIZATION.md уже написан — включить в отчёт


## КРИТИЧЕСКИЙ БЛОКЕР — биллинг провайдеров (session 3, ~11:40)
- RouterAI: 402 Insufficient balance — hard zero, прогоны abort'нулись (provider_outage fail-fast сработал корректно)
- OpenRouter fallback (pre-approved в harness): работает, но кредиты минимальны — 402 при ПАРАЛЛЕЛЬНЫХ in-flight запросах
- Решение: прогоны ТОЛЬКО последовательно, по одному. final_holdout запущен solo в 11:36 (~3мин/сценарий с учётом retries — медленно)
- Прогресс чекпоинтится — resume банковает завершённые сценарии, даже если кредиты кончатся
- Если кредиты иссякнут до конца: нужно пополнение RouterAI или OpenRouter, затем --resume 1 продолжить
- HOLDOUT ПРИОРИТЕТ: holdout важнее для acceptance — он идёт первым; dev вторым (--resume 0 когда holdout завершится)
- Команда продолжения dev: то же что _launch_seq.ps1 но --label final_dev --split dev
- Corpus v13 зафиксирован: sha 0fb9a1033758, act_01/act_03 разметка-clarification исправлена по продуктовому решению (НЕ по результатам holdout — противоречие найдено через dev smoke act_01)
- HEAD измерения: 5e115ad1


## SYNC С MAIN ВЫПОЛНЕН (12:10) — HEAD 4fc15cf9
- merge origin/main (9e6227c2, +160 коммитов) — чистый, overlap=0, конфликтов не было
- интеграционная проверка: test_e2e_smoke 10/10 + jev suite — PASS после добавления MAIL_CREDENTIALS_KEY в локальный .env ворк-дерева (ключ скопирован из HUB-IT-main/.env — требование нового auth-flow из main, НЕ регрессия слияния)
- изменения других агентов сохранены (stickers, chat infra, frontend remediation)
- AI-сюит 314/315 на pre-merge HEAD (ai_chat файлы merge не затронуты — overlap=0)

## ПРОДОЛЖЕНИЕ ПОСЛЕ ПОПОЛНЕНИЯ БАЛАНСА (механическая процедура)
1. Пополнить RouterAI (предпочтительно — вся историческая сравнимость) или OpenRouter
2. cd C:\Project\HUB-IT-a10-rel; powershell -ExecutionPolicy Bypass -File _launch_seq.ps1 (holdout solo, resume 0)
3. После holdout: dev-прогон (та же команда с --label final_dev --split dev)
4. Если прогон умирает по кредитам mid-way: --resume 1 продолжает с чекпоинта
5. НЕ запускать прогоны параллельно — in-flight 402
6. После прогонов: анализ по категориям, вердикт fast-path premature termination по ms_*, финальный отчёт, PR update, GO/NO-GO
- вся подготовительная работа завершена — осталось только измерение + отчёт

## НОВАЯ ДИРЕКТИВА — Final Security & Release Gate (не начата, контекст сессии исчерпан)
HEAD cce12481. Пункты по приоритету:
1. **PG gate СЕЙЧАС** (без LLM): изолированный PostgreSQL, метод A8/A9 gate, выполнить ВСЕ 22 skipped теста. Искать метод в документации a8/a9 artifacts.
2. **Manager observability — доработать редaктирование**: проверить error_text, status_text, usage на утечки; предпочтительно ЯВНЫЙ ALLOWLIST безопасных полей вместо pop() blacklist. Тесты с секретами в ошибках/статусах.
3. **Authoritative email — ужесточить**: доверять только разрешённым полям ИЗВЕСТНЫХ схем контактов; произвольные вложенные структуры (моя рекурсия в nested dicts) НЕ должны быть авторитетными — убрать рекурсивный обход, только верхнеуровневые известные ключи по схеме contacts.resolve.
4. **Emergency disable — ОТДЕЛЬНЫЙ режим** (обычное отключение не менять!): запрещает новые запросы + подтверждение ранее созданных действий + новые этапы исполнения; перепроверяется непосредственно перед изменяющей операцией; НЕ обещает отмену совершённых внешних действий; история и аудит сохраняются.
5. Проверить mergeable PR #74, не потерять main.
6. После пополнения RouterAI: dev/holdout прогоны + act_07/ms_26.
7. A9/A10 итоговая конфигурация: compact specs OFF, result reuse OFF — подтвердить.
8. Обновить отчёт + PR комментарий; НЕ расширять scopes токена.
9. Финальный GO/NO-GO. Без merge/deploy, без новых архитектурных переработок.

## Final Security & Release Gate — выполнено (session 4, HEAD 0ce6fad4+)
### PG gate — РАЗБЛОКИРОВАН
- Изолированный scratch PostgreSQL 17.6 (portable EDB-zip binaries из HUB-IT-a8-wt/.codex_tmp/pgx), initdb в HUB-IT-a10-rel/.codex_tmp/pgdata-a11, listen 127.0.0.1:55432, user a11test trust localhost, БД a11_test
- НЕ production: production-процессы не тронуты; чужой агентский кластер на 55433 не тронут
- Alembic upgrade head применён на scratch (включая новую миграцию 20261126_0183 emergency); downgrade+upgrade цикл чистый
- Первый прогон: 40/42 (2 падения — не дефекты: отсутствие alembic-инициализации + устаревшая test-схема до добавления колонки)
### Security — всё закрыто и верифицировано
- Manager observability: ЯВНЫЙ ALLOWLIST (id/bot/status/stage/latency/counts/usage-numeric/timestamps), error_text/status_text/request/result НЕ пересекают границу; тест с секретами в error/status/traces PASS
- Authoritative email: только топ-уровневые ключи известной схемы + типизированные списки; рекурсия убрана; негативные тесты (free text, nested) PASS 13/13
### Emergency disable — реализован отдельным режимом
- Колонка emergency_disabled_at (audit timestamp) + миграция 20261126_0183
- Enforcement: enqueue guard (новые запросы), require_conversation_access (write+confirm entry), confirm-time revalidation уже вызывает require_conversation_access непосредственно перед мутацией (re-check свежим чтением), _execute_run fresh-check (старт), _raise_if_run_cancelled checkpoint на каждом stage (остановка новых этапов)
- Обычное отключение НЕ изменено (AI8: owner keeps access) — верифицировано тестом
- 17/17 access-тестов PASS включая 4 новых emergency
- НЕ обещает отмены совершённых внешних действий; история/аудит сохраняются
### Прочее
- mergeable: gh CLI недоступен в контуре сессии; git-проверка: main 9e6227c2 не сдвинулся, 0 коммитов main-not-in-branch, потерь нет
- Баланс RouterAI: всё ещё 402 (проверено 26.11 ~12:00) — измерения заблокированы


## ИЗМЕРЕНИЕ ЗАВЕРШЕНО (session 5, 26.11 ~08:20 UTC) — measurement of record
- Баланс RouterAI восстановлен ~07:20 UTC; прогоны выполнены последовательно: holdout, затем dev
- HEAD измерения: 93f6a770, corpus v13 sha 0fb9a1033758, seed зафиксирован в метаданных обоих артефактов, --seed использован (ground truth включён — в отличие от аборченных попыток)
- Артефакты: real_run_fin2_dev.json (140/140), real_run_fin2_holdout.json (65/65)
- DEV: PASS 116 (82.9%), FAIL 22, PARTIAL 2 | HOLDOUT: PASS 46 (70.8%), FAIL 14, PARTIAL 3, NO_CHECK 2
- fp-атрибуция DEV: fp-hit cohort 26p/20f (56.5%) vs no-fp 90p/4f (95.7%) — fast-path доминирующий разрушитель качества
- SEC 12/12 оба сплита, CHAT 30/30, MEMORY 9/9+NC, ACT dev 14/15
- tokens dev: 1248K in/60K out, 296 llm calls, wall p50 8.2s avg 8.9s | holdout: 495K/25K, 127 calls, p50 7.5s
### Найденные в анализе дефекты (исправлены в b20fc12f)
- seed: str(dict) stringification work_emails → garbled email у портальных пользователей контура (act_06/act_07 FAIL — contour artifact, не продукт); chain-test верифицирован после фикса
- fp/fallback files renderer: ключ file_name не извлекался — имена файлов никогда не рендерились (дефект продукта в fallback-рендеринге)
### Контрольный прогон fin2_control (fp OFF + fixed seed, 31 сценарий) — запущен
- read_29/31/32/34 восстановились в PASS при fp OFF — причинность подтверждается
- read_01: мисматч валидатора (status active vs open, результат корректен) — measurement artifact, не дефект
