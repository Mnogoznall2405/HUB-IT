# Дополнительный аудит frontend: аккаунт, главная, статистика

Дата: 2026-11-03. **Четыре новых дефекта: два High, два Medium.** Проверены пять синтетических сценариев на извлечённых из актуальных исходников обработчиках и нормализаторах. Код приложения не менялся; production, БД, сеть и сборки не использовались.

Обозначения: **R** — изолированное воспроизведение реальной функции; **S** — подтверждённая исходниками цепочка вызовов; **H** — гипотеза, не включённая в подтверждённый реестр. R не означает браузерную или production-приёмку.

## Объём и дедупликация

Прочитаны индекс `TECH_DEBT_AUDIT_2026-11-02.md`, свежая сверка `INITIAL_FINDINGS_RECHECK_2026-11-03.md` и отчёты 01, 02, 04, 10, 11, 18. Новые механизмы ниже не повторяют FE-01/DFE-01 (SWR invalidation), очереди фото FE-02/04/05, FE-03 (polling IT-объекта), DTASK (realtime membership/backlog), DFILE (vault reveal/файловые workers), DNET (сети/monitoring).

Исследованы `PreferencesContext`, `Dashboard`, `Statistics` и диалог оставшихся ПК; общая загрузка аккаунта/администрирования, редактор пользователей и модель черновика; API settings/auth/json и соответствующие backend-контракты. Полная проверка каждой страницы, ветки уведомлений и админской интеграции не заявляется.

| ID | Важность / доказательство | Итог |
|---|---|---|
| XFE-01 | High / R+S | Повторное сохранение пользователя в широком редакторе удаляет помощников; отказ их предварительной загрузки создаёт тот же результат. |
| XFE-02 | High / R+S | Поздний ответ списка ПК подменяет данные нового филиала; подтверждение отправляет оборудование из старого контекста с новым филиалом/БД. |
| XFE-03 | Medium / R+S | Блок главной «Отсутствуют сегодня» разрешён frontend, но удаляется backend-нормализацией при сохранении. |
| XFE-04 | Medium / R+S | Старый GET настроек откатывает уже подтверждённый PATCH в state и локальном кеше. |

## XFE-01 — редактор пользователя превращает отсутствие данных о помощниках в явное удаление

**High / R+S. Два триггера одной проблемы целостности, считаются одной находкой.**

Основной сценарий не требует сетевой ошибки:

1. На широком экране открыть пользователя с действующим помощником/заместителем и сохранить изменение ФИО.
2. `UsersTab.jsx:214` вызывает `onUpdateUser`. `useAccountSectionData.js:621` сначала PATCH-ит профиль, затем `:622` безусловно PUT-ит список помощников и перезагружает общий список.
3. Обработчик возвращает `user: updated` из PATCH (`useAccountSectionData.js:636`). Его контракт — `response_model=User`, `WEB-itinvent/backend/api/v1/auth.py:2211`; в `backend/models/auth.py:29` у User нет `task_delegate_links`.
4. Широкий редактор остаётся открытым и пересоздаёт свой черновик из `result.user` (`WEB-itinvent/frontend/src/pages/account/admin/UsersTab.jsx:221`). `createUserDraftFromItem` превращает отсутствующее поле в `[]` (`WEB-itinvent/frontend/src/pages/account/accountUserModel.js:99`). Перезагруженный общий список не обновляет этот черновик: эффект `UsersTab.jsx:151` проверяет только существование пользователя.
5. Следующее обычное сохранение профиля отправляет PUT `{items: []}`. Сервер считает это полным новым списком: `backend/api/v1/auth.py:2299`, `services/user_service.py:589`; существующие строки, которых нет во входящем наборе, удаляются в `user_service.py:365`.

Отдельный достижимый триггер: `loadUsers` заранее создаёт `usersWithDelegates` с пустым набором (`useAccountSectionData.js:229`), ловит ошибку bulk read только через `console.error` (`:234`), публикует результат и очищает видимую ошибку (`:239`). Редактирование ФИО после временного 5xx/timeout также отправляет пустой PUT вместо сохранения неизвестного состояния. API уже дробит bulk на 80 IDs (`src/api/authUserAdmin.js:3`), поэтому обвинение в обязательном превышении URL на любом большом каталоге отвергнуто.

