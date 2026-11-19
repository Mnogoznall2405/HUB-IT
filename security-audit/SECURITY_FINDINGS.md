# HUB-IT — подробные находки

Дата: 2026-11-13.  
Все проверки — read-only и статические, кроме явно указанных локальных проверок. HTTP-атаки на production не выполнялись. Значения секретов в отчёте не приводятся.

Обозначения: **Confirmed** — путь и отсутствующая защита подтверждены кодом/конфигурацией; **Needs Validation** — зависит от runtime/политики/устройства; **False Positive** — проверено и отклонено.

> **Повторная проверка 2026-11-13 ~16:50:** после каждого заголовка добавлен статус. Кратко: CRIT-01 понижен до High (прямая подделка закрыта), CRIT-02 остаётся Critical; HIGH-02/04/06 и MED-01/02/03/04/05/06/07/10/11 исправлены в рабочем дереве; HIGH-01/03/05/07, MED-08/09 остаются. Сводка и доказательства: [SECURITY_RECHECK.md](SECURITY_RECHECK.md).

---

## CRIT-01. Production-аутентификация опирается на 10-символьный placeholder JWT-ключ при `APP_ENV=development`

**Статус повторной проверки (2026-11-13 16:50):** **Partially fixed / High.** Прямая подделка токена без `session_id` и заимствование чужой сессии закрыты в `deps.py`/`session_service.py`; есть регрессионные тесты. Остаются известный 10-символьный JWT-ключ, `APP_ENV=development` и отсутствие ротации. Подробнее: `SECURITY_RECHECK.md`.

**Severity:** Critical  
**Confidence:** Confirmed (код + конфигурация + PM2 + локальная проверка decode)  
**CWE:** CWE-321, CWE-798, CWE-1188, CWE-287

### 1. Файлы и строки

- `.env:275` — `APP_ENV=development`.
- `.env:286` — `JWT_SECRET_KEYS`; значение не приводится. Активный ключ — **10 символов**, является словарным placeholder (точное значение скрыто).
- `tests/test_backend_auth_hardening.py:39` — тот же placeholder в тесте; побайтовое сравнение с активным ключом даёт `True` (значение не приводится). То есть ключ известен любому с доступом к репозиторию/CI, а не только подбирается.
- `.env:285` — `JWT_SECRET_KEY`; 42-символьный placeholder.
- `WEB-itinvent/backend/config.py:368-380` — при непустом `JWT_SECRET_KEYS` первый элемент становится ключом подписи, остальные — previous.
- `WEB-itinvent/backend/config.py:577-588` — `Config.validate()` **немедленно возвращает управление**, если `app.is_production == False`; проверки placeholder-ключей и `AUTH_COOKIE_SECURE` не выполняются.
- `WEB-itinvent/backend/utils/security.py:115-143` — HS256, `jwt.decode` с `algorithms=[config.jwt.algorithm]`.
- `WEB-itinvent/backend/api/deps.py:108-146` — пользователь определяется по `user_id`/`sub`; проверка сессии выполняется **только если в токене есть `session_id`**.
- `WEB-itinvent/backend/services/trusted_device_service.py:288-291` — при отсутствии `device_id` или `device_id` без префикса `trusted:` проверка устройства возвращает `True`.
- `WEB-itinvent/start_server.py:14-24` — backend загружает root `.env` (`PROJECT_ROOT/.env`).
- `scripts/pm2/ecosystem.backend.config.js:5,11-12` — `PROJECT_ROOT = C:\Project\Image_scan`, `cwd = ...\WEB-itinvent`, `args = start_server.py`.

### 2. Источник недоверенных данных

JWT из заголовка `Authorization: Bearer` или HttpOnly-cookie. Для exploitation нужен знание/подбор ключа, а не доступ к серверу.

### 3. Путь выполнения

`Authorization`/cookie → `get_current_user` → `_resolve_access_token` → `decode_access_token` → `_load_user_from_token` → `user_service.get_by_id(user_id)` → `User` с ролью из БД → route.

При отсутствии `session_id`:
- `if token_data.session_id and not session_service.is_session_active(...)` — условие ложно, проверка пропускается;
- `trusted_device_service.is_token_device_valid(..., None)` — `True`;
- JTI-проверка есть, но у нового токена JTI не отозван.

### 4. Отсутствующая/неправильная защита

1. Нет production-валидации: `APP_ENV=development` отключает fail-closed проверки.
2. Ключ подписи — 10-символьный словарный placeholder, а не 256-битный случайный секрет.
3. Access-token не обязан быть привязан к активной серверной сессии.
4. Нет проверки, что токен выпущен этим инстансом/сессией (нет обязательного `session_id`).

### 5. Условия эксплуатации

- Ключ известен из репозитория (`tests/test_backend_auth_hardening.py:39`) или получен из локального `.env` (см. SECRET-01).
- Атакующий знает `user_id`/`username` активного пользователя (для non-admin достаточно id/username; admin дополнительно ограничен IP-allowlist).
- PM2-процессы используют root `.env`: `itinvent-backend` online, cwd `C:\Project\Image_scan\WEB-itinvent`, старт 2026-11-13 04:38; `.env` изменён 2026-11-12 17:34; `APP_ENV` в PM2 env не задан; `C:\Project\Image_scan` — junction на `C:\Project\HUB-IT-main`.

### 6. Последствия

Подделка access-token для любого активного пользователя без session_id: чтение почты, My Files, чата, задач, 1С-документооборота; для `user_id=1` — admin-функции, если запрос приходит с разрешённого IP. Это полный обход аутентификации и значительной части авторизации. Дополнительно: при `APP_ENV=development` и пустом user store `user_service.py:666-747` создаёт default `admin`/`user123`; при пересоздании/пустой БД это known-credential admin.

### 7. Минимальное безопасное воспроизведение (локально, без HTTP)

```python
# не выполнять на production; ключ не печатать
from backend.config import config
from backend.utils.security import decode_access_token
from jose import jwt
from datetime import datetime, timedelta, timezone

assert len(config.jwt.secret_key) == 10  # фактическое наблюдение
token = jwt.encode(
    {"sub": "audit-probe", "user_id": 1, "role": "admin",
     "token_type": "access",
     "exp": datetime.now(timezone.utc) + timedelta(minutes=5)},
    config.jwt.secret_key,
    algorithm=config.jwt.algorithm,
)
assert decode_access_token(token, expected_token_type="access") is not None
```

HTTP-проверку (`GET /api/v1/auth/me` с поддельным токеном) **не выполнять** без письменного разрешения: это активная атака на production.

Локальный запуск с `APP_ENV=production` падает `ConfigurationError` — текущая конфигурация не проходит production-валидацию; значит, backend работает только потому, что `APP_ENV=development`.

### 8. CWE и критичность

CWE-321 (hard-coded/weak key), CWE-798, CWE-1188, CWE-287. Critical: слабый словарный ключ и отсутствие session-binding дают обход аутентификации для любого пользователя; admin-часть дополнительно ограничена IP-allowlist, но non-admin данные полностью доступны.

### 9. Исправление

1. Сгенерировать `secrets.token_urlsafe(64)`; новый ключ первым в `JWT_SECRET_KEYS`.
2. Удалить placeholder-ключи; установить `APP_ENV=production`, `DEBUG=false`.
3. Перезапустить backend и chat штатными скриптами; убедиться, что `Config.validate()` проходит.
4. Сделать `session_id` обязательным для access-token (или всегда проверять активную сессию), а `device_id` — для токенов, выпущенных trusted-device flow.
5. Добавить startup-check: ключ ≥32 байт, не из `.env.example`, не содержит типовых placeholder-фрагментов.

### 10. Регрессионный тест

- `Config.validate()` падает при `APP_ENV=production` и placeholder-ключе.
- `_load_user_from_token` отклоняет access-token без `session_id` (после п.4).
- E2E: логин → `/auth/me` 200; поддельный токен без сессии → 401; после logout старый токен → 401.

---

## CRIT-02. Ключ шифрования секретов совпадает с опубликованным placeholder из `.env.example`

**Статус повторной проверки:** **Open.** `MAIL_CREDENTIALS_KEY` всё ещё побайтно равен `.env.example`; ACL `.env`/backup и agent `.env` не закрыты; ротация и перешифрование не выполнялись.

**Severity:** Critical  
**Confidence:** Confirmed  
**CWE:** CWE-321, CWE-798, CWE-522

### 1. Файлы и строки

- `.env:261` — `MAIL_CREDENTIALS_KEY`; значение не приводится.
- `.env.example:700` — тот же литерал (placeholder).
- `WEB-itinvent/backend/services/secret_crypto_service.py:67-95` — `encrypt_secret`/`decrypt_secret` используют `MAIL_CREDENTIALS_KEY` по умолчанию.
- Использование:
  - `services/mail_service.py:1390,1427` — пароли корпоративной почты;
  - `services/auth_security_service.py:176,215,355,434,478` — кэш пароля AD и TOTP-секреты;
  - `services/tickets_service.py:372-374` — паспортные данные в заявках;
  - `api/v1/vcs.py:246,464` — VCS-пароль;
  - `services/network_monitor_store.py:117,296` — секреты SNMP/мониторинга.

