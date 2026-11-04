# 14. MOBILE-HUB: Expo / React Native

Дата перепроверки: 2026-11-03, Asia/Yekaterinburg.
Область: текущие исходники `mobile-hub/`, включая существующие незакоммиченные изменения.
Режим: read-only аудит; создан только этот отчет, исправления продукта не выполнялись.
Production, сеть, APK, установка, обновление и физическое устройство не использовались.
Обозначения: **R** — воспроизведение текущей функции в изолированном окружении; **S** — подтвержденная структура кода; **H** — гипотеза с недостающей приемкой.
Severity описывает эффект при указанном триггере, а не частоту инцидентов в production.

## Вывод

- Воспроизведены три дефекта: сохранение токенов после «успешной» очистки, конфликт `.part`, создание аудиоплеера после unmount.
- Для обычных chat attachments отсутствует fencing очистки кеша по generation, имеющийся у chat media.
- Старые CL-02/03/04 уже изменены извне; они не включены в список открытых дефектов без учета нового кода.
- Существующий профиль Jest: **5 suites / 35 tests passed**, exit 0.
- Два предупреждения overlapping `act()` ограничивают качество мониторингового harness; результат не является Android acceptance.
- Offline snapshots имеют шифрование, AAD пользователя, транзакционную замену и лимиты; признаков «весь кеш неограничен» нет.

## Архитектура и границы

01. `mobile-hub/package.json:3` задает source version 1.1.80; это не доказательство установленной версии.
02. `mobile-hub/package.json:7` использует Expo Router; маршруты находятся в `app/`.
03. `mobile-hub/app/(shell)/_layout.tsx:24` организует разделы через Tabs.
04. `mobile-hub/app/(shell)/_layout.tsx:29` включает `freezeOnBlur`; freeze не заменяет отмену I/O.
05. Native API клиент — `mobile-hub/src/api/client.ts:23`, axios с исходным timeout 30 секунд.
06. Mail timeout расширяется до 120 секунд в `mobile-hub/src/api/client.ts:123`.
07. `mobile-hub/src/api/client.ts:98` проверяет generation сессии перед отправкой запросов.
08. Повтор refresh ограничен общей promise для refresh token; проверен код `client.ts`.
09. Реактивный refresh не должен стирать новую сессию: compare-and-commit находится в `tokenStore.ts:291`.
10. Запись пары токенов сериализована через `sessionOperation`, `tokenStore.ts:42`.
11. Это логическая сериализация; физическая запись двух ключей SecureStore не атомарна.
12. Logout проходит через `AuthContext.tsx:741` → `logout.ts:31` → `tokenStore.clearTokens`.
13. Logout отключает chat socket и фоновые задания до локальной очистки.
14. Истечение сессии сохраняет offline данные по явной логике `tokenStore.ts:162`.
15. Деактивация отличается от обычного expiry: durable mark записывается в `tokenStore.ts:313`.
16. Offline snapshots разделены по owner и scope, `nativeSnapshotCache.ts:133`.
17. Коллекции используют manifests и shards; проверяется полная сериализованная копия после записи.
18. Лимит collection contexts — 8, entities — 1000, `nativeSnapshotCache.ts:111`, `:119`.
19. Snapshot AES хранится в app-private documents; ключ — SecureStore, `nativeSnapshotStorage.ts:8`, `:9`.
20. AAD содержит userId и scope, `nativeSnapshotStorage.ts:55`.
21. Размер обычного snapshot ограничен 2 MiB, address book — 8 MiB, `nativeSnapshotStorage.ts:10`.
22. Plaintext cache ограничен 10 млн символов, `nativeSnapshotStorage.ts:123`.
23. Cache signature включает размер и lastModified; это механизм свежести кеша, не криптографическая проверка файла.
24. Обычные вложения и trusted media разделяют downloader, но имеют разные guards жизненного цикла.
25. Media download concurrency ограничена тремя активными работами, `nativeAttachmentDownloads.ts:21`.
26. `queuedChatMediaDownloads` является отдельной очередью ожидающих callback, `:23`.
27. Для очереди есть удаление abort-заданий; глобальный предел pending не найден.
28. UI виртуализация ограничивает типичный поток; переполнение этой очереди не воспроизведено.
29. Cache attachments — app-private documents с user prefix, `nativeAttachmentDownloads.ts:17`, `:47`.
30. Cache budget — 512 MiB, `filePolicy.ts:5`; единственный сохраняемый файл может влиять на soft limit.
31. Файлы загружаются через `.part` и последующий move, `authenticatedFileDownload.ts:33`, `:62`.
32. Resumable uploads сохраняют sessionId в durable outbox, `nativeChatUploadSession.ts:83`.
33. Chunk retries ограничены и предварительно сверяют состояние сервера; multipart сохраняет client_message_id.
34. Offline command queue допускает только mark-read, максимум 25 записей/7 дней, `offlineCommandQueue.ts:6`.
35. Pending notification replies ограничены 10 записями/24 часами, `pendingNotificationReplies.ts:6`.
36. Background sync выполняет отдельные drains, `mobileBackgroundSync.ts:18`, `:30`, `:35`.
37. Chat background drain имеет budget 120 секунд и ownsSession, `nativeChatBackgroundDrain.ts:21`, `:55`.
38. Push/WorkManager после Force stop зависят от Android; статический аудит не подтверждает killed delivery.
39. APK build проверяет signer и identity; скрипт только прочитан, не выполнялся.
40. `build-apk.ps1:309` требует release signing, debug допускается явным флагом.
41. `build-apk.ps1:409` проверяет APK signer; `:438` записывает SHA-256 в audit artifact.
42. Наличие исходников подписи не доказывает подпись опубликованного APK.

