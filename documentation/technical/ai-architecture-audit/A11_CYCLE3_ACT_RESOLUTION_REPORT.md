# A11 Cycle 3 — P1: ACT-цепь резолва пользователей (отчёт)

Дата: 2026-11-26. Ветка `feat/a11-ai-intelligence`, дерево `HUB-IT-a10-rel`. Без коммитов.

## Результат одной строкой

Резолв-проектирование draft-tools **не сломано** (резолв происходит внутри `execute` до построения
черновика — гипотеза из `A11_BENCH_ITER1_TRIAGE.md` не подтвердилась); категория ACT падала из-за
двух контура/системных причин и одного продуктового пробела, все три устранены:

1. **Контур**: у «Бенч Сотрудник NNN» не было портальных учёток `AppUser` — они существовали только
   в адресной книге JSON, а все резолв-пути draft-tools идут исключительно по `AppUser`
   (`user_service`). Исправлено в `bench_seed.py` — создаются `bench_emp001..bench_emp010`.
2. **Продуктовый баг (sqlite-контур)**: встроенный `lower()` в SQLite — ASCII-only, поэтому
   регистронезависимый поиск по кириллическим ФИО через `func.lower(...).like(...)` на sqlite
   возвращал 0 строк всегда. PostgreSQL (production) обрабатывает Unicode нативно и не затронут.
   Исправлено регистрацией Unicode-aware `lower` на sqlite-подключениях app-db.
3. **Продуктовый пробел**: `task_create_draft` требовал `project_id`/`project_query`, хотя веб-форма
   создания задачи предзаполняет проект «Общие задачи». Добавлен дефолт проекта по UI-паритету.

## Таблица резолв-путей (кто и где резолвит пользователя)

| Сценарий | Точка входа | Резолв | Источник данных | Поведение при промахе |
|---|---|---|---|---|
| Черновик задачи, исполнитель | `office.action.task_create_draft` — `TaskCreateDraftTool.execute`, `WEB-itinvent/backend/ai_chat/tools/office.py:703` | `_resolve_single_user` (`office.py:134`) с кандидатами из `hub_service.list_assignees()` (`office.py:531`) | **только `AppUser`**: `hub_service._iter_assignee_source_rows` (`hub_service.py:4367-4381`) итерирует `user_service.list_users()` (`:4371`), фильтрует `is_active` и сервисные учётки | `ValueError("assignee_user_id or exact assignee_query is required")` (`office.py:735`) либо ошибка неоднозначности → агент уточняет |
| Черновик задачи, проект | там же | `_resolve_single_project` по `project_query`; **новое**: `_default_task_project` (`office.py:175`) при отсутствии запроса | `hub_service.list_task_projects` | раньше — `ValueError` «project_id … required» (`office.py:739`); теперь дефолт «Общие задачи» (`office.py:730-736`) |
| Черновик сообщения, получатель | `chat.action.message_send_draft` — `ChatMessageSendDraftTool`, `tools/chat.py:155` | делегирует в `build_chat_message_draft` (`action_cards.py:1632`); резолв `action_cards.py:1649-1666` через `user_service.search_users(query=…, status="active")` (`:1651`) | **только `AppUser`**: `user_service.search_users` (`user_service.py:847`) | `ValueError(f"User not found: …")` (`action_cards.py:1661`) или ошибка неоднозначности → агент уточняет |
| Поиск собеседника | `chat.users.search` — `ChatUsersSearchTool`, `tools/chat.py:76` | `user_service.search_users` (`chat.py:87`) | **только `AppUser`** | пустой список (без ошибки) |
| Почта, получатель | `office.mail.contacts.resolve` — `ContactsResolveTool`, `office.py:444` | `mail_service.search_contacts` (`mail_service.py:5543`) с локальным fallback `_search_local_user_contacts` (`mail_service.py:5501`) | адресная книга JSON **и** пользователи — поэтому этот путь находил `benchNNN@bench.local` даже без учёток | пустой список |

**Вывод по таблице**: «почтовый» путь работал, потому что читает адресную книгу; пути задач и чата
читают только `AppUser` — именно поэтому act_02/08/09/12 были неисполняемы в контуре до сидирования
учёток. Порядок «резолв до черновика» внутри `execute` — корректное проектное решение: карточка
черновика всегда содержит конкретные id и имена для подтверждения пользователем.