### 2. Источник

Любой, кто получил дамп/бэкап БД, и любой, у кого есть доступ к репозиторию (`.env.example` в git). Значение `.env` и `.env.example` совпадает побайтово (проверено без вывода значения).

### 3. Путь

DB/backup → зашифрованные колонки → `decrypt_secret` с известным ключом → plaintext (пароли почты/AD, TOTP, паспорт, VCS, SNMP).

### 4. Отсутствующая защита

- Нет проверки, что ключ не равен опубликованному example.
- Нет обязательной минимальной энтропии/формата Fernet для `MAIL_CREDENTIALS_KEY` (strict только для `PASSWORD_VAULT_KEY`).
- Ключ лежит в `.env`, доступном локальным пользователям (см. SECRET-01).

### 5. Условия

Доступ к БД/бэкапу (в т.ч. через SQL/Postgres-креды из того же `.env`) **или** доступ к репозиторию + дамп. Для TOTP это означает обход второго фактора; для почты/AD — захват учётных записей; паспортные данные — нарушение конфиденциальности.

### 6. Последствия

Полная расшифровка перечисленных секретов; компрометация 2FA и почты; утечка персональных данных. Критично, потому что ключ фактически опубликован и не требует подбора.

### 7. Воспроизведение

```powershell
# не выводить значения
python -c "from pathlib import Path; a=...; b=...; print(a==b)"  # True
```

Локально: `decrypt_secret(encrypt_secret('probe'))` с текущим ключом возвращает `probe`; это ожидаемое поведение, но ключ известен.

### 8. CWE/критичность

CWE-321/798/522. Critical: известный ключ + доступ к БД/бэкапу даёт все секреты; TOTP-секреты позволяют обходить 2FA.

### 9. Исправление

1. Сгенерировать новый Fernet key; новый — в `MAIL_CREDENTIALS_KEY`.
2. Перешифровать все поля, зашифрованные `encrypt_secret`, скриптом: decrypt старым ключом → encrypt новым, с проверкой. `MAIL_CREDENTIALS_KEY_LEGACY` в текущем коде **не поддерживается**; если нужен постепенный переход, сначала добавить его в `secret_crypto_service` и `decrypt_secret`.
3. Удалить старый ключ после проверки; удалить литерал из `.env.example`.
4. Ротировать пароли почты/AD и перевыпустить TOTP при признаках утечки БД.
5. Добавить startup-check на example/placeholder и минимальную длину.

### 10. Регрессия

- `decrypt_secret(encrypt_secret(x)) == x` для нового и legacy.
- Старт с ключом из `.env.example` → `SecretCryptoError`.
- Вход в почту, 2FA, VCS, monitoring после миграции.

---

## HIGH-01. Root `.env` и backup читаются локальной группой `BUILTIN\Users`

**Статус повторной проверки:** **Open.** `icacls` подтверждает наследуемое `BUILTIN\Users:(I)(RX)` на `.env`, `tmp/.env.bak-*` и `C:\ProgramData\HUB-IT\Agent\.env`.

**Severity:** High  
**Confidence:** Confirmed на проверенном хосте  
**CWE:** CWE-732, CWE-276

### 1. Файлы/доказательства

- `C:\Project\HUB-IT-main\.env` → `BUILTIN\Users:(I)(RX)` (icacls).
- `C:\Project\HUB-IT-main\tmp\.env.bak-before-1419-20261111-163339` (23 КБ) — полная копия `.env`, те же права.
- `logs/`, `data/` → `Users:(I)(RX)`; `tmp/`, `logs/` также имеют `Users:(CI)(AD)(WD)` на дочерние объекты.
- `C:\ProgramData\HUB-IT\Agent\.env` → `BUILTIN\Users:(I)(RX)`; содержит `ITINV_AGENT_API_KEY`, `SCAN_AGENT_API_KEY`.
- `C:\ProgramData\HUB-IT\Agent\Logs` и `Spool` наследуют чтение.

### 2. Источник

Локальный пользователь/низкопривилегированный процесс на сервере или рабочей станции.

### 3. Путь

Чтение `.env` → SQL/Postgres/SMB/JWT/Fernet/API keys → прямое подключение к БД/NAS, подделка JWT, расшифровка секретов.

### 4. Отсутствующая защита

Нет явного ACL hardening в `agent_installer.py`/`install_agent_task.ps1`; `.env` лежит в корне репозитория; backup не удаляется; `scripts/harden-my-files-acl.ps1` защищает только `data/my_files` и не покрывает `.env`.

### 5. Условия

Локальный доступ к серверу (для root `.env`) или к любой рабочей станции с агентом (для agent `.env`). На рабочей станции любой доменный пользователь, как правило, входит в `BUILTIN\Users`.

### 6. Последствия

Прямой доступ к SQL Server/PostgreSQL/NAS с сервисными учётными данными; кража JWT-ключа и ключа шифрования; компрометация всех пользовательских файлов на SMB-шаре; эскалация до admin при наличии admin IP.

### 7. Воспроизведение

```powershell
icacls C:\Project\HUB-IT-main\.env
icacls C:\ProgramData\HUB-IT\Agent\.env
```

Чтение значений в отчёте не приводится; в тесте использовать фиктивный файл, не production `.env`.

### 8. CWE/критичность

CWE-732/276. High: требует локального доступа, но превращает его в полный набор сервисных секретов. В сочетании с CRIT-01/CRIT-02 — Critical-цепочка.

### 9. Исправление

- Снять наследование ACL; оставить `SYSTEM`, `Administrators`, сервисную учётку.
- Удалить backup/копии; проверить `backups/`, `artifacts/`, `output/`, `tmp/`.
- Вынести `.env` из репозитория; использовать protected environment.
- Ротировать все секреты, которые были доступны.
- Проверить ACL SMB-шары.

### 10. Регрессия

`icacls` в deploy checklist; тест: стандартный пользователь не читает `.env`; сервисная учётка читает; приложение стартует.

---

## HIGH-02. `settings.users.manage` фактически admin-эквивалентно; non-admin может создать/повысить admin

**Статус повторной проверки:** **Fixed.** Запрет смены собственной роли/прав, admin-only delete, ограничения non-admin create/update; `tests/test_e2e_user_management_permissions.py` — 13 passed.

**Severity:** High (conditional) / Medium, если право никогда не выдаётся non-admin  
**Confidence:** Confirmed  
**CWE:** CWE-269, CWE-266, CWE-863

Независимый верификатор отметил важный контраргумент: `settings.users.manage` уже позволяет создать admin-пользователя и сменить пароль любому, включая id=1. Поэтому смена собственной роли не пересекает новую границу доступа — это дефект модели делегирования, а не отдельный обход. Severity остаётся High только при условии, что право выдано non-admin; иначе это латентная конфигурационная проблема.

### 1. Файлы/строки

- `WEB-itinvent/backend/api/v1/auth.py:2287-2311` — `PATCH /api/v1/auth/users/{user_id}`, guard `require_permission(PERM_SETTINGS_USERS_MANAGE)` (2291); единственная самопроверка — запрет собственной деактивации (2294-2295).
- `WEB-itinvent/backend/models/auth.py:273-291` — `UserUpdateRequest` разрешает `role`, `password`, `custom_permissions`, `use_custom_permissions`.
- `WEB-itinvent/backend/services/user_service.py:1348-1349` — `role` присваивается без проверки, кто меняет; `:435` — то же в `_apply_user_payload`; `:1385` — запись нового пароля без старого.
- `WEB-itinvent/backend/services/authorization_service.py:56,161,225-247` — `settings.users.manage` входит в admin-набор и может быть выдан как custom permission; effective permissions = custom + viewer base.
- `WEB-itinvent/backend/api/deps.py:352-368` — `ensure_user_permission` делает bypass для `role == "admin"`.

### 2. Источник

Тело `PATCH /api/v1/auth/users/{id}`: `role`, `password`, `custom_permissions`.

### 3. Путь

JWT пользователя с `settings.users.manage` → `require_permission` (permission есть) → `user_service.update_user` → запись `role=admin`/чужого пароля → следующий запрос уже с admin-bypass.

### 4. Отсутствующая защита

- Нет требования `current_user.role == "admin"` для смены роли/пароля другого пользователя.
- Нет запрета менять собственную роль/собственный permission-набор.
- `settings.users.manage` семантически выглядит как «управление пользователями», но фактически эквивалентно admin.

### 5. Условия

