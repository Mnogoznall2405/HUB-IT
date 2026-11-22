# Отчёт Агента E — надёжность и безопасность web-фронтенда HUB-IT

Дата: 2026-11-22. Режим: статический read-only аудит (чтение файлов + grep/rg-паттерны). Прод-сервер не изменялся, сборки/тесты/рестарты не запускались, активных атак не проводилось. Секреты и персональные данные не цитируются.

Область: `WEB-itinvent/frontend` — `src/App.jsx`, `src/contexts/AuthContext.jsx`, `src/api/http.js` (+ фасад `client.js`), `src/main.jsx`, `index.html`, `public/web.config`, `public/sw.js`, markdown-рендер (`MarkdownRenderer.jsx`, `VoiceMeetingSummary.jsx`), rich-контент Mail/Chat/MyFiles/KB, `taskRichText.js`, `MobileCreateDescriptionEditor.jsx`, print-путь почты, зависимости (`package.json`).

Статусы: **Confirmed** — подтверждено чтением кода (воспроизведение в рантайме не выполнялось, это статический аудит); **Suspected** — требует рантайм- или backend-проверки.

---

## 1. Сводка находок

| # | Категория | Серьёзность | Статус | Место | Backend-проверка |
|---|-----------|-------------|--------|-------|------------------|
| E-1 | XSS (self-XSS через paste) | Средняя | Confirmed | `MobileCreateDescriptionEditor.jsx:84` | Нет (клиент) |
| E-2 | CSP не enforced | Низкая (рекомендация) | Confirmed | `public/web.config:186` | Частично (заголовки API) |
| E-3 | Вложения письма без клиентского контроля размера | Низкая (надёжность) | Confirmed | `MailComposeHost.jsx:993-1008` | Да (лимиты сервера/IIS) |
| E-4 | ReactMarkdown без rehype-sanitize | Низкая | Confirmed | `VoiceMeetingSummary.jsx:301` | Нет |
| E-5 | target="_blank" в подписи без доп. rel из sanitizeMailHtmlFragment | Низкая | Confirmed | `mailHtmlContent.js:23-24,80-92` → `AiMailActionEditDialog.jsx:186` | Нет |
| E-6 | Клиентские права (routePermissions/hasPermission) — только UX; admin-bypass и alwaysGrantedPermissions | Инфо (требует backend-сверки) | Confirmed | `AuthContext.jsx:17-34,702-704`; `App.jsx:108-149` | **Да, обязательно** |
| E-7 | Нет глобального window.onerror / сбора клиентских ошибок | Низкая (надёжность) | Confirmed | `main.jsx:44-54` | Нет |
| E-8 | Сырые axios-сообщения в UI как fallback | Низкая | Confirmed | `mailErrorModel.js:20-23,72-74` | Да (формат detail) |
| E-9 | 403 приравнивается к «сессия отклонена» → logout | Низкая | Suspected | `http.js:186-189`, `AuthContext.jsx:171-174` | Да (когда сервер отдаёт 403 на /me) |
| E-10 | quill 2.0.2 pinned; npm audit не проводился | Инфо | Confirmed (факт pin) | `package.json:42` | Нет |
| E-11 | chat:request-debug логирует URL запросов в консоль | Инфо | Confirmed | `http.js:79-133` | Нет |
| E-12 | window.open same-origin без noopener (непоследовательность) | Инфо | Confirmed | `MyFiles.jsx:401` | Нет |
| E-13 | drawio postMessage: при невалидном URL origin='' → ответ с '*' | Инфо | Suspected (edge) | `ObjectNetmapTab.jsx:122-135`, `drawio.js:72-79` | Нет |
| E-14 | is_html=true при plain-text body в AI-письме | Низкая | Suspected | `AiMailActionEditDialog.jsx:126-127` | **Да** |

Позитивные проверки (проблем не найдено): см. раздел 4.

---

## 2. Детальные находки

### E-1. contentEditable без санитайзера вставки (paste) — XSS-окно в мобильном редакторе описания задачи

