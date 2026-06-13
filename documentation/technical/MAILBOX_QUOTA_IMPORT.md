# Импорт квот Exchange (JSON sync)

Доменный ПК-сборщик собирает квоты всех почтовых ящиков через Exchange Remote PowerShell и отправляет JSON в HUB-IT.

## Компоненты

| Компонент | Путь |
|-----------|------|
| Скрипт sync | `scripts/mail_box_sync_domain.ps1` |
| Установка Scheduled Task | `scripts/install_mailbox_quota_task.ps1` |
| Шаблон `.env` на ПК | `scripts/mailbox_quota/.env.example` |
| API import | `POST /api/v1/mail/mailbox-quota-snapshots` |
| UI | Почта → вкладка «Квоты» (`mail.quotas.read`) |

## Настройка ПК-сборщика

1. Скопировать скрипты в `C:\ProgramData\IT-Invent\MailboxQuota\scripts\`
2. Создать `C:\ProgramData\IT-Invent\MailboxQuota\.env` по шаблону:

```ini
EXCHANGE_QUOTA_SERVER=tmn-srv-exch-01.zsgp.corp
EXCHANGE_QUOTA_USERNAME=ZSGP\service_account
EXCHANGE_QUOTA_PASSWORD=change_me
MAIL_QUOTA_IMPORT_API_URL=https://hubit.example.local/api/v1/mail/mailbox-quota-snapshots
MAIL_QUOTA_IMPORT_API_KEY=same_as_hub_env
```

3. Зарегистрировать задачу (от администратора):

```powershell
powershell -ExecutionPolicy Bypass -File scripts\install_mailbox_quota_task.ps1 -RepeatHours 4 -StartAfterRegister
```

Задача: **SYSTEM**, триггер **Once + Repetition** (каждые N часов), `StartWhenAvailable`.

Диагностика на ПК-сборщике:

```powershell
powershell -ExecutionPolicy Bypass -File C:\Project\Image_scan\scripts\diagnose_mailbox_quota_task.ps1
```

## Настройка HUB

В `.env` сервера:

```ini
MAIL_QUOTA_IMPORT_API_KEY=change_me
MAIL_QUOTA_SNAPSHOT_RETENTION_DAYS=90
MAIL_QUOTA_MAX_UPLOAD_MB=25
```

После деплоя backend выполнить Alembic migration `20260610_0048`.

## Права

- Учётка Exchange: View-Only (чтение `Get-Mailbox`, `Get-MailboxStatistics`)
- Пользователи web: право `mail.quotas.read` (по умолчанию у admin)

## Проверка

```powershell
# Только сбор, без upload
powershell -ExecutionPolicy Bypass -File mail_box_sync_domain.ps1 -ResultSize 5 -WhatIf -SaveLocalJson
```

```http
GET /api/v1/mail/mailbox-quota-snapshots/latest
Authorization: Bearer ...
```

## Troubleshooting

| Симптом | Действие |
|---------|----------|
| Не обновляется каждые 4 ч | `diagnose_mailbox_quota_task.ps1` → смотреть **Next run**, **Last result**; перерегистрировать `install_mailbox_quota_task.ps1 -RepeatHours 4 -StartAfterRegister` |
| Last result ≠ 0 | Ручной прогон `-ResultSize 5 -WhatIf -SaveLocalJson`, смотреть `sync.log` |
| 401 при POST | Сверить `MAIL_QUOTA_IMPORT_API_KEY` на HUB и в `.env` ПК |
| Exchange connect failed | FQDN в `EXCHANGE_QUOTA_SERVER`, права учётки, Kerberos/Negotiate |
| Нет данных в UI | ПК был выключен — дождаться `StartWhenAvailable` после включения |
| Upload failed | Смотреть `C:\ProgramData\IT-Invent\MailboxQuota\sync.log` и `archive\failed_payload_*.json` |
