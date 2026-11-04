# 15. DESKTOP: WPF / WebView2

Дата перепроверки: 2026-11-03, Asia/Yekaterinburg.
Область: `desktop/`, bridge и callers в текущем checkout, включая внешние незакоммиченные правки.
Режим: read-only аудит; создан только отчет. Build, installer, update, сеть и production не запускались.
Обозначения: **R** — изолированное воспроизведение текущей функции; **S** — подтвержденный код; **H** — гипотеза.
Для этого модуля результаты S/H; C# runtime и Windows WebView2 acceptance не выполнялись.

## Вывод

- OP-03 исправлен частично: исключение Downloads появилось, но пять нужных `.cs` остаются untracked.
- В downloads coordinator paused операции удаляются как completed, а их cancellation delegates остаются в Map.
- Закрытые secondary окна удерживаются анонимным обработчиком shared downloads collection.
- Старый CL-06 изменен извне: registry теперь ограничен 500 записями и TTL 30 минут, Dispose вызывает Clear.
- Отзыв shared-file capabilities на logout не найден; это отдельная гипотеза жизненного цикла, не прежний unbounded-map дефект.
- Update manifest/package checks ограничивают размер и проверяют подпись/hash; переполнения update cache не подтверждено.

## Архитектура и границы

01. `desktop/README.md:9` определяет Desktop как shell существующего портала.
02. Business REST/auth/chat остаются в web frontend/backend; Desktop не должен дублировать их.
03. `desktop/Hub.Desktop/App.xaml.cs:45` разбирает launch request и notification activation.
04. Per-user single instance создается в `App.xaml.cs:70`; повторный запуск пересылает запрос первому.
05. `App.xaml.cs:181` создает общий `DesktopDownloadCoordinator`.
06. Основное и второе окно получают один coordinator, `App.xaml.cs:203`, `:217–223`.
07. `DesktopWindowManager.cs:50` допускает одну secondary shell; compose окно имеет отдельную границу.
08. WebView2 сохраняет профиль пользователя; auth принадлежит порталу.
09. `NavigationPolicy.cs:35` сначала проверяет exact normalized origin.
10. SSO origin допускается только под `/adfs/`, `NavigationPolicy.cs:57`.
11. SSO redirect не становится trusted bridge origin.
12. External schemes ограничены HTTPS/mailto/tg/vnc и буквальным приватным IPv4 HTTP, `NavigationPolicy.cs:102`.
13. RFC1918 проверяется как IP, не по DNS или substring, `NavigationPolicy.cs:111`.
14. `MainWindow.xaml.cs:1380` перехватывает navigation и сбрасывает bridge ready для нового документа.
15. `DesktopBridgeHost.cs:347` проверяет source сообщения и текущего документа.
16. `DesktopBridgeProtocol.cs` разбирает отдельные типы сообщений, маршруты и ограниченные payload.
17. Handshake Ready включает host capabilities и Windows username, `DesktopBridgeHost.cs:362`.
18. `ResetDocumentReady` выключает готовность, но не очищает registry, `DesktopBridgeHost.cs:81`.
19. Bridge native действия доступны по перечню сообщений, не произвольному JS evaluation.
20. File pick/drop дает capability URL вместо передачи произвольного локального пути в web.
21. `DesktopSharedFileRegistry.cs:19` ограничивает одновременно сохраненные capability mappings.
22. `DesktopSharedFileRegistry.cs:20` вводит TTL; clock инъецируем для tests.
23. Внутри registry используются lock и обратная map для idempotency одного пути.
24. `DesktopBridgeHost.cs:294` обслуживает capability через FileStream только trusted document.
25. HTTP response выставляет no-store и nosniff; это не передача файла на внешний сервер.
26. `DesktopBridgeHost.Dispose:67` отписывает WebView events и теперь очищает registry в `:78`.
27. Downloads UI централизован: begin/progress/pause/resume/complete/cancel живут в coordinator.
28. Automatic open/print привязан к ограниченному 15-секундному intent, `DesktopDownloadCoordinator.cs:15`.
29. `MainWindow.xaml.cs:1824` передает resume; `:1831` передает retriable interruption как pause.
30. WebView operation events отписываются после terminal state, `MainWindow.xaml.cs:1835`.
31. Window close останавливает таймеры и закрывает WebViewHost, `MainWindow.xaml.cs:3039–3086`.
32. Memory sampling имеет in-flight guard, `MainWindow.xaml.cs:586`, `:599`.
33. Background WebView memory target меняется явно; скрытие окна само по себе не leak.
34. Native notifications используют Windows App SDK с fallback и correlation result.
35. Notification activation route проходит `IsValidInternalRoute`, `App.xaml.cs:61`.
36. Updates отделены в coordinator/service/runner и trust core.
37. Coordinator сериализует проверки через Interlocked, `DesktopUpdateCoordinator.cs:69`.
38. Manifest ограничен 32 KiB, setup 500 MiB, `DesktopUpdateManifestVerifier.cs:14–15`.
39. Manifest имеет строгую schema/key/signature проверку, `DesktopUpdateManifestVerifier.cs:37`.
40. Package скачивается потоком с ограничением manifest size, `DesktopUpdateService.cs:287`.
41. Package hash проверяется до move, `DesktopUpdateService.cs:305`.
42. Старые пакеты очищаются с сохранением текущего и двух новых, `DesktopUpdateService.cs:445`.
43. Старые runner directories чистятся по возрасту, `DesktopUpdateService.cs:413`.
44. Update runner ожидает parent exit, запускает setup через UAC и восстанавливает приложение при отказе.
45. `UpdateRunnerWorkflow.cs:34` использует `runas`; повышения привилегий аудит не выполнял.
46. Подпись исходного verifier не доказывает integrity установленного exe или опубликованного release.

