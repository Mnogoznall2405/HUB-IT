# Аудит веб-модуля «Мои файлы» — перед редизайном

Дата: 23.11.2026. Ветка: `feat/files-ui-redesign` (от `origin/main` @ `5513db68`).
Метод: статический аудит кода (два параллельных прохода) + снимки живого UI
на e2e-стеке (`.state-oo`, vite 5174 → backend 18002). Скриншоты «до»:
`.codex_tmp/before/myfiles-{1600,1440,1024,768,390}.png`.

## 1. Карта модуля

| Слой | Файлы | Роль |
|---|---|---|
| Страница | `WEB-itinvent/frontend/src/pages/MyFiles.jsx` (2998 строк) | Монолит: весь layout, навигация, таблица/сетка, ~15 диалогов, ~50 состояний |
| Строки/карточки | `components/myFiles/MyFilesListItems.jsx` | `FileRow/FolderRow/FileCard/FolderCard` (memo), `rowGridColumns`, `ownerLabel` |
| Диалоги | `MyFilesLibraryDialog.jsx` (создание+настройка+доступ общей папки, без вкладок), `MyFilesCollaboratorsDialog.jsx` (доступ к файлу/личной папке), `MyFilesShareDialog.jsx` (публичная ссылка), `MyFilesCopyDialog.jsx`, `MyFilesVersionsDialog.jsx`, `MyFileAuditDialog.jsx`, `MyFilesOfficeEditorDialog.jsx` |
| Хуки | `pages/myFiles/useMyFilesUpload.js`, `useMyFilesDownload.js`, `useMyFilesPreviewController.js`, `useMyFilesShares.js` | Загрузка (чанки+resume), скачивание-гранты, превью, публичные ссылки |
| API | `api/myFiles.js`, `api/myFilesLibraries.js`, `api/myFilesOffice.js`, `api/myFilesAdmin.js` | REST `/api/v1/my-files*` |
| Утилиты | `lib/myFilesFilters.js`, `lib/myFilesFolderTree.js`, `lib/myFilesFolderZip.js`, `lib/myFilesPreview.js`, `components/myFiles/myFilesVisual.js` | Фильтры, дерево папок, drag&drop, иконки/цвета типов |

Layout-оболочки: `MainLayout` (глобальная навигация HUB, зона A — не трогаем),
`PageShell`, `PageTopBar` (`MyFiles.jsx:1421-1423`).

## 2. Навигация и состояние выбранной папки

- URL-driven: `useSearchParams` — `view=trash|recent|favorites|shared`, `folder=<id>`, `library=<id>` (`:155-166`). Навигация: `navigateToFolder/View/Trash/Library` (`:579-596`), history-back работает (`replace:false`).
- В URL **не** хранятся: поиск, фильтры, сортировка, выбор; режим список/сетка — в `localStorage['my-files-view']` (`:248`).
- Левая панель (`Paper`, `:1432-1681`): «+ Создать» + меню, «Мой диск», «Недавние», «Избранное», «Корзина», «Доступно мне» (только при `officeStatus.enabled`, `:1561`), секция «Общие папки» + `+`, квота с LinearProgress.
- Хлебные крошки: `Breadcrumbs` `:1814-1844`, корень — «Мой диск»/«Доступно мне»/имя библиотеки.

## 3. Таблица, сетка, поиск, фильтры, сортировка