- **Категория:** XSS / опасный HTML.
- **Серьёзность:** Средняя.
- **Файлы:** `src/components/hub/tasks/MobileCreateDescriptionEditor.jsx:27-33, 84-91`.
- **Статус:** Confirmed (по коду; исполнение в рантайме не проверялось).
- **Цитата:**
```jsx
useEffect(() => {
  const editor = editorRef.current;
  if (!editor) return;
  editor.innerHTML = markdownToEditorHtml(initialValue);   // вход экранируется
  ...
}, [initialValue, onDraftChange, resetKey]);
...
<Box ref={editorRef} component="div" contentEditable suppressContentEditableWarning
  onInput={syncDraft} ... />
```
- **Объяснение:** начальное значение проходит через `taskRichText.markdownToEditorHtml`, который корректно экранирует HTML (`escapeEditorHtml`) и разрешает только whitelist-теги (`a/strong/em/s/li/ul/ol/div`), а `sanitizeLinkHref` допускает только `http(s)://`, `mailto:`, `tel:`, `/`, `#`. Чтение тоже безопасно (`editorHtmlToMarkdown` конвертирует DOM в текст/markdown, неизвестные теги дают только текстовое содержимое).
  Опасен **путь вставки**: у contentEditable-элемента нет обработчика `onPaste` (в файле отсутствует, единственный `contentEditable` в кодовой базе). При вставке HTML из буфера обмена браузер вставляет разметку как есть в DOM origin приложения — события `onerror`/`onload` вставленных элементов (например `<img src=x onerror=...>`) могут исполниться в момент вставки, до конвертации в markdown.
- **Воздействие:** исполнение скрипта в origin портала. Практический вектор — social engineering («скопируйте этот текст в описание задачи»): жертва вставляет вредоносный фрагмент в собственный редактор. Данные при сохранении нейтрализуются, но исполнение происходит в момент вставки. Аналогичный редактор почты (`MailRichTextEditor.jsx:161-192`) paste перехватывает и санирует (`sanitizeComposePasteHtml` → DOMPurify) — здесь этой защиты нет.
- **Рекомендация:** обработчик paste по образцу `MailRichTextEditor` (preventDefault + `sanitizeComposePasteHtml`) либо вставка только `text/plain`.
- **Требует backend-проверки:** нет (чисто клиентский sink).

### E-2. CSP включён только как Report-Only

- **Категория:** CSP/заголовки.
- **Серьёзность:** Низкая (рекомендация; при обнаруженном XSS защиты нет).
- **Файл:** `public/web.config:178-188`.
- **Статус:** Confirmed.
- **Цитата:**
```xml
<add name="X-Content-Type-Options" value="nosniff" />
<add name="X-Frame-Options" value="SAMEORIGIN" />
<add name="Referrer-Policy" value="no-referrer" />
<!-- CSP в report-only ... Перед переводом в enforce проверить портал и свернуть отчёты нарушений. -->
<add name="Content-Security-Policy-Report-Only" value="default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' data: blob:; connect-src 'self' ws: wss:; object-src 'none'; frame-ancestors 'self'" />
<add name="Permissions-Policy" value="camera=(self), microphone=(self), geolocation=()" />
```
- **Объяснение:** прочие заголовки (nosniff, XFO SAMEORIGIN, Referrer-Policy no-referrer, Permissions-Policy) enforced; CSP — только отчёты. Политика уже учитывает ограничения MUI/Emotion (`style-src 'unsafe-inline'`), QR 2FA (`img-src data: blob:`), WS (`connect-src ws: wss:`). Комментарий в конфиге сам фиксирует план: сверить отчёты и перевести в enforce.
- **Воздействие:** при любой будущей XSS-регрессии (например E-1) CSP не остановит инлайн-исполнение. Сейчас это не уязвимость, а нереализованный слой защиты.
- **Рекомендация:** собрать Report-Only нарушения за репрезентативный период, затем включить enforce. Проверить, что CSP не ломает: ONLYOFFICE/LiveKit ходят через same-origin прокси (уже в `default-src 'self'`), drawio embed — внешний iframe (требует `frame-src https://embed.diagrams.net` при enforce; в текущей политике frame-src не задан и наследует default-src 'self' → enforce сломает drawio-редактор, если не добавить frame-src). Это существенное «что сломает», фиксирую явно.
- **Требует backend-проверки:** частично — заголовки для `/api/*` отдаёт FastAPI/прокси-бэкенды, их CSP/XFO вне этого файла.

### E-3. Почтовые вложения: нет клиентской проверки размера/типа/количества

