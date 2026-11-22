# UI/UX-аудит web-фронтенда HUB-IT — Агент A

Дата: 2026-11-22. Режим: **read-only статический анализ кода** (никаких запусков сборки/тестов/серверов, никаких изменений кода).
Объём: `WEB-itinvent/frontend/src` — маршруты (`App.jsx`), страницы (`pages/`, ~580 jsx-файлов с компонентами), общие компоненты (`components/`), layout (`components/layout/`), тема (`theme/index.js`). Сплошные паттерн-поиски (IconButton/aria-label, Dialog/zIndex, `position:'fixed'`, `whiteSpace`, `minWidth`, `useMediaQuery`, loading/empty/error, `#fff`, Tailwind-классы, `outline:none`, кликабельные `TableRow`/`TableCell`) + построчное чтение крупнейших страниц (Networks.jsx, MyFiles.jsx, Mail.jsx, Warehouse1C.jsx, Computers.jsx, Docflow.jsx, Dashboard.jsx, Login.jsx, Statistics.jsx, Vcs.jsx, Mfu.jsx, Passwords.jsx, KnowledgeBase.jsx, GroupsAccess.jsx, ItPurchaseRequests.jsx) и layout-компонентов.

Каждая находка помечена **Confirmed** (дефект однозначно виден в коде) или **Suspected** (требует live-проверки в браузере). Стилевые предпочтения и работающие паттерны (например, sr-only заголовки диалогов, `component="label"` у кнопок загрузки файлов, Tooltip-обёртки disabled-кнопок) за дефекты не выданы.

Общий вывод: фронтенд дисциплинированный — loading/empty/error-состояния, мобильные альтернативы таблицам, aria-атрибуты и `disabled` при отправке реализованы в большинстве подсистем (Tasks, Docflow, Monitoring, Scan-center, Database, ItObjects, Construction, AddressBook, KnowledgeBase, Vcs, Statistics, Feed, Login — проверены, грубых дефектов не найдено). Реальные дефекты сосредоточены в: (1) иконочных кнопках без доступного имени, (2) кликабельных строках/ячейках таблиц без клавиатурного доступа на десктопе, (3) подавленной видимости фокуса в чате/тостах, (4) точечных проблемах адаптивности и мёртвом состоянии загрузки в Networks.

---

## Сводная таблица находок

