# Проверка исправлений mobile-hub после аудита 13.11.2026

Итоговая повторная проверка: 13.11.2026, после правок 09:26–10:30. Проверка read-only: код не изменялся, production не затрагивался.

Предыдущая версия документа фиксировала 12 закрытых дефектов и 2 частичных (MB-02, MB-14). После последних правок закрыты все 14.

## 1. Короткий итог

Из 14 дефектов отчёта **закрыты все 14**: MB-01…MB-14.

Проверки после последних изменений:

- `npm run lint` (`tsc --noEmit`) — exit 0.
- **25 целевых Jest-наборов, 698 тестов — passed** (offline prep, snapshot cache, logout, auth biometric, hub realtime, chat screens/thread/state, push, tasks, mail, nav unread, connectivity, feed, database, offline queue, attachments).
- `pytest -q tests/test_app_settings_service.py tests/test_user_settings_theme.py` — **13 passed**.
- Устройство/эмулятор/APK не запускались; тесты и статический разбор не заменяют device-проверку.

## 2. Матрица исправлений

| ID | Статус | Что сделано | Замечание |
|---|---|---|---|
| MB-01 | ✅ закрыт | `nativeCollectionSignature` + сравнение ключей без `limit/offset`; старый снимок читается и переподписывается (`nativeSnapshotCache.ts:418-460,479-507`) | Тесты на эквивалентность ключей и чтение старого снимка проходят |
| MB-02 | ✅ закрыт | Серверная очистка идёт с зафиксированными на момент logout credentials через plain axios, без общего интерсептора (`logout.ts:41-79`) | Ранее найденная регрессия «logout закрывает сессию следующего пользователя» закрыта; тест в `logout.test.ts` |
| MB-03 | ✅ закрыт | На старте владелец отпечатка сверяется с `sessionUserId`, при несовпадении credential отключается (`AuthContext.tsx:339-354`) | Если `sessionUserId` отсутствует, проверка пропускается — edge-случай |
| MB-04 | ✅ закрыт | Если дата не менялась, отправляется исходный `task.due_at`; 18:00 ставится только при смене даты | `slice(0, 10)` всё ещё может показать UTC-дату — вне этого дефекта |
| MB-05 | ✅ закрыт | `useThreadRealtime` повторяет `subscribeConversation` на каждом `connected`; `chatSocket` replay-ит подписки | Дублирующий subscribe безвреден для backend, но лишний кадр |
| MB-06 | ✅ закрыт | Watchdog 15 с, `abandonSocket` в `onerror`, сброс таймера в `onopen/onclose` | Нужен device-тест с «зависшим» TLS |
| MB-07 | ✅ закрыт | 4403 убран из `NON_RECONNECTABLE_CLOSE_CODES` | `resume()` всё ещё не подключается, если `reconnectEnabled=false` по другой причине (нет токена) |
| MB-08 | ✅ закрыт | `reader_user_id` проверяется; собственное чтение не каскадируется на свои сообщения | Подсчёт `read_by_count` в группах остаётся приблизительным |
| MB-09 | ✅ закрыт | Проверка активного диалога перенесена внутрь `markRead` (`NativeChatThreadScreen.tsx:502`) | Нужен device-тест с перекрытым тредом |
| MB-10 | ✅ закрыт | Текст неудачного quick reply сохраняется/дописывается в существующий черновик чата (`notificationBackgroundTask.ts:43-47`) | Покрыто тестом push background |
| MB-11 | ✅ закрыт | `restore` не применяется, если был входящий share | Нужен device-тест, unit-тест есть |
| MB-12 | ✅ закрыт | Reply/forward с `draftId` сверяются с серверным черновиком и применяют серверный текст (`NativeMailComposeScreen.tsx:348-366`) | При офлайне локальный текст всё ещё может быть старше серверного |
| MB-13 | ✅ закрыт | Backend принимает `absences` и `/monitoring`; дефолт `absences` добавлен (`settings_service.py:26`) | Дефолты web/mobile синхронизированы |
| MB-14 | ✅ закрыт | После `saveEditor` обновляются и каталог, и detail-снимок (`NativeEquipmentDetailScreen.tsx:641-651`); focus-refresh списка/карточки | Тесты на возврат и офлайн-снимок проходят |

## 3. Ранее найденная регрессия logout закрыта

В прошлом проходе серверная очистка при logout могла уйти с токеном следующего пользователя: локальная очистка выполнялась мгновенно, а фоновая — через общий `apiClient`, который подставляет текущий access-токен.

Сейчас `revokeCapturedSession` (`mobile-hub/src/auth/logout.ts:41-79`) использует credentials, снятые в начале logout:

- `Authorization` и `clientDeviceId` фиксируются до локальной очистки;
- push-token, biometric device и `/auth/logout` отправляются plain `axios`, а не через интерсептор;
- локальный logout не зависит от сети, серверная часть остаётся best-effort.

Добавлен тест `logout.ts` → `logout.test.ts`: очистка с зависшей сетью и немедленный вход B не затрагивают сессию B.

## 4. MB-14: офлайн-снимок карточки

`saveEditor` (`NativeEquipmentDetailScreen.tsx:631-658`) после `updateEquipment`:

1. обновляет `equipmentRef` и состояние карточки;
2. патчит элемент каталога через `patchNativeEquipmentCatalogItem`;
3. ставит в очередь запись detail-снимка через `updateNativeEquipmentDetailSnapshot`.

Это закрывает сценарий «сохранить карточку → сразу уйти в офлайн/перезапустить приложение → открыть старую версию». Дополнительно список и карточка обновляются по focus-refresh.

## 5. MB-13: `absences` по умолчанию

Backend принимает `absences`, и дефолтный набор секций дашборда теперь включает её (`settings_service.py:26`). Мобильный и web-дефолты больше не расходятся: после первого онлайн-обновления секция не исчезает.

## 6. MB-10: существующий черновик

`notificationBackgroundTask.ts:43-47` теперь дописывает текст quick reply к существующему черновику, а не только создаёт новый. Текст из push не теряется, если у пользователя уже был черновик в этом чате.

## 7. Тесты

Что покрыто и проходит:

- offline prep: запись и пагинация;
- snapshot cache: эквивалентность ключей, чтение старого снимка;
- logout: локальная очистка и отсутствие влияния на следующего пользователя;
- auth biometric: проверка владельца;
- hub realtime: watchdog/4403;
- thread realtime: подписка и active conversation;
- chat state: read receipts;
- push background: salvage и дописывание черновика;
- task draft: share vs draft;
- mail: черновики и quick reply;
- feed/database: focus-refresh списка, поста и карточки;
- equipment detail: обновление каталога и detail-снимка;
- offline queue, attachments dedup, nav unread, connectivity recovery.

Что остаётся только для device-прогона:

- перекрытый чат и `markRead` при возврате из фона;
- «зависший» TLS и watchdog;
- logout с зависшей сетью и немедленным входом B;
- сохранение карточки → офлайн-перезапуск → актуальный снимок;
- push quick reply при уже существующем черновике.

Почтовые тесты дают `act(...)` warnings (не падения); стоит убрать шум, чтобы реальные предупреждения не терялись.

## 8. Ограничения

- Проверка статическая + unit/integration тесты; APK и реальное устройство не использовались.
- Поведение `freezeOnBlur` и перекрытых экранов Expo Router требует device-подтверждения.
- Оценка «исправлено» означает соответствие коду и тестам, а не подтверждённый пользовательский сценарий на устройстве.
