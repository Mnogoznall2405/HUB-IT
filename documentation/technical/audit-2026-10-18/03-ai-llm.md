# Аудит 03: ai_chat, ai_sandbox, shared/llm, shared/*

Режим: read-only. Репозиторий не менялся, серверы, сборки, миграции, запросы к БД и pm2 не запускались.
Корень: `C:\Project\Image_scan`. Пути ниже относительно корня.

Обозначения: severity (critical/high/medium/low), confidence (high/medium/low).
Пометка «проверено» означает, что строка перепроверена в этом проходе.

---

## Bugs

### B-01. Обход проверки database-scope в itinvent_works
- Файл: `WEB-itinvent/backend/ai_chat/tools/itinvent_works.py:27-31` (проверено), вызов на строке 101.
- Описание: `_resolve_tool_database_id` берёт `args.database_id` напрямую и не вызывает `context.resolve_tool_database_id`, в отличие от `tools/itinvent.py:88-90`.
- Сценарий: модель или пользователь передаёт `database_id` другой базы, которой у пользователя нет в `get_available_database_options`. Запись уходит в эту базу через `action_cards._execute_works_action` (`db_name=database_id`, около строки 1358). Единственная проверка там — `PERM_DATABASE_WRITE`.
- Severity: high. Confidence: high.

### B-02. mfu._resolve_db принимает произвольную базу
- Файл: `WEB-itinvent/backend/ai_chat/tools/mfu.py:130-134` (проверено).
- Описание: `return requested or current` после `normalize_database_id`, которая проверяет только существование, а не доступность пользователю.
- Сценарий: `database_id` из аргументов инструмента обходит `resolve_tool_database_id` из `tools/context.py:439`.
- Severity: medium-high. Confidence: high.

### B-03. Драфты ad.unlock и network.wol не имеют исполнителя
- Файлы: `tools/ad.py:343` (`create_pending_action(action_type="ad.unlock")`), `tools/network.py:1090` (`action_type="network.wol"`), `action_cards.py:2207` (проверено: `raise ValueError(f"Unsupported action_type: {row.action_type}")`). В `action_cards.py` строк с `ad.unlock` и `network.wol` нет (проверено через rg).
- Описание: инструмент создаёт pending action, которую нельзя подтвердить. Подтверждение падает в `ValueError`, карточка остаётся висеть.
- Severity: high (пользовательский сценарий ломается). Confidence: high.

### B-04. Дубликаты сообщений при сбое после отправки ответа
- Файл: `WEB-itinvent/backend/ai_chat/service.py`, `_process_single_run` около строк 4535 (`send_message` ответа), 4664 (send_files), 4698 (error message), 4757 (`usage_json`), 4768 (`status="completed"`), 4781-4816 (`except Exception`).
- Описание: сообщение отправляется до финального UPDATE статуса run. Исключение после отправки уводит run в retry или error-ветку, которая не учитывает уже отправленные сообщения.
- Сценарий: `send_files` падает, retry повторяет весь run, и пользователь получает второй ответ.
- Severity: medium. Confidence: high.

### B-05. Повторное выполнение не-завершённых вызовов после ошибки параллели
- Файл: `service.py:5014-5046` (`_execute_tool_calls`, parallel через `asyncio.to_thread`/`asyncio.run`; fallback при ошибке повторно выполняет все не-завершённые calls).
- Описание: fallback не различает идемпотентные и неидемпотентные инструменты. Драфты с побочными эффектами могут выполниться дважды.
- Severity: medium. Confidence: medium.

### B-06. Auto-pagination выбирает не тот вызов
- Файл: `service.py:5963-5983`: `original_call = next((c for c in tool_calls if ... == pagination_info["tool_id"]), None)`.
- Описание: поиск по `tool_id` берёт первый вызов инструмента в раунде, а не тот, который дал pagination_info. При нескольких вызовах одного инструмента продолжение получит чужие аргументы.
- Severity: medium. Confidence: medium.