| # | Категория | Серьёзность | Файл:строка | Статус | Суть |
|---|-----------|-------------|-------------|--------|------|
| 1 | A11y: имя кнопки | Medium | `pages/Networks.jsx:2132,2214,2704,2712,2748,3006` | Confirmed | 6 IconButton без aria-label |
| 2 | A11y: имя кнопки | Medium | `components/networks/EquipmentTab.jsx:249,313,320,417,513,568` | Confirmed | 6 IconButton без aria-label |
| 3 | A11y: имя кнопки | Medium | `components/networks/SocketsTab.jsx:198,285,381` | Confirmed | 3 IconButton без aria-label |
| 4 | A11y: имя кнопки | Medium | `components/networks/InteractiveMapCanvas.jsx:409,414,419` | Confirmed | Zoom-кнопки карты без aria-label |
| 5 | A11y: имя кнопки | Medium | `components/hub/tasks/TaskCard.jsx:322,335,363` | Confirmed | Открыть/Редактировать/Скопировать без label, при этом «Удалить» (352) его имеет |
| 6 | A11y: имя кнопки | Medium | `components/mail/MailTemplatesDialog.jsx:183,190,196` | Confirmed | Вверх/Вниз/Удалить поле без label |
| 7 | A11y: имя кнопки | Medium | `pages/voice-video/VoiceLogViewer.jsx:229,234` | Confirmed | Копировать/Скачать без label |
| 8 | A11y: имя кнопки | Medium | `pages/SharedFolder.jsx:231,248` | Confirmed | Кнопки публичной страницы папки без label |
| 9 | A11y: имя кнопки | Medium | `components/networks/BranchDialogs.jsx:146` | Confirmed | Удаление панели розеток без label |
| 10 | A11y: имя кнопки | Medium | `components/passwords/PasswordFiltersPanel.jsx:39`; `pages/Passwords.jsx:900` | Confirmed | «Добавить группу» без label |
| 11 | A11y: имя кнопки | Medium | `pages/Vcs.jsx:686` | Confirmed | «Скачать .vnc» без label (соседняя «Скопировать адрес» на 706 имеет) |
| 12 | A11y: имя кнопки | Medium | `pages/Mfu.jsx:990` | Confirmed | Мобильная «Обновить» без label (десктопная на 1002 имеет) |
| 13 | A11y: имя кнопки | Low | `pages/account/admin/UsersTab.jsx:321` | Confirmed | Кнопка скрытия редактора без label |
| 14 | A11y: клавиатура | High | `pages/Warehouse1C.jsx:2163–2216` | Confirmed | Открытие карточки документа по клику на TableRow — на десктопе только мышью (мобильный вариант на 480–496 доступен с клавиатуры) |
| 15 | A11y: клавиатура | High | `pages/Warehouse1C.jsx:1976–1980` | Confirmed | TableCell с onClick («сопоставление 1С↔HUB») без role/tabIndex/onKeyDown; альтернативной кнопки в строке нет (мобильный аналог на 397–411 доступен) |
| 16 | A11y: клавиатура | Medium | `pages/Networks.jsx:2243–2257` | Confirmed | TableRow «выбор точки на карте» — только мышь |
| 17 | A11y: клавиатура | Medium | `components/networks/SocketsTab.jsx:351–358` | Confirmed | TableRow «выбор розетки» — только мышь |
| 18 | A11y: клавиатура | Low | `components/networks/EquipmentTab.jsx:480–491` | Confirmed | TableRow с onClick; есть альтернатива — IconButton «изменить порт» в строке |
| 19 | A11y: видимость фокуса | Medium | `components/chat/ChatBubble.jsx:1820–1856` | Confirmed | Кнопка выделения сообщения: `outline:'none'` и для `&:focus`, и для `&:focus-visible`, без замещающего индикатора |
| 20 | A11y: видимость фокуса | Medium | `components/layout/ToastHistoryList.jsx:70–86` | Confirmed | Строка истории уведомлений role="button" tabIndex=0, но `outline:'none'` без focus-visible замены |
| 21 | Состояния загрузки | Low | `pages/Networks.jsx:302–304` | Confirmed | `equipmentLoading/socketsLoading/mapsLoading` объявлены, сеттеры не вызываются нигде, значения не читаются — мёртвый код + нет индикаторов на подгрузку устройств/розеток/карт |
| 22 | Контраст/состояние | Medium | `pages/voice-video/VoiceLogViewer.jsx:240–246` | Confirmed | «Загрузка…» с `color:'text.secondary'` (тёмный текст) на тёмном фоне `#1a1b23` — почти нечитаемо; соседнее пустое состояние корректно использует `rgba(255,255,255,0.4)` |
| 23 | Адаптивность | Medium | `pages/Mfu.jsx:1297–1298` | Confirmed | Drawer с шириной контента `{ xs: 360, sm: 480 }`: на экранах <360px панель шире вьюпорта |
| 24 | Мёртвый элемент | Low | `pages/account/admin/HubDesktopDeploySection.jsx:422` | Confirmed | Навсегда disabled кнопка «Установлена» используется как индикатор статуса |
| 25 | Консистентность | Low | `App.jsx:164–166` | Confirmed | Английское «Loading...» вместо брендированного `BrandedRouteLoader` («Загружаем раздел...»), который используется в `PageFallback` |
| 26 | Консистентность | Low | `pages/Login.jsx`, `components/chat/*`, `vite.config.js:3,189` | Confirmed | Две параллельные системы стилей: Tailwind (Login + чат) и MUI sx (всё остальное) + собственные CSS-переменные `--chat-*` |
| 27 | Документация/тема | Low | `theme/index.js:31` | Confirmed | AGENTS.md требует сохранять «dark theme», но приложение имеет только светлую тему; dark-ветки в `officeUiTokens.js`/`chatTelegramTheme.js` не активируются |
| 28 | Переполнение | Low | `pages/GroupsAccess.jsx:198–207` | Suspected | ToggleButton: flex 50% + `whiteSpace:'nowrap'` без `overflow:hidden` — длинные подписи могут вылезать за кнопку на узких экранах |

---

## Детальные находки

### 1. A11y: IconButton без доступного имени (aria-label) — 13 групп, Confirmed, Medium

