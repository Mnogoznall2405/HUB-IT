# Дополнительный аудит AI: retrieval и sandbox

Дата: 2026-11-03. Режим: read-only исходников; единственный созданный файл — этот отчёт. Код, production, БД, `.env`, процессы и конфигурация не менялись. LLM, API, сеть, Podman и внешние программы не вызывались.

Итог: **4 новые находки: 2 High, 2 Medium**. Три механизма воспроизведены на реальных функциях, извлечённых через AST, с контролируемыми зависимостями. Четвёртая находка статически подтверждает окно потери SSE; harness подтверждает поведение worker при уже потерянном завершении, но реальный OpenCode не запускался.

Обозначения: **R** — изолированное воспроизведение механизма; **S** — прослеженный текущий исходный путь; **H** — гипотеза, требующая подтверждения. R не означает production E2E. В основной список H не включены.

## Модель и границы проверки

Обычный Assistant собирает KB chunks в `AiChatService._build_conversation_context` и затем передаёт их в LLM. KB — отдельный authoritative JSON/store dataset; `ai_chat/retrieval.py` держит его копию в APP chunks с metadata, включая ACL. Индекс обновляется по TTL процесса, а не перед каждым чтением.

Sandbox — отдельная очередь и worker. `ConcreteSandboxJobExecutor` поднимает контейнер для существующей пользовательской workspace, отправляет `prompt_async`, получает события OpenCode, запрашивает у HUB решение по permissions, останавливает контейнер и доставляет проверенные outputs. HUB решает allow/ask/deny через `OpenCodePermissionPolicy`; redacted preview одновременно используется для отображения и, ошибочно, принятия решения. Эта проверка относится к данным и управлению исполнением; не является доказательством обхода Linux/Podman containment.

Перед выводами прочитаны `07-ai-llm.md` и `REMEDIATION_STATUS_2026-11-03.md` из аудита 2026-11-02. DAI-01…08 и AR-01 здесь не повторяются. На момент проверки `git status --short -- WEB-itinvent/backend/ai_chat WEB-itinvent/backend/ai_sandbox shared/llm` не показывал изменений этих исходников. Соседние результаты других агентов не перезаписывались.

| ID | Уровень | Доказательство | Трудоёмкость | Дефект |
|---|---|---|---|---|
| ADD-AI-01 | High | R/S | S/M | Политика разрешений проверяет обрезанный preview вместо исходной команды |
| ADD-AI-02 | High | R/S | M | KB retrieval проверяет устаревший ACL индекса после ограничения статьи |
| ADD-AI-03 | Medium | R/S | S/M | Approve permission удаляет контроль времени уже запущенных tools |
| ADD-AI-04 | Medium | S; R для последствия | M | Prompt отправляется раньше SSE-подписки, отсутствует восстановление пропущенного завершения |

## ADD-AI-01 — allow/deny вычисляется по усечённой команде

**Где:** `WEB-itinvent/backend/ai_sandbox/app_service.py:1461`, `:1468`, `:1471`; `redaction.py:19`, `:24`, `:27`, `:50`; `policy.py:184`, `:192`, `:289`; передача исходного metadata — `executor.py:622` и `worker_control.py:74`. HTTP seam: `api/v1/chat/ai_sandbox_internal.py:80`; arguments — произвольный dict, `ai_sandbox/schemas.py:141`.

**Точный путь:** событие OpenCode → `_handle_permission` → worker control → `create_permission_request(arguments_preview=payload.arguments)` → `redact_preview` → `PermissionRequest.arguments_preview=safe_arguments` → `evaluate_request`. Строки обрезаются до 2000 символов. Политика уже не видит хвост команды и её собственный лимит 8192 применяется к обрезанной строке. ALLOW сохраняется как `approved` (`app_service.py:1567`), worker отвечает OpenCode на исходный permission ID; исходная команда в OpenCode этим preview не заменяется.

**Сценарий:** длинная разрешённая команда с запрещённым shell-оператором/действием в хвосте. Например диагностическая строка `"ls -d " + "a" * 2100 + "; curl https://example.invalid"` имеет длину 2136. Реальная policy на полной строке возвращает DENY, а на `redact_preview` этой же строки — ALLOW. Сам command никогда не исполнялся; адрес зарезервирован для примера.

