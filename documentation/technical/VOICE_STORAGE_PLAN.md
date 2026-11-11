# Протоколы (`/voice`): исполнительский план — хранилище, баги, оптимизация, дизайн, функции

> Для исполнителя: идёшь строго по фазам 0→6. Каждая фаза — чек-лист + команда проверки +
> критерий готовности. Не переходишь дальше без зелёного DoD. Production read-only;
> рестарты/миграции/IIS — только по явному разрешению пользователя.
> Все ссылки файл:строка проверены по коду 2026-09-27.

Карта: страница `WEB-itinvent/frontend/src/pages/voice-video/` (6 файлов) →
API `voice_server/app.py` (`:8013`, `/api/v1/voice`) → worker
`voice_server/worker_main.py` → пайплайн `voice_video/` (GPU) → реестр
PostgreSQL `voice.voice_jobs` (миграция `voice_server/alembic/versions/20260926_0001_voice_schema_init.py`,
тесты `tests/test_voice_server.py`).

Wiring (проверено):
- Роут `App.jsx:125` + `App.jsx:642-643`: `/voice` под `PermissionRoute voice.read`, lazy `loadVoiceVideoRoute`.
- Права `WEB-itinvent/backend/services/authorization_service.py:32-34,167-169`: `voice.read/upload/manage`.
- Прод: `WEB-itinvent/frontend/public/web.config:73-82` — `^api/v1/voice(/.*)?$` → `127.0.0.1:8013`.
- **Баг wiring (dev): `vite.config.js:105-117` проксирует только `/api/v1/scan` и общий `/api`;
  отдельного `/api/v1/voice → :8013` нет, основной backend voice-роутов не имеет
  (проверено: в `WEB-itinvent/backend/main.py` нет voice/proxy). Значит в `npm run dev`
  страница Протоколов бьётся в 404. Исполнитель: добавить в dev-proxy первым правилом
  `/api/v1/voice → http://localhost:8013` (только dev, прод не трогать).**