Обоснование серьёзности: иконочная кнопка без текста и без `aria-label` не имеет доступного имени (нарушение WCAG 4.1.2); скринридер объявляет её как «кнопка» без смысла. Обёртка `<Tooltip title="...">` не даёт доступного имени — подсказка появляется только при наведении, а MUI-документация прямо требует aria-label на самом child. Часть кнопок не имеет даже Tooltip.

**1.1. `pages/Networks.jsx`** — 6 кнопок (Confirmed):
- `Networks.jsx:2132` — закрытие мобильной панели карты:
  ```jsx
  <IconButton size="small" onClick={() => setMobileMapPanelOpen(false)}>
    <CloseIcon fontSize="small" />
  </IconButton>
  ```
- `Networks.jsx:2214` — закрытие подсказки о точке: `<IconButton size="small" onClick={() => setCreatePointHint(null)}>` (внутри `<Alert action>`; Alert также добавляет свою кнопку закрытия, дубль не позволяет понять, какая закрывает что).
- `Networks.jsx:2704` — «назад к списку филиалов» (мобильная шапка): `<IconButton size="small" onClick={() => navigate('/networks')} sx={{ flexShrink: 0 }}>`.
- `Networks.jsx:2712–2718` — сворачивание мобильной шапки филиала.
- `Networks.jsx:2748` — «назад» десктопной шапки: `<IconButton onClick={() => navigate('/networks')}><ArrowBackIcon /></IconButton>`.
- `Networks.jsx:3006` — закрытие деталей точки на карте.

**1.2. `components/networks/EquipmentTab.jsx`** — 6 кнопок (Confirmed):
- `:249` — создание устройства: `<IconButton size="small" onClick={openCreateDeviceDialog} color="primary"><AddIcon /></IconButton>` (ни Tooltip, ни label).
- `:313` — экспорт CSV (Tooltip `Скачать CSV (...)` без label).
- `:320` — изменение устройства (Tooltip `Изменить устройство` без label).
- `:417–427` — правка порта в мобильной карточке (без Tooltip и label).
- `:513` — правка порта в десктопной таблице (Tooltip `Изменить порт` без label).
- `:568` — закрытие Drawer «Редактирование порта»: `<IconButton onClick={cancelEditPort}><CloseIcon /></IconButton>`.

**1.3. `components/networks/SocketsTab.jsx:198, 285, 381`** (Confirmed):
- `:198` — создание розетки: `<IconButton size="small" color="primary" onClick={() => onCreateSocket?.()}>` — без Tooltip и label.
- `:285` и `:381` — удаление розетки в мобильной и десктопной таблицах (Tooltip `Удалить розетку` без label).

**1.4. `components/networks/InteractiveMapCanvas.jsx:409, 414, 419`** (Confirmed) — кнопки зума/сброса вида карты:
```jsx
<Tooltip title="Увеличить">
  <IconButton size="small" sx={{ color: ui.iconPrimary }} onClick={() => zoomBy(0.1)}>
    <AddIcon fontSize="small" />
  </IconButton>
</Tooltip>
```
(аналогично «Уменьшить» и «Сбросить»).

**1.5. `components/hub/tasks/TaskCard.jsx:322, 335, 363`** (Confirmed) — действия с карточкой задачи «Открыть», «Редактировать», «Скопировать ссылку» (Tooltip без label). Примечательно: соседняя кнопка удаления на `:349–352` aria-label имеет:
```jsx
<IconButton size="small" color="error" aria-label={`Удалить задачу «${task?.title || 'Без названия'}»`}>
```
— непоследовательность внутри одного компонента подтверждает, что это пропуск, а не осознанный паттерн.

**1.6. `components/mail/MailTemplatesDialog.jsx:183, 190, 196`** (Confirmed) — перемещение поля «Вверх»/«Вниз» и удаление поля шаблона письма: `<IconButton size="small" disabled={index === 0} onClick={() => moveTemplateField(index, -1)}>` (Tooltip без label).

**1.7. `pages/voice-video/VoiceLogViewer.jsx:229, 234`** (Confirmed):
```jsx
<Tooltip title="Копировать всё">
  <IconButton size="small" onClick={handleCopy} color={copied ? 'success' : 'default'}>
```
и «Скачать .txt». Соседняя кнопка автопрокрутки на `:218–226` при этом имеет и aria-label, и `aria-pressed` — снова непоследовательность.