- **Категория:** файлы / надёжность.
- **Серьёзность:** Низкая (надёжность UX), в связке с лимитом IIS — до средней.
- **Файл:** `src/components/mail/MailComposeHost.jsx:993-1008`.
- **Статус:** Confirmed.
- **Цитата:**
```jsx
onDrop={(event) => {
  event.preventDefault();
  patchComposeState((current) => ({
    composeDragActive: false,
    composeFiles: Array.from(event.dataTransfer?.files || []).length > 0
      ? [...current.composeFiles, ...Array.from(event.dataTransfer?.files || [])]
      : current.composeFiles,
  }));
}},
onFileChange={(event) => {
  const files = Array.from(event.target.files || []);
  patchComposeState((current) => ({
    composeFiles: files.length > 0 ? [...current.composeFiles, ...files] : current.composeFiles,
  }));
  event.target.value = '';
}},
```
- **Объяснение:** файлы добавляются без ограничения размера, расширения и количества (инпут в `MailComposeDialog.jsx:1391` — `type="file" multiple` без `accept`). При этом IIS режет запрос: `web.config:12-16` → `maxAllowedContentLength="67108864"` (64 МБ). Для сравнения, в чате есть лимиты (`chatHelpers.js:10-11` — 1 ГБ суммарно, 5 файлов; `FeedComposerDialog.jsx:345` — 20 МБ; `ImportDialog.jsx:34` — 50 МБ).
- **Воздействие:** пользователь может приложить файл на сотни МБ; отправка начнёт загружать весь multipart, затем упадёт по лимиту IIS (413/404.13) или таймауту с неочевидной диагностикой. Отправка письма сорвётся «на ровном месте», черновик останется без вложения.
- **Рекомендация:** клиентский пре-чек размера (сумма `composeFiles` + draft/forward вложения) и понятное сообщение до отправки.
- **Требует backend-проверки:** да — фактический лимит FastAPI для `sendMessageMultipart` и предельное число вложений; клиентский чек должен соответствовать серверному.

### E-4. ReactMarkdown без rehype-sanitize в сводке встреч Voice

- **Категория:** XSS / markdown.
- **Серьёзность:** Низкая.
- **Файл:** `src/pages/voice-video/VoiceMeetingSummary.jsx:301`.
- **Статус:** Confirmed.
- **Цитата:** `<ReactMarkdown>{shownSummary}</ReactMarkdown>` — без `rehypePlugins` (ср. `MarkdownRenderer.jsx:12` → `[rehypeSanitize]`).
- **Объяснение:** сам по себе react-markdown v9 не рендерит сырой HTML (нет `rehype-raw`) и применяет безопасный дефолтный `urlTransform` (блокирует `javascript:`). Т.е. прямого XSS нет — находка про зависимость от дефолтов библиотеки и расхождение с остальным порталом: если кто-то позже добавит `rehype-raw` или «onerror-безопасность» изменится в новой мажорной версии, этот вызов останется беззащитным.
- **Воздействие:** потенциальное (нет при текущих версиях).
- **Рекомендация:** перейти на общий `MarkdownRenderer` или добавить `rehypeSanitize`.
- **Требует backend-проверки:** нет.

### E-5. Ссылки из HTML-подписи: target="_blank" сохраняется без гарантированного rel=noopener

- **Категория:** целевые окна.
- **Серьёзность:** Низкая (современные браузеры неявно применяют noopener для `target=_blank`).
- **Файлы:** `src/components/mail/mailHtmlContent.js:23-24, 80-92` (конфиг DOMPurify), `src/pages/chat/AiMailActionEditDialog.jsx:96,186` (рендер подписи).
- **Статус:** Confirmed (механика в коде; практическое воздействие снижено браузерами).
- **Цитата:** ADD_ATTR включает `'target'` и `'rel'`; `sanitizeMailHtmlFragment` не добавляет rel сам:
```js
return DOMPurify.sanitize(source, {
  USE_PROFILES: { html: true },
  FORBID_TAGS: ['script','style','iframe','object','embed','link','meta','form','input','button','select','textarea'],
  FORBID_ATTR: ['srcdoc'],
  ADD_ATTR: MAIL_PRESENTATION_ATTRS,   // ... 'target', 'rel'
});
```
- **Объяснение:** гарантия `noopener noreferrer` для target=_blank есть только в пути `buildRenderedMailHtml` — `applySafeBlankLinkRel` (`mailHtmlContent.js:133-146`) вызывается из `blockRemoteMailResources`. Диалог AI-письма рендерит подпись через «голый» `sanitizeMailHtmlFragment` (`safeSignatureHtml`): ссылка в подписи пользователя с `target="_blank"` пройдёт без добавления rel.
- **Воздействие:** reverse tabnabbing (открытая вкладка получает `window.opener`) — актуально только для очень старых браузеров; Chrome≥88/Firefox≥79/Safari≥12.1 неявно изолируют opener. Плюс локальная несогласованность санитайз-конфигурации.
- **Рекомендация:** перенести `applySafeBlankLinkRel` внутрь `sanitizeMailHtmlFragment`, чтобы все потребители получали единую гарантию.
- **Требует backend-проверки:** нет.

