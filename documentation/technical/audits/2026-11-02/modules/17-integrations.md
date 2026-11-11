# 17. Voice/video, файловый egress, Bitrix и доступность исходников 1С

Продолжение: 2026-11-03. Только код/изолированные probes; production, GPU pipeline, внешние API и данные пользователей не запускались.
Итог: воспроизведены поздняя отмена молчащего Voice-подпроцесса и потеря pending при ошибке переноса egress. Один existing FS test упал на недоступном UNC stat; источник этой ошибки найден в рабочем пути monitor.

## Разделение контуров

| Подмодуль | API/UI → исполнение | Источник данных |
|---|---|---|
| Voice API | `voice_server/app.py:236` process job, `:383` retry, `:410` cancel | PostgreSQL voice_jobs, media/report files |
| Voice worker | `voice_server/worker_main.py:53` → `store.claim_next_job:169` → `runner.run_job:318` | Подпроцесс voice_video/run.py и GPU/CPU stages |
| Voice metadata/shares | `app.py:619`, `:638`, `:681` → pipeline/store | Meeting files + persisted metadata/grants |
| FS egress agent | `fs_egress/service.py:42` → monitor → spool → HTTP batch | Файлы pending/sent/dead_letter |
| FS ingest/read | `inventory_server/app.py:208`; `WEB-itinvent/backend/api/v1/fs_egress.py:42` | App PG либо SQLite compatibility store |
| Bitrix templates | `bitrix/chelovek-slova/index.php:1`, detail.php | Внешний Bitrix iblock 21, CMS runtime/assets |
| 1С расширения | Карта репозитория указывает integrations/1c | Каталог в текущем workspace пуст, tracked source отсутствует |

Voice API, worker и media-пайплайн — отдельные жизненные циклы. Пользовательский cancel меняет DB flag; реальная остановка зависит от supervisor subprocess. FS watcher теряет наблюдение раньше HTTP-приёмки, поэтому durable handoff из памяти в spool принципиален.

## Инварианты

1. Deadline/cancel проверяются независимо от активности stdout/stderr подпроцесса.
2. Один Voice job/base имеет согласованное владение выходными файлами и metadata.
3. После ACK egress события есть либо pending, либо подтверждённое хранилище; ошибка переноса не удаляет единственную копию.
4. Ошибка доступа к одному файлу не завершает наблюдение за всеми roots.
5. Переход из volatile pending в filesystem durable до удаления из памяти.
6. Production не переключает долговременное хранилище молча при временной ошибке PG.
7. Текущий репозиторий должен содержать исходники, которые документация считает частью воспроизводимого контура; внешние CMS/1С зависимости указываются явно.

## DINT-01 — blocking readline отключает своевременный deadline/cancel Voice

- **High / R** механизма; прежний известный класс проблемы уточнён текущим воспроизведением.
- `voice_server/runner.py:233` вызывает stdout.readline до proc.poll/cancel/deadline (`:245`, `:249`, `:255`).
- Подпроцесс может продолжать GPU/CPU работу без полной строки stdout. Readline блокирует supervisor; наличие config.job_timeout_sec не делает его реально применяемым в этот интервал.
- AST реальной _run_subprocess запускал только synthetic Python child `time.sleep(0.4)` с timeout=0.05 и cancel=True. Реальное измерение: elapsed=0.453 с, rc=-15, первый cancel check=0.453 с. Сетевых/GPU вызовов не было.
- Первый harness ошибочно ожидал rc=0; реальный порядок EOF/poll может дать rc=-15. После исправления проверялся правильный симптом: никакой cancel до окончания молчания; финальный exit=0.
- Не экстраполируется 0.4-секундный probe на production latency. Доказано отсутствие независимой проверки до выхода readline.
- Исправление: неблокирующий reader/отдельный thread с bounded queue и supervisor tick; deadline должен прекращать дерево процесса независимо от вывода. Логи bounded, без остановки контроля при переполнении.
- Приёмка: silent child, partial line без newline, stdout flood, зависший child, cancel и timeout; terminate/kill в bounded срок, final status соответствует причине и не оставляет orphan.

## DINT-02 — egress _move удаляет источник при неудачном переносе

- **High / R**, потеря единственной durable копии.
- `fs_egress/spool.py:118` _move ловит любую ошибку shutil.move и пытается src.unlink. Вызывается для dead-letter и sent (`:78`, `:89`, `:139`).
- Fault injection: реальный AST _move, synthetic pending.json во временном каталоге, shutil.move→OSError. Функция вернулась без ошибки; source_exists=False, dest_exists=False. Exit=0.
- Для sent HTTP мог уже принять событие, но для dead-letter никакой внешней durable копии может не быть. Нельзя считать один общий cleanup безопасным для обоих переходов.
- Исправление: atomic rename на одном volume либо copy+flush/verify+replace с удалением source только после успешного handoff. Ошибка оставляет pending и видимый счётчик; не объявлять dead/sent без факта переноса.
- Приёмка: отказ доступа/места/rename, существующая цель, повтор drain после crash; сохраняется хотя бы одна полная копия, status/metrics соответствуют факту.

