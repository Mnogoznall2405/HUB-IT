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