## Изменения

### Контур: `documentation/technical/ai-architecture-audit/a9-artifacts/bench_seed.py`

- `seed_employee_users` (`bench_seed.py:180`) создаёт портальные учётки `bench_emp001..bench_emp010`
  с `full_name` ровно «Бенч Сотрудник 001..010» (как в адресной книге), привязкой к отделам,
  правами на задачи/чат. Идемпотентно: upsert по `username`, при повторном прогоне чинит
  `full_name`/`is_active`. Учётки сознательно **не** входят в round-robin задач и bot-access
  bench_actor — распределение «моих задач» не сдвинуто.
- `seed_all` вызывает `seed_employee_users` и инвалидирует директорийные кэши
  (`_invalidate_user_directory_caches`), truth JSON получил ключ `employee_users`.

### Продукт: `WEB-itinvent/backend/appdb/db.py`

- В `_build_engine` (`db.py:132`) для sqlite-движков зарегистрирован Unicode-aware `lower`
  на каждом подключении пула (`db.py:143` обработчик `connect`) — зеркало существующего
  прецедента `hub_service.py:981` для raw sqlite. PostgreSQL не затронут: регистрация только
  для `sqlite` URL. Это чинит весь кириллический регистронезависимый поиск по app-db на
  sqlite-рантайме (поиск пользователей, справочники), не только бенчмарк.

### Продукт: `WEB-itinvent/backend/ai_chat/tools/office.py`

- `_default_task_project` (`office.py:175`): проект «Общие задачи» (`general-tasks`/код `GENERAL`),
  иначе первый активный — паритет с `useTaskCreateForm.js` (`defaultCreateProject`). Выбранный
  проект виден на карточке подтверждения, пользователь может поправить до создания.
- В `TaskCreateDraftTool.execute` (`office.py:730-736`) дефолт применяется только когда ни
  `project_id`, ни `project_query` не заданы; явный `project_query` по-прежнему выигрывает.
- **Исполнитель остаётся обязательным** — это тоже UI-паритет: веб-форма блокирует submit при
  пустом `assignee_user_ids` (`useTaskCreateForm.js`, `handleCreateTask`: `assigneeIds.length === 0 → return`).
  Сценарии без исполнителя корректно завершаются уточнением «кому назначить?».

### Тесты: `tests/test_ai_task_draft_resolution.py` (новый, 8 тестов)

По образцу `test_ai_tasks_acl.py` (monkeypatch user_service + raw sqlite HubService, без LLM):
резолв исполнителя по точному кириллическому ФИО, дефолт проекта general-tasks, приоритет явного
`project_query`, дефолт на первый активный проект, отказ при неоднозначности, дефолт контролёра,
регистронезависимый кириллический `search_users` на sqlite (×2) — регрессионная крышка обоих фиксов.

## Верификация end-to-end на живом стенде (sqlite, seeded-контур)

1. `chat.users.search('Бенч Сотрудник 002')` → ok, ровно 1 результат `(id=10, bench_emp002)`.
2. `list_assignees` → 17 записей, все 10 bench-сотрудников присутствуют.
3. `task_create_draft(assignee_query='Бенч Сотрудник 002')` → ok: `assignee_user_id=10`,
   `project_id=general-tasks` (автодефолт), `controller_user_id=8`.
4. `message_send_draft(peer_name='Бенч Сотрудник 002')` → ok: `peer_user_id=10`.
5. `_search_local_user_contacts` → 1 контакт `bench002@bench.local`.
6. `search_users('Бенч Сотрудник')` → 10 результатов (поверхность неоднозначности работает);
   точный запрос «…010» → 1 результат.
7. Идемпотентность сида: повторный прогон — стабильные id, без дублей ФИО, чинит повреждённые строки.

## Прогон тестов (фактические результаты)

