# HUB-IT Mobile (Expo, Android) — чеклист

План: [MOBILE_HUB_WORKING_PROTOTYPE_PLAN.md](./MOBILE_HUB_WORKING_PROTOTYPE_PLAN.md).

Фактическая приёмка: [MOBILE_HUB_PROTOTYPE_ACCEPTANCE.md](./MOBILE_HUB_PROTOTYPE_ACCEPTANCE.md).
Стек: **Expo**, **только Android**, UI: **React Native Paper + токены** (`hubTheme`, `chatTokens`, `officeTokens`).

Как пользоваться: идите сверху вниз; не переходите к следующей фазе, пока не отмечены все пункты текущей (кроме явно помеченных «опционально»).

---

## Фаза 0 — Подготовка и backend (auth для mobile)

### 0.1 Backend: Bearer-токены в JSON

- [x] Добавить распознавание `X-Auth-Client: mobile` в auth-роутерах
- [x] При mobile: в ответе `LoginResponse` / `RefreshResponse` — непустые `access_token` и `refresh_token` (не только cookies)
- [x] Затронуты: `login`, `verify-2fa`, `verify-2fa-login`, `refresh` (passkey — опционально, без UI в v1)
- [x] `logout`: принимает `Authorization: Bearer` + `refresh_token` в body (без cookie)
- [x] Web-поведение (cookies, `access_token: null` в JSON) **не сломано**
- [x] Тест: `tests/test_auth_mobile_delivery.py` — login с mobile-заголовком возвращает токены
- [x] Обновить [AUTH_SECURITY_STACK.md](./AUTH_SECURITY_STACK.md) — раздел Mobile client

### 0.2 Документация и окружение

- [x] `EXPO_PUBLIC_API_URL` задокументирован (prod `https://hubit.zsgp.ru/api/v1`, dev LAN при необходимости)
- [x] Проверен `wss://` до `/api/v1/chat/ws` через IIS: production-маршрут доступен и без Bearer ожидаемо отвечает HTTP 401
- [ ] Backend dev запускается: `uvicorn` на `:8001` (см. [AGENTS.md](../../AGENTS.md))

---

## Фаза 1 — Scaffold `mobile-hub/`

### 1.1 Проект

- [x] `mobile-hub/` создан: `npx create-expo-app` + TypeScript + **expo-router**
- [x] `app.config.ts`: `android.package`, имя приложения, `EXPO_PUBLIC_API_URL`
- [x] `.gitignore` для `node_modules`, `.expo`, локальных env
- [x] `mobile-hub/README.md` — установка, `npx expo start`, dev build
- [x] Раздел в [AGENTS.md](../../AGENTS.md) — путь `mobile-hub/`

### 1.2 Дизайн-система (токены + Paper)

- [x] `src/theme/hubTheme.ts` — палитра из [theme/index.js](../../WEB-itinvent/frontend/src/theme/index.js)
- [x] `src/theme/chatTokens.ts` — порт [chatUiTokens.js](../../WEB-itinvent/frontend/src/components/chat/chatUiTokens.js) (light)
- [x] `src/theme/officeTokens.ts` — порт [officeUiTokens.js](../../WEB-itinvent/frontend/src/theme/officeUiTokens.js)
- [x] `PaperProvider` + MD3LightTheme, primary/background из `hubTheme`
- [x] `mobile-hub/DESIGN.md` — таблица «токен → hex → экран»
- [x] Базовые компоненты: `HubScreen`, `HubCard`, `HubButton`, `HubTextField`
- [x] `BrandedLoader` — аналог web loader (primary на `pageBg`)

### 1.3 API-слой

- [x] `src/api/client.ts` — axios/fetch, **без** `withCredentials`
- [x] Заголовок `X-Auth-Client: mobile` на auth-запросах
- [x] `Authorization: Bearer` на защищённых запросах
- [x] Interceptor 401 → `POST /auth/refresh` → повтор запроса
- [x] `src/auth/tokenStore.ts` — **expo-secure-store** (не plain AsyncStorage)

---

## Фаза 2 — Авторизация (UI)