### E-6. Клиентские права — только UX-слой; доверие role/permissions из /me

- **Категория:** авторизация (клиент).
- **Серьёзность:** Инфо как уязвимость; **обязательна backend-сверка**.
- **Файлы:** `src/contexts/AuthContext.jsx:17-34` (alwaysGrantedPermissions), `35-130` (rolePermissionFallback), `132-141` и `698-707` (`hasPermission`: `role==='admin'` → `true` без списка прав), `src/App.jsx:108-149` (routePermissions), `260-273` (PermissionRoute, adminOnly: `/dlp`, `/file-egress`).
- **Статус:** Confirmed.
- **Цитата:**
```js
if (String(user?.role || '').trim().toLowerCase() === 'admin') {
  return true;
}
```
и
```js
const permissions = [...new Set([...rawPermissions..., ...alwaysGrantedPermissions])];
```
- **Объяснение:** все проверки (`routePermissions`, `PermissionRoute`, `hasPermission`) работают с объектом `user` из ответа `/auth/me`, кэш которого лежит в `localStorage['user']` (`AuthContext.jsx:225`). Это корректный UX-слой, но:
  1) любой пользователь может отредактировать `localStorage['user']` в DevTools и увидеть скрытые разделы/кнопки (данные не секретны, но UI «раскроется»);
  2) `alwaysGrantedPermissions` принудительно даёт **всем** ролям `mail.access`, `my_files.write`, `my_files.share`, `tasks.create` и др. — если серверная модель прав для какой-то роли строже, UI покажет функции, которые упадут с 403;
  3) если сервер не прислал массив `permissions`, клиент сам назначает права по роли (`rolePermissionFallback`) — расхождение списков остаётся незамеченным.
- **Воздействие:** не само по себе (сервер должен отклонять), но маскирует несогласованность: «функция видна → должна работать».
- **Требует backend-проверки: ДА (главный вывод находки).** Для каждого маршрута из `routePermissions` и adminOnly-разделов (`/dlp`, `/file-egress`, а также admin-области: `settings.users.manage`, `ad_users.*`, `tickets.personal_data.read`, `address_book.*` — персональные данные!) убедиться, что соответствующие серверные эндпоинты требуют те же права/роль, независимо от клиентских списков. Отдельно сверить: всегда ли сервер выдаёт `permissions` (чтобы fallback по роли не применялся в проде), и совпадает ли серверный минимум с `alwaysGrantedPermissions`.

### E-7. Нет глобального сбора ошибок (window.onerror / общий unhandledrejection)

- **Категория:** обработка ошибок.
- **Серьёзность:** Низкая (надёжность/наблюдаемость).
- **Файлы:** `src/main.jsx:44-54`, `src/components/feedback/RootErrorBoundary.jsx`, `src/App.jsx:308-388` (RouteErrorBoundary).
- **Статус:** Confirmed.
- **Цитата:** `unhandledrejection` обрабатывает только chunk-ошибки:
```js
if (message.includes('Failed to fetch dynamically imported module')) { ... tryRecoverChunkLoad(message); }
```
- **Объяснение:** рендер покрыт хорошо: RootErrorBoundary (глобальный, до провайдеров) + RouteErrorBoundary на маршрутах с распознаванием chunk-ошибок и recovery. Но ошибки в event-handlers/промисах вне React-дерева не попадают ни в один обработчик — только в консоль (`console.error(...)` разбросан по ~40 файлам). Единственная клиентская телеметрия — `auth/session-telemetry` для auth-событий (`http.js:203-224`).
- **Воздействие:** «тихие» отказы (например, сохранение в `PreferencesContext.jsx:297` падает — пользователь может не заметить) не наблюдаемы; диагностика прод-инцидентов опирается на консоль пользователя.
- **Рекомендация:** единый `window.addEventListener('error'/'unhandledrejection')` с bounded-телеметрией на существующий `/auth/session-telemetry`-паттерн или отдельный endpoint (без данных из стека).
- **Требует backend-проверки:** нет (если не появится endpoint телеметрии — тогда да).