Администратор выдал non-admin `settings.users.manage` через custom permissions (поддерживаемая конфигурация). Далее один `PATCH` на свой id с `{"role":"admin"}`; либо смена пароля user id=1; либо создание нового admin через `POST /users`.

### 6. Последствия

Вертикальная эскалация до полного admin: `settings/env`, сброс 2FA другим, DLP, mail-admin, system metrics, управление пользователями. Admin IP allowlist может ограничить последующие запросы, если эскалация выполнена не с разрешённого IP; но non-admin данные и смена пароля admin доступны до этого.

### 7. Минимальное безопасное воспроизведение (локальный TestClient/тестовая БД)

1. Создать `viewer` с `use_custom_permissions=true`, `custom_permissions=["settings.users.manage"]`.
2. `PATCH /api/v1/auth/users/{self}` `{"role":"admin"}`.
3. `GET /api/v1/settings/env` → 200 (при разрешённом IP) или проверка `current_user.role` в БД.

Не выполнять на production.

### 8. CWE/критичность

CWE-269/266/863. High: требует делегированного права, но это документированная возможность custom permissions; последствия — полный admin.

### 9. Исправление

- Разрешать `role`, `is_active`, `password`, `custom_permissions` другого пользователя только `role == "admin"`.
- Запретить менять собственную роль/свой permission-набор.
- Запретить `create_user(role=admin)` без admin-роли.
- Рассмотреть отдельное право `settings.users.roles.manage` и двухмандатное подтверждение.

### 10. Регрессия

E2E: user-manager PATCH own role → 403; PATCH admin password → 403; admin → 200; audit log.

---

## HIGH-03. Общий agent API key доступен локальным пользователям и не привязан к `agent_id`

**Статус повторной проверки:** **Open (код готов, конфигурация нет).** Per-agent карты `SCAN_AGENT_API_KEYS`/`INVENTORY_AGENT_API_KEYS` в `.env` отсутствуют; общие ring-key `SCAN_SERVER_API_KEYS`/`ITINV_AGENT_API_KEYS` заданы. `tests/test_agent_key_binding.py` — 10 passed.

**Severity:** High  
**Confidence:** Confirmed (код + ACL + равенство ключей); HTTP-эксплуатация не выполнялась  
**CWE:** CWE-639, CWE-306, CWE-522

### 1. Файлы/строки

- `C:\ProgramData\HUB-IT\Agent\.env` — `ITINV_AGENT_API_KEY`, `SCAN_AGENT_API_KEY`; ACL `BUILTIN\Users:(I)(RX)`.
- `scan_server/app.py:1206-1220` — `GET /api/v1/scan/tasks/poll?agent_id=...`; ключ проверяется, `agent_id` — из запроса.
- `scan_server/app.py:1223-1248` — `POST /api/v1/scan/tasks/{task_id}/result`; `agent_id` — из тела.
- `scan_server/app.py:238-246` — `_check_agent_key`; один набор статических ключей.
- `scan_server/config.py:122-140` — `SCAN_SERVER_API_KEYS`/`SCAN_SERVER_API_KEY`.
- `WEB-itinvent/frontend/public/web.config` — правило `Scan API Reverse Proxy`: `^api/v1/scan/(.*)` → `http://127.0.0.1:8011/api/v1/scan/{R:1}` (без ограничения метода).
- `inventory_server/app.py:119-121, 305-315, 387-...` — тот же общий ключ на ingest/GET probe.
- Локальная проверка: `SCAN_AGENT_API_KEY` из agent `.env` входит в ring сервера (boolean, без вывода значения).

### 2. Источник

Локальный пользователь на рабочей станции читает `C:\ProgramData\HUB-IT\Agent\.env`; либо компрометация агента.

### 3. Путь

Чтение ключа → `GET https://hubit.zsgp.ru/api/v1/scan/tasks/poll?agent_id=<чужой>` → задачи другого хоста; `POST .../result` → подмена результата; `GET /agent-package`/`/install-package` → скачивание пакетов. Inventory-ключ → POST фейковых inventory/FS/DLP событий.

### 4. Отсутствующая защита

- Нет привязки ключа к `agent_id`/hostname.
- Нет подписи `agent_id`/результата.
- Нет разделения read/write agent endpoints.
- `.env` агента читается `Users`.

### 5. Условия

Любой сотрудник с локальным доступом к своей рабочей станции (стандартная ситуация) может прочитать ключ; scan API доступен через IIS. Для targeted-атаки нужно знать/угадать `agent_id` (имя хоста) и `task_id` (выдаётся poll).

### 6. Последствия

Чтение задач сканирования других хостов (пути/параметры/результаты), подмена/отмена результатов, обход DLP/scan, скачивание пакетов; для inventory — загрязнение данных инвентаря/DLP. Это не полный admin, но существенная компрометация флота.

### 7. Безопасное воспроизведение

- `icacls C:\ProgramData\HUB-IT\Agent\.env` — подтвердить чтение.
- Сравнить ключ агента с ring сервера (boolean).
- Не отправлять запросы на production; локальный тест: два фиктивных агента с разными ключами, ключ A не должен получать задачи B.

### 8. CWE/критичность

CWE-639/306/522. High: ключ доступен каждому локальному пользователю, а API не связывает ключ с агентом.

### 9. Исправление

- Per-agent keys или mTLS; подпись `agent_id` и результата.
- Ограничить ACL `ProgramData\HUB-IT\Agent`/`ScanAgent`.
- Разделить read/write; read probe-данных — отдельный admin/service token.
- Ротировать все agent keys.

### 10. Регрессия

Ключ A не читает задачи B; старый ключ → 401; стандартный пользователь не читает `.env`; аудит agent-запросов.

---

## HIGH-04. iOS standalone PWA: HTML-вложение открывается как same-origin `blob:` документ

**Статус повторной проверки:** **Fixed in source, runtime не проверен.** Popup-fallback разрешён только для PDF/PNG/JPEG/GIF/WebP; HTML/SVG/unknown идут в download. `mailMessageFileActions.test.js` — 12 passed; iOS standalone не проверялся.

**Severity:** High (conditional)  
**Confidence:** Needs Validation (код-путь подтверждён; iOS runtime не проверялся)  
**CWE:** CWE-79

### 1. Файлы/строки

- `WEB-itinvent/frontend/src/components/mail/mailMessageFileActions.js:281-314` — `shouldPreferBlobOpenFallback` (iOS standalone) и `downloadBlobFile`; `window.open('', '_blank')` → `popup.location.replace(url)`.
- `WEB-itinvent/frontend/src/components/mail/mailMessageFileActions.js:99-107` — MIME берётся из ответа/вложения.
- `WEB-itinvent/frontend/src/components/mail/useMailMessageFileActions.js:231-233` — скачивание вложения с `preferOpenFallback: true`.
- `WEB-itinvent/frontend/src/pages/chat/useChatPreviewController.js:72-80,172` — то же для чата.
- Backend: `WEB-itinvent/backend/api/v1/mail.py:1860-1866` — `media_type=content_type` (для HTML/SVG — исходный тип).
- `messaging`: `downloadBlobFile` не проверяет MIME; `popup.opener=null` не меняет origin.

### 2. Источник

HTML/SVG-вложение письма или чата от внешнего отправителя/участника.

### 3. Путь

Download → `Blob` с `type=text/html` → iOS standalone → `popup.location.replace(blob:...)` → документ наследует origin приложения → скрипт в HTML выполняется.

### 4. Отсутствующая защита

- Нет allowlist MIME для popup-fallback.
- Нет принудительного `application/octet-stream`/`Content-Disposition: attachment` для HTML/SVG на клиенте.
- Нет sandbox-просмотрщика для blob.

### 5. Условия

iPhone/iPad, PWA добавлено на Home Screen, popup не заблокирован, пользователь нажимает «Скачать» у HTML/SVG-вложения. На desktop Chromium ветка не выполняется.

### 6. Последствия

Скрипт в blob-документе получает origin приложения: читает localStorage (профиль, кэш писем), вызывает same-origin API с cookie (почта, задачи, настройки), может exfiltrate. HttpOnly-cookie не читается напрямую, но same-origin fetch их использует. Фактически захват сессии.

### 7. Безопасное воспроизведение

Локальная сборка + iOS Simulator/устройство, тестовое письмо с HTML-вложением `<script>document.title=localStorage.getItem('user')</script>`; проверить, отрисовался ли документ. Если WebKit скачивает файл — понизить до Low. Production не использовать.

### 8. CWE/критичность

CWE-79. High при подтверждении; conditional из-за iOS/PWA/popup.

### 9. Исправление

- Разрешить popup-fallback только для `application/pdf`/безопасных изображений; иначе `application/octet-stream`.
- Для HTML/SVG — отдельный sandbox-просмотрщик (`iframe sandbox` + CSP), не top-level navigation.
- На backend для download-эндпоинтов mail/chat отдавать `application/octet-stream` для HTML/SVG/XHTML.
- Не использовать `location.replace` для пользовательских файлов.

