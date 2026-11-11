# Password Vault — аудит страницы «Пароли», защита и anti-screenshot план

Дата: 2026-09-17.
Охват: Web (`WEB-itinvent/frontend`, `WEB-itinvent/backend`) + Desktop WPF/WebView2. Mobile Expo уже имеет защиту (`expo-screen-capture` / `FLAG_SECURE`) и в объем работ не входит.
Режим deterrence: строгий. Приоритет старта: Anti-screenshot UX.
Скиллы: `security-best-practices` (FastAPI + React), `security-threat-model`, `insecure-defaults`, `sharp-edges`.

> Честная рамка: запретить скриншоты в браузере технически невозможно (PrintScreen, Snipping Tool, фото телефоном, DevTools, RDP-запись). Web дает только deterrence: скрытие, blur-оверлей, watermark, no-print, очистка буфера, аудит. Полный запрет возможен только нативно: Mobile `FLAG_SECURE` (уже есть), Desktop `SetWindowDisplayAffinity(WDA_MONITOR)`.

## 1. Итог

- Худшие хрупкие места: `PATCH /passwords/{id}` без unlock для Web (только mobile требует unlock), rate-limit `5/300с` на `user+IP` обходится сменой IP, passphrase деривируется голым `SHA256` без KDF, `list_entries` без пагинации + `LIKE %...%` по `tags_json`, буфер обмена никогда не очищается, раскрытый пароль 30 с висит при `blur/hidden`, CSP нет, `autocomplete` не выключен, печать раскрытого пароля разрешена.
- Разделение «list без пароля / reveal с паролем» подтверждено: list отдает только `password_configured: bool`, пароль — только `POST /{id}/reveal` после `require_unlocked` + audit `reveal.show/reveal.copy`.
- Auth Web — cookie (`withCredentials: true`), токенов в `localStorage` нет; в `localStorage` только `user` + `selected_database`. Vault-секрет живет только в React-state + метка `unlocked_until` в `sessionStorage`.
- План ниже: Фаза 1 — Anti-screenshot UX (приоритет), Фаза 2 — критические дыры бэкенда, Фаза 3 — оптимизация и заголовки, Фаза 4 — аудит/DLP и доки. Плюс чек-листы приемки.

## 2. Что проверено (evidence)

### 2.1 Frontend Web

- `WEB-itinvent/frontend/src/pages/Passwords.jsx:200,224,217,76-83,203` — `revealedPasswords` в `useState`, `hideTimersRef`, `generatedPassword`, `form.password`.
- `Passwords.jsx:489-502` — `hidePassword` / `scheduleHide` по `PASSWORD_HIDE_MS`.
- `Passwords.jsx:542-575` — `revealEntry(entry, purpose)`: `POST /passwords/:id/reveal`, при `purpose === 'copy'` — `copyPassword(payload.password)`, иначе — показ + `scheduleHide`. Аудит обновляется через `loadAudit()`.
- `Passwords.jsx:504-511,581-590,706-714` — `copyPassword` = `navigator.clipboard.writeText` без очистки; `handleCopyLogin` копирует `entry.login` без `reveal`; `copyGeneratedPassword` — та же проблема.
- `frontend/src/components/passwords/passwordVaultUtils.js:1,61-80` — `PASSWORD_HIDE_MS = 30_000`, `sessionStorage['itinvent_password_vault_unlock_until:<userId>']` (только метка времени).
- `frontend/src/api/client.js:219-226` — `axios.create({ withCredentials: true })`; `client.js:271,386` — `localStorage` только для `selected_database` / `user`.
- `frontend/src/contexts/AuthContext.jsx:171,193,353-379` — профиль в `localStorage`, silent-refresh cookie по интервалу + `visibilitychange`.
- `components/passwords/PasswordEntryDetail.jsx:58,145-186` — `masked = '••••••••••••'`, кнопка «Скрыть» есть, автоскрытия по `blur/visibilitychange` нет.
- `Passwords.jsx:270-273` — очистка таймеров только на unmount; `visibilitychange/blur/document.hidden` не слушаются.
- `public/web.config:134-136` — есть `nosniff`, `SAMEORIGIN`, `no-referrer`. Нет `Content-Security-Policy`, `Permissions-Policy`, `frame-ancestors` в заголовке.
- `frontend/index.html` — нет `<meta CSP>`. Единственный CSP в проекте — песочница почты `mailHtmlSandboxDocument.js:3-15`, к паролям не относится.
- `SRI/integrity`, `Trusted Types` — 0 совпадений в `frontend/src`. `dangerouslySetInnerHTML` в passwords-контуре нет; `login/description/tags` рендерятся через JSX-эскейп (`PasswordEntryDetail.jsx:77-79,114-126`).