## DINT-03 — PermissionError metadata завершает FS monitor после удаления pending из памяти

- **High / R+S**: ошибка is_file подтверждена существующим тестом, распространение до остановки — по caller trace.
- `fs_egress/events.py:139` path.is_file находится вне try. Следующий stat защищён, но первый вызов может поднять PermissionError/OSError.
- `fs_egress/monitor.py:143` удаляет due event из _pending до build_file_left (`:151`) и enqueue (`:158`).
- `fs_egress/service.py:71` вызывает flush_due без per-event catch; внешний finally останавливает monitor. Один недоступный/исчезнувший network file способен оборвать весь цикл и потерять уже вынутые due events.
- Existing test `tests/test_fs_egress_core.py:40` использует synthetic UNC `\\srv\share\a.pdf`. На этом Windows stat получил WinError 5; профиль: 5 passed, 1 failed. Реальные share credentials/данные не использовались. Этот UNC-тест повторно не запускался.
- Исправление: безопасное извлечение metadata с unknown size/hash при OSError; durable enqueue до удаления pending; bounded per-event retry/dead-letter и продолжение других событий.
- Приёмка: is_file/stat/open→PermissionError/FileNotFound; остальные due events доставлены, monitor остаётся жив; ошибка не превращается в ложный нулевой hash/успешную полноту без признака incomplete.

## DINT-04 — fail-open выбор SQLite кешируется после сбоя основного egress store

- **High / S**, реальный отказ PG не вызывался.
- `WEB-itinvent/backend/services/fs_egress_store_service.py:58` lru_cache(maxsize=1); `:59` get_egress_store ловит исключение PG-init и возвращает SQLite (`:74`) без APP_ENV guard.
- Header файла описывает SQLite как fallback для tests, но текущий runtime branch не ограничен тестовым окружением. При первом временном отказе PG instance SQLite остаётся закешированным до restart/cache_clear.
- Следствие: ingest и read могут расходиться между процессами/хранилищами; «пусто» в одном процессе не подтверждает отсутствие событий в другом. Не установлено, что fallback сейчас активен в production.
- Исправление: явно разрешённый dev/test fallback, production fail-closed и понятный health/error. Не делать автоматический перенос исторических rows без dry-run и согласования.
- Приёмка: production+synthetic PG init failure → отказ без создания SQLite; dev/test fallback только при явной политике; recovery не теряет ранее принятые события.

## DINT-05 — общая временная metadata-цель для параллельных Voice обновлений

- **Medium / S**, отдельный concurrency harness не подтвердил ожидание достаточно надёжно и не используется как R.
- `voice_server/pipeline.py:1008` save_meeting_web_meta формирует полный snapshot; `:1023` использует один `<meta>.tmp`, `:1025` пишет его, `:1026` replace. Межпроцессного lock/версии нет.
- Caller `voice_server/app.py:619` sync HTTP handler допускает параллельные запросы. Обновления одной meeting могут перезаписать общий staging, получить чужие bytes либо ошибку replace; полная stale-snapshot перезапись также теряет параллельные tags/project.
- Изолированный probe с monkeypatch Path.write_text не дал стабильного ожидаемого interleaving; помечен ограничением проверки, исходники не менялись.
- Исправление: уникальный temp + atomic replace, и отдельно version/CAS для семантики lost update. Уникальный temp один не решает конфликт редактирования полного snapshot.
- Приёмка: одновременно два edit с одной version → один conflict либо согласованный merge; каждый successful response соответствует сохранённым данным.

## DINT-06 — документы обещают исходники расширений 1С, которых нет в checkout

- **Medium / S**, пробел воспроизводимости/покрытия, не ошибка сервера 1С.
- `documentation/technical/REPOSITORY_MAP.md:83` показывает integrations/1c как исходники расширений/переходников. Фактический каталог пуст; git ls-files integrations/1c не возвращает файлов.
- Нельзя проверить BSL/XDTO реализацию, transaction semantics или повторную обработку на стороне информационной базы по Python-клиентам.
- Исправление документации/поставки: назвать точный внешний source/revision либо включить актуальный экспорт в согласованном формате. Не выгружать 1С и не подключаться к production без отдельного запроса.
- Приёмка: воспроизводимая версия расширения, entrypoints/контракты сопоставлены с Python client; отдельно тест реального test IB.

## Voice: проверено и не признано ошибкой

