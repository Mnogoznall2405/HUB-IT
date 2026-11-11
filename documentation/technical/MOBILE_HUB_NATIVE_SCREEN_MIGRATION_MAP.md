# HUB-IT Mobile — итоговая карта нативного интерфейса

- Статус: APK переведён в native-only режим; портал и WebView-fallback удалены из пользовательской навигации.
- Дата среза: 2026-08-26.
- Клиент: `mobile-hub/` (Expo React Native, Android).
- Фактическая маршрутизация: `mobile-hub/src/navigation/moduleRegistry.ts`.
- Фактический состав меню: `mobile-hub/src/navigation/mobileNavItems.ts`.
- Детальный контракт web-страниц: [MOBILE_HUB_WEB_PARITY_MATRIX.md](./MOBILE_HUB_WEB_PARITY_MATRIX.md).
- Детальная карта Chat: [MOBILE_HUB_NATIVE_CHAT_GAP_ROADMAP.md](./MOBILE_HUB_NATIVE_CHAT_GAP_ROADMAP.md).
- Chat исключён из текущей ревизии: его код, механики и тесты ведёт отдельный агент.

## 1. Итоговое решение

В APK показываются только:

1. уже работающие native-default модули;
2. реализованные canary-модули, только если их build-time flag включён;
3. нативные профиль, настройки и разрешённые административные экраны.

Чисто web-разделы удалены из мобильного меню и из выбора нижней навигации. Их frontend, backend и права не удаляются. WebView-fallback отсутствует: старые `/web` и `/portal` ссылки преобразуются в нативный маршрут, неизвестный или выключенный раздел открывает безопасный нативный корень либо меню.

## 2. Общий прогресс

| Контур | Покрытие интерфейса | Покрытие механик | Что означает |
|---|---:|---:|---|
| Активные native-default модули | **94%** | **88%** | Основные ежедневные сценарии, аналитика и безопасные CRUD/actions открываются нативно; неперенесённые platform/backend-сценарии в APK недоступны |
| Реализованные, но выключенные canary-модули | **63%** | **38%** | Код, typed API, состояния и тесты есть, но перенесён только безопасный read-only/metadata срез |
| Весь уже написанный native-код, включая canary | **85%** | **73%** | Среднее по 20 реализованным группам экранов, без скрытых web-only страниц |
| Скрытые web-only разделы | **0%** | **0%** | Не переводятся и больше не отображаются в меню APK |

Проценты — оценка покрытия функционального контракта web-версии, а не процент строк кода и не подтверждение релизной готовности. Физическая Android-приёмка остаётся отдельным gate.

## 3. Активные нативные модули

