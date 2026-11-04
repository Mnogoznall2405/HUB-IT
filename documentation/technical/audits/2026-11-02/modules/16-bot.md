# 16. Telegram-бот: доступ, работы, акты, экспорт и checkpoint

Продолжение: 2026-11-03. Read-only аудит исходников, без Telegram/SMTP/SQL Server и без импорта bot runtime.
Итог: обнаружены шесть открытых механизмов. Прежние CL-01/CL-05 изменены извне: после неоднозначного timeout отправка больше не повторяется, checkpoint использует адресную запись и вынесен из event loop.

## Архитектура и границы

| Контур | Путь данных | Хранение/побочный эффект |
|---|---|---|
| Вход и доступ | `bot/main.py:95` register_handlers → `bot/handlers/start.py:21` → `bot/utils/decorators.py:22` | Allowlist либо членство Telegram-группы, локальный TTL-cache |
| Поиск | `bot/handlers/search.py:69` → database_manager → UniversalInventoryDB | SQL Server выбранной БД |
| Работы | `bot/handlers/work.py:306` → serial/OCR → confirmation `:663` → save `:822` | UPDATE ITEMS и отдельная запись локальной истории |
| Перемещение | `bot/handlers/transfer.py:428` → immutable resolved payload → `shared/transfer_command.py` | SQL Server mutation, акт, checkpoint, Telegram delivery |
| Durable checkpoint | `bot/services/transfer_operation_store.py:74` → `bot/local_json_store.py:27` | SQLite keyed entry в существующем local_store |
| Экспорт | `bot/handlers/export.py:428` → EmailSender | Генерация файла, MIME в памяти, SMTP |
| OCR | work/transfer → input_identifier_service → shared LLM | Внешняя обработка в реальном runtime; в аудите не вызывалась |

Application создаётся с cookie-independent Telegram identity и сетевыми timeout (`bot/main.py:463`); ConversationHandler хранит неперсистентное состояние. Telegram update выполняется отдельно от DB commit и checkpoint: общей транзакции для этих ресурсов нет.

## Инварианты

1. Проверка доступа должна защищать начало каждого доступного извне сценария и критическую запись, а не только /start.
2. Выбранные equipment ID, db_id и подтверждённый пользователь входят в неизменяемую команду.
3. Успех UI означает согласованный статус обязательных эффектов; partial/unknown должен быть явным.
4. Timeout внешней отправки не доказывает недоставку и не разрешает автоматический resend.
5. История и DESCR не должны откатывать параллельные изменения другого клиента.
6. /start одного пользователя не удаляет активные файлы другого.
7. Синхронные SQL/SMTP/Excel/SQLite операции не блокируют bot event loop.
8. Повтор callback после рестарта находит тот же durable operation, не создаёт второе перемещение.

## DBOT-01 — регистрация работ не имеет проверки доступа на входе

- **High / S**, новая находка.
- `bot/main.py:326` регистрирует entry по тексту «Работы»; `:389` добавляет этот ConversationHandler без общего user filter/middleware.
- `bot/handlers/work.py:306` start_work и `:663` confirmation обёрнуты только handle_errors. В модуле нет require_user_access/check_user_access.
- Для сравнения: `bot/handlers/start.py:21` и `bot/handlers/export.py:50` имеют require_user_access; `bot/handlers/transfer.py:428` также защищён.
- /start не является обязательным шагом протокола Telegram: текст кнопки можно отправить напрямую. В просмотренной registration chain общего предварительного access gate нет.
- DatabaseManager.get_user_database (`bot/database_manager.py:236`) возвращает ITINVENT по умолчанию; отсутствие назначенной БД само по себе не закрывает этот путь.
- Последствие: неразрешённый или уже исключённый пользователь потенциально проходит work flow до SQL/истории. Live Telegram acceptance не выполнялся; полный permission policy deployment не проверялся.
- Исправление: единый guard на доступных entrypoints и перед mutation; не считать существование меню доказательством авторизации. Не менять allowlist/сроки доступа побочным эффектом.
- Приёмка: запрещённый пользователь начинает сценарий прямым текстом, затем пытается callback → ни SQL, ни history write; отзыв доступа между preview и confirm также блокирует запись.

## DBOT-02 — ошибка SQL UPDATE превращается в успешную регистрацию работы