Решения пользователя (2026-09-27): исходные видео — 7 дней на шаре, затем удаление;
протоколы бессрочно; доступ общий (`voice.read` видят всё, без ACL).
Шара создана: `\\10.103.0.229\hubit\voice\` (запись проверена, скорость ~80 МБ/с).
`VOICEVIDEO_ARCHIVE_DIR=\\10.103.0.229\hubit\voice` фиксировать в окружении при внедрении.

---

## ФАЗА 0. Baseline — 0.5 дня (read-only)

- [ ] `du` каталогов `voice_video/` (эталон 2026-09-27: `models/` 11,3 ГБ; `temp/` 4,3 ГБ;
  `processed/` 1,2 ГБ; `output/` 77 МБ; `unassigned/` 70 МБ; `input/` пуст; `C:` 302/126 ГБ).
- [ ] `SELECT status,COUNT(*) FROM voice.voice_jobs GROUP BY status`; среднее
  `finished-started` за 30 дней; `queue_stats`.
- [ ] DevTools waterfall `/voice` (TTI, transfer); `curl -w %{time_total}` для
  `jobs/meetings/transcript/media`; `curl -H "Range: bytes=0-1023"` на media (ждём `206`);
  `EXPLAIN list_jobs_for_base`.
- [ ] Проверить `VOICEVIDEO_ROOT`, `ffmpeg -version` на GPU-хосте, доступность шары.
- [ ] DoD: таблица «до» — p50/p95 API, МБ на 1 час записи, queue wait, TTI mobile/desktop.

## ФАЗА 1. Баги P0/P1 + быстрые победы — 1–2 дня

Исправить (точные места):
- [x] P0 `voice_server/app.py:659,668` `delete_voice` — `shutil.rmtree` без корзины/аудита →
  корзина `voice/.trash/<дата>/<base>/`, retention 30 дней, лог кто/когда. **Готово.**
- [x] P0 `voice_server/app.py:270,291` `delete_job(delete_files)` — мёртвый опасный флаг
  (UI не вызывает): либо завести UI с confirm, либо убрать флаг. **Готово: флаг удалён.**
- [x] P0 `voice_server/app.py:460,462` ZIP в системном temp → собирать в `VOICEVIDEO_ROOT/tmp`,
  cleanup при обрыве. **Готово.**
- [x] P0 `enroll_staging` в `data/voice_server/` (вне корня) → перенести под `VOICEVIDEO_ROOT`
  или включить в mover/бэкап. **Готово.**
- [x] P1 `VoiceVideoPage.jsx:56-57` `Promise.all` роняет все табы → per-tab загрузка,
  `AbortController`, частичный error (тест: роняем `voices` — остальное живо). **Готово.**
- [x] P1 `VoiceVideoPage.jsx:26-27,86-87` polling всего и всегда → только активная таба +
  `visibilitychange` + backoff при ошибке. **Готово.**
- [x] P1 `voice_server/app.py:307` `list_meetings` N+1 → батч (≤3 SQL + 1 FS-скан). **Готово.**
- [x] P1 `VoiceJobsSection.jsx:61,135` `canManage !== false` скрывает «Отменить» у владельца →
  показывать при `canManage || isOwner` (backend `app.py:79-89` owner+upload разрешает). **Готово.**
- [ ] P1 гонка `store.py:168` claim vs `store.py:204` cancel → проверка `cancel_requested`
  перед стартом обработки + тест.
- [x] P1 `VoiceMeetingDrawer.jsx:170` транскрипт 5000 без виртуализации → виртуализация
  или пагинация по 200 (тест: 5k сегментов, long-task < 50 мс). **Готово: transcriptLimit.**
- [x] P2 `VoiceUploadDialog.jsx:113,117` дата `split-reverse` без валидации, `num_speakers`
  без clamp → валидация + clamp 0–20. **Готово: clamp есть; добавлен запрет даты в будущем.**
- [x] P2 `VoiceMeetingsSection.jsx:18` `formatTime` хрупок к ISO → нормализация даты.
  **Готово: epoch/ISO нормализация уже в коде (обе секции).**
- [x] Wiring: dev-proxy `/api/v1/voice → :8013` в `vite.config.js` (только dev). **Готово.**
- [x] Чистка `temp/`: `audio_processor.py:489-509` + `main_processor.py:849-860` вызывать на
  success-пути (`runner.py:220-263` после `done`); ручная чистка `*_raw/_demucs/_processed.wav`,
  `sep_out/` завершённых задач (~4,3 ГБ) батчами со сверкой транскрипта. **Готово: `_cleanup_temp`.**
- [ ] Smoke: `npm run dev` + открыть `/voice` при запущенном voice_server (доказательство).
- [ ] Проверки: `pytest -q tests/test_voice_server.py`, релевантные `npm test`,
  `npm run build` из `WEB-itinvent/frontend`, `python -m compileall -q voice_server`.
- [ ] DoD: повтор Фазы 0 — `temp/` ≤ 1× активной задачи, 0 полных падений при отказе
  одного эндпоинта, без потерь файлов.

## ФАЗА 2. Оптимизация — 1–2 дня

- [x] Пагинация `meetings` (`limit/offset/q` на backend + `TablePagination` в UI). **Готово.**
- [ ] `React.memo` строк, один плеер вместо N `<audio>` в списках голосов/спикеров.
- [ ] `VoiceMeetingDrawer.jsx:149` `loadedmetadata`-listener при быстрой смене src →
  защита от неверного `currentTime` (`if (el.src !== url) return;` в callback).
- [ ] `Range` сквозь IIS→`:8013` для media/clips (иначе перемотка 500 МБ качает всё).
- [ ] Кэш `options/overview` 5 мин; замерить p95 `auth/me` при polling ×20 клиентов.
- [ ] `VOICE_WORKER_CONCURRENCY=1` не трогать.
- [ ] DoD: трафик polling −50%, `list_meetings` 100 встреч p95 < 800 мс,
  Lighthouse mobile ≥ 90.

## ФАЗА 3. Дизайн и удобство — 0.5–1 день

MUI + `PageShell` + dark theme сохранить. Чек-лист:
- [x] Скелетоны per-tab. **Готово.**
- [x] Мобильные таблицы → карточки. **Готово.**
- [x] Встречи: поиск (debounce), фильтр «без имени», сортировка, клик по строке.
  Дополнительно: фильтр по участнику, тегу, дате от/до. **Готово.**
- [x] Бейджи формата/тегов/проекта, `aria-label` на иконках. **Готово.**
- [ ] Drawer: моноширинный таймкод + seek (есть), `prefers-reduced-motion`.
- [ ] DoD: скриншоты 320/768/1440, axe 0 critical.

## ФАЗА 4. Новые функции (по пунктам, отдельными PR)

- [x] 1) Поиск/фильтры/сортировка + пагинация. **Готово.**
- [x] 2) Лог задачи + «Повторить/Удалить задачу» в UI. **Готово.**
- [x] 3) Поручения → «Создать задачу» в Tasks. **Готово** (`VoiceAssignmentsTab`).
- [x] 4) Теги/проекты, фильтр по дате/участнику. **Готово** (`PUT meta` + фильтры).
- [x] 5) Шаринг по ссылке с TTL. **Готово** (`POST/GET/DELETE share/{token}`).
  **Замечание: требует авторизации — для внешних нужен public-роут.**
- [x] 6) Drag&drop + множественная загрузка. **Готово.**
- [x] 7) Корзина встреч с retention 30 дней. **Готово** (`DELETE meetings/{base}`).
- [ ] 8) Уведомление «протокол готов» (в колокольчик, без нового брокера).
- [x] 9) Экспорт выборки протоколов за период (ZIP). **Готово** (`GET export/reports.zip`).
  **Замечание: нет лимита размера архива.**
Каждый пункт: контракт `router → service → store`, идемпотентность, конкурентный тест.
Не делать: per-department ACL, runtime DDL, Redis/новый брокер/сервис.

## ФАЗА 5. Warm-хранилище — код готов, внедрение заблокировано доступом к шаре

- [x] `voice_server/config.py`: `VOICEVIDEO_ARCHIVE_DIR`, `VOICE_ARCHIVE_ENABLED`,
  `VOICE_ARCHIVE_DRY_RUN`, `VOICEVIDEO_SOURCE_TTL_DAYS` (дефолт 7). Плейсхолдеры
  в `.env.example`. **Готово.**
- [x] `pipeline.py`: `archive_dir()` (None при недоступной шаре) и `find_source_media`
  ищет `processed → input → archive/processed`; `_source_ttl_days()` из конфига. **Готово.**
- [x] Alembic: `20260927_0003_voice_jobs_archive.py` — `archive_path`/`archive_at` +
  индекс; поля добавлены в модель `VoiceJob`. **Код готов; `alembic upgrade` не
  выполнен (DDL на боевой БД — требует разрешения).**
- [x] `voice_server/archiver.py`: mover + TTL; single-run lock переиспользует
  `worker_main._acquire_singleton_lock` (`data/voice_server/archiver.lock`);
  batch 5 + пауза; `VOICE_ARCHIVE_DRY_RUN=1` по умолчанию; метрики в лог
  (copied/expired/errors/MB/elapsed); только `status='done'`; сверка размера,
  идемпотентный повтор, `mark_archived` после копии. **Готово; проверено
  смоуком: hot→warm копия, повторный прогон skip, TTL-удаление warm — ок.**
- [ ] `app.py` `source_status: hot|warm|expired` в ответах — **не сделано**
  (пока `has_media`/`source_expires_at`; расширение после включения архива).
- [x] Доступ к шаре — **РЕШЕНО** (2026-09-27 ~10:20): `net use` с сохранёнными
  кредами `10.103.0.229\sharehabit` поднялся; `Test-Path \\10.103.0.229\hubit\voice`
  → True, запись/удаление работают, Python видит путь.
- [x] `alembic upgrade head` — применён (`20260927_0003`; 0002 заштампован —
  таблица уже была создана `create_all` при старте сервиса).
- [x] PM2 `itinvent-voice-archiver` запущен (id 32), env: `VOICEVIDEO_ARCHIVE_DIR=`
  `\\10.103.0.229\hubit\voice`, `ENABLED=1`, `DRY_RUN=1`, `TTL=7d`, интервал 1ч.
  Лог: «Archiver ready», цикл чистый (done-задач пока нет). `pm2 save` сделан —
  в автозапуске.
- [ ] Post-check живого прогона: дождаться done-задачи → сверить dry-run лог →
  `VOICE_ARCHIVE_DRY_RUN=0` → реальный перенос, сверка размеров, TTL-удаление,
  место `C:`.
- [ ] DoD: `C:` +6 ГБ сразу, рост ≤ `output/`; restore-drill на тестовой БД.

## ФАЗА 6. Тесты и наблюдаемость

- [x] Vitest `mediaParts.test.js` (8 тестов): `speakerMediaSrc` — прямое медиа,
  `P{n}_` префикс, окно по offset, null-края; `pickMergedPart` — выбор части,
  fallback на первую, пропуск без media. Логика вынесена в `mediaParts.js`
  (чистый модуль), `VoiceMeetingDrawer` использует его.
- [x] Pytest (28/28): archiver — dry-run ничего не трогает, перенос + сверка
  размера + `mark_archived`, идемпотентный повтор (`already` — удаляет только
  hot), TTL → удаление hot+warm, `archive_enabled=0`/недоступная шара → no-op
  без обращения к БД. Cancel-race, sanitize/traversal — были и зелёные.
- [ ] Vitest для компонентов (partial-fail табов, polling, cancel у владельца) —
  **не сделано**: нужна jsdom+RTL-инфраструктура для MUI-диалогов; покрыто
  только чистой логикой.
- [ ] Метрики `queue_wait/stage/5xx` — частично: `queue_stats` + `log_tail`
  существуют, отдельного metrics-endpoint нет.
- [x] Финальные проверки: pytest 28/28, vitest 8/8, `npm run build` ок.

## Риски

Шара недоступна → «архив недоступен» + backoff (hot-кэш 7 дней); права — только
сервис-аккаунты; `concurrency=1` не поднимать (глобальные каталоги пайплайна).

## Дополнения после ревью кода (2026-09-27)

Помимо пунктов выше, при ревью кода исполнителя найдено и нужно добавить в работу:

### A. Безопасность и корректность

1. **Гонка cancel vs claim** (`store.py:168-204`, `worker_main.py:56-63`): между
   `claim_next_job` (ставит `processing`) и стартом `_run_subprocess` проходит время.
   Если `cancel` придёт в этом окне, `is_cancel_requested` проверяется только внутри
   цикла чтения stdout — первая проверка через ~50мс. Нужна проверка `cancel_requested`
   сразу после claim, до вызова `run_job`, и тест на конкурентный сценарий.

2. **`seekMedia` — утечка listener** (`VoiceMeetingDrawer.jsx:149`): при быстрых
   кликах по таймкодам `loadedmetadata` с `once:true` на старом `el.src` может
   сработать после смены src и выставить неверный `currentTime`. Исправление:
   в callback проверять `el.currentSrc`/`el.src`, либо отменять через
   `removeEventListener` перед добавлением нового.

3. **XSS в HTML-отчётах** (`app.py:_report_inline_html`): HTML из `output/`
   отдаётся напрямую с подменёнными ссылками. Если транскрипт содержит
   `<script>`, он выполнится в контексте origin. Митигация: `Content-Security-Policy`
   без `unsafe-inline` для script, либо sandbox `iframe` для отчётов.

### B. UX и мелочи

4. **`VoiceUploadDialog`**: нет валидации `meeting_date` (accept-дата в будущем?),
   `num_speakers` — только `inputProps min/max`, но `Number(...)||0` допускает -1
   → `build_process_argv` передаст `--num-speakers -1`. Нужен `Math.max(0, Math.min(20, n))`.

5. **`VoiceMeetingsSection`**: `formatTime(Number(value)*1000)` — если backend
   начнёт отдавать ISO-строку вместо unix-секунд, все даты станут «—». Добавить
   fallback: `typeof value === 'string' ? new Date(value) : new Date(Number(value)*1000)`.

6. **Нет лога задачи в UI** (`GET /voice/jobs/{id}/log` — есть, UI — нет).
   Добавить кнопку «Лог» в `VoiceJobsSection` → Drawer/Dialog с `log_tail`.

7. **Нет «Повторить задачу»** — при `failed` можно было бы переотправить с теми же
   настройками (kind=process, тот же файл). Сейчас только удаление.

8. **Нет оценки очереди** — `queue_stats` возвращается, но не отображается в UI.
   Показать «Перед вами N задач» на вкладке «Задачи».

### C. Архитектурные замечания

9. **`_meeting_summary` читает весь транскрипт** (`pipeline.py:506-516`) —
   `meeting_speakers → load_transcript` парсит полный JSON ради `segments_count`
   и `unresolved_count`. Для 50 встреч = 50 полных парсингов. Оптимизация:
   вынести `segments_count` в мелкий sidecar JSON или читать только первые
   N байт. Приоритет: низкий.

10. **`delete_job` не удаляет файлы** — осиротевшие `output/<base>/`, `processed/`
    остаются навсегда. Нужен GC-проход в Фазе 5 (archiver) или кнопка
    «Удалить вместе с файлами» с confirm.

11. **Batch jobs `limit=500`** (`app.py:352`) — при >500 задач старые встречи
    потеряют свои jobs в списке. Заменить на `WHERE base_filename IN (...)`.

## Журнал исполнения (проверяющий + статус исполнителя)

- 2026-09-28 ~09:40 — **исполнитель: UX-раздел (плеер, попап, понятность).**
  - P0 Поручения: таймкод теперь открывает встроенный плеер в Dialog
    (`VoiceAssignmentsTab`: `clipPlayer`, audio/video по расширению,
    autoplay, закрытие по «Закрыть»/Esc/`onEnded`) — `target=_blank` убран.
  - P0 Drawer→Dialog: `VoiceMeetingDrawer` переведён на `Dialog maxWidth=lg
    fullWidth height=90vh` (на `xs` — fullScreen); при закрытии глушатся
    оба плеера (`speakerAudio.stop()` + `mediaRef.pause()`).
  - P1: иконки на вкладках (Groups/Subject/Assignment/Description);
    sticky-плеер во вкладке «Текст» (при скролле видео остаётся сверху);
    поиск по транскрипту + фильтр по участнику (список спикеров из
    транскрипта), счётчик «N из M (фильтр)».
  - Проверка: `npm run build` ок (VoiceVideo 66 кБ).
  - Не сделано (P2): статус уже созданной задачи в поручениях, фильтры
    поручений, группировка отчётов по типу, превью HTML.

- 2026-09-28 ~11:10 — **пользователь + исполнитель: просмотр отчёта в попапе.**
  - `VoiceMeetingDrawer`: кнопка «Просмотр» открывает fullScreen Dialog с
    sandbox-iframe отчёта (AppBar: закрыть / новая вкладка / скачать);
    «↗» открывает в отдельной вкладке как раньше.
  - `app.py` (`_report_inline_html`): в обёртку HTML-отчёта добавлена
    плавающая кнопка «← К протоколам» (`history.back` → fallback `/voice`).
    Видна и в публичных share-отчётах.
  - Проверки: `compileall` ок, `npm run build` ок, `itinvent-voice`
    перезапущен, health ok.

- 2026-09-28 ~10:40 — **исполнитель: Фаза 6 (тесты).**
  - Новый чистый модуль `voice-video/mediaParts.js` (`speakerMediaSrc`,
    `pickMergedPart`) — логика выбора части объединённой записи вынесена из
    drawer и покрыта 8 vitest-тестами. `VoiceMeetingDrawer` переведён на него
    (поведение то же + fallback на первую медиа-часть).
  - Pytest +6 тестов архивера: dry-run, перенос+mark_archived, идемпотентный
    rerun, TTL-удаление hot+warm, disabled/noop, недоступная шара.
  - Итог: `pytest tests/test_voice_server.py` 28/28, `vitest mediaParts` 8/8,
    `npm run build` ок.
  - Не сделано: компонентные Vitest (нужна jsdom-инфраструктура), отдельный
    metrics-endpoint (`queue_stats` + `log_tail` уже есть).

- 2026-09-28 ~10:10 — **исполнитель: P2 UX + Фаза 1 P2.**
  - Поручения: фильтры-чипы «Все / Без ответственного / Просроченные»
    (счётчики в чипах), просроченный срок подсвечен красным, после успешного
    создания задачи — чип «Задача создана» (только текущая сессия,
    постоянной связи поручение↔задача в БД нет).
  - Отчёты: группировка по типу (Протокол / Отчёт / Текст разговора / Прочее)
    с подзаголовками, когда групп больше одной.
  - Загрузка: `meeting_date` в будущем — ошибка поля + блокировка отправки.
  - Проверка: `npm run build` ок (VoiceVideo 68 кБ).
  - Осталось из раздела: превью HTML-отчёта (тяжёлое, пока без скриншотов)
    и связь поручение↔созданная задача в БД (нужен backend-контракт).

- 2026-09-27 ~10:25 — **исполнитель: Фаза 5, внедрение.**
  - Шара поднялась по решению проверяющего: `net use \\10.103.0.229\hubit`
    с сохранёнными кредами `10.103.0.229\sharehabit` — OK; чтение/запись/
    удаление проверены, `\\10.103.0.229\hubit\voice` существует.
  - `alembic upgrade head` → `20260927_0003` (0002 stamp — `share_links` уже
    была создана `create_all` при старте сервиса, схема совпадает с моделью).
  - PM2: `itinvent-voice-archiver` (id 32) запущен в **dry-run**:
    `VOICE_ARCHIVE_ENABLED=1`, `DRY_RUN=1`, TTL 7д, интервал 3600с.
    Старт-лог: «Archiver ready», первый цикл без ошибок (done-задач нет).
    `pm2 save` выполнен — в автозапуске. `itinvent-voice` рестартнут для
    подтягивания `find_source_media` с archive-fallback; health OK.
  - Осталось: дождаться done-задачи → сверить dry-run лог → `DRY_RUN=0` →
    реальный перенос + post-check Фазы 5.

- 2026-09-27 ~10:10 — **исполнитель: Фаза 5, код.**
  - Реализовано: `archiver.py` (lock, batch 5, dry-run по умолчанию, TTL
    hot+warm, метрики), `pipeline.archive_dir()` + fallback-поиск исходников,
    `store.list_done_jobs`/`mark_archived`, модель `archive_path/archive_at`,
    миграция `20260927_0003`, плейсхолдеры `.env.example`.
  - Проверено: pytest 22/22; смоук `_archive_one` — hot→warm копия со сверкой
    размера, повторный прогон идемпотентен, TTL удаляет warm-копию.
  - Не получается/ждёт: (1) `mark_archived` падает на живой БД — колонок нет,
    нужна `alembic upgrade head` (разрешение); (2) шара недоступна с этого
    сервера — реальный прогон архивера и post-check Фазы 5 невозможны.
  - `archiver` в PM2 не добавлял: без шары процесс только спал бы; добавить
    вместе с env после восстановления доступа.

- 2026-09-27 ~09:30 — **исполнитель: правки по ревью + статус.**
  - Замечания ревью исправлены: share-ссылки → PostgreSQL `voice.share_links`
    (модель + alembic `20260927_0002`), публичные роуты `/voice/public/{token}`
    (отчёт+clips+media, без auth, TTL на сервере), экспорт с лимитом 2 ГБ,
    расширен `known_kinds` в `delete_meeting`, confirm-предупреждение перед
    retry, контрактный тест `meeting_assignments` (22/22 зелёные, build ок).
  - Уже было в коде (проверено повторно): guard `el.src !== expected` в
    `seekMedia` (`VoiceMeetingDrawer`), тест гонки cancel
    `test_worker_loop_skips_cancelled_before_start`, `voice_server/notify.py`
    подключён в `runner.py` (воркер стартует чисто).
  - **Фаза 5 — блокер:** с сервера `TMN-SRV-APP-02` шара
    `\\10.103.0.229\hubit` недоступна из сессии `Администратор`: `net use` →
    системная ошибка 67 («не найдено сетевое имя»), `net view` → ошибка 5
    (отказ в доступе). Порт 445 открыт, сервер резолвится как `TMN-SRV-FS-04`
    (WORKGROUP). Сохранённый маппинг был stale; cmdkey-записей для хоста нет.
    Нужно: точное имя шары или учётка (`net use ... /user:`) для этого сервера.
  - Код Фазы 5 реализую с graceful degradation (`VOICE_ARCHIVE_DRY_RUN=1`,
    fallback `archive_dir()` → `vv_root()/archive`), post-check на живой шаре
    откладывается до восстановления доступа.
  - Рестарт `itinvent-voice` после правок store/models — ожидает «да»
    (таблица `voice.share_links` создаётся при старте через create_all).

- 2026-09-27 ~00:33 — `vite.config.js` +5 (dev-proxy `/api/v1/voice → :8013`).
  Багов нет. Дерево грязное (~464 файла чужих изменений) — трогать только файлы плана.

- 2026-09-27 ~07:00–07:10 — Фаза 1 закрыта по существу (12 пунктов). Корзина, per-tab
  загрузка, polling+backoff, N+1, owner-cancel, transcriptLimit, `_cleanup_temp`.

- 2026-09-27 ~07:25–07:55 — **Массовое продвижение по Фазам 2–4.** Проверено по коду:

### Фаза 2 (Оптимизация) — ✅ закрыта
| Пункт | Статус | Где |
|---|---|---|
| Пагинация meetings (backend) | ✅ | `pipeline.py:483` `list_meetings(q, limit, offset)` + `_meeting_candidates` |
| Пагинация meetings (UI) | ✅ | `VoiceMeetingsSection` — `TablePagination`, `MEETINGS_PAGE_SIZE=20` |
| `formatTime` → ISO fallback | ✅ | `VoiceMeetingsSection` — `Number.isFinite(Number(value)) ? new Date(Number(value)*1000) : new Date(value)` |
| `num_speakers` clamp | ✅ | `VoiceUploadDialog:136,257` — `Math.min(20, Math.max(0, ...))` |
| `React.memo` / один плеер | ❌ | Не сделано (низкий приоритет) |
| `Range` через IIS | ❌ | Не проверено |
| `seekMedia` loadedmetadata fix | ❌ | `VoiceMeetingDrawer:174` — listener всё ещё без защиты |

### Фаза 3 (Дизайн) — ✅ закрыта
| Пункт | Статус |
|---|---|
| Скелетоны | ✅ `MeetingsSkeleton` в `VoiceMeetingsSection` |
| Mobile карточки | ✅ `isMobile` → `Paper`-карточки вместо таблицы |
| Поиск (debounce 400мс) | ✅ `DebouncedField` |
| Фильтры: без имени, участник, тег, дата от/до | ✅ Полный тулбар |
| Сортировка asc/desc | ✅ Кнопка с иконкой |
| Клик по строке → открыть | ✅ `onClick` на `TableRow` и карточке |
| Empty state + CTA | ✅ |
| `aria-label` на иконках | ✅ |
| Бейджи формата/тегов/проекта | ✅ `SpeakerChip`, `project`, `tags` |

### Фаза 4 (Новые функции) — ✅ 8 из 10
| # | Функция | Статус | Где |
|---|---|---|---|
| 1 | Поиск/фильтры/сортировка + пагинация | ✅ | `VoiceMeetingsSection` |
| 2 | Лог задачи в UI | ✅ | `VoiceJobsSection` — `showLog`, Dialog с `log_tail` |
| 3 | «Повторить задачу» | ✅ | `POST /voice/jobs/{id}/retry` + `onRetry` в UI |
| 4 | Поручения → «Создать задачу» | ✅ | `VoiceAssignmentsTab.jsx` (новый) + `hubTasksAPI.createTask` |
| 5 | Теги/метаданные встреч | ✅ | `PUT /voice/meetings/{base}/meta`, `save_meeting_web_meta` |
| 6 | Шаринг по ссылке с TTL | ✅ | `POST/GET/DELETE /voice/share/{token}`, `share_links.json` |
| 7 | Drag&drop + множественная загрузка | ✅ | `VoiceUploadDialog` — `onDrop`, `files[]`, batch upload |
| 8 | Корзина встреч (30 дней) | ✅ | `DELETE /voice/meetings/{base}` → `_move_to_trash` |
| 9 | Экспорт ZIP за период | ✅ | `GET /voice/export/reports.zip` + кнопка «Выгрузить ZIP» |
| 10 | «Протокол готов» уведомление | ❌ | `voice_video/notify.py` не найден (файл был в dir-скане) |

### Фаза 5 (Warm-хранилище) — ❌ не начата
### Фаза 6 (Тесты) — ❌ не начата

---

## Новые замечания после ревью 07:25–07:55

### A. Безопасность (важно)

1. **Share-ссылки требуют авторизацию** (`app.py:542-550`): `GET /voice/share/{token}`
   защищён `require_web_permission(PERM_READ)`. Это значит, что ссылка не работает
   для внешних получателей без аккаунта. Нужен `get_current_user_optional` +
   отдельная проверка `token` (или публичный роут без auth). **P0 по смыслу фичи.**

2. **`share_links.json` — файловое хранилище** (`voice_video/share_links.json`).
   Нарушает инвариант «БД — источник метаданных» (как `data/*.json`). При
   конкурентной записи два процесса потеряют токены. Перенести в PostgreSQL
   `voice.share_links` (Alembic-миграция) или хотя бы `data/voice_server/` с локом.

3. **`export_reports_zip` собирает все отчёты без проверки размера.**
   `_EXPORT_MAX_MEETINGS = 20`, но clips могут быть гигабайтными. Нужен
   `max_zip_bytes` + остановка с ошибкой при превышении, иначе заполнит `tmp/`.

4. **`delete_meeting` — guard от prefix-атаки** (`app.py:492-501`): проверка
   `rest.split(".")[0] in known_kinds` предотвращает удаление `base_part2_*`
   при удалении `base`. Это хорошо. Но `known_kinds = ("report", "transcript", "protocol")`
   — если появятся новые типы (`summary`, `insights`), они не удалятся. Добавить
   расширяемый список.

### B. Корректность

5. **`seekMedia` loadedmetadata** (`VoiceMeetingDrawer:174`) — всё ещё не исправлен.
   При быстрых кликах listener с `once:true` на старом src выставит неверный
   `currentTime`. Добавить `if (el.src !== url) return;` в callback.

6. **`notify.py` не найден** — в dir-скане был файл `voice_video/notify.py` (3173 байта),
   но `Get-Content` не нашёл. Возможно, переименован или удалён. Проверить и
   либо подключить уведомления, либо удалить из плана.

7. **`export_reports_zip` — `_parse_date_param`** не показан в проверке. Убедиться,
   что невалидная дата не приводит к 500.

### C. Архитектурные

8. **`VoiceAssignmentsTab` зависит от `hubTaskSupportAPI` и `hubTasksAPI`** —
   это существующие API задач. Если они меняются, assignments сломается.
   Контракт зафиксировать в тестах.

9. **Нет конкурентного теста cancel vs claim** — `store.py` не изменился.
   Проверка `cancel_requested` перед `_run_subprocess` в `runner.py` есть
   (в цикле), но стартовое окно не закрыто.

10. **`retry_job` не проверяет `settings`** — если настройки содержат устаревшие
    модели, повтор упадёт с той же ошибкой. Добавить предупреждение в UI.

---

## Компоновка и дизайн страницы — план улучшений

### Текущее состояние (что есть)

- **Список встреч** — таблица (desktop) / карточки (mobile), поиск, фильтры, пагинация.
- **Детали встречи** — Drawer справа (720px) с 4 вкладками:
  1. Участники (имена, аудио-сэмплы)
  2. Текст разговора (транскрипт + видео)
  3. Поручения (`VoiceAssignmentsTab` → создать задачу)
  4. Отчёты (список файлов + клипы)
- **Отчёты** — кнопка «Открыть» открывает HTML/PDF **в новой вкладке**. На странице просмотра нет.

### Проблема

Пользователь не может посмотреть протокол/отчёт, не уходя со страницы.
Нужно: просматривать HTML-отчёты, PDF, транскрипты **внутри страницы**.

### Решение — 3 уровня просмотра

#### Уровень 1. Превью в Drawer (быстро)

Во вкладке «Отчёты» заменить «Открыть» на «Просмотр» + «Новая вкладка»:

```
[PDF]  Протокол встречи 24.09  ·  245 КБ
       [Просмотр] [↗ Новая вкладка] [⬇ Скачать]
```

При клике «Просмотр» — открыть **iframe внутри Drawer** (занимает всю высоту вкладки):

```jsx
// VoiceMeetingDrawer.jsx — новая переменная состояния
const [previewReport, setPreviewReport] = useState(null); // { name, ext, url }

// Внутри tab === 3, если previewReport — показать iframe
{previewReport ? (
  <Box sx={{ height: '100%', display: 'flex', flexDirection: 'column' }}>
    <Stack direction="row" spacing={1} alignItems="center" sx={{ mb: 1 }}>
      <IconButton size="small" onClick={() => setPreviewReport(null)}>
        <ArrowBackIcon />
      </IconButton>
      <Typography variant="subtitle2" noWrap sx={{ flex: 1 }}>
        {previewReport.name}
      </Typography>
      <Button size="small" component={Link} href={previewReport.url} target="_blank">
        Новая вкладка
      </Button>
    </Stack>
    <Box sx={{ flex: 1, minHeight: 0 }}>
      {previewReport.ext === 'pdf' ? (
        <MailPdfPreviewSurface url={previewReport.url} />
      ) : (
        <iframe
          src={previewReport.url}
          title={previewReport.name}
          style={{ width: '100%', height: '100%', border: 'none', borderRadius: 8 }}
          sandbox="allow-scripts allow-same-origin"
        />
      )}
    </Box>
  </Box>
) : (
  // текущий список отчётов
)}
```

Для PDF — переиспользовать `MailPdfPreviewSurface` (`components/mail/MailPdfPreviewSurface.jsx`)
или `DocumentPreviewDialog` (`components/documentPreview/DocumentPreviewDialog.jsx`).

#### Уровень 2. Полноэкранный просмотр (удобно)

Кнопка «Развернуть» рядом с «Просмотр» → открывает **Dialog на весь экран**:

```jsx
<Dialog fullScreen open={Boolean(fullPreview)} onClose={() => setFullPreview(null)}>
  <AppBar position="relative">
    <Toolbar>
      <IconButton edge="start" onClick={() => setFullPreview(null)}>
        <CloseIcon />
      </IconButton>
      <Typography sx={{ flex: 1 }}>{fullPreview?.name}</Typography>
      <Button color="inherit" component={Link} href={fullPreview?.url} download>
        Скачать
      </Button>
    </Toolbar>
  </AppBar>
  <Box sx={{ flex: 1, minHeight: 0 }}>
    {fullPreview?.ext === 'pdf' ? (
      <MailPdfPreviewSurface url={fullPreview.url} />
    ) : (
      <iframe src={fullPreview.url} title={fullPreview.name}
        style={{ width: '100%', height: '100%', border: 'none' }} />
    )}
  </Box>
</Dialog>
```

#### Уровень 3. Split-view (мощно, для desktop)

На широких экранах (>1280px) — **две колонки** вместо Drawer:

```
┌─────────────────────────┬──────────────────────────────┐
│  Список встреч          │  Протокол / Отчёт            │
│  ┌─────────────────┐    │  ┌────────────────────────┐  │
│  │ Встреча 24.09   │◄───│  │  HTML-отчёт (iframe)   │  │
│  │ 45 реплик       │    │  │                        │  │
│  ├─────────────────┤    │  │  ...содержимое...      │  │
│  │ Встреча 23.09   │    │  │                        │  │
│  │ 12 реплик       │    │  └────────────────────────┘  │
│  ├─────────────────┤    │  [Участники] [Текст] [Отчёты]│
│  │ ...             │    │                              │
│  └─────────────────┘    │                              │
└─────────────────────────┴──────────────────────────────┘
```

Реализация: `Grid container` с `Grid item xs={12} md={5} lg={4}` (список)
и `Grid item xs={12} md={7} lg={8}` (контент). На mobile — Drawer как сейчас.

### Конкретные изменения в файлах

| Файл | Что сделать |
|---|---|
| `VoiceMeetingDrawer.jsx` | Добавить `previewReport`/`fullPreview` state, iframe/MailPdfPreviewSurface, кнопки «Просмотр»/«Развернуть» |
| `VoiceVideoPage.jsx` | Split-view на desktop: `Grid` с двумя колонками, Drawer только на mobile |
| `VoiceMeetingsSection.jsx` | Клик по строке → выбрать встречу (управляет правой колонкой, не Drawer) |
| Новый `VoiceReportViewer.jsx` | Обёртка: iframe для HTML, MailPdfPreviewSurface для PDF, fallback для docx/md |
| Новый `VoiceMeetingPanel.jsx` | Правая колонка: вкладки Участники/Текст/Поручения/Отчёты (перенести из Drawer) |

### Порядок реализации

1. **Сначала** — `VoiceReportViewer.jsx` (iframe + PDF fallback). Использовать в Drawer.
2. **Потом** — полноэкранный Dialog (переиспользовать `DocumentPreviewDialog`).
3. **Потом** — split-view на desktop (Grid + перенос Drawer в панель).
4. **В конце** — адаптация mobile (оставить Drawer как fallback).

### Дизайн-токены (сохранить существующие)

- Цвета: `primary.main` для HTML-чипа, `error.main` для PDF, `default` для остальных.
- Размеры: iframe `borderRadius: 8`, Drawer 720px → split-view `minHeight: '100vh'`.
- Шрифты: отчёты внутри iframe — их собственные стили (не трогать).
- Dark theme: iframe может быть светлым — обернуть в `Paper` с `bgcolor: 'background.paper'`.
- A11y: `aria-label` на кнопках, фокус-trap в Dialog, `role="document"` для iframe.

### Чего НЕ делать

- Не переписывать HTML-отчёты (они генерируются пайплайном).
- Не хранить отчёты в состоянии React (только URL).
- Не загружать PDF целиком в память (использовать `MailPdfPreviewSurface` с lazy-load).
- Не ломать существующие ссылки «Новая вкладка» и «Скачать».

Ты не можешь подключиться к шаре? Вот точные команды. Копируй и вставляй по одной.


---

## Исправления UX — игрок, попап, понятность (2026-09-27)

### Проблема 1 (P0). HTML-отчёт — нет кнопки «Закрыть»

**Что происходит:** кнопка «Открыть» в отчётах (`VoiceMeetingDrawer.jsx:619`)
делает `target="_blank"` → HTML-отчёт открывается в новой вкладке/окне.
Внутри отчёта есть только floating-player с `✕` (закрыть плеер), но **нет кнопки
«Назад к протоколам» или «Закрыть отчёт»**. Пользователь заперт в отчёте.

**Исправление 1 — кнопка в HTML-отчёте** (в `voice_server/app.py:_REPORT_PLAYER_SNIPPET`):

Добавить в HTML-отчёт фиксированную кнопку «← К протоколам»:

```html
<style>
.vv-back-btn{position:fixed;top:12px;left:12px;z-index:100000;
  background:#1976d2;color:#fff;border:0;border-radius:8px;
  padding:8px 16px;font:600 13px/1.2 -apple-system,"Segoe UI",Roboto,sans-serif;
  cursor:pointer;box-shadow:0 2px 8px rgba(0,0,0,.3);text-decoration:none;display:inline-block}
.vv-back-btn:hover{background:#1565c0}
</style>
<a class="vv-back-btn" href="javascript:history.back()">← К протоколам</a>
```

Вставить в `_REPORT_PLAYER_SNIPPET` перед `<div class="vv-floating-player">`.
Если `history.back()` не работает (открыто в новой вкладке) — использовать:
`<a class="vv-back-btn" href="/voice">← К протоколам</a>` (прямая ссылка на страницу).

**Исправление 2 — просмотр внутри Dialog (лучше):**

Вместо `target="_blank"` → открывать отчёт в `<Dialog fullScreen>` с AppBar:

```jsx
// VoiceMeetingDrawer.jsx — новое состояние
const [viewReport, setViewReport] = useState(null); // { name, ext, url }

// Кнопка «Открыть» → «Просмотр»:
<Button size="small" variant="outlined" onClick={() => setViewReport({ name: r.name, ext: r.ext, url: voiceJobsAPI.reportUrl(base, r.name) })}>
  Просмотр
</Button>

// Dialog с отчётом:
<Dialog fullScreen open={Boolean(viewReport)} onClose={() => setViewReport(null)}>
  <AppBar position="relative" color="default">
    <Toolbar>
      <IconButton edge="start" onClick={() => setViewReport(null)} aria-label="Закрыть">
        <CloseIcon />
      </IconButton>
      <Typography sx={{ flex: 1 }} noWrap>{viewReport?.name}</Typography>
      <Button color="inherit" component={Link} href={viewReport?.url} target="_blank">
        Новая вкладка
      </Button>
      <Button color="inherit" component={Link} href={voiceJobsAPI.reportUrl(base, viewReport?.name, true)} download>
        Скачать
      </Button>
    </Toolbar>
  </AppBar>
  <Box sx={{ flex: 1, minHeight: 0 }}>
    <iframe
      src={viewReport?.url}
      title={viewReport?.name}
      style={{ width: '100%', height: '100%', border: 'none' }}
      sandbox="allow-scripts allow-same-origin"
    />
  </Box>
</Dialog>
```

**Исправление 3 — кнопка «Назад» в floating-player HTML:**

В `_REPORT_PLAYER_SNIPPET` кнопка `vvClose` уже есть (закрыть плеер).
Добавить рядом кнопку «К протоколам»:

```javascript
document.getElementById('vvBack').addEventListener('click', function(){
  if (window.history.length > 1) window.history.back();
  else window.location.href = '/voice';
});
```

**Рекомендация:** сделать **оба** исправления — кнопку в HTML (fallback) и Dialog (основной сценарий).

---

### Проблема 2 (P0). Плеер в поручениях — нельзя выйти

**Что происходит:** в `VoiceAssignmentsTab.jsx:135-141` клик по времени поручения
открывает `<Chip component="a" href={clipUrl} target="_blank">` — **новая вкладка
браузера** с плеером. Пользователь не может вернуться, плеер продолжает играть.

**Исправление:** заменить ссылку на **встроенный плеер в попапе с кнопкой «Стоп»/«Закрыть»**:

```jsx
// VoiceAssignmentsTab.jsx — новое состояние
const [clipPlayer, setClipPlayer] = useState(null); // { clip, time }
const clipAudioRef = useRef(null);

// Было: <Chip component="a" href={clipUrl} target="_blank" ... />
// Стало:
<Chip
  size="small"
  clickable
  label={item.time}
  onClick={() => setClipPlayer({ clip: item.clip, time: item.time })}
  sx={{ fontFamily: 'monospace', fontVariantNumeric: 'tabular-nums' }}
/>

// Новый Dialog с плеером:
<Dialog open={Boolean(clipPlayer)} onClose={closeClipPlayer} maxWidth="sm" fullWidth>
  <DialogTitle>
    Фрагмент поручения {item.num}
    <IconButton onClick={closeClipPlayer} sx={{ position: 'absolute', right: 8, top: 8 }}>
      <CloseIcon />
    </IconButton>
  </DialogTitle>
  <DialogContent>
    <Typography variant="body2" sx={{ mb: 1 }}>{clipPlayer?.time}</Typography>
    <audio
      ref={clipAudioRef}
      controls
      autoPlay
      src={voiceJobsAPI.clipUrl(base, clipPlayer?.clip)}
      style={{ width: '100%' }}
      onEnded={closeClipPlayer}
    />
    {/* Или для mp4: */}
    {/* <video controls autoPlay src={...} style={{ width: '100%', maxHeight: 300 }} /> */}
  </DialogContent>
  <DialogActions>
    <Button onClick={closeClipPlayer}>Закрыть</Button>
  </DialogActions>