### E-8. Сырые axios-сообщения могут попасть в UI

- **Категория:** отображение ошибок.
- **Серьёзность:** Низкая.
- **Файл:** `src/components/mail/mailErrorModel.js:16-24, 72-74`.
- **Статус:** Confirmed (фолбэк в коде); практическое проявление зависит от ответов сервера.
- **Цитата:**
```js
if (typeof requestError?.message === 'string' && requestError.message.trim()) {
  return requestError.message.trim();   // "Request failed with status code 500" / "Network Error"
}
...
if (!/^<!doctype html/i.test(text) && !/^<html/i.test(text)) {
  return text;                          // произвольный непустой текст ответа — пользователю как есть
}
```
- **Объяснение:** основная цепочка аккуратная (detail → detail.message → fallback-текст на русском), HTML-заглушки IIS отфильтрованы. Но: (а) при отсутствии detail пользователь увидит англ. axios-строку; (б) если сервер ответил не-JSON и не-`<html`-текстом (стек? внутренний текст прокси?), он будет показан целиком.
- **Воздействие:** «Request failed with status code 500» вместо человеческого сообщения; в худшем случае — служебный текст ответа в UI.
- **Рекомендация:** `requestError.message` переводить в фиксированные русские строки по `err.code`/статусу; не-HTML-текст из ответа показывать только при явном whiteliste content-type.
- **Требует backend-проверки:** да — убедиться, что FastAPI на 5xx отдаёт JSON `detail` (тогда ветка с сырым текстом практически недостижима).

### E-9. 403 приравнен к «сессия отклонена»

- **Категория:** обработка ошибок / auth.
- **Серьёзность:** Низкая.
- **Файлы:** `src/api/http.js:186-189` (`isDefinitiveAuthRejection`: 401 **или 403**), `src/contexts/AuthContext.jsx:171-174` (то же), `256-258` (refreshSession → `invalidateSession()`).
- **Статус:** Suspected (поведение в коде подтверждено; частота зависит от сервера).
- **Объяснение:** при обновлении сессии (`/me` через `refreshSession`) любой 403 оформляется как «сессии нет»: `invalidateSession()` → разлогин с очисткой кэшей. 403 классически означает «нет прав», а не «не авторизован». Если сервер когда-либо отдаёт 403 на `/me`-эндпоинт (например, для деактивированного, но аутентифицированного пользователя), эффект — правильный logout; но при 403 из-за прав это лишний logout всех вкладок.
- **Воздействие:** редкие незапланированные logout.
- **Требует backend-проверки:** да — уточнить, отдаёт ли auth-цепочка сервера 403 на `/auth/me`/refresh и в каких случаях; если только 401 — риск чисто теоретический.

### E-10. quill 2.0.2 (pin) — использование обёрнуто санитайзерами

- **Категория:** зависимости.
- **Серьёзность:** Инфо.
- **Файл:** `package.json:42` (`"quill": "2.0.2"` — точный pin), использование — `MailRichTextEditor.jsx`, `MailSignatureDialog.jsx`.
- **Статус:** Confirmed (факт версии и обвязки).
- **Объяснение:** Quill имеет историю XSS-отчётов (в т.ч. через вставку HTML). Здесь все входы/выходы обёрнуты: paste перехватывается на root в capture-фазе и вставляется через `sanitizeComposePasteHtml` (удаление `script/style/iframe/object/embed/link/meta`, блокировка remote/data-картинок, затем DOMPurify) — `MailRichTextEditor.jsx:161-192`; программная установка — `setQuillHtml` → `sanitizeComposePasteHtml` (`:45-59`); отправка — `buildPortableComposeHtml` → `sanitizeMailHtmlFragment` (`mailComposeHtml.js:130-147`). Т.е. даже при уязвимости quill-вставки полезный sink закрыт.
- **Воздействие:** ограничено; риск остаётся в самом редакторе до обновления.
- **Рекомендация:** периодически прогонять `npm audit --package-lock-only` (на dev-машине, не на прод-сервере; в этом аудите не выполнялось — read-only и нет гарантии сетевого доступа) и отслеживать релизы quill 2.x. `emoji-picker-react@4.18` и `html5-qrcode@2.3.8` рендерят выбор эмодзи/результат QR как React-текст (не HTML-ввод пользователя) — повышенного риска не вижу (`ChatEmojiPanel.jsx`, `QrScannerDialog.jsx:171` — `{result.substring(0, 100)}`).
- **Требует backend-проверки:** нет.