- `voice_server/store.py:169` первоначальный claim использует FOR UPDATE SKIP LOCKED. Этот initial claim не объявляется неатомарным.
- `worker_main.py:86` захватывает OS singleton lock до `requeue_interrupted`. Безусловный reset processing не называется доказанным double-worker при штатном одном data_dir. Разные data_dir/одна DB требуют отдельной эксплуатационной проверки.
- `runner.py:194` содержит kill process tree; проблема DINT-01 в достижимости вызова, не в полном отсутствии cancellation-кода.
- `pipeline.py:777` задаёт timeout ffmpeg trim; частный stage timeout не закрывает supervisor readline.
- `app.py:742` ZIP export имеет byte budget и удаление временного файла при exception; отсутствие любых лимитов экспорта не утверждается.

## Bitrix и 1С: точные границы

- Прочитаны три tracked файла bitrix/chelovek-slova: list/detail шаблоны и CSS. Это не исходники всего OneBoat voting backend.
- Iblock id=21, штатные GetList/GetNextElement/CFile и `htmlspecialcharsbx` для полей. Raw ~DETAIL_TEXT — CMS HTML contract; XSS не объявлен без модели права записи/типа поля.
- video URL строится в inline JS, общие animations/openModal приходят из внешнего CMS окружения. Allowlist URL, asset completeness, доступ и CMS permissions требуют проверки deployment/test CMS.
- Не запускались PHP runtime, CMS query plans, запись голосов, вопросы/таймауты OneBoat, SSH или деплой. Наличие шаблона в репо не доказывает его текущую публикацию.
- Warehouse 1C Python и Docflow разобраны в модулях 03/09; отсутствующий BSL source остаётся явным непроверенным слоем, не замещается их тестами.

## Ресурсы, сценарии и тесты

| Ресурс/сценарий | Текущее наблюдение | Приёмка/измерение |
|---|---|---|
| Voice silence/cancel | R позднего check | Deadline независим от logs, bounded process-tree stop |
| Voice log tail | store.append_log_tail читает/пишет tail на строку (`store.py:161`) | SQL time/queries per log line, batching на том же объёме |
| FS rate limiter | monitor.offer:129 увеличивает dropped при лимите | Явная неполнота и dropped counters; не обещать полное наблюдение |
| FS pending | Debounce в памяти, handoff после удаления | Fault injection build/enqueue; ни потерянных событий, ни бесконечного retry |
| Spool limit | prune до enqueue, dead-letter move | Disk bytes/age/count и сохранность при отказе destination |
| PG/SQLite split | DINT-04 | Fail-closed mode + single source of truth |
| Metadata edit | Shared temp/CAS отсутствует | Parallel update с финальной сверкой bytes/response |

Выполнен `python -m pytest -q tests/test_fs_egress_core.py`: **5 passed, 1 failed, 3 warnings, 0,95 с, exit=1**. Причина failed — UNC PermissionError из DINT-03; atexit pytest отдельно сообщил WinError 5 на старом pytest-current. Suite не объявляется зелёным.
R probes: _move fault и silent subprocess после уточнения assertions завершены exit=0. Metadata concurrency probe не даёт основания для R.
Тесты test_voice_server.py прочитаны выборочно, но не запускались: общий профиль включает больше helper/runtime imports и не нужен для уже изолированного supervisor сигнала.

## План

1. DINT-02/03 — надёжность handoff и непрерывность FS monitor; сначала controlled OSError test без UNC.
2. DINT-01 — независимый supervisor watchdog; silent/partial-line/flood тесты и проверка orphan cleanup.
3. DINT-04 — явный production storage policy и health, без неразрешённого переноса данных.
4. DINT-05 — уникальный staging и version conflict для meeting metadata.
5. DINT-06 — установить источник и ревизию BSL; продолжить реальную integration-приёмку только на test IB/CMS.

Прочитаны релевантные части voice_server/app/auth/config/store/runner/worker_main/pipeline.py; fs_egress/service/monitor/spool/events/roots.py; backend api/v1/fs_egress и services/fs_egress_store_service.py; inventory_server/app/egress_store.py; bitrix/chelovek-slova; tests/test_fs_egress_core.py и части test_voice_server.py.
Не охвачены построчно ML/диаризация/распознавание/лица во voice_video, все BSL (отсутствуют), весь внешний Bitrix/OneBoat и live root watcher. GPU/модельные бинарники не анализировались как исходный код.

## Дополнительный проход Voice — 3 ноября

Свежие [DVOICE-01…04](../CONTINUATION_VOICE_2026-11-03.md) дополняют этот модуль: перезапись done при гонке отмены, удаление разметки при активном aux job, отсутствие продвижения архиватора и невосстанавливаемая TTL-привязка после ошибки archive marker. Все четыре механизма воспроизведены изолированно; 1 High, 3 Medium, OPEN / R. Код не менялся. Существующий профиль worker/archiver: **7 passed, 58 deselected, 2 warnings**, exit 0; production и ML не запускались. Полные доказательства, границы и локальные артефакты приведены в дополнении.
