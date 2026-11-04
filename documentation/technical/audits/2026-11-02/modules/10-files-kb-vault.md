# 10. Мой диск, публичные ссылки, предпросмотр, база знаний и пароли

Углублённый проход продолжен **3 ноября 2026**; каталог сохраняет дату начала общего аудита.
Режим: чтение исходников, два изолированных harness; изменён только этот Markdown.
Production, `.env`, реальные пользовательские файлы, внешние сервисы и сеть не использовались.
Обнаружено **9 находок: 6 High, 3 Medium**. Обозначения: R — механизм воспроизведён; S — подтверждён цепочкой исходников; H — открытая гипотеза.
R не означает воспроизведение полного HTTP/UI-пути или текущего production-инцидента.
Рабочее дерево изменяется другими процессами: ранние номера методов MyFiles сместились; ключевые цитаты повторно сверены в этом проходе.

## 1. Границы, входы и хранение

| Подмодуль | UI → API → обработка | Источник истины и границы |
|---|---|---|
| Мой диск | `pages/MyFiles.jsx` / `pages/myFiles/useMyFilesUpload.js` → `api/myFiles.js` → `api/v1/my_files.py` → `MyFilesService` | APP DB: файл, blob, preview, grant, audit; filesystem/UNC: spool, ranges journal, blobs, previews. |
| Public file/folder | `SharedFile.jsx`, `SharedFolder.jsx` → public metadata/preview/grant endpoints → token lookup/security checks | Share token хранится hash/encrypted; download capability — отдельная short-lived DB запись. |
| Предпросмотр | `useMyFilesPreviewController.js` → preview meta/content/source → preview job → PDF/thumb artifacts | Preview привязан к blob; генерация/доставка не равны сохранению исходных bytes. |
| KB articles/cards | `KnowledgeBase.jsx` → `api/v1/kb.py` → `KnowledgeBaseService` → `JSONDataManager` | В production JSON datasets лежат в APP DB через compatibility store; attachments отдельно в `data/kb_attachments`. |
| Password vault | `Passwords.jsx` / `ObjectPasswordsPanel.jsx` → `usePasswordVaultAccess` → `api/v1/passwords.py` → `PasswordVaultService` | APP DB encrypted entries, groups, object links, audit; unlock/rate-limit — auth runtime store. |

### Критические MyFiles переходы

1. `reserve_upload` проверяет пользователя, имя, quota/capacity и создаёт UPLOADING reservation со spool path.
2. Chunk endpoint ограничивает размер запроса, проверяет owner/reservation, записывает диапазон и журнал подтверждённых ranges.
3. `complete_upload` сверяет reservation size, физический размер и покрытие ranges, переводит в QUEUED.
4. Worker claim переводит в SCANNING; затем AV, PROCESSING, SHA-256, optimization/compression, publication blob и READY.
5. Blob dedup выполняется по owner + original SHA-256; ready files ссылаются на общий blob и ref_count.
6. Preview работает отдельной очередью по blob; public/private выдача повторно проверяет доступность/security scan.
7. Delete, trash, purge и cleanup разделены; физические удаления после DB commit предусмотрены в части путей.

### Ключевые инварианты

- Подтверждённый chunk range нельзя позже заменить другими bytes через конкурентный запрос.
- Один логический blob не должен исчезать из-за проигравшего dedup или удаления другой ссылки.
- `ref_count` должен соответствовать действующим ссылкам; его уменьшение не должно удалять ещё используемый blob.
- Старый worker после reclaim не вправе фиксировать результат/ошибку или удалять payload новой попытки.
- HTTP success KB не должен означать несохранённый документ при False от store.
- Изменение одной статьи не должно стирать параллельное изменение другой статьи в общем dataset.
- Скрытие vault secrets должно обесценивать уже отправленные reveal, а не только текущий state.
- Unlock и audit должны иметь определённый outcome при отказе одного из хранилищ.
- Share/grant access не равен владению файлом; отзыв имеет отдельную явно определённую семантику.

## 2. Мой диск — chunk, blob и worker

### DFILE-01 — параллельный chunk переписывает уже подтверждённые bytes

