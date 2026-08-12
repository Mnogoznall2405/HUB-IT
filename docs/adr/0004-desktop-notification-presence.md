# ADR-0004: Session-bound Desktop presence без global push suppression

## Status

Accepted (2026-08-11)

## Context

HUB одновременно доставляет уведомления через foreground React/WebSocket, Browser Web Push и
HUB Desktop native bridge. Один пользователь может работать в Desktop и в нескольких браузерах на
разных ПК. Windows username не подтверждает HUB-личность, а текущая Web Push subscription не имеет
надёжной связи с Desktop WebView-сессией.

Boolean `desktop_online` на пользователя не учитывает TTL и multiple PCs. Подавление всех push при
таком флаге создаёт пропуски после crash, sleep или сетевого разделения.

## Decision

1. Frontend использует один строгий notification envelope и канонический event `id` для локальной
   дедупликации native/browser delivery.
2. Desktop presence привязывается к уже аутентифицированной HUB-сессии. Server-side ключ —
   `session_id`; клиент не передаёт Windows username или постоянный device secret.
3. Desktop отправляет HTTPS heartbeat примерно раз в 60 секунд; server TTL — 180 секунд.
   Graceful disconnect — best effort. Новый WebSocket не создаётся.
4. Каждая сессия хранится отдельно, поэтому несколько ПК не схлопываются в один флаг пользователя.
5. На этапе 0.2.0 presence не подавляет ни одну Web Push subscription. Пока нет точного отображения
   subscription ↔ Desktop display context, редкий межклиентский дубль безопаснее пропуска.
6. Notification preferences остаются существующей серверной/React-моделью. Desktop не получает
   второй набор channel settings.

## Consequences

- Одно событие не дублируется внутри Desktop WebView/native fallback.
- Chrome на другом ПК продолжает получать push при любом состоянии Desktop presence.
- Presence пригоден для диагностики и будущей адресной маршрутизации, но сам по себе не даёт права
  отправлять команды и не доказывает владение устройством.
- Сервер хранит небольшие TTL-строки без пользовательского контента.
- Между отдельными клиентами временно возможен дубль.

## Rejected alternatives

- `desktop_online` на пользователя без TTL — stale state и потеря push.
- Использование `Environment.UserName` — не является HUB authentication proof.
- Новый notification WebSocket — дублирует существующий chat lifecycle.
- Global suppression всех Web Push подписок пользователя — ломает multiple devices.
- Постоянный secret через bridge — расширяет поверхность утечки без необходимости.

## Follow-up condition

Push suppression можно пересмотреть только после появления аутентифицированной, тестируемой связи
конкретного push endpoint с тем же display context. Изменение требует нового ADR и regression-тестов
на multiple PCs, crash/sleep и истечение TTL.