### 10. Регрессия

Unit: `navigator.standalone=true`, `text/html` → нет `window.open/location.replace`; PDF → есть. E2E: blob HTML не исполняет скрипт.

---

## HIGH-05. SSRF через Web Push endpoint

**Статус повторной проверки:** **Partially fixed / High residual.** Добавлены HTTPS, `ip.is_global`, запрет userinfo/портов и redirects, проверка при подписке и отправке. Остаётся DNS rebinding: `assert_public_push_endpoint` и `pywebpush` резолвят host повторно; allowlist провайдеров нет.

**Severity:** High  
**Confidence:** Confirmed по коду; web push включён в проверенном `.env`  
**CWE:** CWE-918

### 1. Файлы/строки

- `WEB-itinvent/backend/api/v1/settings.py:104-111,215-235` — `PUT /settings/notifications/push-subscription`; `endpoint` — только `min_length=1`.
- `WEB-itinvent/backend/api/v1/chat/push.py:30-45` — альтернативный маршрут.
- `WEB-itinvent/backend/chat/schemas.py:735-748` — та же модель.
- `WEB-itinvent/backend/chat/push_service.py:222-284` — `upsert_subscription` сохраняет endpoint без проверки схемы/host/IP.
- `WEB-itinvent/backend/chat/push_service.py:397-456` — `_send_payload_to_subscriptions` → `webpush(...)`; `pywebpush` делает POST на endpoint.
- `.env` — `WEB_PUSH_PUBLIC_KEY`, `WEB_PUSH_PRIVATE_KEY`, `WEB_PUSH_SUBJECT` заданы; web push включён.

### 2. Источник

Поле `endpoint` любого active user; `p256dh`/`auth` — произвольные строки.

### 3. Путь

PUT subscription → сохранение → любое уведомление (чат/хаб) → `pywebpush` → POST на `http://127.0.0.1:<port>/...` или `http://10.x/...`.

### 4. Отсутствующая защита

- Нет allowlist push-провайдеров.
- Нет обязательного HTTPS.
- Нет резолва/запрета private/loopback/link-local.
- Нет `follow_redirects=False`/лимита подписок.

### 5. Условия

Web push включён (подтверждено), любой active user, любое событие, вызывающее push. Тело шифруется ключами атакующего, но метод POST, путь и заголовки контролируются; ответ/ошибка сохраняются в БД.

### 6. Последствия

Blind SSRF: сканирование внутренних портов, POST на внутренние endpoint’ы, DoS через массовые подписки. Не даёт чтения ответа напрямую, но может инициировать действия/утечки через побочные эффекты.

### 7. Безопасное воспроизведение

Локальный listener на `127.0.0.1:PORT`; вызвать `upsert_subscription` с `http://127.0.0.1:PORT/probe` и `send_notification`; listener получает POST. После фикса — 400. Не отправлять на production.

### 8. CWE/критичность

CWE-918. High: простой authenticated SSRF с произвольным internal POST.

### 9. Исправление

Allowlist FCM/Mozilla/WNS/Apple; HTTPS; resolve + private-IP deny; redirects off; лимит подписок; egress-proxy; повторная проверка перед отправкой.

### 10. Регрессия

`http://127.0.0.1`, `169.254.169.254`, `file://`, `https://evil.example` → 400; легитимный FCM → 200; повторная отправка не идёт на запрещённый host.

---

## HIGH-06. DNS-rebinding SSRF в chat link preview

**Статус повторной проверки:** **Fixed.** Host резолвится один раз, соединение идёт на проверенный IP, TLS SNI/сертификат проверяются, redirects не выполняются, разрешены только 80/443. `tests/test_chat_link_preview_service.py` — 18 passed.

**Severity:** High (при доступности DNS rebinding; иначе Medium)  
**Confidence:** Confirmed по коду; DNS rebinding runtime не проверялся  
**CWE:** CWE-918

### 1. Файлы/строки

- `WEB-itinvent/backend/api/v1/chat/link_preview.py:15-22` — `GET /api/v1/chat/link-preview?url=...`, `chat.read`.
- `WEB-itinvent/backend/chat/link_preview_service.py:70-98` — `assert_public_http_url` резолвит host и проверяет IP.
- `:152-174` — `urllib.request` повторно резолвит тот же host и устанавливает соединение.
- `:53-58` — redirects отключены.

### 2. Источник

Query `url` от любого пользователя с `chat.read`.

### 3. Путь

`assert_public_http_url` (первый DNS-ответ — публичный IP) → `urllib` (второй ответ — `127.0.0.1`/`10.x`) → GET внутреннего ресурса → извлечение OG title/description/image → ответ клиенту.

### 4. Отсутствующая защита

- Нет IP pinning: проверенный IP не закрепляется за соединением.
- Нет повторной проверки после DNS.
- Нет ограничения портов/allowlist.

### 5. Условия

Атакующий контролирует authoritative DNS с TTL 0 и умеет отдавать сначала публичный IP, затем private. Целевой сервис отвечает `text/html` и содержит OG-метаданные.

### 6. Последствия

Утечка содержимого интранет-страниц (title/description), разведка внутренней сети/портов; не полный read произвольного файла, но SSRF с data exfiltration.

### 7. Безопасное воспроизведение

Локальный HTTP-сервер на `127.0.0.1:PORT`; в тесте подменить `socket.getaddrinfo`: первый вызов — `203.0.113.10`, второй — `127.0.0.1`; вызвать `_fetch_link_preview_uncached('http://rebind.test:PORT/')`. Без подмены — отказ. Production не использовать.

### 8. CWE/критичность

CWE-918. High при DNS rebinding; Medium при строгой сети/egress.

### 9. Исправление

Резолвить один раз, проверять все адреса и подключаться к конкретному IP (`http.client`/`socket` с `Host`); только 80/443; egress-proxy; запрет metadata/link-local; повторная проверка.

### 10. Регрессия

Resolver fixture public→private → отказ; `127.0.0.1`, `169.254.169.254`, `[::ffff:127.0.0.1]`, decimal IP, non-standard port → 400.

---

## HIGH-07. `xlsx@0.18.5` парсит недоверенные файлы, включая публичные share-ссылки

**Статус повторной проверки:** **Open / regression.** `xlsx` удалён, но `excelPreview.js` импортирует `xlsx-js-style@1.2.0` с `XLSX.version = 0.18.5`; `npm audit` alias-пакет не помечает. Лимиты 25 МБ/50 листов/5000 строк/512 столбцов добавлены, но уязвимый парсер остался; публичная share-страница всё ещё парсит файл.

**Severity:** High  
**Confidence:** Confirmed (npm audit + путь разбора)  
**CWE:** CWE-1321, CWE-1333, CWE-1104

### 1. Файлы/строки

- `WEB-itinvent/frontend/package.json` — `xlsx` direct; `package-lock.json` — `0.18.5`.
- `WEB-itinvent/frontend/src/lib/excelPreview.js:50-60` — `XLSX.read(buffer, {type:'array'})`.
- `src/components/mail/officeAttachmentPreview.js` — Excel-вложение письма.
- `src/pages/myFiles/useMyFilesPreviewController.js:84-91` — My Files.
- `src/pages/SharedFile.jsx:30,401` — **публичная** share-страница.
- `npm audit --omit=dev`: `xlsx` high, `GHSA-4r6h-8v6p-xvw6` (CVE-2023-30533), `GHSA-5pgg-2g8v-p4x9` (CVE-2024-22363), fixed versions в npm отсутствуют.

### 2. Источник

XLSX-файл от внешнего отправителя письма, участника чата, владельца публичной ссылки.

### 3. Путь

Download → `Blob` → `parseExcelWorkbookFromBlob` → `XLSX.read` в контексте SPA (для SharedFile — без входа).

### 4. Отсутствующая защита

- Уязвимая версия парсера.
- Нет sandbox/Worker/timeout/лимитов на размер и количество ячеек.
- Публичная share-страница парсит файл до какой-либо аутентификации.

### 5. Условия

Пользователь открывает предпросмотр специально сформированного `.xlsx`. Для публичной ссылки жертве достаточно открыть URL.

### 6. Последствия

Prototype pollution в контексте SPA (влияние на клиентскую логику/проверки, возможные gadget-цепочки), ReDoS/зависание вкладки; на публичной странице — без входа. Не server-side RCE.

### 7. Безопасное воспроизведение

Локальная фикстура с известным prototype-pollution payload; проверить `({}).polluted === undefined` после `XLSX.read`, время разбора. Не открывать на production.

### 8. CWE/критичность

CWE-1321/1333. High по dependency + подтверждённому пути; реальная эксплуатация prototype pollution зависит от gadget’ов приложения.