- **High / R.** `WEB-itinvent/backend/services/my_files_service.py:917-993`, caller `WEB-itinvent/backend/api/v1/my_files.py:795`.
- Проверка journal происходит под lock (`:935-960`), но filesystem write вынесен наружу (`:962-976`).
- В ranges не резервируется in-flight диапазон: два запроса одного offset успевают увидеть пустой journal.
- A пишет AAAA, фиксирует journal и возвращает complete=True; B затем пишет BBBB поверх того же range.
- При повторной проверке B читает уже собственные BBBB, сравнение проходит и второй запрос тоже возвращает complete=True.
- **Воспроизведено** реальной AST-функцией append и реальными helpers range journal на temporary filesystem.
- Два потока, barrier перед os.open; write B отложен до полного завершения A. БД-транзакции/row lookup заменены локальным row adapter, внешних DB не было.
- Результат: `CHUNK_REPRO True True BBBB`, exit=0. Ошибка возникает в реальной последовательности file writes, не в возвращаемом значении mock.
- Вторая проверка после записи не может восстановить уже испорченные подтверждённые bytes.
- План: резервировать диапазон/владельца до write, либо держать serialization на overlapping ranges; disjoint writes могут остаться параллельными.
- Acceptance: параллельные одинаковые retries дают один и тот же hash; conflicting payload одного range даёт отказ без изменения ранее ACKed bytes.
- Дополнительно проверить partial overlap, complete во время write и разные backend instances; одного process-local RLock недостаточно.

### DFILE-02 — проигравший concurrent dedup удаляет общий канонический blob

- **High / S.** `WEB-itinvent/backend/services/my_files_service.py:1905-1910`, `:2070-2099`, `:2894-2961`; layout `WEB-itinvent/backend/services/my_files_storage_layout.py:70-76`.
- `_blob_relative_path` детерминирован по owner/hash/extension. Два обработки одинакового содержимого публикуют один и тот же canonical target.
- После publication в финальной transaction `_find_owner_blob` может обнаружить blob, который успел зарегистрировать другой worker.
- Тогда ветки `:2956` и `:2961` удаляют `final_path`, предполагая, что это частный проигравший артефакт.
- Но `final_path` совпадает с `existing_blob.storage_path`; winner и обе ready карточки остаются без физических bytes.
- Ранняя dedup-проверка на `:2862` не закрывает окно: оба worker могут проверить отсутствие до первого publication/commit.
- Сценарий прослежен по коду; полноценный concurrent worker/SQL harness не запускался.
- План: различать private candidate и published shared path, сравнивать ownership/path перед cleanup; не удалять canonical target существующего blob.
- Acceptance: два разных file IDs одного owner с одинаковыми bytes обрабатываются одновременно, обе загрузки скачиваются, hash совпадает, физический blob один.
- Проверка должна включать путь unique-conflict, обычный existing_blob branch и rollback после publication.

### DFILE-03 — ref_count обновляется read-modify-write без защиты общей blob-строки

- **High / S.** `WEB-itinvent/backend/services/my_files_service.py:1922-1927`, `:2873`, `:2953-2959`, `:3009-3032`.
- Поиск blob и `_release_blob_locked` получают строку без FOR UPDATE; ref_count меняется через Python `old ± 1`.
- Два разных file IDs разделяют один blob, поэтому защита самого file row или upload lock не сериализует эту строку.
- Concurrent increments могут потерять +1; последующие purge способны дойти до нуля при оставшейся живой ссылке и удалить shared bytes.
- Concurrent decrements могут потерять -1 и оставить orphan blob; последствия зависят от interleaving.
- Это доказанный механизм updates в коде; фактические расхождения production ref_count не проверялись.
- План: row lock общего blob или атомарные SQL increments/decrements с корректным условием удаления; проверить ссылочную целостность до destructive cleanup.
- Acceptance: N одновременных attaches и detaches дают точное число ссылок; скачивание последнего живого файла работает до его явного удаления.
- При миграции/repair накопленных счётчиков нужен отдельный dry-run; аудит не разрешает исправлять реальные данные.

### DFILE-04 — stale worker не ограждён token при recovery/finalize

- **High / S.** `WEB-itinvent/backend/services/my_files_service.py:2367-2404`, `:2453-2478`, `:2810-2851`, `:2909-2986`.
- Recovery возвращает старые SCANNING/PROCESSING в QUEUED по updated_at. Claim задаёт status/time, но не уникальное поколение владения.
- Следующие стадии process_file и final/error writes находят row по ID без сравнения claim token.
- Heartbeat `:2845-2850` проверяет только status=PROCESSING; старый worker может продлить уже новую попытку.
- После recovery/reclaim старый процесс способен выставить READY/FAILED, очистить spool_path и удалить payload, нужный новому worker.
- Финальный spool delete в раннем dedup пути (`:2891`) также выполняется до выхода из DB transaction: rollback не восстанавливает файл.
- Не заявлено, что каждое нормальное задание дублируется; требуется истечение lease/долгая стадия/сбой процесса.
- План: generation/token попытки во всех heartbeat/status/final/error/cleanup; publication и checkpoint должны быть recovery-safe.
- Acceptance: замороженный A, recovery, новый B, затем поздний success/error A; B/result/bytes не меняются, старый A не удаляет spool.