## Реестр находок

| ID | Severity | Доказательство | Статус | Эффект |
|---|---|---|---|---|
| DDESK-01 | High | S | OPEN, OP-03 partial | Clean source checkout не содержит пяти Downloads классов. |
| DDESK-02 | Medium | S | OPEN | Trim удаляет paused downloads и оставляет cancellation references. |
| DDESK-03 | Medium | S | OPEN | Анонимный collection handler удерживает закрытое secondary окно. |
| DDESK-04 | Medium | H | NEEDS ACCEPTANCE | Shared-file tokens не отзываются немедленно при logout. |

### DDESK-01 — Downloads исходники видимы, но не отслеживаются

Код: `.gitignore:11` — `downloads/`; `.gitignore:12` — новое узкое исключение.
Caller: `desktop/Hub.Desktop/MainWindow.xaml.cs:18`, `:56`, `:149` используют Downloads namespace/coordinator.
Tracked tests: `desktop/Hub.Desktop.Tests/DesktopDownloadCoordinatorTests.cs` используют те же типы.
Read-only `git ls-files desktop/Hub.Desktop/Downloads` вернул пустой результат.
Read-only `git ls-files --others --exclude-standard desktop/Hub.Desktop/Downloads` вернул пять `.cs`.
Read-only `git check-ignore -v .../DesktopDownloadCoordinator.cs` завершился 1 без вывода: файл не ignored.
Таким образом проблема ignore снята, проблема source tracking остается.
Пять файлов: DesktopDownloadCoordinator.cs, DesktopDownloadInterruption.cs, DesktopDownloadItem.cs.
Еще два: DesktopDownloadPresentation.cs, DesktopFileLauncher.cs.
Копирование рабочей папки и наличие локальной сборки не подтверждают completeness Git source.
Build чистого checkout не выполнялся по границе задания; отсутствие tracked definitions подтверждено Git index.
Исправление: включить необходимые исходники в согласованный commit без посторонних файлов.
Сам аудит `git add`, commit, checkout, branch и публикацию не выполняет.
Acceptance: `git ls-files` содержит пять классов; чистый изолированный checkout проходит Release test/build.
Приемка должна использовать source tree выбранного commit, а не грязную папку разработчика.

### DDESK-02 — paused download ошибочно вытесняется

