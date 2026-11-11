# 01. Auth, сессии, настройки, пользователи и AD — углублённый аудит

> **Актуализация 2026-11-03:** ниже сохранён снимок исследования 02.11. DAUTH-01/02 (BE-02/BE-06) изменены извне: app DB теперь использует адресные операции; их нельзя считать неизменёнными открытыми дефектами. См. [повторную сверку](../INITIAL_FINDINGS_RECHECK_2026-11-03.md). Остальные пункты не закрываются этим изменением; полная приёмка не выполнялась.

Дата: 2026-11-02. Режим: чтение исходников и изолированные диагностические проверки; production и реальный `.env` не использовались.
Результат: 9 находок — 5 High, 4 Medium. BE-02/BE-06 из общего отчёта перепроверены; их не следует считать новыми независимыми проблемами при общей дедупликации.
Исходники меняются другим процессом: выводы относятся к прочитанной реализации, номера ключевых мест перепроверены перед записью.

## Границы и модель модуля

1. Web/Desktop используют общие `AuthContext`, API client и cookie access/refresh.
2. Expo получает токены через mobile delivery; это другой способ передачи, но общие серверные сессии и правила.
3. Router `api/v1/auth.py` координирует login, TOTP, passkeys, refresh, logout и администрирование пользователей.
4. `AuthSecurityService` соединяет challenge, user identity, session, trusted credential и выдачу JWT.
5. `SessionService` хранит жизненный цикл сессии; `SessionAuthContextService` отдельно хранит зашифрованный AD credential context для персональной почты/интеграций.
6. `AuthRuntimeStoreService` хранит короткоживущие refresh/challenge/revocation/rate-limit записи в APP DB; dev-memory — отдельная ветвь.
7. `UserService` хранит профиль, роль, custom permissions и настройки интеграций; имеются разные process-local кеши.
8. `AuthorizationService` вычисляет эффективные права, а API deps проверяют текущего пользователя и session/device validity.
9. `EnvSettingsService` изменяет файл конфигурации и отдельный журнал аудита; сам по себе вызов PATCH не выполняет restart/deploy.
10. AD import и AD groups matrix — разные операции: первая меняет app users, вторая строит снимок фактических групп AD для чтения.

### Карта критических путей

| Путь | Цепочка | Граница сохранения |
|---|---|---|
| Password login | `WEB-itinvent/backend/api/v1/auth.py:640` → `AuthSecurityService.start_login` → user authentication → challenge/2FA → `_complete_login` (`WEB-itinvent/backend/services/auth_security_service.py:564`) | Session, credential context и refresh state сохраняются отдельными этапами. |
| AD login → персональная почта | `_complete_login:608` → `SessionAuthContextService.store_session_context:133` → `AppSessionAuthContext` | Зашифрованный credential привязан к session ID, не только user ID. |
| Refresh | `WEB-itinvent/backend/api/v1/auth.py:1361` → prepare tokens → `AuthRuntimeStoreService.complete_refresh_rotation:513` | Старый refresh consume, новый refresh, grace и revoke фиксируются одной DB transaction. |
| Protected request | `WEB-itinvent/backend/api/deps.py:86` → decode/revocation → user lookup → session active → trusted device → effective permissions | Identity/session caches действуют до DB lookup; permission object не равен JWT claim. |
| Self password change | `WEB-itinvent/backend/api/v1/auth.py:1135` → user change → close sessions → revoke trusted/biometric → delete session contexts | Пароль и последующие revocation — отдельные операции. |
| Admin password reset | `WEB-itinvent/backend/api/v1/auth.py:2214` → user update → optional close/revoke | Набор revocation отличается от self-change, DAUTH-04. |
| Settings env | `WEB-itinvent/backend/api/v1/settings.py:384` → `update_variables:680` → whole-file write → audit INSERT | Файл и audit не образуют атомарную операцию, DAUTH-05. |
| AD app-user sync | `background_ad_app_user_sync_loop:28` → `sync_all_from_ad:563` → LDAP snapshot → bulk upsert/deactivation | Есть process lock и PostgreSQL advisory lease; чтение LDAP не должно означать подтверждённый полный снимок при ошибке. |
| Groups matrix | `WEB-itinvent/backend/api/v1/groups_access.py:29` → snapshot-backed filters | Это чтение снимка, а не проверка фактического доступа к конкретному файлу на сервере. |

## Проверяемые инварианты