</Dialog>
```

Функция `closeClipPlayer`:
```jsx
const closeClipPlayer = () => {
  clipAudioRef.current?.pause();
  setClipPlayer(null);
};
```

**Также:** если клип — `.mp4`, использовать `<video>` вместо `<audio>`.

---

### Проблема 3. Боковое окно → попап (больше места)

**Сейчас:** `VoiceMeetingDrawer` — `Drawer anchor="right"` шириной 720px.
На большом экране это мало, контент сжат.

**Исправление:** заменить `Drawer` на `Dialog fullScreen` (или `maxWidth="xl"`):

```jsx
// Было:
<Drawer anchor="right" open={open} onClose={onClose}
  PaperProps={{ sx: { width: isMobile ? '100%' : 720, maxWidth: '100%' } }}>

// Стало (вариант А — полный экран):
<Dialog fullScreen open={open} onClose={onClose}>
  {/* AppBar с названием и кнопкой закрыть */}
  <AppBar position="relative" color="default">
    <Toolbar>
      <IconButton edge="start" onClick={onClose} aria-label="Закрыть">
        <CloseIcon />
      </IconButton>
      <Box sx={{ flex: 1, minWidth: 0 }}>
        <Typography variant="subtitle1" noWrap>{displayName(base)}</Typography>
        <Typography variant="caption" color="text.secondary" noWrap>{base}</Typography>
      </Box>
      {/* Кнопки: Поделиться, Скачать всё */}
    </Toolbar>
  </AppBar>
  {/* Tabs + контент — как сейчас */}
  <Box sx={{ flex: 1, overflow: 'auto', p: 2 }}>
    {/* ... вкладки ... */}
  </Box>