### E-11. Opt-in debug-логирование URL запросов чата

- **Категория:** логирование.
- **Серьёзность:** Инфо.
- **Файл:** `src/api/http.js:79-133`.
- **Статус:** Confirmed.
- **Объяснение:** при `localStorage['chat:request-debug']='1'` и pathname `/chat` все запросы логируются в `console.log` с URL+query (могут содержать поисковые строки пользователя) и в `window.__chatRequestLog`. Включается только вручную, токены в URL не попадают (auth — cookie).
- **Воздействие:** минимальное; содержимое консоли может увидеть человек за машиной или расширение браузера.
- **Требует backend-проверки:** нет.

### E-12. window.open same-origin без noopener

- **Категория:** целевые окна (непоследовательность).
- **Серьёзность:** Инфо.
- **Файл:** `src/pages/MyFiles.jsx:401` — `window.open(`${buildEditorUrl(fileId)}${suffix}`, '_blank')` (same-origin редактор). Все прочие ~20 вызовов `window.open` в кодовой базе идут с `'noopener,noreferrer'`.
- **Статус:** Confirmed.
- **Воздействие:** практически нулевое (тот же origin, редактор не обращается к opener). Рекомендация: единый паттерн с `noopener` для гигиены.
- **Требует backend-проверки:** нет.

### E-13. drawio-мост: при невалидном конфиге origin='' ответ уходит на '*'

- **Категория:** postMessage.
- **Серьёзность:** Инфо (edge-конфигурация).
- **Файлы:** `src/components/itObjects/ObjectNetmapTab.jsx:122-135`, `src/lib/drawio.js:72-79`.
- **Статус:** Suspected (только если `VITE_DRAWIO_EDITOR_URL` задан невалидной строкой).
- **Цитата:**
```js
if (origin && event.origin !== origin) return;   // при origin='' проверка пропускается
...
iframe.contentWindow.postMessage(JSON.stringify({ action: 'load', xml, ... }), origin || '*');
```
- **Объяснение:** `drawioOrigin()` при невалидном URL возвращает `''`; тогда обработчик не сверяет origin, а ответ уходит на `'*'`. Критическая гарантия остаётся: `event.source !== iframe.contentWindow` отсекает любые посторонние окна, поэтому реального вектора я не вижу. При дефолте (`https://embed.diagrams.net`) origin валиден.
- **Рекомендация:** при пустом origin вовсе не отвечать (fail-closed) вместо `'*'`.
- **Требует backend-проверки:** нет.

### E-14. AI-письмо: plain-text body помечается is_html=true

- **Категория:** инъекция HTML (межслойная).
- **Серьёзность:** Низкая.
- **Файл:** `src/pages/chat/AiMailActionEditDialog.jsx:119-129`.
- **Статус:** Suspected (клиентский факт Confirmed: `body` — строка из TextField; вопрос к серверу).
- **Цитата:**
```js
body: String(draft.body || ''),
...
is_html: true,
```
- **Объяснение:** тело редактируется как plain text (мультистрочный TextField), но отправляется с флагом HTML. Если сервер при `is_html` вставляет body в HTML-письмо без экранирования, пользовательские `<` получатель увидит как разметку (самоинъекция отправителя; также ломает вид письма). Отправитель=автор, поэтому это не чужая инъекция, но согласованность контракта стоит проверить.
- **Требует backend-проверки: ДА** — экранирует ли сервер plain-body при `is_html=true` (или клиент должен отправлять `is_html:false`).

---

## 3. Что проверено и подтверждённо защищено

