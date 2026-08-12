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

В 0.2.0 presence **не подавляет Web Push**. Текущая `ChatPushSubscription` надёжно идентифицирует
конкретную browser installation только по endpoint, но не связана с Desktop WebView-сессией.
Сам Desktop WebView не регистрирует Web Push subscription. Поэтому подавление всех подписок
пользователя при одном активном Desktop привело бы к потере уведомлений в Chrome на другом ПК.

До появления доказуемой связи «эта subscription отображает то же самое Desktop-окно» сервер
предпочитает редкий дубль на разных клиентах пропущенному уведомлению. Отдельный Chrome продолжает
получать push независимо от свежего или устаревшего Desktop presence.

## Проверки

- каждый из семи каналов имеет unit-тест route и dedupe `id`;
- одинаковый канонический `id` между chat/mention показывается один раз;
- browser-only режим не требует готового Desktop bridge;
- неуспешная доставка не помечается как успешная;
- store повреждённой/неизвестной версии считается пустым;
- bridge payload проверяется на точный минимум полей;
- backend presence тестируется на auth, session binding, TTL, multiple sessions и disconnect;
- push regression подтверждает отсутствие global suppression.

## Эксплуатация

Presence можно безопасно отключить на frontend: доставка продолжит работать, а Web Push не
изменится. Очистка просроченных строк выполняется при heartbeat/read и отдельной ограниченной
операцией cleanup; отсутствие graceful disconnect не требует ручного вмешательства.