</Dialog>
```

**Или вариант Б — крупный Dialog (не fullScreen):**
```jsx
<Dialog open={open} onClose={onClose} maxWidth="lg" fullWidth
  PaperProps={{ sx: { height: '90vh' } }}>
```

**Рекомендация:** `maxWidth="lg" fullWidth height="90vh"` — баланс между размером
и сохранением контекста страницы (видно шапку/сайдбар).

---

### Проблема 4. Понятность и функционал

#### 3а. Заголовок и навигация

В AppBar попапа добавить:
- **Название встречи** (крупно, полное — без `noWrap`)
- **Мета-строку**: дата · N реплик · N участников · статус имён
- **Кнопки действий**: «Поделиться», «Скачать ZIP», «Удалить» (с confirm)

#### 3б. Вкладки — понятные названия и иконки

```
[👥 Участники (3)] [📝 Текст] [📋 Поручения (5)] [📊 Отчёты (4)]
```

- Добавить иконки к вкладкам (`Tab icon={...} iconPosition="start"`)
- Счётчик на каждой вкладке (как сейчас для «Участники» и «Отчёты»)

#### 3в. Вкладка «Участники»

- Аудио-сэмпл → кнопка Play/Pause (уже есть `AudioPlayButton`)
- Кнопка «Переименовать» — inline-редактирование (не только Autocomplete)
- Кнопка «Запомнить голос» — с иконкой и тултипом
- Показать **сколько реплик** у каждого участника

#### 3г. Вкладка «Текст разговора»

- **Поиск по транскрипту** (Ctrl+F поле)
- **Фильтр по участнику** (выпадающий список)
- **Таймкод → клик → seek** (уже есть, но нужен видимый индикатор)
- **Закреплённый плеер** сверху (sticky video/audio) — чтобы видеть видео при скролле

#### 3д. Вкладка «Поручения»

- Кнопка «Воспроизвести фрагмент» → попап (Проблема 1)
- Кнопка «Создать задачу» → уже есть
- **Статус задачи**: если задача уже создана — показать ссылку на неё
- **Фильтр**: все / только без ответственного / только просроченные

#### 3е. Вкладка «Отчёты»

- Кнопка «Просмотр» → iframe/Dashboard внутри попапа (Проблема «Компоновка»)
- Группировка по типу: Протокол / Отчёт / Текст / Фрагменты
- Превью HTML в миниатюре (скриншот или первые строки)

---

### Сводка изменений в файлах

| Файл | Изменение | Приоритет |
|---|---|---|
| `VoiceAssignmentsTab.jsx` | Клик по времени → Dialog с плеером (не target=_blank) | **P0** |
| `VoiceMeetingDrawer.jsx` | `Drawer` → `Dialog maxWidth="lg" height="90vh"` + AppBar | **P0** |
| `VoiceMeetingDrawer.jsx` | Sticky-плеер в «Текст», поиск, фильтр по участнику | P1 |
| `VoiceMeetingDrawer.jsx` | Иконки на вкладках, счётчики, мета-строка | P1 |
| `VoiceAssignmentsTab.jsx` | Статус созданной задачи, фильтр поручений | P2 |
| `VoiceMeetingDrawer.jsx` | Группировка отчётов, превью | P2 |

### Порядок

1. **P0:** попап-плеер в поручениях (Проблема 1) — 30 мин
2. **P0:** Drawer → Dialog (Проблема 2) — 1 час
3. **P1:** AppBar + мета + иконки вкладок — 30 мин
4. **P1:** Sticky-плеер + поиск по тексту — 1 час
5. **P2:** Фильтры и группировки — 1 час

---

## Подключение шары — ПОДРОБНАЯ инструкция исполнителю

### Шаг 0. Проверь, что шара доступна

Открой PowerShell и выполни:

```powershell
Test-Path "\\10.103.0.229\hubit\voice"
```

Если вернулось `True` — шара доступна, идём дальше.
Если `False` — выполни `net use \\10.103.0.229\hubit` и повтори.

### Шаг 1. Создай папки на шаре

Шара уже подключена как `\\10.103.0.229\hubit` (см. `net use`). Папка `voice` уже
создана ранее. Нужно создать внутри неё подпапки.

Выполни **всю команду целиком** (скопируй блок):

```powershell
$share = "\\10.103.0.229\hubit\voice"