**Воспроизведение.** Node + `@babel/parser` извлекли настоящие `handleSaveDraft`, `handleUpdateUser`, `loadUsers`; модель черновика импортирована из реального pure-модуля. API transport и React setters заменены синтетическими. Никаких настоящих HTTP/DB-запросов:

```text
wide_user_editor: first_PUT_links=1; reseeded_draft_links=0; second_PUT=[]
delegates_failed_read: PUT=[]; result.ok=true; error_notices=0
```

Оба финальных запуска exit=0. Серверное физическое удаление подтверждено кодом; на реальной БД не выполнялось. Это потеря связей делегирования и связанного доступа, а не доказательство удаления самих пользователей или задач.

**Минимальное исправление.** Сохранять полноценный editor result с подтверждёнными связями либо не пересоздавать связи из неполного PATCH User. Различать `unknown/error` и `loaded empty`; при failed bulk read не разрешать замену связей. Отправлять relation PUT только при достоверном исходном наборе и изменённом поле; ошибка второго шага должна показывать частичный результат отдельно от сохранённого профиля.

**Приёмка.** Через реальный экран: два последовательных изменения ФИО в широком редакторе сохраняют помощников; изменение/удаление помощника выполняется ровно по намерению пользователя. После failed bulk read обычное изменение профиля не очищает связи. Проверить финальный список через GET. Не достаточно проверить успешность двух PATCH или мокнуть PATCH полем `task_delegate_links`, которого нет в контракте.

## XFE-02 — late remaining-PC response смешивает оборудование и контекст операции

**High / R+S.**

`WEB-itinvent/frontend/src/pages/statistics/PcRemainingDialog.jsx:77` запускает `getPcCleaningRemaining`. В `.then` `:86` без проверки актуальности устанавливает rows и totals. `cancelled`, установленный cleanup эффекта (`:120`), проверяется только в `.catch` и `.finally` (`:110`, `:116`). Успешный старый ответ продолжает менять состояние после закрытия диалога/смены branchRow.

Caller сохраняет один экземпляр диалога в PC-вкладке (`WEB-itinvent/frontend/src/pages/Statistics.jsx:591`): закрытие выставляет `remainingBranch=null`, новое открытие передаёт другой филиал. Поэтому последовательность «медленный A → закрыть → открыть B → B ответил → A ответил последним» достижима без размонтирования диалога.

После подмены rows пользователь видит заголовок B и выбирает строку A. `handleConfirmCleaning` (`PcRemainingDialog.jsx:143`) берёт branch из текущего `branchRow`, а `dbName` — из текущего localStorage (`:145`). `buildPcCleaningPayload` предпочитает этот branch полю строки (`src/pages/statistics/pcRemaining.js:39`) и сохраняет serial/equipment_id старой строки (`:48`, `:62`). Получается смешанный payload. Смена выбранной БД с закрытием/повторным открытием диалога расширяет тот же риск на DB identity.

Сервер не восстанавливает филиал из переданного equipment ID: `WEB-itinvent/backend/api/v1/json_operations.py:511` передаёт клиентские поля в `WorksManager.add_pc_cleaning`; `backend/json_db/works.py:810` формирует record, `:826` сохраняет его, а `:832` передаёт клиентские `equipment_id` и `db_name` в обновление SQL description. При совпадающем ID в другой БД возможен неверный SQL target; это статически установленный риск, запись в SQL не воспроизводилась.

**Воспроизведение.** Извлечены настоящие `reloadRemaining` и `handleConfirmCleaning`, импортирован реальный `pcRemaining.js`. Два deferred transport Promise завершены B → A; затем реальный обработчик подтверждения вызван для появившейся строки. API POST перехвачен в памяти:

```text
cleaning: active_branch=Branch-B; late_row=SERIAL-A;
posted_serial=SERIAL-A; posted_branch=Branch-B; posted_db=DB-B
```

Финальный запуск exit=0. Проверена именно неверная композиция outgoing payload. Браузерное действие, HTTP endpoint и реальный commit не выполнялись.

**Минимальное исправление.** Capture request generation и scope `{database, branch, period}`; проверять их до каждого success/error/finally, обесценивать запрос при закрытии/смене scope. Запрещать подтверждение строки, не принадлежащей загруженному scope; отправлять зафиксированную БД набора, а не читать её заново в момент нажатия. Серверная проверка equipment↔DB/branch полезна как дополнительная граница целостности.

**Приёмка.** Локальный UI: A pending → закрыть → B → ответы B/A; остаются только строки/счётчики B. Повторить со сменой БД и периода; старые errors/finally тоже не меняют новый экран. Перехваченный POST и финальное хранилище должны содержать одну согласованную identity. Проверка только `loading=false` не обнаружит проблему.

## XFE-03 — «Отсутствуют сегодня» невозможно сохранить как видимый блок главной

**Medium / R+S, несовместимость действующих контрактов frontend/backend.**

Frontend включает `absences` в `DASHBOARD_SECTION_KEYS` и defaults (`WEB-itinvent/frontend/src/contexts/PreferencesContext.jsx:20`), предлагает блок в кастомизации (`src/pages/Dashboard.jsx:79`, `:519`) и сохраняет его через `savePreferences({dashboard_sections: nextSections})` (`:955`). Действующий рендер блока находится в `Dashboard.jsx:1199`, это не только неиспользуемая константа.

`WEB-itinvent/backend/services/settings_service.py:25` разрешает лишь `attention/tasks/communication/news`. `_normalize_dashboard_sections` `:139` выбрасывает `absences`, а `_update_user_settings_locked` `:385` использует эту нормализацию для PATCH. Сразу полученный ответ нормализуется в provider и заменяет оптимистическое состояние (`PreferencesContext.jsx:288`). Блок исчезает после успешного сохранения; сброс на frontend defaults не помогает. Данные отсутствий в dashboard response этой правкой не проверялись: дефект — именно невозможность сохранить видимость раздела.

**Воспроизведение.** Python AST извлёк константы и настоящие методы нормализации SettingsService; `__init__`, module singleton и backend config не импортировались. Вход соответствует реальному frontend PATCH:

```json
{"requested":["attention","tasks","absences","communication","news"],"normalized_response":["attention","tasks","communication","news"],"absences_persisted":false}
```

Exit=0. Это реальная серверная нормализация, не HTTP/DB-приёмка. Вторая таблица/миграция для хранения значения здесь не нужна: существующее поле уже содержит JSON list.

**Минимальное исправление.** Согласовать серверный whitelist с действующим frontend-разделом и его defaults; сохранить правила mandatory attention и совместимость старого mobile list. Не превращать это в смену прав доступа к данным отсутствий.

**Приёмка.** GET → добавить «Отсутствуют сегодня» → PATCH → GET → reload сохраняет видимость и порядок. Скрытие также сохраняется. Проверить existing settings, defaults и legacy mobile sections. Нужна реальная HTTP-граница с локальной/test DB: mock saved payload в Dashboard test скроет несовместимость.

## XFE-04 — background preferences GET откатывает подтверждённое сохранение

**Medium / R+S.** Это отдельная от FE-01/DFE-01 гонка: прямые settingsAPI GET/PATCH, без SWR и без смены аккаунта.

`WEB-itinvent/frontend/src/contexts/PreferencesContext.jsx:176` dedupe-ит refresh по account epoch, но его `ownsAccount` (`:181`) проверяет только аккаунт/epoch. Ни начало, ни успешное окончание `savePreferences` (`:250`, `:286`) не обесценивает более ранний refresh. Refresh после await безусловно заменяет preferences/local cache (`:190`) и pinned DB (`:192`).