### 2.1 Экраны

- [x] `(auth)/login` — username/password, стиль office (`officeTokens`)
- [x] Обработка `2fa_required` → экран TOTP / backup code
- [x] Обработка `2fa_setup_required` — экран `setup-required` + ссылка на web
- [x] После успеха: `GET /auth/me`, сохранение user + permissions
- [x] Guard: без токена → login; с токеном → `(main)`

### 2.2 Smoke auth

- [ ] Вход с prod/dev API на реальном Android (Expo Go или dev build)
- [x] Автоматический refresh без повторного логина проверен через production API после принудительного 401 на access token
- [x] Logout возвращает на login, удаляет access/refresh и не запускает новый reconnect; стабильный device ID сохраняется ожидаемо
- [ ] 2FA с внешней сети (если политика `external_only`) — проходит как в web

### 2.3 Главная и задачи

- [x] Главная читает `/hub/dashboard.summary`, включая реальные нули, и имеет loading/error/retry состояния
- [x] Responsive WEB-parity: нижняя навигация 64 px при обычном шрифте, адаптивная высота при увеличенном шрифте, активная icon capsule, Dashboard «Сегодня / быстрые действия / Сейчас важно»
- [x] Dashboard и Tasks проверены в viewport 360×800, 390×844 и 412×915; вкладка «Задачи» открыта реальным кликом, корневого горизонтального переполнения нет
- [x] Список задач показывает статус, приоритет, срок, роль и unread comments
- [x] Карточка задачи показывает детали, участников, вложения, комментарии и status log
- [x] Workflow-действия строятся только по `task.capabilities`
- [x] 409/412 показывает конфликт и перечитывает актуальную задачу
- [ ] Smoke задач на реальном Android минимум для исполнителя и контролёра

---

## Фаза 3 — Чат: ядро (MVP переписки)

### 3.1 Навигация и список

- [x] Экран «Chat» в `(main)/chat`
- [x] `GET /chat/conversations` — список диалогов
- [x] `ChatConversationRow` — аватар, имя, превью, время, unread (цвета из `chatTokens`)
- [x] Tap → stack: экран переписки (`conversationId`)
- [x] `POST /chat/conversations/direct` — новый личный чат (минимальный UI: выбор пользователя)

### 3.2 Переписка (текст)

- [x] `GET /chat/conversations/{id}/messages` — история
- [x] `ChatBubble` — own `#d9fdd3` / other `#ffffff`, meta (время, галочки прочитано)
- [x] `ChatComposer` — ввод + отправка `POST .../messages`
- [x] Фон thread `#b8d4a8` (или wallpaper opacity как web)
- [x] `ChatHeader` — имя, назад, online/presence (если есть в API)

### 3.3 WebSocket

- [x] `src/chat/chatSocket.ts` — порт логики [chatSocket.js](../../WEB-itinvent/frontend/src/lib/chatSocket.js)
- [x] URL: `wss://{host}/api/v1/chat/ws` + Bearer в handshake
- [x] `chat.subscribe_inbox`, `chat.subscribe_conversation`
- [x] События: `chat.message.created`, `chat.message.updated`, `chat.message.deleted`, `chat.conversation.updated`, `chat.snapshot` / unread
- [x] Heartbeat + reconnect с backoff
- [ ] Новое сообщение по WS появляется без pull-to-refresh (smoke на устройстве)

### 3.4 Smoke chat (фаза 3)

- [ ] Два аккаунта: отправка A→B и B→A в realtime
- [ ] Счётчик непрочитанного в списке обновляется
- [x] Визуально сравнено с web chat в viewport 360×800, 390×844 и 412×915; общие chat-токены, заголовок, поиск, фильтры и нижняя навигация проверены

---

## Фаза 4 — Чат: parity с web (выбор «C», по приоритету)

Отмечайте по мере готовности; порядок рекомендуемый.

### 4.1 Медиа и действия с сообщениями