### B-07. KB FTS: LIMIT до фильтрации видимости
- Файл: `WEB-itinvent/backend/ai_chat/retrieval_interface.py:116-146` (проверено: `.limit(max_items)` на строке 142 до Python-фильтра), фильтр видимости в `_retrieve_postgres_fts` 81-114.
- Описание: SQL отбирает top-N, а видимость и scope проверяются после. Если верхние N чанков невидимы пользователю, он получает пустой или неполный контекст.
- Severity: medium. Confidence: high.

### B-08. KB ensure_index_fresh без обработки ошибок
- Файл: `service.py:6538` (`_build_conversation_context`, вызов без try), `retrieval.py:305-316`.
- Описание: сбой индексации KB валит построение контекста всего запроса, хотя KB опционален.
- Severity: medium. Confidence: high.

### B-09. Инструмент KbAttachmentGetText не передаёт current_user
- Файл: `tools/kb.py:248-300`: `get_attachment` вызывается без `current_user`, хотя перед этим `get_article` проверяет пользователя.
- Описание: проверка доступа к вложению опирается только на предыдущий `get_article`. Нужно проверить, что `kb_service.get_attachment` (`services/kb_service.py:652-`) не имеет собственной проверки.
- Severity: medium. Confidence: medium.

### B-10. Аргументы инструментов пишутся в лог при ошибке валидации
- Файл: `service.py:4924-4930`: `"AI tool validation failed: ... args=%s", dict(call.get("args") or {})`.
- Описание: в аргументах могут быть пользовательский текст, пути к файлам и фрагменты контента. Правило AGENTS о структурных логах без секретов не соблюдено.
- Severity: medium. Confidence: high.

### B-11. Потеря usage при сбое run
- Файл: `service.py:4757` (`usage_json` записывается только в UPDATE успешного пути), 4781-4816 (`except Exception`).
- Описание: токены уже потраченных LLM-шагов не сохраняются, если run завершился ошибкой. Учёт расходов занижен.
- Severity: medium. Confidence: medium.

### B-12. Полный base64 файла в результате инструмента
- Файл: `tools/files.py:591` (`file_spec.metadata.content_b64`), `601` (`export.content_b64`). Результат идёт через `_format_tool_results_for_prompt` (`service.py:1909-1912`, `_json_dumps(normalized)` без лимита).
- Описание: если результат инструмента попадает в prompt, содержимое файла раздувает контекст и обходит TokenBudget.
- Severity: high (при подтверждении пути). Confidence: medium (путь в prompt не прослежен до конца; нужна проверка `_normalize_tool_calls`/`_truncate`).

### B-13. Оценка токенов chars/4 занижает кириллицу
- Файл: `service.py:2634-2635` (`_estimated_tokens` = chars/4), `508-535` (TokenBudget), `2658-2673` (`_fit_prompt_pair`, `bounded_user[:-overflow]` режет хвост user-промпта).
- Описание: для русского текста токенов заметно больше, чем chars/4. Бюджет оценивается с недооценкой, а обрезка отрезает конец промпта, где обычно находится текущий запрос.
- Severity: medium. Confidence: medium.

### B-14. Нарушение LLM-правила: прямые OpenAI-клиенты
- Файлы: `WEB-itinvent/backend/scripts/ai_answer_benchmark.py:21,48`, `WEB-itinvent/backend/scripts/ai_scenarios_benchmark.py:242,327`, `voice_video/modules/analyzer.py:9-25`, `voice_video/modules/segmentation.py:8-32`, `voice_video/modules/jev.py:26`, `voice_video/modules/transcription.py:260`.
- Описание: AGENTS требует, чтобы все OpenRouter/LLM-вызовы шли через `shared/llm/`. Здесь заведены собственные клиенты.
- Severity: medium. Confidence: high.