## Реестр находок

| ID | Severity | Доказательство | Статус | Эффект |
|---|---|---|---|---|
| DMOB-01 | High | R | OPEN | Отказ удаления SecureStore скрыт; токены доступны после cold start. |
| DMOB-02 | Medium | R | OPEN | Конкурентные скачивания одного destination удаляют staging друг друга. |
| DMOB-03 | Medium | R | OPEN | Voice player создается и начинает играть после unmount. |
| DMOB-04 | Medium | S | OPEN | Обычная загрузка attachment может восстановить файл после logout cleanup. |
| DMOB-05 | Medium | H | NEEDS REPRO | Нет hard limit pending media queue; устойчивый рост не доказан. |

### DMOB-01 — скрытый отказ удаления credentials

Код: `mobile-hub/src/auth/tokenStore.ts:153`, `:169`, `:170`.
Caller: `mobile-hub/src/auth/logout.ts:83` → `tokenStore.clearTokens`; верхняя граница — `AuthContext.tsx:741`.
`clearTokensInternal` запускает удаление ключей и игнорирует все rejected результаты `Promise.allSettled`.
После этого in-memory access cache сбрасывается в null и caller получает fulfilled Promise.
Триггер: SecureStore временно отвергает удаление credentials; сервер недоступен при logout.
R: текущий TS модуль транспилирован в памяти; SecureStore заменен Map с отказом delete.
Результат: `clearReportedSuccess=true`, `durableAccessRetained=true`, `coldStartHasSession=true`.
Токены в harness синтетические; реальные значения не читались и не выводились.
Это не доказательство, что production SecureStore уже отказывал.
Исправление: разделить best-effort cleanup кеша и обязательный результат credential deletion.
При ошибке удаления сохранить durable invalidation marker и запрещать bootstrap старых credentials.
Acceptance: отказ каждого delete ключа, рестарт JS, offline logout, повтор очистки, новый login после восстановления.
Дополнительная проверка: отказ записи второго ключа пары не должен оставлять пригодный частичный login.

### DMOB-02 — общий `.part` у независимых операций

