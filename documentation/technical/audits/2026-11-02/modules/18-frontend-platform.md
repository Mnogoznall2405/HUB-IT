# 18. Общая frontend-платформа: HTTP, кеш, маршруты, offline и Service Worker

> **Актуализация 2026-11-03:** DFE-01/FE-01 изменён извне. Свежие Node harness и 6 SWR-тестов подтвердили новое поведение `cached=NEW`; см. [модуль 11](11-networks-monitoring.md) и [повторную сверку](../INITIAL_FINDINGS_RECHECK_2026-11-03.md). Ниже остаётся исторический разбор причин и приёмки; дефект старой invalidation не числится неизменённым OPEN.

Дата: 2026-11-02. Read-only code audit; никакой сборки live dist/деплоя.
Главный вывод: общий SWR имеет воспроизведённую гонку invalidation; нативный offline bridge содержит условную ошибку атрибуции ответа текущему пользователю, но активный production-caller этого legacy bridge в Expo исходниках не установлен. Последнее нельзя выдавать за подтверждённую межпользовательскую утечку действующего APK.

## Границы

Это общие механизмы браузерного frontend, а не бизнес-логика отдельных страниц. Auth policies и backend остаются в отчёте 01; очереди фото — в 02; Chat socket — в 06; native Expo cache — в 14.

| Слой | Точка входа | Назначение |
|---|---|---|
| Router/lazy | `WEB-itinvent/frontend/src/App.jsx:75`; `WEB-itinvent/frontend/src/lib/routeLoaders.js:25` | Страницы загружаются по маршруту; retry chunk load |
| HTTP | `WEB-itinvent/frontend/src/api/client.js:236`, `:276`, `:319` | axios, DB header, cookie auth, refresh, offline fallback |
| Auth lifecycle | `WEB-itinvent/frontend/src/contexts/AuthContext.jsx:182`, `:187`, `:417` | generation guards, logout, cross-tab sync |
| Account storage | `WEB-itinvent/frontend/src/lib/browserAccountSession.js:5`, `:40` | Владелец browser state и очистка при смене |
| SWR | `WEB-itinvent/frontend/src/lib/swrCache.js:1`, `:63`, `:107` | Кеш data и in-flight dedupe |
| Offline bridge | `WEB-itinvent/frontend/src/lib/mobileOfflineCache.js:30`, `:277`, `:337` | Шифрованные GET записи только при native marker |
| Private media | `WEB-itinvent/frontend/src/lib/privateMediaSession.js:16`, `:53` | Account synchronization с worker/ACK |
| SW | `WEB-itinvent/frontend/public/sw.js:1`, `:603`, `:1228` | App shell/assets, private media, push |
| Build | `WEB-itinvent/frontend/vite.config.js:1`; `WEB-itinvent/frontend/scripts/stamped-service-worker-plugin.mjs:5` | Chunking, SW stamp в фактический outDir |

Путь HTTP: page/domain API → axios request interceptor → backend → response interceptor → optional offline write → domain state. Ключ кеша и авторизация должны относиться к тому же запросу и пользователю, а не вычисляться из изменившихся globals после await.

## Инварианты

1. После мутации старое чтение не становится свежим состоянием/кешем.
2. Успех, error и finally проверяют один request/session generation.
3. Смена аккаунта очищает account-specific state, не восстанавливаемый старым ответом.
4. Автоматический refresh не запускает несколько параллельных вращений токена из одного контекста.
5. Ошибка отдельного Scan/Voice runtime не завершает подтверждённую backend-сессию.
6. Offline preparation не обещает durable запись до commit IndexedDB.
7. Route recovery ограничен; повторная ошибка не создаёт бесконечный reload-loop.
8. Trial build пишет вне live dist, SW stamp следует именно этому outDir.

## DFE-01 — prefix invalidation не отменяет поколение in-flight

- **High, R первого прохода и повторная S-проверка текущего кода**, соответствует FE-01, не новая независимая находка.
- `WEB-itinvent/frontend/src/lib/swrCache.js:63` удаляет только cacheStore; `:107` reuse inFlightStore; `:112` generation меняется лишь clearSWRCache; `:158` force всё равно использует deduped fetch.
- Caller: `WEB-itinvent/frontend/src/api/database.js:57` switchDatabase invalidates metadata; `WEB-itinvent/frontend/src/pages/Networks.jsx:879` invalidates перед refresh после мутации.
- Interleaving: старый GET начат → мутация committed → invalidate prefix → force GET присоединяется к старому → старый payload записан как fresh.
- Воспроизведение первого прохода: oldResult=OLD, afterMutation=OLD, newFetcherCalls=0, cached=OLD. Код здесь всё ещё имеет тот же control flow.
- Исправление: per-key generation, detach старого in-flight, publish только если поколение и identity promise актуальны. Не отключать dedupe вообще.
- Приёмка: slow old GET+mutation+fresh GET; reject старого GET; несколько invalidation одного ключа; другой prefix сохраняет свой полезный in-flight; clear on logout.