### B-15. Вложенный retry в complete_json умножает число вызовов
- Файл: `shared/llm/client.py:603-685`. Внешний retry на 661-680 и `_with_transient_retry` (481-503) вызываются вложенно. Fallback на `_is_json_mode_retryable_error` (667) добавляет ещё вызовы.
- Описание: при сбоях число HTTP-запросов на один `complete_json` перемножается.
- Severity: medium. Confidence: high.

### B-16. Эвристика transient-ошибок слишком широкая
- Файл: `shared/llm/client.py:298-304`: подстроки `"connect"`, `"500"` и регэксп `\b(5\d{2}|429)\b`.
- Описание: текст ответа, содержащий «500 tokens» или «connect» в бизнес-тексте, помечается как transient и ретраится.
- Severity: low-medium. Confidence: medium.

### B-17. Стрим не закрывается при исключении
- Файл: `shared/llm/client.py:542-601`, `_iterate` (594-601) без `finally: stream.close()`.
- Описание: при раннем выходе из итерации HTTP-соединение остаётся открытым до GC.
- Severity: low-medium. Confidence: high.

### B-18. JEV: response.json() вне обработки JevClientError
- Файл: `shared/llm/jev_client.py:271` внутри `decide` (221-296).
- Описание: невалидный JSON от провайдера даёт сырое исключение. Вызывающий `service.py` (1384, 1513) ловит `Exception` широко, поэтому ошибка маскируется под «маршрутизация недоступна».
- Severity: low. Confidence: high.

### B-19. redaction не покрывает *_token= с подчёркиванием
- Файл: `WEB-itinvent/backend/ai_sandbox/redaction.py:14`: `\b(password|...|token|...)`.
- Описание: в `access_token=` и `openai_api_key=` перед `token` стоит `_`, который является word-символом, поэтому `\b` не срабатывает и значение не маскируется.
- Severity: low-medium. Confidence: high.

### B-20. Сетевые инструменты дают LLM зондирование произвольных хостов
- Файлы: `tools/network.py:723` (NetworkSslCheckTool, произвольные hostname/port), `241-243` (NetworkHostPingArgs, host max_length=253 без валидации), `319-326` (ping: `["ping","-n",count,"-w","1000",host]`), `451-466` (`["nslookup", f"-type={record_type}", query]`).
- Описание: инструменты позволяют проверять любые внутренние адреса и порты. Для запуска используется список аргументов, поэтому shell-инъекции нет, но host или query, начинающийся с `-`, интерпретируется как опция утилиты.
- Severity: medium (зондирование) / low (опции). Confidence: medium.

### B-21. _get_cert_without_verify всегда возвращает None
- Файл: `tools/network.py:852-887`. При `CERT_NONE` `pem_cert` не получается, ветка использования сертификата недостижима.
- Severity: low. Confidence: high.

### B-22. WOL: broadcast_ip без валидации, отправка недостижима
- Файлы: `tools/network.py:917-919` (`broadcast_ip` без валидации), `938-944` (`_send_wol_packet`), `1090` (драфт `network.wol`). Исполнителя нет (см. B-03).
- Severity: low. Confidence: high.

### B-23. WMI-скрипт: экранируются только одинарные кавычки
- Файл: `tools/network.py:1127-` (`_build_wmi_script`), запуск `powershell -Command` около 1257.
- Описание: при конкатенации пользовательской строки в PowerShell-скрипт возможна инъекция через спецсимволы, отличные от `'`. Нужна отдельная проверка.
- Severity: low-medium. Confidence: low.

### B-24. Бот-пользователь задаёт peer_user_id без проверки существования
- Файл: `action_cards.py:1456-1490` (`build_chat_message_draft`, peer_user_id из payload). Отправка в `1562-1596` проверяет membership через `chat_service.send_message`, поэтому риск ограничен.
- Severity: low. Confidence: medium.

