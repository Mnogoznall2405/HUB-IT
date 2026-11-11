# Чеклист проверки: AI Agent Universal Tools

## Быстрый запуск тестов

```bash
# Только наши новые тесты (быстро, ~30 сек)
python -m pytest tests/test_ad_account_type_props.py tests/test_ad_groups_props.py tests/test_ad_service_new_functions.py tests/test_ad_tools_unit.py tests/test_context_task_1_1.py tests/test_filetime_props.py tests/test_input_validation_props.py tests/test_mailbox_filter_props.py tests/test_network_dns_lookup.py tests/test_network_host_ping.py tests/test_network_tools_unit.py tests/test_parallel_tool_execution.py tests/test_password_status_props.py tests/test_ping_parser_props.py tests/test_ssl_check_props.py tests/test_token_budget_props.py tests/test_tool_loop_props.py -v

# Все тесты проекта (~2.5 мин)
python -m pytest tests/ --tb=short -q
```

---

## Ручная проверка через чат-бота

### 1. AD: Пароль почтового ящика
- Спросить: "Проверь пароль ящика kozlovskii.me"
- Ожидание: бот вызовет `ad.mailbox.password_status`, вернёт статус с `account_type: "mailbox"`

### 2. AD: Истекающие пароли ящиков
- Спросить: "У каких ящиков скоро истекает пароль?"
- Ожидание: бот вызовет `ad.mailboxes.expiring_soon`, вернёт таблицу с ящиками

### 3. AD: Статус блокировки
- Спросить: "Заблокирован ли аккаунт ivanov_aa?"
- Ожидание: бот вызовет `ad.user.lockout_status`, покажет is_locked, bad_password_count

### 4. AD: Разблокировка (admin only)
- Спросить: "Разблокируй аккаунт ivanov_aa"
- Ожидание: бот создаст карточку подтверждения (draft), не разблокирует сразу
- Проверить: не-админ получит ошибку "Tool requires admin access"

### 5. AD: Группы пользователя
- Спросить: "В каких группах состоит kozlovskii_me?"
- Ожидание: бот вызовет `ad.user.groups`, вернёт список без Domain Users
- Доп. проверка: "Покажи все группы включая системные" → include_builtin=True

### 6. AD: История входов
- Спросить: "Когда последний раз входил kozlovskii_me?"
- Ожидание: бот вызовет `ad.user.logon_history`, покажет last_logon, logon_count

### 7. Сеть: Ping
- Спросить: "Пингани server01.corp.local"
- Ожидание: бот вызовет `network.host.ping`, покажет reachable, response_time_ms, packet_loss

### 8. Сеть: DNS
- Спросить: "Проверь DNS для mail.corp.local"
- Ожидание: бот вызовет `network.dns.lookup`, покажет records, ttl

### 9. Сеть: SSL-сертификат
- Спросить: "Проверь сертификат portal.corp.local"
- Ожидание: бот вызовет `network.ssl.check`, покажет issuer, valid_until, days_until_expiry

### 10. Сеть: Wake-on-LAN (admin only)
- Спросить: "Включи компьютер TMN-IT-001"
- Ожидание: бот создаст карточку подтверждения с MAC-адресом
- Проверить: не-админ получит ошибку

### 11. Сеть: Информация о хосте WMI (admin only)
- Спросить: "Покажи состояние компьютера server01"
- Ожидание: бот вызовет `network.host.info`, покажет OS, uptime, RAM, диски
- Проверить: не-админ получит ошибку

---

## Проверка лимитов (UI)

### 12. Слайдеры в настройках бота
- Открыть: Настройки → AI Боты → редактирование бота
- Проверить: есть секция "Лимиты инструментов"
- Проверить: слайдер "Раундов инструментов" (1–12, по умолчанию 6)
- Проверить: слайдер "Вызовов за раунд" (1–5, по умолчанию 3)
- Проверить: при значении > 8 раундов появляется жёлтое предупреждение

### 13. Сохранение лимитов
- Изменить слайдеры → сохранить бота
- Перезагрузить страницу → значения сохранились
- Проверить в БД: `tool_settings_json` содержит `max_tool_rounds` и `max_tool_calls_per_round`

---

## Проверка многошаговых операций

### 14. Сводка по отделу (multi-tool)
- Спросить: "Дай сводку по IT-отделу: оборудование, пароли, задачи"
- Ожидание: бот выполнит несколько раундов инструментов (itinvent + ad + office)
- Проверить: бот не обрывается на 4-м раунде (старый лимит), доходит до 6

### 15. Параллельное выполнение
- Спросить: "Пингани server01 и server02 одновременно"
- Ожидание: бот вызовет 2 ping в одном раунде (параллельно)

### 16. Устойчивость к ошибкам
- Спросить что-то, что вызовет несколько инструментов, один из которых упадёт
- Ожидание: бот продолжит работу, покажет результаты доступных инструментов

---

## Новые тулы в UI (чекбоксы)

### 17. Проверить наличие в настройках бота
В секции "AD инструменты":
- [ ] Пароль почтового ящика AD
- [ ] Истекающие пароли ящиков AD
- [ ] Статус блокировки AD
- [ ] Разблокировка учётной записи AD
- [ ] Группы пользователя AD
- [ ] История входов AD

В секции "Сетевые инструменты":
- [ ] Ping хоста
- [ ] DNS-запрос
- [ ] Проверка SSL-сертификата
- [ ] Wake-on-LAN
- [ ] Информация о хосте (WMI)

---

## Известные ограничения

- WMI (`network.host.info`) работает только на Windows Server с доступом к удалённому хосту
- WOL работает только в локальной сети (magic packet не проходит через роутеры)
- DNS lookup требует `dnspython` (pip install dnspython), иначе fallback на nslookup
- Unlock draft требует LDAP-подключение с правами записи