| Маршрут / группа | Native-экран | UI | Механики | Что уже работает | Что не перенесено |
|---|---|---:|---:|---|---|
| Login, 2FA, setup, biometric/app lock | `app/(auth)/*` | 95% | 90% | Нативная авторизация, SecureStore, обязательный About onboarding, первичная настройка 2FA и backup codes, shell auth-guard, биометрия только после свежего 2FA, восстановление сессии | Реальные device-сценарии и WebAuthn/passkey требуют отдельной проверки |
| `/dashboard` | `DashboardScreen` | 90% | 80% | Сводка, внимание, задачи, новости, communication counters, быстрые действия | Неподдерживаемые вложенные ссылки возвращаются на нативный корень раздела |
| `/notifications` | `NativeNotificationCenterScreen` | 90% | 85% | HUB + Mail timeline, read one/all, refresh, native destinations; offline-переход не помечает уведомление прочитанным | Реальный FCM из killed/background ещё device-gate |
| `/tasks` | `NativeTasksInboxScreen`, detail, create, analytics, taxonomy | 95% | 90% | Серверные scope/role/department/controller/assignee/due/files/unread-фильтры, сортировка и pagination; полная карточка, status log/link/delete, comments, capability-actions, checklist, вложения и расширенное создание/редактирование; нативная аналитика с Excel и управление проектами/объектами | Board/calendar/gantt-представления недоступны в APK; реальная приёмка файлов, конфликтов и task-discussion остаётся device gate |
| `/feed` | `NativeFeedInboxScreen`, `NativeFeedPostScreen`, editor | 95% | 90% | Лента и управляемые представления draft/scheduled/published/archived; категории/теги, audience, schedule/expiry/pin, Markdown preview, multi-poll, вложения, комментарии, шесть реакций, пользователи/аналитика реакций, системный Share и permission-gated permanent delete | QR-share, полный GFM, серверная pagination `/announcements/manage`, timed autosave и физические picker/share/offline-сценарии остаются platform/backend gate |
| `/chat` | `NativeChatInboxScreen`, `NativeChatThreadScreen` | 95% | 90% | Telegram-подобный UX, папки, realtime, reply/edit/delete/forward, реакции, voice/GIF/files, поиск, media viewer, свайпы и анимации | Нужен финальный device-smoke якоря композера, zoom и клавиатуры |
| `/mail`, `/mail/compose` | Native Mail stack | 97% | 93% | Компактный inbox с единым search-header, переключателем аккаунта, нативным меню папок, одной строкой фильтров, плотными memoized-строками, selection-toolbar, swipe/undo и FAB; Mailbox/folder CRUD/favorite, advanced search, conversations, bulk actions, reply/forward/quick reply, drafts, retry-safe send и attachments. Reader переработан в цельное нативное полотно: крупная тема и мета цепочки, раскрываемые адресаты, AI-пересказ через существующий Mail API, переходы к соседним загруженным письмам, авто-высотный безопасный HTML без внутреннего скролла и закреплённая панель `Ответить / Переслать / Важное / Удалить / Ещё`; сохранены headers, EML, print и authenticated Office→PDF preview | Quill/CID rich-authoring, AI consent, IT-request wizard и durable offline mutation queue недоступны в APK; реальные Exchange/print/Office-handler сценарии остаются device gate |
| `/database` | `NativeDatabaseScreen`, equipment detail | 95% | 90% | Browse/search, оборудование, расходники, акты, карточка, CRUD, transfer/location/act-only, maintenance, recent acts/cards, файлы, QR clipboard и нативное сканирование камерой с permission/error/rescan; массовые операции одним bulk-запросом с operation polling; PDF picker, распознавание, проверка и commit акта | Bulk maintenance/delete/consumables без серверного atomic bulk, idempotent PDF commit и физическая camera/SQL/picker-приёмка остаются backend/device gate |
| `/my-files` | `NativeMyFilesScreen` | 100% | 95% | Список, quota, upload progress/cancel, download/open/share, безопасный image/PDF/Office/text preview, public link с expiry/rotation, revoke/delete и нативный SAF folder picker с рекурсивной ZIP-упаковкой в background worker | Нужна физическая Android-проверка SAF, больших папок, отмены и частичных ошибок ZIP |
| `/company-structure` | `NativeCompanyStructureScreen` | 95% | 90% | Дерево, breadcrumbs, поиск, сотрудники, полный writer CRUD/move/order, руководители и связи ЗУП, подтверждаемый импорт, авторизованные upload/delete фото | Свободная карта структуры недоступна в APK; физическая проверка picker/camera остаётся device gate |
| `/docflow` | Native Docflow inbox/detail/create | 95% | 90% | Credentials, scopes, поиск, progressive detail, async PDF preview и оригиналы файлов, capability-actions с idempotency/polling, создание поручения | ЭЦП, открытие официального клиента 1С и реальные 1С-команды остаются runtime/device gate |
| `/address-book` | `NativeAddressBookScreen` | 90% | 85% | Поиск, звонок, почта, sync, empty/error | Нужна физическая проверка large font и Android intents |
| `/menu`, `/profile`, `/settings/*` | Native account stack | 90% | 85% | Профиль, avatar, тема, уведомления, security, app/about, настройка нижнего меню | Системные разрешения и часть security-flow требуют device-smoke |
| `/admin`, users/departments/sessions | Native admin stack | 90% | 85% | Пользователи, роли/права, Exchange mapping, помощники/заместители задач, неизменяемый логин, реальные счётчики отделов, подтверждаемая AD-синхронизация и dry-run ограничения сессий | Web-only AD, AI и System скрыты из APK |

Среднее по этой таблице: **94% UI / 88% механик**. Chat оставлен в таблице только как отдельный контур учёта и не изменялся в этой ревизии.

## 4. Реализованные canary-модули

Эти экраны уже написаны, но их flags по умолчанию `false`. Поэтому они скрыты из меню обычной сборки; прямые native-маршруты также закрыты fail-closed guard. При canary-сборке плитка появляется автоматически.

