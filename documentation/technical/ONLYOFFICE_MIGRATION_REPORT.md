# Миграция предпросмотра и конвертации офисных документов: LibreOffice → ONLYOFFICE

Статус: реализация выполнена, unit/e2e-тесты зелёные; реальные браузерные замеры
viewer-режимов — см. раздел «Что осталось».

## 1. Зависимости LibreOffice до миграции

| Место | Что делало | После миграции |
|---|---|---|
| `backend/services/mail_attachment_preview_service.py` | `soffice --convert-to pdf` для всех office-превью; по-листная конвертация XLSX | `_convert_source_to_pdf()` диспетчерит провайдер: ONLYOFFICE ConvertService (по умолчанию) или LO при откате |
| `backend/services/transfer_service.py` | `soffice --convert-to pdf` для актов перемещения | `_convert_act_source_to_pdf()` — тот же диспетчер провайдера |
| `backend/services/my_files_service.py` | `_office_preview_runtime_available` проверял только наличие soffice | Проверяет провайдер: OO — конфигурация, LO — бинарник |
| `scan_server/document_conversion.py` | `soffice --convert-to pdf` для сканов | `SCAN_OFFICE_PROVIDER` (`auto` → OO при наличии настроек) |
| Фронт (почта, «Мои файлы») | PDF-артефакт + SheetJS-грид для XLSX | Прямой read-only DocEditor viewer (`office_view`), PDF — запасной путь |

## 2. Новая архитектура

### 2.1. Провайдер конвертации
- `OFFICE_PREVIEW_PROVIDER=auto|onlyoffice|libreoffice` (`.env`), `auto` → OO при наличии `ONLYOFFICE_ENABLED+JWT+INTERNAL_URL`.
- `backend/services/onlyoffice_conversion_service.py` — `POST /converter/from-file` (DS ≥ 10.0, у нас 10.0.0 build 169): multipart-загрузка файла без временных URL; JWT `operation:"converter"`; async-режим: повтор запроса идёт целиком, с файлом (file-less poll отвергается DS кодом `-8`).
- `key` конвертации детерминирован по `sha256(content)` → повтор одинакового файла отдаётся из кэша DS за ~0.2 с.
- Ключ кэша превью-артефактов теперь включает имя провайдера (никаких «чужих» PDF при переключении движка).
- Общий семафор `_CONVERT_SEMAPHORE` ограничивает параллелизм обоих движков (`MAIL_OFFICE_PREVIEW_MAX_CONCURRENCY`).

### 2.2. Компактный просмотр (compact preview) без редактирующей сессии
- `oo.build_viewer_config()` — `type:"embedded"`, `editorConfig.mode:"view"`, `permissions{edit,comment,review,fillForms:false}`, `coEditing{mode:"strict",change:false}`, `autosave:false`, без `callbackUrl` — сохранять нечего, сессия редактирования не создаётся (embedded = Common Viewer).
- `document.key` вида `view-{file_id}-{blob_id}` (мои файлы) — привязан к blob содержимого: после «открыть → редактировать → сохранить → просмотр» ключ меняется и DS не отдаёт устаревший кэш; ключ редактирующей сессии не затрагивается. Для почты — `view-mail-<sha256(uid|mbx|mid|ref)>`: коллизий между пользователями/ящиками нет, повторное открытие того же вложения — кэш-хит.
- Токен на `document.url` — подписанный JWT с TTL 600 с; DS забирает файл server-to-server.
- Эндпоинты:
  - `GET /api/v1/my-files/{id}/office/view` — тот же ACL, что и `/office/config` (`PERM_MY_FILES_READ`); права на редактирование клиенту не выдаются.
  - `GET /api/v1/mail/messages/{mid}/attachments/{ref}/office-view` — конфиг для вложения; **под сессией пользователя** скачивает вложение и паркует байты в `OfficeViewSourceStore` (TTL = TTL токена, LRU с лимитами `MAIL_OFFICE_VIEW_SOURCE_*`) — так `primary_session`-креды живут только в запросе пользователя.
  - `GET /api/v1/mail/office-source?t=` — анонимный для DS: проверяет подпись/`mvsrc`-тип/срок токена и отдаёт припаркованные байты по `sha256(t)`; без записи — 410, поддельный токен — 403, выключенная интеграция — 503 (`require_enabled`, пустой секрет не проходит).