### 9. Исправление

SheetJS ≥0.20.3 с официального CDN (в npm нет) или `exceljs`; лимиты размера/ячеек; Web Worker + timeout; не парсить на публичной странице без sandbox.

### 10. Регрессия

Prototype-pollution fixture → `Object.prototype` не изменён; ReDoS fixture → timeout; обычный XLSX → ок.

---

## MED-01. `networks` и `json_operations`: чтение доступно любому authenticated, включая viewer

**Статус повторной проверки:** **Fixed.** `networks`/`json_operations` требуют соответствующие read-права; `tests/test_e2e_network_json_permissions.py` — 12 passed.

**Severity:** Medium  
**Confidence:** Confirmed  
**CWE:** CWE-862, CWE-285

### 1. Файлы/строки

- `WEB-itinvent/backend/api/v1/networks.py:175-180,269-273,306-331,521-525,564-570` — GET `/branches`, `/overview`, `/ports`, `/sockets`, `/maps/{id}/file`, `/audit` — только `get_current_active_user`.
- `WEB-itinvent/backend/api/v1/json_operations.py:145-156,209-212,269-278,677-695,739` — GET transfers/works/statistics/export — только `get_current_active_user`.
- `WEB-itinvent/backend/services/authorization_service.py:107-123` — viewer **не имеет** `database.read` и `networks.read`.
- `networks.py:27-28` — `_ensure_write_role` использует `PERM_NETWORKS_WRITE` только на write.

### 2. Источник

JWT viewer.

### 3. Путь

Viewer → GET endpoint (без permission) → service → SQL/JSON → ответ.

### 4. Отсутствующая защита

Нет `require_permission(PERM_NETWORKS_READ)`/`PERM_DATABASE_READ` на read-маршрутах; UI-скрытие разделов не является server-side проверкой.

### 5. Условия

Любой active viewer.

### 6. Последствия

Чтение топологии сети, портов, сокетов, карт, аудита изменений; истории перемещений/ремонтов с ФИО, серийными/инвентарными номерами; экспорт статистики. Нарушение ролевой изоляции.

### 7. Воспроизведение

Локальный viewer → `GET /api/v1/networks/branches?city=tmn`, `GET /api/v1/json/transfers`, `GET /api/v1/json/works/statistics/export` → 200. Ожидаемо 403.

### 8. CWE/критичность

CWE-862/285. Medium: данные внутренние, но доступ превышает роль.

### 9. Исправление

Добавить router-level/route-level `require_permission` на все GET; `discovery.identify-workspace` — `database.read` или отдельное право.

### 10. Регрессия

Viewer → 403 на перечисленных; operator → 200; admin → 200.

---

## MED-02. Transfer act IDOR: скачивание акта по UUID без проверки владельца

**Статус повторной проверки:** **Fixed.** Проверка owner/admin для transfer act download; `tests/test_e2e_transfer_act_pdf.py` — 12 passed, включая owner/unknown-owner сценарии.

**Severity:** Medium  
**Confidence:** Confirmed  
**CWE:** CWE-639, CWE-862

### 1. Файлы/строки

- `WEB-itinvent/backend/api/v1/equipment.py:3673-3707` — `GET /api/v1/equipment/transfer/act/{act_id}`; собственная зависимость только `get_current_active_user` (3676), но router-level `equipment.py:145-146` требует любое `database.*` право. То есть viewer заблокирован, operator/admin — нет.
- `WEB-itinvent/backend/services/transfer_service.py:333-359` — `get_act_record`/`recover_act_record_from_disk` ищут акт по UUID без owner/operation scope.
- `transfer_service.py:320-330` — `prepare_act_download` не проверяет пользователя.

### 2. Источник

`act_id` (UUID) в URL.

### 3. Путь

Пользователь с `database.*` (operator/admin) → UUID → `_ACT_STORE`/glob по диску → PDF/DOCX → FileResponse.

### 4. Отсутствующая защита

Нет owner/operation/job scope; нет проверки `database.write`; акт содержит данные сотрудника/оборудования.

### 5. Условия

Нужен UUID акта. UUID v4/5 не перебирается, но может утечь через ссылку, историю браузера, логи, Referer, переписку. `recover_act_record_from_disk` позволяет читать любой акт, лежащий на диске, по UUID.

### 6. Последствия

Раскрытие PDF/DOCX акта перемещения (ФИО, оборудование, подписи) другому сотруднику.

### 7. Воспроизведение

Локально: создать акт пользователем A, получить `act_id`, запросить его токеном B → 200. Ожидаемо 403/404.

### 8. CWE/критичность

CWE-639/862. Medium: object-level проверка отсутствует, но UUID снижает вероятность.

### 9. Исправление

Требовать `database.read/write` + owner/operation scope; хранить `created_by`/`job_id` и проверять; не использовать глобальный ACT_STORE без scope; audit.

### 10. Регрессия

Чужой `act_id` → 404/403; свой → 200; admin → 200.

---

## MED-03. Сброс 2FA и перевыпуск backup-кодов без повторной аутентификации

**Статус повторной проверки:** **Fixed.** `require_step_up_auth` для reset-2FA и backup-codes; `tests/test_auth_security_flow.py` — 65 passed.

**Severity:** Medium  
**Confidence:** Confirmed  
**CWE:** CWE-620, CWE-287

### 1. Файлы/строки

- `WEB-itinvent/backend/api/v1/auth.py:2050-2075` — `POST /auth/reset-2fa-self`; только `get_current_active_user`; нет password/TOTP.
- `WEB-itinvent/backend/services/auth_security_service.py:829-861` — `reset_user_twofa` отключает 2FA, удаляет backup codes, закрывает сессии.
- `WEB-itinvent/backend/api/v1/auth.py:1821-1830` — `POST /auth/backup-codes/regenerate`; только сессия.

### 2. Источник

Украденная/перехваченная сессия (access/refresh token).

### 3. Путь

Сессия → `reset-2fa-self` → 2FA выключен →下一步 логин только по паролю (если пароль известен) → persistent access. `backup-codes/regenerate` → новые коды для последующего входа.

### 4. Отсутствующая защита

Нет re-auth (password + TOTP/WebAuthn) для чувствительной операции; нет уведомления/задержки.

### 5. Условия

Атакующий имеет действующую сессию (XSS/кража токена/малварь) и знает пароль (или может его получить). Без пароля сброс 2FA не даёт нового логина, но ослабляет защиту.

### 6. Последствия

Превращение кражи сессии в устойчивый доступ; обход 2FA после смены пароля; новые backup-коды.

### 7. Воспроизведение

Локально: логин с 2FA → вызвать `reset-2fa-self` без кода → 200; проверить, что `is_2fa_enabled=false`. Ожидаемо 403 без re-auth.

### 8. CWE/критичность

CWE-620/287. Medium: требует сессии, но чувствительная операция без re-auth.

### 9. Исправление

Требовать password + текущий TOTP/backup code (или WebAuthn) для reset/regenerate; уведомлять пользователя; закрывать все сессии (уже есть); audit.

### 10. Регрессия

Без re-auth → 403; с re-auth → 200; после reset старые TOTP/backup не работают.

---

## MED-04. `announcements.moderate` даёт доступ к приватным задачам

**Статус повторной проверки:** **Fixed.** Task-эндпоинты используют `_can_manage_all_tasks` (`tasks.manage_all`/admin), а не `announcements.moderate`.

**Severity:** Medium  
**Confidence:** Confirmed  
**CWE:** CWE-863

### 1. Файлы/строки

- `WEB-itinvent/backend/api/v1/hub.py:126-127` — `_can_moderate_announcements = admin or announcements.moderate`.
- `hub.py:1724` — `GET /hub/tasks/{task_id}` передаёт это как `is_admin`.
- `hub.py:2165` — preview вложения; `hub.py:2264` — report.
- `services/hub_service.py:2490-2500` — `if is_admin: return True` без participant/department/visibility.

### 2. Источник

Custom permission `announcements.moderate` у non-admin.

### 3. Путь

Moderator → `GET /hub/tasks/{task_id}` (UUID известен) → `is_admin=True` → task/attachments/report.

### 4. Отсутствующая защита

Переиспользовано announcement-право для task-admin; нет `tasks.manage_all`/`tasks.review`.

### 5. Условия

Пользователь имеет `announcements.moderate` (custom), знает UUID задачи.

### 6. Последствия

Чтение приватных задач, вложений, отчётов; нарушение изоляции задач.

### 7. Воспроизведение

Локально: private task A; user B с `announcements.moderate` без task-прав → GET → 200. Ожидаемо 403.

### 8. CWE/критичность

CWE-863. Medium: UUID снижает вероятность, но право не по назначению.

### 9. Исправление

В task-эндпоинтах использовать `_is_admin_user` или `tasks.manage_all`/`tasks.review`; не переиспользовать announcement permission.