## 3. Публичные ссылки и предпросмотр

### Что проверено по коду

- Public folder grant проверяет действующий share, принадлежность file subtree, READY, expiry и AV (`WEB-itinvent/backend/services/my_files_service.py:3363-3390`).
- Consume grant проверяет hash/expiry, owner/file/folder deleted status и download payload (`:3937-3977`).
- ZIP archive plan собирается в transaction, сама запись ZIP вынесена наружу (`:3967-3983`), поэтому row lock не держится на весь multi-GB проход.
- Grant retry разрешён до expiry: used_at отмечает первое использование, а не блокирует последующие downloads.
- Это осознанно закреплено `tests/test_my_files_service.py:523` (`test_download_grant_is_retryable_until_expiry`); повторное consume само по себе не баг.
- Frontend preview содержит sequence guard `beginPreview/isCurrent` после await и revoke object URL при close/unmount (`useMyFilesPreviewController.js:39-133`).
- Старый preview response не должен заменять новый state; в просмотренном hook guard есть.
- Source workbook для Excel загружается отдельно и парсится в браузере; preview PDF и исходный workbook — два payload, их суммарная память требует измерения.

### Открытые вопросы, не включённые в подтверждённые дефекты

- `revoke_share:3171-3186` очищает share token, но уже выданные folder download grants не привязаны к generation share и живут до TTL.
- `create_public_folder_download_grant:3383` не сохраняет источник выдачи; consume не проверяет, что исходная public link ещё действует.
- TTL по коду `max(30, configured or 120)` (`:3742`). Требуется определить: отзыв должен быть немедленным для всех grants или capability действует до expiry.
- Не проверялось, должен ли revoke отдельной file link отзывать owner-issued grants; нельзя без решения удалить все grants одного файла.
- Упаковка ZIP может конкурировать с purge исходных blobs после построения плана; размер/TTL архивов и поведение частичной ошибки требуют fault test.
- Preview generation stale recovery/ownership требует отдельного parallel test; наличие очереди не означает доказанную exactly-once обработку.

## 4. База знаний — статьи, карточки, attachments

### DFILE-05 — store failure игнорируется и API может подтвердить несохранённую статью

- **High / S.** `WEB-itinvent/backend/services/kb_service.py:179-180`, `:406-412`, `:486-489`, `:643-644`, `:789-790`.
- `JSONDataManager.save_json` возвращает bool (`WEB-itinvent/backend/json_db/manager.py:89-93`). APP store при исключении логирует и возвращает False (`WEB-itinvent/backend/appdb/json_store.py:151-153`).
- KB `_save_articles/_save_cards` не проверяют результат; create/update/attachment возвращают успешный объект после False.
- Caller `WEB-itinvent/backend/api/v1/kb.py:258-263` принимает ненулевой attachment/result как успех, хотя metadata не сохранена.
- Последствие: пользователь видит успешное сохранение, reload теряет изменение; attachment bytes могут остаться orphan.
- План: fail-closed на False с понятной storage error; файлы сохранять через согласованный checkpoint/compensation, не теряя первоначальную причину.
- Acceptance: отказ DB save → HTTP storage error, отсутствует ложный success; последующий reload показывает подтверждённое состояние, orphan учтён для recovery.

### DFILE-06 — KB read-modify-save всего dataset допускает lost updates между процессами

- **High / S.** `WEB-itinvent/backend/services/kb_service.py:96-99`, `:173-180`, `:427-486`, `:1066`; `WEB-itinvent/backend/json_db/manager.py:89-93`.
- `self._lock` защищает только один KnowledgeBaseService instance. Загрузка и сохранение общего списка — разные операции store.
- Два процесса могут загрузить статьи X/Y; A меняет X, B меняет Y и сохраняет старый полный dataset, откатывая X.
- DB backend JSON manager не делает всю service-level последовательность атомарной автоматически.
- Номер version не является optimistic token: update_article не требует expected version, а редактирование content не увеличивает его как CAS.
- План: адресные entity updates через существующее storage либо version-guarded dataset transaction; не добавлять новый сервис.
- Acceptance: два independent instances/processes меняют разные статьи и одну статью; разные сохраняются обе, конфликт одной возвращает явный conflict.
- История revisions хранит action/version/note (`:203-219`), а не полный snapshot content: она не позволяет восстановить произвольно потерянные bytes текста.

