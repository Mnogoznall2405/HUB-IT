# HUB Desktop — функциональная карта развития

Статус: реализуемая функциональная карта и журнал выполнения, обновлено 2026-08-12  
Область: пользовательские возможности HUB Desktop, связанные React-модули и минимальные backend-контракты  
Технический выпуск, updater, MSI/GPO и критерии 1.0: [`ROADMAP.md`](./ROADMAP.md)

---

## 1. Зачем нужна отдельная карта

`ROADMAP.md` отвечает на вопрос «как безопасно собрать, обновлять и сопровождать Desktop».
Этот документ отвечает на другой вопрос: **«что Desktop должен давать пользователю сверх обычного
браузера»**.

Главный вывод анализа: текущая оболочка уже закрывает основную Windows-инфраструктуру — WebView2,
tray, autostart, native notifications, downloads, Office/PDF open, diagnostics, GPO и updater.
Следующий рост ценности должен происходить вокруг быстрых входов в существующий HUB, состояния в
Windows shell, печати, deep links и сохранения рабочего контекста. Создавать второй набор экранов
задач, почты, чата или документов на WPF не нужно.

Эта карта не меняет ближайший release scope: до доказанного перехода `0.1.6 → 0.1.7` на Windows 10
и 11 новые функции не публикуются в stable.

## Статус выполнения на 2026-08-12

| Волна | Состояние | Что это означает |
|---|---|---|
| F0 release gate | **Требует ручной проверки** | Автотесты и сборка выполняются, но Win10/Win11, UAC и реальный переход `0.1.6 → 0.1.7` нельзя зачесть без тестовых ПК |
| F1 command center | **Код готов** | Counters, tray/taskbar, permission-aware routes, quick-create для подтверждённых routes, mute/privacy реализованы; ticket action скрыт до появления route contract |
| F2 navigation/workspace | **Код готов** | `hubit://`, `--route`, single instance, Jump List, browser handoff, last safe route и monitor-safe placement реализованы |
| F3 documents/transfers | **Код готов** | Печать, download taskbar progress, Cancel/Clear/Open folder и безопасное Office/PDF open реализованы |
| F4 command palette | **SEARCH-01 готов; SEARCH-02 отложен** | Локальная permission-aware palette реализована; backend global search не начат до метрик пользы и отдельного нагрузочного/security среза |
| F5 device-bound login | **Gated, не реализован** | Обычный login/session не менялся; реализация запрещена до закрытия Critical/High threat-model rows и отдельного пилота |
| F6 remote support | **Код готов** | Desktop preflight handler без адреса/токена, browser fallback, понятная ошибка, явное копирование безопасного endpoint и строгая host/port validation реализованы |
| F7 UX/accessibility | **Код готов, нужен ручной UI-аудит** | Настройки окна, opt-in hotkey с conflict detection, system theme, shortcuts, reduced motion, high-contrast focus и recovery actions реализованы |

`Код готов` не равен разрешению stable-выпуска: обязательные ручные строки остаются в
[`HUB_DESKTOP_COMPATIBILITY_MATRIX.md`](../documentation/technical/HUB_DESKTOP_COMPATIBILITY_MATRIX.md).

---

## 2. Что уже есть и не надо делать повторно

| Пользовательская область | Текущее состояние | Вывод для новой карты |
|---|---|---|
| Основной интерфейс | Все модули живут в React/FastAPI | WPF остаётся оболочкой, не копирует страницы |
| Навигация и permissions | `navigationConfig.jsx` уже фильтрует модули по правам | Быстрые Desktop-команды должны переиспользовать этот список |
| Центр уведомлений | `MainLayout.jsx` объединяет HUB/mail/chat unread и bell inbox | Нативную вторую историю уведомлений не создавать |
| Системные уведомления | Есть native toast/fallback, route activation и дедупликация | Развивать badge, mute/privacy и группировку, не второй канал |
| Загрузки | Есть окно с прогрессом, Open/Reveal и безопасный allowlist | Добавить shell-progress и управление списком, не файловый менеджер |
| Office/PDF | Есть web preview и открытие в установленной программе | Добавить печать; встроенный Office engine не нужен |
| Login | Есть обычный login/2FA/passkey и подсказка Windows username | Будущий Desktop-вход — только device-bound proof после первого login |
| Realtime | Существующий React WebSocket работает скрытым в tray | Второй Desktop WebSocket не нужен |
| Update/support | Есть updater, About, diagnostics и support bundle | Не создавать отдельный «центр администрирования» внутри клиента |
| VNC | Существующий web flow запускает системный `vnc:` handler | Улучшать preflight/error UX, не писать VNC-клиент |