### 10. Регрессия

Moderator без task-прав → 403; с `tasks.manage_all` → 200.

---

## MED-05. HTML письма рендерится в DOM приложения без sandbox по умолчанию

**Статус повторной проверки:** **Fixed.** `MailHtmlBody` всегда iframe-sandbox; формы/input/button/select/textarea запрещены, fixed/absolute/z-index снимаются. Тесты `mailHtmlContent`/`MailHtmlBody` — 25 passed.

**Severity:** Medium  
**Confidence:** Confirmed  
**CWE:** CWE-1021, CWE-601

### 1. Файлы/строки

- `WEB-itinvent/frontend/src/components/mail/mailHtmlSandboxFlags.js:14-30` — default `false`; `VITE_MAIL_HTML_SANDBOX` в проверенном build не задан (в `.env.example:715` указан `0`).
- `WEB-itinvent/frontend/src/components/mail/MailHtmlBody.jsx:36-42,77-84` — при выключенном флаге `dangerouslySetInnerHTML`.
- `mailHtmlContent.js:80-89` — DOMPurify `USE_PROFILES:{html:true}`, FORBID tags/attrs; **не запрещает** `form`, `input`, `button`, `style`.
- `mail_message_serializer.py:229-231,374-377` — backend отдаёт `body_html` без санитизации.
- Локальная проверка DOMPurify: `<form action=...><input type=password>` и `style="position:fixed;inset:0;z-index:99999"` сохраняются.

### 2. Источник

HTML письма от внешнего отправителя.

### 3. Путь

Exchange → `body_html` → DOMPurify → `MailHtmlBody` → DOM SPA. Форма может занять весь экран и отправить пароль на внешний URL; ссылки могут увести вкладку.

### 4. Отсутствующая защита

- Sandbox выключен по умолчанию.
- DOMPurify разрешает формы/overlay CSS.
- CSP только Report-Only.
- Нет предупреждения для внешних ссылок.

### 5. Условия

Пользователь открывает письмо; сборка без `VITE_MAIL_HTML_SANDBOX=1`.

### 6. Последствия

Фишинг/UI-redress в доверенном origin, кража пароля почтового ящика; выполнение скриптов не требуется. Если DOMPurify будет обойдён — XSS.

### 7. Воспроизведение

Локальная фикстура письма с overlay-формой; открыть Mail при выключенном флаге; форма отображается поверх приложения. Отправку проверять только на локальный listener.

### 8. CWE/критичность

CWE-1021/601. Medium: не XSS, но убедительный фишинг в интерфейсе HUB.

### 9. Исправление

Включить sandbox по умолчанию; запретить form/input/button/select/textarea и fixed/absolute style; ссылки — `target=_blank rel=noopener`; CSP enforce с `form-action 'none'`.

### 10. Регрессия

Overlay-письмо не содержит form/fixed; MailHtmlBody по умолчанию iframe; CSP содержит `form-action 'none'`.

---

## MED-06. Chunk-загрузки буферизуют тело до проверки размера

**Статус повторной проверки:** **Fixed.** `read_body_limited` читает `request.stream()` с жёстким лимитом до буферизации; применён к chat chunk и equipment photo chunk.

**Severity:** Medium  
**Confidence:** Confirmed  
**CWE:** CWE-400, CWE-770

### 1. Файлы/строки

- `WEB-itinvent/backend/api/v1/chat/uploads.py:43-61` — `payload: bytes = Body(...)`.
- `WEB-itinvent/backend/chat/upload_session_transfer.py:30-41` — проверка `payload_size > chunk_size_bytes` после получения тела.
- `WEB-itinvent/backend/api/v1/equipment.py:4226-4241` — фото chunk.
- `WEB-itinvent/backend/services/equipment_photo_upload_service.py:202-211`.

### 2. Источник

Тело PUT/POST от пользователя с `chat.write`/`database.write`.

### 3. Путь

Starlette буферизует всё тело в память → затем проверка размера → 413/ошибка. Несколько параллельных запросов умножают память.

### 4. Отсутствующая защита

Нет `Content-Length`/streaming limit до чтения; IIS 64 МБ не является общим ASGI-лимитом.

### 5. Условия

Любой authenticated с `chat.write` (viewer имеет) или `database.write`.

### 6. Последствия

Memory pressure/OOM, stall event loop, отказ сервиса. Authenticated DoS.

### 7. Воспроизведение

Локально: отправить 60 МБ на chunk endpoint при ожидаемом chunk 256 КБ; сервер буферизует до проверки. После фикса — 413 до чтения.

### 8. CWE/критичность

CWE-400/770. Medium: требует аутентификации, но доступно широкой роли.

### 9. Исправление

Проверять `Content-Length` и читать `request.stream()` с жёстким лимитом; либо `UploadFile`/temp file; общий body-limit middleware.

### 10. Регрессия

Body > limit и chunked без Content-Length → 413, память не растёт.

---

## MED-07. ZIP-bomb при подготовке XLSX-превью

**Статус повторной проверки:** **Fixed.** Лимиты entries (2048), entry (128 МБ), total (256 МБ), `workbook.xml` (16 МБ), sheets (64) проверяются до `archive.read`.

**Severity:** Medium  
**Confidence:** Confirmed по коду (живой bomb не запускался)  
**CWE:** CWE-409, CWE-400

### 1. Файлы/строки

- `WEB-itinvent/backend/services/mail_attachment_preview_service.py:202-212` — `zipfile.ZipFile(...).read("xl/workbook.xml")` без лимита распакованного размера.
- `:280-304,311-363,414-500` — `_write_single_sheet_workbook` копирует записи архива через `shutil.copyfileobj` без проверки `file_size`/ratio.
- Входной файл ограничен 25 МБ, но сжатый XLSX может развернуться в гигабайты; при многих листах архив копируется многократно.

### 2. Источник

XLSX-вложение/файл, поставленный на preview.

### 3. Путь

Upload → preview job → `zipfile` → temp disk/CPU → fallback LibreOffice.

### 4. Отсутствующая защита

Нет проверки `ZipInfo.file_size`, суммы, compression ratio, числа листов; нет квоты temp.

### 5. Условия

Authenticated user (или публичная share-ссылка для My Files) загружает специально сформированный XLSX.

### 6. Последствия

Заполнение temp-диска, CPU/IO, насыщение очереди preview; отказ preview/других сервисов.

### 7. Воспроизведение

Синтетический XLSX с маленьким сжатым и большим распакованным `xl/media/*`; проверить отказ до записи. Не на production.

### 8. CWE/критичность

CWE-409/400. Medium: DoS, не RCE.

### 9. Исправление

Проверять `ZipInfo.file_size`, сумму, ratio, число файлов/листов; лимит temp; стриминговый парсер; квота.

### 10. Регрессия

Bomb fixture → 413/422 до записи; обычный XLSX → ок.

---

## MED-08. Python-зависимости: 220 advisory matches в 17 пакетах

**Статус повторной проверки:** **Partially fixed.** Python: 2 уязвимых пакета/3 advisory вместо 220/17, ключевые пакеты обновлены. Frontend: 12 (9 high, Excalidraw/mermaid); mobile: 23 (1 critical dev/CLI `shell-quote`, 8 high). `xlsx-js-style` не покрыт audit.

**Severity:** Medium (агрегированно; отдельные high)  
**Confidence:** Confirmed версии/audit; reachability частичная  
**CWE:** CWE-1104, CWE-400, CWE-1321

### 1. Факты

`pip-audit 2.10.1` по `.venv`:

- 128 пакетов, **220 advisory matches**, 17 пакетов.
- `python-multipart 0.0.26` — 12 (aliases): CVE-2026-42561, CVE-2026-53538/39/40; DoS парсинга форм.
- `pypdf 6.10.2` — 116 (aliases): CVE-2026-48155/56, 49460/61, 54530/31, 59935–59938, 71852/70, 84309–84311, 102993–103000, 113786–113795; CPU/memory DoS при разборе PDF.
- `pillow 12.2.0` — 153 (aliases): CVE-2026-54058/59/60, 55379/80, 55798, 59197–59205, 96636–96644, 112390–112406; DoS/parsing.
- `starlette 0.52.1` — 16: CVE-2026-48710 (Host), 48817/18, 54282/83.
- `aiohttp 3.13.4`, `cryptography 46.0.7`, `urllib3 2.6.3`, `oauthlib 3.3.1` — набор DoS/парсинга/HTTP.
- `python-jose 3.5.0` — CVE-2026-85394 (HMAC с DER public key); приложение использует HS256 с симметричным секретом, поэтому **не эксплуатируется текущей конфигурацией**, но фикса нет.

### 2. Путь

Недоверенные файлы/формы → pypdf/pillow/python-multipart → CPU/memory/DoS; starlette — Host/form limits.