### 2.2 Backend

- `WEB-itinvent/backend/api/v1/passwords.py:95-466` — карта: `list/reveal/unlock/*` требуют `passwords.read`, `create/update/archive/groups` — `passwords.write`, `GET /audit` — только `get_current_admin_user`.
- `services/password_vault_service.py:162-176` — `_entry_to_response` отдает только `password_configured: bool`, без секрета. Пароль только в `PasswordVaultRevealResponse` (`models/password_vault.py`), выдается в `reveal_entry:733-758` после `require_unlocked` + audit.
- `password_vault_service.py:30,501-527,709-731` — unlock TTL 300 с, два ключа `user:session` + `user:user` (`_unlock_storage_keys:122-127`), `get_unlocked_until` берет `max()`, `require_unlocked` бросает `403 "Password vault unlock is required"`.
- `password_vault_service.py:475-491` — rate-limit 5/300 с на `user+IP`; успех счетчик не сбрасывает.
- `password_vault_service.py:493-707` — пути unlock: TOTP/backup (`unlock:544-558`), setup 2FA (`start/verify_unlock_2fa_setup`), passkey/WebAuthn (`passwords.py:319-433`, строгое сравнение сессии), mobile-biometric (`x-auth-client: mobile` + `x-client-device-id`).
- `services/secret_crypto_service.py:36-67,108-141` — Fernet, `PASSWORD_VAULT_KEY` + `LEGACY` только на decrypt, passphrase → один `SHA256` без соли/итераций, placeholder-чек только при `APP_ENV=production:28-33`.
- `passwords.py:55-60`, `password_vault_service.py:206-228` — audit пишет `ip/user-agent` на `create/update/archive/unlock*/reveal`, не пишет на `list`.

### 2.3 Mobile (референс, уже хорошо) и Desktop

- `mobile-hub/src/screens/passwords/NativePasswordsScreen.tsx:5,39-40` — `expo-screen-capture`, `REVEALED_PASSWORD_TTL_MS = 30_000`.
- `mobile-hub/src/privacy/AppPrivacyShield.tsx:8-13` — `preventScreenCaptureAsync` при `AppState !== 'active'`.
- `mobile-hub/src/api/passwordsApi.ts`, `passwordsApi.test.ts` — контракт reveal/unlock покрыт тестами.
- `desktop/` — WPF/WebView2-оболочка без `SetWindowDisplayAffinity`/`WDA_*` (grep пустой); печать через WebView2 print UI.

## 3. Проблемы и хрупкие места

### 3.1 Critical

1. Асимметрия unlock на update — `api/v1/passwords.py:146-152`: `require_unlocked` только для `x-auth-client: mobile`. Web с `passwords.write` меняет запись включая `password` (`update_entry:445-452`) без активного unlock. Нарушение `FASTAPI-AUTHZ-001`.
2. Криптодеривация без KDF — `secret_crypto_service.py:54-55`: произвольный passphrase → один `SHA256`. При слабом `PASSWORD_VAULT_KEY` — быстрый брутфорс. Рядом `scripts/password_vault_bruteforce.py`, `diagnose_password_vault_crypto.py` — проверить отсутствие в prod-артефакте.
3. Fail-open при `APP_ENV != production` — плейсхолдеры (`change_me` и т.д.) отклоняются только в production (`_reject_production_placeholder`). Если Windows-деплой стоит в `development` — плейсхолдер молча работает. `insecure-defaults`.

### 3.2 High