Код: `mobile-hub/src/files/authenticatedFileDownload.ts:33`, `:34`, `:56`, `:62`, `:65`.
Caller A: `mobile-hub/src/screens/chat/useThreadAttachments.ts:96`.
Caller B: `mobile-hub/src/components/chat/ChatVoiceNote.tsx:94`.
Обычный `downloadChatAttachment` не использует media single-flight Map.
Оба вызова вычисляют один destination и один staging path; catch каждого удаляет общий staging.
R: реальный downloader выполнен в VM с File/headers adapters без сети и без записи на диск.
Сценарий: B уже записал staging; отмена A удаляет его; B завершает native download и проверяет наличие.
Результат: `requests=2`, `sharedPendingPath=true`, `secondSuccessful=false`, `finalExists=false`.
Исправление: single-flight по destination либо уникальный staging на владельца операции.
Отмена одного подписчика не должна удалять staging другого; shared cancellation требует явной семантики.
Acceptance: open+voice того же файла, повторный tap, отмена первого и второго callers, успешный финальный файл.
Проверять actual bytes/hash, а не только наличие destination.

### DMOB-03 — voice playback после ухода со строки

Код: `mobile-hub/src/components/chat/ChatVoiceNote.tsx:50`, `:84`, `:94`, `:99`, `:111`.
Caller: `mobile-hub/src/components/chat/ChatBubble.tsx:651`.
Cleanup удаляет только уже созданный player; pending download и последующий continuation не отменяются.
Триггер: нажать воспроизведение, уйти из чата/размонтировать строку до окончания скачивания.
R: извлечены реальные togglePlayback и effect cleanup через TypeScript AST.
Cleanup вызван во время pending download; затем download разрешен.
Результат: `createdAfterUnmount=1`, `playedAfterUnmount=1`, `removedPlayers=0`.
Изолированная модель доказывает порядок continuation; реальный аудиодрайвер Android не запускался.
Исправление: generation/mounted guard после каждого await, AbortController и уничтожение позднего player.
Проверять ownership также после `setAudioModeAsync` и `seekTo`.
Acceptance: unmount на каждом await, смена attachment, переключение чатов, background, повторный tap до rerender.
Требование: после cleanup ни native audio, ни listener не должны создаваться.

### DMOB-04 — обычный attachment не огражден от очистки

Код: `mobile-hub/src/files/nativeAttachmentDownloads.ts:149`, `:170`, `:193`.
Сравнение: trusted media сохраняют cache/session generation и вызывают assertCurrent, `:228–233`.
Caller: `ChatVoiceNote.tsx:94` передает загрузку без signal; `logout.ts:71` очищает attachment cache.
В обычном пути нет проверки generation перед возвратом и перед последним move downloader.
S: cleanup удаляет текущие файлы, но не запрещает незавершенному downloader снова создать destination.
Последствие: возможен plaintext файл старой сессии после завершенной очистки; смена пользователя не доказана как утечка через UI.
Исправление: распространить session/cache fencing на обычные attachments, отменять все операции при clear.
Acceptance: logout в середине download, поздний HTTP success, повторный login; каталог старого owner остается пуст.
Связь с DMOB-03: stale continuation может одновременно восстановить файл и запустить старое голосовое сообщение.

### DMOB-05 — pending media queue: проверка границы

Код: `mobile-hub/src/files/nativeAttachmentDownloads.ts:23`, `:144`.
Есть ограничение active=3 и single-flight по URI, но нет hard limit уникальных pending URI.
H: нужна серия уникальных запросов без AbortSignal при медленном транспорте; типичный UI может отменять их вовремя.
Не считать текущую длину очереди, OOM или утечку production установленными фактами.
Acceptance: burst уникальных URI, scroll-away, background/logout; pending возвращается к нулю и память стабилизируется.
Если устойчивый рост подтвердится: bounded admission и приоритет видимых строк, без потери durable uploads.

## Перепроверка прежних CL