**1.8. `pages/SharedFolder.jsx:231, 248`** (Confirmed) — публичная страница общей папки (доступна без аутентификации, внешние получатели ссылки): «Просмотреть» и «Скачать» файл — Tooltip без label.

**1.9. `components/networks/BranchDialogs.jsx:146–153`** (Confirmed) — удаление панели розеток в диалоге создания:
```jsx
<IconButton size="small" onClick={() => removePanel(panel.id)} disabled={createPanels.length <= 1} color="error">
  <CloseIcon fontSize="small" />
</IconButton>
```

**1.10. `components/passwords/PasswordFiltersPanel.jsx:39` и `pages/Passwords.jsx:900`** (Confirmed) — «Добавить группу» (два места: панель фильтров и форма записи; Tooltip `Добавить группу` без label).

**1.11. `pages/Vcs.jsx:686–698`** (Confirmed) — «Скачать файл .vnc» без label, тогда как соседняя «Скопировать адрес VNC» на `:702–706` label имеет.

**1.12. `pages/Mfu.jsx:988–994`** (Confirmed) — мобильная кнопка «Обновить» без label; десктопная на `:1000–1006` имеет `aria-label="Обновить"`.

**1.13. `pages/account/admin/UsersTab.jsx:321`** (Confirmed, Low — контекст редактора, рядом есть текст):
```jsx
<IconButton onClick={closeEditor} disabled={savingUser} size="small">
  <VisibilityOffOutlinedIcon fontSize="small" />
</IconButton>
```

Условия проявления: навигация скринридером (NVDA/TalkBack), voice-over, клавиатурный обзор по кнопкам; для 1.8 — внешние получатели публичных ссылок.

### 2. A11y: кликабельные строки/ячейки таблиц доступны только мышью — Confirmed

**2.1. (High) `pages/Warehouse1C.jsx:2163–2216`** — в десктопной таблице «движений» строка открывает карточку документа только по клику мыши:
```jsx
<TableRow ... onClick={canOpenMovementDetail(row) ? () => handleOpenMovementDetail(row) : undefined}
  sx={canOpenMovementDetail(row) ? { cursor: 'pointer' } : undefined}>
  ...
  {canOpenMovementDetail(row) ? (
    <Tooltip title="Открыть карточку документа">
      <Typography variant="body2" component="span" color="primary.main">
        {row.registrar_name || '-'}
      </Typography>
    </Tooltip>
  ) : ...}
```
`TableRow` не имеет role/tabIndex/onKeyDown; внутри строки — обычная `Typography` в Tooltip, не кнопка/ссылка. Вся функция «открыть карточку документа движения» недоступна с клавиатуры на десктопе. Асимметрия подтверждена кодом: мобильный `MovementMobileRow` (`:487–496`) корректно реализует `role="button"`, `tabIndex={0}` и обработку Enter/Space — то есть на телефоне действие с клавиатуры доступно, на десктопе нет.

**2.2. (High) `pages/Warehouse1C.jsx:1975–1985`** — в таблице остатков кликабельна сама ячейка номенклатуры («сопоставление 1С↔HUB»):
```jsx
<TableCell
  onClick={() => handleOpenHubMatch(row)}
  sx={{ cursor: 'pointer', '&:hover .wh-nomenclature-name': { textDecoration: 'underline' } }}
>
```
Без role/tabIndex/onKeyDown; другой кнопки для этого действия в строке нет (IconButton на `:1999` — другое действие, «показать движение»). Мобильный `BalanceMobileRow` (`:397–411`) снова имеет полный клавиатурный доступ — асимметрия десктоп/мобильный.

**2.3. (Medium) `pages/Networks.jsx:2243–2257`** — строка таблицы «Поиск и обзор» выбирает точку на карте:
```jsx
<TableRow key={point.id} hover selected={...} onClick={() => onPointRowSelect(point)}
  sx={{ cursor: 'pointer', ... }}>
```
Без клавиатурного доступа. Косвенный путь (клик по маркеру на canvas) также мышиный; для клавиатурного пользователя выбор точки из списка недоступен.

**2.4. (Medium) `components/networks/SocketsTab.jsx:351–358`** — `TableRow onClick={(event) => handleSocketRowClick(socket, event)}` с `cursor: 'pointer'` — без role/tabIndex/onKeyDown.

**2.5. (Low) `components/networks/EquipmentTab.jsx:480–491`** — аналогичный кликабельный `TableRow` портов; однако в каждой строке есть фокусируемая кнопка «изменить порт» (правка достижима с клавиатуры), поэтому серьёзность ниже.