### DFILE-07 — KB attachment читается целиком без собственного size budget

- **Medium / S.** `WEB-itinvent/backend/services/kb_service.py:592-605`, `WEB-itinvent/backend/api/v1/kb.py:250-258`.
- `upload.file.read()` материализует весь файл одним bytes; route/service не задают отдельного лимита size и не копируют поток ограниченными блоками.
- Несколько разрешённых writers могут умножить RSS на сумму payload; действующие IIS/request limits production не проверены.
- UploadFile multipart spool на диске не помогает после явного полного read в worker thread.
- План: валидация размера и bounded copy на staging с budget; metadata publish только после успешного копирования.
- Acceptance: oversize отвергается без полной allocation, partial read/write не оставляет доступный broken attachment; измерить RSS и peak temporary disk.
- Отдельно: add_attachment пишет bytes до сохранения metadata; exception/False save не запускает надёжный orphan cleanup. Это последствие DFILE-05, не отдельный дубль в счёте.

## 5. Хранилище паролей — lock, reveal и ошибки аудита

### DFILE-08 — поздний reveal возвращает secret после hide/blur

- **Medium / R.** `WEB-itinvent/frontend/src/components/passwords/usePasswordVaultAccess.js:124-158`, `:201-233`.
- Visibility/blur скрывает текущие secret state и включает privacy cover, но не обесценивает уже отправленный reveal.
- После ответа `revealEntry` без generation/focus/session guard снова пишет plaintext в state (`:212`); copy-purpose аналогично может поздно записать clipboard.
- Node harness извлёк настоящую async revealEntry, задержал API promise, очистил state как при hide, затем разрешил promise.
- Результат: `VAULT_LATE_REVEAL_AFTER_CLEAR: secretRestored=true`, exit=0; использовалась только синтетическая строка, никакие настоящие secrets не читались.
- Privacy cover может временно закрывать DOM, но при focus он снимается, а secret уже восстановлен; hidden response также хранит plaintext в React state.
- План: reveal epoch, инвалидируемый hideAll/blur/logout/account change, AbortSignal; guard и success, и copy, и cleanup.
- Acceptance: pending show/copy → blur/hide/account switch → late response не восстанавливает state/clipboard; новый запрос после focus работает.

### DFILE-09 — unlock остаётся активным при ошибке audit после выдачи

- **Medium / S.** `WEB-itinvent/backend/services/password_vault_service.py:816-843`, `:1025-1047`.
- `_grant_unlock` записывает session и user-wide unlock keys (`:834-840`) до отдельной audit transaction (`:841-842`).
- При отказе audit клиент получает ошибку, но последующий require_unlocked читает уже выданное разрешение до TTL.
- Сам второй фактор к этому моменту проверен: обход TOTP/passkey не утверждается. Проблема — неопределённый outcome и пропуск обязательного audit.
- План: единая orchestration/transaction с runtime store, либо явно определённый grant outcome + audit recovery; не превращать любой audit outage в молчаливый success.
- Acceptance: fault audit commit после проверки фактора имеет документированный результат, UI и backend согласованы, audit восстанавливается без повторной проверки/раскрытия секрета.

### Проверенные защитные механизмы и сознательные решения

- Vault list/entry response исключает encrypted password; reveal отдельно вызывает require_unlocked и object/global authorization (`WEB-itinvent/backend/services/password_vault_service.py:1067-1085`).
- WebAuthn challenge проверяет user ID и session ID (`WEB-itinvent/backend/api/v1/passwords.py:452-457`) и expected origin/RP/public key через trusted-device verifier.
- User-wide unlock, переживающий смену session ID, закреплён существующим `test_password_vault_unlock_survives_session_id_change`; это policy, не автоматически баг.
- ADR-0007 описывает lock при DB outage как fail-secure и принятый ±1 rate-limit race; эти случаи не переобъявлены дефектами.
- Current lock удаляет unlock keys до audit; DFILE-09 относится к обратному unlock-порядку, не к lock.
- Strict Fernet key policy и restart при ротации lru_cache ключа задокументированы; реальные keys не проверялись и не выводились.