**XSS / опасный HTML.** Все 4 продакшн-вхождения `dangerouslySetInnerHTML` санируются через единую `sanitizeMailHtmlFragment` (DOMPurify: `USE_PROFILES html` + FORBID_TAGS script/style/iframe/object/embed/link/meta/form/input/button/select/textarea + `FORBID_ATTR srcdoc`):
- `AiMailActionEditDialog.jsx:186` (подпись), `MailComposeDialog.jsx:1265` (цитата), `:1311` (итоговый предпросмотр — через `buildOutgoingMailPreviewHtml` → sanitize), `MailSignatureDialog.jsx:111` (превью подписи). Тест `MailHtmlBody.test.jsx:29` прямо запрещает inline fallback.
- Входящий просмотр письма: `buildRenderedMailHtml` (`mailHtmlContent.js:451-534`) — блокировка remote-каринок и CSS-URL (анти-трекинг), `applySafeBlankLinkRel` для target=_blank, снятие position:fixed/z-index (`stripMailOverlayStyles` — анти-overlay-спуфинг), затем финальный DOMPurify.
- Markdown: `MarkdownRenderer.jsx` — `rehype-sanitize` (+ chat-emoji-плагин строго ПОСЛЕ санитайзера), ссылки `target="_blank" rel="noopener noreferrer"`.
- Ручной markdown→HTML в задачах: `taskRichText.js:1-28` — экранирование входа, whitelist-теги, `sanitizeLinkHref` (только http(s)/mailto/tel/относительные; `javascript:` отфильтрован).
- `editorHtmlToMarkdown` (`taskRichText.js:106-107`) — `container.innerHTML` используется для парсинга уже экранированного содержимого собственного редактора, не sink для чужого ввода.
- Print-окно: `useMailMessageFileActions.js:150-173` — `document.write` только в blank-окно, `opener=null` до записи; `buildPrintMailDocumentHtml` (`mailMessageFileActions.js:327-358`) экранирует subject/sender/date, тело — из санированного `buildRenderedMailHtml`.
- `document.execCommand` — только форматирование в собственном редакторе (`MobileCreateDescriptionEditor.jsx:40-54`); клипов IoT-стиля нет.
- `eval`/`new Function` — только в тестах (`uiAuditRegressions.test.jsx`, `serviceWorker*.test.js`, `requestOrdering.regression.test.jsx`), в рантайм-коде отсутствуют.

**Целевые окна.** Все 27 JSX-вхождений `target="_blank"` проверены построчно: имеют `rel="noopener noreferrer"` / `rel="noreferrer"` (последний имплицитно noopener) / `rel="noopener"` — расхождений не найдено (Docflow, KB, Mfu, Chat*, PasswordExpiryTable, SharedFolder, Feed*, Voice*, KnowledgeBase, Networks). `window.open` — везде `'noopener,noreferrer'`, кроме E-12. Print/blob-окна: `opener = null` перед записью (`useMailMessageFileActions.js:168`, `mailMessageFileActions.js:310`).

**postMessage-обработчики.** Окно: `ObjectNetmapTab.jsx` — `event.source === iframe.contentWindow` + origin-проверка (E-13 — edge); `desktopBridge.js:713` — WebView2-транспорт, строгая валидация формата сообщений; `pwaInstall.js`/`AuthenticatedBootstraps.jsx` — слушают своего SW (same-origin). SW (`sw.js:1235-1315`): приватные команды (`itinvent:private-media-session`, `itinvent:chat-clear-conversation-notifications`) защищены `isTrustedClientMessage` (origin+source); остальные команды без origin-чека, но SW по спецификации получает сообщения только от same-origin клиентов, некритичных команд нет.

**Токены.** JWT не хранится в localStorage/sessionStorage (поиск по `access_token|Bearer|refresh_token` — единственное вхождение в blacklist параметров `desktopProtocolHandoff.js:37-49`, корректно отфильтровывает их из handoff-URL). Auth — cookie-based: `apiClient` с `withCredentials: true` (`http.js:194-201`), silent refresh каждые ~12 мин (`AuthContext.jsx:471-508`), refresh при 401 с fan-out guard и телеметрией (`http.js:311-380`), `refreshInFlight`-дедуп. В localStorage — только `user` (role/permissions, несекретно, см. E-6), preferences и флаги. Секретов в логах/отчёте нет.

**Клиентские права.** routePermissions/PermissionRoute/hasPermission — подтверждены как UX-слой (E-6 требует серверной сверки), редиректы на первый доступный раздел корректны; `/shared-files/<token>` — публичный маршрут вне ProtectedRoute.