- [x] Отправка файлов/фото (`expo-image-picker`, `document-picker`) → `POST .../messages/files`
- Вне scope v1: chunked upload для файлов больше лимита через upload-sessions API
- [x] Реакции — `POST .../reactions`
- [x] Пересылка — `POST .../messages/forward`
- [x] Удаление сообщения — `DELETE .../messages/{id}`; ответ и realtime-событие переводят bubble в серверный tombstone

### 4.2 Группы и участники

- [x] Создание группы — `POST /chat/conversations/group`
- Вне scope v1: управление участниками add/remove/roles
- Вне scope v1: загрузка аватара группы

### 4.3 Поиск и AI

- [x] Поиск по сообщениям в диалоге
- [x] Список AI-ботов + открытие диалога с ботом
- Вне scope v1: confirm/cancel AI actions; API остаётся доступен в полной web-версии

### 4.4 Push (опционально, конец фазы 4)

- [x] `expo-notifications` + разрешения Android 13+ (кнопка в настройках)
- [x] `PUT /settings/notifications/native-push-token` (`platform: android`)
- [x] Стабильный installation ID, token rotation/revoke и проверка backend `configured/push_enabled`
- [x] Tap по notification payload открывает нужный Chat route
- [ ] Push на новое сообщение в фоне (smoke)

---

## Фаза 5 — Настройки (минимум)

- [x] Tab «Настройки» — стиль office (`officeTokens`)
- [x] Профиль: `GET /auth/me` — имя, email, роль (read-only для `full_name` в v1)
- [x] Аватар: upload `POST /auth/me/avatar`, delete, отображение URL с cache-bust
- [x] Смена пароля — `POST /auth/change-password`
- [x] Кнопка «Выйти» — logout API + очистка store

### Smoke settings

- [ ] Смена пароля → повторный вход новым паролем
- [ ] Аватар виден в чате после обновления

---

## Фаза 6 — Релиз и качество

### 6.1 Сборка Android

- [x] `eas.json` + `scripts/build-apk.ps1` (preview → APK, production → AAB)
- [x] Собран локальный standalone `dist/hubit-mobile-preview.apk`; package/version/SDK/signature/JS bundle проверены
- [x] Собран локальный development/debug `dist/hubit-mobile-debug.apk`; package/version/SDK/signature проверены, для запуска требуется Metro
- [ ] APK установлен и проверен на реальном устройстве и эмуляторе — локальный VMware-гость не предоставляет nested virtualization; нужен физический Android либо другой emulator host
- [x] Иконка и splash используют бренд HUB-IT
- [ ] `android.package` согласован с Firebase (если push)

### 6.2 Финальный regression

