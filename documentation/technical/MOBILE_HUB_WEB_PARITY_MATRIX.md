# HUB-IT Mobile — матрица полного паритета с responsive web

Статус: рабочая матрица реализации и приёмки  
Дата среза: 2026-08-25  
Источники истины: `WEB-itinvent/frontend/src/App.jsx`, `components/layout/navigationConfig.jsx`, `components/account/accountNavigationConfig.jsx`

## Решение

Responsive web-клиент остаётся эталоном функционального контракта для browser и Desktop. Дальнейший перенос новых Android-разделов остановлен 2026-08-24: итоговый native scope и скрытые из APK-навигации web-only страницы зафиксированы в [карте нативного интерфейса](./MOBILE_HUB_NATIVE_SCREEN_MIGRATION_MAP.md). Защищённый WebView в APK сохраняется только как технический fallback для точных hybrid-действий и доверенных прямых ссылок.

Нативный слой отвечает за:

- login/2FA, SecureStore и lifecycle mobile-сессии;
- одноразовый обмен mobile-сессии на HttpOnly cookie для WebView;
- native push и переход по deep link;
- запрет навигации на недоверенные origin;
- загрузку, сетевую ошибку, повтор и Android Back;
- сборку и доставку APK.
- выбранные завершённые mobile-сценарии, перечисленные в карте миграции, с обязательным точным WebView fallback для ещё не перенесённых действий.

Refresh-токен не передаётся в URL или JavaScript WebView. Native-клиент подтверждает пару access/refresh серверу, получает одноразовый код на 60 секунд, а bootstrap-страница обменивает код на HttpOnly cookies и сразу удаляет fragment из истории.

## Каталог страниц