- **High / R** механизма.
- `bot/handlers/work.py:862` UPDATE/commit; `:871` exception лишь логируется; `:888` append истории; функция возвращает True.
- Аналогичные ветви: save_pc_cleaning `:943`, `:952`, `:970`; component replacement `:1247`, `:1256`, `:1275`.
- Caller `handle_work_confirmation:678` получает True и показывает «Данные успешно сохранены» (`:712`), хотя DESCR не обновлён.
- AST harness исполнил реальную save_battery_replacement без импортов runtime; SQL transport заменён с execute→RuntimeError, ledger — список в памяти. Результат: result=True, sql_failed=True, ledger_written=1. Exit=0; реальные данные не трогались.
- Обратная граница также неатомарна: UPDATE уже committed, затем append может не сохраниться. Нельзя исправить её одним catch/rollback после отдельного commit.
- Исправление: определить обязательность SQL и ledger; durable command/checkpoint с partial state и восстановлением, либо явный fail до успешного UI. Не автоматически повторять всю операцию после неизвестного commit.
- Приёмка: отказ execute/commit/ledger, crash между ними; UI сообщает точный исход, история не обещает несуществующий эффект и не дублируется при recovery.

## DBOT-03 — work confirmation заново выбирает БД вместо привязки к preview

- **High / S**, межбазовый сценарий не запускался.
- `bot/handlers/work.py:251` выбирает DB при поиске, `:286` сохраняет equipment в user_data. Подтверждение `:831`, `:911`, `:1211` снова берёт текущую БД пользователя.
- При изменении выбора БД между lookup и confirm локальный ID из A может примениться к одноимённому ID в B. В equipment payload не зафиксирован обязательный immutable db scope work-команды.
- В main зарегистрированы отдельные ConversationHandler управления БД и работами; фильтры work input исключают кнопки главного меню, позволяя другим entrypoints обрабатывать их. Полная UI-последовательность смены и возврата к старому inline confirm не выполнялась.
- Harness DBOT-02 дополнительно подтвердил, что реальная save-функция использует текущую B при переданном equipment ID=101; происхождение этого ID из A моделировалось.
- Исправление: сохранить source db_id с resolved equipment и operation ID; confirm либо использует этот scope, либо отклоняет смену контекста. Не подменять ID совпадением serial без нового подтверждения.
- Приёмка: preview A:101 → switch B → старый confirm не меняет B:101; правильный A-путь имеет историю с A.

## DBOT-04 — блокирующие SQL/SMTP и экспорт остаются в async обработчиках

- **Medium / S**, затраты подтверждены кодом, p95 не измерен.
- `work.py:822` async save выполняет синхронные pyodbc connection/execute/commit `:862`; подобные пути в `:943`, `:1247`.
- `export.py:460` напрямую вызывает send_export_email внутри async handler; `employee.py:364` делает то же для сотрудника.
- `bot/email_sender.py:248` задаёт SMTP timeout=30 в файловой отправке. Это ограничивает сетевое ожидание, но не переносит его из event loop; чтение файлов и MIME/base64 также синхронные.
- Существующие поисковые функции уже используют to_thread (`work.py:260`, `employee.py:105`); нельзя объявлять блокирующим весь поиск по одному sync helper.
- Исправление: переносить целый согласованный DB/SMTP этап в bounded executor/to_thread; не передавать открытый transaction между потоками. Ограничить admission для тяжёлых экспортов, не добавлять новый сервис.
- Приёмка: медленный synthetic SMTP/DB + независимый /help/cancel; измерить event-loop lag/queue wait и latency независимого update. Timeout и cancellation внешней операции должны сохранять unknown outcome.

## DBOT-05 — DESCR записывается из старого снимка без версии

- **Medium / S**.
- `work.py:836`, `:916`, `:1216` читают DESCRIPTION из сохранённого preview; UPDATE `:865` задаёт целиком DESCR по ID без сравнения исходного значения/rowversion.
- Параллельное изменение DESCR web-клиентом или другой работой после preview может быть затёрто старым текстом с одной новой пометкой.
- SQL-параметры bound, это не SQL injection. Ошибка находится в lost update семантике.
- Исправление: прочитать актуальную строку внутри короткой transaction с соответствующей блокировкой либо CAS по версии/старому значению; при конфликте reread/recompute, не overwrite stale payload.
- Приёмка: preview→добавление чужой заметки→confirm сохраняет обе; два разных work типа не уничтожают пометки друг друга; повтор одной команды идемпотентен.