- Фронт: `OfficeViewFrame.jsx` — ленивая загрузка `api.js` (переиспользован `loadDocsApi`), `DocEditor` в view-режиме, `destroyEditor()` на размонтировании; таймаут готовности 60 с без `onDocumentReady`/`onError` → `onError` → откат на PDF/excel; ошибка SDK → тот же откат (однократно).
- Подключено: «Мои файлы» (`useMyFilesPreviewController` → `kind:'office_view'`), почта (`buildOfficeAttachmentPreviewState` → `office_view`). При недоступности DS — автоматический откат на прежний PDF/excel путь.
- XLSX: прямой табличный просмотр в OO (листы, прокрутка, формулы, ширины колонок) вместо PDF по каждому листу; клиентский SheetJS-грид остаётся запасным путём.

### 2.3. Что осталось на прежнем пути
Чат, задачи, документооборот, 1С — пока через PDF-артефакт, но сама конвертация уже идёт через OO-движок (тот же `_convert_source_to_pdf`). Расширение `office-view`-эндпоинтов на эти сущности — следующий шаг.

## 3. Замеры производительности (baseline, локально)

LibreOffice headless → PDF: docx p50 ≈ 3.27 с (холодная ≈ 8.3 с), xlsx ≈ 2.92 с,
большой xlsx ≈ 4.27 с, pptx ≈ 2.6 с.

ONLYOFFICE ConvertService → PDF: малые файлы ≈ 1 с холодно, повтор идентичного
файла ≈ 0.2 с (кэш DS по `key`); pptx ≈ 1.03 с холодно.

Прямой viewer (`office_view`) вообще исключает конвертацию при обычном открытии —
время до показа определяется загрузкой `api.js` и загрузкой файла DS'ом.

## 4. Тесты

- `tests/test_onlyoffice_viewer.py` — 13: read-only конфиг, тип документа, `mvsrc`-токены, провайдер-резолюция, маршрутизация `_convert_source_to_pdf`, async-poll с файлом, маппинг ошибок DS, отказ от не-PDF/oversize, failover auto→LO, флаг `ONLYOFFICE_ENABLED` в scan_server.
- `tests/test_mail_office_view_source.py` — 7: roundtrip office-view→office-source с пробросом session-context (primary_session), `ENABLED=0` → 503, пустой секрет → 503, поддельный/мусорный токен → 403 без обращения к почте, валидная подпись без припаркованной записи → 410, чужой токен → 410.
- `test_mail_attachment_preview_service.py` — 15, `test_e2e_transfer_act_pdf.py` — 12 (реальный LO + отказные режимы под `OFFICE_PREVIEW_PROVIDER=libreoffice`).
- `test_my_files_office_e2e.py` — 97: совместное редактирование, версии, коллбэки + свежесть view-ключа через edit→save (регрессий нет).
- Фронт: `OfficeViewFrame.test.jsx` — 3 (таймаут готовности, подавление после ready, одиночный onError), `useMailMessageFileActions.test.js` — 16 (включая rebuild после падения office_view), `DocumentPreviewDialog.test.jsx` — 13.

## 5. Откат

`OFFICE_PREVIEW_PROVIDER=libreoffice` (и/или `SCAN_OFFICE_PROVIDER=libreoffice`) —
код LO не удалён до полного подтверждения. Лицензия ONLYOFFICE Community
(«Docs Community Edition»): бесплатное self-hosted использование, ограничение по
одновременным редактирующим сессиям (~20) — на просмотры (view/embedded) не влияет.

## 6. Что осталось

1. Реальные браузерные замеры viewer-режимов (embedded vs view для XLSX, первое
   отображение, RAM браузера/DS, конкурентные просмотры) и скриншоты.
2. `office-view`-эндпоинты для чата/задач/документооборота/1С.
3. Финальное удаление LO-кода после приёмки в проде (сейчас оставлен как откат).

## 7. Второй раунд ревью (PR #8) — исправления

Коммиты: `4729c676` (исправления + тесты), `3b2ce1ee` (merge актуального `main`).