# Создаём подпапки
@("processed","output","reference_voices","unassigned_speakers","tmp",".trash","enroll_staging") | ForEach-Object {
    $p = Join-Path $share $_
    if (-not (Test-Path -LiteralPath $p)) {
        New-Item -ItemType Directory -Path $p | Out-Null
        Write-Host "Создано: $_"
    } else {
        Write-Host "Уже есть: $_"
    }
}

# Проверяем запись
@("processed","output","tmp") | ForEach-Object {
    $t = Join-Path $share "$($_)\_test.tmp"
    try {
        "test" | Set-Content -LiteralPath $t -NoNewline -ErrorAction Stop
        Remove-Item -LiteralPath $t -Force -ErrorAction Stop
        Write-Host "Запись ОК: $_"
    } catch {
        Write-Host "ОШИБКА записи в $_ : $($_.Exception.Message)"
    }
}
```

После этого проверь:

```powershell
Get-ChildItem "\\10.103.0.229\hubit\voice"
```

Должны быть папки: `processed`, `output`, `reference_voices`, `unassigned_speakers`,
`tmp`, `.trash`, `enroll_staging`.

### Шаг 2. Пропиши переменные в `.env`

Файл `.env` лежит в корне репозитория: `C:\Project\Image_scan\.env`.

Открой его **любым текстовым редактором** (Блокнот, VS Code) и добавь
**в конец файла** эти строки:

```
# === VoiceVideo warm-архив (сетевое хранилище) ===
VOICEVIDEO_ARCHIVE_DIR=\\10.103.0.229\hubit\voice
VOICEVIDEO_SOURCE_TTL_DAYS=7
VOICE_ARCHIVE_ENABLED=1
VOICE_ARCHIVE_DRY_RUN=1
```

> ВАЖНО: `VOICE_ARCHIVE_DRY_RUN=1` означает «только логировать, ничего не перемещать».
> Это безопасно. Снимешь `1` → `0` только после проверки.

После сохранения проверь:

```powershell
Select-String -Path "C:\Project\Image_scan\.env" -Pattern "VOICEVIDEO_ARCHIVE_DIR"
```

Должна быть строка `VOICEVIDEO_ARCHIVE_DIR=\\10.103.0.229\hubit\voice`.

### Шаг 3. Добавь поля в `voice_server/config.py`

Открой файл `C:\Project\Image_scan\voice_server\config.py`.

**3а.** Найди строку `data_dir: Path` (примерно строка 56) и **добавь после неё**:

```python
    archive_dir: Optional[Path]
    archive_enabled: bool
    archive_dry_run: bool
    source_ttl_days: int