| Маршрут | Flag | UI | Механики | Реализованный безопасный срез | Не перенесено |
|---|---|---:|---:|---|---|
| `/scan-center` | `EXPO_PUBLIC_NATIVE_SCAN_CENTER_ENABLED` | 75% | 45% | Overview, review queue, incidents, agents, hosts, search/filter/pagination; отдельный allowlisted mobile DTO, abort и очистка данных при blur/background/offline | ACK, команды, расследование, export |
| `/computers` | `EXPO_PUBLIC_NATIVE_COMPUTERS_ENABLED` | 75% | 50% | Summary, server search/filter, pagination, MAC detail через bounded path-free mobile DTO; write-действия защищены `computers.manage` | Global history, hide/unhide в native UI |
| `/passwords` | `EXPO_PUBLIC_NATIVE_PASSWORDS_ENABLED` | 55% | 25% | Metadata-only список, группы/теги, archive и detail без secret payload; fail-closed screen-capture gate и очистка offline | Unlock/reveal/copy/CRUD, AD expiry, passkey/2FA |
| `/groups-access` | `EXPO_PUBLIC_NATIVE_GROUPS_ACCESS_ENABLED` | 55% | 30% | Snapshot status и bounded-поиск папок/групп | Users, members, matrix-grid, Excel, refresh job |
| `/warehouse-1c` | `EXPO_PUBLIC_NATIVE_WAREHOUSE_1C_ENABLED` | 45% | 25% | Snapshot status и bounded-поиск номенклатуры/складов; файлы `private/no-store`, download bridge проверяет Base64 и размер | Live balances/movements, employees, files, sync/reconcile |
| `/mfu` | `EXPO_PUBLIC_NATIVE_MFU_ENABLED` | 70% | 50% | Totals, IP/model search, filters, runtime, supplies, counter и maintenance history | Monthly и атомарное списание + регистрация работы |

Среднее по canary: **63% UI / 38% механик**. Они не считаются включёнными в пользовательский APK до явного изменения flag и физической приёмки.

## 5. Скрытые разделы — перенос прекращён

| Маршрут | Решение для APK |
|---|---|
| `/tickets` | Скрыт из мобильного меню; нативный экран не планируется |
| `/networks`, `/networks/:branchId` | Скрыты; нативная схема/редактор не планируются |
| `/vcs` | Скрыт |
| `/dlp`, `/file-egress` | Скрыты, включая admin-навигацию |
| `/statistics` | Скрыт |
| `/kb` | Скрыт; выполнен только read-only аудит, native-код не создавался |
| `/admin/ad-users` | Скрыт из Native Admin |
| `/admin/ai-bots` | Скрыт из Native Admin |
| `/admin/system` | Скрыт из Native Admin |
| `/about` onboarding | Не добавляется как отдельный пункт меню; реализован обязательным нативным auth-flow первого входа |
| `/shared-files/:token` | Не является пунктом меню; публичные ссылки остаются внешним web-сценарием |

Compatibility redirects `/dashboard/news` и `/ad-users` отдельными mobile-экранами не считаются.

## 6. Правило мобильной навигации

Source of truth — `mobile-hub/src/navigation/mobileNavItems.ts`:

- native-default модули входят в меню только при наличии permission;
- canary-модуль входит в меню только при включённом `NATIVE_*_ENABLED`;
- чисто web-модули отсутствуют в `navigationItems` и в `MOBILE_BOTTOM_NAV_ALLOWED_PATHS`;
- сохранённые старые пользовательские пункты нижнего меню фильтруются по текущему набору доступных native-модулей;
- Native Admin показывает только users, departments и sessions;
- прямой доверенный deep link преобразуется только в нативный маршрут; выключенный или неизвестный раздел открывает безопасный нативный корень либо меню.

## 7. Проверенная база на момент фиксации

- TypeScript/lint: **успешно**;
- целевой native-only regression: **20/20 suites, 198/198 tests**;
- полный mobile regression: **195/195 suites, 970/970 tests**;
- Expo Doctor: **21/21 checks passed**;
- Android Expo export: **успешно**, Hermes bundle 6,7 МБ; результат — `mobile-hub/.expo-build-check-native-only/`;
- статический поиск не нашёл portal WebView, mobile web-session, web-кнопок или web-fallback в пользовательских маршрутах;
- `react-native-webview` сохранён только в изолированных content-renderer компонентах HTML-почты, Chat video и экспорта результата редактора изображения; портал и web-session там не используются;
- `adb devices` не обнаружил подключённого устройства, поэтому install/smoke, камера, picker, intents, push из background/killed и визуальная приёмка на физическом Android не подтверждены;
- preview APK `1.1.14` (`versionCode 16`) собрана и опубликована: 64 306 830 bytes, SHA-256 `cec605f52d701269d4061c3566c7e7ffa7ba119e68fc50a5e0464da2c9aa0802`, `arm64-v8a` + `armeabi-v7a`, Android v2 signature; внешний manifest/APK post-check вернул `verified=true`;
- APK подписана совместимым сертификатом `debug-preview`; это не постоянная stable release-подпись;
- backend, PM2 и IIS не менялись и не перезапускались.

## 8. Как читать проценты

`UI` оценивает нативные list/detail/forms, адаптивность, loading/empty/error и визуальные состояния относительно web-модуля.

`Механики` оценивают поиск/фильтры, pagination, CRUD/actions, realtime/push, gestures, files/camera/share, deep links, lifecycle, conflict/idempotency и offline-поведение. Неперенесённая критическая запись снижает процент сильнее, чем второстепенная декоративная деталь.

Оценка округлена до 5%. Она нужна для управления scope; это не SLA и не доказательство пользовательской приёмки.