Код: `desktop/Hub.Desktop/Downloads/DesktopDownloadCoordinator.cs:338–350`.
Caller: BeginDownload в `:91`; WebView pause — `MainWindow.xaml.cs:1828–1832`.
`TrimCompletedItems` ищет `State != InProgress`; Paused удовлетворяет этому условию.
Между тем `DesktopDownloadItem.cs:101` считает Paused отменяемым живым состоянием.
При 100 строках начало новой загрузки удаляет paused запись, которая может продолжиться.
В trim отсутствует `_cancelActions.Remove`; такой delegate удерживает native operation после удаления UI item.
Terminal обработчики ищут item и при его отсутствии не освобождают соответствующий delegate.
`ClearFinished` перебирает только оставшиеся UI items, `DesktopDownloadCoordinator.cs:257–263`.
Следствие: исчезновение ожидающей загрузки, потеря cancel/resume tracking и накопление orphan references.
S: прослежены реальные state transitions и callers; C# runtime не запускался.
Исправление: выбирать только terminal состояния/`!CanCancel`, очищать related maps при любом remove.
Если живых операций уже 100, нужна явная admission policy; лимит истории не является лимитом concurrency.
Acceptance: 100 строк с Paused + Begin, последующий resume/complete/cancel; запись и native owner не теряются.
Отдельно: repeated trim не увеличивает `_cancelActions` после terminal событий.

### DDESK-03 — shared collection удерживает закрытые окна

Код: `desktop/Hub.Desktop/MainWindow.xaml.cs:342–343`.
Lifetime caller: shared coordinator создается в `App.xaml.cs:181` и повторно передается secondary в `:223`.
Конструктор подписывает anonymous lambda на `_downloads.Items.CollectionChanged`.
Lambda вызывает instance `RefreshDownloadsMenuItem` и тем самым удерживает окно.
`Window_Closed:3039` отписывает `_downloads.Changed` в `:3048`, но не anonymous CollectionChanged.
`DisposeDesktopBridge` и `_webViewHost.Dispose` не снимают подписку чужой коллекции.
Триггер: многократно открыть/закрыть secondary окно, основной процесс продолжает работать в tray.
Каждое закрытое окно остается достижимым через shared downloads collection и получает новые callbacks.
Это удержание managed graph; сохранение живого renderer process не доказано.
S: подтверждены publisher lifetime, capturing lambda и отсутствие соответствующей отписки.
Исправление: named handler/delegate field и symmetry subscribe/unsubscribe в Window_Closed.
Acceptance: WeakReference закрытого secondary очищается после GC; 50 циклов не увеличивают handlers.
Download event после закрытия не должен обращаться к disposed tray/menu объектов старого окна.
Измерить private bytes и event fan-out отдельно от WebView child process memory.

### DDESK-04 — capability lifetime и logout

Код: `DesktopBridgeHost.cs:81`, `:294–327`, `:424–435`; registry `DesktopSharedFileRegistry.cs:20`.
Logout caller: `MainWindow.xaml.cs:2001–2008` очищает last safe route при authenticated→false.
Registry Clear найден только в Dispose bridge (`DesktopBridgeHost.cs:78`), не в auth status transition.
ResetDocumentReady меняет только handshake flag; capability response проверяет origin текущей страницы.
H: существующий token теоретически разрешается в том же host после logout до TTL.
Нет подтвержденного сценария, как другой пользователь получает старый token; exploit не заявляется.
Это отдельная lifecycle граница, не повтор закрытого CL-06 про бесконечный рост Map.
Рекомендуется определить ожидаемый lifetime user-selected file capability при смене portal user.
Acceptance: зарегистрировать файл, logout без закрытия окна, попытка fetch прежнего URL; затем login другого owner.
Если договоренность требует немедленный отзыв: очистить registry на auth boundary и повторно запросить выбор файла.
Не менять auth, cookies или серверный refresh lifetime ради этого исправления.

## Перепроверка CL-06 и OP-03

CL-06: `DesktopSharedFileRegistry.cs:19` — maximum 500 mappings, `:20` — TTL 30 минут.
`AddFile:121` purge перед регистрацией, `TryGetFilePath:159` purge перед lookup.
`Clear:167` очищает все три map; bridge Dispose теперь вызывает его в `DesktopBridgeHost.cs:78`.
В tests добавлены ExpiredTokensStopResolvingAndClearForgetsEverything и TotalRegisteredFilesAreBoundedByDroppingTheOldest.
Статус прежней структуры: устранена в текущем source; runtime tests этого изменения здесь не запускались.
Нельзя называть CL-06 активной утечкой без учета внешнего исправления.
OP-03: ignore exception уже существует; source tracking остается незавершенным, см. DDESK-01.
Грязные файлы registry/tests/bridge сохранены; авторство внешних изменений аудитом не присваивается.
Наличие измененных файлов не означает deployed Desktop release.