---

## 3. Пользовательские задачи, которые Desktop должен ускорять

### Обычный сотрудник

- открыть HUB, чат, почту или задачи одним действием из tray;
- видеть, есть ли непрочитанное, не открывая окно;
- перейти по внутренней HUB-ссылке из письма или другого приложения сразу в Desktop;
- распечатать текущий документ/страницу;
- продолжить с того места, где работа была прервана;
- не вводить пароль регулярно на привязанном корпоративном ПК, но иметь безопасный logout/revoke.

### IT-специалист

- быстро перейти к компьютерам, сетям, Scan Center, учёту или VNC;
- открывать несколько типов документов штатными Windows-приложениями;
- видеть сетевое состояние, update/download progress и диагностический статус;
- копировать безопасную техническую сводку без токенов и пользовательского контента.

### Администратор/поддержка

- централизованно управлять только необходимыми Desktop-политиками;
- понимать версию, состояние runtime и причину ошибки без доступа к профилю пользователя;
- отзывать привязанный Windows-компьютер и сессию;
- получать воспроизводимый сценарий проблемы, а не скрытую телеметрию документов/сообщений.

---

## 4. Правила отбора новых функций

Функция входит в Desktop, только если выполняется хотя бы одно условие:

1. Требуется Windows shell/API: tray, taskbar, protocol, print, CNG, system session, file handler.
2. Пользователь экономит несколько переходов при ежедневном сценарии.
3. Функция продолжает работать, когда окно скрыто, но процесс активен.
4. Desktop может сделать сценарий безопаснее браузера без дублирования бизнес-логики.

Функция не входит, если она:

- повторяет React-страницу в WPF;
- требует хранить пароль, access token или пользовательский документ в C#;
- добавляет произвольный shell/URL/file bridge;
- создаёт вторую модель permissions, notifications, session или search;
- полезна только потому, что «так умеет нативное приложение», без реальной рабочей задачи.

---

## 5. Приоритеты возможностей

| ID | Возможность | Ценность | Стоимость | Риск | Backend | Решение |
|---|---|---:|---:|---:|---|---|
| SHELL-01 | Unread/status в tray и taskbar | Очень высокая | M | Низкий | Нет | Делать первой |
| SHELL-02 | Permission-aware быстрые переходы | Очень высокая | M | Низкий | Нет | Делать первой |
| SHELL-03 | Локальный «Не беспокоить» и privacy preview | Высокая | M | Средний | Нет | После status sync |
| NAV-01 | `hubit://` deep links и `--route` | Очень высокая | M | Средний | Нет | Делать после shell center |
| NAV-02 | Jump List и «Открыть в браузере» | Средняя | S–M | Низкий | Нет | Вместе с NAV-01 |
| WORK-01 | Последний безопасный маршрут и window placement | Высокая | M | Низкий | Нет | Ранний этап |
| DOC-01 | Печать текущей страницы/preview | Высокая | M | Средний | Нет | Ранний этап |
| DOC-02 | Taskbar progress и управление downloads | Средняя | M | Низкий | Нет | После SHELL-01 |
| SEARCH-01 | Command palette навигации и действий | Высокая | M | Низкий | Нет | После quick routes |
| SEARCH-02 | Единый поиск по разрешённым доменам | Очень высокая | L–XL | Высокий | Да | Отдельный vertical slice |
| AUTH-01 | Device-bound повторный вход | Очень высокая | XL | Высокий | Да | Только по ADR/threat model |
| REMOTE-01 | Улучшенный VNC/remote-support launch UX | Средняя | M | Средний | Возможно | После основных сценариев |
| SHARE-01 | Windows «Отправить в HUB» | Потенциально высокая | XL | Высокий | Да | Только discovery/pilot |
| OFFLINE-01 | Offline business action queue | Средняя | XL | Очень высокий | Да | Не делать сейчас |

Обозначения стоимости: `S` — небольшой вертикальный срез, `M` — несколько компонентов,
`L/XL` — новый контракт/хранилище/безопасность.

---

# Волна F0 — закрепить рабочую базу

## Цель

Не добавлять новые элементы интерфейса до завершения реального release-перехода и матрицы
совместимости. Функциональная база считается готовой, когда подтверждены:

- tray/open/hide/single-instance;
- login/session после reboot и update;
- уведомления visible/minimized/hidden;
- Office/PDF download/open;
- VNC web/Desktop regression;
- offline Setup и `0.1.6 → 0.1.7` на Win10/Win11;
- keyboard/Narrator/DPI/RDP строки из `HUB_DESKTOP_COMPATIBILITY_MATRIX.md`.

## Почему это отдельная волна

Без этой базы невозможно отличить дефект новой функции от дефекта установки, WebView2 profile,
realtime или bridge lifecycle.

---

# Волна F1 — Windows command center

## Пользовательский результат

Tray и taskbar становятся кратким представлением уже существующего HUB, а не только меню выхода.
Пользователь видит состояние и за одно действие открывает нужный web-модуль.

## SHELL-01. Общий unread/status

Статус на 2026-08-12: **реализовано в рабочем дереве** — отдельный capability
`shell-status`, строгий контракт counters, синхронизация из `MainLayout`, tray tooltip и taskbar badge
для неактивного окна. Logout очищает counters через размонтирование layout, Windows session lock
скрывает counters до разблокировки. Остаётся ручная проверка shell-представления на Windows 10/11.

React уже считает:

- общий notification unread;
- chat unread;
- mail unread;
- открытые задачи/непрочитанные комментарии.

Новый bridge message передаёт только ограниченные числовые counters и auth/connectivity state, без
названий, сообщений, адресатов и IDs. Desktop:

- показывает `HUB Desktop — N новых` в tray tooltip;
- отображает taskbar overlay badge `1…99+` только когда окно не foreground;
- очищает badge сразу после server/React unread update;
- не суммирует один event дважды;
- при logout/lock очищает все персональные counters.

### Контракт

```json
{
  "type": "shell.status",
  "version": 1,
  "authenticated": true,
  "online": true,
  "unread_total": 7,
  "chat_unread": 4,
  "mail_unread": 2,
  "tasks_attention": 1
}
```

Все counters — целые `0..9999`, дополнительные поля запрещены. Значения используются только для UI
и никогда не дают permissions.

## SHELL-02. Быстрые переходы из tray

В меню после «Открыть HUB» добавить:

- «Уведомления — N» → открыть существующий bell inbox;
- «Задачи»;
- «Чат — N»;
- «Почта — N»;
- раздел «Ещё» с 3–5 закреплёнными пользователем модулями.

Список формирует React из `getVisibleNavigationItems()`, поэтому Desktop не угадывает роль. Bridge
принимает только bounded набор `{id,label,route,badge}` с внутренними routes. Backend всё равно
повторно проверяет permissions при открытии.

Нельзя передавать в tray произвольные действия JavaScript или shell command.

## SHELL-03. Быстрые пользовательские действия

После появления явных web-route contracts:

- «Новая задача» → существующий `/tasks?create=1`;
- «Новый билет» не показывается, пока у tickets нет подтверждённого create-route contract;
- «Новое письмо» → существующий `/mail?compose=new`;
- «Открыть загрузки» → нативное окно.

Каждый query action должен быть одноразовым, удаляться из URL после обработки и проверять permission
на стороне React/backend. Пока конкретный модуль не поддерживает contract, пункт не показывается.

## SHELL-04. «Не беспокоить» и privacy

Локальный Desktop mute:

- 1 час;
- до конца рабочего дня;
- до ручного включения.

Mute подавляет только native/fallback popup и звук. Unread/bell inbox продолжает обновляться;
браузерные подписки на других ПК не меняются. В tray всегда виден активный срок mute.

Дополнительная настройка privacy: «Скрывать текст на заблокированном ПК». При Windows session lock
fallback/toast получает нейтральный заголовок без тела сообщения. Содержимое не сохраняется для
последующего показа.

## Затрагиваемые файлы

```text
desktop/Hub.Desktop/
├── Interop/DesktopBridgeProtocol.cs
├── Interop/DesktopBridgeHost.cs
├── Shell/DesktopShellStatus.cs              # новый
├── Shell/DesktopQuickAction.cs              # новый
├── Shell/DesktopTaskbarService.cs           # новый
├── Notifications/DesktopQuietMode.cs        # новый
├── UI/HubTrayContextMenu.cs
└── MainWindow.xaml.cs

WEB-itinvent/frontend/src/
├── lib/desktopBridge.js
├── lib/desktopShellStatus.js                 # новый, pure model
├── components/layout/DesktopShellSync.jsx    # новый
├── components/layout/navigationConfig.jsx
└── components/layout/MainLayout.jsx
```

## Тесты и готовность