**R:** harness загрузил только stdlib `contracts.py`, `redaction.py`, `policy.py` через AST без относительных импортов. Один и тот же реальный `evaluate_request` вызван на полном и усечённом аргументе. Вывод: `REDACTION_POLICY {'raw_length': 2136, 'preview_length': 2000, 'raw': 'deny', 'redacted': 'allow'}`; assertions выполнены.

**Последствие:** HUB автоматически одобряет permission, который его же политика запрещает. Это дефект границы policy/UI preview. Не утверждается выполнение curl на реальном pinned OpenCode: его собственная defence-in-depth policy может отдельно разобрать и отклонить некоторые составные команды. Сетевые ограничения контейнера, scoped gateway token и read-only root остаются дополнительными независимыми границами; host escape не доказан.

**Исправление:** решение вычислять по полному валидированному in-memory input; redaction/truncation применять отдельно только к сохранению и отображению. Сверхлимитный или неполный input отклонять до policy. Секреты из полного input не логировать и не сохранять. Session grant должен соответствовать полному нормализованному действию, а не усечённому preview.

**Приёмка:** boundary permission request с безопасным префиксом и запрещённым хвостом после 2000-го символа получает `rejected`, без answer `once`; отдельно случаи >8192, редактируемых полей после 50-го ключа и redaction меняющего синтаксис. Проверить pinned OpenCode на локальном runtime без внешней сети; сохраняемый preview остаётся bounded/redacted.

## ADD-AI-02 — отзыв доступа к статье не применяется к свежему KB индексу

**Где:** `WEB-itinvent/backend/ai_chat/retrieval.py:130`, `:303`, `:308`, `:334`, `:337`, `:341`; аналогичная проверка template candidates — `:399`. Caller: `ai_chat/service.py:6687` → `:6688` → KB text включается в контекст `:6696`. Authoritative чтение: `services/kb_service.py:315`, `:323`; изменение scope и времени статьи: `:455`, `:459`, `:470`. Сам ACL: `services/access_policy_service.py:274`.

**Точный путь:** успешный sync записал chunk со `visibility_scope=global`; до окончания freshness TTL владелец меняет статью на `private`, удаляет её либо снимает публикацию. `ensure_index_fresh` возвращает без sync. `retrieve` читает chunks и вызывает `can_view_kb_item(current_user, metadata)` исключительно на старой metadata. Authoritative статья, её текущий status и ACL перед выдачей текста не проверяются. `update_article` не инвалидирует retrieval singleton.

**Сценарий:** пользователь B имел доступ к общей статье владельца A. A переводит статью в private; новая обычная KB card API уже недоступна B, но вопрос Assistant с нужными словами до следующего sync получает старый текст в LLM context. При TTL по умолчанию окно до 30 секунд после завершённого sync, настройка допускает до 3600 секунд; это не измерение production. Если sync долго строится, он также работает со snapshot статей, поэтому 30 секунд нельзя объявлять строгой верхней границей любой гонки.

**R:** реальные AST `ensure_index_fresh`, `retrieve`, tokenize/metadata helpers и `can_view_kb_item`; fake APP-session возвращает один старый chunk, live item имеет `private`, user ID другой, index timestamp текущий. Guard `sync_index` бросал бы assertion, если бы был вызван. Вывод: `KB_STALE_ACL {'live_allowed': False, 'index_hits': 1, 'cached_scope': 'global', 'live_scope': 'private'}`. Реальная БД не открывалась. Это воспроизведение fail-open выбора по stale metadata, не HTTP E2E и не отправка данных модели.

**Последствие:** после успешного ограничения доступа сведения ещё могут уйти в ответ Assistant и внешний LLM prompt; исчезновение статьи из обычного KB UI не означает прекращения её retrieval. Отличается от DAI-05: пользовательский permission snapshot здесь свежий, устарела авторизация самого ресурса.