Достижимый сценарий: начальная/`auth-changed` загрузка (`:217`, `:239`) получила старый snapshot, но её ответ задержан → пользователь сохраняет внешний вид → PATCH завершился, UI сообщил успех (`src/pages/account/hooks/useAccountSectionData.js:405`) → старый GET завершился → визуальные настройки и cache вернулись к старому значению. Account ownership guards здесь корректны, но оба запроса принадлежат одному аккаунту.

**Воспроизведение.** Node AST извлёк настоящие callback тела `refreshFromServer` и `savePreferences`. React setters/cache и transport заменены в памяти; theme normalization — identity для валидных `light/dark`, что не меняет проверяемую последовательность. GET заморожен, PATCH подтверждён, затем возвращён старый GET:

```text
preferences: PATCH_confirmed=dark; delayed_GET=light;
server=dark; state=light; cache=light
```

Exit=0. Синтетическое `server` — состояние transport harness, не живой backend. Доказано применение старого GET после подтверждённого сохранения; фактические частота/длительность в production не измерялись.

**Минимальное исправление.** Generation для чтения/изменения настроек в пределах аккаунта: invalidate старый refresh при старте mutation и не публиковать его success/error/finally после смены поколения. Для возможных одновременно разрешённых PATCH определить сериализацию или field/version reconciliation; одного account epoch недостаточно.

**Приёмка.** В локальном браузерном контуре заморозить GET, сохранить theme/layout, подтвердить PATCH и отпустить GET: state, cache и видимый UI сохраняют подтверждённое значение. Добавить ошибку PATCH при overlapping refresh и убедиться, что rollback не отменяет более свежее подтверждённое изменение. Account/logout regressions должны сохранить уже имеющуюся защиту.

## Проверки, отвергнутые подозрения и ограничения

- Выполнено пять diagnostic scenarios: два пути утраты delegates, late PC response с POST capture, server-normalization absences, late preferences GET. Финальные запуски каждого сценария — exit=0. Диагностический код передавался через stdin; новых исходников/тестовых файлов не создано.
- Ранний объединённый Node probe после успешной проверки failed-delegates ветки завершился exit=1: harness не объявил optional notification callbacks диалога. После добавления этих context bindings cleaning/preferences проверены отдельным успешным запуском; failed-delegates проверен отдельно с exit=0. Это ошибка harness, не дополнительный баг приложения. Первая проверка доступности parser также имела синтаксическую опечатку в `node -e`, исправленную в subsequent stdin probes.
- Прочитаны существующие `PreferencesContext.test.jsx`, `Dashboard.test.jsx`, `Statistics.test.jsx`; suite не запускался. Последний мокает `PcRemainingDialog` целиком (`src/pages/Statistics.test.jsx:24`) и сам по себе не может подтвердить исправление XFE-02.
- Общая generation guard в `Statistics.jsx:259` уже защищает обычную загрузку вкладки от ответа старого периода; blanket finding «у всей статистики нет stale guard» отвергнут. XFE-02 относится к отдельному диалогу с собственными setters.
- `NotificationChannelsSettingsCard.jsx:132` блокирует switches при loading/saving/loadError; один только per-field version код не доказывает достижимую обычным UI параллельную гонку. Нового finding на этом основании нет.
- Сервер экспорта статистики явно документирует глобальный export по умолчанию (`backend/api/v1/json_operations.py:687`), а API caller не передаёт `db_name` (`frontend/src/api/json_client.js:252`). Несовпадение с текущей scoped view требует продуктового решения; без него намеренный global export не объявлен новым подтверждённым дефектом. Права экспорта на реальных пользователях не проверялись.
- Не выполнялись полный frontend/backend suite, browser E2E, production build, HTTP probes, SQL/COM/LDAP, миграции, .env reads/changes, запуск/остановка процессов и деплой. Данные о производительности/ресурсах production не получены; новые p95/OOM утверждения не делаются.

Изменён только этот отчёт. Все четыре пункта требуют отдельной реализации и локальной boundary-приёмки; исправления и выкладка в рамках аудита не выполнялись.