### B-25. Проверка прав в tools/office.py отличается от registry
- Файл: `tools/office.py:657-680`: TaskCommentDraftTool и TaskStatusDraftTool проверяют `PERM_TASKS_READ`, а registry требует `TASKS_WRITE`. `TaskCreateDraftTool` (615-657) внутренней проверки не имеет и полагается на registry.
- Описание: фактическая защита обеспечивается registry, но внутренние проверки противоречат друг другу, что усложняет сопровождение.
- Severity: low (конфликт). Confidence: high.

### B-26. Тихое переписывание инструмента в draft_policy
- Файл: `draft_policy.py` (prepare): `directory.people.search` переписывается в `ad.user.password_status`.
- Severity: low-medium (неожиданное поведение). Confidence: medium.

### B-27. Ошибка индекса KB проглатывается
- Файл: `tools/kb.py:25-35` (`_index_search`) ловит все исключения и возвращает пусто.
- Описание: сбой поиска выглядит как «ничего не найдено», пользователь и модель этого не видят.
- Severity: low. Confidence: high.

### B-28. Watchdog reap_stale_runs может снять живой run
- Файл: `service.py:4321-4424`, порог 900 с по `updated_at`.
- Описание: если `updated_at` не обновляется во время долгих LLM-шагов и tool-loop, живой run может быть помечен как зависший.
- Severity: medium. Confidence: low (нужна проверка, обновляется ли `updated_at` в цикле).

### B-29. SKIP LOCKED только на PostgreSQL
- Файл: `service.py:4439-4440`.
- Описание: на другой СУБД несколько воркеров могут взять один run. Для production это PostgreSQL, риск касается dev/test.
- Severity: low. Confidence: medium.

### B-30. asyncio.run в пути side-effects
- Файл: `service.py:7098` (`_enqueue_message_side_effects_after_send` → `asyncio.run(build_message_created_event_jobs(...))`).
- Описание: если вызывающий код выполняется в потоке с активным event loop, `asyncio.run` падает с RuntimeError. Контекст вызова нужно проверить.
- Severity: low. Confidence: low.

### B-31. Гонка на кэше текста вложений
- Файл: `service.py:7151-7196`, кэш `self._attachment_text_cache` (инит 2754-2755, лимит 256), мутация 7193-7195 без lock.
- Описание: при параллельных вызовах из `asyncio.to_thread` возможна гонка при вытеснении.
- Severity: low-medium. Confidence: medium.

---

## Conflicts

### C-01. Маршрутизация JEV: env и base URL расходятся с RouterAI
- Файл: `shared/llm/jev_client.py` (`_resolve_api_key`: JEV_API_KEY или OPENROUTER_API_KEY; `_resolve_base_url`: по умолчанию `https://openrouter.ai/api/v1`), `shared/llm/env.py` (`DEFAULT_ROUTERAI_BASE_URL = "https://routerai.ru/api/v1"`).
- Описание: JEV по умолчанию ходит на openrouter.ai, остальной gateway на routerai.ru. AGENTS говорит, что LLM-вызовы идут через `shared/llm/`, но провайдер по умолчанию разный.
- Severity: medium. Confidence: medium.

### C-02. DoH-fallback для routerai.ru включён по умолчанию
- Файл: `shared/llm/client.py:160-225`: `_routerai_dns_prefer_doh` по умолчанию `"1"`, DoH через 1.1.1.1, `trust_env=False`.
- Описание: имя хоста уходит во внешний DoH в обход системного DNS и прокси. Это меняет сетевую политику для всех клиентов модуля.
- Severity: medium. Confidence: medium. Нужно решение владельца политики.

### C-03. port_reclaim автоматически убивает процессы
- Файл: `shared/port_reclaim.py:70-92`: на Windows netstat, затем поиск по подстроке CommandLine и `taskkill /PID /T /F`. Вызывается из `start_server.py`, `start_chat_server.py`, `start_docflow_gateway.py`, `scan_server/__main__.py`.
- Описание: AGENTS запрещает освобождать порты и перезапускать процессы без явного запроса. Функция делает это при обычном старте.
- Severity: medium. Confidence: high.