4. Rate-limit обходится сменой IP — ключ `user:IP` (`_unlock_rate_key`), общего bucket на user нет, на `reveal` отдельного throttle нет. После 5 фейлов легитимный код тоже блокируется до конца окна. `sharp-edges`.
5. Unlock переживает сессию — пишется `user:user` + `sessionless`-fallback (`_session_key`), читается `max()` из двух. Нет ручного `lock`/revoke при logout/смене сессии.
6. Буфер обмена не очищается — `Passwords.jsx:504-511,547-551`: `writeText(password)` без таймера затирания. Пароль остается в истории буфера Windows (`Win+V`), RDP, менеджерах буфера. `REACT-AUTH-001`.
7. Раскрытый пароль виден при сворачивании — нет `visibilitychange/blur → hidePassword`. 30 с таймер тикает при скрытой вкладке. Нет blur-оверлея. Любой XSS читает `revealedPasswords` из DOM/памяти.
8. Нет CSP — ни в `web.config`, ни в `index.html`. При единственном XSS весь vault читается. `REACT-CSP-001`, `FASTAPI-HEADERS-001`.

### 3.3 Medium

9. Нет пагинации + тяжелый поиск — `list_entries:230-292`: два `.all()` (все записи + все `tags_json`), `LIKE %q%` с ведущим `%` по `login/description/tags_json` без индекса; точный фильтр тега — уже в Python. Индексы только `(group,is_archived)`, `(login,is_archived)`.
10. Печать/выделение разрешены — `index.css:431-439` имеет `.no-print`, vault его не использует; `user-select:none` только для чата. Раскрытый пароль печатается как текст.
11. Autocomplete не выключен — vault-форма `Passwords.jsx:1023-1109` без `autoComplete="off/new-password"` (2FA-поле корректно `one-time-code`).
12. Offline-кэш метаданных — `client.js:312,327` + `mobileOfflineCache.js:113-127`: `/passwords` кэшируется (AES-GCM, IndexedDB, TTL 7 суток) только в `__HUBIT_MOBILE_APP__ + readOnly`. Пароля там нет, но `login/group/tags/description` лежат 7 дней.
13. Audit только админу — `passwords.py:457-461`. Обычный `read`-пользователь не видит даже своих `reveal`. `list` не аудитируется.
14. Enumeration по статусам — `404 Entry not found` vs `403 unlock required` vs `503 decrypt fail` различимы; unlock различает `2FA required / Invalid code / Too many`. Раскрывает факт 2FA/challenge, не пароль.
15. Генератор в памяти без таймера — `generatedPassword/form.password` живут до закрытия диалога, копируются той же неочищаемой `copyPassword`.

### 3.4 Low / hygiene

16. `audit.id` инкрементальный (перебор количества), записи — `uuid.hex` (ок).
17. Клиентского rate-limit/backoff на `reveal/unlock` нет, серверный `Retry-After` для vault не обрабатывается.
18. Нотификация «Пароль скопирован» раскрывает момент операции по времени.
19. `Permissions-Policy` (camera/mic/geolocation) отсутствует.

## 4. Скриншоты: строгий deterrence для Web + Desktop

### 4.1 Web (`Passwords.jsx`, `PasswordEntryDetail/List/MobileSheet`)

- `visibilitychange + window blur → hidePassword(all) + blur-overlay` («Скрыто — вернитесь на вкладку»), опционально требовать повторный unlock для повторного показа.
- `no-print` для раскрытого пароля + `@media print { .vault-secret { display: none } }`, перехват `beforeprint/afterprint → hide`.
- Watermark-лента поверх секрета: `username • дата/время • IP-маска` (deterrence + трассировка фото).
- `user-select: none` только на показанном секрете + блокировка `contextmenu/copy` именно на поле секрета (не на всей странице), кнопка «Копировать» остается единственным путем + аудит `reveal.copy`.
- `autocomplete="off"` на поиске, `autocomplete="new-password"` на create/edit, `spellCheck={false}`.
- Очистка буфера: после `copy` через N сек (дефолт 20–30 с, настраиваемо) затереть + тост «Буфер очищен».
- Маскирование по умолчанию + показ по клику с таймером 30 с (уже есть), добавить прогресс-бар оставшихся секунд.