- Одноразовый refresh/challenge/backup code не должен создавать две независимые успешные попытки.
- Logout, сброс пароля и отзыв устройства должны прекращать соответствующее доверие в согласованной политике всех процессов.
- Параллельный вход другого пользователя не должен удалять или менять его credential context.
- Изменение одного профиля не должно откатывать параллельную смену роли, пароля или 2FA того же пользователя.
- Read-path lookup одной сессии должен зависеть от одной записи, а cleanup — быть ограниченным и отдельно наблюдаемым.
- Административная правка конфигурации должна иметь однозначный результат: ошибка ответа не должна скрывать уже применённую запись.
- Секреты не выводятся в этот отчёт; экспериментальные значения синтетические.
- Deactivation сохраняет PK/history; физическое удаление требует отдельно определённой политики.

## Реестр сценариев

| Сценарий | Проверка | Результат и предел |
|---|---|---|
| Два refresh одного токена, первый медленный | Реальный API TestClient в `test_auth_refresh_recovery.py` | Профиль прошёл; callers получают одну committed пару, не две разные. |
| Сбой lookup/commit до refresh commit | Тот же профиль | Старый refresh остаётся пригоден; положительная проверка, не дефект. |
| Две AD-сессии со stale снимками | Реальные AST methods + SQLAlchemy SQLite memory | После A, затем stale B осталась только B; DAUTH-01. |
| Один backup code, два разных login challenges | Реальный AST consume + две SQLAlchemy sessions и barrier | Оба consume вернули True; DAUTH-03. Полный login HTTP не запускался. |
| Password change самим пользователем | Чтение route/service | Закрывает sessions, trusted и biometric; ошибка промежуточного шага остаётся отдельным fault-injection сценарием. |
| Admin password reset | Чтение route/model/service | Biometric отзывается, active sessions/passkeys остаются; DAUTH-04. |
| Отзыв passkey | Чтение `revoke_device` и API deps | User ownership проверяется, локальный device validity cache очищается; распространение между процессами runtime не измерялось. |
| Изменение permissions в API, запрос в другом runtime | Трассировка identity caches → API deps | До TTL другой процесс использует старые права, DAUTH-09. |
| Одновременное изменение разных полей одного user | Трассировка load snapshot → full payload update | Нет optimistic version/field patch на DB write; DAUTH-07. |
| Ошибка audit после config write | Реальные AST update/serializer, temporary config.txt, synthetic audit failure | Файл уже изменён при ошибке; DAUTH-05. |
| Перевод строки в env value | Тот же isolated harness | Возник дополнительный binding, которого не было отдельным ключом запроса; DAUTH-06. |
| LDAP не отвечает / возвращает пусто | Чтение полного sync branch | Массовая деактивация пропускается, `WEB-itinvent/backend/services/ad_app_user_import_service.py:628-650`. Live LDAP не вызывался. |
| Параллельный AD sync разных backend | Чтение `:601-615` | PostgreSQL advisory lock присутствует; отсутствие межпроцессного lock здесь не найдено. |
| Удаление web user | Чтение delete route и storage | Реальный физический DELETE, DAUTH-08. Запрос не выполнялся. |

## Находки и конкретный план

### DAUTH-01 — stale save удаляет чужой auth context

- **High / R**, связь: прежний **BE-02 подтверждён текущим кодом**.
- Доказательства: `WEB-itinvent/backend/services/session_auth_context_service.py:80-108`, `:159-161`, `:168-187`, `:203-206`.
- `_load_items` открывает отдельную транзакцию; `_save_items` снова читает всю таблицу и удаляет IDs, отсутствующие в переданном снимке.
- Caller: AD `_complete_login` в `WEB-itinvent/backend/services/auth_security_service.py:608-615`; logout использует `delete_session_context` в `WEB-itinvent/backend/api/v1/auth.py:1089`.
- Interleaving: A и B читают пустой снимок; A сохраняет A; B сохраняет свой старый снимок+B и удаляет A.
- Изолированно повторно выполнены реальные `_load_items/_save_items/_row_to_dict/_apply_payload` на SQLAlchemy/SQLite memory: итог `['B']`.
- Аналогичная опасность есть в getter expiry cleanup, logout и prune: они синхронизируют всю таблицу из более старого состояния.
- Последствие: чужой вход остаётся живым, но персональная AD-почта/операция теряет credential и требует повторного входа.
- Исправление: адресный upsert по session ID, адресный delete, отдельный bounded expiry cleanup; никаких missing-ID deletion при save одной записи.
- Acceptance: A/B logins + logout A + expiry cleanup конкурируют; B остаётся с теми же encrypted bytes и ownership; проверка final DB state обязательна.
- Риск изменения: сохранить совместимость dev-store и явное удаление context при закрытии сессии; шифрование и TTL не менять побочно.