**Исправление:** перед построением LLM context проверять текущие published status и ACL выбранных article IDs по authoritative источнику; недоступные/отсутствующие/непроверенные статьи исключать fail-closed. TTL оставить для содержимого и производительности, но не использовать как гарантию доступа. Инвалидация должна работать между процессами и не зависеть только от singleton одного worker.

**Приёмка:** индексировать public статью, затем без истечения TTL выполнить public→private, unpublish, delete. Новый run пользователя B не содержит chunk, title или attachment metadata статьи ни в model input, ни в traces/result. Проверить обычный retrieval и template candidates, owner A сохраняет допустимый доступ. Ошибка authoritative read не возвращает старый контент как подтверждённо разрешённый.

## ADD-AI-03 — подтверждение permission отключает command timeout

**Где:** `WEB-itinvent/backend/ai_sandbox/executor.py:529`, `:530`, `:567`, `:569`, `:648`, `:653`.

**Точный путь:** `message.part.updated` с tool state running записывает момент в `active_tools`; `_raise_if_tool_timed_out` проверяет только элементы этой map. `_handle_permission` после любого approved вызывает `active_tools.clear()`. Комментарий обещает перезапуск бюджета, но новый timestamp нигде не устанавливается.

**Сценарий:** OpenCode сообщает running до ожидания permission — именно эту последовательность описывает комментарий `:649`. Пользователь подтверждает bash; после разрешения tool продолжает работу, нового события transition→running нет. Удалённая запись не появляется до следующего такого события, и 120-секундная проверка tool перестаёт действовать. Если параллельно работал другой tool, его часы тоже удалены независимо от того, к какому tool относился permission. Общий response deadline 900 секунд остаётся, бесконечное выполнение не заявляется.

**R:** реальные AST `_handle_permission`, `_raise_if_tool_timed_out`. До approve в map есть `bash-1` с возрастом 200 секунд: штатная проверка вызывает abort и exception. Затем реальная `_handle_permission` получает контролируемый `approved/once`, отправляет один answer; повторная штатная timeout-проверка ничего не прерывает. Вывод: `TOOL_TIMEOUT_AFTER_APPROVAL {'active_tools': {}, 'aborts': 0, 'answers': 1}`. Внешний tool не запускался, `cancel` отдельно не эмулировался как сбой.

**Исправление:** сопоставлять permission с конкретным tool/call ID и перезапускать timestamp только этого tool после его release. Часы остальных active tools сохранять; отсутствие новых событий не должно выключать timeout. Если соответствие недоступно, определить явное консервативное правило вместо очистки всей map.

**Приёмка:** running→permission→approve→отсутствие повторного running, затем >120 секунд исполнения вызывает один abort. Два concurrent tools: approve одного не увеличивает бюджет второго. Проверить ожидание карточки, rejection, cancellation и общий response deadline на управляемом clock. Считать user wait отдельно от execution; не ждать 120 реальных секунд в тесте.

## ADD-AI-04 — окно потери событий между prompt и SSE и при reconnect

**Где:** `WEB-itinvent/backend/ai_sandbox/executor.py:394`, `:407`, `:411`, `:462`, `:475`, `:535`, `:551`; live stream клиент — `ai_sandbox/control.py:220` (метод `events`), `:223` (GET `/event`).

**Точный путь:** и для новой, и для persisted session сначала синхронно отправляется `prompt_async`; только после его ответа вызывается `_wait_for_completion`, создающий reader thread и GET `/event`. Поэтому подписка заведомо не установлена в момент начала обработки prompt. Повторное открытие stream после ошибки также не отправляет cursor/Last-Event-ID, не читает `/session/.../message` и не сверяет authoritative session status. Успешный return возможен только после наблюдения `session.idle`; текст и роли собираются только из локально полученных событий.

**Сценарий:** быстрый ответ, permission или `session.error` появились до подписки; либо связь разорвалась непосредственно перед финальными событиями. При live SSE без replay пропущенные события worker не восстанавливает: уже завершённый prompt ждёт до deadline, затем считается ошибкой. Если пропущены role/text events, а idle получен, возможен пустой/неполный answer вместо сохранённого ответа. Permission, пропущенный до подписки, может оставить OpenCode ожидающим решения до общего deadline.