| Замечание | Разбор | Результат |
|---|---|---|
| P0: `_office_settings_or_503` звал `load_settings()` — мёртвый `except`, пустой JWT-секрет = подпись известным ключом на анонимном роуте | Верно: `load_settings` не кидает | `oo.require_enabled()` в обеих точках; `ENABLED=0` и пустой секрет → 503 до декодирования токена |
| P1: view-ключ от `office_session_key` переживает сохранения → DS отдаёт устаревший кэш | Верно: ключ сессии пинned | Ключ `view-{file_id}-{blob_id}` — по содержимому; edit-ключ не тронут; e2e-тест edit→save→re-view |
| P1: `office-source` дёргал `download_attachment` из анонимного запроса — `primary_session` без request-context не достаёт креды | Верно: кэш спасал лишь частично (большие файлы пропускают кэш) | Префетч под сессией пользователя в `office-view` → TTL-стор по `sha256(token)`; source отдаёт байты без юзер-кредов; интеграционный тест с пробросом `sess-1` |
| P2: scan `_onlyoffice_configured` считал `"0"` истиной | Верно | Общая `conversion_configured()`; тест `ENABLED=0` |
| P2: зависание viewer без событий SDK | Верно: спиннер навсегда | Таймаут 60 с → `onError` → PDF/excel-откат; 3 фронт-теста |
| PR показывал 578+ файлов | Метаданные `gh pr view` отставали: считались от merge-base до того, как WIP-коммиты попали в `origin/main`; compare API был точен всегда | После мержа main в ветку и compare, и метаданные согласны: 29 файлов, все миграционные |

Фактические проверки после мержа: backend 47+97 зелёные, фронт (viewer/mail/documentPreview) зелёные, `git diff --check` чисто. Браузерные замеры не выполнялись — unit/e2e-тесты не подменяют реальный браузер.

## 8. Третий раунд ревью (PR #8) — общее хранилище припаркованных источников

| Замечание | Разбор | Результат |
|---|---|---|
| P1: `OfficeViewSourceStore` — in-memory `OrderedDict`, виден только своему процессу: `office-view` на процессе A + `office-source` на B → 410 | Верно: PM2 держит `itinvent-backend` + воркеры разными процессами; рестарт между view и fetch — тот же сценарий | Стор переведён на разделяемый spool-диск (`configured_spool_dir()/mail-office-view`, переопределяется `MAIL_OFFICE_VIEW_SOURCE_DIR`): `<key>.bin` + `<key>.json` мета (`expires_at`, `filename`, `content_type`, `size`), атомарная публикация tmp+`os.replace`, мета пишется последней. Все процессы хоста видят записи; TTL живёт в метафайле → переживает рестарт |