### DAUTH-02 — lookup credential context сканирует всю таблицу

- **Medium / S**, связь: прежний **BE-06 подтверждён**.
- Доказательства: `WEB-itinvent/backend/services/session_auth_context_service.py:80-84`, `:164-187`, `:190-195`, `:241-257`.
- Getter одного session ID грузит и сериализует все строки, затем фильтрует Python-циклом; разрешение password повторно вызывает getter.
- При истёкших записях read превращается в полную save/reconciliation операцию с риском DAUTH-01.
- Стоимость: O(N) строк и encrypted payload в памяти; фактический размер таблицы и p95 production не измерены.
- Исправление: SELECT по session_id/user_id/expiry; user-latest lookup с ORDER BY/LIMIT на сервере; cleanup вне request path.
- Acceptance/perf: одинаковая смесь 100/1 000/10 000 синтетических контекстов, query count/rows returned/SQL time/p95, cold и warm; запрос одной сессии возвращает максимум одну строку.
- Не требуется новая инфраструктура; решение должно использовать существующую APP session abstraction.

### DAUTH-03 — один backup code принимается двумя параллельными входами

- **High / R, NEW**.
- Доказательства: `WEB-itinvent/backend/services/auth_security_service.py:385-405`, caller `:448-480`.
- `_consume_backup_code` SELECT-ит unused rows без row lock, сверяет код и присваивает `used_at` ORM-объекту.
- Два callers с разными одноразовыми login challenges читают одну ещё unused строку, оба возвращают True; UPDATE не содержит `used_at IS NULL` CAS.
- Изолированный harness: реальный AST метод, реальный SQLAlchemy/temporary SQLite, два потока; barrier после SELECT и до записи.
- Вывод: `REAL_BACKUP_CODE_CONSUME_RESULTS [True, True]`, exit=0. Временная БД удалена, настоящие коды/пользователи не использовались.
- Одноразовость login challenge не закрывает дефект: используются два разных challenge, но один общий backup code пользователя.
- Исправление: после нахождения hash делать атомарный `UPDATE ... WHERE id=:id AND used_at IS NULL`, успех только при rowcount=1; альтернативно row lock на PostgreSQL с portable CAS ветвью.
- Acceptance: два HTTP verify с двумя challenges и одним backup code дают один успешный вход и один отказ; consumed row одна. Неверный код не расходует другой.
- Риск: не логировать code/hash; не расширять TOTP valid window и не менять challenge lifetime.

### DAUTH-04 — admin password reset не отзывает сессии и passkeys

- **High / S, NEW**.
- Доказательства: `WEB-itinvent/backend/api/v1/auth.py:2213-2237`; модель `WEB-itinvent/backend/models/auth.py:284`; `WEB-itinvent/backend/services/user_service.py:1384-1387`.
- PATCH с password сохраняет новый hash и отзывает только mobile biometric credentials (`auth.py:2235-2236`).
- `_close_sessions_and_contexts` вызывается только при is_active=False; `trusted_device_service.revoke_all_user_devices` здесь отсутствует.
- Для сравнения self-change (`auth.py:1148-1153`) закрывает sessions, отзывает trusted и biometric, удаляет contexts.
- Следствие: смена пароля администратором не прекращает уже открытый доступ и не удаляет ранее зарегистрированное passkey-доверие.
- Это расходится с инвариантом AUTH_SECURITY_STACK «Password change ... invalidates trusted devices»; runtime exploitation не проверялась.
- Исправление: единая orchestration revocation для successful password change/reset с согласованной политикой текущего клиента; не менять сам session lifetime.
- Acceptance: заранее создать browser session, trusted passkey и biometric; admin reset; прежние access/refresh/passkey/biometric пути должны соответствовать одной политике отзыва.
- Нужен отдельный fault-injection шаг: ошибка revocation после сохранения hash не должна выдавать двусмысленный успешный результат.

### DAUTH-05 — env update неатомарен и может завершиться ошибкой после записи

