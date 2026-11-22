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
- `document.key` вида `view-<key>`: просмотрщики не попадают в сессию редактирования и не засоряют presence.
- Токен на `document.url` — подписанный JWT с TTL 600 с; DS забирает файл server-to-server один раз.
- Эндпоинты:
  - `GET /api/v1/my-files/{id}/office/view` — тот же ACL, что и `/office/config` (`PERM_MY_FILES_READ`); права на редактирование клиенту не выдаются.
  - `GET /api/v1/mail/messages/{mid}/attachments/{ref}/office-view` — конфиг для вложения (метаданные `name`/`content_type` от клиента только для fileType/documentType).
  - `GET /api/v1/mail/office-source?t=` — отдаёт байты вложения по `mvsrc`-токену `{uid,mid,ref,mbx}` (DS ходит без сессии пользователя).
- Фронт: `OfficeViewFrame.jsx` — ленивая загрузка `api.js` (переиспользован `loadDocsApi`), `DocEditor` в view-режиме, `destroyEditor()` на размонтировании.
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

- `tests/test_onlyoffice_viewer.py` — 9 тестов: read-only конфиг, тип документа, `mvsrc`-токены, провайдер-резолюция, маршрутизация `_convert_source_to_pdf`, async-poll с файлом, маппинг ошибок DS, отказ от не-PDF.
- `test_mail_attachment_preview_service.py` — 15, `test_e2e_transfer_act_pdf.py` — 12 (реальный LO + отказные режимы под `OFFICE_PREVIEW_PROVIDER=libreoffice`).
- `test_my_files_office_e2e.py` — 96 (совместное редактирование, версии, коллбэки — регрессий нет).
- Чат/задачи/my_files preview-сьюты — 79 зелёные.
- Фронт: mail preview-тесты 29 зелёные.

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
