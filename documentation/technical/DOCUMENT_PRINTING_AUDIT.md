# Аудит печати документов в HUB-IT

Ветка: `feat/document-printing` (PR #11). Связано с дефектом «при печати PDF
документ выглядит маленькой картинкой внутри листа A4». Документ обновлён по
итогам финального ревью: исправлена печать из HUB Desktop, удалён
`window.print()`-fallback, добавлено предупреждение для усечённых таблиц.

## 1. Реестр точек печати

| Точка | Файл:строка | Механизм | Вход | Оценка |
|---|---|---|---|---|
| Предпросмотр документа (My Files, почтовые вложения — общий диалог) | `WEB-itinvent/frontend/src/components/documentPreview/DocumentPreviewDialog.jsx` ~209 | браузер: скрытый iframe (PDF blob / print-HTML); Desktop: `document.print` через bridge | PDF / office_pdf / excel / image / markdown / text / csv | **Исправлено** |
| Печать письма | `WEB-itinvent/frontend/src/components/mail/useMailMessageFileActions.js:131-174` | `window.open()` + `document.write` print-документа + `win.print()` | HTML письма | Корректная архитектура (отдельный print-документ) |
| Быстрая печать файла (десктоп) | `WEB-itinvent/frontend/src/components/fileActions/FileActionsContextMenu.jsx:206-216` | `runDownload('print')` → файл в нативное приложение | любой офисный/pdf | Нативный путь, ок |
| Печать QR-этикеток оборудования | `WEB-itinvent/frontend/src/pages/database/useEquipmentQrBatchPrint.js:21-25` | `window.print()` + `EquipmentQrPrintPortal` + `@page` | сгенерированные этикетки | Специализированный print-layout, ок |
| Печать QR-этикеток расходников | `WEB-itinvent/frontend/src/pages/database/useConsumableQrLabel.js` + `EquipmentQrPrintPortal.jsx:41` | то же | этикетки | ок |
| Desktop: печать документа | `document.print` → `DesktopBridgeHost` → `DesktopPrintService.PrintDocumentAsync` | отдельный скрытый WebView2: `Navigate(blob:)` для PDF, `NavigateToString` для print-HTML, `ShowPrintUI(System)` | PDF / print-HTML | **Новый путь, исправлено** |
| Desktop: печать текущей страницы | `document.printCurrent` → `DesktopPrintService.TryPrintCurrent` | `ShowPrintUI(System)` на текущей WebView2 | доверенная страница HUB | Сохранён для печати страниц портала; для документов больше не вызывается |
| `@media print` глобальные | `WEB-itinvent/frontend/src/index.css:444` | скрывает `.no-print`, `.vault-secret` | — | не закрывает диалог предпросмотра (источник дефекта) |
| Песочница HTML писем | `WEB-itinvent/frontend/src/components/mail/mailHtmlSandboxDocument.js:61` | `@media print` внутри sandbox | тело письма | ок |
| ONLYOFFICE embedded viewer | `OfficeViewFrame` + `my_files_office.py` конфиг (`permissions.print=true`) | штатная печать Document Server внутри iframe | docx/xlsx/pptx | Нативная печать DS — предпочтительный путь для больших XLSX |
| Backend PDF-генерация | `WEB-itinvent/backend/services/act_upload_service.py:437` (`_stamp_pdf_overlay`, pypdf+reportlab) | штамп на загруженный акт | акты | Серверный PDF дальше идёт тем же preview-конвейером; ок |

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

Вторая группа дефектов (финальное ревью PR #11):

- **HUB Desktop**: `printPreview` первым делом вызывал
  `requestDesktopPrintCurrent()` → `TryPrintCurrent()` →
  `ShowPrintUI(System)` на **текущей странице портала** — Desktop печатал
  Dashboard/диалог, а не документ.
- **`window.print()`-fallback** при любой ошибке iframe-пути молча
  воспроизводил исходный дефект.
- **500-строк cap** в `buildSheetsPrintBodyHtml` без предупреждения —
  усечённая таблица выдавалась за полную распечатку.
- **Гонка двух документов**: единственный скрытый print-WebView2
  переиспользовался — второй документ мог заменить содержимое под ещё
  открытым системным диалогом первого.

## 3. Исправление

### Браузер (`documentPrint.js` + `DocumentPreviewDialog.jsx`)

- `printPdfDocument({url|blob, title})` — скрытый same-origin iframe с
  blob-URL PDF; `contentWindow.print()` вызывает **нативную печать PDF
  браузером**: исходные MediaBox/ориентация/векторное качество/все страницы.
  Таймаут загрузки 15 с → ошибка; frame живёт до `afterprint` или 120 с.
- `printHtmlDocument` — print-only `srcdoc`-документ в скрытом iframe для
  не-PDF контента (`PRINT_DOC_CSS`, `@page`).
- `buildPrintDocumentHtml` выделен экспортом — тот же документ уходит в
  Desktop через `window.__hubPendingPrintHtml`.
- `buildSheetsPrintBodyHtml` — лимит `SHEETS_PRINT_MAX_ROWS = 500`,
  честная пометка «Показаны первые N из M. Полный лист — в исходном файле»
  (`totalRows` из `excelPreview` — реальный размер листа, не загруженный).
- `sheetsPrintLosesRows` — признак потери строк (cap 500 или усечение
  превью upstream); диалог показывает warning-alert «Предпросмотр
  ограничен… Для полной печати откройте документ в редакторе» и печатает
  только после явного «Печатать показанное».
- `src/lib/markdownPrint.jsx` — `renderToStaticMarkup` того же
  ReactMarkdown-пайплайна; ленивый импорт по клику.
- **`window.print()` удалён полностью.** При ошибке — Alert
  «Не удалось распечатать документ» с действиями «Открыть оригинал» /
  «Скачать оригинал» (в рамках существующих прав `onDownloadOriginal`/
  `canDownloadOriginal`). Успех не заявляется по факту создания iframe:
  `runIframePrint` резолвится только после реального `win.print()`, ошибки
  load/print пробрасываются наружу.

### HUB Desktop (`document.print`)

Новое сообщение протокола (version 1), capability `print-document`:

- `DesktopBridgeProtocol`: `document.print` {requestId, kind∈{pdf,html},
  url, title} — строгий парсер (`HasExactProperties`, blob: URL только для
  kind=pdf, url обязан быть пуст для html, лимиты 2048/256); ответ
  `document.printResult` {requestId, status∈dialog-opened|external-opened|
  failed|too-large|unavailable}.
- `DesktopBridgeHost`: событие `DocumentPrintRequested` с
  `Completion: Task<string>` — статус уходит в `document.printResult`.
- `DesktopPrintService.PrintDocumentAsync`:
  - gate `CanPrintCurrent` (та же доверенная-страница политика, что и у
    печати страницы);
  - **PDF**: свежий скрытый WebView2-хост → `Navigate(blob:URL)` →
    `ShowPrintUI(System)` — нативный системный диалог печатает сам
    PDF-документ. Пул хостов (до 3) — каждый запрос получает свой хост,
    гонки двух открытых диалогов нет;
  - **fallback**: навигация не удалась → байты blob вытягиваются fetch'ем в
    основном webview (проверка `%PDF-`, лимит 64 МБ) → временный файл в
    `%TEMP%\hub-print` → открытие системным PDF-просмотрщиком
    (`external-opened`); старые файлы выметаются >24 ч;
  - **HTML**: `window.__hubPendingPrintHtml` (ставит JS до отправки
    сообщения, лимит 8 МБ) → `NavigateToString` в том же хосте →
    `ShowPrintUI(System)`;
  - `document.printCurrent`/`TryPrintCurrent` **сохранены** — печать
    текущей доверенной страницы портала отдельной командой.
- Старый Desktop без `print-document`-capability: диалог показывает
  «Не удалось распечатать» — DOM портала не печатается.

## 4. Проверки

До: `print-before*.pdf` — 2 страницы вместо 1/3, chrome диалога, растр,
альбомная страница в портрете.

После (headed Chrome на стенде, фикстуры `prt-a4x3.pdf`, `prt-a4-land.pdf`,
`prt-a3.pdf`):

- Dispatch: кнопка «Печать» монтирует скрытый iframe `ct=application/pdf`
  для всех трёх фикстур; `window.print()` не вызывается.
- Два одновременно открытых документа → два iframe, два вызова `print()`.
- Битый источник: `runIframePrint` резолвится ошибкой по таймауту → Alert.
- CDP `Page.printToPDF` **не воспроизводит** нативную печать PDF-плагина
  (печатает страницу-обёртку 612×792) — итоговый вывод печати проверяется
  вручную через системный диалог / Microsoft Print to PDF (см. §7).

Тесты: `documentPrint.test.js` 5/5, `desktopBridge.test.js` 39/39,
`DocumentPreviewDialog.test.jsx` 14/14 (desktop-capability путь, ошибка с
кнопкой скачивания, desktop-unsupported, warning для усечённых листов,
запрет `window.print`), `excelPreview.test.js` — totalRows. C#:
`DesktopBridgeProtocolTests` + `DesktopPrintServiceTests` 140/140
(парсер document.print, capabilities, gate `unavailable` без WebView2).
Trial `vite build` — чистый; `dotnet build Hub.Desktop` Release — 0
ошибок/предупреждений.

## 5. Безопасность

- Печатается уже авторизованный blob (ACL соблюдено на fetch-этапе);
  новых сетевых запросов и публичных URL нет.
- `srcdoc` собирается из sanitize-конвейера / экранированного текста;
  заголовок `escapeHtml`.
- Bridge: строгая валидация входящего `document.print` — blob: URL только
  у PDF-команды, внешние http(s)-URL отклоняются на уровне протокола;
  result-валидация по точному набору ключей и `requestId`.
- Внешний fallback пишет только в `%TEMP%\hub-print` с санитизированным
  именем файла (48 символов, `[A-Za-z0-9 _-]`), открывает через
  `UseShellExecute` без аргументов — командная инъекция исключена.
- Временные blob-URL отзываются; содержимое в логи и `localStorage` не
  пишется.

## 6. Производительность

Печать PDF не переконвертирует и не перекачивает файл — переиспользуется
objectUrl уже загруженного превью. HTML-путь ограничен размером уже
полученного текста (лимит превью 8 МБ). Внешний Desktop-fallback —
base64-транспорт, ограничен 64 МБ; выше — `too-large` с понятным текстом.

## 7. Открытые вопросы

- Итоговый растр/вектор печати нативным пайплайном (реальный Microsoft
  Print to PDF) — верифицируется вручную: CDP `printToPDF` печатает
  обёртку плагина и не подходит для сравнения MediaBox. Сценарии: A4×3,
  landscape, A3, текстовый слой, отмена, два документа.
- WebView2 `Navigate(blob:)`: если в целевой сборке навигация на
  blob-objectURL недоступна, автоматически сработает external-opened —
  проверить на живом Desktop при приёмке.
- ONLYOFFICE-печать больших XLSX остаётся предпочтительным путём полного
  документа; preview-печать таблиц — заведомо ограниченная и теперь явно
  предупреждает.
- Печать из чат-превью вложений (canvas `chatAttachmentPreview`) — вне
  скоупа.

## 8. Решение

**GO по коду**: дефект устранён архитектурно — печать идёт исходными
страницами документа через нативный пайплайн (браузерный PDF-viewer либо
отдельный WebView2/системный просмотрщик); DOM портала и preview-canvas
больше не участвуют; `window.print()`-fallback удалён; усечение таблиц
явно предупреждается. Финальное подтверждение — ручная распечатка по
чек-листу §7.