### 4.2 Desktop WPF/WebView2

- `SetWindowDisplayAffinity(HWND, WDA_MONITOR)` для окна с vault за флагом (черный прямоугольник в скриншотах/шаринге). Проверить на WebView2 + RDP: на части конфигураций дает черный экран и в самом окне — тестировать на целевой ОС/драйвере.
- Дублировать Web-оверлей (иначе affinity без UX-подсказки выглядит как баг).
- GPO/инструкция: DLP-политика + аудит `reveal.copy/show` как юридическая мера (фото телефоном технически не остановить).

### 4.3 Что не делать

- «DRM через JS», блокировка клавиши PrintScreen (`keydown` не ловит ОС-комбинации), надежда на `getDisplayMedia`-детект.
- Блокировка копирования всей страницы (ломает UX и не дает безопасности).

## 5. Оптимизация (без смены поведения)

- Backend: пагинация `list_entries` (`limit/offset`, дефолт 100, max 500 как у audit), убрать ведущий `%` для точного тега; облако тегов — отдельным легким запросом с кэшем, а не вторым `.all()`.
- Frontend: оставить debounce 250 мс; `useMemo` для фильтра групп/тегов, виртуализация `PasswordEntryList` при >200 записей, точечный `setRevealedPasswords` вместо `loadEntries()` после каждого `reveal`.
- Сеть: `GET /passwords` не класть в `mobileOfflineCache` дольше сессии или исключить путь `/passwords` из кэшируемых (как `auth/download/export`).

## 6. Усиленная защита (после anti-screenshot)

- Унифицировать unlock: требовать `require_unlocked` для `PATCH/POST` с `password` и на Web, либо явно задокументировать исключение с риском.
- Rate-limit: второй bucket на `user` (без IP) + отдельный throttle на `reveal` (например 20/мин на user), сброс счетчика при успехе, `Retry-After` + клиентский backoff.
- Крипто: требовать канонический Fernet-ключ 32 байта, запретить `SHA256(passphrase)`-fallback в production (fail-secure); версионирование `fernet:v1:` + фоновое перешифрование вместо только-decrypt-fallback; проверить `APP_ENV` на prod.
- Сессии: кнопка «Заблокировать хранилище» (`DELETE /unlock` → удаление обоих ключей), авто-revoke при logout/terminateSession, привязка только к `session_id` без `user`-fallback (или флаг строгого режима).
- Аудит: `GET /audit?mine=1` для `passwords.read` (свои события), полный — админу; событие `list` сэмплированно.
- Заголовки: CSP минимум `default-src 'self'`, `script-src 'self'`, `object-src 'none'`, `frame-ancestors 'self'` через IIS + `Permissions-Policy: camera=(), microphone=(), geolocation=()`. `X-Forwarded-*` только от доверенных прокси.
- DLP-оргмеры: watermark + audit + инструкция «фото экрана = инцидент», алерты на аномалии `reveal` (ночь/множество IP).

## 7. План работ

### Фаза 0 — Безопасная подготовка (0.5 дня, read-only)

- [ ] Сверить runtime: `APP_ENV`, `PASSWORD_VAULT_KEY/LEGACY` заданы, `docs/openapi` закрыты, PM2/IIS конфиг, версии Starlette/python-multipart.
- [ ] Снять baseline: время `GET /passwords` при N=100/1000, p95 `POST reveal/unlock`, план запроса на тестовой БД.
- [ ] `scripts/pm2/health-check.ps1` без `-Repair`, оценка объема audit.

### Фаза 1 — Anti-screenshot UX, строгий (приоритет, 2–4 дня)

