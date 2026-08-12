# Модель угроз: HUB Desktop notification presence

## Scope

В scope входят frontend heartbeat, authenticated HTTPS endpoint, TTL-хранилище Desktop presence и
использование presence при принятии решений о доставке. Native bridge payload и локальная
дедупликация рассматриваются как соседняя граница. Web Push endpoint/key material, access cookie и
текст уведомлений являются чувствительными данными, но presence их не принимает и не хранит.

## Активы и границы доверия

| Актив | Требование |
|---|---|
| HUB session | Presence нельзя создать или удалить для чужой сессии |
| Доступность уведомлений | Stale/поддельный presence не должен глобально подавить push |
| Privacy | Не хранить Windows username, hostname, title/body/route или endpoint |
| Backend resources | Heartbeat не должен создавать неограниченные строки/запросы |
| Native bridge | Notification payload не должен попасть в native logs |

Границы: недоверенный JS input → строгий frontend envelope; WebView/browser → HTTPS auth endpoint;
endpoint → app database; React → versioned bridge v1; backend → Web Push provider.

## Возможности атакующего

- пользователь может изменить frontend JS/input в собственной authenticated-сессии;
- XSS в origin может выполнять запросы с правами этой сессии;
- сеть может рваться, задерживать heartbeat и не доставлять disconnect;
- один пользователь может иметь несколько действующих сессий и push subscriptions;
- локальный пользователь Windows может читать незашифрованный localStorage своего профиля;
- атакующий не считается способным извлечь server JWT signing key или обойти HTTPS.

## Угрозы и меры

| Угроза | Последствие | Мера |
|---|---|---|
| Heartbeat без auth | Чужой presence | Обязательные active user + active session dependencies |
| Подмена `user_id/session_id` в body | Presence жертвы | Эти поля отсутствуют в request schema; берутся из JWT/cookie server-side |
| Windows username как identity | Коллизия/имперсонация | Username Windows не принимается и не хранится |
| Crash/sleep без disconnect | Stale presence | TTL 180 секунд; correctness не зависит от DELETE |
| Flood уникальными device IDs | Рост БД | Клиентский device ID отсутствует; одна строка на session; upsert и rate limit |
| Удаление чужого presence | Нарушение доставки | DELETE ограничен текущей authenticated session |
| Global push suppression | Пропущенные уведомления на другом ПК | В 0.2.0 suppression отсутствует; future suppression только per exact endpoint/context |
| Replay heartbeat после logout | Продление presence | Active-session validation; revoked/closed session получает 401 |
| Notification injection | Внешняя навигация/лог-инъекция | Exact envelope, local route allowlist, controls/limits, exact bridge v1 schema |
| Local dedupe poisoning | Скрытие локального события | Store ограничен 300 id и тем же origin; server delivery не зависит от него |
| Sensitive diagnostics | Утечка title/body/route/token | Presence logs содержат только outcome/count; payload и session id не логируются |

## Security invariants

1. Presence write не содержит выбираемый клиентом user/session/device identifier.
2. Freshness вычисляется server-side по UTC и ограничена 180 секундами.
3. Строки разных сессий одного пользователя не перезаписывают друг друга.
4. Никакое решение 0.2.0 не подавляет все push subscriptions пользователя.
5. Presence endpoint не возвращает список устройств или session identifiers.
6. Ошибка presence fail-open только для доставки: HUB продолжает работу и push не теряется.

## Остаточный риск

Authenticated XSS может поддерживать presence своей сессии и читать локальные уведомления в рамках
уже скомпрометированной сессии. Это не расширяет права на другие аккаунты. Межклиентский дубль
допустим до появления безопасного per-subscription mapping.

## Обязательные тесты

- 401 без access cookie/token и после закрытия session;
- body с extra `user_id/session_id/device_id` отклоняется strict schema;
- heartbeat upsert не создаёт вторую строку той же session;
- две session одного user дают две независимые строки;
- TTL boundary и cleanup используют server clock;
- disconnect удаляет только текущую session;
- push selection не зависит от Desktop presence;
- логи/response не содержат session id, Windows username и notification payload.