## DBOT-06 — /start очищает общие temp-файлы всех пользователей

- **High / S**, удаление реальных файлов не выполнялось.
- `bot/handlers/start.py:54`, `:60` удаляет glob temp_transfer_*.jpg и temp_*.jpg в общем cwd, не ограничивая owner/operation/возраст.
- Transfer реально создаёт общий путь `bot/handlers/transfer.py:671` с file_id. Авторизация /start не означает владение чужими временными изображениями.
- Сценарий: A ждёт OCR/следующий шаг работы с временным изображением; B запускает /start → файл A удалён. Даже последовательная обработка Telegram updates не защищает durable многошаговый сценарий между сообщениями.
- Исправление: operation-specific temp directory, cleanup только собственных артефактов; общий age-based orphan cleanup вне request, с проверкой активных операций.
- Приёмка: две разные user/operation папки; reset B сохраняет файлы A; restart orphan cleanup не удаляет живой lease и корректно обрабатывает отсутствующие файлы.

## Повторная проверка прежних проблем

| Старый пункт | Текущее поведение | Проверка |
|---|---|---|
| CL-01: повтор после Telegram timeout | `transfer.py:137` TimedOut завершает цикл; RetryAfter повторяется отдельно | R: real AST send_document_with_retry, transport принял и потерял ответ; result=False, calls=1. Автоматического resend нет. |
| CL-05: переписывание всего журнала | `transfer_operation_store.py:74` load_one/save_one; `bot/local_json_store.py:27` keyed entry | S: O(history) замена отсутствует в этом пути. |
| SQLite checkpoint в event loop | `transfer.py:43` _journal вызывает asyncio.to_thread | S: изменено извне; не распространяется на work/SMTP. |
| SMTP без timeout | Основная файловая отправка имеет timeout=30 | Не повторять старое общее утверждение; test_connection остаётся отдельным helper без доказанного горячего caller. |
| DB+Telegram exactly-once | Есть durable sending и outcome_unknown | Это реальная защита, но не общая транзакция между системами. |

## Тесты, воспроизведения и ограничения

- Два AST harness в текущем продолжении завершились exit=0: SQL-error→success и TimedOut→one attempt. Заменены DB/Telegram transports и ledger; реальны control flow и условия функций.
- Стандартный bot suite не запускался: import bot.local_json_store создаёт глобальный store в data до отдельных monkeypatch. Для read-only аудита недостаточно предположить изоляцию только APP_DATABASE_URL.
- Прочитан `tests/test_bot_transfer_durability.py`; наличие сценариев не приравнивается к их запуску в этом проходе.
- Не проверены реальные update dispatch, Telegram membership revoke, recovery после Windows restart, отправка/скачивание актов и SQL Server transaction failures.
- Доступ по кэшу группы имеет положительный TTL 3600, explicit allowlist 86400 (`bot/utils/decorators.py:44`, `:58`). Это текущая политика, не автоматически баг; нужен согласованный срок применения отзыва и тест при его изменении.

## Ресурсные границы и план

| Ресурс | Наблюдение | Что измерить перед изменением |
|---|---|---|
| Update/event loop | Blocking stages DBOT-04 | p95 update, loop lag, independent-command delay |
| Export RAM | File bytes + MIME/base64 + dataframe | RSS, input rows/bytes, admission wait |
| Local journal | Keyed operation; events внутри записи накапливаются | Размер одной операции и длительность checkpoint, без неразрешённого retention |
| Temp media | Общий cwd и glob cleanup | Active bytes/operation, orphan count/age |
| Membership checks | TTL-cache, bounded Telegram timeout | Cache age и время применения revoke |

Приоритет: DBOT-01/02 → DBOT-03/06 → DBOT-05/04. Для каждого исправления сначала воспроизведение на boundary, затем минимальный diff и проверка итоговых SQL+ledger+bytes. Production отдельно.

Прочитаны релевантные части bot/main.py, handlers/start/work/transfer/export/employee/search.py, utils/decorators.py, cache_manager.py, database_manager.py, email_sender.py, local_json_store.py, services/transfer_operation_store.py и test_bot_transfer_durability.py. Из конфигурации не читались значения секретов.
Не заявлена полная проверка всех OCR/Excel форматтеров, универсального legacy DB слоя и каждого historical handler. Общие SQL-пулы и LLM gateway разобраны в отчётах 19 и 07.