## 6. Ресурсы, целостность и конкретный verification plan

- MyFiles chunk max=16 MiB (`WEB-itinvent/backend/services/my_files_service.py:82-83`), chunk request API ограничивает body (`WEB-itinvent/backend/api/v1/my_files.py:164-180`). Это не неограниченный read на каждом chunk.
- UI ограничивает параллельные files/chunks (`useMyFilesUpload.js:137-160`), передаёт AbortSignal и account generation; account switch guard реально присутствует.
- Quota и active job limits проверяются в reservation; PostgreSQL reservation locks нужны для межпроцессной конкуренции, Python RLock один их не заменяет.
- Hash pipeline использует bounded results queue (`WEB-itinvent/backend/services/my_files_service.py:210`), поэтому число параллельных readers не равно бесконечному накоплению chunks.
- Recovery tmp cleanup рекурсивно собирает set всех `*.tmp-*`/`*.tmp` (`WEB-itinvent/backend/services/my_files_recovery.py:26-27`); его стоимость зависит от всего дерева, фактические объёмы/период не измерены.
- MyFiles post-commit deletion предусмотрен `_release_blob_locked`; этот позитив не закрывает DFILE-02 и ранний spool delete в process_file.
- KB revisions и datasets растут без проверенного pagination/retention write budget; не предлагать удаление истории как автоматическое исправление.
- Для baseline нужны: 1/4/16 параллельных uploads, одинаковые/different hashes, slow UNC, AV latency, pool wait, RSS, spool bytes, SQL time, p95/p99.
- Для consistency нужны: files→blob refs, actual ref_count, missing blob paths, stored SHA/size, orphan spool/preview/attachment, stale jobs; только тестовая БД либо отдельно разрешённый read-only production анализ.

## 7. Проверки, тесты и охват

- В этом продолжении выполнены **два harness, оба exit=0**: реальный chunk overwrite с temporary files и реальная frontend revealEntry с отложенным promise.
- В harness chunk DB lookup заменён адаптером; SQL row-lock/DB isolation этим экспериментом не проверены. Главное окно находится вне любой DB transaction.
- Frontend harness — проверка функции, не реального браузерного focus/render/clipboard; browser acceptance остаётся задачей.
- Pytest/Vitest/Playwright в этом продолжении не запускались; нельзя выдавать найденные test files за пройденные tests.
- Изучены fixtures и названия сценариев `tests/test_my_files_service.py`, `tests/test_password_vault_service.py`; найденные tests покрывают owner scope, range retry, parallel status reads, security fail-closed, dedup, grants retry, vault lock/unlock.
- Эти проверки не покрывают автоматически conflicting overlapping chunks, simultaneous dedup finalization, shared ref_count race, stale worker generation и late reveal after blur.
- Дополнительные существующие зоны: `test_my_files_storage_v2.py`, `test_my_files_folders.py`, `test_my_files_api.py`, `test_my_files_worker_runtime.py`, `test_password_vault_api.py`, frontend SharedFile/SharedFolder/MyFiles/Passwords tests — не запускались в этом scope.
- KB boundary/fault/concurrency coverage требует отдельного просмотра; отсутствие запуска не означает отсутствие всех тестов.
- Прочитаны critical ranges `services/my_files_service.py`, `my_files_storage_layout.py`, `my_files_recovery.py`, `my_files_antivirus_service.py`, `kb_service.py`, `password_vault_service.py`.
- API/store: `api/v1/my_files.py`, `kb.py`, `passwords.py`, `json_db/manager.py`, `appdb/json_store.py`; UI: `useMyFilesUpload.js`, `useMyFilesPreviewController.js`, `SharedFile.jsx`, `usePasswordVaultAccess.js` и поиск вызывающих компонентов.
- Архитектурный источник vault: `docs/adr/0007-password-vault-phase-2-operational-limits.md`; дополнительно проверены явные тесты user-wide unlock/grant retry, чтобы не выдать policy за дефект.
- Полные binary integrity checks production, AV runtime, actual UNC/ACL, browser E2E, clean build и release не выполнялись.
- План исправлений должен начинаться с DFILE-01/02/03/04 (bytes и ownership), затем KB fail-closed/concurrency и vault async fencing. Код не исправлялся; деплой и рестарты не выполнялись.