CL-02: `NativeMonitoringScreen.tsx:54` пропускает poll при in-flight; исходная starvation структура устранена.
Jest сценарий slow overview включен и прошел в текущем запуске.
CL-03: `NativeMonitoringDetail.tsx:40`, `:153–158` связывают history с target/interface/hours.
Предыдущее смешение данных интерфейсов не считается текущим OPEN; негативный UI сценарий еще нужен.
CL-04: `useMonitoringActive.ts:6` объединяет focus и AppState; оба monitoring компонента используют hook.
Полный blur/background тест таймеров на устройстве не выполнялся; статус — код проверен, приемка частичная.
Незакоммиченный `useMonitoringActive.ts` обнаружен снаружи; этим аудитом он не создавался.
Изменения CL не означают публикацию APK и не описывают установленную версию пользователя.

## Выполненные проверки

Jest: `node node_modules/jest/bin/jest.js --runInBand --coverage=false --no-cache --runTestsByPath ...`.
Пути: authenticatedFileDownload, nativeAttachmentDownloads, tokenStore, nativeSnapshotStorage.integration, NativeMonitoringScreen.
Фактический итог: **5 suites passed; 35 tests passed; 0 snapshots; exit 0; 23.405 s**.
В выводе два предупреждения overlapping `act()`; failures нет, предупреждения не скрыты.
VM harness DMOB-01: текущий целый tokenStore модуль, синтетический SecureStore.
VM harness DMOB-02: текущий целый authenticated downloader, File adapter в памяти.
AST harness DMOB-03: реальные callback и cleanup компонента, без React Native runtime.
Новые тестовые файлы не создавались; сохраняется только описание воспроизведения.
Нагрузка, p95/p99, батарея, JS/native heap и устройство не измерялись.
Успех существующих тестов не опровергает негативные сценарии, отсутствующие в их assertions.

## Проверенное, что не является дефектом

Expiry сохраняет offline данные намеренно; это не равно неудачной очистке explicit logout.
Snapshot encryption и owner AAD существуют; не заявляется открытое хранение всего offline каталога.
Plaintext in-memory cache ограничен; наличие Map само по себе не доказывает leak.
Collections/shards имеют границы entries и проверки commit; не объявлены неограниченным JSON blob.
Native image cache key содержит userId и URI, `nativeImageCache.ts:5`.
Trusted media защищены generation и заменяют оригинал через staging; DMOB-04 относится к обычным attachments.
Offline mark-read допускается отдельно от бизнес-мутаций; read-only policy не объявляется отключенной.
Client message id сохраняется при resumable fallback; duplicate upload не заявлен без boundary repro.

## Покрытие чтением и оставшаяся приемка

Auth: `AuthContext.tsx`, `tokenStore.ts`, `logout.ts`, `authenticatedRequestHeaders.ts`, API `client.ts`.
Storage: `nativeSnapshotCache.ts`, `nativeSnapshotStorage.ts`, `nativeEquipmentCatalogSnapshot.ts`, `nativeImageCache.ts`.
Files: `authenticatedFileDownload.ts`, `nativeAttachmentDownloads.ts`, `filePolicy.ts`, `useThreadAttachments.ts`.
Chat/media: `ChatVoiceNote.tsx`, caller `ChatBubble.tsx`, `nativeChatUploadSession.ts`, `nativeChatStorageQueue.ts`.
Lifecycle: `useMonitoringActive.ts`, обе monitoring screens, shell layout, `mobileBackgroundSync.ts`.
Offline/push: `offlineCommandQueue.ts`, `pendingNotificationReplies.ts`, `nativePush.ts`, `nativeChatBackgroundDrain.ts`.
Release: `package.json`, `README.md`, signing/identity участки `scripts/build-apk.ps1`.
Прочитаны существующие tests для downloader/tokenStore/snapshot/monitoring и desktop-несвязанные тесты не запускались.
Не выполнены APK build, install/update, expo-doctor с сетью, backend calls и физическая push/offline приемка.
Не проверены системная permission revocation, biometric keystore reset, Doze, killed app, cross-process SecureStore гонки.
Рекомендуемый порядок исправления: DMOB-01, затем общий downloader DMOB-02/04, затем voice lifecycle DMOB-03.
Для каждого изменения необходим отдельный boundary сценарий с реальными user actions/native adapters.
Аудит не требует deployment; исправления JS/native и публикация APK согласуются отдельно.