- exact schema/limits/negative counters/unknown fields;
- logout немедленно очищает tray/badge;
- visible → badge не показывается, hidden → показывается;
- chat/mail/task counts не суммируются повторно;
- quick routes только из permission-filtered navigation;
- mute переживает restart, истекает по UTC и не suppress Web Push других устройств;
- Narrator/keyboard читает пункты и counts;
- 10 000 status updates не создают icon/GDI leak.

---

# Волна F2 — системные ссылки и восстановление рабочего места

## NAV-01. Протокол `hubit://`

Примеры:

```text
hubit://open/tasks
hubit://open/chat?conversation=42
hubit://open/tickets/123
```

Назначение: ссылки из корпоративной почты, 1С, инструкций и других Windows-приложений открывают уже
запущенный HUB Desktop на нужной странице.

### Безопасная модель

- OS protocol считается полностью недоверенным входом;
- принимается только host `open` и allowlisted mapping в внутренний route;
- запрещены credentials, external URLs, `//`, backslash, control chars, file paths и shell strings;
- route проходит тот же `NavigationPolicy`;
- single-instance pipe передаёт только уже распарсенный internal route;
- неаутентифицированный пользователь сначала входит, затем выполняется только последний pending route;
- permissions проверяет существующий ProtectedRoute/API.

MSI регистрирует protocol per machine. Удаление убирает только собственную регистрацию HUB.

## NAV-02. Command-line route и Jump List

- `HUB.Desktop.exe --route /tasks` использует тот же parser, что `hubit://`;
- Jump List содержит только общие модули: Главная, Задачи, Чат, Почта, Загрузки;
- недавние ticket/chat/file names в Jump List не помещаются — это утечка на общем ПК;
- второй процесс передаёт route первому и завершается.

## NAV-03. «Открыть текущую страницу в браузере»

Tray/title command открывает текущий trusted-origin URL системным браузером. Нельзя открывать
WebView `data:`, `blob:`, login callback или внешний origin. Cookies не копируются; браузер использует
свою собственную сессию.

Это также безопасный fallback, если конкретная страница временно несовместима с WebView2.

## WORK-01. Продолжение рабочего контекста

Desktop сохраняет:

- window bounds/maximized state с проверкой доступных monitors;
- выбранное поведение запуска: Главная / последняя страница;
- последний внутренний path после успешной NavigationCompleted.

Не сохраняются:

- `/login`, shared token links и auth callbacks;
- route с password/reset/export/download token;
- scroll/form content;
- страница после явного logout.

При исчезнувшем мониторе окно возвращается в рабочую область primary display. `--route`, toast и
update restart имеют приоритет над сохранённой страницей.

## Затрагиваемые файлы

```text
desktop/Hub.Desktop/
├── DeepLinks/DesktopDeepLinkParser.cs        # новый
├── DeepLinks/DesktopLaunchRequest.cs         # новый
├── Workspace/DesktopWorkspaceState.cs        # новый
├── Lifecycle/SingleInstanceCoordinator.cs
├── Configuration/DesktopSettingsStore.cs
└── MainWindow.xaml.cs

desktop/Hub.Desktop.Installer/Package.wxs
desktop/Hub.Desktop.Tests/DeepLinks/*
desktop/Hub.Desktop.Tests/Workspace/*
```

## Тесты и готовность

- parser fuzz/encoded slash/double decode/overlong/extra fields;
- cold launch и already-running activation;
- unauthenticated pending route;
- protocol registration install/upgrade/uninstall;
- removed monitor и mixed DPI bounds recovery;
- logout не восстанавливает защищённый route;
- external URL никогда не проходит в WebView как trusted navigation.

---

# Волна F3 — документы, печать и transfers

## DOC-01. Печать

Добавить явную команду «Печать» и `Ctrl+P`:

1. PDF/web preview печатается через WebView2 print UI.
2. Почта продолжает использовать существующий специализированный print flow.
3. Office-файл при выборе «Открыть и печатать» сначала открывается штатным Word/Excel/PowerPoint;
   Desktop не пытается управлять Office automation.
4. Если содержимое не поддерживает print, кнопка не показывается либо объясняет доступный путь.

Новый bridge contract должен быть семантическим (`document.printCurrent`), а не принимать printer
name, command line или произвольный HTML.

## DOC-02. Windows taskbar progress

- активный download показывает Normal progress;
- несколько downloads показывают агрегированный bytes progress;
- failed — краткий Error state, затем очистка;
- paused/interrupted — Paused state;
- готовое update не смешивается с download progress и имеет более высокий приоритет только во время
  установки.

