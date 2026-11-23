# Аудит печати документов в HUB-IT

Ветка: `feat/document-printing`. Связано с дефектом «при печати PDF документ
выглядит маленькой картинкой внутри листа A4».

## 1. Реестр точек печати

| Точка | Файл:строка | Механизм | Вход | Оценка |
|---|---|---|---|---|
| Предпросмотр документа (My Files, почтовые вложения — общий диалог) | `WEB-itinvent/frontend/src/components/documentPreview/DocumentPreviewDialog.jsx` ~141 | было `window.print()` на DOM приложения → теперь iframe-печать | PDF / office_pdf / excel / image / markdown / text / csv | **Исправлено** |
| Печать письма | `WEB-itinvent/frontend/src/components/mail/useMailMessageFileActions.js:131-174` | `window.open()` + `document.write` print-документа + `win.print()` | HTML письма | Корректная архитектура (отдельный print-документ) |
| Быстрая печать файла (десктоп) | `WEB-itinvent/frontend/src/components/fileActions/FileActionsContextMenu.jsx:206-216` | `runDownload('print')` → файл в нативное приложение | любой офисный/pdf | Нативный путь, ок |
| Печать QR-этикеток оборудования | `WEB-itinvent/frontend/src/pages/database/useEquipmentQrBatchPrint.js:21-25` | `window.print()` + `EquipmentQrPrintPortal` + `@page` | сгенерированные этикетки | Специализированный print-layout, ок |
| Печать QR-этикеток расходников | `WEB-itinvent/frontend/src/pages/database/useConsumableQrLabel.js` + `EquipmentQrPrintPortal.jsx:41` | то же | этикетки | ок |
| Desktop bridge | `WEB-itinvent/frontend/src/lib/desktopBridge.js:1186` (`document.printCurrent`) | сообщение в WebView2-shell | текущий документ | ок, вызывается первым в цепочке |
| `@media print` глобальные | `WEB-itinvent/frontend/src/index.css:444` | скрывает `.no-print`, `.vault-secret` | — | не закрывает диалог предпросмотра (источник дефекта) |
| Песочница HTML писем | `WEB-itinvent/frontend/src/components/mail/mailHtmlSandboxDocument.js:61` | `@media print` внутри sandbox | тело письма | ок |
| ONLYOFFICE embedded viewer | `OfficeViewFrame` + `my_files_office.py` конфиг (`permissions.print=true`) | штатная печать Document Server внутри iframe | docx/xlsx/pptx | Нативная печать DS — единственный правильный путь для OO |
| Backend PDF-генерация | `WEB-itinvent/backend/services/act_upload_service.py:437` (`_stamp_pdf_overlay`, pypdf+reportlab) | штамп на загруженный акт | акты | Серверный PDF дальше идёт тем же preview-конвейером; ок |
| AI-артефакты | `WEB-itinvent/backend/ai_chat/artifact_generator.py:32-35` | генерация файлов | — | не печать |

Скан-центр и документооборот отдельных кнопок печати не имеют — документы
идут через общий `DocumentPreviewDialog`.

## 2. Корневая причина (подтверждена экспериментально)

`DocumentPreviewDialog.printPreview` вызывал `window.print()` на всей
странице приложения. Chrome печатал DOM: полноэкранный MUI-диалог, внутри
которого PDF.js рисует страницы **растровыми canvas'ами экранного
разрешения** в скролл-контейнере. `@media print` в `index.css` скрывает
только `.no-print` — хром диалога и фоновая страница остаются в потоке
печати.

Следствия, воспроизведённые на стенде (Chrome, `emulateMedia('print')` +
`page.pdf()`):

- **Многостраничный PDF**: 3-страничный `fix-multi3.pdf` (595×842pt ×3)
  напечатался в **2 страницы A4** — первая содержит chrome диалога + растр
  видимой области, вторая — фрагмент списка файлов «Мои файлы» за диалогом.
  Страницы 2–3 документа потеряны.
- **Альбомная ориентация**: `fix-landscape.pdf` (842×595pt) напечатан как
  портретный A4 — содержимое альбомной страницы втиснуто в верхнюю часть
  портретного листа («маленький документ внутри листа»).
- **Растеризация**: текст превращается в картинку экранного DPI — мелкий
  текст нечитаем, текстовый слой теряется.
- Экранные поворот/zoom превью протекают в печать.

Гипотезы 1, 2, 3, 5, 10 из задания подтверждены; первопричина — отсутствие
отдельного print-документа: печатался не PDF, а веб-страница с его
растровым предпросмотром.

## 3. Исправление

Новый `WEB-itinvent/frontend/src/lib/documentPrint.js`:

- `printPdfDocument({url|blob, title})` — скрытый same-origin iframe с
  blob-URL PDF; `contentWindow.print()` вызывает **нативную печать PDF
  браузером**: исходные MediaBox/ориентация/векторное качество/все страницы,
  штатный диалог браузера (масштаб, страницы, принтер — на усмотрение
  пользователя). Чужой objectUrl не отзывается; временный URL отзывается
  на `afterprint`/таймауте (120 с). Таймаут загрузки 15 с → fallback.
- `printHtmlDocument` — print-only `srcdoc`-документ в скрытом iframe для
  не-PDF контента: единый `PRINT_DOC_CSS` (`@page`, переносы, `pre-wrap`,
  `page-break-inside` для таблиц/цитат/картинок).
- `buildTextPrintBodyHtml` — моноширинный `<pre>` с экранированием.
- `buildSheetsPrintBodyHtml` — экранированные `<table>` из workbook
  (до 500 строк на лист, пометка об обрезании).
- `src/lib/markdownPrint.jsx` — `renderToStaticMarkup` того же
  ReactMarkdown-пайплайна (GFM + sanitize + safeMarkdownUrlTransform), без
  интерактивных кнопок. Ленивый импорт по клику — `react-dom/server` не
  попадает в бандлы страниц.

`DocumentPreviewDialog.printPreview` теперь маршрутизирует: PDF/office_pdf
→ iframe PDF; markdown → print-HTML; text → print-HTML; image → print-HTML;
excel-table/csv → table-HTML; Desktop (`document.printCurrent`) — прежний
приоритет; `window.print()` — только как последний fallback. Кнопка печати
добавлена для markdown/text/image/csv.

Mail-вложения покрыты автоматически — `MailAttachmentPreviewDialog`
делегирует документы в `DocumentPreviewDialog`.

ONLYOFFICE: embedded-вьювер имеет собственную печать DS
(`permissions.print: true` в конфиге) — iframe-скриншоты не используются.

## 4. Проверки

До: `print-before*.pdf` — 2 страницы вместо 1/3, chrome диалога, растр,
альбомная страница в портрете.

После (реальный headed Chrome, стенд):

- `fix-multi3.pdf` → скрытый iframe `ct=application/pdf`, печать идёт
  нативным пайплайном Chrome → все 3 страницы исходного размера.
- `fix-landscape.pdf` → тот же путь; ориентация сохраняется PDF-документом.
- `acc-view.txt` → srcdoc `<pre>` текст, без скриптов.
- `acc-view.md` → отрендеренный GFM (h1/table/pre), `scriptCount=0`.
- `acc-view.csv` → `<table>` в print-документе.

Тесты: `documentPrint.test.js` (экранирование, truncation-заметка,
таблицы) 3/3; `DocumentPreviewDialog.test.jsx` 11/11 (iframe-путь PDF,
desktop-приоритет, отсутствие `window.print`). Trial build (`vite build`
в temp) чистый; `markdownPrint` — отдельный чанк по требованию.

## 5. Безопасность

- Печатается уже авторизованный blob (ACL соблюдено на fetch-этапе);
  новых сетевых запросов и публичных URL нет.
- `srcdoc` собирается из sanitize-конвейера / экранированного текста;
  заголовок `escapeHtml`.
- Временные blob-URL отзываются; чужой preview-URL не отзываем.
- В `localStorage` и логи содержимое не пишется; третьих сервисов нет.

## 6. Производительность

Печать PDF не переконвертирует и не перекачивает файл — переиспользуется
objectUrl уже загруженного превью (1–50 МБ — ноль дополнительного I/O).
HTML-путь ограничен размером уже полученного текста (лимит превью 8 МБ)
и 500 строками на лист для таблиц.

## 7. Открытые вопросы

- Headless Chrome падает на `print()` внутри PDF-plugin iframe — ограничение
  безголового режима; в настоящем Chrome проверено. E2E-ассерты печати —
  по факту монтирования iframe.
- Если диалог закрыть в момент открытого системного диалога печати, blob-URL
  превью отзывается контроллером — Chrome уже снапшотнул документ на
  `print()`, влияния нет.
- `window.print()` остаётся последним fallback при исключительных сбоях
  iframe — воспроизводит старое поведение, но не хуже.
- Печать из чат-превью вложений (canvas `chatAttachmentPreview`) не имеет
  кнопки — вне текущего скоупа, при необходимости подключить тот же
  `documentPrint`.

## 8. Решение

**GO** — для предпросмотра документов. Критерий выполнен: печать идёт
исходными страницами PDF через нативный пайплайн браузера; мусорный chrome
и потеря страниц устранены.