Условия проявления: работа только с клавиатуры (Tab/Enter); экранные дикторы. На мобильных версиях тех же списков дефект отсутствует.

### 3. A11y: подавленная видимость фокуса — Confirmed

**3.1. (Medium) `components/chat/ChatBubble.jsx:1820–1856`** — кнопка выделения сообщения в режиме выбора:
```jsx
<Box component="button" type="button" aria-label={...} aria-pressed={selected} onClick={...} sx={{
  ...
  border: 'none', ...
  outline: 'none',
  '&:focus, &:focus-visible': { outline: 'none' },
}}>
```
Это сырой `component="button"` (не ButtonBase — фокус-риппл MUI не применяется), и outline подавлен в обоих состояниях без какого-либо замещающего индикатора (boxShadow задан только для `selected`, не для focus). Клавиатурный пользователь в режиме выделения сообщений не видит, какая кнопка выделения активна (WCAG 2.4.7).

**3.2. (Medium) `components/layout/ToastHistoryList.jsx:69–86`** — строка истории уведомлений:
```jsx
<Box ... onClick={...} onKeyDown={...} role={resolvedAction ? 'button' : undefined}
  tabIndex={resolvedAction ? 0 : undefined}
  sx={{ borderRadius: '14px', cursor: ..., outline: 'none' }}>
```
Семантика и клавиатура реализованы правильно, но `outline: 'none'` без `&:focus-visible`-замены — фокус на строке невидим.

### 4. Отсутствующие/мёртвые состояния загрузки — Confirmed

**4.1. (Low) `pages/Networks.jsx:302–304`**:
```jsx
const [equipmentLoading, setEquipmentLoading] = useState(false);
const [socketsLoading, setSocketsLoading] = useState(false);
const [mapsLoading, setMapsLoading] = useState(false);
```
Поиском по всему `src` подтверждено: значения `equipmentLoading/socketsLoading/mapsLoading` больше нигде не читаются, а сеттеры `setEquipmentLoading/setSocketsLoading/setMapsLoading` не вызываются вообще (сеттеры упоминаются только в этих трёх декларациях). Это одновременно мёртвый код и признак того, что отдельные индикаторы загрузки устройств/розеток/карт не были доведены до конца: подгрузка закрыта общим `loading` (ветка контекста филиала, `:3405` — текст «Загрузка...») и `branchPortLoading` (передаётся в `EquipmentTab:2810`), но, например, при `refreshBranchContext` (`:898–906`) пользователь не видит никакого индикатора обновления розеток/карт.

**4.2. (Medium) `pages/voice-video/VoiceLogViewer.jsx:240–246`** — состояние загрузки лога нечитаемо:
```jsx
<DialogContent dividers sx={{ p: 0, bgcolor: '#1a1b23' }}>
  {loading ? (
    <Box sx={{ p: 4, textAlign: 'center', color: 'text.secondary' }}>Загрузка…</Box>
  ) : filtered.length === 0 ? (
    <Box sx={{ p: 4, textAlign: 'center', color: 'rgba(255,255,255,0.4)' }}>
```
Контент диалога — тёмный терминальный лог с захардкоженным фоном `#1a1b23`, но текст загрузки берёт тему приложения (`text.secondary` = `rgba(0,0,0,0.6)` в светлой теме) — тёмный текст на тёмном фоне, контраст ≈ 2:1 и ниже. Рядом пустое состояние корректно использует `rgba(255,255,255,0.4)`. Пользователь при открытии лога видит фактически пустой чёрный экран без признака загрузки (WCAG 1.4.3).

### 5. Адаптивность: фиксированная ширина Drawer на экранах <360px — Confirmed, Medium

`pages/Mfu.jsx:1297–1298`:
```jsx
<Drawer anchor="right" open={drawerOpen} onClose={() => setDrawerOpen(false)}>
  <Box sx={{ width: { xs: 360, sm: 480 }, p: 2 }}>
```
На вьюпортах уже 360px (например iPhone SE 320px, Fold в сложенном виде 344px) контент Drawer шире экрана; горизонтального скролла у Drawer-paper нет — правая часть карточки МФУ (статусы SNMP, расходники) обрезана и недоступна. Корректный паттерн для xs — `width: '100%'` или `min(360, 100vw)` (как в других Drawer проекта, например `EquipmentTab:549`: `width: { xs: '100%', sm: 420 }`).