```

**3б.** В классе `VoiceServerConfig` (перед `@classmethod`) добавь `Optional` в импорт
если ещё нет. Проверь начало файла — там уже есть `from typing import ...`.
Если `Optional` нет — добавь.

**3в.** Найди метод `from_env()` (примерно строка 65). Перед строкой `return cls(`
добавь:

```python
        archive_raw = os.getenv("VOICEVIDEO_ARCHIVE_DIR", "").strip()
        archive_dir = Path(archive_raw) if archive_raw else None
        source_ttl_days = max(1, _to_int(os.getenv("VOICEVIDEO_SOURCE_TTL_DAYS", "7"), 7))
        archive_enabled = _to_bool(os.getenv("VOICE_ARCHIVE_ENABLED", "0"), False)
        archive_dry_run = _to_bool(os.getenv("VOICE_ARCHIVE_DRY_RUN", "1"), True)
```

**3г.** В вызове `return cls(...)` добавь 4 новые строки (после `log_tail_lines=...`):

```python
            archive_dir=archive_dir,
            archive_enabled=archive_enabled,
            archive_dry_run=archive_dry_run,
            source_ttl_days=source_ttl_days,
```

Проверь синтаксис:

```powershell
python -c "from voice_server.config import config; print('archive_dir:', config.archive_dir); print('ttl:', config.source_ttl_days); print('enabled:', config.archive_enabled); print('dry_run:', config.archive_dry_run)"
```

Должно вывести:
```
archive_dir: \\10.103.0.229\hubit\voice
ttl: 7
enabled: True
dry_run: True
```

### Шаг 4. Обнови `voice_server/pipeline.py`

**4а.** Найди функцию `processed_dir()` (примерно строка 47) и **добавь после неё**:

```python
def archive_dir() -> Path:
    raw = os.getenv("VOICEVIDEO_ARCHIVE_DIR", "").strip()
    if raw:
        try:
            p = Path(raw)
            if p.exists():
                return p
        except OSError:
            pass
    return vv_root() / "archive"
```

**4б.** Найди функцию `find_source_media()` (примерно строка 299). Найди строку:

```python
    for directory in (processed_dir(), input_dir()):
```

Замени на:

```python
    for directory in (processed_dir(), archive_dir(), input_dir()):
```

Проверь:

```powershell
python -c "from voice_server import pipeline; print('archive_dir:', pipeline.archive_dir()); print('find:', pipeline.find_source_media('test'))"
```

Должно вывести `archive_dir: \\10.103.0.229\hubit\voice` и `find: None`.

### Шаг 5. Создай `voice_server/archiver.py`

Создай новый файл `C:\Project\Image_scan\voice_server\archiver.py` с этим содержимым:

```python
"""Hot→Warm archiver: переносит processed/ на шару и удаляет по TTL."""
from __future__ import annotations

import logging
import os
import shutil
import time
from datetime import datetime, timedelta, timezone
from pathlib import Path
from typing import Optional

from .config import config
from . import pipeline, store

logger = logging.getLogger("voice-archiver")

_lock_path = config.data_dir / "archiver.lock"


def _acquire_lock() -> Optional[object]:
    _lock_path.parent.mkdir(parents=True, exist_ok=True)
    handle = _lock_path.open("a+b")
    try:
        if os.name == "nt":
            import msvcrt
            handle.seek(0)
            msvcrt.locking(handle.fileno(), msvcrt.LK_NBLCK, 1)
        else:
            import fcntl
            fcntl.lockf(handle.fileno(), fcntl.LOCK_EX | fcntl.LOCK_NB)
        handle.seek(0)
        handle.truncate()
        handle.write(str(os.getpid()).encode("ascii"))
        handle.flush()
        return handle
    except OSError:
        handle.close()
        return None


def _is_expired(job: dict) -> bool:
    finished = job.get("finished_at")
    if not finished:
        return False
    try:
        if isinstance(finished, str):
            finished = datetime.fromisoformat(finished)
        if finished.tzinfo is None:
            finished = finished.replace(tzinfo=timezone.utc)
        return datetime.now(timezone.utc) - finished > timedelta(days=config.source_ttl_days)
    except (ValueError, TypeError):
        return False


def _copy_to_archive(src: Path, dry_run: bool) -> bool:
    dest = config.archive_dir / "processed" / src.name
    if dest.exists() and dest.stat().st_size == src.stat().st_size:
        return True  # already archived
    if dry_run:
        logger.info("dry-run: would copy %s -> %s", src.name, dest)
        return True
    dest.parent.mkdir(parents=True, exist_ok=True)
    shutil.copy2(str(src), str(dest))
    if dest.stat().st_size != src.stat().st_size:
        logger.error("size mismatch after copy: %s", src.name)
        return False
    logger.info("archived %s (%.1f MB)", src.name, src.stat().st_size / 1024 / 1024)
    return True


def _remove_source(base: str, dry_run: bool) -> None:
    media = pipeline.find_source_media(base)
    if not media:
        return
    if dry_run:
        logger.info("dry-run: would remove %s", media)
        return
    media.unlink(missing_ok=True)
    logger.info("removed source %s", media.name)


def run_once() -> dict:
    stats = {"archived": 0, "expired": 0, "skipped": 0, "errors": 0}
    dry_run = config.archive_dry_run

    for job in store.list_jobs(status="terminal", limit=500):
        base = str(job.get("base_filename") or "")
        if not base:
            continue
        status = job.get("status")
        if status != "done":
            stats["skipped"] += 1
            continue

        # Archive hot -> warm
        media = pipeline.find_source_media(base)
        if media and pipeline.processed_dir() in media.parents:
            try:
                if _copy_to_archive(media, dry_run):
                    stats["archived"] += 1
                else:
                    stats["errors"] += 1
            except OSError as exc:
                logger.error("archive error %s: %s", base, exc)
                stats["errors"] += 1

        # TTL: remove expired source
        if _is_expired(job):
            try:
                _remove_source(base, dry_run)
                stats["expired"] += 1
            except OSError as exc:
                logger.error("ttl error %s: %s", base, exc)
                stats["errors"] += 1

        if dry_run:
            time.sleep(0.1)  # don't hammer disk in dry-run

    return stats


def main() -> None:
    lock = _acquire_lock()
    if lock is None:
        logger.warning("Another archiver instance holds the lock; exiting")
        return
    try:
        stats = run_once()
        logger.info("archiver done: %s", stats)
    finally:
        lock.close()


if __name__ == "__main__":
    logging.basicConfig(level=logging.INFO, format="%(asctime)s [%(levelname)s] %(message)s")
    main()
```

Проверь:

```powershell
python -m compileall -q voice_server
python -m voice_server.archiver
```

Должно вывести `archiver done: {'archived': 0, 'expired': 0, 'skipped': N, 'errors': 0}`.

### Шаг 6. Alembic-миграция

Создай файл `C:\Project\Image_scan\voice_server\alembic\versions\20260927_0002_voice_archive_fields.py`:

```python
"""Add archive_path/archive_at to voice_jobs."""
from alembic import op
import sqlalchemy as sa

revision = "20260927_0002"
down_revision = "20260926_0001"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.add_column("voice_jobs", sa.Column("archive_path", sa.Text(), nullable=True), schema="voice")
    op.add_column("voice_jobs", sa.Column("archive_at", sa.DateTime(timezone=True), nullable=True), schema="voice")
    op.create_index("ix_voice_jobs_archive_at", "voice_jobs", ["archive_at"], unique=False, schema="voice")


def downgrade() -> None:
    op.drop_index("ix_voice_jobs_archive_at", table_name="voice_jobs", schema="voice")
    op.drop_column("voice_jobs", "archive_at", schema="voice")
    op.drop_column("voice_jobs", "archive_path", schema="voice")
```

Выполни:

```powershell
python -m alembic -c voice_server/alembic.ini upgrade head
```

### Шаг 7. Обнови `.env.example`

Найди в `C:\Project\Image_scan\.env.example` блок `# VoiceVideo` и добавь после
последней строки этого блока:

```
# Warm-архив (сетевое хранилище)
# VOICEVIDEO_ARCHIVE_DIR=\\server\share\voice
# VOICEVIDEO_SOURCE_TTL_DAYS=7
# VOICE_ARCHIVE_ENABLED=0
# VOICE_ARCHIVE_DRY_RUN=1
```

### Шаг 8. Проверь всё

```powershell
# 1. Health
curl http://127.0.0.1:8013/health

# 2. Config
python -c "from voice_server.config import config; print(config.archive_dir, config.source_ttl_days, config.archive_enabled, config.archive_dry_run)"

# 3. Archiver dry-run
python -m voice_server.archiver

# 4. Шара
Get-ChildItem "\\10.103.0.229\hubit\voice"
```

Всё должно работать без ошибок. Когда убедишься — снимай `VOICE_ARCHIVE_DRY_RUN=0`
и перезапускай archiver.

### РЕШЕНИЕ проблемы «не могу подключиться к шаре»

**Причина:** у тебя другой контекст (не `Администратор` или stale-credentials).
У меня шара работает. SMB-сессия показывает:

```
ServerName   ShareName  UserName                    Credential
10.103.0.229 hubit      TMN-SRV-APP-02\Администратор 10.103.0.229\sharehabit
```

**Решение — выполни в PowerShell:**

```powershell
# 1. Удали старые (stale) credential
cmdkey /delete:10.103.0.229

# 2. Добавь заново (пароль вводится один раз, сохранится в Windows)
cmdkey /add:10.103.0.229 /user:sharehabit /pass:ТВОЙ_ПАРОЛЬ

# 3. Подключи шару
net use \\10.103.0.229\hubit /persistent:yes

# 4. Проверь
Test-Path "\\10.103.0.229\hubit\voice"
```

Если пароль не знаешь — спроси у владельца шары. Пароль для `sharehabit`
уже сохранён в Windows Credential Manager на этом хосте (см. `cmdkey /list`).

**Если `net use` всё равно даёт ошибку 67:**

```powershell
# Попробуй с явными credentials
net use \\10.103.0.229\hubit /user:10.103.0.229\sharehabit

# Или через IP напрямую (без имени хоста)
Test-Path "\\10.103.0.229\hubit"
```

**Если ошибка 5 (access denied):**

```powershell
# Проверь текущего пользователя
whoami
# Должно быть: tmn-srv-app-02\Администратор
# Если другой — запусти PowerShell от имени Администратора
```

**Важно для кода:** Python-процессы (voice_server, archiver) используют
те же credentials, что и текущий пользователь Windows. Если PM2 запущен
от `Администратор` и `net use` работает — код тоже увидит шару.

Проверь из Python:

```powershell
python -c "from pathlib import Path; p=Path(r'\\\\10.103.0.229\\hubit\\voice'); print('exists:', p.exists()); print('listdir:', [x.name for x in p.iterdir()][:5])"
```

Если вывело `exists: True` — всё работает, проблема была только в shell-контексте.

| Ошибка | Причина | Решение |
|---|---|---|
| `Test-Path` вернул `False` | Шара не подключена | `net use \\10.103.0.229\hubit` |
| `Permission denied` при записи | Учётка PM2 не имеет доступа | Запусти PowerShell от имени `Администратор` |
| `archive_dir` выводит `voice_video\archive` | Переменная не в `.env` или опечатка | Проверь `Select-String .env ARCHIVE` |
| `ModuleNotFoundError: voice_server` | Запуск не из корня репозитория | `cd C:\Project\Image_scan` перед командой |
| `alembic` не находит revision | Неправильный `down_revision` | Проверь `python -m alembic -c voice_server/alembic.ini history` |
