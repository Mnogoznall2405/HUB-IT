# CYCLE 18 — независимая проверка аудиторских тестов и достоверности находок

- Дата: 2026-11-23
- База аудита: PR #9, `209611a3` (323 записи).
- Проверенный код: чистый **`338912d9`**; frontend и backend из одного `git archive`, отдельная SQLite `.state-cycle18` (backend 18008, proxy 5228). Production не затрагивался.
- Все инструменты и команды — в `evidence/cycle18/`; приложение не изменялось.

## 1. P1 — настоящие assertions в five E2E

`five-e2e.cjs` переписан: сценарий PASS только когда **все обязательные проверки** истинны, а не когда Playwright не бросил исключение. Каждый сценарий возвращает список checks; `pass` вычисляется по `mandatory` checks, ошибка или любой failed check даёт exit 1.

| Сценарий | Обязательных проверок | Что проверяется |
|---|---|---|
| Feed | 8 | диалог закрыт; пост виден после сохранения и после reload; API содержит ровно одну запись с уникальным title; id сохраняется |
| Tasks | 14 | задача создана и переживает reload; описание сохранено (UI + API detail); чек-лист в API и после reopen/reload; нет дублей задачи/пункта |
| Chat | 9 | первая вкладка видит сообщение; вторая видит первое; первая получает второе; оба после reload; API counts = 1/1; дублей 0 |
| MyFiles | 12 | upload завершён; файл в API и после reload; поиск находит; preview worker ready; диалог и изображение; canvas pixel 64x64 (200,30,40); артефакт-наблюдение; уникальность |
| Admin Users | 6 | пользователь создан; id есть; после reload/search найден; API ровно один; дублей нет |

Positive control: **5/5 PASS**, **49 обязательных проверок**, 1 non-mandatory observation (см. FE-0326). Результат: `shots/results-1795429349298-180.json`.

Ожидание событий вместо `sleep`: закрытие диалога (`waitFor detached`), ответы API, `pollApi` до появления записи, `waitForFunction` для сообщений чата и загрузки изображения.

## 2. Negative controls

`negative-controls.cjs` запускает suite с test-only перехватами; каждый negative обязан завершиться exit 1.

| Контроль | Категория | Результат |
|---|---|---|
| `feed_api_error` | ошибка API | FAIL (диалог не закрылся, timeout) |
| `feed_wrong_record` | неверная запись/идентификатор | FAIL (5 checks) |
| `tasks_save_noop` | сохранение не произошло | FAIL (3 checks) |
| `tasks_duplicate` | дубли | FAIL (4 checks) |
| `chat_duplicate` | дубли | FAIL (2 checks) |
| `myfiles_hide` | запись отсутствует | FAIL (6 checks) |
| `myfiles_duplicate` | дубли | FAIL (3 checks) |
| `admin_hide` | запись отсутствует | FAIL (6 checks) |
| `admin_duplicate` | дубли | FAIL (3 checks) |
| `login_timeout` | таймаут | FAIL (waitForURL 30 s) |
| positive feed | контроль | PASS |

Итог: **10/10 negative падают как должны**, положительный контроль PASS. Результат: `shots/negative-controls.json`.

## 3. FE-0232 / FE-0239 / FE-0259 — строгие verdicts

Исходные сценарии сохраняли наблюдения в console.log; в cycle18 добавлены assertions и exit codes.

- **FE-0232** — 11/11 checks, exit 0: links очищены до 0; seed 1; injected bulk 500 → в drawer делегата нет; Save отправляет `items: []`; links 1 → 0; повторный seed 1; контроль без сбоя → делегат виден, `items: 1`, links 1 → 1.
- **FE-0239** — 8/8 checks, exit 0: до D1 `[14]`, D2 `[16]`; задержанный ответ D1 применён при выбранном D2 (UI показывает owner/delegate); Save PUT `/departments/D2/managers {"manager_user_ids":[14]}`; после D1 `[14]`, D2 `[14]` (16 → 14). Проверены departmentId запроса и руководители обоих отделов до/после.
- **FE-0259** — 11/11 checks, exit 0: план работ PUT 200 и сохраняется в planning API после reload; дневная сводка dirty → F5 без `beforeunload` → значение пустое; недельный план dirty → F5 без `beforeunload` → значение пустое.
  - **Название уточнено:** отдельного контрола «недельная сводка» нет. Испытаны **дневная сводка** («Сводка за день») и **недельный план** («Планирование»). Заголовок записи исправлен, исторический сохранён в `titleHistory`.

Повторный независимый прогон всех трёх — exit 0; verdicts сохранены в `shots/fe0232-verdict.json`, `fe0239-verdict.json`, `fe0259-verdict.json`.

## 4. FE-0230 — окончательное обоснование

- Ранний `return null` стоит до **9 хуков**: `useTheme`, `useMemo`, `useAuth`, `useNotification`, `useState` x2, `useEffect` x2, `useCallback`. При флаге true — 0 хуков.
- Тот же экземпляр теоретически может нарушить Rules of Hooks при смене флага. Но:
  - `AccountWorkspace` пересчитывает `nativeShell` на каждом рендере и рендерит карточку только при `!nativeShell`;
  - `MainLayout` на `desktop.capabilities` (идёт сразу после `hostReady`) вызывает `setDesktopActionsAvailable`, что перерисовывает дерево и размонтирует карточку;
  - карточка не подписана на `hostReady`; её локальные обновления асинхронны (push/notification state, клики).