### C-04. Обязательства по перезапуску и кэш JEV
- Файл: `service.py:1214-1266` (JEV-кэш) и вызовы `jev_client.decide` с `max_retries=0`, 1384, 1513.
- Описание: кэш маршрутизации не учитывает смену конфигурации модели, что может дать устаревшее решение после релиза.
- Severity: low. Confidence: low.

### C-05. Правила sandbox-учёта расходов
- Файл: `ai_sandbox/gateway.py` (`sandbox_chat_completions` ~335-416, `_stream` с finally events.close()).
- Описание: учёт usage для sandbox-вызовов и отмены в коде не найден. Нужно решение, учитывать ли sandbox-расход в общем бюджете.
- Severity: low. Confidence: low (открытый вопрос).

### C-06. Три разных классификатора групп инструментов
- Файлы: `service.py:594-621` (`_is_*_tool_id`), `tools/context.py:213` (`get_tool_group`), `tool_permissions.py:72-90` (_PREFIX_PERMISSIONS).
- Описание: одна и та же классификация заведена в трёх местах. Расхождение приведёт к тому, что инструмент попадёт не в ту группу или не под ту проверку.
- Severity: medium (сопровождение). Confidence: high.

### C-07. Захардкоженный адрес helpdesk
- Файл: `tools/self_service.py` (`DEFAULT_HELPDESK_EMAIL = "it@zsgp.ru"`, около 395-473).
- Описание: адрес не вынесен в конфигурацию. Для другой среды потребуется правка кода.
- Severity: low. Confidence: high.

---

## Duplication

### D-01. Повтор `_require_permission` / `_has_permission`
- Файлы: `tools/office.py:58-71` и аналогичная логика в `tools/self_service.py` (импорт `_require_permission` из office.py).
- Severity: low. Confidence: high.

### D-02. Дублирование клампов настроек инструментов
- Файл: `tools/context.py` (`max_tool_rounds` 397, `max_tool_calls_per_round` 413, `normalize_tool_settings` 296): одинаковые ограничения записаны в нескольких местах.
- Severity: low. Confidence: high.

### D-03. Повтор логики списков tool_id в service.py
- Файл: `service.py:594-621` и `_handle_tool_group_expansion` (1552-1658) дублируют проверки групп из `context.py`. См. C-06.
- Severity: low-medium. Confidence: high.

### D-04. Две реализации retrieval
- Файлы: `retrieval.py` (Python-скорер) и `retrieval_interface.py` (PostgresFts adapter с fallback). Оба ведут одну и ту же задачу.
- Severity: low-medium. Confidence: high.

### D-05. Копии shared/llm вне основного дерева
- Файлы: `deploy_staging/mail-badge-production-source-20260831/shared/llm/client.py`, `output/haiku-comparison-20261008/client-before.py`.
- Описание: копии клиента лежат в рабочем дереве и могут разойтись с основной версией.
- Severity: low. Confidence: high.

### D-06. sys.path hack в нескольких местах
- Файлы: `WEB-itinvent/backend/ai_chat/openrouter_client.py:11-14` (shim-реэкспорт), `shared/file_egress_store.py` (re-export из inventory_server с sys.path).
- Описание: инверсия зависимостей: `shared` импортирует из `inventory_server`.
- Severity: low-medium. Confidence: high.

---

## Optimization

### O-01. KB retrieve загружает всю таблицу чанков
- Файлы: `retrieval.py:327-334` (`session.scalars(select(AppAiKbChunk)).all()`), `retrieval.py:373-387` (`retrieve_template_candidates` тоже весь список).
- Описание: на каждый запрос загружается полный набор чанков, затем фильтруется в Python. При росте KB это главный источник задержки. Есть FTS-индекс (`20260427_0023`), который не используется здесь.
- Severity: medium. Confidence: high.

### O-02. KB-поиск на каждом запросе без кэша
- Файл: `service.py:6365-6657` (`_build_conversation_context`, KB retrieve 6539-6544, template candidates 6551-6557).
- Severity: low-medium. Confidence: medium.