- Таблица — CSS-grid (не MUI Table): `rowGridColumns` `MyFilesListItems.jsx:109-113` = `40px minmax(0,1fr) 140px 160px 96px 226px` на md. Колонки: checkbox / Название / Владелец / Изменён / Размер / действия.
- Сортировка: `TableSortLabel` ×4 в хедере (`:2126-2160`), `compareRows` `:1116` — клиентская.
- Чанкинг `MY_FILES_RENDER_CHUNK=200` (`:97`, объявлен **между импортами** — стиль-аномалия) + `content-visibility`; виртуализации скроллом нет.
- Фильтры: чипы «Тип» и «Изменено» + Menu (`:1907-1952`); фильтра «Владелец» нет.
- Поиск `:1757-1789`: **двойной** — серверный `q` (debounce 300мс, `:300`) + клиентский `matchesSearch` по имени (`:1110`). В корзине серверный `q` не отправляется (`:298`).
- Сетка: секции «Папки»/«Файлы», `FolderCard/FileCard`, thumbnails через IntersectionObserver (`:1208-1249`).
- Выбор: чекбоксы + select-all; **shift-выделения нет**; выбор сбрасывается при смене папки/вида/**каждого символа поиска** (`:1097`).

## 4. Операции с файлами/папками

- Upload: `useMyFilesUpload` — чанковые сессии с resume, drag&drop зона (`data-testid="my-files-drop-zone"`), «Загрузить файлы/папку», retention-select (скрыт в library).
- Download: `createDownloadGrant` → `triggerNativeDownload`; bulk-download — цикл с success-тостом на файл (спам, `:1332`).
- Move/copy/rename/delete/restore/purge/empty-trash — через `myFilesAPI` мутации + generic confirm-диалог (`:2972`). Copy — отдельный `MyFilesCopyDialog`.
- Контекстное меню: `FileActionsContextMenu` (ПКМ/⋮/клавиша ContextMenu, `:2409`); для папок — **два почти дублирующих Menu** (`:2548` shared-only-«Открыть» и `:2566` полный).
- Bulk: selection-bar `:1954-2007` (Скачать/Переместить/Удалить/Снять выбор).

## 5. Модель доступа (backend-подтверждено)

- Роли library: `view<comment<edit<manage` (`my_files_service.py:126`); на файлах/папках: `view<comment<edit` (`:123`). Owner — вычисляемый, не хранится.
- Слияние direct+department: **max-ранг** по всем грантам (`library_role_locked :851-872`), deny нет; admin → manage.
- Effective-роль на файле в library: manage→owner; иначе max(library-роль, прямой грант, `edit` аплоадеру-члену) (`:1004-1010`).
- `set_members` — только **полная замена** списка (≤200, ≥1 manage, только активные) — `PUT /libraries/{id}/members`. Точечных add/remove нет → last-wins при параллельном редактировании.
- Состав участников видят только менеджеры (404 для остальных). Эндпоинта «эффективный состав» (развёрнутые из департаментов) **нет** — только expand по одному департаменту `/office/groups/{id}/members`.
- Микс пермов: `PUT members` — `my_files.read`+роль, но пикеры требуют `my_files.share` (`/office/groups`) и `chat.read` (`/chat/users`).
- «Доступно мне» = прямые гранты (`?view=shared`), общие папки туда **не** попадают — отдельный список `/libraries`.
- Retention: личные файлы `{0,1,3,7,10,30} дн.`; в library всегда бессрочно (захардкожено `:1434`); квота library — только `quota_bytes` (0=без лимита, нельзя < занятого).

## 6. Подтверждённые проблемы (скриншоты + код)

**Layout:**
1. **На <lg файловая навигация — широкий горизонтальный wrap-блок над списком** (`:1429,1443-1444`): на 1024px съедает ~60% первого экрана, на 390px — ~85%, список файлов под сгибом. Это и есть главная жалоба из задания. Скриншоты `before/myfiles-1024.png`, `myfiles-390.png`.
2. Панель не сворачивается и не превращается в drawer — drawer вообще не используется.

**Таблица:**
3. Перегруженные строки: под именем одновременно чипы «Совместно»/«Ссылка»/«Навсегда»/срок хранения (FileRow) — визуальный шум, теряется имя.
4. Панели сведений о файле нет — детали доступа/сроков смотреть негде, кроме перегруженной строки.
5. Колонка действий 226px — 4-5 иконок на строку всегда на виду (md+).

**Общие папки:**
6. `MyFilesLibraryDialog` — `maxWidth="sm"`, **без вкладок**: название+лимит+добавление сотрудников/подразделений+список+удаление в одну колонку; создание двухстадийное в том же окне.
7. Удаление участника — маленькая иконка; нет контекстного меню «изменить роль/удалить».
8. Пояснения ролей только в Tooltip (hover) — на таче недоступно (у CollaboratorsDialog видимый текст — расхождение).

**Состояния/мелочи:**
9. В сетке корзины пустое состояние показывает иконку папки вместо корзины (`:2284` vs `:2184`) — косметический баг.
10. `useMyFilesDownload`/`useMyFilesShares` вызваны без `isCurrent` — stale-ответы не отсекаются (страница guard поддерживает, но не передаёт, `:271,576`).
11. Дубль `beforeunload` в `useMyFilesUpload.js:130` и `:525`.
12. Мёртвые импорты в `MyFiles.jsx`: `memo`, `isFileActionsKeyboardShortcut`; мёртвые тернарники `myFilesAPI.listTrash ? …`, `listFolders ? …`.
13. Двойная фильтрация поиска: если серверный `q` матчит не только имя — клиентский `matchesSearch` режет валидные результаты (проверить семантику `q` на бэке: ищет по имени — тогда допустимо, но хрупко).
14. `entryAccess` — функция, вызывается 2-4 раза на строку на каждый рендер; `fileMenuAccess/folderMenuAccess` считаются всегда.
15. testid рассинхрон: `my-files-view-list` vs `my-files-view-toggle` (`:1892-1896`).

## 7. Архитектурные ограничения

- `MyFiles.jsx` — 2998 строк, ~50 состояний, ~15 диалогов. Полный перепис рискован; редизайн — безопасный рефакторинг: вынос JSX-зон в `components/myFiles/*`, сохранение всех хендлеров.
- Новых API под детали-панель не требуется: имя/владелец/размер/даты/retention/шаринг/library-роль уже в payload строк.
- Точечных API для участников нет — вкладка «Доступ» по-прежнему собирает полный список и шлёт PUT целиком (ограничение зафиксировать в UI: «изменения применятся при сохранении»).
- «Эффективную роль» с учётом департаментов фронт достоверно не вычислит — показываем источник («через подразделение X»/«лично») из сырых грантов без выдуманного мержа.

## 8. Доступность/адаптивность (текущее)

- `useMediaQuery` на странице нет — всё sx-breakpoints. Колонки Владелец/Дата/Размер скрыты <md (`:2140-2164`).
- На строках <md иконки действий схлопываются в ⋮ (`MyFilesListItems.jsx:365,674`) — есть e2e `audit-my-files-rows.spec.js`.
- Select-all и чекбоксы с aria-label; `TableSortLabel` клавиатурно доступен; focus-стили — из темы.
- Глобальный мобильный chrome (bottom-nav) — зона `MainLayout`, не дублировать.