| № | Маршрут | Доступ | Функциональный контракт для mobile | Обязательная проверка |
|---:|---|---|---|---|
| 1 | `/login` | публичный | Пароль, режим сети, 2FA, passkey там, где WebView поддерживает WebAuthn | Ошибка, 2FA, возврат после logout |
| 2 | `/shared-files/:token` | публичная ссылка | Просмотр и скачивание опубликованного файла | Валидная, истёкшая и отозванная ссылка |
| 3 | `/about` | авторизованный onboarding | Обязательное знакомство с HUB-IT | Первый вход и повторный вход |
| 4 | `/dashboard` | `dashboard.read` | Сводка, счётчики, быстрые действия, переходы в модули | Loading, partial error, узкая ширина |
| 5 | `/feed` | `dashboard.read` | Лента событий/новостей, фильтры и переходы | Empty, pagination/refresh, deep link |
| 6 | `/tasks` | `tasks.read` | Список, фильтры, карточка, комментарии и действия по capabilities | Запрещённое действие, конфликт, обновление |
| 7 | `/tickets` | `tickets.read` | Список обращений, создание, просмотр и разрешённые переходы статуса | Empty, validation, upload, permissions |
| 8 | `/chat` | `chat.read` + feature flag | Диалоги, thread, realtime, unread, файлы, реакции, поиск и контекст | Reconnect, duplicate/order, upload, deep link |
| 9 | `/mail` | `mail.access` | Папки, списки/диалоги, поиск, просмотр, reply/forward, move/delete, вложения | Не настроена почта, offline, bulk actions |
| 10 | `/mail/compose` | `mail.access` | Отдельный composer, черновики, форматирование, вложения и отправка | Восстановление draft, validation, close guard |
| 11 | `/docflow` | `docflow.read` | Документооборот, карточки, состояние, согласование/отклонение | Capabilities, stale state, файлы, ошибки 1С |
| 12 | `/address-book` | `address_book.read` | Поиск сотрудников, контакты и переходы к связанным данным | Empty/search/no result, звонок/почта |
| 13 | `/company-structure` | `company_structure.read` | Дерево подразделений, люди, поиск, мобильный drawer | Deep link узла, empty people, back |
| 14 | `/passwords` | `passwords.read` | Хранилище записей, поиск, просмотр и разрешённые CRUD-действия | Маскирование, copy, permissions, validation |
| 15 | `/groups-access` | `groups_access.read` | Доступ к папкам/группам, поиск и заявки/операции | Empty, permissions, operation result |
| 16 | `/my-files` | `my_files.read` | Плоский список файлов, загрузка, скачивание, публикация и удаление; выбор папки в web создаёт один ZIP, а не серверную папку | Upload/download, quota, timeout ambiguity, share/revoke/delete |
| 17 | `/database` | `database.read` | Учёт оборудования/расходников, поиск, карточка, QR, перемещение, акты и работы | Selection mode, scanner, upload/download, capabilities |
| 18 | `/networks` | `networks.read` | Филиалы, схемы, адреса/узлы, поиск и разрешённое редактирование | Empty branch, zoom/pan, narrow layout |
| 19 | `/networks/:branchId` | `networks.read` | Deep link конкретного филиала с тем же состоянием Networks | Несуществующий branch, back, URL restore |
| 20 | `/vcs` | `vcs.read` | Терминалы ВКС, поиск, карточки и операции | Empty/error, permissions, narrow cards |
| 21 | `/mfu` | `mfu.read` | МФУ, счётчики, расходники, история и регистрация работы | Monthly pages, validation, offline refresh |
| 22 | `/computers` | `computers.read` | Компьютеры, фильтры, карточки, инвентарные/agent-данные и действия | Pagination, stale agent, permissions |
| 23 | `/scan-center` | `scan.read` | Overview, задачи/инциденты scan, агенты и разрешённые операции | Proxy error, queue states, retry, permissions |
| 24 | `/dlp`, `/file-egress` | только admin | DLP/file-egress probe, фильтры и расследование | Admin gate, large table, empty/error |
| 25 | `/statistics` | `statistics.read` | Показатели, диапазоны, таблицы и графики | Loading, no data, chart resize, export |
| 26 | `/kb` | `kb.read` | База знаний, рубрики, поиск, статья и разрешённое редактирование | Empty search, article deep link, unsafe HTML |
| 27 | `/warehouse-1c` | `warehouse_1c.read` | Остатки, движения, серии, склады, сотрудники и deep links | Timeout 1С, stale snapshot, no match |
| 28 | `/menu` | авторизованный | Точная сетка всех доступных модулей и блок аккаунта | Фильтрация прав, 3 колонки, 125% text |
| 29 | `/profile` | авторизованный | Профиль, аватар и персональные данные | Upload/delete avatar, long values |
| 30 | `/settings/appearance` | авторизованный | Тема, шрифт и mobile bottom navigation | Dark/light, font scale, persistence |
| 31 | `/settings/notifications` | авторизованный | Каналы, browser/chat push и статусы | Permission denied, unavailable, refresh |
| 32 | `/settings/security` | авторизованный | 2FA, passkey, trusted devices, backup codes, пароль | Re-auth, revoke, WebAuthn capability |
| 33 | `/settings/app` | авторизованный | Desktop/PWA/mobile сведения и обновления | Platform-specific copy and links |
| 34 | `/settings/about` | авторизованный | Сведения о возможностях и версиях HUB-IT | Long content and links |
| 35 | `/admin/users` | `settings.users.manage` или admin | Пользователи, роли, права, activation/reset | Admin IP gate, validation, no hard delete |
| 36 | `/admin/departments` | `departments.manage` или admin | Отделы, состав и руководители | CRUD validation, conflict, permissions |
| 37 | `/admin/ad-users` | `ad_users.read/manage` или admin | Импорт и синхронизация AD | Dry state, sync errors, permissions |
| 38 | `/admin/ai-bots` | `settings.ai.manage` или admin | Модели, инструменты и запуски AI-ботов | Secret masking, validation, test action |
| 39 | `/admin/sessions` | `settings.sessions.manage` или admin | Активные сессии, завершение и безопасная очистка | Current session, confirm, refresh |
| 40 | `/admin/system` | только admin | Env/allowlist/служебные параметры | Secret masking, admin IP, no accidental write |