- **High / R+S**, развитие прежних замечаний о settings, не новая API-уязвимость без авторизации.
- Доказательства: `WEB-itinvent/backend/services/env_settings_service.py:555-577`, `:680-766`; caller `WEB-itinvent/backend/api/v1/settings.py:384-404`.
- Read-modify-write полного файла не защищён общей межпроцессной блокировкой и не использует temp+replace. Параллельные изменения разных ключей могут потеряться; crash во время write может оставить неполный файл.
- Audit INSERT выполняется только после записи файла (`:731-732`), поэтому отказ audit превращает уже изменённую конфигурацию в HTTP error.
- Harness реального AST update/serializer, temporary `config.txt`, synthetic audit failure: `rejected_audit=True; config_changed=True`, exit=0.
- Сценарий параллельных writers и crash-write изучен статически; в production не воспроизводился.
- Исправление: валидированный change set, file lock/version check, atomic replace, продуманный audit intent/commit/reconciliation; нельзя притвориться, что файловая и DB транзакции автоматически едины.
- Acceptance: две правки независимых ключей сохраняются обе; fault до/после replace имеет однозначный outcome и audit/recovery; не затрагивать настоящий `.env` в тестах.
- Публичная ошибка должна сообщать статус применения без утечки значений; безопасный dry-run полезен, но не заменяет атомарность записи.

### DAUTH-06 — newline в env value создаёт дополнительные bindings

- **Medium / R, NEW как конкретное воспроизведение в текущем проходе**.
- Доказательства: `WEB-itinvent/backend/services/env_settings_service.py:350-353`, `:687-711`, `:567-577`; `WEB-itinvent/backend/api/v1/settings.py:391-400`.
- Нормализация возвращает str без запрета CR/LF, запись интерполирует value непосредственно в KEY=value; key также не валидируется перед сериализацией.
- Реальный isolated update `BASE='2\nEXTRA=3'` создал второй binding `EXTRA=3`, хотя отдельного ключа EXTRA в updates не было.
- Риск здесь — ошибочное/скрытое изменение конфигурации и неполный audit ключей; endpoint уже admin-only, поэтому обход роли admin не утверждается.
- Исправление: определённый формат quoting/escaping либо явный отказ на CR/LF в однострочных значениях; key validation с сохранением существующих hyphenated DB aliases.
- Acceptance: multiline/key-newline не создают дополнительных строк; обычные quoted values, пустые значения и `DB_*` aliases сохраняют совместимость.

### DAUTH-07 — patch одного поля может откатить параллельное изменение того же пользователя

- **Medium / S, NEW**.
- Доказательства: `WEB-itinvent/backend/services/user_service.py:166-184`, `:194-239`, `:427`, `:1333-1404`, `:1445-1464`.
- `only_ids` ограничивает набор пользователей, но не набор полей: stale payload одного user передаётся в `_apply_user_payload` целиком.
- Два процесса могут читать старый профиль; A меняет пароль/роль, B меняет email и сохраняет старые password/role вместе с новым email.
- Локальная cache invalidation не исправляет уже захваченный снимок в другом процессе. Сценарий статический, parallel DB harness для UserService не запускался.
- Исправление: DB PATCH только переданных полей или version/CAS; sensitive operations должны перечитывать/изменять необходимую строку внутри своей транзакции.
- Acceptance: параллельные password-change и profile update сохраняют оба изменения; old password не становится действующим повторно. Аналогично role/custom permissions и full_name.
- Нельзя решать глобальной блокировкой только Python-процесса: backend/chat/worker могут быть разными процессами.

### DAUTH-08 — обычный user DELETE физически удаляет identity вместо деактивации

- **Medium / S, архитектурное несоответствие**, изменение контракта требует отдельного решения.
- Доказательства: `WEB-itinvent/backend/api/v1/auth.py:2240-2255`; `WEB-itinvent/backend/services/user_service.py:1467-1478`; storage `:236-239`.
- Route явно вызывает delete_user, а тот передаёт deleted_ids в session.delete; это не мягкая деактивация.
- Защищены self-delete и ID=1, но это не сохраняет PK остальных пользователей и не задаёт политику исторических ссылок.
- Фактические orphan/FK ошибки production не проверялись; наличие конкретных потерянных историй не утверждается.
- Противоречие: обязательный инвариант репозитория — деактивация по умолчанию с сохранением PK/history.
- План: согласовать UX/API явного удаления отдельно, штатную операцию завершения доступа направлять на deactivation; purge только отдельной процедурой после анализа связей.
- Acceptance: деактивация сохраняет ID и исторические ссылки, закрывает доступ, допускает управляемую реактивацию; purge-тест требует отдельной тестовой БД.