## DOC-03. Управление окном «Загрузки»

Добавить:

- Cancel для активной загрузки;
- «Очистить завершённые» без удаления самих файлов;
- «Открыть папку загрузок»;
- понятные interrupted/retry инструкции;
- сортировку active → failed → completed.

Историю между перезапусками по умолчанию не хранить. Если позже понадобится recent history, она
должна быть opt-in, ограничена количеством/сроком и не попадать в support bundle.

## DOC-04. Что исследовать отдельно

Windows context menu «Отправить в HUB» или shell upload полезен, но требует:

- точного получателя: My Files/chat/task/ticket;
- permission и quota checks;
- malware/DLP scan;
- audit и пользовательского подтверждения;
- безопасной передачи file handle без generic path bridge.

До отдельного threat model и vertical slice эту интеграцию не реализовывать.

## Затрагиваемые файлы

```text
desktop/Hub.Desktop/
├── Printing/DesktopPrintService.cs           # новый
├── Transfers/DesktopTaskbarProgress.cs       # новый либо общий Shell service
├── Downloads/DesktopDownloadCoordinator.cs
├── Downloads/DesktopDownloadItem.cs
├── Views/DownloadsWindow.xaml(.cs)
└── Interop/DesktopBridgeProtocol.cs

WEB-itinvent/frontend/src/
├── lib/desktopBridge.js
├── components/documentPreview/DocumentPreviewDialog.jsx
└── components/fileActions/FileActionsContextMenu.jsx
```

## Тесты и готовность

- print command only for trusted origin/known preview state;
- Ctrl+P не открывает DevTools/browser accelerator;
- cancel не удаляет существующий файл и не считается failure;
- aggregate progress monotonic при параллельных downloads;
- clear UI history не удаляет документы;
- handler missing даёт понятный fallback;
- запрещённые расширения по-прежнему никогда не auto-open.

---

# Волна F4 — быстрые команды и поиск

## SEARCH-01. Command palette без нового backend

Первый этап — React-компонент, доступный одинаково в web и Desktop:

- `Ctrl+K` в открытом HUB;
- tray «Быстрый переход» поднимает окно и открывает palette;
- поиск по доступным модулям из `getVisibleNavigationItems()`;
- команды «Новая задача/билет/письмо» только при наличии route contract и permission;
- локальные команды Desktop: Downloads, Diagnostics, Check update, Open in browser.

Это не глобальный поиск данных. Он ускоряет навигацию и не создаёт нового permission surface.

## SEARCH-02. Единый поиск данных

Второй самостоятельный vertical slice может искать:

- людей/адресную книгу;
- оборудование и компьютеры;
- задачи и билеты;
- KB;
- доступные пользователю документы/My Files;
- чаты/сообщения — только по существующим chat permissions.

Нельзя запускать все существующие endpoints параллельно из клиента: это создаст лишнюю нагрузку,
неодинаковое ранжирование и риск permissions leak. Нужен отдельный backend aggregator:

```text
GET /api/v1/search?q=<query>&domains=people,equipment,tasks,kb&limit=20
```

Backend:

- вызывает доменные services, а не копирует SQL;
- проверяет permission для каждого domain до поиска;
- возвращает минимальные title/subtitle/route/type;
- имеет общий timeout, per-domain budget, rate limit и query length `2..100`;
- не логирует raw query;
- не возвращает password/mail body/file content snippets без отдельного решения;
- допускает partial result с явным `unavailable_domains`.

## Затрагиваемые файлы

```text
WEB-itinvent/frontend/src/
├── components/search/HubCommandPalette.jsx   # новый
├── lib/hubCommands.js                        # новый pure registry
├── api/globalSearch.js                       # только SEARCH-02
└── components/layout/MainLayout.jsx

WEB-itinvent/backend/
├── api/v1/search.py                          # только SEARCH-02
├── services/global_search_service.py         # orchestration only
└── models/global_search.py
```

## Тесты и готовность

- keyboard/focus/screen-reader/IME/RU layout;
- palette показывает только permission-visible modules;
- 100 быстрых вводов отменяют stale requests;
- aggregator не вызывает запрещённые domains;
- partial timeout не ломает остальные результаты;
- route каждого результата проходит allowlist;
- нагрузочный тест и отсутствие raw query в logs.

---

# Волна F5 — корпоративный Windows-профиль

## AUTH-01. Device-bound повторный вход

Эта волна соответствует решению из:

- `documentation/technical/WINDOWS_SSO_FUTURE.md`;
- `documentation/technical/WINDOWS_SSO_THREAT_MODEL.md`;
- `docs/adr/0005-windows-sso-boundary.md`.

Функциональный UX:

1. После обычного login + действующей 2FA policy на ПК `zsgp.corp` HUB предлагает «Запомнить этот
   корпоративный компьютер».
2. Windows login должен нормализованно совпасть с текущим HUB username.
3. Пользователь видит имя компьютера, Windows account и уровень защиты ключа: TPM/software.
4. После истечения обычной cookie-сессии Desktop выполняет одноразовый cryptographic challenge и
   возвращает пользователя в HUB без пароля.
5. В профиле HUB есть список привязанных компьютеров, last used, protection level и «Отозвать».
6. В Desktop есть «Выйти» и «Выйти и отвязать этот компьютер».
7. Любая ошибка, non-domain PC, mismatch, revoke или missing key безопасно возвращает обычный login.

Это не бессрочная сессия и не Kerberos SSO. Domain join/username разрешают показать enrollment, но
доступ доказывает только зарегистрированный private key и server-side binding.

## Дополнительные функциональные требования

- admin может массово отозвать Desktop bindings пользователя при security incident;
- security reset/disable user запрещает новый device login;
- support bundle показывает только provider/status и opaque shortened device id;
- пользователь получает уведомление о новой/отозванной привязке существующим каналом HUB;
- software-backed key можно запретить policy после TPM pilot;
- одна Windows-учётка не может silently привязать HUB-профиль с другим username.

## Готовность

Реализация допускается только после закрытия всех Critical/High threat-model rows и реального пилота:

- domain + non-domain;
- TPM + без TPM;
- copied WebView2 profile;
- lost/revoked PC;
- parallel replay;
- user rename/disable;
- logout/session limit/idle/absolute expiry/2FA/admin-IP regression.

---

# Волна F6 — remote support без нового VNC-клиента

## REMOTE-01. Preflight системного handler

Перед запуском `vnc:` Desktop:

- проверяет только наличие зарегистрированного protocol handler;
- показывает понятное действие «Установить/настроить VNC-клиент», если handler отсутствует;
- не получает от React адрес, одноразовый launch token или credentials в preflight и не пишет их в logs;
- не считает успешный `Process.Start` успешным соединением;
- сохраняет web flow для браузера без Desktop bridge.

## REMOTE-02. Понятный запуск поддержки

Статус: реализованы явные действия подключения/скачивания/копирования endpoint, понятная ошибка
missing/unavailable handler и строгая проверка IPv4/hostname/port. Браузерная ветка не вызывает
Desktop preflight. Реальное открытие стороннего клиента остаётся ручной матрицей, потому что наличие
registration не доказывает успешное VNC-соединение.

На странице компьютера можно показывать:

- «Открыть VNC»;
- «Скопировать адрес» только по явному действию;
- причину недоступности;
- ссылку на инструкцию настройки handler;
- безопасный retry.

История подключений и remote-control telemetry не собираются в Desktop без отдельного product/privacy
решения. Сторонний VNC процесс не встраивается внутрь WebView/WPF.

## Готовность

- web без Desktop не изменился;
- installed/missing/broken handler matrix;
- IPv4/hostname/port validation;
- credentials/query/control chars блокируются;
- RDP и local session;
- error UX не предлагает ослаблять Windows security.

---

# Волна F7 — удобство, доступность и персонализация

Эти улучшения не создают новую бизнес-логику и могут поставляться небольшими срезами после F1:

## WINDOW-01. Настройки поведения окна

Статус: реализовано отдельное доступное окно настроек Desktop; изменения применяются без хранения
контента портала. Конфликт `Ctrl+Shift+H` оставляет hotkey выключенным и показывает причину.

- запускать: скрыто / открывать главное окно;
- стартовая страница: Главная / последняя безопасная;
- X: всегда скрывать; опционально «спросить один раз»;
- opt-in global hotkey `Ctrl+Shift+H` для показать/скрыть с conflict detection;
- «Всегда поверх остальных» не добавлять без подтверждённого рабочего сценария.

## THEME-01. «Как в Windows»

Статус: реализовано. Backend принимает только `light/dark/system`, React слушает системный media
query и передаёт WPF вычисленный `light/dark` через существующий строгий bridge.

Добавить третий режим portal preference: system. React остаётся владельцем темы, Desktop лишь
сообщает изменение Windows light/dark. High contrast всегда имеет приоритет над декоративной темой.

## ACCESS-01. Keyboard и screen reader