**Обработка ошибок.** RootErrorBoundary — глобальный (обёртывает всех провайдеров, plain-DOM fallback); RouteErrorBoundary — на маршрутах, с recovery от chunk-ошибок (`routeChunkRecovery`, `vite:preloadError` в `main.jsx:35-54`). 401-цепочка: refresh → retry → `auth-required` → `invalidateSession` (полная очистка кэшей/драфтов, `logoutDataSweep`) → redirect `/login` c сохранением return-path; залипающего loading в AuthContext нет (retry 1с→30с, `definitiveRejection`, реакция на online/focus/visibility). Межвкладочная синхронизация через `storage`-событие. `catch {}` — массово присутствует, но все проверенные случаи — best-effort вокруг localStorage/clipboard/кэшей (например `ChatBubble.jsx:377` — clipboard, `useTaskAssigneeDirectory.js:135` — fallback на кэш), ошибок пользователей не глотают.

**Файлы.** Лимиты есть: чат (`chatHelpers.js:10-11`), Feed 20 МБ, ImportDialog 50 МБ, VoiceUpload `maxBytes`, MyFiles — чанковая загрузка до 400 ГБ (`api/myFiles.js:18`, `resumablePhotoUpload.js`). `revokeObjectURL` — повсеместно (MyFiles, Docflow, Networks, Statistics, ScanCenter, voice, tasks, mail, chat), включая отложенный revoke для download-fallback; утечек blob-URL не нашёл. `accept` задан почти везде (E-3 — почта). Некорректные имена: `downloadBlobFile` → `link.download = String(filename || 'attachment.bin')` — безопасно. QR-результат рендерится React-текстом.

**SW.** Кэши версионированы (`APP_SHELL_CACHE='hubit-app-shell-v<timestamp>'`), `cleanupOldCaches` на activate; `skipWaiting` только по явному сообщению клиента (осознанная политика, `main.jsx:76-78`), `registration.update()` при старте; navigation — network-first с fallback на 502/503/504/offline-shell; статические ассеты — content-hash `/assets/*` с годичным кэшем (устаревание исключено; для нескольких корневых иконок PWA возможен отложенный апдейт — minor). index.html и sw.js — `no-cache` (`web.config:201-225`). Приватные медиа чата — per-user кэш с очисткой при logout (`clearPrivateMediaCaches`, вызов из AuthContext через `synchronizePrivateMediaSession`). Периодических уведомлений нет (только push-события с дедупом и очередью).

**Зависимости.** react-markdown ^9 + rehype-sanitize ^6 — безопасный стек; dompurify ^3.4.2; html5-qrcode/emoji-picker-react — только React-текст (см. E-10).

---

## 4. Что осталось непроверенным (ограничения метода)

1. **Рантайм-верификация не проводилась** (прод read-only, без сборки/браузера): все «Confirmed» — статические, по коду. Особенно для E-1 желательно подтвердить исполнение вставленного HTML в реальном браузере (paste как HTML в contentEditable) перед приоритизацией фикса.
2. **Backend-проверки обязательны** для: E-6 (серверная авторизация каждого маршрута/действия, сверка `alwaysGrantedPermissions` и выдача `permissions`), E-3 (лимиты multipart на FastAPI), E-9 (403 на auth-цепочке), E-14 (экранирование plain-body при `is_html`), E-8 (формат 5xx-ответов как JSON detail).
3. **`npm audit` не запускался** (запрещено на прод-сервере; нужен запуск на dev-машине): версии quill 2.0.2, emoji-picker-react 4.18.0, html5-qrcode 2.3.8, pdfjs-dist 6.5.438, xlsx-js-style 1.2.0 не сверены с базой advisories.
4. **CSP Report-Only отчёты** (E-2): их фактическое наполнение и влияние enforce (drawio `frame-src`, ONLYOFFICE-прокси, blob: для WS-фолбэков) — нужна выгрузка отчётов и стенд.
5. **Печатная форма** (printWindow) — проверена статически; поведение при заблокированных popup только по коду (`useMailMessageFileActions.js:163-166` — сообщение об ошибке).
6. Файлы `Search.jsx`/`Transfer.jsx`/`Work.jsx` — legacy-файлы без маршрутов; не аудировались глубоко (мертвый код, вне рантайма).
7. Desktop/WebView2-мост (`desktopBridge.js`) — проверен на клиентскую валидацию сообщений; протокол на стороне WPF вне области Агента E.