- `tests/test_ai_chat_runtime.py` — **74/74 PASSED** (обязательный гейт).
- `tests/test_ai_task_draft_resolution.py` — **8/8 PASSED**.
- Комбинированный набор ai-tools — 77/77 PASSED.
- Расширенный гейт (cross-cutting проверка appdb-фикса): `test_ai_new_tools`,
  `test_ai_prompt_injection`, `test_ai_task_draft_resolution`, `test_app_db_identity_services`,
  `test_e2e_ai_draft_reliability`, `test_equipment_photo_checks`, `test_web_settings_and_sessions` —
  **173 passed, 3 failed**. Все 3 падения **pre-existing**: воспроизведены на pristine HEAD
  (worktree @ 9ada4283) без моих изменений:
  - `test_app_db_identity_services.py::test_settings_and_db_selection_work_with_app_db_backend` —
    committed-рассинхрон: `DEFAULT_DASHBOARD_SECTIONS` в `settings_service.py` содержит `'absences'`
    (5 секций), тест ожидает 4. К lower() отношения не имеет (значения — Python-константы/JSON).
  - `test_app_db_identity_services.py::test_settings_mobile_bottom_nav_items_work_with_json_fallback` —
    та же причина.
  - `test_e2e_ai_draft_reliability.py::test_claude_transport_keeps_recipient_arguments_through_http_worker` —
    валидация «Почта получателя не подтверждена» в цепочке contacts.resolve → mail_send_draft
    под mock-транспортом; падает идентично на HEAD. Отдельный дефект mail-валидации, вне скоупа ACT.

## Прогноз по act-сценариям корпуса (bench_intel_corpus.json)

Становятся исполняемыми в контуре (разблокированы резолв-цепочкой, дальше — качество модели):

| Сценарий | Сплит | Что требует | Почему теперь исполняемо |
|---|---|---|---|
| act_02 | dev | черновик задачи на «Бенч Сотрудник 002» | учётка есть, кириллический поиск работает, проект дефолтится |
| act_08 | dev | черновик сообщения «Бенч Сотрудник 002» | peer-резолв по AppUser работает |
| act_09 | holdout | сообщение «Бенч Сотрудник 003» | то же |
| act_12 | holdout | сообщение «Бенч Сотрудник 010» | то же |
| act_06 | holdout | письмо «Бенч Сотрудник 006» | два рабочих пути: contacts fallback (был) + user search (новый); риск — pre-existing дефект mail-валидации подтверждения получателя |
| act_10 | dev | черновик задачи без исполнителя | **недостижим по двойному стандарту корпуса — см. ниже** |

Остаются корректными уточнениями/отказами (ожидаемое поведение продукта, не дефекты):

- act_01, act_03 — нет исполнителя → `CORRECT_CLARIFICATION` (UI тоже требует исполнителя).
- act_16 — неоднозначный получатель → уточнение; NB: в корпусе `expect={}` и нет
  `expected_outcome` — скорер даёт NO_CHECK, сценарий фактически не измеряется (кандидат на
  правку корпуса: добавить `expected_outcome: clarification`).
- act_17 — инструмента удаления задач нет → честный отказ.
- act_18 — AD вне контура → BLOCKED/draft-only по внешнему источнику.
- act_19, act_20 — нет инструмента/недоспецифицировано; `expect={}` → тоже NO_CHECK.

**Несоответствие корпуса — act_10**: «Создай задачу на завтра: инвентаризация кабинета 305» —
исполнитель не назван, но корпус ожидает драфт (`pending_action: task_create`, без
`expected_outcome`), тогда как act_01/act_03 с той же пустотой исполнителя ожидают `clarification`.
UI-паритет (submit блокируется без исполнителя) означает, что правильное поведение — уточнение,
т.е. act_10 в текущем виде непроходим при корректном продукте. Варианты (решение за владельцем
корпуса): (а) поправить корпус — `expected_outcome: clarification`; (б) продуктовое решение —
самоназначение на автора в чат-контексте (тогда править и act_01/03, и инструмент). Явно не
реализовывалось, т.к. это изменение публичного поведения.

## Что осталось / риски

- Pre-existing падения (2 settings + 1 mail-validation e2e) — не скоуп этой задачи, зафиксированы
  с доказательством на HEAD; рекомендуется завести в problem-list.
- Real-LLM прогон бенчмарка не выполнялся (запрещено задачей) — финальные цифры ACT-категории
  снимет владелец контура следующей итерацией.
- Расширение сида меняет поверхность поиска пользователей контура (+10 учёток): сценарии,
  проверяющие точные количества пользователей (если такие есть вне ACT), стоит перепроверить
  на следующем прогоне.