Статус: кодовые меры реализованы; Narrator, 200% scale, mixed DPI и Windows High Contrast остаются
ручными acceptance-сценариями, а не объявляются пройденными по unit-тестам.

- единый список shortcuts в About/Help;
- logical tab order в title bar, banners и auxiliary windows;
- live regions только для действительно важных status changes;
- tray AccessibleName содержит действие и count;
- 200% scale без обрезки;
- reduced motion без лишних transitions;
- contrast/focus проверяются для light/dark/high-contrast.

## CONNECT-01. Понятное состояние сети

Статус: overlay различает certificate, runtime/process и network/timeout классы, выполняет bounded
recovery и предлагает Retry/Diagnostics/Browser. Login остаётся React-экраном и не дублируется WPF.

Tray tooltip и error overlay различают:

- offline;
- DNS/TLS/backend unavailable;
- auth required;
- WebView runtime/process failure.

Пользователь получает действия «Повторить», «Открыть диагностику» и «Открыть HUB в браузере».
Desktop не пытается самостоятельно поднимать VPN или менять proxy/certificate settings.

---

## 6. Эволюция bridge без поломки старых клиентов

Текущий v1 handshake и точная схема `desktop.hostReady` уже опубликованы. Нельзя просто добавить
новые ключи в существующий объект: старый frontend отвергает дополнительные поля.

Рекомендуемая совместимость:

1. Оставить `desktop.ready` / `desktop.hostReady` v1 без изменений.
2. Новый host после успешного v1 handshake отправляет отдельный строгий
   `desktop.capabilities` message.
3. Новый frontend игнорирует отсутствие этого сообщения и работает в v1 режиме.
4. Каждая возможность проверяет capability перед отправкой команды.
5. Старый host отвергает неизвестные inbound commands, а frontend использует web fallback.

Пример:

```json
{
  "type": "desktop.capabilities",
  "version": 1,
  "capabilities": ["shell-status", "quick-routes", "print", "vnc-preflight"]
}
```

Capability names берутся из закрытого enum, сортируются, ограничены количеством и длиной. Это не
generic RPC и не разрешение пользователя.

---

## 7. Карта модулей и владельцев

```text
React/FastAPI — владелец:
├── identity, permissions, session, 2FA
├── unread counts и notification inbox
├── routes, module visibility и quick-create contracts
├── business search/results
└── все формы и business actions

Desktop — владелец:
├── tray/taskbar/Jump List/global hotkey
├── protocol activation и single instance
├── window placement/resume policy
├── native print dialog
├── WebView downloads и local file launch
├── CNG device key
└── Windows connectivity/runtime diagnostics

Shared strict contracts:
├── Desktop bridge messages/capabilities
├── safe internal route format
├── notification envelope/unread counters
└── device-bound challenge protocol
```

## Предлагаемая файловая структура

Пустые каталоги заранее не создавать — только вместе с первым vertical slice.

```text
desktop/Hub.Desktop/
├── Shell/                 # tray status, quick actions, taskbar, Jump List
├── DeepLinks/             # hubit:// and launch request parser
├── Workspace/             # safe last route and window placement
├── Printing/              # explicit WebView2 print service
├── Transfers/             # shared taskbar progress only if needed
├── Identity/              # CNG/domain device-bound flow, gated
└── Remote/                # handler preflight, no VNC engine

WEB-itinvent/frontend/src/
├── components/layout/DesktopShellSync.jsx
├── components/search/HubCommandPalette.jsx
├── lib/desktopShellStatus.js
├── lib/hubCommands.js
└── api/globalSearch.js

WEB-itinvent/backend/
├── api/v1/search.py
├── services/global_search_service.py
└── desktop-device auth model/service/endpoints (по ADR-0005)
```

---

## 8. Что сознательно не добавлять

### Не добавлять вообще без нового архитектурного решения

- WPF-копии чата, почты, задач, билетов, файлов или настроек;
- встроенный движок Word/Excel/PowerPoint;
- хранение HUB/AD password, cookies или refresh token в C#;
- generic `execute`, `openPath`, `openUrl`, `runPowerShell` bridge;
- второй WebSocket или отдельный Desktop backend;
- бессрочную сессию без cryptographic reauthentication и revoke;
- скрытый remote control, employee monitoring, screenshots или key logging;
- автоматическую отправку logs/crash dumps/documents без явного согласия;
- multi-account переключение с сохранением нескольких активных профилей;
- собственный VNC/RDP-клиент;
- automatic MSIX migration ради самого формата.

