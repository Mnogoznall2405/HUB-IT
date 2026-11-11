# ADR-0005: Device-bound Desktop reauthentication before Windows SSO

## Status

Accepted boundary; implementation gated (2026-08-11)

## Context

Рабочие станции смешанные: часть входит в `zsgp.corp`, часть — нет. HUB-сервер не является членом домена. Пользователь ожидает, что после первого подтверждённого входа доменный компьютер будет открывать его существующий HUB-профиль без регулярного повторного ввода пароля.

Локальное имя Windows и факт domain join можно получить в Desktop, но их может сообщить скомпрометированный клиент. Сервер не способен проверить Kerberos identity без доменного доверенного посредника. Бессрочная cookie-сессия превращает кражу WebView2 profile в постоянный доступ.

## Decision

1. В `0.3.0` термин «Windows SSO» означает device-bound passwordless reauthentication после одного обычного HUB-входа, а не Kerberos SSO.
2. Регистрация разрешается только из активной HUB-сессии, после действующей 2FA policy, на компьютере `zsgp.corp`, когда нормализованные Windows login и HUB username совпадают.
3. Backend связывает с `user_id` публичный ключ конкретного Windows-профиля. Закрытый неэкспортируемый ключ хранится через CNG; TPM-backed provider предпочтителен.
4. После истечения обычной сессии Desktop подписывает серверный одноразовый challenge. Успех создаёт обычную отзывную HUB-сессию через существующий auth/session pipeline.
5. Domain join и Windows username являются eligibility/diagnostic signals, но не authentication proof.
6. C# не получает и не хранит HUB access/refresh token; cookies остаются в постоянном WebView2 profile.
7. Недоменные компьютеры, браузер и любая ошибка проверки используют текущую форму входа. Автосоздание профилей запрещено.
8. Настоящий Kerberos SSO откладывается до появления отдельного доменного identity gateway с подписанными одноразовыми assertions.

## Consequences

- HUB-серверу не нужно входить в `zsgp.corp`.
- Пользователь получает почти бесшовный повторный вход, но администратор сохраняет отзыв устройства и сессии.
- Потребуются отдельные backend endpoints/model, native key service, новая версия строго ограниченного bridge и security-тесты.
- Локальный администратор остаётся сильным атакующим; TPM снижает риск извлечения ключа, но не заменяет серверный отзыв и endpoint security.
- Название функции в UI должно быть «Запомнить этот компьютер» или «Вход без пароля на этом компьютере», пока Kerberos не реализован.

## Rejected alternatives

- Неограниченная HUB-сессия для доменных ПК — нет надёжного отзыва и слишком велик ущерб от кражи профиля.
- Доверие к `Environment.UserName`, SID или `X-Forwarded-User` — данные приходят из недоверенной клиентской/сетевой границы.
- Хранение Windows/HUB-пароля в Credential Manager — создаёт повторное хранилище секрета и не даёт настоящего SSO.
- Windows Authentication на всём сайте — сервер не в домене, а смешанный парк получит несовместимый login flow.
- Автосоздание HUB-профиля — создаёт ошибки сопоставления и возможность захвата identity.

## Follow-up condition

Вертикальный срез можно начинать после утверждения challenge protocol, модели отзыва и threat model в `documentation/technical/WINDOWS_SSO_THREAT_MODEL.md`. Kerberos-путь требует нового ADR после появления доверенного domain identity gateway.