## Проверки и ограничения

Git source checks выполнены read-only; пять untracked файлов перечислены выше.
Сверены API/state callers download coordinator, registry, bridge disposal и constructor/close subscriptions.
Просмотрены тесты registry, navigation, update trust и download coordinator по соответствующим сценариям.
Новых C# tests и harness-файлов не создавалось.
`dotnet test` и `dotnet build` не запускались: задача запрещает build, а обычный test может вызвать его.
Не использован `--no-build` как замена: старые бинарники не подтверждают текущие source изменения.
WPF/WebView2 UI не запускался; trusted origin/SSO/runtime events проверены по коду.
Update check/download/installer не вызывались, manifest и release package с сервера не читались.
Certificate/signing/runner rollback проверены как implementation, не как реальная установленная цепочка доверия.
Memory profiler/heap dump/GC acceptance для DDESK-03 не выполнялись.
Количество подписок и p95 после 50 циклов не измерено; заявлены только удерживающие ссылки в source.
Настройки Windows/autostart/registry/UAC и IIS/PM2 не менялись.

## False positives и намеренные решения

WebView2 persistent profile нужен silent auth; его постоянство не объявлено нарушением logout.
Exact trusted origin и отдельный SSO redirect сохранены; нет доказательства permissive bridge origin.
Private IPv4 HTTP external launch проверяет IP; широкая DNS доверительная политика не обнаружена.
Registry lock и reverse map обеспечивают внутри процесса идемпотентную регистрацию одного пути.
Отсутствие proactive TTL timer не делает Map неограниченной: есть limit и purge при register/lookup.
Таймеры memory/performance останавливаются на close; общий «все timers текут» тезис неверен.
Основные native download events отписываются при terminal состоянии; DDESK-03 относится к другому publisher.
Update downloader не читает setup целиком в RAM; использует buffer 128 KiB и size cap.
Update packages/runners имеют cleanup; бесконечное накопление успешных releases не подтверждено.
Повторный update install в coordinator не имеет отдельного latch, но UI сразу отключает кнопку и завершает процесс.
Дубль installer не включен в findings: реального reachable воспроизведения поверх UI не получено.
CheckNow имеет Interlocked guard; отсутствие общего глобального lock не означает гонку проверок.
Выход из tray и window close различаются намеренно; скрытое живое окно само по себе не leak.

## Покрытие чтением и приемка перед изменениями

Entrypoints: `App.xaml.cs`, `MainWindow.xaml.cs`, `desktop/README.md`, `Hub.Desktop.csproj`.
Navigation: `Security/NavigationPolicy.cs`, route checks `Interop/DesktopBridgeProtocol.cs`.
Bridge: `Interop/DesktopBridgeHost.cs`, `Transfers/DesktopSharedFileRegistry.cs`, соответствующие registry tests.
Lifecycle: `Lifecycle/DesktopWindowManager.cs`, closed/dispose/recovery участки MainWindow.
Downloads: все пять локальных Downloads `.cs`, caller operation events и coordinator tests.
Memory: `Diagnostics/DesktopMemoryMetrics.cs`, guards sampler/background policy в MainWindow.
Updates: `Updates/DesktopUpdateService.cs`, `DesktopUpdateCoordinator.cs`, `UpdateCore/DesktopUpdateManifestVerifier.cs`.
Runner: `Hub.Desktop.UpdateRunner/UpdateRunnerWorkflow.cs`; signing/runtime факт не проверен.
Сначала завершить source tracking DDESK-01; затем исправить subscriptions DDESK-03 и paused trim DDESK-02.
Acceptance fixes: isolated Release tests для lifetime/state machine и WPF user scenario для двух окон.
Для DDESK-04 сначала зафиксировать требование отзыва capability на portal logout.
Деплой, installer и restart для самого отчета не нужны; публикация исправлений согласуется отдельно.
