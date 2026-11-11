# Звонки в чате на LiveKit

Голосовые и видеозвонки в диалогах чата (direct и group). Медиа идёт через self-hosted SFU
[LiveKit](https://livekit.io) (Apache 2.0); HUB-IT хранит только состояние звонка и выдаёт клиентам токены входа.

> Состояние: реализован backend (код, миграция, тесты); в репозитории подготовлены шаблон конфига
> (`scripts/livekit/livekit.example.yaml`), PM2-конфиг (`scripts/pm2/ecosystem.livekit.config.js`) и IIS-правило
> `/livekit` (`WEB-itinvent/frontend/public/web.config`). **Не выполнено на production и требует отдельного
> согласования:** запуск `livekit-server`, правила файрвола, публикация `web.config`, применение миграции,
> включение в `.env`. По умолчанию звонки выключены (`CALLS_ENABLED=false`). Порядок — в разделе «Развёртывание».

## Архитектура

```
Браузер / Desktop (WebView2) / Android --HTTPS--> HUB-IT backend  (состояние звонка, токен LiveKit)
          |                                  |
          |                                  +--WS chat realtime--> chat.call.invite / chat.call.updated
          +--WSS /livekit (IIS ARR) --> 127.0.0.1:7880 livekit-server (сигналинг)
          +--UDP 50000-50500 / TCP 7881 напрямую на 10.103.0.217 --> livekit-server (медиа)
```

- Backend не пропускает медиа и не говорит с LiveKit по сети: он только подписывает JWT (HS256, stdlib, без новых
  зависимостей). Комната LiveKit = `call_id`, identity = `str(user_id)`, name = отображаемое имя.
- Состояние хранится в PostgreSQL: `chat_calls`, `chat_call_participants` (ORM `backend/chat/models.py`,
  миграция `20261005_0126`). Сервис — `backend/chat/calls.py`, токен — `backend/chat/livekit_token.py`,
  роуты — `backend/api/v1/chat/calls.py` (подключены в общий chat-роутер, доступны и в основном процессе,
  и в split-chat при любом `CHAT_SURFACE`).
- В диалоге не более одного незавершённого звонка (частичный уникальный индекс). Переходы
  `join/decline/leave/timeout` идут короткой транзакцией с блокировкой строки звонка и идемпотентны.
- Тайм-аут дозвона **ленивый**: любое чтение/join/decline/leave звонка в статусе `ringing` старше
  `CALLS_RING_TIMEOUT_SEC` завершает его как `missed`. Фоновых воркеров нет, процессов может быть несколько.
- Страховка от «зависших» звонков (браузер закрыли без `leave`, вебхуков LiveKit нет): активный звонок старше
  `CALLS_MAX_DURATION_SEC` закрывается лениво как `completed`. Клиент, остающийся в звонке дольше часа, должен
  повторно вызывать `join` (идемпотентно, выдаёт новый токен), пока токен не истёк.
- Системное сообщение о звонке в историю диалога не добавляется (отдельный этап).

## Переменные окружения

Секреты только из env, в лог не попадают. В `.env.example` — плейсхолдеры.

| Переменная | По умолчанию | Назначение |
|---|---|---|
| `CALLS_ENABLED` | `false` | Главный выключатель |
| `LIVEKIT_URL` | — | Публичный `wss://…` адрес livekit-server (возвращается клиенту) |
| `LIVEKIT_API_KEY` | — | Ключ из `keys:` в `livekit.yaml` (claim `iss`) |
| `LIVEKIT_API_SECRET` | — | Секрет оттуда же (подпись токена) |
| `CALLS_RING_TIMEOUT_SEC` | `45` | Тайм-аут дозвона |
| `CALLS_TOKEN_TTL_SEC` | `3600` | Срок жизни токена |
| `CALLS_MAX_DURATION_SEC` | `21600` | Страховочный предел активного звонка |

Если звонки выключены или не заданы URL/ключ/секрет, все эндпойнты, кроме `GET /calls/config`, отвечают
`503 {"code":"calls_not_configured"}`, а `config` возвращает `{"enabled": false}`.

## Контракт API

Префикс `/api/v1/chat`. Права: чтение — `chat.read`, изменения — `chat.write`. Ошибки приходят как
`{"code": "...", "detail": "..."}` (для 409 дополнительно `call`).

| Метод и путь | Ответ |
|---|---|
| `GET /calls/config` | `{"enabled": bool}` |
| `POST /conversations/{id}/calls` `{"media":"audio"\|"video"}` | `200 {"call","token","url"}`; `403` не участник; `404` нет диалога; `400` диалог не direct/group или звонить некому; `409 {"code":"call_already_active","call"}` |
| `GET /conversations/{id}/calls/active` | `{"call": Call \| null}` |
| `POST /calls/{id}/join` | `{"call","token","url"}`; `ringing`→`active` при первом join приглашённого; повтор идемпотентен (новый токен); `409 {"code":"call_ended","call"}` если звонок завершён |
| `POST /calls/{id}/decline` | `{"call"}`; в 1:1 завершает звонок (`declined`), в группе — когда отказались все приглашённые; повтор безопасен |
| `POST /calls/{id}/leave` | `{"call"}`; инициатор вышел при `ringing` → `cancelled`; когда не осталось `joined` → `completed` |

`Call` = `{id, conversation_id, media, status: ringing|active|ended, initiator_user_id, started_at, answered_at,
ended_at, end_reason: null|completed|declined|missed|cancelled, participants: [{user_id, display_name,
state: invited|joined|declined|left}], updated_at}`. Поле `updated_at` — дополнительное (для упорядочивания
событий на клиенте).

### События (chat realtime, inbox-подписка)

- `chat.call.invite` — только приглашённым: `{"call": Call, "initiator": {"user_id", "display_name"}}`.
- `chat.call.updated` — всем участникам диалога при любом изменении состояния: `{"call": Call}`.

События публикуются после подготовки HTTP-ответа фоновой задачей и не блокируют его; клиент после
переподключения WS восстанавливает состояние через `GET …/calls/active`.

## Конфиг `livekit.yaml`

Шаблон — `scripts/livekit/livekit.example.yaml` (в git, плейсхолдеры). Боевой `scripts/livekit/livekit.yaml`
создаётся копированием шаблона с подстановкой реальных ключа и секрета; он в `.gitignore` и не коммитится.
Ключ/секрет должны совпадать с `LIVEKIT_API_KEY`/`LIVEKIT_API_SECRET` в боевом `.env`.

## Сеть и TLS

- Браузер разрешает доступ к камере и микрофону только в защищённом контексте, а WebRTC-сигналинг — по `wss://`.
  Сигналинг идёт через IIS на уже существующем HTTPS-имени портала (`wss://hubit.zsgp.ru/livekit`), поэтому
  отдельный сертификат не нужен — используется сертификат сайта.
- Принятые решения (см. «Развёртывание»): сигналинг `127.0.0.1:7880` за IIS по пути `/livekit`, TCP-фолбэк
  медиа `7881`, UDP-диапазон `50000–50500`, `rtc.node_ip = 10.103.0.217` при `use_external_ip: false`,
  TURN выключен.
- Медиа не проходит через IIS: клиенты соединяются с `10.103.0.217` напрямую. Следствие: медиа работает только
  у клиентов, которым доступен LAN-адрес сервера (LAN/VPN). Клиентам «снаружи» (через публичный адрес портала)
  сигналинг откроется, но медиа без TURN/внешнего IP не установится — отдельное решение, не входит в объём.
- **Не выполнено:** запуск livekit-server, правила Windows Firewall, публикация `web.config` с правилом
  `/livekit`. Каждое действие — production-изменение и требует отдельного согласования.

## Развёртывание

> Все шаги ниже — production-изменения. Выполнять **только по явному разрешению** и по одному, с проверкой
> post-check перед следующим. Подготовка репозитория (шаблон, PM2-конфиг, правило `web.config`) этого не делает.
>
> Внимание: `restart-backend.ps1` и `restart-chat-scale.ps1` поднимают процессы из **рабочего дерева**, а сборка
> frontend (`npm run build`) пишет в `dist`, который раздаёт боевой IIS: оба действия выкатывают весь
> незакоммиченный код, а не только звонки. Перед ними сверить `git status`/`git diff` и согласовать объём.

Принятые решения:

| Параметр | Значение |
|---|---|
| Сигналинг (приложение) | `livekit-server` на `127.0.0.1:7880`, наружу не открывается |
| Сигналинг (клиенты) | `wss://hubit.zsgp.ru/livekit` → IIS Rewrite `^livekit/(.*)` → `http://127.0.0.1:7880/{R:1}` (ARR, как у чата) |
| Медиа | TCP `7881`, UDP `50000–50500` на `10.103.0.217` |
| ICE-адрес | `rtc.node_ip: 10.103.0.217`, `use_external_ip: false` (VPN-интерфейс `172.16.0.1` не должен выбраться) |
| TURN | выключен |
| PM2 | процесс `itinvent-livekit` (`ecosystem.livekit.config.js`, входит в `ecosystem.all.config.js`) |
| `.env` backend | `LIVEKIT_URL=wss://hubit.zsgp.ru/livekit`, ключ/секрет — из `livekit.yaml`, `CALLS_ENABLED=true` |

`ecosystem.livekit.config.js` описывает процесс только если на хосте есть и `tools/livekit/livekit-server.exe`, и
`scripts/livekit/livekit.yaml`; иначе `start-all.ps1`/`pm2-boot-resurrect.ps1` его не ждут (нет crash-loop).
В `pm2-boot-resurrect.ps1` дополнительно ничего не добавлялось: LiveKit лёгкий (не входит в staged-список тяжёлых
воркеров), а ожидаемые процессы читаются из `ecosystem.all.config.js` автоматически.

### Шаг 0. Предусловия (только чтение)

- Миграция `20261005_0126` применена по [runbook](../../scripts/pm2/README.md#миграции-бд-при-релизе).
- Бинарник на месте; целостность — по архиву: `(Get-FileHash tools\livekit\livekit_1.13.7_windows_amd64.zip).Hash` должен совпасть со строкой `livekit_1.13.7_windows_amd64.zip` в `tools\livekit\checksums.txt`.
- Порты свободны: `netstat -ano | findstr ":7880 :7881"` — пусто.
- IIS: включены WebSocket Protocol и ARR proxy (уже нужны чату — `scripts\pm2\README.md`, раздел про ARR).

### Шаг 1. Боевой `livekit.yaml` (локальный файл, ничего не запускает)

```powershell
Copy-Item scripts\livekit\livekit.example.yaml scripts\livekit\livekit.yaml
# отредактировать блок keys: реальные ключ и секрет (>= 32 символов), не печатать в чат/логи
```

- Эффект: появляется gitignored-файл. Откат: `Remove-Item scripts\livekit\livekit.yaml`.
- Post-check: `git status --short scripts/livekit` не показывает `livekit.yaml`; ключ/секрет сохранены в
  менеджере секретов для шага 5.

### Шаг 2. Windows Firewall (входящие правила, только RTC-порты)

```powershell
New-NetFirewallRule -DisplayName 'HUB-IT LiveKit RTC TCP 7881' -Direction Inbound -Protocol TCP -LocalPort 7881 -Action Allow -Profile Domain,Private
New-NetFirewallRule -DisplayName 'HUB-IT LiveKit RTC UDP 50000-50500' -Direction Inbound -Protocol UDP -LocalPort 50000-50500 -Action Allow -Profile Domain,Private
```

Порт `7880` не открывать (только loopback). При необходимости ограничить `-RemoteAddress` подсетями клиентов.

- Эффект: клиенты LAN достигают медиа-портов. Откат: `Remove-NetFirewallRule -DisplayName 'HUB-IT LiveKit RTC*'`.
- Post-check: `Get-NetFirewallRule -DisplayName 'HUB-IT LiveKit*' | Get-NetFirewallPortFilter`.

### Шаг 3. Запуск `itinvent-livekit` в PM2

```powershell
pm2 start scripts\pm2\ecosystem.livekit.config.js
pm2 save
```

(Если `pm2.cmd` не находит Node — добавить в PATH `tools\node-v24.14.0-win-x64-full`.) Остальные процессы не затрагиваются.

- Эффект: `livekit-server` слушает `127.0.0.1:7880`, TCP `7881`, UDP-диапазон; попадает в `dump.pm2`.
- Откат: `pm2 delete itinvent-livekit; pm2 save`.
- Post-check: `pm2 describe itinvent-livekit` — `online`, restarts не растут; `netstat -ano | findstr ":7880"` —
  только `127.0.0.1:7880 LISTENING`; `Invoke-WebRequest http://127.0.0.1:7880/ -UseBasicParsing` — HTTP 200 (ожидаемо; не проверялось);
  `powershell -File scripts\pm2\health-check.ps1` (без `-Repair*`) — строка `livekit` = `ok`
  (проверка мягкая: отсутствие процесса даёт только `warn`, но не `fail`); `pm2 logs itinvent-livekit --lines 50` —
  без ошибок разбора конфига и без выбора `172.16.0.1` в качестве адреса.

### Шаг 4. IIS: правило `/livekit`

Правило `LiveKit Signal Reverse Proxy` добавлено в `WEB-itinvent/frontend/public/web.config` перед
`Chat API Reverse Proxy` (и всеми `^api/…`), с теми же `serverVariables`, что у остальных proxy-правил. Деплоится
вместе со сборкой (`dist/web.config`). Точечный вариант без сборки frontend — добавить то же правило в уже
опубликованный `web.config` каталога, который раздаёт IIS (проверить физический путь сайта), предварительно сохранив
копию **вне** раздаваемого каталога:

```powershell
Copy-Item <каталог сайта>\web.config output\web.config.bak-<дата>
# вставить блок <rule name="LiveKit Signal Reverse Proxy"> перед "Chat API Reverse Proxy"
```

- Эффект: IIS применяет `web.config` без рестарта; запросы `/livekit/*` идут на `127.0.0.1:7880`, остальные
  правила не затронуты (`stopProcessing`). Откат: вернуть сохранённую копию (или удалить блок правила).
- Post-check: `Invoke-WebRequest https://hubit.zsgp.ru/livekit/ -UseBasicParsing` — ответ LiveKit (ожидаемо HTTP 200; не проверялось), а не страница SPA;
  `/api/v1/chat/calls/config` и главная страница отвечают как раньше; после шага 5 в DevTools запрос
  `wss://hubit.zsgp.ru/livekit/rtc?...` получает `101 Switching Protocols`.
- Permissions-Policy: в `web.config` разрешено camera/microphone для self
  (`camera=(self), microphone=(self), geolocation=()`); чтобы изменение попало на сайт, нужна точечная правка
  опубликованного `dist/web.config` или сборка frontend (шаги в разделе). Демонстрация экрана в заголовке не
  упомянута и по умолчанию разрешена для self.

### Шаг 5. `.env` и перезапуск backend/chat

```powershell
powershell -File scripts\backup-env.ps1
# в .env задать: LIVEKIT_URL=wss://hubit.zsgp.ru/livekit, LIVEKIT_API_KEY, LIVEKIT_API_SECRET, CALLS_ENABLED=true
powershell -File scripts\pm2\restart-chat-scale.ps1   # dual-режим чата; single — restart-chat.ps1
powershell -File scripts\pm2\restart-backend.ps1      # дополнительно перезагружает scan
```

Роуты звонков подключены и в основном backend, и в chat-узлах, поэтому `.env` нужен обоим. Перезапуски — только
по явному разрешению и с учётом предупреждения выше (выкатывается всё рабочее дерево).

- Эффект: `GET /calls/config` возвращает `enabled: true`; текущие WS-соединения чата переподключаются.
- Откат: `CALLS_ENABLED=false` (или вернуть `.env` из бэкапа `C:\Backups\hub-it\env`) и повторить перезапуск.
  `itinvent-livekit` можно оставить запущенным.
- Post-check: `/health/ready` на `8001`, `8002`, `8004`; `GET /api/v1/chat/calls/config` под сессией — `{"enabled": true}`;
  в логах нет `schema_migration_check`.

### Шаг 6. Приёмка

Тестовый звонок между двумя пользователями из LAN: в DevTools сигналинг `101`, ICE-кандидаты на `10.103.0.217`,
аудио/видео в обе стороны; завершение звонка переводит его в `ended`. Откат всего — шаги 5 → 4 → 3 → 2 в обратном порядке.

## Порядок релиза

1. Выкатить код backend (звонки остаются выключенными: `CALLS_ENABLED` не задан). Старт процессов миграции не
   применяет, а таблицы звонков исключены из проверки схемы при старте, поэтому отсутствие таблиц процесс не остановит.
2. Применить миграцию **явной командой** по [runbook](../../scripts/pm2/README.md#миграции-бд-при-релизе)
   (`20261005_0126`, идемпотентна; перед запуском проверить фактическую схему chat: `chat.*` или legacy `public.chat_*`).
   Rollback: `alembic downgrade 20261002_0125` (удаляет только таблицы звонков).
3. Развернуть livekit-server, файрвол и правило IIS `/livekit` (раздел «Развёртывание», отдельное согласование).
4. Задать `LIVEKIT_*`, `CALLS_ENABLED=true` в `.env` и перезапустить backend штатными скриптами
   `scripts/pm2/restart-*.ps1` (только по явному разрешению).
5. Post-check: `GET /api/v1/chat/calls/config` → `{"enabled": true}`, тестовый звонок между двумя пользователями.

## Проверки

`pytest -q tests/test_chat_calls_flow.py tests/test_chat_calls_token.py tests/test_chat_calls_migration.py`
(sqlite, без реальных БД и LiveKit): сквозной сценарий через chat-роутер, подпись/claims токена, гонки
(двойной start/join, одновременный leave, decline против join), upgrade/downgrade миграции.
Не проверено автоматически: PostgreSQL (`SELECT … FOR UPDATE`, частичный индекс), реальное медиасоединение с LiveKit.