`/dashboard/news` и `/ad-users` остаются только совместимыми redirect-маршрутами и отдельно не реализуются.

## Порядок page-by-page приёмки

Для каждой строки перед переводом в «готово» выполняются одинаковые проверки:

1. Сравнение с той же production/dev web-страницей на 360×800, 390×844 и 412×915.
2. Проверка обычного текста и Android font scale 125% без горизонтального overflow и обрезания навигации.
3. Loading, empty, error, expired session и denied permission.
4. Все видимые действия: успешный путь, validation, серверный отказ и повтор.
5. Deep link, Android Back, возврат после background и восстановление состояния.
6. Загрузка/скачивание/камера/QR/WebAuthn — только на реальном Android; browser smoke не считается заменой.

## Текущий статус

- Каталог маршрутов и permission gates зафиксирован по исходному коду.
- Защищённый session bridge и полноэкранный WebView shell реализованы, покрыты тестами и включены в локальный preview APK.
- Native push и deep link открывают соответствующий web-маршрут в shell на уровне кода; холодный запуск по уведомлению ещё нужно подтвердить на Android.
- Для пакета страниц 1–10 production frontend собран, 178 профильных web-тестов прошли и 2 пропущены; это автоматическая проверка кода, а не ручная WebView-приёмка.
- Для пакета страниц 11–20 прошли 129/129 профильных web-тестов в 10 файлах. Docflow подтверждает раздельную загрузку ядра карточки и связанных данных; Networks, deep link филиала и VCS пока проверены только по маршрутам и responsive-коду, без прямых page-тестов.
- Для пакета страниц 21–30 прошли 80/80 профильных web-тестов в 13 файлах. Прямо покрыты Computers, Scan Center, Knowledge Base, Warehouse 1C, Mobile Menu, Profile и Account/Settings; МФУ, DLP/File Egress и верхний уровень Statistics пока имеют только статическую проверку responsive-кода и тесты вложенных компонентов.
- Для пакета страниц 31–40 прошли 47/47 профильных web-тестов в 8 файлах. Прямо покрыты Notifications, App/About, AD Users и AI Bots, а общий AccountWorkspace проверяет секционную навигацию; Security, Users, Departments, Sessions и System пока проверены по общему responsive-layout и permission gates без отдельных полностраничных тестов.
- Суммарно по каталогу 1–40 прошли 434 профильных теста, 2 теста пропущены. Это не заменяет ручные Android-сценарии камеры, QR, файлов, WebAuthn, push, background/restore и визуальное сравнение на физических разрешениях.
- Фактическая ручная приёмка всех строк ещё не выполнена; до неё нельзя заявлять полный production-паритет.
- Активный non-Chat native-контур доведён до 94% UI / 88% механик: Tasks получили расширенные server filters, аналитику/Excel и taxonomy management; Feed — управляемые представления, категории, полный reaction UX и аналитику; Mail — компактный unified inbox, account/folder sheets, одну строку фильтров, dense list, selection-toolbar, swipe/undo, quick reply и цельный reader по мобильному референсу: крупная тема, мета цепочки, AI-пересказ, переходы к соседним письмам, авто-высотный HTML без внутреннего скролла и фиксированная нижняя панель действий; EML/headers/print и Office preview сохранены. Database — полный writer-срез, camera QR, bulk transfer/location/act-only и PDF act flow; My Files — нативную упаковку выбранной Android-папки в ZIP. Точные platform/backend-gates перечислены в итоговой карте.
- `/company-structure` доведён до нативного writer-среза: дерево, поиск, сотрудники, CRUD/move/order, руководители, связи ЗУП, подтверждаемый импорт и авторизованная работа с фото. Свободная карта структуры и физическая проверка picker/camera остаются hybrid/device gate.
- `/docflow` доведён до нативных inbox/detail/create: credentials, поиск, progressive detail, async PDF preview, оригиналы файлов и capability-actions с idempotency/polling. ЭЦП, запуск официального клиента 1С и реальные 1С-команды остаются runtime/device gate.
- `/scan-center` реализован нативно как выключенный по умолчанию read-only canary: overview, неполные проверки, инциденты, агенты и хосты с серверным поиском, фильтрами, pagination, retry и безопасным background refresh. ACK, agent-команды, расследование и экспорт остаются в WebView. Прошли TypeScript, 145/145 mobile suites, 637/637 tests и canary Android Expo export; физическая Android/runtime-приёмка ещё не выполнена.
- `/computers` реализован нативно как выключенный по умолчанию read-only canary: сводка, server-side поиск/фильтры, pagination и внутренняя карточка по MAC с offline/error/retry и foreground refresh. Global history и hide/unhide оставлены в WebView из-за найденных backend permission gaps. Прошли TypeScript, 149/149 mobile suites, 657/657 tests и canary Android Expo export; физическая Android/inventory-agent приёмка ещё не выполнена.
- `/passwords` реализован нативно как выключенный по умолчанию metadata-only canary: поиск, группы, теги, архив и карточка без загрузки секрета. Unlock/reveal/copy/CRUD, AD-expiry и 2FA/passkey оставлены в WebView до устранения backend security/concurrency gaps и появления защищённого Android clipboard. Прошли TypeScript, 152/152 mobile suites, 668/668 tests и canary Android Expo export; физическая Android/security-приёмка ещё не выполнена.
- `/groups-access` реализован нативно как выключенный по умолчанию bounded read-only canary: статус снимка AD, динамические филиалы и постраничный поиск папок/групп. Сотрудники, состав групп, matrix-grid, Excel и admin refresh оставлены в WebView из-за unbounded payload и отсутствия async job-контракта. Прошли TypeScript, 155/155 mobile suites, 682/682 tests и canary Android Expo export; физическая Android/AD-приёмка ещё не выполнена.
- `/warehouse-1c` реализован нативно как выключенный по умолчанию snapshot-only canary: статус свежести и bounded-поиск номенклатуры/складов работают без live COM. Остатки, движения, сотрудники, файлы, sync и reconcile оставлены в WebView; query/hash/deep links также остаются там. Прошли TypeScript, 159/159 mobile suites, 699/699 tests, 50 профильных backend-тестов и canary Android Expo export; физическая Android/1С-приёмка ещё не выполнена.
- `/mfu` реализован нативно как выключенный по умолчанию bounded read-only canary: totals, поиск/фильтры, runtime, расходники, текущий счётчик и история работ берутся из одного защищённого snapshot endpoint. SNMP community удалён из публичного ответа. Monthly и списание/регистрация работы остаются в WebView до безопасных серверных контрактов. Прошли TypeScript, 163/163 mobile suites, 714/714 tests, 18 профильных backend-тестов и canary Android Expo export; физическая Android/MFU-приёмка ещё не выполнена.
- Итоговая актуальная сводка по native-default, canary и скрытым web-only страницам, а также единый текущий набор проверок находятся в [карте нативного интерфейса](./MOBILE_HUB_NATIVE_SCREEN_MIGRATION_MAP.md); исторические промежуточные счётчики выше не являются финальной regression-базой.
- Текущая проверенная база после референсной UI-ревизии Mail: 190/191 mobile suites и 935/936 tests; единственный сбой относится к постороннему Tasks-контракту `task_mode=board`. Все 91 Mail-тест, TypeScript, Expo Doctor 21/21 и Android Expo export прошли. Повторная локальная APK-сборка блокируется воспроизводимым исчезновением временного Gradle transform-артефакта `module.jar`; предыдущая dual-ABI preview APK не включает последнюю Mail/QR-ревизию и не публиковалась заново. Код Chat не менялся в рамках этого среза, физическая Android-приёмка и production deployment не выполнялись.