### O-03. MyFilesSearch грузит все файлы, режет после
- Файл: `tools/self_service.py` (`MyFilesSearchTool.execute`).
- Описание: выборка без LIMIT на уровне SQL, срез в Python.
- Severity: low-medium. Confidence: high.

### O-04. kb_service грузит все статьи на каждый вызов
- Файл: `services/kb_service.py:173-177` (`_load_articles`), `252-` (`list_articles`), `315-326` (`get_article`).
- Severity: medium. Confidence: medium.

### O-05. Сессия БД на каждую проверку отмены run
- Файл: `service.py:3700-3710` (`_raise_if_run_cancelled` открывает сессию и вызывает `can_use_bot` на каждый вызов).
- Severity: low. Confidence: high.

### O-06. Sync KB не имеет backoff при сбоях
- Файл: `retrieval.py:303` (`_last_sync_monotonic` обновляется только при успехе), `305-316`.
- Описание: при постоянной ошибке индексации каждый запрос снова пытается sync.
- Severity: low-medium. Confidence: medium.

### O-07. Новый httpx.Client на каждый get_credits
- Файл: `shared/llm/client.py:409-425`.
- Severity: low. Confidence: high.

### O-08. Клиенты _build_client не закрываются
- Файлы: `shared/llm/client.py:450-479` (thread-local, без close), `shared/llm/jev_client.py` (~180-190, кэш по timeout, без close).
- Severity: low. Confidence: medium.

### O-09. TokenBudget: accumulated_prompt_tokens записывается, но не читается
- Файл: `service.py:508-535` (строка 530).
- Описание: поле накапливается и не влияет на решения. Либо использовать, либо удалить.
- Severity: low. Confidence: high.

---

## Dead code

### X-01. Ветки подтверждения для ad.unlock и network.wol отсутствуют
- Файл: `action_cards.py:2060-2210`. Сами драфты создаются (см. B-03), обработчики — нет. Если драфты удаляются, удаляется и неиспользуемый код WOL.
- Severity: low (следствие B-03). Confidence: high.

### X-02. _send_wol_packet недостижима
- Файл: `tools/network.py:938-944`. См. B-22.
- Severity: low. Confidence: high.

### X-03. _get_cert_without_verify: мёртвая ветка
- Файл: `tools/network.py:852-887`. См. B-21.
- Severity: low. Confidence: high.

### X-04. accumulated_prompt_tokens (write-only)
- Файл: `service.py:530`. См. O-09.
- Severity: low. Confidence: high.

### X-05. Реэкспорт _extract_json_payload через shim
- Файл: `WEB-itinvent/backend/ai_chat/openrouter_client.py:28,37` (`_extract_json_payload`, `_read_env` в `__all__`). Используется ли `_read_env` и `_extract_json_payload` вне самого shim, не проверено.
- Severity: low. Confidence: low.

---

## Итоговая сводка по severity

- high: B-01, B-03, B-12 (при подтверждении пути).
- medium: B-02, B-04, B-05, B-06, B-07, B-08, B-09, B-10, B-11, B-13, B-14, B-15, B-20, C-01, C-02, C-03, C-06, O-01, O-04, B-28.
- low и ниже: остальные.

## Открытые вопросы

1. B-12: подтвердить, попадает ли `export.content_b64` из `files.py` в prompt через `_normalize_tool_calls`/`_truncate`.
2. B-28: обновляется ли `updated_at` во время долгого tool-loop.
3. B-30: из какого потока вызывается `_enqueue_message_side_effects_after_send`.
4. C-02: какая политика DNS и прокси действует в production для routerai.ru.
5. C-05: нужен ли учёт usage для sandbox-вызовов.
6. B-09: есть ли проверка доступа внутри `kb_service.get_attachment`.

## Что не проверялось

- Запуск тестов и любых сервисов (запрещено заданием).
- Реальные данные и объёмы KB, длина ответов модели.
- Поведение под нагрузкой.