## DFE-02 — условная атрибуция старого ответа новому пользователю offline bridge

- **Medium, R на функции; достижимость в живом клиенте H**, не утверждение об инциденте.
- `WEB-itinvent/frontend/src/api/client.js:331` вызывает cacheMobileGetResponse после ответа. `WEB-itinvent/frontend/src/lib/mobileOfflineCache.js:277` получает текущую native session; `:300` строит запись с текущим userId; request не содержит capture исходной session generation.
- Сценарий требует одного JS context, смены native session A→B при живом запросе A и отсутствия внешнего cancel/reload. Native marker обязателен; обычный browser/PWA сюда не входит.
- Изолированный Node harness импортировал реальный mobileOfflineCache.js. WebCrypto реальный; только browser APIs/IndexedDB transport заменены в памяти. Ответ с owner=account-A при текущей session userId=2/keyB сохранился и расшифровался для B: saved=true, storedUserId=2, returnedToB=account-A, exit=0.
- Первый запуск harness завершился TypeError из-за отсутствующего window.addEventListener в stub; после добавления browser event stub финальный прогон успешен. Это дефект harness, не приложения.
- В `mobile-hub/` и Desktop runtime не найден установщик `__HUBIT_MOBILE_OFFLINE_SESSION__`. Поэтому отдельный текущий native caller не доказан; возможно, механизм остался совместимостью со старым WebView-клиентом.
- Исправление при сохранении механизма: capture owner/session generation в request interceptor; reject cache writes/responses после смены. Если механизм retired — документировать границу и не считать его native Expo cache.
- Приёмка: A request→logout/login B→late A response; ни выдачи B, ни записи под B; clear во время encryption/IDB transaction; обычный PWA без marker не меняется.

## DFE-03 — offline cache сообщает успех операции до завершения IndexedDB transaction

- **Medium, S**, зависит от используемого native bridge, см. достижимость DFE-02.
- `WEB-itinvent/frontend/src/lib/mobileOfflineCache.js:215` transactionRequest завершает Promise по request.onsuccess, а не transaction.oncomplete; у transaction нет общего onabort rejection.
- IDB request success ещё не равен commit transaction: поздний abort/quota/IO failure может отменить put после объявления успеха и публикации metadata в `:306`.
- `WEB-itinvent/frontend/src/lib/mobileOfflinePrefetch.js:80` ждёт pending writes, затем оценивает свежесть inventory; часть ложного успеха может быть замечена последующим inventory, но базовый контракт transactionRequest всё равно слабее durable commit.
- Не воспроизводился реальный браузерный disk/quota abort. Нельзя утверждать, что любое quota событие уже прошло через success.
- Исправление: result сохранять на request success, resolve после tx.oncomplete; reject по abort/error; caller явно различает failed persistence и успешный HTTP.
- Приёмка: put success→tx abort; close-tab после prepared; quota exhaustion; transaction rollback не обновляет lastSync.

## DFE-04 — тест chunk recovery зависит от тяжёлого динамического импорта

- **Low, R тестовой нестабильности**, не runtime bug.
- `WEB-itinvent/frontend/src/lib/routeChunkRecovery.test.js:75` смешивает простую проверку классификации ошибки с загрузкой всего TasksDataModeRouter/analytics.
- Прогон трёх файлов: 15 passed, 1 timeout failed на 15 с, exit=1. Exact repeat только этого теста с лимитом 45 с: 1 passed, 4 отфильтрованы, 4,19 с, exit=0.
- Причина исходного замедления не профилировалась; одновременно выполнялись другие аудиторские проверки. Не утверждается зависание production analytics или flaky race из одного измерения.
- Рекомендация: отдельно проверять контракт recovery и реальную lazy-загрузку на корректной boundary; тяжёлый integration gate должен иметь обоснованный timeout и диагностировать import duration.
- Не добавлять зеркальные export-existence/unit-тесты ради замены; пользовательский lazy-путь лучше подтвердить локальным E2E при реализации соответствующей правки.

## Разобранные сценарии