- Cycle 17: реальный WebView2 host, задержанный `hostReady` 8 с, синхронный клик по кнопке в момент flip — hooks-ошибки нет, родитель размонтирует карточку.
- Достижимый card-local re-render в окне между hostReady и capabilities не найден; реальный пользовательский крах не воспроизведён.

**Решение:** статус **Suspected**, severity **High** (потенциальный крах настроек, если сценарий станет достижимым; вероятность не доказана), `runtimeStatus: not-reproduced-live`. Это не «доказательство отсутствия» — статический инвариант остаётся риском. Подробности: `evidence/cycle18/fe0230-analysis.md`. Диагностический CDP-порт не оставлен.

## 5. FE-0215 — можно ли проверить без Exchange

- Backend использует **Exchange EWS** (`exchangelib.Account`, NTLM, `service_endpoint`/`server`), а не IMAP/SMTP. Локальный IMAP/SMTP fixture не подходит.
- Draft/autosave: `MailDraftLifecycle.upsert_draft` создаёт `Message(folder=account.drafts, body=HTMLBody)`, добавляет `FileAttachment` (inline — cid), вызывает `save()` (CreateItem) и `save(update_fields=...)` (UpdateItem); чтение — `account.drafts`/GetItem; удаление — DeleteItem.
- Минимальные EWS-контракты: GetFolder/FindFolder, CreateItem, UpdateItem, GetItem, Create/Get/DeleteAttachment, DeleteItem, SendItem; NTLM + TLS.
- Полный E2E без EWS test server невозможен; EWS-compatible double — отдельный сервис, которого нет; установка нового сервера/зависимостей без разрешения владельца запрещена.
- Возможен только **limited service-level contract test** с fake `Account`/`Message` (проверка HTML и вложений в payload), не UI→EWS autosave. Frontend route-mock — только UI. FE-0215 остаётся `blocked-environment`; полный E2E не заявляется.

## 6. Новый дефект FE-0326 (Medium)

- Аутентифицированный preview PNG работает: диалог показывает 64x64, canvas pixel `(200,30,40)`.
- `GET /my-files/{id}/preview/content` → 200 `image/png`, 180 байт; Pillow `Image.open(...).load()` → **`OSError: broken data stream`**. В `my_files_previews` лежит повреждённый `preview.png`; у другого upload `preview.webp` (88 Б) и `thumb.webp` (86 Б) валидны.
- Публичная ссылка на PNG: `<img src=/api/v1/my-files/public/{token}/preview/content>`; публичный preview → тот же 180-байтный PNG, Pillow падает. Оригинал скачивается 200.
- Воспроизведено на двух upload с общим blob `8726c036...`; исходный PNG (186 Б) открывается.
- Impact: публичная ссылка на изображение показывает битое превью; потребители `/preview/content` получают невалидный PNG. Аутентифицированный диалог использует WebP/thumb и выглядит корректно.
- Запись: `FE-0326`, Medium, Confirmed, `local-browser` + `local-api`; скрипт `fe_public_preview.cjs`, скриншот `shots/c18-public-preview.png`.

## 7. Реестр и покрытие

- **324 записи**: Confirmed **269**, Suspected **12**, Fixed-externally 2, Rejected 41.
- Severity: High 12, Medium **124**, Low 173, Info 15.
- High breakdown: исторические 12; актуальные 11 (FE-0078 Fixed); runtime-proven 10 (включая FE-0078; unresolved runtime 9); static-only **FE-0215**; runtime-not-reproduced **FE-0230**; suspectedHigh **FE-0230**.
- `verification`: FE-0232/0239/0259 добавлен `local-browser`; FE-0230 — `test-harness`; FE-0326 — `local-browser` + `local-api`.
- `runtimeStatus`, `statusRationale`, `currentConclusion`, `reverificationHistory`, `titleHistory` синхронизированы; `issueCounters` обновлены; дубликатов не создано.
- `ISSUES.md` перегенерирован; валидатор — **0 ошибок**.
- Покрытие маршрутов не изменилось: **E2E 9, Functional 27, Smoke 2, Blocked 8, Redirect 5; Functional+E2E 36/46 (78.3%)**. `/my-files` остаётся E2E (UI preview работает); FE-0326 — отдельный дефект публичного артефакта.

## 8. Что осталось

- FE-0326: исправить генерацию/выдачу PNG-артефакта, добавить decode-тест.
- FE-0230: найти достижимый card-local re-render или оставить Suspected.
- FE-0215: limited service-level EWS contract test только с согласия владельца.
- FE-0232/0239/0259: исправления (bulk failure, request-id/abort, beforeunload/autosave).
- `/computers`, `/statistics` — синтетические данные; `/database` — SQL test set; ONLYOFFICE — тестовый сервер.
- 11 Suspected (FE-0004, FE-0051, FE-0076, FE-0110, FE-0115, FE-0161, FE-0194, FE-0265, FE-0300, FE-0323, FE-0324) — без новых доказательств в цикле.

## 9. Ограничения

- Negative controls используют test-only перехваты; positive — чистый стенд.
- FE-0232/0239: сетевой сбой/задержка инжектированы, сохранение проверено на реальном backend.
- FE-0259: план сохранён реально; потеря черновика — клиентское поведение.
- MyFiles preview требует запущенного `start_preview_worker.py` (штатный PM2-процесс); без него статус `queued`.
- Приложение не изменялось; merge/deploy не выполнялись.