### Пока отложить

- offline создание/редактирование задач, почты и документов;
- Windows Explorer «Отправить в HUB»;
- share target и file associations;
- несколько независимых WebView-окон;
- native inline reply из Windows toast;
- календарную/Outlook shell-интеграцию;
- обязательные блокирующие update;
- полноценный Kerberos SSO без domain identity gateway.

Причина отложения: эти функции создают новые хранилища, permissions, audit, synchronization или
package-identity границы и дают меньшую ценность, чем F1–F4.

---

## 9. Метрики функционального успеха

Собирать только агрегаты без raw query, route IDs, names, filenames и message content.

| Волна | Метрика |
|---|---|
| F1 | доля открытий из tray; badge update latency; mute usage; tray action failures |
| F2 | successful/blocked deep links; cold/warm activation latency; route restore failures |
| F3 | print dialog success/error; download cancel/failure; taskbar progress lifecycle errors |
| F4 | palette open → command latency; zero-result/timeout rate по domain без query text |
| F5 | device enrollment success; TPM/software ratio; silent reauth/revoke/fallback rate |
| F6 | handler present/missing; launch attempt error category без address/credentials |

Нужные субъективные проверки пилота:

- сколько действий пользователь экономит для задач/чата/почты;
- стало ли понятно, где искать unread/download/update;
- воспринимается ли Desktop как более быстрый HUB, а не браузер в рамке;
- не мешают ли tray, badge, mute и автозапуск рабочему процессу.

---

## 10. Рекомендуемая последовательность реализации

После завершения F0:

1. `SHELL-01`: pure status model + bridge tests, затем taskbar/tray presentation.
2. `SHELL-02`: permission-aware quick routes из существующего navigation config.
3. `WORK-01`: window placement и безопасный last route.
4. `NAV-01`: один parser для `hubit://`, `--route` и single-instance forwarding.
5. `NAV-02`: Jump List и «Открыть в браузере».
6. `DOC-01`: явная печать и `Ctrl+P`.
7. `DOC-02/03`: taskbar download progress, Cancel/Clear/Open folder.
8. `SEARCH-01`: route/action command palette без backend.
9. `SHELL-03/04`: quick-create после route contracts, mute/privacy.
10. `REMOTE-01/02`: handler UX без нового VNC-клиента — реализовано, требуется ручная матрица.
11. `WINDOW/THEME/ACCESS/CONNECT`: реализовано, требуется ручной UI-аудит.
12. `AUTH-01`: отдельный безопасный pilot после threat-model gate — не начинать автоматически.
13. `SEARCH-02`: единый backend search только после измерения пользы palette — пока не делать.

## Почему именно такой порядок

- пункты 1–9 в основном используют уже существующие данные и routes;
- каждый является небольшим проверяемым vertical slice;
- user value появляется до добавления нового backend/security perimeter;
- AUTH и global search не смешиваются с low-risk shell changes;
- самый рискованный shell upload остаётся discovery, пока не доказана необходимость.

---

## 11. Definition of Done функционального vertical slice

Функция считается готовой, только если:

- описана конкретная пользовательская задача и web fallback;
- React остаётся владельцем permissions/business action;
- bridge использует exact schema, bounds и capability check;
- trusted origin/internal route проверены с обеих сторон;
- нет generic command/path/URL;
- старый Desktop + новый frontend и новый Desktop + старый frontend деградируют безопасно;
- unit/frontend tests включают negative/malformed/concurrent cases;
- keyboard/Narrator/DPI/tray state проверены;
- logout/revoke очищает персональное native state;
- support bundle/logs не содержат content, raw query, filename, SID или token;
- installer/update regression не теряет profile/autostart/settings;
- документация и compatibility matrix обновлены;
- функция прошла пилот и имеет понятный rollback/feature flag, если затрагивает auth или backend.

---

## 12. Итоговое продуктовое решение

Ближайшее функциональное развитие после release-gate: **Windows command center** — unread/status,
permission-aware быстрые маршруты, taskbar badge и безопасное восстановление рабочего контекста.
Это даст заметную ежедневную пользу без нового backend и без превращения Desktop в отдельное
приложение с дублирующей бизнес-логикой.

Следующая по ценности связка: `hubit://` + Jump List + печать. Затем — command palette. Device-bound
повторный вход остаётся самым важным крупным улучшением, но должен идти отдельным security-пилотом.
Единый поиск и shell upload нельзя начинать раньше, чем простые сценарии подтвердят реальную
пользу у пользователей.