- [ ] Auth + 2FA + refresh + logout
- [ ] Чат: список, thread, WS, (отмеченные пункты фазы 4)
- [ ] Настройки: профиль, пароль, выход
- [x] В tracked-файлах и APK-артефакте не обнаружены credentials; токены хранятся через SecureStore
- [ ] `pytest -q tests` (backend) зелёный
- [x] Профильный backend regression для mobile auth/tasks/Chat push зелёный: 109/109
- [x] Mobile lint и полный regression 65 наборов / 217 тестов зелёные для source 1.1.7
- [ ] Полный frontend regression: 537/538 файлов и 3 127 passed, 2 skipped; один Docflow timing-сценарий упал в общем запуске, но сразу прошёл изолированно 1/1 — inter-suite нестабильность не скрыта
- [x] Полный auth regression после mobile→WebView bridge зелёный: 93/93
- [x] Матрица 40 responsive web-маршрутов и permission gates зафиксирована в `MOBILE_HUB_WEB_PARITY_MATRIX.md`
- [x] Основной Android-маршрут после login открывает полноэкранный WebView без внешнего браузера и отдельного входа
- [x] Одноразовый session bridge: code TTL 60 секунд, hashed runtime key, fragment вместо query/referrer, HttpOnly cookies
- [x] Source 1.1.7 передаёт успешный session exchange напрямую в native WebView; 15/20-секундные тайм-ауты исключают вечное «Подключаем HUB-IT»
- [x] Preview/debug source 1.1.7 не регистрирует неподтверждённые HTTPS App Links; release opt-in разрешён только после permanent signer + production `assetlinks.json`
- [x] После успешного 2FA доступен добровольный opt-in входа по отпечатку; локальный credential защищён Android Keystore / SecureStore authentication
- [x] APK-only offline-кэш шифрует ранее загруженные GET-ответы AES-GCM, блокирует изменения и не активируется в обычной PWA
- [x] Кнопка «Подготовить автономный режим» заранее обновляет разрешённые read-модели Главной, Задач и Почты и подтверждает только фактически записанные разделы
- [x] Android validated-connectivity независимо от `navigator.onLine` переводит portal в read-only и снимает режим только после успешного backend bootstrap с backoff; PWA остаётся на browser events
- [x] В APK-настройках доступна ручная privacy-safe проверка сети: validated online, тип транспорта и metered без SSID/IP/оператора
- [x] Из APK-настроек открываются app-specific настройки батареи/фона с OEM fallback, без автоматического запроса исключения из оптимизации
- [x] Общий WebView обёрнут в safe-area и keyboard avoidance; нижняя Android navigation bar скрыта
- [x] Vite build и IIS publish защищены от незаменённого `__HUBIT_CANONICAL_HOST__`; изолированная production-сборка и canonical redirect проверены
- [ ] Вручную проверить отпечаток, системные inset/navigation bar, клавиатуру в Chat/почте/задачах и offline cold start на реальном Android
- [x] `scripts/device-smoke.ps1 -Interactive` формирует обезличенный schema v2 отчёт с явными `passed/failed/not_run` для biometric, подготовки offline-списков, cache miss/recovery, Android validated network, app-specific battery settings, 20 lifecycle-циклов, keyboard/system-bars и автоматически требует Android API 33+
- [x] APK publish требует совпадающий build audit, блокирует debug-preview signer по умолчанию и не допускает незакреплённую смену сертификата канала
- [x] Подготовка постоянного signer автоматизирована без CLI-пароля: пути вне Git, RSA-4096/PKCS12, два проверяемых backup и разные тома по умолчанию
- [x] Mobile migration preflight проверяет Alembic head offline и production-состояние только в PostgreSQL read-only transaction без вывода connection details
- [x] Migration apply harness закрепляет exact revision, обязательный проверяемый backup и postflight; destructive auto-downgrade отсутствует
- [x] Production migration `0100 → 0101 → 0102` применена 2026-08-23 с проверенным custom dump и postflight `already_current`
- [ ] Все 40 строк page-by-page матрицы вручную приняты на реальном Android
- [x] `AGENTS.md`, `MOBILE_HUB_CHECKLIST.md`, `mobile-hub/README.md` актуальны

---

## Вне scope v1 (не блокирует релиз)

- iOS
- Passkey / WebAuthn в mobile UI
- Тёмная тема (нет переключателя в настройках v1)
- Почта, Scan Center, database, admin settings и остальные расширенные web-модули
- Редактирование `full_name` в приложении (нет API)

---

## Быстрые команды

```powershell
# Backend (из WEB-itinvent/backend)
python -m uvicorn main:app --reload --port 8001

# Mobile (после создания mobile-hub/)
cd mobile-hub
npm install
npx expo start
```

---

## Прогресс

| Фаза | Статус | Дата |
|------|--------|------|
| 0 Backend auth | ✅ код | 2026-05-26 |
| 1 Scaffold + theme | ✅ код | 2026-05-26 |
| 2 Auth UI + lifecycle | ✅ код, autotests и production Web smoke; device/2FA smoke ожидается | 2026-08-22 |
| 2.3 Главная + задачи | ✅ код, autotests и WEB-parity viewport smoke; role smoke ожидается | 2026-08-22 |
| 3 Chat core | ✅ код и autotests; realtime smoke ожидается | 2026-08-22 |
| 4 Chat parity + push | 🟡 UI/код прототипа готовы; FCM/device smoke заблокирован | 2026-08-22 |
| 5 Settings | ✅ код и viewport smoke; device smoke ожидается | 2026-08-22 |
| 6 Release | 🟡 standalone APK собран; EAS/device acceptance ожидается | 2026-08-22 |