### 3. Условия

Authenticated upload/preview, публичные share-ссылки, формы.

### 4. Последствия

Отказ preview/worker, memory pressure; для pillow — потенциальные parsing-баги (проверить reachability).

### 5. Исправление

Обновить пакеты с регрессией; добавить `pip-audit`/OSV в CI; лимиты парсинга; sandbox для LibreOffice/PDF/изображений.

### 6. Регрессия

`pip-audit` без high; preview fixtures; upload limits.

---

## MED-09. SQL Server: `TrustServerCertificate=yes` без `Encrypt=yes`

**Статус повторной проверки:** **Open (config) / Fixed (code).** Production TLS-валидация и per-db проверка добавлены, но `.env`: `APP_ENV=development`, `SQL_SERVER_ENCRYPT=no`, `SQL_SERVER_TRUST_SERVER_CERTIFICATE=true`, `SQL_SERVER_ALLOW_INSECURE_SQL_TLS=1`; гейт не активен.

**Severity:** Medium  
**Confidence:** Confirmed код; фактический TLS-режим драйвера не проверялся  
**CWE:** CWE-295

### 1. Файлы/строки

- `WEB-itinvent/backend/config.py:83-91` — connection string.
- `WEB-itinvent/backend/database/connection.py:47-57`.
- `bot/universal_database.py:64`.
- Фрагмент: `TrustServerCertificate=yes;`, без `Encrypt=yes`.

### 2. Источник/условия

Сетевой путь между приложением и SQL Server `10.103.0.213`; MITM/ARP spoofing в внутренней сети.

### 3. Последствия

При включённом шифровании сертификат не валидируется; при Driver 17 трафик может быть без шифрования. Перехват учётных данных/данных запросов.

### 4. Исправление

`Encrypt=yes;TrustServerCertificate=no;` + CA в trust store, либо Kerberos/Integrated Security; проверить драйвер/порт.

### 5. Регрессия

Подключение с самоподписанным сертификатом → fail; с CA → success.

---

## MED-10. Telegram bot: доступ не привязан к active HUB user

**Статус повторной проверки:** **Fixed in source, не развёрнуто.** Бот требует привязку Telegram ID к active HUB user и permission; `TELEGRAM_REQUIRE_HUB_USER` по умолчанию `1`; `tests/test_bot_hub_binding.py` — 14 passed. Запущенный bot не перезапускался.

**Severity:** Medium (Needs Validation по политике)  
**Confidence:** Confirmed по коду; фактическая группа/allowlist не проверялись  
**CWE:** CWE-285, CWE-613

### 1. Файлы/строки

- `bot/utils/decorators.py:43-62` — доступ по `ALLOWED_USERS` или членству в `ALLOWED_GROUP_ID`; `user_service`/`is_active` не проверяются.
- `bot/config.py:152-159` — `ALLOWED_GROUP_ID`, `ALLOWED_USERS`.
- `bot/handlers/work.py:35-54` — `require_work_access` использует только `check_user_access`.
- `bot/handlers/transfer.py`, `search.py`, `database.py`, `export.py` — `require_user_access`.

### 2. Условия

Пользователь деактивирован в HUB, но остался в Telegram-группе/allowlist (или группа широкая). Бот продолжает отвечать.

### 3. Последствия

Бывший сотрудник читает инвентарь/сотрудников, создаёт перемещения/работы, экспортирует данные. HUB deactivation не отзывает этот доступ.

### 4. Исправление

Сопоставить Telegram ID с HUB user; проверять `is_active` и нужное permission на каждом шаге; синхронизировать при деактивации; отдельный allowlist.

### 5. Регрессия

Деактивированный пользователь в группе → отказ; active с правом → доступ.

---

## MED-11. Нет production-запрета `DEBUG=true`; OpenAPI остаётся доступным

**Статус повторной проверки:** **Fixed.** Production запрещает `DEBUG=true`; `/docs`, `/redoc`, `/openapi.json` отключены при `debug=false`; текущий `.env` `DEBUG=false`.

**Severity:** Medium (Needs Validation по фактическому `DEBUG`)  
**Confidence:** Confirmed код; текущий `.env` `DEBUG=false`  
**CWE:** CWE-489, CWE-200

### 1. Файлы/строки

- `WEB-itinvent/backend/config.py:577-588` — `validate()` не проверяет `DEBUG`.
- `WEB-itinvent/backend/main.py:483-490` — `docs_url`/`redoc_url` только при `debug`; `openapi_url` не отключён.
- `main.py:603-609` — при `debug` глобальный handler возвращает `str(exc)`.
- `main.py:613-648` — карта роутеров.

### 2. Условия

Оператор ставит `DEBUG=true` в production (или оставляет по ошибке).

### 3. Последствия

`/docs`, `/redoc`, `/openapi.json` и текст внутренних исключений доступны на backend (loopback); через штатные правила IIS эти пути не проксируются, но при прямом доступе или ошибочном proxy-правиле раскрывается карта API и детали ошибок.

### 4. Исправление

`if self.app.debug: raise ConfigurationError` в production; `openapi_url=None` при debug=false; отдельный feature flag для диагностики.

### 5. Регрессия

`APP_ENV=production, DEBUG=true` → старт падает; `/openapi.json` → 404.

---

## LOW/INFO (сводно)

Для Low/Info ниже сокращённый формат: evidence и fix приведены; полный путь/условия/регрессия для них менее критичны, но не отменяют требования к доказательности.

| ID | Severity | Находка | Evidence | Fix |
|---|---|---|---|---|
| LOW-01 | Low | CSP только `Report-Only`, HSTS отсутствует | `WEB-itinvent/frontend/public/web.config` (CSP-Report-Only; нет `Strict-Transport-Security`) | Enforce CSP с nonce/hash; HSTS после проверки поддоменов |
| LOW-02 | Low/Medium | Mobile `axios@1.19.0` (high по audit); `shell-quote` critical только dev/CLI | `mobile-hub/package-lock.json`; `npm audit` | Обновить axios; пересобрать APK; убедиться, что shell-quote не в release |
| LOW-03 | Low | Download-grant можно использовать повторно в TTL | `my_files_service.py:4879-4901` (нет `used_at IS NULL` в WHERE) | Атомарно сжигать grant; второй запрос → 410 |
| LOW-04 | Low | Auth rate limit отключён для internal-зоны | `utils/rate_limit_guard.py:43-44`, `api/v1/auth.py:605-623` | Не отключать лимиты по зоне; отдельный высокий лимит + агрегат |
| LOW-05 | Low | Formula injection в Excel-export | `services/excel_export_service.py:146-152` | Экранировать `= + - @` / `data_type='s'` |
| LOW-06 | Low | Нет throttling на проверку 1C-учёток | `api/v1/docflow.py:147-165` | Лимит/backoff/audit; запрет чужого login |
| LOW-07 | Low | Mobile regex-санитайзер обходится (`<p/onclick=...>`), защита только CSP | `mobile-hub/src/mail/nativeMailHtml.ts:106-131,325-339` | Parser-based sanitizer; тест на `/`-разделители |
| LOW-08 | Low | Mobile WebView разрешает навигацию на любой `data:text/html` | `nativeMailHtml.ts:343-346`, `NativeMailHtmlBody.tsx:142` | Разрешить только `about:blank` |
| INFO-01 | Info | `vcs.read` может получить глобальный VNC-пароль через launch-token | `api/v1/vcs.py:477-510`; `.vnc` содержит `password` | Требовать `vcs.manage` или per-user VNC; аудит |
| INFO-02 | Info | Аватары `/auth/avatars/{id}.jpg` без аутентификации | `api/v1/auth.py:2503-2525`; `Cache-Control: public` | Закрыть сессией/`private`, если это нежелательно |
| INFO-03 | Info | `/health/pools`, `/health/ready`, `/openapi.json` не защищены на уровне backend, но штатно не проксируются IIS (только loopback) | `main.py:514-593,483-490`; `public/web.config` проксирует только `/api/*` и отдельные пути | Ограничить на сетевом уровне; отключить OpenAPI при debug=false |
| INFO-04 | Info | `python-jose` CVE-2026-85394 не применим к HS256-конфигурации | `python-jose 3.5.0`; `utils/security.py` HS256 | Мониторинг/замена библиотеки |

---

## False Positive / Needs Validation

### FP-01. Windows SSO «обходит 2FA» — принятое исключение, не подтверждённая уязвимость

`auth.py:865-952`, `auth_security_service.py:703-743` действительно выдают сессию без TOTP при SSO. Однако `documentation/technical/AUTH_SECURITY_STACK.md:143-149` явно фиксирует: Windows SSO заменяет приложение-TOTP для internal-zone AD FS flow. При `AUTH_2FA_POLICY=external_only` (текущая) это согласовано. Если политика `all`,例外 нужно пересмотреть: `complete_windows_sso_login` должен требовать второй фактор либо политика должна явно исключать SSO. Статус: **Needs Validation (policy)**, не Confirmed.

