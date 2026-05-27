# HUB-IT Mobile (Expo, Android) — чеклист

План: [.cursor/plans/hub-it_mobile_android](../..) (или актуальный plan в Cursor).  
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
- [ ] Проверен `wss://` до `/api/v1/chat/ws` через IIS (ручной smoke с wscat или web)
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
- [x] Guard: без токена → login; с токеном → `(tabs)`

### 2.2 Smoke auth

- [ ] Вход с prod/dev API на реальном Android (Expo Go или dev build)
- [ ] Refresh после истечения access (~15 мин) без повторного логина
- [ ] Logout очищает SecureStore и возвращает на login
- [ ] 2FA с внешней сети (если политика `external_only`) — проходит как в web

---

## Фаза 3 — Чат: ядро (MVP переписки)

### 3.1 Навигация и список

- [x] Tab «Чат» в `(tabs)/chat`
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
- [x] События: `chat.message.created`, `chat.conversation.updated`, `chat.snapshot` / unread
- [x] Heartbeat + reconnect с backoff
- [ ] Новое сообщение по WS появляется без pull-to-refresh (smoke на устройстве)

### 3.4 Smoke chat (фаза 3)

- [ ] Два аккаунта: отправка A→B и B→A в realtime
- [ ] Счётчик непрочитанного в списке обновляется
- [ ] Визуально сравнено с web chat в viewport ~390px

---

## Фаза 4 — Чат: parity с web (выбор «C», по приоритету)

Отмечайте по мере готовности; порядок рекомендуемый.

### 4.1 Медиа и действия с сообщениями

- [x] Отправка файлов/фото (`expo-image-picker`, `document-picker`) → `POST .../messages/files`
- [ ] Chunked upload (если файлы > лимита) — upload-sessions API
- [x] Реакции — `POST .../reactions`
- [x] Пересылка — `POST .../messages/forward`
- [ ] Удаление сообщения — `DELETE .../messages/{id}`

### 4.2 Группы и участники

- [x] Создание группы — `POST /chat/conversations/group`
- [ ] Участники: add/remove/roles (по API web)
- [ ] Аватар группы — upload

### 4.3 Поиск и AI

- [x] Поиск по сообщениям в диалоге
- [x] Список AI-ботов + открытие диалога с ботом
- [ ] Confirm/cancel AI actions (API есть, UI — позже)

### 4.4 Push (опционально, конец фазы 4)

- [x] `expo-notifications` + разрешения Android 13+ (кнопка в настройках)
- [x] `PUT /settings/notifications/native-push-token` (`platform: android`)
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
- [ ] Собран и проверен APK на устройстве (EAS `preview` или `dist/hubit-mobile-debug.apk`)
- [ ] Иконка и splash (бренд HUB-IT / как web)
- [ ] `android.package` согласован с Firebase (если push)

### 6.2 Финальный regression

- [ ] Auth + 2FA + refresh + logout
- [ ] Чат: список, thread, WS, (отмеченные пункты фазы 4)
- [ ] Настройки: профиль, пароль, выход
- [ ] Нет токенов в логах / plain storage
- [ ] `pytest -q tests` (backend) зелёный
- [ ] `AGENTS.md`, `MOBILE_HUB_CHECKLIST.md`, `mobile-hub/README.md` актуальны

---

## Вне scope v1 (не блокирует релиз)

- iOS
- Passkey / WebAuthn в mobile UI
- Тёмная тема (нет переключателя в настройках v1)
- Почта, задачи, scan, database, admin settings web
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

## Прогресс (заполняйте вручную)

| Фаза | Статус | Дата |
|------|--------|------|
| 0 Backend auth | ✅ код | 2026-05-26 |
| 1 Scaffold + theme | ✅ код | 2026-05-26 |
| 2 Auth UI | ✅ код (smoke — вручную) | 2026-05-26 |
| 3 Chat core | ✅ код (smoke — вручную) | 2026-05-26 |
| 4 Chat parity | 🟡 частично | 2026-05-26 |
| 5 Settings | ✅ код (smoke — вручную) | 2026-05-26 |
| 6 Release | ⬜ | |