- [ ] `Passwords.jsx`: `visibilitychange/blur → hideAll + overlay`, `beforeprint → hide`, прогресс 30 с, `autocomplete/spellCheck`.
- [ ] `PasswordEntryDetail.jsx`, `PasswordEntryList.jsx`, `PasswordEntryMobileSheet.jsx`: `.vault-secret` (`user-select: none`, `no-print`), watermark (`username • timestamp`), блокировка `copy/contextmenu` только на секрете.
- [ ] `passwordVaultUtils.js`: `copyPasswordWithAutoClear(value, ttl = 25 с)` + тосты «Скопировано / Буфер очищен».
- [ ] `index.css`: `@media print .vault-secret { display: none }`, `.vault-blur-overlay`.
- [ ] Тесты `Passwords.test.jsx`: blur скрывает, print скрывает, буфер затирается, watermark рендерится.
- [ ] Проверки: узкий `npm test` → `npm run build`. Desktop: `SetWindowDisplayAffinity` за флагом + `dotnet test desktop/Hub.Desktop.sln -c Release`.

### Фаза 2 — Критические дыры бэкенда (3–5 дней)

- [ ] `api/v1/passwords.py`: unlock для `PATCH` с паролем на Web + `DELETE /unlock` (lock).
- [ ] `password_vault_service.py`: второй rate-bucket на user + throttle `reveal` + сброс при успехе; строгая привязка к `session_id` (опция).
- [ ] `secret_crypto_service.py`: запрет `SHA256`-fallback в prod + версионирование ключа (за флагом, миграция перешифрованием batch-ами).
- [ ] Тесты: `pytest -q tests/test_password_vault_api.py tests/test_password_vault_service.py` + параллельный тест гонки unlock/reveal; upgrade/downgrade Alembic на тестовой БД.

### Фаза 3 — Оптимизация и заголовки (2–3 дня)

- [ ] Пагинация `list_entries` + поиск без ведущего `%` для тегов.
- [ ] Исключить `/passwords` из долгого offline-кэша или сократить TTL.
- [ ] `web.config`: CSP + `Permissions-Policy`; `frame-ancestors` только в заголовке.
- [ ] Проверки: сравнение до/после (query count, time, locks), `npm run build`, `health-check.ps1`.

### Фаза 4 — Аудит/DLP и доки (1–2 дня)

- [ ] `GET /audit?mine=1`, дашборд аномалий, алерты.
- [ ] `docs/adr/` — решения по anti-screenshot/KDF; `REPOSITORY_MAP.md` — только если меняются entrypoint.
- [ ] Runbook: preflight, rollback (откат флага affinity/CSP в report-only), post-check.

## 8. Чек-листы приемки

### 8.1 Anti-screenshot строгий

- [ ] Скрытая вкладка/blur скрывает секрет <1 с и показывает оверлей.
- [ ] Печать не содержит секрета (print preview пуст).
- [ ] Копирование только кнопкой, событие `reveal.copy` в audit.
- [ ] Буфер затирается через ≤30 с, тост подтверждает.
- [ ] Watermark с user/time виден на секрете, не ломает копирование владельцу.
- [ ] Фото телефоном — остаточный риск принят и покрыт DLP-инструкцией.

### 8.2 Security

- [ ] `PATCH` без unlock отклоняется (Web и mobile одинаково).
- [ ] 5 фейлов с одного IP + лимит на user блокируют, успех сбрасывает, `Retry-After` обрабатывается.
- [ ] Слабый `PASSWORD_VAULT_KEY` в prod не стартует (fail-secure).
- [ ] `lock` отзывает оба ключа, logout отзывает unlock.
- [ ] CSP/headers проверены в runtime (не только в коде).
- [ ] Нет секретов в логах/тостах/console, `autocomplete` корректен.

### 8.3 Не проверено

- Runtime-заголовки и `APP_ENV` на prod — нужен read-only health-check + просмотр IIS.
- Фактический объем `password_vault` и план запроса — нужен доступ к тестовой БД, не prod.
- Desktop affinity на целевом GPU/RDP — нужен стенд.

## 9. Риски и допущения

- Строгий blur + `WDA_MONITOR` могут мешать легитимному шарингу экрана — держать за флагом с быстрым откатом.
- Ужесточение KDF/ключей требует ротации и перешифрования — планировать окном с бэкапом и rollback-планом.
- `docs/openapi` и словарь домена (`CONTEXT.md`) не меняются этим планом; второй словарь терминов не создается.