### FP-02. CSRF — защита только SameSite, но не подтверждённая эксплуатация

Cookie `SameSite=Strict`, CORS — фиксированный origin, refresh-cookie path ограничен. Отдельного CSRF-токена нет; mutating my-files дополнительно проверяет Origin/Sec-Fetch-Site. При `SameSite=Strict` cross-site form POST не несёт cookie; same-site subdomain/`SameSite=None` — отдельный риск. Статус: **Needs Validation / defense-in-depth**, не Confirmed.

### FP-03. SQL-инъекции, command injection, опасная десериализация, path traversal

Проверены перечисленные в `SECURITY_COVERAGE.md` пути: параметризация `?`/bind, динамические идентификаторы из allowlist/quote, `subprocess` с аргументными списками и `shell=False`, отсутствие `pickle`/`yaml.load`/`eval`, проверки `Path.name`/`resolve_under_root`. Подтверждённых находок нет. Это не доказывает отсутствие всех вариантов; см. ограничения.

### FP-04. VCS launch-token и публичные аватары

VCS: `vcs.read` получает глобальный VNC-пароль; вероятно, это задумано для операторов, но требует подтверждения владельца. Аватары: публичный endpoint задуман для `<img>`; риск — перечисление фото сотрудников. Оба — **Info/Needs Validation**, не High.

---

## Сводная таблица

> Таблица фиксирует **исходные** оценки первого прохода. Актуальные статусы — в строках «Статус повторной проверки» выше и в [SECURITY_RECHECK.md](SECURITY_RECHECK.md): CRIT-01 понижен до High, CRIT-02 остаётся Critical; HIGH-02/04/06 и MED-01/02/03/04/05/06/07/10/11 исправлены; HIGH-01/03/05/07, MED-08/09 остаются.

| ID | Severity | Module | Vulnerability | Evidence | Confidence | Recommended Fix |
|---|---|---|---|---|---|---|
| CRIT-01 | Critical | Auth/config | Placeholder JWT key (also in tracked test) + `APP_ENV=development`; token without session accepted | `.env:275,286`; `tests/test_backend_auth_hardening.py:39`; `config.py:577-588`; `deps.py:108-146`; `trusted_device_service.py:288-291` | Confirmed | Rotate keys, `APP_ENV=production`, mandatory session_id |
| CRIT-02 | Critical | Crypto | `MAIL_CREDENTIALS_KEY` equals published `.env.example` | `.env:261`; `.env.example:700`; `secret_crypto_service.py:67-95` | Confirmed | New Fernet key, re-encrypt, rotate credentials |
| HIGH-01 | High | Infra | `.env`/backup readable by `BUILTIN\Users` | `icacls`; `tmp/.env.bak-*`; `ProgramData\HUB-IT\Agent\.env` | Confirmed | Explicit ACL, remove copies, rotate secrets |
| HIGH-02 | High (cond.) | AuthZ | `settings.users.manage` is admin-equivalent; non-admin can create/upgrade admin | `auth.py:2287-2311`; `models/auth.py:273-291`; `user_service.py:1348-1361` | Confirmed | Admin-only role/password changes; forbid self-role; scope the permission |
| HIGH-03 | High | Agents | Shared agent key readable; arbitrary `agent_id` | `ProgramData\HUB-IT\Agent\.env`; `scan_server/app.py:1206-1248`; `web.config` proxy | Confirmed | Per-agent keys/mTLS; ACL; split read/write |
| HIGH-04 | High (cond.) | Web mobile | iOS PWA HTML blob same-origin XSS | `mailMessageFileActions.js:281-314`; `useMailMessageFileActions.js:231-233` | Needs Validation | MIME allowlist/sandbox; octet-stream |
| HIGH-05 | High | API | Web Push SSRF | `push_service.py:222-284,397-431`; `settings.py:104-111` | Confirmed | Provider allowlist, HTTPS/IP checks, no redirects |
| HIGH-06 | High/Medium | API | Link preview DNS-rebinding SSRF | `link_preview_service.py:70-98,152-174` | Confirmed (code) | IP pinning/egress allowlist; ports 80/443 |
| HIGH-07 | High | Frontend | `xlsx@0.18.5` prototype pollution/ReDoS on attachments/public share | `excelPreview.js:50-60`; `SharedFile.jsx:30,401`; `npm audit` | Confirmed | SheetJS ≥0.20.3/ExcelJS; Worker/limits |
| MED-01 | Medium | API | Networks/json read without read permission | `networks.py` GETs; `json_operations.py` GETs; role matrix | Confirmed | Add `networks.read`/`database.read` |
| MED-02 | Medium | Files | Transfer act IDOR by UUID | `equipment.py:3673-3707`; `transfer_service.py:333-359` | Confirmed | Owner/operation scope + permission |
| MED-03 | Medium | Auth | 2FA reset/backup codes without re-auth | `auth.py:1821-1830,2050-2075`; `auth_security_service.py:829-861` | Confirmed | Require password + TOTP/WebAuthn |
| MED-04 | Medium | Hub | `announcements.moderate` gives task-admin | `hub.py:126-127,1724,2165,2264`; `hub_service.py:2490-2500` | Confirmed | Use `tasks.manage_all`/admin |
| MED-05 | Medium | Web | Mail HTML inline without sandbox; form/overlay allowed | `mailHtmlSandboxFlags.js:14-30`; `MailHtmlBody.jsx:36-84`; `mailHtmlContent.js:80-89` | Confirmed | Sandbox default; forbid forms/fixed CSS |
| MED-06 | Medium | API | Chunk body buffered before size check | `chat/uploads.py:43-61`; `upload_session_transfer.py:30-41` | Confirmed | Streaming limit/413 |
| MED-07 | Medium | Files | XLSX zip-bomb in preview | `mail_attachment_preview_service.py:202-212,280-363` | Confirmed (code) | Zip size/ratio limits; temp quota |
| MED-08 | Medium | Deps | 220 Python advisories in 17 packages | `pip-audit` output; `.venv` | Confirmed versions | Update pypdf/pillow/multipart/starlette etc. |
| MED-09 | Medium | DB | SQL Server TLS cert not validated | `config.py:83-91`; `connection.py:47-57` | Confirmed (code) | `Encrypt=yes;TrustServerCertificate=no` + CA |
| MED-10 | Medium | Bot | Bot access not tied to active HUB user | `bot/utils/decorators.py:43-62`; `bot/handlers/work.py:35-54` | Needs Validation | Map Telegram ID to active user + permission |
| MED-11 | Medium | Config | No production `DEBUG` guard; OpenAPI exposed | `config.py:577-588`; `main.py:483-490,603-609` | Confirmed (code) | Fail on DEBUG in prod; `openapi_url=None` |
| LOW-01 | Low | Web | CSP report-only, no HSTS | `public/web.config` | Confirmed | Enforce CSP/HSTS |
| LOW-02 | Low/Medium | Mobile deps | axios 1.19.0; shell-quote dev-critical | `mobile-hub/package-lock.json`; npm audit | Confirmed versions | Update axios; rebuild APK |
| LOW-03 | Low | Files | Download grant reusable in TTL | `my_files_service.py:4879-4901` | Confirmed | Atomic burn |
| LOW-04 | Low | Auth | Internal auth rate limit bypass | `rate_limit_guard.py:43-44`; `auth.py:605-623` | Confirmed | Keep limits, separate quotas |
| LOW-05 | Low | Export | Excel formula injection | `excel_export_service.py:146-152` | Confirmed | Escape formula prefixes |
| LOW-06 | Low | Docflow | No throttle on 1C credential test | `docflow.py:147-165` | Confirmed | Rate limit/audit |
| LOW-07 | Low | Mobile | Regex sanitizer bypass (latent) | `nativeMailHtml.ts:106-131` | Confirmed (logic) | Parser-based sanitizer |
| LOW-08 | Low | Mobile | `data:text/html` navigation allowed | `nativeMailHtml.ts:343-346`; `NativeMailHtmlBody.tsx:142` | Confirmed | Allow only `about:blank` |
| INFO-01 | Info | VCS | `vcs.read` exposes global VNC password | `vcs.py:477-510` | Needs Validation | Require `vcs.manage`/per-user VNC |
| INFO-02 | Info | Auth | Public avatars | `auth.py:2503-2525` | Confirmed | Private/session if needed |
| INFO-03 | Info | API | OpenAPI/health information exposure | `main.py:483-490,514-593` | Confirmed | Disable/restrict at IIS |
| INFO-04 | Info | Deps | python-jose advisory not applicable to HS256 | `python-jose 3.5.0`; `utils/security.py` | Needs Validation | Monitor/replace |
