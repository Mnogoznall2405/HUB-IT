# HUB Desktop: единая доставка и дедупликация уведомлений

## Назначение

Этот документ фиксирует модель уведомлений HUB Desktop 0.2.0. Цель — не создать новый канал
доставки, а свести существующие chat, mention, task, feed, mail, ticket и scan события к одному
внутреннему контракту и не показывать одно событие дважды внутри одного Desktop-профиля.

## Контракт frontend

Каждое локальное системное уведомление сначала преобразуется в строгий envelope:

```text
id
channel: chat | mention | task | feed | mail | ticket | scan
title
body
route
created_at
urgency: low | normal | high
```

`systemNotificationEnvelope.js` принимает только эти поля, ограничивает `id/title/body/route`,
удаляет управляющие символы и разрешает только локальные route вида `/...`. В bridge v1 уходят
только `id/title/body/route`. Остальные поля не передаются в native host и не журналируются.

Канонический `id` описывает событие, а не способ доставки. Например, обычное chat-событие и
mention с одним `message_id` используют один `chat:msg:<message_id>`. Поэтому классификация одного
события двумя источниками не создаёт второй toast.

## Локальная дедупликация

`systemNotificationRouter.js` — единственная точка выбора между Desktop bridge и Browser
Notification API:

1. Проверить envelope.
2. Проверить общий versioned localStorage-набор доставленных `id` (не более 300 записей).
3. Попытаться показать native notification.
4. Если native host недоступен или отказал — попытаться показать browser notification.
5. Записать `id` только после успешного вызова способа доставки.

Legacy-наборы chat/HUB/mail читаются только для плавной миграции. Новые события записываются в
единый набор. Содержимое уведомления, route и идентификаторы документов в набор не попадают.

Native fallback-плашка остаётся на экране до действия пользователя. Повторный `id` не создаёт
вторую плашку. Native host хранит только последний pending navigation route до готовности React.

## Настройки

Desktop использует существующие настройки HUB:

- общий переключатель системных уведомлений остаётся в React;
- серверные channel preferences остаются единственным источником разрешений каналов;
- Desktop не хранит независимую копию channel preferences;
- недоступность native toast означает fallback, а не автоматическое включение выключенного канала.

## Presence

Presence — это краткоживущий факт: «для этой подтверждённой HUB-сессии сейчас работает Desktop
shell». Он не является доказательством личности и не заменяет авторизацию.

- heartbeat: 60 секунд с небольшим jitter;
- TTL: 180 секунд;
- ключ хранения — server-side `session_id`; он не возвращается frontend и не логируется;
- строки создаются отдельно для разных HUB-сессий/ПК;
- graceful disconnect ускоряет очистку, но корректность зависит только от TTL;
- Windows username, имя компьютера и постоянный device secret не используются.

Frontend отправляет heartbeat обычным cookie-authenticated HTTPS-запросом. Новый WebSocket и
polling уведомлений не создаются. Жизненный цикл запускается только в подтверждённом Desktop shell
и останавливается при logout/unmount.

## Решение по Web Push suppression

**Исходно (0.2.0):** session presence (`/api/v1/desktop-presence`, TTL 180 с) Web Push не подавлял —
дубль на разных клиентах считался лучше пропуска.

**Текущее решение пользователя: «если активен десктоп — веб молчит».** Подавление строится не на
session presence выше, а на chat WebSocket (см. [CHAT_BACKEND_ARCHITECTURE.md](CHAT_BACKEND_ARCHITECTURE.md#hub-desktop-активен--веб-молчит)):

- пользователь *desktop-активен*, если у него есть живое chat-WS-соединение HUB Desktop и окно
  Desktop было в foreground последние `CHAT_DESKTOP_ACTIVE_WINDOW_SEC` (по умолчанию 120 с);
- пока он desktop-активен, сервер не отправляет браузерный Web Push (все `ChatPushSubscription`)
  по сообщениям чата, включая @mention; браузерные вкладки не показывают toast, системное
  уведомление и звук о новых сообщениях (счётчики/бейджи остаются);
- push в mobile-hub (FCM) по умолчанию не трогается (`CHAT_PUSH_SUPPRESS_MOBILE_WHEN_DESKTOP_ACTIVE=0`);
- ошибка чтения признака — fail-open (push отправляется как раньше);
- откат без деплоя: `CHAT_PUSH_SUPPRESS_WEB_WHEN_DESKTOP_ACTIVE=0` (только серверный push; вкладки
  продолжают молчать, пока получают `chat.desktop_presence`).

Принятый риск: Chrome на другом ПК молчит, пока Desktop пользователя в foreground (или 120 с после
ухода в фон). Desktop сам продолжает показывать свои уведомления.

## Проверки

- каждый из семи каналов имеет unit-тест route и dedupe `id`;
- одинаковый канонический `id` между chat/mention показывается один раз;
- browser-only режим не требует готового Desktop bridge;
- неуспешная доставка не помечается как успешная;
- store повреждённой/неизвестной версии считается пустым;
- bridge payload проверяется на точный минимум полей;
- backend presence тестируется на auth, session binding, TTL, multiple sessions и disconnect;
- push regression: Web Push подавляется только при desktop-активном пользователе (WS + foreground ≤ окна), fail-open при ошибке presence (`tests/test_chat_desktop_presence_push.py`).

## Эксплуатация

Presence можно безопасно отключить на frontend: доставка продолжит работать, а Web Push не
изменится. Очистка просроченных строк выполняется при heartbeat/read и отдельной ограниченной
операцией cleanup; отсутствие graceful disconnect не требует ручного вмешательства.