### 6. Мёртвые элементы управления — Confirmed, Low

`pages/account/admin/HubDesktopDeploySection.jsx:422`:
```jsx
<span><Button size="small" disabled>Установлена</Button></span>
```
Постоянно заблокированная кнопка используется как индикатор статуса «агент уже установлен». Для скринридера/клавиатуры это выглядит как недоступное действие без объяснения причины; статус следовало бы рендерить как Chip/бейдж (в том же файле рядом статусы рендерятся иначе).

### 7. Консистентность дизайн-системы — Confirmed

**7.1. (Low) `App.jsx:164–166`** — внутри `ProtectedRoute`:
```jsx
if (loading) {
  return <Box sx={{ display: 'flex', justifyContent: 'center', mt: 4 }}>Loading...</Box>;
}
```
Английская надпись «Loading...» в русском интерфейсе, при этом в `PageFallback` (`:302–306`) используется брендированный `BrandedRouteLoader` с «Загружаем раздел...». Два разных плейсхолдера загрузки в одном маршрутизаторе (сначала ProtectedRoute-ветка, потом Suspense-fallback).

**7.2. (Low) Двойная система стилей.** Tailwind настроен в проекте (`vite.config.js:3,189` — плагин `@tailwindcss/vite`, `src/index.css:1` — `@import "tailwindcss"`), но применяется концентрированно: `Login.jsx` (~101 вхождений Tailwind-классов), чат (`ChatSidebarRows` 43, `ChatSidebar` 24, `ChatComposer` 16, `ChatBubble` и др.) плюс собственные CSS-переменные `--chat-*`. Остальное приложение (~560 файлов) — чистый MUI `sx` + токены `officeUiTokens`. Это осознанный выбор (обе системы подключены и работают), но следствия: (а) разные механизмы focus-ring (Tailwind-классы `focus-visible:ring-*` в чате против sx в остальном), (б) новые компоненты копируют то один, то другой стиль, (в) визуальный результат зависит от того, какая из систем стилизует конкретный элемент. Отмечено как риск поддержки, не как сломанный UI.

**7.3. (Low, задокументированное противоречие).** AGENTS.md требует «Keep the design system, responsiveness and dark theme», однако единственная тема приложения — светлая: `theme/index.js:31` `mode: 'light'`, и нигде нет переключателя/второй темы. При этом `theme/officeUiTokens.js:4` (`const isDark = theme.palette.mode === 'dark'`) и `theme/chatTelegramTheme.js:80` содержат готовые dark-ветки, которые в рантайме не активируются. Либо тёмная тема была удалена (и AGENTS.md устарел), либо её включение запланировано — зафиксировано как противоречие документации коду (по правилам проекта не выбирать сторону молча).

### 8. Suspected — требует live-проверки

**8.1. (Low) `pages/GroupsAccess.jsx:198–207` + `:1029–1059`** — ToggleButton-переключатель режимов:
```jsx
'& .MuiToggleButton-root': {
  flex: { xs: '1 1 calc(50% - 4px)', sm: '0 0 auto' },
  minWidth: { xs: 0, sm: 132 },
  ...
  whiteSpace: 'nowrap',
```
На xs кнопки жёстко делят строку пополам, текст не переносится и не обрезается (`overflow` не задан). Подпись «По сотруднику» с иконкой на экране 320px теоретически может вылезти за границы кнопки. Требует проверки в браузере на 320–360px; при отсутствии переполнения находку снять.

---

## Что проверено и дефектов не содержит (важно для приоритизации)