**S/R:** порядок реальных callers проверен по исходникам. Реальный `_wait_for_completion` запускался с fake live control: `prompt_async` уже отметил completion до появления subscriber, последующий stream не replay-ит старые события. Вывод: `PRE_SUBSCRIPTION_COMPLETION {'completed': True, 'result': 'OpenCode response deadline expired', 'aborts': 1, 'elapsed': 1.03}` при response timeout 1 секунда. Это подтверждает отсутствие recovery в worker, но **не подтверждает реальную частоту и replay-семантику установленной OpenCode 1.18.18**: процесс не запускался, исходники его сервера в этой проверке не читались. Поэтому итоговое доказательство S; live transport сценарий требует локальной приёмки.

**Исправление:** установить SSE и дождаться readiness до submit prompt; после reconnect восстанавливать authoritative messages/status/permissions по session и стабильному prompt message ID. Completion не должен зависеть только от единственного ephemeral idle. Reconciliation — status/read-only, без автоматического повторного prompt.

**Приёмка:** локальный pinned runtime или контрактный control-server завершает prompt до возврата POST, а также разрывает stream до idle и между role/text events. Worker получает ровно один полный assistant answer, не раскрывает reasoning/user text и не отправляет prompt повторно. Отдельно разрешение, пришедшее в это окно, доступно пользователю и завершается одним ответом.

## Проверки, ограничения и отвергнутые выводы

Выполнен один успешный общий AST harness: **4 сценария с assertions, exit=0, около 1.37 сек**. Предварительный запуск harness выявил неудачную диагностическую строку с пробелами: `redact_text.rstrip()` сделал её невалидной для ожидаемого ALLOW. Строка заменена на длинный обычный аргумент; это не изменение исходников и не failure приложения. Harness исполнялся из stdin, файлов не создавал; fake sessions/control не обращались к БД, API, LLM или Linux. Общие pytest suites и нагрузочные тесты не запускались. Новые тестовые файлы не добавлялись.

Проверены relevant spans: весь `memory.py`, весь `retrieval.py`, `ai_sandbox/executor.py` (execute, prompt lifecycle, permissions, snapshot/output), `control.py`, `policy.py`, `redaction.py`, transfer paths, repository claim/recovery spans, worker heartbeat/finalization, sandbox gateway, shared LLM stream и SSE serializer, neighbouring tests. Это выборочная проверка, не доказательство отсутствия иных дефектов.

Отвергнутые/ограниченные утверждения:

- Не объявляется sandbox escape из-за произвольного Python: это явно разрешённая продуктовая политика, контейнер имеет отдельные mount/network/seccomp границы. ADD-AI-01 — несоответствие проверяемого и исполняемого аргумента, а не доказанный выход из контейнера.
- Не объявляется утечка всех KB private articles: реальный `can_view_kb_item` вызывается; ADD-AI-02 относится к изменению ACL/status после snapshot.
- Не объявляется отсутствие cancellation watchdog: отдельный event reader и периодические проверки есть (`executor.py:475`, `:479`); ADD-AI-03 относится к очищенным clock entries.
- Не утверждается, что любой reconnect теряет результат: требуется потеря существенного события без replay; production вероятность не измерена.
- Подозрение на upstream stream cleanup (`shared/llm/openai_gateway.py:207`, обычный `for` без явного close provider iterator) не повышено до находки: не проверены фактические ссылки и close/finalizer установленного OpenAI SDK при disconnect.
- Full-scan KB chunks в Python заметен (`retrieval.py:334`), но без baseline и объёма не объявлен доказанной деградацией производительности.
- DAI-01…08 и AR-01 остаются отдельными ранее описанными проблемами; этот документ не обновляет их remediation status.

Для закрытия нужны отдельные изменения кода и локальные boundary tests. Деплой, рестарт и изменение production не выполнялись и для самого отчёта не нужны.

При финальном status уже появились параллельные изменения другого процесса в `ai_chat/tools/{computers,context,it_reports,itinvent,mfu,self_service}.py`. Эти файлы данным агентом не менялись; находки опираются на неизменённые `retrieval.py`, sandbox lifecycle/policy и названные callers.