### DAUTH-09 — права в другом процессе могут оставаться прежними до 300 секунд

- **High / S, NEW**, связан с отдельной находкой DCHAT о snapshot уже открытого WebSocket.
- Доказательства: `WEB-itinvent/backend/services/user_service.py:95-98`, `:119-124`, `:139-164`, `:775-789`; `WEB-itinvent/backend/api/deps.py:105`, `:133-138`; `WEB-itinvent/backend/api/v1/auth.py:2233-2236`.
- Identity cache имеет TTL 300 с и инвалидируется только в экземпляре UserService, обработавшем изменение.
- Role/custom-permission update не закрывает сессии. Другой split runtime может получить свежий REST запрос и авторизовать его по своему старому cached user.
- Это отдельный механизм от WS snapshot: у нового REST ограничение — TTL, у давно открытого socket нужно отдельно обновлять переданный объект пользователя.
- Runtime межпроцессный HTTP-сценарий не запускался; подтверждена цепочка cache→deps→permissions, а не факт несанкционированного действия в production.
- Исправление: согласованная version/invalidation для authorization-relevant fields через существующий канал либо адресная проверка версии при sensitive requests; не требуются Redis/новый сервис.
- Acceptance: два независимых service instances/processes, warm identity cache второго, downgrade в первом; следующий sensitive REST второго должен отказать в согласованном revocation SLA.

## Производительность, транзакции и ресурсы

- Identity cache ускоряет частые auth dependencies, но авторизационные поля нельзя смешивать с произвольным пятиминутным profile TTL без revocation-политики.
- Session active cache ограничен TTL 8 с (`WEB-itinvent/backend/services/session_service.py:120`); это явно другой срок, чем user identity 300 с.
- Session creation в APP DB блокирует стабильную user row (`WEB-itinvent/backend/services/session_service.py:628`), затем flush и enforcement лимита; отсутствие lock для параллельных логинов здесь не заявлено.
- Touch обновляет только timestamps при active/status guards (`WEB-itinvent/backend/services/session_service.py:731-739`), не пишет весь снимок; преждевременное обвинение в обязательном session resurrection отвергнуто.
- Session cleanup остаётся периодической полной работой, но `_maintenance_lock` и повторная проверка marker (`:416-424`) подавляют повторный concurrent scan внутри процесса.
- User update/change-password по-прежнему читают users snapshot; это и стоимость O(users), и DAUTH-07. Измерение production baseline не проводилось.
- AD full sync удерживает advisory lease connection на время LDAP fetch (`WEB-itinvent/backend/services/ad_app_user_import_service.py:604-617`); это расход connection, но не доказанная длинная write transaction.
- Groups snapshot filtering может пересчитывать матрицу в памяти; фактические размер снимка и latency не измерены, отдельная performance-ошибка не объявлена.
- Env GET/patch передают admin plaintext values по текущему UI контракту: `WEB-itinvent/backend/services/env_settings_service.py:592` и `EnvVariablesTab.jsx:70-83`. UI имеет reveal-механику, поэтому это зафиксированная поверхность доступа, а не автоматически доказанный bypass.

## Фактические проверки

1. `python -m pytest -q tests/test_auth_refresh_recovery.py tests/test_authorization_service.py tests/test_twofa_service.py`.
2. Результат: **15 passed, 5 warnings**, 74,06 с, exit=0.
3. Перед запуском live APP opt-in выключен, APP_ENV=development, SCAN_DATABASE_URL пуст, CHAT_REALTIME_TRANSPORT=local; conftest перенаправлял APP/CHAT на тестовые SQLite.
4. Фикстуры refresh используют отдельную временную SQLite и FastAPI TestClient, user lookup/session active/metrics заменены; реальные LDAP/Exchange не вызываются.
5. При atexit pytest получил WinError 5 на старом `pytest-current` за пределами репозитория. Assertions прошли; полная очистка старого pytest окружения не подтверждена.
6. Три свежих diagnostic harness завершились exit=0: backup-code double consume; stale auth-context save; env update с audit failure и newline.
7. Harness извлекали реальные функции через AST без импорта backend config/singletons. SQLAlchemy использовался настоящий; внешние шифрование/transport не проверялись.
8. Реальный `.env` не читался и не менялся; env harness писал только temporary `config.txt` с синтетическими именами/значениями.
9. Это не заявка на прохождение всего auth suite, WebAuthn ceremony, браузерного E2E или Android acceptance.