- **Тема/токены:** `theme/index.js` — light-only; захардкоженные тёмные цвета в `ActiveCallPanel`, `QuickCameraDialog`, `EquipmentDetailPhotosPanel`, `VoiceLogViewer` — осознанный тёмный оверлей/превью, сам по себе не дефект (но см. находку 4.2 про смешение темы внутри него).
- **Диалоги:** все `<Dialog` имеют `onClose` (Esc работает); вложенные стеки (`QuickCameraDialog` zIndex modal+5, `ActiveCallPanel` 1250/1350, `CallNoticeSnackbar` 1400) не конфликтуют с MUI-уровнями (drawer 1200, modal 1300); sr-only DialogTitle (`ChatDialogs:925–938`, `AddressBook:70–80`) — корректный паттерн, не дефект.
- **Кнопки отправки:** выборочная проверка ~15 форм (`MonitoringDialogs`, `UsersTab`, `DepartmentsTab`, `MyFilesAdminBrowser`, `ItinventReferencesTab`, `WorkSchedulesAdminSection`, `PcRemainingDialog`, `VoiceUploadDialog`, `AiMailActionEditDialog`, `Login:569–570`, `MyDevices:41–43`, `AddressBook:386–408`) — `disabled` во время сохранения и `finally`-сброс везде корректны; застрявших loading не найдено.
- **Loading/empty/error:** Statistics, KnowledgeBase, ItObjects, ConstructionObjects, Feed, Dashboard, Monitoring, Scan-center, FileEgress, Passwords, GroupsAccess, MyDevices, AddressBook — skeletons/LinearProgress/Alert/пустые состояния реализованы.
- **Мобильные альтернативы:** MonitoringInterfaces (таблица → карточки), Warehouse1C (Balance/Movement/Dismissed MobileRow), Warehouse1C таблица minWidth:1550 показывается только на десктопе; bulk-бары учитывают высоту мобильной навигации (`DatabasePageView:610`).
- **«Ссылки-заглушки» `href="#"`:** `About.jsx:361–373` — реальные якоря, все цели (`id="about-main"`, `possibilities`, `collaboration`, `mobile`, `desktop`) существуют в файле — не дефект.
- **Кликабельные Chip:** MUI Chip с `onClick` рендерится через ButtonBase с role="button" (проверено в `node_modules/@mui/material/Chip/Chip.js:341,353`) — доступность не нарушена.
- **Фиксированные позиции:** `Tasks.jsx:98` (FAB с расчётом отступа от bottom-nav), `Mail.jsx:2592` (полноэкранный превью с zIndex drawer-1 и safe-area), `MyFiles.jsx:1708/2027` (оверлей drag&drop, pointerEvents:none), `MainLayout.jsx:2400/2963` (баннер и bottom-nav с переменными высот) — намеренные и корректные.
- **ChatComposer/ChatSidebar/VCS drag:** aria-labels, `aria-pressed`, Tailwind focus-ring, drag-handle с полным клавиатурным управлением (`Vcs.jsx:722–736`).

## Ограничения и непроверенное

- Статический аудит без запуска: ни одна находка не проверена в рендере; всё, что зависит от фактических длин данных/вьюпорта, помечено Suspected (8.1). Остальные Confirmed-находки видны непосредственно в коде.
- `components/chat/ChatContextPanel.jsx` (162 КБ), `pages/voice-video/VoiceMeetingDrawer.jsx` (162 КБ, 3319 строк), `pages/scan-center/ScanCenterPage.jsx` (119 КБ), `components/layout/MainLayout.jsx` (141 КБ) — проверены паттерн-поисками и выборочным чтением, не построчно; единичные дефекты в них могли остаться незамеченными.
- `pages/Login.jsx` (2405 строк) — проверены состояния отправки/а11y/автокомплит; Tailwind-вёрстка построчно не верифицировалась.
- Не проверялось статически и требует E2E: фактический порядок табуляции в диалогах, реальное перекрытие элементов, поведение при медленной сети, контраст всех пар цветов (проверена только находка 4.2).
- Тесты (`*.test.jsx`) не аудитировались (вне задачи).

## Рекомендации по приоритету исправления

1. (High) Добавить клавиатурный доступ к кликабельным строкам/ячейкам `Warehouse1C` (2.1, 2.2) — по образцу уже реализованных мобильных `MovementMobileRow`/`BalanceMobileRow`: `role="button"`, `tabIndex`, Enter/Space.
2. (Medium) Пройти списком по находкам группы 1 (aria-label) — механическое исправление, ~30 кнопок; в половине случаев достаточно продублировать текст уже существующего Tooltip.
3. (Medium) Фокус в чате/тостах (группа 3): заменить подавленный outline на `&:focus-visible` box-shadow/ring.
4. (Medium) `Mfu` Drawer `xs: '100%'`; `VoiceLogViewer` — светлый текст состояния загрузки.
5. (Low) Удалить мёртвое состояние `Networks:302–304`; заменить «Loading...» в `App.jsx`; статус вместо disabled-кнопки в `HubDesktopDeploySection`.