| Сценарий | Текущая защита | Вывод |
|---|---|---|
| Одновременные 401 в одной вкладке | client.js:112 refreshInFlight | Dedupe есть; межвкладочное refresh policy относится к auth backend |
| Transient error refresh | client.js:389 проверяет definitive 401/403 | Сетевая ошибка сама не вызывает logout |
| Повторный 401 Scan/Voice после refresh | client.js:400 отдельное исключение | Основная сессия сохраняется |
| Поздний /me после logout | AuthContext.jsx:182, :241 generation | Защита есть; blanket stale-session finding отвергнут |
| Смена user в другой вкладке | AuthContext.jsx:417 storage handler | Clear SWR и смена generation предусмотрены |
| Cold metadata cache + switch database | database.js:57; SWR prefix | Уязвим к DFE-01 |
| Native offline bridge owner switch | Текущая session при ответе | Условный DFE-02 |
| Trial build в другой outDir | stamped-service-worker-plugin.mjs:10 | Stamp следует resolved build.outDir; live dist не трогался |
| Successful route import | routeLoaders.js:28 clear recovery state | Намеренная очистка; reload-loop на реальной навигации не доказан |
| Unbounded routePrefetchPromises | routeLoaders.js:167 normalize against fixed loaders map | Число supported keys ограничено map; не признано утечкой |

## Ресурсы и производительность

- SWR: 80 готовых entries, retention 30 мин (`swrCache.js:6`); in-flight ограничен числом различных текущих keys, общего admission нет. Реальный cardinality/timeout профиль не измерен.
- Offline bridge: 250 entries, TTL 7 суток, plaintext лимит 2 MiB (`mobileOfflineCache.js:4`). Это limit одного payload, не гарантированный RSS budget; шифрование/base64 создаёт дополнительные copies.
- `WEB-itinvent/frontend/public/sw.js:603` cache-first return запускает фоновый fetch. Для hashed assets это допустимый stale-while-revalidate tradeoff, но network/RSS на массовом prefetch нужно измерять.
- Chat media cache имеет limit и session generation (`WEB-itinvent/frontend/public/sw.js:622`, `:1234`); app asset cache очищается поколениями релиза, не отдельным числом entries. Накопление на конкретном релизе не измерено и не вынесено как доказанный OOM.
- `privateMediaSession.js:53` сериализует синхронизацию, ACK timeout 2 с; при нескольких сменах аккаунта возможна очередь ожидания. Реальное пользовательское замедление не подтверждено.
- Baseline: число/байты HTTP на первый route и возврат; warm/cold import; p95 user navigation; кеш hits/misses; outstanding requests; RSS при больших payload. Не объявлять ускорение по размеру исходного файла.

## Тесты и пробелы

Команда: `node node_modules/vitest/vitest.mjs run src/lib/swrCache.test.js src/lib/routeChunkRecovery.test.js src/lib/mobileOfflineCache.test.js --reporter=dot`.
Результат: 2 файла passed, 1 failed; 15 passed, 1 failed; 17,08 с, exit=1.
Точная повторная команда: `... run src/lib/routeChunkRecovery.test.js -t "detects analytics lazy chunk" --testTimeout=45000 --reporter=dot`.
Результат повторной проверки: 1 passed, 4 отфильтрованы, 4,19 с, exit=0. Общий профиль задним числом не объявляется полностью пройденным.

Не выполнены: браузерная смена аккаунтов с задержанными ответами, настоящий IDB abort/quota, release SW update и offline cold-start, приватный media revoke в двух вкладках, local E2E DB switch, production build. Код тестов и приложений не менялся.

## План

1. DFE-01 — per-key generation, приёмка через реальную mutation/read boundary и overlap scenarios.
2. Установить актуальность legacy bridge; если используется, DFE-02/03 закрывать до обещания account-safe offline cache.
3. Включить узкий local browser gate для logout/login/cross-tab/DB switch/SW update без production.
4. Измерять prefetch и cache на одинаковых данных до любых оптимизаций.

Прочитаны: App.jsx (routing sections), client.js, api/database.js, AuthContext (session generation/storage/logout sections), swrCache.js, mobileOfflineCache.js, mobileOfflinePrefetch.js, browserAccountSession.js, privateMediaSession.js, routeLoaders.js, routeChunkRecovery.js; public/sw.js (cache/synchronization handlers), vite.config.js, stamped-service-worker-plugin.mjs; три выполненных test-файла.
Не заявляется полная проверка каждой страницы и каждой ветки Service Worker; доменные UI проверяются в отдельных модульных отчётах.