Механика (требования → реализация):
- `primary_session`: префетч под сессией пользователя в `office-view` — без изменений, секреты в DS не уходят.
- JWT/TTL/размер/доступ: проверка подписи и `exp` на `office-source`; expiry также в метафайле — просроченная запись читается как 410 и удаляется.
- Непубличность: spool-корень вне статических каталогов, тот же уровень доверия, что у spool-файлов загрузок «Моих файлов».
- Лимиты: `MAIL_OFFICE_VIEW_SOURCE_ENTRY_BYTES` (64 МБ), `MAX_BYTES` (256 МБ), `MAX_ENTRIES` (32); при переполнении вытесняется запись с ближайшим expiry; превышение по одной записи → `put` → False → 413 → фронт-фолбэк.
- Параллельность: разные ключи → независимые файлы; повторный `put` по тому же ключу атомарно заменяет файлы.
- Очистка: ленивый sweep истёкших на каждом `put` + удаление при просроченном `get`; сироты после падения вычищаются по expiry при следующей записи (диск ограничен кэпами, так что неконтролируемого роста нет даже без sweeper'а).

Проверки: `test_mail_office_view_source.py` **12/12** — включая: (а) отдельный экземпляр `OfficeViewSourceStore` на том же каталоге читает запись, припаркованную через API (модель «процесс B / рестарт»); (б) параллельные открытия одного и разных вложений; (в) истечение TTL → 410 + файлы удалены; (г) превышение `ENTRY_BYTES` → 413; (д) вытеснение при `MAX_BYTES`. `test_onlyoffice_viewer.py` 13/13, `test_mail_attachment_preview_service.py` 15/15, compileall OK, `git diff --check` чисто.

Честно про покрытие: два *реальных* процесса не поднимались — межпроцессность смоделирована двумя независимыми экземплярами стора на общем каталоге + двумя FastAPI-приложениями; файловая раскладка делает это эквивалентным раздельным процессам на одном хосте (UNC — при общем `MY_FILES_SPOOL_DIR`). Полная недоступность DS на бэкенде не затрагивает `office-view` (он не ходит в DS): падение viewer'а в браузере → `onError` → PDF-фолбэк, покрыто фронт-тестами. Удаление письма/отзыв прав/отключение ящика **не** отзывают припаркованные байты мгновенно — выдача ограничена TTL токена (по умолчанию 600 с), как у любой подписанной ссылки; это зафиксированное поведение, а не дефект. Большой XLSX сверх лимита → 413 → табличный/PDF-фолбэк.

## 9. Четвёртый раунд ревью (PR #8) — надёжность общего хранилища

| Замечание | Результат |
|---|---|
| P1: `_drop_expired`/`_entries`/eviction/публикация без межпроцессной синхронизации | Byte-range lock на `<root>/.mvsrc.lock`: `msvcrt.locking` (Windows) / `fcntl.flock` (POSIX). Ядро снимает блок при падении процесса — мёртвых локов нет. Ограниченное ожидание `MAIL_OFFICE_VIEW_SOURCE_LOCK_TIMEOUT_SEC` (10 с) → `OfficeViewSourceLockTimeout` → 503/фолбэк, не зависание. SMB: byte-range locks поддерживаются редиректором SMB2 — механизм совместим с UNC-спулом |
| P1: `.bin` заменялся раньше `.json` → читатель мог получить новые байты со старой метой | Immutable payload `<key>.<uuid>.bin` + мета-указатель `{payload}` публикуется последней атомарным `os.replace` → читатель всегда видит целую старую или целую новую версию. Параллельный `put` того же ключа пишет свой payload; проигравший становится сиротой для sweeper'а |
| P2: очистка только по `.json` → сироты `.bin`/`.tmp-*` после падения | Lazy sweep под локом: истёкшие записи, битые мета (запись мертва → удаляется), осиротевшие `.bin` и `.tmp-*` **старше grace-периода** (`MAIL_OFFICE_VIEW_SOURCE_SWEEP_GRACE_SEC`, 120 с). Молодые файлы не трогаем — защита in-flight записей других процессов |
| P2: `Response(content=entry.content)` — вторая полная копия в RAM | `/mail/office-source` → `FileResponse` по `payload_path` (чанки ~64 КБ). `Entry.content` — ленивое свойство. Замер `tracemalloc` при 10/30/60 МБ: python-надбавка стора **0.0 МБ** — пик цепочки ≈ 1× вложения (буфер `download_attachment`, интерфейс Exchange стриминга не даёт) + сетевая обвязка. Проверка лимита `ENTRY_BYTES` и JWT — до записи/чтения, 413 приходит до расхода диска |

Резервирование ёмкости: подсчёт и eviction происходят внутри лока непосредственно перед публикацией меты — параллельные процессы не могут превысить `MAX_BYTES`/`MAX_ENTRIES` (payload пишется вне лока и не учитывается, пока мета не опубликована).

**Настоящие межпроцессные испытания** (`tests/test_mail_office_view_source_mp.py` — каждый воркер отдельный `sys.executable` со своим стором, 8/8): A пишет → B читает; два процесса — разные ключи; два процесса — один ключ (финал: 1 мета, payload целый, без смешения байтов); «падение» между payload и метой → сирота переживает grace и сметается; 4 процесса конкурентно → суммарные байты ≤ `MAX_BYTES`; чтение в момент вытеснения → целая запись или MISS, никогда мусор; таймаут лока под удержанием → чистый отказ, не зависание; выход пишущего процесса → запись читается дальше. Состояние каталога (число мета/bin и байты) проверено после каждого сценария.

Приватность: в бэкенде нет ни одного `StaticFiles`/mount — spool-каталог ничем не раздаётся; NTFS-права наследуются от `data/my_files/spool` (учётка сервиса), как у spool-файлов загрузок «Моих файлов».

## 10. Реальная браузерная приёмка ONLYOFFICE (локальный e2e-стек + живой DS)

Стенд: изолированный FastAPI на throwaway SQLite (`frontend/e2e/stack/.state-oo`, `E2E_FILES_WORKER=1`, порт 18002 на LAN-интерфейсе `10.103.0.217`), Vite-фронт `:5174`, настоящий Document Server `10.103.0.11:8080` (отдельный хост), реальный Chrome через Playwright. Прод-стек не затрагивался.

**Цепочка, проверенная end-to-end в браузере:**
1. Логин e2e-пользователем, загрузка docx 1383 Б через `POST /my-files` → inline-worker → `ready`/`clean`.
2. `GET /my-files/{id}/office/view` → 200: подписанный config (`type=embedded`, `mode=view`), `public_path`, `document.url` = `http://10.103.0.217:18002/api/v1/my-files/office/source?t=<jwt>`.
3. Браузер грузит `api.js` прямо с DS → DocEditor → iframe `http://10.103.0.11:8080/.../embed/index.html`.
4. DS серверным fetch забирает source с нашего бэкенда (TCP-соединение `10.103.0.11`→`:18002` подтверждено; анонимный GET того же URL → 200 + docx-байты).
5. DS конвертирует в кэш (`Editor.bin`), embedded-viewer рендерит: шрифты `/10.0.0-*/fonts/*` → 200, `onDocumentReady` → `phase='ready'` (opacity хоста = 1).
6. **Скриншот-доказательство**: в iframe виден текст документа («ACCEPTANCE MARKER 42…»), тулбар ONLYOFFICE, «1 из 1», зум-контролы; режим read-only (нет инструментов редактирования).
7. Неизменность источника: blob на диске побайтово равен загруженному docx после просмотра (sha256 совпал).

**Дефект, найденный приёмкой, и исправление:**
- DS отдаёт браузеру кэш-URL на свой абсолютный адрес (`http://10.103.0.11:8080/cache/.../Editor.bin`). При проксировании через `/onlyoffice` на origin фронта это cross-origin XHR без CORS → `net::ERR_FAILED`, DocEditor умирал молча (без `onError`). Исправление: `ONLYOFFICE_PUBLIC_PATH` теперь принимает абсолютный URL (`http(s)://…`) — `public_path` уходит во фронт как есть, `api.js`/iframe/кэш остаются на одном origin DS. Прод-режим `/onlyoffice` не изменён; `rewrite_document_url` валидирует `/cache/files/` префикс в обоих режимах.

**Фолбэк при недоступном DS (браузер):** host DS заблокирован (`route.abort`) → `api.js` не грузится → `onError` → `loadPreparedPreview` → в стеке нет готового PDF-превью (рендерер превью в e2e-стеке не поднят) → чистое сообщение «Предпросмотр готовится… или скачайте оригинал» + кнопка скачивания. Полный PDF-фолбэк с готовым превью покрыт фронт-тестами.

**Косметический баг, закрытый по ходу:** `MyFiles.jsx` подписывал диалог «PDF-предпросмотр» при активном `office_view` → теперь «Просмотр (только чтение)».

**Проверки после изменений:** backend 33/33 (`test_onlyoffice_viewer` 13, `test_mail_office_view_source` 12, `test_mail_office_view_source_mp` 8), frontend 47/47 (`MyFiles` 34, `OfficeViewFrame`, `DocumentPreviewDialog`).

**Что осталось вне проверки:** полный PDF-фолбэк с существующим превью в живом браузере (нет рендерера превью в e2e-стеке); большой XLSX и конкурентные просмотры в браузере; замеры RAM/CPU viewer'а; матрица LibreOffice/embedded/view/Common Viewer. Харнесс приёмки (`e2e/onlyoffice-real.vite.config.js`, `e2e/.oo-tmp/`) оставлен незакоммиченным — привязан к адресам конкретного стенда.