## Существующие тесты и недостающие границы

- Прочитаны fixtures/assertions `tests/test_auth_refresh_recovery.py`, `tests/test_env_settings_service.py`, `tests/test_trusted_device_service.py`; только первый из них запускался в указанном профиле.
- Найдены профильные suites: `test_auth_security_flow.py`, `test_auth_runtime_store_service.py`, `test_auth_user_deactivation.py`, `test_session_device_limits.py`, `test_session_trusted_device_pool_reuse.py`, `test_web_settings_and_sessions.py`, `test_ad_groups_access_service.py`.
- Наличие файла не считается покрытием каждой гонки; полный набор этих suites не запускался.
- Нужны boundary-тесты двух login challenges с одним backup code; административного password reset с active passkey; двух independent identity caches после downgrade.
- Нужен параллельный final-state тест auth context login/logout/expiry; обычный последовательный unit не обнаружит DAUTH-01.
- Нужны fault tests env write/audit outcome и read-modify-write двух writers, только на temporary config.
- Нужен cross-process/DB patch тест одного user с одновременными sensitive и несвязанными полями.

## Отвергнутые подозрения и ограничения

- Refresh rotation не является прежней consume-before-commit гонкой: `WEB-itinvent/backend/services/auth_runtime_store_service.py:539-563` объединяет consume и publication; узкий regression suite прошёл.
- PostgreSQL rate counter уже использует atomic ON CONFLICT (`WEB-itinvent/backend/services/auth_runtime_store_service.py:355-372`); обвинение в обычном get/set lost increment для этого пути неверно.
- AD sync защищён и локальным lock, и PostgreSQL advisory lease; пустой LDAP не равен разрешению деактивировать всех.
- WebAuthn verification явно передаёт expected origin/RP ID/public key/sign count (`WEB-itinvent/backend/services/trusted_device_service.py:448-455`); наличие userVerification=preferred в обычных options само по себе не доказательство bypass.
- SessionService `_save_sessions` больше не удаляет отсутствующие строки снимка (`:181-184`); DAUTH-01 относится к другому SessionAuthContextService.
- `AuthorizationService` custom permissions объединяются с viewer baseline (`WEB-itinvent/backend/services/authorization_service.py:240-244`); это существующая политика с тестами, не исправляется как «очевидный баг» без согласования бизнес-логики.
- Production schema, FK/orphans, реальные AD snapshots, distributed invalidation transport и network-zone config не проверялись.
- Рекомендации не меняют TTL, 2FA policy, refresh rotation, device trust или WebAuthn origin как побочный эффект. Код не исправлялся; deploy/restart не выполнялись.

## Перечень изученных файлов

- Правила/контекст: `AGENTS.md`, `documentation/technical/AUTH_SECURITY_STACK.md`, `TECH_DEBT_AUDIT_2026-11-02.md`.
- API/модели: `WEB-itinvent/backend/api/v1/auth.py` (критические routes и guards), `api/v1/settings.py`, `api/v1/ad_users.py` (начало/границы), `api/v1/groups_access.py`, `api/deps.py`, `models/auth.py`.
- Services подробно: `session_auth_context_service.py`, `auth_security_service.py`, `auth_runtime_store_service.py`, `session_service.py`, `trusted_device_service.py`, `authorization_service.py`, `twofa_service.py`, `env_settings_service.py`, `user_service.py` — указанные выше методы и callers.
- AD services выборочно: `ad_app_user_sync_service.py`, `ad_app_user_import_service.py` (fetch status/lease/deactivation guards), `ad_groups_access_service.py` (snapshot/write/filter paths).
- UI выборочно: `WEB-itinvent/frontend/src/pages/Settings.jsx`, `src/pages/account/admin/EnvVariablesTab.jsx`; frontend auth lifecycle подробно разбирается в другом модуле общего аудита.
- Tests: три запущенных suites плюс чтение fixtures env/trusted и поиск релевантных regression файлов. Внутренняя реализация ldap3/webauthn/pyotp не исследовалась.
